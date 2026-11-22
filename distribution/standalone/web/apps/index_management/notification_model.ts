/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The notifications of long index operations without the pages: the operations there are, how
 * what OpenSearch keeps for each becomes a row of the settings page and a row becomes what is
 * sent back, what a tick changes, and what is missing before the rows can be saved.
 */

import { countChanges } from './index_model';

export type ActionType = 'REINDEX' | 'RESIZE' | 'FORCEMERGE' | 'OPEN';
export type OperationType = ActionType | 'SHRINK' | 'SPLIT' | 'CLONE';

/** The operations by the names OpenSearch has for them */
export const ACTION_NAMES: Record<ActionType, string> = {
  REINDEX: 'indices:data/write/reindex',
  RESIZE: 'indices:admin/resize',
  FORCEMERGE: 'indices:admin/forcemerge',
  OPEN: 'indices:admin/open',
};

export const ACTION_TITLES: Record<ActionType, string> = {
  REINDEX: 'reindex',
  RESIZE: 'shrink, split, clone',
  FORCEMERGE: 'force merge',
  OPEN: 'open',
};

export const ACTION_DESCRIPTIONS: Record<ActionType, string> = {
  REINDEX: 'Notify when any reindex operation has failed or completed.',
  RESIZE: 'Notify when any shrink, split, or clone operation has failed or completed.',
  FORCEMERGE: 'Notify when any force merge operation has failed or completed.',
  OPEN: 'Notify when any open operation has failed or completed.',
};

export const OPERATION_TITLES: Record<OperationType, string> = {
  ...ACTION_TITLES,
  SHRINK: 'shrink',
  SPLIT: 'split',
  CLONE: 'clone',
};

export const CHANNELS_REQUIRED = 'One or more channels is required.';
export const CHANNELS_LABEL = 'Notification channels';

export interface ChannelRef {
  id: string;
}

/** What OpenSearch keeps for one kind of operation */
export interface LronConfig {
  lron_condition?: { success?: boolean; failure?: boolean };
  action_name?: string;
  channels?: ChannelRef[];
  [more: string]: unknown;
}

export const lronPath = (name: string) => `/_plugins/_im/lron/${encodeURIComponent(`LRON:${name}`)}`;

export const hasDefaultNotification = (config: LronConfig | undefined): boolean =>
  Boolean(config?.lron_condition?.failure || config?.lron_condition?.success);

// --- The rows of the settings page -----------------------------------------------------------------

/** One operation on the settings page: its two ticks beside everything else OpenSearch keeps for it */
export interface PlainConfig {
  failure?: boolean;
  success?: boolean;
  action_name: string;
  channels?: ChannelRef[];
  index: number;
  title: string;
  [more: string]: unknown;
}

const ACTIONS = Object.entries(ACTION_NAMES) as Array<[ActionType, string]>;

/** A row for every operation, in the order of the page; one that has nothing kept notifies nobody */
export function toPlainList(configs: LronConfig[]): PlainConfig[] {
  return ACTIONS.map(([actionType, actionName], index) => {
    const found = configs.find((config) => config.action_name === actionName) ?? {
      lron_condition: { failure: false, success: false },
      action_name: actionName,
      channels: [],
    };
    const { lron_condition: condition, ...rest } = found;
    return { ...condition, ...rest, action_name: actionName, index, title: ACTION_TITLES[actionType] };
  });
}

/** What is sent for every operation; the keys are in the order the plugin sends them */
export function toConfigList(rows: PlainConfig[]): LronConfig[] {
  return ACTIONS.map(([actionType, actionName], at) => {
    const found = rows.find((row) => row.action_name === actionName) ?? {
      failure: false,
      success: false,
      action_name: actionName,
      title: ACTION_TITLES[actionType],
      channels: [],
      index: at,
    };
    const { failure, success, index: _index, title: _title, ...rest } = found;
    return { ...rest, lron_condition: { failure, success } };
  });
}

/** The rows as they are saved: an operation that notifies of nothing keeps no channels */
export const submittedRows = (rows: PlainConfig[]): PlainConfig[] =>
  rows.map((row) => (!row.success && !row.failure ? { ...row, channels: [] } : row));

/**
 * A tick set or taken away. The first tick of an operation that has no channels yet takes the
 * channels of the operation above it.
 */
export function tickRow(rows: PlainConfig[], index: number, key: 'failure' | 'success', value: boolean): PlainConfig[] {
  return rows.map((row, at) => {
    if (at !== index) return row;
    const first = index > 0 && !row.success && !row.failure && !(row.channels && row.channels.length > 0);
    return first ? { ...row, channels: rows[index - 1].channels, [key]: value } : { ...row, [key]: value };
  });
}

export const withChannels = (rows: PlainConfig[], index: number, channels: ChannelRef[]): PlainConfig[] =>
  rows.map((row, at) => (at === index ? { ...row, channels } : row));

/** What is missing in a row: an operation that notifies needs somebody to notify */
export const channelError = (row: PlainConfig | undefined): string | undefined =>
  row && (row.failure || row.success) && !(row.channels && row.channels.length > 0) ? CHANNELS_REQUIRED : undefined;

/** What is missing, by the place of the row */
export function channelErrors(rows: PlainConfig[]): Record<number, string> {
  const errors: Record<number, string> = {};
  rows.forEach((row, at) => {
    const error = channelError(row);
    if (error) errors[at] = error;
  });
  return errors;
}

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** The errors as the list over the rows says them */
export const errorLines = (rows: PlainConfig[], errors: Record<number, string>): string[] =>
  Object.entries(errors).flatMap(([at, error]) => {
    const row = rows[Number(at)];
    return row ? [`${capital(row.title)} — ${CHANNELS_LABEL}: ${error}`] : [];
  });

const byAction = (rows: PlainConfig[]) => Object.fromEntries(rows.map((row) => [row.action_name, row]));

/** How many things differ between the rows as they are and as they were loaded */
export const unsavedCount = (rows: PlainConfig[], loaded: PlainConfig[]): number =>
  countChanges(byAction(rows), byAction(loaded));

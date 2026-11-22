/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Transform jobs without the pages: what a field of the source can be grouped and aggregated by,
 * the document the form builds as it is filled, what the two grids of sample data show in a
 * cell, and how a job and what it is doing are read back.
 */

import { formatDate } from '../../lib/dates';
import { isNumericMapping, type FieldItem } from './rollup_model';

// --- What OpenSearch keeps of a job ----------------------------------------------------------------

export interface Transform {
  description?: string;
  enabled?: boolean;
  continuous?: boolean;
  page_size?: number | null;
  schedule?: {
    interval?: { start_time: number; unit: string; period: number | string | null };
    cron?: { expression: string; timezone?: string };
  };
  source_index?: string;
  target_index?: string;
  data_selection_query?: unknown;
  groups?: GroupItem[];
  aggregations?: Record<string, Record<string, { field?: string } & Record<string, unknown>>>;
  updated_at?: number;
  enabled_at?: number | null;
  [more: string]: unknown;
}

/** What a job is doing, as the plugin explains it */
export interface TransformMetadata {
  transform_metadata?: {
    transform_id?: string;
    status?: string;
    failure_reason?: string;
    stats?: Record<string, number>;
  } | null;
}

export interface TransformDocument {
  _id: string;
  _seqNo?: number;
  _primaryTerm?: number;
  transform: Transform;
  /** In a list, of this job; of one job alone, under its name */
  metadata?: TransformMetadata | Record<string, TransformMetadata> | null;
}

// --- What a field can become -----------------------------------------------------------------------

export type AggType =
  | 'sum'
  | 'max'
  | 'min'
  | 'avg'
  | 'value_count'
  | 'percentiles'
  | 'scripted_metric'
  | 'terms'
  | 'histogram'
  | 'date_histogram';

type GroupItem = Record<string, { source_field?: string; target_field?: string; interval?: unknown } & Record<string, unknown>>;

/** One column of the result: a group or an aggregation, under the name its column has */
export interface AggItem {
  type: AggType;
  name: string;
  item: Record<string, unknown>;
}

export const isGroupBy = (type: string) => type === 'histogram' || type === 'terms' || type === 'date_histogram';

export type OptionId =
  | 'histogram'
  | 'date_histogram'
  | 'terms'
  | 'sum'
  | 'max'
  | 'min'
  | 'avg'
  | 'count'
  | 'percentile'
  | 'scripted';

export const OPTION_NAMES: Record<OptionId, string> = {
  histogram: 'Group by histogram',
  date_histogram: 'Group by date histogram',
  terms: 'Group by terms',
  sum: 'Aggregate by sum',
  max: 'Aggregate by max',
  min: 'Aggregate by min',
  avg: 'Aggregate by avg',
  count: 'Aggregate by count',
  percentile: 'Aggregate by percentile',
  scripted: 'Aggregate by scripted metrics',
};

/** What the menu of a field offers, by the type of the field; text offers nothing */
export function optionsOf(type: string | undefined): OptionId[] {
  if (isNumericMapping(type)) {
    return ['histogram', 'terms', 'sum', 'max', 'min', 'avg', 'count', 'percentile', 'scripted'];
  }
  if (type === 'text') return [];
  if (type === 'date') return ['date_histogram', 'terms', 'max', 'min', 'count'];
  return ['terms', 'count'];
}

export function termsItem(field: string): AggItem {
  const target = `${field}_terms`;
  return { type: 'terms', name: target, item: { terms: { source_field: field, target_field: target } } };
}

/** Ranges of a number. The space in the name is the plugin's. */
export function histogramItem(field: string, interval: number | undefined): AggItem {
  const width = interval ?? NaN;
  const target = `${field} _histogram_${width}`;
  return {
    type: 'histogram',
    name: target,
    item: { histogram: { source_field: field, target_field: target, interval: width } },
  };
}

export function dateHistogramItem(
  field: string,
  interval: number | undefined,
  unit: string,
  intervalType: 'fixed' | 'calendar'
): AggItem {
  const target = `${field} _date_histogram_${interval ?? NaN}_${unit}_${intervalType}`;
  const length = `${interval ?? NaN}${unit}`;
  return {
    type: 'date_histogram',
    name: target,
    item: {
      date_histogram:
        intervalType === 'calendar'
          ? { source_field: field, target_field: target, calendar_interval: length }
          : { source_field: field, target_field: target, fixed_interval: length },
    },
  };
}

export type MetricKind = 'sum' | 'max' | 'min' | 'avg' | 'value_count';

export function metricItem(kind: MetricKind, field: string): AggItem {
  return { type: kind, name: `${kind === 'value_count' ? 'count' : kind}_${field}`, item: { [kind]: { field } } };
}

export function isValidPercent(text: string): boolean {
  const value = parseFloat(text);
  return value >= 0 && value <= 100;
}

export function percentilesItem(field: string, percents: string[]): AggItem {
  return {
    type: 'percentiles',
    name: `percentiles_${field}`,
    item: { percentiles: { field, percents: percents.map((percent) => parseFloat(percent)) } },
  };
}

/** A metric computed by scripts written as JSON; throws when the text is not JSON */
export function scriptedMetricItem(field: string, script: string): AggItem {
  return {
    type: 'scripted_metric',
    name: `scripted_metric_${field}`,
    item: { scripted_metric: JSON.parse(script) as unknown },
  };
}

/** What is wrong with a new name for a column: another column has it. The two spaces are the plugin's. */
export function renameError(aggList: AggItem[], name: string, newName: string): string {
  return name !== newName && aggList.some((item) => item.name === newName)
    ? `Transformation with name "${newName}"  already exists`
    : '';
}

/** A column under a new name; the field a group writes to follows its name */
export function renameItem(aggList: AggItem[], oldName: string, newName: string): AggItem[] {
  const at = aggList.findIndex((item) => item.name === oldName);
  return aggList.map((item, index) => {
    if (index !== at) return item;
    if (!isGroupBy(item.type)) return { ...item, name: newName };
    const group = item.item[item.type] as Record<string, unknown>;
    return { ...item, name: newName, item: { [item.type]: { ...group, target_field: newName } } };
  });
}

export function removeItem(aggList: AggItem[], name: string): AggItem[] {
  const at = aggList.findIndex((item) => item.name === name);
  return aggList.filter((_item, index) => index !== at);
}

// --- The document the form builds ------------------------------------------------------------------

export interface TransformDraft {
  transform: Record<string, unknown>;
}

/** The job before anything is filled in. The start time is replaced when the job is sent. */
export const emptyTransformDraft = (): TransformDraft => ({
  transform: {
    description: '',
    enabled: true,
    page_size: 1000,
    roles: [],
    schedule: { interval: { start_time: 234802, period: 1, unit: 'MINUTES' } },
    source_index: '',
    target_index: '',
  },
});

// A key that is there keeps its place and a new one goes last: the order the plugin's requests have
const set = (draft: TransformDraft, key: string, value: unknown): TransformDraft => ({
  transform: { ...draft.transform, [key]: value },
});

function unset(draft: TransformDraft, key: string): TransformDraft {
  const { [key]: _gone, ...rest } = draft.transform;
  return { transform: rest };
}

export const withDescription = (draft: TransformDraft, description: string) => set(draft, 'description', description);
export const withSourceIndex = (draft: TransformDraft, index: string) => set(draft, 'source_index', index);
export const withTargetIndex = (draft: TransformDraft, index: string | undefined) => set(draft, 'target_index', index);
export const withEnabled = (draft: TransformDraft, enabled: boolean) => set(draft, 'enabled', enabled);
export const withContinuous = (draft: TransformDraft, continuous: boolean) => set(draft, 'continuous', continuous);
export const withPageSize = (draft: TransformDraft, pageSize: number | undefined) =>
  set(draft, 'page_size', pageSize ?? null);

export const FILTER_INVALID = 'Invalid source index filter JSON';

/** The query that chooses the documents of the source; no text is no query */
export function withFilter(draft: TransformDraft, filter: string): { draft: TransformDraft; error: string } {
  if (filter === '') return { draft: unset(draft, 'data_selection_query'), error: '' };
  try {
    return { draft: set(draft, 'data_selection_query', JSON.parse(filter) as unknown), error: '' };
  } catch {
    return { draft, error: FILTER_INVALID };
  }
}

/** The groups of the list; a job that has none left says nothing of groups */
export function withGroups(draft: TransformDraft, aggList: AggItem[]): TransformDraft {
  const groups = aggList.filter((item) => isGroupBy(item.type)).map((item) => item.item);
  return groups.length > 0 ? set(draft, 'groups', groups) : unset(draft, 'groups');
}

/** The aggregations of the list by their names */
export function withAggregations(draft: TransformDraft, aggList: AggItem[]): TransformDraft {
  return set(
    draft,
    'aggregations',
    Object.fromEntries(aggList.filter((item) => !isGroupBy(item.type)).map((item) => [item.name, item.item]))
  );
}

/** A job whose groups and aggregations were dropped with the source they were defined on */
export function withoutDefinitions(draft: TransformDraft): TransformDraft {
  const cleared = unset(draft, 'groups');
  return 'aggregations' in cleared.transform ? set(cleared, 'aggregations', {}) : cleared;
}

/** A schedule that starts now; the plugin sends the period of a new job as text */
export function withSchedule(
  draft: TransformDraft,
  interval: number | undefined,
  unit: string,
  nowSeconds: number
): TransformDraft {
  const { cron: _cron, ...schedule } = (draft.transform.schedule ?? {}) as Record<string, unknown>;
  return set(draft, 'schedule', {
    ...schedule,
    interval: { start_time: nowSeconds, unit: `${unit}`, period: `${interval ?? NaN}` },
  });
}

/** The job as it is sent: every group and aggregation of the list, on a schedule that starts now */
export function transformBody(
  draft: TransformDraft,
  aggList: AggItem[],
  interval: number | undefined,
  unit: string,
  nowSeconds: number
): TransformDraft {
  return withSchedule(withAggregations(withGroups(draft, aggList), aggList), interval, unit, nowSeconds);
}

// --- What the grids of sample data show ------------------------------------------------------------

/** A moment as the pages of transform jobs write it: 11/22/26 9:05AM, or a dash */
export function transformTime(time: unknown): string {
  if (!time) return '-';
  const date = new Date(time as number | string);
  return Number.isNaN(date.getTime()) ? '-' : formatDate(date, 'MM/DD/YY h:mmA');
}

const plain = (value: unknown): string =>
  Array.isArray(value) ? value.map((item) => plain(item)).join('') : typeof value === 'object' ? JSON.stringify(value) : String(value);

/**
 * A cell of the source: the value under the name of the column, read as the type of the field
 * says. An alias shows the field it stands for, and a keyword the text it was made from.
 */
export function sampleCell(fields: FieldItem[], source: Record<string, unknown>, columnId: string): string {
  const column = fields.find((field) => field.label === columnId);
  const lookup = column?.type === 'alias' && column.path !== undefined ? column.path : columnId;
  const type = fields.find((field) => field.label === lookup)?.type;
  if (type === 'keyword') {
    const text = source[lookup.replace('.keyword', '')];
    return text ? plain(text) : '-';
  }
  const value = source[lookup];
  if (type === 'date') return value ? transformTime(value) : '-';
  if (type === 'boolean') return value == null ? '-' : value ? 'true' : 'false';
  return value !== undefined ? JSON.stringify(value) : '-';
}

/** A cell of the result: the time of a date histogram as a time, anything but text as JSON */
export function previewCell(row: Record<string, unknown>, columnId: string): string {
  const value = row[columnId];
  if (!value) return '-';
  if (columnId.includes('date_histogram')) return transformTime(value);
  return typeof value !== 'string' ? JSON.stringify(value) : value;
}

/** The columns of the result: the list while it is built, afterwards what the first row holds */
export function previewColumns(aggList: AggItem[], documents: Array<Record<string, unknown>>, readOnly: boolean): string[] {
  if (!readOnly) return aggList.map((item) => item.name);
  return documents.length > 0 ? Object.keys(documents[0]) : [];
}

// --- A job in words --------------------------------------------------------------------------------

export interface DefinitionItem {
  title: string;
  field: string;
}

/** The groups and aggregations of the list, each by what it does and the field it does it to */
export function reviewItems(aggList: AggItem[]): DefinitionItem[] {
  return aggList.map((item) => {
    const inner = item.item[item.type] as { source_field?: string; field?: string } | undefined;
    if (isGroupBy(item.type)) return { title: `Group by ${item.type}`, field: inner?.source_field ?? '' };
    if (item.type === 'scripted_metric') return { title: `${item.type}()`, field: item.name };
    return { title: `${item.type}()`, field: inner?.field ?? '' };
  });
}

/** The same of a job read back: its first ten groups, then its aggregations */
export function settingsItems(transform: Transform): DefinitionItem[] {
  const groups = (transform.groups ?? []).slice(0, 10).flatMap((group): DefinitionItem[] => {
    const method = (['date_histogram', 'histogram', 'terms'] as const).find((name) => group[name] != null);
    return method ? [{ title: `Group by ${method}`, field: group[method].source_field ?? '' }] : [];
  });
  const aggregations = Object.entries(transform.aggregations ?? {}).map(([name, aggregation]) => {
    const type = Object.keys(aggregation)[0];
    return { title: `${type}()`, field: type !== 'scripted_metric' ? (aggregation[type]?.field ?? '') : name };
  });
  return [...groups, ...aggregations];
}

export interface TransformStatus {
  tone: 'critical' | 'healthy' | 'subdued' | 'pale';
  text: string;
  /** Why it failed, to show when the word is clicked */
  error?: string;
}

/** The reason a job failed, with the name of the job in quotes wherever it appears */
export function quoteTransformId(transformId: string | undefined, text: string): string {
  return transformId ? text.split(transformId).join(`"${transformId}"`) : text;
}

/** The state of a job in a word; nothing when it has not run or says something unknown */
export function transformStatus(metadata: TransformMetadata | null | undefined): TransformStatus | undefined {
  const state = metadata?.transform_metadata;
  if (state == null) return undefined;
  switch (state.status) {
    case 'failed':
      return { tone: 'critical', text: 'Error', error: quoteTransformId(state.transform_id, state.failure_reason ?? '') };
    case 'finished':
      return { tone: 'healthy', text: 'Complete' };
    case 'init':
      return { tone: 'subdued', text: 'Initializing...' };
    case 'started':
      return { tone: 'healthy', text: 'Started' };
    case 'stopped':
      return { tone: 'pale', text: 'Stopped' };
    default:
      return undefined;
  }
}

// --- Changing a job --------------------------------------------------------------------------------

/** What the page that edits a job can change */
export interface TransformEdit {
  description: string;
  enabled: boolean;
  pageSize: number | undefined;
  interval: number | undefined;
  intervalTimeunit: string;
}

/** A job opened for editing; nothing for a job that does not run at intervals, which the page cannot change */
export function transformEditOf(transform: Transform): TransformEdit | undefined {
  const interval = transform.schedule?.interval;
  if (interval == null) return undefined;
  const period = Number(interval.period);
  return {
    description: transform.description ?? '',
    enabled: transform.enabled ?? false,
    pageSize: transform.page_size ?? undefined,
    interval: Number.isNaN(period) ? undefined : period,
    intervalTimeunit: interval.unit,
  };
}

/** The job as it was, with what the page changed, on a schedule that starts now */
export function editedTransform(transform: Transform, edit: TransformEdit, nowSeconds: number): { transform: Transform } {
  const { cron: _cron, ...schedule } = transform.schedule ?? {};
  return {
    transform: {
      ...transform,
      description: edit.description,
      enabled: edit.enabled,
      page_size: edit.pageSize ?? null,
      schedule: {
        ...schedule,
        interval: { start_time: nowSeconds, unit: edit.intervalTimeunit, period: edit.interval ?? null },
      },
    },
  };
}

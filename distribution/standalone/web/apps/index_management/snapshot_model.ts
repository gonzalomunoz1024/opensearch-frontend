/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Snapshot Management without the pages: how a schedule is read from a cron expression and
 * written as one, what is sent to register a repository, to take or restore a snapshot and to
 * keep a policy, how far a restore has come, and what the lists and the dialogs say.
 */

import { tokenizeFieldJson, type JsonRun } from '../management/saved_objects_lib';

// --- Words ------------------------------------------------------------------------------------------

/** A text cut to a length, the three dots counted in it */
export function truncate(text: string | undefined | null, length = 30): string {
  const value = text ?? '';
  if (value.length <= length) return value;
  return `${value.slice(0, Math.max(length - 3, 0))}...`;
}

export const capitalize = (text: string) =>
  text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();

// --- What a filter button writes into a search box -----------------------------------------------------

const fieldClause = (field: string) => new RegExp(`(^|\\s)${field}:(\\(([^)]*)\\)|"[^"]*"|\\S+)`);

/** The values a search names for a field: `type:(fs or s3)` */
export function fieldValues(search: string, field: string): string[] {
  const found = fieldClause(field).exec(search);
  if (!found) return [];
  const inner = found[3] ?? found[2];
  return inner
    .split(/\s+or\s+/i)
    .map((value) => value.trim().replace(/^"(.*)"$/, '$1'))
    .filter((value) => value !== '');
}

const quoted = (value: string) => (/^[\w.-]+$/.test(value) ? value : `"${value}"`);

/** A search with the values it names for a field replaced by others */
export function withFieldValues(search: string, field: string, values: string[]): string {
  const clause = values.length > 0 ? `${field}:(${values.map(quoted).join(' or ')})` : '';
  const pattern = fieldClause(field);
  if (pattern.test(search)) {
    return search
      .replace(pattern, (_all, before: string) => (clause ? `${before}${clause}` : ''))
      .replace(/\s{2,}/g, ' ')
      .trim();
  }
  if (!clause) return search;
  return search.trim() === '' ? clause : `${search.trim()} ${clause}`;
}

// --- Schedules ---------------------------------------------------------------------------------------

export type FrequencyType = 'hourly' | 'daily' | 'weekly' | 'monthly' | 'custom';

export const FREQUENCY_OPTIONS: Array<{ value: FrequencyType; label: string }> = [
  { value: 'hourly', label: 'Hourly' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'custom', label: 'Custom (Cron expression)' },
];

export const WEEK_DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

export interface CronParts {
  minute: number;
  hour: number;
  dayOfWeek: string;
  dayOfMonth: number;
  frequencyType: FrequencyType;
}

const isNumber = (value: string | undefined) => !Number.isNaN(parseInt(value ?? '', 10));

/** What a cron expression says, as far as the form can show it; anything else is "custom" */
export function parseCron(expression: string | undefined | null): CronParts {
  const parts: CronParts = {
    minute: 0,
    hour: 20,
    dayOfWeek: 'SUN',
    dayOfMonth: 1,
    frequencyType: 'custom',
  };
  if (!expression) return parts;
  const [minute, hour, day, month, weekDay] = expression.split(' ');
  if (isNumber(minute) && isNumber(hour)) {
    parts.minute = parseInt(minute, 10);
    parts.hour = parseInt(hour, 10);
    if (isNumber(day) && month === '*' && weekDay === '*') {
      parts.frequencyType = 'monthly';
      parts.dayOfMonth = parseInt(day, 10);
    }
    if (day === '*' && month === '*' && (isNumber(weekDay) || WEEK_DAYS.includes(weekDay))) {
      parts.frequencyType = 'weekly';
      parts.dayOfWeek = isNumber(weekDay) ? ['SUN', ...WEEK_DAYS][parseInt(weekDay, 10)] : weekDay;
    }
    if (day === '*' && month === '*' && weekDay === '*') parts.frequencyType = 'daily';
  }
  if (isNumber(minute)) {
    parts.minute = parseInt(minute, 10);
    if (hour === '*' && day === '*' && month === '*' && weekDay === '*')
      parts.frequencyType = 'hourly';
  }
  return parts;
}

/** The cron expression of what the form shows; a custom one is what was typed */
export function buildCron(parts: CronParts, expression: string): string {
  const { minute, hour } = parts;
  if (parts.frequencyType === 'hourly') return `${minute} * * * *`;
  if (parts.frequencyType === 'daily') return `${minute} ${hour} * * *`;
  if (parts.frequencyType === 'weekly') return `${minute} ${hour} * * ${parts.dayOfWeek}`;
  if (parts.frequencyType === 'monthly') return `${minute} ${hour} ${parts.dayOfMonth} * *`;
  return expression;
}

/** An expression after something of it was changed in the form */
export function changeCron(
  expression: string | undefined | null,
  frequencyType: FrequencyType,
  change: Partial<CronParts> = {}
): string {
  return buildCron({ ...parseCron(expression), frequencyType, ...change }, expression ?? '');
}

/** 20, 5 → "8:05 pm" */
export function clockTime(hour: number, minute: number): string {
  const half = hour % 12 === 0 ? 12 : hour % 12;
  return `${half}:${String(minute).padStart(2, '0')} ${hour % 24 < 12 ? 'am' : 'pm'}`;
}

/** 20, 5 → "20:05" */
export const dayTime = (hour: number, minute: number) =>
  `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

/** "7:5", "07:05" → the hour and the minute; nothing for what is no time of day */
export function parseDayTime(text: string): { hour: number; minute: number } | undefined {
  const found = /^\s*(\d{1,2}):(\d{1,2})\s*$/.exec(text);
  if (!found) return undefined;
  const hour = Number(found[1]);
  const minute = Number(found[2]);
  return hour < 24 && minute < 60 ? { hour, minute } : undefined;
}

/** The times of day a start time is picked from: every half hour */
export const HALF_HOURS: string[] = Array.from({ length: 48 }, (_, index) =>
  dayTime(Math.floor(index / 2), (index % 2) * 30)
);

/** "+05:30": how far a time zone is from UTC at a moment; nothing for a name the browser does not know */
export function zoneOffset(zone: string, at: Date = new Date()): string {
  try {
    const name =
      new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' })
        .formatToParts(at)
        .find((part) => part.type === 'timeZoneName')?.value ?? '';
    const found = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(name);
    if (found) return `${found[1]}${found[2].padStart(2, '0')}:${found[3] ?? '00'}`;
    return name === 'GMT' ? '+00:00' : '';
  } catch {
    return '';
  }
}

/** A schedule in words: "MON, 8:00 pm (UTC)", "Day 3, 8:00 pm (UTC)", or the expression itself */
export function humanCron(expression: string | undefined | null, timezone: string): string {
  const parts = parseCron(expression);
  if (parts.frequencyType === 'custom') return `${expression ?? ''} (${timezone})`;
  const time = `${clockTime(parts.hour, parts.minute)} (${timezone})`;
  if (parts.frequencyType === 'monthly') return `Day ${parts.dayOfMonth}, ${time}`;
  if (parts.frequencyType === 'weekly') return `${parts.dayOfWeek}, ${time}`;
  return time;
}

// --- Repositories --------------------------------------------------------------------------------------

export interface Repository {
  id: string;
  type: string;
  snapshotCount: number;
}

export type RepositoryKind = 'fs' | 'custom';

export const REPOSITORY_KINDS: Array<{ value: RepositoryKind; label: string }> = [
  { value: 'fs', label: 'Shared file system' },
  { value: 'custom', label: 'Custom configuration' },
];

export const FS_SETTINGS_TEXT = JSON.stringify(
  {
    chunk_size: null,
    compress: false,
    max_restore_bytes_per_sec: '40m',
    max_snapshot_bytes_per_sec: '40m',
    readonly: false,
  },
  null,
  4
);

export const CUSTOM_CONFIGURATION_TEXT = JSON.stringify(
  { type: 's3', settings: { bucket: '<bucket_name>', base_path: '<bucket_base_path>' } },
  null,
  4
);

export interface RepositoryBody {
  type: unknown;
  settings: unknown;
}

/** What registers a repository; nothing when the settings are not JSON */
export function repositoryBody(
  kind: RepositoryKind,
  location: string,
  text: string
): RepositoryBody | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== 'object') return undefined;
  if (kind === 'fs') return { type: 'fs', settings: { ...parsed, location } };
  const { type, settings } = parsed as { type?: unknown; settings?: unknown };
  return { type, settings };
}

// Where the indent of a line ends, as the original editor looks for it
const INDENT_END = /\s\S| \t|\t |\s$/;
/** The tab of the editor the plugin shows a repository's settings in: four spaces */
const SETTINGS_TAB = 4;

/**
 * JSON as the plugin's editor colours it, line by line: the runs of the original editor's JSON
 * mode, and a guide for each full tab of an indent before its last space. The runs come with
 * guides every two spaces, the tab of the editor they were made for; here it is four.
 */
export function settingsTokens(text: string): JsonRun[][] {
  return tokenizeFieldJson(text).map((runs) => {
    const rest = [...runs];
    let indent = '';
    while (rest[0]?.kind === 'Guide') indent += rest.shift()?.text ?? '';
    if (rest[0] && !rest[0].kind) indent += rest.shift()?.text ?? '';
    if (indent === '') return runs;
    let columns = indent.startsWith(' ') ? Math.max(indent.search(INDENT_END), 0) : 0;
    columns -= columns % SETTINGS_TAB;
    const guides: JsonRun[] = Array.from({ length: columns / SETTINGS_TAB }, () => ({
      text: ' '.repeat(SETTINGS_TAB),
      kind: 'Guide',
    }));
    const left = indent.slice(columns);
    return [...guides, ...(left ? [{ text: left }] : []), ...rest];
  });
}

/** What the dialog that deletes repositories adds to its question: how much would go with them */
export function snapshotCountsWarning(repositories: Repository[]): string {
  const counts = repositories.map((repository) => repository.snapshotCount).join(', ');
  const where =
    repositories.length > 1 ? ' in these repositories respectively.' : ' in the repository.';
  return `You have ${counts} snapshots${where}`;
}

// --- Snapshots -------------------------------------------------------------------------------------------

export interface SnapshotRow {
  id: string;
  status: string;
  start_epoch?: number;
  end_epoch?: number;
  repository: string;
  policy?: string;
  [more: string]: unknown;
}

export const snapshotRowId = (row: SnapshotRow) => `${row.repository}:${row.id}`;

/** "IN_PROGRESS" → "In progress" */
export const snapshotStatusText = (status: string) => capitalize(status.replace('_', ' '));

export type StatusTone = 'healthy' | 'accent' | 'warning' | 'critical';

export function snapshotStatusTone(status: string): StatusTone {
  // The words are compared as the plugin writes them: an underscore has become a space by then
  const text = snapshotStatusText(status);
  if (text === 'Failed') return 'warning';
  if (text === 'Partial') return 'critical';
  return 'healthy';
}

/** The values a column holds, each once, for the buttons that filter by them */
export function distinct(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

export interface SnapshotBody {
  indices: string;
  ignore_unavailable: boolean;
  include_global_state: boolean;
  partial: boolean;
}

export const emptySnapshot = (): SnapshotBody => ({
  indices: '',
  ignore_unavailable: false,
  include_global_state: false,
  partial: false,
});

export const SNAPSHOT_NAME_HELP =
  'A valid snapshot name must not start with _ and must be lowercase. It must not contain any of the following characters: [\\] [/] [*] [?] ["] [<] [>] [|] [ ] [,] [ ] [#]';

/** Why a snapshot cannot be restored yet: one that failed, one that is still being taken */
export function notRestorable(row: SnapshotRow): { title: string; text: string } | undefined {
  if (row.status !== 'FAILED' && row.status !== 'IN_PROGRESS') return undefined;
  return {
    title: `${row.id} is not available for restore`,
    text:
      row.status === 'IN_PROGRESS'
        ? 'This snapshot is still being created. Try again once the snapshot has been completed.'
        : 'This shapshot is incomplete. Pick another snapshot to restore.',
  };
}

/** The sentence of a failure of OpenSearch that the notices of the list repeat */
export function failureSentence(error: string | undefined): string {
  try {
    const reason = String(
      (JSON.parse(error ?? '') as { error: { root_cause: Array<{ reason: string }> } }).error
        .root_cause[0].reason
    );
    return reason.slice(reason.indexOf(']') + 1, reason.indexOf('.') + 1);
  } catch {
    return error ?? '';
  }
}

// --- Restoring -------------------------------------------------------------------------------------------

export type RenameOption = 'do_not_rename' | 'add_prefix' | 'rename_indices';

export interface RestoreForm {
  /** The indices of the snapshot */
  all: string[];
  restoreSpecific: boolean;
  selected: string[];
  rename: RenameOption;
  prefix: string;
  renamePattern: string;
  renameReplacement: string;
  restoreAliases: boolean;
  includeGlobalState: boolean;
  ignoreUnavailable: boolean;
  partial: boolean;
  /** Empty when the settings are not customized */
  customIndexSettings: string;
  /** Empty when no setting is ignored */
  ignoreIndexSettings: string;
}

export const newRestoreForm = (snapshot: {
  indices?: string[];
  include_global_state?: boolean;
}): RestoreForm => ({
  all: snapshot.indices ?? [],
  restoreSpecific: false,
  selected: [],
  rename: 'add_prefix',
  prefix: 'restored_',
  renamePattern: '(.+)',
  renameReplacement: 'restored_$1',
  restoreAliases: true,
  includeGlobalState: Boolean(snapshot.include_global_state),
  ignoreUnavailable: false,
  partial: false,
  customIndexSettings: '',
  ignoreIndexSettings: '',
});

export interface RestoreErrors {
  badPattern: boolean;
  badRename: boolean;
  badJSON: boolean;
  badIgnore: boolean;
  noIndicesSelected: boolean;
}

const isJSON = (text: string) => {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
};

const isPattern = (text: string) => {
  try {
    new RegExp(text);
    return true;
  } catch {
    return false;
  }
};

/** A setting that is both given a value and left out cannot be either */
function settingsConflict(custom: string, ignored: string): boolean {
  if (custom.length === 0 || !isJSON(custom)) return false;
  const settings: unknown = JSON.parse(custom);
  if (settings === null || typeof settings !== 'object') return false;
  return Object.keys(settings).some((setting) => ignored.includes(setting));
}

/** What is wrong with a restore as it is asked for */
export function restoreErrors(form: RestoreForm): RestoreErrors {
  const renames = form.rename === 'rename_indices';
  return {
    badPattern: renames && !isPattern(form.renamePattern),
    badRename: renames && !form.renameReplacement.includes('$'),
    badJSON: form.customIndexSettings.length > 0 && !isJSON(form.customIndexSettings),
    badIgnore:
      form.ignoreIndexSettings.length > 0 &&
      settingsConflict(form.customIndexSettings, form.ignoreIndexSettings),
    noIndicesSelected: form.restoreSpecific && form.selected.length === 0,
  };
}

export const hasRestoreErrors = (errors: RestoreErrors) => Object.values(errors).some(Boolean);

export const RESTORE_FIELDS_ERROR =
  'One or more fields have an error.  Please check and try again.';
export const RESTORE_CONFLICT_TITLE = 'Cannot apply and ignore the same index settings';
export const RESTORE_CONFLICT_TEXT =
  'One or more index settings was declared in both Custom index settings and Ignore index settings. Remove the index setting from either fields.';

/** The indices a restore names */
export const restoredIndices = (form: RestoreForm): string[] =>
  form.restoreSpecific ? form.selected : form.all;

/** What is sent to restore; the keys are in the order the plugin sends them */
export function restoreBody(form: RestoreForm): Record<string, unknown> {
  const body: Record<string, unknown> = { indices: restoredIndices(form).join(',') };
  if (form.customIndexSettings.length > 0)
    body.index_settings = JSON.parse(form.customIndexSettings);
  if (form.ignoreIndexSettings.length > 0) body.ignore_index_settings = form.ignoreIndexSettings;
  body.ignore_unavailable = form.ignoreUnavailable;
  body.include_global_state = form.includeGlobalState;
  if (form.rename === 'add_prefix') {
    body.rename_pattern = '(.+)';
    body.rename_replacement = `${form.prefix}$1`;
  } else if (form.rename === 'rename_indices') {
    body.rename_pattern = form.renamePattern;
    body.rename_replacement = form.renameReplacement;
  }
  body.include_aliases = form.restoreAliases;
  body.partial = form.partial;
  return body;
}

/** What the notice of a failed restore says */
export function restoreFailureText(error: string | undefined): string {
  const text = error ?? '';
  const hint = text.includes('open index with same name')
    ? 'You have an index with the same name. Try a different prefix.'
    : '';
  return `${hint} ${text}`;
}

// --- How far a restore has come ----------------------------------------------------------------------------

const STAGES = ['START', 'INIT', 'INDEX', 'VERIFY_INDEX', 'TRANSLOG', 'FINALIZE', 'DONE'];
const STAGE_WORDS: Record<string, string> = {
  START: 'Starting',
  INIT: 'Initializing',
  INDEX: 'Copying',
  VERIFY_INDEX: 'Verifying',
  TRANSLOG: 'Replaying translog',
  FINALIZE: 'Cleaning up',
  DONE: 'Completed',
};

export interface RecoveryShard {
  stage?: string;
  start_time_in_millis?: number;
  stop_time_in_millis?: number;
  source?: { index?: string; snapshot?: string };
}

export type Recovery = Record<string, { shards?: RecoveryShard[] }>;

export interface RestoreProgress {
  indices: Array<{ index: string; restore_status: string }>;
  /** 0 while nothing of the restore has begun */
  startTime: number;
  stopTime: number;
  /** "Copying (50%)", "Copying (0%)" before anything recovers; nothing for a stage it has no word for */
  stage?: string;
}

/**
 * What the recoveries of the cluster say of a restore: the indices that came out of the snapshot
 * since it was asked for, the earliest stage any recovery is at, and the share that is done.
 */
export function restoreProgress(
  recovery: Recovery,
  snapshotId: string,
  startedAt: number,
  indicesToRestore: string[],
  now: number
): RestoreProgress {
  let startTime = 0;
  let stopTime = 0;
  let stageIndex = STAGES.length - 1;
  let done = 0;
  const last = STAGES.length - 1;
  const indices: RestoreProgress['indices'] = [];
  for (const [name, item] of Object.entries(recovery)) {
    const shard = item.shards?.[0];
    if (name.includes('kibana') || !shard || !((shard.start_time_in_millis ?? 0) >= startedAt))
      continue;
    const stage = STAGES.indexOf(shard.stage ?? '');
    const began = shard.start_time_in_millis ?? 0;
    const ended = shard.stop_time_in_millis ? shard.stop_time_in_millis : now;
    if (stage === last) done += 1;
    if (stage < stageIndex) stageIndex = stage;
    stopTime = stopTime && stopTime > ended ? stopTime : ended;
    if (shard.source?.index && shard.source.snapshot === snapshotId) {
      startTime = startTime && startTime < began ? startTime : began;
      indices.push({ index: shard.source.index, restore_status: STAGE_WORDS[shard.stage ?? ''] });
    }
  }
  const started = indices.map((item) => item.index);
  for (const index of indicesToRestore) {
    if (!started.includes(index)) indices.push({ index, restore_status: 'Pending' });
  }
  const percent = Math.floor((done / indicesToRestore.length) * 100);
  let stage: string | undefined;
  if (STAGES[stageIndex]) {
    const shown = stageIndex === last && done < indicesToRestore.length ? 2 : stageIndex;
    stage = `${STAGE_WORDS[STAGES[shown]]} (${percent}%)`;
  }
  return { indices, startTime, stopTime, stage };
}

export const RESTORE_DONE = 'Completed (100%)';

/** "Copying (50%)" → "Failed (50%)" */
export const failedStage = (stage: string) => `Failed ${stage.slice(stage.indexOf('('))}`;

export function stageTone(stage: string): StatusTone {
  const word = stage.slice(0, stage.indexOf(' '));
  if (word === 'Completed') return 'healthy';
  return word === 'Failed' ? 'critical' : 'warning';
}

export const indexCountText = (count: number) => (count === 1 ? '1 Index' : `${count} Indices`);

/** A moment as the list of restores writes it: "11/22/2026  5:29:01 PM" */
export const restoreTime = (time: number) => new Date(time).toLocaleString().replace(',', '  ');

// --- Snapshot policies -----------------------------------------------------------------------------------

export interface CronSchedule {
  cron?: { expression?: string; timezone?: string };
}

export interface SMPolicy {
  name?: string;
  description?: string;
  enabled?: boolean;
  last_updated_time?: number;
  creation?: { schedule?: CronSchedule };
  deletion?: {
    schedule?: CronSchedule;
    condition?: { max_age?: string; min_count?: number; max_count?: number };
  };
  snapshot_config?: {
    repository?: string;
    indices?: string;
    include_global_state?: boolean | string;
    ignore_unavailable?: boolean | string;
    partial?: boolean | string;
    [more: string]: unknown;
  };
  notification?: {
    channel?: { id?: string };
    conditions?: { creation?: boolean; deletion?: boolean; failure?: boolean };
  };
  [more: string]: unknown;
}

export const defaultPolicy = (): SMPolicy => ({
  name: '',
  description: '',
  enabled: true,
  creation: { schedule: { cron: { expression: '0 20 * * *', timezone: 'UTC' } } },
  snapshot_config: { repository: '' },
});

export const POLICY_ERRORS = {
  NAME: 'Name must be provided.',
  REPO: 'Repository must be provided.',
  TIMEZONE: 'Time zone must be provided.',
};

export const MAX_AGE_UNITS = [
  { value: 'd', label: 'Days' },
  { value: 'h', label: 'Hours' },
];

type Nested = Record<string, unknown>;

/** A copy with the value at a path of keys set; what is on the way and missing is made */
export function setAt<T extends object>(target: T, path: string, value: unknown): T {
  const [first, ...rest] = path.split('.');
  const copy: Nested = { ...(target as Nested) };
  if (rest.length === 0) {
    copy[first] = value;
  } else {
    const inner = copy[first];
    copy[first] = setAt(
      inner !== null && typeof inner === 'object' ? inner : {},
      rest.join('.'),
      value
    );
  }
  return copy as T;
}

export function getAt(target: unknown, path: string): unknown {
  let at: unknown = target;
  for (const key of path.split('.')) {
    if (at === null || typeof at !== 'object') return undefined;
    at = (at as Nested)[key];
  }
  return at;
}

/** A switch of a policy, whether OpenSearch keeps it as a truth value or as a word */
export const isOn = (policy: SMPolicy | undefined | null, path: string): boolean =>
  String(getAt(policy, path) ?? false) === 'true';

export const NOTIFY_PATHS = {
  creation: 'notification.conditions.creation',
  deletion: 'notification.conditions.deletion',
  failure: 'notification.conditions.failure',
};

/** Whether a policy tells anybody of anything */
export const notifies = (policy: SMPolicy | undefined | null): boolean =>
  Object.values(NOTIFY_PATHS).some((path) => isOn(policy, path));

/** What of a policy the form keeps beside the policy itself */
export interface PolicyForm {
  creationFrequency: FrequencyType;
  deletionFrequency: FrequencyType;
  /** The policy only deletes snapshots: it has no schedule to take them */
  deletionOnly: boolean;
  retention: boolean;
  /** Snapshots are deleted on a schedule of its own */
  deletionSchedule: boolean;
  maxAgeNumber: number;
  maxAgeUnit: string;
}

export const newPolicyForm = (): PolicyForm => ({
  creationFrequency: 'daily',
  deletionFrequency: 'daily',
  deletionOnly: false,
  retention: false,
  deletionSchedule: false,
  maxAgeNumber: 1,
  maxAgeUnit: 'd',
});

/** The form of a policy that is there already */
export function policyFormOf(policy: SMPolicy): PolicyForm {
  const creation = policy.creation?.schedule?.cron?.expression;
  const deletion = policy.deletion?.schedule?.cron?.expression;
  const maxAge = policy.deletion?.condition?.max_age;
  return {
    creationFrequency: parseCron(creation).frequencyType,
    deletionFrequency: parseCron(deletion).frequencyType,
    deletionOnly: policy.creation === undefined || policy.creation === null,
    retention: Boolean(policy.deletion),
    deletionSchedule: Boolean(policy.deletion) && creation !== deletion,
    maxAgeNumber: maxAge ? parseInt(maxAge.substring(0, maxAge.length - 1), 10) : 1,
    maxAgeUnit: maxAge ? maxAge[maxAge.length - 1] : 'd',
  };
}

/** The indices a policy names, one by one */
export const policyIndices = (policy: SMPolicy): string[] =>
  (policy.snapshot_config?.indices ?? '').split(',').filter((index) => index !== '');

/** The policy as it is sent: what the form switched off is left out of it */
export function buildPolicy(policy: SMPolicy, form: PolicyForm): SMPolicy {
  let built: SMPolicy = { ...policy };
  if (form.deletionOnly) delete built.creation;
  if (form.retention) {
    built = setAt(built, 'deletion.condition.max_age', `${form.maxAgeNumber}${form.maxAgeUnit}`);
  } else {
    delete built.deletion;
  }
  if (form.deletionSchedule) {
    if (!form.deletionOnly && built.deletion) {
      built = setAt(
        built,
        'deletion.schedule.cron.timezone',
        getAt(built, 'creation.schedule.cron.timezone')
      );
    }
  } else if (built.deletion) {
    const { schedule: _schedule, ...deletion } = built.deletion;
    built.deletion = deletion;
  }
  if (!notifies(built)) delete built.notification;
  return built;
}

/** What is missing before a policy can be saved, the first thing only */
export function policyError(
  policyId: string,
  policy: SMPolicy,
  form: PolicyForm
): { field: 'name' | 'repository' | 'timezone'; text: string } | undefined {
  if (!policyId.trim()) return { field: 'name', text: POLICY_ERRORS.NAME };
  if (!policy.snapshot_config?.repository) return { field: 'repository', text: POLICY_ERRORS.REPO };
  if (!form.deletionOnly && !policy.creation?.schedule?.cron?.timezone) {
    return { field: 'timezone', text: POLICY_ERRORS.TIMEZONE };
  }
  return undefined;
}

/** What the list of policies shows, as its address tells it */
export interface PolicyListQuery {
  from: number;
  size: number;
  sortField: string;
  sortOrder: 'asc' | 'desc';
  queryString: string;
}

export function policyListQuery(params: Record<string, string | undefined>): PolicyListQuery {
  const number = (text: string | undefined, fallback: number) => {
    const value = parseInt(text ?? '', 10);
    return Number.isNaN(value) ? fallback : value;
  };
  return {
    from: number(params.from, 0),
    size: number(params.size, 20),
    sortField: params.sortField ?? 'name',
    sortOrder: params.sortOrder === 'asc' ? 'asc' : 'desc',
    queryString: params.queryString ?? '',
  };
}

/** The address of that, its names in the order of the alphabet as the plugin writes them */
export const policyListParams = (query: PolicyListQuery): Record<string, string> => ({
  from: String(query.from),
  queryString: query.queryString,
  size: String(query.size),
  sortField: query.sortField,
  sortOrder: query.sortOrder,
});

/** How many snapshots a policy keeps at least or at most; a line where it does not say */
export const retainedCount = (count: number | undefined | null): string =>
  count === undefined || count === null ? '-' : String(count);

export const MIN_COUNT_ERROR = 'Min count should be bigger than 0.';

/** What is wrong with the least number of snapshots to keep */
export const minCountError = (count: number | undefined): string =>
  !count || count < 1 ? MIN_COUNT_ERROR : '';

/** A count typed into a field: nothing for what is no number */
export const countOf = (text: string): number | undefined => {
  const value = parseInt(text, 10);
  return Number.isNaN(value) ? undefined : value;
};

export interface PolicyMetadata {
  creation?: { trigger?: { time?: number }; latest_execution?: Activity };
  deletion?: { trigger?: { time?: number }; latest_execution?: Activity };
}

export interface Activity {
  activityType?: string;
  status?: string;
  start_time?: number;
  end_time?: number;
  info?: { message?: string; cause?: string };
}

/** The last time a policy took snapshots and, when it has, the last time it deleted some */
export function latestActivities(metadata: PolicyMetadata | undefined | null): Activity[] {
  const activities: Activity[] = [
    { activityType: 'Creation', ...metadata?.creation?.latest_execution },
  ];
  const deletion = metadata?.deletion?.latest_execution;
  if (deletion !== undefined && deletion !== null)
    activities.push({ activityType: 'Deletion', ...deletion });
  return activities;
}

/** The word of an activity that opens what there is to know of it */
export function activityInfoWord(info: Activity['info']): string {
  if (info?.cause) return 'cause';
  if (info?.message) return 'message';
  return '-';
}

/** The activities a policy tells of: "creation, failure", or "None" */
export function notifiedActivities(policy: SMPolicy): string {
  const conditions = policy.notification?.conditions;
  if (!conditions) return 'None';
  return Object.entries(conditions)
    .filter(([, on]) => on)
    .map(([name]) => name)
    .join(', ');
}

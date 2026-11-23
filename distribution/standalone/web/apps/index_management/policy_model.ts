/* SPDX-License-Identifier: Apache-2.0 */

/*
 * A state management policy without its pages: what its states, actions and transitions are
 * called, what a new one starts as, which are complete enough to be saved, and where a state
 * goes when it is added before or after another.
 */

import type { CodeToken } from '../../components/code_editor';
import { tokenizeJson } from '../../lib/json_text';

export interface Transition {
  state_name: string;
  conditions?: {
    min_index_age?: string;
    min_doc_count?: number;
    min_size?: string;
    min_rollover_age?: string;
    cron?: { cron: { expression: string; timezone: string } };
  };
}

/** One operation of a state: its kind is the one key that is not `timeout` or `retry` */
export type Action = Record<string, unknown>;

export interface State {
  name: string;
  actions?: Action[];
  transitions?: Transition[];
}

export interface IsmTemplate {
  index_patterns: string[];
  priority?: number;
}

export interface ErrorNotification {
  channel?: { id: string };
  destination?: unknown;
  message_template?: { source?: string; lang?: string };
}

export interface Policy {
  description?: string;
  default_state: string;
  states: State[];
  ism_template?: IsmTemplate | IsmTemplate[] | null;
  error_notification?: ErrorNotification | null;
  last_updated_time?: number;
  [more: string]: unknown;
}

export interface PolicyDocument {
  id: string;
  seqNo: number;
  primaryTerm: number;
  policy: Policy;
}

/** What the JSON editor starts a new policy as */
export const DEFAULT_POLICY_JSON = JSON.stringify(
  {
    policy: {
      description: 'A simple default policy that changes the replica count between hot and cold states.',
      default_state: 'example_hot_state',
      states: [
        {
          name: 'example_hot_state',
          actions: [{ replica_count: { number_of_replicas: 5 } }],
          transitions: [{ state_name: 'example_cold_state', conditions: { min_index_age: '30d' } }],
        },
        { name: 'example_cold_state', actions: [{ replica_count: { number_of_replicas: 2 } }], transitions: [] },
      ],
      ism_template: { index_patterns: ['example-index-*'] },
    },
  },
  null,
  4
);

/** What the visual editor starts a new policy as */
export const EMPTY_POLICY: Policy = {
  description: 'A sample description of the policy',
  default_state: '',
  states: [],
  ism_template: [],
};

/** The templates of a policy, which may hold one, several or none */
export function templatesOf(templates: Policy['ism_template']): IsmTemplate[] {
  if (Array.isArray(templates)) return templates;
  return templates ? [templates] : [];
}

// --- Actions ---------------------------------------------------------------------------------------

/** The kinds of action, in the order the editor offers them */
export const ACTION_DEFAULTS: Record<string, Action> = {
  alias: { alias: { actions: [] } },
  allocation: { allocation: { require: {}, include: {}, exclude: {}, wait_for: false } },
  close: { close: {} },
  convert_index_to_remote: {
    convert_index_to_remote: {
      repository: 'example-repository',
      snapshot: 'example-snapshot',
      include_aliases: false,
      ignore_index_settings: '',
      delete_original_index: false,
      rename_pattern: '$1_remote',
    },
  },
  delete: { delete: {} },
  force_merge: { force_merge: { max_num_segments: 1 } },
  index_priority: { index_priority: { priority: 1 } },
  notification: { notification: { channel: { id: '' }, message_template: { source: '' } } },
  open: { open: {} },
  read_only: { read_only: {} },
  read_write: { read_write: {} },
  replica_count: { replica_count: { number_of_replicas: 1 } },
  rollover: { rollover: { min_doc_count: 5 } },
  rollup: {
    rollup: {
      ism_rollup: {
        target_index: 'rollup-nyc-taxi-data',
        description: 'Example rollup job',
        page_size: 200,
        dimensions: [
          {
            date_histogram: {
              source_field: 'tpep_pickup_datetime',
              fixed_interval: '1h',
              timezone: 'America/Los_Angeles',
            },
          },
          { terms: { source_field: 'PULocationID' } },
        ],
        metrics: [
          {
            source_field: 'passenger_count',
            metrics: [{ avg: {} }, { sum: {} }, { max: {} }, { min: {} }, { value_count: {} }],
          },
        ],
      },
    },
  },
  shrink: {
    shrink: {
      percentage_of_source_shards: 0.5,
      force_unsafe: false,
      target_index_name_template: { source: '{{ctx.index}}_shrunken' },
    },
  },
  snapshot: { snapshot: { repository: 'example-repository', snapshot: 'example-snapshot' } },
};

const ALIAS_ACTION_TEXT = 'Add / remove aliases';

/** The kinds of action as the editor's list names them */
export const ACTION_OPTIONS = Object.keys(ACTION_DEFAULTS).map((value) => ({
  value,
  label:
    value === 'alias'
      ? ALIAS_ACTION_TEXT
      : value
          .split('_')
          .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' '),
}));

export function actionType(action: Action): string | undefined {
  return Object.keys(action)
    .filter((key) => key !== 'timeout' && key !== 'retry')
    .pop();
}

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};

/** What a state says an action of its own does */
export function actionContent(action: Action): string {
  const type = actionType(action);
  const settings = record(type ? action[type] : undefined);
  switch (type) {
    case 'alias':
      return ALIAS_ACTION_TEXT;
    case 'allocation':
      return 'Allocation';
    case 'close':
      return 'Close';
    case 'convert_index_to_remote':
      return 'Convert index to remote';
    case 'delete':
      return 'Delete';
    case 'force_merge':
      return `Force merge to ${settings.max_num_segments} segments`;
    case 'index_priority':
      return `Set index priority to ${settings.priority}`;
    case 'notification':
      return 'Notification';
    case 'open':
      return 'Open';
    case 'read_only':
      return 'Read only';
    case 'read_write':
      return 'Read write';
    case 'replica_count':
      return `Set number of replicas to ${settings.number_of_replicas}`;
    case 'rollover':
      return 'Rollover';
    case 'rollup':
      return 'Rollup';
    case 'shrink':
      return 'Shrink';
    case 'snapshot':
      return 'Snapshot';
    default:
      // A kind the editor has no form for is named as it is written
      return (type ?? 'Action').replace(/_/g, ' ').replace(/^./, (letter) => letter.toUpperCase());
  }
}

const isNumber = (value: unknown): value is number => typeof value === 'number' && !Number.isNaN(value);

/** The aliases an alias action adds and removes */
export function aliasesOf(action: Action): { add: string[]; remove: string[] } {
  const found = { add: [] as string[], remove: [] as string[] };
  const actions = record(action.alias).actions;
  for (const item of Array.isArray(actions) ? actions : []) {
    for (const kind of ['add', 'remove'] as const) {
      const entry = record(record(item)[kind]);
      if (typeof entry.alias === 'string') found[kind].push(entry.alias);
      if (Array.isArray(entry.aliases)) found[kind].push(...entry.aliases.map(String));
    }
  }
  return found;
}

export const ALIAS_PATTERN = /^(?![_\-+])(?!.*\.\.)[^\s,\\/*?"<>|#:.]{1,255}$/;
export const ALIAS_MESSAGE =
  'An alias must be 1-255 characters long, cannot be ".", or "..", cannot start with _, -, or +, and cannot contain spaces, commas, \\, /, *, ?, ", <, >, |, #, or :.';
export const DUPLICATED_ALIAS_TEXT = 'An alias cannot be added and removed in the same action.';

/** What is wrong with the aliases an action adds and with those it removes */
export function aliasErrors(action: Action): { add?: string; remove?: string } {
  const { add, remove } = aliasesOf(action);
  const errorOf = (names: string[], others: string[]) => {
    let error: string | undefined;
    for (const name of names) {
      if (name && !ALIAS_PATTERN.test(name)) error = ALIAS_MESSAGE;
      else if (others.includes(name)) error = DUPLICATED_ALIAS_TEXT;
      else error = undefined;
    }
    return error;
  };
  return { add: errorOf(add, remove), remove: errorOf(remove, add) };
}

/** Whether an action says enough to be added to a state */
export function actionIsValid(action: Action): boolean {
  const type = actionType(action);
  const settings = record(type ? action[type] : undefined);
  switch (type) {
    case 'alias': {
      const errors = aliasErrors(action);
      const actions = settings.actions;
      return Array.isArray(actions) && actions.length > 0 && !errors.add && !errors.remove;
    }
    case 'convert_index_to_remote': {
      const pattern = (typeof settings.rename_pattern === 'string' ? settings.rename_pattern : '$1_remote').trim();
      const replicas = settings.number_of_replicas;
      return (
        Boolean(settings.snapshot) &&
        Boolean(settings.repository) &&
        pattern.length > 0 &&
        pattern.includes('$1') &&
        (replicas === undefined || (isNumber(replicas) && replicas >= 0))
      );
    }
    case 'force_merge':
      return isNumber(settings.max_num_segments) && settings.max_num_segments > 0;
    case 'index_priority':
      return isNumber(settings.priority) && settings.priority >= 0;
    case 'replica_count':
      return isNumber(settings.number_of_replicas) && settings.number_of_replicas >= 0;
    case 'rollover':
      return settings.min_doc_count === undefined || (isNumber(settings.min_doc_count) && settings.min_doc_count > 0);
    case 'shrink':
      return (
        [settings.num_new_shards, settings.percentage_of_source_shards, settings.max_shard_size].filter(
          (value) => value !== undefined && value !== null
        ).length === 1
      );
    case 'snapshot':
      return Boolean(settings.snapshot) && Boolean(settings.repository);
    default:
      return type !== undefined;
  }
}

// --- Transitions -------------------------------------------------------------------------------------

export const CONDITION_OPTIONS = [
  { value: 'none', label: 'No condition' },
  { value: 'min_index_age', label: 'Minimum index age' },
  { value: 'min_doc_count', label: 'Minimum doc count' },
  { value: 'min_size', label: 'Minimum size' },
  { value: 'min_rollover_age', label: 'Minimum rollover age' },
  { value: 'cron', label: 'Cron expression' },
];

/** What a condition starts as when its kind is chosen */
export function conditionsOf(kind: string): Transition['conditions'] {
  switch (kind) {
    case 'min_index_age':
      return { min_index_age: '30d' };
    case 'min_doc_count':
      return { min_doc_count: 1000000 };
    case 'min_size':
      return { min_size: '50gb' };
    case 'min_rollover_age':
      return { min_rollover_age: '7d' };
    case 'cron':
      return { cron: { cron: { expression: '* 17 * * SAT', timezone: 'America/Los_Angeles' } } };
    default:
      return undefined;
  }
}

export const conditionKind = (transition: Transition): string =>
  Object.keys(transition.conditions ?? {}).pop() ?? 'none';

/** What a state says about when it moves on */
export function conditionContent(transition: Transition): string {
  const conditions = transition.conditions ?? {};
  if (conditions.min_size != null) return `Minimum index size is ${conditions.min_size}`;
  if (conditions.min_doc_count != null) return `Minimum index doc count is ${conditions.min_doc_count}`;
  if (conditions.min_index_age != null) return `Minimum index age is ${conditions.min_index_age}`;
  if (conditions.min_rollover_age != null) return `Minimum rollover age is ${conditions.min_rollover_age}`;
  if (conditions.cron != null) {
    return `After cron expression "${conditions.cron.cron.expression}" in ${conditions.cron.cron.timezone}`;
  }
  return 'No condition';
}

// --- Where a state goes -------------------------------------------------------------------------------

export type Order = 'after' | 'before';

/** Where the editor proposes to put a state: after the last one, or where the edited one is */
export function orderInfo(state: State | undefined, states: State[]) {
  let afterBeforeState = '';
  let order: Order = 'after';
  let disableOrderSelections = false;
  if (state) {
    const index = states.indexOf(state);
    if (states.length === 1) disableOrderSelections = true;
    else if (index === 0) {
      afterBeforeState = states[1]?.name ?? '';
      order = 'before';
    } else afterBeforeState = states[index - 1]?.name ?? '';
  } else if (states.length === 0) disableOrderSelections = true;
  else afterBeforeState = states[states.length - 1].name;
  return { order, afterBeforeState, disableOrderSelections };
}

export function updatedStates(
  state: State,
  editing: State | undefined,
  states: State[],
  order: Order,
  afterBeforeState: string
): State[] {
  if ((editing && states.length === 1) || (!editing && states.length === 0)) return [state];
  const result: State[] = [];
  for (const other of states) {
    if (other.name === afterBeforeState && order === 'before') result.push(state);
    if (other.name !== editing?.name) result.push(other);
    if (other.name === afterBeforeState && order === 'after') result.push(state);
  }
  return result;
}

/** A policy with a state added or changed; the first state it gets is the one it starts in */
export function updatedPolicy(
  policy: Policy,
  state: State,
  editing: State | undefined,
  order: Order,
  afterBeforeState: string
): Policy {
  const states = updatedStates(state, editing, policy.states, order, afterBeforeState);
  let defaultState = policy.default_state;
  if (states.length === 1) defaultState = states[0].name;
  if (editing && editing.name === defaultState) defaultState = state.name;
  return { ...policy, states, default_state: defaultState };
}

/** A policy without one of its states; the first of the rest is where it starts if that one was */
export function withoutState(policy: Policy, index: number): Policy {
  const removed = policy.states[index];
  const states = policy.states.filter((_, position) => position !== index);
  const defaultState = policy.default_state === removed?.name ? (states[0]?.name ?? '') : policy.default_state;
  return { ...policy, states, default_state: defaultState };
}

// --- An action while it is edited ----------------------------------------------------------------------

/** The parts of an action its form edits as text: JSON that may not be complete yet */
export type Drafts = Record<string, string>;

const pretty = (value: unknown): string => (value === undefined ? '' : JSON.stringify(value, null, 4));

export function draftsOf(action: Action): Drafts {
  const type = actionType(action);
  const settings = record(type ? action[type] : undefined);
  if (type === 'allocation' || type === 'rollup') return { json: pretty(settings) };
  if (type === 'shrink') {
    return { aliases: pretty(settings.aliases), template: pretty(settings.target_index_name_template) };
  }
  // A notification that names a destination is one of the old kind, edited as JSON
  if (type === 'notification') return { json: settings.destination ? pretty(settings) : '' };
  return {};
}

const parses = (text: string): boolean => {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
};

/** Whether a part edited as text can be saved: it may be left empty, and is JSON otherwise */
export const draftIsValid = (text: string | undefined): boolean => !text || parses(text);

export function draftsAreValid(action: Action, drafts: Drafts): boolean {
  const type = actionType(action);
  if (type === 'allocation' || type === 'rollup') return parses(drafts.json ?? '');
  if (type === 'notification') return !drafts.json || parses(drafts.json);
  if (type === 'shrink') {
    return (!drafts.aliases || parses(drafts.aliases)) && (!drafts.template || parses(drafts.template));
  }
  return true;
}

/** The action as the policy keeps it, with what was edited as text put in its place */
export function withDrafts(action: Action, drafts: Drafts): Action {
  const type = actionType(action);
  if (!type) return action;
  if (type === 'allocation' || type === 'rollup') return { ...action, [type]: JSON.parse(drafts.json) };
  if (type === 'notification') return drafts.json ? { ...action, notification: JSON.parse(drafts.json) } : action;
  if (type === 'shrink') {
    const shrink = { ...record(action.shrink) };
    if (drafts.aliases) shrink.aliases = JSON.parse(drafts.aliases);
    else delete shrink.aliases;
    if (drafts.template) shrink.target_index_name_template = JSON.parse(drafts.template);
    else delete shrink.target_index_name_template;
    return { ...action, shrink };
  }
  if (type === 'convert_index_to_remote') {
    const settings = { ...record(action.convert_index_to_remote) };
    if (settings.number_of_replicas === undefined) delete settings.number_of_replicas;
    if (typeof settings.rename_pattern !== 'string' || !settings.rename_pattern.trim()) settings.rename_pattern = '$1_remote';
    return { ...action, convert_index_to_remote: settings };
  }
  return action;
}

// --- JSON as the plugin's code editor colours it ---------------------------------------------------------

/** The spaces of one step of indentation in the plugin's code editor (Ace's tab size) */
const ACE_TAB_SIZE = 4;

/**
 * The runs of a JSON text with each brace and bracket a run of its own, of the kind `Paren`, as
 * Ace's JSON mode makes them (its themes draw them bold), and the indentation of a line cut into
 * steps of the kind `Indent`, which Ace draws with a guide at their right: as Ace does, every step
 * but the one before the text, so that the guides run under the start of the outer lines' text.
 * The other runs are left as they are.
 */
export function aceJsonTokens(text: string): CodeToken[][] {
  return tokenizeJson(text).map((line) => {
    const tokens = line.flatMap((token) => {
      if (token.kind || !/[{}[\]]/.test(token.text)) return [token];
      return token.text
        .split(/([{}[\]])/)
        .filter((piece) => piece !== '')
        .map((piece) => (/^[{}[\]]$/.test(piece) ? { text: piece, kind: 'Paren' } : { text: piece }));
    });
    const [first, ...rest] = tokens;
    if (!first || first.kind || !first.text.startsWith(' ')) return tokens;
    // Where Ace's renderIndentGuide finds the last space of the indentation
    const columns = first.text.search(/\s\S| \t|\t |\s$/);
    const steps = Math.floor(Math.max(0, columns) / ACE_TAB_SIZE);
    if (steps === 0) return tokens;
    const after = first.text.slice(steps * ACE_TAB_SIZE);
    return [
      ...Array.from({ length: steps }, () => ({ text: ' '.repeat(ACE_TAB_SIZE), kind: 'Indent' })),
      ...(after ? [{ text: after }] : []),
      ...rest,
    ];
  });
}

/**
 * How wide Ace draws the numbers of the lines, in pixels: as wide as the number of the last line
 * it draws needs, so 42 px up to line 9, 50 px up to line 99 and 59 px beyond. Ace draws the lines
 * in sight and one more.
 */
export function aceGutterWidth(lines: number, shownHeight: number, lineHeight: number, scrolled = 0): number {
  const shown =
    lineHeight > 0 ? Math.floor(scrolled / lineHeight) + Math.ceil(shownHeight / lineHeight) + 1 : lines;
  const last = Math.max(1, Math.min(lines, shown));
  return Math.ceil(33 + String(last).length * 8.43);
}

/**
 * The line, counted from 0, that Ace draws on a band: the line of the cursor, or of a selection
 * within one line; none while a selection spans lines.
 */
export function aceActiveLine(text: string, start: number, end: number): number | undefined {
  const lineAt = (offset: number) => {
    let line = 0;
    for (let at = text.indexOf('\n'); at !== -1 && at < offset; at = text.indexOf('\n', at + 1)) line += 1;
    return line;
  };
  const first = lineAt(Math.min(start, text.length));
  return first === lineAt(Math.min(end, text.length)) ? first : undefined;
}

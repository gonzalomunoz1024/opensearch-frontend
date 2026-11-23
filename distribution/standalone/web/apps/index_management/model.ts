/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Index Management without its pages: what a search box asks the server for, which indices are
 * the system's own, which of the chosen ones an operation must leave alone, and the sentences
 * the dialogs and notices say about them.
 */

import { parseSearch } from '../../lib/search_syntax';

// --- What a search box asks for -------------------------------------------------------------------

export interface SearchClauses {
  terms: string[];
  indices: string[];
  dataStreams: string[];
}

/**
 * The words of a search, and what it names with `indices:` and `data_streams:`. A text that is
 * no search asks for nothing in particular.
 */
export function searchClauses(search: string): SearchClauses {
  const clauses = (search.trim() === '' ? [] : parseSearch(search)) ?? [];
  const found: SearchClauses = { terms: [], indices: [], dataStreams: [] };
  for (const clause of clauses) {
    if (clause.type === 'term') found.terms.push(clause.value);
    if (clause.type !== 'field') continue;
    const values = Array.isArray(clause.value) ? clause.value : [clause.value];
    if (clause.field === 'indices') found.indices.push(...values);
    if (clause.field === 'data_streams') found.dataStreams.push(...values);
  }
  return found;
}

/** A search with the data streams it names replaced by others */
export function withDataStreams(search: string, dataStreams: string[]): string {
  const rest = search.replace(/\s*-?data_streams:(\([^)]*\)|"[^"]*"|\S+)/g, '').trim();
  if (dataStreams.length === 0) return rest;
  const clause =
    dataStreams.length === 1 ? `data_streams:${dataStreams[0]}` : `data_streams:(${dataStreams.join(' or ')})`;
  return rest ? `${rest} ${clause}` : clause;
}

// --- The system's own indices ------------------------------------------------------------------------

export const SYSTEM_INDEX = [
  '.plugins-ml-model',
  '.plugins-ml-task',
  '.opendistro-alerting-config',
  '.opendistro-alerting-alert*',
  '.opendistro-anomaly-results*',
  '.opendistro-anomaly-detector*',
  '.opendistro-anomaly-checkpoints',
  '.opendistro-anomaly-detection-state',
  '.opendistro-reports-*',
  '.opensearch-notifications-*',
  '.opensearch-notebooks',
  '.opensearch-observability',
  '.opendistro-asynchronous-search-response*',
  '.opendistro_security',
  '.opendistro-job-scheduler-lock',
  '.opendistro-ism-config',
  '.replication-metadata-store',
  'kibana*',
  '.kibana*',
  '.tasks',
];

export const SYSTEM_ALIAS = [
  '.plugins*',
  '.opendistro*',
  '.opensearch*',
  '.replication-metadata-store',
  'kibana*',
  '.kibana*',
  '.tasks',
];

/** Whether a name is one of the patterns, in which `*` stands for anything */
export function matchesAny(name: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    const source = pattern.split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
    return new RegExp(`^${source}$`).test(name);
  });
}

// --- What an operation must leave alone ----------------------------------------------------------------

/** What an operation is done to; the words are the ones the dialogs say */
export type Target = 'indexes' | 'aliases' | 'data streams';

export const SINGULAR: Record<Target, string> = {
  indexes: 'index',
  aliases: 'alias',
  'data streams': 'data stream',
};

/** The blocks of an index, by the numbers the cluster state gives them */
export const BLOCKS = { CLOSED: '4', READ_ONLY: '5', META_DATA: '9', READ_ONLY_ALLOW_DELETE: '12' };

/** The indices that have one of the blocks, from the "blocks" of the cluster state */
export function blockedIndices(clusterState: unknown, blocks: string[]): Set<string> {
  const wanted = new Set(blocks);
  const all = (clusterState as { blocks?: { indices?: Record<string, Record<string, unknown>> } } | undefined)
    ?.blocks?.indices;
  const found = new Set<string>();
  for (const [index, held] of Object.entries(all ?? {})) {
    if (Object.keys(held).some((block) => wanted.has(block))) found.add(index);
  }
  return found;
}

/** The open indices that are red, from the text the indices API gives for `h=i,s&health=red` */
export function redOpenIndices(text: unknown): string[] {
  if (typeof text !== 'string') return [];
  return text
    .split('\n')
    .filter((line) => line !== '' && line.endsWith('open'))
    .map((line) => line.split(' ')[0]);
}

export interface Operand {
  /** The name the dialog shows */
  name: string;
  /** The indices behind it: itself for an index, its members for an alias or a data stream */
  indices: string[];
}

/** The names an operation can be done to and those it cannot, because an index of theirs is blocked */
export function splitBlocked(items: Operand[], blocked: Set<string>) {
  const result = { unBlockedItems: [] as string[], blockedItems: [] as string[] };
  for (const item of items) {
    if (item.indices.some((index) => blocked.has(index))) result.blockedItems.push(item.name);
    else result.unBlockedItems.push(item.name);
  }
  return result;
}

// --- Sentences ---------------------------------------------------------------------------------------

export function clearCacheToast(target: Target, done: string[], nothingChosen: boolean): string {
  if (nothingChosen) return 'Cache for all open indexes have been successfully cleared.';
  if (done.length > 1) {
    return `Cache for ${done.length} ${target} [${done.join(', ')}] have been successfully cleared.`;
  }
  return done.length === 1 ? `Cache for ${done[0]} has been successfully cleared.` : '';
}

export function flushToast(target: Target, done: string[]): string {
  if (done.length === 0) return 'All open indexes have been successfully flushed.';
  if (done.length === 1) return `The ${SINGULAR[target]} ${done[0]} has been successfully flushed.`;
  return `${done.length} ${target} have been successfully flushed.`;
}

export function flushBlockedMessage(target: Target): string {
  const reason =
    target === 'aliases' ? 'one or more indexes' : target === 'data streams' ? 'one or more backing indexes' : 'they';
  return `The following ${target} will not be flushed because ${reason} are either closed or in red status:`;
}

/** Why something cannot be refreshed: itself, or an index of its own */
export const closedWording = (target: Target) =>
  target === 'indexes' ? 'they' : `each ${SINGULAR[target]} has one or more indexes that`;

export function refreshToast(target: Target, done: string[], nothingChosen: boolean): string {
  if (nothingChosen) return 'All open indexes have been successfully refreshed.';
  if (done.length === 1) return `The ${SINGULAR[target]} [${done.join(', ')}] has been successfully refreshed.`;
  return `${done.length} ${target} [${done.join(', ')}] have been successfully refreshed.`;
}

// --- Names ---------------------------------------------------------------------------------------------

export const INDEX_NAMING_MESSAGE =
  'Must be in lowercase letters. Cannot begin with underscores or hyphens. Spaces, commas, and characters :, ", *, +, /, \\, |, ?, #, > are not allowed.';
export const INDEX_NAMING_PATTERN = /^[^A-Z-_"*+/\\|?#<>][^A-Z"*+/\\|?#<>]*$/;
export const TEMPLATE_NAMING_MESSAGE =
  'Must be in lowercase letters. Cannot begin with underscores. Spaces, commas, and characters *, # are not allowed.';
export const TEMPLATE_NAMING_PATTERN = /^[^A-Z_*,\s#][^A-Z*,\s#]*$/;
export const ALIAS_NAMING_MESSAGE =
  'An alias must be 1-255 characters long, cannot be ".", or "..", cannot start with _, -, or +, and cannot contain spaces, commas, \\, /, *, ?, ", <, >, |, #, or :.';
export const ALIAS_NAMING_PATTERN = /^(?![_\-+])(?!.*\.\.)[^\s,\\/*?"<>|#:.]{1,255}$/;

/** A value with a dash for nothing, as the tables write it */
export const orDash = (value: unknown): string =>
  value === undefined || value === null || value === '' || value === 0 ? '-' : String(value);

// --- Aliases -------------------------------------------------------------------------------------------

export interface AliasRow {
  alias: string;
  index: string;
  filter?: string;
  'routing.index'?: string;
  'routing.search'?: string;
  is_write_index?: string;
  /** Every index the alias points to */
  indexArray: string[];
  /** The index writes go to: the one marked so, or the only one */
  writeIndex: string;
}

/** The aliases of the cluster, one row for each, from the rows the aliases API gives for each index */
export function groupAliases(rows: Array<Omit<AliasRow, 'indexArray' | 'writeIndex'>>): AliasRow[] {
  const grouped = new Map<string, AliasRow>();
  for (const row of rows) {
    const found = grouped.get(row.alias) ?? { ...row, indexArray: [], writeIndex: '' };
    grouped.set(row.alias, found);
    found.indexArray.push(row.index);
    if (row.is_write_index === 'true') found.writeIndex = row.index;
  }
  return [...grouped.values()].map((item) =>
    item.indexArray.length === 1 ? { ...item, writeIndex: item.indexArray[0] } : item
  );
}

/** What turns the indexes an alias had into the ones it is to have */
export function aliasActions(before: string[], after: string[], alias: string) {
  return [
    ...before.filter((index) => !after.includes(index)).map((index) => ({ remove: { alias, index } })),
    ...after.filter((index) => !before.includes(index)).map((index) => ({ add: { alias, index } })),
  ];
}

/** The page of a list whose address counts pages, as the table that counts rows wants it */
export const pageQuery = <Q extends { from: number; size: number }>(query: Q): Q => ({
  ...query,
  from: query.from * query.size,
});

/** The changes a table asks for, with rows counted as pages again */
export function pageChanges<C extends { from?: number; size?: number }>(changes: C, size: number): C {
  if (changes.from === undefined) return changes;
  return { ...changes, from: Math.floor(changes.from / (changes.size ?? size)) };
}

/** The theme's caption of a table, which a screen reader reads: how many rows it shows of how many */
export function tableCaption(shown: number, total: number, size: number, from: number, paged: boolean): string {
  if (!paged) return `This table contains ${shown} rows.`;
  const page = Math.floor(from / size) + 1;
  const pages = Math.ceil(total / size);
  return total > 0
    ? `This table contains ${shown} rows out of ${total} rows; Page ${page} of ${pages}.`
    : `This table contains ${shown} rows; Page ${page} of ${pages}.`;
}

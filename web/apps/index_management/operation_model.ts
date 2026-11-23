/* SPDX-License-Identifier: Apache-2.0 */

/* What the pages that start an operation on indexes ask for, checked and written as OpenSearch takes it. */

import { remoteMappings, type IndexItem } from './index_model';
import { duplicateOf, type IndexOption } from './index_options';
import { INDEX_NAMING_PATTERN } from './model';

export interface ForceMergeOptions {
  flush?: boolean;
  /** A number as first set, or the text typed over it */
  max_num_segments?: number | string;
  only_expunge_deletes?: boolean;
}

export const SEGMENTS_ERROR = 'Must be an integer great than or equal to 1.';

/** What is wrong with a number of segments; nothing at all is no number, and that is allowed */
export function segmentsError(value: number | string | undefined): string | undefined {
  const count = Number(value);
  if (value === undefined || Number.isNaN(count)) return undefined;
  return count % 1 !== 0 || count < 1 ? SEGMENTS_ERROR : undefined;
}

/** The options as the request carries them: only the ones that were set */
export function forceMergeBody(options: ForceMergeOptions): ForceMergeOptions {
  const body: ForceMergeOptions = {};
  if (options.flush !== undefined) body.flush = options.flush;
  if (options.max_num_segments !== undefined) body.max_num_segments = options.max_num_segments;
  if (options.only_expunge_deletes !== undefined) body.only_expunge_deletes = options.only_expunge_deletes;
  return body;
}

// --- Roll over ----------------------------------------------------------------------------------------

/** One index of an alias, as the list of aliases gives it */
export interface AliasMember {
  alias: string;
  index: string;
  is_write_index?: string;
}

export interface RolloverSources {
  alias: Array<{ label: string; aliases: AliasMember[] }>;
  dataStreams: Array<{ label: string }>;
}

/** The aliases, each with its indexes, and the data streams: what can be rolled over */
export function rolloverSources(members: AliasMember[], dataStreams: Array<{ name: string }>): RolloverSources {
  const alias: RolloverSources['alias'] = [];
  for (const member of members) {
    let found = alias.find((item) => item.label === member.alias);
    if (!found) {
      found = { label: member.alias, aliases: [] };
      alias.push(found);
    }
    found.aliases.push(member);
  }
  return { alias, dataStreams: dataStreams.map((stream) => ({ label: stream.name })) };
}

export function rolloverSourceType(sources: RolloverSources, source: string | undefined): 'alias' | 'dataStreams' | undefined {
  if (sources.alias.some((item) => item.label === source)) return 'alias';
  if (sources.dataStreams.some((item) => item.label === source)) return 'dataStreams';
  return undefined;
}

/** The index an alias writes to: its only one, or the one of several that is marked; none otherwise */
export function rolloverWriteIndex(sources: RolloverSources, source: string | undefined): string {
  const members = sources.alias.find((item) => item.label === source)?.aliases;
  if (!members || members.length === 0) return '';
  if (members.length === 1) return members[0].index;
  return members.find((member) => member.is_write_index === 'true')?.index ?? '';
}

/** Whether OpenSearch can name the next index by itself: the name of this one ends in a number */
export const namesItself = (index: string): boolean => /^.*-\d+$/.test(index);

/** What the roll over request carries: for an alias, the index to make and how to make it */
export function rolloverPayload(
  source: string | undefined,
  type: 'alias' | 'dataStreams' | undefined,
  target: { index?: string; [more: string]: unknown } | undefined
): { alias: string; newIndex?: string; body: Record<string, unknown> } {
  const payload: { alias: string; newIndex?: string; body: Record<string, unknown> } = { alias: source || '', body: {} };
  if (type === 'alias' && target && Object.keys(target).length > 0) {
    const { index, ...others } = target;
    if (index) payload.newIndex = index;
    payload.body = others;
  }
  return payload;
}

/** The new index of a roll over as the request describes it: a mapping that says nothing is left out */
export function rolloverTarget(item: IndexItem): { index?: string; [more: string]: unknown } {
  const { mappings, ...others } = item;
  const remote = remoteMappings(mappings);
  const fields = remote.properties as Record<string, unknown>;
  const says = Object.keys(fields).length > 0 || Object.keys(remote).some((key) => key !== 'properties');
  return says ? { ...others, mappings: remote } : others;
}

// --- Split and shrink -----------------------------------------------------------------------------------

/** What the form of a split or a shrink holds: the name of the new index, and its settings written flat */
export type ResizeValues = Record<string, unknown>;

/** The numbers of primary shards an index of so many can be split into */
export function splitShardOptions(sourceShards: number): string[] {
  const max = 1024;
  const options: string[] = [];
  if (sourceShards === 1) {
    for (let count = 2; count <= max; count += 1) options.push(String(count));
    return options;
  }
  if (!(sourceShards > 0)) return options;
  let count = sourceShards;
  while (count <= max / 2) {
    count *= 2;
    options.push(String(count));
  }
  return options;
}

/** The numbers of primary shards an index of so many can be shrunk to: those that divide it */
export function shrinkShardOptions(sourceShards: number): string[] {
  const options: string[] = [];
  for (let count = 1; count <= sourceShards; count += 1) {
    if (sourceShards % count === 0) options.push(String(count));
  }
  return options;
}

const filled = (value: unknown): boolean => value !== undefined && value !== null && String(value).trim() !== '';

export function splitErrors(values: ResizeValues, shardOptions: string[]): Record<string, string> {
  const errors: Record<string, string> = {};
  const name = values.targetIndex;
  if (!name) errors.targetIndex = 'Target index name is required';
  else if (!INDEX_NAMING_PATTERN.test(String(name))) errors.targetIndex = `Target index name ${String(name)} is invalid`;
  const shards = values['index.number_of_shards'];
  if (!shards) errors['index.number_of_shards'] = 'Number of shards is required';
  else if (!shardOptions.includes(String(shards))) {
    errors['index.number_of_shards'] = `Number of shards ${String(shards)} is invalid`;
  }
  return errors;
}

/** What is wrong with each field of the form that shrinks an index: every rule the field breaks */
export function shrinkErrors(values: ResizeValues, sourceShards: number): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  const name = values.targetIndex;
  const wrongName: string[] = [];
  if (!filled(name)) wrongName.push('Target index name required.');
  if (!INDEX_NAMING_PATTERN.test(String(name ?? ''))) wrongName.push('Invalid target index name.');
  if (wrongName.length > 0) errors.targetIndex = wrongName;
  const shards = values['index.number_of_shards'];
  if (!filled(shards) || !shards || Number(shards) <= 0 || sourceShards % Number(shards) !== 0) {
    errors['index.number_of_shards'] = [
      'The number of primary shards in the new shrunken index  must be a positive factor of the number of primary shards in the source index.',
    ];
  }
  const replicas = values['index.number_of_replicas'];
  if (!filled(replicas) || !replicas || Number(replicas) < 0) {
    errors['index.number_of_replicas'] = ['Number of replicas must be greater than or equal to 0.'];
  }
  return errors;
}

/** What the request of a split or a shrink carries: the settings of the new index, and its aliases apart */
export function resizeBody(values: ResizeValues): { settings: Record<string, unknown>; aliases?: unknown } {
  const { targetIndex: _name, aliases, ...settings } = values;
  return { settings, aliases };
}

/** The settings as the editor of all of them shows them: everything but the name of the new index */
export function resizeEditorValue(values: ResizeValues): Record<string, unknown> {
  const { targetIndex: _name, ...others } = values;
  return others;
}

/** What the form holds once the editor of all the settings was changed */
export function resizeFromEditor(values: ResizeValues, edited: Record<string, unknown>): ResizeValues {
  const { targetIndex: _name, ...others } = edited;
  return 'targetIndex' in values ? { ...others, targetIndex: values.targetIndex } : others;
}

export type ResizeProblem =
  | 'red'
  | 'closed'
  | 'writable'
  | 'oneShard'
  | 'yellow'
  | 'readOnly';

const isTrue = (value: unknown) => value === 'true' || value === true;

/** What stands in the way of a split, in the order the page tells it */
export function splitProblems(
  index: { health?: string; status?: string },
  settings: Record<string, unknown> | undefined
): ResizeProblem[] {
  const problems: ResizeProblem[] = [];
  if (index.health === 'red') problems.push('red');
  if (index.status === 'close') problems.push('closed');
  if (settings && !isTrue(settings['index.blocks.write'])) problems.push('writable');
  return problems;
}

/** What stands in the way of a shrink, and what only speaks against it: `yellow` and `readOnly` */
export function shrinkProblems(
  index: { health?: string; status?: string; pri?: string },
  settings: Record<string, unknown> | undefined
): ResizeProblem[] {
  const problems: ResizeProblem[] = [];
  if (index.health === 'red') problems.push('red');
  if (index.pri === '1') problems.push('oneShard');
  if (problems.length > 0) return problems;
  if (!isTrue(settings?.['index.blocks.write'])) problems.push('writable');
  if (index.status === 'close') problems.push('closed');
  if (problems.length > 0) return problems;
  if (index.health === 'yellow') problems.push('yellow');
  if (isTrue(settings?.['index.blocks.read_only'])) problems.push('readOnly');
  return problems;
}

/** Whether what was found leaves the shrink possible */
export const shrinkBlocked = (problems: ResizeProblem[]): boolean =>
  problems.some((problem) => problem !== 'yellow' && problem !== 'readOnly');

// --- Reindex ------------------------------------------------------------------------------------------

export const DEFAULT_REINDEX_QUERY = JSON.stringify({ query: { match_all: {} } }, null, 2);

export const REINDEX_ERRORS = {
  DEST_REQUIRED: 'Destination is required.',
  SOURCE_REQUIRED: 'Source is required.',
  HEALTH_RED: 'health status is red.',
  SLICES_FORMAT: 'Must be an integer greater than or equal to 2.',
  QUERY: 'Invalid query expression',
};

/**
 * In how many parts the copy is done: not said (one), `auto`, or a number as typed. The rule for
 * the number is the one of OpenSearch Dashboards, which takes no number that begins with 1.
 */
export function slicesError(slices: string | undefined): string | undefined {
  if (slices === undefined || slices === 'auto') return undefined;
  return /^[2-9][0-9]*$/.test(slices) ? undefined : REINDEX_ERRORS.SLICES_FORMAT;
}

/**
 * What is wrong with the sources of a reindex. `fieldMappings` is what OpenSearch says of the
 * `_source` field of the open ones: a document that keeps no source cannot be copied.
 */
export function sourceErrors(sources: IndexOption[], fieldMappings: unknown): string[] {
  if (sources.length === 0) return [REINDEX_ERRORS.SOURCE_REQUIRED];
  const errors: string[] = [];
  for (const source of sources) {
    if (source.health === 'red') errors.push(`Index [${source.label}] ${REINDEX_ERRORS.HEALTH_RED}`);
  }
  for (const source of sources) {
    if (source.status === 'close') errors.push(`Index [${source.label}] status is closed.`);
  }
  const mappings = (fieldMappings ?? {}) as Record<
    string,
    { mappings?: { _source?: { mapping?: { _source?: { enabled?: boolean } } } } } | undefined
  >;
  for (const source of sources) {
    if (mappings[source.label]?.mappings?._source?.mapping?._source?.enabled === false) {
      errors.push(`Index [${source.label}] _sources is not enabled`);
    }
  }
  return errors;
}

/** What is wrong with where a reindex writes to */
export function destinationError(destination: IndexOption[], sources: IndexOption[]): string | undefined {
  if (destination.length !== 1) return REINDEX_ERRORS.DEST_REQUIRED;
  const [target] = destination;
  if (target.health === 'red') return `Index [${target.label}] ${REINDEX_ERRORS.HEALTH_RED}`;
  if (target.status === 'close') return `Index [${target.label}] status is closed.`;
  if (target.isAlias && !target.writingIndex) return `Alias [${target.label}] don't have writing index behind it.`;
  return duplicateOf(sources, destination) ?? undefined;
}

/** The indexes whose settings a new destination can take over: the ones the sources stand for */
export function reindexSourceIndexes(sources: IndexOption[]): string[] {
  const indexes: string[] = [];
  for (const source of sources) {
    if (source.isIndex) indexes.push(source.label);
    if (source.isAlias && source.indices) indexes.push(...source.indices);
    if (source.isDataStream && source.writingIndex) indexes.push(source.writingIndex);
  }
  return indexes;
}

export interface ReindexOptions {
  sources: IndexOption[];
  destination: IndexOption;
  slices?: string;
  /** Copies only the documents the query finds; `query` is the JSON as typed */
  subset?: boolean;
  query?: string;
  pipeline?: string;
  ignoreConflicts?: boolean;
  /** Leaves the documents the destination already has as they are */
  uniqueOnly?: boolean;
}

/** The request that starts a reindex. A data stream only takes documents that are new to it. */
export function reindexRequest(options: ReindexOptions): { path: string; body: Record<string, unknown> } {
  const source: Record<string, unknown> = { index: options.sources.map((item) => item.label).join(',') };
  if (options.subset) Object.assign(source, JSON.parse(options.query ?? '{}'));
  const dest: Record<string, unknown> = {
    index: options.destination.label,
    op_type: options.destination.isDataStream || options.uniqueOnly ? 'create' : 'index',
  };
  if (options.pipeline) dest.pipeline = options.pipeline;
  return {
    path: `_reindex?slices=${options.slices === undefined ? '1' : options.slices}&wait_for_completion=false`,
    body: { conflicts: options.ignoreConflicts ? 'proceed' : 'abort', source, dest },
  };
}

/** What the look for the end of a reindex needs to know of where it wrote to */
export function reindexTarget(destination: IndexOption): { destType: 'index' | 'other'; writingIndex?: string } {
  return destination.isIndex
    ? { destType: 'index', writingIndex: destination.label }
    : { destType: 'other', writingIndex: destination.writingIndex };
}

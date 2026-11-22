/* SPDX-License-Identifier: Apache-2.0 */

/*
 * What an operation can be started on: the indexes, the data streams and the aliases of the
 * cluster, as the pages that reindex, force merge or roll over offer them.
 */

import { SYSTEM_ALIAS, SYSTEM_INDEX, matchesAny } from './model';

export type OptionGroup = 'indices' | 'dataStreams' | 'aliases';

export interface IndexOption {
  label: string;
  group: OptionGroup;
  isIndex?: boolean;
  isDataStream?: boolean;
  isAlias?: boolean;
  status?: string;
  health?: string;
  /** The indexes behind a data stream or an alias */
  indices?: string[];
  /** The one of them that what is written to the data stream or the alias goes to */
  writingIndex?: string;
}

const BACKING_INDEX = /^.ds-(.*)-\d{6}$/;

/** The names to look for: a backing index is looked for by the name of its data stream */
export function parseIndexNames(text: string | undefined): string[] {
  if (!text) return [];
  return text.split(',').map((name) => BACKING_INDEX.exec(name)?.[1] ?? name);
}

export interface FoundIndex {
  index: string;
  status?: string;
  health?: string;
}

export interface FoundDataStream {
  name: string;
  status?: string;
  indices?: Array<{ index_name: string }>;
}

export interface FoundAlias {
  alias: string;
  index: string;
  is_write_index?: string;
}

export function indexOptions(found: {
  indices?: FoundIndex[];
  dataStreams?: FoundDataStream[];
  aliases?: FoundAlias[];
}): IndexOption[] {
  const options: IndexOption[] = [];
  for (const index of found.indices ?? []) {
    options.push({ label: index.index, group: 'indices', isIndex: true, status: index.status, health: index.health });
  }
  for (const stream of found.dataStreams ?? []) {
    const indices = (stream.indices ?? []).map((item) => item.index_name);
    options.push({
      label: stream.name,
      group: 'dataStreams',
      isDataStream: true,
      health: stream.status?.toLowerCase(),
      indices,
      writingIndex: [...indices].sort().reverse()[0],
    });
  }
  const aliases = found.aliases ?? [];
  for (const name of [...new Set(aliases.map((alias) => alias.alias))]) {
    const own = aliases.filter((alias) => alias.alias === name);
    const indices = own.map((alias) => alias.index);
    const written = own.filter((alias) => alias.is_write_index === 'true').map((alias) => alias.index);
    // An alias of one index writes to it without saying so
    const writingIndex = written.length === 0 && indices.length === 1 ? indices[0] : written[0];
    options.push({ label: name, group: 'aliases', isAlias: true, indices, writingIndex });
  }
  return options;
}

/** Without what belongs to OpenSearch and its plugins */
export const withoutSystem = (options: IndexOption[]): IndexOption[] =>
  options.filter((option) => !matchesAny(option.label, SYSTEM_ALIAS) && !matchesAny(option.label, SYSTEM_INDEX));

/** Says which indexes would be read from and written to at once, or nothing when there are none */
export function duplicateOf(sources: IndexOption[], destination: IndexOption[]): string | null {
  const read = sources.flatMap((item) => [
    item.label,
    ...((item.isAlias || item.isDataStream) && item.indices ? item.indices : []),
  ]);
  const written = destination.flatMap((item) => [
    item.label,
    ...((item.isAlias || item.isDataStream) && item.writingIndex ? [item.writingIndex] : []),
  ]);
  const both = [...new Set(read)].filter((name) => written.includes(name));
  return both.length > 0 ? `Index [${both.join(',')}] both exists in source and destination` : null;
}

/** Without what the other side of the operation already holds */
export const withoutOverlaps = (options: IndexOption[], others: IndexOption[] | undefined): IndexOption[] =>
  others ? options.filter((option) => !duplicateOf(others, [option])) : options;

const BLOCKS = ['index.blocks.read_only', 'index.blocks.read_only_allow_delete', 'index.blocks.write'];

/** The ones of `indexes` that can still be written to, from their settings written flat */
export function notReadOnly(settings: unknown, indexes: string[]): string[] {
  if (!settings || typeof settings !== 'object') return [];
  return Object.entries(settings as Record<string, { settings?: Record<string, unknown> } | undefined>)
    .filter(([name, detail]) => indexes.includes(name) && BLOCKS.every((block) => detail?.settings?.[block] !== 'true'))
    .map(([name]) => name);
}

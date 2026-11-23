/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The "search source" a saved search, visualization or dashboard carries: its index pattern, its
 * query and its filters, as JSON text inside the object, with the ids of index patterns moved
 * out into the object's references. This reads and writes that form.
 */

import type { SavedObjectReference } from '../../common/saved_objects';
import type { Filter, Query } from './types';

export interface SearchSource {
  indexId?: string;
  query?: Query;
  filters: Filter[];
}

interface StoredSource {
  index?: string;
  indexRefName?: string;
  query?: unknown;
  filter?: unknown[];
  highlightAll?: boolean;
  version?: boolean;
  [other: string]: unknown;
}

const INDEX_REF = 'kibanaSavedObjectMeta.searchSourceJSON.index';

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * A query saved before queries had a language, as the original's migrateLegacyQuery reads it: a
 * text or a query of OpenSearch's own, both Lucene's
 */
export function migrateLegacyQuery(query: unknown): Query {
  if (isObject(query) && 'language' in query) return query as unknown as Query;
  return { query: typeof query === 'string' || isObject(query) ? query : '', language: 'lucene' };
}

export function parseSearchSource(json: string | undefined, references: SavedObjectReference[] = []): SearchSource {
  let stored: StoredSource = {};
  if (json) {
    try {
      stored = JSON.parse(json) as StoredSource;
    } catch {
      stored = {};
    }
  }
  const idOf = (name: string | undefined) => references.find((reference) => reference.name === name)?.id;
  // What is no filter (a null) is left out, as the address's filters are
  const filters = (Array.isArray(stored.filter) ? stored.filter : []).filter(isObject).map((entry): Filter => {
    const filter = entry as unknown as Filter;
    const meta = { ...(filter.meta ?? {}) };
    if (meta.indexRefName) {
      meta.index = idOf(meta.indexRefName) ?? meta.index;
      delete meta.indexRefName;
    }
    return { ...filter, meta };
  });
  return {
    indexId: stored.indexRefName ? idOf(stored.indexRefName) : stored.index,
    query: stored.query === undefined ? undefined : migrateLegacyQuery(stored.query),
    filters,
  };
}

export function serializeSearchSource(
  source: SearchSource,
  extra: Record<string, unknown> = {}
): { searchSourceJSON: string; references: SavedObjectReference[] } {
  const references: SavedObjectReference[] = [];
  const stored: StoredSource = { ...extra };
  if (source.query) stored.query = source.query;
  stored.filter = source.filters.map((filter, index) => {
    const meta = { ...filter.meta };
    if (meta.index) {
      const name = `kibanaSavedObjectMeta.searchSourceJSON.filter[${index}].meta.index`;
      references.push({ name, type: 'index-pattern', id: meta.index });
      meta.indexRefName = name;
      delete meta.index;
    }
    return { ...filter, meta };
  });
  if (source.indexId) {
    stored.indexRefName = INDEX_REF;
    references.push({ name: INDEX_REF, type: 'index-pattern', id: source.indexId });
  }
  return { searchSourceJSON: JSON.stringify(stored), references };
}

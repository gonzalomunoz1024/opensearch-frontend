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
  query?: Query;
  filter?: Filter[];
  highlightAll?: boolean;
  version?: boolean;
  [other: string]: unknown;
}

const INDEX_REF = 'kibanaSavedObjectMeta.searchSourceJSON.index';

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
  const filters = (Array.isArray(stored.filter) ? stored.filter : []).map((filter) => {
    const meta = { ...(filter.meta ?? {}) };
    if (meta.indexRefName) {
      meta.index = idOf(meta.indexRefName) ?? meta.index;
      delete meta.indexRefName;
    }
    return { ...filter, meta };
  });
  return {
    indexId: stored.indexRefName ? idOf(stored.indexRefName) : stored.index,
    query: stored.query,
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

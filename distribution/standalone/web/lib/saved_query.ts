/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Saved queries as the data plugin of OpenSearch Dashboards keeps and loads them: a query with,
 * when asked, the filters and the time range of the moment, stored as a `query` saved object
 * named by its title. Loading one gives a page its query and filters, and its time range when
 * it has one; the filters merge with the pinned ones as the plugin's filter manager merges them.
 */

import type { TimeRange } from './dates';
import type { Filter, Query, RefreshInterval } from './types';

export interface SavedQueryAttributes {
  title: string;
  description: string;
  query: Query;
  filters?: Filter[];
  timefilter?: TimeRange & { refreshInterval?: RefreshInterval };
}

export interface SavedQuery {
  id: string;
  attributes: SavedQueryAttributes;
}

/** What the form of a saved query asks */
export interface SaveQueryMeta {
  title: string;
  description: string;
  shouldIncludeFilters: boolean;
  shouldIncludeTimeFilter: boolean;
}

/** What a page holds that a saved query takes, or gives back when it is loaded */
export interface SavedQueryState {
  query: Query;
  /** All the filters, the pinned ones first */
  filters: Filter[];
  time?: TimeRange;
  refreshInterval?: RefreshInterval;
}

/** A stored object as a saved query: a query kept as JSON text comes back as the object it was */
export function parseSavedQuery(object: { id: string; attributes: object }): SavedQuery {
  const attributes = object.attributes as Record<string, unknown>;
  const stored = (attributes.query ?? {}) as { query?: unknown; language?: unknown };
  let text: unknown = stored.query;
  if (typeof text === 'string') {
    try {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed === 'object' && parsed !== null) text = parsed;
    } catch {
      // the text of a query, not JSON
    }
  }
  const parsed: SavedQueryAttributes = {
    title: typeof attributes.title === 'string' ? attributes.title : '',
    description: typeof attributes.description === 'string' ? attributes.description : '',
    query: {
      query: text === null || text === undefined ? '' : (text as Query['query']),
      language: typeof stored.language === 'string' ? stored.language : 'kuery',
    },
  };
  if (Array.isArray(attributes.filters)) parsed.filters = attributes.filters as Filter[];
  if (attributes.timefilter && typeof attributes.timefilter === 'object') {
    parsed.timefilter = attributes.timefilter as SavedQueryAttributes['timefilter'];
  }
  return { id: object.id, attributes: parsed };
}

/** Saved queries by title, in the order of the text's characters, as the list shows them */
export function sortSavedQueries(queries: SavedQuery[]): SavedQuery[] {
  return [...queries].sort((a, b) => {
    const [first, second] = [a.attributes.title, b.attributes.title];
    return first < second ? -1 : first > second ? 1 : 0;
  });
}

/** What is saved: the query as it is in the bar, and the filters and the time range if asked */
export function savedQueryAttributes(meta: SaveQueryMeta, state: SavedQueryState): SavedQueryAttributes {
  const attributes: SavedQueryAttributes = {
    title: meta.title,
    description: meta.description,
    query: { ...state.query },
  };
  if (meta.shouldIncludeFilters) {
    // Each filter says where it is kept, as the filter manager of the original says it
    attributes.filters = state.filters.map((filter) =>
      filter.$state ? filter : { ...filter, $state: { store: 'appState' as const } }
    );
  }
  if (meta.shouldIncludeTimeFilter && state.time && state.refreshInterval) {
    attributes.timefilter = {
      from: state.time.from,
      to: state.time.to,
      refreshInterval: { value: state.refreshInterval.value, pause: state.refreshInterval.pause },
    };
  }
  return attributes;
}

/** What makes two filters the same for the filter manager: all but their meta and their store */
function clauseKey(filter: Filter): string {
  const sorted = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sorted);
    if (value === null || typeof value !== 'object') return value;
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sorted((value as Record<string, unknown>)[key])])
    );
  };
  const { meta: _meta, $state: _state, $$hashKey: _hash, ...clause } = filter;
  return JSON.stringify(sorted(clause));
}

/** A list without repeated filters, each kept where it last appears */
function lastOfEach(filters: Filter[]): Filter[] {
  const seen = new Set<string>();
  const kept: Filter[] = [];
  for (const filter of [...filters].reverse()) {
    const key = clauseKey(filter);
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(filter);
  }
  return kept.reverse();
}

/**
 * The filters once a saved query is loaded: the pinned ones the page had, and the query's own.
 * A filter that says nowhere where it is kept goes where new filters go; one of the page's that
 * is also pinned stays pinned and takes its meta, as the original's filter manager does.
 */
export function filtersWithSavedQuery(pinned: Filter[], saved: Filter[], pinnedByDefault: boolean): Filter[] {
  const incoming = [...pinned, ...saved].map(
    (filter): Filter =>
      filter.$state ? filter : { ...filter, $state: { store: pinnedByDefault ? 'globalState' : 'appState' } }
  );
  const globalFilters = incoming
    .filter((filter) => filter.$state?.store === 'globalState')
    .map((filter) => ({ ...filter, meta: { ...filter.meta } }));
  const appFilters: Filter[] = [];
  for (const filter of incoming) {
    if (filter.$state?.store === 'globalState') continue;
    const match = globalFilters.find((candidate) => clauseKey(candidate) === clauseKey(filter));
    if (match) Object.assign(match.meta, filter.meta);
    else appFilters.push(filter);
  }
  return [...lastOfEach(globalFilters), ...lastOfEach(appFilters)];
}

/**
 * The state a page takes from a saved query: its query, its filters after the pinned ones, and
 * its time range and refresh interval when it keeps them. An interval of nothing is paused.
 */
export function stateFromSavedQuery(
  attributes: SavedQueryAttributes,
  current: { pinnedFilters: Filter[]; refreshInterval?: RefreshInterval; pinnedByDefault: boolean }
): SavedQueryState {
  const state: SavedQueryState = {
    query: { ...attributes.query },
    filters: filtersWithSavedQuery(current.pinnedFilters, attributes.filters ?? [], current.pinnedByDefault),
  };
  const { timefilter } = attributes;
  if (timefilter) {
    state.time = { from: timefilter.from, to: timefilter.to };
    if (timefilter.refreshInterval) {
      const interval = { ...current.refreshInterval, ...timefilter.refreshInterval } as RefreshInterval;
      state.refreshInterval = interval.value > 0 ? interval : { pause: true, value: 0 };
    }
  }
  return state;
}

/** Whether the title is one another saved query already has, when a new one is being saved */
export function titleConflicts(title: string, existing: SavedQuery[], editing: boolean): boolean {
  return !editing && existing.some((query) => query.attributes.title === title);
}

/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The state of the Visualize editor that its address holds, `_a`, as OpenSearch Dashboards 3.9.0
 * keeps it (`create_visualize_app_state.ts`, `visStateToEditorState`): as soon as a visualization
 * has loaded, the whole of it is written, what the address said already winning key by key over
 * what was loaded; each step after that changes the part it is about.
 */

import type { AggConfig } from '../../lib/aggs';
import type { Filter, IndexPattern, Query } from '../../lib/types';
import type { UiState, Vis } from '../../lib/vis';
import { serializeAggs } from './agg_params';
import { defaultParams } from './defaults';

/** The visualization itself, `_a.vis`: the original's `visState` with the title */
export interface AppVisState {
  title: string;
  type: string;
  aggs: AggConfig[];
  params: Record<string, unknown>;
}

export interface VisualizeAppState {
  filters: Filter[];
  /** Whether it is drawn from its saved search */
  linked: boolean;
  query: Query;
  /** The id of the saved query loaded into the search bar */
  savedQuery?: string;
  uiState: UiState;
  vis: AppVisState;
}

/**
 * The aggregations as the original serializes them when the editor opens: every parameter with
 * its default, and a date histogram with no time range but the one it was saved with, as it
 * learns the page's only once it has been drawn
 */
export function serializedAggs(aggs: AggConfig[], indexPattern: IndexPattern | undefined, queryLanguage?: string): AggConfig[] {
  return serializeAggs(aggs, { indexPattern, queryLanguage });
}

/**
 * A kind's settings over its defaults, one key deep, as the original's `Vis` merges them
 * (lodash's `defaults`: the settings in their order, then the defaults they lack)
 */
export function paramsWithDefaults(type: string, params: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...params };
  for (const [key, value] of Object.entries(defaultParams(type))) {
    if (merged[key] === undefined) merged[key] = value;
  }
  return merged;
}

/**
 * What the address starts from for a visualization that has loaded: the original's
 * `visStateToEditorState`. `defaultQuery` is the empty query in the language of the settings.
 */
export function editorStateDefaults(vis: Vis, indexPattern: IndexPattern | undefined, defaultQuery: Query): VisualizeAppState {
  return {
    uiState: vis.uiState ?? {},
    query: vis.source.query ?? defaultQuery,
    filters: vis.source.filters ?? [],
    vis: {
      title: vis.title,
      type: vis.type,
      aggs: serializedAggs(vis.aggs, indexPattern, defaultQuery.language),
      params: paramsWithDefaults(vis.type, vis.params),
    },
    linked: Boolean(vis.savedSearchId),
  };
}

/**
 * The original's `migrateAppState`: an address from before 7.0 may have a table with several
 * split aggregations; all but the first become buckets, without their `row` parameter
 */
export function migrateAppState(state: VisualizeAppState): VisualizeAppState {
  if (state.vis?.type !== 'table' || !Array.isArray(state.vis.aggs)) return state;
  let splits = 0;
  const aggs = state.vis.aggs.map((agg) => {
    if (agg.schema !== 'split') return agg;
    splits += 1;
    if (splits === 1) return agg;
    const { row: _row, ...params } = agg.params ?? {};
    return { ...agg, schema: 'bucket', params };
  });
  return splits <= 1 ? state : { ...state, vis: { ...state.vis, aggs } };
}

/**
 * The state the editor opens with, and writes to the address at once: what the address holds,
 * key by key, over the defaults of what was loaded. A visualization of another kind in the
 * address is not taken (the original would turn the loaded one into that kind); one that names no
 * kind is this one, as the original's `Vis` takes it.
 */
export function initialAppState(defaults: VisualizeAppState, fromUrl: Partial<VisualizeAppState>): VisualizeAppState {
  const state = migrateAppState({ ...defaults, ...fromUrl });
  const vis: unknown = state.vis;
  const kind = vis !== null && typeof vis === 'object' ? (vis as Partial<AppVisState>).type : null;
  return kind === undefined || kind === defaults.vis.type ? state : { ...state, vis: defaults.vis };
}

/**
 * What is saved of the visualization, as the original's `Vis` holds it: what the address has, the
 * kind's settings over their defaults (an address may name only some, or none, as the one
 * Discover's "Visualize" writes), or else what is applied
 */
export function savedVisState(
  fromUrl: Partial<AppVisState> | undefined,
  applied: Pick<AppVisState, 'aggs' | 'params'>,
  title: string,
  type: string
): AppVisState {
  return {
    title,
    type,
    aggs: fromUrl?.aggs ?? applied.aggs,
    params: fromUrl?.params ? paramsWithDefaults(type, fromUrl.params) : applied.params,
  };
}

/**
 * The original's `unlinkSavedSearch`: the query of the saved search becomes the visualization's
 * own, its filters are added after the visualization's (lodash's `union`), and the link is off
 */
export function unlinkSavedSearch(
  state: Pick<VisualizeAppState, 'query' | 'filters'>,
  parent: { query?: Query; filters?: Filter[] }
): Pick<VisualizeAppState, 'query' | 'filters' | 'linked'> {
  const filters: Filter[] = [];
  for (const filter of [...state.filters, ...(parent.filters ?? [])]) if (!filters.includes(filter)) filters.push(filter);
  return { query: parent.query ?? state.query, filters, linked: false };
}

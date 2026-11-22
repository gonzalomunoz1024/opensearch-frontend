/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The request behind a visualization drawn from aggregations: the page's query, filters and
 * time range, the visualization's own, and its aggregations, answered as a table.
 */

import { buildAggsDsl, fieldNameOf, needsFieldBounds, tabify, type AggContext, type Table } from '../lib/aggs';
import { resolveTimeRange, type TimeRange } from '../lib/dates';
import { buildQuery, timeRangeFilter } from '../lib/query';
import type { Filter, IndexPattern, Query } from '../lib/types';
import type { Vis } from '../lib/vis';
import { parseSearchSource } from '../lib/search_source';
import { services } from '../services';
import type { RequestRecord } from '../services/search';

export interface VisInput {
  time: TimeRange;
  query?: Query;
  filters: Filter[];
}

export interface VisData {
  indexPattern: IndexPattern;
  context: AggContext;
  table: Table;
  requests: RequestRecord[];
}

/** The index pattern a visualization draws from, through its saved search when it has one */
export async function resolveVisSource(vis: Vis): Promise<Vis> {
  if (!vis.savedSearchId || vis.parent) return vis;
  const search = await services.savedObjects.get<{ kibanaSavedObjectMeta?: { searchSourceJSON?: string } }>(
    'search',
    vis.savedSearchId
  );
  return { ...vis, parent: parseSearchSource(search.attributes.kibanaSavedObjectMeta?.searchSourceJSON, search.references) };
}

export function visContext(indexPattern: IndexPattern, time: TimeRange): AggContext {
  return {
    indexPattern,
    timeRange: indexPattern.timeFieldName ? resolveTimeRange(time, { weekStart: services.weekStart() }) : undefined,
    timeZone: services.timeZone(),
    barTarget: services.uiSettings.get<number>('histogram:barTarget', 50),
    maxBars: services.uiSettings.get<number>('histogram:maxBars', 100),
    formatSettings: services.formatSettings(),
    queryConfig: services.queryConfig(),
  };
}

/** The query a visualization's search asks: the page's, its saved search's and its own */
export function visQuery(vis: Vis, indexPattern: IndexPattern, input: VisInput, context: AggContext) {
  const query = buildQuery(
    indexPattern,
    [input.query, vis.parent?.query, vis.source.query].filter((item): item is Query => Boolean(item)),
    [...input.filters, ...(vis.parent?.filters ?? []), ...vis.source.filters],
    context.queryConfig
  );
  const timeFilter = timeRangeFilter(indexPattern, context.timeRange);
  if (timeFilter) query.bool.filter.push(timeFilter);
  return query;
}

// Which visualizations show the measure of every level of buckets, not only of the last
const metricsAtAllLevels = (vis: Vis) =>
  vis.type === 'pie' || (vis.type === 'table' && Boolean(vis.params.showMetricsAtAllLevels));

export async function fetchVisData(vis: Vis, input: VisInput, signal?: AbortSignal): Promise<VisData> {
  const resolved = await resolveVisSource(vis);
  const indexId = resolved.source.indexId ?? resolved.parent?.indexId;
  if (!indexId) throw new Error('This visualization names no index pattern');
  const indexPattern = await services.indexPatterns.get(indexId);
  const context = visContext(indexPattern, input.time);
  const query = visQuery(resolved, indexPattern, input, context);
  const requests: RequestRecord[] = [];

  // A number histogram with an automatic interval needs to know how far its field stretches
  const bounded = resolved.aggs.filter((agg) => agg.enabled !== false && needsFieldBounds(agg));
  if (bounded.length) {
    const aggs: Record<string, unknown> = {};
    for (const agg of bounded) {
      const field = fieldNameOf(agg);
      if (!field) continue;
      aggs[`min_${agg.id}`] = { min: { field } };
      aggs[`max_${agg.id}`] = { max: { field } };
    }
    const body = { size: 0, query, aggs };
    const record: RequestRecord = { name: 'Field bounds', index: indexPattern.title, body, startedAt: Date.now() };
    requests.push(record);
    const answer = await services.search.search(indexPattern.title, body, { signal, record });
    const found = (answer.aggregations ?? {}) as Record<string, { value: number | null }>;
    context.fieldBounds = {};
    for (const agg of bounded) {
      const field = fieldNameOf(agg);
      const min = found[`min_${agg.id}`]?.value;
      const max = found[`max_${agg.id}`]?.value;
      if (field && typeof min === 'number' && typeof max === 'number') context.fieldBounds[field] = { min, max };
    }
  }

  const options = { metricsAtAllLevels: metricsAtAllLevels(resolved), partialRows: Boolean(resolved.params.showPartialRows) };
  const body = { size: 0, track_total_hits: true, query, aggs: buildAggsDsl(resolved.aggs, context, options) };
  const record: RequestRecord = { name: 'Data', index: indexPattern.title, body, startedAt: Date.now() };
  requests.push(record);
  const response = await services.search.search(indexPattern.title, body, { signal, record });
  return { indexPattern, context, table: tabify(resolved.aggs, response, context, options), requests };
}

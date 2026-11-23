/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The request behind a visualization drawn from aggregations: the page's query, filters and
 * time range, the visualization's own, and its aggregations, answered as a table.
 */

import { buildAggsDsl, fieldNameOf, needsFieldBounds, otherBucketAggs, planOtherBucket, requestProblem, tabify, type AggConfig, type AggContext, type Table } from '../lib/aggs';
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

/**
 * Queries without the ones that say what an earlier one says, as the original's context merges
 * them (`uniqBy` on what is typed, whatever the language): the "" of a dashboard and the "" of its
 * visualization ask once
 */
export function uniqueQueries(queries: Array<Query | undefined>): Query[] {
  const seen = new Set<unknown>();
  const out: Query[] = [];
  for (const query of queries) {
    if (!query || seen.has(query.query)) continue;
    seen.add(query.query);
    out.push(query);
  }
  return out;
}

/** Filters that are switched on, without the ones that ask what an earlier one asks: the context's `uniqFilters` */
export function contextFilters(filters: Filter[]): Filter[] {
  const seen = new Set<string>();
  return filters.filter((filter) => {
    if (!filter || filter.meta?.disabled) return false;
    const { meta, $state: _state, ...clause } = filter;
    const key = JSON.stringify([clause, Boolean(meta?.negate)]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The query a visualization's search asks: the page's, its own and its saved search's */
export function visQuery(vis: Vis, indexPattern: IndexPattern, input: VisInput, context: AggContext) {
  const query = buildQuery(
    indexPattern,
    uniqueQueries([input.query, vis.source.query, vis.parent?.query]),
    contextFilters([...input.filters, ...vis.source.filters, ...(vis.parent?.filters ?? [])]),
    context.queryConfig
  );
  const timeFilter = timeRangeFilter(indexPattern, context.timeRange);
  if (timeFilter) query.bool.filter.push(timeFilter);
  return query;
}

/**
 * What is asked to learn how far the fields of number histograms stretch: the smallest and the
 * largest value of each, a scripted field by its script as in the original
 */
export function fieldBoundsAggs(bounded: AggConfig[], indexPattern: IndexPattern): Record<string, unknown> {
  const aggs: Record<string, unknown> = {};
  for (const agg of bounded) {
    const field = fieldNameOf(agg);
    if (!field) continue;
    const scripted = indexPattern.fields.find((candidate) => candidate.name === field && candidate.scripted && candidate.script);
    const body = scripted ? { script: { source: scripted.script, lang: scripted.lang } } : { field };
    aggs[`min_${agg.id}`] = { min: body };
    aggs[`max_${agg.id}`] = { max: body };
  }
  return aggs;
}

/**
 * The body of a visualization's search as the original's search source writes it, in its order:
 * the aggregations, no documents, and what it asks of every document all the same (the stored
 * fields, the scripted fields, the dates as text, the source without the fields the index pattern
 * filters out), then the query. The total is tracked by the search service, as the original's
 * server does it.
 */
export function visSearchBody(indexPattern: IndexPattern, query: unknown, aggs: Record<string, unknown>): Record<string, unknown> {
  const scripted: Record<string, unknown> = {};
  for (const field of indexPattern.fields) {
    if (field.scripted && field.script) scripted[field.name] = { script: { source: field.script, lang: field.lang ?? 'painless' } };
  }
  return {
    aggs,
    size: 0,
    stored_fields: ['*'],
    script_fields: scripted,
    docvalue_fields: indexPattern.fields
      .filter((field) => field.type === 'date' && field.readFromDocValues !== false && !field.scripted && !field.name.startsWith('_'))
      .map((field) => ({ field: field.name, format: 'date_time' })),
    _source: { excludes: (indexPattern.sourceFilters ?? []).map((filter) => filter.value) },
    query,
  };
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
  // As the original, which fails while it writes such a request: nothing is asked, and its error is shown
  const refused = requestProblem(resolved.aggs, context);
  if (refused) throw new Error(refused);

  // A number histogram with an automatic interval needs to know how far its field stretches
  const bounded = resolved.aggs.filter((agg) => agg.enabled !== false && needsFieldBounds(agg));
  if (bounded.length) {
    const aggs = fieldBoundsAggs(bounded, indexPattern);
    const body = visSearchBody(indexPattern, query, aggs);
    // The original keeps no record of this search: Inspect lists the requests after it only
    const answer = await services.search.search(indexPattern.title, body, { signal });
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
  const aggs = buildAggsDsl(resolved.aggs, context, options);
  const body = visSearchBody(indexPattern, query, aggs);
  const record: RequestRecord = {
    name: 'Data',
    index: indexPattern.title,
    indexPatternId: indexPattern.id,
    description: 'This request queries OpenSearch to fetch the data for the visualization.',
    body,
    startedAt: Date.now(),
  };
  requests.push(record);
  const response = await services.search.search(indexPattern.title, body, { signal, record });

  // A terms aggregation that groups the rest asks for the rest once it knows its terms, each in
  // turn, one under another under the rest of the one above too
  for (const other of otherBucketAggs(resolved.aggs)) {
    const rest = planOtherBucket(resolved.aggs, aggs, response, context, other.id);
    if (!rest) continue;
    const otherBody = visSearchBody(indexPattern, query, rest.aggs);
    const otherRecord: RequestRecord = {
      name: 'Other bucket',
      index: indexPattern.title,
      indexPatternId: indexPattern.id,
      description: 'This request counts the number of documents that fall outside the criterion of the data buckets.',
      body: otherBody,
      startedAt: Date.now(),
    };
    requests.push(otherRecord);
    const answer = await services.search.search(indexPattern.title, otherBody, { signal, record: otherRecord });
    rest.apply(answer.aggregations as Record<string, unknown> | undefined);
  }
  return { indexPattern, context, table: tabify(resolved.aggs, response, context, options), requests };
}

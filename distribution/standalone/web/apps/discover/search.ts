/* SPDX-License-Identifier: Apache-2.0 */

/* The request Discover sends: the documents, newest first, and how many fall in each stretch of time. */

import { buildAggsDsl, type AggConfig } from '../../lib/aggs';
import type { AbsoluteRange } from '../../lib/dates';
import { HIGHLIGHT_POST, HIGHLIGHT_PRE } from '../../lib/docs';
import { buildQuery, timeRangeFilter } from '../../lib/query';
import type { Filter, IndexPattern, Query } from '../../lib/types';
import { services } from '../../services';
import type { SortPair } from './doc_table';

export const HISTOGRAM_AGG_ID = '2';

export interface DiscoverRequest {
  indexPattern: IndexPattern;
  query: Query;
  filters: Filter[];
  range?: AbsoluteRange;
  sort: SortPair[];
  size: number;
  /** What the histogram is asked in: auto, or a unit */
  interval?: string;
}

export function histogramAgg(indexPattern: IndexPattern, interval: string | undefined): AggConfig | undefined {
  if (!indexPattern.timeFieldName) return undefined;
  return {
    id: HISTOGRAM_AGG_ID,
    type: 'date_histogram',
    schema: 'segment',
    params: { field: indexPattern.timeFieldName, interval: interval ?? 'auto', min_doc_count: 1 },
  };
}

export function aggContext(indexPattern: IndexPattern, range: AbsoluteRange | undefined) {
  return {
    indexPattern,
    timeRange: range,
    timeZone: services.timeZone(),
    barTarget: services.uiSettings.get<number>('histogram:barTarget', 50),
    maxBars: services.uiSettings.get<number>('histogram:maxBars', 100),
    formatSettings: services.formatSettings(),
    queryConfig: services.queryConfig(),
  };
}

/** What a search for documents asks besides its query: the computed fields, the dates as text */
export function documentFields(indexPattern: IndexPattern): Record<string, unknown> {
  const scripted: Record<string, unknown> = {};
  for (const field of indexPattern.fields) {
    if (field.scripted && field.script) {
      scripted[field.name] = { script: { source: field.script, lang: field.lang ?? 'painless' } };
    }
  }
  const excludes = (indexPattern.sourceFilters ?? []).map((filter) => filter.value);
  return {
    version: true,
    _source: excludes.length ? { excludes } : true,
    stored_fields: ['*'],
    script_fields: scripted,
    docvalue_fields: indexPattern.fields
      .filter((field) => field.type === 'date' && field.readFromDocValues !== false && !field.scripted && !field.name.startsWith('_'))
      .map((field) => ({ field: field.name, format: 'date_time' })),
  };
}

export function sortClause(indexPattern: IndexPattern, sort: SortPair[]): Array<Record<string, unknown>> {
  const options = services.uiSettings.get<Record<string, unknown>>('sort:options', { unmapped_type: 'boolean' });
  const pairs = sort.length
    ? sort
    : indexPattern.timeFieldName
      ? [[indexPattern.timeFieldName, services.uiSettings.get<string>('discover:sort:defaultOrder', 'desc')] as SortPair]
      : [];
  if (pairs.length === 0) return [{ _score: { order: 'desc' } }];
  return pairs.map(([name, direction]) => {
    const field = indexPattern.fields.find((candidate) => candidate.name === name);
    if (field?.scripted && field.script) {
      return {
        _script: {
          script: { source: field.script, lang: field.lang ?? 'painless' },
          type: field.type === 'number' ? 'number' : 'string',
          order: direction,
        },
      };
    }
    return { [name]: { order: direction, ...options } };
  });
}

export function buildDiscoverRequest(request: DiscoverRequest): Record<string, unknown> {
  const { indexPattern, range } = request;
  const query = buildQuery(indexPattern, [request.query], request.filters, services.queryConfig());
  const timeFilter = timeRangeFilter(indexPattern, range);
  if (timeFilter) query.bool.filter.push(timeFilter);
  const body: Record<string, unknown> = {
    ...documentFields(indexPattern),
    size: request.size,
    sort: sortClause(indexPattern, request.sort),
    query,
    highlight: services.uiSettings.get('doc_table:highlight', true)
      ? {
          pre_tags: [HIGHLIGHT_PRE],
          post_tags: [HIGHLIGHT_POST],
          fields: { '*': {} },
          fragment_size: 2147483647,
        }
      : undefined,
  };
  const histogram = histogramAgg(indexPattern, request.interval);
  if (histogram && range) body.aggs = buildAggsDsl([histogram], aggContext(indexPattern, range));
  return body;
}

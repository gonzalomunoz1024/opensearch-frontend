/* SPDX-License-Identifier: Apache-2.0 */

/* The request Discover sends: the documents, newest first, and how many fall in each stretch of time. */

import { buildAggsDsl, type AggConfig } from '../../lib/aggs';
import { resolveTimeRange, type AbsoluteRange, type TimeRange } from '../../lib/dates';
import { HIGHLIGHT_POST, HIGHLIGHT_PRE } from '../../lib/docs';
import { buildQuery, timeRangeFilter } from '../../lib/query';
import type { Filter, IndexPattern, Query } from '../../lib/types';
import { services } from '../../services';
import { isSortable, type SortPair } from './doc_table';

export const HISTOGRAM_AGG_ID = '2';

export interface DiscoverRequest {
  indexPattern: IndexPattern;
  /** One query, or several that must all hold: a dashboard's and a saved search's */
  query: Query | Query[];
  filters: Filter[];
  range?: AbsoluteRange;
  sort: SortPair[];
  size: number;
  /** What the histogram is asked in: auto, or a unit */
  interval?: string;
  /** Leave the histogram out: a saved search on a dashboard shows only its documents */
  documentsOnly?: boolean;
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

/**
 * The fields: ['*'] that the setting search:includeAllFields adds to every search the original
 * makes through its search source (Discover's, a saved search's, the context view's; not the
 * single document's)
 */
export function allFields(include = services.uiSettings.get<boolean>('search:includeAllFields', false)): Record<string, unknown> {
  return include ? { fields: ['*'] } : {};
}

/**
 * The sort of a search, as the original's getSortForSearchSource and normalizeSortRequest make
 * it: the chosen fields that can be sorted on (any other is left out), or else the time field or
 * the score in the order of discover:sort:defaultOrder; a scripted field by its script; and the
 * options of sort:options, without the unmapped_type on the score, which OpenSearch refuses there
 */
export function sortClause(
  indexPattern: IndexPattern,
  sort: SortPair[],
  options = services.uiSettings.get<Record<string, unknown>>('sort:options', { unmapped_type: 'boolean' }),
  defaultOrder = services.uiSettings.get<string>('discover:sort:defaultOrder', 'desc')
): Array<Record<string, unknown>> {
  const fieldOf = (name: string) => indexPattern.fields.find((candidate) => candidate.name === name);
  const timeField = indexPattern.timeFieldName;
  const pairs: SortPair[] = sort.length
    ? sort
    : [[timeField && isSortable(fieldOf(timeField), timeField) ? timeField : '_score', defaultOrder === 'asc' ? 'asc' : 'desc']];
  const { unmapped_type: _unmapped, ...scoreOptions } = options;
  return pairs
    .filter(([name]) => isSortable(fieldOf(name), name))
    .map(([name, direction]) => {
      const field = fieldOf(name);
      if (field?.scripted && field.script) {
        return {
          _script: {
            script: { source: field.script, lang: field.lang ?? 'painless' },
            type: field.type === 'number' ? 'number' : 'string',
            order: direction,
          },
        };
      }
      return { [name]: { order: direction, ...(name === '_score' ? scoreOptions : options) } };
    });
}

/**
 * The time range Discover searches a pattern in: none for a pattern without a time field; for one
 * with a time field, the range of the time picker, or `null` when that cannot be read, which the
 * original's Discover does not search in at all (it says the time range is invalid)
 */
export function searchTimeRange(indexPattern: IndexPattern, time: TimeRange, weekStart?: number): AbsoluteRange | null | undefined {
  if (!indexPattern.timeFieldName) return undefined;
  return resolveTimeRange(time, { weekStart }) ?? null;
}

export function buildDiscoverRequest(request: DiscoverRequest): Record<string, unknown> {
  const { indexPattern, range } = request;
  const query = buildQuery(indexPattern, request.query, request.filters, services.queryConfig());
  const timeFilter = timeRangeFilter(indexPattern, range);
  if (timeFilter) query.bool.filter.push(timeFilter);
  const body: Record<string, unknown> = {
    ...documentFields(indexPattern),
    ...allFields(),
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
  const histogram = request.documentsOnly ? undefined : histogramAgg(indexPattern, request.interval);
  if (histogram && range) body.aggs = buildAggsDsl([histogram], aggContext(indexPattern, range));
  return body;
}

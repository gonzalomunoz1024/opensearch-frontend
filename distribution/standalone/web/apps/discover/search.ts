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

/**
 * The interval the state holds as the original's TimeBuckets reads it: a text, or the `val` of a
 * choice (an object); anything else is none, and the histogram is auto
 */
export function stateInterval(value: unknown): string | undefined {
  const chosen: unknown = typeof value === 'object' && value !== null && 'val' in value ? value.val : value;
  return typeof chosen === 'string' && chosen !== '' ? chosen : undefined;
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
    // As the original's TimeBuckets: the interval suits the time between the two ends, whichever
    // comes first (the search keeps them as they are)
    timeRange: range && range.from.getTime() > range.to.getTime() ? { from: range.to, to: range.from } : range,
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
 * The type OpenSearch sorts a scripted field's values as, as the original's castSortType gives
 * it: a number as a number, a string or a boolean as a string; it sorts no other, and the original
 * fails the search before it is sent
 */
export function scriptSortType(type: string): 'number' | 'string' {
  if (type === 'number') return 'number';
  if (type === 'string' || type === 'boolean') return 'string';
  throw new Error(`Unsupported script sort type: ${type}`);
}

/** Whether the pattern's time field holds nanoseconds (date_nanos), as the original's isTimeNanosBased */
export function isTimeNanosBased(indexPattern: IndexPattern): boolean {
  const { timeFieldName } = indexPattern;
  if (!timeFieldName) return false;
  const field = indexPattern.fields.find((candidate) => candidate.name === timeFieldName);
  return Boolean(field?.esTypes?.includes('date_nanos'));
}

/**
 * The sort of a search, as the original's getSortForSearchSource and normalizeSortRequest make
 * it: the chosen fields that can be sorted on (any other is left out), or else the time field or
 * the score in the order of discover:sort:defaultOrder; a scripted field by its script, as a
 * number or a string (any other type throws, as the original's); and the options of
 * sort:options, without the unmapped_type on the score, which OpenSearch refuses there
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
            type: scriptSortType(field.type),
            order: direction,
          },
        };
      }
      return { [name]: { order: direction, ...(name === '_score' ? scoreOptions : options) } };
    });
}

/**
 * The sort Discover and a saved search's panel send, as the original's getSortForSearchSource
 * hands it to the search source: on a pattern whose time field holds nanoseconds, the time field
 * is sorted with numeric_type date_nanos, so that indices holding it as a date and as nanoseconds
 * sort alike. Other searches (VisBuilder's sample) sort as sortClause alone does, as there
 */
export function discoverSort(
  indexPattern: IndexPattern,
  sort: SortPair[],
  options?: Record<string, unknown>,
  defaultOrder?: string
): Array<Record<string, unknown>> {
  const clauses = sortClause(indexPattern, sort, options, defaultOrder);
  const timeField = indexPattern.timeFieldName;
  if (!timeField || !isTimeNanosBased(indexPattern)) return clauses;
  return clauses.map((clause) => {
    const value = clause[timeField];
    if (typeof value !== 'object' || value === null) return clause;
    const { order, ...rest } = value as Record<string, unknown>;
    return { [timeField]: { order, numeric_type: 'date_nanos', ...rest } };
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
    sort: discoverSort(indexPattern, request.sort),
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

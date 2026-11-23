/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Aggregations as a saved visualization holds them (`aggs` in its state: an id, a type, the
 * part it plays, its parameters), turned into the request OpenSearch takes and, from the
 * answer, into a table: one column per bucket level and per metric, one row per combination.
 * Every chart is drawn from that table. The parameters and the labels are those of OpenSearch
 * Dashboards, so a visualization saved there asks and says the same here.
 */

import {
  UNIT_MS,
  addUnits,
  formatDate,
  parseDateMath,
  parseInterval,
  resolveInterval,
  scaledDateFormat,
  type AbsoluteRange,
  type Interval,
  type TimeUnit,
} from './dates';
import {
  DEFAULT_FORMAT_SETTINGS,
  createFormatter,
  formatSpecOf,
  type FormatSettings,
} from './field_formats';
import { buildQuery, existsFilter, phraseFilter, rangeFilter, customFilter } from './query';
import type { Field, FieldFormatSpec, Filter, IndexPattern, Query } from './types';

type Dsl = Record<string, unknown>;

export interface AggConfig {
  id: string;
  enabled?: boolean;
  type: string;
  /** The part it plays in the chart: metric, segment, group, split, bucket, radius */
  schema?: string;
  params?: Record<string, unknown>;
}

export interface AggContext {
  indexPattern?: IndexPattern;
  /** The time range of the page: an automatic interval is chosen for it */
  timeRange?: AbsoluteRange;
  /** The zone date buckets are cut in */
  timeZone?: string;
  barTarget?: number;
  maxBars?: number;
  formatSettings?: FormatSettings;
  /** The smallest and largest value of a field, for a number histogram with an automatic interval */
  fieldBounds?: Record<string, { min: number; max: number }>;
  queryConfig?: Parameters<typeof buildQuery>[3];
}

export const METRIC_TYPES = [
  'count',
  'avg',
  'sum',
  'median',
  'min',
  'max',
  'std_dev',
  'cardinality',
  'percentiles',
  'percentile_ranks',
  'top_hits',
  'avg_bucket',
  'sum_bucket',
  'min_bucket',
  'max_bucket',
  'derivative',
  'cumulative_sum',
  'moving_avg',
  'serial_diff',
] as const;

export const BUCKET_TYPES = [
  'date_histogram',
  'histogram',
  'range',
  'date_range',
  'ip_range',
  'terms',
  'filters',
  'significant_terms',
  'geohash_grid',
] as const;

const SIBLING_PIPELINES = new Set(['avg_bucket', 'sum_bucket', 'min_bucket', 'max_bucket']);
const PARENT_PIPELINES = new Set(['derivative', 'cumulative_sum', 'moving_avg', 'serial_diff']);

export const isMetricAgg = (agg: AggConfig) => (METRIC_TYPES as readonly string[]).includes(agg.type);
export const isBucketAgg = (agg: AggConfig) => !isMetricAgg(agg);

export const AGG_TITLES: Record<string, string> = {
  count: 'Count',
  avg: 'Average',
  sum: 'Sum',
  median: 'Median',
  min: 'Min',
  max: 'Max',
  std_dev: 'Standard Deviation',
  cardinality: 'Unique Count',
  percentiles: 'Percentiles',
  percentile_ranks: 'Percentile Ranks',
  top_hits: 'Top Hit',
  avg_bucket: 'Average Bucket',
  sum_bucket: 'Sum Bucket',
  min_bucket: 'Min Bucket',
  max_bucket: 'Max Bucket',
  derivative: 'Derivative',
  cumulative_sum: 'Cumulative Sum',
  moving_avg: 'Moving Avg',
  serial_diff: 'Serial Diff',
  date_histogram: 'Date Histogram',
  histogram: 'Histogram',
  range: 'Range',
  date_range: 'Date Range',
  ip_range: 'IPv4 Range',
  terms: 'Terms',
  filters: 'Filters',
  significant_terms: 'Significant Terms',
  geohash_grid: 'Geohash',
};

const param = <T>(agg: AggConfig, name: string, fallback: T): T => {
  const value = agg.params?.[name];
  return value === undefined || value === null || value === '' ? fallback : (value as T);
};

/** The name of the field an aggregation is on: a saved one holds it as text */
export function fieldNameOf(agg: AggConfig): string | undefined {
  const field = agg.params?.field as string | { name?: string } | undefined;
  return typeof field === 'string' ? field : field?.name;
}

const fieldOf = (agg: AggConfig, context: AggContext): Field | undefined => {
  const name = fieldNameOf(agg);
  return name ? context.indexPattern?.fields.find((field) => field.name === name) : undefined;
};

/** How an aggregation names a field in a request: by name, or by its script */
function fieldClause(agg: AggConfig, context: AggContext): Dsl {
  const field = fieldOf(agg, context);
  if (field?.scripted && field.script) {
    // Without the type the values of a script come back as text, and sort as text
    const valueType = field.type === 'number' ? 'float' : field.type === 'date' ? 'date' : field.type === 'boolean' ? 'boolean' : undefined;
    return { script: { source: field.script, lang: field.lang ?? 'painless' }, ...(valueType ? { value_type: valueType } : {}) };
  }
  return { field: fieldNameOf(agg) };
}

const ordinal = (value: number) => {
  const last = value % 10;
  const lastTwo = value % 100;
  if (!Number.isInteger(value)) return `${value}th`;
  if (last === 1 && lastTwo !== 11) return `${value}st`;
  if (last === 2 && lastTwo !== 12) return `${value}nd`;
  if (last === 3 && lastTwo !== 13) return `${value}rd`;
  return `${value}th`;
};

// --- Intervals ------------------------------------------------------------------------------------

const INTERVAL_NAMES: Record<string, string> = {
  ms: 'millisecond',
  s: 'second',
  m: 'minute',
  h: 'hour',
  d: 'day',
  w: 'week',
  M: 'month',
  y: 'year',
};

/** The interval of a date histogram: the one it asks for, or one that suits the time range */
export function dateInterval(agg: AggConfig, context: AggContext): Interval & { scaled: boolean } {
  let requested = param<string>(agg, 'interval', 'auto');
  if (requested === 'custom') requested = param<string>(agg, 'customInterval', 'auto');
  if (INTERVAL_NAMES[requested]) requested = `1${requested}`;
  const range = context.timeRange;
  const duration = range ? range.to.getTime() - range.from.getTime() : 0;
  if ((requested === 'auto' || !parseInterval(requested)) && !range) {
    return { ...parseInterval('1d')!, scaled: false };
  }
  return resolveInterval(requested, duration, {
    targetBuckets: context.barTarget ?? 50,
    maxBuckets: context.maxBars ?? 100,
  });
}

function dateIntervalClause(interval: Interval): Dsl {
  const match = /^(\d+(?:\.\d+)?)(ms|[smhdwMy])$/.exec(interval.expression);
  const amount = match ? Number(match[1]) : 1;
  const unit = match ? match[2] : 'd';
  if (amount === 1 && unit !== 'ms' && unit !== 's') return { calendar_interval: `1${unit}` };
  // A fixed interval knows no weeks, months or years
  if (unit === 'w') return { fixed_interval: `${amount * 7}d` };
  if (unit === 'M') return { fixed_interval: `${amount * 30}d` };
  if (unit === 'y') return { fixed_interval: `${amount * 365}d` };
  return { fixed_interval: `${amount}${unit}` };
}

/** The step of a number histogram: the one it asks for, or one that gives a readable number of bars */
export function numberInterval(agg: AggConfig, context: AggContext): number {
  const requested = agg.params?.interval;
  const asked = typeof requested === 'number' ? requested : Number(requested);
  const bounds = context.fieldBounds?.[fieldNameOf(agg) ?? ''];
  const maxBars = context.maxBars ?? 100;
  if (Number.isFinite(asked) && asked > 0) {
    // An interval that would give too many bars is widened, as OpenSearch Dashboards does
    if (bounds && (bounds.max - bounds.min) / asked > maxBars) {
      return roundInterval((bounds.max - bounds.min) / maxBars);
    }
    return asked;
  }
  if (!bounds || bounds.max <= bounds.min) return 1;
  return roundInterval((bounds.max - bounds.min) / Math.min(maxBars, context.barTarget ?? 50));
}

function roundInterval(raw: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / magnitude;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return nice * magnitude;
}

/** Whether an aggregation needs the smallest and largest value of its field before it can be asked */
export const needsFieldBounds = (agg: AggConfig) =>
  agg.type === 'histogram' && (agg.params?.interval === 'auto' || agg.params?.interval === undefined);

// --- Labels ---------------------------------------------------------------------------------------

export function aggLabel(agg: AggConfig, context: AggContext): string {
  const custom = agg.params?.customLabel;
  if (typeof custom === 'string' && custom !== '') return custom;
  const field = fieldNameOf(agg) ?? '';
  switch (agg.type) {
    case 'count':
      return 'Count';
    case 'avg':
      return `Average ${field}`;
    case 'sum':
      return `Sum of ${field}`;
    case 'median':
      return `Median ${field}`;
    case 'min':
      return `Min ${field}`;
    case 'max':
      return `Max ${field}`;
    case 'std_dev':
      return `Standard Deviation of ${field}`;
    case 'cardinality':
      return `Unique count of ${field}`;
    case 'percentiles':
      return `Percentiles of ${field}`;
    case 'percentile_ranks':
      return `Percentile ranks of ${field}`;
    case 'top_hits': {
      const size = param<number>(agg, 'size', 1);
      const last = param<string>(agg, 'sortOrder', 'desc') === 'desc';
      return `${last ? 'Last' : 'First'}${size > 1 ? ` ${size}` : ''} ${field}`;
    }
    case 'avg_bucket':
    case 'sum_bucket':
    case 'min_bucket':
    case 'max_bucket': {
      const word = { avg_bucket: 'Average', sum_bucket: 'Sum', min_bucket: 'Min', max_bucket: 'Max' }[agg.type];
      const metric = agg.params?.customMetric as AggConfig | undefined;
      return `Overall ${word} of ${metric ? aggLabel(metric, context) : 'Count'}`;
    }
    case 'derivative':
    case 'cumulative_sum':
    case 'moving_avg':
    case 'serial_diff': {
      const word = {
        derivative: 'Derivative',
        cumulative_sum: 'Cumulative Sum',
        moving_avg: 'Moving Avg',
        serial_diff: 'Serial Diff',
      }[agg.type];
      const metric = agg.params?.customMetric as AggConfig | undefined;
      return `${word} of ${metric ? aggLabel(metric, context) : 'Count'}`;
    }
    case 'date_histogram': {
      const interval = dateInterval(agg, context);
      return `${field} per ${interval.description}`;
    }
    case 'histogram':
      return field;
    case 'range':
      return `${field} ranges`;
    case 'date_range':
      return `${field} date ranges`;
    case 'ip_range':
      return `${field} IP ranges`;
    case 'terms': {
      const order = param<string>(agg, 'order', 'desc') === 'asc' ? 'Ascending' : 'Descending';
      return `${field}: ${order}`;
    }
    case 'significant_terms':
      return `Top ${param<number>(agg, 'size', 10)} unusual terms in ${field}`;
    case 'filters':
      return 'filters';
    case 'geohash_grid':
      // makeLabel of the geohash_grid
      return 'Geohash';
    default:
      return field || agg.type;
  }
}

// --- The request ----------------------------------------------------------------------------------

/** The clause or clauses of a metric, by the key its values are read back under */
function metricDsl(agg: AggConfig, context: AggContext, all: AggConfig[]): Dsl {
  const field = fieldClause(agg, context);
  switch (agg.type) {
    case 'count':
      return {};
    case 'avg':
    case 'sum':
    case 'min':
    case 'max':
      return { [agg.id]: { [agg.type]: field } };
    case 'cardinality':
      return { [agg.id]: { cardinality: field } };
    case 'median':
      return { [agg.id]: { percentiles: { ...field, percents: [50] } } };
    case 'std_dev':
      return { [agg.id]: { extended_stats: field } };
    case 'percentiles':
      return {
        [agg.id]: {
          percentiles: { ...field, percents: param(agg, 'percents', [1, 5, 25, 50, 75, 95, 99]) },
        },
      };
    case 'percentile_ranks':
      return { [agg.id]: { percentile_ranks: { ...field, values: param(agg, 'values', [0]) } } };
    case 'top_hits': {
      const sortField = param<string | { name: string }>(agg, 'sortField', '');
      const sortName = typeof sortField === 'string' ? sortField : sortField.name;
      return {
        [agg.id]: {
          top_hits: {
            size: param(agg, 'size', 1),
            _source: fieldNameOf(agg),
            docvalue_fields: fieldNameOf(agg) ? [{ field: fieldNameOf(agg) }] : undefined,
            sort: sortName
              ? [{ [sortName]: { order: param(agg, 'sortOrder', 'desc'), unmapped_type: 'boolean' } }]
              : undefined,
          },
        },
      };
    }
    default:
      break;
  }
  if (SIBLING_PIPELINES.has(agg.type)) {
    const bucket = agg.params?.customBucket as AggConfig | undefined;
    const metric = agg.params?.customMetric as AggConfig | undefined;
    if (!bucket) return {};
    const bucketId = `${agg.id}-bucket`;
    const metricId = `${agg.id}-metric`;
    const inner = metric && metric.type !== 'count' ? metricDsl({ ...metric, id: metricId }, context, all) : {};
    return {
      [bucketId]: {
        ...bucketClause({ ...bucket, id: bucketId }, context),
        ...(Object.keys(inner).length ? { aggs: inner } : {}),
      },
      [agg.id]: {
        [agg.type]: {
          buckets_path: `${bucketId}>${Object.keys(inner).length ? metricId : '_count'}`,
        },
      },
    };
  }
  if (PARENT_PIPELINES.has(agg.type)) {
    const target = param<string>(agg, 'metricAgg', 'custom');
    const out: Dsl = {};
    let path: string;
    if (target === 'custom') {
      const metric = agg.params?.customMetric as AggConfig | undefined;
      if (!metric || metric.type === 'count') path = '_count';
      else {
        path = `${agg.id}-metric`;
        Object.assign(out, metricDsl({ ...metric, id: path }, context, all));
      }
    } else {
      const other = all.find((candidate) => candidate.id === target);
      path = !other || other.type === 'count' ? '_count' : target;
    }
    const own: Dsl = { buckets_path: path };
    if (agg.type === 'moving_avg') {
      // OpenSearch has the moving function in place of the moving average
      out[agg.id] = {
        moving_fn: {
          buckets_path: path,
          window: param(agg, 'window', 5),
          script: param(agg, 'script', 'MovingFunctions.unweightedAvg(values)'),
        },
      };
    } else out[agg.id] = { [agg.type]: own };
    return out;
  }
  return {};
}

function queryOf(input: Query | undefined, context: AggContext): Dsl {
  const text = typeof input?.query === 'string' ? input.query.trim() : '';
  if (!input || text === '' || text === '*') return { match_all: {} };
  return buildQuery(context.indexPattern, [input], [], context.queryConfig) as unknown as Dsl;
}

const filterLabel = (filter: { input?: Query; label?: string }) => {
  if (filter.label) return filter.label;
  const text = typeof filter.input?.query === 'string' ? filter.input.query.trim() : '';
  return text === '' ? '*' : text;
};

/** A bucket aggregation's own clause, without what is nested in it */
function bucketClause(agg: AggConfig, context: AggContext): Dsl {
  const field = fieldClause(agg, context);
  switch (agg.type) {
    case 'date_histogram': {
      const interval = dateInterval(agg, context);
      const bounds = agg.params?.extended_bounds as { min?: unknown; max?: unknown } | undefined;
      const minimum = Number(param<number | string>(agg, 'min_doc_count', 1));
      const clause: Dsl = {
        ...field,
        ...dateIntervalClause(interval),
        time_zone: context.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
        min_doc_count: Number.isFinite(minimum) ? minimum : 1,
      };
      const min = boundOf(bounds?.min);
      const max = boundOf(bounds?.max);
      if (min !== undefined || max !== undefined) clause.extended_bounds = { min, max };
      else if (clause.min_doc_count === 0 && context.timeRange) {
        clause.extended_bounds = {
          min: context.timeRange.from.getTime(),
          max: context.timeRange.to.getTime(),
        };
      }
      return { date_histogram: clause };
    }
    case 'histogram': {
      const clause: Dsl = {
        ...field,
        interval: numberInterval(agg, context),
        min_doc_count: agg.params?.min_doc_count ? 0 : 1,
      };
      const bounds = agg.params?.extended_bounds as { min?: unknown; max?: unknown } | undefined;
      const min = numberOf(bounds?.min);
      const max = numberOf(bounds?.max);
      if (agg.params?.has_extended_bounds !== false && (min !== undefined || max !== undefined)) {
        clause.extended_bounds = { min, max };
        clause.min_doc_count = 0;
      }
      return { histogram: clause };
    }
    case 'range':
      return {
        range: {
          ...field,
          ranges: param<Array<{ from?: number; to?: number }>>(agg, 'ranges', [
            { from: 0, to: 1000 },
            { from: 1000, to: 2000 },
          ]).map((range) => ({ from: numberOf(range.from), to: numberOf(range.to) })),
        },
      };
    case 'date_range':
      return {
        date_range: {
          ...field,
          ranges: param<Array<{ from?: string; to?: string }>>(agg, 'ranges', [
            { from: 'now-1w/w', to: 'now' },
          ]).map((range) => ({ from: range.from || undefined, to: range.to || undefined })),
          time_zone: context.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      };
    case 'ip_range': {
      const kind = param<string>(agg, 'ipRangeType', 'fromTo');
      const ranges = (agg.params?.ranges ?? {}) as {
        fromTo?: Array<{ from?: string; to?: string }>;
        mask?: Array<{ mask: string }>;
      };
      return {
        ip_range: {
          ...field,
          ranges:
            kind === 'mask'
              ? (ranges.mask ?? [{ mask: '0.0.0.0/1' }, { mask: '128.0.0.0/2' }])
              : (ranges.fromTo ?? [
                  { from: '0.0.0.0', to: '127.255.255.255' },
                  { from: '128.0.0.0', to: '191.255.255.255' },
                ]),
        },
      };
    }
    case 'terms': {
      const clause: Dsl = {
        ...field,
        size: param(agg, 'size', 5),
        order: { _count: param(agg, 'order', 'desc') },
      };
      if (agg.params?.missingBucket) clause.missing = MISSING_KEY;
      const include = agg.params?.include;
      const exclude = agg.params?.exclude;
      if (typeof include === 'string' && include !== '') clause.include = include;
      if (typeof exclude === 'string' && exclude !== '') clause.exclude = exclude;
      return { terms: clause };
    }
    case 'significant_terms':
      return { significant_terms: { ...field, size: param(agg, 'size', 10) } };
    case 'filters': {
      const filters: Record<string, Dsl> = {};
      for (const filter of param<Array<{ input?: Query; label?: string }>>(agg, 'filters', [])) {
        filters[filterLabel(filter)] = queryOf(filter.input, context);
      }
      if (Object.keys(filters).length === 0) filters['*'] = { match_all: {} };
      return { filters: { filters } };
    }
    case 'geohash_grid':
      return {
        geohash_grid: { ...field, precision: Math.min(12, Math.max(1, param(agg, 'precision', 2))) },
      };
    default:
      return { [agg.type]: field };
  }
}

export const MISSING_KEY = '__missing__';

/** A clause with what someone wrote under "JSON input" merged into it */
function withJson(agg: AggConfig, clause: Dsl): Dsl {
  const json = agg.params?.json;
  if (typeof json !== 'string' || json.trim() === '') return clause;
  let extra: unknown;
  try {
    extra = JSON.parse(json);
  } catch {
    return clause;
  }
  if (extra === null || typeof extra !== 'object' || Array.isArray(extra)) return clause;
  const [type] = Object.keys(clause);
  if (!type || clause[type] === null || typeof clause[type] !== 'object') return clause;
  return { ...clause, [type]: { ...(clause[type] as Dsl), ...(extra as Dsl) } };
}

function numberOf(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function boundOf(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'number') return value;
  const date = parseDateMath(String(value)) ?? new Date(String(value));
  return Number.isNaN(date.getTime()) ? undefined : date.getTime();
}

const enabled = (aggs: AggConfig[]) => aggs.filter((agg) => agg.enabled !== false);

export interface BuildOptions {
  /** Ask for the metrics at every bucket level, not at the deepest only: a table that shows them all */
  metricsAtAllLevels?: boolean;
}

/** The `aggs` of a search request for a visualization's aggregations */
export function buildAggsDsl(aggs: AggConfig[], context: AggContext, options: BuildOptions = {}): Dsl {
  const active = enabled(aggs);
  const metrics = active.filter(isMetricAgg);
  const buckets = active.filter(isBucketAgg);

  const metricsDsl = (insideHistogram: boolean): Dsl => {
    const out: Dsl = {};
    for (const metric of metrics) {
      // A derivative has nothing to derive from outside a histogram
      if (PARENT_PIPELINES.has(metric.type) && !insideHistogram) continue;
      const own = metricDsl(metric, context, metrics);
      if (own[metric.id]) own[metric.id] = withJson(metric, own[metric.id] as Dsl);
      Object.assign(out, own);
    }
    return out;
  };

  const nest = (level: number, insideHistogram: boolean): Dsl => {
    if (level === buckets.length) return metricsDsl(insideHistogram);
    const agg = buckets[level];
    const isHistogram = agg.type === 'date_histogram' || agg.type === 'histogram';
    const deeper = nest(level + 1, isHistogram);
    const own: Dsl = { ...deeper };
    if (options.metricsAtAllLevels && level < buckets.length - 1) Object.assign(own, metricsDsl(isHistogram));
    const clause = withJson(agg, bucketClause(agg, context));

    if (agg.type === 'terms') {
      const terms = clause.terms as Dsl;
      const direction = param<string>(agg, 'order', 'desc');
      const orderBy = param<string>(agg, 'orderBy', '_count');
      if (orderBy === '_key' || orderBy === '_term') terms.order = { _key: direction };
      else if (orderBy === 'custom') {
        const orderAgg = agg.params?.orderAgg as AggConfig | undefined;
        if (orderAgg && orderAgg.type !== 'count') {
          const id = orderAgg.id ?? `${agg.id}-orderAgg`;
          Object.assign(own, metricDsl({ ...orderAgg, id }, context, metrics));
          terms.order = { [orderPath(orderAgg, id)]: direction };
        }
      } else {
        const metric = metrics.find((candidate) => candidate.id === orderBy);
        if (metric && metric.type !== 'count' && !SIBLING_PIPELINES.has(metric.type) && !PARENT_PIPELINES.has(metric.type)) {
          Object.assign(own, metricDsl(metric, context, metrics));
          terms.order = { [orderPath(metric, metric.id)]: direction };
        }
      }
    }
    if (agg.type === 'geohash_grid' && agg.params?.useGeocentroid !== false) {
      own[geoCentroidId(aggs)] = { geo_centroid: { field: fieldNameOf(agg) } };
    }
    const dsl = { [agg.id]: { ...clause, ...(Object.keys(own).length ? { aggs: own } : {}) } };
    return agg.type === 'geohash_grid' ? withGeoCollar(agg, dsl) : dsl;
  };

  return nest(0, false);
}

/** The id the original gives the geo_centroid it asks for beside a geohash_grid: the next free one */
export const geoCentroidId = (aggs: AggConfig[]) => String(aggs.reduce((max, agg) => Math.max(max, Number(agg.id) || 0), 0) + 1);

/** What a geohash_grid that is filtered by the collar asks before the map's size is known */
export const DEFAULT_GEO_BOUNDING_BOX = { top_left: { lat: 1, lon: 1 }, bottom_right: { lat: 0, lon: 0 } };

/** A geohash_grid filtered by the collar sits in a `filter_agg` of geo_bounding_box, as the original's */
function withGeoCollar(agg: AggConfig, dsl: Dsl): Dsl {
  const field = fieldNameOf(agg);
  if (agg.params?.isFilteredByCollar === false || !field) return dsl;
  const box = (agg.params?.boundingBox as Dsl | null | undefined) || DEFAULT_GEO_BOUNDING_BOX;
  return { filter_agg: { filter: { geo_bounding_box: { ignore_unmapped: true, [field]: box } }, aggs: dsl } };
}

function orderPath(metric: AggConfig, id: string): string {
  if (metric.type === 'median') return `${id}.50`;
  if (metric.type === 'std_dev') return `${id}.std_deviation`;
  if (metric.type === 'percentiles') {
    return `${id}.${param<number[]>(metric, 'percents', [50])[0]}`;
  }
  return id;
}

// --- The table ------------------------------------------------------------------------------------

export interface RangeKey {
  gte?: number | string;
  lt?: number | string;
  /** What OpenSearch called the bucket */
  label?: string;
}

export interface TableColumn {
  id: string;
  name: string;
  kind: 'bucket' | 'metric';
  agg: AggConfig;
  /** The part the aggregation plays in the chart */
  schema?: string;
  fieldName?: string;
  /** A value of the column as text */
  format: (value: unknown) => string;
  /** For a date histogram: the width of a bucket in milliseconds; for a number histogram, its step */
  interval?: number;
  isDate?: boolean;
  /** For the buckets of a `filters` aggregation: the query of each label */
  filterQueries?: Record<string, Dsl>;
  /** Which value of a metric with several this column is: a percentile, a bound */
  valueKey?: string;
}

export type TableRow = Record<string, unknown>;

export interface Table {
  columns: TableColumn[];
  rows: TableRow[];
}

type Bucket = Record<string, unknown> & { doc_count?: number; key?: unknown; key_as_string?: string };

function formatterFor(agg: AggConfig, context: AggContext, asType?: 'number' | 'percent'): (value: unknown) => string {
  const settings = context.formatSettings ?? DEFAULT_FORMAT_SETTINGS;
  const field = fieldOf(agg, context);
  let spec: FieldFormatSpec;
  if (asType === 'percent') spec = { id: 'percent' };
  else if (asType === 'number' || !field) spec = { id: 'number' };
  else spec = formatSpecOf(field, context.indexPattern, settings);
  const formatter = createFormatter(spec, settings);
  return (value) => (value === null || value === undefined ? '-' : formatter(value).text);
}

function metricColumns(agg: AggConfig, context: AggContext, prefix: string): TableColumn[] {
  const base = {
    kind: 'metric' as const,
    agg,
    schema: agg.schema,
    fieldName: fieldNameOf(agg),
  };
  const label = aggLabel(agg, context);
  const field = fieldNameOf(agg) ?? '';
  const custom = typeof agg.params?.customLabel === 'string' && agg.params.customLabel !== '';
  switch (agg.type) {
    case 'count':
    case 'cardinality':
      return [{ ...base, id: `${prefix}${agg.id}`, name: label, format: formatterFor(agg, context, 'number') }];
    case 'percentiles':
      return param<number[]>(agg, 'percents', [1, 5, 25, 50, 75, 95, 99]).map((percent) => ({
        ...base,
        id: `${prefix}${agg.id}.${percent}`,
        name: custom ? `${ordinal(percent)} percentile of ${label}` : `${ordinal(percent)} percentile of ${field}`,
        format: formatterFor(agg, context),
        valueKey: String(percent),
      }));
    case 'percentile_ranks':
      return param<number[]>(agg, 'values', [0]).map((value) => ({
        ...base,
        id: `${prefix}${agg.id}.${value}`,
        name: `Percentile rank ${value} of "${custom ? label : field}"`,
        format: (ratio: unknown) =>
          ratio === null || ratio === undefined ? '-' : formatterFor(agg, context, 'percent')(Number(ratio) / 100),
        valueKey: String(value),
      }));
    case 'std_dev':
      return [
        { ...base, id: `${prefix}${agg.id}.std_lower`, name: `Lower ${label}`, format: formatterFor(agg, context), valueKey: 'lower' },
        { ...base, id: `${prefix}${agg.id}.std_upper`, name: `Upper ${label}`, format: formatterFor(agg, context), valueKey: 'upper' },
      ];
    default: {
      // A pipeline is shown the way the metric it works on is
      const inner = agg.params?.customMetric as AggConfig | undefined;
      const formatted = inner && inner.type !== 'count' ? inner : agg;
      const numeric = (SIBLING_PIPELINES.has(agg.type) || PARENT_PIPELINES.has(agg.type)) && (!inner || inner.type === 'count');
      return [
        {
          ...base,
          id: `${prefix}${agg.id}`,
          name: label,
          format: formatterFor(formatted, context, numeric ? 'number' : undefined),
        },
      ];
    }
  }
}

function findKeyed(values: Record<string, unknown> | undefined, wanted: string): unknown {
  if (!values) return undefined;
  if (wanted in values) return values[wanted];
  const target = Number(wanted);
  for (const [key, value] of Object.entries(values)) {
    if (Number(key) === target) return value;
  }
  return undefined;
}

function metricValue(column: TableColumn, bucket: Bucket): unknown {
  const { agg } = column;
  const data = bucket[agg.id] as Record<string, unknown> | undefined;
  switch (agg.type) {
    case 'count':
      return bucket.doc_count ?? 0;
    case 'median':
      return findKeyed(data?.values as Record<string, unknown> | undefined, '50') ?? null;
    case 'percentiles':
    case 'percentile_ranks':
      return findKeyed(data?.values as Record<string, unknown> | undefined, column.valueKey ?? '') ?? null;
    case 'std_dev': {
      const bounds = data?.std_deviation_bounds as { lower?: number; upper?: number } | undefined;
      return (column.valueKey === 'lower' ? bounds?.lower : bounds?.upper) ?? null;
    }
    case 'top_hits': {
      const hits = (data?.hits as { hits?: Array<{ _source?: Record<string, unknown>; fields?: Record<string, unknown[]> }> } | undefined)?.hits ?? [];
      const name = fieldNameOf(agg) ?? '';
      const values = hits
        .flatMap((hit) => {
          const fromSource = name.split('.').reduce<unknown>(
            (current, part) => (current && typeof current === 'object' ? (current as Record<string, unknown>)[part] : undefined),
            hit._source
          );
          return fromSource !== undefined ? [fromSource] : (hit.fields?.[name] ?? []);
        })
        .flat();
      if (values.length === 0) return null;
      const numbers = values.map(Number).filter((value) => !Number.isNaN(value));
      switch (param<string>(agg, 'aggregate', 'concat')) {
        case 'min':
          return numbers.length ? Math.min(...numbers) : null;
        case 'max':
          return numbers.length ? Math.max(...numbers) : null;
        case 'sum':
          return numbers.reduce((total, value) => total + value, 0);
        case 'average':
          return numbers.length ? numbers.reduce((total, value) => total + value, 0) / numbers.length : null;
        default:
          return values.length === 1 ? values[0] : values.join(', ');
      }
    }
    case 'geo_centroid':
      return data?.location ?? null;
    default:
      return (data?.value as number | null | undefined) ?? null;
  }
}

function bucketColumn(agg: AggConfig, context: AggContext, id: string): TableColumn {
  const settings = context.formatSettings ?? DEFAULT_FORMAT_SETTINGS;
  const base: TableColumn = {
    id,
    name: aggLabel(agg, context),
    kind: 'bucket',
    agg,
    schema: agg.schema,
    fieldName: fieldNameOf(agg),
    format: (value) => String(value ?? ''),
  };
  const fieldFormat = formatterFor(agg, context);
  switch (agg.type) {
    case 'date_histogram': {
      const interval = dateInterval(agg, context);
      const pattern = scaledDateFormat(interval.ms);
      return {
        ...base,
        interval: interval.ms,
        isDate: true,
        format: (value) =>
          typeof value === 'number' ? formatDate(new Date(value), pattern, settings.timeZone) : String(value ?? ''),
      };
    }
    case 'histogram':
      return { ...base, interval: numberInterval(agg, context), format: fieldFormat };
    case 'range':
      // As the original's range format: an open end is an infinity, as its number formats write one
      return {
        ...base,
        format: (value) => {
          const key = (value ?? {}) as RangeKey;
          const from = key.gte === undefined || key.gte === null ? '-∞' : fieldFormat(key.gte);
          const to = key.lt === undefined || key.lt === null ? '+∞' : fieldFormat(key.lt);
          return `≥ ${from} and < ${to}`;
        },
      };
    case 'date_range':
      // As the original's convertDateRangeToString
      return {
        ...base,
        format: (value) => {
          const key = (value ?? {}) as RangeKey;
          const date = (end: unknown) =>
            end === undefined || end === null ? '-' : formatDate(new Date(end as number), settings.dateFormat, settings.timeZone);
          if (!key.gte) return `Before ${date(key.lt)}`;
          if (!key.lt) return `After ${date(key.gte)}`;
          return `${date(key.gte)} to ${date(key.lt)}`;
        },
      };
    case 'ip_range':
      // As the original's convertIPRangeToString: a mask as it is, a range from one address to another
      return {
        ...base,
        format: (value) => {
          const key = (value ?? {}) as RangeKey;
          if (param<string>(agg, 'ipRangeType', 'fromTo') === 'mask') return key.label ?? '';
          return `${key.gte ? String(key.gte) : '-Infinity'} to ${key.lt ? String(key.lt) : 'Infinity'}`;
        },
      };
    case 'terms':
    case 'significant_terms':
      return {
        ...base,
        format: (value) => {
          if (value === MISSING_KEY) return param(agg, 'missingBucketLabel', 'Missing');
          if (value === OTHER_KEY) return param(agg, 'otherBucketLabel', 'Other');
          return fieldFormat(value);
        },
      };
    case 'filters': {
      const queries: Record<string, Dsl> = {};
      for (const filter of param<Array<{ input?: Query; label?: string }>>(agg, 'filters', [])) {
        queries[filterLabel(filter)] = queryOf(filter.input, context);
      }
      return { ...base, filterQueries: queries };
    }
    default:
      return base;
  }
}

export const OTHER_KEY = '__other__';

function bucketsOf(agg: AggConfig, data: unknown): Array<{ key: unknown; bucket: Bucket }> {
  const raw = (data as { buckets?: unknown } | undefined)?.buckets;
  if (!raw) return [];
  if (!Array.isArray(raw)) {
    return Object.entries(raw as Record<string, Bucket>).map(([key, bucket]) => ({ key, bucket }));
  }
  return (raw as Bucket[]).map((bucket) => {
    switch (agg.type) {
      case 'range':
      case 'date_range':
        return {
          key: { gte: bucket.from as number | undefined, lt: bucket.to as number | undefined, label: String(bucket.key ?? '') },
          bucket,
        };
      case 'ip_range':
        return {
          key: { gte: bucket.from as string | undefined, lt: bucket.to as string | undefined, label: String(bucket.key ?? '') },
          bucket,
        };
      default:
        return { key: bucket.key, bucket };
    }
  });
}

export interface TabifyOptions extends BuildOptions {
  /** Keep a row for a bucket that has no buckets under it */
  partialRows?: boolean;
}

/** The answer's aggregations as a table */
export function tabify(
  aggs: AggConfig[],
  response: { aggregations?: Record<string, unknown>; hits?: { total?: number | { value: number } } },
  context: AggContext,
  options: TabifyOptions = {}
): Table {
  const active = enabled(aggs);
  const metrics = active.filter(isMetricAgg);
  const buckets = active.filter(isBucketAgg);
  const columns: TableColumn[] = [];
  const bucketColumns: TableColumn[] = [];
  const metricsByLevel: TableColumn[][] = [];
  let index = 0;

  buckets.forEach((agg, level) => {
    const column = bucketColumn(agg, context, `col-${index}-${agg.id}`);
    index += 1;
    columns.push(column);
    bucketColumns.push(column);
    if (options.metricsAtAllLevels || level === buckets.length - 1) {
      const own = metrics.flatMap((metric) => {
        const made = metricColumns(metric, context, `col-${index}-`);
        index += made.length;
        return made;
      });
      if (agg.type === 'geohash_grid' && agg.params?.useGeocentroid !== false) {
        const centroid: AggConfig = { id: geoCentroidId(aggs), type: 'geo_centroid', schema: 'geo_centroid', params: { field: fieldNameOf(agg) } };
        own.push({ id: `col-${index}-${centroid.id}`, name: 'Geo Centroid', kind: 'metric', agg: centroid, schema: 'geo_centroid', fieldName: fieldNameOf(agg), format: (value) => JSON.stringify(value) });
        index += 1;
      }
      metricsByLevel[level] = own;
      columns.push(...own);
    } else metricsByLevel[level] = [];
  });
  if (buckets.length === 0) {
    const own = metrics.flatMap((metric) => {
      const made = metricColumns(metric, context, `col-${index}-`);
      index += made.length;
      return made;
    });
    columns.push(...own);
    const total = response.hits?.total;
    const root: Bucket = {
      ...(response.aggregations ?? {}),
      doc_count: typeof total === 'number' ? total : (total?.value ?? 0),
    };
    const row: TableRow = {};
    for (const column of own) row[column.id] = metricValue(column, root);
    return { columns, rows: own.length ? [row] : [] };
  }

  const rows: TableRow[] = [];
  const walk = (container: Bucket, level: number, partial: TableRow) => {
    const agg = buckets[level];
    // The collar's filter_agg holds the geohash_grid
    const holder = agg.type === 'geohash_grid' && !(agg.id in container) && container.filter_agg ? (container.filter_agg as Bucket) : container;
    let list = bucketsOf(agg, holder[agg.id]);
    // Buckets that reach outside the time range hold part of what they stand for
    const range = context.timeRange;
    if (agg.type === 'date_histogram' && agg.params?.drop_partials && range && list.length > 1 && fieldNameOf(agg) === context.indexPattern?.timeFieldName) {
      const interval = (list[1].key as number) - (list[0].key as number);
      list = list.filter(({ key }) => typeof key === 'number' && key >= range.from.getTime() && key + interval <= range.to.getTime());
    }
    if (list.length === 0 && options.partialRows && level > 0) rows.push(partial);
    for (const { key, bucket } of list) {
      const row: TableRow = { ...partial, [bucketColumns[level].id]: key };
      for (const column of metricsByLevel[level]) row[column.id] = metricValue(column, bucket);
      if (level === buckets.length - 1) rows.push(row);
      else walk(bucket, level + 1, row);
    }
  };
  walk((response.aggregations ?? {}) as Bucket, 0, {});
  return { columns, rows };
}

/** The filter that narrows a search to one bucket: what clicking a bar or a slice adds */
export function bucketFilter(column: TableColumn, key: unknown, context: AggContext): Filter | undefined {
  const { agg } = column;
  const indexId = context.indexPattern?.id;
  const name = column.fieldName;
  const field = name ? { name } : undefined;
  switch (agg.type) {
    case 'terms':
    case 'significant_terms':
      if (!field) return undefined;
      if (key === MISSING_KEY) {
        const filter = existsFilter(field, indexId);
        filter.meta.negate = true;
        return filter;
      }
      if (key === OTHER_KEY) return undefined;
      return phraseFilter(field, key, indexId);
    case 'date_histogram': {
      if (!field || typeof key !== 'number') return undefined;
      // The bucket ends an interval on, days and longer counted by the calendar, as moment adds them
      const step = /^(\d+(?:\.\d+)?)(ms|[smhdwMy])$/.exec(dateInterval(agg, context).expression);
      const end = step ? addUnits(new Date(key), Number(step[1]), step[2] as TimeUnit).getTime() : key + (column.interval ?? UNIT_MS.d);
      return rangeFilter(
        field,
        {
          gte: new Date(key).toISOString(),
          lt: new Date(end).toISOString(),
          format: 'strict_date_optional_time',
        },
        indexId
      );
    }
    case 'histogram':
      if (!field || typeof key !== 'number') return undefined;
      return rangeFilter(field, { gte: key, lt: key + (column.interval ?? 1) }, indexId);
    case 'range':
    case 'ip_range': {
      if (!field) return undefined;
      const range = key as RangeKey;
      return rangeFilter(field, { gte: range.gte, lt: range.lt }, indexId);
    }
    case 'date_range': {
      if (!field) return undefined;
      const range = key as RangeKey;
      return rangeFilter(
        field,
        {
          gte: range.gte === undefined ? undefined : new Date(range.gte).toISOString(),
          lt: range.lt === undefined ? undefined : new Date(range.lt).toISOString(),
          format: 'strict_date_optional_time',
        },
        indexId
      );
    }
    case 'filters': {
      const query = column.filterQueries?.[String(key)];
      if (!query) return undefined;
      const filter = customFilter(query, indexId);
      filter.meta.alias = String(key);
      return filter;
    }
    default:
      return undefined;
  }
}

// --- The bucket of everything else ----------------------------------------------------------------

const OTHER_AGG = 'other-filter';

/**
 * What a terms aggregation with "Group other values in separate bucket" still has to ask once
 * its answer is in: per list of terms, the documents that are in none of them, with the same
 * aggregations under them. `apply` puts the answer in the first answer as one more bucket.
 */
export function planOtherBucket(
  aggs: AggConfig[],
  dsl: Dsl,
  response: { aggregations?: Record<string, unknown> },
  context: AggContext
): { aggs: Dsl; apply: (answer: Record<string, unknown> | undefined) => void } | undefined {
  const buckets = enabled(aggs).filter(isBucketAgg);
  const level = buckets.findIndex((agg) => agg.type === 'terms' && Boolean(agg.params?.otherBucket));
  if (level === -1) return undefined;
  const other = buckets[level];
  const field = fieldOf(other, context);
  const fieldName = fieldNameOf(other);
  if (!fieldName || field?.scripted) return undefined;

  // What is asked under each term is asked under the rest too
  let node: Dsl | undefined = dsl;
  for (let at = 0; at <= level && node; at += 1) node = (node[buckets[at].id] as Dsl | undefined)?.aggs as Dsl | undefined;

  const columns = buckets.map((agg, at) => bucketColumn(agg, context, `other-${at}`));
  const indexId = context.indexPattern?.id;
  const filters: Record<string, Dsl> = {};
  const targets: Record<string, { buckets?: unknown }> = {};
  let empty = false;
  const visit = (container: Bucket, at: number, above: Filter[], name: string) => {
    const agg = buckets[at];
    const list = bucketsOf(agg, container[agg.id]);
    if (list.length === 0) {
      empty = true;
      return;
    }
    if (at < level) {
      for (const { key, bucket } of list) {
        const filter = bucketFilter(columns[at], key, context);
        const part = key !== null && typeof key === 'object' ? String((key as { label?: string }).label ?? '') : String(key);
        visit(bucket, at + 1, filter ? [...above, filter] : above, `${name}-${part}`);
      }
      return;
    }
    const all = [...above];
    // Documents without the field are the "missing" bucket's, when it is shown, and not the rest's
    if (!other.params?.missingBucket || list.some(({ key }) => key === MISSING_KEY)) all.push(existsFilter({ name: fieldName }, indexId));
    for (const { key } of list) {
      if (key === MISSING_KEY) continue;
      const shown = phraseFilter({ name: fieldName }, key, indexId);
      shown.meta.negate = true;
      all.push(shown);
    }
    filters[name] = buildQuery(context.indexPattern, [], all) as unknown as Dsl;
    targets[name] = container[agg.id] as { buckets?: unknown };
  };
  visit((response.aggregations ?? {}) as Bucket, 0, [], '');
  // As in OpenSearch Dashboards, one list without terms and nothing is asked
  if (empty || Object.keys(filters).length === 0) return undefined;

  return {
    aggs: { [OTHER_AGG]: { filters: { filters }, ...(node && Object.keys(node).length ? { aggs: node } : {}) } },
    apply: (answer) => {
      const found = (answer?.[OTHER_AGG] as { buckets?: Record<string, Bucket> } | undefined)?.buckets ?? {};
      for (const [name, bucket] of Object.entries(found)) {
        const target = targets[name];
        if (!target || !Array.isArray(target.buckets) || !bucket.doc_count) continue;
        target.buckets.push({ ...bucket, key: OTHER_KEY });
      }
    },
  };
}

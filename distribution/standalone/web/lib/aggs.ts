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
import {
  buildQuery,
  cidrRange,
  customFilter,
  existsFilter,
  phraseFilter,
  phrasesFilter,
  rangeFilter,
  type FilterField,
  type RangeParams,
} from './query';
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
  /** Every aggregation of the chart: a pipeline on another metric is labelled after it */
  aggs?: AggConfig[];
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
  if (field?.scripted && field.script) return { script: { source: field.script, lang: field.lang ?? 'painless' } };
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

/**
 * The step of a number histogram, as the original's calculateHistogramInterval: an interval asked
 * that would give more bars than histogram:maxBars is widened to the next multiple of its power of
 * ten; auto gives a power of ten, or two or five times one, for about that many bars (or the user's
 * Max bars when fewer), and 1 for an integer field that spans less.
 */
export function numberInterval(agg: AggConfig, context: AggContext): number {
  const requested = agg.params?.interval;
  const asked = typeof requested === 'number' ? requested : Number.parseFloat(String(requested));
  // An interval that is not a number is taken as auto (the original asks for none, which fails)
  const auto = requested === undefined || requested === 'auto' || Number.isNaN(asked);
  const bounds = context.fieldBounds?.[fieldNameOf(agg) ?? ''];
  const maxBars = context.maxBars ?? 100;
  let interval = auto ? 0 : asked;
  const diff = bounds ? bounds.max - bounds.min : 0;
  if (diff) {
    if (auto) {
      const bars = Math.min(maxBars, Number(agg.params?.maxBars) || maxBars);
      const esTypes = fieldOf(agg, context)?.esTypes ?? [];
      interval = autoNumberInterval(diff, bars, esTypes);
    } else if (diff / interval > maxBars) {
      const least = diff / maxBars;
      const magnitude = Math.pow(10, Math.floor(Math.log10(least)));
      interval = magnitude;
      while (interval < least) interval += magnitude;
    }
  }
  const base = Number(agg.params?.intervalBase);
  if (base) {
    if (interval < base) interval = base;
    else if (interval % base !== 0) interval = Math.round(interval / base) * base;
  }
  return interval || 1;
}

function autoNumberInterval(diff: number, maxBars: number, esTypes: string[]): number {
  const integers = ['integer', 'long', 'short', 'byte'];
  if (diff < maxBars && esTypes.every((type) => integers.includes(type))) return 1;
  const lowerPower = Math.pow(10, Math.floor(Math.log10(diff / maxBars)));
  const buckets = diff / lowerPower;
  if (buckets <= maxBars) return lowerPower;
  if (buckets / 2 <= maxBars) return lowerPower * 2;
  if (buckets / 5 <= maxBars) return lowerPower * 5;
  return lowerPower * 10;
}

/** Whether an aggregation needs the smallest and largest value of its field before it can be asked:
 * as the original, every number histogram, for an interval asked may need widening */
export const needsFieldBounds = (agg: AggConfig) => agg.type === 'histogram';

// --- Labels ---------------------------------------------------------------------------------------

/** The label of an aggregation: a label of someone's own, or the one its type makes */
export function aggLabel(agg: AggConfig, context: AggContext): string {
  const custom = agg.params?.customLabel;
  if (typeof custom === 'string' && custom !== '') return custom;
  if (!agg.type) return '';
  return aggTypeLabel(agg, context);
}

const startCase = (text: string) => text.replace(/(^|\s)(\S)/g, (_match, space: string, letter: string) => `${space}${letter.toUpperCase()}`);

/**
 * The label of a pipeline, as the original's `makeNestedLabel`: after the metric inside it, a
 * pipeline of a pipeline numbered ("2. derivative of Count"), or after the metric it is on.
 */
function nestedLabel(agg: AggConfig, label: string, context: AggContext): string {
  const upper = startCase(label);
  const metric = agg.params?.customMetric as AggConfig | undefined;
  if (metric && typeof metric === 'object') {
    let text = aggLabel(metric, context);
    if (text.includes(`${upper} of `)) text = `2. ${label} of ${text.substring(`${upper} of `.length)}`;
    else if (text.includes(`${label} of `)) text = `${Number.parseInt(text.substring(0, 1), 10) + 1}${text.substring(1)}`;
    else text = `${upper} of ${text}`;
    return text;
  }
  const target = agg.params?.metricAgg;
  // Without the chart's aggregations the metric is not known: it is labelled as a count was
  if (!context.aggs) return `${upper} of Count`;
  const other = context.aggs.find((candidate) => candidate.id === target);
  return other ? `${upper} of ${aggLabel(other, context)}` : '';
}

const PIPELINE_WORDS: Record<string, string> = {
  avg_bucket: 'overall average',
  sum_bucket: 'overall sum',
  min_bucket: 'overall min',
  max_bucket: 'overall max',
  derivative: 'derivative',
  cumulative_sum: 'cumulative sum',
  moving_avg: 'moving avg',
  serial_diff: 'serial diff',
};

/** The label an aggregation's type makes for it, whatever label someone gave it: the type's `makeLabel` */
export function aggTypeLabel(agg: AggConfig, context: AggContext): string {
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
      const size = agg.params?.size ?? 1;
      const last = param<string>(agg, 'sortOrder', 'desc') === 'desc';
      return `${last ? 'Last' : 'First'}${size !== 1 ? ` ${String(size)}` : ''} ${field}`;
    }
    case 'avg_bucket':
    case 'sum_bucket':
    case 'min_bucket':
    case 'max_bucket':
    case 'derivative':
    case 'cumulative_sum':
    case 'moving_avg':
    case 'serial_diff':
      return nestedLabel(agg, PIPELINE_WORDS[agg.type], context);
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
      // As the original: a size left empty leaves a gap in the label
      return `Top ${String(agg.params?.size ?? '')} unusual terms in ${field}`;
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
    // As the original, percentiles come back as a list of keys and values
    case 'percentiles':
      return {
        [agg.id]: {
          percentiles: { ...field, percents: param(agg, 'percents', [1, 5, 25, 50, 75, 95, 99]), keyed: false },
        },
      };
    case 'percentile_ranks':
      return { [agg.id]: { percentile_ranks: { ...field, values: param(agg, 'values', [0]), keyed: false } } };
    case 'top_hits':
      return { [agg.id]: { top_hits: topHitsClause(agg, context) } };
    default:
      break;
  }
  if (SIBLING_PIPELINES.has(agg.type)) {
    const bucket = agg.params?.customBucket as AggConfig | undefined;
    const metric = agg.params?.customMetric as AggConfig | undefined;
    if (!bucket) return {};
    const bucketId = `${agg.id}-bucket`;
    const metricId = `${agg.id}-metric`;
    const inner = metric && metric.type !== 'count' ? metricWithJson({ ...metric, id: metricId }, context, all) : {};
    const clause = withJson(bucket, bucketClause({ ...bucket, id: bucketId }, context));
    // Its terms in the order asked for, as the original writes the bucket like any other
    const under: Dsl = { ...inner };
    if (bucket.type === 'terms') orderTerms({ ...bucket, id: bucketId }, clause.terms as Dsl, under, context, all);
    return {
      [bucketId]: {
        ...clause,
        ...(Object.keys(under).length ? { aggs: under } : {}),
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
        Object.assign(out, metricWithJson({ ...metric, id: path }, context, all));
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

/**
 * A top hit as the original writes one: the field from the document's source and, when it is
 * read from doc values, from there too (a date as `date_time`), or the field's script; then the
 * size and the sort.
 */
function topHitsClause(agg: AggConfig, context: AggContext): Dsl {
  const out: Dsl = {};
  const name = fieldNameOf(agg);
  const field = fieldOf(agg, context);
  if (field?.scripted && field.script) {
    out.script_fields = { [field.name]: { script: { source: field.script, lang: field.lang } } };
  } else if (name) {
    if (field?.readFromDocValues) out.docvalue_fields = [{ field: name, ...(field.type === 'date' ? { format: 'date_time' } : {}) }];
    out._source = name === '_source' ? true : name;
  }
  const size = agg.params?.size;
  if (size) out.size = size;
  const sortField = agg.params?.sortField as string | { name?: string } | undefined;
  const sortName = typeof sortField === 'string' ? sortField : sortField?.name;
  const order = param<string>(agg, 'sortOrder', 'desc');
  const sort = sortName ? context.indexPattern?.fields.find((candidate) => candidate.name === sortName) : undefined;
  if (sort?.scripted && sort.script) {
    out.sort = [{ _script: { script: { source: sort.script, lang: sort.lang }, type: sort.type, order } }];
  } else if (sortName) out.sort = [{ [sortName]: { order } }];
  return out;
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
      };
      // As the original, a least count of 0 (under a parent pipeline) is not asked: OpenSearch's own
      // is 0; bounds are asked only when they are set
      if (minimum !== 0) clause.min_doc_count = Number.isFinite(minimum) ? minimum : 1;
      const min = boundOf(bounds?.min);
      const max = boundOf(bounds?.max);
      if (min !== undefined || max !== undefined) clause.extended_bounds = { min, max };
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
      // As the original, the buckets come back keyed by their ranges
      return { range: { ...field, ranges: numberRangesOf(agg), keyed: true } };
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
    case 'ip_range':
      return { ip_range: { ...field, ranges: ipRangesOf(agg) } };
    case 'terms': {
      const clause: Dsl = {
        ...field,
        size: param(agg, 'size', 5),
        order: { _count: param(agg, 'order', 'desc') },
      };
      // Terms only, as the original's: without its type a script's values come back as text, and
      // a filter made from one would not match
      const scripted = fieldOf(agg, context);
      if (field.script && scripted) clause.value_type = scripted.type === 'number' ? 'float' : scripted.type;
      if (agg.params?.missingBucket) clause.missing = MISSING_KEY;
      includeExclude(agg, context, clause);
      return { terms: clause };
    }
    case 'significant_terms': {
      // An empty size is not asked: OpenSearch's own applies
      const size = agg.params?.size;
      const clause: Dsl = { ...field, ...(size ? { size } : {}) };
      includeExclude(agg, context, clause);
      return { significant_terms: clause };
    }
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

/**
 * The values a terms or significant terms aggregation keeps or leaves out, as the original's
 * `migrateIncludeExcludeFormat` writes them: the numbers of a list on a number field, a pattern on
 * a text field (or the pattern of an older saved object), and nothing on any other field
 */
function includeExclude(agg: AggConfig, context: AggContext, clause: Dsl): void {
  const type = fieldOf(agg, context)?.type;
  for (const name of ['exclude', 'include']) {
    const value = agg.params?.[name];
    if (Array.isArray(value) && value.length > 0 && type === 'number') {
      const numbers = value.filter((item): item is number => Number.isFinite(item));
      if (numbers.length) clause[name] = numbers;
    } else if (value !== null && typeof value === 'object') {
      const pattern = (value as { pattern?: unknown }).pattern;
      if (pattern !== undefined) clause[name] = pattern;
    } else if (value && type === 'string') clause[name] = value;
  }
}

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
  return { ...clause, [type]: combine(clause[type], extra) as Dsl };
}

/**
 * Two values merged as the original's `filteredCombine` merges the JSON input into a clause: an
 * object key by key and a list item by item, all the way down; a null takes a key away
 */
function combine(written: unknown, typed: unknown): unknown {
  const plain = (value: unknown): value is Dsl => value !== null && typeof value === 'object' && !Array.isArray(value);
  if (plain(written) && plain(typed)) {
    const out: Dsl = {};
    for (const key of new Set([...Object.keys(written), ...Object.keys(typed)])) {
      const value = combine(written[key], typed[key]);
      if (value !== undefined) out[key] = value;
    }
    return out;
  }
  if (Array.isArray(written) && Array.isArray(typed)) {
    return Array.from({ length: Math.max(written.length, typed.length) }, (_, index) => combine(written[index], typed[index]));
  }
  if (typed === null) return undefined;
  return typed !== undefined ? typed : written;
}

/**
 * A metric's clauses with its JSON input merged into its own, as the original writes each
 * aggregation it asks for: one that orders terms, or one inside a pipeline, too
 */
function metricWithJson(agg: AggConfig, context: AggContext, all: AggConfig[]): Dsl {
  const own = metricDsl(agg, context, all);
  if (own[agg.id]) own[agg.id] = withJson(agg, own[agg.id] as Dsl);
  return own;
}

/** The ranges of a range aggregation, as they are asked */
function numberRangesOf(agg: AggConfig): Array<{ from?: number; to?: number }> {
  return param<Array<{ from?: number; to?: number }>>(agg, 'ranges', [
    { from: 0, to: 1000 },
    { from: 1000, to: 2000 },
  ]).map((range) => ({ from: numberOf(range.from), to: numberOf(range.to) }));
}

/** The ranges of an IP range aggregation, as they are asked: from and to, or masks */
function ipRangesOf(agg: AggConfig): Array<{ from?: string; to?: string; mask?: string }> {
  const ranges = (agg.params?.ranges ?? {}) as {
    fromTo?: Array<{ from?: string; to?: string }>;
    mask?: Array<{ mask: string }>;
  };
  if (param<string>(agg, 'ipRangeType', 'fromTo') === 'mask') return ranges.mask ?? [{ mask: '0.0.0.0/1' }, { mask: '128.0.0.0/2' }];
  return (
    ranges.fromTo ?? [
      { from: '0.0.0.0', to: '127.255.255.255' },
      { from: '128.0.0.0', to: '191.255.255.255' },
    ]
  );
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

// As the original's request, an aggregation without a type is left out, as one turned off
const enabled = (aggs: AggConfig[]) => aggs.filter((agg) => agg.enabled !== false && Boolean(agg.type));

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
      Object.assign(out, metricWithJson(metric, context, metrics));
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

    if (agg.type === 'terms') orderTerms(agg, clause.terms as Dsl, own, context, metrics);
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

/**
 * The order of a terms aggregation's buckets, as the original's orderAgg writes it: by key, by a
 * custom metric or by a metric of the chart, the metric then asked for under the terms (`own`).
 * The bucket of a sibling pipeline is ordered the same way.
 */
function orderTerms(agg: AggConfig, terms: Dsl, own: Dsl, context: AggContext, metrics: AggConfig[]): void {
  const direction = param<string>(agg, 'order', 'desc');
  const orderBy = param<string>(agg, 'orderBy', '_count');
  if (orderBy === '_key' || orderBy === '_term') terms.order = { _key: direction };
  else if (orderBy === 'custom') {
    const orderAgg = agg.params?.orderAgg as AggConfig | undefined;
    if (orderAgg && orderAgg.type !== 'count') {
      const id = orderAgg.id ?? `${agg.id}-orderAgg`;
      Object.assign(own, metricWithJson({ ...orderAgg, id }, context, metrics));
      terms.order = { [orderPath(orderAgg, id)]: direction };
    }
  } else {
    const metric = metrics.find((candidate) => candidate.id === orderBy);
    if (metric && metric.type !== 'count' && !SIBLING_PIPELINES.has(metric.type) && !PARENT_PIPELINES.has(metric.type)) {
      Object.assign(own, metricWithJson(metric, context, metrics));
      terms.order = { [orderPath(metric, metric.id)]: direction };
    }
  }
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
        name: `Percentile rank ${formatterFor(agg, context)(value)} of "${custom ? label : field}"`,
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

/** A value of percentiles by its percent: from a list of keys and values, or from an object */
function findKeyed(values: Record<string, unknown> | Array<{ key?: unknown; value?: unknown }> | undefined, wanted: string): unknown {
  if (!values) return undefined;
  const target = Number(wanted);
  if (Array.isArray(values)) return values.find((item) => Number(item.key) === target)?.value;
  if (wanted in values) return values[wanted];
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
      return findKeyed(data?.values as Parameters<typeof findKeyed>[0], column.valueKey ?? '') ?? null;
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
      const pattern = scaledDateFormat(interval.ms, settings.scaledDateRules, settings.dateFormat);
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
      // As the original's range format: an open end is an infinity, written by the field's format
      return {
        ...base,
        format: (value) => {
          const key = (value ?? {}) as RangeKey;
          return `≥ ${fieldFormat(key.gte ?? -Infinity)} and < ${fieldFormat(key.lt ?? Infinity)}`;
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

/** A bucket of a range answers the range asked when both its ends are the range's */
const sameEnds = (bucket: Bucket | undefined, range: { from?: unknown; to?: unknown }) => bucket?.from === range.from && bucket?.to === range.to;

function bucketsOf(agg: AggConfig, data: unknown): Array<{ key: unknown; bucket: Bucket }> {
  const raw = (data as { buckets?: unknown } | undefined)?.buckets;
  if (!raw) return [];
  // As the original's table, the buckets of ranges, IP ranges and filters come in the order they are
  // asked in (OpenSearch sorts them); one the answer does not hold is left out
  if (!Array.isArray(raw)) {
    const keyed = raw as Record<string, Bucket>;
    if (agg.type === 'range') {
      return numberRangesOf(agg).flatMap((range) => {
        const name = Object.keys(keyed).find((key) => sameEnds(keyed[key], range));
        if (name === undefined) return [];
        const bucket = keyed[name];
        return [{ key: { gte: bucket.from as number | undefined, lt: bucket.to as number | undefined, label: name }, bucket }];
      });
    }
    const filters = agg.type === 'filters' ? param<Array<{ input?: Query; label?: string }>>(agg, 'filters', []) : [];
    if (filters.length) return filters.map(filterLabel).flatMap((key) => (key in keyed ? [{ key, bucket: keyed[key] }] : []));
    return Object.entries(keyed).map(([key, bucket]) => ({ key, bucket }));
  }
  let list = raw as Bucket[];
  if (agg.type === 'ip_range') {
    list = ipRangesOf(agg).flatMap((range) => {
      const found = range.mask !== undefined ? list.find((bucket) => bucket.key === range.mask) : list.find((bucket) => sameEnds(bucket, range));
      return found ? [found] : [];
    });
  }
  return list.map((bucket) => {
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
  context = context.aggs ? context : { ...context, aggs };
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

/**
 * The field of the index pattern a column's aggregation is on, as a filter on it needs it: a
 * scripted field is asked by its script, a boolean one takes 1 and 0 as true and false. A field
 * the index pattern does not list is asked by its name.
 */
export function filterFieldOf(column: TableColumn, context: AggContext): FilterField | undefined {
  const name = column.fieldName;
  if (!name) return undefined;
  return context.indexPattern?.fields.find((field) => field.name === name) ?? { name };
}

/** Where a bucket was clicked: the table of its chart and the row of the mark, slice or cell */
export interface BucketCell {
  table: Table;
  row: TableRow;
}

const sameKey = (a: unknown, b: unknown) =>
  a === b || (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null && JSON.stringify(a) === JSON.stringify(b));

/**
 * The terms beside the "Other" bucket of a column, as the original's getOtherBucketFilterTerms
 * finds them for a click: the column's values in the rows that agree with the clicked one on every
 * column before it, once each, the other and the missing buckets left out.
 */
export function otherBucketTerms(column: TableColumn, { table, row }: BucketCell): unknown[] {
  const before = table.columns.slice(0, Math.max(table.columns.indexOf(column), 0));
  const rows = table.rows.filter((candidate) => before.every((other) => sameKey(candidate[other.id], row[other.id])));
  const terms = rows.map((candidate) => candidate[column.id]).filter((term) => term !== OTHER_KEY && term !== MISSING_KEY);
  return [...new Set(terms)];
}

/**
 * The filter that narrows a search to one bucket: what clicking a bar or a slice adds, as the
 * original's createFilter of each aggregation (buckets/create_filter). A range's filter says what
 * its bucket is called, "≥ 0 and < 1,000", an open end being infinite; a histogram's, its key as
 * the field writes it. The "Other" bucket of a terms aggregation takes the documents in none of
 * the terms beside it where it was clicked (`cell`): no filter without the cell. The original also
 * adds an exists filter when those terms hold the missing bucket, which a click leaves out of them.
 */
export function bucketFilter(column: TableColumn, key: unknown, context: AggContext, cell?: BucketCell): Filter | undefined {
  const { agg } = column;
  const indexId = context.indexPattern?.id;
  const field = filterFieldOf(column, context);
  // The field's format: it writes the names above
  const format = formatterFor(agg, context);
  switch (agg.type) {
    case 'terms':
    case 'significant_terms':
      if (!field) return undefined;
      if (key === MISSING_KEY) {
        const filter = existsFilter(field, indexId);
        filter.meta.negate = true;
        return filter;
      }
      if (key === OTHER_KEY) {
        if (!cell || agg.type !== 'terms' || !agg.params?.otherBucket) return undefined;
        const filter = phrasesFilter(field, otherBucketTerms(column, cell), indexId);
        filter.meta.negate = true;
        return filter;
      }
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
      return rangeFilter(field, { gte: key, lt: key + (column.interval ?? 1) }, indexId, format(key));
    case 'range': {
      if (!field) return undefined;
      const range = key as RangeKey;
      // An end the range leaves open is infinite, as the original's RangeKey has it
      const gte = range.gte ?? -Infinity;
      const lt = range.lt ?? Infinity;
      return rangeFilter(field, { gte, lt }, indexId, `≥ ${format(gte)} and < ${format(lt)}`);
    }
    case 'ip_range': {
      if (!field) return undefined;
      const range = key as RangeKey;
      // A mask is all its addresses, the last one included; the ends of a range as they are
      if (param<string>(agg, 'ipRangeType', 'fromTo') === 'mask') {
        const mask = cidrRange(String(range.label ?? ''));
        return mask ? rangeFilter(field, { gte: mask.from, lte: mask.to }, indexId) : undefined;
      }
      return rangeFilter(field, { gte: range.gte || -Infinity, lte: range.lt || Infinity }, indexId);
    }
    case 'date_range': {
      if (!field) return undefined;
      const range = key as RangeKey;
      const params: RangeParams = {};
      if (range.gte) params.gte = new Date(range.gte).toISOString();
      if (range.lt) params.lt = new Date(range.lt).toISOString();
      if (range.gte && range.lt) params.format = 'strict_date_optional_time';
      return rangeFilter(field, params, indexId);
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

/**
 * The filter a brushed stretch of a histogram's axis adds, as the original's range selection
 * (createFiltersFromRangeSelectAction): from its start to its end, as dates when the field is
 * one; nothing when the stretch has no width.
 */
export function brushFilter(column: TableColumn, from: number, to: number, context: AggContext): Filter | undefined {
  const field = filterFieldOf(column, context);
  if (!field || from === to) return undefined;
  const isDate = field.type ? field.type === 'date' : Boolean(column.isDate);
  const range: RangeParams = isDate
    ? { gte: new Date(from).toISOString(), lt: new Date(to).toISOString(), format: 'strict_date_optional_time' }
    : { gte: from, lt: to };
  return rangeFilter(field, range, context.indexPattern?.id);
}

// --- The bucket of everything else ----------------------------------------------------------------

const OTHER_AGG = 'other-filter';

/** What the bucket of everything else that a request put in an answer stands for, for the requests of the buckets under it */
const otherBucketFilters = new WeakMap<object, Filter[]>();

const groupsOthers = (agg: AggConfig) => agg.type === 'terms' && Boolean(agg.params?.otherBucket);

/** The terms aggregations with "Group other values in separate bucket", in the order their rest is asked */
export const otherBucketAggs = (aggs: AggConfig[]) => enabled(aggs).filter(isBucketAgg).filter(groupsOthers);

/**
 * What a terms aggregation with "Group other values in separate bucket" still has to ask once
 * its answer is in: per list of terms, the documents that are in none of them, with the same
 * aggregations under them. `apply` puts the answer in the first answer as one more bucket. Each
 * such aggregation asks in turn, the first one unless `aggId` says which, and one under another
 * asks under its rest too, as the original's postFlightRequest of each.
 */
export function planOtherBucket(
  aggs: AggConfig[],
  dsl: Dsl,
  response: { aggregations?: Record<string, unknown> },
  context: AggContext,
  aggId?: string
): { aggs: Dsl; apply: (answer: Record<string, unknown> | undefined) => void } | undefined {
  const buckets = enabled(aggs).filter(isBucketAgg);
  const level = buckets.findIndex((agg) => groupsOthers(agg) && (aggId === undefined || agg.id === aggId));
  if (level === -1) return undefined;
  const other = buckets[level];
  const fieldName = fieldNameOf(other);
  if (!fieldName) return undefined;
  // The field of the index pattern: a scripted one is asked by its script, as in the original
  const field: FilterField = fieldOf(other, context) ?? { name: fieldName };

  // What is asked under each term is asked under the rest too
  let node: Dsl | undefined = dsl;
  for (let at = 0; at <= level && node; at += 1) node = (node[buckets[at].id] as Dsl | undefined)?.aggs as Dsl | undefined;

  const columns = buckets.map((agg, at) => bucketColumn(agg, context, `other-${at}`));
  const indexId = context.indexPattern?.id;
  const filters: Record<string, Dsl> = {};
  const targets: Record<string, { list: { buckets?: unknown }; shown: Filter[]; missing: boolean }> = {};
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
        // The rest of a bucket above stands for what its own request said
        const own = otherBucketFilters.get(bucket);
        const filter = own ? undefined : bucketFilter(columns[at], key, context);
        const part = key !== null && typeof key === 'object' ? String((key as { label?: string }).label ?? '') : String(key);
        visit(bucket, at + 1, own ? [...above, ...own] : filter ? [...above, filter] : above, `${name}-${part}`);
      }
      return;
    }
    const all = [...above];
    const missing = list.some(({ key }) => key === MISSING_KEY);
    // Documents without the field are the "missing" bucket's, when it is shown, and not the rest's;
    // a scripted field is not asked whether it exists, as in the original
    if (!field.scripted && (!other.params?.missingBucket || missing)) all.push(existsFilter(field, indexId));
    const shown: Filter[] = [];
    for (const { key } of list) {
      if (key === MISSING_KEY) continue;
      const filter = phraseFilter(field, key, indexId);
      filter.meta.negate = true;
      shown.push(filter);
    }
    all.push(...shown);
    filters[name] = buildQuery(context.indexPattern, [], all) as unknown as Dsl;
    targets[name] = { list: container[agg.id] as { buckets?: unknown }, shown, missing };
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
        if (!target || !Array.isArray(target.list.buckets) || !bucket.doc_count) continue;
        const rest: Bucket = { ...bucket, key: OTHER_KEY };
        // As the original's mergeOtherBucketAggResponse: none of the terms its request named as
        // phrases (a scripted field's, none), and the field, when the missing bucket is shown
        const terms = target.shown.flatMap((filter) => {
          const phrase = (filter.query as { match_phrase?: Record<string, unknown> } | undefined)?.match_phrase;
          return phrase && field.name in phrase ? [phrase[field.name]] : [];
        });
        const none = phrasesFilter(field, terms, indexId);
        none.meta.negate = true;
        otherBucketFilters.set(rest, target.missing ? [none, existsFilter(field, indexId)] : [none]);
        target.list.buckets.push(rest);
      }
    },
  };
}

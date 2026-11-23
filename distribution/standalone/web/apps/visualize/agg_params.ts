/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The parameters of each aggregation as OpenSearch Dashboards 3.9.0 defines them: in their order,
 * with their defaults, the ones under "Advanced", and the fields each field parameter accepts. An
 * aggregation is written to the address and saved as the original serializes one: every
 * parameter of its type that has a value, a default filled in, nothing else; a date histogram
 * carries the time range of the page.
 */

import type { AggConfig } from '../../lib/aggs';
import type { TimeRange } from '../../lib/dates';
import type { Field, IndexPattern } from '../../lib/types';

export interface AggEnv {
  indexPattern?: IndexPattern;
  /** The time range of the page as the picker holds it: a date histogram carries it */
  timeRange?: TimeRange;
  /** The language a new filter is written in */
  queryLanguage?: string;
}

interface ParamDef {
  name: string;
  /** The value a new aggregation of the type has: a value, or one worked out from the page */
  value?: (env: AggEnv) => unknown;
  /** Listed under "Advanced" */
  advanced?: boolean;
  /** Never saved: the zone dates are cut in is the page's */
  transient?: boolean;
  /** An aggregation of its own, inside this one */
  agg?: boolean;
}

const is =
  <T>(value: T) =>
  (): T =>
    JSON.parse(JSON.stringify(value)) as T;
const timeField = (env: AggEnv) => env.indexPattern?.timeFieldName;

const FIELD: ParamDef = { name: 'field' };
const JSON_INPUT: ParamDef = { name: 'json', advanced: true };
const CUSTOM_LABEL: ParamDef = { name: 'customLabel' };

const METRIC = [FIELD, JSON_INPUT, CUSTOM_LABEL];
const SIBLING = [{ name: 'customBucket', agg: true }, { name: 'customMetric', agg: true }, JSON_INPUT, CUSTOM_LABEL];
const PARENT_BASE: ParamDef[] = [{ name: 'metricAgg', value: is('custom') }, { name: 'customMetric', agg: true }, { name: 'buckets_path' }];
const PARENT = [...PARENT_BASE, JSON_INPUT, CUSTOM_LABEL];

const PARAMS: Record<string, ParamDef[]> = {
  count: [CUSTOM_LABEL],
  avg: METRIC,
  sum: METRIC,
  min: METRIC,
  max: METRIC,
  std_dev: METRIC,
  cardinality: METRIC,
  median: [FIELD, { name: 'percents', value: is([50]) }, JSON_INPUT, CUSTOM_LABEL],
  percentiles: [FIELD, { name: 'percents', value: is([1, 5, 25, 50, 75, 95, 99]) }, JSON_INPUT, CUSTOM_LABEL],
  percentile_ranks: [FIELD, { name: 'values', value: is([]) }, JSON_INPUT, CUSTOM_LABEL],
  top_hits: [
    FIELD,
    { name: 'aggregate' },
    { name: 'size', value: is(1) },
    { name: 'sortField', value: timeField },
    { name: 'sortOrder', value: is('desc') },
    JSON_INPUT,
    CUSTOM_LABEL,
  ],
  avg_bucket: SIBLING,
  sum_bucket: SIBLING,
  min_bucket: SIBLING,
  max_bucket: SIBLING,
  derivative: PARENT,
  cumulative_sum: PARENT,
  serial_diff: PARENT,
  moving_avg: [
    ...PARENT_BASE,
    { name: 'window', value: is(5) },
    { name: 'script', value: is('MovingFunctions.unweightedAvg(values)') },
    JSON_INPUT,
    CUSTOM_LABEL,
  ],
  date_histogram: [
    { name: 'field', value: timeField },
    { name: 'timeRange' },
    { name: 'useNormalizedOpenSearchInterval', value: is(true) },
    { name: 'scaleMetricValues', value: is(false), advanced: true },
    { name: 'interval', value: is('auto') },
    { name: 'time_zone', transient: true },
    { name: 'drop_partials', value: is(false) },
    { name: 'format' },
    { name: 'min_doc_count', value: is(1) },
    { name: 'extended_bounds', value: is({}) },
    JSON_INPUT,
    CUSTOM_LABEL,
  ],
  histogram: [
    FIELD,
    { name: 'intervalBase' },
    { name: 'interval', value: is('auto') },
    { name: 'maxBars' },
    { name: 'min_doc_count', value: is(false) },
    { name: 'has_extended_bounds', value: is(false) },
    { name: 'extended_bounds', value: is({ min: '', max: '' }) },
    JSON_INPUT,
    CUSTOM_LABEL,
  ],
  range: [
    FIELD,
    {
      name: 'ranges',
      value: is([
        { from: 0, to: 1000 },
        { from: 1000, to: 2000 },
      ]),
    },
    JSON_INPUT,
    CUSTOM_LABEL,
  ],
  date_range: [
    { name: 'field', value: timeField },
    { name: 'ranges', value: is([{ from: 'now-1w/w', to: 'now' }]) },
    { name: 'time_zone', transient: true },
    JSON_INPUT,
    CUSTOM_LABEL,
  ],
  ip_range: [
    FIELD,
    { name: 'ipRangeType', value: is('fromTo') },
    {
      name: 'ranges',
      value: is({
        fromTo: [
          { from: '0.0.0.0', to: '127.255.255.255' },
          { from: '128.0.0.0', to: '191.255.255.255' },
        ],
        mask: [{ mask: '0.0.0.0/1' }, { mask: '128.0.0.0/2' }],
      }),
    },
    JSON_INPUT,
    CUSTOM_LABEL,
  ],
  terms: [
    FIELD,
    { name: 'orderBy' },
    { name: 'orderAgg', agg: true },
    { name: 'order', value: is('desc') },
    { name: 'size', value: is(5) },
    { name: 'otherBucket', value: is(false) },
    { name: 'otherBucketLabel', value: is('Other') },
    { name: 'missingBucket', value: is(false) },
    { name: 'missingBucketLabel', value: is('Missing') },
    { name: 'exclude', advanced: true },
    { name: 'include', advanced: true },
    JSON_INPUT,
    CUSTOM_LABEL,
  ],
  // A filters aggregation names its buckets itself: it has no label of someone's own
  filters: [
    {
      name: 'filters',
      value: (env) => [{ input: { query: '', language: env.queryLanguage ?? 'kuery' }, label: '' }],
    },
    JSON_INPUT,
  ],
  significant_terms: [
    FIELD,
    { name: 'size', value: is('') },
    { name: 'exclude', advanced: true },
    { name: 'include', advanced: true },
    JSON_INPUT,
    CUSTOM_LABEL,
  ],
  geohash_grid: [
    FIELD,
    { name: 'autoPrecision', value: is(true) },
    { name: 'precision', value: is(2) },
    { name: 'useGeocentroid', value: is(true) },
    { name: 'isFilteredByCollar', value: is(true) },
    { name: 'boundingBox' },
    JSON_INPUT,
    CUSTOM_LABEL,
  ],
  // Its precision has no editor in the original: it is what a saved object carries, or 0
  geotile_grid: [FIELD, { name: 'useGeocentroid', value: is(true) }, { name: 'precision', value: is(0) }, JSON_INPUT, CUSTOM_LABEL],
};

/** The names of a type's parameters, in their order */
export const paramNames = (type: string): string[] => (PARAMS[type] ?? []).map((param) => param.name);

/** Whether a parameter is listed under "Advanced" */
export const isAdvanced = (type: string, name: string) => Boolean(PARAMS[type]?.find((param) => param.name === name)?.advanced);

/** Whether a type takes a label of someone's own */
export const hasCustomLabel = (type: string) => paramNames(type).includes('customLabel');

/**
 * The parameters an aggregation has once its type is set, as the original's `setParams`: each
 * parameter of the type from what is given, or its default; anything else is dropped.
 */
export function withDefaults(type: string, given: Record<string, unknown>, env: AggEnv): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const param of PARAMS[type] ?? []) {
    let value = given[param.name];
    if (value === undefined || value === null) value = param.value?.(env);
    if (value === undefined || value === null) continue;
    params[param.name] = value;
  }
  return params;
}

/** The parameters of a new aggregation of a type, with a field kept when the type accepts it */
export function paramsForType(type: string, field: string | undefined, env: AggEnv): Record<string, unknown> {
  return withDefaults(type, field ? { field } : {}, env);
}

/**
 * An aggregation as the original serializes it into the address and the saved object: its
 * type's parameters in their order with their defaults, the aggregations inside it serialized
 * the same way (with `innerEnv`), a date histogram with the time range of the page when it is
 * asked for.
 */
export function serializeAgg(agg: AggConfig, env: AggEnv, requested = agg.enabled !== false, innerEnv: AggEnv = env): AggConfig {
  const out: AggConfig = { id: agg.id, enabled: agg.enabled !== false, type: agg.type, params: {} };
  if (agg.schema !== undefined) out.schema = agg.schema;
  if (!agg.type || !PARAMS[agg.type]) {
    if (agg.params) out.params = { ...agg.params };
    return reorder(out);
  }
  const given = { ...(agg.params ?? {}) };
  if (agg.type === 'date_histogram' && requested && env.timeRange) given.timeRange = { from: env.timeRange.from, to: env.timeRange.to };
  const params = withDefaults(agg.type, given, env);
  for (const param of PARAMS[agg.type]) {
    if (param.transient) delete params[param.name];
    const inner = params[param.name];
    if (param.agg && isAgg(inner)) params[param.name] = serializeAgg(inner, innerEnv, requested, innerEnv);
  }
  out.params = params;
  return reorder(out);
}

const isAgg = (value: unknown): value is AggConfig =>
  value !== null && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string';

// The keys in the order the original writes them: id, enabled, type, params, schema
function reorder(agg: AggConfig): AggConfig {
  const out: AggConfig = { id: agg.id, enabled: agg.enabled, type: agg.type, params: agg.params };
  if (agg.schema !== undefined) out.schema = agg.schema;
  return out;
}

/**
 * The aggregations of a chart as the original serializes them. Its date histograms hand the time
 * range to those inside the other aggregations (the bucket of a sibling pipeline): without one,
 * those have none. (The original hands it over when a date histogram of the chart is drawn or
 * changed, so one made after the date histogram has none until then.)
 */
export function serializeAggs(aggs: AggConfig[], env: AggEnv): AggConfig[] {
  const innerEnv = aggs.some((agg) => agg.type === 'date_histogram') ? env : { ...env, timeRange: undefined };
  return aggs.map((agg) => serializeAgg(agg, env, agg.enabled !== false, innerEnv));
}

// --- The fields a field parameter accepts ---------------------------------------------------------

interface FieldRule {
  types: string[] | '*';
  /** Aggregatable fields only, and none inside a nested object: false for a top hit */
  onlyAggregatable?: boolean;
  /** Scripted fields too */
  scriptable?: boolean;
}

const NOT_HISTOGRAM = '*';

const FIELD_RULES: Record<string, FieldRule> = {
  avg: { types: ['number', 'histogram'] },
  sum: { types: ['number', 'histogram'] },
  min: { types: ['number', 'date'] },
  max: { types: ['number', 'date'] },
  median: { types: ['number', 'date', 'histogram'] },
  percentiles: { types: ['number', 'date', 'histogram'] },
  percentile_ranks: { types: ['number', 'histogram'] },
  std_dev: { types: ['number'] },
  cardinality: { types: NOT_HISTOGRAM },
  top_hits: { types: NOT_HISTOGRAM, onlyAggregatable: false },
  'top_hits.sortField': { types: ['number', 'date', 'ip', 'string'] },
  date_histogram: { types: ['date'] },
  date_range: { types: ['date'] },
  histogram: { types: ['number'] },
  range: { types: ['number'] },
  ip_range: { types: ['ip'] },
  terms: { types: ['number', 'boolean', 'date', 'ip', 'string'] },
  significant_terms: { types: ['string'], scriptable: false },
  geohash_grid: { types: ['geo_point'] },
  geotile_grid: { types: ['geo_point'] },
};

/** The types of field an aggregation's field accepts, as its error names them */
export function fieldTypesOf(type: string, param = 'field'): string[] {
  const rule = FIELD_RULES[param === 'field' ? type : `${type}.${param}`];
  return !rule ? [] : rule.types === '*' ? ['*'] : rule.types;
}

/**
 * The fields of the index pattern a field parameter can be set to, as the original's
 * `getAvailableFields`: by type, aggregatable unless the parameter reads documents, scripted
 * ones unless the aggregation cannot run a script. A top hit's field is a number unless the
 * part of the chart it plays allows text.
 */
export function availableFields(
  type: string,
  indexPattern: IndexPattern | undefined,
  param = 'field',
  allowStrings = true
): Field[] {
  const rule = FIELD_RULES[param === 'field' ? type : `${type}.${param}`];
  if (!rule) return [];
  const onlyAggregatable = rule.onlyAggregatable !== false;
  const scriptable = rule.scriptable !== false;
  const fields = (indexPattern?.fields ?? []).filter((field) => {
    if (onlyAggregatable && (!field.aggregatable || field.subType?.nested)) return false;
    if (!scriptable && field.scripted) return false;
    if (rule.types === '*') return field.type !== 'histogram';
    return rule.types.includes(field.type);
  });
  return type === 'top_hits' && param === 'field' && !allowStrings ? fields.filter((field) => field.type === 'number') : fields;
}

const byLabel = (a: string, b: string) => a.toLowerCase().localeCompare(b.toLowerCase());

/** Fields grouped by their type, the groups and the fields in each sorted, as the original lists them */
export function sortFields(fields: Field[]): Field[] {
  return [...fields].sort((a, b) => byLabel(a.type, b.type) || byLabel(a.name, b.name));
}

/** Labels grouped by a heading and sorted, groups first by their heading: the original's `groupAndSortBy` */
export function groupAndSort<T extends { label: string; group?: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => byLabel(a.group ?? '', b.group ?? '') || byLabel(a.label, b.label));
}

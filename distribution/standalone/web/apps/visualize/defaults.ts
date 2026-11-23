/* SPDX-License-Identifier: Apache-2.0 */

/*
 * What the editor of a visualization starts from and holds to: the settings a new visualization
 * of each kind has, the aggregations each part of a chart accepts, the fields each aggregation
 * accepts, and the settings that follow the aggregations (a line chart keeps one entry of
 * `seriesParams` per metric). All of it is as OpenSearch Dashboards 3.9.0 has it, so what is
 * saved here opens there and the other way round.
 */

import { AGG_TITLES, METRIC_TYPES, BUCKET_TYPES, aggLabel, type AggConfig, type AggContext } from '../../lib/aggs';
import { parseDateMath, parseInterval } from '../../lib/dates';
import type { IndexPattern } from '../../lib/types';
import { visType, type Vis, type VisType } from '../../lib/vis';
import { tileMapDefaults } from '../../vis/tile_map/defaults';
import { DEFAULT_VEGA_SPEC } from '../../vis/vega/default_spec';
import { regionMapDefaults } from '../../vis/region_map/region_map_type';
import { tsvbDefaults } from './tsvb/model';
import { availableFields, fieldTypesOf, paramsForType } from './agg_params';

export type Schema = NonNullable<VisType['schemas']>[number];

// --- The settings of a new visualization ----------------------------------------------------------

const COUNT = 'Count';
const THRESHOLD_COLOR = '#E7664C';

function xyDefaults(kind: 'area' | 'line' | 'histogram' | 'horizontal_bar'): Record<string, unknown> {
  const horizontal = kind === 'horizontal_bar';
  const series: Record<string, unknown> = {
    show: true,
    type: kind === 'area' ? 'area' : kind === 'line' ? 'line' : 'histogram',
    mode: kind === 'area' || kind === 'histogram' ? 'stacked' : 'normal',
    data: { label: COUNT, id: '1' },
    valueAxis: 'ValueAxis-1',
    drawLinesBetweenPoints: true,
    lineWidth: 2,
    showCircles: true,
  };
  if (kind === 'area' || kind === 'line') series.interpolate = 'linear';
  return {
    type: horizontal ? 'histogram' : kind,
    grid: { categoryLines: false },
    categoryAxes: [
      {
        id: 'CategoryAxis-1',
        type: 'category',
        position: horizontal ? 'left' : 'bottom',
        show: true,
        style: {},
        scale: { type: 'linear' },
        labels: horizontal ? { show: true, rotate: 0, filter: false, truncate: 200 } : { show: true, filter: true, truncate: 100 },
        title: {},
      },
    ],
    valueAxes: [
      {
        id: 'ValueAxis-1',
        name: horizontal ? 'BottomAxis-1' : 'LeftAxis-1',
        type: 'value',
        position: horizontal ? 'bottom' : 'left',
        show: true,
        style: {},
        scale: { type: 'linear', mode: 'normal' },
        labels: { show: true, rotate: horizontal ? 75 : 0, filter: horizontal, truncate: 100 },
        title: { text: COUNT },
      },
    ],
    seriesParams: [series],
    addTooltip: true,
    addLegend: true,
    legendPosition: 'right',
    times: [],
    addTimeMarker: false,
    labels: kind === 'histogram' ? { show: false } : {},
    thresholdLine: { show: false, value: 10, width: 1, style: 'full', color: THRESHOLD_COLOR },
  };
}

const DEFAULT_PARAMS: Record<string, () => Record<string, unknown>> = {
  area: () => xyDefaults('area'),
  line: () => xyDefaults('line'),
  histogram: () => xyDefaults('histogram'),
  horizontal_bar: () => xyDefaults('horizontal_bar'),
  pie: () => ({
    type: 'pie',
    addTooltip: true,
    addLegend: true,
    legendPosition: 'right',
    isDonut: true,
    labels: { show: false, values: true, last_level: true, truncate: 100 },
  }),
  gauge: () => ({
    type: 'gauge',
    addTooltip: true,
    addLegend: true,
    isDisplayWarning: false,
    gauge: {
      alignment: 'automatic',
      extendRange: true,
      percentageMode: false,
      gaugeType: 'Arc',
      gaugeStyle: 'Full',
      backStyle: 'Full',
      orientation: 'vertical',
      colorSchema: 'Green to Red',
      gaugeColorMode: 'Labels',
      colorsRange: [
        { from: 0, to: 50 },
        { from: 50, to: 75 },
        { from: 75, to: 100 },
      ],
      invertColors: false,
      labels: { show: true, color: 'black' },
      scale: { show: true, labels: false, color: 'rgba(105,112,125,0.2)' },
      type: 'meter',
      style: {
        bgWidth: 0.9,
        width: 0.9,
        mask: false,
        bgMask: false,
        maskBars: 50,
        bgFill: 'rgba(105,112,125,0.2)',
        bgColor: true,
        subText: '',
        fontSize: 60,
      },
    },
  }),
  goal: () => ({
    addTooltip: true,
    addLegend: false,
    isDisplayWarning: false,
    type: 'gauge',
    gauge: {
      verticalSplit: false,
      autoExtend: false,
      percentageMode: true,
      gaugeType: 'Arc',
      gaugeStyle: 'Full',
      backStyle: 'Full',
      orientation: 'vertical',
      useRanges: false,
      colorSchema: 'Green to Red',
      gaugeColorMode: 'None',
      colorsRange: [{ from: 0, to: 10000 }],
      invertColors: false,
      labels: { show: true, color: 'black' },
      scale: { show: false, labels: false, color: 'rgba(105,112,125,0.2)', width: 2 },
      type: 'meter',
      style: { bgFill: 'rgba(105,112,125,0.2)', bgColor: false, labelColor: false, subText: '', fontSize: 60 },
    },
  }),
  heatmap: () => ({
    type: 'heatmap',
    addTooltip: true,
    addLegend: true,
    enableHover: false,
    legendPosition: 'right',
    times: [],
    colorsNumber: 4,
    colorSchema: 'Greens',
    setColorRange: false,
    colorsRange: [],
    invertColors: false,
    percentageMode: false,
    valueAxes: [
      {
        show: false,
        id: 'ValueAxis-1',
        type: 'value',
        scale: { type: 'linear', defaultYExtents: false },
        labels: { show: false, rotate: 0, overwriteColor: false, color: 'black' },
      },
    ],
  }),
  metric: () => ({
    addTooltip: true,
    addLegend: false,
    type: 'metric',
    metric: {
      percentageMode: false,
      useRanges: false,
      colorSchema: 'Green to Red',
      metricColorMode: 'None',
      colorsRange: [{ from: 0, to: 10000 }],
      labels: { show: true },
      invertColors: false,
      style: { bgFill: '#000', bgColor: false, labelColor: false, subText: '', fontSize: 60 },
    },
  }),
  tagcloud: () => ({ scale: 'linear', orientation: 'single', minFontSize: 18, maxFontSize: 72, showLabel: true }),
  table: () => ({
    perPage: 10,
    showPartialRows: false,
    showMetricsAtAllLevels: false,
    showTotal: false,
    totalFunc: 'sum',
    percentageCol: '',
  }),
  markdown: () => ({ fontSize: 12, openLinksInNewTab: false, markdown: '' }),
  timelion: () => ({ expression: '.opensearch(*)', interval: 'auto' }),
  input_control_vis: () => ({ controls: [], updateFiltersOnChange: false, useTimeFilter: false, pinFilters: false }),
  metrics: () => tsvbDefaults(),
  vega: () => ({ spec: DEFAULT_VEGA_SPEC }),
  region_map: () => regionMapDefaults(),
  tile_map: () => tileMapDefaults(),
};

export const defaultParams = (type: string): Record<string, unknown> => DEFAULT_PARAMS[type]?.() ?? {};

/** A visualization of a kind nobody has changed yet, on an index pattern or a saved search */
export function newVis(type: string, source: { indexPatternId?: string; savedSearchId?: string }): Vis {
  const kind = visType(type);
  const aggs: AggConfig[] = kind?.aggBased ? [{ id: '1', enabled: true, type: 'count', schema: 'metric', params: {} }] : [];
  return {
    title: '',
    description: '',
    type,
    params: defaultParams(type),
    aggs,
    uiState: {},
    source: { indexId: source.savedSearchId ? undefined : source.indexPatternId, filters: [] },
    savedSearchId: source.savedSearchId,
    references: [],
  };
}

// --- Which aggregations a part of a chart accepts -------------------------------------------------

const NOT_GEO = ['!geo_centroid', '!geo_bounds'];
const NOT_GRIDS = ['!geohash_grid', '!geotile_grid', '!filter'];
const RADIUS = ['count', 'avg', 'sum', 'min', 'max', 'cardinality'];
const NO_PIPELINE = ['!derivative', '!serial_diff', '!moving_avg', '!cumulative_sum'];
const XY_FILTERS = { metric: NOT_GEO, radius: RADIUS, segment: NOT_GRIDS, group: NOT_GRIDS, split: NOT_GRIDS };
const MAP_METRICS = ['count', 'avg', 'sum', 'min', 'max', 'cardinality', 'top_hits'];

/** The `aggFilter` of the original's schemas: what each part of each kind of chart accepts */
const AGG_FILTERS: Record<string, Record<string, string[]>> = {
  area: XY_FILTERS,
  histogram: XY_FILTERS,
  horizontal_bar: XY_FILTERS,
  line: { ...XY_FILTERS, radius: [...RADIUS, 'top_hits'] },
  pie: { metric: ['sum', 'count', 'cardinality', 'top_hits'], segment: NOT_GRIDS, split: NOT_GRIDS },
  gauge: { metric: ['!std_dev', '!geo_centroid', '!percentiles', '!percentile_ranks', ...NO_PIPELINE, '!geo_bounds'], group: NOT_GRIDS },
  goal: { metric: ['!std_dev', '!geo_centroid', '!percentiles', '!percentile_ranks', ...NO_PIPELINE, '!geo_bounds'], group: NOT_GRIDS },
  heatmap: {
    metric: ['count', 'avg', 'median', 'sum', 'min', 'max', 'cardinality', 'std_dev', 'top_hits'],
    segment: NOT_GRIDS,
    group: NOT_GRIDS,
    split: NOT_GRIDS,
  },
  metric: { metric: ['!std_dev', '!geo_centroid', ...NO_PIPELINE, '!geo_bounds'], group: NOT_GRIDS },
  tagcloud: { metric: ['!std_dev', '!percentiles', '!percentile_ranks', '!derivative', '!geo_bounds', '!geo_centroid'], segment: ['terms', 'significant_terms'] },
  table: { metric: NOT_GEO, bucket: ['!filter'], split: ['!filter'] },
  tile_map: { metric: MAP_METRICS, segment: ['geohash_grid'] },
  region_map: { metric: [...MAP_METRICS, 'sum_bucket', 'min_bucket', 'max_bucket', 'avg_bucket'], segment: ['terms'] },
};

/** The parts of a chart that must be asked before any other bucket */
const MUST_BE_FIRST: Record<string, string[]> = { pie: ['split'] };
/** The parts of a chart whose top hit may be on a field of text */
const ALLOW_STRINGS: Record<string, string[]> = { table: ['metric'], metric: ['metric'] };

export const mustBeFirst = (type: string, schema: string | undefined) => Boolean(schema && MUST_BE_FIRST[type]?.includes(schema));
export const allowsStrings = (type: string, schema: string | undefined) => Boolean(schema && ALLOW_STRINGS[type]?.includes(schema));

/** What a list of names allows: names, or names to refuse after a `!` */
function filterNames(names: readonly string[], filter: readonly string[]): string[] {
  const wanted = filter.filter((name) => !name.startsWith('!'));
  const refused = new Set(filter.filter((name) => name.startsWith('!')).map((name) => name.slice(1)));
  return names.filter((name) => (wanted.length ? wanted.includes(name) : true) && !refused.has(name));
}

/**
 * The aggregations someone may choose for a part of a kind of chart. The bucket types named by
 * the advanced setting `visualize:disableBucketAgg` are not offered, as the original leaves them
 * out of its registry.
 */
export function allowedAggs(type: string, schema: Schema, disabledBuckets: readonly string[] = []): string[] {
  const all: readonly string[] = schema.group === 'metrics' ? METRIC_TYPES : BUCKET_TYPES.filter((name) => !disabledBuckets.includes(name));
  return filterNames(all, AGG_FILTERS[type]?.[schema.name] ?? []);
}

/**
 * Aggregations as the original reads them while `visualize:disableBucketAgg` names their type: the
 * type is gone from its registry, so such an aggregation keeps its id, its state and its part in
 * the chart but loses its type and its parameters, in the list and inside another's parameters.
 * The editor then shows it without an aggregation, and the request leaves it out.
 */
export function withoutDisabledBuckets(aggs: AggConfig[], disabledBuckets: readonly string[]): AggConfig[] {
  if (!disabledBuckets.length) return aggs;
  const isAgg = (value: unknown): value is AggConfig =>
    value !== null && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string' && typeof (value as { type?: unknown }).type === 'string';
  const strip = (agg: AggConfig): AggConfig => {
    if ((BUCKET_TYPES as readonly string[]).includes(agg.type) && disabledBuckets.includes(agg.type)) {
      const out: AggConfig = { id: agg.id, enabled: agg.enabled, type: '', params: {} };
      if (agg.schema !== undefined) out.schema = agg.schema;
      return out;
    }
    if (!agg.params) return agg;
    let changed = false;
    const params: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(agg.params)) {
      params[key] = isAgg(value) ? strip(value) : value;
      changed = changed || params[key] !== value;
    }
    return changed ? { ...agg, params } : agg;
  };
  return aggs.map(strip);
}

/** The aggregations an aggregation inside another may be: the original's `allowedAggs` of the parameter */
export function nestedAggs(parentType: string, param: string, disabledBuckets: readonly string[] = []): string[] {
  if (param === 'customBucket') return BUCKET_TYPES.filter((name) => !disabledBuckets.includes(name));
  const excluded = ['top_hits', 'percentiles', 'percentile_ranks', 'median', 'std_dev'];
  if (param === 'orderAgg') {
    return filterNames(METRIC_TYPES, ['top_hits', 'percentiles', 'median', 'std_dev', ...PARENT_PIPELINES, ...SIBLING_PIPELINES].map((name) => `!${name}`));
  }
  if (SIBLING_PIPELINES.includes(parentType)) {
    return filterNames(METRIC_TYPES, [...excluded, ...SIBLING_PIPELINES, ...PARENT_PIPELINES].map((name) => `!${name}`));
  }
  return filterNames(METRIC_TYPES, excluded.map((name) => `!${name}`));
}

export const SIBLING_PIPELINES = ['avg_bucket', 'sum_bucket', 'min_bucket', 'max_bucket'];
export const PARENT_PIPELINES = ['derivative', 'cumulative_sum', 'moving_avg', 'serial_diff'];

/** The heading an aggregation is listed under in the editor's select, cased as OpenSearch Dashboards cases each */
export function aggGroup(type: string): string | undefined {
  if (SIBLING_PIPELINES.includes(type)) return 'Sibling pipeline aggregations';
  if (PARENT_PIPELINES.includes(type)) return 'Parent Pipeline Aggregations';
  return (METRIC_TYPES as readonly string[]).includes(type) ? 'Metric Aggregations' : undefined;
}

const byLabel = (a = '', b = '') => a.toLowerCase().localeCompare(b.toLowerCase());

/**
 * The aggregations the editor's select offers, as OpenSearch Dashboards lists them: by title,
 * under headings in the same order, and with no heading when all would be under one. A nested
 * aggregation's are listed without headings.
 */
export function aggTypeOptions(types: readonly string[], nested?: boolean): Array<{ value: string; label: string; group?: string }> {
  const options = types.map((type) => ({ value: type, label: AGG_TITLES[type] ?? type, group: nested ? undefined : aggGroup(type) }));
  const headed = new Set(options.map((option) => option.group)).size > 1;
  return options
    .map((option) => (headed ? option : { ...option, group: undefined }))
    .sort((a, b) => byLabel(a.group, b.group) || byLabel(a.label, b.label));
}

// --- Which fields an aggregation accepts ----------------------------------------------------------

export const FIELD_TYPES: Record<string, string[] | '*'> = {
  avg: ['number'],
  sum: ['number'],
  median: ['number', 'date'],
  min: ['number', 'date'],
  max: ['number', 'date'],
  std_dev: ['number'],
  cardinality: '*',
  percentiles: ['number', 'date'],
  percentile_ranks: ['number'],
  top_hits: '*',
  date_histogram: ['date'],
  histogram: ['number'],
  range: ['number'],
  date_range: ['date'],
  ip_range: ['ip'],
  terms: ['number', 'boolean', 'date', 'ip', 'string'],
  significant_terms: ['string'],
  geohash_grid: ['geo_point'],
};

/** Whether an aggregation is on a field at all: a count and the pipelines are not */
export const takesField = (type: string) => type in FIELD_TYPES;

// --- New aggregations -----------------------------------------------------------------------------

export function nextAggId(aggs: AggConfig[]): string {
  let highest = 0;
  for (const agg of aggs) {
    const id = Number.parseInt(agg.id, 10);
    if (Number.isFinite(id) && id > highest) highest = id;
  }
  return String(highest + 1);
}

const fieldName = (agg: AggConfig | undefined): string | undefined => {
  const field = agg?.params?.field as string | { name?: string } | undefined;
  return typeof field === 'string' ? field : field?.name;
};

/** A count inside another aggregation, as the original's `makeAgg` makes one */
export const nestedCount = (id: string, schema?: string): AggConfig => ({ id, enabled: true, type: 'count', params: {}, ...(schema ? { schema } : {}) });

/**
 * The parameters an aggregation has when someone has just chosen its type: its type's defaults,
 * with what the editor of each sets as it opens. A terms aggregation is ordered by the first
 * metric it can be ordered by; a pipeline gets the aggregations inside it.
 */
export function defaultAggParams(
  type: string,
  id: string,
  indexPattern: IndexPattern | undefined,
  aggs: AggConfig[],
  language = 'kuery',
  field?: string
): Record<string, unknown> {
  const env = { indexPattern, queryLanguage: language };
  const params = paramsForType(type, field, env);
  if (type === 'terms') {
    const metric = aggs.find((agg) => isMetricSchema(agg) && orderableMetric(agg));
    params.orderBy = metric ? metric.id : '_key';
  }
  if (SIBLING_PIPELINES.includes(type)) {
    params.customBucket = { id: `${id}-bucket`, enabled: true, type: 'date_histogram', params: paramsForType('date_histogram', undefined, env) };
    params.customMetric = nestedCount(`${id}-metric`);
  }
  if (PARENT_PIPELINES.includes(type)) params.customMetric = nestedCount(`${id}-metric`);
  return params;
}

const isMetricSchema = (agg: AggConfig) => agg.schema === undefined || agg.schema === 'metric' || agg.schema === 'radius';

/** Whether the buckets of a terms aggregation can be ordered by a metric of the chart */
export const orderableMetric = (agg: AggConfig) =>
  agg.enabled !== false &&
  (METRIC_TYPES as readonly string[]).includes(agg.type) &&
  !['top_hits', 'percentiles', 'percentile_ranks', 'std_dev', 'median', ...SIBLING_PIPELINES, ...PARENT_PIPELINES].includes(agg.type);

/**
 * The parameters of a terms aggregation once someone chooses what it is ordered by: it has a custom
 * metric only while it is ordered by one, as the original's `order_agg` editor takes it away
 */
export const orderByParams = (aggId: string, orderBy: string, orderAgg: unknown): Record<string, unknown> => ({
  orderBy,
  orderAgg: orderBy === 'custom' ? (orderAgg ?? nestedCount(`${aggId}-orderAgg`, 'orderAgg')) : undefined,
});

/** Whether a parent pipeline can work on a metric of the chart, as the original's `metric_agg` editor filters them */
export const parentPipelineMetric = (agg: AggConfig) => !['top_hits', 'percentiles', 'percentile_ranks', 'median', 'std_dev'].includes(agg.type);

/**
 * What a terms aggregation is ordered by, or a parent pipeline works on, once the chart's metrics
 * have changed, as the original's `useFallbackMetric`: a metric that is gone, or one that cannot be
 * used, gives way to the fallback. Nothing when the choice stands.
 */
export function fallbackMetric(chosen: string, metrics: AggConfig[], usable: (agg: AggConfig) => boolean, fallback: string): string | undefined {
  if (!chosen || chosen === 'custom' || chosen === fallback) return undefined;
  return metrics.some((metric) => metric.id === chosen && usable(metric)) ? undefined : fallback;
}

/**
 * The aggregations with one more, for a part of the chart, as the original adds one: last of
 * them all, with no type until someone chooses one.
 */
export function addAgg(aggs: AggConfig[], schema: Schema): AggConfig[] {
  return [...aggs, { id: nextAggId(aggs), enabled: true, type: '', schema: schema.name, params: {} }];
}

/**
 * The same aggregation with another type, as the original's type setter: the field is kept when
 * the new type accepts it, everything else starts again from the new type's defaults.
 */
export function changeAggType(
  agg: AggConfig,
  type: string,
  indexPattern: IndexPattern | undefined,
  aggs: AggConfig[],
  language?: string
): AggConfig {
  const field = fieldName(agg);
  const kept = field && availableFields(type, indexPattern).some((candidate) => candidate.name === field) ? field : undefined;
  return { ...agg, type, params: defaultAggParams(type, agg.id, indexPattern, aggs, language, kept) };
}

/** The aggregations without one, as the original removes one: a chart keeps a metric switched on */
export function removeAgg(aggs: AggConfig[], id: string, schemas: Schema[]): AggConfig[] {
  const removed = aggs.find((agg) => agg.id === id);
  const next = aggs.filter((agg) => agg.id !== id);
  const wasMetric = schemas.find((schema) => schema.name === removed?.schema)?.group === 'metrics';
  if (wasMetric && !next.some((agg) => agg.schema === 'metric' && agg.enabled !== false)) {
    const first = next.findIndex((agg) => agg.schema === 'metric');
    if (first !== -1) return next.map((agg, index) => (index === first ? { ...agg, enabled: true } : agg));
  }
  return next;
}

/** The aggregations with one moved to where another was, as the original's drag and drop */
export function reorderAggs(aggs: AggConfig[], sourceId: string, destinationId: string): AggConfig[] {
  const from = aggs.findIndex((agg) => agg.id === sourceId);
  const to = aggs.findIndex((agg) => agg.id === destinationId);
  if (from === -1 || to === -1 || from === to) return aggs;
  const next = [...aggs];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

// --- What is wrong with an aggregation ------------------------------------------------------------

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const isIp = (text: unknown) => typeof text === 'string' && IPV4.test(text);
const isCidr = (text: unknown) => {
  if (typeof text !== 'string') return false;
  const [ip, bits, ...rest] = text.split('/');
  return rest.length === 0 && isIp(ip) && /^\d{1,2}$/.test(bits ?? '') && Number(bits) <= 32;
};
const isDateMath = (text: unknown) => typeof text === 'string' && text !== '' && (parseDateMath(text) !== undefined || !Number.isNaN(new Date(text).getTime()));
const isBlank = (value: unknown) => value === undefined || value === null || value === '';

/** An end of a date range the original takes: nothing, or date math or a date */
export const isValidDateMath = (text: unknown): boolean => isBlank(text) || isDateMath(text);

/** A field of an IP range the original takes: nothing, or an address (a mask with `cidr`) */
export const isValidIpField = (text: unknown, cidr = false): boolean => isBlank(text) || (cidr ? isCidr(text) : isIp(text));

/** Whether an interval is one a date histogram takes: auto, a unit, or a number of a unit */
export function isValidDateInterval(value: unknown): boolean {
  if (typeof value !== 'string' || value.trim() === '') return false;
  const text = value.trim();
  if (text === 'auto' || text === 'custom') return true;
  return parseInterval(text) !== undefined;
}

/** Whether JSON input is JSON, or nothing */
export function isValidJson(json: unknown): boolean {
  if (typeof json !== 'string' || json.trim() === '') return true;
  try {
    JSON.parse(json);
    return true;
  } catch {
    return false;
  }
}

export interface ProblemOptions {
  /** The kind of chart: a top hit takes text where it allows it */
  visType?: string;
  /** Every aggregation of the chart: a pipeline points at one of them */
  aggs?: AggConfig[];
}

/**
 * What is wrong with each parameter of an aggregation, as the original's editors judge them: a
 * message to show under it, or `true` for a field drawn invalid without one. `type` is the
 * aggregation itself.
 */
export function paramProblems(agg: AggConfig, indexPattern: IndexPattern | undefined, options: ProblemOptions = {}): Record<string, string | true> {
  const problems: Record<string, string | true> = {};
  if (!agg.type) {
    problems.type = true;
    return problems;
  }
  const params = agg.params ?? {};
  const allowStrings = options.visType ? allowsStrings(options.visType, agg.schema) : true;
  if (takesField(agg.type)) {
    const fields = availableFields(agg.type, indexPattern, 'field', allowStrings);
    const name = fieldName(agg);
    if (!fields.length) {
      problems.field = `The index pattern ${indexPattern?.displayName || indexPattern?.title || ''} does not contain any of the following compatible field types: ${prose(fieldTypesOf(agg.type))}`;
    } else if (!name || (indexPattern && !indexPattern.fields.some((field) => field.name === name))) problems.field = true;
  }
  const json = params.json;
  if (!isValidJson(json)) problems.json = true;
  switch (agg.type) {
    case 'terms': {
      if (!(Number(params.size) > 0)) problems.size = true;
      if (!params.orderBy) problems.orderBy = true;
      if (params.orderBy === 'custom') nested(problems, 'orderAgg', params.orderAgg, indexPattern, options);
      break;
    }
    case 'significant_terms':
      if (!(Number(params.size) > 0)) problems.size = true;
      break;
    case 'top_hits': {
      if (!(Number(params.size) > 0)) problems.size = true;
      const field = indexPattern?.fields.find((candidate) => candidate.name === fieldName(agg));
      if (field && !params.aggregate) problems.aggregate = topAggregates(field.type).length ? true : 'The chosen field has no compatible aggregations.';
      const sortFields = availableFields('top_hits', indexPattern, 'sortField');
      const sort = params.sortField as string | { name?: string } | undefined;
      const sortName = typeof sort === 'string' ? sort : sort?.name;
      if (sortFields.length && !sortName) problems.sortField = true;
      break;
    }
    case 'histogram': {
      const interval = params.interval;
      if (isBlank(interval) || (interval !== 'auto' && !(Number(interval) >= 0))) problems.interval = true;
      if (params.has_extended_bounds) {
        const bounds = (params.extended_bounds ?? {}) as { min?: unknown; max?: unknown };
        if (isBlank(bounds.min) || isBlank(bounds.max)) problems.extended_bounds = true;
        else if (Number(bounds.max) < Number(bounds.min)) problems.extended_bounds = 'Min should be less than or equal to Max.';
      }
      break;
    }
    case 'date_histogram': {
      const interval = params.interval === 'custom' ? params.customInterval : params.interval;
      // As the original, weeks, months and years are asked one at a time
      const calendar = typeof interval === 'string' ? /^([1-9][0-9]*)\s*(w|M|y)$/.exec(interval.trim()) : null;
      if (calendar && Number(calendar[1]) !== 1) problems.interval = `Invalid calendar interval: ${String(interval)}, value must be 1`;
      else if (!isValidDateInterval(interval)) problems.interval = isBlank(interval) ? true : 'Invalid interval format.';
      break;
    }
    case 'date_range': {
      const ranges = (Array.isArray(params.ranges) ? params.ranges : []) as Array<{ from?: string; to?: string }>;
      const wrong = ranges.some(({ from, to }) => (!from && !to) || (Boolean(from) && !isDateMath(from)) || (Boolean(to) && !isDateMath(to)));
      if (wrong) problems.ranges = 'Each range should have at least one valid date.';
      break;
    }
    case 'ip_range': {
      const ranges = (params.ranges ?? {}) as { fromTo?: Array<{ from?: string; to?: string }>; mask?: Array<{ mask?: string }> };
      const wrong =
        params.ipRangeType === 'mask'
          ? (ranges.mask ?? []).some((item) => !isCidr(item.mask))
          : (ranges.fromTo ?? []).some((item) => (!isBlank(item.from) && !isIp(item.from)) || (!isBlank(item.to) && !isIp(item.to)));
      if (wrong) problems.ranges = true;
      break;
    }
    case 'percentiles':
    case 'percentile_ranks': {
      const name = agg.type === 'percentiles' ? 'percents' : 'values';
      const list = (Array.isArray(params[name]) ? params[name] : []) as unknown[];
      const numbers = list.map((value) => (isBlank(value) ? Number.NaN : Number(value)));
      const outOfRange = agg.type === 'percentiles' && numbers.some((value) => value < 0 || value > 100);
      const repeated = agg.type === 'percentiles' && new Set(numbers).size !== numbers.length;
      const unordered = agg.type === 'percentile_ranks' && numbers.some((value, index) => index > 0 && value <= numbers[index - 1]);
      if (!list.length || numbers.some(Number.isNaN) || outOfRange || repeated || unordered) problems[name] = true;
      break;
    }
    default:
      break;
  }
  if (SIBLING_PIPELINES.includes(agg.type)) {
    nested(problems, 'customBucket', params.customBucket, indexPattern, options);
    nested(problems, 'customMetric', params.customMetric, indexPattern, options);
  }
  if (PARENT_PIPELINES.includes(agg.type)) {
    if (!params.metricAgg) problems.metricAgg = true;
    else if (params.metricAgg === 'custom') nested(problems, 'customMetric', params.customMetric, indexPattern, options);
  }
  return problems;
}

function nested(problems: Record<string, string | true>, name: string, value: unknown, indexPattern: IndexPattern | undefined, options: ProblemOptions) {
  const agg = value as AggConfig | undefined;
  if (!agg || typeof agg !== 'object') {
    problems[name] = true;
    return;
  }
  if (Object.keys(paramProblems(agg, indexPattern, { aggs: options.aggs })).length) problems[name] = true;
}

/** The ways a top hit can reduce several values of a field to one, for a type of field */
export function topAggregates(fieldType: string | undefined): Array<{ value: string; label: string }> {
  const concat = { value: 'concat', label: 'Concatenate' };
  if (fieldType === 'number') {
    return [{ value: 'average', label: 'Average' }, concat, { value: 'max', label: 'Max' }, { value: 'min', label: 'Min' }, { value: 'sum', label: 'Sum' }];
  }
  return fieldType && fieldType !== '_source' && fieldType !== 'geo_shape' ? [concat] : [];
}

/** A list in words, as the original's `formatListAsProse` without the last comma */
function prose(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`;
}

/** Why an aggregation cannot be asked yet, or nothing */
export function aggProblem(agg: AggConfig, indexPattern: IndexPattern | undefined, options: ProblemOptions = {}): string | undefined {
  const problems = paramProblems(agg, indexPattern, options);
  const [name] = Object.keys(problems);
  if (!name) return undefined;
  const problem = problems[name];
  if (typeof problem === 'string') return problem;
  return name === 'type' ? 'Select an aggregation' : name === 'field' ? 'Select a field' : `Check ${name}`;
}

/** The title of the last parent pipeline metric that is asked: the buckets must end in a histogram for it */
export function lastParentPipelineTitle(aggs: AggConfig[], schemas: Schema[]): string | undefined {
  const metrics = aggs.filter((agg) => agg.enabled !== false && agg.type && schemas.find((schema) => schema.name === agg.schema)?.group === 'metrics');
  const last = [...metrics].reverse().find((agg) => PARENT_PIPELINES.includes(agg.type));
  return last ? AGG_TITLES[last.type] : undefined;
}

/**
 * What keeps a chart from being drawn, by aggregation: one in error, a bucket out of its place,
 * a parent pipeline without the histogram it needs under it; `buckets` when there is no bucket
 * at all for it.
 */
export function visProblems(vis: Pick<Vis, 'type' | 'aggs'>, indexPattern: IndexPattern | undefined): Record<string, string> {
  const problems: Record<string, string> = {};
  const schemas = visType(vis.type)?.schemas ?? [];
  for (const agg of vis.aggs) {
    const problem = aggProblem(agg, indexPattern, { visType: vis.type, aggs: vis.aggs });
    if (problem) problems[agg.id] = problem;
  }
  const buckets = vis.aggs.filter((agg) => schemas.find((schema) => schema.name === agg.schema)?.group === 'buckets');
  const pipeline = lastParentPipelineTitle(vis.aggs, schemas);
  if (pipeline) {
    const last = buckets[buckets.length - 1];
    if (!last) problems.buckets = 'Add a bucket with "Date Histogram" or "Histogram" aggregation.';
    else if (last.type && last.type !== 'date_histogram' && last.type !== 'histogram' && !problems[last.id]) {
      problems[last.id] = `Last bucket aggregation must be "Date Histogram" or "Histogram" when using "${pipeline}" metric aggregation.`;
    }
  }
  buckets.forEach((agg, index) => {
    if (!mustBeFirst(vis.type, agg.schema) || problems[agg.id]) return;
    const firstOther = buckets.findIndex((other) => other.schema !== agg.schema);
    if (firstOther !== -1 && index > firstOther) {
      const title = schemas.find((schema) => schema.name === agg.schema)?.title ?? agg.schema;
      problems[agg.id] = `"${title}" aggs must run before all other buckets!`;
    }
  });
  return problems;
}

// --- Settings that follow the aggregations --------------------------------------------------------

interface SeriesParam {
  show?: boolean;
  type?: string;
  mode?: string;
  data: { id: string; label: string };
  valueAxis?: string;
  [other: string]: unknown;
}

interface ValueAxis {
  id: string;
  name?: string;
  position?: string;
  title?: { text?: string };
  [other: string]: unknown;
}

const isXY = (type: string) => type === 'area' || type === 'line' || type === 'histogram' || type === 'horizontal_bar';

// The title an axis takes by itself: the label of its series, when it has one only
function axisLabels(series: SeriesParam[], axes: ValueAxis[]): Record<string, string> {
  const labels: Record<string, string> = {};
  axes.forEach((axis, index) => {
    const own = series.filter((item) => item.valueAxis === axis.id || (index === 0 && !item.valueAxis));
    if (own.length === 1) labels[axis.id] = own[0].data.label;
  });
  return labels;
}

/**
 * The settings of a line, area or bar chart after its aggregations changed: one entry of
 * `seriesParams` per metric, in their order, and an axis title that follows the metric it
 * shows unless someone wrote another.
 */
export function syncParams(vis: Pick<Vis, 'type' | 'params' | 'aggs'>, context: AggContext): Record<string, unknown> {
  if (!isXY(vis.type)) return vis.params;
  const before = (Array.isArray(vis.params.seriesParams) ? vis.params.seriesParams : []) as SeriesParam[];
  const axes = (Array.isArray(vis.params.valueAxes) ? vis.params.valueAxes : []) as ValueAxis[];
  const metrics = vis.aggs.filter((agg) => agg.schema === 'metric' && agg.type);
  const firstAxis = axes[0]?.id ?? 'ValueAxis-1';

  const series = metrics.map((agg) => {
    const label = aggLabel(agg, context);
    const existing = before.find((item) => item.data?.id === agg.id);
    if (existing) return existing.data.label === label ? existing : { ...existing, data: { id: agg.id, label } };
    const last = before[before.length - 1];
    const fresh: SeriesParam = {
      show: true,
      mode: 'normal',
      type: 'line',
      drawLinesBetweenPoints: true,
      showCircles: true,
      interpolate: 'linear',
      lineWidth: 2,
      valueAxis: firstAxis,
      data: { id: agg.id, label },
    };
    return last ? { ...last, data: { id: agg.id, label } } : fresh;
  });

  const oldLabels = axisLabels(before, axes);
  const newLabels = axisLabels(series, axes);
  let axesChanged = false;
  const nextAxes = axes.map((axis) => {
    const label = newLabels[axis.id];
    const text = axis.title?.text ?? '';
    if (label === undefined || label === text) return axis;
    if (text !== '' && text !== oldLabels[axis.id]) return axis;
    axesChanged = true;
    return { ...axis, title: { ...axis.title, text: label } };
  });

  const seriesChanged = series.length !== before.length || series.some((item, index) => item !== before[index]);
  if (!seriesChanged && !axesChanged) return vis.params;
  return { ...vis.params, seriesParams: series, valueAxes: axesChanged ? nextAxes : axes };
}

/** The name an axis takes from its side: `LeftAxis-1`, `RightAxis-2` */
export function axisName(position: string, axes: Array<{ name?: string }>): string {
  const prefix = `${position.charAt(0).toUpperCase()}${position.slice(1)}Axis-`;
  let next = 1;
  for (const axis of axes) {
    if (!axis.name?.startsWith(prefix)) continue;
    const number = Number.parseInt(axis.name.slice(prefix.length), 10);
    if (number >= next) next = number + 1;
  }
  return `${prefix}${next}`;
}

export function nextAxisId(axes: Array<{ id: string }>): string {
  let next = 1;
  for (const axis of axes) {
    const number = Number.parseInt(axis.id.replace('ValueAxis-', ''), 10);
    if (number >= next) next = number + 1;
  }
  return `ValueAxis-${next}`;
}

export const oppositeSide = (position: string) =>
  ({ left: 'right', right: 'left', top: 'bottom', bottom: 'top' })[position] ?? 'right';

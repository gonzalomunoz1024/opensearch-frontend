/* SPDX-License-Identifier: Apache-2.0 */

/*
 * What the editor of a visualization starts from and holds to: the settings a new visualization
 * of each kind has, the aggregations each part of a chart accepts, the fields each aggregation
 * accepts, and the settings that follow the aggregations (a line chart keeps one entry of
 * `seriesParams` per metric). All of it is as OpenSearch Dashboards 3.9.0 has it, so what is
 * saved here opens there and the other way round.
 */

import { METRIC_TYPES, BUCKET_TYPES, aggLabel, type AggConfig, type AggContext } from '../../lib/aggs';
import type { Field, IndexPattern } from '../../lib/types';
import { visType, type Vis, type VisType } from '../../lib/vis';

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
  input_control_vis: () => ({ controls: [], updateFiltersOnChange: false, useTimeFilter: false, pinFilters: false }),
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

const NO_PIPELINE = ['!derivative', '!serial_diff', '!moving_avg', '!cumulative_sum'];
const ANY_BUCKET = ['!geohash_grid'];

const AGG_FILTERS: Record<string, Record<string, string[]>> = {
  xy: {
    radius: ['count', 'avg', 'sum', 'min', 'max', 'cardinality', 'top_hits'],
    segment: ANY_BUCKET,
    group: ANY_BUCKET,
    split: ANY_BUCKET,
  },
  pie: { metric: ['sum', 'count', 'cardinality', 'top_hits'], segment: ANY_BUCKET, split: ANY_BUCKET },
  gauge: { metric: ['!std_dev', '!percentiles', '!percentile_ranks', ...NO_PIPELINE], group: ANY_BUCKET },
  heatmap: {
    metric: ['count', 'avg', 'median', 'sum', 'min', 'max', 'cardinality', 'std_dev', 'top_hits'],
    segment: ANY_BUCKET,
    group: ANY_BUCKET,
    split: ANY_BUCKET,
  },
  metric: { metric: ['!std_dev', ...NO_PIPELINE], group: ANY_BUCKET },
  tagcloud: { metric: ['!std_dev', '!percentiles', '!percentile_ranks', '!derivative'], segment: ['terms', 'significant_terms'] },
  table: {},
  tile_map: { metric: ['count', 'avg', 'sum', 'min', 'max', 'cardinality', 'top_hits'], segment: ['geohash_grid'] },
  region_map: { metric: ['count', 'avg', 'sum', 'min', 'max', 'cardinality', 'top_hits'], segment: ['terms'] },
};

const filterFamily = (type: string) =>
  type === 'area' || type === 'line' || type === 'histogram' || type === 'horizontal_bar' ? 'xy' : type === 'goal' ? 'gauge' : type;

/** The aggregations someone may choose for a part of a kind of chart, in the order they are listed */
export function allowedAggs(type: string, schema: Schema): string[] {
  const all: readonly string[] = schema.group === 'metrics' ? METRIC_TYPES : BUCKET_TYPES;
  const filter = AGG_FILTERS[filterFamily(type)]?.[schema.name] ?? [];
  const wanted = filter.filter((name) => !name.startsWith('!'));
  const refused = new Set(filter.filter((name) => name.startsWith('!')).map((name) => name.slice(1)));
  return all.filter((name) => (wanted.length ? wanted.includes(name) : true) && !refused.has(name));
}

export const SIBLING_PIPELINES = ['avg_bucket', 'sum_bucket', 'min_bucket', 'max_bucket'];
export const PARENT_PIPELINES = ['derivative', 'cumulative_sum', 'moving_avg', 'serial_diff'];

/** The heading an aggregation is listed under in the editor's select, cased as OpenSearch Dashboards cases each */
export function aggGroup(type: string): string | undefined {
  if (SIBLING_PIPELINES.includes(type)) return 'Sibling pipeline aggregations';
  if (PARENT_PIPELINES.includes(type)) return 'Parent Pipeline Aggregations';
  return (METRIC_TYPES as readonly string[]).includes(type) ? 'Metric Aggregations' : undefined;
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

const META_FIELDS = new Set(['_id', '_index', '_score', '_source', '_type']);

/** The fields of an index pattern an aggregation can be on, by name */
export function fieldsFor(type: string, indexPattern: IndexPattern | undefined, purpose: 'field' | 'sort' = 'field'): Field[] {
  const fields = indexPattern?.fields ?? [];
  let accepted: Field[];
  if (purpose === 'sort') {
    accepted = fields.filter((field) => field.aggregatable && ['number', 'date', 'ip', 'string'].includes(field.type));
  } else if (type === 'top_hits') {
    // A top hit reads the document itself, so any field of it will do
    accepted = fields.filter((field) => !META_FIELDS.has(field.name) || field.name === '_source');
  } else {
    const types = FIELD_TYPES[type];
    if (!types) return [];
    accepted = fields.filter(
      (field) => (field.aggregatable || field.scripted) && !META_FIELDS.has(field.name) && (types === '*' || types.includes(field.type))
    );
  }
  return [...accepted].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
}

// --- New aggregations -----------------------------------------------------------------------------

export function nextAggId(aggs: AggConfig[]): string {
  let highest = 0;
  for (const agg of aggs) {
    const id = Number.parseInt(agg.id, 10);
    if (Number.isFinite(id) && id > highest) highest = id;
  }
  return String(highest + 1);
}

/** The parameters an aggregation has when someone has just chosen its type */
export function defaultAggParams(
  type: string,
  id: string,
  indexPattern: IndexPattern | undefined,
  aggs: AggConfig[],
  language = 'kuery'
): Record<string, unknown> {
  const timeField = indexPattern?.timeFieldName;
  switch (type) {
    case 'date_histogram':
      return {
        field: timeField,
        timeRange: undefined,
        useNormalizedOpenSearchInterval: true,
        scaleMetricValues: false,
        interval: 'auto',
        drop_partials: false,
        min_doc_count: 1,
        extended_bounds: {},
      };
    case 'histogram':
      return { interval: 'auto', min_doc_count: false, has_extended_bounds: false, extended_bounds: { min: '', max: '' } };
    case 'range':
      return {
        ranges: [
          { from: 0, to: 1000 },
          { from: 1000, to: 2000 },
        ],
      };
    case 'date_range':
      return { ranges: [{ from: 'now-1w/w', to: 'now' }] };
    case 'ip_range':
      return {
        ipRangeType: 'fromTo',
        ranges: {
          fromTo: [
            { from: '0.0.0.0', to: '127.255.255.255' },
            { from: '128.0.0.0', to: '191.255.255.255' },
          ],
          mask: [{ mask: '0.0.0.0/1' }, { mask: '128.0.0.0/2' }],
        },
      };
    case 'terms': {
      const metric = aggs.find((agg) => orderableMetric(agg));
      return {
        orderBy: metric ? metric.id : '_key',
        order: 'desc',
        size: 5,
        otherBucket: false,
        otherBucketLabel: 'Other',
        missingBucket: false,
        missingBucketLabel: 'Missing',
      };
    }
    case 'significant_terms':
      return { size: 10 };
    case 'filters':
      return { filters: [{ input: { query: '', language }, label: '' }] };
    case 'geohash_grid':
      return { autoPrecision: true, precision: 2, useGeocentroid: true, isFilteredByCollar: true };
    case 'percentiles':
      return { percents: [1, 5, 25, 50, 75, 95, 99] };
    case 'percentile_ranks':
      return { values: [0] };
    case 'top_hits':
      return { aggregate: 'concat', size: 1, sortField: timeField, sortOrder: 'desc' };
    case 'avg_bucket':
    case 'sum_bucket':
    case 'min_bucket':
    case 'max_bucket':
      return {
        customBucket: {
          id: `${id}-bucket`,
          enabled: true,
          type: 'date_histogram',
          params: defaultAggParams('date_histogram', `${id}-bucket`, indexPattern, aggs, language),
        },
        customMetric: { id: `${id}-metric`, enabled: true, type: 'count', params: {} },
      };
    case 'derivative':
    case 'cumulative_sum':
    case 'moving_avg':
    case 'serial_diff':
      return { metricAgg: 'custom', customMetric: { id: `${id}-metric`, enabled: true, type: 'count', params: {} } };
    default:
      return {};
  }
}

/** Whether the buckets of a terms aggregation can be ordered by a metric of the chart */
export const orderableMetric = (agg: AggConfig) =>
  agg.enabled !== false &&
  (METRIC_TYPES as readonly string[]).includes(agg.type) &&
  !['top_hits', 'percentiles', 'percentile_ranks', 'std_dev', ...SIBLING_PIPELINES, ...PARENT_PIPELINES].includes(agg.type);

/**
 * The aggregations with one more, for a part of the chart. A metric starts as a count; a bucket
 * has no type until someone chooses one. A chart is split before anything else, so the
 * aggregation that splits it goes in front of the other buckets.
 */
export function addAgg(aggs: AggConfig[], schema: Schema): AggConfig[] {
  const id = nextAggId(aggs);
  const agg: AggConfig = { id, enabled: true, type: schema.group === 'metrics' ? 'count' : '', schema: schema.name, params: {} };
  if (schema.name === 'split') {
    if (schema.group === 'buckets') agg.params = { row: true };
    const firstBucket = aggs.findIndex((candidate) => !(METRIC_TYPES as readonly string[]).includes(candidate.type));
    if (firstBucket === -1) return [...aggs, agg];
    return [...aggs.slice(0, firstBucket), agg, ...aggs.slice(firstBucket)];
  }
  return [...aggs, agg];
}

/** The same aggregation with another type: what the old and the new one share is kept */
export function changeAggType(
  agg: AggConfig,
  type: string,
  indexPattern: IndexPattern | undefined,
  aggs: AggConfig[],
  language?: string
): AggConfig {
  const params = defaultAggParams(type, agg.id, indexPattern, aggs, language);
  const kept: Record<string, unknown> = {};
  if (agg.params?.customLabel) kept.customLabel = agg.params.customLabel;
  if (agg.schema === 'split' && agg.params?.row !== undefined) kept.row = agg.params.row;
  const field = typeof agg.params?.field === 'string' ? agg.params.field : (agg.params?.field as { name?: string } | undefined)?.name;
  const accepted = fieldsFor(type, indexPattern);
  if (takesField(type)) {
    if (field && accepted.some((candidate) => candidate.name === field)) kept.field = field;
    else if (params.field === undefined && accepted.length === 1) kept.field = accepted[0].name;
  }
  return { ...agg, type, params: { ...params, ...kept } };
}

// --- What is wrong with an aggregation ------------------------------------------------------------

/** Why an aggregation cannot be asked yet, or nothing */
export function aggProblem(agg: AggConfig, indexPattern: IndexPattern | undefined): string | undefined {
  if (!agg.type) return 'Select an aggregation';
  const fieldName = typeof agg.params?.field === 'string' ? agg.params.field : (agg.params?.field as { name?: string } | undefined)?.name;
  if (takesField(agg.type)) {
    if (!fieldName) return 'Select a field';
    if (indexPattern && !indexPattern.fields.some((field) => field.name === fieldName)) {
      return `The field “${fieldName}” is not in this index pattern`;
    }
  }
  if (SIBLING_PIPELINES.includes(agg.type)) {
    const bucket = agg.params?.customBucket as AggConfig | undefined;
    const metric = agg.params?.customMetric as AggConfig | undefined;
    return (bucket ? aggProblem(bucket, indexPattern) : 'Select an aggregation') ?? (metric ? aggProblem(metric, indexPattern) : undefined);
  }
  if (PARENT_PIPELINES.includes(agg.type) && (agg.params?.metricAgg ?? 'custom') === 'custom') {
    const metric = agg.params?.customMetric as AggConfig | undefined;
    return metric ? aggProblem(metric, indexPattern) : 'Select an aggregation';
  }
  if (agg.type === 'terms' && agg.params?.orderBy === 'custom') {
    const order = agg.params?.orderAgg as AggConfig | undefined;
    return order ? aggProblem(order, indexPattern) : 'Select an aggregation';
  }
  if ((agg.type === 'terms' || agg.type === 'significant_terms') && !(Number(agg.params?.size) > 0)) return 'Size must be greater than 0';
  if (agg.type === 'histogram') {
    const interval = agg.params?.interval;
    if (interval !== 'auto' && interval !== undefined && !(Number(interval) > 0)) return 'Enter an interval';
  }
  return undefined;
}

/** What keeps a chart from being drawn: an aggregation in error, or a part it needs and lacks */
export function visProblems(vis: Pick<Vis, 'type' | 'aggs'>, indexPattern: IndexPattern | undefined): Record<string, string> {
  const problems: Record<string, string> = {};
  for (const agg of vis.aggs) {
    if (agg.enabled === false) continue;
    const problem = aggProblem(agg, indexPattern);
    if (problem) problems[agg.id] = problem;
  }
  for (const schema of visType(vis.type)?.schemas ?? []) {
    const count = vis.aggs.filter((agg) => agg.schema === schema.name && agg.enabled !== false).length;
    if (schema.min && count < schema.min) problems[`schema:${schema.name}`] = `${schema.title} needs at least ${schema.min}`;
  }
  const parent = vis.aggs.find((agg) => agg.enabled !== false && PARENT_PIPELINES.includes(agg.type));
  if (parent && !problems[parent.id]) {
    const buckets = vis.aggs.filter((agg) => agg.enabled !== false && !(METRIC_TYPES as readonly string[]).includes(agg.type));
    const last = buckets[buckets.length - 1];
    if (!last || (last.type !== 'date_histogram' && last.type !== 'histogram')) {
      problems[parent.id] = 'Add a bucket with "Date Histogram" or "Histogram" aggregation.';
    }
  }
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

const isXY = (type: string) => filterFamily(type) === 'xy';

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

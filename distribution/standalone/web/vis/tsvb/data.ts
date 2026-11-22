/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The data of a TSVB visualization. OpenSearch Dashboards works this out on its server; here the
 * browser asks OpenSearch for each series' buckets over time and does the rest: the measures
 * computed from other measures (derivative, moving average, cumulative sum, ratios, math), the
 * split into several series, the last value or the value over the whole time range.
 */

import { resolveInterval, resolveTimeRange, UNIT_MS, parseInterval, type AbsoluteRange } from '../../lib/dates';
import { DEFAULT_FORMAT_SETTINGS } from '../../lib/field_formats';
import { evaluateMath, type MathValue } from '../../lib/math_expression';
import { formatNumber } from '../../lib/numeral';
import { buildQuery, type BoolQuery } from '../../lib/query';
import type { IndexPattern, Query } from '../../lib/types';
import { services } from '../../services';
import type { RequestRecord } from '../../services/search';
import type { VisInput } from '../request';

type Dsl = Record<string, unknown>;

export interface TsvbMetric {
  id: string;
  type: string;
  field?: string;
  // Measures computed from another: which one, and how
  unit?: string;
  window?: number | string;
  lag?: number | string;
  percentiles?: Array<{ id?: string; value?: number | string; mode?: string }>;
  values?: Array<number | string>;
  value?: number | string;
  numerator?: Query | string;
  denominator?: Query | string;
  metric_agg?: string;
  script?: string;
  variables?: Array<{ id?: string; name?: string; field?: string }>;
  function?: string;
  size?: number | string;
  order_by?: string;
  order?: string;
  agg_with?: string;
}

export interface TsvbSeries {
  id: string;
  label?: string;
  var_name?: string;
  color?: string;
  split_mode?: 'everything' | 'filter' | 'filters' | 'terms';
  terms_field?: string;
  terms_size?: number | string;
  terms_order_by?: string;
  terms_direction?: 'asc' | 'desc';
  terms_include?: string;
  terms_exclude?: string;
  filter?: Query | string;
  split_filters?: Array<{ id: string; color?: string; filter?: Query | string; label?: string }>;
  split_color_mode?: string;
  trend_arrows?: number | string;
  metrics?: TsvbMetric[];
  formatter?: string;
  value_template?: string;
  chart_type?: 'line' | 'bar';
  line_width?: number | string;
  point_size?: number | string;
  fill?: number | string;
  stacked?: 'none' | 'stacked' | 'stacked_within_series' | 'percent';
  separate_axis?: number;
  axis_position?: 'left' | 'right';
  axis_min?: number | string;
  axis_max?: number | string;
  steps?: number;
  hidden?: boolean;
  offset_time?: string;
  override_index_pattern?: number;
  series_index_pattern?: string;
  series_time_field?: string;
  series_interval?: string;
  /** The time range mode of a series that overrides the index pattern */
  time_range_mode?: 'entire_time_range' | 'last_value';
  color_rules?: ColorRule[];
}

export interface ColorRule {
  id?: string;
  value?: number | string;
  operator?: 'gte' | 'gt' | 'lte' | 'lt' | 'empty';
  // What a rule colours, by the kind of panel
  color?: string;
  background_color?: string;
  bar_color?: string;
  gauge?: string;
  text?: string;
}

export interface TsvbAnnotation {
  id: string;
  color?: string;
  icon?: string;
  index_pattern?: string;
  time_field?: string;
  query_string?: Query | string;
  fields?: string;
  template?: string;
  ignore_global_filters?: number;
  ignore_panel_filters?: number;
  hidden?: boolean;
}

export interface TsvbParams {
  id?: string;
  type?: 'timeseries' | 'metric' | 'top_n' | 'gauge' | 'markdown' | 'table';
  series?: TsvbSeries[];
  index_pattern?: string;
  default_index_pattern?: string;
  time_field?: string;
  default_timefield?: string;
  interval?: string;
  filter?: Query | string;
  ignore_global_filter?: number;
  drop_last_bucket?: number;
  time_range_mode?: 'entire_time_range' | 'last_value';
  axis_position?: 'left' | 'right';
  axis_formatter?: string;
  axis_scale?: string;
  axis_min?: number | string;
  axis_max?: number | string;
  show_legend?: number;
  show_grid?: number;
  legend_position?: string;
  background_color?: string;
  background_color_rules?: ColorRule[];
  bar_color_rules?: ColorRule[];
  gauge_color_rules?: ColorRule[];
  gauge_width?: number | string;
  gauge_inner_width?: number | string;
  gauge_inner_color?: string;
  gauge_style?: 'half' | 'circle';
  gauge_max?: number | string;
  markdown?: string;
  markdown_vertical_align?: string;
  markdown_scrollbars?: number;
  markdown_openLinksInNewTab?: number;
  /** The panel's custom style, as written in Less and as the CSS it compiled to */
  markdown_less?: string;
  markdown_css?: string;
  pivot_id?: string;
  pivot_label?: string;
  pivot_rows?: number | string;
  pivot_type?: string;
  drilldown_url?: string;
  annotations?: TsvbAnnotation[];
  /** Set by the editor while one of its intervals is not valid */
  isModelInvalid?: boolean;
}

export interface TsvbSeriesData {
  id: string;
  seriesId: string;
  label: string;
  color: string;
  /** [time in milliseconds, value] */
  data: Array<[number, number | null]>;
  /** The value the panels that show one number show */
  last: number | null;
  series: TsvbSeries;
  format: (value: number | null) => string;
}

export interface TsvbAnnotationData {
  annotation: TsvbAnnotation;
  marks: Array<{ time: number; text: string }>;
}

export interface TsvbData {
  series: TsvbSeriesData[];
  interval: { ms: number; expression: string };
  range: AbsoluteRange;
  annotations: TsvbAnnotationData[];
  requests: RequestRecord[];
}

export interface TsvbTableData {
  rows: Array<{ key: string; series: TsvbSeriesData[] }>;
  requests: RequestRecord[];
}

const toNumber = (value: unknown, fallback: number): number => {
  const parsed = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : fallback;
};

const asQuery = (value: Query | string | undefined): Query | undefined => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return value.trim() === '' ? undefined : { query: value, language: 'lucene' };
  if (typeof value.query === 'string' && value.query.trim() === '') return undefined;
  return value;
};

/**
 * How a series writes its values: a named format, or a pattern of its own, inside its template. A
 * named format takes its pattern from the advanced settings, as the product's field formats do; a
 * series that names none is written with the product's own default.
 */
export function seriesFormatter(formatter: string | undefined, template?: string): (value: number | null) => string {
  const settings = services ? services.formatSettings() : DEFAULT_FORMAT_SETTINGS;
  const pattern =
    formatter === 'bytes'
      ? settings.bytesPattern
      : formatter === 'percent'
        ? settings.percentPattern
        : formatter === 'number'
          ? settings.numberPattern
          : formatter || '0,0.[00]';
  const duration = /^(ms|s|m|h|d|w|M|Y|ps|ns|us),(ms|s|m|h|d|w|M|Y|humanize),(\d*)$/.exec(formatter ?? '');
  return (value) => {
    if (value === null || value === undefined || Number.isNaN(value)) return '-';
    let text: string;
    if (duration) {
      const scale: Record<string, number> = { ps: 1e-9, ns: 1e-6, us: 1e-3, ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000, M: 2592000000, Y: 31536000000 };
      const ms = value * (scale[duration[1]] ?? 1);
      text = duration[2] === 'humanize' ? `${(ms / 1000).toFixed(0)}s` : `${(ms / (scale[duration[2]] ?? 1)).toFixed(Number(duration[3] || 0))}${duration[2]}`;
    } else text = formatNumber(value, pattern);
    return template ? template.replace(/\{\{\s*value\s*\}\}/g, text) : text;
  };
}

const RAINBOW = [
  '#68BC00', '#009CE0', '#B0BC00', '#16A5A5', '#D33115', '#E27300', '#FCC400', '#7B64FF', '#FA28FF', '#333333', '#808080',
  '#194D33', '#0062B1', '#808900', '#0C797D', '#9F0500', '#C45100', '#FB9E00', '#653294', '#AB149E', '#0F1419', '#666666',
];

function rgbOf(color: string): [number, number, number] {
  const hex = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (hex) {
    const text = hex[1].length === 3 ? [...hex[1]].map((digit) => digit + digit).join('') : hex[1];
    return [parseInt(text.slice(0, 2), 16), parseInt(text.slice(2, 4), 16), parseInt(text.slice(4, 6), 16)];
  }
  const rgb = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(color);
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : [84, 179, 153];
}

/**
 * The colours of the terms a series is split by. "rainbow" is a fixed list; "gradient", the
 * default, starts at the colour of the series and darkens in equal steps, each as large as the
 * brightness of the colour allows for the number of terms.
 */
export function splitColors(color: string, size: number, mode: string | undefined): string[] {
  if (mode === 'rainbow') return RAINBOW;
  const [r, g, b] = rgbOf(color).map((channel) => channel / 255);
  const linear = (channel: number) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  const luminosity = 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const spread = max - min;
  let lightness = (max + min) / 2;
  const saturation = spread === 0 ? 0 : spread / (1 - Math.abs(2 * lightness - 1));
  let hue = 0;
  if (spread !== 0) {
    if (max === r) hue = ((g - b) / spread) % 6;
    else if (max === g) hue = (b - r) / spread + 2;
    else hue = (r - g) / spread + 4;
  }
  hue = (hue * 60 + 360) % 360;
  const toHex = (l: number) => {
    const light = Math.max(0, Math.min(1, l));
    const chroma = (1 - Math.abs(2 * light - 1)) * saturation;
    const second = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
    const base = light - chroma / 2;
    const sector = Math.floor(hue / 60);
    const [red, green, blue] =
      sector === 0 ? [chroma, second, 0] : sector === 1 ? [second, chroma, 0] : sector === 2 ? [0, chroma, second] : sector === 3 ? [0, second, chroma] : sector === 4 ? [second, 0, chroma] : [chroma, 0, second];
    return `#${[red, green, blue].map((channel) => Math.round((channel + base) * 255).toString(16).padStart(2, '0')).join('')}`;
  };
  const colors = [toHex(lightness)];
  const step = size > 1 ? luminosity / (size - 1) : 0;
  for (let index = 1; index < size; index += 1) {
    lightness -= step;
    colors.push(toHex(lightness));
  }
  return colors;
}

const METRIC_NAMES: Record<string, string> = {
  avg: 'Average',
  sum: 'Sum',
  min: 'Min',
  max: 'Max',
  cardinality: 'Cardinality',
  value_count: 'Value Count',
  std_deviation: 'Std. Deviation',
  variance: 'Variance',
  sum_of_squares: 'Sum of Sq.',
  percentile: 'Percentile',
  percentile_rank: 'Percentile Rank',
  top_hit: 'Top Hit',
  derivative: 'Derivative',
  moving_average: 'Moving Average',
  cumulative_sum: 'Cumulative Sum',
  serial_diff: 'Serial Difference',
  positive_only: 'Positive Only',
  avg_bucket: 'Overall Average',
  sum_bucket: 'Overall Sum',
  min_bucket: 'Overall Min',
  max_bucket: 'Overall Max',
  std_deviation_bucket: 'Overall Std. Deviation',
  variance_bucket: 'Overall Variance',
  sum_of_squares_bucket: 'Overall Sum of Sq.',
};

/** The name a series goes by when it was given none: its last metric, as TSVB words it */
export function metricLabel(series: TsvbSeries, metric: TsvbMetric | undefined = series.metrics?.[series.metrics.length - 1]): string {
  if (!metric) return 'Unknown';
  if (metric.type === 'count') return 'Count';
  if (metric.type === 'calculation') return 'Bucket Script';
  if (metric.type === 'math') return 'Math';
  if (metric.type === 'series_agg') return `Series Agg (${String((metric as { function?: string }).function ?? 'sum')})`;
  if (metric.type === 'filter_ratio') return 'Filter Ratio';
  if (metric.type === 'static') return `Static Value of ${String((metric as { value?: unknown }).value ?? '')}`;
  const name = METRIC_NAMES[metric.type ?? ''] ?? metric.type ?? 'Unknown';
  const target = (series.metrics ?? []).find((other) => other.id === metric.field);
  return `${name} of ${target ? metricLabel(series, target) : (metric.field ?? '')}`;
}

/** The colour a value gets from a panel's rules: the last rule that holds */
export function ruleFor(rules: ColorRule[] | undefined, value: number | null): ColorRule | undefined {
  if (value === null || !rules) return undefined;
  let found: ColorRule | undefined;
  for (const rule of rules) {
    const bound = toNumber(rule.value, NaN);
    if (Number.isNaN(bound) && rule.operator !== 'empty') continue;
    const holds =
      rule.operator === 'gte' ? value >= bound : rule.operator === 'gt' ? value > bound : rule.operator === 'lte' ? value <= bound : rule.operator === 'lt' ? value < bound : false;
    if (holds) found = rule;
  }
  return found;
}

async function patternFor(title: string): Promise<IndexPattern | undefined> {
  try {
    const all = await services.indexPatterns.list();
    const match = all.find((pattern) => pattern.title === title);
    return match ? await services.indexPatterns.get(match.id) : undefined;
  } catch {
    return undefined;
  }
}

// --- What OpenSearch is asked ---------------------------------------------------------------------

const BASIC: Record<string, string> = { avg: 'avg', sum: 'sum', min: 'min', max: 'max', cardinality: 'cardinality', value_count: 'value_count' };
const EXTENDED: Record<string, string> = { std_deviation: 'std_deviation', variance: 'variance', sum_of_squares: 'sum_of_squares' };

function metricAggs(metrics: TsvbMetric[], indexPattern: IndexPattern | undefined): Dsl {
  const aggs: Dsl = {};
  const config = services.queryConfig();
  for (const metric of metrics) {
    if (BASIC[metric.type] && metric.field) aggs[metric.id] = { [BASIC[metric.type]]: { field: metric.field } };
    else if (EXTENDED[metric.type] && metric.field) aggs[metric.id] = { extended_stats: { field: metric.field } };
    else if (metric.type === 'percentile' && metric.field) {
      const percents = (metric.percentiles ?? []).map((item) => toNumber(item.value, NaN)).filter((value) => !Number.isNaN(value));
      aggs[metric.id] = { percentiles: { field: metric.field, percents: percents.length ? percents : [50] } };
    } else if (metric.type === 'percentile_rank' && metric.field) {
      const values = (metric.values ?? (metric.value !== undefined ? [metric.value] : [])).map((value) => toNumber(value, 0));
      aggs[metric.id] = { percentile_ranks: { field: metric.field, values: values.length ? values : [0] } };
    } else if (metric.type === 'filter_ratio') {
      const inner = metric.metric_agg && metric.metric_agg !== 'count' && metric.field ? { metric: { [metric.metric_agg]: { field: metric.field } } } : undefined;
      aggs[`${metric.id}-numerator`] = {
        filter: buildQuery(indexPattern, asQuery(metric.numerator) ?? { query: '*', language: 'lucene' }, [], config),
        ...(inner ? { aggs: inner } : {}),
      };
      aggs[`${metric.id}-denominator`] = {
        filter: buildQuery(indexPattern, asQuery(metric.denominator) ?? { query: '*', language: 'lucene' }, [], config),
        ...(inner ? { aggs: inner } : {}),
      };
    } else if (metric.type === 'positive_rate' && metric.field) {
      aggs[`${metric.id}-max`] = { max: { field: metric.field } };
    } else if (metric.type === 'top_hit' && metric.field) {
      aggs[metric.id] = {
        top_hits: {
          size: toNumber(metric.size, 1),
          sort: metric.order_by ? [{ [metric.order_by]: { order: metric.order ?? 'desc' } }] : undefined,
          _source: { includes: [metric.field] },
        },
      };
    }
  }
  return aggs;
}

interface TimeBucket {
  key: number;
  doc_count: number;
  [agg: string]: unknown;
}

// One measure's values over the buckets: read from the answer, or worked out from other measures
function metricValues(
  metric: TsvbMetric,
  buckets: TimeBucket[],
  computed: Map<string, Array<number | null>>,
  intervalMs: number,
  all: Record<string, MathValue>
): Array<number | null> {
  const from = (id: string | undefined): Array<number | null> => (id ? (computed.get(id.split('[')[0]) ?? []) : []);
  const numeric = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
  switch (metric.type) {
    case 'count':
      return buckets.map((bucket) => bucket.doc_count);
    case 'avg':
    case 'sum':
    case 'min':
    case 'max':
    case 'cardinality':
    case 'value_count':
      return buckets.map((bucket) => numeric((bucket[metric.id] as { value?: number } | undefined)?.value));
    case 'std_deviation':
    case 'variance':
    case 'sum_of_squares':
      return buckets.map((bucket) => numeric((bucket[metric.id] as Record<string, number> | undefined)?.[metric.type]));
    case 'percentile':
    case 'percentile_rank':
      return buckets.map((bucket) => {
        const values = (bucket[metric.id] as { values?: Record<string, number> } | undefined)?.values ?? {};
        return numeric(Object.values(values)[0]);
      });
    case 'filter_ratio':
      return buckets.map((bucket) => {
        const read = (part: string) => {
          const found = bucket[`${metric.id}-${part}`] as { doc_count?: number; metric?: { value?: number } } | undefined;
          return found?.metric ? numeric(found.metric.value) : numeric(found?.doc_count);
        };
        const numerator = read('numerator');
        const denominator = read('denominator');
        return numerator !== null && denominator !== null && denominator > 0 ? numerator / denominator : 0;
      });
    case 'top_hit':
      return buckets.map((bucket) => {
        const hits = (bucket[metric.id] as { hits?: { hits?: Array<{ _source?: Record<string, unknown> }> } } | undefined)?.hits?.hits ?? [];
        const values = hits
          .map((hit) => (metric.field ?? '').split('.').reduce<unknown>((at, part) => (at as Record<string, unknown> | undefined)?.[part], hit._source))
          .filter((value): value is number => typeof value === 'number');
        if (values.length === 0) return null;
        if (metric.agg_with === 'min') return Math.min(...values);
        if (metric.agg_with === 'max') return Math.max(...values);
        if (metric.agg_with === 'sum') return values.reduce((sum, value) => sum + value, 0);
        return values.reduce((sum, value) => sum + value, 0) / values.length;
      });
    case 'static':
      return buckets.map(() => toNumber(metric.value, 0));
    case 'derivative':
    case 'positive_rate': {
      const source = metric.type === 'positive_rate' ? buckets.map((bucket) => numeric((bucket[`${metric.id}-max`] as { value?: number } | undefined)?.value)) : from(metric.field);
      const unit = metric.unit ? parseInterval(metric.unit)?.ms : metric.type === 'positive_rate' ? UNIT_MS.s : undefined;
      return source.map((value, index) => {
        const before = index > 0 ? source[index - 1] : null;
        if (value === null || before === null) return null;
        let change = value - before;
        if (unit) change = (change * unit) / intervalMs;
        return metric.type === 'positive_rate' ? Math.max(0, change) : change;
      });
    }
    case 'serial_diff': {
      const source = from(metric.field);
      const lag = Math.max(1, toNumber(metric.lag, 1));
      return source.map((value, index) => {
        const before = index >= lag ? source[index - lag] : null;
        return value === null || before === null ? null : value - before;
      });
    }
    case 'cumulative_sum': {
      let total = 0;
      return from(metric.field).map((value) => {
        total += value ?? 0;
        return total;
      });
    }
    case 'moving_average': {
      const source = from(metric.field);
      const window = Math.max(1, toNumber(metric.window, 5));
      return source.map((_, index) => {
        const values = source.slice(Math.max(0, index - window), index).filter((value): value is number => value !== null);
        return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
      });
    }
    case 'positive_only':
      return from(metric.field).map((value) => (value === null ? null : Math.max(0, value)));
    case 'avg_bucket':
    case 'max_bucket':
    case 'min_bucket':
    case 'sum_bucket':
    case 'std_deviation_bucket':
    case 'variance_bucket':
    case 'sum_of_squares_bucket': {
      // One value for the whole series, which every bucket then carries
      const values = from(metric.field).filter((value): value is number => value !== null);
      let result: number | null = null;
      if (values.length) {
        const total = values.reduce((sum, value) => sum + value, 0);
        const mean = total / values.length;
        const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
        if (metric.type === 'avg_bucket') result = mean;
        else if (metric.type === 'max_bucket') result = Math.max(...values);
        else if (metric.type === 'min_bucket') result = Math.min(...values);
        else if (metric.type === 'sum_bucket') result = total;
        else if (metric.type === 'variance_bucket') result = variance;
        else if (metric.type === 'std_deviation_bucket') result = Math.sqrt(variance);
        else result = values.reduce((sum, value) => sum + value ** 2, 0);
      }
      return buckets.map(() => result);
    }
    case 'calculation':
    case 'math': {
      const variables = metric.variables ?? [];
      // A script of the Bucket Script aggregation is arithmetic over params.*, which is what is worked out here
      const script = (metric.script ?? '').replace(/;\s*$/, '');
      return buckets.map((bucket, index) => {
        const params: Record<string, MathValue> = { _index: index, _timestamp: bucket.key, _interval: intervalMs, _all: all };
        for (const variable of variables) {
          if (variable.name) params[variable.name] = from(variable.field)[index];
        }
        try {
          const value = evaluateMath(script, { params });
          return Number.isFinite(value) ? value : null;
        } catch {
          return null;
        }
      });
    }
    default:
      return buckets.map(() => null);
  }
}

function seriesValues(series: TsvbSeries, buckets: TimeBucket[], intervalMs: number): Array<[number, number | null]> {
  const metrics = series.metrics ?? [];
  const computed = new Map<string, Array<number | null>>();
  const all: Record<string, MathValue> = {};
  for (const metric of metrics) {
    const values = metricValues(metric, buckets, computed, intervalMs, all);
    computed.set(metric.id, values);
    all[metric.id] = { values: values.map((value) => value ?? NaN), timestamps: buckets.map((bucket) => bucket.key) };
  }
  const last = metrics[metrics.length - 1];
  const values = last ? (computed.get(last.id) ?? []) : [];
  return buckets.map((bucket, index) => [bucket.key, values[index] ?? null]);
}

interface Plan {
  index: string;
  timeField: string;
  indexPattern?: IndexPattern;
  range: AbsoluteRange;
  intervalMs: number;
  intervalExpression: string;
  entireRange: boolean;
  dropLast: boolean;
}

function baseQuery(params: TsvbParams, series: TsvbSeries | undefined, plan: Plan, input: VisInput, shift = 0): BoolQuery {
  const config = services.queryConfig();
  const queries: Query[] = [];
  const filters = params.ignore_global_filter ? [] : input.filters;
  if (!params.ignore_global_filter && input.query) queries.push(input.query);
  const panel = asQuery(params.filter);
  if (panel) queries.push(panel);
  const own = series && series.split_mode !== 'filter' ? undefined : asQuery(series?.filter);
  if (own) queries.push(own);
  const everything = series?.split_mode === 'everything' ? asQuery(series.filter) : undefined;
  if (everything) queries.push(everything);
  const query = buildQuery(plan.indexPattern, queries, filters, { ...config, ignoreFilterIfFieldNotInIndex: true });
  query.bool.must.push({
    range: {
      [plan.timeField]: {
        gte: new Date(plan.range.from.getTime() - shift).toISOString(),
        lte: new Date(plan.range.to.getTime() - shift).toISOString(),
        format: 'strict_date_optional_time',
      },
    },
  });
  return query;
}

function histogram(plan: Plan, shift: number, inner: Dsl): Dsl {
  // The entire time range is one bucket, which OpenSearch makes as large as it needs to be
  if (plan.entireRange) return { auto_date_histogram: { field: plan.timeField, buckets: 1 }, aggs: inner };
  const from = plan.range.from.getTime() - shift;
  const to = plan.range.to.getTime() - shift;
  return {
    date_histogram: {
      field: plan.timeField,
      fixed_interval: `${Math.max(1, Math.round(plan.intervalMs))}ms`,
      min_doc_count: 0,
      time_zone: services.timeZone() ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      extended_bounds: { min: from, max: to },
    },
    aggs: inner,
  };
}

async function planFor(params: TsvbParams, series: TsvbSeries | undefined, input: VisInput): Promise<Plan> {
  const override = Boolean(series?.override_index_pattern);
  const index = (override && series?.series_index_pattern) || params.index_pattern || params.default_index_pattern || '';
  const timeField = (override && series?.series_time_field) || params.time_field || params.default_timefield || '';
  if (!index) throw new Error('This visualization names no index pattern');
  const indexPattern = await patternFor(index);
  const usedTimeField = timeField || indexPattern?.timeFieldName;
  if (!usedTimeField) throw new Error('This visualization names no time field');
  const range = resolveTimeRange(input.time, { weekStart: services.weekStart() });
  if (!range) throw new Error('The time range could not be read');
  const duration = range.to.getTime() - range.from.getTime();
  const kind = params.type ?? 'timeseries';
  // A time series always draws buckets; a series with its own index pattern has its own mode
  const mode = override ? series?.time_range_mode : params.time_range_mode;
  const entireRange = kind !== 'timeseries' && mode === 'entire_time_range';
  const requested = ((override && series?.series_interval) || params.interval || 'auto').trim();
  const atLeast = /^>=\s*(.+)$/.exec(requested);
  const auto = resolveInterval('auto', duration, { targetBuckets: 100, maxBuckets: 200 });
  let intervalMs = auto.ms;
  let expression = auto.expression;
  const fixed = parseInterval(atLeast ? atLeast[1] : requested);
  if (fixed && (!atLeast || fixed.ms > auto.ms)) {
    intervalMs = fixed.ms;
    expression = fixed.expression;
  }
  if (entireRange) {
    intervalMs = Math.max(1, duration);
    expression = `${intervalMs}ms`;
  }
  return {
    index,
    timeField: usedTimeField,
    indexPattern,
    range,
    intervalMs,
    intervalExpression: expression,
    entireRange,
    // The last bucket is still filling, so a line would dip at its end
    dropLast: !entireRange && (params.drop_last_bucket ?? 1) === 1,
  };
}

function finish(points: Array<[number, number | null]>, plan: Plan, shift: number): Array<[number, number | null]> {
  let data = points.map(([time, value]) => [time + shift, value] as [number, number | null]);
  if (plan.dropLast && data.length > 1) data = data.slice(0, -1);
  return data;
}

function lastOf(data: Array<[number, number | null]>): number | null {
  for (let index = data.length - 1; index >= 0; index -= 1) {
    if (data[index][1] !== null) return data[index][1];
  }
  return null;
}

const offsetOf = (series: TsvbSeries): number => {
  const match = /^([+-]?\d+)(ms|[smhdwMy])$/.exec((series.offset_time ?? '').trim());
  return match ? Number(match[1]) * UNIT_MS[match[2] as keyof typeof UNIT_MS] : 0;
};

async function fetchSeries(
  params: TsvbParams,
  series: TsvbSeries,
  input: VisInput,
  requests: RequestRecord[],
  signal: AbortSignal | undefined,
  pivot?: TablePivot
): Promise<{ plan: Plan; groups: Array<{ key: string; made: TsvbSeriesData[] }> }> {
  const plan = await planFor(params, series, input);
  const shift = offsetOf(series);
  const config = services.queryConfig();
  const metrics = series.metrics ?? [];
  const timeseries = histogram(plan, shift, metricAggs(metrics, plan.indexPattern));
  const mode = series.split_mode ?? 'everything';
  let split: Dsl;
  if (mode === 'terms' && series.terms_field) {
    const orderBy = series.terms_order_by && series.terms_order_by !== '_count' && series.terms_order_by !== '_key' ? '_count' : (series.terms_order_by ?? '_count');
    const terms: Dsl = {
      field: series.terms_field,
      size: toNumber(series.terms_size, 10),
      order: { [orderBy]: series.terms_direction ?? 'desc' },
    };
    if (series.terms_include) terms.include = series.terms_include;
    if (series.terms_exclude) terms.exclude = series.terms_exclude;
    split = { terms, aggs: { timeseries } };
  } else if (mode === 'filters' && series.split_filters?.length) {
    const filters: Record<string, BoolQuery> = {};
    for (const item of series.split_filters) {
      filters[item.id] = buildQuery(plan.indexPattern, asQuery(item.filter) ?? { query: '*', language: 'lucene' }, [], config);
    }
    split = { filters: { filters }, aggs: { timeseries } };
  } else split = { filter: { match_all: {} }, aggs: { timeseries } };

  const aggs: Dsl = pivot
    ? {
        pivot: {
          terms: { field: pivot.field, size: pivot.size, ...(pivot.order ? { order: pivot.order } : {}) },
          aggs: { ...pivot.sortAggs, [series.id]: split },
        },
      }
    : { [series.id]: split };
  const body = { size: 0, query: baseQuery(params, series, plan, input, shift), aggs };
  const record: RequestRecord = { name: series.label || 'Series', index: plan.index, body, startedAt: Date.now() };
  requests.push(record);
  const response = await services.search.search(plan.index, body, { signal, record });

  const format = seriesFormatter(series.formatter, series.value_template);
  const base = series.color || '#54B399';
  const build = (container: Record<string, unknown>): TsvbSeriesData[] => {
    const found = container[series.id] as { buckets?: unknown; timeseries?: { buckets: TimeBucket[] } } | undefined;
    if (!found) return [];
    const make = (id: string, label: string, color: string, node: { timeseries?: { buckets: TimeBucket[] } }): TsvbSeriesData => {
      const data = finish(seriesValues(series, node.timeseries?.buckets ?? [], plan.intervalMs), plan, shift);
      return { id, seriesId: series.id, label, color, data, last: lastOf(data), series, format };
    };
    if (mode === 'terms' && Array.isArray(found.buckets)) {
      const list = found.buckets as Array<{ key: string | number; key_as_string?: string; timeseries?: { buckets: TimeBucket[] } }>;
      const tones = splitColors(base, list.length, series.split_color_mode);
      return list.map((bucket, index) => {
        const term = bucket.key_as_string ?? String(bucket.key);
        // A term goes by its own name, and by a colour of its own among its neighbours
        return make(`${series.id}:${term}`, term, tones[index % tones.length], bucket);
      });
    }
    if (mode === 'filters' && found.buckets && !Array.isArray(found.buckets)) {
      const byId = found.buckets as Record<string, { timeseries?: { buckets: TimeBucket[] } }>;
      return (series.split_filters ?? []).flatMap((item) => {
        const bucket = byId[item.id];
        const text = typeof item.filter === 'string' ? item.filter : typeof item.filter?.query === 'string' ? item.filter.query : '';
        return bucket ? [make(`${series.id}:${item.id}`, item.label || text || item.id, item.color || base, bucket)] : [];
      });
    }
    return [make(series.id, series.label || metricLabel(series), base, found)];
  };

  const aggregations = (response.aggregations ?? {}) as Record<string, unknown>;
  if (pivot) {
    const rows = ((aggregations.pivot as { buckets?: Array<Record<string, unknown> & { key: string | number; key_as_string?: string }> })?.buckets ?? []).map(
      (bucket) => ({ key: bucket.key_as_string ?? String(bucket.key), made: build(bucket) })
    );
    return { plan, groups: rows };
  }
  return { plan, groups: [{ key: '', made: build(aggregations) }] };
}

async function fetchAnnotations(params: TsvbParams, input: VisInput, range: AbsoluteRange, signal?: AbortSignal): Promise<TsvbAnnotationData[]> {
  const results: TsvbAnnotationData[] = [];
  for (const annotation of params.annotations ?? []) {
    if (annotation.hidden || !annotation.index_pattern || !annotation.time_field) continue;
    try {
      const indexPattern = await patternFor(annotation.index_pattern);
      const queries: Query[] = [];
      const own = asQuery(annotation.query_string);
      if (own) queries.push(own);
      if (!annotation.ignore_global_filters && input.query) queries.push(input.query);
      const panel = asQuery(params.filter);
      if (!annotation.ignore_panel_filters && panel) queries.push(panel);
      const query = buildQuery(indexPattern, queries, annotation.ignore_global_filters ? [] : input.filters, {
        ...services.queryConfig(),
        ignoreFilterIfFieldNotInIndex: true,
      });
      query.bool.must.push({
        range: { [annotation.time_field]: { gte: range.from.toISOString(), lte: range.to.toISOString(), format: 'strict_date_optional_time' } },
      });
      const fields = (annotation.fields ?? '').split(/[,\s]+/).filter(Boolean);
      const response = await services.search.search(
        annotation.index_pattern,
        { size: 100, query, sort: [{ [annotation.time_field]: { order: 'desc' } }], _source: [annotation.time_field, ...fields] },
        { signal }
      );
      const marks = response.hits.hits.flatMap((hit) => {
        const source = (hit._source ?? {}) as Record<string, unknown>;
        const read = (path: string) => path.split('.').reduce<unknown>((at, part) => (at as Record<string, unknown> | undefined)?.[part], source) ?? source[path];
        const time = new Date(String(read(annotation.time_field as string))).getTime();
        if (Number.isNaN(time)) return [];
        const text = (annotation.template ?? '').replace(/\{\{\s*([\w.@-]+)\s*\}\}/g, (_, name: string) => String(read(name) ?? ''));
        return [{ time, text }];
      });
      results.push({ annotation, marks });
    } catch (failure) {
      if ((failure as Error).name === 'AbortError') throw failure;
    }
  }
  return results;
}

export async function fetchTsvb(params: TsvbParams, input: VisInput, signal?: AbortSignal): Promise<TsvbData> {
  const requests: RequestRecord[] = [];
  const shown = (params.series ?? []).filter((series) => !series.hidden);
  const fetched = await Promise.all(shown.map((series) => fetchSeries(params, series, input, requests, signal)));
  const plan = fetched[0]?.plan ?? (await planFor(params, undefined, input));
  const annotations = params.type === 'timeseries' || !params.type ? await fetchAnnotations(params, input, plan.range, signal) : [];
  return {
    series: fetched.flatMap((result) => result.groups.flatMap((group) => group.made)),
    interval: { ms: plan.intervalMs, expression: plan.intervalExpression },
    range: plan.range,
    annotations,
    requests,
  };
}

/** How the rows of a table are sorted, as its UI state keeps it: by the field it groups by ('_default_') or by a series */
export interface TsvbTableSort {
  column?: string;
  order?: 'asc' | 'desc';
}

interface TablePivot {
  field: string;
  size: number;
  order?: Record<string, 'asc' | 'desc'>;
  sortAggs?: Dsl;
}

// The aggregations a table can be sorted by, worked out over each row as the product does
const SORT_AGGS: Record<string, { agg: string; value?: string }> = {
  avg: { agg: 'avg' },
  max: { agg: 'max' },
  min: { agg: 'min' },
  sum: { agg: 'sum' },
  value_count: { agg: 'value_count' },
  cardinality: { agg: 'cardinality' },
  std_deviation: { agg: 'extended_stats', value: 'std_deviation' },
  variance: { agg: 'extended_stats', value: 'variance' },
  sum_of_squares: { agg: 'extended_stats', value: 'sum_of_squares' },
};

/**
 * The order the product asks OpenSearch for the rows of a table in: by count or by the metric of
 * the series sorted by, or by the value of the field the rows are grouped by. Without a sort in
 * its UI state, the rows come in OpenSearch's own order, the most documents first.
 */
export function tableSort(params: TsvbParams, sort: TsvbTableSort | undefined): Pick<TablePivot, 'order' | 'sortAggs'> {
  if (!sort) return {};
  const order = sort.order ?? 'asc';
  const series = (params.series ?? []).find((item) => item.id === sort.column);
  const metric = series?.metrics?.[series.metrics.length - 1];
  if (metric?.type === 'count') return { order: { _count: order } };
  const sortable = metric ? SORT_AGGS[metric.type] : undefined;
  if (metric && sortable) {
    const key = `${metric.id}-SORT`;
    return {
      order: { [sortable.value ? `${key}[${sortable.value}]` : key]: order },
      sortAggs: { [key]: { [sortable.agg]: { field: metric.field } } },
    };
  }
  return { order: { _key: order } };
}

/** The data of the Table panel: a row for each value of the field it groups by, a column per series */
export async function fetchTsvbTable(params: TsvbParams, input: VisInput, signal?: AbortSignal, sort?: TsvbTableSort): Promise<TsvbTableData> {
  // A table that groups by no field has no rows, and says it has no data, as the product's does
  // while its group-by field is still to be chosen
  if (!params.pivot_id) return { rows: [], requests: [] };
  const requests: RequestRecord[] = [];
  // Every series asks for the rows in the same order, so that they make the same rows
  const pivot: TablePivot = { field: params.pivot_id, size: toNumber(params.pivot_rows, 10), ...tableSort(params, sort) };
  const shown = (params.series ?? []).filter((series) => !series.hidden);
  const fetched = await Promise.all(shown.map((series) => fetchSeries(params, { ...series, split_mode: 'everything' }, input, requests, signal, pivot)));
  const order: string[] = [];
  const rows = new Map<string, TsvbSeriesData[]>();
  for (const result of fetched) {
    for (const group of result.groups) {
      if (!rows.has(group.key)) {
        rows.set(group.key, []);
        order.push(group.key);
      }
      rows.get(group.key)?.push(...group.made);
    }
  }
  return { rows: order.map((key) => ({ key, series: rows.get(key) ?? [] })), requests };
}

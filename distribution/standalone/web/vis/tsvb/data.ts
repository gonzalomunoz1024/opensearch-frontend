/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The data of a TSVB visualization. OpenSearch Dashboards works this out on its server; here the
 * browser asks OpenSearch for each series' buckets over time and does the rest: the measures
 * computed from other measures (derivative, moving average, cumulative sum, ratios, math), the
 * split into several series, the last value or the value over the whole time range.
 */

import { resolveInterval, resolveTimeRange, scaledDateFormat, UNIT_MS, parseInterval, type AbsoluteRange } from '../../lib/dates';
import { DEFAULT_FORMAT_SETTINGS, type FormatSettings } from '../../lib/field_formats';
import { evaluateMath, type MathValue } from '../../lib/math_expression';
import { formatNumber } from '../../lib/numeral';
import { buildQuery, type BoolQuery } from '../../lib/query';
import { compileTemplate } from '../../lib/template';
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
  /** A percentile's: its value, drawn as a line or as a band down to another, filled so solid */
  percentiles?: Array<{ id?: string; value?: number | string; mode?: string; percentile?: number | string; shade?: number | string }>;
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
  // A standard deviation's: how many of them, and which of its values is drawn
  sigma?: number | string;
  mode?: string;
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
  axis_position?: 'left' | 'right' | 'hidden';
  axis_scale?: string;
  axis_min?: number | string;
  axis_max?: number | string;
  steps?: number;
  hidden?: boolean;
  hide_in_legend?: number;
  offset_time?: string;
  override_index_pattern?: number;
  series_index_pattern?: string;
  series_time_field?: string;
  series_interval?: string;
  /** The time range mode of a series that overrides the index pattern */
  time_range_mode?: 'entire_time_range' | 'last_value';
  /** Whether a series that overrides the index pattern drops its last bucket, when the panel does not say */
  override_drop_last_bucket?: number;
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

/** [time in milliseconds, value], and for a band the value of its lower edge */
export type TsvbPoint = [number, number | null, (number | null)?];

/** How a series that is a band is drawn: filled this solid, its edges named so after its label */
export interface TsvbBand {
  fill: number;
  upper: string;
  lower: string;
}

export interface TsvbSeriesData {
  id: string;
  seriesId: string;
  label: string;
  /** The colour the series was given, none for a part of a split the chart colours by its label */
  color: string;
  /** A term's name as OpenSearch writes it, when it writes one (a date or a yes or no) */
  labelFormatted?: string;
  data: TsvbPoint[];
  /** A band from each point's lower value up to its value, instead of a line */
  band?: TsvbBand;
  /** The value the panels that show one number show: the last bucket's, or 0 when it has none */
  last: number | null;
  series: TsvbSeries;
  format: (value: number | null) => string;
}

export interface TsvbAnnotationData {
  annotation: TsvbAnnotation;
  /** A mark for each bucket of the automatic interval with documents: its start, and its latest documents, the latest first */
  marks: Array<{ time: number; docs: unknown[] }>;
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
/**
 * A series' value template filled in as the product's tick formatter fills it: `{{value}}` is the
 * formatted value, HTML-escaped as Handlebars escapes it, and a template that cannot be filled in
 * gives the value alone
 */
export function valueTemplate(template: string | undefined): (value: unknown) => string {
  const fill = compileTemplate(template || '{{value}}');
  return (value) => {
    try {
      return fill({ value });
    } catch {
      return String(value);
    }
  };
}

/**
 * The format of the time axis, of its tooltips and of the annotations' times, as the original's
 * createXaxisFormatter chooses it: the last rule of dateFormat:scaled that the interval reaches,
 * and dateFormat when none does
 */
export function timeAxisPattern(
  intervalMs: number,
  settings: Pick<FormatSettings, 'scaledDateRules' | 'dateFormat'> = services ? services.formatSettings() : DEFAULT_FORMAT_SETTINGS
): string {
  return scaledDateFormat(intervalMs, settings.scaledDateRules, settings.dateFormat);
}

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
  const fill = valueTemplate(template);
  return (value) => {
    if (value === null || value === undefined || Number.isNaN(value)) return '-';
    let text: string;
    if (duration) {
      const scale: Record<string, number> = { ps: 1e-9, ns: 1e-6, us: 1e-3, ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000, M: 2592000000, Y: 31536000000 };
      const ms = value * (scale[duration[1]] ?? 1);
      text = duration[2] === 'humanize' ? `${(ms / 1000).toFixed(0)}s` : `${(ms / (scale[duration[2]] ?? 1)).toFixed(Number(duration[3] || 0))}${duration[2]}`;
    } else text = formatNumber(value, pattern);
    return fill(text);
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
 * The colours of the terms a series is split by. "rainbow" is a fixed list; "gradient" starts at
 * the colour of the series and darkens in equal steps, each as large as the brightness of the
 * colour allows for the number of terms; the default gives none, and a chart colours the terms by
 * their names instead.
 */
export function splitColors(color: string, size: number, mode: string | undefined): string[] {
  if (mode === 'rainbow') return RAINBOW;
  if (mode !== 'gradient') return [];
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

// The metrics named after the metric they are worked out from, as the product's calculateLabel names them
const OF_METRIC = ['cumulative_sum', 'derivative', 'moving_average', 'avg_bucket', 'sum_bucket', 'min_bucket', 'max_bucket', 'std_deviation_bucket', 'variance_bucket', 'sum_of_squares_bucket', 'serial_diff', 'positive_only'];

/** The name a series goes by when it was given none: its last metric, as TSVB words it */
export function metricLabel(series: TsvbSeries, metric: TsvbMetric | undefined = series.metrics?.[series.metrics.length - 1]): string {
  if (!metric) return 'Unknown';
  if (metric.type === 'count') return 'Count';
  if (metric.type === 'calculation') return 'Bucket Script';
  if (metric.type === 'math') return 'Math';
  if (metric.type === 'series_agg') return `Series Agg (${String((metric as { function?: string }).function ?? 'sum')})`;
  if (metric.type === 'filter_ratio') return 'Filter Ratio';
  if (metric.type === 'positive_rate') return `Positive Rate of ${metric.field ?? ''}`;
  if (metric.type === 'static') return `Static Value of ${String((metric as { value?: unknown }).value ?? '')}`;
  const name = METRIC_NAMES[metric.type ?? ''] ?? metric.type ?? 'Unknown';
  if (!OF_METRIC.includes(metric.type)) return `${name} of ${metric.field ?? ''}`;
  // The metric it is worked out from, which a percentile's "<id>[50.0]" names by its id first
  const field = metric.field ?? '';
  const target = (series.metrics ?? []).find((other) => field.startsWith(other.id));
  const percentile = target?.type === 'percentile' ? /\[([0-9.]+)\]$/.exec(field) : null;
  return `${name} of ${target ? metricLabel(series, target) : 'Unknown'}${percentile ? ` (${percentile[1]})` : ''}`;
}

/**
 * The parts a metric or a gauge whose series is split shows, one for each, as the product's do:
 * each with the series of that part under the series' own name, the part's name to write under its
 * value, and the series that is not split beside them.
 */
export function splitParts(params: TsvbParams, data: TsvbData): Array<{ key: string; label: string; data: TsvbData }> | undefined {
  if (data.series.every((item) => item.id.split(':').length === 1)) return undefined;
  const models = params.series ?? [];
  // An object, as the product keeps them in: parts named by numbers come first, in their order
  const parts: Record<string, { label: string; series: TsvbSeriesData[] }> = {};
  for (const item of data.series) {
    const [seriesId, splitId] = item.id.split(':');
    const model = models.find((series) => series.id === seriesId);
    if (!model || !splitId) continue;
    parts[splitId] ??= { label: item.label, series: [] };
    parts[splitId].series.push({ ...item, id: seriesId, color: item.color || model.color || '', label: model.label || metricLabel(model) });
  }
  const whole = data.series.find((item) => {
    const model = models.find((series) => series.id === item.id);
    return model?.split_mode === 'everything' || model?.split_mode === 'filter';
  });
  const wholeAt = whole ? models.findIndex((series) => series.id === whole.id) : -1;
  return Object.keys(parts).map((key) => {
    const { label, series } = parts[key];
    const all = !whole ? series : wholeAt > 0 ? [...series, whole] : [whole, ...series];
    return { key, label, data: { ...data, series: all } };
  });
}

/**
 * The rows of a Top N in the product's order: series by series, the parts of each by their last
 * value, largest first unless the series sorts its terms the other way, and as they came when it
 * sorts them by their key; the parts of a series that sorts largest first and are level come in
 * the reverse of the order they came in, as the product's reversed sort leaves them
 */
export function topNRows(params: TsvbParams, series: TsvbSeriesData[]): TsvbSeriesData[] {
  return (params.series ?? []).flatMap((model) => {
    const rows = series.filter((item) => item.id.split(':')[0] === model.id);
    if (model.terms_order_by === '_key') return rows;
    const sorted = [...rows].sort((a, b) => (a.last ?? 0) - (b.last ?? 0));
    return (model.terms_direction || 'desc') === 'desc' ? sorted.reverse() : sorted;
  });
}

/**
 * The name of a term: the term as OpenSearch keys it, or the series' label with the term in place
 * of the first {{key}} it holds
 */
export function termLabel(series: TsvbSeries, key: string): string {
  const label = series.label ?? '';
  return /{{\s*key\s*}}/.test(label) ? label.replace(/{{\s*key\s*}}/, () => key) : key;
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

/** The colour rule of a metric's panel: the last one its first series' last value meets, 0 without one */
export const metricRule = (params: TsvbParams, data: Pick<TsvbData, 'series'>): ColorRule | undefined =>
  ruleFor(params.background_color_rules, data.series[0]?.last ?? 0);

/**
 * The background of a metric's panel: its colour rule's, and no other. The product's metric does
 * not take the panel's background colour, which its options do not offer and which a panel
 * switched from another type keeps.
 */
export const metricBackground = (params: TsvbParams, data: Pick<TsvbData, 'series'>): string | undefined =>
  metricRule(params, data)?.background_color || undefined;

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

/** The statistics of a standard deviation, a variance or a sum of squares, with the sigma it names */
function extendedStats(metric: TsvbMetric): Dsl {
  const stats: Dsl = { field: metric.field };
  const sigma = parseInt(String(metric.sigma ?? ''), 10);
  if (metric.sigma && !Number.isNaN(sigma)) stats.sigma = sigma;
  return { extended_stats: stats };
}

/** Which value of its statistics a standard deviation draws: one of its bounds, or itself */
const boundOf = (metric: TsvbMetric): string | undefined =>
  metric.type === 'std_deviation' && (metric.mode === 'upper' || metric.mode === 'lower') ? `std_${metric.mode}` : undefined;

/**
 * What orders buckets by a measure, as the product asks for it: the measure worked out again in
 * each bucket under `<id>-SORT`, and the path to its value. Count, and the measures worked out
 * from others, order nothing this way.
 */
function sortBy(metric: TsvbMetric): { key: string; path: string; agg: Dsl } | undefined {
  const key = `${metric.id}-SORT`;
  if (BASIC[metric.type]) return { key, path: key, agg: { [BASIC[metric.type]]: { field: metric.field } } };
  if (EXTENDED[metric.type]) return { key, path: `${key}[${boundOf(metric) ?? metric.type}]`, agg: extendedStats(metric) };
  return undefined;
}

/** The aggregations a series' metrics ask of each of its buckets, as the product asks them */
export function metricAggs(metrics: TsvbMetric[], indexPattern: IndexPattern | undefined): Dsl {
  const aggs: Dsl = {};
  for (const metric of metrics) {
    if (BASIC[metric.type] && metric.field) aggs[metric.id] = { [BASIC[metric.type]]: { field: metric.field } };
    else if (EXTENDED[metric.type] && metric.field) aggs[metric.id] = extendedStats(metric);
    else if (metric.type === 'percentile' && metric.field && Array.isArray(metric.percentiles)) {
      // Each percentile, one with no value as 0, and when one is a band the percentiles the bands
      // fill down to, as the product asks for them
      const entries = metric.percentiles;
      let percents: unknown[] = entries.map((item) => (item.value ? Number(item.value) : 0));
      if (entries.some((item) => item.mode === 'band')) percents = percents.concat(entries.filter((item) => item.percentile).map((item) => item.percentile));
      aggs[metric.id] = { percentiles: { field: metric.field, percents } };
    } else if (metric.type === 'percentile_rank' && metric.field && Array.isArray(metric.values)) {
      aggs[metric.id] = { percentile_ranks: { field: metric.field, values: metric.values.map((value) => (value === '' || value === null || value === undefined ? 0 : value)) } };
    } else if (metric.type === 'filter_ratio') {
      const inner = metric.metric_agg && metric.metric_agg !== 'count' && metric.field ? { metric: { [metric.metric_agg]: { field: metric.field } } } : undefined;
      aggs[`${metric.id}-numerator`] = {
        filter: buildQuery(indexPattern, asQuery(metric.numerator) ?? { query: '*', language: 'lucene' }, [], services.queryConfig()),
        ...(inner ? { aggs: inner } : {}),
      };
      aggs[`${metric.id}-denominator`] = {
        filter: buildQuery(indexPattern, asQuery(metric.denominator) ?? { query: '*', language: 'lucene' }, [], services.queryConfig()),
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

export interface TimeBucket {
  key: number;
  doc_count: number;
  [agg: string]: unknown;
}

/** The key OpenSearch gives a percentile or a percentile rank, as the product writes it: "50.0" for 50 */
const toPercentileNumber = (value: unknown): string => (/\d+\.\d+/.test(String(value)) ? String(value) : `${String(value)}.0`);

/**
 * A percentile's or a percentile rank's value in a bucket: the one under the key, or, as OpenSearch
 * finds the one another aggregation names, the one whose key is the same number
 */
function percentileAt(bucket: TimeBucket, id: string, key: string, byNumber = false): number | null {
  const values = (bucket[id] as { values?: Record<string, unknown> } | undefined)?.values ?? {};
  let found = values[key];
  if (found === undefined && byNumber) {
    const name = Object.keys(values).find((candidate) => Number(candidate) === Number(key));
    found = name === undefined ? undefined : values[name];
  }
  return typeof found === 'number' && Number.isFinite(found) ? found : null;
}

/** How many standard deviations a bound is from the mean: the metric's sigma, or OpenSearch's 2 */
function sigmaOf(metric: TsvbMetric): number {
  const sigma = parseInt(String(metric.sigma ?? ''), 10);
  return metric.sigma && !Number.isNaN(sigma) ? sigma : 2;
}

/** The statistics of a series' values that the overall aggregations give, as OpenSearch's extended stats bucket does */
function overall(metric: TsvbMetric, source: Array<number | null>) {
  const values = source.filter((value): value is number => value !== null);
  if (values.length === 0) return undefined;
  const total = values.reduce((sum, value) => sum + value, 0);
  const mean = total / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  const deviation = Math.sqrt(variance);
  const sigma = sigmaOf(metric);
  return {
    values,
    total,
    mean,
    variance,
    deviation,
    upper: mean + sigma * deviation,
    lower: mean - sigma * deviation,
  };
}

/**
 * The values of the metric another one is worked out from: one of the percentiles of a percentile
 * or a percentile rank when it names it in brackets, as in "<id>[50.0]", or else the metric's own
 */
function namedValues(id: string | undefined, buckets: TimeBucket[], computed: Map<string, Array<number | null>>): Array<number | null> {
  if (!id) return [];
  const keyed = /^(.*)\[([^\]]*)\]$/.exec(id);
  if (keyed && buckets.some((bucket) => typeof (bucket[keyed[1]] as { values?: unknown } | undefined)?.values === 'object')) {
    return buckets.map((bucket) => percentileAt(bucket, keyed[1], keyed[2], true));
  }
  return computed.get(id.split('[')[0]) ?? [];
}

// One measure's values over the buckets: read from the answer, or worked out from other measures
function metricValues(
  metric: TsvbMetric,
  buckets: TimeBucket[],
  computed: Map<string, Array<number | null>>,
  intervalMs: number,
  all: Record<string, MathValue>
): Array<number | null> {
  const from = (id: string | undefined) => namedValues(id, buckets, computed);
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
    case 'sum_of_squares': {
      // A standard deviation set to its upper or lower bound draws that bound
      const bound = boundOf(metric)?.slice(4);
      return buckets.map((bucket) => {
        const stats = bucket[metric.id] as (Record<string, unknown> & { std_deviation_bounds?: Record<string, unknown> }) | undefined;
        return numeric(bound ? stats?.std_deviation_bounds?.[bound] : stats?.[metric.type]);
      });
    }
    case 'percentile':
    case 'percentile_rank': {
      // Named alone by another metric, a percentile is its first one, and a rank its first value
      const first = metric.type === 'percentile' ? metric.percentiles?.[0]?.value : metric.values?.[0];
      return buckets.map((bucket) => percentileAt(bucket, metric.id, toPercentileNumber(first), true));
    }
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
      // One value for the whole series, which every bucket then carries; a standard deviation
      // set to one of its bounds gives that bound
      const stats = overall(metric, from(metric.field));
      let result: number | null = null;
      if (stats) {
        if (metric.type === 'avg_bucket') result = stats.mean;
        else if (metric.type === 'max_bucket') result = Math.max(...stats.values);
        else if (metric.type === 'min_bucket') result = Math.min(...stats.values);
        else if (metric.type === 'sum_bucket') result = stats.total;
        else if (metric.type === 'variance_bucket') result = stats.variance;
        else if (metric.type === 'std_deviation_bucket') {
          result = metric.mode === 'upper' ? stats.upper : metric.mode === 'lower' ? stats.lower : stats.deviation;
        } else result = stats.values.reduce((sum, value) => sum + value ** 2, 0);
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

/** What a split of a series draws: a line, or one of the lines or the band its last metric makes */
export interface SeriesLine {
  /** What tells it from the split's other lines, after the split's id */
  key?: string;
  /** What it adds to the split's label */
  suffix: string;
  points: TsvbPoint[];
  band?: TsvbBand;
}

/**
 * The lines a split of a series draws, as the product's processors make them from its last
 * metric: one for each percentile, each named by its value, or a band down to the percentile it
 * fills to; one for each percentile rank; a band between the bounds of a standard deviation set to
 * draw them; otherwise one line. A table shows one number per series: the last percentile or rank,
 * and no band.
 */
export function seriesLines(series: TsvbSeries, buckets: TimeBucket[], intervalMs: number, table = false): SeriesLine[] {
  const metrics = series.metrics ?? [];
  const computed = new Map<string, Array<number | null>>();
  const all: Record<string, MathValue> = {};
  for (const metric of metrics) {
    const values = metricValues(metric, buckets, computed, intervalMs, all);
    computed.set(metric.id, values);
    all[metric.id] = { values: values.map((value) => value ?? NaN), timestamps: buckets.map((bucket) => bucket.key) };
  }
  const last = metrics[metrics.length - 1];
  const at = (key: string): TsvbPoint[] => buckets.map((bucket) => [bucket.key, last ? percentileAt(bucket, last.id, key) : null]);
  if (last?.type === 'percentile') {
    const entries = Array.isArray(last.percentiles) ? last.percentiles : [];
    if (table) {
      const entry = entries[entries.length - 1];
      return entry ? [{ suffix: '', points: at(toPercentileNumber(entry.value)) }] : [];
    }
    return entries.map((entry) => {
      const value = entry.value ? entry.value : 0;
      const key = String(entry.id);
      if (entry.mode !== 'band') return { key, suffix: ` (${value})`, points: at(toPercentileNumber(value)) };
      const lower = toPercentileNumber(entry.percentile);
      const fill = Number(entry.shade);
      return {
        key,
        suffix: '',
        points: buckets.map((bucket) => [bucket.key, percentileAt(bucket, last.id, toPercentileNumber(value)), percentileAt(bucket, last.id, lower)]),
        band: { fill: Number.isFinite(fill) ? fill : 0, upper: ` (${value})`, lower: ` (${String(entry.percentile)})` },
      };
    });
  }
  if (last?.type === 'percentile_rank') {
    const ranks = Array.isArray(last.values) ? last.values : [];
    // The product writes a rank's key twice over, so that a rank left empty has none
    if (table) return [{ suffix: '', points: at(toPercentileNumber(toPercentileNumber(ranks[ranks.length - 1]))) }];
    return ranks.map((rank) => ({ key: String(rank), suffix: ` (${rank || 0})`, points: at(toPercentileNumber(toPercentileNumber(rank))) }));
  }
  if (last?.mode === 'band' && (last.type === 'std_deviation' || last.type === 'std_deviation_bucket')) {
    if (table) return [];
    const numeric = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
    const sibling = last.type === 'std_deviation_bucket' ? overall(last, namedValues(last.field, buckets, computed)) : undefined;
    return [
      {
        suffix: '',
        points: buckets.map((bucket) => {
          if (last.type === 'std_deviation_bucket') return [bucket.key, sibling?.upper ?? null, sibling?.lower ?? null];
          const bounds = (bucket[last.id] as { std_deviation_bounds?: Record<string, unknown> } | undefined)?.std_deviation_bounds;
          return [bucket.key, numeric(bounds?.upper), numeric(bounds?.lower)];
        }),
        band: { fill: 0.5, upper: ' - upper', lower: ' - lower' },
      },
    ];
  }
  const values = last ? (computed.get(last.id) ?? []) : [];
  return [{ suffix: '', points: buckets.map((bucket, index) => [bucket.key, values[index] ?? null]) }];
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

/** What the product says when a panel's interval would cut the time range into too many buckets */
export const TOO_MUCH_DATA = 'Your query attempted to fetch too much data. Reducing the time range or changing the interval used usually fixes the issue.';

/**
 * A panel the product does not ask for, as its interval would cut the time range into more
 * buckets than the setting metrics:max_buckets allows: the failure of its request, not of a search
 */
export class TooMuchDataError extends Error {
  constructor() {
    super(TOO_MUCH_DATA);
    this.name = 'TooMuchDataError';
  }
}

/** The most buckets a panel's interval may cut its time range into: the setting metrics:max_buckets */
const maxBuckets = (): number => services.uiSettings.get<number>('metrics:max_buckets', 2000);

/**
 * Whether a panel's own interval cuts a time range into more buckets than allowed, as the product
 * checks before it asks for anything: an automatic interval, or one of at least so much, never
 * does, and nor does one it cannot read
 */
export function tooManyBuckets(interval: string | undefined, durationMs: number, max: number): boolean {
  if (!interval || interval === 'auto' || interval.startsWith('>=')) return false;
  const parsed = parseInterval(interval);
  return parsed !== undefined && Math.floor(durationMs / parsed.ms) > max;
}

/** Fails a panel whose interval would cut the time range into too many buckets */
function checkBuckets(params: TsvbParams, input: VisInput) {
  const range = resolveTimeRange(input.time, { weekStart: services.weekStart() });
  if (range && tooManyBuckets(params.interval, range.to.getTime() - range.from.getTime(), maxBuckets())) throw new TooMuchDataError();
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
    // The last bucket is still filling, so a line would dip at its end; the panel's choice holds,
    // or else the series' own
    dropLast: !entireRange && Boolean(params.drop_last_bucket ?? series?.override_drop_last_bucket ?? 1),
  };
}

function finish(points: TsvbPoint[], plan: Plan, shift: number): TsvbPoint[] {
  let data = points.map(([time, ...values]): TsvbPoint => [time + shift, ...values]);
  if (plan.dropLast && data.length > 1) data = data.slice(0, -1);
  return data;
}

/** The value of the last bucket (a band's upper one), or 0 when it has none: a 0 counts as none, as in the product */
export function getLastValue(data: TsvbPoint[]): number {
  const last = data[data.length - 1];
  return (last && last[1]) || 0;
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
    const direction = series.terms_direction ?? 'desc';
    // The terms are ordered by a measure worked out again in each, as the product asks, or by
    // their value or their count
    const by = metrics.find((metric) => metric.id === series.terms_order_by);
    const sort = by ? sortBy(by) : undefined;
    const terms: Dsl = {
      field: series.terms_field,
      size: toNumber(series.terms_size, 10),
      order: sort ? { [sort.path]: direction } : { [series.terms_order_by === '_key' ? '_key' : '_count']: direction },
    };
    if (series.terms_include) terms.include = series.terms_include;
    if (series.terms_exclude) terms.exclude = series.terms_exclude;
    split = { terms, aggs: { ...(sort ? { [sort.key]: sort.agg } : {}), timeseries } };
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
    // A split draws one line, or a line for each percentile or rank of the metric, or a band
    const make = (id: string, label: string, color: string, node: { timeseries?: { buckets: TimeBucket[] } }, labelFormatted?: string): TsvbSeriesData[] =>
      seriesLines(series, node.timeseries?.buckets ?? [], plan.intervalMs, Boolean(pivot)).map((line) => {
        const data = finish(line.points, plan, shift);
        return {
          id: line.key === undefined ? id : `${id}:${line.key}`,
          seriesId: series.id,
          label: `${label}${line.suffix}`,
          color,
          ...(labelFormatted ? { labelFormatted } : {}),
          data,
          ...(line.band ? { band: line.band } : {}),
          last: getLastValue(data),
          series,
          format,
        };
      });
    if (mode === 'terms' && Array.isArray(found.buckets)) {
      const list = found.buckets as Array<{ key: string | number; key_as_string?: string; timeseries?: { buckets: TimeBucket[] } }>;
      // A Top N draws every term in the colour of its series; other panels give each the colour
      // its split gives it, if any
      const tones = params.type === 'top_n' ? [] : splitColors(base, list.length, series.split_color_mode);
      return list.flatMap((bucket, index) => {
        const key = String(bucket.key);
        return make(`${series.id}:${key}`, termLabel(series, key), params.type === 'top_n' ? base : tones[index] ?? '', bucket, bucket.key_as_string);
      });
    }
    if (mode === 'filters' && found.buckets && !Array.isArray(found.buckets)) {
      const byId = found.buckets as Record<string, { timeseries?: { buckets: TimeBucket[] } }>;
      return (series.split_filters ?? []).flatMap((item) => {
        const bucket = byId[item.id];
        const text = typeof item.filter === 'string' ? item.filter : typeof item.filter?.query === 'string' ? item.filter.query : '';
        return bucket ? make(`${series.id}:${item.id}`, item.label || text || '*', item.color || '', bucket) : [];
      });
    }
    return make(series.id, series.label || metricLabel(series), base, found);
  };

  const aggregations = (response.aggregations ?? {}) as Record<string, unknown>;
  if (pivot) {
    const rows = ((aggregations.pivot as { buckets?: Array<Record<string, unknown> & { key: string | number; key_as_string?: string }> })?.buckets ?? []).map(
      (bucket) => ({ key: String(bucket.key), made: build(bucket) })
    );
    return { plan, groups: rows };
  }
  return { plan, groups: [{ key: '', made: build(aggregations) }] };
}

/** Whether the product asks for an annotation: one shown, with an index, a time field, fields, an icon and a template */
export const isAnnotationAsked = (annotation: TsvbAnnotation): boolean =>
  Boolean(annotation.index_pattern && annotation.time_field && annotation.fields && annotation.icon && annotation.template && !annotation.hidden);

/** The time of the last point of all the series, as the product finds it: none without series */
export function lastSeriesTime(series: Array<{ data: TsvbPoint[] }>): number | null {
  let last: number | null = null;
  for (const item of series) {
    const point = item.data[item.data.length - 1];
    if (point) last = Math.max(last ?? 0, point[0]);
  }
  return last;
}

/** The interval of an annotation's buckets, as the product asks for it: in seconds, or in milliseconds for a fraction of one */
export function annotationInterval(bucketMs: number): { expression: string; seconds: number } {
  const seconds = bucketMs / 1000;
  return { expression: Number.isInteger(seconds) ? `${seconds}s` : `${bucketMs}ms`, seconds: Math.max(seconds, 1) };
}

/**
 * The annotations of a panel, as the product asks for them: the documents in each bucket of the
 * automatic interval (whatever the panel's), the five latest of each, up to a bucket before the
 * end of the time range; a bucket with documents makes one mark, at its start, unless it starts
 * after the last point of the series. A search that fails fails the panel, as there.
 */
async function fetchAnnotations(
  params: TsvbParams,
  input: VisInput,
  range: AbsoluteRange,
  lastTime: number | null,
  signal?: AbortSignal
): Promise<TsvbAnnotationData[]> {
  const results: TsvbAnnotationData[] = [];
  const bucket = annotationInterval(resolveInterval('auto', range.to.getTime() - range.from.getTime(), { targetBuckets: 100, maxBuckets: 200 }).ms);
  const end = range.to.getTime() - bucket.seconds * 1000;
  const config = { ...services.queryConfig(), ignoreFilterIfFieldNotInIndex: true };
  for (const annotation of (params.annotations ?? []).filter(isAnnotationAsked)) {
    const index = annotation.index_pattern ?? '';
    const timeField = annotation.time_field ?? '';
    const indexPattern = await patternFor(index);
    const global = !annotation.ignore_global_filters;
    const query = buildQuery(indexPattern, global && input.query ? [input.query] : [], global ? input.filters : [], config);
    query.bool.must.push({
      range: { [timeField]: { gte: range.from.toISOString(), lte: new Date(end).toISOString(), format: 'strict_date_optional_time' } },
    });
    if (annotation.query_string) {
      const own = asQuery(annotation.query_string);
      query.bool.must.push({ ...buildQuery(indexPattern, own ? [own] : [], [], config) });
    }
    if (!annotation.ignore_panel_filters && params.filter) {
      const panel = asQuery(params.filter);
      query.bool.must.push({ ...buildQuery(indexPattern, panel ? [panel] : [], [], config) });
    }
    const fields = (annotation.fields ?? '').split(/[,\s]+/);
    for (const field of fields) query.bool.must.push({ exists: { field } });
    const response = await services.search.search(
      index,
      {
        size: 0,
        query,
        aggs: {
          [annotation.id]: {
            date_histogram: {
              field: timeField,
              min_doc_count: 0,
              time_zone: services.timeZone() ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
              extended_bounds: { min: range.from.getTime(), max: end },
              fixed_interval: bucket.expression,
            },
            aggs: {
              hits: { top_hits: { sort: [{ [timeField]: { order: 'desc' } }], _source: { includes: [...fields, timeField] }, size: 5 } },
            },
          },
        },
      },
      { signal }
    );
    const buckets =
      (response.aggregations?.[annotation.id] as { buckets?: Array<{ key: number; hits?: { hits?: { hits?: Array<{ _source?: unknown }> } } }> } | undefined)
        ?.buckets ?? [];
    const marks = buckets.flatMap((entry) => {
      const docs = entry.hits?.hits?.hits ?? [];
      if (docs.length === 0 || lastTime === null || entry.key > lastTime) return [];
      return [{ time: entry.key, docs: docs.map((doc) => doc._source) }];
    });
    results.push({ annotation, marks });
  }
  return results;
}

export async function fetchTsvb(params: TsvbParams, input: VisInput, signal?: AbortSignal): Promise<TsvbData> {
  checkBuckets(params, input);
  const requests: RequestRecord[] = [];
  const shown = (params.series ?? []).filter((series) => !series.hidden);
  const fetched = await Promise.all(shown.map((series) => fetchSeries(params, series, input, requests, signal)));
  const plan = fetched[0]?.plan ?? (await planFor(params, undefined, input));
  const series = fetched.flatMap((result) => result.groups.flatMap((group) => group.made));
  const annotations = params.type === 'timeseries' || !params.type ? await fetchAnnotations(params, input, plan.range, lastSeriesTime(series), signal) : [];
  return {
    series,
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

/** Whether a table can be sorted by a series: by its count or a measure worked out in each row, as in the product */
export const isSortable = (metric: TsvbMetric | undefined): boolean =>
  Boolean(metric && (metric.type === 'count' || BASIC[metric.type] || EXTENDED[metric.type]));

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
  const by = metric ? sortBy(metric) : undefined;
  if (by) return { order: { [by.path]: order }, sortAggs: { [by.key]: by.agg } };
  return { order: { _key: order } };
}

/** The data of the Table panel: a row for each value of the field it groups by, a column per series */
export async function fetchTsvbTable(params: TsvbParams, input: VisInput, signal?: AbortSignal, sort?: TsvbTableSort): Promise<TsvbTableData> {
  // A table that groups by no field has no rows, and says it has no data, as the product's does
  // while its group-by field is still to be chosen
  checkBuckets(params, input);
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

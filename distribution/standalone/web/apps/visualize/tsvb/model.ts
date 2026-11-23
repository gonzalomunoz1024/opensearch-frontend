/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The model a TSVB editor changes: the params of a `metrics` visualization, in the shape OpenSearch
 * Dashboards saves them, since the chart is drawn from them. What is here is what its editor does
 * to them: the defaults a panel starts with, what a panel adds to itself when it is opened, new
 * series and their ids, the index patterns whose fields it lists and the intervals it accepts.
 */

/** A part of the params: a panel, a series, a metric, a rule */
export type Doc = Record<string, unknown>;

export interface Metric extends Doc {
  id: string;
  type: string;
  field?: string;
}

export interface Series extends Doc {
  id: string;
  metrics: Metric[];
}

export interface Panel extends Doc {
  id: string;
  type: string;
  series: Series[];
}

/** A field as `/api/metrics/fields` lists it */
export interface TsvbField {
  name: string;
  type: string;
  esTypes?: string[];
  aggregatable?: boolean;
  searchable?: boolean;
}

/** The fields of each index pattern the panel names, by the pattern as it is written */
export type Fields = Record<string, TsvbField[]>;

/** What a change to a part of the params says: the keys it sets */
export type OnChange = (part: Doc) => void;

export const PANEL_TYPES = ['timeseries', 'metric', 'top_n', 'gauge', 'markdown', 'table'] as const;
export type PanelType = (typeof PANEL_TYPES)[number];

export const str = (doc: Doc, key: string, fallback = ''): string => {
  const value = doc[key];
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : fallback;
};

export const list = <T = Doc>(doc: Doc, key: string): T[] => {
  const value = doc[key];
  return Array.isArray(value) ? (value as T[]) : [];
};

/** A value written into an input: a number shows as it is, nothing as an empty field */
export const inputValue = (value: unknown): string =>
  typeof value === 'string' ? value : typeof value === 'number' && Number.isFinite(value) ? String(value) : '';

/** The same text for the same params, whatever order their keys are in */
export const stableKey = (value: unknown): string =>
  JSON.stringify(value, (_key, item: unknown) =>
    item !== null && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item as Doc).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : item
  );

// --- Ids --------------------------------------------------------------------------------------------

// The ids TSVB gives its series, metrics and rules are time-based (version 1) UUIDs
const GREGORIAN_OFFSET_MS = 12219292800000n;
let lastMs = 0;
let lastNs = 0;
let clockSequence: number | undefined;
let node: string | undefined;

const randomBytes = (count: number): Uint8Array => globalThis.crypto.getRandomValues(new Uint8Array(count));
const hex = (value: bigint | number, width: number) => value.toString(16).padStart(width, '0');

export function uuid(): string {
  if (clockSequence === undefined) {
    const bytes = randomBytes(2);
    clockSequence = ((bytes[0] << 8) | bytes[1]) & 0x3fff;
  }
  if (node === undefined) {
    const bytes = randomBytes(6);
    // A node id that is not a network card's has its multicast bit set
    bytes[0] |= 0x01;
    node = [...bytes].map((byte) => hex(byte, 2)).join('');
  }
  const ms = Date.now();
  let ns = ms === lastMs ? lastNs + 1 : 0;
  if (ms < lastMs) clockSequence = (clockSequence + 1) & 0x3fff;
  if (ns >= 10000) ns = 0;
  lastMs = ms;
  lastNs = ns;
  const time = (BigInt(ms) + GREGORIAN_OFFSET_MS) * 10000n + BigInt(ns);
  const low = time & 0xffffffffn;
  const mid = (time >> 32n) & 0xffffn;
  const high = ((time >> 48n) & 0x0fffn) | 0x1000n;
  const sequence = clockSequence | 0x8000;
  return `${hex(low, 8)}-${hex(mid, 4)}-${hex(high, 4)}-${hex(sequence, 4)}-${node}`;
}

// --- Defaults ---------------------------------------------------------------------------------------

/** The params of a new TSVB visualization, as the type declares them */
export const tsvbDefaults = (): Panel => ({
  id: '61ca57f0-469d-11e7-af02-69e470af7417',
  type: 'timeseries',
  series: [
    {
      id: '61ca57f1-469d-11e7-af02-69e470af7417',
      color: '#54B399',
      split_mode: 'everything',
      split_color_mode: 'opensearchDashboards',
      metrics: [{ id: '61ca57f2-469d-11e7-af02-69e470af7417', type: 'count' }],
      separate_axis: 0,
      axis_position: 'right',
      axis_scale: 'normal',
      formatter: 'number',
      chart_type: 'line',
      line_width: 1,
      point_size: 1,
      fill: 0.5,
      stacked: 'none',
    },
  ],
  time_field: '',
  index_pattern: '',
  interval: '',
  axis_position: 'left',
  axis_formatter: 'number',
  axis_scale: 'normal',
  show_legend: 1,
  show_grid: 1,
  tooltip_mode: 'show_all',
});

/** Saved params with the type's defaults under them: a key that is missing takes its default */
export function withTsvbDefaults(params: Doc): Doc {
  const merged: Doc = { ...params };
  for (const [key, value] of Object.entries(tsvbDefaults())) {
    if (merged[key] === undefined) merged[key] = value;
  }
  return merged;
}

const lacks = (model: Doc, key: string) => list(model, key).length === 0;

/**
 * What a panel adds to the params when its editor opens: the first colour rule of the panels that
 * colour by rules, and the gauge's widths and style. The editor applies them as a change.
 */
export function panelAdditions(model: Doc): Doc {
  const parts: Doc = {};
  if (model.type === 'metric' && lacks(model, 'background_color_rules')) parts.background_color_rules = [{ id: uuid() }];
  if ((model.type === 'top_n' || model.type === 'table') && lacks(model, 'bar_color_rules')) parts.bar_color_rules = [{ id: uuid() }];
  if (model.type === 'gauge') {
    if (lacks(model, 'gauge_color_rules')) parts.gauge_color_rules = [{ id: uuid() }];
    if (model.gauge_width === undefined || model.gauge_width === null) parts.gauge_width = 10;
    if (model.gauge_inner_width === undefined || model.gauge_inner_width === null) parts.gauge_inner_width = 10;
    if (model.gauge_style === undefined || model.gauge_style === null) parts.gauge_style = 'half';
  }
  return parts;
}

/** How many series a panel of a kind can have */
export const SERIES_LIMIT: Partial<Record<string, number>> = { gauge: 1, metric: 2 };

export const newMetric = (): Metric => ({ id: uuid(), type: 'count' });

export const newSeries = (extra: Doc = {}): Series => ({
  id: uuid(),
  color: '#68BC00',
  split_mode: 'everything',
  metrics: [newMetric()],
  separate_axis: 0,
  axis_position: 'right',
  formatter: 'number',
  chart_type: 'line',
  line_width: 1,
  point_size: 1,
  fill: 0.5,
  stacked: 'none',
  ...extra,
});

/** A copy of a series with new ids, whose metrics still point at each other */
export function reIdSeries(source: Series): Series {
  const series = JSON.parse(JSON.stringify(source)) as Series;
  series.id = uuid();
  for (const metric of series.metrics) {
    const id = uuid();
    const old = metric.id;
    metric.id = id;
    if (series.terms_order_by === old) series.terms_order_by = id;
    for (const other of series.metrics) {
      if (other.field === old) other.field = id;
    }
    for (const other of series.metrics) {
      if (other.type !== 'calculation') continue;
      const variables = list(other, 'variables');
      if (!variables.some((variable) => variable.field === old)) continue;
      for (const variable of variables) {
        if (variable.field === old) {
          variable.id = uuid();
          variable.field = id;
        }
      }
    }
  }
  return series;
}

// --- Aggregations ---------------------------------------------------------------------------------

/** What each aggregation is called in labels */
export const AGG_NAMES: Record<string, string> = {
  count: 'Count',
  calculation: 'Calculation',
  std_deviation: 'Std. Deviation',
  variance: 'Variance',
  sum_of_squares: 'Sum of Sq.',
  avg: 'Average',
  max: 'Max',
  min: 'Min',
  sum: 'Sum',
  percentile: 'Percentile',
  percentile_rank: 'Percentile Rank',
  cardinality: 'Cardinality',
  value_count: 'Value Count',
  derivative: 'Derivative',
  cumulative_sum: 'Cumulative Sum',
  moving_average: 'Moving Average',
  avg_bucket: 'Overall Average',
  min_bucket: 'Overall Min',
  max_bucket: 'Overall Max',
  sum_bucket: 'Overall Sum',
  variance_bucket: 'Overall Variance',
  sum_of_squares_bucket: 'Overall Sum of Sq.',
  std_deviation_bucket: 'Overall Std. Deviation',
  series_agg: 'Series Agg',
  math: 'Math',
  serial_diff: 'Serial Difference',
  filter_ratio: 'Filter Ratio',
  positive_only: 'Positive Only',
  static: 'Static Value',
  top_hit: 'Top Hit',
  positive_rate: 'Positive Rate',
};

/** The aggregations computed from another of the series */
export const PIPELINE_AGGS = [
  'calculation',
  'derivative',
  'cumulative_sum',
  'moving_average',
  'avg_bucket',
  'min_bucket',
  'max_bucket',
  'sum_bucket',
  'variance_bucket',
  'sum_of_squares_bucket',
  'std_deviation_bucket',
  'series_agg',
  'math',
  'serial_diff',
  'positive_only',
];

/** An aggregation of the documents themselves, which a series can start with */
export const isBasicAgg = (metric: { type?: unknown }): boolean =>
  typeof metric.type === 'string' && metric.type in AGG_NAMES && !PIPELINE_AGGS.includes(metric.type);

/** The aggregations "Order by" of a split by terms can sort by */
export const BASIC_AGGS = ['count', 'avg', 'max', 'min', 'sum', 'std_deviation', 'variance', 'sum_of_squares', 'value_count', 'cardinality'];

// Those that name the metric they are computed from
const OF_METRIC = [
  'cumulative_sum',
  'derivative',
  'moving_average',
  'avg_bucket',
  'sum_bucket',
  'min_bucket',
  'max_bucket',
  'std_deviation_bucket',
  'variance_bucket',
  'sum_of_squares_bucket',
  'serial_diff',
  'positive_only',
];

/** "Average of bytes", "Derivative of Max of bytes": what a metric is called when it has no alias */
export function calculateLabel(metric: Metric | undefined, metrics: Metric[]): string {
  if (!metric) return 'Unknown';
  if (metric.alias) return String(metric.alias);
  if (metric.type === 'count') return 'Count';
  if (metric.type === 'calculation') return 'Bucket Script';
  if (metric.type === 'math') return 'Math';
  if (metric.type === 'series_agg') return `Series Agg (${String(metric.function)})`;
  if (metric.type === 'filter_ratio') return 'Filter Ratio';
  if (metric.type === 'positive_rate') return `Positive Rate of ${String(metric.field)}`;
  if (metric.type === 'static') return `Static Value of ${String(metric.value)}`;
  if (OF_METRIC.includes(metric.type)) {
    const field = metric.field ?? '';
    const target = metrics.find((item) => field.startsWith(item.id));
    const targetLabel = calculateLabel(target, metrics);
    // A percentile is named with the one picked of it: "…[95.0]"
    if (target && target.type === 'percentile') {
      const matches = /\[([0-9.]+)\]$/.exec(field);
      if (matches) return `${AGG_NAMES[metric.type]} of ${targetLabel} (${matches[1]})`;
    }
    return `${AGG_NAMES[metric.type]} of ${targetLabel}`;
  }
  return `${AGG_NAMES[metric.type]} of ${String(metric.field)}`;
}

/** The metrics another can be computed from: all but itself and those computed from it */
export function calculateSiblings(siblings: Metric[], model: Doc): Metric[] {
  const ancestors: string[] = typeof model.id === 'string' && model.id ? [model.id] : [];
  for (const sibling of siblings) {
    if (sibling.field !== undefined && ancestors.includes(sibling.field)) ancestors.push(sibling.id);
  }
  return siblings.filter((row) => !ancestors.includes(row.id));
}

// The kinds of field the product knows, in the order it declares them
const FIELD_KINDS = ['_source', 'attachment', 'boolean', 'date', 'geo_point', 'geo_shape', 'ip', 'murmur3', 'number', 'string', 'unknown', 'conflict', 'object', 'nested', 'histogram'];

/** The kinds of field an aggregation can be asked of */
export function supportedFieldKinds(type: string): string[] {
  switch (type) {
    case 'cardinality':
      return FIELD_KINDS.filter((kind) => kind !== 'histogram');
    case 'value_count':
      return FIELD_KINDS;
    case 'avg':
    case 'sum':
      return ['number', 'histogram'];
    default:
      return ['number'];
  }
}

/** A percentile as the product writes it in a metric's name: always with a decimal */
export const toPercentileNumber = (value: unknown): string => (/\d+\.\d+/.test(`${String(value)}`) ? String(value) : `${String(value)}.0`);

export const newPercentile = (extra: Doc = {}): Doc & { id: string } => ({ id: uuid(), mode: 'line', shade: 0.2, ...extra });

export const newVariable = (extra: Doc = {}): Doc & { id: string } => ({ id: uuid(), name: '', field: '', ...extra });

// --- Collections ----------------------------------------------------------------------------------

/** A list of the params kept by id, as TSVB's editors change them: add at the end, change or delete by id */
export const collection = {
  add<T extends { id: string }>(items: T[], made: T): T[] {
    return [...items, made];
  },
  change<T extends { id: string }>(items: T[], doc: T): T[] {
    return items.map((item) => (item.id === doc.id ? doc : item));
  },
  remove<T extends { id: string }>(items: T[], doc: { id: string }): T[] {
    return items.filter((item) => item.id !== doc.id);
  },
};

export function reorder<T>(items: T[], from: number, to: number): T[] {
  const result = [...items];
  const [moved] = result.splice(from, 1);
  result.splice(to, 0, moved);
  return result;
}

// --- Index patterns and intervals ------------------------------------------------------------------

/** The index patterns whose fields the editor lists: the panel's, the series' own, the annotations' */
export function extractIndexPatterns(panel: Doc): string[] {
  const patterns: string[] = [str(panel, 'index_pattern')];
  for (const series of list(panel, 'series')) {
    const pattern = str(series, 'series_index_pattern');
    if (pattern && series.override_index_pattern) patterns.push(pattern);
  }
  for (const annotation of list(panel, 'annotations')) {
    const pattern = str(annotation, 'index_pattern');
    if (pattern) patterns.push(pattern);
  }
  return [...new Set(patterns)].sort();
}

export const AUTO_INTERVAL = 'auto';
const UNITS = 'y|M|w|d|h|m|s|ms';
const GTE_INTERVAL = new RegExp(`^>=([\\d\\.]+\\s*(${UNITS}))$`);
const INTERVAL = new RegExp(`^([1-9][0-9]*)\\s*(${UNITS})$`);

export const isAutoInterval = (interval: unknown): boolean => !interval || interval === AUTO_INTERVAL;
export const isGteInterval = (interval: unknown): boolean => typeof interval === 'string' && GTE_INTERVAL.test(interval);

/** Whether an interval is one OpenSearch takes, and what is wrong with it when it is not */
export function validateInterval(interval: unknown): { valid: boolean; message?: string } {
  if (isAutoInterval(interval) || isGteInterval(interval)) return { valid: true };
  const text = String(interval);
  const match = INTERVAL.exec(text.trim());
  if (!match) return { valid: false, message: `Invalid interval format: ${text}` };
  // Weeks, months and years are calendar units: one of them, never several
  if (['w', 'M', 'y'].includes(match[2]) && Number(match[1]) !== 1) {
    return { valid: false, message: `Invalid calendar interval: ${text}, value must be 1` };
  }
  return { valid: true };
}

/** Whether the intervals the editor shows are all valid; the chart is not asked for while one is not */
export function isModelInvalid(panel: Doc): boolean {
  if (!validateInterval(panel.interval ?? AUTO_INTERVAL).valid) return true;
  return list(panel, 'series').some((series) => series.series_interval !== undefined && !validateInterval(series.series_interval).valid);
}

// A year and a month as moment.js counts them: 146097 days every 400 years
const UNIT_MS: Array<[string, number]> = [
  ['y', (146097 / 400) * 24 * 3600000],
  ['M', (146097 / 4800) * 24 * 3600000],
  ['w', 7 * 24 * 3600000],
  ['d', 24 * 3600000],
  ['h', 3600000],
  ['m', 60000],
  ['s', 1000],
];

/** "24h": a width of time in the largest unit it holds more than one of, as the editor shows it */
export function formatInterval(ms: number): string | null {
  for (const [unit, size] of UNIT_MS) {
    const amount = Math.abs(ms / size);
    if (amount > 1) return `${Math.round(amount)}${unit}`;
  }
  return null;
}

/** The narrowest step between the points of a series drawn: the interval the panel was drawn at */
export function drawnInterval(series: Array<{ data: Array<[number, ...unknown[]]> }>): number {
  return series.reduce((current, item) => {
    if (item.data.length > 1) {
      const step = item.data[1][0] - item.data[0][0];
      if (!current || step < current) return step;
    }
    return current;
  }, 0);
}

// --- Formats of durations ----------------------------------------------------------------------------

const DURATION_BASE = [
  { value: 'ms', label: 'Milliseconds' },
  { value: 's', label: 'Seconds' },
  { value: 'm', label: 'Minutes' },
  { value: 'h', label: 'Hours' },
  { value: 'd', label: 'Days' },
  { value: 'w', label: 'Weeks' },
  { value: 'M', label: 'Months' },
  { value: 'Y', label: 'Years' },
];

export const DURATION_INPUTS = [
  { value: 'ps', label: 'Picoseconds' },
  { value: 'ns', label: 'Nanoseconds' },
  { value: 'us', label: 'Microseconds' },
  ...DURATION_BASE,
];

export const DURATION_OUTPUTS = [{ value: 'humanize', label: 'Human readable' }, ...DURATION_BASE];

/** Whether a series' formatter is a duration: "from,to,decimals" */
export function isDuration(format: string): boolean {
  const parts = format.split(',');
  return (
    parts.length === 3 &&
    DURATION_INPUTS.some((item) => item.value === parts[0]) &&
    DURATION_OUTPUTS.some((item) => item.value === parts[1])
  );
}

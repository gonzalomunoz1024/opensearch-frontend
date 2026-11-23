/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Rollup jobs without the pages: the fields a source index offers, what the steps of the form
 * require, the document the form becomes, and how a job and what it is doing are read back.
 */

// --- What OpenSearch keeps of a job ----------------------------------------------------------------

export interface RollupDimension {
  date_histogram?: {
    source_field: string;
    fixed_interval?: string;
    calendar_interval?: string;
    timezone?: string;
  };
  terms?: { source_field: string };
  histogram?: { source_field: string; interval: number };
}

export interface RollupMetric {
  source_field: string;
  metrics: Array<Record<string, unknown>>;
}

export interface JobSchedule {
  interval?: { start_time: number; unit: string; period: number | string };
  cron?: { expression: string; timezone: string };
}

export interface Rollup {
  continuous: boolean;
  description: string;
  dimensions: RollupDimension[];
  enabled: boolean;
  metrics: RollupMetric[];
  page_size: number | null;
  roles?: string[];
  schedule: JobSchedule;
  source_index: string;
  target_index: string;
  delay?: number | string | null;
  last_updated_time?: number;
  [more: string]: unknown;
}

/** What a job is doing, as the plugin explains it */
export interface RollupMetadata {
  rollup_metadata?: {
    status?: string;
    failure_reason?: string;
    continuous?: { next_window_start_time: number; next_window_end_time: number } | null;
    stats?: Record<string, number>;
  } | null;
}

export interface RollupDocument {
  _id: string;
  _seqNo: number;
  _primaryTerm: number;
  rollup: Rollup;
  /** In a list, of this job; of one job alone, under its name */
  metadata?: RollupMetadata | Record<string, RollupMetadata> | null;
}

// --- Units of time ---------------------------------------------------------------------------------

export const FIXED_TIMEUNITS = [
  { value: 'ms', label: 'Millisecond(s)' },
  { value: 's', label: 'Second(s)' },
  { value: 'm', label: 'Minute(s)' },
  { value: 'h', label: 'Hour(s)' },
  { value: 'd', label: 'Day(s)' },
];

export const CALENDAR_TIMEUNITS = [
  { value: 'm', label: 'Minute' },
  { value: 'h', label: 'Hour' },
  { value: 'd', label: 'Day' },
  { value: 'w', label: 'Week' },
  { value: 'M', label: 'Month' },
  { value: 'q', label: 'Quarter' },
  { value: 'y', label: 'Year' },
];

export const DELAY_TIMEUNITS = [
  { value: 'SECONDS', label: 'Second(s)' },
  { value: 'MINUTES', label: 'Minute(s)' },
  { value: 'HOURS', label: 'Hour(s)' },
  { value: 'DAYS', label: 'Day(s)' },
];

export const SCHEDULE_TIMEUNITS = DELAY_TIMEUNITS.slice(1);

const lower = (text: string) => text.trim().toLowerCase();
const isSeconds = (unit: string) => lower(unit) === 'seconds' || lower(unit) === 's';
// One letter tells minutes from months: "m" and "M"
const isMinutes = (unit: string) => lower(unit) === 'minutes' || unit.trim() === 'm';
const isHours = (unit: string) => lower(unit) === 'hours' || lower(unit) === 'h';
const isDays = (unit: string) => lower(unit) === 'days' || lower(unit) === 'd';

/** A unit as a sentence names it: "MINUTES" and "m" are "minute(s)" */
export function parseTimeunit(unit: string): string {
  if (lower(unit) === 'milliseconds' || lower(unit) === 'ms') return 'millisecond(s)';
  if (isSeconds(unit)) return 'second(s)';
  if (isMinutes(unit)) return 'minute(s)';
  if (isHours(unit)) return 'hour(s)';
  if (isDays(unit)) return 'day(s)';
  if (lower(unit) === 'weeks' || lower(unit) === 'w') return 'week';
  if (lower(unit) === 'months' || unit.trim() === 'M') return 'month';
  if (lower(unit) === 'quarters' || lower(unit) === 'q') return 'quarter';
  if (lower(unit) === 'years' || lower(unit) === 'y') return 'year';
  return unit;
}

const MILLISECONDS = (unit: string): number | undefined =>
  isSeconds(unit) ? 1000 : isMinutes(unit) ? 60000 : isHours(unit) ? 3600000 : isDays(unit) ? 86400000 : undefined;

/** A wait in a unit as the milliseconds a job keeps */
export function delayToMs(delay: number | undefined, unit: string): number {
  if (delay === undefined || Number.isNaN(delay)) return 0;
  const factor = MILLISECONDS(unit);
  return factor === undefined ? delay : delay * factor;
}

export function msToDelay(delay: number, unit: string): number {
  const factor = MILLISECONDS(unit);
  return factor === undefined ? delay : delay / factor;
}

export function intervalScheduleText(continuous: boolean, interval: unknown, unit: string): string {
  return continuous ? `Continuous, every ${interval} ${parseTimeunit(unit)}` : 'Not continuous';
}

export function cronScheduleText(continuous: boolean, expression: string): string {
  return continuous ? `Continuous, defined by cron expression: ${expression}` : 'Not continuous';
}

/** The schedule of a job in a sentence */
export function scheduleText(rollup: Rollup): string {
  const { interval, cron } = rollup.schedule;
  return interval
    ? intervalScheduleText(rollup.continuous, interval.period, String(interval.unit))
    : cronScheduleText(rollup.continuous, cron?.expression ?? '');
}

/** "1h" as "1 hour(s)"; nothing when it is not a number and a unit */
export function histogramIntervalText(interval: string | undefined): string {
  const value = interval?.match(/(\d+)/);
  const unit = interval?.match(/[a-zA-Z]+/g);
  return value && unit ? `${value[0]} ${parseTimeunit(unit[0])}` : '';
}

// --- The fields of the source ----------------------------------------------------------------------

export interface FieldItem {
  label: string;
  type?: string;
  /** Of an alias: the field it stands for */
  path?: string;
}

interface Mapping {
  type?: string;
  path?: string;
  fields?: Record<string, Mapping>;
  properties?: Record<string, Mapping>;
}

/** Every field of a mapping that holds values, those inside objects under their whole names */
export function parseFieldOptions(prefix: string, mappings: Record<string, Mapping> | undefined): FieldItem[] {
  const fields: FieldItem[] = [];
  for (const [name, mapping] of Object.entries(mappings ?? {})) {
    if (mapping.type !== 'object' && mapping.type != null && mapping.type !== 'nested') {
      fields.push({
        label: prefix + name,
        type: mapping.type,
        ...(mapping.path !== undefined && { path: mapping.path }),
      });
    }
    if (mapping.fields != null) fields.push(...parseFieldOptions(`${prefix}${name}.`, mapping.fields));
    if (mapping.properties != null) fields.push(...parseFieldOptions(`${prefix}${name}.`, mapping.properties));
  }
  return fields;
}

/** The fields all the indexes of a pattern have, of the same type in each */
export function commonFields(
  mappings: Record<string, { mappings?: { properties?: Record<string, Mapping> } }>
): FieldItem[] {
  const all = Object.values(mappings).map((index) => parseFieldOptions('', index.mappings?.properties));
  if (all.length === 0) return [];
  return all.reduce((left, right) =>
    left.filter((a) => right.some((b) => a.label === b.label && a.type === b.type))
  );
}

const NUMERIC = ['long', 'integer', 'short', 'byte', 'double', 'float', 'half_float', 'scaled_float'];
export const isNumericMapping = (type: string | undefined) => type !== undefined && NUMERIC.includes(type);

/** What the source field offers once text is typed: the text as a pattern, before what was found */
export const wildcardOption = (search: string) => (search.endsWith('*') ? search : `${search}*`);

// --- Aggregations and metrics as the form holds them -----------------------------------------------

export interface DimensionItem {
  sequence: number;
  field: FieldItem;
  aggregationMethod: string;
  interval?: number | null;
}

export const METRIC_KINDS = ['min', 'max', 'sum', 'avg', 'value_count'] as const;
export type MetricKind = (typeof METRIC_KINDS)[number];

export interface MetricItem extends Record<MetricKind, boolean> {
  source_field: FieldItem;
  all: boolean;
}

const numbered = (dimensions: DimensionItem[]): DimensionItem[] =>
  dimensions.map((dimension, at) => ({ ...dimension, sequence: at + 1 }));

/** The chosen fields that are not aggregated yet, after those that are: numbers in ranges, the rest by value */
export function addDimensions(dimensions: DimensionItem[], chosen: FieldItem[]): DimensionItem[] {
  const fresh = chosen.filter((field) => !dimensions.some((dimension) => dimension.field.label === field.label));
  return numbered([
    ...dimensions,
    ...fresh.map((field) =>
      isNumericMapping(field.type)
        ? { sequence: 0, field, aggregationMethod: 'histogram', interval: 5 }
        : { sequence: 0, field, aggregationMethod: 'terms' }
    ),
  ]);
}

export const removeDimension = (dimensions: DimensionItem[], label: string): DimensionItem[] =>
  numbered(dimensions.filter((dimension) => dimension.field.label !== label));

/** One aggregation a place earlier (-1) or later (1) */
export function moveDimension(dimensions: DimensionItem[], label: string, by: -1 | 1): DimensionItem[] {
  const from = dimensions.findIndex((dimension) => dimension.field.label === label);
  const to = from + by;
  if (from < 0 || to < 0 || to >= dimensions.length) return dimensions;
  const next = [...dimensions];
  [next[from], next[to]] = [next[to], next[from]];
  return numbered(next);
}

export function changeDimension(
  dimensions: DimensionItem[],
  label: string,
  change: { aggregationMethod: string } | { interval: number | undefined }
): DimensionItem[] {
  return dimensions.map((dimension) => {
    if (dimension.field.label !== label) return dimension;
    const { sequence, field } = dimension;
    if ('aggregationMethod' in change) {
      return change.aggregationMethod === 'histogram'
        ? { sequence, field, aggregationMethod: 'histogram', interval: 5 }
        : { sequence, field, aggregationMethod: change.aggregationMethod };
    }
    return { sequence, field, aggregationMethod: 'histogram', interval: change.interval ?? NaN };
  });
}

export function addMetrics(metrics: MetricItem[], chosen: FieldItem[]): MetricItem[] {
  const fresh = chosen.filter((field) => !metrics.some((metric) => metric.source_field.label === field.label));
  return [
    ...metrics,
    ...fresh.map((field) => ({
      source_field: field,
      all: false,
      min: false,
      max: false,
      sum: false,
      avg: false,
      value_count: false,
    })),
  ];
}

/** A box of a metric ticked or cleared. "All" ticks every one; clearing it clears only itself. */
export function toggleMetric(metrics: MetricItem[], label: string, kind: MetricKind | 'all'): MetricItem[] {
  return metrics.map((metric) => {
    if (metric.source_field.label !== label) return metric;
    if (kind !== 'all') return { ...metric, [kind]: !metric[kind] };
    return metric.all
      ? { ...metric, all: false }
      : { ...metric, all: true, min: true, max: true, sum: true, avg: true, value_count: true };
  });
}

export const setMetricKind = (metrics: MetricItem[], kind: MetricKind, on: boolean): MetricItem[] =>
  metrics.map((metric) => ({ ...metric, [kind]: on }));

// --- The form --------------------------------------------------------------------------------------

export interface RollupForm {
  rollupId: string;
  description: string;
  sourceIndex: string;
  targetIndex: string;
  timestamp: string;
  intervalType: 'fixed' | 'calendar';
  intervalValue: number | undefined;
  timeunit: string;
  timezone: string;
  dimensions: DimensionItem[];
  metrics: MetricItem[];
  enabled: boolean;
  continuous: boolean;
  continuousDefinition: 'fixed' | 'cron';
  interval: number | undefined;
  intervalTimeunit: string;
  cronExpression: string;
  cronTimezone: string;
  pageSize: number | undefined;
  delayTime: number | undefined;
  delayTimeunit: string;
}

export const EMPTY_ROLLUP_FORM: RollupForm = {
  rollupId: '',
  description: '',
  sourceIndex: '',
  targetIndex: '',
  timestamp: '',
  intervalType: 'fixed',
  intervalValue: 1,
  timeunit: 'h',
  timezone: 'UTC',
  dimensions: [],
  metrics: [],
  enabled: true,
  continuous: false,
  continuousDefinition: 'fixed',
  interval: 1,
  intervalTimeunit: 'MINUTES',
  cronExpression: '',
  cronTimezone: 'UTC',
  pageSize: 1000,
  delayTime: undefined,
  delayTimeunit: 'MINUTES',
};

export const INTERVAL_REQUIRED = 'Interval value is required.';

/** What the first step still misses, by the field that misses it */
export function indicesErrors(form: RollupForm): { rollupId?: string; sourceIndex?: string; targetIndex?: string } {
  const errors: { rollupId?: string; sourceIndex?: string; targetIndex?: string } = {};
  if (!form.rollupId) errors.rollupId = 'Job name is required.';
  if (!form.sourceIndex) errors.sourceIndex = 'Source index is required.';
  if (!form.targetIndex) errors.targetIndex = 'Target index is required.';
  return errors;
}

/** A metric with nothing to compute is named: the last of them, as the plugin names it */
export function metricsError(metrics: MetricItem[]): string {
  const idle = metrics.filter((metric) => !METRIC_KINDS.some((kind) => metric[kind]));
  return idle.length === 0
    ? ''
    : `Must specify at least one metric to aggregate on for: ${idle[idle.length - 1].source_field.label}`;
}

/** The schedule a form describes, starting now */
export function scheduleOf(
  form: Pick<RollupForm, 'continuousDefinition' | 'cronExpression' | 'cronTimezone' | 'interval' | 'intervalTimeunit'>,
  nowSeconds: number,
  period: number | string
): JobSchedule {
  return form.continuousDefinition === 'cron'
    ? { cron: { expression: form.cronExpression, timezone: form.cronTimezone } }
    : { interval: { start_time: nowSeconds, unit: form.intervalTimeunit, period } };
}

/** The job a filled form asks for, in the order of keys the plugin sends */
export function rollupBody(form: RollupForm, nowSeconds: number): { rollup: Rollup } {
  const dateHistogram: NonNullable<RollupDimension['date_histogram']> =
    form.intervalType === 'calendar'
      ? { source_field: form.timestamp, timezone: form.timezone, calendar_interval: `1${form.timeunit}` }
      : {
          source_field: form.timestamp,
          fixed_interval: `${form.intervalValue ?? NaN}${form.timeunit}`,
          timezone: form.timezone,
        };
  return {
    rollup: {
      continuous: form.continuous,
      description: form.description,
      dimensions: [
        { date_histogram: dateHistogram },
        ...form.dimensions.map(
          (dimension): RollupDimension =>
            dimension.aggregationMethod === 'terms'
              ? { terms: { source_field: dimension.field.label } }
              : { histogram: { source_field: dimension.field.label, interval: dimension.interval as number } }
        ),
      ],
      enabled: form.enabled,
      metrics: form.metrics.map((metric) => ({
        source_field: metric.source_field.label,
        metrics: METRIC_KINDS.filter((kind) => metric[kind]).map((kind) => ({ [kind]: {} })),
      })),
      page_size: form.pageSize ?? null,
      roles: [],
      schedule: scheduleOf(form, nowSeconds, `${form.interval}`),
      source_index: form.sourceIndex,
      target_index: form.targetIndex,
      delay: delayToMs(form.delayTime, form.delayTimeunit),
    },
  };
}

// --- A job read back -------------------------------------------------------------------------------

/** The aggregations of a job after its date histogram, numbered as they stand in the job */
export function parseDimensions(dimensions: RollupDimension[]): DimensionItem[] {
  return dimensions.slice(1).map((dimension, at) => ({
    sequence: at + 1,
    aggregationMethod: dimension.histogram == null ? 'terms' : 'histogram',
    field: { label: (dimension.histogram ?? dimension.terms)?.source_field ?? '' },
    interval: dimension.histogram == null ? null : dimension.histogram.interval,
  }));
}

export function parseMetrics(metrics: RollupMetric[]): MetricItem[] {
  return metrics.map((metric) => {
    const has = (kind: MetricKind) => metric.metrics.some((item) => item[kind] != null);
    return {
      source_field: { label: metric.source_field },
      all: false,
      min: has('min'),
      max: has('max'),
      sum: has('sum'),
      avg: has('avg'),
      value_count: has('value_count'),
    };
  });
}

/** What the page that edits a job can change */
export interface RollupEdit {
  description: string;
  continuousDefinition: 'fixed' | 'cron';
  interval: number | undefined;
  intervalTimeunit: string;
  cronExpression: string;
  cronTimezone: string;
  pageSize: number | undefined;
  delayTime: number | undefined;
  delayTimeunit: string;
}

/**
 * The option of the unit select that a unit is. The plugin compares the job's "Hours" with its
 * "HOURS" and shows the first option, "Minute(s)", for any job: this shows the job's own unit.
 */
export const unitOption = (unit: string) => unit.toUpperCase();

export function editOf(rollup: Rollup): RollupEdit {
  const { interval, cron } = rollup.schedule;
  const delay = Number(rollup.delay);
  return {
    description: rollup.description,
    continuousDefinition: cron === undefined ? 'fixed' : 'cron',
    interval: interval === undefined ? 2 : Number(interval.period),
    // As OpenSearch spells it ("Hours" for the "HOURS" it was sent), and sent back so until it is changed
    intervalTimeunit: interval === undefined ? 'MINUTES' : String(interval.unit),
    cronExpression: cron?.expression ?? '',
    cronTimezone: cron?.timezone ?? 'UTC',
    pageSize: rollup.page_size ?? undefined,
    delayTime: !delay ? undefined : msToDelay(delay, 'MINUTES'),
    delayTimeunit: 'MINUTES',
  };
}

/** The job as it was, with what the page changed */
export function editedRollup(rollup: Rollup, edit: RollupEdit, nowSeconds: number): { rollup: Rollup } {
  return {
    rollup: {
      ...rollup,
      description: edit.description,
      page_size: edit.pageSize ?? null,
      schedule: scheduleOf(edit, nowSeconds, edit.interval ?? NaN),
      delay: delayToMs(edit.delayTime, edit.delayTimeunit),
    },
  };
}

// --- What a job is doing ---------------------------------------------------------------------------

export interface JobStatus {
  icon: 'warning' | 'check' | 'clock' | 'play' | 'stop';
  tone: 'critical' | 'healthy' | 'accent' | 'subdued';
  text: string;
}

/** The state of a job in a word; nothing when it has not run or says something unknown */
export function rollupStatus(metadata: RollupMetadata | null | undefined): JobStatus | undefined {
  const state = metadata?.rollup_metadata;
  if (state == null) return undefined;
  switch (state.status) {
    case 'failed':
      return { icon: 'warning', tone: 'critical', text: `Failed: ${state.failure_reason}` };
    case 'finished':
      return { icon: 'check', tone: 'healthy', text: 'Complete' };
    case 'init':
      return { icon: 'clock', tone: 'accent', text: 'Initializing' };
    case 'started':
      return { icon: 'play', tone: 'healthy', text: 'Started' };
    case 'stopped':
      return { icon: 'stop', tone: 'subdued', text: 'Stopped' };
    default:
      return undefined;
  }
}

/** The two ends of the window a continuous job works on next; nothing for a job that is not continuous */
export function rollupWindow(metadata: RollupMetadata | null | undefined): [number, number] | undefined {
  const continuous = metadata?.rollup_metadata?.continuous;
  return continuous == null ? undefined : [continuous.next_window_start_time, continuous.next_window_end_time];
}

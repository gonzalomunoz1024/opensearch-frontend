/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Dates: the relative expressions of the time picker ("now-15m", "now/d"), formatting with the
 * tokens the date settings of OpenSearch Dashboards use ("MMM D, YYYY @ HH:mm:ss.SSS"), and the
 * interval a histogram over a time range gets.
 */

export type TimeUnit = 'ms' | 's' | 'm' | 'h' | 'd' | 'w' | 'M' | 'y';

export const UNIT_MS: Record<TimeUnit, number> = {
  ms: 1,
  s: 1000,
  m: 60000,
  h: 3600000,
  d: 86400000,
  w: 604800000,
  M: 2592000000,
  y: 31536000000,
};

export const UNIT_NAMES: Record<TimeUnit, [string, string]> = {
  ms: ['millisecond', 'milliseconds'],
  s: ['second', 'seconds'],
  m: ['minute', 'minutes'],
  h: ['hour', 'hours'],
  d: ['day', 'days'],
  w: ['week', 'weeks'],
  M: ['month', 'months'],
  y: ['year', 'years'],
};

export function addUnits(date: Date, amount: number, unit: TimeUnit): Date {
  const result = new Date(date.getTime());
  switch (unit) {
    case 'y':
      result.setFullYear(result.getFullYear() + amount);
      break;
    case 'M': {
      const day = result.getDate();
      result.setDate(1);
      result.setMonth(result.getMonth() + amount);
      const last = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
      result.setDate(Math.min(day, last));
      break;
    }
    case 'w':
      result.setDate(result.getDate() + amount * 7);
      break;
    case 'd':
      result.setDate(result.getDate() + amount);
      break;
    default:
      result.setTime(result.getTime() + amount * UNIT_MS[unit]);
  }
  return result;
}

/** The first moment of the unit the date falls in; `weekStart` is 0 for Sunday */
export function startOf(date: Date, unit: TimeUnit, weekStart = 0): Date {
  const result = new Date(date.getTime());
  switch (unit) {
    case 'y':
      result.setMonth(0, 1);
      result.setHours(0, 0, 0, 0);
      break;
    case 'M':
      result.setDate(1);
      result.setHours(0, 0, 0, 0);
      break;
    case 'w':
      result.setDate(result.getDate() - ((result.getDay() - weekStart + 7) % 7));
      result.setHours(0, 0, 0, 0);
      break;
    case 'd':
      result.setHours(0, 0, 0, 0);
      break;
    case 'h':
      result.setMinutes(0, 0, 0);
      break;
    case 'm':
      result.setSeconds(0, 0);
      break;
    case 's':
      result.setMilliseconds(0);
      break;
    default:
  }
  return result;
}

export function endOf(date: Date, unit: TimeUnit, weekStart = 0): Date {
  if (unit === 'ms') return new Date(date.getTime());
  return new Date(addUnits(startOf(date, unit, weekStart), 1, unit).getTime() - 1);
}

export interface DateMathOptions {
  /** A rounded expression ("now/d") ends its unit instead of starting it: the end of a range */
  roundUp?: boolean;
  /** What "now" is; the present when left out */
  now?: Date;
  weekStart?: number;
}

/**
 * The date of an expression: "now", "now-15m", "now-1d/d", or a date with the same arithmetic
 * after "||" ("2026-01-01||+1M/d"). `undefined` when it is not one.
 */
export function parseDateMath(text: string, options: DateMathOptions = {}): Date | undefined {
  if (typeof text !== 'string' || text.trim() === '') return undefined;
  const input = text.trim();
  let date: Date;
  let math: string;
  if (input.startsWith('now')) {
    date = new Date((options.now ?? new Date()).getTime());
    math = input.slice(3);
  } else {
    const split = input.indexOf('||');
    const base = split === -1 ? input : input.slice(0, split);
    math = split === -1 ? '' : input.slice(split + 2);
    const parsed = /^\d+$/.test(base) ? new Date(Number(base)) : new Date(base);
    if (Number.isNaN(parsed.getTime())) return undefined;
    date = parsed;
  }

  let rest = math;
  while (rest.length) {
    const operation = /^([+-])(\d*)(ms|[smhdwMy])/.exec(rest);
    if (operation) {
      const amount = operation[2] === '' ? 1 : Number(operation[2]);
      date = addUnits(date, operation[1] === '+' ? amount : -amount, operation[3] as TimeUnit);
      rest = rest.slice(operation[0].length);
      continue;
    }
    const rounding = /^\/(ms|[smhdwMy])/.exec(rest);
    if (rounding) {
      const unit = rounding[1] as TimeUnit;
      date = options.roundUp
        ? endOf(date, unit, options.weekStart)
        : startOf(date, unit, options.weekStart);
      rest = rest.slice(rounding[0].length);
      continue;
    }
    return undefined;
  }
  return date;
}

export interface TimeRange {
  from: string;
  to: string;
}

export interface AbsoluteRange {
  from: Date;
  to: Date;
}

export function resolveTimeRange(
  range: TimeRange,
  options: Omit<DateMathOptions, 'roundUp'> = {}
): AbsoluteRange | undefined {
  const now = options.now ?? new Date();
  const from = parseDateMath(range.from, { ...options, now });
  const to = parseDateMath(range.to, { ...options, now, roundUp: true });
  return from && to ? { from, to } : undefined;
}

// --- Formatting ----------------------------------------------------------------------------------

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

interface Parts {
  year: number;
  month: number;
  day: number;
  weekday: number;
  hour: number;
  minute: number;
  second: number;
  ms: number;
  /** Minutes east of UTC */
  offset: number;
}

const zoneFormats = new Map<string, Intl.DateTimeFormat>();

/** Minutes east of UTC in a zone at a moment: the browser's zone when none is named */
export function utcOffset(date: Date, timeZone?: string): number {
  return partsOf(date, timeZone).offset;
}

function partsOf(date: Date, timeZone?: string): Parts {
  if (!timeZone || timeZone === 'Browser') {
    return {
      year: date.getFullYear(),
      month: date.getMonth(),
      day: date.getDate(),
      weekday: date.getDay(),
      hour: date.getHours(),
      minute: date.getMinutes(),
      second: date.getSeconds(),
      ms: date.getMilliseconds(),
      offset: -date.getTimezoneOffset(),
    };
  }
  if (timeZone === 'UTC') {
    return {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth(),
      day: date.getUTCDate(),
      weekday: date.getUTCDay(),
      hour: date.getUTCHours(),
      minute: date.getUTCMinutes(),
      second: date.getUTCSeconds(),
      ms: date.getUTCMilliseconds(),
      offset: 0,
    };
  }
  let format = zoneFormats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    zoneFormats.set(timeZone, format);
  }
  const fields: Record<string, number> = {};
  for (const part of format.formatToParts(date)) {
    if (part.type !== 'literal') fields[part.type] = Number(part.value);
  }
  const asUtc = Date.UTC(fields.year, fields.month - 1, fields.day, fields.hour, fields.minute, fields.second);
  return {
    year: fields.year,
    month: fields.month - 1,
    day: fields.day,
    weekday: new Date(asUtc).getUTCDay(),
    hour: fields.hour,
    minute: fields.minute,
    second: fields.second,
    ms: date.getUTCMilliseconds(),
    offset: Math.round((asUtc - (date.getTime() - date.getUTCMilliseconds())) / 60000),
  };
}

/** Minutes east of UTC of a time zone (a name, UTC, or the browser's own when none) at a moment */
export function timeZoneOffset(time: number, timeZone?: string): number {
  return partsOf(new Date(time), timeZone).offset;
}

const pad = (value: number, length = 2) => String(value).padStart(length, '0');

function ordinal(value: number): string {
  const tens = value % 100;
  if (tens >= 11 && tens <= 13) return `${value}th`;
  return `${value}${['th', 'st', 'nd', 'rd'][value % 10] ?? 'th'}`;
}

const TOKENS =
  /\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|Do|DD|D|dddd|ddd|HH|H|hh|h|mm|m|ss|s|SSS|SS|S|A|a|ZZ|Z|X|x/g;

/** A date written with the tokens of the product's date settings. `[text]` is kept as it is. */
export function formatDate(date: Date, pattern: string, timeZone?: string): string {
  if (Number.isNaN(date.getTime())) return 'Invalid date';
  const parts = partsOf(date, timeZone);
  const offset = (separator: string) => {
    const minutes = Math.abs(parts.offset);
    return `${parts.offset < 0 ? '-' : '+'}${pad(Math.floor(minutes / 60))}${separator}${pad(minutes % 60)}`;
  };
  return pattern.replace(TOKENS, (token, literal: string | undefined) => {
    if (literal !== undefined) return literal;
    switch (token) {
      case 'YYYY':
        return String(parts.year);
      case 'YY':
        return pad(parts.year % 100);
      case 'MMMM':
        return MONTHS[parts.month];
      case 'MMM':
        return MONTHS[parts.month].slice(0, 3);
      case 'MM':
        return pad(parts.month + 1);
      case 'M':
        return String(parts.month + 1);
      case 'Do':
        return ordinal(parts.day);
      case 'DD':
        return pad(parts.day);
      case 'D':
        return String(parts.day);
      case 'dddd':
        return DAYS[parts.weekday];
      case 'ddd':
        return DAYS[parts.weekday].slice(0, 3);
      case 'HH':
        return pad(parts.hour);
      case 'H':
        return String(parts.hour);
      case 'hh':
        return pad(parts.hour % 12 || 12);
      case 'h':
        return String(parts.hour % 12 || 12);
      case 'mm':
        return pad(parts.minute);
      case 'm':
        return String(parts.minute);
      case 'ss':
        return pad(parts.second);
      case 's':
        return String(parts.second);
      case 'SSS':
        return pad(parts.ms, 3);
      case 'SS':
        return pad(Math.floor(parts.ms / 10));
      case 'S':
        return String(Math.floor(parts.ms / 100));
      case 'A':
        return parts.hour < 12 ? 'AM' : 'PM';
      case 'a':
        return parts.hour < 12 ? 'am' : 'pm';
      case 'Z':
        return offset(':');
      case 'ZZ':
        return offset('');
      case 'X':
        return String(Math.floor(date.getTime() / 1000));
      case 'x':
        return String(date.getTime());
      default:
        return token;
    }
  });
}

export const DEFAULT_DATE_FORMAT = 'MMM D, YYYY @ HH:mm:ss.SSS';

/** The setting dateFormat:scaled: an ISO 8601 duration and the format of an interval at least that long */
export type ScaledDateRules = Array<[string, string]>;

export const DEFAULT_SCALED_DATE_RULES: ScaledDateRules = [
  ['', 'HH:mm:ss.SSS'],
  ['PT1S', 'HH:mm:ss'],
  ['PT1M', 'HH:mm'],
  ['PT1H', 'YYYY-MM-DD HH:mm'],
  ['P1DT', 'YYYY-MM-DD'],
  ['P1YT', 'YYYY'],
];

const ISO_DURATION =
  /^P(?:(\d*\.?\d*)Y)?(?:(\d*\.?\d*)M)?(?:(\d*\.?\d*)W)?(?:(\d*\.?\d*)D)?(?:T(?:(\d*\.?\d*)H)?(?:(\d*\.?\d*)M)?(?:(\d*\.?\d*)S)?)?$/;

/**
 * An ISO 8601 duration in milliseconds, as moment counts one: a month is 30 days and a year 365.
 * What is not a duration is 0, as moment makes of it.
 */
export function isoDurationMs(text: string): number {
  const match = ISO_DURATION.exec(text.trim().toUpperCase());
  if (!match) return 0;
  const units: TimeUnit[] = ['y', 'M', 'w', 'd', 'h', 'm', 's'];
  return units.reduce((total, unit, index) => total + (Number.parseFloat(match[index + 1] ?? '') || 0) * UNIT_MS[unit], 0);
}

/** The rules of dateFormat:scaled as the setting holds them, or none when it holds something else */
export function scaledDateRules(value: unknown): ScaledDateRules | undefined {
  if (!Array.isArray(value)) return undefined;
  const rules = value.filter(
    (rule): rule is [string, string] =>
      Array.isArray(rule) && typeof rule[0] === 'string' && typeof rule[1] === 'string'
  );
  return rules.length === value.length ? rules : undefined;
}

/**
 * The format of an axis tick or a bucket by the interval it stands for, as the original's time
 * buckets choose it: the last rule whose duration the interval reaches, or whose duration is empty;
 * the date format when none is.
 */
export function scaledDateFormat(
  intervalMs: number,
  rules: ScaledDateRules = DEFAULT_SCALED_DATE_RULES,
  dateFormat = DEFAULT_DATE_FORMAT
): string {
  for (let at = rules.length - 1; at >= 0; at--) {
    const [duration, format] = rules[at];
    if (!duration || (intervalMs && intervalMs >= isoDurationMs(duration))) return format;
  }
  return dateFormat;
}

// --- Intervals -----------------------------------------------------------------------------------

export interface Interval {
  /** As OpenSearch takes it: "3h", "1d", "30s" */
  expression: string;
  ms: number;
  /** "3 hours" */
  description: string;
  /** Months and years differ in length, so OpenSearch counts them by the calendar */
  calendar: boolean;
}

export function parseInterval(expression: string): Interval | undefined {
  const match = /^(\d+(?:\.\d+)?)?(ms|[smhdwMy])$/.exec(expression.trim());
  if (!match) return undefined;
  const amount = match[1] === undefined ? 1 : Number(match[1]);
  const unit = match[2] as TimeUnit;
  if (!(amount > 0)) return undefined;
  return {
    expression: `${amount}${unit}`,
    ms: amount * UNIT_MS[unit],
    description: `${amount === 1 ? '' : `${amount} `}${UNIT_NAMES[unit][amount === 1 ? 0 : 1]}`.trim(),
    calendar: amount === 1 && (unit === 'w' || unit === 'M' || unit === 'y'),
  };
}

function fromMs(ms: number): Interval {
  for (const unit of ['y', 'M', 'w', 'd', 'h', 'm', 's'] as TimeUnit[]) {
    if (ms >= UNIT_MS[unit] && ms % UNIT_MS[unit] === 0) {
      return parseInterval(`${ms / UNIT_MS[unit]}${unit}`)!;
    }
  }
  return parseInterval(`${Math.max(1, Math.floor(ms))}ms`)!;
}

// A target per bucket at or above `bound` gets `interval`
const AUTO_RULES: Array<[bound: number, interval: number]> = [
  [Infinity, UNIT_MS.y],
  [UNIT_MS.y, UNIT_MS.M],
  [3 * UNIT_MS.w, UNIT_MS.w],
  [UNIT_MS.w, UNIT_MS.d],
  [24 * UNIT_MS.h, 12 * UNIT_MS.h],
  [6 * UNIT_MS.h, 3 * UNIT_MS.h],
  [2 * UNIT_MS.h, UNIT_MS.h],
  [45 * UNIT_MS.m, 30 * UNIT_MS.m],
  [20 * UNIT_MS.m, 10 * UNIT_MS.m],
  [9 * UNIT_MS.m, 5 * UNIT_MS.m],
  [3 * UNIT_MS.m, UNIT_MS.m],
  [45 * UNIT_MS.s, 30 * UNIT_MS.s],
  [15 * UNIT_MS.s, 10 * UNIT_MS.s],
  [7.5 * UNIT_MS.s, 5 * UNIT_MS.s],
  [5 * UNIT_MS.s, UNIT_MS.s],
  [500, 100],
];

// The widest round interval that still gives at least `maxBuckets` bars: what an interval that
// would give more bars than that is widened to
function intervalLessThan(durationMs: number, maxBuckets: number): number {
  const maxPerBucket = durationMs / maxBuckets;
  for (const [, interval] of AUTO_RULES) {
    if (interval <= maxPerBucket) return interval;
  }
  return Number.isFinite(maxPerBucket) ? Math.max(Math.floor(maxPerBucket), 1) : 1;
}

function intervalNear(durationMs: number, targetBuckets: number): number {
  const target = durationMs / targetBuckets;
  if (!Number.isFinite(target) || target <= 0) return 1;
  const lower = AUTO_RULES.findIndex(([bound]) => bound <= target);
  return lower > 0 ? AUTO_RULES[lower - 1][1] : Math.max(Math.floor(target), 1);
}

/**
 * The interval of a histogram over a time range: the one asked for, or for "auto" a round one
 * that gives about `targetBuckets` bars; either is widened when it would give more than
 * `maxBuckets`. These are the rules of OpenSearch Dashboards (the settings histogram:barTarget
 * and histogram:maxBars), so the same range draws the same bars.
 */
export function resolveInterval(
  requested: string | undefined,
  durationMs: number,
  options: { targetBuckets?: number; maxBuckets?: number } = {}
): Interval & { scaled: boolean } {
  const { targetBuckets = 50, maxBuckets = 100 } = options;
  const parsed = requested && requested !== 'auto' ? parseInterval(requested) : undefined;
  const wanted = parsed?.ms ?? intervalNear(durationMs, targetBuckets);
  if (durationMs > 0 && durationMs / wanted > maxBuckets) {
    const scaled = intervalLessThan(durationMs, maxBuckets);
    if (scaled !== wanted) return { ...fromMs(scaled), scaled: true };
  }
  return { ...(parsed ?? fromMs(wanted)), scaled: false };
}

export const autoInterval = (durationMs: number, targetBuckets = 50, maxBuckets = 100) =>
  resolveInterval('auto', durationMs, { targetBuckets, maxBuckets });

export function humanDuration(ms: number): string {
  const interval = fromMs(ms);
  return interval.description;
}

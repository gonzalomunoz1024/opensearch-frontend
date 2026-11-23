/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The date arithmetic Timeline does on the server, which OpenSearch Dashboards does with moment:
 * reading the request's times, the start of a unit and adding units in the server's own time zone
 * (what moment does without a time zone), the intervals in milliseconds, the interval of "auto",
 * and the fixed or calendar interval of a date histogram.
 */

const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;
/** moment's month: 146097 / 4800 days */
const MS_PER_MONTH = (146097 / 4800) * MS_PER_DAY;

const mod = (dividend: number, divisor: number) => ((dividend % divisor) + divisor) % divisor;

/** A local date, also for the years 0 to 99 that `new Date` would put in the 1900s */
function localDate(
  year: number,
  month: number,
  day: number,
  hours = 0,
  minutes = 0,
  seconds = 0,
  ms = 0
): Date {
  const date = new Date(2000, month, day, hours, minutes, seconds, ms);
  date.setFullYear(year, month, day);
  return date;
}

function daysInMonth(year: number, month: number): number {
  const modMonth = mod(month, 12);
  const fullYear = year + (month - modMonth) / 12;
  if (modMonth === 1) {
    const leap = (fullYear % 4 === 0 && fullYear % 100 !== 0) || fullYear % 400 === 0;
    return leap ? 29 : 28;
  }
  return 31 - ((modMonth % 7) % 2);
}

// The ISO 8601 forms moment reads: a date, a date with a time, with or without an offset
const ISO_EXTENDED =
  /^\s*([+-]\d{6}|\d{4})-(\d\d)(?:-(\d\d))?(?:[T ](\d\d)(?::(\d\d)(?::(\d\d)(?:[.,](\d+))?)?)?([+-]\d\d(?::?\d\d)?|\s*Z)?)?$/;
const ISO_BASIC =
  /^\s*([+-]\d{6}|\d{4})(\d\d)(\d\d)(?:[T ](\d\d)(?:(\d\d)(?:(\d\d)(?:[.,](\d+))?)?)?([+-]\d\d(?::?\d\d)?|\s*Z)?)?$/;

function fromIso(match: RegExpExecArray): number {
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = match[3] === undefined ? 1 : Number(match[3]);
  const hours = match[4] === undefined ? 0 : Number(match[4]);
  const minutes = match[5] === undefined ? 0 : Number(match[5]);
  const seconds = match[6] === undefined ? 0 : Number(match[6]);
  // moment keeps the first three digits of a fraction, without rounding
  const ms = match[7] === undefined ? 0 : Math.floor(Number(`0.${match[7]}`) * 1000);
  const zone = match[8]?.trim();

  const valid =
    month >= 0 &&
    month < 12 &&
    day >= 1 &&
    day <= daysInMonth(year, month) &&
    hours >= 0 &&
    (hours < 24 || (hours === 24 && minutes === 0 && seconds === 0 && ms === 0)) &&
    minutes < 60 &&
    seconds < 60;
  if (!valid) return NaN;

  if (zone === undefined) return localDate(year, month, day, hours, minutes, seconds, ms).getTime();
  let offset = 0;
  if (zone !== 'Z') {
    const parts = /^([+-])(\d\d):?(\d\d)?$/.exec(zone);
    if (!parts) return NaN;
    offset = (parts[1] === '-' ? -1 : 1) * (Number(parts[2]) * 60 + Number(parts[3] ?? 0));
  }
  const utc = new Date(0);
  utc.setUTCFullYear(year, month, day);
  utc.setUTCHours(hours, minutes, seconds, ms);
  return utc.getTime() - offset * MS_PER_MINUTE;
}

/** What `moment(input).valueOf()` gives: now for nothing, NaN for what it cannot read */
export function toTimestamp(input: unknown): number {
  if (input === undefined) return Date.now();
  if (typeof input === 'number') return input;
  if (input instanceof Date) return input.getTime();
  if (typeof input !== 'string') return NaN;
  const match = ISO_EXTENDED.exec(input) ?? ISO_BASIC.exec(input);
  if (match) return fromIso(match);
  // moment falls back to the Date constructor
  return new Date(input).getTime();
}

/** What `moment(input, 'YYYY').valueOf()` gives: the 1st of January of that year, local time */
export function yearTimestamp(input: string): number {
  const match = /\d{1,4}/.exec(input);
  if (!match) return NaN;
  let year = Number(match[0]);
  if (match[0].length === 2) year += year > 68 ? 1900 : 2000;
  return localDate(year, 0, 1).getTime();
}

type MomentUnit = 'millisecond' | 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year';

const SHORT_UNITS: Record<string, MomentUnit> = {
  ms: 'millisecond',
  s: 'second',
  m: 'minute',
  h: 'hour',
  d: 'day',
  w: 'week',
  M: 'month',
  y: 'year',
};

/** The unit moment understands for one of the short names, or nothing */
function normalizeUnit(unit: string): MomentUnit | undefined {
  return Object.prototype.hasOwnProperty.call(SHORT_UNITS, unit) ? SHORT_UNITS[unit] : undefined;
}

/** `moment(time).startOf(unit).valueOf()`, in the server's time zone */
export function startOf(time: number, unit: string): number {
  const normal = normalizeUnit(unit);
  const date = new Date(time);
  if (normal === undefined || normal === 'millisecond' || Number.isNaN(time)) return time;
  switch (normal) {
    case 'year':
      return localDate(date.getFullYear(), 0, 1).getTime();
    case 'month':
      return localDate(date.getFullYear(), date.getMonth(), 1).getTime();
    case 'week':
      return localDate(date.getFullYear(), date.getMonth(), date.getDate() - date.getDay()).getTime();
    case 'day':
      return localDate(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    case 'hour': {
      const offset = -Math.round(date.getTimezoneOffset());
      return time - mod(time + offset * MS_PER_MINUTE, MS_PER_HOUR);
    }
    case 'minute':
      return time - mod(time, MS_PER_MINUTE);
    case 'second':
      return time - mod(time, MS_PER_SECOND);
  }
}

/**
 * `moment(time).add(count, unit).valueOf()` (or subtract, with a negative sign), in the server's
 * time zone: days and weeks keep the time of day, months and years keep the day where the month
 * has it and take its last day where it does not.
 */
export function addTime(time: number, count: number | string, unit: string, sign: 1 | -1 = 1) {
  const normal = normalizeUnit(unit);
  const amount = Number(count);
  if (normal === undefined || Number.isNaN(time) || Number.isNaN(amount)) return time;
  const date = new Date(time);
  switch (normal) {
    case 'millisecond':
      return time + amount * sign;
    case 'second':
      return time + amount * MS_PER_SECOND * sign;
    case 'minute':
      return time + amount * MS_PER_MINUTE * sign;
    case 'hour':
      return time + amount * MS_PER_HOUR * sign;
    case 'day':
    case 'week': {
      const days = Math.round(amount * (normal === 'week' ? 7 : 1));
      if (!days) return time;
      date.setDate(date.getDate() + days * sign);
      return date.getTime();
    }
    case 'month':
    case 'year': {
      const months = Math.round(amount * (normal === 'year' ? 12 : 1));
      if (!months) return time;
      const target = date.getMonth() + months * sign;
      const day = Math.min(date.getDate(), daysInMonth(date.getFullYear(), target));
      date.setMonth(target, day);
      return date.getTime();
    }
  }
}

const pad = (value: number, length = 2) => String(value).padStart(length, '0');

/** moment's `format('HH:mm[_]YYYYMMDD')`, in the server's time zone */
export function formatGraphiteTime(time: number): string {
  const date = new Date(time);
  return (
    `${pad(date.getHours())}:${pad(date.getMinutes())}_` +
    `${pad(date.getFullYear(), 4)}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
  );
}

/** moment's `format('YYYY')`, in the server's time zone */
export function formatYear(time: number): string {
  return pad(new Date(time).getFullYear(), 4);
}

/** `moment.utc(time).format('YYYY-MM-DD')` */
export function formatUtcDay(time: number): string {
  const date = new Date(time);
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

// --- Intervals in milliseconds (common/lib/to_milliseconds.ts) ----------------------------------

const UNIT_MAPPINGS: Array<[string, number, string[]]> = [
  ['millisecond', 1, ['ms', 'milliseconds', 'millisecond']],
  ['second', MS_PER_SECOND, ['s', 'seconds', 'second', 'sec']],
  ['minute', MS_PER_MINUTE, ['m', 'minutes', 'minute', 'min']],
  ['hour', MS_PER_HOUR, ['h', 'hours', 'hour']],
  ['day', MS_PER_DAY, ['d', 'days', 'day']],
  ['week', 7 * MS_PER_DAY, ['w', 'weeks', 'week']],
  ['month', MS_PER_MONTH, ['M', 'months', 'month']],
  ['quarter', 3 * MS_PER_MONTH, ['quarter']],
  ['year', 12 * MS_PER_MONTH, ['y', 'years', 'year']],
];

const UNIT_VALUES: Record<string, number> = {};
for (const [normal, value, units] of UNIT_MAPPINGS) {
  for (const unit of [normal, ...units]) UNIT_VALUES[unit] = value;
}

const TO_MS_RE = new RegExp('^(\\d+(?:\\.\\d*)?)?\\s*(' + Object.keys(UNIT_VALUES).join('|') + ')$');

export function toMS(expr: string): number | undefined {
  const match = expr.match(TO_MS_RE);
  if (match) {
    if (match[2] === 'M' && match[1] !== '1') {
      throw new Error('Invalid interval. 1M is only valid monthly interval.');
    }
    return parseFloat(match[1] || '1') * UNIT_VALUES[match[2]];
  }
  return undefined;
}

// --- The interval of "auto" (common/lib/calculate_interval.ts) ----------------------------------

function roundInterval(interval: number) {
  switch (true) {
    case interval <= 500: // <= 0.5s
      return '100ms';
    case interval <= 5000: // <= 5s
      return '1s';
    case interval <= 7500: // <= 7.5s
      return '5s';
    case interval <= 15000: // <= 15s
      return '10s';
    case interval <= 45000: // <= 45s
      return '30s';
    case interval <= 180000: // <= 3m
      return '1m';
    case interval <= 450000: // <= 9m
      return '5m';
    case interval <= 1200000: // <= 20m
      return '10m';
    case interval <= 2700000: // <= 45m
      return '30m';
    case interval <= 7200000: // <= 2h
      return '1h';
    case interval <= 21600000: // <= 6h
      return '3h';
    case interval <= 86400000: // <= 24h
      return '12h';
    case interval <= 604800000: // <= 1w
      return '24h';
    case interval <= 1814400000: // <= 3w
      return '1w';
    case interval < 3628800000: // <  2y
      return '30d';
    default:
      return '1y';
  }
}

export function calculateInterval(
  from: number,
  to: number,
  size: number,
  interval: string,
  min: string
) {
  if (interval !== 'auto') {
    return interval;
  }

  const dateMathInterval: string = roundInterval((to - from) / size);
  const dateMathIntervalMs = toMS(dateMathInterval);
  const minMs = toMS(min);

  if (dateMathIntervalMs !== undefined && minMs !== undefined && dateMathIntervalMs < minMs) {
    return min;
  }

  return dateMathInterval;
}

// --- Fixed or calendar intervals of a date histogram (data plugin's date_interval_utils) --------

const INTERVAL_TYPES: Record<string, 'fixed' | 'mixed' | 'calendar'> = {
  y: 'calendar',
  M: 'calendar',
  w: 'calendar',
  d: 'mixed',
  h: 'mixed',
  m: 'mixed',
  s: 'fixed',
  ms: 'fixed',
};

const OPENSEARCH_INTERVAL_STRING_REGEX = new RegExp(
  '^([1-9][0-9]*)\\s*(' + Object.keys(INTERVAL_TYPES).join('|') + ')$'
);

export class InvalidOpenSearchIntervalFormatError extends Error {
  constructor(public readonly interval: string) {
    super(`Invalid interval format: ${interval}`);
    this.name = 'InvalidOpenSearchIntervalFormatError';
  }
}

export class InvalidOpenSearchCalendarIntervalError extends Error {
  constructor(public readonly interval: string) {
    super(`Invalid calendar interval: ${interval}, value must be 1`);
    this.name = 'InvalidOpenSearchCalendarIntervalError';
  }
}

export function parseOpenSearchInterval(interval: string) {
  const matches = String(interval).trim().match(OPENSEARCH_INTERVAL_STRING_REGEX);
  if (!matches) throw new InvalidOpenSearchIntervalFormatError(interval);
  const value = parseFloat(matches[1]);
  const unit = matches[2];
  const type = INTERVAL_TYPES[unit];
  if (type === 'calendar' && value !== 1) throw new InvalidOpenSearchCalendarIntervalError(interval);
  return {
    value,
    unit,
    type: (type === 'mixed' && value === 1) || type === 'calendar' ? 'calendar' : 'fixed',
  };
}

export function dateHistogramInterval(
  interval: string
): { fixed_interval: string } | { calendar_interval: string } {
  const { type } = parseOpenSearchInterval(interval);
  return type === 'calendar' ? { calendar_interval: interval } : { fixed_interval: interval };
}

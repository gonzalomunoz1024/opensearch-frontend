/* SPDX-License-Identifier: Apache-2.0 */

/*
 * What the original's date picker (the super date picker of OUI 1.24.2, as OpenSearch Dashboards
 * 3.9.0 uses it in its query bar) reads and writes: the three kinds of date, a relative date taken
 * apart and put back together, how a range is named ("Last 15 minutes", "~ 7 days ago"), when a
 * range cannot be applied, the parts of its quick select and its steps back and forth, the ranges it
 * remembers, and the month its calendar draws, in the product's time zone.
 */

import { addUnits, formatDate, parseDateMath, timeZoneOffset, type TimeRange } from './dates';

export type RelativeUnit = 's' | 'm' | 'h' | 'd' | 'w' | 'M' | 'y';

export const TIME_UNITS: Record<RelativeUnit, string> = {
  s: 'second',
  m: 'minute',
  h: 'hour',
  d: 'day',
  w: 'week',
  M: 'month',
  y: 'year',
};

export const TIME_UNITS_PLURAL: Record<RelativeUnit, string> = {
  s: 'seconds',
  m: 'minutes',
  h: 'hours',
  d: 'days',
  w: 'weeks',
  M: 'months',
  y: 'years',
};

const UNIT_KEYS: RelativeUnit[] = ['s', 'm', 'h', 'd', 'w', 'M', 'y'];
const UNITS_LARGEST_FIRST: RelativeUnit[] = ['y', 'M', 'w', 'd', 'h', 'm', 's'];

export function isRelativeUnit(value: string): value is RelativeUnit {
  return (UNIT_KEYS as string[]).includes(value);
}

/** The units of the relative tab: a "+" after the unit is a date to come */
export const RELATIVE_OPTIONS: Array<{ value: string; text: string }> = [
  { value: 's', text: 'Seconds ago' },
  { value: 'm', text: 'Minutes ago' },
  { value: 'h', text: 'Hours ago' },
  { value: 'd', text: 'Days ago' },
  { value: 'w', text: 'Weeks ago' },
  { value: 'M', text: 'Months ago' },
  { value: 'y', text: 'Years ago' },
  { value: 's+', text: 'Seconds from now' },
  { value: 'm+', text: 'Minutes from now' },
  { value: 'h+', text: 'Hours from now' },
  { value: 'd+', text: 'Days from now' },
  { value: 'w+', text: 'Weeks from now' },
  { value: 'M+', text: 'Months from now' },
  { value: 'y+', text: 'Years from now' },
];

/** A range of the `timepicker:quickRanges` setting */
export interface QuickRange {
  from: string;
  to: string;
  display: string;
}

/** The component library's own ranges, which it names a range it applied after */
export const COMMON_DURATION_RANGES: QuickRange[] = [
  { from: 'now/d', to: 'now/d', display: 'Today' },
  { from: 'now/w', to: 'now/w', display: 'This week' },
  { from: 'now/M', to: 'now/M', display: 'This month' },
  { from: 'now/y', to: 'now/y', display: 'This year' },
  { from: 'now-1d/d', to: 'now-1d/d', display: 'Yesterday' },
  { from: 'now/w', to: 'now', display: 'Week to date' },
  { from: 'now/M', to: 'now', display: 'Month to date' },
  { from: 'now/y', to: 'now', display: 'Year to date' },
];

/** What dates are read against: the present, the product's zone and the first day of its week */
export interface DateContext {
  now?: Date;
  timeZone?: string;
  weekStart?: number;
}

// --- The kinds of date ---------------------------------------------------------------------------

export type DateMode = 'absolute' | 'relative' | 'now';

export function getDateMode(value: string): DateMode {
  if (value === 'now') return 'now';
  if (value.includes('now')) return 'relative';
  return 'absolute';
}

/**
 * Whether a date that is not "now" starts with a day the calendar does not have ("2026-02-30"),
 * which the browser moves on to the next month and the original's date math calls invalid
 */
function invalidBase(value: string): boolean {
  if (value.startsWith('now')) return false;
  const base = value.split('||')[0];
  if (/^\d+$/.test(base)) return false;
  const day = /^(\d{4})-(\d{2})-(\d{2})/.exec(base);
  if (day && (Number(day[2]) < 1 || Number(day[2]) > 12 || Number(day[3]) > daysInMonth(Number(day[1]), Number(day[2]) - 1))) {
    return true;
  }
  return Number.isNaN(new Date(base).getTime());
}

/** A date of the date math of the product, as the original's date math reads it */
function parse(value: string, roundUp: boolean, context: DateContext): Date | undefined {
  if (invalidBase(value)) return undefined;
  return parseDateMath(value, { roundUp, now: context.now, weekStart: context.weekStart });
}

/** The moment one end of a range is, read as the original's date math reads it; none when it is no date */
export function dateOf(value: string, roundUp = false, context: DateContext = {}): Date | undefined {
  return parse(value, roundUp, context);
}

/**
 * Whether a range stands as it is, as the original's validateTimeRange has it: both of its ends
 * are dates of the date math. One that does not is searched and shown as the default range.
 */
export function isValidTimeRange(time: unknown, context: DateContext = {}): time is TimeRange {
  if (typeof time !== 'object' || time === null) return false;
  const { from, to } = time as { from?: unknown; to?: unknown };
  if (typeof from !== 'string' || typeof to !== 'string') return false;
  return dateOf(from, false, context) !== undefined && dateOf(to, false, context) !== undefined;
}

/** How long a number of milliseconds is in a unit, the way a moment duration counts it */
function durationAs(ms: number, unit: RelativeUnit): number {
  const days = ms / 864e5;
  switch (unit) {
    case 'y':
      return (days * 4800) / 146097 / 12;
    case 'M':
      return (days * 4800) / 146097;
    case 'w':
      return ms / 6048e5;
    case 'd':
      return days;
    case 'h':
      return ms / 36e5;
    case 'm':
      return ms / 6e4;
    default:
      return ms / 1000;
  }
}

export interface RelativeParts {
  count: number;
  /** The unit, with a "+" after it for a date to come */
  unit: string;
  round: boolean;
  roundUnit?: RelativeUnit;
}

const RELATIVE_PARTS = /now(([-+])([0-9]+)([smhdwMy])(\/[smhdwMy])?)?/;

/**
 * A relative date taken apart. What is not of the form "now-15m" or "now+2h/h" is measured from
 * the present and given in the largest unit it is more than one of, unrounded, as the original
 * does: an absolute date seven days back is "1 week ago".
 */
export function parseRelativeParts(value: string, context: DateContext = {}): RelativeParts {
  const matches = typeof value === 'string' ? RELATIVE_PARTS.exec(value) : null;
  const operator = matches?.[2];
  const count = matches?.[3];
  const unit = matches?.[4];
  const roundBy = matches?.[5];
  if (count && unit) {
    const roundUnit = roundBy ? roundBy.slice(1) : undefined;
    return {
      count: parseInt(count, 10),
      unit: operator === '+' ? `${unit}+` : unit,
      round: Boolean(roundBy),
      ...(roundUnit && isRelativeUnit(roundUnit) ? { roundUnit } : {}),
    };
  }
  const results: RelativeParts = { count: 0, unit: 's', round: false };
  const now = context.now ?? new Date();
  const date = parse(value, false, { ...context, now });
  const duration = date ? now.getTime() - date.getTime() : 0;
  let operatorOfUnit = '';
  for (const largest of UNITS_LARGEST_FIRST) {
    const asRelative = durationAs(duration, largest);
    if (asRelative < 0) operatorOfUnit = '+';
    if (Math.abs(asRelative) > 1) {
      results.count = Math.round(Math.abs(asRelative));
      results.unit = `${largest}${operatorOfUnit}`;
      results.round = false;
      break;
    }
  }
  return results;
}

/** A relative date put back together: "now" for nothing, rounded to its own unit when asked */
export function toRelativeStringFromParts(parts: Partial<RelativeParts>): string {
  const count = parts.count ?? 0;
  const isRounded = parts.round ?? false;
  if (count === 0 && !isRounded) return 'now';
  const matches = /([smhdwMy])(\+)?/.exec(parts.unit ?? 's');
  const unit = matches?.[1] ?? 's';
  const operator = matches?.[2] ?? '-';
  return `now${operator}${count}${unit}${isRounded ? `/${unit}` : ''}`;
}

/** A date as the ISO string of the moment it is, or as it is when it is not one */
export function toAbsoluteString(value: string, roundUp = false, context: DateContext = {}): string {
  const date = parse(value, roundUp, context);
  return date ? date.toISOString() : value;
}

export function toRelativeString(value: string, context: DateContext = {}): string {
  return toRelativeStringFromParts(parseRelativeParts(value, context));
}

// --- How a date and a range are written ----------------------------------------------------------

/** The month a moment falls in on the clock of a zone, counted from the year 0 */
function monthOnClock(date: Date, timeZone?: string): number {
  let parts: ZonedParts;
  try {
    parts = zonedParts(date, timeZone);
  } catch {
    // A zone the browser does not know: its own clock, which the date math then counts on too
    parts = zonedParts(date);
  }
  return parts.year * 12 + parts.month;
}

/**
 * The months between two dates and the milliseconds left over, the first no later than the
 * second, as moment counts them: months of the clock of the zone its dates are in
 */
function monthsAndRest(base: Date, other: Date, timeZone?: string): { months: number; ms: number } {
  let months = monthOnClock(other, timeZone) - monthOnClock(base, timeZone);
  if (addUnits(base, months, 'M').getTime() > other.getTime()) months -= 1;
  return { months, ms: other.getTime() - addUnits(base, months, 'M').getTime() };
}

/**
 * How long ago a date was, or how far ahead it is, in the words of moment's English `fromNow`;
 * the months are counted on the clock of the zone given (the product's), else the browser's
 */
export function fromNow(date: Date, now: Date = new Date(), timeZone?: string): string {
  const future = now.getTime() < date.getTime();
  const { months, ms } = future ? monthsAndRest(now, date, timeZone) : monthsAndRest(date, now, timeZone);
  const wholeDays = Math.round((months * 146097) / 4800);
  const seconds = Math.round(wholeDays * 86400 + ms / 1000);
  const minutes = Math.round(wholeDays * 1440 + ms / 6e4);
  const hours = Math.round(wholeDays * 24 + ms / 36e5);
  const days = Math.round(wholeDays + ms / 864e5);
  const monthCount = Math.round(months + ((ms / 864e5) * 4800) / 146097);
  const years = Math.round((months + ((ms / 864e5) * 4800) / 146097) / 12);
  let words: string;
  if (seconds <= 44) words = 'a few seconds';
  else if (minutes <= 1) words = 'a minute';
  else if (minutes < 45) words = `${minutes} minutes`;
  else if (hours <= 1) words = 'an hour';
  else if (hours < 22) words = `${hours} hours`;
  else if (days <= 1) words = 'a day';
  else if (days < 26) words = `${days} days`;
  else if (monthCount <= 1) words = 'a month';
  else if (monthCount < 11) words = `${monthCount} months`;
  else if (years <= 1) words = 'a year';
  else words = `${years} years`;
  // A difference of nothing is in the past, as moment has it
  return future ? `in ${words}` : `${words} ago`;
}

const STRICT_ISO =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})(Z|[+-]\d\d(?::?\d\d)?)$/i;

/** Whether a date is written exactly as "YYYY-MM-DDTHH:mm:ss.SSSZ", a real date */
export function isStrictIso(value: string): boolean {
  const match = STRICT_ISO.exec(value);
  if (!match) return false;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false;
  return day >= 1 && day <= daysInMonth(year, month - 1);
}

/**
 * One end of a range as its button writes it: a date written in full in the date format, "now",
 * or roughly ("~ 7 days ago") for the rest; what is not a date is written as it is.
 */
export function formatTimeString(
  value: string,
  dateFormat: string,
  roundUp = false,
  context: DateContext = {}
): string {
  if (isStrictIso(value)) return formatDate(new Date(value), dateFormat, context.timeZone);
  if (value === 'now') return 'now';
  const now = context.now ?? new Date();
  const date = parse(value, roundUp, { ...context, now });
  if (date) return `~ ${fromNow(date, now, context.timeZone)}`;
  // A date that is not one is still a date to the original's date math, an invalid one
  return invalidBase(value) ? '~ Invalid date' : value;
}

function isRelativeToNow(from: string, to: string): boolean {
  const fromMode = getDateMode(from);
  const toMode = getDateMode(to);
  return (fromMode === 'relative' && toMode === 'now') || (fromMode === 'now' && toMode === 'relative');
}

/** What a range is called: its quick range's name, "Last 15 minutes", or its two ends */
export function prettyDuration(
  from: string,
  to: string,
  quickRanges: QuickRange[],
  dateFormat: string,
  context: DateContext = {}
): string {
  const quick = quickRanges.find((range) => range.from === from && range.to === to);
  if (quick?.display) return quick.display;
  if (isRelativeToNow(from, to)) {
    const last = getDateMode(to) === 'now';
    const parts = parseRelativeParts(last ? from : to, context);
    const unit = parts.unit.substring(0, 1);
    const name = isRelativeUnit(unit) ? (parts.count > 1 ? TIME_UNITS_PLURAL : TIME_UNITS)[unit] : unit;
    let text = `${last ? 'Last' : 'Next'} ${parts.count} ${name}`;
    if (parts.round && parts.roundUnit) text += ` rounded to the ${TIME_UNITS[parts.roundUnit]}`;
    return text;
  }
  return `${formatTimeString(from, dateFormat, false, context)} to ${formatTimeString(to, dateFormat, true, context)}`;
}

/** Whether a range is shown by its name rather than by its two dates */
export function showPrettyDuration(from: string, to: string, quickRanges: QuickRange[]): boolean {
  if (quickRanges.some((range) => range.from === from && range.to === to)) return true;
  return isRelativeToNow(from, to);
}

/** A range that cannot be applied: an end that is no date, a start after the end, or now to now */
export function isRangeInvalid(start: string, end: string, context: DateContext = {}): boolean {
  if (start === 'now' && end === 'now') return true;
  const now = context.now ?? new Date();
  const from = parse(start, false, { ...context, now });
  const to = parse(end, true, { ...context, now });
  if (!from || !to) return true;
  return from.getTime() > to.getTime();
}

// --- The quick select ----------------------------------------------------------------------------

export type TimeTense = 'last' | 'next';

export interface QuickSelect {
  timeTense: TimeTense;
  timeValue: number;
  timeUnits: RelativeUnit;
}

/** What the quick select starts with for a range: its relative end taken apart, or the last 15 minutes */
export function parseTimeParts(start: string, end: string, context: DateContext = {}): QuickSelect {
  const results: QuickSelect = { timeTense: 'last', timeUnits: 'm', timeValue: 15 };
  const value = start === 'now' ? end : start;
  const matches = typeof value === 'string' ? /now(([-+])(\d+)([smhdwMy])(\/[smhdwMy])?)?/.exec(value) : null;
  if (!matches) return results;
  const [, , operator, count, unit] = matches;
  if (count && unit && operator && isRelativeUnit(unit)) {
    return { timeTense: operator === '+' ? 'next' : 'last', timeUnits: unit, timeValue: parseInt(count, 10) };
  }
  const now = context.now ?? new Date();
  const date = parse(value, false, { ...context, now });
  const duration = date ? now.getTime() - date.getTime() : 0;
  let operatorOfUnit = '';
  for (const largest of UNITS_LARGEST_FIRST) {
    const asRelative = durationAs(duration, largest);
    if (asRelative < 0) operatorOfUnit = '+';
    if (Math.abs(asRelative) > 1) {
      return {
        timeValue: Math.round(Math.abs(asRelative)),
        timeUnits: largest,
        timeTense: operatorOfUnit === '+' ? 'next' : 'last',
      };
    }
  }
  return results;
}

/** The range the quick select's Apply applies */
export function quickSelectRange({ timeTense, timeValue, timeUnits }: QuickSelect): TimeRange {
  return timeTense === 'next'
    ? { from: 'now', to: `now+${timeValue}${timeUnits}` }
    : { from: `now-${timeValue}${timeUnits}`, to: 'now' };
}

/**
 * The window of the same length just before or just after a range, as absolute dates: the
 * quick select's arrows. A range that is no date is the last 15 minutes.
 */
export function stepRange(start: string, end: string, direction: 1 | -1, context: DateContext = {}): TimeRange {
  const now = context.now ?? new Date();
  const min = parse(start, false, { ...context, now }) ?? new Date(now.getTime() - 15 * 60000);
  const max = parse(end, true, { ...context, now }) ?? now;
  const diff = max.getTime() - min.getTime();
  return direction === 1
    ? { from: new Date(max.getTime() + 1).toISOString(), to: new Date(max.getTime() + diff + 1).toISOString() }
    : { from: new Date(min.getTime() - diff - 1).toISOString(), to: new Date(min.getTime() - 1).toISOString() };
}

/** The ranges the picker remembers, the newest first, each once, ten at most */
export function addToTimeHistory(history: TimeRange[], range: TimeRange, max = 10): TimeRange[] {
  if (!range.from || !range.to) return history;
  return [
    { from: range.from, to: range.to },
    ...history.filter((item) => !(item.from === range.from && item.to === range.to)),
  ].slice(0, max);
}

// --- The calendar, in the product's time zone ----------------------------------------------------

export interface ZonedParts {
  year: number;
  /** 0 for January */
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  ms: number;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/** The day of the week of a day of the calendar, 0 for Sunday */
export function weekdayOf(year: number, month: number, day: number): number {
  const date = new Date(Date.UTC(2000, month, day));
  date.setUTCFullYear(year, month, day);
  return date.getUTCDay();
}

/** A moment as the fields of a clock in a zone (the browser's own when none is named) */
export function zonedParts(date: Date, timeZone?: string): ZonedParts {
  const [year, month, day, hour, minute, second, ms] = formatDate(date, 'YYYY M D H m s SSS', timeZone)
    .split(' ')
    .map(Number);
  return { year, month: month - 1, day, hour, minute, second, ms };
}

/** The moment a clock in a zone shows the fields; `undefined` for a day the month does not have */
export function fromZonedParts(parts: ZonedParts, timeZone?: string): Date | undefined {
  const { year, month, day, hour, minute, second, ms } = parts;
  if (month < 0 || month > 11 || day < 1 || day > daysInMonth(year, month)) return undefined;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59 || ms < 0 || ms > 999) {
    return undefined;
  }
  if (!timeZone) {
    const local = new Date(2000, 0, 1, hour, minute, second, ms);
    local.setFullYear(year, month, day);
    return local;
  }
  const asUtc = new Date(Date.UTC(2000, 0, 1, hour, minute, second, ms));
  asUtc.setUTCFullYear(year, month, day);
  const guess = asUtc.getTime();
  const first = timeZoneOffset(guess, timeZone);
  let time = guess - first * 60000;
  const second2 = timeZoneOffset(time, timeZone);
  if (second2 !== first) time = guess - second2 * 60000;
  return new Date(time);
}

export interface CalendarDay {
  year: number;
  month: number;
  day: number;
  weekday: number;
}

/** The weeks a month's page shows: from the week of its first day to that of its last */
export function calendarWeeks(year: number, month: number, weekStart = 0): CalendarDay[][] {
  const shift = (weekdayOf(year, month, 1) - weekStart + 7) % 7;
  const start = new Date(Date.UTC(2000, 0, 1));
  start.setUTCFullYear(year, month, 1 - shift);
  const weeks: CalendarDay[][] = [];
  const cursor = new Date(start.getTime());
  const inMonth = (date: Date) => date.getUTCFullYear() === year && date.getUTCMonth() === month;
  for (;;) {
    const week: CalendarDay[] = [];
    for (let index = 0; index < 7; index += 1) {
      week.push({
        year: cursor.getUTCFullYear(),
        month: cursor.getUTCMonth(),
        day: cursor.getUTCDate(),
        weekday: cursor.getUTCDay(),
      });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    weeks.push(week);
    // The next week is drawn while one of its days is of the month
    const end = new Date(cursor.getTime());
    end.setUTCDate(end.getUTCDate() + 6);
    if (!inMonth(cursor) && !inMonth(end)) break;
  }
  return weeks;
}

/** A day moved by a number of days, weeks, months or years, the day kept within its month */
export function shiftDay(day: ZonedParts, amount: number, unit: 'd' | 'w' | 'M' | 'y'): ZonedParts {
  if (unit === 'd' || unit === 'w') {
    const date = new Date(Date.UTC(2000, 0, 1));
    date.setUTCFullYear(day.year, day.month, day.day + amount * (unit === 'w' ? 7 : 1));
    return { ...day, year: date.getUTCFullYear(), month: date.getUTCMonth(), day: date.getUTCDate() };
  }
  const months = day.year * 12 + day.month + amount * (unit === 'y' ? 12 : 1);
  const year = Math.floor(months / 12);
  const month = months - year * 12;
  return { ...day, year, month, day: Math.min(day.day, daysInMonth(year, month)) };
}

const MONTH_NAMES = [
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
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const monthName = (month: number) => MONTH_NAMES[month] ?? '';
/** The two letters a column of the calendar is headed with */
export const weekdayMin = (weekday: number) => (DAY_NAMES[weekday] ?? '').slice(0, 2);

// --- A date typed in the date format -------------------------------------------------------------

const PARSE_TOKENS =
  /\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|Do|DD|D|dddd|ddd|HH|H|hh|h|mm|m|ss|s|SSS|SS|S|A|a|ZZ|Z|X|x/g;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** What each token of the format reads when it is read strictly, as moment does */
const TOKEN_PATTERNS: Record<string, string> = {
  YYYY: '\\d{4}',
  YY: '\\d\\d',
  MMMM: MONTH_NAMES.join('|'),
  MMM: MONTH_NAMES.map((name) => name.slice(0, 3)).join('|'),
  MM: '\\d\\d',
  M: '\\d\\d?',
  Do: '\\d\\d?(?:st|nd|rd|th)',
  DD: '\\d\\d',
  D: '\\d\\d?',
  dddd: DAY_NAMES.join('|'),
  ddd: DAY_NAMES.map((name) => name.slice(0, 3)).join('|'),
  HH: '\\d\\d',
  H: '\\d\\d?',
  hh: '\\d\\d',
  h: '\\d\\d?',
  mm: '\\d\\d',
  m: '\\d\\d?',
  ss: '\\d\\d',
  s: '\\d\\d?',
  SSS: '\\d{3}',
  SS: '\\d\\d',
  S: '\\d',
  A: '[ap]\\.?m?\\.?',
  a: '[ap]\\.?m?\\.?',
  ZZ: 'Z|[+-]\\d\\d(?::?\\d\\d)?',
  Z: 'Z|[+-]\\d\\d(?::?\\d\\d)?',
  X: '[+-]?\\d+(?:\\.\\d{1,3})?',
  x: '[+-]?\\d+',
};

/**
 * A date typed in the date format, read strictly as the original's absolute tab reads it: the
 * whole text in the format and a real date, read on the clock of the product's zone. `undefined`
 * otherwise.
 */
export function parseFormattedDate(
  text: string,
  format: string,
  timeZone?: string,
  now: Date = new Date()
): Date | undefined {
  const tokens: string[] = [];
  let pattern = '';
  let last = 0;
  for (const match of format.matchAll(PARSE_TOKENS)) {
    const index = match.index ?? 0;
    pattern += escapeRegExp(format.slice(last, index));
    if (match[1] !== undefined) {
      pattern += escapeRegExp(match[1]);
    } else {
      tokens.push(match[0]);
      pattern += `(${TOKEN_PATTERNS[match[0]]})`;
    }
    last = index + match[0].length;
  }
  pattern += escapeRegExp(format.slice(last));
  const found = new RegExp(`^${pattern}$`, 'i').exec(text);
  if (!found) return undefined;

  const today = zonedParts(now, timeZone);
  let year: number | undefined;
  let month: number | undefined;
  let day: number | undefined;
  let hour = 0;
  let minute = 0;
  let second = 0;
  let ms = 0;
  let pm: boolean | undefined;
  let offset: number | undefined;
  let weekday: number | undefined;
  const lower = (name: string) => name.toLowerCase();
  for (const [index, token] of tokens.entries()) {
    const value = found[index + 1];
    switch (token) {
      case 'X':
        return new Date(Math.round(parseFloat(value) * 1000));
      case 'x':
        return new Date(parseInt(value, 10));
      case 'YYYY':
        year = Number(value);
        break;
      case 'YY':
        year = Number(value) + (Number(value) > 68 ? 1900 : 2000);
        break;
      case 'MMMM':
        month = MONTH_NAMES.findIndex((name) => lower(name) === lower(value));
        break;
      case 'MMM':
        month = MONTH_NAMES.findIndex((name) => lower(name.slice(0, 3)) === lower(value));
        break;
      case 'MM':
      case 'M':
        month = Number(value) - 1;
        break;
      case 'Do':
        day = parseInt(value, 10);
        break;
      case 'DD':
      case 'D':
        day = Number(value);
        break;
      case 'dddd':
        weekday = DAY_NAMES.findIndex((name) => lower(name) === lower(value));
        break;
      case 'ddd':
        weekday = DAY_NAMES.findIndex((name) => lower(name.slice(0, 3)) === lower(value));
        break;
      case 'HH':
      case 'H':
      case 'hh':
      case 'h':
        hour = Number(value);
        break;
      case 'mm':
      case 'm':
        minute = Number(value);
        break;
      case 'ss':
      case 's':
        second = Number(value);
        break;
      case 'SSS':
        ms = Number(value);
        break;
      case 'SS':
        ms = Number(value) * 10;
        break;
      case 'S':
        ms = Number(value) * 100;
        break;
      case 'A':
      case 'a':
        pm = lower(value).startsWith('p');
        break;
      case 'ZZ':
      case 'Z': {
        if (lower(value) === 'z') {
          offset = 0;
        } else {
          const digits = value.replace(':', '');
          const minutes = Number(digits.slice(1, 3)) * 60 + Number(digits.slice(3, 5) || '0');
          offset = digits[0] === '-' ? -minutes : minutes;
        }
        break;
      }
      default:
    }
  }
  if (pm !== undefined) {
    if (hour < 1 || hour > 12) return undefined;
    hour = (hour % 12) + (pm ? 12 : 0);
  }
  // What the format leaves out is today's up to the first field it has, and the start of the rest
  let parts: ZonedParts = {
    year: year ?? today.year,
    month: month ?? (year === undefined ? today.month : 0),
    day: day ?? (month === undefined && year === undefined ? today.day : 1),
    hour,
    minute,
    second,
    ms,
  };
  if (parts.month < 0 || parts.month > 11 || parts.day < 1 || parts.day > daysInMonth(parts.year, parts.month)) {
    return undefined;
  }
  // Midnight may be written as the 24th hour of the day before, as moment allows
  if (hour === 24 && minute === 0 && second === 0 && ms === 0) {
    parts = { ...shiftDay(parts, 1, 'd'), hour: 0 };
  }
  if (offset !== undefined) {
    const utc = fromZonedParts(parts, 'UTC');
    return utc ? new Date(utc.getTime() - offset * 60000) : undefined;
  }
  const date = fromZonedParts(parts, timeZone);
  if (!date) return undefined;
  if (weekday !== undefined && weekdayOf(parts.year, parts.month, parts.day) !== weekday) return undefined;
  return date;
}

/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Dates: the relative expressions of the time picker ("now-15m", "now/d"), formatting with the
 * tokens the date settings of OpenSearch Dashboards use ("MMM D, YYYY @ HH:mm:ss.SSS"), and the
 * interval a histogram over a time range gets.
 */

import { ZONE_NAME_MAPS, ZONE_NAME_TABLES } from './zone_names';

export type TimeUnit ='ms' | 's' | 'm' | 'h' | 'd' | 'w' | 'M' | 'y';

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

let clockZone: string | undefined;

/**
 * The zone on whose clock date math counts ("now/d" is the start of the day there): the one the
 * setting dateFormat:tz names, or the browser's own when it names none, or one the browser does
 * not know. The services set it when the settings load and when they change, as OpenSearch
 * Dashboards makes the zone of that setting the default of its dates.
 */
export function setDefaultTimeZone(timeZone: string | undefined): void {
  clockZone = undefined;
  if (!timeZone || timeZone === 'Browser') return;
  try {
    timeZoneOffset(0, timeZone);
    clockZone = timeZone;
  } catch {
    // no zone of that name: the clock of the browser
  }
}

// The minutes east of UTC a moment made on the clock of a named zone is counted with there. The
// original keeps the offset it found the moment by, which after a move into an hour the clocks
// skip is not the zone's own at that moment, and counts on from it
const countedWith = new WeakMap<Date, number>();

/**
 * A moment moved on the clock of a named zone. The clock is a date whose UTC fields are what the
 * zone shows. After the move the moment is found as the original's moment-timezone finds it, by
 * the offset the zone has where the new reading falls under the offset the moment had, so that a
 * reading the clocks of the zone skip or show twice gives the moment the original gives.
 */
function onClock(date: Date, timeZone: string, move: (clock: Date) => void): Date {
  if (Number.isNaN(date.getTime())) return new Date(Number.NaN);
  const offset = countedWith.get(date) ?? timeZoneOffset(date.getTime(), timeZone);
  const clock = new Date(date.getTime() + offset * UNIT_MS.m);
  move(clock);
  const under = new Date(clock.getTime() - offset * UNIT_MS.m);
  // Further than a date reaches: no date, as on the clock of the browser
  if (Number.isNaN(under.getTime())) return under;
  const found = timeZoneOffset(under.getTime(), timeZone);
  const moved = new Date(clock.getTime() - found * UNIT_MS.m);
  countedWith.set(moved, found);
  return moved;
}

function addOnClock(clock: Date, amount: number, unit: TimeUnit): void {
  switch (unit) {
    case 'y':
    case 'M': {
      const month = clock.getUTCMonth() + (unit === 'y' ? amount * 12 : amount);
      const last = new Date(clock.getTime());
      last.setUTCMonth(month + 1, 0);
      clock.setUTCMonth(month, Math.min(clock.getUTCDate(), last.getUTCDate()));
      break;
    }
    case 'w':
      clock.setUTCDate(clock.getUTCDate() + amount * 7);
      break;
    case 'd':
      clock.setUTCDate(clock.getUTCDate() + amount);
      break;
    default:
      clock.setTime(clock.getTime() + amount * UNIT_MS[unit]);
  }
}

function startOnClock(clock: Date, unit: TimeUnit, weekStart: number): void {
  switch (unit) {
    case 'y':
      clock.setUTCMonth(0, 1);
      clock.setUTCHours(0, 0, 0, 0);
      break;
    case 'M':
      clock.setUTCDate(1);
      clock.setUTCHours(0, 0, 0, 0);
      break;
    case 'w':
      clock.setUTCDate(clock.getUTCDate() - ((clock.getUTCDay() - weekStart + 7) % 7));
      clock.setUTCHours(0, 0, 0, 0);
      break;
    case 'd':
      clock.setUTCHours(0, 0, 0, 0);
      break;
    case 'h':
      clock.setUTCMinutes(0, 0, 0);
      break;
    case 'm':
      clock.setUTCSeconds(0, 0);
      break;
    case 's':
      clock.setUTCMilliseconds(0);
      break;
    default:
  }
}

export function addUnits(date: Date, amount: number, unit: TimeUnit): Date {
  const result = new Date(date.getTime());
  // Nothing to add leaves the moment alone: setting the date it has would move a moment in the
  // hour that repeats when clocks go back to the first pass of that hour
  if (amount === 0) return result;
  // Days and longer are counted on the clock: that of the zone the settings name, when they do
  if (clockZone && UNIT_MS[unit] >= UNIT_MS.d) {
    return onClock(date, clockZone, (clock) => addOnClock(clock, amount, unit));
  }
  switch (unit) {
    // A year is twelve months, as the original counts it: a year from 29 February is 28 February
    case 'y':
    case 'M': {
      const day = result.getDate();
      result.setDate(1);
      result.setMonth(result.getMonth() + (unit === 'y' ? amount * 12 : amount));
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
  if (clockZone) return onClock(date, clockZone, (clock) => startOnClock(clock, unit, weekStart));
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
    case 'm':
    case 's': {
      // Counted from the moment by the clock's offset then, as the original does: setting the
      // minutes of a moment in the hour that repeats when clocks go back lands in its first pass
      const size = UNIT_MS[unit];
      const local = result.getTime() - result.getTimezoneOffset() * 60000;
      result.setTime(result.getTime() - (((local % size) + size) % size));
      break;
    }
    default:
  }
  return result;
}

export function endOf(date: Date, unit: TimeUnit, weekStart = 0): Date {
  if (unit === 'ms') return new Date(date.getTime());
  if (clockZone) {
    // In one move, as the original makes it: the last reading before the next unit starts
    return onClock(date, clockZone, (clock) => {
      startOnClock(clock, unit, weekStart);
      addOnClock(clock, 1, unit);
      clock.setTime(clock.getTime() - 1);
    });
  }
  return new Date(addUnits(startOf(date, unit, weekStart), 1, unit).getTime() - 1);
}

export interface DateMathOptions {
  /** A rounded expression ("now/d") ends its unit instead of starting it: the end of a range */
  roundUp?: boolean;
  /** What "now" is; the present when left out */
  now?: Date;
  weekStart?: number;
}

const DATE_MATH_UNITS = ['y', 'M', 'w', 'd', 'h', 'm', 's', 'ms'];

// What the original's scan of an amount takes for a digit: whatever is not "not a number" as a
// number, which a space is too, and the end of the text
const countsAsDigit = (char: string) => !Number.isNaN(Number(char));

/**
 * The date of an expression: "now", "now-15m", "now-1d/d", or a date with the same arithmetic
 * after "||" ("2026-01-01||+1M/d"). `undefined` when it is not one.
 *
 * Read as the original's date math reads it (its `parse` and `parseDateMath`, on moment), step
 * for step: the text is taken as it is, spaces included; what does not start with "now" is a
 * date as moment reads one (an ISO 8601 form, on the clock of the settings' zone when it names
 * no offset, or RFC 2822, or else what the browser's Date makes of it), so digits alone are a
 * date only where they are an ISO form ("2026", "20261123"); an amount is scanned as there
 * ("now/1d" rounds, "now- 1d" and "now-1 d" take a day off, "now-1d " is no expression).
 */
export function parseDateMath(text: string, options: DateMathOptions = {}): Date | undefined {
  if (typeof text !== 'string' || text === '') return undefined;
  let date: Date;
  let math: string;
  if (text.substring(0, 3) === 'now') {
    date = new Date((options.now ?? new Date()).getTime());
    math = text.substring(3);
  } else {
    const split = text.indexOf('||');
    const base = split === -1 ? text : text.substring(0, split);
    math = split === -1 ? '' : text.substring(split + 2);
    const read = readMoment(base, clockZone, (options.now ?? new Date()).getTime());
    if (!read) return undefined;
    date = read;
  }

  const length = math.length;
  let at = 0;
  while (at < length) {
    const sign = math.charAt(at);
    at += 1;
    if (sign !== '/' && sign !== '+' && sign !== '-') return undefined;

    let amount: number;
    if (!countsAsDigit(math.charAt(at))) {
      amount = 1;
    } else if (length === 2) {
      // One sign and one digit: the original takes the digit for the unit as well
      return undefined;
    } else {
      const from = at;
      while (countsAsDigit(math.charAt(at))) {
        at += 1;
        if (at >= length) return undefined;
      }
      amount = parseInt(math.substring(from, at), 10);
    }
    // Rounding is to one whole unit
    if (sign === '/' && amount !== 1) return undefined;

    let unit = math.charAt(at);
    at += 1;
    while (at < length && /[a-z]/i.test(math.charAt(at))) {
      unit += math.charAt(at);
      at += 1;
    }
    if (!DATE_MATH_UNITS.includes(unit)) return undefined;

    if (sign === '/') {
      // (to the millisecond there is nothing to round)
      if (unit !== 'ms') {
        date = options.roundUp
          ? endOf(date, unit as TimeUnit, options.weekStart)
          : startOf(date, unit as TimeUnit, options.weekStart);
      }
    } else if (!Number.isNaN(amount)) {
      // (an amount of spaces alone is no number, and moves nothing)
      date = addUnits(date, sign === '+' ? amount : -amount, unit as TimeUnit);
    }
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
      era: 'short',
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
    if (part.type === 'era') fields.era = part.value === 'BC' ? 1 : 0;
    else if (part.type !== 'literal') fields[part.type] = Number(part.value);
  }
  // The years before the year 1 are counted backwards from it; and Date.UTC would read the years
  // 0 to 99 as 1900 to 1999, so the year is set on its own
  const year = fields.era ? 1 - fields.year : fields.year;
  const asUtc = new Date(
    Date.UTC(2000, fields.month - 1, fields.day, fields.hour, fields.minute, fields.second)
  ).setUTCFullYear(year);
  return {
    year,
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

// moment's zeroFill: the digits of a number padded to a length, after its sign or a plus asked for
function zeroFill(value: number, length: number, forceSign = false): string {
  const digits = String(Math.abs(value));
  const sign = value >= 0 ? (forceSign ? '+' : '') : '-';
  return `${sign}${'0'.repeat(Math.max(0, length - digits.length))}${digits}`;
}

// The calendar's days, years and weeks as moment counts them
function calendarDay(year: number, month: number, day: number): Date {
  const date = new Date(0);
  date.setUTCFullYear(year, month, day);
  return date;
}

const daysInYear = (year: number) => ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 366 : 365);

const dayOfYear = (parts: Parts) =>
  Math.round((calendarDay(parts.year, parts.month, parts.day).getTime() - calendarDay(parts.year, 0, 1).getTime()) / UNIT_MS.d) + 1;

// Where the first week of a year starts: the week from day `dow` (0 is Sunday) that holds the
// `doy`-th day before the end of its first week, as moment's firstWeekOffset finds it
function firstWeekOffset(year: number, dow: number, doy: number): number {
  const fwd = 7 + dow - doy;
  return -((7 + calendarDay(year, 0, fwd).getUTCDay() - dow) % 7) + fwd - 1;
}

const weeksInYear = (year: number, dow: number, doy: number) =>
  (daysInYear(year) - firstWeekOffset(year, dow, doy) + firstWeekOffset(year + 1, dow, doy)) / 7;

function weekOfYear(parts: Parts, dow: number, doy: number): { week: number; year: number } {
  const week = Math.floor((dayOfYear(parts) - firstWeekOffset(parts.year, dow, doy) - 1) / 7) + 1;
  if (week < 1) return { week: week + weeksInYear(parts.year - 1, dow, doy), year: parts.year - 1 };
  const weeks = weeksInYear(parts.year, dow, doy);
  return week > weeks ? { week: week - weeks, year: parts.year + 1 } : { week, year: parts.year };
}

// The weeks of moment's English locale start on Sunday, the first one holding 1 January; ISO
// weeks start on Monday, the first one holding 4 January
const LOCALE_WEEK = { dow: 0, doy: 6 };

/**
 * The day the weeks of a written date start on (0 is Sunday): the setting dateFormat:dow, which
 * the services set when the settings load and when they change, as OpenSearch Dashboards makes it
 * the first day of the week of its dates. The week of the year (w, ww, wo), its year (gg, gggg)
 * and the day of the week (e) count from it.
 */
export function setDefaultWeekStart(day: number): void {
  LOCALE_WEEK.dow = Number.isInteger(day) && day >= 0 && day <= 6 ? day : 0;
}

const ISO_WEEK = { dow: 1, doy: 4 };

// The long date formats of moment's English locale, written out before a format is read; each
// lower-case one is its upper-case one with the shorter month, day and weekday
const LONG_DATE_FORMATS: Record<string, string> = {
  LTS: 'h:mm:ss A',
  LT: 'h:mm A',
  L: 'MM/DD/YYYY',
  LL: 'MMMM D, YYYY',
  LLL: 'MMMM D, YYYY h:mm A',
  LLLL: 'dddd, MMMM D, YYYY h:mm A',
  l: 'M/D/YYYY',
  ll: 'MMM D, YYYY',
  lll: 'MMM D, YYYY h:mm A',
  llll: 'ddd, MMM D, YYYY h:mm A',
};

const LONG_DATE_TOKENS = /(\[[^[]*\])|(\\)?(LTS|LT|LL?L?L?|l{1,4})/g;

const zoneNames = new Map<string, Intl.DateTimeFormat>();

// The eras of each zone moment-timezone names: where each starts, and the names of its offsets
type ZoneEras = Array<{ start: number; names: Map<number, string> }>;
let zoneEras: Map<string, ZoneEras> | undefined;

function readZoneEras(): Map<string, ZoneEras> {
  const maps = ZONE_NAME_MAPS.map(
    (map) =>
      new Map(
        map.split(',').map((entry): [number, string] => {
          const at = entry.indexOf(':');
          return [Number(entry.slice(0, at)), entry.slice(at + 1)];
        })
      )
  );
  const zones = new Map<string, ZoneEras>();
  for (const table of ZONE_NAME_TABLES) {
    const [history, names] = table.split('|');
    const eras = history.split(';').map((era) => {
      const at = era.indexOf('@');
      return {
        start: at < 0 ? -Infinity : parseInt(era.slice(0, at), 36) * UNIT_MS.m,
        names: maps[parseInt(era.slice(at + 1), 36)],
      };
    });
    for (const name of names.split(' ')) zones.set(name, eras);
  }
  return zones;
}

/**
 * The short name of a zone at a moment, as moment-timezone names it ("CET", "IST", "-03"): the
 * name its data gives the zone's offset in the era of that moment. A zone it does not know, or an
 * offset its data does not have there, gets the browser's short name ("GMT+1"). None for the
 * browser's own zone, as moment gives none.
 */
function zoneAbbreviation(date: Date, timeZone?: string): string {
  if (!timeZone || timeZone === 'Browser') return '';
  zoneEras ??= readZoneEras();
  const eras = zoneEras.get(timeZone);
  if (eras) {
    const time = date.getTime();
    let index = eras.length - 1;
    while (index > 0 && eras[index].start > time) index -= 1;
    const offset = timeZoneOffset(time, timeZone);
    const name = eras[index].names.get(offset);
    if (name !== undefined) return name;
    // An offset the zone has taken since: by its number when the zone's names are numbers ("+05")
    if ([...eras[index].names.values()].every((known) => /^[+-]\d/.test(known))) {
      const minutes = Math.abs(offset);
      return `${offset < 0 ? '-' : '+'}${pad(Math.floor(minutes / 60))}${minutes % 60 ? pad(minutes % 60) : ''}`;
    }
  }
  let format = zoneNames.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' });
    zoneNames.set(timeZone, format);
  }
  return format.formatToParts(date).find((part) => part.type === 'timeZoneName')?.value ?? '';
}

// moment's tokens: a text in brackets, an escaped letter, the longest token at each place, or
// any other letter, which is written as it is
const TOKENS =
  /(\[[^[]*\])|(\\)?([Hh]mm(ss)?|Mo|MM?M?M?|Do|DDDo|DD?D?D?|ddd?d?|do?|w[o|w]?|W[o|W]?|Qo?|N{1,5}|YYYYYY|YYYYY|YYYY|YY|y{2,4}|yo?|gg(ggg?)?|GG(GGG?)?|e|E|a|A|hh?|HH?|kk?|mm?|ss?|S{1,9}|x|X|zz?|ZZ?|.)/g;

/**
 * A date written with a format of moment's tokens, as the product's date settings and formats
 * name them, in moment's English locale: `[text]` and an escaped letter are written as they are.
 * The zone's abbreviation (z, zz) is moment-timezone's; there is none for the browser's own zone,
 * as moment gives none. Locale weeks start on the day of setDefaultWeekStart.
 */
export function formatDate(date: Date, pattern: string, timeZone?: string): string {
  if (Number.isNaN(date.getTime())) return 'Invalid date';
  const parts = partsOf(date, timeZone);
  const offset = (separator: string) => {
    const minutes = Math.abs(parts.offset);
    return `${parts.offset < 0 ? '-' : '+'}${pad(Math.floor(minutes / 60))}${separator}${pad(minutes % 60)}`;
  };
  const eraYear = parts.year > 0 ? parts.year : 1 - parts.year;
  const hour12 = parts.hour % 12 || 12;
  let expanded = pattern;
  // moment writes the long formats out again while they name more of them, six times at most
  for (let round = 0; round < 6; round += 1) {
    const next = expanded.replace(LONG_DATE_TOKENS, (match) => LONG_DATE_FORMATS[match] ?? match);
    if (next === expanded) break;
    expanded = next;
  }
  return expanded.replace(TOKENS, (match: string, literal: string | undefined, escaped: string | undefined, token: string) => {
    if (literal !== undefined) return literal.replace(/^\[|\]$/g, '');
    // moment drops each backslash it reads, an escaped one too
    if (escaped !== undefined) return token.replace(/\\/g, '');
    if (/^S{4,9}$/.test(token)) return zeroFill(parts.ms * 10 ** (token.length - 3), token.length);
    switch (token) {
      case 'YYYYYY':
        return zeroFill(parts.year, 6, true);
      case 'YYYYY':
        return zeroFill(parts.year, 5);
      case 'YYYY':
        return zeroFill(parts.year, 4);
      case 'YY':
        return zeroFill(parts.year % 100, 2);
      case 'Y':
        return parts.year <= 9999 ? zeroFill(parts.year, 4) : `+${parts.year}`;
      case 'N':
      case 'NN':
      case 'NNN':
      case 'NNNNN':
        return parts.year > 0 ? 'AD' : 'BC';
      case 'NNNN':
        return parts.year > 0 ? 'Anno Domini' : 'Before Christ';
      case 'y':
        return String(eraYear);
      case 'yo':
        return ordinal(eraYear);
      case 'yy':
      case 'yyy':
      case 'yyyy':
        return zeroFill(eraYear, token.length);
      case 'gg':
        return zeroFill(weekOfYear(parts, LOCALE_WEEK.dow, LOCALE_WEEK.doy).year % 100, 2);
      case 'gggg':
      case 'ggggg':
        return zeroFill(weekOfYear(parts, LOCALE_WEEK.dow, LOCALE_WEEK.doy).year, token.length);
      case 'GG':
        return zeroFill(weekOfYear(parts, ISO_WEEK.dow, ISO_WEEK.doy).year % 100, 2);
      case 'GGGG':
      case 'GGGGG':
        return zeroFill(weekOfYear(parts, ISO_WEEK.dow, ISO_WEEK.doy).year, token.length);
      case 'Q':
        return String(Math.floor(parts.month / 3) + 1);
      case 'Qo':
        return ordinal(Math.floor(parts.month / 3) + 1);
      case 'MMMM':
        return MONTHS[parts.month];
      case 'MMM':
        return MONTHS[parts.month].slice(0, 3);
      case 'MM':
        return zeroFill(parts.month + 1, 2);
      case 'Mo':
        return ordinal(parts.month + 1);
      case 'M':
        return String(parts.month + 1);
      case 'w':
        return String(weekOfYear(parts, LOCALE_WEEK.dow, LOCALE_WEEK.doy).week);
      case 'wo':
        return ordinal(weekOfYear(parts, LOCALE_WEEK.dow, LOCALE_WEEK.doy).week);
      case 'ww':
        return zeroFill(weekOfYear(parts, LOCALE_WEEK.dow, LOCALE_WEEK.doy).week, 2);
      case 'W':
        return String(weekOfYear(parts, ISO_WEEK.dow, ISO_WEEK.doy).week);
      case 'Wo':
        return ordinal(weekOfYear(parts, ISO_WEEK.dow, ISO_WEEK.doy).week);
      case 'WW':
        return zeroFill(weekOfYear(parts, ISO_WEEK.dow, ISO_WEEK.doy).week, 2);
      case 'DDDD':
        return zeroFill(dayOfYear(parts), 3);
      case 'DDDo':
        return ordinal(dayOfYear(parts));
      case 'DDD':
        return String(dayOfYear(parts));
      case 'Do':
        return ordinal(parts.day);
      case 'DD':
        return zeroFill(parts.day, 2);
      case 'D':
        return String(parts.day);
      case 'dddd':
        return DAYS[parts.weekday];
      case 'ddd':
        return DAYS[parts.weekday].slice(0, 3);
      case 'dd':
        return DAYS[parts.weekday].slice(0, 2);
      case 'do':
        return ordinal(parts.weekday);
      case 'd':
        return String(parts.weekday);
      case 'e':
        return String((parts.weekday - LOCALE_WEEK.dow + 7) % 7);
      case 'E':
        return String(parts.weekday || 7);
      case 'HH':
        return zeroFill(parts.hour, 2);
      case 'H':
        return String(parts.hour);
      case 'hh':
        return zeroFill(hour12, 2);
      case 'h':
        return String(hour12);
      case 'kk':
        return zeroFill(parts.hour || 24, 2);
      case 'k':
        return String(parts.hour || 24);
      case 'hmm':
        return `${hour12}${zeroFill(parts.minute, 2)}`;
      case 'hmmss':
        return `${hour12}${zeroFill(parts.minute, 2)}${zeroFill(parts.second, 2)}`;
      case 'Hmm':
        return `${parts.hour}${zeroFill(parts.minute, 2)}`;
      case 'Hmmss':
        return `${parts.hour}${zeroFill(parts.minute, 2)}${zeroFill(parts.second, 2)}`;
      case 'mm':
        return zeroFill(parts.minute, 2);
      case 'm':
        return String(parts.minute);
      case 'ss':
        return zeroFill(parts.second, 2);
      case 's':
        return String(parts.second);
      case 'SSS':
        return zeroFill(parts.ms, 3);
      case 'SS':
        return zeroFill(Math.floor(parts.ms / 10), 2);
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
      case 'z':
      case 'zz':
        return zoneAbbreviation(date, timeZone);
      case 'X':
        return String(Math.floor(date.getTime() / 1000));
      case 'x':
        return String(date.getTime());
      default:
        // Any other letter as it is, a lone backslash left out, as moment writes them
        return match.replace(/\\/g, '');
    }
  });
}

// --- Reading a value as moment(value) reads it ---------------------------------------------------

// The ISO 8601 forms moment reads: extended ("2024-02-29T13:45:30.123+02:00") and basic ("20240229T1345Z")
const ISO_EXTENDED =
  /^\s*((?:[+-]\d{6}|\d{4})-(?:\d\d-\d\d|W\d\d-\d|W\d\d|\d\d\d|\d\d))(?:(T| )(\d\d(?::\d\d(?::\d\d(?:[.,]\d+)?)?)?)([+-]\d\d(?::?\d\d)?|\s*Z)?)?$/;
const ISO_BASIC =
  /^\s*((?:[+-]\d{6}|\d{4})(?:\d\d\d\d|W\d\d\d|W\d\d|\d\d\d|\d\d|))(?:(T| )(\d\d(?:\d\d(?:\d\d(?:[.,]\d+)?)?)?)([+-]\d\d(?::?\d\d)?|\s*Z)?)?$/;

// Its date forms in moment's order, each with whether a time may follow it, and its time forms
const ISO_DATES: Array<[string, RegExp, boolean]> = [
  ['YYYYYY-MM-DD', /[+-]\d{6}-\d\d-\d\d/, true],
  ['YYYY-MM-DD', /\d{4}-\d\d-\d\d/, true],
  ['GGGG-[W]WW-E', /\d{4}-W\d\d-\d/, true],
  ['GGGG-[W]WW', /\d{4}-W\d\d/, false],
  ['YYYY-DDD', /\d{4}-\d{3}/, true],
  ['YYYY-MM', /\d{4}-\d\d/, false],
  ['YYYYYYMMDD', /[+-]\d{10}/, true],
  ['YYYYMMDD', /\d{8}/, true],
  ['GGGG[W]WWE', /\d{4}W\d{3}/, true],
  ['GGGG[W]WW', /\d{4}W\d{2}/, false],
  ['YYYYDDD', /\d{7}/, true],
  ['YYYYMM', /\d{6}/, false],
  ['YYYY', /\d{4}/, false],
];
const ISO_TIMES: Array<[string, RegExp]> = [
  ['HH:mm:ss.SSSS', /\d\d:\d\d:\d\d\.\d+/],
  ['HH:mm:ss,SSSS', /\d\d:\d\d:\d\d,\d+/],
  ['HH:mm:ss', /\d\d:\d\d:\d\d/],
  ['HH:mm', /\d\d:\d\d/],
  ['HHmmss.SSSS', /\d\d\d\d\d\d\.\d+/],
  ['HHmmss,SSSS', /\d\d\d\d\d\d,\d+/],
  ['HHmmss', /\d\d\d\d\d\d/],
  ['HHmm', /\d\d\d\d/],
  ['HH', /\d\d/],
];

// The tokens of those forms, and what each reads, as moment reads a text by a format that is not
// strict: the first run of such characters in what is left of the text; any other character of
// the form is passed over where it is found
const FORM_TOKENS = /YYYYYY|YYYY|GGGG|SSSS|DDD|MM|DD|WW|HH|mm|ss|E|Z|\[[^\]]*\]|./g;
const TOKEN_READS: Record<string, RegExp> = {
  YYYYYY: /[+-]?\d{1,6}/,
  YYYY: /\d{1,4}/,
  GGGG: /\d{1,4}/,
  SSSS: /\d+/,
  DDD: /\d{1,3}/,
  MM: /\d\d?/,
  DD: /\d\d?/,
  WW: /\d\d?/,
  HH: /\d\d?/,
  mm: /\d\d?/,
  ss: /\d\d?/,
  E: /\d/,
  Z: /Z|[+-]\d\d(?::?\d\d)?/i,
};

const RFC_2822 =
  /^(?:(Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s)?(\d{1,2})\s(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s(\d{2,4})\s(\d\d):(\d\d)(?::(\d\d))?\s(?:(UT|GMT|[ECMP][SD]T)|([Zz])|([+-]\d{4}))$/;
const RFC_2822_ZONES: Record<string, number> = {
  UT: 0,
  GMT: 0,
  EDT: -240,
  EST: -300,
  CDT: -300,
  CST: -360,
  MDT: -360,
  MST: -420,
  PDT: -420,
  PST: -480,
};

/** What moment reads into the fields a date is made from, before the ones left out are filled */
interface Reading {
  /** Year, month, day, hour, minute, second, millisecond */
  fields: Array<number | undefined>;
  dayOfYear?: number;
  isoWeek?: { year?: number; week?: number; weekday?: number };
  /** The minutes east of UTC the text names */
  offset?: number;
}

// moment's toInt: towards zero, and 0 for what is no number
function toInt(value: unknown): number {
  const number = Number(value);
  if (number === 0 || !Number.isFinite(number)) return 0;
  return number < 0 ? Math.ceil(number) || 0 : Math.floor(number);
}

// moment's createDate and createUTCDate: the years 0 to 99 are not read as 1900 to 1999
function localDate([year = 0, month = 0, day = 1, hour = 0, minute = 0, second = 0, ms = 0]: Array<number | undefined>): Date {
  if (year < 100 && year >= 0) {
    const date = new Date(year + 400, month, day, hour, minute, second, ms);
    if (Number.isFinite(date.getFullYear())) date.setFullYear(year);
    return date;
  }
  return new Date(year, month, day, hour, minute, second, ms);
}

function utcDate([year = 0, month = 0, day = 1, hour = 0, minute = 0, second = 0, ms = 0]: Array<number | undefined>): Date {
  if (year < 100 && year >= 0) {
    const date = new Date(Date.UTC(year + 400, month, day, hour, minute, second, ms));
    if (Number.isFinite(date.getUTCFullYear())) date.setUTCFullYear(year);
    return date;
  }
  return new Date(Date.UTC(year, month, day, hour, minute, second, ms));
}

/**
 * The moment a clock reading (a time whose UTC fields are what the clock shows) is in a named zone,
 * as moment-timezone finds it for its default zone: a reading the clocks skip is counted with the
 * offset from before the change, and one they show twice is its first pass
 */
function fromZoneClock(reading: number, timeZone: string): number {
  // Within a day of the first and the last moment there are, by the offset there
  const limit = 8.64e15 - 2 * UNIT_MS.d;
  if (!(Math.abs(reading) < limit)) {
    return reading - timeZoneOffset(Math.max(-limit, Math.min(limit, reading)) || 0, timeZone) * UNIT_MS.m;
  }
  const before = timeZoneOffset(reading - UNIT_MS.d, timeZone);
  if (timeZoneOffset(reading - before * UNIT_MS.m, timeZone) === before) return reading - before * UNIT_MS.m;
  const after = timeZoneOffset(reading + UNIT_MS.d, timeZone);
  const fits = timeZoneOffset(reading - after * UNIT_MS.m, timeZone) === after;
  return reading - (fits ? after : before) * UNIT_MS.m;
}

function daysInMonth(year: number, month: number): number {
  return month === 1 ? daysInYear(year) - 337 : 31 - ((month % 7) % 2);
}

// moment's dayOfYearFromWeeks
function dayOfYearFromWeeks(year: number, week: number, weekday: number, dow: number, doy: number) {
  const dayOfYear = 1 + 7 * (week - 1) + ((7 + weekday - dow) % 7) + firstWeekOffset(year, dow, doy);
  if (dayOfYear <= 0) return { year: year - 1, dayOfYear: daysInYear(year - 1) + dayOfYear };
  if (dayOfYear > daysInYear(year)) return { year: year + 1, dayOfYear: dayOfYear - daysInYear(year) };
  return { year, dayOfYear };
}

/**
 * The date of what moment read, as its configFromArray makes it: a day of the year or an ISO week
 * gives the month and the day; the year, month and day left out are today's, and the rest 0 (the
 * day 1); a field out of its range is no date. With no offset named it is read on the clock of the
 * zone of the settings, or the browser's own.
 */
function dateOfReading(reading: Reading, timeZone: string | undefined, now: number): Date | undefined {
  const fields = [...reading.fields];
  const named = reading.offset !== undefined;
  const today = new Date(now);
  const current = named
    ? [today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()]
    : [today.getFullYear(), today.getMonth(), today.getDate()];
  let { dayOfYear } = reading;
  let overflow = -1;
  const week = reading.isoWeek;
  if (week && fields[2] === undefined && fields[1] === undefined) {
    const weekYear = week.year ?? fields[0] ?? weekOfYear(partsOf(today, timeZone), ISO_WEEK.dow, ISO_WEEK.doy).year;
    const number = week.week ?? 1;
    const weekday = week.weekday ?? 1;
    if (number < 1 || number > weeksInYear(weekYear, ISO_WEEK.dow, ISO_WEEK.doy)) overflow = 7;
    else if (weekday < 1 || weekday > 7) overflow = 8;
    else {
      const found = dayOfYearFromWeeks(weekYear, number, weekday, ISO_WEEK.dow, ISO_WEEK.doy);
      fields[0] = found.year;
      dayOfYear = found.dayOfYear;
    }
  }
  let dayOfYearOverflows = false;
  if (dayOfYear !== undefined) {
    const year = fields[0] ?? current[0];
    dayOfYearOverflows = dayOfYear > daysInYear(year) || dayOfYear === 0;
    const date = utcDate([year, 0, dayOfYear]);
    fields[1] = date.getUTCMonth();
    fields[2] = date.getUTCDate();
  }
  let index = 0;
  for (; index < 3 && fields[index] === undefined; index += 1) fields[index] = current[index];
  for (; index < 7; index += 1) if (fields[index] === undefined) fields[index] = index === 2 ? 1 : 0;
  const [year, month, day, hour, minute, second, ms] = fields as number[];
  const fieldOverflow =
    month < 0 || month > 11
      ? 1
      : day < 1 || day > daysInMonth(year, month)
        ? 2
        : hour < 0 || hour > 24 || (hour === 24 && (minute !== 0 || second !== 0 || ms !== 0))
          ? 3
          : minute < 0 || minute > 59
            ? 4
            : second < 0 || second > 59
              ? 5
              : ms < 0 || ms > 999
                ? 6
                : -1;
  if (fieldOverflow !== -1 || dayOfYearOverflows || overflow !== -1) return undefined;
  // 24:00 is the start of the next day
  const nextDay = hour === 24;
  const clock = nextDay ? [year, month, day, 0, 0, 0, 0] : fields;
  let date: Date;
  if (named) date = new Date(utcDate(clock).getTime() - (reading.offset ?? 0) * UNIT_MS.m);
  else if (!timeZone || timeZone === 'Browser') date = localDate(clock);
  else date = new Date(fromZoneClock(utcDate(clock).getTime(), timeZone));
  if (nextDay) date = addUnits(date, 1, 'd');
  return Number.isNaN(date.getTime()) ? undefined : date;
}

// moment's offsetFromString: the sign and the hours and minutes of "+02:00", "-0530", "+05" or "Z"
function offsetOf(text: string): number {
  const parts = text.match(/[+-]|\d\d/g) ?? ['-', '0', '0'];
  const minutes = Number(parts[1] ?? 0) * 60 + toInt(parts[2]);
  return minutes === 0 ? 0 : parts[0] === '+' ? minutes : -minutes;
}

/** A text read by one of the ISO forms, as moment reads it by a format that is not strict */
function readByForm(text: string, form: string): Reading | undefined {
  const reading: Reading = { fields: [] };
  let rest = text;
  let read = false;
  for (const token of form.match(FORM_TOKENS) ?? []) {
    const pattern = TOKEN_READS[token];
    const literal = token.replace(/^\[|\]$/g, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const found = (pattern ?? new RegExp(literal)).exec(rest)?.[0];
    if (found) rest = rest.slice(rest.indexOf(found) + found.length);
    if (!pattern || !found) continue;
    read = true;
    const isoWeek = () => (reading.isoWeek ??= {});
    switch (token) {
      case 'YYYYYY':
        reading.fields[0] = toInt(found);
        break;
      case 'YYYY':
        reading.fields[0] = found.length === 2 ? toInt(found) + (toInt(found) > 68 ? 1900 : 2000) : toInt(found);
        break;
      case 'MM':
        reading.fields[1] = toInt(found) - 1;
        break;
      case 'DD':
        reading.fields[2] = toInt(found);
        break;
      case 'DDD':
        reading.dayOfYear = toInt(found);
        break;
      case 'HH':
        reading.fields[3] = toInt(found);
        break;
      case 'mm':
        reading.fields[4] = toInt(found);
        break;
      case 'ss':
        reading.fields[5] = toInt(found);
        break;
      case 'SSSS':
        reading.fields[6] = toInt(Number(`0.${found}`) * 1000);
        break;
      case 'GGGG':
        isoWeek().year = toInt(found);
        break;
      case 'WW':
        isoWeek().week = toInt(found);
        break;
      case 'E':
        isoWeek().weekday = toInt(found);
        break;
      default:
        reading.offset = offsetOf(found);
    }
  }
  return read ? reading : undefined;
}

type Read = { date: Date | undefined } | undefined;

/** moment's configFromISO: undefined when the text is not in one of its forms, to be read otherwise */
function readIso(text: string, timeZone: string | undefined, now: number): Read {
  const match = ISO_EXTENDED.exec(text) ?? ISO_BASIC.exec(text);
  if (!match) return undefined;
  const dateForm = ISO_DATES.find(([, pattern]) => pattern.test(match[1]));
  if (!dateForm) return undefined;
  let timeForm = '';
  if (match[3]) {
    const found = ISO_TIMES.find(([, pattern]) => pattern.test(match[3]));
    if (!found) return undefined;
    timeForm = (match[2] || ' ') + found[0];
  }
  if (!dateForm[2] && timeForm) return undefined;
  const reading = readByForm(text, dateForm[0] + timeForm + (match[4] ? 'Z' : ''));
  return { date: reading ? dateOfReading(reading, timeZone, now) : undefined };
}

/** moment's configFromRFC2822: "Thu, 29 Feb 2024 13:45:30 +0000" */
function readRfc2822(text: string): Read {
  const cleaned = text
    .replace(/\([^()]*\)|[\n\t]/g, ' ')
    .replace(/(\s\s+)/g, ' ')
    .replace(/^\s\s*/, '')
    .replace(/\s\s*$/, '');
  const match = RFC_2822.exec(cleaned);
  if (!match) return undefined;
  const shortYear = parseInt(match[4], 10);
  const year = shortYear <= 49 ? 2000 + shortYear : shortYear <= 999 ? 1900 + shortYear : shortYear;
  const month = MONTHS.findIndex((name) => name.startsWith(match[3]));
  const day = parseInt(match[2], 10);
  // A weekday that is not that date's makes it no date, whatever the browser would read in it
  if (match[1] && DAYS.findIndex((name) => name.startsWith(match[1])) !== new Date(year, month, day).getDay()) {
    return { date: undefined };
  }
  const hour = parseInt(match[5], 10);
  const minute = parseInt(match[6], 10);
  const second = match[7] ? parseInt(match[7], 10) : undefined;
  let offset = 0;
  if (match[8]) offset = RFC_2822_ZONES[match[8]];
  else if (!match[9]) {
    const hoursAndMinutes = parseInt(match[10], 10);
    const minutes = hoursAndMinutes % 100;
    offset = ((hoursAndMinutes - minutes) / 100) * 60 + minutes;
  }
  const overflows =
    month > 11 ||
    day < 1 ||
    day > daysInMonth(year, month) ||
    hour > 24 ||
    hour === 24 ||
    minute > 59 ||
    (second !== undefined && second > 59);
  if (overflows) return { date: undefined };
  const date = new Date(utcDate([year, month, day, hour, minute, second]).getTime() - offset * UNIT_MS.m);
  return { date: Number.isNaN(date.getTime()) ? undefined : date };
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Object.prototype.toString.call(value) === '[object Object]';

// The units an object given to moment may name, by each name moment knows them by; a name is
// looked up as it is written, then in lower case
const OBJECT_UNITS = new Map<string, string>();
for (const [unit, ...names] of [
  ['year', 'y', 'years'],
  ['month', 'M', 'months'],
  ['date', 'D', 'dates'],
  ['day', 'd', 'days'],
  ['hour', 'h', 'hours'],
  ['minute', 'm', 'minutes'],
  ['second', 's', 'seconds'],
  ['millisecond', 'ms', 'milliseconds'],
]) {
  for (const name of [unit, ...names]) OBJECT_UNITS.set(name, unit);
}

/** moment's configFromObject: { year: 2024, month: 1, day: 29, ... }, months counted from 0 */
function readObject(value: Record<string, unknown>, timeZone: string | undefined, now: number): Date | undefined {
  const units: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    const unit = OBJECT_UNITS.get(key) ?? OBJECT_UNITS.get(key.toLowerCase());
    if (unit) units[unit] = value[key];
  }
  // "day" is the day of the month here, as moment reads it, before "date"
  const day = units.day === undefined ? units.date : units.day;
  // Each as `value && parseInt(value, 10)`: null and undefined are left out, the rest that is
  // nothing is 0
  const fields = [units.year, units.month, day, units.hour, units.minute, units.second, units.millisecond].map((unit) => {
    if (unit === null || unit === undefined) return undefined;
    return unit ? parseInt(String(unit), 10) : Number(unit);
  });
  return dateOfReading({ fields }, timeZone, now);
}

/**
 * The moment a value is, as moment(value) reads it in the zone of the settings (the browser's own
 * when none): a date; a number of milliseconds; text in an ISO 8601 form (on that zone's clock
 * when it names no offset), in RFC 2822, or else as the browser's Date reads it; an object of
 * units, the ones left out from today. undefined when moment finds no date in it.
 */
export function readMoment(value: unknown, timeZone?: string, now = Date.now()): Date | undefined {
  const valid = (date: Date) => (Number.isNaN(date.getTime()) ? undefined : date);
  if (value === undefined) return new Date(now);
  if (value === null || value === '') return undefined;
  if (Object.prototype.toString.call(value) === '[object Date]') return valid(new Date((value as Date).getTime()));
  if (typeof value === 'number') return valid(new Date(value));
  if (typeof value === 'string') {
    const asp = /^\/?Date\((-?\d+)/i.exec(value);
    if (asp) return valid(new Date(Number(asp[1])));
    const read = readIso(value, timeZone, now) ?? readRfc2822(value);
    return read ? read.date : valid(new Date(value));
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return new Date(now);
    return dateOfReading({ fields: value.slice(0, 7).map((item) => parseInt(String(item), 10)) }, timeZone, now);
  }
  if (isPlainObject(value)) {
    return Object.getOwnPropertyNames(value).length === 0 ? new Date(now) : readObject(value, timeZone, now);
  }
  return valid(new Date(String(value)));
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

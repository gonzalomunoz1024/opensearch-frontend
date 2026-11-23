/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The fields of an index pattern written as a time pattern (`[logstash-]YYYY.MM.DD`, the
 * interval patterns of old saved index patterns): the original's
 * /api/index_patterns/_fields_for_time_pattern. The pattern is a format of moment; an index or
 * alias matches when its name read strictly with the format, and written again with it, is the
 * same name. The newest `look_back` of them give the fields.
 *
 * The parts of a format read here are the numeric ones: years (YYYYYY, YYYYY, YYYY, YY, Y),
 * quarter (Q), month (MM, M), day of the month (DD, D), day of the year (DDDD, DDD), ISO week
 * year, week and weekday (GGGGG, GGGG, GG, WW, W, E), hour (HH, H), minute (mm, m) and second
 * (ss, s), with text in square brackets and any other character standing for itself. A format
 * with another part of moment's (names of months and days, the weeks of a locale, AM and PM,
 * fractions, zones, timestamps) matches no name.
 */

import { HttpError, notFound } from './http';
import { readFieldCaps, type FieldDescriptor } from './index_pattern_fields';
import { OpenSearchError, type OpenSearchClient } from './opensearch';

// moment's own pattern for the parts of a format (its formattingTokens)
const PARTS =
  /(\[[^[]*\])|(\\)?([Hh]mm(ss)?|Mo|MM?M?M?|Do|DDDo|DD?D?D?|ddd?d?|do?|w[o|w]?|W[o|W]?|Qo?|N{1,5}|YYYYYY|YYYYY|YYYY|YY|y{2,4}|yo?|gg(ggg?)?|GG(GGG?)?|e|E|a|A|hh?|HH?|kk?|mm?|ss?|S{1,9}|x|X|zz?|ZZ?|.)/g;
// The date formats of a locale, which moment writes out before reading a format
const LOCALE_PARTS = /(\[[^[]*\])|(\\)?(LTS|LT|LL?L?L?|l{1,4})/;

type Unit = 'year' | 'quarter' | 'month' | 'day' | 'dayOfYear' | 'weekYear' | 'week' | 'weekday' | 'hour' | 'minute' | 'second';

interface Numeric {
  unit: Unit;
  /** What a strict reading takes */
  digits: RegExp;
  /** Written with at least this many digits */
  width: number;
  /** A year of two digits: 69 to 99 are 1969 to 1999 */
  short?: boolean;
  /** A year's sign: always written, or only beyond 9999 */
  sign?: 'always' | 'beyond';
}

const one = /^\d/;
const oneOrTwo = /^\d\d?/;
const two = /^\d\d/;
const four = /^\d{4}/;
const six = /^[+-]?\d{6}/;

const NUMERIC: Record<string, Numeric> = {
  YYYYYY: { unit: 'year', digits: six, width: 6, sign: 'always' },
  YYYYY: { unit: 'year', digits: six, width: 5 },
  YYYY: { unit: 'year', digits: four, width: 4 },
  YY: { unit: 'year', digits: two, width: 2, short: true },
  Y: { unit: 'year', digits: /^[+-]?\d+/, width: 4, sign: 'beyond' },
  Q: { unit: 'quarter', digits: one, width: 1 },
  MM: { unit: 'month', digits: two, width: 2 },
  M: { unit: 'month', digits: oneOrTwo, width: 1 },
  DD: { unit: 'day', digits: two, width: 2 },
  D: { unit: 'day', digits: oneOrTwo, width: 1 },
  DDDD: { unit: 'dayOfYear', digits: /^\d{3}/, width: 3 },
  DDD: { unit: 'dayOfYear', digits: /^\d{1,3}/, width: 1 },
  GGGGG: { unit: 'weekYear', digits: six, width: 5 },
  GGGG: { unit: 'weekYear', digits: four, width: 4 },
  GG: { unit: 'weekYear', digits: two, width: 2, short: true },
  WW: { unit: 'week', digits: two, width: 2 },
  W: { unit: 'week', digits: oneOrTwo, width: 1 },
  E: { unit: 'weekday', digits: oneOrTwo, width: 1 },
  HH: { unit: 'hour', digits: two, width: 2 },
  H: { unit: 'hour', digits: oneOrTwo, width: 1 },
  mm: { unit: 'minute', digits: two, width: 2 },
  m: { unit: 'minute', digits: oneOrTwo, width: 1 },
  ss: { unit: 'second', digits: two, width: 2 },
  s: { unit: 'second', digits: oneOrTwo, width: 1 },
};

type Part = { text: string } | { numeric: Numeric };

/** The parts of a format, or nothing when it has one that is not read here */
export function timePatternParts(pattern: string): Part[] | undefined {
  if (LOCALE_PARTS.test(pattern.replace(/\[[^[]*\]/g, ''))) return undefined;
  const parts: Part[] = [];
  for (const part of pattern.match(PARTS) ?? []) {
    if (/^\[[\s\S]*\]$/.test(part)) parts.push({ text: part.slice(1, -1) });
    else if (part.startsWith('\\') && part.length > 1) parts.push({ text: part.slice(1) });
    else if (Object.hasOwn(NUMERIC, part)) parts.push({ numeric: NUMERIC[part] });
    else if (/^[A-Za-z]/.test(part)) return undefined;
    else parts.push({ text: part });
  }
  return parts;
}

const DAY = 86400000;
const utc = (year: number, month: number, day: number) => {
  // (Date.UTC reads the years 0 to 99 as 1900 to 1999)
  const date = new Date(Date.UTC(2000, month, day));
  date.setUTCFullYear(year, month, day);
  return date.getTime();
};
const leap = (year: number) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
const daysIn = (year: number, month: number) => [31, leap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month];
/** The Monday of the first ISO week of a year: the week that holds the fourth of January */
function firstWeek(year: number): number {
  const fourth = utc(year, 0, 4);
  return fourth - ((new Date(fourth).getUTCDay() + 6) % 7) * DAY;
}
const weeksIn = (year: number) => Math.round((firstWeek(year + 1) - firstWeek(year)) / (7 * DAY));

function isoWeekOf(time: number): { weekYear: number; week: number; weekday: number } {
  const year = new Date(time).getUTCFullYear();
  const weekYear = time < firstWeek(year) ? year - 1 : time >= firstWeek(year + 1) ? year + 1 : year;
  return {
    weekYear,
    week: Math.floor((time - firstWeek(weekYear)) / (7 * DAY)) + 1,
    weekday: ((new Date(time).getUTCDay() + 6) % 7) + 1,
  };
}

const written = (value: number, { width, sign }: Numeric) => {
  if (sign === 'beyond' && value > 9999) return `+${value}`;
  const digits = String(Math.abs(value)).padStart(width, '0');
  return value < 0 ? `-${digits}` : sign === 'always' ? `+${digits}` : digits;
};

/**
 * The time a name stands for when it is the time pattern's own writing of a time, as
 * `moment(name, pattern, true)` is valid and `format(pattern)` gives the name again; nothing
 * for any other name. Parts a pattern leaves out are filled as moment fills them: from today
 * above the largest part given, from the start below it.
 */
export function timeOfName(name: string, parts: Part[], now = new Date()): number | undefined {
  const read: Partial<Record<Unit, number>> = {};
  let rest = name;
  for (const part of parts) {
    if ('text' in part) {
      if (!rest.startsWith(part.text)) return undefined;
      rest = rest.slice(part.text.length);
      continue;
    }
    const digits = part.numeric.digits.exec(rest)?.[0];
    if (digits === undefined) return undefined;
    rest = rest.slice(digits.length);
    const value = parseInt(digits, 10);
    read[part.numeric.unit] = part.numeric.short ? value + (value > 68 ? 1900 : 2000) : value;
    if (part.numeric.unit === 'quarter') read.month = (value - 1) * 3 + 1;
  }
  // (moment takes no name as a time when the pattern has no part of a time at all)
  if (rest !== '' || Object.keys(read).length === 0) return undefined;

  const { hour = 0, minute = 0, second = 0 } = read;
  if (hour > 24 || (hour === 24 && (minute !== 0 || second !== 0)) || minute > 59 || second > 59) return undefined;
  if (read.month !== undefined && (read.month < 1 || read.month > 12)) return undefined;

  let day: number;
  const weeks = read.weekYear !== undefined || read.week !== undefined || read.weekday !== undefined;
  if (weeks && read.day === undefined && read.month === undefined) {
    const weekYear = read.weekYear ?? read.year ?? isoWeekOf(utc(now.getFullYear(), now.getMonth(), now.getDate())).weekYear;
    const week = read.week ?? 1;
    const weekday = read.weekday ?? 1;
    if (weekday < 1 || weekday > 7 || week < 1 || week > weeksIn(weekYear)) return undefined;
    day = firstWeek(weekYear) + ((week - 1) * 7 + weekday - 1) * DAY;
  } else {
    // Above the largest part given, today's; below it, the first
    const given = read.year !== undefined ? 3 : read.month !== undefined ? 2 : read.day !== undefined ? 1 : 0;
    const year = read.year ?? now.getFullYear();
    const month = read.month !== undefined ? read.month - 1 : given === 1 || given === 0 ? now.getMonth() : 0;
    const date = read.day ?? (given === 0 ? now.getDate() : 1);
    if (read.dayOfYear !== undefined) {
      if (read.dayOfYear < 1 || read.dayOfYear > (leap(year) ? 366 : 365)) return undefined;
      day = utc(year, 0, read.dayOfYear);
    } else {
      if (date < 1 || date > daysIn(year, month)) return undefined;
      day = utc(year, month, date);
    }
  }
  const time = day + ((hour * 60 + minute) * 60 + second) * 1000;

  // The name must be the pattern's own writing of that time
  const at = new Date(time);
  const week = isoWeekOf(time - (time % DAY) - (time % DAY < 0 ? DAY : 0));
  const value: Record<Unit, number> = {
    year: at.getUTCFullYear(),
    quarter: Math.floor(at.getUTCMonth() / 3) + 1,
    month: at.getUTCMonth() + 1,
    day: at.getUTCDate(),
    dayOfYear: Math.round((utc(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()) - utc(at.getUTCFullYear(), 0, 1)) / DAY) + 1,
    weekYear: week.weekYear,
    week: week.week,
    weekday: week.weekday,
    hour: at.getUTCHours(),
    minute: at.getUTCMinutes(),
    second: at.getUTCSeconds(),
  };
  const again = parts
    .map((part) => {
      if ('text' in part) return part.text;
      const { unit, short } = part.numeric;
      return written(short ? value[unit] % 100 : value[unit], part.numeric);
    })
    .join('');
  return again === name ? time : undefined;
}

/** The wildcard that finds every name a time pattern could match (the original's timePatternToWildcard) */
export function timePatternToWildcard(timePattern: string): string {
  let wildcard = '';
  let inEscape = false;
  let inPattern = false;
  for (const ch of timePattern.split('')) {
    if (ch === '[') {
      inPattern = false;
      if (!inEscape) inEscape = true;
      else wildcard += ch;
    } else if (ch === ']') {
      if (inEscape) inEscape = false;
      else if (!inPattern) wildcard += ch;
    } else if (inEscape) {
      wildcard += ch;
    } else if (!inPattern) {
      wildcard += '*';
      inPattern = true;
    }
  }
  return wildcard;
}

/** The names that match a time pattern, the newest first (the `matches` of the original's resolveTimePattern) */
export function timePatternMatches(names: string[], timePattern: string, now = new Date()): string[] {
  const parts = timePatternParts(timePattern);
  if (!parts) return [];
  const sorted = [...new Set(names)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return sorted
    .map((name) => ({ name, time: timeOfName(name, parts, now) }))
    .filter((entry): entry is { name: string; time: number } => entry.time !== undefined)
    .sort((a, b) => b.time - a.time)
    .map((entry) => entry.name);
}

const indexList = (names: string) => names.split(',').map(encodeURIComponent).join(',');

/**
 * The fields of the newest `lookBack` indices and aliases a time pattern matches. As the
 * original's route, every failure of OpenSearch, and a pattern that matches nothing, is a
 * plain 404.
 */
export async function fieldsForTimePattern(
  client: OpenSearchClient,
  pattern: string,
  lookBack: number,
  metaFields: string[]
): Promise<FieldDescriptor[]> {
  try {
    const aliases = await client.request<Record<string, { aliases?: Record<string, unknown> }>>({
      method: 'GET',
      path: `/${indexList(timePatternToWildcard(pattern))}/_alias`,
      query: { ignore_unavailable: true, allow_no_indices: false },
    });
    const names = Object.entries(aliases).flatMap(([index, { aliases: of }]) => [index, ...Object.keys(of ?? {})]);
    const indices = timePatternMatches(names, pattern).slice(0, lookBack);
    if (indices.length === 0) throw notFound();
    const result = await client.request<{ fields?: Parameters<typeof readFieldCaps>[0] }>({
      method: 'GET',
      path: `/${indices.map(encodeURIComponent).join(',')}/_field_caps`,
      query: { fields: '*', ignore_unavailable: true, allow_no_indices: false },
    });
    return readFieldCaps(result.fields ?? {}, metaFields);
  } catch (error) {
    if (error instanceof OpenSearchError || error instanceof HttpError) throw notFound();
    throw error;
  }
}

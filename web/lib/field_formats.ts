/* SPDX-License-Identifier: Apache-2.0 */

/*
 * How a field's values are written: the formats an index pattern can give a field in OpenSearch
 * Dashboards (number, bytes, percent, date, duration, string, URL, colour, ...), read from the
 * same saved settings.
 */

import { addUnits, DEFAULT_DATE_FORMAT, formatDate, readMoment, utcOffset, type ScaledDateRules } from './dates';
import { formatNumber } from './numeral';
import type { Field, FieldFormatSpec, IndexPattern } from './types';

/** Where the page was loaded, and the base path of the server */
export interface ParsedUrl {
  origin: string;
  pathname: string;
  basePath: string;
}

export interface FormatSettings {
  dateFormat: string;
  timeZone?: string;
  numberPattern: string;
  bytesPattern: string;
  percentPattern: string;
  /** The setting dateNanosFormat: the pattern of the format date_nanos when it was given none */
  dateNanosFormat?: string;
  /** The setting format:defaultTypeMap: the format of a kind of field that was given none */
  defaultTypeMap: Record<string, FieldFormatSpec>;
  /** The setting dateFormat:scaled: the format of a date bucket by its interval */
  scaledDateRules?: ScaledDateRules;
  /**
   * Where the page was loaded, as the original tells its formats (the meta parameter parsedUrl): a
   * link of the URL format that is not to an http or https address is made absolute from it, as
   * the original makes it. Without it such a link is kept only when it is safe to follow.
   */
  parsedUrl?: ParsedUrl;
}

export const DEFAULT_DATE_NANOS_FORMAT = 'MMM D, YYYY @ HH:mm:ss.SSSSSSSSS';

/**
 * A date_nanos value as the original writes it: past three digits, the fraction of the second is
 * the one in the text OpenSearch sent ("2020-05-18T20:45:05.957000123Z"), which a date cannot hold
 */
export function formatDateNanos(raw: string, date: Date, pattern: string, timeZone?: string): string {
  const fraction = /S+/.exec(pattern)?.[0] ?? '';
  if (fraction.length <= 3) return formatDate(date, pattern, timeZone);
  const shown = formatDate(date, pattern.replace(fraction, `[${fraction}]`), timeZone);
  // The original's substr(20, length - 21): the digits between the dot and the zone's Z
  const nanos = raw
    .slice(20, 20 + Math.max(0, raw.length - 21))
    .padEnd(9, '0')
    .slice(0, fraction.length);
  return shown.replace(fraction, nanos);
}

export const DEFAULT_FORMAT_SETTINGS: FormatSettings = {
  dateFormat: DEFAULT_DATE_FORMAT,
  numberPattern: '0,0.[000]',
  bytesPattern: '0,0.[0]b',
  percentPattern: '0,0.[000]%',
  defaultTypeMap: {
    ip: { id: 'ip', params: {} },
    date: { id: 'date', params: {} },
    date_nanos: { id: 'date_nanos', params: {} },
    number: { id: 'number', params: {} },
    boolean: { id: 'boolean', params: {} },
    _source: { id: '_source', params: {} },
    _default_: { id: 'string', params: {} },
  },
};

/**
 * A value ready to show: its text, as a text is made of it (a chart's label, a filter's), and what
 * some formats draw of it instead or around it
 */
export interface Formatted {
  text: string;
  href?: string;
  newTab?: boolean;
  /** A picture, drawn in place of the text; `alt` tells what it shows */
  image?: { src: string; alt?: string; width?: number; height?: number };
  /** A sound, drawn as a player in place of the text */
  audio?: { src: string };
  color?: string;
  background?: string;
  /** A list of values: each as its format draws it, between them `separator` */
  parts?: Formatted[];
  separator?: string;
}

export type Formatter = (value: unknown) => Formatted;

export const MISSING = '-';
// What the original writes for no value in a list
const MISSING_IN_LIST = ' - ';

// An empty text is a value, which each format writes as the original's does: mostly as nothing
const isMissing = (value: unknown) => value === null || value === undefined;

/** A value as text, as lodash's toString writes it, which the original's formats escape: -0 is "-0" */
function asText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (isMissing(value)) return '';
  return Object.is(value, -0) ? '-0' : String(value);
}

export function stringify(value: unknown): string {
  if (isMissing(value)) return MISSING;
  if (typeof value === 'string') return value;
  // As the original's formats write an object: indented by two spaces
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

/**
 * A length of time as moment.js keeps it, with which OpenSearch Dashboards writes durations:
 * milliseconds, days and months apart, since days and months have no fixed length
 */
interface Duration {
  ms: number;
  days: number;
  months: number;
}

// Units under a second are given to moment in seconds
const SUB_SECOND: Record<string, number> = { picoseconds: 1e-12, nanoseconds: 1e-9, microseconds: 1e-6 };

/** moment.duration(value, unit) */
function durationOf(value: number, unit: string): Duration {
  const ratio = SUB_SECOND[unit];
  const amount = value * (ratio ?? 1);
  switch (ratio ? 'seconds' : unit) {
    case 'milliseconds':
      return { ms: amount, days: 0, months: 0 };
    case 'seconds':
      return { ms: amount * 1e3, days: 0, months: 0 };
    case 'minutes':
      return { ms: amount * 6e4, days: 0, months: 0 };
    case 'hours':
      return { ms: amount * 1000 * 60 * 60, days: 0, months: 0 };
    case 'days':
      return { ms: 0, days: amount, months: 0 };
    case 'weeks':
      return { ms: 0, days: amount * 7, months: 0 };
    case 'months':
      return { ms: 0, days: 0, months: amount };
    case 'years':
      return { ms: 0, days: 0, months: amount * 12 };
    default:
      return { ms: 0, days: 0, months: 0 };
  }
}

/** duration.as(unit): a month is 146097 / 4800 days, as moment counts it */
function durationAs({ ms, days, months }: Duration, unit: string): number {
  if (unit === 'months' || unit === 'years') {
    const allMonths = months + ((days + ms / 864e5) * 4800) / 146097;
    return unit === 'months' ? allMonths : allMonths / 12;
  }
  const allDays = days + Math.round((months * 146097) / 4800);
  switch (unit) {
    case 'weeks':
      return allDays / 7 + ms / 6048e5;
    case 'days':
      return allDays + ms / 864e5;
    case 'hours':
      return allDays * 24 + ms / 36e5;
    case 'minutes':
      return allDays * 1440 + ms / 6e4;
    case 'seconds':
      return allDays * 86400 + ms / 1000;
    default:
      return Math.floor(allDays * 864e5) + ms;
  }
}

/** duration.humanize(): moment's words and thresholds, without "ago" or "in" */
function humanizeDuration(duration: Duration): string {
  const abs = { ms: Math.abs(duration.ms), days: Math.abs(duration.days), months: Math.abs(duration.months) };
  const [seconds, minutes, hours, days, months, years] = ['seconds', 'minutes', 'hours', 'days', 'months', 'years'].map(
    (unit) => Math.round(durationAs(abs, unit))
  );
  if (seconds <= 44) return 'a few seconds';
  if (seconds < 45) return `${seconds} seconds`;
  if (minutes <= 1) return 'a minute';
  if (minutes < 45) return `${minutes} minutes`;
  if (hours <= 1) return 'an hour';
  if (hours < 22) return `${hours} hours`;
  if (days <= 1) return 'a day';
  if (days < 26) return `${days} days`;
  if (months <= 1) return 'a month';
  if (months < 11) return `${months} months`;
  if (years <= 1) return 'a year';
  return `${years} years`;
}

/** "3 hours", "a few seconds": a length of time in words, as moment writes it */
export const humanize = (ms: number): string => humanizeDuration({ ms, days: 0, months: 0 });

/** The names the duration format gives its outputs, which "Show suffix" writes after a value */
const DURATION_OUTPUTS: Record<string, string> = {
  humanize: 'Human Readable',
  asMilliseconds: 'Milliseconds',
  asSeconds: 'Seconds',
  asMinutes: 'Minutes',
  asHours: 'Hours',
  asDays: 'Days',
  asWeeks: 'Weeks',
  asMonths: 'Months',
  asYears: 'Years',
};

/** A parameter as a format reads it: an empty text or null is the default */
const param = (value: unknown, fallback: unknown) => (value || value === false || value === 0 ? value : fallback);

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Base64 read as Node's Buffer reads it: other characters left out, the bytes read as UTF-8 */
function decodeBase64(input: string): string {
  const clean = input.split('=')[0].trim().replace(/[^+/0-9A-Za-z\-_]/g, '');
  if (clean.length < 2) return '';
  const value = (char: string) => (char === '-' ? 62 : char === '_' ? 63 : BASE64.indexOf(char));
  const bytes: number[] = [];
  const whole = clean.length - (clean.length % 4);
  for (let index = 0; index < whole; index += 4) {
    const bits =
      (value(clean[index]) << 18) | (value(clean[index + 1]) << 12) | (value(clean[index + 2]) << 6) | value(clean[index + 3]);
    bytes.push((bits >> 16) & 255, (bits >> 8) & 255, bits & 255);
  }
  const rest = clean.length % 4;
  if (rest === 2) bytes.push(((value(clean[whole]) << 2) | (value(clean[whole + 1]) >> 4)) & 255);
  if (rest === 3) {
    const bits = (value(clean[whole]) << 10) | (value(clean[whole + 1]) << 4) | (value(clean[whole + 2]) >> 2);
    bytes.push((bits >> 8) & 255, bits & 255);
  }
  // UTF-8; a byte that does not start a whole character is one U+FFFD
  const tail = (byte: number) => (byte & 0xc0) === 0x80;
  const points: number[] = [];
  for (let index = 0; index < bytes.length; ) {
    const first = bytes[index];
    let size = first > 0xef ? 4 : first > 0xdf ? 3 : first > 0xbf ? 2 : 1;
    let point: number | undefined;
    if (index + size <= bytes.length) {
      const [second, third, fourth] = [bytes[index + 1], bytes[index + 2], bytes[index + 3]];
      if (size === 1 && first < 0x80) point = first;
      if (size === 2 && tail(second)) {
        const candidate = ((first & 0x1f) << 6) | (second & 0x3f);
        if (candidate > 0x7f) point = candidate;
      }
      if (size === 3 && tail(second) && tail(third)) {
        const candidate = ((first & 0xf) << 12) | ((second & 0x3f) << 6) | (third & 0x3f);
        if (candidate > 0x7ff && (candidate < 0xd800 || candidate > 0xdfff)) point = candidate;
      }
      if (size === 4 && tail(second) && tail(third) && tail(fourth)) {
        const candidate = ((first & 0xf) << 18) | ((second & 0x3f) << 12) | ((third & 0x3f) << 6) | (fourth & 0x3f);
        if (candidate > 0xffff && candidate < 0x110000) point = candidate;
      }
    }
    if (point === undefined) {
      point = 0xfffd;
      size = 1;
    }
    points.push(point);
    index += size;
  }
  let decoded = '';
  for (let index = 0; index < points.length; index += 4096) {
    decoded += String.fromCodePoint(...points.slice(index, index + 4096));
  }
  return decoded;
}

/**
 * How long ago a date was or how far ahead it is, as moment's fromNow says it: the whole months
 * between the two on the clock of the zone, and the milliseconds left over. Where a date cannot be
 * that many months away, moment's "Invalid date".
 */
export function fromNow(date: Date, now = new Date(), timeZone?: string): string {
  const future = now.getTime() < date.getTime();
  const [base, other] = future ? [now, date] : [date, now];
  const clock = (moment: Date) => new Date(moment.getTime() + utcOffset(moment, timeZone) * 60000);
  const [baseClock, otherClock] = [clock(base), clock(other)];
  let months =
    otherClock.getUTCMonth() - baseClock.getUTCMonth() + (otherClock.getUTCFullYear() - baseClock.getUTCFullYear()) * 12;
  if (addUnits(base, months, 'M').getTime() > other.getTime()) months -= 1;
  const ms = other.getTime() - addUnits(base, months, 'M').getTime();
  if (Number.isNaN(ms)) return 'Invalid date';
  const words = humanizeDuration({ ms, days: 0, months });
  // A difference of nothing is in the past, as moment has it
  return future ? `in ${words}` : `${words} ago`;
}

/**
 * A URL or label template, read as OpenSearch Dashboards reads it: `{{name}}` is that value,
 * or nothing when there is no value of that name
 */
export function fillTemplate(template: string, values: Record<string, unknown>): string {
  return template
    .split(/{{([\s\S]+?)}}/g)
    .map((part, index) => {
      if (index % 2 === 0) return part;
      const name = part.trim();
      const value = Object.prototype.hasOwnProperty.call(values, name) ? values[name] : undefined;
      return value === null || value === undefined ? '' : String(value);
    })
    .join('');
}

/**
 * The URL a URL format makes of a value, and the label it shows for it: the URL itself if none.
 * The value is read as the original reads it: as JavaScript writes it into a template, and as
 * lodash's toString writes it without one ("-0", "[object Object]").
 */
export function urlParts(params: Record<string, unknown>, value: unknown): { url: string; label: string } {
  const urlTemplate = param(params.urlTemplate, null);
  const labelTemplate = param(params.labelTemplate, null);
  const url =
    typeof urlTemplate === 'string'
      ? fillTemplate(urlTemplate, { value: encodeURIComponent(String(value)), rawValue: value })
      : asText(value);
  const label = typeof labelTemplate === 'string' ? fillTemplate(labelTemplate, { value, url }) : url;
  return { url, label };
}

/**
 * The address a link of the URL format goes to, as the original makes it from where the page was
 * loaded: an http or https address as it is; "#/..." on the page; a path under the base path on
 * the server; anything else under the base path's /app/. Each is safe to follow.
 */
function absoluteHref(url: string, { origin, pathname, basePath }: ParsedUrl): string {
  if (url.indexOf('http://') === 0 || url.indexOf('https://') === 0) return url;
  if (url[0] === '#') return `${origin}${pathname}${url}`;
  if (url.indexOf(basePath || '/') === 0) return `${origin}${url}`;
  return `${origin}${basePath || ''}/app${url[0] === '/' ? '' : '/'}${url}`;
}

// Only links a page may safely open: a relative address, or http, https or mailto. The address is
// read as a browser reads it, without the spaces and control characters around it and the tabs and
// line ends inside it, so that none of them hides a scheme such as `java<tab>script:`
function safeUrl(url: string): string | undefined {
  // eslint-disable-next-line no-control-regex
  const trimmed = url.replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, '').replace(/[\t\n\r]/g, '');
  // The scheme is the one the browser's own parser gives it
  try {
    const { protocol } = new URL(trimmed, 'http://localhost');
    return protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:' ? trimmed : undefined;
  } catch {
    return undefined;
  }
}

interface ColorRule {
  range?: unknown;
  regex?: unknown;
  text?: string;
  background?: string;
}

// The rule of the original's colour format when none is saved
const DEFAULT_COLOR_RULE: ColorRule = {
  range: '-Infinity:Infinity',
  regex: '<insert regex>',
  text: '#000000',
  background: '#ffffff',
};

function single(spec: FieldFormatSpec, settings: FormatSettings): (value: unknown) => Formatted {
  const params = spec.params ?? {};
  const text = (value: string): Formatted => ({ text: value });
  switch (spec.id) {
    case 'number':
    case 'bytes':
    case 'percent': {
      const fallback =
        spec.id === 'number'
          ? settings.numberPattern
          : spec.id === 'bytes'
            ? settings.bytesPattern
            : settings.percentPattern;
      const pattern = typeof params.pattern === 'string' && params.pattern ? params.pattern : fallback;
      return (value) => {
        // The ends of an open range, as the original's numeral formats write them
        if (value === Infinity) return text('+∞');
        if (value === -Infinity) return text('-∞');
        // Anything else is read as parseFloat reads it, and what is then no number is written as
        // nothing, as the original's numeral formats do: "3.14abc" is 3.14, "n/a", true and NaN ""
        const number = typeof value === 'number' ? value : parseFloat(String(value));
        return text(Number.isNaN(number) ? '' : formatNumber(number, pattern));
      };
    }
    case 'date': {
      const pattern = typeof params.pattern === 'string' && params.pattern ? params.pattern : settings.dateFormat;
      // In the zone of the settings, as the original's date formats write whatever timezone they name
      const zone = settings.timeZone;
      // A value moment finds no date in is written as it is, as the original writes it
      return (value) => {
        const date = readMoment(value, zone);
        return text(date ? formatDate(date, pattern, zone) : asText(value));
      };
    }
    case 'date_nanos': {
      // The setting dateNanosFormat; a number, as an aggregation answers, in the date format
      const pattern =
        typeof params.pattern === 'string' && params.pattern
          ? params.pattern
          : settings.dateNanosFormat || DEFAULT_DATE_NANOS_FORMAT;
      const zone = settings.timeZone;
      return (value) => {
        const date = readMoment(value, zone);
        if (!date) return text(asText(value));
        if (typeof value !== 'string') return text(formatDate(date, settings.dateFormat, zone));
        return text(formatDateNanos(value, date, pattern, zone));
      };
    }
    case 'relative_date':
      return (value) => {
        const date = readMoment(value, settings.timeZone);
        return text(date ? fromNow(date, new Date(), settings.timeZone) : asText(value));
      };
    case 'duration': {
      const input = String(param(params.inputFormat, 'seconds'));
      const output = String(param(params.outputFormat, 'humanize'));
      const precision = Number(param(params.outputPrecision, 2));
      const suffix = params.showSuffix && DURATION_OUTPUTS[output] ? ` ${DURATION_OUTPUTS[output]}` : '';
      return (value) => {
        // As the original multiplies it: an empty text is 0, other text that is no number is no
        // length of time, which moment writes as "Invalid date" in words and NaN as a number
        const number = Number(value);
        const duration = durationOf(number, input);
        if (output === 'humanize') {
          const words = Number.isNaN(number) ? 'Invalid date' : humanizeDuration(duration);
          return text(`${number < 0 ? 'minus ' : ''}${words}${suffix}`);
        }
        const unit = output.replace(/^as/, '').toLowerCase();
        return text(`${durationAs(duration, unit).toFixed(precision)}${suffix}`);
      };
    }
    case 'boolean':
      return (value) => {
        // Text is read trimmed and in lower case, and is shown so when it is neither; "1" and "0"
        // are text, not the numbers, as the original reads them
        const read = typeof value === 'string' ? value.trim().toLowerCase() : value;
        if (read === true || read === 1 || read === 'true' || read === 'yes') return text('true');
        if (read === false || read === 0 || read === 'false' || read === 'no') return text('false');
        return text(typeof read === 'string' ? read : stringify(read));
      };
    case 'ip':
      return (value) => {
        // What isFinite reads as a number is written as an address, as the original writes it: an
        // empty text is 0.0.0.0, "42" is 0.0.0.42; anything else as it is
        const number = Number(value);
        if (!Number.isFinite(number)) return text(asText(value));
        // eslint-disable-next-line no-bitwise
        return text([number >>> 24, (number >>> 16) & 255, (number >>> 8) & 255, number & 255].join('.'));
      };
    case 'truncate': {
      // lodash's truncate to the length and three more: the omission is not counted
      const length = Number(param(params.fieldLength, 0));
      return (value) => {
        const full = asText(value);
        if (!(length > 0)) return text(full);
        const symbols = Array.from(full);
        const end = Math.trunc(length + 3) - 3;
        return text(symbols.length <= Math.trunc(length + 3) ? full : `${symbols.slice(0, end).join('')}...`);
      };
    }
    case 'static_lookup': {
      const entries = Array.isArray(params.lookupEntries)
        ? (params.lookupEntries as Array<{ key: unknown; value: unknown }>)
        : [];
      const lookup = new Map(entries.map((entry) => [String(entry?.key), entry?.value]));
      // An entry without an answer and an empty text for the other values are none, as the original
      // reads them: the value itself is shown
      return (value) => text(asText(lookup.get(String(value)) || params.unknownKeyValue || value));
    }
    case 'color': {
      // No rules saved: the original's one, black on white for any number
      const saved = param(params.colors, null);
      const rules = (Array.isArray(saved) ? saved : saved ? [] : [DEFAULT_COLOR_RULE]) as ColorRule[];
      // By the kind of field its editor saves with it: without one nothing is coloured
      const fieldType = param(params.fieldType, null);
      return (value) => {
        const shown = stringify(value);
        // The last rule that matches is the one drawn, as the original's findLast
        for (let index = rules.length - 1; index >= 0; index -= 1) {
          const rule = rules[index];
          let matches = false;
          if (!rule) continue;
          if (fieldType === 'string') {
            try {
              // The value as text; a rule without a pattern matches every value
              matches = (rule.regex === undefined ? /(?:)/ : new RegExp(String(rule.regex))).test(String(value));
            } catch {
              matches = false;
            }
          } else if (fieldType === 'number' && rule.range) {
            // The value as JavaScript compares it with a number: an empty text is 0; an end left
            // out is 0 too, and one not given at all no number
            const number = Number(value);
            const [low, high] = String(rule.range).split(':');
            matches = number >= Number(low) && number <= Number(high);
          }
          if (matches) return { text: shown, color: rule.text || undefined, background: rule.background || undefined };
        }
        return text(shown);
      };
    }
    case 'url': {
      const kind = param(params.type, 'a');
      const { parsedUrl } = settings;
      // A size in pixels: the number at the start of the parameter, as parseInt reads it
      const size = (key: string) => {
        const parsed = parseInt(String(param(params[key], null)), 10);
        return Number.isNaN(parsed) ? undefined : parsed;
      };
      const width = size('width');
      const height = size('height');
      const newTab = !params.openLinkInCurrentTab;
      return (value) => {
        const { url, label } = urlParts(params, value);
        // A sound or a picture only from an address that is safe to load
        if (kind === 'audio') return safeUrl(url) === undefined ? text(label) : { text: label, audio: { src: url } };
        if (kind === 'img') {
          if (safeUrl(url) === undefined) return text(label);
          // A picture with nothing to say what it shows says where it comes from, as the original
          // tells screen readers
          const alt = label === url ? `A dynamically-specified image located at ${url}` : label;
          return { text: label, image: { src: url, alt, width, height } };
        }
        if (parsedUrl) return { text: label, href: absoluteHref(url, parsedUrl), newTab };
        const href = safeUrl(url);
        return href ? { text: label, href, newTab } : text(label);
      };
    }
    case 'string': {
      const transform = String(params.transform ?? '');
      return (value) => {
        const shown = stringify(value);
        if (isMissing(value)) return text(shown);
        // Each as the original reads a value that is no text: as JavaScript writes it, or as it is
        switch (transform) {
          case 'lower':
            return text(String(value).toLowerCase());
          case 'upper':
            return text(String(value).toUpperCase());
          case 'title':
            return text(shown.replace(/\w\S*/g, (word) => word[0].toUpperCase() + word.slice(1).toLowerCase()));
          case 'short':
            return text(typeof value === 'string' ? value.replace(/(.).+?\./g, '$1.') : asText(value));
          case 'base64':
            return text(typeof value === 'string' ? decodeBase64(value) : shown);
          case 'urlparam':
            try {
              return text(decodeURIComponent(String(value)));
            } catch {
              return text(shown);
            }
          default:
            return text(shown);
        }
      };
    }
    default:
      return (value) => text(stringify(value));
  }
}

// Whether what the original draws of a value holds a line end: its text, or its link's, picture's or
// sound's address
function breaksLine(part: Formatted): boolean {
  if (part.parts) return part.separator === ',\n';
  const drawn = part.image ? [part.image.src, part.image.alt] : part.audio ? [part.audio.src] : [part.text, part.href];
  return drawn.some((text) => text !== undefined && text.includes('\n'));
}

/**
 * The formatter of a format. A list of values is written as the original's lists are: value by
 * value, each drawn as its format draws it (a link, a picture, a colour), joined by commas.
 */
export function createFormatter(spec: FieldFormatSpec | undefined, settings = DEFAULT_FORMAT_SETTINGS): Formatter {
  const format = single(spec ?? { id: 'string' }, settings);
  const write = (value: unknown, inList: boolean): Formatted => {
    // No value is a dash whatever the format; in a list with a space each side, as the original writes it
    if (isMissing(value)) return { text: inList ? MISSING_IN_LIST : MISSING };
    if (!Array.isArray(value)) return format(value);
    // A list in it value by value too
    const parts = value.map((item) => write(item, true));
    if (parts.length === 1) return parts[0];
    // A line to each value when what is drawn of one of them takes several
    const separator = parts.some(breaksLine) ? ',\n' : ', ';
    return { text: parts.map((part) => part.text).join(separator), parts, separator };
  };
  return (value) => write(value, false);
}

export function formatSpecOf(
  field: Pick<Field, 'name' | 'type' | 'esTypes'> | undefined,
  indexPattern: Pick<IndexPattern, 'fieldFormatMap'> | undefined,
  settings = DEFAULT_FORMAT_SETTINGS
): FieldFormatSpec {
  const own = field ? indexPattern?.fieldFormatMap?.[field.name] : undefined;
  if (own?.id) return own;
  const map = settings.defaultTypeMap;
  const byEsType = field?.esTypes?.map((type) => map[type]).find(Boolean);
  return byEsType ?? (field ? map[field.type] : undefined) ?? map._default_ ?? { id: 'string' };
}

const formatterCache = new WeakMap<object, WeakMap<FormatSettings, Map<string, Formatter>>>();

/**
 * The formatter of a field of an index pattern, made once per pattern and settings: the page's
 * settings are a new object once one of them changes, so a changed default pattern or type map is
 * followed without a reload, as the original's formats read the settings at each value
 */
export function fieldFormatter(
  indexPattern: IndexPattern | undefined,
  fieldName: string,
  settings = DEFAULT_FORMAT_SETTINGS
): Formatter {
  const owner = indexPattern ?? settings;
  let bySettings = formatterCache.get(owner);
  if (!bySettings) {
    bySettings = new WeakMap();
    formatterCache.set(owner, bySettings);
  }
  let byField = bySettings.get(settings);
  if (!byField) {
    byField = new Map();
    bySettings.set(settings, byField);
  }
  let formatter = byField.get(fieldName);
  if (!formatter) {
    const field = indexPattern?.fields.find((candidate) => candidate.name === fieldName);
    formatter = createFormatter(formatSpecOf(field, indexPattern, settings), settings);
    byField.set(fieldName, formatter);
  }
  return formatter;
}

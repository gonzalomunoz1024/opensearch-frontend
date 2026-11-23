/* SPDX-License-Identifier: Apache-2.0 */

/*
 * How a field's values are written: the formats an index pattern can give a field in OpenSearch
 * Dashboards (number, bytes, percent, date, duration, string, URL, colour, ...), read from the
 * same saved settings.
 */

import { DEFAULT_DATE_FORMAT, UNIT_MS, formatDate } from './dates';
import { formatNumber } from './numeral';
import type { Field, FieldFormatSpec, IndexPattern } from './types';

export interface FormatSettings {
  dateFormat: string;
  timeZone?: string;
  numberPattern: string;
  bytesPattern: string;
  percentPattern: string;
  /** The setting format:defaultTypeMap: the format of a kind of field that was given none */
  defaultTypeMap: Record<string, FieldFormatSpec>;
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

/** A value ready to show: text, and what some formats add to it */
export interface Formatted {
  text: string;
  href?: string;
  newTab?: boolean;
  image?: { src: string; width?: number; height?: number };
  color?: string;
  background?: string;
}

export type Formatter = (value: unknown) => Formatted;

export const MISSING = '-';

const isMissing = (value: unknown) => value === null || value === undefined || value === '';

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  if (typeof value === 'boolean') return value ? 1 : 0;
  return undefined;
}

function toDate(value: unknown): Date | undefined {
  if (value instanceof Date) return value;
  if (typeof value === 'number') return new Date(value);
  if (typeof value === 'string') {
    const date = /^-?\d+$/.test(value) ? new Date(Number(value)) : new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  return undefined;
}

export function stringify(value: unknown): string {
  if (isMissing(value)) return MISSING;
  if (typeof value === 'string') return value;
  // As the original's formats write an object: indented by two spaces
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

const DURATION_INPUT_MS: Record<string, number> = {
  picoseconds: 1e-9,
  nanoseconds: 1e-6,
  microseconds: 1e-3,
  milliseconds: 1,
  seconds: 1000,
  minutes: 60000,
  hours: 3600000,
  days: 86400000,
  weeks: 604800000,
  months: 2592000000,
  years: 31536000000,
};

/** "3 hours", "a few seconds": a length of time in words, rounded to its largest unit */
export function humanize(ms: number): string {
  const abs = Math.abs(ms);
  const say = (count: number, one: string, many: string) => (count <= 1 ? one : `${count} ${many}`);
  if (abs < 45 * UNIT_MS.s) return 'a few seconds';
  if (abs < 90 * UNIT_MS.s) return 'a minute';
  if (abs < 45 * UNIT_MS.m) return say(Math.round(abs / UNIT_MS.m), 'a minute', 'minutes');
  if (abs < 90 * UNIT_MS.m) return 'an hour';
  if (abs < 22 * UNIT_MS.h) return say(Math.round(abs / UNIT_MS.h), 'an hour', 'hours');
  if (abs < 36 * UNIT_MS.h) return 'a day';
  if (abs < 26 * UNIT_MS.d) return say(Math.round(abs / UNIT_MS.d), 'a day', 'days');
  if (abs < 46 * UNIT_MS.d) return 'a month';
  if (abs < 320 * UNIT_MS.d) return say(Math.round(abs / UNIT_MS.M), 'a month', 'months');
  if (abs < 548 * UNIT_MS.d) return 'a year';
  return say(Math.round(abs / UNIT_MS.y), 'a year', 'years');
}

export const fromNow = (date: Date, now = new Date()) => {
  const difference = date.getTime() - now.getTime();
  return difference <= 0 ? `${humanize(difference)} ago` : `in ${humanize(difference)}`;
};

const template = (text: string, value: string, raw: string) =>
  text.replace(/\{\{\s*(value|rawValue)\s*\}\}/g, (_match, name: string) => (name === 'value' ? value : raw));

// Only links a page may safely open: a relative address, or http, https or mailto
function safeUrl(url: string): string | undefined {
  const trimmed = url.trim();
  if (/^(https?:|mailto:)/i.test(trimmed)) return trimmed;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return undefined;
  return trimmed;
}

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
        const number = toNumber(value);
        return text(number === undefined ? stringify(value) : formatNumber(number, pattern));
      };
    }
    case 'date':
    case 'date_nanos': {
      const pattern = typeof params.pattern === 'string' && params.pattern ? params.pattern : settings.dateFormat;
      const zone = typeof params.timezone === 'string' && params.timezone ? params.timezone : settings.timeZone;
      return (value) => {
        const date = toDate(value);
        return text(date ? formatDate(date, pattern, zone) : stringify(value));
      };
    }
    case 'relative_date':
      return (value) => {
        const date = toDate(value);
        return text(date ? fromNow(date) : stringify(value));
      };
    case 'duration': {
      const input = DURATION_INPUT_MS[String(params.inputFormat ?? 'seconds')] ?? 1000;
      const output = String(params.outputFormat ?? 'humanize');
      const precision = typeof params.outputPrecision === 'number' ? params.outputPrecision : 2;
      return (value) => {
        const number = toNumber(value);
        if (number === undefined) return text(stringify(value));
        const ms = number * input;
        if (output === 'humanize') return text(humanize(ms));
        const unit = output.replace(/^as/, '').toLowerCase();
        const divisor = DURATION_INPUT_MS[unit];
        return text(divisor ? (ms / divisor).toFixed(precision) : String(ms));
      };
    }
    case 'boolean':
      return (value) => {
        if (typeof value === 'boolean') return text(String(value));
        if (value === 1 || value === '1' || value === 'true' || value === 'yes') return text('true');
        if (value === 0 || value === '0' || value === 'false' || value === 'no') return text('false');
        return text(stringify(value));
      };
    case 'ip':
      return (value) => {
        if (typeof value !== 'number') return text(stringify(value));
        // eslint-disable-next-line no-bitwise
        return text([value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join('.'));
      };
    case 'truncate': {
      const length = Number(params.fieldLength);
      return (value) => {
        const full = stringify(value);
        return text(length > 0 && full.length > length ? `${full.slice(0, length)}...` : full);
      };
    }
    case 'static_lookup': {
      const entries = Array.isArray(params.lookupEntries)
        ? (params.lookupEntries as Array<{ key: unknown; value: unknown }>)
        : [];
      const lookup = new Map(entries.map((entry) => [String(entry.key), String(entry.value)]));
      const unknown = typeof params.unknownKeyValue === 'string' ? params.unknownKeyValue : undefined;
      return (value) => text(lookup.get(String(value)) ?? unknown ?? stringify(value));
    }
    case 'color': {
      const rules = Array.isArray(params.colors)
        ? (params.colors as Array<{ range?: string; regex?: string; text?: string; background?: string }>)
        : [];
      const byRegex = params.fieldType === 'string';
      return (value) => {
        const shown = stringify(value);
        for (const rule of rules) {
          let matches = false;
          if (byRegex) {
            try {
              matches = rule.regex ? new RegExp(rule.regex).test(shown) : false;
            } catch {
              matches = false;
            }
          } else if (rule.range) {
            const number = toNumber(value);
            const [low, high] = rule.range.split(':').map((part) => (part === '' ? NaN : Number(part)));
            matches =
              number !== undefined &&
              (Number.isNaN(low) || number >= low) &&
              (Number.isNaN(high) || number <= high);
          }
          if (matches) return { text: shown, color: rule.text, background: rule.background };
        }
        return text(shown);
      };
    }
    case 'url': {
      const kind = String(params.type ?? 'a');
      const urlTemplate = typeof params.urlTemplate === 'string' ? params.urlTemplate : undefined;
      const labelTemplate = typeof params.labelTemplate === 'string' ? params.labelTemplate : undefined;
      return (value) => {
        const shown = stringify(value);
        if (isMissing(value)) return text(shown);
        const encoded = encodeURIComponent(shown);
        const url = safeUrl(urlTemplate ? template(urlTemplate, encoded, shown) : shown);
        const label = labelTemplate ? template(labelTemplate, shown, shown) : shown;
        if (!url) return text(label);
        if (kind === 'img') {
          return {
            text: label,
            image: {
              src: url,
              width: Number(params.width) || undefined,
              height: Number(params.height) || undefined,
            },
          };
        }
        return { text: label, href: url, newTab: params.openLinkInCurrentTab !== true };
      };
    }
    case 'string': {
      const transform = String(params.transform ?? '');
      return (value) => {
        const shown = stringify(value);
        if (isMissing(value)) return text(shown);
        switch (transform) {
          case 'lower':
            return text(shown.toLowerCase());
          case 'upper':
            return text(shown.toUpperCase());
          case 'title':
            return text(shown.replace(/\w\S*/g, (word) => word[0].toUpperCase() + word.slice(1).toLowerCase()));
          case 'short':
            return text(shown.replace(/(\w)\w*\./g, '$1.'));
          case 'base64':
            try {
              return text(atob(shown));
            } catch {
              return text(shown);
            }
          case 'urlparam':
            try {
              return text(decodeURIComponent(shown));
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

/** The formatter of a format. A list of values is written value by value, joined by commas. */
export function createFormatter(spec: FieldFormatSpec | undefined, settings = DEFAULT_FORMAT_SETTINGS): Formatter {
  const one = single(spec ?? { id: 'string' }, settings);
  return (value) => {
    if (isMissing(value)) return { text: MISSING };
    if (Array.isArray(value)) {
      if (value.length === 1) return one(value[0]);
      const parts = value.map((item) => one(item));
      // As the original joins a list: a line to each value when one of them takes several
      const separator = parts.some((part) => part.text.includes('\n')) ? ',\n' : ', ';
      return { ...parts[0], text: parts.map((part) => part.text).join(separator), href: undefined, image: undefined };
    }
    return one(value);
  };
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

const formatterCache = new WeakMap<object, Map<string, Formatter>>();

/** The formatter of a field of an index pattern, made once per pattern and settings */
export function fieldFormatter(
  indexPattern: IndexPattern | undefined,
  fieldName: string,
  settings = DEFAULT_FORMAT_SETTINGS
): Formatter {
  const owner = indexPattern ?? settings;
  let byField = formatterCache.get(owner);
  if (!byField) {
    byField = new Map();
    formatterCache.set(owner, byField);
  }
  const key = `${fieldName}\u0000${settings.dateFormat}\u0000${settings.timeZone ?? ''}`;
  let formatter = byField.get(key);
  if (!formatter) {
    const field = indexPattern?.fields.find((candidate) => candidate.name === fieldName);
    formatter = createFormatter(formatSpecOf(field, indexPattern, settings), settings);
    byField.set(key, formatter);
  }
  return formatter;
}

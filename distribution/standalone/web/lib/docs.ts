/* SPDX-License-Identifier: Apache-2.0 */

/* Documents as a search returns them, made flat: one value per field name, dotted for nesting. */

import type { Field, IndexPattern } from './types';

export interface RawHit {
  _index: string;
  _id: string;
  _score?: number | null;
  _type?: string;
  _source?: Record<string, unknown>;
  fields?: Record<string, unknown[]>;
  highlight?: Record<string, string[]>;
  sort?: unknown[];
}

export const HIGHLIGHT_PRE = '@opensearch-dashboards-highlighted-field@';
export const HIGHLIGHT_POST = '@/opensearch-dashboards-highlighted-field@';

const flatCache = new WeakMap<RawHit, Record<string, unknown>>();

function flattenInto(out: Record<string, unknown>, value: unknown, prefix: string, isField: (name: string) => boolean) {
  if (value === null || value === undefined) {
    if (prefix) add(out, prefix, value);
    return;
  }
  if (Array.isArray(value)) {
    // A list of objects gives each inner field the list of its values
    if (value.some((item) => item !== null && typeof item === 'object' && !Array.isArray(item)) && !isField(prefix)) {
      for (const item of value) flattenInto(out, item, prefix, isField);
    } else add(out, prefix, value);
    return;
  }
  if (typeof value === 'object' && !isField(prefix)) {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0 && prefix) add(out, prefix, value);
    for (const [key, inner] of entries) flattenInto(out, inner, prefix ? `${prefix}.${key}` : key, isField);
    return;
  }
  add(out, prefix, value);
}

function add(out: Record<string, unknown>, key: string, value: unknown) {
  if (!(key in out)) out[key] = value;
  else {
    const current = out[key];
    out[key] = (Array.isArray(current) ? current : [current]).concat(value);
  }
}

/** A hit as field name to value: its source made flat, the computed fields, and what identifies it */
export function flattenHit(hit: RawHit, indexPattern?: IndexPattern): Record<string, unknown> {
  const cached = flatCache.get(hit);
  if (cached) return cached;
  const flat: Record<string, unknown> = {};
  // A field that holds an object as one value (a geo point written as lat and lon) stays whole
  const whole = new Set(
    (indexPattern?.fields ?? [])
      .filter((field) => field.type === 'geo_point' || field.type === 'geo_shape')
      .map((field) => field.name)
  );
  flattenInto(flat, hit._source ?? {}, '', (name) => whole.has(name));
  for (const [key, values] of Object.entries(hit.fields ?? {})) {
    if (key.startsWith('_')) continue;
    flat[key] = Array.isArray(values) && values.length === 1 ? values[0] : values;
  }
  flat._id = hit._id;
  flat._index = hit._index;
  flat._score = hit._score ?? null;
  if (hit._type !== undefined) flat._type = hit._type;
  flatCache.set(hit, flat);
  return flat;
}

/** The phrases a search marked in a field, without the marks */
export function highlightsOf(hit: RawHit, fieldName: string): string[] {
  const found = new Set<string>();
  for (const snippet of hit.highlight?.[fieldName] ?? []) {
    const pattern = new RegExp(`${HIGHLIGHT_PRE}(.*?)${HIGHLIGHT_POST}`, 'g');
    let match = pattern.exec(snippet);
    while (match) {
      if (match[1]) found.add(match[1]);
      match = pattern.exec(snippet);
    }
  }
  return [...found];
}

/** A text cut where the phrases are, so that they can be drawn marked */
export function splitHighlights(text: string, phrases: string[]): Array<{ text: string; marked: boolean }> {
  if (phrases.length === 0 || text === '') return [{ text, marked: false }];
  const escaped = phrases
    .sort((a, b) => b.length - a.length)
    .map((phrase) => phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`(${escaped.join('|')})`, 'g');
  return text
    .split(pattern)
    .filter((part) => part !== '')
    .map((part) => ({ text: part, marked: phrases.includes(part) }));
}

/** The fields of an index pattern a page lists: none of those its source filters hide */
export function shownFields(indexPattern: IndexPattern): Field[] {
  const filters = (indexPattern.sourceFilters ?? []).map(
    (filter) => new RegExp(`^${filter.value.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`)
  );
  return indexPattern.fields.filter((field) => !filters.some((filter) => filter.test(field.name)));
}

/**
 * A text of a CSV cell that a spreadsheet would run as a formula, made plain text. A number below
 * zero and the "-" of a missing value start with a sign too, and stay the values they are
 */
export function formulaSafe(text: string): string {
  const signedNumber = /^[-+]\p{Sc}?([\d.,\s]*\d[\d.,\s]*[%\p{L}\p{Sc}°]*)?$/u.test(text);
  return /^[=+\-@\t\r]/.test(text) && !signedNumber ? `'${text}` : text;
}

/** A value as one cell of a CSV file */
export function csvCell(value: unknown, separator: string, quote: boolean): string {
  let text: string;
  if (value === null || value === undefined) text = '';
  else if (typeof value === 'object') text = JSON.stringify(value);
  else text = String(value);
  // A cell that a spreadsheet would run as a formula is made plain text. A number below zero and
  // the "-" of a missing value start with a sign too, and stay the values they are
  const signedNumber = /^[-+]\p{Sc}?([\d.,\s]*\d[\d.,\s]*[%\p{L}\p{Sc}°]*)?$/u.test(text);
  if (/^[=+\-@\t\r]/.test(text) && !signedNumber && typeof value === 'string') text = `'${text}`;
  const needsQuote = quote || text.includes(separator) || /["\n\r]/.test(text);
  return needsQuote ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header: string[], rows: unknown[][], separator = ',', quote = true): string {
  const lines = [header.map((cell) => csvCell(cell, separator, quote)).join(separator)];
  for (const row of rows) lines.push(row.map((cell) => csvCell(cell, separator, quote)).join(separator));
  return `${lines.join('\r\n')}\r\n`;
}

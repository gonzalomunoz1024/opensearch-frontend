/* SPDX-License-Identifier: Apache-2.0 */

/* What to offer while a DQL query is typed: a field, an operator, a value, or "and"/"or". */

import type { Field } from './types';

export interface SuggestContext {
  kind: 'field' | 'value' | 'conjunction';
  /** What has been typed of it */
  prefix: string;
  /** The part of the text a suggestion replaces */
  start: number;
  end: number;
  /** For a value: the field it is a value of */
  fieldName?: string;
  /** For a value: whether it began with a quote */
  quoted?: boolean;
}

const WORD = '[\\w.@*-]';
const VALUE = new RegExp(`(?:^|[\\s(])(${WORD}+)\\s*:\\s*("?)([^"()]*)$`);
const PARTIAL = new RegExp(`(?:^|[\\s(])(${WORD}*)$`);

export function suggestContext(text: string, cursor: number): SuggestContext | undefined {
  const before = text.slice(0, cursor);
  // Inside a pair of quotes that is closed, nothing is being typed
  const value = VALUE.exec(before);
  if (value) {
    const [, fieldName, quote, typed] = value;
    // An unquoted value ends at a space: after it comes "and" or "or"
    if (quote || !/\s/.test(typed)) {
      return {
        kind: 'value',
        prefix: typed,
        start: cursor - typed.length - quote.length,
        end: cursor,
        fieldName,
        quoted: quote !== '',
      };
    }
  }
  const partial = PARTIAL.exec(before);
  if (!partial) return undefined;
  const word = partial[1];
  const start = cursor - word.length;
  const preceding = before.slice(0, start).trimEnd();
  const lastWord = /(\S+)$/.exec(preceding)?.[1]?.toLowerCase();
  const startsExpression =
    preceding === '' || preceding.endsWith('(') || lastWord === 'and' || lastWord === 'or' || lastWord === 'not';
  if (startsExpression) return { kind: 'field', prefix: word, start, end: cursor };
  // After a whole expression: a field name is not expected, a conjunction is
  if (/[:<>=]$/.test(preceding)) return undefined;
  return { kind: 'conjunction', prefix: word, start, end: cursor };
}

export interface Suggestion {
  kind: 'field' | 'value' | 'conjunction' | 'operator';
  /** What is shown */
  label: string;
  /** What replaces the typed part */
  insert: string;
  detail?: string;
}

export function fieldSuggestions(fields: Field[], prefix: string, limit = 50): Suggestion[] {
  const needle = prefix.toLowerCase();
  return fields
    .filter(
      (field) =>
        field.searchable !== false &&
        !field.name.startsWith('_') &&
        field.type !== '_source' &&
        field.name.toLowerCase().includes(needle)
    )
    .sort((a, b) => {
      const left = Number(b.name.toLowerCase().startsWith(needle)) - Number(a.name.toLowerCase().startsWith(needle));
      return left !== 0 ? left : a.name.localeCompare(b.name);
    })
    .slice(0, limit)
    .map((field) => ({
      kind: 'field' as const,
      label: field.name,
      insert: `${field.name}:`,
      detail: field.type,
    }));
}

export function conjunctionSuggestions(prefix: string): Suggestion[] {
  return [
    { kind: 'conjunction' as const, label: 'and', insert: 'and ', detail: 'Requires both sides to be true' },
    { kind: 'conjunction' as const, label: 'or', insert: 'or ', detail: 'Requires either side to be true' },
  ].filter((item) => item.label.startsWith(prefix.toLowerCase()));
}

/** A value as DQL writes it: quoted when it is not one plain word */
export function quoteValue(value: string | number | boolean): string {
  if (typeof value !== 'string') return String(value);
  return /^[\w.@-]+$/.test(value) ? value : `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function valueSuggestions(values: Array<string | number | boolean>): Suggestion[] {
  return values.map((value) => ({
    kind: 'value' as const,
    label: String(value),
    insert: `${quoteValue(value)} `,
  }));
}

/** The request that lists the values of a field that start with what was typed */
export function valuesRequest(field: Field, prefix: string, size = 10): Record<string, unknown> | undefined {
  if (!field.aggregatable || field.type !== 'string') return undefined;
  const escaped = prefix.replace(/[.?+*|{}[\]()"\\#@&<>~]/g, '\\$&');
  return {
    size: 0,
    timeout: '1s',
    terminate_after: 100000,
    aggs: {
      suggestions: {
        terms: { field: field.name, include: `${escaped}.*`, execution_hint: 'map', shard_size: size, size },
      },
    },
  };
}

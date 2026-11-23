/* SPDX-License-Identifier: Apache-2.0 */

/*
 * What the query bar of OpenSearch Dashboards does with what is typed into it: the text read as a
 * query (a JSON object, or nothing when it is only spaces) and written back, the pairs of quotes
 * and brackets it closes as they are opened, the searches it remembers for each page and
 * language, and the keys that move through its list of suggestions.
 */

/** A query as the bar reads it from the text: nothing for blanks, an object for JSON, else the text */
export function fromUser(input: unknown): unknown {
  // What has nothing in it is the empty query, a number and a boolean too (lodash's isEmpty)
  if (input === null || typeof input !== 'object' && typeof input !== 'string') return '';
  if (typeof input === 'object') return Object.keys(input).length === 0 ? '' : input;
  const trimmed = input.trim();
  if (trimmed.length === 0) return '';
  if (trimmed[0] === '{') {
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      return input;
    }
  }
  return input;
}

/** A query as the bar shows it: a Lucene query_string's text, any other object as JSON */
export function toUser(query: unknown): string {
  if (query === null || query === undefined) return '';
  if (typeof query === 'object') {
    const queryString = (query as { query_string?: { query?: unknown } }).query_string;
    if (queryString) return toUser(queryString.query);
    return JSON.stringify(query);
  }
  return String(query);
}

/** The text a typed text becomes in the bar: what is kept of it read back */
export const normalizeQueryText = (text: string): string => toUser(fromUser(text));

const PAIRS = ['()', '[]', '{}', "''", '""'];
const OPENERS = PAIRS.map((pair) => pair[0]);
const CLOSERS = PAIRS.map((pair) => pair[1]);
const isAlphanumeric = (character: string) => /[a-zA-Z0-9_]/.test(character);

export interface TextEdit {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

/**
 * The edit a key makes when it opens or closes a pair: a closer typed before the same closer
 * steps over it, an opener wraps the selection in the pair (a quote only away from a word), and
 * Backspace between the two of a pair takes both. Nothing for any other key.
 */
export function matchPairs(
  key: string,
  metaKey: boolean,
  value: string,
  selectionStart: number,
  selectionEnd: number
): TextEdit | undefined {
  const collapsed = selectionStart === selectionEnd;
  if (CLOSERS.includes(key) && collapsed && value.charAt(selectionEnd) === key) {
    return { value, selectionStart: selectionStart + 1, selectionEnd: selectionEnd + 1 };
  }
  if (OPENERS.includes(key)) {
    const preceding = value.charAt(selectionStart - 1);
    const following = value.charAt(selectionStart + 1);
    const insert =
      !collapsed ||
      (preceding !== '\\' &&
        !(['"', "'"].includes(key) && (isAlphanumeric(preceding) || isAlphanumeric(following))));
    if (insert) {
      return {
        value: `${value.slice(0, selectionStart)}${key}${value.slice(selectionStart, selectionEnd)}${
          CLOSERS[OPENERS.indexOf(key)]
        }${value.slice(selectionEnd)}`,
        selectionStart: selectionStart + 1,
        selectionEnd: selectionEnd + 1,
      };
    }
  }
  if (key === 'Backspace' && !metaKey && collapsed && PAIRS.includes(value.substr(selectionEnd - 1, 2))) {
    return {
      value: value.slice(0, selectionEnd - 1) + value.slice(selectionEnd + 1),
      selectionStart: selectionStart - 1,
      selectionEnd: selectionEnd - 1,
    };
  }
  return undefined;
}

/** The page a query bar searches, as it is named in the bar's labels and in its recent searches */
export function queryAppName(pathname: string): string {
  const app = /\/app\/([^/?#]+)/.exec(pathname)?.[1] ?? '';
  if (app === 'data-explorer' || app === 'discover') return 'discover';
  if (app === 'dashboards') return 'dashboard';
  return app;
}

/** A log of searches after one more: the newest first, each once, no longer than the limit */
export function addToLog(items: unknown[], value: unknown, maxLength: number): unknown[] {
  if (value === null || value === undefined) return items;
  const key = JSON.stringify(value);
  const kept = [value, ...items.filter((item) => JSON.stringify(item) !== key)];
  return Number.isFinite(maxLength) && maxLength > 0 ? kept.slice(0, maxLength) : kept;
}

/** The searches of a log that contain what is typed, as the bar offers them; empty ones are not */
export function matchingSearches(items: unknown[], typed: string): string[] {
  return items.map((item) => toUser(item)).filter((text) => text.trim() !== '' && text.includes(typed));
}

/** A search made before, offered under the bar in place of the whole text */
export interface RecentSuggestion {
  type: 'recentSearch';
  text: string;
  start: number;
  end: number;
}

/**
 * All the list under the bar offers, as the original's query string input: the searches made
 * before that hold the text, in DQL as in Lucene. Its DQL suggestions are asked without the
 * services they need and come back empty, so no field, value or conjunction is offered.
 */
export function barSuggestions(items: unknown[], typed: string): RecentSuggestion[] {
  return matchingSearches(items, typed).map((text) => ({ type: 'recentSearch', text, start: 0, end: typed.length }));
}

/** The suggestion the arrow keys move to: the list wraps round at both ends */
export function stepIndex(index: number, count: number, step: 1 | -1): number {
  if (count <= 0) return 0;
  const next = index + step;
  if (next >= count) return 0;
  if (next < 0) return count - 1;
  return next;
}

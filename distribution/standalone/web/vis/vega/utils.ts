/* SPDX-License-Identifier: Apache-2.0 */

/* Small helpers of the Vega drawing, each as the original has it. */

import { compactJson } from '../../lib/compact_json';

/** A warning's text: the message, then what came with it as compact JSON */
export function formatWarningToStr(...args: unknown[]): unknown {
  let value = args[0];
  if (args.length >= 2) {
    try {
      if (typeof args[1] === 'string') value = `${String(value)}\n${args[1]}`;
      else value = `${String(value)}\n${compactJson(args[1], { maxLength: 70 })}`;
    } catch {
      // as it came
    }
  }
  return value;
}

/** An error's text: its message, or ERR when there is none */
export function formatErrorToStr(...args: unknown[]): unknown {
  let error: unknown = args[0];
  if (!error) error = 'ERR';
  else if (error instanceof Error) error = error.message;
  return formatWarningToStr(error, ...args.slice(1));
}

/** An object written as `{…}`, not an array, a date or the instance of a class */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Object.prototype.toString.call(value) !== '[object Object]') return false;
  const proto = Object.getPrototypeOf(value) as object | null;
  return proto === null || proto === Object.prototype;
}

/** Empty as lodash's isEmpty has it: nothing, no characters, no items, no keys, or not a collection */
export function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string' || Array.isArray(value)) return value.length === 0;
  if (value instanceof Map || value instanceof Set) return value.size === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return true;
}

/** What a message shows: the text a list of values reads as in a page */
export const messageText = (value: unknown): string => (typeof value === 'string' ? value : String(value));

/** Characters that would be read as markup, written as entities, as lodash's escape writes them */
export function escapeHtml(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);
}

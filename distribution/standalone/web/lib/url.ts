/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Addresses, as OpenSearch Dashboards writes them, so that a bookmark or a link in a markdown
 * panel made there opens the same thing here: an application is a path (`/app/dashboards`),
 * where it stands is the fragment (`#/view/<id>`), and its state travels as rison in the
 * fragment's query (`?_g=(...)&_a=(...)`).
 */

import { encode as encodeRison, tryDecode, type RisonValue } from './rison';

export interface AppLocation {
  /** The path after the base path: `/app/dashboards` */
  pathname: string;
  /** The query of the path itself, without the question mark */
  search: string;
  /** The fragment's path: `/view/<id>`; `/` when there is none */
  hashPath: string;
  /** The fragment's query, decoded but not yet read as rison */
  hashParams: Record<string, string>;
}

/** Escapes what a query value must escape and leaves rison's own punctuation readable. */
export function encodeQueryValue(value: string): string {
  return encodeURIComponent(value)
    .replace(/%40/g, '@')
    .replace(/%3A/gi, ':')
    .replace(/%24/g, '$')
    .replace(/%2C/gi, ',')
    .replace(/%2F/gi, '/')
    .replace(/[!'()*]/g, (char) => (char === '*' ? '%2A' : char));
}

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text.replace(/\+/g, ' '));
  } catch {
    return text;
  }
}

export function parseQuery(query: string): Record<string, string> {
  const params: Record<string, string> = {};
  for (const pair of query.replace(/^\?/, '').split('&')) {
    if (!pair) continue;
    const at = pair.indexOf('=');
    const key = safeDecode(at === -1 ? pair : pair.slice(0, at));
    params[key] = at === -1 ? '' : safeDecode(pair.slice(at + 1));
  }
  return params;
}

export function buildQuery(params: Record<string, string | undefined>): string {
  return Object.entries(params)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeQueryValue(value)}`)
    .join('&');
}

export function parseHash(hash: string): Pick<AppLocation, 'hashPath' | 'hashParams'> {
  const text = hash.replace(/^#/, '');
  const at = text.indexOf('?');
  const path = at === -1 ? text : text.slice(0, at);
  return {
    hashPath: path.startsWith('/') ? path : `/${path}`,
    hashParams: at === -1 ? {} : parseQuery(text.slice(at + 1)),
  };
}

export function buildHash(hashPath: string, params: Record<string, string | undefined>): string {
  const query = buildQuery(params);
  if (!query && (hashPath === '/' || hashPath === '')) return '';
  return `#${hashPath || '/'}${query ? `?${query}` : ''}`;
}

export function parseLocation(
  basePath: string,
  location: { pathname: string; search: string; hash: string }
): AppLocation {
  let pathname = location.pathname;
  if (basePath && pathname.startsWith(basePath)) pathname = pathname.slice(basePath.length);
  if (pathname.length > 1) pathname = pathname.replace(/\/+$/, '');
  return {
    pathname: pathname || '/',
    search: location.search.replace(/^\?/, ''),
    ...parseHash(location.hash),
  };
}

/** A state object as the value of `_g` or `_a` */
export function encodeState(state: unknown): string {
  // What cannot travel (undefined, functions) is dropped as JSON drops it
  return encodeRison(JSON.parse(JSON.stringify(state ?? null)) as RisonValue);
}

export function decodeState<T>(raw: string | undefined): Partial<T> {
  if (!raw) return {};
  const value = tryDecode(raw);
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Partial<T>)
    : {};
}

/** The address of an application with a place in it and state: what a link is made of */
export function appUrl(
  pathname: string,
  hashPath = '/',
  state: Record<string, unknown> = {}
): string {
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(state)) {
    if (value !== undefined) params[key] = typeof value === 'string' ? value : encodeState(value);
  }
  return `${pathname}${buildHash(hashPath, params)}`;
}

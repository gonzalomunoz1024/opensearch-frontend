/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The text of the console: where its requests are, how one is laid out again, sent, copied as
 * cURL or read from cURL, how it is coloured, and what could be typed next.
 */

import type { CodeToken } from '../../components/code_editor';
import {
  collapseLiteralStrings,
  expandLiteralStrings,
  reindentJson,
  tokenizeJsonLine,
  type JsonState,
} from '../../lib/json_text';

export const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'HEAD', 'PATCH', 'OPTIONS'];
const REQUEST_LINE = /^\s*(GET|POST|PUT|DELETE|HEAD|PATCH|OPTIONS)\s+(\S.*?)\s*$/i;
const isComment = (line: string) => /^\s*(#|\/\/)/.test(line);

export const DEFAULT_TEXT = `GET _search
{
  "query": {
    "match_all": {}
  }
}`;

// --- Requests ----------------------------------------------------------------------------------

export interface ConsoleRequest {
  method: string;
  url: string;
  /** The documents of the body as they are written: one, or several for `_bulk` */
  data: string[];
  /** Lines counted from 0 */
  startLine: number;
  endLine: number;
}

/** The line a JSON document that starts on `from` closes on: the last line when it never does */
function documentEnd(lines: string[], from: number): number {
  const state: JsonState = { depth: 0, triple: false };
  for (let row = from; row < lines.length; row += 1) {
    tokenizeJsonLine(lines[row], state);
    if (state.depth === 0 && !state.triple) return row;
  }
  return lines.length - 1;
}

/**
 * The requests of a text. A request is a line with a method and a path; its body starts on the
 * very next line with a brace, and a further document starts on the line after one closes.
 */
export function parseRequests(text: string): ConsoleRequest[] {
  const lines = text.split('\n');
  const requests: ConsoleRequest[] = [];
  let row = 0;
  while (row < lines.length) {
    const match = isComment(lines[row]) ? null : REQUEST_LINE.exec(lines[row]);
    if (!match) {
      row += 1;
      continue;
    }
    const request: ConsoleRequest = { method: match[1].toUpperCase(), url: match[2], data: [], startLine: row, endLine: row };
    let next = row + 1;
    while (next < lines.length && lines[next].trim().startsWith('{')) {
      const end = documentEnd(lines, next);
      request.data.push(lines.slice(next, end + 1).join('\n').trim());
      request.endLine = end;
      next = end + 1;
    }
    requests.push(request);
    row = next;
  }
  return requests;
}

/** The requests a selection touches; a cursor between two requests is on none */
export function requestsInRange(requests: ConsoleRequest[], fromLine: number, toLine = fromLine): ConsoleRequest[] {
  return requests.filter((request) => request.endLine >= fromLine && request.startLine <= toLine);
}

/** The offsets of the first character of a request and of the end of its last line */
export function requestOffsets(text: string, request: ConsoleRequest): [number, number] {
  const lines = text.split('\n');
  let start = 0;
  for (let row = 0; row < request.startLine; row += 1) start += lines[row].length + 1;
  let end = start;
  for (let row = request.startLine; row <= request.endLine; row += 1) end += lines[row].length + 1;
  return [start, end - 1];
}

export const lineOf = (text: string, offset: number) => {
  let line = 0;
  for (let at = text.indexOf('\n'); at !== -1 && at < offset; at = text.indexOf('\n', at + 1)) line += 1;
  return line;
};

/** What is sent as the body: the documents one under the other, triple quotes as JSON strings */
export function bodyOf(request: ConsoleRequest): string {
  const data = collapseLiteralStrings(request.data.join('\n'));
  return data ? `${data}\n` : '';
}

function formatDocuments(data: string[], indent: boolean): { changed: boolean; data: string[] } {
  let changed = false;
  const formatted = data.map((document) => {
    try {
      let next = reindentJson(collapseLiteralStrings(document), indent);
      if (indent) next = expandLiteralStrings(next);
      changed = changed || next !== document;
      return next;
    } catch {
      return document;
    }
  });
  return { changed, data: formatted };
}

/**
 * A request laid out again: one document is spread over lines, several are put on a line each;
 * a request already laid out so goes the other way.
 */
export function autoIndent(request: ConsoleRequest): string {
  let indent = request.data.length === 1;
  let formatted = formatDocuments(request.data, indent);
  if (!formatted.changed) {
    indent = !indent;
    formatted = formatDocuments(request.data, indent);
  }
  return [`${request.method} ${request.url}`, ...formatted.data].join('\n');
}

/** The text with one request replaced, and where the request now ends */
export function replaceRequest(text: string, request: ConsoleRequest, replacement: string): string {
  const [start, end] = requestOffsets(text, request);
  return `${text.slice(0, start)}${replacement}${text.slice(end)}`;
}

/** The text with a request from the history put where the cursor is, and the place of its first line */
export function insertRequest(
  text: string,
  cursorLine: number,
  past: { method: string; endpoint: string; data?: string }
): { text: string; offset: number } {
  const lines = text.split('\n');
  const requests = parseRequests(text);
  const here = requestsInRange(requests, cursorLine)[0];
  let line = cursorLine;
  let atEnd = false;
  let prefix = '';
  let suffix = '\n';
  if (here && here.startLine === cursorLine) {
    // On the first line of a request: the new one goes before it
    suffix += '\n';
  } else if (here) {
    // In a request, or on its last line: the new one goes after it
    line = here.endLine;
    atEnd = true;
    prefix = '\n\n';
  }
  let offset = 0;
  for (let row = 0; row < line; row += 1) offset += lines[row].length + 1;
  if (atEnd) offset += lines[line].length;
  let inserted = `${prefix}${past.method} ${past.endpoint}`;
  if (past.data) inserted += `\n${past.data}`;
  inserted += suffix;
  return { text: `${text.slice(0, offset)}${inserted}${text.slice(offset)}`, offset: offset + prefix.length };
}

// --- cURL --------------------------------------------------------------------------------------

/** A request as a cURL command against the OpenSearch the product talks to */
export function toCurl(request: ConsoleRequest, host: string): string {
  const url = `${host.replace(/\/+$/, '')}/${request.url.replace(/^\/+/, '')}`;
  let command = `curl -X${request.method} "${url}"`;
  if (request.data.length) {
    command += " -H 'Content-Type: application/json' -d'\n";
    // Console has no single-quoted strings, so a single quote is inside a string
    command += collapseLiteralStrings(request.data.join('\n')).replace(/'/g, '\\"');
    if (request.data.length > 1) command += '\n';
    command += "'";
  }
  return command;
}

export const looksLikeCurl = (text: string) => /^\s*curl\s+/.test(text);

// One argument of a command line: quoted, or up to the next space
function shellWords(command: string): string[] {
  const words: string[] = [];
  let at = 0;
  while (at < command.length) {
    while (at < command.length && /\s/.test(command[at])) at += 1;
    if (at >= command.length) break;
    let word = '';
    while (at < command.length && !/\s/.test(command[at])) {
      const quote = command[at];
      if (quote === "'" || quote === '"') {
        let end = at + 1;
        while (end < command.length && command[end] !== quote) {
          if (quote === '"' && command[end] === '\\' && end + 1 < command.length) {
            word += command[end + 1];
            end += 2;
          } else {
            word += command[end];
            end += 1;
          }
        }
        at = end + 1;
      } else if (command[at] === '\\' && command[at + 1] === '\n') {
        at += 2;
      } else {
        word += command[at];
        at += 1;
      }
    }
    words.push(word);
  }
  return words;
}

/** cURL commands as console requests: what pasting a command into the console writes */
export function parseCurl(text: string): string {
  const commands = text.split(/^\s*(?=curl\s)/m).filter((part) => looksLikeCurl(part));
  return commands
    .map((command) => {
      const words = shellWords(command.trim()).slice(1);
      let method: string | undefined;
      let url = '';
      const bodies: string[] = [];
      for (let index = 0; index < words.length; index += 1) {
        const word = words[index];
        if (word === '-X' || word === '--request') {
          method = words[(index += 1)];
        } else if (/^-X\S/.test(word)) {
          method = word.slice(2);
        } else if (/^(-d|--data|--data-raw|--data-binary|--data-ascii)$/.test(word)) {
          bodies.push(words[(index += 1)] ?? '');
        } else if (/^-d./.test(word)) {
          bodies.push(word.slice(2));
        } else if (/^(-H|--header|-u|--user|-o|--output|--cacert|--cert|--key|-A|--user-agent)$/.test(word)) {
          index += 1;
        } else if (!word.startsWith('-') && !url) {
          url = word;
        }
      }
      // The address without its scheme and host, which the console does not write
      const path =
        url
          .replace(/^[a-z]+:\/\/[^/]*\/?/i, '')
          .replace(/^(?:localhost|[\w-]+(?:\.[\w-]+)+|[\w.-]+:\d+)(?::\d+)?(?:\/|$)/i, '')
          .replace(/^\/+/, '') || '/';
      const body = bodies.join('\n').trim();
      const verb = (method ?? (body ? 'POST' : 'GET')).toUpperCase();
      return body ? `${verb} ${path}\n${body}` : `${verb} ${path}`;
    })
    .join('\n\n');
}

// --- Answers -----------------------------------------------------------------------------------

function splitOnUnquotedCommaSpace(text: string): string[] {
  let quoted = false;
  const parts: string[] = [];
  let buffer = '';
  let at = 0;
  while (at < text.length) {
    let token = text.charAt(at);
    at += 1;
    if (token === '\\' && at < text.length) {
      token += text.charAt(at);
      at += 1;
    } else if (token === ',' && at < text.length && text.charAt(at) === ' ') {
      token += text.charAt(at);
      at += 1;
    }
    if (token === '"') quoted = !quoted;
    else if (!quoted && token === ', ') {
      parts.push(buffer);
      buffer = '';
      continue;
    }
    buffer += token;
  }
  parts.push(buffer);
  return parts;
}

/** The warnings OpenSearch sends in a header, as the comment lines the answer starts with */
export function deprecationMessages(warnings: string): string[] {
  const pattern =
    /\d{3} [0-9a-zA-Z!#$%&'*+-.^_`|~]+ "((?:\t| |!|[\x23-\x5b]|[\x5d-\x7e]|[\x80-\xff]|\\\\|\\")*)"(?: "[^"]*")?/;
  return splitOnUnquotedCommaSpace(warnings).map((warning) => {
    const match = pattern.exec(warning);
    const message = match ? match[1].replace(/\\\\/g, '\\').replace(/\\"/g, '"') : warning;
    return `#! Deprecation: ${message}`;
  });
}

/** An answer as it is shown: JSON spread over lines, anything else as it came */
export function formatAnswer(
  text: string,
  contentType: string,
  options: { warnings?: string | null; tripleQuotes?: boolean; heading?: string } = {}
): string {
  let value = text;
  if (contentType.includes('application/json')) {
    try {
      value = reindentJson(text, true);
      if (options.tripleQuotes) value = expandLiteralStrings(value);
    } catch {
      value = text;
    }
  }
  if (options.warnings) value = `${deprecationMessages(options.warnings).join('\n')}\n${value}`;
  if (options.heading) value = `# ${options.heading}\n${value}`;
  return value;
}

// --- Colours -----------------------------------------------------------------------------------

/** The text of the editor as lines of coloured runs */
export function tokenizeConsole(text: string): CodeToken[][] {
  const state: JsonState = { depth: 0, triple: false };
  return text.split('\n').map((line) => {
    if (state.depth > 0 || state.triple) return tokenizeJsonLine(line, state);
    if (isComment(line)) return [{ text: line, kind: 'Comment' }];
    const match = /^(\s*)(GET|POST|PUT|DELETE|HEAD|PATCH|OPTIONS)(\s+)(.*)$/i.exec(line);
    if (match) {
      const tokens: CodeToken[] = [];
      if (match[1]) tokens.push({ text: match[1] });
      tokens.push({ text: match[2], kind: 'Method' }, { text: match[3] });
      if (match[4]) tokens.push({ text: match[4], kind: 'Url' });
      return tokens;
    }
    if (line.trim().startsWith('{')) return tokenizeJsonLine(line, state);
    return [{ text: line }];
  });
}

/** An answer as lines of coloured runs: comment lines, then JSON or plain text */
export function tokenizeAnswer(text: string): CodeToken[][] {
  const state: JsonState = { depth: 0, triple: false };
  const lines = text.split('\n');
  const json = lines.some((line) => /^\s*[{[]/.test(line));
  return lines.map((line) => {
    if (state.depth === 0 && !state.triple && line.startsWith('#')) return [{ text: line, kind: 'Comment' }];
    return json ? tokenizeJsonLine(line, state) : [{ text: line }];
  });
}

// --- History -----------------------------------------------------------------------------------

export interface PastRequest {
  time: number;
  endpoint: string;
  method: string;
  data?: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "a few seconds ago", "5 minutes ago": how long ago something of the last week was */
export function timeAgo(time: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - time) / 1000));
  if (seconds < 45) return 'a few seconds ago';
  if (seconds < 90) return 'a minute ago';
  const minutes = Math.round(seconds / 60);
  if (minutes < 45) return `${minutes} minutes ago`;
  if (minutes < 90) return 'an hour ago';
  const hours = Math.round(minutes / 60);
  if (hours < 22) return `${hours} hours ago`;
  if (hours < 36) return 'a day ago';
  return `${Math.round(hours / 24)} days ago`;
}

/** The line a past request is listed as: its path and when it was sent */
export function describePast(request: PastRequest, now: number): string {
  const date = new Date(request.time);
  const when = now - request.time < 7 * 86400000 ? timeAgo(request.time, now) : `${MONTHS[date.getMonth()]} ${date.getDate()}`;
  return `${request.endpoint} (${when})`;
}

// --- What could be typed next ------------------------------------------------------------------

type Tree = { [segment: string]: Tree };
const LEAF: Tree = {};
const named = (under: Tree = LEAF): Tree => ({ '*': under });

/** The paths of OpenSearch that do not start with the name of an index */
const ROOT: Tree = {
  _search: { scroll: LEAF, template: LEAF },
  _count: LEAF,
  _msearch: LEAF,
  _bulk: LEAF,
  _mget: LEAF,
  _refresh: LEAF,
  _flush: LEAF,
  _forcemerge: LEAF,
  _analyze: LEAF,
  _aliases: LEAF,
  _alias: named(),
  _mapping: LEAF,
  _settings: LEAF,
  _stats: LEAF,
  _segments: LEAF,
  _recovery: LEAF,
  _field_caps: LEAF,
  _reindex: LEAF,
  _update_by_query: LEAF,
  _delete_by_query: LEAF,
  _tasks: named({ _cancel: LEAF }),
  _template: named(),
  _index_template: named(),
  _component_template: named(),
  _data_stream: named({ _stats: LEAF }),
  _resolve: { index: named() },
  _cat: {
    aliases: LEAF,
    allocation: LEAF,
    cluster_manager: LEAF,
    count: LEAF,
    fielddata: LEAF,
    health: LEAF,
    indices: LEAF,
    master: LEAF,
    nodeattrs: LEAF,
    nodes: LEAF,
    pending_tasks: LEAF,
    plugins: LEAF,
    recovery: LEAF,
    repositories: LEAF,
    segments: LEAF,
    shards: LEAF,
    snapshots: LEAF,
    tasks: LEAF,
    templates: LEAF,
    thread_pool: LEAF,
  },
  _cluster: {
    health: LEAF,
    settings: LEAF,
    state: LEAF,
    stats: LEAF,
    pending_tasks: LEAF,
    reroute: LEAF,
    allocation: { explain: LEAF },
  },
  _nodes: { stats: LEAF, hot_threads: LEAF, usage: LEAF },
  _snapshot: named(named({ _restore: LEAF, _status: LEAF })),
  _ingest: { pipeline: { _simulate: LEAF, '*': { _simulate: LEAF } } },
  _scripts: named(),
  _plugins: {
    _sql: { _explain: LEAF, close: LEAF, stats: LEAF },
    _ppl: { _explain: LEAF },
    _ism: {
      policies: named(),
      add: named(),
      remove: named(),
      explain: named(),
      retry: named(),
      change_policy: named(),
    },
    _rollup: { jobs: named({ _start: LEAF, _stop: LEAF, _explain: LEAF }) },
    _transform: { _preview: LEAF, '*': { _start: LEAF, _stop: LEAF, _explain: LEAF } },
    _sm: { policies: named({ _start: LEAF, _stop: LEAF, _explain: LEAF }) },
  },
};

/** The paths under the name of an index */
const UNDER_INDEX: Tree = {
  _search: LEAF,
  _count: LEAF,
  _doc: named(),
  _create: named(),
  _update: named(),
  _source: named(),
  _bulk: LEAF,
  _mget: LEAF,
  _msearch: LEAF,
  _mapping: LEAF,
  _settings: LEAF,
  _alias: named(),
  _aliases: LEAF,
  _refresh: LEAF,
  _flush: LEAF,
  _forcemerge: LEAF,
  _open: LEAF,
  _close: LEAF,
  _stats: LEAF,
  _segments: LEAF,
  _recovery: LEAF,
  _analyze: LEAF,
  _explain: named(),
  _field_caps: LEAF,
  _delete_by_query: LEAF,
  _update_by_query: LEAF,
  _rollover: LEAF,
  _shrink: named(),
  _split: named(),
  _clone: named(),
  _validate: { query: LEAF },
  _termvectors: named(),
  _cache: { clear: LEAF },
  _block: { write: LEAF },
};

const SEARCH_KEYS = [
  'query',
  'aggs',
  'size',
  'from',
  'sort',
  '_source',
  'highlight',
  'track_total_hits',
  'post_filter',
  'script_fields',
  'stored_fields',
  'docvalue_fields',
  'collapse',
  'search_after',
  'timeout',
  'min_score',
  'explain',
  'version',
  'suggest',
  'profile',
];
const QUERY_TYPES = [
  'match_all',
  'match',
  'match_phrase',
  'match_phrase_prefix',
  'multi_match',
  'term',
  'terms',
  'range',
  'exists',
  'prefix',
  'wildcard',
  'regexp',
  'fuzzy',
  'ids',
  'bool',
  'query_string',
  'simple_query_string',
  'nested',
  'constant_score',
  'dis_max',
  'function_score',
  'boosting',
  'match_none',
  'geo_distance',
  'geo_bounding_box',
  'script',
];
const BOOL_KEYS = ['must', 'filter', 'should', 'must_not', 'minimum_should_match', 'boost'];
const FIELD_QUERIES = new Set(['match', 'match_phrase', 'match_phrase_prefix', 'term', 'terms', 'range', 'prefix', 'wildcard', 'regexp', 'fuzzy']);
const RANGE_KEYS = ['gte', 'gt', 'lte', 'lt', 'format', 'time_zone', 'boost'];
const AGG_TYPES = [
  'terms',
  'date_histogram',
  'histogram',
  'range',
  'date_range',
  'filter',
  'filters',
  'avg',
  'sum',
  'min',
  'max',
  'cardinality',
  'value_count',
  'stats',
  'extended_stats',
  'percentiles',
  'percentile_ranks',
  'top_hits',
  'missing',
  'nested',
  'reverse_nested',
  'significant_terms',
  'composite',
  'auto_date_histogram',
  'geohash_grid',
  'bucket_script',
  'bucket_selector',
  'derivative',
  'cumulative_sum',
  'aggs',
];
const AGG_KEYS = ['field', 'size', 'order', 'missing', 'script', 'interval', 'calendar_interval', 'fixed_interval', 'min_doc_count', 'extended_bounds', 'format', 'time_zone', 'ranges', 'percents', 'keyed'];
const ARRAYS = new Set(['must', 'filter', 'should', 'must_not', 'sort', 'ranges', 'docvalue_fields', 'stored_fields', 'search_after', 'percents']);
const SCALARS = new Set(['size', 'from', 'track_total_hits', 'timeout', 'min_score', 'explain', 'version', 'profile', 'minimum_should_match', 'boost', 'gte', 'gt', 'lte', 'lt', 'format', 'time_zone', 'field', 'missing', 'interval', 'calendar_interval', 'fixed_interval', 'min_doc_count', 'keyed', '_source']);
const QUERY_HOLDERS = new Set(['query', 'post_filter', 'filter', 'must', 'should', 'must_not', 'positive', 'negative']);
const SEARCH_ENDPOINTS = /(^|\/)(_search|_count|_delete_by_query|_update_by_query|_explain|_validate\/query)(\/|\?|$)/;

export interface Suggestion {
  label: string;
  /** What is written in place of the word; the label when left out */
  insert?: string;
  /** How far before the end of what was written the cursor is put */
  back?: number;
  meta?: string;
}

export interface Suggestions {
  /** The part of the text the chosen suggestion replaces */
  from: number;
  to: number;
  items: Suggestion[];
}

export interface ClusterNames {
  indices: string[];
  aliases: string[];
  templates: string[];
  /** The fields of the indices a path names; empty when they are not known */
  fields: (target: string) => string[];
}

const startsWith = (candidates: string[], word: string) => {
  const lower = word.toLowerCase();
  return candidates.filter((candidate) => candidate.toLowerCase().startsWith(lower) && candidate !== word);
};

function urlSuggestions(written: string, names: ClusterNames): Suggestion[] {
  if (written.includes('?')) return [];
  const segments = written.replace(/^\/+/, '').split('/');
  const word = segments.pop() ?? '';
  let tree: Tree | undefined = ROOT;
  let atRoot = true;
  for (const segment of segments) {
    if (!tree) return [];
    if (atRoot && !(segment in ROOT)) tree = UNDER_INDEX;
    else tree = tree[segment] ?? tree['*'];
    atRoot = false;
  }
  if (!tree) return [];
  const paths = Object.keys(tree).filter((key) => key !== '*');
  const items: Suggestion[] = startsWith(paths, word).map((label) => ({ label, meta: 'endpoint' }));
  if (atRoot || (segments.length === 1 && ['_alias', '_resolve'].includes(segments[0]))) {
    items.push(...startsWith(names.indices, word).map((label) => ({ label, meta: 'index' })));
    items.push(...startsWith(names.aliases, word).map((label) => ({ label, meta: 'alias' })));
  }
  if (segments.length === 1 && ['_template', '_index_template'].includes(segments[0])) {
    items.push(...startsWith(names.templates, word).map((label) => ({ label, meta: 'template' })));
  }
  return items;
}

/** The names of the objects a place in a JSON text is inside, outermost first */
export function keyPath(body: string): { path: string[]; expectsKey: boolean } {
  const stack: Array<{ key?: string; array: boolean }> = [];
  let pendingKey: string | undefined;
  let expectsKey = false;
  let at = 0;
  while (at < body.length) {
    const char = body[at];
    if (body.startsWith('"""', at)) {
      const end = body.indexOf('"""', at + 3);
      at = end === -1 ? body.length : end + 3;
      expectsKey = false;
    } else if (char === '"') {
      let end = at + 1;
      while (end < body.length && body[end] !== '"' && body[end] !== '\n') end += body[end] === '\\' ? 2 : 1;
      const closed = body[end] === '"';
      const text = body.slice(at + 1, end);
      if (closed && /^\s*:/.test(body.slice(end + 1))) pendingKey = text;
      if (closed) expectsKey = false;
      at = closed ? end + 1 : body.length;
    } else if (char === '{') {
      stack.push({ key: pendingKey, array: false });
      pendingKey = undefined;
      expectsKey = true;
      at += 1;
    } else if (char === '[') {
      stack.push({ key: pendingKey, array: true });
      pendingKey = undefined;
      expectsKey = false;
      at += 1;
    } else if (char === '}' || char === ']') {
      stack.pop();
      expectsKey = false;
      at += 1;
    } else if (char === ',') {
      expectsKey = stack.length > 0 && !stack[stack.length - 1].array;
      at += 1;
    } else {
      if (char === ':') expectsKey = false;
      at += 1;
    }
  }
  return { path: stack.filter((level) => !level.array || level.key).map((level) => level.key ?? ''), expectsKey };
}

function bodyKeys(path: string[], url: string, names: ClusterNames): string[] {
  if (!SEARCH_ENDPOINTS.test(url)) return [];
  // The first entry is the body itself
  const inside = path.slice(1);
  if (inside.length === 0) return SEARCH_KEYS;
  const last = inside[inside.length - 1];
  const before = inside[inside.length - 2];
  if (last === 'bool') return BOOL_KEYS;
  if (QUERY_HOLDERS.has(last)) return QUERY_TYPES;
  if (last === 'aggs' || last === 'aggregations') return [];
  if (before === 'aggs' || before === 'aggregations') return AGG_TYPES;
  if (FIELD_QUERIES.has(last)) return names.fields(url.replace(/^\/+/, '').split('/')[0]);
  if (before === 'range') return RANGE_KEYS;
  if (AGG_TYPES.includes(last)) return AGG_KEYS;
  return [];
}

/**
 * What could be typed at a place of the editor: a method at the start of a line, a path after
 * it, and in the body of a search the names OpenSearch knows there.
 */
export function suggest(text: string, offset: number, names: ClusterNames): Suggestions | undefined {
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
  const before = text.slice(lineStart, offset);
  const row = lineOf(text, offset);
  const requests = parseRequests(text);
  const request = requestsInRange(requests, row)[0];

  if (!request || request.startLine === row) {
    if (isComment(before)) return undefined;
    const word = /^\s*([A-Za-z]*)$/.exec(before);
    if (word) {
      if (!word[1]) return undefined;
      const items = startsWith(METHODS, word[1].toUpperCase()).map((label) => ({ label, insert: `${label} ` }));
      return items.length ? { from: offset - word[1].length, to: offset, items } : undefined;
    }
    const path = /^\s*[A-Za-z]+\s+(\S*)$/.exec(before);
    if (!path) return undefined;
    const written = path[1];
    const segment = written.slice(written.lastIndexOf('/') + 1);
    const items = urlSuggestions(written, names);
    return items.length ? { from: offset - segment.length, to: offset, items } : undefined;
  }

  // In a body: the names an object can have where the cursor is
  const lines = text.split('\n');
  let bodyStart = 0;
  for (let index = 0; index <= request.startLine; index += 1) bodyStart += lines[index].length + 1;
  const word = /"?([\w.@-]*)$/.exec(before);
  const typed = word?.[1] ?? '';
  const quoted = word ? word[0].startsWith('"') : false;
  const wordStart = offset - (word?.[0].length ?? 0);
  const { path, expectsKey } = keyPath(text.slice(bodyStart, wordStart));
  if (!expectsKey) return undefined;
  if (!quoted && typed === '' && !/^\s*$/.test(before)) return undefined;
  const keys = startsWith(bodyKeys(path, request.url, names), typed);
  if (keys.length === 0) return undefined;
  const after = text[offset] === '"' ? 1 : 0;
  const last = path[path.length - 1];
  return {
    from: wordStart,
    to: offset + after,
    items: keys.map((label) => {
      if (FIELD_QUERIES.has(last) && path.length > 1) return { label, insert: `"${label}": `, meta: 'field' };
      if (ARRAYS.has(label)) return { label, insert: `"${label}": []`, back: 1 };
      if (SCALARS.has(label)) return { label, insert: `"${label}": ` };
      return { label, insert: `"${label}": {}`, back: 1 };
    }),
  };
}

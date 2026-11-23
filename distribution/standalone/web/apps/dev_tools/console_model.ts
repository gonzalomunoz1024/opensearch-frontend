/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The text of the console: where its requests are, how one is laid out again, sent, copied as
 * cURL or read from cURL, how it is coloured, and what could be typed next.
 */

import {
  collapseLiteralStrings,
  expandLiteralStrings,
  reindentJson,
} from '../../lib/json_text';
import { highlight, rehighlight, type Highlighted } from './console_highlight';

export const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'HEAD', 'PATCH', 'OPTIONS'];
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

/** The text of the console with the state each of its lines ends in, which says where requests are */
export interface ConsoleText {
  lines: string[];
  highlighted: Highlighted;
}

/**
 * The text of the console read. With the reading of the text before it, only the lines that
 * changed are read again, and those after them as far as their state changed: what is typed
 * into a long text costs what a few lines cost.
 */
export function readConsole(text: string, previous?: ConsoleText): ConsoleText {
  const lines = text.split('\n');
  return { lines, highlighted: previous ? rehighlight(previous.lines, previous.highlighted, lines, 'input') : highlight(text, 'input') };
}

/** What a line is to the request parser of OpenSearch Dashboards (its RowParser) */
export const ROW = { REQUEST_START: 2, IN_REQUEST: 4, MULTI_DOC_CUR_DOC_END: 8, REQUEST_END: 16, BETWEEN_REQUESTS: 32 };

export function rowMode(doc: ConsoleText, row: number): number {
  const { lines } = doc;
  if (row < 0 || row >= lines.length) return ROW.BETWEEN_REQUESTS;
  const state = doc.highlighted.states[row];
  // Within a body: the line ends inside braces, a string or a script
  if (state !== 'start' && state !== 'start-sql') return ROW.IN_REQUEST;
  const line = lines[row].trim();
  if (!line || line[0] === '#') return ROW.BETWEEN_REQUESTS;
  const next = row + 1 < lines.length ? lines[row + 1].trim() : undefined;
  if (line.endsWith('}')) {
    // Another document of a bulk body starts right after this one
    if (next !== undefined && next.startsWith('{')) return ROW.MULTI_DOC_CUR_DOC_END | ROW.IN_REQUEST;
    return ROW.REQUEST_END | ROW.MULTI_DOC_CUR_DOC_END;
  }
  if (next === undefined || !next.startsWith('{')) return ROW.REQUEST_START | ROW.REQUEST_END;
  return ROW.REQUEST_START;
}

const is = (doc: ConsoleText, row: number, mode: number) => (rowMode(doc, row) & mode) > 0;

/** The line a request that starts on `start` ends on; one past the text when it never ends */
function requestEnd(doc: ConsoleText, start: number): number {
  let row = start;
  for (; row < doc.lines.length; row += 1) {
    if (is(doc, row, ROW.REQUEST_END)) break;
    if (row !== start && is(doc, row, ROW.REQUEST_START)) break;
  }
  return row;
}

function documentEnd(doc: ConsoleText, start: number): number {
  let row = start;
  for (; row < doc.lines.length - 1; row += 1) {
    if (is(doc, row, ROW.REQUEST_END) || is(doc, row, ROW.MULTI_DOC_CUR_DOC_END)) break;
    if (row !== start && is(doc, row, ROW.REQUEST_START)) break;
  }
  return row;
}

interface PlacedToken {
  type: string;
  value: string;
  row: number;
}

function* tokensFrom(doc: ConsoleText, row: number): Generator<PlacedToken> {
  for (let at = row; at < doc.lines.length; at += 1) {
    for (const token of doc.highlighted.lines[at]) yield { ...token, row: at };
  }
}

const isEmptyToken = (token: PlacedToken | undefined) => !token || token.type === 'whitespace';

function nextNonEmpty(tokens: Generator<PlacedToken>): PlacedToken | undefined {
  let token = tokens.next().value as PlacedToken | undefined;
  while (token && isEmptyToken(token)) token = tokens.next().value as PlacedToken | undefined;
  return token;
}

/** The request whose first line is at or above `row`, as the console reads it from the tokens */
export function requestAt(doc: ConsoleText, row: number): (ConsoleRequest & { end: number }) | undefined {
  if (is(doc, row, ROW.BETWEEN_REQUESTS)) return undefined;
  let start = row;
  while (start > 0 && !is(doc, start, ROW.REQUEST_START)) start -= 1;
  const end = requestEnd(doc, start);
  const tokens = tokensFrom(doc, start);
  let token = tokens.next().value as PlacedToken | undefined;
  if (isEmptyToken(token)) token = nextNonEmpty(tokens);
  if (!token) return undefined;
  const method = token.value;
  token = nextNonEmpty(tokens);
  if (!token || token.type === 'method') return undefined;
  let url = '';
  while (token && token.type.indexOf('url') === 0) {
    url += token.value;
    token = tokens.next().value as PlacedToken | undefined;
  }
  if (isEmptyToken(token)) token = nextNonEmpty(tokens);
  const data: string[] = [];
  let bodyStart = token ? token.row : doc.lines.length;
  const endsWithText = end < doc.lines.length && doc.lines[end].trimEnd().length > 0;
  while (bodyStart < end || (bodyStart === end && endsWithText)) {
    const last = documentEnd(doc, bodyStart);
    data.push(doc.lines.slice(bodyStart, last + 1).join('\n').trim());
    bodyStart = last + 1;
  }
  return { method, url, data, startLine: start, endLine: Math.min(end, doc.lines.length - 1), end };
}

/** The lines from the first request a range touches to the end of the last one, if it touches any */
export function expandToRequests(doc: ConsoleText, fromRow: number, toRow = fromRow): [number, number] | undefined {
  let start = fromRow;
  let end = toRow;
  if (!is(doc, start, ROW.BETWEEN_REQUESTS)) {
    for (; start >= 0; start -= 1) if (is(doc, start, ROW.REQUEST_START)) break;
  }
  if (start < 0 || start > end) return undefined;
  if (is(doc, end, ROW.BETWEEN_REQUESTS)) {
    for (; end >= start; end -= 1) if (is(doc, end, ROW.REQUEST_END)) break;
  } else {
    for (; end < doc.lines.length; end += 1) if (is(doc, end, ROW.REQUEST_END)) break;
  }
  if (end < start || end > doc.lines.length - 1) return undefined;
  return [start, end];
}

/** The requests a range of lines touches, with the text between them when it is asked for */
export function blocksBetween(doc: ConsoleText, fromRow: number, toRow = fromRow, withText = false): Array<ConsoleRequest | string> {
  const range = expandToRequests(doc, fromRow, toRow);
  if (!range) return [];
  const out: Array<ConsoleRequest | string> = [];
  let blockStart = range[0];
  let row = range[0];
  const flush = () => {
    const block = doc.lines.slice(blockStart, row).join('\n').replace(/\s+$/, '');
    if (withText && block) out.push(block);
  };
  while (row <= range[1]) {
    if (is(doc, row, ROW.REQUEST_START)) {
      flush();
      const request = requestAt(doc, row);
      if (!request) return out;
      const { end, ...rest } = request;
      out.push(rest);
      blockStart = row = end + 1;
    } else {
      row += 1;
    }
  }
  flush();
  return out;
}

export const requestsBetween = (doc: ConsoleText, fromRow: number, toRow = fromRow): ConsoleRequest[] =>
  blocksBetween(doc, fromRow, toRow).filter((block): block is ConsoleRequest => typeof block !== 'string');

/** Every request of a text */
export function parseRequests(text: string): ConsoleRequest[] {
  const doc = readConsole(text);
  return requestsBetween(doc, 0, Math.max(0, doc.lines.length - 1));
}

export function requestsInRange(requests: ConsoleRequest[], fromLine: number, toLine = fromLine): ConsoleRequest[] {
  return requests.filter((request) => request.endLine >= fromLine && request.startLine <= toLine);
}

/** The line Ctrl/Cmd + Up or Down goes to: the previous or next line a request starts or ends on */
export function requestEdge(doc: ConsoleText, row: number, direction: -1 | 1): number {
  const edge = ROW.REQUEST_START | ROW.REQUEST_END;
  let at = row + direction;
  if (direction < 0) {
    for (; at > 0 && !is(doc, at, edge); at -= 1);
    return Math.max(0, at);
  }
  for (; at < doc.lines.length - 1 && !is(doc, at, edge); at += 1);
  return Math.min(at, Math.max(0, doc.lines.length - 1));
}

/** Where the request's buttons are: so far from the top of the editor, or on its bottom edge */
export type ActionsPlace = { top: number } | { bottom: number };

/** The editor as it is laid out, from the top of its frame with the scrolling taken off */
export interface ActionsLayout {
  lineTop: (line: number) => number | undefined;
  lineBottom: (line: number) => number | undefined;
  /** The top of the row the end of a line is on */
  endTop: (line: number) => number | undefined;
  height: number;
  /** Ace's wrap limit: the characters a row holds */
  wrapLimit: number;
}

/**
 * Where the buttons of the request on the lines `first` to `last` go, as the original places
 * them (Ace's legacyUpdateUI): on the request's first line; on the bottom edge while that line is
 * below the editor; when it has more characters than five short of the wrap limit, on the line
 * before it, or for the first line on the line after it (Ace's place past the last line being
 * the end of the last); on the top edge while only the end of the request is in sight. Nothing
 * while the request is out of sight above: the buttons stay where they were.
 */
export function placeActions(lines: string[], [first, last]: [number, number], layout: ActionsLayout): ActionsPlace | undefined {
  const top = layout.lineTop(first);
  if (top === undefined) return undefined;
  if (top >= 0) {
    if (top > layout.height) return { bottom: 0 };
    if (lines[first].length > layout.wrapLimit - 5) {
      let other: number | undefined;
      if (first > 0) other = layout.lineTop(first - 1);
      else if (first + 1 < lines.length) other = layout.lineTop(first + 1);
      else other = layout.endTop(first);
      return { top: other ?? top };
    }
    return { top };
  }
  const bottom = layout.lineBottom(last);
  return bottom !== undefined && bottom >= 0 ? { top: 0 } : undefined;
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

/** The text with one request replaced */
export function replaceRequest(text: string, request: ConsoleRequest, replacement: string): string {
  const [start, end] = requestOffsets(text, request);
  return `${text.slice(0, start)}${replacement}${text.slice(end)}`;
}

/**
 * The text with a request from the history put by the cursor, as the original does: before a
 * request whose first line the cursor is on, after one it is in, at the cursor between requests.
 * The offset is the start of the line the request now starts on, where the cursor goes.
 */
export function insertRequest(
  text: string,
  cursorLine: number,
  past: { method: string; endpoint: string; data?: string }
): { text: string; offset: number; from: number; inserted: string } {
  const doc = readConsole(text);
  const lines = doc.lines;
  let row = cursorLine;
  let column = 0;
  let prefix = '';
  let suffix = '\n';
  if (is(doc, row, ROW.REQUEST_START)) {
    suffix += '\n';
  } else if (is(doc, row, ROW.REQUEST_END)) {
    column = lines[row].length;
    prefix = '\n\n';
  } else if (is(doc, row, ROW.BETWEEN_REQUESTS)) {
    // at the start of the line, as it is
  } else {
    row = Math.min(requestEnd(doc, row), lines.length - 1);
    column = lines[row].replace(/\s+$/, '').length;
    prefix = '\n\n';
  }
  let offset = column;
  for (let at = 0; at < row; at += 1) offset += lines[at].length + 1;
  let inserted = `${prefix}${past.method} ${past.endpoint}`;
  if (past.data) inserted += `\n${past.data}`;
  inserted += suffix;
  return { text: `${text.slice(0, offset)}${inserted}${text.slice(offset)}`, offset: offset + prefix.length, from: offset, inserted };
}

// --- cURL --------------------------------------------------------------------------------------

/** The requests as cURL commands against the OpenSearch the product talks to, the text between them kept */
export function toCurl(blocks: Array<ConsoleRequest | string>, host: string): string {
  return blocks
    .map((block) => {
      if (typeof block === 'string') return block;
      const url = `${host.replace(/\/+$/, '')}/${block.url.replace(/^\/+/, '')}`;
      let command = `curl -X${block.method} "${url}"`;
      if (block.data.length) {
        command += " -H 'Content-Type: application/json' -d'\n";
        // A single quote ends the shell's string: it is closed, escaped and opened again
        command += collapseLiteralStrings(block.data.join('\n')).replace(/'/g, "'\\''");
        if (block.data.length > 1) command += '\n';
        command += "'";
      }
      return command;
    })
    .join('\n');
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
      } else if (command[at] === '\\' && /['"\\]/.test(command[at + 1] ?? '')) {
        // A quote or a backslash written between quoted parts: '\'' is a quote inside a body
        word += command[at + 1];
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
        } else if (/^-d[\s\S]/.test(word)) {
          bodies.push(word.slice(2));
        } else if (/^(-H|--header|-u|--user|-o|--output|--cacert|--cert|--key|-A|--user-agent)$/.test(word)) {
          index += 1;
        } else if (!word.startsWith('-') && !url) {
          url = word;
        }
      }
      // The address without its scheme and host, after a slash, as the original writes it
      const path = url
        .replace(/^[a-z]+:\/\/[^/]*\/?/i, '')
        .replace(/^(?:localhost|[\w-]+(?:\.[\w-]+)+|[\w.-]+:\d+)(?::\d+)?(?:\/|$)/i, '')
        .replace(/^\/+/, '');
      const body = bodies.join('\n').trim();
      // GET unless the command names a method, with a body too: the original reads only -X
      const verb = (method ?? 'GET').toUpperCase();
      return body ? `${verb} /${path}\n${body}` : `${verb} /${path}`;
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

/**
 * What a request that failed shows: its answer, JSON spread over lines as the original's, or that
 * none came
 */
export function failedAnswer(text: string, contentType: string, status: number): string {
  return text ? formatAnswer(text, contentType) : `Request failed to get to the server (status code: ${status})`;
}

/** An answer of OpenSearch to one request, as the console keeps it */
export interface Answer {
  ok: boolean;
  method: string;
  path: string;
  data: string;
  statusCode?: number;
  statusText?: string;
  contentType: string;
  timeMs: number;
  value: string;
}

/**
 * What the output pane shows: the answers one under the other, strings with escapes in triple
 * quotes when the setting asks for them (only for answers that succeeded, as the original). Any
 * text is read with the output's colours, JSON or not, as the original's editor does.
 */
export function outputOf(answers: Answer[], tripleQuotes: boolean): { value: string; mode: 'output' | 'text' } {
  const expand = tripleQuotes && answers[0]?.ok === true;
  const value = answers.map((answer) => (expand ? expandLiteralStrings(answer.value) : answer.value)).join('\n');
  return { value, mode: value ? 'output' : 'text' };
}

// --- History -----------------------------------------------------------------------------------

export interface PastRequest {
  time: number;
  endpoint: string;
  method: string;
  data?: string;
}

/**
 * A key pressed in the history's list: the arrows choose a request, Enter applies the chosen one.
 * The keys are the list's alone: applying gives the focus to the editor, where an Enter left to
 * the browser would break a line as well.
 */
export function historyKey(
  event: { key: string; preventDefault(): void },
  selected: number,
  actions: { choose(index: number): void; apply(): void }
): void {
  if (event.key === 'Enter') {
    event.preventDefault();
    actions.apply();
  } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    event.preventDefault();
    actions.choose(selected + (event.key === 'ArrowUp' ? -1 : 1));
  }
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
 * Whether something is typed before the cursor on its line. A line just begun, or its indentation,
 * opens no list of suggestions by itself, as in the original: the next Enter would accept a
 * suggestion nobody asked for. Ctrl+Space opens the list there.
 */
export function typedOnLine(text: string, offset: number): boolean {
  return /\S/.test(text.slice(text.lastIndexOf('\n', offset - 1) + 1, offset));
}

/**
 * What could be typed at a place of the editor: a method at the start of a line, a path after
 * it, and in the body of a search the names OpenSearch knows there. The text as already read is
 * given by a caller that has it, which spares reading a long text again at every key.
 */
export function suggest(text: string, offset: number, names: ClusterNames, doc: ConsoleText = readConsole(text)): Suggestions | undefined {
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
  const before = text.slice(lineStart, offset);
  const row = lineOf(text, offset);
  // The request the cursor is in, its body closed or not yet
  const request = requestAt(doc, row);

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
      if (ARRAYS.has(label)) return { label, insert: `"${label}": []`, back: 1, meta: 'API' };
      if (SCALARS.has(label)) return { label, insert: `"${label}": `, meta: 'API' };
      return { label, insert: `"${label}": {}`, back: 1, meta: 'API' };
    }),
  };
}

/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Query Workbench without its page: how the text of the editor becomes queries, how an answer
 * of the SQL plugin becomes a table, what the "Output" tab says, how a row with objects inside
 * opens, what the search box matches, and the colours and suggestions of the SQL editor.
 */

import type { CodeToken } from '../../components/code_editor';
import { holds, parseSearch, type Clause } from '../../lib/search_syntax';

export type Language = 'SQL' | 'PPL';

/** What the SQL editor holds when the page opens */
export const SQL_START = "SHOW tables LIKE '%';";
/** The query whose answer lists the indices at the left */
export const INDICES_QUERY = "SHOW tables LIKE '%'";
export const OUTPUT_TAB = 'Output';
export const PAGE_SIZES = [10, 20, 50, 100];
export const DOCS: Record<Language, { title: string; link: string }> = {
  SQL: {
    title: 'SQL documentation',
    link: 'https://opensearch.org/docs/latest/search-plugins/sql/sql/index/',
  },
  PPL: {
    title: 'PPL documentation',
    link: 'https://opensearch.org/docs/latest/search-plugins/sql/ppl/index/',
  },
};

// --- Queries ------------------------------------------------------------------------------------

/** The queries of an editor's text: one per semicolon, each on one line */
export function getQueries(text: string): string[] {
  if (text === '') return [];
  return text
    .split(';')
    .map((query) => query.trim().replace(/[\r\n]+/g, ' '))
    .filter((query) => query !== '');
}

/** What a query's tab is called: the index after its first "from", or the query itself */
export function queryIndex(query: string): string {
  const parts = query.toLowerCase().split('from');
  if (parts.length > 1) {
    const name = parts[1].split(' ').find((word, index) => index > 0 && word !== '');
    if (name !== undefined) return name;
  }
  return query;
}

export const tabName = (language: Language, query: string): string =>
  language === 'SQL' ? queryIndex(query) : 'Events';

// --- Answers ------------------------------------------------------------------------------------

/** What the server said to one query */
export interface QueryAnswer {
  fulfilled: boolean;
  /** The answer of the SQL plugin as the text it came in */
  data: string;
  errorMessage?: string;
  /** Why it failed, in OpenSearch's words, when it said */
  reason?: string;
}

interface Envelope {
  data?: { ok?: boolean; resp?: unknown; body?: unknown };
}

/** The sentence of an error of the SQL plugin, which comes as JSON text */
export function reasonOf(text: unknown): string {
  if (typeof text !== 'string' || text === '') return '';
  try {
    const parsed = JSON.parse(text) as { error?: { reason?: string; details?: string } | string };
    const error = parsed?.error;
    if (typeof error === 'string') return error;
    if (error && typeof error === 'object') {
      const parts = [error.reason, error.details].filter(
        (part, index, all) => typeof part === 'string' && part !== '' && all.indexOf(part) === index
      );
      if (parts.length) return parts.join(': ');
    }
  } catch {
    // not JSON: said as it is
  }
  return text;
}

/** An answer of `/api/sql_console/*query`, or nothing when the request failed */
export function readAnswer(response: unknown, reason = ''): QueryAnswer {
  const data = (response as Envelope | undefined)?.data;
  if (!data) return { fulfilled: false, errorMessage: 'no response', data: '', reason };
  if (!data.ok) {
    const message = String(data.resp ?? '');
    if (data.body && message === 'Unable to parse/serialize body') {
      return { fulfilled: true, errorMessage: message, data: String(data.body) };
    }
    return { fulfilled: false, errorMessage: message, data: '', reason: reasonOf(data.body) };
  }
  return {
    fulfilled: true,
    data: typeof data.resp === 'string' ? data.resp : JSON.stringify(data.resp),
  };
}

export interface Row {
  rowId: number;
  data: Record<string, unknown>;
}

export interface ResultTable {
  fields: string[];
  records: Row[];
}

export type TableResult =
  | { fulfilled: true; table: ResultTable; message: string }
  | { fulfilled: false; message: string };

interface Jdbc {
  schema?: Array<{ name?: string; alias?: string }>;
  datarows?: unknown[][];
}

/**
 * The table of an answer. The answer to "SHOW tables" keeps its names only; a null is shown as
 * a dash; a column goes by its alias when it has one.
 */
export function tableOf(answer: QueryAnswer): TableResult {
  if (!answer.fulfilled) {
    return {
      fulfilled: false,
      // The reason takes the place the plugin's page leaves empty after its own sentence
      message: `${answer.errorMessage ?? ''}, this query is not runnable. \n \n${answer.reason ?? ''}`,
    };
  }
  let parsed: Jdbc = {};
  try {
    const value = answer.data ? (JSON.parse(answer.data) as unknown) : undefined;
    if (value && typeof value === 'object') parsed = value as Jdbc;
  } catch {
    // an answer that is not JSON has no rows
  }
  const schema = Array.isArray(parsed.schema) ? parsed.schema : [];
  const datarows = Array.isArray(parsed.datarows) ? parsed.datarows : [];
  const names = schema.map((column) => column?.name);
  const isShow = names.includes('TABLE_NAME') && !names.includes('DATA_TYPE');

  if (isShow) {
    const index = names.indexOf('TABLE_NAME');
    return {
      fulfilled: true,
      message: 'Success',
      table: {
        fields: ['TABLE_NAME'],
        records: datarows.map((row, rowId) => ({ rowId, data: { TABLE_NAME: row?.[index] } })),
      },
    };
  }
  const fields = schema.map((column) => String(column?.alias || column?.name || ''));
  return {
    fulfilled: true,
    message: 'Success',
    table: {
      fields,
      records: datarows.map((row, rowId) => {
        const data: Record<string, unknown> = {};
        fields.forEach((field, index) => {
          const value = row?.[index];
          // A null is a dash; a value the row does not have stays empty
          data[field] = value === null ? '-' : value;
        });
        return { rowId, data };
      }),
    },
  };
}

/** The index names in the answer to `INDICES_QUERY`: its third column */
export function indexNames(answer: QueryAnswer): string[] {
  try {
    const parsed = JSON.parse(answer.data) as Jdbc;
    return (parsed.datarows ?? []).map((row) => String(row[2]));
  } catch {
    return [];
  }
}

// --- The index tree -----------------------------------------------------------------------------

/** What the tree says when the answer lists no index */
export const TREE_EMPTY = 'Failed to load OpenSearch indices';
/** What the tree says when the answer cannot be read, or the request failed */
export const TREE_FAILED = 'Failed to load OpenSearch indices, please check user permissions';

/** The names the tree lists, or why it lists none */
export type IndexTree = { names: string[] } | { message: string };

/**
 * The tree of an answer of `/api/sql_console/sqlquery` to `indicesQuery`, read as the plugin
 * reads it: the text of `data.resp` parsed, its `datarows`, the third column of each. What the
 * plugin's reading throws on (no answer, an error's text, no rows) is `TREE_FAILED`; rows that
 * are there but empty are `TREE_EMPTY`.
 */
export function indexTreeOf(response: unknown): IndexTree {
  try {
    const resp = (response as { data: { resp?: unknown } }).data.resp;
    const parsed = JSON.parse(String(resp)) as unknown;
    const rows = parsed === null || parsed === undefined ? undefined : (parsed as Jdbc).datarows;
    if (rows === undefined || rows === null) return { message: TREE_FAILED };
    const length = (rows as { length?: unknown }).length;
    if (!(typeof length === 'number' && length > 0)) return { message: TREE_EMPTY };
    if (!Array.isArray(rows)) return { message: TREE_FAILED };
    return {
      names: rows.map((row: unknown) => {
        const name = (row as unknown[])[2];
        return name === null || name === undefined ? '' : String(name);
      }),
    };
  } catch {
    return { message: TREE_FAILED };
  }
}

/** A name cut to 50 characters with "..." at its end, as lodash's `truncate` cuts it */
export const truncateName = (name: string, length = 50): string =>
  name.length > length ? `${name.slice(0, length - 3)}...` : name;

/**
 * The data source an address of the page names: `#/name` and `#/accelerate/name`, as the
 * plugin's routes read them; empty for any other address.
 */
export function dataSourceOf(hashPath: string): string {
  const match = /^\/(?:accelerate\/)?([^/]+)\/?$/.exec(hashPath);
  if (!match) return '';
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

// --- The "Output" tab ---------------------------------------------------------------------------

export const capitalize = (name: string): string =>
  name.length > 0 ? name.charAt(0).toUpperCase() + name.slice(1) : name;

/** One paragraph per query: what it was run on and how it went */
export function messageText(messages: string[], names: string[]): string {
  if (messages.length === 0 || names.length === 0) return '';
  return messages
    .map((message, index) => `${capitalize(names[index] ?? '')}: ${message}\n\n`)
    .join('');
}

/** Which tab opens after a run: the first query's when it worked */
export function firstTab(results: TableResult[], queries: string[]) {
  return results.length > 0 && results[0].fulfilled
    ? { id: '0', name: queryIndex(queries[0] ?? '') }
    : { id: OUTPUT_TAB, name: OUTPUT_TAB };
}

// --- Cells and rows that open -------------------------------------------------------------------

export interface CellText {
  /** What is written; empty when the value is a link to open */
  text: string;
  /** "geo: {1}" for an object, "tags: [2]" for a list of plain values */
  link?: string;
}

export function cellText(value: unknown, field: string): CellText {
  if (value === null || value === undefined) return { text: '' };
  if (typeof value === 'boolean') return { text: String(value) };
  if (typeof value !== 'object') return { text: String(value) };
  if (Array.isArray(value)) {
    const plain = typeof value[0] !== 'object';
    return {
      text: '',
      link: plain ? `${field}: [${value.length}]` : `${field}: {${value.length}}`,
    };
  }
  return { text: '', link: `${field}: {1}` };
}

/** The names under which a row holds an object or a list: what it shows when opened */
export function nestedNames(data: unknown): string[] {
  if (data === null || typeof data !== 'object') return [];
  return Object.keys(data).filter((key) => {
    const value = (data as Record<string, unknown>)[key];
    return value !== null && typeof value === 'object';
  });
}

/** The rows and columns of an object or a list shown under its name */
export function nestedTable(value: unknown): { columns: string[]; rows: unknown[] } {
  if (Array.isArray(value)) {
    const first: unknown = value[0];
    return {
      columns: first !== null && typeof first === 'object' ? Object.keys(first) : [],
      rows: value,
    };
  }
  if (value !== null && typeof value === 'object')
    return { columns: Object.keys(value), rows: [value] };
  return { columns: [], rows: [] };
}

// --- The search box -----------------------------------------------------------------------------

export { parseSearch, type Clause };

/** The rows a search keeps; every row when the text is empty or is not a search */
export function searchRows(rows: Row[], text: string): Row[] {
  const clauses = text.trim() === '' ? [] : parseSearch(text);
  if (!clauses || clauses.length === 0) return rows;
  return rows.filter((row) => clauses.every((clause) => holds(row.data, clause)));
}

// --- What OpenSearch can do ---------------------------------------------------------------------

/** What the page offers, by the version `/api/sql_console/cluster_info` tells, as the plugin's */
export interface Capabilities {
  /** "Download JSON": OpenSearch answers `format=json` before 3.0 */
  hasDslJsonFormat: boolean;
  /** PPL, which Elasticsearch has from 7.9 */
  hasPpl: boolean;
  /** The SQL of OpenDistro on Elasticsearch, whose LIKE takes its pattern without quotes */
  legacy: boolean;
  /** The data sources of the SQL plugin, from OpenSearch 2.11 */
  hasDataSources: boolean;
}

/** What the page offers before it knows, and when the version cannot be read */
export const DEFAULT_CAPABILITIES: Capabilities = {
  hasDslJsonFormat: false,
  hasPpl: true,
  legacy: false,
  hasDataSources: true,
};

/** The first version in a text, as semver's `coerce` reads it */
export function coerceVersion(text: string): [number, number, number] | undefined {
  const match = /(?:^|[^\d])(\d{1,16})(?:\.(\d{1,16}))?(?:\.(\d{1,16}))?(?:$|[^\d])/.exec(text);
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)];
}

const atLeast = (version: [number, number, number], least: [number, number, number]) => {
  for (let index = 0; index < 3; index += 1) {
    if (version[index] !== least[index]) return version[index] > least[index];
  }
  return true;
};

export function capabilitiesOf(version: string | undefined, isOpenSearch?: boolean): Capabilities {
  const coerced = version ? coerceVersion(version) : undefined;
  if (!coerced) return DEFAULT_CAPABILITIES;
  const openSearch = isOpenSearch ?? (coerced[0] !== 6 && coerced[0] !== 7);
  return {
    hasDslJsonFormat: !atLeast(coerced, [3, 0, 0]),
    hasPpl: openSearch || atLeast(coerced, [7, 9, 0]),
    legacy: !openSearch,
    hasDataSources: openSearch && atLeast(coerced, [2, 11, 0]),
  };
}

/** The query whose answer lists the indices at the left */
export const indicesQuery = (capabilities: Capabilities) =>
  capabilities.legacy ? 'SHOW tables LIKE %' : INDICES_QUERY;

/** What the SQL editor holds when the page opens */
export const startQuery = (capabilities: Capabilities) =>
  capabilities.legacy ? 'SHOW tables LIKE %;' : SQL_START;

// --- Downloads ----------------------------------------------------------------------------------

export type DownloadKind = 'json' | 'jdbc' | 'csv' | 'text';

export interface DownloadFile {
  /** The route asked for every query, or none for the answers the run already has */
  route?: string;
  extension: string;
  /** The type the original writes in its `data:` link */
  type: string;
  /** The menu's words */
  label: string;
}

export const DOWNLOADS: Record<DownloadKind, DownloadFile> = {
  json: { route: 'json', extension: 'json', type: 'text/json', label: 'Download JSON' },
  jdbc: { extension: 'json', type: 'text/json', label: 'Download JDBC' },
  csv: { route: 'csv', extension: 'csv', type: 'text/csv', label: 'Download CSV' },
  text: { route: 'text', extension: 'txt', type: 'text/plain', label: 'Download Text' },
};

/** The kinds the Download menu lists, in its order */
export const downloadKinds = (capabilities: Capabilities): DownloadKind[] =>
  capabilities.hasDslJsonFormat ? ['json', 'jdbc', 'csv', 'text'] : ['jdbc', 'csv', 'text'];

/** The route of a format for a language: `sqlcsv`, `ppltext` */
export const downloadRoute = (language: Language, kind: DownloadKind) =>
  `${language === 'SQL' ? 'sql' : 'ppl'}${DOWNLOADS[kind].route ?? 'query'}`;

/**
 * What a file holds: JSON laid out with four spaces as the plugin writes JDBC and JSON, CSV and
 * text as they came. Undefined when an answer cannot be read as JSON.
 */
export function fileContent(kind: DownloadKind, data: string): string | undefined {
  if (kind === 'csv' || kind === 'text') return data;
  try {
    return JSON.stringify(JSON.parse(data), undefined, 4);
  } catch {
    return undefined;
  }
}

// --- The SQL editor: Ace's SQL mode -------------------------------------------------------------

// The words of the mode, by kind, as its highlight rules list them
const SQL_WORD_LISTS: Array<[string, string]> = [
  [
    'SqlFunction',
    'avg|count|first|last|max|min|sum|ucase|lcase|mid|len|round|rank|now|format|coalesce|ifnull|isnull|nvl',
  ],
  [
    'SqlKeyword',
    'select|insert|update|delete|from|where|and|or|group|by|order|limit|offset|having|as|case|' +
      'when|else|end|type|left|right|join|on|outer|desc|asc|union|create|table|primary|key|if|' +
      'foreign|not|references|default|null|inner|cross|natural|database|drop|grant',
  ],
  ['SqlLanguage', 'true|false'],
  [
    'SqlType',
    'int|numeric|decimal|date|varchar|char|bigint|float|double|bit|binary|text|set|timestamp|' +
      'money|real|number|integer',
  ],
];

/**
 * Each word and its kind, in the order Ace's keyword mapper keeps them: list by list, each read
 * from its end. The completions are offered in this order.
 */
export const SQL_WORDS: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  for (const [kind, list] of SQL_WORD_LISTS) {
    const names = list.split('|');
    for (let index = names.length - 1; index >= 0; index -= 1) map.set(names[index], kind);
  }
  return map;
})();

// The rules of the mode's start state, tried in order where the text is; what none of them takes
// is plain text. A word takes its kind from `SQL_WORDS`.
const SQL_RULES: Array<{ pattern: RegExp; kind?: string; word?: boolean; comment?: boolean }> = [
  { pattern: /--.*$/y, kind: 'SqlComment' },
  { pattern: /\/\*/y, kind: 'SqlComment', comment: true },
  { pattern: /".*?"/y, kind: 'SqlString' },
  { pattern: /'.*?'/y, kind: 'SqlString' },
  { pattern: /`.*?`/y, kind: 'SqlString' },
  { pattern: /[+-]?\d+(?:(?:\.\d*)?(?:[eE][+-]?\d+)?)?\b/y, kind: 'SqlNumber' },
  { pattern: /[a-zA-Z_$][a-zA-Z0-9_$]*\b/y, word: true },
  { pattern: /\+|-|\/|\/\/|%|<@>|@>|<@|&|\^|~|<|>|<=|=>|==|!=|<>|=/y, kind: 'SqlOperator' },
  { pattern: /[()]/y },
  { pattern: /\s+/y },
];

/** SQL as lines of coloured runs, as Ace's SQL mode colours it */
export function tokenizeSql(text: string): CodeToken[][] {
  let inComment = false;
  return text.split('\n').map((line) => {
    const tokens: CodeToken[] = [];
    const push = (value: string, kind?: string) => {
      const last = tokens[tokens.length - 1];
      if (last && last.kind === kind) last.text += value;
      else tokens.push(kind ? { text: value, kind } : { text: value });
    };
    let at = 0;
    while (at < line.length) {
      if (inComment) {
        const end = line.indexOf('*/', at);
        const stop = end === -1 ? line.length : end + 2;
        push(line.slice(at, stop), 'SqlComment');
        inComment = end === -1;
        at = stop;
        continue;
      }
      let taken = false;
      for (const rule of SQL_RULES) {
        rule.pattern.lastIndex = at;
        const match = rule.pattern.exec(line);
        if (!match || match[0] === '') continue;
        const value = match[0];
        if (rule.comment) {
          push(value, 'SqlComment');
          inComment = true;
        } else if (rule.word) {
          push(value, SQL_WORDS.get(value.toLowerCase()));
        } else {
          push(value, rule.kind);
        }
        at += value.length;
        taken = true;
        break;
      }
      if (!taken) {
        push(line[at]);
        at += 1;
      }
    }
    return tokens.length ? tokens : [{ text: '' }];
  });
}

// Where the indent of a line ends, as Ace looks for it in the line's first token
const INDENT_END = /\s\S| \t|\t |\s$/;

/**
 * The lines of an editor with the guides of their indents: each four spaces, or each tab, that a
 * line begins with becomes a run of its own that is drawn with a line at its right, all but the
 * last step before the text, as Ace draws them.
 */
export function indentGuides(lines: CodeToken[][]): CodeToken[][] {
  return lines.map((tokens) => {
    const first = tokens[0];
    if (!first || first.kind !== undefined) return tokens;
    const value = first.text;
    let columns = value.search(INDENT_END);
    let step = 1;
    if (value[0] === ' ') {
      columns -= columns % 4;
      step = 4;
    } else if (value[0] !== '\t') {
      return tokens;
    }
    if (columns <= 0) return tokens;
    const guides: CodeToken[] = [];
    for (let at = 0; at < columns; at += step) {
      guides.push({ text: value.slice(at, at + step), kind: 'QwbGuide' });
    }
    const rest = value.slice(columns);
    return [...guides, ...(rest ? [{ text: rest }] : []), ...tokens.slice(1)];
  });
}

// --- The SQL editor: Ace's completion -----------------------------------------------------------

/** One completion as Ace's language tools keep it; its score changes as the list is filtered */
export interface Completion {
  value: string;
  meta: 'local' | 'keyword';
  score: number;
  /** 1 when the letters typed begin it */
  exactMatch: number;
  /** The letters of the value that match those typed, as bits */
  matchMask: number;
}

// What a word to complete is made of, and what parts words in the document
const IDENTIFIER = /[a-zA-Z_0-9$\-\u00A2-\uFFFF]/;
const WORD_SPLIT = /[^a-zA-Z_0-9$\-\u00C0-\u1FFF\u2C00-\uD7FF\w]+/;

/** The part of a word before the cursor that completion works on */
export function completionPrefix(text: string, offset: number): string {
  let start = offset;
  while (start > 0 && text[start - 1] !== '\n' && IDENTIFIER.test(text[start - 1])) start -= 1;
  return text.slice(start, offset);
}

/** The words of the document, scored by how near they are to the cursor, the word there left out */
function localCompletions(text: string, offset: number): Completion[] {
  const at = text.slice(0, offset).split(WORD_SPLIT).length - 1;
  const words = text.split(WORD_SPLIT);
  const current = words[at];
  const scores = new Map<string, number>();
  words.forEach((word, index) => {
    if (!word || word === current) return;
    const score = words.length - Math.abs(at - index);
    scores.set(word, Math.max(score, scores.get(word) ?? score));
  });
  // In the order of Ace's object of words: the words that are array indices first, by value
  const index = (word: string) =>
    /^(?:0|[1-9]\d*)$/.test(word) && Number(word) < 2 ** 32 - 1 ? Number(word) : -1;
  const ordered = [...scores].sort(([a], [b]) => {
    const [first, second] = [index(a), index(b)];
    if (first >= 0 && second >= 0) return first - second;
    return first >= 0 ? -1 : second >= 0 ? 1 : 0;
  });
  return ordered.map(([value, score]) => ({
    value,
    meta: 'local',
    score,
    exactMatch: 0,
    matchMask: 0,
  }));
}

/**
 * The completions Ace keeps while its list is open. Each filter takes the penalty of the letters
 * typed from the score of every completion it keeps, so a list filtered again and again orders
 * them as Ace does: the same completions, one after another, for each letter typed or taken away.
 */
export class CompletionList {
  readonly all: Completion[];
  filtered: Completion[];
  filterText = '';

  constructor(all: Completion[]) {
    this.all = all;
    this.filtered = all;
  }

  setFilter(text: string) {
    this.filterText = text;
    const lower = text.toLowerCase();
    const upper = text.toUpperCase();
    const kept: Completion[] = [];
    for (const item of this.all) {
      let last = -1;
      let mask = 0;
      let penalty = 0;
      let missing = false;
      for (let index = 0; index < text.length; index += 1) {
        const low = item.value.indexOf(lower[index], last + 1);
        const up = item.value.indexOf(upper[index], last + 1);
        const found = low >= 0 ? (up < 0 || low < up ? low : up) : up;
        if (found < 0) {
          missing = true;
          break;
        }
        const distance = found - last - 1;
        if (distance > 0) penalty += (last === -1 ? 10 : 0) + distance;
        mask |= 1 << found;
        last = found;
      }
      if (missing) continue;
      item.matchMask = mask;
      item.exactMatch = penalty ? 0 : 1;
      item.score -= penalty;
      kept.push(item);
    }
    kept.sort((a, b) => b.exactMatch - a.exactMatch || b.score - a.score);
    // A value offered twice in a row is offered once
    this.filtered = kept.filter(
      (item, index) => index === 0 || kept[index - 1].value !== item.value
    );
  }
}

/**
 * The list Ace opens for the word before the cursor: the document's words, then the mode's. The
 * document's words are filtered once more than the mode's, as Ace filters what each source has
 * given as soon as it has given it.
 */
export function openCompletions(text: string, offset: number): CompletionList {
  const prefix = completionPrefix(text, offset);
  const local = localCompletions(text, offset);
  new CompletionList(local).setFilter(prefix);
  const keywords: Completion[] = [...SQL_WORDS.keys()].map((value) => ({
    value,
    meta: 'keyword',
    score: 0,
    exactMatch: 0,
    matchMask: 0,
  }));
  const list = new CompletionList([...local, ...keywords]);
  list.setFilter(prefix);
  return list;
}

/** Whether a list has nothing worth showing: nothing left, or only the word already typed */
export const completionsDone = (list: CompletionList) =>
  list.filtered.length === 0 ||
  (list.filtered.length === 1 && list.filtered[0].value === list.filterText);

/**
 * A completion's kind as the list writes it at the right of a row: cut short, or to nothing but
 * its ellipsis, when the row has not the columns for the value and the kind with two between.
 */
export function completionMeta(item: Completion, columns: number): string {
  if (item.meta.length + item.value.length <= columns - 2) return item.meta;
  const kept = Math.max(0, Math.trunc(columns - item.value.length - 3));
  return `${item.meta.slice(0, kept)}…`;
}

/** A completion's value in runs, those that match the letters typed marked */
export function completionRuns(item: Completion): Array<{ text: string; match: boolean }> {
  const runs: Array<{ text: string; match: boolean }> = [];
  for (let index = 0; index < item.value.length; index += 1) {
    // As Ace reads the bits: the 33rd letter takes the first's
    const match = (item.matchMask & (1 << index)) !== 0;
    const last = runs[runs.length - 1];
    if (last && last.match === match) last.text += item.value[index];
    else runs.push({ text: item.value[index], match });
  }
  return runs;
}

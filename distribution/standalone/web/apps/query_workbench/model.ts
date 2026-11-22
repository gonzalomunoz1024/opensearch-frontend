/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Query Workbench without its page: how the text of the editor becomes queries, how an answer
 * of the SQL plugin becomes a table, what the "Output" tab says, how a row with objects inside
 * opens, what the search box matches, and the colours and suggestions of the SQL editor.
 */

import type { CodeToken } from '../../components/code_editor';

export type Language = 'SQL' | 'PPL';

/** What the SQL editor holds when the page opens */
export const SQL_START = "SHOW tables LIKE '%';";
/** The query whose answer lists the indices at the left */
export const INDICES_QUERY = "SHOW tables LIKE '%'";
export const OUTPUT_TAB = 'Output';
export const PAGE_SIZES = [10, 20, 50, 100];
export const DOCS: Record<Language, { title: string; link: string }> = {
  SQL: { title: 'SQL documentation', link: 'https://opensearch.org/docs/latest/search-plugins/sql/sql/index/' },
  PPL: { title: 'PPL documentation', link: 'https://opensearch.org/docs/latest/search-plugins/sql/ppl/index/' },
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
  return { fulfilled: true, data: typeof data.resp === 'string' ? data.resp : JSON.stringify(data.resp) };
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
          data[field] = value === null || value === undefined ? '-' : value;
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

// --- The "Output" tab ---------------------------------------------------------------------------

export const capitalize = (name: string): string =>
  name.length > 0 ? name.charAt(0).toUpperCase() + name.slice(1) : name;

/** One paragraph per query: what it was run on and how it went */
export function messageText(messages: string[], names: string[]): string {
  if (messages.length === 0 || names.length === 0) return '';
  return messages.map((message, index) => `${capitalize(names[index] ?? '')}: ${message}\n\n`).join('');
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
    return { text: '', link: plain ? `${field}: [${value.length}]` : `${field}: {${value.length}}` };
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
  if (value !== null && typeof value === 'object') return { columns: Object.keys(value), rows: [value] };
  return { columns: [], rows: [] };
}

// --- The search box -----------------------------------------------------------------------------

type Match = 'must' | 'must_not';
type Operator = 'eq' | 'exact' | 'gt' | 'gte' | 'lt' | 'lte';

export type Clause =
  | { type: 'term'; match: Match; value: string }
  | { type: 'field'; match: Match; field: string; operator: Operator; value: string | string[] }
  | { type: 'is'; match: Match; flag: string }
  | { type: 'group'; match: Match; clauses: Clause[] };

const OPERATORS: Array<[string, Operator]> = [
  ['>=', 'gte'],
  ['<=', 'lte'],
  [':', 'eq'],
  ['=', 'exact'],
  ['>', 'gt'],
  ['<', 'lt'],
];

/**
 * A search as its clauses: words and "phrases" that must be found, `-word` that must not,
 * `field:value` (also `=`, `>`, `>=`, `<`, `<=` and `field:(a or b)`), `is:flag`, and
 * `(this OR that)`. `undefined` for a text that is not a search, which then filters nothing.
 */
export function parseSearch(text: string): Clause[] | undefined {
  let at = 0;
  const space = () => {
    while (at < text.length && /\s/.test(text[at])) at += 1;
  };
  const phrase = (): string | undefined => {
    // at an opening quote
    let end = at + 1;
    let out = '';
    while (end < text.length && text[end] !== '"') {
      if (text[end] === '\\' && end + 1 < text.length) end += 1;
      out += text[end];
      end += 1;
    }
    if (end >= text.length) return undefined;
    at = end + 1;
    return out;
  };
  const word = (stop: RegExp): string => {
    const start = at;
    while (at < text.length && !stop.test(text[at])) at += 1;
    return text.slice(start, at);
  };
  const value = (): string | undefined => (text[at] === '"' ? phrase() : word(/[\s()]/) || undefined);

  const clause = (): Clause | undefined => {
    let match: Match = 'must';
    if (text[at] === '-') {
      match = 'must_not';
      at += 1;
    }
    if (text[at] === '(') {
      at += 1;
      const clauses: Clause[] = [];
      for (;;) {
        space();
        const inner = clause();
        if (!inner) return undefined;
        clauses.push(inner);
        space();
        if (text[at] === ')') {
          at += 1;
          return { type: 'group', match, clauses };
        }
        if (!/^or\s/i.test(text.slice(at, at + 3))) return undefined;
        at += 2;
      }
    }
    if (text[at] === '"') {
      const found = phrase();
      return found === undefined ? undefined : { type: 'term', match, value: found };
    }
    const start = at;
    const name = word(/[\s():=<>"]/);
    const operator = OPERATORS.find(([sign]) => text.startsWith(sign, at));
    if (name && operator && /^[\w.-]+$/.test(name)) {
      at += operator[0].length;
      if (name === 'is' && operator[1] === 'eq') {
        const flag = word(/[\s()]/);
        return flag ? { type: 'is', match, flag } : undefined;
      }
      if (text[at] === '(') {
        at += 1;
        const values: string[] = [];
        for (;;) {
          space();
          const found = value();
          if (found === undefined) return undefined;
          values.push(found);
          space();
          if (text[at] === ')') {
            at += 1;
            return { type: 'field', match, field: name, operator: operator[1], value: values };
          }
          if (!/^or\s/i.test(text.slice(at, at + 3))) return undefined;
          at += 2;
        }
      }
      const found = value();
      return found === undefined
        ? undefined
        : { type: 'field', match, field: name, operator: operator[1], value: found };
    }
    at = start;
    const term = word(/[\s()]/);
    return term ? { type: 'term', match, value: term } : undefined;
  };

  const clauses: Clause[] = [];
  for (;;) {
    space();
    if (at >= text.length) return clauses;
    const next = clause();
    if (!next) return undefined;
    clauses.push(next);
  }
}

function compare(fieldValue: unknown, wanted: string, operator: Operator): boolean {
  if (fieldValue === null || fieldValue === undefined) return false;
  if (Array.isArray(fieldValue) && (operator === 'eq' || operator === 'exact')) {
    return fieldValue.some((item) => compare(item, wanted, operator));
  }
  if (typeof fieldValue === 'string') {
    const have = fieldValue.toLowerCase();
    const want = wanted.toLowerCase();
    if (operator === 'eq') return have.includes(want);
    if (operator === 'exact') return have === want;
    if (operator === 'gt') return fieldValue > wanted;
    if (operator === 'gte') return fieldValue >= wanted;
    if (operator === 'lt') return fieldValue < wanted;
    return fieldValue <= wanted;
  }
  if (typeof fieldValue === 'number') {
    const want = Number(wanted);
    if (operator === 'eq' || operator === 'exact') return fieldValue === want;
    if (operator === 'gt') return fieldValue > want;
    if (operator === 'gte') return fieldValue >= want;
    if (operator === 'lt') return fieldValue < want;
    return fieldValue <= want;
  }
  if (typeof fieldValue === 'boolean') {
    return (operator === 'eq' || operator === 'exact') && String(fieldValue) === wanted.toLowerCase();
  }
  return false;
}

function holds(item: Record<string, unknown>, clause: Clause): boolean {
  const must = clause.match === 'must';
  if (clause.type === 'group') return clause.clauses.some((inner) => holds(item, inner)) === must;
  if (clause.type === 'is') return Boolean(item[clause.flag]) === must;
  if (clause.type === 'field') {
    const values = Array.isArray(clause.value) ? clause.value : [clause.value];
    return values.some((wanted) => compare(item[clause.field], wanted, clause.operator)) === must;
  }
  // A word is looked for in the columns that hold text
  const wanted = clause.value.toLowerCase();
  const found = Object.keys(item).some((key) => {
    const value = item[key];
    return typeof value === 'string' && value.toLowerCase().includes(wanted);
  });
  return found === must;
}

/** The rows a search keeps; every row when the text is empty or is not a search */
export function searchRows(rows: Row[], text: string): Row[] {
  const clauses = text.trim() === '' ? [] : parseSearch(text);
  if (!clauses || clauses.length === 0) return rows;
  return rows.filter((row) => clauses.every((clause) => holds(row.data, clause)));
}

// --- The SQL editor -----------------------------------------------------------------------------

const words = (list: string) => new Set(list.split('|'));

// The words the editor of the plugin colours, which are those of its SQL mode
export const SQL_KEYWORDS = words(
  'select|insert|update|delete|from|where|and|or|group|by|order|limit|offset|having|as|case|' +
    'when|else|end|type|left|right|join|on|outer|desc|asc|union|create|table|primary|key|if|' +
    'foreign|not|references|default|null|inner|cross|natural|database|drop|grant'
);
export const SQL_CONSTANTS = words('true|false');
export const SQL_FUNCTIONS = words(
  'avg|count|first|last|max|min|sum|ucase|lcase|mid|len|round|rank|now|format|coalesce|ifnull|isnull|nvl'
);
export const SQL_TYPES = words(
  'int|numeric|decimal|date|varchar|char|bigint|float|double|bit|binary|text|set|timestamp|money|' +
    'real|number|integer'
);

/** SQL as lines of coloured runs */
export function tokenizeSql(text: string): CodeToken[][] {
  let inComment = false;
  return text.split('\n').map((line) => {
    const tokens: CodeToken[] = [];
    let plain = '';
    const flush = () => {
      if (plain) tokens.push({ text: plain });
      plain = '';
    };
    const push = (value: string, kind: string) => {
      flush();
      tokens.push({ text: value, kind });
    };
    let at = 0;
    while (at < line.length) {
      if (inComment) {
        const end = line.indexOf('*/', at);
        if (end === -1) {
          push(line.slice(at), 'Comment');
          at = line.length;
        } else {
          push(line.slice(at, end + 2), 'Comment');
          at = end + 2;
          inComment = false;
        }
        continue;
      }
      const char = line[at];
      if (line.startsWith('--', at)) {
        push(line.slice(at), 'Comment');
        at = line.length;
      } else if (line.startsWith('/*', at)) {
        const end = line.indexOf('*/', at + 2);
        if (end === -1) {
          push(line.slice(at), 'Comment');
          at = line.length;
          inComment = true;
        } else {
          push(line.slice(at, end + 2), 'Comment');
          at = end + 2;
        }
      } else if (char === "'" || char === '"' || char === '`') {
        let end = line.indexOf(char, at + 1);
        if (end === -1) end = line.length - 1;
        push(line.slice(at, end + 1), 'String');
        at = end + 1;
      } else if (/[0-9]/.test(char) && !/[\w$]/.test(line[at - 1] ?? '')) {
        const match = /^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(line.slice(at));
        const number = match ? match[0] : char;
        push(number, 'Number');
        at += number.length;
      } else if (/[A-Za-z_$]/.test(char)) {
        const match = /^[A-Za-z_$][\w$]*/.exec(line.slice(at));
        const name = match ? match[0] : char;
        const lower = name.toLowerCase();
        if (SQL_KEYWORDS.has(lower) || SQL_TYPES.has(lower) || SQL_CONSTANTS.has(lower)) push(name, 'Keyword');
        else if (SQL_FUNCTIONS.has(lower)) push(name, 'Key');
        else plain += name;
        at += name.length;
      } else {
        plain += char;
        at += 1;
      }
    }
    flush();
    return tokens.length ? tokens : [{ text: '' }];
  });
}

export interface SqlSuggestion {
  label: string;
  meta: string;
}

export interface SqlSuggestions {
  from: number;
  to: number;
  items: SqlSuggestion[];
}

/**
 * What could finish the word before the cursor: the words already in the editor first, then
 * what SQL itself has. A word typed in capitals is finished in capitals.
 */
export function suggestSql(text: string, offset: number): SqlSuggestions | undefined {
  const before = /[\w$]+$/.exec(text.slice(0, offset))?.[0] ?? '';
  if (before === '' || /^\d/.test(before)) return undefined;
  const from = offset - before.length;
  const after = /^[\w$]*/.exec(text.slice(offset))?.[0] ?? '';
  const prefix = before.toLowerCase();
  const upper = before === before.toUpperCase() && before !== before.toLowerCase();
  const seen = new Set<string>();
  const items: SqlSuggestion[] = [];
  const add = (label: string, meta: string) => {
    const key = label.toLowerCase();
    if (!key.startsWith(prefix) || key === prefix || seen.has(key)) return;
    seen.add(key);
    items.push({ label, meta });
  };
  const local = `${text.slice(0, from)} ${text.slice(offset + after.length)}`.match(/[A-Za-z_$][\w$]*/g) ?? [];
  const known = (name: string) =>
    SQL_KEYWORDS.has(name) || SQL_FUNCTIONS.has(name) || SQL_TYPES.has(name) || SQL_CONSTANTS.has(name);
  for (const name of [...new Set(local)].sort()) if (!known(name.toLowerCase())) add(name, 'local');
  const cased = (name: string) => (upper ? name.toUpperCase() : name);
  for (const name of [...SQL_KEYWORDS].sort()) add(cased(name), 'keyword');
  for (const name of [...SQL_FUNCTIONS].sort()) add(cased(name), 'function');
  for (const name of [...SQL_TYPES].sort()) add(cased(name), 'type');
  for (const name of [...SQL_CONSTANTS].sort()) add(cased(name), 'constant');
  return items.length ? { from, to: offset, items } : undefined;
}

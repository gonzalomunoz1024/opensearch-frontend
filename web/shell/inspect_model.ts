/* SPDX-License-Identifier: Apache-2.0 */

/*
 * What the inspector shows, as the original's inspector plugin makes it: the views an element
 * offers (its view registry, in their order), the CSV of a table (views/data/lib/export_csv.ts),
 * the state and statistics of a request (data's courier_inspector_stats.ts and the request
 * responder's timestamp), and JSON in the coloured runs of its code blocks.
 */

import type { AggContext, Table, TableColumn, TableRow } from '../lib/aggs';
import { formulaSafe } from '../lib/docs';
import { tokenizeJson } from '../lib/json_text';
import { totalOf, type RequestRecord, type SearchResponse } from '../services/search';

// --- Views --------------------------------------------------------------------------------------

export interface InspectorView {
  id: 'data' | 'requests' | 'vega';
  title: string;
  /** What the view chooser says of it, beside it; a view with none says nothing */
  help?: string;
}

const DATA_VIEW: InspectorView = { id: 'data', title: 'Data', help: 'View the data behind the visualization' };
const REQUESTS_VIEW: InspectorView = { id: 'requests', title: 'Requests', help: 'View the requests that collected the data' };
const VEGA_VIEW: InspectorView = { id: 'vega', title: 'Vega debug' };

/**
 * The views of what is inspected, in the original's order: Data (10) where there is a table, then
 * Requests (20), then the Vega debug view, which names no order, for a Vega visualization
 */
export function inspectorViews(has: { table: boolean; vega: boolean }): InspectorView[] {
  return [...(has.table ? [DATA_VIEW] : []), REQUESTS_VIEW, ...(has.vega ? [VEGA_VIEW] : [])];
}

/** The flyout's title: "Inspector" when none is given, and an empty one as it is, as the original's */
export const inspectorTitle = (title: string | undefined): string => (title === undefined ? 'Inspector' : title);

// --- CSV ----------------------------------------------------------------------------------------

const NON_ALPHANUMERIC = /[^a-zA-Z0-9]/;
const LINE_END = '\r\n';

/** A value in a cell of the file: quoted, its quotes doubled, when it holds more than letters and digits */
function csvEscape(text: string, quoteValues: boolean): string {
  return quoteValues && NON_ALPHANUMERIC.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * A value as the raw CSV writes it: as JavaScript writes it out, a list with commas and a number
 * range as its key ("from:0,to:1000"), as the original's. The original writes the other objects
 * (the ends of a date or IP range) as "[object Object]"; their text as the table shows it is
 * written instead.
 */
export function rawCellText(column: TableColumn, value: unknown): string {
  if (value === null || typeof value !== 'object') return String(value);
  if (Array.isArray(value)) return String(value);
  if (column.agg.type === 'range') {
    const key = value as { gte?: unknown; lt?: unknown };
    // An end the range leaves open is infinite, as the original's RangeKey has it
    return `from:${String(key.gte ?? -Infinity)},to:${String(key.lt ?? Infinity)}`;
  }
  return column.format(value);
}

/**
 * The table as the original's "Download CSV" writes it: a line of the columns' names, then a line
 * per row, each ended by CR LF, the values as the table shows them (formatted) or as they came
 * (raw), joined by `csv:separator` and quoted as `csv:quoteValues` asks. Unlike the original's, a
 * text that a spreadsheet would run as a formula is written as text, as this product's other CSV
 * files are.
 */
export function inspectorCsv(table: Table, formatted: boolean, separator: string, quoteValues: boolean): string {
  const lines = [table.columns.map((column) => csvEscape(formulaSafe(column.name), quoteValues))];
  for (const row of table.rows) {
    lines.push(
      table.columns.map((column) => {
        const value = row[column.id];
        const text = formatted ? column.format(value) : rawCellText(column, value);
        return csvEscape(formatted || typeof value === 'string' ? formulaSafe(text) : text, quoteValues);
      })
    );
  }
  return lines.map((line) => `${line.join(separator)}${LINE_END}`).join('');
}

/** The file's name: the title of what is inspected, "unsaved" when it has none */
export const csvFileName = (title: string): string => `${title || 'unsaved'}.csv`;

/** The original's field types a filter can be made on */
const FILTERABLE_TYPES = new Set(['string', 'number', 'date', 'ip', 'boolean', 'histogram']);
/** The aggregations that make a filter of a bucket */
const FILTERABLE_AGGS = new Set(['date_histogram', 'date_range', 'filters', 'histogram', 'ip_range', 'range', 'significant_terms', 'terms']);

/**
 * Whether a column's cells offer "Filter for value" and "Filter out value", as the original's: the
 * buckets of an aggregation that makes filters, on no field or on one a filter can be made on
 */
export function filterableColumn(column: TableColumn, context: AggContext): boolean {
  if (column.kind !== 'bucket' || !FILTERABLE_AGGS.has(column.agg.type)) return false;
  const field = column.fieldName ? context.indexPattern?.fields.find((item) => item.name === column.fieldName) : undefined;
  if (!field) return true;
  return field.name === '_id' || Boolean(field.scripted) || (field.searchable && FILTERABLE_TYPES.has(field.type));
}

/** The row a cell's filter is made of, as the original's: the first that holds the same value, else its own */
export function filterRowIndex(table: Table, column: TableColumn, value: unknown, own: number): number {
  const found = table.rows.findIndex((row) => row[column.id] === value);
  return found < 0 ? own : found;
}

/** The value a column is sorted by: the raw one, as the original's formatted table sorts */
export function sortValueOf(column: TableColumn, row: TableRow): string | number | undefined | null {
  const value = row[column.id];
  if (value === null || value === undefined || typeof value === 'number' || typeof value === 'string') return value;
  if (typeof value === 'boolean') return String(value);
  return rawCellText(column, value);
}

// --- Requests -----------------------------------------------------------------------------------

export type RequestStatus = 'ok' | 'error' | 'pending';

/** Whether a request is under way, answered, or failed */
export function requestStatus(record: RequestRecord): RequestStatus {
  if (record.error !== undefined) return 'error';
  if (record.response !== undefined || record.tookMs !== undefined) return 'ok';
  return 'pending';
}

/** "1 request was made", "2 requests were made" */
export const requestsMadeText = (count: number): string => (count === 1 ? '1 request was made' : `${count} requests were made`);

export interface RequestStatistic {
  id: string;
  label: string;
  value: string;
  description: string;
}

/**
 * The statistics of a request, as the original logs them, in the order of their keys: the index
 * pattern's title and id for a search made for one, the query time, the hits and their total once
 * it is answered, and when it started
 */
export function requestStatistics(record: RequestRecord): RequestStatistic[] {
  const stats: Record<string, Omit<RequestStatistic, 'id'>> = {};
  if (record.indexPatternId !== undefined) {
    stats.indexPattern = {
      label: 'Index pattern',
      value: record.index,
      description: 'The index pattern that connected to the OpenSearch indices.',
    };
    stats.indexPatternId = {
      label: 'Index pattern ID',
      value: record.indexPatternId,
      description: 'The ID in the .kibana index.',
    };
  }
  const response = requestStatus(record) === 'ok' ? (record.response as SearchResponse | undefined) : undefined;
  // As the original's: no query time when it took 0 ms
  if (response?.took) {
    stats.queryTime = {
      label: 'Query time',
      value: `${response.took}ms`,
      description: 'The time it took to process the query. Does not include the time to send the request or parse it in the browser.',
    };
  }
  if (response?.hits) {
    stats.hitsTotal = {
      label: 'Hits (total)',
      value: `${totalOf(response)}`,
      description: 'The number of documents that match the query.',
    };
    stats.hits = {
      label: 'Hits',
      value: `${response.hits.hits?.length ?? 0}`,
      description: 'The number of documents returned by the query.',
    };
  }
  stats.requestTimestamp = {
    label: 'Request timestamp',
    value: new Date(record.startedAt).toISOString(),
    description: 'Time when the start of the request has been logged',
  };
  return Object.keys(stats)
    .sort()
    .map((id) => ({ id, ...stats[id] }));
}

export type RequestDetail = 'Statistics' | 'Request' | 'Response';

/** The tabs a request has: its statistics, what was asked when it was, and what came back once it did */
export function requestDetails(record: RequestRecord): RequestDetail[] {
  return [
    ...(requestStatistics(record).length ? (['Statistics'] as const) : []),
    ...(record.body ? (['Request'] as const) : []),
    ...(record.response ? (['Response'] as const) : []),
  ];
}

// --- Code ---------------------------------------------------------------------------------------

export interface CodeRun {
  text: string;
  /** As the original's code block colours JSON: keys, strings, numbers and true and false, null, and the signs */
  kind?: 'property' | 'string' | 'number' | 'keyword' | 'punctuation';
}

/** A run of plain text, its braces, brackets and commas apart, as the original's signs */
function plainRuns(text: string): CodeRun[] {
  return text
    .split(/([{}[\],])/)
    .filter((part) => part !== '')
    .map((part) => (/^[{}[\],]$/.test(part) ? { text: part, kind: 'punctuation' as const } : { text: part }));
}

/** JSON as lines of coloured runs, as the original's code block draws a JSON request or response */
export function jsonRuns(text: string): CodeRun[][] {
  return tokenizeJson(text).map((tokens) =>
    tokens.flatMap((token): CodeRun[] => {
      switch (token.kind) {
        case 'Key':
          return [{ text: token.text, kind: 'property' }];
        case 'String':
          return [{ text: token.text, kind: 'string' }];
        case 'Number':
          return [{ text: token.text, kind: 'number' }];
        // true and false are drawn as the numbers, null as a keyword
        case 'Keyword':
          return [{ text: token.text, kind: token.text === 'null' ? 'keyword' : 'number' }];
        default:
          return plainRuns(token.text);
      }
    })
  );
}

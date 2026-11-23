/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AggContext, Table, TableColumn } from '../../web/lib/aggs';
import type { Field } from '../../web/lib/types';
import type { RequestRecord } from '../../web/services/search';
import {
  csvFileName,
  filterRowIndex,
  filterableColumn,
  inspectorCsv,
  inspectorTitle,
  inspectorViews,
  jsonRuns,
  rawCellText,
  requestDetails,
  requestStatistics,
  requestStatus,
  requestsMadeText,
  sortValueOf,
} from '../../web/shell/inspect_model';

const column = (id: string, name: string, type: string, format: (value: unknown) => string, kind: 'bucket' | 'metric' = 'bucket'): TableColumn => ({
  id,
  name,
  kind,
  agg: { id, type },
  format,
});

const DAY = (value: unknown) => new Date(Number(value)).toISOString().slice(0, 10);
const COUNT = (value: unknown) => Number(value).toLocaleString('en-US');

// The table of the sample's "[Logs] Response Codes Over Time + Annotations" as the original's
// inspector shows it, its first rows
const TABLE: Table = {
  columns: [
    column('col-0-2', 'timestamp per 30 days', 'date_histogram', DAY),
    column('col-1-3', 'response.keyword: Descending', 'terms', String),
    column('col-2-1', 'Count', 'count', COUNT, 'metric'),
  ],
  rows: [
    { 'col-0-2': Date.UTC(2026, 10, 3), 'col-1-3': '200', 'col-2-1': 3842 },
    { 'col-0-2': Date.UTC(2026, 10, 3), 'col-1-3': '404', 'col-2-1': 193 },
  ],
};

describe('the views of the inspector', () => {
  it('are the data where there is a table, the requests, and the debug view of a Vega visualization, in this order', () => {
    assert.deepEqual(
      inspectorViews({ table: true, vega: false }).map((view) => view.title),
      ['Data', 'Requests']
    );
    assert.deepEqual(
      inspectorViews({ table: false, vega: false }).map((view) => view.title),
      ['Requests']
    );
    assert.deepEqual(
      inspectorViews({ table: false, vega: true }).map((view) => view.title),
      ['Requests', 'Vega debug']
    );
  });

  it('say what they show, except the Vega debug view', () => {
    assert.deepEqual(
      inspectorViews({ table: true, vega: true }).map((view) => view.help),
      ['View the data behind the visualization', 'View the requests that collected the data', undefined]
    );
  });

  it('are under the title given, "Inspector" when none is, and an empty one as it is', () => {
    assert.equal(inspectorTitle(undefined), 'Inspector');
    assert.equal(inspectorTitle(''), '');
    assert.equal(inspectorTitle('[Logs] Visits'), '[Logs] Visits');
  });
});

describe('the CSV of the inspector', () => {
  it('writes the names, then a line a row, each ended by CR LF, the values as the table shows them', () => {
    assert.equal(
      inspectorCsv(TABLE, true, ',', true),
      '"timestamp per 30 days","response.keyword: Descending",Count\r\n' +
        '"2026-11-03",200,"3,842"\r\n' +
        '"2026-11-03",404,193\r\n'
    );
  });

  it('writes the values as they came for "Raw CSV": a date as its time stamp', () => {
    assert.equal(
      inspectorCsv(TABLE, false, ',', true),
      '"timestamp per 30 days","response.keyword: Descending",Count\r\n' +
        `${Date.UTC(2026, 10, 3)},200,3842\r\n` +
        `${Date.UTC(2026, 10, 3)},404,193\r\n`
    );
  });

  it('quotes a value of more than letters and digits only when csv:quoteValues says so, doubling its quotes', () => {
    const table: Table = {
      columns: [column('a', 'Name "a"', 'terms', String)],
      rows: [{ a: 'say "hi"' }, { a: 'plain' }],
    };
    assert.equal(inspectorCsv(table, true, ';', true), '"Name ""a"""\r\n"say ""hi"""\r\nplain\r\n');
    assert.equal(inspectorCsv(table, true, ';', false), 'Name "a"\r\nsay "hi"\r\nplain\r\n');
  });

  it('writes a text that a spreadsheet would run as a formula as text, and a number below zero as it is', () => {
    const table: Table = {
      columns: [column('a', '=Name', 'terms', String), column('b', 'Sum', 'sum', String, 'metric')],
      rows: [{ a: '=1+1', b: -5.3 }],
    };
    assert.equal(inspectorCsv(table, true, ',', false), "'=Name,Sum\r\n'=1+1,-5.3\r\n");
    assert.equal(inspectorCsv(table, false, ',', false), "'=Name,Sum\r\n'=1+1,-5.3\r\n");
  });

  it('writes a number range as its key, its open ends infinite, and a list with commas', () => {
    const range = column('r', 'bytes ranges', 'range', () => '≥ 0 and < 1,000');
    assert.equal(rawCellText(range, { gte: 0, lt: 1000 }), 'from:0,to:1000');
    assert.equal(rawCellText(range, { lt: 1000 }), 'from:-Infinity,to:1000');
    assert.equal(rawCellText(range, { gte: 1000 }), 'from:1000,to:Infinity');
    assert.equal(rawCellText(column('t', 'tags', 'terms', String), ['a', 'b']), 'a,b');
    assert.equal(rawCellText(column('t', 'tags', 'terms', String), null), 'null');
  });

  it('writes the ends of a date range as the table shows them, where the original writes "[object Object]"', () => {
    const dates = column('d', 'timestamp date ranges', 'date_range', () => 'Nov 1, 2026 to Dec 1, 2026');
    assert.equal(rawCellText(dates, { gte: 1, lt: 2 }), 'Nov 1, 2026 to Dec 1, 2026');
  });

  it('is named after what is inspected, "unsaved" when it has no title', () => {
    assert.equal(csvFileName('[Logs] Visits'), '[Logs] Visits.csv');
    assert.equal(csvFileName(''), 'unsaved.csv');
  });

  it('offers to filter by the buckets of an aggregation that makes filters, on a field a filter can be made on', () => {
    const field = (name: string, type: string, extra: Partial<Field> = {}): Field => ({ name, type, searchable: true, aggregatable: true, ...extra });
    const context: AggContext = {
      indexPattern: {
        id: 'logs',
        title: 'logs',
        fieldFormatMap: {},
        fields: [field('response.keyword', 'string'), field('geo', 'geo_point'), field('hidden', 'string', { searchable: false }), field('hour', 'number', { scripted: true, searchable: false })],
      },
    };
    const on = (type: string, fieldName?: string, kind: 'bucket' | 'metric' = 'bucket') =>
      filterableColumn({ ...column('c', 'c', type, String, kind), fieldName }, context);
    assert.equal(on('terms', 'response.keyword'), true);
    assert.equal(on('date_histogram', 'timestamp'), true, 'a field the index pattern does not list');
    assert.equal(on('filters'), true);
    assert.equal(on('terms', 'hour'), true, 'a scripted field');
    assert.equal(on('terms', 'hidden'), false, 'a field that cannot be searched');
    assert.equal(on('geohash_grid', 'geo'), false, 'an aggregation that makes no filter');
    assert.equal(on('count', undefined, 'metric'), false);
  });

  it('makes the filter of a cell of the first row that holds its value, as the original', () => {
    const [day, code] = TABLE.columns;
    assert.equal(filterRowIndex(TABLE, day, TABLE.rows[1][day.id], 1), 0);
    assert.equal(filterRowIndex(TABLE, code, '404', 1), 1);
    assert.equal(filterRowIndex(TABLE, code, '500', 1), 1);
  });

  it('sorts as the original\'s table: by the values as they came', () => {
    const [day, code, count] = TABLE.columns;
    assert.equal(sortValueOf(day, TABLE.rows[0]), Date.UTC(2026, 10, 3));
    assert.equal(sortValueOf(code, TABLE.rows[0]), '200');
    assert.equal(sortValueOf(count, TABLE.rows[1]), 193);
    assert.equal(sortValueOf(column('b', 'ok', 'terms', String), { b: true }), 'true');
    assert.equal(sortValueOf(column('r', 'bytes ranges', 'range', String), { r: { gte: 0, lt: 10 } }), 'from:0,to:10');
  });
});

const record = (extra: Partial<RequestRecord> = {}): RequestRecord => ({
  name: 'data',
  index: 'opensearch_dashboards_sample_data_logs',
  body: { size: 0 },
  startedAt: Date.UTC(2026, 10, 23, 18, 0, 0, 120),
  ...extra,
});

const RESPONSE = { took: 3, hits: { total: { value: 14074, relation: 'eq' }, hits: [] } };

describe('the requests of the inspector', () => {
  it('are under way, answered or failed', () => {
    assert.equal(requestStatus(record()), 'pending');
    assert.equal(requestStatus(record({ response: RESPONSE, tookMs: 105 })), 'ok');
    assert.equal(requestStatus(record({ error: 'Bad Request', response: { error: {} }, tookMs: 12 })), 'error');
  });

  it('are counted as the original counts them', () => {
    assert.equal(requestsMadeText(1), '1 request was made');
    assert.equal(requestsMadeText(2), '2 requests were made');
  });

  it('have the statistics of the original in the order of their keys', () => {
    const stats = requestStatistics(record({ indexPatternId: '90943e30-9a47-11e8-b64d-95841ca0b247', response: RESPONSE, tookMs: 105 }));
    assert.deepEqual(
      stats.map((stat) => [stat.id, stat.label, stat.value]),
      [
        ['hits', 'Hits', '0'],
        ['hitsTotal', 'Hits (total)', '14074'],
        ['indexPattern', 'Index pattern', 'opensearch_dashboards_sample_data_logs'],
        ['indexPatternId', 'Index pattern ID', '90943e30-9a47-11e8-b64d-95841ca0b247'],
        ['queryTime', 'Query time', '3ms'],
        ['requestTimestamp', 'Request timestamp', '2026-11-23T18:00:00.120Z'],
      ]
    );
    assert.equal(stats[0].description, 'The number of documents returned by the query.');
    assert.equal(stats[4].description, 'The time it took to process the query. Does not include the time to send the request or parse it in the browser.');
  });

  it('have no query time when it took no time, no index pattern without one, and only their start before an answer', () => {
    assert.deepEqual(
      requestStatistics(record({ response: { ...RESPONSE, took: 0 }, tookMs: 4 })).map((stat) => stat.id),
      ['hits', 'hitsTotal', 'requestTimestamp']
    );
    assert.deepEqual(
      requestStatistics(record()).map((stat) => stat.id),
      ['requestTimestamp']
    );
    assert.deepEqual(
      requestStatistics(record({ error: 'Bad Request', response: { error: {} }, tookMs: 2 })).map((stat) => stat.id),
      ['requestTimestamp']
    );
  });

  it('show their statistics, what was asked, and what came back once it did', () => {
    assert.deepEqual(requestDetails(record()), ['Statistics', 'Request']);
    assert.deepEqual(requestDetails(record({ response: RESPONSE, tookMs: 1 })), ['Statistics', 'Request', 'Response']);
  });
});

describe('the code of a request', () => {
  it('colours JSON as the original\'s code block: keys, strings, numbers with true and false, null, and the signs', () => {
    const lines = jsonRuns('{\n  "a": "x",\n  "b": [1, true, null]\n}');
    const kinds = lines.map((runs) => runs.map((run) => `${run.kind ?? 'plain'}:${run.text}`));
    assert.deepEqual(kinds, [
      ['punctuation:{'],
      ['plain:  ', 'property:"a"', 'plain:: ', 'string:"x"', 'punctuation:,'],
      ['plain:  ', 'property:"b"', 'plain:: ', 'punctuation:[', 'number:1', 'punctuation:,', 'plain: ', 'number:true', 'punctuation:,', 'plain: ', 'keyword:null', 'punctuation:]'],
      ['punctuation:}'],
    ]);
    assert.equal(lines.map((runs) => runs.map((run) => run.text).join('')).join('\n'), '{\n  "a": "x",\n  "b": [1, true, null]\n}');
  });
});

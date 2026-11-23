/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The data table as OpenSearch Dashboards 3.9.0's table visualization works it out (vis_type_table:
 * convert_to_formatted_data, add_percentage_col, convert_to_csv_data, the dynamic table's widths
 * and lodash's orderBy): the totals of each function, the percentage column, the tables a split
 * makes, the order of the rows, the filters of a cell, the CSV of the export and the widths.
 */

process.env.TZ = 'UTC';

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { OTHER_KEY, tabify, type AggConfig, type AggContext, type TableRow } from '../../web/lib/aggs';
import type { Field, IndexPattern } from '../../web/lib/types';
import {
  COLUMN_BUFFER,
  HEADER_BUTTON_SPACE,
  MIN_COLUMN_WIDTH,
  cellFilters,
  columnWidths,
  compareAscending,
  csvFileName,
  formatTable,
  orderRows,
  rawText,
  tableVisData,
  toCsv,
  truncatesHeader,
  type TableVisParams,
} from '../../web/vis/table_data';

const field = (name: string, type: string): Field => ({ name, type, searchable: true, aggregatable: true });

const logs: IndexPattern = {
  id: 'logs',
  title: 'logs-*',
  timeFieldName: 'timestamp',
  fields: [field('timestamp', 'date'), field('bytes', 'number'), field('geo.dest', 'string'), field('machine.os', 'string')],
  fieldFormatMap: {},
};
const context: AggContext = { indexPattern: logs };

const count: AggConfig = { id: '1', enabled: true, type: 'count', schema: 'metric', params: {} };
const avgBytes: AggConfig = { id: '2', enabled: true, type: 'avg', schema: 'metric', params: { field: 'bytes' } };
const dest: AggConfig = {
  id: '3',
  enabled: true,
  type: 'terms',
  schema: 'bucket',
  params: { field: 'geo.dest', size: 5, order: 'desc', orderBy: '1' },
};
const days: AggConfig = {
  id: '4',
  enabled: true,
  type: 'date_histogram',
  schema: 'bucket',
  params: { field: 'timestamp', interval: 'd', min_doc_count: 1, extended_bounds: {} },
};
const os: AggConfig = {
  id: '5',
  enabled: true,
  type: 'terms',
  schema: 'split',
  params: { field: 'machine.os', size: 5, order: 'desc', orderBy: '1' },
};

/** Three destinations: 3, 5 and 2 documents of 100, 300 and 50 bytes on average */
const destinations = () =>
  tabify(
    [count, avgBytes, dest],
    {
      aggregations: {
        '3': {
          buckets: [
            { key: 'CN', doc_count: 3, '2': { value: 100 } },
            { key: 'IN', doc_count: 5, '2': { value: 300 } },
            { key: 'US', doc_count: 2, '2': { value: 50 } },
          ],
        },
      },
    },
    context
  );

const totals = (totalFunc: TableVisParams['totalFunc']) =>
  formatTable(destinations().columns, destinations().rows, { showTotal: true, totalFunc }, context).columns.map(
    (column) => column.formattedTotal
  );

describe('the columns of the data table and their totals', () => {
  it('shows the buckets and the metrics in the order of the answer, titled as their columns', () => {
    const table = formatTable(destinations().columns, destinations().rows, {}, context);
    assert.deepEqual(
      table.columns.map((column) => column.title),
      ['geo.dest: Descending', 'Count', 'Average bytes']
    );
    // Only a bucket's cells add filters
    assert.deepEqual(
      table.columns.map((column) => column.filterable),
      [true, false, false]
    );
  });

  it('adds up, averages and finds the least and the most of each metric, and leaves a bucket of words without', () => {
    assert.deepEqual(totals('sum'), [undefined, '10', '450']);
    assert.deepEqual(totals('avg'), [undefined, '3.333', '150']);
    assert.deepEqual(totals('min'), [undefined, '2', '50']);
    assert.deepEqual(totals('max'), [undefined, '5', '300']);
  });

  it('counts the rows under every column, the buckets too, as a number', () => {
    assert.deepEqual(totals('count'), [3, 3, 3]);
  });

  it('gives a date the least and the most, written as the buckets are, and no sum or average', () => {
    const table = tabify(
      [count, days],
      {
        aggregations: {
          '4': {
            buckets: [
              { key: Date.UTC(2026, 10, 2), doc_count: 4 },
              { key: Date.UTC(2026, 10, 1), doc_count: 6 },
            ],
          },
        },
      },
      context
    );
    const of = (totalFunc: TableVisParams['totalFunc']) =>
      formatTable(table.columns, table.rows, { totalFunc }, context).columns.map((column) => column.formattedTotal);
    assert.deepEqual(of('sum'), [undefined, '10']);
    assert.deepEqual(of('avg'), [undefined, '5']);
    assert.equal(of('min')[1], '4');
    // A day's bucket is written as its day, as the scaled date format writes it
    assert.equal(of('min')[0], '2026-11-01');
    assert.equal(of('max')[0], '2026-11-02');
  });

  it('writes nothing for the least of a column with no values', () => {
    const { columns } = destinations();
    const rows: TableRow[] = destinations().rows.map((row) => ({ ...row, [columns[2].id]: null }));
    const table = formatTable(columns, rows, { totalFunc: 'min' }, context);
    assert.equal(table.columns[2].formattedTotal, '');
  });
});

describe('the percentage column', () => {
  it('follows its column with the share of each row, titled "<column> percentages"', () => {
    const { columns, rows } = destinations();
    const table = formatTable(columns, rows, { percentageCol: 'Count' }, context);
    assert.deepEqual(
      table.columns.map((column) => column.title),
      ['geo.dest: Descending', 'Count', 'Count percentages', 'Average bytes']
    );
    const percents = table.columns[2];
    assert.equal(percents.filterable, false);
    assert.deepEqual(
      table.rows.map((row) => percents.cell(row[percents.id]).text),
      ['30%', '50%', '20%']
    );
    // A percentage column has no total
    assert.equal(percents.formattedTotal, undefined);
  });

  it('is left out when its column is not there any more', () => {
    const { columns, rows } = destinations();
    const table = formatTable(columns, rows, { percentageCol: 'Sum of bytes' }, context);
    assert.equal(table.columns.length, 3);
  });

  it('writes 0 for every row when the column adds up to nothing', () => {
    const { columns } = destinations();
    const rows = destinations().rows.map((row) => ({ ...row, [columns[1].id]: 0 }));
    const table = formatTable(columns, rows, { percentageCol: 'Count' }, context);
    assert.deepEqual(
      table.rows.map((row) => table.columns[2].text(row[table.columns[2].id])),
      ['0%', '0%', '0%']
    );
  });
});

describe('the tables of a split', () => {
  const split = () =>
    tabify(
      [count, os, dest],
      {
        aggregations: {
          '5': {
            buckets: [
              { key: 'win xp', doc_count: 4, '3': { buckets: [{ key: 'CN', doc_count: 3 }, { key: 'IN', doc_count: 1 }] } },
              { key: 'osx', doc_count: 2, '3': { buckets: [{ key: 'US', doc_count: 2 }] } },
            ],
          },
        },
      },
      context
    );

  it('makes a table per value, in the order they come, titled "<value>: <split>", without the split column', () => {
    const data = tableVisData(split(), {}, context, true);
    assert.equal(data.table, undefined);
    assert.deepEqual(
      data.tableGroups.map((group) => group.title),
      ['win xp: machine.os: Descending', 'osx: machine.os: Descending']
    );
    assert.deepEqual(
      data.tableGroups.map((group) => group.table.rows.length),
      [2, 1]
    );
    assert.deepEqual(
      data.tableGroups[0].table.columns.map((column) => column.title),
      ['geo.dest: Descending', 'Count']
    );
    // Each table has its own totals
    assert.deepEqual(
      data.tableGroups.map((group) => group.table.columns[1].formattedTotal),
      ['4', '2']
    );
  });

  it('stacks the tables of a split into rows and sets those of one into columns side by side', () => {
    assert.equal(tableVisData(split(), {}, context, true).direction, 'row');
    assert.equal(tableVisData(split(), {}, context, false).direction, 'column');
  });

  it('draws one table when nothing splits it', () => {
    const data = tableVisData(destinations(), {}, context, true);
    assert.equal(data.table?.rows.length, 3);
    assert.deepEqual(data.tableGroups, []);
  });
});

describe('the order of the rows, as lodash orderBy sorts them', () => {
  it('puts undefined last, after null and NaN, and compares the rest with < and >', () => {
    const values = [3, undefined, null, 1, Number.NaN, 2];
    const sorted = [...values].sort(compareAscending);
    assert.deepEqual(sorted.slice(0, 3), [1, 2, 3]);
    assert.equal(sorted[3], null);
    assert.ok(Number.isNaN(sorted[4]));
    assert.equal(sorted[5], undefined);
  });

  it('compares text by its code units, so "x86.tar" comes before "x86_64" and "Z" before "a"', () => {
    assert.deepEqual(['x86_64', 'a', 'x86.tar', 'Z'].sort(compareAscending), ['Z', 'a', 'x86.tar', 'x86_64']);
  });

  it('keeps the order of rows that compare equal, both ways', () => {
    const rows: TableRow[] = [
      { id: 'a', n: 2 },
      { id: 'b', n: 1 },
      { id: 'c', n: 2 },
      { id: 'd', n: 1 },
    ];
    assert.deepEqual(
      orderRows(rows, 'n', 'asc').map((row) => row.id),
      ['b', 'd', 'a', 'c']
    );
    assert.deepEqual(
      orderRows(rows, 'n', 'desc').map((row) => row.id),
      ['a', 'c', 'b', 'd']
    );
  });

  it('orders ranges by the text of their key', () => {
    assert.equal(compareAscending({ gte: 0, lt: 1000 }, { gte: 1000, lt: 5000 }) < 0, true);
  });
});

describe('the filters a cell adds', () => {
  it('filters for the bucket of the cell, and against it for "Filter out value"', () => {
    const { columns, rows } = destinations();
    const [filter] = cellFilters(columns, rows, 0, 1, false, context);
    assert.deepEqual(filter.query, { match_phrase: { 'geo.dest': 'IN' } });
    assert.equal(filter.meta.negate, false);
    const [against] = cellFilters(columns, rows, 0, 1, true, context);
    assert.deepEqual(against.query, { match_phrase: { 'geo.dest': 'IN' } });
    assert.equal(against.meta.negate, true);
  });

  it('adds nothing for a metric, a cell with no value or a row that is not there', () => {
    const { columns, rows } = destinations();
    assert.deepEqual(cellFilters(columns, rows, 1, 0, false, context), []);
    assert.deepEqual(cellFilters(columns, [{ [columns[0].id]: null }], 0, 0, false, context), []);
    assert.deepEqual(cellFilters(columns, rows, 0, 9, false, context), []);
  });

  it('filters the bucket of the other terms against the terms of the rows beside it', () => {
    const rest: AggConfig = { ...dest, params: { ...dest.params, otherBucket: true, otherBucketLabel: 'Other' } };
    const { columns, rows } = tabify(
      [count, rest],
      {
        aggregations: {
          '3': {
            buckets: [
              { key: 'CN', doc_count: 3 },
              { key: 'IN', doc_count: 5 },
              { key: OTHER_KEY, doc_count: 9 },
            ],
          },
        },
      },
      context
    );
    const [filter] = cellFilters(columns, rows, 0, 2, false, context);
    assert.equal(filter.meta.type, 'phrases');
    assert.equal(filter.meta.negate, true);
    assert.deepEqual(filter.meta.params, ['CN', 'IN']);
    // "Filter out value" turns it round: the documents of those terms
    const [against] = cellFilters(columns, rows, 0, 2, true, context);
    assert.equal(against.meta.negate, false);
    // Of the rows the table shows, in its order
    const [sorted] = cellFilters(columns, [rows[2], rows[1], rows[0]], 0, 0, false, context);
    assert.deepEqual(sorted.meta.params, ['IN', 'CN']);
  });
});

describe('the CSV of the export', () => {
  const table = () => formatTable(destinations().columns, destinations().rows, {}, context);

  it('writes a line of titles and a line per row, each ended by CR LF, quoting what is not letters and digits', () => {
    const { columns, rows } = table();
    assert.equal(
      toCsv(false, rows, columns, ',', true),
      '"geo.dest: Descending",Count,"Average bytes"\r\nCN,3,100\r\nIN,5,300\r\nUS,2,50\r\n'
    );
  });

  it('writes the values as the table shows them when formatted, with the separator asked for', () => {
    const { columns } = table();
    const rows = [{ [columns[0].id]: 'a "b"', [columns[1].id]: 12345, [columns[2].id]: 0.5 }];
    assert.equal(
      toCsv(true, rows, columns, ';', true),
      '"geo.dest: Descending";Count;"Average bytes"\r\n"a ""b""";"12,345";"0.5"\r\n'
    );
    assert.equal(toCsv(true, rows, columns, ';', false), 'geo.dest: Descending;Count;Average bytes\r\na "b";12,345;0.5\r\n');
  });

  it('writes nothing of a format as its format writes it: a number as nothing, a word as a dash between spaces', () => {
    const { columns } = table();
    const rows = [{ [columns[0].id]: null, [columns[1].id]: null, [columns[2].id]: undefined }];
    assert.equal(toCsv(true, rows, columns, ',', false), 'geo.dest: Descending,Count,Average bytes\r\n - ,,\r\n');
  });

  it('writes an empty word as nothing, in the cell, the export and the title of its table', () => {
    const { columns, rows } = tabify(
      [count, os, dest],
      { aggregations: { '5': { buckets: [{ key: '', doc_count: 4, '3': { buckets: [{ key: '', doc_count: 4 }] } }] } } },
      context
    );
    const data = tableVisData({ columns, rows }, {}, context, true);
    assert.equal(data.tableGroups[0].title, ': machine.os: Descending');
    const [bucket] = data.tableGroups[0].table.columns;
    assert.deepEqual(bucket.cell(''), { text: '' });
    assert.equal(toCsv(true, data.tableGroups[0].table.rows, [bucket], ',', true), '"geo.dest: Descending"\r\n\r\n');
  });

  it('writes a range by its ends and an object as JSON in the raw export', () => {
    assert.equal(rawText({ gte: 0, lt: 1000 }), 'from:0,to:1000');
    assert.equal(rawText({ a: 1 }), '{"a":1}');
    assert.equal(rawText(12.5), '12.5');
  });

  it('names the file after the visualization, or "unsaved", and the kind of export', () => {
    assert.equal(csvFileName('Top destinations', false), 'Top destinations-raw.csv');
    assert.equal(csvFileName('', true), 'unsaved-formatted.csv');
    assert.equal(csvFileName(undefined, false), 'unsaved-raw.csv');
  });
});

describe('the widths of the columns', () => {
  it('makes a column as wide as its widest cell, or its title and the room of the arrow, and a margin', () => {
    assert.deepEqual(columnWidths([[40, 120], [30]], [50, 60], [], 1000), [120 + COLUMN_BUFFER, 60 + HEADER_BUTTON_SPACE + COLUMN_BUFFER]);
  });

  it('keeps a width dragged and shrinks the others together to fit, to 80 px at least', () => {
    // 400 + 200 + 100 do not fit in 500: the dragged 300 stays, the rest share 200
    const widths = columnWidths([[368], [168], [68]], [0, 0, 0], [{ colIndex: 2, width: 300 }], 500);
    assert.equal(widths[2], 300);
    assert.equal(widths[0], 200 * (400 / 600));
    assert.equal(widths[1], Math.max(200 * (200 / 600), MIN_COLUMN_WIDTH));
  });

  it('leaves the widths as they are when everything fits or nothing is left to share', () => {
    assert.deepEqual(columnWidths([[100]], [10], [], 1000), [132]);
    assert.deepEqual(columnWidths([[100], [100]], [10, 10], [{ colIndex: 0, width: 900 }], 800), [900, 132]);
  });

  it('cuts a title short when it is half as wide again as the room beside its arrow', () => {
    assert.equal(truncatesHeader(150, 124), false);
    assert.equal(truncatesHeader(151, 124), true);
  });
});

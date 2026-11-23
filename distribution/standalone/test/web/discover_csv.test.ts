/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Discover's "Download as CSV" as the original's download_csv writes it. The files expected here
 * are those papaparse 5.5.2, the reference's, writes for the same fields and rows, and the values
 * those the original's formats write as text.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  MAX_DOWNLOAD_CSV_COUNT,
  csvColumns,
  csvFileName,
  csvOptions,
  csvWriter,
  missingText,
  textValue,
  unparseCsv,
} from '../../web/apps/discover/csv';
import { DownloadCsvPopoverContent, discoverCsv } from '../../web/apps/discover/download_csv';
import { setDefaultTimeZone } from '../../web/lib/dates';
import type { RawHit } from '../../web/lib/docs';
import { DEFAULT_FORMAT_SETTINGS, createFormatter } from '../../web/lib/field_formats';
import type { Field, FieldFormatSpec, IndexPattern } from '../../web/lib/types';
import { createServices, type BootData } from '../../web/services';

const META = ['_source', '_id', '_type', '_index', '_score'];
const field = (name: string, type: string, extra: Partial<Field> = {}): Field => ({
  name,
  type,
  searchable: true,
  aggregatable: true,
  ...extra,
});
// The fields of the sample logs that matter here, with the meta fields its pattern lists
const pattern: IndexPattern = {
  id: 'logs',
  title: 'logs*',
  timeFieldName: 'timestamp',
  fields: [
    field('_id', 'string'),
    field('_index', 'string'),
    field('_score', 'number', { searchable: false, aggregatable: false }),
    field('_source', '_source', { searchable: false, aggregatable: false }),
    field('_type', 'string'),
    field('timestamp', 'date'),
    field('bytes', 'number'),
    field('extension', 'string'),
    field('machine.os', 'string'),
    field('tags', 'string'),
    field('clientip', 'ip'),
  ],
  fieldFormatMap: {},
};
const hits: RawHit[] = [
  {
    _index: 'logs',
    _id: 'a',
    _score: null,
    _source: { timestamp: '2026-11-20T15:54:39.514Z', bytes: 2013, extension: 'css', machine: { os: 'win 8' }, tags: ['success', 'info'] },
    sort: [1795276479514],
  },
  {
    _index: 'logs',
    _id: 'b',
    _score: null,
    _source: { timestamp: '2026-11-20T15:40:00.000Z', extension: '', machine: { os: '=cmd' } },
    sort: [1795275600000],
  },
];

const settings = { ...DEFAULT_FORMAT_SETTINGS, timeZone: 'UTC' };

describe('the choices of "Download as CSV"', () => {
  it('offers every hit up to 10,000 only when there are more hits than rows on screen', () => {
    assert.equal(MAX_DOWNLOAD_CSV_COUNT, 10000);
    assert.deepEqual(csvOptions(12, 12), { maxCount: 12, showMax: false });
    assert.deepEqual(csvOptions(500, 600), { maxCount: 600, showMax: true });
    assert.deepEqual(csvOptions(500, 14004), { maxCount: 10000, showMax: true });
    assert.deepEqual(csvOptions(10000, 14004), { maxCount: 10000, showMax: false });
  });

  it('draws the original popover: its title, "Visible (N)", and "Max available" with its call-out', () => {
    const popover = (rowsCount: number, hitsCount: number) =>
      renderToStaticMarkup(createElement(DownloadCsvPopoverContent, { rowsCount, hitsCount, onDownload: () => undefined }));
    const few = popover(12, 12);
    assert.match(few, /data-test-subj="dscDownloadCsvPopoverContent"/);
    assert.match(few, /data-test-subj="dscDownloadCsvTitle"><strong>Download as CSV<\/strong>/);
    // each option a box with its test id, its input and its label, as EuiRadio draws it
    assert.match(few, /<div class="atlRadio" data-test-subj="dscDownloadCsvOptionVisible"><input type="radio" id="([^"]+)"[^>]* checked=""[^>]*\/><label for="\1">Visible \(12\)<\/label><\/div>/);
    assert.equal(few.includes('dscDownloadCsvOptionMax'), false);
    assert.equal(few.includes('dscDownloadCsvCallout'), false);
    assert.match(few, /data-test-subj="dscDownloadCsvSubmit"[^>]*>Download CSV<\/button>/);

    const many = popover(500, 14004);
    assert.match(many, /<label for="[^"]+">Visible \(500\)<\/label>/);
    assert.match(many, /data-test-subj="dscDownloadCsvOptionMax"><input type="radio"[^>]* value="max"\/><label for="[^"]+">Max available \(10,000\)<\/label>/);
    assert.match(many, /data-test-subj="dscDownloadCsvCallout".*There is a limit of 10,000 total result downloads\./);
  });
});

describe('the columns of the file', () => {
  it('are the chosen ones after the time field, as the table names them', () => {
    assert.deepEqual(csvColumns(['bytes', 'extension'], 'timestamp', false), ['timestamp', 'bytes', 'extension']);
    // the view of the whole document: the time and the source
    assert.deepEqual(csvColumns(['_source'], 'timestamp', false), ['timestamp', '_source']);
  });

  it('leave the time field out under doc_table:hideTimeColumn, where it is chosen or the pattern has none', () => {
    assert.deepEqual(csvColumns(['bytes'], 'timestamp', true), ['bytes']);
    assert.deepEqual(csvColumns(['bytes', 'timestamp'], 'timestamp', false), ['bytes', 'timestamp']);
    assert.deepEqual(csvColumns(['_source'], undefined, false), ['_source']);
  });
});

describe('a value of the file, as its format writes it as text', () => {
  const spec = (id: string, params: Record<string, unknown> = {}): FieldFormatSpec => ({ id, params });
  const missing = (format: FieldFormatSpec, ...value: [] | [undefined]) =>
    missingText(format, value.length ? undefined : null, createFormatter(format, settings));

  it('writes no value as each of the original formats does', () => {
    assert.equal(missing(spec('number')), '');
    assert.equal(missing(spec('bytes')), '');
    assert.equal(missing(spec('percent')), '');
    assert.equal(missing(spec('date')), '-');
    assert.equal(missing(spec('ip')), '-');
    assert.equal(missing(spec('string')), ' - ');
    assert.equal(missing(spec('string', { transform: 'upper' })), 'NULL');
    assert.equal(missing(spec('string', { transform: 'urlparam' }), undefined), 'undefined');
    assert.equal(missing(spec('boolean')), ' - ');
    assert.equal(missing(spec('truncate', { fieldLength: 10 })), '');
    assert.equal(missing(spec('static_lookup', { lookupEntries: [{ key: 'null', value: 'none' }] })), 'none');
    assert.equal(missing(spec('static_lookup', { lookupEntries: [], unknownKeyValue: 'unknown' })), 'unknown');
    assert.equal(missing(spec('url', { urlTemplate: 'https://example.org/?q={{value}}' })), 'https://example.org/?q=null');
    assert.equal(missing(spec('url')), null);
    assert.equal(missing(spec('_source')), 'null');
  });

  it('writes a list as the JSON of its values, each written by the format', () => {
    const number = spec('number');
    assert.equal(textValue(number, createFormatter(number, settings), [2013, null, 5]), '["2,013","","5"]');
    const text = spec('string');
    assert.equal(textValue(text, createFormatter(text, settings), ['a', ['b', null]]), '["a","[\\"b\\",\\" - \\"]"]');
  });

  it('writes the time, numbers and text formatted, and the source as the JSON of the formatted document', () => {
    const writer = csvWriter(pattern, settings, META);
    assert.deepEqual(writer.row(hits[0], ['timestamp', 'bytes', 'extension', 'machine.os', 'tags']), [
      'Nov 20, 2026 @ 15:54:39.514',
      '2,013',
      'css',
      'win 8',
      '["success","info"]',
    ]);
    // a field the document lacks: a number is nothing, a text " - "
    assert.deepEqual(writer.row(hits[1], ['bytes', 'extension', 'clientip', 'nothing']), ['', '', '-', ' - ']);
    assert.deepEqual(writer.row(hits[0], ['_source']), [
      JSON.stringify({
        timestamp: 'Nov 20, 2026 @ 15:54:39.514',
        bytes: '2,013',
        extension: 'css',
        'machine.os': 'win 8',
        tags: '["success","info"]',
        _id: 'a',
        _type: ' - ',
        _index: 'logs',
        _score: '',
      }),
    ]);
  });
});

describe('the text of the file, as papaparse writes it', () => {
  it('joins the lines with CRLF, none after the last, and quotes every value under csv:quoteValues', () => {
    assert.equal(
      unparseCsv(['timestamp', 'bytes'], [['Nov 20, 2026 @ 15:54:39.514', '2,013'], ['Nov 20, 2026 @ 15:40:00.000', '']], { quotes: true, delimiter: ',' }),
      '"timestamp","bytes"\r\n"Nov 20, 2026 @ 15:54:39.514","2,013"\r\n"Nov 20, 2026 @ 15:40:00.000",""'
    );
    assert.equal(unparseCsv(['a', 'b', 'c'], [[null, undefined, '']], { quotes: true, delimiter: ',' }), '"a","b","c"\r\n,,""');
    // no rows: the header's line is ended all the same
    assert.equal(unparseCsv(['a', 'b'], [], { quotes: true, delimiter: ',' }), '"a","b"\r\n');
  });

  it('quotes only what could not be read back otherwise when csv:quoteValues is off', () => {
    assert.equal(
      unparseCsv(
        ['timestamp', 'bytes', 'extension'],
        [['Nov 20, 2026 @ 15:54:39.514', '2,013', 'css'], ['a "b"', ' lead', 'trail '], ['x\ny', 'c\rd', '﻿bom']],
        { quotes: false, delimiter: ',' }
      ),
      'timestamp,bytes,extension\r\n"Nov 20, 2026 @ 15:54:39.514","2,013",css\r\n"a ""b"""," lead","trail "\r\n"x\ny","c\rd","﻿bom"'
    );
    // only csv:quoteValues true itself quotes everything
    assert.equal(unparseCsv(['a', 'b'], [['1', '2']], { quotes: 'true', delimiter: ',' }), 'a,b\r\n1,2');
  });

  it('separates with csv:separator, unless it holds what papaparse refuses in one', () => {
    assert.equal(unparseCsv(['a', 'b'], [['1;2', '3,4'], ['', '-']], { quotes: false, delimiter: ';' }), 'a;b\r\n"1;2";3,4\r\n;-');
    assert.equal(unparseCsv(['a', 'b'], [['1', '2']], { quotes: false, delimiter: '||' }), 'a||b\r\n1||2');
    assert.equal(unparseCsv(['a', 'b'], [['1,2', '3']], { quotes: false, delimiter: '"' }), 'a,b\r\n"1,2",3');
    assert.equal(unparseCsv(['a', 'b'], [['1', '2']], { quotes: false, delimiter: 5 }), 'a,b\r\n1,2');
    assert.equal(unparseCsv(['a', 'b'], [['1', '2']], { quotes: false, delimiter: '' }), '"a""b"\r\n"1""2"');
  });

  it("makes a document's value that a spreadsheet would run as a formula text, which the original does not", () => {
    // papaparse writes "=d" and "=1+1" as they are; the header is still written so
    assert.equal(unparseCsv(['a,b', ' c', '=d'], [['1', '2', '=1+1']], { quotes: false, delimiter: ',' }), '"a,b"," c",=d\r\n1,2,"\'=1+1"');
    assert.equal(unparseCsv(['a'], [['-'], ['-5.3']], { quotes: false, delimiter: ',' }), 'a\r\n-\r\n-5.3');
  });
});

describe('the file Discover downloads', () => {
  const boot = (settings: Record<string, unknown>) =>
    ({ basePath: '', version: '3.9.0', name: 'test', settings: { 'dateFormat:tz': 'UTC', ...settings }, settingsDefaults: {}, settingsOverrides: {} }) as unknown as BootData;

  it('is named opensearch_export_ and the day in the zone of the settings', () => {
    const now = new Date('2026-11-23T23:30:00.000Z');
    assert.equal(csvFileName(now, 'UTC'), 'opensearch_export_2026-11-23.csv');
    assert.equal(csvFileName(now, 'Asia/Tokyo'), 'opensearch_export_2026-11-24.csv');
  });

  it('holds the time and the chosen columns, formatted, quoted and separated as the settings say', () => {
    try {
      createServices(boot({}));
      assert.equal(
        discoverCsv(hits, pattern, ['bytes', 'machine.os']),
        '"timestamp","bytes","machine.os"\r\n"Nov 20, 2026 @ 15:54:39.514","2,013","win 8"\r\n"Nov 20, 2026 @ 15:40:00.000","","\'=cmd"'
      );
      createServices(boot({ 'doc_table:hideTimeColumn': true, 'csv:separator': ';', 'csv:quoteValues': false }));
      assert.equal(discoverCsv(hits, pattern, ['bytes', 'extension']), 'bytes;extension\r\n2,013;css\r\n;');
    } finally {
      setDefaultTimeZone(undefined);
    }
  });

  it('holds the time and the whole document in the view of the source', () => {
    try {
      createServices(boot({ metaFields: ['_id'] }));
      const [header, first] = discoverCsv(hits.slice(0, 1), pattern, ['_source']).split('\r\n');
      assert.equal(header, '"timestamp","_source"');
      const document = JSON.stringify({
        timestamp: 'Nov 20, 2026 @ 15:54:39.514',
        bytes: '2,013',
        extension: 'css',
        'machine.os': 'win 8',
        tags: '["success","info"]',
        _id: 'a',
      });
      assert.equal(first, `"Nov 20, 2026 @ 15:54:39.514","${document.replace(/"/g, '""')}"`);
    } finally {
      setDefaultTimeZone(undefined);
    }
  });
});

/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The sort Discover sends, as the original's getSortForSearchSource and normalizeSortRequest make
 * it. Measured on the reference with an index pattern whose time field is declared date_nanos: its
 * default sort is [{"timestamp":{"order":"desc","numeric_type":"date_nanos","unmapped_type":"boolean"}}],
 * and a sort on a scripted date field sends nothing and says "Unsupported script sort type: date".
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildDiscoverRequest, discoverSort, isTimeNanosBased, scriptSortType, sortClause } from '../../web/apps/discover/search';
import type { Field, IndexPattern } from '../../web/lib/types';
import { createServices, type BootData } from '../../web/services';

const field = (name: string, type: string, extra: Partial<Field> = {}): Field => ({ name, type, searchable: true, aggregatable: true, ...extra });
const scripted = (name: string, type: string, script: string) => field(name, type, { scripted: true, script, lang: 'painless' });

const fields = [
  field('timestamp', 'date', { esTypes: ['date_nanos'] }),
  field('bytes', 'number', { esTypes: ['long'] }),
  field('_score', 'number', { searchable: false, aggregatable: false }),
  scripted('zz_snum', 'number', "doc['bytes'].value"),
  scripted('zz_sstr', 'string', "doc['extension.keyword'].value"),
  scripted('zz_sbool', 'boolean', "doc['bytes'].value > 5000"),
  scripted('zz_sdate', 'date', "doc['timestamp'].value"),
];
const nanos: IndexPattern = { id: 'n', title: 'logs', timeFieldName: 'timestamp', fields, fieldFormatMap: {} };
const dates: IndexPattern = {
  ...nanos,
  fields: fields.map((each) => (each.name === 'timestamp' ? { ...each, esTypes: ['date'] } : each)),
};
const options = { unmapped_type: 'boolean' };

describe('the sort of a pattern whose time field holds nanoseconds', () => {
  it('is told by the time field: date_nanos among its OpenSearch types', () => {
    assert.equal(isTimeNanosBased(nanos), true);
    assert.equal(isTimeNanosBased(dates), false);
    assert.equal(isTimeNanosBased({ ...nanos, timeFieldName: undefined }), false);
  });

  it('sorts the time field with numeric_type date_nanos, before the options, as the reference sends it', () => {
    const sort = discoverSort(nanos, [], options, 'desc');
    assert.equal(JSON.stringify(sort), '[{"timestamp":{"order":"desc","numeric_type":"date_nanos","unmapped_type":"boolean"}}]');
    assert.equal(
      JSON.stringify(discoverSort(nanos, [['timestamp', 'asc'], ['bytes', 'desc']], options, 'desc')),
      '[{"timestamp":{"order":"asc","numeric_type":"date_nanos","unmapped_type":"boolean"}},{"bytes":{"order":"desc","unmapped_type":"boolean"}}]'
    );
    // The score and other fields are sorted as they were
    assert.deepEqual(discoverSort(nanos, [['_score', 'asc']], options, 'desc'), [{ _score: { order: 'asc' } }]);
  });

  it('leaves a pattern of dates as it was, and VisBuilder sorts without it, as the original', () => {
    assert.deepEqual(discoverSort(dates, [], options, 'desc'), [{ timestamp: { order: 'desc', unmapped_type: 'boolean' } }]);
    assert.deepEqual(sortClause(nanos, [['timestamp', 'desc']], options, 'desc'), [{ timestamp: { order: 'desc', unmapped_type: 'boolean' } }]);
  });

  it('is what Discover asks of OpenSearch', () => {
    createServices({ basePath: '', version: '3.9.0', name: 'test', settings: {}, settingsDefaults: {}, settingsOverrides: {} } as unknown as BootData);
    const body = buildDiscoverRequest({ indexPattern: nanos, query: { query: '', language: 'kuery' }, filters: [], sort: [], size: 5, documentsOnly: true });
    const [first] = body.sort as Array<Record<string, Record<string, unknown>>>;
    assert.equal(first.timestamp.numeric_type, 'date_nanos');
  });
});

describe('the sort on a scripted field', () => {
  it('sorts a number as a number, a string and a boolean as a string, as the reference sends them', () => {
    assert.deepEqual(sortClause(nanos, [['zz_snum', 'asc']], options, 'desc'), [
      { _script: { script: { source: "doc['bytes'].value", lang: 'painless' }, type: 'number', order: 'asc' } },
    ]);
    assert.deepEqual(sortClause(nanos, [['zz_sstr', 'asc']], options, 'desc'), [
      { _script: { script: { source: "doc['extension.keyword'].value", lang: 'painless' }, type: 'string', order: 'asc' } },
    ]);
    assert.deepEqual(sortClause(nanos, [['zz_sbool', 'desc']], options, 'desc'), [
      { _script: { script: { source: "doc['bytes'].value > 5000", lang: 'painless' }, type: 'string', order: 'desc' } },
    ]);
  });

  it('refuses any other type before the search is sent, with the original message', () => {
    assert.equal(scriptSortType('number'), 'number');
    assert.equal(scriptSortType('boolean'), 'string');
    assert.throws(() => scriptSortType('ip'), { message: 'Unsupported script sort type: ip' });
    // It was sent as a string sort, which OpenSearch failed with a Painless error
    assert.throws(() => sortClause(nanos, [['zz_sdate', 'desc']], options, 'desc'), { message: 'Unsupported script sort type: date' });
    assert.throws(() => sortClause(nanos, [['timestamp', 'desc'], ['zz_sdate', 'asc']], options, 'desc'), {
      message: 'Unsupported script sort type: date',
    });
  });
});

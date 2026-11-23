/* SPDX-License-Identifier: Apache-2.0 */

/*
 * A saved search's searchSourceJSON with what the page does not write itself: a filter that is null,
 * and a query saved before queries had a language (a bare text). Measured on the reference with
 * such saved searches: the query opens as Lucene ("response:404", 148 hits on the sample logs).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { migrateLegacyQuery, parseSearchSource } from '../../web/lib/search_source';

const INDEX_REF = 'kibanaSavedObjectMeta.searchSourceJSON.index';
const FILTER_REF = 'kibanaSavedObjectMeta.searchSourceJSON.filter[1].meta.index';
const filter = {
  meta: { indexRefName: FILTER_REF, negate: false, disabled: false, alias: null },
  query: { match_phrase: { extension: 'css' } },
};
const references = [
  { name: INDEX_REF, type: 'index-pattern', id: 'logs' },
  { name: FILTER_REF, type: 'index-pattern', id: 'logs' },
];

describe("a saved search's source", () => {
  it('leaves out a filter that is null, or no object, where the page could not be drawn', () => {
    const json = JSON.stringify({ indexRefName: INDEX_REF, query: { query: '', language: 'kuery' }, filter: [null, filter, 'x', 3] });
    const source = parseSearchSource(json, references);
    assert.equal(source.indexId, 'logs');
    assert.equal(source.filters.length, 1);
    assert.equal(source.filters[0].meta.index, 'logs');
    assert.deepEqual(source.filters[0].query, filter.query);
  });

  it("reads a query saved without a language as Lucene, as the original's migrateLegacyQuery", () => {
    assert.deepEqual(migrateLegacyQuery('response:404'), { query: 'response:404', language: 'lucene' });
    assert.deepEqual(migrateLegacyQuery({ query_string: { query: 'a' } }), { query: { query_string: { query: 'a' } }, language: 'lucene' });
    assert.deepEqual(migrateLegacyQuery({ query: 'a', language: 'kuery' }), { query: 'a', language: 'kuery' });
    const source = parseSearchSource(JSON.stringify({ query: 'response:404', filter: [] }));
    assert.deepEqual(source.query, { query: 'response:404', language: 'lucene' });
    assert.equal(parseSearchSource(JSON.stringify({ filter: [] })).query, undefined);
  });
});

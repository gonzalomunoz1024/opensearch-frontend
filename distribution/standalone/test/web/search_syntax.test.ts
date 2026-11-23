/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The tables that are searched in the browser against the search of OpenSearch Dashboards 3.9.0
 * itself: fixtures/table_search_cases.json holds, for texts written by hand, the rows its
 * library's `Query.parse` and `Query.execute` keep (OUI 1.24.2, run in the fork's build), or
 * `null` where `Query.parse` throws, on which its tables keep every row. The rows have the shapes
 * of the index pattern table, of the repositories and snapshots of Index Management and of the
 * results of Query Workbench.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { searchClauses } from '../../web/apps/index_management/model';
import { searchRows } from '../../web/apps/query_workbench/model';
import { readSearch, searchItems } from '../../web/lib/search_syntax';

interface Row {
  key: string;
  [field: string]: unknown;
}

const fixture = JSON.parse(readFileSync('test/web/fixtures/table_search_cases.json', 'utf8')) as {
  items: Row[];
  cases: Array<[string, string | null]>;
};
const every = fixture.items.map((item) => item.key).join(' ');
const kept = (text: string) =>
  searchItems(fixture.items, text)
    .map((item) => item.key)
    .join(' ');

describe('the search of a table that holds its rows', () => {
  it('keeps the rows the original keeps', () => {
    const wrong: string[] = [];
    for (const [text, want] of fixture.cases) {
      const got = kept(text);
      if (got !== (want ?? every)) wrong.push(`${JSON.stringify(text)}: kept "${got}", the original "${want ?? every}"`);
    }
    assert.deepEqual(wrong, []);
    assert.ok(fixture.cases.length > 400);
  });

  it('keeps every row when the text is not a search', () => {
    for (const text of ['foo or bar', 'a,b', "a'b", '(a b)', '"open', '(a OR', 'title:Flights\\*', 'k1 or k2']) {
      assert.equal(readSearch(text), undefined, text);
      assert.equal(kept(text), every, text);
    }
    // the same rows, not a copy: nothing was filtered
    assert.equal(searchItems(fixture.items, 'foo or bar'), fixture.items);
    assert.equal(searchItems(fixture.items, '  '), fixture.items);
  });

  it('reads what the lenient reading refused', () => {
    assert.equal(kept('title:'), '');
    assert.equal(kept('is:'), '');
    assert.equal(kept('(k1 or k2)'), 'k1 k2');
  });

  it('takes the column of that very name before the path into the row', () => {
    assert.equal(kept('machine.os:osx'), 'k7');
    assert.equal(kept('machine.os:ios'), '');
    assert.equal(kept('machine.ram:8'), 'k7');
    assert.equal(kept('a.b.c:deep'), 'k8');
    assert.equal(kept('tags.length:2'), 'k7');
  });

  it('reads yes and on as true, an empty list as an empty text, and the last is: of a flag', () => {
    assert.equal(kept('default:yes'), 'k0');
    assert.equal(kept('default:on'), 'k0');
    assert.equal(kept('tags:""'), 'k1 k7 k8 k9');
    assert.equal(kept('is:flag -is:flag'), kept('-is:flag'));
    assert.equal(kept('-is:flag is:flag'), 'k7');
  });

  it('cannot read a field named as something every object has, as the original', () => {
    assert.equal(kept('constructor:x'), every);
    assert.equal(kept('toString:x'), every);
    assert.equal(kept('is:constructor'), every);
    assert.equal(kept('-is:constructor'), '');
  });
});

describe('the results of Query Workbench', () => {
  const rows = fixture.items.map((data, rowId) => ({ rowId, data }));
  const ids = (text: string) => searchRows(rows, text).map((row) => row.rowId);

  it('searches what the rows hold and keeps the rows', () => {
    assert.deepEqual(ids('machine.os:(osx or "win 8")'), [7, 8]);
    assert.deepEqual(ids('-is:flag bytes>200'), [8, 9]);
    assert.equal(searchRows(rows, 'osx')[0], rows[7]);
  });

  it('keeps every row when the text is not a search', () => {
    assert.equal(searchRows(rows, 'osx or ios'), rows);
    assert.equal(searchRows(rows, '"open'), rows);
    assert.equal(searchRows(rows, ''), rows);
  });
});

describe('what the lists of Index Management ask their server for', () => {
  it('takes the words and the fields as the plugin takes them from its query', () => {
    // getTermClauses: the words outside brackets, with or without a minus
    assert.deepEqual(searchClauses('logs -old (a or b) "two words"'), {
      terms: ['logs', 'old', 'two words'],
      indices: [],
      dataStreams: [],
    });
    // getFieldClauses: whatever the sign and the operator; a number and a yes-no word as read
    assert.deepEqual(searchClauses('indices:(a or b) -indices:c indices=d indices>007 data_streams:yes data_streams:1.50'), {
      terms: [],
      indices: ['a', 'b', 'c', 'd', '7'],
      dataStreams: ['true', '1.5'],
    });
    assert.deepEqual(searchClauses('a\\:b indices:x\\-y'), { terms: ['a:b'], indices: ['x-y'], dataStreams: [] });
    // a date between single quotes goes into the address as nothing
    assert.deepEqual(searchClauses("indices:'2026' indices:5 data_streams:false"), {
      terms: [],
      indices: ['', '5'],
      dataStreams: ['false'],
    });
    assert.deepEqual(searchClauses('indices:'), { terms: ['indices:'], indices: [], dataStreams: [] });
  });

  it('asks for nothing in particular with a text the plugin cannot read', () => {
    const nothing = { terms: [], indices: [], dataStreams: [] };
    assert.deepEqual(searchClauses('logs or metrics'), nothing);
    assert.deepEqual(searchClauses('logs, metrics'), nothing);
    assert.deepEqual(searchClauses('constructor:x'), nothing);
    assert.deepEqual(searchClauses('  '), nothing);
  });
});

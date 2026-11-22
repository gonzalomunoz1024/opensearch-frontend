/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  cellText,
  firstTab,
  getQueries,
  indexNames,
  messageText,
  nestedNames,
  nestedTable,
  parseSearch,
  queryIndex,
  readAnswer,
  reasonOf,
  searchRows,
  suggestSql,
  tabName,
  tableOf,
  tokenizeSql,
  type Row,
} from '../../web/apps/query_workbench/model';

const answer = (value: unknown) => readAnswer({ data: { ok: true, resp: JSON.stringify(value) } });

describe('the queries of an editor', () => {
  it('splits at semicolons and puts each on one line', () => {
    assert.deepEqual(getQueries('select a\nfrom x;\n\n select b from y ; ;'), ['select a from x', 'select b from y']);
    assert.deepEqual(getQueries(''), []);
    assert.deepEqual(getQueries(' ;\n'), []);
  });

  it('names a tab after the index of the query', () => {
    assert.equal(queryIndex('select count(*) from Logs where a = 1'), 'logs');
    assert.equal(queryIndex('SELECT a FROM  logs'), 'logs');
    assert.equal(queryIndex("SHOW tables LIKE '%'"), "SHOW tables LIKE '%'");
    assert.equal(tabName('SQL', 'select a from logs'), 'logs');
    assert.equal(tabName('PPL', 'source = logs'), 'Events');
  });
});

describe('an answer as a table', () => {
  it('keeps the names only of SHOW tables', () => {
    const result = tableOf(
      answer({
        schema: [{ name: 'TABLE_CAT' }, { name: 'TABLE_SCHEM' }, { name: 'TABLE_NAME' }, { name: 'TABLE_TYPE' }],
        datarows: [
          ['lite', null, 'logs', 'BASE TABLE'],
          ['lite', null, 'flights', 'BASE TABLE'],
        ],
      })
    );
    if (!result.fulfilled) throw new Error('expected a table');
    assert.deepEqual(result.table.fields, ['TABLE_NAME']);
    assert.deepEqual(result.table.records, [
      { rowId: 0, data: { TABLE_NAME: 'logs' } },
      { rowId: 1, data: { TABLE_NAME: 'flights' } },
    ]);
    assert.equal(result.message, 'Success');
  });

  it('keeps every column of DESCRIBE and of a select, by alias when there is one', () => {
    const described = tableOf(
      answer({
        schema: [{ name: 'TABLE_NAME' }, { name: 'COLUMN_NAME' }, { name: 'DATA_TYPE' }],
        datarows: [['logs', 'bytes', 'long']],
      })
    );
    if (!described.fulfilled) throw new Error('expected a table');
    assert.deepEqual(described.table.fields, ['TABLE_NAME', 'COLUMN_NAME', 'DATA_TYPE']);

    const selected = tableOf(
      answer({
        schema: [
          { name: 'bytes', alias: 'size', type: 'long' },
          { name: 'geo', type: 'object' },
        ],
        datarows: [
          [19986, { src: 'IR' }],
          [null, null],
        ],
      })
    );
    if (!selected.fulfilled) throw new Error('expected a table');
    assert.deepEqual(selected.table.fields, ['size', 'geo']);
    assert.deepEqual(selected.table.records[0].data, { size: 19986, geo: { src: 'IR' } });
    assert.deepEqual(selected.table.records[1].data, { size: '-', geo: '-' });
  });

  it('says why a query did not run', () => {
    const failed = tableOf(readAnswer(undefined, 'no such index [nowhere]'));
    assert.equal(failed.fulfilled, false);
    assert.equal(failed.message, 'no response, this query is not runnable. \n \nno such index [nowhere]');

    const ppl = tableOf(
      readAnswer({
        data: { ok: false, resp: 'Not Found', body: '{"error":{"reason":"no such index [x]","details":"no such index [x]"}}', statusCode: 404 },
      })
    );
    assert.equal(ppl.message, 'Not Found, this query is not runnable. \n \nno such index [x]');
  });

  it('reads the sentence of an error', () => {
    assert.equal(reasonOf('{"error":{"reason":"Invalid SQL query","details":"Query must start with SELECT"}}'), 'Invalid SQL query: Query must start with SELECT');
    assert.equal(reasonOf('{"error":"plain"}'), 'plain');
    assert.equal(reasonOf('not json'), 'not json');
    assert.equal(reasonOf(undefined), '');
  });

  it('has no rows for an answer that is not a table', () => {
    const result = tableOf(readAnswer({ data: { ok: true, resp: 'text' } }));
    if (!result.fulfilled) throw new Error('expected a table');
    assert.deepEqual(result.table, { fields: [], records: [] });
  });

  it('lists the indices from the third column', () => {
    assert.deepEqual(indexNames(answer({ schema: [], datarows: [['lite', null, 'logs'], ['lite', null, '.kibana']] })), ['logs', '.kibana']);
    assert.deepEqual(indexNames(readAnswer(undefined)), []);
  });

  it('writes the output tab and opens the first table', () => {
    assert.equal(
      messageText(['Success', 'no response, this query is not runnable. \n \n'], ['logs', 'nowhere']),
      'Logs: Success\n\nNowhere: no response, this query is not runnable. \n \n\n\n'
    );
    assert.equal(messageText([], ['logs']), '');
    assert.equal(messageText(['Success'], []), '');
    const ok = tableOf(answer({ schema: [{ name: 'a' }], datarows: [[1]] }));
    const failed = tableOf(readAnswer(undefined));
    assert.deepEqual(firstTab([ok, failed], ['select a from Logs', 'x']), { id: '0', name: 'logs' });
    assert.deepEqual(firstTab([failed, ok], ['x', 'select a from logs']), { id: 'Output', name: 'Output' });
    assert.deepEqual(firstTab([], []), { id: 'Output', name: 'Output' });
  });
});

describe('cells and rows that open', () => {
  it('writes plain values and links for what holds more', () => {
    assert.deepEqual(cellText(19986, 'bytes'), { text: '19986' });
    assert.deepEqual(cellText(false, 'ok'), { text: 'false' });
    assert.deepEqual(cellText(null, 'gone'), { text: '' });
    assert.deepEqual(cellText({ src: 'IR' }, 'geo'), { text: '', link: 'geo: {1}' });
    assert.deepEqual(cellText(['success', 'info'], 'tags'), { text: '', link: 'tags: [2]' });
    assert.deepEqual(cellText([{ a: 1 }, { a: 2 }, { a: 3 }], 'items'), { text: '', link: 'items: {3}' });
  });

  it('opens a row at the names that hold an object or a list', () => {
    assert.deepEqual(nestedNames({ ip: '1.2.3.4', geo: { src: 'IR' }, tags: ['a'], gone: null }), ['geo', 'tags']);
    assert.deepEqual(nestedNames('text'), []);
    assert.deepEqual(nestedTable({ src: 'IR', dest: 'MM' }), { columns: ['src', 'dest'], rows: [{ src: 'IR', dest: 'MM' }] });
    assert.deepEqual(nestedTable(['a', 'b']), { columns: [], rows: ['a', 'b'] });
    assert.deepEqual(nestedTable([{ a: 1 }, { a: 2 }]), { columns: ['a'], rows: [{ a: 1 }, { a: 2 }] });
  });
});

describe('the search box', () => {
  const rows: Row[] = [
    { rowId: 0, data: { ip: '233.204.30.48', bytes: 19986, os: 'osx', tags: ['success', 'info'], geo: { src: 'IR' } } },
    { rowId: 1, data: { ip: '129.237.102.30', bytes: 19956, os: 'ios', tags: ['error'], geo: { src: 'IN' } } },
    { rowId: 2, data: { ip: '127.155.255.9', bytes: 120, os: 'win 8', tags: [], geo: { src: 'CN' } } },
  ];
  const ids = (text: string) => searchRows(rows, text).map((row) => row.rowId);

  it('looks for words in the columns that hold text, whatever the case', () => {
    assert.deepEqual(ids('OS'), [0, 1]);
    assert.deepEqual(ids('233.204'), [0]);
    // numbers and what is inside an object are not text
    assert.deepEqual(ids('19986'), []);
    assert.deepEqual(ids('IR'), []);
    assert.deepEqual(ids(''), [0, 1, 2]);
  });

  it('needs every word, and none of those taken away', () => {
    assert.deepEqual(ids('os 129'), [1]);
    assert.deepEqual(ids('-os'), [2]);
    assert.deepEqual(ids('"win 8"'), [2]);
    assert.deepEqual(ids('win xp'), []);
  });

  it('compares a column', () => {
    assert.deepEqual(ids('bytes:19986'), [0]);
    assert.deepEqual(ids('bytes>=19956'), [0, 1]);
    assert.deepEqual(ids('bytes<19956'), [2]);
    assert.deepEqual(ids('os:OS'), [0, 1]);
    assert.deepEqual(ids('os=os'), []);
    assert.deepEqual(ids('os=IOS'), [1]);
    assert.deepEqual(ids('-os:ios'), [0, 2]);
    assert.deepEqual(ids('tags:info'), [0]);
    assert.deepEqual(ids('os:(osx or "win 8")'), [0, 2]);
    assert.deepEqual(ids('nothing:here'), []);
  });

  it('takes either side of OR in brackets', () => {
    assert.deepEqual(ids('(osx OR bytes<200)'), [0, 2]);
    assert.deepEqual(ids('-(osx OR ios)'), [2]);
    assert.deepEqual(ids('is:bytes'), [0, 1, 2]);
    assert.deepEqual(ids('-is:missing'), [0, 1, 2]);
  });

  it('filters nothing with a text that is not a search', () => {
    assert.equal(parseSearch('"open'), undefined);
    assert.equal(parseSearch('(a OR'), undefined);
    assert.deepEqual(ids('"open'), [0, 1, 2]);
    assert.deepEqual(parseSearch('  a  -b '), [
      { type: 'term', match: 'must', value: 'a' },
      { type: 'term', match: 'must_not', value: 'b' },
    ]);
  });
});

describe('the SQL editor', () => {
  const kinds = (text: string) => tokenizeSql(text).map((line) => line.map((token) => `${token.kind ?? '-'}:${token.text}`));

  it('colours the words of SQL, text, numbers and comments', () => {
    assert.deepEqual(kinds("SELECT count(a) FROM logs WHERE b > 9000 -- all"), [
      ['Keyword:SELECT', '-: ', 'Key:count', '-:(a) ', 'Keyword:FROM', '-: logs ', 'Keyword:WHERE', '-: b > ', 'Number:9000', '-: ', 'Comment:-- all'],
    ]);
    assert.deepEqual(kinds("SHOW tables LIKE '%';"), [['-:SHOW tables LIKE ', "String:'%'", '-:;']]);
    assert.deepEqual(kinds('select `a b`, x1 from t'), [['Keyword:select', '-: ', 'String:`a b`', '-:, x1 ', 'Keyword:from', '-: t']]);
  });

  it('carries a block comment over lines', () => {
    assert.deepEqual(kinds('a /* one\ntwo */ from /* x */ b'), [
      ['-:a ', 'Comment:/* one'],
      ['Comment:two */', '-: ', 'Keyword:from', '-: ', 'Comment:/* x */', '-: b'],
    ]);
    assert.deepEqual(kinds(''), [['-:']]);
  });

  it('finishes a word with what the editor holds, then with SQL', () => {
    const text = 'select clientip, cl';
    const found = suggestSql(text, text.length);
    assert.deepEqual(found, { from: 17, to: 19, items: [{ label: 'clientip', meta: 'local' }] });
    assert.deepEqual(suggestSql('se', 2)?.items, [
      { label: 'select', meta: 'keyword' },
      { label: 'set', meta: 'type' },
    ]);
    assert.deepEqual(suggestSql('SEL', 3)?.items, [{ label: 'SELECT', meta: 'keyword' }]);
    assert.deepEqual(
      suggestSql('co', 2)?.items.map((item) => `${item.label}/${item.meta}`),
      ['coalesce/function', 'count/function']
    );
    assert.equal(suggestSql('select ', 7), undefined);
    assert.equal(suggestSql('select', 6), undefined);
    assert.equal(suggestSql('12', 2), undefined);
  });
});

/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  filterQuery,
  orFieldState,
  parseSearchQuery,
  printSearchQuery,
  QueryParseError,
  readSearchQuery,
  runSearchQuery,
  toggleOrFieldValue,
} from '../../web/apps/management/saved_objects_query';

const ALLOWED = ['config', 'url', 'index-pattern', 'query', 'dashboard', 'visualization', 'visualization-visbuilder', 'search'];

const refusal = (text: string) => {
  try {
    parseSearchQuery(text);
  } catch (error) {
    if (!(error instanceof QueryParseError)) throw error;
    return error.message;
  }
  return 'read';
};

const read = (text: string) => {
  const { queryText, visibleTypes } = readSearchQuery(parseSearchQuery(text));
  return { search: queryText ? `${queryText}*` : undefined, types: filterQuery(ALLOWED, visibleTypes) };
};

describe('the search syntax of the saved objects page', () => {
  it('refuses what the grammar cannot read, in its words', () => {
    // As the fork's build answered each of these
    assert.equal(refusal('foo!'), 'Expected end of input or whitespace but "!" found.');
    assert.equal(refusal('"unterminated'), 'Expected "(", "-", "is:", end of input, field, term, or whitespace but "\\"" found.');
    assert.equal(refusal('(foo'), 'Expected ")", [oO], or whitespace but end of input found.');
    assert.equal(refusal('foo)'), 'Expected end of input or whitespace but ")" found.');
    assert.equal(refusal('x:(a or'), 'Expected end of input or whitespace but "(" found.');
    assert.equal(refusal('£'), 'Expected "(", "-", "is:", end of input, field, term, or whitespace but "£" found.');
    assert.equal(refusal('foo\\!'), 'Expected end of input or whitespace but "\\\\" found.');
    assert.equal(
      refusal('or'),
      'To use OR in a text search, put it inside quotes: "or". To perform a logical OR, enclose the words in parenthesis: (foo:bar or bar).'
    );
    assert.equal(refusal('x:1.2.3'), 'Invalid number `1.2.3` set for field `x`');
  });

  it('searches the words, with a * after them, and the types asked', () => {
    assert.deepEqual(read('foo bar'), { search: 'foo bar*', types: ALLOWED });
    assert.deepEqual(read('  spaced   out  '), { search: 'spaced out*', types: ALLOWED });
    assert.deepEqual(read('-foo'), { search: 'foo*', types: ALLOWED });
    assert.deepEqual(read('"foo bar" baz'), { search: 'foo bar baz*', types: ALLOWED });
    assert.deepEqual(read("'quoted' 12 true"), { search: 'quoted 12 true*', types: ALLOWED });
    assert.deepEqual(read('a\\-b web-logs-2024'), { search: 'a-b web-logs-2024*', types: ALLOWED });
    assert.deepEqual(read('type:'), { search: 'type:*', types: ALLOWED });
    assert.deepEqual(read('""'), { search: undefined, types: ALLOWED });
    assert.deepEqual(read('(foo or bar) baz is:open a:b:c'), { search: 'baz*', types: ALLOWED });
    assert.deepEqual(read('type:(config or url)'), { search: undefined, types: ['config', 'url'] });
    assert.deepEqual(read('type:(config) type:(url)'), { search: undefined, types: ['config'] });
    assert.deepEqual(read('-type:(url)'), { search: undefined, types: ['url'] });
    // A type written by hand is matched as a part of the text, as the original's includes does
    assert.deepEqual(read('type:visualization-visbuilder'), { search: undefined, types: ['visualization', 'visualization-visbuilder'] });
    assert.throws(() => read('type:5'), TypeError);
  });

  it('adds and removes a filter value as the filter popover does, and prints the query', () => {
    let clauses = parseSearchQuery('web-logs-2024');
    clauses = toggleOrFieldValue(clauses, 'type', 'config');
    assert.equal(printSearchQuery(clauses), 'web\\-logs\\-2024 type:(config)');
    assert.equal(orFieldState(clauses, 'type', 'config'), 'on');
    clauses = toggleOrFieldValue(clauses, 'type', 'visualization-visbuilder');
    assert.equal(printSearchQuery(clauses), 'web\\-logs\\-2024 type:(config or visualization-visbuilder)');
    clauses = toggleOrFieldValue(toggleOrFieldValue(clauses, 'type', 'config'), 'type', 'visualization-visbuilder');
    assert.equal(printSearchQuery(clauses), 'web\\-logs\\-2024');
    assert.equal(orFieldState(clauses, 'type', 'config'), undefined);
    assert.equal(orFieldState(parseSearchQuery('-type:(url)'), 'type', 'url'), 'off');
    assert.equal(printSearchQuery(parseSearchQuery('"two words" -x:(a or "b c") is:y or\\:x')), '"two words" -x:(a or "b c") is:y or\\:x');
    // A group drops what comes before it, as the library prints it
    assert.equal(printSearchQuery(parseSearchQuery('foo (bar or baz)')), '(foo bar OR foo baz)');
  });

  it('runs a query on a list as the in-memory table does', () => {
    const items = [
      { id: 'a', type: 'visualization', relationship: 'child', meta: { title: 'Bytes' } },
      { id: 'b', type: 'visualization-visbuilder', relationship: 'parent', meta: { title: 'Hosts' } },
      { id: 'c', type: 'index-pattern', relationship: 'child', meta: { title: 'logs' } },
    ];
    const ids = (text: string) => runSearchQuery(parseSearchQuery(text), items).map((item) => item.id);
    assert.deepEqual(ids('relationship:(parent)'), ['b']);
    assert.deepEqual(ids('type:(visualization)'), ['a', 'b']);
    assert.deepEqual(ids('type:(index-pattern or visualization-visbuilder) relationship:(child)'), ['c']);
    // Words are looked for in the text fields of a row, not in its title
    assert.deepEqual(ids('INDEX'), ['c']);
    assert.deepEqual(ids('bytes'), []);
    assert.deepEqual(ids('-child'), ['b']);
  });
});

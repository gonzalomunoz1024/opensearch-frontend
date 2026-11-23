/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  addToLog,
  barSuggestions,
  fromUser,
  matchPairs,
  matchingSearches,
  normalizeQueryText,
  queryAppName,
  stepIndex,
  toUser,
} from '../../web/lib/query_input';

describe('the text of the query bar', () => {
  it('reads blanks as no query, JSON as an object and anything else as the text', () => {
    assert.equal(fromUser(''), '');
    assert.equal(fromUser('   '), '');
    assert.equal(fromUser('status:200 '), 'status:200 ');
    assert.deepEqual(fromUser(' {"match_all":{}} '), { match_all: {} });
    // Not JSON yet: the text as it is
    assert.equal(fromUser('{"match_all"'), '{"match_all"');
    // What lodash calls empty is the empty query, as in the original
    assert.equal(fromUser({}), '');
    assert.equal(fromUser(5), '');
    assert.deepEqual(fromUser({ term: { a: 1 } }), { term: { a: 1 } });
  });

  it('shows a query_string by its text and any other object as JSON', () => {
    assert.equal(toUser(undefined), '');
    assert.equal(toUser(null), '');
    assert.equal(toUser(200), '200');
    assert.equal(toUser({ query_string: { query: 'a AND b' } }), 'a AND b');
    assert.equal(toUser({ match_all: {} }), '{"match_all":{}}');
  });

  it('keeps of what is typed what the original keeps: no blanks alone, JSON written tight', () => {
    assert.equal(normalizeQueryText(' '), '');
    assert.equal(normalizeQueryText('a '), 'a ');
    assert.equal(normalizeQueryText('{ "match_all" : { } }'), '{"match_all":{}}');
    assert.equal(normalizeQueryText('{ "match_all" : '), '{ "match_all" : ');
  });
});

describe('the pairs the query bar closes', () => {
  it('closes a bracket or a quote as it is opened and puts the cursor between the two', () => {
    assert.deepEqual(matchPairs('(', false, 'a and ', 6, 6), { value: 'a and ()', selectionStart: 7, selectionEnd: 7 });
    assert.deepEqual(matchPairs('"', false, 'name:', 5, 5), { value: 'name:""', selectionStart: 6, selectionEnd: 6 });
    assert.deepEqual(matchPairs('{', false, '', 0, 0), { value: '{}', selectionStart: 1, selectionEnd: 1 });
  });

  it('wraps a selection in the pair, quotes too', () => {
    assert.deepEqual(matchPairs('"', false, 'a b', 0, 3), { value: '"a b"', selectionStart: 1, selectionEnd: 4 });
  });

  it('leaves a quote alone next to a word, and anything after a backslash', () => {
    assert.equal(matchPairs('"', false, 'name', 4, 4), undefined);
    assert.equal(matchPairs("'", false, 'a b', 1, 1), undefined);
    assert.equal(matchPairs('(', false, 'a\\', 2, 2), undefined);
    assert.equal(matchPairs('a', false, '', 0, 0), undefined);
  });

  it('steps over the closer typed before the same one, and takes a pair away with Backspace', () => {
    assert.deepEqual(matchPairs(')', false, '(a)', 2, 2), { value: '(a)', selectionStart: 3, selectionEnd: 3 });
    assert.equal(matchPairs(')', false, '(a)', 1, 2), undefined);
    assert.deepEqual(matchPairs('Backspace', false, 'x()', 2, 2), { value: 'x', selectionStart: 1, selectionEnd: 1 });
    assert.equal(matchPairs('Backspace', true, 'x()', 2, 2), undefined);
    assert.equal(matchPairs('Backspace', false, 'x(a)', 2, 2), undefined);
  });
});

describe('the searches the query bar remembers', () => {
  it('names the page as the original does', () => {
    assert.equal(queryAppName('/app/data-explorer/discover'), 'discover');
    assert.equal(queryAppName('/app/dashboards'), 'dashboard');
    assert.equal(queryAppName('/app/visualize'), 'visualize');
    assert.equal(queryAppName('/app/management/opensearch-dashboards/indexPatterns'), 'management');
  });

  it('keeps the newest first, each once, no more than the limit', () => {
    let log: unknown[] = [];
    for (const query of ['a', 'b', 'a', 'c']) log = addToLog(log, query, 2);
    assert.deepEqual(log, ['c', 'a']);
    assert.deepEqual(addToLog(['x'], { match_all: {} }, 10), [{ match_all: {} }, 'x']);
    assert.deepEqual(addToLog(['x'], undefined, 10), ['x']);
  });

  it('offers those that contain what is typed, an object as its JSON, never an empty one', () => {
    const log = ['currency:EUR', '', 'customer_gender:FEMALE', { match_all: {} }];
    assert.deepEqual(matchingSearches(log, 'cu'), ['currency:EUR', 'customer_gender:FEMALE']);
    assert.deepEqual(matchingSearches(log, ''), ['currency:EUR', 'customer_gender:FEMALE', '{"match_all":{}}']);
  });

  it("offers nothing but the searches made before, each for the whole text, as the original's bar", () => {
    const log = ['machine.os:"win 8"', 'bytes > 100'];
    // A field's start, a field and its colon, a term and a space: no field, value or conjunction
    assert.deepEqual(barSuggestions(log, 'mach'), [{ type: 'recentSearch', text: 'machine.os:"win 8"', start: 0, end: 4 }]);
    assert.deepEqual(barSuggestions(log, 'machine.os:'), [
      { type: 'recentSearch', text: 'machine.os:"win 8"', start: 0, end: 11 },
    ]);
    assert.deepEqual(barSuggestions(log, 'bytes > 1 '), []);
    assert.deepEqual(barSuggestions([], ''), []);
  });

  it('moves through the list with the arrows, round from either end', () => {
    assert.equal(stepIndex(0, 3, 1), 1);
    assert.equal(stepIndex(2, 3, 1), 0);
    assert.equal(stepIndex(0, 3, -1), 2);
    assert.equal(stepIndex(0, 0, 1), 0);
  });
});

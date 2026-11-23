/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  filtersWithSavedQuery,
  parseSavedQuery,
  savedQueryAttributes,
  sortSavedQueries,
  stateFromSavedQuery,
  titleConflicts,
  type SavedQuery,
} from '../../web/lib/saved_query';
import type { Filter } from '../../web/lib/types';

function phrase(field: string, value: string, store?: 'appState' | 'globalState'): Filter {
  return {
    meta: { alias: null, disabled: false, index: 'logs', key: field, negate: false, params: { query: value }, type: 'phrase' },
    query: { match_phrase: { [field]: value } },
    ...(store ? { $state: { store } } : {}),
  };
}

const saved = (title: string): SavedQuery => ({ id: title, attributes: { title, description: '', query: { query: '', language: 'kuery' } } });

describe('saved queries', () => {
  it('reads a query kept as JSON text back as the object it was, and leaves plain text alone', () => {
    const lucene = parseSavedQuery({
      id: 'q1',
      attributes: { title: 'q1', description: 'd', query: { query: '{"match_all":{}}', language: 'lucene' } },
    });
    assert.deepEqual(lucene.attributes.query, { query: { match_all: {} }, language: 'lucene' });
    const text = parseSavedQuery({ id: 'q2', attributes: { title: 'q2', query: { query: 'status:200', language: 'kuery' } } });
    assert.deepEqual(text.attributes, { title: 'q2', description: '', query: { query: 'status:200', language: 'kuery' } });
    // A number or a null kept as text is not an object: the first stays text, the second is nothing
    assert.equal(parseSavedQuery({ id: 'q3', attributes: { query: { query: '200' } } }).attributes.query.query, '200');
    assert.equal(parseSavedQuery({ id: 'q4', attributes: { query: { query: null } } }).attributes.query.query, '');
  });

  it('lists the saved queries by title in the order of the characters, capitals first', () => {
    const titles = sortSavedQueries([saved('beta'), saved('Zeta'), saved('alpha'), saved('Alpha')]).map(
      (query) => query.attributes.title
    );
    assert.deepEqual(titles, ['Alpha', 'Zeta', 'alpha', 'beta']);
  });

  it('saves the query, and the filters and the time range only when asked', () => {
    const state = {
      query: { query: 'status:200', language: 'kuery' },
      filters: [phrase('host', 'a', 'globalState'), phrase('agent', 'b')],
      time: { from: 'now-7d', to: 'now' },
      refreshInterval: { pause: false, value: 5000 },
    };
    const meta = { title: 'q', description: 'd', shouldIncludeFilters: true, shouldIncludeTimeFilter: true };
    const attributes = savedQueryAttributes(meta, state);
    assert.deepEqual(attributes.filters?.map((filter) => filter.$state?.store), ['globalState', 'appState']);
    assert.deepEqual(attributes.timefilter, { from: 'now-7d', to: 'now', refreshInterval: { value: 5000, pause: false } });
    const bare = savedQueryAttributes({ ...meta, shouldIncludeFilters: false, shouldIncludeTimeFilter: false }, state);
    assert.deepEqual(bare, { title: 'q', description: 'd', query: { query: 'status:200', language: 'kuery' } });
  });

  it('keeps the pinned filters and adds the saved ones after them, each once', () => {
    const pinned = [phrase('host', 'a', 'globalState')];
    const filters = filtersWithSavedQuery(
      pinned,
      [phrase('agent', 'b', 'appState'), phrase('host', 'a', 'appState'), phrase('agent', 'b', 'appState')],
      false
    );
    assert.deepEqual(
      filters.map((filter) => [filter.meta.key, filter.$state?.store]),
      [
        ['host', 'globalState'],
        ['agent', 'appState'],
      ]
    );
    // A saved filter that says nowhere where it is kept goes where new filters go
    const loose = filtersWithSavedQuery([], [phrase('agent', 'b')], true);
    assert.equal(loose[0].$state?.store, 'globalState');
  });

  it('gives the page the time range of the saved query, an interval of nothing paused', () => {
    const state = stateFromSavedQuery(
      {
        title: 'q',
        description: '',
        query: { query: 'a', language: 'kuery' },
        timefilter: { from: 'now-1h', to: 'now', refreshInterval: { pause: false, value: 0 } },
      },
      { pinnedFilters: [], refreshInterval: { pause: false, value: 10000 }, pinnedByDefault: false }
    );
    assert.deepEqual(state.time, { from: 'now-1h', to: 'now' });
    assert.deepEqual(state.refreshInterval, { pause: true, value: 0 });
    const untimed = stateFromSavedQuery(saved('q').attributes, { pinnedFilters: [], pinnedByDefault: false });
    assert.equal(untimed.time, undefined);
    assert.deepEqual(untimed.filters, []);
  });

  it('refuses the title of another saved query only for a new one', () => {
    const existing = [saved('one'), saved('two')];
    assert.equal(titleConflicts('one', existing, false), true);
    assert.equal(titleConflicts('one', existing, true), false);
    assert.equal(titleConflicts('three', existing, false), false);
  });
});

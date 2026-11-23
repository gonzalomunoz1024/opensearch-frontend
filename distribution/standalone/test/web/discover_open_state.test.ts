/* SPDX-License-Identifier: Apache-2.0 */

/*
 * What Discover opens with, as the original's loadSavedSearch chooses it. The cases are those the
 * reference was seen to open with: an empty query in a fresh browser is DQL whatever language the
 * address gives it, and in the language chosen last once there is one.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { openingQueryState } from '../../web/apps/discover/open_state';
import type { Filter } from '../../web/lib/types';

const filter = (key: string): Filter => ({ meta: { key, negate: false, disabled: false }, query: { match_phrase: { [key]: 'x' } } });

describe('the query Discover opens with', () => {
  it('gives a query with no text the default language, whatever the address says', () => {
    const lucene = { query: { query: '', language: 'lucene' }, filters: [], hasQueryState: true };
    // A fresh browser: the setting's language
    assert.deepEqual(openingQueryState(lucene, undefined, 'kuery').query, { query: '', language: 'kuery' });
    // After Lucene was chosen
    assert.deepEqual(openingQueryState(lucene, undefined, 'lucene').query, { query: '', language: 'lucene' });
    const kuery = { query: { query: '', language: 'kuery' }, filters: [], hasQueryState: true };
    assert.deepEqual(openingQueryState(kuery, undefined, 'lucene').query, { query: '', language: 'lucene' });
  });

  it('keeps a query with text in its own language', () => {
    const address = { query: { query: 'response:404', language: 'lucene' }, filters: [], hasQueryState: true };
    assert.deepEqual(openingQueryState(address, undefined, 'kuery').query, { query: 'response:404', language: 'lucene' });
    const dsl = { query: { query: { match_all: {} }, language: 'lucene' }, hasQueryState: true };
    assert.deepEqual(openingQueryState(dsl, undefined, 'kuery').query, { query: { match_all: {} }, language: 'lucene' });
  });

  it('opens with the default query when the address has none, or one that is no query', () => {
    assert.deepEqual(openingQueryState({ hasQueryState: false }, undefined, 'kuery'), {
      query: { query: '', language: 'kuery' },
      filters: [],
    });
    assert.deepEqual(openingQueryState({ query: 'response:404', hasQueryState: true }, undefined, 'lucene').query, {
      query: '',
      language: 'lucene',
    });
    assert.deepEqual(openingQueryState({ query: { language: 'lucene' }, hasQueryState: true }, undefined, 'kuery').query, {
      query: '',
      language: 'kuery',
    });
  });

  it("takes a saved search's query and filters when the address has no query state", () => {
    const saved = { query: { query: 'response:404', language: 'kuery' }, filters: [filter('extension')] };
    assert.deepEqual(openingQueryState({ hasQueryState: false }, saved, 'lucene'), {
      query: { query: 'response:404', language: 'kuery' },
      filters: [filter('extension')],
    });
  });

  it("puts a saved search's query in place of an empty one, and keeps the address's filters", () => {
    const saved = { query: { query: 'response:404', language: 'kuery' }, filters: [filter('extension')] };
    const address = { query: { query: '', language: 'lucene' }, filters: [filter('machine.os')], hasQueryState: true };
    assert.deepEqual(openingQueryState(address, saved, 'lucene'), {
      query: { query: 'response:404', language: 'kuery' },
      filters: [filter('machine.os')],
    });
    // A query with text in the address is kept over the saved search's
    const typed = { ...address, query: { query: 'bytes > 0', language: 'kuery' } };
    assert.deepEqual(openingQueryState(typed, saved, 'lucene').query, { query: 'bytes > 0', language: 'kuery' });
    // The address's query state without filters has none
    assert.deepEqual(openingQueryState({ query: address.query, hasQueryState: true }, saved, 'kuery').filters, []);
  });

  it('opens a saved search without a query with the default one', () => {
    assert.deepEqual(openingQueryState({ hasQueryState: false }, { filters: [] }, 'lucene').query, { query: '', language: 'lucene' });
    assert.deepEqual(openingQueryState({ hasQueryState: false }, { query: null, filters: [] }, 'kuery').query, {
      query: '',
      language: 'kuery',
    });
  });
});

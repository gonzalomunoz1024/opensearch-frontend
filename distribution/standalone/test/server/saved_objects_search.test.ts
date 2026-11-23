/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { phrasePrefixClauses } from '../../server/saved_objects';

describe('saved object search', () => {
  it('looks for a phrase starting with the search in each field, as the original does', () => {
    assert.deepEqual(phrasePrefixClauses('zz-agent*', ['query.title^5', 'url.url', '*']), [
      { match_phrase_prefix: { 'query.title': { query: 'zz-agent', boost: 5 } } },
      { match_phrase_prefix: { 'url.url': { query: 'zz-agent', boost: 1 } } },
    ]);
  });

  it('takes a boost that is no number as no boost', () => {
    assert.deepEqual(phrasePrefixClauses('web*', ['dashboard.title^x']), [
      { match_phrase_prefix: { 'dashboard.title': { query: 'web', boost: 1 } } },
    ]);
  });
});

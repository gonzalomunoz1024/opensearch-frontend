/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { escapeSuggestionQuery, suggestedValues, valueSuggestionsBody } from '../../server/value_suggestions';

describe('the value suggestions of the filter editor', () => {
  it('asks for the terms that start with the text, in a second and 100000 documents a shard', () => {
    assert.deepEqual(valueSuggestionsBody('currency', 'E', []), {
      size: 0,
      timeout: '1000ms',
      terminate_after: 100000,
      query: { bool: { filter: [] } },
      aggs: {
        suggestions: { terms: { field: 'currency', include: 'E.*', execution_hint: 'map', shard_size: 10 } },
      },
    });
  });

  it('escapes what the text would mean in a regular expression', () => {
    assert.equal(escapeSuggestionQuery('a.b?(c)*'), 'a\\.b\\?\\(c\\)\\*');
    assert.equal(escapeSuggestionQuery('"x" #1 & <y> ~ z\\'), '\\"x\\" \\#1 \\& \\<y\\> \\~ z\\\\');
    const { aggs } = valueSuggestionsBody('host', 'a+b') as { aggs: { suggestions: { terms: { include: string } } } };
    assert.equal(aggs.suggestions.terms.include, 'a\\+b.*');
  });

  it('asks for a nested field under its path', () => {
    const body = valueSuggestionsBody({ name: 'products.sku', subType: { nested: { path: 'products' } } }, '', []);
    assert.deepEqual(body.aggs, {
      nestedSuggestions: {
        nested: { path: 'products' },
        aggs: { suggestions: { terms: { field: 'products.sku', include: '.*', execution_hint: 'map', shard_size: 10 } } },
      },
    });
  });

  it('answers the keys of the buckets, nested or not', () => {
    assert.deepEqual(suggestedValues({ aggregations: { suggestions: { buckets: [{ key: 'EUR' }, { key: 1 }] } } }), ['EUR', 1]);
    assert.deepEqual(suggestedValues({ aggregations: { nestedSuggestions: { suggestions: { buckets: [{ key: 'a' }] } } } }), ['a']);
    assert.deepEqual(suggestedValues({}), []);
  });
});

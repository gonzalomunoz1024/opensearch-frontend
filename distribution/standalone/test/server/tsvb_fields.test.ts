/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { FieldDescriptor } from '../../server/index_pattern_fields';
import { tsvbFields } from '../../server/tsvb_fields';

const field = (name: string, more: Partial<FieldDescriptor> = {}): FieldDescriptor => ({
  name,
  type: 'number',
  searchable: true,
  aggregatable: true,
  readFromDocValues: true,
  ...more,
});

describe('the fields TSVB lists', () => {
  it('keeps the fields it can aggregate on, without nested ones, each name once', () => {
    const fields = [
      field('bytes'),
      field('message', { type: 'string', aggregatable: false }),
      field('products.price', { subType: { nested: { path: 'products' } } }),
      field('agent.keyword', { type: 'string', subType: { multi: { parent: 'agent' } } }),
      field('bytes', { type: 'string' }),
    ];
    assert.deepEqual(
      tsvbFields(fields).map((item) => [item.name, item.type]),
      [
        ['bytes', 'number'],
        ['agent.keyword', 'string'],
      ]
    );
  });
});

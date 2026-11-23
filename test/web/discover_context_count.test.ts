/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The count fields of the surrounding-documents page. Measured on the reference: a 0 typed on either
 * side (with Enter, or leaving the field) shows the count again at once and loads nothing.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { typedCount } from '../../web/apps/discover/context';

describe("the context page's count of documents", () => {
  it("puts the count back when 0 is typed, as the original's action bar", () => {
    assert.equal(typedCount(0, 5), 5);
    assert.equal(typedCount(0, 12), 12);
  });

  it('keeps any other count typed, and nothing typed', () => {
    assert.equal(typedCount(3, 5), 3);
    assert.equal(typedCount(120, 5), 120);
    assert.equal(typedCount(undefined, 5), undefined);
    // A count that is 0 already stays 0
    assert.equal(typedCount(0, 0), 0);
  });
});

/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { placeLikeOriginal } from '../../web/components/placement';
import { compareAsOriginal, compareListed, pageSizeOptions } from '../../web/shell/listing_model';

describe('the list of saved objects', () => {
  it('orders titles by their code points, as the original does', () => {
    const titles = ['zz-agent-dash-logs', '[eCommerce] Revenue Dashboard', '[Logs] Web Traffic', '[Flights] Global Flight Dashboard'];
    assert.deepEqual([...titles].sort(compareAsOriginal), [
      '[Flights] Global Flight Dashboard',
      '[Logs] Web Traffic',
      '[eCommerce] Revenue Dashboard',
      'zz-agent-dash-logs',
    ]);
  });

  it('sorts an object without a value after the others, and before them once turned round', () => {
    // As the list sorts them: objects, by the value of a column (a visualization of no known type)
    const rows = ['Line', undefined, '', 'Area'].map((type) => ({ type }));
    const sorted = (direction: number) => [...rows].sort((a, b) => compareListed(a.type, b.type) * direction).map((row) => row.type);
    assert.deepEqual(sorted(1), ['', 'Area', 'Line', undefined]);
    assert.deepEqual(sorted(-1), [undefined, 'Line', 'Area', '']);
  });

  it('offers the page sizes of the original, ordered as text', () => {
    assert.deepEqual(pageSizeOptions(20), [10, 20, 50]);
    assert.deepEqual(pageSizeOptions(100), [10, 100, 20, 50]);
    assert.deepEqual(pageSizeOptions(5), [10, 20, 5, 50]);
  });
});

describe('a popover placed as the original places it', () => {
  const view = { width: 1400, height: 900 };
  const menu = { width: 256, height: 107 };

  it('opens under the button, kept clear of its corner by the arrow', () => {
    // The options of a panel on the left of a dashboard (the reference: 43, 178)
    const at = placeLikeOriginal({ left: 265, top: 146, width: 24, height: 24 }, { width: 256, height: 70 }, 'downRight', view);
    assert.deepEqual(at, { left: 43, top: 178 });
  });

  it('opens beside the button when the window has no room for it under or over it', () => {
    // A panel at the right edge: its menu opens to the left, centred on the button (1103, 104.5)
    const at = placeLikeOriginal({ left: 1367, top: 146, width: 24, height: 24 }, menu, 'downRight', view);
    assert.deepEqual(at, { left: 1103, top: 104.5 });
  });

  it('keeps 16px inside the window', () => {
    // The pencil of a row at the right of the list (the reference's menu is at 1272)
    const at = placeLikeOriginal({ left: 1331, top: 290.5, width: 16, height: 16 }, { width: 112, height: 37 }, 'downLeft', view);
    assert.equal(at.left, 1272);
    assert.equal(at.top, 314.5);
  });

  it('opens over a button low on the page', () => {
    // The page sizes of a list: over the button, its right edge on the button's
    const at = placeLikeOriginal({ left: 41, top: 620.5, width: 163.3, height: 24 }, { width: 112, height: 99 }, 'upRight', view);
    assert.equal(Math.round(at.left * 10) / 10, 92.3);
    assert.equal(at.top, 513.5);
  });

  it('centres a popover on its button when asked to', () => {
    // The dashboard's Options in edit mode (the reference's popover is at 794.5 under it)
    const at = placeLikeOriginal({ left: 890.5, top: 52, width: 70, height: 32 }, { width: 262, height: 136 }, 'downCenter', view);
    assert.deepEqual(at, { left: 794.5, top: 92 });
  });
});

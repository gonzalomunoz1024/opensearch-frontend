/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { arrowPopoverPlace } from '../../web/components/popover_place';

// The panel of TSVB's colour picker, and the box of the swatch it opens from (a pixel taller than
// the swatch, as the original's anchor is)
const PICKER = { width: 168, height: 344 };
const swatchAt = (left: number, top: number) => ({ left, top, width: 24, height: 25 });

describe('where a popover with an arrow hangs from its button, as the component library places it', () => {
  it('goes over a swatch low in the window, 8 px from it and 10 px to the left of it, as the product measured', () => {
    // The series' swatch of the TSVB editor at 1400 by 900
    assert.deepEqual(arrowPopoverPlace(swatchAt(61, 528.5), PICKER, { width: 1400, height: 900 }, 'bottom', 'left'), {
      side: 'top',
      top: 176.5,
      left: 51,
    });
  });

  it('goes under a swatch with room under it, 8 px from it', () => {
    assert.deepEqual(arrowPopoverPlace(swatchAt(61, 100), PICKER, { width: 1400, height: 900 }, 'bottom', 'left'), {
      side: 'bottom',
      top: 133,
      left: 51,
    });
  });

  it('moves along its button to stay 16 px inside the window', () => {
    assert.deepEqual(arrowPopoverPlace(swatchAt(1300, 100), PICKER, { width: 1400, height: 900 }, 'bottom', 'left'), {
      side: 'bottom',
      top: 133,
      left: 1216,
    });
  });

  it('goes beside its button when it shows whole there and not over or under it', () => {
    assert.deepEqual(arrowPopoverPlace(swatchAt(300, 180), PICKER, { width: 1024, height: 400 }, 'bottom', 'left'), {
      side: 'left',
      top: 20.5,
      left: 124,
    });
  });

  it('takes the side that shows the most of it when none shows all, its arrow by the middle of a wide button', () => {
    // Under the button shows 113 px of the 344, over it 98, and beside it nothing
    assert.deepEqual(arrowPopoverPlace({ left: 16, top: 130, width: 600, height: 25 }, PICKER, { width: 632, height: 300 }, 'bottom', 'left'), {
      side: 'bottom',
      top: 163,
      left: 170,
    });
  });
});

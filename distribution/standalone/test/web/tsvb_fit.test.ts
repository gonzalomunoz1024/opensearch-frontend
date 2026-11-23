/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isColorDark, isInverted, placeBox, placedStyle } from '../../web/vis/tsvb/fit';

const rounded = (placement: ReturnType<typeof placeBox>) =>
  placement && { ...placement, scale: Math.round(placement.scale * 100000) / 100000 };

describe('where TSVB lays the text and the ring of a metric or a gauge over its panel', () => {
  it('scales a box to the height of a wide panel and lays it in the middle, as the product measured', () => {
    const panel = { width: 1368, height: 268 };
    // A half gauge's text and ring, a circle's, and a metric's text, on a panel of 1368 by 268
    assert.deepEqual(rounded(placeBox(panel, { width: 100, height: 70 })), { scale: 3.82857, translateX: 141, translateY: 99, top: 0, left: 493 });
    assert.deepEqual(rounded(placeBox(panel, { width: 121, height: 82 })), { scale: 3.26829, translateX: 137, translateY: 93, top: 0, left: 486 });
    assert.deepEqual(rounded(placeBox(panel, { width: 100, height: 100 })), { scale: 2.68, translateX: 84, translateY: 84, top: 0, left: 550 });
    assert.deepEqual(rounded(placeBox(panel, { width: 121, height: 124 })), { scale: 2.16129, translateX: 70, translateY: 72, top: 0, left: 553 });
    assert.deepEqual(rounded(placeBox(panel, { width: 91, height: 35 })), { scale: 7.65714, translateX: 302.5, translateY: 116.5, top: 0, left: 336 });
  });

  it('scales a box to the width of a tall or narrow panel, and to the height when that is what fits', () => {
    assert.deepEqual(placeBox({ width: 200, height: 400 }, { width: 100, height: 70 }), { scale: 2, translateX: 50, translateY: 35, top: 130, left: 0 });
    // Wider than high, but too narrow for the box at the panel's height
    assert.deepEqual(placeBox({ width: 300, height: 280 }, { width: 100, height: 70 }), { scale: 3, translateX: 100, translateY: 70, top: 35, left: 0 });
    // Taller than wide, but too low for the box at the panel's width
    assert.deepEqual(placeBox({ width: 300, height: 310 }, { width: 50, height: 100 }), { scale: 3.1, translateX: 52.5, translateY: 105, top: 0, left: 72 });
  });

  it('places nothing before the panel and the box are measured, and writes a placement as a style', () => {
    assert.equal(placeBox({ width: 0, height: 0 }, { width: 100, height: 70 }), null);
    assert.equal(placeBox({ width: 300, height: 200 }, { width: 0, height: 0 }), null);
    assert.deepEqual(placedStyle({ scale: 2, translateX: 50, translateY: 35, top: 130, left: 0 }), {
      top: 130,
      left: 0,
      transform: 'matrix(2, 0, 0, 2, 50, 35)',
    });
  });
});

describe('when the text of a TSVB panel takes the colours of the other theme', () => {
  it('tells a dark colour by its relative luminance, as the product does', () => {
    assert.equal(isColorDark('#000000'), true);
    assert.equal(isColorDark('#ffffff'), false);
    // The default gauge's green and the first series colour read as dark, though they look light
    assert.equal(isColorDark('#8ac336'), true);
    assert.equal(isColorDark('#54B399'), true);
    assert.equal(isColorDark('rgba(255,235,59,1)'), false);
  });

  it('inverts the text over a panel colour of its own that is unlike the theme', () => {
    assert.equal(isInverted(undefined, false), false);
    assert.equal(isInverted('', true), false);
    assert.equal(isInverted('inherit', false), false);
    assert.equal(isInverted('#000000', false), true);
    assert.equal(isInverted('#000000', true), false);
    assert.equal(isInverted('#ffffff', true), true);
    assert.equal(isInverted('#ffffff', false), false);
  });
});

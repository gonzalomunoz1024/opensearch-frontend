/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  SERIES_COLORS,
  assignColors,
  classicDomain,
  classicTickCount,
  classicTicks,
  niceDomain,
  niceTicks,
  ordinalColors,
  setColorMapping,
} from '../../web/charts/core';

describe('the value axis of a classic chart', () => {
  it('has as many ticks as its length allows', () => {
    // 0 at 20 pixels, 3 at 40, 11 at 1000 and beyond, rounded up in between
    assert.equal(classicTickCount(20), 0);
    assert.equal(classicTickCount(30), 2);
    assert.equal(classicTickCount(40), 3);
    assert.equal(classicTickCount(400), 6);
    assert.equal(classicTickCount(520), 7);
    assert.equal(classicTickCount(1000), 11);
    assert.equal(classicTickCount(5000), 11);
  });

  it('steps by 1, 2 or 5 as the older rounding rule chooses', () => {
    assert.deepEqual(classicTicks(0, 1200, 6), [0, 200, 400, 600, 800, 1000, 1200]);
    assert.deepEqual(classicTicks(0, 100, 3), [0, 50, 100]);
    assert.deepEqual(classicTicks(0, 70, 10), [0, 10, 20, 30, 40, 50, 60, 70]);
    assert.deepEqual(classicTicks(0, 1, 4), [0, 0.2, 0.4, 0.6, 0.8, 1]);
    assert.deepEqual(classicTicks(5, 5, 4), [5]);
    assert.deepEqual(classicTicks(0, 10, 0), []);
  });

  it('is widened to the step ten ticks would have', () => {
    assert.deepEqual(classicDomain(0, 1187), [0, 1200]);
    assert.deepEqual(classicDomain(3, 97), [0, 100]);
    assert.deepEqual(classicDomain(-12, 37), [-15, 40]);
    assert.deepEqual(classicDomain(0, 0), [0, 1]);
  });
});

describe('round ticks', () => {
  it('fall on the round step nearest the one asked for', () => {
    assert.deepEqual(niceTicks(0, 100, 5), [0, 20, 40, 60, 80, 100]);
    assert.deepEqual(niceTicks(0, 7, 5), [0, 1, 2, 3, 4, 5, 6, 7]);
    assert.deepEqual(niceTicks(3, 3), [3]);
    assert.deepEqual(niceTicks(0, Infinity), []);
  });

  it('widen a range to its ticks', () => {
    assert.deepEqual(niceDomain(0, 93), [0, 100]);
    assert.deepEqual(niceDomain(0, 0), [0, 1]);
  });
});

describe('the colours of series', () => {
  it('are dealt from the start of the palette, in the order the labels come', () => {
    const colors = assignColors(['first a', 'first b', 'first c']);
    assert.deepEqual([...colors.values()], SERIES_COLORS.slice(0, 3));
  });

  it('stay with a label on every chart after the first', () => {
    assignColors(['kept a', 'kept b', 'kept c']);
    // The next chart shows one label the page knows and one it does not: the known one keeps
    // its third colour, the new one starts the palette again
    const next = assignColors(['kept c', 'kept new']);
    assert.equal(next.get('kept c'), SERIES_COLORS[2]);
    assert.equal(next.get('kept new'), SERIES_COLORS[0]);
    assert.equal(assignColors(['kept new']).get('kept new'), SERIES_COLORS[0]);
  });

  it('leave a colour of the setting to the label it is set for', () => {
    setColorMapping({ 'set Count': '#54B399' });
    try {
      const colors = assignColors(['set Count', 'set other']);
      assert.equal(colors.get('set Count'), '#54B399');
      assert.equal(colors.get('set other'), SERIES_COLORS[1]);
    } finally {
      setColorMapping({});
    }
  });

  it('give way to a colour picked in the visualization', () => {
    assert.equal(assignColors(['picked'], { picked: '#000000' }).get('picked'), '#000000');
  });

  it('go on in lighter turns of the palette past ten labels', () => {
    const labels = Array.from({ length: 12 }, (_, index) => `many ${index}`);
    const colors = [...assignColors(labels).values()];
    assert.deepEqual(
      colors.slice(0, 10).map((color) => color.toUpperCase()),
      SERIES_COLORS
    );
    assert.equal(new Set(colors).size, 12);
    assert.equal(colors[10], '#aad9cc');
  });

  it('are dealt round and round to the words of a tag cloud, with no memory', () => {
    const words = Array.from({ length: 11 }, (_, index) => `word ${index}`);
    const colors = ordinalColors([...words, 'word 0']);
    assert.equal(colors.size, 11);
    assert.equal(colors.get('word 1'), SERIES_COLORS[1]);
    assert.equal(colors.get('word 10'), SERIES_COLORS[0]);
    assert.equal(ordinalColors(['word 5']).get('word 5'), SERIES_COLORS[0]);
    assert.equal(ordinalColors(['word 5'], { 'word 5': '#123456' }).get('word 5'), '#123456');
  });
});

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
import {
  keptLabels,
  labelBand,
  placeLabel,
  sizeAlong,
  truncateLabel,
  valueAxisLabels,
  type FontMetrics,
} from '../../web/charts/axis_labels';

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

describe('the labels of an axis of a classic chart', () => {
  // 8pt in the face of the original, whose lines reach 0.9375em above the baseline and 0.28em below
  const font: FontMetrics = { size: 32 / 3, ascent: 10, descent: (32 / 3) * 0.28 };
  const near = (actual: number, expected: number) =>
    assert.ok(Math.abs(actual - expected) < 0.05, `${actual} is not ${expected}`);

  it('are cut to a number of characters, or kept whole', () => {
    assert.equal(truncateLabel('Kibana Airlines', 6), 'Kibana…');
    assert.equal(truncateLabel('Kibana Airlines', 0), 'Kibana Airlines');
    assert.equal(truncateLabel('Kibana', 6), 'Kibana');
    assert.equal(truncateLabel('Kibana', 100), 'Kibana');
  });

  it('turn about their end under the axis, as deep as the original draws them', () => {
    // "300" under a horizontal bar chart: the original measures its tick at -11.75 0 17.81 29.95
    // and gives the axis 35 pixels
    const label = placeLabel('bottom', 75, 20.03, font);
    assert.equal(label.anchor, 'end');
    assert.equal(label.angle, -75);
    assert.deepEqual([label.x, label.y, label.cx, label.cy], [0, 9, 0, 9]);
    near(label.dy, 3.2);
    near(label.box.left, -11.75);
    near(label.box.bottom, 29.95);
    assert.equal(label.box.top, 0);
    assert.equal(labelBand('bottom', [label.box]), 35);
  });

  it('turn the other way over the axis, and up the side of an upright chart', () => {
    const over = placeLabel('top', 75, 20.03, font);
    assert.equal(over.angle, 75);
    assert.equal(over.y, -9);
    assert.equal(over.box.bottom, 0);
    near(over.box.top, -30.11);
    assert.equal(labelBand('top', [over.box]), 36);

    const beside = placeLabel('left', 75, 26.5, font);
    assert.equal(beside.anchor, 'end');
    assert.equal(beside.dy, 0);
    assert.deepEqual([beside.cx, beside.cy], [-9, 0]);
    assert.equal(beside.box.right, 0);
    assert.equal(labelBand('left', [beside.box]), 31);

    // Upright beside the axis, a label turns about its middle
    const upright = placeLabel('left', 90, 26.5, font);
    assert.equal(upright.anchor, 'middle');
    near(upright.cx, -9);
    near(upright.cy, (font.descent - font.ascent) / 2);
  });

  it('lie flat as d3 places them when they are not turned', () => {
    const under = placeLabel('bottom', 0, 20, font);
    assert.equal(under.anchor, 'middle');
    assert.equal(under.angle, 0);
    assert.equal(sizeAlong('bottom', under.box), 20);
    const beside = placeLabel('left', 0, 20, font);
    assert.equal(beside.anchor, 'end');
    assert.deepEqual([beside.box.left, beside.box.right], [-29, 0]);
    near(sizeAlong('left', beside.box), font.ascent + font.descent);
  });

  it('are left out past either end of the axis and where they run into the last one kept', () => {
    // The value axis of the horizontal bar chart: 0 to 350, of which 0 and 350 go
    const ticks = [0, 50, 100, 150, 200, 250, 300, 350];
    const length = 760;
    const kept = keptLabels(
      ticks.map((tick) => ({
        center: (tick / 350) * length,
        size: sizeAlong('bottom', placeLabel('bottom', 75, String(tick).length * 6.2, font).box),
      })),
      length
    );
    assert.deepEqual(
      ticks.filter((_, index) => kept[index]),
      [50, 100, 150, 200, 250, 300]
    );
    // Labels closer than their size: every other one is kept, counted from the last one kept
    assert.deepEqual(
      keptLabels([0, 10, 20, 30, 40].map((center) => ({ center, size: 15 })), 100),
      [false, true, false, true, false]
    );
  });

  it('take the defaults of the original for what a visualization does not say', () => {
    // The horizontal bar chart's own: turned, filtered and cut at 100 characters
    assert.deepEqual(valueAxisLabels({ show: true, rotate: 75, filter: true, truncate: 100 }, true, false), {
      rotate: 75,
      filter: true,
      truncate: 100,
    });
    // Along a horizontal axis: filtered, whole; up a vertical one: not filtered, cut at 100
    assert.deepEqual(valueAxisLabels({}, true, false), { rotate: 0, filter: true, truncate: 0 });
    assert.deepEqual(valueAxisLabels(undefined, false, false), { rotate: 0, filter: false, truncate: 100 });
    assert.equal(valueAxisLabels({ filter: false }, true, false).filter, false);
    // A logarithmic scale is always filtered
    assert.equal(valueAxisLabels({ filter: false }, false, true).filter, true);
  });
});

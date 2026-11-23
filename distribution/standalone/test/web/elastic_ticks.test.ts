/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { axisTicks, labelBox, legendWidth, linearTicks, timeTicks, utcTicks, valueTicks } from '../../web/charts/elastic';

const HOUR = 3600000;
const DAY = 24 * HOUR;
const start = Date.UTC(2026, 10, 16);
const iso = (time: number) => new Date(time).toISOString().slice(0, 16).replace('T', ' ');
// Six pixels a character: a label of a date and a time is 96 wide
const measure = (label: string) => label.length * 6;

describe('the ticks of a value axis, as elastic-charts counts them', () => {
  it('are round values inside the range, about as many as asked for', () => {
    assert.deepEqual(linearTicks(0, 11422, 5), [0, 2000, 4000, 6000, 8000, 10000]);
    assert.deepEqual(linearTicks(0, 39, 5), [0, 10, 20, 30]);
    assert.deepEqual(linearTicks(0, 1, 5), [0, 0.2, 0.4, 0.6, 0.8, 1]);
    assert.deepEqual(linearTicks(-25, 25, 4), [-20, -10, 0, 10, 20]);
    assert.deepEqual(linearTicks(5, 5, 5), [5]);
    assert.deepEqual(linearTicks(10, 0, 2), [10, 5, 0]);
  });

  it('are fewer while they would come closer than the step of the data', () => {
    assert.deepEqual(valueTicks([0, 10], 10), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.deepEqual(valueTicks([0, 10], 10, 2), [0, 2, 4, 6, 8, 10]);
  });
});

describe('the ticks of a time axis, as elastic-charts counts them', () => {
  it('take the step of d3 nearest to the range over the count', () => {
    // A week over ten ticks is nearer twelve hours than a day; over nine, nearer a day
    const twelve = utcTicks(start, start + 7 * DAY, 10);
    assert.equal(twelve.length, 15);
    assert.equal(twelve[1] - twelve[0], 12 * HOUR);
    assert.deepEqual(utcTicks(start, start + 7 * DAY, 9), [0, 1, 2, 3, 4, 5, 6, 7].map((day) => start + day * DAY));
    // Every other day counts from the first of the month, every week from Sunday
    assert.deepEqual(utcTicks(Date.UTC(2026, 10, 2), Date.UTC(2026, 10, 12), 4).map(iso), [
      '2026-11-03 00:00',
      '2026-11-05 00:00',
      '2026-11-07 00:00',
      '2026-11-09 00:00',
      '2026-11-11 00:00',
    ]);
    assert.deepEqual(utcTicks(Date.UTC(2026, 10, 1), Date.UTC(2026, 11, 31), 8).map(iso), [
      '2026-11-01 00:00',
      '2026-11-08 00:00',
      '2026-11-15 00:00',
      '2026-11-22 00:00',
      '2026-11-29 00:00',
      '2026-12-06 00:00',
      '2026-12-13 00:00',
      '2026-12-20 00:00',
      '2026-12-27 00:00',
    ]);
    assert.deepEqual(utcTicks(Date.UTC(2020, 0, 1), Date.UTC(2026, 0, 1), 3).map(iso), ['2020-01-01 00:00', '2022-01-01 00:00', '2024-01-01 00:00', '2026-01-01 00:00']);
  });

  it('fall on round moments where the reader is', () => {
    // An hour east of UTC, midnight is at eleven the evening before in UTC
    const ticks = timeTicks([start - HOUR, start + 7 * DAY - HOUR], 9, () => 60);
    assert.equal(iso(ticks[0]), '2026-11-15 23:00');
    assert.equal(ticks.length, 8);
  });
});

describe('the ticks an axis shows', () => {
  it('are the most whose labels fit beside each other', () => {
    const ticks = axisTicks({
      ticks: (count) => timeTicks([start, start + 7 * DAY], count, () => 0),
      count: 10,
      position: (value) => ((value - start) / (7 * DAY)) * 1103,
      format: iso,
      measure,
      fontSize: 11,
      vertical: false,
      time: true,
    });
    assert.deepEqual(
      ticks.map((tick) => tick.label),
      [16, 17, 18, 19, 20, 21, 22, 23].map((day) => `2026-11-${day} 00:00`)
    );
    assert.equal(ticks[7].position, 1103);
  });

  it('on a short value axis, fewer, half a label apart', () => {
    const height = 30;
    const ticks = axisTicks({
      ticks: (count) => valueTicks([0, 11422], count),
      count: 5,
      position: (value) => height - (value / 11422) * height,
      format: String,
      measure,
      fontSize: 11,
      vertical: true,
      time: false,
    });
    assert.deepEqual(ticks.map((tick) => tick.label), ['10000', '5000', '0']);
  });

  it('leave a label blank where none fits', () => {
    const ticks = axisTicks({
      ticks: (count) => valueTicks([0, 10], count),
      count: 3,
      position: (value) => 10 - value,
      format: String,
      measure,
      fontSize: 11,
      vertical: true,
      time: false,
    });
    assert.ok(ticks.length >= 2);
    assert.ok(ticks.some((tick) => tick.label === ''));
  });
});

describe('the room of labels and of a legend', () => {
  it('is measured in whole pixels', () => {
    assert.deepEqual(labelBox(['10,000', '0'], () => 34.84, 11), { width: 35, height: 11 });
  });

  it('gives a legend its widest name and value, its mark and margins, at most 200 pixels', () => {
    // 16 for the mark, 4 and 4 around the name, 10 to spare
    assert.equal(legendWidth(['gz1', 'css0'], true, 268, measure), 16 + 4 + 24 + 4 + 10);
    assert.equal(legendWidth(['gz', 'css'], false, 268, measure), 16 + 4 + 18 + 10);
    // Rows taller than the chart leave room for a scroll bar
    assert.equal(legendWidth(Array.from({ length: 11 }, () => 'abcd1'), true, 268, measure), 16 + 4 + 30 + 4 + 10 + 16);
    assert.equal(legendWidth(['x'.repeat(60)], true, 268, measure), 200);
  });
});

/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mergeGlobal, TICK_FORMATTERS } from '../../web/vis/timeline/formatters';
import { Color, extend, stackData, timeTickGenerator, type Axis, type PlotSeries } from '../../web/vis/timeline/plot';
import { calculateInterval, isoDurationMs, toMS } from '../../web/vis/timeline/request';

const axis = (fields: Partial<Axis>): Axis => ({ options: {}, tickDecimals: 0, ...fields }) as Axis;

describe("Timeline's colours", () => {
  it('reads and writes colours as Flot does', () => {
    assert.equal(Color.parse('#54B399').toString(), 'rgb(84,179,153)');
    assert.equal(Color.parse('#545454').scale('a', 0.22).toString(), 'rgba(84,84,84,0.22)');
    assert.equal(Color.parse('rgb(84, 179, 153)').toString(), 'rgb(84,179,153)');
    assert.equal(Color.parse('red').toString(), 'rgb(255,0,0)');
    assert.equal(Color.parse('transparent').toString(), 'rgba(255,255,255,0)');
  });
});

describe("Timeline's options", () => {
  it('merge as jQuery deep extend merges them, skipping undefined', () => {
    const target = { grid: { show: true, margin: 0 }, list: [1, 2] };
    extend(target, { grid: { show: undefined, margin: 10 }, list: [3] });
    assert.deepEqual(target, { grid: { show: true, margin: 10 }, list: [3, 2] });
  });

  it("take a series' chart-wide options, where null never replaces a value", () => {
    const options: Record<string, unknown> = { legend: { position: 'nw', show: true } };
    mergeGlobal(options, { legend: { position: 'ne', show: null }, yaxes: [null, { position: 'right' }] });
    assert.deepEqual(options, { legend: { position: 'ne', show: true }, yaxes: [null, { position: 'right' }] });
  });
});

describe("Timeline's y axis units", () => {
  it('scale bytes and bits by their own steps', () => {
    assert.equal(TICK_FORMATTERS.bytes(0, axis({})), '0B');
    assert.equal(TICK_FORMATTERS.bytes(2048, axis({})), '2KB');
    assert.equal(TICK_FORMATTERS.bytes(1500000, axis({})), '1.43MB');
    assert.equal(TICK_FORMATTERS['bits/s'](-2500, axis({})), '-2.5kb/s');
  });

  it('write percent, currency and custom units', () => {
    const percent = axis({ tickDecimals: 3, options: { units: { tickDecimalsShift: 2 } } });
    assert.equal(TICK_FORMATTERS.percent(0.125, percent), '12.5%');
    assert.equal(TICK_FORMATTERS.currency(12, axis({ options: { units: { prefix: 'EUR' } } })), '€12.00');
    const custom = axis({ tickDecimals: 1, options: { units: { prefix: '~', suffix: ' ms' } } });
    assert.equal(TICK_FORMATTERS.custom(3, custom), '~3.0 ms');
  });
});

describe("Timeline's intervals", () => {
  it('reads intervals as the original does', () => {
    assert.equal(toMS('1h'), 3600000);
    assert.equal(toMS('2.5s'), 2500);
    assert.equal(toMS('week'), 604800000);
    assert.equal(toMS('1M'), 2592000000);
    assert.throws(() => toMS('2M'), /1M is only valid monthly interval/);
    assert.equal(toMS('nonsense'), undefined);
  });

  it('chooses an automatic interval by the range and the buckets wanted', () => {
    const day = 86400000;
    assert.equal(calculateInterval(0, 7 * day, 200, 'auto', '1ms'), '1h');
    assert.equal(calculateInterval(0, 15 * 60000, 200, 'auto', '1ms'), '1s');
    assert.equal(calculateInterval(0, 365 * day, 200, 'auto', '1ms'), '24h');
    assert.equal(calculateInterval(0, 60000, 200, 'auto', '1m'), '1m');
    assert.equal(calculateInterval(0, 7 * day, 200, '3h', '1ms'), '3h');
  });

  it('measures ISO durations as moment does', () => {
    assert.equal(isoDurationMs('PT1S'), 1000);
    assert.equal(isoDurationMs('P1DT'), 86400000);
    assert.equal(isoDurationMs('P1YT'), 31536000000);
  });
});

describe("Timeline's time axis", () => {
  it('puts ticks on whole units of the step it chooses, in UTC', () => {
    const start = Date.UTC(2026, 10, 15, 19, 0);
    const end = Date.UTC(2026, 10, 22, 19, 0);
    const time = axis({ min: start, max: end, delta: (end - start) / 7, options: { timezone: 'utc' } });
    const ticks = timeTickGenerator(time);
    assert.deepEqual(time.tickSize, [1, 'day']);
    assert.equal(ticks[0], Date.UTC(2026, 10, 15));
    assert.equal(ticks[1], Date.UTC(2026, 10, 16));
    assert.equal(ticks[ticks.length - 1], Date.UTC(2026, 10, 23));
  });

  it('steps by months from their first day', () => {
    const start = Date.UTC(2026, 0, 10);
    const end = Date.UTC(2026, 11, 20);
    const time = axis({ min: start, max: end, delta: (end - start) / 4, options: { timezone: 'utc' } });
    const ticks = timeTickGenerator(time);
    assert.deepEqual(time.tickSize, [3, 'month']);
    assert.deepEqual(
      ticks.map((tick) => new Date(tick).toISOString().slice(0, 10)),
      ['2026-01-01', '2026-04-01', '2026-07-01', '2026-10-01', '2027-01-01']
    );
  });
});

describe("Timeline's stacked series", () => {
  const series = (points: Array<number | null>, fields: Partial<PlotSeries> = {}) =>
    ({
      stack: true,
      lines: { show: false },
      bars: { horizontal: false },
      datapoints: { points, pointsize: 3, format: [{ x: true }, { y: true }, { y: true }] },
      ...fields,
    }) as unknown as PlotSeries;

  it('sit on the one before them with the same stack', () => {
    const first = series([1, 10, 0, 2, 20, 0]);
    const second = series([1, 5, 0, 2, 6, 0]);
    stackData([first, second], second, second.datapoints);
    assert.deepEqual(second.datapoints.points, [1, 15, 10, 2, 26, 20]);
  });

  it('leave a series alone when it does not stack', () => {
    const first = series([1, 10, 0]);
    const second = series([1, 5, 0], { stack: false });
    stackData([first, second], second, second.datapoints);
    assert.deepEqual(second.datapoints.points, [1, 5, 0]);
  });
});

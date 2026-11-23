/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Date math against the original's own (its date math on moment 2.29.4 and moment-timezone, run in
 * the fork's build): fixtures/date_math_cases.json holds, for dateFormat:tz America/New_York with
 * weeks from Sunday and for UTC with weeks from Monday, what `parse` gives for each expression at
 * each of five moments, plain and rounded up: the time, or null where it finds no date. The
 * expressions are the awkward ones: spaces in an amount, the ISO 8601 forms, digits alone, days
 * the calendar does not have, hours the clocks skip and repeat.
 */

// A browser on another clock than the zones the settings name below
process.env.TZ = 'Asia/Kolkata';

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { parseDateMath, resolveTimeRange, setDefaultTimeZone } from '../../web/lib/dates';

const fixture = JSON.parse(readFileSync('test/web/fixtures/date_math_cases.json', 'utf8')) as {
  moments: string[];
  expressions: string[];
  results: Record<string, Array<Array<number | null>>>;
};

const NOW = new Date('2026-11-23T04:45:12.345Z');
const time = (date: Date | undefined) => (date === undefined || Number.isNaN(date.getTime()) ? null : date.getTime());

function inZone<T>(zone: string | undefined, run: () => T): T {
  setDefaultTimeZone(zone);
  try {
    return run();
  } finally {
    setDefaultTimeZone(undefined);
  }
}

describe('date math, read as the original reads it', () => {
  it('gives the moment the original gives for every expression of the fixture', () => {
    assert.ok(fixture.expressions.length > 120);
    const wrong: string[] = [];
    for (const [setting, results] of Object.entries(fixture.results)) {
      const [zone, weekStart] = setting.split('|');
      inZone(zone, () => {
        fixture.expressions.forEach((expression, index) => {
          const got: Array<number | null> = [];
          for (const moment of fixture.moments) {
            for (const roundUp of [false, true]) {
              got.push(time(parseDateMath(expression, { roundUp, now: new Date(moment), weekStart: Number(weekStart) })));
            }
          }
          if (JSON.stringify(got) !== JSON.stringify(results[index])) {
            wrong.push(`${setting} ${JSON.stringify(expression)}: ${JSON.stringify(got)}, the original ${JSON.stringify(results[index])}`);
          }
        });
      });
    }
    assert.deepEqual(wrong, []);
  });

  const read = (expression: string, roundUp = false) =>
    inZone('UTC', () => parseDateMath(expression, { now: NOW, roundUp })?.toISOString());

  it('scans an amount as the original does: a space counts, and one unit rounds', () => {
    assert.equal(read('now/1d'), '2026-11-23T00:00:00.000Z');
    assert.equal(read('now/01d'), '2026-11-23T00:00:00.000Z');
    assert.equal(read('now- 1d'), '2026-11-22T04:45:12.345Z');
    assert.equal(read('now-1 d'), '2026-11-22T04:45:12.345Z');
    // spaces alone are no amount: nothing moves
    assert.equal(read('now- d'), '2026-11-23T04:45:12.345Z');
    assert.equal(read('now/2d'), undefined);
    assert.equal(read('now-5'), undefined);
  });

  it('takes the text as it is, spaces before and after included', () => {
    assert.equal(read('now-1d '), undefined);
    assert.equal(read(' now-1d'), undefined);
    assert.equal(read('now '), undefined);
    assert.equal(read(' '), undefined);
  });

  it('reads the ISO 8601 forms the original reads', () => {
    assert.equal(read('2026-11-23T10'), '2026-11-23T10:00:00.000Z');
    assert.equal(read('2026-11-23T10:15:30,123Z'), '2026-11-23T10:15:30.123Z');
    assert.equal(read('2026-W48'), '2026-11-23T00:00:00.000Z');
    assert.equal(read('2026-W48-7'), '2026-11-29T00:00:00.000Z');
    assert.equal(read('2026-327'), '2026-11-23T00:00:00.000Z');
    assert.equal(read('20261123'), '2026-11-23T00:00:00.000Z');
    assert.equal(read('2026-11-23T24:00'), '2026-11-24T00:00:00.000Z');
    assert.equal(read('2026-W48||+1d'), '2026-11-24T00:00:00.000Z');
  });

  it('reads digits alone as a date only where they are an ISO form, never as milliseconds', () => {
    assert.equal(read('2026'), '2026-01-01T00:00:00.000Z');
    assert.equal(read('202611'), '2026-11-01T00:00:00.000Z');
    assert.equal(read('1763892000000'), undefined);
    assert.equal(read('1763892000'), undefined);
    assert.equal(read('1763892000000||/d'), undefined);
  });

  it('finds no date in a day the calendar does not have', () => {
    assert.equal(read('2026-02-30'), undefined);
    assert.equal(read('2026-02-29'), undefined);
    assert.equal(read('2024-02-29'), '2024-02-29T00:00:00.000Z');
    assert.equal(read('2026-11-31||+1d'), undefined);
    assert.equal(read('2026-11-23T25:00'), undefined);
  });

  it('still reads what the time picker and an address give', () => {
    const range = inZone('UTC', () => resolveTimeRange({ from: 'now-15m', to: 'now' }, { now: NOW }));
    assert.equal(range?.from.toISOString(), '2026-11-23T04:30:12.345Z');
    assert.equal(range?.to.toISOString(), '2026-11-23T04:45:12.345Z');
    const week = inZone('UTC', () => resolveTimeRange({ from: 'now/w', to: 'now/w' }, { now: NOW, weekStart: 1 }));
    assert.equal(week?.from.toISOString(), '2026-11-23T00:00:00.000Z');
    assert.equal(week?.to.toISOString(), '2026-11-29T23:59:59.999Z');
    const absolute = inZone('America/New_York', () =>
      resolveTimeRange({ from: '2026-11-20T15:00:00.000Z', to: '2026-11-20 16:00' }, { now: NOW })
    );
    assert.equal(absolute?.from.toISOString(), '2026-11-20T15:00:00.000Z');
    assert.equal(absolute?.to.toISOString(), '2026-11-20T21:00:00.000Z');
    assert.equal(inZone('UTC', () => resolveTimeRange({ from: 'yesterday', to: 'now' }, { now: NOW })), undefined);
  });
});

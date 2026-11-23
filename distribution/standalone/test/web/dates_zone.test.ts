/* SPDX-License-Identifier: Apache-2.0 */

/* Date math where the clock of the zone matters: the hour that comes twice when clocks go back, a date without a time. */

// The moments below are counted on the clock of New York
process.env.TZ = 'America/New_York';

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseDateMath } from '../../web/lib/dates';

describe('date math in the hour that repeats when clocks go back', () => {
  // On 1 November 2026 it is 01:30 twice in New York: at 05:30Z, and an hour later at 06:30Z
  const secondPass = new Date('2026-11-01T06:30:10.500Z');
  const at = (expression: string, roundUp = false) =>
    parseDateMath(expression, { now: secondPass, roundUp })?.toISOString();

  it('rounds to the hour, the minute and the second of the pass the moment is in, as the original', () => {
    assert.equal(at('now/h'), '2026-11-01T06:00:00.000Z');
    assert.equal(at('now/m'), '2026-11-01T06:30:00.000Z');
    assert.equal(at('now/s'), '2026-11-01T06:30:10.000Z');
    assert.equal(at('now/h', true), '2026-11-01T06:59:59.999Z');
    assert.equal(at('now-1m/m'), '2026-11-01T06:29:00.000Z');
    // and in the first pass, an hour on is the second pass
    assert.equal(
      parseDateMath('now+1h/h', { now: new Date('2026-11-01T05:30:00.000Z') })?.toISOString(),
      '2026-11-01T06:00:00.000Z'
    );
  });

  it('leaves the moment alone when nothing is added', () => {
    assert.equal(at('now-0d'), '2026-11-01T06:30:10.500Z');
    assert.equal(at('now+0M'), '2026-11-01T06:30:10.500Z');
  });

  it('rounds to the day and counts days on the clock, through the day of 25 hours', () => {
    assert.equal(at('now/d'), '2026-11-01T04:00:00.000Z');
    assert.equal(at('now/d', true), '2026-11-02T04:59:59.999Z');
    assert.equal(at('now+1d/d'), '2026-11-02T05:00:00.000Z');
    assert.equal(at('now-1d'), '2026-10-31T05:30:10.500Z');
  });
});

describe('a date without a time', () => {
  it('is the start of that day on the clock, as the original reads it', () => {
    assert.equal(parseDateMath('2026-11-20')?.toISOString(), '2026-11-20T05:00:00.000Z');
    assert.equal(parseDateMath('2026-11')?.toISOString(), '2026-11-01T04:00:00.000Z');
    assert.equal(parseDateMath('2026-11-20||+1M/d')?.toISOString(), '2026-12-20T05:00:00.000Z');
    // With a time and no zone it was the clock's already; with a zone it is that zone's
    assert.equal(parseDateMath('2026-11-20T10:00:00')?.toISOString(), '2026-11-20T15:00:00.000Z');
    assert.equal(parseDateMath('2026-11-20T10:00:00Z')?.toISOString(), '2026-11-20T10:00:00.000Z');
    assert.equal(parseDateMath('2026-11-20T10:00:00+02:00')?.toISOString(), '2026-11-20T08:00:00.000Z');
  });
});

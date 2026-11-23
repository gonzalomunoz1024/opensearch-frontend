/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Date math when dateFormat:tz names a zone: it counts on the clock of that zone, as OpenSearch
 * Dashboards does (its dates are in that zone by default), not on the clock of the browser. The
 * moments expected here are those the original's date math gives.
 */

// A browser on another clock than the zones the settings name below: Kolkata
process.env.TZ = 'Asia/Kolkata';

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseDateMath, resolveTimeRange, setDefaultTimeZone } from '../../web/lib/dates';
import { createServices, type BootData } from '../../web/services';

// 23:45 on Sunday 22 November in New York, 10:15 on Monday in Kolkata
const NOW = '2026-11-23T04:45:12.345Z';

/** The moments of some expressions while the settings name a zone, which is taken away again */
function inZone(
  zone: string | undefined,
  now: string | undefined,
  expressions: string[],
  options: { roundUp?: boolean; weekStart?: number } = {}
) {
  setDefaultTimeZone(zone);
  try {
    return expressions.map((expression) =>
      parseDateMath(expression, { ...options, now: now ? new Date(now) : undefined })?.toISOString()
    );
  } finally {
    setDefaultTimeZone(undefined);
  }
}

describe('date math with a zone named in the settings', () => {
  it('rounds to the day, the week, the month, the year and the hour of that zone', () => {
    const units = ['now/d', 'now/w', 'now/M', 'now/y', 'now/h'];
    assert.deepEqual(inZone('America/New_York', NOW, units), [
      '2026-11-22T05:00:00.000Z',
      '2026-11-22T05:00:00.000Z',
      '2026-11-01T04:00:00.000Z',
      '2026-01-01T05:00:00.000Z',
      '2026-11-23T04:00:00.000Z',
    ]);
    assert.deepEqual(inZone('America/New_York', NOW, units, { roundUp: true }), [
      '2026-11-23T04:59:59.999Z',
      '2026-11-29T04:59:59.999Z',
      '2026-12-01T04:59:59.999Z',
      '2027-01-01T04:59:59.999Z',
      '2026-11-23T04:59:59.999Z',
    ]);
    assert.deepEqual(inZone('America/New_York', NOW, ['now/w'], { weekStart: 1 }), ['2026-11-16T05:00:00.000Z']);
    assert.deepEqual(inZone('UTC', NOW, ['now/d', 'now/w']), ['2026-11-23T00:00:00.000Z', '2026-11-22T00:00:00.000Z']);
    // and with no zone named, of the browser's: a clock half an hour off the hour
    assert.deepEqual(inZone(undefined, NOW, ['now/d', 'now/w', 'now/h']), [
      '2026-11-22T18:30:00.000Z',
      '2026-11-21T18:30:00.000Z',
      '2026-11-23T04:30:00.000Z',
    ]);
  });

  it('counts days, months and years on that clock', () => {
    // A month before, New York was an hour nearer to UTC; Kolkata never is
    assert.deepEqual(inZone('America/New_York', NOW, ['now-1d/d', 'now-7d', 'now-1M', 'now-1y', 'now/d+8h']), [
      '2026-11-21T05:00:00.000Z',
      '2026-11-16T04:45:12.345Z',
      '2026-10-23T03:45:12.345Z',
      '2025-11-23T04:45:12.345Z',
      '2026-11-22T13:00:00.000Z',
    ]);
    // 1 November 2026 has 25 hours in New York: clocks go back at 06:00Z
    assert.deepEqual(inZone('America/New_York', '2026-11-01T05:30:00.000Z', ['now+1d', 'now/d']), [
      '2026-11-02T06:30:00.000Z',
      '2026-11-01T04:00:00.000Z',
    ]);
    assert.deepEqual(inZone('America/New_York', '2026-11-01T05:30:00.000Z', ['now/d'], { roundUp: true }), [
      '2026-11-02T04:59:59.999Z',
    ]);
  });

  it('gives the moments of the original in the hour that comes twice and the hour that is skipped', () => {
    // The second pass of 01:30 on 1 November
    assert.deepEqual(inZone('America/New_York', '2026-11-01T06:30:00.000Z', ['now/h', 'now-1d', 'now+1d']), [
      '2026-11-01T06:00:00.000Z',
      '2026-10-31T05:30:00.000Z',
      '2026-11-02T06:30:00.000Z',
    ]);
    assert.deepEqual(inZone('America/New_York', '2026-11-02T06:30:00.000Z', ['now-1d', 'now-1d/h']), [
      '2026-11-01T06:30:00.000Z',
      '2026-11-01T06:00:00.000Z',
    ]);
    // 02:30 on 7 March: a day on, 02:30 is skipped (clocks go from 02:00 to 03:00 at 07:00Z)
    assert.deepEqual(
      inZone('America/New_York', '2026-03-07T07:30:00.000Z', ['now+1d', 'now+1d/h', 'now+1d-1d', 'now+1d+1d', 'now+1d/d']),
      [
        '2026-03-08T06:30:00.000Z',
        '2026-03-08T07:00:00.000Z',
        '2026-03-07T07:30:00.000Z',
        '2026-03-09T06:30:00.000Z',
        '2026-03-08T05:00:00.000Z',
      ]
    );
    // Havana skips midnight itself on 8 March (00:00 to 01:00 at 05:00Z)
    assert.deepEqual(inZone('America/Havana', '2026-03-07T15:00:00.000Z', ['now+1d/d', 'now/d+1d', 'now/d+1d/d']), [
      '2026-03-08T05:00:00.000Z',
      '2026-03-08T04:00:00.000Z',
      '2026-03-08T05:00:00.000Z',
    ]);
    assert.deepEqual(inZone('America/Havana', '2026-03-07T15:00:00.000Z', ['now/d', 'now+1d/d'], { roundUp: true }), [
      '2026-03-08T04:59:59.999Z',
      '2026-03-09T03:59:59.999Z',
    ]);
  });

  it('reads a date that names no zone on that clock', () => {
    assert.deepEqual(
      inZone('America/New_York', undefined, [
        '2026-11-20',
        '2026-11',
        '2026-11-20T10:00:00',
        '2026-11-20||+1M/d',
        // one that names a zone is that zone's
        '2026-11-20T10:00:00Z',
        '2026-11-20T10:00:00+02:00',
        // 02:30 that is skipped, 01:30 that comes twice
        '2026-03-08T02:30:00',
        '2026-03-08T02:30:00||/h',
        '2026-11-01T01:30:00',
      ]),
      [
        '2026-11-20T05:00:00.000Z',
        '2026-11-01T04:00:00.000Z',
        '2026-11-20T15:00:00.000Z',
        '2026-12-20T05:00:00.000Z',
        '2026-11-20T10:00:00.000Z',
        '2026-11-20T08:00:00.000Z',
        '2026-03-08T07:30:00.000Z',
        '2026-03-08T07:00:00.000Z',
        '2026-11-01T05:30:00.000Z',
      ]
    );
  });

  it('is on the clock of the browser for a zone the browser does not know', () => {
    assert.deepEqual(inZone('Mars/Olympus_Mons', NOW, ['now/d']), ['2026-11-22T18:30:00.000Z']);
  });

  it('gives no date where dates end, and the right one long before zones were kept', () => {
    setDefaultTimeZone('America/New_York');
    try {
      const beyond = parseDateMath('now-99999999999999999999d/d', { now: new Date(NOW) });
      assert.ok(beyond !== undefined && Number.isNaN(beyond.getTime()));
      // New York kept its own mean time, 4 hours 56 minutes behind, the original says to the second
      assert.equal(parseDateMath('0000-01-01')?.toISOString().slice(0, 16), '0000-01-01T04:56');
      assert.equal(parseDateMath('0000-01-01||-1d')?.toISOString().slice(0, 19), '-000001-12-31T04:56');
    } finally {
      setDefaultTimeZone(undefined);
    }
  });
});

describe('the zone the settings name', () => {
  const today = () => {
    const range = resolveTimeRange({ from: 'now/d', to: 'now/d' }, { now: new Date(NOW) });
    return [range?.from.toISOString(), range?.to.toISOString()];
  };

  it('is the one date math counts in, from the start and when the setting changes', async () => {
    // The server of the settings: it keeps what is posted and answers with all it keeps
    const stored: Record<string, unknown> = { 'dateFormat:tz': 'America/New_York' };
    const original = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      const { changes } = JSON.parse(String(init?.body)) as { changes: Record<string, unknown> };
      for (const [key, value] of Object.entries(changes)) {
        if (value === null) delete stored[key];
        else stored[key] = value;
      }
      const settings = Object.fromEntries(Object.entries(stored).map(([key, userValue]) => [key, { userValue }]));
      return new Response(JSON.stringify({ settings }), { headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    try {
      const boot = { basePath: '', version: '3.9.0', name: 'test', settings: { ...stored }, settingsDefaults: {}, settingsOverrides: {} };
      const { uiSettings } = createServices(boot as unknown as BootData);
      assert.deepEqual(today(), ['2026-11-22T05:00:00.000Z', '2026-11-23T04:59:59.999Z']);
      await uiSettings.set('dateFormat:tz', 'UTC');
      assert.deepEqual(today(), ['2026-11-23T00:00:00.000Z', '2026-11-23T23:59:59.999Z']);
      // back at "Browser", its default: the clock of the browser
      await uiSettings.remove('dateFormat:tz');
      assert.deepEqual(today(), ['2026-11-22T18:30:00.000Z', '2026-11-23T18:29:59.999Z']);
    } finally {
      globalThis.fetch = original;
      setDefaultTimeZone(undefined);
    }
  });
});

/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The expectations are what the original's own code (OUI 1.24.2's date picker and moment 2.29.4)
 * gives for the same present, Monday 23 November 2026 at 04:37:14.419 UTC.
 */

process.env.TZ = 'UTC';

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  addToTimeHistory,
  calendarWeeks,
  dateOf,
  formatTimeString,
  fromNow,
  fromZonedParts,
  getDateMode,
  isRangeInvalid,
  isValidTimeRange,
  parseFormattedDate,
  parseRelativeParts,
  parseTimeParts,
  prettyDuration,
  quickSelectRange,
  showPrettyDuration,
  shiftDay,
  stepRange,
  toAbsoluteString,
  toRelativeString,
  toRelativeStringFromParts,
  zonedParts,
  type QuickRange,
} from '../../web/lib/date_picker';
import { setDefaultTimeZone } from '../../web/lib/dates';

const now = new Date(Date.UTC(2026, 10, 23, 4, 37, 14, 419));
const context = { now };
const FORMAT = 'MMM D, YYYY @ HH:mm:ss.SSS';
const QUICK: QuickRange[] = [
  { from: 'now/d', to: 'now/d', display: 'Today' },
  { from: 'now/w', to: 'now/w', display: 'This week' },
  { from: 'now-15m', to: 'now', display: 'Last 15 minutes' },
  { from: 'now-7d', to: 'now', display: 'Last 7 days' },
];

describe('how the date picker writes a date', () => {
  it('writes an exact date in the date format, now as now, and the rest roughly from now', () => {
    const cases: Array<[string, string, string]> = [
      ['now', 'now', 'now'],
      ['now-7d', '~ 7 days ago', '~ 7 days ago'],
      ['now+2h', '~ in 2 hours', '~ in 2 hours'],
      ['now-1d/d', '~ a day ago', '~ 5 hours ago'],
      ['now/w', '~ a day ago', '~ in 6 days'],
      ['2026-11-16T03:59:18.191Z', 'Nov 16, 2026 @ 03:59:18.191', 'Nov 16, 2026 @ 03:59:18.191'],
      // Not written exactly so: only roughly, as the original does
      ['2026-11-16T03:59:18Z', '~ 7 days ago', '~ 7 days ago'],
      ['2026-11-16T03:59:18.191+01:00', 'Nov 16, 2026 @ 02:59:18.191', 'Nov 16, 2026 @ 02:59:18.191'],
      ['banana', '~ Invalid date', '~ Invalid date'],
      ['now-5x', 'now-5x', 'now-5x'],
      ['2026-02-30T00:00:00.000Z', '~ Invalid date', '~ Invalid date'],
    ];
    for (const [value, start, end] of cases) {
      assert.equal(formatTimeString(value, FORMAT, false, context), start, value);
      assert.equal(formatTimeString(value, FORMAT, true, context), end, value);
    }
  });

  it('says how long ago as moment does, at each of its thresholds', () => {
    const ago: Array<[string, string]> = [
      ['now-44s', 'a few seconds ago'],
      ['now-45s', 'a minute ago'],
      ['now-90s', '2 minutes ago'],
      ['now-89m', 'an hour ago'],
      ['now-21h', '21 hours ago'],
      ['now-22h', 'a day ago'],
      ['now-36h', '2 days ago'],
      ['now-25d', '25 days ago'],
      ['now-26d', 'a month ago'],
      ['now-45d', 'a month ago'],
      ['now-10M', '10 months ago'],
      ['now-11M', 'a year ago'],
      ['now-17M', 'a year ago'],
      ['now-18M', '2 years ago'],
      ['now-3y', '3 years ago'],
      ['now+1M', 'in a month'],
      ['now+400d', 'in a year'],
    ];
    for (const [value, words] of ago) {
      assert.equal(formatTimeString(value, FORMAT, false, context), `~ ${words}`, value);
    }
    assert.equal(fromNow(now, now), 'a few seconds ago');
  });

  it('counts the months on the clock of the zone the settings name, as moment does in it', () => {
    // The browser is on UTC, where 1 December has begun while it is still 30 November in New York
    const date = new Date('2024-12-01T01:00:00Z');
    const later = new Date('2026-05-31T02:00:00Z');
    setDefaultTimeZone('America/New_York');
    try {
      assert.equal(fromNow(date, later, 'America/New_York'), '2 years ago');
      assert.equal(fromNow(new Date('2025-03-01T00:30:00Z'), new Date('2026-08-29T16:00:00Z'), 'America/New_York'), '2 years ago');
      assert.equal(fromNow(new Date('2026-01-31T23:00:00Z'), new Date('2026-03-01T03:00:00Z'), 'America/New_York'), 'a month ago');
      assert.equal(
        formatTimeString('2024-12-01T01:00:00Z', FORMAT, false, { now: later, timeZone: 'America/New_York' }),
        '~ 2 years ago'
      );
    } finally {
      setDefaultTimeZone(undefined);
    }
    setDefaultTimeZone('Asia/Tokyo');
    try {
      assert.equal(fromNow(date, later, 'Asia/Tokyo'), 'a year ago');
    } finally {
      setDefaultTimeZone(undefined);
    }
    // No zone named: the browser's clock
    assert.equal(fromNow(date, later), 'a year ago');
    assert.equal(fromNow(new Date('2025-03-01T00:30:00Z'), new Date('2026-08-29T16:00:00Z')), 'a year ago');
  });

  it("lets a range stand only when both ends are dates of the date math, as the original's validateTimeRange", () => {
    // What the original's @elastic/datemath reads as a valid end, and what it does not
    const ends: Array<[string, boolean]> = [
      ['now', true],
      ['now-15m', true],
      ['now-1y/d', true],
      ['now+3d', true],
      ['now/d+1h', true],
      ['2026-11-01T00:00:00.000Z', true],
      ['2026-11-01', true],
      ['2026-11-01||-1d', true],
      ['2026-11-01T00:00:00.000Z||/d', true],
      ['banana', false],
      ['', false],
      ['now-5x', false],
      ['now-1q', false],
      ['2026-02-30T00:00:00.000Z', false],
      ['x||-1d', false],
    ];
    for (const [end, valid] of ends) {
      assert.equal(isValidTimeRange({ from: end, to: 'now' }), valid, end);
      assert.equal(isValidTimeRange({ from: 'now-1d', to: end }), valid, end);
    }
    // A range the wrong way round is still one: the picker says it cannot be applied
    assert.equal(isValidTimeRange({ from: 'now', to: 'now-1d' }), true);
    for (const time of [undefined, null, 'now-15m', {}, { from: 'now-1y' }, { to: 'now' }, { from: 0, to: 'now' }]) {
      assert.equal(isValidTimeRange(time), false, JSON.stringify(time));
    }
  });

  it('tells the three kinds of date apart', () => {
    assert.equal(getDateMode('now'), 'now');
    assert.equal(getDateMode('now-1d'), 'relative');
    assert.equal(getDateMode('2026-01-01'), 'absolute');
    assert.equal(getDateMode('xnowx'), 'relative');
  });
});

describe('how the date picker names a range', () => {
  it('names a quick range by its name, a range up to now or from now by its length, the rest by its ends', () => {
    const cases: Array<[string, string, string, boolean]> = [
      ['now-15m', 'now', 'Last 15 minutes', true],
      ['now-2h', 'now', 'Last 2 hours', true],
      ['now', 'now+3d', 'Next 3 days', true],
      ['now-1d/d', 'now', 'Last 1 day rounded to the day', true],
      ['now-3w/w', 'now', 'Last 3 weeks rounded to the week', true],
      ['now/w', 'now', 'Last 1 day', true],
      ['now-1h', 'now-5m', '~ an hour ago to ~ 5 minutes ago', false],
      ['2026-11-16T03:59:18.191Z', 'now', 'Nov 16, 2026 @ 03:59:18.191 to now', false],
      ['now/d', 'now/d', 'Today', true],
      ['now-1M', 'now', 'Last 1 month', true],
      ['now-1s', 'now', 'Last 1 second', true],
      ['now-15m', 'now+15m', '~ 15 minutes ago to ~ in 15 minutes', false],
    ];
    for (const [from, to, name, pretty] of cases) {
      assert.equal(prettyDuration(from, to, QUICK, FORMAT, context), name, `${from} ${to}`);
      assert.equal(showPrettyDuration(from, to, QUICK), pretty, `${from} ${to}`);
    }
  });

  it('cannot apply a range that ends before it starts, an end that is no date, or now to now', () => {
    assert.equal(isRangeInvalid('now-15m', 'now', context), false);
    assert.equal(isRangeInvalid('now', 'now', context), true);
    assert.equal(isRangeInvalid('now', 'now-1m', context), true);
    assert.equal(isRangeInvalid('banana', 'now', context), true);
    assert.equal(isRangeInvalid('now/d', 'now/d', context), false);
    assert.equal(isRangeInvalid('2026-11-16T03:59:18.191Z', '2026-11-16T03:59:18.191Z', context), false);
  });
});

describe('a relative date taken apart and put back together', () => {
  it('takes apart what is written relatively, and measures the rest from now', () => {
    assert.deepEqual(parseRelativeParts('now-15m', context), { count: 15, unit: 'm', round: false });
    assert.deepEqual(parseRelativeParts('now+2h/h', context), { count: 2, unit: 'h+', round: true, roundUnit: 'h' });
    assert.deepEqual(parseRelativeParts('now', context), { count: 0, unit: 's', round: false });
    assert.deepEqual(parseRelativeParts('now/d', context), { count: 5, unit: 'h', round: false });
    assert.deepEqual(parseRelativeParts('now-1d/d', context), { count: 1, unit: 'd', round: true, roundUnit: 'd' });
    assert.deepEqual(parseRelativeParts('banana', context), { count: 0, unit: 's', round: false });
    // Seven days back as an absolute date is a week, as the original's relative tab shows it
    assert.deepEqual(parseRelativeParts('2026-11-16T03:59:18.191Z', context), { count: 1, unit: 'w', round: false });
    assert.deepEqual(parseRelativeParts('2026-11-30T03:59:18.191Z', context), { count: 7, unit: 'd+', round: false });
    assert.deepEqual(parseRelativeParts(toAbsoluteString('now+2h/h', false, context), context), {
      count: 1,
      unit: 'h+',
      round: false,
    });
  });

  it('puts the parts back together, rounding to its own unit', () => {
    assert.equal(toRelativeStringFromParts({ count: 0, unit: 's', round: false }), 'now');
    assert.equal(toRelativeStringFromParts({ count: 0, unit: 'd', round: true }), 'now-0d/d');
    assert.equal(toRelativeStringFromParts({ count: 3, unit: 'h+', round: true }), 'now+3h/h');
    assert.equal(toRelativeStringFromParts({ count: 12, unit: 'M', round: false }), 'now-12M');
    assert.equal(toRelativeString('now/d', context), 'now-5h');
    assert.equal(toRelativeString('2026-11-16T03:59:18.191Z', context), 'now-1w');
    assert.equal(toRelativeString('banana', context), 'now');
  });

  it('turns a date into the moment it is, rounding the end of a range up', () => {
    assert.equal(toAbsoluteString('now-1d/d', false, context), '2026-11-22T00:00:00.000Z');
    assert.equal(toAbsoluteString('now-1d/d', true, context), '2026-11-22T23:59:59.999Z');
    assert.equal(toAbsoluteString('banana', false, context), 'banana');
  });

  it('reads the moment an end of the range is, and none for what is no date', () => {
    assert.equal(dateOf('now-1d/d', false, context)?.toISOString(), '2026-11-22T00:00:00.000Z');
    assert.equal(dateOf('now-1d/d', true, context)?.toISOString(), '2026-11-22T23:59:59.999Z');
    assert.equal(dateOf('2026-11-16T03:59:18.191Z', false, context)?.toISOString(), '2026-11-16T03:59:18.191Z');
    assert.equal(dateOf('banana', false, context), undefined);
  });
});

describe('the quick select', () => {
  it('starts from the range shown, or from the last 15 minutes', () => {
    assert.deepEqual(parseTimeParts('now-15m', 'now', context), { timeTense: 'last', timeUnits: 'm', timeValue: 15 });
    assert.deepEqual(parseTimeParts('now', 'now+3d', context), { timeTense: 'next', timeUnits: 'd', timeValue: 3 });
    assert.deepEqual(parseTimeParts('now/d', 'now/d', context), { timeTense: 'last', timeUnits: 'h', timeValue: 5 });
    assert.deepEqual(parseTimeParts('2026-11-16T03:59:18.191Z', 'now', context), {
      timeTense: 'last',
      timeUnits: 'm',
      timeValue: 15,
    });
    assert.deepEqual(parseTimeParts('now', 'now', context), { timeTense: 'last', timeUnits: 'm', timeValue: 15 });
    assert.deepEqual(parseTimeParts('now-7d/d', 'now', context), { timeTense: 'last', timeUnits: 'd', timeValue: 7 });
  });

  it('applies the last or the next so many units', () => {
    assert.deepEqual(quickSelectRange({ timeTense: 'last', timeValue: 3, timeUnits: 'h' }), { from: 'now-3h', to: 'now' });
    assert.deepEqual(quickSelectRange({ timeTense: 'next', timeValue: 2, timeUnits: 'w' }), { from: 'now', to: 'now+2w' });
  });

  it('steps to the window of the same length just before or after', () => {
    assert.deepEqual(stepRange('now-15m', 'now', -1, context), {
      from: '2026-11-23T04:07:14.418Z',
      to: '2026-11-23T04:22:14.418Z',
    });
    assert.deepEqual(stepRange('now-15m', 'now', 1, context), {
      from: '2026-11-23T04:37:14.420Z',
      to: '2026-11-23T04:52:14.420Z',
    });
  });

  it('remembers ten ranges at most, the newest first and each once', () => {
    let history = [{ from: 'now-15m', to: 'now' }];
    history = addToTimeHistory(history, { from: 'now-7d', to: 'now' });
    history = addToTimeHistory(history, { from: 'now-15m', to: 'now' });
    assert.deepEqual(history, [
      { from: 'now-15m', to: 'now' },
      { from: 'now-7d', to: 'now' },
    ]);
    for (let day = 1; day <= 12; day += 1) history = addToTimeHistory(history, { from: `now-${day}d`, to: 'now' });
    assert.equal(history.length, 10);
    assert.deepEqual(history[0], { from: 'now-12d', to: 'now' });
  });
});

describe('the calendar of the absolute tab', () => {
  it('draws the weeks a month touches, from the first day of the week the settings name', () => {
    const november = calendarWeeks(2026, 10, 0);
    assert.equal(november.length, 5);
    assert.deepEqual(november[0][0], { year: 2026, month: 10, day: 1, weekday: 0 });
    assert.deepEqual(november[4].map((day) => day.day), [29, 30, 1, 2, 3, 4, 5]);
    const mondays = calendarWeeks(2026, 10, 1);
    assert.deepEqual(mondays[0][0], { year: 2026, month: 9, day: 26, weekday: 1 });
    assert.equal(mondays.length, 6);
    // February 2026 starts on a Sunday and fills four weeks exactly
    assert.equal(calendarWeeks(2026, 1, 0).length, 4);
  });

  it('reads and writes the clock of a zone', () => {
    const parts = zonedParts(new Date(Date.UTC(2026, 10, 16, 3, 59, 18, 191)), 'Asia/Tokyo');
    assert.deepEqual(parts, { year: 2026, month: 10, day: 16, hour: 12, minute: 59, second: 18, ms: 191 });
    assert.equal(fromZonedParts(parts, 'Asia/Tokyo')?.toISOString(), '2026-11-16T03:59:18.191Z');
    assert.equal(
      fromZonedParts({ year: 2026, month: 6, day: 1, hour: 9, minute: 0, second: 0, ms: 0 }, 'America/New_York')?.toISOString(),
      '2026-07-01T13:00:00.000Z'
    );
    assert.equal(fromZonedParts({ year: 2026, month: 1, day: 30, hour: 0, minute: 0, second: 0, ms: 0 }), undefined);
    assert.deepEqual(shiftDay(parts, 1, 'M'), { ...parts, month: 11 });
    assert.deepEqual(shiftDay({ ...parts, month: 0, day: 31 }, 1, 'M'), { ...parts, month: 1, day: 28 });
    assert.deepEqual(shiftDay({ ...parts, month: 11, day: 31 }, 1, 'd'), { ...parts, year: 2027, month: 0, day: 1 });
  });

  it('reads a typed date only when it is exactly in the date format and a real date', () => {
    const typed: Array<[string, string | undefined]> = [
      ['Nov 16, 2026 @ 03:59:18.191', '2026-11-16T03:59:18.191Z'],
      ['nov 16, 2026 @ 03:59:18.191', '2026-11-16T03:59:18.191Z'],
      ['Nov 16, 2026 @ 3:59:18.191', undefined],
      ['Nov 16, 2026 @ 03:59:18', undefined],
      ['Feb 30, 2026 @ 03:59:18.191', undefined],
      ['Nov 6, 2026 @ 03:59:18.191', '2026-11-06T03:59:18.191Z'],
      ['Nov 06, 2026 @ 03:59:18.191', '2026-11-06T03:59:18.191Z'],
      ['November 16, 2026 @ 03:59:18.191', undefined],
      ['Nov 16, 2026 @ 24:00:00.000', '2026-11-17T00:00:00.000Z'],
      [' Nov 16, 2026 @ 03:59:18.191', undefined],
    ];
    for (const [text, iso] of typed) {
      assert.equal(parseFormattedDate(text, FORMAT, undefined, now)?.toISOString(), iso, text);
    }
    const others: Array<[string, string, string | undefined]> = [
      ['16/11/2026 03:59', 'DD/MM/YYYY HH:mm', '2026-11-16T03:59:00.000Z'],
      ['2026-11-16', 'YYYY-MM-DD', '2026-11-16T00:00:00.000Z'],
      ['16', 'D', '2026-11-16T00:00:00.000Z'],
      ['11-2026', 'MM-YYYY', '2026-11-01T00:00:00.000Z'],
      ['03:59 PM', 'hh:mm A', '2026-11-23T15:59:00.000Z'],
      ['Monday, Nov 16', 'dddd, MMM D', '2026-11-16T00:00:00.000Z'],
      ['Sunday, Nov 16', 'dddd, MMM D', undefined],
      ['1763265558', 'X', '2025-11-16T03:59:18.000Z'],
      ['16th Nov', 'Do MMM', '2026-11-16T00:00:00.000Z'],
    ];
    for (const [text, format, iso] of others) {
      assert.equal(parseFormattedDate(text, format, undefined, now)?.toISOString(), iso, `${text} ${format}`);
    }
    assert.equal(
      parseFormattedDate('Nov 16, 2026 @ 12:59:18.191', FORMAT, 'Asia/Tokyo', now)?.toISOString(),
      '2026-11-16T03:59:18.191Z'
    );
  });
});

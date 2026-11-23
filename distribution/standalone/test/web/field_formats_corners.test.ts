/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The values a field of the format's kind seldom holds: no number, no date, text where a number is
 * meant, an object, a list with nothing in it. Each expected text is what the original's field
 * formats wrote for that value in a page of OpenSearch Dashboards 3.9.0 (its HTML, the zone UTC);
 * the moments and the words of readMoment and fromNow are those of its moment 2.29.4 with
 * moment-timezone 0.5.37.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readMoment } from '../../web/lib/dates';
import { createFormatter, DEFAULT_FORMAT_SETTINGS, fromNow } from '../../web/lib/field_formats';

const settings = { ...DEFAULT_FORMAT_SETTINGS, timeZone: 'UTC' };
const OBJECT = { a: 1, b: { c: [1, 2] } };
const MIXED = [1, 'two', null, true];
const LOOKUP = { lookupEntries: [{ key: '1', value: 'one' }, { key: 'true', value: 'yes!' }, { key: '0', value: '' }] };
const AS_MINUTES = { inputFormat: 'seconds', outputFormat: 'asMinutes', outputPrecision: 2 };

type Row = [id: string, params: Record<string, unknown>, value: unknown, expected: string];

function writesAsTheOriginal(title: string, rows: Row[]): void {
  it(title, () => {
    assert.deepEqual(
      rows.map(([id, params, value]) => createFormatter({ id, params }, settings)(value).text),
      rows.map(([, , , expected]) => expected)
    );
  });
}

describe('the corner values of the field formats', () => {
  writesAsTheOriginal('a date format writes what moment finds no date in as it is', [
    ['date', {}, Number.NaN, 'NaN'],
    ['date', {}, Infinity, 'Infinity'],
    ['date', {}, -Infinity, '-Infinity'],
    ['date', {}, 8640000000000001, '8640000000000001'],
    // Digits are no count of milliseconds to moment
    ['date', {}, '1709214330123', '1709214330123'],
    ['date', {}, 'not a date', 'not a date'],
    ['date', {}, true, 'true'],
    ['date', {}, '', ''],
    ['date', {}, ' ', ' '],
    ['date', { pattern: 'YYYY-MM-DD' }, '2001:db8::1', '2001:db8::1'],
    ['relative_date', {}, Number.NaN, 'NaN'],
    ['relative_date', {}, 8640000000000001, '8640000000000001'],
    ['relative_date', {}, 1e21, '1e+21'],
    ['relative_date', {}, 'not a date', 'not a date'],
  ]);

  writesAsTheOriginal('a date format reads text as moment reads it: a year, a day, a moment with or without an offset', [
    ['date', {}, '2024', 'Jan 1, 2024 @ 00:00:00.000'],
    ['date', {}, '2024-02-29', 'Feb 29, 2024 @ 00:00:00.000'],
    ['date', {}, '2024-02-29T13:45:30.123Z', 'Feb 29, 2024 @ 13:45:30.123'],
    ['date', {}, '2024-02-29T13:45:30.123456789+02:00', 'Feb 29, 2024 @ 11:45:30.123'],
    ['date', {}, 1709214330123, 'Feb 29, 2024 @ 13:45:30.123'],
    ['date', {}, MIXED, 'Jan 1, 1970 @ 00:00:00.001, two,  - , true'],
  ]);

  it('a date format reads digits as a year, as the Date of the browser does for moment', () => {
    // "42" is the year 2042 on the clock of the browser, not 42 milliseconds after 1970
    assert.match(createFormatter({ id: 'date', params: { pattern: 'YYYY' } }, settings)('42').text, /^204[12]$/);
  });

  writesAsTheOriginal('a duration counts what is no number as moment does: nothing is 0, other text no length of time', [
    ['duration', {}, '', 'a few seconds'],
    ['duration', {}, ' ', 'a few seconds'],
    ['duration', {}, '42', 'a few seconds'],
    ['duration', {}, true, 'a few seconds'],
    ['duration', {}, 'hello world', 'Invalid date'],
    ['duration', {}, Number.NaN, 'Invalid date'],
    ['duration', {}, -3725, 'minus an hour'],
    ['duration', {}, MIXED, 'a few seconds, Invalid date,  - , a few seconds'],
    ['duration', AS_MINUTES, '', '0.00'],
    ['duration', AS_MINUTES, '42', '0.70'],
    ['duration', AS_MINUTES, 'hello world', 'NaN'],
    ['duration', AS_MINUTES, Number.NaN, 'NaN'],
  ]);

  writesAsTheOriginal('an address is written of all that reads as a number, an empty text too', [
    ['ip', {}, '', '0.0.0.0'],
    ['ip', {}, ' ', '0.0.0.0'],
    ['ip', {}, '42', '0.0.0.42'],
    ['ip', {}, true, '0.0.0.1'],
    ['ip', {}, 3232235777.9, '192.168.1.1'],
    ['ip', {}, 8589934597, '0.0.0.5'],
    ['ip', {}, -1, '255.255.255.255'],
    ['ip', {}, 'hello world', 'hello world'],
    ['ip', {}, '192.168.1.1', '192.168.1.1'],
    ['ip', {}, Number.NaN, 'NaN'],
    ['ip', {}, Infinity, 'Infinity'],
  ]);

  writesAsTheOriginal('no value in a list is a dash with a space each side, under every format', [
    ['ip', {}, [null], ' - '],
    ['ip', {}, MIXED, '0.0.0.1, two,  - , 0.0.0.1'],
    ['number', {}, [null], ' - '],
    ['number', {}, MIXED, '1, ,  - , '],
    ['string', {}, MIXED, '1, two,  - , true'],
    ['truncate', { fieldLength: 5 }, MIXED, '1, two,  - , true'],
  ]);

  writesAsTheOriginal('minus zero and an object are written as lodash writes them under truncate, lookup and some texts', [
    ['truncate', { fieldLength: 5 }, -0, '-0'],
    ['truncate', { fieldLength: 5 }, OBJECT, '[obje...'],
    ['truncate', { fieldLength: 5 }, true, 'true'],
    ['static_lookup', LOOKUP, -0, '-0'],
    ['static_lookup', LOOKUP, OBJECT, '[object Object]'],
    ['static_lookup', LOOKUP, 1, 'one'],
    ['static_lookup', LOOKUP, true, 'yes!'],
    ['string', { transform: 'short' }, -0, '-0'],
    ['string', { transform: 'short' }, OBJECT, '[object Object]'],
    ['string', { transform: 'short' }, 1234.5678, '1234.5678'],
    ['string', { transform: 'short' }, 'com.example.very.long.name', 'c.e.v.l.name'],
    ['string', { transform: 'lower' }, OBJECT, '[object object]'],
    ['string', { transform: 'upper' }, OBJECT, '[OBJECT OBJECT]'],
    ['string', { transform: 'urlparam' }, OBJECT, '[object Object]'],
    ['string', { transform: 'base64' }, 1, '1'],
    // and as JSON, with the zero plain, where the original writes them so
    ['string', {}, -0, '0'],
    ['string', {}, OBJECT, JSON.stringify(OBJECT, null, 2)],
    ['string', { transform: 'lower' }, -0, '0'],
    ['number', {}, -0, '0'],
  ]);

  it('a link is made of minus zero and of an object as the original makes it', () => {
    const parsedUrl = { origin: 'http://h.test', pathname: '/app/home', basePath: '' };
    const url = createFormatter({ id: 'url' }, { ...settings, parsedUrl });
    assert.deepEqual([url(-0).text, url(-0).href], ['-0', 'http://h.test/app/-0']);
    assert.deepEqual([url(OBJECT).text, url(OBJECT).href], ['[object Object]', 'http://h.test/app/[object Object]']);
  });
});

describe('a value read as moment reads it', () => {
  const NOW = Date.UTC(2026, 10, 23, 4, 41, 44, 896);
  const read = (value: unknown, zone: string) => readMoment(value, zone, NOW)?.toISOString();

  it('reads ISO 8601 on the clock of the zone when it names no offset', () => {
    const rows: Array<[value: unknown, paris: string | undefined, newYork: string | undefined]> = [
      ['2024-02-29 13:45:30', '2024-02-29T12:45:30.000Z', '2024-02-29T18:45:30.000Z'],
      // An hour the clocks skip in one zone, one they show twice in the other
      ['2024-03-31T02:30:00', '2024-03-31T01:30:00.000Z', '2024-03-31T06:30:00.000Z'],
      ['2024-10-27T02:30:00', '2024-10-27T00:30:00.000Z', '2024-10-27T06:30:00.000Z'],
      ['2024-03-10T02:30:00', '2024-03-10T01:30:00.000Z', '2024-03-10T07:30:00.000Z'],
      ['2024-11-03T01:30:00', '2024-11-03T00:30:00.000Z', '2024-11-03T05:30:00.000Z'],
      ['20240229T134530.123Z', '2024-02-29T13:45:30.123Z', '2024-02-29T13:45:30.123Z'],
      ['2024-02-29T13:45:30+0530', '2024-02-29T08:15:30.000Z', '2024-02-29T08:15:30.000Z'],
      // A week, a day of the year, a year alone, the end of a day
      ['2024-W09-4', '2024-02-28T23:00:00.000Z', '2024-02-29T05:00:00.000Z'],
      ['2024-060', '2024-02-28T23:00:00.000Z', '2024-02-29T05:00:00.000Z'],
      ['2024', '2023-12-31T23:00:00.000Z', '2024-01-01T05:00:00.000Z'],
      ['2024-02-29T24:00', '2024-02-29T23:00:00.000Z', '2024-03-01T05:00:00.000Z'],
      // What is in a form but is no date is none, whatever the browser would make of it
      ['2024-02-30', undefined, undefined],
      ['2024-13-01', undefined, undefined],
      ['2024-W53-1', undefined, undefined],
    ];
    assert.deepEqual(
      rows.map(([value]) => [read(value, 'Europe/Paris'), read(value, 'America/New_York')]),
      rows.map(([, paris, newYork]) => [paris, newYork])
    );
  });

  it('reads RFC 2822, a count of milliseconds, and units; and nothing in the rest', () => {
    const rows: Array<[value: unknown, expected: string | undefined]> = [
      ['Thu, 29 Feb 2024 13:45:30 +0000', '2024-02-29T13:45:30.000Z'],
      ['29 Feb 2024 13:45 EST', '2024-02-29T18:45:00.000Z'],
      // The day of the week is not that date's
      ['Fri, 29 Feb 2024 13:45:30 GMT', undefined],
      ['/Date(1709214330123)/', '2024-02-29T13:45:30.123Z'],
      [-0, '1970-01-01T00:00:00.000Z'],
      [{ year: 2024, month: 1, day: 29 }, '2024-02-28T23:00:00.000Z'],
      [{ y: 2024, M: 1, D: 29, h: 13, m: 45, s: 30, ms: 123 }, '2024-02-29T12:45:30.123Z'],
      [[2024, 1, 29], '2024-02-28T23:00:00.000Z'],
      // No unit named: now; none that it knows: the start of today in the zone
      [{}, '2026-11-23T04:41:44.896Z'],
      [{ a: 1 }, '2026-11-22T23:00:00.000Z'],
      [{ year: 2024, month: 12 }, undefined],
      ['hello', undefined],
      ['1709214330123', undefined],
      ['', undefined],
      [8640000000000001, undefined],
      [Number.NaN, undefined],
      [Infinity, undefined],
      [true, undefined],
    ];
    assert.deepEqual(
      rows.map(([value]) => read(value, 'Europe/Paris')),
      rows.map(([, expected]) => expected)
    );
  });

  it('says how long ago by the months on the calendar, as moment does', () => {
    const now = new Date(Date.UTC(2026, 2, 31, 12, 0, 0));
    const rows: Array<[iso: string, expected: string]> = [
      // A month of the calendar and the days over it, where a count of days alone says a month
      ['2026-02-14T00:00:00Z', '2 months ago'],
      ['2026-03-06T12:00:00Z', '25 days ago'],
      ['2026-03-05T12:00:00Z', 'a month ago'],
      ['2025-04-30T12:00:00Z', 'a year ago'],
      ['2026-03-31T12:00:45Z', 'in a minute'],
      ['2026-03-31T11:59:16Z', 'a few seconds ago'],
      ['2027-09-30T12:00:00Z', 'in 2 years'],
    ];
    assert.deepEqual(
      rows.map(([iso]) => fromNow(new Date(iso), now, 'Europe/Paris')),
      rows.map(([, expected]) => expected)
    );
  });
});

/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Dates written with the tokens of moment, as a date format setting or a field's pattern may hold
 * them. Each value below is what the original's moment (moment-timezone, moment 2.29.4) writes:
 * moment.tz(iso, zone).format(pattern).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatDate, setDefaultTimeZone, setDefaultWeekStart } from '../../web/lib/dates';
import { createServices, type BootData } from '../../web/services';

type Row = [zone: string, iso: string, expected: string[]];

function writesAsMoment(title: string, patterns: string[], rows: Row[]): void {
  describe(title, () => {
    for (const [zone, iso, expected] of rows) {
      it(`${iso} in ${zone}`, () => {
        assert.deepEqual(
          patterns.map((pattern) => formatDate(new Date(iso), pattern, zone)),
          expected
        );
      });
    }
  });
}

writesAsMoment(
  'the long formats, quarters, days of the year and of the week, weeks, hours from 1 to 24 and zones',
  ['LLLL', 'LTS', 'L', 'llll', 'Q', 'Qo', 'DDDD', 'DDD', 'DDDo', 'd', 'dd', 'do', 'e', 'E', 'w', 'ww', 'W', 'WW', 'gggg', 'GGGG', 'k', 'kk', 'z', 'Mo', 'SSSS', 'YYYYY', 'Y', 'N', '[Week] W, YYYY'],
  [
    ['UTC', '2026-11-23T04:05:06.789Z', ['Monday, November 23, 2026 4:05 AM', '4:05:06 AM', '11/23/2026', 'Mon, Nov 23, 2026 4:05 AM', '4', '4th', '327', '327', '327th', '1', 'Mo', '1st', '1', '1', '48', '48', '48', '48', '2026', '2026', '4', '04', 'UTC', '11th', '7890', '02026', '2026', 'AD', 'Week 48, 2026']],
    ['UTC', '2026-01-01T00:00:00.000Z', ['Thursday, January 1, 2026 12:00 AM', '12:00:00 AM', '01/01/2026', 'Thu, Jan 1, 2026 12:00 AM', '1', '1st', '001', '1', '1st', '4', 'Th', '4th', '4', '4', '1', '01', '1', '01', '2026', '2026', '24', '24', 'UTC', '1st', '0000', '02026', '2026', 'AD', 'Week 1, 2026']],
    ['UTC', '2026-12-31T23:59:59.999Z', ['Thursday, December 31, 2026 11:59 PM', '11:59:59 PM', '12/31/2026', 'Thu, Dec 31, 2026 11:59 PM', '4', '4th', '365', '365', '365th', '4', 'Th', '4th', '4', '4', '1', '01', '53', '53', '2027', '2026', '23', '23', 'UTC', '12th', '9990', '02026', '2026', 'AD', 'Week 53, 2026']],
    ['UTC', '2027-03-14T07:30:00.000Z', ['Sunday, March 14, 2027 7:30 AM', '7:30:00 AM', '03/14/2027', 'Sun, Mar 14, 2027 7:30 AM', '1', '1st', '073', '73', '73rd', '0', 'Su', '0th', '0', '7', '12', '12', '10', '10', '2027', '2027', '7', '07', 'UTC', '3rd', '0000', '02027', '2027', 'AD', 'Week 10, 2027']],
    ['America/New_York', '2026-11-23T04:05:06.789Z', ['Sunday, November 22, 2026 11:05 PM', '11:05:06 PM', '11/22/2026', 'Sun, Nov 22, 2026 11:05 PM', '4', '4th', '326', '326', '326th', '0', 'Su', '0th', '0', '7', '48', '48', '47', '47', '2026', '2026', '23', '23', 'EST', '11th', '7890', '02026', '2026', 'AD', 'Week 47, 2026']],
    ['America/New_York', '2026-01-01T00:00:00.000Z', ['Wednesday, December 31, 2025 7:00 PM', '7:00:00 PM', '12/31/2025', 'Wed, Dec 31, 2025 7:00 PM', '4', '4th', '365', '365', '365th', '3', 'We', '3rd', '3', '3', '1', '01', '1', '01', '2026', '2026', '19', '19', 'EST', '12th', '0000', '02025', '2025', 'AD', 'Week 1, 2025']],
    ['America/New_York', '2026-12-31T23:59:59.999Z', ['Thursday, December 31, 2026 6:59 PM', '6:59:59 PM', '12/31/2026', 'Thu, Dec 31, 2026 6:59 PM', '4', '4th', '365', '365', '365th', '4', 'Th', '4th', '4', '4', '1', '01', '53', '53', '2027', '2026', '18', '18', 'EST', '12th', '9990', '02026', '2026', 'AD', 'Week 53, 2026']],
    ['America/New_York', '2027-03-14T07:30:00.000Z', ['Sunday, March 14, 2027 3:30 AM', '3:30:00 AM', '03/14/2027', 'Sun, Mar 14, 2027 3:30 AM', '1', '1st', '073', '73', '73rd', '0', 'Su', '0th', '0', '7', '12', '12', '10', '10', '2027', '2027', '3', '03', 'EDT', '3rd', '0000', '02027', '2027', 'AD', 'Week 10, 2027']],
  ]
);

writesAsMoment(
  'years of the era and of the weeks, ordinal weeks, eras, fractions of the second and a long format with text',
  ['yo', 'yyyy', 'gg', 'GG', 'wo', 'Wo', 'NNNN', 'S', 'SS', 'SSSSSSSSS', 'YYYYYY', 'LLLL[!]'],
  [
    ['UTC', '2021-01-03T12:00:00.005Z', ['2021st', '2021', '21', '20', '2nd', '53rd', 'Anno Domini', '0', '00', '005000000', '+002021', 'Sunday, January 3, 2021 12:00 PM!']],
    ['UTC', '2026-12-31T23:59:59.999Z', ['2026th', '2026', '27', '26', '1st', '53rd', 'Anno Domini', '9', '99', '999000000', '+002026', 'Thursday, December 31, 2026 11:59 PM!']],
    ['America/New_York', '2021-01-03T12:00:00.005Z', ['2021st', '2021', '21', '20', '2nd', '53rd', 'Anno Domini', '0', '00', '005000000', '+002021', 'Sunday, January 3, 2021 7:00 AM!']],
    ['America/New_York', '2026-12-31T23:59:59.999Z', ['2026th', '2026', '27', '26', '1st', '53rd', 'Anno Domini', '9', '99', '999000000', '+002026', 'Thursday, December 31, 2026 6:59 PM!']],
  ]
);

// moment.tz(iso, zone).format('z') of the original's moment-timezone 0.5.37 (tz database 2022c)
describe("the short name of a zone, as moment-timezone's data names it where a browser writes GMT+1", () => {
  const rows: Array<[zone: string, iso: string, expected: string]> = [
    ['Europe/Paris', '2024-01-14T17:00:00.000Z', 'CET'],
    ['Europe/Paris', '2024-07-15T20:00:00.000Z', 'CEST'],
    ['Asia/Kolkata', '2024-01-14T17:00:00.000Z', 'IST'],
    ['America/Sao_Paulo', '2024-01-14T17:00:00.000Z', '-03'],
    ['America/Sao_Paulo', '1990-02-10T06:00:00.000Z', '-02'],
    ['Europe/London', '2024-07-15T20:00:00.000Z', 'BST'],
    // British Standard Time, an hour ahead all year: the same name for another offset in another era
    ['Europe/London', '1970-01-21T06:00:00.000Z', 'BST'],
    ['Australia/Sydney', '2024-01-14T17:00:00.000Z', 'AEDT'],
    // Three hours ahead as now, when it was the summer's name, and four hours ahead all year
    ['Europe/Moscow', '2012-07-03T20:00:00.000Z', 'MSK'],
    ['Europe/Moscow', '2024-07-15T20:00:00.000Z', 'MSK'],
    ['Europe/Moscow', '1985-08-07T03:00:00.000Z', 'MSD'],
    ['UTC', '2024-01-14T17:00:00.000Z', 'UTC'],
    ['Etc/GMT+5', '2024-01-14T17:00:00.000Z', '-05'],
    ['Asia/Tokyo', '2024-01-14T17:00:00.000Z', 'JST'],
    ['Africa/Lagos', '2024-01-14T17:00:00.000Z', 'WAT'],
    ['America/New_York', '2024-07-15T20:00:00.000Z', 'EDT'],
    ['Pacific/Chatham', '2024-01-14T17:00:00.000Z', '+1345'],
    ['Asia/Kathmandu', '2024-01-14T17:00:00.000Z', '+0545'],
  ];

  it('is the name of the offset in the era of the moment', () => {
    assert.deepEqual(
      rows.map(([zone, iso]) => formatDate(new Date(iso), 'z', zone)),
      rows.map(([, , expected]) => expected)
    );
    assert.equal(formatDate(new Date('2024-01-14T17:00:00.000Z'), 'HH:mm z zz', 'Europe/Paris'), '18:00 CET CET');
  });

  it('is none for the zone of the browser, as moment gives none', () => {
    assert.equal(formatDate(new Date('2024-01-14T17:00:00.000Z'), '[<]z[>]'), '<>');
  });
});

// moment.utc(iso).format(...) after moment.updateLocale('en', { week: { dow } }), as the original sets
// the first day of the week from the setting dateFormat:dow
describe('the weeks of a written date, from the day the setting dateFormat:dow names', () => {
  const pattern = 'w ww wo e gg gggg d E W GGGG';
  const rows: Array<[dow: number, iso: string, expected: string]> = [
    [0, '2021-01-02T12:00:00.000Z', '1 01 1st 6 21 2021 6 6 53 2020'],
    [0, '2024-12-29T12:00:00.000Z', '1 01 1st 0 25 2025 0 7 52 2024'],
    [0, '2026-01-01T12:00:00.000Z', '1 01 1st 4 26 2026 4 4 1 2026'],
    [0, '2027-01-03T12:00:00.000Z', '2 02 2nd 0 27 2027 0 7 53 2026'],
    [0, '2026-11-23T12:00:00.000Z', '48 48 48th 1 26 2026 1 1 48 2026'],
    [1, '2021-01-02T12:00:00.000Z', '1 01 1st 5 21 2021 6 6 53 2020'],
    [1, '2024-12-29T12:00:00.000Z', '52 52 52nd 6 24 2024 0 7 52 2024'],
    [1, '2026-01-01T12:00:00.000Z', '1 01 1st 3 26 2026 4 4 1 2026'],
    [1, '2027-01-03T12:00:00.000Z', '1 01 1st 6 27 2027 0 7 53 2026'],
    [1, '2026-11-23T12:00:00.000Z', '48 48 48th 0 26 2026 1 1 48 2026'],
    [6, '2021-01-02T12:00:00.000Z', '1 01 1st 0 21 2021 6 6 53 2020'],
    [6, '2024-12-29T12:00:00.000Z', '52 52 52nd 1 24 2024 0 7 52 2024'],
    [6, '2026-01-01T12:00:00.000Z', '52 52 52nd 5 25 2025 4 4 1 2026'],
    [6, '2027-01-03T12:00:00.000Z', '1 01 1st 1 27 2027 0 7 53 2026'],
    [6, '2026-11-23T12:00:00.000Z', '47 47 47th 2 26 2026 1 1 48 2026'],
  ];

  it('counts the week of the year, its year and the day of the week from that day; ISO weeks stay', () => {
    try {
      assert.deepEqual(
        rows.map(([dow, iso]) => {
          setDefaultWeekStart(dow);
          return formatDate(new Date(iso), pattern, 'UTC');
        }),
        rows.map(([, , expected]) => expected)
      );
    } finally {
      setDefaultWeekStart(0);
    }
  });

  it('follows the setting from the start and when it changes', async () => {
    // The server of the settings: it keeps what is posted and answers with all it keeps
    const stored: Record<string, unknown> = { 'dateFormat:dow': 'Monday' };
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
    const week = () => formatDate(new Date('2024-12-29T12:00:00.000Z'), 'w e gggg', 'UTC');
    try {
      const boot = { basePath: '', version: '3.9.0', name: 'test', settings: { ...stored }, settingsDefaults: {}, settingsOverrides: {} };
      const { uiSettings } = createServices(boot as unknown as BootData);
      assert.equal(week(), '52 6 2024');
      await uiSettings.set('dateFormat:dow', 'Saturday');
      assert.equal(week(), '52 1 2024');
      await uiSettings.remove('dateFormat:dow');
      assert.equal(week(), '1 0 2025');
    } finally {
      globalThis.fetch = original;
      setDefaultWeekStart(0);
      setDefaultTimeZone(undefined);
    }
  });
});

/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Dates written with the tokens of moment, as a date format setting or a field's pattern may hold
 * them. Each value below is what the original's moment (moment-timezone, moment 2.29.4) writes:
 * moment.tz(iso, zone).format(pattern).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatDate } from '../../web/lib/dates';

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

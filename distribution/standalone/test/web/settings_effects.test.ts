/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { dimmingOpacity } from '../../web/charts/core';
import {
  DEFAULT_SCALED_DATE_RULES,
  isoDurationMs,
  scaledDateFormat,
  scaledDateRules,
  UNIT_MS,
} from '../../web/lib/dates';
import { createFormatter, DEFAULT_FORMAT_SETTINGS, formatDateNanos } from '../../web/lib/field_formats';
import { requestPreference } from '../../web/services/search';
import { userBannerOf } from '../../web/shell/user_banner';

describe('the preference a search names', () => {
  it('is the id of the visit, the custom one, or none, as the courier settings say', () => {
    assert.equal(requestPreference('sessionId', '_local', '1700000000000'), '1700000000000');
    assert.equal(requestPreference('custom', '_local', '1700000000000'), '_local');
    assert.equal(requestPreference('custom', '_only_nodes:a', '1'), '_only_nodes:a');
    assert.equal(requestPreference('custom', '', '1'), undefined);
    assert.equal(requestPreference('none', '_local', '1'), undefined);
    assert.equal(requestPreference(undefined, '_local', '1'), undefined);
  });
});

describe('the custom banner', () => {
  it('is shown only with a text and a lifetime that is a number', () => {
    assert.equal(userBannerOf('', 3000000), undefined);
    assert.equal(userBannerOf(undefined, 3000000), undefined);
    assert.equal(userBannerOf('Hello', undefined), undefined);
    assert.deepEqual(userBannerOf('  **Hello**  ', 3000000), { text: '**Hello**', closesAfter: 3000000 });
  });

  it('closes after its lifetime, at once for none, and never for Infinity as its description says', () => {
    assert.equal(userBannerOf('x', 0)?.closesAfter, 0);
    assert.equal(userBannerOf('x', -5)?.closesAfter, 0);
    assert.equal(userBannerOf('x', Number.NaN)?.closesAfter, 0);
    assert.equal(userBannerOf('x', Infinity)?.closesAfter, undefined);
    assert.equal(userBannerOf('x', 2 ** 31)?.closesAfter, undefined);
  });
});

describe('the dimming of the series not hovered', () => {
  it('is the setting when it is an opacity, else a half', () => {
    assert.equal(dimmingOpacity(0.5), 0.5);
    assert.equal(dimmingOpacity(0), 0);
    assert.equal(dimmingOpacity(1), 1);
    assert.equal(dimmingOpacity('0.2'), 0.2);
    assert.equal(dimmingOpacity(1.5), 0.5);
    assert.equal(dimmingOpacity(-1), 0.5);
    assert.equal(dimmingOpacity('dim'), 0.5);
  });
});

describe('the scaled date format', () => {
  it('reads ISO 8601 durations as moment counts them', () => {
    assert.equal(isoDurationMs('PT1S'), 1000);
    assert.equal(isoDurationMs('PT1M'), 60000);
    assert.equal(isoDurationMs('PT1H'), 3600000);
    assert.equal(isoDurationMs('P1DT'), UNIT_MS.d);
    assert.equal(isoDurationMs('P1YT'), 365 * UNIT_MS.d);
    assert.equal(isoDurationMs('P1M'), 30 * UNIT_MS.d);
    assert.equal(isoDurationMs('P1W'), 7 * UNIT_MS.d);
    assert.equal(isoDurationMs('PT1.5H'), 5400000);
    assert.equal(isoDurationMs('nonsense'), 0);
  });

  it('chooses by the interval, from the last rule back, as the original time buckets do', () => {
    assert.equal(scaledDateFormat(500), 'HH:mm:ss.SSS');
    assert.equal(scaledDateFormat(30000), 'HH:mm:ss');
    assert.equal(scaledDateFormat(UNIT_MS.m * 5), 'HH:mm');
    assert.equal(scaledDateFormat(UNIT_MS.h * 3), 'YYYY-MM-DD HH:mm');
    assert.equal(scaledDateFormat(UNIT_MS.w), 'YYYY-MM-DD');
    assert.equal(scaledDateFormat(UNIT_MS.y), 'YYYY');
  });

  it('follows the rules of the setting, and the date format when none applies', () => {
    const rules = scaledDateRules([
      ['PT1M', 'HH:mm'],
      ['P1DT', 'DD/MM'],
    ]);
    assert.ok(rules);
    assert.equal(scaledDateFormat(UNIT_MS.d * 2, rules, 'D'), 'DD/MM');
    assert.equal(scaledDateFormat(UNIT_MS.h, rules, 'D'), 'HH:mm');
    assert.equal(scaledDateFormat(1000, rules, 'MMM D'), 'MMM D');
    assert.equal(scaledDateRules([['a', 1]]), undefined);
    assert.equal(scaledDateRules('[]'), undefined);
    assert.deepEqual(scaledDateRules(DEFAULT_SCALED_DATE_RULES), DEFAULT_SCALED_DATE_RULES);
  });
});

describe('a date_nanos field', () => {
  const raw = '2020-05-18T20:45:05.957000123Z';
  const date = new Date(raw);

  it('keeps the nanoseconds OpenSearch sent, as the original writes them', () => {
    assert.equal(formatDateNanos(raw, date, 'HH:mm:ss.SSSSSSSSS', 'UTC'), '20:45:05.957000123');
    assert.equal(formatDateNanos(raw, date, 'HH:mm:ss.SSSSSS', 'UTC'), '20:45:05.957000');
    assert.equal(formatDateNanos('2020-05-18T20:45:05.957Z', date, 'ss.SSSSSSSSS', 'UTC'), '05.957000000');
    assert.equal(formatDateNanos(raw, date, 'HH:mm:ss.SSS', 'UTC'), '20:45:05.957');
  });

  it('is written in the setting dateNanosFormat, and a number in the date format', () => {
    const settings = { ...DEFAULT_FORMAT_SETTINGS, timeZone: 'UTC', dateFormat: 'YYYY-MM-DD', dateNanosFormat: 'HH:mm:ss.SSSSSSSSS' };
    const format = createFormatter({ id: 'date_nanos' }, settings);
    assert.equal(format(raw).text, '20:45:05.957000123');
    assert.equal(format(date.getTime()).text, '2020-05-18');
    assert.equal(createFormatter({ id: 'date_nanos' }, { ...DEFAULT_FORMAT_SETTINGS, timeZone: 'UTC' })(raw).text, 'May 18, 2020 @ 20:45:05.957000123');
  });
});

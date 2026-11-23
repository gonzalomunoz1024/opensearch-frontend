/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  formatDate,
  parseDateMath,
  parseInterval,
  resolveInterval,
  resolveTimeRange,
} from '../../web/lib/dates';
import { createFormatter, DEFAULT_FORMAT_SETTINGS, fieldFormatter } from '../../web/lib/field_formats';
import { formatNumber } from '../../web/lib/numeral';
import { buildQuery, describeFilter, phraseFilter, rangeFilter } from '../../web/lib/query';
import { decode, encode } from '../../web/lib/rison';
import type { IndexPattern } from '../../web/lib/types';

describe('rison', () => {
  it('reads the state OpenSearch Dashboards writes into an address', () => {
    assert.deepEqual(
      decode("(filters:!(),refreshInterval:(pause:!t,value:0),time:(from:now-7d,to:now))"),
      { filters: [], refreshInterval: { pause: true, value: 0 }, time: { from: 'now-7d', to: 'now' } }
    );
    assert.deepEqual(decode("(query:(language:kuery,query:'response:200 and it!'s'),n:!n,x:-1.5e3)"), {
      query: { language: 'kuery', query: "response:200 and it's" },
      n: null,
      x: -1500,
    });
  });

  it('writes what it reads', () => {
    const state = {
      columns: ['_source'],
      index: 'ff959d40-b880-11e8-a6d9-e546fe2bba5f',
      interval: 'auto',
      query: { language: 'kuery', query: '' },
      sort: [['order_date', 'desc']],
      on: true,
      count: 12,
    };
    const text = encode(state);
    assert.equal(
      text,
      "(columns:!(_source),count:12,index:ff959d40-b880-11e8-a6d9-e546fe2bba5f,interval:auto,on:!t,query:(language:kuery,query:''),sort:!(!(order_date,desc)))"
    );
    assert.deepEqual(decode(text), state);
  });

  it('quotes what would not read back as text', () => {
    assert.equal(encode('2024'), "'2024'");
    assert.equal(encode('a b'), "'a b'");
    assert.equal(encode("it's"), "'it!'s'");
    assert.equal(encode('now-7d'), 'now-7d');
    assert.throws(() => decode('(a:'), /rison/);
  });
});

describe('dates', () => {
  const now = new Date(2026, 10, 22, 3, 52, 10, 500);

  it('reads the expressions of the time picker', () => {
    assert.equal(parseDateMath('now', { now })!.getTime(), now.getTime());
    assert.equal(parseDateMath('now-15m', { now })!.getTime(), now.getTime() - 15 * 60000);
    assert.equal(parseDateMath('now/d', { now })!.getTime(), new Date(2026, 10, 22).getTime());
    assert.equal(
      parseDateMath('now/d', { now, roundUp: true })!.getTime(),
      new Date(2026, 10, 23).getTime() - 1
    );
    assert.equal(parseDateMath('now-1M/M', { now })!.getTime(), new Date(2026, 9, 1).getTime());
    assert.equal(parseDateMath('now/w', { now })!.getDay(), 0);
    assert.equal(parseDateMath('now/w', { now, weekStart: 1 })!.getDay(), 1);
    assert.equal(parseDateMath('2026-01-01T00:00:00.000Z||+1d')!.toISOString(), '2026-01-02T00:00:00.000Z');
    assert.equal(parseDateMath('now-banana', { now }), undefined);
    assert.equal(parseDateMath('not a date'), undefined);
  });

  it('resolves a range with its end rounded up', () => {
    const range = resolveTimeRange({ from: 'now/d', to: 'now/d' }, { now })!;
    assert.equal(range.to.getTime() - range.from.getTime(), 86400000 - 1);
  });

  it('counts a year from 29 February to the last day of February, as the original does', () => {
    const leapDay = new Date(2024, 1, 29, 12, 0, 0, 0);
    const at = (expression: string) => parseDateMath(expression, { now: leapDay })?.getTime();
    assert.equal(at('now-1y'), new Date(2023, 1, 28, 12).getTime());
    assert.equal(at('now+1y'), new Date(2025, 1, 28, 12).getTime());
    assert.equal(at('now-5y'), new Date(2019, 1, 28, 12).getTime());
    assert.equal(at('now+4y'), new Date(2028, 1, 29, 12).getTime());
    assert.equal(at('now-1y-1M'), new Date(2023, 0, 28, 12).getTime());
    // and any other day of a year stays the day it is
    assert.equal(parseDateMath('now-1y', { now })?.getTime(), new Date(2025, 10, 22, 3, 52, 10, 500).getTime());
    assert.equal(parseDateMath('now+100y', { now })?.getTime(), new Date(2126, 10, 22, 3, 52, 10, 500).getTime());
  });

  it('writes dates with the tokens of the date settings', () => {
    const date = new Date(Date.UTC(2026, 10, 22, 1, 37, 55, 7));
    assert.equal(formatDate(date, 'MMM D, YYYY @ HH:mm:ss.SSS', 'UTC'), 'Nov 22, 2026 @ 01:37:55.007');
    assert.equal(formatDate(date, 'dddd, MMMM Do YYYY, h:mm a', 'UTC'), 'Sunday, November 22nd 2026, 1:37 am');
    assert.equal(formatDate(date, '[at] HH [h]', 'UTC'), 'at 01 h');
    assert.equal(formatDate(date, 'YYYY-MM-DD HH:mm Z', 'America/Chicago'), '2026-11-21 19:37 -06:00');
    assert.equal(formatDate(date, 'YYYY-MM-DD HH:mm', 'Asia/Kolkata'), '2026-11-22 07:07');
  });

  it('gives a histogram the interval OpenSearch Dashboards gives it', () => {
    const day = 86400000;
    assert.equal(resolveInterval('auto', 7 * day).expression, '3h');
    assert.equal(resolveInterval('auto', 15 * 60000).expression, '30s');
    assert.equal(resolveInterval('auto', day).expression, '30m');
    assert.equal(resolveInterval('auto', 30 * day).expression, '12h');
    assert.equal(resolveInterval('auto', 365 * day).expression, '1w');
    assert.equal(resolveInterval('auto', 5 * 365 * day).expression, '1M');
    assert.equal(resolveInterval('auto', 7 * day).description, '3 hours');
    // an interval that would give more than 100 bars is widened, and says so
    const scaled = resolveInterval('1m', 7 * day);
    assert.equal(scaled.expression, '1h');
    assert.equal(scaled.scaled, true);
    assert.equal(resolveInterval('1d', 7 * day).scaled, false);
    assert.equal(parseInterval('1M')!.calendar, true);
    assert.equal(parseInterval('2w')!.calendar, false);
  });
});

describe('numbers', () => {
  it('follows the patterns of the number formats', () => {
    assert.equal(formatNumber(1234.5678, '0,0.[000]'), '1,234.568');
    assert.equal(formatNumber(1234, '0,0.[000]'), '1,234');
    assert.equal(formatNumber(79302.356, '$0,0.00'), '$79,302.36');
    assert.equal(formatNumber(0.4804, '0.[00]%'), '48.04%');
    assert.equal(formatNumber(0.5, '0,0.[000]%'), '50%');
    assert.equal(formatNumber(1536, '0,0.[0]b'), '1.5KB');
    assert.equal(formatNumber(5 * 1024 ** 3, '0,0.[0]b'), '5GB');
    assert.equal(formatNumber(1234567, '0.0a'), '1.2m');
    assert.equal(formatNumber(-12.3, '0.00'), '-12.30');
    assert.equal(formatNumber(-0.001, '0.00'), '0.00');
    assert.equal(formatNumber(-5, '(0)'), '(5)');
    assert.equal(formatNumber(3, '0o'), '3rd');
    assert.equal(formatNumber(2.16, '0.00'), '2.16');
    assert.equal(formatNumber(141, '0'), '141');
  });

  it('formats a field by its format', () => {
    assert.equal(createFormatter({ id: 'number' })(1234.5).text, '1,234.5');
    assert.equal(createFormatter({ id: 'bytes' })(2048).text, '2KB');
    assert.equal(createFormatter({ id: 'string', params: { transform: 'upper' } })('abc').text, 'ABC');
    assert.equal(createFormatter({ id: 'string' })(['a', 'b']).text, 'a, b');
    assert.equal(createFormatter({ id: 'string' })(null).text, '-');
    assert.equal(createFormatter({ id: 'boolean' })(1).text, 'true');
    assert.equal(createFormatter({ id: 'ip' })(3232235777).text, '192.168.1.1');
    const link = createFormatter({ id: 'url', params: { urlTemplate: 'https://x.test/?q={{value}}' } })('a b');
    assert.equal(link.href, 'https://x.test/?q=a%20b');
    assert.equal(createFormatter({ id: 'url' })('javascript:alert(1)').href, undefined);
    const coloured = createFormatter({
      id: 'color',
      params: { fieldType: 'number', colors: [{ range: '500:Infinity', text: '#fff', background: '#f00' }] },
    })(503);
    assert.equal(coloured.background, '#f00');
  });

  it('makes no link a browser would run as a script', () => {
    const url = createFormatter({ id: 'url' });
    const raw = createFormatter({ id: 'url', params: { urlTemplate: '{{rawValue}}', labelTemplate: 'open' } });
    // A browser drops tabs and line ends inside an address, and control characters and spaces around it
    for (const value of [
      'java\tscript:alert(1)',
      'java\nscript:alert(1)',
      'jav\r\nascript:alert(1)',
      '\u0001javascript:alert(1)',
      ' \u0000\u001f javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'vbscript:x',
      'data:text/html,<script>alert(1)</script>',
    ]) {
      assert.equal(url(value).href, undefined, JSON.stringify(value));
      assert.equal(raw(value).href, undefined, JSON.stringify(value));
      assert.equal(createFormatter({ id: 'url', params: { type: 'img' } })(value).image, undefined, JSON.stringify(value));
    }
    // What is no scheme stays a link
    assert.equal(url(' https://x.test/a ').href, 'https://x.test/a');
    assert.equal(raw(' https://x.test/a\tb ').href, 'https://x.test/ab');
    assert.equal(raw('a/b:c').href, 'a/b:c');
    assert.equal(raw('#/doc?x=java\tscript:1').href, '#/doc?x=javascript:1');
  });

  it('colours a value by the last rule that matches, as the original', () => {
    const grey = { text: '#111', background: '#eee' };
    const red = { text: '#f00', background: '#fee' };
    const byNumber = createFormatter({
      id: 'color',
      params: { fieldType: 'number', colors: [{ range: '0:100000', ...grey }, { range: '5000:100000', ...red }] },
    });
    assert.equal(byNumber(7000).color, '#f00');
    assert.equal(byNumber(7000).background, '#fee');
    assert.equal(byNumber(100).color, '#111');
    assert.equal(byNumber(-1).color, undefined);
    const byText = createFormatter({
      id: 'color',
      params: { fieldType: 'string', colors: [{ regex: '^2', ...grey }, { regex: '0', ...red }] },
    });
    assert.equal(byText('200').color, '#f00');
    assert.equal(byText('211').color, '#111');
    assert.equal(byText('404').color, '#f00');
    assert.equal(byText('311').color, undefined);
    // An end left out is zero, as Number reads it, and a rule without a pattern matches every text
    const ends = createFormatter({ id: 'color', params: { fieldType: 'number', colors: [{ range: ':100', ...red }] } });
    assert.equal(ends(50).color, '#f00');
    assert.equal(ends(-50).color, undefined);
    assert.equal(createFormatter({ id: 'color', params: { fieldType: 'number', colors: [{ range: '500:', ...red }] } })(503).color, undefined);
    assert.equal(createFormatter({ id: 'color', params: { fieldType: 'string', colors: [{ regex: '', ...red }] } })('any').color, '#f00');
    assert.equal(createFormatter({ id: 'color', params: { fieldType: 'string', colors: [{ ...red }] } })('any').color, '#f00');
    // Without the kind of field its editor saves with it, nothing is coloured
    assert.equal(createFormatter({ id: 'color', params: { colors: [{ range: '0:100', ...red }] } })(50).color, undefined);
  });

  it('reads text as a boolean as the original: trimmed, in lower case, and not from "1" or "0"', () => {
    const boolean = createFormatter({ id: 'boolean' });
    assert.deepEqual(
      [true, 1, 'true', 'yes', ' YES ', 'True'].map((value) => boolean(value).text),
      ['true', 'true', 'true', 'true', 'true', 'true']
    );
    assert.deepEqual(
      [false, 0, 'false', 'no', 'No', ' FALSE\n'].map((value) => boolean(value).text),
      ['false', 'false', 'false', 'false', 'false', 'false']
    );
    assert.deepEqual(
      ['1', '0', 'US', ' Maybe ', 2, -1].map((value) => boolean(value).text),
      ['1', '0', 'us', 'maybe', '2', '-1']
    );
  });

  it('looks a value up as the original: an empty answer is no answer', () => {
    const entries = [{ key: 'css', value: 'Style sheet' }, { key: 'gz', value: '' }, { key: 'deb' }, { key: 404, value: 'Not found' }, {}];
    // What the original's editor saves once the text for the others was typed and cleared
    const cleared = createFormatter({ id: 'static_lookup', params: { lookupEntries: entries, unknownKeyValue: '' } });
    assert.deepEqual(
      ['css', 'gz', 'deb', 'png', 404, '404'].map((value) => cleared(value).text),
      ['Style sheet', 'gz', 'deb', 'png', 'Not found', 'Not found']
    );
    const others = createFormatter({ id: 'static_lookup', params: { lookupEntries: entries, unknownKeyValue: 'other' } });
    assert.deepEqual(
      ['css', 'gz', 'deb', 'png'].map((value) => others(value).text),
      ['Style sheet', 'other', 'other', 'other']
    );
    assert.equal(createFormatter({ id: 'static_lookup', params: { lookupEntries: entries, unknownKeyValue: null } })('png').text, 'png');
    assert.equal(createFormatter({ id: 'static_lookup' })('png').text, 'png');
  });

  it('writes an empty text with its format, as the original does, and no value at all as a dash', () => {
    // An empty term is a bucket of its own: its cell, its label and the pill of its filter
    const others = createFormatter({ id: 'static_lookup', params: { lookupEntries: [{ key: 'css', value: 'Style sheet' }], unknownKeyValue: 'other' } });
    assert.equal(others('').text, 'other');
    assert.deepEqual(
      ['string', 'number', 'bytes', 'date', 'boolean'].map((id) => createFormatter({ id })('').text),
      ['', '', '', '', '']
    );
    assert.equal(createFormatter({ id: 'string' })(['a', '']).text, 'a, ');
    const link = createFormatter({ id: 'url', params: { urlTemplate: 'http://example.com/{{value}}' } })('');
    assert.deepEqual([link.text, link.href], ['http://example.com/', 'http://example.com/']);
    assert.equal(createFormatter({ id: 'string' })(null).text, '-');
  });
});

const pattern: IndexPattern = {
  id: 'logs',
  title: 'logs-*',
  timeFieldName: '@timestamp',
  fieldFormatMap: {},
  fields: [
    { name: '@timestamp', type: 'date', searchable: true, aggregatable: true },
    { name: 'response', type: 'string', esTypes: ['keyword'], searchable: true, aggregatable: true },
    { name: 'bytes', type: 'number', searchable: true, aggregatable: true },
    { name: 'machine.os', type: 'string', searchable: true, aggregatable: true },
    { name: 'machine.ram', type: 'number', searchable: true, aggregatable: true },
    {
      name: 'items.name',
      type: 'string',
      searchable: true,
      aggregatable: true,
      subType: { nested: { path: 'items' } },
    },
  ],
};

describe('the formatter of a field', () => {
  it('follows the settings it is given, as the original reads them at each value', () => {
    const before = { ...DEFAULT_FORMAT_SETTINGS };
    const after = { ...DEFAULT_FORMAT_SETTINGS, numberPattern: '0.00', bytesPattern: '0.000b' };
    assert.equal(fieldFormatter(pattern, 'machine.ram', before)(1234.5).text, '1,234.5');
    // format:number:defaultPattern changed in the settings, the page not loaded again
    assert.equal(fieldFormatter(pattern, 'machine.ram', after)(1234.5).text, '1234.50');
    const typeMap = { ...DEFAULT_FORMAT_SETTINGS.defaultTypeMap, number: { id: 'bytes', params: {} } };
    assert.equal(fieldFormatter(pattern, 'machine.ram', { ...after, defaultTypeMap: typeMap })(2048).text, '2.000KB');
    // the same settings give the same formatter
    assert.equal(fieldFormatter(pattern, 'machine.ram', after), fieldFormatter(pattern, 'machine.ram', after));
  });
});

describe('the query of a page', () => {
  it('combines the search bar and the filters', () => {
    const negated = phraseFilter({ name: 'machine.os' }, 'ios', 'logs');
    negated.meta.negate = true;
    const disabled = phraseFilter({ name: 'response' }, '500', 'logs');
    disabled.meta.disabled = true;
    const query = buildQuery(pattern, { query: 'response:200', language: 'kuery' }, [
      rangeFilter({ name: 'bytes' }, { gte: 100, lt: 200 }, 'logs'),
      negated,
      disabled,
    ]);
    assert.deepEqual(query, {
      bool: {
        must: [],
        filter: [
          { bool: { should: [{ match: { response: 200 } }], minimum_should_match: 1 } },
          { range: { bytes: { gte: 100, lt: 200 } } },
        ],
        should: [],
        must_not: [{ match_phrase: { 'machine.os': 'ios' } }],
      },
    });
  });

  it('sends Lucene as a query string', () => {
    assert.deepEqual(buildQuery(pattern, { query: 'response:200 OR fox', language: 'lucene' }).bool.must, [
      { query_string: { query: 'response:200 OR fox', analyze_wildcard: true } },
    ]);
    assert.deepEqual(buildQuery(pattern, { query: '', language: 'lucene' }).bool.must, [{ match_all: {} }]);
    assert.deepEqual(buildQuery(pattern, { query: '', language: 'kuery' }).bool.filter, [{ match_all: {} }]);
  });

  it('reads a phrase filter saved in the old form', () => {
    const old = {
      meta: { key: 'response', negate: false, disabled: false },
      query: { match: { response: { query: '200', type: 'phrase' } } },
    };
    assert.deepEqual(buildQuery(pattern, undefined, [old]).bool.filter, [
      { match_phrase: { response: { query: '200' } } },
    ]);
  });

  it('describes a filter for its pill', () => {
    assert.deepEqual(describeFilter(phraseFilter({ name: 'response' }, '200')), { key: 'response', value: '200' });
    assert.deepEqual(describeFilter(rangeFilter({ name: 'bytes' }, { gte: 1, lt: 5 })), {
      key: 'bytes',
      value: '1 to 5',
    });
  });
});

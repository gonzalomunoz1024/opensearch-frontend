/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { metricAggs, metricBackground, metricRule, seriesLines, termLabel, timeAxisPattern, tooManyBuckets, topNRows, type ColorRule, type TimeBucket, type TsvbMetric, type TsvbSeries, type TsvbSeriesData } from '../../web/vis/tsvb/data';
import { convertSeriesToVars } from '../../web/vis/tsvb/markdown_vars';

const HOUR = 3600000;

/** A bucket of a date histogram, its aggregations as OpenSearch answers them */
const bucket = (at: number, aggs: Record<string, unknown>): TimeBucket => ({ key: at * HOUR, doc_count: 1, ...aggs });

const seriesOf = (...metrics: TsvbMetric[]): TsvbSeries => ({ id: 's', metrics });

describe('what a TSVB series asks OpenSearch for its percentiles', () => {
  it('asks each percentile, one with no value as 0, and the percentiles the bands fill down to', () => {
    const line = metricAggs([{ id: 'p', type: 'percentile', field: 'bytes', percentiles: [{ id: 'a', value: 50, mode: 'line' }, { id: 'b', value: '', mode: 'line' }] }], undefined);
    assert.deepEqual(line, { p: { percentiles: { field: 'bytes', percents: [50, 0] } } });
    const band = metricAggs(
      [{ id: 'p', type: 'percentile', field: 'bytes', percentiles: [{ id: 'a', value: 50, mode: 'line', percentile: '5' }, { id: 'b', value: '90', mode: 'band', percentile: '10' }] }],
      undefined
    );
    assert.deepEqual(band, { p: { percentiles: { field: 'bytes', percents: [50, 90, '5', '10'] } } });
  });

  it('asks each percentile rank, one left empty as 0, and nothing for a metric with none', () => {
    assert.deepEqual(metricAggs([{ id: 'r', type: 'percentile_rank', field: 'bytes', values: ['5000', '', '10'] }], undefined), {
      r: { percentile_ranks: { field: 'bytes', values: ['5000', 0, '10'] } },
    });
    assert.deepEqual(metricAggs([{ id: 'r', type: 'percentile_rank', field: 'bytes' }], undefined), {});
    assert.deepEqual(metricAggs([{ id: 'p', type: 'percentile', field: 'bytes' }], undefined), {});
  });
});

describe('the lines a split of a TSVB series draws', () => {
  const percentiles: TsvbMetric = {
    id: 'p',
    type: 'percentile',
    field: 'bytes',
    percentiles: [
      { id: 'a', value: 50, mode: 'line', shade: 0.2 },
      { id: 'b', value: '90', mode: 'band', percentile: '10', shade: '0.3' },
      { id: 'c', value: '', mode: 'line' },
    ],
  };
  const buckets = [
    bucket(0, { p: { values: { '0.0': 1, '10.0': 2, '50.0': 5, '90.0': 9 } } }),
    bucket(1, { p: { values: { '0.0': null, '10.0': null, '50.0': null, '90.0': null } } }),
  ];

  it('draws a line for each percentile, named by its value, and a band down to the one it fills to', () => {
    const lines = seriesLines(seriesOf(percentiles), buckets, HOUR);
    assert.deepEqual(
      lines.map(({ key, suffix, points, band }) => ({ key, suffix, points, band })),
      [
        { key: 'a', suffix: ' (50)', points: [[0, 5], [HOUR, null]], band: undefined },
        { key: 'b', suffix: '', points: [[0, 9, 2], [HOUR, null, null]], band: { fill: 0.3, upper: ' (90)', lower: ' (10)' } },
        { key: 'c', suffix: ' (0)', points: [[0, 1], [HOUR, null]], band: undefined },
      ]
    );
  });

  it('shows the last percentile alone in a table, under the key the product looks for', () => {
    assert.deepEqual(seriesLines(seriesOf({ ...percentiles, percentiles: percentiles.percentiles?.slice(0, 2) }), buckets, HOUR, true), [
      { suffix: '', points: [[0, 9], [HOUR, null]] },
    ]);
    // A percentile with no value is asked as 0, but looked for under ".0", as the product's table does
    assert.deepEqual(seriesLines(seriesOf(percentiles), buckets, HOUR, true)[0].points, [[0, null], [HOUR, null]]);
  });

  it('draws a line for each percentile rank, and the last alone in a table; an empty one has no values', () => {
    const ranks: TsvbMetric = { id: 'r', type: 'percentile_rank', field: 'bytes', values: ['5000', '10000.5', ''] };
    const answer = [bucket(0, { r: { values: { '0.0': 1, '5000.0': 40, '10000.5': 80 } } })];
    assert.deepEqual(seriesLines(seriesOf(ranks), answer, HOUR), [
      { key: '5000', suffix: ' (5000)', points: [[0, 40]] },
      { key: '10000.5', suffix: ' (10000.5)', points: [[0, 80]] },
      { key: '', suffix: ' (0)', points: [[0, null]] },
    ]);
    assert.deepEqual(seriesLines(seriesOf({ ...ranks, values: ['5000', '10000.5'] }), answer, HOUR, true), [{ suffix: '', points: [[0, 80]] }]);
  });

  it('draws the bounds of a standard deviation set to Bounds Band as a band, and nothing for it in a table', () => {
    const deviation: TsvbMetric = { id: 'd', type: 'std_deviation', field: 'bytes', mode: 'band' };
    const answer = [
      bucket(0, { d: { std_deviation: 3, std_deviation_bounds: { upper: 16, lower: 4 } } }),
      bucket(1, { d: { std_deviation: null, std_deviation_bounds: { upper: null, lower: null } } }),
    ];
    assert.deepEqual(seriesLines(seriesOf(deviation), answer, HOUR), [
      { suffix: '', points: [[0, 16, 4], [HOUR, null, null]], band: { fill: 0.5, upper: ' - upper', lower: ' - lower' } },
    ]);
    assert.deepEqual(seriesLines(seriesOf(deviation), answer, HOUR, true), []);
    // Set to one bound, it draws that bound
    assert.deepEqual(seriesLines(seriesOf({ ...deviation, mode: 'lower' }), answer, HOUR)[0].points, [[0, 4], [HOUR, null]]);
  });

  it('works out the bounds of an overall standard deviation with its sigma, and draws them as a band', () => {
    const avg: TsvbMetric = { id: 'm', type: 'avg', field: 'bytes' };
    const answer = [2, 4, 4, 4, 5, 5, 7, 9].map((value, at) => bucket(at, { m: { value } }));
    // Mean 5, standard deviation 2
    const overall = (mode: string, sigma?: string) => seriesLines(seriesOf(avg, { id: 'o', type: 'std_deviation_bucket', field: 'm', mode, sigma }), answer, HOUR)[0];
    assert.deepEqual(overall('raw').points[0], [0, 2]);
    assert.deepEqual(overall('upper').points[0], [0, 9]);
    assert.deepEqual(overall('lower', '1').points[0], [0, 3]);
    assert.deepEqual(overall('band', '3').points[7], [7 * HOUR, 11, -1]);
    assert.deepEqual(overall('band').band, { fill: 0.5, upper: ' - upper', lower: ' - lower' });
  });

  it('works another metric out from the percentile it names, or from the first when it names none', () => {
    const answer = [
      bucket(0, { p: { values: { '50.0': 5, '90.0': 9 } } }),
      bucket(1, { p: { values: { '50.0': 6, '90.0': 12 } } }),
    ];
    const percentile: TsvbMetric = { id: 'p', type: 'percentile', field: 'bytes', percentiles: [{ id: 'a', value: 50 }, { id: 'b', value: 90 }] };
    const difference = (field: string) => seriesLines(seriesOf(percentile, { id: 'd', type: 'serial_diff', field }), answer, HOUR)[0].points;
    assert.deepEqual(difference('p[90.0]'), [[0, null], [HOUR, 3]]);
    assert.deepEqual(difference('p[90]'), [[0, null], [HOUR, 3]]);
    assert.deepEqual(difference('p'), [[0, null], [HOUR, 1]]);
  });
});

describe('what a TSVB series works out from its metrics', () => {
  it('takes a positive rate over a bucket when it has no unit of its own, and over its unit otherwise', () => {
    const answer = [bucket(0, { 'r-max': { value: 100 } }), bucket(1, { 'r-max': { value: 160 } }), bucket(2, { 'r-max': { value: 40 } })];
    const rate = (unit: string) => seriesLines(seriesOf({ id: 'r', type: 'positive_rate', field: 'bytes', unit }), answer, HOUR)[0].points;
    assert.deepEqual(rate(''), [[0, null], [HOUR, 60], [2 * HOUR, 0]]);
    assert.deepEqual(rate('1m'), [[0, null], [HOUR, 1], [2 * HOUR, 0]]);
  });
});

/** A part of a series as the panels get it, its last value given */
const part = (id: string, last: number, label = id.split(':')[1] ?? id): TsvbSeriesData => ({
  id,
  seriesId: id.split(':')[0],
  label,
  color: '',
  data: [[0, last]],
  last,
  series: { id: id.split(':')[0] },
  format: String,
});

describe('the parts of a TSVB series as the panels show them', () => {
  it('orders the rows of a Top N series by series, by last value, largest first unless told otherwise', () => {
    const rows = [part('a:x', 1), part('a:y', 3), part('a:z', 2), part('b:p', 5), part('b:q', 9)];
    const ids = (series: TsvbSeries[]) => topNRows({ series }, rows).map((row) => row.id);
    assert.deepEqual(ids([{ id: 'b' }, { id: 'a' }]), ['b:q', 'b:p', 'a:y', 'a:z', 'a:x']);
    assert.deepEqual(ids([{ id: 'a', terms_direction: 'asc' }]), ['a:x', 'a:z', 'a:y']);
    assert.deepEqual(ids([{ id: 'a', terms_order_by: '_key', terms_direction: 'desc' }]), ['a:x', 'a:y', 'a:z']);
    // Level values come in the reverse of their order when the largest come first
    assert.deepEqual(topNRows({ series: [{ id: 'a' }] }, [part('a:x', 1), part('a:y', 1)]).map((row) => row.id), ['a:y', 'a:x']);
  });

  it('names a term by its key, or puts it in the place of {{key}} in the series label', () => {
    assert.equal(termLabel({ id: 's' }, 'gz'), 'gz');
    assert.equal(termLabel({ id: 's', label: 'Count' }, '1'), '1');
    assert.equal(termLabel({ id: 's', label: 'Bytes of {{ key }} ({{key}})' }, 'gz'), 'Bytes of gz ({{key}})');
    assert.equal(termLabel({ id: 's', label: 'Spent {{key}}' }, '$&'), 'Spent $&');
  });

  it('gives a Markdown panel the name OpenSearch writes for a term, a date in the date format', () => {
    const variables = convertSeriesToVars(
      [{ ...part('s:1', 2, '1'), labelFormatted: 'true' }, { ...part('s:1794787200000', 3, '1794787200000'), labelFormatted: '2026-11-16T00:00:00.000Z' }],
      { series: [{ id: 's' }] },
      'YYYY-MM-DD HH:mm',
      'UTC'
    ) as Record<string, { formatted?: string }>;
    assert.equal(variables['1'].formatted, 'true');
    assert.equal(variables['1794787200000'].formatted, '2026-11-16 00:00');
  });

  it("gives a metric's panel the background of its colour rule only, never the panel's background colour", () => {
    const rules: ColorRule[] = [{ id: 'r', operator: 'gte', value: 10, background_color: 'rgba(51,51,51,1)', color: 'red' }];
    const params = { background_color: '#000000', background_color_rules: rules };
    assert.equal(metricBackground(params, { series: [part('a', 12)] }), 'rgba(51,51,51,1)');
    assert.equal(metricRule(params, { series: [part('a', 12)] })?.color, 'red');
    // A panel switched from another type keeps that type's background colour; the metric draws none
    assert.equal(metricBackground(params, { series: [part('a', 3)] }), undefined);
    assert.equal(metricBackground({ background_color: '#000000' }, { series: [part('a', 3)] }), undefined);
    // With no series, the rules are met by 0
    assert.equal(metricBackground({ background_color_rules: [{ ...rules[0], operator: 'lte', value: 0 }] }, { series: [] }), 'rgba(51,51,51,1)');
  });
});

describe('the panels the product does not ask for, as their interval makes too many buckets', () => {
  const week = 7 * 24 * 3600 * 1000;

  it('counts the whole buckets of a panel interval against metrics:max_buckets', () => {
    assert.equal(tooManyBuckets('1s', week, 2000), true);
    assert.equal(tooManyBuckets('10m', week, 2000), false);
    // A week in five minute buckets is 2016 of them
    assert.equal(tooManyBuckets('5m', week, 2015), true);
    assert.equal(tooManyBuckets('5m', week, 2016), false);
  });

  it('never fails an automatic interval, one of at least so much, or one it cannot read', () => {
    for (const interval of [undefined, '', 'auto', '>=1s', 'often']) assert.equal(tooManyBuckets(interval, week, 1), false, interval);
  });
});

describe('the format of the times of a TSVB time series, by the settings', () => {
  const rules: Array<[string, string]> = [
    ['', 'HH:mm:ss'],
    ['PT1H', 'DD/MM HH[h]'],
    ['P1DT', 'DD/MM'],
  ];

  it('takes the last rule of dateFormat:scaled that the interval reaches, as createXaxisFormatter', () => {
    const settings = { dateFormat: 'MMM D, YYYY', scaledDateRules: rules };
    assert.equal(timeAxisPattern(HOUR / 2, settings), 'HH:mm:ss');
    assert.equal(timeAxisPattern(HOUR * 3, settings), 'DD/MM HH[h]');
    assert.equal(timeAxisPattern(HOUR * 24, settings), 'DD/MM');
  });

  it('takes dateFormat when no rule fits, and the rules the setting starts with when it holds none', () => {
    assert.equal(timeAxisPattern(HOUR, { dateFormat: 'YYYY', scaledDateRules: [['P1DT', 'DD']] }), 'YYYY');
    assert.equal(timeAxisPattern(HOUR, { dateFormat: 'YYYY', scaledDateRules: [] }), 'YYYY');
    assert.equal(timeAxisPattern(HOUR * 3, { dateFormat: 'YYYY', scaledDateRules: undefined }), 'YYYY-MM-DD HH:mm');
  });
});

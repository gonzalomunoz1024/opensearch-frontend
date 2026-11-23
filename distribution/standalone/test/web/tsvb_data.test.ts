/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { metricAggs, seriesLines, type TimeBucket, type TsvbMetric, type TsvbSeries } from '../../web/vis/tsvb/data';

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

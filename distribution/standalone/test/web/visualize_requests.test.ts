/* SPDX-License-Identifier: Apache-2.0 */

// The moments of a date range are written where the reader is: the tests read in UTC
process.env.TZ = 'UTC';

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { serializeAggs } from '../../web/apps/visualize/agg_params';
import { allowedAggs, paramProblems, withoutDisabledBuckets } from '../../web/apps/visualize/defaults';
import { buildAggsDsl, needsFieldBounds, numberInterval, tabify, type AggConfig, type AggContext } from '../../web/lib/aggs';
import type { Field, IndexPattern } from '../../web/lib/types';
import { visType } from '../../web/lib/vis';

const field = (name: string, type: string, more: Partial<Field> = {}): Field => ({
  name,
  type,
  searchable: true,
  aggregatable: true,
  ...more,
});

const logs: IndexPattern = {
  id: 'logs',
  title: 'logs-*',
  timeFieldName: 'timestamp',
  fields: [
    field('timestamp', 'date', { esTypes: ['date'] }),
    field('bytes', 'number', { esTypes: ['long'] }),
    field('memory', 'number', { esTypes: ['double'] }),
    field('clientip', 'ip', { esTypes: ['ip'] }),
    field('extension', 'string', { esTypes: ['keyword'] }),
  ],
  fieldFormatMap: {},
};

const context: AggContext = { indexPattern: logs };
const count: AggConfig = { id: '1', enabled: true, type: 'count', schema: 'metric', params: {} };
const bucket = (type: string, params: Record<string, unknown>): AggConfig => ({ id: '2', enabled: true, type, schema: 'bucket', params });
const histogram = (params: Record<string, unknown>) => bucket('histogram', { field: 'bytes', ...params });
const bounded = (min: number, max: number, name = 'bytes'): AggContext => ({ ...context, maxBars: 100, fieldBounds: { [name]: { min, max } } });

/** The cells of a table's first column as they are written, and its counts */
const firstColumn = (aggs: AggConfig[], response: Record<string, unknown>) => {
  const table = tabify(aggs, { aggregations: response }, context);
  const [keys, counts] = table.columns;
  return {
    keys: table.rows.map((row) => keys.format(row[keys.id])),
    counts: table.rows.map((row) => row[counts.id]),
  };
};

describe('the interval of a number histogram, as the original works it out', () => {
  it('takes a power of ten, or two or five times one, for about histogram:maxBars bars when it is auto', () => {
    assert.equal(numberInterval(histogram({ interval: 'auto' }), bounded(0, 20000)), 200);
    assert.equal(numberInterval(histogram({ interval: 'auto' }), bounded(0, 2370)), 50);
    assert.equal(numberInterval(histogram({}), bounded(0, 100000)), 1000);
  });

  it('takes the Max bars asked for when they are fewer', () => {
    assert.equal(numberInterval(histogram({ interval: 'auto', maxBars: 30 }), bounded(0, 20000)), 1000);
    assert.equal(numberInterval(histogram({ interval: 'auto', maxBars: 500 }), bounded(0, 20000)), 200);
  });

  it('takes 1 for a field of whole numbers that spans less than the bars, a fraction for one of decimals', () => {
    assert.equal(numberInterval(histogram({ interval: 'auto' }), bounded(0, 50)), 1);
    assert.equal(numberInterval(bucket('histogram', { field: 'memory', interval: 'auto' }), bounded(0, 50, 'memory')), 0.5);
  });

  it('widens an interval that would give too many bars to the next multiple of its power of ten', () => {
    assert.equal(numberInterval(histogram({ interval: 10 }), bounded(0, 20000)), 200);
    assert.equal(numberInterval(histogram({ interval: '7' }), bounded(0, 2370)), 30);
    assert.equal(numberInterval(histogram({ interval: 1000 }), bounded(0, 20000)), 1000);
  });

  it('keeps to the base an interval must be a multiple of', () => {
    assert.equal(numberInterval(histogram({ interval: 'auto', intervalBase: 300 }), bounded(0, 20000)), 300);
    assert.equal(numberInterval(histogram({ interval: 'auto', intervalBase: 300 }), bounded(0, 50000)), 600);
  });

  it('takes 1 without the bounds of the field, and asks for them for every histogram', () => {
    assert.equal(numberInterval(histogram({ interval: 'auto' }), context), 1);
    assert.equal(needsFieldBounds(histogram({ interval: 10 })), true);
    assert.equal(needsFieldBounds(bucket('terms', { field: 'extension' })), false);
  });
});

describe('the request, as the original writes it', () => {
  const dsl = (agg: AggConfig) => buildAggsDsl([count, agg], context)['2'] as Record<string, unknown>;

  it('asks for the buckets of number ranges keyed by their ranges', () => {
    assert.deepEqual(dsl(bucket('range', { field: 'bytes', ranges: [{ from: 0, to: 1000 }, { from: 1000 }] })).range, {
      field: 'bytes',
      ranges: [
        { from: 0, to: 1000 },
        { from: 1000, to: undefined },
      ],
      keyed: true,
    });
  });

  it('asks for percentiles and percentile ranks as lists', () => {
    const metrics = buildAggsDsl(
      [
        { id: '1', enabled: true, type: 'percentiles', schema: 'metric', params: { field: 'bytes', percents: [5, 95] } },
        { id: '3', enabled: true, type: 'percentile_ranks', schema: 'metric', params: { field: 'bytes', values: [100] } },
      ],
      context
    );
    assert.deepEqual(metrics['1'], { percentiles: { field: 'bytes', percents: [5, 95], keyed: false } });
    assert.deepEqual(metrics['3'], { percentile_ranks: { field: 'bytes', values: [100], keyed: false } });
  });

  it('leaves out a least count of 0 on a date histogram, and bounds nobody set', () => {
    const timeRange = { from: new Date(Date.UTC(2026, 10, 1)), to: new Date(Date.UTC(2026, 10, 2)) };
    const date = (params: Record<string, unknown>) =>
      (buildAggsDsl([count, bucket('date_histogram', { field: 'timestamp', interval: 'h', ...params })], { ...context, timeRange, timeZone: 'UTC' })['2'] as { date_histogram: Record<string, unknown> }).date_histogram;
    assert.deepEqual(date({ min_doc_count: 0 }), { field: 'timestamp', calendar_interval: '1h', time_zone: 'UTC' });
    assert.equal(date({}).min_doc_count, 1);
  });

  it('orders the terms of a sibling pipeline\'s bucket as asked, as it orders the chart\'s own', () => {
    // What the original sent for these, measured on the reference
    const sibling = (id: string, type: string, terms: Record<string, unknown>, customMetric: AggConfig): AggConfig => ({
      id,
      enabled: true,
      type,
      schema: 'metric',
      params: { customBucket: { id: `${id}-bucket`, enabled: true, type: 'terms', schema: 'bucketAgg', params: terms }, customMetric },
    });
    const max: AggConfig = { id: '2-metric', enabled: true, type: 'max', schema: 'metricAgg', params: { field: 'bytes' } };
    const none: AggConfig = { id: '3-metric', enabled: true, type: 'count', schema: 'metricAgg', params: {} };
    const sum: AggConfig = { id: '3-bucket-orderAgg', enabled: true, type: 'sum', schema: 'orderAgg', params: { field: 'bytes' } };
    const request = buildAggsDsl(
      [
        count,
        sibling('2', 'max_bucket', { field: 'extension', size: 2, order: 'asc', orderBy: '_key' }, max),
        sibling('3', 'sum_bucket', { field: 'extension', size: 3, order: 'desc', orderBy: 'custom', orderAgg: sum }, none),
        sibling('4', 'avg_bucket', { field: 'extension', size: 3, order: 'desc', orderBy: '1' }, { ...none, id: '4-metric' }),
      ],
      context
    );
    assert.deepEqual(request['2-bucket'], { terms: { field: 'extension', size: 2, order: { _key: 'asc' } }, aggs: { '2-metric': { max: { field: 'bytes' } } } });
    assert.deepEqual(request['2'], { max_bucket: { buckets_path: '2-bucket>2-metric' } });
    assert.deepEqual(request['3-bucket'], { terms: { field: 'extension', size: 3, order: { '3-bucket-orderAgg': 'desc' } }, aggs: { '3-bucket-orderAgg': { sum: { field: 'bytes' } } } });
    // The metric that orders the bucket is not the one the pipeline reads
    assert.deepEqual(request['3'], { sum_bucket: { buckets_path: '3-bucket>_count' } });
    assert.deepEqual(request['4-bucket'], { terms: { field: 'extension', size: 3, order: { _count: 'desc' } } });
  });

  it('keeps and leaves out terms as asked: numbers on a number field, a pattern on a text field, as the original', () => {
    // What the original sent for these, measured on the reference
    const terms = (params: Record<string, unknown>) => dsl(bucket('terms', { size: 5, order: 'desc', orderBy: '1', ...params })).terms as Record<string, unknown>;
    const numbers = terms({ field: 'bytes', include: [0, 1000, ''], exclude: [1000] });
    assert.deepEqual(numbers.include, [0, 1000]);
    assert.deepEqual(numbers.exclude, [1000]);
    const text = terms({ field: 'extension', include: 'css|png', exclude: 'gif' });
    assert.equal(text.include, 'css|png');
    assert.equal(text.exclude, 'gif');
    // A saved object of an older version keeps its pattern in an object
    assert.equal(terms({ field: 'extension', include: { pattern: 'css.*' } }).include, 'css.*');
    // A pattern on a number field, or a list on a text field, is not asked
    const unasked = terms({ field: 'bytes', include: 'css', exclude: '' });
    assert.equal('include' in unasked || 'exclude' in unasked, false);
    assert.equal('include' in terms({ field: 'extension', include: [1] }), false);
    const significant = dsl(bucket('significant_terms', { field: 'extension', size: 3, include: 'win.*', exclude: 'win 7' }));
    assert.deepEqual(significant, { significant_terms: { field: 'extension', size: 3, exclude: 'win 7', include: 'win.*' } });
  });

  it('merges the JSON input as the original: key by key and item by item all the way down, a null taking a key away', () => {
    const bounded = dsl(histogram({ interval: 1000, min_doc_count: true, has_extended_bounds: true, extended_bounds: { min: 0, max: 30000 }, json: '{"extended_bounds": {"max": 40000}}' }));
    assert.deepEqual((bounded.histogram as Record<string, unknown>).extended_bounds, { min: 0, max: 40000 });
    const terms = dsl(bucket('terms', { field: 'extension', size: 5, order: 'desc', orderBy: '1', json: '{"size": null, "shard_size": 9}' })).terms as Record<string, unknown>;
    assert.equal('size' in terms, false);
    assert.equal(terms.shard_size, 9);
    const percentiles: AggConfig = { id: '1', enabled: true, type: 'percentiles', schema: 'metric', params: { field: 'bytes', percents: [5, 95], json: '{"percents": [1]}' } };
    assert.deepEqual(buildAggsDsl([percentiles], context)['1'], { percentiles: { field: 'bytes', percents: [1, 95], keyed: false } });
  });

  it('writes the JSON input of every aggregation it asks for: one that orders terms, and one inside another', () => {
    // What the original sent for these, measured on the reference
    const average: AggConfig = { id: '1', enabled: true, type: 'avg', schema: 'metric', params: { field: 'bytes', json: '{"missing": 0}' } };
    const ordered = buildAggsDsl([average, bucket('terms', { field: 'extension', size: 3, order: 'desc', orderBy: '1' })], context)['2'] as Record<string, unknown>;
    assert.deepEqual(ordered.aggs, { '1': { avg: { field: 'bytes', missing: 0 } } });

    const nested = buildAggsDsl(
      [
        count,
        {
          id: '3',
          enabled: true,
          type: 'max_bucket',
          schema: 'metric',
          params: {
            customBucket: { id: '3-bucket', enabled: true, type: 'terms', schema: 'bucketAgg', params: { field: 'extension', size: 2, order: 'asc', orderBy: '_key', json: '{"shard_size": 7}' } },
            customMetric: { id: '3-metric', enabled: true, type: 'max', schema: 'metricAgg', params: { field: 'bytes', json: '{"missing": 1}' } },
          },
        },
        bucket('terms', { field: 'extension', size: 3, order: 'desc', orderBy: 'custom', orderAgg: { id: '2-orderAgg', enabled: true, type: 'sum', schema: 'orderAgg', params: { field: 'bytes', json: '{"missing": 2}' } } }),
      ],
      context
    )['2'] as { aggs: Record<string, unknown> };
    assert.deepEqual(nested.aggs['3-bucket'], { terms: { field: 'extension', size: 2, order: { _key: 'asc' }, shard_size: 7 }, aggs: { '3-metric': { max: { field: 'bytes', missing: 1 } } } });
    assert.deepEqual(nested.aggs['2-orderAgg'], { sum: { field: 'bytes', missing: 2 } });

    const derivative: AggConfig = {
      id: '3',
      enabled: true,
      type: 'derivative',
      schema: 'metric',
      params: { metricAgg: 'custom', customMetric: { id: '3-metric', enabled: true, type: 'avg', schema: 'metricAgg', params: { field: 'bytes', json: '{"missing": 3}' } }, json: '{"gap_policy": "insert_zeros"}' },
    };
    const parent = buildAggsDsl([count, derivative, histogram({ interval: 1000 })], context)['2'] as { aggs: Record<string, unknown> };
    assert.deepEqual(parent.aggs['3'], { derivative: { buckets_path: '3-metric', gap_policy: 'insert_zeros' } });
    assert.deepEqual(parent.aggs['3-metric'], { avg: { field: 'bytes', missing: 3 } });
  });
});

describe('the buckets of ranges, IP ranges and filters, in the order they are asked', () => {
  it('reads number ranges keyed by their ranges, as many times as they are asked', () => {
    const ranges = bucket('range', { field: 'bytes', ranges: [{ from: 3000, to: 5000 }, { from: 0, to: 1000 }, { from: 3000, to: 5000 }, { to: 500 }] });
    const response = {
      '2': {
        buckets: {
          '*-500.0': { to: 500, doc_count: 2 },
          '0.0-1000.0': { from: 0, to: 1000, doc_count: 5 },
          '3000.0-5000.0': { from: 3000, to: 5000, doc_count: 7 },
        },
      },
    };
    assert.deepEqual(firstColumn([count, ranges], response), {
      keys: ['≥ 3,000 and < 5,000', '≥ 0 and < 1,000', '≥ 3,000 and < 5,000', '≥ -∞ and < 500'],
      counts: [7, 5, 7, 2],
    });
  });

  it('reads IP masks and IP ranges in the order asked, OpenSearch sorting them', () => {
    const masks = bucket('ip_range', { field: 'clientip', ipRangeType: 'mask', ranges: { mask: [{ mask: '128.0.0.0/2' }, { mask: '0.0.0.0/1' }] } });
    const sorted = {
      '2': {
        buckets: [
          { key: '0.0.0.0/1', from: '0.0.0.0', to: '128.0.0.0', doc_count: 8 },
          { key: '128.0.0.0/2', from: '128.0.0.0', to: '192.0.0.0', doc_count: 3 },
        ],
      },
    };
    assert.deepEqual(firstColumn([count, masks], sorted), { keys: ['128.0.0.0/2', '0.0.0.0/1'], counts: [3, 8] });
    const fromTo = bucket('ip_range', {
      field: 'clientip',
      ipRangeType: 'fromTo',
      ranges: { fromTo: [{ from: '128.0.0.0', to: '191.255.255.255' }, { from: '0.0.0.0', to: '127.255.255.255' }] },
    });
    const answer = {
      '2': {
        buckets: [
          { key: '0.0.0.0-127.255.255.255', from: '0.0.0.0', to: '127.255.255.255', doc_count: 8 },
          { key: '128.0.0.0-191.255.255.255', from: '128.0.0.0', to: '191.255.255.255', doc_count: 3 },
        ],
      },
    };
    assert.deepEqual(firstColumn([count, fromTo], answer), { keys: ['128.0.0.0 to 191.255.255.255', '0.0.0.0 to 127.255.255.255'], counts: [3, 8] });
  });

  it('reads filters in the order asked, OpenSearch sorting them by name', () => {
    const filters = bucket('filters', {
      filters: [
        { input: { language: 'kuery', query: 'extension:png' }, label: 'b' },
        { input: { language: 'kuery', query: 'extension:css' }, label: 'a' },
      ],
    });
    const response = { '2': { buckets: { a: { doc_count: 4 }, b: { doc_count: 1 } } } };
    assert.deepEqual(firstColumn([count, filters], response), { keys: ['b', 'a'], counts: [1, 4] });
  });

  it('writes date ranges as the original: before, after, or from and to', () => {
    const day = (date: number) => Date.UTC(2026, 10, date);
    const dates = bucket('date_range', { field: 'timestamp', ranges: [{ to: 'now' }] });
    const response = {
      '2': {
        buckets: [
          { to: day(18), doc_count: 1 },
          { from: day(18), to: day(20), doc_count: 2 },
          { from: day(21), doc_count: 3 },
        ],
      },
    };
    assert.deepEqual(firstColumn([count, dates], response).keys, [
      'Before Nov 18, 2026 @ 00:00:00.000',
      'Nov 18, 2026 @ 00:00:00.000 to Nov 20, 2026 @ 00:00:00.000',
      'After Nov 21, 2026 @ 00:00:00.000',
    ]);
  });

  it('reads percentiles from the list, and writes the value of a percentile rank in the format of its field', () => {
    const aggs: AggConfig[] = [
      { id: '1', enabled: true, type: 'percentiles', schema: 'metric', params: { field: 'bytes', percents: [95, 5] } },
      { id: '3', enabled: true, type: 'percentile_ranks', schema: 'metric', params: { field: 'bytes', values: [5000] } },
    ];
    const table = tabify(
      aggs,
      {
        aggregations: {
          '1': { values: [{ key: 5, value: 407 }, { key: 95, value: 11107 }] },
          '3': { values: [{ key: 5000, value: 44.9 }] },
        },
      },
      context
    );
    assert.deepEqual(
      table.columns.map((column) => column.name),
      ['95th percentile of bytes', '5th percentile of bytes', 'Percentile rank 5,000 of "bytes"']
    );
    assert.deepEqual(
      table.columns.map((column) => table.rows[0][column.id]),
      [11107, 407, 44.9]
    );
  });
});

describe('the checks of the Data tab', () => {
  const date = (interval: string) => paramProblems(bucket('date_histogram', { field: 'timestamp', interval }), logs).interval;

  it('asks weeks, months and years one at a time, as the original', () => {
    assert.equal(date('2w'), 'Invalid calendar interval: 2w, value must be 1');
    assert.equal(date('3M'), 'Invalid calendar interval: 3M, value must be 1');
    assert.equal(date('1w'), undefined);
    assert.equal(date('14d'), undefined);
    assert.equal(date('x'), 'Invalid interval format.');
  });

  it('knows no bucket aggregation that visualize:disableBucketAgg turns off', () => {
    const schema = visType('table')?.schemas?.find((candidate) => candidate.name === 'bucket');
    if (!schema) throw new Error('a table has no part named bucket');
    assert.equal(allowedAggs('table', schema, ['terms']).includes('terms'), false);
    assert.equal(allowedAggs('table', schema, []).includes('terms'), true);
    const terms = bucket('terms', { field: 'extension', size: 5 });
    const pipeline: AggConfig = { id: '3', enabled: true, type: 'avg_bucket', schema: 'metric', params: { customBucket: { id: '3-bucket', enabled: true, type: 'terms', params: { field: 'extension' } } } };
    const [, stripped, nested] = withoutDisabledBuckets([count, terms, pipeline], ['terms']);
    assert.deepEqual(stripped, { id: '2', enabled: true, type: '', params: {}, schema: 'bucket' });
    assert.deepEqual(nested.params?.customBucket, { id: '3-bucket', enabled: true, type: '', params: {} });
    assert.equal(withoutDisabledBuckets([count, terms], [])[1], terms);
  });

  it('leaves an aggregation without a type out of the request', () => {
    const typeless: AggConfig = { id: '2', enabled: true, type: '', schema: 'bucket', params: {} };
    assert.deepEqual(Object.keys(buildAggsDsl([count, typeless], context)), []);
  });
});

describe('the address, as the original writes it', () => {
  const timeRange = { from: 'now-7d', to: 'now' };
  const sibling: AggConfig = {
    id: '1',
    enabled: true,
    type: 'avg_bucket',
    schema: 'metric',
    params: {
      customBucket: { id: '1-bucket', enabled: true, type: 'date_histogram', params: { field: 'timestamp', interval: 'auto' } },
      customMetric: { id: '1-metric', enabled: true, type: 'count', params: {} },
    },
  };
  const inner = (aggs: AggConfig[]) => (serializeAggs(aggs, { indexPattern: logs, timeRange })[0].params?.customBucket as AggConfig).params;

  it('gives a date histogram of the chart the time range of the page', () => {
    const [, date] = serializeAggs([count, bucket('date_histogram', { field: 'timestamp' })], { indexPattern: logs, timeRange });
    assert.deepEqual(date.params?.timeRange, timeRange);
  });

  it('gives it to the bucket of a sibling pipeline only when the chart has a date histogram', () => {
    assert.equal(inner([sibling, bucket('terms', { field: 'extension' })])?.timeRange, undefined);
    assert.deepEqual(inner([sibling, bucket('date_histogram', { field: 'timestamp' })])?.timeRange, timeRange);
  });
});

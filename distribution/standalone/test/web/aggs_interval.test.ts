/* SPDX-License-Identifier: Apache-2.0 */

process.env.TZ = 'UTC';

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildAggsDsl, dateInterval, dateIntervalProblem, normalizedInterval, requestProblem, type AggConfig, type AggContext } from '../../web/lib/aggs';
import { withoutDisabledBuckets } from '../../web/apps/visualize/defaults';
import type { Field, IndexPattern } from '../../web/lib/types';

const field = (name: string, type: string): Field => ({ name, type, searchable: true, aggregatable: true });
const logs: IndexPattern = { id: 'logs', title: 'logs-*', timeFieldName: 'timestamp', fields: [field('timestamp', 'date'), field('bytes', 'number'), field('os', 'string')], fieldFormatMap: {} };
// Four months: no interval of a day or more is widened
const context: AggContext = { indexPattern: logs, timeZone: 'UTC', timeRange: { from: new Date('2026-09-01T00:00:00Z'), to: new Date('2026-12-31T00:00:00Z') } };
const count: AggConfig = { id: '1', enabled: true, type: 'count', schema: 'metric', params: {} };
const dates = (interval: unknown, more: Record<string, unknown> = {}): AggConfig => ({ id: '2', enabled: true, type: 'date_histogram', schema: 'segment', params: { field: 'timestamp', interval, ...more } });
const clause = (interval: unknown) => {
  const { field: _field, time_zone: _zone, min_doc_count: _least, ...rest } = (buildAggsDsl([count, dates(interval)], context)['2'] as { date_histogram: Record<string, unknown> }).date_histogram;
  return rest;
};

describe('an interval someone wrote, as the original normalizes it', () => {
  // What the original's parseInterval and convertDurationToNormalizedOpenSearchInterval give, with its moment
  const expected: Record<string, [string, string]> = {
    ms: ['1ms', 'millisecond'],
    '1500ms': ['1500ms', '1500 milliseconds'],
    '0.5s': ['500ms', '500 milliseconds'],
    '90s': ['90s', '90 seconds'],
    '0.5m': ['30s', '30 seconds'],
    '60m': ['1h', 'hour'],
    '90m': ['90m', '90 minutes'],
    '1.5h': ['90m', '90 minutes'],
    '24h': ['1d', 'day'],
    '36h': ['36h', '36 hours'],
    '48h': ['2d', '2 days'],
    '0.5d': ['12h', '12 hours'],
    '1.5d': ['36h', '36 hours'],
    '7d': ['1w', 'week'],
    '14d': ['2w', '2 weeks'],
    '30d': ['30d', '30 days'],
    '45d': ['45d', '45 days'],
    '365d': ['365d', '365 days'],
    w: ['1w', 'week'],
    '2w': ['2w', '2 weeks'],
    '0.5w': ['84h', '84 hours'],
    '1.5w': ['252h', '252 hours'],
    M: ['1M', 'month'],
    '2M': ['61d', '61 days'],
    '3M': ['13w', '13 weeks'],
    '0.5M': ['15d', '15 days'],
    '12M': ['1y', 'year'],
    y: ['1y', 'year'],
    '2y': ['730d', '730 days'],
    '0.5y': ['183d', '183 days'],
    '0d': ['1d', 'day'],
    '1 d': ['1d', 'day'],
  };

  it('says it in the largest unit it is a whole number of, years and months only when it is one', () => {
    for (const [text, [expression, description]] of Object.entries(expected)) {
      const normal = normalizedInterval(text);
      assert.deepEqual([normal?.expression, normal?.description], [expression, description], text);
    }
  });

  it('is nothing when it is not an interval', () => {
    for (const text of ['foo', '2', '2x', '10q', '']) assert.equal(normalizedInterval(text), undefined, text);
  });
});

describe('the interval a date histogram asks OpenSearch for', () => {
  it('is by the calendar for one of a unit, fixed otherwise, in the normalized words', () => {
    assert.deepEqual(clause('24h'), { calendar_interval: '1d' });
    assert.deepEqual(clause('1.5d'), { fixed_interval: '36h' });
    assert.deepEqual(clause('2y'), { fixed_interval: '730d' });
    assert.deepEqual(clause('2M'), { fixed_interval: '61d' });
    assert.deepEqual(clause('w'), { calendar_interval: '1w' });
    assert.deepEqual(clause('7d'), { calendar_interval: '1w' });
    assert.deepEqual(clause('2d'), { fixed_interval: '2d' });
  });

  it('is labelled in the normalized words', () => {
    assert.equal(dateInterval(dates('2y'), context).description, '730 days');
    assert.equal(dateInterval(dates('48h'), context).description, '2 days');
    assert.equal(dateInterval(dates('d'), context).description, 'day');
  });

  it('keeps an automatic or a widened interval as it was', () => {
    assert.equal(dateInterval(dates('auto'), context).asked, undefined);
    const year = { ...context, timeRange: { from: new Date('2025-12-31T00:00:00Z'), to: new Date('2026-12-31T00:00:00Z') } };
    const widened = dateInterval(dates('30s'), year);
    assert.equal(widened.scaled, true);
    assert.equal(widened.asked, undefined);
    assert.equal(dateIntervalProblem(dates('2w'), { ...context, timeRange: { from: new Date('1966-12-31T00:00:00Z'), to: new Date('2026-12-31T00:00:00Z') } }), undefined);
  });

  it('chooses the same interval for a time range typed the other way round', () => {
    // The original sorts the ends first (TimeBuckets.setBounds): a week either way is 3 hours
    const week = { from: new Date('2026-11-16T00:00:00Z'), to: new Date('2026-11-23T00:00:00Z') };
    const forward = dateInterval(dates('auto'), { ...context, timeRange: week });
    const backward = dateInterval(dates('auto'), { ...context, timeRange: { from: week.to, to: week.from } });
    assert.equal(forward.expression, '3h');
    assert.deepEqual(backward, forward);
  });
});

describe('a request the original refuses to write', () => {
  it('says so for an interval of several weeks, in the words of the original', () => {
    assert.equal(dateIntervalProblem(dates('2w'), context), 'Invalid calendar interval: 2w, value must be 1');
    assert.equal(dateIntervalProblem(dates('14d'), context), 'Invalid calendar interval: 2w, value must be 1');
    assert.equal(dateIntervalProblem(dates('3M'), context), 'Invalid calendar interval: 13w, value must be 1');
    assert.equal(dateIntervalProblem(dates('custom', { customInterval: '2w' }), context), 'Invalid calendar interval: 2w, value must be 1');
    for (const fine of ['auto', 'w', '2y', '2M', '1.5d', undefined]) assert.equal(dateIntervalProblem(dates(fine), context), undefined, String(fine));
  });

  it('says so for an interval that is not one', () => {
    assert.equal(dateIntervalProblem(dates('foo'), context), '"foo" is not a valid interval.');
    assert.equal(requestProblem([count, dates('foo')], context), '"foo" is not a valid interval.');
  });

  it('says so for an aggregation without its field', () => {
    const terms: AggConfig = { id: '2', enabled: true, type: 'terms', schema: 'segment', params: { size: 3, order: 'desc', orderBy: '1' } };
    assert.equal(requestProblem([count, terms], context), '"field" is a required parameter');
    assert.equal(requestProblem([{ id: '1', enabled: true, type: 'avg', schema: 'metric', params: {} }], context), '"field" is a required parameter');
    assert.equal(requestProblem([count, { ...terms, enabled: false }], context), undefined);
    assert.equal(requestProblem([count, { ...terms, params: { ...terms.params, field: 'os' } }], context), undefined);
  });

  it('does not ask for a sibling pipeline whose bucket lost its type to visualize:disableBucketAgg', () => {
    const [stripped] = withoutDisabledBuckets(
      [{ id: '4', enabled: true, type: 'avg_bucket', schema: 'metric', params: { customBucket: { id: '4-bucket', enabled: true, type: 'terms', params: { field: 'os' } }, customMetric: { id: '4-metric', enabled: true, type: 'count', params: {} } } }],
      ['terms']
    );
    assert.equal((stripped.params?.customBucket as AggConfig).type, '');
    assert.equal(requestProblem([stripped], context), "Cannot read properties of undefined (reading 'hasNoDsl')");
  });

  it('looks inside a sibling pipeline, a parent pipeline and the metric that orders terms', () => {
    const sibling: AggConfig = { id: '1', enabled: true, type: 'avg_bucket', schema: 'metric', params: { customBucket: { ...dates('2w'), id: '1-bucket' }, customMetric: { id: '1-metric', enabled: true, type: 'count', params: {} } } };
    assert.equal(requestProblem([sibling], context), 'Invalid calendar interval: 2w, value must be 1');
    const parent: AggConfig = { id: '3', enabled: true, type: 'derivative', schema: 'metric', params: { metricAgg: 'custom', customMetric: { id: '3-metric', enabled: true, type: 'sum', params: {} } } };
    assert.equal(requestProblem([parent, dates('d')], context), '"field" is a required parameter');
    const ordered: AggConfig = { id: '2', enabled: true, type: 'terms', schema: 'segment', params: { field: 'os', orderBy: 'custom', orderAgg: { id: '2-orderAgg', enabled: true, type: 'max', params: {} } } };
    assert.equal(requestProblem([count, ordered], context), '"field" is a required parameter');
  });
});

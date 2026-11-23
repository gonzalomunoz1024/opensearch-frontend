/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildAggsDsl, type AggConfig, type AggContext } from '../../web/lib/aggs';
import type { Field, IndexPattern } from '../../web/lib/types';

const field = (name: string, type: string): Field => ({ name, type, searchable: true, aggregatable: true });
const logs: IndexPattern = { id: 'logs', title: 'logs-*', timeFieldName: 'timestamp', fields: [field('timestamp', 'date'), field('bytes', 'number'), field('os', 'string')], fieldFormatMap: {} };
const context: AggContext = { indexPattern: logs };
const count: AggConfig = { id: '1', enabled: true, type: 'count', schema: 'metric', params: {} };
const ranks: AggConfig = { id: '2', enabled: true, type: 'percentile_ranks', schema: 'metric', params: { field: 'bytes', values: [5000, 1.5] } };
const percentiles: AggConfig = { id: '4', enabled: true, type: 'percentiles', schema: 'metric', params: { field: 'bytes', percents: [50, 95] } };
const terms = (params: Record<string, unknown>): AggConfig => ({ id: '3', enabled: true, type: 'terms', schema: 'bucket', params: { field: 'os', size: 3, order: 'desc', ...params } });
const avg = (id: string): AggConfig => ({ id, enabled: true, type: 'avg', schema: 'orderAgg', params: { field: 'bytes' } });
const asked = (aggs: AggConfig[]) => (buildAggsDsl(aggs, context)['3'] as { terms: { order: Record<string, string> }; aggs?: Record<string, unknown> });

describe('the order of a terms aggregation, as the original writes it', () => {
  it('is by one percentile rank, named as the original names it', () => {
    const request = asked([count, ranks, terms({ orderBy: '2.5000' })]);
    assert.deepEqual(request.terms.order, { '2.5000': 'desc' });
    assert.deepEqual(request.aggs?.['2'], { percentile_ranks: { field: 'bytes', values: [5000, 1.5], keyed: false } });
    assert.deepEqual(asked([ranks, terms({ orderBy: '2.5000', order: 'asc' })]).terms.order, { '2.5000': 'asc' });
  });

  it('names a rank whose value has a point the way OpenSearch reads one', () => {
    assert.deepEqual(asked([count, ranks, terms({ orderBy: "2['1.5']" })]).terms.order, { '2[1.5]': 'desc' });
  });

  it('is by the percentile a saved object names', () => {
    assert.deepEqual(asked([count, percentiles, terms({ orderBy: '4.50' })]).terms.order, { '4.50': 'desc' });
  });

  it('stays by count when the value named is not one the metric answers with', () => {
    assert.deepEqual(asked([count, ranks, terms({ orderBy: '2.7' })]).terms.order, { _count: 'desc' });
  });

  it('is by the custom metric a saved object carries, whatever it says it is ordered by', () => {
    for (const orderBy of ['1', '_key', 'custom']) {
      const request = asked([count, terms({ orderBy, orderAgg: avg('3-orderAgg') })]);
      assert.deepEqual(request.terms.order, { '3-orderAgg': 'desc' }, orderBy);
      assert.deepEqual(request.aggs, { '3-orderAgg': { avg: { field: 'bytes' } } }, orderBy);
    }
  });

  it('asks for the custom metric under the id the original gives it, not the one saved', () => {
    const request = asked([count, terms({ orderBy: 'custom', orderAgg: avg('zzz') })]);
    assert.deepEqual(request.terms.order, { '3-orderAgg': 'desc' });
    assert.deepEqual(Object.keys(request.aggs ?? {}), ['3-orderAgg']);
  });

  it('is by count when the custom metric is a count, and by key or count without one', () => {
    assert.deepEqual(asked([count, terms({ orderBy: '_key', orderAgg: { id: '3-orderAgg', enabled: true, type: 'count', params: {} } })]).terms.order, { _count: 'desc' });
    assert.deepEqual(asked([count, terms({ orderBy: '_key', orderAgg: null })]).terms.order, { _key: 'desc' });
    assert.deepEqual(asked([count, terms({ orderBy: '1' })]).terms.order, { _count: 'desc' });
  });
});

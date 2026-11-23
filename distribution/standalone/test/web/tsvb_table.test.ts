/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { TsvbPoint, TsvbSeries } from '../../web/vis/tsvb/data';
import { DEFAULT_SORT, columnLabel, nextSort, pivotLabel, rowDisplay, sortIcon, trendIcon, trendSinceLastBucket } from '../../web/vis/tsvb/table_model';

const points = (values: Array<number | null>): TsvbPoint[] => values.map((value, index) => [index, value]);

describe('what the TSVB table works out before it draws', () => {
  it('titles a column with its label, or its metric, and with the last percentile or rank it shows', () => {
    const series = (part: Partial<TsvbSeries>): TsvbSeries => ({ id: 'a', ...part });
    assert.equal(columnLabel(series({ label: 'Bytes', metrics: [{ id: 'm', type: 'sum', field: 'bytes' }] })), 'Bytes');
    assert.equal(columnLabel(series({ metrics: [{ id: 'm', type: 'count' }] })), 'Count');
    assert.equal(
      columnLabel(series({ label: 'P', metrics: [{ id: 'm', type: 'percentile', field: 'bytes', percentiles: [{ id: 'p1', value: 50 }, { id: 'p2', value: 95 }] }] })),
      'P (95)'
    );
    assert.equal(columnLabel(series({ label: 'P', metrics: [{ id: 'm', type: 'percentile', field: 'bytes', percentiles: [{ id: 'p1' }] }] })), 'P (0)');
    assert.equal(columnLabel(series({ label: 'R', metrics: [{ id: 'm', type: 'percentile_rank', field: 'bytes', values: ['10', '20'] }] })), 'R (20)');
    assert.equal(columnLabel(series({ label: 'R', metrics: [{ id: 'm', type: 'percentile_rank', field: 'bytes', values: [] }] })), 'R (0)');
  });

  it('titles the first column with the label given, else with the field the rows are grouped by', () => {
    assert.equal(pivotLabel({ pivot_label: 'Type', pivot_id: 'extension.keyword' }), 'Type');
    assert.equal(pivotLabel({ pivot_label: '', pivot_field: 'host', pivot_id: 'extension.keyword' }), 'host');
    assert.equal(pivotLabel({ pivot_id: 'extension.keyword' }), 'extension.keyword');
    assert.equal(pivotLabel({}), '');
  });

  it('shows an arrow on the column sorted by, room for one on a column that could sort, nothing on one that cannot', () => {
    assert.equal(sortIcon(DEFAULT_SORT, '_default_', true), 'sortUp');
    assert.equal(sortIcon({ column: '_default_', order: 'desc' }, '_default_', true), 'sortDown');
    assert.equal(sortIcon(DEFAULT_SORT, 'series-1', true), 'empty');
    assert.equal(sortIcon({ column: 'series-1', order: 'desc' }, 'series-1', true), 'sortDown');
    assert.equal(sortIcon({ column: 'series-1', order: 'asc' }, 'series-1', false), undefined);
    // A sort without an order is not upwards, as the product reads it
    assert.equal(sortIcon({ column: 'series-1' }, 'series-1', true), 'sortDown');
  });

  it('sorts upwards by a column clicked first, and turns the order round at each further click', () => {
    assert.deepEqual(nextSort(DEFAULT_SORT, 'series-1'), { column: 'series-1', order: 'asc' });
    assert.deepEqual(nextSort({ column: 'series-1', order: 'asc' }, 'series-1'), { column: 'series-1', order: 'desc' });
    assert.deepEqual(nextSort({ column: 'series-1', order: 'desc' }, 'series-1'), { column: 'series-1', order: 'asc' });
    assert.deepEqual(nextSort({ column: 'series-1', order: 'desc' }, '_default_'), { column: '_default_', order: 'asc' });
    assert.deepEqual(nextSort(DEFAULT_SORT, '_default_'), { column: '_default_', order: 'desc' });
  });

  it('tells the trend of a row from its last two buckets, as the product does', () => {
    // The product's own cases: ten buckets rising, falling and flat, and a single bucket
    const rising = points([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const falling = points([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
    const flat = points([1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
    assert.ok(trendSinceLastBucket(rising) > 0);
    assert.ok(trendSinceLastBucket(falling) <= 0);
    assert.equal(trendSinceLastBucket(flat), 0);
    assert.equal(trendSinceLastBucket(points([1])), 0);
    assert.equal(trendSinceLastBucket([]), 0);
    assert.equal(trendSinceLastBucket(rising), 0.1);
    assert.equal(trendSinceLastBucket(falling), -1);
    // Nothing in both buckets is no number, which counts as flat; a last bucket of nothing falls
    assert.equal(trendSinceLastBucket(points([3, null, null])), 0);
    assert.equal(trendSinceLastBucket(points([3, 0])), Number.NEGATIVE_INFINITY);
    assert.equal(trendSinceLastBucket(points([3, null])), Number.NEGATIVE_INFINITY);
    // Only the last two buckets count: a long rise that ends in a fall is a fall
    assert.ok(trendSinceLastBucket(points([1, 2, 3, 4, 2])) < 0);
    assert.equal(trendIcon(rising), 'sortUp');
    assert.equal(trendIcon(falling), 'sortDown');
    assert.equal(trendIcon(flat), 'sortDown');
    assert.equal(trendIcon(points([1, 2, 3, 4, 2])), 'sortDown');
  });

  it('writes a row by the value OpenSearch gives, and as a date only when the field is one', () => {
    const format = (time: number) => `date ${time}`;
    assert.equal(rowDisplay('css', 'string', format), 'css');
    assert.equal(rowDisplay('1', 'boolean', format), '1');
    assert.equal(rowDisplay('1794787200000', undefined, format), '1794787200000');
    assert.equal(rowDisplay('1794787200000', 'date', format), 'date 1794787200000');
  });
});

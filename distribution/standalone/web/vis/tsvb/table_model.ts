/* SPDX-License-Identifier: Apache-2.0 */

/*
 * What the TSVB table works out before it draws, as the product's table (`vis_types/table/vis.js`)
 * and the server that feeds it (`vis_data/table/process_bucket.js`) do.
 */

import { metricLabel, type TsvbParams, type TsvbPoint, type TsvbSeries, type TsvbTableSort } from './data';

/** The column the rows are grouped by, as a sort names it */
export const PIVOT_COLUMN = '_default_';

/** How a table is sorted while its UI state says nothing: by the field it groups by, upwards */
export const DEFAULT_SORT: Required<TsvbTableSort> = { column: PIVOT_COLUMN, order: 'asc' };

/** A column's title: the series' label or its metric's, with the percentile or the rank it shows */
export function columnLabel(series: TsvbSeries): string {
  const metric = series.metrics?.[series.metrics.length - 1];
  const label = series.label || metricLabel(series);
  if (metric?.type === 'percentile') return `${label} (${metric.percentiles?.[metric.percentiles.length - 1]?.value || 0})`;
  if (metric?.type === 'percentile_rank') return `${label} (${metric.values?.[metric.values.length - 1] || 0})`;
  return label;
}

/** The first column's title: the label given to the field the rows are grouped by, or that field */
export function pivotLabel(params: Pick<TsvbParams, 'pivot_label' | 'pivot_id'> & { pivot_field?: string }): string {
  return params.pivot_label || params.pivot_field || params.pivot_id || '';
}

/**
 * The icon in a column's title: an arrow on the column the rows are sorted by, room for one on any
 * other they could be sorted by, and nothing on a column that cannot sort them
 */
export function sortIcon(sort: TsvbTableSort, column: string, sortable: boolean): 'sortUp' | 'sortDown' | 'empty' | undefined {
  if (!sortable) return undefined;
  if (sort.column !== column) return 'empty';
  return sort.order === 'asc' ? 'sortUp' : 'sortDown';
}

/** What a click on a column's title asks for: upwards, or the other way round when it sorts already */
export function nextSort(sort: TsvbTableSort, column: string): Required<TsvbTableSort> {
  return { column, order: sort.column === column && sort.order === 'asc' ? 'desc' : 'asc' };
}

/**
 * Whether a row's value rose or fell at its last bucket: the change from the bucket before as a
 * share of the last one, 0 while there are not two buckets or the share is not a number. Above 0
 * the table draws an arrow up, else an arrow down.
 */
export function trendSinceLastBucket(data: TsvbPoint[]): number {
  if (data.length < 2) return 0;
  // A bucket without a value counts as 0, as it does in the product's arithmetic
  const current = Number(data[data.length - 1]?.[1] ?? 0);
  const previous = Number(data[data.length - 2]?.[1] ?? 0);
  const trend = (current - previous) / current;
  return Number.isNaN(trend) ? 0 : trend;
}

/** The arrow of a row's trend */
export const trendIcon = (data: TsvbPoint[]): 'sortUp' | 'sortDown' => (trendSinceLastBucket(data) > 0 ? 'sortUp' : 'sortDown');

/**
 * A row's name as the table writes it: the value of the field the rows are grouped by as OpenSearch
 * gives it, or a date written with `format` when that field is a date
 */
export function rowDisplay(key: string, pivotType: string | undefined, format: (time: number) => string): string {
  return pivotType === 'date' ? format(Number(key)) : key;
}

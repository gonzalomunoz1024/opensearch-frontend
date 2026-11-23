/* SPDX-License-Identifier: Apache-2.0 */

/*
 * What a chart of point series makes of its bucket along the axis and of the clicks and brushes
 * on it, as OpenSearch Dashboards does for its classic charts: a date histogram bounded by the
 * time range, its days, weeks, months and years counted by the calendar; a click filters on the
 * mark's bucket, its series' first group and the bucket of its chart in a split; a brush across
 * time sets the time range, or filters on the field, and one across a number histogram filters on
 * the buckets it takes.
 */

import { brushFilter, bucketFilter, dateInterval, type AggContext, type Table, type TableColumn } from '../../lib/aggs';
import { addUnits, type TimeUnit } from '../../lib/dates';
import type { Filter } from '../../lib/types';
import { bucketColumns, type SplitBucket, type VisRenderProps } from '../types';
import type { PointSeriesModel } from './point_series_model';
import type { VislibPoint } from './point_series_data';
import type { TooltipDetail } from './tooltip';

export interface SeriesAxis {
  /** The bucket along the chart */
  xColumn?: TableColumn;
  /** Whether it is a date histogram of the index pattern's time field */
  isTimeField: boolean;
  /** The time range, when a date histogram is bounded by it */
  bounds?: { min: number; max: number };
  /** Moves a time on by whole intervals, when they are days, weeks, months or years */
  addInterval?: (value: number, times: number) => number;
}

/** The bucket along a chart, and how its time is bounded and counted */
export function seriesAxisOf(table: Table, context: AggContext): SeriesAxis {
  const xColumn = bucketColumns(table, 'segment')[0];
  const isTimeField = Boolean(xColumn?.isDate && xColumn.fieldName === context.indexPattern?.timeFieldName);
  // A date histogram is bounded by the time range when it counts by the time field, or when it
  // chooses its interval itself, whatever date it counts by
  const bounded = Boolean(xColumn?.isDate && (isTimeField || (xColumn.agg.params?.interval ?? 'auto') === 'auto'));
  const range = context.timeRange;
  const bounds = bounded && range ? { min: range.from.getTime(), max: range.to.getTime() } : undefined;
  // Days, weeks, months and years are counted by the calendar, as moment adds them
  let addInterval: ((value: number, times: number) => number) | undefined;
  if (xColumn?.isDate) {
    const match = /^(\d+(?:\.\d+)?)([dwMy])$/.exec(dateInterval(xColumn.agg, context).expression);
    if (match) {
      const amount = Number(match[1]);
      const unit = match[2] as TimeUnit;
      addInterval = (value, times) => addUnits(new Date(value), amount * times, unit).getTime();
    }
  }
  return { xColumn, isTimeField, bounds, addInterval };
}

export interface SeriesEventsInput extends Pick<VisRenderProps, 'onFilter' | 'onTimeChange' | 'split'> {
  model: PointSeriesModel;
  axis: SeriesAxis;
  context: AggContext;
  /** The chart's table: the "Other" bucket of a click filters out the terms beside it there */
  table: Table;
}

export interface SeriesEvents {
  onPointClick?: (point: VislibPoint) => void;
  onBrush?: (range: { from: number; to: number } | { values: Array<number | string> }) => void;
}

/** A click on a mark and a brush along the axis, as filters or a time range */
export function seriesEvents({ model, axis, context, table, onFilter, onTimeChange, split }: SeriesEventsInput): SeriesEvents {
  const { xColumn, isTimeField } = axis;
  // A click on a mark filters on its bucket along the axis, on its series' first group and on
  // the bucket of its chart in a split
  const onPointClick = onFilter
    ? (point: VislibPoint) => {
        const filters: Filter[] = [];
        const raw = point.row;
        if (xColumn && raw) {
          const filter = bucketFilter(xColumn, raw[xColumn.id], context, { table, row: raw });
          if (filter) filters.push(filter);
        }
        const group = model.data.groupColumns[0];
        if (group && raw) {
          const filter = bucketFilter(group, raw[group.id], context, { table, row: raw });
          if (filter) filters.push(filter);
        }
        const splitFilter = split && bucketFilter(split.column, split.key, context, split.cell);
        if (splitFilter) filters.push(splitFilter);
        if (filters.length) onFilter(filters);
      }
    : undefined;

  const onBrush =
    xColumn?.fieldName && (onFilter || onTimeChange)
      ? (range: { from: number; to: number } | { values: Array<number | string> }) => {
          if ('from' in range) {
            if (isTimeField && onTimeChange) {
              onTimeChange({ from: new Date(range.from).toISOString(), to: new Date(range.to).toISOString() });
              return;
            }
            const filter = brushFilter(xColumn, range.from, range.to, context);
            if (filter) onFilter?.([filter]);
            return;
          }
          // The buckets taken: from the first, up to the last, which the filter leaves out
          const values = range.values;
          if (values.length <= 1) return;
          const filter = brushFilter(xColumn, Number(values[0]), Number(values[values.length - 1]), context);
          if (filter) onFilter?.([filter]);
        }
      : undefined;

  return { onPointClick, onBrush };
}

/**
 * The last line of the tooltip of a chart in a split, as vislib's writes it: the split's name and
 * the chart's bucket as its key is, unformatted (a date as its time in milliseconds), and nothing
 * for a key that is not a text or a number. A range's key, an object the original's tooltip fails
 * on and shows nothing for, is written as the bucket's text.
 */
export function splitTooltipDetail({ column, key }: SplitBucket): TooltipDetail {
  let value = '';
  if (typeof key === 'string') value = key;
  else if (typeof key === 'number') value = String(key);
  else if (key !== null && typeof key === 'object') value = column.format(key);
  return { label: column.name, value };
}

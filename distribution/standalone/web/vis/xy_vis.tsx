/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Area, line, vertical bar and horizontal bar: a table of buckets and measures as series on axes,
 * drawn as the classic charts of OpenSearch Dashboards draw them (vislib, in ./vislib).
 */

import { useCallback, useMemo } from 'react';
import { ChartMessage } from '../charts/core';
import { bucketFilter, dateInterval } from '../lib/aggs';
import { DEFAULT_FORMAT_SETTINGS, createFormatter } from '../lib/field_formats';
import { rangeFilter } from '../lib/query';
import type { Filter } from '../lib/types';
import { services } from '../services';
import { bucketColumns, type VisRenderProps } from './types';
import { seriesColors } from './vislib/colors';
import { PointSeriesChart } from './vislib/point_series_chart';
import { buildPointSeriesModel, type PointSeriesParams } from './vislib/point_series_model';
import type { VislibPoint } from './vislib/point_series_data';
import { dimmingOpacity, zoneOffset } from './vislib/settings';
import { useVislibLegend } from './vislib/use_legend';
import '../styles/vislib.css';

export function XYVis({ vis, data, uiState, onUiState, onFilter, onTimeChange }: VisRenderProps) {
  const params = vis.params as PointSeriesParams;
  const { table, context } = data;
  const settings = context.formatSettings ?? DEFAULT_FORMAT_SETTINGS;

  const prepared = useMemo(() => {
    const xColumn = bucketColumns(table, 'segment')[0];
    const isTimeField = Boolean(xColumn?.isDate && xColumn.fieldName === context.indexPattern?.timeFieldName);
    // A date histogram is bounded by the time range when it counts by the time field, or when it
    // chooses its interval itself, whatever date it counts by
    const bounded = Boolean(xColumn?.isDate && (isTimeField || (xColumn.agg.params?.interval ?? 'auto') === 'auto'));
    const range = context.timeRange;
    const bounds = bounded && range ? { min: range.from.getTime(), max: range.to.getTime() } : undefined;
    // Months and years are counted by the calendar
    let addInterval: ((value: number, times: number) => number) | undefined;
    if (xColumn?.isDate) {
      const interval = dateInterval(xColumn.agg, context);
      const unit = /^\d+(?:\.\d+)?(M|y)$/.exec(interval.expression)?.[1];
      const amount = Number(/^(\d+(?:\.\d+)?)/.exec(interval.expression)?.[1] ?? 1);
      if (unit) {
        addInterval = (value, times) => {
          const date = new Date(value);
          if (unit === 'M') date.setUTCMonth(date.getUTCMonth() + amount * times);
          else date.setUTCFullYear(date.getUTCFullYear() + amount * times);
          return date.getTime();
        };
      }
    }
    const percent = createFormatter({ id: 'percent' }, settings);
    const model = buildPointSeriesModel({
      params,
      table,
      percentFormat: (value) => percent(value).text,
      bounds,
      addInterval,
    });
    return { model, xColumn, isTimeField };
  }, [table, context, params, settings]);

  const { model, xColumn, isTimeField } = prepared;
  const colors = useMemo(
    () =>
      seriesColors(
        model.labels,
        uiState.vis?.colors,
        services.uiSettings?.get<Record<string, string>>('visualization:colorMapping', {})
      ),
    [model, uiState.vis?.colors]
  );
  const colorOf = useCallback((label: string) => colors.get(label) ?? '#54B399', [colors]);
  const offsetAt = useMemo(() => zoneOffset(settings.timeZone), [settings.timeZone]);
  const dimming = dimmingOpacity(services.uiSettings?.get('visualization:dimmingOpacity', 0.5));

  // The bucket a series stands for: its first group's value, as the original's legend filters on it
  const groupFilter = (label: string): Filter | undefined => {
    const series = model.data.series.find((item) => item.label === label);
    const column = model.data.groupColumns[0];
    if (!series || !column) return undefined;
    return bucketFilter(column, series.groupKeys[0], context);
  };
  const legend = useVislibLegend({
    addLegend: params.addLegend,
    legendPosition: params.legendPosition,
    uiState,
    onUiState,
    onFilter,
    filterOf: groupFilter,
  });

  if (table.rows.length === 0) return <ChartMessage>No results found</ChartMessage>;

  // A click on a mark filters on its bucket along the axis and on its series' first group
  const onPointClick = onFilter
    ? (point: VislibPoint) => {
        const filters: Filter[] = [];
        const raw = point.row;
        if (xColumn && raw) {
          const filter = bucketFilter(xColumn, raw[xColumn.id], context);
          if (filter) filters.push(filter);
        }
        const group = model.data.groupColumns[0];
        if (group && raw) {
          const filter = bucketFilter(group, raw[group.id], context);
          if (filter) filters.push(filter);
        }
        if (filters.length) onFilter(filters);
      }
    : undefined;

  const onBrush =
    xColumn?.fieldName && (onFilter || onTimeChange)
      ? (range: { from: number; to: number } | { values: Array<number | string> }) => {
          const field = { name: xColumn.fieldName ?? '' };
          if ('from' in range) {
            if (isTimeField && onTimeChange) {
              onTimeChange({ from: new Date(range.from).toISOString(), to: new Date(range.to).toISOString() });
            } else {
              onFilter?.([
                rangeFilter(
                  field,
                  { gte: new Date(range.from).toISOString(), lt: new Date(range.to).toISOString(), format: 'strict_date_optional_time' },
                  context.indexPattern?.id
                ),
              ]);
            }
            return;
          }
          // The buckets taken: from the first, up to the last, which the filter leaves out
          const values = range.values;
          if (values.length <= 1) return;
          const min = values[0];
          const max = values[values.length - 1];
          if (min === max) return;
          onFilter?.([rangeFilter(field, { gte: Number(min), lt: Number(max) }, context.indexPattern?.id)]);
        }
      : undefined;

  return (
    <PointSeriesChart
      model={model}
      colorOf={colorOf}
      offsetAt={offsetAt}
      dimming={dimming}
      legend={legend}
      onPointClick={onPointClick}
      onBrush={onBrush}
    />
  );
}

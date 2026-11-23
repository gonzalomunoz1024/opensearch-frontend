/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Area, line, vertical bar and horizontal bar: a table of buckets and measures as series on axes,
 * drawn as the classic charts of OpenSearch Dashboards draw them (vislib, in ./vislib).
 */

import { useCallback, useMemo } from 'react';
import { ChartMessage } from '../charts/core';
import { bucketFilter } from '../lib/aggs';
import { DEFAULT_FORMAT_SETTINGS, createFormatter } from '../lib/field_formats';
import type { Filter } from '../lib/types';
import { services } from '../services';
import type { VisRenderProps } from './types';
import { seriesColors } from './vislib/colors';
import { PointSeriesChart } from './vislib/point_series_chart';
import { buildPointSeriesModel, type PointSeriesParams } from './vislib/point_series_model';
import { seriesAxisOf, seriesEvents } from './vislib/series_events';
import { dimmingOpacity, zoneOffset } from './vislib/settings';
import { useVislibLegend } from './vislib/use_legend';
import '../styles/vislib.css';

export function XYVis({ vis, data, uiState, onUiState, onFilter, onTimeChange, split }: VisRenderProps) {
  const params = vis.params as PointSeriesParams;
  const { table, context } = data;
  const settings = context.formatSettings ?? DEFAULT_FORMAT_SETTINGS;

  const prepared = useMemo(() => {
    const axis = seriesAxisOf(table, context);
    const percent = createFormatter({ id: 'percent' }, settings);
    const model = buildPointSeriesModel({
      params,
      table,
      percentFormat: (value) => percent(value).text,
      bounds: axis.bounds,
      addInterval: axis.addInterval,
    });
    return { model, axis };
  }, [table, context, params, settings]);

  const { model, axis } = prepared;
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

  // The bucket a series stands for: its first group's value in the series' first row, as the
  // original's legend filters on it
  const groupFilter = (label: string): Filter | undefined => {
    const series = model.data.series.find((item) => item.label === label);
    const column = model.data.groupColumns[0];
    if (!series || !column) return undefined;
    const rows = new Set(series.values.map((point) => point.row));
    const row = table.rows.find((candidate) => rows.has(candidate));
    return bucketFilter(column, series.groupKeys[0], context, row && { table, row });
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

  const { onPointClick, onBrush } = seriesEvents({ model, axis, context, table, onFilter, onTimeChange, split });
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

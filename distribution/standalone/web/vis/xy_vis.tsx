/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Area, line, vertical bar and horizontal bar: a table of buckets and measures as series on axes,
 * drawn as the classic charts of OpenSearch Dashboards draw them (vislib, in ./vislib). A split
 * draws a chart per bucket on the axes they share, with one legend for them all.
 */

import { useCallback, useMemo } from 'react';
import { ChartMessage } from '../charts/core';
import { bucketFilter } from '../lib/aggs';
import { DEFAULT_FORMAT_SETTINGS, createFormatter } from '../lib/field_formats';
import type { Filter } from '../lib/types';
import { services } from '../services';
import type { VisRenderProps } from './types';
import { seriesColors } from './vislib/colors';
import { PointSeriesChart, type PointSeriesChartPart } from './vislib/point_series_chart';
import { buildPointSeriesModel, buildSplitPointSeriesModels, type PointSeriesParams } from './vislib/point_series_model';
import { seriesAxisOf, seriesEvents, splitTooltipDetail, type SeriesEvents } from './vislib/series_events';
import { dimmingOpacity, zoneOffset } from './vislib/settings';
import { useVislibLegend } from './vislib/use_legend';
import '../styles/vislib.css';

export function XYVis({ vis, data, uiState, onUiState, onFilter, onTimeChange, split, splits }: VisRenderProps) {
  const params = vis.params as PointSeriesParams;
  const { table, context } = data;
  const settings = context.formatSettings ?? DEFAULT_FORMAT_SETTINGS;

  const prepared = useMemo(() => {
    const axis = seriesAxisOf(table, context);
    const percent = createFormatter({ id: 'percent' }, settings);
    const input = { params, percentFormat: (value: number) => percent(value).text, bounds: axis.bounds, addInterval: axis.addInterval };
    // A split's charts, each of its own rows, on what they share
    if (splits) {
      const { frame, charts } = buildSplitPointSeriesModels({
        ...input,
        tables: splits.parts.map((part) => part.table),
        columnCount: table.columns.length,
      });
      return { model: frame, charts, axis };
    }
    return { model: buildPointSeriesModel({ ...input, table }), charts: undefined, axis };
  }, [table, context, params, settings, splits]);

  const { model, charts, axis } = prepared;
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

  // Each chart with the rows it draws: in a split, those of its part
  const sources = charts && splits ? charts.map((chart, index) => ({ model: chart, table: splits.parts[index].table })) : [{ model, table }];

  // The bucket a series stands for: its first group's value in the series' first row, as the
  // original's legend filters on it; in a split, in the first chart that has the series
  const groupFilter = (label: string): Filter | undefined => {
    for (const source of sources) {
      const series = source.model.data.series.find((item) => item.label === label);
      if (!series) continue;
      const column = source.model.data.groupColumns[0];
      if (!column) return undefined;
      const rows = new Set(series.values.map((point) => point.row));
      const row = source.table.rows.find((candidate) => rows.has(candidate));
      return bucketFilter(column, series.groupKeys[0], context, row && { table: source.table, row });
    }
    return undefined;
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

  // A click on a mark of a split's chart filters on its bucket too; the tooltip names it last
  const parts: PointSeriesChartPart[] | undefined =
    charts && splits
      ? charts.map((chart, index) => {
          const part = splits.parts[index];
          const events = seriesEvents({ model: chart, axis, context, table: part.table, onFilter, onTimeChange, split: part.split });
          return { model: chart, title: part.label, splitDetail: splitTooltipDetail(part.split), ...events };
        })
      : undefined;
  const events: SeriesEvents = parts ? {} : seriesEvents({ model, axis, context, table, onFilter, onTimeChange, split });
  return (
    <PointSeriesChart
      model={model}
      charts={parts}
      rows={splits?.rows}
      colorOf={colorOf}
      offsetAt={offsetAt}
      dimming={dimming}
      legend={legend}
      onPointClick={events.onPointClick}
      onBrush={events.onBrush}
    />
  );
}

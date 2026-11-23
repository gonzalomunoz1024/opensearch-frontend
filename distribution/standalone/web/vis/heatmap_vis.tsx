/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Heat map: a measure for each pair of buckets, as the shade of a square in a matrix, drawn as
 * the classic charts of OpenSearch Dashboards draw it (vislib, in ./vislib). A split draws a heat
 * map per bucket on the axes they share, in the colours of the values of all of them.
 */

import { useCallback, useMemo } from 'react';
import { ChartMessage, assignColors } from '../charts/core';
import { DEFAULT_FORMAT_SETTINGS, createFormatter } from '../lib/field_formats';
import { services } from '../services';
import type { VisRenderProps } from './types';
import { buildHeatmapModel, buildSplitHeatmapModels, type HeatmapParams } from './vislib/heatmap';
import { PointSeriesChart, type PointSeriesChartPart } from './vislib/point_series_chart';
import type { PointSeriesModel } from './vislib/point_series_model';
import { seriesAxisOf, seriesEvents, splitTooltipDetail, type SeriesEvents } from './vislib/series_events';
import { dimmingOpacity, zoneOffset } from './vislib/settings';
import { useVislibLegend } from './vislib/use_legend';
import '../styles/vislib.css';

/** What a heat map's params take when they leave a setting out, as its type's defaults */
const DEFAULTS: HeatmapParams = {
  type: 'heatmap',
  addTooltip: true,
  addLegend: true,
  enableHover: false,
  legendPosition: 'right',
  colorsNumber: 4,
  colorSchema: 'Greens',
  setColorRange: false,
  colorsRange: [],
  invertColors: false,
  percentageMode: false,
  valueAxes: [
    {
      show: false,
      id: 'ValueAxis-1',
      type: 'value',
      scale: { type: 'linear', defaultYExtents: false },
      labels: { show: false, rotate: 0, overwriteColor: false, color: 'black' },
    },
  ],
};

/** A visualization's params over its type's defaults: a setting left out takes the default */
function withDefaults(params: Record<string, unknown>): HeatmapParams {
  const merged: Record<string, unknown> = { ...DEFAULTS };
  for (const [key, value] of Object.entries(params)) if (value !== undefined) merged[key] = value;
  return merged as HeatmapParams;
}

export function HeatmapVis({ vis, data, uiState, onUiState, onFilter, onTimeChange, split, splits }: VisRenderProps) {
  const params = useMemo(() => withDefaults(vis.params), [vis.params]);
  const { table, context } = data;
  const settings = context.formatSettings ?? DEFAULT_FORMAT_SETTINGS;
  const dark = services.uiSettings?.get<boolean>('theme:darkMode', false) === true;
  const maxBuckets = Number(services.uiSettings?.get('visualization:heatmap:maxBuckets', 50));

  const prepared = useMemo(() => {
    const axis = seriesAxisOf(table, context);
    const percent = createFormatter({ id: 'percent' }, settings);
    const input = {
      params,
      percentFormat: (value: number) => percent(value).text,
      bounds: axis.bounds,
      addInterval: axis.addInterval,
      maxBuckets,
      dark,
    };
    let model: PointSeriesModel;
    let charts: PointSeriesModel[] | undefined;
    if (splits) {
      // A split's heat maps, each of its own rows, on what they share
      const built = buildSplitHeatmapModels({ ...input, tables: splits.parts.map((part) => part.table), columnCount: table.columns.length });
      model = built.frame;
      charts = built.charts;
    } else {
      model = buildHeatmapModel({ ...input, table });
    }
    // The series of every chart take their place in the page's memory of colours, as in OpenSearch Dashboards
    assignColors([...new Set((charts ?? [model]).flatMap((chart) => chart.data.series.map((series) => series.label)))]);
    return { model, charts, axis };
  }, [table, context, params, settings, maxBuckets, dark, splits]);
  const { model, charts, axis } = prepared;

  // A range's colour: the one picked for it in the legend, else the schema's
  const picked = uiState.vis?.colors;
  const colorOf = useCallback(
    (label: string) => picked?.[label] ?? model.heatmap?.colors[label] ?? 'currentColor',
    [picked, model]
  );
  const offsetAt = useMemo(() => zoneOffset(settings.timeZone), [settings.timeZone]);
  const dimming = dimmingOpacity(services.uiSettings?.get('visualization:dimmingOpacity', 0.5));

  // The ranges of the legend stand for no bucket, so it does not filter
  const legend = useVislibLegend({
    addLegend: params.addLegend,
    legendPosition: params.legendPosition,
    uiState,
    onUiState,
    onFilter,
  });

  if (table.rows.length === 0) return <ChartMessage>No results found</ChartMessage>;

  // A click on a square of a split's heat map filters on its bucket too; the tooltip names it last
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

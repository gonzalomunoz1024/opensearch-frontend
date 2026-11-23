/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Heat map: a measure for each pair of buckets, as the shade of a square in a matrix, drawn as
 * the classic charts of OpenSearch Dashboards draw it (vislib, in ./vislib).
 */

import { useCallback, useMemo } from 'react';
import { ChartMessage, assignColors } from '../charts/core';
import { DEFAULT_FORMAT_SETTINGS, createFormatter } from '../lib/field_formats';
import { services } from '../services';
import type { VisRenderProps } from './types';
import { buildHeatmapModel, type HeatmapParams } from './vislib/heatmap';
import { PointSeriesChart } from './vislib/point_series_chart';
import { seriesAxisOf, seriesEvents } from './vislib/series_events';
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

export function HeatmapVis({ vis, data, uiState, onUiState, onFilter, onTimeChange, split }: VisRenderProps) {
  const params = useMemo(() => withDefaults(vis.params), [vis.params]);
  const { table, context } = data;
  const settings = context.formatSettings ?? DEFAULT_FORMAT_SETTINGS;
  const dark = services.uiSettings?.get<boolean>('theme:darkMode', false) === true;
  const maxBuckets = Number(services.uiSettings?.get('visualization:heatmap:maxBuckets', 50));

  const prepared = useMemo(() => {
    const axis = seriesAxisOf(table, context);
    const percent = createFormatter({ id: 'percent' }, settings);
    const model = buildHeatmapModel({
      params,
      table,
      percentFormat: (value) => percent(value).text,
      bounds: axis.bounds,
      addInterval: axis.addInterval,
      maxBuckets,
      dark,
    });
    // The series take their place in the page's memory of colours, as in OpenSearch Dashboards
    assignColors([...new Set(model.data.series.map((series) => series.label))]);
    return { model, axis };
  }, [table, context, params, settings, maxBuckets, dark]);
  const { model, axis } = prepared;

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

  const { onPointClick, onBrush } = seriesEvents({ model, axis, context, onFilter, onTimeChange, split });
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

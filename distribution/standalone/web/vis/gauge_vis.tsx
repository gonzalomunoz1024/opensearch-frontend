/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Gauge and goal: where a measure stands between the ends of its ranges, as an arc or a ring,
 * drawn as the classic charts of OpenSearch Dashboards draw it (vislib, in ./vislib).
 */

import { useCallback, useMemo } from 'react';
import { assignColors } from '../charts/core';
import { DEFAULT_FORMAT_SETTINGS, createFormatter } from '../lib/field_formats';
import { services } from '../services';
import type { VisRenderProps } from './types';
import { gaugeColors, gaugeLabels, meterConfig } from './vislib/gauge';
import { GaugeChart, type GaugeSeries } from './vislib/gauge_chart';
import type { LegendPosition } from './vislib/legend';
import { buildPointSeries, keyLabel } from './vislib/point_series_data';
import { dimmingOpacity } from './vislib/settings';
import type { TooltipDetail } from './vislib/tooltip';
import { useVislibLegend } from './vislib/use_legend';
import '../styles/vislib.css';

type Params = Record<string, unknown>;

/** What a gauge's params take when they leave a setting out, as its type's defaults */
const GAUGE_DEFAULTS: Params = {
  type: 'gauge',
  addTooltip: true,
  addLegend: true,
  isDisplayWarning: false,
  gauge: {
    alignment: 'automatic',
    extendRange: true,
    percentageMode: false,
    gaugeType: 'Arc',
    gaugeStyle: 'Full',
    backStyle: 'Full',
    orientation: 'vertical',
    colorSchema: 'Green to Red',
    gaugeColorMode: 'Labels',
    colorsRange: [
      { from: 0, to: 50 },
      { from: 50, to: 75 },
      { from: 75, to: 100 },
    ],
    invertColors: false,
    labels: { show: true, color: 'black' },
    scale: { show: true, labels: false, color: 'rgba(105,112,125,0.2)' },
    type: 'meter',
    style: {
      bgWidth: 0.9,
      width: 0.9,
      mask: false,
      bgMask: false,
      maskBars: 50,
      bgFill: 'rgba(105,112,125,0.2)',
      bgColor: true,
      subText: '',
      fontSize: 60,
    },
  },
};

/** And a goal's */
const GOAL_DEFAULTS: Params = {
  addTooltip: true,
  addLegend: false,
  isDisplayWarning: false,
  type: 'gauge',
  gauge: {
    verticalSplit: false,
    autoExtend: false,
    percentageMode: true,
    gaugeType: 'Arc',
    gaugeStyle: 'Full',
    backStyle: 'Full',
    orientation: 'vertical',
    useRanges: false,
    colorSchema: 'Green to Red',
    gaugeColorMode: 'None',
    colorsRange: [{ from: 0, to: 10000 }],
    invertColors: false,
    labels: { show: true, color: 'black' },
    scale: { show: false, labels: false, color: 'rgba(105,112,125,0.2)', width: 2 },
    type: 'meter',
    style: { bgFill: 'rgba(105,112,125,0.2)', bgColor: false, labelColor: false, subText: '', fontSize: 60 },
  },
};

const POSITIONS: LegendPosition[] = ['top', 'bottom', 'left', 'right'];

/** A visualization's params over its type's defaults: a setting left out takes the default */
function withDefaults(defaults: Params, params: Params): Params {
  const merged: Params = { ...defaults };
  for (const [key, value] of Object.entries(params)) if (value !== undefined) merged[key] = value;
  return merged;
}

export function GaugeVis({ vis, data, uiState, onUiState, split }: VisRenderProps) {
  const params = useMemo(() => withDefaults(vis.type === 'goal' ? GOAL_DEFAULTS : GAUGE_DEFAULTS, vis.params), [vis.type, vis.params]);
  const config = useMemo(() => meterConfig(params.gauge), [params]);
  const { table, context } = data;
  const settings = context.formatSettings ?? DEFAULT_FORMAT_SETTINGS;
  const dark = services.uiSettings?.get<boolean>('theme:darkMode', false) === true;
  // The values are written as shares only when the percentage mode is set, which the meter assumes when it is left out
  const gauge = params.gauge;
  const percentageMode = typeof gauge === 'object' && gauge !== null && 'percentageMode' in gauge && gauge.percentageMode === true;

  const prepared = useMemo(() => {
    const percent = createFormatter({ id: 'percent' }, settings);
    const metricAggs = new Set(table.columns.filter((column) => column.kind === 'metric').map((column) => column.agg.id));
    const points = buildPointSeries(table.columns, table.rows, {
      percentFormat: (value) => percent(value).text,
      percentAggs: percentageMode ? metricAggs : undefined,
    });
    // The series take their place in the page's memory of colours, as in OpenSearch Dashboards
    assignColors([...new Set(points.series.map((series) => series.label))]);
    const parent = points.groupColumns[0];
    // A chart of a split names its bucket in the tooltip by its key as it is
    const splitDetail: TooltipDetail | undefined = split
      ? {
          label: split.column.name,
          value: split.key !== null && typeof split.key === 'object' ? keyLabel(split.column, split.key) : String(split.key),
        }
      : undefined;
    const series: GaugeSeries[] = points.series.map((item) => {
      const point = item.values[0];
      const y = point?.y ?? null;
      const details: TooltipDetail[] = [{ label: points.xLabel, value: points.xFormat(point?.x ?? '_all') }];
      if (y !== null) details.push({ label: points.columnCount > 2 ? item.metric.name : item.label, value: item.format(y) });
      if (parent && point?.series) details.push({ label: parent.name, value: point.series });
      if (splitDetail) details.push(splitDetail);
      return {
        label: item.label,
        y,
        // A value that is not there is written as the number formats write it: not at all
        format: (value: number | null) => (value === null ? '' : item.format(value)),
        details,
      };
    });
    const title = split ? `${keyLabel(split.column, split.key)}: ${split.column.name}` : points.yLabel;
    return { series, title };
  }, [table, settings, percentageMode, split]);

  const labels = useMemo(() => gaugeLabels(config), [config]);
  const rangeColors = useMemo(() => gaugeColors(config, dark), [config, dark]);
  // A range's colour: the one picked for it in the legend, else the schema's
  const picked = uiState.vis?.colors;
  const colorOf = useCallback((label: string) => picked?.[label] ?? rangeColors[label] ?? 'currentColor', [picked, rangeColors]);
  const dimming = dimmingOpacity(services.uiSettings?.get('visualization:dimmingOpacity', 0.5));

  // The legend lists the ranges, which stand for no bucket: it does not filter. A gauge has no
  // position for it, unless its params give one
  const chartLegend = useVislibLegend({ addLegend: Boolean(params.addLegend), legendPosition: undefined, uiState, onUiState });
  const position = POSITIONS.find((candidate) => candidate === params.legendPosition);
  const legend = chartLegend ? { ...chartLegend, position } : undefined;

  return (
    <GaugeChart
      config={config}
      series={prepared.series}
      title={prepared.title}
      labels={labels}
      colorOf={colorOf}
      addTooltip={Boolean(params.addTooltip)}
      dimming={dimming}
      legend={legend}
    />
  );
}

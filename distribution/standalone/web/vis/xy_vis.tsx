/* SPDX-License-Identifier: Apache-2.0 */

/* Area, line, vertical bar and horizontal bar: a table of buckets and measures as series on axes. */

import { useMemo } from 'react';
import { valueAxisLabels } from '../charts/axis_labels';
import { ChartMessage, assignColors, type LegendPosition, type ScaleKind } from '../charts/core';
import { XYChart, type XYAxis, type XYCategoryAxis, type XYPoint, type XYSeries } from '../charts/xy';
import { bucketFilter, type TableColumn } from '../lib/aggs';
import { rangeFilter } from '../lib/query';
import type { Filter } from '../lib/types';
import { bucketColumns, keyText, metricColumns, numberOf, type VisRenderProps } from './types';

interface SeriesParam {
  show?: boolean | string;
  type?: string;
  mode?: string;
  data?: { id?: string; label?: string };
  valueAxis?: string;
  interpolate?: string;
  showCircles?: boolean;
  drawLinesBetweenPoints?: boolean;
  lineWidth?: number;
}

interface AxisParam {
  id?: string;
  position?: string;
  show?: boolean;
  scale?: { type?: string; mode?: string; min?: number; max?: number; setYExtents?: boolean; defaultYExtents?: boolean };
  labels?: { show?: boolean; rotate?: number; truncate?: number; filter?: boolean };
  title?: { text?: string };
}

interface XYParams {
  type?: string;
  seriesParams?: SeriesParam[];
  valueAxes?: AxisParam[];
  categoryAxes?: AxisParam[];
  grid?: { categoryLines?: boolean; valueAxis?: string };
  addLegend?: boolean;
  addTooltip?: boolean;
  addTimeMarker?: boolean;
  legendPosition?: string;
  thresholdLine?: { show?: boolean; value?: number; width?: number; style?: string; color?: string };
  radiusRatio?: number;
}

const ALL = '_all';

const chartKind = (type: string | undefined, fallback: string): XYSeries['type'] =>
  type === 'line' || type === 'area' || type === 'histogram' ? type : fallback === 'line' || fallback === 'area' ? fallback : 'histogram';

export function XYVis({ vis, data, uiState, onFilter, onTimeChange }: VisRenderProps) {
  const params = vis.params as XYParams;
  const { table, context } = data;

  const model = useMemo(() => {
    const xColumn: TableColumn | undefined = bucketColumns(table, 'segment')[0];
    const groups = bucketColumns(table, 'group');
    const metrics = metricColumns(table);
    const radius = table.columns.find((column) => column.schema === 'radius');
    const numbered = Boolean(xColumn && !xColumn.isDate && xColumn.agg.type === 'histogram');
    const continuous = xColumn && (xColumn.isDate || numbered);
    const xOf = (key: unknown): number | string =>
      !xColumn ? ALL : continuous && typeof key === 'number' ? key : xColumn.format(key);

    const xValues: Array<number | string> = [];
    const xRaw = new Map<number | string, unknown>();
    const made = new Map<string, XYSeries & { groupKeys: unknown[] }>();
    const overrides = uiState.vis?.colors;
    const fallbackType = vis.type === 'horizontal_bar' ? 'histogram' : vis.type;

    for (const row of table.rows) {
      const rawX = xColumn ? row[xColumn.id] : ALL;
      const x = xOf(rawX);
      if (!xRaw.has(x)) {
        xRaw.set(x, rawX);
        xValues.push(x);
      }
      const groupKeys = groups.map((column) => row[column.id]);
      const groupLabel = groups.map((column, index) => column.format(groupKeys[index])).join(' - ');
      metrics.forEach((metric) => {
        const param =
          params.seriesParams?.find((candidate) => candidate.data?.id === metric.agg.id) ?? params.seriesParams?.[0] ?? {};
        if (param.show === false || param.show === 'false') return;
        const id = `${groupKeys.map(keyText).join('|')}|${metric.id}`;
        let series = made.get(id);
        if (!series) {
          const label = groups.length === 0 ? metric.name : metrics.length > 1 ? `${groupLabel}: ${metric.name}` : groupLabel;
          series = {
            id,
            label,
            color: '',
            type: chartKind(param.type, fallbackType),
            mode: param.mode === 'stacked' ? 'stacked' : 'normal',
            axisId: param.valueAxis ?? params.valueAxes?.[0]?.id ?? 'ValueAxis-1',
            interpolate: param.interpolate === 'cardinal' || param.interpolate === 'step-after' ? param.interpolate : 'linear',
            showCircles: param.showCircles !== false,
            drawLines: param.drawLinesBetweenPoints !== false,
            lineWidth: param.lineWidth ?? 2,
            points: [],
            groupKeys,
          };
          made.set(id, series);
        }
        const point: XYPoint = { x, y: numberOf(row, metric) };
        if (radius) point.z = numberOf(row, radius) ?? undefined;
        series.points.push(point);
      });
    }
    if (continuous) xValues.sort((a, b) => (a as number) - (b as number));
    // A series with no bucket at a place on the axis counts as zero there, so that stacks and
    // lines keep their shape; this is what OpenSearch Dashboards does
    if (xColumn) {
      for (const series of made.values()) {
        const have = new Map(series.points.map((point) => [point.x, point]));
        series.points = xValues.map((x) => have.get(x) ?? { x, y: 0 });
      }
    }

    const series = [...made.values()];
    const colors = assignColors(series.map((item) => item.label), overrides);
    for (const item of series) item.color = colors.get(item.label) ?? item.color;
    const category = params.categoryAxes?.[0] ?? {};
    const horizontal = category.position === 'left' || category.position === 'right';
    const axes: XYAxis[] = (params.valueAxes?.length ? params.valueAxes : [{ id: 'ValueAxis-1', position: 'left' }]).map((axis) => {
      const id = axis.id ?? 'ValueAxis-1';
      const first = series.find((item) => item.axisId === id);
      const metric = metrics.find((column) => first?.id.endsWith(`|${column.id}`)) ?? metrics[0];
      const position = axis.position;
      const scale = (axis.scale?.type === 'log' || axis.scale?.type === 'square root' ? axis.scale.type : 'linear') as ScaleKind;
      return {
        id,
        position: position === 'right' || position === 'top' || position === 'bottom' ? position : 'left',
        title: axis.title?.text || metric?.name,
        show: axis.show !== false,
        showLabels: axis.labels?.show !== false,
        scale,
        mode: (axis.scale?.mode as XYAxis['mode']) ?? 'normal',
        min: axis.scale?.setYExtents ? axis.scale.min : undefined,
        max: axis.scale?.setYExtents ? axis.scale.max : undefined,
        fitToData: Boolean(axis.scale?.defaultYExtents),
        ...valueAxisLabels(axis.labels, horizontal, scale === 'log'),
        format: (value: number) => (metric ? metric.format(value) : String(value)),
      };
    });

    const timeRange = context.timeRange;
    const isTimeField = Boolean(xColumn?.isDate && xColumn.fieldName === context.indexPattern?.timeFieldName);
    // Only time runs along a scale; the bars of anything else, a number histogram too, stand side
    // by side with a label each, turned on its side under an upright chart unless the
    // visualization says otherwise
    const x: XYCategoryAxis = {
      type: xColumn?.isDate ? 'time' : 'category',
      values: xValues,
      interval: xColumn?.interval,
      domain: isTimeField && timeRange ? [timeRange.from.getTime(), timeRange.to.getTime()] : undefined,
      format: (value) => (!xColumn ? String(value) : typeof value === 'number' ? xColumn.format(value) : value),
      title: category.title?.text || xColumn?.name || '',
      show: category.show !== false,
      showLabels: category.labels?.show !== false,
      rotate: xColumn?.isDate || horizontal ? 0 : (category.labels?.rotate ?? 90),
      truncate: category.labels?.truncate ?? 100,
      filter: category.labels?.filter,
    };
    return { series, axes, x, xColumn, groups, xRaw, horizontal, isTimeField };
  }, [table, context, params, uiState.vis?.colors, vis.type]);

  if (table.rows.length === 0 || model.series.length === 0) return <ChartMessage>No results found</ChartMessage>;

  const legendPosition = (['top', 'bottom', 'left', 'right'].includes(params.legendPosition ?? '') ? params.legendPosition : 'right') as LegendPosition;
  const showLegend = params.addLegend !== false && uiState.vis?.legendOpen !== false;

  const pointFilters = (series: XYSeries, point: XYPoint): Filter[] => {
    const filters: Filter[] = [];
    if (model.xColumn) {
      const filter = bucketFilter(model.xColumn, model.xRaw.get(point.x), context);
      if (filter) filters.push(filter);
    }
    const keys = (series as XYSeries & { groupKeys?: unknown[] }).groupKeys ?? [];
    model.groups.forEach((column, index) => {
      const filter = bucketFilter(column, keys[index], context);
      if (filter) filters.push(filter);
    });
    return filters;
  };

  const brushable = model.xColumn && (model.xColumn.isDate || model.xColumn.agg.type === 'histogram');
  const onBrush = (from: number, to: number) => {
    const column = model.xColumn;
    if (!column?.fieldName) return;
    if (column.isDate && model.isTimeField && onTimeChange) {
      onTimeChange({ from: new Date(from).toISOString(), to: new Date(to).toISOString() });
    } else if (column.isDate) {
      onFilter?.([
        rangeFilter(
          { name: column.fieldName },
          { gte: new Date(from).toISOString(), lt: new Date(to).toISOString(), format: 'strict_date_optional_time' },
          context.indexPattern?.id
        ),
      ]);
    } else {
      onFilter?.([rangeFilter({ name: column.fieldName }, { gte: from, lt: to }, context.indexPattern?.id)]);
    }
  };

  const threshold = params.thresholdLine?.show
    ? {
        value: params.thresholdLine.value ?? 0,
        width: params.thresholdLine.width,
        style: params.thresholdLine.style,
        color: params.thresholdLine.color,
      }
    : undefined;

  return (
    <XYChart
      series={model.series}
      axes={model.axes}
      x={model.x}
      horizontal={model.horizontal}
      legend={showLegend ? legendPosition : false}
      grid={{ category: Boolean(params.grid?.categoryLines), value: Boolean(params.grid?.valueAxis) }}
      threshold={threshold}
      nowMarker={Boolean(params.addTimeMarker) && model.x.type === 'time'}
      tooltip={params.addTooltip !== false}
      onPointClick={
        onFilter
          ? (series, point) => {
              const filters = pointFilters(series, point);
              if (filters.length) onFilter(filters);
            }
          : undefined
      }
      onBrush={brushable && (onFilter || onTimeChange) ? onBrush : undefined}
      classic={{ radiusRatio: params.radiusRatio }}
      testId="visChart"
    />
  );
}

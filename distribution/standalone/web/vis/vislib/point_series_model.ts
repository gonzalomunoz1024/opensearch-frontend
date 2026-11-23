/* SPDX-License-Identifier: Apache-2.0 */

/*
 * A line, area or bar chart of a visualization as vislib sets it up (its point series type, its
 * Data, its axes and their scales): a series of settings for each series of the data, matched to
 * the visualization's seriesParams by its measure; the axes with vislib's defaults, their titles
 * and their formats; the series stacked on each value axis; and, for a length of axis, the scale
 * of each axis as vislib makes it, from the values its series reach and its settings.
 */

import type { Table } from '../../lib/aggs';
import type { HeatmapColoring } from './heatmap';
import { axisConfig, isHorizontal, type AxisConfig, type AxisParams, type AxisScaleInfo } from './axis';
import {
  buildPointSeries,
  injectZeros,
  orderXValues,
  stackSeries,
  type Ordered,
  type PointSeriesData,
  type StackMode,
  type VislibSeries,
} from './point_series_data';
import { bandScale, tickCount, valueScale, zonedTimeTicks, type BandScale, type ValueScale, type ZoneOffset } from './scales';
import type { Interpolation } from './shapes';

export type SeriesKind = 'histogram' | 'line' | 'area' | 'heatmap';

export interface SeriesParams {
  show?: boolean | string;
  type?: string;
  mode?: string;
  data?: { id?: string; label?: string };
  valueAxis?: string;
  interpolate?: string;
  drawLinesBetweenPoints?: boolean;
  showCircles?: boolean;
  lineWidth?: number;
}

export interface PointSeriesParams {
  type?: string;
  addTooltip?: boolean;
  addLegend?: boolean;
  legendPosition?: string;
  addTimeMarker?: boolean;
  enableHover?: boolean;
  orderBucketsBySum?: boolean;
  radiusRatio?: number;
  interpolate?: string;
  smoothLines?: boolean;
  mode?: string;
  grid?: { categoryLines?: boolean; valueAxis?: string };
  categoryAxes?: AxisParams[];
  valueAxes?: AxisParams[];
  seriesParams?: SeriesParams[];
  labels?: { show?: boolean };
  thresholdLine?: { show?: boolean; value?: number | string; width?: number | string; style?: string; color?: string };
}

/** A series with its settings, as vislib draws it */
export interface SeriesConfig {
  show: boolean;
  type: SeriesKind;
  mode: 'stacked' | 'normal';
  valueAxis?: string;
  interpolate: Interpolation;
  drawLinesBetweenPoints: boolean;
  showCircles: boolean;
  lineWidth: number;
  radiusRatio: number;
  data: VislibSeries;
}

export interface ValueAxisModel {
  config: AxisConfig;
  format: (value: number) => string;
}

export interface CategoryAxisModel {
  config: AxisConfig;
  format: (value: number | string) => string;
  /** The names along the axis when it lists names of its own, not the values of the bucket along the chart */
  values?: Array<number | string>;
}

export interface ThresholdLine {
  value: number;
  width: number;
  dash: string;
  color: string;
}

export interface PointSeriesModel {
  data: PointSeriesData;
  /** The values along the category axis, in vislib's order, the gaps of a histogram filled */
  xValues: Array<number | string>;
  series: SeriesConfig[];
  valueAxes: ValueAxisModel[];
  categoryAxes: CategoryAxisModel[];
  ordered?: Ordered;
  /** The names of the legend, once each, in the order of the series */
  labels: string[];
  /** The smallest and largest dot sizes of all series */
  radii: { min: number; max: number };
  grid: { categoryLines: boolean; valueAxis?: string };
  threshold?: ThresholdLine;
  addTimeMarker: boolean;
  tooltip: boolean;
  /** Pointing at a mark dims the others (enableHover) */
  hover: boolean;
  /** Values written on the marks */
  valueLabels: boolean;
  /** What the chart shows instead, when its settings do not let it be drawn */
  error?: string;
  /** The colours of a heat map's squares */
  heatmap?: HeatmapColoring;
}

const SCALE_STACKED = new Set(['percentage', 'wiggle', 'silhouette']);
/** The default colour of a threshold line: the tenth colour of the colour-blind palette */
export const THRESHOLD_COLOR = '#E7664C';

const interpolationOf = (value: string | undefined): Interpolation =>
  value === 'cardinal' || value === 'step-after' || value === 'step-before' ? value : 'linear';

const kindOf = (value: string | undefined): SeriesKind | undefined =>
  value === 'histogram' || value === 'line' || value === 'area' || value === 'heatmap' ? value : undefined;

/** vislib's seriId: the measure's id, without what a percentile or a bound adds to it */
const seriesParamId = (aggId: string) => {
  const brackets = aggId.indexOf('[');
  if (brackets > -1) return aggId.slice(0, brackets);
  return aggId.split('.')[0];
};

/** The settings of a series: those of the seriesParams of its measure, else the chart's own */
export function seriesConfigOf(params: PointSeriesParams, series: VislibSeries): SeriesConfig {
  const id = seriesParamId(series.aggId);
  const matching = params.seriesParams?.find((candidate) => candidate.data?.id === id);
  const radiusRatio = typeof params.radiusRatio === 'number' ? params.radiusRatio : 9;
  if (!matching) {
    const first = params.seriesParams?.[0] ?? params;
    const stacked = ['stacked', 'percentage', 'wiggle', 'silhouette'].includes(params.mode ?? '');
    return {
      show: true,
      type: kindOf(params.type) ?? 'line',
      mode: stacked ? 'stacked' : 'normal',
      interpolate: interpolationOf(params.smoothLines ? 'cardinal' : params.interpolate),
      drawLinesBetweenPoints: Boolean((first as SeriesParams).drawLinesBetweenPoints),
      showCircles: (first as SeriesParams).showCircles ?? true,
      lineWidth: 2,
      radiusRatio,
      data: series,
    };
  }
  return {
    // Shown when it says so in any way: vislib tests the value, so the text "false" shows it too
    show: Boolean(matching.show),
    // A series of no known kind is drawn as a line
    type: kindOf(matching.type) ?? 'line',
    mode: matching.mode === 'stacked' ? 'stacked' : 'normal',
    valueAxis: matching.valueAxis,
    interpolate: interpolationOf(matching.interpolate),
    drawLinesBetweenPoints: Boolean(matching.drawLinesBetweenPoints),
    showCircles: matching.showCircles ?? true,
    lineWidth: typeof matching.lineWidth === 'number' ? matching.lineWidth : Number(matching.lineWidth) || 2,
    radiusRatio,
    data: series,
  };
}

/** Whether a series is drawn against an axis: its own, or the first when it names none */
export const onAxis = (series: SeriesConfig, axisId: string, firstAxisId: string) =>
  series.valueAxis ? series.valueAxis === axisId : axisId === firstAxisId;

export interface ModelInput {
  params: PointSeriesParams;
  table: Table;
  percentFormat: (value: number) => string;
  bounds?: { min: number; max: number };
  addInterval?: (value: number, times: number) => number;
}

/** The value axes of a visualization's params, or the one its mode gives */
function valueAxesParamsOf(params: PointSeriesParams): AxisParams[] {
  return params.valueAxes?.length
    ? params.valueAxes
    : [{ id: 'ValueAxis-1', type: 'value', scale: { mode: ['stacked', 'overlap'].includes(params.mode ?? '') ? 'normal' : params.mode } }];
}

/** The measures, by aggregation id, that the visualization puts on an axis in the percentage mode */
function percentAggsOf(params: PointSeriesParams, valueAxesParams: AxisParams[]): Set<string> {
  const percentAggs = new Set<string>();
  for (const seriesParam of params.seriesParams ?? []) {
    const axis = valueAxesParams.find((candidate) => candidate.id === seriesParam.valueAxis);
    if (axis?.scale?.mode === 'percentage' && seriesParam.data?.id) percentAggs.add(seriesParam.data.id);
  }
  return percentAggs;
}

/** The value axes as vislib sets them up, named and written by the data (of the first chart of a split) */
function valueAxesOf(params: PointSeriesParams, valueAxesParams: AxisParams[], data: PointSeriesData): ValueAxisModel[] {
  const valuesOnChart = Boolean(params.labels?.show);
  return valueAxesParams.map((args) => {
    const config = axisConfig(args, 'value', { ordinal: false, title: data.yLabel, valuesOnChart });
    // The format of the first series the visualization puts on the axis, else that of the first measure
    const seriesParam = params.seriesParams?.find((candidate) => candidate.valueAxis === args.id);
    const first = seriesParam ? data.series.find((item) => seriesParamId(item.aggId) === seriesParam.data?.id) : undefined;
    return { config, format: first ? first.format : data.yFormat };
  });
}

/** The axes of categories as vislib sets them up, named and written by the data (of the first chart of a split) */
function categoryAxesOf(params: PointSeriesParams, data: PointSeriesData): CategoryAxisModel[] {
  const ordinal = !data.ordered?.date;
  const categoryParams: AxisParams[] = params.categoryAxes?.length ? params.categoryAxes : [{ id: 'CategoryAxis-1', type: 'category' }];
  return categoryParams.map((args) => {
    // The first axis of categories is always named by the bucket along it, whatever it was given
    const title = args.id === 'CategoryAxis-1' ? { ...(args.title ?? {}), text: data.xLabel } : args.title;
    const config = axisConfig({ ...args, title }, 'category', { ordinal, title: data.xLabel });
    return {
      config,
      format: (value) => (value === '_all' && !data.xColumn ? '_all' : data.xFormat(value)),
    };
  });
}

/** Stacks, each value axis in turn: the series stacked on it, or all of it in a mode that piles them up */
function stackOnAxes(valueAxes: ValueAxisModel[], series: SeriesConfig[], xValues: Array<number | string>): void {
  const firstAxisId = valueAxes[0]?.config.id ?? 'ValueAxis-1';
  valueAxes.forEach(({ config }) => {
    const stacked = series.filter(
      (item) => onAxis(item, config.id, firstAxisId) && (item.mode === 'stacked' || SCALE_STACKED.has(config.scale.mode))
    );
    const values = stacked.map((item) => item.data);
    injectZeros(values, xValues);
    stackSeries(values, (['normal', 'grouped', 'percentage', 'wiggle', 'silhouette'].includes(config.scale.mode) ? config.scale.mode : 'normal') as StackMode);
  });
}

/** The names of the legend, once each, in the order of the series */
const labelsOf = (series: VislibSeries[]): string[] => [...new Set(series.map((item) => item.label))];

/** What the charts of a split share, and what a chart that is not split has of its own */
interface SharedModel {
  xValues: Array<number | string>;
  valueAxes: ValueAxisModel[];
  categoryAxes: CategoryAxisModel[];
  ordered?: Ordered;
  labels: string[];
}

/** A chart's model: its series and its dot sizes, over the axes and values it has or shares */
function chartModel(params: PointSeriesParams, data: PointSeriesData, series: SeriesConfig[], shared: SharedModel): PointSeriesModel {
  let min = Infinity;
  let max = -Infinity;
  for (const item of data.series) {
    for (const value of item.values) {
      if (value.z === undefined) continue;
      if (min > value.z) min = value.z;
      if (max < value.z) max = value.z;
    }
  }

  const thresholdParams = params.thresholdLine;
  const style = thresholdParams?.style;
  const threshold: ThresholdLine | undefined = thresholdParams?.show
    ? {
        value: Number(thresholdParams.value ?? 10),
        width: Number(thresholdParams.width ?? 1),
        dash: style === 'dashed' ? '10,5' : style === 'dot-dashed' ? '20,5,5,5' : '0',
        color: thresholdParams.color ?? THRESHOLD_COLOR,
      }
    : undefined;

  return {
    data,
    xValues: shared.xValues,
    series,
    valueAxes: shared.valueAxes,
    categoryAxes: shared.categoryAxes,
    ordered: shared.ordered,
    labels: shared.labels,
    radii: { min, max },
    grid: { categoryLines: Boolean(params.grid?.categoryLines), valueAxis: params.grid?.valueAxis || undefined },
    threshold,
    addTimeMarker: Boolean(params.addTimeMarker),
    tooltip: params.addTooltip !== false,
    // On unless the visualization says otherwise
    hover: params.enableHover === undefined ? true : Boolean(params.enableHover),
    valueLabels: Boolean(params.labels?.show),
  };
}

/** A point series chart of a table as vislib sets it up */
export function buildPointSeriesModel({ params, table, percentFormat, bounds, addInterval }: ModelInput): PointSeriesModel {
  const valueAxesParams = valueAxesParamsOf(params);
  const percentAggs = percentAggsOf(params, valueAxesParams);
  const data = buildPointSeries(table.columns, table.rows, { percentAggs, percentFormat, bounds, addInterval });
  const series = data.series.map((item) => seriesConfigOf(params, item));
  const xValues = orderXValues(data, Boolean(params.orderBucketsBySum));
  const valueAxes = valueAxesOf(params, valueAxesParams, data);
  stackOnAxes(valueAxes, series, xValues);
  return chartModel(params, data, series, {
    xValues,
    valueAxes,
    categoryAxes: categoryAxesOf(params, data),
    ordered: data.ordered,
    labels: labelsOf(data.series),
  });
}

export interface SplitModelInput extends Omit<ModelInput, 'table'> {
  /** The tables of a split's charts, in their order, each without the split's column */
  tables: Table[];
  /** How many columns the whole table has, the split's too: the tooltip counts them */
  columnCount: number;
}

export interface SplitPointSeriesModels {
  /**
   * What the charts share: the axes, the values along them and the legend's names; its series are
   * those of every chart, which the value axes reach
   */
  frame: PointSeriesModel;
  /** Each chart: its own series, stacked over the values the charts share */
  charts: PointSeriesModel[];
}

/**
 * The charts of a split as vislib sets them up (its Data over rows or columns of charts): the axes
 * named and written by the first chart; along the axis of names, the values of every chart's
 * series as they come, ordered when the axis is, and none put back between them, as the whole has
 * no step of its own; the first chart's order of time, its ends those of all the values when the
 * time range does not bound it; the value axes over every chart's values; the legend's names of
 * every chart; and each chart's series stacked over the shared values, its dots sized by its own.
 */
export function buildSplitPointSeriesModels({
  params,
  tables,
  columnCount,
  percentFormat,
  bounds,
  addInterval,
}: SplitModelInput): SplitPointSeriesModels {
  const valueAxesParams = valueAxesParamsOf(params);
  const percentAggs = percentAggsOf(params, valueAxesParams);
  const keys = new Map<string, unknown>();
  const parts: Table[] = tables.length ? tables : [{ columns: [], rows: [] }];
  const datas = parts.map((table) => {
    const data = buildPointSeries(table.columns, table.rows, { percentAggs, percentFormat, bounds, addInterval, keys });
    data.columnCount = columnCount;
    return data;
  });
  const seriesOf = datas.map((data) => data.series.map((item) => seriesConfigOf(params, item)));
  const first = datas[0];
  const allSeries = datas.flatMap((data) => data.series);
  const xValues = orderXValues({ xValues: [], series: allSeries, ordered: first.ordered }, Boolean(params.orderBucketsBySum), false);
  let ordered = first.ordered;
  if (ordered?.date && !bounds) {
    const numbers = xValues.filter((value): value is number => typeof value === 'number');
    if (numbers.length) ordered = { ...ordered, min: Math.min(...numbers), max: Math.max(...numbers) };
  }
  const valueAxes = valueAxesOf(params, valueAxesParams, first);
  for (const series of seriesOf) stackOnAxes(valueAxes, series, xValues);
  const shared: SharedModel = { xValues, valueAxes, categoryAxes: categoryAxesOf(params, first), ordered, labels: labelsOf(allSeries) };
  const charts = datas.map((data, index) => chartModel(params, data, seriesOf[index], shared));
  return { frame: { ...charts[0], series: seriesOf.flat() }, charts: tables.length ? charts : [] };
}

// --- Scales ---------------------------------------------------------------------------------------

export class VislibError extends Error {}

/** The values the series of a value axis reach: the top of each stack, or the value itself */
export function axisPoints(model: Pick<PointSeriesModel, 'series' | 'valueAxes'>, axisId: string): number[] {
  const firstAxisId = model.valueAxes[0]?.config.id ?? 'ValueAxis-1';
  const points: number[] = [];
  for (const item of model.series) {
    if (!onAxis(item, axisId, firstAxisId)) continue;
    for (const value of item.data.values) {
      const reached = value.y0 ? value.y0 + (value.y ?? 0) : value.y;
      if (typeof reached === 'number' && !Number.isNaN(reached)) points.push(reached);
    }
  }
  return points;
}

const minOf = (values: number[]) => (values.length ? Math.min(...values) : undefined);
const maxOf = (values: number[]) => (values.length ? Math.max(...values) : undefined);

/** The stretch of values of a value axis before it is made round, as vislib's getExtents */
export function valueExtents(config: AxisConfig, points: number[]): [number, number] {
  const min = config.scale.min ?? minOf(points) ?? NaN;
  const max = config.scale.max ?? maxOf(points) ?? NaN;
  if (config.scale.setYExtents) {
    return [min, max].map((value) => {
      if (Number.isNaN(value)) throw new VislibError(`${value} is not a valid number`);
      return config.scale.mode === 'percentage' ? value / 100 : value;
    }) as [number, number];
  }
  if (config.scale.type === 'log') {
    if (min < 0 || max < 0) throw new VislibError('Values less than 1 cannot be displayed on a log scale');
    return [1, max];
  }
  if (config.scale.defaultYExtents) {
    const margin = config.scale.boundsMargin;
    const domain: [number, number] = [min, max];
    if (margin === 0) return domain;
    if (max < 0) domain[1] += margin;
    if (min > 0) domain[0] -= margin;
    return domain;
  }
  return [Math.min(0, min), Math.max(0, max)];
}

/** Whether vislib makes the ends of a value axis round */
export const canApplyNice = (config: AxisConfig) => !config.scale.setYExtents && !config.scale.defaultYExtents;

/** The domain of a value axis over a length: its extents, widened for values written on the marks */
export function valueDomain(config: AxisConfig, points: number[], length: number): [number, number] {
  const domain = valueExtents(config, points);
  if (config.padForLabels > 0 && canApplyNice(config)) {
    const padValue = ((domain[1] - domain[0]) / length) * config.padForLabels;
    if (domain[0] < 0) domain[0] -= padValue;
    domain[1] += padValue;
  }
  return domain;
}

/** The range of an axis's scale: vislib runs a standing value axis up, a standing axis of names down */
export function axisRange(config: AxisConfig, length: number): [number, number] {
  if (isHorizontal(config)) return config.scale.inverted ? [length, 0] : [0, length];
  return config.scale.inverted ? [0, length] : [length, 0];
}

export interface ScaledValueAxis {
  scale: ValueScale;
  info: AxisScaleInfo;
}

/** A value axis's scale over a length, and its ticks */
export function scaleValueAxis(config: AxisConfig, points: number[], length: number): ScaledValueAxis {
  if (config.scale.type === 'log' && config.scale.mode === 'percentage') {
    throw new VislibError("Can't mix percentage mode with log scale.");
  }
  const domain = valueDomain(config, points, length);
  const range = axisRange(config, length);
  const scale = valueScale(config.scale.type, domain, range, { nice: canApplyNice(config), clamp: true });
  const values = scale.ticks(tickCount(length));
  const extent: [number, number] = range[0] < range[1] ? [range[0], range[1]] : [range[1], range[0]];
  return {
    scale,
    info: {
      values,
      at: (value) => scale(Number(value)),
      raw: (value) => scale(Number(value)),
      range,
      extent,
    },
  };
}

/** A scale of time onto a range, held inside it */
export interface TimeScale {
  (value: number): number;
  domain: [number, number];
  range: [number, number];
}

export interface ScaledCategoryAxis {
  time?: TimeScale;
  band?: BandScale;
  info: AxisScaleInfo;
}

/** The time a category axis spans: the time range, or the first bucket to the end of the last */
export function timeDomain(config: AxisConfig, values: Array<number | string>, ordered: Ordered): [number, number] {
  const numbers = values.map(Number).filter((value) => !Number.isNaN(value));
  const low = numbers.length ? Math.min(...numbers) : undefined;
  let high = numbers.length ? Math.max(...numbers) : undefined;
  if (high !== undefined && config.scale.expandLastBucket) high = ordered.addInterval(high, 1);
  const lows = [ordered.min, low].filter((value): value is number => typeof value === 'number' && !Number.isNaN(value));
  const highs = [ordered.max, high].filter((value): value is number => typeof value === 'number' && !Number.isNaN(value));
  return [Math.min(...lows), Math.max(...highs)];
}

/** A category axis's scale over a length: of time, or bands of names */
export function scaleCategoryAxis(
  config: AxisConfig,
  values: Array<number | string>,
  ordered: Ordered | undefined,
  length: number,
  offsetAt: ZoneOffset
): ScaledCategoryAxis {
  const range = axisRange(config, length);
  const extent: [number, number] = range[0] < range[1] ? [range[0], range[1]] : [range[1], range[0]];
  if (ordered?.date) {
    const domain = timeDomain(config, values, ordered);
    const span = domain[1] - domain[0];
    const time = ((value: number) => {
      // d3 maps a domain of no length to the start of the range
      let t = span ? (value - domain[0]) / span : 0;
      t = Math.max(0, Math.min(1, t));
      return range[0] * (1 - t) + range[1] * t;
    }) as TimeScale;
    time.domain = domain;
    time.range = range;
    const ticks = zonedTimeTicks(domain, tickCount(length), offsetAt);
    return {
      time,
      info: { values: ticks, at: (value) => time(Number(value)), raw: (value) => time(Number(value)), range, extent },
    };
  }
  const band = bandScale(values.map(String), range, config.style.rangePadding, config.style.rangeOuterPadding);
  const starts = band.domain.map((value) => band(value));
  const seen = new Set<string>();
  const distinct = values.filter((value) => !seen.has(String(value)) && Boolean(seen.add(String(value))));
  return {
    band,
    info: {
      values: distinct,
      at: (value) => band(String(value)) + band.band / 2,
      raw: (value) => band(String(value)),
      range: starts,
      extent,
    },
  };
}

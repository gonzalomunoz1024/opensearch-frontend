/* SPDX-License-Identifier: Apache-2.0 */

/*
 * A heat map as vislib sets it up (its heatmap point series type and HeatmapChart): a point
 * series whose value axis is hidden and only gives the stretch of the values, the first axis of
 * names without padding between its bands, and a second one on the left naming the series, the
 * first at the top. The stretch is cut into as many equal ranges as there are colours, or into the
 * ranges set, each named for the legend and given the colour of the schema at its place; a square
 * takes the range its value falls in, and no colour and no place when it falls in none.
 */

import type { AxisParams } from './axis';
import { heatmapColor } from './color_maps';
import {
  axisPoints,
  buildPointSeriesModel,
  buildSplitPointSeriesModels,
  scaleValueAxis,
  VislibError,
  type ModelInput,
  type PointSeriesModel,
  type PointSeriesParams,
  type SplitModelInput,
  type SplitPointSeriesModels,
} from './point_series_model';

export interface ColorRange {
  from?: number | string | null;
  to?: number | string | null;
}

export interface HeatmapParams extends PointSeriesParams {
  enableHover?: boolean;
  colorsNumber?: number | string;
  colorSchema?: string;
  setColorRange?: boolean;
  colorsRange?: ColorRange[];
  invertColors?: boolean;
  percentageMode?: boolean;
  valueAxes?: Array<AxisParams & { labels?: AxisParams['labels'] & { overwriteColor?: boolean; color?: string } }>;
}

/** The ranges of a heat map's colours, from the stretch of its values */
export interface HeatmapColoring {
  /** The name of each range, as the legend lists them */
  labels: string[];
  /** The colour of each name, as the schema gives it */
  colors: Record<string, string>;
  /** The range a value falls in; -1 when it falls in none */
  bucketOf: (value: number | null | undefined) => number;
  /** Values written in the squares */
  showLabels: boolean;
  rotate: number;
  /** The colour of the values written, when it is not chosen by the square's */
  labelColor?: string;
  format: (value: number) => string;
}

const MAX_COLOR_COUNT = 10;

// As JavaScript reads a value as a number: nothing and an empty text are zero, a text its number
const looseNumber = (value: unknown) => Number(value);

/**
 * An end of a range set, as vislib writes it: by the values' format when it reads as a number,
 * which leaves nothing and an empty text empty, else as it is
 */
function rangeEnd(value: number | string | null | undefined, format: (value: number) => string): string {
  if (!Number.isFinite(looseNumber(value))) return String(value);
  return value === null || value === '' ? '' : format(looseNumber(value));
}

/**
 * The names of a heat map's ranges (vislib's getHeatmapLabels): the ranges set, written by the
 * values' format; else, for a stretch from `min` to `max`, as many equal parts as there are
 * colours, as shares of the stretch in the percentage mode, and over a stretch of more than ten
 * rounded up to whole numbers, the first rounded down; a stretch of one value is that value alone
 */
export function heatmapLabels(
  params: Pick<HeatmapParams, 'setColorRange' | 'colorsRange' | 'colorsNumber' | 'percentageMode'>,
  [min, max]: [number, number],
  format: (value: number) => string
): string[] {
  const labels: string[] = [];
  if (params.setColorRange) {
    for (const range of params.colorsRange ?? []) labels.push(`${rangeEnd(range.from, format)} - ${rangeEnd(range.to, format)}`);
    return labels;
  }
  if (max === min) return [String(min)];
  const colorsNumber = looseNumber(params.colorsNumber);
  for (let i = 0; i < colorsNumber; i += 1) {
    let val = i / colorsNumber;
    let nextVal = (i + 1) / colorsNumber;
    if (params.percentageMode) {
      labels.push(`${Math.ceil(val * 100)}% - ${Math.ceil(nextVal * 100)}%`);
      continue;
    }
    val = val * (max - min) + min;
    nextVal = nextVal * (max - min) + min;
    if (max - min > MAX_COLOR_COUNT) {
      const valInt = Math.ceil(val);
      if (i === 0) val = valInt === val ? val : valInt - 1;
      else val = valInt;
      nextVal = Math.ceil(nextVal);
    }
    const from = Number.isFinite(val) ? format(val) : String(val);
    const to = Number.isFinite(nextVal) ? format(nextVal) : String(nextVal);
    labels.push(`${from} - ${to}`);
  }
  return labels;
}

/**
 * The colour of each range's name (vislib's getHeatmapColors): the schema's at its place among
 * the ranges, the first at the start of the schema, or at its end when the colours are reversed.
 * A name met twice keeps the colour of its last range; a range with no name gets none.
 */
export function heatmapColors(labels: string[], schema: string, invert: boolean, dark: boolean): Record<string, string> {
  const colors: Record<string, string> = {};
  labels.forEach((label, index) => {
    if (!label) return;
    const at = invert ? 1 - index / labels.length : index / labels.length;
    colors[label] = heatmapColor(at, schema, dark);
  });
  return colors;
}

/**
 * The range a value falls in (vislib's getColorBucket): the first range set that holds it, its
 * end left out; else its share of the stretch cut into the number of colours, the last taking
 * the top; the last colour for a stretch that is not a number and the first for one of one value.
 * A value that is not there falls in none, except into a range set that holds zero.
 */
export function colorBucket(
  value: number | null | undefined,
  params: Pick<HeatmapParams, 'setColorRange' | 'colorsRange' | 'colorsNumber'>,
  [min, max]: [number, number]
): number {
  const ranges = params.colorsRange ?? [];
  if (params.setColorRange && ranges.length) {
    // As JavaScript compares them: a value of nothing counts as zero, one left out as no number
    const at = value === null ? 0 : value === undefined ? NaN : value;
    return ranges.findIndex((range) => looseNumber(range.from) <= at && looseNumber(range.to) > at);
  }
  const colorsNumber = looseNumber(params.colorsNumber);
  let bucket: number;
  if (Number.isNaN(min) || Number.isNaN(max)) bucket = colorsNumber - 1;
  else if (min === max) bucket = 0;
  else bucket = Math.min(colorsNumber - 1, Math.floor((((value ?? 0) - min) / (max - min)) * colorsNumber));
  if (value === null || value === undefined) return -1;
  return Number.isNaN(bucket) ? -1 : bucket;
}

export interface HeatmapModelInput extends ModelInput {
  params: HeatmapParams;
  /** The setting visualization:heatmap:maxBuckets */
  maxBuckets: number;
  /** Whether the theme is dark, for the schemas that run between its status colours */
  dark: boolean;
}

/** A heat map's params as its point series takes them: its two axes of names, and its value axis hidden */
function heatmapSeriesParams(params: HeatmapParams): HeatmapParams {
  const [first, ...others] = params.categoryAxes?.length ? params.categoryAxes : [{ id: 'CategoryAxis-1', type: 'category' }];
  const categoryAxes: AxisParams[] = [
    { ...first, style: { rangePadding: 0, rangeOuterPadding: 0 } },
    ...others,
    {
      id: 'CategoryAxis-2',
      type: 'category',
      position: 'left',
      scale: { inverted: true },
      labels: { filter: false },
      style: { rangePadding: 0, rangeOuterPadding: 0 },
      title: { text: '' },
    },
  ];
  const valueAxes: AxisParams[] = (params.valueAxes?.length ? params.valueAxes : [{ id: 'ValueAxis-1', type: 'value' }]).map((axis, index) =>
    index === 0 ? { ...axis, show: false } : axis
  );
  return { ...params, categoryAxes, valueAxes };
}

/** A heat map of a table as vislib sets it up: the point series with its two axes of names, and its colours */
export function buildHeatmapModel({ params, maxBuckets, dark, ...input }: HeatmapModelInput): PointSeriesModel {
  const model = buildPointSeriesModel({ ...input, params: heatmapSeriesParams(params) });
  return colorHeatmap(model, model.series.length, params, maxBuckets, dark);
}

export interface SplitHeatmapModelInput extends Omit<SplitModelInput, 'params'> {
  params: HeatmapParams;
  maxBuckets: number;
  dark: boolean;
}

/**
 * The heat maps of a split as vislib sets them up: the second axis of names lists the series of
 * every chart, the ranges cut the values of all of them, and only the first chart is asked whether
 * it has too many series
 */
export function buildSplitHeatmapModels({ params, maxBuckets, dark, ...input }: SplitHeatmapModelInput): SplitPointSeriesModels {
  const { frame, charts } = buildSplitPointSeriesModels({ ...input, params: heatmapSeriesParams(params) });
  colorHeatmap(frame, charts[0]?.series.length ?? 0, params, maxBuckets, dark);
  for (const chart of charts) {
    chart.categoryAxes = frame.categoryAxes;
    chart.labels = frame.labels;
    chart.heatmap = frame.heatmap;
    chart.error = frame.error;
  }
  return { frame, charts };
}

/**
 * Gives a heat map's point series its second axis of names, its ranges and their colours; the
 * squares cannot be drawn when the (first) chart has more series than `maxBuckets`
 */
function colorHeatmap(model: PointSeriesModel, seriesCount: number, params: HeatmapParams, maxBuckets: number, dark: boolean): PointSeriesModel {
  // The second axis of names lists the series, by their names as they are
  const last = model.categoryAxes.length - 1;
  model.categoryAxes[last] = { ...model.categoryAxes[last], format: (value) => String(value), values: model.labels };
  // The legend lists the ranges, and none when the squares cannot be drawn
  model.labels = [];
  if (seriesCount > maxBuckets) {
    model.error = `There are too many series defined (${seriesCount}). The configured maximum is ${maxBuckets}.`;
    return model;
  }

  // The stretch of the values: the hidden value axis's, made round as it makes it
  const zAxis = model.valueAxes[0];
  if (!zAxis) return model;
  let domain: [number, number];
  try {
    domain = scaleValueAxis(zAxis.config, axisPoints(model, zAxis.config.id), 1).scale.domain;
  } catch (error) {
    // The chart shows the error when it draws the axis
    if (error instanceof VislibError) return model;
    throw error;
  }
  const labels = heatmapLabels(params, domain, zAxis.format);
  const labelArgs = params.valueAxes?.[0]?.labels;
  model.heatmap = {
    labels,
    colors: heatmapColors(labels, params.colorSchema ?? 'Greens', Boolean(params.invertColors), dark),
    bucketOf: (value) => colorBucket(value, params, domain),
    showLabels: zAxis.config.labels.show,
    rotate: zAxis.config.labels.rotate,
    labelColor: labelArgs?.overwriteColor ? (labelArgs.color ?? '#ddd') : undefined,
    format: zAxis.format,
  };
  model.labels = labels;
  return model;
}

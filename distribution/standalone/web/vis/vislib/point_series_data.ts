/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The table of a line, area or bar chart made into what vislib draws (its point series helpers
 * and its Data): a series per measure and group of buckets, in the order the rows bring them, each
 * named as OpenSearch Dashboards names it; the values along the category axis, with the buckets a
 * histogram skips put back; and the stacks, a zero put in where a stacked series has no bucket.
 */

import type { TableColumn, TableRow } from '../../lib/aggs';

export interface VislibPoint {
  x: number | string;
  y: number | null;
  z?: number;
  /** Where the point stands in its stack */
  y0?: number;
  /** The raw id of its series; absent on a zero put in to stack */
  seriesId?: string;
  /** The name of its group of buckets, or of its measure when there is none */
  series: string;
  row?: TableRow;
}

export interface VislibSeries {
  /** As vislib keys it: the group and the measure's column */
  rawId: string;
  /** The aggregation of its measure, by which the visualization's seriesParams name it */
  aggId: string;
  label: string;
  values: VislibPoint[];
  metric: TableColumn;
  format: (value: number) => string;
  zLabel?: string;
  zFormat?: (value: number) => string;
  /** The keys of its buckets, one per group column */
  groupKeys: unknown[];
}

/** A category axis of time or of a number histogram: its step and where it is bounded */
export interface Ordered {
  date: boolean;
  /** Milliseconds, or the step of a number histogram */
  interval: number;
  /** Moves a moment on by whole intervals, by the calendar for days, weeks, months and years */
  addInterval: (value: number, times: number) => number;
  min?: number;
  max?: number;
  endzones?: boolean;
}

export interface PointSeriesData {
  xColumn?: TableColumn;
  groupColumns: TableColumn[];
  /** The values of the x aspect, once each, in the order of the rows */
  xValues: Array<number | string>;
  xLabel: string;
  xFormat: (value: unknown) => string;
  yLabel: string;
  yFormat: (value: number) => string;
  zLabel?: string;
  series: VislibSeries[];
  ordered?: Ordered;
  /** How many columns the table has: the tooltip names a value by its column when it has more than two */
  columnCount: number;
}

export interface PointSeriesOptions {
  /** The format of the measures of a series on an axis in the percentage mode */
  percentFormat?: (value: number) => string;
  /** The measures, by aggregation id, whose axis is in the percentage mode */
  percentAggs?: Set<string>;
  /** The bounds of a date histogram on the time field: the time range */
  bounds?: { min: number; max: number };
  /** Moves a moment on by whole intervals of the date histogram */
  addInterval?: (value: number, times: number) => number;
  /**
   * The keys that are not numbers or texts (ranges) by their texts: shared by the charts of a
   * split, so that each writes the values along the axis of all of them
   */
  keys?: Map<string, unknown>;
}

const keyText = (key: unknown): string => (key !== null && typeof key === 'object' ? JSON.stringify(key) : String(key));

/** A bucket's key as its column writes it; an empty text stays empty, as the original's string format leaves it */
export const keyLabel = (column: TableColumn, key: unknown): string => (key === '' ? '' : column.format(key));

const numberOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/** The table as vislib's point series: x values, series and how the x axis is ordered */
export function buildPointSeries(
  columns: TableColumn[],
  rows: TableRow[],
  options: PointSeriesOptions = {}
): PointSeriesData {
  const xColumn = columns.find((column) => column.kind === 'bucket' && column.schema === 'segment');
  const groupColumns = columns.filter((column) => column.kind === 'bucket' && column.schema === 'group');
  const yColumns = columns.filter((column) => column.kind === 'metric' && column.schema !== 'radius');
  const zColumn = columns.find((column) => column.kind === 'metric' && column.schema === 'radius');
  const formatOf = (column: TableColumn) =>
    options.percentAggs?.has(column.agg.id) && options.percentFormat
      ? options.percentFormat
      : (value: number) => column.format(value);

  // A bucket's key that is not a number or a text (a range) is told apart by its text, and
  // written from the key itself
  const keys = options.keys ?? new Map<string, unknown>();
  const xOf = (row: TableRow): number | string => {
    if (!xColumn) return '_all';
    const value = row[xColumn.id];
    if (typeof value === 'number') return value;
    const text = keyText(value);
    if (value !== null && typeof value === 'object') keys.set(text, value);
    return text;
  };
  const xValues: Array<number | string> = [];
  const seenX = new Set<number | string>();
  for (const row of rows) {
    const x = xOf(row);
    if (!seenX.has(x)) {
      seenX.add(x);
      xValues.push(x);
    }
  }
  if (!xColumn) {
    xValues.length = 0;
    xValues.push('_all');
  }

  const multiY = yColumns.length > 1;
  const map = new Map<string, VislibSeries>();
  rows.forEach((row) => {
    const groupKeys = groupColumns.map((column) => row[column.id]);
    const groupName = groupColumns.length ? groupColumns.map((column, index) => keyLabel(column, groupKeys[index])).join(' - ') : undefined;
    for (const y of yColumns) {
      const value = row[y.id];
      const point: VislibPoint = {
        x: xOf(row),
        y: numberOrNull(value),
        series: groupName ?? y.name,
        row,
      };
      if (zColumn) {
        const z = numberOrNull(row[zColumn.id]);
        if (z !== null) point.z = z;
      }
      let rawId: string;
      let label: string;
      if (!multiY) {
        rawId = `${point.series}-${y.id}`;
        label = point.series;
      } else {
        const prefix = groupName !== undefined && groupName !== '' ? `${groupName}: ` : '';
        rawId = groupColumns.length ? `${prefix}${y.id}` : y.id;
        label = groupColumns.length ? `${prefix}${y.name}` : y.name;
      }
      point.seriesId = rawId;
      const known = map.get(rawId);
      if (known) known.values.push(point);
      else {
        map.set(rawId, {
          rawId,
          aggId: y.agg.id,
          label,
          values: [point],
          metric: y,
          format: formatOf(y),
          zLabel: zColumn?.name,
          zFormat: zColumn ? (z: number) => zColumn.format(z) : undefined,
          groupKeys,
        });
      }
      if (!multiY) break;
    }
  });

  let ordered: Ordered | undefined;
  if (xColumn?.isDate) {
    const interval = xColumn.interval ?? 86400000;
    const addInterval = options.addInterval ?? ((value: number, times: number) => value + interval * times);
    const numbers = xValues.filter((value): value is number => typeof value === 'number');
    ordered = options.bounds
      ? { date: true, interval, addInterval, min: options.bounds.min, max: options.bounds.max }
      : {
          date: true,
          interval,
          addInterval,
          endzones: false,
          min: numbers.length ? Math.min(...numbers) : undefined,
          max: numbers.length ? Math.max(...numbers) : undefined,
        };
  } else if (xColumn && xColumn.agg.type === 'histogram' && xColumn.interval) {
    const interval = xColumn.interval;
    ordered = { date: false, interval, addInterval: (value, times) => value + interval * times };
  }

  return {
    xColumn,
    groupColumns,
    xValues,
    xLabel: xColumn ? xColumn.name : 'All docs',
    xFormat: (value) => (xColumn ? keyLabel(xColumn, typeof value === 'string' && keys.has(value) ? keys.get(value) : value) : String(value)),
    yLabel: yColumns.length > 1 ? '' : (yColumns[0]?.name ?? ''),
    yFormat: yColumns[0] ? formatOf(yColumns[0]) : (value) => String(value),
    zLabel: zColumn?.name,
    series: [...map.values()],
    ordered,
    columnCount: columns.length,
  };
}

/**
 * The values along the category axis, as vislib orders them (orderXValues): by time or number
 * when the axis is ordered, else as the rows bring them, or by the sum of their values; on a
 * histogram the buckets it skips between two it has are put back, a step apart. The charts of a
 * split are ordered as a whole that has no step of its own (`fillGaps` false): from the values of
 * their series as they come, none put back.
 */
export function orderXValues(
  data: Pick<PointSeriesData, 'xValues' | 'series' | 'ordered'>,
  bySum = false,
  fillGaps = true
): Array<number | string> {
  const keys = new Map<number | string, { index: number; sum: number }>();
  data.xValues.forEach((value, index) => keys.set(value, { index, sum: 0 }));
  for (const series of data.series) {
    for (const point of series.values) {
      let known = keys.get(point.x);
      if (!known) {
        known = { index: keys.size, sum: 0 };
        keys.set(point.x, known);
      }
      known.sum += point.y ?? 0;
    }
  }
  const ordered = Boolean(data.ordered);
  const pairs = [...keys.entries()];
  const sortKey = ([key, value]: [number | string, { index: number; sum: number }]) =>
    ordered ? Number(key) : bySum ? -value.sum : value.index;
  // lodash's sortBy is stable
  const sorted = pairs.map((pair, index) => ({ pair, index })).sort((a, b) => {
    const ka = sortKey(a.pair);
    const kb = sortKey(b.pair);
    return ka < kb ? -1 : ka > kb ? 1 : a.index - b.index;
  });
  const result: Array<number | string> = [];
  sorted.forEach(({ pair }, at) => {
    const [key] = pair;
    if (typeof key !== 'number') {
      result.push(key);
      return;
    }
    const interval = fillGaps ? data.ordered?.interval : undefined;
    const next = sorted[at + 1]?.pair[0];
    const gapEdge = typeof next === 'number' ? next : parseFloat(String(next));
    if (interval === undefined || interval === null || Number.isNaN(gapEdge) || next === undefined) {
      result.push(key);
      return;
    }
    let value = key;
    for (let guard = 0; value < gapEdge && guard < 100000; guard += 1) {
      result.push(value);
      value = data.ordered?.date ? (data.ordered.addInterval(value, 1)) : value + interval;
    }
  });
  return result;
}

export type StackMode = 'normal' | 'grouped' | 'percentage' | 'wiggle' | 'silhouette';

/** The series of one axis given the same x values, with a zero where one has no point there */
export function injectZeros(series: VislibSeries[], keys: Array<number | string>): void {
  for (const item of series) {
    const filled: VislibPoint[] = keys.map((x) => ({ x, y: 0, series: item.label }));
    for (const point of item.values) {
      const at = filled.findIndex((candidate) => candidate.x === point.x);
      filled.splice(at, 1, point);
    }
    item.values = filled;
  }
}

/**
 * Stacks the series of an axis as vislib does: in the normal and grouped modes negative and
 * positive values pile up apart; otherwise by d3's stack, its values as shares of each column's
 * total (percentage), or round a baseline that keeps the stack centred (silhouette) or that
 * moves the least (wiggle)
 */
export function stackSeries(series: VislibSeries[], mode: StackMode): void {
  if (series.length === 0) return;
  if (mode === 'normal' || mode === 'grouped') {
    const cache = new Map<number | string, [number, number]>();
    for (const item of series) {
      for (const value of item.values) {
        let piles = cache.get(value.x);
        if (!piles) {
          piles = [0, 0];
          cache.set(value.x, piles);
        }
        const side = value.y !== null && value.y < 0 ? 0 : 1;
        value.y0 = piles[side];
        piles[side] += value.y ?? 0;
      }
    }
    return;
  }
  const m = series[0].values.length;
  const points = series.map((item) =>
    item.values.map((value) => [value.x, mode === 'percentage' ? Math.abs(value.y ?? 0) : (value.y ?? 0)] as [number | string, number])
  );
  const offsets: number[] = new Array<number>(m).fill(0);
  if (mode === 'percentage') {
    for (let j = 0; j < m; j += 1) {
      let total = 0;
      for (let i = 0; i < points.length; i += 1) total += points[i][j]?.[1] ?? 0;
      if (total) for (let i = 0; i < points.length; i += 1) if (points[i][j]) points[i][j][1] /= total;
    }
  } else if (mode === 'silhouette') {
    let max = 0;
    const sums: number[] = [];
    for (let j = 0; j < m; j += 1) {
      let total = 0;
      for (let i = 0; i < points.length; i += 1) total += points[i][j]?.[1] ?? 0;
      if (total > max) max = total;
      sums.push(total);
    }
    for (let j = 0; j < m; j += 1) offsets[j] = (max - sums[j]) / 2;
  } else {
    const x = points[0];
    let o = 0;
    let o0 = 0;
    offsets[0] = 0;
    for (let j = 1; j < m; j += 1) {
      let s1 = 0;
      for (let i = 0; i < points.length; i += 1) s1 += points[i][j][1];
      let s2 = 0;
      const dx = Number(x[j][0]) - Number(x[j - 1][0]);
      for (let i = 0; i < points.length; i += 1) {
        let s3 = (points[i][j][1] - points[i][j - 1][1]) / (2 * dx);
        for (let k = 0; k < i; k += 1) s3 += (points[k][j][1] - points[k][j - 1][1]) / dx;
        s2 += s3 * points[i][j][1];
      }
      o -= s1 ? (s2 / s1) * dx : 0;
      offsets[j] = o;
      if (o < o0) o0 = o;
    }
    for (let j = 0; j < m; j += 1) offsets[j] -= o0;
  }
  // d3 writes each point's place back on it; only the shares of the percentage mode change its value
  const write = (value: VislibPoint, y0: number, y: number) => {
    value.y0 = y0;
    if (mode === 'percentage') value.y = y;
  };
  for (let j = 0; j < m; j += 1) {
    let o = offsets[j];
    write(series[0].values[j], o, points[0][j][1]);
    for (let i = 1; i < series.length; i += 1) {
      o += points[i - 1][j]?.[1] ?? 0;
      if (series[i].values[j]) write(series[i].values[j], o, points[i][j][1]);
    }
  }
}

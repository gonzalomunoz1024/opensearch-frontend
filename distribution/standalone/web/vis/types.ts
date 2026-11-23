/* SPDX-License-Identifier: Apache-2.0 */

/* What every kind of visualization is given to draw itself. */

import type { XYPoint } from '../charts/xy';
import type { BucketCell, Table, TableColumn, TableRow } from '../lib/aggs';
import type { TimeRange } from '../lib/dates';
import type { Filter } from '../lib/types';
import type { UiState, Vis } from '../lib/vis';
import { searchFailure } from '../services/search';
import type { VisData } from './request';

export interface VisRenderProps {
  vis: Vis;
  data: VisData;
  uiState: UiState;
  onUiState?: (next: UiState) => void;
  /** Called with the filters a click on a mark stands for */
  onFilter?: (filters: Filter[]) => void;
  onTimeChange?: (range: TimeRange) => void;
  /** Sets params of one aggregation for the searches that follow, as a map changes its geohash_grid's */
  onAggParams?: (aggId: string, params: Record<string, unknown>) => void;
  /** In one chart of a split, its bucket: a click on a mark filters on it too, as the original's does */
  split?: SplitBucket;
  /**
   * A split, to a drawing that lays out its charts itself as vislib does: `data` is then the
   * whole of it, and each chart draws the table of its part
   */
  splits?: VisSplits;
}

export interface SplitBucket {
  column: TableColumn;
  key: unknown;
  /** The table before the split and the bucket's first row in it, as the original's click carries them */
  cell: BucketCell;
}

/** One chart of a split: its title, its rows without the split's column, and its bucket */
export interface SplitPart {
  label: string;
  table: Table;
  split: SplitBucket;
}

export interface VisSplits {
  /** Whether the charts are rows, one under another, or columns side by side */
  rows: boolean;
  parts: SplitPart[];
}

export const bucketColumns = (table: Table, schema?: string): TableColumn[] =>
  table.columns.filter((column) => column.kind === 'bucket' && (schema === undefined || column.schema === schema));

export const metricColumns = (table: Table): TableColumn[] =>
  table.columns.filter((column) => column.kind === 'metric' && column.schema !== 'radius');

export const numberOf = (row: TableRow, column: TableColumn): number | null => {
  const value = row[column.id];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

/** A stable text for a bucket's key, to tell buckets apart */
export const keyText = (key: unknown): string =>
  key !== null && typeof key === 'object' ? JSON.stringify(key) : String(key);

/**
 * The points of a series in the order of the axis: a stacked one gets a zero where it has no
 * bucket, one that is not stacked only the places it has
 */
export function pointsAlong(points: XYPoint[], xValues: Array<number | string>, stacked: boolean): XYPoint[] {
  const have = new Map(points.map((point) => [point.x, point]));
  return stacked ? xValues.map((x) => have.get(x) ?? { x, y: 0 }) : xValues.flatMap((x) => have.get(x) ?? []);
}

// The kinds that lay out the charts of a split themselves, in vislib's frame: one legend for them
// all, and the titles of pies and point series beside the rows or under the columns (a gauge names
// itself under its gauges); point series share their axes too
const VISLIB_SPLITS = new Set(['pie', 'gauge', 'goal', 'area', 'line', 'histogram', 'horizontal_bar', 'heatmap']);

/**
 * Who draws the split of a kind of visualization: 'frame', its own drawing, from the parts, as
 * vislib lays them out; 'whole', its own drawing, from the whole table, as the data table, which
 * makes a table of each bucket and reads in the visualization's params whether they are rows or
 * columns; 'parts', the page, a drawing per part
 */
export type SplitDrawing = 'frame' | 'whole' | 'parts';

export const splitDrawing = (type: string): SplitDrawing => (VISLIB_SPLITS.has(type) ? 'frame' : type === 'table' ? 'whole' : 'parts');

/** The tables of a chart split into several: one per value of the `split` column */
export function splitTables(table: Table): Array<{ label?: string; table: Table; split?: SplitBucket }> {
  return splitParts(table) ?? [{ table }];
}

/** The charts of a split, one per value of the `split` column, in the order of the rows; none when not split */
export function splitParts(table: Table): SplitPart[] | undefined {
  const split = table.columns.find((column) => column.kind === 'bucket' && column.schema === 'split');
  if (!split) return undefined;
  const groups = new Map<string, { label: string; key: unknown; first: TableRow; rows: TableRow[] }>();
  for (const row of table.rows) {
    const key = keyText(row[split.id]);
    let group = groups.get(key);
    if (!group) {
      // As vislib titles a chart: by its bucket as the format writes it, an empty text too
      const value = row[split.id];
      group = { label: `${split.format(value)}: ${split.name}`, key: value, first: row, rows: [] };
      groups.set(key, group);
    }
    group.rows.push(row);
  }
  const columns = table.columns.filter((column) => column !== split);
  return [...groups.values()].map((group) => ({
    label: group.label,
    table: { columns, rows: group.rows },
    split: { column: split, key: group.key, cell: { table, row: group.first } },
  }));
}

const timeOf = (value: unknown) =>
  new Date(typeof value === 'string' || typeof value === 'number' ? value : Date.now()).toISOString();

/**
 * Takes the ranges on the time field out of the filters of a click: the first of them is the time
 * range to set, as the original's extractTimeFilter has it. A filter that leaves its range out
 * stays a filter: the original's would set the time range to the range it leaves out.
 */
export function splitTimeFilter(filters: Filter[], timeFieldName?: string): { timeRange?: TimeRange; rest: Filter[] } {
  if (!timeFieldName) return { rest: filters };
  const onTime = (filter: Filter) =>
    !filter.meta?.negate && filter.range !== undefined && Object.keys(filter.range)[0] === timeFieldName;
  const first = filters.find(onTime);
  const rest = filters.filter((filter) => !onTime(filter));
  if (!first?.range) return { rest };
  const bounds = first.range[timeFieldName] ?? {};
  return { timeRange: { from: timeOf(bounds.gt || bounds.gte), to: timeOf(bounds.lt || bounds.lte) }, rest };
}

/**
 * A visualization whose data could not be had, as the original's expression reports it to the
 * panel or the editor around it
 */
export interface VisFailure {
  /** With the function that failed, as the panel's "Error" badge shows it: `[opensearchaggs] > …` */
  message: string;
  /** The error itself, as the editor's "Search Error" shows it */
  original: Error;
}

export function visFailure(fn: string, error: unknown): VisFailure {
  const original = searchFailure(error instanceof Error ? error : new Error(String(error)));
  return { message: `[${fn}] > ${original.message}`, original };
}

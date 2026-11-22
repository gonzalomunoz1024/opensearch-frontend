/* SPDX-License-Identifier: Apache-2.0 */

/* What every kind of visualization is given to draw itself. */

import type { XYPoint } from '../charts/xy';
import type { Table, TableColumn, TableRow } from '../lib/aggs';
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

/** The tables of a chart split into several: one per value of the `split` column */
export function splitTables(table: Table): Array<{ label?: string; table: Table }> {
  const split = table.columns.find((column) => column.kind === 'bucket' && column.schema === 'split');
  if (!split) return [{ table }];
  const groups = new Map<string, { label: string; rows: TableRow[] }>();
  for (const row of table.rows) {
    const key = keyText(row[split.id]);
    let group = groups.get(key);
    if (!group) {
      group = { label: `${split.format(row[split.id])}: ${split.name}`, rows: [] };
      groups.set(key, group);
    }
    group.rows.push(row);
  }
  const columns = table.columns.filter((column) => column !== split);
  return [...groups.values()].map((group) => ({ label: group.label, table: { columns, rows: group.rows } }));
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

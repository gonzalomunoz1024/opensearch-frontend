/* SPDX-License-Identifier: Apache-2.0 */

/* What every kind of visualization is given to draw itself. */

import type { Table, TableColumn, TableRow } from '../lib/aggs';
import type { TimeRange } from '../lib/dates';
import type { Filter } from '../lib/types';
import type { UiState, Vis } from '../lib/vis';
import type { VisData } from './request';

export interface VisRenderProps {
  vis: Vis;
  data: VisData;
  uiState: UiState;
  onUiState?: (next: UiState) => void;
  /** Called with the filters a click on a mark stands for */
  onFilter?: (filters: Filter[]) => void;
  onTimeChange?: (range: TimeRange) => void;
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

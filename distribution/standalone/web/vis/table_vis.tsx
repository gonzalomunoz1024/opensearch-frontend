/* SPDX-License-Identifier: Apache-2.0 */

/* Data table: the buckets and their measures as rows, with sorting, pages, totals and shares. */

import { useMemo, useState } from 'react';
import { IconButton } from '../components/basic';
import { Icon } from '../components/icon';
import { Pagination } from '../components/table';
import { bucketFilter, type TableColumn, type TableRow } from '../lib/aggs';
import { ChartMessage } from '../charts/core';
import type { VisRenderProps } from './types';

interface TableParams {
  perPage?: number | '';
  showTotal?: boolean;
  totalFunc?: 'sum' | 'avg' | 'min' | 'max' | 'count';
  percentageCol?: string;
}

interface ShownColumn {
  id: string;
  name: string;
  column: TableColumn;
  /** The column's values as shares of its sum */
  share?: number;
}

const compare = (a: unknown, b: unknown): number => {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const left = typeof a === 'object' ? JSON.stringify(a) : String(a);
  const right = typeof b === 'object' ? JSON.stringify(b) : String(b);
  return left.localeCompare(right, undefined, { numeric: true });
};

export function TableVis({ vis, data, uiState, onUiState, onFilter }: VisRenderProps) {
  const params = vis.params as TableParams;
  const { table, context } = data;
  const [page, setPage] = useState(0);
  const sort = uiState.vis?.sortColumn;

  const columns = useMemo(() => {
    const shown: ShownColumn[] = [];
    for (const column of table.columns) {
      shown.push({ id: column.id, name: column.name, column });
      if (column.kind === 'metric' && params.percentageCol && column.name === params.percentageCol) {
        const sum = table.rows.reduce((total, row) => total + (typeof row[column.id] === 'number' ? (row[column.id] as number) : 0), 0);
        shown.push({ id: `${column.id}-share`, name: `${column.name} percentages`, column, share: sum });
      }
    }
    return shown;
  }, [table, params.percentageCol]);

  const valueOf = (row: TableRow, column: ShownColumn): unknown => {
    const value = row[column.column.id];
    if (column.share === undefined) return value;
    return typeof value === 'number' && column.share !== 0 ? value / column.share : null;
  };
  const textOf = (row: TableRow, column: ShownColumn): string => {
    const value = valueOf(row, column);
    if (column.share !== undefined) return typeof value === 'number' ? `${(value * 100).toFixed(2)}%` : '-';
    return column.column.format(value);
  };

  const rows = useMemo(() => {
    const target = sort ? columns[sort.colIndex] : undefined;
    if (!sort || !target) return table.rows;
    const sorted = [...table.rows].sort((a, b) => compare(valueOf(a, target), valueOf(b, target)));
    return sort.direction === 'desc' ? sorted.reverse() : sorted;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table.rows, columns, sort?.colIndex, sort?.direction]);

  if (table.columns.length === 0 || table.rows.length === 0) return <ChartMessage>No results found</ChartMessage>;

  const perPage = typeof params.perPage === 'number' && params.perPage > 0 ? params.perPage : rows.length;
  const pages = Math.max(1, Math.ceil(rows.length / perPage));
  const current = Math.min(page, pages - 1);
  const visible = rows.slice(current * perPage, (current + 1) * perPage);

  const total = (column: ShownColumn): string => {
    const func = params.totalFunc ?? 'sum';
    if (func === 'count') return String(rows.length);
    if (column.column.kind !== 'metric') return '';
    const values = rows.map((row) => valueOf(row, column)).filter((value): value is number => typeof value === 'number');
    if (values.length === 0) return '';
    let result: number;
    if (func === 'avg') result = values.reduce((sum, value) => sum + value, 0) / values.length;
    else if (func === 'min') result = Math.min(...values);
    else if (func === 'max') result = Math.max(...values);
    else result = values.reduce((sum, value) => sum + value, 0);
    return column.share !== undefined ? `${(result * 100).toFixed(2)}%` : column.column.format(result);
  };

  const setSort = (index: number) => {
    if (!onUiState) return;
    const next =
      sort?.colIndex !== index
        ? { colIndex: index, direction: 'asc' as const }
        : sort.direction === 'asc'
          ? { colIndex: index, direction: 'desc' as const }
          : undefined;
    onUiState({ ...uiState, vis: { ...uiState.vis, sortColumn: next } });
  };

  return (
    <div className="visTable" data-test-subj="visChart">
      <div className="visTable__scroll">
        <table className="atlTable atlTable--compact">
          <thead>
            <tr>
              {columns.map((column, index) => (
                <th key={column.id} className={column.column.kind === 'metric' ? 'atlTable__numeric' : undefined}>
                  <button type="button" className="atlTable__sort" onClick={() => setSort(index)} title={`Sort by ${column.name}`}>
                    <span>{column.name}</span>
                    {sort?.colIndex === index && <Icon name={sort.direction === 'asc' ? 'sortUp' : 'sortDown'} />}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, rowIndex) => (
              <tr key={rowIndex} data-test-subj="visTableRow">
                {columns.map((column) => {
                  const filterable = Boolean(onFilter) && column.column.kind === 'bucket' && column.share === undefined;
                  const add = (negate: boolean) => {
                    const filter = bucketFilter(column.column, row[column.column.id], context);
                    if (!filter) return;
                    filter.meta.negate = negate;
                    onFilter?.([filter]);
                  };
                  return (
                    <td key={column.id} className={column.column.kind === 'metric' ? 'atlTable__numeric' : undefined}>
                      <span className="visTable__cell">
                        <span>{textOf(row, column)}</span>
                        {filterable && (
                          <span className="visTable__actions">
                            <IconButton icon="plusCircle" size="s" label="Filter for value" onClick={() => add(false)} testId="filterForCellValue" />
                            <IconButton icon="minusCircle" size="s" label="Filter out value" onClick={() => add(true)} testId="filterOutCellValue" />
                          </span>
                        )}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          {params.showTotal && (
            <tfoot>
              <tr>
                {columns.map((column) => (
                  <th key={column.id} className={column.column.kind === 'metric' ? 'atlTable__numeric' : undefined}>
                    {total(column)}
                  </th>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {pages > 1 && <Pagination page={current} pages={pages} onPage={setPage} />}
    </div>
  );
}

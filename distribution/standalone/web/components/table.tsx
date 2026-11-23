/* SPDX-License-Identifier: Apache-2.0 */

/* A table over rows already in the browser: it sorts, pages and selects them itself. */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { cx } from './basic';
import { Checkbox, Select } from './form';
import { Icon } from './icon';

export interface Column<Row> {
  id: string;
  name: ReactNode;
  render: (row: Row) => ReactNode;
  /** What the column sorts by; without it the column cannot be sorted */
  sortValue?: (row: Row) => string | number | undefined | null;
  width?: string | number;
  align?: 'left' | 'right';
  /** Cut long text short on one line */
  truncate?: boolean;
  /** Sort text letter by letter as it is written (capitals and signs first), not as a dictionary would */
  plainOrder?: boolean;
}

export interface Sort {
  column: string;
  direction: 'asc' | 'desc';
}

export interface DataTableProps<Row> {
  rows: Row[];
  columns: Array<Column<Row>>;
  rowId: (row: Row) => string;
  initialSort?: Sort;
  pageSize?: number;
  pageSizes?: number[];
  /** With it rows can be ticked; the ticked ids are yours to keep */
  selected?: string[];
  onSelect?: (ids: string[]) => void;
  /** Whether a row may be ticked */
  selectable?: (row: Row) => boolean;
  empty?: ReactNode;
  compact?: boolean;
  testId?: string;
  onRowClick?: (row: Row) => void;
}

function compare(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === undefined || a === null || a === '') return 1;
  if (b === undefined || b === null || b === '') return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

export function DataTable<Row>({
  rows,
  columns,
  rowId,
  initialSort,
  pageSize: initialPageSize = 20,
  pageSizes = [10, 20, 50, 100],
  selected,
  onSelect,
  selectable,
  empty = 'Nothing to show',
  compact,
  testId,
  onRowClick,
}: DataTableProps<Row>) {
  const [sort, setSort] = useState<Sort | undefined>(initialSort);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(initialPageSize);

  const sorted = useMemo(() => {
    const column = sort && columns.find((candidate) => candidate.id === sort.column);
    if (!sort || !column?.sortValue) return rows;
    const value = column.sortValue;
    const direction = sort.direction === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const left = value(a);
      const right = value(b);
      // Rows without a value stay last either way
      if (left === undefined || left === null || left === '') return right === left ? 0 : 1;
      if (right === undefined || right === null || right === '') return -1;
      if (column.plainOrder && typeof left === 'string' && typeof right === 'string') {
        return (left < right ? -1 : left > right ? 1 : 0) * direction;
      }
      return compare(left, right) * direction;
    });
  }, [rows, columns, sort]);

  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  useEffect(() => {
    if (page > pages - 1) setPage(pages - 1);
  }, [page, pages]);
  const visible = sorted.slice(page * pageSize, (page + 1) * pageSize);

  const canSelect = (row: Row) => (selectable ? selectable(row) : true);
  const visibleIds = visible.filter(canSelect).map(rowId);
  const allTicked = visibleIds.length > 0 && visibleIds.every((id) => selected?.includes(id));
  const someTicked = visibleIds.some((id) => selected?.includes(id));

  return (
    <div>
      <div className="atlTableWrap">
        <table className={cx('atlTable', compact && 'atlTable--compact')} data-test-subj={testId}>
          <thead>
            <tr>
              {onSelect && (
                <th className="atlTable__check">
                  <Checkbox
                    checked={allTicked}
                    indeterminate={someTicked}
                    onChange={(checked) => {
                      const others = (selected ?? []).filter((id) => !visibleIds.includes(id));
                      onSelect(checked ? [...others, ...visibleIds] : others);
                    }}
                    testId="checkboxSelectAll"
                  />
                </th>
              )}
              {columns.map((column) => (
                <th key={column.id} style={{ width: column.width, textAlign: column.align }}>
                  {column.sortValue ? (
                    <button
                      type="button"
                      className={cx('atlTable__sort', sort?.column === column.id && 'atlTable__sort--sorted')}
                      onClick={() =>
                        setSort({
                          column: column.id,
                          direction:
                            sort?.column === column.id && sort.direction === 'asc' ? 'desc' : 'asc',
                        })
                      }
                    >
                      {column.name}
                      {sort?.column === column.id && (
                        <Icon name={sort.direction === 'asc' ? 'sortUp' : 'sortDown'} />
                      )}
                    </button>
                  ) : (
                    column.name
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => {
              const id = rowId(row);
              return (
                <tr
                  key={id}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  style={onRowClick ? { cursor: 'pointer' } : undefined}
                >
                  {onSelect && (
                    <td className="atlTable__check" onClick={(event) => event.stopPropagation()}>
                      <Checkbox
                        checked={Boolean(selected?.includes(id))}
                        disabled={!canSelect(row)}
                        onChange={(checked) =>
                          onSelect(
                            checked
                              ? [...(selected ?? []), id]
                              : (selected ?? []).filter((other) => other !== id)
                          )
                        }
                        testId={`checkboxSelectRow-${id}`}
                      />
                    </td>
                  )}
                  {columns.map((column) => (
                    <td
                      key={column.id}
                      style={{ textAlign: column.align, maxWidth: column.truncate ? 0 : undefined }}
                      className={column.truncate ? 'atlTruncate' : undefined}
                    >
                      {column.render(row)}
                    </td>
                  ))}
                </tr>
              );
            })}
            {visible.length === 0 && (
              <tr>
                <td colSpan={columns.length + (onSelect ? 1 : 0)}>
                  <div className="atlEmpty">{empty}</div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {sorted.length > Math.min(...pageSizes) && (
        <Pagination
          page={page}
          pages={pages}
          onPage={setPage}
          pageSize={pageSize}
          pageSizes={pageSizes}
          onPageSize={(size) => {
            setPageSize(size);
            setPage(0);
          }}
          total={sorted.length}
        />
      )}
    </div>
  );
}

export function Pagination({
  page,
  pages,
  onPage,
  pageSize,
  pageSizes,
  onPageSize,
  total,
}: {
  page: number;
  pages: number;
  onPage: (page: number) => void;
  pageSize?: number;
  pageSizes?: number[];
  onPageSize?: (size: number) => void;
  total?: number;
}) {
  // The first, the last, and the pages around the one shown
  const numbers: number[] = [];
  for (let index = 0; index < pages; index += 1) {
    if (index === 0 || index === pages - 1 || Math.abs(index - page) <= 2) numbers.push(index);
  }
  return (
    <div className="atlPagination">
      <div className="atlRow">
        {pageSize !== undefined && pageSizes && onPageSize && (
          <>
            <span>Rows per page</span>
            <Select
              compact
              style={{ width: 76 }}
              value={String(pageSize)}
              onChange={(value) => onPageSize(Number(value))}
              options={pageSizes.map(String)}
              aria-label="Rows per page"
            />
          </>
        )}
        {total !== undefined && <span>{total.toLocaleString()} in all</span>}
      </div>
      <div className="atlPagination__pages">
        <button
          type="button"
          className="atlPagination__page"
          disabled={page === 0}
          onClick={() => onPage(page - 1)}
          aria-label="Previous page"
          data-test-subj="pagination-button-previous"
        >
          <Icon name="chevronLeft" />
        </button>
        {numbers.map((number, index) => (
          <span key={number} className="atlRow" style={{ gap: 2 }}>
            {index > 0 && number - numbers[index - 1] > 1 && <span>…</span>}
            <button
              type="button"
              className="atlPagination__page"
              aria-current={number === page}
              onClick={() => onPage(number)}
            >
              {number + 1}
            </button>
          </span>
        ))}
        <button
          type="button"
          className="atlPagination__page"
          disabled={page >= pages - 1}
          onClick={() => onPage(page + 1)}
          aria-label="Next page"
          data-test-subj="pagination-button-next"
        >
          <Icon name="chevronRight" />
        </button>
      </div>
    </div>
  );
}

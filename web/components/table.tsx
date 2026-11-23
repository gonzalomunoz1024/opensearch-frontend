/* SPDX-License-Identifier: Apache-2.0 */

/* A table over rows already in the browser: it sorts, pages and selects them itself. */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { cx } from './basic';
import { Checkbox } from './form';
import { Icon } from './icon';
import { ContextMenu, Popover } from './overlay';

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
  /**
   * Sort as the original's tables do: text letter by letter as it is written (capitals and signs
   * first), not as a dictionary would, and an empty text as any other, first going up. Only a row
   * with no value at all goes last, either way.
   */
  plainOrder?: boolean;
  /** What a screen reader hears after the column's name, as the original's column description */
  description?: string;
  /** The test id of the column's cells */
  testId?: string;
  /** What can be done with a row: faint until the pointer is over the row, as the original's actions */
  actions?: boolean;
}

export interface Sort {
  column: string;
  direction: 'asc' | 'desc';
}

export interface DataTableProps<Row> {
  rows: Row[];
  columns: Array<Column<Row>>;
  rowId: (row: Row) => string;
  /** The column the rows are sorted by at first; without it they stay in the order given, and no column shows an arrow */
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
  /**
   * 'fixed' lays the columns out as the original's tables do: the columns without a width share
   * what is left equally, whatever they hold. 'auto', the default, makes them as wide as that.
   */
  layout?: 'auto' | 'fixed';
}

const missing = (value: unknown): value is undefined | null => value === undefined || value === null;

function compare(a: string | number, b: string | number): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

// The original's comparator: by < and > alone
function plainCompare(a: string | number, b: string | number): number {
  if (typeof a === 'number' && typeof b === 'number') return a < b ? -1 : a > b ? 1 : 0;
  const left = String(a);
  const right = String(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

/** The rows in the order of a column, as the table sorts them */
export function sortRows<Row>(rows: readonly Row[], column: Column<Row>, direction: 'asc' | 'desc'): Row[] {
  const value = column.sortValue;
  if (!value) return [...rows];
  const sign = direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const left = value(a);
    const right = value(b);
    if (column.plainOrder) {
      if (missing(left)) return missing(right) ? 0 : 1;
      if (missing(right)) return -1;
      return plainCompare(left, right) * sign;
    }
    // Rows without a value stay last either way
    if (missing(left) || left === '') return missing(right) || right === '' ? 0 : 1;
    if (missing(right) || right === '') return -1;
    return compare(left, right) * sign;
  });
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
  empty = 'No items found',
  compact,
  testId,
  onRowClick,
  layout = 'auto',
}: DataTableProps<Row>) {
  const [sort, setSort] = useState<Sort | undefined>(initialSort);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(initialPageSize);

  const sorted = useMemo(() => {
    const column = sort && columns.find((candidate) => candidate.id === sort.column);
    return sort && column ? sortRows(rows, column, sort.direction) : rows;
  }, [rows, columns, sort]);

  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  useEffect(() => {
    if (page > pages - 1) setPage(pages - 1);
  }, [page, pages]);
  const visible = sorted.slice(page * pageSize, (page + 1) * pageSize);

  const canSelect = (row: Row) => (selectable ? selectable(row) : true);
  const visibleIds = visible.filter(canSelect).map(rowId);
  // As the original's: ticked when all of the page is, and no half state
  const allTicked = visibleIds.length > 0 && visibleIds.every((id) => selected?.includes(id));
  const hasActions = columns.some((column) => column.actions);

  return (
    <div>
      <div className="atlTableWrap">
        <table
          className={cx('atlTable', compact && 'atlTable--compact', layout === 'fixed' && 'atlTable--fixed')}
          data-test-subj={testId}
        >
          <thead>
            <tr>
              {onSelect && (
                <th className="atlTable__check">
                  <Checkbox
                    checked={allTicked}
                    disabled={visibleIds.length === 0}
                    onChange={(checked) => {
                      const others = (selected ?? []).filter((id) => !visibleIds.includes(id));
                      onSelect(checked ? [...others, ...visibleIds] : others);
                    }}
                    ariaLabel="Select all rows"
                    testId="checkboxSelectAll"
                  />
                </th>
              )}
              {columns.map((column, index) => {
                const isSorted = sort?.column === column.id;
                const title = column.description && typeof column.name === 'string' ? `${column.name}; ${column.description}` : undefined;
                const label = (
                  <>
                    <span className="atlTable__headerText" title={title}>
                      {column.name}
                    </span>
                    {column.description && <span className="atlScreenReaderOnly">{column.description}</span>}
                  </>
                );
                return (
                  <th
                    key={column.id}
                    scope="col"
                    className={cx(column.actions && 'atlTable__actions')}
                    style={{ width: column.width, textAlign: column.align }}
                    aria-sort={column.sortValue ? (isSorted ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none') : undefined}
                    data-test-subj={`tableHeaderCell_${column.id}_${index}`}
                  >
                    {column.sortValue ? (
                      <button
                        type="button"
                        className={cx('atlTable__sort', isSorted && 'atlTable__sort--sorted')}
                        onClick={() =>
                          setSort({
                            column: column.id,
                            direction: isSorted && sort.direction === 'asc' ? 'desc' : 'asc',
                          })
                        }
                        data-test-subj="tableHeaderSortButton"
                      >
                        {label}
                        {isSorted && <Icon name={sort.direction === 'asc' ? 'sortUp' : 'sortDown'} />}
                      </button>
                    ) : (
                      label
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => {
              const id = rowId(row);
              const ticked = Boolean(selected?.includes(id));
              return (
                <tr
                  key={id}
                  className={cx(ticked && 'atlTable__row--selected', hasActions && 'atlTable__row--actions')}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  style={onRowClick ? { cursor: 'pointer' } : undefined}
                >
                  {onSelect && (
                    <td className="atlTable__check" onClick={(event) => event.stopPropagation()}>
                      <Checkbox
                        checked={ticked}
                        disabled={!canSelect(row)}
                        onChange={(checked) =>
                          onSelect(
                            checked
                              ? [...(selected ?? []), id]
                              : (selected ?? []).filter((other) => other !== id)
                          )
                        }
                        ariaLabel="Select this row"
                        title="Select this row"
                        testId={`checkboxSelectRow-${id}`}
                      />
                    </td>
                  )}
                  {columns.map((column) => (
                    <td
                      key={column.id}
                      style={{ textAlign: column.align, maxWidth: column.truncate ? 0 : undefined }}
                      className={cx(column.truncate && 'atlTruncate', column.actions && 'atlTable__actions')}
                      data-test-subj={column.testId}
                    >
                      {column.render(row)}
                    </td>
                  ))}
                </tr>
              );
            })}
            {visible.length === 0 && (
              <tr>
                <td colSpan={columns.length + (onSelect ? 1 : 0)} className="atlTable__empty">
                  {empty}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {/* As the original's tables: their pages under them whenever there are rows */}
      {sorted.length > 0 && (
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
        />
      )}
    </div>
  );
}

/**
 * Which pages the original's pagination offers a button for: five around the one shown, the first
 * and the last, and "…" where pages are skipped (a single page left out gets its button instead).
 */
export function pageButtons(pageCount: number, activePage: number): Array<number | 'skip'> {
  const first = Math.max(0, Math.min(activePage - 2, pageCount - 5));
  const last = Math.min(pageCount, first + 5);
  const pages: Array<number | 'skip'> = [];
  if (first > 0) {
    pages.push(0);
    if (first > 1 && first !== 2) pages.push('skip');
    else if (first === 2) pages.push(1);
  }
  for (let page = first; page < last; page += 1) pages.push(page);
  if (last < pageCount) {
    if (last + 1 === pageCount - 1) pages.push(last);
    else if (last < pageCount - 1) pages.push('skip');
    pages.push(pageCount - 1);
  }
  return pages;
}

/**
 * The pages of a table, as the original's: "Rows per page" and its menu on the left when the size
 * can be chosen, and the page buttons between two arrows on the right
 */
export function Pagination({
  page,
  pages,
  onPage,
  pageSize,
  pageSizes,
  onPageSize,
  total,
  className,
  controls,
  arrowNames = 'numbered',
}: {
  page: number;
  pages: number;
  onPage: (page: number) => void;
  pageSize?: number;
  pageSizes?: number[];
  onPageSize?: (size: number) => void;
  total?: number;
  /** A class of the page's own beside the kit's, for where it stands */
  className?: string;
  /**
   * The id of what the pages belong to. Given it, that takes the focus before the page changes, as
   * the original's table does under its pages: the view comes back to the table.
   */
  controls?: string;
  /**
   * What the arrows are called: 'numbered' with the page each leads to ("Next page, 3"), as the
   * original's component library says, or 'plain' ("Next page"), as the original's own translations
   * say where they reach: the pages of Dashboards, Visualize and Discover.
   */
  arrowNames?: 'numbered' | 'plain';
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const buttons = pageButtons(pages, page);
  const go = (target: number) => {
    if (controls) document.getElementById(controls)?.focus();
    onPage(target);
  };
  const numbered = arrowNames === 'numbered';
  // What a screen reader hears of "…": the pages it skips, as the original's
  const skipped = (index: number) => {
    const before = buttons[index - 1];
    const after = buttons[index + 1];
    return typeof before === 'number' && typeof after === 'number' ? `Skipping pages ${before + 2} to ${after}` : undefined;
  };
  return (
    <div className={cx('atlPagination', className)}>
      <div className="atlRow">
        {pageSize !== undefined && pageSizes && onPageSize && (
          // Over its button and lined up with its right edge, as the original's ("upRight")
          <Popover
            open={open}
            onClose={close}
            position="upRight"
            button={
              <button
                type="button"
                className="atlPagination__size"
                onClick={() => setOpen(!open)}
                data-test-subj="tablePaginationPopoverButton"
              >
                Rows per page: {pageSize}
                <Icon name="chevronDown" size="s" />
              </button>
            }
          >
            <ContextMenu
              onDone={close}
              panels={[
                {
                  id: 'sizes',
                  items: pageSizes.map((size) => ({
                    id: String(size),
                    label: `${size} rows`,
                    icon: size === pageSize ? 'check' : 'empty',
                    onClick: () => onPageSize(size),
                    testId: `tablePagination-${size}-rows`,
                  })),
                },
              ]}
            />
          </Popover>
        )}
        {total !== undefined && <span className="atlPagination__total">{total.toLocaleString()} in all</span>}
      </div>
      <nav className="atlPagination__pages">
        <button
          type="button"
          className="atlPagination__arrow"
          disabled={page === 0}
          onClick={() => go(page - 1)}
          aria-label={numbered && page > 0 ? `Previous page, ${page}` : 'Previous page'}
          aria-controls={page === 0 ? undefined : controls}
          data-test-subj="pagination-button-previous"
        >
          <Icon name="chevronLeft" />
        </button>
        <ul className="atlPagination__list">
          {buttons.map((number, index) =>
            number === 'skip' ? (
              <li key={`skip-${index}`} className="atlPagination__skip" aria-label={skipped(index)}>
                …
              </li>
            ) : (
              <li key={number}>
                <button
                  type="button"
                  className="atlPagination__page"
                  disabled={number === page}
                  aria-current={number === page ? true : undefined}
                  aria-label={`Page ${number + 1} of ${pages}`}
                  aria-controls={controls}
                  onClick={() => go(number)}
                  data-test-subj={`pagination-button-${number}`}
                >
                  {number + 1}
                </button>
              </li>
            )
          )}
        </ul>
        <button
          type="button"
          className="atlPagination__arrow"
          disabled={page >= pages - 1}
          onClick={() => go(page + 1)}
          aria-label={numbered && page < pages - 1 ? `Next page, ${page + 2}` : 'Next page'}
          aria-controls={page >= pages - 1 ? undefined : controls}
          data-test-subj="pagination-button-next"
        >
          <Icon name="chevronRight" />
        </button>
      </nav>
    </div>
  );
}

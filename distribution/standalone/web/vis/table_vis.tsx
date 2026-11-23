/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The data table, as the original's table visualization draws it (vis_type_table's TableVisApp
 * and its dynamic table): a table, or one per value of a split, one under another or side by
 * side; each with the button that exports it, its columns as wide as their widest value and wider
 * by dragging their edge, sorted by a click on a title, a filter for and against a bucket's value
 * on each of its cells, the totals under it, and its pages.
 */

import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { Button, cx } from '../components/basic';
import { Icon } from '../components/icon';
import { ContextMenu, Popover, Tooltip, downloadFile } from '../components/overlay';
import { Pagination } from '../components/table';
import type { TableRow } from '../lib/aggs';
import type { Filter } from '../lib/types';
import type { UiState } from '../lib/vis';
import { services } from '../services';
import { FormattedValue } from './formatted_value';
import { VisNoResults } from './no_results';
import {
  HEADER_BUTTON_SPACE,
  MIN_COLUMN_WIDTH,
  cellFilters,
  columnWidths,
  csvFileName,
  orderRows,
  tableVisData,
  toCsv,
  truncatesHeader,
  type FormattedColumn,
  type FormattedTable,
  type TableVisParams,
} from './table_data';
import type { VisRenderProps } from './types';
import '../styles/vis_basic.css';

const DEFAULT_PAGE_SIZE = 10;
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

interface ColumnSort {
  colIndex?: number;
  direction?: 'asc' | 'desc';
}

interface ColumnWidth {
  colIndex: number;
  width: number;
}

/** What the table keeps in the visualization's state: its order and the widths dragged */
type TableUiVis = NonNullable<UiState['vis']> & { columnsWidth?: ColumnWidth[] };

interface TableUi {
  sort: ColumnSort;
  setSort: (sort: { colIndex: number; direction: 'asc' | 'desc' }) => void;
  colWidth: ColumnWidth[];
  setWidth: (width: ColumnWidth) => void;
}

/** Called with the rows of a table as sorted, the row clicked among them and its column */
type FilterBucket = (table: FormattedTable, rows: TableRow[], rowIndex: number, columnIndex: number, negate: boolean) => void;

export function TableVis({ vis, data, uiState, onUiState, onFilter, onTimeChange }: VisRenderProps) {
  const params = vis.params as TableVisParams;
  // Split into rows when the visualization's "Split table" says so, as the original's schemas read
  // it from the visualization's params: one table under another; else side by side
  const splitAsRows = Boolean(params.row);
  const { table, context } = data;
  const visData = useMemo(
    () => tableVisData(table, params, context, splitAsRows),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [table, context, params.totalFunc, params.percentageCol, splitAsRows]
  );

  // Where the visualization keeps no state of its own, the table keeps it while it is shown
  const [localState, setLocalState] = useState<UiState>();
  const state = onUiState ? uiState : (localState ?? uiState);
  const tableVis: TableUiVis = state.vis ?? {};
  const write = (next: TableUiVis) => {
    const updated = { ...state, vis: next };
    if (onUiState) onUiState(updated);
    else setLocalState(updated);
  };
  const colWidth = tableVis.columnsWidth ?? [];
  const ui: TableUi = {
    sort: tableVis.sortColumn ?? {},
    setSort: (sort) => write({ ...tableVis, sortColumn: sort }),
    colWidth,
    setWidth: (width) => {
      const at = colWidth.findIndex((column) => column.colIndex === width.colIndex);
      write({ ...tableVis, columnsWidth: at < 0 ? [...colWidth, width] : colWidth.map((column, index) => (index === at ? width : column)) });
    },
  };

  const filterBucket: FilterBucket | undefined = onFilter
    ? (formatted, rows, rowIndex, columnIndex, negate) => {
        // The columns of the answer the table shows: a percentage column is none of them
        const sources = formatted.columns.flatMap((column) => (column.source ? [column.source] : []));
        const clicked = formatted.columns[columnIndex]?.source;
        const index = clicked ? sources.indexOf(clicked) : -1;
        if (index < 0) return;
        const filters = cellFilters(sources, rows, index, rowIndex, negate, context);
        // A bucket of the time field sets the time instead, as the original's filter action does
        const timeField = context.indexPattern?.timeFieldName;
        const time = timeField && onTimeChange ? filters.find((filter) => isTimeFilter(filter, timeField)) : undefined;
        if (time?.range && timeField) {
          const bounds = time.range[timeField];
          const end = (value: unknown) => new Date(typeof value === 'string' || typeof value === 'number' ? value : Date.now()).toISOString();
          onTimeChange?.({ from: end(bounds.gt ?? bounds.gte), to: end(bounds.lt ?? bounds.lte) });
        }
        const rest = filters.filter((filter) => filter !== time);
        if (rest.length > 0) onFilter(rest);
      }
    : undefined;

  const showNoResult = visData.table ? visData.table.rows.length === 0 : visData.tableGroups.length === 0;
  if (showNoResult) return <VisNoResults />;

  // Tables split into columns are set side by side, each as wide as its columns. The original's are
  // each a million pixels wide there (a table of the whole width in a box as wide as its content),
  // which shows the first table's first column alone; that is not copied.
  const sideBySide = visData.direction === 'column';
  const shared = { params, visTitle: vis.title, ui, filterBucket, sideBySide };
  return (
    <div className={cx('visTable', sideBySide ? 'visTable--row' : 'visTable--column')} data-test-subj="visTable">
      {visData.table ? (
        <DynamicTable table={visData.table} {...shared} />
      ) : (
        visData.tableGroups.map(({ title, table: group }, index) => (
          <div key={`${index}:${title}`} className="visTable__group">
            <DynamicTable title={title} table={group} {...shared} />
          </div>
        ))
      )}
    </div>
  );
}

/** A filter on a range of the time field, as the original's extractTimeFilter finds one; not one against it */
function isTimeFilter(filter: Filter, timeField: string): boolean {
  return Boolean(filter.range) && Object.keys(filter.range ?? {})[0] === timeField && !filter.meta.negate;
}

function DynamicTable({
  title,
  table,
  params,
  visTitle,
  ui,
  filterBucket,
  sideBySide,
}: {
  title?: string;
  table: FormattedTable;
  params: TableVisParams;
  visTitle: string;
  ui: TableUi;
  filterBucket?: FilterBucket;
  /** One of the tables of a split set side by side: as wide as its columns, never narrowed to the room */
  sideBySide: boolean;
}) {
  const { rows, columns } = table;
  const tableRef = useRef<HTMLTableElement>(null);
  const didDrag = useRef(false);
  const colWidthKey = ui.colWidth.map(({ colIndex, width }) => `${colIndex}:${width}`).join(',');

  // The widths dragged are there from the first drawing
  const [widths, setWidths] = useState<number[]>(() => {
    const initial: number[] = [];
    for (const { colIndex, width } of ui.colWidth) if (colIndex >= 0) initial[colIndex] = width;
    return initial;
  });
  // The room of each title cut short, as the original measures it; 0 for one shown whole
  const [cut, setCut] = useState<number[]>([]);

  const perPage = typeof params.perPage === 'number' && params.perPage > 0 ? params.perPage : DEFAULT_PAGE_SIZE;
  const [pageSize, setPageSize] = useState(perPage);
  // A new "Max rows per page" is taken; the original kept the first until it was drawn anew
  const [pageSizeFrom, setPageSizeFrom] = useState(perPage);
  if (pageSizeFrom !== perPage) {
    setPageSizeFrom(perPage);
    setPageSize(perPage);
  }
  const [pageIndex, setPageIndex] = useState(0);
  const pageCount = Math.ceil(rows.length / pageSize);
  // Back to the first page when the size of a page or the number of rows changes
  useEffect(() => setPageIndex(0), [pageSize, rows.length]);
  const page = pageCount > 0 ? Math.min(pageIndex, pageCount - 1) : pageIndex;

  const { colIndex: sortIndex, direction: sortDirection } = ui.sort;
  const sortedRows = useMemo(() => {
    const id = sortIndex !== undefined && sortIndex !== null ? columns[sortIndex]?.id : undefined;
    return id && sortDirection ? orderRows(rows, id, sortDirection) : rows;
  }, [columns, rows, sortIndex, sortDirection]);
  const pageRows = sortedRows.slice(page * pageSize, page * pageSize + pageSize);

  // The widths, from the text of the cells of the page shown, measured as the original does: in a
  // hidden box of the small type; again when the data, its order or a dragged width changes
  useLayoutEffect(() => {
    const element = tableRef.current;
    if (!element) return undefined;
    const measure = document.createElement('div');
    measure.className = 'visTable__measure';
    document.body.appendChild(measure);
    const widthOf = (text: string) => {
      measure.textContent = text;
      return measure.offsetWidth;
    };
    const container = element.closest('.visTable__container');
    const containerWidth = sideBySide ? Infinity : container ? container.getBoundingClientRect().width : window.innerWidth * 0.7;
    const cellWidths = columns.map((_, index) =>
      Array.from(element.querySelectorAll(`tbody tr td:nth-child(${index + 1})`), (cell) => widthOf(cell.textContent ?? ''))
    );
    const titleWidths = columns.map((column) => widthOf(column.title));
    const next = columnWidths(cellWidths, titleWidths, ui.colWidth, containerWidth);
    setWidths(next);
    setCut(columns.map((_, index) => (next[index] && truncatesHeader(titleWidths[index], next[index]) ? next[index] - HEADER_BUTTON_SPACE : 0)));
    measure.remove();
    return () => measure.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, sortIndex, sortDirection, colWidthKey]);

  const handleSort = (index: number) => {
    ui.setSort(
      sortIndex === index ? { colIndex: index, direction: sortDirection === 'asc' ? 'desc' : 'asc' } : { colIndex: index, direction: 'asc' }
    );
    setPageIndex(0);
  };

  const startResize = (index: number) => (event: ReactMouseEvent) => {
    event.stopPropagation();
    didDrag.current = false;
    const initial = widths[index] || MIN_COLUMN_WIDTH;
    const startX = event.clientX;
    let current = initial;
    const onMove = (move: MouseEvent) => {
      const delta = move.clientX - startX;
      if (Math.abs(delta) > 5) didDrag.current = true;
      current = Math.max(initial + delta, MIN_COLUMN_WIDTH);
      setWidths((previous) => {
        const next = [...previous];
        next[index] = current;
        return next;
      });
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      // Kept only when the edge was dragged
      if (didDrag.current) ui.setWidth({ colIndex: index, width: current });
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    event.preventDefault();
  };

  const widthStyle = (index: number) => (widths[index] ? `${widths[index]}px` : 'auto');
  const contentWidth = columns.reduce((sum, _, index) => sum + (widths[index] ?? 0), 0);

  return (
    <div className="visTable__item">
      {title && <h3 className="visTable__title">{title}</h3>}
      <div className="visTable__container">
        <TableExport title={visTitle} rows={sortedRows} columns={columns} />
        <table ref={tableRef} style={sideBySide && contentWidth > 0 ? { width: contentWidth } : undefined}>
          <thead>
            <tr>
              {columns.map((column, index) => (
                <th
                  key={column.id}
                  className={cx('visTable__header', sortIndex === index && 'visTable__header--sorted')}
                  style={{ width: widthStyle(index) }}
                  onClick={() => {
                    const dragged = didDrag.current;
                    didDrag.current = false;
                    if (!dragged) handleSort(index);
                  }}
                >
                  <span className="visTable__headerContent">
                    <Tooltip content={column.title} delay="regular">
                      <span
                        className="visTable__headerText"
                        style={cut[index] ? { maxWidth: cut[index], overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block' } : undefined}
                      >
                        {column.title}
                      </span>
                    </Tooltip>
                    <Icon name={sortIndex === index && sortDirection === 'asc' ? 'sortUp' : 'sortDown'} className="visTable__sortIcon" />
                  </span>
                  <span
                    className="visTable__resize"
                    role="button"
                    aria-label="Resize column"
                    tabIndex={-1}
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                    onMouseDown={startResize(index)}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row, rowIndex) => (
              <Fragment key={rowIndex}>
                <tr>
                  {columns.map((column, columnIndex) => (
                    <td key={column.id} style={{ width: widthStyle(columnIndex) }}>
                      <div className="visTable__cell">
                        <span className="visTable__cellValue" data-test-subj="tableVisCellDataField">
                          <FormattedValue content={column.cell(row[column.id])} />
                        </span>
                        {filterBucket && column.filterable && (
                          <span className="visTable__cellFilter" data-test-subj="tableVisCellFilter">
                            <Tooltip content="Filter for value" delay="regular">
                              <Button
                                variant="empty"
                                icon="magnifyWithPlus"
                                aria-label="Filter for value"
                                testId="tableVisFilterForValue"
                                className="visTable__filterButton"
                                onClick={() => filterBucket(table, sortedRows, page * pageSize + rowIndex, columnIndex, false)}
                              />
                            </Tooltip>
                            <Tooltip content="Filter out value" delay="regular">
                              <Button
                                variant="empty"
                                icon="magnifyWithMinus"
                                aria-label="Filter out value"
                                testId="tableVisFilterOutValue"
                                className="visTable__filterButton"
                                onClick={() => filterBucket(table, sortedRows, page * pageSize + rowIndex, columnIndex, true)}
                              />
                            </Tooltip>
                          </span>
                        )}
                      </div>
                    </td>
                  ))}
                </tr>
                {rowIndex < pageRows.length - 1 && (
                  <tr>
                    <td colSpan={columns.length} className="visTable__separator" />
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
          {params.showTotal && (
            <tfoot>
              <tr>
                {columns.map((column) => (
                  <td key={column.id}>{column.formattedTotal || null}</td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
        {rows.length > 0 && (
          <PaginationControls page={page} pageCount={pageCount} pageSize={pageSize} onPage={setPageIndex} onPageSize={setPageSize} />
        )}
      </div>
    </div>
  );
}

/** The button over a table that downloads it, raw or as shown; its menu stays open, as the original's */
function TableExport({ title, rows, columns }: { title: string; rows: TableRow[]; columns: FormattedColumn[] }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const download = (formatted: boolean) => {
    const csv = toCsv(
      formatted,
      rows,
      columns,
      services.uiSettings.get<string>('csv:separator', ','),
      services.uiSettings.get<boolean>('csv:quoteValues', true)
    );
    // With the mark of its encoding first, as the original saves it
    downloadFile(csvFileName(title, formatted), new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
  };
  return (
    <div className="visTable__export">
      {/* Under the middle of its button, as the original asks for it ("downCenter"), or where the
          original's placement puts it instead: beside the button near the window's edge */}
      <Popover
        open={open}
        onClose={close}
        position="downCenter"
        button={
          <Button
            variant="empty"
            icon="download"
            iconSize="s"
            className="visTable__exportButton"
            onClick={() => setOpen((was) => !was)}
          />
        }
      >
        <ContextMenu
          small
          panels={[
            {
              id: 'export',
              items: [
                { id: 'rawCsv', label: 'Raw', onClick: () => download(false) },
                { id: 'formattedCsv', label: 'Formatted', onClick: () => download(true) },
              ],
            },
          ]}
        />
      </Popover>
    </div>
  );
}

/** "Rows per page" and the pages, under the table */
function PaginationControls({
  page,
  pageCount,
  pageSize,
  onPage,
  onPageSize,
}: {
  page: number;
  pageCount: number;
  pageSize: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <div className="visTable__pagination" data-test-subj="tableVisPaginationControls">
      <div className="visTable__paginationItem">
        {/* Over the button, from its left edge, as the original asks for it ("upLeft"), or where the
            original's placement puts it instead */}
        <Popover
          open={open}
          onClose={close}
          position="upLeft"
          button={
            <Button
              variant="ghost"
              icon="chevronDown"
              iconSide="right"
              className="visTable__rowsButton"
              testId="tableVisRowsPerPageButton"
              onClick={() => setOpen((was) => !was)}
            >
              Rows per page: {pageSize}
            </Button>
          }
        >
          <ContextMenu
            onDone={close}
            panels={[
              {
                id: 'sizes',
                items: PAGE_SIZE_OPTIONS.map((size) => ({
                  id: `${size} rows`,
                  label: `${size} rows`,
                  icon: size === pageSize ? 'check' : 'empty',
                  testId: `tableVisRowsPerPage-${size}`,
                  onClick: () => onPageSize(size),
                })),
              },
            ]}
          />
        </Popover>
      </div>
      <div className="visTable__paginationItem" data-test-subj="tableVisPagination">
        <Pagination page={page} pages={pageCount} onPage={onPage} />
      </div>
    </div>
  );
}

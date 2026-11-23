/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The pieces the index pattern pages draw as the original's EUI does: a table that sorts and
 * pages the rows it holds (EuiInMemoryTable), its pagination, an icon with a tooltip, a dot for
 * what is true, the small buttons and boxes of these pages, and the dialog that asks to confirm.
 */

import { isValidElement, useEffect, useRef, useState, type ReactNode } from 'react';
import { cx } from '../../components/basic';
import { Icon, type IconName } from '../../components/icon';
import { Modal, Tooltip } from '../../components/overlay';

// --- Atoms ----------------------------------------------------------------------------------------

/**
 * EuiConfirmModal as the original opens it: as wide as its words and at least 400 pixels, a body
 * only when there is something to say, and EUI's buttons of the default size
 */
export function Confirm({
  title,
  children,
  confirmLabel,
  danger,
  busy,
  onConfirm,
  onCancel,
}: {
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      title={<span data-test-subj="confirmModalTitleText">{title}</span>}
      onClose={onCancel}
      testId="confirmModal"
      className="inpConfirm"
      footer={
        <>
          <button
            type="button"
            className="inpButtonEmpty inpButtonEmpty--primary inpButtonEmpty--m"
            data-test-subj="confirmModalCancelButton"
            onClick={onCancel}
          >
            <span className="inpButtonEmpty__text">Cancel</span>
          </button>
          <button
            type="button"
            className={cx('inpButton inpButton--m', danger ? 'inpButton--danger' : 'inpButton--fill')}
            data-test-subj="confirmModalConfirmButton"
            data-autofocus
            disabled={busy}
            onClick={onConfirm}
          >
            <span className="inpButton__content">
              {busy && <span className="inpSpinner" />}
              <span className="inpButton__text">{confirmLabel}</span>
            </span>
          </button>
        </>
      }
    >
      {children !== undefined && (
        <div className="inpText" data-test-subj="confirmModalBodyText">
          {children}
        </div>
      )}
    </Modal>
  );
}

/** EuiIcon type="dot": a filled circle */
export function Dot({ label }: { label: string }) {
  return (
    <svg className="inpDot" viewBox="0 0 16 16" role="img" aria-label={label}>
      <circle cx="8" cy="8" r="4" />
    </svg>
  );
}

/** EuiIconTip: an icon that says more when the pointer is on it */
export function IconTip({
  icon,
  label,
  content,
  tone = 'primary',
}: {
  icon: IconName;
  label: string;
  content: ReactNode;
  tone?: 'primary' | 'warning';
}) {
  return (
    <Tooltip content={content}>
      <span className={cx('inpIconTip', `inpIconTip--${tone}`)} tabIndex={0} role="img" aria-label={label}>
        <Icon name={icon} />
      </span>
    </Tooltip>
  );
}

export interface ButtonIconProps {
  icon: IconName;
  label: string;
  onClick?: () => void;
  tone?: 'primary' | 'text' | 'danger';
  size?: 'xs' | 's';
  disabled?: boolean;
  testId?: string;
  labelledBy?: string;
  className?: string;
}

/** EuiButtonIcon */
export function ButtonIcon({
  icon,
  label,
  onClick,
  tone = 'primary',
  size = 'xs',
  disabled,
  testId,
  labelledBy,
  className,
}: ButtonIconProps) {
  return (
    <button
      type="button"
      className={cx('inpButtonIcon', `inpButtonIcon--${tone}`, `inpButtonIcon--${size}`, className)}
      onClick={onClick}
      disabled={disabled}
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      data-test-subj={testId}
    >
      <Icon name={icon} />
    </button>
  );
}

// --- The table --------------------------------------------------------------------------------------

export interface TableAction<Row> {
  name: string;
  description: string;
  icon: IconName;
  onClick: (row: Row) => void;
  tone?: 'primary' | 'danger';
  testId?: string;
  /** Whether a row has the action: EUI draws nothing for a row that has none */
  available?: (row: Row) => boolean;
}

export interface TableColumn<Row> {
  /** The property of the row shown, sorted on and searched */
  field?: string;
  name: ReactNode;
  /** Said by a screen reader and by the header's title */
  description?: string;
  /** true sorts on the field; a function sorts on what it gives */
  sortable?: boolean | ((row: Row) => unknown);
  render?: (value: unknown, row: Row) => ReactNode;
  width?: string;
  testId?: string;
  align?: 'right';
  actions?: Array<TableAction<Row>>;
}

export interface TableSort {
  field: string;
  direction: 'asc' | 'desc';
}

export interface TablePagination {
  initialPageSize: number;
  pageSizeOptions: number[];
}

/**
 * EUI's default comparison: equal values keep their places, `undefined` and `null` go last,
 * whatever the direction
 */
export function compareValues(a: unknown, b: unknown, direction: 'asc' | 'desc'): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (a === b) return 0;
  const result = (a as number) > (b as number) ? 1 : -1;
  return direction === 'asc' ? result : -result;
}

/** The order after a click on a header: ascending, descending, and then none when allowed */
export function nextSort(current: TableSort | undefined, field: string, allowNeutral: boolean): TableSort | undefined {
  if (!current || current.field !== field) return { field, direction: 'asc' };
  if (current.direction === 'asc') return { field, direction: 'desc' };
  return allowNeutral ? undefined : { field, direction: 'asc' };
}

export function sortRows<Row>(rows: Row[], columns: Array<TableColumn<Row>>, sort: TableSort | undefined): Row[] {
  if (!sort) return rows;
  const column = columns.find((candidate) => candidate.field === sort.field);
  if (!column) return rows;
  const valueOf =
    typeof column.sortable === 'function'
      ? column.sortable
      : (row: Row) => (row as Record<string, unknown>)[sort.field];
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => compareValues(valueOf(a.row), valueOf(b.row), sort.direction) || a.index - b.index)
    .map(({ row }) => row);
}

/** The pages EuiPagination shows: five around the current one, the first and the last */
export function visiblePages(pageCount: number, active: number): Array<number | 'before' | 'after'> {
  const MAX = 5;
  const around = Math.floor(MAX * 0.5);
  const first = Math.max(0, Math.min(active - around, pageCount - MAX));
  const last = Math.min(pageCount, first + MAX);
  const pages: Array<number | 'before' | 'after'> = [];
  if (first > 0) {
    pages.push(0);
    if (first > 1 && first !== 2) pages.push('before');
    else if (first === 2) pages.push(1);
  }
  for (let page = first; page < last; page++) pages.push(page);
  if (last < pageCount) {
    if (last + 1 === pageCount - 1) pages.push(last);
    else if (last < pageCount - 1) pages.push('after');
    pages.push(pageCount - 1);
  }
  return pages;
}

/** EuiPagination: arrows, and the pages as buttons */
export function Pagination({
  pageCount,
  activePage,
  onPage,
  compressed,
}: {
  pageCount: number;
  activePage: number;
  onPage: (page: number) => void;
  compressed?: boolean;
}) {
  const count = Math.max(pageCount, 1);
  return (
    <nav className="inpPagination">
      <ButtonIcon
        icon="chevronLeft"
        label={activePage === 0 ? 'Previous page' : `Previous page, ${activePage}`}
        tone="text"
        disabled={activePage === 0}
        onClick={() => onPage(activePage - 1)}
        testId="pagination-button-previous"
      />
      {compressed ? (
        <span className="inpPagination__compressed">
          {activePage + 1} of {count}
        </span>
      ) : (
        <ul className="inpPagination__list">
          {visiblePages(count, activePage).map((page) =>
            typeof page === 'number' ? (
              <li key={page} className="inpPagination__item">
                <button
                  type="button"
                  className={cx('inpPagination__page', page === activePage && 'inpPagination__page--active')}
                  aria-label={`Page ${page + 1} of ${count}`}
                  aria-current={page === activePage ? true : undefined}
                  disabled={page === activePage}
                  data-test-subj={`pagination-button-${page}`}
                  onClick={() => onPage(page)}
                >
                  {page + 1}
                </button>
              </li>
            ) : (
              <li key={page} className="inpPagination__item inpPagination__ellipsis" aria-hidden="true">
                …
              </li>
            )
          )}
        </ul>
      )}
      <ButtonIcon
        icon="chevronRight"
        label={activePage >= count - 1 ? 'Next page' : `Next page, ${activePage + 2}`}
        tone="text"
        disabled={activePage >= count - 1}
        onClick={() => onPage(activePage + 1)}
        testId="pagination-button-next"
      />
    </nav>
  );
}

/** A small menu under a button, closed by a click elsewhere or Escape */
export function Dropdown({
  button,
  open,
  onClose,
  children,
  className,
}: {
  button: ReactNode;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (event: MouseEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) onClose();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', escape);
    };
  }, [open, onClose]);
  return (
    <div className={cx('inpDropdown', className)} ref={box}>
      {button}
      {open && <div className="inpDropdown__panel atlMaterial">{children}</div>}
    </div>
  );
}

/** "Rows per page", and the sizes to choose from */
export function RowsPerPage({
  size,
  options,
  onSize,
  testId = 'tablePaginationPopoverButton',
  itemTestId = (option: number) => `tablePagination-${option}-rows`,
}: {
  size: number;
  options: number[];
  onSize: (size: number) => void;
  testId?: string;
  itemTestId?: (option: number) => string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dropdown
      open={open}
      onClose={() => setOpen(false)}
      className="inpDropdown--up"
      button={
        <button
          type="button"
          className="inpButtonEmpty inpButtonEmpty--xs inpButtonEmpty--text"
          onClick={() => setOpen(!open)}
          data-test-subj={testId}
        >
          <span className="inpButtonEmpty__text">Rows per page: {size}</span>
          <Icon name="chevronDown" />
        </button>
      }
    >
      <div className="inpMenu" role="menu">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            role="menuitem"
            className="inpMenu__item"
            data-test-subj={itemTestId(option)}
            onClick={() => {
              setOpen(false);
              onSize(option);
            }}
          >
            <span className="inpMenu__check">{option === size && <Icon name="check" />}</span>
            {option} rows
          </button>
        ))}
      </div>
    </Dropdown>
  );
}

let tableIds = 0;

/** The text of a header, as EUI reads it for the title of the header: the name, then the description */
function nameText(name: ReactNode): string {
  if (typeof name === 'string' || typeof name === 'number') return String(name);
  if (Array.isArray(name)) return name.map(nameText).join('');
  if (isValidElement<{ children?: ReactNode }>(name)) return nameText(name.props.children);
  return '';
}

/** What a screen reader is told of the table, as EuiBasicTable tells it */
function captionOf(shown: number, total: number, pagination: boolean, page: number, pageCount: number): string {
  if (!pagination) return `This table contains ${shown} rows.`;
  return total > 0
    ? `This table contains ${shown} rows out of ${total} rows; Page ${page + 1} of ${pageCount}.`
    : `This table contains ${shown} rows; Page ${page + 1} of ${pageCount}.`;
}

/**
 * EuiInMemoryTable, or EuiBasicTable without pagination: the rows it is given, sorted by a click
 * on a header and cut into pages. New rows start again at the first page.
 */
export function InMemoryTable<Row>({
  rows,
  columns,
  rowKey,
  pagination = { initialPageSize: 10, pageSizeOptions: [5, 10, 25, 50] },
  initialSort,
  allowNeutralSort = true,
  loading,
  noItemsMessage = 'No items found',
  rowTestId,
  testId,
  className,
  compressed,
}: {
  rows: Row[];
  columns: Array<TableColumn<Row>>;
  rowKey: (row: Row, index: number) => string;
  /** false: every row, no pages (EuiBasicTable) */
  pagination?: TablePagination | false;
  initialSort?: TableSort;
  allowNeutralSort?: boolean;
  loading?: boolean;
  noItemsMessage?: ReactNode;
  rowTestId?: (row: Row) => string | undefined;
  testId?: string;
  className?: string;
  compressed?: boolean;
}) {
  const [sort, setSort] = useState<TableSort | undefined>(initialSort);
  const [pageSize, setPageSize] = useState(pagination ? pagination.initialPageSize : 0);
  const [pageIndex, setPageIndex] = useState(0);
  const [id] = useState(() => `inpTable${++tableIds}`);
  // New rows (a search, a save) start again at the first page, as EuiInMemoryTable does
  const [previousRows, setPreviousRows] = useState(rows);
  if (rows !== previousRows) {
    setPreviousRows(rows);
    setPageIndex(0);
  }
  const sorted = sortRows(rows, columns, sort);
  const pageCount = pagination ? Math.ceil(sorted.length / pageSize) : 1;
  const page = Math.min(pageIndex, Math.max(pageCount - 1, 0));
  const shown = pagination ? sorted.slice(page * pageSize, page * pageSize + pageSize) : sorted;

  return (
    <div className={cx('inpTableWrap', loading && 'inpTableWrap--loading', className)} data-test-subj={testId}>
      {loading && <div className="inpTableWrap__progress" />}
      <table className={cx('inpTable', compressed && 'inpTable--compressed')} id={id}>
        <caption className="inpScreenReader">
          {captionOf(shown.length, sorted.length, !!pagination, page, pageCount)}
        </caption>
        <thead>
          <tr>
            {columns.map((column, index) => {
              const sortable = !column.actions && column.sortable !== undefined && column.sortable !== false && column.field;
              const direction = sortable && sort && sort.field === column.field ? sort.direction : undefined;
              // EUI names a header by its field, a computed column by its name; the actions' not at all
              const cellTestId = column.actions
                ? undefined
                : `tableHeaderCell_${column.field ?? String(column.name)}_${index}`;
              const text = nameText(column.name);
              const content = (
                <span className="inpTable__headerContent">
                  <span className="inpTable__headerText" title={column.description ? `${text}; ${column.description}` : text}>
                    {column.name}
                  </span>
                  {direction && <Icon name={direction === 'asc' ? 'sortUp' : 'sortDown'} className="inpTable__sortIcon" />}
                </span>
              );
              // A header without a name is a plain cell
              const Cell = column.name === '' || column.name === undefined || column.name === null ? 'td' : 'th';
              return (
                <Cell
                  key={index}
                  scope={Cell === 'th' ? 'col' : undefined}
                  role="columnheader"
                  className={cx(
                    'inpTable__th',
                    column.actions && 'inpTable__th--actions',
                    (column.align === 'right' || column.actions) && 'inpTable__th--right'
                  )}
                  style={column.width ? { width: column.width } : undefined}
                  data-test-subj={cellTestId}
                  aria-sort={sortable ? (direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'none') : undefined}
                >
                  {sortable ? (
                    <button
                      type="button"
                      className={cx('inpTable__sortButton', direction && 'inpTable__sortButton--sorted')}
                      data-test-subj="tableHeaderSortButton"
                      onClick={() => {
                        setSort(nextSort(sort, column.field as string, allowNeutralSort));
                        setPageIndex(0);
                      }}
                    >
                      {content}
                    </button>
                  ) : (
                    <span className="inpTable__headerStatic">{content}</span>
                  )}
                </Cell>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {shown.length === 0 ? (
            <tr className="inpTable__row">
              <td colSpan={columns.length} className="inpTable__td inpTable__empty">
                <span className="inpTable__content inpTable__content--center">{noItemsMessage}</span>
              </td>
            </tr>
          ) : (
            shown.map((row, rowIndex) => (
              <tr key={rowKey(row, rowIndex)} className="inpTable__row" data-test-subj={rowTestId?.(row)}>
                {columns.map((column, index) => {
                  if (column.actions) {
                    const actions = column.actions.filter((action) => !action.available || action.available(row));
                    return (
                      <td
                        key={index}
                        className="inpTable__td inpTable__td--actions"
                        style={column.width ? { width: column.width } : undefined}
                      >
                        <span className="inpTable__content inpTable__content--actions">
                          {actions.map((action) => {
                            const labelId = `${id}-${rowIndex}-${action.name}`;
                            return (
                              <Tooltip key={action.name} content={action.description}>
                                <span className="inpTable__action">
                                  <ButtonIcon
                                    icon={action.icon}
                                    label={action.name}
                                    labelledBy={labelId}
                                    tone={action.tone ?? 'primary'}
                                    onClick={() => action.onClick(row)}
                                    testId={action.testId}
                                  />
                                  <span hidden id={labelId}>
                                    {action.name}
                                  </span>
                                </span>
                              </Tooltip>
                            );
                          })}
                        </span>
                      </td>
                    );
                  }
                  const value = column.field ? (row as Record<string, unknown>)[column.field] : row;
                  const shownValue = column.render ? column.render(value, row) : (value as ReactNode);
                  return (
                    <td
                      key={index}
                      className={cx('inpTable__td', column.align === 'right' && 'inpTable__td--right')}
                      data-test-subj={column.testId}
                      style={column.width ? { width: column.width } : undefined}
                    >
                      <span
                        className={cx(
                          'inpTable__content',
                          column.render && 'inpTable__content--overflow',
                          column.align === 'right' && 'inpTable__content--right'
                        )}
                      >
                        {column.render ? shownValue : <span className="inpTable__text">{shownValue}</span>}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
      {/* EUI draws no pages under a table without rows */}
      {pagination && shown.length > 0 && (
        <div className="inpTable__footer">
          <RowsPerPage
            size={pageSize}
            options={pagination.pageSizeOptions}
            onSize={(size) => {
              setPageSize(size);
              setPageIndex(0);
            }}
          />
          <Pagination pageCount={pageCount} activePage={page} onPage={setPageIndex} />
        </div>
      )}
    </div>
  );
}

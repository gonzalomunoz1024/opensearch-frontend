/* SPDX-License-Identifier: Apache-2.0 */

/*
 * What the saved objects page is drawn with, as the original's components draw it: the search bar
 * with its filters of field values, the table with its selection and its pages, the icon of a
 * type, and the call-out, checkbox and switch of the original.
 */

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Button, cx } from '../../components/basic';
import { Icon, type IconName } from '../../components/icon';
import { Popover, Tooltip } from '../../components/overlay';
import { Pagination } from '../../components/table';
import { services } from '../../services';
import { HttpFetchError } from '../../services/http';
import { askedOnce, getSavedObjectLabel, objectsDocTitle } from './saved_objects_lib';
import {
  QueryParseError,
  orFieldState,
  parseSearchQuery,
  printSearchQuery,
  runSearchQuery,
  toggleOrFieldValue,
  type Clause,
} from './saved_objects_query';

export const OBJECTS_ROOT = '/app/management/opensearch-dashboards/objects';
export const MANAGEMENT_CRUMB = { text: 'Dashboards Management', to: '/app/management' };

/** The types the page may show: asked when the section is first opened, by the list or by an object */
export const allowedObjectTypes = askedOnce(() =>
  services.http.get<{ types: string[] }>('/api/opensearch-dashboards/management/saved_objects/_allowed_types').then((answer) => answer.types)
);

/**
 * The tab's title, after the header's hook wrote its own from the breadcrumbs: call it below
 * `useBreadcrumbs`, so that it has the last word.
 */
export function useObjectsDocTitle() {
  useEffect(() => {
    document.title = objectsDocTitle(services.boot.name);
  });
}

/** The message of a failed request, as the original's toasts write it */
export function errorText(error: unknown): string {
  if (error instanceof HttpFetchError && error.body && typeof error.body === 'object') {
    const message = (error.body as { message?: unknown }).message;
    if (typeof message === 'string' && message) return message;
  }
  return error instanceof Error ? error.message : String(error);
}

// --- Icons ----------------------------------------------------------------------------------------

// The icons the original's types name, as this product draws them; a type without one has `apps`
const META_ICONS: Record<string, IconName> = {
  gear: 'gear',
  link: 'link',
  indexPatternApp: 'index',
  search: 'search',
  home: 'home',
  dashboardApp: 'dashboard',
  visualizeApp: 'visualize',
  discoverApp: 'discover',
};

export const iconOfMeta = (icon?: string): IconName => (icon ? META_ICONS[icon] : undefined) ?? 'grid';

/** The icon of the Import button and of the file to import: the original's `importAction` */
export const IMPORT_ICON: IconName = 'importAction';

/**
 * The icon of a type, as the original's tables draw it: small (12 px), with its name when the
 * pointer is on it. An application's icon (`dashboardApp`) is given no colour by the original, so
 * it has its two.
 */
export function TypeIcon({ type, icon, testId = 'objectType' }: { type: string; icon?: string; testId?: string }) {
  const label = getSavedObjectLabel(type);
  return (
    <Tooltip content={label}>
      <span className="sobTypeIcon" role="img" aria-label={label} data-test-subj={testId}>
        <Icon name={iconOfMeta(icon)} size="s" app={icon !== undefined && /.+App$/.test(icon)} />
      </span>
    </Tooltip>
  );
}

// --- Small controls -------------------------------------------------------------------------------

export function Callout({
  tone,
  title,
  icon,
  children,
  testId,
}: {
  tone: 'primary' | 'success' | 'warning' | 'danger';
  title?: ReactNode;
  icon?: IconName;
  children?: ReactNode;
  testId?: string;
}) {
  return (
    <div className={`sobCallOut sobCallOut--${tone}`} data-test-subj={testId}>
      {title && (
        <p className="sobCallOut__title">
          {icon && <Icon name={icon} />}
          <span>{title}</span>
        </p>
      )}
      {children && <div className="sobCallOut__body">{children}</div>}
    </div>
  );
}

export function Check({
  checked,
  onChange,
  label,
  disabled,
  testId,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** What a screen reader says: the checkbox has no words beside it */
  label?: string;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <input
      type="checkbox"
      className="sobCheck"
      checked={checked}
      disabled={disabled}
      aria-label={label}
      onChange={(event) => onChange(event.target.checked)}
      data-test-subj={testId}
    />
  );
}

/** The original's compressed switch: a small track, the accent when on */
export function SmallSwitch({
  checked,
  onChange,
  label,
  name,
  disabled,
  testId,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  name?: string;
  disabled?: boolean;
  testId?: string;
}) {
  const id = useId();
  return (
    <span className={cx('sobSwitch', disabled && 'sobSwitch--disabled')}>
      <button
        type="button"
        role="switch"
        id={id}
        name={name}
        className="sobSwitch__button"
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        data-test-subj={testId}
      >
        <span className="sobSwitch__track">
          <span className="sobSwitch__thumb" />
        </span>
      </button>
      <span id={`${id}-label`} className="sobSwitch__label" onClick={() => !disabled && onChange(!checked)}>
        {label}
      </span>
    </span>
  );
}

// --- The search bar -------------------------------------------------------------------------------

export function SearchField({
  value,
  onChange,
  onSearch,
  incremental,
  placeholder,
  ariaLabel,
  testId,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Called on Enter and when the field is cleared; on every change too when `incremental` */
  onSearch: (value: string) => void;
  incremental?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  testId?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="sobSearchField">
      <Icon name="search" className="sobSearchField__icon" />
      <input
        ref={input}
        type="search"
        className={cx('sobSearchField__input', value !== '' && 'sobSearchField__input--clearable')}
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        data-test-subj={testId}
        onChange={(event) => {
          onChange(event.target.value);
          if (incremental) onSearch(event.target.value);
        }}
        onKeyUp={(event) => {
          if (event.key === 'Enter' && !incremental) onSearch(event.currentTarget.value);
        }}
      />
      {value !== '' && (
        <button
          type="button"
          className="sobSearchField__clear"
          aria-label="Clear input"
          onClick={() => {
            onChange('');
            onSearch('');
            input.current?.focus();
          }}
        >
          <Icon name="cross" />
        </button>
      )}
    </div>
  );
}

export interface FilterOption {
  value: string;
  name: string;
  view: ReactNode;
}

/** A filter of the values of one field: the original's `field_value_selection`, its values or'ed */
export interface FieldFilter {
  field: string;
  name: string;
  options: FilterOption[];
  /** The list has a search field from this many options on */
  searchThreshold?: number;
}

export type SearchChange = { clauses: Clause[]; text: string; error?: undefined } | { error: string };

function FilterSelect({ filter, clauses, onChange }: { filter: FieldFilter; clauses: Clause[]; onChange: (clauses: Clause[]) => void }) {
  const [open, setOpen] = useState(false);
  // What was typed in the list's search field: the list is then in its own order, cut to the names
  // that start with it, until the query changes and the list is read again
  const [typed, setTyped] = useState<string>();
  const [listKey, setListKey] = useState(0);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setTyped(undefined);
    setListKey((key) => key + 1);
  }, [clauses]);

  const states = useMemo(
    () => new Map(filter.options.map((option) => [option.value, orFieldState(clauses, filter.field, option.value)])),
    [filter, clauses]
  );
  const ordered = useMemo(
    () => [
      ...filter.options.filter((option) => states.get(option.value) === 'on'),
      ...filter.options.filter((option) => states.get(option.value) === 'off'),
      ...filter.options.filter((option) => states.get(option.value) === undefined),
    ],
    [filter, states]
  );
  const shown =
    typed === undefined ? ordered : filter.options.filter((option) => option.name.toLowerCase().startsWith(typed.toLowerCase()));
  const active = clauses.some((clause) => clause.type === 'field' && clause.field === filter.field && Array.isArray(clause.value));
  const onCount = ordered.filter((option) => states.get(option.value) === 'on').length;
  const searchable = filter.options.length >= (filter.searchThreshold ?? 10);

  // As the original's popover, the kit's holds the focus: the first thing that takes it has it when
  // the list opens (the search field when there is one, else the first value), Tab goes round what
  // is in it, and Escape gives the focus back to the button. A click elsewhere puts it where it clicks.
  const close = () => setOpen(false);
  // The arrows go from the search field down the values and back
  const moveFocus = (event: KeyboardEvent<HTMLElement>, index: number) => {
    const panel = event.currentTarget.closest('.atlPopover');
    const items = [...(panel?.querySelectorAll<HTMLElement>('.sobFilterItem') ?? [])];
    let target: HTMLElement | null | undefined;
    if (event.key === 'ArrowDown') target = items[index + 1];
    else if (event.key === 'ArrowUp' && index > 0) target = items[index - 1];
    else if (event.key === 'ArrowUp' && index === 0) target = panel?.querySelector<HTMLElement>('.sobFilterPopover__title input');
    if (!target) return;
    event.preventDefault();
    target.focus();
  };

  const button = (
    <button
      type="button"
      className={cx('sobFilterButton', active && 'sobFilterButton--active')}
      onClick={() => {
        // As the original's: the list is read again each time it opens, whatever was typed before
        if (!open) setTyped(undefined);
        setOpen(!open);
      }}
      aria-expanded={open}
    >
      <span className="sobFilterButton__text">
        <span className="sobFilterButton__label" data-text={filter.name} title={filter.name}>
          {filter.name}
        </span>
        {/* As the original's button: no badge, but a 0, when the field is filtered on no value it asks for */}
        {active && (onCount > 0 ? <span className="sobFilterButton__badge">{onCount}</span> : '0')}
      </span>
      <Icon name="chevronDown" />
    </button>
  );

  return (
    <Popover
      button={button}
      open={open}
      onClose={close}
      align="center"
      offset={8}
      buffer={16}
      className="sobFilterPopover"
      anchorClassName="sobFilterGroup__item"
    >
      {searchable && (
        <div className="sobFilterPopover__title" onKeyDown={(event) => moveFocus(event, -1)}>
          <SearchFieldUncontrolled key={listKey} onSearch={setTyped} />
        </div>
      )}
      {shown.length === 0 ? (
        <div className="sobFilterPopover__note">
          <Icon name="minusCircle" />
          <p>No options found</p>
        </div>
      ) : (
        <div className="sobFilterPopover__items" role="listbox">
          {shown.map((option, index) => {
            const state = states.get(option.value);
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={state === 'on'}
                className="sobFilterItem"
                onClick={() => onChange(toggleOrFieldValue(clauses, filter.field, option.value))}
                onKeyDown={(event) => moveFocus(event, index)}
              >
                <span className="sobFilterItem__mark">{state === 'on' ? <Icon name="check" /> : state === 'off' ? <Icon name="cross" /> : null}</span>
                <span className="sobFilterItem__text">{option.view}</span>
              </button>
            );
          })}
        </div>
      )}
    </Popover>
  );
}

function SearchFieldUncontrolled({ onSearch }: { onSearch: (value: string) => void }) {
  const [value, setValue] = useState('');
  return <SearchField value={value} onChange={setValue} onSearch={onSearch} incremental />;
}

/**
 * The original's search bar: the query is read when Enter is pressed or the field cleared, and a
 * filter writes its values into the query and the field. What cannot be read is reported, and the
 * last query read stays.
 */
export function SearchBar({
  filters,
  onChange,
  toolsRight,
  testId,
}: {
  filters: FieldFilter[];
  onChange: (change: SearchChange) => void;
  toolsRight?: ReactNode;
  testId?: string;
}) {
  const [text, setText] = useState('');
  const [clauses, setClauses] = useState<Clause[]>([]);

  const search = (value: string) => {
    let parsed: Clause[];
    try {
      parsed = parseSearchQuery(value);
    } catch (error) {
      if (!(error instanceof QueryParseError)) throw error;
      onChange({ error: error.message });
      return;
    }
    setClauses(parsed);
    onChange({ clauses: parsed, text: value });
  };

  const filtered = (next: Clause[]) => {
    const printed = printSearchQuery(next);
    setClauses(next);
    setText(printed);
    onChange({ clauses: next, text: printed });
  };

  return (
    <div className="sobSearchBar">
      <div className="sobSearchBar__box">
        <SearchField
          value={text}
          onChange={setText}
          onSearch={search}
          placeholder="Search..."
          ariaLabel="This is a search bar. After typing your query, hit enter to filter the results lower in the page."
          testId={testId}
        />
      </div>
      {filters.length > 0 && (
        <div className="sobFilterGroup">
          {filters.map((filter) => (
            <FilterSelect key={filter.field} filter={filter} clauses={clauses} onChange={filtered} />
          ))}
        </div>
      )}
      {toolsRight}
    </div>
  );
}

// --- The table ------------------------------------------------------------------------------------

export interface Column<T> {
  key: string;
  name: ReactNode;
  /** What a screen reader says of the column */
  description?: string;
  width?: number;
  align?: 'center' | 'right';
  testId?: string;
  render: (item: T) => ReactNode;
  /** The buttons at the end of a row */
  actions?: boolean;
}

export interface Paging {
  pageIndex: number;
  pageSize: number;
  totalItemCount: number;
  pageSizeOptions: number[];
}

export function BasicTable<T>({
  items,
  columns,
  itemId,
  selection,
  pagination,
  onChange,
  loading,
  rowTestId,
  testId,
}: {
  items: T[];
  columns: Array<Column<T>>;
  itemId: (item: T) => string;
  selection?: { selected: T[]; onChange: (selected: T[]) => void };
  pagination?: Paging;
  onChange?: (page: { index: number; size: number }) => void;
  loading?: boolean;
  rowTestId?: (item: T) => string;
  testId?: string;
}) {
  const selectedIds = new Set(selection?.selected.map(itemId));
  const allSelected = items.length > 0 && items.every((item) => selectedIds.has(itemId(item)));
  const span = columns.length + (selection ? 1 : 0);
  // The table its page buttons control, which takes the focus when they turn the page
  const tableId = useId();
  return (
    <div className={cx('sobTable', loading && 'sobTable--loading')} data-test-subj={testId}>
      <table className="sobTable__table" id={tableId} tabIndex={-1}>
        <caption className="sobHidden">{tableCaption(items.length, pagination)}</caption>
        <colgroup>
          {selection && <col style={{ width: 32 }} />}
          {columns.map((column) => (
            <col key={column.key} style={column.width ? { width: column.width } : undefined} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {selection && (
              <th className="sobTable__check">
                {/* As the original's: checked when every row is, and never half */}
                <Check
                  checked={allSelected}
                  disabled={items.length === 0}
                  label="Select all rows"
                  testId="checkboxSelectAll"
                  onChange={(checked) => selection.onChange(checked ? items : [])}
                />
              </th>
            )}
            {columns.map((column) => (
              <th
                key={column.key}
                className={cx('sobTable__th', column.align && `sobTable__cell--${column.align}`, column.actions && 'sobTable__th--actions')}
              >
                <span className="sobTable__thText">{column.name}</span>
                {column.description && <span className="sobHidden">{column.description}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <tr className="sobTable__row">
              <td colSpan={span} className="sobTable__empty">
                {loading ? 'Loading items...' : 'No items found'}
              </td>
            </tr>
          ) : (
            items.map((item, index) => {
              const id = itemId(item);
              const isSelected = selectedIds.has(id);
              return (
                <tr key={`${index}:${id}`} className={cx('sobTable__row', isSelected && 'sobTable__row--selected')} data-test-subj={rowTestId?.(item)}>
                  {selection && (
                    <td className="sobTable__check">
                      <Check
                        checked={isSelected}
                        label="Select this row"
                        testId={`checkboxSelectRow-${id}`}
                        onChange={(checked) =>
                          selection.onChange(
                            checked ? [...selection.selected, item] : selection.selected.filter((other) => itemId(other) !== id)
                          )
                        }
                      />
                    </td>
                  )}
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={cx('sobTable__td', column.align && `sobTable__cell--${column.align}`, column.actions && 'sobTable__td--actions')}
                      data-test-subj={column.testId}
                    >
                      <div className="sobTable__cell">{column.render(item)}</div>
                    </td>
                  ))}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
      {pagination && pagination.totalItemCount > 0 && onChange && <TablePagination {...pagination} controls={tableId} onChange={onChange} />}
    </div>
  );
}

/** What the table tells a screen reader of itself, in EuiBasicTable's words */
export function tableCaption(shown: number, pagination?: Paging): string {
  if (!pagination) return `This table contains ${shown} rows.`;
  const page = pagination.pageIndex + 1;
  const pageCount = Math.ceil(pagination.totalItemCount / pagination.pageSize);
  return pagination.totalItemCount > 0
    ? `This table contains ${shown} rows out of ${pagination.totalItemCount} rows; Page ${page} of ${pageCount}.`
    : `This table contains ${shown} rows; Page ${page} of ${pageCount}.`;
}

/**
 * The buttons of a row, in its last column: the original table's actions, icon buttons in the
 * primary colour (round, 24 px), what they do said by the tooltip
 */
export function RowAction({ label, description, icon, onClick, testId }: { label: string; description: string; icon: IconName; onClick: () => void; testId: string }) {
  return (
    <Tooltip content={description}>
      <Button variant="empty" size="xs" icon={icon} className="atlButton--round" aria-label={label} onClick={onClick} testId={testId} />
    </Tooltip>
  );
}

/** The original's pages under its table: the kit's, as the component library names them */
function TablePagination({
  pageIndex,
  pageSize,
  totalItemCount,
  pageSizeOptions,
  controls,
  onChange,
}: Paging & { controls: string; onChange: (page: { index: number; size: number }) => void }) {
  const pageCount = Math.ceil(totalItemCount / pageSize);
  // A page that is not there any more, after objects went: the last one is shown
  useEffect(() => {
    if (pageCount < pageIndex + 1) onChange({ index: pageCount - 1, size: pageSize });
  }, [pageCount, pageIndex, pageSize, onChange]);

  return (
    <Pagination
      className="sobPagination"
      page={pageIndex}
      pages={pageCount}
      onPage={(index) => onChange({ index, size: pageSize })}
      pageSize={pageSize}
      pageSizes={pageSizeOptions}
      onPageSize={(size) => onChange({ index: 0, size })}
      controls={controls}
    />
  );
}

/**
 * The original's in-memory table: its own pages, and the search bar's query run on the items. A
 * query that cannot be read shows all of them.
 */
export function InMemoryTable<T extends object>({
  items,
  columns,
  itemId,
  pageSizeOptions = [10, 25, 50],
  filters,
  rowTestId,
}: {
  items: T[];
  columns: Array<Column<T>>;
  itemId: (item: T) => string;
  pageSizeOptions?: number[];
  /** A search bar above the table, with these filters */
  filters?: FieldFilter[];
  rowTestId?: (item: T) => string;
}) {
  const [page, setPage] = useState({ index: 0, size: pageSizeOptions[0] ?? 10 });
  const [clauses, setClauses] = useState<Clause[]>();
  const matching = useMemo(() => (clauses ? runSearchQuery(clauses, items) : items), [clauses, items]);
  const shown = matching.slice(page.index * page.size, (page.index + 1) * page.size);
  return (
    <>
      {filters && (
        <div className="sobInMemorySearch">
          <SearchBar
            filters={filters}
            onChange={(change) => {
              setClauses(change.error === undefined ? change.clauses : undefined);
              setPage((current) => ({ ...current, index: 0 }));
            }}
          />
        </div>
      )}
      <BasicTable
        items={shown}
        columns={columns}
        itemId={itemId}
        rowTestId={rowTestId}
        pagination={{ pageIndex: page.index, pageSize: page.size, totalItemCount: matching.length, pageSizeOptions }}
        onChange={setPage}
      />
    </>
  );
}

/* SPDX-License-Identifier: Apache-2.0 */

/*
 * What the pages of Index Management share: the calls to its routes, the panel around a list,
 * the table that pages and sorts on the server or in the browser, the state of a list kept in
 * the address, and the dialogs that name what they are about to change.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button, CallOut, CodeBlock, Health, Spinner, cx, type Tone } from '../../components/basic';
import { CodeEditor } from '../../components/code_editor';
import { Checkbox, FormRow, TextField } from '../../components/form';
import { Icon } from '../../components/icon';
import { MenuButton, Modal, copyText, type MenuItem } from '../../components/overlay';
import { Pagination } from '../../components/table';
import { formatDate } from '../../lib/dates';
import { tokenizeJson } from '../../lib/json_text';
import { getLocation, navigate, navigateHash, useLocation } from '../../router';
import { services } from '../../services';
import { errorMessage, type FetchOptions } from '../../services/http';
import { tableCaption } from './model';
import { SNAPSHOT_MANAGEMENT_PATH } from './routes';

export const APP_PATH = '/app/opensearch_index_management_dashboards';

/**
 * The address of a page of Index Management: `to('/indices')`, `to('/policy-details', { id })`.
 * The pages are one application under two addresses, and a page opened from under Snapshot
 * Management stays there, as in the plugin.
 */
export function to(path: string, params: Record<string, string | undefined> = {}): string {
  const pairs = Object.entries(params)
    .filter((pair): pair is [string, string] => pair[1] !== undefined)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  const app = getLocation().pathname === SNAPSHOT_MANAGEMENT_PATH ? SNAPSHOT_MANAGEMENT_PATH : APP_PATH;
  return `${app}#${path}${pairs.length > 0 ? `?${pairs.join('&')}` : ''}`;
}

export const go = (path: string, params?: Record<string, string | undefined>) =>
  navigate(to(path, params));

// --- The routes of the server ----------------------------------------------------------------------

/** Every route answers this: what was asked for, or why not */
export interface Answer<T = unknown> {
  ok: boolean;
  response?: T;
  error?: string;
  body?: unknown;
}

async function ask<T>(method: string, path: string, options: FetchOptions): Promise<Answer<T>> {
  try {
    const answer = await services.http.fetch<Answer<T>>(`/api/ism/${path}`, { ...options, method });
    return answer && typeof answer === 'object' ? answer : { ok: false, error: 'No answer' };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

type Query = FetchOptions['query'];

export const ism = {
  get: <T,>(path: string, query?: Query) => ask<T>('GET', path, { query }),
  post: <T,>(path: string, body?: unknown, query?: Query) => ask<T>('POST', path, { body, query }),
  put: <T,>(path: string, body?: unknown, query?: Query) => ask<T>('PUT', path, { body, query }),
  delete: <T,>(path: string, query?: Query) => ask<T>('DELETE', path, { query }),
  /** A request to OpenSearch by the name the old client library had for it */
  call: <T,>(endpoint: string, data?: Record<string, unknown>, hideLog?: boolean) =>
    ask<T>('POST', 'apiCaller', {
      body: hideLog === undefined ? { endpoint, data } : { endpoint, data, hideLog },
    }),
  /** A request to OpenSearch written out: its method, its path and what it sends */
  request: <T,>(method: string, path: string, body?: unknown, hideLog?: boolean) =>
    ism.call<T>('transport.request', body === undefined ? { method, path } : { method, path, body }, hideLog),
};

export const toasts = {
  success: (title: ReactNode, text?: ReactNode, lifetime?: number) => services.toasts.success(title, text, lifetime),
  danger: (title: ReactNode | undefined, text?: ReactNode, lifetime?: number) =>
    services.toasts.danger(title || 'Error', text, lifetime),
  warning: (title: ReactNode, text?: ReactNode, lifetime?: number) => services.toasts.warning(title, text, lifetime),
  remove: (id: number) => services.toasts.dismiss(id),
};

/** Loads something when the page opens and again when asked to */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T>();
  const [loading, setLoading] = useState(true);
  const turn = useRef(0);
  const reload = useCallback(async () => {
    const mine = (turn.current += 1);
    setLoading(true);
    try {
      const loaded = await load();
      if (mine === turn.current) setData(loaded);
    } finally {
      if (mine === turn.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, loading, reload, setData };
}

// --- The state of a list, kept in the address ---------------------------------------------------------

export interface ListQuery {
  from: number;
  size: number;
  search: string;
  sortField: string;
  sortDirection: 'asc' | 'desc';
}

export const PAGE_SIZES = [5, 10, 20, 50];

/**
 * What a list shows, read from the address and written back to it, so that a list comes back
 * as it was left. More than the usual five may be kept: `extra` names them with their defaults.
 */
export function useListQuery(defaults: Partial<ListQuery>): [ListQuery, (changes: Partial<ListQuery>) => void];
export function useListQuery<Extra extends Record<string, string>>(
  defaults: Partial<ListQuery>,
  extra: Extra
): [ListQuery & Extra, (changes: Partial<ListQuery & Extra>) => void];
export function useListQuery<Extra extends Record<string, string>>(
  defaults: Partial<ListQuery>,
  extra?: Extra
): [ListQuery & Extra, (changes: Partial<ListQuery & Extra>) => void] {
  const { hashPath, hashParams } = useLocation();
  const key = JSON.stringify(hashParams);
  const query = useMemo(() => {
    const number = (name: 'from' | 'size', fallback: number) => {
      const value = parseInt(hashParams[name] ?? '', 10);
      return Number.isNaN(value) ? fallback : value;
    };
    const more = Object.fromEntries(
      Object.entries(extra ?? {}).map(([name, fallback]) => [name, hashParams[name] ?? fallback])
    ) as Extra;
    return {
      from: number('from', defaults.from ?? 0),
      size: number('size', defaults.size ?? 20),
      search: hashParams.search ?? defaults.search ?? '',
      sortField: hashParams.sortField ?? defaults.sortField ?? 'name',
      sortDirection: hashParams.sortDirection === 'asc' ? 'asc' : hashParams.sortDirection === 'desc' ? 'desc' : (defaults.sortDirection ?? 'desc'),
      ...more,
    } as ListQuery & Extra;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const latest = useRef(query);
  latest.current = query;
  const setQuery = useCallback(
    (changes: Partial<ListQuery & Extra>) => {
      const next = { ...latest.current, ...changes };
      // in the order of their names, as the plugin writes them
      const params = Object.fromEntries(
        Object.entries(next)
          .map(([name, value]): [string, string] => [name, String(value)])
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      );
      navigateHash(hashPath, params, { replace: true });
    },
    [hashPath]
  );
  // The address tells the whole state from the first look, as the plugin's does
  useEffect(() => {
    if (Object.keys(hashParams).length === 0) setQuery({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hashPath]);
  return [query, setQuery];
}

// --- The panel around a list ------------------------------------------------------------------------

export function ContentPanel({
  title,
  count,
  actions,
  description,
  children,
  testId,
}: {
  title: ReactNode;
  /** Shown after the title when there is something to count */
  count?: number;
  actions?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  testId?: string;
}) {
  return (
    <section className="ismPanel" data-test-subj={testId}>
      <header className="ismPanel__header">
        <div className="atlGrow">
          <h1 className="ismPanel__title">
            {title}
            {count !== undefined && count > 0 && <span> ({count})</span>}
          </h1>
          {description && <p className="ismPanel__description">{description}</p>}
        </div>
        {actions && <div className="ismPanel__actions">{actions}</div>}
      </header>
      {children && <div className="ismPanel__body">{children}</div>}
    </section>
  );
}

/** A section of a form or of a page of details: a title over what it holds */
export function Section({
  title,
  description,
  actions,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="ismSection">
      <header className="ismSection__header">
        <div className="atlGrow">
          <h2 className="ismSection__title">{title}</h2>
          {description && <p className="ismPanel__description">{description}</p>}
        </div>
        {actions && <div className="ismPanel__actions">{actions}</div>}
      </header>
      {children && <div className="ismSection__body">{children}</div>}
    </section>
  );
}

/** A button in the header of a panel, with the test id the plugin gives it */
export function PanelButton({
  text,
  ...rest
}: { text: string } & Omit<Parameters<typeof Button>[0], 'children' | 'testId'>) {
  return (
    <Button size="s" testId={`${text}Button`} {...rest}>
      {text}
    </Button>
  );
}

/** The "Actions" button and its menu */
export function ActionsMenu({
  items,
  label = 'Actions',
  testId = 'moreAction',
  disabled,
  size = 's',
}: {
  items: MenuItem[];
  label?: string;
  testId?: string;
  disabled?: boolean;
  /** 'm' for the theme's small button, the plugin's (32 px) */
  size?: 's' | 'm';
}) {
  return (
    <MenuButton
      align="right"
      items={items}
      button={(toggle) => (
        <Button size={size} icon="chevronDown" iconSide="right" disabled={disabled} onClick={toggle} testId={testId}>
          {label}
        </Button>
      )}
    />
  );
}

export function ExternalLink({ href, children = 'Learn more' }: { href: string; children?: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="ismExternal">
      {children}
      <Icon name="external" />
      <span className="atlScreenReaderOnly">(opens in a new tab or window)</span>
    </a>
  );
}

// --- The table --------------------------------------------------------------------------------------

export interface TableColumn<Row> {
  /** Names the column in the address and in test ids */
  field: string;
  name: string;
  sortable?: boolean;
  width?: string;
  align?: 'right' | 'center';
  render: (row: Row) => ReactNode;
  /** What a table sorted in the browser sorts by; the field of the row when left out */
  value?: (row: Row) => unknown;
  /** On one line, cut with an ellipsis: the theme's `truncateText` (a `fixed` table only) */
  truncate?: boolean;
}

export interface TableProps<Row> {
  columns: Array<TableColumn<Row>>;
  /** The rows of the page shown */
  rows: Row[];
  total: number;
  query: Pick<ListQuery, 'from' | 'size' | 'sortField' | 'sortDirection'>;
  onQuery: (changes: Partial<ListQuery>) => void;
  rowId: (row: Row) => string;
  selected?: Row[];
  onSelect?: (rows: Row[]) => void;
  selectable?: (row: Row) => boolean;
  loading?: boolean;
  empty?: ReactNode;
  /** What the table says when it has no rows shows while they load as well, as the theme's table */
  emptyWhileLoading?: boolean;
  testId?: string;
  pageSizes?: number[];
  /** Whether the rows come in pages; a table that shows them all has no pager */
  paged?: boolean;
  /** Laid out as the theme's tables are: the columns of fixed widths, the others sharing the rest */
  fixed?: boolean;
  /** The theme's caption, which says how many rows there are: read aloud, and a pixel high */
  caption?: boolean;
}

export function Table<Row>({
  columns,
  rows,
  total,
  query,
  onQuery,
  rowId,
  selected,
  onSelect,
  selectable,
  loading,
  empty,
  emptyWhileLoading,
  testId,
  pageSizes = PAGE_SIZES,
  paged = true,
  fixed,
  caption,
}: TableProps<Row>) {
  const ids = new Set((selected ?? []).map(rowId));
  const tickable = rows.filter((row) => (selectable ? selectable(row) : true));
  const allTicked = tickable.length > 0 && tickable.every((row) => ids.has(rowId(row)));
  const pages = Math.max(1, Math.ceil(total / query.size));
  const page = Math.min(Math.floor(query.from / query.size), pages - 1);
  return (
    <div className={cx('ismTable', loading && 'ismTable--loading', fixed && 'ismTable--fixed')}>
      <div className="ismTable__scroll">
        <table className="atlTable" data-test-subj={testId}>
          {caption && (
            <caption className="ismTable__caption">
              {tableCaption(rows.length, total, query.size, query.from, paged)}
            </caption>
          )}
          <thead>
            <tr>
              {onSelect && (
                <th className="atlTable__check">
                  {/* As the component library's table, ticked or not: never half ticked */}
                  <Checkbox
                    checked={allTicked}
                    disabled={tickable.length === 0}
                    onChange={(checked) => onSelect(checked ? tickable : [])}
                    testId="checkboxSelectAll"
                  />
                </th>
              )}
              {columns.map((column, index) => {
                // Two columns may show one field, as the plugin's Job Status shows the index's
                const sorted = Boolean(column.sortable) && query.sortField === column.field;
                return (
                  <th
                    key={`${column.field}-${index}`}
                    className={column.align === 'right' ? 'ismTable__right' : undefined}
                    style={{ width: column.width, textAlign: column.align }}
                    data-test-subj={`tableHeaderCell_${column.field}_${index}`}
                    aria-sort={sorted ? (query.sortDirection === 'asc' ? 'ascending' : 'descending') : undefined}
                  >
                    {column.sortable ? (
                      <button
                        type="button"
                        className={cx('atlTable__sort', sorted && 'atlTable__sort--sorted')}
                        data-test-subj="tableHeaderSortButton"
                        onClick={() =>
                          onQuery({
                            sortField: column.field,
                            sortDirection: sorted && query.sortDirection === 'asc' ? 'desc' : 'asc',
                          })
                        }
                      >
                        <span title={column.name}>{column.name}</span>
                        {sorted && <Icon name={query.sortDirection === 'asc' ? 'sortUp' : 'sortDown'} />}
                      </button>
                    ) : (
                      <span title={column.name}>{column.name}</span>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const id = rowId(row);
              return (
                <tr key={id} className={cx(ids.has(id) && 'ismTable__row--selected')}>
                  {onSelect && (
                    <td className="atlTable__check">
                      <Checkbox
                        checked={ids.has(id)}
                        disabled={selectable ? !selectable(row) : false}
                        onChange={(checked) =>
                          onSelect(
                            checked
                              ? [...(selected ?? []), row]
                              : (selected ?? []).filter((other) => rowId(other) !== id)
                          )
                        }
                        testId={`checkboxSelectRow-${id}`}
                      />
                    </td>
                  )}
                  {columns.map((column, index) => (
                    <td
                      key={`${column.field}-${index}`}
                      style={{ textAlign: column.align }}
                      className={fixed && column.truncate ? 'ismTable__truncate' : undefined}
                    >
                      {column.render(row)}
                    </td>
                  ))}
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={columns.length + (onSelect ? 1 : 0)}>
                  <div className="ismTable__empty">{loading && !emptyWhileLoading ? <Spinner /> : empty}</div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {paged && total > 0 && (
        <Pagination
          page={page}
          pages={pages}
          onPage={(next) => onQuery({ from: next * query.size })}
          pageSize={query.size}
          pageSizes={pageSizes.includes(query.size) ? pageSizes : [...pageSizes, query.size].sort((a, b) => a - b)}
          onPageSize={(size) => onQuery({ size, from: 0 })}
        />
      )}
    </div>
  );
}

function compareValues(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === undefined || a === null) return -1;
  if (b === undefined || b === null) return 1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const left = String(a).toLowerCase();
  const right = String(b).toLowerCase();
  return left < right ? -1 : left > right ? 1 : 0;
}

/** The page of rows a table sorted and paged in the browser shows */
export function pageOf<Row>(
  rows: Row[],
  columns: Array<TableColumn<Row>>,
  query: Pick<ListQuery, 'from' | 'size' | 'sortField' | 'sortDirection'>
): Row[] {
  const column = columns.find((candidate) => candidate.field === query.sortField);
  const value = column?.value ?? ((row: Row) => (row as Record<string, unknown>)[query.sortField]);
  const direction = query.sortDirection === 'asc' ? 1 : -1;
  const sorted = [...rows].sort((a, b) => compareValues(value(a), value(b)) * direction);
  const from = query.from >= sorted.length ? 0 : query.from;
  return sorted.slice(from, from + query.size);
}

// --- Searching and filtering ---------------------------------------------------------------------------

export interface FilterOption {
  value: string;
  label?: string;
}

/** A button that opens a list of values to keep; several may be ticked */
export function FilterButton({
  name,
  options,
  selected,
  onChange,
  empty = 'No options found',
  testId,
}: {
  name: string;
  options: FilterOption[];
  selected: string[];
  onChange: (selected: string[]) => void;
  empty?: string;
  testId?: string;
}) {
  const items: MenuItem[] =
    options.length > 0
      ? options.map((option) => ({
          id: option.value,
          label: option.label ?? option.value,
          selected: selected.includes(option.value),
          testId: `FilterGroupSelectItem-${option.value}`,
          onClick: () =>
            onChange(
              selected.includes(option.value)
                ? selected.filter((value) => value !== option.value)
                : [...selected, option.value]
            ),
        }))
      : [{ id: 'none', label: empty, disabled: true }];
  return (
    <MenuButton
      align="right"
      items={items}
      button={(toggle) => (
        <Button size="s" icon="chevronDown" iconSide="right" onClick={toggle} testId={testId}>
          {name}
          {selected.length > 0 && <span className="ismFilterCount">{selected.length}</span>}
        </Button>
      )}
    />
  );
}

/** The search box of a list, with what stands beside it */
export function SearchRow({
  search,
  onSearch,
  placeholder = 'Search',
  children,
  className,
  autoFocus,
  clearable,
}: {
  search: string;
  onSearch: (text: string) => void;
  placeholder?: string;
  children?: ReactNode;
  /** In the place of the row's own spacing and line under it */
  className?: string;
  /** The box has the focus when the list opens */
  autoFocus?: boolean;
  /** The theme's small round button at the end of a box that holds text, which empties it */
  clearable?: boolean;
}) {
  // What is typed is shown at once and searched for a moment later
  const [text, setText] = useState(search);
  const sent = useRef(search);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (search !== sent.current) {
      sent.current = search;
      setText(search);
    }
  }, [search]);
  useEffect(() => {
    if (text === sent.current) return undefined;
    const timer = window.setTimeout(() => {
      sent.current = text;
      onSearch(text);
    }, 300);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
  return (
    <div className={className ?? 'ismSearchRow'}>
      <div className="atlGrow">
        {/* The theme's search field, with a hold on its box to give it the focus back */}
        <TextField
          ref={field}
          icon="search"
          type="search"
          compact
          className={clearable ? 'ismSearchField' : undefined}
          value={text}
          onChange={setText}
          placeholder={placeholder}
          aria-label={placeholder}
          autoFocus={autoFocus}
          append={
            clearable && text !== '' ? (
              <button
                type="button"
                className="ismSearchField__clear"
                aria-label="Clear input"
                onClick={() => {
                  setText('');
                  field.current?.focus();
                }}
              >
                <Icon name="cross" />
              </button>
            ) : undefined
          }
        />
      </div>
      {children}
    </div>
  );
}

// --- Small things many pages show ------------------------------------------------------------------------

/** A word with its first letter in capitals */
export const capital = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

const HEALTH_TONES: Record<string, Tone> = { green: 'healthy', yellow: 'warning', red: 'critical' };

/** The health of an index: a dot in its colour and its name */
export function IndexHealth({ health, status }: { health?: string; status?: string }) {
  return (
    <span className="ismCapital">
      <Health tone={health ? HEALTH_TONES[health] : undefined}>{capital(health || status || '')}</Health>
    </span>
  );
}

/** A moment as the lists write it: 11/22/26 9:05 am, or a dash */
export function renderTime(time: unknown): string {
  if (!time) return '-';
  const date = new Date(time as number | string);
  return Number.isNaN(date.getTime()) ? '-' : formatDate(date, 'MM/DD/YY h:mm a');
}

/** Names as a list in a dialog */
export function Names({ names, testId }: { names: string[]; testId?: (name: string) => string }) {
  return (
    <ul className="ismNames">
      {names.map((name) => (
        <li key={name} data-test-subj={testId?.(name)}>
          {name}
        </li>
      ))}
    </ul>
  );
}

/** A dialog that changes what it names once its word is typed */
export function TypeToConfirmModal({
  title,
  children,
  word,
  label = title,
  danger,
  onClose,
  onConfirm,
  cancelTestId,
  confirmTestId,
  inputTestId,
}: {
  title: string;
  children: ReactNode;
  /** What must be typed: "delete", "close" */
  word: string;
  label?: ReactNode;
  danger?: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  cancelTestId?: string;
  confirmTestId?: string;
  inputTestId?: string;
}) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="empty" size="s" onClick={onClose} testId={cancelTestId}>
            Cancel
          </Button>
          <Button
            variant={danger ? 'dangerFill' : 'primary'}
            size="s"
            disabled={value !== word}
            loading={busy}
            onClick={confirm}
            testId={confirmTestId}
          >
            {label}
          </Button>
        </>
      }
    >
      <div className="ismDialog">
        {children}
        <p className="atlSubdued">
          To confirm your action, type <b className="ismDialog__word">{word}</b>.
        </p>
        <TextField value={value} onChange={setValue} placeholder={word} testId={inputTestId} aria-label={`Type ${word}`} />
      </div>
    </Modal>
  );
}

/** A dialog with a plain yes and no */
export function ActionModal({
  title,
  children,
  label,
  danger,
  disabled,
  onClose,
  onConfirm,
  cancelTestId,
  confirmTestId,
  titleTestId,
  wide,
}: {
  title: ReactNode;
  children: ReactNode;
  label: string;
  danger?: boolean;
  disabled?: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  cancelTestId?: string;
  confirmTestId?: string;
  titleTestId?: string;
  wide?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const confirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={<span data-test-subj={titleTestId}>{title}</span>}
      onClose={onClose}
      wide={wide}
      footer={
        <>
          <Button variant="empty" size="s" onClick={onClose} testId={cancelTestId}>
            Cancel
          </Button>
          <Button
            variant={danger ? 'dangerFill' : 'primary'}
            size="s"
            disabled={disabled}
            loading={busy}
            onClick={confirm}
            testId={confirmTestId}
          >
            {label}
          </Button>
        </>
      }
    >
      <div className="ismDialog">{children}</div>
    </Modal>
  );
}

/** One name and its value in an overview */
export function Detail({ name, children, testId }: { name: string; children: ReactNode; testId?: string }) {
  return (
    <div className="ismDetail" data-test-subj={testId}>
      <dt>{name}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function Details({ children, columns = 4 }: { children: ReactNode; columns?: number }) {
  return (
    <dl className="ismDetails" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {children}
    </dl>
  );
}

// --- Pages that take the whole width -------------------------------------------------------------------------

/** The title of a page that creates, edits or shows one thing, with what can be done there */
export function PageTitle({ title, actions, children }: { title: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <header className="ismPageHeader">
      <div className="atlGrow">
        <h1 className="ismPageTitle">{title}</h1>
        {children && <p className="ismPanel__description">{children}</p>}
      </div>
      {actions && <div className="ismPanel__actions">{actions}</div>}
    </header>
  );
}

/** The buttons at the end of a form */
export function BottomBar({ children }: { children: ReactNode }) {
  return <div className="ismBottomBar">{children}</div>;
}

/** What went wrong when a form was sent */
export function SubmitError({ error }: { error?: string }) {
  if (!error) return null;
  return (
    <CallOut tone="critical" icon="warning" title="Sorry, there was an error">
      <p>{error}</p>
    </CallOut>
  );
}

// --- Dialogs many pages open -----------------------------------------------------------------------------------

/** Shows something as JSON */
export function JSONModal({
  title,
  json,
  onClose,
  indent = 4,
  testId,
}: {
  title: string;
  json: unknown;
  onClose: () => void;
  indent?: number;
  testId?: string;
}) {
  const text = JSON.stringify(json, null, indent);
  return (
    <Modal
      title={title}
      onClose={onClose}
      testId={testId}
      wide
      footer={
        <>
          <Button variant="empty" size="s" icon="copyClipboard" onClick={() => copyText(text)}>
            Copy
          </Button>
          <Button variant="empty" size="s" onClick={onClose} testId="jsonModalCloseButton">
            Close
          </Button>
        </>
      }
    >
      <CodeBlock style={{ maxHeight: '60vh', overflow: 'auto' }}>{text}</CodeBlock>
    </Modal>
  );
}

/** Asks before something is done that cannot be undone */
export function ConfirmationModal({
  title,
  bodyMessage,
  actionMessage,
  danger,
  onClose,
  onAction,
}: {
  title: string;
  bodyMessage: ReactNode;
  actionMessage: string;
  danger?: boolean;
  onClose: () => void;
  onAction: () => void | Promise<void>;
}) {
  return (
    <ActionModal
      title={title}
      label={actionMessage}
      danger={danger}
      onClose={onClose}
      onConfirm={async () => {
        onClose();
        await onAction();
      }}
      cancelTestId="confirmationModalCloseButton"
      confirmTestId="confirmationModalActionButton"
    >
      <p>{bodyMessage}</p>
    </ActionModal>
  );
}

/** The dialog that deletes one thing once "delete" is typed */
export function DeleteModal({
  title,
  children,
  label = title,
  help = 'To confirm deletion, type "delete".',
  onClose,
  onDelete,
}: {
  title: string;
  children: ReactNode;
  label?: string;
  help?: string;
  onClose: () => void;
  onDelete: () => void | Promise<void>;
}) {
  const [text, setText] = useState('');
  return (
    <ActionModal title={title} label={label} danger disabled={text !== 'delete'} onClose={onClose} onConfirm={onDelete}>
      <p>{children}</p>
      <FormRow help={help} full>
        <TextField value={text} onChange={setText} placeholder="delete" testId="deleteTextField" aria-label="delete" />
      </FormRow>
    </ActionModal>
  );
}

/** A table of a few rows that are all here: sorted and paged in the browser, its state kept by itself */
export function LocalTable<Row>({
  columns,
  rows,
  rowId,
  sortField,
  sortDirection = 'asc',
  pageSize = 10,
  pageSizes = [10, 20, 50],
  paged = true,
  empty,
  selected,
  onSelect,
  selectable,
  fixed,
  caption,
}: {
  columns: Array<TableColumn<Row>>;
  rows: Row[];
  rowId: (row: Row, index: number) => string;
  sortField?: string;
  sortDirection?: 'asc' | 'desc';
  pageSize?: number;
  pageSizes?: number[];
  paged?: boolean;
  empty?: ReactNode;
  selected?: Row[];
  onSelect?: (rows: Row[]) => void;
  selectable?: (row: Row) => boolean;
  fixed?: boolean;
  caption?: boolean;
}) {
  const [query, setQuery] = useState<Pick<ListQuery, 'from' | 'size' | 'sortField' | 'sortDirection'>>({
    from: 0,
    size: paged ? pageSize : Number.MAX_SAFE_INTEGER,
    sortField: sortField ?? '',
    sortDirection,
  });
  const ids = useMemo(() => new Map(rows.map((row, index) => [row, rowId(row, index)])), [rows, rowId]);
  const page = query.sortField
    ? pageOf(rows, columns, query)
    : rows.slice(query.from >= rows.length ? 0 : query.from, (query.from >= rows.length ? 0 : query.from) + query.size);
  return (
    <Table
      columns={columns}
      rows={page}
      total={rows.length}
      query={query}
      onQuery={(changes) => setQuery((before) => ({ ...before, ...changes }))}
      rowId={(row) => ids.get(row) ?? ''}
      empty={empty}
      pageSizes={pageSizes}
      paged={paged}
      selected={selected}
      onSelect={onSelect}
      selectable={selectable}
      fixed={fixed}
      caption={caption}
    />
  );
}

/** A field under its name and what the name means; `across` puts the field beside them */
export function Labeled({
  title,
  help,
  optional,
  error,
  across,
  testId,
  children,
}: {
  title: ReactNode;
  help?: ReactNode;
  optional?: boolean;
  error?: ReactNode;
  across?: boolean;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <div className={cx('ismLabeled', across && 'ismLabeled--across')} data-test-subj={testId}>
      <div className="ismLabeled__head">
        <div className="ismLabeled__title">
          {title}
          {optional && <i> – optional</i>}
        </div>
        {help && <div className="ismLabeled__help">{help}</div>}
      </div>
      <div className="ismLabeled__body">
        <div className="ismLabeled__field">{children}</div>
        {error && <div className="ismLabeled__error">{error}</div>}
      </div>
    </div>
  );
}

/** The bar that says a form has changes that are not saved yet, with the buttons that drop or save them */
export function UnsavedBar({
  count,
  errors = 0,
  busy,
  onCancel,
  onSave,
  testId,
  cancelTestId,
  extra,
}: {
  count: number;
  errors?: number;
  busy?: boolean;
  onCancel: () => void;
  onSave: () => void;
  testId?: string;
  cancelTestId?: string;
  /** What stands between the two buttons */
  extra?: ReactNode;
}) {
  return (
    <div className="ismUnsaved">
      {errors > 0 ? (
        <span className="ismUnsaved__text ismUnsaved__text--danger">{errors} form errors.</span>
      ) : (
        <span className="ismUnsaved__text">{count} unsaved changes.</span>
      )}
      <Button variant="ghost" size="s" icon="cross" onClick={onCancel} testId={cancelTestId}>
        Cancel
      </Button>
      {extra}
      <Button variant="primary" size="s" icon="check" loading={busy} disabled={busy} onClick={onSave} testId={testId}>
        Save
      </Button>
    </div>
  );
}

/** An editor for JSON, coloured as the others are */
export function JsonEditor({
  value,
  onChange,
  height = 300,
  readOnly,
  testId,
}: {
  value: string;
  onChange?: (value: string) => void;
  height?: number | string;
  readOnly?: boolean;
  testId?: string;
}) {
  return (
    <CodeEditor
      value={value}
      onChange={onChange}
      readOnly={readOnly}
      height={height}
      fontSize={14}
      tokenize={tokenizeJson}
      ariaLabel="Code Editor"
      testId={testId}
    />
  );
}

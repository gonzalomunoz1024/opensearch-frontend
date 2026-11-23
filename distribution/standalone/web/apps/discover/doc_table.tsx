/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The documents a search found, one per row, as OpenSearch Dashboards' document table draws them:
 * the time, then the chosen fields or the whole source. The columns take the width their first
 * rows ask for and then keep it. On Discover more rows are drawn as the end of the table comes
 * into view; a saved search on a dashboard shows them in pages of 50 under a pager.
 */

import { Fragment, memo, useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { FieldValue } from '../../components/formatted';
import { Icon, type IconName } from '../../components/icon';
import { Tooltip } from '../../components/overlay';
import { flattenHit, type RawHit } from '../../lib/docs';
import type { Field, IndexPattern } from '../../lib/types';
import { services } from '../../services';
import {
  SCROLL_LOOKAHEAD,
  SCROLL_STEP,
  PAGE_SIZE,
  pageCountOf,
  pagerArrows,
  pagerItems,
  pagerSummary,
  rowsOfPage,
} from './pager';

export type SortPair = [field: string, direction: 'asc' | 'desc'];

export interface DocTableProps {
  rows: RawHit[];
  indexPattern: IndexPattern;
  columns: string[];
  sort: SortPair[];
  onSort?: (sort: SortPair[]) => void;
  onRemoveColumn?: (fieldName: string) => void;
  onMoveColumn?: (fieldName: string, by: number) => void;
  onFilter?: (fieldName: string, value: unknown, negate: boolean) => void;
  /**
   * What a row shows under it once it is opened, given the names of the columns drawn (the time
   * field's first), which the original's opened document is handed
   */
  details?: (hit: RawHit, columns: string[]) => ReactNode;
  /** Pages of 50 rows with a pager above and below, as a saved search on a dashboard */
  paged?: boolean;
  /** How many documents matched, which the pager counts */
  hits?: number;
  /** The "Back to top." of the note under the last row */
  onBackToTop?: () => void;
  /** The row drawn highlighted, by its index and id: the anchor among its neighbours */
  highlightRow?: string;
}

const META_FIELDS = ['_source', '_id', '_type', '_index', '_score'];
const SORTABLE_TYPES = new Set(['string', 'number', 'date', 'ip', 'boolean']);
const FILTERABLE_TYPES = new Set(['string', 'number', 'date', 'ip', 'boolean', 'histogram']);

/** As an index pattern's field says: what a column can be sorted on */
export function isSortable(field: Field | undefined, name: string): boolean {
  return name === '_score' || Boolean(field && field.aggregatable && SORTABLE_TYPES.has(field.type));
}

/**
 * What a cell can be filtered on, as the original's field says: the id, a scripted field (its
 * filter carries the script), or a searchable field of a kind that filters
 */
export function isFilterable(field: Field | undefined, name: string): boolean {
  if (name === '_id') return true;
  return Boolean(field && (field.scripted || (field.searchable && FILTERABLE_TYPES.has(field.type))));
}

/**
 * Whether a cell of the table offers its filter buttons, as the original's row asks: unless its
 * field cannot be filtered on. A missing value has them too (they filter on whether the field
 * exists), and so has a column that is no field of the pattern
 */
export function cellFilterable(field: Field | undefined, name: string): boolean {
  return field === undefined || isFilterable(field, name);
}

/**
 * The columns the table draws, as the original's table adjusts them: the whole source only when
 * no field is chosen, beside the time field when it is the only one chosen
 */
export function tableColumns(columns: string[], timeFieldName: string | undefined): string[] {
  let shown = columns.length > 1 && columns.includes('_source') ? columns.filter((name) => name !== '_source') : columns;
  if (shown.length === 0) shown = ['_source'];
  if (shown.length === 1 && timeFieldName && shown[0] === timeFieldName) shown = [...shown, '_source'];
  return shown;
}

/**
 * The columns after a field's column button is pressed, as the original's addColumn and
 * removeColumn leave them: a chosen field is taken out, the whole source back when none is left;
 * any other is added at the end, in place of the whole source
 */
export function toggledColumns(columns: string[], name: string): string[] {
  const without = columns.filter((column) => column !== name);
  if (without.length !== columns.length) return without.length ? without : ['_source'];
  return [...columns.filter((column) => column !== '_source'), name];
}

/**
 * The columns Discover's table shows, as the original's filterColumns: with the setting
 * discover:modifyColumnsOnSwitch on, the chosen and the default columns that the index pattern or
 * the documents have (so a column of another pattern is dropped), the whole source when none is
 * left; with it off, the chosen columns as they are
 */
export function filterColumns(columns: string[], names: ReadonlySet<string>, defaultColumns: string[], modify: boolean): string[] {
  if (!modify) return columns.length > 0 ? columns : ['_source'];
  const kept = [...new Set([...columns, ...defaultColumns])].filter((name) => names.has(name));
  const built = kept.length > 1 && kept.includes('_source') ? kept.filter((name) => name !== '_source') : kept;
  return built.length > 0 ? built : ['_source'];
}

/** A sort when none is chosen: the time field's, newest first by the setting, or the score's */
export function defaultSort(indexPattern: IndexPattern): SortPair[] {
  const order = services.uiSettings.get<string>('discover:sort:defaultOrder', 'desc') === 'asc' ? 'asc' : 'desc';
  const timeField = indexPattern.timeFieldName;
  const field = timeField ? indexPattern.fields.find((candidate) => candidate.name === timeField) : undefined;
  return timeField && isSortable(field, timeField) ? [[timeField, order]] : [['_score', order]];
}

/** The next sort when a column's sort button is pressed: unsorted, ascending, descending, unsorted */
export function nextSort(sort: SortPair[], name: string): SortPair[] {
  const others = sort.filter(([field]) => field !== name);
  const current = sort.find(([field]) => field === name)?.[1];
  if (current === undefined) return [...others, [name, 'asc']];
  if (current === 'asc') return [...others, [name, 'desc']];
  // The only sort left goes back to ascending instead of being dropped
  if (others.length === 0) return [[name, 'asc']];
  return others;
}

function sortLabel(sort: SortPair[], name: string): string {
  const others = sort.filter(([field]) => field !== name);
  const current = sort.find(([field]) => field === name)?.[1];
  if (current === undefined || (current === 'desc' && others.length === 0)) return `Sort ${name} ascending`;
  if (current === 'asc') return `Sort ${name} descending`;
  return `Stop sorting on ${name}`;
}

/** "geoip.city_name" as "g.city_name", when the setting shortens dotted names */
export function shortDots(name: string): string {
  return name.replace(/(.).+?\./g, '$1.');
}

/** As lodash's isPlainObject, which the original asks of a value: an object of {} or of no prototype */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * A document's fields in the order the original's source cell lists them, as its index pattern
 * flattens a hit: the source's own as the document holds them (a list of objects, then each field
 * of its objects), the meta fields of the setting, then the fields the search returned beside the
 * source. A field the mapping knows keeps an object whole.
 */
export function sourceEntries(hit: RawHit, indexPattern: IndexPattern, metaFields: string[]): Array<[string, unknown]> {
  const known = new Map(indexPattern.fields.map((field) => [field.name, field]));
  const flat = new Map<string, unknown>();
  const walk = (object: Record<string, unknown>, prefix: string) => {
    for (const [own, value] of Object.entries(object)) {
      const name = prefix ? `${prefix}.${own}` : own;
      const field = known.get(name);
      if (Array.isArray(value) && isPlainObject(value[0]) && field?.type !== 'nested') {
        flat.set(name, value);
        for (const item of value) if (isPlainObject(item)) walk(item, name);
        continue;
      }
      if ((field && field.type !== 'conflict') || !isPlainObject(value)) {
        const before = flat.get(name);
        // The original tests the value it holds, so that a 0 or an empty string is written over;
        // here a value is added to the ones before it whatever it is
        if (!flat.has(name)) flat.set(name, Array.isArray(value) ? [...value] : value);
        else if (Array.isArray(before)) before.push(value);
        else flat.set(name, [before, value]);
        continue;
      }
      walk(value, name);
    }
  };
  walk(hit._source ?? {}, '');
  const raw: Record<string, unknown> = { ...hit };
  for (const name of metaFields) if (name !== '_source') flat.set(name, raw[name]);
  for (const [name, values] of Object.entries(hit.fields ?? {})) {
    if (name.startsWith('_') && !metaFields.includes(name)) continue;
    flat.set(name, Array.isArray(values) && values.length <= 1 ? values[0] : values);
  }
  return [...flat];
}

/**
 * A value as the original's formats write it in a cell: " - " when there is none; anything else,
 * an empty string too, as the field's format writes it (nothing for text, 0.00 for a duration in
 * minutes, the link of a URL template)
 */
export function CellValue({ indexPattern, name, value, hit }: { indexPattern: IndexPattern; name: string; value: unknown; hit: RawHit }) {
  if (value === undefined || value === null) return <>{' - '}</>;
  return <FieldValue indexPattern={indexPattern} fieldName={name} value={value} hit={hit} />;
}

const SourceCell = memo(function SourceCell({ hit, indexPattern }: { hit: RawHit; indexPattern: IndexPattern }) {
  const metaFields = services.uiSettings.get<string[]>('metaFields', META_FIELDS);
  const shorten = services.uiSettings.get('shortDots:enable', false);
  const entries = sourceEntries(hit, indexPattern, metaFields);
  return (
    <dl className="dscSource">
      {entries.map(([name, value], index) => (
        <Fragment key={name}>
          <dt data-test-subj="dscDataGridTableCellListFieldTitle">{shorten ? shortDots(name) : name}:</dt>
          <dd>
            <CellValue indexPattern={indexPattern} name={name} value={value} hit={hit} />
          </dd>
          {index !== entries.length - 1 && ' '}
        </Fragment>
      ))}
    </dl>
  );
});

/** The height the setting lets a cell take before it is cut, which the cells read: 0 lets them grow */
export function cellHeightStyle(maxHeight: number): CSSProperties {
  return { '--dsc-cell-max-height': maxHeight > 0 ? `${maxHeight}px` : 'none' } as CSSProperties;
}

/** A small button of the table: the arrow that opens a row, a header's, a cell's filter */
function TableButton({
  icon,
  label,
  className,
  testId,
  onClick,
  tooltip,
}: {
  icon: IconName;
  label: string;
  className: string;
  testId: string;
  onClick: () => void;
  tooltip?: string;
}) {
  const button = (
    <button type="button" className={className} aria-label={label} data-test-subj={testId} onClick={onClick}>
      <Icon name={icon} />
    </button>
  );
  return tooltip ? <Tooltip content={tooltip}>{button}</Tooltip> : button;
}

interface Column {
  name: string;
  displayName: string;
  sortable: boolean;
  removable: boolean;
  /** Whether the column can move to the left, to the right */
  left: boolean;
  right: boolean;
}

function HeaderCell({
  column,
  sort,
  onSort,
  onRemoveColumn,
  onMoveColumn,
}: {
  column: Column;
  sort: SortPair[];
  onSort?: DocTableProps['onSort'];
  onRemoveColumn?: DocTableProps['onRemoveColumn'];
  onMoveColumn?: DocTableProps['onMoveColumn'];
}) {
  const { name } = column;
  const direction = sort.find(([field]) => field === name)?.[1];
  const sortTip = sortLabel(sort, name);
  return (
    <th
      className="dscTable__headerField"
      role="columnheader"
      aria-label={`Discover table column: ${name}`}
      data-test-subj="docTableHeaderField"
    >
      <span data-test-subj={`docTableHeader-${name}`}>
        {column.displayName}
        {column.sortable && onSort && (
          <TableButton
            icon={direction === 'asc' ? 'sortUp' : direction === 'desc' ? 'sortDown' : 'sortable'}
            label={sortTip}
            tooltip={sortTip}
            className="dscTable__headerButton"
            testId={`docTableHeaderFieldSort_${name}`}
            onClick={() => onSort(nextSort(sort, name))}
          />
        )}
        {column.removable && onRemoveColumn && (
          <TableButton
            icon="cross"
            label={`Remove ${name} column`}
            tooltip="Remove Column"
            className="dscTable__headerButton"
            testId={`docTableRemoveHeader-${name}`}
            onClick={() => onRemoveColumn(name)}
          />
        )}
        {column.left && onMoveColumn && (
          <TableButton
            icon="arrowLeft"
            label={`Move ${name} column to the left`}
            tooltip="Move column to the left"
            className="dscTable__headerButton"
            testId={`docTableMoveLeftHeader-${name}`}
            onClick={() => onMoveColumn(name, -1)}
          />
        )}
        {column.right && onMoveColumn && (
          <TableButton
            icon="arrowRight"
            label={`Move ${name} column to the right`}
            tooltip="Move column to the right"
            className="dscTable__headerButton"
            testId={`docTableMoveRightHeader-${name}`}
            onClick={() => onMoveColumn(name, 1)}
          />
        )}
      </span>
    </th>
  );
}

const Row = memo(function Row({
  hit,
  indexPattern,
  columns,
  onFilter,
  rowKey,
  open,
  onToggle,
  details,
  highlight = false,
}: {
  hit: RawHit;
  indexPattern: IndexPattern;
  columns: string[];
  onFilter?: DocTableProps['onFilter'];
  rowKey: string;
  open: boolean;
  onToggle: (key: string) => void;
  details?: DocTableProps['details'];
  highlight?: boolean;
}) {
  const flat = flattenHit(hit, indexPattern);
  const cell = (name: string) => {
    const field = indexPattern.fields.find((candidate) => candidate.name === name);
    if (name === '_source' || field?.type === '_source') {
      return (
        <td key={name} className="dscTable__cell dscTable__cell--source" data-test-subj="docTableField">
          <div className="dscTable__truncate">
            <SourceCell hit={hit} indexPattern={indexPattern} />
          </div>
        </td>
      );
    }
    const value = flat[name];
    const isTime = name === indexPattern.timeFieldName;
    const content = (
      <>
        <span className="dscTable__value" data-test-subj="osdDocTableCellDataField">
          <CellValue indexPattern={indexPattern} name={name} value={value} hit={hit} />
        </span>
        {onFilter && cellFilterable(field, name) && (
          <span className="dscTable__filter" data-test-subj="osdDocTableCellFilter">
            <TableButton
              icon="zoomIn"
              label="Filter for value"
              tooltip="Filter for value"
              className="dscTable__filterButton"
              testId="filterForValue"
              onClick={() => onFilter(name, value, false)}
            />
            <TableButton
              icon="zoomOut"
              label="Filter out value"
              tooltip="Filter out value"
              className="dscTable__filterButton"
              testId="filterOutValue"
              onClick={() => onFilter(name, value, true)}
            />
          </span>
        )}
      </>
    );
    return isTime ? (
      <td key={name} className="dscTable__cell dscTable__cell--time" data-test-subj="docTableField">
        {content}
      </td>
    ) : (
      <td key={name} className="dscTable__cell" data-test-subj="docTableField">
        <div className="dscTable__truncate">{content}</div>
      </td>
    );
  };
  return (
    <>
      <tr className={highlight ? 'dscTable__row--highlight' : undefined} data-test-subj="docTableRow">
        <td className="dscTable__toggle" data-test-subj="docTableExpandToggleColumn">
          <button
            type="button"
            className="dscTable__toggleButton"
            aria-label="Toggle row details"
            aria-expanded={open}
            onClick={() => onToggle(rowKey)}
            data-test-subj="docTableExpandToggleColumn"
          >
            <Icon name={open ? 'chevronDown' : 'chevronRight'} />
          </button>
        </td>
        {columns.map(cell)}
      </tr>
      {open && (
        <tr>
          <td className="dscTable__details" colSpan={columns.length + 1} data-test-subj="osdDocTableDetailsParent">
            {details?.(hit, columns)}
          </td>
        </tr>
      )}
    </>
  );
});

/** The pager over and under a saved search's table on a dashboard */
export function Pager({
  page,
  pageCount,
  startRow,
  endRow,
  hits,
  sampleSize,
  onPage,
}: {
  page: number;
  pageCount: number;
  startRow: number;
  endRow: number;
  hits?: number;
  sampleSize: number;
  onPage: (page: number) => void;
}) {
  const summary = pagerSummary(startRow, endRow, hits, sampleSize);
  const arrows = pagerArrows(page, pageCount);
  return (
    <div className="dscPager" data-test-subj="osdDocTablePagination">
      {summary.limited && (
        <div className="dscPager__limit">Limited to {sampleSize} results. Refine your search.</div>
      )}
      <div className="dscPager__count">{summary.text}</div>
      <nav className="dscPager__nav">
        <button
          type="button"
          className="dscPager__arrow"
          aria-label={arrows.previous.label}
          disabled={arrows.previous.disabled}
          onClick={() => onPage(page - 1)}
          data-test-subj="pagination-button-previous"
        >
          <Icon name="chevronLeft" />
        </button>
        <ul className="dscPager__list">
          {pagerItems(page, pageCount).map((item) =>
            item.kind === 'gap' ? (
              <li key={item.label} className="dscPager__gap" aria-label={item.label}>
                …
              </li>
            ) : (
              <li key={item.page}>
                <button
                  type="button"
                  className="dscPager__page"
                  aria-label={`Page ${item.page + 1} of ${pageCount}`}
                  aria-current={item.page === page ? true : undefined}
                  disabled={item.page === page}
                  onClick={() => onPage(item.page)}
                  data-test-subj={`pagination-button-${item.page}`}
                >
                  {item.page + 1}
                </button>
              </li>
            )
          )}
        </ul>
        <button
          type="button"
          className="dscPager__arrow"
          aria-label={arrows.next.label}
          disabled={arrows.next.disabled}
          // A table with no rows has no next page to go to, though its arrow is not greyed
          onClick={() => page + 1 < pageCount && onPage(page + 1)}
          data-test-subj="pagination-button-next"
        >
          <Icon name="chevronRight" />
        </button>
      </nav>
    </div>
  );
}

export function DocTable({
  rows,
  indexPattern,
  columns: chosen,
  sort,
  onSort,
  onRemoveColumn,
  onMoveColumn,
  onFilter,
  details,
  paged = false,
  hits,
  onBackToTop,
  highlightRow,
}: DocTableProps) {
  const sampleSize = services.uiSettings.get<number>('discover:sampleSize', 500);
  const hideTime = services.uiSettings.get('doc_table:hideTimeColumn', false);
  const shorten = services.uiSettings.get('shortDots:enable', false);
  const cellHeight = services.uiSettings.get<number>('truncate:maxHeight', 115);
  const timeField = indexPattern.timeFieldName;
  const columns = tableColumns(chosen, timeField);

  const shown: Column[] = columns.map((name, index) => ({
    name,
    displayName: shorten ? shortDots(name) : name,
    sortable: isSortable(
      indexPattern.fields.find((field) => field.name === name),
      name
    ),
    removable: name !== '_source' || columns.length > 1,
    left: index > 0,
    right: index < columns.length - 1,
  }));
  if (timeField && !hideTime && !columns.includes(timeField)) {
    shown.unshift({ name: timeField, displayName: 'Time', sortable: true, removable: false, left: false, right: false });
  }
  const names = shown.map((column) => column.name);
  const headerSort = sort.length ? sort : defaultSort(indexPattern);

  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const toggle = useCallback((key: string) => {
    setOpened((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }, []);

  // --- Discover: ten rows at once, more while the page keeps up, more again at the end ---
  const [rendered, setRendered] = useState(SCROLL_STEP);
  const [desired, setDesired] = useState(() => Math.min(rows.length, SCROLL_LOOKAHEAD));
  const lastFrame = useRef(0);
  useEffect(() => {
    if (paged) return undefined;
    let frame = 0;
    const load = (time: number) => {
      if (rendered < desired) {
        // Only while frames come faster than 30 a second
        if (time - lastFrame.current < 33) setRendered((count) => count + SCROLL_STEP);
        lastFrame.current = time;
        frame = requestAnimationFrame(load);
      }
    };
    frame = requestAnimationFrame(load);
    return () => cancelAnimationFrame(frame);
  }, [paged, rendered, desired]);

  const [sentinel, setSentinel] = useState<HTMLDivElement | null>(null);
  const sentinelRef = useCallback((node: HTMLDivElement | null) => {
    if (node) setSentinel(node);
  }, []);
  useEffect(() => {
    if (!sentinel || paged) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setRendered((count) => count + SCROLL_STEP);
          setDesired((count) => count + SCROLL_LOOKAHEAD);
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [sentinel, paged]);

  // --- A dashboard: pages of 50 ---
  const [page, setPage] = useState(0);
  const pageCount = pageCountOf(rows.length);
  const current = Math.min(page, Math.max(0, pageCount - 1));
  const { startRow, endRow } = rowsOfPage(current, rows.length, PAGE_SIZE);
  const visible = paged ? rows.slice(startRow, endRow) : rows.slice(0, rendered);

  // --- Each column as wide as its first rows ask, then fixed, so that rows added later keep it ---
  const table = useRef<HTMLTableElement>(null);
  const [containerWidth, setContainerWidth] = useState<number>();
  useEffect(() => {
    const container = table.current?.parentElement;
    if (!container) return undefined;
    setContainerWidth(Math.round(container.getBoundingClientRect().width));
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setContainerWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);
  const firstIndex = rows[0]?._index;
  const firstTime = timeField ? (rows[0]?._source as Record<string, unknown> | undefined)?.[timeField] : undefined;
  const columnsKey = names.join('\n');
  useEffect(() => {
    const element = table.current;
    if (!element) return undefined;
    element.style.tableLayout = 'auto';
    const heads = [...element.querySelectorAll<HTMLTableCellElement>('thead > tr > th:not(:first-child)')];
    for (const head of heads) head.style.width = 'unset';
    const frame = requestAnimationFrame(() => {
      for (const head of heads) head.style.width = `${head.getBoundingClientRect().width}px`;
      element.style.tableLayout = 'fixed';
    });
    return () => cancelAnimationFrame(frame);
    // The original measures again when the columns, the data or the room change
  }, [columnsKey, rows, firstIndex, firstTime, containerWidth]);

  const pager = paged ? (
    <Pager
      page={current}
      pageCount={pageCount}
      startRow={startRow}
      endRow={endRow}
      hits={hits}
      sampleSize={sampleSize}
      onPage={setPage}
    />
  ) : null;

  return (
    <div className="dscTable" data-test-subj="discoverTable">
      {pager}
      <table ref={table} className="dscTable__table" style={cellHeightStyle(cellHeight)} data-test-subj="docTable">
        <thead>
          <tr className="dscTable__header" data-test-subj="docTableHeader">
            <th style={{ width: 28 }} />
            {shown.map((column) => (
              <HeaderCell
                key={column.name}
                column={column}
                sort={headerSort}
                onSort={onSort}
                onRemoveColumn={onRemoveColumn}
                onMoveColumn={onMoveColumn}
              />
            ))}
          </tr>
        </thead>
        <tbody>
          {visible.map((hit) => {
            const key = `${hit._index}/${hit._id}`;
            return (
              <Row
                key={key}
                rowKey={key}
                hit={hit}
                indexPattern={indexPattern}
                columns={names}
                onFilter={onFilter}
                open={opened.has(key)}
                onToggle={toggle}
                details={details}
                highlight={key === highlightRow}
              />
            );
          })}
        </tbody>
      </table>
      {!paged && rendered < rows.length && (
        <div ref={sentinelRef}>
          <div
            className="dscTable__progress"
            style={{ marginBottom: rows.length !== sampleSize ? 5 : 0 }}
            data-test-subj="discoverRenderedRowsProgress"
          />
        </div>
      )}
      {!paged && rows.length === sampleSize && (
        <div className="dscTable__footer" data-test-subj="discoverDocTableFooter">
          These are the first {sampleSize} documents matching your search, refine your search to see others.
          <button type="button" className="dscTable__backToTop" onClick={onBackToTop}>
            Back to top.
          </button>
        </div>
      )}
      {pager}
    </div>
  );
}

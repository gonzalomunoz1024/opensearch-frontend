/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The grid in which Inspect's Vega view lists a data set or the signals, drawn and run as the
 * original's (OpenSearch Dashboards' InspectorDataGrid on the component library's data grid): a
 * toolbar that shows, hides and orders the columns, picks the density and sorts by fields; header
 * cells that hide, sort and move their column, and whose edge makes it wider or narrower; cells that
 * open their whole value; and pages of 15, 25 or 50 rows once there are 15 rows.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { cx } from '../../components/basic';
import { Icon, type IconName } from '../../components/icon';
import { Popover, copyText } from '../../components/overlay';
import type { PopoverSide } from '../../components/popover_place';
import { Pagination } from '../../components/table';

export type GridRow = Record<string, string | undefined>;

export interface GridColumn {
  id: string;
  /** How its values are compared and named in the menus: JSON (the data sets, a signal's value) or text */
  schema?: 'json' | 'string';
  initialWidth?: number;
}

export interface GridSort {
  id: string;
  direction: 'asc' | 'desc';
}

export type GridDensity = 'expanded' | 'normal' | 'compact';

/** The narrowest a column without a width is drawn, as the original's grid */
export const MINIMUM_COLUMN_WIDTH = 100;
/** The narrowest its edge makes a column */
const MINIMUM_RESIZED_WIDTH = 40;
const PAGE_SIZES = [15, 25, 50];
// How far inside the window a popover stays, as the original's
const WINDOW_BUFFER = 16;

/** Where a header cell's menu and a cell's value hang: centred under their button, this far below it */
const hangUnder = (gap: number) => (anchor: DOMRect, panel: { width: number; height: number }) => ({
  top: anchor.bottom + gap,
  left: Math.max(
    WINDOW_BUFFER,
    Math.min(anchor.left + anchor.width / 2 - panel.width / 2, window.innerWidth - WINDOW_BUFFER - panel.width)
  ),
  side: 'bottom' as PopoverSide,
});
const UNDER_HEADER = hangUnder(15);
const UNDER_CELL = hangUnder(0);

/**
 * The width of each shown column, as the original's grid gives it: the one set (or made by
 * dragging), else an equal share of what the others leave of the grid, 100 pixels at least
 */
export function columnWidths(
  columns: GridColumn[],
  resized: Record<string, number>,
  gridWidth: number
): Record<string, number> {
  const set = (column: GridColumn) => resized[column.id] ?? column.initialWidth;
  const claimed = columns.reduce((sum, column) => sum + (set(column) ?? 0), 0);
  const unsized = columns.filter((column) => set(column) === undefined).length;
  const share = unsized === 0 ? MINIMUM_COLUMN_WIDTH : Math.max((gridWidth - claimed) / unsized, MINIMUM_COLUMN_WIDTH);
  return Object.fromEntries(columns.map((column) => [column.id, set(column) ?? share]));
}

// One value before another, as JavaScript orders two texts; a missing one is neither
const before = (a: string | undefined, b: string | undefined) => a !== undefined && b !== undefined && a < b;

/** The rows sorted by each field in turn, its values compared as text, as the original sorts them */
export function sortedRows(rows: GridRow[], sorting: GridSort[]): GridRow[] {
  return rows.slice().sort((a, b) => {
    for (const { id, direction } of sorting) {
      if (before(a[id], b[id])) return direction === 'asc' ? -1 : 1;
      if (before(b[id], a[id])) return direction === 'asc' ? 1 : -1;
    }
    return 0;
  });
}

/** The shown columns with one of them moved a place to the left (-1) or the right (1) */
export function movedColumn(visible: string[], id: string, step: -1 | 1): string[] {
  const index = visible.indexOf(id);
  const target = index + step;
  if (index < 0 || target < 0 || target >= visible.length) return visible;
  const next = visible.slice();
  next.splice(index, 1);
  next.splice(target, 0, id);
  return next;
}

/** The sort with a column sorted one way: in its place when it is sorted already, else last */
export function sortedBy(sorting: GridSort[], id: string, direction: 'asc' | 'desc'): GridSort[] {
  return sorting.some((sort) => sort.id === id)
    ? sorting.map((sort) => (sort.id === id ? { id, direction } : sort))
    : [...sorting, { id, direction }];
}

/** What the columns button says: how many columns are hidden, once one is */
export function columnsButtonText(hidden: number): string {
  if (hidden === 1) return '1 column hidden';
  return hidden > 1 ? `${hidden} columns hidden` : 'Columns';
}

/** What the sort button says: how many fields sort the grid, once one does */
export function sortButtonText(sorted: number): string {
  if (sorted === 1) return '1 field sorted';
  return sorted > 1 ? `${sorted} fields sorted` : 'Sort fields';
}

const sortNames = (schema: GridColumn['schema']) =>
  schema === 'string' ? { asc: 'A-Z', desc: 'Z-A' } : { asc: 'Small-Large', desc: 'Large-Small' };

export interface JsonToken {
  text: string;
  /** How the library's code block colours it; plain text has none */
  kind?: 'punctuation' | 'string' | 'number' | 'keyword';
}

// The library's JSON grammar, in its order: a name (a string before a colon, drawn plain), a
// string, a number, true, false or null, and the punctuation; anything else is plain
const JSON_TOKEN =
  /("(?:\\.|[^\\"\r\n])*")(?=\s*:)|("(?:\\.|[^\\"\r\n])*")|(-?\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b)|(\b(?:true|false|null)\b)|([{}[\],])/gi;

/** A value as the original's cell popover colours it: as JSON, whatever it is */
export function jsonTokens(text: string): JsonToken[] {
  const tokens: JsonToken[] = [];
  let plain = '';
  let at = 0;
  for (const match of text.matchAll(JSON_TOKEN)) {
    const [whole, name, string, number, keyword] = match;
    plain += text.slice(at, match.index);
    at = (match.index ?? 0) + whole.length;
    if (name !== undefined) {
      plain += whole;
      continue;
    }
    if (plain) tokens.push({ text: plain });
    plain = '';
    const kind = string !== undefined ? 'string' : number !== undefined ? 'number' : keyword !== undefined ? 'keyword' : 'punctuation';
    tokens.push({ text: whole, kind });
  }
  plain += text.slice(at);
  if (plain) tokens.push({ text: plain });
  return tokens;
}

/** An item an element moves into place by dragging, as the original's drag handles move them */
function reorder(list: string[], from: number, to: number): string[] {
  const next = list.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** A toolbar's button: small, empty, in the text's colour */
function ControlButton({
  icon,
  active,
  expanded,
  onClick,
  testId,
  children,
}: {
  icon: IconName;
  active?: boolean;
  expanded: boolean;
  onClick: () => void;
  testId: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={cx('vgaGrid__controlBtn', active && 'vgaGrid__controlBtn--active')}
      aria-expanded={expanded}
      onClick={onClick}
      data-test-subj={testId}
    >
      <Icon name={icon} size="s" />
      <span className="vgaGrid__controlText">{children}</span>
    </button>
  );
}

/** A row of the lists that are ordered by dragging: the columns, the sorted fields */
function useDragOrder(list: string[], onOrder: (next: string[]) => void) {
  const [dragged, setDragged] = useState<string | null>(null);
  return {
    dragged,
    handle: (id: string) => ({
      draggable: true,
      onDragStart: () => setDragged(id),
      onDragEnd: () => setDragged(null),
      onDragOver: (event: ReactDragEvent) => {
        if (dragged === null || dragged === id) return;
        event.preventDefault();
        onOrder(reorder(list, list.indexOf(dragged), list.indexOf(id)));
      },
    }),
  };
}

function ColumnSelector({
  order,
  visible,
  onChange,
}: {
  order: string[];
  visible: string[];
  onChange: (order: string[], visible: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const close = useCallback(() => setOpen(false), []);
  const shown = new Set(visible);
  const hidden = order.length - visible.length;
  const listed = order.filter((id) => id.toLowerCase().includes(search.toLowerCase()));
  const setOrder = (next: string[]) => onChange(next, next.filter((id) => shown.has(id)));
  const drag = useDragOrder(order, setOrder);
  return (
    <Popover
      open={open}
      onClose={close}
      position="downLeft"
      className="vgaGrid__popover vgaGrid__columns"
      initialFocus=".vgaGrid__search"
      button={
        <ControlButton
          icon="listAdd"
          active={hidden > 0}
          expanded={open}
          onClick={() => setOpen(!open)}
          testId="dataGridColumnSelectorButton"
        >
          {columnsButtonText(hidden)}
        </ControlButton>
      }
    >
      <div className="vgaGrid__popoverTitle">
        <input
          type="text"
          className="atlField atlField--s vgaGrid__search"
          aria-label="Search columns"
          placeholder="Search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      <div className="vgaGrid__columnList">
        {listed.map((id) => (
          <div key={id} className={cx('vgaGrid__columnItem', drag.dragged === id && 'vgaGrid__columnItem--dragged')} {...drag.handle(id)}>
            <label className="vgaGrid__switch">
              <button
                type="button"
                role="switch"
                aria-checked={shown.has(id)}
                className="vgaGrid__switchTrack"
                onClick={() =>
                  onChange(
                    order,
                    order.filter((column) => (column === id ? !shown.has(id) : shown.has(column)))
                  )
                }
              />
              <span className="vgaGrid__switchLabel">{id}</span>
            </label>
            <Icon name="grab" className="vgaGrid__grab" />
          </div>
        ))}
      </div>
      <div className="vgaGrid__popoverFooter">
        <button type="button" className="vgaGrid__footerBtn" onClick={() => onChange(order, order)}>
          Show all
        </button>
        <button type="button" className="vgaGrid__footerBtn" onClick={() => onChange(order, [])}>
          Hide all
        </button>
      </div>
    </Popover>
  );
}

const DENSITIES: Array<{ id: GridDensity; label: string; icon: IconName }> = [
  { id: 'expanded', label: 'Expanded density', icon: 'tableDensityExpanded' },
  { id: 'normal', label: 'Normal density', icon: 'tableDensityNormal' },
  { id: 'compact', label: 'Compact density', icon: 'tableDensityCompact' },
];

function DensitySelector({ density, onChange }: { density: GridDensity; onChange: (density: GridDensity) => void }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <Popover
      open={open}
      onClose={close}
      position="downCenter"
      className="vgaGrid__popover"
      // the density chosen has the focus, as the original's checked radio button
      initialFocus=".vgaGrid__groupBtn[aria-pressed='true']"
      button={
        <ControlButton
          icon="tableDensityExpanded"
          expanded={open}
          onClick={() => setOpen(!open)}
          testId="dataGridStyleSelectorButton"
        >
          Density
        </ControlButton>
      }
    >
      <fieldset className="vgaGrid__group">
        <legend className="atlScreenReaderOnly">Select the display density for the data grid</legend>
        {DENSITIES.map((option) => (
          <button
            key={option.id}
            type="button"
            className="vgaGrid__groupBtn vgaGrid__groupBtn--icon"
            aria-pressed={option.id === density}
            aria-label={option.label}
            title={option.label}
            onClick={() => onChange(option.id)}
            data-test-subj={option.id}
          >
            <Icon name={option.icon} />
          </button>
        ))}
      </fieldset>
    </Popover>
  );
}

function SortSelector({
  columns,
  sorting,
  onChange,
}: {
  columns: GridColumn[];
  sorting: GridSort[];
  onChange: (sorting: GridSort[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const closePicker = useCallback(() => setPicking(false), []);
  const sortedIds = sorting.map((sort) => sort.id);
  const drag = useDragOrder(sortedIds, (next) =>
    onChange(next.map((id) => sorting.find((sort) => sort.id === id) ?? { id, direction: 'asc' }))
  );
  const unsorted = columns.filter((column) => !sortedIds.includes(column.id));
  const schemaOf = (id: string) => columns.find((column) => column.id === id)?.schema;
  return (
    <Popover
      open={open}
      onClose={close}
      position="downLeft"
      className="vgaGrid__popover vgaGrid__sorting"
      button={
        <ControlButton
          icon="sortable"
          active={sorting.length > 0}
          expanded={open}
          onClick={() => setOpen(!open)}
          testId="dataGridColumnSortingButton"
        >
          {sortButtonText(sorting.length)}
        </ControlButton>
      }
    >
      {sorting.length === 0 ? (
        <p className="vgaGrid__note" role="alert">
          Currently no fields are sorted
        </p>
      ) : (
        <div className="vgaGrid__sortList" role="region">
          {sorting.map((sort) => {
            const names = sortNames(schemaOf(sort.id));
            return (
              <div
                key={sort.id}
                className={cx('vgaGrid__sortItem', drag.dragged === sort.id && 'vgaGrid__columnItem--dragged')}
                data-test-subj={`euiDataGridColumnSorting-sortColumn-${sort.id}`}
                {...drag.handle(sort.id)}
              >
                <button
                  type="button"
                  className="vgaGrid__iconBtn"
                  aria-label={`Remove from data grid sort: ${sort.id}`}
                  onClick={() => onChange(sorting.filter((item) => item.id !== sort.id))}
                >
                  <Icon name="cross" />
                </button>
                <span className="vgaGrid__token">
                  <Icon name="tokenObject" />
                </span>
                <span className="vgaGrid__sortName">{sort.id}</span>
                <fieldset className="vgaGrid__group vgaGrid__group--full">
                  {(['asc', 'desc'] as const).map((direction) => (
                    <button
                      key={direction}
                      type="button"
                      className="vgaGrid__groupBtn"
                      aria-pressed={sort.direction === direction}
                      title={names[direction]}
                      onClick={() => onChange(sortedBy(sorting, sort.id, direction))}
                      data-test-subj={`euiDataGridColumnSorting-sortColumn-${sort.id}-${direction}`}
                    >
                      {names[direction]}
                    </button>
                  ))}
                </fieldset>
                <Icon name="grab" className="vgaGrid__grab" />
              </div>
            );
          })}
        </div>
      )}
      <div className="vgaGrid__popoverFooter">
        {unsorted.length > 0 && (
          <Popover
            open={picking}
            onClose={closePicker}
            position="downLeft"
            className="vgaGrid__popover vgaGrid__fieldList"
            button={
              <button
                type="button"
                className="vgaGrid__footerBtn"
                onClick={() => setPicking(!picking)}
                data-test-subj="dataGridColumnSortingPopoverColumnSelection"
              >
                Pick fields to sort by
                <Icon name="chevronDown" size="s" />
              </button>
            }
          >
            <div className="vgaGrid__fieldOptions" role="listbox">
              {unsorted.map((column) => (
                <button
                  key={column.id}
                  type="button"
                  role="option"
                  aria-selected={false}
                  aria-label={`Sort by:  ${column.id}`}
                  className="vgaGrid__field"
                  onClick={() => {
                    onChange([...sorting, { id: column.id, direction: 'asc' }]);
                  }}
                  data-test-subj={`dataGridColumnSortingPopoverColumnSelection-${column.id}`}
                >
                  <span className="vgaGrid__token">
                    <Icon name="tokenObject" />
                  </span>
                  <span className="vgaGrid__fieldName">{column.id}</span>
                </button>
              ))}
            </div>
          </Popover>
        )}
        {sorting.length > 0 && (
          <button type="button" className="vgaGrid__footerBtn vgaGrid__footerBtn--end" onClick={() => onChange([])}>
            Clear sorting
          </button>
        )}
      </div>
    </Popover>
  );
}

/** What a header cell's menu does with its column */
interface ColumnAction {
  label: string;
  icon: IconName;
  onClick: () => void;
}

function HeaderCell({
  column,
  width,
  first,
  sort,
  actions,
  onResize,
}: {
  column: GridColumn;
  width: number;
  first: boolean;
  sort: GridSort | undefined;
  actions: ColumnAction[];
  onResize: (width: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  // Its edge: dragged sideways, it makes the column wider or narrower
  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const start = event.clientX;
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const move = (moved: PointerEvent) => onResize(Math.max(MINIMUM_RESIZED_WIDTH, width + moved.clientX - start));
    const end = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', end);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', end);
  };
  return (
    <div
      className={cx('vgaGrid__headerCell', first && 'vgaGrid__headerCell--first')}
      style={{ width }}
      role="columnheader"
      data-test-subj={`dataGridHeaderCell-${column.id}`}
    >
      <div className="vgaGrid__resizer" onPointerDown={startResize} data-test-subj="dataGridColumnResizer" />
      <Popover
        open={open}
        onClose={close}
        placeAt={UNDER_HEADER}
        anchorClassName="vgaGrid__headerAnchor"
        className="vgaGrid__popover vgaGrid__actions"
        button={
          <button type="button" className="vgaGrid__headerBtn" onClick={() => setOpen(!open)}>
            {sort && <Icon name={sort.direction === 'asc' ? 'sortUp' : 'sortDown'} className="vgaGrid__sortArrow" />}
            <span className="vgaGrid__headerText">{column.id}</span>
            <Icon name="chevronDown" size="s" className="vgaGrid__headerIcon" />
          </button>
        }
      >
        <ul className="vgaGrid__actionList" data-test-subj={`dataGridHeaderCellActionGroup-${column.id}`}>
          {actions.map((action) => (
            <li key={action.label}>
              <button
                type="button"
                className="vgaGrid__action"
                onClick={() => {
                  close();
                  action.onClick();
                }}
              >
                <Icon name={action.icon} />
                <span>{action.label}</span>
              </button>
            </li>
          ))}
        </ul>
      </Popover>
    </div>
  );
}

/** A cell's whole value, as the original opens it: JSON in a small code block, with its copy button */
function CellValue({ value }: { value: string }) {
  const tokens = useMemo(() => jsonTokens(value), [value]);
  return (
    <div className="vgaGrid__cellValue">
      <pre className="vgaGrid__cellCode">
        <code>
          {tokens.map((token, index) =>
            token.kind ? (
              <span key={index} className={`vgaJson__${token.kind}`}>
                {token.text}
              </span>
            ) : (
              token.text
            )
          )}
        </code>
      </pre>
      <button type="button" className="vgaGrid__iconBtn" aria-label="Copy" title="Copy" onClick={() => copyText(value)}>
        <Icon name="copyClipboard" />
      </button>
    </div>
  );
}

export function InspectorDataGrid({
  columns,
  data,
  ariaLabel,
}: {
  columns: GridColumn[];
  data: GridRow[];
  ariaLabel: string;
}) {
  const ids = columns.map((column) => column.id);
  // Every column in the order of the column list, and those shown, in their order in the grid
  const [order, setOrder] = useState(ids);
  const [visible, setVisible] = useState(ids);
  const [sorting, setSorting] = useState<GridSort[]>([]);
  const [density, setDensity] = useState<GridDensity>('normal');
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: PAGE_SIZES[0] });
  // The cell that has the focus, and whether its value is open
  const [focus, setFocus] = useState<{ row: number; column: number } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const closeValue = useCallback(() => setExpanded(false), []);
  // Another data set shows all its columns from its first page, as the original's; the sort, the
  // density and the widths made stay
  const shownFor = useRef(ariaLabel);
  useEffect(() => {
    if (shownFor.current === ariaLabel) return;
    shownFor.current = ariaLabel;
    setOrder(ids);
    setVisible(ids);
    setPagination((page) => ({ ...page, pageIndex: 0 }));
    setFocus(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ariaLabel]);
  const [resized, setResized] = useState<Record<string, number>>({});
  const grid = useRef<HTMLDivElement>(null);
  const [gridWidth, setGridWidth] = useState(0);
  useLayoutEffect(() => {
    const element = grid.current;
    if (!element) return undefined;
    const measure = () => setGridWidth(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const shownColumns = visible
    .map((id) => columns.find((column) => column.id === id))
    .filter((column): column is GridColumn => column !== undefined);
  const widths = columnWidths(shownColumns, resized, gridWidth);
  const sorted = useMemo(() => sortedRows(data, sorting), [data, sorting]);
  const pageCount = Math.ceil(data.length / pagination.pageSize);
  const pageRows = sorted.slice(pagination.pageIndex * pagination.pageSize, (pagination.pageIndex + 1) * pagination.pageSize);

  const actionsOf = (column: GridColumn, index: number): ColumnAction[] => {
    const names = sortNames(column.schema);
    return [
      { label: 'Hide column', icon: 'eyeClosed', onClick: () => setVisible(visible.filter((id) => id !== column.id)) },
      { label: `Sort ${names.asc}`, icon: 'sortUp', onClick: () => setSorting(sortedBy(sorting, column.id, 'asc')) },
      { label: `Sort ${names.desc}`, icon: 'sortDown', onClick: () => setSorting(sortedBy(sorting, column.id, 'desc')) },
      ...(index > 0
        ? [{ label: 'Move left', icon: 'arrowLeft' as const, onClick: () => setVisible(movedColumn(visible, column.id, -1)) }]
        : []),
      ...(index < shownColumns.length - 1
        ? [{ label: 'Move right', icon: 'arrowRight' as const, onClick: () => setVisible(movedColumn(visible, column.id, 1)) }]
        : []),
    ];
  };

  // The arrows move the focus from cell to cell; Enter opens the cell's value, Escape closes it
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!focus || expanded) return;
    const moves: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      const row = Math.min(Math.max(focus.row + move[0], 0), pageRows.length - 1);
      const column = Math.min(Math.max(focus.column + move[1], 0), shownColumns.length - 1);
      setFocus({ row, column });
      grid.current?.querySelector<HTMLElement>(`[data-cell="${row}:${column}"]`)?.focus();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      setExpanded(true);
    }
  };

  const rowHeightClass = `vgaGrid--${density}`;
  const totalWidth = shownColumns.reduce((sum, column) => sum + widths[column.id], 0);
  return (
    <div className="vgaGrid__wrap">
      <div ref={grid} className={cx('vgaGrid', rowHeightClass)}>
        <div className="vgaGrid__controls">
          <ColumnSelector
            order={order}
            visible={visible}
            onChange={(nextOrder, nextVisible) => {
              setOrder(nextOrder);
              setVisible(nextVisible);
            }}
          />
          <DensitySelector density={density} onChange={setDensity} />
          <SortSelector columns={columns} sorting={sorting} onChange={setSorting} />
        </div>
        <div className="vgaGrid__scroll">
          <div
            className="vgaGrid__content"
            role="grid"
            aria-label={`${ariaLabel}; Page ${pagination.pageIndex + 1} of ${Math.max(1, pageCount)}.`}
            data-test-subj="dataGridWrapper"
            style={{ width: totalWidth }}
            onKeyDown={onKeyDown}
          >
            <div className="vgaGrid__header" role="row" data-test-subj="dataGridHeader">
              {shownColumns.map((column, index) => (
                <HeaderCell
                  key={column.id}
                  column={column}
                  width={widths[column.id]}
                  first={index === 0}
                  sort={sorting.find((sort) => sort.id === column.id)}
                  actions={actionsOf(column, index)}
                  onResize={(width) => setResized({ ...resized, [column.id]: width })}
                />
              ))}
            </div>
            {pageRows.map((row, rowIndex) => (
              <div key={rowIndex} className="vgaGrid__row" role="row">
                {shownColumns.map((column, columnIndex) => {
                  const value = row[column.id] || '';
                  const focused = focus?.row === rowIndex && focus.column === columnIndex;
                  return (
                    <div
                      key={column.id}
                      className={cx(
                        'vgaGrid__cell',
                        columnIndex === 0 && 'vgaGrid__cell--first',
                        columnIndex === shownColumns.length - 1 && 'vgaGrid__cell--last',
                        focused && 'vgaGrid__cell--focused'
                      )}
                      style={{ width: widths[column.id] }}
                      role="gridcell"
                      tabIndex={focused || (!focus && rowIndex === 0 && columnIndex === 0) ? 0 : -1}
                      data-cell={`${rowIndex}:${columnIndex}`}
                      data-test-subj="dataGridRowCell"
                      onFocus={() => {
                        if (!focused) {
                          setFocus({ row: rowIndex, column: columnIndex });
                          setExpanded(false);
                        }
                      }}
                    >
                      {/* The cell's value hangs under what the cell shows, as the original's; the
                          button that opens it, out of the flow, is shown under the pointer and in
                          the cell that has the focus */}
                      <Popover
                        open={focused && expanded}
                        onClose={closeValue}
                        placeAt={UNDER_CELL}
                        className="vgaGrid__popover vgaGrid__cellPopover"
                        anchorClassName="vgaGrid__cellAnchor"
                        button={
                          <>
                            <div className="vgaGrid__cellContent">
                              <div className="vgaGrid__truncate">{row[column.id] || null}</div>
                            </div>
                            <div className="vgaGrid__expandWrap">
                              <button
                                type="button"
                                tabIndex={-1}
                                className="vgaGrid__expand"
                                aria-label="Click or hit enter to interact with cell content"
                                title="Click or hit enter to interact with cell content"
                                onClick={() => setExpanded(!expanded)}
                              >
                                <Icon name="expandMini" size="s" />
                              </button>
                            </div>
                          </>
                        }
                      >
                        <CellValue value={value} />
                      </Popover>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      {data.length >= PAGE_SIZES[0] && (
        <div className="vgaGrid__pagination">
          <Pagination
            page={pagination.pageIndex}
            pages={pageCount}
            onPage={(pageIndex) => setPagination({ ...pagination, pageIndex })}
            pageSize={pagination.pageSize}
            pageSizes={PAGE_SIZES}
            onPageSize={(pageSize) => setPagination({ pageIndex: 0, pageSize })}
          />
        </div>
      )}
    </div>
  );
}

/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The grid panels lie on. While a dashboard is edited, a panel is moved by its title and sized
 * by its lower right corner, as in the original: the panel follows the pointer, a placeholder
 * shows where it will land, and the others make room as it goes, by the rules of the original's
 * grid (the grid in ./model).
 */

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { useSize } from '../../charts/core';
import {
  GRID_COLUMNS,
  GRID_MARGIN,
  ROW_HEIGHT,
  cellUnder,
  compact,
  layoutsDiffer,
  moveItem,
  resizeItem,
  settleLayout,
  sizedCells,
  sizingStep,
  startSizing,
  type GridItem,
  type Sizing,
} from './model';

export interface GridProps {
  layout: GridItem[];
  useMargins: boolean;
  editing: boolean;
  /**
   * The dashboard's state as the original's container holds it (its input): its panels, its query,
   * filters and time, a refresh asked for, its options and mode. A change of it draws the
   * original's grid again.
   */
  dashboardState: string;
  /** The one panel shown when a panel is maximized */
  expanded?: string;
  /**
   * The layout changed: a panel was moved or sized, or, `settled`, the grid packed the panels it
   * was given, as the original's grid packs a layout with gaps or overlaps when it gets it.
   */
  onLayoutChange: (layout: GridItem[], settled?: boolean) => void;
  renderPanel: (
    item: GridItem,
    handlers: {
      dragging: boolean;
      onDragStart: (event: ReactPointerEvent, id: string) => void;
      onResizeStart: (event: ReactPointerEvent, id: string) => void;
    }
  ) => ReactNode;
}

interface Gesture {
  id: string;
  kind: 'move' | 'resize';
  startX: number;
  startY: number;
  /** Where the pointer was at the gesture's last step */
  lastX: number;
  lastY: number;
  /** The panel as it was when taken */
  origin: GridItem;
  /** The layout when the gesture began, in the order the grid holds it: reading order */
  before: GridItem[];
  /** The layout as the gesture has left it so far */
  state: GridItem[];
  /** The cell the panel being moved was last over */
  cell: { x: number; y: number };
  sizing: Sizing;
  /** Where the placeholder is drawn: where the panel was after the step before, as the original draws it */
  placeholder?: GridItem;
}

/** What is drawn of a gesture: the placeholder, the panel in hand, the others */
interface Shown {
  kind: Gesture['kind'];
  id: string;
  layout: GridItem[];
  placeholder?: GridItem;
  offset: { dx: number; dy: number };
  sizing: Sizing;
}

/**
 * A window as narrow as the original stacks a dashboard's panels in, one under the other, while the
 * dashboard is looked at: its grid's stylesheet does below the "m" breakpoint (`euiBreakpoint('xs',
 * 's')`), and keeps the grid while the dashboard is edited
 */
export const NARROW_WINDOW = '(max-width: 767px)';

function useNarrowWindow(): boolean {
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia(NARROW_WINDOW).matches);
  useEffect(() => {
    const query = window.matchMedia(NARROW_WINDOW);
    const update = () => setNarrow(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return narrow;
}

/** How near the window's bottom the corner of a panel being sized starts the page scrolling */
const WINDOW_BUFFER = 10;

/** The width of a column of a grid `width` wide, its margin around and between the panels */
const columnWidthOf = (width: number, margin: number) => Math.max(1, (width - margin * (GRID_COLUMNS - 1) - margin * 2) / GRID_COLUMNS);

/**
 * A panel's place as the original's grid (react-grid-layout, without CSS transforms) writes it, its
 * margin around all the panels as its padding: in pixels, and, `inHundredths`, as it first draws
 * its panels, the left edge and the width in hundredths of its width to the last digit, for the
 * browser to put the panel on the same fraction of a pixel. `at` is where the panel in hand is.
 */
export function placeOf(
  item: GridItem,
  width: number,
  margin: number,
  inHundredths: boolean,
  at?: { left: number; top: number; width?: number; height?: number }
): CSSProperties {
  const column = columnWidthOf(width, margin);
  const left = at ? Math.round(at.left) : Math.round((column + margin) * item.x + margin);
  const top = at ? Math.round(at.top) : Math.round((ROW_HEIGHT + margin) * item.y + margin);
  const across = at?.width !== undefined ? Math.round(at.width) : Math.round(column * item.w + Math.max(0, item.w - 1) * margin);
  const down = at?.height !== undefined ? Math.round(at.height) : Math.round(ROW_HEIGHT * item.h + Math.max(0, item.h - 1) * margin);
  if (!inHundredths) return { left: `${left}px`, top: `${top}px`, width: `${across}px`, height: `${down}px` };
  return { left: `${(left / width) * 100}%`, top: `${top}px`, width: `${(across / width) * 100}%`, height: `${down}px` };
}

const byReading = (a: GridItem, b: GridItem) => (a.y === b.y ? a.x - b.x : a.y - b.y);

export function DashboardGrid({ layout, useMargins, editing, dashboardState, expanded, onLayoutChange, renderPanel }: GridProps) {
  const reading = useRef<string[]>([]);
  const [ref, size] = useSize<HTMLDivElement>();
  const [shown, setShown] = useState<Shown>();
  const gesture = useRef<Gesture | undefined>(undefined);

  const margin = useMargins ? GRID_MARGIN : 0;
  const columnWidth = columnWidthOf(size.width, margin);
  const narrow = useNarrowWindow() && !editing;

  // The places as the original's grid writes them: in hundredths as it first draws its panels, in
  // pixels once it draws them again, which a change of the dashboard or of the grid's width does,
  // and a panel being taken
  const firstDrawn = useRef<string>();
  const drawnAgain = useRef(false);
  const drawing = `${size.width}\n${dashboardState}`;
  if (size.width > 0 && layout.length > 0) {
    if (firstDrawn.current === undefined) firstDrawn.current = drawing;
    else if (firstDrawn.current !== drawing) drawnAgain.current = true;
  }

  // The grid packs what it is given, and says so once, as the original's grid does when mounted
  const layoutKey = JSON.stringify(layout);
  const settled = useMemo(() => settleLayout(JSON.parse(layoutKey) as GridItem[]), [layoutKey]);
  const told = useRef('');
  useEffect(() => {
    if (gesture.current || told.current === layoutKey) return;
    told.current = layoutKey;
    if (layoutsDiffer(settled, JSON.parse(layoutKey) as GridItem[])) onLayoutChange(settled, true);
  }, [layoutKey, settled, onLayoutChange]);

  const current = shown?.layout ?? settled;

  const onMove = useCallback(
    (event: PointerEvent) => {
      const now = gesture.current;
      if (!now) return;
      const offset = { dx: event.clientX - now.startX, dy: event.clientY - now.startY };
      const previous = now.state.find((item) => item.i === now.id) ?? now.origin;
      if (now.kind === 'move') {
        now.placeholder = previous;
        now.cell = cellUnder(now.origin, offset.dx, offset.dy, columnWidth, margin);
        now.state = moveItem(now.state, now.id, now.cell.x, now.cell.y);
      } else {
        const sizing = sizingStep(now.sizing, event.clientX - now.lastX, event.clientY - now.lastY, now.origin, columnWidth, margin);
        now.lastX = event.clientX;
        now.lastY = event.clientY;
        if (sizing.width !== now.sizing.width || sizing.height !== now.sizing.height) {
          const { w, h } = sizedCells(sizing, now.origin, columnWidth, margin);
          now.state = resizeItem(now.state, now.id, w, h);
          now.placeholder = { ...previous, w, h };
          // The page scrolls on when the corner comes to the window's bottom
          if (event.clientY > window.innerHeight - WINDOW_BUFFER) window.scrollTo(0, event.pageY + WINDOW_BUFFER - window.innerHeight);
        }
        now.sizing = sizing;
      }
      setShown({ kind: now.kind, id: now.id, layout: now.state, placeholder: now.placeholder, offset, sizing: now.sizing });
    },
    [columnWidth, margin]
  );

  const finish = useCallback(() => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', finish);
    window.removeEventListener('pointercancel', finish);
    document.body.classList.remove('dshDragging');
    const done = gesture.current;
    gesture.current = undefined;
    setShown(undefined);
    if (!done) return;
    // Let go, a moved panel is put once more over the cell it was last over, and all pack
    const result = done.kind === 'move' ? moveItem(done.state, done.id, done.cell.x, done.cell.y) : compact(done.state);
    if (layoutsDiffer(result, done.before)) onLayoutChange(result);
  }, [onMove, onLayoutChange]);

  useEffect(() => () => document.body.classList.remove('dshDragging'), []);

  const begin = (kind: Gesture['kind']) => (event: ReactPointerEvent, id: string) => {
    if (!editing || narrow || expanded || event.button !== 0) return;
    // The title's own buttons keep their clicks
    if (kind === 'move' && (event.target as Element).closest('button, a, input')) return;
    const origin = settled.find((item) => item.i === id);
    if (!origin) return;
    event.preventDefault();
    drawnAgain.current = true;
    // The grid holds the panels in reading order of the places it was given
    const given = (JSON.parse(layoutKey) as GridItem[]).sort(byReading).map((item) => item.i);
    const before = given.flatMap((key) => settled.filter((item) => item.i === key));
    gesture.current = {
      id,
      kind,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      origin,
      before,
      state: before,
      cell: { x: origin.x, y: origin.y },
      sizing: startSizing(origin, columnWidth, margin),
    };
    setShown({ kind, id, layout: before, offset: { dx: 0, dy: 0 }, sizing: startSizing(origin, columnWidth, margin) });
    document.body.classList.add('dshDragging');
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  };
  const handlers = { onDragStart: begin('move'), onResizeStart: begin('resize') };

  if (expanded) {
    const item = current.find((candidate) => candidate.i === expanded);
    return (
      <div ref={ref} className="dshGrid dshGrid--expanded">
        {item && renderPanel(item, { dragging: false, ...handlers })}
      </div>
    );
  }

  if (narrow) {
    // The panels in the wrappers the original's grid puts them in, which scripts find them by
    return (
      <div ref={ref} className="dshGrid dshGrid--stacked" style={{ gap: margin }} data-test-subj="dashboardGrid">
        {[...current].sort(byReading).map((item) => (
          <div key={item.i} style={{ height: item.h * ROW_HEIGHT + (item.h - 1) * margin }} data-test-subj="dashboardPanel">
            {renderPanel(item, { dragging: false, ...handlers })}
          </div>
        ))}
      </div>
    );
  }

  const box = (item: GridItem): CSSProperties => placeOf(item, size.width, margin, !drawnAgain.current);
  // The panel in hand goes where the pointer takes it, from where it was when taken; one being
  // sized stays there and takes the size the corner gives it
  const held = (): CSSProperties => {
    const origin = gesture.current?.origin;
    if (!origin || !shown) return {};
    const left = (columnWidth + margin) * origin.x + margin;
    const top = (ROW_HEIGHT + margin) * origin.y + margin;
    if (shown.kind === 'resize') return placeOf(origin, size.width, margin, false, { left, top, width: shown.sizing.width, height: shown.sizing.height });
    return placeOf(origin, size.width, margin, false, { left: left + shown.offset.dx, top: top + shown.offset.dy });
  };

  // The grid's height, its padding with it, as the original's
  const rows = current.reduce((max, item) => Math.max(max, item.y + item.h), 0);
  const height = rows * ROW_HEIGHT + Math.max(0, rows - 1) * margin + margin * 2;
  // Panels are in the page in reading order, as in OpenSearch Dashboards: that is the order the
  // keyboard goes through them and the order they ask for their data, which decides which chart
  // gives a label its colour first. The order holds still while a panel is being moved.
  if (!shown) reading.current = [...current].sort(byReading).map((item) => item.i);
  const inOrder = [...current].sort((a, b) => reading.current.indexOf(a.i) - reading.current.indexOf(b.i));
  return (
    <div ref={ref} className={`dshGrid dshGrid--placed${useMargins ? '' : ' dshGrid--flush'}`} style={{ height }} data-test-subj="dashboardGrid">
      {shown?.placeholder && <div className="dshGrid__placeholder" style={box(shown.placeholder)} aria-hidden="true" />}
      {size.width > 0 &&
        inOrder.map((item) => {
          const inHand = shown?.id === item.i;
          return (
            <div
              key={item.i}
              className={`dshGrid__item${inHand ? ' dshGrid__item--active' : ''}${shown && !inHand ? ' dshGrid__item--settling' : ''}`}
              style={inHand ? held() : box(item)}
              data-test-subj="dashboardPanel"
            >
              {renderPanel(item, { dragging: inHand, ...handlers })}
            </div>
          );
        })}
    </div>
  );
}

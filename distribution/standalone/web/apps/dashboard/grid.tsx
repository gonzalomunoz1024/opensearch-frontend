/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The grid panels lie on. While a dashboard is edited, a panel is moved by its title and sized
 * by its lower right corner; the others make room as it goes.
 */

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { useSize } from '../../charts/core';
import { GRID_COLUMNS, GRID_MARGIN, ROW_HEIGHT, placeItem, type GridItem } from './model';

export interface GridProps {
  layout: GridItem[];
  useMargins: boolean;
  editing: boolean;
  /** The one panel shown when a panel is maximized */
  expanded?: string;
  onLayoutChange: (layout: GridItem[]) => void;
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
  origin: GridItem;
  base: GridItem[];
}

const NARROW = 720;

export function DashboardGrid({ layout, useMargins, editing, expanded, onLayoutChange, renderPanel }: GridProps) {
  const reading = useRef<string[]>([]);
  const [ref, size] = useSize<HTMLDivElement>();
  const [preview, setPreview] = useState<GridItem[]>();
  const [active, setActive] = useState<string>();
  const gesture = useRef<Gesture | undefined>(undefined);
  const latest = useRef<GridItem[] | undefined>(undefined);

  const margin = useMargins ? GRID_MARGIN : 0;
  const columnWidth = Math.max(1, (size.width - margin * (GRID_COLUMNS - 1)) / GRID_COLUMNS);
  const narrow = size.width > 0 && size.width < NARROW;
  const shown = preview ?? layout;

  const onMove = useCallback(
    (event: PointerEvent) => {
      const current = gesture.current;
      if (!current) return;
      const dx = Math.round((event.clientX - current.startX) / (columnWidth + margin));
      const dy = Math.round((event.clientY - current.startY) / (ROW_HEIGHT + margin));
      const wanted: GridItem =
        current.kind === 'move'
          ? { ...current.origin, x: current.origin.x + dx, y: current.origin.y + dy }
          : { ...current.origin, w: Math.min(current.origin.w + dx, GRID_COLUMNS - current.origin.x), h: current.origin.h + dy };
      const next = placeItem(current.base, wanted);
      latest.current = next;
      setPreview(next);
    },
    [columnWidth, margin]
  );

  const finish = useCallback(() => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', finish);
    window.removeEventListener('pointercancel', finish);
    document.body.classList.remove('dshDragging');
    const result = latest.current;
    gesture.current = undefined;
    latest.current = undefined;
    setActive(undefined);
    setPreview(undefined);
    if (result) onLayoutChange(result);
  }, [onMove, onLayoutChange]);

  useEffect(() => () => document.body.classList.remove('dshDragging'), []);

  const begin = (kind: Gesture['kind']) => (event: ReactPointerEvent, id: string) => {
    if (!editing || narrow || event.button !== 0) return;
    // The title's own buttons keep their clicks
    if (kind === 'move' && (event.target as Element).closest('button, a, input')) return;
    const origin = layout.find((item) => item.i === id);
    if (!origin) return;
    event.preventDefault();
    gesture.current = { id, kind, startX: event.clientX, startY: event.clientY, origin, base: layout };
    setActive(id);
    document.body.classList.add('dshDragging');
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
  };
  const handlers = { onDragStart: begin('move'), onResizeStart: begin('resize') };

  if (expanded) {
    const item = shown.find((candidate) => candidate.i === expanded);
    return (
      <div ref={ref} className="dshGrid dshGrid--expanded">
        {item && renderPanel(item, { dragging: false, ...handlers })}
      </div>
    );
  }

  if (narrow) {
    return (
      <div ref={ref} className="dshGrid dshGrid--stacked" style={{ gap: margin }}>
        {[...shown]
          .sort((a, b) => a.y - b.y || a.x - b.x)
          .map((item) => (
            <div key={item.i} style={{ height: item.h * ROW_HEIGHT + (item.h - 1) * margin }}>
              {renderPanel(item, { dragging: false, ...handlers })}
            </div>
          ))}
      </div>
    );
  }

  const rows = shown.reduce((max, item) => Math.max(max, item.y + item.h), 0);
  const height = rows * ROW_HEIGHT + Math.max(0, rows - 1) * margin;
  // Panels are in the page in reading order, as in OpenSearch Dashboards: that is the order the
  // keyboard goes through them and the order they ask for their data, which decides which chart
  // gives a label its colour first. The order holds still while a panel is being moved.
  if (!active) reading.current = [...shown].sort((a, b) => a.y - b.y || a.x - b.x).map((item) => item.i);
  const inOrder = [...shown].sort((a, b) => reading.current.indexOf(a.i) - reading.current.indexOf(b.i));
  return (
    <div ref={ref} className={`dshGrid${useMargins ? '' : ' dshGrid--flush'}`} style={{ height }} data-test-subj="dashboardGrid">
      {size.width > 0 &&
        inOrder.map((item) => (
          <div
            key={item.i}
            className={`dshGrid__item${active === item.i ? ' dshGrid__item--active' : ''}${active ? ' dshGrid__item--settling' : ''}`}
            style={{
              transform: `translate(${Math.round((columnWidth + margin) * item.x)}px, ${(ROW_HEIGHT + margin) * item.y}px)`,
              width: Math.round(columnWidth * item.w + margin * (item.w - 1)),
              height: ROW_HEIGHT * item.h + margin * (item.h - 1),
            }}
            data-test-subj="dashboardPanel"
          >
            {renderPanel(item, { dragging: active === item.i, ...handlers })}
          </div>
        ))}
    </div>
  );
}

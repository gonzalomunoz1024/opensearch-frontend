/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The tooltip of the classic charts (vislib's Tooltip and positionTooltip): a dark box fixed to
 * the window, 10 pixels right of and below the pointer; it goes to the other side when it would
 * run out of the chart's wrapper or the window, and keeps the side it took while the pointer stays
 * in the wrapper, over all the charts of a split, so that it does not jump between neighbouring
 * marks. Its content is a table of a label and a value per row, the label column narrowed so that
 * the values have room; for a pie, the slice and those it is inside, a row each of field, bucket
 * and measure; for the title of a chart of a split that was cut short, the whole title.
 */

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface TooltipDetail {
  label: string;
  value: string;
}

/** A row of a pie's tooltip: the field of a ring, the slice's name in it and its measure */
export interface TooltipBranchRow {
  field: string;
  bucket: string;
  metric: string;
}

export interface TooltipState {
  /** Where the pointer is, in the window */
  clientX: number;
  clientY: number;
  /** The message of the zones the time range does not fully cover, above the details */
  header?: string;
  /** A line of plain text: the whole of a chart's title that was cut short */
  text?: string;
  details: TooltipDetail[];
  /** For a pie: the slice pointed at and those it is inside, the outermost first */
  branch?: TooltipBranchRow[];
}

type Direction = 'north' | 'south' | 'east' | 'west';

export interface Placement {
  top: number;
  left: number;
  _top: Direction;
  _left: Direction;
}

interface Bounds {
  top: number;
  left: number;
  bottom: number;
  right: number;
  area: number;
}

const OFFSET = 10;

const boundsOf = (box: { top: number; left: number; width: number; height: number }): Bounds => ({
  top: box.top,
  left: box.left,
  bottom: box.top + box.height,
  right: box.left + box.width,
  area: box.width * box.height,
});

/**
 * Where vislib places a tooltip of a size for the pointer: right of and below it unless that
 * would overflow the chart or the window, the side taken last time first
 */
export function placeTooltip(
  size: { width: number; height: number },
  pointer: { x: number; y: number },
  containers: Array<{ top: number; left: number; width: number; height: number }>,
  previous: Partial<Placement> = {}
): Placement {
  const pos: Record<Direction, number> = {
    east: pointer.x + OFFSET,
    west: pointer.x - size.width - OFFSET,
    south: pointer.y + OFFSET,
    north: pointer.y - size.height - OFFSET,
  };
  const overflow: Partial<Record<Direction, number>> = {};
  containers
    .map(boundsOf)
    .sort((a, b) => a.area - b.area)
    .forEach((bounds) => {
      const src: Record<Direction, number> = {
        north: bounds.top - pos.north,
        east: pos.east + size.width - bounds.right,
        south: pos.south + size.height - bounds.bottom,
        west: bounds.left - pos.west,
      };
      (Object.keys(src) as Direction[]).forEach((key) => {
        const a = overflow[key];
        const b = src[key];
        if (a === undefined || a === null) overflow[key] = b;
        else if (a < 0 && b < 0) overflow[key] = Math.min(a, b);
        else overflow[key] = Math.max(a, b);
      });
      // Overflowing both sides of the smaller container, it may still fit one side of the larger
      const east = overflow.east ?? 0;
      const west = overflow.west ?? 0;
      if (east > 0 && west > 0 && (src.east < 0 || src.west < 0)) {
        if (src.east < src.west) overflow.east = src.east;
        else overflow.west = src.west;
      }
    });

  const pick = (prop: 'top' | 'left', preferred: Direction, fallback: Direction): [number, Direction] => {
    const stashed = prop === 'top' ? previous._top : previous._left;
    const dirs = [...new Set([stashed, preferred, fallback].filter((dir): dir is Direction => Boolean(dir)))];
    for (const dir of dirs) {
      if ((overflow[dir] ?? 0) > 0) continue;
      return [pos[dir], dir];
    }
    const dir = dirs[0];
    let offset = overflow[dir] ?? 0;
    // When the property names the same side as the direction, the overflow is turned round
    if ((prop === 'top' && dir === 'north') || (prop === 'left' && dir === 'west')) offset *= -1;
    return [pos[dir] - offset, dir];
  };
  const [top, topDir] = pick('top', 'south', 'north');
  const [left, leftDir] = pick('left', 'east', 'west');
  return { top, left, _top: topDir, _left: leftDir };
}

const TABLE_MARGIN = 16;
const COLUMN_PADDING = 8;
const MAX_WIDTH = 320;

/** The tooltip of a chart, drawn into the page's body while there is something to show */
export function VislibTooltip({
  state,
  container,
  placement,
}: {
  state?: TooltipState;
  /** The chart's wrapper, which the tooltip keeps inside */
  container: () => HTMLElement | null;
  /** The side taken last, kept while the pointer stays in the chart's wrapper */
  placement: { current?: Placement };
}) {
  const box = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<{ left: number; top: number; labelWidth?: number; valueWidth?: number }>();
  useLayoutEffect(() => {
    const element = box.current;
    const chart = container();
    if (!state || !element || !chart) {
      setStyle(undefined);
      return;
    }
    // Measured without the widths set last time
    element.querySelectorAll<HTMLElement>('.visTooltip__labelContainer, .visTooltip__valueContainer').forEach((cell) => {
      cell.style.maxWidth = '';
    });
    // Fractional sizes, as jQuery measures them for the original
    const measured = element.getBoundingClientRect();
    const size = { width: measured.width, height: measured.height };
    const chartBox = chart.getBoundingClientRect();
    const next = placeTooltip(
      size,
      { x: state.clientX, y: state.clientY },
      [chartBox, { top: 0, left: 0, width: window.innerWidth, height: window.innerHeight }],
      placement.current
    );
    placement.current = next;
    // Two columns: the labels leave the values their room, or half of it when they are wider;
    // three (a pie's): the field and the bucket share what the measure leaves
    let labelWidth: number | undefined;
    let valueWidth: number | undefined;
    const columns = element.querySelectorAll('tbody > tr:nth-of-type(1) > td').length;
    const valueCell = element.querySelector<HTMLElement>(`tbody > tr:nth-of-type(1) > td:nth-child(${columns === 3 ? 3 : 2})`);
    if (valueCell && columns === 3) {
      labelWidth = (size.width - valueCell.getBoundingClientRect().width - TABLE_MARGIN) / 2 - COLUMN_PADDING;
    } else if (valueCell && columns === 2) {
      const tooltipWidth = size.width;
      const valueSize = valueCell.getBoundingClientRect().width;
      const greater = valueSize > tooltipWidth / 2;
      labelWidth = greater
        ? tooltipWidth / 2 - TABLE_MARGIN - COLUMN_PADDING * 2
        : tooltipWidth - valueSize - TABLE_MARGIN - COLUMN_PADDING;
      if (greater && tooltipWidth === MAX_WIDTH) valueWidth = labelWidth;
    }
    setStyle({ left: next.left, top: next.top, labelWidth, valueWidth });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  if (!state) return null;
  const content: ReactNode[] = [];
  if (state.header) {
    content.push(
      <p key="header" className="visTooltip__header">
        <svg className="visTooltip__headerIcon" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm.75 10.5h-1.5V7h1.5v4.5zM8 6a.9.9 0 1 1 0-1.8A.9.9 0 0 1 8 6z" />
        </svg>
        <span className="visTooltip__headerText">{state.header}</span>
      </p>
    );
  }
  if (state.text !== undefined) content.push(<p key="text">{state.text}</p>);
  const labelStyle = style?.labelWidth !== undefined ? { maxWidth: style.labelWidth } : undefined;
  if (state.branch?.length) {
    content.push(
      <table key="branch" className="visTooltip__table">
        <thead>
          <tr className="visTooltip__label">
            <th scope="col">field</th>
            <th scope="col">value</th>
            <th scope="col" />
          </tr>
        </thead>
        <tbody>
          {state.branch.map((row, index) => (
            <tr key={index} className="visTooltip__value">
              <td>
                <div className="visTooltip__labelContainer" style={labelStyle}>
                  {row.field}
                </div>
              </td>
              <td>
                <div className="visTooltip__labelContainer" style={labelStyle}>
                  {row.bucket}
                </div>
              </td>
              <td>{row.metric}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  if (state.details.length) {
    content.push(
      <table key="details">
        <tbody>
          {state.details.map((detail, index) => (
            <tr key={index}>
              <td className="visTooltip__label">
                <div className="visTooltip__labelContainer" style={labelStyle}>
                  {detail.label}
                </div>
              </td>
              <td className="visTooltip__value">
                <div className="visTooltip__valueContainer" style={style?.valueWidth !== undefined ? { maxWidth: style.valueWidth } : undefined}>
                  {detail.value}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  return createPortal(
    <div
      ref={box}
      className="visTooltip"
      role="tooltip"
      style={{ visibility: style ? 'visible' : 'hidden', left: style?.left ?? -500, top: style?.top ?? -500 }}
    >
      {content}
    </div>,
    document.body
  );
}

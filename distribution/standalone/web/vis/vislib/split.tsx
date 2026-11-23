/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The charts of a split as vislib lays them out (the chartSplit and chartTitleSplit of its pie and
 * gauge layouts): side by side in columns or one under another in rows, five pixels from each
 * other, and for a pie a title under each column or beside each row. Each title's SVG takes the
 * room of the first title before any is drawn, and its text is cut to nine tenths of it; a title
 * that was cut shows the whole of itself in the chart's tooltip while the pointer is on it
 * (ChartTitle).
 */

import type { ReactNode } from 'react';
import { useSize } from '../../charts/core';
import { measureText, type TextFont } from './text';
import type { TooltipState } from './tooltip';

/** The titles of a split's charts: the theme's extra small size, less a pixel */
export const SPLIT_TITLE_FONT: TextFont = { size: '11px' };

/** How deep an empty title is: its min-width beside rows, its min-height under columns */
const TITLE_DEPTH = 14;

/**
 * A title as vislib's ChartTitle cuts it: one longer than nine tenths of its room keeps as many
 * letters as fit at its average width, less five, and ends with "..."; and whether it was cut
 */
export function cutSplitTitle(
  label: string,
  room: number,
  measure = (text: string) => measureText(text, SPLIT_TITLE_FONT).advance
): { text: string; cut: boolean } {
  const maxWidth = room * 0.9;
  const length = measure(label);
  if (length <= maxWidth) return { text: label, cut: false };
  const end = Math.floor(maxWidth / (length / label.length)) - 5;
  return { text: `${end > 0 ? label.slice(0, end) : ''}...`, cut: true };
}

export const splitTitleText = (label: string, room: number, measure?: (text: string) => number): string =>
  cutSplitTitle(label, room, measure).text;

/** What the chart's tooltip shows for a title that was cut, with the pointer at a place on it: the whole title */
export const splitTitleTooltip = (label: string, clientX: number, clientY: number): TooltipState => ({
  clientX,
  clientY,
  text: label,
  details: [],
});

/** The titles of a split's charts, beside its rows or under its columns */
export function SplitTitles({
  rows,
  labels,
  onTooltip,
}: {
  rows: boolean;
  labels: string[];
  /** Called with what the chart's tooltip shows while the pointer is on a title that was cut, and with nothing when it leaves */
  onTooltip?: (state: TooltipState | undefined) => void;
}) {
  const [ref, size] = useSize<HTMLDivElement>();
  // Every title is drawn as large as the first one was while empty: its share of the length, as
  // clientWidth and clientHeight round it, and its least depth
  const share = labels.length ? Math.round((rows ? size.height : size.width) / labels.length) : 0;
  const width = rows ? TITLE_DEPTH : share;
  const height = rows ? share : TITLE_DEPTH;
  return (
    <div ref={ref} className={rows ? 'visAxis__splitTitles--y' : 'visAxis__splitTitles--x'}>
      {labels.map((label, index) => {
        const title = share > 0 ? cutSplitTitle(label, rows ? height : width) : undefined;
        const tips = title?.cut && onTooltip ? onTooltip : undefined;
        return (
          <div key={index} className="chart-title">
            {title && (
              <svg width={width} height={height} focusable="false">
                <text
                  transform={rows ? `translate(11,${height / 2})rotate(270)` : `translate(${width / 2},11)`}
                  textAnchor="middle"
                  onMouseMove={tips && ((event) => tips(splitTitleTooltip(label, event.clientX, event.clientY)))}
                  onMouseLeave={tips && (() => tips(undefined))}
                >
                  {title.text}
                </text>
              </svg>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** The charts of a split, side by side in columns or one under another in rows */
export function SplitCharts({ rows, children }: { rows: boolean; children: ReactNode[] }) {
  return (
    <div className={rows ? 'visWrapper__splitCharts--row' : 'visWrapper__splitCharts--column'}>
      {children.map((child, index) => (
        <div key={index} className="visWrapper__chart">
          {child}
        </div>
      ))}
    </div>
  );
}

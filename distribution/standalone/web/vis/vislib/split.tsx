/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The charts of a split as vislib lays them out (the chartSplit and chartTitleSplit of its pie and
 * gauge layouts): side by side in columns or one under another in rows, five pixels from each
 * other, and for a pie a title under each column or beside each row. Each title's SVG takes the
 * room of the first title before any is drawn, and its text is cut to nine tenths of it
 * (ChartTitle).
 */

import type { ReactNode } from 'react';
import { useSize } from '../../charts/core';
import { measureText, type TextFont } from './text';

/** The titles of a split's charts: the theme's extra small size, less a pixel */
export const SPLIT_TITLE_FONT: TextFont = { size: '11px' };

/** How deep an empty title is: its min-width beside rows, its min-height under columns */
const TITLE_DEPTH = 14;

/**
 * A title as vislib's ChartTitle cuts it: one longer than nine tenths of its room keeps as many
 * letters as fit at its average width, less five, and ends with "..."
 */
export function splitTitleText(label: string, room: number, measure = (text: string) => measureText(text, SPLIT_TITLE_FONT).advance): string {
  const maxWidth = room * 0.9;
  const length = measure(label);
  if (length <= maxWidth) return label;
  const end = Math.floor(maxWidth / (length / label.length)) - 5;
  return `${end > 0 ? label.slice(0, end) : ''}...`;
}

/** The titles of a split's charts, beside its rows or under its columns */
export function SplitTitles({ rows, labels }: { rows: boolean; labels: string[] }) {
  const [ref, size] = useSize<HTMLDivElement>();
  // Every title is drawn as large as the first one was while empty: its share of the length, as
  // clientWidth and clientHeight round it, and its least depth
  const share = labels.length ? Math.round((rows ? size.height : size.width) / labels.length) : 0;
  const width = rows ? TITLE_DEPTH : share;
  const height = rows ? share : TITLE_DEPTH;
  return (
    <div ref={ref} className={rows ? 'visAxis__splitTitles--y' : 'visAxis__splitTitles--x'}>
      {labels.map((label, index) => (
        <div key={index} className="chart-title">
          {share > 0 && (
            <svg width={width} height={height} focusable="false">
              <text transform={rows ? `translate(11,${height / 2})rotate(270)` : `translate(${width / 2},11)`} textAnchor="middle">
                {splitTitleText(label, rows ? height : width)}
              </text>
            </svg>
          )}
        </div>
      ))}
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

/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Where the parts of a classic chart go in the room it is given, as vislib's layout puts them
 * (its column layout, the styles of its frame and the order its handler draws in): 10 pixels above
 * and below; the axes beside the chart, each as deep as its labels and title; and the chart in
 * what is left. The length of each axis is the room it has when it is drawn: the first axis of
 * categories is drawn once first to know how deep it is, then the value axes, then the axes of
 * categories, last first; so a value axis standing beside the chart is as long as the chart is
 * high, and one lying under it as long as the room left by the axes already beside it.
 *
 * A split has a chart for each of its buckets, in rows one under another or in columns side by
 * side, 10 pixels apart. A standing axis is drawn beside each row and a lying one under each
 * column, with its title; the others once. The title of each chart stands at the left of its row
 * or under its column, as large as the first title's room was before the value axes were drawn.
 * Rows ask for the whole height, so that what lies above and under them gives way a little.
 */

import { drawAxis, isHorizontal, titleSize, type AxisConfig, type AxisPosition, type AxisScaleInfo, type DrawnAxis } from './axis';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutAxisInput {
  config: AxisConfig;
  /** The scale of the axis over a length */
  scaleFor: (length: number) => AxisScaleInfo;
  format: (value: number | string) => string;
}

export interface PlacedTitle {
  /** Where its SVGs are: one in each row or column its axis is drawn in */
  rects: Rect[];
  text: string;
  /** As vislib writes it on the text: along a horizontal axis, or turned beside a vertical one */
  transform: string;
}

export interface PlacedAxis {
  input: LayoutAxisInput;
  /** Absent when the axis is not shown */
  drawn?: DrawnAxis;
  scale?: AxisScaleInfo;
  length: number;
  /** Where the axis's own SVGs are: one beside each row or under each column of a split, else one */
  rects: Rect[];
  /** How the axis is moved inside it */
  transform?: string;
  /** How the line along a top axis is moved: a pixel to the right */
  pathTransform?: string;
  title?: PlacedTitle;
}

/** The titles of the charts of a split: at the left of its rows, or under its columns */
export interface PlacedSplitTitles {
  /** The size of every title's SVG: the room of the first title when the titles were drawn */
  width: number;
  height: number;
  /** Each title's room, where its SVG starts: a share of the height of the rows or of the width of the columns */
  boxes: Rect[];
}

export interface PointSeriesLayout {
  /** The charts, where the marks are drawn: one, or one for each bucket of a split */
  charts: Rect[];
  axes: PlacedAxis[];
  splitTitles?: PlacedSplitTitles;
}

/** How a chart is split into several */
export interface SplitShape {
  /** Whether the charts are rows, one under another, or columns side by side */
  rows: boolean;
  /** How many charts there are */
  count: number;
  /** How high the row of titles under the columns is, once they are drawn */
  titleRow?: number;
}

/** vislib's padding above and below everything */
export const WRAPPER_PADDING = 10;
/** The least an empty column beside the chart is wide (its axis div's min-width) */
const EMPTY_COLUMN = 1;
/** An SVG at the top reaches 5 pixels down into what is under it (its margin-bottom: -5px) */
const TOP_OVERLAP = 5;
/** What is left between two charts of a split, and between their axes: a margin of 5 pixels each */
const CHART_GAP = 10;
/** How deep the title of a chart of a split is: its least width beside a row, its least height under a column */
export const SPLIT_TITLE_DEPTH = 14;
/** The most the row of titles under the columns is high */
export const SPLIT_TITLE_ROW = 16;

type Item = { kind: 'axis' | 'title'; placed: PlacedAxis; size: number; length: number };

/**
 * The layout of a chart, or of the charts of a split, in a room of `width` by `height`: the axes,
 * each drawn for the length it gets, and the rectangle of each chart
 */
export function layoutPointSeries(
  width: number,
  height: number,
  valueAxes: LayoutAxisInput[],
  categoryAxes: LayoutAxisInput[],
  split?: SplitShape
): PointSeriesLayout {
  const inner = height - WRAPPER_PADDING * 2;
  const count = Math.max(1, split?.count ?? 1);
  // How many times a standing axis is drawn, one under another, and a lying one, side by side
  const standing = split?.rows ? count : 1;
  const lying = split && !split.rows ? count : 1;
  const titlesLeft = split?.rows ? SPLIT_TITLE_DEPTH : 0;
  const titlesBottom = split && !split.rows ? (split.titleRow ?? SPLIT_TITLE_ROW) : 0;
  const columns: Record<AxisPosition, Item[]> = { left: [], right: [], top: [], bottom: [] };
  const fixed: Partial<Record<'left' | 'right', number>> = {};
  const spacer = { top: 0, bottom: 0 };

  const sum = (items: Item[]) => items.reduce((total, item) => total + item.size, 0);
  // Beside the charts: the titles of the rows on the left, then the axes, or the room kept for them
  const sideWidth = (side: 'left' | 'right') =>
    (side === 'left' ? titlesLeft : 0) + (fixed[side] ?? Math.max(EMPTY_COLUMN, sum(columns[side])));
  const centreWidth = () => width - sideWidth('left') - sideWidth('right');
  // Each SVG at the top, the title's too, has a margin of -5 pixels under it; under the columns of
  // a split come their titles
  const contentHeight = (side: 'top' | 'bottom') =>
    side === 'top' ? Math.max(0, sum(columns.top) - columns.top.length * TOP_OVERLAP) : sum(columns.bottom) + titlesBottom;
  /**
   * How high what lies above and under the charts is. Rows ask for the whole height themselves, so
   * that all three give way in proportion to what they ask for (the frame's flex-shrink)
   */
  const usedHeights = (): { top: number; bottom: number } => {
    const top = contentHeight('top');
    const bottom = contentHeight('bottom');
    const asked = top + inner + bottom;
    if (!split?.rows || inner <= 0 || asked <= inner) return { top, bottom };
    return { top: (top * inner) / asked, bottom: (bottom * inner) / asked };
  };
  const lengthOf = (config: AxisConfig) =>
    isHorizontal(config)
      ? (centreWidth() - CHART_GAP * (lying - 1)) / lying
      : (inner - spacer.top - spacer.bottom - CHART_GAP * (standing - 1)) / standing;

  /**
   * Draws an axis for the room it has now, as vislib draws it: on the left or at the top, its
   * title when the axis is shown, then the axis; on the right or at the bottom, the axis, then
   * its title when either is shown
   */
  const draw = (input: LayoutAxisInput): { placed: PlacedAxis; items: Item[] } => {
    const { config } = input;
    const length = lengthOf(config);
    const placed: PlacedAxis = { input, length, rects: [] };
    const items: Item[] = [];
    const before = config.position === 'left' || config.position === 'top';
    const hasTitle = before ? config.show : config.show || config.titleShow;
    // A title beside the chart is at least a pixel wide, even with no text (its min-width)
    const depth = isHorizontal(config) ? titleSize(config.title) : Math.max(1, titleSize(config.title));
    const title: Item | undefined = hasTitle ? { kind: 'title', placed, size: depth, length } : undefined;
    if (title) placed.title = { rects: [], text: config.title, transform: '' };
    if (title && before) items.push(title);
    if (config.show) {
      const scale = input.scaleFor(length);
      placed.scale = scale;
      placed.drawn = drawAxis(config, scale, input.format);
      items.push({ kind: 'axis', placed, size: placed.drawn.size, length });
    }
    if (title && !before) items.push(title);
    return { placed, items };
  };

  // The first axis of categories, drawn once with the titles of a split to know the room they
  // take: lying, how high the columns beside the charts leave free; standing, how wide its own is
  const first = categoryAxes[0];
  if (first) {
    const { items } = draw(first);
    const side = first.config.position;
    if (side === 'top' || side === 'bottom') {
      columns[side].push(...items);
      spacer[side] = usedHeights()[side];
      columns[side] = [];
    } else {
      // The titles of the rows were in that room: it is kept beside them, which leaves it too wide
      fixed[side] = (side === 'left' ? titlesLeft : 0) + Math.max(EMPTY_COLUMN, sum(items));
    }
  }

  // The titles of a split, each as large as the first one's room is now: its share of the rows'
  // height or of the columns' width, as clientHeight and clientWidth round it
  const splitTitles: PlacedSplitTitles | undefined = split
    ? split.rows
      ? {
          width: SPLIT_TITLE_DEPTH,
          height: Math.max(SPLIT_TITLE_DEPTH, Math.round((inner - spacer.top - spacer.bottom) / count)),
          boxes: [],
        }
      : { width: Math.max(SPLIT_TITLE_DEPTH, Math.round(centreWidth() / count)), height: SPLIT_TITLE_DEPTH, boxes: [] }
    : undefined;

  const placedAxes: PlacedAxis[] = [];
  for (const input of valueAxes) {
    const { placed, items } = draw(input);
    const side = input.config.position;
    columns[side].push(...items);
    // A lying value axis that is shown tells the columns beside the charts how high its own is
    if ((side === 'top' || side === 'bottom') && input.config.show) spacer[side] = usedHeights()[side];
    placedAxes.push(placed);
  }
  const categoryPlaced: PlacedAxis[] = [];
  for (const input of [...categoryAxes].reverse()) {
    const { placed, items } = draw(input);
    columns[input.config.position].push(...items);
    categoryPlaced.unshift(placed);
  }
  placedAxes.push(...categoryPlaced);

  const left = sideWidth('left');
  const right = sideWidth('right');
  const centre = Math.max(0, width - left - right);
  const used = usedHeights();
  const chartsTop = WRAPPER_PADDING + used.top;
  const chartsHeight = Math.max(0, inner - used.top - used.bottom);
  const charts: Rect[] = [];
  if (split?.rows) {
    const each = Math.max(0, (chartsHeight - CHART_GAP * (count - 1)) / count);
    for (let at = 0; at < count; at += 1) charts.push({ x: left, y: chartsTop + at * (each + CHART_GAP), width: centre, height: each });
  } else {
    const each = Math.max(0, (centre - CHART_GAP * (count - 1)) / count);
    for (let at = 0; at < count; at += 1) charts.push({ x: left + at * (each + CHART_GAP), y: chartsTop, width: each, height: chartsHeight });
  }

  // Where each SVG lands: side by side beside the chart, one under another above and below it; in
  // a split, again beside each row or under each column. An SVG keeps the length it was drawn with.
  const standTop = WRAPPER_PADDING + spacer.top;
  const standRoom = inner - spacer.top - spacer.bottom;
  const standEach = (standRoom - CHART_GAP * (standing - 1)) / standing;
  const lieEach = (centre - CHART_GAP * (lying - 1)) / lying;
  const place = (side: AxisPosition) => {
    const items = columns[side];
    if (side === 'left' || side === 'right') {
      for (let row = 0; row < standing; row += 1) {
        const y = standTop + row * (standEach + CHART_GAP);
        let x = side === 'left' ? titlesLeft : width - right;
        for (const item of items) {
          const rect = { x, y, width: item.size, height: item.length };
          if (item.kind === 'axis') {
            item.placed.rects.push(rect);
            item.placed.transform = side === 'left' ? `translate(${item.size},0)` : undefined;
          } else if (item.placed.title) {
            item.placed.title.rects.push(rect);
            item.placed.title.transform = `translate(0,${item.length / 2}) rotate(270)`;
          }
          x += item.size;
        }
      }
      return;
    }
    for (let column = 0; column < lying; column += 1) {
      const x = left + column * (lieEach + CHART_GAP);
      let y = side === 'top' ? WRAPPER_PADDING : WRAPPER_PADDING + inner - used.bottom;
      for (const item of items) {
        const rect = { x, y, width: item.length, height: item.size };
        if (item.kind === 'axis') {
          item.placed.rects.push(rect);
          if (side === 'top' && item.placed.drawn) {
            item.placed.transform = `translate(0, ${item.placed.drawn.rawSize - 1})`;
            item.placed.pathTransform = 'translate(1,0)';
          }
        } else if (item.placed.title) {
          item.placed.title.rects.push(rect);
          item.placed.title.transform = `translate(${item.length / 2},0)`;
        }
        y += item.size - (side === 'top' ? TOP_OVERLAP : 0);
      }
    }
  };
  place('left');
  place('right');
  place('top');
  place('bottom');

  if (splitTitles) {
    const share = (split?.rows ? standRoom : centre) / count;
    for (let at = 0; at < count; at += 1) {
      splitTitles.boxes.push(
        split?.rows
          ? { x: 0, y: standTop + at * share, width: SPLIT_TITLE_DEPTH, height: share }
          : { x: left + at * share, y: WRAPPER_PADDING + inner - titlesBottom, width: share, height: titlesBottom }
      );
    }
  }

  return { charts, axes: placedAxes, splitTitles };
}

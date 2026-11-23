/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Where the parts of a classic chart go in the room it is given, as vislib's layout puts them
 * (its column layout and the order its handler draws in): 10 pixels above and below; the axes
 * beside the chart, each as deep as its labels and title; and the chart in what is left. The
 * length of each axis is the room it has when it is drawn: the first axis of categories is drawn
 * once first to know how deep it is, then the value axes, then the axes of categories, last
 * first; so a value axis standing beside the chart is as long as the chart is high, and one
 * lying under it as long as the room left by the axes already beside it.
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
  rect: Rect;
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
  /** Where the axis's own SVG is */
  rect?: Rect;
  /** How the axis is moved inside it */
  transform?: string;
  /** How the line along a top axis is moved: a pixel to the right */
  pathTransform?: string;
  title?: PlacedTitle;
}

export interface PointSeriesLayout {
  /** The chart: where the marks are drawn */
  chart: Rect;
  axes: PlacedAxis[];
}

/** vislib's padding above and below everything */
export const WRAPPER_PADDING = 10;
/** The least an empty column beside the chart is wide (its axis div's min-width) */
const EMPTY_COLUMN = 1;
/** An SVG at the top reaches 5 pixels down into what is under it (its margin-bottom: -5px) */
const TOP_OVERLAP = 5;

type Item = { kind: 'axis' | 'title'; placed: PlacedAxis; size: number };

/**
 * The layout of a chart in a room of `width` by `height`: its axes, each drawn for the length it
 * gets, and the chart's rectangle
 */
export function layoutPointSeries(
  width: number,
  height: number,
  valueAxes: LayoutAxisInput[],
  categoryAxes: LayoutAxisInput[]
): PointSeriesLayout {
  const inner = height - WRAPPER_PADDING * 2;
  const columns: Record<AxisPosition, Item[]> = { left: [], right: [], top: [], bottom: [] };
  const fixed: Partial<Record<'left' | 'right', number>> = {};
  const spacer = { top: 0, bottom: 0 };

  const sum = (items: Item[]) => items.reduce((total, item) => total + item.size, 0);
  const columnWidth = (side: 'left' | 'right') => fixed[side] ?? Math.max(EMPTY_COLUMN, sum(columns[side]));
  // Each SVG at the top, the title's too, has a margin of -5 pixels under it
  const columnHeight = (side: 'top' | 'bottom') =>
    Math.max(0, sum(columns[side]) - (side === 'top' ? columns[side].length * TOP_OVERLAP : 0));
  const lengthOf = (config: AxisConfig) =>
    isHorizontal(config) ? width - columnWidth('left') - columnWidth('right') : inner - spacer.top - spacer.bottom;

  /**
   * Draws an axis for the room it has now, as vislib draws it: on the left or at the top, its
   * title when the axis is shown, then the axis; on the right or at the bottom, the axis, then
   * its title when either is shown
   */
  const draw = (input: LayoutAxisInput): { placed: PlacedAxis; items: Item[] } => {
    const { config } = input;
    const length = lengthOf(config);
    const placed: PlacedAxis = { input, length };
    const items: Item[] = [];
    const before = config.position === 'left' || config.position === 'top';
    const hasTitle = before ? config.show : config.show || config.titleShow;
    const title: Item | undefined = hasTitle ? { kind: 'title', placed, size: titleSize(config.title) } : undefined;
    if (title) placed.title = { rect: { x: 0, y: 0, width: 0, height: 0 }, text: config.title, transform: '' };
    if (title && before) items.push(title);
    if (config.show) {
      const scale = input.scaleFor(length);
      placed.scale = scale;
      placed.drawn = drawAxis(config, scale, input.format);
      items.push({ kind: 'axis', placed, size: placed.drawn.size });
    }
    if (title && !before) items.push(title);
    return { placed, items };
  };

  // The first axis of categories, drawn once to know the room it takes
  const first = categoryAxes[0];
  if (first) {
    const { items } = draw(first);
    const side = first.config.position;
    if (side === 'top' || side === 'bottom') {
      columns[side].push(...items);
      spacer[side] = columnHeight(side);
      columns[side] = [];
    } else {
      fixed[side] = Math.max(EMPTY_COLUMN, sum(items));
    }
  }

  const placedAxes: PlacedAxis[] = [];
  for (const input of valueAxes) {
    const { placed, items } = draw(input);
    const side = input.config.position;
    columns[side].push(...items);
    if (side === 'top' || side === 'bottom') spacer[side] = columnHeight(side);
    placedAxes.push(placed);
  }
  const categoryPlaced: PlacedAxis[] = [];
  for (const input of [...categoryAxes].reverse()) {
    const { placed, items } = draw(input);
    columns[input.config.position].push(...items);
    categoryPlaced.unshift(placed);
  }
  placedAxes.push(...categoryPlaced);

  const left = columnWidth('left');
  const right = columnWidth('right');
  const top = columnHeight('top');
  const bottom = columnHeight('bottom');
  const chart: Rect = {
    x: left,
    y: WRAPPER_PADDING + top,
    width: Math.max(0, width - left - right),
    height: Math.max(0, inner - top - bottom),
  };

  // Where each SVG lands: side by side beside the chart, one under another above and below it
  const yTop = WRAPPER_PADDING + spacer.top;
  const yLength = inner - spacer.top - spacer.bottom;
  const place = (side: AxisPosition) => {
    const items = columns[side];
    if (side === 'left' || side === 'right') {
      let x = side === 'left' ? 0 : width - right;
      for (const item of items) {
        const rect = { x, y: yTop, width: item.size, height: yLength };
        if (item.kind === 'axis') {
          item.placed.rect = rect;
          item.placed.transform = side === 'left' ? `translate(${item.size},0)` : undefined;
        } else if (item.placed.title) {
          item.placed.title.rect = rect;
          item.placed.title.transform = `translate(0,${rect.height / 2}) rotate(270)`;
        }
        x += item.size;
      }
      return;
    }
    let y = side === 'top' ? WRAPPER_PADDING : WRAPPER_PADDING + inner - bottom;
    const x = left;
    const columnLength = width - left - right;
    for (const item of items) {
      const rect = { x, y, width: columnLength, height: item.size };
      if (item.kind === 'axis') {
        item.placed.rect = rect;
        if (side === 'top' && item.placed.drawn) {
          item.placed.transform = `translate(0, ${item.placed.drawn.rawSize - 1})`;
          item.placed.pathTransform = 'translate(1,0)';
        }
      } else if (item.placed.title) {
        item.placed.title.rect = rect;
        item.placed.title.transform = `translate(${rect.width / 2},0)`;
      }
      y += item.size - (side === 'top' ? TOP_OVERLAP : 0);
    }
  };
  place('left');
  place('right');
  place('top');
  place('bottom');

  return { chart, axes: placedAxes };
}

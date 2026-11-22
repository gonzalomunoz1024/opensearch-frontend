/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The labels of an axis as the classic charts of OpenSearch Dashboards draw them (vislib's
 * AxisLabels over d3's axis): cut to a number of characters, turned about the end nearest the
 * axis, left out where they would run past either end of the axis or into the label kept before
 * them, and given as much room beside the axis as the deepest of them takes.
 */

export type AxisSide = 'top' | 'bottom' | 'left' | 'right';

/** How far a line of text reaches above and below its baseline, in pixels */
export interface FontMetrics {
  size: number;
  ascent: number;
  descent: number;
}

/** A box from the point of a tick on the axis line, x to the right and y down */
export interface LabelBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Where a label is drawn, from the point of its tick on the axis line */
export interface LabelPlacement {
  x: number;
  y: number;
  /** How far down its baseline is moved, in pixels, as SVG's dy */
  dy: number;
  anchor: 'start' | 'middle' | 'end';
  /** Degrees it is turned by, clockwise as SVG turns, about (cx, cy); 0 when it lies flat */
  angle: number;
  cx: number;
  cy: number;
  /** The box of the tick, its line and its label, by which the label is kept and given room */
  box: LabelBox;
}

/** The length of a tick's line and the gap between it and its label, as d3 draws them */
const TICK_LENGTH = 6;
const TICK_PADDING = 3;
/** How much wider than its box a label counts when the labels are filtered */
const FILTER_PADDING = 1.1;
/** The room left beyond the deepest label */
const AXIS_PADDING = 5;

/** What a visualization says of the labels of an axis */
export interface AxisLabelParams {
  show?: boolean;
  rotate?: number;
  filter?: boolean;
  truncate?: number;
}

/**
 * How the labels of a value axis are drawn, with the classic charts' defaults for what the
 * visualization does not say (vislib's AxisConfig): along a horizontal axis, under or over a chart
 * on its side, they are filtered and kept whole; up a vertical axis they are not filtered, unless
 * its scale is logarithmic, and are cut at 100 characters
 */
export function valueAxisLabels(
  labels: AxisLabelParams | undefined,
  horizontal: boolean,
  log: boolean
): { rotate: number; filter: boolean; truncate: number } {
  const rotate = Number(labels?.rotate ?? 0);
  const truncate = Number(labels?.truncate ?? (horizontal ? 0 : 100));
  return {
    rotate: Number.isFinite(rotate) ? rotate : 0,
    filter: log || (labels?.filter ?? horizontal),
    truncate: Number.isFinite(truncate) ? truncate : 0,
  };
}

/** A label cut to a number of characters, with an ellipsis; 0 keeps it whole */
export function truncateLabel(text: string, size: number): string {
  if (!(size > 0) || size >= text.length) return text;
  return `${text.slice(0, size)}…`;
}

function turnedBox(box: LabelBox, angle: number, cx: number, cy: number): LabelBox {
  const radians = (angle * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [x, y] of [
    [box.left, box.top],
    [box.right, box.top],
    [box.left, box.bottom],
    [box.right, box.bottom],
  ]) {
    xs.push(cx + (x - cx) * cos - (y - cy) * sin);
    ys.push(cy + (x - cx) * sin + (y - cy) * cos);
  }
  return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
}

/**
 * Where a label of a given width goes beside an axis, flat or turned by `rotate` degrees: flat,
 * as d3 places it (centred under or over its tick, or level with it to its side); turned, about
 * its end nearest the axis, or about its middle when it stands upright beside a vertical axis
 */
export function placeLabel(side: AxisSide, rotate: number, width: number, font: FontMetrics): LabelPlacement {
  const along = side === 'top' || side === 'bottom';
  const gap = TICK_LENGTH + TICK_PADDING;
  const x = side === 'left' ? -gap : side === 'right' ? gap : 0;
  const y = side === 'bottom' ? gap : side === 'top' ? -gap : 0;
  let dy = (side === 'bottom' ? 0.71 : side === 'top' ? 0 : 0.32) * font.size;
  let anchor: LabelPlacement['anchor'] = along ? 'middle' : side === 'left' ? 'end' : 'start';
  let angle = 0;
  const turned = Number.isFinite(rotate) && rotate !== 0;
  if (turned) {
    if (along) anchor = 'end';
    else if (rotate === 90 || rotate === -90) anchor = 'middle';
    dy = along ? 0.3 * font.size : 0;
    angle = side === 'top' ? rotate : -rotate;
  }
  const left = anchor === 'end' ? x - width : anchor === 'middle' ? x - width / 2 : x;
  const text: LabelBox = { left, top: y + dy - font.ascent, right: left + width, bottom: y + dy + font.descent };
  // A label turned about its middle turns about the middle of its box
  const cx = turned && anchor === 'middle' ? (text.left + text.right) / 2 : x;
  const cy = turned && anchor === 'middle' ? (text.top + text.bottom) / 2 : y;
  const label = turned ? turnedBox(text, angle, cx, cy) : text;
  const tick: LabelBox = {
    left: side === 'left' ? -TICK_LENGTH : 0,
    top: side === 'top' ? -TICK_LENGTH : 0,
    right: side === 'right' ? TICK_LENGTH : 0,
    bottom: side === 'bottom' ? TICK_LENGTH : 0,
  };
  const box: LabelBox = {
    left: Math.min(label.left, tick.left),
    top: Math.min(label.top, tick.top),
    right: Math.max(label.right, tick.right),
    bottom: Math.max(label.bottom, tick.bottom),
  };
  return { x, y, dy, anchor, angle, cx, cy, box };
}

/**
 * Which labels are kept, in order along an axis of a length: a label is left out when its box,
 * a tenth wider and centred on its tick, runs past either end of the axis or into the last label
 * kept. `center` is how far along the axis the tick is, from the start the values grow from.
 */
export function keptLabels(labels: Array<{ center: number; size: number }>, length: number): boolean[] {
  let lastStart = Number.POSITIVE_INFINITY;
  let lastEnd = Number.NEGATIVE_INFINITY;
  return labels.map(({ center, size }) => {
    const half = (size * FILTER_PADDING) / 2;
    const start = center - half;
    const end = center + half;
    if (end > length || start < 0 || (end >= lastStart && start <= lastEnd)) return false;
    lastStart = start;
    lastEnd = end;
    return true;
  });
}

/** The size of a box along an axis on a side: its width along a horizontal axis, else its height */
export function sizeAlong(side: AxisSide, box: LabelBox): number {
  return side === 'top' || side === 'bottom' ? box.right - box.left : box.bottom - box.top;
}

/** The room the labels take beside an axis: the deepest of their boxes and 5 pixels, rounded up */
export function labelBand(side: AxisSide, boxes: LabelBox[]): number {
  const depth = Math.max(
    0,
    ...boxes.map((box) => (side === 'top' || side === 'bottom' ? box.bottom - box.top : box.right - box.left))
  );
  return Math.ceil(depth + AXIS_PADDING);
}

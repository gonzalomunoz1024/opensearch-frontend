/* SPDX-License-Identifier: Apache-2.0 */

/*
 * An axis of a classic chart as vislib draws it (its Axis, AxisConfig, AxisLabels and AxisTitle
 * over d3's axis): the defaults it gives what a visualization leaves out, the ticks for the length
 * it gets, each label cut to a number of characters, turned, and left out where it would run past
 * an end of the axis or into the label kept before it, and the room the axis then takes beside
 * the chart: the deepest of its ticks and labels and 5 pixels, rounded up.
 */

import { LABEL_FONT, TITLE_FONT, measureText, pixels, type TextSize } from './text';

export type AxisPosition = 'left' | 'right' | 'top' | 'bottom';

export interface AxisLabelsConfig {
  show: boolean;
  rotate: number;
  filter: boolean;
  truncate: number;
}

/** What vislib makes of an axis of a visualization's params */
export interface AxisConfig {
  id: string;
  type: 'category' | 'value';
  position: AxisPosition;
  show: boolean;
  labels: AxisLabelsConfig;
  title: string;
  /** A title is drawn although the axis is not (the wiggle and silhouette modes) */
  titleShow: boolean;
  scale: {
    type: 'linear' | 'log' | 'square root';
    mode: string;
    setYExtents: boolean;
    defaultYExtents: boolean;
    boundsMargin: number;
    min?: number;
    max?: number;
    inverted: boolean;
    expandLastBucket: boolean;
  };
  style: { rangePadding: number; rangeOuterPadding: number };
  /** Pixels added to the range of the values when the chart writes values on its marks */
  padForLabels: number;
}

export interface AxisParams {
  id?: string;
  type?: string;
  position?: string;
  show?: boolean | string;
  labels?: { show?: boolean; rotate?: number | string; filter?: boolean; truncate?: number | string };
  title?: { text?: string | null; show?: boolean } | null;
  scale?: {
    type?: string;
    mode?: string;
    setYExtents?: boolean;
    defaultYExtents?: boolean;
    boundsMargin?: number | string;
    min?: number | string | null;
    max?: number | string | null;
    inverted?: boolean;
    expandLastBucket?: boolean;
  };
  style?: { rangePadding?: number; rangeOuterPadding?: number };
}

const isPosition = (value: unknown): value is AxisPosition => value === 'left' || value === 'right' || value === 'top' || value === 'bottom';

const numberOr = (value: unknown, fallback: number): number => {
  if (value === null || value === undefined || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const optionalNumber = (value: unknown): number | undefined => {
  if (value === null || value === undefined || value === '') return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
};

/**
 * An axis's settings with vislib's defaults: a horizontal axis, or one of categories, filters its
 * labels and keeps them whole; a vertical axis of values cuts them at 100 characters and keeps
 * them all, unless its scale is logarithmic; a horizontal axis of names turns its labels on their
 * side unless told otherwise. `ordinal` says whether the axis is one of names.
 */
export function axisConfig(
  args: AxisParams,
  kind: 'category' | 'value',
  options: { ordinal: boolean; title: string; valuesOnChart?: boolean }
): AxisConfig {
  const position: AxisPosition = isPosition(args.position) ? args.position : kind === 'category' ? 'bottom' : 'left';
  const horizontal = position === 'top' || position === 'bottom';
  const labels = args.labels ?? {};
  // horizontalDefaults apply to a horizontal axis and to any axis of categories
  const flatDefaults = horizontal || kind === 'category';
  let rotate = numberOr(labels.rotate, 0);
  let filter = labels.filter ?? (flatDefaults ? true : false);
  let truncate = numberOr(labels.truncate, flatDefaults ? 0 : 100);
  const scaleArgs = args.scale ?? {};
  const scaleType = scaleArgs.type === 'log' || scaleArgs.type === 'square root' ? scaleArgs.type : 'linear';
  const mode = scaleArgs.mode ?? 'normal';
  let show = args.show === undefined ? true : args.show !== false && args.show !== 'false';
  let titleShow = Boolean(args.title?.show);
  let defaultYExtents = Boolean(scaleArgs.defaultYExtents);
  if (kind === 'value') {
    if (mode === 'wiggle' || mode === 'silhouette') {
      defaultYExtents = false;
      if (!args.show) {
        show = false;
        titleShow = true;
      }
    }
    if (scaleType === 'log') filter = true;
  }
  if (horizontal && options.ordinal) {
    filter = labels.filter ?? false;
    rotate = numberOr(labels.rotate, 90);
    truncate = numberOr(labels.truncate, 100);
  }
  const titleText = args.title?.text;
  return {
    id: args.id ?? (kind === 'category' ? 'CategoryAxis-1' : 'ValueAxis-1'),
    type: kind,
    position,
    show,
    labels: { show: labels.show !== false, rotate, filter, truncate },
    title: titleText === null || titleText === undefined ? options.title : String(titleText),
    titleShow,
    scale: {
      type: scaleType,
      mode,
      setYExtents: Boolean(scaleArgs.setYExtents),
      defaultYExtents,
      boundsMargin: defaultYExtents ? numberOr(scaleArgs.boundsMargin, 0) : 0,
      min: optionalNumber(scaleArgs.min),
      max: optionalNumber(scaleArgs.max),
      inverted: scaleArgs.inverted ?? (kind === 'category' && !horizontal),
      expandLastBucket: scaleArgs.expandLastBucket ?? true,
    },
    style: {
      rangePadding: numberOr(args.style?.rangePadding, 0.1),
      rangeOuterPadding: numberOr(args.style?.rangeOuterPadding, 0),
    },
    padForLabels: options.valuesOnChart && kind === 'value' ? (horizontal ? 40 : 15) : 0,
  };
}

export const isHorizontal = (config: Pick<AxisConfig, 'position'>) => config.position === 'top' || config.position === 'bottom';

// --- Labels ---------------------------------------------------------------------------------------

const TICK_SIZE = 6;
const TICK_PADDING = 3;
const AXIS_PADDING = 5;
const FILTER_PADDING = 1.1;

/** A box from the point of a tick on the axis line, x to the right and y down */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A tick as d3 draws it and vislib turns its label */
export interface AxisTick {
  /** The value it marks, as the scale has it */
  value: number | string;
  /** How far along the axis it is */
  at: number;
  text: string;
  /** The label's own attributes, from the point of the tick */
  x: number;
  y: number;
  dy: string;
  anchor: 'start' | 'middle' | 'end';
  transform?: string;
  /** The line of the tick, to (x2, y2) */
  x2: number;
  y2: number;
  /** The box of the tick and its label together */
  box: Box;
}

/** The tick values of an axis and where they fall */
export interface AxisScaleInfo {
  /** The values to mark, in order */
  values: Array<number | string>;
  /** Where a value's tick is */
  at: (value: number | string) => number;
  /** Where the value falls on the scale: the start of its band for names */
  raw: (value: number | string) => number;
  /** The range of the scale as d3's range() gives it: the bands' starts for names */
  range: number[];
  /** The stretch the line of the axis covers */
  extent: [number, number];
}

const rotatePoint = (x: number, y: number, degrees: number, cx: number, cy: number): [number, number] => {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return [cx + (x - cx) * cos - (y - cy) * sin, cy + (x - cx) * sin + (y - cy) * cos];
};

function union(a: Box, b: Box): Box {
  const left = Math.min(a.x, b.x);
  const top = Math.min(a.y, b.y);
  const right = Math.max(a.x + a.width, b.x + b.width);
  const bottom = Math.max(a.y + a.height, b.y + b.height);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** A label cut to a number of characters, as vislib cuts them; 0 keeps it whole */
export function truncateLabel(text: string, size: number): string {
  if (!size) return text;
  if (size >= text.length) return text;
  return `${text.slice(0, size)}…`;
}

/** Where d3 puts the line and the label of a tick, and where vislib turns the label */
export function placeTick(
  position: AxisPosition,
  labels: AxisLabelsConfig,
  text: string,
  size: TextSize,
  fontSize: number
): Omit<AxisTick, 'value' | 'at' | 'text'> {
  const horizontal = position === 'top' || position === 'bottom';
  const sign = position === 'top' || position === 'left' ? -1 : 1;
  const spacing = TICK_SIZE + TICK_PADDING;
  const x = horizontal ? 0 : sign * spacing;
  const y = horizontal ? sign * spacing : 0;
  let dy = horizontal ? (sign < 0 ? '0em' : '.71em') : '.32em';
  let anchor: AxisTick['anchor'] = horizontal ? 'middle' : sign < 0 ? 'end' : 'start';
  const x2 = horizontal ? 0 : sign * TICK_SIZE;
  const y2 = horizontal ? sign * TICK_SIZE : 0;
  const line: Box = { x: Math.min(0, x2), y: Math.min(0, y2), width: Math.abs(x2), height: Math.abs(y2) };
  let transform: string | undefined;
  // A text is anchored by how far it runs; its box can reach a little past that
  const textBox = (): Box => {
    const em = parseFloat(dy) * fontSize;
    const start = anchor === 'end' ? x - size.advance : anchor === 'middle' ? x - size.advance / 2 : x;
    return { x: start + size.left, y: y + em - size.ascent, width: size.width, height: size.ascent + size.descent };
  };
  let box: Box = textBox();
  if (labels.rotate) {
    if (horizontal) anchor = 'end';
    else if (labels.rotate === 90 || labels.rotate === -90) anchor = 'middle';
    dy = horizontal ? '0.3em' : '0';
    const degrees = position === 'top' ? labels.rotate : -labels.rotate;
    const flat = textBox();
    const [cx, cy] = anchor === 'middle' ? [flat.x + flat.width / 2, flat.y + flat.height / 2] : [x, y];
    transform = `rotate(${degrees}, ${cx}, ${cy})`;
    const corners = [
      rotatePoint(flat.x, flat.y, degrees, cx, cy),
      rotatePoint(flat.x + flat.width, flat.y, degrees, cx, cy),
      rotatePoint(flat.x, flat.y + flat.height, degrees, cx, cy),
      rotatePoint(flat.x + flat.width, flat.y + flat.height, degrees, cx, cy),
    ];
    const xs = corners.map(([px]) => px);
    const ys = corners.map(([, py]) => py);
    box = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
  }
  return { x, y, dy, anchor, transform, x2, y2, box: text === '' || !labels.show ? line : union(line, box) };
}

/**
 * Which labels an axis keeps when it filters them (vislib's filterAxisLabels): in the order of
 * the ticks, a label is left out when its box, a tenth larger, would reach past either end of the
 * axis or into the last label kept. Along a vertical axis it is measured from the foot. For
 * names, the scale's range is the start of each band, and the labels are measured from where the
 * bands' starts would sit centred on the axis, as vislib measures them.
 */
export function keptTicks(
  ticks: Array<Pick<AxisTick, 'value' | 'box'>>,
  scale: Pick<AxisScaleInfo, 'raw' | 'range'>,
  horizontal: boolean,
  length: number
): boolean[] {
  const scaleWidth = Math.abs(scale.range[scale.range.length - 1] - scale.range[0]);
  const startPad = 0.5 * (length - scaleWidth);
  let lastStart = Number.POSITIVE_INFINITY;
  let lastEnd = Number.NEGATIVE_INFINITY;
  return ticks.map((tick) => {
    const center = horizontal ? startPad + scale.raw(tick.value) : length - startPad - scale.raw(tick.value);
    const half = ((horizontal ? tick.box.width : tick.box.height) * FILTER_PADDING) / 2;
    const start = center - half;
    const end = center + half;
    if (end > length || start < 0 || (end >= lastStart && start <= lastEnd)) return false;
    lastStart = start;
    lastEnd = end;
    return true;
  });
}

export interface DrawnAxis {
  ticks: AxisTick[];
  /** The line along the axis, as d3 draws it */
  path: string;
  /** How deep the axis is beside the chart: its width when it stands, its height when it lies */
  size: number;
  /** The depth before it is rounded, by which a top axis is moved */
  rawSize: number;
}

/** An axis drawn over a length: its ticks and labels, those kept, and the room it takes */
export function drawAxis(config: AxisConfig, scale: AxisScaleInfo, format: (value: number | string) => string): DrawnAxis {
  const horizontal = isHorizontal(config);
  const fontSize = pixels(LABEL_FONT.size);
  const sign = config.position === 'top' || config.position === 'left' ? -1 : 1;
  let ticks: AxisTick[] = scale.values.map((value) => {
    const text = truncateLabel(format(value), config.labels.truncate);
    const size = measureText(text, LABEL_FONT);
    return { value, at: scale.at(value), text, ...placeTick(config.position, config.labels, text, size, fontSize) };
  });
  if (config.labels.filter) {
    const length = Math.abs(scale.extent[1] - scale.extent[0]);
    const kept = keptTicks(ticks, scale, horizontal, length);
    ticks = ticks.filter((_, index) => kept[index]);
  }
  // As deep as its deepest tick with its label, as vislib measures the ticks left (adjustSize); the
  // line along the axis is not measured, so an axis with no tick left is only its padding
  const deepest = ticks.length ? Math.max(TICK_SIZE, ...ticks.map((tick) => (horizontal ? tick.box.height : tick.box.width))) : 0;
  const rawSize = deepest + AXIS_PADDING;
  const [r0, r1] = scale.extent;
  const path = horizontal
    ? `M${r0},${sign * TICK_SIZE}V0H${r1}V${sign * TICK_SIZE}`
    : `M${sign * TICK_SIZE},${r0}H0V${r1}H${sign * TICK_SIZE}`;
  return { ticks, path, size: Math.ceil(rawSize), rawSize };
}

/** The room an axis title takes across its axis: the height of its text, rounded up */
export function titleSize(text: string): number {
  if (!text) return 0;
  const size = measureText(text, TITLE_FONT);
  return Math.ceil(size.ascent + size.descent);
}

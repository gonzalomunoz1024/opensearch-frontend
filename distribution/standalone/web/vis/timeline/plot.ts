/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The chart a Timeline visualization is drawn on. OpenSearch Dashboards draws it with Flot 0.8.3
 * (MIT, Copyright (c) 2007-2014 IOLA and Ole Laursen) and its time, stack, symbol, crosshair,
 * selection and axis-label plug-ins. This is the same drawing, written again without jQuery and
 * limited to what Timeline asks of it: the same options and defaults, the same tick rules, the
 * same layout of axes, legend and labels, and the same canvas paths, so that a chart comes out
 * as it does there.
 */

// --- Colours, as Flot's colour helpers read and write them ----------------------------------------

export class Color {
  constructor(
    public r: number,
    public g: number,
    public b: number,
    public a = 1
  ) {
    this.normalize();
  }

  scale(channels: string, factor: number): Color {
    for (const channel of channels) this[channel as 'r' | 'g' | 'b' | 'a'] *= factor;
    return this.normalize();
  }

  normalize(): Color {
    const clamp = (min: number, value: number, max: number) => (value < min ? min : value > max ? max : value);
    this.r = clamp(0, Math.trunc(this.r), 255);
    this.g = clamp(0, Math.trunc(this.g), 255);
    this.b = clamp(0, Math.trunc(this.b), 255);
    this.a = clamp(0, this.a, 1);
    return this;
  }

  toString(): string {
    return this.a >= 1 ? `rgb(${[this.r, this.g, this.b].join(',')})` : `rgba(${[this.r, this.g, this.b, this.a].join(',')})`;
  }

  static parse(text: string): Color {
    let match: RegExpExecArray | null;
    const number = '([0-9]+(?:\\.[0-9]+)?)';
    if ((match = /rgb\(\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})\s*\)/.exec(text))) {
      return new Color(parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10));
    }
    if ((match = /rgba\(\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})\s*,\s*([0-9]+(?:\.[0-9]+)?)\s*\)/.exec(text))) {
      return new Color(parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10), parseFloat(match[4]));
    }
    if ((match = new RegExp(`rgb\\(\\s*${number}\\%\\s*,\\s*${number}\\%\\s*,\\s*${number}\\%\\s*\\)`).exec(text))) {
      return new Color(parseFloat(match[1]) * 2.55, parseFloat(match[2]) * 2.55, parseFloat(match[3]) * 2.55);
    }
    if ((match = new RegExp(`rgba\\(\\s*${number}\\%\\s*,\\s*${number}\\%\\s*,\\s*${number}\\%\\s*,\\s*${number}\\s*\\)`).exec(text))) {
      return new Color(parseFloat(match[1]) * 2.55, parseFloat(match[2]) * 2.55, parseFloat(match[3]) * 2.55, parseFloat(match[4]));
    }
    if ((match = /#([a-fA-F0-9]{2})([a-fA-F0-9]{2})([a-fA-F0-9]{2})/.exec(text))) {
      return new Color(parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16));
    }
    if ((match = /#([a-fA-F0-9])([a-fA-F0-9])([a-fA-F0-9])/.exec(text))) {
      return new Color(parseInt(match[1] + match[1], 16), parseInt(match[2] + match[2], 16), parseInt(match[3] + match[3], 16));
    }
    const name = text.trim().toLowerCase();
    if (name === 'transparent') return new Color(255, 255, 255, 0);
    const [r, g, b] = NAMED_COLORS[name] ?? [0, 0, 0];
    return new Color(r, g, b);
  }
}

const NAMED_COLORS: Record<string, [number, number, number]> = {
  aqua: [0, 255, 255], azure: [240, 255, 255], beige: [245, 245, 220], black: [0, 0, 0], blue: [0, 0, 255],
  brown: [165, 42, 42], cyan: [0, 255, 255], darkblue: [0, 0, 139], darkcyan: [0, 139, 139],
  darkgrey: [169, 169, 169], darkgreen: [0, 100, 0], darkkhaki: [189, 183, 107], darkmagenta: [139, 0, 139],
  darkolivegreen: [85, 107, 47], darkorange: [255, 140, 0], darkorchid: [153, 50, 204], darkred: [139, 0, 0],
  darksalmon: [233, 150, 122], darkviolet: [148, 0, 211], fuchsia: [255, 0, 255], gold: [255, 215, 0],
  green: [0, 128, 0], indigo: [75, 0, 130], khaki: [240, 230, 140], lightblue: [173, 216, 230],
  lightcyan: [224, 255, 255], lightgreen: [144, 238, 144], lightgrey: [211, 211, 211], lightpink: [255, 182, 193],
  lightyellow: [255, 255, 224], lime: [0, 255, 0], magenta: [255, 0, 255], maroon: [128, 0, 0], navy: [0, 0, 128],
  olive: [128, 128, 0], orange: [255, 165, 0], pink: [255, 192, 203], purple: [128, 0, 128], violet: [128, 0, 128],
  red: [255, 0, 0], silver: [192, 192, 192], white: [255, 255, 255], yellow: [255, 255, 0],
};

// --- Options --------------------------------------------------------------------------------------

/* Options are plain objects merged the way jQuery's deep extend merges them. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = Record<string, any>;

const isPlain = (value: unknown): value is Loose =>
  value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;

/** jQuery's `$.extend(true, target, ...sources)`: arrays and plain objects copied deeply, undefined skipped */
export function extend(target: Loose, ...sources: Array<Loose | null | undefined>): Loose {
  for (const source of sources) {
    if (source == null) continue;
    for (const key of Object.keys(source)) {
      const copy = source[key];
      const current = target[key];
      if (copy === target) continue;
      if (Array.isArray(copy)) {
        target[key] = extend(Array.isArray(current) ? current : [], copy);
      } else if (isPlain(copy)) {
        target[key] = extend(isPlain(current) ? current : {}, copy);
      } else if (copy !== undefined) {
        target[key] = copy;
      }
    }
  }
  return target;
}

function defaultOptions(): Loose {
  return {
    colors: ['#edc240', '#afd8f8', '#cb4b4b', '#4da74d', '#9440ed'],
    legend: {
      show: true,
      noColumns: 1,
      labelFormatter: null,
      labelBoxBorderColor: '#ccc',
      container: null,
      position: 'ne',
      margin: 5,
      backgroundColor: null,
      backgroundOpacity: 0.85,
      sorted: null,
    },
    xaxis: {
      show: null,
      position: 'bottom',
      mode: null,
      font: null,
      color: null,
      tickColor: null,
      min: null,
      max: null,
      autoscaleMargin: null,
      ticks: null,
      tickFormatter: null,
      labelWidth: null,
      labelHeight: null,
      reserveSpace: null,
      tickLength: null,
      tickDecimals: null,
      tickSize: null,
      minTickSize: null,
      // the time plug-in
      timezone: null,
      timeformat: null,
      twelveHourClock: false,
      monthNames: null,
    },
    yaxis: { autoscaleMargin: 0.02, position: 'left' },
    xaxes: [],
    yaxes: [],
    series: {
      points: { show: false, radius: 3, lineWidth: 2, fill: true, fillColor: '#ffffff', symbol: 'circle' },
      lines: { lineWidth: 2, fill: false, fillColor: null, steps: false },
      bars: {
        show: false,
        lineWidth: 2,
        barWidth: 1,
        fill: true,
        fillColor: null,
        align: 'left',
        horizontal: false,
        zero: true,
      },
      shadowSize: 3,
      highlightColor: null,
      // the stack plug-in
      stack: null,
    },
    grid: {
      show: true,
      aboveData: false,
      color: '#545454',
      backgroundColor: null,
      borderColor: null,
      tickColor: null,
      margin: 0,
      labelMargin: 5,
      axisMargin: 8,
      borderWidth: 2,
      minBorderMargin: null,
      markings: null,
      markingsColor: '#f4f4f4',
      markingsLineWidth: 2,
      clickable: false,
      hoverable: false,
      autoHighlight: true,
      mouseActiveRadius: 10,
    },
    interaction: { redrawOverlayInterval: 1000 / 60 },
    // the crosshair, selection and axis-label plug-ins
    crosshair: { mode: null, color: 'rgba(170, 0, 0, 0.80)', lineWidth: 1 },
    selection: { mode: null, color: '#e8cfac', shape: 'round', minSize: 5 },
    axisLabels: { show: true },
  };
}

// --- The drawing surface ----------------------------------------------------------------------------

interface TextInfo {
  width: number;
  height: number;
  lines: Array<{ text: string; width: number; height: number }>;
  font: { definition: string; color: string };
}

/**
 * A canvas sized to its container, with the layers Flot keeps for text. Timeline loads Flot's
 * canvas plug-in, so the text of the axes is written on the canvas, in the font the layer's CSS
 * gives an element of its class.
 */
class Surface {
  element: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  pixelRatio: number;
  width = 0;
  height = 0;
  private textContainer: HTMLDivElement | null = null;
  private layers = new Map<string, HTMLDivElement>();
  private cache = new Map<string, TextInfo>();
  private fonts = new Map<string, { lineHeight: number; size: number; definition: string; color: string }>();
  private texts = new Map<string, Array<{ info: TextInfo; lines: Array<[number, number]> }>>();

  constructor(
    className: string,
    container: HTMLElement
  ) {
    const element = document.createElement('canvas');
    element.className = className;
    Object.assign(element.style, { direction: 'ltr', position: 'absolute', left: '0px', top: '0px' });
    container.appendChild(element);
    this.element = element;
    const context = element.getContext('2d');
    if (!context) throw new Error('Canvas is not available.');
    this.context = context;
    this.pixelRatio = window.devicePixelRatio || 1;
    this.resize(container.clientWidth, container.clientHeight);
  }

  resize(width: number, height: number) {
    if (width <= 0 || height <= 0) {
      throw new Error(`Invalid dimensions for plot, width = ${width}, height = ${height}`);
    }
    if (this.width !== width) {
      this.element.width = width * this.pixelRatio;
      this.element.style.width = `${width}px`;
      this.width = width;
    }
    if (this.height !== height) {
      this.element.height = height * this.pixelRatio;
      this.element.style.height = `${height}px`;
      this.height = height;
    }
    this.context.restore();
    this.context.save();
    this.context.scale(this.pixelRatio, this.pixelRatio);
  }

  clear() {
    this.context.clearRect(0, 0, this.width, this.height);
  }

  layer(classes: string): HTMLDivElement {
    let layer = this.layers.get(classes);
    if (layer) return layer;
    if (!this.textContainer) {
      const text = document.createElement('div');
      text.className = 'flot-text';
      Object.assign(text.style, {
        position: 'absolute',
        top: '0px',
        left: '0px',
        bottom: '0px',
        right: '0px',
        fontSize: 'smaller',
        color: '#545454',
      });
      this.element.after(text);
      this.textContainer = text;
    }
    layer = document.createElement('div');
    layer.className = classes;
    Object.assign(layer.style, { position: 'absolute', top: '0px', left: '0px', bottom: '0px', right: '0px' });
    this.textContainer.appendChild(layer);
    this.layers.set(classes, layer);
    return layer;
  }

  private font(layer: string, classes: string) {
    const key = `${layer}\u0000${classes}`;
    let font = this.fonts.get(key);
    if (font) return font;
    const probe = document.createElement('div');
    probe.innerHTML = '&nbsp;';
    probe.style.position = 'absolute';
    probe.className = classes;
    this.layer(layer).appendChild(probe);
    const style = getComputedStyle(probe);
    const lineHeight = probe.getBoundingClientRect().height;
    probe.style.lineHeight = '1';
    const size = probe.getBoundingClientRect().height;
    font = {
      lineHeight,
      size,
      definition: `${style.fontStyle} ${style.fontVariant} ${style.fontWeight} ${size}px ${style.fontFamily}`,
      color: style.color,
    };
    probe.remove();
    this.fonts.set(key, font);
    return font;
  }

  /** The size of a text as the canvas writes it */
  textInfo(layer: string, text: string, classes: string): TextInfo {
    const key = `${layer}\u0000${classes}\u0000${text}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const font = this.font(layer, classes);
    const info: TextInfo = { width: 0, height: 0, lines: [], font: { definition: font.definition, color: font.color } };
    const context = this.context;
    context.save();
    context.font = font.definition;
    for (const line of text.replace(/<br ?\/?>|\r\n|\r/g, '\n').split('\n')) {
      const measured = context.measureText(line);
      info.width = Math.max(measured.width, info.width);
      info.height += font.lineHeight;
      info.lines.push({ text: line, width: measured.width, height: font.lineHeight });
    }
    context.restore();
    this.cache.set(key, info);
    return info;
  }

  clearText(layer: string) {
    this.texts.set(layer, []);
  }

  addText(layer: string, x: number, y: number, text: string, classes: string, halign?: string, valign?: string) {
    const info = this.textInfo(layer, text, classes);
    y += info.height / info.lines.length / 2;
    if (valign === 'middle') y = Math.round(y - info.height / 2);
    else if (valign === 'bottom') y = Math.round(y - info.height);
    else y = Math.round(y);
    const lines: Array<[number, number]> = [];
    for (const line of info.lines) {
      if (halign === 'center') lines.push([Math.round(x - line.width / 2), y]);
      else if (halign === 'right') lines.push([Math.round(x - line.width), y]);
      else lines.push([Math.round(x), y]);
      y += line.height;
    }
    const list = this.texts.get(layer) ?? [];
    list.push({ info, lines });
    this.texts.set(layer, list);
  }

  /** Writes the text of every layer on the canvas */
  render() {
    const context = this.context;
    context.save();
    context.textBaseline = 'middle';
    for (const list of this.texts.values()) {
      for (const { info, lines } of list) {
        context.fillStyle = info.font.color;
        context.font = info.font.definition;
        info.lines.forEach((line, i) => context.fillText(line.text, lines[i][0], lines[i][1]));
      }
    }
    context.restore();
  }
}

// --- Axes and series --------------------------------------------------------------------------------

export interface Tick {
  v: number;
  label: string;
}

export interface Axis {
  n: number;
  direction: 'x' | 'y';
  options: Loose;
  used: boolean;
  show: boolean;
  reserveSpace: boolean;
  datamin: number | null;
  datamax: number | null;
  min: number;
  max: number;
  delta: number;
  scale: number;
  tickSize: number | [number, string];
  tickDecimals: number;
  ticks: Tick[];
  labelWidth: number;
  labelHeight: number;
  box: { left: number; top: number; width: number; height: number; padding: number };
  position: string;
  tickLength: number | 'full';
  innermost: boolean;
  tickGenerator?: (axis: Axis) => number[];
  tickFormatter: (value: number, axis: Axis) => string;
  p2c: (value: number) => number;
  c2p: (value: number) => number;
}

type Symbol = (ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, shadow: boolean) => void;

export interface Datapoints {
  points: Array<number | null>;
  pointsize: number;
  format: Array<{ x?: boolean; y?: boolean; number: boolean; required: boolean; defaultValue?: number; autoscale?: boolean }>;
}

/** A series once Flot has filled in its options */
export interface PlotSeries extends Loose {
  data: Array<[number, number | null] | null>;
  label?: string;
  color: string;
  lines: Loose;
  points: Loose;
  bars: Loose;
  shadowSize: number;
  stack: unknown;
  xaxis: Axis;
  yaxis: Axis;
  datapoints: Datapoints;
}

export interface CursorPosition {
  x: number;
  y: number;
  pageX: number;
  pageY: number;
  [axis: string]: number;
}

export interface Ranges {
  [axis: string]: { from: number; to: number };
}

export interface PlotEvents {
  hover?: (position: CursorPosition, event: MouseEvent) => void;
  selected?: (ranges: Ranges) => void;
}

const floorInBase = (n: number, base: number) => base * Math.floor(n / base);

// --- The time plug-in ------------------------------------------------------------------------------

const TIME_UNIT: Record<string, number> = {
  second: 1000,
  minute: 60 * 1000,
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
  quarter: 3 * 30 * 24 * 60 * 60 * 1000,
  year: 365.2425 * 24 * 60 * 60 * 1000,
};

const BASE_SPEC: Array<[number, string]> = [
  [1, 'second'], [2, 'second'], [5, 'second'], [10, 'second'], [30, 'second'],
  [1, 'minute'], [2, 'minute'], [5, 'minute'], [10, 'minute'], [30, 'minute'],
  [1, 'hour'], [2, 'hour'], [4, 'hour'], [8, 'hour'], [12, 'hour'],
  [1, 'day'], [2, 'day'], [3, 'day'],
  [0.25, 'month'], [0.5, 'month'], [1, 'month'], [2, 'month'],
];
const SPEC_MONTHS = BASE_SPEC.concat([[3, 'month'], [6, 'month'], [1, 'year']]);
const SPEC_QUARTERS = BASE_SPEC.concat([[1, 'quarter'], [2, 'quarter'], [1, 'year']]);

/** A date read and set in the browser's time zone, or in UTC: the time plug-in's `dateGenerator` */
interface TimeDate {
  getTime(): number;
  setTime(value: number): void;
  get(part: 'FullYear' | 'Month' | 'Date' | 'Hours' | 'Minutes' | 'Seconds' | 'Milliseconds' | 'Day'): number;
  set(part: 'FullYear' | 'Month' | 'Date' | 'Hours' | 'Minutes' | 'Seconds' | 'Milliseconds', value: number): void;
}

function timeDate(ts: number, timezone: unknown): TimeDate {
  const date = new Date(ts);
  const local = timezone === 'browser';
  return {
    getTime: () => date.getTime(),
    setTime: (value) => void date.setTime(value),
    get: (part) => (date as unknown as Record<string, () => number>)[`get${local ? '' : 'UTC'}${part}`](),
    set: (part, value) => void (date as unknown as Record<string, (v: number) => number>)[`set${local ? '' : 'UTC'}${part}`](value),
  };
}

export function timeTickGenerator(axis: Axis): number[] {
  const opts = axis.options;
  const ticks: number[] = [];
  const d = timeDate(axis.min, opts.timezone);
  let minSize = 0;
  const spec =
    (opts.tickSize && opts.tickSize[1] === 'quarter') || (opts.minTickSize && opts.minTickSize[1] === 'quarter')
      ? SPEC_QUARTERS
      : SPEC_MONTHS;
  if (opts.minTickSize != null) {
    minSize = typeof opts.tickSize === 'number' ? opts.tickSize : opts.minTickSize[0] * TIME_UNIT[opts.minTickSize[1]];
  }
  let i = 0;
  for (; i < spec.length - 1; ++i) {
    if (
      axis.delta < (spec[i][0] * TIME_UNIT[spec[i][1]] + spec[i + 1][0] * TIME_UNIT[spec[i + 1][1]]) / 2 &&
      spec[i][0] * TIME_UNIT[spec[i][1]] >= minSize
    ) {
      break;
    }
  }
  let size = spec[i][0];
  let unit = spec[i][1];
  if (unit === 'year') {
    if (opts.minTickSize != null && opts.minTickSize[1] === 'year') {
      size = Math.floor(opts.minTickSize[0]);
    } else {
      const magn = Math.pow(10, Math.floor(Math.log(axis.delta / TIME_UNIT.year) / Math.LN10));
      const norm = axis.delta / TIME_UNIT.year / magn;
      size = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7.5 ? 5 : 10) * magn;
    }
    if (size < 1) size = 1;
  }
  axis.tickSize = opts.tickSize || [size, unit];
  const tickSize = (axis.tickSize as [number, string])[0];
  unit = (axis.tickSize as [number, string])[1];
  const step = tickSize * TIME_UNIT[unit];

  if (unit === 'second') d.set('Seconds', floorInBase(d.get('Seconds'), tickSize));
  else if (unit === 'minute') d.set('Minutes', floorInBase(d.get('Minutes'), tickSize));
  else if (unit === 'hour') d.set('Hours', floorInBase(d.get('Hours'), tickSize));
  else if (unit === 'month') d.set('Month', floorInBase(d.get('Month'), tickSize));
  else if (unit === 'quarter') d.set('Month', 3 * floorInBase(d.get('Month') / 3, tickSize));
  else if (unit === 'year') d.set('FullYear', floorInBase(d.get('FullYear'), tickSize));

  d.set('Milliseconds', 0);
  if (step >= TIME_UNIT.minute) d.set('Seconds', 0);
  if (step >= TIME_UNIT.hour) d.set('Minutes', 0);
  if (step >= TIME_UNIT.day) d.set('Hours', 0);
  if (step >= TIME_UNIT.day * 4) d.set('Date', 1);
  if (step >= TIME_UNIT.month * 2) d.set('Month', floorInBase(d.get('Month'), 3));
  if (step >= TIME_UNIT.quarter * 2) d.set('Month', floorInBase(d.get('Month'), 6));
  if (step >= TIME_UNIT.year) d.set('Month', 0);

  let carry = 0;
  let v = Number.NaN;
  let prev: number;
  do {
    prev = v;
    v = d.getTime();
    ticks.push(v);
    if (unit === 'month' || unit === 'quarter') {
      if (tickSize < 1) {
        d.set('Date', 1);
        const start = d.getTime();
        d.set('Month', d.get('Month') + (unit === 'quarter' ? 3 : 1));
        const end = d.getTime();
        d.setTime(v + carry * TIME_UNIT.hour + (end - start) * tickSize);
        carry = d.get('Hours');
        d.set('Hours', 0);
      } else {
        d.set('Month', d.get('Month') + tickSize * (unit === 'quarter' ? 3 : 1));
      }
    } else if (unit === 'year') {
      d.set('FullYear', d.get('FullYear') + tickSize);
    } else {
      d.setTime(v + step);
    }
  } while (v < axis.max && v !== prev);
  return ticks;
}

// --- The symbol plug-in ------------------------------------------------------------------------------

const SYMBOLS: Record<string, Symbol> = {
  square(ctx, x, y, radius) {
    const size = (radius * Math.sqrt(Math.PI)) / 2;
    ctx.rect(x - size, y - size, size + size, size + size);
  },
  diamond(ctx, x, y, radius) {
    const size = radius * Math.sqrt(Math.PI / 2);
    ctx.moveTo(x - size, y);
    ctx.lineTo(x, y - size);
    ctx.lineTo(x + size, y);
    ctx.lineTo(x, y + size);
    ctx.lineTo(x - size, y);
  },
  triangle(ctx, x, y, radius, shadow) {
    const size = radius * Math.sqrt((2 * Math.PI) / Math.sin(Math.PI / 3));
    const height = size * Math.sin(Math.PI / 3);
    ctx.moveTo(x - size / 2, y + height / 2);
    ctx.lineTo(x + size / 2, y + height / 2);
    if (!shadow) {
      ctx.lineTo(x, y - height / 2);
      ctx.lineTo(x - size / 2, y + height / 2);
    }
  },
  cross(ctx, x, y, radius) {
    const size = (radius * Math.sqrt(Math.PI)) / 2;
    ctx.moveTo(x - size, y - size);
    ctx.lineTo(x + size, y + size);
    ctx.moveTo(x - size, y + size);
    ctx.lineTo(x + size, y - size);
  },
};

// --- The stack plug-in --------------------------------------------------------------------------------

export function stackData(all: PlotSeries[], s: PlotSeries, datapoints: Datapoints) {
  if (s.stack == null || s.stack === false) return;
  let other: PlotSeries | null = null;
  for (const candidate of all) {
    if (candidate === s) break;
    if (candidate.stack === s.stack) other = candidate;
  }
  if (!other) return;

  const ps = datapoints.pointsize;
  const points = datapoints.points as number[];
  const otherps = other.datapoints.pointsize;
  const otherpoints = other.datapoints.points as number[];
  const newpoints: Array<number | null> = [];
  const withlines = s.lines.show;
  const horizontal = s.bars.horizontal;
  const withbottom = ps > 2 && (horizontal ? datapoints.format[2].x : datapoints.format[2].y);
  const withsteps = withlines && s.lines.steps;
  let fromgap = true;
  const keyOffset = horizontal ? 1 : 0;
  const accumulateOffset = horizontal ? 0 : 1;
  let i = 0;
  let j = 0;
  let l: number;
  let m: number;

  for (;;) {
    if (i >= points.length) break;
    l = newpoints.length;
    if (points[i] == null) {
      for (m = 0; m < ps; ++m) newpoints.push(points[i + m]);
      i += ps;
    } else if (j >= otherpoints.length) {
      if (!withlines) for (m = 0; m < ps; ++m) newpoints.push(points[i + m]);
      i += ps;
    } else if (otherpoints[j] == null) {
      for (m = 0; m < ps; ++m) newpoints.push(null);
      fromgap = true;
      j += otherps;
    } else {
      const px = points[i + keyOffset];
      const py = points[i + accumulateOffset];
      const qx = otherpoints[j + keyOffset];
      const qy = otherpoints[j + accumulateOffset];
      let bottom = 0;
      if (px === qx) {
        for (m = 0; m < ps; ++m) newpoints.push(points[i + m]);
        (newpoints[l + accumulateOffset] as number) += qy;
        bottom = qy;
        i += ps;
        j += otherps;
      } else if (px > qx) {
        if (withlines && i > 0 && points[i - ps] != null) {
          const intery = py + ((points[i - ps + accumulateOffset] - py) * (qx - px)) / (points[i - ps + keyOffset] - px);
          newpoints.push(qx);
          newpoints.push(intery + qy);
          for (m = 2; m < ps; ++m) newpoints.push(points[i + m]);
          bottom = qy;
        }
        j += otherps;
      } else {
        if (fromgap && withlines) {
          i += ps;
          continue;
        }
        for (m = 0; m < ps; ++m) newpoints.push(points[i + m]);
        if (withlines && j > 0 && otherpoints[j - otherps] != null) {
          bottom = qy + ((otherpoints[j - otherps + accumulateOffset] - qy) * (px - qx)) / (otherpoints[j - otherps + keyOffset] - qx);
        }
        (newpoints[l + accumulateOffset] as number) += bottom;
        i += ps;
      }
      fromgap = false;
      if (l !== newpoints.length && withbottom) (newpoints[l + 2] as number) += bottom;
    }
    if (
      withsteps &&
      l !== newpoints.length &&
      l > 0 &&
      newpoints[l] != null &&
      newpoints[l] !== newpoints[l - ps] &&
      newpoints[l + 1] !== newpoints[l - ps + 1]
    ) {
      for (m = 0; m < ps; ++m) newpoints[l + ps + m] = newpoints[l + m];
      newpoints[l + 1] = newpoints[l - ps + 1];
    }
  }
  datapoints.points = newpoints;
}

// --- The plot ---------------------------------------------------------------------------------------------

export class Plot {
  private options: Loose;
  private series: PlotSeries[] = [];
  private xaxes: Axis[] = [];
  private yaxes: Axis[] = [];
  private surface: Surface;
  private overlay: Surface;
  private ctx: CanvasRenderingContext2D;
  private octx: CanvasRenderingContext2D;
  private plotOffset = { left: 0, right: 0, top: 0, bottom: 0 };
  private plotWidth = 0;
  private plotHeight = 0;
  private redrawTimeout: ReturnType<typeof setTimeout> | null = null;
  private crosshair = { x: -1, y: -1 };
  private selection = { first: { x: -1, y: -1 }, second: { x: -1, y: -1 }, show: false, active: false };
  private axisLabels = new Map<string, { width: number; height: number; labelWidth: number; labelHeight: number }>();
  private cleanups: Array<() => void> = [];

  constructor(
    private placeholder: HTMLElement,
    data: Loose[],
    options: Loose,
    private events: PlotEvents = {}
  ) {
    this.options = defaultOptions();
    this.parseOptions(options);
    placeholder.style.padding = '0px';
    for (const child of [...placeholder.children]) {
      if (!child.classList.contains('flot-overlay') && !child.classList.contains('flot-base')) child.remove();
    }
    placeholder.querySelectorAll('canvas').forEach((canvas) => canvas.remove());
    if (getComputedStyle(placeholder).position === 'static') placeholder.style.position = 'relative';
    this.surface = new Surface('flot-base', placeholder);
    this.overlay = new Surface('flot-overlay', placeholder);
    this.ctx = this.surface.context;
    this.octx = this.overlay.context;
    this.setData(data);
    this.setupGrid();
    this.draw();
    this.bindEvents();
  }

  // public functions, as Flot names them
  getData = () => this.series;
  getOptions = () => this.options;
  width = () => this.plotWidth;
  height = () => this.plotHeight;
  getPlotOffset = () => this.plotOffset;
  getXAxes = () => this.xaxes;
  getYAxes = () => this.yaxes;
  getAxes(): Record<string, Axis> {
    const result: Record<string, Axis> = {};
    for (const axis of this.allAxes()) result[`${axis.direction}${axis.n !== 1 ? axis.n : ''}axis`] = axis;
    return result;
  }

  offset() {
    const rect = this.overlay.element.getBoundingClientRect();
    return { left: rect.left + window.scrollX + this.plotOffset.left, top: rect.top + window.scrollY + this.plotOffset.top };
  }

  setCrosshair(pos: { x?: number; [key: string]: number | undefined } | null) {
    if (!pos) this.crosshair.x = -1;
    else {
      const o = this.p2c(pos);
      this.crosshair.x = Math.max(0, Math.min(o.left ?? 0, this.plotWidth));
      this.crosshair.y = Math.max(0, Math.min(o.top ?? 0, this.plotHeight));
    }
    this.triggerRedrawOverlay();
  }

  clearCrosshair() {
    this.setCrosshair(null);
  }

  destroy() {
    if (this.redrawTimeout) clearTimeout(this.redrawTimeout);
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups = [];
    this.placeholder.replaceChildren();
  }

  private parseOptions(opts: Loose) {
    const options = this.options;
    extend(options, opts);
    if (opts && opts.colors) options.colors = opts.colors;
    if (options.xaxis.color == null) options.xaxis.color = Color.parse(options.grid.color).scale('a', 0.22).toString();
    if (options.yaxis.color == null) options.yaxis.color = Color.parse(options.grid.color).scale('a', 0.22).toString();
    if (options.xaxis.tickColor == null) options.xaxis.tickColor = options.grid.tickColor || options.xaxis.color;
    if (options.yaxis.tickColor == null) options.yaxis.tickColor = options.grid.tickColor || options.yaxis.color;
    if (options.grid.borderColor == null) options.grid.borderColor = options.grid.color;
    if (options.grid.tickColor == null) options.grid.tickColor = Color.parse(options.grid.color).scale('a', 0.22).toString();

    for (const [list, base] of [
      [options.xaxes, options.xaxis],
      [options.yaxes, options.yaxis],
    ] as Array<[Loose[], Loose]>) {
      const count = list.length || 1;
      for (let i = 0; i < count; ++i) {
        let axisOptions = list[i];
        if (axisOptions && !axisOptions.tickColor) axisOptions.tickColor = axisOptions.color;
        axisOptions = extend({}, base, axisOptions);
        list[i] = axisOptions;
      }
    }
    if (options.lines) extend(options.series.lines, options.lines);
    if (options.points) extend(options.series.points, options.points);
    if (options.bars) extend(options.series.bars, options.bars);
    if (options.shadowSize != null) options.series.shadowSize = options.shadowSize;
    if (options.highlightColor != null) options.series.highlightColor = options.highlightColor;

    for (let i = 0; i < options.xaxes.length; ++i) this.getOrCreateAxis(this.xaxes, i + 1).options = options.xaxes[i];
    for (let i = 0; i < options.yaxes.length; ++i) this.getOrCreateAxis(this.yaxes, i + 1).options = options.yaxes[i];

    // the time plug-in gives axes in time mode its tick generator and formatter
    for (const axis of this.allAxes()) {
      if (axis.options.mode === 'time') {
        axis.tickGenerator = timeTickGenerator;
        axis.tickFormatter = (v, ax) => String(new Date(v).getTime() - ax.min);
      }
    }
  }

  private getOrCreateAxis(axes: Axis[], number: number): Axis {
    if (!axes[number - 1]) {
      axes[number - 1] = {
        n: number,
        direction: axes === this.xaxes ? 'x' : 'y',
        options: extend({}, axes === this.xaxes ? this.options.xaxis : this.options.yaxis),
      } as Axis;
    }
    return axes[number - 1];
  }

  private allAxes(): Axis[] {
    return this.xaxes.concat(this.yaxes).filter(Boolean);
  }

  private axisNumber(obj: Loose, coord: 'x' | 'y'): number {
    let a = obj[`${coord}axis`];
    if (typeof a === 'object' && a !== null) a = a.n;
    return typeof a === 'number' ? a : 1;
  }

  private setData(d: Loose[]) {
    this.series = d.map((item) => {
      const s = extend({}, this.options.series) as PlotSeries;
      if (item.data != null) {
        const data = item.data;
        extend(s, { ...item, data: undefined });
        s.data = data;
      } else {
        s.data = item as unknown as PlotSeries['data'];
      }
      return s;
    });
    this.fillInSeriesOptions();
    this.processData();
  }

  private fillInSeriesOptions() {
    const series = this.series;
    let neededColors = series.length;
    let maxIndex = -1;
    for (const s of series) {
      const sc = s.color as unknown;
      if (sc != null) {
        neededColors--;
        if (typeof sc === 'number' && sc > maxIndex) maxIndex = sc;
      }
    }
    if (neededColors <= maxIndex) neededColors = maxIndex + 1;
    const colors: Color[] = [];
    const pool: string[] = this.options.colors;
    let variation = 0;
    for (let i = 0; i < neededColors; i++) {
      const c = Color.parse(pool[i % pool.length] || '#666');
      if (i % pool.length === 0 && i) {
        if (variation >= 0) variation = variation < 0.5 ? -variation - 0.2 : 0;
        else variation = -variation;
      }
      colors[i] = c.scale('rgb', 1 + variation);
    }
    let colori = 0;
    for (const s of series) {
      if (s.color == null) {
        s.color = colors[colori].toString();
        ++colori;
      } else if (typeof (s.color as unknown) === 'number') {
        s.color = colors[s.color as unknown as number].toString();
      }
      if (s.lines.show == null) {
        let show = true;
        for (const key of Object.keys(s)) {
          if (s[key] && s[key].show) {
            show = false;
            break;
          }
        }
        if (show) s.lines.show = true;
      }
      if (s.lines.zero == null) s.lines.zero = !!s.lines.fill;
      s.xaxis = this.getOrCreateAxis(this.xaxes, this.axisNumber(s, 'x'));
      s.yaxis = this.getOrCreateAxis(this.yaxes, this.axisNumber(s, 'y'));
    }
  }

  private processData() {
    const topSentry = Number.POSITIVE_INFINITY;
    const bottomSentry = Number.NEGATIVE_INFINITY;
    const fakeInfinity = Number.MAX_VALUE;
    const updateAxis = (axis: Axis, min: number, max: number) => {
      if (min < (axis.datamin as number) && min !== -fakeInfinity) axis.datamin = min;
      if (max > (axis.datamax as number) && max !== fakeInfinity) axis.datamax = max;
    };
    for (const axis of this.allAxes()) {
      axis.datamin = topSentry;
      axis.datamax = bottomSentry;
      axis.used = false;
    }
    for (const s of this.series) {
      s.datapoints = { points: [] } as unknown as Datapoints;
    }
    for (const s of this.series) {
      const data = s.data;
      let format = s.datapoints.format;
      if (!format) {
        format = [
          { x: true, number: true, required: true },
          { y: true, number: true, required: true },
        ];
        if (s.bars.show || (s.lines.show && s.lines.fill)) {
          const autoscale = !!((s.bars.show && s.bars.zero) || (s.lines.show && s.lines.zero));
          format.push({ y: true, number: true, required: false, defaultValue: 0, autoscale });
          if (s.bars.horizontal) {
            delete format[format.length - 1].y;
            format[format.length - 1].x = true;
          }
        }
        s.datapoints.format = format;
      }
      s.datapoints.pointsize = format.length;
      const ps = s.datapoints.pointsize;
      const points = s.datapoints.points;
      const insertSteps = s.lines.show && s.lines.steps;
      s.xaxis.used = s.yaxis.used = true;

      for (let j = 0, k = 0; j < data.length; ++j, k += ps) {
        const p = data[j] as Array<unknown> | null;
        let nullify = p == null;
        if (!nullify && p) {
          for (let m = 0; m < ps; ++m) {
            let val = p[m] as number | null | undefined;
            const f = format[m];
            if (f) {
              if (f.number && val != null) {
                val = +val;
                if (isNaN(val)) val = null;
                else if (val === Infinity) val = fakeInfinity;
                else if (val === -Infinity) val = -fakeInfinity;
              }
              if (val == null) {
                if (f.required) nullify = true;
                if (f.defaultValue != null) val = f.defaultValue;
              }
            }
            points[k + m] = val ?? null;
          }
        }
        if (nullify) {
          for (let m = 0; m < ps; ++m) {
            const val = points[k + m];
            if (val != null) {
              const f = format[m];
              if (f.autoscale !== false) {
                if (f.x) updateAxis(s.xaxis, val, val);
                if (f.y) updateAxis(s.yaxis, val, val);
              }
            }
            points[k + m] = null;
          }
        } else if (
          insertSteps &&
          k > 0 &&
          points[k - ps] != null &&
          points[k - ps] !== points[k] &&
          points[k - ps + 1] !== points[k + 1]
        ) {
          for (let m = 0; m < ps; ++m) points[k + ps + m] = points[k + m];
          points[k + 1] = points[k - ps + 1];
          k += ps;
        }
      }
    }

    for (const s of this.series) {
      // the stack and symbol plug-ins
      stackData(this.series, s, s.datapoints);
      if (typeof s.points.symbol === 'string' && SYMBOLS[s.points.symbol]) s.points.symbol = SYMBOLS[s.points.symbol];
    }

    for (const s of this.series) {
      const points = s.datapoints.points;
      const ps = s.datapoints.pointsize;
      const format = s.datapoints.format;
      let xmin = topSentry;
      let ymin = topSentry;
      let xmax = bottomSentry;
      let ymax = bottomSentry;
      for (let j = 0; j < points.length; j += ps) {
        if (points[j] == null) continue;
        for (let m = 0; m < ps; ++m) {
          const val = points[j + m] as number;
          const f = format[m];
          if (!f || f.autoscale === false || val === fakeInfinity || val === -fakeInfinity) continue;
          if (f.x) {
            if (val < xmin) xmin = val;
            if (val > xmax) xmax = val;
          }
          if (f.y) {
            if (val < ymin) ymin = val;
            if (val > ymax) ymax = val;
          }
        }
      }
      if (s.bars.show) {
        const delta = s.bars.align === 'left' ? 0 : s.bars.align === 'right' ? -s.bars.barWidth : -s.bars.barWidth / 2;
        if (s.bars.horizontal) {
          ymin += delta;
          ymax += delta + s.bars.barWidth;
        } else {
          xmin += delta;
          xmax += delta + s.bars.barWidth;
        }
      }
      updateAxis(s.xaxis, xmin, xmax);
      updateAxis(s.yaxis, ymin, ymax);
    }
    for (const axis of this.allAxes()) {
      if (axis.datamin === topSentry) axis.datamin = null;
      if (axis.datamax === bottomSentry) axis.datamax = null;
    }
  }

  private setTransformationHelpers(axis: Axis) {
    let s: number;
    let m: number;
    if (axis.direction === 'x') {
      s = axis.scale = this.plotWidth / Math.abs(axis.max - axis.min);
      m = Math.min(axis.max, axis.min);
    } else {
      s = axis.scale = this.plotHeight / Math.abs(axis.max - axis.min);
      s = -s;
      m = Math.max(axis.max, axis.min);
    }
    axis.p2c = (p) => (p - m) * s;
    axis.c2p = (c) => m + c / s;
  }

  private layerOf(axis: Axis) {
    const legacy = `${axis.direction}Axis ${axis.direction}${axis.n}Axis`;
    return `flot-${axis.direction}-axis flot-${axis.direction}${axis.n}-axis ${legacy}`;
  }

  private measureTickLabels(axis: Axis) {
    const opts = axis.options;
    const ticks = axis.ticks || [];
    let labelWidth = opts.labelWidth || 0;
    let labelHeight = opts.labelHeight || 0;
    const layer = this.layerOf(axis);
    for (const t of ticks) {
      if (!t.label) continue;
      const info = this.surface.textInfo(layer, t.label, 'flot-tick-label tickLabel');
      labelWidth = Math.max(labelWidth, info.width);
      labelHeight = Math.max(labelHeight, info.height);
    }
    axis.labelWidth = opts.labelWidth || labelWidth;
    axis.labelHeight = opts.labelHeight || labelHeight;
  }

  private allocateAxisBoxFirstPhase(axis: Axis) {
    let lw = axis.labelWidth;
    let lh = axis.labelHeight;
    const pos = axis.options.position;
    const isXAxis = axis.direction === 'x';
    let tickLength = axis.options.tickLength;
    let axisMargin = this.options.grid.axisMargin;
    let padding = this.options.grid.labelMargin;
    let innermost = true;
    let outermost = true;
    let first = true;
    let found = false;
    for (const a of isXAxis ? this.xaxes : this.yaxes) {
      if (a && (a.show || a.reserveSpace)) {
        if (a === axis) found = true;
        else if (a.options.position === pos) {
          if (found) outermost = false;
          else innermost = false;
        }
        if (!found) first = false;
      }
    }
    if (outermost) axisMargin = 0;
    if (tickLength == null) tickLength = first ? 'full' : 5;
    if (!isNaN(+tickLength)) padding += +tickLength;
    const surface = this.surface;
    const plotOffset = this.plotOffset;
    if (isXAxis) {
      lh += padding;
      if (pos === 'bottom') {
        plotOffset.bottom += lh + axisMargin;
        axis.box = { top: surface.height - plotOffset.bottom, height: lh } as Axis['box'];
      } else {
        axis.box = { top: plotOffset.top + axisMargin, height: lh } as Axis['box'];
        plotOffset.top += lh + axisMargin;
      }
    } else {
      lw += padding;
      if (pos === 'left') {
        axis.box = { left: plotOffset.left + axisMargin, width: lw } as Axis['box'];
        plotOffset.left += lw + axisMargin;
      } else {
        plotOffset.right += lw + axisMargin;
        axis.box = { left: surface.width - plotOffset.right, width: lw } as Axis['box'];
      }
    }
    axis.position = pos;
    axis.tickLength = tickLength;
    axis.box.padding = padding;
    axis.innermost = innermost;
  }

  private allocateAxisBoxSecondPhase(axis: Axis) {
    const { surface, plotOffset } = this;
    if (axis.direction === 'x') {
      axis.box.left = plotOffset.left - axis.labelWidth / 2;
      axis.box.width = surface.width - plotOffset.left - plotOffset.right + axis.labelWidth;
    } else {
      axis.box.top = plotOffset.top - axis.labelHeight / 2;
      axis.box.height = surface.height - plotOffset.bottom - plotOffset.top + axis.labelHeight;
    }
  }

  private adjustLayoutForThingsStickingOut() {
    let minMargin = this.options.grid.minBorderMargin;
    if (minMargin == null) {
      minMargin = 0;
      for (const s of this.series) minMargin = Math.max(minMargin, 2 * (s.points.radius + s.points.lineWidth / 2));
    }
    const margins = { left: minMargin, right: minMargin, top: minMargin, bottom: minMargin };
    for (const axis of this.allAxes()) {
      if (axis.reserveSpace && axis.ticks && axis.ticks.length) {
        if (axis.direction === 'x') {
          margins.left = Math.max(margins.left, axis.labelWidth / 2);
          margins.right = Math.max(margins.right, axis.labelWidth / 2);
        } else {
          margins.bottom = Math.max(margins.bottom, axis.labelHeight / 2);
          margins.top = Math.max(margins.top, axis.labelHeight / 2);
        }
      }
    }
    const plotOffset = this.plotOffset;
    plotOffset.left = Math.ceil(Math.max(margins.left, plotOffset.left));
    plotOffset.right = Math.ceil(Math.max(margins.right, plotOffset.right));
    plotOffset.top = Math.ceil(Math.max(margins.top, plotOffset.top));
    plotOffset.bottom = Math.ceil(Math.max(margins.bottom, plotOffset.bottom));
  }

  private setupGrid() {
    const axes = this.allAxes();
    const showGrid = this.options.grid.show;
    const plotOffset = this.plotOffset;
    for (const side of ['left', 'right', 'top', 'bottom'] as const) {
      const margin = this.options.grid.margin || 0;
      plotOffset[side] = typeof margin === 'number' ? margin : margin[side] || 0;
      const bw = this.options.grid.borderWidth;
      plotOffset[side] += showGrid ? (typeof bw === 'object' ? bw[side] : bw) : 0;
    }
    for (const axis of axes) {
      const opts = axis.options;
      axis.show = opts.show == null ? axis.used : opts.show;
      axis.reserveSpace = opts.reserveSpace == null ? axis.show : opts.reserveSpace;
      this.setRange(axis);
    }
    if (showGrid) {
      const allocated = axes.filter((axis) => axis.show || axis.reserveSpace);
      for (const axis of allocated) {
        this.setupTickGeneration(axis);
        this.setTicks(axis);
        this.snapRangeToTicks(axis, axis.ticks);
        this.measureTickLabels(axis);
        // the axis-label plug-in makes room for an axis' own label beside its tick labels
        const label = this.axisLabels.get(this.axisName(axis));
        if (label) {
          axis.labelWidth += label.width;
          axis.labelHeight += label.height;
        }
      }
      for (let i = allocated.length - 1; i >= 0; --i) this.allocateAxisBoxFirstPhase(allocated[i]);
      this.adjustLayoutForThingsStickingOut();
      for (const axis of allocated) this.allocateAxisBoxSecondPhase(axis);
    }
    this.plotWidth = this.surface.width - plotOffset.left - plotOffset.right;
    this.plotHeight = this.surface.height - plotOffset.bottom - plotOffset.top;
    for (const axis of axes) this.setTransformationHelpers(axis);
    if (showGrid) this.drawAxisLabels();
    this.insertLegend();
  }

  private setRange(axis: Axis) {
    const opts = axis.options;
    let min = +(opts.min != null ? opts.min : (axis.datamin as number));
    let max = +(opts.max != null ? opts.max : (axis.datamax as number));
    const delta = max - min;
    if (delta === 0.0) {
      const widen = max === 0 ? 1 : 0.01;
      if (opts.min == null) min -= widen;
      if (opts.max == null || opts.min != null) max += widen;
    } else {
      const margin = opts.autoscaleMargin;
      if (margin != null) {
        if (opts.min == null) {
          min -= delta * margin;
          if (min < 0 && axis.datamin != null && axis.datamin >= 0) min = 0;
        }
        if (opts.max == null) {
          max += delta * margin;
          if (max > 0 && axis.datamax != null && axis.datamax <= 0) max = 0;
        }
      }
    }
    axis.min = min;
    axis.max = max;
  }

  private setupTickGeneration(axis: Axis) {
    const opts = axis.options;
    const noTicks =
      typeof opts.ticks === 'number' && opts.ticks > 0
        ? opts.ticks
        : 0.3 * Math.sqrt(axis.direction === 'x' ? this.surface.width : this.surface.height);
    const delta = (axis.max - axis.min) / noTicks;
    let dec = -Math.floor(Math.log(delta) / Math.LN10);
    const maxDec = opts.tickDecimals;
    if (maxDec != null && dec > maxDec) dec = maxDec;
    const magn = Math.pow(10, -dec);
    const norm = delta / magn;
    let size: number;
    if (norm < 1.5) size = 1;
    else if (norm < 3) {
      size = 2;
      if (norm > 2.25 && (maxDec == null || dec + 1 <= maxDec)) {
        size = 2.5;
        ++dec;
      }
    } else if (norm < 7.5) size = 5;
    else size = 10;
    size *= magn;
    if (opts.minTickSize != null && size < opts.minTickSize) size = opts.minTickSize;
    axis.delta = delta;
    axis.tickDecimals = Math.max(0, maxDec != null ? maxDec : dec);
    axis.tickSize = opts.tickSize || size;

    if (!axis.tickGenerator) {
      axis.tickGenerator = (ax) => {
        const ticks: number[] = [];
        const step = ax.tickSize as number;
        const start = floorInBase(ax.min, step);
        let i = 0;
        let v = Number.NaN;
        let prev: number;
        do {
          prev = v;
          v = start + i * step;
          ticks.push(v);
          ++i;
        } while (v < ax.max && v !== prev);
        return ticks;
      };
      axis.tickFormatter = (value, ax) => {
        const factor = ax.tickDecimals ? Math.pow(10, ax.tickDecimals) : 1;
        const formatted = `${Math.round(value * factor) / factor}`;
        if (ax.tickDecimals != null) {
          const decimal = formatted.indexOf('.');
          const precision = decimal === -1 ? 0 : formatted.length - decimal - 1;
          if (precision < ax.tickDecimals) {
            return (precision ? formatted : `${formatted}.`) + `${factor}`.substr(1, ax.tickDecimals - precision);
          }
        }
        return formatted;
      };
    }
    if (typeof opts.tickFormatter === 'function') {
      const formatter = opts.tickFormatter;
      axis.tickFormatter = (v, ax) => `${formatter(v, ax)}`;
    }
  }

  private setTicks(axis: Axis) {
    const oticks = axis.options.ticks;
    let ticks: Array<number | [number, string]> = [];
    if (oticks == null || (typeof oticks === 'number' && oticks > 0)) ticks = (axis.tickGenerator as (a: Axis) => number[])(axis);
    else if (oticks) ticks = typeof oticks === 'function' ? oticks(axis) : oticks;
    axis.ticks = [];
    for (const t of ticks) {
      let label: string | null = null;
      let v: number;
      if (typeof t === 'object') {
        v = +t[0];
        if (t.length > 1) label = t[1];
      } else v = +t;
      if (label == null) label = axis.tickFormatter(v, axis);
      if (!isNaN(v)) axis.ticks.push({ v, label });
    }
  }

  private snapRangeToTicks(axis: Axis, ticks: Tick[]) {
    if (axis.options.autoscaleMargin && ticks.length > 0) {
      if (axis.options.min == null) axis.min = Math.min(axis.min, ticks[0].v);
      if (axis.options.max == null && ticks.length > 1) axis.max = Math.max(axis.max, ticks[ticks.length - 1].v);
    }
  }

  private draw() {
    this.surface.clear();
    const grid = this.options.grid;
    if (grid.show && grid.backgroundColor) this.drawBackground();
    if (grid.show && !grid.aboveData) this.drawGrid();
    for (const s of this.series) this.drawSeries(s);
    if (grid.show && grid.aboveData) this.drawGrid();
    this.surface.render();
    this.drawAxisTitles();
    this.triggerRedrawOverlay();
  }

  private drawBackground() {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(this.plotOffset.left, this.plotOffset.top);
    ctx.fillStyle = this.options.grid.backgroundColor;
    ctx.fillRect(0, 0, this.plotWidth, this.plotHeight);
    ctx.restore();
  }

  private drawGrid() {
    const ctx = this.ctx;
    const { plotOffset, plotWidth, plotHeight } = this;
    ctx.save();
    ctx.translate(plotOffset.left, plotOffset.top);
    let bw = this.options.grid.borderWidth;
    for (const axis of this.allAxes()) {
      const box = axis.box;
      const t = axis.tickLength;
      let x = 0;
      let y = 0;
      if (!axis.show || axis.ticks.length === 0) continue;
      ctx.lineWidth = 1;
      if (axis.direction === 'x') {
        x = 0;
        y = t === 'full' ? (axis.position === 'top' ? 0 : plotHeight) : box.top - plotOffset.top + (axis.position === 'top' ? box.height : 0);
      } else {
        y = 0;
        x = t === 'full' ? (axis.position === 'left' ? 0 : plotWidth) : box.left - plotOffset.left + (axis.position === 'left' ? box.width : 0);
      }
      if (!axis.innermost) {
        ctx.strokeStyle = axis.options.color;
        ctx.beginPath();
        let xoff = 0;
        let yoff = 0;
        if (axis.direction === 'x') xoff = plotWidth + 1;
        else yoff = plotHeight + 1;
        if (ctx.lineWidth === 1) {
          if (axis.direction === 'x') y = Math.floor(y) + 0.5;
          else x = Math.floor(x) + 0.5;
        }
        ctx.moveTo(x, y);
        ctx.lineTo(x + xoff, y + yoff);
        ctx.stroke();
      }
      ctx.strokeStyle = axis.options.tickColor;
      ctx.beginPath();
      for (const tick of axis.ticks) {
        const v = tick.v;
        let xoff = 0;
        let yoff = 0;
        if (
          isNaN(v) ||
          v < axis.min ||
          v > axis.max ||
          (t === 'full' && ((typeof bw === 'object' && bw[axis.position] > 0) || bw > 0) && (v === axis.min || v === axis.max))
        ) {
          continue;
        }
        if (axis.direction === 'x') {
          x = axis.p2c(v);
          yoff = t === 'full' ? -plotHeight : t;
          if (axis.position === 'top') yoff = -yoff;
        } else {
          y = axis.p2c(v);
          xoff = t === 'full' ? -plotWidth : t;
          if (axis.position === 'left') xoff = -xoff;
        }
        if (ctx.lineWidth === 1) {
          if (axis.direction === 'x') x = Math.floor(x) + 0.5;
          else y = Math.floor(y) + 0.5;
        }
        ctx.moveTo(x, y);
        ctx.lineTo(x + xoff, y + yoff);
      }
      ctx.stroke();
    }
    if (bw) {
      const bc = this.options.grid.borderColor;
      if (typeof bw === 'object' || typeof bc === 'object') {
        if (typeof bw !== 'object') bw = { top: bw, right: bw, bottom: bw, left: bw };
        const colors = typeof bc === 'object' ? bc : { top: bc, right: bc, bottom: bc, left: bc };
        const line = (width: number, color: string, from: [number, number], to: [number, number]) => {
          if (width <= 0) return;
          ctx.strokeStyle = color;
          ctx.lineWidth = width;
          ctx.beginPath();
          ctx.moveTo(...from);
          ctx.lineTo(...to);
          ctx.stroke();
        };
        line(bw.top, colors.top, [0 - bw.left, 0 - bw.top / 2], [plotWidth, 0 - bw.top / 2]);
        line(bw.right, colors.right, [plotWidth + bw.right / 2, 0 - bw.top], [plotWidth + bw.right / 2, plotHeight]);
        line(bw.bottom, colors.bottom, [plotWidth + bw.right, plotHeight + bw.bottom / 2], [0, plotHeight + bw.bottom / 2]);
        line(bw.left, colors.left, [0 - bw.left / 2, plotHeight + bw.bottom], [0 - bw.left / 2, 0]);
      } else {
        ctx.lineWidth = bw;
        ctx.strokeStyle = bc;
        ctx.strokeRect(-bw / 2, -bw / 2, plotWidth + bw, plotHeight + bw);
      }
    }
    ctx.restore();
  }

  private drawAxisLabels() {
    for (const axis of this.allAxes()) {
      const box = axis.box;
      const layer = this.layerOf(axis);
      this.surface.clearText(layer);
      if (!axis.show || axis.ticks.length === 0) continue;
      for (const tick of axis.ticks) {
        if (!tick.label || tick.v < axis.min || tick.v > axis.max) continue;
        let x: number;
        let y: number;
        let halign: string | undefined;
        let valign: string | undefined;
        if (axis.direction === 'x') {
          halign = 'center';
          x = this.plotOffset.left + axis.p2c(tick.v);
          if (axis.position === 'bottom') y = box.top + box.padding;
          else {
            y = box.top + box.height - box.padding;
            valign = 'bottom';
          }
        } else {
          valign = 'middle';
          y = this.plotOffset.top + axis.p2c(tick.v);
          if (axis.position === 'left') {
            x = box.left + box.width - box.padding;
            halign = 'right';
          } else x = box.left + box.padding;
        }
        this.surface.addText(layer, x, y, tick.label, 'flot-tick-label tickLabel', halign, valign);
      }
    }
  }

  private axisName(axis: Axis) {
    return `${axis.direction}${axis.n !== 1 ? axis.n : ''}axis`;
  }

  /**
   * The axis-label plug-in: an axis' own label, an HTML element with the class `axisLabels`. Its
   * first drawing measures the labels and lays the chart out again with room for them.
   */
  private drawAxisTitles() {
    if (!this.options.axisLabels.show) return;
    const pending = this.allAxes().filter((axis) => axis.options.axisLabel && axis.show);
    this.placeholder.querySelectorAll(':scope > .axisLabels').forEach((element) => element.remove());
    if (pending.length === 0) return;
    if (this.axisLabels.size === 0) {
      for (const axis of pending) {
        const opts = axis.options;
        const probe = document.createElement('div');
        probe.className = 'axisLabels';
        probe.style.position = 'absolute';
        probe.textContent = String(opts.axisLabel);
        this.placeholder.appendChild(probe);
        const style = getComputedStyle(probe);
        const labelWidth = probe.offsetWidth + (parseFloat(style.marginLeft) || 0) + (parseFloat(style.marginRight) || 0);
        const labelHeight = probe.offsetHeight + (parseFloat(style.marginTop) || 0) + (parseFloat(style.marginBottom) || 0);
        probe.remove();
        const padding = opts.axisLabelPadding === undefined ? 2 : opts.axisLabelPadding;
        const side = axis.position === 'left' || axis.position === 'right';
        this.axisLabels.set(this.axisName(axis), {
          labelWidth,
          labelHeight,
          width: side ? labelHeight + padding : 0,
          height: side ? 0 : labelHeight + padding,
        });
      }
      this.setupGrid();
      this.draw();
      return;
    }
    for (const axis of pending) {
      const opts = axis.options;
      const name = this.axisName(axis);
      const label = this.axisLabels.get(name);
      if (!label) continue;
      const box = axis.box;
      const element = document.createElement('div');
      element.className = `axisLabels ${name}Label`;
      element.style.position = 'absolute';
      element.textContent = String(opts.axisLabel);
      if (opts.axisLabelColour) element.style.color = opts.axisLabelColour;
      // Upstream hands the browser a transform it cannot read, so the label stays where it is
      // laid out: at the top left of the chart. That is kept.
      this.placeholder.appendChild(element);
      void box;
    }
  }

  private drawSeries(s: PlotSeries) {
    if (s.lines.show) this.drawSeriesLines(s);
    if (s.bars.show) this.drawSeriesBars(s);
    if (s.points.show) this.drawSeriesPoints(s);
  }

  private drawSeriesLines(series: PlotSeries) {
    const ctx = this.ctx;
    const plotLine = (datapoints: Datapoints, xoffset: number, yoffset: number, axisx: Axis, axisy: Axis) => {
      const points = datapoints.points as number[];
      const ps = datapoints.pointsize;
      let prevx: number | null = null;
      let prevy: number | null = null;
      ctx.beginPath();
      for (let i = ps; i < points.length; i += ps) {
        let x1 = points[i - ps];
        let y1 = points[i - ps + 1];
        let x2 = points[i];
        let y2 = points[i + 1];
        if (x1 == null || x2 == null) continue;
        if (y1 <= y2 && y1 < axisy.min) {
          if (y2 < axisy.min) continue;
          x1 = ((axisy.min - y1) / (y2 - y1)) * (x2 - x1) + x1;
          y1 = axisy.min;
        } else if (y2 <= y1 && y2 < axisy.min) {
          if (y1 < axisy.min) continue;
          x2 = ((axisy.min - y1) / (y2 - y1)) * (x2 - x1) + x1;
          y2 = axisy.min;
        }
        if (y1 >= y2 && y1 > axisy.max) {
          if (y2 > axisy.max) continue;
          x1 = ((axisy.max - y1) / (y2 - y1)) * (x2 - x1) + x1;
          y1 = axisy.max;
        } else if (y2 >= y1 && y2 > axisy.max) {
          if (y1 > axisy.max) continue;
          x2 = ((axisy.max - y1) / (y2 - y1)) * (x2 - x1) + x1;
          y2 = axisy.max;
        }
        if (x1 <= x2 && x1 < axisx.min) {
          if (x2 < axisx.min) continue;
          y1 = ((axisx.min - x1) / (x2 - x1)) * (y2 - y1) + y1;
          x1 = axisx.min;
        } else if (x2 <= x1 && x2 < axisx.min) {
          if (x1 < axisx.min) continue;
          y2 = ((axisx.min - x1) / (x2 - x1)) * (y2 - y1) + y1;
          x2 = axisx.min;
        }
        if (x1 >= x2 && x1 > axisx.max) {
          if (x2 > axisx.max) continue;
          y1 = ((axisx.max - x1) / (x2 - x1)) * (y2 - y1) + y1;
          x1 = axisx.max;
        } else if (x2 >= x1 && x2 > axisx.max) {
          if (x1 > axisx.max) continue;
          y2 = ((axisx.max - x1) / (x2 - x1)) * (y2 - y1) + y1;
          x2 = axisx.max;
        }
        if (x1 !== prevx || y1 !== prevy) ctx.moveTo(axisx.p2c(x1) + xoffset, axisy.p2c(y1) + yoffset);
        prevx = x2;
        prevy = y2;
        ctx.lineTo(axisx.p2c(x2) + xoffset, axisy.p2c(y2) + yoffset);
      }
      ctx.stroke();
    };

    const plotLineArea = (datapoints: Datapoints, axisx: Axis, axisy: Axis) => {
      const points = datapoints.points as number[];
      let ps = datapoints.pointsize;
      const bottom = Math.min(Math.max(0, axisy.min), axisy.max);
      let i = 0;
      let areaOpen = false;
      let ypos = 1;
      let segmentStart = 0;
      let segmentEnd = 0;
      for (;;) {
        if (ps > 0 && i > points.length + ps) break;
        i += ps;
        let x1 = points[i - ps];
        let y1 = points[i - ps + ypos];
        let x2 = points[i];
        let y2 = points[i + ypos];
        if (areaOpen) {
          if (ps > 0 && x1 != null && x2 == null) {
            segmentEnd = i;
            ps = -ps;
            ypos = 2;
            continue;
          }
          if (ps < 0 && i === segmentStart + ps) {
            ctx.fill();
            areaOpen = false;
            ps = -ps;
            ypos = 1;
            i = segmentStart = segmentEnd + ps;
            continue;
          }
        }
        if (x1 == null || x2 == null) continue;
        if (x1 <= x2 && x1 < axisx.min) {
          if (x2 < axisx.min) continue;
          y1 = ((axisx.min - x1) / (x2 - x1)) * (y2 - y1) + y1;
          x1 = axisx.min;
        } else if (x2 <= x1 && x2 < axisx.min) {
          if (x1 < axisx.min) continue;
          y2 = ((axisx.min - x1) / (x2 - x1)) * (y2 - y1) + y1;
          x2 = axisx.min;
        }
        if (x1 >= x2 && x1 > axisx.max) {
          if (x2 > axisx.max) continue;
          y1 = ((axisx.max - x1) / (x2 - x1)) * (y2 - y1) + y1;
          x1 = axisx.max;
        } else if (x2 >= x1 && x2 > axisx.max) {
          if (x1 > axisx.max) continue;
          y2 = ((axisx.max - x1) / (x2 - x1)) * (y2 - y1) + y1;
          x2 = axisx.max;
        }
        if (!areaOpen) {
          ctx.beginPath();
          ctx.moveTo(axisx.p2c(x1), axisy.p2c(bottom));
          areaOpen = true;
        }
        if (y1 >= axisy.max && y2 >= axisy.max) {
          ctx.lineTo(axisx.p2c(x1), axisy.p2c(axisy.max));
          ctx.lineTo(axisx.p2c(x2), axisy.p2c(axisy.max));
          continue;
        } else if (y1 <= axisy.min && y2 <= axisy.min) {
          ctx.lineTo(axisx.p2c(x1), axisy.p2c(axisy.min));
          ctx.lineTo(axisx.p2c(x2), axisy.p2c(axisy.min));
          continue;
        }
        const x1old = x1;
        const x2old = x2;
        if (y1 <= y2 && y1 < axisy.min && y2 >= axisy.min) {
          x1 = ((axisy.min - y1) / (y2 - y1)) * (x2 - x1) + x1;
          y1 = axisy.min;
        } else if (y2 <= y1 && y2 < axisy.min && y1 >= axisy.min) {
          x2 = ((axisy.min - y1) / (y2 - y1)) * (x2 - x1) + x1;
          y2 = axisy.min;
        }
        if (y1 >= y2 && y1 > axisy.max && y2 <= axisy.max) {
          x1 = ((axisy.max - y1) / (y2 - y1)) * (x2 - x1) + x1;
          y1 = axisy.max;
        } else if (y2 >= y1 && y2 > axisy.max && y1 <= axisy.max) {
          x2 = ((axisy.max - y1) / (y2 - y1)) * (x2 - x1) + x1;
          y2 = axisy.max;
        }
        if (x1 !== x1old) ctx.lineTo(axisx.p2c(x1old), axisy.p2c(y1));
        ctx.lineTo(axisx.p2c(x1), axisy.p2c(y1));
        ctx.lineTo(axisx.p2c(x2), axisy.p2c(y2));
        if (x2 !== x2old) {
          ctx.lineTo(axisx.p2c(x2), axisy.p2c(y2));
          ctx.lineTo(axisx.p2c(x2old), axisy.p2c(y2));
        }
      }
    };

    ctx.save();
    ctx.translate(this.plotOffset.left, this.plotOffset.top);
    ctx.lineJoin = 'round';
    const lw = series.lines.lineWidth;
    const sw = series.shadowSize;
    if (lw > 0 && sw > 0) {
      ctx.lineWidth = sw;
      ctx.strokeStyle = 'rgba(0,0,0,0.1)';
      const angle = Math.PI / 18;
      plotLine(series.datapoints, Math.sin(angle) * (lw / 2 + sw / 2), Math.cos(angle) * (lw / 2 + sw / 2), series.xaxis, series.yaxis);
      ctx.lineWidth = sw / 2;
      plotLine(series.datapoints, Math.sin(angle) * (lw / 2 + sw / 4), Math.cos(angle) * (lw / 2 + sw / 4), series.xaxis, series.yaxis);
    }
    ctx.lineWidth = lw;
    ctx.strokeStyle = series.color;
    const fillStyle = this.getFillStyle(series.lines, series.color, 0, this.plotHeight);
    if (fillStyle) {
      ctx.fillStyle = fillStyle;
      plotLineArea(series.datapoints, series.xaxis, series.yaxis);
    }
    if (lw > 0) plotLine(series.datapoints, 0, 0, series.xaxis, series.yaxis);
    ctx.restore();
  }

  private drawSeriesPoints(series: PlotSeries) {
    const ctx = this.ctx;
    const plotPoints = (
      datapoints: Datapoints,
      radius: number,
      fillStyle: string | CanvasGradient | null,
      offset: number,
      shadow: boolean,
      axisx: Axis,
      axisy: Axis,
      symbol: string | Symbol
    ) => {
      const points = datapoints.points;
      const ps = datapoints.pointsize;
      for (let i = 0; i < points.length; i += ps) {
        let x = points[i];
        let y = points[i + 1];
        if (x == null || x < axisx.min || x > axisx.max || (y as number) < axisy.min || (y as number) > axisy.max) continue;
        ctx.beginPath();
        x = axisx.p2c(x);
        y = axisy.p2c(y as number) + offset;
        if (symbol === 'circle') ctx.arc(x, y, radius, 0, shadow ? Math.PI : Math.PI * 2, false);
        else if (typeof symbol === 'function') symbol(ctx, x, y, radius, shadow);
        ctx.closePath();
        if (fillStyle) {
          ctx.fillStyle = fillStyle;
          ctx.fill();
        }
        ctx.stroke();
      }
    };
    ctx.save();
    ctx.translate(this.plotOffset.left, this.plotOffset.top);
    let lw = series.points.lineWidth;
    const sw = series.shadowSize;
    const radius = series.points.radius;
    const symbol = series.points.symbol;
    if (lw === 0) lw = 0.0001;
    if (lw > 0 && sw > 0) {
      const w = sw / 2;
      ctx.lineWidth = w;
      ctx.strokeStyle = 'rgba(0,0,0,0.1)';
      plotPoints(series.datapoints, radius, null, w + w / 2, true, series.xaxis, series.yaxis, symbol);
      ctx.strokeStyle = 'rgba(0,0,0,0.2)';
      plotPoints(series.datapoints, radius, null, w / 2, true, series.xaxis, series.yaxis, symbol);
    }
    ctx.lineWidth = lw;
    ctx.strokeStyle = series.color;
    plotPoints(series.datapoints, radius, this.getFillStyle(series.points, series.color), 0, false, series.xaxis, series.yaxis, symbol);
    ctx.restore();
  }

  private drawBar(
    x: number,
    y: number,
    b: number,
    barLeft: number,
    barRight: number,
    fillStyleCallback: ((bottom: number, top: number) => string | CanvasGradient | null) | null,
    axisx: Axis,
    axisy: Axis,
    c: CanvasRenderingContext2D,
    horizontal: boolean,
    lineWidth: number
  ) {
    let left: number;
    let right: number;
    let bottom: number;
    let top: number;
    let drawLeft: boolean;
    let drawRight: boolean;
    let drawTop: boolean;
    let drawBottom: boolean;
    if (horizontal) {
      drawBottom = drawRight = drawTop = true;
      drawLeft = false;
      left = b;
      right = x;
      top = y + barLeft;
      bottom = y + barRight;
      if (right < left) {
        [left, right] = [right, left];
        drawLeft = true;
        drawRight = false;
      }
    } else {
      drawLeft = drawRight = drawTop = true;
      drawBottom = false;
      left = x + barLeft;
      right = x + barRight;
      bottom = b;
      top = y;
      if (top < bottom) {
        [top, bottom] = [bottom, top];
        drawBottom = true;
        drawTop = false;
      }
    }
    if (right < axisx.min || left > axisx.max || top < axisy.min || bottom > axisy.max) return;
    if (left < axisx.min) {
      left = axisx.min;
      drawLeft = false;
    }
    if (right > axisx.max) {
      right = axisx.max;
      drawRight = false;
    }
    if (bottom < axisy.min) {
      bottom = axisy.min;
      drawBottom = false;
    }
    if (top > axisy.max) {
      top = axisy.max;
      drawTop = false;
    }
    left = axisx.p2c(left);
    bottom = axisy.p2c(bottom);
    right = axisx.p2c(right);
    top = axisy.p2c(top);
    if (fillStyleCallback) {
      const style = fillStyleCallback(bottom, top);
      if (style) c.fillStyle = style;
      c.fillRect(left, top, right - left, bottom - top);
    }
    if (lineWidth > 0 && (drawLeft || drawRight || drawTop || drawBottom)) {
      c.beginPath();
      c.moveTo(left, bottom);
      if (drawLeft) c.lineTo(left, top);
      else c.moveTo(left, top);
      if (drawTop) c.lineTo(right, top);
      else c.moveTo(right, top);
      if (drawRight) c.lineTo(right, bottom);
      else c.moveTo(right, bottom);
      if (drawBottom) c.lineTo(left, bottom);
      else c.moveTo(left, bottom);
      c.stroke();
    }
  }

  private barLeft(series: PlotSeries): number {
    return series.bars.align === 'left' ? 0 : series.bars.align === 'right' ? -series.bars.barWidth : -series.bars.barWidth / 2;
  }

  private drawSeriesBars(series: PlotSeries) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(this.plotOffset.left, this.plotOffset.top);
    ctx.lineWidth = series.bars.lineWidth;
    ctx.strokeStyle = series.color;
    const barLeft = this.barLeft(series);
    const fill = series.bars.fill
      ? (bottom: number, top: number) => this.getFillStyle(series.bars, series.color, bottom, top)
      : null;
    const points = series.datapoints.points;
    const ps = series.datapoints.pointsize;
    for (let i = 0; i < points.length; i += ps) {
      if (points[i] == null) continue;
      this.drawBar(
        points[i] as number,
        points[i + 1] as number,
        points[i + 2] as number,
        barLeft,
        barLeft + series.bars.barWidth,
        fill,
        series.xaxis,
        series.yaxis,
        ctx,
        series.bars.horizontal,
        series.bars.lineWidth
      );
    }
    ctx.restore();
  }

  private getFillStyle(filloptions: Loose, seriesColor: string, bottom?: number, top?: number): string | CanvasGradient | null {
    const fill = filloptions.fill;
    if (!fill) return null;
    if (filloptions.fillColor) return this.getColorOrGradient(filloptions.fillColor, bottom ?? 0, top ?? 0, seriesColor);
    const c = Color.parse(seriesColor);
    c.a = typeof fill === 'number' ? fill : 0.4;
    c.normalize();
    return c.toString();
  }

  private getColorOrGradient(spec: unknown, bottom: number, top: number, defaultColor: string): string | CanvasGradient {
    if (typeof spec === 'string') return spec;
    const gradient = this.ctx.createLinearGradient(0, top, 0, bottom);
    const colors = ((spec as Loose).colors ?? []) as Array<string | { brightness?: number; opacity?: number }>;
    colors.forEach((c, i) => {
      let color: string;
      if (typeof c !== 'string') {
        let co = Color.parse(defaultColor);
        if (c.brightness != null) co = co.scale('rgb', c.brightness);
        if (c.opacity != null) co.a *= c.opacity;
        color = co.toString();
      } else color = c;
      gradient.addColorStop(i / (colors.length - 1), color);
    });
    return gradient;
  }

  private insertLegend() {
    this.placeholder.querySelectorAll(':scope > .legend').forEach((element) => element.remove());
    const legend = this.options.legend;
    if (!legend.show) return;
    const fragments: string[] = [];
    const entries: Array<{ label: string; color: string }> = [];
    let rowStarted = false;
    const lf = legend.labelFormatter;
    for (const s of this.series) {
      if (s.label) {
        const label = lf ? lf(s.label, s) : s.label;
        if (label) entries.push({ label, color: s.color });
      }
    }
    if (legend.sorted) {
      if (typeof legend.sorted === 'function') entries.sort(legend.sorted);
      else if (legend.sorted === 'reverse') entries.reverse();
      else {
        const ascending = legend.sorted !== 'descending';
        entries.sort((a, b) => (a.label === b.label ? 0 : a.label < b.label !== ascending ? 1 : -1));
      }
    }
    entries.forEach((entry, i) => {
      if (i % legend.noColumns === 0) {
        if (rowStarted) fragments.push('</tr>');
        fragments.push('<tr>');
        rowStarted = true;
      }
      fragments.push(
        `<td class="legendColorBox"><div style="border:1px solid ${legend.labelBoxBorderColor};padding:1px"><div style="width:4px;height:0;border:5px solid ${entry.color};overflow:hidden"></div></div></td>` +
          `<td class="legendLabel" data-test-subj="flotLegendLabel">${entry.label}</td>`
      );
    });
    if (rowStarted) fragments.push('</tr>');
    if (fragments.length === 0) return;
    const table = `<table style="font-size:smaller;color:${this.options.grid.color}">${fragments.join('')}</table>`;
    let pos = '';
    const p = String(legend.position);
    let m = legend.margin;
    if (m[0] == null) m = [m, m];
    if (p.charAt(0) === 'n') pos += `top:${m[1] + this.plotOffset.top}px;`;
    else if (p.charAt(0) === 's') pos += `bottom:${m[1] + this.plotOffset.bottom}px;`;
    if (p.charAt(1) === 'e') pos += `right:${m[0] + this.plotOffset.right}px;`;
    else if (p.charAt(1) === 'w') pos += `left:${m[0] + this.plotOffset.left}px;`;
    const wrapper = document.createElement('div');
    wrapper.className = 'legend';
    wrapper.innerHTML = table.replace('style="', `style="position:absolute;${pos};`);
    this.placeholder.appendChild(wrapper);
    if (legend.backgroundOpacity !== 0.0) {
      let c = legend.backgroundColor;
      if (c == null) {
        c = this.options.grid.backgroundColor;
        const parsed = c && typeof c === 'string' ? Color.parse(c) : Color.parse(backgroundOf(wrapper));
        parsed.a = 1;
        c = parsed.toString();
      }
      const inner = wrapper.firstElementChild as HTMLElement;
      const background = document.createElement('div');
      background.setAttribute(
        'style',
        `position:absolute;width:${inner.offsetWidth}px;height:${inner.offsetHeight}px;${pos}background-color:${c};`
      );
      background.textContent = ' ';
      background.style.opacity = String(legend.backgroundOpacity);
      wrapper.prepend(background);
    }
  }

  // --- Interaction --------------------------------------------------------------------------------

  private p2c(pos: { [key: string]: number | undefined }) {
    const res: { left?: number; top?: number } = {};
    for (const axis of this.xaxes) {
      if (axis && axis.used) {
        let key = `x${axis.n}`;
        if (pos[key] == null && axis.n === 1) key = 'x';
        if (pos[key] != null) {
          res.left = axis.p2c(pos[key] as number);
          break;
        }
      }
    }
    for (const axis of this.yaxes) {
      if (axis && axis.used) {
        let key = `y${axis.n}`;
        if (pos[key] == null && axis.n === 1) key = 'y';
        if (pos[key] != null) {
          res.top = axis.p2c(pos[key] as number);
          break;
        }
      }
    }
    return res;
  }

  private c2p(pos: { left: number; top: number }): Record<string, number> {
    const res: Record<string, number> = {};
    for (const axis of this.xaxes) if (axis && axis.used) res[`x${axis.n}`] = axis.c2p(pos.left);
    for (const axis of this.yaxes) if (axis && axis.used) res[`y${axis.n}`] = axis.c2p(pos.top);
    if (res.x1 !== undefined) res.x = res.x1;
    if (res.y1 !== undefined) res.y = res.y1;
    return res;
  }

  private bindEvents() {
    const holder = this.overlay.element;
    const listen = <K extends keyof HTMLElementEventMap>(
      target: HTMLElement | Document,
      type: K,
      handler: (event: HTMLElementEventMap[K]) => void
    ) => {
      target.addEventListener(type, handler as EventListener);
      this.cleanups.push(() => target.removeEventListener(type, handler as EventListener));
    };
    const options = this.options;
    if (options.grid.hoverable) {
      listen(holder, 'mousemove', (event) => this.triggerHover(event));
      listen(holder, 'mouseleave', (event) => this.triggerHover(event));
    }
    if (options.crosshair.mode) {
      listen(holder, 'mouseout', () => {
        if (this.crosshair.x !== -1) {
          this.crosshair.x = -1;
          this.triggerRedrawOverlay();
        }
      });
      listen(holder, 'mousemove', (event) => {
        if (this.getSelection()) {
          this.crosshair.x = -1;
          return;
        }
        const offset = this.offset();
        this.crosshair.x = Math.max(0, Math.min(event.pageX - offset.left, this.plotWidth));
        this.crosshair.y = Math.max(0, Math.min(event.pageY - offset.top, this.plotHeight));
        this.triggerRedrawOverlay();
      });
    }
    if (options.selection.mode != null) {
      listen(holder, 'mousemove', (event) => {
        if (this.selection.active) this.updateSelection(event);
      });
      listen(holder, 'mousedown', (event) => {
        if (event.button !== 0) return;
        (document.body as HTMLElement).focus();
        this.setSelectionPos(this.selection.first, event);
        this.selection.active = true;
        const onUp = (up: MouseEvent) => {
          document.removeEventListener('mouseup', onUp);
          this.selection.active = false;
          this.updateSelection(up);
          if (this.selectionIsSane()) {
            const ranges = this.getSelection();
            if (ranges) this.events.selected?.(ranges);
          }
        };
        document.addEventListener('mouseup', onUp);
        this.cleanups.push(() => document.removeEventListener('mouseup', onUp));
        event.preventDefault();
      });
    }
  }

  private triggerHover(event: MouseEvent) {
    const rect = this.overlay.element.getBoundingClientRect();
    const canvasX = event.clientX - rect.left - this.plotOffset.left;
    const canvasY = event.clientY - rect.top - this.plotOffset.top;
    const pos = this.c2p({ left: canvasX, top: canvasY }) as CursorPosition;
    pos.pageX = event.pageX;
    pos.pageY = event.pageY;
    this.events.hover?.(pos, event);
  }

  private setSelectionPos(pos: { x: number; y: number }, event: MouseEvent) {
    const rect = this.placeholder.getBoundingClientRect();
    const clamp = (min: number, value: number, max: number) => (value < min ? min : value > max ? max : value);
    pos.x = clamp(0, event.clientX - rect.left - this.plotOffset.left, this.plotWidth);
    pos.y = clamp(0, event.clientY - rect.top - this.plotOffset.top, this.plotHeight);
    const mode = this.options.selection.mode;
    if (mode === 'y') pos.x = pos === this.selection.first ? 0 : this.plotWidth;
    if (mode === 'x') pos.y = pos === this.selection.first ? 0 : this.plotHeight;
  }

  private updateSelection(event: MouseEvent) {
    this.setSelectionPos(this.selection.second, event);
    if (this.selectionIsSane()) {
      this.selection.show = true;
      this.triggerRedrawOverlay();
    } else if (this.selection.show) {
      this.selection.show = false;
      this.triggerRedrawOverlay();
    }
  }

  private selectionIsSane() {
    const minSize = this.options.selection.minSize;
    const { first, second } = this.selection;
    return Math.abs(second.x - first.x) >= minSize && Math.abs(second.y - first.y) >= minSize;
  }

  private getSelection(): Ranges | null {
    if (!this.selectionIsSane() || !this.selection.show) return null;
    const r: Ranges = {};
    const { first, second } = this.selection;
    for (const [name, axis] of Object.entries(this.getAxes())) {
      if (axis.used) {
        const p1 = axis.c2p(first[axis.direction]);
        const p2 = axis.c2p(second[axis.direction]);
        r[name] = { from: Math.min(p1, p2), to: Math.max(p1, p2) };
      }
    }
    return r;
  }

  triggerRedrawOverlay() {
    const t = this.options.interaction.redrawOverlayInterval;
    if (t === -1) {
      this.drawOverlay();
      return;
    }
    if (!this.redrawTimeout) this.redrawTimeout = setTimeout(() => this.drawOverlay(), t);
  }

  private drawOverlay() {
    this.redrawTimeout = null;
    const octx = this.octx;
    octx.save();
    this.overlay.clear();
    octx.restore();
    const { plotOffset, plotWidth, plotHeight } = this;
    const c = this.options.crosshair;
    if (c.mode && this.crosshair.x !== -1) {
      octx.save();
      octx.translate(plotOffset.left, plotOffset.top);
      const adj = c.lineWidth % 2 ? 0.5 : 0;
      octx.strokeStyle = c.color;
      octx.lineWidth = c.lineWidth;
      octx.lineJoin = 'round';
      octx.beginPath();
      if (c.mode.indexOf('x') !== -1) {
        const drawX = Math.floor(this.crosshair.x) + adj;
        octx.moveTo(drawX, 0);
        octx.lineTo(drawX, plotHeight);
      }
      if (c.mode.indexOf('y') !== -1) {
        const drawY = Math.floor(this.crosshair.y) + adj;
        octx.moveTo(0, drawY);
        octx.lineTo(plotWidth, drawY);
      }
      octx.stroke();
      octx.restore();
    }
    if (this.selection.show && this.selectionIsSane()) {
      const o = this.options.selection;
      octx.save();
      octx.translate(plotOffset.left, plotOffset.top);
      const color = Color.parse(o.color);
      octx.strokeStyle = color.scale('a', 0.8).toString();
      octx.lineWidth = 1;
      octx.lineJoin = o.shape;
      octx.fillStyle = color.scale('a', 0.4).toString();
      const { first, second } = this.selection;
      const x = Math.min(first.x, second.x) + 0.5;
      const y = Math.min(first.y, second.y) + 0.5;
      const w = Math.abs(second.x - first.x) - 1;
      const h = Math.abs(second.y - first.y) - 1;
      octx.fillRect(x, y, w, h);
      octx.strokeRect(x, y, w, h);
      octx.restore();
    }
  }
}

/** The background colour an element shows: its own or the nearest of its ancestors' */
function backgroundOf(element: HTMLElement): string {
  let current: HTMLElement | null = element;
  while (current && current !== document.body) {
    const value = getComputedStyle(current).backgroundColor.toLowerCase();
    if (value !== '' && value !== 'transparent' && value !== 'rgba(0, 0, 0, 0)') return value;
    current = current.parentElement;
  }
  return 'transparent';
}

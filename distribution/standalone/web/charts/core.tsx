/* SPDX-License-Identifier: Apache-2.0 */

/*
 * What every chart shares: the colours of series, round axis ticks, the size of the place a
 * chart is drawn in, and the tooltip that follows the pointer. The charts are SVG drawn by
 * React; no chart library is behind them.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../components/icon';
import { standardColor } from './standard_color';

/*
 * The series colours of OpenSearch Dashboards (its component library's palette), so that a
 * dashboard keeps the colours it was built with and a colour someone picked for a series still
 * sits beside its neighbours.
 */
export const SERIES_COLORS = [
  '#54B399',
  '#6092C0',
  '#D36086',
  '#9170B8',
  '#CA8EAE',
  '#D6BF57',
  '#B9A888',
  '#DA8B45',
  '#AA6556',
  '#E7664C',
];

let configured: Record<string, string> = {};

/** The setting visualization:colorMapping: labels with a colour of their own */
export function setColorMapping(mapping: Record<string, string>) {
  configured = mapping ?? {};
}

/**
 * The opacity of the other series while one is hovered, the setting visualization:dimmingOpacity:
 * a number from 0 to 1, else 0.5, as the original's charts read it
 */
export function dimmingOpacity(value: unknown): number {
  const opacity = typeof value === 'number' ? value : Number.parseFloat(String(value));
  return opacity >= 0 && opacity <= 1 ? opacity : 0.5;
}

const mix = (from: string, to: string, share: number): string => {
  const a = parseColor(from);
  const b = parseColor(to);
  return `#${a.map((channel, index) => Math.round(channel + (b[index] - channel) * share).toString(16).padStart(2, '0')).join('')}`;
};

/*
 * The palette for a number of labels: the ten colours, and past ten the same colours again in
 * lighter and darker turns ("rotations"), in the order OpenSearch Dashboards hands them out.
 */
function rotatedPalette(rotations: number): string[] {
  if (rotations <= 1) return SERIES_COLORS;
  const turns = SERIES_COLORS.map((color) => {
    const dark = mix(color, '#000000', 0.5);
    const light = mix(color, '#ffffff', 0.5);
    const stops = rotations === 2 ? [color, light] : [dark, color, light];
    return Array.from({ length: rotations }, (_, index) => {
      const at = (index / (rotations - 1)) * (stops.length - 1);
      const low = Math.min(stops.length - 2, Math.floor(at));
      return mix(stops[low], stops[low + 1], at - low);
    });
  });
  const order: number[] = [];
  if (rotations === 2) order.push(0, 1);
  else {
    // From the colour itself outward, lighter and darker by turns
    const middle = Math.floor(rotations / 2);
    order.push(middle);
    for (let step = 1; step <= middle; step += 1) {
      if (middle + step < rotations) order.push(middle + step);
      if (middle - step >= 0) order.push(middle - step);
    }
  }
  return order.flatMap((turn) => turns.map((colors) => colors[turn]));
}

// Which colour a label has been given, for as long as the page lives
const mapped = new Map<string, string>();

/**
 * The colours of a chart's series, by label, as OpenSearch Dashboards gives them: a label keeps
 * the colour it first got, on every chart of the page, and the labels a chart brings that have
 * none yet take the palette from its start, in the order they come. A colour picked in the
 * visualization (`overrides`) or set for the label in visualization:colorMapping comes first.
 */
export function assignColors(labels: string[], overrides?: Record<string, string>): Map<string, string> {
  const keys = [...new Set(labels)];
  const taken: string[] = [];
  const fresh: string[] = [];
  const configuredColors = Object.values(configured).map((color: unknown) => standardColor(color));
  for (const key of keys) {
    if (configured[key]) {
      mapped.delete(key);
      taken.push(standardColor(configured[key]) ?? '');
      continue;
    }
    // A label whose colour has since been set aside for another in the setting takes a new one.
    // The setting's colours are kept in lower case and the palette is written in upper case, so
    // this never holds for a colour of the palette; OpenSearch Dashboards compares them the same way.
    const current = mapped.get(key);
    if (current === undefined || configuredColors.includes(current)) fresh.push(key);
  }
  const palette = rotatedPalette(Math.ceil(keys.length / 10)).filter((color) => !taken.includes(color.toLowerCase()));
  fresh.forEach((key, index) => {
    if (palette[index]) mapped.set(key, palette[index]);
  });
  return new Map(keys.map((key) => [key, overrides?.[key] ?? configured[key] ?? mapped.get(key) ?? SERIES_COLORS[0]]));
}

/** The palette dealt out in order, round and round, with no memory: the words of a tag cloud */
export function ordinalColors(labels: string[], overrides?: Record<string, string>): Map<string, string> {
  const colors = new Map<string, string>();
  for (const label of labels) {
    if (!colors.has(label)) colors.set(label, overrides?.[label] ?? SERIES_COLORS[colors.size % SERIES_COLORS.length]);
  }
  return colors;
}

/** The colour of one label on its own */
export function colorFor(label: string, overrides?: Record<string, string>): string {
  return assignColors([label], overrides).get(label) ?? SERIES_COLORS[0];
}

/** A colour moved toward white (above zero) or black (below) */
export function shade(hex: string, amount: number): string {
  const [r, g, b] = parseColor(hex);
  const target = amount > 0 ? 255 : 0;
  const mix = Math.min(1, Math.abs(amount));
  const blend = (channel: number) => Math.round(channel + (target - channel) * mix);
  return `#${[blend(r), blend(g), blend(b)].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

export function parseColor(color: string): [number, number, number] {
  const hex = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (hex) {
    const text = hex[1].length === 3 ? hex[1].replace(/./g, '$&$&') : hex[1];
    return [0, 2, 4].map((at) => parseInt(text.slice(at, at + 2), 16)) as [number, number, number];
  }
  const rgb = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(color);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return [128, 128, 128];
}

/** Black or white, whichever reads on a colour */
export function readableOn(color: string): string {
  const [r, g, b] = parseColor(color);
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#1d1d1f' : '#ffffff';
}

// --- Colour ramps for magnitudes: heat maps, gauges, maps ---------------------------------------

// The status colours of the theme, which two of the ramps run between
function token(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

// As OpenSearch Dashboards builds them: white to one colour of the palette, or between status colours
const RAMPS: Record<string, () => string[]> = {
  Blues: () => ['#ffffff', '#6092C0'],
  Greens: () => ['#ffffff', '#54B399'],
  Greys: () => ['#ffffff', '#d3dae6', '#98a2b3', '#69707d', '#343741'],
  Reds: () => ['#ffffff', '#E7664C'],
  'Yellow to Red': () => [token('--color-warning', '#ff9500'), token('--color-critical', '#ff3b30')],
  'Green to Red': () => [token('--color-healthy', '#34c759'), token('--color-warning', '#ff9500'), token('--color-critical', '#ff3b30')],
};

function interpolate(stops: string[], at: number): string {
  const clamped = Math.max(0, Math.min(1, at));
  if (stops.length === 1) return stops[0];
  const scaled = clamped * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.floor(scaled));
  const fraction = scaled - index;
  const from = parseColor(stops[index]);
  const to = parseColor(stops[index + 1]);
  const mixed = from.map((channel, i) => Math.round(channel + (to[i] - channel) * fraction));
  return `rgb(${mixed[0]}, ${mixed[1]}, ${mixed[2]})`;
}

/** The colour at a place between 0 and 1 on a named ramp of OpenSearch Dashboards */
export function rampColor(schema: string, at: number, inverted = false): string {
  const stops = (RAMPS[schema] ?? RAMPS.Greens)();
  return interpolate(stops, inverted ? 1 - at : at);
}

export const RAMP_NAMES = Object.keys(RAMPS);

// --- Ticks ----------------------------------------------------------------------------------------

/** Round numbers across a range: about `count` of them */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) return [min];
  const span = max - min;
  const raw = span / Math.max(1, count);
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / magnitude;
  // The round step nearest the one asked for, as charts usually choose it
  const step = (fraction >= 7.07 ? 10 : fraction >= 3.16 ? 5 : fraction >= 1.41 ? 2 : 1) * magnitude;
  const ticks: number[] = [];
  const first = Math.ceil(min / step - 1e-9) * step;
  for (let value = first; value <= max + step * 1e-9; value += step) {
    ticks.push(Math.abs(value) < step * 1e-9 ? 0 : Number(value.toPrecision(12)));
  }
  return ticks;
}

/** A range widened to round numbers, so that the last tick is at the edge */
export function niceDomain(min: number, max: number, count = 5): [number, number] {
  if (min === max) return min === 0 ? [0, 1] : min > 0 ? [0, min * 1.1] : [min * 1.1, 0];
  const ticks = niceTicks(min, max, count);
  if (ticks.length < 2) return [min, max];
  const step = ticks[1] - ticks[0];
  return [Math.floor(min / step + 1e-9) * step, Math.ceil(max / step - 1e-9) * step];
}

/*
 * The classic charts of OpenSearch Dashboards choose their value axes in a way of their own: so
 * many ticks for the length of the axis, steps by an older rounding rule, and a range widened to
 * the step that ten ticks would have. The visualizations saved there look as they did only when
 * the same choices are made here.
 */
function classicStep(span: number, count: number): number {
  const raw = span / Math.max(1, count);
  let step = 10 ** Math.floor(Math.log10(raw));
  const error = step / raw;
  if (error <= 0.15) step *= 10;
  else if (error <= 0.35) step *= 5;
  else if (error <= 0.75) step *= 2;
  return step;
}

export function classicTickCount(length: number): number {
  const at = Math.max(20, Math.min(1000, length));
  return Math.ceil(at <= 40 ? ((at - 20) / 20) * 3 : 3 + ((at - 40) / 960) * 8);
}

export function classicTicks(min: number, max: number, count: number): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || count < 1) return [];
  if (min === max) return [min];
  const step = classicStep(max - min, count);
  const ticks: number[] = [];
  for (let value = Math.ceil(min / step - 1e-9) * step; value <= max + step * 1e-9; value += step) {
    ticks.push(Math.abs(value) < step * 1e-9 ? 0 : Number(value.toPrecision(12)));
  }
  return ticks;
}

export function classicDomain(min: number, max: number): [number, number] {
  let domain: [number, number] = [min, max];
  if (!(max > min)) return min === 0 ? [0, 1] : domain;
  for (let pass = 0; pass < 2; pass += 1) {
    const step = classicStep(domain[1] - domain[0], 10);
    domain = [Math.floor(domain[0] / step + 1e-9) * step, Math.ceil(domain[1] / step - 1e-9) * step];
  }
  return [Number(domain[0].toPrecision(12)), Number(domain[1].toPrecision(12))];
}

const TIME_STEPS = [
  1, 5, 10, 50, 100, 500, 1000, 5000, 10000, 15000, 30000, 60000, 300000, 600000, 900000, 1800000,
  3600000, 10800000, 21600000, 43200000, 86400000, 172800000, 604800000, 1209600000, 2592000000,
  7776000000, 15552000000, 31536000000,
];

/** Moments across a range of time, on round steps counted in the browser's own zone */
export function timeTicks(min: number, max: number, count: number): number[] {
  const span = max - min;
  if (!(span > 0)) return [min];
  const step = TIME_STEPS.find((candidate) => span / candidate <= count) ?? 31536000000;
  // Steps of a day or more start at midnight where the reader is
  const offset = step >= 3600000 ? new Date(min).getTimezoneOffset() * 60000 : 0;
  const ticks: number[] = [];
  for (let value = Math.ceil((min - offset) / step) * step + offset; value <= max; value += step) {
    ticks.push(value);
  }
  return ticks;
}

// The steps the classic charts choose their time ticks from, and what each counts in
const CLASSIC_TIME_STEPS = [1e3, 5e3, 15e3, 3e4, 6e4, 3e5, 9e5, 18e5, 36e5, 108e5, 216e5, 432e5, 864e5, 1728e5, 6048e5, 2592e6, 7776e6, 31536e6];
const CLASSIC_TIME_UNITS: Array<['s' | 'm' | 'h' | 'd' | 'w' | 'M' | 'y', number]> = [
  ['s', 1], ['s', 5], ['s', 15], ['s', 30], ['m', 1], ['m', 5], ['m', 15], ['m', 30], ['h', 1], ['h', 3], ['h', 6], ['h', 12],
  ['d', 1], ['d', 2], ['w', 1], ['M', 1], ['M', 3], ['y', 1],
];

/**
 * The ticks of a time axis as the classic charts of OpenSearch Dashboards place them: the step
 * nearest to the range divided by the wanted count, counted from round moments (every third
 * hour of the day, every second day of the month) where the reader is.
 */
export function classicTimeTicks(min: number, max: number, count: number): number[] {
  const span = max - min;
  if (!(span > 0) || count < 1) return [min];
  const target = span / count;
  let index = 0;
  while (index < CLASSIC_TIME_STEPS.length && CLASSIC_TIME_STEPS[index] <= target) index += 1;
  // The moments are counted on a clock shifted to the reader's zone, and shifted back
  const offsetAt = (time: number) => -new Date(time).getTimezoneOffset() * 60000;
  const startOffset = offsetAt(min);
  const from = min + startOffset;
  const to = max + startOffset;
  let shifted: number[] = [];
  if (index === 0) {
    const step = classicStep(span, count);
    for (let value = Math.ceil(from / step) * step; value <= to; value += step) shifted.push(value);
  } else if (index === CLASSIC_TIME_STEPS.length) {
    const first = new Date(from).getUTCFullYear();
    const last = new Date(to).getUTCFullYear();
    const step = Math.max(1, classicStep(span / 31536e6, count));
    for (let year = Math.ceil(first / step) * step; year <= last + 1; year += step) {
      const value = Date.UTC(year, 0, 1);
      if (value >= from && value <= to) shifted.push(value);
    }
  } else {
    const chosen = target / CLASSIC_TIME_STEPS[index - 1] < CLASSIC_TIME_STEPS[index] / target ? index - 1 : index;
    const [unit, every] = CLASSIC_TIME_UNITS[chosen];
    const floor = (time: number): number => {
      const date = new Date(time);
      switch (unit) {
        case 's':
          return Math.floor(time / 1000) * 1000;
        case 'm':
          return Math.floor(time / 60000) * 60000;
        case 'h':
          return Math.floor(time / 3600000) * 3600000;
        case 'd':
          return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
        case 'w':
          return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - date.getUTCDay());
        case 'M':
          return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
        default:
          return Date.UTC(date.getUTCFullYear(), 0, 1);
      }
    };
    const next = (time: number): number => {
      const date = new Date(time);
      switch (unit) {
        case 's':
          return time + 1000;
        case 'm':
          return time + 60000;
        case 'h':
          return time + 3600000;
        case 'd':
          return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
        case 'w':
          return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 7);
        case 'M':
          return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
        default:
          return Date.UTC(date.getUTCFullYear() + 1, 0, 1);
      }
    };
    const numberOf = (time: number): number => {
      const date = new Date(time);
      switch (unit) {
        case 's':
          return date.getUTCSeconds();
        case 'm':
          return date.getUTCMinutes();
        case 'h':
          return date.getUTCHours();
        case 'd':
          return date.getUTCDate() - 1;
        case 'M':
          return date.getUTCMonth();
        default:
          return 0;
      }
    };
    let time = floor(from);
    if (time < from) time = next(time);
    for (let guard = 0; time <= to && guard < 5000; guard += 1) {
      if (every === 1 || numberOf(time) % every === 0) shifted.push(time);
      time = next(time);
    }
  }
  // Several ticks a day keep the offset the range starts with; whole days take their own
  const hourTicks = shifted.length > 0 && span / shifted.length < 12 * 3600000;
  return shifted.map((value) => value - (hourTicks ? startOffset : offsetAt(value - startOffset)));
}

export function linearScale(domain: [number, number], range: [number, number]) {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const factor = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0);
  return (value: number) => r0 + (value - d0) * factor;
}

export type ScaleKind = 'linear' | 'log' | 'square root';

/** A value axis: linear, logarithmic or square root, over a domain to a stretch of pixels */
export function valueScale(kind: ScaleKind, domain: [number, number], range: [number, number]) {
  if (kind === 'log') {
    const low = Math.max(domain[0], 1e-9);
    const scale = linearScale([Math.log10(low), Math.log10(Math.max(domain[1], low * 10))], range);
    return (value: number) => scale(Math.log10(Math.max(value, low)));
  }
  if (kind === 'square root') {
    const root = (value: number) => Math.sign(value) * Math.sqrt(Math.abs(value));
    const scale = linearScale([root(domain[0]), root(domain[1])], range);
    return (value: number) => scale(root(value));
  }
  return linearScale(domain, range);
}

// --- The place a chart is drawn in ----------------------------------------------------------------

export interface Size {
  width: number;
  height: number;
}

/** The size of an element, kept up to date as it changes */
export function useSize<T extends HTMLElement>(): [RefObject<T>, Size] {
  const ref = useRef<T>(null) as RefObject<T>;
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const measure = () => {
      const box = element.getBoundingClientRect();
      setSize((current) =>
        Math.abs(current.width - box.width) < 0.5 && Math.abs(current.height - box.height) < 0.5
          ? current
          : { width: box.width, height: box.height }
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, size];
}

let measureContext: CanvasRenderingContext2D | null | undefined;

/** A canvas set to the chart's face, to measure text with; none outside a browser */
function measurer(fontSize: number, weight: number, family?: string): CanvasRenderingContext2D | null {
  if (measureContext === undefined) {
    measureContext = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  }
  if (measureContext) {
    measureContext.font = `${weight} ${fontSize}px ${family ?? '-apple-system, BlinkMacSystemFont, "Helvetica Neue", Helvetica, Arial, sans-serif'}`;
  }
  return measureContext;
}

/** The width a text takes in the chart's face, or in another */
export function textWidth(text: string, fontSize = 11, weight = 400, family?: string): number {
  const context = measurer(fontSize, weight, family);
  return context ? context.measureText(text).width : text.length * fontSize * 0.58;
}

/**
 * How far below the middle of a line of text its baseline lies, as a canvas sets text whose
 * baseline is its middle: what an SVG text needs added to stand where a canvas chart puts it
 */
export function middleShift(fontSize: number, weight = 400, family?: string): number {
  const context = measurer(fontSize, weight, family);
  if (!context) return fontSize * 0.3;
  context.textBaseline = 'middle';
  const shift = -context.measureText('0').alphabeticBaseline;
  context.textBaseline = 'alphabetic';
  return Number.isFinite(shift) ? shift : fontSize * 0.3;
}

/** How far a line of the chart's face reaches above and below its baseline */
export function fontMetrics(fontSize = 11): { size: number; ascent: number; descent: number } {
  const metrics = measurer(fontSize, 400)?.measureText('0');
  return metrics && Number.isFinite(metrics.fontBoundingBoxAscent) && Number.isFinite(metrics.fontBoundingBoxDescent)
    ? { size: fontSize, ascent: metrics.fontBoundingBoxAscent, descent: metrics.fontBoundingBoxDescent }
    : { size: fontSize, ascent: fontSize, descent: fontSize * 0.27 };
}

/** A text cut to a width, with an ellipsis */
export function fitText(text: string, maxWidth: number, fontSize = 11): string {
  if (textWidth(text, fontSize) <= maxWidth) return text;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (textWidth(`${text.slice(0, middle)}…`, fontSize) <= maxWidth) low = middle;
    else high = middle - 1;
  }
  return low <= 0 ? '' : `${text.slice(0, low)}…`;
}

// --- The tooltip ----------------------------------------------------------------------------------

export interface TooltipRow {
  label: string;
  value: string;
  color?: string;
  /** The row the pointer is on */
  active?: boolean;
}

export interface TooltipContent {
  title?: string;
  rows: TooltipRow[];
  x: number;
  y: number;
}

export function useTooltip() {
  const [content, setContent] = useState<TooltipContent | undefined>();
  const hide = useCallback(() => setContent(undefined), []);
  return { content, show: setContent, hide };
}

export function ChartTooltip({ content }: { content?: TooltipContent }) {
  const box = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | undefined>();
  useLayoutEffect(() => {
    if (!content || !box.current) return;
    const { width, height } = box.current.getBoundingClientRect();
    let left = content.x + 14;
    if (left + width > window.innerWidth - 8) left = content.x - width - 14;
    let top = content.y - height / 2;
    top = Math.max(8, Math.min(top, window.innerHeight - height - 8));
    setPlace({ left: Math.max(8, left), top });
  }, [content]);
  useEffect(() => {
    if (!content) setPlace(undefined);
  }, [content]);
  if (!content) return null;
  return createPortal(
    <div
      ref={box}
      className="chtTooltip atlMaterial"
      style={{ left: place?.left ?? -9999, top: place?.top ?? -9999 }}
      role="tooltip"
    >
      {content.title && <div className="chtTooltip__title">{content.title}</div>}
      <table>
        <tbody>
          {content.rows.map((row, index) => (
            <tr key={`${row.label}-${index}`} className={row.active ? 'chtTooltip__active' : undefined}>
              <td>
                {row.color && <span className="chtSwatch" style={{ background: row.color }} />}
                {row.label}
              </td>
              <td>{row.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>,
    document.body
  );
}

// --- The legend -----------------------------------------------------------------------------------

export interface LegendItem {
  id: string;
  label: string;
  color: string;
  hidden?: boolean;
  /** A figure shown beside the name: the latest value of the series */
  value?: string;
}

export type LegendPosition = 'right' | 'left' | 'top' | 'bottom';

export function Legend({
  items,
  position,
  onToggle,
  onHover,
  classic,
  elasticSize,
}: {
  items: LegendItem[];
  position: LegendPosition;
  onToggle?: (id: string) => void;
  onHover?: (id: string | undefined) => void;
  /** As wide as the legend of a classic chart of OpenSearch Dashboards, whatever the chart's width */
  classic?: boolean;
  /**
   * Laid out as elastic-charts lays out its legend: this many pixels wide beside the chart, or
   * this many high above or below it
   */
  elasticSize?: number;
}) {
  const elastic = elasticSize !== undefined;
  const beside = position === 'left' || position === 'right';
  // Above or below the chart elastic-charts gives a legend of a single item the whole width, and
  // the columns of at least 200 pixels only to more items
  const across = items.length === 1 ? { gridTemplateColumns: '1fr' } : {};
  return (
    <ul
      className={`chtLegend chtLegend--${position}${classic ? ' chtLegend--classic' : ''}${elastic ? ' chtLegend--elastic' : ''}`}
      style={elastic ? (beside ? { width: elasticSize } : { height: elasticSize, ...across }) : undefined}
      data-test-subj="legendContainer"
    >
      {items.map((item) => (
        <li key={item.id}>
          <button
            type="button"
            className="chtLegend__item"
            style={item.hidden ? { opacity: 0.45 } : undefined}
            title={item.label}
            onClick={() => onToggle?.(item.id)}
            onMouseEnter={() => onHover?.(item.id)}
            onMouseLeave={() => onHover?.(undefined)}
            data-test-subj={`legend-${item.label}`}
          >
            <span className="chtSwatch" style={{ background: item.hidden ? 'transparent' : item.color, boxShadow: `inset 0 0 0 2px ${item.color}` }} />
            <span className="atlTruncate">{item.label}</span>
            {item.value !== undefined && <span className="chtLegend__value">{item.value}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Opens and closes the legend of a chart, from the chart's corner */
export function LegendToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={`chtLegendToggle${open ? ' chtLegendToggle--open' : ''}`}
      aria-label="Toggle legend"
      aria-expanded={open}
      title="Toggle legend"
      onClick={onToggle}
      data-test-subj="vislibToggleLegend"
    >
      <Icon name="list" />
    </button>
  );
}

/** A chart with its legend on one side: the legend takes what it needs, the chart the rest */
export function ChartFrame({
  legend,
  position = 'right',
  tight,
  children,
}: {
  legend?: ReactNode;
  position?: LegendPosition;
  /** No room between the chart and its legend, which keeps its own */
  tight?: boolean;
  children: ReactNode;
}) {
  const column = position === 'top' || position === 'bottom';
  const first = position === 'left' || position === 'top';
  return (
    <div className="chtFrame" style={{ flexDirection: column ? 'column' : 'row', gap: tight ? 0 : undefined }}>
      {legend && first && legend}
      <div className="chtFrame__plot">{children}</div>
      {legend && !first && legend}
    </div>
  );
}

export function ChartMessage({ children }: { children: ReactNode }) {
  return (
    <div className="chtMessage" data-test-subj="visNoResult">
      {children}
    </div>
  );
}

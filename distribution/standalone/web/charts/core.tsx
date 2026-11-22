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

/*
 * The series colours of OpenSearch Dashboards (its component library's palette), so that a
 * dashboard keeps the colours it was built with and a colour someone picked for a series still
 * sits beside its neighbours. A label keeps its colour everywhere: the same country is the same
 * colour in every panel of a dashboard.
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

const assigned = new Map<string, string>();
let configured: Record<string, string> = {};

/** The setting visualization:colorMapping: labels with a colour of their own */
export function setColorMapping(mapping: Record<string, string>) {
  configured = mapping ?? {};
}

/** The colour of a series by its label; `overrides` are the colours picked in one visualization */
export function colorFor(label: string, overrides?: Record<string, string>): string {
  if (overrides?.[label]) return overrides[label];
  if (configured[label]) return configured[label];
  let color = assigned.get(label);
  if (!color) {
    // Past the palette the colours come round again, lighter or darker by turns
    const index = assigned.size;
    const base = SERIES_COLORS[index % SERIES_COLORS.length];
    const round = Math.floor(index / SERIES_COLORS.length);
    color = round === 0 ? base : shade(base, round % 2 === 1 ? 0.25 * Math.ceil(round / 2) : -0.2 * (round / 2));
    assigned.set(label, color);
  }
  return color;
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

const RAMPS: Record<string, string[]> = {
  Blues: ['#f7fbff', '#c6dbef', '#6baed6', '#2171b5', '#08306b'],
  Greens: ['#f7fcf5', '#c7e9c0', '#74c476', '#238b45', '#00441b'],
  Greys: ['#ffffff', '#d9d9d9', '#969696', '#525252', '#000000'],
  Reds: ['#fff5f0', '#fcbba1', '#fb6a4a', '#cb181d', '#67000d'],
  'Yellow to Red': ['#ffffcc', '#fed976', '#fd8d3c', '#e31a1c', '#800026'],
  'Green to Red': ['#006837', '#86cb66', '#ffffbf', '#f88d52', '#a50026'],
};

function interpolate(stops: string[], at: number): string {
  const clamped = Math.max(0, Math.min(1, at));
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
  const stops = RAMPS[schema] ?? RAMPS.Greens;
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
  const step = (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * magnitude;
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

/** The width a text takes in the chart's face */
export function textWidth(text: string, fontSize = 11, weight = 400): number {
  if (measureContext === undefined) {
    measureContext = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  }
  if (!measureContext) return text.length * fontSize * 0.58;
  measureContext.font = `${weight} ${fontSize}px -apple-system, BlinkMacSystemFont, "Helvetica Neue", Helvetica, Arial, sans-serif`;
  return measureContext.measureText(text).width;
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
}

export type LegendPosition = 'right' | 'left' | 'top' | 'bottom';

export function Legend({
  items,
  position,
  onToggle,
  onHover,
}: {
  items: LegendItem[];
  position: LegendPosition;
  onToggle?: (id: string) => void;
  onHover?: (id: string | undefined) => void;
}) {
  return (
    <ul className={`chtLegend chtLegend--${position}`} data-test-subj="legendContainer">
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
          </button>
        </li>
      ))}
    </ul>
  );
}

/** A chart with its legend on one side: the legend takes what it needs, the chart the rest */
export function ChartFrame({
  legend,
  position = 'right',
  children,
}: {
  legend?: ReactNode;
  position?: LegendPosition;
  children: ReactNode;
}) {
  const column = position === 'top' || position === 'bottom';
  const first = position === 'left' || position === 'top';
  return (
    <div className="chtFrame" style={{ flexDirection: column ? 'column' : 'row' }}>
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

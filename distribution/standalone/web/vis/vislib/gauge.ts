/* SPDX-License-Identifier: Apache-2.0 */

/*
 * A gauge or a goal as vislib draws it (its GaugeChart and MeterGauge): a gauge per series, side
 * by side or one under the other in the room the chart has less 25 pixels; an arc open at the
 * bottom or a ring, its background, and the arc of its value over it in the colour of the range
 * the value is in; the ranges' colours on a thin scale inside it with eleven ticks; and the value,
 * the series' name and a sub text in the middle, each left out when it does not fit.
 */

import { heatmapColor } from './color_maps';
import { arcPath } from './shapes';

export interface GaugeRange {
  from: number;
  to: number;
}

/** A gauge's settings as MeterGauge reads them, its defaults put in */
export interface MeterConfig {
  alignment?: string;
  gaugeType?: string;
  extendRange: boolean;
  percentageMode: boolean;
  colorSchema: string;
  colorsRange: GaugeRange[];
  invertColors: boolean;
  innerSpace: number;
  outline: boolean;
  labels: { show: boolean };
  scale: { show: boolean; width: number; ticks: number; tickLength: number };
  style: { bgWidth: number; width: number; bgFill?: string; subText: string };
}

type Plain = Record<string, unknown>;

const isPlain = (value: unknown): value is Plain => typeof value === 'object' && value !== null && !Array.isArray(value);

/** MeterGauge's defaults, which fill in what a gauge's settings leave out */
const METER_DEFAULTS: Plain = {
  showTooltip: true,
  percentageMode: true,
  innerSpace: 5,
  extents: [0, 10000],
  outline: false,
  scale: { show: true, color: '#666', width: 2, ticks: 10, tickLength: 8 },
  labels: { show: true, color: '#666' },
  style: { bgWidth: 0.5, width: 0.9 },
};

/** lodash's defaultsDeep, on a copy: what is undefined takes the default, objects in objects too */
export function defaultsDeep(target: Plain, source: Plain): Plain {
  const out: Plain = { ...target };
  for (const [key, value] of Object.entries(source)) {
    const own = out[key];
    if (own === undefined) out[key] = isPlain(value) ? defaultsDeep({}, value) : Array.isArray(value) ? [...value] : value;
    else if (isPlain(own) && isPlain(value)) out[key] = defaultsDeep(own, value);
  }
  return out;
}

const plainOf = (value: unknown): Plain => (isPlain(value) ? value : {});
const numberOf = (value: unknown): number => (typeof value === 'number' ? value : Number(value));
const textOf = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

/** A gauge's settings (the `gauge` of its params) as MeterGauge takes them, with its defaults */
export function meterConfig(gauge: unknown): MeterConfig {
  const merged = defaultsDeep(plainOf(gauge), METER_DEFAULTS);
  const scale = plainOf(merged.scale);
  const style = plainOf(merged.style);
  const ranges = Array.isArray(merged.colorsRange) ? merged.colorsRange : [];
  return {
    alignment: textOf(merged.alignment),
    gaugeType: textOf(merged.gaugeType),
    extendRange: Boolean(merged.extendRange),
    percentageMode: Boolean(merged.percentageMode),
    colorSchema: textOf(merged.colorSchema) ?? '',
    colorsRange: ranges.map((range) => ({ from: numberOf(plainOf(range).from), to: numberOf(plainOf(range).to) })),
    invertColors: Boolean(merged.invertColors),
    innerSpace: numberOf(merged.innerSpace),
    outline: Boolean(merged.outline),
    labels: { show: Boolean(plainOf(merged.labels).show) },
    scale: {
      show: Boolean(scale.show),
      width: numberOf(scale.width),
      ticks: numberOf(scale.ticks),
      tickLength: numberOf(scale.tickLength),
    },
    style: {
      bgWidth: numberOf(style.bgWidth),
      width: numberOf(style.width),
      bgFill: textOf(style.bgFill),
      subText: style.subText === undefined || style.subText === null ? '' : String(style.subText),
    },
  };
}

/** The names of the ranges, as the legend lists them: their ends, as shares of the last in the percentage mode */
export function gaugeLabels(config: Pick<MeterConfig, 'colorsRange' | 'percentageMode'>): string[] {
  const ranges = config.colorsRange;
  if (!ranges.length) return [];
  const max = ranges[ranges.length - 1].to;
  return ranges.map((range) => {
    const from = config.percentageMode ? Math.round((100 * range.from) / max) : range.from;
    const to = config.percentageMode ? Math.round((100 * range.to) / max) : range.to;
    return `${from} - ${to}`;
  });
}

/** The colour of each range's name: the schema's at the range's place among them, the other way round when inverted */
export function gaugeColors(config: Pick<MeterConfig, 'colorsRange' | 'percentageMode' | 'colorSchema' | 'invertColors'>, dark: boolean): Record<string, string> {
  const labels = gaugeLabels(config);
  const colors: Record<string, string> = {};
  const divider = Math.max(config.colorsRange.length - 1, 1);
  labels.forEach((label, index) => {
    const at = config.invertColors ? 1 - index / divider : index / divider;
    colors[label] = heatmapColor(at, config.colorSchema, dark);
  });
  return colors;
}

/** The range a value falls in, its end left out: the first one below them all, the last one above */
export function gaugeBucket(ranges: GaugeRange[], value: number): number {
  const bucket = ranges.findIndex((range) => range.from <= value && range.to > value);
  if (bucket !== -1) return bucket;
  return value < ranges[0].from ? 0 : ranges.length - 1;
}

/** The size of each gauge (GaugeChart's calcGaugeDim), from the room of the chart and how many there are */
export function gaugeSize(alignment: string | undefined, containerWidth: number, containerHeight: number, count: number) {
  const containerMargin = 25;
  // A few pixels between the gauges, for the name under them
  const gaugeBottomMargin = Math.ceil(25 / count);
  const availableWidth = containerWidth - containerMargin;
  const availableHeight = containerHeight - containerMargin;
  const adaptedWidth = Math.floor(availableWidth / count);
  const adaptedHeight = Math.floor(availableHeight / count) - gaugeBottomMargin;
  if (alignment === 'vertical') return { width: containerWidth, height: adaptedHeight };
  if (alignment === 'horizontal') return { width: adaptedWidth, height: availableHeight };
  const vertical = availableWidth < availableHeight;
  return { width: vertical ? containerWidth : adaptedWidth, height: vertical ? adaptedHeight : availableHeight };
}

/** d3 3's linear scale: no clamping, and a domain of one value maps to the start of the range */
function linear([d0, d1]: [number, number], [r0, r1]: [number, number]): (x: number) => number {
  let span = d1 - d0;
  span = span || 1 / span;
  return (x) => {
    const t = (x - d0) / span;
    return r0 * (1 - t) + r1 * t;
  };
}

interface Box {
  top: number;
  bottom: number;
}

/** How far up and down a piece of a ring reaches (its tight box, as getBBox measures it) */
function arcBox(innerRadius: number, outerRadius: number, startAngle: number, endAngle: number): Box {
  const r0 = Math.min(Math.max(0, innerRadius), Math.max(0, outerRadius));
  const r1 = Math.max(Math.max(0, innerRadius), Math.max(0, outerRadius));
  if (Math.abs(endAngle - startAngle) >= 2 * Math.PI - 1e-6) return { top: -r1, bottom: r1 };
  // From twelve o'clock, clockwise: a point is `r` sin, `-r` cos
  const ys = [startAngle, endAngle].flatMap((angle) => [-r0 * Math.cos(angle), -r1 * Math.cos(angle)]);
  const low = Math.min(startAngle, endAngle);
  const high = Math.max(startAngle, endAngle);
  for (let k = Math.ceil(low / Math.PI); k * Math.PI <= high; k += 1) ys.push(k % 2 === 0 ? -r1 : r1);
  return { top: Math.min(...ys), bottom: Math.max(...ys) };
}

export interface MeterText {
  text: string;
  hidden: boolean;
}

export interface MeterDrawing {
  /** Where its middle is in its room */
  transform: string;
  /** The name of the range its value is in */
  holderLabel: string;
  background: string;
  value: string;
  valueColor: string;
  valueText: MeterText;
  /** The series' name and the sub text, when the labels are shown */
  label?: MeterText;
  subText?: MeterText;
  scale?: {
    arcs: Array<{ d: string; color: string }>;
    ticks: Array<{ x1: number; y1: number; x2: number; y2: number; color: string }>;
  };
}

export interface MeterInput {
  config: MeterConfig;
  /** The series' value and name */
  y: number | null;
  label: string;
  width: number;
  height: number;
  /** Writes the value, by the series' format */
  format: (value: number | null) => string;
  /** The colour of a range by its name: one picked in the legend, else the schema's */
  colorOf: (label: string) => string;
  /** The width of a text as drawn: the value at twice the chart's size, the others at it */
  measure: (text: string, large: boolean) => number;
}

/** A gauge as MeterGauge's drawGauge draws it */
export function drawMeter({ config, y, label, width, height, format, colorOf, measure }: MeterInput): MeterDrawing {
  const ranges = config.colorsRange;
  const labels = gaugeLabels(config);
  const colorAt = (value: number) => colorOf(labels[gaugeBucket(ranges, value)]);
  const circle = config.gaugeType === 'Circle';
  const angleFactor = circle ? 1 : 0.75;
  const maxAngle = circle ? 2 * Math.PI : 2 * Math.PI * 1.3;
  const minAngle = circle ? 0 : 2 * Math.PI * 0.7;
  const maxRadius = (Math.min(width, height / angleFactor) / 2) * 0.95;

  // A value that is not there counts as nought, as JavaScript compares it
  const at = y ?? 0;
  const min = ranges[0].from;
  const max = ranges[ranges.length - 1].to;
  const top = config.extendRange && max < at ? at : max;
  const angle = linear([min, top], [minAngle, maxAngle]);
  const radius = linear([config.innerSpace + 1, 0], [0, maxRadius]);
  const totalWidth = Math.abs(radius(0) - radius(1));
  const bgPadding = (totalWidth * (1 - config.style.bgWidth)) / 2;
  const gaugePadding = (totalWidth * (1 - config.style.width)) / 2;
  // The room in the middle: inside the ticks, or out to the arc's padding without a scale
  const innerFreeSpace =
    radius(1) * 2 - (config.scale.show ? config.scale.tickLength * 2 : -Math.max(bgPadding, gaugePadding) * 2);

  const bgInner = Math.max(0, radius(1) + bgPadding);
  const bgOuter = Math.max(0, radius(0) - bgPadding);
  const valueInner = Math.max(0, radius(1) + gaugePadding);
  const valueOuter = Math.max(0, radius(0) - gaugePadding);
  const valueEnd = Math.max(0, Math.min(maxAngle, angle(Math.max(min, at))));

  // A gauge whose arcs are less than 70 pixels high shows no names
  const boxes = [arcBox(bgInner, bgOuter, minAngle, maxAngle), arcBox(valueInner, valueOuter, minAngle, valueEnd)];
  const smallContainer = Math.max(...boxes.map((box) => box.bottom)) - Math.min(...boxes.map((box) => box.top)) < 70;

  const valueLabel = config.percentageMode ? format((at - min) / (max - min)) : format(y);
  const valueHidden = measure(valueLabel, true) >= innerFreeSpace - 6;
  const drawing: MeterDrawing = {
    transform: `translate(${width / 2}, ${height / 2 > maxRadius ? height / 2 : maxRadius})`,
    holderLabel: labels[gaugeBucket(ranges, at)],
    background: arcPath(bgInner, bgOuter, minAngle, maxAngle),
    value: arcPath(valueInner, valueOuter, minAngle, valueEnd),
    valueColor: colorAt(Math.max(min, at)),
    valueText: { text: valueLabel, hidden: valueHidden },
  };
  if (config.labels.show) {
    drawing.label = { text: label, hidden: smallContainer || measure(label, false) > maxRadius };
    const subText = config.style.subText;
    drawing.subText = { text: subText, hidden: valueHidden || smallContainer || measure(subText, false) > maxRadius };
  }
  if (config.scale.show) {
    const inner = radius(1);
    const { width: scaleWidth, tickLength, ticks } = config.scale;
    const ticksAt: Array<{ x1: number; y1: number; x2: number; y2: number; color: string }> = [];
    for (let i = 0; i <= ticks; i += 1) {
      // From nought, not from the start of the ranges, as the original counts them
      const value = (i * (top - min)) / ticks;
      const tickAngle = angle(value) - Math.PI / 2;
      ticksAt.push({
        x1: Math.cos(tickAngle) * inner,
        x2: Math.cos(tickAngle) * (inner - tickLength),
        y1: Math.sin(tickAngle) * inner,
        y2: Math.sin(tickAngle) * (inner - tickLength),
        color: colorAt(value),
      });
    }
    drawing.scale = {
      arcs: ranges.map((range) => ({ d: arcPath(inner, inner + scaleWidth, angle(range.from), angle(range.to)), color: colorAt(range.from) })),
      ticks: ticksAt,
    };
  }
  return drawing;
}

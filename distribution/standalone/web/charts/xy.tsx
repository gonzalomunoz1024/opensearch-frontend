/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Lines, areas and bars over one category axis (time, numbers or names) and one or more value
 * axes, upright or on their side: the chart behind the line, area, vertical bar and horizontal
 * bar visualizations and behind the histogram of Discover.
 */

import { useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import {
  ChartFrame,
  ChartMessage,
  ChartTooltip,
  Legend,
  fitText,
  niceDomain,
  niceTicks,
  textWidth,
  timeTicks,
  useSize,
  useTooltip,
  valueScale,
  type LegendPosition,
  type ScaleKind,
} from './core';
import '../styles/charts.css';

export interface XYPoint {
  x: number | string;
  y: number | null;
  /** A third measure, drawn as the size of the point */
  z?: number;
}

export interface XYSeries {
  id: string;
  label: string;
  color: string;
  type: 'line' | 'area' | 'histogram';
  mode: 'stacked' | 'normal';
  axisId: string;
  points: XYPoint[];
  interpolate?: 'linear' | 'cardinal' | 'step-after';
  showCircles?: boolean;
  drawLines?: boolean;
  lineWidth?: number;
}

export interface XYAxis {
  id: string;
  position: 'left' | 'right' | 'top' | 'bottom';
  title?: string;
  show?: boolean;
  showLabels?: boolean;
  scale?: ScaleKind;
  mode?: 'normal' | 'percentage' | 'wiggle' | 'silhouette';
  min?: number;
  max?: number;
  /** Fit the axis to the data instead of starting it at zero */
  fitToData?: boolean;
  format: (value: number) => string;
}

export interface XYCategoryAxis {
  type: 'time' | 'number' | 'category';
  /** Every place on the axis, in order */
  values: Array<number | string>;
  /** The width of a bucket, in the unit of the values: milliseconds for time */
  interval?: number;
  /** The whole stretch the axis covers when it is wider than the data: the time range */
  domain?: [number, number];
  format: (value: number | string) => string;
  title?: string;
  show?: boolean;
  showLabels?: boolean;
}

export interface XYChartProps {
  series: XYSeries[];
  axes: XYAxis[];
  x: XYCategoryAxis;
  /** Bars lie on their side: the category axis is the vertical one */
  horizontal?: boolean;
  legend?: LegendPosition | false;
  grid?: { category?: boolean; value?: boolean };
  threshold?: { value: number; width?: number; style?: string; color?: string };
  /** A line at the present moment on a time axis */
  nowMarker?: boolean;
  tooltip?: boolean;
  onPointClick?: (series: XYSeries, point: XYPoint) => void;
  /** Called with the stretch of the category axis that was dragged over */
  onBrush?: (from: number, to: number) => void;
  /** Colours someone picked are kept by the caller; hidden series are the chart's own */
  testId?: string;
}

interface Placed {
  series: XYSeries;
  /** Per place on the category axis: where the value starts and ends, in the axis's unit */
  spans: Array<{ from: number; to: number; y: number | null; z?: number } | undefined>;
}

const FONT = 11;

function linePath(points: Array<[number, number] | undefined>, interpolate: string | undefined, horizontal: boolean): string {
  const parts: string[] = [];
  let run: Array<[number, number]> = [];
  const flush = () => {
    if (run.length === 0) return;
    if (interpolate === 'step-after') {
      let path = `M${run[0][0]},${run[0][1]}`;
      for (let index = 1; index < run.length; index += 1) {
        path += horizontal
          ? `V${run[index][1]}H${run[index][0]}`
          : `H${run[index][0]}V${run[index][1]}`;
      }
      parts.push(path);
    } else if (interpolate === 'cardinal' && run.length > 2) {
      // A smooth curve through the points that does not overshoot much
      let path = `M${run[0][0]},${run[0][1]}`;
      for (let index = 0; index < run.length - 1; index += 1) {
        const p0 = run[Math.max(0, index - 1)];
        const p1 = run[index];
        const p2 = run[index + 1];
        const p3 = run[Math.min(run.length - 1, index + 2)];
        const tension = 1 / 6;
        path += `C${p1[0] + (p2[0] - p0[0]) * tension},${p1[1] + (p2[1] - p0[1]) * tension} ${
          p2[0] - (p3[0] - p1[0]) * tension
        },${p2[1] - (p3[1] - p1[1]) * tension} ${p2[0]},${p2[1]}`;
      }
      parts.push(path);
    } else {
      parts.push(`M${run.map((point) => `${point[0]},${point[1]}`).join('L')}`);
    }
    run = [];
  };
  for (const point of points) {
    if (point) run.push(point);
    else flush();
  }
  flush();
  return parts.join('');
}

export function XYChart({
  series,
  axes,
  x,
  horizontal = false,
  legend = 'right',
  grid = { value: true },
  threshold,
  nowMarker,
  tooltip = true,
  onPointClick,
  onBrush,
  testId,
}: XYChartProps) {
  const [ref, size] = useSize<HTMLDivElement>();
  const [hidden, setHidden] = useState<string[]>([]);
  const [emphasized, setEmphasized] = useState<string | undefined>();
  const [hover, setHover] = useState<number | undefined>();
  const [brush, setBrush] = useState<{ start: number; end: number } | undefined>();
  const drag = useRef<{ start: number; moved: boolean } | undefined>(undefined);
  const tip = useTooltip();
  const visible = useMemo(() => series.filter((item) => !hidden.includes(item.id)), [series, hidden]);

  const model = useMemo(() => {
    const index = new Map<number | string, number>();
    x.values.forEach((value, at) => index.set(value, at));
    const count = x.values.length;

    // Values per series by place; stacked series of one axis and kind pile up
    const stacks = new Map<string, { positive: number[]; negative: number[] }>();
    const totals = new Map<string, number[]>();
    for (const item of visible) {
      const axis = axes.find((candidate) => candidate.id === item.axisId) ?? axes[0];
      if (item.mode !== 'stacked' || axis?.mode !== 'percentage') continue;
      const key = `${item.axisId}|${item.type}`;
      const total = totals.get(key) ?? new Array<number>(count).fill(0);
      for (const point of item.points) {
        const at = index.get(point.x);
        if (at !== undefined && point.y !== null) total[at] += Math.abs(point.y);
      }
      totals.set(key, total);
    }
    const placed: Placed[] = visible.map((item) => {
      const spans: Placed['spans'] = new Array(count).fill(undefined);
      const axis = axes.find((candidate) => candidate.id === item.axisId) ?? axes[0];
      const key = `${item.axisId}|${item.type}`;
      const stacked = item.mode === 'stacked';
      const stack = stacked
        ? (stacks.get(key) ??
          stacks
            .set(key, { positive: new Array<number>(count).fill(0), negative: new Array<number>(count).fill(0) })
            .get(key)!)
        : undefined;
      for (const point of item.points) {
        const at = index.get(point.x);
        if (at === undefined) continue;
        let value = point.y;
        if (value !== null && stacked && axis?.mode === 'percentage') {
          const total = totals.get(key)?.[at] ?? 0;
          value = total === 0 ? 0 : value / total;
        }
        if (value === null || !stack) {
          spans[at] = { from: 0, to: value ?? 0, y: point.y, z: point.z };
        } else {
          const pile = value >= 0 ? stack.positive : stack.negative;
          spans[at] = { from: pile[at], to: pile[at] + value, y: point.y, z: point.z };
          pile[at] += value;
        }
      }
      return { series: item, spans };
    });

    // The range of each value axis
    const domains = new Map<string, [number, number]>();
    for (const axis of axes) {
      let min = Infinity;
      let max = -Infinity;
      for (const { series: item, spans } of placed) {
        if ((axes.find((candidate) => candidate.id === item.axisId) ?? axes[0]).id !== axis.id) continue;
        for (const span of spans) {
          if (!span || span.y === null) continue;
          min = Math.min(min, span.from, span.to);
          max = Math.max(max, span.from, span.to);
        }
      }
      if (threshold && axis.id === axes[0].id) {
        min = Math.min(min, threshold.value);
        max = Math.max(max, threshold.value);
      }
      if (!Number.isFinite(min)) {
        min = 0;
        max = 1;
      }
      if (axis.mode === 'percentage') {
        domains.set(axis.id, [Math.min(0, min), Math.max(1, max)]);
        continue;
      }
      const log = axis.scale === 'log';
      if (!axis.fitToData && !log) {
        min = Math.min(0, min);
        max = Math.max(0, max);
      }
      let domain: [number, number] = log ? [Math.max(min, 1e-3), max] : niceDomain(min, max, 5);
      if (axis.min !== undefined && Number.isFinite(axis.min)) domain = [axis.min, domain[1]];
      if (axis.max !== undefined && Number.isFinite(axis.max)) domain = [domain[0], axis.max];
      if (domain[0] === domain[1]) domain = [domain[0], domain[0] + 1];
      domains.set(axis.id, domain);
    }
    return { placed, domains, index };
  }, [visible, axes, x.values, threshold]);

  const { width, height } = size;
  const layout = useMemo(() => {
    if (width < 40 || height < 40) return undefined;
    const valueAxes = axes.filter((axis) => axis.show !== false);
    // In an upright chart value axes stand left and right; on its side they lie below and above
    const before = valueAxes.filter((axis) => (horizontal ? axis.position !== 'top' : axis.position !== 'right'));
    const after = valueAxes.filter((axis) => !before.includes(axis));
    const labelWidth = (axis: XYAxis) => {
      if (axis.showLabels === false) return 0;
      const domain = model.domains.get(axis.id) ?? [0, 1];
      const ticks = axis.scale === 'log' ? logTicks(domain) : niceTicks(domain[0], domain[1], 5);
      return Math.min(96, Math.max(0, ...ticks.map((tick) => textWidth(axis.format(tick), FONT))));
    };
    const titleSpace = (title?: string) => (title ? 18 : 0);
    const categoryShown = x.show !== false;
    const categoryLabels = categoryShown && x.showLabels !== false;
    const categoryLabelWidth = categoryLabels
      ? Math.min(140, Math.max(0, ...x.values.slice(0, 200).map((value) => textWidth(x.format(value), FONT))))
      : 0;

    let left = 8;
    let right = 12;
    let top = 8;
    let bottom = 6;
    if (horizontal) {
      left += categoryLabelWidth + (categoryLabels ? 8 : 0) + titleSpace(categoryShown ? x.title : undefined);
      for (const axis of before) bottom += (axis.showLabels === false ? 0 : 18) + titleSpace(axis.title);
      for (const axis of after) top += (axis.showLabels === false ? 0 : 18) + titleSpace(axis.title);
    } else {
      bottom += (categoryLabels ? 18 : 0) + titleSpace(categoryShown ? x.title : undefined);
      for (const axis of before) left += labelWidth(axis) + 8 + titleSpace(axis.title);
      for (const axis of after) right += labelWidth(axis) + 8 + titleSpace(axis.title);
    }
    const plot = {
      left,
      top,
      width: Math.max(10, width - left - right),
      height: Math.max(10, height - top - bottom),
    };
    return { plot, before, after, labelWidth, categoryLabels, categoryShown };
  }, [width, height, axes, horizontal, model.domains, x]);

  const geometry = useMemo(() => {
    if (!layout) return undefined;
    const { plot } = layout;
    const length = horizontal ? plot.height : plot.width;
    const count = x.values.length;
    let start: (at: number) => number;
    let band: number;
    let domain: [number, number] | undefined;
    if (x.type === 'category' || count === 0) {
      band = count === 0 ? length : length / count;
      start = (at) => at * band;
    } else {
      const numbers = x.values as number[];
      const interval = x.interval && x.interval > 0 ? x.interval : guessInterval(numbers);
      let min = numbers[0];
      let max = numbers[numbers.length - 1] + interval;
      if (x.domain) {
        min = Math.min(min, x.domain[0]);
        max = Math.max(max, x.domain[1]);
      }
      domain = [min, max];
      const factor = length / (max - min || 1);
      band = Math.max(1, interval * factor);
      start = (at) => (numbers[at] - min) * factor;
    }
    // On its side the first category is at the top, as a list reads
    const categoryAt = (at: number) => start(at);
    const scales = new Map<string, (value: number) => number>();
    for (const axis of axes) {
      const axisDomain = model.domains.get(axis.id) ?? [0, 1];
      scales.set(
        axis.id,
        valueScale(axis.scale ?? 'linear', axisDomain, horizontal ? [0, plot.width] : [plot.height, 0])
      );
    }
    return { length, band, categoryAt, scales, domain };
  }, [layout, horizontal, x, axes, model.domains]);

  if (series.length === 0 || x.values.length === 0) {
    return (
      <div ref={ref} className="chtPlot">
        <ChartMessage>No results found</ChartMessage>
      </div>
    );
  }

  const legendItems = series.map((item) => ({
    id: item.id,
    label: item.label,
    color: item.color,
    hidden: hidden.includes(item.id),
  }));
  const showLegend = legend !== false && series.length > 1;

  let content = null;
  if (layout && geometry) {
    const { plot } = layout;
    const { band, categoryAt, scales, domain } = geometry;
    const point = (category: number, value: number): [number, number] =>
      horizontal ? [value, category] : [category, value];
    const scaleOf = (item: XYSeries) => scales.get(item.axisId) ?? scales.get(axes[0].id)!;

    // Bars side by side: each stack is one bar, each series that is not stacked another
    const barSlots: string[] = [];
    for (const { series: item } of model.placed) {
      if (item.type !== 'histogram') continue;
      const slot = item.mode === 'stacked' ? `stack|${item.axisId}` : item.id;
      if (!barSlots.includes(slot)) barSlots.push(slot);
    }
    const padding = band > 12 ? Math.min(band * 0.12, 8) : band > 4 ? 1 : 0;
    const slotWidth = Math.max(1, (band - padding * 2) / Math.max(1, barSlots.length));

    const marks: React.ReactNode[] = [];
    const lines: React.ReactNode[] = [];
    const circles: React.ReactNode[] = [];
    const maxZ = Math.max(
      0,
      ...model.placed.flatMap(({ spans }) => spans.map((span) => span?.z ?? 0))
    );

    for (const { series: item, spans } of model.placed) {
      const scale = scaleOf(item);
      const dim = emphasized !== undefined && emphasized !== item.id;
      const className = `chtMark${dim ? ' chtDim' : ''}`;
      if (item.type === 'histogram') {
        const slot = barSlots.indexOf(item.mode === 'stacked' ? `stack|${item.axisId}` : item.id);
        spans.forEach((span, at) => {
          if (!span || span.y === null) return;
          const a = scale(span.from);
          const b = scale(span.to);
          const along = categoryAt(at) + padding + slot * slotWidth;
          // A hairline of surface between the pieces of a stack keeps neighbours apart
          const gap = item.mode === 'stacked' && Math.abs(a - b) > 3 ? 1 : 0;
          const low = Math.min(a, b);
          const size = Math.max(Math.abs(a - b) - gap, span.to === span.from ? 0 : 1);
          marks.push(
            <rect
              key={`${item.id}-${at}`}
              className={className}
              x={horizontal ? low + (span.to >= span.from ? gap : 0) : along}
              y={horizontal ? along : low}
              width={horizontal ? size : slotWidth - (slotWidth > 6 ? 1 : 0)}
              height={horizontal ? slotWidth - (slotWidth > 6 ? 1 : 0) : size}
              fill={item.color}
              rx={Math.min(2, slotWidth / 4)}
            />
          );
        });
        continue;
      }
      const centre = (at: number) => categoryAt(at) + (x.type === 'category' ? band / 2 : 0);
      const tops = spans.map((span, at) =>
        span && span.y !== null ? point(centre(at), scale(span.to)) : undefined
      );
      if (item.type === 'area') {
        // The area between the line and what it stands on
        let run: number[] = [];
        const flush = () => {
          if (run.length === 0) return;
          const upper = run.map((at) => tops[at]!);
          const lower = run
            .map((at) => point(centre(at), scale(spans[at]!.from)))
            .reverse();
          const outline =
            linePath(upper, item.interpolate, horizontal) +
            `L${lower.map((place) => `${place[0]},${place[1]}`).join('L')}Z`;
          marks.push(
            <path
              key={`${item.id}-area-${run[0]}`}
              className={className}
              d={outline}
              fill={item.color}
              fillOpacity={item.mode === 'stacked' ? 0.75 : 0.25}
            />
          );
          run = [];
        };
        spans.forEach((span, at) => {
          if (span && span.y !== null) run.push(at);
          else flush();
        });
        flush();
      }
      if (item.drawLines !== false) {
        lines.push(
          <path
            key={`${item.id}-line`}
            className={className}
            d={linePath(tops, item.interpolate, horizontal)}
            fill="none"
            stroke={item.color}
            strokeWidth={item.lineWidth ?? 2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        );
      }
      const sized = spans.some((span) => span?.z !== undefined);
      if (item.showCircles !== false && (sized || item.type === 'line' || spans.length < 60)) {
        tops.forEach((place, at) => {
          if (!place) return;
          const z = spans[at]?.z;
          const radius = z !== undefined && maxZ > 0 ? 3 + 14 * Math.sqrt(Math.max(0, z) / maxZ) : hover === at ? 4 : spans.length > 40 ? 0 : 2.5;
          if (radius <= 0) return;
          circles.push(
            <circle
              key={`${item.id}-dot-${at}`}
              className={className}
              cx={place[0]}
              cy={place[1]}
              r={radius}
              fill={item.color}
              fillOpacity={z !== undefined ? 0.6 : 1}
              stroke="var(--color-surface)"
              strokeWidth={z !== undefined ? 1 : 1.5}
            />
          );
        });
      }
    }

    // --- Axes ---
    const axisParts: React.ReactNode[] = [];
    const gridParts: React.ReactNode[] = [];
    const drawValueAxis = (axis: XYAxis, side: 'before' | 'after', offset: number) => {
      const axisDomain = model.domains.get(axis.id) ?? [0, 1];
      const scale = scales.get(axis.id)!;
      const ticks =
        axis.scale === 'log'
          ? logTicks(axisDomain)
          : niceTicks(axisDomain[0], axisDomain[1], Math.max(2, Math.floor((horizontal ? plot.width : plot.height) / 48)));
      const labels = axis.showLabels !== false;
      const format = axis.mode === 'percentage' ? (value: number) => `${Math.round(value * 100)}%` : axis.format;
      const widthOfLabels = layout.labelWidth(axis);
      ticks.forEach((tick) => {
        const at = scale(tick);
        if (grid.value && axis.id === axes[0].id) {
          gridParts.push(
            horizontal ? (
              <line key={`g-${axis.id}-${tick}`} className="chtGrid" x1={at} x2={at} y1={0} y2={plot.height} />
            ) : (
              <line key={`g-${axis.id}-${tick}`} className="chtGrid" x1={0} x2={plot.width} y1={at} y2={at} />
            )
          );
        }
        if (!labels) return;
        axisParts.push(
          horizontal ? (
            <text
              key={`t-${axis.id}-${tick}`}
              x={at}
              y={side === 'before' ? plot.height + offset + 13 : -offset - 5}
              textAnchor="middle"
            >
              {format(tick)}
            </text>
          ) : (
            <text
              key={`t-${axis.id}-${tick}`}
              x={side === 'before' ? -offset - 8 : plot.width + offset + 8}
              y={at + 4}
              textAnchor={side === 'before' ? 'end' : 'start'}
            >
              {fitText(format(tick), 96, FONT)}
            </text>
          )
        );
      });
      const used = horizontal ? (labels ? 18 : 0) : widthOfLabels + 8;
      if (axis.title) {
        const text = fitText(axis.title, (horizontal ? plot.width : plot.height) - 8, FONT);
        axisParts.push(
          horizontal ? (
            <text
              key={`title-${axis.id}`}
              className="chtAxisTitle"
              x={plot.width / 2}
              y={side === 'before' ? plot.height + offset + used + 13 : -offset - used - 5}
              textAnchor="middle"
            >
              {text}
            </text>
          ) : (
            <text
              key={`title-${axis.id}`}
              className="chtAxisTitle"
              textAnchor="middle"
              transform={`translate(${
                side === 'before' ? -offset - used - 6 : plot.width + offset + used + 12
              },${plot.height / 2}) rotate(-90)`}
            >
              {text}
            </text>
          )
        );
      }
      return used + (axis.title ? 18 : 0);
    };
    let offset = 0;
    for (const axis of layout.before) offset += drawValueAxis(axis, 'before', offset);
    offset = 0;
    for (const axis of layout.after) offset += drawValueAxis(axis, 'after', offset);

    // The category axis
    const categoryTicks: Array<{ at: number; label: string }> = [];
    if (layout.categoryLabels) {
      if (x.type === 'category') {
        const widest = Math.min(140, Math.max(...x.values.map((value) => textWidth(x.format(value), FONT))));
        const every = horizontal ? Math.max(1, Math.ceil(16 / band)) : Math.max(1, Math.ceil((Math.min(widest, 96) + 12) / band));
        x.values.forEach((value, at) => {
          if (at % every === 0) categoryTicks.push({ at: categoryAt(at) + band / 2, label: x.format(value) });
        });
      } else if (domain) {
        const sample = textWidth(x.format(domain[0]), FONT) + 24;
        const wanted = Math.max(2, Math.floor(geometry.length / (horizontal ? 28 : sample)));
        const ticks = x.type === 'time' ? timeTicks(domain[0], domain[1], wanted) : niceTicks(domain[0], domain[1], wanted);
        const factor = geometry.length / (domain[1] - domain[0] || 1);
        for (const tick of ticks) categoryTicks.push({ at: (tick - domain[0]) * factor, label: x.format(tick) });
      }
    }
    for (const tick of categoryTicks) {
      if (grid.category) {
        gridParts.push(
          horizontal ? (
            <line key={`cg-${tick.at}`} className="chtGrid" x1={0} x2={plot.width} y1={tick.at} y2={tick.at} />
          ) : (
            <line key={`cg-${tick.at}`} className="chtGrid" x1={tick.at} x2={tick.at} y1={0} y2={plot.height} />
          )
        );
      }
      axisParts.push(
        horizontal ? (
          <text key={`c-${tick.at}`} x={-8} y={tick.at + 4} textAnchor="end">
            {fitText(tick.label, 140, FONT)}
          </text>
        ) : (
          <text key={`c-${tick.at}`} x={tick.at} y={plot.height + 15} textAnchor="middle">
            {fitText(tick.label, Math.max(40, x.type === 'category' ? Math.max(band, 96) : 160), FONT)}
          </text>
        )
      );
    }
    if (layout.categoryShown && x.title) {
      axisParts.push(
        horizontal ? (
          <text
            key="category-title"
            className="chtAxisTitle"
            textAnchor="middle"
            transform={`translate(${-plot.left + 14},${plot.height / 2}) rotate(-90)`}
          >
            {fitText(x.title, plot.height - 8, FONT)}
          </text>
        ) : (
          <text
            key="category-title"
            className="chtAxisTitle"
            x={plot.width / 2}
            y={plot.height + (layout.categoryLabels ? 18 : 0) + 15}
            textAnchor="middle"
          >
            {fitText(x.title, plot.width - 8, FONT)}
          </text>
        )
      );
    }

    // --- The pointer ---
    const placeOf = (event: ReactMouseEvent<SVGRectElement>) => {
      const box = event.currentTarget.getBoundingClientRect();
      return horizontal ? event.clientY - box.top : event.clientX - box.left;
    };
    const indexAt = (along: number) => {
      let best = 0;
      let distance = Infinity;
      for (let at = 0; at < x.values.length; at += 1) {
        const centre = categoryAt(at) + band / 2;
        const d = Math.abs(centre - along);
        if (d < distance) {
          distance = d;
          best = at;
        }
      }
      return best;
    };
    const valueAt = (along: number) => (domain ? domain[0] + (along / geometry.length) * (domain[1] - domain[0]) : 0);

    const onMove = (event: ReactMouseEvent<SVGRectElement>) => {
      const along = placeOf(event);
      if (drag.current) {
        if (Math.abs(along - drag.current.start) > 4) drag.current.moved = true;
        if (drag.current.moved) {
          setBrush({ start: drag.current.start, end: along });
          tip.hide();
          return;
        }
      }
      const at = indexAt(along);
      setHover(at);
      if (!tooltip) return;
      tip.show({
        title: `${x.title ? `${x.title}: ` : ''}${x.format(x.values[at])}`,
        rows: model.placed
          .filter(({ spans }) => spans[at] && spans[at]!.y !== null)
          .map(({ series: item, spans }) => {
            const axis = axes.find((candidate) => candidate.id === item.axisId) ?? axes[0];
            return {
              label: item.label,
              value: axis.format(spans[at]!.y as number),
              color: item.color,
              active: emphasized === item.id,
            };
          }),
        x: event.clientX,
        y: event.clientY,
      });
    };

    const onUp = (event: ReactMouseEvent<SVGRectElement>) => {
      const along = placeOf(event);
      const dragged = drag.current;
      drag.current = undefined;
      setBrush(undefined);
      if (dragged?.moved && onBrush && domain) {
        const from = valueAt(Math.max(0, Math.min(dragged.start, along)));
        const to = valueAt(Math.min(geometry.length, Math.max(dragged.start, along)));
        if (to > from) onBrush(from, to);
        return;
      }
      if (!onPointClick) return;
      const at = indexAt(along);
      const box = event.currentTarget.getBoundingClientRect();
      const across = horizontal ? event.clientX - box.left : event.clientY - box.top;
      // The series whose mark the pointer is on, or else the nearest one
      let chosen: Placed | undefined;
      let nearest = Infinity;
      for (const entry of model.placed) {
        const span = entry.spans[at];
        if (!span || span.y === null) continue;
        const scale = scaleOf(entry.series);
        const a = scale(span.from);
        const b = scale(span.to);
        const inside = across >= Math.min(a, b) && across <= Math.max(a, b);
        const distance = inside && entry.series.type !== 'line' ? 0 : Math.abs(across - b);
        if (distance < nearest) {
          nearest = distance;
          chosen = entry;
        }
      }
      if (chosen) {
        const original = chosen.series.points.find((candidate) => candidate.x === x.values[at]);
        if (original) onPointClick(chosen.series, original);
      }
    };

    const now = Date.now();
    const thresholdAt = threshold ? scales.get(axes[0].id)!(threshold.value) : undefined;
    content = (
      <svg width={width} height={height} role="img" aria-label="Chart" data-test-subj={testId}>
        <g transform={`translate(${plot.left},${plot.top})`}>
          <g>{gridParts}</g>
          {hover !== undefined && !brush && (
            <rect
              className="chtBand"
              x={horizontal ? 0 : categoryAt(hover)}
              y={horizontal ? categoryAt(hover) : 0}
              width={horizontal ? plot.width : band}
              height={horizontal ? band : plot.height}
            />
          )}
          <g>{marks}</g>
          <g>{lines}</g>
          <g>{circles}</g>
          {horizontal ? (
            <line className="chtAxisLine" x1={0} x2={0} y1={0} y2={plot.height} />
          ) : (
            <line className="chtAxisLine" x1={0} x2={plot.width} y1={plot.height} y2={plot.height} />
          )}
          {thresholdAt !== undefined && threshold && (
            <line
              x1={horizontal ? thresholdAt : 0}
              x2={horizontal ? thresholdAt : plot.width}
              y1={horizontal ? 0 : thresholdAt}
              y2={horizontal ? plot.height : thresholdAt}
              stroke={threshold.color ?? 'var(--color-critical)'}
              strokeWidth={threshold.width ?? 1}
              strokeDasharray={threshold.style === 'dashed' ? '6 4' : threshold.style === 'dot-dashed' ? '2 3 8 3' : undefined}
            />
          )}
          {nowMarker && domain && x.type === 'time' && now >= domain[0] && now <= domain[1] && !horizontal && (
            <line
              className="chtNowLine"
              x1={((now - domain[0]) / (domain[1] - domain[0])) * plot.width}
              x2={((now - domain[0]) / (domain[1] - domain[0])) * plot.width}
              y1={0}
              y2={plot.height}
            />
          )}
          {brush && (
            <rect
              className="chtBrush"
              x={horizontal ? 0 : Math.min(brush.start, brush.end)}
              y={horizontal ? Math.min(brush.start, brush.end) : 0}
              width={horizontal ? plot.width : Math.abs(brush.end - brush.start)}
              height={horizontal ? Math.abs(brush.end - brush.start) : plot.height}
            />
          )}
          <g className="chtAxis">{axisParts}</g>
          <rect
            x={0}
            y={0}
            width={plot.width}
            height={plot.height}
            fill="transparent"
            className={onPointClick || onBrush ? 'chtClickable' : undefined}
            style={onBrush && domain ? { cursor: 'crosshair' } : undefined}
            onMouseMove={onMove}
            onMouseLeave={() => {
              setHover(undefined);
              tip.hide();
              if (!drag.current?.moved) drag.current = undefined;
            }}
            onMouseDown={(event) => {
              if (onBrush && domain) drag.current = { start: placeOf(event), moved: false };
            }}
            onMouseUp={onUp}
          />
        </g>
      </svg>
    );
  }

  return (
    <ChartFrame
      position={legend || 'right'}
      legend={
        showLegend ? (
          <Legend
            items={legendItems}
            position={legend || 'right'}
            onHover={setEmphasized}
            onToggle={(id) =>
              setHidden((current) =>
                current.includes(id) ? current.filter((other) => other !== id) : [...current, id]
              )
            }
          />
        ) : undefined
      }
    >
      <div ref={ref} className="chtPlot">
        {content}
      </div>
      <ChartTooltip content={tip.content} />
    </ChartFrame>
  );
}

function guessInterval(values: number[]): number {
  let smallest = Infinity;
  for (let at = 1; at < values.length; at += 1) {
    const step = values[at] - values[at - 1];
    if (step > 0 && step < smallest) smallest = step;
  }
  return Number.isFinite(smallest) ? smallest : 1;
}

function logTicks(domain: [number, number]): number[] {
  const ticks: number[] = [];
  const low = Math.max(domain[0], 1e-9);
  for (let power = Math.floor(Math.log10(low)); power <= Math.ceil(Math.log10(Math.max(domain[1], low))); power += 1) {
    const tick = 10 ** power;
    if (tick >= low * 0.999 && tick <= domain[1] * 1.001) ticks.push(tick);
  }
  return ticks.length ? ticks : [low, domain[1]];
}

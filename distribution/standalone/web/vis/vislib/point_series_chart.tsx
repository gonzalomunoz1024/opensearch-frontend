/* SPDX-License-Identifier: Apache-2.0 */

/*
 * A line, area or bar chart drawn as vislib draws it (its PointSeries, ColumnChart, LineChart and
 * AreaChart, its axes, grid, end zones, time marker, threshold line and brush): the layout of
 * point_series_layout, the scales of point_series_model, and the marks at the places vislib's
 * arithmetic puts them, with its attributes and classes. Pointing at a mark or a name of the
 * legend dims the other series; the tooltip shows the mark's bucket, value and size, and over a
 * zone the time range does not fully cover, a warning above them. A split draws a chart per bucket
 * in the frame of vislib's column layout, on the axes they share, with one legend for them all and
 * the title of each chart beside its row or under its column.
 */

import { useCallback, useId, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { useSize } from '../../charts/core';
import type { AxisScaleInfo, AxisTick, DrawnAxis } from './axis';
import { isHorizontal, titleSize } from './axis';
import { HandlerError } from './handler_error';
import { VisLegend, type LegendPosition, type VisLegendProps } from './legend';
import { layoutPointSeries, type LayoutAxisInput, type PlacedAxis, type PlacedSplitTitles, type Rect } from './point_series_layout';
import {
  axisPoints,
  scaleCategoryAxis,
  scaleValueAxis,
  valueDomain,
  VislibError,
  type CategoryAxisModel,
  type PointSeriesModel,
  type ScaledCategoryAxis,
  type ScaledValueAxis,
  type SeriesConfig,
} from './point_series_model';
import type { VislibPoint } from './point_series_data';
import { utcTicks, type ZoneOffset } from './scales';
import { areaPath, linePath } from './shapes';
import { cutSplitTitle, splitTitleRowHeight, splitTitleTooltip } from './split';
import { LABEL_FONT, measureText } from './text';
import { VislibTooltip, type Placement, type TooltipDetail, type TooltipState } from './tooltip';

const GUTTER = 0.15;
const AXIS_COLOR = '#ddd';
/** The values written in a heat map's squares, in the chart's own text */
const CELL_FONT = { size: '14px' };
/** The room a value written in a square leaves to its edges */
const CELL_PADDING = 5;

/** A brush along an ordered axis: the times it spans, or the values of the buckets it takes */
export type BrushRange = { from: number; to: number } | { values: Array<number | string> };

/** One chart of a split, drawn on the axes the charts share */
export interface PointSeriesChartPart {
  /** The chart's own series, its dots sized by them, over the axes and values the charts share */
  model: PointSeriesModel;
  /** The title of its chart: its bucket and the split's name */
  title?: string;
  /** The last line of its tooltip: the split's name and the chart's bucket */
  splitDetail?: TooltipDetail;
  onPointClick?: (point: VislibPoint, series: SeriesConfig) => void;
  onBrush?: (range: BrushRange) => void;
}

export interface PointSeriesChartProps {
  /**
   * The chart; in a split, what its charts share: the axes, the values along them, the legend's
   * names, and the series of all of them, which the value axes reach
   */
  model: PointSeriesModel;
  /** The charts of a split, in their order */
  charts?: PointSeriesChartPart[];
  /** In a split, whether its charts are rows, one under another, or columns side by side */
  rows?: boolean;
  colorOf: (label: string) => string;
  /** The zone dates are shown in, as minutes east of UTC at a moment */
  offsetAt: ZoneOffset;
  /** The setting visualization:dimmingOpacity */
  dimming: number;
  legend?: Omit<VisLegendProps, 'labels' | 'colorOf' | 'opacityOf' | 'onHighlight'>;
  /** A click on a mark of the chart that is not split */
  onPointClick?: (point: VislibPoint, series: SeriesConfig) => void;
  /** A brush along the ordered axis of the chart that is not split */
  onBrush?: (range: BrushRange) => void;
  /** The time of the time marker: now */
  now?: number;
}

interface Hover {
  label?: string;
  /** Once a series has been pointed at, the marks keep the opacity it left them */
  touched: boolean;
}

/** EUI's test of a dark colour, for the labels written on stacked bars */
export function isColorDark(red: number, green: number, blue: number): boolean {
  const [r, g, b] = [red, green, blue]
    .map((channel) => channel / 255)
    .map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b <= 0.179;
}

function rgbOf(color: string): [number, number, number] {
  const hex = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(color.trim());
  if (hex) {
    const value = hex[1].length === 3 ? hex[1].split('').map((c) => c + c).join('') : hex[1];
    return [0, 2, 4].map((at) => parseInt(value.slice(at, at + 2), 16)) as [number, number, number];
  }
  const rgb = /rgba?\(([^)]+)\)/i.exec(color);
  if (rgb) {
    const parts = rgb[1].split(/[ ,/]+/).map(Number);
    return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
  }
  return [0, 0, 0];
}

/** How many bars stand side by side in a bucket: one per series of bars, one per stack */
export function groupedCount(series: SeriesConfig[], firstAxisId: string): number {
  const stacks: string[] = [];
  return series.reduce((sum, item) => {
    const axis = item.valueAxis || firstAxisId;
    if (item.type !== 'histogram') return sum;
    if (item.mode === 'stacked' && stacks.includes(axis)) return sum;
    if (item.mode === 'stacked') stacks.push(axis);
    return sum + 1;
  }, 0);
}

/**
 * Which place in the bucket a series's bars take, as vislib counts it: every series counts, of
 * whatever kind, and a stack takes the place of its first series
 */
export function groupedNum(series: SeriesConfig[], firstAxisId: string, seriesId: string | undefined): number {
  let index = 0;
  const stacks = new Map<string, number>();
  for (const item of series) {
    const axis = item.valueAxis || firstAxisId;
    if (item.mode !== 'stacked') {
      if (item.data.rawId === seriesId) return index;
      index += 1;
    } else {
      if (!stacks.has(axis)) {
        stacks.set(axis, index);
        index += 1;
      }
      if (item.data.rawId === seriesId) return stacks.get(axis) ?? 0;
    }
  }
  return 0;
}

const translate = (x: number, y: number) => `translate(${x},${y})`;

function AxisSvg({ placed, drawn, rect }: { placed: PlacedAxis; drawn: DrawnAxis; rect: Rect }) {
  const { config } = placed.input;
  const horizontal = isHorizontal(config);
  const scale = placed.scale as AxisScaleInfo;
  const tickTransform = (tick: AxisTick) => (horizontal ? translate(scale.at(tick.value), 0) : translate(0, scale.at(tick.value)));
  return (
    <svg
      className="visAxis__svg"
      focusable="false"
      width={rect.width}
      height={rect.height}
      style={{ left: rect.x, top: rect.y }}
    >
      <g className={`${horizontal ? 'x' : 'y'} axis ${config.id}`} transform={placed.transform}>
        {drawn.ticks.map((tick, index) => (
          <g key={`${String(tick.value)}-${index}`} className="tick" transform={tickTransform(tick)}>
            <line x2={tick.x2} y2={tick.y2} style={{ stroke: AXIS_COLOR, strokeWidth: '1px', strokeOpacity: 1 }} />
            <text
              x={tick.x}
              y={tick.y}
              dy={tick.dy}
              transform={tick.transform}
              style={config.labels.show ? { textAnchor: tick.anchor, fontSize: LABEL_FONT.size } : { display: 'none' }}
            >
              {tick.text}
            </text>
          </g>
        ))}
        <path
          className="domain"
          d={drawn.path}
          transform={placed.pathTransform}
          style={{ stroke: AXIS_COLOR, strokeWidth: '1px', strokeOpacity: 1 }}
        />
      </g>
    </svg>
  );
}

function TitleSvg({ placed, rect }: { placed: PlacedAxis; rect: Rect }) {
  const title = placed.title;
  if (!title) return null;
  const horizontal = isHorizontal(placed.input.config);
  return (
    <svg
      className={`visAxis__svg axis-title ${horizontal ? 'x' : 'y'}-axis-title`}
      focusable="false"
      width={horizontal ? rect.width : titleSize(title.text)}
      height={rect.height}
      style={{ left: rect.x, top: rect.y }}
    >
      <text transform={title.transform} textAnchor="middle" dominantBaseline="hanging">
        {title.text}
      </text>
    </svg>
  );
}

/**
 * The titles of a split's charts as vislib's ChartTitle draws them: each in its room beside its
 * row or under its column, in an SVG as large as the first title's room was, its text cut to nine
 * tenths of it; a title that was cut shows the whole of itself in the tooltip
 */
function SplitChartTitles({
  placed,
  rows,
  labels,
  onTooltip,
}: {
  placed: PlacedSplitTitles;
  rows: boolean;
  labels: string[];
  onTooltip: (state: TooltipState | undefined) => void;
}) {
  const { width, height } = placed;
  return (
    <>
      {placed.boxes.map((box, index) => {
        const label = labels[index] ?? '';
        const title = cutSplitTitle(label, rows ? height : width);
        return (
          <div key={index} className="chart-title" style={{ left: box.x, top: box.y, width: box.width, height: box.height }}>
            <svg width={width} height={height} focusable="false">
              <text
                transform={rows ? `translate(11,${height / 2})rotate(270)` : `translate(${width / 2},11)`}
                textAnchor="middle"
                onMouseMove={title.cut ? (event) => onTooltip(splitTitleTooltip(label, event.clientX, event.clientY)) : undefined}
                onMouseLeave={title.cut ? () => onTooltip(undefined) : undefined}
              >
                {title.text}
              </text>
            </svg>
          </div>
        );
      })}
    </>
  );
}

interface Scaled {
  values: Map<string, ScaledValueAxis>;
  /** The first axis of names, along which the marks stand */
  category: ScaledCategoryAxis;
  /** Every axis of names, at the size of the chart */
  categories: ScaledCategoryAxis[];
}

interface ChartCanvasProps {
  part: PointSeriesChartPart;
  /** What the charts share, with every chart's series, which the value axes reach */
  frame: PointSeriesModel;
  rect: Rect;
  scaled: Scaled;
  colorOf: (label: string) => string;
  markOpacity: (label: string) => number | undefined;
  onHighlight: (label: string | undefined) => void;
  onTooltip: (state: TooltipState | undefined) => void;
  now?: number;
}

/** A chart's marks, grid, end zones, threshold, time marker and brush, in its rectangle */
function ChartCanvas({ part, frame, rect: chart, scaled, colorOf, markOpacity, onHighlight: highlight, onTooltip: setTooltip, now }: ChartCanvasProps) {
  const { model, onPointClick, onBrush, splitDetail } = part;
  const clipId = `chart-area${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const chartRef = useRef<HTMLDivElement>(null);
  const [brush, setBrush] = useState<{ start: number; end: number }>();
  const firstAxisId = model.valueAxes[0]?.config.id ?? 'ValueAxis-1';

  const category = scaled.category;
  const categoryConfig = model.categoryAxes[0]?.config;
  const horizontal = categoryConfig ? isHorizontal(categoryConfig) : true;
  const time = category.time;
  const band = category.band;
  const ordered = model.ordered;
  const xAt = (x: number | string) => (time ? time(Number(x)) : band ? band(String(x)) : 0);
  const centreAt = (x: number | string) => (time ? time(Number(x)) : band ? band(String(x)) + band.band / 2 : 0);
  const valueScaleOf = (item: SeriesConfig) =>
    scaled.values.get(item.valueAxis && scaled.values.has(item.valueAxis) ? item.valueAxis : firstAxisId) ?? [...scaled.values.values()][0];
  const groupCount = groupedCount(model.series, firstAxisId);

  // Bars over time are as wide as an interval less a gutter, shared by the bars of a bucket
  let barWidth = 0;
  let gutterWidth = 0;
  if (time && ordered) {
    const min = ordered.min ?? time.domain[0];
    const intervalWidth = Math.abs(time(min + ordered.interval) - time(min));
    gutterWidth = intervalWidth * GUTTER;
    barWidth = (intervalWidth - gutterWidth) / groupCount;
  }
  const datumWidth = (point: VislibPoint, next: VislibPoint | undefined) => {
    let width = barWidth;
    if (next && time) {
      width = (time(Number(next.x)) - time(Number(point.x)) - gutterWidth) / groupCount;
      if (width > barWidth) width = barWidth;
    }
    return width;
  };

  const tooltipFor = (point: VislibPoint): TooltipDetail[] | undefined => {
    if (!model.tooltip) return undefined;
    const series = model.data.series.find((candidate) => candidate.rawId === point.seriesId);
    // A zero put in to stack belongs to no series: the original's tooltip fails on it and shows nothing
    if (!series) return undefined;
    const details: TooltipDetail[] = [];
    if (point.x !== null && point.x !== undefined) {
      details.push({ label: model.data.xLabel, value: model.categoryAxes[0]?.format(point.x) ?? String(point.x) });
    }
    if (point.y !== null && point.y !== undefined) {
      const label = model.data.columnCount > 2 ? series.metric.name : series.label;
      details.push({ label, value: series.format(point.y) });
    }
    if (point.z !== null && point.z !== undefined && series.zFormat) {
      details.push({ label: series.zLabel ?? '', value: series.zFormat(point.z) });
    }
    const parent = model.data.groupColumns[0];
    if (parent && point.series) details.push({ label: parent.name, value: point.series });
    if (splitDetail) details.push(splitDetail);
    return details;
  };

  // The end zones: the parts of the axis the time range does not fully cover
  let endzones: { left: { x: number; w: number }; right: { x: number; w: number }; inverted: boolean } | undefined;
  if (time && ordered && ordered.endzones !== false && ordered.min !== undefined && ordered.max !== undefined && categoryConfig) {
    const inverted = horizontal || categoryConfig.scale.inverted;
    const extent = horizontal ? chart.width : chart.height;
    const left = {
      x: inverted ? 0 : Math.max(time(ordered.min), 0),
      w: inverted ? Math.max(time(ordered.min), 0) : chart.height - Math.max(time(ordered.min), 0),
    };
    const values = model.xValues.map(Number);
    const last = values[values.length - 1];
    const rightLast = categoryConfig.scale.expandLastBucket ? ordered.max : Math.min(ordered.max, last);
    const rightStart = rightLast + 1;
    const right = {
      x: inverted ? time(rightStart) : 0,
      w: inverted ? Math.max(extent - time(rightStart), 0) : time(rightStart),
    };
    endzones = { left, right, inverted };
  }
  const endzoneHeader = (along: number, bucket?: VislibPoint): string | undefined => {
    if (!endzones || !time || !ordered) return undefined;
    const min = endzones.inverted ? endzones.left.w : endzones.right.w;
    const max = endzones.inverted ? endzones.right.x : endzones.left.x;
    let xLeft = along;
    let xRight = along;
    const whole = Boolean(bucket && bucket.x !== null && bucket.x !== undefined);
    if (bucket && whole) {
      xLeft = time(Number(bucket.x));
      xRight = time(ordered.addInterval(Number(bucket.x), 1));
    }
    if (!(min > xLeft || max < xRight)) return undefined;
    return `${whole ? 'Part of this bucket' : 'This area'} may contain partial data. The selected time range does not fully cover it.`;
  };
  const alongOf = (event: ReactMouseEvent) => {
    const box = chartRef.current?.getBoundingClientRect();
    if (!box) return 0;
    return horizontal ? event.clientX - box.left : event.clientY - box.top;
  };

  const showTip = (event: ReactMouseEvent, item?: SeriesConfig, point?: VislibPoint) => {
    const details = item && point ? tooltipFor(point) : undefined;
    const header = endzoneHeader(alongOf(event), point);
    if (!header && !details?.length) {
      setTooltip(undefined);
      return;
    }
    setTooltip({ clientX: event.clientX, clientY: event.clientY, header, details: details ?? [] });
  };
  const markEvents = (item: SeriesConfig, point: VislibPoint) => ({
    onMouseOver: model.hover ? () => highlight(item.data.label) : undefined,
    onMouseOut: model.hover ? () => highlight(undefined) : undefined,
    onMouseMove: (event: ReactMouseEvent) => {
      event.stopPropagation();
      showTip(event, item, point);
    },
    onMouseLeave: () => setTooltip(undefined),
    onClick: onPointClick ? () => onPointClick(point, item) : undefined,
    style: { cursor: onPointClick && model.hover ? 'pointer' : undefined, opacity: markOpacity(item.data.label) },
  });

  const marks: ReactNode[] = [];
  const thresholds: ReactNode[] = [];
  model.series.forEach((item, index) => {
    if (!item.show) return;
    const axis = valueScaleOf(item);
    if (!axis) return;
    const y = axis.scale;
    const color = colorOf(item.data.label);
    const label = item.data.label;
    const key = `${item.data.rawId}-${index}`;
    if (item.type === 'histogram') {
      const bars = item.data.values.filter((point) => point.y !== null);
      const stacked = item.mode === 'stacked';
      const yMin = y.domain[0];
      const axisConfig = model.valueAxes.find((candidate) => candidate.config.id === (item.valueAxis || firstAxisId))?.config;
      const logBase = axisConfig?.scale.type === 'log' ? 1 : 0;
      const widthOf = (point: VislibPoint, at: number) => (time ? datumWidth(point, bars[at + 1]) : (band?.band ?? 0) / groupCount);
      const xOf = (point: VislibPoint, at: number) => {
        const groupNum = groupedNum(model.series, firstAxisId, point.seriesId);
        return time ? xAt(point.x) + datumWidth(point, bars[at + 1]) * groupNum : xAt(point.x) + ((band?.band ?? 0) / groupCount) * groupNum;
      };
      const yOf = (point: VislibPoint) => {
        const value = point.y ?? 0;
        const base = point.y0 ?? 0;
        if (stacked) {
          if ((horizontal && value < 0) || (!horizontal && value > 0)) return y(base);
          return y(base + value);
        }
        if ((horizontal && value < 0) || (!horizontal && value > 0)) return y(0);
        return y(value);
      };
      const heightOf = (point: VislibPoint) => {
        const value = point.y ?? 0;
        const base = point.y0 ?? 0;
        if (stacked) {
          if (point.y0 === 0 && yMin > 0) return y(yMin) - y(value);
          return Math.abs(y(base) - y(base + value));
        }
        return Math.abs(y(logBase) - y(value));
      };
      const texts: ReactNode[] = [];
      const rects = bars.map((point, at) => {
        const bx = xOf(point, at);
        const bw = widthOf(point, at);
        const by = yOf(point);
        const bh = heightOf(point);
        if (model.valueLabels) {
          const text = item.data.format(point.y ?? 0);
          const box = measureText(text, LABEL_FONT);
          const boxHeight = box.ascent + box.descent;
          if (stacked) {
            const [r, g, b] = rgbOf(color);
            const hidden = horizontal ? box.width > bw || boxHeight > bh : box.width > bh || boxHeight > bw;
            texts.push(
              <text
                key={`label-${at}`}
                className={`visColumnChart__barLabel visColumnChart__barLabel--stack ${isColorDark(r, g, b) ? 'visColumnChart__bar-label--light' : 'visColumnChart__bar-label--dark'}`}
                x={horizontal ? bx + bw / 2 : by + bh / 2}
                y={horizontal ? by + bh / 2 : bx + bw / 2}
                display={hidden ? 'none' : 'block'}
              >
                {text}
              </text>
            );
          } else {
            const value = point.y ?? 0;
            const labelY = horizontal
              ? value >= 0
                ? by - 4
                : by + bh + boxHeight
              : value >= 0
                ? by + bh + 4
                : by - box.width - 4;
            const hidden = horizontal ? box.width > bw : boxHeight > bw;
            texts.push(
              <text
                key={`label-${at}`}
                className="visColumnChart__barLabel"
                x={horizontal ? bx + bw / 2 : labelY}
                y={horizontal ? labelY : bx + bw / 2}
                dominantBaseline={horizontal ? 'auto' : 'central'}
                textAnchor={horizontal ? 'middle' : 'start'}
                fill={color}
                display={hidden ? 'none' : 'block'}
              >
                {text}
              </text>
            );
          }
        }
        return (
          <rect
            key={at}
            data-label={label}
            fill={color}
            stroke={color}
            x={horizontal ? bx : by}
            width={horizontal ? bw : bh}
            y={horizontal ? by : bx}
            height={horizontal ? bh : bw}
            {...markEvents(item, point)}
          />
        );
      });
      marks.push(
        <g key={key}>
          <g className="series histogram" clipPath={`url(#${clipId})`}>
            {rects}
            {texts}
          </g>
        </g>
      );
    } else if (item.type === 'heatmap') {
      // A square for each value, in the colour of the range it falls in, on the row of its series
      const coloring = model.heatmap;
      const rows = scaled.categories[1]?.band;
      if (!coloring || !rows) return;
      let squareWidth = band?.band ?? 0;
      if (time && ordered) {
        // Over time, as wide as an interval from the start of the axis
        const start = ordered.min ?? time.domain[0];
        const width = time(ordered.addInterval(start, 1)) - time(start);
        squareWidth = (horizontal ? width : -width) || squareWidth;
      }
      const squareHeight = rows.band;
      const radians = (coloring.rotate * Math.PI) / 180;
      const maxLength = Math.min(Math.abs(squareWidth / Math.cos(radians)), Math.abs(squareHeight / Math.sin(radians))) - CELL_PADDING;
      const maxHeight = Math.min(Math.abs(squareWidth / Math.sin(radians)), Math.abs(squareHeight / Math.cos(radians))) - CELL_PADDING;
      const squares = item.data.values.map((point, at) => {
        const bucket = coloring.bucketOf(point.y);
        const name = coloring.labels[bucket];
        const hidden = bucket < 0;
        // A range with no name is see-through; a value in no range has no colour
        const fill = name === '' ? 'transparent' : name === undefined ? undefined : colorOf(name);
        const sx = xAt(point.x);
        const sy = rows(point.series);
        let text: ReactNode = null;
        if (coloring.showLabels) {
          const written = coloring.format(point.y ?? NaN);
          const box = measureText(written, CELL_FONT);
          const tooBig = box.width > maxLength || box.ascent + box.descent > maxHeight;
          const rgb = fill ? /rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/.exec(fill) : null;
          const cx = sx + squareWidth / 2;
          const cy = sy + squareHeight / 2;
          text = (
            <text
              x={cx}
              y={cy}
              transform={`rotate(${coloring.rotate},${cx},${cy})`}
              style={{
                display: hidden || tooBig ? 'none' : 'initial',
                dominantBaseline: 'central',
                textAnchor: 'middle',
                fill: coloring.labelColor ?? (rgb && isColorDark(Number(rgb[1]), Number(rgb[2]), Number(rgb[3])) ? '#FFF' : '#222'),
              }}
            >
              {written}
            </text>
          );
        }
        const named = name !== undefined && name !== '';
        return (
          <g
            key={at}
            className="square"
            onMouseMove={(event) => {
              event.stopPropagation();
              showTip(event, item, point);
            }}
            onMouseLeave={() => setTooltip(undefined)}
          >
            <rect
              x={sx}
              width={squareWidth}
              y={sy}
              height={squareHeight}
              data-label={name}
              fill={fill}
              style={{
                cursor: 'pointer',
                stroke: 'black',
                strokeWidth: '0.1px',
                display: hidden ? 'none' : 'initial',
                opacity: name !== undefined ? markOpacity(name) : undefined,
              }}
              onMouseOver={model.hover && named ? () => highlight(name) : undefined}
              onMouseOut={model.hover ? () => highlight(undefined) : undefined}
              onClick={onPointClick ? () => onPointClick(point, item) : undefined}
            />
            {text}
          </g>
        );
      });
      marks.push(
        <g key={key}>
          <g className="series">{squares}</g>
        </g>
      );
    } else if (item.type === 'line') {
      const cx = (point: VislibPoint) => centreAt(point.x);
      const cy = (point: VislibPoint) => y((point.y0 || 0) + (point.y || 0));
      const path = item.drawLinesBetweenPoints
        ? linePath(
            item.data.values.map((point) => (point.y === null ? undefined : horizontal ? [cx(point), cy(point)] : [cy(point), cx(point)])),
            item.interpolate
          )
        : null;
      const radii = model.radii;
      const radiusStep = (radii.max - radii.min || radii.max * 100) / Math.pow(item.radiusRatio, 2);
      const radius = (point: VislibPoint, modifier = 0) => {
        const circleRadius = point.z === undefined ? NaN : (point.z - radii.min) / radiusStep;
        const base = circleRadius ? Math.sqrt(circleRadius + 2) + item.lineWidth : item.lineWidth;
        const candidates = [base, chart.width, chart.height].filter((value) => !Number.isNaN(value));
        return Math.min(...candidates) + modifier;
      };
      const points = item.data.values.filter((point) => point.y !== null && (point.y || !point.y0));
      const place = (point: VislibPoint) => (horizontal ? { cx: cx(point), cy: cy(point) } : { cx: cy(point), cy: cx(point) });
      marks.push(
        <g key={key}>
          {path !== null && (
            <g className="pathgroup lines" clipPath={`url(#${clipId})`}>
              <path
                data-label={label}
                d={path}
                fill="none"
                stroke={color}
                strokeWidth={item.lineWidth}
                style={{ opacity: markOpacity(label) }}
              />
            </g>
          )}
          <g className="points line" clipPath={`url(#${clipId})`}>
            {points.map((point, at) => (
              <circle
                key={`d${at}`}
                r={radius(point)}
                fillOpacity={item.drawLinesBetweenPoints ? 1 : 0.7}
                {...place(point)}
                className="circle-decoration"
                data-label={label}
                fill={item.showCircles ? color : 'none'}
                style={{ opacity: markOpacity(label) }}
              />
            ))}
            {points.map((point, at) => (
              <circle
                key={`h${at}`}
                r={radius(point, 10)}
                {...place(point)}
                fill="transparent"
                className="circle"
                data-label={label}
                stroke={color}
                strokeWidth={0}
                {...markEvents(item, point)}
              />
            ))}
          </g>
        </g>
      );
    } else {
      const overlapping = item.mode !== 'stacked';
      const x = (point: VislibPoint) => centreAt(point.x);
      const upper = (point: VislibPoint) => y((point.y0 || 0) + (point.y || 0));
      const lower = (point: VislibPoint) => y(point.y0 || 0);
      const d = areaPath(
        item.data.values.map((point) => {
          if (point.y === null) return undefined;
          return horizontal
            ? { from: [x(point), lower(point)] as [number, number], to: [x(point), upper(point)] as [number, number] }
            : { from: [lower(point), x(point)] as [number, number], to: [upper(point), x(point)] as [number, number] };
        }),
        item.interpolate
      );
      const circles = item.data.values.filter((point) => point.y !== 0 && point.y !== null);
      const cy = (point: VislibPoint) => (overlapping ? y(point.y || 0) : y((point.y0 ?? NaN) + (point.y || 0)));
      marks.push(
        <g key={key}>
          <g className="series series-0">
            <path
              data-label={label}
              className={overlapping ? 'visAreaChart__overlapArea' : undefined}
              clipPath={`url(#${clipId})`}
              d={d ?? undefined}
              style={{ fill: color, stroke: color, strokeWidth: '1px', opacity: markOpacity(label) }}
              onMouseOver={() => highlight(label)}
              onMouseOut={() => highlight(undefined)}
            />
          </g>
          <g className="points area" clipPath={`url(#${clipId})`}>
            {circles.map((point, at) => (
              <circle
                key={at}
                data-label={label}
                stroke={color}
                fill="transparent"
                strokeWidth={0}
                cx={horizontal ? x(point) : cy(point)}
                cy={horizontal ? cy(point) : x(point)}
                r={12}
                {...markEvents(item, point)}
              />
            ))}
          </g>
        </g>
      );
    }
    // Each series draws the threshold line again, when it falls within the values of its axis
    if (model.threshold) {
      const config = model.valueAxes.find((candidate) => candidate.config.id === (item.valueAxis || firstAxisId))?.config ?? model.valueAxes[0]?.config;
      if (config) {
        const domain = valueDomain(config, axisPoints(frame, config.id), item.data.values.length);
        const value = model.threshold.value;
        if (domain[0] <= value && domain[1] >= value) {
          const at = y(value);
          thresholds.push(
            <line
              key={`threshold-${key}`}
              x1={horizontal ? 0 : at}
              y1={horizontal ? at : 0}
              x2={horizontal ? chart.width : at}
              y2={horizontal ? at : chart.height}
              strokeWidth={model.threshold.width}
              strokeDasharray={model.threshold.dash}
              stroke={model.threshold.color}
            />
          );
        }
      }
    }
  });

  // The grid: lines at ten ticks of time and of the value axis it names
  const grid: string[] = [];
  if (model.grid.categoryLines && time && categoryConfig) {
    for (const tick of utcTicks(time.domain, 10)) {
      const at = time(tick);
      grid.push(horizontal ? `M${at},0L${at},${chart.height}` : `M0,${at}L${chart.width},${at}`);
    }
  }
  if (model.grid.valueAxis) {
    const valueModel = model.valueAxes.find((candidate) => candidate.config.id === model.grid.valueAxis);
    const valueAxis = valueModel ? scaled.values.get(valueModel.config.id) : undefined;
    if (valueModel && valueAxis) {
      const flat = isHorizontal(valueModel.config);
      for (const tick of valueAxis.scale.ticks()) {
        const at = valueAxis.scale(tick);
        grid.push(flat ? `M${at},0L${at},${chart.height}` : `M0,${at}L${chart.width},${at}`);
      }
    }
  }

  // The time marker: now, when the axis reaches it
  let marker: ReactNode = null;
  if (model.addTimeMarker && time) {
    const current = now ?? Date.now();
    if (time.domain[1] + 60000 > current) {
      const at = time(current);
      marker = (
        <line
          className="time-marker"
          pointerEvents="none"
          stroke="#c80000"
          strokeWidth={2}
          strokeOpacity={0.3}
          x1={at}
          x2={at}
          y1={chart.height}
          y2={time.range[0]}
        />
      );
    }
  }

  // The brush: along an ordered axis, a span of time or the buckets it takes
  const brushable = Boolean(onBrush && ordered);
  const extentOf = (state: { start: number; end: number }) => [Math.min(state.start, state.end), Math.max(state.start, state.end)];
  const onBrushStart = (event: ReactMouseEvent) => {
    if (!brushable || event.button !== 0) return;
    event.preventDefault();
    const limit = horizontal ? chart.width : chart.height;
    const clamp = (value: number) => Math.max(0, Math.min(limit, value));
    const start = clamp(alongOf(event));
    let current = { start, end: start };
    setBrush(current);
    const box = chartRef.current?.getBoundingClientRect();
    const onMove = (move: MouseEvent) => {
      if (!box) return;
      current = { start, end: clamp(horizontal ? move.clientX - box.left : move.clientY - box.top) };
      setBrush(current);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      setBrush(undefined);
      const [from, to] = extentOf(current);
      if (!onBrush) return;
      if (time) {
        const span = time.range[1] - time.range[0];
        const invert = (at: number) => time.domain[0] + ((at - time.range[0]) / span) * (time.domain[1] - time.domain[0]);
        const range = [invert(from), invert(to)].sort((a, b) => a - b);
        if (range[0] !== range[1]) onBrush({ from: range[0], to: range[1] });
      } else if (band) {
        const values = model.xValues.filter((value) => {
          const at = band(String(value));
          return from <= at && at <= to;
        });
        onBrush({ values });
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div
      ref={chartRef}
      className="chart"
      style={{ left: chart.x, top: chart.y, width: chart.width, height: chart.height }}
      onMouseMove={(event) => showTip(event)}
      onMouseLeave={() => setTooltip(undefined)}
    >
      <svg focusable="false" width={chart.width} height={chart.height}>
        <rect x={0} y={0} width={chart.width} height={chart.height} fill="transparent" className="background" />
        {endzones &&
          [endzones.left, endzones.right].map((zone, index) => (
            <g key={`zone-${index}`} className="endzone">
              <rect
                className="zone"
                x={horizontal ? zone.x : 0}
                y={horizontal ? 0 : zone.x}
                height={horizontal ? chart.height : zone.w}
                width={horizontal ? zone.w : chart.width}
              />
            </g>
          ))}
        {brushable && (
          <g className="brush" style={{ pointerEvents: 'all' }}>
            <rect
              className="background"
              x={0}
              y={0}
              width={chart.width}
              height={chart.height}
              style={{ cursor: 'crosshair', fill: 'transparent' }}
              onMouseDown={onBrushStart}
            />
            {brush && (
              <rect
                className="extent"
                x={horizontal ? extentOf(brush)[0] : 0}
                y={horizontal ? 0 : extentOf(brush)[0]}
                width={horizontal ? extentOf(brush)[1] - extentOf(brush)[0] : chart.width}
                height={horizontal ? chart.height : extentOf(brush)[1] - extentOf(brush)[0]}
                style={{ cursor: 'move' }}
              />
            )}
          </g>
        )}
        <g className="grid">
          {grid.map((d, index) => (
            <path key={index} d={d} fill="none" stroke="rgba(105,112,125,0.2)" strokeWidth={1} />
          ))}
        </g>
        <clipPath id={clipId}>
          <rect x={0} y={0} width={chart.width} height={chart.height} />
        </clipPath>
        {marks}
        {thresholds}
        {marker}
      </svg>
    </div>
  );
}

export function PointSeriesChart({ model, charts, rows, colorOf, offsetAt, dimming, legend, onPointClick, onBrush, now }: PointSeriesChartProps) {
  const [wrapperRef, size] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<Hover>({ touched: false });
  const [tooltip, setTooltip] = useState<TooltipState>();
  const placement = useRef<Placement | undefined>(undefined);
  const split = charts !== undefined;
  const parts: PointSeriesChartPart[] = charts ?? [{ model, onPointClick, onBrush }];
  const count = parts.length;
  // The row of titles under the columns, as high as a line of the page's text
  const titleRow = useMemo(() => (split && !rows ? splitTitleRowHeight() : undefined), [split, rows]);

  const drawn = useMemo(() => {
    if (!size.width || !size.height) return undefined;
    if (model.error) return { error: model.error, layout: undefined, scaled: undefined };
    try {
      const scaled: Partial<Scaled> = { values: new Map() };
      const valueInputs: LayoutAxisInput[] = model.valueAxes.map(({ config, format }) => ({
        config,
        format: (value) => format(Number(value)),
        scaleFor: (length) => {
          const axis = scaleValueAxis(config, axisPoints(model, config.id), length);
          scaled.values?.set(config.id, axis);
          return axis.info;
        },
      }));
      // An axis of names of its own lists them; the others, the values of the bucket along the chart
      const scaleCategory = (axis: CategoryAxisModel, length: number) =>
        scaleCategoryAxis(axis.config, axis.values ?? model.xValues, axis.values ? undefined : model.ordered, length, offsetAt);
      const categoryInputs: LayoutAxisInput[] = model.categoryAxes.map((axis) => ({
        config: axis.config,
        format: axis.format,
        scaleFor: (length) => scaleCategory(axis, length).info,
      }));
      const layout = layoutPointSeries(
        size.width,
        size.height,
        valueInputs,
        categoryInputs,
        split ? { rows: Boolean(rows), count, titleRow } : undefined
      );
      const chart = layout.charts[0];
      // The scales the marks are drawn with: those of the chart's own size, when an axis is hidden too
      scaled.categories = model.categoryAxes.map((axis) => scaleCategory(axis, isHorizontal(axis.config) ? chart.width : chart.height));
      scaled.category = scaled.categories[0];
      for (const { config } of model.valueAxes) {
        const placed = layout.axes.find((axis) => axis.input.config === config);
        if (!placed?.scale || !scaled.values?.has(config.id)) {
          const length = isHorizontal(config) ? chart.width : chart.height;
          scaled.values?.set(config.id, scaleValueAxis(config, axisPoints(model, config.id), length));
        }
      }
      return { layout, scaled: scaled as Scaled, error: undefined };
    } catch (error) {
      if (error instanceof VislibError) return { error: error.message, layout: undefined, scaled: undefined };
      throw error;
    }
  }, [model, size.width, size.height, offsetAt, split, rows, count, titleRow]);

  const highlight = useCallback((label: string | undefined) => {
    setHover((current) => (label === undefined ? { touched: current.touched || current.label !== undefined } : { label, touched: true }));
  }, []);

  // Areas that do not stack light up and dim in their own way, for every mark of every chart
  const overlapAreas = model.series.some((item) => item.type === 'area' && item.mode !== 'stacked');
  const markOpacity = (label: string): number | undefined => {
    if (overlapAreas) {
      if (hover.label !== undefined) return hover.label === label ? 0.8 : 0.3;
      return hover.touched ? 0.6 : undefined;
    }
    if (hover.label !== undefined) return hover.label === label ? 1 : dimming;
    return hover.touched ? 1 : undefined;
  };
  const legendOpacity = (label: string): number | undefined => {
    if (hover.label === undefined) return hover.touched ? 1 : undefined;
    if (overlapAreas) return hover.label === label ? 0.8 : 0.3;
    return hover.label === label ? 1 : dimming;
  };

  const legendPosition: LegendPosition | undefined = legend?.position;
  // The legend lights up a series only where pointing at a mark does
  const legendNode: ReactNode = legend ? (
    <VisLegend
      {...legend}
      labels={model.labels}
      colorOf={colorOf}
      opacityOf={legendOpacity}
      onHighlight={model.hover || overlapAreas ? highlight : undefined}
    />
  ) : null;

  // A chart that cannot be drawn shows the handler's message in place of the charts
  const failure = drawn?.error;
  let body: ReactNode = null;
  if (!failure && drawn?.layout && drawn.scaled) {
    const { layout, scaled } = drawn;
    const placedTitles = layout.axes.filter((axis) => axis.title);
    body = (
      <>
        {placedTitles.map((axis) =>
          axis.title?.rects.map((rect, index) => <TitleSvg key={`title-${axis.input.config.id}-${index}`} placed={axis} rect={rect} />)
        )}
        {layout.axes.map((axis) => {
          const axisDrawn = axis.drawn;
          if (!axisDrawn) return null;
          return axis.rects.map((rect, index) => (
            <AxisSvg key={`axis-${axis.input.config.id}-${index}`} placed={axis} drawn={axisDrawn} rect={rect} />
          ));
        })}
        {layout.splitTitles && (
          <SplitChartTitles
            placed={layout.splitTitles}
            rows={Boolean(rows)}
            labels={parts.map((part) => part.title ?? '')}
            onTooltip={setTooltip}
          />
        )}
        {parts.map((part, index) => {
          const rect = layout.charts[index];
          return rect ? (
            <ChartCanvas
              key={index}
              part={part}
              frame={model}
              rect={rect}
              scaled={scaled}
              colorOf={colorOf}
              markOpacity={markOpacity}
              onHighlight={highlight}
              onTooltip={setTooltip}
              now={now}
            />
          ) : null;
        })}
      </>
    );
  }

  return (
    <div className={`visLib${legendPosition ? ` visLib--legend-${legendPosition}` : ''}`} data-test-subj="visLib">
      <div className={`visLib__chart${failure ? ' visLib__chart--failed' : ''}`}>
        {/* The tooltip keeps its side until the pointer leaves the wrapper, its axes too */}
        <div className="visWrapper" ref={wrapperRef} data-test-subj="visChart" onMouseLeave={() => (placement.current = undefined)}>
          {body}
        </div>
        {failure && <HandlerError message={failure} />}
      </div>
      <div className="visLib__legend">{legendNode}</div>
      <VislibTooltip state={tooltip} container={() => wrapperRef.current} placement={placement} />
    </div>
  );
}

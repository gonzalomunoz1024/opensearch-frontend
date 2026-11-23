/* SPDX-License-Identifier: Apache-2.0 */

/*
 * A pie as vislib draws it (its PieChart): the circle takes 95 hundredths of the smaller side of
 * its room, a ring per bucket sharing the radius by area, the first ring a disc unless the pie is
 * a donut, and seven tenths of the radius when the slices are named beside it. A name sits on the
 * side of its slice's middle, at a height that runs into no name kept before it on that side, or
 * is left out, with a line from the slice. Pointing at a slice dims the others and shows the
 * slice and those it is inside; a click filters on them. A split draws a pie per bucket in the
 * frame of vislib's pie layout: one legend for them all, a title beside each row or under each
 * column. A pie with slices and a room 20 pixels wide or high or less, even none, puts the
 * handler's message in place of the pies.
 */

import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSize, type Size } from '../../charts/core';
import { truncateLabel } from './axis';
import { HandlerError, TOO_SMALL } from './handler_error';
import { VisLegend, type LegendPosition, type VisLegendProps } from './legend';
import { partition, percentText, type PieSlice } from './pie_data';
import { arcCentroid, arcPath } from './shapes';
import { SplitCharts, SplitTitles } from './split';
import { measureText, type TextFont } from './text';
import { VislibTooltip, type Placement, type TooltipState } from './tooltip';

/** The names beside a pie: the theme's extra small size */
export const PIE_LABEL_FONT: TextFont = { size: '12px' };

export interface PieLabelsConfig {
  show: boolean;
  values: boolean;
  lastLevel: boolean;
  truncate: number;
}

/** One pie: its slices, those of nothing left out, and in a split the title of its bucket */
export interface PieChartPart {
  root: PieSlice;
  title?: string;
}

export interface PieChartProps {
  /** The pie, or the pies of a split */
  charts: PieChartPart[];
  /** In a split, whether its pies are rows, one under another, or columns side by side */
  rows?: boolean;
  /** The names of the legend, which the colours are dealt by */
  names: string[];
  isDonut: boolean;
  labels: PieLabelsConfig;
  addTooltip: boolean;
  colorOf: (name: string) => string;
  dimming: number;
  /** How the measure of a slice is written */
  metricFormat: (value: number) => string;
  legend?: Omit<VisLegendProps, 'labels' | 'colorOf' | 'opacityOf' | 'onHighlight'>;
  /** A click on a slice of the pie at `chart` among them */
  onSliceClick?: (slice: PieSlice, chart: number) => void;
  /** Why the pies cannot be drawn, which the handler shows in place of them */
  message?: string;
}

interface PlacedLabel {
  slice: PieSlice;
  text: string;
  anchor: 'start' | 'end';
  x: number;
  y: number;
  points: string;
}

interface LabelBox {
  left: number;
  top: number;
  bottom: number;
}

/**
 * The names a pie keeps beside it (vislib's resolveConflicts): in the order of the slices, a name
 * is left out when a name kept before it is on the same side and its top falls within the name's
 * height, or the name's top within its
 */
export function keptPieLabels(boxes: Array<LabelBox | undefined>): boolean[] {
  const kept: LabelBox[] = [];
  return boxes.map((current) => {
    if (!current) return false;
    const conflict = kept.some((point) => {
      const horizontal = (point.left < 0 && current.left < 0) || (point.left > 0 && current.left > 0);
      const vertical =
        (point.top >= current.top && point.top <= current.bottom) || (point.top <= current.top && point.bottom >= current.top);
      return horizontal && vertical;
    });
    if (conflict) return false;
    kept.push(current);
    return true;
  });
}

interface Hover {
  label?: string;
  touched: boolean;
}

const TWO_PI = 2 * Math.PI;

/** Whether the room of a pie is too small to draw it in, as vislib's PieChart tells (_validatePieDimensions) */
export const pieTooSmall = ({ width, height }: Size): boolean => width <= 20 || height <= 20;

interface PieCanvasProps extends Pick<PieChartProps, 'isDonut' | 'labels' | 'addTooltip' | 'colorOf' | 'metricFormat'> {
  root: PieSlice;
  index: number;
  opacityOf: (label: string) => number | undefined;
  onHighlight: (label: string | undefined) => void;
  onTooltip: (state: TooltipState | undefined) => void;
  onSliceClick?: (slice: PieSlice, chart: number) => void;
  /**
   * Told whether this pie lacks room. A pie without room draws nothing: the chart shows the
   * handler's message in place of every pie, as vislib does.
   */
  onRoom: (index: number, tooSmall: boolean) => void;
}

/** A pie in the room of its chart */
function PieCanvas({
  root,
  index,
  isDonut,
  labels,
  addTooltip,
  colorOf,
  metricFormat,
  opacityOf,
  onHighlight,
  onTooltip,
  onSliceClick,
  onRoom,
}: PieCanvasProps) {
  const [chartRef, size] = useSize<HTMLDivElement>();
  // Whether the room was measured: a room of no width is too small, unlike one not measured yet
  const [measured, setMeasured] = useState(false);
  useLayoutEffect(() => setMeasured(true), []);
  const nodes = useMemo(() => partition(root), [root]);
  const maxDepth = nodes.reduce((deepest, node) => Math.max(deepest, node.depth), 0);

  const drawn = useMemo(() => {
    const { width, height } = size;
    // A pie of no slice draws nothing and asks for no room, as in a split where the others draw
    if (!measured || !root.children.length) return undefined;
    if (pieTooSmall(size)) return { error: TOO_SMALL, paths: [], labels: [] };
    const radius = (Math.min(width, height) / 2) * 0.95;
    const x = (value: number) => value * TWO_PI;
    const yRange = labels.show ? radius * 0.7 : radius;
    const y = (value: number) => yRange * Math.pow(value, 0.5);
    const startAngle = (d: PieSlice) => Math.max(0, Math.min(TWO_PI, x(d.x)));
    const endAngle = (d: PieSlice) => (d.dx < 1e-8 ? x(d.x) : Math.max(0, Math.min(TWO_PI, x(d.x + d.dx))));
    const innerRadius = (d: PieSlice) => (d.depth === 1 && !isDonut ? 0 : Math.max(0, y(d.y)));
    const outerRadius = (d: PieSlice) => Math.max(0, y(d.y + d.dy));
    const paths = nodes.map((node) => ({
      node,
      d: arcPath(innerRadius(node), outerRadius(node), startAngle(node), endAngle(node)),
    }));
    let placed: PlacedLabel[] = [];
    if (labels.show) {
      const candidates = nodes.map((d) => {
        if (d.depth === 0 || (labels.lastLevel && maxDepth !== d.depth)) return undefined;
        const text = truncateLabel(labels.values ? `${d.name} (${percentText(d.value / 100)})` : d.name, labels.truncate);
        const box = measureText(text, PIE_LABEL_FONT);
        const midAngle = startAngle(d) + (endAngle(d) - startAngle(d)) / 2;
        const outer = arcCentroid(radius * 0.8, radius * 0.8, startAngle(d), endAngle(d));
        const px = (0.7 + d.depth / 10) * radius * (midAngle < Math.PI ? 1 : -1);
        const py = outer[1] + 4;
        const textHeight = box.ascent + box.descent;
        return {
          d,
          text,
          anchor: (midAngle < Math.PI ? 'start' : 'end') as 'start' | 'end',
          x: px,
          y: py,
          outer,
          box: { left: midAngle < Math.PI ? px : px - box.width, top: py - textHeight - 5, bottom: py + 5 },
        };
      });
      const kept = keptPieLabels(candidates.map((candidate) => candidate?.box));
      placed = candidates.flatMap((candidate, at) => {
        if (!candidate || !kept[at]) return [];
        const { d } = candidate;
        const from = arcCentroid(innerRadius(d), outerRadius(d), startAngle(d), endAngle(d));
        const x2 = candidate.x > 0 ? candidate.x - 10 : candidate.x + 10;
        const elbow = [candidate.outer[0], candidate.y - 4];
        return [
          {
            slice: d,
            text: candidate.text,
            anchor: candidate.anchor,
            x: candidate.x,
            y: candidate.y,
            points: [...from, ...elbow, x2, candidate.y - 4].join(','),
          },
        ];
      });
    }
    return { error: undefined, paths, labels: placed };
  }, [measured, size, root, nodes, labels, isDonut, maxDepth]);

  // Before the page is drawn, as vislib draws the message in place of the pies at once
  const tooSmall = drawn?.error !== undefined;
  useLayoutEffect(() => {
    onRoom(index, tooSmall);
    return () => onRoom(index, false);
  }, [onRoom, index, tooSmall]);

  const tooltipFor = (slice: PieSlice, clientX: number, clientY: number): TooltipState => {
    const branch: PieSlice[] = [];
    for (let at: PieSlice | undefined = slice; at && at.depth > 0; at = at.parent) branch.unshift(at);
    return {
      clientX,
      clientY,
      details: [],
      branch: branch.map((item) => ({
        field: item.bucket ? item.bucket.column.name : item.name || `level ${item.depth}`,
        bucket: item.name,
        metric: `${metricFormat(item.size)}${item.percentOfGroup !== undefined ? ` (${percentText(item.percentOfGroup)})` : ''}`,
      })),
    };
  };

  let body: ReactNode = null;
  if (drawn && !drawn.error) {
    const { width, height } = size;
    body = (
      <svg width={width} height={height} focusable="false">
        <g transform={`translate(${width / 2},${height / 2})`}>
          <g className="arcs">
            {drawn.paths.map(({ node, d }, at) => {
              if (node.depth === 0) return <path key={at} d={d} style={{ fill: 'none' }} />;
              const clickable = Boolean(onSliceClick && node.bucket);
              return (
                <path
                  key={at}
                  d={d}
                  className="slice"
                  data-label={node.name}
                  data-test-subj={node.name ? `pieSlice-${node.name.split(' ').join('-')}` : undefined}
                  style={{ fill: colorOf(node.name), opacity: opacityOf(node.name), cursor: clickable ? 'pointer' : undefined }}
                  onMouseOver={() => onHighlight(node.name)}
                  onMouseOut={() => onHighlight(undefined)}
                  onMouseMove={addTooltip ? (event) => onTooltip(tooltipFor(node, event.clientX, event.clientY)) : undefined}
                  onMouseLeave={() => onTooltip(undefined)}
                  onClick={clickable ? () => onSliceClick?.(node, index) : undefined}
                />
              );
            })}
          </g>
          <g className="labels">
            {drawn.labels.map((label, at) => (
              <g key={at} className="label">
                <text className="label-text" x={label.x} y={label.y} textAnchor={label.anchor}>
                  {label.text}
                </text>
                <polyline className="label-line" points={label.points} />
              </g>
            ))}
          </g>
        </g>
      </svg>
    );
  }
  return (
    <div className="chart" ref={chartRef}>
      {body}
    </div>
  );
}

export function PieChart({ charts, rows, names, isDonut, labels, addTooltip, colorOf, dimming, metricFormat, legend, onSliceClick, message }: PieChartProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<Hover>({ touched: false });
  const [tooltip, setTooltip] = useState<TooltipState>();
  const placement = useRef<Placement | undefined>(undefined);
  // The pies that lack room
  const [cramped, setCramped] = useState<ReadonlySet<number>>(new Set());
  const split = rows !== undefined;

  const highlight = useCallback((label: string | undefined) => {
    setHover((current) => (label === undefined ? { touched: current.touched || current.label !== undefined } : { label, touched: true }));
  }, []);
  // Pointing at a name dims the others in every pie and in the legend, as vislib's highlight does
  const opacityOf = (label: string): number | undefined => {
    if (hover.label !== undefined) return hover.label === label ? 1 : dimming;
    return hover.touched ? 1 : undefined;
  };
  const onRoom = useCallback((index: number, tooSmall: boolean) => {
    setCramped((current) => {
      if (current.has(index) === tooSmall) return current;
      const next = new Set(current);
      if (tooSmall) next.add(index);
      else next.delete(index);
      return next;
    });
  }, []);
  // The tooltip keeps its side over all the pies of a split, until the pointer leaves the wrapper
  const onLeave = useCallback(() => (placement.current = undefined), []);

  const canvases = charts.map((chart, index) => (
    <PieCanvas
      key={index}
      root={chart.root}
      index={index}
      isDonut={isDonut}
      labels={labels}
      addTooltip={addTooltip}
      colorOf={colorOf}
      metricFormat={metricFormat}
      opacityOf={opacityOf}
      onHighlight={highlight}
      onTooltip={setTooltip}
      onSliceClick={onSliceClick}
      onRoom={onRoom}
    />
  ));
  const titles = charts.map((chart) => chart.title ?? '');
  const failure = message ?? (cramped.size > 0 ? TOO_SMALL : undefined);

  const legendPosition: LegendPosition | undefined = legend?.position;
  return (
    <div className={`visLib${legendPosition ? ` visLib--legend-${legendPosition}` : ''}`} data-test-subj="visLib">
      <div className={`visLib__chart${failure ? ' visLib__chart--failed' : ''}`}>
        <div className="visWrapper" ref={wrapperRef} data-test-subj="visChart" onMouseLeave={onLeave}>
          {split && rows && <SplitTitles rows labels={titles} onTooltip={setTooltip} />}
          <div className="visWrapper__column">
            {split ? <SplitCharts rows={Boolean(rows)}>{canvases}</SplitCharts> : <div className="visWrapper__chart">{canvases}</div>}
            {split && !rows && <SplitTitles rows={false} labels={titles} onTooltip={setTooltip} />}
          </div>
        </div>
        {failure && <HandlerError message={failure} />}
      </div>
      <div className="visLib__legend">
        {legend ? (
          <VisLegend
            {...legend}
            labels={names}
            colorOf={colorOf}
            opacityOf={(label) => (hover.label === undefined ? (hover.touched ? 1 : undefined) : hover.label === label ? 1 : dimming)}
            onHighlight={highlight}
          />
        ) : null}
      </div>
      <VislibTooltip state={tooltip} container={() => wrapperRef.current} placement={placement} />
    </div>
  );
}

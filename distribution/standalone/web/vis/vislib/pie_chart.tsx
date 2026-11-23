/* SPDX-License-Identifier: Apache-2.0 */

/*
 * A pie as vislib draws it (its PieChart): the circle takes 95 hundredths of the smaller side of
 * its room, a ring per bucket sharing the radius by area, the first ring a disc unless the pie is
 * a donut, and seven tenths of the radius when the slices are named beside it. A name sits on the
 * side of its slice's middle, at a height that runs into no name kept before it on that side, or
 * is left out, with a line from the slice. Pointing at a slice dims the others and shows the
 * slice and those it is inside; a click filters on them.
 */

import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSize } from '../../charts/core';
import { truncateLabel } from './axis';
import { VisLegend, type LegendPosition, type VisLegendProps } from './legend';
import { partition, percentText, type PieSlice } from './pie_data';
import { arcCentroid, arcPath } from './shapes';
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

export interface PieChartProps {
  /** The slices, those of nothing left out */
  root: PieSlice;
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
  onSliceClick?: (slice: PieSlice) => void;
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

export function PieChart({ root, names, isDonut, labels, addTooltip, colorOf, dimming, metricFormat, legend, onSliceClick }: PieChartProps) {
  const [chartRef, size] = useSize<HTMLDivElement>();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<Hover>({ touched: false });
  const [tooltip, setTooltip] = useState<TooltipState>();
  const placement = useRef<Placement | undefined>(undefined);

  const nodes = useMemo(() => partition(root), [root]);
  const maxDepth = nodes.reduce((deepest, node) => Math.max(deepest, node.depth), 0);

  const drawn = useMemo(() => {
    const { width, height } = size;
    if (!width || !height) return undefined;
    if (width <= 20 || height <= 20) return { error: 'This container is too small to render the visualization', paths: [], labels: [] };
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
        const height = box.ascent + box.descent;
        return {
          d,
          text,
          anchor: (midAngle < Math.PI ? 'start' : 'end') as 'start' | 'end',
          x: px,
          y: py,
          outer,
          box: { left: midAngle < Math.PI ? px : px - box.width, top: py - height - 5, bottom: py + 5 },
        };
      });
      const kept = keptPieLabels(candidates.map((candidate) => candidate?.box));
      placed = candidates.flatMap((candidate, index) => {
        if (!candidate || !kept[index]) return [];
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
  }, [size, nodes, labels, isDonut, maxDepth]);

  const highlight = useCallback((label: string | undefined) => {
    setHover((current) => (label === undefined ? { touched: current.touched || current.label !== undefined } : { label, touched: true }));
  }, []);
  const opacityOf = (label: string): number | undefined => {
    if (hover.label !== undefined) return hover.label === label ? 1 : dimming;
    return hover.touched ? 1 : undefined;
  };

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
  if (drawn?.error) {
    body = (
      <div className="visError" role="alert">
        <h2 className="visError__title">{drawn.error}</h2>
      </div>
    );
  } else if (drawn) {
    const { width, height } = size;
    body = (
      <svg width={width} height={height} focusable="false">
        <g transform={`translate(${width / 2},${height / 2})`}>
          <g className="arcs">
            {drawn.paths.map(({ node, d }, index) => {
              if (node.depth === 0) return <path key={index} d={d} style={{ fill: 'none' }} />;
              const clickable = Boolean(onSliceClick && node.bucket);
              return (
                <path
                  key={index}
                  d={d}
                  className="slice"
                  data-label={node.name}
                  data-test-subj={node.name ? `pieSlice-${node.name.split(' ').join('-')}` : undefined}
                  style={{ fill: colorOf(node.name), opacity: opacityOf(node.name), cursor: clickable ? 'pointer' : undefined }}
                  onMouseOver={() => highlight(node.name)}
                  onMouseOut={() => highlight(undefined)}
                  onMouseMove={addTooltip ? (event) => setTooltip(tooltipFor(node, event.clientX, event.clientY)) : undefined}
                  onMouseLeave={() => setTooltip(undefined)}
                  onClick={clickable ? () => onSliceClick?.(node) : undefined}
                />
              );
            })}
          </g>
          <g className="labels">
            {drawn.labels.map((label, index) => (
              <g key={index} className="label">
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

  const legendPosition: LegendPosition | undefined = legend?.position;
  return (
    <div className={`visLib${legendPosition ? ` visLib--legend-${legendPosition}` : ''}`} data-test-subj="visLib">
      <div className="visLib__chart">
        <div className="visWrapper" ref={wrapperRef} data-test-subj="visChart">
          <div className="visWrapper__column">
            <div className="visWrapper__chart">
              <div className="chart" ref={chartRef} onMouseLeave={() => (placement.current = undefined)}>
                {body}
              </div>
            </div>
          </div>
        </div>
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

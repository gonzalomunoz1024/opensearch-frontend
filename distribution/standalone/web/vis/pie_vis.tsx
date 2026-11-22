/* SPDX-License-Identifier: Apache-2.0 */

/* Pie and donut: buckets as slices of a whole; buckets inside buckets as rings around them. */

import { useMemo, useState } from 'react';
import {
  ChartFrame,
  ChartMessage,
  ChartTooltip,
  Legend,
  assignColors,
  fitText,
  useSize,
  useTooltip,
  type LegendPosition,
} from '../charts/core';
import { bucketFilter, type TableColumn, type TableRow } from '../lib/aggs';
import type { Filter } from '../lib/types';
import { bucketColumns, keyText, type VisRenderProps } from './types';

interface PieParams {
  isDonut?: boolean;
  addLegend?: boolean;
  addTooltip?: boolean;
  legendPosition?: string;
  labels?: { show?: boolean; values?: boolean; last_level?: boolean; truncate?: number };
}

interface Node {
  id: string;
  label: string;
  /** The measure of this bucket */
  value: number;
  /** What the slice's angle is drawn from: the measures under it, or its own */
  weight: number;
  depth: number;
  column?: TableColumn;
  key?: unknown;
  parent?: Node;
  children: Node[];
  start: number;
  end: number;
}

function buildTree(columns: TableColumn[], rows: TableRow[]): { root: Node; levels: number } {
  const buckets = columns.filter((column) => column.kind === 'bucket');
  // With the measure shown at every level, each bucket column is followed by its own measure
  const metricAfter = (bucket: TableColumn) => {
    const from = columns.indexOf(bucket);
    for (let index = from + 1; index < columns.length; index += 1) {
      if (columns[index].kind === 'metric') return columns[index];
      if (columns[index].kind === 'bucket') break;
    }
    return columns.filter((column) => column.kind === 'metric').pop();
  };
  const root: Node = { id: 'root', label: '', value: 0, weight: 0, depth: 0, children: [], start: 0, end: Math.PI * 2 };
  if (buckets.length === 0) {
    const metric = columns.find((column) => column.kind === 'metric');
    const value = metric && rows[0] ? Number(rows[0][metric.id]) : 0;
    if (value > 0) {
      root.children.push({ id: '_all', label: metric?.name ?? '_all', value, weight: value, depth: 1, parent: root, children: [], start: 0, end: 0 });
    }
    return { root, levels: 1 };
  }
  for (const row of rows) {
    let parent = root;
    buckets.forEach((bucket, level) => {
      const key = row[bucket.id];
      if (key === undefined) return;
      const id = `${parent.id}/${keyText(key)}`;
      let node = parent.children.find((child) => child.id === id);
      if (!node) {
        const metric = metricAfter(bucket);
        const value = metric ? Number(row[metric.id]) : 0;
        node = {
          id,
          label: bucket.format(key),
          value: Number.isFinite(value) ? value : 0,
          weight: 0,
          depth: level + 1,
          column: bucket,
          key,
          parent,
          children: [],
          start: 0,
          end: 0,
        };
        parent.children.push(node);
      }
      parent = node;
    });
  }
  const weigh = (node: Node): number => {
    node.children = node.children.filter((child) => child.value > 0);
    node.weight = node.children.length ? node.children.reduce((sum, child) => sum + weigh(child), 0) : Math.max(0, node.value);
    return node.weight;
  };
  weigh(root);
  const place = (node: Node) => {
    let at = node.start;
    for (const child of node.children) {
      const span = node.weight > 0 ? ((node.end - node.start) * child.weight) / node.weight : 0;
      child.start = at;
      child.end = at + span;
      at += span;
      place(child);
    }
  };
  place(root);
  return { root, levels: buckets.length };
}

const flatten = (node: Node): Node[] => node.children.flatMap((child) => [child, ...flatten(child)]);

// A ring's slice between two angles measured clockwise from twelve o'clock
function arcPath(cx: number, cy: number, inner: number, outer: number, start: number, end: number): string {
  const span = Math.min(end - start, Math.PI * 2 - 0.0001);
  const to = start + span;
  const point = (radius: number, angle: number) => `${cx + radius * Math.sin(angle)},${cy - radius * Math.cos(angle)}`;
  const large = span > Math.PI ? 1 : 0;
  if (inner <= 0.5) {
    return `M${cx},${cy}L${point(outer, start)}A${outer},${outer} 0 ${large} 1 ${point(outer, to)}Z`;
  }
  return `M${point(outer, start)}A${outer},${outer} 0 ${large} 1 ${point(outer, to)}L${point(inner, to)}A${inner},${inner} 0 ${large} 0 ${point(inner, start)}Z`;
}

const percent = (share: number) => `${Number((share * 100).toFixed(2))}%`;

export function PieVis({ vis, data, uiState, onFilter }: VisRenderProps) {
  const params = vis.params as PieParams;
  const { table, context } = data;
  const [ref, size] = useSize<HTMLDivElement>();
  const [active, setActive] = useState<string | undefined>();
  const tip = useTooltip();

  const { nodes, levels, total } = useMemo(() => {
    const tree = buildTree(table.columns, table.rows);
    return { nodes: flatten(tree.root), levels: tree.levels, total: tree.root.weight };
  }, [table]);
  const metric = table.columns.find((column) => column.kind === 'metric');
  const hasBuckets = bucketColumns(table).length > 0;

  if (nodes.length === 0 || total <= 0) return <ChartMessage>No results found</ChartMessage>;

  const colors = assignColors(nodes.map((node) => node.label), uiState.vis?.colors);
  const colorOf = (node: Node) => colors.get(node.label) ?? '';
  const showLabels = params.labels?.show !== false && hasBuckets;
  const legendPosition = (['top', 'bottom', 'left', 'right'].includes(params.legendPosition ?? '') ? params.legendPosition : 'right') as LegendPosition;
  const showLegend = params.addLegend !== false && uiState.vis?.legendOpen !== false && hasBuckets;

  // The room OpenSearch Dashboards leaves around a pie inside the room it is given
  const inset = { top: 7, side: 5, bottom: 24 };
  const roomWidth = Math.max(0, size.width - inset.side * 2);
  const roomHeight = Math.max(0, size.height - inset.top - inset.bottom);
  const cx = size.width / 2;
  const cy = inset.top + roomHeight / 2;
  // With labels the pie keeps to seven tenths of its room, as in OpenSearch Dashboards; a label
  // that is longer than what is left beside it is shortened
  const full = Math.max(0, (Math.min(roomWidth, roomHeight) / 2) * 0.95);
  const radius = showLabels ? full * 0.7 : full;
  // Rings share the disc by area, as in OpenSearch Dashboards; the first reaches the centre unless it is a donut
  const ring = (depth: number) => radius * Math.sqrt(depth / (levels + 1));
  const inner = (node: Node) => (node.depth === 1 && !params.isDonut ? 0 : ring(node.depth));
  const outer = (node: Node) => ring(node.depth + 1);

  const labelled = showLabels ? nodes.filter((node) => (params.labels?.last_level !== false ? node.children.length === 0 : true)) : [];
  const truncate = params.labels?.truncate ?? 100;
  const labels = (() => {
    const placed: Array<{ node: Node; x: number; y: number; side: 1 | -1; text: string; from: [number, number]; elbow: [number, number] }> = [];
    const taken: Record<string, number[]> = { '1': [], '-1': [] };
    for (const node of labelled) {
      const span = node.end - node.start;
      if (span < 0.05) continue;
      const middle = (node.start + node.end) / 2;
      const side: 1 | -1 = Math.sin(middle) >= 0 ? 1 : -1;
      const edge = outer(node);
      const y = cy - (radius + 14) * Math.cos(middle);
      if (taken[side].some((other) => Math.abs(other - y) < 13)) continue;
      taken[side].push(y);
      const x = cx + side * (radius + 22);
      const room = side === 1 ? size.width - x - 2 : x - 2;
      let text = node.label.length > truncate ? `${node.label.slice(0, truncate)}…` : node.label;
      if (params.labels?.values !== false) text += ` (${percent(node.weight / total)})`;
      placed.push({
        node,
        x,
        y,
        side,
        text: fitText(text, room, 11),
        from: [cx + edge * Math.sin(middle), cy - edge * Math.cos(middle)],
        elbow: [cx + (radius + 10) * Math.sin(middle), y],
      });
    }
    return placed;
  })();

  const legendItems = [...new Map(nodes.map((node) => [node.label, { id: node.label, label: node.label, color: colorOf(node) }])).values()];

  const filtersOf = (node: Node): Filter[] => {
    const filters: Filter[] = [];
    for (let at: Node | undefined = node; at?.column; at = at.parent) {
      const filter = bucketFilter(at.column, at.key, context);
      if (filter) filters.unshift(filter);
    }
    return filters;
  };

  return (
    <ChartFrame
      position={legendPosition}
      legend={showLegend ? <Legend items={legendItems} position={legendPosition} onHover={setActive} /> : undefined}
    >
      <div ref={ref} className="chtPlot" data-test-subj="visChart">
        {size.width > 0 && size.height > 0 && (
          <svg width={size.width} height={size.height} role="img" aria-label={vis.title || 'Pie chart'}>
            {nodes.map((node) => {
              const dimmed = active !== undefined && active !== node.label && active !== node.id;
              return (
                <path
                  key={node.id}
                  d={arcPath(cx, cy, inner(node), outer(node), node.start, node.end)}
                  fill={colorOf(node)}
                  stroke="var(--color-surface)"
                  strokeWidth={2}
                  className={dimmed ? 'chtMark chtDim' : 'chtMark'}
                  style={{ cursor: onFilter && node.column ? 'pointer' : undefined }}
                  data-test-subj={`pieSlice-${node.label}`}
                  onMouseMove={(event) => {
                    setActive(node.id);
                    if (params.addTooltip === false) return;
                    const path: Node[] = [];
                    for (let at: Node | undefined = node; at && at.depth > 0; at = at.parent) path.unshift(at);
                    tip.show({
                      x: event.clientX,
                      y: event.clientY,
                      rows: path.map((item) => ({
                        label: `${item.column?.name ?? ''}${item.column ? ': ' : ''}${item.label}`,
                        value: `${metric ? metric.format(item.value) : item.value} (${percent(item.weight / total)})`,
                        color: colorOf(item),
                        active: item === node,
                      })),
                    });
                  }}
                  onMouseLeave={() => {
                    setActive(undefined);
                    tip.hide();
                  }}
                  onClick={() => {
                    const filters = filtersOf(node);
                    if (onFilter && filters.length) onFilter(filters);
                  }}
                />
              );
            })}
            {labels.map((label) => (
              <g key={`label-${label.node.id}`} className="chtPieLabel">
                <polyline
                  points={`${label.from[0]},${label.from[1]} ${label.elbow[0]},${label.elbow[1]} ${label.x - label.side * 3},${label.y}`}
                  fill="none"
                  stroke="var(--color-text-tertiary)"
                  strokeWidth={1}
                />
                <text x={label.x} y={label.y} dy="0.35em" textAnchor={label.side === 1 ? 'start' : 'end'}>
                  {label.text}
                </text>
              </g>
            ))}
          </svg>
        )}
        <ChartTooltip content={tip.content} />
      </div>
    </ChartFrame>
  );
}

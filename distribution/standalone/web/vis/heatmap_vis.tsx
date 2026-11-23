/* SPDX-License-Identifier: Apache-2.0 */

/* Heat map: a measure for each pair of buckets, as the shade of a cell in a matrix. */

import { useMemo } from 'react';
import {
  ChartFrame,
  ChartMessage,
  ChartTooltip,
  Legend,
  assignColors,
  fitText,
  rampColor,
  readableOn,
  textWidth,
  useSize,
  useTooltip,
  type LegendPosition,
} from '../charts/core';
import { bucketFilter } from '../lib/aggs';
import { services } from '../services';
import type { Filter } from '../lib/types';
import { bucketColumns, keyText, metricColumns, numberOf, type VisRenderProps } from './types';

interface HeatmapParams {
  addLegend?: boolean;
  addTooltip?: boolean;
  legendPosition?: string;
  colorsNumber?: number;
  colorSchema?: string;
  setColorRange?: boolean;
  colorsRange?: Array<{ from: number; to: number }>;
  invertColors?: boolean;
  percentageMode?: boolean;
  valueAxes?: Array<{ labels?: { show?: boolean; rotate?: number; overwriteColor?: boolean; color?: string } }>;
}

const FONT = 11;

export function HeatmapVis({ vis, data, uiState, onFilter }: VisRenderProps) {
  const params = vis.params as HeatmapParams;
  const { table, context } = data;
  const [ref, size] = useSize<HTMLDivElement>();
  const tip = useTooltip();

  const model = useMemo(() => {
    const xColumn = bucketColumns(table, 'segment')[0];
    const yColumn = bucketColumns(table, 'group')[0];
    const metric = metricColumns(table)[0];
    const xs: Array<{ key: unknown; label: string }> = [];
    const ys: Array<{ key: unknown; label: string }> = [];
    const cells = new Map<string, number>();
    const seen = { x: new Set<string>(), y: new Set<string>() };
    for (const row of table.rows) {
      const xKey = xColumn ? row[xColumn.id] : '_all';
      const yKey = yColumn ? row[yColumn.id] : (metric?.name ?? '');
      const xId = keyText(xKey);
      const yId = keyText(yKey);
      if (!seen.x.has(xId)) {
        seen.x.add(xId);
        xs.push({ key: xKey, label: xColumn ? xColumn.format(xKey) : '_all' });
      }
      if (!seen.y.has(yId)) {
        seen.y.add(yId);
        ys.push({ key: yKey, label: yColumn ? yColumn.format(yKey) : String(yKey) });
      }
      const value = metric ? numberOf(row, metric) : null;
      if (value !== null) cells.set(`${xId}|${yId}`, value);
    }
    if (xColumn && (xColumn.isDate || xColumn.agg.type === 'histogram')) xs.sort((a, b) => (a.key as number) - (b.key as number));
    const values = [...cells.values()];
    const min = values.length ? Math.min(...values) : 0;
    const max = values.length ? Math.max(...values) : 0;
    return { xColumn, yColumn, metric, xs, ys, cells, min, max };
  }, [table]);

  const { xColumn, yColumn, metric, xs, ys, cells, min, max } = model;
  if (!metric || cells.size === 0) return <ChartMessage>No results found</ChartMessage>;
  // More rows than the setting visualization:heatmap:maxBuckets allows draw nothing, as in the original
  const maxBuckets = services.uiSettings.get<number>('visualization:heatmap:maxBuckets', 50);
  if (ys.length > maxBuckets) {
    return (
      <div className="chtMessage" role="alert" data-test-subj="visLibVisualizeError">
        There are too many series defined ({ys.length}). The configured maximum is {maxBuckets}.
      </div>
    );
  }
  // The rows take their place in the page's memory of colours, as in OpenSearch Dashboards
  assignColors(yColumn ? ys.map((item) => item.label) : [metric.name]);

  // The steps of colour: the ones set, or the measure's range cut into equal parts
  const count = Math.max(1, Math.min(params.colorsNumber ?? 4, 10));
  const custom = params.setColorRange && params.colorsRange?.length ? params.colorsRange : undefined;
  const scaled = (value: number) => (params.percentageMode && !custom ? (max === 0 ? 0 : value / max) * 100 : value);
  const low = params.percentageMode ? 0 : Math.min(0, min) === 0 && min >= 0 ? 0 : min;
  const high = params.percentageMode ? 100 : max;
  const steps = custom
    ? custom.map((range) => ({ from: range.from, to: range.to }))
    : Array.from({ length: count }, (_, index) => ({
        from: low + ((high - low) * index) / count,
        to: low + ((high - low) * (index + 1)) / count,
      }));
  const format = (value: number) => (params.percentageMode && !custom ? `${Math.round(value)}%` : metric.format(Math.round(value * 100) / 100));
  const overrides = uiState.vis?.colors;
  const stepLabel = (index: number) => `${format(steps[index].from)} - ${format(steps[index].to)}`;
  const stepColor = (index: number) =>
    // The first step takes the start of the ramp and the last stops one step short of its end,
    // as in OpenSearch Dashboards
    overrides?.[stepLabel(index)] ?? rampColor(params.colorSchema ?? 'Greens', index / steps.length, Boolean(params.invertColors));
  const stepOf = (value: number) => {
    const at = scaled(value);
    const found = steps.findIndex((step, index) => at >= step.from && (at < step.to || index === steps.length - 1));
    return found === -1 ? (at < steps[0].from ? 0 : steps.length - 1) : found;
  };

  const legendPosition = (['top', 'bottom', 'left', 'right'].includes(params.legendPosition ?? '') ? params.legendPosition : 'right') as LegendPosition;
  const showLegend = params.addLegend !== false && uiState.vis?.legendOpen !== false;
  const showValues = Boolean(params.valueAxes?.[0]?.labels?.show);

  const left = Math.min(160, Math.max(24, ...ys.map((item) => textWidth(item.label, FONT))) + 14);
  // Names under the columns stand on their side, as under any chart of names there; times lie flat
  const turned = !xColumn?.isDate;
  const longest = Math.min(100, Math.max(0, ...xs.map((item) => textWidth(item.label, FONT))));
  const bottom = (turned ? longest + 10 : 20) + (xColumn ? 18 : 0);
  const plotWidth = Math.max(0, size.width - left - 4);
  const plotHeight = Math.max(0, size.height - bottom - 4);
  const cellWidth = xs.length ? plotWidth / xs.length : 0;
  const cellHeight = ys.length ? plotHeight / ys.length : 0;
  const everyX = Math.max(1, Math.ceil((turned ? 14 : longest + 8) / Math.max(1, cellWidth)));
  const everyY = Math.max(1, Math.ceil(14 / Math.max(1, cellHeight)));

  return (
    <ChartFrame
      position={legendPosition}
      legend={
        showLegend ? (
          <Legend items={steps.map((_, index) => ({ id: String(index), label: stepLabel(index), color: stepColor(index) }))} position={legendPosition} classic />
        ) : undefined
      }
    >
      <div ref={ref} className="chtPlot" data-test-subj="visChart">
        {size.width > 0 && size.height > 0 && (
          <svg width={size.width} height={size.height} role="img" aria-label={vis.title || 'Heat map'}>
            {ys.map((item, row) =>
              row % everyY === 0 ? (
                <text
                  key={`y-${row}`}
                  x={left - 8}
                  y={4 + row * cellHeight + cellHeight / 2}
                  dy="0.35em"
                  textAnchor="end"
                  fontSize={FONT}
                  fill="var(--color-text-secondary)"
                >
                  {fitText(item.label, left - 10, FONT)}
                </text>
              ) : null
            )}
            {xs.map((item, column) =>
              column % everyX !== 0 ? null : turned ? (
                <text
                  key={`x-${column}`}
                  transform={`translate(${left + column * cellWidth + cellWidth / 2 + 4},${4 + plotHeight + 7}) rotate(-90)`}
                  textAnchor="end"
                  fontSize={FONT}
                  fill="var(--color-text-secondary)"
                >
                  {fitText(item.label, longest + 2, FONT)}
                </text>
              ) : (
                <text
                  key={`x-${column}`}
                  x={left + column * cellWidth + cellWidth / 2}
                  y={4 + plotHeight + 14}
                  textAnchor="middle"
                  fontSize={FONT}
                  fill="var(--color-text-secondary)"
                >
                  {fitText(item.label, cellWidth * everyX - 4, FONT)}
                </text>
              )
            )}
            <line className="chtAxisLine" x1={left} x2={left} y1={4} y2={4 + plotHeight} />
            <line className="chtAxisLine" x1={left} x2={left + plotWidth} y1={4 + plotHeight} y2={4 + plotHeight} />
            {xColumn && (
              <text className="chtAxisTitle" x={left + plotWidth / 2} y={size.height - 4} textAnchor="middle">
                {fitText(xColumn.name, plotWidth, FONT)}
              </text>
            )}
            {xs.map((xItem, column) =>
              ys.map((yItem, row) => {
                const value = cells.get(`${keyText(xItem.key)}|${keyText(yItem.key)}`);
                if (value === undefined) return null;
                const step = stepOf(value);
                const fill = stepColor(step);
                const x = left + column * cellWidth;
                const y = 4 + row * cellHeight;
                const text = metric.format(value);
                return (
                  <g key={`${column}-${row}`}>
                    <rect
                      x={x}
                      y={y}
                      width={Math.max(0, cellWidth)}
                      height={Math.max(0, cellHeight)}
                      fill={fill}
                      stroke="var(--color-border)"
                      strokeWidth={0.5}
                      className="chtMark"
                      style={{ cursor: onFilter ? 'pointer' : undefined }}
                      data-test-subj="heatmapCell"
                      onMouseMove={(event) => {
                        if (params.addTooltip === false) return;
                        tip.show({
                          x: event.clientX,
                          y: event.clientY,
                          rows: [
                            ...(xColumn ? [{ label: xColumn.name, value: xItem.label }] : []),
                            ...(yColumn ? [{ label: yColumn.name, value: yItem.label }] : []),
                            { label: metric.name, value: text, color: fill, active: true },
                          ],
                        });
                      }}
                      onMouseLeave={tip.hide}
                      onClick={() => {
                        const filters = [
                          xColumn ? bucketFilter(xColumn, xItem.key, context) : undefined,
                          yColumn ? bucketFilter(yColumn, yItem.key, context) : undefined,
                        ].filter((filter): filter is Filter => Boolean(filter));
                        if (onFilter && filters.length) onFilter(filters);
                      }}
                    />
                    {showValues && cellWidth > textWidth(text, FONT) + 6 && cellHeight > 14 && (
                      <text x={x + cellWidth / 2} y={y + cellHeight / 2} dy="0.35em" textAnchor="middle" fontSize={FONT} fill={readableOn(fill)} pointerEvents="none">
                        {text}
                      </text>
                    )}
                  </g>
                );
              })
            )}
          </svg>
        )}
        <ChartTooltip content={tip.content} />
      </div>
    </ChartFrame>
  );
}

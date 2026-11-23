/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Pie and donut: buckets as slices of a whole, buckets inside buckets as rings around them, drawn
 * as the classic charts of OpenSearch Dashboards draw them (vislib, in ./vislib). A split draws a
 * pie per bucket, with one legend for them all.
 */

import { useCallback, useMemo } from 'react';
import { ChartMessage } from '../charts/core';
import { bucketFilter } from '../lib/aggs';
import type { Filter } from '../lib/types';
import { services } from '../services';
import type { VisRenderProps } from './types';
import { seriesColors } from './vislib/colors';
import { PieChart } from './vislib/pie_chart';
import { buildSlices, convertToPercentage, pieNames, removeZeroSlices, type PieSlice } from './vislib/pie_data';
import { dimmingOpacity } from './vislib/settings';
import { useVislibLegend } from './vislib/use_legend';
import '../styles/vislib.css';

/** What vislib says when no pie has a slice (PieContainsAllZeros) */
const ALL_ZEROS = 'No results displayed because all values equal 0.';

interface PieParams {
  isDonut?: boolean;
  addLegend?: boolean;
  addTooltip?: boolean;
  legendPosition?: string;
  labels?: { show?: boolean; values?: boolean; last_level?: boolean; truncate?: number | string | null };
}

const truncateOf = (value: unknown): number => {
  const number = Number(value);
  return value === null || value === undefined || value === '' || !Number.isFinite(number) ? 0 : number;
};

export function PieVis({ vis, data, uiState, onUiState, onFilter, split, splits }: VisRenderProps) {
  const params = vis.params as PieParams;
  const { table, context } = data;

  // The pie, or a pie per bucket of a split: each of its own rows, with its title and its bucket
  const parts = useMemo(
    () => splits?.parts.map((part) => ({ table: part.table, title: part.label, split: part.split })) ?? [{ table, title: undefined, split }],
    [splits, table, split]
  );

  const prepared = useMemo(() => {
    const built = parts.map((part) => buildSlices(part.table));
    const roots = built.map((slices) => {
      const root = removeZeroSlices(slices);
      convertToPercentage(root);
      return root;
    });
    // The legend names every slice of every pie; the colours are dealt to those drawn
    return { roots, names: pieNames(built), drawnNames: pieNames(roots) };
  }, [parts]);
  const { roots, names, drawnNames } = prepared;

  const colors = useMemo(
    () =>
      seriesColors(
        drawnNames,
        uiState.vis?.colors,
        services.uiSettings?.get<Record<string, string>>('visualization:colorMapping', {})
      ),
    [drawnNames, uiState.vis?.colors]
  );
  const colorOf = useCallback((name: string) => colors.get(name) ?? 'currentColor', [colors]);
  const dimming = dimmingOpacity(services.uiSettings?.get('visualization:dimmingOpacity', 0.5));

  // The bucket a name of the legend stands for: the first slice of that name, pie by pie and in a
  // pie ring by ring, as vislib's legend takes the first of its names
  const nameFilter = (name: string): Filter | undefined => {
    for (const [index, root] of roots.entries()) {
      const queue: PieSlice[] = [...root.children];
      while (queue.length) {
        const level = queue.splice(0, queue.length);
        const found = level.find((item) => item.name === name);
        if (found) {
          return found.bucket ? bucketFilter(found.bucket.column, found.bucket.key, context, { table: parts[index].table, row: found.bucket.row }) : undefined;
        }
        for (const item of level) queue.push(...item.children);
      }
    }
    return undefined;
  };
  const legend = useVislibLegend({
    addLegend: params.addLegend,
    legendPosition: params.legendPosition,
    uiState,
    onUiState,
    onFilter,
    filterOf: nameFilter,
  });

  const labels = useMemo(
    () => ({
      show: Boolean(params.labels?.show),
      values: Boolean(params.labels?.values),
      lastLevel: Boolean(params.labels?.last_level),
      truncate: truncateOf(params.labels?.truncate),
    }),
    [params.labels]
  );

  if (table.rows.length === 0) return <ChartMessage>No results found</ChartMessage>;
  // No pie with a slice: vislib's PieChart fails, and its handler says why in place of the pies,
  // beside the legend of every name
  const message = roots.every((root) => !root.children.length) ? ALL_ZEROS : undefined;

  // A click on a slice filters on it, on the slices it is inside and on the bucket of its pie in a split
  const onSliceClick = onFilter
    ? (slice: PieSlice, chart: number) => {
        const part = parts[chart];
        const filters: Filter[] = [];
        for (let at: PieSlice | undefined = slice; at?.bucket; at = at.parent) {
          const filter = bucketFilter(at.bucket.column, at.bucket.key, context, { table: part.table, row: at.bucket.row });
          if (filter) filters.push(filter);
        }
        const splitFilter = part.split && bucketFilter(part.split.column, part.split.key, context, part.split.cell);
        if (splitFilter) filters.push(splitFilter);
        if (filters.length) onFilter(filters);
      }
    : undefined;

  const metric = table.columns.find((column) => column.kind === 'metric');
  return (
    <PieChart
      charts={roots.map((root, index) => ({ root, title: parts[index].title }))}
      rows={splits?.rows}
      names={names}
      isDonut={Boolean(params.isDonut)}
      labels={labels}
      addTooltip={params.addTooltip !== false}
      colorOf={colorOf}
      dimming={dimming}
      metricFormat={(value) => (metric ? metric.format(value) : String(value))}
      legend={legend}
      onSliceClick={onSliceClick}
      message={message}
    />
  );
}

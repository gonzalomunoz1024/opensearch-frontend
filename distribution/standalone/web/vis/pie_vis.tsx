/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Pie and donut: buckets as slices of a whole, buckets inside buckets as rings around them, drawn
 * as the classic charts of OpenSearch Dashboards draw them (vislib, in ./vislib).
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

export function PieVis({ vis, data, uiState, onUiState, onFilter, split }: VisRenderProps) {
  const params = vis.params as PieParams;
  const { table, context } = data;

  const prepared = useMemo(() => {
    const built = buildSlices(table);
    const root = removeZeroSlices(built);
    convertToPercentage(root);
    // The legend names every slice; the colours are dealt to those drawn
    return { root, names: pieNames([built]), drawnNames: pieNames([root]) };
  }, [table]);
  const { root, names, drawnNames } = prepared;

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

  // The bucket a name of the legend stands for: the first slice of that name, ring by ring
  const nameFilter = (name: string): Filter | undefined => {
    const queue: PieSlice[] = [...root.children];
    while (queue.length) {
      const level = queue.splice(0, queue.length);
      const found = level.find((item) => item.name === name);
      if (found) return found.bucket ? bucketFilter(found.bucket.column, found.bucket.key, context, { table, row: found.bucket.row }) : undefined;
      for (const item of level) queue.push(...item.children);
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
  if (!root.children.length) {
    return (
      <div className="visError" role="alert">
        <h2 className="visError__title">No results displayed because all values equal 0.</h2>
      </div>
    );
  }

  // A click on a slice filters on it, on the slices it is inside and on the bucket of its pie in a split
  const onSliceClick = onFilter
    ? (slice: PieSlice) => {
        const filters: Filter[] = [];
        for (let at: PieSlice | undefined = slice; at?.bucket; at = at.parent) {
          const filter = bucketFilter(at.bucket.column, at.bucket.key, context, { table, row: at.bucket.row });
          if (filter) filters.push(filter);
        }
        const splitFilter = split && bucketFilter(split.column, split.key, context, split.cell);
        if (splitFilter) filters.push(splitFilter);
        if (filters.length) onFilter(filters);
      }
    : undefined;

  const metric = table.columns.find((column) => column.kind === 'metric');
  return (
    <PieChart
      root={root}
      names={names}
      isDonut={Boolean(params.isDonut)}
      labels={labels}
      addTooltip={params.addTooltip !== false}
      colorOf={colorOf}
      dimming={dimming}
      metricFormat={(value) => (metric ? metric.format(value) : String(value))}
      legend={legend}
      onSliceClick={onSliceClick}
    />
  );
}

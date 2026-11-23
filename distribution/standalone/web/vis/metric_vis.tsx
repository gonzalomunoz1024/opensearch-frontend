/* SPDX-License-Identifier: Apache-2.0 */

/* Metric: a calculation as one large number, or one per bucket. */

import { ChartMessage, rampColor, readableOn } from '../charts/core';
import { bucketFilter } from '../lib/aggs';
import { bucketColumns, metricColumns, numberOf, type VisRenderProps } from './types';
import '../styles/vis_basic.css';

interface Range {
  from: number;
  to: number;
}

interface MetricParams {
  metric?: {
    percentageMode?: boolean;
    useRanges?: boolean;
    colorSchema?: string;
    metricColorMode?: 'None' | 'Labels' | 'Background';
    colorsRange?: Range[];
    invertColors?: boolean;
    labels?: { show?: boolean };
    style?: { fontSize?: number };
  };
}

/** The colour of the range a value falls in, on a ramp spread over the ranges */
export function rangeColor(value: number, ranges: Range[], schema: string, inverted: boolean): string | undefined {
  const index = ranges.findIndex((range) => value >= range.from && value < range.to);
  const found = index === -1 && ranges.length && value >= ranges[ranges.length - 1].to ? ranges.length - 1 : index;
  if (found === -1) return undefined;
  return rampColor(schema, found / Math.max(ranges.length - 1, 1), inverted);
}

export const asPercent = (value: number, ranges: Range[]): number => {
  const min = ranges[0]?.from ?? 0;
  const max = ranges[ranges.length - 1]?.to ?? 100;
  return max === min ? 0 : (value - min) / (max - min);
};

export function MetricVis({ vis, data, onFilter }: VisRenderProps) {
  const config = (vis.params as MetricParams).metric ?? {};
  const { table, context } = data;
  const metrics = metricColumns(table);
  const bucket = bucketColumns(table)[0];
  const ranges = config.colorsRange?.length ? config.colorsRange : [{ from: 0, to: 10000 }];
  const mode = config.metricColorMode ?? 'None';

  const items = table.rows.flatMap((row) =>
    metrics.map((metric) => {
      const value = numberOf(row, metric);
      const bucketLabel = bucket ? bucket.format(row[bucket.id]) : undefined;
      const label = bucketLabel === undefined ? metric.name : metrics.length > 1 ? `${bucketLabel} - ${metric.name}` : bucketLabel;
      const text =
        value === null
          ? '-'
          : config.percentageMode
            ? `${Math.round(asPercent(value, ranges) * 100)}%`
            : metric.format(value);
      const color = value !== null && mode !== 'None' ? rangeColor(value, ranges, config.colorSchema ?? 'Green to Red', Boolean(config.invertColors)) : undefined;
      return { key: `${bucketLabel ?? ''}|${metric.id}`, label, text, color, row };
    })
  );
  if (items.length === 0) return <ChartMessage>No results found</ChartMessage>;

  const fontSize = config.style?.fontSize ?? 60;
  return (
    <div className="visMetric" data-test-subj="visChart">
      {items.map((item) => {
        const background = mode === 'Background' ? item.color : undefined;
        const color = mode === 'Labels' ? item.color : background ? readableOn(background) : undefined;
        const clickable = Boolean(bucket && onFilter);
        return (
          <div
            key={item.key}
            className="visMetric__item"
            style={{ background, color, cursor: clickable ? 'pointer' : undefined }}
            onClick={
              clickable && bucket
                ? () => {
                    const filter = bucketFilter(bucket, item.row[bucket.id], context);
                    if (filter) onFilter?.([filter]);
                  }
                : undefined
            }
          >
            <div className="visMetric__value" style={{ fontSize: `${fontSize}pt` }} data-test-subj="metricValue">
              {item.text}
            </div>
            {config.labels?.show !== false && <div className="visMetric__label">{item.label}</div>}
          </div>
        );
      })}
    </div>
  );
}

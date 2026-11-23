/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Metric: a calculation as one large number, or one per bucket, as the original's metric
 * visualization draws it (vis_type_metric's MetricVisComponent and MetricVisValue): the values
 * side by side, wrapping when they do not fit, each over its label, in the colour of its range or
 * on it; one of a bucket filters for the bucket when it is clicked.
 */

import { useMemo, type KeyboardEvent } from 'react';
import { cx } from '../components/basic';
import { bucketFilter } from '../lib/aggs';
import { services } from '../services';
import { FormattedValue } from './formatted_value';
import { groupColumn, metricConfig, metricItems, type MetricItem } from './metric_data';
import { VisNoResults } from './no_results';
import type { VisRenderProps } from './types';
import '../styles/vis_basic.css';

export function MetricVis({ vis, data, onFilter }: VisRenderProps) {
  const { table, context } = data;
  const configKey = JSON.stringify(vis.params.metric ?? null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const config = useMemo(() => metricConfig(vis.params), [configKey]);
  // The schemas between the theme's status colours have a dark form, as the original's
  const dark = services.uiSettings?.get<boolean>('theme:darkMode', false) === true;
  const metrics = useMemo(() => metricItems(table, config, context, dark), [table, config, context, dark]);
  const bucket = groupColumn(table);

  // A metric of a bucket filters for the bucket, as the original's filterBucket event
  const filter = bucket
    ? (metric: MetricItem) => {
        const found = bucketFilter(bucket, metric.row[bucket.id], context, { table, row: metric.row });
        if (found) onFilter?.([found]);
      }
    : undefined;

  return (
    <div className="visMetric">
      {metrics.length === 0 ? (
        <VisNoResults />
      ) : (
        metrics.map((metric, index) => (
          <MetricValue key={index} metric={metric} fontSize={config.fontSize} showLabel={config.showLabels} onFilter={filter} />
        ))
      )}
    </div>
  );
}

function MetricValue({
  metric,
  fontSize,
  showLabel,
  onFilter,
}: {
  metric: MetricItem;
  fontSize: number;
  showLabel: boolean;
  onFilter?: (metric: MetricItem) => void;
}) {
  const filters = Boolean(onFilter);
  // As a button of the component library answers the keyboard: Enter and the space bar click it
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === ' ') event.preventDefault();
  };
  const keyUp = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') onFilter?.(metric);
  };
  return (
    <div
      className={cx('visMetric__container', metric.lightText && 'visMetric__container--light')}
      style={{ backgroundColor: metric.bgColor }}
      onClick={filters ? () => onFilter?.(metric) : undefined}
      onKeyDown={filters ? keyDown : undefined}
      onKeyUp={filters ? keyUp : undefined}
      tabIndex={filters ? 0 : undefined}
      role={filters ? 'button' : undefined}
    >
      <div className="visMetric__value" style={{ fontSize: `${fontSize}pt`, color: metric.color }}>
        <FormattedValue content={metric.value} />
      </div>
      {showLabel && <div>{metric.label}</div>}
    </div>
  );
}

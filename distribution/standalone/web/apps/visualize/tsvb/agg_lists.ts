/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The lists a TSVB metric is picked from: the aggregations, in the groups and with the names of the
 * product's list, and the metrics another can be computed from. They are plain data, so that what
 * each list holds can be checked without drawing it.
 */

import type { Choice } from './controls';
import { BASIC_AGGS, calculateLabel, calculateSiblings, list, toPercentileNumber, type Doc, type Metric } from './model';

/** An option of a list, by its label and the value saved */
export const choice = (label: string, value: string): Choice => ({ label, value });

const METRIC_AGGS = [
  choice('Average', 'avg'),
  choice('Cardinality', 'cardinality'),
  choice('Count', 'count'),
  choice('Filter Ratio', 'filter_ratio'),
  choice('Positive Rate', 'positive_rate'),
  choice('Max', 'max'),
  choice('Min', 'min'),
  choice('Percentile', 'percentile'),
  choice('Percentile Rank', 'percentile_rank'),
  choice('Static Value', 'static'),
  choice('Std. Deviation', 'std_deviation'),
  choice('Sum', 'sum'),
  choice('Sum of Squares', 'sum_of_squares'),
  choice('Top Hit', 'top_hit'),
  choice('Value Count', 'value_count'),
  choice('Variance', 'variance'),
];

const PIPELINE_AGG_CHOICES = [
  choice('Bucket Script', 'calculation'),
  choice('Cumulative Sum', 'cumulative_sum'),
  choice('Derivative', 'derivative'),
  choice('Moving Average', 'moving_average'),
  choice('Positive Only', 'positive_only'),
  choice('Serial Difference', 'serial_diff'),
];

const SIBLING_AGG_CHOICES = [
  choice('Overall Average', 'avg_bucket'),
  choice('Overall Max', 'max_bucket'),
  choice('Overall Min', 'min_bucket'),
  choice('Overall Std. Deviation', 'std_deviation_bucket'),
  choice('Overall Sum', 'sum_bucket'),
  choice('Overall Sum of Squares', 'sum_of_squares_bucket'),
  choice('Overall Variance', 'variance_bucket'),
];

const SPECIAL_AGG_CHOICES = [choice('Series Agg', 'series_agg'), choice('Math', 'math')];

const FILTER_RATIO_AGGS = ['avg', 'cardinality', 'count', 'positive_rate', 'max', 'min', 'sum', 'value_count'];
const HISTOGRAM_AGGS = ['avg', 'count', 'sum', 'value_count'];

/** The aggregations a metric can be: grouped, those computed from another only once there is one */
export function aggOptions(panelType: string | undefined, siblings: Metric[]): Choice[] {
  if (panelType === 'metrics') return METRIC_AGGS;
  if (panelType === 'filter_ratio') return METRIC_AGGS.filter((agg) => FILTER_RATIO_AGGS.includes(agg.value));
  if (panelType === 'histogram') return METRIC_AGGS.filter((agg) => HISTOGRAM_AGGS.includes(agg.value));
  const enablePipelines = siblings.length > 1 && siblings.some((sibling) => METRIC_AGGS.some((agg) => agg.value === sibling.type));
  const pipeline = (group: string) => (agg: Choice) => ({ ...agg, group, disabled: !enablePipelines });
  return [
    ...METRIC_AGGS.map((agg) => ({ ...agg, group: 'Metric Aggregations' })),
    // A table's Series Agg was meant to be left out here; the product leaves it in, under Special
    ...PIPELINE_AGG_CHOICES.map(pipeline('Parent Pipeline Aggregations')),
    ...SIBLING_AGG_CHOICES.map(pipeline('Sibling Pipeline Aggregations')),
    ...SPECIAL_AGG_CHOICES.map(pipeline('Special Aggregations')),
  ];
}

/** The metrics a pipeline can use: sibling aggregations, percentiles and Math left out unless asked */
export function filterRows(includeSiblings: boolean) {
  return (row: Metric) => {
    if (includeSiblings) return !/^series/.test(row.type) && !/^percentile/.test(row.type) && row.type !== 'math';
    return !/_bucket$/.test(row.type) && !/^series/.test(row.type) && !/^percentile/.test(row.type) && row.type !== 'math';
  };
}

export interface MetricOptionsArgs {
  metrics: Metric[];
  metric?: Doc;
  restrict?: 'none' | 'basic';
  exclude?: string[];
  includeSiblings?: boolean;
  additionalOptions?: Choice[];
}

/** The metrics a metric can be computed from, each percentile of a percentile aggregation apart */
export function metricOptions({
  metrics,
  metric = {},
  restrict = 'none',
  exclude = [],
  includeSiblings = false,
  additionalOptions = [],
}: MetricOptionsArgs): Choice[] {
  const calculated = metrics.filter((row) => !exclude.includes(row.type) && (restrict !== 'basic' || BASIC_AGGS.includes(row.type)));
  const siblings = calculateSiblings(calculated, metric);
  const percentiles: Choice[] = [];
  for (const row of siblings.filter((item) => /^percentile/.test(item.type))) {
    const label = calculateLabel(row, calculated);
    if (row.type === 'percentile_rank') {
      for (const value of list<unknown>(row, 'values')) {
        const number = toPercentileNumber(value);
        percentiles.push({ value: `${row.id}[${number}]`, label: `${label} (${number})` });
      }
    }
    // A percentile rank goes on to the percentiles as well, as it does in the product: it has none
    for (const percentile of list(row, 'percentiles')) {
      if (!percentile.value) continue;
      const number = toPercentileNumber(percentile.value);
      percentiles.push({ value: `${row.id}[${number}]`, label: `${label} (${number})` });
    }
  }
  const options = siblings.filter(filterRows(includeSiblings)).map((row) => ({ value: row.id, label: calculateLabel(row, calculated) }));
  return [...options, ...additionalOptions, ...percentiles];
}

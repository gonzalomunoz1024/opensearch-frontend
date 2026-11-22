/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { aggOptions, metricOptions } from '../../web/apps/visualize/tsvb/agg_lists';
import {
  calculateLabel,
  calculateSiblings,
  drawnInterval,
  extractIndexPatterns,
  formatInterval,
  isBasicAgg,
  isDuration,
  isModelInvalid,
  newSeries,
  panelAdditions,
  reIdSeries,
  stableKey,
  supportedFieldKinds,
  toPercentileNumber,
  tsvbDefaults,
  uuid,
  validateInterval,
  withTsvbDefaults,
  type Metric,
  type Series,
} from '../../web/apps/visualize/tsvb/model';
import { colorOutput, cssColor, parseColor, toHex } from '../../web/components/color_picker';

const UUID_V1 = /^[0-9a-f]{8}-[0-9a-f]{4}-1[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('the params a TSVB editor keeps', () => {
  it('gives series and metrics time-based ids, each new', () => {
    const ids = new Set(Array.from({ length: 200 }, () => uuid()));
    assert.equal(ids.size, 200);
    for (const id of ids) assert.match(id, UUID_V1);
  });

  it('reads saved params over the defaults of the type, without changing what was saved', () => {
    const saved = { id: 'panel', type: 'gauge', series: [], show_legend: 0, interval: '>=4h' };
    const params = withTsvbDefaults(saved);
    assert.equal(params.tooltip_mode, 'show_all');
    assert.equal(params.axis_formatter, 'number');
    assert.equal(params.show_legend, 0);
    assert.equal(params.interval, '>=4h');
    assert.deepEqual(params.series, []);
    assert.equal(tsvbDefaults().series[0].split_color_mode, 'opensearchDashboards');
  });

  it('adds what a kind of panel lacks when it opens, and nothing else', () => {
    const metric = panelAdditions({ type: 'metric', background_color_rules: [] });
    assert.deepEqual(Object.keys(metric), ['background_color_rules']);
    assert.deepEqual(panelAdditions({ type: 'metric', background_color_rules: [{ id: 'a' }] }), {});
    assert.deepEqual(Object.keys(panelAdditions({ type: 'top_n' })), ['bar_color_rules']);
    assert.deepEqual(Object.keys(panelAdditions({ type: 'table' })), ['bar_color_rules']);
    const gauge = panelAdditions({ type: 'gauge', gauge_width: 0, gauge_style: null });
    assert.deepEqual(Object.keys(gauge), ['gauge_color_rules', 'gauge_inner_width', 'gauge_style']);
    assert.equal(gauge.gauge_inner_width, 10);
    assert.equal(gauge.gauge_style, 'half');
    assert.deepEqual(panelAdditions({ type: 'timeseries' }), {});
    assert.deepEqual(panelAdditions({ type: 'markdown' }), {});
  });

  it('lists the index patterns whose fields the editor needs', () => {
    assert.deepEqual(extractIndexPatterns({ index_pattern: '', series: [] }), ['']);
    assert.deepEqual(
      extractIndexPatterns({
        index_pattern: 'logs',
        series: [
          { id: 'a', metrics: [], override_index_pattern: 1, series_index_pattern: 'flights' },
          { id: 'b', metrics: [], override_index_pattern: 0, series_index_pattern: 'ignored' },
        ],
        annotations: [{ id: 'c', index_pattern: 'logs' }, { id: 'd', index_pattern: 'ecommerce' }],
      }),
      ['ecommerce', 'flights', 'logs']
    );
  });

  it('accepts the intervals OpenSearch takes and says what is wrong with the others', () => {
    for (const interval of ['', 'auto', '1m', '7d', '1w', '1M', '1y', '>=1m', '>=4h', '10 s', '500ms']) {
      assert.equal(validateInterval(interval).valid, true, interval);
    }
    assert.deepEqual(validateInterval('abc'), { valid: false, message: 'Invalid interval format: abc' });
    assert.deepEqual(validateInterval('0m'), { valid: false, message: 'Invalid interval format: 0m' });
    assert.deepEqual(validateInterval('2w'), { valid: false, message: 'Invalid calendar interval: 2w, value must be 1' });
    assert.equal(isModelInvalid({ interval: 'abc', series: [] }), true);
    assert.equal(isModelInvalid({ interval: 'auto', series: [{ id: 'a', metrics: [], series_interval: '3M' }] }), true);
    assert.equal(isModelInvalid({ series: [{ id: 'a', metrics: [] }] }), false);
  });

  it('shows the interval a panel was drawn at in its largest unit', () => {
    assert.equal(formatInterval(24 * 3600000), '24h');
    assert.equal(formatInterval(3 * 3600000), '3h');
    assert.equal(formatInterval(30000), '30s');
    assert.equal(formatInterval(6 * 24 * 3600000), '6d');
    assert.equal(formatInterval(8 * 24 * 3600000), '1w');
    assert.equal(formatInterval(45 * 24 * 3600000), '1M');
    assert.equal(formatInterval(500), null);
    assert.equal(
      drawnInterval([
        { data: [[0, 1], [3600000, 2]] },
        { data: [[0, 1], [60000, 2]] },
        { data: [[0, 1]] },
      ]),
      60000
    );
    assert.equal(drawnInterval([{ data: [[0, 1]] }]), 0);
  });

  it('tells a duration format from a number format', () => {
    assert.equal(isDuration('ms,ms,'), true);
    assert.equal(isDuration('s,humanize,2'), true);
    assert.equal(isDuration('0,0.[00]'), false);
    assert.equal(isDuration('number'), false);
  });

  it('copies a series with new ids whose metrics still point at each other', () => {
    const source: Series = newSeries({
      metrics: [
        { id: 'm1', type: 'avg', field: 'bytes' },
        { id: 'm2', type: 'derivative', field: 'm1' },
        { id: 'm3', type: 'calculation', variables: [{ id: 'v1', name: 'a', field: 'm2' }] },
      ],
      terms_order_by: 'm1',
    });
    const copy = reIdSeries(source);
    assert.notEqual(copy.id, source.id);
    const [first, second, third] = copy.metrics;
    assert.notEqual(first.id, 'm1');
    assert.equal(second.field, first.id);
    assert.equal(copy.terms_order_by, first.id);
    const variables = third.variables as Array<{ id: string; field: string }>;
    assert.equal(variables[0].field, second.id);
    assert.notEqual(variables[0].id, 'v1');
    assert.equal(source.metrics[1].field, 'm1');
  });

  it('starts a new series as the editor does', () => {
    const series = newSeries();
    assert.equal(series.color, '#68BC00');
    assert.equal(series.split_mode, 'everything');
    assert.equal(series.metrics[0].type, 'count');
    assert.equal(series.split_color_mode, undefined);
  });

  it('compares params whatever the order of their keys', () => {
    assert.equal(stableKey({ b: 1, a: { d: 2, c: [3, { f: 1, e: 2 }] } }), stableKey({ a: { c: [3, { e: 2, f: 1 }], d: 2 }, b: 1 }));
  });
});

describe('the colours a TSVB colour picker reads', () => {
  it('reads a hex colour or its channels separated by commas, and nothing else', () => {
    assert.deepEqual(parseColor('#68BC00'), [104, 188, 0, 1]);
    assert.deepEqual(parseColor('fff'), [255, 255, 255, 1]);
    assert.deepEqual(parseColor('#00000080'), [0, 0, 0, 0.5]);
    assert.deepEqual(parseColor('104,188,0,1'), [104, 188, 0, 1]);
    assert.deepEqual(parseColor('104, 188, 0'), [104, 188, 0, 1]);
    assert.equal(parseColor('red'), undefined);
    assert.equal(parseColor('rgba(104,188,0,1)'), undefined);
    assert.equal(parseColor('1,2'), undefined);
    assert.equal(parseColor(''), undefined);
  });

  it('answers what the editor saves: the channels, or no hex for no colour', () => {
    const output = colorOutput('#68BC00');
    assert.equal(`rgba(${output.rgba.join(',')})`, 'rgba(104,188,0,1)');
    assert.equal(output.hex, '#68bc00');
    assert.equal(colorOutput('#68BC0').hex, '');
    assert.equal(toHex([0, 0, 0, 0.5]), '#00000080');
    assert.equal(cssColor('104,188,0,0.5'), 'rgba(104,188,0,0.5)');
    assert.equal(cssColor(null), 'transparent');
  });
});

describe('the metrics of a TSVB series', () => {
  const metric = (id: string, type: string, extra: Record<string, unknown> = {}): Metric => ({ id, type, ...extra });

  it('names a metric as the product does when it has no alias', () => {
    assert.equal(calculateLabel(undefined, []), 'Unknown');
    assert.equal(calculateLabel(metric('1', 'avg', { field: 'memory', alias: 'Example' }), []), 'Example');
    assert.equal(calculateLabel(metric('1', 'count'), []), 'Count');
    assert.equal(calculateLabel(metric('1', 'calculation'), []), 'Bucket Script');
    assert.equal(calculateLabel(metric('1', 'series_agg', { function: 'max' }), []), 'Series Agg (max)');
    assert.equal(calculateLabel(metric('1', 'avg', { field: 'memory' }), []), 'Average of memory');
    assert.equal(calculateLabel(metric('1', 'static', { value: 10 }), []), 'Static Value of 10');
    const max = metric('1', 'max', { field: 'network.out.bytes' });
    const moving = metric('2', 'moving_average', { field: '1' });
    const derivative = metric('3', 'derivative', { field: '2' });
    assert.equal(calculateLabel(derivative, [max, moving, derivative]), 'Derivative of Moving Average of Max of network.out.bytes');
    const percentile = metric('1', 'percentile', { field: 'network.out.bytes' });
    const ofPercentile = metric('2', 'derivative', { field: '1[50.0]' });
    assert.equal(calculateLabel(ofPercentile, [percentile, ofPercentile]), 'Derivative of Percentile of network.out.bytes (50.0)');
    assert.equal(calculateLabel(metric('2', 'derivative', { field: '1' }), [{ ...max, alias: 'Outbound Traffic' }]), 'Derivative of Outbound Traffic');
  });

  it('tells the aggregations of documents from those computed from another metric', () => {
    assert.equal(isBasicAgg({ type: 'avg' }), true);
    assert.equal(isBasicAgg({ type: 'filter_ratio' }), true);
    assert.equal(isBasicAgg({ type: 'derivative' }), false);
    assert.equal(isBasicAgg({ type: 'math' }), false);
    assert.equal(isBasicAgg({ type: null }), false);
  });

  it('offers the pipelines only once a series has a metric of documents and another', () => {
    const groups = (options: ReturnType<typeof aggOptions>) => [...new Set(options.map((option) => option.group))];
    const one = aggOptions('timeseries', [metric('1', 'count')]);
    assert.deepEqual(groups(one), ['Metric Aggregations', 'Parent Pipeline Aggregations', 'Sibling Pipeline Aggregations', 'Special Aggregations']);
    assert.equal(one.find((option) => option.value === 'derivative')?.disabled, true);
    assert.equal(one.find((option) => option.value === 'avg')?.disabled, undefined);
    const two = aggOptions('timeseries', [metric('1', 'count'), metric('2', 'derivative', { field: '1' })]);
    assert.equal(two.find((option) => option.value === 'math')?.disabled, false);
    const onlyPipelines = aggOptions('timeseries', [metric('1', 'derivative'), metric('2', 'derivative')]);
    assert.equal(onlyPipelines.find((option) => option.value === 'derivative')?.disabled, true);
    assert.deepEqual(
      aggOptions('histogram', []).map((option) => option.value),
      ['avg', 'count', 'sum', 'value_count']
    );
    assert.equal(aggOptions('filter_ratio', []).length, 8);
    assert.equal(aggOptions('metrics', []).length, 16);
  });

  it('lists the metrics another can be computed from, without itself or what is computed from it', () => {
    const avg = metric('a', 'avg', { field: 'bytes' });
    const percentile = metric('p', 'percentile', { field: 'bytes', percentiles: [{ id: 'x', value: 95 }, { id: 'y', value: '' }] });
    const derivative = metric('d', 'derivative', { field: 'a' });
    const ofDerivative = metric('m', 'moving_average', { field: 'd' });
    const overall = metric('o', 'sum_bucket', { field: 'a' });
    const metrics = [avg, percentile, derivative, ofDerivative, overall];
    assert.deepEqual(
      calculateSiblings(metrics, derivative).map((row) => row.id),
      ['a', 'p', 'o']
    );
    assert.deepEqual(metricOptions({ metrics, metric: derivative }), [
      { value: 'a', label: 'Average of bytes' },
      { value: 'p[95.0]', label: 'Percentile of bytes (95.0)' },
    ]);
    assert.deepEqual(
      metricOptions({ metrics, metric: derivative, includeSiblings: true }).map((option) => option.value),
      ['a', 'o', 'p[95.0]']
    );
    assert.deepEqual(
      metricOptions({ metrics, restrict: 'basic', additionalOptions: [{ value: '_count', label: 'Doc Count (default)' }] }).map((option) => option.value),
      ['a', '_count']
    );
    assert.equal(toPercentileNumber(50), '50.0');
    assert.equal(toPercentileNumber('99.9'), '99.9');
  });

  it('lists the fields of the kinds an aggregation can be asked of', () => {
    assert.deepEqual(supportedFieldKinds('avg'), ['number', 'histogram']);
    assert.deepEqual(supportedFieldKinds('max'), ['number']);
    assert.equal(supportedFieldKinds('cardinality').includes('histogram'), false);
    assert.equal(supportedFieldKinds('cardinality').includes('string'), true);
    assert.equal(supportedFieldKinds('value_count').includes('histogram'), true);
  });
});

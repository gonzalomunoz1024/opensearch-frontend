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
import { colorOutput, cssColor, isPercent, parseColor, toHex } from '../../web/components/color_picker';
import { compileLess } from '../../web/apps/visualize/tsvb/less';
import { renderTemplate, TemplateError } from '../../web/lib/template';
import { HttpFetchError } from '../../web/services/http';
import { splitParts, tableSort, type TsvbData, type TsvbParams, type TsvbSeriesData } from '../../web/vis/tsvb/data';
import { errorDetails, panelError } from '../../web/vis/tsvb/error';
import { convertSeriesToVars, getLastValue, snakeCase } from '../../web/vis/tsvb/markdown_vars';

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

  it('takes a typed opacity only once it is a percent from 0 to 100, as the original range checks it', () => {
    assert.equal(isPercent('100'), true);
    assert.equal(isPercent('0'), true);
    assert.equal(isPercent('50.5'), true);
    assert.equal(isPercent(''), false);
    assert.equal(isPercent('101'), false);
    assert.equal(isPercent('-1'), false);
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

describe('the custom CSS of a TSVB markdown panel', () => {
  // The CSS the product saved for each of these, read from its editor
  const panel = '#markdown-61ca57f0-469d-11e7-af02-69e470af7417';
  const css = (less: string) => compileLess(`\n  ${less}\n`, panel);

  it('nests the Less under the panel and writes it compressed', () => {
    assert.equal(css('p { color: red; }'), `${panel} p{color:red}`);
    assert.equal(
      css('color: #FFFFFF; margin: 0px 0.5em;\np, h1 { font-family: Arial, sans-serif; }\na { &:hover { color: blue !important; } > span { padding: 0 } }'),
      `${panel}{color:#FFFFFF;margin:0 .5em}${panel} p,${panel} h1{font-family:Arial,sans-serif}${panel} a:hover{color:blue !important}${panel} a>span{padding:0}`
    );
    assert.equal(
      css('// a comment\n/* block */ h2 { font-size: 1.5em }\nh3 + p ~ ul { margin: 0 auto 10% }'),
      `${panel} h2{font-size:1.5em}${panel} h3+p~ul{margin:0 auto 10%}`
    );
    assert.equal(
      css('.a { .b { .c { width: calc(100% - 10px); } } &-x { top: 0.25rem } }'),
      `${panel} .a .b .c{width:calc(100% - 10px)}${panel} .a-x{top:.25rem}`
    );
  });

  it('writes variables in, and an @media inside a rule around the rule', () => {
    assert.equal(
      css('@c: red;\n.x { color: @c; @media (max-width: 600px) { color: blue; } }'),
      `${panel} .x{color:red}@media (max-width:600px){${panel} .x{color:blue}}`
    );
    assert.equal(css('@w: 2px; @s: @w; .y { border-width: @s }'), `${panel} .y{border-width:2px}`);
  });

  it('gives no CSS for what Less would not compile', () => {
    assert.equal(css('p { color: @undefinedvar; }'), undefined);
    assert.equal(css('p { color: red;'), undefined);
    assert.equal(css('p { color: red; } }'), undefined);
    assert.equal(css('@import "theme.less";'), undefined);
    assert.equal(css('p { just words }'), undefined);
  });
});

describe('the variables of a TSVB markdown panel', () => {
  it('names them in snake case as lodash does', () => {
    assert.equal(snakeCase('Average of bytes'), 'average_of_bytes');
    assert.equal(snakeCase('Percentile of bytes (95.0)'), 'percentile_of_bytes_95_0');
    assert.equal(snakeCase('XMLHttpRequest'), 'xml_http_request');
    assert.equal(snakeCase('version2'), 'version_2');
    assert.equal(snakeCase("Don't stop"), 'dont_stop');
    assert.equal(snakeCase('Zürich'), 'zurich');
    assert.equal(snakeCase('Straße'), 'strasse');
    assert.equal(snakeCase('Москва'), 'москва');
    assert.equal(snakeCase('北京市 Beijing'), '北京市_beijing');
    assert.equal(snakeCase('95th percentile'), '95th_percentile');
    assert.equal(snakeCase(undefined), '');
  });

  it('takes the last value as the product does, a 0 or a gap as 0', () => {
    assert.equal(getLastValue([[1, 3], [2, 4]]), 4);
    assert.equal(getLastValue([[1, 3], [2, null]]), 0);
    assert.equal(getLastValue([]), 0);
  });

  it('makes a variable of each series, under its variable name when it has one', () => {
    const day = 86400000;
    const row = (id: string, label: string, data: Array<[number, number | null]>) => ({
      id,
      seriesId: id.split(':')[0],
      label,
      color: '#000',
      data,
      last: null,
      series: { id: id.split(':')[0] },
      format: (value: number | null) => (value === null ? 'none' : value.toFixed(1)),
    });
    const params = { series: [{ id: 's1' }, { id: 's2', var_name: 'Rate' }] };
    const variables = convertSeriesToVars(
      [row('s1', 'Average of bytes', [[0, 1], [day, 2.5]]), row('s2:a', 'Zürich', [[0, null]]), row('s2:b', 'b', [])],
      params,
      'YYYY-MM-DD',
      'UTC'
    );
    assert.deepEqual(variables, {
      average_of_bytes: {
        last: { raw: 2.5, formatted: '2.5' },
        data: { raw: [[0, 1], [day, 2.5]], formatted: [['1970-01-01', '1.0'], ['1970-01-02', '2.5']] },
        label: 'Average of bytes',
      },
      zurich: { rate: { last: { raw: 0, formatted: '0.0' }, data: { raw: [[0, null]], formatted: [['1970-01-01', '']] } }, label: 'Zürich' },
      b: { rate: { last: { raw: 0, formatted: '0.0' }, data: { raw: [], formatted: [] } }, label: 'b' },
    });
  });

  it('stops at a name it has no value for, in strict mode, and says which', () => {
    const scope = { count: { label: 'Count' } };
    assert.equal(renderTemplate('{{ count.label }}', scope, { strict: true }), 'Count');
    assert.equal(renderTemplate('{{ count.nope }}', scope), '');
    assert.throws(
      () => renderTemplate('{{ count.nope }}', scope, { strict: true }),
      (error: unknown) => error instanceof TemplateError && error.kind === 'unknown' && error.variable === 'nope'
    );
    assert.throws(
      () => renderTemplate('{{#each count}}x', scope, { strict: true }),
      (error: unknown) => error instanceof TemplateError && error.kind === 'parse'
    );
  });
});

describe('the error a TSVB panel shows', () => {
  it('reads a DQL error, an OpenSearch error and any other failure as the product does', () => {
    const dql = Object.assign(new Error('Expected "(" but end of input found.\nfoo:(\n-----^'), {
      name: 'DQLSyntaxError',
      shortMessage: 'Expected "(" but end of input found.',
    });
    assert.deepEqual(panelError(dql), { message: 'Expected "(" but end of input found.' });
    const body = {
      error: { type: 'search_phase_execution_exception', reason: 'all shards failed', caused_by: { type: 'query_shard_exception', reason: 'Failed to parse query [foo:(]' } },
      status: 400,
    };
    assert.deepEqual(panelError(new HttpFetchError(400, 'all shards failed', body)), body);
    assert.deepEqual(panelError(new HttpFetchError(400, 'all shards failed', JSON.stringify(body))), body);
    assert.deepEqual(panelError(new HttpFetchError(502, 'Bad gateway', 'Bad gateway')), { message: 'Bad gateway' });
    assert.deepEqual(panelError(new Error('boom')), { message: 'boom' });
  });

  it('takes the title, the reason and the script stack from it', () => {
    assert.deepEqual(errorDetails({ message: 'Expected x' }), { title: undefined, reason: 'Expected x' });
    assert.deepEqual(
      errorDetails({ error: { type: 'search_phase_execution_exception', caused_by: { type: 'query_shard_exception', reason: 'Failed to parse query [foo:(]' } } }),
      { title: undefined, reason: 'Failed to parse query [foo:(]' }
    );
    // An illegal argument shows the reason of the error itself, without the ids in it
    assert.deepEqual(
      errorDetails({
        error: {
          type: 'search_phase_execution_exception',
          reason: 'all shards failed [0c3ab1d0-2f7e-11ee-be56-0242ac120002]',
          caused_by: { type: 'illegal_argument_exception', reason: 'Fielddata is disabled' },
        },
      }),
      { title: undefined, reason: 'all shards failed ' }
    );
    assert.deepEqual(
      errorDetails({
        error: {
          caused_by: {
            type: 'script_exception',
            reason: 'compile error',
            script_stack: ['params.a +', '          ^---- HERE'],
            caused_by: { reason: 'unexpected end of script.' },
          },
        },
      }),
      { title: undefined, reason: 'unexpected end of script.', stack: 'params.a +\n          ^---- HERE' }
    );
    assert.deepEqual(errorDetails({ error: { caused_by: { title: 'Error processing your markdown', reason: '{{foo}} is an unknown variable' } } }), {
      title: 'Error processing your markdown',
      reason: '{{foo}} is an unknown variable',
    });
  });
});

describe('the order of the rows of a TSVB table', () => {
  const params: TsvbParams = {
    type: 'table',
    pivot_id: 'request.keyword',
    series: [
      { id: 'a', metrics: [{ id: 'a1', type: 'count' }] },
      { id: 'b', metrics: [{ id: 'b1', type: 'avg', field: 'bytes' }] },
      { id: 'c', metrics: [{ id: 'c1', type: 'std_deviation', field: 'bytes' }] },
      { id: 'd', metrics: [{ id: 'd1', type: 'avg', field: 'bytes' }, { id: 'd2', type: 'derivative', field: 'd1' }] },
    ],
  };

  it('asks for no order until the table is sorted', () => {
    assert.deepEqual(tableSort(params, undefined), {});
  });

  it('orders by count, by a metric worked out in each row, or by the value of the field', () => {
    assert.deepEqual(tableSort(params, { column: 'a', order: 'desc' }), { order: { _count: 'desc' } });
    assert.deepEqual(tableSort(params, { column: 'b', order: 'asc' }), {
      order: { 'b1-SORT': 'asc' },
      sortAggs: { 'b1-SORT': { avg: { field: 'bytes' } } },
    });
    assert.deepEqual(tableSort(params, { column: 'c', order: 'desc' }), {
      order: { 'c1-SORT[std_deviation]': 'desc' },
      sortAggs: { 'c1-SORT': { extended_stats: { field: 'bytes' } } },
    });
    // A series whose last metric is not one OpenSearch can order by, and the field's own column
    assert.deepEqual(tableSort(params, { column: 'd', order: 'desc' }), { order: { _key: 'desc' } });
    assert.deepEqual(tableSort(params, { column: '_default_', order: 'desc' }), { order: { _key: 'desc' } });
    // A standard deviation drawn as its upper bound is ordered by that bound, with its sigma
    const bound: TsvbParams = { series: [{ id: 'e', metrics: [{ id: 'e1', type: 'std_deviation', field: 'bytes', mode: 'upper', sigma: '3' }] }] };
    assert.deepEqual(tableSort(bound, { column: 'e', order: 'asc' }), {
      order: { 'e1-SORT[std_upper]': 'asc' },
      sortAggs: { 'e1-SORT': { extended_stats: { field: 'bytes', sigma: 3 } } },
    });
  });
});

describe('the parts of a split TSVB metric or gauge', () => {
  const row = (id: string, label: string): TsvbSeriesData => ({
    id,
    seriesId: id.split(':')[0],
    label,
    color: '#111',
    data: [[0, 1]],
    last: 1,
    series: { id: id.split(':')[0] },
    format: String,
  });
  const data = (series: TsvbSeriesData[]): TsvbData => ({
    series,
    interval: { ms: 1, expression: '1ms' },
    range: { from: new Date(0), to: new Date(1) },
    annotations: [],
    requests: [],
  });

  it('draws one of an unsplit series', () => {
    assert.equal(splitParts({ series: [{ id: 'a', split_mode: 'everything' }] }, data([row('a', 'Count')])), undefined);
  });

  it('makes a part of each term, named by it, with the series named by its metric and the unsplit series beside it', () => {
    const params: TsvbParams = {
      series: [
        { id: 'a', split_mode: 'terms', metrics: [{ id: 'm', type: 'avg', field: 'bytes' }] },
        { id: 'b', split_mode: 'everything', label: 'All' },
      ],
    };
    const parts = splitParts(params, data([row('a:zip', 'zip'), row('a:404', '404'), row('a:gz', 'gz'), row('b', 'All')]));
    // Parts named by numbers come first, as the product's object keeps them; the unsplit series
    // comes after the split one, as it does in the panel's list
    assert.deepEqual(
      parts?.map((part) => [part.key, part.label, part.data.series.map((item) => `${item.id}=${item.label}`)]),
      [
        ['404', '404', ['a=Average of bytes', 'b=All']],
        ['zip', 'zip', ['a=Average of bytes', 'b=All']],
        ['gz', 'gz', ['a=Average of bytes', 'b=All']],
      ]
    );
  });
});

describe('the last value of a TSVB series', () => {
  it('is that of its last bucket, or 0 when the bucket has none, as the product reads it', () => {
    assert.equal(getLastValue([[0, 5], [1, null]]), 0);
    assert.equal(getLastValue([[0, 5], [1, 7]]), 7);
  });
});

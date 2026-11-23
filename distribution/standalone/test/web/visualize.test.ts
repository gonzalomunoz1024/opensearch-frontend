/* SPDX-License-Identifier: Apache-2.0 */

// The moments of a time axis are counted where the reader is: the tests read in UTC
process.env.TZ = 'UTC';

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AggEditor } from '../../web/apps/visualize/agg_editor';
import { RangeControl } from '../../web/apps/visualize/editor_controls';
import {
  addAgg,
  allowedAggs,
  axisName,
  changeAggType,
  fallbackMetric,
  newVis,
  nextAggId,
  nextAxisId,
  orderByParams,
  orderableMetric,
  parentPipelineMetric,
  syncParams,
  visProblems,
} from '../../web/apps/visualize/defaults';
import { classicTimeTicks } from '../../web/charts/core';
import { OTHER_KEY, buildAggsDsl, otherBucketAggs, planOtherBucket, tabify, type AggConfig, type AggContext } from '../../web/lib/aggs';
import type { Field, IndexPattern } from '../../web/lib/types';
import { visType } from '../../web/lib/vis';
import { createServices, type BootData } from '../../web/services';

const field = (name: string, type: string, more: Partial<Field> = {}): Field => ({
  name,
  type,
  searchable: true,
  aggregatable: true,
  ...more,
});

const logs: IndexPattern = {
  id: 'logs',
  title: 'logs-*',
  timeFieldName: 'timestamp',
  fields: [
    field('timestamp', 'date'),
    field('bytes', 'number'),
    field('geo.dest', 'string'),
    field('machine.os.keyword', 'string'),
    field('message', 'string', { aggregatable: false }),
  ],
  fieldFormatMap: {},
};

const context: AggContext = { indexPattern: logs };
const count: AggConfig = { id: '1', enabled: true, type: 'count', schema: 'metric', params: {} };

const schemaOf = (type: string, name: string) => {
  const schema = visType(type)?.schemas?.find((candidate) => candidate.name === name);
  if (!schema) throw new Error(`${type} has no part named ${name}`);
  return schema;
};

describe('a new visualization', () => {
  it('counts documents until someone says otherwise', () => {
    const vis = newVis('histogram', { indexPatternId: 'logs' });
    assert.deepEqual(vis.aggs, [count]);
    assert.equal(vis.type, 'histogram');
    assert.equal((vis.params.seriesParams as Array<{ type: string }>)[0].type, 'histogram');
  });

  it('has no aggregations when its kind asks for none', () => {
    assert.deepEqual(newVis('markdown', {}).aggs, []);
  });

  it('names the value axis of a horizontal bar chart LeftAxis-1, at the bottom, as the original', () => {
    const [axis] = newVis('horizontal_bar', {}).params.valueAxes as Array<{ name: string; position: string }>;
    assert.equal(axis.name, 'LeftAxis-1');
    assert.equal(axis.position, 'bottom');
  });
});

describe('the Options tab of a Markdown visualization', () => {
  it("writes the font size as the original's RangeOption: the value beside the handle and in a field", () => {
    // The tab's module loads the stylesheets of the maps, which a test cannot: its source is read
    const source = readFileSync('web/apps/visualize/options.tsx', 'utf8');
    const markdown = source.slice(source.indexOf('function MarkdownOptions('), source.indexOf('function JsonOptions('));
    assert.match(markdown, /<RangeControl\s+min=\{8\}\s+max=\{36\}[^>]*\sshowInput\s/);
    assert.match(markdown, /'Values must be on or between 8 and 36'/);
    // The value beside the handle is the control's own, as RangeOption's showValue
    assert.equal(/showValue=\{false\}/.test(markdown), false);
    const out = renderToStaticMarkup(createElement(RangeControl, { min: 8, max: 36, value: 14, showInput: true, onChange: () => undefined }));
    assert.match(out, /<output class="vzeRange__value"[^>]*>14(<!-- -->)?<\/output>/);
    assert.match(out, /<input type="number"[^>]* min="8" max="36"[^>]* value="14"/);
  });
});

describe('the aggregations a part of a chart accepts', () => {
  it('keeps a pie to one metric that can be a share of a whole', () => {
    const allowed = allowedAggs('pie', schemaOf('pie', 'metric'));
    assert.deepEqual(allowed, ['count', 'sum', 'cardinality', 'top_hits']);
  });

  it('gives the X-axis every bucket but the map grids', () => {
    const allowed = allowedAggs('line', schemaOf('line', 'segment'));
    assert.ok(allowed.includes('date_histogram'));
    assert.ok(allowed.includes('terms'));
    assert.ok(!allowed.includes('geohash_grid'));
    assert.ok(!allowed.includes('count'));
  });
});

describe('adding and changing aggregations', () => {
  it('numbers a new aggregation after the highest there is', () => {
    assert.equal(nextAggId([]), '1');
    assert.equal(nextAggId([count, { ...count, id: '7' }, { ...count, id: '3' }]), '8');
  });

  it('adds a metric and a bucket without a type, as the original adds one beside another', () => {
    const withMetric = addAgg([count], schemaOf('line', 'metric'));
    assert.deepEqual(withMetric[1], { id: '2', enabled: true, type: '', schema: 'metric', params: {} });
    const withBucket = addAgg([count], schemaOf('line', 'segment'));
    assert.deepEqual(withBucket[1], { id: '2', enabled: true, type: '', schema: 'segment', params: {} });
  });

  it('adds a split chart after the other buckets, where a pie asks for it to come first', () => {
    const terms: AggConfig = { id: '2', enabled: true, type: 'terms', schema: 'segment', params: { field: 'geo.dest', size: 5, orderBy: '1', order: 'desc' } };
    const next = addAgg([count, terms], schemaOf('pie', 'split'));
    assert.deepEqual(
      next.map((agg) => agg.id),
      ['1', '2', '3']
    );
    const split = { ...next[2], type: 'terms', params: { field: 'geo.dest', size: 5, orderBy: '1', order: 'desc' } };
    assert.equal(visProblems({ type: 'pie', aggs: [count, terms, split] }, logs)['3'], '"Split chart" aggs must run before all other buckets!');
    assert.equal(visProblems({ type: 'line', aggs: [count, terms, split] }, logs)['3'], undefined);
  });

  it('keeps the field when the type changes and the field still fits, and nothing else, as the original', () => {
    const average: AggConfig = { id: '1', enabled: true, type: 'avg', schema: 'metric', params: { field: 'bytes', customLabel: 'Size' } };
    const sum = changeAggType(average, 'sum', logs, [average]);
    assert.equal(sum.type, 'sum');
    assert.equal(sum.params?.field, 'bytes');
    assert.equal(sum.params?.customLabel, undefined);
  });

  it('drops a field the new type cannot be on', () => {
    const terms: AggConfig = { id: '2', enabled: true, type: 'terms', schema: 'segment', params: { field: 'geo.dest' } };
    const histogram = changeAggType(terms, 'histogram', logs, [count, terms]);
    assert.equal(histogram.params?.field, undefined, 'the field editor, not the type, picks the only field there is');
    const dates = changeAggType(terms, 'date_histogram', logs, [count, terms]);
    assert.equal(dates.params?.field, 'timestamp');
  });
});

describe('what a terms bucket is ordered by, and what a parent pipeline works on', () => {
  const average: AggConfig = { id: '2', enabled: true, type: 'avg', schema: 'metric', params: { field: 'bytes' } };
  const median: AggConfig = { id: '3', enabled: true, type: 'median', schema: 'metric', params: { field: 'bytes' } };
  const ranks: AggConfig = { id: '4', enabled: true, type: 'percentile_ranks', schema: 'metric', params: { field: 'bytes', values: [5000] } };
  const metrics = [count, average, median, ranks];

  it('gives way to the alphabet when the metric is gone or cannot order the terms, as the original', () => {
    assert.equal(fallbackMetric('1', metrics, orderableMetric, '_key'), undefined);
    assert.equal(fallbackMetric('2', metrics, orderableMetric, '_key'), undefined);
    assert.equal(fallbackMetric('7', metrics, orderableMetric, '_key'), '_key');
    assert.equal(fallbackMetric('3', metrics, orderableMetric, '_key'), '_key');
    // OpenSearch orders by one rank, not by all of them: the original offers each rank on its own
    assert.equal(fallbackMetric('4', metrics, orderableMetric, '_key'), '_key');
    for (const kept of ['_key', 'custom', '']) assert.equal(fallbackMetric(kept, metrics, orderableMetric, '_key'), undefined, kept);
  });

  it("gives way to a custom metric when a parent pipeline's metric is gone or is one it cannot work on", () => {
    assert.equal(fallbackMetric('2', metrics, parentPipelineMetric, 'custom'), undefined);
    assert.equal(fallbackMetric('7', metrics, parentPipelineMetric, 'custom'), 'custom');
    assert.equal(fallbackMetric('3', metrics, parentPipelineMetric, 'custom'), 'custom');
    assert.equal(fallbackMetric('4', metrics, parentPipelineMetric, 'custom'), 'custom');
    assert.equal(parentPipelineMetric({ ...average, type: 'top_hits' }), false);
    assert.equal(parentPipelineMetric({ ...average, type: 'cumulative_sum' }), true);
  });

  it('keeps a custom metric only while the terms are ordered by one', () => {
    const sum: AggConfig = { id: '2-orderAgg', enabled: true, type: 'sum', schema: 'orderAgg', params: { field: 'bytes' } };
    assert.deepEqual(orderByParams('2', '_key', sum), { orderBy: '_key', orderAgg: undefined });
    assert.deepEqual(orderByParams('2', '1', sum), { orderBy: '1', orderAgg: undefined });
    assert.deepEqual(orderByParams('2', 'custom', sum), { orderBy: 'custom', orderAgg: sum });
    assert.deepEqual(orderByParams('2', 'custom', undefined), { orderBy: 'custom', orderAgg: { id: '2-orderAgg', enabled: true, type: 'count', params: {}, schema: 'orderAgg' } });
  });

  it('lists the metrics as the original: "Metric: ..." each, with those that cannot be used switched off', () => {
    const boot = { basePath: '', version: '3.9.0', name: 'test', settings: {}, settingsDefaults: {}, settingsOverrides: {} };
    createServices(boot as unknown as BootData);
    const derivative: AggConfig = { id: '5', enabled: true, type: 'derivative', schema: 'metric', params: { metricAgg: '2' } };
    const terms: AggConfig = { id: '6', enabled: true, type: 'terms', schema: 'segment', params: { field: 'geo.dest', size: 5, order: 'desc', orderBy: '1' } };
    const aggs = [...metrics, derivative, terms];
    const draw = (agg: AggConfig) => renderToStaticMarkup(createElement(AggEditor, { agg, types: [agg.type], indexPattern: logs, aggs, context, onChange: () => undefined }));
    const option = (value: string, label: string, disabled: boolean) => new RegExp(`<option value="${value}"(?: selected="")?${disabled ? ' disabled=""' : ''}>${label}</option>`);
    const pipeline = draw(derivative);
    assert.match(pipeline, option('1', 'Metric: Count', false));
    assert.match(pipeline, option('2', 'Metric: Average bytes', false));
    assert.match(pipeline, option('3', 'Metric: Median bytes', true));
    assert.match(pipeline, option('4', 'Metric: Percentile ranks of bytes', true));
    assert.match(pipeline, option('custom', 'Custom metric', false));
    const order = draw(terms);
    assert.match(order, option('2', 'Metric: Average bytes', false));
    assert.match(order, option('3', 'Metric: Median bytes', true));
    assert.match(order, option('4', 'Metric: Percentile ranks of bytes', true));
    assert.match(order, option('_key', 'Alphabetical', false));
  });
});

describe('what keeps a chart from being drawn', () => {
  it('names an aggregation without a type or a field', () => {
    const problems = visProblems(
      {
        type: 'line',
        aggs: [count, { id: '2', enabled: true, type: '', schema: 'segment', params: {} }, { id: '3', enabled: true, type: 'avg', schema: 'metric', params: {} }],
      },
      logs
    );
    assert.equal(problems['2'], 'Select an aggregation');
    assert.equal(problems['3'], 'Select a field');
  });

  it('names an aggregation without a type even when it is switched off, as the form of the original does', () => {
    const problems = visProblems({ type: 'line', aggs: [count, { id: '2', enabled: false, type: '', schema: 'segment', params: {} }] }, logs);
    assert.deepEqual(problems, { '2': 'Select an aggregation' });
  });

  it('asks for a field the index pattern does not have to be chosen again', () => {
    const problems = visProblems({ type: 'line', aggs: [{ id: '1', enabled: true, type: 'avg', schema: 'metric', params: { field: 'gone' } }] }, logs);
    assert.equal(problems['1'], 'Select a field');
  });

  it('wants a histogram under a derivative', () => {
    const derivative: AggConfig = {
      id: '2',
      enabled: true,
      type: 'derivative',
      schema: 'metric',
      params: { metricAgg: 'custom', customMetric: { id: '2-metric', enabled: true, type: 'count', params: {} } },
    };
    const terms: AggConfig = { id: '3', enabled: true, type: 'terms', schema: 'segment', params: { field: 'geo.dest', size: 5, orderBy: '_key', order: 'desc' } };
    assert.match(visProblems({ type: 'line', aggs: [derivative, terms] }, logs)['3'], /Date Histogram/);
    const dates: AggConfig = { id: '3', enabled: true, type: 'date_histogram', schema: 'segment', params: { field: 'timestamp', interval: 'auto' } };
    assert.deepEqual(visProblems({ type: 'line', aggs: [derivative, dates] }, logs), {});
  });
});

describe('the settings that follow the aggregations', () => {
  const line = () => newVis('line', { indexPatternId: 'logs' });

  it('gives each metric a series like the last one', () => {
    const vis = line();
    const average: AggConfig = { id: '2', enabled: true, type: 'avg', schema: 'metric', params: { field: 'bytes' } };
    const params = syncParams({ ...vis, aggs: [...vis.aggs, average] }, context);
    const series = params.seriesParams as Array<{ type: string; data: { id: string; label: string } }>;
    assert.deepEqual(
      series.map((item) => item.data),
      [
        { id: '1', label: 'Count' },
        { id: '2', label: 'Average bytes' },
      ]
    );
    assert.equal(series[1].type, series[0].type);
  });

  it('renames an axis after its only series, unless someone named it', () => {
    const vis = line();
    const average: AggConfig = { id: '1', enabled: true, type: 'avg', schema: 'metric', params: { field: 'bytes' } };
    const followed = syncParams({ ...vis, aggs: [average] }, context);
    assert.equal((followed.valueAxes as Array<{ title: { text: string } }>)[0].title.text, 'Average bytes');

    const named = { ...vis.params, valueAxes: (vis.params.valueAxes as Array<Record<string, unknown>>).map((axis) => ({ ...axis, title: { text: 'Traffic' } })) };
    const kept = syncParams({ ...vis, params: named, aggs: [average] }, context);
    assert.equal((kept.valueAxes as Array<{ title: { text: string } }>)[0].title.text, 'Traffic');
  });

  it('changes nothing when nothing changed', () => {
    const vis = line();
    assert.equal(syncParams(vis, context), vis.params);
    const pie = newVis('pie', { indexPatternId: 'logs' });
    assert.equal(syncParams(pie, context), pie.params);
  });

  it('names and numbers a new axis after the ones on its side', () => {
    assert.equal(axisName('left', [{ name: 'LeftAxis-1' }]), 'LeftAxis-2');
    assert.equal(axisName('right', [{ name: 'LeftAxis-1' }]), 'RightAxis-1');
    assert.equal(nextAxisId([{ id: 'ValueAxis-1' }, { id: 'ValueAxis-4' }]), 'ValueAxis-5');
  });
});

describe('JSON input', () => {
  it('is merged into what an aggregation asks', () => {
    const dsl = buildAggsDsl(
      [
        { id: '1', enabled: true, type: 'avg', schema: 'metric', params: { field: 'bytes', json: '{ "missing": 0 }' } },
        { id: '2', enabled: true, type: 'terms', schema: 'segment', params: { field: 'geo.dest', size: 3, orderBy: '_key', json: '{"shard_size": 50}' } },
      ],
      context
    );
    const terms = dsl['2'] as { terms: Record<string, unknown>; aggs: Record<string, { avg: Record<string, unknown> }> };
    assert.equal(terms.terms.shard_size, 50);
    assert.equal(terms.terms.field, 'geo.dest');
    assert.deepEqual(terms.aggs['1'].avg, { field: 'bytes', missing: 0 });
  });

  it('is left out while it is not an object yet', () => {
    const ask = (json: string) =>
      (buildAggsDsl([{ id: '1', enabled: true, type: 'avg', schema: 'metric', params: { field: 'bytes', json } }], context)['1'] as { avg: unknown }).avg;
    assert.deepEqual(ask('{ "missing": '), { field: 'bytes' });
    assert.deepEqual(ask('[1]'), { field: 'bytes' });
    assert.deepEqual(ask('  '), { field: 'bytes' });
  });
});

describe('a date histogram without its partial buckets', () => {
  const hour = 3600000;
  const from = Date.UTC(2026, 10, 20, 0, 30);
  const to = Date.UTC(2026, 10, 20, 4, 30);
  const first = Date.UTC(2026, 10, 20, 0);
  const response = {
    aggregations: { '2': { buckets: [0, 1, 2, 3, 4].map((index) => ({ key: first + index * hour, doc_count: index + 1 })) } },
  };
  const histogram = (params: Record<string, unknown>): AggConfig[] => [
    count,
    { id: '2', enabled: true, type: 'date_histogram', schema: 'segment', params: { field: 'timestamp', interval: 'h', ...params } },
  ];
  const range = { from: new Date(from), to: new Date(to) };

  it('keeps the buckets that are whole inside the time range', () => {
    const table = tabify(histogram({ drop_partials: true }), response, { ...context, timeRange: range });
    assert.deepEqual(
      table.rows.map((row) => row[table.columns[0].id]),
      [first + hour, first + 2 * hour, first + 3 * hour]
    );
  });

  it('keeps them all when nobody asked', () => {
    assert.equal(tabify(histogram({}), response, { ...context, timeRange: range }).rows.length, 5);
  });

  it('keeps them all on a field that is not the one the time range is on', () => {
    const other = { ...logs, timeFieldName: 'utc_time' };
    const table = tabify(histogram({ drop_partials: true }), response, { indexPattern: other, timeRange: range });
    assert.equal(table.rows.length, 5);
  });
});

describe('the bucket of other values', () => {
  const os: AggConfig = { id: '3', enabled: true, type: 'terms', schema: 'split', params: { field: 'machine.os.keyword', size: 2, orderBy: '1', order: 'desc' } };
  const dest = (params: Record<string, unknown> = {}): AggConfig => ({
    id: '2',
    enabled: true,
    type: 'terms',
    schema: 'segment',
    params: { field: 'geo.dest', size: 2, orderBy: '1', order: 'desc', otherBucket: true, otherBucketLabel: 'Other', ...params },
  });
  const average: AggConfig = { id: '4', enabled: true, type: 'avg', schema: 'metric', params: { field: 'bytes' } };

  it('asks for the documents in none of the terms, with what is asked under each term', () => {
    const aggs = [count, average, dest()];
    const dsl = buildAggsDsl(aggs, context);
    const response = { aggregations: { '2': { buckets: [{ key: 'CN', doc_count: 9 }, { key: 'IN', doc_count: 7 }] } } };
    const plan = planOtherBucket(aggs, dsl, response, context);
    if (!plan) throw new Error('nothing is asked');
    assert.deepEqual(plan.aggs, {
      'other-filter': {
        filters: {
          filters: {
            '': {
              bool: {
                must: [],
                filter: [{ exists: { field: 'geo.dest' } }],
                should: [],
                must_not: [{ match_phrase: { 'geo.dest': 'CN' } }, { match_phrase: { 'geo.dest': 'IN' } }],
              },
            },
          },
        },
        aggs: { '4': { avg: { field: 'bytes' } } },
      },
    });

    plan.apply({ 'other-filter': { buckets: { '': { doc_count: 30, '4': { value: 12 } } } } });
    const table = tabify(aggs, response, context);
    const last = table.rows[table.rows.length - 1];
    assert.equal(table.rows.length, 3);
    assert.deepEqual(
      table.columns.map((column) => last[column.id]),
      [OTHER_KEY, 30, 12]
    );
    assert.equal(table.columns[0].format(OTHER_KEY), 'Other');
  });

  it('asks once per bucket above it, narrowed to that bucket', () => {
    const aggs = [count, os, dest()];
    const response = {
      aggregations: {
        '3': {
          buckets: [
            { key: 'osx', doc_count: 20, '2': { buckets: [{ key: 'CN', doc_count: 9 }] } },
            { key: 'win 8', doc_count: 10, '2': { buckets: [{ key: 'US', doc_count: 4 }] } },
          ],
        },
      },
    };
    const plan = planOtherBucket(aggs, buildAggsDsl(aggs, context), response, context);
    if (!plan) throw new Error('nothing is asked');
    const filters = (plan.aggs['other-filter'] as { filters: { filters: Record<string, { bool: { filter: unknown[]; must_not: unknown[] } }> } }).filters.filters;
    assert.deepEqual(Object.keys(filters), ['-osx', '-win 8']);
    assert.deepEqual(filters['-win 8'].bool.filter, [{ match_phrase: { 'machine.os.keyword': 'win 8' } }, { exists: { field: 'geo.dest' } }]);
    assert.deepEqual(filters['-win 8'].bool.must_not, [{ match_phrase: { 'geo.dest': 'US' } }]);

    // Nothing else under "win 8": it gets no bucket
    plan.apply({ 'other-filter': { buckets: { '-osx': { doc_count: 11 }, '-win 8': { doc_count: 0 } } } });
    const table = tabify(aggs, response, context);
    assert.deepEqual(
      table.rows.map((row) => [row[table.columns[0].id], row[table.columns[1].id], row[table.columns[2].id]]),
      [
        ['osx', 'CN', 9],
        ['osx', OTHER_KEY, 11],
        ['win 8', 'US', 4],
      ]
    );
  });

  it('leaves documents without the field to the "missing" bucket when it is shown', () => {
    const aggs = [count, dest({ missingBucket: true })];
    const shown = { aggregations: { '2': { buckets: [{ key: 'CN', doc_count: 9 }, { key: '__missing__', doc_count: 2 }] } } };
    const withMissing = planOtherBucket(aggs, buildAggsDsl(aggs, context), shown, context);
    const bool = (plan: typeof withMissing) =>
      (plan?.aggs['other-filter'] as { filters: { filters: Record<string, { bool: { filter: unknown[]; must_not: unknown[] } }> } }).filters.filters[''].bool;
    assert.deepEqual(bool(withMissing).filter, [{ exists: { field: 'geo.dest' } }]);
    assert.deepEqual(bool(withMissing).must_not, [{ match_phrase: { 'geo.dest': 'CN' } }]);

    const hidden = { aggregations: { '2': { buckets: [{ key: 'CN', doc_count: 9 }] } } };
    assert.deepEqual(bool(planOtherBucket(aggs, buildAggsDsl(aggs, context), hidden, context)).filter, []);
  });

  it('asks nothing without terms, or when nobody asked', () => {
    const aggs = [count, dest()];
    assert.equal(planOtherBucket(aggs, buildAggsDsl(aggs, context), { aggregations: { '2': { buckets: [] } } }, context), undefined);
    const plain = [count, dest({ otherBucket: false })];
    const response = { aggregations: { '2': { buckets: [{ key: 'CN', doc_count: 9 }] } } };
    assert.equal(planOtherBucket(plain, buildAggsDsl(plain, context), response, context), undefined);
  });

  it('asks for the rest of a terms aggregation under another in turn, under the rest of that one too', () => {
    const outer = { ...dest(), id: '3', params: { ...dest().params, field: 'machine.os.keyword' } };
    const aggs = [count, outer, dest()];
    assert.deepEqual(otherBucketAggs(aggs).map((agg) => agg.id), ['3', '2']);
    const dsl = buildAggsDsl(aggs, context);
    const response = {
      aggregations: { '3': { buckets: [{ key: 'osx', doc_count: 20, '2': { buckets: [{ key: 'CN', doc_count: 9 }] } }] } },
    };
    const first = planOtherBucket(aggs, dsl, response, context, '3');
    if (!first) throw new Error('nothing is asked for the outer terms');
    // The outer rest comes with the inner terms under it
    first.apply({ 'other-filter': { buckets: { '': { doc_count: 15, '2': { buckets: [{ key: 'US', doc_count: 6 }] } } } } });
    const second = planOtherBucket(aggs, dsl, response, context, '2');
    if (!second) throw new Error('nothing is asked for the inner terms');
    const filters = (second.aggs['other-filter'] as { filters: { filters: Record<string, { bool: Record<string, unknown[]> }> } }).filters.filters;
    assert.deepEqual(Object.keys(filters), ['-osx', '-__other__']);
    // Under the outer rest: none of the outer terms, then none of the inner ones there
    assert.deepEqual(filters['-__other__'].bool.filter, [{ exists: { field: 'geo.dest' } }]);
    assert.deepEqual(filters['-__other__'].bool.must_not, [
      { bool: { should: [{ match_phrase: { 'machine.os.keyword': 'osx' } }], minimum_should_match: 1 } },
      { match_phrase: { 'geo.dest': 'US' } },
    ]);
    second.apply({ 'other-filter': { buckets: { '-osx': { doc_count: 11 }, '-__other__': { doc_count: 9 } } } });
    const table = tabify(aggs, response, context);
    assert.deepEqual(
      table.rows.map((row) => [row[table.columns[0].id], row[table.columns[1].id], row[table.columns[2].id]]),
      [
        ['osx', 'CN', 9],
        ['osx', OTHER_KEY, 11],
        [OTHER_KEY, 'US', 6],
        [OTHER_KEY, OTHER_KEY, 9],
      ]
    );
  });
});

describe('the ticks of a classic time axis', () => {
  const day = 86400000;
  const iso = (ticks: number[]) => ticks.map((tick) => new Date(tick).toISOString());

  it('falls on every second day of the month across a week', () => {
    // A third of a week is nearer to two days than to a week
    const ticks = classicTimeTicks(Date.UTC(2026, 10, 15, 9), Date.UTC(2026, 10, 22, 9), 3);
    assert.deepEqual(iso(ticks), ['2026-11-17T00:00:00.000Z', '2026-11-19T00:00:00.000Z', '2026-11-21T00:00:00.000Z']);
  });

  it('falls on every day when a week is cut in five', () => {
    const ticks = classicTimeTicks(Date.UTC(2026, 10, 15, 9), Date.UTC(2026, 10, 22, 9), 5);
    assert.equal(ticks.length, 7);
    assert.equal(iso(ticks)[0], '2026-11-16T00:00:00.000Z');
  });

  it('falls on every third hour across a day', () => {
    const ticks = classicTimeTicks(Date.UTC(2026, 10, 20, 1), Date.UTC(2026, 10, 21, 1), 8);
    assert.equal(ticks.length, 8);
    assert.equal(new Date(ticks[0]).toISOString(), '2026-11-20T03:00:00.000Z');
    assert.ok(ticks.every((tick) => new Date(tick).getUTCHours() % 3 === 0));
  });

  it('falls on the first of a month across a year', () => {
    const ticks = classicTimeTicks(Date.UTC(2026, 0, 10), Date.UTC(2026, 11, 20), 10);
    assert.ok(ticks.length >= 10);
    assert.ok(ticks.every((tick) => new Date(tick).getUTCDate() === 1 && new Date(tick).getUTCHours() === 0));
  });

  it('stays inside the range', () => {
    const from = Date.UTC(2026, 10, 1, 13, 20);
    const to = from + 40 * day;
    for (const count of [2, 4, 7, 11]) {
      const ticks = classicTimeTicks(from, to, count);
      assert.ok(ticks.length > 0);
      assert.ok(ticks.every((tick) => tick >= from && tick <= to));
    }
  });
});

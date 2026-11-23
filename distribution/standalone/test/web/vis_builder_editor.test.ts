/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  afterChange,
  aggTypeFor,
  aggregationsProblem,
  draftForEditing,
  droppedAggs,
  fieldDetails,
  lastAddressIn,
  newAppState,
  newDraft,
  openedState,
  originatingAppOf,
  persistedAggs,
  readAppState,
  saveDisabledReason,
  schemaAggTypes,
  urlAppState,
  validAggTypes,
  withAggs,
  withDraft,
  withEditorError,
  withIndexPattern,
  withPipelineBuckets,
  withSavedDraft,
  withStatus,
  withType,
  type AppState,
} from '../../web/apps/vis_builder/editor_state';
import { visBuilderType, type VisBuilderSchema, type VisBuilderType } from '../../web/apps/vis_builder/model';
import type { AggConfig } from '../../web/lib/aggs';
import type { Field, IndexPattern } from '../../web/lib/types';
import { encodeState } from '../../web/lib/url';

function defined<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`${what} is missing`);
  return value;
}

const field = (name: string, type: string, extra: Partial<Field> = {}): Field => ({ name, type, searchable: true, aggregatable: true, ...extra });
const PATTERN: IndexPattern = {
  id: 'ff959d40-b880-11e8-a6d9-e546fe2bba5f',
  title: 'opensearch_dashboards_sample_data_ecommerce',
  timeFieldName: 'order_date',
  fieldFormatMap: {},
  fields: [
    field('order_date', 'date'),
    field('category.keyword', 'string', { subType: { multi: { parent: 'category' } } }),
    field('taxful_total_price', 'number'),
    field('geoip.location', 'geo_point'),
  ],
};
const fieldNamed = (name: string): Field => defined(PATTERN.fields.find((candidate) => candidate.name === name), name);
const kind = (name: string): VisBuilderType => defined(visBuilderType(name), name);
const schemaOf = (kindName: string, schemaName: string): VisBuilderSchema =>
  defined(kind(kindName).schemas.find((candidate) => candidate.name === schemaName), schemaName);

const COUNT: AggConfig = { enabled: true, id: '1', params: {}, schema: 'metric', type: 'count' };
const ORDER_DATE: AggConfig = {
  enabled: true,
  id: '2',
  params: {
    field: 'order_date',
    useNormalizedOpenSearchInterval: true,
    scaleMetricValues: false,
    interval: 'auto',
    drop_partials: false,
    min_doc_count: 1,
    extended_bounds: {},
  },
  schema: 'segment',
  type: 'date_histogram',
};
const CATEGORY: AggConfig = {
  enabled: true,
  id: '3',
  params: {
    field: 'category.keyword',
    order: 'desc',
    size: 5,
    otherBucket: false,
    otherBucketLabel: 'Other',
    missingBucket: false,
    missingBucketLabel: 'Missing',
  },
  schema: 'group',
  type: 'terms',
};

const withAggsOf = (state: AppState, aggs: AggConfig[]) => withAggs(state, aggs);

describe('the VisBuilder page state', () => {
  it('starts as a bar chart with nothing on it, clean, on the default index pattern', () => {
    assert.deepEqual(newAppState(PATTERN.id), {
      metadata: { editor: { errors: {}, state: 'clean' }, isMigrated: false },
      style: { addTooltip: true, addLegend: true, legendPosition: 'right', type: 'histogram' },
      ui: {},
      visualization: { searchField: '', activeVisualization: { name: 'histogram', aggConfigParams: [] }, indexPattern: PATTERN.id },
    });
  });

  it('turns dirty on the first change once clean, but not on its own bookkeeping or while loading', () => {
    const clean = newAppState(PATTERN.id);
    assert.equal(afterChange(clean, withDraft(clean, newDraft([], schemaOf('histogram', 'metric')))).metadata.editor.state, 'dirty');
    assert.equal(afterChange(clean, withEditorError(clean, 'SECONDARY_PANEL', true)).metadata.editor.state, 'clean');
    const loading = withStatus(clean, 'loading');
    assert.equal(afterChange(loading, withAggsOf(loading, [COUNT])).metadata.editor.state, 'loading');
  });

  it('is read from the address as OpenSearch Dashboards writes it, and written back the same', () => {
    // What the address holds once "Click or drop to add" opens a new aggregation of the Y-axis
    const raw =
      "(metadata:(editor:(errors:(SECONDARY_PANEL:!t),state:dirty),isMigrated:!f),style:(addLegend:!t,addTooltip:!t,legendPosition:right,type:histogram)," +
      "ui:(),visualization:(activeVisualization:(aggConfigParams:!(),draftAgg:(enabled:!t,id:'1',params:(),schema:metric),name:histogram)," +
      "indexPattern:ff959d40-b880-11e8-a6d9-e546fe2bba5f,searchField:''))";
    const state = defined(readAppState(raw), 'the state');
    // the aggregation being added has no type yet: an empty one here, none in the address
    assert.equal(state.visualization.activeVisualization?.draftAgg?.type, '');
    assert.equal(encodeState(urlAppState(state)), raw);
    assert.deepEqual(state, withEditorError(withStatus(withDraft(newAppState(PATTERN.id), newDraft([], schemaOf('histogram', 'metric'))), 'dirty'), 'SECONDARY_PANEL', true));
    // what is missing is filled in, and what is not a state is none
    assert.deepEqual(readAppState('(visualization:(activeVisualization:(name:line)))'), {
      metadata: { editor: { state: 'loading' } },
      style: {},
      ui: {},
      visualization: { searchField: '', activeVisualization: { name: 'line', aggConfigParams: [] } },
    });
    assert.equal(readAppState(undefined), undefined);
    assert.equal(readAppState('(style:(type:line))'), undefined);
  });

  it('opens a saved visualization clean, and empties the chart for another index pattern', () => {
    const saved = { state: { style: kind('line').style(), ui: {}, visualization: { searchField: '', activeVisualization: { name: 'line', aggConfigParams: [COUNT] }, indexPattern: 'a' } } };
    const opened = openedState(undefined, saved);
    assert.equal(opened.metadata.editor.state, 'clean');
    assert.deepEqual(opened.visualization, saved.state.visualization);
    const other = withIndexPattern(withDraft(opened, { ...COUNT, id: '2' }), 'b');
    assert.deepEqual(other.visualization, { searchField: '', activeVisualization: { name: 'line', aggConfigParams: [] }, indexPattern: 'b' });
  });

  it('says why it cannot be saved as the Save button does', () => {
    const empty = newAppState(PATTERN.id);
    assert.equal(saveDisabledReason(empty), 'The canvas is empty. Add some aggregations before saving.');
    const clean = withAggsOf(empty, [COUNT]);
    assert.equal(saveDisabledReason(clean), 'Add some changes before saving.');
    const dirty = withStatus(clean, 'dirty');
    assert.equal(saveDisabledReason(dirty), undefined);
    assert.equal(saveDisabledReason(withDraft(dirty, newDraft([COUNT], schemaOf('histogram', 'metric')))), 'Update unapplied aggregation changes before saving.');
    // a migrated visualization can be saved as it is
    assert.equal(saveDisabledReason({ ...clean, metadata: { ...clean.metadata, isMigrated: true } }), undefined);
  });

  it('keeps the aggregation being edited in place of the one it edits, or after the others', () => {
    const state = withAggsOf(newAppState(PATTERN.id), [COUNT, ORDER_DATE]);
    const average: AggConfig = { enabled: true, id: '3', params: { field: 'taxful_total_price' }, schema: 'metric', type: 'avg' };
    const added = withSavedDraft(withDraft(state, average));
    assert.deepEqual(added.visualization.activeVisualization?.aggConfigParams, [COUNT, ORDER_DATE, average]);
    // the panel stays open on it
    assert.deepEqual(added.visualization.activeVisualization?.draftAgg, average);
    const sum = { ...COUNT, type: 'sum', params: { field: 'taxful_total_price' } };
    assert.deepEqual(withSavedDraft(withDraft(state, sum)).visualization.activeVisualization?.aggConfigParams, [sum, ORDER_DATE]);
  });
});

describe('an aggregation opened in the panel that edits it', () => {
  const count: AggConfig = { id: '4', enabled: true, type: 'count', schema: 'metric', params: {} };
  const median: AggConfig = { id: '2', enabled: true, type: 'median', schema: 'metric', params: { field: 'bytes' } };
  const terms: AggConfig = { id: '6', enabled: true, type: 'terms', schema: 'group', params: { field: 'response.keyword', order: 'desc', size: 5 } };

  it('gives terms ordered by nothing the first metric they can be ordered by', () => {
    assert.deepEqual(draftForEditing([median, count, terms], terms).params, { field: 'response.keyword', order: 'desc', size: 5, orderBy: '4' });
  });

  it('orders them by the alphabet when no metric can order them', () => {
    assert.equal(draftForEditing([median, terms], terms).params?.orderBy, '_key');
    assert.equal(draftForEditing([{ ...count, enabled: false }, terms], terms).params?.orderBy, '_key');
  });

  it('leaves an order that is set, and every other aggregation, as they are', () => {
    const custom = { ...terms, params: { ...terms.params, orderBy: 'custom' } };
    assert.equal(draftForEditing([count, custom], custom), custom);
    assert.equal(draftForEditing([count, terms], count), count);
  });
});

describe('a VisBuilder page opened from a dashboard', () => {
  const saved = { state: { style: kind('line').style(), ui: {}, visualization: { searchField: '', activeVisualization: { name: 'line', aggConfigParams: [COUNT] }, indexPattern: 'a' } } };

  it('keeps where it came from in the address, as OpenSearch Dashboards writes it', () => {
    // The address OpenSearch Dashboards is at once a panel's "Edit visBuilder" has opened the editor
    const raw =
      '(metadata:(editor:(errors:(),state:clean),isMigrated:!f,originatingApp:dashboards),style:(addLegend:!t,addTooltip:!t,legendPosition:right,type:line),' +
      "ui:(),visualization:(activeVisualization:(aggConfigParams:!((enabled:!t,id:'1',params:(drop_partials:!f,extended_bounds:(),field:'@timestamp'," +
      'interval:auto,min_doc_count:1,scaleMetricValues:!f,useNormalizedOpenSearchInterval:!t),schema:segment,type:date_histogram),' +
      "(enabled:!t,id:'2',params:(field:bytes),schema:metric,type:avg)),name:line),indexPattern:'90943e30-9a47-11e8-b64d-95841ca0b247',searchField:''))";
    const state = defined(readAppState(raw), 'the state');
    assert.equal(originatingAppOf(state), 'dashboards');
    assert.equal(encodeState(urlAppState(state)), raw);
    // a change keeps it, and the page still knows where to go back to
    const dirty = afterChange(state, withAggsOf(state, [COUNT]));
    assert.equal(dirty.metadata.editor.state, 'dirty');
    assert.equal(originatingAppOf(dirty), 'dashboards');
  });

  it('takes it from what the dashboard handed over only when the address says nothing yet', () => {
    assert.deepEqual(newAppState(PATTERN.id, 'dashboards').metadata, { editor: { errors: {}, state: 'clean' }, isMigrated: false, originatingApp: 'dashboards' });
    assert.equal(originatingAppOf(newAppState(PATTERN.id)), undefined);
    const opened = openedState(undefined, saved, 'dashboards');
    assert.deepEqual(opened.metadata, { editor: { errors: {}, state: 'clean' }, isMigrated: false, originatingApp: 'dashboards' });
    // an address that already holds a state says it itself: one opened in another tab came from nowhere
    assert.equal(originatingAppOf(openedState(newAppState(PATTERN.id), saved, 'dashboards')), undefined);
    assert.equal(originatingAppOf(openedState(newAppState(PATTERN.id, 'dashboards'), saved)), 'dashboards');
    assert.equal(originatingAppOf({ ...opened, metadata: { ...opened.metadata, originatingApp: '' } }), undefined);
  });

  it('finds the address the dashboards were last at among the entries of the tab', () => {
    const origin = 'http://localhost:5655';
    const entries = [
      `${origin}/app/home`,
      `${origin}/app/dashboards#/list`,
      `${origin}/app/dashboards#/view/dash-1?_g=(time:(from:now-7d,to:now))&_a=(viewMode:edit)`,
      `${origin}/app/vis-builder/edit/vis-1#/?_a=(a:1)`,
      `${origin}/app/vis-builder/edit/vis-1#/?_a=(a:2)`,
      `${origin}/app/dashboards#/view/later`,
    ];
    const last = '/app/dashboards#/view/dash-1?_g=(time:(from:now-7d,to:now))&_a=(viewMode:edit)';
    assert.equal(lastAddressIn(entries, 4, 'dashboards', origin, ''), last);
    assert.equal(lastAddressIn(entries, 3, 'dashboards', origin, ''), last);
    // what is before the page counts, not what the browser could go forward to
    assert.equal(lastAddressIn(entries, 2, 'dashboards', origin, ''), '/app/dashboards#/list');
    assert.equal(lastAddressIn(entries, 1, 'dashboards', origin, ''), undefined);
    assert.equal(lastAddressIn(entries, 9, 'dashboards', origin, ''), '/app/dashboards#/view/later');
    assert.equal(lastAddressIn(entries, 4, 'visualize', origin, ''), undefined);
    // an entry with no address, a base path a proxy put in front, another site, another application
    assert.equal(lastAddressIn([`${origin}/app/dashboards?embed=true#/create`, null, 'not an address'], 3, 'dashboards', origin, ''), '/app/dashboards?embed=true#/create');
    assert.equal(lastAddressIn([`${origin}/base/app/dashboards#/create`], 1, 'dashboards', origin, '/base'), '/app/dashboards#/create');
    assert.equal(lastAddressIn([`${origin}/app/dashboards#/create`], 1, 'dashboards', origin, '/base'), undefined);
    assert.equal(lastAddressIn(['http://elsewhere.example/app/dashboards#/create'], 1, 'dashboards', origin, ''), undefined);
    assert.equal(lastAddressIn([`${origin}/app/dashboards-other#/create`], 1, 'dashboards', origin, ''), undefined);
  });
});

describe('what is dropped on a part of the chart', () => {
  const metric = schemaOf('histogram', 'metric');
  const segment = schemaOf('histogram', 'segment');
  const group = schemaOf('histogram', 'group');
  const split = schemaOf('histogram', 'split');
  const drop = (aggs: AggConfig[], source: { count: boolean; field?: Field }, schema: VisBuilderSchema, aggId?: string) =>
    droppedAggs(aggs, { kind: 'field', source }, { schema, aggId }, PATTERN);

  it('becomes the aggregation the part prefers among those it can be', () => {
    assert.equal(aggTypeFor(validAggTypes({ count: true }, metric), metric), 'count');
    assert.equal(aggTypeFor(validAggTypes({ count: false, field: fieldNamed('taxful_total_price') }, metric), metric), 'median');
    assert.equal(aggTypeFor(validAggTypes({ count: false, field: fieldNamed('order_date') }, segment), segment), 'date_histogram');
    assert.equal(aggTypeFor(validAggTypes({ count: false, field: fieldNamed('category.keyword') }, segment), segment), 'terms');
    const metricOfMetric = schemaOf('metric', 'metric');
    assert.equal(aggTypeFor(validAggTypes({ count: false, field: fieldNamed('category.keyword') }, metricOfMetric), metricOfMetric), 'cardinality');
    // a geo point takes no bucket of a bar chart
    assert.deepEqual(validAggTypes({ count: false, field: fieldNamed('geoip.location') }, segment), []);
  });

  it('adds what OpenSearch Dashboards adds, with the parameters it gives', () => {
    const one = drop([], { count: true }, metric);
    assert.deepEqual(one, [COUNT]);
    const two = drop(one ?? [], { count: false, field: fieldNamed('order_date') }, segment);
    assert.deepEqual(two, [COUNT, ORDER_DATE]);
    assert.deepEqual(drop(two ?? [], { count: false, field: fieldNamed('category.keyword') }, group), [COUNT, ORDER_DATE, CATEGORY]);
    assert.deepEqual(drop([], { count: false, field: fieldNamed('taxful_total_price') }, metric), [
      { enabled: true, id: '1', params: { field: 'taxful_total_price', percents: [50] }, schema: 'metric', type: 'median' },
    ]);
    // a full part takes no more
    assert.equal(drop([COUNT, ORDER_DATE], { count: false, field: fieldNamed('order_date') }, segment), undefined);
  });

  it('replaces the aggregation it is dropped on', () => {
    assert.deepEqual(drop([COUNT, ORDER_DATE], { count: false, field: fieldNamed('category.keyword') }, segment, '2'), [
      COUNT,
      { ...CATEGORY, schema: 'segment' },
    ]);
  });

  it('moves an aggregation within its part, to another part, or after the others of its own', () => {
    const aggs = [COUNT, { ...COUNT, id: '4', type: 'max', params: { field: 'taxful_total_price' } }, ORDER_DATE, CATEGORY];
    // on another of its part: it takes that one's place
    assert.deepEqual(droppedAggs(aggs, { kind: 'agg', id: '4' }, { schema: metric, aggId: '1' }, PATTERN), [aggs[1], aggs[0], ORDER_DATE, CATEGORY]);
    // on another part: made again there with a new id, as OpenSearch Dashboards does
    assert.deepEqual(droppedAggs([COUNT, ORDER_DATE, CATEGORY], { kind: 'agg', id: '3' }, { schema: split }, PATTERN), [
      COUNT,
      ORDER_DATE,
      { ...CATEGORY, id: '4', schema: 'split' },
    ]);
    // on its own part: to the end as it is
    assert.deepEqual(droppedAggs(aggs, { kind: 'agg', id: '1' }, { schema: metric }, PATTERN), [aggs[1], ORDER_DATE, CATEGORY, COUNT]);
    // on itself: nothing
    assert.equal(droppedAggs(aggs, { kind: 'agg', id: '1' }, { schema: metric, aggId: '1' }, PATTERN), undefined);
  });
});

describe('the aggregations of a chart', () => {
  it('are offered as the editor lists them: by title, metrics then parent then sibling pipelines', () => {
    assert.deepEqual(schemaAggTypes(schemaOf('histogram', 'metric')), [
      'avg',
      'count',
      'max',
      'median',
      'min',
      'percentile_ranks',
      'percentiles',
      'std_dev',
      'sum',
      'top_hits',
      'cardinality',
      'cumulative_sum',
      'derivative',
      'moving_avg',
      'serial_diff',
      'avg_bucket',
      'max_bucket',
      'min_bucket',
      'sum_bucket',
    ]);
    assert.deepEqual(schemaAggTypes(schemaOf('histogram', 'segment')), [
      'date_histogram',
      'date_range',
      'histogram',
      'ip_range',
      'range',
      'significant_terms',
      'terms',
    ]);
  });

  it('cannot have a parent pipeline without a histogram as their last bucket', () => {
    const derivative: AggConfig = { enabled: true, id: '5', params: { metricAgg: 'custom' }, schema: 'metric', type: 'derivative' };
    assert.equal(aggregationsProblem([derivative]), 'Add a bucket with "Date Histogram" or "Histogram" aggregation.');
    assert.equal(
      aggregationsProblem([derivative, CATEGORY]),
      'Last bucket aggregation must be "Date Histogram" or "Histogram" when using "Derivative" metric aggregation.'
    );
    assert.equal(aggregationsProblem([derivative, ORDER_DATE]), undefined);
    // which then counts every bucket, empty ones too
    assert.equal(withPipelineBuckets([derivative, ORDER_DATE])[1].params?.min_doc_count, 0);
    assert.deepEqual(withPipelineBuckets([COUNT, ORDER_DATE]), [COUNT, ORDER_DATE]);
  });

  it('keep what fits when the kind changes, as OpenSearch Dashboards keeps it', () => {
    const aggs = [COUNT, ORDER_DATE, CATEGORY];
    const asMetric = persistedAggs(aggs, kind('histogram'), kind('metric'));
    assert.deepEqual(asMetric, [COUNT, { ...ORDER_DATE, schema: 'group' }]);
    const asTable = persistedAggs(asMetric, kind('metric'), kind('table'));
    assert.deepEqual(asTable, [COUNT, { ...ORDER_DATE, schema: 'bucket' }]);
    assert.deepEqual(persistedAggs(asTable, kind('table'), kind('line')), [COUNT, ORDER_DATE]);
    // and the settings of the new kind start over
    const state = withType(withAggsOf(newAppState(PATTERN.id), aggs), 'table', asTable);
    assert.deepEqual(state.style, { perPage: 10, showPartialRows: false, showMetricsAtAllLevels: false });
    assert.equal(state.visualization.activeVisualization?.name, 'table');
  });
});

describe('the details of a field', () => {
  const hits = ['shoes', 'shoes', 'clothing', undefined].map((category, index) => ({
    _index: 'ecommerce',
    _id: String(index),
    _source: category === undefined ? {} : { category },
  }));

  it('lists its most common values in the sample, from the field a keyword belongs to', () => {
    assert.deepEqual(fieldDetails(hits, fieldNamed('category.keyword'), PATTERN), {
      buckets: [
        { value: 'shoes', count: 2, percent: (2 / 3) * 100 },
        { value: 'clothing', count: 1, percent: (1 / 3) * 100 },
      ],
      exists: 3,
      total: 4,
    });
  });

  it('says why it has none', () => {
    assert.equal(
      fieldDetails([], fieldNamed('category.keyword'), PATTERN).error,
      'No documents match the selected query and filters. Try increasing time range or removing filters.'
    );
    assert.equal(fieldDetails(hits, fieldNamed('geoip.location'), PATTERN).error, 'Analysis is not available for geo_point fields.');
    assert.equal(
      fieldDetails(hits, fieldNamed('taxful_total_price'), PATTERN).error,
      'This field is present in your OpenSearch mapping but not in the 4 documents sampled. You may still be able to visualize it.'
    );
  });
});

/* SPDX-License-Identifier: Apache-2.0 */

process.env.TZ = 'UTC';

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  VIS_BUILDER_TYPES,
  defaultsDeep,
  orderedAgg,
  schemaProblem,
  validateState,
  visBuilderEditUrl,
  visBuilderFromSavedObject,
  visBuilderToSavedObject,
  visFromVisBuilder,
  type VisBuilderAttributes,
} from '../../web/apps/vis_builder/model';
import { pointsAlong } from '../../web/vis/types';

const INDEX = '90943e30-9a47-11e8-b64d-95841ca0b247';
const REFERENCES = [{ id: INDEX, name: 'kibanaSavedObjectMeta.searchSourceJSON.index', type: 'index-pattern' }];
const SEARCH_SOURCE = '{"indexRefName":"kibanaSavedObjectMeta.searchSourceJSON.index"}';

const DATE_HISTOGRAM = {
  id: '1',
  enabled: true,
  type: 'date_histogram',
  params: {
    field: '@timestamp',
    useNormalizedOpenSearchInterval: true,
    scaleMetricValues: false,
    interval: 'auto',
    drop_partials: false,
    min_doc_count: 1,
    extended_bounds: {},
  },
  schema: 'segment',
};

/** A saved object as the sample data has them: the kind, its aggregations and its settings */
function object(name: string, aggs: unknown[], style: Record<string, unknown>, extra: Partial<VisBuilderAttributes> = {}) {
  return {
    id: 'vb-1',
    attributes: {
      title: '(VB) Avg bytes over time',
      description: '',
      visualizationState: JSON.stringify({ searchField: '', activeVisualization: { name, aggConfigParams: aggs } }),
      styleState: JSON.stringify(style),
      uiState: '{}',
      version: 3,
      kibanaSavedObjectMeta: { searchSourceJSON: SEARCH_SOURCE },
      ...extra,
    },
    references: REFERENCES,
  };
}

const lineStyle = { addTooltip: true, addLegend: true, legendPosition: 'right', type: 'line' };

describe('a saved VisBuilder visualization', () => {
  it('is read with its index pattern from the references', () => {
    const saved = visBuilderFromSavedObject(
      object('line', [DATE_HISTOGRAM, { id: '2', enabled: true, type: 'avg', params: { field: 'bytes' }, schema: 'metric' }], lineStyle)
    );
    assert.equal(saved.title, '(VB) Avg bytes over time');
    assert.equal(saved.state.visualization.indexPattern, INDEX);
    assert.equal(saved.state.visualization.searchField, '');
    assert.equal(saved.state.visualization.activeVisualization?.name, 'line');
    assert.deepEqual(saved.state.style, lineStyle);
    assert.deepEqual(saved.state.ui, {});
  });

  it('is refused as OpenSearch Dashboards refuses it', () => {
    assert.throws(
      () => visBuilderFromSavedObject(object('line', [], lineStyle, { styleState: '{not json' })),
      /Something went wrong while loading your saved object/
    );
    assert.throws(
      () => visBuilderFromSavedObject(object('line', [], lineStyle, { visualizationState: '{"searchField":"","other":1}' })),
      { message: "/visualizationState Unrecognized key(s) in object: 'other'" }
    );
    assert.throws(
      () => visBuilderFromSavedObject({ ...object('line', [], lineStyle), references: [] }),
      { message: 'The saved object is missing an index pattern' }
    );
  });

  it('is checked for what its state holds', () => {
    assert.equal(validateState({}, { searchField: '' }, {}), undefined);
    assert.equal(validateState([], { searchField: '' }, {}), '/styleState Expected object, received array');
    assert.equal(validateState({}, { searchField: 1 }, {}), '/visualizationState/searchField Required');
    assert.equal(
      validateState({}, { searchField: '', activeVisualization: { name: 'line' } }, {}),
      '/visualizationState/activeVisualization/aggConfigParams Required'
    );
  });

  it('is written with the index pattern as a reference and nothing being edited', () => {
    const saved = visBuilderFromSavedObject(object('metric', [{ id: '1', enabled: true, type: 'count', params: {}, schema: 'metric' }], {}));
    const count = { id: '1', enabled: true, type: 'count', params: {}, schema: 'metric' };
    const draftAgg = { id: '9', enabled: true, type: 'avg', schema: 'metric', params: {} };
    const filter = {
      meta: { alias: null, negate: false, disabled: false, index: 'other-pattern' },
      query: { match_phrase: { 'geo.src': 'CN' } },
      $state: { store: 'appState' as const },
    };
    const written = visBuilderToSavedObject(
      {
        ...saved,
        title: 'zz-agent-copy',
        state: {
          ...saved.state,
          visualization: { ...saved.state.visualization, activeVisualization: { name: 'metric', aggConfigParams: [count], draftAgg } },
        },
      },
      { query: { query: 'bytes > 0', language: 'kuery' }, filters: [filter] }
    );
    // the query and filters of the page go into the search source, the index pattern first in the references
    assert.equal(
      written.attributes.kibanaSavedObjectMeta?.searchSourceJSON,
      '{"query":{"query":"bytes > 0","language":"kuery"},"filter":[{"meta":{"alias":null,"negate":false,"disabled":false,' +
        '"indexRefName":"kibanaSavedObjectMeta.searchSourceJSON.filter[0].meta.index"},"query":{"match_phrase":{"geo.src":"CN"}},' +
        '"$state":{"store":"appState"}}],"indexRefName":"kibanaSavedObjectMeta.searchSourceJSON.index"}'
    );
    assert.deepEqual(written.references, [
      ...REFERENCES,
      { name: 'kibanaSavedObjectMeta.searchSourceJSON.filter[0].meta.index', type: 'index-pattern', id: 'other-pattern' },
    ]);
    assert.equal(written.attributes.version, 3);
    assert.equal(written.attributes.title, 'zz-agent-copy');
    assert.deepEqual(JSON.parse(written.attributes.visualizationState ?? ''), {
      searchField: '',
      activeVisualization: { name: 'metric', aggConfigParams: [{ id: '1', enabled: true, type: 'count', params: {}, schema: 'metric' }] },
    });
    // and read back as it was, with its query and filters
    const again = visBuilderFromSavedObject({ id: 'vb-2', ...written });
    assert.deepEqual(again.state.visualization, saved.state.visualization);
    assert.deepEqual(again.source.query, { query: 'bytes > 0', language: 'kuery' });
    assert.equal(again.source.filters[0].meta.index, 'other-pattern');
    // with nothing on the page, an empty list of filters
    assert.equal(
      visBuilderToSavedObject(saved, { query: { query: '', language: 'kuery' }, filters: [] }).attributes.kibanaSavedObjectMeta
        ?.searchSourceJSON,
      '{"query":{"query":"","language":"kuery"},"filter":[],"indexRefName":"kibanaSavedObjectMeta.searchSourceJSON.index"}'
    );
  });

  it('is written with its keys in the order OpenSearch Dashboards writes them, whatever order the address gave', () => {
    // As the address holds it: every key sorted
    const written = visBuilderToSavedObject(
      {
        title: 'zz-agent-order',
        description: '',
        state: {
          style: { addLegend: true, addTooltip: true, legendPosition: 'right', type: 'histogram' },
          ui: {},
          visualization: {
            activeVisualization: { aggConfigParams: [{ enabled: true, id: '1', params: {}, schema: 'metric', type: 'count' }], name: 'histogram' },
            indexPattern: INDEX,
            searchField: 'order',
          },
        },
      },
      { query: { language: 'kuery', query: 'currency : EUR' }, filters: [] }
    );
    // what OpenSearch Dashboards sent when it saved the same
    assert.equal(
      written.attributes.visualizationState,
      '{"searchField":"order","activeVisualization":{"name":"histogram","aggConfigParams":[{"id":"1","enabled":true,"type":"count","params":{},"schema":"metric"}]}}'
    );
    assert.equal(written.attributes.styleState, '{"addTooltip":true,"addLegend":true,"legendPosition":"right","type":"histogram"}');
    assert.equal(
      written.attributes.kibanaSavedObjectMeta?.searchSourceJSON,
      '{"query":{"query":"currency : EUR","language":"kuery"},"filter":[],"indexRefName":"kibanaSavedObjectMeta.searchSourceJSON.index"}'
    );
  });

  it('is written with the parameters of each aggregation in the order of its type, as OpenSearch Dashboards serializes one', () => {
    // As the address holds the sample's line chart: every key sorted
    const sorted = {
      style: { addLegend: true, addTooltip: false, legendPosition: 'right', type: 'line' },
      ui: {},
      visualization: {
        activeVisualization: {
          aggConfigParams: [
            {
              enabled: true,
              id: '1',
              params: {
                drop_partials: false,
                extended_bounds: {},
                field: '@timestamp',
                interval: 'auto',
                min_doc_count: 1,
                scaleMetricValues: false,
                useNormalizedOpenSearchInterval: true,
              },
              schema: 'segment',
              type: 'date_histogram',
            },
            { enabled: true, id: '2', params: { field: 'bytes' }, schema: 'metric', type: 'avg' },
          ],
          name: 'line',
        },
        indexPattern: INDEX,
        searchField: '',
        savedQuery: 'zz-agent-query',
      },
    };
    const written = visBuilderToSavedObject({ title: 'zz-agent-vb-rt-vis', description: '', state: sorted }, { query: { query: '', language: 'kuery' }, filters: [] });
    // what OpenSearch Dashboards sent for "Save and return" on the same chart; the saved query of the page is not part of it
    assert.equal(
      JSON.stringify({ attributes: written.attributes, references: written.references }),
      '{"attributes":{"title":"zz-agent-vb-rt-vis","description":"","visualizationState":"{\\"searchField\\":\\"\\",\\"activeVisualization\\":{\\"name\\":\\"line\\",' +
        '\\"aggConfigParams\\":[{\\"id\\":\\"1\\",\\"enabled\\":true,\\"type\\":\\"date_histogram\\",\\"params\\":{\\"field\\":\\"@timestamp\\",' +
        '\\"useNormalizedOpenSearchInterval\\":true,\\"scaleMetricValues\\":false,\\"interval\\":\\"auto\\",\\"drop_partials\\":false,\\"min_doc_count\\":1,' +
        '\\"extended_bounds\\":{}},\\"schema\\":\\"segment\\"},{\\"id\\":\\"2\\",\\"enabled\\":true,\\"type\\":\\"avg\\",\\"params\\":{\\"field\\":\\"bytes\\"},' +
        '\\"schema\\":\\"metric\\"}]}}","styleState":"{\\"addTooltip\\":false,\\"addLegend\\":true,\\"legendPosition\\":\\"right\\",\\"type\\":\\"line\\"}",' +
        '"uiState":"{}","version":3,"kibanaSavedObjectMeta":{"searchSourceJSON":"{\\"query\\":{\\"query\\":\\"\\",\\"language\\":\\"kuery\\"},\\"filter\\":[],' +
        '\\"indexRefName\\":\\"kibanaSavedObjectMeta.searchSourceJSON.index\\"}"}},"references":[{"name":"kibanaSavedObjectMeta.searchSourceJSON.index",' +
        '"type":"index-pattern","id":"90943e30-9a47-11e8-b64d-95841ca0b247"}]}'
    );
    // and it opens again as it was, but for the saved query, which is the page's
    const { savedQuery: _savedQuery, ...visualization } = sorted.visualization;
    assert.deepEqual(visBuilderFromSavedObject({ id: 'vb-3', ...written }).state, { ...sorted, visualization });
  });

  it('orders what is inside a parameter as OpenSearch Dashboards writes it', () => {
    // a histogram's bounds, a filter's query, the metric a pipeline is made of
    assert.equal(
      JSON.stringify(
        orderedAgg({
          enabled: true,
          id: '2',
          params: { extended_bounds: { max: 10, min: 0 }, field: 'bytes', has_extended_bounds: true, interval: 5, min_doc_count: false },
          schema: 'segment',
          type: 'histogram',
        })
      ),
      '{"id":"2","enabled":true,"type":"histogram","params":{"field":"bytes","interval":5,"min_doc_count":false,"has_extended_bounds":true,' +
        '"extended_bounds":{"min":0,"max":10}},"schema":"segment"}'
    );
    assert.equal(
      JSON.stringify(
        orderedAgg({
          enabled: true,
          id: '3',
          params: { filters: [{ input: { language: 'kuery', query: 'bytes > 0' }, label: 'some' }] },
          schema: 'group',
          type: 'filters',
        })
      ),
      '{"id":"3","enabled":true,"type":"filters","params":{"filters":[{"input":{"query":"bytes > 0","language":"kuery"},"label":"some"}]},"schema":"group"}'
    );
    assert.equal(
      JSON.stringify(
        orderedAgg({
          enabled: true,
          id: '4',
          params: { customMetric: { enabled: true, id: '4-metric', params: { field: 'bytes' }, schema: 'metric', type: 'sum' }, metricAgg: 'custom' },
          schema: 'metric',
          type: 'cumulative_sum',
        })
      ),
      '{"id":"4","enabled":true,"type":"cumulative_sum","params":{"metricAgg":"custom","customMetric":{"id":"4-metric","enabled":true,"type":"sum",' +
        '"params":{"field":"bytes"},"schema":"metric"}},"schema":"metric"}'
    );
    // a type this build does not know keeps its parameters as they come, and one with none has none
    assert.equal(JSON.stringify(orderedAgg({ id: '5', type: 'zz_unknown', params: { b: 1, a: 2 } })), '{"id":"5","type":"zz_unknown","params":{"b":1,"a":2}}');
    assert.equal(JSON.stringify(orderedAgg({ id: '6', enabled: true, type: 'count', schema: 'metric' })), '{"id":"6","enabled":true,"type":"count","schema":"metric"}');
  });

  it('opens in VisBuilder', () => {
    assert.equal(visBuilderEditUrl('a b'), '/app/vis-builder/edit/a%20b');
  });
});

describe('what a VisBuilder state needs', () => {
  it('is a kind VisBuilder has and the fields its parts require', () => {
    assert.equal(schemaProblem({ searchField: '', activeVisualization: { name: 'pie', aggConfigParams: [] } }), 'Invalid visualization type pie');
    assert.equal(
      schemaProblem({ searchField: '', activeVisualization: { name: 'metric', aggConfigParams: [] } }),
      'The metric visualization needs at least 1 field(s) in the agg type "metric"'
    );
    assert.equal(
      schemaProblem({
        searchField: '',
        activeVisualization: { name: 'metric', aggConfigParams: [{ id: '1', enabled: true, type: 'count', params: {}, schema: 'metric' }] },
      }),
      undefined
    );
  });

  it('offers the kinds in the order VisBuilder registers them', () => {
    assert.deepEqual(
      VIS_BUILDER_TYPES.map((type) => type.title),
      ['Bar', 'Line', 'Area', 'Metric', 'Table']
    );
  });
});

describe('a VisBuilder chart drawn as Visualize draws it', () => {
  const draw = (name: string, aggs: unknown[], style: Record<string, unknown>) =>
    visFromVisBuilder(visBuilderFromSavedObject(object(name, aggs, style)));

  it('has a value axis titled with its metric, on the defaults of a new chart of its kind', () => {
    const vis = draw('line', [DATE_HISTOGRAM, { id: '2', enabled: true, type: 'avg', params: { field: 'bytes' }, schema: 'metric' }], lineStyle);
    assert.equal(vis.type, 'line');
    assert.equal(vis.source.indexId, INDEX);
    const axes = vis.params.valueAxes as Array<Record<string, unknown>>;
    assert.equal(axes.length, 1);
    assert.deepEqual(axes[0], {
      id: 'ValueAxis-1',
      labels: { show: true, rotate: 0, filter: false, truncate: 100 },
      name: 'ValueAxis-1',
      position: 'left',
      scale: { type: 'linear', mode: 'normal' },
      show: true,
      style: {},
      title: { text: 'Average bytes' },
      type: 'value',
    });
    assert.equal((vis.params.categoryAxes as unknown[]).length, 1);
    assert.equal(vis.params.addTimeMarker, false);
  });

  it('draws a metric with no settings of its own as a series of the kind, not stacked', () => {
    const vis = draw(
      'area',
      [{ id: '4', enabled: true, type: 'count', params: {}, schema: 'metric' }, { ...DATE_HISTOGRAM, id: '5' }],
      { ...lineStyle, type: 'area' }
    );
    assert.deepEqual(vis.params.seriesParams, [
      {
        show: true,
        type: 'area',
        mode: 'normal',
        interpolate: 'linear',
        drawLinesBetweenPoints: true,
        showCircles: true,
        lineWidth: 2,
        data: { id: '4', label: 'Count' },
        valueAxis: 'ValueAxis-1',
      },
    ]);
  });

  it('draws the metric with the id of the first series with that series, stacked bars too', () => {
    const vis = draw(
      'histogram',
      [
        { id: '1', enabled: true, type: 'count', params: {}, schema: 'metric' },
        { id: '2', enabled: true, type: 'terms', params: { field: 'geo.dest', order: 'desc', size: 5 }, schema: 'segment' },
      ],
      { ...lineStyle, type: 'histogram' }
    );
    const [series] = vis.params.seriesParams as Array<Record<string, unknown>>;
    assert.equal(series.mode, 'stacked');
    assert.equal(series.type, 'histogram');
    assert.deepEqual(series.data, { label: 'Count', id: '1' });
  });

  it('gives each value of a metric its own axis', () => {
    const vis = draw(
      'line',
      [DATE_HISTOGRAM, { id: '2', enabled: true, type: 'percentiles', params: { field: 'bytes', percents: [50, 95] }, schema: 'metric' }],
      lineStyle
    );
    const axes = vis.params.valueAxes as Array<{ title: { text: string } }>;
    assert.deepEqual(
      axes.map((axis) => axis.title.text),
      ['50th percentile of bytes', '95th percentile of bytes']
    );
  });

  it('splits a table into rows or columns as Visualize says it', () => {
    const vis = draw(
      'table',
      [
        { id: '1', enabled: true, type: 'count', params: {}, schema: 'metric' },
        { id: '2', enabled: true, type: 'terms', params: { field: 'a' }, schema: 'split_row' },
        { id: '3', enabled: true, type: 'terms', params: { field: 'b' }, schema: 'split_column' },
      ],
      { perPage: 20 }
    );
    assert.deepEqual(
      vis.aggs.map((agg) => [agg.schema, agg.params?.row]),
      [
        ['metric', undefined],
        ['split', true],
        ['split', false],
      ]
    );
    assert.deepEqual(vis.params, { perPage: 20, showPartialRows: false, showMetricsAtAllLevels: false });
  });

  it('keeps the settings of a metric, filled in where it lacks one', () => {
    const vis = draw('metric', [{ id: '1', enabled: true, type: 'cardinality', params: { field: 'clientip' }, schema: 'metric' }], {
      metric: { style: { fontSize: 40 } },
    });
    const metric = vis.params.metric as { style: { fontSize: number; bgFill: string }; colorSchema: string };
    assert.equal(metric.style.fontSize, 40);
    assert.equal(metric.style.bgFill, '#000');
    assert.equal(metric.colorSchema, 'Green to Red');
  });
});

describe('filling in settings', () => {
  it('keeps what is there, fills what is missing and goes through arrays place by place', () => {
    const defaults = { a: 1, b: { c: 2, d: 3 }, list: [{ x: 1, y: 2 }, { x: 3 }] };
    const out = defaultsDeep({ b: { c: 5 }, list: [{ x: 9 }] }, defaults);
    assert.deepEqual(out, { a: 1, b: { c: 5, d: 3 }, list: [{ x: 9, y: 2 }, { x: 3 }] });
    out.list[1].x = 7;
    assert.equal(defaults.list[1].x, 3, 'the defaults are copied, not shared');
    assert.equal(defaultsDeep('kept', { a: 1 }), 'kept');
  });
});

describe('the points of a series along the axis', () => {
  const points = [
    { x: 3, y: 30 },
    { x: 1, y: 10 },
  ];

  it('count a missing bucket as zero when stacked', () => {
    assert.deepEqual(pointsAlong(points, [1, 2, 3], true), [
      { x: 1, y: 10 },
      { x: 2, y: 0 },
      { x: 3, y: 30 },
    ]);
  });

  it('keep only the places a series has when it is not stacked', () => {
    assert.deepEqual(pointsAlong(points, [1, 2, 3], false), [
      { x: 1, y: 10 },
      { x: 3, y: 30 },
    ]);
  });
});

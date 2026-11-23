/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The frame of the Visualize editor as OpenSearch Dashboards 3.9.0 has it: the state it writes to
 * the address as soon as a visualization has loaded, its top navigation, when leaving it asks, and
 * what it and a dashboard hand each other. The texts of `_a` are those the original wrote.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  editorStateDefaults,
  initialAppState,
  migrateAppState,
  paramsWithDefaults,
  unlinkSavedSearch,
  type VisualizeAppState,
} from '../../web/apps/visualize/app_state';
import { newVis } from '../../web/apps/visualize/defaults';
import { editorHeading } from '../../web/apps/visualize/editor_layout';
import { INDEX_PATTERNS_LINK, SavedObjectNotFound, found, loadFailure } from '../../web/apps/visualize/load_failure';
import {
  editorStateFor,
  incomingEditorState,
  isEmbeddableEditorState,
  visualizationPackage,
} from '../../web/apps/visualize/state_transfer';
import { LEAVE_TEXT, LEAVE_TITLE, confirmsLeave, returnSwitch, visualizeTopNav } from '../../web/apps/visualize/top_nav';
import { withBaseMap } from '../../web/apps/visualize/type_setup';
import type { Filter } from '../../web/lib/types';
import { encodeState } from '../../web/lib/url';
import { visFromSavedObject } from '../../web/lib/vis';
import { HttpFetchError } from '../../web/services/http';

const KUERY = { query: '', language: 'kuery' };

// "(Pie) Visitors by OS" of the sample web logs, as the original saved it
const SAMPLE_PIE = visFromSavedObject({
  id: '7fd12620-2a44-11ee-92de-ad1b6a4928e5',
  attributes: {
    title: '(Pie) Visitors by OS',
    description: '',
    uiStateJSON: '{}',
    version: 1,
    visState: JSON.stringify({
      title: '(Pie) Visitors by OS',
      type: 'pie',
      aggs: [
        { id: '1', enabled: true, type: 'cardinality', params: { field: 'clientip' }, schema: 'metric' },
        {
          id: '2',
          enabled: true,
          type: 'terms',
          params: {
            field: 'machine.os.keyword',
            orderBy: '1',
            order: 'desc',
            size: 5,
            otherBucket: false,
            otherBucketLabel: 'Other',
            missingBucket: false,
            missingBucketLabel: 'Missing',
          },
          schema: 'segment',
        },
      ],
      params: { type: 'pie', addTooltip: true, addLegend: true, legendPosition: 'right', isDonut: true, labels: { show: false, values: true, last_level: true, truncate: 100 } },
    }),
    kibanaSavedObjectMeta: {
      searchSourceJSON: '{"index":"90943e30-9a47-11e8-b64d-95841ca0b247","query":{"query":"","language":"kuery"},"filter":[]}',
    },
  },
  references: [],
});

const filter = (key: string, value: string): Filter => ({
  meta: { alias: null, negate: false, disabled: false, key, params: { query: value }, type: 'phrase' },
  query: { match_phrase: { [key]: value } },
  $state: { store: 'appState' },
});

describe('the state the editor writes to the address once a visualization has loaded', () => {
  it('is, for a new pie, what the original writes', () => {
    const state = initialAppState(editorStateDefaults(newVis('pie', { indexPatternId: 'logs' }), undefined, KUERY), {});
    assert.equal(
      encodeState(state),
      "(filters:!(),linked:!f,query:(language:kuery,query:''),uiState:(),vis:(aggs:!((enabled:!t,id:'1',params:(),schema:metric,type:count))," +
        'params:(addLegend:!t,addTooltip:!t,isDonut:!t,labels:(last_level:!t,show:!f,truncate:100,values:!t),legendPosition:right,type:pie),' +
        "title:'',type:pie))"
    );
  });

  it('is, for a saved pie, its own state with its title', () => {
    const state = initialAppState(editorStateDefaults(SAMPLE_PIE, undefined, KUERY), {});
    assert.equal(
      encodeState(state),
      "(filters:!(),linked:!f,query:(language:kuery,query:''),uiState:(),vis:(aggs:!((enabled:!t,id:'1',params:(field:clientip),schema:metric,type:cardinality)," +
        "(enabled:!t,id:'2',params:(field:machine.os.keyword,missingBucket:!f,missingBucketLabel:Missing,order:desc,orderBy:'1',otherBucket:!f,otherBucketLabel:Other,size:5),schema:segment,type:terms))," +
        'params:(addLegend:!t,addTooltip:!t,isDonut:!t,labels:(last_level:!t,show:!f,truncate:100,values:!t),legendPosition:right,type:pie),' +
        "title:'(Pie) Visitors by OS',type:pie))"
    );
  });

  it("takes the visualization's own query, filters and ui state, and says whether it is linked", () => {
    const vis = {
      ...newVis('pie', { savedSearchId: 'search-1' }),
      uiState: { vis: { legendOpen: false } },
      source: { query: { query: 'bytes > 0', language: 'lucene' }, filters: [filter('geo.src', 'CN')] },
    };
    const state = editorStateDefaults(vis, undefined, KUERY);
    assert.deepEqual(state.query, { query: 'bytes > 0', language: 'lucene' });
    assert.deepEqual(state.filters, [filter('geo.src', 'CN')]);
    assert.deepEqual(state.uiState, { vis: { legendOpen: false } });
    assert.equal(state.linked, true);
    assert.equal(editorStateDefaults(newVis('pie', { indexPatternId: 'logs' }), undefined, { query: '', language: 'lucene' }).query.language, 'lucene');
  });

  it('keeps what the address said, key by key, over what was loaded', () => {
    const defaults = editorStateDefaults(SAMPLE_PIE, undefined, KUERY);
    const fromUrl: Partial<VisualizeAppState> = { query: { query: 'bytes > 0', language: 'kuery' }, uiState: { vis: { legendOpen: false } } };
    const state = initialAppState(defaults, fromUrl);
    assert.deepEqual(state.query, fromUrl.query);
    assert.deepEqual(state.uiState, fromUrl.uiState);
    assert.deepEqual(state.vis, defaults.vis);
    assert.equal(state.linked, false);
    const vis = { ...defaults.vis, params: { ...defaults.vis.params, isDonut: false } };
    assert.deepEqual(initialAppState(defaults, { vis }).vis, vis);
    // A visualization of another kind in the address is not this one's
    assert.deepEqual(initialAppState(defaults, { vis: { ...vis, type: 'line' } }).vis, defaults.vis);
  });

  it("merges a kind's settings over its defaults one key deep, the settings first", () => {
    const params = paramsWithDefaults('pie', { isDonut: false, labels: { show: true } });
    assert.deepEqual(Object.keys(params).slice(0, 2), ['isDonut', 'labels']);
    assert.equal(params.isDonut, false);
    assert.deepEqual(params.labels, { show: true });
    assert.equal(params.addLegend, true);
    assert.equal(params.type, 'pie');
  });

  it('turns the split tables of an old address into buckets, as the original migrates it', () => {
    const state = editorStateDefaults(newVis('table', { indexPatternId: 'logs' }), undefined, KUERY);
    const split = (id: string) => ({ id, enabled: true, type: 'terms', schema: 'split', params: { field: 'geo.src', row: true } });
    const migrated = migrateAppState({ ...state, vis: { ...state.vis, aggs: [...state.vis.aggs, split('2'), split('3')] } });
    assert.deepEqual(
      migrated.vis.aggs.map((agg) => [agg.id, agg.schema, agg.params]),
      [
        ['1', 'metric', {}],
        ['2', 'split', { field: 'geo.src', row: true }],
        ['3', 'bucket', { field: 'geo.src' }],
      ]
    );
  });

  it('takes the query of the saved search and adds its filters when unlinked from it', () => {
    const own = filter('geo.src', 'CN');
    const parentFilter = filter('machine.os', 'osx');
    const unlinked = unlinkSavedSearch({ query: KUERY, filters: [own] }, { query: { query: 'response:200', language: 'kuery' }, filters: [parentFilter] });
    assert.deepEqual(unlinked, { query: { query: 'response:200', language: 'kuery' }, filters: [own, parentFilter], linked: false });
    assert.deepEqual(unlinkSavedSearch({ query: KUERY, filters: [own, own] }, {}), { query: KUERY, filters: [own], linked: false });
  });
});

describe('the top navigation of the editor', () => {
  const ids = (state: Parameters<typeof visualizeTopNav>[0]) => visualizeTopNav(state).map((item) => item.label);

  it('has Inspect, Share and Save for a visualization opened in Visualize', () => {
    const items = visualizeTopNav({ hasUnsavedChanges: false, hasUnappliedChanges: false, savedId: 'v1', hasInspector: true });
    assert.deepEqual(
      items.map((item) => [item.testId, item.label, item.emphasize, item.icon ?? null, item.disabled, item.tooltip ?? null]),
      [
        ['openInspectorButton', 'Inspect', false, null, false, null],
        ['shareTopNavButton', 'Share', false, null, false, null],
        ['visualizeSaveButton', 'Save', true, 'save', false, null],
      ]
    );
  });

  it('has Cancel, "Save as" and "Save and return" for a saved one a dashboard opened', () => {
    const items = visualizeTopNav({ hasUnsavedChanges: false, hasUnappliedChanges: false, savedId: 'v1', originatingApp: 'dashboards', hasInspector: true });
    assert.deepEqual(
      items.map((item) => [item.testId, item.label, item.emphasize, item.icon ?? null]),
      [
        ['openInspectorButton', 'Inspect', false, null],
        ['shareTopNavButton', 'Share', false, null],
        ['visualizeCancelAndReturnButton', 'Cancel', false, null],
        ['visualizeSaveButton', 'Save as', false, null],
        ['visualizesaveAndReturnButton', 'Save and return', true, 'checkInCircleFilled'],
      ]
    );
    // A new one has no "Save and return": "Save" offers to add it to the dashboard
    assert.deepEqual(ids({ hasUnsavedChanges: true, hasUnappliedChanges: false, originatingApp: 'dashboards', hasInspector: true }), ['Inspect', 'Share', 'Cancel', 'Save']);
  });

  it('greys out saving while changes are not applied, and says why', () => {
    const items = visualizeTopNav({ hasUnsavedChanges: true, hasUnappliedChanges: true, savedId: 'v1', originatingApp: 'dashboards', hasInspector: true });
    assert.deepEqual(
      items.map((item) => [item.label, item.disabled, item.tooltip ?? null]),
      [
        ['Inspect', false, null],
        ['Share', false, null],
        ['Cancel', false, 'Discard your changes before finishing'],
        ['Save as', true, 'Apply or Discard your changes before saving'],
        ['Save and return', true, 'Apply or Discard your changes before finishing'],
      ]
    );
    const unsaved = visualizeTopNav({ hasUnsavedChanges: true, hasUnappliedChanges: false, savedId: 'v1', originatingApp: 'dashboards', hasInspector: false });
    assert.deepEqual(
      unsaved.map((item) => [item.label, item.disabled, item.tooltip ?? null]),
      [
        ['Inspect', true, "This visualization doesn't support any inspectors."],
        ['Share', false, null],
        ['Cancel', false, 'Discard your changes before finishing'],
        ['Save as', false, null],
        ['Save and return', false, null],
      ]
    );
  });

  it('offers to go back to a dashboard after saving, adding a new one and returning to one saved in place', () => {
    assert.deepEqual(returnSwitch('dashboards', undefined, true), { shown: true, label: 'Add to Dashboards after saving' });
    assert.deepEqual(returnSwitch('dashboards', 'v1', false), { shown: true, label: 'Return to Dashboards after saving' });
    assert.deepEqual(returnSwitch('dashboards', 'v1', true), { shown: true, label: 'Add to Dashboards after saving' });
    // Only a dashboard takes a copy back
    assert.equal(returnSwitch('canvas', 'v1', true).shown, false);
    assert.deepEqual(returnSwitch('canvas', 'v1', false), { shown: true, label: 'Return to canvas after saving' });
    assert.equal(returnSwitch(undefined, 'v1', false).shown, false);
  });

  it('names the application that opened a new one in the heading a screen reader reads', () => {
    assert.equal(editorHeading('', 'Pie', false, 'dashboards'), 'Visualization of type Pie embedded into dashboards app');
    assert.equal(editorHeading('', 'Pie', false, 'canvas'), 'Visualization of type Pie embedded into canvas app');
    assert.equal(editorHeading('Sales', 'Pie', true, 'dashboards'), 'Sales Pie visualization');
  });
});

describe('leaving the editor', () => {
  it('asks only when a dashboard opened it and something is not applied or not saved', () => {
    assert.equal(confirmsLeave({ originatingApp: 'dashboards', hasUnappliedChanges: false, hasUnsavedChanges: true }), true);
    assert.equal(confirmsLeave({ originatingApp: 'dashboards', hasUnappliedChanges: true, hasUnsavedChanges: false }), true);
    assert.equal(confirmsLeave({ originatingApp: 'canvas', hasUnappliedChanges: true, hasUnsavedChanges: false }), true);
    assert.equal(confirmsLeave({ originatingApp: 'dashboards', hasUnappliedChanges: false, hasUnsavedChanges: false }), false);
    assert.equal(confirmsLeave({ originatingApp: undefined, hasUnappliedChanges: true, hasUnsavedChanges: true }), false);
    assert.equal(confirmsLeave({ originatingApp: 'discover', hasUnappliedChanges: true, hasUnsavedChanges: true }), false);
  });

  it("asks in the original's words", () => {
    assert.equal(LEAVE_TITLE, 'Unsaved changes');
    assert.equal(LEAVE_TEXT, 'Leave Visualize editor with unsaved changes?');
  });
});

describe('what a coordinate map is given as the editor loads it', () => {
  const roadMap = { origin: 'elastic_maps_service', id: 'road_map', minZoom: 0, maxZoom: 10 };
  const darkMap = { origin: 'elastic_maps_service', id: 'dark_map', minZoom: 0, maxZoom: 10 };

  it('is the first base map of the maps service, when it has chosen none', () => {
    const params = { mapType: 'Scaled Circle Markers', wms: { enabled: false, options: { format: 'image/png' } } };
    assert.deepEqual(withBaseMap(params, [roadMap, darkMap]), {
      mapType: 'Scaled Circle Markers',
      wms: { enabled: false, options: { format: 'image/png' }, selectedTmsLayer: roadMap },
    });
    // what was loaded is not written to
    assert.deepEqual(params.wms, { enabled: false, options: { format: 'image/png' } });
  });

  it('keeps the base map it has chosen', () => {
    const params = { wms: { enabled: false, selectedTmsLayer: darkMap } };
    assert.equal(withBaseMap(params, [roadMap, darkMap]), params);
  });

  it('is left as it is when the maps service has no base map, or it has no map settings', () => {
    const params = { wms: { enabled: false } };
    assert.equal(withBaseMap(params, []), params);
    const none = { mapType: 'Heatmap' };
    assert.equal(withBaseMap(none, [roadMap]), none);
  });
});

describe('what the editor and a dashboard hand each other', () => {
  const container = { containerId: 'd1', containerName: '[Logs] Web Traffic' };

  it("opens the editor with the dashboard's name and container, or with nothing from Visualize", () => {
    assert.deepEqual(editorStateFor('dashboards', container), { originatingApp: 'dashboards', containerInfo: container });
    assert.deepEqual(editorStateFor('dashboards'), { originatingApp: 'dashboards' });
    assert.equal(editorStateFor(undefined, container), undefined);
    assert.equal(isEmbeddableEditorState({ originatingApp: 'dashboards', embeddableId: '17' }), true);
    assert.equal(isEmbeddableEditorState({ type: 'visualization', input: { savedObjectId: 'v1' } }), false);
    assert.equal(isEmbeddableEditorState(null), false);
  });

  it('reads what came with the entry of the history', () => {
    const globals = globalThis as { window?: unknown };
    try {
      globals.window = { history: { state: { originatingApp: 'dashboards', embeddableId: '17', containerInfo: container } } };
      assert.deepEqual(incomingEditorState(), { originatingApp: 'dashboards', embeddableId: '17', containerInfo: container });
      globals.window = { history: { state: { type: 'visualization', input: { savedObjectId: 'v1' } } } };
      assert.equal(incomingEditorState(), undefined);
      globals.window = { history: { state: null } };
      assert.equal(incomingEditorState(), undefined);
    } finally {
      delete globals.window;
    }
  });

  it('sends a new visualization back as a panel to add, with the container it came from', () => {
    assert.deepEqual(visualizationPackage('v2', container), { type: 'visualization', input: { savedObjectId: 'v2' }, containerInfo: container });
    assert.deepEqual(visualizationPackage('v2'), { type: 'visualization', input: { savedObjectId: 'v2' } });
  });
});

describe('what the editor does with what cannot be loaded', () => {
  const G = '(filters:!(),refreshInterval:(pause:!t,value:0),time:(from:now-7d,to:now))';
  // The address as the browser keeps it once it is gone to, as the reference's was read
  const asKept = (to: string) => {
    const url = new URL(to, 'http://localhost');
    return `${url.pathname}${url.search}${url.hash}`;
  };

  it('says a missing visualization is missing, and the landing page takes its place', () => {
    const failure = loadFailure(new SavedObjectNotFound('visualization', 'frame-no-such-vis'), 'frame-no-such-vis', G);
    assert.equal(failure.title, 'Saved object is missing');
    assert.equal(failure.text, 'Could not locate that visualization (id: frame-no-such-vis)');
    assert.equal(failure.replace, true);
    assert.equal(
      asKept(failure.to),
      `/app/visualize#/?notFound=visualization&notFoundMessage=Could%20not%20locate%20that%20visualization%20(id:%20frame-no-such-vis)&_g=${G}`
    );
  });

  it("sends a missing saved search or index pattern to the visualization's page among the saved objects", () => {
    const search = loadFailure(new SavedObjectNotFound('search', 'frame-gone-search'), 'frame-fail-nosearch', G);
    assert.deepEqual([search.title, search.text, search.replace], ['Saved object is missing', 'Could not locate that search (id: frame-gone-search)', false]);
    assert.equal(
      asKept(search.to),
      '/app/management/opensearch-dashboards/objects/savedVisualizations/frame-fail-nosearch?notFound=search&notFoundMessage=Could%20not%20locate%20that%20search%20(id:%20frame-gone-search)'
    );
    // A new one has no id: the original writes `undefined`
    const pattern = loadFailure(new SavedObjectNotFound('index-pattern', 'frame-gone-pattern', INDEX_PATTERNS_LINK), undefined, G);
    assert.equal(pattern.text, 'Could not locate that index-pattern (id: frame-gone-pattern), [click here to re-create it](management/opensearch-dashboards/indexPatterns)');
    assert.equal(
      asKept(pattern.to),
      '/app/management/opensearch-dashboards/objects/savedVisualizations/undefined?notFound=index-pattern&notFoundMessage=Could%20not%20locate%20that%20index-pattern%20(id:%20frame-gone-pattern),%20[click%20here%20to%20re-create%20it](management/opensearch-dashboards/indexPatterns)'
    );
  });

  it('says any other failure as a failed load, and the landing page takes its place', () => {
    const failure = loadFailure(new Error('Invalid visualization type "frame_no_such_kind"'), 'frame-fail-badtype', G);
    assert.deepEqual(failure, {
      title: 'Failed to load the visualization',
      text: 'Invalid visualization type "frame_no_such_kind"',
      to: `/app/visualize#/?_g=${G}`,
      replace: true,
    });
    assert.equal(loadFailure(new Error('You must provide a valid visualization type'), undefined, undefined).to, '/app/visualize');
  });

  it('tells a saved object the server does not have as missing, and any other failure as it is', async () => {
    const failureOf = async (fetch: () => Promise<unknown>) => {
      try {
        await found('search', 's1', fetch);
      } catch (error) {
        return error;
      }
      return undefined;
    };
    const missing = await failureOf(() => Promise.reject(new HttpFetchError(404, 'Not Found')));
    assert.ok(missing instanceof SavedObjectNotFound);
    assert.equal(missing instanceof SavedObjectNotFound && missing.savedObjectType, 'search');
    assert.equal(missing instanceof Error && missing.message, 'Could not locate that search (id: s1)');
    const refused = new HttpFetchError(500, 'Internal Server Error');
    assert.equal(await failureOf(() => Promise.reject(refused)), refused);
    assert.equal(await found('search', 's1', () => Promise.resolve('loaded')), 'loaded');
  });
});

/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cloneBase, cloneTitle, fullAppState, ownTime, sameQuery, type UrlAppState } from '../../web/apps/dashboard/app_state';
import {
  MIN_PANEL,
  cellUnder,
  compact,
  createNewState,
  dashboardFromSavedObject,
  dashboardToSavedObject,
  editorStateFor,
  emptyDashboard,
  existingFilter,
  findPlace,
  finderName,
  handedPanel,
  moveItem,
  newPanelIndex,
  offersInspector,
  orderAsOriginal,
  panelsDiffer,
  panelsFromUrl,
  panelsToUrl,
  placeBeside,
  readingOrder,
  resizeItem,
  samePanels,
  settleLayout,
  sizedCells,
  sizingStep,
  startSizing,
  takenAgain,
  timeAsSaved,
  withHandedPanel,
  type Dashboard,
  type GridItem,
  type PanelState,
} from '../../web/apps/dashboard/model';
import { existsFilter, phraseFilter, uniqueFilters } from '../../web/lib/query';
import type { Filter, Query } from '../../web/lib/types';
import { decodeState, encodeState } from '../../web/lib/url';
import { editorStateFor as newVisEditorState, originatingAppUrl } from '../../web/apps/visualize/state_transfer';
import { makeTurns, waitTurn } from '../../web/vis/turns';

const at = (items: GridItem[], id: string) => {
  const item = items.find((candidate) => candidate.i === id);
  return item ? [item.x, item.y, item.w, item.h] : undefined;
};

describe('the grid of a dashboard', () => {
  it('lets panels rise as far as those above allow', () => {
    const layout = compact([
      { i: 'a', x: 0, y: 5, w: 24, h: 10 },
      { i: 'b', x: 0, y: 40, w: 24, h: 10 },
      { i: 'c', x: 24, y: 3, w: 24, h: 6 },
    ]);
    assert.deepEqual(at(layout, 'a'), [0, 0, 24, 10]);
    assert.deepEqual(at(layout, 'b'), [0, 10, 24, 10]);
    assert.deepEqual(at(layout, 'c'), [24, 0, 24, 6]);
    // The panels come back in the order they were given, their keys in the original's order
    assert.deepEqual(
      layout.map((item) => item.i),
      ['a', 'b', 'c']
    );
    assert.deepEqual(Object.keys(layout[0]), ['x', 'y', 'w', 'h', 'i']);
  });

  it('keeps a panel inside its 48 columns when it takes a layout', () => {
    assert.deepEqual(at(settleLayout([{ i: 'a', x: 40, y: 0, w: 24, h: 10 }]), 'a'), [24, 0, 24, 10]);
    assert.deepEqual(at(settleLayout([{ i: 'a', x: -2, y: 0, w: 10, h: 10 }]), 'a'), [0, 0, 48, 10]);
  });

  it('moves down the panels an overlapping one covers, those under them first', () => {
    const layout = compact([
      { i: 'a', x: 0, y: 0, w: 24, h: 10 },
      { i: 'b', x: 0, y: 5, w: 24, h: 10 },
      { i: 'c', x: 0, y: 15, w: 24, h: 4 },
    ]);
    assert.deepEqual(at(layout, 'b'), [0, 10, 24, 10]);
    assert.deepEqual(at(layout, 'c'), [0, 20, 24, 4]);
  });

  it('moves the others out of the way of a panel that is dropped on them', () => {
    const start: GridItem[] = [
      { i: 'a', x: 0, y: 0, w: 24, h: 10 },
      { i: 'b', x: 24, y: 0, w: 24, h: 10 },
    ];
    const layout = moveItem(start, 'b', 0, 0);
    assert.deepEqual(at(layout, 'b'), [0, 0, 24, 10]);
    assert.deepEqual(at(layout, 'a'), [0, 10, 24, 10]);
    // What it was given is left as it was
    assert.deepEqual(at(start, 'b'), [24, 0, 24, 10]);
  });

  it('lets a panel dragged up to the top take the place there; a row short, it does not', () => {
    const start: GridItem[] = [
      { i: 'a', x: 0, y: 0, w: 48, h: 4 },
      { i: 'b', x: 0, y: 4, w: 48, h: 4 },
    ];
    const swapped = moveItem(start, 'b', 0, 0);
    assert.deepEqual(at(swapped, 'b'), [0, 0, 48, 4]);
    assert.deepEqual(at(swapped, 'a'), [0, 4, 48, 4]);
    // The one in the way goes down a row, level with it, and is packed first: as in the original
    const kept = moveItem(start, 'b', 0, 1);
    assert.deepEqual(at(kept, 'a'), [0, 0, 48, 4]);
    assert.deepEqual(at(kept, 'b'), [0, 4, 48, 4]);
  });

  it('moves panels as the original moved them when [Logs] was dragged', () => {
    // [Logs] Web Traffic, its panels in reading order; its fourth panel taken by its title and
    // drawn 420 pixels down in ten moves, over rows 2, 3, 5, 6, 8, 9, 11, 12, 14 and 15
    const logs: GridItem[] = [
      { i: '18', x: 0, y: 0, w: 10, h: 11 },
      { i: '11', x: 10, y: 0, w: 9, h: 11 },
      { i: '16', x: 19, y: 0, w: 15, h: 11 },
      { i: '17', x: 34, y: 0, w: 14, h: 11 },
      { i: '15', x: 0, y: 11, w: 27, h: 13 },
      { i: '2', x: 27, y: 11, w: 21, h: 13 },
      { i: '13', x: 0, y: 24, w: 27, h: 12 },
      { i: '9', x: 27, y: 24, w: 21, h: 12 },
      { i: '7', x: 0, y: 36, w: 24, h: 13 },
      { i: '14', x: 24, y: 36, w: 24, h: 31 },
      { i: '4', x: 0, y: 49, w: 24, h: 18 },
    ];
    let state = logs;
    for (let step = 1; step <= 10; step += 1) {
      const cell = cellUnder(logs[3], 0, 42 * step, 21.25, 8);
      state = moveItem(state, '17', cell.x, cell.y);
    }
    const dropped = moveItem(state, '17', 34, 15);
    const moved = dropped.filter((item) => {
      const was = logs.find((other) => other.i === item.i);
      return !was || was.y !== item.y || was.x !== item.x;
    });
    assert.deepEqual(
      moved.map((item) => [item.i, item.y]),
      [
        ['17', 24],
        ['9', 35],
        ['14', 47],
      ]
    );
  });

  it('works out the cell under a panel being moved as the original does', () => {
    const origin: GridItem = { i: 'a', x: 34, y: 0, w: 14, h: 11 };
    assert.deepEqual(cellUnder(origin, 0, 42, 21.25, 8), { x: 34, y: 2 });
    assert.deepEqual(cellUnder(origin, 0, 84, 21.25, 8), { x: 34, y: 3 });
    // Never out of the columns, nor above the first row
    assert.deepEqual(cellUnder(origin, 400, -300, 21.25, 8), { x: 34, y: 0 });
    assert.deepEqual(cellUnder(origin, -2000, 0, 21.25, 8), { x: 0, y: 0 });
  });

  it('sizes a panel by its corner, never under one cell, and packs the others', () => {
    const origin: GridItem = { i: 'a', x: 0, y: 0, w: 24, h: 10 };
    let sizing = startSizing(origin, 21.25, 8);
    assert.deepEqual([sizing.width, sizing.height], [694, 272]);
    sizing = sizingStep(sizing, -2000, -2000, origin, 21.25, 8);
    assert.deepEqual([sizing.width, sizing.height], [21, 20]);
    assert.deepEqual(sizedCells(sizing, origin, 21.25, 8), { w: 1, h: 1 });
    // What the pointer went past the smallest size is taken back before the panel grows again
    sizing = sizingStep(sizing, 1000, 1000, origin, 21.25, 8);
    assert.deepEqual([sizing.width, sizing.height], [21, 20]);
    const layout = resizeItem(
      [origin, { i: 'b', x: 0, y: 10, w: 24, h: 5 }],
      'a',
      MIN_PANEL.w,
      MIN_PANEL.h
    );
    assert.deepEqual(at(layout, 'b'), [0, 1, 24, 5]);
  });

  it('keeps the width a panel had when the corner goes past the right edge', () => {
    const origin: GridItem = { i: 'a', x: 40, y: 0, w: 4, h: 4 };
    const sizing = startSizing(origin, 21.25, 8);
    const wider = sizingStep(sizing, 60, 0, origin, 21.25, 8);
    assert.equal(wider.width, sizing.width + 60);
    const past = sizingStep(wider, 400, 0, origin, 21.25, 8);
    assert.equal(past.width, wider.width);
    assert.deepEqual(sizedCells(past, origin, 21.25, 8), { w: 6, h: 4 });
  });

  it('finds a new panel the first free place, reading like a page', () => {
    assert.deepEqual(findPlace([]), { x: 0, y: 0 });
    assert.deepEqual(findPlace([{ i: 'a', x: 0, y: 0, w: 24, h: 15 }]), { x: 24, y: 0 });
    assert.deepEqual(
      findPlace([
        { i: 'a', x: 0, y: 0, w: 24, h: 15 },
        { i: 'b', x: 24, y: 0, w: 24, h: 10 },
      ]),
      { x: 24, y: 10 }
    );
    assert.deepEqual(
      findPlace([
        { i: 'a', x: 0, y: 0, w: 24, h: 15 },
        { i: 'b', x: 24, y: 0, w: 24, h: 15 },
      ]),
      { x: 0, y: 15 }
    );
  });

  it('looks only at the last row a new panel would take, as the original does', () => {
    // A small panel in the free space does not keep the new one out: the grid moves it down
    assert.deepEqual(
      findPlace([
        { i: 'a', x: 0, y: 0, w: 24, h: 15 },
        { i: 'b', x: 24, y: 0, w: 24, h: 5 },
        { i: 'c', x: 24, y: 7, w: 10, h: 2 },
      ]),
      { x: 24, y: 5 }
    );
  });

  it('gives a new panel a random UUID', () => {
    const first = newPanelIndex();
    assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.notEqual(newPanelIndex(), first);
  });
});

describe('the copy of a panel', () => {
  const a: GridItem = { x: 0, y: 0, w: 24, h: 15, i: 'a' };
  const b: GridItem = { x: 24, y: 0, w: 24, h: 15, i: 'b' };

  it('goes to the right of the panel when there is room', () => {
    assert.deepEqual(placeBeside([a], 'a'), { place: { x: 24, y: 0 }, moved: [a] });
  });

  it('goes to the start of the next row when the right is taken', () => {
    assert.deepEqual(placeBeside([a, b], 'a').place, { x: 0, y: 15 });
    assert.deepEqual(placeBeside([a, b], 'b').place, { x: 0, y: 15 });
  });

  it('goes under the panel and moves those after it down when nothing is free', () => {
    const c: GridItem = { x: 0, y: 15, w: 48, h: 10, i: 'c' };
    const { place, moved } = placeBeside([a, b, c], 'a');
    assert.deepEqual(place, { x: 0, y: 15 });
    // As the original: every panel after it in the grid's order, the one beside it too
    assert.deepEqual(
      moved.map((item) => [item.i, item.y]),
      [
        ['a', 0],
        ['b', 30],
        ['c', 45],
      ]
    );
  });

  it('is titled as a copy, numbered by the copies there are', () => {
    assert.equal(cloneBase('Visitors (copy 2)'), 'Visitors');
    assert.equal(cloneBase('Visitors (copy)'), 'Visitors');
    assert.equal(cloneTitle('Visitors', 1), 'Visitors (copy)');
    assert.equal(cloneTitle('Visitors (copy)', 2), 'Visitors (copy 1)');
    assert.equal(cloneTitle('Visitors', 4), 'Visitors (copy 3)');
  });
});

const panel = (panelIndex: string, x: number, y: number, extra: Partial<PanelState> = {}): PanelState => ({
  panelIndex,
  gridData: { x, y, w: 24, h: 15, i: panelIndex },
  type: 'visualization',
  id: `vis-${panelIndex}`,
  embeddableConfig: {},
  ...extra,
});

describe('a dashboard as it is saved', () => {
  const dashboard: Dashboard = {
    ...emptyDashboard(),
    id: 'mine',
    title: 'Mine',
    description: 'About it',
    panels: [
      panel('1', 0, 0, { embeddableConfig: { vis: { legendOpen: false } } }),
      panel('2', 24, 0, { type: 'search', id: 'search-1', title: 'Its own title' }),
      panel('3', 0, 15, { title: '' }),
    ],
    query: { query: 'status:200', language: 'kuery' },
    timeRestore: true,
    timeFrom: 'now-7d',
    timeTo: '2024-01-01T01:00:00+01:00',
    refreshInterval: { pause: true, value: 0 },
    hits: 0,
    attributesVersion: 1,
  };

  it('writes the attributes in the order the original writes them', () => {
    const { attributes } = dashboardToSavedObject(dashboard);
    assert.deepEqual(Object.keys(attributes), [
      'title',
      'hits',
      'description',
      'panelsJSON',
      'optionsJSON',
      'version',
      'timeRestore',
      'timeTo',
      'timeFrom',
      'refreshInterval',
      'kibanaSavedObjectMeta',
    ]);
    assert.equal(attributes.optionsJSON, '{"useMargins":true,"hidePanelTitles":false,"useSharedCrosshair":false}');
    assert.equal(attributes.timeFrom, 'now-7d');
    assert.equal(attributes.timeTo, '2024-01-01T00:00:00.000Z');
    assert.deepEqual(attributes.refreshInterval, { pause: true, value: 0 });
    assert.equal(
      attributes.kibanaSavedObjectMeta?.searchSourceJSON,
      '{"query":{"query":"status:200","language":"kuery"},"filter":[]}'
    );
  });

  it('writes each panel as the original does, its object named by a reference', () => {
    const { attributes, references } = dashboardToSavedObject(dashboard);
    assert.equal(
      attributes.panelsJSON,
      JSON.stringify([
        {
          version: '3.9.0',
          gridData: { x: 0, y: 0, w: 24, h: 15, i: '1' },
          panelIndex: '1',
          embeddableConfig: { vis: { legendOpen: false } },
          panelRefName: 'panel_0',
        },
        {
          version: '3.9.0',
          gridData: { x: 24, y: 0, w: 24, h: 15, i: '2' },
          panelIndex: '2',
          embeddableConfig: {},
          title: 'Its own title',
          panelRefName: 'panel_1',
        },
        // An empty title is written too: the panel shows none
        {
          version: '3.9.0',
          gridData: { x: 0, y: 15, w: 24, h: 15, i: '3' },
          panelIndex: '3',
          embeddableConfig: {},
          title: '',
          panelRefName: 'panel_2',
        },
      ])
    );
    assert.deepEqual(references, [
      { name: 'panel_0', type: 'visualization', id: 'vis-1' },
      { name: 'panel_1', type: 'search', id: 'search-1' },
      { name: 'panel_2', type: 'visualization', id: 'vis-3' },
    ]);
  });

  it('writes no time when the dashboard does not keep one', () => {
    const { attributes } = dashboardToSavedObject({ ...dashboard, timeRestore: false });
    assert.equal(attributes.timeRestore, false);
    assert.equal('timeFrom' in attributes, false);
    assert.equal('refreshInterval' in attributes, false);
  });

  it('reads back what it wrote', () => {
    const { attributes, references } = dashboardToSavedObject(dashboard);
    const read = dashboardFromSavedObject({ id: 'mine', attributes, references });
    assert.deepEqual(read.panels.map((item) => [item.panelIndex, item.type, item.id, item.title]), [
      ['1', 'visualization', 'vis-1', undefined],
      ['2', 'search', 'search-1', 'Its own title'],
      ['3', 'visualization', 'vis-3', ''],
    ]);
    assert.equal(panelsDiffer(read.panels, dashboard.panels), false);
  });

  it('writes back the search source it read, the filters last, as the original', () => {
    const read = dashboardFromSavedObject({
      id: 'logs',
      attributes: {
        title: 'Logs',
        kibanaSavedObjectMeta: { searchSourceJSON: '{"query":{"language":"kuery","query":""},"filter":[],"highlightAll":true,"version":true}' },
      },
    });
    const { attributes } = dashboardToSavedObject({ ...read, query: { language: 'kuery', query: 'status:404' } });
    assert.equal(
      attributes.kibanaSavedObjectMeta?.searchSourceJSON,
      '{"query":{"language":"kuery","query":"status:404"},"highlightAll":true,"version":true,"filter":[]}'
    );
  });

  it('saves times in UTC, and relative ones as they are', () => {
    assert.equal(timeAsSaved('now-15m'), 'now-15m');
    assert.equal(timeAsSaved('2024-05-01T10:00:00.000+02:00'), '2024-05-01T08:00:00.000Z');
  });
});

// What OpenSearch Dashboards 3.9.0 makes of the same panels when it opens such a dashboard and saves it
describe('a dashboard saved in an older form', () => {
  const read = (panels: unknown[]) =>
    dashboardFromSavedObject({ id: 'old', attributes: { title: 'Old', panelsJSON: JSON.stringify(panels) } }).panels;

  it('brings 6.1 and 6.2 panels from their 12 columns to the 48 of today', () => {
    const panels = read([
      { gridData: { x: 0, y: 0, w: 6, h: 3, i: '1' }, panelIndex: 1, type: 'visualization', id: 'vis-1', version: '6.1.0' },
      {
        gridData: { x: 6, y: 3, w: 6, h: 3, i: '2' },
        panelIndex: 2,
        type: 'visualization',
        id: 'vis-2',
        version: '6.2.4',
        embeddableConfig: { vis: { legendOpen: false } },
      },
      { gridData: { x: 24, y: 0, w: 24, h: 15, i: '3' }, panelIndex: 3, type: 'visualization', id: 'vis-3', version: '6.3.0' },
    ]);
    assert.deepEqual(
      panels.map((item) => item.gridData),
      [
        { x: 0, y: 0, w: 24, h: 15, i: '1' },
        { x: 24, y: 15, w: 24, h: 15, i: '2' },
        { x: 24, y: 0, w: 24, h: 15, i: '3' },
      ]
    );
    assert.deepEqual(panels[1].embeddableConfig, { vis: { legendOpen: false } });
  });

  it("keeps a saved search's columns and sort, which panels before 6.4 held beside their settings", () => {
    const panels = read([
      { col: 1, row: 5, size_x: 12, size_y: 4, panelIndex: 3, type: 'search', id: 'search-1', columns: ['category'], sort: ['order_date', 'asc'] },
      { gridData: { x: 6, y: 0, w: 6, h: 3, i: '2' }, panelIndex: 2, type: 'search', id: 'search-1', version: '6.1.0', sort: ['order_date', 'asc'] },
      {
        gridData: { x: 0, y: 0, w: 24, h: 15, i: '4' },
        panelIndex: 4,
        type: 'search',
        id: 'search-1',
        version: '6.3.0',
        embeddableConfig: { some: 1 },
        columns: ['a'],
        sort: ['b', 'desc'],
      },
      { gridData: { x: 0, y: 0, w: 24, h: 15, i: '5' }, panelIndex: '5', type: 'search', id: 'search-1', version: '7.2.0', columns: ['a'] },
    ]);
    assert.deepEqual(panels[0].gridData, { x: 0, y: 20, w: 48, h: 20, i: '3' });
    assert.deepEqual(panels[0].embeddableConfig, { columns: ['category'], sort: ['order_date', 'asc'] });
    assert.deepEqual(panels[1].embeddableConfig, { sort: ['order_date', 'asc'] });
    assert.deepEqual(panels[2].embeddableConfig, { some: 1, columns: ['a'], sort: ['b', 'desc'] });
    // From 6.4 on they are among the settings already; what is beside them is not read
    assert.deepEqual(panels[3].embeddableConfig, {});
  });

  it('reads a query kept from before queries had a language as Lucene, and saves it so', () => {
    const open = (source: string) =>
      dashboardFromSavedObject({ id: 'old', attributes: { title: 'Old', kibanaSavedObjectMeta: { searchSourceJSON: source } } });
    const dsl = open('{"query":{"query_string":{"query":"customer_gender:MALE","analyze_wildcard":true}},"filter":[]}');
    assert.deepEqual(dsl.query, { query: { query_string: { query: 'customer_gender:MALE', analyze_wildcard: true } }, language: 'lucene' });
    // As the fork's build saves it again: the text, then the language
    assert.equal(
      dashboardToSavedObject(dsl).attributes.kibanaSavedObjectMeta?.searchSourceJSON,
      '{"query":{"query":{"query_string":{"query":"customer_gender:MALE","analyze_wildcard":true}},"language":"lucene"},"filter":[]}'
    );
    assert.deepEqual(open('{"query":"customer_gender:MALE","filter":[]}').query, { query: 'customer_gender:MALE', language: 'lucene' });
    // A query in a language the panels do not share gives way to an empty DQL query
    assert.deepEqual(open('{"query":{"query":"source = logs","language":"PPL"},"filter":[]}').query, { query: '', language: 'kuery' });
    assert.deepEqual(open('{"query":{"query":"a","language":"kuery"},"filter":[]}').query, { query: 'a', language: 'kuery' });
    assert.equal(open('{"filter":[]}').query, undefined);
  });
});

describe('a dashboard in the address', () => {
  it('carries its panels as the original does, with their version', () => {
    const url = panelsToUrl([panel('a', 0, 0, { title: 'Own' })]);
    assert.deepEqual(url, [
      {
        embeddableConfig: {},
        gridData: { x: 0, y: 0, w: 24, h: 15, i: 'a' },
        id: 'vis-a',
        panelIndex: 'a',
        title: 'Own',
        type: 'visualization',
        version: '3.9.0',
      },
    ]);
    assert.deepEqual(panelsFromUrl(url), [panel('a', 0, 0, { title: 'Own' })]);
    assert.equal(panelsFromUrl('not panels'), undefined);
  });

  it('is not changed by going through the address, which sorts the keys of its settings', () => {
    // As a map panel of [eCommerce] is saved: the zoom before the centre
    const saved = [panel('11', 0, 0, { embeddableConfig: { mapZoom: 2, mapCenter: [28.304380682962783, -22.148437500000004], vis: { b: null, a: 1 } } })];
    const read = panelsFromUrl(decodeState<{ panels: unknown }>(encodeState({ panels: panelsToUrl(saved) })).panels);
    assert.deepEqual(Object.keys(read?.[0].embeddableConfig ?? {}), ['mapCenter', 'mapZoom', 'vis']);
    assert.equal(panelsDiffer(read ?? [], saved), false);
    const moved = [panel('11', 0, 0, { embeddableConfig: { mapZoom: 3, mapCenter: [28.304380682962783, -22.148437500000004], vis: { b: null, a: 1 } } })];
    assert.equal(panelsDiffer(moved, saved), true);
  });

  it('holds the whole state once open, the panels only while editing', () => {
    const saved: Dashboard = { ...emptyDashboard(), id: 'mine', title: 'Mine', panels: [panel('a', 0, 0)] };
    const query = { query: '', language: 'kuery' };
    const viewed = fullAppState(saved, {}, saved.panels, query);
    assert.deepEqual(viewed, {
      description: '',
      filters: [],
      fullScreenMode: false,
      options: { useMargins: true, hidePanelTitles: false, useSharedCrosshair: false },
      query,
      timeRestore: false,
      title: 'Mine',
      viewMode: 'view',
    });
    const edited = fullAppState(saved, { viewMode: 'edit' }, saved.panels, query);
    assert.deepEqual(edited.panels, panelsToUrl(saved.panels));
    // A new dashboard opens to be edited
    assert.equal(fullAppState(emptyDashboard(), {}, [], query).viewMode, 'edit');
  });

  it('compares queries by their text and language', () => {
    assert.equal(sameQuery({ query: 'a', language: 'kuery' }, { language: 'kuery', query: 'a' }), true);
    assert.equal(sameQuery({ query: 'a', language: 'kuery' }, { query: 'a', language: 'lucene' }), false);
    // A query of OpenSearch's DSL read back from the address, its keys sorted, is the one saved
    const saved = { query: { query_string: { query: 'a', analyze_wildcard: true } }, language: 'lucene' };
    assert.equal(sameQuery(decodeState<{ query: Query }>(encodeState({ query: saved })).query, saved), true);
    assert.equal(sameQuery({ ...saved, query: { query_string: { query: 'b', analyze_wildcard: true } } }, saved), false);
  });

  it('takes a query from the address as the original does, one with no language as Lucene', () => {
    const saved: Dashboard = { ...emptyDashboard(), id: 'mine', title: 'Mine' };
    const query = { query: '', language: 'kuery' };
    // As an address written before queries had a language carries it
    const old = decodeState<UrlAppState>('(query:(query_string:(query:a)))');
    assert.deepEqual(fullAppState(saved, old, [], query).query, {
      query: { query_string: { query: 'a' } },
      language: 'lucene',
    });
    assert.deepEqual(fullAppState(saved, { query: { query: 'x', language: 'SQL' } }, [], query).query, { query: '', language: 'kuery' });
    assert.deepEqual(fullAppState(saved, { query: { query: 'x', language: 'lucene' } }, [], query).query, { query: 'x', language: 'lucene' });
  });
});

describe("a dashboard's own time", () => {
  // As [Flights] is saved: the interval with the picker's own fields beside the pause and value
  const kept = {
    timeRestore: true,
    timeFrom: 'now-7d',
    timeTo: 'now',
    refreshInterval: { display: '15 minutes', pause: false, section: 2, value: 900000 },
  };

  it('comes with the dashboard, the interval as the time filter keeps it', () => {
    assert.deepEqual(ownTime(kept), { time: { from: 'now-7d', to: 'now' }, refreshInterval: { pause: false, value: 900000 } });
    assert.deepEqual(ownTime({ ...kept, timeRestore: false }), {});
    assert.deepEqual(ownTime({ ...kept, refreshInterval: { pause: false, value: 0 } }).refreshInterval, { pause: true, value: 0 });
  });

  it('gives way to what the address named, each part on its own', () => {
    // An address with `_g=()` or `_g=(filters:!())` names no time: the dashboard's is taken
    assert.deepEqual(ownTime(kept, {}).time, { from: 'now-7d', to: 'now' });
    assert.deepEqual(ownTime(kept, { time: { from: 'now-1h', to: 'now' } }), { refreshInterval: { pause: false, value: 900000 } });
    assert.deepEqual(ownTime(kept, { refreshInterval: { pause: false, value: 5000 } }), { time: { from: 'now-7d', to: 'now' } });
  });
});

describe('the order a dashboard keeps its panels in', () => {
  const ids = (panels: PanelState[]) => panels.map((item) => item.panelIndex);

  it('is the order given, those new to it last', () => {
    const panels = [panel('b', 0, 0), panel('a', 24, 0), panel('c', 0, 15)];
    assert.deepEqual(ids(orderAsOriginal(panels, ['c', 'a'])), ['c', 'a', 'b']);
  });

  it('lists whole numbers first, in numeric order, as an object lists its keys', () => {
    const panels = [panel('uuid-1', 0, 0), panel('10', 24, 0), panel('2', 0, 15), panel('02', 24, 15)];
    assert.deepEqual(ids(orderAsOriginal(panels, ['uuid-1', '10', '02', '2'])), ['2', '10', 'uuid-1', '02']);
  });

  it('follows the grid, which hands panels back in reading order', () => {
    assert.deepEqual(readingOrder([panel('a', 24, 15), panel('b', 0, 15), panel('c', 24, 0)]), ['c', 'b', 'a']);
  });

  it('is not changed by a change that leaves the panels as they are', () => {
    const panels = [panel('a', 0, 0), panel('b', 24, 0)];
    assert.equal(samePanels([panels[1], panels[0]], panels), true);
    assert.equal(samePanels([panels[0], panel('b', 24, 1)], panels), false);
    assert.equal(samePanels([panels[0]], panels), false);
  });
});

describe('the turns charts take to draw', () => {
  it('make a chart wait for those before it', async () => {
    const turns = makeTurns(['a', 'b', 'c']);
    const drawn: string[] = [];
    const wait = (id: string) =>
      waitTurn(turns.get(id), 5000).then(() => {
        drawn.push(id);
        turns.get(id)?.done();
      });
    // Their data arrives in the opposite order
    const all = [wait('c'), wait('b')];
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(drawn, []);
    all.push(wait('a'));
    await Promise.all(all);
    assert.deepEqual(drawn, ['a', 'b', 'c']);
  });

  it('do not hold a chart for long', async () => {
    const turns = makeTurns(['slow', 'next']);
    const started = Date.now();
    await waitTurn(turns.get('next'), 30);
    assert.ok(Date.now() - started >= 25);
    await waitTurn(undefined);
  });
});

describe('the filters a saved search panel makes', () => {
  const currency = phraseFilter({ name: 'currency' }, 'EUR', 'ecommerce');
  const notFemale: Filter = { ...phraseFilter({ name: 'customer_gender' }, 'FEMALE', 'ecommerce') };
  notFemale.meta = { ...notFemale.meta, negate: true };
  const named = existsFilter({ name: 'customer_first_name' }, 'ecommerce');
  const keys = (filters: Filter[]) => filters.map((filter) => `${filter.meta.negate ? '-' : ''}${filter.meta.key}`);

  it("finds the dashboard's filter for the same value, as the original's getExistingFilter", () => {
    assert.equal(existingFilter([notFemale, currency], 'currency', 'EUR', false), currency);
    assert.equal(existingFilter([notFemale, currency], 'customer_gender', 'FEMALE', false), notFemale);
    assert.equal(existingFilter([currency], 'currency', 'USD', false), undefined);
    // The filter on a field being there is found only for that button
    assert.equal(existingFilter([named], 'customer_first_name', 'customer_first_name', true), named);
    assert.equal(existingFilter([named], 'customer_first_name', 'customer_first_name', false), undefined);
    assert.equal(existingFilter([currency], 'currency', 'currency', true), undefined);
  });

  it('takes such a filter again turned on and negated as asked, its keys where they were', () => {
    const off: Filter = { ...currency, meta: { ...currency.meta, disabled: true } };
    const again = takenAgain(off, true);
    assert.equal(again.meta.disabled, false);
    assert.equal(again.meta.negate, true);
    assert.deepEqual(again.$state, { store: 'appState' });
    assert.deepEqual(Object.keys(again), Object.keys(off));
    assert.deepEqual(Object.keys(again.meta), Object.keys(off.meta));
  });

  it("moves a value filtered out after it was filtered for to the end, as the original's filter manager", () => {
    // The reference, filtering out EUR after EUR, female left out and a first name asked for
    const added = uniqueFilters([currency, notFemale, named, takenAgain(currency, true)]);
    assert.deepEqual(keys(added), ['-customer_gender', 'customer_first_name', '-currency']);
  });

  it('changes a pinned filter where it is when the panel asks the same', () => {
    const pinned: Filter = { ...currency, $state: { store: 'globalState' } };
    const added = uniqueFilters([pinned, notFemale, takenAgain(currency, true)]);
    assert.deepEqual(keys(added), ['-currency', '-customer_gender']);
    assert.deepEqual(added[0].$state, { store: 'globalState' });
  });
});

describe('what a panel offers', () => {
  it('offers no Inspect for the kinds of visualization the original gives no inspector', () => {
    for (const type of ['input_control_vis', 'markdown', 'metrics', 'timelion']) assert.equal(offersInspector(type), false, type);
    for (const type of ['area', 'pie', 'table', 'vega', 'region_map', 'tile_map']) assert.equal(offersInspector(type), true, type);
  });

  it('names what Add panels found as the original does in its tooltip and in the toast', () => {
    // As the dashboard's flyouts name the types they add
    const types = [
      { type: 'visualization', name: 'Visualization' },
      { type: 'visualization-visbuilder', name: 'VisBuilder' },
      { type: 'search', name: 'Saved search' },
    ];
    const found = (type: string, attributes: { title?: string; visState?: string }) => ({ id: 'x', type, attributes, references: [] });
    assert.equal(finderName(found('visualization', { title: 'Sales by Gender', visState: '{"type":"pie"}' }), types), 'Sales by Gender (Pie)');
    assert.equal(finderName(found('visualization', { title: 'Notes', visState: '{"type":"markdown"}' }), types), 'Notes (Markdown)');
    assert.equal(finderName(found('search', { title: '[eCommerce] Orders' }), types), '[eCommerce] Orders (Saved search)');
    assert.equal(finderName(found('visualization-visbuilder', { title: 'Built' }), types), 'Built (VisBuilder)');
  });
});

describe('the round trip to an editor', () => {
  const container = { containerName: 'My dashboard', containerId: 'mine' };

  it('hands the editor what the original edit action hands it: the panel by reference', () => {
    const state = editorStateFor('7', container);
    assert.deepEqual(Object.keys(state), ['originatingApp', 'valueInput', 'embeddableId', 'containerInfo']);
    assert.deepEqual(state, { originatingApp: 'dashboards', valueInput: undefined, embeddableId: '7', containerInfo: container });
    assert.deepEqual(Object.keys(state.containerInfo ?? {}), ['containerName', 'containerId']);
  });

  it("tells the editor Create new opens where it came from, as the original's visualization factory does", () => {
    const { originatingApp, containerInfo } = createNewState(container);
    // What the New Visualization dialog then opens the editor with, which goes back to this dashboard
    assert.deepEqual(newVisEditorState(originatingApp, containerInfo), { originatingApp: 'dashboards', containerInfo: container });
    assert.equal(originatingAppUrl(originatingApp, { containerInfo }), '/app/dashboards#/view/mine?_a=(viewMode:edit)');
    // A dashboard not saved yet is gone back to as a new one
    assert.equal(originatingAppUrl(originatingApp, createNewState({ containerName: '', containerId: '' })), '/app/dashboards#/create');
  });

  it('reads as a panel handed back only a type and an input that is an object', () => {
    const handed = { type: 'visualization', input: { savedObjectId: 'v' }, embeddableId: '7' };
    assert.equal(handedPanel(handed), handed);
    assert.equal(handedPanel(undefined), undefined);
    assert.equal(handedPanel(null), undefined);
    assert.equal(handedPanel({ originatingApp: 'dashboards', embeddableId: '7' }), undefined);
    assert.equal(handedPanel({ type: 'visualization', input: null }), undefined);
    assert.equal(handedPanel({ type: 'visualization', input: 'v' }), undefined);
    assert.equal(handedPanel({ type: 7, input: {} }), undefined);
  });

  it('gives the panel it was sent from what comes back, in its place, its own settings kept', () => {
    const sent = panel('7', 24, 0, { embeddableConfig: { vis: { legendOpen: false } }, title: 'Mine' });
    const panels = [panel('1', 0, 0), sent];
    const next = withHandedPanel(panels, { type: 'visualization', input: { savedObjectId: 'other' }, embeddableId: '7' }, () => 'new');
    assert.deepEqual(next, [panels[0], { ...sent, id: 'other' }]);
    // The input handed over goes over the panel's own, as the original's explicit input does
    const titled = withHandedPanel(panels, { type: 'search', input: { title: 'Theirs', columns: ['a'] }, embeddableId: '7' }, () => 'new');
    assert.deepEqual(titled?.[1], {
      ...sent,
      type: 'search',
      embeddableConfig: { vis: { legendOpen: false }, columns: ['a'] },
      title: 'Theirs',
    });
  });

  it('adds a new panel where Add panels puts one, after the others, as addNewEmbeddable does', () => {
    const panels = [panel('1', 0, 0), panel('2', 24, 0)];
    const next = withHandedPanel(panels, { type: 'visualization', input: { savedObjectId: 'made' } }, () => 'new');
    assert.deepEqual(next, [
      ...panels,
      { panelIndex: 'new', gridData: { x: 0, y: 15, w: 24, h: 15, i: 'new' }, type: 'visualization', id: 'made', embeddableConfig: {} },
    ]);
    // A panel it was not sent from, gone since, is a new one too
    assert.equal(withHandedPanel(panels, { type: 'visualization', input: { savedObjectId: 'made' }, embeddableId: 'gone' }, () => 'new')?.length, 3);
    assert.deepEqual(withHandedPanel([], { type: 'visualization', input: { savedObjectId: 'made' } }, () => 'new')?.[0]?.gridData, {
      x: 0,
      y: 0,
      w: 24,
      h: 15,
      i: 'new',
    });
  });

  it('leaves out a new panel with no saved object, which it could not draw or save', () => {
    assert.equal(withHandedPanel([panel('1', 0, 0)], { type: 'visualization', input: { savedVis: {} } }, () => 'new'), undefined);
  });
});

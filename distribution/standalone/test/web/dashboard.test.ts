/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  cloneBase,
  cloneTitle,
  fullAppState,
  marksDiffer,
  openingMarks,
  ownTime,
  sameQuery,
  viewedFromAddress,
  type ChangeMarks,
  type UrlAppState,
} from '../../web/apps/dashboard/app_state';
import {
  MIN_PANEL,
  cellUnder,
  compact,
  createNewState,
  dashboardBars,
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
  openedEmbedded,
  orderAsOriginal,
  panelTitle,
  panelTitleHidden,
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
  type DashboardBars,
  type GridItem,
  type PanelState,
} from '../../web/apps/dashboard/model';
import { DashboardGrid, NARROW_WINDOW, placeOf, WhenSeen } from '../../web/apps/dashboard/grid';
import { PanelMenu } from '../../web/apps/dashboard/panel_menu';
import { PanelTitle } from '../../web/apps/dashboard/panel_title';
import { existsFilter, phraseFilter, uniqueFilters } from '../../web/lib/query';
import type { Filter, Query } from '../../web/lib/types';
import { decodeState, encodeState } from '../../web/lib/url';
import { editorStateFor as newVisEditorState } from '../../web/apps/visualize/state_transfer';
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

// As the original's grid lays a dashboard out in a narrow window (_dashboard_grid.scss), measured
// on its page at 560, 700, 740, 760 and 800 pixels
describe('a dashboard in a narrow window', () => {
  const layout: GridItem[] = [
    { x: 24, y: 0, w: 24, h: 12, i: 'b' },
    { x: 0, y: 0, w: 24, h: 12, i: 'a' },
    { x: 0, y: 12, w: 48, h: 5, i: 'c' },
  ];
  // The grid drawn in a window that is narrow or not
  const grid = (editing: boolean, narrowWindow: boolean) => {
    const holder = globalThis as { window?: unknown };
    holder.window = { matchMedia: (query: string) => ({ matches: narrowWindow && query === NARROW_WINDOW }) };
    try {
      return renderToStaticMarkup(
        createElement(DashboardGrid, {
          layout,
          useMargins: true,
          editing,
          dashboardState: '',
          onLayoutChange: () => undefined,
          renderPanel: (item: GridItem) => createElement('i', null, item.i),
        })
      );
    } finally {
      delete holder.window;
    }
  };

  it('stacks the panels below 768 pixels while it is looked at, in reading order, in the wrappers scripts find', () => {
    assert.equal(NARROW_WINDOW, '(max-width: 767px)');
    const stacked = grid(false, true);
    assert.match(stacked, /dshGrid--stacked/);
    assert.deepEqual(
      [...stacked.matchAll(/data-test-subj="dashboardPanel"><i>(\w)<\/i>/g)].map((found) => found[1]),
      ['a', 'b', 'c']
    );
  });

  it('keeps the grid while it is edited, and in a wider window', () => {
    assert.ok(!grid(true, true).includes('dshGrid--stacked'));
    assert.ok(!grid(false, false).includes('dshGrid--stacked'));
  });
});

// As the original's grid draws a panel (embeddable_child_panel.tsx): once it comes near the window,
// its loading chart until then, measured on the demo dashboard of the logs, 7 of its 53 drawn
describe('a panel far from the window', () => {
  const drawn = (observing: boolean) => {
    const holder = globalThis as { IntersectionObserver?: unknown };
    if (observing) holder.IntersectionObserver = class {};
    try {
      return renderToStaticMarkup(createElement(WhenSeen, { id: 'a', children: createElement('i', null, 'the panel') }));
    } finally {
      delete holder.IntersectionObserver;
    }
  };

  it('shows the loading chart in its place until it is seen', () => {
    assert.equal(
      drawn(true),
      '<div class="dshWaiting"><span class="dshWaiting__chart">' +
        '<span class="dshWaiting__bar"></span><span class="dshWaiting__bar"></span><span class="dshWaiting__bar"></span><span class="dshWaiting__bar"></span>' +
        '</span></div>'
    );
  });

  it('is drawn at once where nothing can tell where the window is', () => {
    assert.equal(drawn(false), '<i>the panel</i>');
  });
});

// As the original's grid (react-grid-layout without CSS transforms) writes its panels' places, read
// on its page in a window 1400 pixels wide, where the browser puts its first panel at 7.984375 until
// the grid is drawn again (a query submitted, Edit), and at 8 from then on
describe("a panel's place on the grid", () => {
  it('is first in hundredths of the grid across, to the last digit, and in pixels down, the margin around all', () => {
    assert.deepEqual(placeOf({ x: 0, y: 0, w: 24, h: 12, i: 'a' }, 1400, 8, true), {
      left: '0.5714285714285714%',
      top: '8px',
      width: '49.142857142857146%',
      height: '328px',
    });
    assert.deepEqual(placeOf({ x: 24, y: 12, w: 24, h: 15, i: 'b' }, 1400, 8, true), {
      left: '50.28571428571429%',
      top: '344px',
      width: '49.142857142857146%',
      height: '412px',
    });
  });

  it('is in pixels once the grid is drawn again', () => {
    assert.deepEqual(placeOf({ x: 24, y: 0, w: 24, h: 12, i: 'b' }, 1400, 8, false), { left: '704px', top: '8px', width: '688px', height: '328px' });
  });

  it('spans the page without margins', () => {
    assert.deepEqual(placeOf({ x: 24, y: 0, w: 24, h: 12, i: 'b' }, 1400, 0, true), { left: '50%', top: '0px', width: '50%', height: '240px' });
  });

  it('is where the panel in hand is, while one is moved or sized', () => {
    const item = { x: 0, y: 0, w: 24, h: 12, i: 'a' };
    assert.deepEqual(placeOf(item, 1400, 8, false, { left: 50.4, top: 20.6 }), { left: '50px', top: '21px', width: '688px', height: '328px' });
    assert.deepEqual(placeOf(item, 1400, 8, false, { left: 8, top: 8, width: 700.2, height: 400.7 }).height, '401px');
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

  it('shows the panels it carries while looked at, then leaves them out of it', () => {
    const saved: Dashboard = { ...emptyDashboard(), id: 'mine', title: 'Mine', panels: [panel('a', 0, 0)] };
    const query = { query: '', language: 'kuery' };
    const given = [panel('b', 24, 0, { title: 'From the address' }), panel('a', 0, 0)];
    const viewed: UrlAppState = { viewMode: 'view', panels: panelsToUrl(given) };
    assert.deepEqual(viewedFromAddress(saved, viewed), given);
    assert.deepEqual(viewedFromAddress(saved, { panels: panelsToUrl(given) }), given);
    assert.equal(fullAppState(saved, viewed, given, query).panels, undefined);
    // While it is edited they stay in the address, which is where the page reads them from
    assert.equal(viewedFromAddress(saved, { ...viewed, viewMode: 'edit' }), undefined);
    assert.equal(viewedFromAddress({ id: undefined }, { panels: panelsToUrl(given) }), undefined);
    assert.equal(viewedFromAddress(saved, { viewMode: 'view' }), undefined);
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

// As the original counts a change of a dashboard (its isDirty), which says "(unsaved)" and asks
// before changes are discarded, measured on its page
describe('what changes a dashboard', () => {
  const panel = (i: string, x: number): PanelState => ({
    panelIndex: i,
    gridData: { x, y: 0, w: 24, h: 15, i },
    type: 'visualization',
    id: `v${i}`,
    embeddableConfig: {},
  });
  const opened: ChangeMarks = { panels: [panel('1', 0)], query: { query: '', language: 'kuery' }, filters: [] };
  const lastWeek = { from: 'now-7d', to: 'now' };
  const paused = { pause: true, value: 0 };

  it('is a change of its panels, its query or its filters, not of the order of their keys', () => {
    assert.equal(marksDiffer(opened, { ...opened, query: { language: 'kuery', query: '' } }), false);
    assert.equal(marksDiffer(opened, { ...opened, query: { query: 'customer_gender:MALE', language: 'kuery' } }), true);
    assert.equal(marksDiffer(opened, { ...opened, panels: [panel('1', 24)] }), true);
    // A panel an editor hands back as a new one, after the page opened
    assert.equal(marksDiffer(opened, { ...opened, panels: [panel('1', 0), panel('2', 24)] }), true);
    assert.equal(marksDiffer(opened, { ...opened, filters: [existsFilter({ name: 'customer_first_name' }, 'ecommerce')] }), true);
  });

  it('is a change of its time and refresh interval while it keeps its own', () => {
    const own = { ...opened, time: lastWeek, refreshInterval: paused };
    assert.equal(marksDiffer(own, { ...own, time: { from: 'now-1d', to: 'now' } }), true);
    assert.equal(marksDiffer(own, { ...own, refreshInterval: { pause: false, value: 5000 } }), true);
    assert.equal(marksDiffer(own, { ...own, refreshInterval: { value: 0, pause: true } }), false);
  });

  it('opens with the time it keeps, as the page puts it in place: its coming is no change', () => {
    const dashboard = { timeRestore: true, timeFrom: 'now-15d', timeTo: 'now', refreshInterval: { pause: false, value: 900000 } };
    const loading = { ...opened, time: { from: 'now-15m', to: 'now' }, refreshInterval: paused };
    const start = openingMarks(loading, dashboard);
    assert.equal(marksDiffer(start, { ...opened, time: { from: 'now-15d', to: 'now' }, refreshInterval: { pause: false, value: 900000 } }), false);
    // A time the address named is the one it opens with
    assert.deepEqual(openingMarks(loading, dashboard, { time: { from: 'now-15m', to: 'now' } }).time, { from: 'now-15m', to: 'now' });
    // Without a time of its own, it opens with what the page shows
    assert.equal(openingMarks(opened, { ...dashboard, timeRestore: false }), opened);
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

describe("a panel's title", () => {
  const grid = { x: 0, y: 0, w: 24, h: 15, i: '1' };
  const stored = (embeddableConfig: Record<string, unknown>, title?: string) => ({
    version: '7.10.2',
    gridData: grid,
    panelIndex: '1',
    embeddableConfig,
    ...(title !== undefined ? { title } : {}),
    panelRefName: 'panel_0',
  });
  const read = (panel: unknown) =>
    dashboardFromSavedObject({
      id: 'titles',
      attributes: { title: 'Titles', panelsJSON: JSON.stringify([panel]) },
      references: [{ name: 'panel_0', type: 'visualization', id: 'vis-1' }],
    }).panels[0];

  it('takes a title kept among the settings over the one beside them, as the original reads a panel', () => {
    const custom = read(stored({ title: 'Custom A', vis: { legendOpen: false } }));
    assert.equal(custom.title, 'Custom A');
    assert.deepEqual(custom.embeddableConfig, { vis: { legendOpen: false } });
    assert.equal(read(stored({ title: 'Config B' }, 'Top B')).title, 'Config B');
    assert.equal(read(stored({ title: '' }, 'Top C')).title, '');
    assert.equal(read(stored({}, 'Top D')).title, 'Top D');
    // ...and writes it beside them when it saves the panel again
    const { attributes } = dashboardToSavedObject({ ...emptyDashboard(), title: 'Titles', panels: [custom] });
    assert.equal(
      attributes.panelsJSON,
      JSON.stringify([
        { version: '3.9.0', gridData: grid, panelIndex: '1', embeddableConfig: { vis: { legendOpen: false } }, title: 'Custom A', panelRefName: 'panel_0' },
      ])
    );
  });

  it('takes it so from the address too', () => {
    const [panel] =
      panelsFromUrl([
        { embeddableConfig: { title: 'Custom A', hidePanelTitles: false }, gridData: grid, id: 'vis-1', panelIndex: '1', title: 'Top', type: 'visualization', version: '3.9.0' },
      ]) ?? [];
    assert.equal(panel.title, 'Custom A');
    assert.deepEqual(panel.embeddableConfig, { hidePanelTitles: false });
  });

  it("shows its own title, else its object's, and none when titles are hidden, as the original", () => {
    const titled = (embeddableConfig: Record<string, unknown>, title?: string) => ({ embeddableConfig, ...(title !== undefined ? { title } : {}) });
    assert.equal(panelTitle(titled({}), 'Object', false), 'Object');
    assert.equal(panelTitle(titled({}, 'Own'), 'Object', false), 'Own');
    assert.equal(panelTitle(titled({ title: 'Among the settings' }, 'Own'), 'Object', false), 'Among the settings');
    assert.equal(panelTitle(titled({}, ''), 'Object', false), '');
    // The text goes with the panel's own setting, or else the dashboard's...
    assert.equal(panelTitle(titled({}, 'Own'), 'Object', true), '');
    assert.equal(panelTitle(titled({ hidePanelTitles: true }), 'Object', false), '');
    // ...and the title is hidden when either the dashboard or the panel hides it
    assert.equal(panelTitleHidden(titled({ hidePanelTitles: false }), true), true);
    assert.equal(panelTitleHidden(titled({ hidePanelTitles: true }), false), true);
    assert.equal(panelTitleHidden(titled({}), false), false);
  });
});

// As the original's panel header marks it up (panel_header.tsx), compared with its page
describe("a panel's heading", () => {
  const heading = (props: Partial<Parameters<typeof PanelTitle>[0]> = {}) =>
    renderToStaticMarkup(
      createElement(PanelTitle, { labelId: 'l', title: 'Sales', showTitle: true, showBar: true, description: '', ...props })
    );
  // The declarations of a rule of the dashboard's stylesheet
  const ruleOf = (selector: string): string => {
    const sheet = readFileSync('web/styles/dashboard.css', 'utf8');
    const start = sheet.indexOf(`\n${selector} {`);
    assert.ok(start >= 0, `${selector} has a rule`);
    return sheet.slice(start, sheet.indexOf('}', start));
  };

  it('holds the title in a span of its own, with a description or without', () => {
    // What a script reads as the title is the title, after the words of a screen reader
    assert.equal(
      heading(),
      '<h2 class="dshPanel__title atlTruncate" title="Sales" data-test-subj="dashboardPanelTitle">' +
        '<span id="l" class="atlScreenReaderOnly">Dashboard panel: Sales</span>' +
        '<span class="dshPanel__titleInner"><span class="dshPanel__titleText">Sales</span></span></h2>'
    );
    assert.match(
      heading({ description: 'About sales' }),
      /<span class="dshPanel__titleInner"><span class="dshPanel__titleText">Sales<\/span> <svg[^>]*class="atlIcon[^"]*dshPanel__info"/
    );
  });

  it('puts "[No Title]" in place of the title while the dashboard is edited', () => {
    assert.match(heading({ title: '' }), /<span class="dshPanel__titleInner"><span class="dshPanel__noTitle">\[No Title\]<\/span><\/span><\/h2>$/);
    const described = heading({ title: '', description: 'About sales' });
    assert.match(described, /<span class="dshPanel__titleInner"><span class="dshPanel__noTitle">\[No Title\]<\/span> <svg/);
    assert.ok(!described.includes('dshPanel__titleText'));
  });

  it('is no heading on a panel without a bar, only what a screen reader calls it', () => {
    assert.equal(heading({ title: '', showTitle: false, showBar: false }), '<span id="l" class="atlScreenReaderOnly">Dashboard panel</span>');
  });

  it('leaves the options button and the description in the panel beside a long title', () => {
    // The button's anchor keeps its size, and the title's anchor no wider than the heading: what
    // does not fit of a long title is cut short before them, as in the original
    assert.match(renderToStaticMarkup(createElement(PanelMenu, { editing: false, items: [] })), /^<span class="dshPanel__menuAnchor"[ >]/);
    assert.match(ruleOf('.dshPanel__menuAnchor'), /flex: none;/);
    assert.match(ruleOf('.dshPanel__title > .atlTooltipAnchor'), /max-width: 100%;/);
  });
});

// As OpenSearch Dashboards 3.9.0 shows them, measured on a page opened afresh with each address
describe('the bar over a dashboard', () => {
  const page = { headerShown: true, fullScreen: false, hasFilters: false };
  const embedded = { ...page, headerShown: false };
  const shown = (bars: DashboardBars) =>
    Object.entries(bars)
      .filter(([part, visible]) => visible && part !== 'inlineMenu')
      .map(([part]) => part);
  const all = ['topMenu', 'queryInput', 'datePicker', 'filterBar'];

  it('shows every part under the header, whatever the address asks for', () => {
    assert.deepEqual(shown(dashboardBars({}, page)), all);
    assert.deepEqual(shown(dashboardBars({ 'show-top-menu': 'false', 'hide-filter-bar': 'true' }, page)), all);
  });

  it('shows only the filters in a page embedded in another, unless its address asks for more', () => {
    assert.deepEqual(shown(dashboardBars({ embed: 'true' }, embedded)), ['filterBar']);
    assert.deepEqual(shown(dashboardBars({ embed: 'true', 'show-top-menu': 'true' }, embedded)), ['topMenu', 'filterBar']);
    assert.deepEqual(shown(dashboardBars({ embed: 'true', 'show-query-input': 'true' }, embedded)), ['queryInput', 'filterBar']);
    assert.deepEqual(shown(dashboardBars({ embed: 'true', 'show-time-filter': 'true' }, embedded)), ['datePicker', 'filterBar']);
    assert.deepEqual(shown(dashboardBars({ embed: 'true', 'hide-filter-bar': 'true' }, embedded)), []);
    // Any value asks, "false" too; none does not
    assert.deepEqual(shown(dashboardBars({ embed: 'false', 'show-query-input': 'true' }, embedded)), ['queryInput', 'filterBar']);
    assert.deepEqual(shown(dashboardBars({ embed: '', 'show-top-menu': 'true' }, embedded)), ['filterBar']);
  });

  it('keeps only the filters in full screen, and only when the dashboard has some of its own', () => {
    assert.deepEqual(shown(dashboardBars({}, { ...page, fullScreen: true })), []);
    assert.deepEqual(shown(dashboardBars({}, { ...page, fullScreen: true, hasFilters: true })), ['filterBar']);
    assert.deepEqual(shown(dashboardBars({ embed: 'true', 'show-top-menu': 'true', 'show-time-filter': 'true' }, { ...embedded, fullScreen: true })), []);
  });

  it('draws the menu in the page while the address has embed with a value, even one put there after the page loaded', () => {
    // Under the header then, as the original's top nav mounts its menu in the page (setMenuMountPoint)
    assert.deepEqual(dashboardBars({ embed: 'true' }, page), { ...dashboardBars({}, page), inlineMenu: true });
    assert.equal(dashboardBars({}, page).inlineMenu, false);
    assert.equal(dashboardBars({ embed: 'true', 'show-top-menu': 'true' }, embedded).inlineMenu, true);
    assert.equal(dashboardBars({ embed: '', 'show-top-menu': 'true' }, embedded).inlineMenu, false);
  });

  it('takes the page as embedded when it was opened with embed in its address, with a value or not', () => {
    assert.equal(openedEmbedded('#/view/d1?embed=true&_g=()'), true);
    assert.equal(openedEmbedded('#/view/d1?embed=&_g=()'), true);
    assert.equal(openedEmbedded('#/view/d1?_g=()'), false);
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

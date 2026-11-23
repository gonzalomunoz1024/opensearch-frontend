/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  APP_TITLE_FALLBACK,
  TRACKED_APPS,
  anchorPlacement,
  arrangeBreadcrumbs,
  breadcrumbLimit,
  breadcrumbTestSubject,
  breakpointOf,
  canDock,
  findPopoverPosition,
  helpExtensionOf,
  isAtLeast,
  isNavGroupOpen,
  navGroupKey,
  placeHeaderPopover,
  placeHeaderTooltip,
  recentLinkTitle,
  trackedAppLink,
  trackedUrlKey,
  withGlobalState,
  type Box,
} from '../../web/shell/chrome_layout';

const box = (left: number, top: number, width: number, height: number): Box => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
});

describe('the breakpoints of the header', () => {
  it('names a window by the widest breakpoint it reaches, as OUI', () => {
    assert.equal(breakpointOf(0), 'xs');
    assert.equal(breakpointOf(574), 'xs');
    assert.equal(breakpointOf(575), 's');
    assert.equal(breakpointOf(767), 's');
    assert.equal(breakpointOf(768), 'm');
    assert.equal(breakpointOf(991), 'm');
    assert.equal(breakpointOf(992), 'l');
    assert.equal(breakpointOf(1400), 'xl');
    assert.equal(breakpointOf(1680), 'xxl');
    assert.equal(breakpointOf(1920), 'xxxl');
    // Among some breakpoints only, as EuiBreadcrumbs asks with the keys of its limits
    assert.equal(breakpointOf(1400, ['xs', 'm']), 'm');
  });

  it('docks the navigation from 992 pixels on, where the original shows its dock button', () => {
    assert.equal(canDock(991), false);
    assert.equal(canDock(992), true);
    assert.equal(canDock(2400), true);
    assert.equal(isAtLeast(768, 'm'), true);
    assert.equal(isAtLeast(767, 'm'), false);
  });
});

describe('the trail of the header', () => {
  it('shows as many crumbs as the breakpoint lets EuiBreadcrumbs, ten at most', () => {
    assert.equal(breadcrumbLimit(560), 1);
    assert.equal(breadcrumbLimit(700), 2);
    assert.equal(breadcrumbLimit(900), 4);
    assert.equal(breadcrumbLimit(1000), 5);
    assert.equal(breadcrumbLimit(1400), 6);
    assert.equal(breadcrumbLimit(1700), 9);
    // xxxl allows 11, the header's max is 10
    assert.equal(breadcrumbLimit(2000), 10);
  });

  it('keeps the crumbs from both ends and folds the middle ones into "…"', () => {
    const shape = (count: number, limit: number) =>
      arrangeBreadcrumbs(count, limit).map((slot) =>
        slot.kind === 'crumb' ? slot.index : `…${slot.indexes.join(',')}`
      );
    assert.deepEqual(shape(2, 6), [0, 1]);
    assert.deepEqual(shape(2, 1), ['…0', 1]);
    assert.deepEqual(shape(3, 2), [0, '…1', 2]);
    assert.deepEqual(shape(5, 1), ['…0,1,2,3', 4]);
    assert.deepEqual(shape(5, 2), [0, '…1,2,3', 4]);
    assert.deepEqual(shape(5, 3), [0, '…1,2', 3, 4]);
    assert.deepEqual(shape(7, 4), [0, 1, '…2,3,4', 5, 6]);
    assert.deepEqual(shape(1, 1), [0]);
  });

  it('marks the first and the last crumb of the trail that is shown', () => {
    assert.equal(breadcrumbTestSubject(0, 1), 'breadcrumb first last');
    assert.equal(breadcrumbTestSubject(0, 2), 'breadcrumb first');
    assert.equal(breadcrumbTestSubject(1, 2), 'breadcrumb last');
    assert.equal(breadcrumbTestSubject(1, 3), 'breadcrumb');
  });

  it('falls back on the title the original never changes', () => {
    // Its header shows the application's title for a page without a trail, and that title
    // stays what it starts as: on the overviews and on Query Workbench it reads "Overview"
    assert.equal(APP_TITLE_FALLBACK, 'Overview');
  });
});

describe('where a popover of the header hangs', () => {
  const help = (anchor: Box, width: number) =>
    findPopoverPosition({
      anchor,
      popover: { width: 206.81, height: 173 },
      ...anchorPlacement('downRight'),
      offset: 16,
      buffer: 16,
      arrow: { width: 24, buffer: 10 },
      viewport: { width, height: 900 },
    });

  it('opens the help menu under its button in a wide window, its right edge on the button’s', () => {
    const placement = help(box(1352, 0, 48, 48), 1400);
    assert.equal(placement.position, 'bottom');
    assert.equal(Math.round(placement.left * 100) / 100, 1193.19);
    assert.equal(placement.top, 64);
  });

  it('opens it on the left of its button in a narrow one, where more of it fits', () => {
    const placement = help(box(524, 0, 36, 48), 560);
    assert.equal(placement.position, 'left');
    assert.equal(Math.round(placement.left * 100) / 100, 301.19);
    assert.equal(placement.top, 2);
  });

  it('centres a popover asked for under the middle of its button', () => {
    const placement = findPopoverPosition({
      anchor: box(111.05, 13.5, 28.05, 21),
      popover: { width: 112, height: 53 },
      ...anchorPlacement('downCenter'),
      offset: 16,
      arrow: { width: 24, buffer: 10 },
      viewport: { width: 560, height: 900 },
    });
    assert.equal(placement.position, 'bottom');
    // Where the original puts the "…" of a trail in a window 560 pixels wide: 69.07 from the left
    assert.ok(Math.abs(placement.left - 69.075) < 0.001);
    assert.equal(placement.top, 50.5);
  });

  it('reads the anchor positions of EuiPopover', () => {
    assert.deepEqual(anchorPlacement('downRight'), { position: 'bottom', align: 'right' });
    assert.deepEqual(anchorPlacement('downCenter'), { position: 'bottom', align: undefined });
    assert.deepEqual(anchorPlacement('leftUp'), { position: 'left', align: 'top' });
  });
});

describe('where the header draws what it opens', () => {
  const viewport = { width: 1400, height: 900 };
  const helpButton = box(1352, 0, 48, 48);
  const round = (value: number | undefined) => (value === undefined ? undefined : Math.round(value * 100) / 100);

  it('draws the help menu 8 pixels under its button, as the theme settles an open popover', () => {
    // Measured on the original at 1400 x 900: the panel at 1193.19, 56
    const placed = placeHeaderPopover({
      anchor: helpButton,
      popover: { width: 206.81, height: 173 },
      anchorPosition: 'downRight',
      viewport,
    });
    assert.deepEqual({ ...placed, left: round(placed.left) }, { position: 'bottom', top: 56, left: 1193.19 });
  });

  it('draws it left of its button when an application has added to it, where more of it fits', () => {
    // With the part Dashboards adds it is 258 high; measured on the original at 1137.19, 2
    const request = {
      anchor: helpButton,
      popover: { width: 206.81, height: 258 },
      anchorPosition: 'downRight',
      viewport,
    };
    const placed = placeHeaderPopover(request);
    assert.deepEqual({ ...placed, left: round(placed.left) }, { position: 'left', top: 2, left: 1137.19 });
    // Open, it keeps its side whatever its content becomes
    const kept = placeHeaderPopover({ ...request, popover: { width: 206.81, height: 173 }, keep: 'left' });
    assert.equal(kept.position, 'left');
    assert.equal(round(kept.left), 1137.19);
  });

  it('hangs the crumbs left out under the middle of their "…"', () => {
    // Measured on the original at 560 pixels: the "…" at 111.05, its panel at 23.97, 42.5
    const placed = placeHeaderPopover({
      anchor: box(111.05, 13.5, 28.05, 21),
      popover: { width: 202.2, height: 53 },
      anchorPosition: 'downCenter',
      viewport: { width: 560, height: 700 },
    });
    assert.equal(placed.position, 'bottom');
    assert.equal(placed.top, 42.5);
    assert.ok(Math.abs(placed.left - 23.975) < 0.001);
  });

  it('puts the tooltip of the home link under it, 16 pixels from the window’s edge', () => {
    // Asked for above, where there is no room; measured on the original at 16, 64
    const placed = placeHeaderTooltip({
      anchor: box(48, 0, 48, 48),
      tooltip: { width: 113.64, height: 26 },
      roundedWidth: 114,
      position: 'top',
      viewport,
      pageWidth: 1400,
    });
    assert.deepEqual({ ...placed, left: round(placed.left) }, { position: 'bottom', top: 64, left: 16 });
  });

  it('holds the tooltip of the help button by its right edge, as the original in the right half', () => {
    // Measured on the original: its left edge at 1343.66, which is 1400 - 14.17 - 42.17
    const placed = placeHeaderTooltip({
      anchor: helpButton,
      tooltip: { width: 42.17, height: 26 },
      roundedWidth: 42,
      position: 'bottom',
      viewport,
      pageWidth: 1400,
    });
    assert.equal(placed.position, 'bottom');
    assert.equal(placed.top, 64);
    assert.equal(placed.left, undefined);
    assert.equal(round(placed.right), 14.17);
  });
});

describe('what an application adds to the help menu', () => {
  it('adds the documentation of Dashboards, Visualize and Dev Tools, as the original', () => {
    assert.deepEqual(helpExtensionOf('/app/dashboards'), {
      appName: 'Dashboards',
      documentation: 'https://opensearch.org/docs/latest/dashboards/index/',
    });
    assert.equal(helpExtensionOf('/app/visualize')?.appName, 'Visualize');
    assert.equal(
      helpExtensionOf('/app/dev_tools')?.documentation,
      'https://opensearch.org/docs/latest/dashboards/dev-tools/index-dev/'
    );
  });

  it('adds nothing for the other applications', () => {
    for (const path of ['/app/home', '/app/discover', '/app/management', '/app/vis-builder', '/app/dashboards_x']) {
      assert.equal(helpExtensionOf(path), undefined, path);
    }
  });
});

describe('what the navigation keeps', () => {
  it('keeps a group open unless it was closed, under the original’s keys', () => {
    assert.equal(navGroupKey('recentlyViewed'), 'core.navGroup.recentlyViewed');
    assert.equal(isNavGroupOpen(null), true);
    assert.equal(isNavGroupOpen('true'), true);
    assert.equal(isNavGroupOpen('false'), false);
  });

  it('reads a recently viewed item out with the kind of page it is', () => {
    const targets = [
      { path: '/app/discover', title: 'Discover' },
      { path: '/app/dashboards', title: 'Dashboards' },
      { path: '/app/visualize', title: 'Visualize' },
    ];
    assert.equal(
      recentLinkTitle('[Logs] Web Traffic', '/app/dashboards#/view/edf84fe0', targets),
      '[Logs] Web Traffic, type: Dashboards'
    );
    assert.equal(
      recentLinkTitle('[Logs] Heatmap', '/app/visualize#/edit/935afa20', targets),
      '[Logs] Heatmap, type: Visualize'
    );
    // A page under no link of the navigation is its name alone
    assert.equal(recentLinkTitle('logs-*', '/app/management/opensearch-dashboards/indexPatterns', targets), 'logs-*');
  });
});

describe('where the links of the navigation lead', () => {
  const g = '(filters:!(),time:(from:now-7d,to:now))';

  it('keeps the place of Dashboards and Visualize under the original’s session keys', () => {
    assert.equal(trackedUrlKey('', TRACKED_APPS.dashboards), 'lastUrl::dashboard');
    assert.equal(trackedUrlKey('/proxy', TRACKED_APPS.visualize), 'lastUrl:/proxy:visualize');
  });

  it('leads to the list while the application is open, and back to where it was left after', () => {
    const dashboards = TRACKED_APPS.dashboards;
    assert.equal(
      trackedAppLink(dashboards, { current: true, stored: '#/view/a?_g=(x)', globalParam: g }),
      '/app/dashboards#/list'
    );
    assert.equal(
      trackedAppLink(dashboards, { current: false, stored: null, globalParam: undefined }),
      '/app/dashboards#/list'
    );
    assert.equal(
      trackedAppLink(dashboards, { current: false, stored: "#/view/a?_g=(time:(from:now-1h,to:now))&_a=(viewMode:view)", globalParam: g }),
      `/app/dashboards#/view/a?_g=${g}&_a=(viewMode:view)`
    );
    assert.equal(
      trackedAppLink(TRACKED_APPS.visualize, { current: false, stored: null, globalParam: g }),
      `/app/visualize#/?_g=${g}`
    );
  });

  it('puts the shared state in a fragment that has none', () => {
    assert.equal(withGlobalState('#/', undefined), '#/');
    assert.equal(withGlobalState('#/edit/x', '(a:1)'), '#/edit/x?_g=(a:1)');
  });
});

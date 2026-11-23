/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { isEmbedParamInHash, isModifiedClick, isUnderPath, navMode } from '../../web/shell/chrome_layout';
import { Navigation, type NavGroupItem, type NavigationProps } from '../../web/shell/navigation';

const count = (text: string, part: string) => text.split(part).length - 1;
const noop = () => undefined;

describe('how the navigation is shown', () => {
  it('docks for as long as it is set to and the window is wide enough, whatever the menu button says', () => {
    assert.equal(navMode({ locked: true, open: false, canDock: true }), 'docked');
    assert.equal(navMode({ locked: true, open: true, canDock: true }), 'docked');
  });

  it('lies over the page while the menu button has it open, in a window too narrow to dock in too', () => {
    assert.equal(navMode({ locked: false, open: true, canDock: true }), 'overlay');
    assert.equal(navMode({ locked: true, open: true, canDock: false }), 'overlay');
    assert.equal(navMode({ locked: false, open: false, canDock: true }), 'hidden');
    assert.equal(navMode({ locked: true, open: false, canDock: false }), 'hidden');
  });
});

describe('a page embedded in another', () => {
  it('is one whose hash has `embed` in its query, whatever its value and wherever it stands', () => {
    assert.equal(isEmbedParamInHash('#/view/edf84fe0?embed=true&_g=(filters:!())'), true);
    assert.equal(isEmbedParamInHash('#/view/edf84fe0?_g=(filters:!())&embed=true'), true);
    assert.equal(isEmbedParamInHash('#/view/edf84fe0?embed=false'), true);
    assert.equal(isEmbedParamInHash('#/view/edf84fe0?embed'), true);
    assert.equal(isEmbedParamInHash('#/edit/a1b2?embed=true&show-top-menu=true'), true);
  });

  it('is not one without that parameter in the hash', () => {
    assert.equal(isEmbedParamInHash(''), false);
    assert.equal(isEmbedParamInHash('#'), false);
    assert.equal(isEmbedParamInHash('#/view/edf84fe0'), false);
    assert.equal(isEmbedParamInHash('#/view/edf84fe0?embedded=true&show-top-menu=true'), false);
    assert.equal(isEmbedParamInHash('#/embed/edf84fe0'), false);
    // After a second "#", where the address no longer has a query
    assert.equal(isEmbedParamInHash('#/view/edf84fe0?_g=()#?embed=true'), false);
  });

  it('is not one when the hash is no address at all, where the original fails to start', () => {
    assert.equal(isEmbedParamInHash('#//'), false);
  });
});

describe('what a link of the navigation does', () => {
  const click = { metaKey: false, altKey: false, ctrlKey: false, shiftKey: false, defaultPrevented: false };

  it('closes the navigation on a plain click, and leaves a click with a key held to the browser', () => {
    assert.equal(isModifiedClick(click), false);
    for (const key of ['metaKey', 'altKey', 'ctrlKey', 'shiftKey', 'defaultPrevented'] as const) {
      assert.equal(isModifiedClick({ ...click, [key]: true }), true, key);
    }
  });

  it('is marked while the page is the application or one of its pages', () => {
    assert.equal(isUnderPath('/app/dashboards', '/app/dashboards'), true);
    assert.equal(isUnderPath('/app/management/opensearch-dashboards/indexPatterns', '/app/management'), true);
    assert.equal(isUnderPath('/app/dashboards_x', '/app/dashboards'), false);
    assert.equal(isUnderPath('/app/dashboard', '/app/dashboards'), false);
  });
});

describe('the navigation, drawn docked', () => {
  const groups: NavGroupItem[] = [
    {
      id: 'opensearchDashboards',
      label: 'InfraDashboard',
      links: [
        { id: 'discover', label: 'Discover', href: '/app/discover#/', active: true },
        { id: 'visualize', label: 'Visualize', href: '/app/visualize#/' },
      ],
    },
    { id: 'management', label: 'Management', links: [{ id: 'dev_tools', label: 'Dev Tools', href: '/app/dev_tools' }] },
  ];
  const draw = (props: Partial<NavigationProps> = {}) =>
    renderToStaticMarkup(
      <Navigation
        id="nav"
        docked
        locked
        canDock
        recent={[]}
        groups={groups}
        onClose={noop}
        onLockedChange={noop}
        {...props}
      />
    );

  it('is the original’s primary navigation, beside the page without the button that closes it', () => {
    const out = draw();
    assert.match(out, /^<nav id="nav" class="shlNav shlNav--docked" aria-label="Primary" tabindex="-1" data-test-subj="collapsibleNav">/);
    assert.equal(count(out, 'euiFlyoutCloseButton'), 0);
  });

  it('holds what was viewed lately, a rule, then a group for each category with its links', () => {
    const out = draw();
    const recent = out.indexOf('data-test-subj="collapsibleNavGroup-recentlyViewed"');
    const rule = out.indexOf('<hr class="shlNav__rule"/>');
    const first = out.indexOf('data-test-subj="collapsibleNavGroup-opensearchDashboards"');
    const management = out.indexOf('data-test-subj="collapsibleNavGroup-management"');
    assert.ok(recent >= 0 && recent < rule && rule < first && first < management);
    assert.match(out, /<p>No recently viewed items<\/p>/);
    assert.match(out, /<h3 id="[^"]*__title" class="shlNavGroup__title">InfraDashboard<\/h3>/);
    assert.match(out, /<ul class="shlNavList" aria-label="Primary navigation links, InfraDashboard">/);
    assert.match(out, /<ul class="shlNavList" aria-label="Primary navigation links, Management">/);
    assert.equal(count(out, 'data-test-subj="collapsibleNavAppLink"'), 3);
    // Each heading opens and closes what follows it, and says so; all start open
    assert.equal(count(out, 'aria-expanded="true"'), 3);
    assert.equal(count(out, 'role="region"'), 3);
  });

  it('marks the application that is open, and draws each link as the original: its label titled', () => {
    const out = draw();
    assert.equal(count(out, 'shlNavItem--active'), 1);
    assert.match(
      out,
      /<li class="shlNavItem shlNavItem--active"><a class="shlNavItem__button" href="\/app\/discover#\/" rel="noreferrer" data-test-subj="collapsibleNavAppLink"><span class="shlNavItem__label" title="Discover">Discover<\/span><\/a><\/li>/
    );
  });

  it('lists what was viewed lately, each read out with the kind of page it is', () => {
    const out = draw({
      recent: [
        {
          id: 'edf84fe0',
          label: '[Logs] Web Traffic',
          href: '/app/dashboards#/view/edf84fe0',
          title: '[Logs] Web Traffic, type: Dashboards',
        },
      ],
    });
    assert.equal(count(out, 'No recently viewed items'), 0);
    assert.match(out, /<ul class="shlNavList shlNavList--recents" aria-label="Recently viewed links">/);
    assert.match(
      out,
      /<a class="shlNavItem__button" href="\/app\/dashboards#\/view\/edf84fe0" rel="noreferrer" title="\[Logs\] Web Traffic, type: Dashboards" aria-label="\[Logs\] Web Traffic, type: Dashboards" data-test-subj="collapsibleNavAppLink--recent"><span class="shlNavItem__label" title="\[Logs\] Web Traffic">/
    );
  });

  it('offers to undock while docked and to dock otherwise, only in a window wide enough to dock in', () => {
    const docked = draw();
    assert.match(docked, /aria-label="Undock primary navigation" data-test-subj="collapsible-nav-lock">/);
    assert.match(docked, /<span class="shlNavItem__label" title="Undock navigation">Undock navigation<\/span>/);
    const undocked = draw({ locked: false });
    assert.match(undocked, /aria-label="Dock primary navigation" data-test-subj="collapsible-nav-lock">/);
    assert.match(undocked, />Dock navigation<\/span>/);
    assert.equal(count(draw({ canDock: false }), 'collapsible-nav-lock'), 0);
  });
});

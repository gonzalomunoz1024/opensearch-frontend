/* SPDX-License-Identifier: Apache-2.0 */

/*
 * What one app hands another with the address, as the original's `navigateToApp(appId, { path,
 * state })` does: the entry of the history carries it, a replaced address keeps it, and the app
 * that reads it can drop it so that a reload does not hand it over again.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  getLocation,
  locationState,
  navigate,
  setLocationState,
  startRouter,
} from '../../web/router';

interface Entry {
  url: string;
  state: unknown;
}

// A browser's history and location, as far as the router uses them
function fakeBrowser(start: string) {
  const entries: Entry[] = [{ url: start, state: null }];
  let index = 0;
  const location = { pathname: '', search: '', hash: '', href: '' };
  const show = () => {
    const url = new URL(entries[index].url, 'http://localhost:5601');
    const { pathname, search, hash, href } = url;
    Object.assign(location, { pathname, search, hash, href });
  };
  show();
  const history = {
    get state() {
      return entries[index].state;
    },
    pushState(state: unknown, _title: string, url: string) {
      entries.splice(index + 1, entries.length, { url, state });
      index += 1;
      show();
    },
    replaceState(state: unknown, _title: string, url: string) {
      const next = new URL(url, location.href);
      entries[index] = { url: `${next.pathname}${next.search}${next.hash}`, state };
      show();
    },
  };
  const back = () => {
    index -= 1;
    show();
  };
  return { entries, location, history, back };
}

function withBrowser(start: string, run: (browser: ReturnType<typeof fakeBrowser>) => void) {
  const browser = fakeBrowser(start);
  const globals = globalThis as { window?: unknown; document?: unknown };
  const { location, history } = browser;
  globals.window = { location, history, addEventListener: () => undefined };
  globals.document = { addEventListener: () => undefined };
  try {
    startRouter('');
    run(browser);
  } finally {
    delete globals.window;
    delete globals.document;
  }
}

describe('the state an address carries', () => {
  it('goes with a new entry of the history, and not with the next one', () =>
    withBrowser('/app/visualize#/edit/1', (browser) => {
      const handed = {
        type: 'visualization',
        input: { savedObjectId: '1' },
        embeddableId: 'panel-1',
      };
      navigate('/app/dashboards#/view/d1', { state: handed });
      assert.deepEqual(locationState(), handed);
      assert.equal(getLocation().pathname, '/app/dashboards');
      navigate('/app/discover#/');
      assert.equal(locationState(), undefined);
      browser.back();
      assert.deepEqual(locationState(), handed);
    }));

  it('is kept when the address is replaced, unless other state is given', () =>
    withBrowser('/app/dashboards#/create', () => {
      navigate('/app/dashboards#/view/d1', { state: { originatingApp: 'dashboards' } });
      navigate('/app/dashboards#/view/d1?_g=(time:(from:now-7d,to:now))', { replace: true });
      assert.deepEqual(locationState(), { originatingApp: 'dashboards' });
      assert.equal(getLocation().hashParams._g, '(time:(from:now-7d,to:now))');
      navigate('/app/dashboards#/view/d1', { replace: true, state: { other: true } });
      assert.deepEqual(locationState(), { other: true });
    }));

  it('can be handed to the address the browser is at, and dropped once read', () =>
    withBrowser('/app/dashboards#/view/d1', (browser) => {
      const before = getLocation();
      navigate('/app/dashboards#/view/d1', { state: { type: 'visualization' } });
      assert.deepEqual(locationState(), { type: 'visualization' });
      assert.equal(browser.entries.length, 1);
      assert.notEqual(getLocation(), before, 'the pages read the location again');
      setLocationState(undefined);
      assert.equal(locationState(), undefined);
      assert.equal(browser.location.hash, '#/view/d1');
    }));
});

/* SPDX-License-Identifier: Apache-2.0 */

/*
 * What asks before a page is left, as the original's `onAppLeave` handlers are asked: it is told
 * whether the page goes to another application, may answer later (once a question it draws is
 * answered), is not asked for a move the page forces, and answers the browser's own question
 * when the tab is closed or reloaded. And where each application was last, which an editor goes
 * back to as the original's URL tracker has it.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  enteredAnotherApplication,
  getLocation,
  lastAddressOf,
  locationState,
  navigate,
  setLeaveGuard,
  startRouter,
  type LeaveTarget,
} from '../../web/router';

interface Entry {
  url: string;
  state: unknown;
}

interface UnloadEvent {
  prevented: boolean;
  returnValue: unknown;
  preventDefault: () => void;
}

// A browser's history, location and window listeners, as far as the router uses them
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
  const listeners: Record<string, (event: UnloadEvent) => void> = {};
  const unload = (): UnloadEvent => {
    const event: UnloadEvent = {
      prevented: false,
      returnValue: undefined,
      preventDefault() {
        event.prevented = true;
      },
    };
    listeners.beforeunload?.(event);
    return event;
  };
  return { entries, location, history, listeners, unload };
}

/** What a page keeps for the session, as far as the router uses it */
interface Storage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

function fakeStorage(): Storage & { items: Record<string, string> } {
  const items: Record<string, string> = {};
  return {
    items,
    getItem: (key) => (key in items ? items[key] : null),
    setItem: (key, value) => {
      items[key] = value;
    },
  };
}

async function withBrowser(
  start: string,
  base: string,
  run: (browser: ReturnType<typeof fakeBrowser>) => Promise<void> | void,
  sessionStorage?: Storage
) {
  const browser = fakeBrowser(start);
  const globals = globalThis as { window?: unknown; document?: unknown };
  const { location, history, listeners } = browser;
  globals.window = {
    location,
    history,
    sessionStorage,
    addEventListener: (type: string, listener: (event: UnloadEvent) => void) => {
      listeners[type] = listener;
    },
  };
  globals.document = { addEventListener: () => undefined };
  try {
    startRouter(base);
    await run(browser);
  } finally {
    setLeaveGuard(undefined);
    delete globals.window;
    delete globals.document;
  }
}

// What a promise's callbacks run after
const settled = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('the question asked before a page is left', () => {
  it('is told where the page goes, and whether that is another application', () =>
    withBrowser('/app/visualize#/edit/v1', '', () => {
      const asked: LeaveTarget[] = [];
      setLeaveGuard((target) => {
        asked.push(target);
        return true;
      });
      // The same page with another state is not left
      navigate('/app/visualize#/edit/v1?_a=(linked:!f)');
      assert.equal(asked.length, 0);
      navigate('/app/visualize#/');
      navigate('/app/dashboards#/view/d1');
      assert.deepEqual(asked, [
        { url: '/app/visualize#/', leavesApp: false },
        { url: '/app/dashboards#/view/d1', leavesApp: true },
      ]);
      assert.equal(getLocation().pathname, '/app/dashboards');
    }));

  it('tells the application apart behind a base path', () =>
    withBrowser('/base/app/visualize#/edit/v1', '/base', () => {
      const asked: boolean[] = [];
      setLeaveGuard((target) => {
        asked.push(target.leavesApp);
        return true;
      });
      navigate('/app/visualize#/');
      navigate('/app/dashboards#/');
      assert.deepEqual(asked, [false, true]);
    }));

  it('waits for an answer drawn by the page, and goes only once it is yes', () =>
    withBrowser('/app/visualize#/edit/v1', '', async (browser) => {
      let answer: (leave: boolean) => void = () => undefined;
      setLeaveGuard(
        () =>
          new Promise<boolean>((resolve) => {
            answer = resolve;
          })
      );
      navigate('/app/dashboards#/view/d1', { state: { type: 'visualization' } });
      await settled();
      assert.equal(getLocation().pathname, '/app/visualize', 'nothing moves while the question is open');
      answer(false);
      await settled();
      assert.equal(getLocation().pathname, '/app/visualize');
      assert.equal(browser.entries.length, 1);

      navigate('/app/dashboards#/view/d1', { state: { type: 'visualization' } });
      answer(true);
      await settled();
      assert.equal(getLocation().pathname, '/app/dashboards');
      assert.deepEqual(locationState(), { type: 'visualization' }, 'what is handed over goes with the move');
      assert.equal(browser.entries.length, 2);
    }));

  it('stays at once on a plain no, and is not asked for a forced move', () =>
    withBrowser('/app/visualize#/edit/v1', '', () => {
      let asked = 0;
      setLeaveGuard(() => {
        asked += 1;
        return false;
      });
      navigate('/app/dashboards#/view/d1');
      assert.equal(getLocation().pathname, '/app/visualize');
      navigate('/app/dashboards#/view/d1', { force: true });
      assert.equal(getLocation().pathname, '/app/dashboards');
      assert.equal(asked, 1);
    }));

  it('answers the browser when the tab is closed, while the page has a question', () =>
    withBrowser('/app/visualize#/edit/v1', '', (browser) => {
      let question: string | undefined = 'Leave Visualize editor with unsaved changes?';
      assert.equal(browser.unload().prevented, false, 'no guard, no question');
      setLeaveGuard(
        () => true,
        () => question
      );
      const asked = browser.unload();
      assert.equal(asked.prevented, true);
      assert.equal(asked.returnValue, 'Leave Visualize editor with unsaved changes?');
      question = undefined;
      assert.equal(browser.unload().prevented, false, 'nothing to ask now');
      question = 'again';
      setLeaveGuard(undefined);
      assert.equal(browser.unload().prevented, false, 'the guard is gone');
      // A guard of its own (the dashboard's) asks the browser nothing
      setLeaveGuard(() => true);
      assert.equal(browser.unload().prevented, false);
    }));
});

describe('where each application was last', () => {
  const G7 = '(time:(from:now-7d,to:now))';
  const G1 = '(time:(from:now-1d,to:now))';

  it("is kept for the session under the original's keys, as the fragment the application was at", () => {
    const storage = fakeStorage();
    return withBrowser(
      `/base/app/dashboards#/view/d1?_g=${G7}&_a=(viewMode:view)`,
      '/base',
      () => {
        assert.equal(storage.items['lastUrl:/base:dashboard'], `#/view/d1?_g=${G7}&_a=(viewMode:view)`);
        assert.equal(lastAddressOf('dashboards'), `/app/dashboards#/view/d1?_g=${G7}&_a=(viewMode:view)`, 'without the base path');
        // What is replaced in the application is where it is
        navigate(`/app/dashboards#/view/d1?_g=${G7}&_a=(panels:!(),viewMode:edit)`, { replace: true });
        assert.equal(storage.items['lastUrl:/base:dashboard'], `#/view/d1?_g=${G7}&_a=(panels:!(),viewMode:edit)`);
        // Another application opens: the dashboards stay where they were
        navigate(`/app/visualize#/edit/v1?_g=${G7}`, { state: { originatingApp: 'dashboards' } });
        navigate(`/app/visualize#/edit/v1?_g=${G7}&_a=(linked:!f)`, { replace: true });
        assert.equal(storage.items['lastUrl:/base:visualize'], `#/edit/v1?_g=${G7}&_a=(linked:!f)`);
        assert.equal(lastAddressOf('dashboards'), `/app/dashboards#/view/d1?_g=${G7}&_a=(panels:!(),viewMode:edit)`);
      },
      storage
    );
  });

  it('follows the time range of now while the application is not open, and nothing else changes in it', () => {
    const storage = fakeStorage();
    return withBrowser(
      `/app/dashboards#/view/d1?_g=${G7}&_a=(query:(language:kuery,query:'bytes > 100'),viewMode:edit)`,
      '',
      () => {
        // The applications that are not open take the `_g` of the address, from their start
        assert.equal(storage.items['lastUrl::visualize'], `#/?_g=${G7}`);
        assert.equal(storage.items['lastUrl::vis-builder'], `#/?_g=${G7}`);
        assert.equal(storage.items['lastUrl::data-explorer'], `#/?_g=${G7}`);
        navigate(`/app/visualize#/edit/v1?_g=${G7}`);
        assert.equal(storage.items['lastUrl::dashboard'], `#/view/d1?_g=${G7}&_a=(query:(language:kuery,query:'bytes%20%3E%20100'),viewMode:edit)`);
        // The time range changes in the editor: the dashboards will open with it
        navigate(`/app/visualize#/edit/v1?_g=${G1}`, { replace: true });
        assert.equal(
          lastAddressOf('dashboards'),
          `/app/dashboards#/view/d1?_g=${G1}&_a=(query:(language:kuery,query:'bytes%20%3E%20100'),viewMode:edit)`
        );
        assert.equal(storage.items['lastUrl::visualize'], `#/edit/v1?_g=${G1}`, 'the application that is open is where it is');
        assert.equal(storage.items['lastUrl::data-explorer'], `#/?_g=${G1}`);
      },
      storage
    );
  });

  it('is still known when the page was loaded again, as the storage of the session keeps it', async () => {
    const storage = fakeStorage();
    await withBrowser(`/app/dashboards#/view/d1?_g=${G7}&_a=(viewMode:edit)`, '', () => navigate(`/app/visualize#/edit/v1?_g=${G7}`), storage);
    // The page loads again in the editor
    await withBrowser(
      `/app/visualize#/edit/v1?_g=${G7}`,
      '',
      () => assert.equal(lastAddressOf('dashboards'), `/app/dashboards#/view/d1?_g=${G7}&_a=(viewMode:edit)`),
      storage
    );
  });

  it('starts at the place the original opens an application at, and at the root of one it does not track', () =>
    withBrowser('/app/home', '', () => {
      assert.equal(lastAddressOf('dashboards'), '/app/dashboards#/list');
      assert.equal(lastAddressOf('visualize'), '/app/visualize#/');
      assert.equal(lastAddressOf('canvas'), '/app/canvas');
      // An address without a fragment is no place to come back to
      navigate('/app/dashboards');
      assert.equal(lastAddressOf('dashboards'), '/app/dashboards#/list');
    }));

  it('lasts as long as the page in a browser that keeps nothing', () =>
    withBrowser(
      `/app/dashboards#/view/d1?_g=${G7}&_a=(viewMode:edit)`,
      '',
      () => {
        navigate(`/app/visualize#/edit/v1?_g=${G1}`);
        assert.equal(lastAddressOf('dashboards'), `/app/dashboards#/view/d1?_g=${G1}&_a=(viewMode:edit)`);
      },
      {
        getItem: () => {
          throw new Error('storage is off');
        },
        setItem: () => {
          throw new Error('storage is off');
        },
      }
    ));

  it('knows the first address of an application, where the original sets the title back to the name', () =>
    withBrowser('/app/visualize#/', '', (browser) => {
      assert.equal(enteredAnotherApplication(), true, 'as the page loads');
      navigate('/app/visualize#/create?type=markdown');
      assert.equal(enteredAnotherApplication(), false, 'a page of the same application');
      navigate('/app/visualize#/create?type=markdown&_a=(vis:(title:x))', { replace: true });
      assert.equal(enteredAnotherApplication(), false);
      navigate('/app/dashboards#/view/d1');
      assert.equal(enteredAnotherApplication(), true, 'another application');
      // Its second name is the same application
      navigate('/app/dashboard#/view/d1?_a=(viewMode:edit)');
      assert.equal(enteredAnotherApplication(), false);
      navigate('/app/visualize#/edit/v1');
      assert.equal(enteredAnotherApplication(), true);
      navigate('/app/visualize#/edit/v1?_a=(uiState:())', { replace: true });
      assert.equal(enteredAnotherApplication(), false);
      // The page loaded again at the same address: its first one
      browser.history.replaceState(null, '', '/app/visualize#/edit/v1?_a=(uiState:())');
      startRouter('');
      assert.equal(enteredAnotherApplication(), true, 'a page loaded again');
    }));

  it('takes the second address this product opens the dashboards at for the dashboards', () => {
    const storage = fakeStorage();
    return withBrowser(
      `/app/dashboard#/view/d1?_g=${G7}&_a=(viewMode:edit)`,
      '',
      () => {
        assert.equal(storage.items['lastUrl::dashboard'], `#/view/d1?_g=${G7}&_a=(viewMode:edit)`);
        assert.equal(lastAddressOf('dashboards'), `/app/dashboards#/view/d1?_g=${G7}&_a=(viewMode:edit)`);
      },
      storage
    );
  });
});

/* SPDX-License-Identifier: Apache-2.0 */

/*
 * What asks before a page is left, as the original's `onAppLeave` handlers are asked: it is told
 * whether the page goes to another application, may answer later (once a question it draws is
 * answered), is not asked for a move the page forces, and answers the browser's own question
 * when the tab is closed or reloaded.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getLocation, locationState, navigate, setLeaveGuard, startRouter, type LeaveTarget } from '../../web/router';

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

async function withBrowser(start: string, base: string, run: (browser: ReturnType<typeof fakeBrowser>) => Promise<void> | void) {
  const browser = fakeBrowser(start);
  const globals = globalThis as { window?: unknown; document?: unknown };
  const { location, history, listeners } = browser;
  globals.window = {
    location,
    history,
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

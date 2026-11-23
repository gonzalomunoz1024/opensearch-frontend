/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Discover's state in the address, written as the original's is: in place. The reference keeps
 * history.length at 2 after a sort, an interval, columns added, moved and removed, a query, a
 * filter and another index pattern, and Back then leaves Discover.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { writeDiscoverState } from '../../web/apps/discover/app_state';
import { encodeState } from '../../web/lib/url';
import { getLocation, startRouter } from '../../web/router';

// A browser's history and location, as far as the router uses them
function withBrowser(start: string, run: (entries: string[]) => void) {
  const entries: string[] = [start];
  let index = 0;
  const location = { pathname: '', search: '', hash: '', href: '' };
  const show = () => {
    const { pathname, search, hash, href } = new URL(entries[index], 'http://localhost:5601');
    Object.assign(location, { pathname, search, hash, href });
  };
  show();
  const history = {
    state: null,
    pushState(_state: unknown, _title: string, url: string) {
      entries.splice(index + 1, entries.length, url);
      index += 1;
      show();
    },
    replaceState(_state: unknown, _title: string, url: string) {
      const next = new URL(url, location.href);
      entries[index] = `${next.pathname}${next.search}${next.hash}`;
      show();
    },
  };
  const globals = globalThis as { window?: unknown; document?: unknown };
  globals.window = { location, history, addEventListener: () => undefined };
  globals.document = { addEventListener: () => undefined };
  try {
    startRouter('');
    run(entries);
  } finally {
    delete globals.window;
    delete globals.document;
  }
}

describe("Discover's state in the address", () => {
  it('replaces the entry of the history, so that Back leaves Discover', () => {
    const g = encodeState({ time: { from: 'now-15m', to: 'now' } });
    withBrowser(`/app/data-explorer/discover#/?_g=${encodeURIComponent(g)}`, (entries) => {
      const app = (sort: unknown) =>
        encodeState({ discover: { columns: ['bytes'], isDirty: false, sort }, metadata: { indexPattern: 'logs', view: 'discover' } });
      const query = encodeState({ filters: [], query: { language: 'kuery', query: 'response:404' } });
      writeDiscoverState({ _a: app([]) });
      writeDiscoverState({ _q: query });
      writeDiscoverState({ _a: app([['bytes', 'desc']]) });
      assert.equal(entries.length, 1);
      const { hashPath, hashParams } = getLocation();
      assert.equal(hashPath, '/');
      assert.deepEqual(hashParams, { _g: g, _a: app([['bytes', 'desc']]), _q: query });
    });
  });
});

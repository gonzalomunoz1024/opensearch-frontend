/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Discover's state in the address, written as the original's is: in place. The reference keeps
 * history.length at 2 after a sort, an interval, columns added, moved and removed, a query, a
 * filter and another index pattern, and Back then leaves Discover.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { appStateParam, columnToggled, openingAppState, writeDiscoverState } from '../../web/apps/discover/app_state';
import { decodeState, encodeState } from '../../web/lib/url';
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

  it('opens without an `_a` as the reference writes it then, for Discover and for a saved search', () => {
    // The reference's, for the bare `#/` and for `#/view/zz-agent-dsc-csv-search`
    assert.deepEqual(decodeState(appStateParam(openingAppState(undefined, ['_source'], 'ff959d40-b880-11e8-a6d9-e546fe2bba5f'))), {
      discover: { columns: ['_source'], isDirty: false, sort: [] },
      metadata: { indexPattern: 'ff959d40-b880-11e8-a6d9-e546fe2bba5f', view: 'discover' },
    });
    const saved = {
      id: 'zz-agent-dsc-csv-search',
      columns: ['bytes', 'extension', 'machine.os'],
      sort: [['bytes', 'desc']],
      indexId: '90943e30-9a47-11e8-b64d-95841ca0b247',
    };
    assert.deepEqual(decodeState(appStateParam(openingAppState(saved, ['_source'], 'ff959d40-b880-11e8-a6d9-e546fe2bba5f'))), {
      discover: { columns: ['bytes', 'extension', 'machine.os'], isDirty: false, savedSearch: 'zz-agent-dsc-csv-search', sort: [['bytes', 'desc']] },
      metadata: { indexPattern: '90943e30-9a47-11e8-b64d-95841ca0b247', view: 'discover' },
    });
    // A saved search without columns or sort has none, as the original's defaults
    assert.deepEqual(openingAppState({ id: 's' }, ['_source'], 'p'), { columns: [], sort: [], isDirty: false, savedSearch: 's', indexPattern: undefined });
  });

  it('keeps the interval, the saved query and the saved search beside the columns', () => {
    const state = { columns: ['bytes'], sort: [], interval: 'h', isDirty: true, savedQuery: 'q1', savedSearch: 's1', indexPattern: 'p' };
    assert.deepEqual(decodeState(appStateParam(state)), {
      discover: { columns: ['bytes'], interval: 'h', isDirty: true, savedQuery: 'q1', savedSearch: 's1', sort: [] },
      metadata: { indexPattern: 'p', view: 'discover' },
    });
  });

  it('makes the state dirty when a column is taken out, with its sort, and not when one is added', () => {
    const sort: Array<[string, 'asc' | 'desc']> = [
      ['timestamp', 'desc'],
      ['bytes', 'asc'],
    ];
    assert.deepEqual(columnToggled(['bytes'], sort, 'extension'), { columns: ['bytes', 'extension'] });
    assert.deepEqual(columnToggled(['extension', 'bytes'], sort, 'bytes'), {
      columns: ['extension'],
      sort: [['timestamp', 'desc']],
      isDirty: true,
    });
    // The last one taken out leaves the source
    assert.deepEqual(columnToggled(['bytes'], [], 'bytes'), { columns: ['_source'], sort: [], isDirty: true });
    assert.deepEqual(columnToggled(['_source'], [], 'bytes'), { columns: ['bytes'] });
  });
});

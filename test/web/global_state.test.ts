/* SPDX-License-Identifier: Apache-2.0 */

/*
 * What the `_g` of an address stands for, as the original's query state reads it
 * (connect_to_query_state.ts): a range whose ends are not both dates is searched and shown as the
 * default one, `timepicker:timeDefaults`, and the address keeps it until the range itself changes.
 * And the language a new query is written in (query_string_manager.ts resolveDefaultLanguage).
 */

process.env.TZ = 'UTC';

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decodeState } from '../../web/lib/url';
import { startRouter } from '../../web/router';
import { createServices, type BootData } from '../../web/services';
import { defaultQueryLanguage, rememberQueryLanguage } from '../../web/shell/query_bar';
import { globalParamWith, globalStateOf } from '../../web/shell/state';

// A page at an address, as far as the router reads it
function atAddress(address: string, run: () => void) {
  const url = new URL(address, 'http://localhost:5601');
  const location = { pathname: url.pathname, search: url.search, hash: url.hash, href: url.href };
  const history = { state: null, pushState: () => undefined, replaceState: () => undefined };
  const globals = globalThis as { window?: unknown; document?: unknown };
  globals.window = { location, history, addEventListener: () => undefined };
  globals.document = { addEventListener: () => undefined };
  try {
    startRouter('');
    run();
  } finally {
    delete globals.window;
    delete globals.document;
  }
}

function servicesWith(settings: Record<string, unknown>) {
  const boot = { basePath: '', version: '3.9.0', name: 'test', settings, settingsDefaults: {}, settingsOverrides: {} };
  createServices(boot as unknown as BootData);
}

describe('the time range of the address', () => {
  it('is the default range while its ends are not both dates', () => {
    servicesWith({ 'timepicker:timeDefaults': '{ "from": "now-7d", "to": "now" }' });
    const defaults = { from: 'now-7d', to: 'now' };
    for (const time of ['(from:banana,to:now)', '(from:now-1y)', "(from:'2026-02-30T00:00:00.000Z',to:now)", '(from:now-5x,to:now)', "(from:'',to:now)"]) {
      assert.deepEqual(globalStateOf(`(time:${time})`).time, defaults, time);
    }
    assert.deepEqual(globalStateOf(undefined).time, defaults);
    assert.deepEqual(globalStateOf('(time:(from:now-1y,to:now))').time, { from: 'now-1y', to: 'now' });
    // The wrong way round it is still a range, which the picker says it cannot apply
    assert.deepEqual(globalStateOf('(time:(from:now,to:now-1d))').time, { from: 'now', to: 'now-1d' });
  });

  it('stays in the address as it is until the range itself changes', () =>
    atAddress('/app/data-explorer/discover#/?_g=(filters:!(),time:(from:banana,to:now))', () => {
      servicesWith({});
      const interval = decodeState<Record<string, unknown>>(globalParamWith({ refreshInterval: { pause: false, value: 5000 } }));
      assert.deepEqual(interval.time, { from: 'banana', to: 'now' });
      assert.deepEqual(interval.refreshInterval, { pause: false, value: 5000 });
      const range = decodeState<Record<string, unknown>>(globalParamWith({ time: { from: 'now-1h', to: 'now' } }));
      assert.deepEqual(range.time, { from: 'now-1h', to: 'now' });
    }));
});

describe('the language a new query is written in', () => {
  it('is the one made the user\'s last, else the setting, else DQL, as the original resolves it', () => {
    const stored = new Map<string, string>();
    const localStorage = {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => void stored.set(key, value),
    };
    const globals = globalThis as { window?: unknown };
    globals.window = { localStorage };
    try {
      servicesWith({});
      assert.equal(defaultQueryLanguage(), 'kuery');
      servicesWith({ 'search:queryLanguage': 'lucene' });
      assert.equal(defaultQueryLanguage(), 'lucene');
      rememberQueryLanguage('kuery');
      assert.equal(defaultQueryLanguage(), 'kuery');
      rememberQueryLanguage('lucene');
      servicesWith({});
      assert.equal(defaultQueryLanguage(), 'lucene');
    } finally {
      delete globals.window;
    }
  });
});

/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The home page and the overview as the original's home plugin keeps them: the address its hash
 * router gives them.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { slashHash } from '../../web/apps/home_address';
import { getLocation, startRouter } from '../../web/router';

// A browser's history and location, as far as the router uses them: the addresses of its entries
function withBrowser(start: string, run: (entries: string[]) => void) {
  const entries = [start];
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
      entries[index] = url;
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

describe('the address of the home page and of the overview', () => {
  it('is given "#/" where it is, as the original\'s hash router gives it', () => {
    withBrowser('/app/home', (entries) => {
      slashHash();
      assert.deepEqual(entries, ['/app/home#/']);
      assert.equal(getLocation().hashPath, '/');
    });
    withBrowser('/app/opensearch_dashboards_overview?embed=true', (entries) => {
      slashHash();
      assert.deepEqual(entries, ['/app/opensearch_dashboards_overview?embed=true#/']);
    });
  });

  it('is left as it is when it has a fragment', () => {
    withBrowser('/app/home#/tutorial_directory', (entries) => {
      slashHash();
      assert.deepEqual(entries, ['/app/home#/tutorial_directory']);
    });
  });
});

/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The name the query bar goes by, as the original's query string input takes it from its
 * services' `appName`: in its labels and in the key its recent searches are kept under.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServices, type BootData } from '../../web/services';
import { QueryBar, addRecentSearch } from '../../web/shell/query_bar';

const noop = () => undefined;

describe('the name of the query bar', () => {
  it('is the one its page gives, as TSVB names its field the VisEditor', () => {
    const out = renderToStaticMarkup(
      <QueryBar
        appName="VisEditor"
        value=""
        language="kuery"
        onChange={noop}
        onLanguageChange={noop}
        onSubmit={noop}
        indexPatterns={[]}
      />
    );
    assert.match(out, /role="combobox" aria-label="Search and filter the VisEditor page"/);
    assert.match(out, /aria-label="Start typing to search and filter the VisEditor page"/);
  });

  it('keeps the searches made in it under that name and the language', () => {
    const stored = new Map<string, string>();
    const localStorage = {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => void stored.set(key, value),
    };
    const boot = { basePath: '', version: '3.9.0', name: 'test', settings: {}, settingsDefaults: {}, settingsOverrides: {} };
    createServices(boot as unknown as BootData);
    const globals = globalThis as { window?: unknown };
    globals.window = { localStorage };
    try {
      addRecentSearch('kuery', 'machine.os:win*', 'VisEditor');
      addRecentSearch('lucene', 'bytes:>100', 'VisEditor');
      assert.equal(stored.get('infradashboard:typeahead:VisEditor-kuery'), '["machine.os:win*"]');
      assert.equal(stored.get('infradashboard:typeahead:VisEditor-lucene'), '["bytes:>100"]');
    } finally {
      delete globals.window;
    }
  });
});

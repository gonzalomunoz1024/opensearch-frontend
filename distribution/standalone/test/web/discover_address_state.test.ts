/* SPDX-License-Identifier: Apache-2.0 */

/*
 * What Discover makes of an address it did not write, as the reference was measured to: an `_a` or
 * `_q` that cannot be read (a toast "Error restoring state from URL", and the default state
 * written), an `_a` that is no object, an index pattern id that names none (Discover stays, with
 * "Select a data source" and "Select data"), an interval that is no text (`{val:d}` by the day,
 * `{a:1}` as auto) and columns that are no list, or an empty one (the sidebar lists nothing as
 * selected, and nothing at all for no list; the table shows the whole source).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RESTORE_ERROR_TITLE, isAppState, stateColumnNames, stateReadError } from '../../web/apps/discover/app_state';
import { buildDiscoverRequest, stateInterval } from '../../web/apps/discover/search';
import { SelectData } from '../../web/apps/discover/select_data';
import { NO_FILTER, Sidebar, groupFields } from '../../web/apps/discover/sidebar';
import type { Field, IndexPattern } from '../../web/lib/types';
import { createServices, type BootData } from '../../web/services';

const field = (name: string, type: string): Field => ({ name, type, searchable: true, aggregatable: type !== '_source' });
const fields = [field('_source', '_source'), field('bytes', 'number'), field('extension', 'string'), field('timestamp', 'date')];
const logs: IndexPattern = { id: 'logs', title: 'logs', timeFieldName: 'timestamp', fields, fieldFormatMap: {} };
const range = { from: new Date('2026-11-15T00:00:00.000Z'), to: new Date('2026-11-29T00:00:00.000Z') };

describe('a state of the address that cannot be read', () => {
  it("is told in the words of the original's rison reader, under the original's title", () => {
    assert.equal(RESTORE_ERROR_TITLE, 'Error restoring state from URL');
    // The words the reference's message gave for these addresses
    assert.equal(stateReadError('(discover:(columns:!(_source)')?.message, "Cannot read properties of null (reading 'length')");
    assert.equal(stateReadError("(query:(language:kuery,query:'x')")?.message, "Cannot read properties of null (reading 'length')");
    assert.match(stateReadError("(filters:!(),query:(language:kuery,query:'response:404))")?.message ?? '', /^rison decoder error: /);
  });

  it('is none when the text reads, or there is none', () => {
    assert.equal(stateReadError(undefined), undefined);
    assert.equal(stateReadError(''), undefined);
    assert.equal(stateReadError('(discover:(columns:!(_source)))'), undefined);
    assert.equal(stateReadError('!(1,2)'), undefined);
  });

  it('holds a state only when it reads as an object: the default state is written for the rest, as the reference did', () => {
    assert.equal(isAppState('(discover:(columns:!(_source)))'), true);
    assert.equal(isAppState('()'), true);
    assert.equal(isAppState('(discover:(columns:!(_source)'), false);
    assert.equal(isAppState('!(1,2)'), false);
    assert.equal(isAppState("'text'"), false);
    assert.equal(isAppState('!n'), false);
    assert.equal(isAppState(undefined), false);
    assert.equal(isAppState(''), false);
  });
});

describe('Discover with no index pattern', () => {
  it('asks for one, with where to read about each query language, as the reference does', () => {
    const html = renderToStaticMarkup(createElement(SelectData));
    assert.match(html, /data-test-subj="discoverNoIndexPatterns"/);
    assert.match(html, />Select data</);
    assert.match(
      html,
      /Select an available data source and choose a query language to use for running queries\. You can use the data\s+dropdown or use the enhanced data selector to select data\./
    );
    assert.match(html, />Learn more about query languages</);
    const links = [...html.matchAll(/<a href="([^"]+)" target="_blank" rel="noopener noreferrer">([^<]+)/g)].map((match) => match[2].trim());
    assert.deepEqual(links, ['DQL documentation', 'Lucene documentation']);
  });

  it('shows the picker with none chosen and lists no field', () => {
    const html = renderToStaticMarkup(
      createElement(Sidebar, {
        indexPattern: undefined,
        indexPatterns: [{ id: 'logs', title: 'logs' }],
        onIndexPatternChange: () => undefined,
        onRefreshFields: () => undefined,
        columns: undefined,
        rows: [],
        onToggleColumn: () => undefined,
        onFilter: () => undefined,
        onFilterExists: () => undefined,
      })
    );
    assert.match(html, /Select a data source/);
    assert.match(html, /data-test-subj="sourceRefreshButton"/);
    assert.match(html, /aria-label="Refresh data selector"/);
    assert.equal(/fieldList-|Selected fields|Available fields/.test(html), false);
  });
});

describe('the interval the state holds', () => {
  it("is read as the original's TimeBuckets reads it: a text, or the val of a choice", () => {
    assert.equal(stateInterval('d'), 'd');
    assert.equal(stateInterval('auto'), 'auto');
    assert.equal(stateInterval('3h'), '3h');
    assert.equal(stateInterval({ val: 'd' }), 'd');
    assert.equal(stateInterval({ val: 'h', display: 'Hour' }), 'h');
  });

  it('is auto when it is anything else', () => {
    assert.equal(stateInterval(undefined), undefined);
    assert.equal(stateInterval(''), undefined);
    assert.equal(stateInterval({ a: 1 }), undefined);
    assert.equal(stateInterval({ val: 5 }), undefined);
    assert.equal(stateInterval(5), undefined);
    assert.equal(stateInterval(null), undefined);
    assert.equal(stateInterval(['d']), undefined);
  });

  it('is searched as the reference searched it: {val:d} by the day, {a:1} as auto (12h for two weeks)', () => {
    createServices({ basePath: '', version: '3.9.0', name: 'test', settings: {}, settingsDefaults: {}, settingsOverrides: {} } as unknown as BootData);
    const search = (interval: unknown) => {
      const body = buildDiscoverRequest({ indexPattern: logs, query: { query: '', language: 'kuery' }, filters: [], range, sort: [], size: 5, interval: stateInterval(interval) });
      const histogram = (body.aggs as Record<string, { date_histogram: Record<string, unknown> }>)['2'].date_histogram;
      return histogram.fixed_interval ?? histogram.calendar_interval;
    };
    assert.equal(search({ val: 'd' }), '1d');
    assert.equal(search({ a: 1 }), '12h');
    assert.equal(search(5), '12h');
  });
});

describe('columns of the state that are no list, or an empty one', () => {
  // The names the documents on screen hold
  const present = new Set(['bytes', 'extension', 'timestamp']);
  const names = (list: Field[]) => list.map((each) => each.name);

  it('are given to the sidebar as they are: none chosen for an empty list, nothing for what is no list', () => {
    assert.deepEqual(stateColumnNames([]), []);
    assert.deepEqual(stateColumnNames(['bytes', 3, '_source']), ['bytes', '_source']);
    assert.equal(stateColumnNames('bytes'), undefined);
    assert.equal(stateColumnNames(undefined), undefined);
    assert.equal(stateColumnNames({ 0: 'bytes' }), undefined);
  });

  it("put no field under any heading when they are no list, as the original's groupFields", () => {
    assert.deepEqual(groupFields(fields, stateColumnNames('bytes'), 10, NO_FILTER, present), { selected: [], popular: [], unpopular: [] });
  });

  it('select nothing when empty: _source is not listed (the table still shows it), as the reference', () => {
    const groups = groupFields(fields, stateColumnNames([]), 10, NO_FILTER, present);
    assert.deepEqual(names(groups.selected), []);
    assert.deepEqual(names(groups.unpopular), ['bytes', 'extension', 'timestamp']);
    assert.deepEqual(names(groupFields(fields, ['_source'], 10, NO_FILTER, present).selected), ['_source']);
  });
});

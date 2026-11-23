/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  addOrFieldValue,
  executeQuery,
  getOrFieldClause,
  hasOrFieldClause,
  parseQuery,
  printQuery,
  QuerySyntaxError,
  removeOrFieldValue,
} from '../../web/lib/search_query';
import {
  ariaName,
  categoryName,
  codeEditorChange,
  displayedDefault,
  editableValue,
  groupByCategory,
  isDefaultValue,
  orderCategories,
  toFieldSettings,
  unsavedCountText,
  valueToSave,
  type SettingsSource,
} from '../../web/apps/management/settings_model';
import { Http, type FetchOptions } from '../../web/services/http';
import { settingScopes, settingType, UiSettingsClient, type SettingDefinition } from '../../web/services/ui_settings';
import catalogue from '../../web/lib/settings_catalogue.json';

const DEFINITIONS = catalogue as Record<string, SettingDefinition>;

function source(stored: Record<string, unknown> = {}, more: Partial<SettingsSource> = {}): SettingsSource {
  return {
    definitions: DEFINITIONS,
    stored,
    isOverridden: () => false,
    userControl: false,
    defaultOf: (key) => DEFINITIONS[key]?.value,
    ...more,
  };
}

const ROWS = toFieldSettings(source());
const names = (text: string) =>
  executeQuery(parseQuery(text), ROWS)
    .map((row) => row.name)
    .sort();

/** The message the search bar shows under itself for a text */
function messageOf(text: string): string | undefined {
  try {
    parseQuery(text);
    return undefined;
  } catch (error) {
    if (!(error instanceof QuerySyntaxError)) throw error;
    return `Unable to parse query. ${error.message}`;
  }
}

describe('the search of the advanced settings', () => {
  it('says what it expected where a text cannot be read, as the original does', () => {
    const start = 'Expected "(", "-", "is:", field, term, or whitespace but end of input found.';
    assert.equal(messageOf('('), `Unable to parse query. ${start}`);
    assert.equal(messageOf('-('), `Unable to parse query. ${start}`);
    assert.equal(messageOf('(a or'), `Unable to parse query. ${start}`);
    assert.equal(
      messageOf('"x'),
      'Unable to parse query. Expected "(", "-", "is:", end of input, field, term, or whitespace but "\\"" found.'
    );
    assert.equal(
      messageOf('x >'),
      'Unable to parse query. Expected "(", "-", "is:", end of input, field, term, or whitespace but ">" found.'
    );
    assert.equal(messageOf('(a'), 'Unable to parse query. Expected ")", [oO], or whitespace but end of input found.');
    assert.equal(messageOf('x:(a or'), 'Unable to parse query. Expected end of input or whitespace but "(" found.');
    assert.equal(messageOf('x:"y'), 'Unable to parse query. Expected end of input or whitespace but "\\"" found.');
    assert.equal(messageOf('a b)'), 'Unable to parse query. Expected end of input or whitespace but ")" found.');
    assert.equal(
      messageOf('date or csv'),
      'Unable to parse query. To use OR in a text search, put it inside quotes: "or". ' +
        'To perform a logical OR, enclose the words in parenthesis: (foo:bar or bar).'
    );
  });

  it('reads the texts the original reads', () => {
    for (const text of ['', 'a:', 'is:', 'a:b:', '-', 'category:(general or search) date', '"date or csv"']) {
      assert.equal(messageOf(text), undefined, text);
    }
  });

  it('finds the settings the original finds', () => {
    assert.deepEqual(names('dateFormat'), ['dateFormat', 'dateFormat:dow', 'dateFormat:scaled', 'dateFormat:tz']);
    assert.deepEqual(names('"date format"'), ['dateFormat', 'dateFormat:scaled', 'dateFormat:tz']);
    assert.deepEqual(names('csv separator'), ['csv:separator']);
    assert.deepEqual(names('kuery'), ['search:queryLanguage']);
    assert.deepEqual(names('name:csv'), ['csv:quoteValues', 'csv:separator']);
    assert.deepEqual(names('category:appearance'), [
      'accessibility:disableAnimations',
      'pageNavigation',
      'theme:darkMode',
      'theme:enableUserControl',
      'theme:version',
    ]);
    assert.equal(names('category:vis').length, 12);
    assert.deepEqual(names('date'), [
      'courier:batchSearches',
      'dateFormat',
      'dateFormat:dow',
      'dateFormat:scaled',
      'dateFormat:tz',
      'dateNanosFormat',
      'format:defaultTypeMap',
      'histogram:barTarget',
      'histogram:maxBars',
      'query:dataframe:hydrationStrategy',
    ]);
    assert.equal(names('-date').length, ROWS.length - 10);
    // A field no setting has finds nothing, and so does a flag no setting has
    assert.deepEqual(names('csv:separator'), []);
    assert.deepEqual(names('is:isCustom'), []);
    assert.deepEqual(names('zzzz'), []);
  });

  it('writes a choice of the category filter into the text, as the original writes it', () => {
    let clauses = addOrFieldValue(parseQuery(''), 'category', 'appearance');
    assert.equal(printQuery(clauses), 'category:(appearance)');
    clauses = addOrFieldValue(clauses, 'category', 'general');
    assert.equal(printQuery(clauses), 'category:(appearance or general)');
    assert.equal(getOrFieldClause(clauses, 'category', 'general')?.match, 'must');
    assert.equal(hasOrFieldClause(clauses, 'category'), true);
    clauses = removeOrFieldValue(clauses, 'category', 'appearance');
    assert.equal(printQuery(clauses), 'category:(general)');
    clauses = removeOrFieldValue(clauses, 'category', 'general');
    assert.equal(printQuery(clauses), '');
    assert.equal(hasOrFieldClause(clauses, 'category'), false);
  });

  it('keeps the words of the text beside the filter, and a clause that leaves a category out', () => {
    assert.equal(printQuery(addOrFieldValue(parseQuery('date'), 'category', 'search')), 'date category:(search)');
    const out = parseQuery('-category:(general)');
    assert.equal(getOrFieldClause(out, 'category', 'general')?.match, 'must_not');
    assert.equal(printQuery(addOrFieldValue(out, 'category', 'search')), '-category:(general) category:(search)');
    assert.equal(printQuery(parseQuery('"date format" -csv')), '"date format" -csv');
  });
});

describe('the rows of the advanced settings page', () => {
  it('lists the settings of the global scope that can be changed, by key', () => {
    assert.equal(ROWS.length, Object.keys(DEFINITIONS).length - 2);
    assert.equal(ROWS.some((row) => row.name === 'buildNum'), false, 'read-only');
    assert.equal(ROWS.some((row) => row.name === 'searchWorkspace:dismissGetStarted'), false, 'a user setting');
    const keys = ROWS.map((row) => row.name);
    assert.deepEqual(keys, [...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  });

  it('lists a stored setting nothing registers as a custom one of the General section', () => {
    const rows = toFieldSettings(source({ 'my:own': 'x', 'csv:separator': ';' }));
    const custom = rows.find((row) => row.name === 'my:own');
    assert.equal(custom?.isCustom, true);
    assert.equal(custom?.type, 'string');
    assert.deepEqual(custom?.category, ['general']);
    assert.equal(custom?.ariaName, 'my own');
    assert.equal(rows.find((row) => row.name === 'csv:separator')?.value, ';');
  });

  it('lists the Timeline settings in their section, and locks what the server or the browser sets', () => {
    const rows = toFieldSettings(
      source(
        { 'timeline:es.timefield': 'timestamp' },
        { isOverridden: (key) => key === 'csv:separator', userControl: true }
      )
    );
    const timeline = rows.filter((row) => row.name.startsWith('timeline:'));
    assert.equal(timeline.length, 7);
    assert.ok(timeline.every((row) => row.category[0] === 'timeline'));
    assert.equal(timeline.find((row) => row.name === 'timeline:es.timefield')?.value, 'timestamp');
    assert.equal(rows.find((row) => row.name === 'csv:separator')?.isOverridden, true);
    assert.equal(rows.find((row) => row.name === 'theme:darkMode')?.preferBrowserSetting, true);
    assert.equal(ROWS.find((row) => row.name === 'theme:darkMode')?.preferBrowserSetting, false);
  });

  it('puts the sections in the order of the page', () => {
    assert.deepEqual(orderCategories(['search', 'general', 'appearance', 'admin', 'discover']), [
      'admin',
      'general',
      'appearance',
      'discover',
      'search',
    ]);
    const groups = groupByCategory(ROWS);
    assert.ok(groups.general.some((row) => row.name === 'dateFormat'));
    assert.equal(categoryName('visbuilder'), 'VisBuilder');
    assert.equal(categoryName('somethingElse'), 'SomethingElse');
    assert.equal(categoryName(undefined), '');
  });

  it('names a key in words, as the original does for its screen readers', () => {
    assert.equal(ariaName('doc_table:highlight'), 'doc table highlight');
    assert.equal(ariaName('dateFormat:tz'), 'date format tz');
    assert.equal(ariaName('visualization:tileMap:WMSdefaults'), 'visualization tile map wm sdefaults');
    assert.equal(ariaName(undefined), '');
  });
});

describe('the fields of the advanced settings page', () => {
  it('shows a value as its control holds it', () => {
    assert.equal(editableValue('array', ['a', 'b']), 'a, b');
    assert.equal(editableValue('array', undefined, ['x']), 'x');
    assert.equal(editableValue('boolean', undefined, true), true);
    assert.equal(editableValue('number', '12'), 12);
    assert.equal(editableValue('string', undefined), '');
    assert.equal(editableValue('json', undefined, '{}'), '{}');
  });

  it('says the default only when what is stored differs from it', () => {
    assert.equal(isDefaultValue({ isCustom: false, value: undefined, defVal: 1 }), true);
    assert.equal(isDefaultValue({ isCustom: false, value: '1', defVal: 1 }), true);
    assert.equal(isDefaultValue({ isCustom: false, value: 2, defVal: 1 }), false);
    assert.equal(isDefaultValue({ isCustom: true, value: 2, defVal: undefined }), true);
    assert.equal(displayedDefault('select', 'Browser', { Browser: 'The browser' }), 'The browser');
    assert.equal(displayedDefault('array', ['a', 'b']), 'a, b');
    assert.equal(displayedDefault('string', null), 'null');
    assert.equal(displayedDefault('string', ''), 'null');
  });

  it('checks the text of a JSON field, and gives an empty one the empty value of its default', () => {
    assert.deepEqual(codeEditorChange('json', '{"a":1}', ''), { value: '{}' });
    assert.deepEqual(codeEditorChange('json', '[1]', '  '), { value: '[]' });
    assert.deepEqual(codeEditorChange('json', '{}', '{"a":'), {
      value: '{"a":',
      error: 'Invalid JSON syntax',
      isInvalid: true,
    });
    assert.deepEqual(codeEditorChange('markdown', '', ''), { value: '' });
  });

  it('saves a change as the original does: the default as nothing', () => {
    assert.deepEqual(valueToSave({ type: 'array', defVal: ['a'] }, 'a, b'), ['a', 'b']);
    assert.equal(valueToSave({ type: 'array', defVal: ['a', 'b'] }, 'a , b'), null);
    assert.deepEqual(valueToSave({ type: 'array', defVal: ['a'] }, ''), []);
    assert.equal(valueToSave({ type: 'json', defVal: '{}' }, ''), null);
    assert.equal(valueToSave({ type: 'json', defVal: '[]' }, ' [1] '), '[1]');
    assert.equal(valueToSave({ type: 'number', defVal: 5 }, 5), null);
    assert.equal(valueToSave({ type: 'string', defVal: ',' }, ';'), ';');
  });

  it('counts what is not saved yet', () => {
    assert.equal(unsavedCountText(1, 0), '1 unsaved setting');
    assert.equal(unsavedCountText(3, 2), '3 unsaved settings, 2 hidden');
  });
});

class FakeHttp extends Http {
  readonly posted: unknown[] = [];

  constructor(private stored: Record<string, unknown>) {
    super('');
  }

  override async fetch<T = unknown>(path: string, options: FetchOptions = {}): Promise<T> {
    assert.equal(path, '/api/opensearch-dashboards/settings');
    if (options.method === 'POST') {
      const { changes } = options.body as { changes: Record<string, unknown> };
      this.posted.push(changes);
      for (const [key, value] of Object.entries(changes)) {
        if (value === null) delete this.stored[key];
        else this.stored[key] = value;
      }
    }
    const settings: Record<string, { userValue: unknown }> = {};
    for (const [key, value] of Object.entries(this.stored)) settings[key] = { userValue: value };
    return { settings } as T;
  }
}

describe('the settings in the browser', () => {
  it('knows the type and the scopes of a setting as the original does', () => {
    assert.equal(settingType({ type: 'json', value: '{}' }), 'json');
    assert.equal(settingType({ value: ['a'] }), 'array');
    assert.equal(settingType({ value: 3 }), 'number');
    assert.equal(settingType(undefined, 'x'), 'string');
    assert.deepEqual(settingScopes(undefined), ['global']);
    assert.deepEqual(settingScopes({ scope: 'user' }), ['user']);
    assert.deepEqual(settingScopes({ scope: ['global', 'workspace'] }), ['global', 'workspace']);
  });

  it('reads a setting as its type, over its default, and the server file over both', async () => {
    const http = new FakeHttp({ 'csv:separator': ';', 'history:limit': '20' });
    const client = new UiSettingsClient(http, { 'csv:separator': ';', 'history:limit': '20' }, {}, { 'dateFormat:tz': 'UTC' });
    assert.equal(client.get('csv:separator'), ';');
    assert.equal(client.get('history:limit'), 20);
    assert.equal(client.get('csv:quoteValues'), true);
    assert.deepEqual(client.get('dateFormat:scaled'), JSON.parse(String(DEFINITIONS['dateFormat:scaled'].value)));
    assert.equal(client.get('dateFormat:tz'), 'UTC');
    assert.equal(client.isOverridden('dateFormat:tz'), true);
    assert.deepEqual(client.overriddenKeys(), ['dateFormat:tz']);
    let refused = '';
    try {
      await client.set('dateFormat:tz', 'Browser');
    } catch (error) {
      refused = error instanceof Error ? error.message : String(error);
    }
    assert.match(refused, /overridden by the OpenSearch Dashboards server/);
    assert.deepEqual(http.posted, []);
  });

  it('saves changes on the server, and takes a setting back to its default with null', async () => {
    const http = new FakeHttp({ 'csv:separator': ';' });
    const client = new UiSettingsClient(http, { 'csv:separator': ';' }, {}, {});
    let calls = 0;
    client.subscribe(() => (calls += 1));
    await client.setMany({ 'csv:separator': null, 'history:limit': 5 });
    assert.deepEqual(http.posted, [{ 'csv:separator': null, 'history:limit': 5 }]);
    assert.equal(client.get('csv:separator'), ',');
    assert.equal(client.get('history:limit'), 5);
    assert.deepEqual(client.storedKeys(), ['history:limit']);
    assert.equal(calls, 1);
  });

  it('keeps the look in the browser while users choose it themselves', async () => {
    const http = new FakeHttp({ 'theme:enableUserControl': true });
    const client = new UiSettingsClient(http, { 'theme:enableUserControl': true }, {}, {});
    assert.equal(client.userControl(), true);
    assert.equal(client.prefersBrowser('theme:darkMode'), true);
    assert.equal(client.prefersBrowser('csv:separator'), false);
    await client.set('theme:darkMode', true);
    assert.deepEqual(http.posted, []);
    assert.equal(client.get('theme:darkMode'), true);
  });
});

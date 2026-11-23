/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  canAppendWildcard,
  conflictingKeys,
  containsIllegalCharacters,
  defaultFormatId,
  editorParamsOf,
  fieldWildcardMatcher,
  filterOptions,
  formatInstance,
  formatsForFieldType,
  formatToJson,
  ILLEGAL_CHARACTERS,
  ILLEGAL_CHARACTERS_VISIBLE,
  keptOf,
  listItemsOf,
  matchedIndicesOf,
  metaParamsOf,
  patternFromSavedObject,
  preselectedTimeField,
  resolvedItems,
  resolvedOrNone,
  sampleInputsOf,
  savedBodyOf,
  tabsOf,
  timeFieldChoice,
  timeFieldOptions,
  timeFieldOptionValue,
  TRUNCATE_SAMPLE,
  URL_ICON_PATTERN,
  urlSampleOf,
  type MatchedItem,
} from '../../web/apps/management/index_pattern_model';
import { compareValues, nextSort, sortRows, visiblePages } from '../../web/apps/management/index_pattern_table';
import { createFormatter } from '../../web/lib/field_formats';

const SETTINGS: Record<string, unknown> = {
  'format:number:defaultPattern': '0,0.[000]',
  'format:bytes:defaultPattern': '0,0.[0]b',
  'format:percent:defaultPattern': '0,0.[000]%',
  dateFormat: 'MMM D, YYYY @ HH:mm:ss.SSS',
  'dateFormat:tz': 'Browser',
  dateNanosFormat: 'MMM D, YYYY @ HH:mm:ss.SSSSSSSSS',
};
const setting = (key: string) => SETTINGS[key];
const ORIGIN = 'http://localhost:5601';
const PAGE = '/app/management/opensearch-dashboards/indexPatterns/patterns/logs';
const meta = metaParamsOf({ origin: ORIGIN, pathname: PAGE }, '');
const parsedUrl = { origin: ORIGIN, pathname: PAGE, basePath: '' };

/** What each sample of a format editor shows, as the original's preview writes it */
const outputs = (id: string, params: Record<string, unknown> = {}) =>
  sampleInputsOf(id, params).map((value) => createFormatter({ id, params })(value).text);

describe('the samples of the format editors', () => {
  it('writes numbers, bytes and percentages as the original shows them', () => {
    assert.deepEqual(outputs('number'), ['10,000', '12.346', '-1', '-999', '0.52']);
    assert.deepEqual(outputs('bytes'), ['256B', '1KB', '4.9MB', '1.9GB']);
    assert.deepEqual(outputs('percent'), ['10%', '99.999%', '100%', '10,000%', '100,000%']);
  });

  it('writes durations in words, as moment does', () => {
    assert.deepEqual(outputs('duration', { inputFormat: 'seconds', outputFormat: 'humanize', outputPrecision: 2 }), [
      'minus 2 minutes',
      'a few seconds',
      'a few seconds',
      '2 minutes',
      '11 minutes',
      '33 minutes',
      'an hour',
      'a day',
      '29 years',
    ]);
  });

  it('transforms strings as the string format does', () => {
    const [fox, calm, className, host, base64, urlParam] = sampleInputsOf('string', {});
    const transform = (name: string, value: unknown) => createFormatter({ id: 'string', params: { transform: name } })(value).text;
    assert.deepEqual(outputs('string', { transform: false }), sampleInputsOf('string', {}));
    assert.equal(transform('upper', host), 'HOSTNAME.NET');
    assert.equal(transform('lower', calm), 'stay calm!');
    assert.equal(transform('title', calm), 'Stay Calm!');
    assert.equal(transform('title', fox), 'A Quick Brown Fox.');
    assert.equal(transform('short', className), 'c.o.p.ClassName');
    assert.equal(transform('base64', base64), 'Hello world');
    assert.equal(transform('urlparam', urlParam), '안녕 키바나');
  });

  it('truncates past the length, the omission not counted', () => {
    assert.equal(createFormatter({ id: 'truncate', params: { fieldLength: 10 } })(TRUNCATE_SAMPLE).text, 'Lorem ipsu...');
    assert.equal(createFormatter({ id: 'truncate', params: {} })(TRUNCATE_SAMPLE).text, TRUNCATE_SAMPLE);
  });

  it('shows the values of each kind of URL format', () => {
    assert.deepEqual(sampleInputsOf('url', { type: 'a' }), ['john', '/some/pathname/asset.png', 1234]);
    assert.deepEqual(sampleInputsOf('url', { type: 'img' }), ['go', 'stop', ['de', 'ne', 'us', 'ni'], 'cv']);
    assert.deepEqual(sampleInputsOf('url', { type: 'audio' }), ['hello.mp3']);
  });
});

describe('the URL format', () => {
  const link = (value: unknown, params: Record<string, unknown> = {}) => urlSampleOf({ parsedUrl, type: 'a', ...params }, value);

  it('makes a relative address absolute from where the page was loaded', () => {
    assert.deepEqual(link('john'), { kind: 'link', url: 'john', label: 'john', href: `${ORIGIN}/app/john`, target: '_blank' });
    assert.equal(link('/some/pathname/asset.png').href, `${ORIGIN}/some/pathname/asset.png`);
    assert.equal(link(1234).href, `${ORIGIN}/app/1234`);
    assert.equal(link('#/discover').href, `${ORIGIN}${PAGE}#/discover`);
    assert.equal(link('https://example.test/a').href, 'https://example.test/a');
    assert.equal(link('john', { openLinkInCurrentTab: true }).target, '_self');
    const based = urlSampleOf({ parsedUrl: { ...parsedUrl, basePath: '/base' }, type: 'a' }, '/x');
    assert.equal(based.href, `${ORIGIN}/base/app/x`);
  });

  it('fills its templates', () => {
    const filled = link('a b', { urlTemplate: 'https://example.test/?q={{value}}', labelTemplate: 'Look for {{value}}' });
    assert.equal(filled.href, 'https://example.test/?q=a%20b');
    assert.equal(filled.label, 'Look for a b');
  });

  it('shows an image with its size, or none', () => {
    const image = urlSampleOf({ parsedUrl, type: 'img', urlTemplate: URL_ICON_PATTERN }, 'go');
    assert.deepEqual(image, {
      kind: 'image',
      url: '/plugins/indexPatternManagement/assets/icons/go.png',
      label: '/plugins/indexPatternManagement/assets/icons/go.png',
      alt: 'A dynamically-specified image located at /plugins/indexPatternManagement/assets/icons/go.png',
      maxWidth: 'none',
      maxHeight: 'none',
    });
    const sized = urlSampleOf({ type: 'img', width: '20', height: 'x', labelTemplate: 'Flag' }, 'de');
    assert.equal(sized.maxWidth, '20px');
    assert.equal(sized.maxHeight, 'none');
    assert.equal(sized.alt, 'Flag');
  });

  it('writes an address it cannot make absolute as text', () => {
    assert.equal(urlSampleOf({ type: 'a' }, 'john').kind, 'text');
    assert.equal(urlSampleOf({ type: 'audio' }, 'hello.mp3').kind, 'audio');
  });
});

describe('the formats a field can have', () => {
  it('lists them in the order the original registers them', () => {
    const ids = (type: string) => formatsForFieldType(type).map((format) => format.id);
    assert.deepEqual(ids('number'), ['boolean', 'bytes', 'color', 'duration', 'number', 'percent', 'static_lookup', 'string', 'url']);
    assert.deepEqual(ids('string'), ['boolean', 'color', 'static_lookup', 'string', 'truncate', 'url']);
    assert.deepEqual(ids('date'), ['date', 'date_nanos', 'relative_date', 'string', 'url']);
  });

  it('gives a field without one the default of its type, by its OpenSearch type first', () => {
    const map = JSON.stringify({ number: { id: 'number' }, date: { id: 'date' }, date_nanos: { id: 'date_nanos', es: true } });
    assert.equal(defaultFormatId('number', ['long'], map), 'number');
    assert.equal(defaultFormatId('date', ['date_nanos'], map), 'date_nanos');
    assert.equal(defaultFormatId('ip', ['ip'], map), 'string');
    assert.equal(defaultFormatId('number', undefined, 'not json'), 'string');
  });

  it('saves only the parameters that differ from the defaults', () => {
    assert.deepEqual(formatToJson({ id: 'number', params: { pattern: '0,0.[000]' } }, setting), { id: 'number' });
    assert.deepEqual(formatToJson(formatInstance('number', { pattern: '0.0' }, meta), setting), {
      id: 'number',
      params: { parsedUrl, pattern: '0.0' },
    });
    assert.deepEqual(
      formatToJson({ id: 'duration', params: { inputFormat: 'seconds', outputFormat: 'humanize', outputPrecision: 2 } }, setting),
      { id: 'duration' }
    );
    const raw = { id: 'number', params: { pattern: '0.0' } };
    assert.equal(formatToJson({ ...formatInstance('number', raw.params, meta), raw }, setting), raw);
  });

  it('shows an editor the instance parameters, then the defaults it lacks', () => {
    const params = editorParamsOf({ id: 'duration', params: { parsedUrl, outputFormat: 'asHours' } }, setting);
    assert.deepEqual(Object.keys(params), ['parsedUrl', 'outputFormat', 'inputFormat', 'outputPrecision']);
    assert.equal(params.inputFormat, 'seconds');
    assert.equal(params.outputFormat, 'asHours');
  });
});

const savedPattern = (fieldFormatMap: Record<string, unknown>) => ({
  id: 'logs',
  version: 'WzEsMV0=',
  attributes: {
    title: 'logs-*',
    timeFieldName: '@timestamp',
    sourceFilters: '[{"value":"zz*"}]',
    fields: JSON.stringify([
      { name: 'b', type: 'number', esTypes: ['long'], searchable: true, aggregatable: true, readFromDocValues: true, count: 0 },
      { name: 'a', type: 'string', esTypes: ['keyword'], searchable: true, aggregatable: true, readFromDocValues: true, count: 3 },
      { name: 'dup', type: 'number', count: 1 },
      { name: 'dup', type: 'number', count: 2 },
      { name: 'u', type: 'string' },
      { name: '_source', type: 'string' },
      { name: 's', type: 'number', scripted: true, script: "doc['b'].value", lang: 'painless' },
    ]),
    fieldFormatMap: JSON.stringify(fieldFormatMap),
  },
});

describe('an index pattern read and written', () => {
  const read = (fieldFormatMap: Record<string, unknown>) => patternFromSavedObject(savedPattern(fieldFormatMap), meta, setting);

  it('keeps one field per name, the last of them in the place of the first', () => {
    const pattern = read({});
    assert.deepEqual(
      pattern.fields.map((field) => field.name),
      ['b', 'a', 'dup', 'u', '_source', 's']
    );
    assert.equal(pattern.fields[2].count, 2);
    assert.equal(pattern.fields[4].type, '_source');
  });

  it('orders the formats as the fields, and drops those the original drops', () => {
    const pattern = read({
      gone: { id: 'number' },
      a: { id: 'url' },
      dup: { id: 'bytes' },
      b: { id: 'number', params: { pattern: '0.0' } },
      u: { id: 'not_registered' },
      s: null,
    });
    assert.deepEqual(Object.keys(pattern.fieldFormatMap), ['b', 'a', 'u']);
    assert.equal(pattern.fieldFormatMap.u, undefined);
    assert.equal(
      savedBodyOf(pattern, setting).fieldFormatMap,
      JSON.stringify({ b: { id: 'number', params: { parsedUrl, pattern: '0.0' } }, a: { id: 'url', params: { parsedUrl } } })
    );
  });

  it('writes the attributes and each field with their keys in the original order', () => {
    const body = savedBodyOf(read({}), setting);
    assert.deepEqual(Object.keys(JSON.parse(JSON.stringify(body))), ['title', 'timeFieldName', 'sourceFilters', 'fields']);
    assert.equal(body.sourceFilters, '[{"value":"zz*"}]');
    const fields = JSON.parse(body.fields ?? '[]') as Array<Record<string, unknown>>;
    assert.equal(
      JSON.stringify(fields[1]),
      '{"count":3,"name":"a","type":"string","esTypes":["keyword"],"scripted":false,"searchable":true,"aggregatable":true,"readFromDocValues":true}'
    );
    assert.equal(
      JSON.stringify(fields[5]),
      '{"count":0,"script":"doc[\'b\'].value","lang":"painless","name":"s","type":"number","scripted":true,"searchable":true,"aggregatable":true,"readFromDocValues":false}'
    );
  });

  it('is read again as the original still holds it after its own saves', () => {
    const first = read({ b: { id: 'number', params: { pattern: '0.0' } }, a: { id: 'url' } });
    // The page gave `a` no format, then saved `b` untouched and gave `u` a format
    first.fieldFormatMap = { ...first.fieldFormatMap, a: undefined };
    first.fieldFormatMap.b = { ...(first.fieldFormatMap.b ?? formatInstance('number', null, meta)), raw: first.storedFormats.b };
    first.fieldFormatMap = { ...first.fieldFormatMap, u: formatInstance('string', null, meta) };
    const kept = keptOf(first);
    assert.deepEqual(kept.formatOrder, ['b', 'a', 'u']);
    assert.deepEqual(kept.rawFormats, ['b']);
    const stored = JSON.parse(savedBodyOf(first, setting).fieldFormatMap ?? '{}') as Record<string, unknown>;
    assert.deepEqual(stored, { b: { id: 'number', params: { pattern: '0.0' } }, u: { id: 'string', params: { parsedUrl } } });
    const again = patternFromSavedObject(savedPattern(stored), meta, setting, kept);
    assert.deepEqual(Object.keys(again.fieldFormatMap), ['b', 'a', 'u']);
    assert.equal(savedBodyOf(again, setting).fieldFormatMap, savedBodyOf(first, setting).fieldFormatMap);
    // Read afresh, the formats come in the order of the fields and are instances again
    const fresh = patternFromSavedObject(savedPattern(stored), meta, setting);
    assert.deepEqual(Object.keys(fresh.fieldFormatMap), ['b', 'u']);
    assert.deepEqual(JSON.parse(savedBodyOf(fresh, setting).fieldFormatMap ?? '{}').b, {
      id: 'number',
      params: { parsedUrl, pattern: '0.0' },
    });
  });

  it('tells a conflict from changes that do not meet', () => {
    const original = { title: 'a', fields: '1', sourceFilters: '[]' };
    assert.deepEqual(conflictingKeys(original, { ...original, fields: '2' }, { ...original, title: 'b' }), {
      changedHere: ['fields'],
      changedThere: ['title'],
      collision: false,
    });
    assert.equal(conflictingKeys(original, { ...original, fields: '2' }, { ...original, fields: '3' }).collision, true);
  });
});

describe('the page of an index pattern', () => {
  const pattern = patternFromSavedObject(savedPattern({}), meta, setting);

  it('counts the fields of each tab, and those a search keeps', () => {
    assert.deepEqual(
      tabsOf(pattern, '').map((tab) => tab.name),
      ['Fields (5)', 'Scripted fields (1)', 'Source filters (1)']
    );
    assert.deepEqual(
      tabsOf(pattern, 'A').map((tab) => tab.name),
      ['Fields (1 / 5)', 'Scripted fields (0 / 1)', 'Source filters (0 / 1)']
    );
  });

  it('offers each value once, after the option that keeps every row', () => {
    assert.deepEqual(filterOptions(['string', 'number', 'string'], 'All field types'), [
      { value: '', text: 'All field types' },
      { value: 'string', text: 'string' },
      { value: 'number', text: 'number' },
    ]);
    assert.deepEqual(filterOptions([], 'All'), []);
  });

  it('matches source filters as the original does, never the meta fields', () => {
    const matches = fieldWildcardMatcher(['zz*', 'agent'], ['_source']);
    assert.equal(matches('zzfoo'), true);
    assert.equal(matches('agent'), true);
    assert.equal(matches('agent.keyword'), false);
    assert.equal(fieldWildcardMatcher(['*'], ['_id'])('_id'), false);
    assert.equal(fieldWildcardMatcher(['a.b'])('aXb'), false);
  });
});

describe('the list of index patterns', () => {
  it('puts the default first, then the others by name', () => {
    const items = listItemsOf(
      [
        { id: 'b', attributes: { title: 'beta' } },
        { id: 'a', attributes: { title: 'zeta', displayName: 'Alpha' } },
        { id: 'd', attributes: { title: 'delta' }, references: [{ type: 'data-source', id: 'x', name: 'dataSource' }] },
      ],
      'd'
    );
    assert.deepEqual(
      items.map((item) => [item.id, item.title, item.tags.map((tag) => tag.name)]),
      [
        ['d', 'delta', ['Default']],
        ['a', 'Alpha', []],
        ['b', 'beta', []],
      ]
    );
    assert.equal(items[0].referenceId, 'x');
  });
});

describe('the wizard', () => {
  it('refuses the characters an index name cannot have', () => {
    assert.equal(containsIllegalCharacters('logs-*', ILLEGAL_CHARACTERS), false);
    assert.equal(containsIllegalCharacters('logs 1', ILLEGAL_CHARACTERS), true);
    assert.equal(containsIllegalCharacters('logs 1', ILLEGAL_CHARACTERS_VISIBLE), false);
    assert.equal(containsIllegalCharacters('a|b', ILLEGAL_CHARACTERS_VISIBLE), true);
  });

  it('adds a wildcard after one letter or digit typed into an empty box', () => {
    assert.deepEqual(['a', 'Z', '7', '*', '-', 'Shift', ''].map(canAppendWildcard), [true, true, true, false, false, false, false]);
  });

  it('reads indices, aliases and data streams, sorted by name', () => {
    const items = resolvedItems({
      indices: [{ name: 'b', attributes: ['open'] }, { name: 'a', attributes: ['frozen'] }],
      aliases: [{ name: 'alias' }],
      data_streams: [{ name: 'ds', timestamp_field: '@timestamp' }],
    });
    assert.deepEqual(
      items.map((item) => [item.name, item.tags.map((tag) => tag.name).join('+')]),
      [
        ['a', 'Index+Frozen'],
        ['alias', 'Alias'],
        ['b', 'Index'],
        ['ds', 'Data stream'],
      ]
    );
    assert.equal(items[3].timestampField, '@timestamp');
    assert.deepEqual(resolvedItems(undefined), []);
  });

  it('shows the exact matches, else those of the pattern with a wildcard, else all; no system index unless asked', () => {
    const item = (name: string): MatchedItem => ({ name, tags: [] });
    const all = [item('.kibana'), item('logs'), item('remote:.hidden'), item('metrics')];
    const none = matchedIndicesOf(all, [], []);
    assert.deepEqual(none.visibleIndices.map((i) => i.name), ['logs', 'metrics']);
    assert.deepEqual(matchedIndicesOf(all, [], [], true).visibleIndices.length, 4);
    assert.deepEqual(matchedIndicesOf(all, [item('logs')], []).visibleIndices.map((i) => i.name), ['logs']);
    assert.deepEqual(matchedIndicesOf(all, [item('logs')], [item('metrics')]).visibleIndices.map((i) => i.name), ['metrics']);
  });

  it('offers the date fields, a separator and no time field', () => {
    assert.deepEqual(timeFieldOptions([{ name: 'x', type: 'number' }]), [
      { display: "The indices which match this index pattern don't contain any time fields." },
    ]);
    assert.deepEqual(timeFieldOptions([{ name: 'ts', type: 'date' }, { name: 'x', type: 'number' }]), [
      { display: 'ts', fieldName: 'ts' },
      { isDisabled: true, display: '───', fieldName: '' },
      { display: "I don't want to use the time filter", fieldName: undefined },
    ]);
  });

  it('takes a failed request for indices as no match, as the original, which warns of nothing', async () => {
    assert.deepEqual(await resolvedOrNone(Promise.reject(new Error('Not Found'))), []);
    const found = await resolvedOrNone(Promise.resolve({ indices: [{ name: 'logs', attributes: ['open'] }] }));
    assert.deepEqual(found.map((item) => item.name), ['logs']);
  });

  it('takes "I don\'t want to use the time filter" as a choice, as the original', () => {
    const options = timeFieldOptions([{ name: 'ts', type: 'date' }]);
    // The select tells its options apart by their values: the choice of none is not the empty value of no choice
    const values = options.map(timeFieldOptionValue);
    assert.deepEqual(values, ['ts', '', "I don't want to use the time filter"]);
    assert.deepEqual(timeFieldChoice(options, values[0]), { fieldName: 'ts', chosen: true });
    assert.deepEqual(timeFieldChoice(options, values[2]), { fieldName: undefined, chosen: true });
    assert.deepEqual(timeFieldChoice(options, ''), { fieldName: '', chosen: false });
  });

  it('chooses the time field of data streams that share one', () => {
    const stream = (timestampField?: string): MatchedItem => ({ name: 'ds', tags: [], timestampField });
    assert.equal(preselectedTimeField([stream('@timestamp'), stream('@timestamp')]), '@timestamp');
    assert.equal(preselectedTimeField([stream('@timestamp'), stream('ts')]), undefined);
    assert.equal(preselectedTimeField([stream('@timestamp'), stream()]), undefined);
  });
});

describe('the tables of the index pattern pages', () => {
  it('sorts as EUI does: equal values in place, nothing last', () => {
    assert.equal(compareValues(undefined, 'a', 'asc'), 1);
    assert.equal(compareValues('a', null, 'desc'), -1);
    assert.equal(compareValues('a', 'b', 'desc'), 1);
    assert.equal(compareValues(2, 10, 'asc'), -1);
    assert.equal(compareValues('2', '10', 'asc'), 1);
    const rows = [
      { n: 'b', i: 1 },
      { n: undefined, i: 2 },
      { n: 'a', i: 3 },
      { n: 'b', i: 4 },
    ];
    const columns = [{ field: 'n', name: 'N', sortable: true }];
    assert.deepEqual(sortRows(rows, columns, { field: 'n', direction: 'desc' }).map((row) => row.i), [1, 4, 3, 2]);
    assert.deepEqual(sortRows(rows, columns, { field: 'n', direction: 'asc' }).map((row) => row.i), [3, 1, 4, 2]);
    assert.equal(sortRows(rows, columns, undefined), rows);
  });

  it('sorts a column up, down, and then not at all when that is allowed', () => {
    assert.deepEqual(nextSort(undefined, 'name', false), { field: 'name', direction: 'asc' });
    assert.deepEqual(nextSort({ field: 'name', direction: 'asc' }, 'name', false), { field: 'name', direction: 'desc' });
    assert.deepEqual(nextSort({ field: 'name', direction: 'desc' }, 'name', false), { field: 'name', direction: 'asc' });
    assert.equal(nextSort({ field: 'name', direction: 'desc' }, 'name', true), undefined);
    assert.deepEqual(nextSort({ field: 'type', direction: 'desc' }, 'name', true), { field: 'name', direction: 'asc' });
  });

  it('shows the pages EuiPagination shows', () => {
    assert.deepEqual(visiblePages(1, 0), [0]);
    assert.deepEqual(visiblePages(10, 0), [0, 1, 2, 3, 4, 'after', 9]);
    assert.deepEqual(visiblePages(10, 5), [0, 'before', 3, 4, 5, 6, 7, 8, 9]);
    assert.deepEqual(visiblePages(10, 9), [0, 'before', 5, 6, 7, 8, 9]);
    assert.deepEqual(visiblePages(7, 4), [0, 1, 2, 3, 4, 5, 6]);
  });
});

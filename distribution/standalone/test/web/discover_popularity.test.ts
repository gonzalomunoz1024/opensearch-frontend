/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Field popularity, as the original's popularizeField and updateSavedObject write it. Measured on
 * the reference with an index pattern of my own (the sample logs' title, time field, fields at
 * count 0 and formats): adding extension and bytes from the sidebar, moving extension right in the
 * table and taking bytes and then extension out each make one PUT of the pattern's saved object
 * with {attributes: {title, timeFieldName, fields}, version}, the version that of the write before
 * and each field with the keys of IndexPatternField.toJSON; the counts go extension 1, 1, 2, 2, 3
 * and bytes 0, 1, 1, 2, 2, and "Popular fields" lists bytes and extension after.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  fieldJson,
  fieldsJson,
  keepPopularity,
  popularizeField,
  refreshRequired,
  type PatternStore,
} from '../../web/apps/discover/popularity';
import type { Field, IndexPattern } from '../../web/lib/types';
import { HttpFetchError } from '../../web/services/http';

const field = (name: string, type: string, extra: Partial<Field> = {}): Field => ({
  name,
  type,
  esTypes: [type === 'number' ? 'long' : type === 'date' ? 'date' : 'keyword'],
  searchable: true,
  aggregatable: true,
  readFromDocValues: true,
  ...extra,
});

const logs = (): IndexPattern => ({
  id: 'zz-logs',
  title: 'logs-*',
  timeFieldName: 'timestamp',
  fields: [field('timestamp', 'date'), field('extension', 'string'), field('bytes', 'number')],
  fieldFormatMap: {},
});

interface Call {
  method: 'GET' | 'PUT';
  version?: string;
  attributes?: Record<string, unknown>;
}

/** One stored pattern whose version goes up with each write, as OpenSearch's does */
type Change = (changes: Record<string, unknown>) => void;

function fakeStore(pattern: IndexPattern, options: { fields?: string; afterGet?: (changeElsewhere: Change) => void; failWith?: number } = {}) {
  let version = 1;
  let attributes: Record<string, unknown> = {
    title: pattern.title,
    timeFieldName: pattern.timeFieldName,
    fields: options.fields ?? JSON.stringify(pattern.fields),
    fieldFormatMap: '{"hour_of_day":{}}',
  };
  const calls: Call[] = [];
  const tag = () => `v${version}`;
  const changeElsewhere: Change = (changes) => {
    attributes = { ...attributes, ...changes };
    version += 1;
  };
  const store: PatternStore = {
    async get() {
      calls.push({ method: 'GET' });
      const answer = { version: tag(), attributes: { ...attributes } };
      options.afterGet?.(changeElsewhere);
      return answer;
    },
    async update(_id, changes, given) {
      calls.push({ method: 'PUT', version: given, attributes: changes });
      if (options.failWith) throw new HttpFetchError(options.failWith, 'failed');
      if (given !== undefined && given !== tag()) throw new HttpFetchError(409, 'Conflict');
      attributes = { ...attributes, ...changes };
      version += 1;
      return { version: tag() };
    },
  };
  return { store, calls, stored: () => attributes, changeElsewhere };
}

const counts = (text: unknown) =>
  Object.fromEntries((JSON.parse(String(text)) as Field[]).map((item) => [item.name, item.count]));
const countOf = (pattern: IndexPattern, name: string) => pattern.fields.find((item) => item.name === name)?.count;
const shape = (calls: Call[]) => calls.map((call) => `${call.method}${call.version ? ` ${call.version}` : ''}`);

describe('Discover: a field written into the pattern', () => {
  it('has the keys of the original IndexPatternField.toJSON, in its order', () => {
    // The reference's first field: ["count","name","type","esTypes","scripted","searchable","aggregatable","readFromDocValues"]
    assert.deepEqual(Object.keys(fieldJson(field('@timestamp', 'date'))), [
      'count',
      'name',
      'type',
      'esTypes',
      'scripted',
      'searchable',
      'aggregatable',
      'readFromDocValues',
    ]);
    assert.equal(
      JSON.stringify(fieldJson({ name: 'agent', type: 'string', searchable: true, aggregatable: false, subType: { multi: { parent: 'a' } }, count: 4 })),
      '{"count":4,"name":"agent","type":"string","scripted":false,"searchable":true,"aggregatable":false,"readFromDocValues":false,"subType":{"multi":{"parent":"a"}}}'
    );
  });

  it('writes a scripted field as searchable and aggregatable, not read from doc values', () => {
    const scripted = { name: 's', type: 'number', scripted: true, script: "doc['b'].value", lang: 'painless', searchable: false, aggregatable: false, readFromDocValues: true };
    assert.equal(
      JSON.stringify(fieldJson(scripted)),
      '{"count":0,"script":"doc[\'b\'].value","lang":"painless","name":"s","type":"number","scripted":true,"searchable":true,"aggregatable":true,"readFromDocValues":false}'
    );
  });

  it('says which fields the original reads anew as it opens the pattern', () => {
    assert.equal(refreshRequired(logs().fields), false);
    assert.equal(refreshRequired([{ name: 'a', type: 'string' } as Field, { name: 'b', type: 'number', searchable: true, aggregatable: true } as Field]), true);
    assert.equal(refreshRequired([{ name: 'a', type: 'string' } as Field, field('b', 'number')]), false);
  });
});

describe('Discover: field popularity', () => {
  it('counts each pick and writes it with the version of the write before, as the reference', async () => {
    const pattern = logs();
    const { store, calls, stored } = fakeStore(pattern);
    // Add extension, add bytes, move extension, take bytes out, take extension out
    for (const name of ['extension', 'bytes', 'extension', 'bytes', 'extension']) await popularizeField(pattern, name, store);
    assert.deepEqual(shape(calls), ['GET', 'PUT v1', 'PUT v2', 'PUT v3', 'PUT v4', 'PUT v5']);
    const puts = calls.filter((call) => call.method === 'PUT');
    for (const put of puts) assert.deepEqual(Object.keys(put.attributes ?? {}), ['title', 'timeFieldName', 'fields']);
    assert.deepEqual(
      puts.map((put) => [counts(put.attributes?.fields).extension, counts(put.attributes?.fields).bytes]),
      [
        [1, 0],
        [1, 1],
        [2, 1],
        [2, 2],
        [3, 2],
      ]
    );
    assert.equal(countOf(pattern, 'extension'), 3);
    assert.equal(countOf(pattern, 'bytes'), 2);
    assert.deepEqual(counts(stored().fields), { timestamp: 0, extension: 3, bytes: 2 });
    // The formats stay as they are stored
    assert.equal(stored().fieldFormatMap, '{"hour_of_day":{}}');
  });

  it('writes one pick after the other when they come at once, each with its own count', async () => {
    const pattern = logs();
    const { store, calls } = fakeStore(pattern);
    await Promise.all([popularizeField(pattern, 'extension', store), popularizeField(pattern, 'bytes', store)]);
    assert.deepEqual(shape(calls), ['GET', 'PUT v1', 'PUT v2']);
    assert.deepEqual(counts(calls[1].attributes?.fields), { timestamp: 0, extension: 1, bytes: 0 });
    assert.deepEqual(counts(calls[2].attributes?.fields), { timestamp: 0, extension: 1, bytes: 1 });
  });

  it('counts on the page but writes nothing when the fields were changed elsewhere since', async () => {
    const pattern = logs();
    const { store, calls, stored, changeElsewhere } = fakeStore(pattern);
    const other = JSON.stringify([...pattern.fields, field('memory', 'number')]);
    changeElsewhere({ fields: other });
    await popularizeField(pattern, 'extension', store);
    await popularizeField(pattern, 'bytes', store);
    assert.deepEqual(shape(calls), ['GET']);
    assert.equal(countOf(pattern, 'extension'), 1);
    assert.equal(countOf(pattern, 'bytes'), 1);
    assert.equal(stored().fields, other);
  });

  it('takes what changed elsewhere besides the fields, and writes again', async () => {
    const pattern = logs();
    // Renamed elsewhere between the page's read and its write
    let once = true;
    const fake = fakeStore(pattern, {
      afterGet: (changeElsewhere) => {
        if (once) changeElsewhere({ title: 'renamed-*' });
        once = false;
      },
    });
    await popularizeField(pattern, 'extension', fake.store);
    assert.deepEqual(shape(fake.calls), ['GET', 'PUT v1', 'GET', 'PUT v2']);
    assert.equal(fake.calls[3].attributes?.title, 'renamed-*');
    assert.equal(fake.stored().title, 'renamed-*');
    assert.deepEqual(counts(fake.stored().fields), { timestamp: 0, extension: 1, bytes: 0 });
  });

  it('stops writing once the pattern changed elsewhere after a write of its own', async () => {
    // The original compares with the fields as it read them: the stored ones are now its own
    const pattern = logs();
    const { store, calls, stored, changeElsewhere } = fakeStore(pattern);
    await popularizeField(pattern, 'extension', store);
    changeElsewhere({ title: 'renamed-*' });
    await popularizeField(pattern, 'bytes', store);
    await popularizeField(pattern, 'bytes', store);
    assert.deepEqual(shape(calls), ['GET', 'PUT v1', 'PUT v2', 'GET']);
    assert.equal(stored().title, 'renamed-*');
    assert.deepEqual(counts(stored().fields), { timestamp: 0, extension: 1, bytes: 0 });
    assert.equal(countOf(pattern, 'bytes'), 2);
  });

  it('makes the write at most four times when it is refused each time, and lets it go', async () => {
    const pattern = logs();
    const { store, calls } = fakeStore(pattern, { failWith: 409 });
    await popularizeField(pattern, 'extension', store);
    assert.deepEqual(shape(calls), ['GET', 'PUT v1', 'GET', 'PUT v1', 'GET', 'PUT v1', 'GET', 'PUT v1']);
    assert.equal(countOf(pattern, 'extension'), 1);
  });

  it('lets a write that fails go, and the next pick writes again', async () => {
    const pattern = logs();
    const options: { failWith?: number } = { failWith: 500 };
    const { store, calls, stored } = fakeStore(pattern, options);
    await popularizeField(pattern, 'extension', store);
    assert.deepEqual(shape(calls), ['GET', 'PUT v1']);
    assert.equal(countOf(pattern, 'extension'), 1);
    options.failWith = undefined;
    await popularizeField(pattern, 'extension', store);
    assert.deepEqual(shape(calls), ['GET', 'PUT v1', 'PUT v1']);
    assert.deepEqual(counts(stored().fields), { timestamp: 0, extension: 2, bytes: 0 });
  });

  it('counts nothing for a field the pattern does not have, or a pattern without an id', async () => {
    const pattern = logs();
    const { store, calls } = fakeStore(pattern);
    await popularizeField(pattern, 'unknown', store);
    await popularizeField({ ...pattern, id: '' }, 'extension', store);
    assert.deepEqual(calls, []);
    assert.equal(countOf(pattern, 'extension'), undefined);
  });

  it('writes the fields of a pattern stored without them, which the page read from OpenSearch', async () => {
    const pattern = logs();
    const { store, calls, stored } = fakeStore(pattern, { fields: '[]' });
    await popularizeField(pattern, 'bytes', store);
    assert.deepEqual(shape(calls), ['GET', 'PUT v1']);
    assert.deepEqual(counts(stored().fields), { timestamp: 0, extension: 0, bytes: 1 });
  });

  it('writes nothing of fields the original would read anew as it opens the pattern', async () => {
    const pattern: IndexPattern = { ...logs(), fields: [{ name: 'extension', type: 'string' } as Field] };
    const { store, calls } = fakeStore(pattern);
    await popularizeField(pattern, 'extension', store);
    assert.deepEqual(calls, []);
    assert.equal(countOf(pattern, 'extension'), 1);
  });

  it('goes on writing for the pattern whose fields were read anew, after what was written', async () => {
    const pattern = logs();
    const { store, calls, stored } = fakeStore(pattern);
    await popularizeField(pattern, 'extension', store);
    const refreshed: IndexPattern = { ...pattern, fields: [...pattern.fields.map((item) => ({ ...item })), field('memory', 'number')] };
    keepPopularity(pattern, refreshed);
    await popularizeField(refreshed, 'memory', store);
    assert.deepEqual(shape(calls), ['GET', 'PUT v1', 'PUT v2']);
    assert.deepEqual(counts(stored().fields), { timestamp: 0, extension: 1, bytes: 0, memory: 1 });
    assert.equal(fieldsJson(refreshed.fields), stored().fields);
  });
});

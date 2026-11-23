/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HttpError } from '../../server/http';
import {
  failureOf,
  previewRequestOf,
  previewSearchOf,
  SCRIPTING_LANGUAGES,
} from '../../server/index_pattern_management';
import { readFieldCaps } from '../../server/index_pattern_fields';
import { OpenSearchError } from '../../server/opensearch';

describe('the routes of the index pattern pages', () => {
  it('lists the scripting languages the original lists', () => {
    assert.deepEqual(SCRIPTING_LANGUAGES, ['painless', 'expression']);
  });

  it('checks the body of a preview as the original schema does', () => {
    assert.deepEqual(previewRequestOf({ index: 'logs*', name: 'f', script: 'doc', additionalFields: [] }), {
      index: 'logs*',
      name: 'f',
      script: 'doc',
      query: undefined,
      additionalFields: [],
    });
    assert.throws(() => previewRequestOf({ index: 'logs*', name: 'f' }), (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 400);
      assert.equal(error.message, '[request body.script]: expected value of type [string] but got [undefined]');
      return true;
    });
    assert.throws(() => previewRequestOf(undefined), HttpError);
  });

  it('previews a script on ten documents, as a painless script field', () => {
    const search = previewSearchOf({ index: 'logs*', name: 'twice', script: "doc['bytes'].value * 2", additionalFields: ['agent', 'bytes'] });
    assert.equal(search.method, 'POST');
    assert.equal(search.path, '/logs*/_search');
    assert.deepEqual(search.query, { size: 10, timeout: '30s', _source: 'agent,bytes' });
    assert.deepEqual(search.body, {
      query: { match_all: {} },
      script_fields: { twice: { script: { lang: 'painless', source: "doc['bytes'].value * 2" } } },
    });
    const filtered = previewSearchOf({ index: 'a,b', name: 'x', script: '1', query: { term: { a: 1 } } });
    assert.equal(filtered.path, '/a%2Cb/_search');
    assert.equal(filtered.query._source, undefined);
    assert.deepEqual(filtered.body.query, { term: { a: 1 } });
  });

  it('answers a failure with the status and the error of OpenSearch', () => {
    const cause = { type: 'search_phase_execution_exception', reason: 'all shards failed' };
    const failure = failureOf(new OpenSearchError(400, { error: cause, status: 400 }, 'all shards failed'));
    assert.equal(failure.status, 400);
    assert.equal(failure.message, 'search_phase_execution_exception');
    assert.deepEqual(failure.attributes, { error: cause });
    const missing = failureOf(new OpenSearchError(404, { error: 'no such index' }, 'no such index'));
    assert.equal(missing.status, 404);
    assert.deepEqual(missing.attributes, { error: 'no such index' });
    assert.equal(failureOf(new Error('down')).status, 500);
  });

  it('words a failure as the client of OpenSearch words it: the type, then each root cause', () => {
    const cause = {
      root_cause: [
        { type: 'script_exception', reason: 'compile error' },
        { type: 'script_exception', reason: 'runtime error' },
      ],
      type: 'search_phase_execution_exception',
      reason: 'all shards failed',
    };
    const failure = failureOf(new OpenSearchError(400, { error: cause, status: 400 }, 'all shards failed'));
    assert.equal(
      failure.message,
      'search_phase_execution_exception: [script_exception] Reason: compile error; [script_exception] Reason: runtime error'
    );
    assert.deepEqual(failure.attributes, { error: cause });
    const missing = { root_cause: [{ type: 'index_not_found_exception', reason: 'no such index [foo]' }], type: 'index_not_found_exception' };
    assert.equal(
      failureOf(new OpenSearchError(404, { error: missing, status: 404 }, 'no such index')).message,
      'index_not_found_exception: [index_not_found_exception] Reason: no such index [foo]'
    );
    // An error that is a text has no type: the client's own words
    assert.equal(failureOf(new OpenSearchError(404, { error: 'no such index' }, 'no such index')).message, 'Response Error');
  });

  it('describes _type, which OpenSearch no longer has, as any missing meta field', () => {
    const fields = readFieldCaps(
      { _id: { _id: { type: '_id', searchable: true, aggregatable: true } }, bytes: { long: { type: 'long', searchable: true, aggregatable: true } } },
      ['_source', '_id', '_type', '_index', '_score']
    );
    assert.deepEqual(
      fields.find((field) => field.name === '_type'),
      { name: '_type', type: 'string', searchable: false, aggregatable: false, readFromDocValues: false }
    );
    assert.deepEqual(fields.map((field) => field.name), ['_id', '_index', '_score', '_source', '_type', 'bytes']);
  });

  it('says of a field of several kinds which indices hold which, as the original', () => {
    // What OpenSearch answers for `url`, a text in the web logs and an object in another index
    const [url] = readFieldCaps(
      {
        url: {
          text: { type: 'text', searchable: true, aggregatable: false, indices: ['logs'] },
          object: { type: 'object', searchable: false, aggregatable: false, indices: ['.other_1'] },
        },
      },
      []
    );
    assert.equal(
      JSON.stringify(url),
      '{"name":"url","type":"conflict","esTypes":["text","object"],"searchable":true,"aggregatable":false,"readFromDocValues":false,' +
        '"conflictDescriptions":{"text":["logs"],"object":[".other_1"]}}'
    );
  });

  it('reads what a field can do as the original: what some of its indices can do, it can', () => {
    const fields = readFieldCaps(
      {
        // A number of two types, searched and aggregated on in one index only
        count: {
          long: { type: 'long', searchable: true, aggregatable: true, indices: ['a'] },
          integer: { type: 'integer', searchable: false, aggregatable: false, indices: ['b'] },
        },
        // One type, not searched and not aggregated on in one of its indices
        code: {
          keyword: { type: 'keyword', searchable: false, aggregatable: false, non_searchable_indices: ['b'], non_aggregatable_indices: ['b'] },
        },
        off: { keyword: { type: 'keyword', searchable: false, aggregatable: false } },
      },
      []
    );
    const flags = (name: string) => {
      const field = fields.find((item) => item.name === name);
      return [field?.type, field?.searchable, field?.aggregatable, field?.readFromDocValues];
    };
    assert.deepEqual(flags('count'), ['number', true, true, true]);
    assert.deepEqual(flags('code'), ['string', true, true, true]);
    assert.deepEqual(flags('off'), ['string', false, false, false]);
  });

  it('describes a meta field OpenSearch does not know as a text nothing can be done with, as the original', () => {
    const fields = readFieldCaps({ bytes: { long: { type: 'long', searchable: true, aggregatable: true } } }, ['_source', 'made_up']);
    assert.deepEqual(fields.find((field) => field.name === 'made_up'), {
      name: 'made_up',
      type: 'string',
      searchable: false,
      aggregatable: false,
      readFromDocValues: false,
    });
  });

  it('writes the keyword of a text under a nested field as the original: its parent, then the nested path', () => {
    const fields = readFieldCaps(
      {
        items: { nested: { type: 'nested', searchable: false, aggregatable: false } },
        'items.name': { text: { type: 'text', searchable: true, aggregatable: false } },
        'items.name.keyword': { keyword: { type: 'keyword', searchable: true, aggregatable: true } },
      },
      []
    );
    assert.equal(
      JSON.stringify(fields.find((field) => field.name === 'items.name.keyword')?.subType),
      '{"multi":{"parent":"items.name"},"nested":{"path":"items"}}'
    );
    assert.equal(JSON.stringify(fields.find((field) => field.name === 'items.name')?.subType), '{"nested":{"path":"items"}}');
  });
});

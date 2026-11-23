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
});

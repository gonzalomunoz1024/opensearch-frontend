/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it } from 'node:test';
import { createApp } from '../../server/app';
import { loadConfig } from '../../server/config';
import { HttpError } from '../../server/http';
import {
  failureOf,
  previewRequestOf,
  previewSearchOf,
  SCRIPTING_LANGUAGES,
} from '../../server/index_pattern_management';
import { readFieldCaps } from '../../server/index_pattern_fields';
import { silentLogger } from '../../server/logger';
import { OpenSearchError } from '../../server/opensearch';
import { fakeOpenSearch } from './fake_opensearch';
import { DIST_DIRECTORY } from './served';

/** The server as it is built, with an OpenSearch that answers {}, asked each request in turn: "status message" */
async function asked(requests: Array<{ method: string; path: string; body?: string }>): Promise<string[]> {
  const opensearch = await fakeOpenSearch();
  const { config } = loadConfig({
    env: { SERVER_HOST: '127.0.0.1', SERVER_PORT: '0', OPENSEARCH_HOSTS: JSON.stringify([opensearch.url]) },
  });
  const app = createApp({ config, logger: silentLogger, distDirectory: DIST_DIRECTORY });
  try {
    await app.start();
    const { port } = app.server.address() as AddressInfo;
    const answers: string[] = [];
    for (const { method, path, body } of requests) {
      const headers: Record<string, string> = { 'osd-xsrf': 'true', 'content-type': 'application/json' };
      if (body !== undefined) headers['content-length'] = String(Buffer.byteLength(body));
      answers.push(
        await new Promise<string>((done, failed) => {
          const request = http.request({ host: '127.0.0.1', port, method, path, headers, agent: false }, (response) => {
            const chunks: Buffer[] = [];
            response.on('data', (chunk: Buffer) => chunks.push(chunk));
            response.on('end', () => {
              const status = response.statusCode ?? 0;
              const text = Buffer.concat(chunks).toString('utf8');
              done(status === 200 ? '200' : `${status} ${String((JSON.parse(text) as { message?: unknown }).message)}`);
            });
          });
          request.on('error', failed);
          request.end(body);
        })
      );
    }
    return answers;
  } finally {
    await app.stop();
    await opensearch.close();
  }
}

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
    // in the words of the original's schema (measured)
    const refusals: Array<[unknown, string]> = [
      [{ index: 1, name: 'x', script: '1' }, '[request body.index]: expected value of type [string] but got [number]'],
      [{ index: 'a', name: 'x', script: '1', query: [] }, '[request body.query]: expected a plain object value, but found [Array] instead.'],
      [{ index: 'a', name: 'x', script: '1', additionalFields: 'type' }, '[request body.additionalFields]: could not parse array value from json input'],
      [{ index: 'a', name: 'x', script: '1', additionalFields: [1] }, '[request body.additionalFields.0]: expected value of type [string] but got [number]'],
      [{ index: 'a', name: 'x', script: '1', x: 1 }, '[request body.x]: definition for this key is missing'],
      [[], '[request body]: expected a plain object value, but found [Array] instead.'],
      [undefined, '[request body]: expected a plain object value, but found [null] instead.'],
    ];
    for (const [body, message] of refusals) assert.throws(() => previewRequestOf(body), { status: 400, message });
    assert.deepEqual(previewRequestOf({ index: 'a', name: 'x', script: '1', query: { match_all: {} } }).query, { match_all: {} });
  });

  it("checks the query of resolve_index and of a preview with the original's schemas, in their words", async () => {
    const resolve = '/internal/index-pattern-management/resolve_index/a*';
    const preview = '/internal/index-pattern-management/preview_scripted_field';
    const body = '{"index":"a","name":"x","script":"1"}';
    // as the original answers each (measured)
    assert.deepEqual(
      await asked([
        { method: 'GET', path: `${resolve}?expand_wildcards=x` },
        { method: 'GET', path: `${resolve}?expand_wildcards=open&expand_wildcards=all` },
        { method: 'GET', path: `${resolve}?y=1` },
        { method: 'GET', path: `${resolve}?expand_wildcards=hidden` },
        { method: 'POST', path: `${preview}?y=1`, body },
        { method: 'POST', path: `${preview}?dataSourceId=x`, body },
      ]),
      [
        '400 [request query.expand_wildcards]: SchemaTypeError: expected value to equal [none]',
        '400 [request query.expand_wildcards]: SchemaTypeError: expected value to equal [none]',
        '400 [request query.y]: definition for this key is missing',
        '200',
        '400 [request query.y]: definition for this key is missing',
        '200',
      ]
    );
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

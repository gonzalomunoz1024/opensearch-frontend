/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import { describe, it } from 'node:test';
import { registerGeospatial, responseErrorMessage } from '../../server/geospatial';
import { HttpError, Router, type Reply } from '../../server/http';
import type { OpenSearchClient, OpenSearchRequest } from '../../server/opensearch';

interface Answer {
  status: number;
  body: unknown;
}

/** The routes over a stand-in for OpenSearch that records what it is asked and answers in turn */
function setUp(answers: Answer[] = []) {
  const asked: OpenSearchRequest[] = [];
  const client = {
    raw: async (request: OpenSearchRequest) => {
      asked.push(request);
      const answer = answers.shift() ?? { status: 200, body: {} };
      return {
        status: answer.status,
        headers: { 'content-type': 'application/json' },
        body: Buffer.from(JSON.stringify(answer.body)),
      };
    },
  } as unknown as OpenSearchClient;
  const router = new Router();
  registerGeospatial(router, client);
  const call = async (path: string, body: string, query = 'dataSourceId='): Promise<Reply> => {
    const { route } = router.match('POST', path);
    assert.ok(route, `no route for ${path}`);
    const handler = (route as NonNullable<typeof route>).handler;
    try {
      return await handler({
        req: {} as IncomingMessage,
        method: 'POST',
        path,
        query: new URLSearchParams(query),
        params: {},
        body: async () => Buffer.from(body),
        json: async <T>() => {
          if (!body.trim()) return undefined;
          try {
            return JSON.parse(body) as T;
          } catch {
            throw new HttpError(400, 'Invalid request payload JSON format');
          }
        },
      });
    } catch (error) {
      if (error instanceof HttpError) return { status: error.status, body: { message: error.message } };
      throw error;
    }
  };
  return { call, asked };
}

const refused = (message: string) => ({ status: 400, body: { message } });

describe('the geospatial routes of region_map', () => {
  it('lists the custom vector maps by their index names', async () => {
    const { call, asked } = setUp([{ status: 200, body: [{ index: 'countries-map', health: 'green' }, { index: 'states-map' }] }]);
    assert.deepEqual(await call('/api/geospatial/_indices', '{"index":"*-map"}'), {
      body: { ok: true, resp: ['countries-map', 'states-map'] },
    });
    assert.equal(asked[0].method, 'GET');
    assert.equal(asked[0].path, '/_cat/indices/*-map');
    assert.deepEqual(asked[0].query, { format: 'json' });
  });

  it('asks for a custom vector map\'s documents and mapping', async () => {
    const { call, asked } = setUp([
      { status: 200, body: { hits: { hits: [] } } },
      { status: 200, body: { 'states-map': { mappings: { properties: {} } } } },
    ]);
    assert.deepEqual(await call('/api/geospatial/_search', '{"index":"states-map","size":"10"}'), {
      body: { ok: true, resp: { hits: { hits: [] } } },
    });
    assert.deepEqual(asked[0], {
      method: 'POST',
      path: '/states-map/_search',
      query: { size: 10 },
      body: '{}',
      headers: { 'content-type': 'application/json' },
    });
    await call('/api/geospatial/_mappings', '{"index":"states-map"}');
    assert.equal(asked[1].path, '/states-map/_mapping');
  });

  it('checks its body as the plugin\'s schema does', async () => {
    const { call, asked } = setUp();
    const indices = (body: string) => call('/api/geospatial/_indices', body);
    assert.deepEqual(await indices('{"index":"foo"}'), refused('[request body.index]: Index name must end with "-map"'));
    assert.deepEqual(await indices('{}'), refused('[request body.index]: expected value of type [string] but got [undefined]'));
    assert.deepEqual(await indices('{"index":5}'), refused('[request body.index]: value.endsWith is not a function'));
    assert.deepEqual(await indices('{"index":null}'), refused("[request body.index]: Cannot read properties of null (reading 'endsWith')"));
    assert.deepEqual(await indices('{"x":1,"index":"a-map"}'), refused('[request body.x]: definition for this key is missing'));
    assert.deepEqual(await indices('[]'), refused('[request body]: expected a plain object value, but found [Array] instead.'));
    assert.deepEqual(await indices('"s"'), refused('[request body]: could not parse object value from json input'));
    assert.deepEqual(await indices(''), refused('[request body]: expected a plain object value, but found [null] instead.'));
    assert.deepEqual(await indices('nope'), refused('Invalid request payload JSON format'));
    const search = (body: string) => call('/api/geospatial/_search', body);
    assert.deepEqual(await search('{"index":"x","size":"abc"}'), refused('[request body.size]: expected value of type [number] but got [string]'));
    assert.deepEqual(await search('{"index":"x","size":null}'), refused('[request body.size]: expected value of type [number] but got [null]'));
    assert.deepEqual(await search('{"index":"x","size":1e400}'), refused('[request body.size]: number.infinity'));
    assert.equal(asked.length, 0);
  });

  it('refuses another data source, as the data source plugin is off', async () => {
    const { call } = setUp();
    assert.deepEqual(
      await call('/api/geospatial/_mappings', '{"index":"x"}', 'dataSourceId=abc'),
      refused("Cannot read properties of undefined (reading 'opensearch')")
    );
  });

  it('words a failure of OpenSearch as its client does, in a 400', async () => {
    const missing = {
      error: {
        root_cause: [{ type: 'index_not_found_exception', reason: 'no such index [nope]' }],
        type: 'index_not_found_exception',
        reason: 'no such index [nope]',
      },
      status: 404,
    };
    const { call } = setUp([{ status: 404, body: missing }]);
    assert.deepEqual(
      await call('/api/geospatial/_mappings', '{"index":"nope"}'),
      refused('index_not_found_exception: [index_not_found_exception] Reason: no such index [nope]')
    );
    assert.equal(responseErrorMessage({ error: { type: 'x' } }), 'x');
    assert.equal(responseErrorMessage({ found: false }), '{"found":false}');
    assert.equal(responseErrorMessage(''), 'Response Error');
  });
});

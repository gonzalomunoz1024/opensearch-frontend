/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { createApp } from '../../server/app';
import { loadConfig } from '../../server/config';
import { legacyClientMessage } from '../../server/index_pattern_fields';
import { parseLongNumerals, compactJson } from '../../server/json_numbers';
import { silentLogger } from '../../server/logger';
import { snakeCase } from '../../server/search_routes';

interface Seen {
  method: string;
  url: string;
  body: string;
}

const listen = (server: http.Server): Promise<number> =>
  new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)));

const close = (server: http.Server): Promise<void> =>
  new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });

/** A server whose OpenSearch answers each request with what `answer` makes of it */
async function serverWith(answer: (seen: Seen) => { status?: number; body: string }) {
  const seen: Seen[] = [];
  const sockets = new Set<Socket>();
  const opensearch = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const request = { method: req.method ?? '', url: req.url ?? '', body: Buffer.concat(chunks).toString('utf8') };
      if (request.url.startsWith('/.kibana/_doc/config')) {
        // no advanced setting is stored
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end('{"found":false}');
        return;
      }
      seen.push(request);
      const { status = 200, body } = answer(request);
      res.writeHead(status, { 'content-type': 'application/json; charset=UTF-8' });
      res.end(body);
    });
  });
  opensearch.on('connection', (socket: Socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  const opensearchPort = await listen(opensearch);
  const directory = mkdtempSync(join(tmpdir(), 'zz-agent-srv-search-'));
  writeFileSync(join(directory, 'build.json'), JSON.stringify({ version: '0.0.0', builtAt: '', assets: { script: '', styles: '' } }));
  const file = join(directory, 'settings.yml');
  writeFileSync(file, `opensearch.hosts: ["http://127.0.0.1:${opensearchPort}"]\n`);
  const app = createApp({ config: loadConfig({ file, env: {} }).config, logger: silentLogger, distDirectory: directory });
  const port = await listen(app.server);
  const ask = (method: string, target: string, body?: string): Promise<{ status: number; type?: string; body: string }> =>
    new Promise((resolve, reject) => {
      const headers: Record<string, string> = { 'osd-xsrf': 'true' };
      if (body !== undefined) {
        headers['content-type'] = 'application/json';
        headers['content-length'] = String(Buffer.byteLength(body));
      }
      const request = http.request({ host: '127.0.0.1', port, method, path: target, headers, agent: false }, (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () =>
          resolve({ status: response.statusCode ?? 0, type: response.headers['content-type'], body: Buffer.concat(chunks).toString('utf8') })
        );
      });
      request.on('error', reject);
      request.end(body);
    });
  return {
    seen,
    ask,
    stop: async () => {
      await close(app.server);
      for (const socket of sockets) socket.destroy();
      await close(opensearch);
    },
  };
}

const SEARCH_ANSWER =
  '{"took":1,"timed_out":false,"_shards":{"total":2,"successful":1,"skipped":0,"failed":1},' +
  '"hits":{"total":{"value":4,"relation":"eq"},"max_score":1.0,"hits":[{"_id":"a","_score":1.0,"fields":{"x":[1.0],"y":[9007199254740993]}}]}}';

describe('the search route of the original, /internal/search/{strategy}', () => {
  it("asks OpenSearch with the strategy's parameters, and answers in the original's shape", async () => {
    const server = await serverWith(() => ({ body: SEARCH_ANSWER }));
    try {
      const answer = await server.ask(
        'POST',
        '/internal/search/opensearch?anything=1',
        JSON.stringify({ params: { index: 'logs-*,other', ignoreUnavailable: false, preference: 'p', body: { size: 1 } } })
      );
      assert.equal(answer.status, 200);
      assert.equal(answer.type, 'application/json; charset=utf-8');
      assert.deepEqual(server.seen, [
        {
          method: 'POST',
          url: '/logs-*%2Cother/_search?ignore_unavailable=false&track_total_hits=true&timeout=30000ms&preference=p',
          body: '{"size":1}',
        },
      ]);
      // the total of the hits a number (shimHitsTotal), the shards counted, numbers as JSON.parse reads them
      assert.equal(
        answer.body,
        '{"isPartial":false,"isRunning":false,"rawResponse":{"took":1,"timed_out":false,' +
          '"_shards":{"total":2,"successful":1,"skipped":0,"failed":1},"hits":{"total":4,"max_score":1,' +
          '"hits":[{"_id":"a","_score":1,"fields":{"x":[1],"y":[9007199254740992]}}]}},"total":2,"loaded":2}'
      );
      // the same with long numerals, and with an id, which the strategy does not use
      const long = await server.ask('POST', '/internal/search/opensearch-with-long-numerals/abc', '{"params":{"index":"logs"}}');
      assert.match(long.body, /"y":\[9007199254740993\]/);
      assert.deepEqual(server.seen[1], {
        method: 'GET',
        url: '/logs/_search?ignore_unavailable=true&track_total_hits=true&timeout=30000ms',
        body: '',
      });
      assert.equal((await server.ask('DELETE', '/internal/search/opensearch/abc')).status, 200);
    } finally {
      await server.stop();
    }
  });

  it('answers what failed as the original does', async () => {
    const server = await serverWith(() => ({
      status: 400,
      body: '{"error":{"root_cause":[{"type":"parsing_exception","reason":"unknown query [bad]"}],"type":"parsing_exception","reason":"unknown query [bad]"},"status":400}',
    }));
    try {
      const failed = await server.ask('POST', '/internal/search/opensearch', '{"params":{"index":"logs","body":{"query":{"bad":{}}}}}');
      assert.equal(failed.status, 400);
      assert.deepEqual(JSON.parse(failed.body), {
        statusCode: 400,
        error: 'Bad Request',
        message: 'parsing_exception: [parsing_exception] Reason: unknown query [bad]',
        attributes: {
          error: {
            root_cause: [{ type: 'parsing_exception', reason: 'unknown query [bad]' }],
            type: 'parsing_exception',
            reason: 'unknown query [bad]',
          },
        },
      });
      const said = async (target: string, body?: string) => {
        const answer = await server.ask('POST', target, body);
        return `${answer.status} ${(JSON.parse(answer.body) as { message: string }).message}`;
      };
      assert.equal(await said('/internal/search/nope', '{}'), '500 Search strategy nope not found');
      assert.equal(await said('/internal/search/opensearch'), '400 [request body]: expected a plain object value, but found [null] instead.');
      assert.equal(await said('/internal/search/opensearch', '[]'), '400 [request body]: expected a plain object value, but found [Array] instead.');
      assert.equal(await said('/internal/search/opensearch', '{"indexType":"x"}'), '500 Unsupported index pattern type x');
      assert.equal(server.seen.length, 1);
      // GET is no method of the route
      assert.equal((await server.ask('GET', '/internal/search/opensearch')).status, 404);
    } finally {
      await server.stop();
    }
  });
});

describe('the fields of an index pattern, /api/index_patterns/_fields_for_wildcard', () => {
  const FIELD_CAPS =
    '{"indices":["logs"],"fields":{"_id":{"_id":{"type":"_id","searchable":true,"aggregatable":true}},' +
    '"bytes":{"long":{"type":"long","searchable":true,"aggregatable":true}}}}';

  it("checks the query with the original's schema, and asks for every index when the pattern is empty", async () => {
    const server = await serverWith(() => ({ body: FIELD_CAPS }));
    try {
      const said = async (query: string) => {
        const answer = await server.ask('GET', `/api/index_patterns/_fields_for_wildcard?${query}`);
        return `${answer.status} ${(JSON.parse(answer.body) as { message?: string }).message ?? ''}`;
      };
      assert.equal(await said(''), '400 [request query.pattern]: expected value of type [string] but got [undefined]');
      assert.equal(await said('pattern=a&pattern=b'), '400 [request query.pattern]: expected value of type [string] but got [Array]');
      assert.equal(await said('pattern=a&x=1'), '400 [request query.x]: definition for this key is missing');
      assert.match(await said('pattern=a&data_source=other'), /^400 \[request query\.data_source\]: there are no data sources/);
      assert.equal(server.seen.length, 0);
      assert.equal((await server.ask('GET', '/api/index_patterns/_fields_for_wildcard?pattern=')).status, 200);
      assert.equal(server.seen[0].url, '/_field_caps?fields=*&ignore_unavailable=true&allow_no_indices=false');
    } finally {
      await server.stop();
    }
  });

  it('gives the meta fields asked for, none when none is asked for, as the original', async () => {
    const server = await serverWith(() => ({ body: FIELD_CAPS }));
    try {
      const names = async (query: string) => {
        const answer = await server.ask('GET', `/api/index_patterns/_fields_for_wildcard?pattern=logs${query}`);
        return (JSON.parse(answer.body) as { fields: Array<{ name: string }> }).fields.map((field) => field.name);
      };
      assert.deepEqual(await names(''), ['bytes']);
      assert.deepEqual(await names('&meta_fields=_id&meta_fields=_source'), ['_id', '_source', 'bytes']);
      assert.deepEqual(await names(`&meta_fields=${encodeURIComponent('["_id"]')}`), ['_id', 'bytes']);
      // one meta field, as a browser sends a list of one (the original answers 400)
      assert.deepEqual(await names('&meta_fields=_id'), ['_id', 'bytes']);
    } finally {
      await server.stop();
    }
  });

  it('answers 404 for what OpenSearch could not do, with what it was, as the original', async () => {
    const server = await serverWith((seen) =>
      seen.url.startsWith('/none')
        ? {
            status: 404,
            body: '{"error":{"root_cause":[{"type":"index_not_found_exception","reason":"no such index [none]"}],"type":"index_not_found_exception","reason":"no such index [none]"},"status":404}',
          }
        : {
            status: 400,
            body: '{"error":{"root_cause":[{"type":"invalid_index_name_exception","reason":"Invalid index name [_bad], must not start with \'_\'.","index":"_bad","index_uuid":"_na_"}],"type":"invalid_index_name_exception","reason":"Invalid index name [_bad], must not start with \'_\'.","index":"_bad","index_uuid":"_na_"},"status":400}',
          }
    );
    try {
      const none = await server.ask('GET', '/api/index_patterns/_fields_for_wildcard?pattern=none*');
      assert.equal(none.status, 404);
      assert.deepEqual(JSON.parse(none.body), {
        statusCode: 404,
        error: 'Not Found',
        message: 'No indices match pattern "none*"',
        attributes: { statusCode: 404, error: 'Not Found', message: 'No indices match pattern "none*"', code: 'no_matching_indices' },
      });
      const bad = await server.ask('GET', '/api/index_patterns/_fields_for_wildcard?pattern=_bad');
      const said = 'Invalid index name [_bad], must not start with \'_\'.';
      const message = `[invalid_index_name_exception] ${said}, with { index="_bad" & index_uuid="_na_" }`;
      assert.equal(bad.status, 404);
      assert.deepEqual(JSON.parse(bad.body), {
        statusCode: 404,
        error: 'Not Found',
        message,
        attributes: { statusCode: 400, error: 'Bad Request', message },
      });
    } finally {
      await server.stop();
    }
  });
});

describe('the words of a failure of OpenSearch in the legacy client of the original', () => {
  it('are the types and reasons of its root causes, with what else they say', () => {
    assert.equal(
      legacyClientMessage(
        { error: { root_cause: [{ type: 'a', reason: 'one', at: { line: 1 } }, { type: 'b', reason: 'two' }], type: 'x' } },
        400
      ),
      '[a] one, with { at={ line=1 } } (and) [b] two'
    );
    assert.equal(legacyClientMessage({ error: { type: 'x', reason: 'why' } }, 400), '[x] why');
    assert.equal(legacyClientMessage({ error: 'text' }, 500), 'text');
    assert.equal(legacyClientMessage({}, 503), 'Service Unavailable');
  });
});

describe('JSON with its numbers', () => {
  it('read as @osd/std reads it keeps the digits of an integer past the safe range only', () => {
    assert.equal(
      JSON.stringify(parseLongNumerals('{"a":1.0,"b":12345678901234567890,"c":1.5E30,"d":-9007199254740993,"e":9007199254740991}')),
      '{"a":1,"b":12345678901234567890,"c":1.5e+30,"d":-9007199254740993,"e":9007199254740991}'
    );
  });

  it('written again without spaces keeps every number as written, and is undefined for what is no JSON', () => {
    assert.equal(compactJson('{ "a" : [ 1.0, 1E3 ] }'), '{"a":[1.0,1E3]}');
    assert.equal(compactJson('{"a":'), undefined);
  });
});

describe("lodash's snakeCase, which the strategy names the parameters with", () => {
  it('writes the names of the parameters', () => {
    assert.deepEqual(
      ['ignoreUnavailable', 'trackTotalHits', 'maxConcurrentShardRequests', 'index', 'rest_total_hits_as_int', '_source', 'HTTPHeader'].map(snakeCase),
      ['ignore_unavailable', 'track_total_hits', 'max_concurrent_shard_requests', 'index', 'rest_total_hits_as_int', 'source', 'http_header']
    );
  });
});

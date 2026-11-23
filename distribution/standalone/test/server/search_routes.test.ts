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
import { timePatternMatches, timePatternToWildcard } from '../../server/index_pattern_time';
import { parseLongNumerals, compactJson } from '../../server/json_numbers';
import { silentLogger } from '../../server/logger';
import { pplJsonData, snakeCase } from '../../server/search_routes';

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
async function serverWith(answer: (seen: Seen) => { status?: number; body: string; type?: string }) {
  const seen: Seen[] = [];
  const sockets = new Set<Socket>();
  const opensearch = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const request = { method: req.method ?? '', url: req.url ?? '', body: Buffer.concat(chunks).toString('utf8') };
      if (request.url.startsWith('/.kibana/_doc/config')) {
        // the stored document of the advanced settings, with none set
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"_index":".kibana","_id":"config:0.0.0","found":true,"_source":{"type":"config","config":{}}}');
        return;
      }
      seen.push(request);
      const { status = 200, body, type = 'application/json; charset=UTF-8' } = answer(request);
      res.writeHead(status, { 'content-type': type });
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

describe('the fields of a time pattern, /api/index_patterns/_fields_for_time_pattern', () => {
  const ALIASES =
    '{"logstash-2026.11.21":{"aliases":{}},"logstash-2026.11.23":{"aliases":{"logstash-2026.11.22":{},"current":{}}},' +
    '"logstash-2026.11.2":{"aliases":{}},"logstash-other":{"aliases":{}}}';
  const FIELD_CAPS =
    '{"indices":["x"],"fields":{"_id":{"_id":{"type":"_id","searchable":true,"aggregatable":true}},' +
    '"bytes":{"long":{"type":"long","searchable":true,"aggregatable":true}}}}';
  const PATTERN = encodeURIComponent('[logstash-]YYYY.MM.DD');
  const route = '/api/index_patterns/_fields_for_time_pattern';

  it('reads the fields of the newest indices and aliases the pattern matches, as many as look_back', async () => {
    const server = await serverWith((seen) => ({ body: seen.url.includes('/_alias') ? ALIASES : FIELD_CAPS }));
    try {
      const answer = await server.ask('GET', `${route}?pattern=${PATTERN}&look_back=2&meta_fields=${encodeURIComponent('["_id"]')}`);
      assert.equal(answer.status, 200);
      assert.equal(answer.type, 'application/json; charset=utf-8');
      assert.deepEqual(
        (JSON.parse(answer.body) as { fields: Array<{ name: string }> }).fields.map((field) => field.name),
        ['_id', 'bytes']
      );
      assert.deepEqual(
        server.seen.map((seen) => `${seen.method} ${seen.url}`),
        [
          'GET /logstash-*/_alias?ignore_unavailable=true&allow_no_indices=false',
          'GET /logstash-2026.11.23,logstash-2026.11.22/_field_caps?fields=*&ignore_unavailable=true&allow_no_indices=false',
        ]
      );
    } finally {
      await server.stop();
    }
  });

  it("checks the query with the original's schema, and answers its plain 400 for meta fields that are no JSON", async () => {
    const server = await serverWith((seen) => ({ body: seen.url.includes('/_alias') ? ALIASES : FIELD_CAPS }));
    try {
      const said = async (query: string) => {
        const answer = await server.ask('GET', `${route}?${query}`);
        return `${answer.status} ${(JSON.parse(answer.body) as { message?: string }).message ?? ''}`;
      };
      assert.equal(await said(''), '400 [request query.pattern]: expected value of type [string] but got [undefined]');
      assert.equal(await said('pattern=a'), '400 [request query.look_back]: expected value of type [number] but got [undefined]');
      assert.equal(await said('pattern=a&look_back=x'), '400 [request query.look_back]: expected value of type [number] but got [string]');
      assert.equal(await said('pattern=a&look_back=0'), '400 [request query.look_back]: Value must be equal to or greater than [1].');
      assert.equal(await said('pattern=a&look_back=1&x=1'), '400 [request query.x]: definition for this key is missing');
      assert.equal(await said('pattern=a&look_back=1&meta_fields=_id'), '400 Bad Request');
      assert.match(await said('pattern=a&look_back=1&data_source=other'), /^400 \[request query\.data_source\]: there are no data sources/);
      assert.equal(server.seen.length, 0);
      const several = `${route}?pattern=${PATTERN}&look_back=1&interval=days&meta_fields=_id&meta_fields=_source`;
      assert.equal((await server.ask('GET', several)).status, 200);
    } finally {
      await server.stop();
    }
  });

  it('answers a plain 404 when nothing matches and for whatever OpenSearch could not do, as the original', async () => {
    const server = await serverWith((seen) =>
      seen.url.startsWith('/none')
        ? { status: 404, body: '{"error":{"type":"index_not_found_exception","reason":"no such index [none*]"},"status":404}' }
        : seen.url.includes('/_alias')
          ? { body: ALIASES }
          : { status: 400, body: '{"error":{"type":"illegal_argument_exception","reason":"no"},"status":400}' }
    );
    try {
      const plain = { statusCode: 404, error: 'Not Found', message: 'Not Found' };
      for (const pattern of ['[none-]YYYY', '[logstash-]YYYY', '[logstash-other]', '[logstash-]YYYY.MM.DD']) {
        const answer = await server.ask('GET', `${route}?pattern=${encodeURIComponent(pattern)}&look_back=1`);
        assert.equal(answer.status, 404, pattern);
        assert.deepEqual(JSON.parse(answer.body), plain, pattern);
      }
    } finally {
      await server.stop();
    }
  });
});

describe('the names a time pattern matches (as moment reads and writes them, measured with the original)', () => {
  const now = new Date(2026, 10, 23, 12);
  const matches = (pattern: string, names: string[]) => timePatternMatches(names, pattern, now);

  it('turns a time pattern into the wildcard that finds its candidates', () => {
    assert.equal(timePatternToWildcard('[logstash-]YYYY.MM.DD'), 'logstash-*');
    assert.equal(timePatternToWildcard('[a-]YYYY[-b-]MM'), 'a-*-b-*');
    assert.equal(timePatternToWildcard('YYYY.MM.DD'), '*');
    assert.equal(timePatternToWildcard('[.kibana][_1]'), '.kibana_1');
  });

  it('takes only names that are a valid time written exactly as the pattern writes it, the newest first', () => {
    assert.deepEqual(
      matches('[logstash-]YYYY.MM.DD', [
        'logstash-2026.11.23',
        'logstash-2026.11.22',
        'logstash-2026.02.29',
        'logstash-2024.02.29',
        'logstash-2026.13.01',
        'logstash-2026.1.01',
        'logstash-2026.11.23x',
        'xlogstash-2026.11.23',
        'logstash-0099.01.01',
        'logstash-2026.11.00',
        'logstash-2026.11.31',
        'logstash-2026.11.30',
        'logstash-2026.11.30',
      ]),
      ['logstash-2026.11.30', 'logstash-2026.11.23', 'logstash-2026.11.22', 'logstash-2024.02.29', 'logstash-0099.01.01']
    );
    assert.deepEqual(
      matches('[logstash-]YYYY.MM.DD.HH', ['logstash-2026.11.23.00', 'logstash-2026.11.23.23', 'logstash-2026.11.23.24', 'logstash-2026.11.23.1']),
      ['logstash-2026.11.23.23', 'logstash-2026.11.23.00']
    );
    assert.deepEqual(matches('[a-]YYYY.M.D', ['a-2026.1.1', 'a-2026.11.23', 'a-2026.01.01']), ['a-2026.11.23', 'a-2026.1.1']);
    assert.deepEqual(matches('[a-]YYYY-DDDD', ['a-2026-001', 'a-2026-365', 'a-2026-366', 'a-2024-366', 'a-2026-000']), [
      'a-2026-365',
      'a-2026-001',
      'a-2024-366',
    ]);
    assert.deepEqual(matches('[a-]YYYY-[Q]Q', ['a-2026-Q1', 'a-2026-Q4', 'a-2026-Q5', 'a-2026-Q0']), ['a-2026-Q4', 'a-2026-Q1']);
    assert.deepEqual(matches('[a-]YYYY\\Y', ['a-2026Y', 'a-20262026']), ['a-2026Y']);
  });

  it('reads ISO weeks, and refuses a week the year does not have', () => {
    assert.deepEqual(
      matches('[logstash-]GGGG.WW', [
        'logstash-2026.01',
        'logstash-2026.53',
        'logstash-2020.53',
        'logstash-2026.00',
        'logstash-2026.48',
        'logstash-2021.52',
        'logstash-2015.53',
      ]),
      ['logstash-2026.53', 'logstash-2026.48', 'logstash-2026.01', 'logstash-2021.52', 'logstash-2020.53', 'logstash-2015.53']
    );
    assert.deepEqual(matches('[a-]GGGG-[W]WW-E', ['a-2026-W48-1', 'a-2026-W48-7', 'a-2026-W48-8', 'a-2026-W48-0', 'a-2026-W01-1']), [
      'a-2026-W48-7',
      'a-2026-W48-1',
      'a-2026-W01-1',
    ]);
  });

  it('fills what a pattern leaves out from today above the largest part and from the start below it', () => {
    // the 23rd of November 2026: a day alone is a day of November, a month alone a month of 2026
    assert.deepEqual(matches('[.kibana_]D', ['.kibana_1', '.kibana_01', '.kibana_31', '.kibana_30', '.kibana_0']), ['.kibana_30', '.kibana_1']);
    assert.deepEqual(matches('[a-]MM.DD', ['a-02.29', 'a-02.28', 'a-11.31', 'a-11.30']), ['a-11.30', 'a-02.28']);
    assert.deepEqual(matches('[a-]YYYY.DD', ['a-2026.31', 'a-2026.01', 'a-2026.32']), ['a-2026.31', 'a-2026.01']);
    assert.deepEqual(matches('[a-]HH:mm:ss', ['a-00:00:00', 'a-23:59:59', 'a-24:00:00', 'a-12:60:00']), ['a-23:59:59', 'a-00:00:00']);
  });

  it('takes no name for a pattern with no part of a time, or with a part that is not read here', () => {
    assert.deepEqual(matches('[.kibana][_1]', ['.kibana_1']), []);
    assert.deepEqual(matches('[a-]MMM', ['a-Nov']), []);
    assert.deepEqual(matches('[a-]YYYY.ww', ['a-2026.48']), []);
    assert.deepEqual(matches('[a-]L', ['a-11/23/2026']), []);
    assert.deepEqual(matches('[a-]X', ['a-1700000000']), []);
  });
});

describe('the plain PPL query of the original, /internal/search/pplraw', () => {
  const PPL_ANSWER =
    '{"schema":[{"name":"Carrier","type":"string"},{"name":"Cancelled","type":"boolean"},{"name":"Dest","type":"geo_point"},{"name":"n","type":"bigint"}],' +
    '"datarows":[["A",false,{"lat":1.5,"lon":2},7],["B",true,null,8]],"total":2,"size":2}';

  it("sends the body of the params to the PPL plugin, and answers its rows also as objects, in the original's shape", async () => {
    const server = await serverWith(() => ({ body: PPL_ANSWER }));
    try {
      const query = { query: 'source=flights | head 2' };
      const answer = await server.ask('POST', '/internal/search/pplraw', JSON.stringify({ params: { body: query, index: 'x' }, indexType: 'x' }));
      assert.equal(answer.status, 200);
      assert.equal(answer.type, 'application/json; charset=utf-8');
      assert.deepEqual(server.seen, [{ method: 'POST', url: '/_plugins/_ppl', body: JSON.stringify(query) }]);
      assert.equal(
        answer.body,
        `{"rawResponse":{${PPL_ANSWER.slice(1, -1)},"jsonData":[` +
          '{"Carrier":"A","Cancelled":"false","Dest":"{\\"lat\\":1.5,\\"lon\\":2}","n":7},{"Carrier":"B","Cancelled":"true","Dest":"null","n":8}],"hits":{}}}'
      );
      // a body written as text goes as it is; with an id in the address, the same; nothing can be stopped
      await server.ask('POST', '/internal/search/pplraw/an-id', JSON.stringify({ params: { body: '{"query":"x"}' } }));
      assert.equal(server.seen[1].body, '{"query":"x"}');
      await server.ask('POST', '/internal/search/pplraw', JSON.stringify({ params: {} }));
      assert.equal(server.seen[2].body, '');
      assert.equal((await server.ask('DELETE', '/internal/search/pplraw/an-id')).status, 200);
    } finally {
      await server.stop();
    }
  });

  it("answers a failure in the words of the original's legacy client", async () => {
    const parsed =
      '{"error":{"root_cause":[{"type":"illegal_argument_exception","reason":"Failed to parse request payload"}],' +
      '"type":"illegal_argument_exception","reason":"Failed to parse request payload"},"status":400}';
    let type = 'application/json; charset=UTF-8';
    let status = 400;
    const server = await serverWith(() => ({ status, body: parsed, type }));
    try {
      const ask = async (body: string) => {
        const answer = await server.ask('POST', '/internal/search/pplraw', body);
        return { status: answer.status, ...(JSON.parse(answer.body) as { message: string; attributes: unknown }) };
      };
      const json = await ask('{"params":{"body":{}}}');
      assert.equal(json.status, 400);
      assert.equal(json.message, '[illegal_argument_exception] Failed to parse request payload');
      assert.deepEqual(json.attributes, { error: (JSON.parse(parsed) as { error: unknown }).error });
      // the PPL plugin types its own failures as text, which the legacy client does not read
      type = 'text/plain; charset=UTF-8';
      status = 404;
      const text = await ask('{"params":{"body":{"query":"source=none"}}}');
      assert.equal(text.status, 404);
      assert.equal(text.message, 'Not Found');
      assert.deepEqual(text.attributes, { error: 'Not Found' });
      const none = await ask('{}');
      assert.equal(none.status, 500);
      assert.equal(none.message, "Cannot read properties of undefined (reading 'body')");
      assert.equal(server.seen.length, 2);
    } finally {
      await server.stop();
    }
  });

  it('writes rows as objects by column name: objects as JSON, true and false as text (shimSchemaRow)', () => {
    assert.deepEqual(pplJsonData({ schema: [{ name: 'a' }, { name: 'b' }], datarows: [[1, [2], 'more'], ['x', false]] }), [
      { a: 1, b: '[2]' },
      { a: 'x', b: 'false' },
    ]);
  });
});

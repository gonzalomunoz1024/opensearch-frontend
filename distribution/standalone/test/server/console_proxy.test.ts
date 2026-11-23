/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { createApp } from '../../server/app';
import { loadConfig } from '../../server/config';
import { consolePath } from '../../server/console_proxy';
import { silentLogger } from '../../server/logger';

interface Seen {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

interface Answer {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

const listen = (server: http.Server): Promise<number> =>
  new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)));

const close = (server: http.Server): Promise<void> =>
  new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });

type Script = (seen: Seen, res: http.ServerResponse) => void;

const answerOk: Script = (_seen, res) => {
  res.writeHead(200, { 'content-type': 'application/json', warning: '299 OpenSearch-3.9.0 "[old] is deprecated"' });
  res.end('{"ok":true}');
};

/**
 * A server whose OpenSearch answers as the script says, with these lines of settings; `ask`
 * sends one request to the server (the target as it is written) and reads its answer
 */
async function harness(script: Script = answerOk, settings = '') {
  const seen: Seen[] = [];
  const sockets = new Set<Socket>();
  const opensearch = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const request = { method: req.method ?? '', url: req.url ?? '', headers: req.headers, body: Buffer.concat(chunks).toString('utf8') };
      // The server's own look at OpenSearch, and at its index, are not what is tested
      if (request.url === '/' || request.url.startsWith('/.kibana')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(request.url === '/' ? '{"version":{"number":"3.9.0"}}' : '{}');
        return;
      }
      seen.push(request);
      script(request, res);
    });
  });
  opensearch.on('connection', (socket: Socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  const opensearchPort = await listen(opensearch);
  const directory = mkdtempSync(join(tmpdir(), 'zz-agent-srv-console-'));
  writeFileSync(join(directory, 'build.json'), JSON.stringify({ version: '0.0.0', builtAt: '', assets: { script: '', styles: '' } }));
  const file = join(directory, 'settings.yml');
  writeFileSync(file, `opensearch.hosts: ["http://127.0.0.1:${opensearchPort}"]\n${settings}`);
  const errors: string[] = [];
  const app = createApp({
    config: loadConfig({ file, env: {} }).config,
    logger: { ...silentLogger, error: (message) => errors.push(message) },
    distDirectory: directory,
  });
  const port = await listen(app.server);
  const ask = (
    method: string,
    target: string,
    options: { body?: string | Buffer; headers?: Record<string, string> } = {}
  ): Promise<Answer> =>
    new Promise((resolve, reject) => {
      const headers: Record<string, string> = { 'osd-xsrf': 'true', ...options.headers };
      if (options.body !== undefined) headers['content-length'] = String(Buffer.byteLength(options.body));
      const request = http.request({ host: '127.0.0.1', port, method, path: target, headers, agent: false }, (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () =>
          resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') })
        );
      });
      request.on('error', reject);
      request.end(options.body);
    });
  const proxy = (query: string, options?: { body?: string | Buffer; headers?: Record<string, string> }) =>
    ask('POST', `/api/console/proxy?${query}`, options);
  return {
    seen,
    errors,
    port,
    opensearchPort,
    ask,
    proxy,
    stop: async () => {
      await close(app.server);
      for (const socket of sockets) socket.destroy();
      await close(opensearch);
    },
  };
}

const JSON_TYPE = 'application/json; charset=utf-8';
const message = (answer: Answer) => (JSON.parse(answer.body) as { message: string }).message;

describe("the console's proxy", () => {
  it('sends OpenSearch the request as it was written, with pretty=true as the original adds it', async () => {
    const server = await harness();
    try {
      const json = { 'content-type': 'application/json' };
      await server.proxy('path=_cat%2Findices%3Fv%26h%3Dindex&method=GET', { headers: json });
      await server.proxy('path=%2Flogs%2F_search&method=POST', { body: '{"size":0}\n', headers: json });
      await server.proxy('path=_search%3Fpretty%3Dfalse&method=GET');
      await server.proxy('path=nosuch%2F..%2F_cat%2Fhealth&method=GET');
      assert.deepEqual(
        server.seen.map((request) => [request.method, request.url, request.body, request.headers['content-type']]),
        [
          // the content type of the browser's request goes on, body or not, as in the original
          ['GET', '/_cat/indices?v=&h=index&pretty=true', '', 'application/json'],
          ['POST', '/logs/_search?pretty=true', '{"size":0}\n', 'application/json'],
          ['GET', '/_search?pretty=false', '', undefined],
          ['GET', '/_cat/health?pretty=true', '', undefined],
        ]
      );
    } finally {
      await server.stop();
    }
  });

  it("adds the headers the original's proxy adds, and an id of its own to each request", async () => {
    const server = await harness();
    try {
      await server.proxy('path=_cat%2Fmaster&method=GET');
      await server.proxy('path=_cat%2Fmaster&method=GET');
      const [first, second] = server.seen.map((request) => request.headers);
      assert.equal(first['x-forwarded-for'], '127.0.0.1');
      assert.match(String(first['x-forwarded-port']), /^\d+$/);
      assert.equal(first['x-forwarded-proto'], 'http');
      assert.equal(first['x-forwarded-host'], `127.0.0.1:${server.port}`);
      // OpenSearch warns of a deprecated API once for each "x-opaque-id": with none, the console
      // would show "#! Deprecation" the first time only
      assert.ok(String(first['x-opaque-id'] ?? '').length > 0 && String(second['x-opaque-id'] ?? '').length > 0);
      assert.notEqual(first['x-opaque-id'], second['x-opaque-id']);
    } finally {
      await server.stop();
    }
  });

  it("checks its query as the original's schema does, in its words, and sends nothing it refuses", async () => {
    const server = await harness();
    try {
      const refused = async (query: string) => {
        const answer = await server.proxy(query);
        return `${answer.status} ${message(answer)}`;
      };
      assert.equal(await refused('path=_cat'), '400 [request query.method]: expected value of type [string] but got [undefined]');
      assert.equal(
        await refused('method=FOO&path=x'),
        "400 [request query.method]: Method must be one of, case insensitive ['HEAD', 'GET', 'PATCH', 'POST', 'PUT', 'DELETE']. Received 'FOO'."
      );
      assert.equal(await refused('method=GET&path='), '400 [request query.path]: Expected non-empty string');
      assert.equal(await refused('method=GET'), '400 [request query.path]: expected value of type [string] but got [undefined]');
      assert.equal(await refused('method=GET&path=x&x=1'), '400 [request query.x]: definition for this key is missing');
      // the keys of the schema first, in its order
      assert.equal(await refused('x=1&path=a'), '400 [request query.method]: expected value of type [string] but got [undefined]');
      // (the original fails here with "method.toLowerCase is not a function", and sends two paths joined by a comma)
      assert.equal(await refused('method=GET&method=POST&path=x'), '400 [request query.method]: expected value of type [string] but got [Array]');
      assert.equal(await refused('method=GET&path=a&path=b'), '400 [request query.path]: expected value of type [string] but got [Array]');
      // (the original fails with a TypeError of its data sources, which are off)
      assert.match(await refused('method=GET&path=x&dataSourceId=other'), /^400 \[request query\.dataSourceId\]: there are no data sources/);
      assert.equal(server.seen.length, 0);

      assert.equal((await server.proxy('method=get&path=_cat')).status, 200);
      assert.equal((await server.proxy('method=GET&path=_cat&dataSourceId=')).status, 200);
      assert.deepEqual(server.seen.map((request) => request.method), ['GET', 'GET']);
      // GET is no method of the route: hapi answers that it is not there
      assert.equal((await server.ask('GET', '/api/console/proxy?method=GET&path=_cat')).status, 404);
    } finally {
      await server.stop();
    }
  });

  it('keeps to console.proxyFilter, with the 403 of the original', async () => {
    const server = await harness(answerOk, "console.proxyFilter: ['^_cat/', '^/?logs']\n");
    try {
      assert.equal((await server.proxy('method=GET&path=_cat%2Fhealth')).status, 200);
      assert.equal((await server.proxy('method=GET&path=%2Flogs%2F_count')).status, 200);
      const refused = await server.proxy('method=POST&path=_search', { body: '{}', headers: { 'content-type': 'application/json' } });
      assert.equal(refused.status, 403);
      assert.equal(refused.headers['content-type'], JSON_TYPE);
      assert.deepEqual(JSON.parse(refused.body), {
        statusCode: 403,
        error: 'Forbidden',
        message: "Error connecting to '_search':\n\nUnable to send requests to that path.",
      });
      assert.deepEqual(server.seen.map((request) => request.url), ['/_cat/health?pretty=true', '/logs/_count?pretty=true']);
    } finally {
      await server.stop();
    }
  });

  it('and the other routes of the console are not there when console.enabled is false', async () => {
    const server = await harness(answerOk, 'console.enabled: false\n');
    try {
      assert.equal((await server.proxy('method=GET&path=_cat')).status, 404);
      assert.equal((await server.ask('GET', '/api/console/opensearch_config')).status, 404);
      assert.equal((await server.ask('GET', '/api/console/api_server')).status, 404);
      assert.equal(server.seen.length, 0);
      // what the pages ask through stays
      assert.equal((await server.ask('POST', '/internal/opensearch?method=GET&path=_cat')).status, 200);
    } finally {
      await server.stop();
    }
  });

  it("answers JSON without its spaces, as the original's proxy does, and each number as OpenSearch wrote it", async () => {
    const server = await harness((_seen, res) => {
      res.writeHead(200, { 'content-type': 'application/json; charset=UTF-8' });
      res.end('{\n  "a" : 1.0,\n  "b" : [ 12345678901234567890, 1.5E30, -0 ],\n  "c" : "x\\u0001"\n}\n');
    });
    try {
      const answer = await server.proxy('method=GET&path=_search');
      assert.equal(answer.status, 200);
      assert.equal(answer.headers['content-type'], JSON_TYPE);
      assert.equal(answer.headers.warning, '');
      assert.equal(answer.body, '{"a":1.0,"b":[12345678901234567890,1.5E30,-0],"c":"x\\u0001"}');
    } finally {
      await server.stop();
    }
  });

  it('answers other text as OpenSearch typed it, with its warning, empty when there is none', async () => {
    const server = await harness((seen, res) => {
      res.writeHead(200, { 'content-type': 'text/plain; charset=UTF-8', ...(seen.url.includes('old') ? { warning: '299 OpenSearch "x"' } : {}) });
      res.end('green 1 1\n');
    });
    try {
      const answer = await server.proxy('method=GET&path=_cat%2Fhealth');
      assert.deepEqual([answer.status, answer.headers['content-type'], answer.headers.warning, answer.body], [
        200,
        'text/plain; charset=UTF-8',
        '',
        'green 1 1\n',
      ]);
      assert.equal((await server.proxy('method=GET&path=_cat%2Fold')).headers.warning, '299 OpenSearch "x"');
    } finally {
      await server.stop();
    }
  });

  it('answers a HEAD request with its status as text, and one that finds nothing as a 404 of its own', async () => {
    const server = await harness((seen, res) => {
      res.writeHead(seen.url.startsWith('/there') ? 200 : 404, { 'content-type': 'application/json' });
      res.end();
    });
    try {
      const found = await server.proxy('method=HEAD&path=there');
      assert.deepEqual([found.status, found.headers['content-type'], found.headers.warning, found.body], [
        200,
        'text/plain; charset=utf-8',
        '',
        '200 - true',
      ]);
      const missing = await server.proxy('method=HEAD&path=missing');
      assert.equal(missing.status, 404);
      assert.equal(missing.headers['content-type'], JSON_TYPE);
      assert.equal(missing.headers.warning, '');
      assert.deepEqual(JSON.parse(missing.body), { statusCode: 404, error: 'Not Found', message: '404 - false' });
    } finally {
      await server.stop();
    }
  });

  it('passes a failure of OpenSearch on with its status, as JSON and without a warning header', async () => {
    const server = await harness((seen, res) => {
      if (seen.url.startsWith('/json')) {
        res.writeHead(404, { 'content-type': 'application/json; charset=UTF-8', warning: '299 x' });
        res.end('{\n  "error" : { "type" : "index_not_found_exception" },\n  "status" : 404\n}');
      } else {
        res.writeHead(400, { 'content-type': 'text/plain' });
        res.end('no such thing');
      }
    });
    try {
      const json = await server.proxy('method=GET&path=json%2F_search');
      assert.deepEqual([json.status, json.headers['content-type'], json.headers.warning, json.body], [
        404,
        JSON_TYPE,
        undefined,
        '{"error":{"type":"index_not_found_exception"},"status":404}',
      ]);
      const text = await server.proxy('method=GET&path=text');
      assert.deepEqual([text.status, text.headers['content-type'], text.body], [400, JSON_TYPE, '"no such thing"']);
    } finally {
      await server.stop();
    }
  });

  it('answers 502 with what went wrong when OpenSearch does not answer in time, after the tries of opensearch-js', async () => {
    const server = await harness(() => undefined, 'opensearch.requestTimeout: 150\n');
    try {
      const answer = await server.proxy('method=GET&path=_cluster%2Fhealth');
      assert.deepEqual([answer.status, answer.headers['content-type'], answer.body], [502, JSON_TYPE, 'Request timed out']);
      // a request that only reads is sent again, three more times, as opensearch-js sends it
      assert.equal(server.seen.length, 4);
      server.seen.length = 0;
      // one that changes something may have been done meanwhile: it is not
      const write = await server.proxy('method=POST&path=logs%2F_doc', { body: '{"a":1}', headers: { 'content-type': 'application/json' } });
      assert.deepEqual([write.status, write.body], [502, 'Request timed out']);
      assert.equal(server.seen.length, 1);
      assert.deepEqual(server.errors, ['Request timed out', 'Request timed out']);
    } finally {
      await server.stop();
    }
  });

  it('answers 502 with the message of the connection that failed when OpenSearch is not there', async () => {
    const gone = http.createServer();
    const port = await listen(gone);
    await close(gone);
    // the server's OpenSearch, at an address where nothing listens
    const directory = mkdtempSync(join(tmpdir(), 'zz-agent-srv-console-'));
    writeFileSync(join(directory, 'build.json'), JSON.stringify({ version: '0.0.0', builtAt: '', assets: { script: '', styles: '' } }));
    const file = join(directory, 'settings.yml');
    writeFileSync(file, `opensearch.hosts: ["http://127.0.0.1:${port}"]\n`);
    const app = createApp({ config: loadConfig({ file, env: {} }).config, logger: silentLogger, distDirectory: directory });
    const appPort = await listen(app.server);
    try {
      const answer = await new Promise<Answer>((resolve, reject) => {
        const request = http.request(
          { host: '127.0.0.1', port: appPort, method: 'POST', path: '/api/console/proxy?method=GET&path=_cat', headers: { 'osd-xsrf': 'x' } },
          (response) => {
            const chunks: Buffer[] = [];
            response.on('data', (chunk: Buffer) => chunks.push(chunk));
            response.on('end', () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks).toString() }));
          }
        );
        request.on('error', reject);
        request.end();
      });
      assert.deepEqual([answer.status, answer.headers['content-type'], answer.body], [502, JSON_TYPE, `connect ECONNREFUSED 127.0.0.1:${port}`]);
    } finally {
      await close(app.server);
    }
  });

  it('refuses a body larger than server.maxPayloadBytes, before it looks for the osd-xsrf header, as hapi', async () => {
    const server = await harness();
    try {
      const big = Buffer.alloc(1048577, 32);
      const answer = await server.ask('POST', '/api/console/proxy?method=GET&path=_cat', { body: big });
      assert.deepEqual([answer.status, message(answer)], [413, 'Payload content length greater than maximum allowed: 1048576']);
      const withoutHeader = await new Promise<number>((resolve, reject) => {
        const request = http.request(
          {
            host: '127.0.0.1',
            port: server.port,
            method: 'POST',
            path: '/api/console/proxy?method=GET&path=_cat',
            headers: { 'content-length': String(big.length) },
            agent: false,
          },
          (response) => {
            response.resume();
            resolve(response.statusCode ?? 0);
          }
        );
        request.on('error', reject);
        request.end(big);
      });
      assert.equal(withoutHeader, 413);
      assert.equal(server.seen.length, 0);
      // one at the limit is sent
      const fits = await server.proxy('method=POST&path=_bulk', { body: Buffer.alloc(1048576, 32) });
      assert.equal(fits.status, 200);
    } finally {
      await server.stop();
    }
  });

  it("answers the original's spec definitions at /api/console/api_server, to GET and to POST", async () => {
    const server = await harness();
    try {
      const saved = readFileSync(join(__dirname, '..', '..', 'server', 'console_api_server.json'), 'utf8');
      for (const method of ['GET', 'POST']) {
        const answer = await server.ask(method, '/api/console/api_server');
        assert.deepEqual([answer.status, answer.headers['content-type']], [200, JSON_TYPE]);
        assert.equal(answer.body, saved);
      }
      const spec = JSON.parse(saved) as { opensearch: { name: string; endpoints: Record<string, unknown> } };
      assert.equal(spec.opensearch.name, 'opensearch');
      assert.ok('cat.health' in spec.opensearch.endpoints);
    } finally {
      await server.stop();
    }
  });
});

describe('the path the console asks OpenSearch for', () => {
  it("is the original's toUrlPath: steps taken, the query written again, pretty=true unless pretty is given", () => {
    assert.equal(consolePath('_cat/indices?v'), '/_cat/indices?v=&pretty=true');
    assert.equal(consolePath('//a/../b/./c?q=a b'), '/b/c?q=a+b&pretty=true');
    assert.equal(consolePath('_search?pretty=false'), '/_search?pretty=false');
    assert.equal(consolePath('_search?pretty'), '/_search?pretty=&pretty=true');
    assert.equal(consolePath('my index/_doc/1'), '/my%20index/_doc/1?pretty=true');
  });
});

/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The way every request goes through the server, as it goes through the original's
 * (src/core/server/http): what is refused before a route sees it, and what every answer carries.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net, { type AddressInfo, type Socket } from 'node:net';
import { hostname, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { createApp, withShardTimeout, type App } from '../../server/app';
import { loadConfig } from '../../server/config';
import { silentLogger } from '../../server/logger';
import { fakeOpenSearch } from './fake_opensearch';
import { CA_CERTIFICATE, CLIENT_CERTIFICATE, CLIENT_KEY, SERVER_KEY_PASSPHRASE, writeTlsFiles } from './tls_fixture';

const NO_CACHE = 'private, no-cache, no-store, must-revalidate';
const JSON_TYPE = { 'content-type': 'application/json' };
const XSRF = { 'osd-xsrf': 'true', ...JSON_TYPE };

interface Running {
  app: App;
  port: number;
  /** What the server logged as an error */
  errors: string[];
  stop(): Promise<void>;
}

/** The server as it is built, on a port of its own, talking to the OpenSearch at the address */
async function start(opensearch: string, settings: Record<string, string>, waitForGreen = true): Promise<Running> {
  const errors: string[] = [];
  const { config } = loadConfig({
    env: { SERVER_HOST: '127.0.0.1', SERVER_PORT: '0', OPENSEARCH_HOSTS: JSON.stringify([opensearch]), ...settings },
  });
  const app = createApp({
    config,
    logger: { ...silentLogger, error: (message) => errors.push(message) },
    distDirectory: resolve(__dirname, '..', '..'),
  });
  await app.start();
  if (waitForGreen) assert.equal((await app.checkHealth()).state, 'green');
  const { port } = app.server.address() as AddressInfo;
  return { app, port, errors, stop: () => app.stop() };
}

/** The server with a fake OpenSearch of its own, which answers as the function says, or with {} */
async function run(
  settings: Record<string, string> = {},
  answer: 'answer' | 'hang' | ((path: string) => unknown) = 'answer'
): Promise<Running & { seen: string[] }> {
  const opensearch = await fakeOpenSearch(answer);
  const server = await start(opensearch.url, settings, answer !== 'hang');
  return {
    ...server,
    seen: opensearch.seen,
    stop: async () => {
      await server.stop();
      await opensearch.close();
    },
  };
}

interface Answer {
  status: number;
  headers: http.IncomingHttpHeaders;
  text: string;
}

function call(
  port: number,
  method: string,
  path: string,
  options: { headers?: Record<string, string>; body?: string } = {}
): Promise<Answer> {
  // A body goes with its length, as curl sends it (Node would send a DELETE's body unframed)
  const headers =
    options.body === undefined ? options.headers : { ...options.headers, 'content-length': String(Buffer.byteLength(options.body)) };
  return new Promise((done, failed) => {
    const request = http.request(
      { host: '127.0.0.1', port, method, path, headers, agent: false },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () =>
          done({ status: response.statusCode ?? 0, headers: response.headers, text: Buffer.concat(chunks).toString('utf8') })
        );
      }
    );
    request.on('error', failed);
    if (options.body !== undefined) request.write(options.body);
    request.end();
  });
}

const bodyOf = (answer: Answer) => JSON.parse(answer.text) as Record<string, unknown>;
/** The status of an answer and its message: "400 Request must contain ..." */
const said = (answer: Answer) => `${answer.status} ${String(bodyOf(answer).message)}`;
const versionOf = async (port: number) =>
  (bodyOf(await call(port, 'GET', '/api/status')).version as { number: string }).number;

/** What comes back on a connection given these bytes, until the server closes it */
const raw = (port: number, request: string): Promise<string> =>
  new Promise((done, failed) => {
    const chunks: Buffer[] = [];
    const socket = net.connect(port, '127.0.0.1', () => socket.write(request));
    socket.on('data', (chunk: Buffer) => chunks.push(chunk));
    socket.on('close', () => done(Buffer.concat(chunks).toString('latin1')));
    // A server that stops reading what it refuses may reset the connection after its answer
    socket.on('error', (error: NodeJS.ErrnoException) => (error.code === 'ECONNRESET' ? undefined : failed(error)));
  });

/** A port nothing listens on now */
const freePort = (): Promise<number> =>
  new Promise((done) => {
    const probe = net.createServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => done(port));
    });
  });

describe('a request that changes something', () => {
  it('needs the osd-xsrf header, or osd-version, as in the original', async () => {
    const server = await run();
    try {
      const refused = await call(server.port, 'POST', '/api/opensearch-dashboards/settings', { headers: JSON_TYPE, body: '[]' });
      assert.equal(refused.status, 400);
      assert.deepEqual(bodyOf(refused), {
        statusCode: 400,
        error: 'Bad Request',
        message: 'Request must contain the osd-xsrf header.',
      });
      assert.equal(refused.headers['cache-control'], NO_CACHE);
      assert.equal(said(await call(server.port, 'DELETE', '/api/opensearch-dashboards/settings/zz-agent-srv-x')), '400 Request must contain the osd-xsrf header.');
      // With either header the route checks the body
      const checked = '400 [request body]: expected a plain object value, but found [Array] instead.';
      const either: Array<Record<string, string>> = [{ 'osd-xsrf': 'anything' }, { 'osd-version': await versionOf(server.port) }];
      for (const header of either) {
        const answer = await call(server.port, 'POST', '/api/opensearch-dashboards/settings', { headers: { ...JSON_TYPE, ...header }, body: '[]' });
        assert.equal(said(answer), checked);
      }
      // A GET is never refused for it
      assert.equal(
        said(await call(server.port, 'GET', '/api/opensearch-dashboards/settings?scope=nope')),
        '400 [request query.scope]: SchemaTypeError: expected value to equal [dashboard_admin]'
      );
      assert.deepEqual(server.seen.filter((line) => line.includes('_update')), []);
    } finally {
      await server.stop();
    }
  });

  it('does not need it where server.xsrf says so', async () => {
    const off = await run({ SERVER_XSRF_DISABLEPROTECTION: 'true' });
    try {
      const answer = await call(off.port, 'POST', '/api/opensearch-dashboards/settings', { headers: JSON_TYPE, body: '[]' });
      assert.equal(said(answer), '400 [request body]: expected a plain object value, but found [Array] instead.');
    } finally {
      await off.stop();
    }
    // The routes of the list, by the path they are declared with, whatever their parts are named
    const listed = await run({ SERVER_XSRF_WHITELIST: '["/api/opensearch-dashboards/settings/{name}"]' });
    try {
      const one = await call(listed.port, 'POST', '/api/opensearch-dashboards/settings/zz-agent-srv-x', { headers: JSON_TYPE, body: '{}' });
      assert.equal(said(one), '400 [request body.value]: expected value of type [any] but got [undefined]');
      const other = await call(listed.port, 'POST', '/api/opensearch-dashboards/settings', { headers: JSON_TYPE, body: '[]' });
      assert.equal(said(other), '400 Request must contain the osd-xsrf header.');
    } finally {
      await listed.stop();
    }
  });
});

describe('the status of the server', () => {
  it("takes the query of the original's route, and refuses another in its words", async () => {
    const server = await run();
    try {
      for (const query of ['', '?v8format=true', '?v8format=FALSE']) {
        assert.equal((await call(server.port, 'GET', `/api/status${query}`)).status, 200, query);
      }
      // as the original answers each (measured)
      assert.equal(said(await call(server.port, 'GET', '/api/status?x=%zz')), '400 [request query.x]: definition for this key is missing');
      assert.equal(
        said(await call(server.port, 'GET', '/api/status?v8format=1')),
        '400 [request query.v8format]: expected value of type [boolean] but got [string]'
      );
      assert.equal(
        said(await call(server.port, 'GET', '/api/status?v8format=true&v8format=false')),
        '400 [request query.v8format]: expected value of type [boolean] but got [Array]'
      );
    } finally {
      await server.stop();
    }
  });
});

describe('the version a page says it is of', () => {
  it('must be this one on every GET and every route, as in the original', async () => {
    const server = await run();
    try {
      const version = await versionOf(server.port);
      const outOfDate = {
        statusCode: 400,
        error: 'Bad Request',
        message: `Browser client is out of date, please refresh the page ("osd-version" header was "1.0.0" but should be "${version}")`,
        attributes: { expected: version, got: '1.0.0' },
      };
      const old = { 'osd-version': '1.0.0' };
      for (const path of ['/api/status', '/no/such/thing', '/app/home', '/']) {
        const answer = await call(server.port, 'GET', path, { headers: old });
        assert.equal(`${path} ${answer.status}`, `${path} 400`);
        assert.deepEqual(bodyOf(answer), outOfDate);
      }
      const routed = await call(server.port, 'POST', '/api/opensearch-dashboards/settings', { headers: { ...JSON_TYPE, ...old }, body: '{}' });
      assert.deepEqual(bodyOf(routed), outOfDate);
      // A path no route has, under another method than GET, is only not there
      assert.equal((await call(server.port, 'POST', '/no/such/thing', { headers: { ...XSRF, ...old }, body: '{}' })).status, 404);
      assert.equal((await call(server.port, 'GET', '/api/status', { headers: { 'osd-version': version } })).status, 200);
    } finally {
      await server.stop();
    }
  });
});

describe('a path', () => {
  it('under a method it is not known with is not there, as hapi answers', async () => {
    const server = await run();
    try {
      for (const [method, path] of [
        ['PUT', '/api/opensearch-dashboards/settings'],
        ['DELETE', '/api/status'],
        ['PATCH', '/app/home'],
      ]) {
        const answer = await call(server.port, method, path, { headers: XSRF, body: '{}' });
        assert.equal(`${method} ${path} ${answer.status}`, `${method} ${path} 404`);
        assert.deepEqual(bodyOf(answer), { statusCode: 404, error: 'Not Found', message: 'Not Found' });
        assert.equal(answer.headers.allow, undefined);
      }
    } finally {
      await server.stop();
    }
  });

  it('is matched part by part, and one with a slash at its end is sent to the one without', async () => {
    const server = await run();
    try {
      const status = async (path: string) => {
        const answer = await call(server.port, 'GET', path);
        return `${path} ${answer.status}${answer.headers.location === undefined ? '' : ` ${answer.headers.location}`}`;
      };
      assert.deepEqual(
        await Promise.all(['/api//status', '/api/status/', '/api/status/?a=1&b=2', '/app', '/app/', '/app//home', '/app/home/'].map(status)),
        [
          '/api//status 404',
          '/api/status/ 301 /api/status',
          '/api/status/?a=1&b=2 301 /api/status?a=1&b=2',
          '/app 404',
          '/app/ 301 /app',
          '/app//home 404',
          '/app/home/ 200',
        ]
      );
      const moved = await call(server.port, 'GET', '/api/status/');
      assert.equal(moved.headers['content-type'], 'text/html; charset=utf-8');
      assert.equal(moved.headers['content-length'], '0');
    } finally {
      await server.stop();
    }
  });

  it('is read as hapi reads it: as it was sent, with the escapes of what needs none decoded', async () => {
    const server = await run();
    try {
      const status = async (path: string) => `${path} ${(await call(server.port, 'GET', path)).status}`;
      // as the original answers each (measured); an address would make "\" a "/"
      assert.deepEqual(
        await Promise.all(
          ['/api/st%61tus', '/api/status%7E', '/api/%2e/status', '/api/x/../status', '/api\\status', '/app\\home', '/api%2Fstatus'].map(status)
        ),
        [
          '/api/st%61tus 200',
          '/api/status%7E 404',
          '/api/%2e/status 200',
          '/api/x/../status 200',
          '/api\\status 404',
          '/app\\home 404',
          '/api%2Fstatus 404',
        ]
      );
      // A named part keeps its "\", as there
      const saved = await call(server.port, 'GET', '/api/saved_objects/index-pattern/zz-agent-srv-a\\b');
      assert.equal(said(saved), '404 Saved object [index-pattern/zz-agent-srv-a\\b] not found');
      // An address in full is read as one, as hapi reads it; a target that is no address is refused in its words
      const full = await raw(server.port, 'GET http://other.example/api/st%61tus HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n');
      assert.match(full, /^HTTP\/1\.1 200 OK\r\n/);
      for (const line of ['OPTIONS * HTTP/1.1', 'GET http://[x HTTP/1.1']) {
        const refused = await raw(server.port, `${line}\r\nHost: x\r\nConnection: close\r\n\r\n`);
        assert.equal(refused.slice(refused.indexOf('\r\n\r\n') + 4), '{"statusCode":400,"error":"Bad Request","message":"Invalid URL"}', line);
      }
    } finally {
      await server.stop();
    }
  });

  it('with an escape that cannot be decoded is a bad request, before any header is looked at, as hapi answers it', async () => {
    const server = await run();
    try {
      const refused = { statusCode: 400, error: 'Bad Request', message: 'Bad Request' };
      const cases: Array<[string, string, Record<string, string>]> = [
        ['GET', '/api/status%zz', {}],
        ['GET', '/api/status%', {}],
        ['GET', '/app/home%zz', {}],
        ['GET', '/app/home/x%C3%28', {}],
        ['GET', '/nope%C3/', {}],
        ['GET', '/api/saved_objects/index-pattern/%zz', {}],
        // the version and osd-xsrf are not looked at
        ['GET', '/app/home%zz', { 'osd-version': '1.0.0' }],
        ['POST', '/api/saved_objects/index-pattern/%zz', JSON_TYPE],
        ['POST', '/internal/search/opensearch%zz', { ...XSRF, 'osd-version': '1.0.0' }],
      ];
      for (const [method, path, headers] of cases) {
        const answer = await call(server.port, method, path, method === 'GET' ? { headers } : { headers, body: '{}' });
        assert.deepEqual(
          [method, path, answer.status, bodyOf(answer), answer.headers['cache-control']],
          [method, path, 400, refused, NO_CACHE]
        );
      }
      const head = await call(server.port, 'HEAD', '/app/home%zz');
      assert.deepEqual([head.status, head.headers['content-type'], head.text], [400, 'application/json; charset=utf-8', '']);
      // A path that no route of its method has is only not there
      assert.equal(said(await call(server.port, 'POST', '/nope%zz', { headers: XSRF, body: '{}' })), '404 Not Found');
    } finally {
      await server.stop();
    }
  });

  it('that no route takes, or that is refused before a route reads its body, is answered when the body is in, as hapi answers', async () => {
    const server = await run();
    try {
      // The head and half of the body, then the rest: the answer comes after the rest, so that a
      // client that sends all of its body before it reads (and asks to close) can read it
      const answered = async (head: string) => {
        const socket = net.connect(server.port, '127.0.0.1');
        socket.on('error', () => undefined);
        const chunks: Buffer[] = [];
        socket.on('data', (chunk: Buffer) => chunks.push(chunk));
        const closed = new Promise<void>((resolve) => socket.on('close', () => resolve()));
        await new Promise<void>((resolve) => socket.on('connect', () => resolve()));
        socket.write(`${head}Connection: close\r\nContent-Type: application/json\r\nContent-Length: 20000\r\n\r\n${'a'.repeat(10000)}`);
        await new Promise((resolve) => setTimeout(resolve, 200));
        const early = Buffer.concat(chunks).toString('latin1');
        socket.write('a'.repeat(10000));
        await closed;
        return [early, Buffer.concat(chunks).toString('latin1').split('\r\n')[0]];
      };
      assert.deepEqual(await answered('POST /nope HTTP/1.1\r\nHost: x\r\nosd-xsrf: x\r\n'), ['', 'HTTP/1.1 404 Not Found']);
      assert.deepEqual(await answered('POST /internal/search/opensearch%zz HTTP/1.1\r\nHost: x\r\n'), ['', 'HTTP/1.1 400 Bad Request']);
      assert.deepEqual(await answered('POST /api/opensearch-dashboards/settings HTTP/1.1\r\nHost: x\r\n'), ['', 'HTTP/1.1 400 Bad Request']);
      assert.deepEqual(server.errors, []);
    } finally {
      await server.stop();
    }
  });
});

describe('every answer', () => {
  it('says it is not to be kept, unless its route says otherwise', async () => {
    const server = await run();
    try {
      for (const [method, path] of [
        ['GET', '/api/status'],
        ['GET', '/no/such/thing'],
        ['GET', '/'],
        ['GET', '/api/status/'],
        ['POST', '/api/opensearch-dashboards/settings'],
        // the page, as the original's (http_resources), and a path that cannot be read
        ['GET', '/app/home'],
        ['GET', '/app/home%zz'],
      ]) {
        const answer = await call(server.port, method, path);
        assert.equal(`${method} ${path} ${answer.headers['cache-control']}`, `${method} ${path} ${NO_CACHE}`);
      }
    } finally {
      await server.stop();
    }
  });

  it('carries server.customResponseHeaders, then osd-name, over its own headers', async () => {
    const server = await run({
      SERVER_NAME: 'replica-1',
      SERVER_CUSTOMRESPONSEHEADERS: JSON.stringify({ 'X-Frame-Options': 'DENY', 'Cache-Control': 'public', 'osd-name': 'mine' }),
    });
    try {
      for (const path of ['/api/status', '/no/such/thing', '/']) {
        const { headers } = await call(server.port, 'GET', path);
        assert.deepEqual(
          [headers['x-frame-options'], headers['cache-control'], headers['osd-name']],
          ['DENY', 'public', 'replica-1'],
          path
        );
      }
    } finally {
      await server.stop();
    }
  });

  it('names the machine it comes from, unless server.name names the server', async () => {
    const server = await run();
    try {
      assert.equal((await call(server.port, 'GET', '/api/status')).headers['osd-name'], hostname());
      assert.equal(bodyOf(await call(server.port, 'GET', '/api/status')).name, hostname());
    } finally {
      await server.stop();
    }
  });

  it('cannot carry a header that cannot be sent: the server does not start', () => {
    const { config } = loadConfig({ env: { SERVER_CUSTOMRESPONSEHEADERS: '{"bad name":"x"}' } });
    assert.throws(
      () => createApp({ config, logger: silentLogger, distDirectory: resolve(__dirname, '..', '..') }),
      /^Error: server\.customResponseHeaders: /
    );
  });

  it('is compressed as hapi decides, and not where server.compression says not to', async () => {
    const coding = async (port: number, headers: Record<string, string>) => {
      const answer = await call(port, 'GET', '/app/home', { headers });
      return `${answer.headers['content-encoding'] ?? 'none'} ${answer.headers.vary}`;
    };
    const server = await run();
    try {
      assert.equal(await coding(server.port, { 'accept-encoding': 'gzip, deflate' }), 'gzip accept-encoding');
      assert.equal(await coding(server.port, { 'accept-encoding': 'gzip;q=0' }), 'none accept-encoding');
    } finally {
      await server.stop();
    }
    const off = await run({ SERVER_COMPRESSION_ENABLED: 'false' });
    try {
      assert.equal(await coding(off.port, { 'accept-encoding': 'gzip' }), 'none accept-encoding');
    } finally {
      await off.stop();
    }
    const listed = await run({ SERVER_COMPRESSION_REFERRERWHITELIST: '["good.local"]' });
    try {
      assert.equal(await coding(listed.port, { 'accept-encoding': 'gzip', referer: 'http://good.local/app/home' }), 'gzip accept-encoding');
      assert.equal(await coding(listed.port, { 'accept-encoding': 'gzip', referer: 'http://bad.local/app/home' }), 'none accept-encoding');
      assert.equal(await coding(listed.port, { 'accept-encoding': 'gzip' }), 'gzip accept-encoding');
    } finally {
      await listed.stop();
    }
  });
});

describe('server.basePath', () => {
  it('with server.rewriteBasePath, is taken off the requests, which must carry it', async () => {
    const server = await run({ SERVER_BASEPATH: '/base', SERVER_REWRITEBASEPATH: 'true' });
    try {
      const where = async (path: string) => {
        const answer = await call(server.port, 'GET', path);
        return `${path} ${answer.status}${answer.headers.location === undefined ? '' : ` ${answer.headers.location}`}`;
      };
      assert.deepEqual(await Promise.all(['/base/api/status', '/api/status', '/base', '/base/', '/basement/api/status', '/base/api/status/'].map(where)), [
        '/base/api/status 200',
        '/api/status 404',
        '/base 302 /base/app/home',
        '/base/ 302 /base/app/home',
        '/basement/api/status 404',
        '/base/api/status/ 301 /base/api/status',
      ]);
    } finally {
      await server.stop();
    }
  });

  it('without it, starts the addresses the server gives, for a proxy in front that takes it off', async () => {
    const server = await run({ SERVER_BASEPATH: '/base' });
    try {
      const where = async (path: string) => {
        const answer = await call(server.port, 'GET', path);
        return `${path} ${answer.status}${answer.headers.location === undefined ? '' : ` ${answer.headers.location}`}`;
      };
      assert.deepEqual(await Promise.all(['/api/status', '/', '/api/status/', '/base/api/status'].map(where)), [
        '/api/status 200',
        '/ 302 /base/app/home',
        '/api/status/ 301 /base/api/status',
        '/base/api/status 404',
      ]);
    } finally {
      await server.stop();
    }
  });
});

describe('the address / leads to', () => {
  const storing = (defaultRoute: string) => (path: string) =>
    path.startsWith('/.kibana/_doc/config%3A') ? { found: true, _source: { type: 'config', config: { defaultRoute } } } : undefined;

  it('is the advanced setting defaultRoute as it is stored, as in the original', async () => {
    const server = await run({}, storing('/app/dashboards'));
    try {
      const answer = await call(server.port, 'GET', '/');
      assert.equal(answer.status, 302);
      assert.equal(answer.headers.location, '/app/dashboards');
      assert.equal(answer.headers['cache-control'], NO_CACHE);
    } finally {
      await server.stop();
    }
  });

  it('is the default when the stored value would lead off this server', async () => {
    for (const stored of ['//elsewhere.example/app', '/\\elsewhere.example', 'https://elsewhere.example/']) {
      const server = await run({}, storing(stored));
      try {
        assert.equal((await call(server.port, 'GET', '/')).headers.location, '/app/home', stored);
      } finally {
        await server.stop();
      }
    }
  });

  it('is the one of uiSettings.overrides, and comes at once while OpenSearch does not answer', async () => {
    const server = await run({ UISETTINGS_OVERRIDES: '{"defaultRoute":"/app/discover"}', OPENSEARCH_REQUESTTIMEOUT: '4000' }, 'hang');
    try {
      assert.equal((await call(server.port, 'GET', '/')).headers.location, '/app/discover');
    } finally {
      await server.stop();
    }
  });
});

describe('the routes of the advanced settings', () => {
  it('refuse what the original refuses, in its words, and then change nothing', async () => {
    const server = await run();
    try {
      const base = '/api/opensearch-dashboards/settings';
      const cases: Array<[string, string, string | undefined, string]> = [
        ['POST', '', '{"changes":[]}', '400 [request body.changes]: expected a plain object value, but found [Array] instead.'],
        ['POST', '', '{"changes":{},"extra":1}', '400 [request body.extra]: definition for this key is missing'],
        ['POST', '', '{"changes":"x"}', '400 [request body.changes]: could not parse object value from json input'],
        ['POST', '', '[]', '400 [request body]: expected a plain object value, but found [Array] instead.'],
        ['POST', '', '', '400 [request body]: expected a plain object value, but found [null] instead.'],
        ['POST', '?scope=nope', '{"changes":{}}', '400 [request query.scope]: SchemaTypeError: expected value to equal [dashboard_admin]'],
        ['POST', '/zz-agent-srv-x', '{}', '400 [request body.value]: expected value of type [any] but got [undefined]'],
        ['POST', '/zz-agent-srv-x', '{"value":1,"x":2}', '400 [request body.x]: definition for this key is missing'],
        ['POST', '/zz-agent-srv-x?scope=workspace', '{"value":1}', '400 [request query.scope]: SchemaTypeError: expected value to equal [user]'],
        ['GET', '?scope=nope', undefined, '400 [request query.scope]: SchemaTypeError: expected value to equal [dashboard_admin]'],
        ['DELETE', '/zz-agent-srv-x?scope=nope', undefined, '400 [request query.scope]: SchemaTypeError: expected value to equal [user]'],
        ['PUT', '', '{"changes":{}}', '404 Not Found'],
        ['POST', '', '{"changes":{"__proto__":{"x":1}}}', '400 Invalid request payload JSON format'],
        ['POST', '', '{"__proto__":{"x":1},"changes":{}}', '400 Invalid request payload JSON format'],
        ['POST', '', '{"changes":{', '400 Invalid request payload JSON format'],
      ];
      for (const [method, path, body, expected] of cases) {
        const answer = await call(server.port, method, `${base}${path}`, { headers: XSRF, body });
        assert.equal(`${method} ${path} ${body} -> ${said(answer)}`, `${method} ${path} ${body} -> ${expected}`);
      }
      assert.deepEqual(server.seen.filter((line) => line.includes('_update')), []);
    } finally {
      await server.stop();
    }
  });

  it('take an empty body of changes as no change, as the original does', async () => {
    // A stored document of advanced settings with none set, as OpenSearch answers for it
    const server = await run({}, (path) =>
      path.startsWith('/.kibana/_doc/config')
        ? { _index: '.kibana', _id: 'config:3.9.0', found: true, _source: { type: 'config', config: {} } }
        : undefined
    );
    try {
      const answer = await call(server.port, 'POST', '/api/opensearch-dashboards/settings', { headers: XSRF, body: '{}' });
      assert.equal(answer.status, 200);
      assert.deepEqual(bodyOf(answer), { settings: {} });
      assert.deepEqual(server.seen.filter((line) => line.includes('_update') || line.includes('_create')), []);
    } finally {
      await server.stop();
    }
  });
});

describe('the body of a request', () => {
  it('is read as hapi reads it, and refused in the words of the route or of hapi', async () => {
    const server = await run();
    try {
      const bulkGet = (type: string, body: string) =>
        call(server.port, 'POST', '/api/saved_objects/_bulk_get', { headers: { 'osd-xsrf': 'true', 'content-type': type }, body });
      // as the original answers each (measured)
      assert.deepEqual(bodyOf(await bulkGet('application/xml', '<a/>')), {
        statusCode: 415,
        error: 'Unsupported Media Type',
        message: 'Unsupported Media Type',
      });
      assert.equal(said(await bulkGet('text/plain', 'nope')), '400 [request body]: could not parse array value from json input');
      assert.equal(said(await bulkGet('application/json', '"x"')), '400 [request body]: could not parse array value from json input');
      assert.equal(said(await bulkGet('application/json', '[{"type":"config","id":"x","__proto__":{}}]')), '400 Invalid request payload JSON format');
      assert.equal(said(await bulkGet('application/json', '')), '400 [request body]: expected value of type [array] but got [null]');
    } finally {
      await server.stop();
    }
  });

  it('of a client that goes away before it is read is no failure of the server', async () => {
    const server = await run();
    try {
      const socket = net.connect(server.port, '127.0.0.1');
      socket.on('error', () => undefined);
      await new Promise<void>((resolve) => socket.on('connect', () => resolve()));
      socket.write(
        'POST /api/console/proxy?method=GET&path=_cat HTTP/1.1\r\nHost: x\r\nosd-xsrf: x\r\nContent-Length: 100\r\n\r\nabc'
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
      socket.destroy();
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.deepEqual(server.errors, []);
    } finally {
      await server.stop();
    }
  });
});

describe('the headers of a request', () => {
  it('may take 64 kB, as the start script of the original allows; past that the answer is a bare 400', async () => {
    const server = await run();
    try {
      const asking = (size: number) =>
        raw(server.port, `GET /api/status HTTP/1.1\r\nHost: x\r\nConnection: close\r\nX-Big: ${'a'.repeat(size)}\r\n\r\n`);
      // Node counts the path and each name and value of a header, and takes less than the limit:
      // here 11 + 4 + 1 + 10 + 5 + 5 + 65,499 = 65,535 bytes. The original takes the same request
      // and refuses the one with a byte more, in the same way (measured)
      assert.match(await asking(65499), /^HTTP\/1\.1 200 OK\r\n/);
      assert.equal(await asking(65500), 'HTTP/1.1 400 Bad Request\r\n\r\n');
      assert.equal(await raw(server.port, 'NOT HTTP\r\n\r\n'), 'HTTP/1.1 400 Bad Request\r\n\r\n');
      assert.deepEqual(server.errors, []);
    } finally {
      await server.stop();
    }
  });

  it('that opensearch.requestHeadersWhitelist names go on to OpenSearch, with an id of the request, and none that frames it', async () => {
    const seen: http.IncomingHttpHeaders[] = [];
    const sockets = new Set<Socket>();
    const opensearch = http.createServer((req, res) => {
      if ((req.url ?? '').startsWith('/.kibana/_doc/')) seen.push(req.headers);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
    });
    opensearch.on('connection', (socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    });
    await new Promise<void>((resolve) => opensearch.listen(0, '127.0.0.1', resolve));
    const { port: opensearchPort } = opensearch.address() as AddressInfo;
    const server = await start(`http://127.0.0.1:${opensearchPort}`, {
      OPENSEARCH_REQUESTHEADERSWHITELIST: '["Authorization", "x-user", "host", "content-length", "connection"]',
    });
    try {
      const headers = { authorization: 'Basic eDp5', 'x-user': 'u1', 'x-other': 'no' };
      await call(server.port, 'GET', '/api/opensearch-dashboards/settings', { headers });
      await call(server.port, 'GET', '/api/opensearch-dashboards/settings', { headers });
      assert.equal(seen.length, 2);
      for (const sent of seen) {
        assert.equal(sent.authorization, 'Basic eDp5');
        assert.equal(sent['x-user'], 'u1');
        assert.equal(sent['x-other'], undefined);
        assert.equal(sent.host, `127.0.0.1:${opensearchPort}`);
        assert.equal(sent['x-opensearch-product-origin'], 'opensearch-dashboards');
        assert.match(String(sent['x-opaque-id']), /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      }
      assert.notEqual(seen[0]['x-opaque-id'], seen[1]['x-opaque-id']);
    } finally {
      await server.stop();
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => opensearch.close(resolve));
    }
  });
});

describe('the console proxy', () => {
  it('answers JSON as JSON in UTF-8, with a warning header always, as the original', async () => {
    const server = await run();
    try {
      const answer = await call(server.port, 'POST', '/api/console/proxy?method=GET&path=_cluster/health', { headers: XSRF });
      assert.equal(answer.headers['content-type'], 'application/json; charset=utf-8');
      assert.equal(answer.headers.warning, '');
    } finally {
      await server.stop();
    }
  });
});

describe('a search of the pages', () => {
  it("asks OpenSearch to give up on a shard after opensearch.shardTimeout, as the original's searches do", () => {
    assert.equal(withShardTimeout('/logs/_search', 30000), '/logs/_search?timeout=30000ms');
    assert.equal(withShardTimeout('/_search?size=0', 1000), '/_search?size=0&timeout=1000ms');
    assert.equal(withShardTimeout('/_search?timeout=5s', 1000), '/_search?timeout=5s');
    assert.equal(withShardTimeout('/logs/_count', 1000), '/logs/_count');
    assert.equal(withShardTimeout('/_search/template', 1000), '/_search/template');
    assert.equal(withShardTimeout('/_msearch', 1000), '/_msearch');
    assert.equal(withShardTimeout('/_search', 0), '/_search');
  });
});

describe('server.ssl', () => {
  const tlsCall = (port: number, path: string, options: https.RequestOptions = {}): Promise<Answer> =>
    new Promise((done, failed) => {
      const request = https.request({ host: '127.0.0.1', port, path, ca: CA_CERTIFICATE, agent: false, ...options }, (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () =>
          done({ status: response.statusCode ?? 0, headers: response.headers, text: Buffer.concat(chunks).toString('utf8') })
        );
      });
      request.on('error', failed);
      request.end();
    });

  it('serves HTTPS with the certificate, its encrypted key, and a client certificate when it is required', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'zz-agent-srv-tls-'));
    const files = writeTlsFiles(directory);
    const ssl = {
      SERVER_SSL_ENABLED: 'true',
      SERVER_SSL_CERTIFICATE: files.certificate,
      SERVER_SSL_KEY: files.key,
      SERVER_SSL_KEYPASSPHRASE: SERVER_KEY_PASSPHRASE,
    };
    try {
      const server = await run(ssl);
      try {
        assert.equal((await tlsCall(server.port, '/api/status')).status, 200);
      } finally {
        await server.stop();
      }
      const strict = await run({ ...ssl, SERVER_SSL_CLIENTAUTHENTICATION: 'required', SERVER_SSL_CERTIFICATEAUTHORITIES: files.ca });
      try {
        let refused = false;
        await tlsCall(strict.port, '/api/status').catch(() => {
          refused = true;
        });
        assert.ok(refused, 'a client without a certificate was let in');
        const answer = await tlsCall(strict.port, '/api/status', { cert: CLIENT_CERTIFICATE, key: CLIENT_KEY });
        assert.equal(answer.status, 200);
      } finally {
        await strict.stop();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('sends plain HTTP on server.ssl.redirectHttpFromPort to the same path over HTTPS', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'zz-agent-srv-tls-'));
    const files = writeTlsFiles(directory);
    const port = await freePort();
    try {
      const server = await run({
        SERVER_PORT: String(port),
        SERVER_SSL_ENABLED: 'true',
        SERVER_SSL_CERTIFICATE: files.certificate,
        SERVER_SSL_KEY: files.key,
        SERVER_SSL_KEYPASSPHRASE: SERVER_KEY_PASSPHRASE,
        SERVER_SSL_REDIRECTHTTPFROMPORT: '0',
      });
      try {
        const redirectPort = (server.app.redirectServer?.address() as AddressInfo).port;
        const moved = await call(redirectPort, 'GET', '/app/home?x=1');
        assert.equal(moved.status, 302);
        assert.equal(moved.headers.location, `https://127.0.0.1:${port}/app/home?x=1`);
        assert.equal(moved.headers['cache-control'], NO_CACHE);
        assert.equal((await call(redirectPort, 'GET', '//elsewhere.example/x')).status, 404);
      } finally {
        await server.stop();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

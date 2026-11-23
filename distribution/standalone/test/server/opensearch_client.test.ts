/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { constants as bufferConstants } from 'node:buffer';
import { mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import type { AddressInfo, Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import type { TLSSocket } from 'node:tls';
import { getHeapStatistics } from 'node:v8';
import { loadConfig } from '../../server/config';
import {
  OpenSearchAnswerRefusedError,
  OpenSearchClient,
  OpenSearchUnavailableError,
  withForwardedHeaders,
} from '../../server/opensearch';
import { fakeOpenSearch as fake } from './fake_opensearch';
import { CA_CERTIFICATE, SERVER_CERTIFICATE, SERVER_KEY, SERVER_KEY_PASSPHRASE, writeTlsFiles } from './tls_fixture';

interface Scripted {
  url: string;
  /** Each request as it arrived */
  seen: Array<{ line: string; headers: http.IncomingHttpHeaders }>;
  close(): Promise<void>;
}

/** An OpenSearch that answers the n-th request (from 0) as the function says */
async function scripted(
  answer: (req: http.IncomingMessage, res: http.ServerResponse, n: number) => void,
  options?: https.ServerOptions
): Promise<Scripted> {
  const seen: Scripted['seen'] = [];
  const sockets = new Set<Socket>();
  const handler = (req: http.IncomingMessage, res: http.ServerResponse) => {
    seen.push({ line: `${req.method} ${req.url}`, headers: req.headers });
    answer(req, res, seen.length - 1);
  };
  const server = options ? https.createServer(options, handler) : http.createServer(handler);
  server.on('connection', (socket: Socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `${options ? 'https' : 'http'}://127.0.0.1:${port}`,
    seen,
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

const answerJson = (res: http.ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

const failureOf = async (run: Promise<unknown>): Promise<unknown> => {
  try {
    await run;
  } catch (error) {
    return error;
  }
  return undefined;
};

const clientFor = (hosts: string[], timeout = 30000) =>
  new OpenSearchClient(
    loadConfig({
      env: { OPENSEARCH_HOSTS: JSON.stringify(hosts), OPENSEARCH_REQUESTTIMEOUT: String(timeout) },
    }).config.opensearch
  );

describe('the path of a request to OpenSearch', () => {
  /** What OpenSearch is asked for each of the paths, in order */
  const asked = async (paths: string[], hostPath = '', query?: Record<string, string>) => {
    const opensearch = await fake();
    const client = clientFor([opensearch.url + hostPath]);
    try {
      for (const path of paths) await client.raw({ method: 'GET', path, query });
      return opensearch.seen.map((line) => line.replace(/^GET /, ''));
    } finally {
      client.close();
      await opensearch.close();
    }
  };

  it('is encoded and sent as before when no part of it is "." or ".."', async () => {
    assert.deepEqual(
      await asked([
        '/my index/_search?q=a b',
        '/a%2Fb/_doc/x%3Ay?refresh=true',
        '/logs-*,-logs-old/_search',
        '/.kibana/_doc/config%3A3.9.0',
        '/a.b/..c/.d./...',
        '/a#b',
        '_cat/indices',
      ]),
      [
        '/my%20index/_search?q=a%20b',
        '/a%2Fb/_doc/x%3Ay?refresh=true',
        '/logs-*,-logs-old/_search',
        '/.kibana/_doc/config%3A3.9.0',
        '/a.b/..c/.d./...',
        '/a',
        '/_cat/indices',
      ]
    );
  });

  it('keeps a "." or ".." part as a name, so that it cannot take the request to another path', async () => {
    assert.deepEqual(
      await asked([
        // what an index pattern, a repository or an index called ".." or "." made of these requests
        '/../_field_caps?fields=*',
        '/_snapshot/../my-index',
        '/./_mapping',
        '/..',
        '/a b/../c d?x=1 2',
        '/a/%2e%2e/b',
        '/a/.%2E/%2e/b',
        '/a/.\t./b',
        '/a\\..\\b',
        '/a/.. ',
        '/a/..#b',
      ]),
      [
        '/../_field_caps?fields=*',
        '/_snapshot/../my-index',
        '/./_mapping',
        '/..',
        '/a%20b/../c%20d?x=1%202',
        '/a/%2e%2e/b',
        '/a/.%2E/%2e/b',
        '/a/../b',
        '/a/../b',
        '/a/..',
        '/a/..',
      ]
    );
  });

  it('comes after the path of the host, with the parameters of the request', async () => {
    assert.deepEqual(await asked(['/../_search', '/idx/_search?q=1'], '/behind/a/proxy/', { size: '0' }), [
      '/behind/a/proxy/../_search?size=0',
      '/behind/a/proxy/idx/_search?q=1&size=0',
    ]);
  });
});

describe('the hosts of opensearch.hosts', () => {
  it('a host that did not answer in time is not the one the next request starts with', async () => {
    const silent = await fake('hang');
    const healthy = await fake();
    const client = clientFor([silent.url, healthy.url], 300);
    try {
      let failure: unknown;
      await client.raw({ method: 'POST', path: '/_a' }).catch((error: unknown) => {
        failure = error;
      });
      assert.ok(failure instanceof OpenSearchUnavailableError);
      assert.match((failure as Error).message, /no answer within 300 ms/);
      // What timed out is not sent to the other host: it may have been done
      assert.deepEqual(silent.seen, ['POST /_a']);
      assert.deepEqual(healthy.seen, []);

      const response = await client.raw({ method: 'GET', path: '/_b' });
      assert.equal(response.status, 200);
      assert.deepEqual(healthy.seen, ['GET /_b']);
      assert.deepEqual(silent.seen, ['POST /_a']);
    } finally {
      client.close();
      await silent.close();
      await healthy.close();
    }
  });

  it('a host that cannot be reached is passed over, and the one that answered is kept', async () => {
    const gone = await fake();
    const healthy = await fake();
    await gone.close();
    const client = clientFor([gone.url, healthy.url]);
    try {
      assert.equal((await client.raw({ method: 'GET', path: '/_a' })).status, 200);
      assert.equal((await client.raw({ method: 'GET', path: '/_b' })).status, 200);
      assert.deepEqual(healthy.seen, ['GET /_a', 'GET /_b']);
    } finally {
      client.close();
      await healthy.close();
    }
  });
});

describe('a request to OpenSearch that fails', () => {
  it('on a connection that was cut is sent again, as opensearch-js sends it, three more times at most', async () => {
    const flaky = await scripted((req, res, n) => (n === 0 ? req.socket.destroy() : answerJson(res, 200, { n })));
    const client = clientFor([flaky.url]);
    try {
      const response = await client.raw({ method: 'POST', path: '/_bulk', body: '{}\n' });
      assert.equal(response.status, 200);
      assert.deepEqual(flaky.seen.map((request) => request.line), ['POST /_bulk', 'POST /_bulk']);
    } finally {
      client.close();
      await flaky.close();
    }
    const dead = await scripted((req) => req.socket.destroy());
    const deadClient = clientFor([dead.url]);
    try {
      const failure = await failureOf(deadClient.raw({ method: 'GET', path: '/_a' }));
      assert.ok(failure instanceof OpenSearchUnavailableError);
      assert.equal(dead.seen.length, 4);
    } finally {
      deadClient.close();
      await dead.close();
    }
  });

  it('with 502, 503 or 504 is sent again, to the next host; another status is the answer', async () => {
    const busy = await scripted((_req, res) => answerJson(res, 503, { error: 'busy' }));
    const client = clientFor([busy.url]);
    try {
      assert.equal((await client.raw({ method: 'GET', path: '/_a' })).status, 503);
      assert.equal(busy.seen.length, 4);
    } finally {
      client.close();
    }
    const healthy = await fake();
    const both = clientFor([busy.url, healthy.url]);
    try {
      busy.seen.length = 0;
      assert.equal((await both.raw({ method: 'GET', path: '/_b' })).status, 200);
      assert.deepEqual([busy.seen.length, healthy.seen], [1, ['GET /_b']]);
    } finally {
      both.close();
      await busy.close();
      await healthy.close();
    }
    for (const status of [429, 500, 404]) {
      const failing = await scripted((_req, res) => answerJson(res, status, { error: 'x' }));
      const one = clientFor([failing.url]);
      try {
        assert.equal((await one.raw({ method: 'GET', path: '/_a' })).status, status);
        assert.equal(failing.seen.length, 1, String(status));
      } finally {
        one.close();
        await failing.close();
      }
    }
  });
});

describe('the connections to OpenSearch', () => {
  it('are 256 to a host, and the time limit counts from when one carries the request', async () => {
    const slow = await scripted((_req, res) => setTimeout(() => answerJson(res, 200, {}), 300));
    // 300 at once with a limit of 800 ms: the last 44 wait 300 ms for a connection, which is not counted
    const client = clientFor([slow.url], 800);
    try {
      const answers = await Promise.all(
        Array.from({ length: 300 }, (_, index) =>
          client.raw({ method: 'GET', path: `/_a${index}` }).then(
            (response) => String(response.status),
            (error: Error) => error.name
          )
        )
      );
      const counted: Record<string, number> = {};
      for (const answer of answers) counted[answer] = (counted[answer] ?? 0) + 1;
      assert.deepEqual(counted, { 200: 300 });
      assert.equal(slow.seen.length, 300);
    } finally {
      client.close();
      await slow.close();
    }
  });
});

describe('an answer of OpenSearch', () => {
  it('longer than a string can be is refused before it is read, in the words of opensearch-js', async () => {
    const huge = await scripted((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': String(bufferConstants.MAX_STRING_LENGTH + 1) });
      res.write('{');
    });
    const client = clientFor([huge.url]);
    try {
      const failure = await failureOf(client.raw({ method: 'GET', path: '/_search' }));
      assert.ok(failure instanceof OpenSearchAnswerRefusedError);
      assert.equal(
        (failure as Error).message,
        `The content length (${bufferConstants.MAX_STRING_LENGTH + 1}) is bigger than the maximum allowed string (${bufferConstants.MAX_STRING_LENGTH})`
      );
      assert.equal(huge.seen.length, 1);
    } finally {
      client.close();
      await huge.close();
    }
  });

  it('that would take more of the memory than opensearch.memoryCircuitBreaker allows is refused', async () => {
    const sized = await scripted((req, res) => {
      const size = req.url === '/_large' ? 100 * 1024 * 1024 : 2;
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': String(size) });
      if (size === 2) res.end('{}');
      else res.write('{');
    });
    // What is in use now and 50 MB more
    const share = (process.memoryUsage().heapUsed + 50 * 1024 * 1024) / getHeapStatistics().heap_size_limit;
    const config = loadConfig({ env: { OPENSEARCH_HOSTS: JSON.stringify([sized.url]) } }).config.opensearch;
    const client = new OpenSearchClient({ ...config, memoryCircuitBreaker: { enabled: true, maxPercentage: share } });
    try {
      assert.equal((await client.raw({ method: 'GET', path: '/_small' })).status, 200);
      const failure = await failureOf(client.raw({ method: 'GET', path: '/_large' }));
      assert.ok(failure instanceof OpenSearchAnswerRefusedError);
      assert.equal((failure as Error).message, `The content length (${100 * 1024 * 1024}) is bigger than the maximum allowed heap memory limit.`);
    } finally {
      client.close();
      await sized.close();
    }
  });
});

describe('the headers of a request to OpenSearch', () => {
  it("are those of the original's client, then opensearch.customHeaders, then those of the browser's request", async () => {
    const recorder = await scripted((_req, res) => answerJson(res, 200, {}));
    const client = new OpenSearchClient(
      loadConfig({
        env: {
          OPENSEARCH_HOSTS: JSON.stringify([recorder.url]),
          OPENSEARCH_USERNAME: 'system',
          OPENSEARCH_PASSWORD: 'secret',
          OPENSEARCH_CUSTOMHEADERS: '{"x-custom":"a"}',
        },
      }).config.opensearch
    );
    try {
      await client.raw({ method: 'GET', path: '/_a' });
      await withForwardedHeaders({ authorization: 'Bearer browser', 'x-opaque-id': 'id-1' }, () =>
        client.raw({ method: 'GET', path: '/_b' })
      );
      const [own, forwarded] = recorder.seen.map((request) => request.headers);
      assert.equal(own['x-opensearch-product-origin'], 'opensearch-dashboards');
      assert.equal(own['x-custom'], 'a');
      assert.equal(own.authorization, `Basic ${Buffer.from('system:secret').toString('base64')}`);
      assert.equal(own['x-opaque-id'], undefined);
      assert.equal(forwarded.authorization, 'Bearer browser');
      assert.equal(forwarded['x-opaque-id'], 'id-1');
      assert.equal(forwarded['x-custom'], 'a');
    } finally {
      client.close();
      await recorder.close();
    }
  });
});

describe('an OpenSearch over HTTPS', () => {
  it('that asks for a client certificate gets the one of opensearch.ssl.certificate and opensearch.ssl.key', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'zz-agent-srv-tls-'));
    const files = writeTlsFiles(directory);
    const secure = await scripted((req, res) => answerJson(res, 200, { authorized: (req.socket as TLSSocket).authorized }), {
      cert: SERVER_CERTIFICATE,
      key: SERVER_KEY,
      passphrase: SERVER_KEY_PASSPHRASE,
      ca: CA_CERTIFICATE,
      requestCert: true,
      rejectUnauthorized: true,
    });
    const settings = {
      OPENSEARCH_HOSTS: JSON.stringify([secure.url]),
      OPENSEARCH_SSL_CERTIFICATEAUTHORITIES: files.ca,
    };
    const withCertificate = new OpenSearchClient(
      loadConfig({ env: { ...settings, OPENSEARCH_SSL_CERTIFICATE: files.clientCertificate, OPENSEARCH_SSL_KEY: files.clientKey } }).config
        .opensearch
    );
    const without = new OpenSearchClient(loadConfig({ env: settings }).config.opensearch);
    try {
      const response = await withCertificate.raw({ method: 'GET', path: '/' });
      assert.deepEqual(JSON.parse(response.body.toString('utf8')), { authorized: true });
      assert.ok((await failureOf(without.raw({ method: 'GET', path: '/' }))) instanceof OpenSearchUnavailableError);
    } finally {
      withCertificate.close();
      without.close();
      await secure.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

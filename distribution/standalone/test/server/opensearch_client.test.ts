/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { describe, it } from 'node:test';
import { loadConfig } from '../../server/config';
import { OpenSearchClient, OpenSearchUnavailableError } from '../../server/opensearch';

interface Fake {
  url: string;
  /** Each request that arrived, as "METHOD path" */
  seen: string[];
  close(): Promise<void>;
}

/** Listens as OpenSearch does: notes each request and answers it, or never answers */
async function fake(answer: 'answer' | 'hang' = 'answer'): Promise<Fake> {
  const seen: string[] = [];
  const sockets = new Set<Socket>();
  const server = http.createServer((req, res) => {
    seen.push(`${req.method} ${req.url}`);
    if (answer === 'hang') return;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{}');
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    seen,
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

const clientFor = (hosts: string[], timeout = 30000) =>
  new OpenSearchClient(
    loadConfig({
      env: { OPENSEARCH_HOSTS: JSON.stringify(hosts), OPENSEARCH_REQUESTTIMEOUT: String(timeout) },
    }).config.opensearch
  );

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

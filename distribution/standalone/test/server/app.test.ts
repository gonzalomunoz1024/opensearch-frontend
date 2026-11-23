/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { createApp } from '../../server/app';
import { loadConfig } from '../../server/config';
import { silentLogger } from '../../server/logger';
import { fakeOpenSearch } from './fake_opensearch';

interface Running {
  url: string;
  /** What the server logged as an error */
  errors: string[];
  stop(): Promise<void>;
}

/** The server as it is built, on a port of its own, talking to the OpenSearch at the address */
async function run(opensearch: string, settings: Record<string, string> = {}): Promise<Running> {
  const errors: string[] = [];
  const { config } = loadConfig({
    env: {
      SERVER_HOST: '127.0.0.1',
      SERVER_PORT: '0',
      OPENSEARCH_HOSTS: JSON.stringify([opensearch]),
      ...settings,
    },
  });
  const app = createApp({
    config,
    logger: { ...silentLogger, error: (message) => errors.push(message) },
    distDirectory: resolve(__dirname, '..', '..'),
  });
  await app.start();
  const { port } = app.server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, errors, stop: () => app.stop() };
}

interface Answer {
  status: number;
  body: string;
  ms: number;
}

/** One request with the target written as it is given, on a connection of its own */
const ask = (base: string, method: string, target: string): Promise<Answer> =>
  new Promise((done, failed) => {
    const started = Date.now();
    const { hostname, port } = new URL(base);
    const request = http.request(
      { hostname, port, method, path: target, agent: false, headers: { 'osd-xsrf': 'true' } },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () =>
          done({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
            ms: Date.now() - started,
          })
        );
      }
    );
    request.on('error', failed);
    request.end();
  });

describe('the two ways from a page to OpenSearch', () => {
  it('Dev Tools reads "." and ".." in what is typed as steps, as the console of the original does', async () => {
    const opensearch = await fakeOpenSearch();
    const server = await run(opensearch.url);
    try {
      opensearch.seen.length = 0;
      const typed = (path: string) =>
        ask(server.url, 'POST', `/api/console/proxy?method=GET&path=${encodeURIComponent(path)}`);
      assert.equal((await typed('nosuch/../_cat/health')).status, 200);
      await typed('/_search?q=a b');
      await typed('logs/./_count');
      assert.deepEqual(opensearch.seen.filter((line) => !/^(GET \/|HEAD \/\.kibana)$/.test(line)), [
        'GET /_cat/health',
        'GET /_search?q=a%20b',
        'GET /logs/_count',
      ]);
    } finally {
      await server.stop();
      await opensearch.close();
    }
  });

  it('a request of the pages keeps them as the names they are', async () => {
    const opensearch = await fakeOpenSearch();
    const server = await run(opensearch.url);
    try {
      opensearch.seen.length = 0;
      // What a search of an index pattern called ".." is
      await ask(server.url, 'POST', `/internal/opensearch?method=POST&path=${encodeURIComponent('../_search')}`);
      // A name from a request that a route puts into a path
      await ask(server.url, 'GET', '/api/index_patterns/_fields_for_wildcard?pattern=..');
      const seen = opensearch.seen.filter((line) => !/^(GET \/|HEAD \/\.kibana)$/.test(line));
      assert.equal(seen[0], 'POST /../_search');
      assert.match(seen[1], /^GET \/\.\.\/_field_caps\?/);
      assert.equal(seen.length, 2);
    } finally {
      await server.stop();
      await opensearch.close();
    }
  });
});

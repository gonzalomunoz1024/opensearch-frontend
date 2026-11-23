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
      // with the time limit of a shard the original's searches carry (opensearch.shardTimeout)
      assert.equal(seen[0], 'POST /../_search?timeout=30000ms');
      assert.match(seen[1], /^GET \/\.\.\/_field_caps\?/);
      assert.equal(seen.length, 2);
    } finally {
      await server.stop();
      await opensearch.close();
    }
  });
});

describe('an address the server cannot read as a path of its own', () => {
  it('is answered as a path that is not there, and is not a failure of the server', async () => {
    const opensearch = await fakeOpenSearch();
    const server = await run(opensearch.url);
    try {
      for (const target of ['//', '//[', '//x/api/status', '///app/home']) {
        const answer = await ask(server.url, 'GET', target);
        assert.equal(`${target} ${answer.status}`, `${target} 404`);
        assert.deepEqual(JSON.parse(answer.body), {
          statusCode: 404,
          error: 'Not Found',
          message: 'Not Found',
        });
      }
      // The whole address in the request line, as a proxy sends it
      assert.equal((await ask(server.url, 'GET', `${server.url}/app/home`)).status, 200);
      assert.equal((await ask(server.url, 'GET', 'http://[')).status, 400);
      assert.deepEqual(server.errors, []);
    } finally {
      await server.stop();
      await opensearch.close();
    }
  });
});

describe('an answer with a header that cannot be sent', () => {
  it('is a failure the request is told of, not a connection that is cut', async () => {
    // A short URL whose stored address holds characters no header may carry
    const opensearch = await fakeOpenSearch((path) =>
      path.startsWith('/.kibana/_doc/url%3Aodd')
        ? {
            found: true,
            _id: 'url:odd',
            _seq_no: 1,
            _primary_term: 1,
            _source: { type: 'url', url: { url: '/app/home/‮\u0000x', accessCount: 0 }, references: [] },
          }
        : undefined
    );
    const server = await run(opensearch.url);
    try {
      const answer = await ask(server.url, 'GET', '/goto/odd');
      assert.equal(answer.status, 500);
      assert.deepEqual(JSON.parse(answer.body), {
        statusCode: 500,
        error: 'Internal Server Error',
        message: 'An internal server error occurred.',
      });
      assert.deepEqual(server.errors, ['An answer could not be sent']);
    } finally {
      await server.stop();
      await opensearch.close();
    }
  });
});

describe('the page while OpenSearch does not answer', () => {
  it('comes at once: it does not wait for the time limit of a request', async () => {
    const opensearch = await fakeOpenSearch('hang');
    const server = await run(opensearch.url, { OPENSEARCH_REQUESTTIMEOUT: '4000' });
    try {
      const page = await ask(server.url, 'GET', '/app/home');
      assert.equal(page.status, 200);
      assert.match(page.body, /<html lang="en" class="themeLight">/);
      assert.ok(page.ms < 2000, `the page took ${page.ms} ms`);
    } finally {
      await server.stop();
      await opensearch.close();
    }
  });

  it('is dark when the settings of the server say so', async () => {
    const opensearch = await fakeOpenSearch('hang');
    const server = await run(opensearch.url, {
      OPENSEARCH_REQUESTTIMEOUT: '4000',
      UISETTINGS_OVERRIDES: '{"theme:darkMode":true}',
    });
    try {
      const page = await ask(server.url, 'GET', '/app/home');
      assert.match(page.body, /<html lang="en" class="themeDark">/);
      assert.ok(page.ms < 2000, `the page took ${page.ms} ms`);
    } finally {
      await server.stop();
      await opensearch.close();
    }
  });
});

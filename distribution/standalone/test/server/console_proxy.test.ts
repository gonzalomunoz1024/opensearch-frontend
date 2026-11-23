/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { createApp } from '../../server/app';
import { loadConfig } from '../../server/config';
import { silentLogger } from '../../server/logger';

interface Seen {
  method: string;
  url: string;
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

/** The console's proxy of a server whose OpenSearch is a recorder: what it sends there, what it answers */
async function throughProxy(
  requests: Array<{ method: string; path: string; body?: string }>
): Promise<{ seen: Seen[]; answers: Array<{ status: number; warning?: string; body: string }> }> {
  const seen: Seen[] = [];
  const opensearch = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      seen.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body: Buffer.concat(chunks).toString('utf8') });
      res.writeHead(200, { 'content-type': 'application/json', warning: '299 OpenSearch-3.9.0 "[old] is deprecated"' });
      res.end('{"ok":true}');
    });
  });
  const directory = mkdtempSync(join(tmpdir(), 'console-proxy-'));
  writeFileSync(join(directory, 'build.json'), JSON.stringify({ version: '0.0.0', builtAt: '', assets: { script: '', styles: '' } }));
  const file = join(directory, 'settings.yml');
  writeFileSync(file, `opensearch.hosts: ["http://127.0.0.1:${await listen(opensearch)}"]\n`);
  const app = createApp({ config: loadConfig({ file, env: {} }).config, logger: silentLogger, distDirectory: directory });
  const port = await listen(app.server);
  const answers: Array<{ status: number; warning?: string; body: string }> = [];
  try {
    for (const request of requests) {
      const query = new URLSearchParams({ path: request.path, method: request.method });
      const response = await fetch(`http://127.0.0.1:${port}/api/console/proxy?${query.toString()}`, {
        method: 'POST',
        headers: { 'osd-xsrf': 'true', 'content-type': 'application/json' },
        body: request.body,
      });
      answers.push({ status: response.status, warning: response.headers.get('warning') ?? undefined, body: await response.text() });
    }
  } finally {
    await close(app.server);
    await close(opensearch);
  }
  return { seen, answers };
}

describe("the console's proxy", () => {
  it('sends OpenSearch the request as it was written, and answers as OpenSearch did', async () => {
    const { seen, answers } = await throughProxy([
      { method: 'GET', path: '_cat/indices?v&h=index' },
      { method: 'POST', path: '/logs/_search', body: '{"size":0}\n' },
    ]);
    assert.deepEqual(
      seen.map((request) => [request.method, request.url, request.body, request.headers['content-type']]),
      [
        ['GET', '/_cat/indices?v&h=index', '', undefined],
        ['POST', '/logs/_search', '{"size":0}\n', 'application/json'],
      ]
    );
    assert.deepEqual(answers[1], { status: 200, warning: '299 OpenSearch-3.9.0 "[old] is deprecated"', body: '{"ok":true}' });
  });

  it('gives each request an id of its own', async () => {
    // OpenSearch warns of a deprecated API once for each "x-opaque-id" and once more for requests
    // without one: with no id, the console would show "#! Deprecation" the first time only
    const { seen } = await throughProxy([
      { method: 'GET', path: '_cat/master' },
      { method: 'GET', path: '_cat/master' },
    ]);
    const ids = seen.map((request) => String(request.headers['x-opaque-id'] ?? ''));
    assert.ok(ids[0].length > 0 && ids[1].length > 0, 'both requests carry an id');
    assert.notEqual(ids[0], ids[1]);
  });

  it('refuses a method OpenSearch Dashboards does not pass on, and a request without a path', async () => {
    const { seen, answers } = await throughProxy([
      { method: 'OPTIONS', path: '_cat/indices' },
      { method: 'GET', path: '' },
    ]);
    assert.deepEqual(answers.map((answer) => answer.status), [400, 400]);
    assert.equal(seen.length, 0);
  });
});

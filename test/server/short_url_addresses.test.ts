/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Addresses with backslashes, which a browser reads as slashes: a short URL must not lead to
 * another host through them, as it cannot in the original (whose URL parser is the same).
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { createApp } from '../../server/app';
import { loadConfig } from '../../server/config';
import { HttpError } from '../../server/http';
import { silentLogger } from '../../server/logger';
import { assertShortUrlValid, gotoLocation } from '../../server/short_urls';
import { fakeOpenSearch } from './fake_opensearch';

const refusal = (url: string) => {
  try {
    assertShortUrlValid(url);
    return undefined;
  } catch (error) {
    return error instanceof HttpError ? `${error.status} ${error.message}` : String(error);
  }
};

describe('a short URL with backslashes in its address', () => {
  it('that a browser reads as another host is refused, as the original refuses it', () => {
    assert.equal(refusal('/\\host/app/home'), '406 Short url targets cannot have a hostname, found "host"');
    assert.equal(refusal('\\\\host/app/home'), '406 Short url targets cannot have a hostname, found "host"');
    assert.equal(refusal('\\/host/app/home'), '406 Short url targets cannot have a hostname, found "host"');
    assert.equal(refusal('/\\/host/app/home'), '406 Short url targets cannot have a hostname, found ""');
    assert.equal(refusal(' //host/app/home'), '406 Short url targets cannot have a hostname, found "host"');
  });

  it('that stays on this server is taken, and leads where the browser would read it', () => {
    assert.equal(refusal('/app/home\\x'), undefined);
    assert.equal(gotoLocation('/app/home\\x', '/base'), '/base/app/home/x');
  });

  it('stored without the check is not followed by /goto', async () => {
    const opensearch = await fakeOpenSearch((path) =>
      path.startsWith('/.kibana/_doc/url%3Aelsewhere')
        ? {
            found: true,
            _id: 'url:elsewhere',
            _seq_no: 1,
            _primary_term: 1,
            _source: { type: 'url', url: { url: '/\\elsewhere.example/app/home', accessCount: 0 }, references: [] },
          }
        : undefined
    );
    const { config } = loadConfig({
      env: { SERVER_HOST: '127.0.0.1', SERVER_PORT: '0', OPENSEARCH_HOSTS: JSON.stringify([opensearch.url]) },
    });
    const app = createApp({ config, logger: silentLogger, distDirectory: resolve(__dirname, '..', '..') });
    await app.start();
    try {
      await app.checkHealth();
      const { port } = app.server.address() as AddressInfo;
      const answer = await new Promise<{ status: number; location?: string }>((done, failed) => {
        http
          .get({ host: '127.0.0.1', port, path: '/goto/elsewhere', agent: false }, (response) => {
            response.resume();
            response.on('end', () => done({ status: response.statusCode ?? 0, location: response.headers.location }));
          })
          .on('error', failed);
      });
      assert.deepEqual(answer, { status: 406, location: undefined });
    } finally {
      await app.stop();
      await opensearch.close();
    }
  });
});

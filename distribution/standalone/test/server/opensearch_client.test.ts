/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadConfig } from '../../server/config';
import { OpenSearchClient, OpenSearchUnavailableError } from '../../server/opensearch';
import { fakeOpenSearch as fake } from './fake_opensearch';

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

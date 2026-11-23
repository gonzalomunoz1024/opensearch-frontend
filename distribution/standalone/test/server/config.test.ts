/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadConfig } from '../../server/config';

const opensearch = (env: Record<string, string>) => loadConfig({ env }).config.opensearch;

describe('a setting given in the environment', () => {
  it('that is text made of digits stays as it is written', () => {
    for (const written of ['1.50', '12345678901234567890', '007', '-0', '1.0', '123456', 'true']) {
      const { username, password } = opensearch({
        OPENSEARCH_USERNAME: written,
        OPENSEARCH_PASSWORD: written,
      });
      assert.equal(username, written);
      assert.equal(password, written);
    }
  });

  it('that is a number, a switch or a list is read as one', () => {
    const { config } = loadConfig({
      env: {
        SERVER_PORT: '5602',
        OPENSEARCH_REQUESTTIMEOUT: ' 1500 ',
        MAP_TILEMAP_OPTIONS_MAXZOOM: '12.0',
        LOGGING_QUIET: 'true',
        OPENSEARCH_HOSTS: '["http://a.local:9200/", "http://b.local:9200"]',
      },
    });
    assert.equal(config.server.port, 5602);
    assert.equal(config.opensearch.requestTimeout, 1500);
    assert.equal(config.map.tilemap.options.maxZoom, 12);
    assert.equal(config.logging.quiet, true);
    assert.deepEqual(config.opensearch.hosts, ['http://a.local:9200', 'http://b.local:9200']);
  });
});

describe('a user name and a password inside an address of opensearch.hosts', () => {
  it('are what is sent, and are not kept in the address, which is logged and shown', () => {
    const read = opensearch({
      OPENSEARCH_HOSTS: '["http://reader:p%40ss%3Aword@search.local:9200/", "https://other.local/behind"]',
    });
    assert.deepEqual(read.hosts, ['http://search.local:9200', 'https://other.local/behind']);
    assert.equal(read.username, 'reader');
    assert.equal(read.password, 'p@ss:word');
  });

  it('give way to opensearch.username and opensearch.password', () => {
    const read = opensearch({
      OPENSEARCH_HOSTS: 'https://reader:secret@search.local:9200',
      OPENSEARCH_USERNAME: 'writer',
      OPENSEARCH_PASSWORD: 'other',
    });
    assert.deepEqual(read.hosts, ['https://search.local:9200']);
    assert.equal(read.username, 'writer');
    assert.equal(read.password, 'other');
  });

  it('an address without them is kept as it is written', () => {
    const read = opensearch({ OPENSEARCH_HOSTS: 'http://Search.local:9200/a@b/' });
    assert.deepEqual(read.hosts, ['http://Search.local:9200/a@b']);
    assert.equal(read.username, undefined);
    assert.equal(read.password, undefined);
  });
});

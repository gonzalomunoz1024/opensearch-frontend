/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { buildMatcher, documentationFor, endpointFor, pathTokens, type ApiSpec } from '../../web/apps/dev_tools/console_docs';
import { devTools, toolOf } from '../../web/apps/dev_tools/tools';

// The spec definitions the server answers at /api/console/api_server
const api = JSON.parse(readFileSync('server/console_api_server.json', 'utf8')) as ApiSpec;
const matcher = buildMatcher(api);
const DOCS = 'https://opensearch.org/docs/latest';

describe('the page "Open documentation" opens', () => {
  it('is the one the spec definitions name for the request’s endpoint, not its section’s index', () => {
    assert.equal(documentationFor(matcher, 'GET', '_cat/health'), `${DOCS}/api-reference/cat/cat-health/`);
    assert.equal(documentationFor(matcher, 'GET', '/_cat/health?v'), `${DOCS}/api-reference/cat/cat-health/`);
    assert.equal(documentationFor(matcher, 'GET', '_cluster/health'), `${DOCS}/api-reference/cluster-api/cluster-health/`);
    assert.equal(documentationFor(matcher, 'PUT', 'x/_doc/1'), `${DOCS}/api-reference/document-apis/index-document/`);
    assert.equal(documentationFor(matcher, 'POST', '_aliases'), `${DOCS}/im-plugin/index-alias/`);
    assert.equal(documentationFor(matcher, 'GET', 'logs-*,other/_search'), documentationFor(matcher, 'GET', '_search'));
    assert.match(documentationFor(matcher, 'GET', '_search') ?? '', /^https:\/\/opensearch\.org\/docs\/latest\/.*search/);
  });

  it('is none for a request no endpoint is known for, or one of another method', () => {
    assert.equal(documentationFor(matcher, 'GET', '_no_such_api/x/y'), undefined);
    assert.equal(endpointFor(matcher, 'DELETE', '_cat/health'), undefined);
    assert.equal(endpointFor(matcher, 'TRACE', '_cat/health'), undefined);
  });

  it('reads a path part by part, a part with commas as a list', () => {
    assert.deepEqual(pathTokens('/a,b/_search?size=1'), [['a', 'b'], '_search']);
    assert.deepEqual(pathTokens('_cat//indices'), ['_cat', 'indices']);
  });

  it('takes a literal part before a name, and no name that starts with an underscore for an index', () => {
    const small = buildMatcher({
      opensearch: {
        endpoints: {
          one: { methods: ['GET'], patterns: ['{indices}/_thing'], documentation: 'https://x/one' },
          two: { methods: ['GET'], patterns: ['_all/_thing/{id}'], documentation: 'https://x/two' },
          three: { methods: ['GET'], patterns: ['_thing'], documentation: 'https://x/three', priority: 5 },
          four: { methods: ['GET'], patterns: ['_thing'], documentation: 'https://x/four', priority: 1 },
          five: { methods: ['GET'], patterns: ['_nodes/{metric}'], url_components: { metric: ['jvm', 'os'] }, documentation: 'https://x/five' },
        },
      },
    });
    assert.equal(documentationFor(small, 'GET', 'logs/_thing'), 'https://x/one');
    assert.equal(documentationFor(small, 'GET', '_other/_thing'), undefined);
    assert.equal(documentationFor(small, 'GET', '_all/_thing/7'), 'https://x/two');
    assert.equal(documentationFor(small, 'GET', '_thing'), 'https://x/four');
    assert.equal(documentationFor(small, 'GET', '_nodes/jvm,os'), 'https://x/five');
    assert.equal(documentationFor(small, 'GET', '_nodes/disk'), undefined);
  });
});

describe('the tools of Dev Tools', () => {
  it('are the console and the Grok debugger, without the console when console.enabled is false', () => {
    assert.deepEqual(devTools(true).map((tool) => tool.id), ['console', 'grok_debugger']);
    assert.deepEqual(devTools(false).map((tool) => tool.id), ['grok_debugger']);
  });

  it('show the first tool at an address that names none of them', () => {
    assert.deepEqual(toolOf('/', devTools(true)), { tab: 'console', redirect: true });
    assert.deepEqual(toolOf('/console', devTools(true)), { tab: 'console', redirect: false });
    assert.deepEqual(toolOf('/grok_debugger', devTools(true)), { tab: 'grok_debugger', redirect: false });
    assert.deepEqual(toolOf('/console', devTools(false)), { tab: 'grok_debugger', redirect: true });
  });
});

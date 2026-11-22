/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { explainReply, queryReply, statusName } from '../../server/sql_console';

const ANSWER = '{\n  "schema": [{"name": "bytes", "type": "long"}],\n  "datarows": [[19986]],\n  "total": 1\n}';
const ERROR = '{\n  "error": {\n    "reason": "Invalid SQL query"\n  },\n  "status": 400\n}';

describe('the answers of the Query Workbench routes', () => {
  it('passes rows on as JSON text without its layout', () => {
    assert.deepEqual(queryReply({ plugin: '_sql' }, 200, ANSWER), {
      body: {
        data: { ok: true, resp: '{"schema":[{"name":"bytes","type":"long"}],"datarows":[[19986]],"total":1}' },
      },
    });
  });

  it('passes CSV and text on as they are', () => {
    assert.deepEqual(queryReply({ plugin: '_sql', format: 'csv' }, 200, 'bytes\n19986'), {
      body: { data: { ok: true, resp: 'bytes\n19986' } },
    });
    assert.deepEqual(queryReply({ plugin: '_ppl', format: 'raw' }, 200, 'bytes\n19986'), {
      body: { data: { ok: true, resp: 'bytes\n19986' } },
    });
  });

  it('answers a failed SQL query with its status and the text of OpenSearch', () => {
    assert.deepEqual(queryReply({ plugin: '_sql' }, 400, ERROR), {
      status: 400,
      body: { statusCode: 400, error: 'Bad Request', message: ERROR },
    });
  });

  it('tells a failed PPL query inside a 200 answer', () => {
    assert.deepEqual(queryReply({ plugin: '_ppl', failsInAnswer: true }, 404, ERROR), {
      body: { data: { ok: false, resp: 'Not Found', body: ERROR, statusCode: 404 } },
    });
  });

  it('refuses rows that are not JSON', () => {
    assert.equal(queryReply({ plugin: '_sql' }, 200, 'not json').status, 400);
  });

  it('gives a plan as an object and a failure as the name of its status', () => {
    assert.deepEqual(explainReply(200, '{"root":{"name":"ProjectOperator"}}'), {
      body: { data: { ok: true, resp: { root: { name: 'ProjectOperator' } } } },
    });
    assert.deepEqual(explainReply(400, ERROR), { body: { data: { ok: false, resp: 'Bad Request' } } });
    assert.deepEqual(explainReply(404, ERROR), { body: { data: { ok: false, resp: 'Not Found' } } });
  });

  it('names statuses as the plugin does', () => {
    assert.equal(statusName(401), 'Authentication Exception');
    assert.equal(statusName(403), 'Authorization Exception');
    assert.equal(statusName(503), 'Service Unavailable');
    assert.equal(statusName(418), "I'm a Teapot");
  });
});

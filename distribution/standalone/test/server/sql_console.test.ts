/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  explainReply,
  queryParameterError,
  queryReply,
  statusName,
} from '../../server/sql_console';

const ANSWER =
  '{\n  "schema": [{"name": "bytes", "type": "long"}],\n  "datarows": [[19986]],\n  "total": 1\n}';
const ERROR = '{\n  "error": {\n    "reason": "Invalid SQL query"\n  },\n  "status": 400\n}';
// What OpenSearch itself answers, as JSON, when the plugin cannot read the request
const PAYLOAD_ERROR = JSON.stringify({
  error: {
    root_cause: [{ type: 'illegal_argument_exception', reason: 'Failed to parse request payload' }],
    type: 'illegal_argument_exception',
    reason: 'Failed to parse request payload',
  },
  status: 400,
});
const JSON_TYPE = 'application/json; charset=UTF-8';

describe('the answers of the Query Workbench routes', () => {
  it('passes rows on as JSON text without its layout', () => {
    assert.deepEqual(queryReply({ plugin: '_sql' }, 200, ANSWER, JSON_TYPE), {
      body: {
        data: {
          ok: true,
          resp: '{"schema":[{"name":"bytes","type":"long"}],"datarows":[[19986]],"total":1}',
        },
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
    assert.deepEqual(queryReply({ plugin: '_sql' }, 400, ERROR, 'text/plain; charset=UTF-8'), {
      status: 400,
      body: { statusCode: 400, error: 'Bad Request', message: ERROR },
    });
    // An error OpenSearch gives as JSON is passed on as its text too
    assert.deepEqual(
      queryReply({ plugin: '_sql', format: 'json' }, 400, PAYLOAD_ERROR, JSON_TYPE),
      {
        status: 400,
        body: { statusCode: 400, error: 'Bad Request', message: PAYLOAD_ERROR },
      }
    );
  });

  it('tells a failed PPL query inside a 200 answer, named by its status when it is text', () => {
    assert.deepEqual(
      queryReply({ plugin: '_ppl', failsInAnswer: true }, 404, ERROR, 'text/plain'),
      {
        body: { data: { ok: false, resp: 'Not Found', body: ERROR, statusCode: 404 } },
      }
    );
  });

  it('tells a PPL error OpenSearch gives as JSON by its root causes, with the error read', () => {
    assert.deepEqual(
      queryReply({ plugin: '_ppl', failsInAnswer: true }, 400, PAYLOAD_ERROR, JSON_TYPE),
      {
        body: {
          data: {
            ok: false,
            resp: '[illegal_argument_exception] Failed to parse request payload',
            body: JSON.parse(PAYLOAD_ERROR),
            statusCode: 400,
          },
        },
      }
    );
    // JSON with no reason in it is named by its status
    assert.equal(
      (
        queryReply({ plugin: '_ppl', failsInAnswer: true }, 503, '{"status":503}', JSON_TYPE)
          .body as {
          data: { resp: string };
        }
      ).data.resp,
      'Service Unavailable'
    );
  });

  it('refuses rows that are not JSON, as the client of OpenSearch Dashboards does', () => {
    assert.deepEqual(queryReply({ plugin: '_sql' }, 200, 'not json', JSON_TYPE), {
      status: 400,
      body: { statusCode: 400, error: 'Bad Request', message: 'not json' },
    });
    assert.deepEqual(
      queryReply({ plugin: '_ppl', failsInAnswer: true }, 200, 'not json', JSON_TYPE),
      {
        body: {
          data: {
            ok: false,
            resp: 'Unable to parse/serialize body',
            body: 'not json',
            statusCode: 400,
          },
        },
      }
    );
  });

  it('gives a plan as an object and a failure as the name of its status or its root causes', () => {
    assert.deepEqual(explainReply(200, '{"root":{"name":"ProjectOperator"}}', JSON_TYPE), {
      body: { data: { ok: true, resp: { root: { name: 'ProjectOperator' } } } },
    });
    assert.deepEqual(explainReply(400, ERROR, 'text/plain'), {
      body: { data: { ok: false, resp: 'Bad Request' } },
    });
    assert.deepEqual(explainReply(404, ERROR), {
      body: { data: { ok: false, resp: 'Not Found' } },
    });
    assert.deepEqual(explainReply(400, PAYLOAD_ERROR, JSON_TYPE), {
      body: {
        data: { ok: false, resp: '[illegal_argument_exception] Failed to parse request payload' },
      },
    });
    assert.deepEqual(explainReply(200, '{', JSON_TYPE), {
      body: { data: { ok: false, resp: 'Unable to parse/serialize body' } },
    });
  });

  it('takes dataSourceMDSId in the query string and refuses anything else', () => {
    assert.equal(queryParameterError(new URLSearchParams('')), undefined);
    assert.equal(queryParameterError(new URLSearchParams('dataSourceMDSId=')), undefined);
    assert.deepEqual(queryParameterError(new URLSearchParams('foo=bar&baz=1')), {
      status: 400,
      body: {
        statusCode: 400,
        error: 'Bad Request',
        message: '[request query.foo]: definition for this key is missing',
      },
    });
    assert.deepEqual(
      queryParameterError(new URLSearchParams('dataSourceMDSId=a&dataSourceMDSId=b')),
      {
        status: 400,
        body: {
          statusCode: 400,
          error: 'Bad Request',
          message:
            '[request query.dataSourceMDSId]: expected value of type [string] but got [Array]',
        },
      }
    );
  });

  it('names statuses as the plugin does', () => {
    assert.equal(statusName(401), 'Authentication Exception');
    assert.equal(statusName(403), 'Authorization Exception');
    assert.equal(statusName(503), 'Service Unavailable');
    assert.equal(statusName(418), "I'm a Teapot");
  });
});

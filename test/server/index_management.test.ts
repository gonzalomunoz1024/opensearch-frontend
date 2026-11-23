/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  changeAnswer,
  customSort,
  getSearchString,
  isApiCall,
  reindexTarget,
  snapshotError,
  transformManagedIndexMetaData,
  wildcardQuery,
} from '../../server/index_management';
import { LegacyError, legacyMessage, legacyRequest } from '../../server/legacy_client';

describe('a request named as the old client library named it', () => {
  it('puts the parts it is given in the address and the rest in the query', () => {
    assert.deepEqual(
      legacyRequest('cat.indices', { format: 'json', index: 'logs-*', s: 'index:desc' }),
      { method: 'GET', path: '/_cat/indices/logs-*?format=json&s=index%3Adesc', body: undefined }
    );
    assert.deepEqual(legacyRequest('cat.indices', { format: 'json' }), {
      method: 'GET',
      path: '/_cat/indices?format=json',
      body: undefined,
    });
  });

  it('keeps the commas of a list and encodes each of its items', () => {
    assert.equal(
      legacyRequest('indices.get', { index: ['a b', 'c/d'] }).path,
      '/a%20b,c%2Fd'
    );
    assert.equal(legacyRequest('indices.get', { index: 'one, two' }).path, '/one,two');
  });

  it('chooses the address with the most parts it can fill', () => {
    assert.equal(
      legacyRequest('indices.rollover', { alias: 'logs', newIndex: 'logs-2', body: {} }).path,
      '/logs/_rollover/logs-2'
    );
    assert.equal(legacyRequest('indices.rollover', { alias: 'logs' }).path, '/logs/_rollover');
    assert.equal(
      legacyRequest('cluster.state', { metric: 'metadata', index: 'logs' }).path,
      '/_cluster/state/metadata/logs'
    );
  });

  it('sends the body with the method of the endpoint', () => {
    assert.deepEqual(
      legacyRequest('indices.putSettings', {
        index: 'logs',
        flat_settings: true,
        body: { 'index.number_of_replicas': 2 },
      }),
      {
        method: 'PUT',
        path: '/logs/_settings?flat_settings=true',
        body: { 'index.number_of_replicas': 2 },
      }
    );
  });

  it('takes a parameter in the spelling of either', () => {
    assert.equal(
      legacyRequest('cluster.health', { filterPath: 'status' }).path,
      '/_cluster/health?filter_path=status'
    );
  });

  it('refuses a call it cannot address', () => {
    assert.throws(() => legacyRequest('nothing.here'), /^Error: called with an invalid endpoint: nothing.here$/);
    assert.throws(
      () => legacyRequest('indices.get', {}),
      /^Error: Unable to build a path with those params. Supply at least index$/
    );
  });

  it('passes on a request written out in full', () => {
    assert.deepEqual(
      legacyRequest('transport.request', { method: 'put', path: '/_index_template/logs', body: { priority: 1 } }),
      { method: 'PUT', path: '/_index_template/logs', body: { priority: 1 } }
    );
    assert.deepEqual(
      legacyRequest('transport.request', { path: '/_data_stream/*/_stats?human=true', query: { pretty: false } }),
      { method: 'GET', path: '/_data_stream/*/_stats?human=true&pretty=false', body: undefined }
    );
  });
});

describe('the message of a failure', () => {
  it('names each root cause with what else it tells', () => {
    const body = {
      error: {
        root_cause: [
          { type: 'index_not_found_exception', reason: 'no such index [logs]', index: 'logs', 'resource.id': 'logs' },
        ],
        type: 'index_not_found_exception',
        reason: 'no such index [logs]',
      },
      status: 404,
    };
    assert.equal(
      legacyMessage(404, body),
      '[index_not_found_exception] no such index [logs], with { index="logs" & resource.id="logs" }'
    );
  });

  it('joins several causes', () => {
    const body = {
      error: {
        root_cause: [
          { type: 'a', reason: 'first' },
          { type: 'b', reason: 'second' },
        ],
      },
    };
    assert.equal(legacyMessage(400, body), '[a] first (and) [b] second');
  });

  it('falls back on the error itself, then on the name of the status', () => {
    assert.equal(legacyMessage(404, { error: { type: 'status_exception', reason: 'Policy not found' } }), '[status_exception] Policy not found');
    assert.equal(legacyMessage(400, { error: 'no handler found' }), 'no handler found');
    assert.equal(legacyMessage(404, undefined), 'Not Found');
    assert.equal(legacyMessage(403, 'plain text'), 'Authorization Exception');
  });
});

describe('what the routes of Index Management ask for and answer', () => {
  it('searches for terms, indices and data streams between wildcards', () => {
    assert.equal(getSearchString([], [], []), '*');
    assert.equal(getSearchString(['logs'], [], []), '*logs*');
    assert.equal(getSearchString(['a', 'b'], ['c'], ['d']), '*a*,*b*,*c*,*d*');
    assert.equal(getSearchString([], [], [], false), '* -.ds*');
  });

  it('turns a search box into a query string', () => {
    assert.equal(wildcardQuery('  '), '*');
    assert.equal(wildcardQuery('hot warm'), '*hot* *warm*');
  });

  it('renames what the explain API tells of a managed index', () => {
    assert.deepEqual(
      transformManagedIndexMetaData({
        index: 'logs-1',
        index_uuid: 'u',
        policy_id: 'p',
        policy_seq_no: 3,
        policy_primary_term: 1,
        state: { name: 'hot', start_time: 5 },
        action: { name: 'rollover', start_time: 6, index: 0, failed: false, consumed_retries: 0 },
        retry_info: { failed: false, consumed_retries: 0 },
        info: { message: 'Pending rollover' },
      }),
      {
        index: 'logs-1',
        indexUuid: 'u',
        policyId: 'p',
        policySeqNo: 3,
        policyPrimaryTerm: 1,
        policyCompleted: undefined,
        rolledOver: undefined,
        transitionTo: undefined,
        state: { name: 'hot', startTime: 5 },
        action: { name: 'rollover', startTime: 6, index: 0, failed: false, consumedRetries: 0 },
        retryInfo: { failed: false, consumedRetries: 0 },
        info: { message: 'Pending rollover' },
      }
    );
    // An index that is not managed yet tells its setting and nothing else
    assert.equal(transformManagedIndexMetaData({ 'index.plugins.index_state_management.policy_id': 'p' }), null);
    assert.equal(transformManagedIndexMetaData(undefined), null);
  });

  it('renames the indices a change failed for', () => {
    assert.deepEqual(
      changeAnswer({
        updated_indices: 1,
        failures: true,
        failed_indices: [{ index_name: 'logs-2', index_uuid: 'u', reason: 'closed' }],
      }),
      {
        failures: true,
        updatedIndices: 1,
        failedIndices: [{ indexName: 'logs-2', indexUuid: 'u', reason: 'closed' }],
      }
    );
    assert.deepEqual(changeAnswer({ updated_indices: 2, failures: false }).failedIndices, []);
  });

  it('sorts by plain comparison in either direction', () => {
    const rows = () => [{ managed: 'No' }, { managed: 'Yes' }, { managed: 'No' }];
    assert.deepEqual(customSort(rows(), 'managed', 'asc').map((row) => row.managed), ['No', 'No', 'Yes']);
    assert.deepEqual(customSort(rows(), 'managed', 'desc').map((row) => row.managed), ['Yes', 'No', 'No']);
  });

  it('reads the index a reindex task writes to', () => {
    assert.equal(reindexTarget('reindex from [logs-1] to [logs-2][_doc]'), 'logs-2');
    assert.equal(reindexTarget('something else'), '');
    assert.equal(reindexTarget(undefined), '');
  });

  it('accepts as a call a body with an endpoint and nothing unknown', () => {
    assert.equal(isApiCall({ endpoint: 'cat.aliases', data: { format: 'json' }, hideLog: true }), true);
    assert.equal(isApiCall({ endpoint: 'cluster.health', data: null, hideLog: null }), true);
    assert.equal(isApiCall({ endpoint: '' }), true);
    assert.equal(isApiCall({}), false);
    assert.equal(isApiCall({ endpoint: 5 }), false);
    assert.equal(isApiCall({ endpoint: 'cluster.health', method: 'GET' }), false);
    assert.equal(isApiCall({ endpoint: 'cluster.health', hideLog: 'yes' }), false);
    assert.equal(isApiCall([]), false);
  });

  it('words a failure of the snapshot routes with the answer of OpenSearch', () => {
    const answer = '{"error":{"type":"repository_missing_exception","reason":"[backups] missing"},"status":404}';
    assert.equal(snapshotError(new LegacyError('[repository_missing_exception] [backups] missing', 404, JSON.parse(answer), answer)), answer);
    assert.equal(snapshotError(new LegacyError('Bad Request', 400, { reason: 'told plainly' }, '{"reason":"told plainly"}')), 'told plainly');
    assert.equal(snapshotError(new LegacyError('Bad Gateway', 502, 'not json', 'not json')), 'not json');
    assert.equal(snapshotError(new Error('No Living connections')), 'No Living connections');
  });
});

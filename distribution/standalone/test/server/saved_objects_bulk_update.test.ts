/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import { describe, it } from 'node:test';
import { HttpError, Router, type Reply } from '../../server/http';
import type { OpenSearchClient, OpenSearchRequest } from '../../server/opensearch';
import { SavedObjectsRepository } from '../../server/saved_objects';
import { registerSavedObjects } from '../../server/saved_objects_routes';

interface BulkLine {
  update?: Record<string, unknown>;
  doc?: Record<string, unknown>;
}

/** A client that keeps what it is sent and answers a bulk request with these items */
function fakeClient(items: unknown[] = []) {
  const sent: OpenSearchRequest[] = [];
  const client = {
    request: async (request: OpenSearchRequest) => {
      sent.push(request);
      return { items };
    },
  };
  return { client: client as unknown as OpenSearchClient, sent };
}

const linesOf = (request: OpenSearchRequest) =>
  String(request.body)
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as BulkLine);
const versionOf = (seqNo: number, primaryTerm: number) => Buffer.from(JSON.stringify([seqNo, primaryTerm])).toString('base64');
const updated = (seqNo: number, source: Record<string, unknown> = {}) => ({
  update: { _seq_no: seqNo, _primary_term: 2, status: 200, get: { _source: source } },
});
const failed = (type: string, reason: string) => ({ update: { status: 400, error: { type, reason } } });

describe('a bulk update of saved objects', () => {
  it('changes the objects in one request to OpenSearch and answers what was sent, as the original', async () => {
    const { client, sent } = fakeClient([updated(7), updated(8, { originId: 'first' })]);
    const repository = new SavedObjectsRepository(client, '.kibana');
    const references = [{ name: 'panel_0', type: 'search', id: 's' }];
    const results = await repository.bulkUpdate([
      { type: 'dashboard', id: 'a', attributes: { description: 'new' }, version: versionOf(3, 1) },
      { type: 'dashboard', id: 'b', attributes: { title: 'b' }, references },
    ]);

    assert.equal(sent.length, 1);
    assert.equal(`${sent[0].method} ${sent[0].path}`, 'POST /_bulk');
    assert.deepEqual(sent[0].query, { refresh: 'wait_for', _source_includes: 'originId' });
    const lines = linesOf(sent[0]);
    const time = lines[1].doc?.updated_at;
    assert.equal(typeof time, 'string');
    assert.deepEqual(lines, [
      { update: { _id: 'dashboard:a', _index: '.kibana', if_seq_no: 3, if_primary_term: 1 } },
      { doc: { dashboard: { description: 'new' }, updated_at: time } },
      { update: { _id: 'dashboard:b', _index: '.kibana' } },
      { doc: { dashboard: { title: 'b' }, updated_at: time, references } },
    ]);

    // The keys in the original's order, and no references when none were sent
    assert.equal(
      JSON.stringify(results),
      JSON.stringify([
        { id: 'a', type: 'dashboard', namespaces: ['default'], updated_at: time, version: versionOf(7, 2), attributes: { description: 'new' } },
        { id: 'b', type: 'dashboard', namespaces: ['default'], originId: 'first', updated_at: time, version: versionOf(8, 2), attributes: { title: 'b' }, references },
      ])
    );
  });

  it('answers an error for an object it cannot change, and changes the others', async () => {
    const { client, sent } = fakeClient([
      failed('document_missing_exception', '[_doc][dashboard:gone]: document missing'),
      failed('version_conflict_engine_exception', 'version conflict'),
      failed('strict_dynamic_mapping_exception', 'mapping set to strict, dynamic introduction of [x] within [dashboard] is not allowed'),
      failed('document_missing_exception', '[_doc][other:dashboard:a]: document missing'),
      updated(9),
    ]);
    const repository = new SavedObjectsRepository(client, '.kibana');
    const results = await repository.bulkUpdate([
      { type: 'no-such-type', id: 'a', attributes: {} },
      { type: 'dashboard', id: 'gone', attributes: {} },
      { type: 'dashboard', id: 'a', attributes: {}, namespace: '*' },
      { type: 'dashboard', id: 'old', attributes: {}, version: versionOf(1, 1) },
      { type: 'dashboard', id: 'strict', attributes: { x: 1 } },
      { type: 'dashboard', id: 'a', attributes: {}, namespace: 'other' },
      { type: 'dashboard', id: 'a', attributes: { hits: 1 }, namespace: 'default' },
    ]);

    // What is refused before OpenSearch is asked is not sent; another namespace is part of the id
    assert.deepEqual(
      linesOf(sent[0]).flatMap((line) => (line.update ? [line.update._id] : [])),
      ['dashboard:gone', 'dashboard:old', 'dashboard:strict', 'other:dashboard:a', 'dashboard:a']
    );
    assert.equal(
      JSON.stringify(results.slice(0, 6)),
      JSON.stringify([
        { id: 'a', type: 'no-such-type', error: { statusCode: 404, error: 'Not Found', message: 'Saved object [no-such-type/a] not found' } },
        { id: 'gone', type: 'dashboard', error: { statusCode: 404, error: 'Not Found', message: 'Saved object [dashboard/gone] not found' } },
        { id: 'a', type: 'dashboard', error: { message: '"namespace" cannot be "*": Bad Request', statusCode: 400, error: 'Bad Request' } },
        { id: 'old', type: 'dashboard', error: { statusCode: 409, error: 'Conflict', message: 'Saved object [dashboard/old] conflict' } },
        { id: 'strict', type: 'dashboard', error: { message: 'mapping set to strict, dynamic introduction of [x] within [dashboard] is not allowed' } },
        { id: 'a', type: 'dashboard', error: { statusCode: 404, error: 'Not Found', message: 'Saved object [dashboard/a] not found' } },
      ])
    );
    assert.deepEqual({ ...results[6], updated_at: '' }, {
      id: 'a',
      type: 'dashboard',
      namespaces: ['default'],
      updated_at: '',
      version: versionOf(9, 2),
      attributes: { hits: 1 },
      references: undefined,
    });
  });

  it('refuses them all for a version that cannot be read, and asks OpenSearch for nothing without objects', async () => {
    const { client, sent } = fakeClient();
    const repository = new SavedObjectsRepository(client, '.kibana');
    await assert.rejects(
      repository.bulkUpdate([
        { type: 'dashboard', id: 'a', attributes: {} },
        { type: 'dashboard', id: 'b', attributes: {}, version: 'nope' },
      ]),
      (error: unknown) => error instanceof HttpError && error.status === 400 && error.message === 'Invalid version [nope]'
    );
    assert.deepEqual(await repository.bulkUpdate([]), []);
    assert.deepEqual(await repository.bulkUpdate([{ type: 'no-such-type', id: 'a', attributes: {} }]), [
      { id: 'a', type: 'no-such-type', error: { statusCode: 404, error: 'Not Found', message: 'Saved object [no-such-type/a] not found' } },
    ]);
    assert.equal(sent.length, 0);
  });
});

describe('PUT /api/saved_objects/_bulk_update', () => {
  const put = async (body: unknown, items: unknown[] = []): Promise<Reply> => {
    const router = new Router();
    registerSavedObjects(router, new SavedObjectsRepository(fakeClient(items).client, '.kibana'), {
      maxImportExportSize: 10000,
      maxImportPayloadBytes: 26214400,
    });
    const { route, params } = router.match('PUT', '/api/saved_objects/_bulk_update');
    assert.ok(route, 'the route is there');
    return (route as NonNullable<typeof route>).handler({
      req: {} as IncomingMessage,
      method: 'PUT',
      path: '/api/saved_objects/_bulk_update',
      query: new URLSearchParams(),
      params,
      body: async () => Buffer.from(body === undefined ? '' : JSON.stringify(body)),
      json: async <T>() => body as T | undefined,
    });
  };
  const refusal = async (body: unknown) => {
    try {
      await put(body);
    } catch (error) {
      return error instanceof HttpError ? `${error.status} ${error.message}` : String(error);
    }
    return 'answered';
  };

  it('answers the objects under `saved_objects`', async () => {
    const reply = await put([{ type: 'dashboard', id: 'a', attributes: { hits: 2 } }], [updated(4)]);
    const answer = reply.body as { saved_objects: Array<Record<string, unknown>> };
    assert.equal(answer.saved_objects.length, 1);
    assert.deepEqual({ ...answer.saved_objects[0], updated_at: '' }, {
      id: 'a',
      type: 'dashboard',
      namespaces: ['default'],
      updated_at: '',
      version: versionOf(4, 2),
      attributes: { hits: 2 },
      references: undefined,
    });
    assert.deepEqual((await put([])).body, { saved_objects: [] });
  });

  it('checks the body as the original does, in its words', async () => {
    assert.equal(await refusal(undefined), '400 [request body]: expected value of type [array] but got [null]');
    assert.equal(await refusal({}), '400 [request body]: expected value of type [array] but got [Object]');
    assert.equal(
      await refusal([{ type: 'dashboard', id: 'a' }]),
      '400 [request body.0.attributes]: expected value of type [object] but got [undefined]'
    );
    assert.equal(
      await refusal([{ type: 'dashboard', attributes: {} }]),
      '400 [request body.0.id]: expected value of type [string] but got [undefined]'
    );
    assert.equal(
      await refusal([{ type: 'dashboard', id: 'a', attributes: {}, extra: 1 }]),
      '400 [request body.0.extra]: definition for this key is missing'
    );
    assert.equal(
      await refusal([{ type: 'dashboard', id: 'a', attributes: {}, namespace: '' }]),
      '400 [request body.0.namespace]: value has length [0] but it must have a minimum length of [1].'
    );
    assert.equal(
      await refusal([{ type: 'dashboard', id: 'a', attributes: {}, references: [{ name: 'a' }] }]),
      '400 [request body.0.references.0.type]: expected value of type [string] but got [undefined]'
    );
  });
});

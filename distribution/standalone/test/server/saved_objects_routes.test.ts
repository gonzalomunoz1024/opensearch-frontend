/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The saved objects API as the original answers it. The answers expected were sent by OpenSearch
 * Dashboards 3.9.0 (the fork's build) for the same requests against the same index mapping.
 */

import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import { describe, it } from 'node:test';
import { HttpError, Router, type Reply } from '../../server/http';
import { SavedObjectsRepository } from '../../server/saved_objects';
import { registerSavedObjects } from '../../server/saved_objects_routes';
import { FakeSavedObjectsIndex } from './saved_objects_fake_index';

const VIS = '{"title":"x","type":"markdown","params":{"markdown":"x"},"aggs":[]}';
const attributes = (name: string) => ({
  title: `t ${name}`,
  visState: VIS,
  uiStateJSON: '{}',
  description: '',
  version: 1,
  kibanaSavedObjectMeta: { searchSourceJSON: '{}' },
});
const line = (name: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ type: 'visualization', id: name, attributes: attributes(name), references: [], ...extra });

/** A form with a file, and the fields given, as the page sends an import */
function form(fields: Record<string, string>, file: string) {
  const boundary = 'zzboundary';
  const parts = [
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="export.ndjson"\r\nContent-Type: application/ndjson\r\n\r\n${file}\r\n`,
    ...Object.entries(fields).map(([name, value]) => `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`),
    `--${boundary}--\r\n`,
  ];
  return { body: Buffer.from(parts.join('')), type: `multipart/form-data; boundary=${boundary}` };
}

function api(index = new FakeSavedObjectsIndex()) {
  const router = new Router();
  registerSavedObjects(router, new SavedObjectsRepository(index.client, '.kibana'), { maxImportExportSize: 10000, maxImportPayloadBytes: 26214400 });
  const call = async (method: string, address: string, body?: unknown, contentType?: string): Promise<Reply> => {
    const url = new URL(address, 'http://localhost');
    const { route, params } = router.match(method, url.pathname);
    assert.ok(route, `${method} ${url.pathname} is a route`);
    const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body === undefined ? '' : JSON.stringify(body));
    return (route as NonNullable<typeof route>).handler({
      req: { headers: { 'content-type': contentType ?? 'application/json' } } as unknown as IncomingMessage,
      method,
      path: url.pathname,
      query: url.searchParams,
      params,
      body: async () => bytes,
      json: async <T>() => (Buffer.isBuffer(body) ? undefined : (body as T | undefined)),
    });
  };
  const refusal = async (method: string, address: string, body?: unknown) => {
    try {
      await call(method, address, body);
    } catch (error) {
      return error instanceof HttpError ? `${error.status} ${error.message}` : String(error);
    }
    return 'answered';
  };
  const upload = (address: string, file: string, fields: Record<string, string> = {}) => {
    const sent = form(fields, file);
    return call('POST', address, sent.body, sent.type);
  };
  return { index, call, refusal, upload };
}

const strict = (field: string) => `mapping set to strict, dynamic introduction of [${field}] within [_doc] is not allowed`;
const importError = (id: string, error: Record<string, unknown>) => ({
  id,
  type: 'visualization',
  title: `t ${id}`,
  meta: { title: `t ${id}`, icon: 'visualizeApp' },
  error,
});

describe('workspaces and permissions, which the original passes down to the document', () => {
  it('writes the workspaces of a create into the document, which OpenSearch refuses as it refuses the original', async () => {
    const { index, refusal } = api();
    assert.equal(
      await refusal('POST', '/api/saved_objects/visualization/a', { attributes: attributes('a'), workspaces: ['w'] }),
      `400 ${strict('workspaces')}: strict_dynamic_mapping_exception: [strict_dynamic_mapping_exception] Reason: ${strict('workspaces')}`
    );
    assert.equal(index.docs.size, 0);
    // The document it sent, keys in the original serializer's order
    const sent = index.sent.find((request) => request.method === 'PUT');
    assert.deepEqual(Object.keys(sent?.body as Record<string, unknown>), [
      'visualization',
      'type',
      'references',
      'migrationVersion',
      'updated_at',
      'workspaces',
    ]);
    // What the schema refuses is refused before
    assert.equal(
      await refusal('POST', '/api/saved_objects/visualization/a', { attributes: attributes('a'), workspaces: [] }),
      '400 [request body.workspaces]: array size is [0], but cannot be smaller than [1]'
    );
    assert.equal(
      await refusal('POST', '/api/saved_objects/visualization/a', { attributes: attributes('a'), permissions: { read: {} } }),
      '400 [request body.permissions]: definition for this key is missing'
    );
  });

  it('gives the workspaces of a bulk create to the objects it makes new, not to those it overwrites', async () => {
    const { index, call } = api();
    const made = await call('POST', '/api/saved_objects/_bulk_create?workspaces=w', [{ type: 'visualization', id: 'bulk', attributes: attributes('bulk') }]);
    assert.equal(JSON.stringify(made.body), JSON.stringify({ saved_objects: [{ id: 'bulk', type: 'visualization', error: { message: strict('workspaces') } }] }));
    const overwritten = await call('POST', '/api/saved_objects/_bulk_create?overwrite=true&workspaces=w', [
      { type: 'visualization', id: 'bulk2', attributes: attributes('bulk2') },
    ]);
    const [object] = (overwritten.body as { saved_objects: Array<Record<string, unknown>> }).saved_objects;
    assert.equal(object.error, undefined);
    assert.deepEqual([...index.docs.keys()], ['visualization:bulk2']);
    assert.deepEqual(Object.keys(index.docs.get('visualization:bulk2')?.source ?? {}), ['visualization', 'type', 'references', 'migrationVersion', 'updated_at']);
  });

  it('passes the workspaces of an import, and the root fields of each line, as the original does', async () => {
    const { index, upload } = api();
    const answer = async (address: string, file: string) => JSON.stringify((await upload(address, file)).body);
    assert.equal(
      await answer('/api/saved_objects/_import?workspaces=w', line('import')),
      JSON.stringify({ successCount: 0, success: false, errors: [importError('import', { message: strict('workspaces'), type: 'unknown' })] })
    );
    assert.equal(
      await answer('/api/saved_objects/_import', line('perm', { permissions: { read: { users: ['zz'] } } })),
      JSON.stringify({ successCount: 0, success: false, errors: [importError('perm', { message: strict('permissions'), type: 'unknown' })] })
    );
    // An object's own workspaces are written when it overwrites, left out when it is made new
    assert.equal(
      await answer('/api/saved_objects/_import?overwrite=true', line('wsroot', { workspaces: ['w'] })),
      JSON.stringify({ successCount: 0, success: false, errors: [importError('wsroot', { message: strict('workspaces'), type: 'unknown' })] })
    );
    assert.equal(
      await answer('/api/saved_objects/_import', line('wsroot2', { workspaces: ['w'] })),
      JSON.stringify({
        successCount: 1,
        success: true,
        successResults: [{ type: 'visualization', id: 'wsroot2', meta: { title: 't wsroot2', icon: 'visualizeApp' } }],
      })
    );
    assert.equal(
      await answer('/api/saved_objects/_import', line('initns', { initialNamespaces: ['default'] })),
      JSON.stringify({
        successCount: 0,
        success: false,
        errors: [
          importError('initns', {
            message: '"initialNamespaces" can only be used on multi-namespace types: Bad Request',
            statusCode: 400,
            error: 'Bad Request',
            type: 'unknown',
          }),
        ],
      })
    );
    assert.deepEqual([...index.docs.keys()], ['visualization:wsroot2']);
  });

  it('passes the workspaces of a resolve of import errors', async () => {
    const { index, upload } = api();
    const reply = await upload('/api/saved_objects/_resolve_import_errors?workspaces=w', line('resolve'), {
      retries: JSON.stringify([{ type: 'visualization', id: 'resolve', overwrite: false, replaceReferences: [] }]),
    });
    assert.equal(
      JSON.stringify(reply.body),
      JSON.stringify({ successCount: 0, success: false, errors: [importError('resolve', { message: strict('workspaces'), type: 'unknown' })] })
    );
    assert.equal(index.docs.size, 0);
  });
});

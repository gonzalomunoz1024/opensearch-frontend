/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The repository, the import, the resolving of its errors and the export, through their routes,
 * against what OpenSearch Dashboards 3.9.0 (the fork's build) answered to the same requests in the
 * same order: `saved_objects_api_cases.json` holds each request and the original's status and
 * answer, and the documents its index held at the end. Times and versions are written `<time>`
 * and `<version>`, and the ids the original made up `<uuid-1>`, `<uuid-2>` in the order they
 * appear, in the recording and here alike.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { HttpError, Router } from '../../server/http';
import { SavedObjectsRepository } from '../../server/saved_objects';
import { registerSavedObjectsManagement } from '../../server/saved_objects_management';
import { registerSavedObjects } from '../../server/saved_objects_routes';
import { FakeSavedObjectsIndex } from './saved_objects_fake_index';

interface Step {
  name: string;
  method: string;
  path: string;
  body?: unknown;
  file?: string;
  fields?: Record<string, string>;
  status: number;
  answer: unknown;
}

const cases = JSON.parse(readFileSync(join(__dirname, 'saved_objects_api_cases.json'), 'utf8')) as {
  steps: Step[];
  stored: Array<{ _id: string; _source: Record<string, unknown> }>;
};

function form(file: string, fields: Record<string, string> = {}) {
  const boundary = 'zzboundary';
  const parts = [
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="export.ndjson"\r\nContent-Type: application/ndjson\r\n\r\n${file}\r\n`,
    ...Object.entries(fields).map(([name, value]) => `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`),
    `--${boundary}--\r\n`,
  ];
  return { body: Buffer.from(parts.join('')), type: `multipart/form-data; boundary=${boundary}` };
}

/** Times, versions and made-up ids written as the recording writes them */
function normaliser() {
  const uuids = new Map<string, string>();
  return (text: string) =>
    text
      .replace(/"updated_at":"[^"]*"/g, '"updated_at":"<time>"')
      .replace(/"version":"[^"]*"/g, '"version":"<version>"')
      .replace(/\\"updated_at\\":\\"[^"\\]*\\"/g, '\\"updated_at\\":\\"<time>\\"')
      .replace(/\\"version\\":\\"[^"\\]*\\"/g, '\\"version\\":\\"<version>\\"')
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, (uuid) => {
        const known = uuids.get(uuid) ?? `<uuid-${uuids.size + 1}>`;
        uuids.set(uuid, known);
        return known;
      });
}

/** The answer of a route as the server sends it: a refusal in the original's envelope */
const STATUS_TEXT: Record<number, string> = { 400: 'Bad Request', 404: 'Not Found', 409: 'Conflict' };

async function replay() {
  const index = new FakeSavedObjectsIndex();
  const router = new Router();
  const repository = new SavedObjectsRepository(index.client, '.kibana');
  registerSavedObjects(router, repository, { maxImportExportSize: 10000, maxImportPayloadBytes: 26214400 });
  registerSavedObjectsManagement(router, repository);
  const normalise = normaliser();
  const answers: Array<{ name: string; status: number; answer: string }> = [];
  for (const step of cases.steps) {
    const url = new URL(step.path, 'http://localhost');
    const { route, params } = router.match(step.method, url.pathname);
    assert.ok(route, `${step.method} ${url.pathname} is a route`);
    const sent = step.file === undefined ? undefined : form(step.file, step.fields);
    const bytes = sent ? sent.body : Buffer.from(step.body === undefined ? '' : JSON.stringify(step.body));
    let status = 200;
    let answer: unknown;
    try {
      const reply = await route.handler({
        req: { headers: { 'content-type': sent ? sent.type : 'application/json' } } as unknown as IncomingMessage,
        method: step.method,
        path: url.pathname,
        query: url.searchParams,
        params,
        body: async () => bytes,
        json: async <T>() => (sent ? undefined : (step.body as T | undefined)),
      });
      status = reply.status ?? 200;
      answer = Buffer.isBuffer(reply.body) ? reply.body.toString('utf8') : reply.body;
    } catch (error) {
      if (!(error instanceof HttpError)) throw error;
      status = error.status;
      answer = { statusCode: error.status, error: STATUS_TEXT[error.status], message: error.message, ...(error.attributes ? { attributes: error.attributes } : {}) };
    }
    // As the recording reads an answer: JSON where it is JSON, and the text of a file otherwise
    const text = normalise(typeof answer === 'string' ? answer : JSON.stringify(answer));
    let read: unknown = text;
    try {
      read = JSON.parse(text);
    } catch {
      // An export of several lines
    }
    answers.push({ name: step.name, status, answer: JSON.stringify(read) });
  }
  const stored = [...index.docs].map(([id, doc]) => JSON.parse(normalise(JSON.stringify({ _id: id, _source: doc.source }))) as { _id: string; _source: Record<string, unknown> });
  return { answers, stored };
}

describe('the saved objects API, request by request as OpenSearch Dashboards 3.9.0 answered it', () => {
  const replayed = replay();

  for (const [at, step] of cases.steps.entries()) {
    it(`${step.name} (${step.method} ${step.path.split('?')[0].replace('/api/', '')})`, async () => {
      const { answers } = await replayed;
      assert.equal(answers[at].status, step.status);
      assert.equal(answers[at].answer, JSON.stringify(step.answer));
    });
  }

  it('leaves the documents the original left, key for key', async () => {
    const { stored } = await replayed;
    const byId = new Map(stored.map((doc) => [doc._id, doc]));
    assert.deepEqual([...byId.keys()].sort(), cases.stored.map((doc) => doc._id).sort());
    for (const expected of cases.stored) assert.equal(JSON.stringify(byId.get(expected._id)), JSON.stringify(expected), expected._id);
  });
});

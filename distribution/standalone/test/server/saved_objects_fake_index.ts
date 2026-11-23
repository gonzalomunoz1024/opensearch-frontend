/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The index of saved objects, held in memory and answering the requests the repository sends as
 * OpenSearch answers them: versions, conflicts, partial updates, the strict mapping of OpenSearch
 * Dashboards 3.9.0 and the words OpenSearch refuses a document with. For the tests of the
 * repository, of the import and of the export.
 */

import type { IncomingHttpHeaders } from 'node:http';
import { OpenSearchError, type OpenSearchClient, type OpenSearchRequest, type OpenSearchResponse } from '../../server/opensearch';
import mappings from '../../server/saved_objects_mappings.json';

type Json = Record<string, unknown>;

interface Stored {
  source: Json;
  seqNo: number;
  primaryTerm: number;
  version: number;
}

interface FieldMapping {
  type?: string;
  dynamic?: boolean | string;
  enabled?: boolean;
  properties?: Record<string, FieldMapping>;
}

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The field a document brings that a strict mapping has no place for, as OpenSearch names it */
export function strictRefusal(source: Json, mapping: FieldMapping = mappings as FieldMapping): string | undefined {
  const walk = (value: Json, at: FieldMapping, path: string, dynamic: boolean | string | undefined): string | undefined => {
    const effective = at.dynamic ?? dynamic;
    for (const [name, child] of Object.entries(value)) {
      const field = at.properties?.[name];
      if (!field) {
        if (effective === 'strict') return `mapping set to strict, dynamic introduction of [${name}] within [${path}] is not allowed`;
        continue;
      }
      if (field.properties && field.enabled !== false && isObject(child)) {
        const refused = walk(child, field, path === '_doc' ? name : `${path}.${name}`, effective);
        if (refused) return refused;
      }
    }
    return undefined;
  };
  return walk(source, mapping, '_doc', undefined);
}

const reply = (status: number, body: unknown): OpenSearchResponse => ({
  status,
  headers: { 'content-type': 'application/json' } as IncomingHttpHeaders,
  body: Buffer.from(JSON.stringify(body)),
});

const refusal = (status: number, type: string, reason: string) => ({
  error: { root_cause: [{ type, reason }], type, reason },
  status,
});

/** The fields of a document that a `_source` filter keeps, dotted paths included */
function pick(source: Json, includes: unknown): Json {
  const list = typeof includes === 'string' ? includes.split(',') : Array.isArray(includes) ? includes.map(String) : undefined;
  if (!list) return source;
  const result: Json = {};
  for (const path of list) {
    const parts = path.split('.');
    let from: unknown = source;
    for (const part of parts) from = isObject(from) ? from[part] : undefined;
    if (from === undefined) continue;
    let into = result;
    for (const part of parts.slice(0, -1)) {
      if (!isObject(into[part])) into[part] = {};
      into = into[part] as Json;
    }
    into[parts[parts.length - 1]] = from;
  }
  return result;
}

/** A partial update: objects merged key by key, anything else replaced */
function merge(target: Json, patch: Json): Json {
  const result: Json = { ...target };
  for (const [key, value] of Object.entries(patch)) {
    result[key] = isObject(value) && isObject(result[key]) ? merge(result[key] as Json, value) : value;
  }
  return result;
}

export class FakeSavedObjectsIndex {
  readonly docs = new Map<string, Stored>();
  readonly sent: OpenSearchRequest[] = [];
  /** What a search answers: the hits, by default every document, in the order they were written */
  search: (body: Json, query: OpenSearchRequest['query']) => { total: number; hits: Json[] } = () => ({
    total: this.docs.size,
    hits: [...this.docs].map(([id, stored]) => this.hit(id, stored)),
  });
  private seqNo = 0;
  private exists = true;

  constructor(readonly index = '.kibana') {}

  /** A document as stored by someone else */
  put(id: string, source: Json): void {
    this.write(id, source);
  }

  dropIndex(): void {
    this.exists = false;
    this.docs.clear();
  }

  get client(): OpenSearchClient {
    const raw = async (request: OpenSearchRequest) => {
      this.sent.push(request);
      return this.answer(request);
    };
    const client = {
      raw,
      request: async <T>(request: OpenSearchRequest): Promise<T> => {
        const response = await raw(request);
        const body = JSON.parse(response.body.toString('utf8')) as unknown;
        if (response.status >= 400) throw new OpenSearchError(response.status, body, `OpenSearch answered ${response.status}`);
        return body as T;
      },
    };
    return client as unknown as OpenSearchClient;
  }

  private hit(id: string, stored: Stored, includes?: unknown): Json {
    return {
      _index: `${this.index}_1`,
      _id: id,
      _score: 1,
      _seq_no: stored.seqNo,
      _primary_term: stored.primaryTerm,
      _source: pick(stored.source, includes),
    };
  }

  private write(id: string, source: Json): Stored {
    const previous = this.docs.get(id);
    this.seqNo += 1;
    const stored = { source, seqNo: this.seqNo, primaryTerm: 1, version: (previous?.version ?? 0) + 1 };
    this.docs.set(id, stored);
    return stored;
  }

  /** One write of a document, as `_doc`, `_create` and each line of `_bulk` make it */
  private writeOne(
    action: 'index' | 'create' | 'update',
    id: string,
    body: Json,
    versions: { if_seq_no?: unknown; if_primary_term?: unknown }
  ): { status: number; body: Json } {
    const current = this.docs.get(id);
    if (!this.exists) return { status: 404, body: refusal(404, 'index_not_found_exception', `no such index [${this.index}]`) };
    if (action === 'create' && current) {
      return {
        status: 409,
        body: refusal(409, 'version_conflict_engine_exception', `[${id}]: version conflict, document already exists (current version [${current.version}])`),
      };
    }
    if (action === 'update' && !current) {
      return { status: 404, body: refusal(404, 'document_missing_exception', `[_doc][${id}]: document missing`) };
    }
    if (versions.if_seq_no !== undefined && (!current || Number(versions.if_seq_no) !== current.seqNo || Number(versions.if_primary_term) !== current.primaryTerm)) {
      return {
        status: 409,
        body: refusal(
          409,
          'version_conflict_engine_exception',
          `[${id}]: version conflict, required seqNo [${String(versions.if_seq_no)}], primary term [${String(versions.if_primary_term)}]. ${
            current ? `current document has seqNo [${current.seqNo}] and primary term [${current.primaryTerm}]` : 'but no document was found'
          }`
        ),
      };
    }
    const source = action === 'update' && current ? merge(current.source, (body.doc as Json) ?? {}) : body;
    const refused = strictRefusal(source);
    if (refused) return { status: 400, body: refusal(400, 'strict_dynamic_mapping_exception', refused) };
    const stored = this.write(id, source);
    return {
      status: current ? 200 : 201,
      body: {
        _index: `${this.index}_1`,
        _id: id,
        _version: stored.version,
        result: action === 'update' ? 'updated' : current ? 'updated' : 'created',
        _seq_no: stored.seqNo,
        _primary_term: stored.primaryTerm,
      },
    };
  }

  private answer(request: OpenSearchRequest): OpenSearchResponse {
    const query = request.query ?? {};
    const index = encodeURIComponent(this.index);
    const path = request.path;
    const docId = (prefix: string) => decodeURIComponent(path.slice(prefix.length));
    // A bulk request's body is lines of JSON, read below
    const body = (path === '/_bulk' ? {} : typeof request.body === 'string' ? JSON.parse(request.body || '{}') : (request.body ?? {})) as Json;

    if (request.method === 'HEAD' && path === `/${index}`) return reply(this.exists ? 200 : 404, {});
    if (request.method === 'PUT' && path === `/${encodeURIComponent(`${this.index}_1`)}`) {
      this.exists = true;
      return reply(200, { acknowledged: true });
    }
    if (request.method === 'GET' && path.startsWith(`/${index}/_doc/`)) {
      const id = docId(`/${index}/_doc/`);
      const stored = this.docs.get(id);
      if (!this.exists) return reply(404, refusal(404, 'index_not_found_exception', `no such index [${this.index}]`));
      if (!stored) return reply(404, { _index: `${this.index}_1`, _id: id, found: false });
      return reply(200, { ...this.hit(id, stored), _score: undefined, _version: stored.version, found: true });
    }
    if (request.method === 'PUT' && (path.startsWith(`/${index}/_doc/`) || path.startsWith(`/${index}/_create/`))) {
      const create = path.startsWith(`/${index}/_create/`);
      const id = docId(create ? `/${index}/_create/` : `/${index}/_doc/`);
      const written = this.writeOne(create ? 'create' : 'index', id, body, query);
      return reply(written.status, written.body);
    }
    if (request.method === 'POST' && path.startsWith(`/${index}/_update/`)) {
      const id = docId(`/${index}/_update/`);
      const written = this.writeOne('update', id, body, query);
      if (written.status >= 400) return reply(written.status, written.body);
      const stored = this.docs.get(id);
      return reply(200, {
        ...written.body,
        ...(query._source_includes && stored ? { get: { _source: pick(stored.source, query._source_includes) } } : {}),
      });
    }
    if (request.method === 'DELETE' && path.startsWith(`/${index}/_doc/`)) {
      const id = docId(`/${index}/_doc/`);
      if (!this.exists) return reply(404, refusal(404, 'index_not_found_exception', `no such index [${this.index}]`));
      if (!this.docs.delete(id)) return reply(404, { _index: `${this.index}_1`, _id: id, result: 'not_found' });
      return reply(200, { _index: `${this.index}_1`, _id: id, result: 'deleted' });
    }
    if (request.method === 'POST' && path === '/_mget') {
      const docs = (body.docs as Array<{ _id: string; _source?: unknown }>).map(({ _id, _source }) => {
        const stored = this.docs.get(_id);
        return stored
          ? { ...this.hit(_id, stored, _source), _score: undefined, _version: stored.version, found: true }
          : { _index: `${this.index}_1`, _id, found: false };
      });
      return reply(200, { docs });
    }
    if (request.method === 'POST' && path === '/_bulk') {
      const lines = String(request.body)
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line) as Json);
      const items: Json[] = [];
      for (let at = 0; at < lines.length; at += 2) {
        const [action, meta] = Object.entries(lines[at])[0] as ['index' | 'create' | 'update', Json];
        const written = this.writeOne(action, String(meta._id), lines[at + 1], meta);
        const stored = this.docs.get(String(meta._id));
        items.push({
          [action]:
            written.status >= 400
              ? { _index: `${this.index}_1`, _id: meta._id, status: written.status, error: (written.body.error as Json) }
              : {
                  ...written.body,
                  status: written.status,
                  ...(action === 'update' && query._source_includes && stored ? { get: { _source: pick(stored.source, query._source_includes) } } : {}),
                },
        });
      }
      return reply(200, { took: 1, errors: items.some((item) => Object.values(item).some((entry) => (entry as Json).error)), items });
    }
    if (request.method === 'POST' && path === `/${index}/_search`) {
      if (!this.exists) return reply(404, refusal(404, 'index_not_found_exception', `no such index [${this.index}]`));
      const { total, hits } = this.search(body, query);
      const size = Number(query.size ?? 10);
      const from = Number(query.from ?? 0);
      const includes = query._source;
      return reply(200, {
        hits: {
          total,
          hits: hits.slice(from, from + size).map((hit) => (includes ? { ...hit, _source: pick(hit._source as Json, includes) } : hit)),
        },
      });
    }
    return reply(400, refusal(400, 'fake_exception', `the fake index does not know ${request.method} ${path}`));
  }
}

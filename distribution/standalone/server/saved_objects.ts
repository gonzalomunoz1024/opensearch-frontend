/* SPDX-License-Identifier: Apache-2.0 */

/* Reads and writes saved objects in the index OpenSearch Dashboards keeps them in. */

import { randomUUID } from 'node:crypto';
import {
  MIGRATION_VERSIONS,
  type FindResponse,
  type SavedObject,
  type SavedObjectReference,
} from '../common/saved_objects';
import { HttpError, badRequest, conflict, notFound } from './http';
import { OpenSearchError, type OpenSearchClient } from './opensearch';
import mappings from './saved_objects_mappings.json';

// Fields every document has beside the one named after its type
const ROOT_FIELDS = new Set([
  'type',
  'namespace',
  'namespaces',
  'originId',
  'references',
  'migrationVersion',
  'updated_at',
]);

const properties = mappings.properties as Record<string, { type?: string }>;

/** The types the index has a place for. A document of another type would be refused by it. */
export const SAVED_OBJECT_TYPES = Object.keys(properties).filter((name) => !ROOT_FIELDS.has(name));

interface RawDocument {
  _id: string;
  _seq_no?: number;
  _primary_term?: number;
  found?: boolean;
  _source?: Record<string, unknown>;
}

export interface FindOptions {
  type: string[];
  search?: string;
  searchFields?: string[];
  defaultSearchOperator?: 'AND' | 'OR';
  page?: number;
  perPage?: number;
  sortField?: string;
  sortOrder?: 'asc' | 'desc';
  fields?: string[];
  hasReference?: { type: string; id: string };
}

export interface CreateOptions {
  id?: string;
  overwrite?: boolean;
  references?: SavedObjectReference[];
  migrationVersion?: Record<string, string>;
}

const encodeVersion = (seqNo?: number, primaryTerm?: number) =>
  seqNo === undefined || primaryTerm === undefined
    ? undefined
    : Buffer.from(JSON.stringify([seqNo, primaryTerm])).toString('base64');

function decodeVersion(version: string): { if_seq_no: number; if_primary_term: number } {
  try {
    const [seqNo, primaryTerm] = JSON.parse(Buffer.from(version, 'base64').toString('utf8'));
    if (Number.isInteger(seqNo) && Number.isInteger(primaryTerm)) {
      return { if_seq_no: seqNo, if_primary_term: primaryTerm };
    }
  } catch {
    // falls through
  }
  throw badRequest(`Invalid version [${version}]`);
}

export class SavedObjectsRepository {
  constructor(
    private readonly client: OpenSearchClient,
    private readonly index: string
  ) {}

  /**
   * Makes the index if the cluster has none: `<index>_1` behind the alias `<index>`, with the
   * mappings OpenSearch Dashboards 3.9.0 gives it. An index that is already there is used as it
   * is, whoever made it.
   */
  async ensureIndex(): Promise<'exists' | 'created'> {
    const head = await this.client.raw({ method: 'HEAD', path: `/${encodeURIComponent(this.index)}` });
    if (head.status === 200) return 'exists';
    if (head.status !== 404) {
      throw new HttpError(503, `The saved objects index answered ${head.status}`);
    }
    try {
      await this.client.request({
        method: 'PUT',
        path: `/${encodeURIComponent(`${this.index}_1`)}`,
        body: {
          settings: { number_of_shards: 1, auto_expand_replicas: '0-1' },
          mappings,
          aliases: { [this.index]: {} },
        },
      });
      return 'created';
    } catch (error) {
      // Another replica of this server made it in the meantime
      const type = ((error as OpenSearchError).body as { error?: { type?: string } })?.error?.type;
      if (type === 'resource_already_exists_exception') return 'exists';
      throw error;
    }
  }

  assertType(type: string) {
    if (!SAVED_OBJECT_TYPES.includes(type)) {
      throw badRequest(`Unsupported saved object type: '${type}'`);
    }
  }

  async get(type: string, id: string): Promise<SavedObject> {
    this.assertType(type);
    const response = await this.client.raw({ method: 'GET', path: this.docPath(type, id) });
    if (response.status === 404) throw notFound(`Saved object [${type}/${id}] not found`);
    const document = this.json<RawDocument>(response.status, response.body);
    if (!document.found || !document._source) throw notFound(`Saved object [${type}/${id}] not found`);
    return this.toSavedObject(document);
  }

  async create(
    type: string,
    attributes: Record<string, unknown>,
    options: CreateOptions = {}
  ): Promise<SavedObject> {
    this.assertType(type);
    const id = options.id ?? randomUUID();
    const source = this.toSource(type, attributes, options);
    try {
      const result = await this.client.request<RawDocument>({
        method: 'PUT',
        path: options.overwrite
          ? this.docPath(type, id)
          : `/${encodeURIComponent(this.index)}/_create/${encodeURIComponent(`${type}:${id}`)}`,
        query: { refresh: 'wait_for' },
        body: source,
      });
      return this.toSavedObject({ ...result, _id: `${type}:${id}`, _source: source });
    } catch (error) {
      if (error instanceof OpenSearchError && error.status === 409) {
        throw conflict(`Saved object [${type}/${id}] conflict`);
      }
      throw error;
    }
  }

  async update(
    type: string,
    id: string,
    attributes: Record<string, unknown>,
    options: { references?: SavedObjectReference[]; version?: string } = {}
  ): Promise<SavedObject> {
    this.assertType(type);
    const doc: Record<string, unknown> = {
      [type]: attributes,
      updated_at: new Date().toISOString(),
    };
    if (options.references) doc.references = options.references;
    try {
      const result = await this.client.request<RawDocument & { get?: { _source: Record<string, unknown> } }>({
        method: 'POST',
        path: `/${encodeURIComponent(this.index)}/_update/${encodeURIComponent(`${type}:${id}`)}`,
        query: {
          refresh: 'wait_for',
          _source: true,
          ...(options.version ? decodeVersion(options.version) : {}),
        },
        body: { doc },
      });
      return this.toSavedObject({ ...result, _id: `${type}:${id}`, _source: result.get?._source });
    } catch (error) {
      if (error instanceof OpenSearchError && error.status === 404) {
        throw notFound(`Saved object [${type}/${id}] not found`);
      }
      if (error instanceof OpenSearchError && error.status === 409) {
        throw conflict(`Saved object [${type}/${id}] was changed by someone else`);
      }
      throw error;
    }
  }

  async delete(type: string, id: string): Promise<void> {
    this.assertType(type);
    const response = await this.client.raw({
      method: 'DELETE',
      path: this.docPath(type, id),
      query: { refresh: 'wait_for' },
    });
    if (response.status === 404) throw notFound(`Saved object [${type}/${id}] not found`);
    this.json(response.status, response.body);
  }

  async find(options: FindOptions): Promise<FindResponse> {
    options.type.forEach((type) => this.assertType(type));
    const page = options.page ?? 1;
    const perPage = options.perPage ?? 20;
    if (page < 1 || perPage < 0 || page * perPage > 10000) {
      throw badRequest('page and per_page must stay within the first 10000 objects');
    }

    const filter: unknown[] = [{ terms: { type: options.type } }];
    if (options.hasReference) {
      filter.push({
        nested: {
          path: 'references',
          query: {
            bool: {
              must: [
                { term: { 'references.id': options.hasReference.id } },
                { term: { 'references.type': options.hasReference.type } },
              ],
            },
          },
        },
      });
    }
    const must: unknown[] = [];
    if (options.search) {
      const fields = options.searchFields?.length
        ? options.searchFields.flatMap((field) => options.type.map((type) => `${type}.${field}`))
        : undefined;
      must.push({
        simple_query_string: {
          query: options.search,
          ...(fields ? { fields } : { lenient: true, fields: ['*'] }),
          default_operator: options.defaultSearchOperator ?? 'OR',
        },
      });
    }

    const body: Record<string, unknown> = {
      seq_no_primary_term: true,
      track_total_hits: true,
      from: (page - 1) * perPage,
      size: perPage,
      query: { bool: { filter, ...(must.length ? { must } : {}) } },
    };
    if (options.sortField) {
      const order = options.sortOrder ?? 'asc';
      if (ROOT_FIELDS.has(options.sortField)) {
        body.sort = [{ [options.sortField]: { order, unmapped_type: 'date' } }];
      } else if (options.type.length === 1) {
        const [type] = options.type;
        const mapped = (properties[type] as { properties?: Record<string, { type?: string }> })
          .properties?.[options.sortField]?.type;
        // A text field cannot be sorted on, and no caller needs it: lists sort titles themselves
        if (mapped && mapped !== 'text') {
          body.sort = [{ [`${type}.${options.sortField}`]: { order, unmapped_type: mapped } }];
        }
      }
    }
    if (options.fields?.length) {
      body._source = [
        ...options.type.flatMap((type) => options.fields!.map((field) => `${type}.${field}`)),
        ...ROOT_FIELDS,
      ];
    }

    const result = await this.client.request<{
      hits: { total: number; hits: RawDocument[] };
    }>({
      method: 'POST',
      path: `/${encodeURIComponent(this.index)}/_search`,
      query: { rest_total_hits_as_int: true },
      body,
    });
    return {
      page,
      per_page: perPage,
      total: result.hits.total,
      saved_objects: result.hits.hits.map((hit) => this.toSavedObject(hit)),
    };
  }

  /** Each object asked for, in order; one that does not exist comes back with an `error` */
  async bulkGet(
    objects: Array<{ type: string; id: string }>
  ): Promise<Array<SavedObject | (Pick<SavedObject, 'id' | 'type'> & { error: unknown })>> {
    if (objects.length === 0) return [];
    objects.forEach(({ type }) => this.assertType(type));
    const result = await this.client.request<{ docs: RawDocument[] }>({
      method: 'POST',
      path: `/${encodeURIComponent(this.index)}/_mget`,
      body: { docs: objects.map(({ type, id }) => ({ _id: `${type}:${id}` })) },
    });
    return result.docs.map((document, at) =>
      document.found && document._source
        ? this.toSavedObject(document)
        : {
            id: objects[at].id,
            type: objects[at].type,
            error: {
              statusCode: 404,
              error: 'Not Found',
              message: `Saved object [${objects[at].type}/${objects[at].id}] not found`,
            },
          }
    );
  }

  async bulkCreate(
    objects: Array<Pick<SavedObject, 'type' | 'attributes'> & Partial<SavedObject>>,
    options: { overwrite?: boolean } = {}
  ): Promise<Array<SavedObject | (Pick<SavedObject, 'id' | 'type'> & { error: unknown })>> {
    if (objects.length === 0) return [];
    const prepared = objects.map((object) => {
      this.assertType(object.type);
      const id = object.id ?? randomUUID();
      return { id, type: object.type, source: this.toSource(object.type, object.attributes, object) };
    });
    const lines = prepared.flatMap(({ id, type, source }) => [
      JSON.stringify({ [options.overwrite ? 'index' : 'create']: { _id: `${type}:${id}` } }),
      JSON.stringify(source),
    ]);
    const result = await this.client.request<{
      items: Array<Record<string, { status: number; error?: { type?: string; reason?: string } } & RawDocument>>;
    }>({
      method: 'POST',
      path: `/${encodeURIComponent(this.index)}/_bulk`,
      query: { refresh: 'wait_for' },
      body: `${lines.join('\n')}\n`,
      headers: { 'content-type': 'application/x-ndjson' },
    });
    return result.items.map((item, at) => {
      const outcome = Object.values(item)[0];
      const { id, type, source } = prepared[at];
      if (outcome.error) {
        const status = outcome.status === 409 ? 409 : outcome.status;
        return {
          id,
          type,
          error: {
            statusCode: status,
            error: status === 409 ? 'Conflict' : 'Bad Request',
            message:
              status === 409
                ? `Saved object [${type}/${id}] conflict`
                : (outcome.error.reason ?? 'The object was refused'),
          },
        };
      }
      return this.toSavedObject({ ...outcome, _id: `${type}:${id}`, _source: source });
    });
  }

  private docPath(type: string, id: string) {
    return `/${encodeURIComponent(this.index)}/_doc/${encodeURIComponent(`${type}:${id}`)}`;
  }

  private toSource(type: string, attributes: Record<string, unknown>, options: CreateOptions) {
    const migrationVersion =
      options.migrationVersion ??
      (MIGRATION_VERSIONS[type] ? { [type]: MIGRATION_VERSIONS[type] } : undefined);
    return {
      [type]: attributes,
      type,
      references: options.references ?? [],
      ...(migrationVersion ? { migrationVersion } : {}),
      updated_at: new Date().toISOString(),
    };
  }

  private toSavedObject(document: RawDocument): SavedObject {
    const source = document._source ?? {};
    const type = String(source.type ?? document._id.slice(0, document._id.indexOf(':')));
    const id = document._id.startsWith(`${type}:`) ? document._id.slice(type.length + 1) : document._id;
    return {
      id,
      type,
      attributes: (source[type] as Record<string, unknown>) ?? {},
      references: (source.references as SavedObjectReference[]) ?? [],
      ...(source.migrationVersion
        ? { migrationVersion: source.migrationVersion as Record<string, string> }
        : {}),
      ...(source.updated_at ? { updated_at: source.updated_at as string } : {}),
      version: encodeVersion(document._seq_no, document._primary_term),
    };
  }

  private json<T>(status: number, body: Buffer): T {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body.toString('utf8'));
    } catch {
      parsed = body.toString('utf8');
    }
    if (status >= 400) {
      throw new OpenSearchError(status, parsed, `OpenSearch answered ${status}`);
    }
    return parsed as T;
  }
}

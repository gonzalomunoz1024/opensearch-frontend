/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Reads and writes saved objects in the index OpenSearch Dashboards keeps them in, as its saved
 * objects repository does: the same requests to OpenSearch, and the same answers and errors.
 */

import { randomUUID } from 'node:crypto';
import { type SavedObject, type SavedObjectReference } from '../common/saved_objects';
import { migrateDocument, type MigrationDocument } from './saved_objects_migrations';
import { HttpError, badRequest } from './http';
import { silentLogger, type Logger } from './logger';
import { OpenSearchError, type OpenSearchClient } from './opensearch';
import mappings from './saved_objects_mappings.json';
import { badRequestError, filterToKueryNode, getSearchDsl, includedFields, type IndexMapping } from './saved_objects_search';
import { isAllowedType, isNamespaceAgnostic } from './saved_objects_types';

const INDEX_MAPPING = mappings as IndexMapping;

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

/** The types the index has a place for. A document of another type would be refused by it. */
export const SAVED_OBJECT_TYPES = Object.keys(INDEX_MAPPING.properties).filter((name) => !ROOT_FIELDS.has(name));

interface RawSource {
  type?: string;
  namespace?: string;
  namespaces?: string[];
  originId?: string;
  references?: SavedObjectReference[];
  migrationVersion?: Record<string, string>;
  updated_at?: string;
  workspaces?: string[];
  permissions?: unknown;
  [field: string]: unknown;
}

interface RawDocument {
  _id: string;
  _seq_no?: number;
  _primary_term?: number;
  _score?: number | null;
  sort?: unknown[];
  found?: boolean;
  _source?: RawSource;
}

export interface FindOptions {
  type: string | string[];
  search?: string;
  searchFields?: string[];
  rootSearchFields?: string[];
  defaultSearchOperator?: string;
  page?: number;
  perPage?: number;
  sortField?: string;
  /** Not on the `_find` API, which has no place for it: the saved objects page sends it */
  sortOrder?: string;
  fields?: string[];
  hasReference?: { type: string; id: string };
  /** DQL over `<type>.attributes.<field>` and the fields every object has */
  filter?: string;
  namespaces?: string[];
  workspaces?: string[];
}

/** An object as a search finds it: with its score, and the values it was sorted by */
export type FoundObject = SavedObject & { namespaces?: string[]; score: number | null; sort?: unknown[] };

export interface FindResult {
  page: number;
  per_page: number;
  total: number;
  saved_objects: FoundObject[];
}

/** What OpenSearch Dashboards answers for one object of a bulk request that failed */
export interface ObjectError {
  statusCode?: number;
  error?: string;
  message: string;
  metadata?: Record<string, unknown>;
}

export type BulkResult = SavedObject | { id: string; type: string; error: ObjectError };

export const isObjectError = (result: BulkResult): result is { id: string; type: string; error: ObjectError } =>
  'error' in result && result.error !== undefined;

export interface CreateOptions {
  id?: string;
  overwrite?: boolean;
  references?: SavedObjectReference[];
  migrationVersion?: Record<string, string>;
  originId?: string;
  version?: string;
  /**
   * Written into the document, as the original writes them although its workspaces and
   * permissions are off: the index has no place for them, so OpenSearch refuses such a document
   */
  workspaces?: string[];
  permissions?: unknown;
}

export interface BulkCreateObject {
  type: string;
  id?: string;
  attributes: Record<string, unknown>;
  references?: SavedObjectReference[];
  migrationVersion?: Record<string, string>;
  originId?: string;
  version?: string;
  /** Refused when given at all, as no type spans namespaces; an import passes on what its file has */
  initialNamespaces?: unknown;
  /** Written for an object that overwrites another; a new one gets those of the request */
  workspaces?: unknown;
  permissions?: unknown;
}

export interface BulkUpdateObject {
  type: string;
  id: string;
  attributes: Record<string, unknown>;
  version?: string;
  references?: SavedObjectReference[];
  namespace?: string;
}

/** What a bulk update answers for an object it changed: what was sent, not the whole object */
export interface BulkUpdateResult {
  id: string;
  type: string;
  namespaces?: string[];
  originId?: string;
  updated_at: string;
  version?: string;
  attributes: Record<string, unknown>;
  references?: SavedObjectReference[];
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

const STATUS_ERRORS: Record<number, string> = {
  400: 'Bad Request',
  404: 'Not Found',
  409: 'Conflict',
};

/** The body of an error as a bulk answer gives it for one object */
const errorContent = (error: HttpError): ObjectError => ({
  statusCode: error.status,
  error: STATUS_ERRORS[error.status] ?? 'Error',
  message: error.message,
});

// An error the original makes of a plain one, as a bad request, has its message first
const decoratedContent = (error: HttpError): ObjectError => ({
  message: error.message,
  statusCode: error.status,
  error: STATUS_ERRORS[error.status] ?? 'Error',
});

export const unsupportedTypeError = (type: string) => badRequestError(`Unsupported saved object type: '${type}'`);
export const notFoundError = (type: string, id: string) => new HttpError(404, `Saved object [${type}/${id}] not found`);
export const conflictError = (type: string, id: string) => new HttpError(409, `Saved object [${type}/${id}] conflict`);

/**
 * An error of OpenSearch as the saved objects service passes it on: the reason OpenSearch gives,
 * then the message its client makes of the answer, with the status that says what went wrong.
 */
export function decorateOpenSearchError(error: OpenSearchError): HttpError {
  const body = error.body as {
    error?: { reason?: string; type?: string; root_cause?: Array<{ type?: string; reason?: string }> };
  } | null;
  const detail = body && typeof body === 'object' ? body.error : undefined;
  let message = 'Response Error';
  if (detail && typeof detail === 'object' && detail.type) {
    message = Array.isArray(detail.root_cause)
      ? `${detail.type}: ${detail.root_cause.map((cause) => `[${cause.type}] Reason: ${cause.reason}`).join('; ')}`
      : detail.type;
  }
  const reason = detail && typeof detail === 'object' ? detail.reason : undefined;
  const text = reason ? `${reason}: ${message}` : message;
  if (error.status === 404) return new HttpError(404, 'Not Found');
  if ([400, 401, 403, 409, 413, 429, 503].includes(error.status)) return new HttpError(error.status, text);
  return new HttpError(500, 'An internal server error occurred');
}

const namespacesOf = (type: string, source: RawSource) =>
  isNamespaceAgnostic(type) ? [] : (source.namespaces ?? [source.namespace ?? 'default']);

export class SavedObjectsRepository {
  constructor(
    private readonly client: OpenSearchClient,
    private readonly index: string,
    /** Where a migration that fails says so, as the original's migrator logs it */
    private readonly log: Logger = silentLogger
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

  /** The mappings the searches are checked against */
  get mappings(): IndexMapping {
    return INDEX_MAPPING;
  }

  assertType(type: string) {
    if (!isAllowedType(type)) throw unsupportedTypeError(type);
  }

  async get(type: string, id: string): Promise<SavedObject & { namespaces?: string[] }> {
    if (!isAllowedType(type)) throw notFoundError(type, id);
    const response = await this.client.raw({ method: 'GET', path: this.docPath(type, id) });
    if (response.status === 404) throw notFoundError(type, id);
    const document = this.json<RawDocument>(response.status, response.body);
    if (!document.found || !document._source) throw notFoundError(type, id);
    return this.fromSource(type, id, document);
  }

  async create(
    type: string,
    attributes: Record<string, unknown>,
    options: CreateOptions = {}
  ): Promise<SavedObject & { namespaces?: string[] }> {
    this.assertType(type);
    const id = options.id ?? randomUUID();
    // As the original's create hands it to its migrator: an id made here is not known to it yet
    const source = this.toSource({
      id: options.id,
      type,
      originId: options.originId,
      attributes,
      migrationVersion: options.migrationVersion,
      updated_at: new Date().toISOString(),
      references: options.references ?? [],
      ...(Array.isArray(options.workspaces) ? { workspaces: options.workspaces } : {}),
      ...(options.permissions ? { permissions: options.permissions } : {}),
    });
    const overwrite = Boolean(options.id && options.overwrite);
    const result = await this.call<RawDocument>({
      method: 'PUT',
      path: overwrite
        ? this.docPath(type, id)
        : `/${encodeURIComponent(this.index)}/_create/${encodeURIComponent(`${type}:${id}`)}`,
      query: {
        refresh: 'wait_for',
        ...(overwrite && options.version ? decodeVersion(options.version) : {}),
      },
      body: source,
    });
    return this.rawToSavedObject({ ...result, _id: `${type}:${id}`, _source: source });
  }

  async update(
    type: string,
    id: string,
    attributes: Record<string, unknown>,
    options: { references?: SavedObjectReference[]; version?: string } = {}
  ) {
    if (!isAllowedType(type)) throw notFoundError(type, id);
    const time = new Date().toISOString();
    const doc: Record<string, unknown> = {
      [type]: attributes,
      updated_at: time,
      ...(Array.isArray(options.references) ? { references: options.references } : {}),
    };
    const response = await this.client.raw({
      method: 'POST',
      path: `/${encodeURIComponent(this.index)}/_update/${encodeURIComponent(`${type}:${id}`)}`,
      query: {
        refresh: 'wait_for',
        _source_includes: 'namespace,namespaces,originId',
        ...(options.version ? decodeVersion(options.version) : {}),
      },
      body: { doc },
    });
    if (response.status === 404) throw notFoundError(type, id);
    const result = this.json<RawDocument & { get?: { _source?: RawSource } }>(response.status, response.body);
    const source = result.get?._source ?? {};
    return {
      id,
      type,
      updated_at: time,
      version: encodeVersion(result._seq_no, result._primary_term),
      namespaces: namespacesOf(type, source),
      ...(source.originId ? { originId: source.originId } : {}),
      references: options.references,
      attributes,
    };
  }

  async delete(type: string, id: string, _options: { force?: boolean } = {}): Promise<Record<string, never>> {
    if (!isAllowedType(type)) throw notFoundError(type, id);
    // No type of this product spans several namespaces, so `force` changes nothing
    const response = await this.client.raw({
      method: 'DELETE',
      path: this.docPath(type, id),
      query: { refresh: 'wait_for' },
    });
    const body = this.parse(response.body) as { result?: string; error?: { type?: string } } | undefined;
    if (body?.result === 'deleted') return {};
    if (body?.result === 'not_found' || body?.error?.type === 'index_not_found_exception') {
      throw notFoundError(type, id);
    }
    this.json(response.status, response.body);
    throw new Error(`Unexpected OpenSearch DELETE response: ${JSON.stringify({ type, id, response: { body, statusCode: response.status } })}`);
  }

  async find(options: FindOptions): Promise<FindResult> {
    const { page = 1, perPage = 20, namespaces, filter, fields } = options;
    if (!options.type) throw badRequestError('options.type must be a string or an array of strings');
    if (namespaces?.length === 0) throw badRequestError('options.namespaces cannot be an empty array');
    const types = Array.isArray(options.type) ? options.type : [options.type];
    const allowedTypes = types.filter(isAllowedType);
    if (allowedTypes.length === 0) return { page, per_page: perPage, total: 0, saved_objects: [] };

    const kueryNode = filter ? filterToKueryNode(allowedTypes, filter, INDEX_MAPPING) : undefined;
    const dsl = getSearchDsl(INDEX_MAPPING, {
      types: allowedTypes,
      search: options.search,
      defaultSearchOperator: options.defaultSearchOperator ?? 'OR',
      searchFields: options.searchFields,
      rootSearchFields: options.rootSearchFields,
      sortField: options.sortField,
      sortOrder: options.sortOrder,
      namespaces,
      hasReference: options.hasReference,
      kueryNode,
      workspaces: options.workspaces,
    });
    // The fields to read are those of every type asked for, as the original names them
    const source = includedFields(types, fields);
    const response = await this.client.raw({
      method: 'POST',
      path: `/${encodeURIComponent(this.index)}/_search`,
      query: {
        size: perPage,
        from: perPage * (page - 1),
        ...(source ? { _source: source.join(',') } : {}),
        rest_total_hits_as_int: true,
      },
      body: { seq_no_primary_term: true, ...dsl },
    });
    // No index yet: nothing is found
    if (response.status === 404) return { page, per_page: perPage, total: 0, saved_objects: [] };
    const result = this.json<{ hits: { total: number; hits: RawDocument[] } }>(response.status, response.body);
    return {
      page,
      per_page: perPage,
      total: result.hits.total,
      saved_objects: result.hits.hits.map((hit) => ({
        ...this.rawToSavedObject(hit),
        score: hit._score ?? null,
        ...(hit.sort !== undefined ? { sort: hit.sort } : {}),
      })),
    };
  }

  /** Each object asked for, in order; one that cannot be read comes back with an `error` */
  async bulkGet(objects: Array<{ type: string; id: string; fields?: string[] }>): Promise<BulkResult[]> {
    if (objects.length === 0) return [];
    const allowed = objects.filter(({ type }) => isAllowedType(type));
    const docs = allowed.length
      ? (
          await this.call<{ docs: RawDocument[] }>({
            method: 'POST',
            path: '/_mget',
            body: {
              docs: allowed.map(({ type, id, fields }) => {
                const source = includedFields([type], fields);
                return { _id: `${type}:${id}`, _index: this.index, ...(source ? { _source: source } : {}) };
              }),
            },
          })
        ).docs
      : [];
    let at = 0;
    return objects.map(({ type, id }) => {
      if (!isAllowedType(type)) return { id, type, error: decoratedContent(unsupportedTypeError(type)) };
      const document = docs[at];
      at += 1;
      if (!document?.found || !document._source) return { id, type, error: errorContent(notFoundError(type, id)) };
      return this.fromSource(type, id, document);
    });
  }

  /** Which of these objects are stored already: each one comes back as a conflict */
  async checkConflicts(objects: Array<{ type: string; id: string }>): Promise<Array<{ id: string; type: string; error: ObjectError }>> {
    if (objects.length === 0) return [];
    const allowed = objects.filter(({ type }) => isAllowedType(type));
    const docs = allowed.length
      ? (
          await this.call<{ docs: RawDocument[] }>({
            method: 'POST',
            path: '/_mget',
            body: {
              docs: allowed.map(({ type, id }) => ({ _id: `${type}:${id}`, _index: this.index, _source: ['type', 'namespaces'] })),
            },
          })
        ).docs
      : [];
    const errors: Array<{ id: string; type: string; error: ObjectError }> = [];
    let at = 0;
    for (const { type, id } of objects) {
      if (!isAllowedType(type)) {
        errors.push({ id, type, error: decoratedContent(unsupportedTypeError(type)) });
        continue;
      }
      const document = docs[at];
      at += 1;
      if (document?.found) errors.push({ id, type, error: errorContent(conflictError(type, id)) });
    }
    return errors;
  }

  async bulkCreate(objects: BulkCreateObject[], options: { overwrite?: boolean; workspaces?: string[] } = {}): Promise<BulkResult[]> {
    if (objects.length === 0) return [];
    const time = new Date().toISOString();
    type Prepared =
      | { kind: 'refused'; object: BulkCreateObject; error: HttpError }
      | { kind: 'write'; object: BulkCreateObject; method: 'index' | 'create'; id: string; source: RawSource };
    const prepared = objects.map((object): Prepared => {
      if (!isAllowedType(object.type)) return { kind: 'refused', object, error: unsupportedTypeError(object.type) };
      // No type of this product spans namespaces
      if (object.initialNamespaces) {
        return {
          kind: 'refused',
          object,
          error: badRequestError('"initialNamespaces" can only be used on multi-namespace types'),
        };
      }
      const method = object.id && options.overwrite ? 'index' : 'create';
      const id = object.id ?? randomUUID();
      // The request's workspaces go to an object made new, the object's own to one that overwrites
      const workspaces = method === 'create' ? options.workspaces : object.workspaces;
      // As the original's bulk create hands it to its migrator
      const source = this.toSource({
        id,
        type: object.type,
        attributes: object.attributes,
        migrationVersion: object.migrationVersion,
        updated_at: time,
        references: object.references || [],
        originId: object.originId,
        ...(workspaces ? { workspaces } : {}),
        ...(object.permissions ? { permissions: object.permissions } : {}),
      });
      return { kind: 'write', object, method, id, source };
    });
    const lines: string[] = [];
    for (const entry of prepared) {
      if (entry.kind !== 'write') continue;
      const version = options.overwrite && entry.object.version ? decodeVersion(entry.object.version) : {};
      const action: Record<string, unknown> = {};
      action[entry.method] = { _id: `${entry.object.type}:${entry.id}`, _index: this.index, ...version };
      lines.push(JSON.stringify(action), JSON.stringify(entry.source));
    }
    const result = lines.length
      ? await this.call<{
          items: Array<Record<string, RawDocument & { status: number; error?: { type: string; reason?: string } }>>;
        }>({
          method: 'POST',
          path: '/_bulk',
          query: { refresh: 'wait_for' },
          body: `${lines.join('\n')}\n`,
          headers: { 'content-type': 'application/x-ndjson' },
        })
      : { items: [] };
    let at = 0;
    return prepared.map((entry): BulkResult => {
      if (entry.kind !== 'write') {
        // An object sent without an id comes back without one
        return { id: entry.object.id as string, type: entry.object.type, error: decoratedContent(entry.error) };
      }
      const outcome = Object.values(result.items[at] ?? {})[0];
      at += 1;
      const { type } = entry.object;
      if (outcome?.error) {
        const error =
          outcome.error.type === 'version_conflict_engine_exception'
            ? errorContent(conflictError(type, entry.id))
            : outcome.error.type === 'document_missing_exception'
              ? errorContent(notFoundError(type, entry.id))
              : { message: outcome.error.reason || JSON.stringify(outcome.error) };
        return { id: entry.id, type, error };
      }
      return this.rawToSavedObject({
        _id: `${type}:${entry.id}`,
        _source: entry.source,
        _seq_no: outcome?._seq_no,
        _primary_term: outcome?._primary_term,
      });
    });
  }

  /**
   * Each object changed, in order, in one request to OpenSearch, as the original's `bulkUpdate`:
   * one that cannot be changed comes back with an `error`, and a version that cannot be read
   * refuses them all.
   */
  async bulkUpdate(
    objects: BulkUpdateObject[]
  ): Promise<Array<BulkUpdateResult | { id: string; type: string; error: ObjectError }>> {
    const time = new Date().toISOString();
    const refusal = ({ type, id, namespace }: BulkUpdateObject): ObjectError | undefined => {
      if (!isAllowedType(type)) return errorContent(notFoundError(type, id));
      if (namespace === '*') return decoratedContent(badRequestError('"namespace" cannot be "*"'));
      return undefined;
    };
    const lines: string[] = [];
    for (const object of objects) {
      if (refusal(object)) continue;
      const { type, id, attributes, references, version, namespace } = object;
      // Only the default namespace has objects, whose ids carry none: another one finds nothing
      const prefix = namespace && namespace !== 'default' && !isNamespaceAgnostic(type) ? `${namespace}:` : '';
      const action = { update: { _id: `${prefix}${type}:${id}`, _index: this.index, ...(version ? decodeVersion(version) : {}) } };
      const doc = { [type]: attributes, updated_at: time, ...(Array.isArray(references) ? { references } : {}) };
      lines.push(JSON.stringify(action), JSON.stringify({ doc }));
    }
    const result = lines.length
      ? await this.call<{
          items: Array<Record<string, RawDocument & { error?: { type: string; reason?: string }; get?: { _source?: RawSource } }>>;
        }>({
          method: 'POST',
          path: '/_bulk',
          query: { refresh: 'wait_for', _source_includes: 'originId' },
          body: `${lines.join('\n')}\n`,
          headers: { 'content-type': 'application/x-ndjson' },
        })
      : { items: [] };
    let at = 0;
    return objects.map((object) => {
      const { type, id } = object;
      const refused = refusal(object);
      if (refused) return { id, type, error: refused };
      const outcome = Object.values(result.items[at] ?? {})[0];
      at += 1;
      if (outcome?.error) {
        const error =
          outcome.error.type === 'version_conflict_engine_exception'
            ? errorContent(conflictError(type, id))
            : outcome.error.type === 'document_missing_exception'
              ? errorContent(notFoundError(type, id))
              : { message: outcome.error.reason || JSON.stringify(outcome.error) };
        return { id, type, error };
      }
      const originId = outcome?.get?._source?.originId;
      return {
        id,
        type,
        ...(isNamespaceAgnostic(type) ? {} : { namespaces: [object.namespace ?? 'default'] }),
        ...(originId ? { originId } : {}),
        updated_at: time,
        version: encodeVersion(outcome?._seq_no, outcome?._primary_term),
        attributes: object.attributes,
        references: object.references,
      };
    });
  }

  private docPath(type: string, id: string) {
    return `/${encodeURIComponent(this.index)}/_doc/${encodeURIComponent(`${type}:${id}`)}`;
  }

  /** The document an object is written as, migrated as the original's migrator does, its keys in the original serializer's order */
  private toSource(document: MigrationDocument): RawSource {
    const migrated = migrateDocument(document, this.log);
    return {
      [migrated.type]: migrated.attributes,
      type: migrated.type,
      references: migrated.references ?? [],
      ...(migrated.originId ? { originId: migrated.originId } : {}),
      ...(migrated.migrationVersion ? { migrationVersion: migrated.migrationVersion } : {}),
      ...(migrated.updated_at ? { updated_at: migrated.updated_at } : {}),
      ...(migrated.workspaces ? { workspaces: migrated.workspaces } : {}),
      ...(migrated.permissions ? { permissions: migrated.permissions } : {}),
    } as RawSource;
  }

  /** The object a document holds, as the original's serializer reads it (finds and writes) */
  private rawToSavedObject(document: RawDocument): SavedObject & { namespaces?: string[] } {
    const source = document._source ?? {};
    const type = String(source.type ?? document._id.slice(0, document._id.indexOf(':')));
    const id = document._id.startsWith(`${type}:`) ? document._id.slice(type.length + 1) : document._id;
    const version = encodeVersion(document._seq_no, document._primary_term);
    const object = {
      type,
      id,
      ...(source.originId ? { originId: source.originId } : {}),
      ...(source.permissions ? { permissions: source.permissions } : {}),
      attributes: source[type] as Record<string, unknown>,
      references: source.references ?? [],
      ...(source.migrationVersion ? { migrationVersion: source.migrationVersion } : {}),
      ...(source.updated_at ? { updated_at: source.updated_at } : {}),
      ...(version ? { version } : {}),
      ...(source.workspaces ? { workspaces: source.workspaces } : {}),
    } as SavedObject & { namespaces?: string[] };
    if (!isNamespaceAgnostic(type)) object.namespaces = [source.namespace ?? 'default'];
    return object;
  }

  /** The object a document holds, as the original's get and bulk get give it */
  private fromSource(type: string, id: string, document: RawDocument): SavedObject & { namespaces?: string[] } {
    const source = document._source ?? {};
    return {
      id,
      type,
      namespaces: namespacesOf(type, source),
      ...(source.originId ? { originId: source.originId } : {}),
      ...(source.updated_at ? { updated_at: source.updated_at } : {}),
      ...(source.workspaces ? { workspaces: source.workspaces } : {}),
      version: encodeVersion(document._seq_no, document._primary_term),
      attributes: source[type] as Record<string, unknown>,
      references: source.references ?? [],
      migrationVersion: source.migrationVersion,
      ...(source.permissions ? { permissions: source.permissions } : {}),
    };
  }

  /** A request whose failure is answered as the saved objects service answers it */
  private async call<T>(request: Parameters<OpenSearchClient['request']>[0]): Promise<T> {
    try {
      return await this.client.request<T>(request);
    } catch (error) {
      if (error instanceof OpenSearchError) throw decorateOpenSearchError(error);
      throw error;
    }
  }

  private parse(body: Buffer): unknown {
    try {
      return JSON.parse(body.toString('utf8'));
    } catch {
      return body.toString('utf8');
    }
  }

  private json<T>(status: number, body: Buffer): T {
    const parsed = this.parse(body);
    if (status >= 400) throw decorateOpenSearchError(new OpenSearchError(status, parsed, `OpenSearch answered ${status}`));
    return parsed as T;
  }
}

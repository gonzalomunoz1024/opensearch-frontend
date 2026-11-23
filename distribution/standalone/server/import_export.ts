/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Saved objects as a file: one JSON object per line, as OpenSearch Dashboards 3.9.0 exports and
 * imports them (`saved_objects/export` and `saved_objects/import` of its core), step for step, so
 * that a file from either product loads into the other with the same outcome: the same objects
 * written, the same conflicts and missing references found, the same answer.
 */

import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import type { SavedObject, SavedObjectReference } from '../common/saved_objects';
import { HttpError, badRequest } from './http';
import { badRequestError } from './saved_objects_search';
import { IMPORTABLE_TYPES, isImportableType, typeInfo } from './saved_objects_types';
import {
  isObjectError,
  type BulkCreateObject,
  type ObjectError,
  type SavedObjectsRepository,
} from './saved_objects';

// --- Export ------------------------------------------------------------------------------------

/** JSON with the keys of every object in order, as `json-stable-stringify` writes it */
export function stableStringify(value: unknown): string | undefined {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') return undefined;
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  const withJson = value as { toJSON?: () => unknown };
  if (typeof withJson.toJSON === 'function') return stableStringify(withJson.toJSON());
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item) ?? 'null').join(',')}]`;
  const entries = Object.keys(value)
    .sort()
    .flatMap((key) => {
      const text = stableStringify((value as Record<string, unknown>)[key]);
      return text === undefined ? [] : [`${JSON.stringify(key)}:${text}`];
    });
  return `{${entries.join(',')}}`;
}

export interface ExportRequest {
  types?: string[];
  objects?: Array<{ type: string; id: string }>;
  search?: string;
  includeReferencesDeep?: boolean;
  excludeExportDetails?: boolean;
  workspaces?: string[];
}

type ExportedObject = SavedObject & { namespaces?: string[]; score?: number | null };

const key = (object: { type: string; id: string }) => `${object.type}:${object.id}`;

/** What can be exported or imported, refused as the export route refuses it */
export function exportValidationError(request: ExportRequest): string | undefined {
  if (request.types) {
    const invalid = request.types.filter((type) => !IMPORTABLE_TYPES.includes(type));
    if (invalid.length) return `Trying to export non-exportable type(s): ${invalid.join(', ')}`;
  }
  if (request.objects) {
    const invalid = request.objects.filter((object) => !IMPORTABLE_TYPES.includes(object.type));
    if (invalid.length) {
      return `Trying to export object(s) with non-exportable types: ${invalid.map(key).join(', ')}`;
    }
  }
  return undefined;
}

async function fetchObjectsToExport(
  repository: SavedObjectsRepository,
  request: ExportRequest,
  limit: number
): Promise<ExportedObject[]> {
  const { types, objects, search } = request;
  if ((types?.length ?? 0) > 0 && (objects?.length ?? 0) > 0) {
    throw badRequest(`Can't specify both "types" and "objects" properties when exporting`);
  }
  if (objects && objects.length > 0) {
    if (objects.length > limit) throw badRequest(`Can't export more than ${limit} objects`);
    if (typeof search === 'string') {
      throw badRequest(`Can't specify both "search" and "objects" properties when exporting`);
    }
    const results = await repository.bulkGet(objects);
    const errored = results.filter(isObjectError);
    if (errored.length) throw new HttpError(400, 'Bad Request', { objects: errored });
    return results as ExportedObject[];
  }
  if (types && types.length > 0) {
    const found = await repository.find({
      type: types,
      search,
      perPage: limit,
      ...(request.workspaces ? { workspaces: request.workspaces } : {}),
    });
    if (found.total > limit) throw badRequest(`Can't export more than ${limit} objects`);
    // The original's order, comparator and all: by id
    return found.saved_objects
      .map(({ score: _score, ...object }) => object as ExportedObject)
      .sort((a, b) => (a.id > b.id ? 1 : -1));
  }
  throw badRequest('Either `type` or `objects` are required.');
}

async function fetchNestedDependencies(repository: SavedObjectsRepository, objects: ExportedObject[]) {
  const byKey = new Map<string, ExportedObject | { type: string; id: string; error: ObjectError }>();
  for (const object of objects) byKey.set(key(object), object);
  const toFetch = () => {
    const wanted = new Map<string, { type: string; id: string }>();
    for (const object of byKey.values()) {
      for (const reference of ('references' in object ? object.references : undefined) ?? []) {
        if (!byKey.has(key(reference))) wanted.set(key(reference), { type: reference.type, id: reference.id });
      }
    }
    return [...wanted.values()];
  };
  let fetching = toFetch();
  while (fetching.length > 0) {
    for (const result of await repository.bulkGet(fetching)) byKey.set(key(result), result as ExportedObject);
    fetching = toFetch();
  }
  const all = [...byKey.values()];
  return {
    objects: all.filter((object): object is ExportedObject => !('error' in object && object.error)),
    missingRefs: all
      .filter((object) => 'error' in object && object.error)
      .map((object) => ({ type: object.type, id: object.id })),
  };
}

/** Objects that others point at come first; a cycle cannot be written in that order */
export function sortObjects<T extends { type: string; id: string; references: SavedObjectReference[] }>(objects: T[]): T[] {
  const path = new Set<T>();
  const sorted = new Set<T>();
  const byKey = new Map(objects.map((object) => [key(object), object]));
  const include = (list: T[]) => {
    for (const object of list) {
      if (path.has(object)) {
        throw badRequest(
          `circular reference: ${[...path, object].map((entry) => `[${entry.type}:${entry.id}]`).join(' ref-> ')}`
        );
      }
      const referenced = object.references
        .map((reference) => byKey.get(key(reference)))
        .filter((found): found is T => Boolean(found));
      if (referenced.length) {
        path.add(object);
        include(referenced);
        path.delete(object);
      }
      sorted.add(object);
    }
  };
  include(objects);
  return [...sorted];
}

/** The file an export gives: its objects, one per line, then what it holds, with no line after */
export async function exportObjects(
  repository: SavedObjectsRepository,
  request: ExportRequest,
  limit: number
): Promise<string> {
  const roots = await fetchObjectsToExport(repository, request, limit);
  let exported: ExportedObject[];
  let missingReferences: Array<{ type: string; id: string }> = [];
  if (request.includeReferencesDeep) {
    const fetched = await fetchNestedDependencies(repository, roots);
    exported = sortObjects(fetched.objects);
    missingReferences = fetched.missingRefs;
  } else {
    exported = sortObjects(roots);
  }
  const lines = exported.map(({ namespaces: _namespaces, ...object }) => stableStringify(object) ?? '');
  if (!request.excludeExportDetails) {
    lines.push(
      stableStringify({
        exportedCount: exported.length,
        missingRefCount: missingReferences.length,
        missingReferences,
      }) ?? ''
    );
  }
  return lines.join('\n');
}

// --- Import ------------------------------------------------------------------------------------

interface ImportObject {
  type: string;
  id: string;
  attributes: { title?: string } & Record<string, unknown>;
  references: SavedObjectReference[];
  migrationVersion?: Record<string, string>;
  originId?: string;
  version?: string;
  [field: string]: unknown;
}

export type ImportErrorKind =
  | { type: 'conflict'; destinationId?: string }
  | { type: 'unsupported_type' }
  | { type: 'missing_references'; references: Array<{ type: string; id: string }> }
  | ({ type: 'unknown' } & ObjectError);

export interface ImportError {
  id: string;
  type: string;
  title?: string;
  meta: { title?: string; icon?: string };
  error: ImportErrorKind;
  overwrite?: boolean;
}

export interface ImportSuccess {
  type: string;
  id: string;
  meta: { title?: string; icon?: string };
  overwrite?: boolean;
  destinationId?: string;
  createNewCopy?: boolean;
}

export interface ImportResponse {
  successCount: number;
  success: boolean;
  successResults?: ImportSuccess[];
  errors?: ImportError[];
}

export interface ImportRetry {
  type: string;
  id: string;
  overwrite: boolean;
  destinationId?: string;
  replaceReferences: Array<{ type: string; from: string; to: string }>;
  createNewCopy?: boolean;
  ignoreMissingReferences?: boolean;
}

type IdMap = Map<string, { id?: string; omitOriginId?: boolean }>;

const RESOLVABLE_ERRORS = ['conflict', 'ambiguous_conflict', 'missing_references', 'missing_data_source'];
const REFERENCE_TYPES_TO_VALIDATE = ['index-pattern', 'search'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An id made of a data source's id and an object's: what a data source import writes */
const isObjectWithDataSource = (id: string) => {
  const parts = String(id).split('_');
  return parts.length === 2 && parts.every((part) => UUID.test(part));
};

const titleOf = (object: { attributes?: unknown }) =>
  (object.attributes as { title?: string } | undefined)?.title;

/** The prototype of an object cannot be set by a file, as in the original */
function validateObject(value: unknown) {
  if (typeof value !== 'object' || value === null) return;
  const stack: Array<{ value: unknown; previousKey: string | null }> = [{ value, previousKey: null }];
  const seen = new WeakSet<object>([value]);
  while (stack.length > 0) {
    const item = stack.pop();
    if (!item || typeof item.value !== 'object' || item.value === null) continue;
    if (Object.prototype.hasOwnProperty.call(item.value, '__proto__')) throw new Error(`'__proto__' is an invalid key`);
    if (Object.prototype.hasOwnProperty.call(item.value, 'prototype') && item.previousKey === 'constructor') {
      throw new Error(`'constructor.prototype' is an invalid key`);
    }
    const entries = Object.entries(item.value);
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const [name, child] = entries[index];
      if (typeof child === 'object' && child !== null) {
        if (seen.has(child)) throw new Error('circular reference detected');
        seen.add(child);
      }
      stack.push({ value: child, previousKey: name });
    }
  }
}

/**
 * The objects of an import file: each line that is not blank, read as JSON; the last line of an
 * export, which counts what it holds, is left out.
 */
export function parseNdjson(text: string): unknown[] {
  const objects: unknown[] = [];
  for (const line of text.split('\n')) {
    if (!line || line.trim() === '') continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      throw badRequest((error as Error).message);
    }
    try {
      validateObject(parsed);
    } catch (error) {
      throw badRequest(`Invalid object in import stream: ${(error as Error).message}`);
    }
    if (!parsed) continue;
    const details = (parsed as { exportedCount?: unknown }).exportedCount;
    // An export of nothing ends with a count of 0, which the original takes for an object
    if (details || details === 0) continue;
    objects.push(parsed);
  }
  return objects;
}

function collectSavedObjects(lines: unknown[], limit: number, filter?: (object: ImportObject) => boolean) {
  const errors: ImportError[] = [];
  const entries: Array<{ type: string; id: string }> = [];
  const importIdMap: IdMap = new Map();
  const collected: ImportObject[] = [];
  lines.forEach((line, index) => {
    if (index >= limit) throw badRequest(`Can't import more than ${limit} objects`);
    const object = line as ImportObject;
    entries.push({ type: object.type, id: object.id });
    if (!isImportableType(object.type)) {
      const title = titleOf(object);
      errors.push({ id: object.id, type: object.type, title, meta: { title }, error: { type: 'unsupported_type' } });
      return;
    }
    if (filter && !filter(object)) return;
    importIdMap.set(key(object), {});
    collected.push({ migrationVersion: {}, ...object });
  });
  const counts = new Map<string, number>();
  for (const entry of entries) counts.set(key(entry), (counts.get(key(entry)) ?? 0) + 1);
  const nonUnique = [...counts].filter(([, count]) => count >= 2).map(([entry]) => entry);
  if (nonUnique.length > 0) throw badRequestError(`Non-unique import objects detected: [${nonUnique.join()}]`);
  return { errors, collected, importIdMap };
}

// An object without attributes is read by the original where it takes the title: it fails there
const assertAttributes = (objects: ImportObject[]) => {
  if (objects.some((object) => object.attributes === null || typeof object.attributes !== 'object')) {
    throw new Error('An object of the file has no attributes');
  }
};

async function validateReferences(
  repository: SavedObjectsRepository,
  objects: ImportObject[],
  retries: ImportRetry[] = []
): Promise<ImportError[]> {
  const skip = new Set(retries.filter((retry) => retry.ignoreMissingReferences).map(key));
  const collector = new Map<string, { type: string; id: string }>();
  for (const object of objects) {
    if (skip.has(key(object))) continue;
    for (const { type, id } of object.references ?? []) {
      if (REFERENCE_TYPES_TO_VALIDATE.includes(type)) collector.set(`${type}:${id}`, { type, id });
    }
  }
  for (const object of objects) collector.delete(key(object));
  if (collector.size > 0) {
    const results = await repository.bulkGet([...collector.values()].map((object) => ({ ...object, fields: ['id'] })));
    const errored = results.filter(
      (result) => isObjectError(result) && ![403, 404].includes(result.error.statusCode ?? 0)
    );
    if (errored.length) throw new HttpError(400, 'Bad Request', { objects: errored });
    for (const result of results) if (!isObjectError(result)) collector.delete(key(result));
  }
  const missing = [...collector.keys()];
  const errors = new Map<string, ImportError>();
  for (const object of objects) {
    if (skip.has(key(object))) continue;
    const references = (object.references ?? [])
      .filter(({ type, id }) => REFERENCE_TYPES_TO_VALIDATE.includes(type) && missing.includes(`${type}:${id}`))
      .map(({ type, id }) => ({ type, id }));
    if (references.length === 0) continue;
    const title = titleOf(object);
    errors.set(key(object), {
      id: object.id,
      type: object.type,
      title,
      meta: { title },
      error: { type: 'missing_references', references },
    });
  }
  return [...errors.values()];
}

async function checkConflicts(
  repository: SavedObjectsRepository,
  objects: ImportObject[],
  options: { ignoreRegularConflicts?: boolean; retries?: ImportRetry[] }
) {
  const filtered: ImportObject[] = [];
  const errors: ImportError[] = [];
  const pendingOverwrites = new Set<string>();
  if (objects.length === 0) return { filtered, errors, pendingOverwrites };
  const retryMap = new Map((options.retries ?? []).map((retry) => [key(retry), retry]));
  const found = await repository.checkConflicts(
    objects.map((object) => ({ type: object.type, id: retryMap.get(key(object))?.destinationId ?? object.id }))
  );
  const errorMap = new Map(found.map(({ type, id, error }) => [`${type}:${id}`, error]));
  for (const object of objects) {
    const { type, id } = object;
    const title = object.attributes.title;
    const { destinationId, overwrite } = retryMap.get(key(object)) ?? {};
    const error = errorMap.get(`${type}:${destinationId ?? id}`);
    if (error && error.statusCode !== 409) {
      errors.push({ type, id, title, meta: { title }, error: { ...error, type: 'unknown' } } as ImportError);
    } else if (error?.statusCode === 409 && !options.ignoreRegularConflicts && !overwrite) {
      errors.push({ type, id, title, meta: { title }, error: { type: 'conflict', ...(destinationId ? { destinationId } : {}) } } as ImportError);
    } else {
      filtered.push(object);
      if (error?.statusCode === 409) pendingOverwrites.add(key(object));
    }
  }
  return { filtered, errors, pendingOverwrites };
}

const regenerateIds = (objects: ImportObject[]): IdMap =>
  new Map(objects.map((object) => [key(object), { id: randomUUID(), omitOriginId: true }]));

interface CreatedObject {
  type: string;
  id: string;
  attributes?: { title?: string };
  originId?: string;
  destinationId?: string;
  error?: ObjectError;
}

async function createSavedObjects(
  repository: SavedObjectsRepository,
  options: {
    objects: ImportObject[];
    accumulatedErrors: ImportError[];
    importIdMap: IdMap;
    overwrite?: boolean;
    workspaces?: string[];
  }
): Promise<{ createdObjects: CreatedObject[]; errors: ImportError[] }> {
  const { objects, accumulatedErrors, importIdMap, overwrite, workspaces } = options;
  const errorSet = new Set(accumulatedErrors.map(key));
  const filtered = objects.filter((object) => !errorSet.has(key(object)));
  if (filtered.length === 0) return { createdObjects: [], errors: [] };

  const originals = new Map(filtered.map((object) => [key(object), object]));
  const toCreate = filtered.map(({ version: _version, ...object }): ImportObject => {
    const references = object.references?.map((reference) => {
      const entry = importIdMap.get(key(reference));
      return entry?.id ? { ...reference, id: entry.id } : reference;
    });
    const entry = importIdMap.get(key(object));
    if (entry?.id) {
      originals.set(`${object.type}:${entry.id}`, object as ImportObject);
      const originId = entry.omitOriginId ? undefined : (object.originId ?? object.id);
      return { ...object, id: entry.id, originId, ...(references ? { references } : {}) };
    }
    return { ...object, ...(references ? { references } : {}) };
  });

  // While an error can still be resolved, nothing is written: what would be is answered
  let results: CreatedObject[] = toCreate;
  if (!accumulatedErrors.some(({ error }) => RESOLVABLE_ERRORS.includes(error.type))) {
    results = (await repository.bulkCreate(
      toCreate.map(
        (object): BulkCreateObject => ({
          type: object.type,
          id: object.id,
          attributes: object.attributes,
          references: object.references,
          migrationVersion: object.migrationVersion,
          originId: object.originId,
          // The original hands the whole line on, and its bulk create reads these from it too
          ...(object.initialNamespaces !== undefined ? { initialNamespaces: object.initialNamespaces } : {}),
          ...(object.workspaces !== undefined ? { workspaces: object.workspaces } : {}),
          ...(object.permissions !== undefined ? { permissions: object.permissions } : {}),
        })
      ),
      { overwrite, ...(workspaces ? { workspaces } : {}) }
    )) as CreatedObject[];
  }

  const remapped = results.map((result) => {
    const id = originals.get(key(result))?.id ?? result.id;
    return { ...result, id, ...(id !== result.id ? { destinationId: result.id } : {}) };
  });

  const byKey = new Map(objects.map((object) => [key(object), object]));
  const errors: ImportError[] = [];
  for (const result of remapped) {
    if (!result.error) continue;
    const title = byKey.get(key(result))?.attributes?.title;
    const { destinationId } = result;
    errors.push(
      result.error.statusCode === 409
        ? { id: result.id, type: result.type, title, meta: { title }, error: { type: 'conflict', ...(destinationId ? { destinationId } : {}) } }
        : { id: result.id, type: result.type, title, meta: { title }, error: { ...result.error, type: 'unknown' } }
    );
  }
  return { createdObjects: remapped.filter((result) => !result.error), errors };
}

const icon = (type: string) => typeInfo(type)?.management?.icon;

function answer(successCount: number, errors: ImportError[], successResults: ImportSuccess[], overwritten: (error: ImportError) => boolean): ImportResponse {
  const errorResults = errors.map((error) => ({
    ...error,
    meta: { ...error.meta, icon: icon(error.type) },
    ...(overwritten(error) ? { overwrite: true } : {}),
  }));
  return {
    successCount,
    success: errors.length === 0,
    ...(successResults.length ? { successResults } : {}),
    ...(errorResults.length ? { errors: errorResults } : {}),
  };
}

const success = (object: CreatedObject, extra: { overwrite?: boolean; createNewCopies?: boolean }): ImportSuccess => ({
  type: object.type,
  id: object.id,
  meta: { title: object.attributes?.title, icon: icon(object.type) },
  ...(extra.overwrite ? { overwrite: true } : {}),
  ...(object.destinationId ? { destinationId: object.destinationId } : {}),
  ...(object.destinationId && !object.originId && !extra.createNewCopies ? { createNewCopy: true } : {}),
});

export interface ImportOptions {
  overwrite: boolean;
  createNewCopies: boolean;
  limit: number;
  /** Whether the person may change advanced settings, which a `config` object is */
  canImportConfig: boolean;
  /** Given to each object the import makes new, as in the original (`?workspaces=`) */
  workspaces?: string[];
}

/** `POST /api/saved_objects/_import`: the objects of a file, written unless something is wrong */
export async function importObjects(
  repository: SavedObjectsRepository,
  lines: unknown[],
  options: ImportOptions
): Promise<ImportResponse> {
  let errors: ImportError[] = [];
  const collect = collectSavedObjects(lines, options.limit);
  let collected = collect.collected;

  if (!options.canImportConfig) {
    errors = collected
      .filter((object) => object.type === 'config')
      .map((object) => ({ error: { type: 'unsupported_type' }, type: object.type, id: object.id, title: object.id, meta: { title: object.id } }));
    collected = collected.filter((object) => object.type !== 'config');
  }

  // Objects of a data source cannot be imported where there are none: nothing is written then
  const withDataSource = collected
    .filter((object) => object.type === 'data-source' || isObjectWithDataSource(object.id))
    .map((object): ImportError => {
      const title = titleOf(object);
      return { error: { type: 'unsupported_type' }, type: object.type, id: object.id, title, meta: { title } };
    });
  if (withDataSource.length > 0) return { successCount: 0, success: false, errors: withDataSource };

  errors = [...errors, ...collect.errors];
  let importIdMap = collect.importIdMap;
  let pendingOverwrites = new Set<string>();

  assertAttributes(collected);
  errors = [...errors, ...(await validateReferences(repository, collected))];

  if (options.createNewCopies) {
    importIdMap = regenerateIds(collected);
  } else {
    const conflicts = await checkConflicts(repository, collected, { ignoreRegularConflicts: options.overwrite });
    errors = [...errors, ...conflicts.errors];
    pendingOverwrites = conflicts.pendingOverwrites;
  }

  const created = await createSavedObjects(repository, {
    objects: collected,
    accumulatedErrors: errors,
    importIdMap,
    overwrite: options.overwrite,
    ...(options.workspaces ? { workspaces: options.workspaces } : {}),
  });
  errors = [...errors, ...created.errors];

  const successResults = created.createdObjects.map((object) =>
    success(object, { overwrite: pendingOverwrites.has(key(object)), createNewCopies: options.createNewCopies })
  );
  return answer(created.createdObjects.length, errors, successResults, (error) => pendingOverwrites.has(key(error)));
}

function validateRetries(retries: ImportRetry[]) {
  const nonUnique = (entries: Array<{ type: string; id: string }>) => {
    const counts = new Map<string, number>();
    for (const entry of entries) counts.set(key(entry), (counts.get(key(entry)) ?? 0) + 1);
    return [...counts].filter(([, count]) => count >= 2).map(([entry]) => entry);
  };
  const objects = nonUnique(retries);
  if (objects.length > 0) throw badRequestError(`Non-unique retry objects: [${objects.join()}]`);
  const destinations = nonUnique(
    retries
      .filter((retry) => retry.destinationId !== undefined)
      .map((retry) => ({ type: retry.type, id: retry.destinationId ?? '' }))
  );
  if (destinations.length > 0) throw badRequestError(`Non-unique retry destinations: [${destinations.join()}]`);
}

/** `POST /api/saved_objects/_resolve_import_errors`: the import again, with what was decided */
export async function resolveImportErrors(
  repository: SavedObjectsRepository,
  lines: unknown[],
  retries: ImportRetry[],
  options: { createNewCopies: boolean; limit: number; canImportConfig: boolean; workspaces?: string[] }
): Promise<ImportResponse> {
  validateRetries(retries);
  const retryKeys = new Set(retries.map(key));
  const collect = collectSavedObjects(lines, options.limit, (object) => retryKeys.has(key(object)));
  let errors = collect.errors;
  let objects = collect.collected;

  if (!options.canImportConfig) {
    errors = [
      ...errors,
      ...objects
        .filter((object) => object.type === 'config')
        .map((object): ImportError => ({ error: { type: 'unsupported_type' }, type: object.type, id: object.id, title: object.id, meta: { title: object.id } })),
    ];
    objects = objects.filter((object) => object.type !== 'config');
  }

  const replacements = new Map(
    retries.map((retry) => [key(retry), new Map(retry.replaceReferences.map(({ type, from, to }) => [`${type}:${from}`, to]))])
  );
  for (const object of objects) {
    const map = replacements.get(key(object));
    if (!map) continue;
    for (const reference of object.references ?? []) {
      const to = map.get(key(reference));
      if (to) reference.id = to;
    }
  }

  assertAttributes(objects);
  errors = [...errors, ...(await validateReferences(repository, objects, retries))];

  let importIdMap: IdMap = new Map();
  if (options.createNewCopies) importIdMap = regenerateIds(objects);

  const conflicts = await checkConflicts(repository, objects, { retries });
  errors = [...errors, ...conflicts.errors];

  const retryMap = new Map(retries.map((retry) => [key(retry), retry]));
  const forRetries: IdMap = new Map();
  for (const object of conflicts.filtered) {
    const retry = retryMap.get(key(object));
    if (!retry) throw new Error(`Retry was expected for "${key(object)}" but not found`);
    const omitOriginId = options.createNewCopies || Boolean(retry.createNewCopy);
    if (retry.destinationId && retry.destinationId !== object.id) {
      forRetries.set(key(object), { id: retry.destinationId, omitOriginId });
    }
  }
  importIdMap = new Map([...importIdMap, ...forRetries]);

  let successCount = 0;
  let successResults: ImportSuccess[] = [];
  const accumulatedErrors = [...errors];
  const create = async (list: ImportObject[], overwrite?: boolean) => {
    const created = await createSavedObjects(repository, {
      objects: list,
      accumulatedErrors,
      importIdMap,
      overwrite,
      ...(options.workspaces ? { workspaces: options.workspaces } : {}),
    });
    errors = [...errors, ...created.errors];
    successCount += created.createdObjects.length;
    successResults = [
      ...successResults,
      ...created.createdObjects.map((object) => success(object, { overwrite, createNewCopies: options.createNewCopies })),
    ];
  };
  const overwrites = new Set(retries.filter((retry) => retry.overwrite).map(key));
  await create(objects.filter((object) => overwrites.has(key(object))), true);
  await create(objects.filter((object) => !overwrites.has(key(object))));

  return answer(successCount, errors, successResults, (error) =>
    retries.some((retry) => retry.type === error.type && retry.id === error.id && retry.overwrite)
  );
}

// --- The form an import comes in ---------------------------------------------------------------

/** A file of a form, which a route's schema takes for the stream OpenSearch Dashboards reads */
export class UploadedFile {
  constructor(
    readonly filename: string,
    readonly content: Buffer
  ) {}
}

/**
 * The parts of a `multipart/form-data` body, as hapi gives them to a route: a file as a file, a
 * field as text, and a name given more than once as a list.
 */
export function parseMultipart(body: Buffer, contentType: string): Record<string, unknown> {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!boundary) throw badRequest('Invalid multipart payload format');
  const delimiter = Buffer.from(`--${boundary[1] ?? boundary[2]}`);
  const parts = Object.create(null) as Record<string, unknown>;
  let from = body.indexOf(delimiter);
  while (from !== -1) {
    const headerEnd = body.indexOf('\r\n\r\n', from);
    const next = body.indexOf(delimiter, from + delimiter.length);
    if (headerEnd === -1 || next === -1) break;
    const headers = body.subarray(from + delimiter.length, headerEnd).toString('utf8');
    const name = /\bname="([^"]*)"/i.exec(headers)?.[1];
    const filename = /\bfilename="([^"]*)"/i.exec(headers)?.[1];
    // The part ends with the line break before the next boundary
    const content = body.subarray(headerEnd + 4, Math.max(headerEnd + 4, next - 2));
    if (name !== undefined) {
      const value = filename !== undefined ? new UploadedFile(filename, Buffer.from(content)) : content.toString('utf8');
      const entry = parts[name];
      parts[name] = entry === undefined ? value : ([] as unknown[]).concat(entry, value);
    }
    from = next;
  }
  return parts;
}

/** The extension of a file's name, in lower case, as the import routes check it */
export const fileExtension = (filename: string) => extname(filename).toLowerCase();

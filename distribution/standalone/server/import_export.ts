/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Saved objects as a file: one JSON object per line, in the format OpenSearch Dashboards
 * exports, so that a file from either product can be loaded into the other.
 */

import { randomUUID } from 'node:crypto';
import { extractReferences, titleOf, type SavedObject } from '../common/saved_objects';
import { badRequest } from './http';
import { SAVED_OBJECT_TYPES, type SavedObjectsRepository } from './saved_objects';

// What "export everything" exports: the objects people make, not the product's own records
export const EXPORTABLE_TYPES = [
  'config',
  'dashboard',
  'index-pattern',
  'query',
  'search',
  'url',
  'visualization',
  'visualization-visbuilder',
].filter((type) => SAVED_OBJECT_TYPES.includes(type));

export interface ExportRequest {
  type?: string[];
  objects?: Array<{ type: string; id: string }>;
  includeReferencesDeep?: boolean;
  search?: string;
}

type Missing = { type: string; id: string };

async function fetchByType(
  repository: SavedObjectsRepository,
  types: string[],
  search: string | undefined,
  limit: number
): Promise<SavedObject[]> {
  const found: SavedObject[] = [];
  const perPage = 1000;
  for (let page = 1; ; page += 1) {
    const result = await repository.find({
      type: types,
      search,
      page,
      perPage,
      sortField: 'updated_at',
      sortOrder: 'desc',
    });
    if (result.total > limit) {
      throw badRequest(`Can't export more than ${limit} objects`);
    }
    found.push(...result.saved_objects);
    if (found.length >= result.total || result.saved_objects.length === 0) return found;
  }
}

// Objects that others point at come first, so that a reader finds a reference already loaded
function sortByDependencies(objects: SavedObject[]): SavedObject[] {
  const byKey = new Map(objects.map((object) => [`${object.type}:${object.id}`, object]));
  const sorted: SavedObject[] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (object: SavedObject) => {
    const key = `${object.type}:${object.id}`;
    if (state.has(key)) return;
    state.set(key, 'visiting');
    for (const reference of object.references) {
      const target = byKey.get(`${reference.type}:${reference.id}`);
      if (target) visit(target);
    }
    state.set(key, 'done');
    sorted.push(object);
  };
  objects.forEach(visit);
  return sorted;
}

export async function exportObjects(
  repository: SavedObjectsRepository,
  request: ExportRequest,
  limit: number
): Promise<string> {
  if (request.type && request.objects) {
    throw badRequest("Can't specify both a type and objects to export");
  }
  let objects: SavedObject[];
  const missing: Missing[] = [];
  if (request.objects) {
    if (request.objects.length > limit) throw badRequest(`Can't export more than ${limit} objects`);
    const results = await repository.bulkGet(request.objects);
    const notFound = results.filter((result) => 'error' in result);
    if (notFound.length) {
      throw badRequest(
        `Bad Request: ${notFound.map((object) => `${object.type}:${object.id}`).join(', ')} not found`
      );
    }
    objects = results as SavedObject[];
  } else {
    const types = request.type?.length ? request.type : EXPORTABLE_TYPES;
    objects = await fetchByType(repository, types, request.search, limit);
  }

  if (request.includeReferencesDeep) {
    const known = new Set(objects.map((object) => `${object.type}:${object.id}`));
    let frontier = objects;
    while (frontier.length) {
      const wanted = new Map<string, Missing>();
      for (const object of frontier) {
        for (const { type, id } of object.references) {
          const key = `${type}:${id}`;
          if (!known.has(key) && SAVED_OBJECT_TYPES.includes(type)) wanted.set(key, { type, id });
        }
      }
      if (wanted.size === 0) break;
      const results = await repository.bulkGet([...wanted.values()]);
      frontier = [];
      for (const result of results) {
        known.add(`${result.type}:${result.id}`);
        if ('error' in result) missing.push({ type: result.type, id: result.id });
        else frontier.push(result);
      }
      objects = [...objects, ...frontier];
      if (objects.length > limit) throw badRequest(`Can't export more than ${limit} objects`);
    }
  }

  const lines = sortByDependencies(objects).map((object) => JSON.stringify(object));
  lines.push(
    JSON.stringify({
      exportedCount: objects.length,
      missingRefCount: missing.length,
      missingReferences: missing,
    })
  );
  return `${lines.join('\n')}\n`;
}

export interface ImportError {
  id: string;
  type: string;
  title: string;
  error:
    | { type: 'conflict' }
    | { type: 'unsupported_type' }
    | { type: 'missing_references'; references: Missing[] }
    | { type: 'unknown'; message: string; statusCode: number };
}

export interface ImportResponse {
  success: boolean;
  successCount: number;
  errors?: ImportError[];
  successResults?: Array<{ type: string; id: string; meta: { title: string } }>;
}

export function parseExportFile(text: string): SavedObject[] {
  const objects: SavedObject[] = [];
  text.split(/\r?\n/).forEach((line, at) => {
    if (!line.trim()) return;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line) as Record<string, unknown>;
    } catch {
      throw badRequest(`Line ${at + 1} of the file is not JSON`);
    }
    // The last line of an export counts what it holds; it is not an object
    if ('exportedCount' in parsed) return;
    if (typeof parsed.type !== 'string' || typeof parsed.id !== 'string') {
      throw badRequest(`Line ${at + 1} of the file is not a saved object: it has no type or id`);
    }
    if (parsed.attributes === null || typeof parsed.attributes !== 'object') {
      throw badRequest(`Line ${at + 1} of the file is not a saved object: it has no attributes`);
    }
    objects.push({
      id: parsed.id,
      type: parsed.type,
      attributes: parsed.attributes as Record<string, unknown>,
      references: Array.isArray(parsed.references) ? (parsed.references as SavedObject['references']) : [],
    });
  });
  return objects;
}

export async function importObjects(
  repository: SavedObjectsRepository,
  text: string,
  options: { overwrite?: boolean; createNewCopies?: boolean; limit: number }
): Promise<ImportResponse> {
  let objects = parseExportFile(text).map(extractReferences);
  if (objects.length > options.limit) {
    throw badRequest(`Can't import more than ${options.limit} objects`);
  }
  const errors: ImportError[] = [];
  const fail = (object: SavedObject, error: ImportError['error']) =>
    errors.push({ id: object.id, type: object.type, title: titleOf(object), error });

  objects = objects.filter((object) => {
    if (SAVED_OBJECT_TYPES.includes(object.type)) return true;
    fail(object, { type: 'unsupported_type' });
    return false;
  });

  if (options.createNewCopies) {
    const newIds = new Map(objects.map((object) => [`${object.type}:${object.id}`, randomUUID()]));
    objects = objects.map((object) => ({
      ...object,
      id: newIds.get(`${object.type}:${object.id}`)!,
      references: object.references.map((reference) => ({
        ...reference,
        id: newIds.get(`${reference.type}:${reference.id}`) ?? reference.id,
      })),
    }));
  }

  // A reference must be in the file or already stored. Only the kinds an object cannot work
  // without are checked, as in OpenSearch Dashboards: an index pattern and a saved search.
  const inFile = new Set(objects.map((object) => `${object.type}:${object.id}`));
  const outside = new Map<string, Missing>();
  for (const object of objects) {
    for (const { type, id } of object.references) {
      if ((type === 'index-pattern' || type === 'search') && !inFile.has(`${type}:${id}`)) {
        outside.set(`${type}:${id}`, { type, id });
      }
    }
  }
  const absent = new Set<string>();
  if (outside.size) {
    const results = await repository.bulkGet([...outside.values()]);
    for (const result of results) {
      if ('error' in result) absent.add(`${result.type}:${result.id}`);
    }
  }
  objects = objects.filter((object) => {
    const missing = object.references.filter(({ type, id }) => absent.has(`${type}:${id}`));
    if (missing.length === 0) return true;
    fail(object, {
      type: 'missing_references',
      references: missing.map(({ type, id }) => ({ type, id })),
    });
    return false;
  });

  const results = await repository.bulkCreate(objects, {
    overwrite: options.overwrite || options.createNewCopies,
  });
  const successResults: NonNullable<ImportResponse['successResults']> = [];
  results.forEach((result, at) => {
    if ('error' in result) {
      const { statusCode, message } = result.error as { statusCode: number; message: string };
      fail(
        objects[at],
        statusCode === 409 ? { type: 'conflict' } : { type: 'unknown', message, statusCode }
      );
    } else {
      successResults.push({ type: result.type, id: result.id, meta: { title: titleOf(result) } });
    }
  });

  return {
    success: errors.length === 0,
    successCount: successResults.length,
    ...(errors.length ? { errors } : {}),
    ...(successResults.length ? { successResults } : {}),
  };
}

/**
 * The one file of a `multipart/form-data` body, which is how a browser form (and the import API
 * of OpenSearch Dashboards) sends it.
 */
export function fileFromMultipart(body: Buffer, contentType: string): string {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!boundary) throw badRequest('The form has no boundary');
  const delimiter = Buffer.from(`--${boundary[1] ?? boundary[2]}`);
  let from = body.indexOf(delimiter);
  while (from !== -1) {
    const headerEnd = body.indexOf('\r\n\r\n', from);
    const next = body.indexOf(delimiter, from + delimiter.length);
    if (headerEnd === -1 || next === -1) break;
    const headers = body.subarray(from + delimiter.length, headerEnd).toString('utf8');
    if (/name="file"/i.test(headers) || /filename=/i.test(headers)) {
      // The part ends with the line break that precedes the next boundary
      return body.subarray(headerEnd + 4, next - 2).toString('utf8');
    }
    from = next;
  }
  throw badRequest('The form holds no file');
}

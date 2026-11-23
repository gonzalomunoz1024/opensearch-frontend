/* SPDX-License-Identifier: Apache-2.0 */

/*
 * `/api/saved_objects/...`: the saved objects API of OpenSearch Dashboards 3.9.0, with the same
 * checks of each request (`routes/*.ts` of its saved objects service) and the same answers.
 */

import { HttpError, badRequest, type RequestContext, type Router } from './http';
import {
  UploadedFile,
  exportObjects,
  exportValidationError,
  fileExtension,
  importObjects,
  parseMultipart,
  parseNdjson,
  resolveImportErrors,
  type ImportRetry,
} from './import_export';
import {
  any,
  arrayOf,
  boolean,
  literal,
  maybe,
  number,
  object,
  oneOf,
  queryObject,
  recordOf,
  SchemaTypeError,
  string,
  typeDetect,
  validateRequestPart,
  type Schema,
} from './route_validation';
import type { SavedObjectsRepository } from './saved_objects';

const stringOrList = () => oneOf<string | string[]>([string(), arrayOf(string())]);
const asList = (value: string | string[] | undefined) => (typeof value === 'string' ? [value] : value);

const params = object({ type: string(), id: string() });

const references = () => maybe(arrayOf(object({ name: string(), type: string(), id: string() })));

/** A file of a form, which the original reads as a stream */
const stream = (): Schema<UploadedFile> => ({
  validate(value, path) {
    if (value instanceof UploadedFile) return value;
    throw new SchemaTypeError(`expected value of type [Stream] but got [${typeDetect(value)}]`, path);
  },
});

const findQuery = object({
  per_page: number({ min: 0, defaultValue: 20 }),
  page: number({ min: 0, defaultValue: 1 }),
  type: stringOrList(),
  search: maybe(string()),
  default_search_operator: oneOf<string>([literal('OR'), literal('AND')], { defaultValue: 'OR' }),
  search_fields: maybe(stringOrList()),
  sort_field: maybe(string()),
  has_reference: maybe(object({ type: string(), id: string() })),
  fields: maybe(stringOrList()),
  filter: maybe(string()),
  namespaces: maybe(stringOrList()),
  workspaces: maybe(stringOrList()),
});

/** The JSON of a request's body, `null` when it has none, as hapi gives it */
async function body(context: RequestContext): Promise<unknown> {
  const parsed = await context.json();
  return parsed === undefined ? null : parsed;
}

/** The form an import is sent in; any other kind of body is refused before it is read */
async function form(context: RequestContext): Promise<Record<string, unknown>> {
  const type = String(context.req.headers['content-type'] ?? '');
  if (!/^multipart\/form-data\b/i.test(type)) throw new HttpError(415, 'Unsupported Media Type');
  return parseMultipart(await context.body(), type);
}

export function registerSavedObjects(
  router: Router,
  repository: SavedObjectsRepository,
  options: { maxImportExportSize: number; maxImportPayloadBytes: number }
) {
  const limit = options.maxImportExportSize;
  const maxBytes = { maxBytes: options.maxImportPayloadBytes };

  router.get('/api/saved_objects/_find', async ({ query }) => {
    const request = validateRequestPart(findQuery, queryObject(query), 'query');
    const workspaces = request.workspaces ? ([] as string[]).concat(request.workspaces) : undefined;
    return {
      body: await repository.find({
        perPage: request.per_page,
        page: request.page,
        type: asList(request.type) ?? [],
        search: request.search,
        defaultSearchOperator: request.default_search_operator,
        searchFields: asList(request.search_fields),
        sortField: request.sort_field,
        hasReference: request.has_reference,
        fields: asList(request.fields),
        filter: request.filter,
        namespaces: asList(request.namespaces),
        ...(workspaces ? { workspaces } : {}),
      }),
    };
  });

  const bulkGetBody = arrayOf(object({ type: string(), id: string(), fields: maybe(arrayOf(string())) }));
  router.post('/api/saved_objects/_bulk_get', async (context) => {
    const objects = validateRequestPart(bulkGetBody, await body(context), 'body');
    return { body: { saved_objects: await repository.bulkGet(objects) } };
  });

  const bulkCreateQuery = object({ overwrite: boolean({ defaultValue: false }), workspaces: maybe(stringOrList()) });
  const bulkCreateBody = arrayOf(
    object({
      type: string(),
      id: maybe(string()),
      attributes: recordOf(string(), any()),
      version: maybe(string()),
      migrationVersion: maybe(recordOf(string(), string())),
      references: references(),
      initialNamespaces: maybe(arrayOf(string(), { minSize: 1 })),
    })
  );
  router.post(
    '/api/saved_objects/_bulk_create',
    async (context) => {
      const query = validateRequestPart(bulkCreateQuery, queryObject(context.query), 'query');
      const objects = validateRequestPart(bulkCreateBody, await body(context), 'body');
      return {
        body: {
          saved_objects: await repository.bulkCreate(
            objects.map((entry) => ({ ...entry, attributes: entry.attributes as Record<string, unknown> })),
            { overwrite: query.overwrite, ...(query.workspaces ? { workspaces: asList(query.workspaces) } : {}) }
          ),
        },
      };
    },
    maxBytes
  );

  const bulkUpdateBody = arrayOf(
    object({
      type: string(),
      id: string(),
      attributes: recordOf(string(), any()),
      version: maybe(string()),
      references: references(),
      namespace: maybe(string({ minLength: 1 })),
    })
  );
  router.put('/api/saved_objects/_bulk_update', async (context) => {
    const objects = validateRequestPart(bulkUpdateBody, await body(context), 'body');
    return {
      body: {
        saved_objects: await repository.bulkUpdate(
          objects.map((entry) => ({ ...entry, attributes: entry.attributes as Record<string, unknown> }))
        ),
      },
    };
  });

  const exportBody = object({
    type: maybe(stringOrList()),
    objects: maybe(arrayOf(object({ type: string(), id: string() }), { maxSize: limit })),
    search: maybe(string()),
    includeReferencesDeep: boolean({ defaultValue: false }),
    excludeExportDetails: boolean({ defaultValue: false }),
    workspaces: maybe(arrayOf(string())),
  });
  router.post('/api/saved_objects/_export', async (context) => {
    const request = validateRequestPart(exportBody, await body(context), 'body');
    const exportRequest = {
      types: asList(request.type),
      objects: request.objects,
      search: request.search,
      includeReferencesDeep: request.includeReferencesDeep,
      excludeExportDetails: request.excludeExportDetails,
      ...(request.workspaces ? { workspaces: request.workspaces } : {}),
    };
    const invalid = exportValidationError(exportRequest);
    if (invalid) throw badRequest(invalid);
    return {
      headers: {
        'content-disposition': 'attachment; filename="export.ndjson"',
        'content-type': 'application/ndjson',
      },
      body: await exportObjects(repository, exportRequest, limit),
    };
  });

  // What an import is checked for; a data source is looked up as a saved object, of a type there is not
  const dataSource = async (id: string | undefined) => {
    if (id) await repository.get('data-source', id);
  };

  const importQuery = object(
    {
      overwrite: boolean({ defaultValue: false }),
      createNewCopies: boolean({ defaultValue: false }),
      dataSourceId: maybe(string()),
      workspaces: maybe(stringOrList()),
      dataSourceEnabled: maybe(boolean()),
    },
    {
      validate: (value) => {
        if (value.overwrite && value.createNewCopies) return 'cannot use [overwrite] with [createNewCopies]';
      },
    }
  );
  const importBody = object({ file: stream() });
  router.post(
    '/api/saved_objects/_import',
    async (context) => {
      const query = validateRequestPart(importQuery, queryObject(context.query), 'query');
      const { file } = validateRequestPart(importBody, await form(context), 'body');
      const extension = fileExtension(file.filename);
      if (extension !== '.ndjson') throw badRequest(`Invalid file extension ${extension}`);
      await dataSource(query.dataSourceId);
      const lines = parseNdjson(file.content.toString('utf8'));
      return {
        body: await importObjects(repository, lines, {
          overwrite: query.overwrite,
          createNewCopies: query.createNewCopies,
          limit,
          canImportConfig: true,
          workspaces: asList(query.workspaces),
        }),
      };
    },
    maxBytes
  );

  const resolveQuery = object({
    createNewCopies: boolean({ defaultValue: false }),
    dataSourceId: maybe(string()),
    workspaces: maybe(stringOrList()),
  });
  const resolveBody = object({
    file: stream(),
    retries: arrayOf(
      object({
        type: string(),
        id: string(),
        overwrite: boolean({ defaultValue: false }),
        destinationId: maybe(string()),
        replaceReferences: arrayOf(object({ type: string(), from: string(), to: string() }), { defaultValue: [] }),
        createNewCopy: maybe(boolean()),
        ignoreMissingReferences: maybe(boolean()),
      })
    ),
  });
  router.post(
    '/api/saved_objects/_resolve_import_errors',
    async (context) => {
      const query = validateRequestPart(resolveQuery, queryObject(context.query), 'query');
      const { file, retries } = validateRequestPart(resolveBody, await form(context), 'body');
      const extension = fileExtension(file.filename);
      if (extension !== '.ndjson') throw badRequest(`Invalid file extension ${extension}`);
      await dataSource(query.dataSourceId);
      const lines = parseNdjson(file.content.toString('utf8'));
      return {
        body: await resolveImportErrors(repository, lines, retries as ImportRetry[], {
          createNewCopies: query.createNewCopies,
          limit,
          canImportConfig: true,
          workspaces: asList(query.workspaces),
        }),
      };
    },
    maxBytes
  );

  // Importing the `.json` files of old releases is only noted, as in the original
  router.post('/api/saved_objects/_log_legacy_import', () => ({ body: { success: true } }));

  router.get('/api/saved_objects/{type}/{id}', async ({ params: path }) => {
    const { type, id } = validateRequestPart(params, path, 'params');
    return { body: await repository.get(type, id) };
  });

  const createParams = object({ type: string(), id: maybe(string()) });
  const createQuery = object({ overwrite: boolean({ defaultValue: false }) });
  const createBody = object({
    attributes: recordOf(string(), any()),
    migrationVersion: maybe(recordOf(string(), string())),
    references: references(),
    initialNamespaces: maybe(arrayOf(string(), { minSize: 1 })),
    workspaces: maybe(arrayOf(string(), { minSize: 1 })),
  });
  const create = async (context: RequestContext) => {
    const { type, id } = validateRequestPart(createParams, context.params, 'params');
    const { overwrite } = validateRequestPart(createQuery, queryObject(context.query), 'query');
    const request = validateRequestPart(createBody, await body(context), 'body');
    if (request.initialNamespaces) {
      throw badRequest('"options.initialNamespaces" can only be used on multi-namespace types: Bad Request');
    }
    return {
      body: await repository.create(type, request.attributes as Record<string, unknown>, {
        id,
        overwrite,
        migrationVersion: request.migrationVersion,
        references: request.references,
        // Passed on as the original passes them, for OpenSearch to refuse: the index has no place for them
        ...(request.workspaces ? { workspaces: request.workspaces } : {}),
      }),
    };
  };
  router.post('/api/saved_objects/{type}', create);
  router.post('/api/saved_objects/{type}/{id}', create);

  const updateBody = object({
    attributes: recordOf(string(), any()),
    version: maybe(string()),
    references: references(),
  });
  router.put('/api/saved_objects/{type}/{id}', async (context) => {
    const { type, id } = validateRequestPart(params, context.params, 'params');
    const request = validateRequestPart(updateBody, await body(context), 'body');
    return {
      body: await repository.update(type, id, request.attributes as Record<string, unknown>, {
        references: request.references,
        version: request.version,
      }),
    };
  });

  const deleteQuery = object({ force: maybe(boolean()) });
  router.delete('/api/saved_objects/{type}/{id}', async (context) => {
    const { type, id } = validateRequestPart(params, context.params, 'params');
    const { force } = validateRequestPart(deleteQuery, queryObject(context.query), 'query');
    return { body: await repository.delete(type, id, { force }) };
  });
}

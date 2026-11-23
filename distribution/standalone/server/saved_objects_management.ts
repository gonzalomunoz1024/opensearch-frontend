/* SPDX-License-Identifier: Apache-2.0 */

/*
 * `/api/opensearch-dashboards/management/saved_objects/...`: what the saved objects page of
 * OpenSearch Dashboards 3.9.0 asks its own plugin for (`saved_objects_management/server`), with
 * each object's `meta` beside it: its icon, its title and the pages that show it.
 */

import type { Router } from './http';
import {
  arrayOf,
  literal,
  maybe,
  number,
  object,
  oneOf,
  queryObject,
  string,
  validateRequestPart,
} from './route_validation';
import type { FindOptions, FoundObject, SavedObjectsRepository } from './saved_objects';
import { badRequestError } from './saved_objects_search';
import { IMPORTABLE_TYPES, isAllowedType, isImportableType, metaOf, typeInfo } from './saved_objects_types';
import type { SavedObject } from '../common/saved_objects';

const ROOT = '/api/opensearch-dashboards/management/saved_objects';

const stringOrList = () => oneOf<string | string[]>([string(), arrayOf(string())]);
const asList = (value: string | string[]) => (Array.isArray(value) ? value : [value]);

/** The object with what the page shows of it: OpenSearch Dashboards' `injectMetaAttributes` */
const withMeta = <T extends { type: string; id: string }>(object: T) => ({
  ...object,
  meta: metaOf(object as unknown as SavedObject),
});

/** Every object a search finds, a page of a thousand at a time */
async function findAll(repository: SavedObjectsRepository, options: FindOptions): Promise<FoundObject[]> {
  const all: FoundObject[] = [];
  for (let page = 1; ; page += 1) {
    const found = await repository.find({ ...options, page });
    all.push(...found.saved_objects);
    if (all.length >= found.total) return all;
  }
}

export function registerSavedObjectsManagement(router: Router, repository: SavedObjectsRepository) {
  const findQuery = object({
    perPage: number({ min: 0, defaultValue: 20 }),
    page: number({ min: 0, defaultValue: 1 }),
    type: stringOrList(),
    namespaces: maybe(stringOrList()),
    search: maybe(string()),
    defaultSearchOperator: oneOf<string>([literal('OR'), literal('AND')], { defaultValue: 'OR' }),
    sortField: maybe(string()),
    sortOrder: maybe(string()),
    hasReference: maybe(object({ type: string(), id: string() })),
    fields: oneOf<string | string[]>([string(), arrayOf(string())], { defaultValue: [] }),
    workspaces: maybe(stringOrList()),
  });

  router.get(`${ROOT}/_find`, async ({ query }) => {
    const request = validateRequestPart(findQuery, queryObject(query), 'query');
    const types = asList(request.type);
    const included = asList(request.fields);
    const searchFields = new Set<string>();
    for (const type of types.filter(isImportableType)) {
      const field = typeInfo(type)?.management?.defaultSearchField;
      if (field) searchFields.add(field);
    }
    // One namespace comes as text, which the original's repository cannot read
    if (typeof request.namespaces === 'string') {
      if (request.namespaces === '') throw badRequestError('options.namespaces cannot be an empty array');
      if (types.some(isAllowedType)) throw new Error('namespacesToNormalize.map is not a function');
    }
    const found = await repository.find({
      perPage: request.perPage,
      page: request.page,
      type: types,
      namespaces: request.namespaces === undefined ? undefined : asList(request.namespaces),
      search: request.search,
      defaultSearchOperator: request.defaultSearchOperator,
      sortField: request.sortField,
      sortOrder: request.sortOrder,
      hasReference: request.hasReference,
      searchFields: [...searchFields],
      ...(request.workspaces ? { workspaces: ([] as string[]).concat(request.workspaces) } : {}),
    });
    const savedObjects = found.saved_objects.map((found) => {
      if (found.type !== 'index-pattern') return found;
      // An index pattern of a data source is listed under it; there are none, so under its id
      const dataSource = found.references.find((reference) => reference.type === 'data-source');
      if (!dataSource || !found.attributes) return found;
      const attributes = { ...found.attributes, title: `${dataSource.id}::${String(found.attributes.title)}` };
      return { ...found, attributes };
    });
    return {
      body: {
        ...found,
        saved_objects: savedObjects.map(withMeta).map((entry) => {
          const attributes: Record<string, unknown> = {};
          for (const field of included) attributes[field] = (entry.attributes as Record<string, unknown> | undefined)?.[field];
          return { ...entry, attributes };
        }),
      },
    };
  });

  router.get(`${ROOT}/_allowed_types`, () => ({ body: { types: IMPORTABLE_TYPES } }));

  const countsBody = object({
    typesToInclude: arrayOf(string(), { maxSize: 100 }),
    namespacesToInclude: maybe(arrayOf(string(), { maxSize: 100 })),
    searchString: maybe(string()),
    workspaces: maybe(arrayOf(string(), { maxSize: 100 })),
    availableWorkspaces: maybe(arrayOf(string(), { maxSize: 100 })),
  });

  router.post(`${ROOT}/scroll/counts`, async (context) => {
    const parsed = await context.json();
    const body = validateRequestPart(countsBody, parsed === undefined ? null : parsed, 'body');
    const counts: Record<string, Record<string, number>> = { type: {} };
    const options: FindOptions = { type: body.typesToInclude, perPage: 1000 };
    const hasNamespaces = Array.isArray(body.namespacesToInclude) && body.namespacesToInclude.length > 0;
    const hasWorkspaces =
      (Array.isArray(body.workspaces) && body.workspaces.length > 0) ||
      (Array.isArray(body.availableWorkspaces) && body.availableWorkspaces.length > 0);
    if (hasNamespaces) {
      counts.namespaces = {};
      options.namespaces = body.namespacesToInclude;
    }
    if (hasWorkspaces) {
      counts.workspaces = {};
      options.workspaces = body.workspaces;
    }
    if (body.searchString) {
      options.search = `${body.searchString}*`;
      options.searchFields = ['title'];
    }
    const objects = await findAll(repository, options);
    for (const found of objects) {
      if (hasNamespaces) {
        for (const namespace of (found.namespaces ?? []).flat()) {
          const name = namespace === null ? 'default' : namespace;
          counts.namespaces[name] = (counts.namespaces[name] ?? 0) + 1;
        }
      }
      if (hasWorkspaces) {
        for (const workspace of (found as { workspaces?: string[] }).workspaces ?? []) {
          counts.workspaces[workspace] = (counts.workspaces[workspace] ?? 0) + 1;
        }
      }
      counts.type[found.type] = (counts.type[found.type] ?? 0) + 1;
    }
    for (const type of body.typesToInclude) if (!counts.type[type]) counts.type[type] = 0;
    for (const namespace of body.namespacesToInclude ?? []) {
      if (!counts.namespaces[namespace]) counts.namespaces[namespace] = 0;
    }
    for (const workspace of body.workspaces ?? body.availableWorkspaces ?? []) {
      if (!counts.workspaces[workspace]) counts.workspaces[workspace] = 0;
    }
    return { body: counts };
  });

  const exportBody = object({ typesToInclude: arrayOf(string()) });
  router.post(`${ROOT}/scroll/export`, async (context) => {
    const parsed = await context.json();
    const body = validateRequestPart(exportBody, parsed === undefined ? null : parsed, 'body');
    const objects = await findAll(repository, { perPage: 1000, type: body.typesToInclude });
    return {
      body: objects.map((hit) => ({
        _id: hit.id,
        _type: hit.type,
        _source: hit.attributes,
        _meta: { savedObjectVersion: 2 },
        _migrationVersion: hit.migrationVersion,
        _references: hit.references || [],
      })),
    };
  });

  const params = object({ type: string(), id: string() });
  const relationshipsQuery = object({
    size: number({ defaultValue: 10000 }),
    savedObjectTypes: stringOrList(),
  });

  router.get(`${ROOT}/relationships/{type}/{id}`, async (context) => {
    const { type, id } = validateRequestPart(params, context.params, 'params');
    const query = validateRequestPart(relationshipsQuery, queryObject(context.query), 'query');
    const { references = [] } = await repository.get(type, id);
    // One lookup for each object, whatever names it is referred to by
    const referenced = new Map(references.map((reference) => [`${reference.type}:${reference.id}`, { id: reference.id, type: reference.type }]));
    const [children, parents] = await Promise.all([
      referenced.size > 0 ? repository.bulkGet([...referenced.values()]) : Promise.resolve([]),
      repository.find({ hasReference: { type, id }, perPage: query.size, type: asList(query.savedObjectTypes) }),
    ]);
    // An object referred to that is gone is listed as the others are; the original fails reading its title
    const common = (entry: { id: string; type: string; workspaces?: string[] }) => {
      const meta = metaOf(entry as unknown as SavedObject);
      return { id: entry.id, type: entry.type, meta, workspaces: entry.workspaces };
    };
    return {
      body: [
        ...children.map((child) => ({ ...common(child), relationship: 'child' })),
        ...parents.saved_objects.map((parent) => ({ ...common(parent), relationship: 'parent' })),
      ],
    };
  });

  router.get(`${ROOT}/{type}/{id}`, async (context) => {
    const { type, id } = validateRequestPart(params, context.params, 'params');
    return { body: withMeta(await repository.get(type, id)) };
  });
}


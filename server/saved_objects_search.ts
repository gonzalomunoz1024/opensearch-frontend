/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The OpenSearch request a saved objects search becomes, as OpenSearch Dashboards 3.9.0 writes it
 * (`search_dsl/query_params.ts`, `sorting_params.ts`, `included_fields.ts` and `filter_utils.ts` of
 * its saved objects service): the same clauses in the same places, so that the same index answers
 * with the same objects, scored and ordered alike.
 */

import { kueryToDsl, parseKuery, type FunctionNode, type KueryNode, type LiteralNode } from '../web/lib/kuery';
import { HttpError, badRequest } from './http';
import { isNamespaceAgnostic, typeInfo } from './saved_objects_types';

type Dsl = Record<string, unknown>;

interface MappingProperty {
  type?: string;
  properties?: Record<string, MappingProperty>;
  fields?: Record<string, MappingProperty>;
}

export interface IndexMapping {
  properties: Record<string, MappingProperty>;
}

const DEFAULT_NAMESPACE = 'default';

/** OpenSearch Dashboards' `createBadRequestError`, whose message ends in the error's own */
export const badRequestError = (reason: string) => badRequest(`${reason}: Bad Request`);
const ALL_NAMESPACES = '*';

/** A mapping by its dotted path, a multi-field (`url.url.keyword`) included */
export function getProperty(mappings: IndexMapping, path: string): MappingProperty | undefined {
  let at: MappingProperty | undefined = mappings as MappingProperty;
  const parts = path.split('.');
  for (let index = 0; index < parts.length; index += 1) {
    const children: Record<string, MappingProperty> | undefined = at?.properties ?? at?.fields;
    if (!children) return undefined;
    at = children[parts[index]];
  }
  return at;
}

// The fields of a search: those asked for, under each type, or every field
function simpleQueryStringFields(types: string[], searchFields: string[] = [], rootSearchFields: string[] = []) {
  if (!searchFields.length && !rootSearchFields.length) return { lenient: true, fields: ['*'] };
  for (const field of rootSearchFields) {
    if (field.includes('.')) {
      throw new Error(`rootSearchFields entry "${field}" is invalid: cannot contain "." character`);
    }
  }
  const fields = [...rootSearchFields];
  for (const field of searchFields) fields.push(...types.map((type) => `${type}.${field}`));
  return { fields };
}

// Which documents of a type the namespaces asked for hold; no type of this product spans several
function clauseForType(namespaces: string[] = [DEFAULT_NAMESPACE], type: string): Dsl {
  if (namespaces.length === 0) throw new Error('cannot specify empty namespaces array');
  if (isNamespaceAgnostic(type) || !typeInfo(type)) {
    return {
      bool: {
        must: [{ term: { type } }],
        must_not: [{ exists: { field: 'namespace' } }, { exists: { field: 'namespaces' } }],
      },
    };
  }
  const should: Dsl[] = [];
  const named = namespaces.filter((namespace) => namespace !== DEFAULT_NAMESPACE);
  if (named.length > 0) should.push({ terms: { namespace: named } });
  if (namespaces.includes(DEFAULT_NAMESPACE)) {
    should.push({ bool: { must_not: [{ exists: { field: 'namespace' } }] } });
  }
  return {
    bool: {
      must: [{ term: { type } }],
      should,
      minimum_should_match: 1,
      must_not: [{ exists: { field: 'namespaces' } }],
    },
  };
}

// `*` stands for the default namespace, and each one is asked once
const normalizeNamespaces = (namespaces?: string[]) =>
  namespaces
    ? [...new Set(namespaces.map((namespace) => (namespace === ALL_NAMESPACES ? DEFAULT_NAMESPACE : namespace)))]
    : undefined;

export function clauseForReference(reference: { type: string; id: string }): Dsl {
  return {
    nested: {
      path: 'references',
      query: {
        bool: {
          must: [{ term: { 'references.id': reference.id } }, { term: { 'references.type': reference.type } }],
        },
      },
    },
  };
}

/**
 * The fields a search ending in `*` also looks for as the start of a phrase, each with its boost:
 * those asked for under each type or, when none are, the field each type is searched by. On its
 * own, `zz-agent*` is a word no title holds, since a hyphen splits the words of a title.
 */
export function matchPhrasePrefixFields(searchFields: string[] = [], types: string[]): Array<{ field: string; boost: number }> {
  const asked = searchFields.filter((field) => field !== '*');
  const fields =
    asked.length === 0
      ? types.flatMap((type) => {
          const field = typeInfo(type)?.management?.defaultSearchField;
          return field ? [`${type}.${field}`] : [];
        })
      : asked.flatMap((field) => types.map((type) => `${type}.${field}`));
  return fields.map((rawField) => {
    const [field, rawBoost] = rawField.split('^');
    const boost = rawBoost ? parseInt(rawBoost, 10) : 1;
    return { field, boost: Number.isNaN(boost) ? 1 : boost };
  });
}

export interface QueryParamsOptions {
  types: string[];
  namespaces?: string[];
  search?: string;
  searchFields?: string[];
  rootSearchFields?: string[];
  defaultSearchOperator?: string;
  hasReference?: { type: string; id: string };
  kueryNode?: KueryNode;
  workspaces?: string[];
  workspacesSearchOperator?: 'AND' | 'OR';
}

/** The `query` of a search, clause for clause as OpenSearch Dashboards builds it */
export function getQueryParams(options: QueryParamsOptions): { query: { bool: Dsl } } {
  const { types, namespaces, search, searchFields, rootSearchFields, defaultSearchOperator, hasReference, kueryNode, workspaces } =
    options;
  const workspacesSearchOperator = options.workspacesSearchOperator ?? 'AND';
  const filter: Dsl[] = [
    ...(kueryNode ? [kueryToDsl(kueryNode)] : []),
    {
      bool: {
        ...(hasReference ? { must: [clauseForReference(hasReference)] } : {}),
        should: types.map((type) => clauseForType(normalizeNamespaces(namespaces), type)),
        minimum_should_match: 1,
      },
    },
  ];
  const bool: Dsl = { filter };

  if (search) {
    const simpleQueryString = {
      simple_query_string: {
        query: search,
        ...simpleQueryStringFields(types, searchFields, rootSearchFields),
        ...(defaultSearchOperator ? { default_operator: defaultSearchOperator } : {}),
      },
    };
    if (search.trim().endsWith('*')) {
      const query = search.replace(/[*]$/, '');
      bool.should = [
        simpleQueryString,
        ...matchPhrasePrefixFields(searchFields, types).map(({ field, boost }) => ({
          match_phrase_prefix: { [field]: { query, boost } },
        })),
      ];
      bool.minimum_should_match = 1;
    } else {
      bool.must = [simpleQueryString];
    }
  }

  if (workspaces) {
    const workspaceClause =
      workspaces.length === 0
        ? { match_none: {} }
        : {
            bool: {
              should: workspaces.map((workspace) => ({ bool: { must: [{ term: { workspaces: workspace } }] } })),
              minimum_should_match: 1,
            },
          };
    // With "OR" a workspace is one of the permissions an object may be found by; there are none
    if (workspacesSearchOperator === 'OR') filter.push({ bool: { should: [workspaceClause] } });
    else filter.push(workspaceClause);
  }

  return { query: { bool } };
}

const TOP_LEVEL_FIELDS = ['_id', '_score'];

/** The `sort` of a search: a field of the one type searched, or one every type has */
export function getSortingParams(mappings: IndexMapping, types: string[], sortField?: string, sortOrder?: string): Dsl {
  if (!sortField) return {};
  const order = sortOrder === undefined ? {} : { order: sortOrder };
  if (TOP_LEVEL_FIELDS.includes(sortField)) return { sort: [{ [sortField]: { ...order } }] };
  if (types.length > 1) {
    const rootField = getProperty(mappings, sortField);
    if (!rootField) throw badRequest(`Unable to sort multiple types by field ${sortField}, not a root property`);
    return { sort: [{ [sortField]: { ...order, unmapped_type: rootField.type } }] };
  }
  let key = `${types[0]}.${sortField}`;
  let field = getProperty(mappings, key);
  if (!field) {
    key = sortField;
    field = getProperty(mappings, sortField);
    if (!field) throw badRequest(`Unknown sort field ${sortField}`);
  }
  return { sort: [{ [key]: { ...order, unmapped_type: field.type } }] };
}

export function getSearchDsl(
  mappings: IndexMapping,
  options: QueryParamsOptions & { sortField?: string; sortOrder?: string }
): Dsl {
  if (!options.types) throw new HttpError(406, 'type must be specified');
  if (options.sortOrder && !options.sortField) throw new HttpError(406, 'sortOrder requires a sortField');
  return {
    ...getQueryParams(options),
    ...getSortingParams(mappings, options.types, options.sortField, options.sortOrder),
  };
}

/** The `_source` of a search that asks for some fields: those under each type, and the object's own */
export function includedFields(types: string[], fields?: string[]): string[] | undefined {
  if (!fields || fields.length === 0) return undefined;
  return [
    ...types.flatMap((type) => fields.map((field) => `${type}.${field}`)),
    'namespace',
    'namespaces',
    'type',
    'references',
    'migrationVersion',
    'updated_at',
    'originId',
    'workspaces',
    'permissions',
    ...fields,
  ];
}

// --- filter: DQL over `<type>.attributes.<field>` ------------------------------------------------

const FUNCTIONS_WITH_A_KEY = ['is', 'range', 'nested'];

const fieldDefined = (mappings: IndexMapping, key: string) => {
  let at: MappingProperty | undefined = mappings as MappingProperty;
  for (const part of key.split('.')) {
    at = at?.properties?.[part];
    if (at === undefined) return false;
  }
  return at !== null;
};

/** Whether a key names a field every object has (`updated_at`, `dashboard.updated_at`) */
export function isSavedObjectAttr(key: string | null | undefined, mappings: IndexMapping): boolean {
  const parts = key != null ? key.split('.') : [];
  if (parts.length === 1) return fieldDefined(mappings, parts[0]);
  if (parts.length === 2) return fieldDefined(mappings, parts[1]);
  return false;
}

/** What is wrong with a key of a filter, as OpenSearch Dashboards words it */
export function hasFilterKeyError(key: string | null | undefined, types: string[], mappings: IndexMapping): string | null {
  if (key == null) return `The key is empty and needs to be wrapped by a saved object type like ${types.join()}`;
  if (!key.includes('.')) return `This key '${key}' need to be wrapped by a saved object type like ${types.join()}`;
  const parts = key.split('.');
  if (parts.length <= 1 || !types.includes(parts[0])) return `This type ${parts[0]} is not allowed`;
  if ((parts.length === 2 && fieldDefined(mappings, key)) || (parts.length > 2 && parts[1] !== 'attributes')) {
    return `This key '${key}' does NOT match the filter proposition SavedObjectType.attributes.key`;
  }
  if (
    (parts.length === 2 && !fieldDefined(mappings, parts[1])) ||
    (parts.length > 2 && !fieldDefined(mappings, `${parts[0]}.${parts.slice(2).join('.')}`))
  ) {
    return `This key '${key}' does NOT exist in ${types.join()} saved object index patterns`;
  }
  return null;
}

interface KeyCheck {
  path: number[];
  error: string | null;
  isSavedObjectAttr: boolean;
  key: string;
  type: string | null;
}

const keyValue = (node: KueryNode): string | null => {
  if (node.type === 'literal' || node.type === 'wildcard') return node.value == null ? null : String(node.value);
  return null;
};

// Every key of the tree, with where it is: the first argument of an is, a range or a nested
function checkKeys(
  node: FunctionNode,
  types: string[],
  mappings: IndexMapping,
  path: number[],
  storeValue: boolean,
  hasNestedKey: boolean,
  nestedKeys?: string
): KeyCheck[] {
  let localNestedKeys: string | undefined;
  return node.arguments.flatMap((argument, index): KeyCheck[] => {
    if (hasNestedKey && argument.type === 'literal' && argument.value != null) {
      localNestedKeys = String(argument.value);
    }
    if (argument.type === 'function') {
      return checkKeys(
        argument,
        types,
        mappings,
        [...path, index],
        FUNCTIONS_WITH_A_KEY.includes(argument.function),
        argument.function === 'nested',
        localNestedKeys
      );
    }
    if (storeValue && index === 0) {
      const value = keyValue(argument);
      const key = (nestedKeys != null ? `${nestedKeys}.${value}` : value) as string;
      return [
        {
          path,
          error: hasFilterKeyError(key, types, mappings),
          isSavedObjectAttr: isSavedObjectAttr(key, mappings),
          key,
          type: key != null && key.includes('.') ? key.split('.')[0] : null,
        },
      ];
    }
    return [];
  });
}

const literal = (value: string): LiteralNode => ({ type: 'literal', value });
const isNode = (field: string, value: string): FunctionNode => ({
  type: 'function',
  function: 'is',
  arguments: [literal(field), literal(value), { type: 'literal', value: false }],
});

/**
 * The DQL of a `filter`, its keys checked against the types searched and rewritten to the fields
 * of the index: `dashboard.attributes.title` is `dashboard.title`, `dashboard.updated_at` is
 * `updated_at` for dashboards only.
 */
export function filterToKueryNode(types: string[], filter: string, mappings: IndexMapping): KueryNode {
  let root: KueryNode;
  try {
    root = parseKuery(filter);
  } catch (error) {
    if ((error as Error).name === 'DQLSyntaxError') throw badRequestError(`DQLSyntaxError: ${(error as Error).message}`);
    throw error;
  }
  if (root.type !== 'function') {
    throw badRequestError('If we have a filter options defined, we should always have validationFilterKuery defined too');
  }
  const checks = checkKeys(
    root,
    types,
    mappings,
    [],
    FUNCTIONS_WITH_A_KEY.includes(root.function),
    root.function === 'nested'
  );
  if (checks.length === 0) {
    throw badRequestError('If we have a filter options defined, we should always have validationFilterKuery defined too');
  }
  const errors = checks.filter((check) => check.error != null).map((check) => check.error);
  if (errors.length) throw badRequestError(errors.join('\n'));

  const at = (path: number[]): FunctionNode =>
    path.reduce<FunctionNode>((node, index) => node.arguments[index] as FunctionNode, root as FunctionNode);
  for (const check of checks) {
    const node = at(check.path);
    const key = node.arguments[0] as LiteralNode;
    if (check.isSavedObjectAttr) {
      key.value = String(key.value).split('.')[1];
      const type = types.filter((candidate) => candidate === check.type);
      // At the top of the tree the original's lodash `set` with an empty path changes nothing, so
      // a lone `dashboard.updated_at` is not narrowed to dashboards there either
      if (type.length === 1 && check.path.length > 0) {
        const wrapped: FunctionNode = { type: 'function', function: 'and', arguments: [isNode('type', type[0]), node] };
        at(check.path.slice(0, -1)).arguments[check.path[check.path.length - 1]] = wrapped;
      }
    } else {
      key.value = String(key.value).replace('.attributes', '');
    }
  }
  return root;
}

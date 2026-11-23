/* SPDX-License-Identifier: Apache-2.0 */

/*
 * What the saved objects page works out without drawing anything, as the original's lib does: the
 * answer of an import read into what failed and what needs an index pattern, the retries that
 * resolve it, the summary of an import, and the fields of an object on its inspect page.
 */

// --- The objects of the page ----------------------------------------------------------------------

export interface ObjectMeta {
  icon?: string;
  title?: string;
  editUrl?: string;
  inAppUrl?: { path: string; uiCapabilitiesPath?: string };
  namespaceType?: string;
}

/** An object as the management routes answer it */
export interface ManagedObject {
  id: string;
  type: string;
  updated_at?: string;
  meta: ObjectMeta;
  relationship?: 'parent' | 'child';
}

export const getDefaultTitle = (object: { id: string; type: string }) => `${object.type} [id=${object.id}]`;

export const titleOf = (object: { id: string; type: string; meta: ObjectMeta }) => object.meta.title || getDefaultTitle(object);

export function getSavedObjectLabel(type: string) {
  switch (type) {
    case 'index-pattern':
    case 'index-patterns':
    case 'indexPatterns':
      return 'index patterns';
    default:
      return type;
  }
}

// --- Import ---------------------------------------------------------------------------------------

export interface ImportReference {
  type: string;
  id: string;
}

export type ImportError =
  | { type: 'conflict'; destinationId?: string }
  | { type: 'ambiguous_conflict'; destinations: Array<{ id: string; title?: string; updatedAt?: string }> }
  | { type: 'unsupported_type' }
  | { type: 'missing_references'; references: ImportReference[] }
  | { type: 'missing_data_source'; dataSource?: string }
  | { type: 'unknown'; message: string; statusCode?: number };

export interface ImportObject {
  id: string;
  type: string;
  title?: string;
  meta: { title?: string; icon?: string };
  overwrite?: boolean;
}

export interface ImportSuccess extends ImportObject {
  destinationId?: string;
  createNewCopy?: boolean;
}

export interface ImportResponse {
  success: boolean;
  successCount: number;
  successResults?: ImportSuccess[];
  errors?: Array<ImportObject & { error: ImportError }>;
}

export interface FailedImport {
  obj: ImportObject;
  error: ImportError;
}

export interface UnmatchedReference {
  existingIndexPatternId: string;
  list: ImportObject[];
  newIndexPatternId?: string;
}

export interface ProcessedImport {
  failedImports: FailedImport[];
  successfulImports: ImportSuccess[];
  unmatchedReferences: UnmatchedReference[];
  status: 'success' | 'idle';
  importCount: number;
}

const isAnyConflict = (error: ImportError) => error.type === 'conflict' || error.type === 'ambiguous_conflict';

/** The failures of an import, and the missing index patterns the person can pick a new one for */
export function processImportResponse(response: ImportResponse): ProcessedImport {
  const failedImports: FailedImport[] = [];
  const unmatched = new Map<string, UnmatchedReference>();
  for (const { error, ...obj } of response.errors ?? []) {
    failedImports.push({ obj, error });
    if (error.type !== 'missing_references') continue;
    for (const reference of error.references.filter((ref) => ref.type === 'index-pattern')) {
      const key = `${reference.type}:${reference.id}`;
      const conflict = unmatched.get(key) ?? { existingIndexPatternId: reference.id, list: [], newIndexPatternId: undefined };
      if (!conflict.list.some(({ type, id }) => type === obj.type && id === obj.id)) {
        conflict.list.push(obj);
        unmatched.set(key, conflict);
      }
    }
  }
  return {
    failedImports,
    successfulImports: response.successResults ?? [],
    unmatchedReferences: [...unmatched.values()],
    status: unmatched.size === 0 && !failedImports.some((failure) => isAnyConflict(failure.error)) ? 'success' : 'idle',
    importCount: response.successCount,
  };
}

export interface RetryDecision {
  retry: boolean;
  options: { overwrite: boolean; destinationId?: string };
}

export interface ReplaceReference {
  type: string;
  from: string;
  to: string;
}

export interface RetryObject {
  type: string;
  id: string;
  overwrite?: boolean;
  destinationId?: string;
  replaceReferences?: ReplaceReference[];
  createNewCopy?: boolean;
}

export type FailedConflict = FailedImport & { error: Extract<ImportError, { type: 'conflict' | 'ambiguous_conflict' }> };

const RESOLVABLE_ERRORS = ['conflict', 'ambiguous_conflict', 'missing_references'];
const isConflict = (failure: FailedImport): failure is FailedImport & { error: { type: 'conflict'; destinationId?: string } } =>
  failure.error.type === 'conflict';
const isAmbiguousConflict = (failure: FailedImport): failure is FailedConflict => failure.error.type === 'ambiguous_conflict';
const isFailedConflict = (failure: FailedImport): failure is FailedConflict => isAnyConflict(failure.error);
const keyOf = ({ type, id }: { type: string; id: string }) => `${type}:${id}`;

/** A conflict of an object that also misses a reference waits for the reference to be resolved first */
function filterFailedImports(failures: FailedImport[]) {
  const missing = new Set(failures.filter(({ error }) => error.type === 'missing_references').map(({ obj }) => keyOf(obj)));
  return failures.filter((failure) => !isFailedConflict(failure) || !missing.has(keyOf(failure.obj)));
}

export interface ResolveState {
  importCount: number;
  unmatchedReferences?: UnmatchedReference[];
  failedImports?: FailedImport[];
  successfulImports?: ImportSuccess[];
  importMode: { createNewCopies: boolean; overwrite: boolean };
}

/**
 * The original's resolveImportErrors: until no error can be resolved any more, the conflicts are
 * overwritten (all of them, or those the person agrees to one by one), the missing index patterns
 * replaced by the ones picked, and the import is asked again with those retries and the ones that
 * went through.
 */
export async function resolveImportErrors({
  state,
  getConflictResolutions,
  callResolveImportErrors,
}: {
  state: ResolveState;
  getConflictResolutions: (conflicts: FailedConflict[]) => Promise<Record<string, RetryDecision>>;
  callResolveImportErrors: (retries: RetryObject[], createNewCopies: boolean) => Promise<ImportResponse>;
}): Promise<{ status: 'success'; importCount: number; failedImports: FailedImport[]; successfulImports: ImportSuccess[] }> {
  const decisions = new Map<string, RetryDecision>();
  const replacements = new Map<string, ReplaceReference[]>();
  let { importCount } = state;
  let failedImports = state.failedImports ?? [];
  let successfulImports = state.successfulImports ?? [];
  const { createNewCopies, overwrite: overwriteAll } = state.importMode;
  const unmatchedReferences = state.unmatchedReferences ?? [];

  const retryOf = (failure: FailedImport): RetryObject | undefined => {
    const decision = decisions.get(keyOf(failure.obj));
    if (!decision?.retry && isAnyConflict(failure.error)) return undefined;
    if (failure.error.type === 'missing_references') {
      const replace = replacements.get(keyOf(failure.obj)) ?? [];
      for (const reference of failure.error.references.filter((ref) => ref.type === 'index-pattern')) {
        for (const { existingIndexPatternId: from, newIndexPatternId: to } of unmatchedReferences) {
          if (!to || from !== reference.id) continue;
          if (!replace.some((ref) => ref.type === 'index-pattern' && ref.from === from && ref.to === to)) {
            replace.push({ type: 'index-pattern', from, to });
          }
        }
      }
      replacements.set(keyOf(failure.obj), replace);
      // Nothing to replace: the person chose to skip it
      if (replace.length === 0) return undefined;
    }
    return {
      id: failure.obj.id,
      type: failure.obj.type,
      ...(decision?.retry ? decision.options : {}),
      replaceReferences: replacements.get(keyOf(failure.obj)),
    };
  };

  while (failedImports.some((failure) => RESOLVABLE_ERRORS.includes(failure.error.type))) {
    const failures = filterFailedImports(failedImports);
    if (overwriteAll) {
      for (const failure of failures.filter(isConflict)) {
        const { destinationId } = failure.error;
        decisions.set(keyOf(failure.obj), { retry: true, options: { overwrite: true, ...(destinationId ? { destinationId } : {}) } });
      }
    }
    const asked = (overwriteAll ? failures.filter(isAmbiguousConflict) : failures.filter(isFailedConflict)).filter(
      (failure) => !decisions.has(keyOf(failure.obj))
    );
    const answers = await getConflictResolutions(asked);
    for (const [key, decision] of Object.entries(answers)) decisions.set(key, decision);

    const retries: RetryObject[] = [
      ...failures.map(retryOf).filter((retry): retry is RetryObject => retry !== undefined),
      ...successfulImports.map(({ type, id, overwrite, destinationId, createNewCopy }) => {
        const replaceReferences = replacements.get(`${type}:${id}`);
        return {
          type,
          id,
          ...(overwrite ? { overwrite } : {}),
          ...(replaceReferences ? { replaceReferences } : {}),
          destinationId,
          createNewCopy,
        };
      }),
    ];
    if (retries.length === 0) {
      // Skipped conflicts are not failures any more
      failedImports = failures.filter((failure) => !RESOLVABLE_ERRORS.includes(failure.error.type) || decisions.get(keyOf(failure.obj))?.retry);
      break;
    }
    const response = await callResolveImportErrors(retries, createNewCopies);
    importCount = response.successCount;
    failedImports = (response.errors ?? []).map(({ error, ...obj }) => ({ obj, error }));
    successfulImports = response.successResults ?? [];
  }
  return { status: 'success', importCount, failedImports, successfulImports };
}

export interface ImportItem {
  type: string;
  id: string;
  title: string;
  icon: string;
  outcome: 'created' | 'overwritten' | 'error';
  errorMessage?: string;
}

const compareValues = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);

/** The rows of the import summary: every object, by type and then title */
export function importItems(failedImports: FailedImport[], successfulImports: ImportSuccess[]): ImportItem[] {
  const failed = failedImports.map(({ obj, error }): ImportItem => ({
    type: obj.type,
    id: obj.id,
    title: obj.meta.title || getDefaultTitle(obj),
    icon: obj.meta.icon || 'apps',
    outcome: 'error',
    errorMessage: error.type === 'unknown' ? error.message : error.type === 'unsupported_type' ? 'Unsupported object type' : undefined,
  }));
  const succeeded = successfulImports.map(
    (obj): ImportItem => ({
      type: obj.type,
      id: obj.id,
      title: obj.meta.title || getDefaultTitle(obj),
      icon: obj.meta.icon || 'apps',
      outcome: obj.overwrite ? 'overwritten' : 'created',
    })
  );
  return [...failed, ...succeeded]
    .map((item, index) => ({ item, index }))
    .sort((a, b) => compareValues(a.item.type, b.item.type) || compareValues(a.item.title, b.item.title) || a.index - b.index)
    .map(({ item }) => item);
}

// --- The inspect page -----------------------------------------------------------------------------

export type FieldType = 'text' | 'number' | 'boolean' | 'json' | 'array';

export interface ObjectField {
  type: FieldType;
  name: string;
  value: unknown;
}

/** The pages of the original's saved object loaders: the name in the address, the type, the class's fields */
export interface ObjectService {
  type: string;
  /** The fields of the class, which are shown even when the object has none of them */
  mapping: Record<string, string | { type: string }>;
  searchSource?: boolean;
}

export const OBJECT_SERVICES: Record<string, ObjectService> = {
  savedHomepage: {
    type: 'homepage',
    mapping: { heroes: 'object', sections: 'object' },
  },
  savedDashboards: {
    type: 'dashboard',
    mapping: {
      title: 'text',
      hits: 'integer',
      description: 'text',
      panelsJSON: 'text',
      optionsJSON: 'text',
      variablesJSON: 'text',
      layoutJSON: 'text',
      version: 'integer',
      timeRestore: 'boolean',
      timeTo: 'keyword',
      timeFrom: 'keyword',
      refreshInterval: { type: 'object' },
    },
    searchSource: true,
  },
  savedVisualizations: {
    type: 'visualization',
    mapping: { title: 'text', visState: 'json', uiStateJSON: 'text', description: 'text', savedSearchId: 'keyword', version: 'integer' },
  },
  savedSearches: {
    type: 'search',
    mapping: { title: 'text', description: 'text', hits: 'integer', columns: 'keyword', sort: 'keyword', version: 'integer' },
    searchSource: true,
  },
  savedVisBuilder: {
    type: 'visualization-visbuilder',
    mapping: { title: 'text', description: 'text', visualizationState: 'text', styleState: 'text', uiState: 'text', version: 'integer' },
  },
  savedAugmentVis: {
    type: 'augment-vis',
    mapping: {
      title: 'text',
      description: 'text',
      originPlugin: 'text',
      pluginResource: 'object',
      visLayerExpressionFn: 'object',
      visId: 'keyword,',
      version: 'integer',
    },
  },
};

const STRING_TYPES = new Set(['text', 'keyword', 'string', '_type', '_id', 'match_only_text', 'wildcard', 'constant_keyword']);
const NUMBER_TYPES = new Set([
  'float',
  'half_float',
  'scaled_float',
  'double',
  'integer',
  'long',
  'unsigned_long',
  'short',
  'byte',
  'token_count',
]);

/** The field type of a class field, from the type it is mapped with in OpenSearch */
function typeOfMapping(mapping: string | { type: string }): FieldType {
  if (typeof mapping !== 'string') return 'json';
  if (STRING_TYPES.has(mapping)) return 'text';
  if (NUMBER_TYPES.has(mapping)) return 'number';
  if (mapping === 'boolean') return 'boolean';
  return 'json';
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

function createFields(key: string, value: unknown, parents: string[] = []): ObjectField[] {
  const path = [...parents, key];
  if (path.length > 20) return [];
  const name = path.join('.');
  if (typeof value === 'string') {
    try {
      return [{ type: 'json', name, value: JSON.stringify(JSON.parse(value), undefined, 2) }];
    } catch {
      return [{ type: 'text', name, value }];
    }
  }
  if (typeof value === 'number') return [{ type: 'number', name, value }];
  if (Array.isArray(value)) return [{ type: 'array', name, value: JSON.stringify(value, undefined, 2) }];
  if (typeof value === 'boolean') return [{ type: 'boolean', name, value }];
  if (isPlainObject(value)) return Object.entries(value).flatMap(([childKey, childValue]) => createFields(childKey, childValue, path));
  return [{ type: 'text', name, value }];
}

/**
 * What is asked once and kept for as long as the page lives, as the original's section keeps the
 * types it may show: an answer that failed is asked for again the next time.
 */
export function askedOnce<T>(ask: () => Promise<T>): () => Promise<T> {
  let kept: Promise<T> | undefined;
  return () => {
    if (!kept) {
      const asked = ask();
      kept = asked;
      asked.catch(() => {
        if (kept === asked) kept = undefined;
      });
    }
    return kept;
  };
}

/**
 * The object the inspect page shows, from the answer of the bulk get the original's client asks
 * with. One that is not there comes back with an error instead of attributes, and is shown as the
 * original shows it: an object with nothing in it, the fields of its class empty.
 */
export function inspectedObject<R, T extends { id?: string; attributes?: Record<string, unknown>; references?: R[] }>(type: string, id: string, found: T | undefined) {
  return { ...found, id, type, attributes: found?.attributes ?? {}, references: found?.references ?? [] };
}

/** A delete as the original's client asks for it from the inspect page: not forced, and saying so */
export const inspectDelete = (type: string, id: string) => ({
  path: `/api/saved_objects/${encodeURIComponent(type)}/${encodeURIComponent(id)}`,
  query: { force: false },
});

/**
 * The fields of an object as the original lists them: its attributes, nested ones by their path
 * and JSON text pretty printed, then its references, then the fields of its class it has not
 */
export function createFieldList(
  object: { attributes: Record<string, unknown>; references?: unknown },
  service?: ObjectService
): ObjectField[] {
  const fields = [
    ...Object.entries(object.attributes).flatMap(([key, value]) => createFields(key, value)),
    ...createFields('references', object.references),
  ];
  if (!service) return fields;
  const known = new Set(fields.map((field) => field.name));
  for (const [name, mapping] of Object.entries(service.mapping)) {
    if (!name || known.has(name)) continue;
    fields.push({ name, type: typeOfMapping(mapping), value: undefined });
  }
  if (service.searchSource && !known.has('kibanaSavedObjectMeta.searchSourceJSON')) {
    fields.push({ name: 'kibanaSavedObjectMeta.searchSourceJSON', type: 'json', value: '{}' });
  }
  return fields;
}

/** Sets a value at a dotted path, making the objects on the way, as lodash's set does */
function setPath(target: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split('.');
  let at = target;
  for (const part of parts.slice(0, -1)) {
    const next = at[part];
    if (next === null || typeof next !== 'object') at[part] = {};
    at = at[part] as Record<string, unknown>;
  }
  at[parts[parts.length - 1]] = value;
}

/** What a save sends: the attributes with every field written back, and the references apart */
export function savedAttributes(
  attributes: Record<string, unknown>,
  fields: ObjectField[],
  edited: Record<string, unknown>
): { attributes: Record<string, unknown>; references: unknown } {
  const source = structuredClone(attributes);
  for (const field of fields) {
    let value = edited[field.name] ?? field.value;
    if (field.type === 'array' && typeof value === 'string') value = JSON.parse(value) as unknown;
    setPath(source, field.name, value);
  }
  const { references, ...rest } = source;
  return { attributes: rest, references };
}

// --- The colours of a JSON field ------------------------------------------------------------------

/** A run of a field's text and how it is coloured, as the code editor draws it */
export interface JsonRun {
  text: string;
  /** Key, String, Escape, Number, Boolean, Comment or Guide; none for what is drawn plain */
  kind?: string;
}

// The rules of the original editor's JSON mode, tried in this order where a run starts
const JSON_RULES: Array<{ regex: RegExp; kind?: string; string?: true; comment?: true }> = [
  { regex: /"(?:\\.|[^"\\])*?"\s*(?=:)/y, kind: 'Key' },
  { regex: /"/y, kind: 'String', string: true },
  { regex: /0[xX][0-9a-fA-F]+\b/y, kind: 'Number' },
  { regex: /[+-]?\d+(?:(?:\.\d*)?(?:[eE][+-]?\d+)?)?\b/y, kind: 'Number' },
  { regex: /(?:true|false)\b/y, kind: 'Boolean' },
  { regex: /'(?:\\.|[^'\\])*?'/y },
  { regex: /\/\/.*$/y, kind: 'Comment' },
  { regex: /\/\*/y, kind: 'Comment', comment: true },
  { regex: /\s+/y },
];
const JSON_ESCAPE = /\\(?:x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|["\\/bfnrt])/y;
const INDENT_GUIDE = /\s\S| \t|\t |\s$/;

/**
 * A field's JSON as the original's editor colours it, line by line: its JSON mode's rules, so
 * `null` stays plain, a string ends with its line and an escape in it has the colour of `true`;
 * and the indent guides of its leading spaces, one for each full two spaces before the last
 * space of the indent.
 */
export function tokenizeFieldJson(text: string): JsonRun[][] {
  let inComment = false;
  return text.split('\n').map((line) => {
    const runs: JsonRun[] = [];
    const push = (value: string, kind?: string) => {
      const last = runs[runs.length - 1];
      if (last && last.kind === kind) last.text += value;
      else runs.push(kind ? { text: value, kind } : { text: value });
    };
    let at = 0;
    while (at < line.length) {
      if (inComment) {
        const end = line.indexOf('*/', at);
        const stop = end === -1 ? line.length : end + 2;
        push(line.slice(at, stop), 'Comment');
        at = stop;
        inComment = end === -1;
        continue;
      }
      const rule = JSON_RULES.find((candidate) => {
        candidate.regex.lastIndex = at;
        return candidate.regex.test(line);
      });
      if (!rule) {
        push(line[at]);
        at += 1;
        continue;
      }
      const end = rule.regex.lastIndex;
      push(line.slice(at, end), rule.kind);
      at = end;
      if (rule.comment) inComment = true;
      // A string runs to its closing quote or to the end of its line
      while (rule.string && at < line.length) {
        JSON_ESCAPE.lastIndex = at;
        if (JSON_ESCAPE.test(line)) {
          push(line.slice(at, JSON_ESCAPE.lastIndex), 'Escape');
          at = JSON_ESCAPE.lastIndex;
          continue;
        }
        push(line[at], 'String');
        at += 1;
        if (line[at - 1] === '"') break;
      }
    }
    // The guides are drawn in the first run when it is plain and starts with spaces
    const first = runs[0];
    if (first && !first.kind && first.text.startsWith(' ')) {
      let columns = first.text.search(INDENT_GUIDE);
      if (columns > 0) {
        columns -= columns % 2;
        const guides: JsonRun[] = Array.from({ length: columns / 2 }, () => ({ text: '  ', kind: 'Guide' }));
        const rest = first.text.slice(columns);
        runs.splice(0, 1, ...guides, ...(rest ? [{ text: rest }] : []));
      }
    }
    return runs.length ? runs : [{ text: '' }];
  });
}

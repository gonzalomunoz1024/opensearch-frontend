/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Field popularity, as the original's popularizeField and updateSavedObject keep it: each time a
 * field is added as a column, taken out or moved, its count goes up by one in the index pattern on
 * the page, and the pattern is written with it; "Popular fields" lists the most counted. Each write
 * carries the version of what was read, so that a pattern changed elsewhere meanwhile is not
 * written over: as the original's, a change elsewhere to the fields leaves the page's counts
 * unwritten, and one to anything else is taken before the write is made again, at most three times.
 */

import type { Field, IndexPattern } from '../../lib/types';
import { HttpFetchError } from '../../services/http';
import type { SavedObjectsClient } from '../../services/saved_objects';

/** The index pattern's saved object, which popularity reads and writes */
export interface PatternStore {
  get(id: string): Promise<{ version?: string; attributes: Record<string, unknown> }>;
  update(id: string, attributes: Record<string, unknown>, version: string | undefined): Promise<{ version?: string }>;
}

export const indexPatternStore = (savedObjects: SavedObjectsClient): PatternStore => ({
  get: (id) => savedObjects.get<Record<string, unknown>>('index-pattern', id),
  update: (id, attributes, version) => savedObjects.update('index-pattern', id, attributes, { version }),
});

/** As the original's MAX_ATTEMPTS_TO_RESOLVE_CONFLICTS */
const MAX_ATTEMPTS = 3;

/**
 * What the original's saved object body holds besides the fields, in its order, which the page
 * does not change and so writes as it is stored. The formats, which the original writes anew from
 * those it can read, are left as they are stored.
 */
const BEFORE_FIELDS = ['title', 'displayName', 'description', 'signalType', 'timeFieldName', 'intervalName', 'sourceFilters'];
const AFTER_FIELDS = ['type', 'typeMeta', 'schemaMappings'];

const defined = (record: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));

/**
 * A field as the original's IndexPatternField.toJSON writes it into the pattern: its keys in that
 * order, a count of 0 where there is none, and the flags as the original's getters read them
 */
export function fieldJson(field: Field & { conflictDescriptions?: unknown }): Record<string, unknown> {
  const scripted = Boolean(field.scripted);
  return defined({
    count: field.count || 0,
    script: field.script,
    lang: field.lang,
    conflictDescriptions: field.conflictDescriptions,
    name: field.name,
    type: field.type,
    esTypes: field.esTypes,
    scripted,
    searchable: Boolean(field.searchable || scripted),
    aggregatable: Boolean(field.aggregatable || scripted),
    readFromDocValues: Boolean(field.readFromDocValues && !scripted),
    subType: field.subType,
  });
}

/** The fields as the original writes them into the saved object */
export const fieldsJson = (fields: readonly Field[]) => JSON.stringify(fields.map(fieldJson));

/** The fields a stored pattern holds; none where its text says none or nothing readable */
function storedFields(text: unknown): Field[] {
  if (typeof text !== 'string' || text === '') return [];
  try {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) ? (parsed as Field[]) : [];
  } catch {
    return [];
  }
}

/**
 * Whether the original reads a pattern's fields anew from OpenSearch, and stores them, as it opens
 * it (its isFieldRefreshRequired): none of them says whether it can be searched and aggregated
 * and is read from doc values. Written as they are, they would be stored as none of these.
 */
export function refreshRequired(fields: readonly Field[]): boolean {
  return fields.every((field) => !('aggregatable' in field && 'searchable' in field) || !('readFromDocValues' in field));
}

interface PatternState {
  /** The fields as the page read them, before any count went up: what the original compares with */
  loaded: string;
  /** The version the next write carries: that of the last write, or of what was read */
  version?: string;
  /** The stored pattern as it was read, whose attributes besides the fields the writes keep */
  stored?: Record<string, unknown>;
  /** The fields were changed elsewhere since the page read them: its counts are not written */
  conflicted?: boolean;
  /** The writes, one after the other, as each needs the version the one before was given */
  queue: Promise<void>;
}

const states = new WeakMap<IndexPattern, PatternState>();

function stateOf(pattern: IndexPattern): PatternState {
  let state = states.get(pattern);
  if (!state) {
    state = { loaded: fieldsJson(pattern.fields), queue: Promise.resolve() };
    states.set(pattern, state);
  }
  return state;
}

/** The original's saved object body, with the fields as the page counts them */
function body(stored: Record<string, unknown>, fields: string): Record<string, unknown> {
  const pick = (keys: string[]) => Object.fromEntries(keys.map((key) => [key, stored[key]]));
  return defined({ ...pick(BEFORE_FIELDS), fields, ...pick(AFTER_FIELDS) });
}

/**
 * Writes the fields with the version of what was read. The patterns of the standalone keep no
 * version, so the first write reads it: where the stored fields are no longer those the page read,
 * the original's write is refused and its fields collide, and nothing is written.
 */
async function write(pattern: IndexPattern, state: PatternState, store: PatternStore, fields: string, attempts = 0): Promise<void> {
  if (state.conflicted) return;
  if (state.version === undefined || attempts > 0) {
    const stored = await store.get(pattern.id);
    const storedList = storedFields(stored.attributes.fields);
    // A pattern stored without its fields is read with those OpenSearch has, which the original
    // stores as it opens it
    if (storedList.length > 0 && fieldsJson(storedList) !== state.loaded) {
      state.conflicted = true;
      return;
    }
    state.version = stored.version;
    state.stored = stored.attributes;
  }
  try {
    const answer = await store.update(pattern.id, body(state.stored ?? {}, fields), state.version);
    state.version = answer.version;
  } catch (failure) {
    if (failure instanceof HttpFetchError && failure.status === 409 && attempts < MAX_ATTEMPTS) {
      return write(pattern, state, store, fields, attempts + 1);
    }
    throw failure;
  }
}

/**
 * The original's popularizeField: the field's count goes up by one on the page at once, and the
 * pattern is written with it after the writes before; a write that fails is let go, as there
 */
export async function popularizeField(pattern: IndexPattern, fieldName: string, store: PatternStore): Promise<void> {
  if (!pattern.id) return;
  const field = pattern.fields.find((candidate) => candidate.name === fieldName);
  if (!field) return;
  const state = stateOf(pattern);
  field.count = (field.count || 0) + 1;
  if (refreshRequired(pattern.fields)) return;
  const fields = fieldsJson(pattern.fields);
  state.queue = state.queue.then(() => write(pattern, state, store, fields)).catch(() => undefined);
  await state.queue;
}

/**
 * The pattern the page goes on with in place of another, with its fields read anew: its counts are
 * written as the other's would have been, after what the other wrote
 */
export function keepPopularity(from: IndexPattern, to: IndexPattern): void {
  states.set(to, stateOf(from));
}

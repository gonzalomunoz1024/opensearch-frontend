/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The index patterns of the management pages, read and written as the data plugin of OpenSearch
 * Dashboards reads and writes them: the same requests, the same bodies, the same handling of a
 * save that met someone else's.
 */

import type { Field } from '../../lib/types';
import { services } from '../../services';
import { HttpFetchError } from '../../services/http';
import {
  conflictingKeys,
  fieldWildcardMatcher,
  keptOf,
  metaParamsOf,
  patternFromSavedObject,
  savedBodyOf,
  type FieldRecord,
  type KeptPattern,
  type ManagedPattern,
  type MetaParams,
  type PatternAttributes,
  type SavedBody,
} from './index_pattern_model';

export const setting = (key: string): unknown => services.uiSettings.get(key);

/** Where the page was loaded, as the original's format instances keep it */
function loadedAt(): { origin: string; pathname: string } {
  try {
    const entry = performance.getEntriesByType('navigation')[0];
    if (entry?.name) return { origin: window.location.origin, pathname: new URL(entry.name).pathname };
  } catch {
    // An old browser: where the page is now
  }
  return window.location;
}

let meta: MetaParams | undefined;
export function pageMetaParams(): MetaParams {
  meta ??= metaParamsOf(loadedAt(), services.boot.basePath);
  return meta;
}

export const metaFields = () => {
  const value = setting('metaFields');
  return Array.isArray(value) ? (value as string[]) : ['_source', '_id', '_type', '_index', '_score'];
};

export const sourceFilterMatcher = (globs: string[]) => fieldWildcardMatcher(globs, metaFields());

/**
 * What the original keeps of each pattern this page read, until the page is loaded again: a
 * pattern read again at the version the page last read or wrote is taken as the original still
 * holds it; one someone else wrote since is read afresh
 */
const kept = new Map<string, KeptPattern & { version?: string }>();
const keep = (pattern: ManagedPattern) => kept.set(pattern.id, { ...keptOf(pattern), version: pattern.version });

export async function loadPattern(id: string): Promise<ManagedPattern> {
  const object = await services.savedObjects.get<PatternAttributes>('index-pattern', id);
  const known = kept.get(id);
  const pattern = patternFromSavedObject(
    { id: object.id, version: object.version, attributes: object.attributes, references: object.references },
    pageMetaParams(),
    setting,
    known && known.version === object.version ? known : undefined
  );
  keep(pattern);
  return pattern;
}

export const UNABLE_TO_WRITE =
  'Unable to write index pattern! Refresh the page to get the most up to date changes for this index pattern.';
const MAX_ATTEMPTS_TO_RESOLVE_CONFLICTS = 3;

const PATTERN_KEYS: Record<keyof SavedBody, Array<keyof ManagedPattern>> = {
  title: ['title'],
  displayName: ['displayName'],
  description: ['description'],
  signalType: ['signalType'],
  timeFieldName: ['timeFieldName'],
  intervalName: ['intervalName'],
  sourceFilters: ['sourceFilters'],
  fields: ['fields'],
  fieldFormatMap: ['fieldFormatMap', 'storedFormats'],
  type: ['type'],
  typeMeta: ['typeMeta'],
  schemaMappings: ['schemaMappings'],
};

/**
 * Writes the pattern as the original's updateSavedObject does: with its version, and when that
 * version is no longer the stored one, again over what someone else changed, unless both changed
 * the same thing
 */
export async function savePattern(pattern: ManagedPattern, attempts = 0): Promise<void> {
  const body = savedBodyOf(pattern, setting);
  try {
    const saved = await services.savedObjects.update('index-pattern', pattern.id, body, { version: pattern.version });
    pattern.version = saved.version;
    keep(pattern);
    services.indexPatterns.clear(pattern.id);
  } catch (failure) {
    if (!(failure instanceof HttpFetchError) || failure.status !== 409 || attempts >= MAX_ATTEMPTS_TO_RESOLVE_CONFLICTS) {
      throw failure;
    }
    const theirs = await loadPattern(pattern.id);
    const { changedThere, collision } = conflictingKeys(pattern.originalBody, body, theirs.originalBody);
    if (collision) {
      services.toasts.danger(UNABLE_TO_WRITE);
      throw failure;
    }
    for (const key of changedThere) {
      for (const property of PATTERN_KEYS[key]) {
        (pattern as unknown as Record<string, unknown>)[property] = theirs[property];
      }
    }
    pattern.version = theirs.version;
    await savePattern(pattern, attempts + 1);
  }
}

/** The fields of a pattern's indices, as the original asks for them */
export async function fetchFields(title: string): Promise<FieldRecord[]> {
  const answer = await services.http.get<{ fields: Field[] }>('/api/index_patterns/_fields_for_wildcard', {
    query: { pattern: title, meta_fields: metaFields() },
  });
  return answer.fields as unknown as FieldRecord[];
}

/** Reads the fields again; the scripted ones stay, after the others. A failure is told, not thrown */
export async function refreshFields(pattern: ManagedPattern) {
  try {
    const fields = await fetchFields(pattern.title);
    pattern.fields = [...fields, ...pattern.fields.filter((field) => field.scripted)];
  } catch (failure) {
    if (failure instanceof HttpFetchError && failure.status === 404) services.toasts.danger(failure.message);
    services.toasts.error(failure, `Error fetching fields for index pattern ${pattern.title} (ID: ${pattern.id})`);
  }
}

export async function deletePattern(id: string) {
  await services.savedObjects.delete('index-pattern', id);
  kept.delete(id);
  services.indexPatterns.clear(id);
}

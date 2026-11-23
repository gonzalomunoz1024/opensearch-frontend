/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Index patterns, read from and written to their saved objects in the form OpenSearch Dashboards
 * keeps them: the fields and the field formats are JSON text inside the object.
 */

import type { Field, FieldFormatSpec, IndexPattern } from '../lib/types';
import type { Http } from './http';
import type { SavedObject, SavedObjectsClient } from './saved_objects';
import type { UiSettingsClient } from './ui_settings';

export interface IndexPatternAttributes {
  title: string;
  displayName?: string;
  timeFieldName?: string;
  fields?: string;
  fieldFormatMap?: string;
  sourceFilters?: string;
  [other: string]: unknown;
}

function parseJson<T>(text: unknown, fallback: T): T {
  if (typeof text !== 'string' || text === '') return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export function indexPatternFromSavedObject(object: SavedObject<IndexPatternAttributes>): IndexPattern {
  const { attributes } = object;
  return {
    id: object.id,
    title: attributes.title,
    displayName: attributes.displayName || undefined,
    timeFieldName: attributes.timeFieldName || undefined,
    fields: parseJson<Field[]>(attributes.fields, []),
    fieldFormatMap: parseJson<Record<string, FieldFormatSpec>>(attributes.fieldFormatMap, {}),
    sourceFilters: parseJson<Array<{ value: string }> | undefined>(attributes.sourceFilters, undefined),
  };
}

export function indexPatternAttributes(pattern: IndexPattern): IndexPatternAttributes {
  return {
    title: pattern.title,
    displayName: pattern.displayName,
    timeFieldName: pattern.timeFieldName,
    fields: JSON.stringify(pattern.fields),
    fieldFormatMap:
      Object.keys(pattern.fieldFormatMap).length > 0 ? JSON.stringify(pattern.fieldFormatMap) : undefined,
    sourceFilters: pattern.sourceFilters ? JSON.stringify(pattern.sourceFilters) : undefined,
  };
}

/** What an index pattern is called on screen: its display name, or else the pattern itself */
export const patternName = (pattern: { title: string; displayName?: string }) => pattern.displayName || pattern.title;

export interface IndexPatternSummary {
  id: string;
  title: string;
  displayName?: string;
  timeFieldName?: string;
}

export class IndexPatterns {
  private readonly cache = new Map<string, Promise<IndexPattern>>();
  private summaries?: Promise<IndexPatternSummary[]>;

  constructor(
    private readonly http: Http,
    private readonly savedObjects: SavedObjectsClient,
    private readonly uiSettings: UiSettingsClient
  ) {}

  get(id: string): Promise<IndexPattern> {
    let pattern = this.cache.get(id);
    if (!pattern) {
      pattern = this.savedObjects
        .get<IndexPatternAttributes>('index-pattern', id)
        .then(async (object) => {
          const loaded = indexPatternFromSavedObject(object);
          // An index pattern saved without its fields (made through the API) reads them now
          if (loaded.fields.length === 0) {
            loaded.fields = await this.fetchFields(loaded.title).catch(() => []);
          }
          return loaded;
        });
      this.cache.set(id, pattern);
      pattern.catch(() => this.cache.delete(id));
    }
    return pattern;
  }

  list(): Promise<IndexPatternSummary[]> {
    this.summaries ??= this.savedObjects
      .find<IndexPatternAttributes>({
        type: 'index-pattern',
        fields: ['title', 'timeFieldName', 'displayName'],
        perPage: 10000,
      })
      .then((found) =>
        found.saved_objects
          .map((object) => ({
            id: object.id,
            title: object.attributes.title,
            displayName: object.attributes.displayName || undefined,
            timeFieldName: object.attributes.timeFieldName || undefined,
          }))
          .sort((a, b) => a.title.localeCompare(b.title))
      );
    this.summaries.catch(() => (this.summaries = undefined));
    return this.summaries;
  }

  /** The id of the index pattern a new search starts on: the setting, or else the first one */
  async defaultId(): Promise<string | undefined> {
    const all = await this.list();
    const chosen = this.uiSettings.get<string | undefined>('defaultIndex');
    if (chosen && all.some((pattern) => pattern.id === chosen)) return chosen;
    return all[0]?.id;
  }

  async getDefault(): Promise<IndexPattern | undefined> {
    const id = await this.defaultId();
    return id ? this.get(id) : undefined;
  }

  /** The fields of the indices a pattern matches, as OpenSearch describes them now */
  async fetchFields(title: string): Promise<Field[]> {
    const answer = await this.http.get<{ fields: Field[] }>('/api/index_patterns/_fields_for_wildcard', {
      query: { pattern: title, meta_fields: this.uiSettings.get<string[]>('metaFields', []) },
    });
    return answer.fields;
  }

  async save(pattern: IndexPattern, options: { create?: boolean } = {}): Promise<IndexPattern> {
    const attributes = indexPatternAttributes(pattern);
    // An update is laid over what is stored, so what was taken away has to be said: null
    const cleared = Object.fromEntries(
      Object.entries(attributes).map(([key, value]) => [key, value === undefined ? null : value])
    );
    const saved = options.create
      ? await this.savedObjects.create('index-pattern', attributes, { id: pattern.id || undefined })
      : await this.savedObjects.update('index-pattern', pattern.id, cleared);
    this.clear(saved.id);
    return { ...pattern, id: saved.id };
  }

  async delete(id: string) {
    await this.savedObjects.delete('index-pattern', id);
    this.clear(id);
  }

  /** Forgets what was read, after a change */
  clear(id?: string) {
    if (id) this.cache.delete(id);
    else this.cache.clear();
    this.summaries = undefined;
  }
}

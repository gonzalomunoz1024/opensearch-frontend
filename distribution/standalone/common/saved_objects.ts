/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Saved objects as OpenSearch Dashboards stores them, which is what makes its dashboards carry
 * over: one document per object in the index `.kibana`, with the id `<type>:<id>`, the object's
 * attributes under a field named after its type, and the objects it points at in `references`.
 */

export interface SavedObjectReference {
  /** The name the object's attributes use for this reference, such as `panel_0` */
  name: string;
  type: string;
  id: string;
}

export interface SavedObject<Attributes = Record<string, unknown>> {
  id: string;
  type: string;
  attributes: Attributes;
  references: SavedObjectReference[];
  updated_at?: string;
  /** Changes with every write; given back on an update, it refuses to overwrite a newer one */
  version?: string;
  migrationVersion?: Record<string, string>;
}

export interface FindResponse<Attributes = Record<string, unknown>> {
  page: number;
  per_page: number;
  total: number;
  saved_objects: Array<SavedObject<Attributes>>;
}

/**
 * The version of its type an object is written in. OpenSearch Dashboards 3.9.0 writes these, and
 * an object carrying them needs no migration there.
 */
export const MIGRATION_VERSIONS: Record<string, string> = {
  dashboard: '7.9.3',
  'index-pattern': '7.6.0',
  search: '7.9.3',
  visualization: '7.10.0',
};

interface SearchSource {
  index?: string;
  indexRefName?: string;
  filter?: Array<{ meta?: { index?: string; indexRefName?: string } }>;
}

/**
 * An object written before OpenSearch Dashboards kept ids in `references` (an export from an old
 * release) names other objects inside its attributes. This moves those ids into references, as
 * the migrations of OpenSearch Dashboards do, so that every object in the index has one shape.
 * An object already in that shape comes back unchanged.
 */
export function extractReferences<T extends SavedObject>(object: T): T {
  const references = [...(object.references ?? [])];
  const attributes = { ...object.attributes } as Record<string, unknown>;
  const addReference = (name: string, type: string, id: string) => {
    if (!references.some((reference) => reference.name === name)) {
      references.push({ name, type, id });
    }
  };

  const meta = attributes.kibanaSavedObjectMeta as { searchSourceJSON?: string } | undefined;
  if (meta?.searchSourceJSON) {
    let source: SearchSource | undefined;
    try {
      source = JSON.parse(meta.searchSourceJSON) as SearchSource;
    } catch {
      source = undefined;
    }
    if (source && typeof source === 'object') {
      let changed = false;
      if (typeof source.index === 'string') {
        const name = 'kibanaSavedObjectMeta.searchSourceJSON.index';
        addReference(name, 'index-pattern', source.index);
        source.indexRefName = name;
        delete source.index;
        changed = true;
      }
      (source.filter ?? []).forEach((filter, at) => {
        if (filter?.meta && typeof filter.meta.index === 'string') {
          const name = `kibanaSavedObjectMeta.searchSourceJSON.filter[${at}].meta.index`;
          addReference(name, 'index-pattern', filter.meta.index);
          filter.meta.indexRefName = name;
          delete filter.meta.index;
          changed = true;
        }
      });
      if (changed) {
        attributes.kibanaSavedObjectMeta = { ...meta, searchSourceJSON: JSON.stringify(source) };
      }
    }
  }

  if (object.type === 'visualization' && typeof attributes.savedSearchId === 'string') {
    addReference('search_0', 'search', attributes.savedSearchId);
    attributes.savedSearchRefName = 'search_0';
    delete attributes.savedSearchId;
  }

  if (object.type === 'dashboard' && typeof attributes.panelsJSON === 'string') {
    let panels: Array<Record<string, unknown>> | undefined;
    try {
      panels = JSON.parse(attributes.panelsJSON) as Array<Record<string, unknown>>;
    } catch {
      panels = undefined;
    }
    if (Array.isArray(panels)) {
      let changed = false;
      panels.forEach((panel, at) => {
        if (typeof panel.id === 'string' && typeof panel.type === 'string' && !panel.panelRefName) {
          const name = `panel_${at}`;
          addReference(name, panel.type, panel.id);
          panel.panelRefName = name;
          delete panel.id;
          delete panel.type;
          changed = true;
        }
      });
      if (changed) attributes.panelsJSON = JSON.stringify(panels);
    }
  }

  return { ...object, attributes, references };
}

/** The title an object is listed under, whatever its type calls it */
export function titleOf(object: Pick<SavedObject, 'attributes' | 'type' | 'id'>): string {
  const { title, name } = object.attributes as { title?: unknown; name?: unknown };
  if (typeof title === 'string' && title) return title;
  if (typeof name === 'string' && name) return name;
  return `${object.type} [id=${object.id}]`;
}

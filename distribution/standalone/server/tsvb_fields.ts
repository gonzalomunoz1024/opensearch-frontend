/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The fields the TSVB editor lists: `/api/metrics/fields?index=<pattern>`, as the plugin of
 * OpenSearch Dashboards answers it. Only fields that can be aggregated on, without the nested
 * ones, once each; an empty pattern is the default index pattern's title. Any failure to read
 * them answers an empty list, as the plugin does.
 */

import { badRequest, type Router } from './http';
import { fieldsForWildcard, type FieldDescriptor } from './index_pattern_fields';
import type { OpenSearchClient } from './opensearch';
import type { SavedObjectsRepository } from './saved_objects';
import type { UiSettings } from './ui_settings';

/** The fields TSVB can use among those of a pattern, each name once, in the order they came */
export function tsvbFields(fields: FieldDescriptor[]): FieldDescriptor[] {
  const seen = new Set<string>();
  return fields.filter((field) => {
    if (!field.aggregatable || field.subType?.nested || seen.has(field.name)) return false;
    seen.add(field.name);
    return true;
  });
}

export function registerTsvbFields(router: Router, client: OpenSearchClient, repository: SavedObjectsRepository, uiSettings: UiSettings) {
  router.get('/api/metrics/fields', async ({ query }) => {
    const index = query.get('index');
    if (index === null) throw badRequest('[request query.index]: expected value of type [string] but got [undefined]');
    try {
      let pattern = index;
      if (!pattern) {
        const id = await uiSettings.peek<string | null>('defaultIndex', null);
        const found = id ? await repository.get('index-pattern', id) : undefined;
        const title = found?.attributes.title;
        pattern = typeof title === 'string' ? title : '';
      }
      return { body: tsvbFields(await fieldsForWildcard(client, pattern, [])) };
    } catch {
      return { body: [] };
    }
  });
}

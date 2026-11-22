/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The saved queries of the server, asked for as the data plugin of OpenSearch Dashboards asks:
 * a page of them to choose from, all of them to check a new title against, one by its id.
 */

import { parseSavedQuery, type SavedQuery, type SavedQueryAttributes } from '../lib/saved_query';
import type { SavedObjectsClient } from './saved_objects';

export type { SavedQuery, SavedQueryAttributes };

const TYPE = 'query';

export class SavedQueryService {
  constructor(private readonly savedObjects: SavedObjectsClient) {}

  /** Saves under the title, which is also the id; `overwrite` replaces the one of that title */
  async saveQuery(attributes: SavedQueryAttributes, { overwrite = false } = {}): Promise<SavedQuery> {
    if (!attributes.title.length) throw new Error('Cannot create saved query without a title');
    const stored: SavedQueryAttributes = {
      // A title with spaces around it would not be found again by the form's check
      title: attributes.title.trim(),
      description: attributes.description,
      query: {
        query:
          typeof attributes.query.query === 'string'
            ? attributes.query.query
            : JSON.stringify(attributes.query.query),
        language: attributes.query.language,
      },
    };
    if (attributes.filters) stored.filters = attributes.filters;
    if (attributes.timefilter) stored.timefilter = attributes.timefilter;
    const object = await this.savedObjects.create(TYPE, stored, { id: attributes.title, overwrite });
    return parseSavedQuery(object);
  }

  /** A page of saved queries, best matches of the text first; all of them when there is none */
  async findSavedQueries(search = '', perPage = 50, page = 1): Promise<{ total: number; queries: SavedQuery[] }> {
    const answer = await this.savedObjects.find({
      type: TYPE,
      search,
      searchFields: ['title^5', 'description'],
      sortField: '_score',
      perPage,
      page,
    });
    return { total: answer.total, queries: answer.saved_objects.map(parseSavedQuery) };
  }

  async getSavedQueryCount(): Promise<number> {
    const answer = await this.savedObjects.find({ type: TYPE, perPage: 1, page: 1 });
    return answer.total;
  }

  async getAllSavedQueries(): Promise<SavedQuery[]> {
    const count = await this.getSavedQueryCount();
    const answer = await this.savedObjects.find({ type: TYPE, perPage: count, page: 1 });
    return answer.saved_objects.map(parseSavedQuery);
  }

  async getSavedQuery(id: string): Promise<SavedQuery> {
    const [object] = await this.savedObjects.bulkGet([{ id, type: TYPE }]);
    if (!object) throw new Error(`Saved object [${TYPE}/${id}] not found`);
    if (object.error) throw new Error(object.error.message);
    return parseSavedQuery(object);
  }

  deleteSavedQuery(id: string): Promise<unknown> {
    return this.savedObjects.delete(TYPE, id);
  }
}

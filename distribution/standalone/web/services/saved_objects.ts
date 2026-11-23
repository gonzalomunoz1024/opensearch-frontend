/* SPDX-License-Identifier: Apache-2.0 */

/* The saved objects API of the server, which is OpenSearch Dashboards' own. */

import type {
  FindResponse,
  SavedObject,
  SavedObjectReference,
} from '../../common/saved_objects';
import type { Http } from './http';

export type { SavedObject, SavedObjectReference, FindResponse };

export interface FindOptions {
  type: string | string[];
  search?: string;
  searchFields?: string[];
  fields?: string[];
  page?: number;
  perPage?: number;
  sortField?: string;
  hasReference?: { type: string; id: string };
  /** How the words searched for combine; the server's default is OR */
  defaultSearchOperator?: 'AND' | 'OR';
}

export interface WriteOptions {
  id?: string;
  overwrite?: boolean;
  references?: SavedObjectReference[];
  version?: string;
}

const path = (type: string, id?: string) =>
  `/api/saved_objects/${encodeURIComponent(type)}${id ? `/${encodeURIComponent(id)}` : ''}`;

export class SavedObjectsClient {
  constructor(private readonly http: Http) {}

  find<A = Record<string, unknown>>(options: FindOptions): Promise<FindResponse<A>> {
    return this.http.get<FindResponse<A>>('/api/saved_objects/_find', {
      query: {
        type: ([] as string[]).concat(options.type),
        // As the original's client sends it: a caller that wants what starts with a word adds the `*`
        search: options.search || undefined,
        search_fields: options.searchFields,
        fields: options.fields,
        page: options.page ?? 1,
        per_page: options.perPage ?? 1000,
        sort_field: options.sortField,
        has_reference: options.hasReference ? JSON.stringify(options.hasReference) : undefined,
        default_search_operator: options.defaultSearchOperator,
      },
    });
  }

  get<A = Record<string, unknown>>(type: string, id: string): Promise<SavedObject<A>> {
    return this.http.get<SavedObject<A>>(path(type, id));
  }

  async bulkGet<A = Record<string, unknown>>(
    objects: Array<{ type: string; id: string }>
  ): Promise<Array<SavedObject<A> & { error?: { statusCode: number; message: string } }>> {
    if (objects.length === 0) return [];
    const answer = await this.http.post<{
      saved_objects: Array<SavedObject<A> & { error?: { statusCode: number; message: string } }>;
    }>('/api/saved_objects/_bulk_get', { body: objects });
    return answer.saved_objects;
  }

  create<A = Record<string, unknown>>(
    type: string,
    attributes: A,
    options: WriteOptions = {}
  ): Promise<SavedObject<A>> {
    return this.http.post<SavedObject<A>>(path(type, options.id), {
      query: { overwrite: options.overwrite ? true : undefined },
      body: { attributes, references: options.references ?? [] },
    });
  }

  update<A = Record<string, unknown>>(
    type: string,
    id: string,
    attributes: Partial<A>,
    options: WriteOptions = {}
  ): Promise<SavedObject<A>> {
    return this.http.put<SavedObject<A>>(path(type, id), {
      body: { attributes, references: options.references, version: options.version },
    });
  }

  delete(type: string, id: string): Promise<unknown> {
    return this.http.delete(path(type, id));
  }
}

/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The values a field holds that start with a text, which the filter editor offers:
 * `POST /api/opensearch-dashboards/suggestions/values/<index pattern title>` with
 * `{ query, field, boolFilter }`, as the data plugin of OpenSearch Dashboards answers it
 * (value_suggestions_route.ts). The terms of the field that start with the text, in at most a
 * second and 100000 documents a shard; a nested field is asked under its path.
 */

import { badRequest, HttpError, type Router } from './http';
import { legacyMessage } from './legacy_client';
import { OpenSearchError, type OpenSearchClient } from './opensearch';
import type { SavedObjectsRepository } from './saved_objects';

/** The original's settings `opensearchDashboards.autocompleteTimeout` and `autocompleteTerminateAfter` */
const AUTOCOMPLETE_TIMEOUT = '1000ms';
const AUTOCOMPLETE_TERMINATE_AFTER = 100000;

export interface SuggestionField {
  name: string;
  subType?: { nested?: { path: string } };
}

/** A text as the start of a regular expression of OpenSearch: what it means is escaped */
export const escapeSuggestionQuery = (query = '') => query.replace(/[.?+*|{}[\]()"\\#@&<>~]/g, (match) => `\\${match}`);

/** The request that asks for the values (getBody) */
export function valueSuggestionsBody(field: SuggestionField | string, query: string, boolFilter: unknown = []) {
  const name = typeof field === 'string' ? field : field.name;
  const body = {
    size: 0,
    timeout: AUTOCOMPLETE_TIMEOUT,
    terminate_after: AUTOCOMPLETE_TERMINATE_AFTER,
    query: { bool: { filter: boolFilter } },
    aggs: {
      suggestions: {
        terms: {
          field: name,
          // Only what starts with the text, and not read eagerly against all the terms
          include: `${escapeSuggestionQuery(query)}.*`,
          execution_hint: 'map',
          shard_size: 10,
        },
      },
    },
  };
  const nested = typeof field === 'string' ? undefined : field.subType?.nested;
  if (!nested) return body;
  return { ...body, aggs: { nestedSuggestions: { nested: { path: nested.path }, aggs: body.aggs } } };
}

interface SuggestionsAnswer {
  aggregations?: {
    suggestions?: { buckets?: Array<{ key: unknown }> };
    nestedSuggestions?: { suggestions?: { buckets?: Array<{ key: unknown }> } };
  };
}

/** The values of an answer: the keys of its buckets */
export function suggestedValues(answer: SuggestionsAnswer): unknown[] {
  const buckets = answer.aggregations?.suggestions?.buckets ?? answer.aggregations?.nestedSuggestions?.suggestions?.buckets;
  return (buckets ?? []).map((bucket) => bucket.key);
}

/** The field of an index pattern saved with its fields, by name (getFieldByName) */
function savedField(fields: unknown, name: string): SuggestionField | undefined {
  if (typeof fields !== 'string') return undefined;
  try {
    const list = JSON.parse(fields) as unknown;
    if (!Array.isArray(list)) return undefined;
    return list.find((field): field is SuggestionField => Boolean(field) && (field as SuggestionField).name === name);
  } catch {
    return undefined;
  }
}

export function registerValueSuggestions(router: Router, client: OpenSearchClient, repository: SavedObjectsRepository) {
  router.post('/api/opensearch-dashboards/suggestions/values/{index}', async ({ params, json }) => {
    const body = await json<{ field?: unknown; query?: unknown; boolFilter?: unknown }>();
    if (!body || typeof body.field !== 'string') {
      throw badRequest(`[request body.field]: expected value of type [string] but got [${typeOf(body?.field)}]`);
    }
    if (typeof body.query !== 'string') {
      throw badRequest(`[request body.query]: expected value of type [string] but got [${typeOf(body.query)}]`);
    }
    const { index } = params;
    // The index pattern of that title, as the original finds it: the first a search of titles finds
    const found = await repository.find({ type: ['index-pattern'], fields: ['fields'], search: `"${index}"`, searchFields: ['title'] });
    const pattern = found.saved_objects[0];
    const field = pattern ? savedField(pattern.attributes.fields, body.field) : undefined;
    try {
      const answer = await client.request<SuggestionsAnswer>({
        method: 'POST',
        path: `/${encodeURIComponent(index)}/_search`,
        body: valueSuggestionsBody(field ?? body.field, body.query, body.boolFilter ?? []),
      });
      return { body: suggestedValues(answer) };
    } catch (error) {
      // Worded as the legacy client the original asks with words a refusal
      const message =
        error instanceof OpenSearchError ? legacyMessage(error.status, error.body) : error instanceof Error ? error.message : String(error);
      throw new HttpError(500, message);
    }
  });
}

const typeOf = (value: unknown) => (value === null ? 'null' : Array.isArray(value) ? 'Array' : typeof value);

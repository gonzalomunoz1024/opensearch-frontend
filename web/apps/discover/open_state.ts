/* SPDX-License-Identifier: Apache-2.0 */

/*
 * What Discover opens with: the query and the page's filters as the original's loadSavedSearch
 * (use_search.ts) chooses them when the page opens and when another saved search is opened. The
 * page then writes them into the address and makes the query's language the user's.
 */

import type { Filter, Query } from '../../lib/types';

export interface OpeningAddress {
  /** The query the address holds: `_q`'s, or an older address's `_a.query` */
  query?: unknown;
  /** The page's filters the address holds, as they are */
  filters?: unknown;
  /** Whether the address holds the query's state at all (`_q`) */
  hasQueryState: boolean;
}

export interface OpeningSaved {
  query?: Query | null;
  filters: Filter[];
}

/**
 * The query and filters Discover opens with. A query with no text is the default one, whatever
 * language the address gives it: the saved search's query, or no text in `defaultLanguage` (the
 * language chosen last, or the setting's). An address without the query's state takes the saved
 * search's query and filters; one with it keeps its filters.
 */
export function openingQueryState(
  address: OpeningAddress,
  saved: OpeningSaved | undefined,
  defaultLanguage: string
): { query: Query; filters: unknown } {
  const defaultQuery: Query = { query: '', language: defaultLanguage };
  const fromAddress = isQuery(address.query) ? address.query : undefined;
  const savedQuery = saved?.query ?? undefined;
  const text: unknown = fromAddress?.query;
  let query: Query = fromAddress && text !== undefined && text !== '' ? fromAddress : savedQuery ?? defaultQuery;
  if (!address.hasQueryState && savedQuery) query = savedQuery;
  const filters = address.hasQueryState ? address.filters ?? [] : saved?.filters ?? [];
  return { query, filters };
}

function isQuery(value: unknown): value is Query {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

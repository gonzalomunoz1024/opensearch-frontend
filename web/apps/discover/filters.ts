/* SPDX-License-Identifier: Apache-2.0 */

/* The filters Discover's buttons make, as the original's generateFilters makes them. */

import { existsFilter, phraseFilter } from '../../lib/query';
import type { Filter } from '../../lib/types';

/**
 * The filters of an address as the original's Discover takes them: a list, of which what is not
 * an object is left out, and an object without its meta is given an empty one, as the original's
 * mapFilter gives it; nothing for what is not a list
 */
export function filtersOf(value: unknown): Filter[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null && !Array.isArray(item))
    .map((item) => (typeof item.meta === 'object' && item.meta !== null ? item : { ...item, meta: {} }) as Filter);
}

/** The field a filter is made for: the index pattern's own, so that a scripted one carries its script */
export type FilterFieldOf = Parameters<typeof phraseFilter>[0];

/**
 * The filter for a value of a field, or against it with negate: a phrase, or for a value that is
 * not there (null in the document) the field's absence, and its presence when filtered out, as
 * the original writes it. In the pinned filters when filters:pinnedByDefault asks.
 */
export function valueFilter(field: FilterFieldOf, value: unknown, negate: boolean, indexId: string, pinned: boolean): Filter {
  const absent = value === null || value === undefined;
  const filter = absent ? existsFilter(field, indexId) : phraseFilter(field, value, indexId);
  filter.meta.negate = absent ? !negate : negate;
  if (pinned) filter.$state = { store: 'globalState' };
  return filter;
}

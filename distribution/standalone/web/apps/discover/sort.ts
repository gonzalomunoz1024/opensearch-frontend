/* SPDX-License-Identifier: Apache-2.0 */

import type { SortPair } from './doc_table';

/** A sort as pairs, from any of the forms it has been saved in */
export function normalizeSort(sort: unknown): SortPair[] {
  if (!Array.isArray(sort) || sort.length === 0) return [];
  if (typeof sort[0] === 'string') {
    return sort.length >= 2 ? [[sort[0], sort[1] === 'asc' ? 'asc' : 'desc']] : [];
  }
  return (sort as unknown[])
    .filter((pair): pair is [string, string] => Array.isArray(pair) && typeof pair[0] === 'string')
    .map(([field, direction]) => [field, direction === 'asc' ? 'asc' : 'desc']);
}

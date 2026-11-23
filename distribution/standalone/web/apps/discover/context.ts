/* SPDX-License-Identifier: Apache-2.0 */

/*
 * What the page of a document among its neighbours works out, as the original's context view: the
 * field that breaks a tie of times, how many documents each side asks for, and its searches.
 */

import type { RawHit } from '../../lib/docs';
import type { BoolQuery } from '../../lib/query';
import type { IndexPattern } from '../../lib/types';
import { isSortable } from './doc_table';

/** The most documents a side may ask for, OpenSearch's default limit, and the fewest */
export const MAX_CONTEXT_SIZE = 10000;
export const MIN_CONTEXT_SIZE = 0;

/** Fields a search can sort on that no index pattern lists */
const SORTABLE_META_FIELDS = ['_seq_no', '_doc', '_uid'];

export type ContextSide = 'predecessors' | 'successors';

/**
 * The original's getFirstSortableField: the first name of the setting context:tieBreakerFields
 * that a search can sort on, none when no name can be
 */
export function tieBreakerField(indexPattern: IndexPattern, names: unknown): string | undefined {
  const list = Array.isArray(names) ? names.map(String) : [];
  return list.find(
    (name) =>
      SORTABLE_META_FIELDS.includes(name) ||
      isSortable(
        indexPattern.fields.find((field) => field.name === name),
        name
      )
  );
}

/** A count the original takes: from none to OpenSearch's limit (a count not a number is none of them) */
export function isValidCount(value: number): boolean {
  return value >= MIN_CONTEXT_SIZE && value <= MAX_CONTEXT_SIZE;
}

/**
 * What a side's count field holds once a count is typed in: a 0 puts the count back at once, as
 * the original's action bar does, unless the count is 0 already
 */
export function typedCount(typed: number | undefined, count: number): number | undefined {
  return typed === 0 && count !== 0 ? count : typed;
}

/** The count a side asks for once its "Load" button is pressed, or none past the limit */
export function loadMoreCount(count: number, step: number): number | undefined {
  const next = count + step;
  return isValidCount(next) ? next : undefined;
}

/** A count of the address, or the setting context:defaultSize, read as the original parses them */
export function contextCount(value: unknown, fallback: unknown): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (Number.isFinite(parsed)) return parsed;
  const byDefault = Number.parseInt(String(fallback), 10);
  return Number.isFinite(byDefault) ? byDefault : 5;
}

/** The search for the document the page is about, sorted as its neighbours are */
export function anchorRequest(id: string, timeField: string, tieBreaker: string): Record<string, unknown> {
  return {
    size: 1,
    query: { bool: { must: [{ constant_score: { filter: { ids: { values: [id] } } } }] } },
    sort: [{ [timeField]: 'desc' }, { [tieBreaker]: 'desc' }],
  };
}

/**
 * The search for the documents on one side of the anchor: the newer ones (predecessors) sorted
 * from the anchor up, the older ones (successors) from it down, each after the anchor's sort values
 * and without the anchor itself, with the page's filters
 */
export function surroundingRequest(
  side: ContextSide,
  anchor: RawHit,
  timeField: string,
  tieBreaker: string,
  size: number,
  filterQuery: BoolQuery
): Record<string, unknown> {
  const direction = side === 'successors' ? 'desc' : 'asc';
  const sortValues = anchor.sort ?? [];
  return {
    size,
    query: {
      bool: {
        ...filterQuery.bool,
        must_not: [...filterQuery.bool.must_not, { ids: { values: [anchor._id] } }],
      },
    },
    search_after: [sortValues[0], sortValues[1]],
    sort: [{ [timeField]: direction }, { [tieBreaker]: direction }],
  };
}

/** The rows of the page: the newer documents above the anchor, newest first, the older ones under it */
export function contextRows(predecessors: RawHit[], anchor: RawHit | undefined, successors: RawHit[]): RawHit[] {
  return [...[...predecessors].reverse(), ...(anchor ? [anchor] : []), ...successors];
}

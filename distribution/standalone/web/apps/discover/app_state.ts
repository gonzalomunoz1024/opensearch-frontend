/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Discover's own state in the address: `_a` (the columns, the sort, the interval, the index
 * pattern) and `_q` (the query and the page's filters). The time and the pinned filters, `_g`, are
 * the shell's.
 */

import { encodeState } from '../../lib/url';
import { setHashParams } from '../../router';
import { toggledColumns, type SortPair } from './doc_table';

/** What the original's `_a` holds: its discover slice, and the data explorer's metadata */
export interface DiscoverAppState {
  columns: unknown;
  sort: unknown;
  interval?: string;
  /** A column was taken out or the columns reordered since the saved search was opened or saved */
  isDirty: boolean;
  savedQuery?: string;
  /** The saved search the state started from */
  savedSearch?: string;
  indexPattern?: string;
}

/** The `_a` of a state, as the original writes it */
export function appStateParam(state: DiscoverAppState): string {
  return encodeState({
    discover: {
      columns: state.columns,
      interval: state.interval,
      isDirty: state.isDirty,
      savedQuery: state.savedQuery,
      savedSearch: state.savedSearch,
      sort: state.sort,
    },
    metadata: { indexPattern: state.indexPattern, view: 'discover' },
  });
}

/**
 * The state Discover opens with when the address has none, as the original's preloaded state: a
 * saved search's columns, sort and id, or else the columns of the setting defaultColumns and no
 * sort; clean; the saved search's index pattern, or else the default one.
 */
export function openingAppState(
  saved: { id: string; columns?: unknown; sort?: unknown; indexId?: string } | undefined,
  defaultColumns: unknown,
  defaultIndexPattern: string | undefined
): DiscoverAppState {
  if (saved) {
    return {
      columns: saved.columns ?? [],
      sort: saved.sort ?? [],
      isDirty: false,
      savedSearch: saved.id,
      indexPattern: saved.indexId,
    };
  }
  return { columns: defaultColumns, sort: [], isDirty: false, indexPattern: defaultIndexPattern };
}

/**
 * A column added or taken out, as the original's reducers change the state: one added leaves the
 * sort alone; one taken out takes its sort with it and makes the state differ from the saved
 * search's (isDirty). Moving a column changes neither.
 */
export function columnToggled(
  columns: string[],
  sort: SortPair[],
  name: string
): { columns: string[]; sort?: SortPair[]; isDirty?: boolean } {
  const next = toggledColumns(columns, name);
  if (!columns.includes(name)) return { columns: next };
  return { columns: next, sort: sort.filter(([field]) => field !== name), isDirty: true };
}

/**
 * Writes Discover's state into the address in place, as the original's does (its `_a` and `_q`
 * replace the entry of the history): Back leaves the page, it does not undo a sort, a column, an
 * interval, a query or a filter.
 */
export function writeDiscoverState(changes: { _a?: string; _q?: string }) {
  setHashParams(changes, { replace: true });
}

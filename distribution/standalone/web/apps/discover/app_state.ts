/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Discover's own state in the address: `_a` (the columns, the sort, the interval, the index
 * pattern) and `_q` (the query and the page's filters). The time and the pinned filters, `_g`, are
 * the shell's.
 */

import { setHashParams } from '../../router';

/**
 * Writes Discover's state into the address in place, as the original's does (its `_a` and `_q`
 * replace the entry of the history): Back leaves the page, it does not undo a sort, a column, an
 * interval, a query or a filter.
 */
export function writeDiscoverState(changes: { _a?: string; _q?: string }) {
  setHashParams(changes, { replace: true });
}

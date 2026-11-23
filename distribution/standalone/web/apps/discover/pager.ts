/* SPDX-License-Identifier: Apache-2.0 */

/*
 * How the document table counts its rows, as OpenSearch Dashboards' table does: on a dashboard
 * the rows come in pages of 50 under a pager; on Discover 10 rows are drawn at once and more
 * follow, ten at a time while the page keeps up, as the end of the table comes into view.
 */

/** The rows of one page of a saved search on a dashboard */
export const PAGE_SIZE = 50;
/** The rows Discover draws at once, and adds each time the end of its table comes into view */
export const SCROLL_STEP = 10;
/** How many rows Discover means to have drawn ahead of the ones in view */
export const SCROLL_LOOKAHEAD = 5 * SCROLL_STEP;

/** The pages a pager shows at most between its first and its last page */
const VISIBLE_PAGES = 5;
const AROUND_ACTIVE = Math.floor(VISIBLE_PAGES / 2);

export function pageCountOf(rowCount: number, pageSize = PAGE_SIZE): number {
  return Math.ceil(rowCount / pageSize);
}

/** The rows of a page, from the first to the one after the last */
export function rowsOfPage(page: number, rowCount: number, pageSize = PAGE_SIZE): { startRow: number; endRow: number } {
  const startRow = page * pageSize;
  return { startRow, endRow: Math.min(rowCount, startRow + pageSize) };
}

/** A button of the pager, or the ellipsis that stands for the pages it leaves out */
export type PagerItem = { kind: 'page'; page: number } | { kind: 'gap'; label: string };

/**
 * The pages a pager offers, as the component library's pager lays them out: five around the
 * active one, the first and the last, and an ellipsis for each run of pages left out (a run of
 * one page shows that page instead).
 */
export function pagerItems(activePage: number, pageCount: number): PagerItem[] {
  const first = Math.max(0, Math.min(activePage - AROUND_ACTIVE, pageCount - VISIBLE_PAGES));
  const last = Math.min(pageCount, first + VISIBLE_PAGES);
  const items: PagerItem[] = [];
  if (first > 0) {
    items.push({ kind: 'page', page: 0 });
    if (first === 2) items.push({ kind: 'page', page: 1 });
    else if (first > 1) items.push({ kind: 'gap', label: `Skipping pages 2 to ${first}` });
  }
  for (let page = first; page < last; page += 1) items.push({ kind: 'page', page });
  if (last < pageCount) {
    if (last + 1 === pageCount - 1) items.push({ kind: 'page', page: last });
    else if (last < pageCount - 1) items.push({ kind: 'gap', label: `Skipping pages ${last + 1} to ${pageCount - 1}` });
    items.push({ kind: 'page', page: pageCount - 1 });
  }
  return items;
}

/** What the arrows of a pager say, and whether they lead anywhere */
export function pagerArrows(activePage: number, pageCount: number) {
  const atFirst = activePage === 0;
  const atLast = activePage === pageCount - 1;
  return {
    previous: { label: atFirst ? 'Previous page' : `Previous page, ${activePage}`, disabled: atFirst },
    next: { label: atLast ? 'Next page' : `Next page, ${activePage + 2}`, disabled: atLast },
  };
}

/** The count beside the pager: "1–50 of 1616" (no separator, as the original writes it), and whether the search was cut short */
export function pagerSummary(startRow: number, endRow: number, hits: number | undefined, sampleSize: number) {
  const startItem = startRow + 1;
  return {
    text: `${startItem}–${endRow} of ${hits ?? 0}`,
    limited: endRow >= sampleSize,
  };
}

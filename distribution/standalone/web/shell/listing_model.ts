/* SPDX-License-Identifier: Apache-2.0 */

/* How the original's list of saved objects orders and pages what it shows. */

const PAGES_SHOWN = 5;
const AROUND = Math.floor(PAGES_SHOWN / 2);

/** Text compared as the original compares it: by its code points, capitals before small letters */
export function compareAsOriginal(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The original's choice of page sizes: 10, 20, 50 and the default, ordered as text */
export function pageSizeOptions(initial: number): number[] {
  return [...new Set([10, 20, 50, initial])].sort((a, b) => compareAsOriginal(String(a), String(b)));
}

/** The page buttons the original's pagination shows: up to five, with the first and the last */
export function pageButtons(page: number, pages: number): Array<number | 'gap'> {
  const first = Math.max(0, Math.min(page - AROUND, pages - PAGES_SHOWN));
  const last = Math.min(pages, first + PAGES_SHOWN);
  const shown: Array<number | 'gap'> = [];
  if (first > 0) {
    shown.push(0);
    if (first === 2) shown.push(1);
    else if (first > 2) shown.push('gap');
  }
  for (let index = first; index < last; index += 1) shown.push(index);
  if (last < pages) {
    if (last + 1 === pages - 1) shown.push(last);
    else if (last < pages - 1) shown.push('gap');
    shown.push(pages - 1);
  }
  return shown;
}

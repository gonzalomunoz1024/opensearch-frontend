/* SPDX-License-Identifier: Apache-2.0 */

/* How the original's list of saved objects orders what it shows, and the page sizes it offers. */

/** Text compared as the original compares it: by its code points, capitals before small letters */
export function compareAsOriginal(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Two values of a column as the original's table compares them: one that is missing after every
 * other, before them once the order is turned round
 */
export function compareListed(a: string | undefined, b: string | undefined): number {
  if (a === undefined) return b === undefined ? 0 : 1;
  if (b === undefined) return -1;
  return compareAsOriginal(a, b);
}

/** The original's choice of page sizes: 10, 20, 50 and the default, ordered as text */
export function pageSizeOptions(initial: number): number[] {
  return [...new Set([10, 20, 50, initial])].sort((a, b) => compareAsOriginal(String(a), String(b)));
}

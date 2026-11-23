/* SPDX-License-Identifier: Apache-2.0 */

/* How the original's list of saved objects orders what it shows, and the page sizes it offers. */

/** Text compared as the original compares it: by its code points, capitals before small letters */
export function compareAsOriginal(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The original's choice of page sizes: 10, 20, 50 and the default, ordered as text */
export function pageSizeOptions(initial: number): number[] {
  return [...new Set([10, 20, 50, initial])].sort((a, b) => compareAsOriginal(String(a), String(b)));
}

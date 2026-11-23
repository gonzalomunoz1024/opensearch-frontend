/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The list of completions of the SQL editor while it is open, as Ace's language tools run it:
 * when it opens, how it follows what is typed and where the cursor goes, what its keys do, and
 * what choosing a row puts into the text.
 */

import type { EditKind, TextEdit } from './editing';
import { completionPrefix, completionsDone, openCompletions, type CompletionList } from './model';

/** The rows the list shows at once */
export const LIST_ROWS = 8;

export interface Listed {
  /** What the list offers; filtering it again changes it in place */
  list: CompletionList;
  /** Where the word the list is for begins */
  base: number;
  /** The row chosen: a list that is open always has one */
  row: number;
}

/** A new list for the word before the cursor; none when it has nothing worth showing */
export function openList(text: string, cursor: number): Listed | undefined {
  const list = openCompletions(text, cursor);
  if (completionsDone(list)) return undefined;
  return { list, base: cursor - list.filterText.length, row: 0 };
}

/**
 * The open list once the cursor has moved or the text has changed: the same list when the word is
 * the same, fewer rows with the first chosen when it is not, and none when the cursor is out of
 * the word's line or before its start, when nothing matches any more, when the one match is the
 * word, when no word is left, and after Backspace with no word before the cursor.
 */
export function followList(
  listed: Listed,
  text: string,
  cursor: number,
  backspace = false
): Listed | undefined {
  if (backspace && !completionPrefix(text, cursor)) return undefined;
  if (cursor < listed.base || text.slice(listed.base, cursor).includes('\n')) return undefined;
  const prefix = text.slice(listed.base, cursor);
  if (prefix === listed.list.filterText) return listed;
  listed.list.setFilter(prefix);
  if (completionsDone(listed.list) || !prefix) return undefined;
  return { ...listed, row: 0 };
}

/**
 * The list after a key changed the text: it follows when it is open, and opens after a character
 * typed when a word ends at the cursor.
 */
export function listAfterEdit(
  listed: Listed | undefined,
  text: string,
  cursor: number,
  kind: EditKind
): Listed | undefined {
  if (listed) return followList(listed, text, cursor, kind === 'backspace');
  return kind === 'insert' && completionPrefix(text, cursor) ? openList(text, cursor) : undefined;
}

/**
 * What a key does to the open list, by the name Ace binds it under (`Ctrl-ArrowUp`): another row,
 * the list closed, or a row to put into the text. Undefined for a key that is not the list's.
 * The arrows go round from one end to the other; a page is a row fewer than the list shows.
 */
export function listKey(
  listed: Listed,
  name: string
): { listed?: Listed; insert?: number } | undefined {
  const last = listed.list.filtered.length - 1;
  const page = Math.max(1, Math.min(LIST_ROWS, last + 1) - 1);
  const at = (row: number) => ({ listed: { ...listed, row } });
  switch (name) {
    case 'ArrowUp':
      return at(listed.row <= 0 ? last : listed.row - 1);
    case 'ArrowDown':
      return at(listed.row >= last ? 0 : listed.row + 1);
    case 'Ctrl-ArrowUp':
    case 'Ctrl-Home':
      return at(0);
    case 'Ctrl-ArrowDown':
    case 'Ctrl-End':
      return at(last);
    case 'PageUp':
      return at(Math.max(0, listed.row - page));
    case 'PageDown':
      return at(Math.min(last, listed.row + page));
    case 'Escape':
      return {};
    case 'Enter':
    case 'Shift-Enter':
    case 'Tab':
      return { insert: listed.row };
    default:
      return undefined;
  }
}

/** A row put into the text: in place of the letters typed and of what is selected */
export function insertCompletion(
  listed: Listed,
  row: number,
  text: string,
  start: number,
  end: number
): TextEdit | undefined {
  const item = listed.list.filtered[row];
  if (!item) return undefined;
  const from = Math.max(0, start - listed.list.filterText.length);
  const cursor = from + item.value.length;
  return {
    text: `${text.slice(0, from)}${item.value}${text.slice(end)}`,
    start: cursor,
    end: cursor,
  };
}

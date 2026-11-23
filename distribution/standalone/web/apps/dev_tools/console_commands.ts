/* SPDX-License-Identifier: Apache-2.0 */

/*
 * What the keys of a console editor do, as the commands and the selection of Ace 1.2.9 (brace
 * 0.11.1, which OpenSearch Dashboards draws its console with) do it: the cursor moved by
 * characters, words, screen rows and pages, out of folds and over soft tabs; the lines a selection
 * touches removed, moved, copied, indented and outdented; and the undo of what was typed, a word at
 * a time. Everything here works on the text and the screen worked out by console_layout, so that
 * it costs what one line costs whatever the length of the text.
 */

import { TAB_SIZE, comparePositions, foldDisplayText, type Position, type ScreenLayout } from './console_layout';

export interface TextRange {
  start: Position;
  end: Position;
}

/** The text of an editor and its screen */
export interface CommandDoc {
  lines: string[];
  layout: ScreenLayout;
}

// --- Words, as Ace's text mode knows them --------------------------------------------------------------

const WORD_CLASS = '\\p{L}\\p{Mn}\\p{Mc}\\p{Nd}\\p{Pc}\\$_';
const TOKEN_RE = new RegExp(`^[${WORD_CLASS}]+`, 'u');
const TOKEN_CHAR = new RegExp(`^[${WORD_CLASS}]`, 'u');
const NON_TOKEN_CHAR = new RegExp(`^(?:[^${WORD_CLASS}]|\\s)`, 'u');
const SPACE = /\s/;

/** Where a word typed from the start of a text ends, as Ace counts a short word ($shortWordEndIndex) */
export function shortWordEndIndex(text: string): number {
  const match = TOKEN_RE.exec(text);
  if (match) return match[0].length;
  let index = 0;
  while (index < text.length && SPACE.test(text[index])) index += 1;
  if (index < 1) {
    while (index < text.length && !TOKEN_CHAR.test(text[index])) {
      const ch = text[index];
      index += 1;
      if (SPACE.test(ch)) {
        if (index > 2) {
          index -= 1;
          break;
        }
        while (index < text.length && SPACE.test(text[index])) index += 1;
        if (index > 2) break;
      }
    }
  }
  return index;
}

const reverse = (text: string) => text.split('').reverse().join('');

/** The word around a place, or the run of spaces or of other characters there (Ace's getWordRange) */
export function wordRange(lines: string[], row: number, column: number): TextRange {
  const line = lines[row] ?? '';
  let inToken = column > 0 && TOKEN_CHAR.test(line.charAt(column - 1));
  if (!inToken) inToken = TOKEN_CHAR.test(line.charAt(column));
  const re = inToken ? TOKEN_CHAR : /^\s+$/.test(line.slice(column - 1, column + 1)) ? SPACE : NON_TOKEN_CHAR;
  let start = column;
  if (start > 0) {
    do start -= 1;
    while (start >= 0 && line.charAt(start) && re.test(line.charAt(start)));
    start += 1;
  }
  let end = column;
  while (end < line.length && re.test(line.charAt(end))) end += 1;
  return { start: { row, column: start }, end: { row, column: end } };
}

// --- The cursor ----------------------------------------------------------------------------------------

/** A place clipped to the text (Ace's Anchor.$clipPositionToDocument) */
export function clipPosition(lines: string[], row: number, column: number): Position {
  if (row >= lines.length) {
    const last = Math.max(0, lines.length - 1);
    return { row: last, column: column < 0 ? 0 : (lines[last] ?? '').length };
  }
  if (row < 0) return { row: 0, column: 0 };
  return { row, column: Math.min((lines[row] ?? '').length, Math.max(0, column)) };
}

/**
 * Where the cursor goes when it is put at a place (Ace's moveCursorTo): to the start of a fold it
 * would be in, and not between the two halves of a character outside the basic plane
 */
export function placeCursor(doc: CommandDoc, row: number, column: number, lead?: Position): Position {
  const fold = doc.layout.foldAt(row, column, 1);
  if (fold) {
    row = fold.start.row;
    column = fold.start.column;
  }
  const line = doc.lines[row] ?? '';
  if (/[\uDC00-\uDFFF]/.test(line.charAt(column)) && line.charAt(column - 1)) {
    column = lead && lead.row === row && lead.column === column + 1 ? column - 1 : column + 1;
  }
  return clipPosition(doc.lines, row, column);
}

/** Whether a step would go into the spaces of a soft tab (Ace's wouldMoveIntoSoftTab) */
function intoSoftTab(doc: CommandDoc, cursor: Position, direction: -1 | 1): boolean {
  const start = direction < 0 ? cursor.column - TAB_SIZE : cursor.column;
  const end = direction < 0 ? cursor.column : cursor.column + TAB_SIZE;
  return cursor.column % TAB_SIZE === 0 && (doc.lines[cursor.row] ?? '').slice(Math.max(0, start), end).split(' ').length - 1 === TAB_SIZE;
}

/**
 * The cursor moved by screen rows or by characters (Ace's moveCursorBy). Going up or down keeps
 * the column it started from, until the cursor is moved another way.
 */
export function moveBy(doc: CommandDoc, lead: Position, rows: number, chars: number, desired?: number): { position: Position; desired?: number } {
  const screen = doc.layout.documentToScreen(lead.row, lead.column);
  let column = screen.column;
  let keep: number | undefined;
  if (chars === 0) {
    if (desired) column = desired;
    keep = desired || screen.column;
  }
  const place = doc.layout.screenToDocument(screen.row + rows, column);
  return { position: placeCursor(doc, place.row, place.column + chars, lead), desired: keep };
}

export function moveLeft(doc: CommandDoc, lead: Position): Position {
  const fold = doc.layout.foldAt(lead.row, lead.column, -1);
  if (fold) return placeCursor(doc, fold.start.row, fold.start.column, lead);
  if (lead.column === 0) return lead.row > 0 ? placeCursor(doc, lead.row - 1, doc.lines[lead.row - 1].length, lead) : lead;
  return moveBy(doc, lead, 0, intoSoftTab(doc, lead, -1) ? -TAB_SIZE : -1).position;
}

export function moveRight(doc: CommandDoc, lead: Position): Position {
  const fold = doc.layout.foldAt(lead.row, lead.column, 1);
  if (fold) return placeCursor(doc, fold.end.row, fold.end.column, lead);
  if (lead.column === (doc.lines[lead.row] ?? '').length) {
    return lead.row < doc.lines.length - 1 ? placeCursor(doc, lead.row + 1, 0, lead) : lead;
  }
  return moveBy(doc, lead, 0, intoSoftTab(doc, lead, 1) ? TAB_SIZE : 1).position;
}

/** Home: the first character of the screen row that is not a space, or its start when already there */
export function moveLineStart(doc: CommandDoc, lead: Position): Position {
  const screenRow = doc.layout.documentToScreen(lead.row, lead.column).row;
  const first = doc.layout.screenToDocument(screenRow, 0);
  const foldLine = doc.layout.foldLineAt(lead.row);
  let beforeCursor: string;
  if (foldLine) {
    const whole = foldDisplayText(doc.lines, foldLine, lead.row, doc.lines[lead.row].length);
    const skipped = foldDisplayText(doc.lines, foldLine, first.row, first.column).length;
    beforeCursor = whole.substring(skipped);
  } else {
    beforeCursor = doc.lines[lead.row].substring(first.column);
  }
  const leading = /^\s*/.exec(beforeCursor)?.[0].length ?? 0;
  const column = leading !== lead.column ? first.column + leading : first.column;
  return placeCursor(doc, first.row, column, lead);
}

/** End: the end of the screen row, then the end of the text before the spaces the line ends with */
export function moveLineEnd(doc: CommandDoc, lead: Position): Position {
  const screenRow = doc.layout.documentToScreen(lead.row, lead.column).row;
  const end = doc.layout.screenToDocument(screenRow, Number.MAX_VALUE / 10);
  if (lead.column === end.column) {
    const line = doc.lines[end.row];
    if (end.column === line.length) {
      const textEnd = line.search(/\s+$/);
      if (textEnd > 0) end.column = textEnd;
    }
  }
  return placeCursor(doc, end.row, end.column, lead);
}

export function moveWordRight(doc: CommandDoc, lead: Position): Position {
  let row = lead.row;
  let column = lead.column;
  const fold = doc.layout.foldAt(row, column, 1);
  if (fold) return placeCursor(doc, fold.end.row, fold.end.column, lead);
  const line = doc.lines[row];
  let right = line.substring(column);
  if (column === line.length) {
    do {
      row += 1;
      right = doc.lines[row] ?? '';
    } while (row < doc.lines.length && /^\s*$/.test(right));
    if (!/^\s+/.test(right)) right = '';
    column = 0;
  }
  return placeCursor(doc, row, column + shortWordEndIndex(right), lead);
}

export function moveWordLeft(doc: CommandDoc, lead: Position): Position {
  let row = lead.row;
  let column = lead.column;
  const fold = doc.layout.foldAt(row, column, -1);
  if (fold) return placeCursor(doc, fold.start.row, fold.start.column, lead);
  let line = doc.lines[row].substring(0, column);
  if (column === 0) {
    do {
      row -= 1;
      line = doc.lines[row] ?? '';
    } while (row > 0 && /^\s*$/.test(line));
    column = line.length;
    if (!/\s+$/.test(line)) line = '';
  }
  return placeCursor(doc, row, column - shortWordEndIndex(reverse(line)), lead);
}

/** The whole lines of a row, the lines of its fold with it (Ace's getLineRange) */
export function lineRange(doc: CommandDoc, row: number, excludeLastChar = false): TextRange {
  const foldLine = doc.layout.foldLineAt(row);
  const first = foldLine ? foldLine.first : row;
  const last = foldLine ? foldLine.last : row;
  return excludeLastChar
    ? { start: { row: first, column: 0 }, end: { row: last, column: doc.lines[last].length } }
    : { start: { row: first, column: 0 }, end: { row: last + 1, column: 0 } };
}

/** The rows a selection takes, a row it ends at the start of left out, folds taken whole (Ace's $getSelectedRows) */
export function selectedRows(doc: CommandDoc, range: TextRange): { first: number; last: number } {
  const lastRow = range.end.column === 0 ? Math.max(range.start.row, range.end.row - 1) : range.end.row;
  return {
    first: doc.layout.foldLineAt(range.start.row)?.first ?? range.start.row,
    last: doc.layout.foldLineAt(lastRow)?.last ?? lastRow,
  };
}

// --- Offsets ---------------------------------------------------------------------------------------------

/** A change of the text: what is from one offset to another becomes the text */
export interface Change {
  from: number;
  to: number;
  text: string;
}

/**
 * Where an offset goes when a change is made, as an Ace anchor goes: before it it stays, after it
 * it moves with the text, and at the place text is put in it moves after it
 */
export function mapOffset(offset: number, change: Change): number {
  if (offset < change.from) return offset;
  if (offset >= change.to) return offset - (change.to - change.from) + change.text.length;
  return change.from;
}

/** The text with a change made */
export const applyChange = (value: string, change: Change) => `${value.slice(0, change.from)}${change.text}${value.slice(change.to)}`;

// --- Lines as a block -----------------------------------------------------------------------------------

/** The text between two rows, both included, without the line break after the last */
export function rowsText(lines: string[], first: number, last: number): string {
  return lines.slice(first, last + 1).join('\n');
}

/** The new text and the columns taken off each row when rows are outdented (Ace's outdentRows) */
export function outdentRows(lines: string[], first: number, last: number): { text: string; removed: Array<[number, number]> } {
  const out: string[] = [];
  const removed: Array<[number, number]> = [];
  for (let row = first; row <= last; row += 1) {
    const line = lines[row];
    let j = 0;
    for (; j < TAB_SIZE; j += 1) if (line.charAt(j) !== ' ') break;
    const range: [number, number] = j < TAB_SIZE && line.charAt(j) === '\t' ? [j, j + 1] : [0, j];
    removed.push(range);
    out.push(line.slice(0, range[0]) + line.slice(range[1]));
  }
  return { text: out.join('\n'), removed };
}

/** Where a column goes when part of its row is taken off */
export const columnAfterRemoval = (column: number, [from, to]: [number, number]) =>
  column <= from ? column : column >= to ? column - (to - from) : from;

// --- Undo -----------------------------------------------------------------------------------------------

/** A change as it was made, with what it took away, so that it can be taken back */
export interface Delta {
  from: number;
  removed: string;
  inserted: string;
}

export interface UndoStep {
  deltas: Delta[];
}

/** The selection Ace gives after an undo or a redo ($getUndoSelection), as offsets */
function undoSelection(deltas: Delta[], isUndo: boolean): [number, number] {
  // As the changes are taken back or made again: what comes back is selected, what goes leaves the cursor
  const inserts = (delta: Delta) => (isUndo ? delta.removed.length > 0 && delta.inserted.length === 0 : delta.inserted.length > 0);
  const length = (delta: Delta) => (isUndo ? delta.removed.length : delta.inserted.length);
  let [start, end] = inserts(deltas[0]) ? [deltas[0].from, deltas[0].from + length(deltas[0])] : [deltas[0].from, deltas[0].from];
  for (let index = 1; index < deltas.length; index += 1) {
    const delta = deltas[index];
    if (inserts(delta)) {
      if (delta.from < start) start = delta.from;
      if (delta.from + length(delta) > end) end = delta.from + length(delta);
    } else if (delta.from < start) {
      start = delta.from;
      end = delta.from;
    }
  }
  return [start, end];
}

/** The commands whose steps join the one before when they follow each other (Ace's $mergeableCommands) */
export const MERGEABLE_COMMANDS = ['backspace', 'del', 'insertstring'];

/**
 * Whether a command's changes join the step before, as Ace's $historyTracker decides: the same
 * command again, typing only while what is typed does not start a word after spaces, and not two
 * seconds after the run began
 */
export class UndoTracker {
  private previous: { name: string; args?: string } | undefined;
  private sequenceStart = 0;

  shouldMerge(name: string, args: string | undefined, now = Date.now()): boolean {
    const previous = this.previous;
    this.previous = { name, args };
    let merge = previous !== undefined && previous.name === name;
    if (name === 'insertstring') merge = merge && (!SPACE.test(args ?? '') || SPACE.test(previous?.args ?? ''));
    else merge = merge && MERGEABLE_COMMANDS.includes(name);
    if (now - this.sequenceStart > 2000) merge = false;
    if (!merge && MERGEABLE_COMMANDS.includes(name)) this.sequenceStart = now;
    return merge;
  }

  /** An operation that is no command came between: the next command starts a step of its own */
  breakMerge(): void {
    this.previous = { name: '' };
  }
}

/** Ace's undo manager: steps of changes, taken back and made again */
export class UndoManager {
  private done: UndoStep[] = [];
  private undone: UndoStep[] = [];

  reset(): void {
    this.done = [];
    this.undone = [];
  }

  get canUndo(): boolean {
    return this.done.length > 0;
  }

  get canRedo(): boolean {
    return this.undone.length > 0;
  }

  /** The changes of a command, as a step of their own or joined to the one before */
  add(deltas: Delta[], merge: boolean): void {
    if (!deltas.length) return;
    this.undone = [];
    const previous = this.done[this.done.length - 1];
    if (merge && previous) previous.deltas.push(...deltas);
    else this.done.push({ deltas: [...deltas] });
  }

  /** A step taken back: the changes to make, in order, and the selection after them */
  undo(): { changes: Change[]; selection: [number, number] } | undefined {
    const step = this.done.pop();
    if (!step) return undefined;
    this.undone.push(step);
    const changes = [...step.deltas].reverse().map((delta) => ({ from: delta.from, to: delta.from + delta.inserted.length, text: delta.removed }));
    return { changes, selection: undoSelection(step.deltas, true) };
  }

  redo(): { changes: Change[]; selection: [number, number] } | undefined {
    const step = this.undone.pop();
    if (!step) return undefined;
    this.done.push(step);
    const changes = step.deltas.map((delta) => ({ from: delta.from, to: delta.from + delta.removed.length, text: delta.inserted }));
    return { changes, selection: undoSelection(step.deltas, false) };
  }
}

// --- Keys -------------------------------------------------------------------------------------------------

export const isMacPlatform = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');

const KEY_NAMES: Record<string, string> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
  Enter: 'return',
  Escape: 'esc',
  Backspace: 'backspace',
  Delete: 'delete',
  Insert: 'insert',
  Home: 'home',
  End: 'end',
  PageUp: 'pageup',
  PageDown: 'pagedown',
  Tab: 'tab',
  ' ': 'space',
};

const CODE_NAMES: Record<string, string> = {
  BracketLeft: '[',
  BracketRight: ']',
  Slash: '/',
  Backslash: '\\',
  Minus: '-',
  Equal: '=',
  Comma: ',',
  Period: '.',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  Space: 'space',
};

/** A key with its modifiers, as Ace's key bindings name it: "ctrl-shift-z" */
export function keyName(event: { key: string; code?: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }): string {
  let key = KEY_NAMES[event.key];
  const code = event.code ?? '';
  if (!key) {
    const letter = /^Key([A-Z])$/.exec(code);
    const digit = /^(?:Digit|Numpad)(\d)$/.exec(code);
    if (letter) key = letter[1].toLowerCase();
    else if (digit) key = digit[1];
    else if (CODE_NAMES[code]) key = CODE_NAMES[code];
    else if (/^F\d+$/.test(event.key)) key = event.key.toLowerCase();
    else key = event.key.toLowerCase();
  }
  const parts: string[] = [];
  if (event.ctrlKey) parts.push('ctrl');
  if (event.altKey) parts.push('alt');
  if (event.shiftKey) parts.push('shift');
  if (event.metaKey) parts.push('command');
  parts.push(key);
  return parts.join('-');
}

/** A binding written as Ace writes them ("Ctrl-Shift-Z|Ctrl-Y"), as the names keyName gives */
export function bindingNames(binding: string): string[] {
  return binding.split('|').map((one) => {
    const parts = one.split('-');
    // "Ctrl--" is the minus key
    const key = one.endsWith('--') ? '-' : parts.pop() ?? '';
    const modifiers = new Set(parts.filter(Boolean).map((part) => part.toLowerCase().replace('option', 'alt').replace('cmd', 'command')));
    const ordered = ['ctrl', 'alt', 'shift', 'command'].filter((name) => modifiers.has(name));
    return [...ordered, key.toLowerCase()].join('-');
  });
}

/**
 * Ace's default commands of the editor, in its order, with their keys on Windows and Linux, and on
 * the Mac; those of its extensions the console does not load (settings menu, error marker, macros)
 * are left out
 */
export const ACE_BINDINGS: Array<[string, string | null, string | null]> = [
  ['selectall', 'Ctrl-A', 'Command-A'],
  ['centerselection', null, 'Ctrl-L'],
  ['gotoline', 'Ctrl-L', 'Command-L'],
  ['fold', 'Alt-L|Ctrl-F1', 'Command-Alt-L|Command-F1'],
  ['unfold', 'Alt-Shift-L|Ctrl-Shift-F1', 'Command-Alt-Shift-L|Command-Shift-F1'],
  ['toggleFoldWidget', 'F2', 'F2'],
  ['toggleParentFoldWidget', 'Alt-F2', 'Alt-F2'],
  ['foldall', null, 'Ctrl-Command-Option-0'],
  ['foldOther', 'Alt-0', 'Command-Option-0'],
  ['unfoldall', 'Alt-Shift-0', 'Command-Option-Shift-0'],
  ['findnext', 'Ctrl-K', 'Command-G'],
  ['findprevious', 'Ctrl-Shift-K', 'Command-Shift-G'],
  ['selectOrFindNext', 'Alt-K', 'Ctrl-G'],
  ['selectOrFindPrevious', 'Alt-Shift-K', 'Ctrl-Shift-G'],
  ['find', 'Ctrl-F', 'Command-F'],
  ['overwrite', 'Insert', 'Insert'],
  ['selecttostart', 'Ctrl-Shift-Home', 'Command-Shift-Home|Command-Shift-Up'],
  ['gotostart', 'Ctrl-Home', 'Command-Home|Command-Up'],
  ['selectup', 'Shift-Up', 'Shift-Up|Ctrl-Shift-P'],
  ['golineup', 'Up', 'Up|Ctrl-P'],
  ['selecttoend', 'Ctrl-Shift-End', 'Command-Shift-End|Command-Shift-Down'],
  ['gotoend', 'Ctrl-End', 'Command-End|Command-Down'],
  ['selectdown', 'Shift-Down', 'Shift-Down|Ctrl-Shift-N'],
  ['golinedown', 'Down', 'Down|Ctrl-N'],
  ['selectwordleft', 'Ctrl-Shift-Left', 'Option-Shift-Left'],
  ['gotowordleft', 'Ctrl-Left', 'Option-Left'],
  ['selecttolinestart', 'Alt-Shift-Left', 'Command-Shift-Left|Ctrl-Shift-A'],
  ['gotolinestart', 'Alt-Left|Home', 'Command-Left|Home|Ctrl-A'],
  ['selectleft', 'Shift-Left', 'Shift-Left|Ctrl-Shift-B'],
  ['gotoleft', 'Left', 'Left|Ctrl-B'],
  ['selectwordright', 'Ctrl-Shift-Right', 'Option-Shift-Right'],
  ['gotowordright', 'Ctrl-Right', 'Option-Right'],
  ['selecttolineend', 'Alt-Shift-Right', 'Command-Shift-Right|Shift-End|Ctrl-Shift-E'],
  ['gotolineend', 'Alt-Right|End', 'Command-Right|End|Ctrl-E'],
  ['selectright', 'Shift-Right', 'Shift-Right'],
  ['gotoright', 'Right', 'Right|Ctrl-F'],
  ['selectpagedown', 'Shift-PageDown', 'Shift-PageDown'],
  ['pagedown', null, 'Option-PageDown'],
  ['gotopagedown', 'PageDown', 'PageDown|Ctrl-V'],
  ['selectpageup', 'Shift-PageUp', 'Shift-PageUp'],
  ['pageup', null, 'Option-PageUp'],
  ['gotopageup', 'PageUp', 'PageUp'],
  ['scrollup', 'Ctrl-Up', null],
  ['scrolldown', 'Ctrl-Down', null],
  ['selectlinestart', 'Shift-Home', 'Shift-Home'],
  ['selectlineend', 'Shift-End', 'Shift-End'],
  ['jumptomatching', 'Ctrl-P', 'Ctrl-P'],
  ['selecttomatching', 'Ctrl-Shift-P', 'Ctrl-Shift-P'],
  ['expandToMatching', 'Ctrl-Shift-M', 'Ctrl-Shift-M'],
  ['removeline', 'Ctrl-D', 'Command-D'],
  ['duplicateSelection', 'Ctrl-Shift-D', 'Command-Shift-D'],
  ['sortlines', 'Ctrl-Alt-S', 'Command-Alt-S'],
  ['togglecomment', 'Ctrl-/', 'Command-/'],
  ['toggleBlockComment', 'Ctrl-Shift-/', 'Command-Shift-/'],
  ['modifyNumberUp', 'Ctrl-Shift-Up', 'Alt-Shift-Up'],
  ['modifyNumberDown', 'Ctrl-Shift-Down', 'Alt-Shift-Down'],
  ['replace', 'Ctrl-H', 'Command-Option-F'],
  ['undo', 'Ctrl-Z', 'Command-Z'],
  ['redo', 'Ctrl-Shift-Z|Ctrl-Y', 'Command-Shift-Z|Command-Y'],
  ['copylinesup', 'Alt-Shift-Up', 'Command-Option-Up'],
  ['movelinesup', 'Alt-Up', 'Option-Up'],
  ['copylinesdown', 'Alt-Shift-Down', 'Command-Option-Down'],
  ['movelinesdown', 'Alt-Down', 'Option-Down'],
  ['del', 'Delete', 'Delete|Ctrl-D|Shift-Delete'],
  ['backspace', 'Shift-Backspace|Backspace', 'Ctrl-Backspace|Shift-Backspace|Backspace|Ctrl-H'],
  ['cut_or_delete', 'Shift-Delete', null],
  ['removetolinestart', 'Alt-Backspace', 'Command-Backspace'],
  ['removetolineend', 'Alt-Delete', 'Ctrl-K|Command-Delete'],
  ['removetolinestarthard', 'Ctrl-Shift-Backspace', null],
  ['removetolineendhard', 'Ctrl-Shift-Delete', null],
  ['removewordleft', 'Ctrl-Backspace', 'Alt-Backspace|Ctrl-Alt-Backspace'],
  ['removewordright', 'Ctrl-Delete', 'Alt-Delete'],
  ['outdent', 'Shift-Tab', 'Shift-Tab'],
  ['indent', 'Tab', 'Tab'],
  ['blockoutdent', 'Ctrl-[', 'Ctrl-['],
  ['blockindent', 'Ctrl-]', 'Ctrl-]'],
  ['splitline', null, 'Ctrl-O'],
  ['transposeletters', 'Alt-Shift-X', 'Ctrl-T'],
  ['touppercase', 'Ctrl-U', 'Ctrl-U'],
  ['tolowercase', 'Ctrl-Shift-U', 'Ctrl-Shift-U'],
  ['expandtoline', 'Ctrl-Shift-L', 'Command-Shift-L'],
];

/**
 * The commands of each key of this platform, in the order they were bound: Ace runs the last one
 * first, and the one before when it declines
 */
export function commandKeys(mac: boolean): Map<string, string[]> {
  const keys = new Map<string, string[]>();
  for (const [name, win, onMac] of ACE_BINDINGS) {
    const binding = mac ? onMac : win;
    if (!binding) continue;
    for (const key of bindingNames(binding)) keys.set(key, [...(keys.get(key) ?? []).filter((each) => each !== name), name]);
  }
  return keys;
}

/** Whether a selection runs from the anchor back to the cursor */
export const isBackwards = (anchor: Position, lead: Position) => comparePositions(lead, anchor) < 0;

/** The selection as a range from its start to its end */
export const orderedRange = (anchor: Position, lead: Position): TextRange =>
  isBackwards(anchor, lead) ? { start: lead, end: anchor } : { start: anchor, end: lead };

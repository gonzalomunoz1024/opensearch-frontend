/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The text, the selection and the commands of a console editor, as the editor, the edit session
 * and the selection of Ace 1.2.9 (brace 0.11.1, which OpenSearch Dashboards draws its console
 * with) keep and run them: the text as its lines, the cursor and the anchor of the selection as
 * rows and columns that follow the changes made before them, the folds, the undo history in
 * steps that typing joins, and the console mode's behaviours (brackets and quotes closed as they
 * are typed, the indentation kept and deepened, a closing brace put back under its opening one).
 * Nothing here draws or measures: the editor gives the rows a page holds, and asks what to scroll.
 */

import {
  UndoManager,
  UndoTracker,
  clipPosition,
  isBackwards,
  lineRange,
  moveBy,
  moveLeft,
  moveLineEnd,
  moveLineStart,
  moveRight,
  moveWordLeft,
  moveWordRight,
  placeCursor,
  selectedRows,
  wordRange,
  type CommandDoc,
  type Delta,
  type TextRange,
} from './console_commands';
import {
  TokenIterator,
  addFold,
  bracketRange,
  findMatchingBracket,
  findOpeningBracket,
  foldAll,
  foldsInRange,
  expandFold,
  removeFold,
  toggleFold,
  toggleFoldWidget,
  toggleFoldWidgetAt,
  toggleParentFold,
  unfoldRange,
  mapFolds,
  type TokenDoc,
  type WidgetOptions,
} from './console_folds';
import { TokenCache, type AceState, type AceToken, type Highlighted, type HighlightMode } from './console_highlight';
import { ScreenLayout, TAB_SIZE, comparePositions, lineStarts, offsetOf, positionOf, reuseSplits, type Fold, type Position, type Splits } from './console_layout';
import { findAllRanges, findRange, replacement, searchRegExp, type SearchOptions } from './console_search';

const TAB_STRING = ' '.repeat(TAB_SIZE);

/** How a command asks the editor to scroll afterwards (Ace's scrollIntoView) */
export type ScrollIntoView = 'cursor' | 'center' | 'animate' | 'selectionPart';

/** What the editor is asked to scroll, in the order Ace does it */
export interface ScrollRequest {
  /** Scroll by so many rows first */
  rows?: number;
  /** Bring the selection into view, its anchor then its cursor, this far from the edge as a part of the height */
  selection?: number;
  /** Bring the selection into view only when it is out of the rows drawn (Ace's "selectionPart") */
  selectionPart?: boolean;
  /** Bring the cursor into view, this far from the edge as a part of the height */
  cursor?: number;
  /** Put a row of the text in the middle of the height unless it is wholly in view (Ace's gotoLine) */
  centerRow?: number;
  /** A row to put in the middle of the pane whether in view or not (Ace's alignCursor at one half) */
  alignRow?: number;
  /** Bring the start of a row of the text into view */
  rowStart?: number;
}

/** The last search, as Ace's Search keeps its options between finds */
export interface FindState extends SearchOptions {
  backwards?: boolean;
  skipCurrent?: boolean;
  wrap?: boolean;
  start?: TextRange;
  range?: TextRange;
}

/** What changed since the editor last looked */
export interface SessionChanges {
  text: boolean;
  selection: boolean;
  folds: boolean;
  scroll?: ScrollRequest;
}

interface Edit {
  action: 'insert' | 'remove';
  start: Position;
  end: Position;
  text: string;
}

const same = (a: Position, b: Position) => a.row === b.row && a.column === b.column;
const copy = (place: Position): Position => ({ row: place.row, column: place.column });

/** Where a place goes when text is put in or taken out before it, as an Ace anchor goes */
export function transformPoint(point: Position, edit: Edit): Position {
  if (point.row < edit.start.row || (point.row === edit.start.row && point.column < edit.start.column)) return copy(point);
  if (edit.action === 'insert') {
    return {
      row: point.row + edit.end.row - edit.start.row,
      column: point.column + (point.row === edit.start.row ? edit.end.column - edit.start.column : 0),
    };
  }
  if (point.row > edit.end.row || (point.row === edit.end.row && point.column >= edit.end.column)) {
    return {
      row: point.row - (edit.end.row - edit.start.row),
      column: point.column - (point.row === edit.end.row ? edit.end.column - edit.start.column : 0),
    };
  }
  return copy(edit.start);
}

/** The context of the C style behaviour: brackets it closed, and a brace it may close on Enter */
interface BehaviourContext {
  autoInsertedBrackets: number;
  autoInsertedRow: number;
  autoInsertedLineEnd: string;
  maybeInsertedBrackets: number;
  maybeInsertedRow: number;
  maybeInsertedLineStart: string;
  maybeInsertedLineEnd: string;
}

interface Transform {
  text: string;
  selection?: number[];
}

const SAFE_INSERT_IN_TOKENS = ['text', 'paren.rparen', 'punctuation.operator'];
const SAFE_INSERT_BEFORE_TOKENS = ['text', 'paren.rparen', 'punctuation.operator', 'comment'];
const TOKEN_RE = /^[\p{L}\p{Mn}\p{Mc}\p{Nd}\p{Pc}$_]+/u;
const QUOTES: Record<string, string> = { '"': '"', "'": "'" };

const indentOf = (line: string) => /^\s*/.exec(line)?.[0] ?? '';

/** The commands that run in a read-only editor (Ace's readOnly: true) */
const READ_ONLY_COMMANDS = new Set([
  'selectall',
  'centerselection',
  'gotoline',
  'fold',
  'unfold',
  'toggleFoldWidget',
  'toggleParentFoldWidget',
  'foldall',
  'foldOther',
  'unfoldall',
  'findnext',
  'findprevious',
  'selectOrFindNext',
  'selectOrFindPrevious',
  'find',
  'overwrite',
  'selecttostart',
  'gotostart',
  'selectup',
  'golineup',
  'selecttoend',
  'gotoend',
  'selectdown',
  'golinedown',
  'selectwordleft',
  'gotowordleft',
  'selecttolinestart',
  'gotolinestart',
  'selectleft',
  'gotoleft',
  'selectwordright',
  'gotowordright',
  'selecttolineend',
  'gotolineend',
  'selectright',
  'gotoright',
  'selectpagedown',
  'pagedown',
  'gotopagedown',
  'selectpageup',
  'pageup',
  'gotopageup',
  'scrollup',
  'scrolldown',
  'selectlinestart',
  'selectlineend',
  'jumptomatching',
  'selecttomatching',
  'expandToMatching',
  'copy',
  'expandtoline',
]);

/** How each command asks to be scrolled to afterwards */
const SCROLL: Record<string, ScrollIntoView> = {
  fold: 'center',
  unfold: 'center',
  toggleFoldWidget: 'center',
  toggleParentFoldWidget: 'center',
  foldall: 'center',
  foldOther: 'center',
  unfoldall: 'center',
  findnext: 'center',
  findprevious: 'center',
  selecttostart: 'animate',
  gotostart: 'animate',
  selecttoend: 'animate',
  gotoend: 'animate',
  jumptomatching: 'animate',
  selecttomatching: 'animate',
  expandToMatching: 'animate',
  sortlines: 'selectionPart',
  togglecomment: 'selectionPart',
  toggleBlockComment: 'selectionPart',
  outdent: 'selectionPart',
  indent: 'selectionPart',
  blockoutdent: 'selectionPart',
  blockindent: 'selectionPart',
};
for (const name of [
  'selectup',
  'golineup',
  'selectdown',
  'golinedown',
  'selectwordleft',
  'gotowordleft',
  'selecttolinestart',
  'gotolinestart',
  'selectleft',
  'gotoleft',
  'selectwordright',
  'gotowordright',
  'selecttolineend',
  'gotolineend',
  'selectright',
  'gotoright',
  'selectlinestart',
  'selectlineend',
  'cut',
  'paste',
  'removeline',
  'duplicateSelection',
  'modifyNumberUp',
  'modifyNumberDown',
  'copylinesup',
  'movelinesup',
  'copylinesdown',
  'movelinesdown',
  'del',
  'backspace',
  'cut_or_delete',
  'removetolinestart',
  'removetolineend',
  'removetolinestarthard',
  'removetolineendhard',
  'removewordleft',
  'removewordright',
  'insertstring',
  'inserttext',
  'splitline',
  'transposeletters',
  'touppercase',
  'tolowercase',
  'expandtoline',
]) {
  SCROLL[name] = 'cursor';
}

export class ConsoleSession {
  lines: string[];
  anchor: Position = { row: 0, column: 0 };
  lead: Position = { row: 0, column: 0 };
  /** The screen column going up and down keeps (Ace's $desiredColumn) */
  desiredColumn: number | undefined;
  folds: Fold[] = [];
  overwrite = false;
  readOnly: boolean;
  readonly mode: HighlightMode;
  tokens: TokenCache;
  /** How many rows a page holds, for Page Up and Down; the editor keeps it */
  pageRows = 20;
  /** The text highlighted as the selected word or what is searched (Ace's session.highlight) */
  highlight: RegExp | undefined;
  /** The last search */
  search: FindState = { needle: '' };
  /** What changed since the editor last looked */
  private textChanged = false;
  private selectionChanged = false;
  private foldsChanged = false;
  /** Where to scroll after the command */
  private scroll: ScrollRequest | undefined;
  /** Whether the selection was empty when the editor last looked */
  private lastEmpty = true;

  private wrapMode = false;
  private limit = 80;
  private value: string | undefined;
  private layoutCache: ScreenLayout | undefined;
  private splits: { lines: string[]; wrapLimit: number; list: Array<Splits | undefined> } | undefined;
  private startsCache: { lines: string[]; starts: ArrayLike<number> } | undefined;
  private readonly undoManager = new UndoManager();
  private readonly tracker = new UndoTracker();
  /** The changes of the command being run, for the undo history; none while undoing */
  private deltas: Delta[] | undefined;
  private merge = false;
  private context: BehaviourContext = {
    autoInsertedBrackets: 0,
    autoInsertedRow: -1,
    autoInsertedLineEnd: '',
    maybeInsertedBrackets: 0,
    maybeInsertedRow: -1,
    maybeInsertedLineStart: '',
    maybeInsertedLineEnd: '',
  };

  constructor(value: string, mode: HighlightMode, readOnly = false, highlighted?: Highlighted) {
    this.mode = mode;
    this.readOnly = readOnly;
    this.lines = splitLines(value);
    this.value = value;
    this.tokens = this.tokensFor(highlighted);
  }

  private tokensFor(highlighted?: Highlighted): TokenCache {
    return highlighted && highlighted.lines.length === this.lines.length && highlighted.states.length === this.lines.length
      ? TokenCache.from(this.lines, this.mode, highlighted)
      : new TokenCache(this.lines, this.mode);
  }

  // --- The text ------------------------------------------------------------------------------

  /** The whole text */
  getValue(): string {
    if (this.value === undefined) this.value = this.lines.join('\n');
    return this.value;
  }

  /** A new text, as Ace's setValue sets it: the cursor at the start, no folds, no undo */
  setValue(value: string, highlighted?: Highlighted): void {
    this.lines = splitLines(value);
    this.value = value;
    this.tokens = this.tokensFor(highlighted);
    this.anchor = { row: 0, column: 0 };
    this.lead = { row: 0, column: 0 };
    this.desiredColumn = undefined;
    this.folds = [];
    this.undoManager.reset();
    this.tracker.breakMerge();
    this.context.autoInsertedBrackets = 0;
    this.context.maybeInsertedBrackets = 0;
    this.layoutCache = undefined;
    this.textChanged = true;
    this.selectionChanged = true;
    this.foldsChanged = true;
  }

  /** The tokens worked out by the caller for the text as it is now */
  useTokens(highlighted: Highlighted): void {
    if (highlighted.lines.length === this.lines.length) this.tokens = TokenCache.from(this.lines, this.mode, highlighted);
  }

  /**
   * What changed since the last call, for the editor to draw and tell: the word highlighted
   * worked out again when the selection changed while it held text or as it stopped holding any,
   * as Ace's "changeSelection" does
   */
  takeChanges(): SessionChanges {
    const empty = this.isEmpty();
    if (this.selectionChanged && (!empty || !this.lastEmpty)) this.highlight = this.selectionHighlight();
    this.lastEmpty = empty;
    const changes: SessionChanges = { text: this.textChanged, selection: this.selectionChanged, folds: this.foldsChanged, scroll: this.scroll };
    this.textChanged = false;
    this.selectionChanged = false;
    this.foldsChanged = false;
    this.scroll = undefined;
    return changes;
  }

  /** A change made other than by a command (the mouse, the caller) ends the run of typing undo takes back at once */
  breakMerge(): void {
    this.tracker.breakMerge();
  }

  /** Asks the editor to scroll */
  requestScroll(request: ScrollRequest): void {
    this.scroll = { ...this.scroll, ...request };
  }

  get layout(): ScreenLayout {
    if (!this.layoutCache) {
      let list: Array<Splits | undefined> | undefined;
      if (this.wrapMode) {
        const known = this.splits;
        if (known && known.wrapLimit === this.limit) list = known.lines === this.lines ? known.list : reuseSplits(known.lines, known.list, this.lines);
        else list = new Array(this.lines.length);
        this.splits = { lines: this.lines, wrapLimit: this.limit, list };
      }
      this.layoutCache = new ScreenLayout(this.lines, { wrap: this.wrapMode, wrapLimit: this.limit, folds: this.folds, splits: list });
    }
    return this.layoutCache;
  }

  get wrap(): boolean {
    return this.wrapMode;
  }

  get wrapLimit(): number {
    return this.limit;
  }

  /** Lines wrapped or not, at a number of characters */
  setWrap(wrap: boolean, wrapLimit: number): void {
    if (wrap === this.wrapMode && wrapLimit === this.limit) return;
    this.wrapMode = wrap;
    this.limit = wrapLimit;
    this.layoutCache = undefined;
  }

  get doc(): CommandDoc & TokenDoc {
    return { lines: this.lines, layout: this.layout, tokens: (row: number) => this.tokens.tokens(row) };
  }

  private starts(): ArrayLike<number> {
    if (this.startsCache?.lines !== this.lines) this.startsCache = { lines: this.lines, starts: lineStarts(this.lines) };
    return this.startsCache.starts;
  }

  offsetOf(place: Position): number {
    return offsetOf(this.starts(), this.lines, place);
  }

  positionOf(offset: number): Position {
    return positionOf(this.starts(), this.lines, offset);
  }

  textRange(range: TextRange): string {
    const { start, end } = range;
    if (start.row === end.row) return (this.lines[start.row] ?? '').slice(start.column, end.column);
    const parts = [(this.lines[start.row] ?? '').slice(start.column)];
    for (let row = start.row + 1; row < end.row; row += 1) parts.push(this.lines[row]);
    parts.push((this.lines[end.row] ?? '').slice(0, end.column));
    return parts.join('\n');
  }

  private clip(place: Position): Position {
    return clipPosition(this.lines, place.row, place.column);
  }

  /** Text put in at a place (Ace's Document.insert); where it ends */
  insertText(at: Position, text: string): Position {
    const place = this.clip(at);
    if (!text) return place;
    const parts = splitLines(text);
    const line = this.lines[place.row];
    const end =
      parts.length === 1 ? { row: place.row, column: place.column + parts[0].length } : { row: place.row + parts.length - 1, column: parts[parts.length - 1].length };
    const from = this.offsetOf(place);
    parts[0] = line.slice(0, place.column) + parts[0];
    parts[parts.length - 1] += line.slice(place.column);
    const lines = this.lines.slice(0, place.row).concat(parts, this.lines.slice(place.row + 1));
    this.applyEdit({ action: 'insert', start: place, end, text }, lines, { from, removed: '', inserted: text });
    return end;
  }

  /** The text of a range taken out (Ace's Document.remove); where it was */
  removeText(range: TextRange): Position {
    const start = this.clip(range.start);
    const end = this.clip(range.end);
    if (comparePositions(start, end) >= 0) return start;
    const removed = this.textRange({ start, end });
    const from = this.offsetOf(start);
    const joined = this.lines[start.row].slice(0, start.column) + this.lines[end.row].slice(end.column);
    const lines = this.lines.slice(0, start.row).concat([joined], this.lines.slice(end.row + 1));
    this.applyEdit({ action: 'remove', start, end, text: removed }, lines, { from, removed, inserted: '' });
    return start;
  }

  /** A range replaced (Ace's Document.replace): taken out, then the text put in; where it ends */
  replaceText(range: TextRange, text: string): Position {
    if (!text && same(range.start, range.end)) return this.clip(range.start);
    if (text === this.textRange(range)) return this.clip(range.end);
    const start = this.removeText(range);
    return text ? this.insertText(start, text) : start;
  }

  private applyEdit(edit: Edit, lines: string[], delta: Delta): void {
    this.lines = lines;
    this.value = undefined;
    this.layoutCache = undefined;
    const rows = edit.end.row - edit.start.row;
    this.tokens.change(lines, edit.start.row, rows, edit.action);
    const anchor = transformPoint(this.anchor, edit);
    const lead = transformPoint(this.lead, edit);
    if (!same(anchor, this.anchor) || !same(lead, this.lead)) this.selectionChanged = true;
    // The cursor moved along a line by the change forgets the column going up and down keeps
    if (lead.column !== this.lead.column) this.desiredColumn = undefined;
    this.anchor = anchor;
    this.lead = lead;
    if (this.folds.length) {
      const before = this.folds;
      this.folds = edit.action === 'insert' ? mapFolds(before, edit.start, edit.start, edit.end) : mapFolds(before, edit.start, edit.end, edit.start);
      if (this.folds !== before) this.foldsChanged = true;
    }
    this.deltas?.push(delta);
    this.textChanged = true;
  }

  // --- The selection -------------------------------------------------------------------------

  isEmpty(): boolean {
    return same(this.anchor, this.lead);
  }

  isMultiLine(): boolean {
    return this.anchor.row !== this.lead.row;
  }

  getRange(): TextRange {
    return isBackwards(this.anchor, this.lead) ? { start: copy(this.lead), end: copy(this.anchor) } : { start: copy(this.anchor), end: copy(this.lead) };
  }

  selectedText(): string {
    return this.textRange(this.getRange());
  }

  /** The cursor put at a place (Ace's moveCursorTo), out of folds */
  moveCursorTo(row: number, column: number, keepDesiredColumn = false): void {
    const place = placeCursor(this.doc, row, column, this.lead);
    if (!same(place, this.lead)) this.selectionChanged = true;
    this.lead = place;
    if (!keepDesiredColumn) this.desiredColumn = undefined;
  }

  clearSelection(): void {
    if (!same(this.anchor, this.lead)) this.selectionChanged = true;
    this.anchor = copy(this.lead);
  }

  /** The cursor moved with the anchor where it is (Ace's $moveSelection) */
  private moveSelection(mover: () => void): void {
    mover();
  }

  setSelectionAnchor(row: number, column: number): void {
    const place = this.clip({ row, column });
    if (!same(place, this.anchor)) this.selectionChanged = true;
    this.anchor = place;
  }

  /** A range selected, its cursor at the start when reversed (Ace's setSelectionRange) */
  setSelectionRange(range: TextRange, reverse = false): void {
    if (reverse) {
      this.setSelectionAnchor(range.end.row, range.end.column);
      this.moveCursorTo(range.start.row, range.start.column);
    } else {
      this.setSelectionAnchor(range.start.row, range.start.column);
      this.moveCursorTo(range.end.row, range.end.column);
    }
    this.desiredColumn = undefined;
  }

  moveTo(row: number, column: number): void {
    this.clearSelection();
    this.moveCursorTo(row, column);
    this.anchor = copy(this.lead);
  }

  selectTo(row: number, column: number): void {
    this.moveCursorTo(row, column);
  }

  selectAll(): void {
    const last = this.lines.length - 1;
    this.setSelectionAnchor(0, 0);
    this.moveCursorTo(last, this.lines[last].length);
  }

  /** The selection by offsets, the cursor at the end */
  selectOffsets(start: number, end = start): void {
    const from = this.positionOf(start);
    const to = this.positionOf(end);
    this.setSelectionAnchor(from.row, from.column);
    this.moveCursorTo(to.row, to.column);
    if (start === end) this.anchor = copy(this.lead);
  }

  private moveCursorBy(rows: number, chars: number): void {
    const moved = moveBy(this.doc, this.lead, rows, chars, this.desiredColumn);
    this.moveCursorTo(moved.position.row, moved.position.column, chars === 0);
    if (chars === 0) this.desiredColumn = moved.desired;
  }

  private moveCursorLeft(): void {
    const place = moveLeft(this.doc, this.lead);
    this.moveCursorTo(place.row, place.column);
  }

  private moveCursorRight(): void {
    const place = moveRight(this.doc, this.lead);
    this.moveCursorTo(place.row, place.column);
  }

  /** The word about a place, the selection made of it */
  wordRange(row: number, column: number): TextRange {
    return wordRange(this.lines, row, column);
  }

  /** The whole lines of a row, the lines of its fold with it */
  lineRange(row: number, excludeLastChar = false): TextRange {
    return lineRange(this.doc, row, excludeLastChar);
  }

  // --- The tokens and the brackets -------------------------------------------------------------

  /** The token at a place (Ace's getTokenAt): the one the character before it is in */
  tokenAt(row: number, column: number): (AceToken & { start: number }) | undefined {
    const tokens = this.tokens.tokens(row);
    let c = 0;
    let index = 0;
    for (; index < tokens.length; index += 1) {
      c += tokens[index].value.length;
      if (c >= column) break;
    }
    const token = tokens[index];
    return token ? { ...token, start: c - token.value.length } : undefined;
  }

  stateOf(row: number): AceState {
    return this.tokens.state(row);
  }

  matchingBracket(place: Position): Position | undefined {
    return findMatchingBracket(this.doc, place);
  }

  // --- Commands ------------------------------------------------------------------------------

  /** Runs a command as Ace's command manager runs it; false when it did not run */
  exec(name: string, args?: string): boolean {
    if (this.readOnly && !READ_ONLY_COMMANDS.has(name)) return false;
    this.merge = this.tracker.shouldMerge(name, args);
    this.deltas = [];
    let done: boolean | void;
    try {
      done = this.run(name, args);
    } finally {
      const deltas = this.deltas;
      this.deltas = undefined;
      this.undoManager.add(deltas, this.merge);
    }
    if (done === false) return false;
    const scroll = SCROLL[name];
    if (scroll === 'center') this.requestScroll({ cursor: 0.5 });
    else if (scroll === 'cursor' || scroll === 'animate') this.requestScroll({ cursor: 0 });
    else if (scroll === 'selectionPart') this.requestScroll({ selectionPart: true });
    return true;
  }

  /** The highlight of the word the selection holds, when it holds one whole (Ace's $getSelectionHighLightRegexp) */
  private selectionHighlight(): RegExp | undefined {
    const range = this.getRange();
    if (same(range.start, range.end) || range.start.row !== range.end.row) return undefined;
    const startOuter = range.start.column - 1;
    const endOuter = range.end.column + 1;
    const line = this.lines[range.start.row];
    const outer = line.substring(Math.max(startOuter, 0), Math.min(endOuter, line.length));
    if ((startOuter >= 0 && /^[\w\d]/.test(outer)) || (endOuter <= line.length && /[\w\d]$/.test(outer))) return undefined;
    const needle = line.substring(range.start.column, range.end.column);
    if (!/^[\w\d]+$/.test(needle)) return undefined;
    return searchRegExp({ needle, wholeWord: true, caseSensitive: true });
  }

  private run(name: string, args?: string): boolean | void {
    switch (name) {
      case 'selectall':
        this.selectAll();
        return;
      case 'centerselection': {
        const range = this.getRange();
        this.scroll = { alignRow: Math.floor(range.start.row + (range.end.row - range.start.row) / 2) };
        return;
      }
      case 'fold':
      case 'unfold':
        this.setFolds(toggleFold(this.doc, this.folds, this.getRange(), name === 'unfold'));
        return;
      case 'toggleFoldWidget':
      case 'toggleParentFoldWidget': {
        const row = this.layout.foldLineAt(this.lead.row)?.first ?? this.lead.row;
        this.setFolds(toggleFoldWidgetAt(this.doc, this.folds, row));
        return;
      }
      case 'foldall':
        this.setFolds(foldAll(this.doc, this.folds));
        return;
      case 'foldOther':
        this.setFolds(foldAll(this.doc, this.folds));
        this.setFolds(unfoldRange(this.doc, this.folds, this.getRange()));
        return;
      case 'unfoldall':
        this.setFolds([]);
        return;
      case 'findnext':
      case 'findprevious':
        this.find({ skipCurrent: true, backwards: name === 'findprevious' });
        return;
      case 'selectOrFindNext':
      case 'selectOrFindPrevious':
        if (this.isEmpty()) this.setSelectionRange(this.wordRange(this.lead.row, this.lead.column));
        else this.find({ skipCurrent: true, backwards: name === 'selectOrFindPrevious' });
        return;
      case 'overwrite':
        this.overwrite = !this.overwrite;
        this.selectionChanged = true;
        return;
      case 'selecttostart':
        this.moveSelection(() => this.moveCursorTo(0, 0));
        return;
      case 'gotostart':
        this.moveCursorTo(0, 0);
        this.clearSelection();
        return;
      case 'selecttoend': {
        const last = this.lines.length - 1;
        this.moveSelection(() => this.moveCursorTo(last, this.lines[last].length));
        return;
      }
      case 'gotoend': {
        const last = this.lines.length - 1;
        this.moveCursorTo(last, this.lines[last].length);
        this.clearSelection();
        return;
      }
      case 'selectup':
        this.moveCursorBy(-1, 0);
        return;
      case 'golineup':
        if (this.isMultiLine() && !isBackwards(this.anchor, this.lead)) {
          this.moveCursorTo(this.anchor.row, this.anchor.column);
          return;
        }
        this.clearSelection();
        this.moveCursorBy(-1, 0);
        this.clearSelection();
        return;
      case 'selectdown':
        this.moveCursorBy(1, 0);
        return;
      case 'golinedown':
        if (this.isMultiLine() && isBackwards(this.anchor, this.lead)) {
          this.moveCursorTo(this.anchor.row, this.anchor.column);
          return;
        }
        this.clearSelection();
        this.moveCursorBy(1, 0);
        this.clearSelection();
        return;
      case 'selectwordleft':
        this.moveTo2(moveWordLeft(this.doc, this.lead), true);
        return;
      case 'gotowordleft':
        this.moveTo2(moveWordLeft(this.doc, this.lead), false);
        return;
      case 'selectwordright':
        this.moveTo2(moveWordRight(this.doc, this.lead), true);
        return;
      case 'gotowordright':
        this.moveTo2(moveWordRight(this.doc, this.lead), false);
        return;
      case 'selecttolinestart':
      case 'selectlinestart':
        this.moveTo2(moveLineStart(this.doc, this.lead), true);
        return;
      case 'gotolinestart':
        this.moveTo2(moveLineStart(this.doc, this.lead), false);
        return;
      case 'selecttolineend':
      case 'selectlineend':
        this.moveTo2(moveLineEnd(this.doc, this.lead), true);
        return;
      case 'gotolineend':
        this.moveTo2(moveLineEnd(this.doc, this.lead), false);
        return;
      case 'selectleft':
        this.moveCursorLeft();
        return;
      case 'gotoleft':
        if (!this.isEmpty()) {
          const start = this.getRange().start;
          this.moveCursorTo(start.row, start.column);
        } else {
          this.moveCursorLeft();
        }
        this.clearSelection();
        return;
      case 'selectright':
        this.moveCursorRight();
        return;
      case 'gotoright':
        if (!this.isEmpty()) {
          const end = this.getRange().end;
          this.moveCursorTo(end.row, end.column);
        } else {
          this.moveCursorRight();
        }
        this.clearSelection();
        return;
      case 'selectpagedown':
      case 'gotopagedown':
      case 'pagedown':
        this.moveByPage(1, name === 'selectpagedown' ? true : name === 'gotopagedown' ? false : undefined);
        return;
      case 'selectpageup':
      case 'gotopageup':
      case 'pageup':
        this.moveByPage(-1, name === 'selectpageup' ? true : name === 'gotopageup' ? false : undefined);
        return;
      case 'scrollup':
        this.scroll = { rows: -2 };
        return;
      case 'scrolldown':
        this.scroll = { rows: 2 };
        return;
      case 'jumptomatching':
        this.jumpToMatching(false, false);
        return;
      case 'selecttomatching':
        this.jumpToMatching(true, false);
        return;
      case 'expandToMatching':
        this.jumpToMatching(true, true);
        return;
      case 'cut':
        if (!this.isEmpty()) {
          this.removeText(this.getRange());
          this.clearSelection();
        }
        return;
      case 'paste':
        this.insert(args ?? '');
        return;
      case 'removeline': {
        const rows = selectedRows(this.doc, this.getRange());
        this.removeFullLines(rows.first, rows.last);
        this.clearSelection();
        return;
      }
      case 'duplicateSelection': {
        const range = this.getRange();
        const reverse = isBackwards(this.anchor, this.lead);
        if (same(range.start, range.end)) {
          this.moveLines(range.start.row, range.start.row, 0);
        } else {
          const point = reverse ? range.start : range.end;
          const end = this.insertText(point, this.textRange(range));
          this.setSelectionRange({ start: point, end }, reverse);
        }
        return;
      }
      case 'sortlines':
        this.sortLines();
        return;
      case 'togglecomment':
      case 'toggleBlockComment':
        // The console's modes have no comments to toggle
        return;
      case 'modifyNumberUp':
      case 'modifyNumberDown':
        this.modifyNumber(name === 'modifyNumberUp' ? 1 : -1);
        return;
      case 'undo':
        this.undo();
        return;
      case 'redo':
        this.redo();
        return;
      case 'copylinesup':
        this.editorMoveLines(-1, true);
        return;
      case 'movelinesup':
        this.editorMoveLines(-1, false);
        return;
      case 'copylinesdown':
        this.editorMoveLines(1, true);
        return;
      case 'movelinesdown':
        this.editorMoveLines(1, false);
        return;
      case 'del':
        this.remove('right');
        return;
      case 'backspace':
        this.remove('left');
        return;
      case 'cut_or_delete':
        if (!this.isEmpty()) return false;
        this.remove('left');
        return;
      case 'removetolinestart':
        if (this.isEmpty()) this.moveTo2(moveLineStart(this.doc, this.lead), true);
        this.removeText(this.getRange());
        this.clearSelection();
        return;
      case 'removetolineend': {
        if (this.isEmpty()) this.moveTo2(moveLineEnd(this.doc, this.lead), true);
        const range = this.getRange();
        if (same(range.start, range.end)) range.end = { row: range.end.row + 1, column: 0 };
        this.removeText(range);
        this.clearSelection();
        return;
      }
      case 'removetolinestarthard': {
        const range = this.getRange();
        range.start = { row: range.start.row, column: 0 };
        this.removeText(range);
        return;
      }
      case 'removetolineendhard': {
        const range = this.getRange();
        range.end = { row: range.end.row, column: Number.MAX_VALUE };
        this.removeText(range);
        return;
      }
      case 'removewordleft':
        if (this.isEmpty()) this.moveTo2(moveWordLeft(this.doc, this.lead), true);
        this.removeText(this.getRange());
        this.clearSelection();
        return;
      case 'removewordright':
        if (this.isEmpty()) this.moveTo2(moveWordRight(this.doc, this.lead), true);
        this.removeText(this.getRange());
        this.clearSelection();
        return;
      case 'outdent':
      case 'blockoutdent':
        this.outdentRows(this.getRange());
        return;
      case 'indent':
        this.indent();
        return;
      case 'blockindent': {
        const rows = selectedRows(this.doc, this.getRange());
        this.indentRows(rows.first, rows.last);
        return;
      }
      case 'insertstring':
        this.insert(args ?? '');
        return;
      case 'inserttext':
        this.insert(args ?? '');
        return;
      case 'splitline': {
        if (!this.isEmpty()) {
          this.removeText(this.getRange());
          this.clearSelection();
        }
        const cursor = copy(this.lead);
        this.insert('\n');
        this.moveCursorTo(cursor.row, cursor.column);
        this.clearSelection();
        return;
      }
      case 'transposeletters':
        this.transposeLetters();
        return;
      case 'touppercase':
      case 'tolowercase': {
        const original = this.getRange();
        const reverse = isBackwards(this.anchor, this.lead);
        if (this.isEmpty()) this.setSelectionRange(this.wordRange(this.lead.row, this.lead.column));
        const range = this.getRange();
        const text = this.textRange(range);
        this.replaceText(range, name === 'touppercase' ? text.toUpperCase() : text.toLowerCase());
        this.setSelectionRange(original, reverse && false);
        return;
      }
      case 'expandtoline': {
        const range = this.getRange();
        range.start = { row: range.start.row, column: 0 };
        range.end = { row: range.end.row + 1, column: 0 };
        this.setSelectionRange(range);
        return;
      }
      default:
        return false;
    }
  }

  /** The cursor moved to a place, the selection kept from its anchor or not */
  private moveTo2(place: Position, select: boolean): void {
    this.moveCursorTo(place.row, place.column);
    if (!select) this.clearSelection();
  }

  private setFolds(folds: Fold[]): void {
    if (folds === this.folds) return;
    this.folds = folds;
    this.layoutCache = undefined;
    this.foldsChanged = true;
    // The cursor stays where it is, also inside a fold, as Ace leaves it: it is drawn at the fold
  }

  /** Folds set from outside: a click on a mark of the gutter or on a fold */
  changeFolds(folds: Fold[]): void {
    this.setFolds(folds);
  }

  private moveByPage(dir: number, select: boolean | undefined): void {
    const rows = dir * this.pageRows;
    if (select === true) this.moveCursorBy(rows, 0);
    else if (select === false) {
      this.moveCursorBy(rows, 0);
      this.clearSelection();
    }
    this.scroll = { rows, ...(select === undefined ? {} : { cursor: 0.5 }) };
  }

  private jumpToMatching(select: boolean, expand: boolean): void {
    const cursor = copy(this.lead);
    const iterator = new TokenIterator(this.doc, cursor.row, cursor.column);
    let prevToken = iterator.current();
    let token = prevToken ?? iterator.forward();
    if (!token) return;
    let found = false;
    const depth: Record<string, number> = {};
    let i = cursor.column - iterator.column();
    const brackets: Record<string, string> = { ')': '(', '(': '(', ']': '[', '[': '[', '{': '{', '}': '{' };
    do {
      if (token && /[{}()[\]]/.test(token.value)) {
        for (; i < token.value.length && !found; i += 1) {
          const chr = token.value[i];
          if (!brackets[chr]) continue;
          const type = `${brackets[chr]}.${token.type.replace('rparen', 'lparen')}`;
          if (Number.isNaN(depth[type]) || depth[type] === undefined) depth[type] = 0;
          if ('([{'.includes(chr)) depth[type] += 1;
          else {
            depth[type] -= 1;
            if (depth[type] === -1) found = true;
          }
        }
      }
      if (!found) {
        prevToken = token;
        token = iterator.forward();
        i = 0;
      }
    } while (token && !found);
    if (!found) return;
    let range: (TextRange & { cursor?: Position }) | undefined = bracketRange(this.doc, cursor);
    let pos: Position | undefined;
    if (!range) {
      const at = { row: iterator.row, column: iterator.column() + i - 1 };
      range = { start: at, end: at };
      pos = at;
      if (expand || (pos.row === cursor.row && Math.abs(pos.column - cursor.column) < 2)) range = bracketRange(this.doc, pos);
    }
    pos = range?.cursor ?? pos;
    if (!pos) return;
    if (select) {
      const current = this.getRange();
      if (range && expand) this.setSelectionRange(range);
      else if (range && comparePositions(range.start, current.start) === 0 && comparePositions(range.end, current.end) === 0) this.clearSelection();
      else this.selectTo(pos.row, pos.column);
    } else {
      this.moveTo(pos.row, pos.column);
    }
  }

  // --- Typing --------------------------------------------------------------------------------

  /** Text typed or pasted at the cursor, as Ace's Editor.insert puts it in */
  insert(input: string, pasted = false): void {
    let text = input;
    let cursor = copy(this.lead);
    let transform: Transform | undefined;
    if (!pasted) {
      transform = this.transformInsertion(text);
      if (transform) {
        if (text !== transform.text) this.merge = false;
        text = transform.text;
      }
    }
    if (text === '\t') text = TAB_STRING;
    if (!this.isEmpty()) {
      cursor = this.removeText(this.getRange());
      this.clearSelection();
    } else if (this.overwrite && !text.includes('\n')) {
      this.removeText({ start: cursor, end: { row: cursor.row, column: cursor.column + text.length } });
    }
    if (text === '\n' || text === '\r\n') {
      const line = this.lines[cursor.row];
      if (cursor.column > line.search(/\S|$/)) {
        const d = line.substr(cursor.column).search(/\S|$/);
        this.removeText({ start: cursor, end: { row: cursor.row, column: cursor.column + d } });
      }
    }
    this.clearSelection();
    const start = cursor.column;
    const lineState = this.stateOf(cursor.row);
    const line = this.lines[cursor.row];
    const shouldOutdent = this.checkOutdent(line, text);
    this.insertText(cursor, text);
    this.clearSelection();
    if (transform?.selection) {
      const sel = transform.selection;
      if (sel.length === 2) {
        this.setSelectionRange({ start: { row: cursor.row, column: start + sel[0] }, end: { row: cursor.row, column: start + sel[1] } });
      } else {
        this.setSelectionRange({ start: { row: cursor.row + sel[0], column: sel[1] }, end: { row: cursor.row + sel[2], column: sel[3] } });
      }
    }
    if (text === '\n' || text === '\r\n' || text === '\r') {
      const lineIndent = this.nextLineIndent(lineState, line.slice(0, cursor.column));
      this.insertText({ row: cursor.row + 1, column: 0 }, lineIndent);
    }
    if (shouldOutdent) this.autoOutdent(cursor.row);
  }

  /** The indentation of the line after a line break (the console's getNextLineIndent, a script's within triple quotes) */
  private nextLineIndent(state: AceState, line: string): string {
    let indent = indentOf(line);
    const top = typeof state === 'string' ? state : state[0] ?? 'start';
    if (this.mode === 'input' && top.startsWith('script-')) {
      if (/^.*[{[]\s*$/.test(line)) indent += TAB_STRING;
    } else if (this.mode === 'input') {
      if (state !== 'string_literal' && /^.*[{([]\s*$/.test(line)) indent += TAB_STRING;
    } else if (this.mode === 'output') {
      if (state === 'start' && /^.*[{([]\s*$/.test(line)) indent += TAB_STRING;
    }
    return indent;
  }

  /** Whether typing on a line puts a closing brace back under its opening one (MatchingBraceOutdent) */
  private checkOutdent(line: string, input: string): boolean {
    if (this.mode === 'text') return false;
    if (!/^\s+$/.test(line)) return false;
    return /^\s*\}/.test(input);
  }

  private autoOutdent(row: number): void {
    const line = this.lines[row];
    const match = /^(\s*\})/.exec(line);
    if (!match) return;
    const column = match[1].length;
    const open = findMatchingBracket(this.doc, { row, column });
    if (!open || open.row === row) return;
    const indent = indentOf(this.lines[open.row]);
    this.replaceText({ start: { row, column: 0 }, end: { row, column: column - 1 } }, indent);
  }

  private isSaneInsertion(): boolean {
    const cursor = this.lead;
    const iterator = new TokenIterator(this.doc, cursor.row, cursor.column);
    if (!SAFE_INSERT_IN_TOKENS.includes((iterator.current() ?? { type: 'text' }).type)) {
      const next = new TokenIterator(this.doc, cursor.row, cursor.column + 1);
      if (!SAFE_INSERT_IN_TOKENS.includes((next.current() ?? { type: 'text' }).type)) return false;
    }
    iterator.forward();
    return iterator.row !== cursor.row || SAFE_INSERT_BEFORE_TOKENS.includes((iterator.current() ?? { type: 'text' }).type);
  }

  private isAutoInsertedClosing(cursor: Position, line: string, bracket: string | undefined): boolean {
    const context = this.context;
    return (
      context.autoInsertedBrackets > 0 &&
      cursor.row === context.autoInsertedRow &&
      bracket === context.autoInsertedLineEnd[0] &&
      line.substr(cursor.column) === context.autoInsertedLineEnd
    );
  }

  private isMaybeInsertedClosing(cursor: Position, line: string): boolean {
    const context = this.context;
    return (
      context.maybeInsertedBrackets > 0 &&
      cursor.row === context.maybeInsertedRow &&
      line.substr(cursor.column) === context.maybeInsertedLineEnd &&
      line.substr(0, cursor.column) === context.maybeInsertedLineStart
    );
  }

  private recordAutoInsert(bracket: string): void {
    const cursor = this.lead;
    const line = this.lines[cursor.row];
    const context = this.context;
    if (!this.isAutoInsertedClosing(cursor, line, context.autoInsertedLineEnd[0])) context.autoInsertedBrackets = 0;
    context.autoInsertedRow = cursor.row;
    context.autoInsertedLineEnd = bracket + line.substr(cursor.column);
    context.autoInsertedBrackets += 1;
  }

  private recordMaybeInsert(bracket: string): void {
    const cursor = this.lead;
    const line = this.lines[cursor.row];
    const context = this.context;
    if (!this.isMaybeInsertedClosing(cursor, line)) context.maybeInsertedBrackets = 0;
    context.maybeInsertedRow = cursor.row;
    context.maybeInsertedLineStart = line.substr(0, cursor.column) + bracket;
    context.maybeInsertedLineEnd = line.substr(cursor.column);
    context.maybeInsertedBrackets += 1;
  }

  private clearMaybeInsertedClosing(): void {
    this.context.maybeInsertedBrackets = 0;
    this.context.maybeInsertedRow = -1;
  }

  private wrapped(opening: string, closing: string): Transform {
    const selection = this.getRange();
    const selected = this.textRange(selection);
    const rowDiff = selection.end.row - selection.start.row;
    return {
      text: opening + selected + closing,
      selection: [0, selection.start.column + 1, rowDiff, selection.end.column + (rowDiff ? 0 : 1)],
    };
  }

  /** The C style behaviour of Ace for text about to be typed: brackets and quotes closed or typed over */
  private transformInsertion(text: string): Transform | undefined {
    const cursor = copy(this.lead);
    const line = this.lines[cursor.row];
    const selected = this.selectedText();
    // braces
    if (text === '{') {
      if (selected !== '' && selected !== '{') return this.wrapped('{', '}');
      if (this.isSaneInsertion()) {
        if (/[\]})]/.test(line[cursor.column] ?? '')) {
          this.recordAutoInsert('}');
          return { text: '{}', selection: [1, 1] };
        }
        this.recordMaybeInsert('{');
        return { text: '{', selection: [1, 1] };
      }
    } else if (text === '}') {
      if (line.substring(cursor.column, cursor.column + 1) === '}') {
        const matching = findOpeningBracket(this.doc, '}', { row: cursor.row, column: cursor.column + 1 });
        if (matching && this.isAutoInsertedClosing(cursor, line, text)) {
          this.popAutoInsertedClosing();
          return { text: '', selection: [1, 1] };
        }
      }
    } else if (text === '\n' || text === '\r\n') {
      let closing = '';
      if (this.isMaybeInsertedClosing(cursor, line)) {
        closing = '}'.repeat(this.context.maybeInsertedBrackets);
        this.clearMaybeInsertedClosing();
      }
      const rightChar = line.substring(cursor.column, cursor.column + 1);
      let nextIndent: string | undefined;
      if (rightChar === '}') {
        const open = findMatchingBracket(this.doc, { row: cursor.row, column: cursor.column + 1 }, '}');
        if (!open) return undefined;
        nextIndent = indentOf(this.lines[open.row]);
      } else if (closing) {
        nextIndent = indentOf(line);
      } else {
        this.clearMaybeInsertedClosing();
      }
      if (nextIndent !== undefined) {
        const indent = nextIndent + TAB_STRING;
        return { text: `\n${indent}\n${nextIndent}${closing}`, selection: [1, indent.length, 1, indent.length] };
      }
    } else {
      this.clearMaybeInsertedClosing();
    }
    // parens and brackets
    for (const [open, close] of [
      ['(', ')'],
      ['[', ']'],
    ]) {
      if (text === open) {
        if (selected !== '') return this.wrapped(open, close);
        if (this.isSaneInsertion()) {
          this.recordAutoInsert(close);
          return { text: open + close, selection: [1, 1] };
        }
      } else if (text === close) {
        if (line.substring(cursor.column, cursor.column + 1) === close) {
          const matching = findOpeningBracket(this.doc, close, { row: cursor.row, column: cursor.column + 1 });
          if (matching && this.isAutoInsertedClosing(cursor, line, text)) {
            this.popAutoInsertedClosing();
            return { text: '', selection: [1, 1] };
          }
        }
      }
    }
    // quotes
    if (text.length === 1 && QUOTES[text]) {
      if (this.mode === 'output' && '//'.includes(text)) return undefined;
      const quote = text;
      if (selected !== '' && (selected.length !== 1 || !QUOTES[selected])) return this.wrapped(quote, quote);
      if (!selected) {
        const leftChar = line.substring(cursor.column - 1, cursor.column);
        const rightChar = line.substring(cursor.column, cursor.column + 1);
        const token = this.tokenAt(cursor.row, cursor.column);
        const rightToken = this.tokenAt(cursor.row, cursor.column + 1);
        if (leftChar === '\\' && token && /escape/.test(token.type)) return undefined;
        const stringBefore = Boolean(token) && /string|escape/.test(token?.type ?? '');
        const stringAfter = !rightToken || /string|escape/.test(rightToken.type);
        let pair: boolean;
        if (rightChar === quote) {
          pair = stringBefore !== stringAfter;
          if (pair && /string\.end/.test(rightToken?.type ?? '')) pair = false;
        } else {
          if (stringBefore && !stringAfter) return undefined;
          if (stringBefore && stringAfter) return undefined;
          // Ace tests the character before the cursor twice, not the one after it
          if (TOKEN_RE.test(leftChar)) return undefined;
          if (rightChar && !/[\s;,.})\]\\]/.test(rightChar)) return undefined;
          pair = true;
        }
        return { text: pair ? quote + quote : '', selection: [1, 1] };
      }
    }
    return undefined;
  }

  private popAutoInsertedClosing(): void {
    this.context.autoInsertedLineEnd = this.context.autoInsertedLineEnd.substr(1);
    this.context.autoInsertedBrackets -= 1;
  }

  /** Backspace and Delete (Ace's Editor.remove), the pair of a bracket or a quote taken with it */
  remove(dir: 'left' | 'right'): void {
    if (this.isEmpty()) {
      if (dir === 'left') this.moveCursorLeft();
      else this.moveCursorRight();
    }
    let range = this.getRange();
    const selected = this.textRange(range);
    let transformed: TextRange | undefined;
    if (range.start.row === range.end.row) {
      const line = this.lines[range.start.row];
      if (selected === '{') {
        if (line.substring(range.end.column, range.end.column + 1) === '}') transformed = { start: range.start, end: { row: range.end.row, column: range.end.column + 1 } };
        else this.context.maybeInsertedBrackets -= 1;
      } else if ((selected === '(' && line.charAt(range.start.column + 1) === ')') || (selected === '[' && line.charAt(range.start.column + 1) === ']')) {
        transformed = { start: range.start, end: { row: range.end.row, column: range.end.column + 1 } };
      } else if ((selected === '"' || selected === "'") && line.substring(range.start.column + 1, range.start.column + 2) === selected) {
        transformed = { start: range.start, end: { row: range.end.row, column: range.end.column + 1 } };
      }
    }
    if (range.end.column === 0 && selected.endsWith('\n')) {
      const line = this.lines[range.end.row];
      if (/^\s+$/.test(line)) range = { start: range.start, end: { row: range.end.row, column: line.length } };
    }
    if (transformed) range = transformed;
    this.removeText(range);
    this.clearSelection();
  }

  /** Tab (Ace's indent): the lines of a selection moved in, else spaces to the next tab stop */
  private indent(): void {
    const range = this.getRange();
    if (range.start.row < range.end.row) {
      const rows = selectedRows(this.doc, range);
      this.indentRows(rows.first, rows.last);
      return;
    }
    if (range.start.column < range.end.column && !/^\s+$/.test(this.textRange(range))) {
      const rows = selectedRows(this.doc, range);
      this.indentRows(rows.first, rows.last);
      return;
    }
    const column = this.layout.documentToScreen(range.start.row, range.start.column).column;
    this.insert(' '.repeat(TAB_SIZE - (column % TAB_SIZE)));
  }

  private indentRows(first: number, last: number): void {
    for (let row = first; row <= last; row += 1) this.insertText({ row, column: 0 }, TAB_STRING);
  }

  /** Shift+Tab (Ace's outdentRows): a tab stop of spaces, or a tab, taken off each line of the selection */
  private outdentRows(range: TextRange): void {
    const lastRow = range.end.column === 0 ? Math.max(range.start.row, range.end.row - 1) : range.end.row;
    for (let row = range.start.row; row <= lastRow; row += 1) {
      const line = this.lines[row];
      let j = 0;
      for (; j < TAB_SIZE; j += 1) if (line.charAt(j) !== ' ') break;
      if (j < TAB_SIZE && line.charAt(j) === '\t') this.removeText({ start: { row, column: j }, end: { row, column: j + 1 } });
      else this.removeText({ start: { row, column: 0 }, end: { row, column: j } });
    }
  }

  /** Whole lines taken out, the line break before them when they end the text (Ace's removeFullLines) */
  private removeFullLines(firstRow: number, lastRow: number): string[] {
    const length = this.lines.length;
    const first = Math.min(Math.max(0, firstRow), length - 1);
    const last = Math.min(Math.max(0, lastRow), length - 1);
    const deleteFirstNewLine = last === length - 1 && first > 0;
    const deleteLastNewLine = last < length - 1;
    const startRow = deleteFirstNewLine ? first - 1 : first;
    const startCol = deleteFirstNewLine ? this.lines[startRow].length : 0;
    const endRow = deleteLastNewLine ? last + 1 : last;
    const endCol = deleteLastNewLine ? 0 : this.lines[endRow].length;
    const removed = this.lines.slice(first, last + 1);
    this.removeText({ start: { row: startRow, column: startCol }, end: { row: endRow, column: endCol } });
    return removed;
  }

  /** Whole lines put in before a row, or after the last (Ace's insertFullLines) */
  private insertFullLines(row: number, lines: string[]): void {
    const at = Math.min(Math.max(row, 0), this.lines.length);
    if (at < this.lines.length) this.insertText({ row: at, column: 0 }, [...lines, ''].join('\n'));
    else this.insertText({ row: at - 1, column: this.lines[at - 1].length }, ['', ...lines].join('\n'));
  }

  /** Lines moved up or down past their neighbours, or copied when the direction is none (Ace's $moveLines) */
  private moveLines(firstRow: number, lastRow: number, dir: number): number {
    const layout = this.layout;
    let first = layout.foldLineAt(firstRow)?.first ?? firstRow;
    let last = layout.foldLineAt(lastRow)?.last ?? lastRow;
    let diff: number;
    if (dir < 0) {
      const row = layout.foldLineAt(first + dir)?.first ?? first + dir;
      if (row < 0) return 0;
      diff = row - first;
    } else if (dir > 0) {
      const row = layout.foldLineAt(last + dir)?.last ?? last + dir;
      if (row > this.lines.length - 1) return 0;
      diff = row - last;
    } else {
      first = Math.max(0, Math.min(first, this.lines.length - 1));
      last = Math.max(0, Math.min(last, this.lines.length - 1));
      diff = last - first + 1;
    }
    const moved = foldsInRange(this.folds, { start: { row: first, column: 0 }, end: { row: last, column: Number.MAX_VALUE } }).map((fold) => shiftRows(fold, diff));
    const lines = dir === 0 ? this.lines.slice(first, last + 1) : this.removeFullLines(first, last);
    this.insertFullLines(first + diff, lines);
    let folds = this.folds;
    for (const fold of moved) folds = addFold(this.lines, folds, fold);
    this.setFolds(folds);
    return diff;
  }

  private editorMoveLines(dir: number, copyLines: boolean): void {
    const range = this.getRange();
    const backwards = isBackwards(this.anchor, this.lead);
    const desired = this.desiredColumn;
    const rows = selectedRows(this.doc, range);
    let moved = this.moveLines(rows.first, rows.last, copyLines ? 0 : dir);
    if (copyLines && dir === -1) moved = 0;
    const shifted = {
      start: { row: range.start.row + moved, column: range.start.column },
      end: { row: range.end.row + moved, column: range.end.column },
    };
    this.setSelectionRange(shifted, backwards);
    this.desiredColumn = desired ?? this.desiredColumn;
  }

  private sortLines(): void {
    const rows = selectedRows(this.doc, this.getRange());
    const lines = this.lines.slice(rows.first, rows.last + 1);
    lines.sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0));
    for (let row = rows.first; row <= rows.last; row += 1) {
      this.replaceText({ start: { row, column: 0 }, end: { row, column: this.lines[row].length } }, lines[row - rows.first]);
    }
  }

  private modifyNumber(amount: number): void {
    const { row, column } = this.lead;
    const c = (this.lines[row] ?? '').slice(column - 1, column);
    if (!c || Number.isNaN(parseFloat(c)) || !Number.isFinite(Number(c))) return;
    const re = /[-]?[0-9]+(?:\.[0-9]+)?/g;
    const line = this.lines[row];
    let number: { value: string; start: number; end: number } | undefined;
    for (let match = re.exec(line); match; match = re.exec(line)) {
      if (match.index <= column && match.index + match[0].length >= column) {
        number = { value: match[0], start: match.index, end: match.index + match[0].length };
        break;
      }
      if (re.lastIndex >= column) break;
    }
    if (!number) return;
    const fp = number.value.includes('.') ? number.start + number.value.indexOf('.') + 1 : number.end;
    const decimals = number.start + number.value.length - fp;
    let t = parseFloat(number.value) * Math.pow(10, decimals);
    const step = fp !== number.end && column < fp ? amount * Math.pow(10, number.end - column - 1) : amount * Math.pow(10, number.end - column);
    t += step;
    t /= Math.pow(10, decimals);
    const text = t.toFixed(decimals);
    this.replaceText({ start: { row, column: number.start }, end: { row, column: number.end } }, text);
    this.moveTo(row, Math.max(number.start + 1, column + text.length - number.value.length));
  }

  private transposeLetters(): void {
    if (!this.isEmpty()) return;
    const { row, column } = this.lead;
    if (column === 0) return;
    const line = this.lines[row];
    let swap: string;
    let range: TextRange;
    if (column < line.length) {
      swap = line.charAt(column) + line.charAt(column - 1);
      range = { start: { row, column: column - 1 }, end: { row, column: column + 1 } };
    } else {
      swap = line.charAt(column - 1) + line.charAt(column - 2);
      range = { start: { row, column: column - 2 }, end: { row, column } };
    }
    this.replaceText(range, swap);
    this.moveTo(range.end.row, range.end.column);
  }

  // --- Undo --------------------------------------------------------------------------------

  private undo(): void {
    const step = this.undoManager.undo();
    if (!step) return;
    this.applyChanges(step);
  }

  private redo(): void {
    const step = this.undoManager.redo();
    if (!step) return;
    this.applyChanges(step);
  }

  private applyChanges(step: { changes: Array<{ from: number; to: number; text: string }>; selection: [number, number] }): void {
    const deltas = this.deltas;
    this.deltas = undefined;
    for (const change of step.changes) {
      const range = { start: this.positionOf(change.from), end: this.positionOf(change.to) };
      const start = this.removeText(range);
      if (change.text) this.insertText(start, change.text);
    }
    this.deltas = deltas;
    this.selectOffsets(step.selection[0], step.selection[1]);
    this.scroll = { cursor: 0.5 };
  }

  get canUndo(): boolean {
    return this.undoManager.canUndo;
  }

  // --- Search --------------------------------------------------------------------------------

  /**
   * Looks for text from the selection on (Ace's Editor.find): the needle given, else the selection,
   * else the last one; selects what it found and asks for it to be shown, or leaves the selection
   * at its start when nothing was found
   */
  find(options: Partial<FindState> & { preventScroll?: boolean }): TextRange | undefined {
    let range = this.getRange();
    const search: FindState = { ...this.search, ...options };
    if (options.needle === undefined) {
      let needle = this.textRange(range) || this.search.needle;
      if (!needle) {
        range = this.wordRange(range.start.row, range.start.column);
        needle = this.textRange(range);
      }
      search.needle = needle;
    }
    if (!options.start) search.start = range;
    this.search = search;
    const found = findRange(this.lines, { ...search, start: search.start ?? range });
    if (options.preventScroll) return found;
    if (found) {
      this.revealRange(found);
      return found;
    }
    if (search.backwards) range.start = range.end;
    else range.end = range.start;
    this.setSelectionRange(range);
    return undefined;
  }

  /** A range selected and shown, the folds about it opened (Ace's revealRange) */
  revealRange(range: TextRange): void {
    this.setFolds(unfoldRange(this.doc, this.folds, range));
    this.setSelectionRange(range);
    this.scroll = { selection: 0.5 };
  }

  /** Every match of the last search; the first one selected, as Ace's single selection keeps it */
  findAll(options: Partial<FindState>): number {
    const search: FindState = { ...this.search, ...options };
    if (search.needle === undefined || search.needle === '') {
      const range = this.isEmpty() ? this.wordRange(this.lead.row, this.lead.column) : this.getRange();
      search.needle = this.textRange(range);
    }
    this.search = search;
    const ranges = findAllRanges(this.lines, search);
    if (!ranges.length) return 0;
    this.setSelectionRange(ranges[0]);
    return ranges.length;
  }

  /** The match of the last search replaced (Ace's Editor.replace) */
  replace(replaceWith: string, options?: Partial<FindState>): number {
    if (this.readOnly) return 0;
    if (options) this.search = { ...this.search, ...options };
    const range = findRange(this.lines, { ...this.search, start: this.search.start ?? this.getRange() });
    if (!range) return 0;
    this.deltas = [];
    this.merge = this.tracker.shouldMerge('replace', undefined);
    let replaced = 0;
    const input = this.textRange(range);
    const text = replacement(input, replaceWith, this.search);
    if (text !== undefined) {
      range.end = this.replaceText(range, text);
      replaced = 1;
    }
    this.undoManager.add(this.deltas, this.merge);
    this.deltas = undefined;
    this.setSelectionRange(range);
    this.scroll = { selection: 0 };
    return replaced;
  }

  /** Every match replaced, from the last (Ace's Editor.replaceAll) */
  replaceAll(replaceWith: string, options?: Partial<FindState>): number {
    if (this.readOnly) return 0;
    if (options) this.search = { ...this.search, ...options };
    const ranges = findAllRanges(this.lines, this.search);
    if (!ranges.length) return 0;
    this.deltas = [];
    this.merge = this.tracker.shouldMerge('replaceAll', undefined);
    const selection = this.getRange();
    const backwards = isBackwards(this.anchor, this.lead);
    this.moveTo(0, 0);
    let replaced = 0;
    for (let index = ranges.length - 1; index >= 0; index -= 1) {
      const text = replacement(this.textRange(ranges[index]), replaceWith, this.search);
      if (text !== undefined) {
        this.replaceText(ranges[index], text);
        replaced += 1;
      }
    }
    this.undoManager.add(this.deltas, this.merge);
    this.deltas = undefined;
    this.setSelectionRange(selection, backwards && false);
    return replaced;
  }

  /** A change made from outside, as typing would make it: the caller's replace of the console */
  replaceOffsets(from: number, to: number, text: string, selectStart: number, selectEnd: number): void {
    if (this.readOnly) return;
    this.deltas = [];
    this.merge = this.tracker.shouldMerge('replaceOffsets', undefined);
    const start = this.positionOf(from);
    const end = this.positionOf(to);
    this.replaceText({ start, end }, text);
    this.undoManager.add(this.deltas, this.merge);
    this.deltas = undefined;
    this.selectOffsets(selectStart, selectEnd);
    this.scroll = { cursor: 0 };
  }

  /** The cursor put on a line, counted from one, its folds opened (Ace's gotoLine) */
  gotoLine(line: number): void {
    const place = this.clip({ row: line - 1, column: 0 });
    this.clearSelection();
    this.setFolds(unfoldRange(this.doc, this.folds, { start: place, end: place }));
    this.moveTo(place.row, 0);
    this.requestScroll({ centerRow: place.row });
  }

  /** A click on a fold: opened, or taken away with its folds inside when the accelerator key is held (Ace's FoldHandler) */
  clickFold(row: number, column: number, remove: boolean): boolean {
    const fold = this.layout.foldAt(row, column, 1);
    if (!fold) return false;
    this.setFolds(remove ? removeFold(this.folds, fold) : expandFold(this.doc, this.folds, fold));
    return true;
  }

  /** A click on the fold mark of a row, with the keys held (Ace's onFoldWidgetClick); false when it found nothing to fold */
  clickFoldWidget(row: number, options: WidgetOptions): boolean {
    const toggled = toggleFoldWidget(this.doc, this.folds, row, options);
    this.setFolds(toggled.folds);
    return toggled.range !== undefined;
  }

  /** A double click on a fold mark: the block the row is in folded or opened (Ace's gutterdblclick) */
  doubleClickFoldWidget(row: number): void {
    const toggled = toggleParentFold(this.doc, this.folds, row);
    this.setFolds(toggled.folds);
    if (toggled.range) this.requestScroll({ rowStart: toggled.range.start.row });
  }
}

/** A fold moved down or up by rows, with the folds inside it */
function shiftRows(fold: Fold, rows: number): Fold {
  return {
    ...fold,
    start: { row: fold.start.row + rows, column: fold.start.column },
    end: { row: fold.end.row + rows, column: fold.end.column },
    inner: fold.inner.map((inner) => shiftRows(inner, rows)),
  };
}

/** The lines of a text, split as Ace splits them */
export function splitLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/);
}

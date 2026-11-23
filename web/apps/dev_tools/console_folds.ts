/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Folding in the console's editors, as Ace 1.2.9 folds the console's modes with its C style fold
 * mode and the "markbeginend" style OpenSearch Dashboards sets: the brackets matched through the
 * tokens of their kind (TokenIterator, $findOpeningBracket, $findClosingBracket), the range a fold
 * mark folds (getFoldWidgetRange), and the folds made, opened and taken away by the commands and
 * the marks of the gutter (addFold, expandFold, toggleFold, foldAll, $toggleFoldWidget). A fold
 * holds the folds that were inside it when it was made, and gives them back when it is opened.
 */

import { foldWidget, type AceToken } from './console_highlight';
import { comparePositions, type Fold, type Position } from './console_layout';
import type { TextRange } from './console_commands';

/** The rows of a text and their tokens, worked out when asked for */
export interface TokenDoc {
  lines: string[];
  tokens: (row: number) => AceToken[];
}

const PAIRS: Record<string, string> = { ')': '(', '(': ')', ']': '[', '[': ']', '{': '}', '}': '{' };

/** Ace's TokenIterator: from the token at a place, forward and back through the rows */
export class TokenIterator {
  row: number;
  index: number;
  private rowTokens: AceToken[];

  constructor(
    private readonly doc: TokenDoc,
    row: number,
    column: number
  ) {
    this.row = row;
    this.rowTokens = doc.tokens(row);
    // The token the character before the place is in (Ace's getTokenAt)
    let c = 0;
    let index = 0;
    for (; index < this.rowTokens.length; index += 1) {
      c += this.rowTokens[index].value.length;
      if (c >= column) break;
    }
    this.index = this.rowTokens[index] ? index : -1;
  }

  current(): AceToken | undefined {
    return this.rowTokens[this.index];
  }

  forward(): AceToken | undefined {
    this.index += 1;
    while (this.index >= this.rowTokens.length) {
      this.row += 1;
      if (this.row >= this.doc.lines.length) {
        this.row = this.doc.lines.length - 1;
        return undefined;
      }
      this.rowTokens = this.doc.tokens(this.row);
      this.index = 0;
    }
    return this.current();
  }

  backward(): AceToken | undefined {
    this.index -= 1;
    while (this.index < 0) {
      this.row -= 1;
      if (this.row < 0) {
        this.row = 0;
        return undefined;
      }
      this.rowTokens = this.doc.tokens(this.row);
      this.index = this.rowTokens.length - 1;
    }
    return this.current();
  }

  column(): number {
    let column = 0;
    for (let index = 0; index < this.index; index += 1) column += this.rowTokens[index].value.length;
    return column;
  }
}

const kindOf = (type: string, from: string, to: RegExp) =>
  new RegExp(`(\\.?${type.replace('.', '\\.').replace(from, '.paren').replace(to, '(?:start|begin|end)')})+`);

/** The bracket that closes one, after a place, among the tokens of its kind */
export function findClosingBracket(doc: TokenDoc, bracket: string, position: Position, typeRe?: RegExp): Position | undefined {
  const closing = PAIRS[bracket];
  let depth = 1;
  const iterator = new TokenIterator(doc, position.row, position.column);
  let token = iterator.current() ?? iterator.forward();
  if (!token) return undefined;
  const kind = typeRe ?? kindOf(token.type, 'lparen', /\b(?:start|begin)\b/);
  let valueIndex = position.column - iterator.column();
  for (;;) {
    const value = token.value;
    while (valueIndex < value.length) {
      const chr = value.charAt(valueIndex);
      if (chr === closing) {
        depth -= 1;
        if (depth === 0) return { row: iterator.row, column: valueIndex + iterator.column() };
      } else if (chr === bracket) {
        depth += 1;
      }
      valueIndex += 1;
    }
    do token = iterator.forward();
    while (token && !kind.test(token.type));
    if (!token) break;
    valueIndex = 0;
  }
  return undefined;
}

/** The bracket that opens one, before a place, among the tokens of its kind */
export function findOpeningBracket(doc: TokenDoc, bracket: string, position: Position, typeRe?: RegExp): Position | undefined {
  const opening = PAIRS[bracket];
  let depth = 1;
  const iterator = new TokenIterator(doc, position.row, position.column);
  let token = iterator.current() ?? iterator.forward();
  if (!token) return undefined;
  const kind = typeRe ?? kindOf(token.type, 'rparen', /\b(?:end)\b/);
  let valueIndex = position.column - iterator.column() - 2;
  let value = token.value;
  for (;;) {
    while (valueIndex >= 0) {
      const chr = value.charAt(valueIndex);
      if (chr === opening) {
        depth -= 1;
        if (depth === 0) return { row: iterator.row, column: valueIndex + iterator.column() };
      } else if (chr === bracket) {
        depth += 1;
      }
      valueIndex -= 1;
    }
    do token = iterator.backward();
    while (token && !kind.test(token.type));
    if (!token) break;
    value = token.value;
    valueIndex = value.length - 1;
  }
  return undefined;
}

/** The bracket that pairs with the one before a place (Ace's findMatchingBracket) */
export function findMatchingBracket(doc: TokenDoc, position: Position, chr?: string): Position | undefined {
  if (position.column === 0) return undefined;
  const before = chr ?? (doc.lines[position.row] ?? '').charAt(position.column - 1);
  if (!before) return undefined;
  if ('([{'.includes(before)) return findClosingBracket(doc, before, position);
  if (')]}'.includes(before)) return findOpeningBracket(doc, before, position);
  return undefined;
}

/** What is between a bracket by a place and its pair, and where the cursor goes for it (Ace's getBracketRange) */
export function bracketRange(doc: TokenDoc, place: Position): (TextRange & { cursor: Position }) | undefined {
  const line = doc.lines[place.row] ?? '';
  let pos = place;
  let before = true;
  let chr = line.charAt(pos.column - 1);
  let match = chr && /([([{])|([)\]}])/.exec(chr);
  if (!match) {
    chr = line.charAt(pos.column);
    pos = { row: pos.row, column: pos.column + 1 };
    match = chr && /([([{])|([)\]}])/.exec(chr);
    before = false;
  }
  if (!match) return undefined;
  if (match[1]) {
    const found = findClosingBracket(doc, match[1], pos);
    if (!found) return undefined;
    const start = { ...pos };
    const end = { ...found };
    if (!before) {
      end.column += 1;
      start.column -= 1;
    }
    return { start, end, cursor: end };
  }
  const found = findOpeningBracket(doc, match[2], pos);
  if (!found) return undefined;
  const start = { ...found };
  const end = { ...pos };
  if (!before) {
    start.column += 1;
    end.column -= 1;
  }
  return { start, end, cursor: start };
}

// --- The ranges the marks fold -------------------------------------------------------------------------

const FOLDING_START = /([{[(])[^}\])]*$|^\s*(\/\*)/;
const FOLDING_STOP = /^[^[{(]*([}\])])|^[\s*]*(\*\/)/;
const START_REGION = /^\s*(\/\*|\/\/)#?region\b/;

const isMultiLine = (range: TextRange) => range.start.row !== range.end.row;

/** A run of comment or string tokens about a place, two characters in from each end (Ace's getCommentFoldRange) */
export function commentFoldRange(doc: TokenDoc, row: number, column: number, dir?: number): TextRange | undefined {
  let iterator = new TokenIterator(doc, row, column);
  let token = iterator.current();
  if (!token || !/^comment|string/.test(token.type)) return undefined;
  const kind = new RegExp(token.type.replace(/\..*/, '\\.'));
  if (dir !== 1) {
    do token = iterator.backward();
    while (token && kind.test(token.type));
    iterator.forward();
  }
  const start = { row: iterator.row, column: iterator.column() + 2 };
  iterator = new TokenIterator(doc, row, column);
  if (dir !== -1) {
    do token = iterator.forward();
    while (token && kind.test(token.type));
    token = iterator.backward();
  } else {
    token = iterator.current();
  }
  const end = { row: iterator.row, column: iterator.column() + (token?.value.length ?? 0) - 2 };
  return { start, end };
}

function openingBracketBlock(doc: TokenDoc, bracket: string, row: number, column: number): TextRange | undefined {
  const start = { row, column: column + 1 };
  const end = findClosingBracket(doc, bracket, start);
  if (!end) return undefined;
  if (foldWidget(doc.lines[end.row]) === 'start' && end.row > start.row) {
    end.row -= 1;
    end.column = doc.lines[end.row].length;
  }
  return { start, end };
}

function closingBracketBlock(doc: TokenDoc, bracket: string, row: number, column: number): TextRange | undefined {
  const end = { row, column };
  const found = findOpeningBracket(doc, bracket, end);
  if (!found) return undefined;
  return { start: { row: found.row, column: found.column + 1 }, end: { row, column: column - 1 } };
}

function commentRegionBlock(doc: TokenDoc, line: string, row: number): TextRange | undefined {
  const startColumn = line.search(/\s*$/);
  const startRow = row;
  const region = /^\s*(?:\/\*|\/\/|--)#?(end)?region\b/;
  let depth = 1;
  let text = line;
  while (++row < doc.lines.length) {
    text = doc.lines[row];
    const match = region.exec(text);
    if (!match) continue;
    if (match[1]) depth -= 1;
    else depth += 1;
    if (!depth) break;
  }
  return row > startRow ? { start: { row: startRow, column: startColumn }, end: { row, column: (doc.lines[row] ?? text).length } } : undefined;
}

function sectionRange(doc: TokenDoc, row: number): TextRange {
  let line = doc.lines[row];
  const startIndent = line.search(/\S/);
  const startRow = row;
  const startColumn = line.length;
  row += 1;
  let endRow = row;
  while (++row < doc.lines.length) {
    line = doc.lines[row];
    const indent = line.search(/\S/);
    if (indent === -1) continue;
    if (startIndent > indent) break;
    const sub = foldWidgetRange(doc, row, false, 'all');
    if (sub) {
      if (sub.start.row <= startRow) break;
      else if (isMultiLine(sub)) row = sub.end.row;
      else if (startIndent === indent) break;
    }
    endRow = row;
  }
  return { start: { row: startRow, column: startColumn }, end: { row: endRow, column: (doc.lines[endRow] ?? '').length } };
}

/** What the fold mark of a row folds (the C style fold mode's getFoldWidgetRange) */
export function foldWidgetRange(doc: TokenDoc, row: number, forceMultiline = false, foldStyle = 'markbeginend'): TextRange | undefined {
  const line = doc.lines[row] ?? '';
  if (START_REGION.test(line)) return commentRegionBlock(doc, line, row);
  let match = FOLDING_START.exec(line);
  if (match) {
    const index = match.index;
    if (match[1]) return openingBracketBlock(doc, match[1], row, index);
    let range = commentFoldRange(doc, row, index + match[0].length, 1);
    if (range && !isMultiLine(range)) {
      if (forceMultiline) range = sectionRange(doc, row);
      else if (foldStyle !== 'all') range = undefined;
    }
    return range;
  }
  match = FOLDING_STOP.exec(line);
  if (match) {
    const index = match.index + match[0].length;
    if (match[1]) return closingBracketBlock(doc, match[1], row, index);
    return commentFoldRange(doc, row, index, -1);
  }
  return undefined;
}

// --- Folds -----------------------------------------------------------------------------------------------

/** -1 when a place is before a range, 1 after it, 0 in it (Ace's Range.compare) */
function compare(range: TextRange, row: number, column: number): number {
  if (!isMultiLine(range) && row === range.start.row) return column < range.start.column ? -1 : column > range.end.column ? 1 : 0;
  if (row < range.start.row) return -1;
  if (row > range.end.row) return 1;
  if (range.start.row === row) return column >= range.start.column ? 0 : -1;
  if (range.end.row === row) return column <= range.end.column ? 0 : 1;
  return 0;
}

/** Ace's Range.compareRange */
function compareRange(range: TextRange, start: Position, end: Position): number {
  let cmp = compare(range, end.row, end.column);
  if (cmp === 1) {
    cmp = compare(range, start.row, start.column);
    return cmp === 1 ? 2 : cmp === 0 ? 1 : 0;
  }
  if (cmp === -1) return -2;
  cmp = compare(range, start.row, start.column);
  return cmp === -1 ? -1 : cmp === 1 ? 42 : 0;
}

/** The folds a range reaches into, by a character at least (Ace's getFoldsInRange) */
export function foldsInRange(folds: Fold[], range: TextRange): Fold[] {
  const start = { row: range.start.row, column: range.start.column + 1 };
  const end = { row: range.end.row, column: range.end.column - 1 };
  const found: Fold[] = [];
  for (const fold of folds) {
    const cmp = compareRange(fold, start, end);
    if (cmp === 2) continue;
    if (cmp === -2 || cmp === 42) break;
    found.push(fold);
  }
  return found;
}

/** The fold that holds a place: with side 1 not one it ends, with -1 not one it starts (Ace's getFoldAt) */
export function foldAt(folds: Fold[], row: number, column: number, side = 0): Fold | undefined {
  const place = { row, column };
  for (const fold of folds) {
    if (comparePositions(fold.start, place) > 0) break;
    if (comparePositions(place, fold.end) > 0) continue;
    if (side === 1 && comparePositions(place, fold.end) === 0) continue;
    if (side === -1 && comparePositions(place, fold.start) === 0) continue;
    return fold;
  }
  return undefined;
}

const sameRange = (a: TextRange, b: TextRange) => comparePositions(a.start, b.start) === 0 && comparePositions(a.end, b.end) === 0;

const insertSorted = (folds: Fold[], fold: Fold) => {
  const out = [...folds];
  let at = out.length;
  while (at > 0 && comparePositions(out[at - 1].start, fold.start) > 0) at -= 1;
  out.splice(at, 0, fold);
  return out;
};

/** A fold put inside another, among the ones already in it (Ace's addSubFold) */
function addInner(parent: Fold, fold: Fold): void {
  if (sameRange(parent, fold)) return;
  const holder = parent.inner.find((each) => comparePositions(each.start, fold.start) <= 0 && comparePositions(each.end, fold.end) >= 0);
  if (holder) {
    addInner(holder, fold);
    return;
  }
  const inside = parent.inner.filter((each) => comparePositions(each.start, fold.start) >= 0 && comparePositions(each.end, fold.end) <= 0);
  fold.inner = [...fold.inner, ...inside];
  parent.inner = insertSorted(
    parent.inner.filter((each) => !inside.includes(each)),
    fold
  );
}

/** The folds with one more (Ace's addFold): the folds inside it go into it */
export function addFold(lines: string[], folds: Fold[], placeholder: string | Fold, range?: TextRange, collapseChildren = 0): Fold[] {
  const clip = (place: Position): Position => {
    if (place.row < 0) return { row: 0, column: 0 };
    if (place.row >= lines.length) return { row: lines.length - 1, column: lines[lines.length - 1].length };
    return { row: place.row, column: Math.max(0, Math.min(place.column, lines[place.row].length)) };
  };
  const added: Fold =
    typeof placeholder === 'string'
      ? { start: clip((range as TextRange).start), end: clip((range as TextRange).end), placeholder, inner: [], collapseChildren }
      : { ...placeholder, start: clip(placeholder.start), end: clip(placeholder.end) };
  const { start, end } = added;
  if (!(start.row < end.row || (start.row === end.row && start.column <= end.column - 2))) return folds;
  const startFold = foldAt(folds, start.row, start.column, 1);
  const endFold = foldAt(folds, end.row, end.column, -1);
  if (startFold && endFold === startFold) {
    addInner(startFold, added);
    return [...folds];
  }
  let next = folds;
  if (startFold && comparePositions(startFold.start, start) !== 0) next = next.filter((fold) => fold !== startFold);
  if (endFold && comparePositions(endFold.end, end) !== 0) next = next.filter((fold) => fold !== endFold);
  const inside = foldsInRange(next, added);
  if (inside.length) {
    next = next.filter((fold) => !inside.includes(fold));
    for (const fold of inside) addInner(added, fold);
  }
  return insertSorted(next, added);
}

export const removeFold = (folds: Fold[], fold: Fold): Fold[] => folds.filter((each) => each !== fold);

/** Every fold mark that starts a block folded, from a row to a row, the blocks in them folded again to a depth when opened (Ace's foldAll) */
export function foldAll(doc: TokenDoc, folds: Fold[], startRow = 0, endRow = doc.lines.length, depth = 100000): Fold[] {
  let next = folds;
  for (let row = startRow || 0; row < (endRow || doc.lines.length); row += 1) {
    if (foldWidget(doc.lines[row] ?? '') !== 'start') continue;
    const range = foldWidgetRange(doc, row);
    if (range && isMultiLine(range) && range.end.row <= (endRow || doc.lines.length) && range.start.row >= startRow) {
      row = range.end.row;
      next = addFold(doc.lines, next, '...', range, depth);
    }
  }
  return next;
}

/** A fold opened: the folds that were in it are given back, and its blocks folded again as it asks (Ace's expandFold) */
export function expandFold(doc: TokenDoc, folds: Fold[], fold: Fold): Fold[] {
  let next = removeFold(folds, fold);
  for (const inner of fold.inner) next = addFold(doc.lines, next, inner);
  if (fold.collapseChildren > 0) next = foldAll(doc, next, fold.start.row + 1, fold.end.row, fold.collapseChildren - 1);
  return next;
}

/** The folds about a range opened, and those then about it, until none is (Ace's unfold of a range) */
export function unfoldRange(doc: TokenDoc, folds: Fold[], range: TextRange, expandInner = false): Fold[] {
  let next = folds;
  let found = foldsInRange(next, range);
  if (expandInner) return next.filter((fold) => !found.includes(fold));
  let guard = 0;
  while (found.length && guard < 1000) {
    for (const fold of found) next = expandFold(doc, next, fold);
    found = foldsInRange(next, range);
    guard += 1;
  }
  return next;
}

/** Alt-L: the fold the cursor is in opened, else what the bracket by it or the selection holds folded (Ace's toggleFold) */
export function toggleFold(doc: TokenDoc, folds: Fold[], selection: TextRange, tryToUnfold: boolean): Fold[] {
  let range: TextRange = { start: { ...selection.start }, end: { ...selection.end } };
  let fold: Fold | undefined;
  if (comparePositions(range.start, range.end) === 0) {
    const cursor = range.start;
    fold = foldAt(folds, cursor.row, cursor.column);
    if (fold) return expandFold(doc, folds, fold);
    let bracket = findMatchingBracket(doc, cursor);
    if (bracket) {
      if (compare(range, bracket.row, bracket.column) === 1) {
        range.end = bracket;
      } else {
        range.start = { row: bracket.row, column: bracket.column + 1 };
        range.end = { row: range.end.row, column: range.end.column - 1 };
      }
    } else if ((bracket = findMatchingBracket(doc, { row: cursor.row, column: cursor.column + 1 }))) {
      if (compare(range, bracket.row, bracket.column) === 1) range.end = bracket;
      else range.start = bracket;
      range.start = { row: range.start.row, column: range.start.column + 1 };
    } else {
      range = commentFoldRange(doc, cursor.row, cursor.column) ?? range;
    }
  } else {
    const inside = foldsInRange(folds, range);
    if (tryToUnfold && inside.length) {
      let next = folds;
      for (const each of inside) next = expandFold(doc, next, each);
      return next;
    }
    if (inside.length === 1) fold = inside[0];
  }
  if (!fold) fold = foldAt(folds, range.start.row, range.start.column);
  if (fold && sameRange(fold, range)) return expandFold(doc, folds, fold);
  let placeholder = '...';
  if (!isMultiLine(range)) {
    placeholder = (doc.lines[range.start.row] ?? '').substring(range.start.column, range.end.column);
    if (placeholder.length < 4) return folds;
    placeholder = `${placeholder.trim().substring(0, 2)}..`;
  }
  return addFold(doc.lines, folds, placeholder, range);
}

/** The block a row is in, and the first block above it (Ace's getParentFoldRangeData) */
export function parentFoldRange(doc: TokenDoc, row: number, ignoreCurrent = false): { range?: TextRange; firstRange?: TextRange } {
  if (ignoreCurrent && foldWidget(doc.lines[row] ?? '')) return {};
  let index = row - 1;
  let firstRange: TextRange | undefined;
  let range: TextRange | undefined;
  while (index >= 0) {
    if (foldWidget(doc.lines[index] ?? '') === 'start') {
      range = foldWidgetRange(doc, index);
      if (!firstRange) firstRange = range;
      if (range && range.end.row >= row) break;
    }
    index -= 1;
  }
  return { range: index !== -1 ? range : undefined, firstRange };
}

export interface WidgetOptions {
  children?: boolean;
  all?: boolean;
  siblings?: boolean;
}

/** A click on a row's fold mark, with the keys held (Ace's $toggleFoldWidget); no range when it did nothing */
export function toggleFoldWidget(doc: TokenDoc, folds: Fold[], row: number, options: WidgetOptions = {}): { folds: Fold[]; range?: TextRange | Fold } {
  const type = foldWidget(doc.lines[row] ?? '');
  const line = doc.lines[row] ?? '';
  const dir = type === 'end' ? -1 : 1;
  let fold = foldAt(folds, row, dir === -1 ? 0 : line.length, dir);
  if (fold) {
    return { folds: options.children || options.all ? removeFold(folds, fold) : expandFold(doc, folds, fold), range: fold };
  }
  const range = foldWidgetRange(doc, row, true);
  if (range && !isMultiLine(range)) {
    fold = foldAt(folds, range.start.row, range.start.column, 1);
    if (fold && sameRange(range, fold)) return { folds: removeFold(folds, fold), range: fold };
  }
  if (options.siblings) {
    const data = parentFoldRange(doc, row);
    const startRow = data.range ? data.range.start.row + 1 : 0;
    const endRow = data.range ? data.range.end.row : doc.lines.length;
    return { folds: foldAll(doc, folds, startRow, endRow, options.all ? 10000 : 0), range };
  }
  if (options.children) {
    const endRow = range ? range.end.row : doc.lines.length;
    return { folds: foldAll(doc, folds, row + 1, endRow, options.all ? 10000 : 0), range };
  }
  if (range) return { folds: addFold(doc.lines, folds, '...', range, options.all ? 10000 : 0), range };
  return { folds, range };
}

/** F2: the fold mark of the cursor's row (the first of its fold), or of the block it is in (Ace's toggleFoldWidget) */
export function toggleFoldWidgetAt(doc: TokenDoc, folds: Fold[], row: number): Fold[] {
  const toggled = toggleFoldWidget(doc, folds, row);
  if (toggled.range) return toggled.folds;
  const data = parentFoldRange(doc, row, true);
  const range = data.range ?? data.firstRange;
  if (!range) return folds;
  const at = range.start.row;
  const fold = foldAt(folds, at, (doc.lines[at] ?? '').length, 1);
  return fold ? removeFold(folds, fold) : addFold(doc.lines, folds, '...', range);
}

/** A double click on a fold mark: the block the row is in folded or opened (Ace's gutterdblclick) */
export function toggleParentFold(doc: TokenDoc, folds: Fold[], row: number): { folds: Fold[]; range?: TextRange } {
  const data = parentFoldRange(doc, row, true);
  const range = data.range ?? data.firstRange;
  if (!range) return { folds };
  const at = range.start.row;
  const fold = foldAt(folds, at, (doc.lines[at] ?? '').length, 1);
  return fold ? { folds: removeFold(folds, fold) } : { folds: addFold(doc.lines, folds, '...', range), range };
}

// --- Folds through a change of the text ----------------------------------------------------------------------

const shift = (place: Position, oldEnd: Position, newEnd: Position): Position =>
  place.row === oldEnd.row
    ? { row: newEnd.row, column: newEnd.column + place.column - oldEnd.column }
    : { row: place.row + newEnd.row - oldEnd.row, column: place.column };

function shiftFold(fold: Fold, oldEnd: Position, newEnd: Position): Fold {
  return {
    ...fold,
    start: shift(fold.start, oldEnd, newEnd),
    end: shift(fold.end, oldEnd, newEnd),
    inner: fold.inner.map((inner) => shiftFold(inner, oldEnd, newEnd)),
  };
}

/**
 * The folds after text from one place to another became text ending at a third: those before stay,
 * those after move with the text, and those the change reaches into go
 */
export function mapFolds(folds: Fold[], start: Position, oldEnd: Position, newEnd: Position): Fold[] {
  if (!folds.length) return folds;
  const out: Fold[] = [];
  for (const fold of folds) {
    if (comparePositions(fold.end, start) <= 0) out.push(fold);
    else if (comparePositions(fold.start, oldEnd) >= 0) out.push(shiftFold(fold, oldEnd, newEnd));
  }
  return out;
}

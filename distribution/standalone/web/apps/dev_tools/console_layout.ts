/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Where the text of a console editor is drawn, worked out as the edit session of Ace 1.2.9 (as
 * brace 0.11.1 holds it, which OpenSearch Dashboards draws its console with) works it out: the
 * rows a long line wraps into ($computeWrapSplits, its further rows indented as the line is and
 * by two more, as Ace wraps the console's modes, which it takes for code), the lines a fold joins
 * into one (FoldLine), and the way from a place in the text to a row and column on the screen and
 * back (documentToScreenPosition, screenToDocumentPosition). A tab takes the columns to the next
 * stop and a wide character two, as Ace counts them. Only numbers are worked out here; the editor
 * draws the rows in view from them, so that a text of any length costs what is in view.
 */

export const TAB_SIZE = 2;

export interface Position {
  row: number;
  column: number;
}

/** A fold: the text from start to end is drawn as its placeholder */
export interface Fold {
  start: Position;
  end: Position;
  placeholder: string;
  /** Folds inside it when it was made, given back when it is opened (Ace's subFolds) */
  inner: Fold[];
  /** How deep its children are folded again when it is opened (Ace's collapseChildren) */
  collapseChildren: number;
}

/** The folds that share rows, drawn on one line (Ace's FoldLine) */
export interface FoldLine {
  folds: Fold[];
  first: number;
  last: number;
}

/** Where a line wraps: the character of its display text each further row starts at, and how far those rows are indented */
export interface Splits {
  at: number[];
  indent: number;
}

export const NO_SPLITS: Splits = { at: [], indent: 0 };

// The kinds of character Ace's wrapping reads
const CHAR = 1;
const CHAR_EXT = 2;
const PLACEHOLDER_START = 3;
const PLACEHOLDER_BODY = 4;
const PUNCTUATION = 9;
const SPACE = 10;
const TAB = 11;
const TAB_SPACE = 12;

/** The characters Ace draws two columns wide */
export function isFullWidth(c: number): boolean {
  if (c < 0x1100) return false;
  return (
    (c >= 0x1100 && c <= 0x115f) ||
    (c >= 0x11a3 && c <= 0x11a7) ||
    (c >= 0x11fa && c <= 0x11ff) ||
    (c >= 0x2329 && c <= 0x232a) ||
    (c >= 0x2e80 && c <= 0x2e99) ||
    (c >= 0x2e9b && c <= 0x2ef3) ||
    (c >= 0x2f00 && c <= 0x2fd5) ||
    (c >= 0x2ff0 && c <= 0x2ffb) ||
    (c >= 0x3000 && c <= 0x303e) ||
    (c >= 0x3041 && c <= 0x3096) ||
    (c >= 0x3099 && c <= 0x30ff) ||
    (c >= 0x3105 && c <= 0x312d) ||
    (c >= 0x3131 && c <= 0x318e) ||
    (c >= 0x3190 && c <= 0x31ba) ||
    (c >= 0x31c0 && c <= 0x31e3) ||
    (c >= 0x31f0 && c <= 0x321e) ||
    (c >= 0x3220 && c <= 0x3247) ||
    (c >= 0x3250 && c <= 0x32fe) ||
    (c >= 0x3300 && c <= 0x4dbf) ||
    (c >= 0x4e00 && c <= 0xa48c) ||
    (c >= 0xa490 && c <= 0xa4c6) ||
    (c >= 0xa960 && c <= 0xa97c) ||
    (c >= 0xac00 && c <= 0xd7a3) ||
    (c >= 0xd7b0 && c <= 0xd7c6) ||
    (c >= 0xd7cb && c <= 0xd7fb) ||
    (c >= 0xf900 && c <= 0xfaff) ||
    (c >= 0xfe10 && c <= 0xfe19) ||
    (c >= 0xfe30 && c <= 0xfe52) ||
    (c >= 0xfe54 && c <= 0xfe66) ||
    (c >= 0xfe68 && c <= 0xfe6b) ||
    (c >= 0xff01 && c <= 0xff60) ||
    (c >= 0xffe0 && c <= 0xffe6)
  );
}

/** The columns a tab at a column takes: to the next stop */
export const tabWidth = (column: number) => TAB_SIZE - (column % TAB_SIZE);

/** Whether every character of a text takes one column: no tab, nothing wide */
const SIMPLE = /^[^\tᄀ-￿]*$/;
export const isSimple = (text: string) => SIMPLE.test(text);

/**
 * The columns a text takes from a column on, and how many of its characters fit before a column
 * is passed (Ace's $getStringScreenWidth)
 */
export function screenWidth(text: string, maxColumn = Infinity, startColumn = 0): [number, number] {
  if (maxColumn === 0) return [0, 0];
  let column = startColumn;
  let index = 0;
  for (; index < text.length; index += 1) {
    const c = text.charCodeAt(index);
    if (c === 9) column += tabWidth(column);
    else if (c >= 0x1100 && isFullWidth(c)) column += 2;
    else column += 1;
    if (column > maxColumn) break;
  }
  return [column, index];
}

/** The display characters of a text, as Ace's $getDisplayTokens reads them, added to a list */
function addDisplayTokens(text: string, out: number[]): void {
  for (let index = 0; index < text.length; index += 1) {
    const c = text.charCodeAt(index);
    if (c === 9) {
      const size = tabWidth(out.length);
      out.push(TAB);
      for (let n = 1; n < size; n += 1) out.push(TAB_SPACE);
    } else if (c === 32) out.push(SPACE);
    else if ((c > 39 && c < 48) || (c > 57 && c < 64)) out.push(PUNCTUATION);
    else if (c >= 0x1100 && isFullWidth(c)) out.push(CHAR, CHAR_EXT);
    else out.push(CHAR);
  }
}

/** Ace's $computeWrapSplits, for a mode it wraps as code, its further rows indented */
export function wrapSplits(tokens: ArrayLike<number>, wrapLimit: number, tabSize = TAB_SIZE): Splits {
  const length = tokens.length;
  if (length === 0) return NO_SPLITS;
  const at: number[] = [];
  let lastSplit = 0;
  let lastDocSplit = 0;
  let indent = 0;
  const maxIndent = wrapLimit <= Math.max(2 * tabSize, 8) ? 0 : Math.floor(wrapLimit / 2);
  const wrapIndent = () => {
    if (maxIndent === 0) return 0;
    let indentation = 0;
    for (let index = 0; index < length; index += 1) {
      const token = tokens[index];
      if (token === SPACE) indentation += 1;
      else if (token === TAB) indentation += tabSize;
      else if (token !== TAB_SPACE) break;
    }
    return Math.min(indentation + tabSize, maxIndent);
  };
  const addSplit = (screenPos: number) => {
    let count = screenPos - lastSplit;
    for (let index = lastSplit; index < screenPos; index += 1) {
      if (tokens[index] === TAB_SPACE || tokens[index] === CHAR_EXT) count -= 1;
    }
    if (!at.length) indent = wrapIndent();
    lastDocSplit += count;
    at.push(lastDocSplit);
    lastSplit = screenPos;
  };
  while (length - lastSplit > wrapLimit - indent) {
    let split = lastSplit + wrapLimit - indent;
    if (tokens[split - 1] >= SPACE && tokens[split] >= SPACE) {
      addSplit(split);
      continue;
    }
    if (tokens[split] === PLACEHOLDER_START || tokens[split] === PLACEHOLDER_BODY) {
      for (; split !== lastSplit - 1; split -= 1) if (tokens[split] === PLACEHOLDER_START) break;
      if (split > lastSplit) {
        addSplit(split);
        continue;
      }
      split = lastSplit + wrapLimit;
      for (; split < length; split += 1) if (tokens[split] !== PLACEHOLDER_BODY) break;
      if (split === length) break;
      addSplit(split);
      continue;
    }
    const minSplit = Math.max(split - (wrapLimit - (wrapLimit >> 2)), lastSplit - 1);
    while (split > minSplit && tokens[split] < PLACEHOLDER_START) split -= 1;
    while (split > minSplit && tokens[split] === PUNCTUATION) split -= 1;
    if (split > minSplit) {
      split += 1;
      addSplit(split);
      continue;
    }
    split = lastSplit + wrapLimit;
    if (tokens[split] === CHAR_EXT) split -= 1;
    addSplit(split - indent);
  }
  return { at, indent };
}

/** Where a line of text wraps */
export function lineSplits(line: string, wrapLimit: number): Splits {
  if (line.length <= wrapLimit && isSimple(line)) return NO_SPLITS;
  const tokens: number[] = [];
  addDisplayTokens(line, tokens);
  return wrapSplits(tokens, wrapLimit);
}

// --- Folds and the lines they make -------------------------------------------------------------------

/** -1 before, 0 the same place, 1 after */
export const comparePositions = (a: Position, b: Position) => (a.row - b.row || a.column - b.column);

/** Whether a range holds a place, its two ends included (Ace's Range.contains) */
export const rangeContains = (range: { start: Position; end: Position }, row: number, column: number) =>
  comparePositions({ row, column }, range.start) >= 0 && comparePositions({ row, column }, range.end) <= 0;

/** The folds, in order, grouped into the lines they are drawn on */
export function foldLinesOf(folds: Fold[]): FoldLine[] {
  const out: FoldLine[] = [];
  for (const fold of folds) {
    const last = out[out.length - 1];
    if (last && fold.start.row === last.last) {
      last.folds.push(fold);
      last.last = fold.end.row;
    } else {
      out.push({ folds: [fold], first: fold.start.row, last: fold.end.row });
    }
  }
  return out;
}

/**
 * The text a fold line shows: its rows with each fold as its placeholder, up to a place when one
 * is given (Ace's getFoldDisplayLine)
 */
export function foldDisplayText(lines: string[], line: FoldLine, endRow = line.last, endColumn = (lines[endRow] ?? '').length): string {
  let text = '';
  let row = line.first;
  let column = 0;
  for (const fold of line.folds) {
    if (comparePositions(fold.start, { row: endRow, column: endColumn }) >= 0) {
      return text + (lines[row] ?? '').substring(column, row === endRow ? endColumn : undefined);
    }
    text += (lines[row] ?? '').substring(column, fold.start.column);
    if (comparePositions(fold.end, { row: endRow, column: endColumn }) > 0) return text + fold.placeholder;
    text += fold.placeholder;
    row = fold.end.row;
    column = fold.end.column;
  }
  return text + (lines[row] ?? '').substring(column, row === endRow ? endColumn : undefined);
}

/** The place of the text a character of a fold line's display text stands for (Ace's idxToPosition) */
export function foldIndexToPosition(line: FoldLine, index: number): Position {
  let left = index;
  let lastEnd = 0;
  for (const fold of line.folds) {
    left -= fold.start.column - lastEnd;
    if (left < 0) return { row: fold.start.row, column: fold.start.column + left };
    left -= fold.placeholder.length;
    if (left < 0) return { ...fold.start };
    lastEnd = fold.end.column;
  }
  const last = line.folds[line.folds.length - 1];
  return { row: last.end.row, column: last.end.column + left };
}

/** The display characters of a fold line, its placeholders marked as Ace marks them */
function foldDisplayTokens(lines: string[], line: FoldLine): number[] {
  const tokens: number[] = [];
  let row = line.first;
  let column = 0;
  for (const fold of line.folds) {
    addDisplayTokens((lines[row] ?? '').substring(column, fold.start.column), tokens);
    const from = tokens.length;
    addDisplayTokens(fold.placeholder, tokens);
    if (tokens.length > from) tokens[from] = PLACEHOLDER_START;
    for (let index = from + 1; index < tokens.length; index += 1) tokens[index] = PLACEHOLDER_BODY;
    row = fold.end.row;
    column = fold.end.column;
  }
  addDisplayTokens((lines[row] ?? '').substring(column), tokens);
  return tokens;
}

// --- The screen ----------------------------------------------------------------------------------------

/** The last index of a sorted list whose value is at most a number */
function lastAtMost(list: ArrayLike<number>, value: number, count = list.length): number {
  let low = 0;
  let high = count - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (list[middle] <= value) low = middle;
    else high = middle - 1;
  }
  return low;
}

/**
 * The screen of an editor: the lines it draws (a line of text, or the lines a fold joins), the
 * rows each takes, and the way between a place of the text and a place on the screen
 */
export class ScreenLayout {
  readonly lines: string[];
  readonly wrap: boolean;
  readonly wrapLimit: number;
  readonly folds: Fold[];
  readonly foldLines: FoldLine[];
  /** How many lines are drawn */
  readonly count: number;
  /** The first row of the text each drawn line shows; none while nothing is folded */
  private readonly firstRows: Int32Array | undefined;
  /**
   * Where each drawn line wraps, the first screen row of each and the number of rows after them
   * all: worked out when first asked for, as a place can be looked for in the folds without them
   */
  private screen: { splits: Splits[]; starts: Int32Array; length: number } | undefined;
  /** Where the lines wrap, kept by the caller between layouts of the same lines and width */
  private readonly known: Array<Splits | undefined> | undefined;
  private foldLineByRow: Map<number, FoldLine>;
  private widest: number | undefined;

  constructor(lines: string[], options: { wrap: boolean; wrapLimit: number; folds?: Fold[]; splits?: Array<Splits | undefined> }) {
    this.lines = lines;
    this.wrap = options.wrap;
    this.wrapLimit = options.wrapLimit;
    this.folds = options.folds ?? [];
    this.known = options.splits;
    this.foldLines = foldLinesOf(this.folds);
    this.foldLineByRow = new Map(this.foldLines.map((line) => [line.first, line]));
    let count = lines.length;
    if (this.foldLines.length) {
      const firstRows = new Int32Array(lines.length);
      let at = 0;
      let next = 0;
      for (let row = 0; row < lines.length; row += 1) {
        firstRows[at] = row;
        at += 1;
        const line = this.foldLines[next];
        if (line && line.first === row) {
          row = line.last;
          next += 1;
        }
      }
      count = at;
      this.firstRows = firstRows;
    }
    this.count = count;
  }

  private screenData(): { splits: Splits[]; starts: Int32Array; length: number } | undefined {
    if (!this.wrap) return undefined;
    if (!this.screen) {
      const count = this.count;
      const splits: Splits[] = new Array(count);
      const starts = new Int32Array(count + 1);
      let screen = 0;
      for (let index = 0; index < count; index += 1) {
        const row = this.firstRowOf(index);
        const foldLine = this.foldLineByRow.get(row);
        let split: Splits;
        if (foldLine) split = wrapSplits(foldDisplayTokens(this.lines, foldLine), this.wrapLimit);
        else {
          // Where each line wraps is kept between layouts of the same lines and width
          const known = this.known?.[row];
          split = known ?? lineSplits(this.lines[row], this.wrapLimit);
          if (this.known && !known) this.known[row] = split;
        }
        splits[index] = split;
        starts[index] = screen;
        screen += split.at.length + 1;
      }
      starts[count] = screen;
      this.screen = { splits, starts, length: screen };
    }
    return this.screen;
  }

  /** How many rows the drawn lines take */
  get screenLength(): number {
    return this.screenData()?.length ?? this.count;
  }

  /** The first row of the text a drawn line shows */
  firstRowOf(index: number): number {
    return this.firstRows ? this.firstRows[index] : index;
  }

  /** The last row of the text a drawn line shows */
  lastRowOf(index: number): number {
    const first = this.firstRowOf(index);
    return this.foldLineByRow.get(first)?.last ?? first;
  }

  /** The fold line a drawn line is, if it is one */
  foldLineOf(index: number): FoldLine | undefined {
    return this.foldLineByRow.get(this.firstRowOf(index));
  }

  /** The drawn line a row of the text is on */
  indexOfRow(row: number): number {
    if (!this.firstRows) return Math.max(0, Math.min(row, this.count - 1));
    return lastAtMost(this.firstRows, row, this.count);
  }

  /** The first screen row of a drawn line */
  screenRowOf(index: number): number {
    const data = this.screenData();
    return data ? data.starts[Math.max(0, Math.min(index, this.count))] : index;
  }

  /** How many screen rows a drawn line takes */
  rowCount(index: number): number {
    const data = this.screenData();
    return data ? data.splits[index].at.length + 1 : 1;
  }

  /** Where a drawn line wraps */
  splitsOf(index: number): Splits {
    return this.screenData()?.splits[index] ?? NO_SPLITS;
  }

  /** The drawn line a screen row is on */
  indexOfScreenRow(screenRow: number): number {
    const data = this.screenData();
    if (!data) return Math.max(0, Math.min(Math.floor(screenRow), this.count - 1));
    return lastAtMost(data.starts, Math.max(0, screenRow), this.count);
  }

  /** The fold line a row of the text is on, if any (Ace's getFoldLine) */
  foldLineAt(row: number): FoldLine | undefined {
    if (!this.foldLines.length) return undefined;
    const line = this.foldLineByRow.get(this.firstRowOf(this.indexOfRow(row)));
    return line && line.first <= row && line.last >= row ? line : undefined;
  }

  /** The fold that holds a place (Ace's getFoldAt): with side 1 not the one it ends, with -1 not the one it starts */
  foldAt(row: number, column: number, side = 0): Fold | undefined {
    const line = this.foldLineAt(row);
    if (!line) return undefined;
    for (const fold of line.folds) {
      if (!rangeContains(fold, row, column)) continue;
      if (side === 1 && fold.end.row === row && fold.end.column === column) continue;
      if (side === -1 && fold.start.row === row && fold.start.column === column) continue;
      return fold;
    }
    return undefined;
  }

  /** The text a drawn line shows */
  displayText(index: number): string {
    const foldLine = this.foldLineOf(index);
    return foldLine ? foldDisplayText(this.lines, foldLine) : this.lines[this.firstRowOf(index)] ?? '';
  }

  /** The place of the text clipped to the text */
  clip(row: number, column: number): Position {
    if (row < 0) return { row: 0, column: 0 };
    const last = this.lines.length - 1;
    if (row > last) return { row: last, column: this.lines[last].length };
    return { row, column: Math.max(0, Math.min(column, this.lines[row].length)) };
  }

  /** Where a place of the text is on the screen (Ace's documentToScreenPosition) */
  documentToScreen(row: number, column: number): Position {
    let place = this.clip(row, column);
    const fold = this.foldAt(place.row, place.column, 1);
    if (fold) place = fold.start;
    const index = this.indexOfRow(place.row);
    const foldLine = this.foldLineOf(index);
    const text = foldLine ? foldDisplayText(this.lines, foldLine, place.row, place.column) : this.lines[place.row].substring(0, place.column);
    let screenRow = this.screenRowOf(index);
    let from = 0;
    let indent = 0;
    if (this.wrap) {
      const splits = this.splitsOf(index);
      let offset = 0;
      while (offset < splits.at.length && text.length >= splits.at[offset]) offset += 1;
      screenRow += offset;
      if (offset > 0) {
        from = splits.at[offset - 1];
        indent = splits.indent;
      }
    }
    return { row: screenRow, column: indent + screenWidth(from ? text.substring(from) : text)[0] };
  }

  /** The place of the text at a place on the screen (Ace's screenToDocumentPosition) */
  screenToDocument(screenRow: number, screenColumn: number): Position {
    if (screenRow < 0) return { row: 0, column: 0 };
    const lastRow = this.lines.length - 1;
    if (screenRow >= this.screenLength) return { row: lastRow, column: this.lines[lastRow].length };
    const index = this.indexOfScreenRow(screenRow);
    const foldLine = this.foldLineOf(index);
    let text = foldLine ? foldDisplayText(this.lines, foldLine) : this.lines[this.firstRowOf(index)];
    const splitIndex = Math.floor(screenRow) - this.screenRowOf(index);
    let docColumn = 0;
    let indent = 0;
    let limit: number | undefined;
    if (this.wrap) {
      const splits = this.splitsOf(index);
      if (splits.at.length) {
        limit = splits.at[splitIndex];
        if (splitIndex > 0) {
          indent = splits.indent;
          docColumn = splits.at[splitIndex - 1] ?? splits.at[splits.at.length - 1];
          text = text.substring(docColumn);
        }
      }
    }
    docColumn += screenWidth(text, screenColumn - indent)[1];
    if (limit !== undefined && docColumn >= limit) docColumn = limit - 1;
    return foldLine ? foldIndexToPosition(foldLine, docColumn) : { row: this.firstRowOf(index), column: docColumn };
  }

  /** The columns of the widest line, when lines do not wrap (Ace's getScreenWidth) */
  screenWidthOfText(): number {
    if (this.wrap) return this.wrapLimit;
    if (this.widest === undefined) {
      let widest = 0;
      for (let index = 0; index < this.count; index += 1) {
        const foldLine = this.foldLineOf(index);
        const text = foldLine ? foldDisplayText(this.lines, foldLine) : this.lines[this.firstRowOf(index)];
        const width = isSimple(text) ? text.length : screenWidth(text)[0];
        if (width > widest) widest = width;
      }
      this.widest = widest;
    }
    return this.widest;
  }
}

/**
 * Where the lines of a text wrap, kept from the lines before them: those the same at the start
 * and at the end keep theirs, the others are worked out again when asked for
 */
export function reuseSplits(previousLines: string[], previous: Array<Splits | undefined>, lines: string[]): Array<Splits | undefined> {
  const out: Array<Splits | undefined> = new Array(lines.length);
  const max = Math.min(previousLines.length, lines.length);
  let first = 0;
  for (; first < max && previousLines[first] === lines[first]; first += 1) out[first] = previous[first];
  for (let same = 0; same < max - first && previousLines[previousLines.length - 1 - same] === lines[lines.length - 1 - same]; same += 1) {
    out[lines.length - 1 - same] = previous[previousLines.length - 1 - same];
  }
  return out;
}

/** The offsets each line of a text starts at */
export function lineStarts(lines: string[]): Int32Array | number[] {
  const starts = lines.length > 0 ? new Int32Array(lines.length) : [];
  let at = 0;
  for (let index = 0; index < lines.length; index += 1) {
    starts[index] = at;
    at += lines[index].length + 1;
  }
  return starts;
}

/** The row and column of an offset */
export function positionOf(starts: ArrayLike<number>, lines: string[], offset: number): Position {
  if (!lines.length) return { row: 0, column: 0 };
  const row = lastAtMost(starts, Math.max(0, offset));
  return { row, column: Math.max(0, Math.min(offset - starts[row], lines[row].length)) };
}

/** The offset of a row and column */
export function offsetOf(starts: ArrayLike<number>, lines: string[], place: Position): number {
  if (!lines.length) return 0;
  const row = Math.max(0, Math.min(place.row, lines.length - 1));
  return starts[row] + Math.max(0, Math.min(place.column, lines[row].length));
}

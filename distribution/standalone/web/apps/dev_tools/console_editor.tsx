/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The editors of the console as OpenSearch Dashboards draws them with Ace 1.2.9: a gutter of line
 * numbers with folding marks, tokens coloured by the console's modes, indent guides, the request
 * under the cursor, the active line, the selection and the matching bracket drawn behind the text,
 * and Ace's two pixel cursor. As Ace's virtual renderer does, only the rows in view are drawn, in a
 * scroll area of the height of the whole text, so that an answer of any length costs what a
 * screen of it costs. The text, the selection, the folds and the undo history are kept by the
 * session (console_session); a small text area at the cursor takes what is typed, as Ace's does.
 */

import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { cx } from '../../components/basic';
import { commandKeys, isMacPlatform, keyName, type TextRange } from './console_commands';
import { bracketRange } from './console_folds';
import { foldWidget, tokenClasses, type AceToken, type Highlighted, type HighlightMode } from './console_highlight';
import { TAB_SIZE, comparePositions, isFullWidth, isSimple, type Fold, type Position, type ScreenLayout, type Splits } from './console_layout';
import { SearchBox, matchOffsets, searchCounter, searchRegExp, type SearchHost, type SearchState } from './console_search';
import { ConsoleSession, type ScrollRequest } from './console_session';

const PADDING = 4;
// The gutter's cell padding (19px and 13px) and the pixel Ace adds to it
const GUTTER_PADDING = 33;
/** The rows drawn above and below the ones in view */
const MARGIN_ROWS = 4;
/** Ace marks at most so many matches of a line */
const MAX_MARKS = 500;

export interface ConsoleEditorHandle {
  focus: () => void;
  select: (start: number, end?: number) => void;
  selection: () => [number, number];
  /** Replaces part of the text as typing would, so that undo takes it back */
  replace: (from: number, to: number, text: string, selectStart?: number, selectEnd?: number) => void;
  /** The top of a line from the top of the editor's frame, scrolling taken off */
  lineTop: (line: number) => number | undefined;
  /** The bottom of a line from the top of the editor's frame, scrolling taken off */
  lineBottom: (line: number) => number | undefined;
  /** The top of the row a place of the text is drawn on, from the top of the editor's frame */
  placeTop: (offset: number) => number | undefined;
  /** Where a place of the text is on the page */
  coordinates: (offset: number) => { left: number; top: number; bottom: number } | undefined;
  /** The height of the editor's frame */
  height: () => number;
  /**
   * Ace's wrap limit: the characters a row holds, worked out from the width while lines wrap
   * and kept when they stop; 80, Ace's own, until they have wrapped
   */
  wrapLimit: () => number;
}

export interface ConsoleEditorProps {
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  mode: HighlightMode;
  /** The tokens already worked out for the value, when the caller has them */
  highlighted?: Highlighted;
  fontSize: number;
  wrap: boolean;
  /** The lines of the request under the cursor, from and to */
  snippet?: [number, number];
  /** Rows with an error in the gutter, and its text */
  annotations?: Array<{ row: number; text: string }>;
  onCursor?: (start: number, end: number) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onPaste?: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  onScroll?: (top: number) => void;
  /** The rows were laid out anew: the font was measured, or the editor's size or wrapping changed */
  onLayout?: () => void;
  /** Ace's keyboard mode of OpenSearch Dashboards: Enter starts editing and Escape stops */
  keyboardHint?: boolean;
  handle?: Ref<ConsoleEditorHandle>;
  id?: string;
  inputId?: string;
  label?: string;
  testId?: string;
  className?: string;
  autoFocus?: boolean;
}

interface Box {
  top: number;
  left: number;
  width?: number;
  height: number;
  right?: number;
  radius?: string;
}

const BRACKETS: Record<string, string> = { '(': ')', '[': ']', '{': '}', ')': '(', ']': '[', '}': '{' };

/** Where the bracket that pairs with the one before the cursor is, among tokens of its kind (Ace's findMatchingBracket) */
export function matchingBracket(lines: AceToken[][], rows: string[], row: number, column: number): { row: number; column: number } | undefined {
  if (column === 0) return undefined;
  const char = rows[row]?.charAt(column - 1);
  if (!char || !BRACKETS[char]) return undefined;
  const opening = '([{'.includes(char);
  const tokens = lines[row] ?? [];
  let at = 0;
  let index = 0;
  for (; index < tokens.length; index += 1) {
    if (at + tokens[index].value.length >= column) break;
    at += tokens[index].value.length;
  }
  const token = tokens[index];
  if (!token) return undefined;
  const kind = new RegExp(
    `(\\.?${token.type
      .replace('.', '\\.')
      .replace(opening ? 'lparen' : 'rparen', '.paren')
      .replace(/\b(?:start|begin|end)\b/, '(?:start|begin|end)')})+`
  );
  const other = BRACKETS[char];
  let depth = 1;
  let r = row;
  let i = index;
  let tokenStart = at;
  let position = column - 1 - tokenStart + (opening ? 1 : -1);
  for (;;) {
    const value = lines[r][i]?.value ?? '';
    while (opening ? position < value.length : position >= 0) {
      const c = value.charAt(position);
      if (c === char) depth += 1;
      else if (c === other) {
        depth -= 1;
        if (depth === 0) return { row: r, column: tokenStart + position };
      }
      position += opening ? 1 : -1;
    }
    // On to the next or previous token of the kind
    do {
      if (opening) {
        tokenStart += lines[r][i]?.value.length ?? 0;
        i += 1;
        while (r < lines.length && i >= lines[r].length) {
          r += 1;
          i = 0;
          tokenStart = 0;
        }
        if (r >= lines.length) return undefined;
      } else {
        i -= 1;
        while (i < 0) {
          r -= 1;
          if (r < 0) return undefined;
          i = lines[r].length - 1;
          tokenStart = rows[r].length;
        }
        tokenStart -= lines[r][i].value.length;
      }
    } while (!kind.test(lines[r][i].type));
    position = opening ? 0 : lines[r][i].value.length - 1;
  }
}

/**
 * The selection an editor reports: the one a replacement is about to set, while the browser still
 * has the cursor at the end of what was typed for it, else the text area's own. A quote typed and
 * closed leaves the cursor between the two, and the suggestions are asked for from there.
 */
export function selectionOf(
  pending: [number, number] | undefined,
  area: { selectionStart: number; selectionEnd: number } | null
): [number, number] {
  return pending ?? [area?.selectionStart ?? 0, area?.selectionEnd ?? 0];
}

// --- What a line draws ------------------------------------------------------------------------------

/** A run of a drawn row: text of one kind, an indent guide, a fold, or a character two columns wide */
export interface DrawnPiece {
  text: string;
  type: string;
  guide?: boolean;
  fold?: Fold;
  wide?: boolean;
}

interface Piece {
  type: string;
  value: string;
  fold?: Fold;
}

/** The part of a row's tokens between two columns */
function sliceTokens(tokens: AceToken[], from: number, to: number, out: Piece[]): void {
  let at = 0;
  for (const token of tokens) {
    const start = at;
    at += token.value.length;
    if (at <= from) continue;
    if (start >= to) break;
    out.push({ type: token.type, value: token.value.slice(Math.max(0, from - start), to - start) });
  }
}

/** The tokens a drawn line shows: those of its row, or of the rows a fold joins with each fold between them */
export function linePieces(layout: ScreenLayout, index: number, tokens: (row: number) => AceToken[]): Piece[] {
  const foldLine = layout.foldLineOf(index);
  if (!foldLine) return tokens(layout.firstRowOf(index));
  const out: Piece[] = [];
  let row = foldLine.first;
  let column = 0;
  for (const fold of foldLine.folds) {
    sliceTokens(tokens(row), column, fold.start.column, out);
    out.push({ type: 'fold', value: fold.placeholder, fold });
    row = fold.end.row;
    column = fold.end.column;
  }
  sliceTokens(tokens(row), column, Infinity, out);
  return out;
}

const GUIDE = /\s\S| \t|\t |\s$/;

/**
 * The rows a line is drawn on, as Ace's text layer writes them ($renderSimpleLine,
 * $renderWrappedLine): the indent guides of the first token, tabs as spaces to the next stop, and
 * each further row of a wrapped line started with the spaces it is indented by
 */
export function drawnRows(pieces: Piece[], splits: Splits): DrawnPiece[][] {
  const rows: DrawnPiece[][] = [[]];
  let row = rows[0];
  let chars = 0;
  let split = 0;
  let column = 0;
  let splitChars = splits.at[0] ?? Number.MAX_VALUE;
  const write = (piece: Piece, value: string) => {
    if (!value) return;
    if (piece.fold) {
      row.push({ text: value, type: 'fold', fold: piece.fold });
      column += value.length;
      return;
    }
    if (isSimple(value)) {
      row.push({ text: value, type: piece.type });
      column += value.length;
      return;
    }
    let run = '';
    const flush = () => {
      if (run) row.push({ text: run, type: piece.type });
      run = '';
    };
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      if (code === 9) {
        const size = TAB_SIZE - (column % TAB_SIZE);
        run += ' '.repeat(size);
        column += size;
      } else if (code >= 0x1100 && isFullWidth(code)) {
        flush();
        row.push({ text: value[index], type: piece.type, wide: true });
        column += 2;
      } else {
        run += value[index];
        column += 1;
      }
    }
    flush();
  };
  pieces.forEach((piece, index) => {
    let value = piece.value;
    if (index === 0 && !piece.fold) {
      let cols = value.search(GUIDE);
      if (cols > 0 && cols < splitChars) {
        if (value[0] === ' ') {
          cols -= cols % TAB_SIZE;
          for (let guide = 0; guide < cols / TAB_SIZE; guide += 1) row.push({ text: ' '.repeat(TAB_SIZE), type: 'text', guide: true });
          column += cols;
        } else if (value[0] === '\t') {
          for (let guide = 0; guide < cols; guide += 1) row.push({ text: ' '.repeat(TAB_SIZE), type: 'text', guide: true });
          column += cols * TAB_SIZE;
        } else {
          cols = 0;
        }
        chars += cols;
        value = value.slice(cols);
      }
    }
    while (chars + value.length >= splitChars) {
      write(piece, value.substring(0, splitChars - chars));
      value = value.substring(splitChars - chars);
      chars = splitChars;
      row = [];
      rows.push(row);
      if (splits.indent) row.push({ text: '\xa0'.repeat(splits.indent), type: 'text' });
      split += 1;
      column = 0;
      splitChars = splits.at[split] ?? Number.MAX_VALUE;
    }
    if (value.length) {
      chars += value.length;
      write(piece, value);
    }
  });
  return rows;
}

/** The drawn lines an editor of a height shows from where it is scrolled to, with a margin */
export function drawnRange(layout: ScreenLayout, scrollTop: number, height: number, lineHeight: number): { first: number; last: number } {
  const line = Math.max(1, lineHeight);
  const firstScreen = Math.max(0, Math.floor(scrollTop / line));
  const rows = Math.ceil(height / line) + 1;
  return {
    first: layout.indexOfScreenRow(Math.max(0, firstScreen - MARGIN_ROWS)),
    last: Math.min(layout.count - 1, layout.indexOfScreenRow(firstScreen + rows + MARGIN_ROWS)),
  };
}

/**
 * Where the pane is scrolled to for Ace's "go to line": as it is when the row is wholly in view,
 * else with the row's top in the middle of the height (half a pixel is drawn as none)
 */
export function centredTop(rowTop: number, top: number, height: number, lineHeight: number): number {
  if (rowTop >= top && rowTop + lineHeight <= top + height) return top;
  return Math.max(0, Math.floor(rowTop - height / 2));
}

/**
 * Where to scroll to so that a place is in view (Ace's scrollCursorIntoView): no further than
 * needed, or, with an offset, by that part of the height further when the place was out of view
 */
export function scrollIntoView(
  place: { left: number; top: number },
  now: { top: number; left: number },
  view: { height: number; width: number; lineHeight: number; charWidth: number },
  offset = 0
): { top: number; left: number } {
  let { top, left } = now;
  if (now.top > place.top) {
    let next = place.top;
    if (offset && now.top > place.top + view.lineHeight) next -= offset * view.height;
    top = next;
  } else if (now.top + view.height < place.top + view.lineHeight) {
    let next = place.top;
    if (offset && now.top + view.height < place.top - view.lineHeight) next += offset * view.height;
    top = next + view.lineHeight - view.height;
  }
  if (now.left > place.left) {
    left = place.left < PADDING + 2 * view.charWidth ? 0 : place.left;
  } else if (now.left + view.width < place.left + view.charWidth) {
    left = Math.round(place.left + view.charWidth - view.width);
  } else if (now.left <= PADDING && place.left - now.left < view.charWidth) {
    left = 0;
  }
  return { top: Math.max(0, top), left: Math.max(0, left) };
}

function Row({ pieces, charWidth }: { pieces: DrawnPiece[]; charWidth: number }) {
  const parts: ReactNode[] = [];
  pieces.forEach((piece, index) => {
    if (piece.guide) {
      parts.push(
        <span key={index} className="dvtTok-indent-guide">
          {piece.text}
        </span>
      );
    } else if (piece.fold) {
      parts.push(
        <span key={index} className="dvtAce__foldText" style={{ width: piece.text.length * charWidth }}>
          {piece.text}
        </span>
      );
    } else if (piece.wide) {
      parts.push(
        <span key={index} className={cx('dvtAce__wide', tokenClasses(piece.type))} style={{ width: 2 * charWidth }}>
          {piece.text}
        </span>
      );
    } else {
      const classes = tokenClasses(piece.type);
      parts.push(
        classes ? (
          <span key={index} className={classes}>
            {piece.text}
          </span>
        ) : (
          piece.text
        )
      );
    }
  });
  return <div className="dvtAce__screenRow">{parts}</div>;
}

const samePlace = (a: Position, b: Position) => a.row === b.row && a.column === b.column;

export function ConsoleEditor({
  value,
  onChange,
  readOnly,
  mode,
  highlighted,
  fontSize,
  wrap,
  snippet,
  annotations,
  onCursor,
  onKeyDown,
  onPaste,
  onScroll,
  onLayout,
  keyboardHint,
  handle,
  id,
  inputId,
  label,
  testId,
  className,
  autoFocus,
}: ConsoleEditorProps) {
  const frame = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const probe = useRef<HTMLSpanElement>(null);
  const hint = useRef<HTMLDivElement>(null);
  const [metrics, setMetrics] = useState({ charWidth: fontSize * 0.6, lineHeight: Math.round(fontSize * 1.3) });
  const [focused, setFocused] = useState(false);
  const [scroll, setScroll] = useState({ top: 0, left: 0 });
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [, setVersion] = useState(0);
  const [moves, setMoves] = useState(0);
  const [composing, setComposing] = useState(false);
  const [search, setSearch] = useState<{ opened: number; replace: boolean; initial: string } | undefined>();
  const [invalidWidget, setInvalidWidget] = useState<number | undefined>();

  // The session: the text as the editor has it, which the value given follows and is followed by
  const sessionRef = useRef<ConsoleSession | undefined>(undefined);
  const applied = useRef(value);
  const tokensOf = useRef<Highlighted | undefined>(highlighted);
  const limit = useRef(80);
  let session = sessionRef.current;
  if (!session || session.mode !== mode) {
    session = new ConsoleSession(value, mode, readOnly === true, highlighted);
    sessionRef.current = session;
    applied.current = value;
    tokensOf.current = highlighted;
  }
  session.readOnly = readOnly === true;
  if (applied.current !== value) {
    applied.current = value;
    if (session.getValue() !== value) {
      // A text from outside, as Ace's setValue takes it: the cursor at the start, the folds and the undo history gone
      session.setValue(value, highlighted);
      session.takeChanges();
      tokensOf.current = highlighted;
    }
  }
  if (highlighted && tokensOf.current !== highlighted && session.getValue() === value) {
    session.useTokens(highlighted);
    tokensOf.current = highlighted;
  }
  const current = session;

  const pendingScroll = useRef<ScrollRequest | undefined>(undefined);
  const callbacks = useRef({ onChange, onCursor, onScroll, onLayout });
  callbacks.current = { onChange, onCursor, onScroll, onLayout };
  const keys = useRef<Map<string, string[]> | undefined>(undefined);
  if (!keys.current) keys.current = commandKeys(isMacPlatform());

  // Ace measures its font with a run of "X": the width of one, and the height of a line
  useLayoutEffect(() => {
    const measure = () => {
      const node = probe.current;
      if (!node || !node.clientWidth) return;
      const next = { charWidth: node.clientWidth / 256, lineHeight: node.clientHeight };
      setMetrics((now) => (now.charWidth === next.charWidth && now.lineHeight === next.lineHeight ? now : next));
    };
    measure();
    void document.fonts?.ready.then(measure);
  }, [fontSize]);

  useLayoutEffect(() => {
    const box = frame.current;
    if (!box) return undefined;
    const observe = () => {
      const next = { width: box.clientWidth, height: box.clientHeight };
      setSize((now) => (now.width === next.width && now.height === next.height ? now : next));
    };
    const observer = new ResizeObserver(observe);
    observer.observe(box);
    observe();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (autoFocus) area.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  const { charWidth, lineHeight } = metrics;
  const lines = current.lines;
  // Ace counts to one past the last line when it wraps, and to the last line it shows when not
  const lastShown = wrap ? lines.length + 1 : Math.min(lines.length, Math.floor((scroll.top + size.height) / Math.max(1, lineHeight)) + 1);
  const gutterLayer = Math.ceil(String(lastShown).length * charWidth + GUTTER_PADDING);
  const gutterWidth = gutterLayer + 1;
  if (wrap && charWidth > 0 && size.width > 0) {
    const columns = Math.floor((size.width - gutterWidth - 2 * PADDING) / charWidth);
    if (columns > 1) limit.current = columns;
  }
  current.setWrap(wrap, limit.current);
  current.pageRows = Math.max(1, Math.floor(size.height / Math.max(1, lineHeight)));
  const layout = current.layout;
  const textWidth = Math.max(0, size.width - gutterWidth);
  const contentWidth = wrap ? textWidth : Math.max(textWidth, Math.round(layout.screenWidthOfText() * charWidth) + 2 * PADDING);
  const totalHeight = layout.screenLength * lineHeight;
  const drawn = drawnRange(layout, scroll.top, size.height, lineHeight);

  useLayoutEffect(() => {
    callbacks.current.onLayout?.();
  }, [wrap, size.width, size.height, gutterWidth, charWidth, lineHeight]);

  // Where a place of the text is drawn, from the top left of the text column
  const pixelsOf = (place: Position) => {
    const screen = current.layout.documentToScreen(place.row, place.column);
    return { left: PADDING + screen.column * charWidth, top: screen.row * lineHeight };
  };

  const applyScroll = (request: ScrollRequest) => {
    const box = frame.current;
    if (!box) return;
    const view = { height: box.clientHeight, width: Math.max(0, box.clientWidth - gutterWidth), lineHeight, charWidth };
    let now = { top: box.scrollTop, left: box.scrollLeft };
    if (request.rows) now = { ...now, top: Math.max(0, now.top + request.rows * lineHeight) };
    if (request.centerRow !== undefined) {
      // Ace's gotoLine: a row that is not wholly in view is put in the middle; half a pixel is drawn as none
      now = { ...now, top: centredTop(pixelsOf({ row: request.centerRow, column: 0 }).top, now.top, view.height, lineHeight) };
    }
    if (request.alignRow !== undefined) {
      now = { ...now, top: Math.max(0, Math.floor(pixelsOf({ row: request.alignRow, column: 0 }).top - (view.height - lineHeight) / 2)) };
    }
    if (request.rowStart !== undefined) now = scrollIntoView(pixelsOf({ row: request.rowStart, column: 0 }), now, view);
    if (request.selection !== undefined) {
      now = scrollIntoView(pixelsOf(current.anchor), now, view, request.selection);
      now = scrollIntoView(pixelsOf(current.lead), now, view, request.selection);
    }
    if (request.selectionPart) {
      const range = current.getRange();
      const shown = drawnRange(current.layout, now.top, view.height, lineHeight);
      if (range.start.row >= current.layout.lastRowOf(shown.last) || range.end.row <= current.layout.firstRowOf(shown.first)) {
        now = scrollIntoView(pixelsOf(current.anchor), now, view);
        now = scrollIntoView(pixelsOf(current.lead), now, view);
      }
    }
    if (request.cursor !== undefined) now = scrollIntoView(pixelsOf(current.lead), now, view, request.cursor);
    const maxTop = Math.max(0, current.layout.screenLength * lineHeight - view.height);
    const top = Math.min(Math.round(now.top), Math.round(maxTop));
    if (top !== box.scrollTop) box.scrollTop = top;
    if (now.left !== box.scrollLeft) box.scrollLeft = now.left;
    setScroll((was) => (was.top === box.scrollTop && was.left === box.scrollLeft ? was : { top: box.scrollTop, left: box.scrollLeft }));
  };

  // Scrolled once the rows are laid out, so that the area has the height of the text as it now is
  useLayoutEffect(() => {
    const request = pendingScroll.current;
    if (!request) return;
    pendingScroll.current = undefined;
    applyScroll(request);
  });

  /** After the session was told to do something: what changed is told on, and drawn */
  const flush = () => {
    const changes = current.takeChanges();
    if (changes.text) {
      applied.current = current.getValue();
      callbacks.current.onChange?.(applied.current);
    }
    if (changes.text || changes.selection) {
      const range = current.getRange();
      callbacks.current.onCursor?.(current.offsetOf(range.start), current.offsetOf(range.end));
      setMoves((count) => count + 1);
    }
    if (changes.scroll) pendingScroll.current = { ...pendingScroll.current, ...changes.scroll };
    setVersion((count) => count + 1);
  };

  // The rows not yet read are read in slices of time, as Ace's background tokenizer reads them
  const working = useRef<number | undefined>(undefined);
  const shown = useRef(drawn);
  shown.current = { first: layout.firstRowOf(drawn.first), last: layout.lastRowOf(drawn.last) };
  useEffect(() => {
    if (current.tokens.done || working.current !== undefined) return undefined;
    const work = () => {
      working.current = undefined;
      const tokens = sessionRef.current?.tokens;
      if (!tokens || tokens.done) return;
      const read = tokens.work(20);
      if (read && read.first <= shown.current.last && read.last >= shown.current.first) setVersion((count) => count + 1);
      if (!tokens.done) working.current = window.setTimeout(work, 20);
    };
    working.current = window.setTimeout(work, 20);
    return undefined;
  });
  useEffect(
    () => () => {
      window.clearTimeout(working.current);
      working.current = undefined;
    },
    []
  );

  const focus = () => area.current?.focus({ preventScroll: true });

  useImperativeHandle(handle, () => ({
    focus,
    select: (start, end = start) => {
      current.selectOffsets(start, end);
      current.breakMerge();
      current.requestScroll({ cursor: 0 });
      flush();
    },
    selection: () => {
      const range = current.getRange();
      return [current.offsetOf(range.start), current.offsetOf(range.end)];
    },
    replace: (from, to, text, selectStart = from + text.length, selectEnd = selectStart) => {
      if (readOnly) return;
      focus();
      current.replaceOffsets(from, to, text, selectStart, selectEnd);
      flush();
    },
    lineTop: (line) => current.layout.screenRowOf(current.layout.indexOfRow(line)) * lineHeight - (frame.current?.scrollTop ?? 0),
    lineBottom: (line) => {
      const index = current.layout.indexOfRow(line);
      return (current.layout.screenRowOf(index) + current.layout.rowCount(index)) * lineHeight - (frame.current?.scrollTop ?? 0);
    },
    placeTop: (offset) => pixelsOf(current.positionOf(offset)).top - (frame.current?.scrollTop ?? 0),
    coordinates: (offset) => {
      const box = body.current?.getBoundingClientRect();
      if (!box) return undefined;
      const point = pixelsOf(current.positionOf(offset));
      return { left: box.left + gutterWidth + point.left, top: box.top + point.top, bottom: box.top + point.top + lineHeight };
    },
    height: () => frame.current?.clientHeight ?? 0,
    wrapLimit: () => limit.current,
  }));

  // --- The search box -----------------------------------------------------------------------------

  const findOptions = (state: SearchState) => ({
    needle: state.needle,
    regExp: state.regExp,
    caseSensitive: state.caseSensitive,
    wholeWord: state.wholeWord,
    range: state.range,
  });
  const host: SearchHost = {
    readOnly: readOnly === true,
    find: (state, how) => {
      const found = current.find({ ...findOptions(state), skipCurrent: how.skipCurrent, backwards: how.backwards, wrap: true, preventScroll: how.preventScroll });
      flush();
      current.highlight = searchRegExp(state);
      return Boolean(found);
    },
    findAll: (state) => {
      const found = current.findAll(findOptions(state));
      flush();
      return found > 0;
    },
    replace: (state, replaceWith) => {
      current.replace(replaceWith, findOptions(state));
      flush();
    },
    replaceAll: (state, replaceWith) => {
      current.replaceAll(replaceWith, findOptions(state));
      flush();
    },
    selection: () => current.getRange(),
    counter: (state) => {
      const range = state.range;
      const text = range ? current.textRange(range) : current.getValue();
      const offset = current.offsetOf(current.anchor) - (range ? current.offsetOf(range.start) : 0);
      return searchCounter(text, searchRegExp(state), offset);
    },
    close: () => {
      setSearch(undefined);
      current.highlight = undefined;
      current.takeChanges();
      focus();
    },
  };

  const openSearch = (replace: boolean) => {
    setSearch((now) => ({ opened: (now?.opened ?? 0) + 1, replace, initial: current.selectedText() }));
  };

  // --- Keys and what is typed ---------------------------------------------------------------------

  /** Runs a command of Ace by its name; false when it does not run here */
  const run = (name: string): boolean => {
    if (name === 'find') {
      openSearch(false);
      return true;
    }
    if (name === 'replace') {
      if (readOnly) return false;
      openSearch(true);
      return true;
    }
    if (name === 'gotoline') {
      const line = parseInt(window.prompt('Enter line number:') ?? '', 10);
      if (!Number.isNaN(line)) {
        current.gotoLine(line);
        flush();
      }
      return true;
    }
    const done = current.exec(name);
    if (done) flush();
    return done;
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape' && search && !event.defaultPrevented) {
      onKeyDown?.(event);
      if (!event.defaultPrevented) {
        event.preventDefault();
        host.close();
      }
      return;
    }
    if (event.key === 'Escape' && keyboardHint && !event.defaultPrevented) {
      onKeyDown?.(event);
      if (!event.defaultPrevented) {
        event.preventDefault();
        hint.current?.focus();
      }
      return;
    }
    onKeyDown?.(event);
    if (event.defaultPrevented || event.nativeEvent.isComposing) return;
    const names = keys.current?.get(keyName(event));
    if (!names) return;
    // The command bound last runs, and the one before it when that one does not
    for (let index = names.length - 1; index >= 0; index -= 1) {
      if (run(names[index])) {
        event.preventDefault();
        return;
      }
    }
  };

  const takeInput = () => {
    const target = area.current;
    if (!target) return;
    const text = target.value;
    if (!text) return;
    target.value = '';
    if (current.exec('insertstring', text)) flush();
  };

  const copy = (event: ClipboardEvent<HTMLTextAreaElement>, cut: boolean) => {
    // As Ace: nothing selected, nothing copied
    event.preventDefault();
    if (current.isEmpty()) return;
    event.clipboardData.setData('text/plain', current.selectedText());
    if (cut && current.exec('cut')) flush();
  };

  const paste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    onPaste?.(event);
    if (event.defaultPrevented) return;
    event.preventDefault();
    const text = event.clipboardData.getData('text/plain');
    if (text && current.exec('paste', text)) flush();
  };

  // --- The mouse ------------------------------------------------------------------------------------

  const positionAt = (clientX: number, clientY: number): Position => {
    const box = body.current?.getBoundingClientRect();
    if (!box) return { row: 0, column: 0 };
    const column = Math.round((clientX - box.left - gutterWidth - PADDING) / charWidth);
    const row = Math.floor((clientY - box.top) / lineHeight);
    return current.layout.screenToDocument(Math.max(0, row), Math.max(0, column));
  };

  /** The selection drawn out with the mouse held: by characters, or by the words or lines of a double or triple click */
  const drag = (unit: 'chars' | 'words' | 'lines', clicked: TextRange | undefined) => {
    let last: { x: number; y: number } | undefined;
    const extend = () => {
      const box = frame.current;
      if (!last || !box) return;
      const place = positionAt(last.x, last.y);
      if (unit === 'chars' || !clicked) {
        current.selectTo(place.row, place.column);
      } else {
        const range = unit === 'words' ? current.wordRange(place.row, place.column) : current.lineRange(place.row);
        if (comparePositions(place, clicked.start) < 0) {
          current.setSelectionAnchor(clicked.end.row, clicked.end.column);
          current.selectTo(range.start.row, range.start.column);
        } else if (comparePositions(place, clicked.end) > 0) {
          current.setSelectionAnchor(clicked.start.row, clicked.start.column);
          current.selectTo(range.end.row, range.end.column);
        } else {
          current.setSelectionRange(clicked);
        }
      }
      current.requestScroll({ cursor: 0 });
      flush();
    };
    const move = (event: MouseEvent) => {
      last = { x: event.clientX, y: event.clientY };
      extend();
    };
    // While the mouse is held past an edge the text keeps scrolling under it
    const timer = window.setInterval(() => {
      const rect = frame.current?.getBoundingClientRect();
      if (last && rect && (last.y < rect.top || last.y > rect.bottom || last.x > rect.right || last.x < rect.left)) extend();
    }, 20);
    const up = () => {
      window.clearInterval(timer);
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  };

  const handleMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    // The scroll bars are the browser's
    const box = frame.current;
    if (box) {
      const rect = box.getBoundingClientRect();
      if (event.clientX >= rect.left + box.clientWidth || event.clientY >= rect.top + box.clientHeight) return;
    }
    const place = positionAt(event.clientX, event.clientY);
    current.breakMerge();
    if (event.button !== 0) {
      // Another button moves the cursor only when nothing is selected
      if (current.isEmpty()) {
        current.moveTo(place.row, place.column);
        flush();
      }
      focus();
      return;
    }
    event.preventDefault();
    focus();
    const clicks = event.detail;
    if (clicks <= 1) {
      if (!event.shiftKey && current.clickFold(place.row, place.column, event.ctrlKey || event.metaKey)) {
        flush();
        return;
      }
      if (event.shiftKey) current.selectTo(place.row, place.column);
      else current.moveTo(place.row, place.column);
      flush();
      drag('chars', undefined);
      return;
    }
    if (clicks === 2) {
      let range: TextRange | undefined = bracketRange(current.doc, place);
      if (range && samePlace(range.start, range.end)) {
        range = { start: { row: range.start.row, column: range.start.column - 1 }, end: { row: range.end.row, column: range.end.column + 1 } };
      }
      if (!range) range = current.wordRange(place.row, place.column);
      current.setSelectionRange(range);
      flush();
      drag('words', range);
      return;
    }
    if (clicks === 3) {
      const range = current.lineRange(place.row);
      current.setSelectionRange(range);
      flush();
      drag('lines', range);
      return;
    }
    current.selectAll();
    flush();
  };

  /** A click in the gutter: on a fold mark it folds or opens, elsewhere it takes the whole line, as Ace's does */
  const gutterDown = (row: number, widget: boolean) => (event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    focus();
    current.breakMerge();
    if (widget) {
      const found = current.clickFoldWidget(row, { children: event.shiftKey, all: event.ctrlKey || event.metaKey, siblings: event.altKey });
      setInvalidWidget(found ? undefined : row);
      flush();
      return;
    }
    if (event.button !== 0) return;
    if (event.shiftKey) {
      current.selectTo(row, 0);
    } else if (event.detail === 2) {
      current.selectAll();
    } else {
      const range = current.lineRange(row);
      current.setSelectionRange(range);
    }
    flush();
  };

  // --- What is drawn ----------------------------------------------------------------------------------

  const errorRows = new Map((annotations ?? []).map((annotation) => [annotation.row, annotation.text]));
  const lead = current.lead;
  const leadScreen = layout.documentToScreen(lead.row, lead.column);
  const cursorIndex = layout.indexOfRow(lead.row);
  const firstScreen = layout.screenRowOf(drawn.first);
  const lastScreen = layout.screenRowOf(drawn.last) + layout.rowCount(drawn.last);
  const inView = (screenRow: number) => screenRow >= firstScreen && screenRow < lastScreen;

  const rows: ReactNode[] = [];
  for (let index = drawn.first; index <= drawn.last; index += 1) {
    const row = layout.firstRowOf(index);
    const folded = layout.foldLineOf(index);
    const widget = mode === 'text' ? '' : foldWidget(lines[row] ?? '');
    const closed = widget === 'start' && folded !== undefined && row === folded.first && row < folded.folds[0].end.row;
    const count = layout.rowCount(index);
    const screenRows = drawnRows(
      linePieces(layout, index, (each) => current.tokens.tokens(each)),
      layout.splitsOf(index)
    );
    rows.push(
      <div key={row} className="dvtAce__row" style={{ top: layout.screenRowOf(index) * lineHeight, height: count * lineHeight }}>
        <div
          className={cx('dvtAce__cell', index === cursorIndex && 'dvtAce__cell--active', errorRows.has(row) && 'dvtAce__cell--error')}
          title={errorRows.get(row)}
          onMouseDown={gutterDown(row, false)}
        >
          {row + 1}
          {widget && (
            <span
              className={cx('dvtAce__fold', `dvtAce__fold--${widget}`, closed ? 'dvtAce__fold--closed' : 'dvtAce__fold--open', invalidWidget === row && 'dvtAce__fold--invalid')}
              onMouseDown={gutterDown(row, true)}
              onDoubleClick={(event) => {
                event.stopPropagation();
                current.doubleClickFoldWidget(row);
                flush();
              }}
            />
          )}
        </div>
        <div className="dvtAce__line">
          {screenRows.map((pieces, at) => (
            <Row key={at} pieces={pieces} charWidth={charWidth} />
          ))}
        </div>
      </div>
    );
  }

  // The selection, a box for each of its parts, as Ace's "line" style draws it
  const selection: Box[] = [];
  if (!current.isEmpty()) {
    const range = current.getRange();
    const from = layout.documentToScreen(range.start.row, range.start.column);
    const to = layout.documentToScreen(range.end.row, range.end.column);
    const fromLeft = PADDING + from.column * charWidth;
    const toLeft = PADDING + to.column * charWidth;
    if (from.row === to.row) {
      if (inView(from.row)) selection.push({ top: from.row * lineHeight, left: fromLeft, width: toLeft - fromLeft, height: lineHeight, radius: '3px' });
    } else {
      if (inView(from.row)) selection.push({ top: from.row * lineHeight, left: fromLeft, right: 0, height: lineHeight, radius: '3px 0 0 0' });
      if (to.column > 0 && inView(to.row)) selection.push({ top: to.row * lineHeight, left: PADDING, width: toLeft - PADDING, height: lineHeight, radius: '0 0 3px 3px' });
      const first = Math.max(from.row + 1, firstScreen);
      const last = Math.min(to.row, lastScreen);
      if (last > first) {
        const corners = `${from.column > 0 ? '3px' : '0'} 0 0 ${to.column > 0 ? '0' : '3px'}`;
        selection.push({ top: first * lineHeight, left: PADDING, right: 0, height: (last - first) * lineHeight, radius: first === from.row + 1 && last === to.row ? corners : '0' });
      }
    }
  }

  let snippetBox: Box | undefined;
  if (snippet) {
    const first = layout.indexOfRow(snippet[0]);
    const last = layout.indexOfRow(snippet[1]);
    const top = layout.screenRowOf(first) * lineHeight;
    snippetBox = { top, left: 0, right: 0, height: (layout.screenRowOf(last) + layout.rowCount(last)) * lineHeight - top };
  }

  const match = current.matchingBracket(lead);
  const bracket = match ? pixelsOf(match) : undefined;

  // The word selected, or what is searched for, marked wherever it is in the rows drawn
  const marks: Box[] = [];
  const marked = current.highlight;
  if (marked) {
    for (let index = drawn.first; index <= drawn.last; index += 1) {
      if (layout.foldLineOf(index)) continue;
      const row = layout.firstRowOf(index);
      const found = matchOffsets(lines[row] ?? '', marked);
      for (let each = 0; each < found.length && each < MAX_MARKS; each += 1) {
        if (!found[each].length) continue;
        const from = layout.documentToScreen(row, found[each].offset);
        const to = layout.documentToScreen(row, found[each].offset + found[each].length);
        if (from.row !== to.row) continue;
        marks.push({ top: from.row * lineHeight, left: PADDING + from.column * charWidth, width: (to.column - from.column) * charWidth, height: lineHeight });
      }
    }
  }

  const style = {
    fontSize,
    '--dvtAce-gutter': `${gutterWidth}px`,
    '--dvtAce-line': `${lineHeight}px`,
  } as CSSProperties;
  const cursorLeft = PADDING + leadScreen.column * charWidth;
  const cursorTop = leadScreen.row * lineHeight;

  return (
    <div
      id={id}
      className={cx('dvtAce', wrap && 'dvtAce--wrap', focused && 'dvtAce--focus', readOnly && 'dvtAce--readOnly', className)}
      style={style}
      data-test-subj={testId}
    >
      {keyboardHint && (
        <div
          ref={hint}
          className="dvtAce__hint"
          role="application"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              focus();
            }
          }}
        >
          <div className="dvtAce__hintText">
            <p>Press Enter to start editing.</p>
          </div>
          <div className="dvtAce__hintText">
            <p>When you’re done, press Escape to stop editing.</p>
          </div>
        </div>
      )}
      <span ref={probe} className="dvtAce__probe" aria-hidden>
        {'X'.repeat(256)}
      </span>
      <div
        ref={frame}
        className="dvtAce__scroller"
        onScroll={(event) => {
          const { scrollTop, scrollLeft } = event.currentTarget;
          setScroll((was) => (was.top === scrollTop && was.left === scrollLeft ? was : { top: scrollTop, left: scrollLeft }));
          callbacks.current.onScroll?.(scrollTop);
        }}
        onMouseDown={handleMouseDown}
      >
        <div ref={body} className="dvtAce__body" style={{ height: totalHeight, width: wrap ? undefined : gutterWidth + contentWidth }}>
          <div className="dvtAce__markers" aria-hidden>
            {snippetBox && <div className="dvtAce__snippet" style={{ top: snippetBox.top, height: snippetBox.height }} />}
            {!current.isMultiLine() && <div className="dvtAce__activeLine" style={{ top: cursorTop, height: lineHeight }} />}
            {marks.map((box, index) => (
              <div key={`m${index}`} className="dvtAce__selectedWord" style={{ top: box.top, left: box.left, width: box.width, height: box.height }} />
            ))}
            {selection.map((box, index) => (
              <div
                key={index}
                className="dvtAce__selection"
                style={{ top: box.top, left: box.left, width: box.width, right: box.right, height: box.height, borderRadius: box.radius }}
              />
            ))}
            {bracket && <div className="dvtAce__bracket" style={{ top: bracket.top, left: bracket.left, width: charWidth, height: lineHeight }} />}
          </div>
          <textarea
            ref={area}
            id={inputId}
            className={cx('dvtAce__input', composing && 'dvtAce__input--composing')}
            style={{ top: cursorTop, left: gutterWidth + cursorLeft, width: composing ? undefined : charWidth, height: lineHeight }}
            readOnly={readOnly}
            aria-label={label}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            wrap="off"
            tabIndex={keyboardHint ? -1 : undefined}
            onInput={() => {
              if (!composing) takeInput();
            }}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={() => {
              setComposing(false);
              takeInput();
            }}
            onKeyDown={handleKeyDown}
            onCopy={(event) => copy(event, false)}
            onCut={(event) => copy(event, true)}
            onPaste={paste}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
          />
          <div className="dvtAce__rows" aria-hidden>
            {rows}
          </div>
          <div
            key={moves}
            className={cx('dvtAce__cursor', current.overwrite && 'dvtAce__cursor--overwrite')}
            style={{ top: cursorTop, left: cursorLeft, height: lineHeight, width: current.overwrite ? charWidth : undefined }}
          />
        </div>
      </div>
      {search && <SearchBox host={host} initial={search.initial} replaceShown={search.replace} opened={search.opened} />}
    </div>
  );
}

// --- What could be typed next, in Ace's list -------------------------------------------------------

export interface ConsoleSuggestion {
  label: string;
  meta?: string;
}

export function ConsoleSuggestions({
  items,
  active,
  typed,
  at,
  fontSize,
  onPick,
  onHover,
}: {
  items: ConsoleSuggestion[];
  active: number;
  /** What is typed of the word, drawn in the colour of a match */
  typed: string;
  at: { left: number; top: number };
  fontSize: number;
  onPick: (index: number) => void;
  onHover?: (index: number) => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  const rowHeight = fontSize * 1.4;
  useEffect(() => {
    const element = list.current;
    if (!element) return;
    const top = active * rowHeight;
    if (top < element.scrollTop) element.scrollTop = top;
    else if (top + rowHeight > element.scrollTop + element.clientHeight) element.scrollTop = top + rowHeight - element.clientHeight;
  }, [active, rowHeight]);
  return (
    <div
      ref={list}
      className="dvtSuggest"
      role="listbox"
      aria-label="Autocomplete suggestions"
      style={{ left: at.left - PADDING, top: at.top, fontSize, maxHeight: Math.round(rowHeight * 8) + 2 }}
      data-test-subj="consoleAutocomplete"
    >
      {items.map((item, index) => {
        const matched = typed && item.label.toLowerCase().startsWith(typed.toLowerCase()) ? typed.length : 0;
        return (
          <div
            key={`${item.label}-${index}`}
            role="option"
            aria-selected={index === active}
            className={cx('dvtSuggest__row', index === active && 'dvtSuggest__row--active')}
            style={{ height: rowHeight, lineHeight: `${rowHeight}px` }}
            onMouseDown={(event) => {
              event.preventDefault();
              onPick(index);
            }}
            onMouseEnter={() => onHover?.(index)}
          >
            {matched > 0 && <span className="dvtSuggest__match">{item.label.slice(0, matched)}</span>}
            {item.label.slice(matched)}
            {item.meta && <span className="dvtSuggest__meta">{item.meta}</span>}
          </div>
        );
      })}
    </div>
  );
}

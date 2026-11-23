/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The editors of the console as OpenSearch Dashboards draws them with Ace: a gutter of line
 * numbers with folding marks, tokens coloured by the console's modes, indent guides, the print
 * margin, the request under the cursor, the active line, the selection and the matching bracket
 * drawn behind the text, and Ace's two pixel cursor. What is typed goes to a text area laid out
 * exactly under the drawing, so the browser keeps doing the editing, the undo and the IME.
 */

import {
  memo,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type Ref,
} from 'react';
import { cx } from '../../components/basic';
import { foldWidget, highlight, indentGuides, stateName, tokenClasses, type AceToken, type Highlighted, type HighlightMode } from './console_highlight';

const PADDING = 4;
const TAB_SIZE = 2;
const PRINT_MARGIN_COLUMN = 80;
// The gutter's cell padding (19px and 13px) and the pixel Ace adds to it
const GUTTER_PADDING = 33;

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

interface Point {
  top: number;
  left: number;
}

interface Box {
  top: number;
  left: number;
  width?: number;
  height: number;
  right?: number;
  radius?: string;
}

interface Geometry {
  cursor?: Point;
  activeLine?: number;
  snippet?: Box;
  selection: Box[];
  bracket?: Point;
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

/** The spaces a line starts with */
const indentOf = (line: string) => /^\s*/.exec(line)?.[0] ?? '';

const Line = memo(function Line({ tokens }: { tokens: AceToken[] }) {
  const parts = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    let value = token.value;
    if (index === 0) {
      const { guides, rest } = indentGuides(value, TAB_SIZE);
      for (let guide = 0; guide < guides; guide += 1) {
        parts.push(
          <span key={`g${guide}`} className="dvtTok-indent-guide">
            {value[0] === '\t' ? '\t' : ' '.repeat(TAB_SIZE)}
          </span>
        );
      }
      value = rest;
      if (!value) continue;
    }
    const classes = tokenClasses(token.type);
    parts.push(
      classes ? (
        <span key={index} className={classes}>
          {value}
        </span>
      ) : (
        value
      )
    );
  }
  return <div className="dvtAce__line">{parts}</div>;
});

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
  const rowsBox = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const probe = useRef<HTMLSpanElement>(null);
  const hint = useRef<HTMLDivElement>(null);
  const [metrics, setMetrics] = useState({ charWidth: fontSize * 0.6, lineHeight: Math.round(fontSize * 1.3) });
  const [selection, setSelection] = useState<{ start: number; end: number; backward: boolean }>({ start: 0, end: 0, backward: false });
  const [focused, setFocused] = useState(false);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(0);
  // The width too: a narrower pane wraps lines elsewhere, and all that is drawn over them moves
  const [width, setWidth] = useState(0);
  const [geometry, setGeometry] = useState<Geometry>({ selection: [] });
  const [moves, setMoves] = useState(0);
  const pending = useRef<[number, number] | undefined>(undefined);
  const revealNext = useRef(false);
  // A brace typed where Ace would close it on Enter
  const maybeClose = useRef<number | undefined>(undefined);

  const lines = useMemo(() => value.split('\n'), [value]);
  const tokens = useMemo(() => highlighted ?? highlight(value, mode), [highlighted, value, mode]);
  const starts = useMemo(() => {
    const out: number[] = [];
    let at = 0;
    for (const line of lines) {
      out.push(at);
      at += line.length + 1;
    }
    return out;
  }, [lines]);
  const rowOf = (offset: number) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (starts[middle] <= offset) low = middle;
      else high = middle - 1;
    }
    return low;
  };

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
      setHeight(box.clientHeight);
      setWidth(box.clientWidth);
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
  // Ace counts to one past the last line when it wraps, and to the last line it shows when not
  const lastShown = wrap ? lines.length + 1 : Math.min(lines.length, Math.floor((scrollTop + height) / Math.max(1, lineHeight)) + 1);
  const gutterLayer = Math.ceil(String(lastShown).length * charWidth + GUTTER_PADDING);
  const gutterWidth = gutterLayer + 1;

  const wrapLimit = useRef(80);
  const laidOut = useRef(onLayout);
  laidOut.current = onLayout;
  useLayoutEffect(() => {
    if (wrap && charWidth > 0 && width > 0) {
      const columns = Math.floor((width - gutterWidth - 2 * PADDING) / charWidth);
      if (columns > 1) wrapLimit.current = columns;
    }
    laidOut.current?.();
  }, [wrap, width, height, gutterWidth, charWidth, lineHeight]);
  const cursorRow = rowOf(selection.backward ? selection.start : selection.end);

  // Where a place of the text is drawn, from the top left of the text column
  const pointAt = (offset: number): Point | undefined => {
    const rows = rowsBox.current;
    const box = body.current;
    if (!rows || !box) return undefined;
    const row = rowOf(offset);
    const element = rows.children[row]?.lastElementChild as HTMLElement | null | undefined;
    if (!element) return undefined;
    const origin = box.getBoundingClientRect();
    const left0 = origin.left + gutterWidth;
    let column = offset - starts[row];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const length = node.textContent?.length ?? 0;
      if (column <= length) {
        const range = document.createRange();
        range.setStart(node, column);
        range.setEnd(node, column);
        let rect = range.getClientRects()[0];
        if (!rect && column > 0) {
          range.setStart(node, column - 1);
          const rects = range.getClientRects();
          rect = rects[rects.length - 1];
          if (rect) return { top: rect.top - origin.top, left: rect.right - left0 };
        }
        if (rect) return { top: rect.top - origin.top, left: rect.left - left0 };
        break;
      }
      column -= length;
    }
    const rect = element.getBoundingClientRect();
    return { top: rect.top - origin.top, left: PADDING };
  };

  const rowTop = (row: number) => {
    const element = rowsBox.current?.children[row] as HTMLElement | undefined;
    return element ? element.offsetTop : undefined;
  };

  // Everything drawn behind and over the text, once the text is laid out
  useLayoutEffect(() => {
    const next: Geometry = { selection: [] };
    const lead = selection.backward ? selection.start : selection.end;
    const cursor = pointAt(lead);
    next.cursor = cursor;
    const startRow = rowOf(selection.start);
    const endRow = rowOf(selection.end);
    if (cursor && startRow === endRow) next.activeLine = cursor.top;
    if (selection.start !== selection.end) {
      const from = pointAt(selection.start);
      const to = pointAt(selection.end);
      if (from && to) {
        if (Math.abs(from.top - to.top) < 1) {
          next.selection.push({ top: from.top, left: from.left, width: to.left - from.left, height: lineHeight, radius: '3px' });
        } else {
          next.selection.push({ top: from.top, left: from.left, right: 0, height: lineHeight, radius: '3px 0 0 0' });
          if (to.left > PADDING + 0.5) {
            next.selection.push({ top: to.top, left: PADDING, width: to.left - PADDING, height: lineHeight, radius: '0 0 3px 3px' });
          }
          const middle = to.top - from.top - lineHeight;
          if (middle > 0.5) {
            const corners = `${from.left > PADDING + 0.5 ? '3px' : '0'} 0 0 ${to.left > PADDING + 0.5 ? '0' : '3px'}`;
            next.selection.push({ top: from.top + lineHeight, left: PADDING, right: 0, height: middle, radius: corners });
          }
        }
      }
    }
    if (snippet) {
      const top = rowTop(snippet[0]);
      const bottom = rowTop(snippet[1]);
      if (top !== undefined && bottom !== undefined) next.snippet = { top, left: 0, right: 0, height: bottom + lineHeight - top };
    }
    const cursorColumn = lead - starts[rowOf(lead)];
    const match = matchingBracket(tokens.lines, lines, rowOf(lead), cursorColumn);
    if (match) next.bracket = pointAt(starts[match.row] + match.column);
    setGeometry(next);

    if (revealNext.current && cursor && frame.current) {
      revealNext.current = false;
      const box = frame.current;
      if (cursor.top < box.scrollTop) box.scrollTop = cursor.top;
      else if (cursor.top + lineHeight > box.scrollTop + box.clientHeight) box.scrollTop = cursor.top + lineHeight - box.clientHeight;
      const x = cursor.left + gutterWidth;
      if (x - gutterWidth < box.scrollLeft) box.scrollLeft = Math.max(0, x - gutterWidth - PADDING);
      else if (x + 2 > box.scrollLeft + box.clientWidth) box.scrollLeft = x + 2 - box.clientWidth + PADDING;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, snippet?.[0], snippet?.[1], tokens, metrics, wrap, gutterWidth, height, width]);

  useLayoutEffect(() => {
    if (pending.current && area.current) {
      area.current.setSelectionRange(pending.current[0], pending.current[1]);
      const [start, end] = pending.current;
      pending.current = undefined;
      revealNext.current = true;
      setSelection({ start, end, backward: false });
      setMoves((count) => count + 1);
    }
  });

  const readSelection = () => {
    const target = area.current;
    if (!target) return;
    const next = { start: target.selectionStart, end: target.selectionEnd, backward: target.selectionDirection === 'backward' };
    setSelection((now) => (now.start === next.start && now.end === next.end && now.backward === next.backward ? now : next));
    setMoves((count) => count + 1);
    revealNext.current = true;
    onCursor?.(next.start, next.end);
  };

  const replace = (from: number, to: number, text: string, selectStart = from + text.length, selectEnd = selectStart) => {
    const target = area.current;
    if (!target || readOnly) return;
    target.focus({ preventScroll: true });
    target.setSelectionRange(from, to);
    // Known before the text is typed: what hears of the change asks where the cursor is
    pending.current = [selectStart, selectEnd];
    // Typing, as far as the browser is concerned: it can be undone
    const typed = typeof document.execCommand === 'function' && document.execCommand('insertText', false, text);
    if (!typed || target.value !== `${value.slice(0, from)}${text}${value.slice(to)}`) {
      pending.current = [selectStart, selectEnd];
      onChange?.(`${value.slice(0, from)}${text}${value.slice(to)}`);
      return;
    }
    target.setSelectionRange(selectStart, selectEnd);
    pending.current = [selectStart, selectEnd];
  };

  useImperativeHandle(
    handle,
    () => ({
      focus: () => area.current?.focus(),
      select: (start, end = start) => {
        pending.current = [start, end];
        area.current?.setSelectionRange(start, end);
        setMoves((count) => count + 1);
      },
      selection: () => selectionOf(pending.current, area.current),
      replace,
      lineTop: (line) => {
        const top = rowTop(line);
        return top === undefined ? undefined : top - (frame.current?.scrollTop ?? 0);
      },
      lineBottom: (line) => {
        const element = rowsBox.current?.children[line] as HTMLElement | undefined;
        return element ? element.offsetTop + element.offsetHeight - (frame.current?.scrollTop ?? 0) : undefined;
      },
      placeTop: (offset) => {
        const element = rowsBox.current?.children[rowOf(offset)] as HTMLElement | undefined;
        const point = pointAt(offset);
        const box = body.current?.getBoundingClientRect();
        if (!element || !point || !box) return undefined;
        // How far down its line the row of the place is
        const within = point.top - (element.getBoundingClientRect().top - box.top);
        return element.offsetTop + within - (frame.current?.scrollTop ?? 0);
      },
      coordinates: (offset) => {
        const point = pointAt(offset);
        const box = body.current?.getBoundingClientRect();
        if (!point || !box) return undefined;
        const left = box.left + gutterWidth + point.left;
        return { left, top: box.top + point.top, bottom: box.top + point.top + lineHeight };
      },
      height: () => frame.current?.clientHeight ?? 0,
      wrapLimit: () => wrapLimit.current,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [value, metrics, gutterWidth, readOnly, starts]
  );

  // Ace's editing: soft tabs of two, the indentation kept and deepened after an open brace,
  // brackets closed as they are opened, a closing brace put back under its opening one
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape' && keyboardHint && !event.defaultPrevented) {
      onKeyDown?.(event);
      if (!event.defaultPrevented) {
        event.preventDefault();
        hint.current?.focus();
      }
      return;
    }
    onKeyDown?.(event);
    if (event.defaultPrevented || readOnly || event.nativeEvent.isComposing) return;
    const target = event.currentTarget;
    const { selectionStart: start, selectionEnd: end } = target;
    const row = rowOf(start);
    const line = lines[row];
    const column = start - starts[row];
    const plain = !event.ctrlKey && !event.metaKey && !event.altKey;
    const before = value[start - 1];
    const after = value[end];
    if (event.key === 'Tab' && plain) {
      event.preventDefault();
      const lastRow = rowOf(end);
      if (start === end && !event.shiftKey) {
        replace(start, end, ' '.repeat(TAB_SIZE - (column % TAB_SIZE)));
        return;
      }
      // The lines of the selection move in or out together
      const from = starts[row];
      const to = starts[lastRow] + lines[lastRow].length;
      const block = value.slice(from, to);
      const moved = event.shiftKey ? block.replace(/^( {1,2}|\t)/gm, '') : block.replace(/^/gm, ' '.repeat(TAB_SIZE));
      const shift = event.shiftKey ? -(line.length - line.replace(/^( {1,2}|\t)/, '').length) : TAB_SIZE;
      replace(from, to, moved, Math.max(from, start + shift), end + moved.length - block.length);
      return;
    }
    if (event.key === 'Enter' && plain && !event.shiftKey) {
      event.preventDefault();
      const indent = indentOf(line);
      const opened = start === end && maybeClose.current === start && /^\s*$/.test(value.slice(end, starts[row] + line.length));
      if (start === end && ((before === '{' && after === '}') || (before === '[' && after === ']') || (before === '(' && after === ')'))) {
        const inner = `\n${indent}${' '.repeat(TAB_SIZE)}`;
        replace(start, end, `${inner}\n${indent}`, start + inner.length);
      } else if (opened) {
        const inner = `\n${indent}${' '.repeat(TAB_SIZE)}`;
        replace(start, end, `${inner}\n${indent}}`, start + inner.length);
      } else {
        const state = stateName(row > 0 ? tokens.states[row - 1] : 'start');
        const deeper = state !== 'string_literal' && /^.*[{([]\s*$/.test(line.slice(0, column)) ? ' '.repeat(TAB_SIZE) : '';
        replace(start, end, `\n${indent}${deeper}`);
      }
      maybeClose.current = undefined;
      return;
    }
    maybeClose.current = undefined;
    if (!plain && event.key !== '{' && event.key !== '[' && event.key !== '(' && event.key !== '"') return;
    if (event.ctrlKey || event.metaKey) return;
    if (start !== end && (event.key === '{' || event.key === '[' || event.key === '(' || event.key === '"')) {
      // A selection is put between the pair
      event.preventDefault();
      const close = event.key === '"' ? '"' : BRACKETS[event.key];
      replace(start, end, `${event.key}${value.slice(start, end)}${close}`, start + 1, end + 1);
      return;
    }
    if (start !== end) return;
    if (event.key === '{') {
      event.preventDefault();
      if (after && /[\]})]/.test(after)) replace(start, end, '{}', start + 1);
      else {
        replace(start, end, '{');
        maybeClose.current = start + 1;
      }
    } else if (event.key === '[' || event.key === '(') {
      event.preventDefault();
      replace(start, end, `${event.key}${BRACKETS[event.key]}`, start + 1);
    } else if (event.key === '"') {
      event.preventDefault();
      const quotes = (line.slice(0, column).match(/"/g) ?? []).length;
      if (after === '"' && quotes % 2 === 1) target.setSelectionRange(start + 1, start + 1);
      else if ((before && /\w/.test(before)) || (after && /\w/.test(after))) replace(start, end, '"');
      else replace(start, end, '""', start + 1);
    } else if (/^[}\])]$/.test(event.key)) {
      if (after === event.key) {
        event.preventDefault();
        target.setSelectionRange(start + 1, start + 1);
        readSelection();
      } else if ((event.key === '}' || event.key === ']') && /^\s+$/.test(line.slice(0, column))) {
        // Back under the line its brace opened on
        const open = matchingBracket(highlight(`${value.slice(0, start)}${event.key}`, mode).lines, `${value.slice(0, start)}${event.key}`.split('\n'), row, column + 1);
        if (open) {
          event.preventDefault();
          const indent = indentOf(lines[open.row]);
          replace(starts[row], start, `${indent}${event.key}`);
        }
      }
    } else if (event.key === 'Backspace' && start > 0) {
      if ((before === '{' && after === '}') || (before === '[' && after === ']') || (before === '(' && after === ')') || (before === '"' && after === '"')) {
        event.preventDefault();
        replace(start - 1, start + 1, '');
      }
    }
  };

  // A click in the gutter takes the whole line, as Ace's does
  const selectLine = (row: number) => (event: ReactMouseEvent) => {
    event.preventDefault();
    const target = area.current;
    if (!target) return;
    target.focus({ preventScroll: true });
    const end = row + 1 < starts.length ? starts[row + 1] : value.length;
    target.setSelectionRange(starts[row], end);
    readSelection();
  };

  const errorRows = useMemo(() => new Map((annotations ?? []).map((annotation) => [annotation.row, annotation.text])), [annotations]);
  const folds = useMemo(() => (mode === 'text' ? lines.map(() => '') : lines.map(foldWidget)), [lines, mode]);

  const style = {
    fontSize,
    '--dvtAce-gutter': `${gutterWidth}px`,
    '--dvtAce-line': `${lineHeight}px`,
  } as CSSProperties;
  const cursorShown = geometry.cursor !== undefined;

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
              area.current?.focus();
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
          const top = event.currentTarget.scrollTop;
          setScrollTop(top);
          onScroll?.(top);
        }}
      >
        <div ref={body} className="dvtAce__body">
          <div className="dvtAce__markers" aria-hidden>
            <div className="dvtAce__printMargin" style={{ left: PADDING + PRINT_MARGIN_COLUMN * charWidth }} />
            {geometry.snippet && <div className="dvtAce__snippet" style={{ top: geometry.snippet.top, height: geometry.snippet.height }} />}
            {geometry.activeLine !== undefined && <div className="dvtAce__activeLine" style={{ top: geometry.activeLine, height: lineHeight }} />}
            {geometry.selection.map((box, index) => (
              <div
                key={index}
                className="dvtAce__selection"
                style={{ top: box.top, left: box.left, width: box.width, right: box.right, height: box.height, borderRadius: box.radius }}
              />
            ))}
            {geometry.bracket && (
              <div className="dvtAce__bracket" style={{ top: geometry.bracket.top, left: geometry.bracket.left, width: charWidth, height: lineHeight }} />
            )}
          </div>
          <textarea
            ref={area}
            id={inputId}
            className="dvtAce__input"
            value={value}
            readOnly={readOnly}
            aria-label={label}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            wrap={wrap ? 'soft' : 'off'}
            tabIndex={keyboardHint ? -1 : undefined}
            onChange={(event) => {
              if (readOnly) return;
              revealNext.current = true;
              onChange?.(event.target.value);
            }}
            onKeyDown={handleKeyDown}
            onPaste={onPaste}
            onSelect={readSelection}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
          />
          <div ref={rowsBox} className="dvtAce__rows" aria-hidden>
            {tokens.lines.map((lineTokens, row) => (
              <div key={row} className="dvtAce__row">
                <div
                  className={cx('dvtAce__cell', row === cursorRow && 'dvtAce__cell--active', errorRows.has(row) && 'dvtAce__cell--error')}
                  title={errorRows.get(row)}
                  onMouseDown={selectLine(row)}
                >
                  {row + 1}
                  {folds[row] && <span className={cx('dvtAce__fold', `dvtAce__fold--${folds[row]}`)} />}
                </div>
                <Line tokens={lineTokens} />
              </div>
            ))}
          </div>
          {cursorShown && geometry.cursor && (
            <div key={moves} className="dvtAce__cursor" style={{ top: geometry.cursor.top, left: geometry.cursor.left, height: lineHeight }} />
          )}
        </div>
      </div>
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

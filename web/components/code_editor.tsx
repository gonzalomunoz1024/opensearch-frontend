/* SPDX-License-Identifier: Apache-2.0 */

/*
 * A place to write JSON, a query or a request. The text is drawn line by line, numbered and in
 * colour, and a text area of the same size lies over it with its own text unseen: what is typed
 * goes to the text area, what is read is the drawing. It keeps indentation, closes brackets, puts
 * a selection between the bracket or quote typed over it and its pair, and indents with the Tab
 * key's two spaces.
 */

import {
  memo,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { cx } from './basic';
import { Portal } from './overlay';

/** A run of text of one kind: `kind` is the end of a `tok…` class (Key, String, Number…) */
export interface CodeToken {
  text: string;
  kind?: string;
}

export interface CodeEditorHandle {
  /** Where a line starts, in pixels from the top of the text */
  lineTop(line: number): number | undefined;
  /** Where a place in the text is in the window, for a menu that opens at the cursor */
  coordinates(line: number, column: number): { left: number; top: number; bottom: number } | undefined;
  focus(): void;
  select(start: number, end?: number): void;
  selection(): [number, number];
}

export interface CodeEditorProps {
  value: string;
  onChange?: (value: string) => void;
  readOnly?: boolean;
  height?: number | string;
  /** Grows with its text between these numbers of lines, when no height is given */
  minLines?: number;
  maxLines?: number;
  placeholder?: string;
  ariaLabel?: string;
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  /** Called with the place of the cursor as it moves: Dev Tools runs the request under it */
  onCursor?: (offset: number, end: number) => void;
  onPaste?: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  testId?: string;
  className?: string;
  wrap?: boolean;
  /** The text as lines of coloured runs; without it the text is drawn plain */
  tokenize?: (text: string) => CodeToken[][];
  /** Lines drawn on a band, from the first to the last, counted from 0 */
  markedLines?: [number, number];
  fontSize?: number;
  /** What is drawn over the text and moves with it */
  overlay?: ReactNode;
  handle?: Ref<CodeEditorHandle>;
  /** Called with how far the text is scrolled down */
  onScroll?: (top: number) => void;
  /** Line numbers at the left; on unless said otherwise */
  gutter?: boolean;
}

const PAIRS: Record<string, string> = { '{': '}', '[': ']', '(': ')', '"': '"' };
const LINE_HEIGHT = 18;

/**
 * Where the line of an offset of a text starts, as the original's editor reads it: at 0 for the
 * text's start, whatever follows it (a search before 0 would find a line break at 0)
 */
export function lineStartOf(text: string, offset: number): number {
  return offset <= 0 ? 0 : text.lastIndexOf('\n', offset - 1) + 1;
}

const sameTokens = (a: CodeToken[], b: CodeToken[]) =>
  a.length === b.length && a.every((token, index) => token.text === b[index].text && token.kind === b[index].kind);

const Line = memo(
  function Line({ tokens, marked }: { tokens: CodeToken[]; marked: boolean }) {
    return (
      <div className={marked ? 'atlCodeEditor__line atlCodeEditor__line--marked' : 'atlCodeEditor__line'}>
        {tokens.map((token, index) =>
          token.kind ? (
            <span key={index} className={`tok${token.kind}`}>
              {token.text}
            </span>
          ) : (
            token.text
          )
        )}
      </div>
    );
  },
  (before, after) => before.marked === after.marked && sameTokens(before.tokens, after.tokens)
);

export function CodeEditor({
  value,
  onChange,
  readOnly,
  height,
  minLines = 3,
  maxLines = 30,
  placeholder,
  ariaLabel,
  onKeyDown,
  onCursor,
  onPaste,
  testId,
  className,
  wrap,
  tokenize,
  markedLines,
  fontSize,
  overlay,
  handle,
  onScroll,
  gutter = true,
}: CodeEditorProps) {
  const area = useRef<HTMLTextAreaElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const paint = useRef<HTMLPreElement>(null);
  // Where the cursor goes once React has written a value this editor changed itself
  const pending = useRef<[number, number] | undefined>(undefined);
  const lines = useMemo<CodeToken[][]>(
    () => (tokenize ? tokenize(value) : value.split('\n').map((text) => [{ text }])),
    [tokenize, value]
  );
  const lineHeight = fontSize ? Math.round(fontSize * 1.3) : LINE_HEIGHT;

  // Keeps the line the cursor is on inside the frame, which is what scrolls
  const reveal = (offset: number) => {
    const box = frame.current;
    const line = paint.current?.children[value.slice(0, offset).split('\n').length - 1] as HTMLElement | undefined;
    if (!box || !line) return;
    if (line.offsetTop < box.scrollTop) box.scrollTop = line.offsetTop;
    else if (line.offsetTop + line.offsetHeight > box.scrollTop + box.clientHeight) {
      box.scrollTop = line.offsetTop + line.offsetHeight - box.clientHeight;
    }
  };

  useImperativeHandle(
    handle,
    () => ({
      lineTop: (line) => (paint.current?.children[line] as HTMLElement | undefined)?.offsetTop,
      coordinates: (line, column) => {
        const element = paint.current?.children[line] as HTMLElement | undefined;
        if (!element) return undefined;
        // The place is found in the drawing, which is laid out as the text area is
        let left = column;
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        while (node) {
          const length = node.textContent?.length ?? 0;
          if (left <= length) {
            const range = document.createRange();
            range.setStart(node, left);
            range.setEnd(node, left);
            const rect = range.getClientRects()[0] ?? range.getBoundingClientRect();
            return { left: rect.left, top: rect.top, bottom: rect.bottom };
          }
          left -= length;
          node = walker.nextNode();
        }
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return { left: rect.left + Number.parseFloat(style.paddingLeft), top: rect.top, bottom: rect.top + lineHeight };
      },
      focus: () => area.current?.focus(),
      select: (start, end = start) => {
        pending.current = [start, end];
        area.current?.setSelectionRange(start, end);
        reveal(end);
      },
      selection: () => [area.current?.selectionStart ?? 0, area.current?.selectionEnd ?? 0],
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [value, lineHeight]
  );

  useLayoutEffect(() => {
    if (pending.current && area.current) {
      area.current.setSelectionRange(pending.current[0], pending.current[1]);
      reveal(pending.current[1]);
      pending.current = undefined;
    }
  });

  const edit = (text: string, start: number, end = start) => {
    pending.current = [start, end];
    onChange?.(text);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented || readOnly) return;
    const target = event.currentTarget;
    const { selectionStart: start, selectionEnd: end } = target;
    if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      if (start === end && !event.shiftKey) {
        edit(`${value.slice(0, start)}  ${value.slice(end)}`, start + 2);
        return;
      }
      // Several lines move in or out together
      const lineStart = lineStartOf(value, start);
      const block = value.slice(lineStart, end);
      const moved = event.shiftKey
        ? block.replace(/^ {1,2}/gm, '')
        : block.replace(/^/gm, '  ');
      edit(
        `${value.slice(0, lineStart)}${moved}${value.slice(end)}`,
        Math.max(lineStart, start + (event.shiftKey ? -Math.min(2, start - lineStart) : 2)),
        end + moved.length - block.length
      );
    } else if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      event.preventDefault();
      const lineStart = lineStartOf(value, start);
      const indent = /^[ \t]*/.exec(value.slice(lineStart, start))?.[0] ?? '';
      const before = value[start - 1];
      const after = value[end];
      if ((before === '{' && after === '}') || (before === '[' && after === ']')) {
        edit(
          `${value.slice(0, start)}\n${indent}  \n${indent}${value.slice(end)}`,
          start + indent.length + 3
        );
      } else {
        const deeper = before === '{' || before === '[' ? '  ' : '';
        edit(
          `${value.slice(0, start)}\n${indent}${deeper}${value.slice(end)}`,
          start + 1 + indent.length + deeper.length
        );
      }
    } else if (PAIRS[event.key] && start !== end && !event.ctrlKey && !event.metaKey) {
      // What is selected goes between the pair, as the original's editors put it, unless it is
      // that brace or a quote alone
      const selected = value.slice(start, end);
      const lone = event.key === '"' ? /^["'`]$/.test(selected) : event.key === '{' && selected === '{';
      if (!lone) {
        event.preventDefault();
        edit(
          `${value.slice(0, start)}${event.key}${selected}${PAIRS[event.key]}${value.slice(end)}`,
          start + 1,
          end + 1
        );
      }
    } else if (PAIRS[event.key] && start === end && !event.ctrlKey && !event.metaKey) {
      const next = value[start];
      if (event.key === '"' && next === '"') {
        event.preventDefault();
        target.setSelectionRange(start + 1, start + 1);
      } else if (next === undefined || /[\s,}\])]/.test(next)) {
        event.preventDefault();
        edit(`${value.slice(0, start)}${event.key}${PAIRS[event.key]}${value.slice(end)}`, start + 1);
      }
    } else if (/^[}\])]$/.test(event.key) && start === end && value[start] === event.key) {
      event.preventDefault();
      target.setSelectionRange(start + 1, start + 1);
    } else if (event.key === 'Backspace' && start === end && start > 0 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      // A pair goes as one, as the original's; held with a key that takes a word, the word goes
      const before = value[start - 1];
      if (PAIRS[before] && value[start] === PAIRS[before]) {
        event.preventDefault();
        edit(`${value.slice(0, start - 1)}${value.slice(start + 1)}`, start - 1);
      }
    }
  };

  const shownLines = Math.max(minLines, Math.min(maxLines, lines.length));
  const [markFrom, markTo] = markedLines ?? [-1, -1];
  return (
    <div
      ref={frame}
      className={cx(
        'atlCodeEditor',
        wrap && 'atlCodeEditor--wrap',
        readOnly && 'atlCodeEditor--readOnly',
        !gutter && 'atlCodeEditor--noGutter',
        className
      )}
      style={{
        height: height ?? shownLines * lineHeight + 18,
        ...(fontSize ? { fontSize, lineHeight: `${lineHeight}px` } : {}),
      }}
      tabIndex={readOnly ? 0 : undefined}
      onScroll={onScroll ? (event) => onScroll(event.currentTarget.scrollTop) : undefined}
      aria-label={readOnly ? ariaLabel : undefined}
      // As the original's: the test id on what holds the text and not on the text itself
      data-test-subj={testId}
    >
      <div className="atlCodeEditor__body">
        <pre ref={paint} className="atlCodeEditor__paint" aria-hidden={!readOnly}>
          {lines.map((tokens, index) => (
            <Line key={index} tokens={tokens} marked={index >= markFrom && index <= markTo} />
          ))}
        </pre>
        {!readOnly && (
          <textarea
            ref={area}
            className="atlCodeEditor__input"
            value={value}
            placeholder={placeholder}
            aria-label={ariaLabel}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            wrap={wrap ? 'soft' : 'off'}
            onChange={(event) => onChange?.(event.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={onPaste}
            onSelect={(event) => {
              const { selectionStart, selectionEnd, selectionDirection } = event.currentTarget;
              reveal(selectionDirection === 'backward' ? selectionStart : selectionEnd);
              onCursor?.(selectionStart, selectionEnd);
            }}
          />
        )}
        {overlay}
      </div>
    </div>
  );
}

// --- What could be typed next ------------------------------------------------------------------

export interface SuggestItem {
  label: string;
  /** What kind of thing it is, shown at the right */
  meta?: string;
}

/** The list an editor shows under the cursor; the editor keeps the keys and the choice */
export function SuggestList({
  items,
  active,
  at,
  onPick,
  testId,
}: {
  items: SuggestItem[];
  active: number;
  at: { left: number; top: number };
  onPick: (index: number) => void;
  testId?: string;
}) {
  return (
    <Portal>
      <ul className="atlSuggest" role="listbox" style={{ left: at.left, top: at.top }} data-test-subj={testId}>
        {items.slice(0, 200).map((item, index) => (
          <li
            key={`${item.label}/${item.meta ?? ''}`}
            role="option"
            aria-selected={index === active}
            className={cx('atlSuggest__item', index === active && 'atlSuggest__item--active')}
            onMouseDown={(event) => {
              event.preventDefault();
              onPick(index);
            }}
            ref={index === active ? (node) => node?.scrollIntoView({ block: 'nearest' }) : undefined}
          >
            <span>{item.label}</span>
            {item.meta && <span className="atlSuggest__meta">{item.meta}</span>}
          </li>
        ))}
      </ul>
    </Portal>
  );
}

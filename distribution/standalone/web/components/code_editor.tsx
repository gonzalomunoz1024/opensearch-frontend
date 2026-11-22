/* SPDX-License-Identifier: Apache-2.0 */

/*
 * A place to write JSON, a query or a request: a text area with line numbers that keeps
 * indentation, closes brackets and indents with the Tab key's two spaces.
 */

import { useLayoutEffect, useMemo, useRef, type KeyboardEvent } from 'react';
import { cx } from './basic';

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
  onCursor?: (offset: number) => void;
  testId?: string;
  className?: string;
  wrap?: boolean;
}

const PAIRS: Record<string, string> = { '{': '}', '[': ']', '(': ')', '"': '"' };
const LINE_HEIGHT = 18;

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
  testId,
  className,
  wrap,
}: CodeEditorProps) {
  const area = useRef<HTMLTextAreaElement>(null);
  const gutter = useRef<HTMLDivElement>(null);
  // Where the cursor goes once React has written a value this editor changed itself
  const pending = useRef<[number, number] | undefined>(undefined);
  const lines = useMemo(() => value.split('\n').length, [value]);
  const numbers = useMemo(
    () => Array.from({ length: lines }, (_item, index) => index + 1).join('\n'),
    [lines]
  );

  useLayoutEffect(() => {
    if (pending.current && area.current) {
      area.current.setSelectionRange(pending.current[0], pending.current[1]);
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
      const lineStart = value.lastIndexOf('\n', start - 1) + 1;
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
      const lineStart = value.lastIndexOf('\n', start - 1) + 1;
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
    } else if (event.key === 'Backspace' && start === end && start > 0) {
      const before = value[start - 1];
      if (PAIRS[before] && value[start] === PAIRS[before]) {
        event.preventDefault();
        edit(`${value.slice(0, start - 1)}${value.slice(start + 1)}`, start - 1);
      }
    }
  };

  const shownLines = Math.max(minLines, Math.min(maxLines, lines));
  return (
    <div
      className={cx('atlCodeEditor', className)}
      style={{ height: height ?? shownLines * LINE_HEIGHT + 18 }}
    >
      <div ref={gutter} className="atlCodeEditor__gutter" aria-hidden>
        {numbers}
      </div>
      <textarea
        ref={area}
        className="atlCodeEditor__input"
        style={wrap ? { whiteSpace: 'pre-wrap' } : undefined}
        value={value}
        readOnly={readOnly}
        placeholder={placeholder}
        aria-label={ariaLabel}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        wrap={wrap ? 'soft' : 'off'}
        data-test-subj={testId}
        onChange={(event) => onChange?.(event.target.value)}
        onKeyDown={handleKeyDown}
        onScroll={(event) => {
          if (gutter.current) gutter.current.scrollTop = event.currentTarget.scrollTop;
        }}
        onSelect={(event) => onCursor?.(event.currentTarget.selectionStart)}
      />
    </div>
  );
}

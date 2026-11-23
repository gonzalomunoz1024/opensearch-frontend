/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The expression of a Timeline visualization, as OpenSearch Dashboards' editor takes it: function
 * names after a `.`, argument names inside the parentheses and argument values after `=`, with
 * the texts upstream inserts, and the help of what lies under the mouse.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import '../../styles/timeline_editor.css';
import { CodeEditor, SuggestList, type CodeEditorHandle } from '../../components/code_editor';
import { Portal } from '../../components/overlay';
import { Markdown } from '../../lib/markdown';
import { services } from '../../services';
import { getArgValueSuggestions } from './arg_value_suggestions';
import {
  TRIGGER_CHARACTERS,
  cursorColumn,
  filterCompletions,
  getSuggestion,
  isWordCharacter,
  suggest,
  type ArgValueSuggestions,
  type Completion,
  type TimelineFunction,
} from './expression_context';

// --- The functions the server knows, asked for once ----------------------------------------------

let functionList: Promise<TimelineFunction[]> | undefined;

export function loadTimelineFunctions(): Promise<TimelineFunction[]> {
  functionList ??= services.http.get<TimelineFunction[]>('/api/timeline/functions').then((list) =>
    Array.isArray(list) ? list : []
  );
  // A failed request is asked again the next time
  functionList.catch(() => (functionList = undefined));
  return functionList;
}

function useTimelineFunctions() {
  const list = useRef<TimelineFunction[]>([]);
  useEffect(() => {
    let stale = false;
    loadTimelineFunctions().then(
      (loaded) => {
        if (!stale) list.current = loaded;
      },
      () => undefined
    );
    return () => {
      stale = true;
    };
  }, []);
  return list;
}

function defaultArgValueSuggestions(): ArgValueSuggestions {
  return getArgValueSuggestions({
    findIndexPatterns: async ({ search, fields, perPage }) =>
      (
        await services.savedObjects.find<{ title: string; type?: string }>({
          type: 'index-pattern',
          fields,
          search,
          searchFields: ['title'],
          perPage,
        })
      ).saved_objects,
    getFields: async (id) => (await services.indexPatterns.get(id)).fields,
  });
}

// --- The editor --------------------------------------------------------------------------------

interface Menu {
  items: Completion[];
  /** Where the word the suggestions replace starts */
  from: number;
  active: number;
}

interface Hover {
  offset: number;
  contents: string[];
  at: { left: number; top: number };
}

const HOVER_DELAY = 300;

export interface ExpressionInputProps {
  value: string;
  setValue: (value: string) => void;
}

export function ExpressionInput({ value, setValue }: ExpressionInputProps) {
  const editor = useRef<CodeEditorHandle>(null);
  const functions = useTimelineFunctions();
  const argValueSuggestions = useMemo(defaultArgValueSuggestions, []);
  const [menu, setMenu] = useState<Menu>();
  const [menuAt, setMenuAt] = useState<{ left: number; top: number }>();
  const [hover, setHover] = useState<Hover>();
  const request = useRef(0);
  const hoverTimer = useRef<number>();
  const hoverRequest = useRef(0);
  const latest = useRef(value);
  latest.current = value;

  useLayoutEffect(() => {
    if (!menu) {
      setMenuAt(undefined);
      return;
    }
    const { lineStart } = cursorColumn(value, menu.from);
    const place = editor.current?.coordinates(value.slice(0, menu.from).split('\n').length - 1, menu.from - lineStart);
    setMenuAt(place ? { left: place.left, top: place.bottom + 2 } : undefined);
  }, [menu, value]);

  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);

  const close = () => {
    request.current += 1;
    setMenu(undefined);
  };

  /** Asks for what could be typed at a place of a text, and shows it */
  const open = (text: string, offset: number) => {
    const ask = ++request.current;
    const { column, wordStart } = cursorColumn(text, offset);
    // Upstream gives the parser the cursor's column, which counts from 0 as the parser does
    suggest(text, functions.current, column, argValueSuggestions)
      .then((found) => {
        if (ask !== request.current) return;
        const items = found ? found.list.map((entry) => getSuggestion(entry, found.type)) : [];
        const shown = filterCompletions(items, text.slice(wordStart, offset));
        setMenu(shown.length ? { items: shown, from: wordStart, active: 0 } : undefined);
      })
      .catch(() => {
        if (ask === request.current) setMenu(undefined);
      });
  };

  const accept = (index: number) => {
    const item = menu?.items[index];
    if (!menu || !item) return;
    const [, end] = editor.current?.selection() ?? [menu.from, menu.from];
    const to = Math.max(end, menu.from);
    const next = `${value.slice(0, menu.from)}${item.insertText}${value.slice(to)}`;
    const cursor = menu.from + item.cursor;
    close();
    setValue(next);
    editor.current?.select(cursor);
    editor.current?.focus();
    if (item.retrigger) open(next, cursor);
  };

  /** A change typed here: one character, or the pair of parentheses the editor closes itself */
  const onChange = (next: string) => {
    const previous = value;
    setValue(next);
    setHover(undefined);
    let prefix = 0;
    while (prefix < previous.length && prefix < next.length && previous[prefix] === next[prefix]) prefix += 1;
    const added = next.length - previous.length;
    if (added === 2 && next.slice(prefix, prefix + 2) === '()') {
      open(next, prefix + 1);
      return;
    }
    const [start, end] = editor.current?.selection() ?? [0, 0];
    if (added === 1 && start === end && start > 0) {
      const typed = next[start - 1];
      if (TRIGGER_CHARACTERS.includes(typed) || isWordCharacter(typed)) open(next, start);
      else close();
    } else if (added < 0 && menu && start === end && start > menu.from) {
      // Taking back a character narrows the list again, until the word is gone
      open(next, start);
    } else {
      close();
    }
  };

  /** Inserts a character as typed: this editor closes `(` only, as upstream's does */
  const insertPlain = (event: KeyboardEvent<HTMLTextAreaElement>, text: string) => {
    event.preventDefault();
    const { selectionStart: start, selectionEnd: end } = event.currentTarget;
    const next = `${value.slice(0, start)}${text}${value.slice(end)}`;
    close();
    setValue(next);
    editor.current?.select(start + text.length);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    setHover(undefined);
    if (menu) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const count = menu.items.length;
        setMenu({ ...menu, active: (menu.active + (event.key === 'ArrowDown' ? 1 : count - 1)) % count });
        return;
      }
      if ((event.key === 'Enter' && !event.ctrlKey && !event.metaKey && !event.shiftKey) || event.key === 'Tab') {
        event.preventDefault();
        accept(menu.active);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
      }
    }
    if (event.ctrlKey && event.key === ' ') {
      event.preventDefault();
      open(value, event.currentTarget.selectionEnd);
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const { selectionStart: start, selectionEnd: end } = event.currentTarget;
    if (event.key === '{' || event.key === '[' || event.key === '"') {
      insertPlain(event, event.key);
    } else if (event.key === 'Backspace' && start === end && start > 0) {
      const pair = value.slice(start - 1, start + 1);
      if (pair === '{}' || pair === '[]' || pair === '""') {
        event.preventDefault();
        const next = `${value.slice(0, start - 1)}${value.slice(start)}`;
        setValue(next);
        editor.current?.select(start - 1);
        if (menu && start - 1 > menu.from) open(next, start - 1);
        else close();
      }
    }
  };

  // --- The help of what lies under the mouse ---

  const offsetAt = (x: number, y: number): number | undefined => {
    const handle = editor.current;
    if (!handle) return undefined;
    const lines = latest.current.split('\n');
    let base = 0;
    for (let line = 0; line < lines.length; line += 1) {
      const text = lines[line];
      for (let column = 0; column < text.length; column += 1) {
        const here = handle.coordinates(line, column);
        const after = handle.coordinates(line, column + 1);
        if (!here || !after || y < here.top || y >= here.bottom || x < here.left) continue;
        const right = after.top === here.top ? after.left : here.left + 12;
        if (x < right) return base + column;
      }
      base += text.length + 1;
    }
    return undefined;
  };

  const showHover = (x: number, y: number) => {
    const text = latest.current;
    const offset = offsetAt(x, y);
    if (offset === undefined) {
      setHover(undefined);
      return;
    }
    const ask = ++hoverRequest.current;
    const { column, lineStart } = cursorColumn(text, offset);
    suggest(text, functions.current, column, argValueSuggestions)
      .then((found) => {
        if (ask !== hoverRequest.current || text !== latest.current) return;
        const contents = (found?.list ?? []).map((entry) => entry.help ?? '').filter((help) => help !== '');
        const place = editor.current?.coordinates(text.slice(0, offset).split('\n').length - 1, offset - lineStart);
        setHover(contents.length && place ? { offset, contents, at: { left: place.left, top: place.top } } : undefined);
      })
      .catch(() => {
        if (ask === hoverRequest.current) setHover(undefined);
      });
  };

  const onMouseMove = (event: MouseEvent<HTMLDivElement>) => {
    const { clientX, clientY } = event;
    window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => showHover(clientX, clientY), HOVER_DELAY);
  };

  const onMouseLeave = () => {
    window.clearTimeout(hoverTimer.current);
    hoverRequest.current += 1;
    hoverTimer.current = window.setTimeout(() => setHover(undefined), HOVER_DELAY);
  };

  return (
    <div className="timExpressionInput">
      <span className="atlFormRow__label">Timeline expression</span>
      <div
        className="timExpressionInput__editor"
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) close();
        }}
      >
        <div className="timExpressionInput__absolute">
          <CodeEditor
            handle={editor}
            value={value}
            onChange={onChange}
            onKeyDown={onKeyDown}
            onCursor={(start, end) => {
              if (menu && (start !== end || start < menu.from)) close();
            }}
            onScroll={() => setHover(undefined)}
            height="100%"
            fontSize={14}
            gutter={false}
            wrap
            ariaLabel="Timeline expression"
            className="tlvExpressionEditor"
          />
        </div>
      </div>
      {menu && menuAt && (
        <SuggestList
          items={menu.items.map((item) => ({ label: item.label, meta: item.detail || undefined }))}
          active={menu.active}
          at={menuAt}
          onPick={accept}
          testId="timelineExpressionSuggestions"
        />
      )}
      {hover && (
        <Portal>
          <div
            className="tlvHover"
            role="tooltip"
            style={{ left: hover.at.left, top: hover.at.top }}
            onMouseEnter={() => window.clearTimeout(hoverTimer.current)}
            onMouseLeave={onMouseLeave}
          >
            {hover.contents.map((help, index) => (
              <Markdown key={index} className="tlvHover__part" text={help} />
            ))}
          </div>
        </Portal>
      )}
    </div>
  );
}

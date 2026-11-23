/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The editors of Query Workbench, as the plugin's: Ace in SQL mode with its list of completions
 * for SQL, Ace in text mode without line numbers for PPL, both in the frame the original's code
 * editor puts around Ace, with the hint the Tab key stops on. Here they are the kit's editor, a
 * text area over a drawing of its text, with Ace's keys (`editing.ts`), and what Ace draws besides
 * the text drawn over it: the band of the cursor's line, the selection, the box around the
 * bracket that pairs with the one before the cursor, and the cursor.
 */

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import { flushSync } from 'react-dom';
import { cx } from '../../components/basic';
import { CodeEditor, type CodeEditorHandle } from '../../components/code_editor';
import { Portal } from '../../components/overlay';
import {
  LIST_ROWS,
  insertCompletion,
  listAfterEdit,
  listKey,
  followList,
  openList,
  type Listed,
} from './completing';
import {
  editorKey,
  matchingBracket,
  screenColumn,
  type EditKind,
  type PairMemory,
  type TextEdit,
} from './editing';
import {
  SQL_WORDS,
  completionMeta,
  completionRuns,
  indentGuides,
  tokenizeSql,
  type Language,
} from './model';

const FONT_SIZE = 14;
/** The height of a line: the kit's, the size of the text by 1.3 */
const LINE = Math.round(FONT_SIZE * 1.3);
/** The original's ten rem, of fourteen pixels there */
const HEIGHT = 140;
const LIST_WIDTH = 280;
/** A row of the list: 1.4 lines of its text, as the browser lays them out */
const LIST_ROW = 19.59375;

const sqlLines = (text: string) => indentGuides(tokenizeSql(text));
const textLines = (text: string) => indentGuides(text.split('\n').map((line) => [{ text: line }]));

interface Selected {
  start: number;
  end: number;
  /** Made towards the start of the text: the cursor is at `start` */
  backwards: boolean;
}

/** Where the list is in the window: under the line of its word, or over it */
interface ListPlace {
  left: number;
  top?: number;
  bottom?: number;
  /** The height the window leaves it */
  room: number;
  /** How many characters a row holds */
  columns: number;
}

/** The modifiers of a key as Ace names them in its bindings, in its order */
const modifiers = (event: KeyboardEvent<HTMLTextAreaElement>) =>
  `${event.ctrlKey ? 'Ctrl-' : ''}${event.altKey ? 'Alt-' : ''}${event.shiftKey ? 'Shift-' : ''}${
    event.metaKey ? 'Command-' : ''
  }`;

export function QueryEditor({
  language,
  value,
  onChange,
}: {
  language: Language;
  value: string;
  onChange: (text: string) => void;
}) {
  const sql = language === 'SQL';
  const words = sql ? SQL_WORDS : undefined;
  const box = useRef<HTMLDivElement>(null);
  const hint = useRef<HTMLButtonElement>(null);
  const probe = useRef<HTMLSpanElement>(null);
  const rows = useRef<HTMLDivElement>(null);
  const editor = useRef<CodeEditorHandle>(null);
  const memory = useRef<PairMemory>({});
  // What the key just pressed is to the list of completions, until the text changes with it
  const command = useRef<EditKind>('other');
  // An edit of this page's own is under way: its last step tells the list, not each of its steps
  const applying = useRef(false);
  const listed = useRef<Listed | undefined>(undefined);
  const placing = useRef(false);
  const [, setDrawn] = useState(0);
  const redraw = () => setDrawn((count) => count + 1);
  // The text has the focus: the cursor shows, and the hint is out of the way
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<Selected>({
    start: value.length,
    end: value.length,
    backwards: false,
  });
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(HEIGHT);
  const [place, setPlace] = useState<ListPlace>();
  const [hover, setHover] = useState(-1);

  const area = () => box.current?.querySelector('textarea') ?? undefined;
  const frame = () => box.current?.querySelector<HTMLElement>('.atlCodeEditor') ?? undefined;

  const lines = useMemo(() => value.split('\n'), [value]);
  const starts = useMemo(() => {
    const offsets = [0];
    for (const line of lines) offsets.push(offsets[offsets.length - 1] + line.length + 1);
    return offsets;
  }, [lines]);
  /** The line and the column of a place in the text, and the column it is drawn at */
  const locate = (offset: number) => {
    const at = Math.max(0, Math.min(offset, value.length));
    let row = 0;
    let last = lines.length - 1;
    while (row < last) {
      const middle = (row + last + 1) >> 1;
      if (starts[middle] <= at) row = middle;
      else last = middle - 1;
    }
    const column = at - starts[row];
    return { row, column, screen: screenColumn(lines[row], column) };
  };

  /** The selection of the text area, kept for what is drawn of it */
  const sync = (): Selected | undefined => {
    const input = area();
    if (!input) return undefined;
    const next = {
      start: input.selectionStart,
      end: input.selectionEnd,
      backwards:
        input.selectionDirection === 'backward' && input.selectionStart !== input.selectionEnd,
    };
    setSelected((now) =>
      now.start === next.start && now.end === next.end && now.backwards === next.backwards
        ? now
        : next
    );
    return next;
  };

  // --- The list of completions, as Ace's language tools run it --------------------------------

  /** The list as it is now; one that opens, or opens again, is placed where its word begins */
  const showList = (next: Listed | undefined) => {
    const was = listed.current;
    if (next === was) return;
    listed.current = next;
    if (!next) setPlace(undefined);
    else if (!was || next.list !== was.list) placing.current = true;
    if (!next || !was || next.list !== was.list) setHover(-1);
    redraw();
  };

  const closeList = () => showList(undefined);

  /** What follows an edit or a key that typed: the list opens for a word, or follows it */
  const afterEdit = (text: string, cursor: number, kind: EditKind) => {
    if (words) showList(listAfterEdit(listed.current, text, cursor, kind));
  };

  // --- Edits ----------------------------------------------------------------------------------

  /**
   * Puts an edit into the text area through the browser's own editing, so that its undo keeps
   * every step, then the selection the edit leaves.
   */
  const apply = (edit: TextEdit, kind: EditKind) => {
    const input = area();
    if (!input) return;
    const text = input.value;
    let written = true;
    if (edit.text !== text) {
      // Only what differs is replaced
      let from = 0;
      const shortest = Math.min(text.length, edit.text.length);
      while (from < shortest && text[from] === edit.text[from]) from += 1;
      let oldEnd = text.length;
      let newEnd = edit.text.length;
      while (oldEnd > from && newEnd > from && text[oldEnd - 1] === edit.text[newEnd - 1]) {
        oldEnd -= 1;
        newEnd -= 1;
      }
      const inserted = edit.text.slice(from, newEnd);
      applying.current = true;
      input.setSelectionRange(from, oldEnd);
      const done =
        inserted === ''
          ? document.execCommand('delete')
          : document.execCommand('insertText', false, inserted);
      applying.current = false;
      written = done && input.value === edit.text;
      // A browser without that way of editing: the text is written as any other value
      if (!written) onChange(edit.text);
    }
    if (written) {
      input.setSelectionRange(edit.start, edit.end, edit.backwards ? 'backward' : 'forward');
      sync();
    } else {
      editor.current?.select(edit.start, edit.end);
      setSelected({ start: edit.start, end: edit.end, backwards: false });
    }
    afterEdit(edit.text, edit.backwards ? edit.start : edit.end, kind);
  };

  /** The row chosen goes in place of the letters typed, as Ace's `insertMatch` */
  const insertMatch = (row: number) => {
    const open = listed.current;
    const input = area();
    if (!open || !input) return;
    const edit = insertCompletion(open, row, input.value, input.selectionStart, input.selectionEnd);
    closeList();
    if (edit) apply(edit, 'other');
  };

  const handleChange = (next: string) => {
    onChange(next);
    if (applying.current) return;
    const kind = command.current;
    command.current = 'other';
    const input = area();
    afterEdit(next, input ? input.selectionEnd : next.length, kind);
  };

  // --- Keys -----------------------------------------------------------------------------------

  /** The keys of the open list, as Ace binds them. Tells whether the key was one of them. */
  const onListKey = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    const open = listed.current;
    if (!open) return false;
    const done = listKey(open, `${modifiers(event)}${event.key}`);
    if (!done) return false;
    if (done.insert !== undefined) insertMatch(done.insert);
    else showList(done.listed);
    return true;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    command.current = 'other';
    if (event.nativeEvent.isComposing || event.key === 'Process') return;
    if (onListKey(event)) {
      event.preventDefault();
      return;
    }
    const input = event.currentTarget;
    const text = input.value;
    const { selectionStart: start, selectionEnd: end } = input;
    const backwards = input.selectionDirection === 'backward' && start !== end;
    const name = `${modifiers(event)}${event.key}`;
    if (words && (name === 'Ctrl- ' || name === 'Ctrl-Shift- ' || name === 'Alt- ')) {
      // A fresh list, as Ace gathers one, in place of the one open
      event.preventDefault();
      showList(openList(text, backwards ? start : end));
      return;
    }
    if (event.key === 'Escape') {
      // Out of the text, to the hint the Tab key stops on
      event.preventDefault();
      event.stopPropagation();
      flushSync(() => setEditing(false));
      hint.current?.focus();
      return;
    }
    // A character a keyboard types with AltGr, or with the Option key, is typed all the same
    const types =
      event.key.length === 1 &&
      event.key !== ' ' &&
      !event.metaKey &&
      ((event.ctrlKey && event.altKey) || (event.altKey && !event.ctrlKey && /\W/.test(event.key)));
    const result = editorKey(
      {
        key: event.key,
        shiftKey: event.shiftKey,
        ctrlKey: event.ctrlKey && !types,
        metaKey: event.metaKey,
        altKey: event.altKey && !types,
      },
      text,
      start,
      end,
      memory.current,
      words,
      backwards
    );
    if (!result) return;
    memory.current = result.memory;
    if (result.edit) {
      event.preventDefault();
      apply(result.edit, result.kind);
    } else {
      command.current = result.kind;
    }
  };

  // --- What follows the text area ---------------------------------------------------------------

  useLayoutEffect(() => {
    const input = area();
    if (input) {
      // The text is reached through the hint, not with the Tab key, and its cursor starts at
      // its end, as Ace's
      input.tabIndex = -1;
      input.setSelectionRange(input.value.length, input.value.length);
    }
    const around = frame();
    if (around) setHeight(around.clientHeight);
  }, []);

  // A text put in from outside (Clear) takes the cursor with it
  useLayoutEffect(() => {
    sync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(() => {
    const onSelectionChange = () => {
      const input = area();
      if (!input || document.activeElement !== input) return;
      const now = sync();
      const open = listed.current;
      if (now && open) showList(followList(open, input.value, now.backwards ? now.start : now.end));
    };
    document.addEventListener('selectionchange', onSelectionChange);
    return () => document.removeEventListener('selectionchange', onSelectionChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const from = locate(selected.start);
  const to = locate(selected.end);
  const lead = selected.backwards ? from : to;
  const leadOffset = Math.min(selected.backwards ? selected.start : selected.end, value.length);
  const pair = useMemo(() => matchingBracket(value, leadOffset, words), [value, leadOffset, words]);
  const bracket = pair === undefined ? undefined : locate(pair);

  // The list opens where its word begins, once the text is drawn with the letter that opened it
  useLayoutEffect(() => {
    const open = listed.current;
    if (!open || !placing.current) return;
    placing.current = false;
    const base = locate(open.base);
    const at = editor.current?.coordinates(base.row, base.column);
    const line = box.current?.querySelectorAll('.atlCodeEditor__line')[base.row];
    if (!at || !line) return;
    const character = (probe.current?.getBoundingClientRect().width ?? 84) / 10;
    const columns = (LIST_WIDTH - 2) / character;
    const left = Math.min(at.left - 5, window.innerWidth - LIST_WIDTH);
    const top = line.getBoundingClientRect().top + 1;
    if (top > window.innerHeight / 2 && top + LINE + LIST_ROWS * LINE * 1.4 > window.innerHeight) {
      setPlace({ left, bottom: window.innerHeight - top, room: top - 2, columns });
    } else {
      setPlace({
        left,
        top: top + LINE,
        room: window.innerHeight - (top + LINE) - 0.2 * LINE,
        columns,
      });
    }
  });

  // The row chosen stays in sight
  const open = listed.current;
  const row = open?.row;
  useLayoutEffect(() => {
    const list = rows.current;
    if (!list || row === undefined) return;
    const item = list.children[Math.max(0, row)] as HTMLElement | undefined;
    if (!item || row < 0) list.scrollTop = 0;
    else if (item.offsetTop < list.scrollTop) list.scrollTop = item.offsetTop;
    else if (item.offsetTop + item.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = item.offsetTop + item.offsetHeight - list.clientHeight;
    }
  });

  // The cursor stays in sight along its line, as Ace keeps it
  useLayoutEffect(() => {
    const around = frame();
    const cursor = box.current?.querySelector('.qwbCode__cursor');
    const gutter = box.current?.querySelector('.atlCodeEditor__line');
    if (!editing || !around || !cursor || !gutter) return;
    const view = around.getBoundingClientRect();
    const at = cursor.getBoundingClientRect();
    const character = (probe.current?.getBoundingClientRect().width ?? 84) / 10;
    // The text begins after the gutter, four pixels before its first letter
    const textLeft =
      view.left + around.clientLeft + Number.parseFloat(getComputedStyle(gutter).paddingLeft) - 4;
    if (at.left < textLeft) {
      const next = around.scrollLeft - (textLeft - at.left);
      around.scrollLeft = next < 4 + 2 * character ? 0 : next;
    } else if (at.left + character > view.left + around.clientLeft + around.clientWidth) {
      around.scrollLeft += Math.round(
        at.left + character - (view.left + around.clientLeft + around.clientWidth)
      );
    } else if (around.scrollLeft > 0 && around.scrollLeft <= 4 && at.left - textLeft < character) {
      around.scrollLeft = 0;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, value, editing]);

  // --- The drawing ------------------------------------------------------------------------------

  const x = (column: number) => `calc(var(--code-gutter) + ${column}ch)`;
  const overlay = (
    <>
      <div className="qwbCode__marks" aria-hidden="true">
        {from.row === to.row && (
          <div className="qwbCode__activeLine" style={{ top: lead.row * LINE }} />
        )}
        {from.row === to.row
          ? selected.start !== selected.end && (
              <div
                className="qwbCode__selection"
                style={{
                  top: from.row * LINE,
                  left: x(from.screen),
                  width: `${to.screen - from.screen}ch`,
                }}
              />
            )
          : // Over lines as Ace's: from its start to the end of the line, whole lines, and the
            // last line up to its end
            [
              <div
                key="first"
                className="qwbCode__selection qwbCode__selection--first"
                style={{ top: from.row * LINE, left: x(from.screen) }}
              />,
              <div
                key="last"
                className="qwbCode__selection qwbCode__selection--last"
                style={{ top: to.row * LINE, left: x(0), width: `${to.screen}ch` }}
              />,
              to.row - from.row > 1 && (
                <div
                  key="between"
                  className={cx(
                    'qwbCode__selection qwbCode__selection--between',
                    from.screen > 0 && 'qwbCode__selection--afterShort',
                    to.screen === 0 && 'qwbCode__selection--beforeNone'
                  )}
                  style={{
                    top: (from.row + 1) * LINE,
                    left: x(0),
                    height: (to.row - from.row - 1) * LINE,
                  }}
                />
              ),
            ]}
        {bracket && (
          <div
            className="qwbCode__bracket"
            style={{ top: bracket.row * LINE, left: x(bracket.screen) }}
          />
        )}
      </div>
      {editing && (
        <div
          key={`${selected.start}/${selected.end}/${value.length}`}
          className="qwbCode__cursor"
          style={{ top: lead.row * LINE, left: x(lead.screen) }}
        />
      )}
    </>
  );

  // The gutter is as wide as the number of the last line in sight needs, as Ace's
  const lastShown = Math.round(scrollTop / LINE) + Math.ceil((height + LINE) / LINE);
  const digits = String(Math.min(lines.length, lastShown)).length;

  return (
    <div
      ref={box}
      className={cx(
        'qwbCode',
        sql ? 'qwbCode--sql' : 'qwbCode--text',
        editing && 'qwbCode--editing'
      )}
      style={{ '--qwb-digits': digits } as CSSProperties}
      data-test-subj={sql ? 'sqlCodeEditor' : 'pplCodeEditor'}
      onFocus={(event) => {
        if (event.target instanceof HTMLTextAreaElement) setEditing(true);
      }}
      onBlur={(event) => {
        if (!(event.target instanceof HTMLTextAreaElement)) return;
        setEditing(false);
        closeList();
      }}
      onMouseDownCapture={(event) => {
        // A click in the editor closes the list; one in the list, which is drawn elsewhere, not
        if (!box.current?.contains(event.target as Node)) return;
        command.current = 'other';
        closeList();
      }}
      onWheel={(event) => {
        if (box.current?.contains(event.target as Node)) closeList();
      }}
    >
      <button
        ref={hint}
        type="button"
        className={cx('qwbCode__hint', editing && 'qwbCode__hint--inactive')}
        onClick={() => editor.current?.focus()}
        data-test-subj="codeEditorHint"
      >
        <p>Press Enter to start editing.</p>
        <p>{"When you're done, press Escape to stop editing."}</p>
      </button>
      <CodeEditor
        handle={editor}
        className="qwbCode__editor"
        value={value}
        onChange={handleChange}
        onKeyDown={onKeyDown}
        onCursor={() => {
          sync();
        }}
        onScroll={sql ? setScrollTop : undefined}
        tokenize={sql ? sqlLines : textLines}
        markedLines={[lead.row, lead.row]}
        fontSize={FONT_SIZE}
        height={HEIGHT}
        gutter={sql}
        overlay={overlay}
        ariaLabel="Code Editor"
      />
      <span ref={probe} className="qwbCode__probe" aria-hidden="true">
        0000000000
      </span>
      {open && place && (
        <Portal>
          <div
            ref={rows}
            className="qwbComplete"
            role="listbox"
            style={{
              left: place.left,
              top: place.top,
              bottom: place.bottom,
              height: Math.min(
                Math.min(LIST_ROWS, open.list.filtered.length) * LIST_ROW,
                place.room
              ),
            }}
            onMouseLeave={() => setHover(-1)}
            data-test-subj="sqlCodeEditorCompletions"
          >
            {open.list.filtered.map((item, index) => (
              <div
                key={index}
                role="option"
                aria-selected={index === open.row}
                className={cx(
                  'qwbComplete__row',
                  index === open.row && 'qwbComplete__row--active',
                  index === hover && 'qwbComplete__row--hover'
                )}
                onMouseDown={(event) => {
                  // The text keeps the focus; the row is chosen, and the click puts it in
                  event.preventDefault();
                  showList({ ...open, row: index });
                }}
                onClick={() => insertMatch(index)}
                onMouseMove={() => setHover(index)}
              >
                {completionRuns(item).map((run, at) =>
                  run.match ? (
                    <span key={at} className="qwbComplete__match">
                      {run.text}
                    </span>
                  ) : (
                    run.text
                  )
                )}
                <span className="qwbComplete__meta">{completionMeta(item, place.columns)}</span>
              </div>
            ))}
          </div>
        </Portal>
      )}
    </div>
  );
}

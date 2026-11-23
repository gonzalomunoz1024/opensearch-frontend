/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The keys of Query Workbench's editors as Ace handles them in the plugin: Tab and Shift+Tab by
 * four-column steps, Backspace and Delete across a soft tab, Enter keeping the line's indent, and
 * in the SQL editor the brackets and quotes Ace's C-style behaviour closes, steps over and deletes
 * in pairs. The PPL editor is in Ace's text mode, which closes nothing.
 */

export interface TextEdit {
  text: string;
  start: number;
  end: number;
}

/** What the SQL editor remembers between keys: the closing brackets it typed itself */
export interface PairMemory {
  /** Closing brackets typed after the cursor, on this line, and the text after the cursor then */
  closing?: { line: number; count: number; lineEnd: string };
  /** A `{` typed alone, whose `}` Enter adds */
  maybe?: { line: number; column: number; lineEnd: string };
}

export interface EditorKey {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

/** The kind of edit a key made, as Ace's commands tell it to the list of completions */
export type EditKind = 'insert' | 'backspace' | 'newline' | 'other';

const TAB = 4;
const TAB_SPACES = ' '.repeat(TAB);

interface AceToken {
  type: string;
  value: string;
  start: number;
}

// The SQL mode's rules again, with Ace's token types, for the places where they decide
const RULES: Array<[RegExp, string]> = [
  [/--.*$/y, 'comment'],
  [/\/\*/y, 'comment.start'],
  [/".*?"/y, 'string'],
  [/'.*?'/y, 'string'],
  [/`.*?`/y, 'string'],
  [/[+-]?\d+(?:(?:\.\d*)?(?:[eE][+-]?\d+)?)?\b/y, 'constant.numeric'],
  [/[a-zA-Z_$][a-zA-Z0-9_$]*\b/y, 'word'],
  [/\+|-|\/|\/\/|%|<@>|@>|<@|&|\^|~|<|>|<=|=>|==|!=|<>|=/y, 'keyword.operator'],
  [/[(]/y, 'paren.lparen'],
  [/[)]/y, 'paren.rparen'],
  [/\s+/y, 'text'],
];

/** A letter, digit or joiner of a word, as Ace's text mode reads words */
const WORD_CHARACTER = /[\p{L}\p{Mn}\p{Mc}\p{Nd}\p{Pc}$_]/u;

/** The tokens of one line of SQL as Ace's tokenizer gives them, a run of one type merged */
function sqlTokens(text: string, row: number, words: ReadonlyMap<string, string>): AceToken[] {
  const lines = text.split('\n');
  let inComment = false;
  let tokens: AceToken[] = [];
  for (let index = 0; index <= row && index < lines.length; index += 1) {
    const line = lines[index];
    tokens = [];
    const push = (value: string, type: string, start: number) => {
      const last = tokens[tokens.length - 1];
      if (last && last.type === type) last.value += value;
      else tokens.push({ type, value, start });
    };
    let at = 0;
    while (at < line.length) {
      if (inComment) {
        const end = line.indexOf('*/', at);
        const stop = end === -1 ? line.length : end + 2;
        push(line.slice(at, stop), 'comment', at);
        inComment = end === -1;
        at = stop;
        continue;
      }
      let taken = false;
      for (const [pattern, type] of RULES) {
        pattern.lastIndex = at;
        const match = pattern.exec(line);
        if (!match || match[0] === '') continue;
        if (type === 'comment.start') {
          push(match[0], 'comment', at);
          inComment = true;
        } else if (type === 'word') {
          push(match[0], words.get(match[0].toLowerCase()) ?? 'identifier', at);
        } else {
          push(match[0], type, at);
        }
        at += match[0].length;
        taken = true;
        break;
      }
      if (!taken) {
        push(line[at], 'text', at);
        at += 1;
      }
    }
  }
  return tokens;
}

/** The token Ace finds at a column: the first that ends at it or after */
function tokenAt(tokens: AceToken[], column: number): { token?: AceToken; index: number } {
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].start + tokens[index].value.length >= column)
      return { token: tokens[index], index };
  }
  return { index: tokens.length };
}

const SAFE_IN = ['text', 'paren.rparen', 'punctuation.operator'];
const SAFE_BEFORE = [...SAFE_IN, 'comment'];

/** Whether Ace's C-style behaviour closes a bracket typed here */
function saneInsertion(tokens: AceToken[], column: number): boolean {
  const here = tokenAt(tokens, column);
  if (!SAFE_IN.includes(here.token?.type ?? 'text')) {
    const next = tokenAt(tokens, column + 1).token;
    if (!SAFE_IN.includes(next?.type ?? 'text')) return false;
  }
  const after = tokens[here.token ? here.index + 1 : 0];
  return after === undefined || SAFE_BEFORE.includes(after.type);
}

/** Whether a closing bracket at an offset has its opening bracket before it */
function hasOpening(text: string, offset: number, close: string): boolean {
  const open = close === ')' ? '(' : close === ']' ? '[' : '{';
  let depth = 0;
  for (let at = offset - 1; at >= 0; at -= 1) {
    if (text[at] === close) depth += 1;
    else if (text[at] === open) {
      if (depth === 0) return true;
      depth -= 1;
    }
  }
  return false;
}

const place = (text: string, offset: number) => {
  const line = text.slice(0, offset).split('\n').length - 1;
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
  const lineEndAt = text.indexOf('\n', offset);
  const lineText = text.slice(lineStart, lineEndAt === -1 ? text.length : lineEndAt);
  return { line, lineStart, column: offset - lineStart, lineText };
};

const replace = (
  text: string,
  start: number,
  end: number,
  insert: string,
  cursor: number,
  cursorEnd = cursor
): TextEdit => ({
  text: `${text.slice(0, start)}${insert}${text.slice(end)}`,
  start: cursor,
  end: cursorEnd,
});

/** The rows a selection covers, as Ace counts them: a row it ends at the start of is left out */
function selectedRows(text: string, start: number, end: number) {
  const from = place(text, start).lineStart;
  const last = end > start && text[end - 1] === '\n' ? end - 1 : end;
  const lineEnd = text.indexOf('\n', last);
  return { from, to: lineEnd === -1 ? text.length : lineEnd };
}

/** Tab: four-column steps at the cursor, or each line of a selection in by four spaces */
function indent(text: string, start: number, end: number): TextEdit {
  const selected = text.slice(start, end);
  if (selected.includes('\n') || (selected !== '' && !/^\s+$/.test(selected))) {
    const rows = selectedRows(text, start, end);
    const lines = text.slice(rows.from, rows.to).split('\n');
    const moved = lines.map((line) => `${TAB_SPACES}${line}`).join('\n');
    // The end moves by the lines that start before it
    const before = end > rows.to ? lines.length : text.slice(rows.from, end).split('\n').length;
    return {
      text: `${text.slice(0, rows.from)}${moved}${text.slice(rows.to)}`,
      start: start + TAB,
      end: end + TAB * before,
    };
  }
  const spaces = ' '.repeat(TAB - (place(text, start).column % TAB));
  return replace(text, start, end, spaces, start + spaces.length);
}

/** What Shift+Tab takes off the front of a line: up to four spaces, or one tab after fewer */
function outdentCut(line: string): [number, number] {
  let count = 0;
  while (count < TAB && line[count] === ' ') count += 1;
  return count < TAB && line[count] === '\t' ? [count, count + 1] : [0, count];
}

/** Shift+Tab: each line of the selection out by a step */
function outdent(text: string, start: number, end: number): TextEdit {
  const rows = selectedRows(text, start, end);
  const lines = text.slice(rows.from, rows.to).split('\n');
  // Where an offset lands once what is taken off each line before it is gone
  const shift = (offset: number) => {
    let moved = 0;
    let lineStart = rows.from;
    for (const line of lines) {
      const [cutStart, cutEnd] = outdentCut(line).map((at) => lineStart + at);
      if (offset >= cutEnd) moved += cutEnd - cutStart;
      else if (offset > cutStart) moved += offset - cutStart;
      lineStart += line.length + 1;
    }
    return offset - moved;
  };
  const moved = lines.map((line) => {
    const [cutStart, cutEnd] = outdentCut(line);
    return `${line.slice(0, cutStart)}${line.slice(cutEnd)}`;
  });
  return {
    text: `${text.slice(0, rows.from)}${moved.join('\n')}${text.slice(rows.to)}`,
    start: shift(start),
    end: shift(end),
  };
}

const PAIRS: Record<string, string> = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'" };

/**
 * What Backspace or Delete takes away when nothing is selected: four spaces at a soft tab, a
 * bracket or quote with its pair right after it in the SQL editor, and the spaces of the line a
 * line break joins when they are all it holds
 */
function removal(
  text: string,
  offset: number,
  left: boolean,
  pairs: boolean
): TextEdit | undefined {
  const here = place(text, offset);
  let start = offset;
  let end = offset;
  if (left) {
    if (offset === 0) return undefined;
    const before = here.lineText.slice(Math.max(0, here.column - TAB), here.column);
    start =
      here.column > 0 && here.column % TAB === 0 && before === TAB_SPACES
        ? offset - TAB
        : offset - 1;
  } else {
    if (offset >= text.length) return undefined;
    const after = here.lineText.slice(here.column, here.column + TAB);
    end = here.column % TAB === 0 && after === TAB_SPACES ? offset + TAB : offset + 1;
  }
  const removed = text.slice(start, end);
  if (pairs && removed.length === 1 && PAIRS[removed] !== undefined && text[end] === PAIRS[removed])
    end += 1;
  if (removed === '\n') {
    const nextEnd = text.indexOf('\n', end);
    const next = text.slice(end, nextEnd === -1 ? text.length : nextEnd);
    if (/^\s+$/.test(next)) end += next.length;
  }
  return replace(text, start, end, '', start);
}

/**
 * What a key does in an editor, or undefined for what the text area does itself. `words` are
 * the SQL mode's words and their kinds; without them the editor is in Ace's text mode.
 */
export function editorKey(
  key: EditorKey,
  text: string,
  start: number,
  end: number,
  memory: PairMemory,
  words?: ReadonlyMap<string, string>
): { edit: TextEdit; memory: PairMemory; kind: EditKind } | undefined {
  if (key.ctrlKey || key.metaKey || key.altKey) return undefined;
  const here = place(text, start);
  const selected = text.slice(start, end);
  const lineEnd = here.lineText.slice(here.column);
  const typed = (insert: string, next: PairMemory = {}, cursor = start + insert.length) => ({
    edit: replace(text, start, end, insert, cursor),
    memory: next,
    kind: 'insert' as const,
  });
  const stepOver = (next: PairMemory = {}) => ({
    edit: { text, start: start + 1, end: start + 1 },
    memory: next,
    kind: 'insert' as const,
  });

  if (key.key === 'Tab') {
    return {
      edit: key.shiftKey ? outdent(text, start, end) : indent(text, start, end),
      memory: {},
      kind: 'other',
    };
  }

  if (key.key === 'Backspace' || key.key === 'Delete') {
    if (start !== end) return undefined;
    const edit = removal(text, start, key.key === 'Backspace', words !== undefined);
    return edit
      ? { edit, memory, kind: key.key === 'Backspace' ? 'backspace' : 'other' }
      : undefined;
  }

  if (key.key === 'Enter') {
    const lineIndent = /^\s*/.exec(here.lineText.slice(0, here.column))?.[0] ?? '';
    if (words && selected === '') {
      const maybe = memory.maybe;
      const closing =
        maybe &&
        maybe.line === here.line &&
        maybe.column === here.column &&
        maybe.lineEnd === lineEnd
          ? '}'
          : '';
      if ((lineEnd.startsWith('}') && hasOpening(text, start, '}')) || closing) {
        // Between braces the inner line goes one step in, and the brace typed alone is closed
        const inner = `${lineIndent}${TAB_SPACES}`;
        return {
          ...typed(`\n${inner}\n${lineIndent}${closing}`, {}, start + 1 + inner.length),
          kind: 'newline',
        };
      }
    }
    return { ...typed(`\n${lineIndent}`), kind: 'newline' };
  }

  if (key.key.length !== 1) return undefined;
  if (!words) {
    // Text mode: a bracket or a quote types itself, whatever the kit's editor would pair
    return /[([{"'`)\]}]/.test(key.key) ? typed(key.key) : undefined;
  }

  const tokens = sqlTokens(text, here.line, words);
  const wrap = (open: string, close: string) => ({
    edit: replace(text, start, end, `${open}${selected}${close}`, start + 1, end + 1),
    memory: {},
    kind: 'insert' as const,
  });
  const closingCount = () =>
    memory.closing && memory.closing.line === here.line && memory.closing.lineEnd === lineEnd
      ? memory.closing.count
      : 0;
  const closed = (pair: string, close: string) =>
    typed(
      pair,
      { closing: { line: here.line, count: closingCount() + 1, lineEnd: `${close}${lineEnd}` } },
      start + 1
    );

  if (key.key === '(' || key.key === '[') {
    const close = key.key === '(' ? ')' : ']';
    if (selected !== '') return wrap(key.key, close);
    return saneInsertion(tokens, here.column)
      ? closed(`${key.key}${close}`, close)
      : typed(key.key);
  }

  if (key.key === '{') {
    if (selected !== '' && selected !== '{') return wrap('{', '}');
    if (!saneInsertion(tokens, here.column)) return typed('{');
    if (/[\]})]/.test(lineEnd.charAt(0))) return closed('{}', '}');
    return typed('{', { maybe: { line: here.line, column: here.column + 1, lineEnd } });
  }

  if (key.key === ')' || key.key === ']' || key.key === '}') {
    const count = closingCount();
    if (
      selected === '' &&
      lineEnd.charAt(0) === key.key &&
      count > 0 &&
      hasOpening(text, start, key.key)
    ) {
      // A closing bracket typed over the one typed for it
      const left = count - 1;
      return stepOver(
        left > 0 ? { closing: { line: here.line, count: left, lineEnd: lineEnd.slice(1) } } : {}
      );
    }
    return typed(key.key);
  }

  if (key.key === '"' || key.key === "'") {
    const quote = key.key;
    if (selected !== '' && selected !== "'" && selected !== '"') return wrap(quote, quote);
    if (selected !== '') return typed(quote);
    const left = here.lineText.charAt(here.column - 1);
    const right = here.lineText.charAt(here.column);
    const token = tokenAt(tokens, here.column).token;
    const rightToken = tokenAt(tokens, here.column + 1).token;
    const stringBefore = token !== undefined && /string|escape/.test(token.type);
    const stringAfter = rightToken === undefined || /string|escape/.test(rightToken.type);
    if (right === quote) {
      // Typed over the quote that closes the string, unless that starts one
      return stringBefore !== stringAfter ? typed(`${quote}${quote}`, {}, start + 1) : stepOver();
    }
    const alone =
      stringBefore || WORD_CHARACTER.test(left) || (right !== '' && !/[\s;,.})\]\\]/.test(right));
    return alone ? typed(quote) : typed(`${quote}${quote}`, {}, start + 1);
  }

  return undefined;
}

/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The keys of Query Workbench's editors as Ace handles them in the plugin: Tab and Shift+Tab by
 * four-column steps, the arrows, Backspace and Delete across a soft tab, Home to the first letter
 * of a line and then to its start, Enter keeping the line's indent, and in the SQL editor the
 * brackets and quotes Ace's C-style behaviour closes, steps over and deletes in pairs. The PPL
 * editor is in Ace's text mode, which closes nothing.
 */

export interface TextEdit {
  text: string;
  start: number;
  end: number;
  /** Whether the selection was made towards the start of the text: its moving end is `start` */
  backwards?: boolean;
}

/** What the SQL editor remembers between keys: the closing brackets it typed itself */
export interface PairMemory {
  /** Closing brackets typed after the cursor, on this line, and the text after the cursor then */
  closing?: { line: number; count: number; lineEnd: string };
  /** Braces typed alone, whose closing ones Enter adds; the line as it was around the cursor */
  maybe?: { line: number; count: number; lineStart: string; lineEnd: string };
}

export interface EditorKey {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

/** The kind of command a key is, as Ace's commands tell it to the list of completions */
export type EditKind = 'insert' | 'backspace' | 'other';

export interface KeyResult {
  /** What the key leaves; without it the text area does what it does by itself */
  edit?: TextEdit;
  memory: PairMemory;
  kind: EditKind;
}

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

/** The tokens of each line of SQL as Ace's tokenizer gives them, a run of one type merged */
function sqlTokens(text: string, words: ReadonlyMap<string, string>): AceToken[][] {
  let inComment = false;
  return text.split('\n').map((line) => {
    const tokens: AceToken[] = [];
    const push = (value: string, type: string, start: number) => {
      const last = tokens[tokens.length - 1];
      if (last && last.type === type) last.value += value;
      else tokens.push({ type, value, start });
    };
    let at = 0;
    while (at < line.length) {
      if (inComment) {
        const end = line.indexOf('*/', at);
        const stop = end === -1 ? line.length : end;
        if (stop > at) push(line.slice(at, stop), 'comment', at);
        if (end !== -1) push('*/', 'comment.end', end);
        inComment = end === -1;
        at = end === -1 ? stop : end + 2;
        continue;
      }
      let taken = false;
      for (const [pattern, type] of RULES) {
        pattern.lastIndex = at;
        const match = pattern.exec(line);
        if (!match || match[0] === '') continue;
        if (type === 'comment.start') {
          push(match[0], type, at);
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
    return tokens;
  });
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

const PARTNER: Record<string, string> = {
  ')': '(',
  ']': '[',
  '}': '{',
  '(': ')',
  '[': ']',
  '{': '}',
};

/** The lines of a text in Ace's text mode: each line one token */
const textTokens = (text: string): AceToken[][] =>
  text.split('\n').map((line) => (line === '' ? [] : [{ type: 'text', value: line, start: 0 }]));

/**
 * Where the bracket that pairs with one is, as Ace looks for it: through the tokens of the
 * bracket's kind, so that a bracket in a string or a comment pairs with none outside it.
 * `column` is that of the bracket.
 */
function pairOf(
  rows: AceToken[][],
  row: number,
  column: number
): { row: number; column: number } | undefined {
  const found = tokenAt(rows[row] ?? [], column + 1);
  if (!found.token) return undefined;
  const bracket = found.token.value[column - found.token.start];
  const partner = PARTNER[bracket];
  if (partner === undefined) return undefined;
  const forward = '([{'.includes(bracket);
  // Brackets are among brackets; what else holds one is among its like
  const kind = new RegExp(
    `(\\.?${found.token.type.replace('.', '\\.').replace(/[lr]paren/, '.paren')})+`
  );
  let depth = 1;
  let atRow = row;
  let index = found.index;
  let at = column - found.token.start + (forward ? 1 : -1);
  for (;;) {
    const token = rows[atRow][index];
    for (; forward ? at < token.value.length : at >= 0; at += forward ? 1 : -1) {
      if (token.value[at] === partner) {
        depth -= 1;
        if (depth === 0) return { row: atRow, column: token.start + at };
      } else if (token.value[at] === bracket) {
        depth += 1;
      }
    }
    do {
      index += forward ? 1 : -1;
      while (index < 0 || index >= rows[atRow].length) {
        atRow += forward ? 1 : -1;
        if (atRow < 0 || atRow >= rows.length) return undefined;
        index = forward ? 0 : rows[atRow].length - 1;
      }
    } while (!kind.test(rows[atRow][index].type));
    at = forward ? 0 : rows[atRow][index].value.length - 1;
  }
}

const place = (text: string, offset: number) => {
  const line = text.slice(0, offset).split('\n').length - 1;
  const lineStart = offset === 0 ? 0 : text.lastIndexOf('\n', offset - 1) + 1;
  const lineEndAt = text.indexOf('\n', offset);
  const lineText = text.slice(lineStart, lineEndAt === -1 ? text.length : lineEndAt);
  return { line, lineStart, column: offset - lineStart, lineText };
};

/**
 * The bracket Ace draws a box around: the one that pairs with the bracket before the cursor.
 * Returns where it is in the text. `words` as for `editorKey`.
 */
export function matchingBracket(
  text: string,
  offset: number,
  words?: ReadonlyMap<string, string>
): number | undefined {
  const here = place(text, offset);
  if (here.column === 0 || PARTNER[here.lineText[here.column - 1]] === undefined) return undefined;
  const rows = words ? sqlTokens(text, words) : textTokens(text);
  const found = pairOf(rows, here.line, here.column - 1);
  if (!found) return undefined;
  const lines = text.split('\n');
  let start = 0;
  for (let row = 0; row < found.row; row += 1) start += lines[row].length + 1;
  return start + found.column;
}

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

/** The column a place of a line is drawn at: a tab reaches the next step */
export function screenColumn(line: string, column: number): number {
  let at = 0;
  for (let index = 0; index < column; index += 1)
    at = line[index] === '\t' ? at + TAB - (at % TAB) : at + 1;
  return at;
}

/** Tab: four-column steps at the cursor, or each line of a selection in by four spaces */
function indent(text: string, start: number, end: number): { edit: TextEdit; typed: boolean } {
  const selected = text.slice(start, end);
  if (selected.includes('\n') || (selected !== '' && !/^\s+$/.test(selected))) {
    const rows = selectedRows(text, start, end);
    const lines = text.slice(rows.from, rows.to).split('\n');
    const moved = lines.map((line) => `${TAB_SPACES}${line}`).join('\n');
    // The end moves by the lines that start before it
    const before = end > rows.to ? lines.length : text.slice(rows.from, end).split('\n').length;
    return {
      edit: {
        text: `${text.slice(0, rows.from)}${moved}${text.slice(rows.to)}`,
        start: start + TAB,
        end: end + TAB * before,
      },
      typed: false,
    };
  }
  const here = place(text, start);
  const spaces = ' '.repeat(TAB - (screenColumn(here.lineText, here.column) % TAB));
  return { edit: replace(text, start, end, spaces, start + spaces.length), typed: true };
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
// The pairs the kit's editor closes, steps over and takes away together by itself
const KIT_PAIRS = ['{}', '[]', '()', '""'];

/** How far an arrow moves the cursor in its line: over four spaces that end or begin at a step */
function arrowStep(text: string, offset: number, left: boolean): number {
  const here = place(text, offset);
  if (here.column % TAB !== 0) return 1;
  const spaces = left
    ? here.lineText.slice(Math.max(0, here.column - TAB), here.column)
    : here.lineText.slice(here.column, here.column + TAB);
  return spaces === TAB_SPACES ? TAB : 1;
}

/**
 * What Backspace or Delete takes away: what is selected, or else the character beside the cursor
 * or four spaces at a soft tab; with it, in the SQL editor, the bracket or quote that pairs with
 * the one taken, and in both the spaces of a line a line break joins when they are all it holds.
 * Undefined when the text area takes away the same by itself.
 */
function removal(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  left: boolean,
  pairs: boolean
): { edit?: TextEdit; removed: string; paired: boolean } | undefined {
  let start = selectionStart;
  let end = selectionEnd;
  if (start === end) {
    if (left ? start === 0 : end >= text.length) return undefined;
    const step = text[left ? start - 1 : end] === '\n' ? 1 : arrowStep(text, start, left);
    if (left) start -= step;
    else end += step;
  }
  const removed = text.slice(start, end);
  const own = end;
  const paired =
    pairs && removed.length === 1 && PAIRS[removed] !== undefined && text[end] === PAIRS[removed];
  if (paired) end += 1;
  else if (removed.endsWith('\n')) {
    // The line that comes up is taken whole when spaces are all it holds
    const nextEnd = text.indexOf('\n', end);
    const next = text.slice(end, nextEnd === -1 ? text.length : nextEnd);
    if (/^\s+$/.test(next)) end += next.length;
  }
  const plain = end === own && (selectionStart !== selectionEnd || removed.length === 1);
  return { edit: plain ? undefined : replace(text, start, end, '', start), removed, paired };
}

/**
 * What a key does in an editor: the text and the selection it leaves, or no edit for what the
 * text area does by itself. Undefined for a key pressed with Ctrl, Alt or the command key, and
 * for the keys that neither type nor move as Ace has them. `words` are the SQL mode's words and
 * their kinds; without them the editor is in Ace's text mode. `backwards` tells which end of a
 * selection moves.
 *
 * The keys the kit's editor has rules of its own for (Tab, Enter, a bracket or a double quote,
 * Backspace between a pair) always get an edit, so that the page can keep the kit's rules out.
 */
export function editorKey(
  key: EditorKey,
  text: string,
  start: number,
  end: number,
  memory: PairMemory,
  words?: ReadonlyMap<string, string>,
  backwards = false
): KeyResult | undefined {
  if (key.ctrlKey || key.metaKey || key.altKey) return undefined;
  const selected = text.slice(start, end);
  // Ace's cursor is the end of a selection that moves
  const lead = backwards ? start : end;
  const anchor = backwards ? end : start;

  if (key.key === 'ArrowLeft' || key.key === 'ArrowRight' || key.key === 'Home') {
    let to: number;
    if (key.key === 'Home') {
      const here = place(text, lead);
      const first = /^\s*/.exec(here.lineText)?.[0].length ?? 0;
      to = here.lineStart + (first !== here.column ? first : 0);
    } else {
      const left = key.key === 'ArrowLeft';
      if (selected !== '' && !key.shiftKey) return { memory, kind: 'other' };
      if (left ? lead === 0 || text[lead - 1] === '\n' : lead >= text.length || text[lead] === '\n')
        return { memory, kind: 'other' };
      const step = arrowStep(text, lead, left);
      if (step === 1) return { memory, kind: 'other' };
      to = left ? lead - step : lead + step;
    }
    const edit: TextEdit = key.shiftKey
      ? { text, start: Math.min(anchor, to), end: Math.max(anchor, to), backwards: to < anchor }
      : { text, start: to, end: to };
    return { edit, memory, kind: 'other' };
  }

  if (key.key === 'Tab') {
    // Lines that move take the selection with them, the way it was made
    if (key.shiftKey)
      return { edit: { ...outdent(text, start, end), backwards }, memory, kind: 'other' };
    const done = indent(text, start, end);
    // Spaces typed at the cursor are typed: the brace waiting for its pair waits no more
    return {
      edit: done.typed ? done.edit : { ...done.edit, backwards },
      memory: done.typed && words ? { ...memory, maybe: undefined } : memory,
      kind: 'other',
    };
  }

  if (key.key === 'Backspace' || key.key === 'Delete') {
    const kind = key.key === 'Backspace' ? 'backspace' : 'other';
    const taken = removal(text, start, end, key.key === 'Backspace', words !== undefined);
    if (!taken) return { memory, kind };
    // A brace taken away alone is one fewer to close
    const maybe =
      words && taken.removed === '{' && !taken.paired && memory.maybe
        ? { ...memory.maybe, count: memory.maybe.count - 1 }
        : memory.maybe;
    // Between a pair the kit's editor would take both away: the one character goes from here
    const alone =
      !taken.edit &&
      key.key === 'Backspace' &&
      start === end &&
      KIT_PAIRS.includes(text.slice(start - 1, start + 1))
        ? replace(text, start - 1, start, '', start - 1)
        : undefined;
    return { edit: taken.edit ?? alone, memory: { ...memory, maybe }, kind };
  }

  if (key.key !== 'Enter' && key.key.length !== 1) return undefined;

  const here = place(text, lead);
  const lineEnd = here.lineText.slice(here.column);
  const typed = (insert: string, next: PairMemory, cursor = start + insert.length): KeyResult => ({
    edit: replace(text, start, end, insert, cursor),
    memory: next,
    kind: 'insert',
  });
  // What is left to the text area: a character typed over the selection
  const plain = (next: PairMemory): KeyResult => ({ memory: next, kind: 'insert' });
  const stepOver = (next: PairMemory): KeyResult => ({
    edit: { text, start: lead + 1, end: lead + 1 },
    memory: next,
    kind: 'insert',
  });

  // A line break keeps the indent of its line, and takes the spaces after it away
  const lineBreak = (next: PairMemory): KeyResult => {
    const from = place(text, start);
    const before = from.lineText.slice(0, from.column);
    const rest = text.slice(end);
    const spaces = /\S/.test(before) ? (/^[^\S\n]*/.exec(rest)?.[0].length ?? 0) : 0;
    const lineIndent = /^\s*/.exec(before)?.[0] ?? '';
    return {
      edit: replace(text, start, end + spaces, `\n${lineIndent}`, start + 1 + lineIndent.length),
      memory: next,
      kind: 'insert',
    };
  };

  if (!words) {
    if (key.key === 'Enter') return lineBreak(memory);
    // Text mode: a bracket or a quote types itself, whatever the text area's own keys would pair
    return /[([{"'`)\]}]/.test(key.key) ? typed(key.key, memory) : plain(memory);
  }

  const rows = sqlTokens(text, words);
  const tokens = rows[here.line] ?? [];
  const wrap = (open: string, close: string): KeyResult => ({
    edit: replace(text, start, end, `${open}${selected}${close}`, start + 1, end + 1),
    memory,
    kind: 'insert',
  });
  const closingCount = () =>
    memory.closing && memory.closing.line === here.line && memory.closing.lineEnd === lineEnd
      ? memory.closing.count
      : 0;
  const closed = (pair: string, close: string): KeyResult =>
    typed(
      pair,
      {
        ...memory,
        closing: { line: here.line, count: closingCount() + 1, lineEnd: `${close}${lineEnd}` },
      },
      start + 1
    );
  const maybeCount = () =>
    memory.maybe &&
    memory.maybe.count > 0 &&
    memory.maybe.line === here.line &&
    memory.maybe.lineStart === here.lineText.slice(0, here.column) &&
    memory.maybe.lineEnd === lineEnd
      ? memory.maybe.count
      : 0;
  const forgotten: PairMemory = { ...memory, maybe: undefined };

  if (key.key === 'Enter') {
    const closing = '}'.repeat(maybeCount());
    let lineIndent: string | undefined;
    if (lineEnd.startsWith('}')) {
      const opening = pairOf(rows, here.line, here.column);
      // A closing brace that closes nothing is a line break like any other
      if (!opening) return lineBreak(forgotten);
      lineIndent = /^\s*/.exec(text.split('\n')[opening.row])?.[0] ?? '';
    } else if (closing) {
      lineIndent = /^\s*/.exec(here.lineText)?.[0] ?? '';
    }
    if (lineIndent === undefined) return lineBreak(forgotten);
    // Between braces the inner line goes one step in, and the brace typed alone is closed
    const inner = `${lineIndent}${TAB_SPACES}`;
    return typed(`\n${inner}\n${lineIndent}${closing}`, forgotten, start + 1 + inner.length);
  }

  if (key.key === '(' || key.key === '[') {
    const close = key.key === '(' ? ')' : ']';
    if (selected !== '') return wrap(key.key, close);
    return saneInsertion(tokens, here.column)
      ? closed(`${key.key}${close}`, close)
      : typed(key.key, forgotten);
  }

  if (key.key === '{') {
    if (selected !== '' && selected !== '{') return wrap('{', '}');
    if (!saneInsertion(tokens, here.column)) return typed('{', memory);
    if (/[\]})]/.test(lineEnd.charAt(0))) return closed('{}', '}');
    return typed('{', {
      ...memory,
      maybe: {
        line: here.line,
        count: maybeCount() + 1,
        lineStart: `${here.lineText.slice(0, here.column)}{`,
        lineEnd,
      },
    });
  }

  if (key.key === ')' || key.key === ']' || key.key === '}') {
    const next = key.key === '}' ? memory : forgotten;
    const count = closingCount();
    if (
      lineEnd.charAt(0) === key.key &&
      count > 0 &&
      pairOf(rows, here.line, here.column) !== undefined
    ) {
      // A closing bracket typed over the one typed for it
      const left = count - 1;
      const edit = replace(text, start, end, '', start + 1);
      return {
        edit,
        memory: {
          ...next,
          closing:
            left > 0 ? { line: here.line, count: left, lineEnd: lineEnd.slice(1) } : undefined,
        },
        kind: 'insert',
      };
    }
    return typed(key.key, next);
  }

  if (key.key === '"' || key.key === "'") {
    const quote = key.key;
    if (selected !== '' && selected !== "'" && selected !== '"') return wrap(quote, quote);
    if (selected !== '') return typed(quote, forgotten);
    const left = here.lineText.charAt(here.column - 1);
    const right = here.lineText.charAt(here.column);
    const token = tokenAt(tokens, here.column).token;
    const rightToken = tokenAt(tokens, here.column + 1).token;
    const stringBefore = token !== undefined && /string|escape/.test(token.type);
    const stringAfter = rightToken === undefined || /string|escape/.test(rightToken.type);
    if (right === quote) {
      // Typed over the quote that closes the string, unless that starts one
      return stringBefore !== stringAfter
        ? typed(`${quote}${quote}`, forgotten, start + 1)
        : stepOver(forgotten);
    }
    const alone =
      stringBefore || WORD_CHARACTER.test(left) || (right !== '' && !/[\s;,.})\]\\]/.test(right));
    return alone ? typed(quote, forgotten) : typed(`${quote}${quote}`, forgotten, start + 1);
  }

  // Any other character: typed by the text area, and no brace waits for its pair any more
  return plain(forgotten);
}

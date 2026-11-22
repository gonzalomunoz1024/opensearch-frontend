/* SPDX-License-Identifier: Apache-2.0 */

/*
 * JSON as text: its colours, its indentation and the triple-quoted strings Dev Tools writes for
 * scripts. Nothing here turns a number into a JavaScript number, so a long identifier leaves as
 * it came.
 */

import type { CodeToken } from '../components/code_editor';

// --- Triple quotes ----------------------------------------------------------------------------

/** `"""a "quoted" script"""` as the JSON string it stands for */
export function collapseLiteralStrings(data: string): string {
  const parts = data.split('"""');
  for (let index = 1; index < parts.length - 1; index += 2) parts[index] = JSON.stringify(parts[index]);
  return parts.join('');
}

/** JSON strings that hold escapes, written between triple quotes so that they can be read */
export function expandLiteralStrings(data: string): string {
  return data.replace(/("(?:\\"|[^"])*?")/g, (match: string) => {
    if (!/\\./.test(match)) return match;
    // "\"quoted\"" would become """"quoted"""": left as it is
    if (match.indexOf('\\"') === 1) return match;
    if (match.lastIndexOf('\\"') === match.length - 3) return match;
    try {
      return `"""${JSON.parse(match) as string}"""`;
    } catch {
      return match;
    }
  });
}

// --- Reading -----------------------------------------------------------------------------------

type Piece =
  | { type: 'punctuation'; text: '{' | '}' | '[' | ']' | ':' | ',' }
  | { type: 'string' | 'literal' | 'comment'; text: string };

const LITERAL = /^(?:-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/;

/** The pieces of a JSON text in order; throws on what is not JSON */
function pieces(text: string): Piece[] {
  const out: Piece[] = [];
  let at = 0;
  while (at < text.length) {
    const char = text[at];
    if (/\s/.test(char)) {
      at += 1;
    } else if ('{}[]:,'.includes(char)) {
      out.push({ type: 'punctuation', text: char as '{' });
      at += 1;
    } else if (text.startsWith('"""', at)) {
      const end = text.indexOf('"""', at + 3);
      if (end === -1) throw new SyntaxError('A triple-quoted string is not closed');
      out.push({ type: 'string', text: text.slice(at, end + 3) });
      at = end + 3;
    } else if (char === '"') {
      let end = at + 1;
      while (end < text.length && text[end] !== '"') {
        if (text[end] === '\n') throw new SyntaxError('A string is not closed');
        end += text[end] === '\\' ? 2 : 1;
      }
      if (end >= text.length) throw new SyntaxError('A string is not closed');
      out.push({ type: 'string', text: text.slice(at, end + 1) });
      at = end + 1;
    } else if (text.startsWith('//', at) || char === '#') {
      let end = text.indexOf('\n', at);
      if (end === -1) end = text.length;
      out.push({ type: 'comment', text: text.slice(at, end) });
      at = end;
    } else {
      const match = LITERAL.exec(text.slice(at, at + 400));
      if (!match) throw new SyntaxError(`Unexpected "${char}" at ${at}`);
      out.push({ type: 'literal', text: match[0] });
      at += match[0].length;
    }
  }
  return out;
}

/** Checks that pieces form one value; throws where they do not */
function check(list: Piece[]) {
  let at = 0;
  const value = () => {
    const piece = list[at];
    if (!piece) throw new SyntaxError('The text ends early');
    if (piece.type === 'string' || piece.type === 'literal') {
      at += 1;
    } else if (piece.text === '{') {
      at += 1;
      if (list[at]?.text === '}') {
        at += 1;
        return;
      }
      for (;;) {
        if (list[at]?.type !== 'string') throw new SyntaxError('A name is expected');
        at += 1;
        if (list[at]?.text !== ':') throw new SyntaxError('A colon is expected');
        at += 1;
        value();
        if (list[at]?.text === ',') at += 1;
        else if (list[at]?.text === '}') {
          at += 1;
          return;
        } else throw new SyntaxError('A comma or a closing brace is expected');
      }
    } else if (piece.text === '[') {
      at += 1;
      if (list[at]?.text === ']') {
        at += 1;
        return;
      }
      for (;;) {
        value();
        if (list[at]?.text === ',') at += 1;
        else if (list[at]?.text === ']') {
          at += 1;
          return;
        } else throw new SyntaxError('A comma or a closing bracket is expected');
      }
    } else throw new SyntaxError(`Unexpected "${piece.text}"`);
  };
  value();
  if (at !== list.length) throw new SyntaxError('There is text after the value');
}

/**
 * A JSON text laid out again: two spaces a level as `JSON.stringify` does, or on one line.
 * Comments are dropped. Throws on what is not JSON.
 */
export function reindentJson(text: string, indent = true): string {
  const list = pieces(text).filter((piece) => piece.type !== 'comment');
  check(list);
  let out = '';
  let depth = 0;
  const line = () => (indent ? `\n${'  '.repeat(depth)}` : '');
  list.forEach((piece, index) => {
    const next = list[index + 1];
    if (piece.type !== 'punctuation') {
      out += piece.text;
    } else if (piece.text === '{' || piece.text === '[') {
      out += piece.text;
      const closes = piece.text === '{' ? '}' : ']';
      if (next?.text !== closes) {
        depth += 1;
        out += line();
      }
    } else if (piece.text === '}' || piece.text === ']') {
      const previous = list[index - 1];
      const opens = piece.text === '}' ? '{' : '[';
      if (!(previous?.type === 'punctuation' && previous.text === opens)) {
        depth -= 1;
        out += line();
      }
      out += piece.text;
    } else if (piece.text === ',') {
      out += `,${line()}`;
    } else {
      out += indent ? ': ' : ':';
    }
  });
  return out;
}

// --- Colours -----------------------------------------------------------------------------------

export interface JsonState {
  /** How many braces and brackets are open */
  depth: number;
  /** Inside a triple-quoted string that began on a line above */
  triple: boolean;
}

/** One line of JSON as coloured runs; `state` carries over to the next line */
export function tokenizeJsonLine(line: string, state: JsonState): CodeToken[] {
  const tokens: CodeToken[] = [];
  let plain = '';
  const flush = () => {
    if (plain) tokens.push({ text: plain });
    plain = '';
  };
  let at = 0;
  if (state.triple) {
    const end = line.indexOf('"""');
    if (end === -1) return [{ text: line, kind: 'String' }];
    tokens.push({ text: line.slice(0, end + 3), kind: 'String' });
    state.triple = false;
    at = end + 3;
  }
  while (at < line.length) {
    const char = line[at];
    if (line.startsWith('"""', at)) {
      flush();
      const end = line.indexOf('"""', at + 3);
      if (end === -1) {
        tokens.push({ text: line.slice(at), kind: 'String' });
        state.triple = true;
        return tokens;
      }
      tokens.push({ text: line.slice(at, end + 3), kind: 'String' });
      at = end + 3;
    } else if (char === '"') {
      flush();
      let end = at + 1;
      while (end < line.length && line[end] !== '"') end += line[end] === '\\' ? 2 : 1;
      end = Math.min(end + 1, line.length);
      const isKey = /^\s*:/.test(line.slice(end));
      tokens.push({ text: line.slice(at, end), kind: isKey ? 'Key' : 'String' });
      at = end;
    } else if (line.startsWith('//', at) || char === '#') {
      flush();
      tokens.push({ text: line.slice(at), kind: 'Comment' });
      return tokens;
    } else if (char === '{' || char === '[') {
      state.depth += 1;
      plain += char;
      at += 1;
    } else if (char === '}' || char === ']') {
      state.depth = Math.max(0, state.depth - 1);
      plain += char;
      at += 1;
    } else {
      const match = /[\s,:]/.test(char) ? null : LITERAL.exec(line.slice(at));
      if (match) {
        flush();
        tokens.push({ text: match[0], kind: /^[tfn]/.test(match[0]) ? 'Keyword' : 'Number' });
        at += match[0].length;
      } else {
        plain += char;
        at += 1;
      }
    }
  }
  flush();
  return tokens.length ? tokens : [{ text: '' }];
}

/** A JSON text as lines of coloured runs; lines that start with `#` are comments */
export function tokenizeJson(text: string): CodeToken[][] {
  const state: JsonState = { depth: 0, triple: false };
  return text.split('\n').map((line) => tokenizeJsonLine(line, state));
}

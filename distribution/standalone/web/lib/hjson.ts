/* SPDX-License-Identifier: Apache-2.0 */

/*
 * HJSON, the JSON with comments and quoteless strings that a Vega spec is written in. The reader
 * and the writer follow hjson-js 3.2.1 rule for rule, with its error texts, so that a spec gives
 * the value, the error and the reformatted text it gives in OpenSearch Dashboards. hjson-js is
 * under the MIT License, Copyright (c) 2014-2017 Christian Zangl.
 */

export interface HjsonParseOptions {
  /** Braces of the root object may be left out: on unless false */
  legacyRoot?: boolean;
  /** Keeps the comments and blank lines, for a writer that keeps them too */
  keepWsc?: boolean;
}

export interface HjsonStringifyOptions {
  keepWsc?: boolean;
  /** `key: {` rather than `key:` and the brace on a line of its own */
  bracesSameLine?: boolean;
  /** The indent: a number of spaces or the text itself */
  space?: number | string;
}

/** The comments of an object (by key) or of an array (by position), before and after each item */
interface Comments {
  c?: Record<string, [string, string]>;
  o?: string[];
  a?: Array<[string, string]>;
  /** Inside an empty object or array */
  e?: string[];
  /** Before and after the root value */
  r?: [string, string];
}

// The comments of each value read with keepWsc, as hjson-js keeps them on the value
const COMMENTS = new WeakMap<object, Comments>();

function createComment(value: unknown, comment?: Comments): Comments {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
    // hjson-js defines a property on the value, which a string or a number cannot take
    throw new TypeError('Object.defineProperty called on non-object');
  }
  const kept = comment ?? {};
  COMMENTS.set(value, kept);
  return kept;
}

const commentOf = (value: unknown): Comments | undefined =>
  value !== null && typeof value === 'object' ? COMMENTS.get(value) : undefined;

/** A number as HJSON reads one: the whole text, without a leading zero; undefined otherwise */
export function tryParseNumber(text: string, stopAtNext?: boolean): number | undefined {
  let string = '';
  let leadingZeros = 0;
  let testLeading = true;
  let at = 0;
  let ch: string | 0 = '';
  const next = () => {
    ch = text.charAt(at);
    at++;
    return ch;
  };
  const digit = () => typeof ch === 'string' && ch >= '0' && ch <= '9';

  next();
  if (ch === '-') {
    string = '-';
    next();
  }
  while (digit()) {
    if (testLeading) {
      if (ch === '0') leadingZeros++;
      else testLeading = false;
    }
    string += ch;
    next();
  }
  if (testLeading) leadingZeros--; // a single 0 is allowed
  if (ch === '.') {
    string += '.';
    while (next() && digit()) string += ch;
  }
  if (ch === 'e' || ch === 'E') {
    string += ch;
    const sign = next();
    if (sign === '-' || sign === '+') {
      string += ch;
      next();
    }
    while (digit()) {
      string += ch;
      next();
    }
  }
  // white space up to the end of the line
  while (ch && ch <= ' ') next();
  if (stopAtNext) {
    // the scan ends at a punctuator or a comment
    if (ch === ',' || ch === '}' || ch === ']' || ch === '#' || (ch === '/' && (text[at] === '/' || text[at] === '*'))) {
      ch = 0;
    }
  }
  const number = +string;
  if (ch || leadingZeros || !isFinite(number)) return undefined;
  return number;
}

interface HintedError extends Error {
  hint?: string;
}

/** Reads HJSON text as hjson-js's parse does */
export function parseHjson(source: string, options: HjsonParseOptions = {}): unknown {
  if (typeof source !== 'string') throw new Error('source is not a string');
  const keepComments = Boolean(options.keepWsc);
  const legacyRoot = options.legacyRoot !== false;
  const text = source;
  let at = 0;
  let ch = ' ';
  const escapee: Record<string, string> = { '"': '"', "'": "'", '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };

  const resetAt = () => {
    at = 0;
    ch = ' ';
  };
  const isPunctuatorChar = (c: string) => c === '{' || c === '}' || c === '[' || c === ']' || c === ',' || c === ':';

  const error = (m: string): never => {
    let i: number;
    let col = 0;
    let line = 1;
    for (i = at - 1; i > 0 && text[i] !== '\n'; i--, col++) {
      // counts the columns back to the start of the line
    }
    for (; i > 0; i--) if (text[i] === '\n') line++;
    throw new Error(`${m} at line ${line},${col} >>>${text.substr(at - col, 20)} ...`);
  };

  const next = () => {
    ch = text.charAt(at);
    at++;
    return ch;
  };
  const peek = (offset: number) => text.charAt(at + offset);
  // the character read last, as a call: the checks before a call to next() say nothing of it after
  const current = (): string => ch;

  const mlString = (): string => {
    let string = '';
    let triple = 0;
    // at ''' + 1: the indent of the line
    let indent = 0;
    for (;;) {
      const c = peek(-indent - 5);
      if (!c || c === '\n') break;
      indent++;
    }
    const skipIndent = () => {
      let skip = indent;
      while (ch && ch <= ' ' && ch !== '\n' && skip-- > 0) next();
    };
    // white space up to the end of the line
    while (ch && ch <= ' ' && ch !== '\n') next();
    if (ch === '\n') {
      next();
      skipIndent();
    }
    for (;;) {
      if (!ch) {
        error('Bad multiline string');
      } else if (ch === "'") {
        triple++;
        next();
        if (triple === 3) {
          if (string.slice(-1) === '\n') string = string.slice(0, -1); // the last end of line
          return string;
        }
        continue;
      } else {
        while (triple > 0) {
          string += "'";
          triple--;
        }
      }
      if (ch === '\n') {
        string += '\n';
        next();
        skipIndent();
      } else {
        if (ch !== '\r') string += ch;
        next();
      }
    }
  };

  const string = (allowML: boolean): string => {
    let value = '';
    const exitCh = ch;
    while (next()) {
      if (ch === exitCh) {
        next();
        if (allowML && exitCh === "'" && ch === "'" && value.length === 0) {
          // ''' starts a multiline string
          next();
          return mlString();
        }
        return value;
      }
      if (ch === '\\') {
        if (next() === 'u') {
          let uffff = 0;
          for (let i = 0; i < 4; i++) {
            const h = next();
            const c = h.charCodeAt(0);
            let hex = 0;
            if (h >= '0' && h <= '9') hex = c - 48;
            else if (h >= 'a' && h <= 'f') hex = c - 97 + 0xa;
            else if (h >= 'A' && h <= 'F') hex = c - 65 + 0xa;
            else error(`Bad \\u char ${h}`);
            uffff = uffff * 16 + hex;
          }
          value += String.fromCharCode(uffff);
        } else if (typeof escapee[ch] === 'string') {
          value += escapee[ch];
        } else break;
      } else if (ch === '\n' || ch === '\r') {
        error('Bad string containing newline');
      } else {
        value += ch;
      }
    }
    return error('Bad string');
  };

  const keyname = (): string => {
    // quotes are needed only for a key with {}[],: or white space
    if (ch === '"' || ch === "'") return string(false);
    let name = '';
    const start = at;
    let space = -1;
    for (;;) {
      if (ch === ':') {
        if (!name) error("Found ':' but no key name (for an empty key name use quotes)");
        else if (space >= 0 && space !== name.length) {
          at = start + space;
          error('Found whitespace in your key name (use quotes to include)');
        }
        return name;
      } else if (ch <= ' ') {
        if (!ch) error('Found EOF while looking for a key name (check your syntax)');
        else if (space < 0) space = name.length;
      } else if (isPunctuatorChar(ch)) {
        error(
          `Found '${ch}' where a key name was expected (check your syntax or use quotes if the key name includes {}[],: or whitespace)`
        );
      } else {
        name += ch;
      }
      next();
    }
  };

  const white = () => {
    while (ch) {
      while (ch && ch <= ' ') next();
      if (ch === '#' || (ch === '/' && peek(0) === '/')) {
        while (current() && current() !== '\n') next();
      } else if (ch === '/' && peek(0) === '*') {
        next();
        next();
        while (current() && !(current() === '*' && peek(0) === '/')) next();
        if (ch) {
          next();
          next();
        }
      } else break;
    }
  };

  // A quoteless string, or true, false, null or a number
  const tfnns = (): unknown => {
    let value = ch;
    if (isPunctuatorChar(ch)) {
      error(`Found a punctuator character '${ch}' when expecting a quoteless string (check your syntax)`);
    }
    for (;;) {
      next();
      const isEol = ch === '\r' || ch === '\n' || ch === '';
      if (isEol || ch === ',' || ch === '}' || ch === ']' || ch === '#' || (ch === '/' && (peek(0) === '/' || peek(0) === '*'))) {
        // true, false, null or a number followed by , } ] or a comment is that value
        const chf = value[0];
        switch (chf) {
          case 'f':
            if (value.trim() === 'false') return false;
            break;
          case 'n':
            if (value.trim() === 'null') return null;
            break;
          case 't':
            if (value.trim() === 'true') return true;
            break;
          default:
            if (chf === '-' || (chf >= '0' && chf <= '9')) {
              const n = tryParseNumber(value);
              if (n !== undefined) return n;
            }
        }
        if (isEol) {
          // white space at the end of a quoteless string is not part of it
          return value.trim();
        }
      }
      value += ch;
    }
  };

  const getComment = (cAtStart: number, first?: boolean): string[] => {
    let i: number;
    const cAt = cAtStart - 1;
    // trailing white space up to the end of the line
    for (i = at - 2; i > cAt && text[i] <= ' ' && text[i] !== '\n'; i--) {
      // moves back over it
    }
    if (text[i] === '\n') i--;
    if (text[i] === '\r') i--;
    const res = text.substr(cAt, i - cAt + 1);
    for (i = 0; i < res.length; i++) {
      if (res[i] > ' ') {
        const j = res.indexOf('\n');
        if (j >= 0) {
          const c = [res.substr(0, j), res.substr(j + 1)];
          if (first && c[0].trim().length === 0) c.shift();
          return c;
        }
        return [res];
      }
    }
    return [];
  };

  const errorClosingHint = (value: unknown): string => {
    const search = (item: unknown, character: string): string | undefined => {
      let res: string | undefined;
      if (typeof item === 'string') {
        if (item.indexOf(character) >= 0) res = item;
      } else if (item !== null && typeof item === 'object') {
        if (Array.isArray(item)) {
          for (const element of item) res = search(element, character) ?? res;
        } else {
          for (const key of Object.keys(item)) res = search((item as Record<string, unknown>)[key], character) ?? res;
        }
      }
      return res;
    };
    const report = (character: string) => {
      const possibleErr = search(value, character);
      return possibleErr
        ? `found '${character}' in a string value, your mistake could be with:\n  > ${possibleErr}\n  (unquoted strings contain everything up to the next line!)`
        : '';
    };
    return report('}') || report(']');
  };

  const array = (): unknown[] => {
    const result: unknown[] = [];
    let comments: Comments | undefined;
    let nextComment: string | undefined;
    try {
      if (keepComments) comments = createComment(result, { a: [] });
      next();
      let cAt = at;
      white();
      if (comments) nextComment = getComment(cAt, true).join('\n');
      if (ch === ']') {
        next();
        if (comments) comments.e = [nextComment ?? ''];
        return result;
      }
      while (ch) {
        result.push(value());
        cAt = at;
        white();
        // commas are optional, and one may trail; comments before a comma are not kept
        if (ch === ',') {
          next();
          cAt = at;
          white();
        }
        if (comments?.a) {
          const c = getComment(cAt);
          comments.a.push([nextComment || '', c[0] || '']);
          nextComment = c[1];
        }
        if (ch === ']') {
          next();
          if (comments?.a) comments.a[comments.a.length - 1][1] += nextComment || '';
          return result;
        }
        white();
      }
      return error("End of input while parsing an array (missing ']')");
    } catch (failure) {
      const hinted = failure as HintedError;
      hinted.hint = hinted.hint || errorClosingHint(result);
      throw failure;
    }
  };

  const object = (withoutBraces?: boolean): Record<string, unknown> => {
    let key = '';
    const result: Record<string, unknown> = {};
    let comments: Comments | undefined;
    let nextComment: string | undefined;
    try {
      if (keepComments) comments = createComment(result, { c: {}, o: [] });
      let cAt: number;
      if (!withoutBraces) {
        next();
        cAt = at;
      } else cAt = 1;
      white();
      if (comments) nextComment = getComment(cAt, true).join('\n');
      if (ch === '}' && !withoutBraces) {
        if (comments) comments.e = [nextComment ?? ''];
        next();
        return result;
      }
      while (ch) {
        key = keyname();
        white();
        if (ch !== ':') error(`Expected ':' instead of '${ch}'`);
        next();
        // a key given twice keeps the last value
        result[key] = value();
        cAt = at;
        white();
        if (ch === ',') {
          next();
          cAt = at;
          white();
        }
        if (comments?.c && comments.o) {
          const c = getComment(cAt);
          comments.c[key] = [nextComment || '', c[0] || ''];
          nextComment = c[1];
          comments.o.push(key);
        }
        if (ch === '}' && !withoutBraces) {
          next();
          if (comments?.c) comments.c[key][1] += nextComment || '';
          return result;
        }
        white();
      }
      if (withoutBraces) return result;
      return error("End of input while parsing an object (missing '}')");
    } catch (failure) {
      const hinted = failure as HintedError;
      hinted.hint = hinted.hint || errorClosingHint(result);
      throw failure;
    }
  };

  const value = (): unknown => {
    white();
    switch (ch) {
      case '{':
        return object();
      case '[':
        return array();
      case "'":
      case '"':
        return string(true);
      default:
        return tfnns();
    }
  };

  const checkTrailing = (v: unknown, c: string[] | null): unknown => {
    const cAt = at;
    white();
    if (ch) error('Syntax error, found trailing characters');
    if (keepComments && c) {
      const b = c.join('\n');
      const a = getComment(cAt).join('\n');
      if (a || b) {
        const comments = createComment(v, commentOf(v));
        comments.r = [b, a];
      }
    }
    return v;
  };

  const rootValue = () => {
    white();
    const c = keepComments ? getComment(1) : null;
    switch (ch) {
      case '{':
        return checkTrailing(object(), c);
      case '[':
        return checkTrailing(array(), c);
      default:
        return checkTrailing(value(), c);
    }
  };

  const legacyRootValue = () => {
    // the braces of the root object may be left out
    white();
    const c = keepComments ? getComment(1) : null;
    switch (ch) {
      case '{':
        return checkTrailing(object(), c);
      case '[':
        return checkTrailing(array(), c);
    }
    try {
      // an object without braces
      return checkTrailing(object(true), c);
    } catch (failure) {
      // or a single value: true, false, null, a number or a string
      resetAt();
      try {
        return checkTrailing(value(), c);
      } catch {
        throw failure;
      }
    }
  };

  resetAt();
  return legacyRoot ? legacyRootValue() : rootValue();
}

/** Writes a value as HJSON, as hjson-js's stringify does */
export function stringifyHjson(data: unknown, options: HjsonStringifyOptions = {}): string | undefined {
  const eol = '\n';
  const indent = typeof options.space === 'number' ? ' '.repeat(options.space) : typeof options.space === 'string' ? options.space : '  ';
  const keepComments = Boolean(options.keepWsc);
  const bracesSameLine = Boolean(options.bracesSameLine);
  const multiline = 1;

  const commonRange = '\x7f-\x9f­؀-؄܏឴឵‌-‏ - ⁠-⁯﻿￰-￿';
  // whether a string can be written without escapes
  const needsEscape = new RegExp(`[\\\\\\"\x00-\x1f${commonRange}]`, 'g');
  // whether a string can be written without quotes
  const needsQuotes = new RegExp(`^\\s|^"|^'|^#|^\\/\\*|^\\/\\/|^\\{|^\\}|^\\[|^\\]|^:|^,|\\s$|[\x00-\x1f${commonRange}]`, 'g');
  // whether a string can be written as a multiline string
  const needsEscapeML = new RegExp(`'''|^[\\s]+$|[\x00-\x08\x0b\x0c\x0e-\x1f${commonRange}]`, 'g');
  // a keyword, maybe followed by a comment
  const startsWithKeyword = /^(true|false|null)\s*((,|\]|\}|#|\/\/|\/\*).*)?$/;
  const meta: Record<string, string> = { '\b': 'b', '\t': 't', '\n': 'n', '\f': 'f', '\r': 'r', '"': '"', '\\': '\\' };
  const needsEscapeName = /[,{[}\]\s:#"']|\/\/|\/\*/;
  let gap = '';

  const quoteReplace = (value: string) =>
    value.replace(needsEscape, (a) => {
      const c = meta[a];
      if (typeof c === 'string') return `\\${c}`;
      return `\\u${`0000${a.charCodeAt(0).toString(16)}`.slice(-4)}`;
    });

  const mlString = (value: string, at: string): string => {
    const lines = value.replace(/\r/g, '').split('\n');
    const lineGap = at + indent;
    if (lines.length === 1) {
      // one line: the multiline form still saves escaping a backslash
      return `'''${lines[0]}'''`;
    }
    let res = `${eol}${lineGap}'''`;
    for (const line of lines) {
      res += eol;
      if (line) res += lineGap + line;
    }
    return `${res}${eol}${lineGap}'''`;
  };

  const quote = (value: string, at: string, hasComment: boolean, isRootObject?: boolean): string => {
    if (!value) return '""';
    needsQuotes.lastIndex = 0;
    startsWithKeyword.lastIndex = 0;
    // without quotes unless it would read as true, false, null or a number
    if (hasComment || needsQuotes.test(value) || tryParseNumber(value, true) !== undefined || startsWithKeyword.test(value)) {
      needsEscape.lastIndex = 0;
      needsEscapeML.lastIndex = 0;
      if (!needsEscape.test(value)) return `"${value}"`;
      if (!needsEscapeML.test(value) && !isRootObject && multiline) return mlString(value, at);
      return `"${quoteReplace(value)}"`;
    }
    return value;
  };

  const quoteKey = (name: string): string => {
    if (!name) return '""';
    if (needsEscapeName.test(name)) {
      needsEscape.lastIndex = 0;
      return `"${needsEscape.test(name) ? quoteReplace(name) : name}"`;
    }
    return name;
  };

  const forceComment = (value: string): string => {
    if (!value) return '';
    const lines = value.split('\n');
    for (let j = 0; j < lines.length; j++) {
      const line = lines[j];
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '#') break;
        if (c === '/' && (line[i + 1] === '/' || line[i + 1] === '*')) {
          if (line[i + 1] === '*') j = lines.length; // a /* */ is taken to cover the block
          break;
        }
        if (c > ' ') {
          lines[j] = `# ${line}`;
          break;
        }
      }
    }
    return lines.join('\n');
  };

  const startsWithNL = (value: string) => Boolean(value) && value[value[0] === '\r' ? 1 : 0] === '\n';
  const commentOnThisLine = (value: string) => Boolean(value) && !startsWithNL(value);
  const makeComment = (value: string, prefix: string, trim?: boolean): string => {
    if (!value) return '';
    let comment = forceComment(value);
    let i = 0;
    const len = comment.length;
    for (; i < len && comment[i] <= ' '; i++) {
      // leading white space
    }
    if (trim && i > 0) comment = comment.substr(i);
    if (i < len) return prefix + comment;
    return comment;
  };

  const str = (value: unknown, hasComment: boolean, noIndent?: boolean, isRootObject?: boolean): string | undefined => {
    switch (typeof value) {
      case 'string':
        return quote(value, gap, hasComment, isRootObject);
      case 'number':
        return isFinite(value) ? String(value) : 'null';
      case 'boolean':
        return String(value);
      case 'object': {
        if (!value) return 'null';
        const comments = keepComments ? commentOf(value) : undefined;
        const isArray = Array.isArray(value);
        const mind = gap;
        gap += indent;
        const eolMind = eol + mind;
        const eolGap = eol + gap;
        const prefix = noIndent || bracesSameLine ? '' : eolMind;
        const partial: string[] = [];
        let res: string;
        if (isArray) {
          const items = value as unknown[];
          for (let i = 0; i < items.length; i++) {
            let c: [string, string] | [] = [];
            let ca = false;
            if (comments) {
              c = comments.a?.[i] ?? [];
              ca = commentOnThisLine(c[1] ?? '');
              partial.push(makeComment(c[0] ?? '', '\n') + eolGap);
            } else partial.push(eolGap);
            partial.push(`${str(items[i], comments ? ca : false, true)}`);
            if (comments && c[1]) partial.push(makeComment(c[1], ca ? ' ' : '\n', ca));
          }
          if (items.length === 0) {
            if (comments?.e) partial.push(makeComment(comments.e[0], '\n') + eolMind);
          } else partial.push(eolMind);
          res = partial.length === 0 ? '[]' : `${prefix}[${partial.join('')}]`;
        } else {
          const record = value as Record<string, unknown>;
          const commentKeys = comments?.o ? comments.o.slice() : [];
          const objectKeys = Object.keys(record).filter((key) => commentKeys.indexOf(key) < 0);
          const keys = commentKeys.concat(objectKeys);
          for (let i = 0; i < keys.length; i++) {
            const k = keys[i];
            let c: [string, string] | [] = [];
            let ca = false;
            if (comments) {
              c = comments.c?.[k] ?? [];
              ca = commentOnThisLine(c[1] ?? '');
              partial.push(makeComment(c[0] ?? '', '\n') + eolGap);
            } else partial.push(eolGap);
            const vs = str(record[k], Boolean(comments) && ca);
            partial.push(`${quoteKey(k)}:${startsWithNL(vs ?? '') ? '' : ' '}${vs}`);
            if (comments && c[1]) partial.push(makeComment(c[1], ca ? ' ' : '\n', ca));
          }
          if (keys.length === 0) {
            if (comments?.e) partial.push(makeComment(comments.e[0], '\n') + eolMind);
          } else partial.push(eolMind);
          res = partial.length === 0 ? '{}' : `${prefix}{${partial.join('')}}`;
        }
        gap = mind;
        return res;
      }
      default:
        return undefined;
    }
  };

  let res = '';
  const rootComments = keepComments ? commentOf(data)?.r : undefined;
  if (rootComments?.[0]) res = `${rootComments[0]}\n`;
  const body = str(data, false, true, true);
  if (body === undefined && !rootComments) return undefined;
  res += body;
  if (rootComments) res += rootComments[1] || '';
  return res;
}

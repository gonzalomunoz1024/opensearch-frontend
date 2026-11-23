/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Rison, the compact form of JSON that OpenSearch Dashboards keeps a page's state in, in the
 * address: `(time:(from:now-7d,to:now),filters:!())`. Reading and writing it here keeps its
 * links and bookmarks working.
 */

export type RisonValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | RisonValue[]
  | { [key: string]: RisonValue };

const NOT_ID_CHAR = " '!:(),*@$";
const NOT_ID_START = `-0123456789${NOT_ID_CHAR}`;

function isId(text: string): boolean {
  if (text === '' || NOT_ID_START.includes(text[0])) return false;
  for (const char of text) if (NOT_ID_CHAR.includes(char)) return false;
  return true;
}

const quote = (text: string) => (isId(text) ? text : `'${text.replace(/(['!])/g, '!$1')}'`);

export function encode(value: RisonValue): string {
  if (value === null || value === undefined) return '!n';
  if (typeof value === 'boolean') return value ? '!t' : '!f';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '!n';
    return String(value).replace(/\+/, '');
  }
  if (typeof value === 'string') return value === '' ? "''" : quote(value);
  if (Array.isArray(value)) return `!(${value.map(encode).join(',')})`;
  const pairs = Object.keys(value)
    .sort()
    .filter((key) => value[key] !== undefined && typeof value[key] !== 'function')
    .map((key) => `${quote(key)}:${encode(value[key])}`);
  return `(${pairs.join(',')})`;
}

// What starts a name, and what a name is made of: the first run of such characters from a place on
const NEXT_ID = /[^-0123456789 '!:(),*@$][^ '!:(),*@$]*/g;

/*
 * The reader of rison-node 1.0.2, which OpenSearch Dashboards reads an address with, step for
 * step, so that the same text is read into the same value or refused. What that makes of awkward
 * text is kept: a number is as many digits, one `-`, a `.` and an `e` as follow (`1.` is 1,
 * `1-1` is not a number but is read), `1e+5` is refused, a key can be any value (`(!t:a)` has the
 * key "true"), and a name cannot start with `-` or a digit.
 */
class Parser {
  private index = 0;
  private message: string | undefined;

  constructor(private readonly text: string) {}

  parse(): RisonValue {
    let value = this.readValue();
    if (this.message === undefined && this.next() !== undefined) {
      value = this.error(`unable to parse string as rison: '${encode(this.text)}'`);
    }
    if (this.message !== undefined) throw new Error(`rison decoder error: ${this.message}`);
    return value;
  }

  /** Notes what is wrong and goes on, as the original: the last thing noted is what is told */
  private error(message: string): undefined {
    this.message = message;
    return undefined;
  }

  private next(): string | undefined {
    if (this.index === this.text.length) return undefined;
    const char = this.text.charAt(this.index);
    this.index += 1;
    return char;
  }

  private readValue(): RisonValue {
    const char = this.next();
    if (char === '!') return this.bang();
    if (char === '(') return this.object();
    if (char === "'") return this.quoted();
    if (char === '-' || (char !== undefined && char >= '0' && char <= '9')) return this.number();
    // A name: looked for from the character just read (at the end of the text, from the one
    // before) onwards, and taken as long as it is from there
    const from = this.index - 1;
    NEXT_ID.lastIndex = from;
    const match = NEXT_ID.exec(this.text);
    // The original fails here in the same words
    if (match === null) throw new TypeError("Cannot read properties of null (reading 'length')");
    this.index = from + match[0].length;
    return match[0];
  }

  private bang(): RisonValue {
    const char = this.text.charAt(this.index);
    this.index += 1;
    if (!char) return this.error('"!" at end of input');
    if (char === 't') return true;
    if (char === 'f') return false;
    if (char === 'n') return null;
    if (char === '(') return this.array();
    return this.error(`unknown literal: "!${char}"`);
  }

  private array(): RisonValue {
    const items: RisonValue[] = [];
    for (;;) {
      const char = this.next();
      if (char === ')') return items;
      if (!char) return this.error("unmatched '!('");
      if (items.length) {
        if (char !== ',') this.error("missing ','");
      } else if (char === ',') {
        return this.error("extra ','");
      } else {
        this.index -= 1;
      }
      const item = this.readValue();
      if (item === undefined) return undefined;
      items.push(item);
    }
  }

  private object(): RisonValue {
    const result: { [key: string]: RisonValue } = {};
    let count = 0;
    for (;;) {
      const char = this.next();
      if (char === ')') return result;
      // At the end of the text the original steps back onto the bracket that opened the object
      // and reads it again, without end
      if (char === undefined && count === 0) throw new RangeError('Maximum call stack size exceeded');
      if (count) {
        if (char !== ',') this.error("missing ','");
      } else if (char === ',') {
        return this.error("extra ','");
      } else {
        this.index -= 1;
      }
      const key = this.readValue();
      if (key === undefined) return undefined;
      if (this.next() !== ':') return this.error("missing ':'");
      const value = this.readValue();
      if (value === undefined) return undefined;
      // Whatever the key is, it is a key as text
      result[String(key)] = value;
      count += 1;
    }
  }

  private quoted(): RisonValue {
    const text = this.text;
    let at = this.index;
    let start = at;
    const segments: string[] = [];
    for (;;) {
      let char = text.charAt(at);
      at += 1;
      if (char === "'") break;
      if (!char) return this.error('unmatched "\'"');
      if (char === '!') {
        if (start < at - 1) segments.push(text.slice(start, at - 1));
        char = text.charAt(at);
        at += 1;
        if ("!'".indexOf(char) >= 0) segments.push(char);
        else return this.error(`invalid string escape: "!${char}"`);
        start = at;
      }
    }
    if (start < at - 1) segments.push(text.slice(start, at - 1));
    this.index = at;
    return segments.join('');
  }

  private number(): RisonValue {
    const text = this.text;
    let at = this.index;
    const start = at - 1;
    let state: string | undefined = 'int';
    let permittedSigns = '-';
    const transitions: Record<string, string | undefined> = { 'int+.': 'frac', 'int+e': 'exp', 'frac+e': 'exp' };
    do {
      const char = text.charAt(at);
      at += 1;
      if (!char) break;
      if (char >= '0' && char <= '9') continue;
      if (permittedSigns.indexOf(char) >= 0) {
        permittedSigns = '';
        continue;
      }
      state = transitions[`${state}+${char.toLowerCase()}`];
      if (state === 'exp') permittedSigns = '-';
    } while (state);
    at -= 1;
    this.index = at;
    const digits = text.slice(start, at);
    if (digits === '-') return this.error('invalid number');
    return Number(digits);
  }
}

/** The value a text stands for; an error (not always a rison one) when the original refuses it */
export function decode(text: string): RisonValue {
  if (typeof text !== 'string') throw new Error('rison decoder error: decode input must be a string');
  return new Parser(text).parse();
}

/** `undefined` instead of an error, for a value read from an address someone may have edited */
export function tryDecode(text: string | null | undefined): RisonValue | undefined {
  if (text === null || text === undefined || text === '') return undefined;
  try {
    return decode(text);
  } catch {
    return undefined;
  }
}

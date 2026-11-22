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

class Parser {
  private at = 0;
  constructor(private readonly text: string) {}

  parse(): RisonValue {
    const value = this.value();
    if (this.at < this.text.length) this.fail(`unexpected "${this.text[this.at]}"`);
    return value;
  }

  private fail(message: string): never {
    throw new Error(`rison: ${message} at position ${this.at}`);
  }

  private value(): RisonValue {
    const char = this.text[this.at];
    if (char === undefined) this.fail('unexpected end');
    if (char === '!') {
      this.at += 1;
      const next = this.text[this.at];
      this.at += 1;
      if (next === 't') return true;
      if (next === 'f') return false;
      if (next === 'n') return null;
      if (next === '(') return this.array();
      this.fail(`unknown literal "!${next ?? ''}"`);
    }
    if (char === '(') {
      this.at += 1;
      return this.object();
    }
    if (char === "'") {
      this.at += 1;
      return this.quoted();
    }
    if (char === '-' || (char >= '0' && char <= '9')) return this.number();
    return this.id();
  }

  private array(): RisonValue[] {
    const items: RisonValue[] = [];
    if (this.text[this.at] === ')') {
      this.at += 1;
      return items;
    }
    for (;;) {
      items.push(this.value());
      const char = this.text[this.at];
      this.at += 1;
      if (char === ')') return items;
      if (char !== ',') this.fail('a list needs "," or ")"');
    }
  }

  private object(): { [key: string]: RisonValue } {
    const result: { [key: string]: RisonValue } = {};
    if (this.text[this.at] === ')') {
      this.at += 1;
      return result;
    }
    for (;;) {
      const key = this.text[this.at] === "'" ? (this.at += 1, this.quoted()) : this.id();
      if (this.text[this.at] !== ':') this.fail('a key needs ":"');
      this.at += 1;
      result[key] = this.value();
      const char = this.text[this.at];
      this.at += 1;
      if (char === ')') return result;
      if (char !== ',') this.fail('an object needs "," or ")"');
    }
  }

  private quoted(): string {
    let result = '';
    for (;;) {
      const char = this.text[this.at];
      if (char === undefined) this.fail('a quote is not closed');
      this.at += 1;
      if (char === "'") return result;
      if (char === '!') {
        const escaped = this.text[this.at];
        if (escaped !== '!' && escaped !== "'") this.fail('"!" must be followed by "!" or a quote');
        result += escaped;
        this.at += 1;
      } else {
        result += char;
      }
    }
  }

  private number(): number {
    const match = /^-?\d+(\.\d+)?([eE][-+]?\d+)?/.exec(this.text.slice(this.at));
    if (!match) this.fail('not a number');
    this.at += match[0].length;
    return Number(match[0]);
  }

  private id(): string {
    const start = this.at;
    while (this.at < this.text.length && !NOT_ID_CHAR.includes(this.text[this.at])) this.at += 1;
    if (this.at === start) this.fail(`unexpected "${this.text[this.at]}"`);
    return this.text.slice(start, this.at);
  }
}

export function decode(text: string): RisonValue {
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

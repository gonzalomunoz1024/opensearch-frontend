/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The Less of a markdown panel's custom CSS, made CSS as the product makes it: the text is wrapped
 * in the panel's own selector and compiled compressed. This handles what such a style sheet is
 * written with: rules nested in rules, the parent selector `&`, variables, comments and @media
 * inside a rule. What it cannot read (an @import, an unknown variable, braces that do not close)
 * gives no CSS, as a Less error does in the product, and the panel keeps the CSS it had.
 */

interface Declaration {
  kind: 'declaration';
  name: string;
  value: string;
}

interface Variable {
  kind: 'variable';
  name: string;
  value: string;
}

interface Block {
  kind: 'rule' | 'at';
  /** The selector of a rule, or the at-rule with its prelude: "@media (max-width: 600px)" */
  head: string;
  items: Item[];
}

type Item = Declaration | Variable | Block;

class LessError extends Error {}

/** The text without its comments, strings left as they are */
function stripComments(source: string): string {
  let out = '';
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === '"' || char === "'") {
      const end = closingQuote(source, i);
      out += source.slice(i, end + 1);
      i = end;
    } else if (char === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      if (end < 0) throw new LessError('Unclosed comment');
      i = end + 1;
    } else if (char === '/' && source[i + 1] === '/' && source[i - 1] !== ':') {
      // A line comment, but not the slashes of a url such as http://
      const end = source.indexOf('\n', i);
      i = end < 0 ? source.length : end - 1;
    } else out += char;
  }
  return out;
}

function closingQuote(source: string, start: number): number {
  for (let i = start + 1; i < source.length; i++) {
    if (source[i] === '\\') i++;
    else if (source[i] === source[start]) return i;
  }
  throw new LessError('Unclosed string');
}

/** The items of a block, read up to its closing brace */
function parseItems(source: string, at: { i: number }, nested: boolean): Item[] {
  const items: Item[] = [];
  let text = '';
  let depth = 0;
  while (at.i < source.length) {
    const char = source[at.i];
    if (char === '"' || char === "'") {
      const end = closingQuote(source, at.i);
      text += source.slice(at.i, end + 1);
      at.i = end + 1;
      continue;
    }
    if (char === '(') depth++;
    if (char === ')') depth--;
    if (char === '{' && depth === 0) {
      at.i++;
      const head = text.trim();
      text = '';
      if (head.startsWith('@import')) throw new LessError('Imports are not read');
      const children = parseItems(source, at, true);
      items.push({ kind: head.startsWith('@') ? 'at' : 'rule', head, items: children });
      continue;
    }
    if (char === '}' && depth === 0) {
      if (!nested) throw new LessError('Unexpected }');
      at.i++;
      pushStatement(items, text);
      return items;
    }
    if (char === ';' && depth === 0) {
      pushStatement(items, text);
      text = '';
      at.i++;
      continue;
    }
    text += char;
    at.i++;
  }
  if (nested) throw new LessError('Missing }');
  pushStatement(items, text);
  return items;
}

function pushStatement(items: Item[], text: string) {
  const statement = text.trim();
  if (!statement) return;
  if (statement.startsWith('@import')) throw new LessError('Imports are not read');
  const colon = statement.indexOf(':');
  if (colon < 0) throw new LessError(`Unrecognised input: ${statement}`);
  const name = statement.slice(0, colon).trim();
  const value = statement.slice(colon + 1).trim();
  if (name.startsWith('@')) items.push({ kind: 'variable', name: name.slice(1), value });
  else items.push({ kind: 'declaration', name, value });
}

type Scope = { variables: Map<string, string>; parent?: Scope };

function scopeOf(items: Item[], parent?: Scope): Scope {
  const variables = new Map<string, string>();
  // The last definition in a scope is the one used, wherever it is used
  for (const item of items) if (item.kind === 'variable') variables.set(item.name, item.value);
  return { variables, parent };
}

function lookup(scope: Scope, name: string, seen: Set<string>): string {
  for (let current: Scope | undefined = scope; current; current = current.parent) {
    const value = current.variables.get(name);
    if (value !== undefined) {
      if (seen.has(name)) throw new LessError(`Recursive variable definition for @${name}`);
      return substitute(value, current, new Set([...seen, name]));
    }
  }
  throw new LessError(`variable @${name} is undefined`);
}

/** A value with its variables written in: @name, and @{name} inside a selector or a string */
function substitute(text: string, scope: Scope, seen = new Set<string>()): string {
  return text.replace(/@\{([\w-]+)\}|@([\w-]+)/g, (match, braced: string | undefined, plain: string | undefined, offset: number) => {
    // An at-rule's own name is not a variable
    if (plain && offset === 0 && /^(media|supports|font-face|keyframes|-webkit-keyframes|page|charset|namespace)$/.test(plain)) return match;
    return lookup(scope, braced ?? plain ?? '', seen);
  });
}

const splitList = (text: string): string[] => {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of text) {
    if (char === '(' || char === '[') depth++;
    if (char === ')' || char === ']') depth--;
    if (char === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else current += char;
  }
  parts.push(current.trim());
  return parts.filter(Boolean);
};

/** Every selector of a nested rule joined to every one of its parent's */
function joinSelectors(parents: string[], own: string): string[] {
  const children = splitList(own);
  if (parents.length === 0) return children;
  return parents.flatMap((parent) => children.map((child) => (child.includes('&') ? child.replace(/&/g, parent) : `${parent} ${child}`)));
}

const compressSelector = (selector: string): string =>
  selector
    .replace(/\s+/g, ' ')
    .replace(/\s*([>+~])\s*/g, '$1')
    .trim();

const LENGTH_UNITS = 'px|em|ex|ch|rem|in|cm|mm|pc|pt|vw|vh|vmin|vmax';

/** A value written compressed: single spaces, no space after a comma, no unit on a length of 0, no 0 before a decimal point */
function compressValue(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (char === '"' || char === "'") {
      const end = closingQuote(value, i);
      out += value.slice(i, end + 1);
      i = end;
    } else out += char;
  }
  const important = /\s*!\s*important\s*$/i.exec(out);
  let body = important ? out.slice(0, important.index) : out;
  body = body
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ',')
    .replace(new RegExp(`(^|[\\s,(])0(?:${LENGTH_UNITS})(?![\\w%])`, 'g'), '$10')
    .replace(/(^|[\s,(:-])0\.(\d)/g, '$1.$2')
    .trim();
  return important ? `${body} !important` : body;
}

const compressAtPrelude = (prelude: string): string =>
  prelude
    .replace(/\s+/g, ' ')
    .replace(/\(\s*([\w-]+)\s*:\s*/g, '($1:')
    .replace(/\s*\)/g, ')')
    .replace(/\s*,\s*/g, ',')
    .trim();

interface Output {
  /** Rules and at-rules in the order they are written */
  parts: string[];
}

function emitBlock(items: Item[], selectors: string[], scope: Scope, out: Output) {
  const own = scopeOf(items, scope);
  const declarations = items
    .filter((item): item is Declaration => item.kind === 'declaration')
    .map((item) => `${substitute(item.name, own)}:${compressValue(substitute(item.value, own))}`);
  if (declarations.length && selectors.length) out.parts.push(`${selectors.map(compressSelector).join(',')}{${declarations.join(';')}}`);
  else if (declarations.length) throw new LessError('Properties must be inside selector blocks');
  for (const item of items) {
    if (item.kind === 'rule') emitBlock(item.items, joinSelectors(selectors, substitute(item.head, own)), own, out);
    else if (item.kind === 'at') {
      const prelude = compressAtPrelude(substitute(item.head, own));
      const inner: Output = { parts: [] };
      // An @media inside a rule bubbles up and keeps the rule's selector; other at-rules stand alone
      const keepsSelector = /^@(media|supports)\b/.test(prelude);
      emitBlock(item.items, keepsSelector ? selectors : [], own, inner);
      if (inner.parts.length) out.parts.push(`${prelude}{${inner.parts.join('')}}`);
    }
  }
}

/** The CSS of a markdown panel's Less, under its selector; undefined when the Less has an error */
export function compileLess(source: string, selector: string): string | undefined {
  try {
    const text = stripComments(`${selector} {${source}}`);
    const items = parseItems(text, { i: 0 }, false);
    const out: Output = { parts: [] };
    emitBlock(items, [], { variables: new Map() }, out);
    return out.parts.join('');
  } catch (error) {
    if (error instanceof LessError) return undefined;
    throw error;
  }
}

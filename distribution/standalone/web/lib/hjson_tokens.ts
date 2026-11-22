/* SPDX-License-Identifier: Apache-2.0 */

/*
 * HJSON in colour, as the spec editor of OpenSearch Dashboards colours it: the rules of its
 * editor's HJSON mode, read line by line the way that editor's tokenizer reads them, so the same
 * text gets the same colours, quirks included. A word followed by a colon is a key wherever it
 * is, so the `https` of a URL is one, and whatever follows `//` is a comment. Leading spaces carry
 * the editor's indent guides: one for each full two spaces before the last space of the indent.
 */

import type { CodeToken } from '../components/code_editor';

interface Rule {
  regex: string;
  /** The token type, or one per group of the regex */
  token: string | string[];
  push?: string;
  pop?: boolean;
}

interface State {
  rules: Rule[];
  defaultToken: string;
  regex: RegExp;
  /** For each group of the combined regex, the rule it belongs to */
  mapping: number[];
  /** For rules with a token per group, a regex that splits what they matched */
  splitters: Map<Rule, RegExp>;
}

// The parts of the mode's rules, as the mode writes them
const COMMENTS: Rule[] = [
  { token: ['comment.punctuation', 'comment.line'], regex: '(#)(.*$)' },
  { token: 'comment.punctuation', regex: '\\/\\*', push: 'block' },
  { token: ['comment.punctuation', 'comment.line'], regex: '(\\/\\/)(.*$)' },
];
const KEY_NAME: Rule = { token: 'keyword', regex: '(?:[^,\\{\\[\\}\\]\\s]+|"(?:[^"\\\\]|\\\\.)*")\\s*(?=:)' };
const VALUE: Rule[] = [
  { token: 'constant', regex: '\\b(?:true|false|null)\\b' },
  { token: 'constant.numeric', regex: '-?(?:0|[1-9]\\d*)(?:(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)?' },
  { token: 'string', regex: '"', push: 'string' },
  { token: 'paren.lparen', regex: '\\[', push: 'array' },
  { token: 'paren.lparen', regex: '\\{', push: 'object' },
  ...COMMENTS,
  { token: 'string', regex: "'''", push: 'mstring' },
  { token: 'string', regex: '\\b[^:,0-9\\-\\{\\[\\}\\]\\s].*$' },
];
const MEMBERS: Rule[] = [KEY_NAME, ...VALUE, { token: 'text', regex: ':' }, { token: 'text', regex: ',' }];

const RULES: Record<string, { rules: Rule[]; defaultToken: string }> = {
  start: {
    rules: [
      ...COMMENTS,
      { token: 'paren', regex: '(?=\\s*(?:[^,\\{\\[\\}\\]\\s]+|"(?:[^"\\\\]|\\\\.)*")\\s*:)', push: 'root' },
      ...VALUE,
    ],
    defaultToken: 'text',
  },
  array: {
    rules: [
      { token: 'paren.rparen', regex: '\\]', pop: true },
      ...VALUE,
      ...COMMENTS,
      { token: 'text', regex: ',|$' },
      { token: 'invalid.illegal', regex: '[^\\s\\]]' },
    ],
    defaultToken: 'array',
  },
  block: { rules: [{ token: 'comment.punctuation', regex: '\\*\\/', pop: true }], defaultToken: 'comment.block' },
  object: { rules: [{ token: 'paren.rparen', regex: '\\}', pop: true }, ...MEMBERS], defaultToken: 'paren' },
  // the object without braces at the top of a spec: it ends only with the text
  root: { rules: [{ token: 'paren.rparen', regex: '---none---', pop: true }, ...MEMBERS], defaultToken: 'paren' },
  string: {
    rules: [
      { token: 'string', regex: '"', pop: true },
      { token: 'constant.language.escape', regex: '\\\\(?:["\\\\\\/bfnrt]|u[0-9a-fA-F]{4})' },
      { token: 'invalid.illegal', regex: '\\\\.' },
    ],
    defaultToken: 'string',
  },
  mstring: { rules: [{ token: 'string', regex: "'''", pop: true }], defaultToken: 'string' },
};

const MAX_TOKEN_COUNT = 2000;

/** The groups of a regex become plain parentheses, so that each rule is one group of the whole */
const removeCapturingGroups = (source: string) =>
  source.replace(/\[(?:\\.|[^\]])*?\]|\\.|\(\?[:=!]|(\()/g, (match: string, group: string | undefined) => (group ? '(?:' : match));

const groupCount = (source: string) => (new RegExp(`(?:(${source})|(.))`).exec('a')?.length ?? 2) - 3;

function compile(): Record<string, State> {
  const states: Record<string, State> = {};
  for (const [name, { rules, defaultToken }] of Object.entries(RULES)) {
    const sources: string[] = [];
    const mapping: number[] = [];
    const splitters = new Map<Rule, RegExp>();
    rules.forEach((rule, index) => {
      if (groupCount(rule.regex) > 0) {
        if (Array.isArray(rule.token)) {
          let source = rule.regex;
          if (!source.startsWith('^')) source = `^${source}`;
          if (!source.endsWith('$')) source += '$';
          splitters.set(rule, new RegExp(source));
        }
        sources.push(removeCapturingGroups(rule.regex));
      } else {
        sources.push(rule.regex);
      }
      mapping.push(index);
    });
    states[name] = { rules, defaultToken, regex: new RegExp(`(${sources.join(')|(')})|($)`, 'g'), mapping, splitters };
  }
  return states;
}

let compiled: Record<string, State> | undefined;

interface RawToken {
  type: string;
  value: string;
}

/** Where a line ends: the state the next one starts in, and the states to go back to */
export interface HjsonLineState {
  current: string;
  stack: string[];
}

/** The tokens of one line and the state the next line starts in, as the editor's tokenizer finds them */
export function tokenizeHjsonLine(line: string, start: HjsonLineState): { tokens: RawToken[]; state: HjsonLineState } {
  compiled ??= compile();
  const stack = [...start.stack];
  let current = compiled[start.current] ? start.current : 'start';
  let state = compiled[current];
  let regex = state.regex;
  regex.lastIndex = 0;
  const tokens: RawToken[] = [];
  let token: RawToken | undefined;
  const append = (type: string, value: string) => {
    if (token && token.type === type) token.value += value;
    else {
      if (token) tokens.push(token);
      token = { type, value };
    }
  };
  let lastIndex = 0;
  let attempts = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(line))) {
    let type: string | RawToken[] = state.defaultToken;
    const value = match[0];
    const index = regex.lastIndex;
    if (index - value.length > lastIndex) append(type, line.substring(lastIndex, index - value.length));

    for (let group = 0; group < match.length - 2; group++) {
      if (match[group + 1] === undefined) continue;
      const rule = state.rules[state.mapping[group]];
      const splitter = state.splitters.get(rule);
      if (splitter && Array.isArray(rule.token)) {
        const parts = splitter.exec(value);
        const types = rule.token;
        type = parts ? types.flatMap((part, at) => (parts[at + 1] ? [{ type: part, value: parts[at + 1] }] : [])) : 'text';
      } else {
        type = rule.token as string;
      }
      if (rule.push || rule.pop) {
        if (rule.push) {
          // what the tokenizer keeps of where to go back to: nothing when it leaves the top
          if (current !== 'start' || stack.length) stack.unshift(rule.push, current);
          current = rule.push;
        } else {
          stack.shift();
          current = stack.shift() ?? 'start';
        }
        state = compiled[current];
        lastIndex = index;
        regex = state.regex;
        regex.lastIndex = index;
      }
      break;
    }

    if (value) {
      if (typeof type === 'string') append(type, value);
      else {
        if (token) tokens.push(token);
        token = undefined;
        tokens.push(...type);
      }
    }
    if (lastIndex === line.length) break;
    lastIndex = index;
    if (attempts++ > MAX_TOKEN_COUNT) {
      while (lastIndex < line.length) {
        if (token) tokens.push(token);
        token = { type: 'overflow', value: line.substring(lastIndex, (lastIndex += 2000)) };
      }
      current = 'start';
      stack.length = 0;
      break;
    }
  }
  if (token) tokens.push(token);
  return { tokens, state: { current, stack } };
}

/** The colour class of a token type: the editor's theme colours keys, constants, numbers, strings and comments */
function kindOf(type: string): string | undefined {
  const parts = type.split('.');
  if (parts.includes('comment')) return 'HjComment';
  if (parts.includes('invalid')) return 'HjInvalid';
  if (parts[0] === 'keyword') return 'HjKey';
  if (parts[0] === 'string') return 'HjString';
  if (parts[0] === 'constant') {
    if (parts.includes('numeric')) return 'HjNumber';
    if (parts.includes('language')) return 'HjEscape';
    return 'HjConstant';
  }
  return undefined;
}

const TAB_SIZE = 2;
const INDENT_GUIDE = /\s\S| \t|\t |\s$/;

/** A spec as coloured lines, with the indent guides of its leading spaces */
export function tokenizeHjson(text: string): CodeToken[][] {
  let state: HjsonLineState = { current: 'start', stack: [] };
  return text.split('\n').map((line) => {
    const result = tokenizeHjsonLine(line, state);
    state = result.state;
    const tokens: CodeToken[] = [];
    result.tokens.forEach((token, index) => {
      let value = token.value;
      const kind = kindOf(token.type);
      if (index === 0 && value[0] === ' ') {
        let columns = value.search(INDENT_GUIDE);
        if (columns > 0) {
          columns -= columns % TAB_SIZE;
          for (let guide = 0; guide < columns / TAB_SIZE; guide++) tokens.push({ text: ' '.repeat(TAB_SIZE), kind: 'HjGuide' });
          value = value.slice(columns);
        }
      }
      if (value) tokens.push(kind ? { text: value, kind } : { text: value });
    });
    return tokens.length ? tokens : [{ text: '' }];
  });
}

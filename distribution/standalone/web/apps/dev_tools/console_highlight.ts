/* SPDX-License-Identifier: Apache-2.0 */

/*
 * How the console colours what it shows. OpenSearch Dashboards draws its console with Ace and
 * the console's own modes; these are the rules of those modes, applied the way Ace applies
 * them: on each line every rule of the state is tried at once, the leftmost match wins and,
 * at one place, the first rule; what no rule takes is text; tokens of one kind run together.
 * The state a line ends in is what the request parser reads, as the original's does.
 */

export interface AceToken {
  type: string;
  value: string;
}

/** A state name, or Ace's stack of them while braces are open */
export type AceState = string | string[];

interface Rule {
  regex: string;
  /** One kind, one kind for each group of the regex, or a word list */
  token: string | string[] | ((value: string) => string);
  next?: string;
  push?: boolean;
  merge?: boolean;
}

interface State {
  rules: Rule[];
  defaultToken: string;
}

export type HighlightMode = 'input' | 'output' | 'text';

// --- The rules -----------------------------------------------------------------------------------

/** A rule that ends the line, then the same rule within it (the console's addEOL) */
function eol(tokens: string[], regex: string, nextIfEol: string, normalNext?: string): Rule[] {
  return [
    { token: [...tokens, 'whitespace'], regex: `${regex}(\\s*)$`, next: nextIfEol },
    { token: tokens, regex, next: normalNext },
  ];
}

const endTripleQuote: Rule = { token: 'punctuation.end_triple_quote', regex: '"""', next: 'pop' };

function jsonRules(root: string): Record<string, Rule[]> {
  const xJson: Rule[] = [
    {
      token: ['variable', 'whitespace', 'ace.punctuation.colon', 'whitespace', 'punctuation.start_triple_quote'],
      regex: '("(?:[^"]*_)?script"|"inline"|"source")(\\s*?)(:)(\\s*?)(""")',
      next: 'script-start',
      merge: false,
      push: true,
    },
    { token: 'variable', regex: '["](?:(?:\\\\.)|(?:[^"\\\\]))*?["]\\s*(?=:)' },
    { token: 'punctuation.start_triple_quote', regex: '"""', next: 'string_literal', merge: false, push: true },
    { token: 'string', regex: '["](?:(?:\\\\.)|(?:[^"\\\\]))*?["]' },
    { token: 'constant.numeric', regex: '0[xX][0-9a-fA-F]+\\b' },
    { token: 'constant.numeric', regex: '[+-]?\\d+(?:(?:\\.\\d*)?(?:[eE][+-]?\\d+)?)?\\b' },
    { token: 'constant.language.boolean', regex: '(?:true|false)\\b' },
    { token: 'invalid.illegal', regex: "['](?:(?:\\\\.)|(?:[^'\\\\]))*?[']" },
    { token: 'invalid.illegal', regex: '\\/\\/.*$' },
    { token: 'paren.lparen', merge: false, regex: '{', next: root, push: true },
    { token: 'paren.lparen', merge: false, regex: '[[(]' },
    { token: 'paren.rparen', merge: false, regex: '[\\])]' },
    { token: 'paren.rparen', regex: '}', merge: false, next: 'pop' },
    { token: 'punctuation.comma', regex: ',' },
    { token: 'punctuation.colon', regex: ':' },
    { token: 'whitespace', regex: '\\s+' },
    { token: 'text', regex: '.+?' },
  ];
  return {
    [root]: xJson,
    [`${root}-sql`]: [
      {
        token: ['variable', 'whitespace', 'ace.punctuation.colon', 'whitespace', 'punctuation.start_triple_quote'],
        regex: '("query")(\\s*?)(:)(\\s*?)(""")',
        next: 'sql-start',
        merge: false,
        push: true,
      },
      ...xJson,
    ],
    string_literal: [endTripleQuote, { token: 'multi_string', regex: '.' }],
  };
}

const PAINLESS_KEYWORDS =
  'def|int|long|byte|String|float|double|char|null|if|else|while|do|for|continue|break|new|try|catch|throw|this|instanceof|return|ctx';

const scriptRules: Rule[] = [
  endTripleQuote,
  { token: 'script.comment', regex: '\\/\\/.*$' },
  { token: 'script.string.regexp', regex: '[/](?:(?:\\[(?:\\\\]|[^\\]])+\\])|(?:\\\\/|[^\\]/]))*[/]\\w*\\s*(?=[).,;]|$)' },
  { token: 'script.string', regex: "['](?:(?:\\\\.)|(?:[^'\\\\]))*?[']" },
  { token: 'script.constant.numeric', regex: '0[xX][0-9a-fA-F]+\\b' },
  { token: 'script.constant.numeric', regex: '[+-]?\\d+(?:(?:\\.\\d*)?(?:[eE][+-]?\\d+)?)?\\b' },
  { token: 'script.constant.language.boolean', regex: '(?:true|false)\\b' },
  { token: 'script.keyword', regex: PAINLESS_KEYWORDS },
  { token: 'script.text', regex: '[a-zA-Z_$][a-zA-Z0-9_$]*\\b' },
  {
    token: 'script.keyword.operator',
    regex:
      '\\?\\.|\\*\\.|=~|==~|!|%|&|\\*|\\-\\-|\\-|\\+\\+|\\+|~|===|==|=|!=|!==|<=|>=|<<=|>>=|>>>=|<>|<|>|->|!|&&|\\|\\||\\?\\:|\\*=|%=|\\+=|\\-=|&=|\\^=|\\b(?:in|instanceof|new|typeof|void)',
  },
  { token: 'script.lparen', regex: '[[({]' },
  { token: 'script.rparen', regex: '[\\])}]' },
  { token: 'script.text', regex: '\\s+' },
];

// The word lists as OpenSearch Dashboards joins them, a missing "|" or two included
const SQL_WORDS = [
  'describe|between|in|like|not|and|or|desc|select|from|where|having|group|by|order' +
    'asc|desc|pivot|for|in|as|show|columns|include|frozen|tables|escape|limit|rlike|all|distinct|is',
  'avg|count|first|first_value|last|last_value|max|min|sum|kurtosis|mad|percentile|percentile_rank|skewness' +
    '|stddev_pop|sum_of_squares|var_pop|histogram|case|coalesce|greatest|ifnull|iif|isnull|least|nullif|nvl' +
    '|curdate|current_date|current_time|current_timestamp|curtime|dateadd|datediff|datepart|datetrunc|date_add' +
    '|date_diff|date_part|date_trunc|day|dayname|dayofmonth|dayofweek|dayofyear|day_name|day_of_month|day_of_week' +
    '|day_of_year|dom|dow|doy|hour|hour_of_day|idow|isodayofweek|isodow|isoweek|isoweekofyear|iso_day_of_week|iso_week_of_year' +
    '|iw|iwoy|minute|minute_of_day|minute_of_hour|month|monthname|month_name|month_of_year|now|quarter|second|second_of_minute' +
    '|timestampadd|timestampdiff|timestamp_add|timestamp_diff|today|week|week_of_year|year|abs|acos|asin|atan|atan2|cbrt' +
    '|ceil|ceiling|cos|cosh|cot|degrees|e|exp|expm1|floor|log|log10|mod|pi|power|radians|rand|random|round|sign|signum|sin' +
    '|sinh|sqrt|tan|truncate|ascii|bit_length|char|character_length|char_length|concat|insert|lcase|left|length|locate' +
    '|ltrim|octet_length|position|repeat|replace|right|rtrim|space|substring|ucase|cast|convert|database|user|st_astext|st_aswkt' +
    '|st_distance|st_geometrytype|st_geomfromtext|st_wkttosql|st_x|st_y|st_z|score',
  'true|false',
  'null|boolean|byte|short|integer|long|double|float|half_float|scaled_float|keyword|text|binary|date|ip|object|nested|time' +
    '|interval_year|interval_month|interval_day|interval_hour|interval_minute|interval_second|interval_year_to_month' +
    'inteval_day_to_hour|interval_day_to_minute|interval_day_to_second|interval_hour_to_minute|interval_hour_to_second' +
    'interval_minute_to_second|geo_point|geo_shape|shape',
];
const SQL_KEYWORDS = new Set(SQL_WORDS.join('|').toLowerCase().split('|'));
const sqlWord = (value: string) => (SQL_KEYWORDS.has(value.toLowerCase()) ? 'keyword' : 'identifier');

const sqlRules: Rule[] = [
  endTripleQuote,
  { token: 'comment', regex: '--.*$' },
  { token: 'comment.start', regex: '/\\*', next: 'sql-comment.start', push: true },
  { token: 'string', regex: '".*?"' },
  { token: 'constant', regex: "'.*?'" },
  { token: 'string', regex: '`.*?`' },
  { token: 'entity.name.function', regex: '[+-]?\\d+(?:(?:\\.\\d*)?(?:[eE][+-]?\\d+)?)?\\b' },
  { token: sqlWord, regex: '[a-zA-Z_$][a-zA-Z0-9_$]*\\b' },
  { token: 'keyword.operator', regex: '⇐|<⇒|\\*|\\.|\\:\\:|\\+|\\-|\\/|\\/\\/|%|&|\\^|~|<|>|<=|=>|==|!=|<>|=' },
  { token: 'paren.lparen', regex: '[\\(]' },
  { token: 'paren.rparen', regex: '[\\)]' },
  { token: 'text', regex: '\\s+' },
];

const embedded: Record<string, State> = {
  'script-start': { rules: scriptRules, defaultToken: 'text' },
  'sql-start': { rules: sqlRules, defaultToken: 'text' },
  'sql-comment.start': { rules: [endTripleQuote, { token: 'comment.end', regex: '\\*/', next: 'pop' }], defaultToken: 'comment' },
};

const plain = (rules: Record<string, Rule[]>): Record<string, State> =>
  Object.fromEntries(Object.entries(rules).map(([name, list]) => [name, { rules: list, defaultToken: 'text' }]));

const INPUT: Record<string, State> = {
  ...plain({
    start: [
      { token: 'warning', regex: '#!.*$' },
      { token: 'comment', regex: '^#.*$' },
      { token: 'paren.lparen', regex: '{', next: 'json', push: true },
      ...eol(['method'], '([a-zA-Z]+)', 'start', 'method_sep'),
      { token: 'whitespace', regex: '\\s+' },
      { token: 'text', regex: '.+?' },
    ],
    method_sep: [
      ...eol(['whitespace', 'url.protocol_host', 'url.slash'], '(\\s+)(https?:\\/\\/[^?\\/,]+)(\\/)', 'start', 'url'),
      ...eol(['whitespace', 'url.protocol_host'], '(\\s+)(https?:\\/\\/[^?\\/,]+)', 'start', 'url'),
      ...eol(['whitespace', 'url.slash'], '(\\s+)(\\/)', 'start', 'url'),
      ...eol(['whitespace'], '(\\s+)', 'start', 'url'),
    ],
    url: [
      ...eol(['url.part'], '(_sql)', 'start-sql', 'url-sql'),
      ...eol(['url.part'], '([^?\\/,\\s]+)', 'start'),
      ...eol(['url.comma'], '(,)', 'start'),
      ...eol(['url.slash'], '(\\/)', 'start'),
      ...eol(['url.questionmark'], '(\\?)', 'start', 'urlParams'),
    ],
    urlParams: [
      ...eol(['url.param', 'url.equal', 'url.value'], '([^&=]+)(=)([^&]*)', 'start'),
      ...eol(['url.param'], '([^&=]+)', 'start'),
      ...eol(['url.amp'], '(&)', 'start'),
    ],
    'url-sql': [
      ...eol(['url.part'], '([^?\\/,\\s]+)', 'start-sql'),
      ...eol(['url.comma'], '(,)', 'start-sql'),
      ...eol(['url.slash'], '(\\/)', 'start-sql'),
      ...eol(['url.questionmark'], '(\\?)', 'start-sql', 'urlParams-sql'),
    ],
    'urlParams-sql': [
      ...eol(['url.param', 'url.equal', 'url.value'], '([^&=]+)(=)([^&]*)', 'start-sql'),
      ...eol(['url.param'], '([^&=]+)', 'start-sql'),
      ...eol(['url.amp'], '(&)', 'start-sql'),
    ],
    ...jsonRules('json'),
  }),
  ...embedded,
};

const outputJson = jsonRules('start');
const OUTPUT: Record<string, State> = {
  ...plain({
    ...outputJson,
    start: [{ token: 'warning', regex: '#!.*$' }, { token: 'comment', regex: '#.*$' }, ...outputJson.start],
  }),
  ...embedded,
};

// --- The tokenizer -------------------------------------------------------------------------------

const withoutGroups = (regex: string) =>
  regex.replace(/\[(?:\\.|[^\\\]])*\]|\\.|\(\?[:=!<]|(\()/g, (all, group: string | undefined) => (group ? '(?:' : all));

interface Compiled {
  state: State;
  regex: RegExp;
  splitters: Array<RegExp | undefined>;
}

const compiled = new Map<Record<string, State>, Map<string, Compiled>>();

function compile(states: Record<string, State>, name: string): Compiled | undefined {
  let cache = compiled.get(states);
  if (!cache) {
    cache = new Map();
    compiled.set(states, cache);
  }
  const known = cache.get(name);
  if (known) return known;
  const state = states[name];
  if (!state) return undefined;
  const made: Compiled = {
    state,
    regex: new RegExp(`(${state.rules.map((rule) => withoutGroups(rule.regex)).join(')|(')})|($)`, 'g'),
    splitters: state.rules.map((rule) => (Array.isArray(rule.token) && rule.token.length > 1 ? new RegExp(`^${rule.regex}$`) : undefined)),
  };
  cache.set(name, made);
  return made;
}

function push(currentState: string, stack: string[], next: string): string {
  if (currentState !== 'start' || stack.length) stack.unshift(next, currentState);
  return next;
}

function pop(stack: string[]): string {
  stack.shift();
  return stack.shift() || 'start';
}

/** The tokens of one line, and the state it ends in: Ace's Tokenizer.getLineTokens */
export function lineTokens(states: Record<string, State>, line: string, startState: AceState): { tokens: AceToken[]; state: AceState } {
  let stack: string[] = [];
  let currentState: string;
  if (typeof startState !== 'string') {
    stack = startState.slice(0);
    currentState = stack[0] ?? 'start';
    if (currentState === '#tmp') {
      stack.shift();
      currentState = stack.shift() ?? 'start';
    }
  } else {
    currentState = startState || 'start';
  }
  let current = compile(states, currentState);
  if (!current) {
    currentState = 'start';
    current = compile(states, currentState);
  }
  if (!current) return { tokens: [{ type: 'text', value: line }], state: 'start' };
  let regex = current.regex;
  regex.lastIndex = 0;
  const tokens: AceToken[] = [];
  let token: AceToken = { type: '', value: '' };
  let lastIndex = 0;
  let attempts = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(line))) {
    let type: string | AceToken[] = current.state.defaultToken;
    let rule: Rule | undefined;
    const value = match[0];
    const index = regex.lastIndex;
    if (index - value.length > lastIndex) {
      const skipped = line.substring(lastIndex, index - value.length);
      if (token.type === type) token.value += skipped;
      else {
        if (token.type) tokens.push(token);
        token = { type, value: skipped };
      }
    }
    for (let group = 0; group < match.length - 2; group += 1) {
      if (match[group + 1] === undefined) continue;
      rule = current.state.rules[group];
      const splitter = current.splitters[group];
      if (splitter && Array.isArray(rule.token)) {
        const parts = splitter.exec(value);
        const names = rule.token;
        type = parts ? names.flatMap((name, at) => (parts[at + 1] ? [{ type: name, value: parts[at + 1] }] : [])) : 'text';
      } else if (typeof rule.token === 'function') type = rule.token(value);
      else type = Array.isArray(rule.token) ? rule.token[0] : rule.token;
      if (rule.next) {
        if (rule.next === 'pop') currentState = pop(stack);
        else currentState = rule.push ? push(currentState, stack, rule.next) : rule.next;
        current = compile(states, currentState);
        if (!current) {
          currentState = 'start';
          current = compile(states, currentState);
        }
        if (!current) break;
        lastIndex = index;
        regex = current.regex;
        regex.lastIndex = index;
      }
      break;
    }
    if (!current) break;
    if (value) {
      if (typeof type === 'string') {
        if ((!rule || rule.merge !== false) && token.type === type) token.value += value;
        else {
          if (token.type) tokens.push(token);
          token = { type, value };
        }
      } else {
        if (token.type) tokens.push(token);
        token = { type: '', value: '' };
        tokens.push(...type);
      }
    }
    if (lastIndex === line.length) break;
    lastIndex = index;
    attempts += 1;
    if (attempts > 2000 || (!value && regex.lastIndex === index && index < line.length && !rule?.next)) {
      // Ace stops a line that would never end the same way
      if (token.type) tokens.push(token);
      tokens.push({ type: 'overflow', value: line.substring(lastIndex) });
      return { tokens, state: 'start' };
    }
  }
  if (token.type) tokens.push(token);
  if (stack.length > 1 && stack[0] !== currentState) stack.unshift('#tmp', currentState);
  return { tokens, state: stack.length ? stack : currentState };
}

export interface Highlighted {
  lines: AceToken[][];
  /** The state each line ends in */
  states: AceState[];
}

export function highlight(text: string, mode: HighlightMode): Highlighted {
  const rows = text.split('\n');
  if (mode === 'text') {
    return { lines: rows.map((line) => (line ? [{ type: 'text', value: line }] : [])), states: rows.map(() => 'start') };
  }
  const states = mode === 'input' ? INPUT : OUTPUT;
  const lines: AceToken[][] = [];
  const ends: AceState[] = [];
  let state: AceState = 'start';
  for (const row of rows) {
    const result = lineTokens(states, row, state);
    lines.push(result.tokens);
    ends.push(result.state);
    state = result.state;
  }
  return { lines, states: ends };
}

/** The name of the state as the request parser reads it: the top of the stack */
export const stateName = (state: AceState | undefined): string =>
  state === undefined ? 'start' : typeof state === 'string' ? state : state[0] === '#tmp' ? state[1] ?? 'start' : state[0] ?? 'start';

// --- How a token is drawn ------------------------------------------------------------------------

/** Ace writes these as bare text, without an element of their own */
const BARE = new Set(['text', 'rparen', 'lparen']);

/** The classes of a token: one for each part of its kind, as Ace gives "ace_" ones */
export const tokenClasses = (type: string): string | undefined =>
  BARE.has(type) ? undefined : type.split('.').map((part) => `dvtTok-${part}`).join(' ');

/**
 * How many indent guides start a line, and what of the first token is left after them: Ace
 * draws one for each full tab stop of the indentation before the first character.
 */
export function indentGuides(value: string, tabSize: number): { guides: number; rest: string } {
  let columns = value.search(/\s\S| \t|\t |\s$/);
  if (columns <= 0) return { guides: 0, rest: value };
  if (value[0] === ' ') {
    columns -= columns % tabSize;
    return { guides: columns / tabSize, rest: value.slice(columns) };
  }
  if (value[0] === '\t') return { guides: columns, rest: value.slice(columns) };
  return { guides: 0, rest: value };
}

/** The folding mark of a line in the gutter: where a brace opens, where one closes */
export function foldWidget(line: string): 'start' | 'end' | '' {
  if (/^\s*(\/\*).*\*\/\s*$/.test(line) && !/^\s*(\/\*|\/\/)#?region\b/.test(line) && !/^\s*(\/\*\*\*).*\*\/\s*$/.test(line)) return '';
  if (/(\{|\[)[^\}\]]*$|^\s*(\/\*)/.test(line)) return 'start';
  if (/^[^\[\{]*(\}|\])|^[\s\*]*(\*\/)/.test(line)) return 'end';
  if (/^\s*(\/\*|\/\/)#?region\b/.test(line)) return 'start';
  return '';
}

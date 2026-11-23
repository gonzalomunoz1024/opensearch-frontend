/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The search syntax of the saved objects page and of its relationships table: the component
 * library's search bar query (EuiSearchBar's Query, its PEG grammar), read, printed and run as the
 * original reads, prints and runs it. Words, "phrases", `field:value`, `field:(a or b)`, `-` before
 * a clause, `is:flag` and groups in parentheses; a text it cannot read is refused with the
 * grammar's own words ("Expected ... but ... found.").
 */

export type Match = 'must' | 'must_not';
export type Operator = 'eq' | 'exact' | 'gt' | 'gte' | 'lt' | 'lte';
/** A date in quotes, `'2020-01-01'`, as the text it was written as */
export interface DateValue {
  date: string;
}
export type ClauseValue = string | number | boolean | DateValue;

export type Clause =
  | { type: 'term'; match: Match; value: string }
  | { type: 'field'; match: Match; operator: Operator; field: string; value: ClauseValue | ClauseValue[] }
  | { type: 'is'; match: Match; flag: string }
  | { type: 'group'; match: Match; value: Clause[] };

/** A text the grammar cannot read; the message is the one the original shows after "Unable to parse query." */
export class QueryParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QueryParseError';
  }
}

type Expectation =
  | { type: 'literal'; text: string }
  | { type: 'class'; parts: Array<string | [string, string]>; inverted: boolean }
  | { type: 'any' }
  | { type: 'end' }
  | { type: 'other'; description: string };

interface Expression {
  type: 'string' | 'number' | 'boolean' | 'date';
  expression: string;
}

const FAILED = Symbol('failed');
type Result<T> = T | typeof FAILED;

export const unescapeValue = (value: string) => value.replace(/\\([:\-\\()])/g, '$1');
export const escapeValue = (value: string) => value.replace(/([:\-\\()])/g, '\\$1');
const unescapePhraseValue = (value: string) => value.replace(/\\(.)/g, '$1');
const escapePhraseValue = (value: string) => value.replace(/([\\"])/g, '\\$1');
const escapeFieldValue = (value: string) => value.replace(/(\\)/g, '\\$1');

const hex = (char: string) => char.charCodeAt(0).toString(16).toUpperCase();
const escapeControls = (text: string) =>
  text
    .replace(/\0/g, '\\0')
    .replace(/\t/g, '\\t')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/[\x00-\x0F]/g, (char) => `\\x0${hex(char)}`)
    .replace(/[\x10-\x1F\x7F-\x9F]/g, (char) => `\\x${hex(char)}`);
const literalEscape = (text: string) => escapeControls(text.replace(/\\/g, '\\\\').replace(/"/g, '\\"'));
const classEscape = (text: string) =>
  escapeControls(text.replace(/\\/g, '\\\\').replace(/\]/g, '\\]').replace(/\^/g, '\\^').replace(/-/g, '\\-'));

function describeExpectation(expectation: Expectation): string {
  switch (expectation.type) {
    case 'literal':
      return `"${literalEscape(expectation.text)}"`;
    case 'class':
      return `[${expectation.inverted ? '^' : ''}${expectation.parts
        .map((part) => (Array.isArray(part) ? `${classEscape(part[0])}-${classEscape(part[1])}` : classEscape(part)))
        .join('')}]`;
    case 'any':
      return 'any character';
    case 'end':
      return 'end of input';
    case 'other':
      return expectation.description;
  }
}

/** The message of PEG.js 0.10: "Expected a, b, or c but "x" found." */
function syntaxMessage(expected: Expectation[], found: string | null): string {
  const descriptions = [...new Set(expected.map(describeExpectation))].sort();
  const list =
    descriptions.length === 1
      ? descriptions[0]
      : descriptions.length === 2
        ? `${descriptions[0]} or ${descriptions[1]}`
        : `${descriptions.slice(0, -1).join(', ')}, or ${descriptions[descriptions.length - 1]}`;
  return `Expected ${list} but ${found === null ? 'end of input' : `"${literalEscape(found)}"`} found.`;
}

const charClass = (parts: Array<string | [string, string]>, inverted = false): Expectation => ({
  type: 'class',
  parts,
  inverted,
});
const ANY: Expectation = { type: 'any' };

/** The value of a field clause as the grammar resolves it with no schema */
function resolveFieldValue(field: string, value: Expression | Expression[]): ClauseValue | ClauseValue[] {
  if (Array.isArray(value)) return value.map((item) => resolveFieldValue(field, item) as ClauseValue);
  switch (value.type) {
    case 'date':
      return { date: value.expression };
    case 'number': {
      const number = Number(value.expression);
      if (Number.isNaN(number)) throw new QueryParseError(`Invalid number \`${value.expression}\` set for field \`${field}\``);
      return number;
    }
    case 'boolean':
      return Boolean(value.expression.match(/true|yes|on/i));
    default:
      return value.expression;
  }
}

class Parser {
  private pos = 0;
  private maxFailPos = 0;
  private maxFailExpected: Expectation[] = [];
  private silent = 0;

  constructor(private readonly input: string) {}

  parse(): Clause[] {
    const result = this.query();
    if (result !== FAILED && this.pos === this.input.length) return result;
    if (result !== FAILED && this.pos < this.input.length) this.fail({ type: 'end' });
    const found = this.maxFailPos < this.input.length ? this.input.charAt(this.maxFailPos) : null;
    throw new QueryParseError(syntaxMessage(this.maxFailExpected, found));
  }

  private fail(expected: Expectation) {
    if (this.silent > 0 || this.pos < this.maxFailPos) return;
    if (this.pos > this.maxFailPos) {
      this.maxFailPos = this.pos;
      this.maxFailExpected = [];
    }
    this.maxFailExpected.push(expected);
  }

  private literal(text: string): boolean {
    if (this.input.startsWith(text, this.pos)) {
      this.pos += text.length;
      return true;
    }
    this.fail({ type: 'literal', text });
    return false;
  }

  private char(test: RegExp, expectation: Expectation): Result<string> {
    const char = this.input.charAt(this.pos);
    if (test.test(char)) {
      this.pos++;
      return char;
    }
    this.fail(expectation);
    return FAILED;
  }

  private named<T>(description: string, rule: () => Result<T>): Result<T> {
    this.silent++;
    const result = rule();
    this.silent--;
    if (result === FAILED) this.fail({ type: 'other', description });
    return result;
  }

  /** &rule: whether it matches here, without moving on and without expecting it */
  private ahead(rule: () => Result<unknown>): boolean {
    const start = this.pos;
    this.silent++;
    const result = rule();
    this.silent--;
    this.pos = start;
    return result !== FAILED;
  }

  /** !. : the end of the text */
  private atEnd(): boolean {
    this.silent++;
    const end = this.pos >= this.input.length;
    if (end) this.fail(ANY);
    this.silent--;
    return end;
  }

  // Query = Clauses / space?
  private query(): Result<Clause[]> {
    const clauses = this.clauses();
    if (clauses !== FAILED) return clauses;
    this.space();
    return [];
  }

  // Clauses = space? Clause (space Clause)* space?
  private clauses(): Result<Clause[]> {
    const start = this.pos;
    this.space();
    const head = this.clause();
    if (head === FAILED) {
      this.pos = start;
      return FAILED;
    }
    const clauses = [head];
    for (;;) {
      const at = this.pos;
      if (this.space() === FAILED) break;
      const next = this.clause();
      if (next === FAILED) {
        this.pos = at;
        break;
      }
      clauses.push(next);
    }
    this.space();
    return clauses;
  }

  // Clause = GroupClause / IsClause / FieldClause / TermClause
  private clause(): Result<Clause> {
    for (const rule of [() => this.groupClause(), () => this.isClause(), () => this.fieldClause(), () => this.termClause()]) {
      const clause = rule();
      if (clause !== FAILED) return clause;
    }
    return FAILED;
  }

  // SubGroupClause = "(" Clause (space? orWord space? Clause)* ")"
  private subGroupClause(): Result<Clause[]> {
    const start = this.pos;
    if (!this.literal('(')) return FAILED;
    const head = this.clause();
    if (head === FAILED) {
      this.pos = start;
      return FAILED;
    }
    const clauses = [head];
    for (;;) {
      const at = this.pos;
      this.space();
      if (this.orWord() === FAILED) {
        this.pos = at;
        break;
      }
      this.space();
      const next = this.clause();
      if (next === FAILED) {
        this.pos = at;
        break;
      }
      clauses.push(next);
    }
    if (!this.literal(')')) {
      this.pos = start;
      return FAILED;
    }
    return clauses;
  }

  /** `space? "-" rule / space? rule`, the two forms of every clause */
  private negatable<T>(rule: () => Result<T>, make: (match: Match, value: T) => Clause): Result<Clause> {
    const start = this.pos;
    this.space();
    if (this.literal('-')) {
      const value = rule();
      if (value !== FAILED) return make('must_not', value);
    }
    this.pos = start;
    this.space();
    const value = rule();
    if (value !== FAILED) return make('must', value);
    this.pos = start;
    return FAILED;
  }

  private groupClause(): Result<Clause> {
    return this.negatable(
      () => this.subGroupClause(),
      (match, value) => ({ type: 'group', match, value })
    );
  }

  private termClause(): Result<Clause> {
    return this.negatable(
      () => this.termValue(),
      (match, value) => ({ type: 'term', match, value })
    );
  }

  // IsClause = space? "-" IsFlag / space? IsFlag; IsFlag = "is:" flagName
  private isClause(): Result<Clause> {
    return this.negatable(
      () => {
        const start = this.pos;
        if (!this.literal('is:')) return FAILED;
        const flag = this.named('flag name', () => this.identifier());
        if (flag === FAILED) this.pos = start;
        return flag;
      },
      (match, flag) => ({ type: 'is', match, flag })
    );
  }

  // FieldClause "field" = the six comparisons, first after "-", then without
  private fieldClause(): Result<Clause> {
    return this.named('field', () => {
      const start = this.pos;
      const comparisons: Array<[Operator, string, () => Result<Expression | Expression[]>]> = [
        ['eq', ':', () => this.fieldContainsValue()],
        ['exact', '=', () => this.fieldContainsValue()],
        ['gt', '>', () => this.rangeValue()],
        ['gte', '>=', () => this.rangeValue()],
        ['lt', '<', () => this.rangeValue()],
        ['lte', '<=', () => this.rangeValue()],
      ];
      for (const negated of [true, false]) {
        for (const [operator, separator, value] of comparisons) {
          this.pos = start;
          this.space();
          if (negated && !this.literal('-')) continue;
          const field = this.named('field name', () => this.identifier());
          if (field === FAILED || !this.literal(separator)) continue;
          const expression = value();
          if (expression === FAILED) continue;
          return { type: 'field', match: negated ? 'must_not' : 'must', operator, field, value: resolveFieldValue(field, expression) };
        }
      }
      this.pos = start;
      return FAILED;
    });
  }

  // identifier = identifierChar+; identifierChar = alnum / [-_] / escapedChar
  private identifier(): Result<string> {
    const start = this.pos;
    while (this.alnum() !== FAILED || this.char(/^[\-_]/, charClass(['-', '_'])) !== FAILED || this.escapedChar() !== FAILED);
    if (this.pos === start) return FAILED;
    return unescapeValue(this.input.slice(start, this.pos));
  }

  // fieldContainsValue "field value" = containsOrValues / containsValue
  private fieldContainsValue(): Result<Expression | Expression[]> {
    return this.named<Expression | Expression[]>('field value', () => {
      const values = this.containsOrValues();
      return values !== FAILED ? values : this.containsValue();
    });
  }

  // termValue "term" = containsValue
  private termValue(): Result<string> {
    return this.named('term', () => {
      const value = this.containsValue();
      return value === FAILED ? FAILED : value.expression;
    });
  }

  // containsOrValues = "(" space? containsValue (space orWord space containsValue)* space? ")"
  private containsOrValues(): Result<Expression[]> {
    const start = this.pos;
    if (!this.literal('(')) return FAILED;
    this.space();
    const head = this.containsValue();
    if (head === FAILED) {
      this.pos = start;
      return FAILED;
    }
    const values = [head];
    for (;;) {
      const at = this.pos;
      if (this.space() === FAILED || this.orWord() === FAILED || this.space() === FAILED) {
        this.pos = at;
        break;
      }
      const next = this.containsValue();
      if (next === FAILED) {
        this.pos = at;
        break;
      }
      values.push(next);
    }
    this.space();
    if (!this.literal(')')) {
      this.pos = start;
      return FAILED;
    }
    return values;
  }

  // rangeValue = numberWord / date
  private rangeValue(): Result<Expression> {
    const number = this.numberWord();
    return number !== FAILED ? number : this.date();
  }

  // containsValue = numberWord / date / booleanWord / phrase / word
  private containsValue(): Result<Expression> {
    for (const rule of [() => this.numberWord(), () => this.date(), () => this.booleanWord(), () => this.phrase(), () => this.word()]) {
      const value = rule();
      if (value !== FAILED) return value;
    }
    return FAILED;
  }

  /** `rule &space / rule !.`: a number or a boolean that is a whole word */
  private wholeWord(rule: () => Result<Expression>): Result<Expression> {
    const start = this.pos;
    const first = rule();
    if (first !== FAILED && this.ahead(() => this.space())) return first;
    this.pos = start;
    const second = rule();
    if (second !== FAILED && this.atEnd()) return second;
    this.pos = start;
    return FAILED;
  }

  private numberWord(): Result<Expression> {
    return this.wholeWord(() => this.number());
  }

  private booleanWord(): Result<Expression> {
    return this.wholeWord(() => this.boolean());
  }

  // number = [-]? [0-9]+ ("." [0-9]+)*
  private number(): Result<Expression> {
    const start = this.pos;
    const digit = () => this.char(/^[0-9]/, charClass([['0', '9']]));
    this.char(/^[\-]/, charClass(['-']));
    if (digit() === FAILED) {
      this.pos = start;
      return FAILED;
    }
    while (digit() !== FAILED);
    for (;;) {
      const at = this.pos;
      if (!this.literal('.') || digit() === FAILED) {
        this.pos = at;
        break;
      }
      while (digit() !== FAILED);
    }
    return { type: 'number', expression: this.input.slice(start, this.pos) };
  }

  // boolean = true / false / yes / no / on / off, in any case
  private boolean(): Result<Expression> {
    for (const word of ['true', 'false', 'yes', 'no', 'on', 'off']) {
      const start = this.pos;
      let matched = true;
      for (const letter of word) {
        const upper = letter.toUpperCase();
        if (this.char(new RegExp(`^[${letter}${upper}]`), charClass([letter, upper])) === FAILED) {
          matched = false;
          break;
        }
      }
      if (matched) return { type: 'boolean', expression: this.input.slice(start, this.pos) };
      this.pos = start;
    }
    return FAILED;
  }

  // date = "'" (!"'" .)+ "'"
  private date(): Result<Expression> {
    const start = this.pos;
    if (!this.literal("'")) return FAILED;
    const inner = this.pos;
    for (;;) {
      if (this.ahead(() => (this.literal("'") ? true : FAILED))) break;
      if (this.pos >= this.input.length) {
        this.fail(ANY);
        break;
      }
      this.pos++;
    }
    if (this.pos === inner) {
      this.pos = start;
      return FAILED;
    }
    const expression = this.input.slice(inner, this.pos);
    if (!this.literal("'")) {
      this.pos = start;
      return FAILED;
    }
    return { type: 'date', expression };
  }

  // phrase = '"' space? (phraseWord+ (space phraseWord+)*)? space? '"'
  private phrase(): Result<Expression> {
    const start = this.pos;
    if (!this.literal('"')) return FAILED;
    this.space();
    const inner = this.pos;
    let end = this.pos;
    if (this.phraseWords()) {
      end = this.pos;
      for (;;) {
        const at = this.pos;
        if (this.space() === FAILED || !this.phraseWords()) {
          this.pos = at;
          break;
        }
        end = this.pos;
      }
    }
    const text = this.input.slice(inner, end);
    this.space();
    if (!this.literal('"')) {
      this.pos = start;
      return FAILED;
    }
    return { type: 'string', expression: unescapePhraseValue(text) };
  }

  /** phraseWord+, phraseWord = [^\\" ]+ / "\\" . */
  private phraseWords(): boolean {
    let count = 0;
    for (;;) {
      if (this.char(/^[^\\" ]/, charClass(['\\', '"', ' '], true)) !== FAILED) {
        while (this.char(/^[^\\" ]/, charClass(['\\', '"', ' '], true)) !== FAILED);
        count++;
        continue;
      }
      const at = this.pos;
      if (this.literal('\\')) {
        if (this.pos < this.input.length) {
          this.pos++;
          count++;
          continue;
        }
        this.fail(ANY);
        this.pos = at;
      }
      break;
    }
    return count > 0;
  }

  // word = wordChar+; wordChar = alnum / [-_*:/] / escapedChar / extendedGlyph
  private word(): Result<Expression> {
    const start = this.pos;
    while (
      this.alnum() !== FAILED ||
      this.char(/^[\-_*:\/]/, charClass(['-', '_', '*', ':', '/'])) !== FAILED ||
      this.escapedChar() !== FAILED ||
      this.char(/^[\xC0-\uFFFF]/, charClass([['\xC0', '\uFFFF']])) !== FAILED
    );
    if (this.pos === start) return FAILED;
    const text = this.input.slice(start, this.pos);
    if (text.toLowerCase() === 'or') {
      throw new QueryParseError(
        'To use OR in a text search, put it inside quotes: "or". To perform a logical OR, enclose the words in parenthesis: (foo:bar or bar).'
      );
    }
    return { type: 'string', expression: unescapeValue(text) };
  }

  // escapedChar = "\\" [-:\\()]
  private escapedChar(): Result<string> {
    const start = this.pos;
    if (!this.literal('\\')) return FAILED;
    const char = this.char(/^[\-:\\()]/, charClass(['-', ':', '\\', '(', ')']));
    if (char === FAILED) {
      this.pos = start;
      return FAILED;
    }
    return char;
  }

  // orWord = [oO][rR]
  private orWord(): Result<string> {
    const start = this.pos;
    if (this.char(/^[oO]/, charClass(['o', 'O'])) === FAILED) return FAILED;
    if (this.char(/^[rR]/, charClass(['r', 'R'])) === FAILED) {
      this.pos = start;
      return FAILED;
    }
    return 'or';
  }

  // alnum "alpha numeric" = [a-zA-Z0-9.]
  private alnum(): Result<string> {
    return this.named('alpha numeric', () => this.char(/^[a-zA-Z0-9.]/, charClass([['a', 'z'], ['A', 'Z'], ['0', '9'], '.'])));
  }

  // space "whitespace" = [ \t\n\r]+
  private space(): Result<string> {
    return this.named('whitespace', () => {
      const start = this.pos;
      while (this.char(/^[ \t\n\r]/, charClass([' ', '\t', '\n', '\r'])) !== FAILED);
      return this.pos === start ? FAILED : this.input.slice(start, this.pos);
    });
  }
}

/** The clauses of a search, or a QueryParseError */
export function parseSearchQuery(text: string): Clause[] {
  return new Parser(text).parse();
}

const isDate = (value: ClauseValue): value is DateValue => typeof value === 'object' && value !== null;

function printValue(value: ClauseValue, escape: (text: string) => string = escapeValue): string {
  if (isDate(value)) return `'${value.date}'`;
  if (typeof value !== 'string') return String(value);
  if (value.length === 0 || /\s/.test(value) || value.toLowerCase() === 'or') return `"${escapePhraseValue(value)}"`;
  return escape(value);
}

const OPERATORS: Record<Operator, string> = { eq: ':', exact: '=', gt: '>', gte: '>=', lt: '<', lte: '<=' };

/** One clause added to the text before it, as the library prints it (a group drops that text, as there) */
function printClause(clause: Clause, text: string): string {
  const prefix = clause.match === 'must' ? '' : '-';
  switch (clause.type) {
    case 'field': {
      const head = `${text} ${prefix}${escapeValue(clause.field)}${OPERATORS[clause.operator]}`;
      if (Array.isArray(clause.value)) return `${head}(${clause.value.map((value) => printValue(value, escapeFieldValue)).join(' or ')})`;
      return `${head}${printValue(clause.value, escapeFieldValue)}`;
    }
    case 'is':
      return `${text} ${prefix}is:${escapeValue(clause.flag)}`;
    case 'term':
      return `${text} ${prefix}${printValue(clause.value)}`;
    case 'group':
      return `(${clause.value.map((inner) => printClause(inner, text).trim()).join(' OR ')})`;
  }
}

/** The text of a query, as the search box shows it once a filter changed it */
export function printSearchQuery(clauses: Clause[]): string {
  return clauses.reduce((text, clause) => printClause(clause, text), '').trim();
}

/** What the original's parseQuery reads of a query: the words to search for, and the asked types */
export function readSearchQuery(clauses: Clause[]): { queryText?: string; visibleTypes?: ClauseValue | ClauseValue[] } {
  const terms = clauses.filter((clause): clause is Extract<Clause, { type: 'term' }> => clause.type === 'term');
  const typeClause = clauses.find((clause): clause is Extract<Clause, { type: 'field' }> => clause.type === 'field' && clause.field === 'type');
  return {
    queryText: terms.length ? terms.map((term) => term.value).join(' ') : undefined,
    visibleTypes: typeClause?.value,
  };
}

/**
 * The allowed values a query asks for, as the original filters them: with `includes` of what was
 * asked, which is a list's or, for `type:config` written by hand, a text's (a part of it is enough)
 */
export function filterQuery(allowed: string[], requested?: ClauseValue | ClauseValue[]): string[] {
  if (requested === undefined) return allowed;
  if (Array.isArray(requested)) return allowed.filter((value) => requested.includes(value));
  if (typeof requested === 'string') return allowed.filter((value) => requested.includes(value));
  throw new TypeError('requestedVals.includes is not a function');
}

type FieldClause = Extract<Clause, { type: 'field' }>;
const orClause = (clauses: Clause[], field: string, value?: string) =>
  clauses.find(
    (clause): clause is FieldClause =>
      clause.type === 'field' && clause.field === field && Array.isArray(clause.value) && (value === undefined || clause.value.includes(value))
  );

/** How a filter option shows: checked ('on'), crossed ('off', asked to be left out) or neither */
export function orFieldState(clauses: Clause[], field: string, value: string): 'on' | 'off' | undefined {
  const clause = orClause(clauses, field, value);
  if (!clause) return undefined;
  return clause.match === 'must' ? 'on' : 'off';
}

/** A filter option pressed: its value taken out of the field's `or` list, or added to it */
export function toggleOrFieldValue(clauses: Clause[], field: string, value: string): Clause[] {
  const existing = orClause(clauses, field, value);
  if (existing) {
    return clauses.flatMap((clause) => {
      if (clause !== existing) return [clause];
      const rest = (clause.value as ClauseValue[]).filter((item) => item !== value);
      return rest.length ? [{ ...clause, value: rest }] : [];
    });
  }
  const list = orClause(clauses, field);
  if (!list) return [...clauses, { type: 'field', match: 'must', operator: 'eq', field, value: [value] }];
  return clauses.map((clause) => (clause === list ? { ...list, value: [...(list.value as ClauseValue[]), value] } : clause));
}

// --- Running a query on a list, as the in-memory table does ---------------------------------------

const valueAt = (item: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((at, key) => (at !== null && typeof at === 'object' ? (at as Record<string, unknown>)[key] : undefined), item);

function equals(fieldValue: unknown, clauseValue: ClauseValue, exact = false): boolean {
  if (fieldValue === null || fieldValue === undefined) return false;
  if (typeof fieldValue === 'boolean') return clauseValue === fieldValue;
  if (Array.isArray(fieldValue)) return fieldValue.length ? fieldValue.some((item) => equals(item, clauseValue, exact)) : equals('', clauseValue, exact);
  const text = isDate(clauseValue) ? clauseValue.date : String(clauseValue);
  if (typeof fieldValue === 'string') {
    return exact ? fieldValue.toLowerCase() === text.toLowerCase() : fieldValue.toLowerCase().includes(text.toLowerCase());
  }
  if (typeof fieldValue === 'number') return fieldValue === Number(text);
  return false;
}

function compare(operator: Operator, fieldValue: unknown, clauseValue: ClauseValue): boolean {
  if (operator === 'eq' || operator === 'exact') return equals(fieldValue, clauseValue, operator === 'exact');
  const left = typeof fieldValue === 'number' ? fieldValue : Number(fieldValue);
  const right = isDate(clauseValue) ? Date.parse(clauseValue.date) : Number(clauseValue);
  if (Number.isNaN(left) || Number.isNaN(right)) return false;
  if (operator === 'gt') return left > right;
  if (operator === 'gte') return left >= right;
  if (operator === 'lt') return left < right;
  return left <= right;
}

function clauseMatches(item: Record<string, unknown>, clause: Clause, textFields: string[]): boolean {
  const must = clause.match === 'must';
  switch (clause.type) {
    case 'term': {
      const found = textFields.some((field) => equals(item[field], clause.value));
      return must ? found : !found;
    }
    case 'field': {
      const value = valueAt(item, clause.field);
      const test = (expected: ClauseValue) => (must ? compare(clause.operator, value, expected) : !compare(clause.operator, value, expected));
      return Array.isArray(clause.value) ? clause.value.some(test) : test(clause.value);
    }
    case 'is':
      return Boolean(valueAt(item, clause.flag)) === must;
    case 'group': {
      const any = clause.value.some((inner) => clauseMatches(item, inner, textFields));
      return must ? any : !any;
    }
  }
}

/** The items a query keeps: words in any text field of an item, and every field, is and group clause */
export function runSearchQuery<T extends object>(clauses: Clause[], items: T[]): T[] {
  return items.filter((item) => {
    const record = item as Record<string, unknown>;
    const textFields = Object.keys(record).filter((key) => typeof record[key] === 'string');
    return clauses.every((clause) => clauseMatches(record, clause, textFields));
  });
}

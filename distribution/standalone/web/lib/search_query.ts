/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The language of the search bar of the advanced settings page of OpenSearch Dashboards (its
 * library's search bar): words and "phrases", `-not`, `field:value` (also `=`, `>`, `>=`, `<`,
 * `<=` and `field:(a or b)`), `is:flag` and `(this or that)`.
 *
 * It is read as that bar's grammar reads it, rule by rule, so a text it cannot read gets the same
 * message ("Expected "(", "-", "is:", field, term, or whitespace but end of input found."); it is
 * printed back as the bar prints it when a filter button changes it; and it is run on items as
 * the bar runs it.
 */

export type Match = 'must' | 'must_not';
export type Operator = 'eq' | 'exact' | 'gt' | 'gte' | 'lt' | 'lte';

/** A value in single quotes, which the original reads as a date; no item here holds one */
export interface DateValue {
  type: 'date';
  text: string;
}
export type FieldValue = string | number | boolean | DateValue;

export type QueryClause =
  | { type: 'term'; match: Match; value: string }
  | { type: 'field'; match: Match; field: string; operator: Operator; value: FieldValue | FieldValue[] }
  | { type: 'is'; match: Match; flag: string }
  | { type: 'group'; match: Match; value: QueryClause[] };

export class QuerySyntaxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuerySyntaxError';
  }
}

// --- Reading ---------------------------------------------------------------------------------

interface Expression {
  type: 'string' | 'number' | 'boolean' | 'date';
  expression: string;
}

const FAILED: unique symbol = Symbol('failed');
type Result<T> = T | typeof FAILED;

const OR_MESSAGE =
  'To use OR in a text search, put it inside quotes: "or". To perform a logical OR, enclose the words in parenthesis: (foo:bar or bar).';

const unescapeValue = (value: string) => value.replace(/\\([:\-\\()])/g, '$1');
const unescapePhraseValue = (value: string) => value.replace(/\\(.)/g, '$1');

/** How the original's parser writes what it looked for: `"("`, `[oO]`, `whitespace` */
const literal = (text: string) => `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const characterClass = (chars: string) => `[${chars.replace(/[\\\]^-]/g, (char) => `\\${char}`)}]`;

function describeExpected(expected: string[]): string {
  const descriptions = [...new Set(expected)].sort();
  if (descriptions.length === 1) return descriptions[0];
  if (descriptions.length === 2) return `${descriptions[0]} or ${descriptions[1]}`;
  return `${descriptions.slice(0, -1).join(', ')}, or ${descriptions[descriptions.length - 1]}`;
}

function describeFound(found: string | undefined): string {
  if (found === undefined) return 'end of input';
  const escaped = found
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\t/g, '\\t')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
  return `"${escaped}"`;
}

class Parser {
  private pos = 0;
  private maxFailPos = 0;
  private expected: string[] = [];
  // Inside a rule with a name, what its parts looked for is not told, only the rule's name
  private silent = 0;

  constructor(private readonly input: string) {}

  parse(): QueryClause[] {
    const result = this.query();
    if (result !== FAILED && this.pos === this.input.length) return result;
    if (result !== FAILED && this.pos < this.input.length) this.fail('end of input');
    const found = this.maxFailPos < this.input.length ? this.input.charAt(this.maxFailPos) : undefined;
    throw new QuerySyntaxError(`Expected ${describeExpected(this.expected)} but ${describeFound(found)} found.`);
  }

  private fail(description: string) {
    if (this.silent > 0 || this.pos < this.maxFailPos) return;
    if (this.pos > this.maxFailPos) {
      this.maxFailPos = this.pos;
      this.expected = [];
    }
    this.expected.push(description);
  }

  /** A rule with a name: on failure only its name is what was expected, where it began */
  private named<T>(name: string, body: () => Result<T>): Result<T> {
    this.silent += 1;
    const result = body();
    this.silent -= 1;
    if (result === FAILED) this.fail(name);
    return result;
  }

  private text(start: number) {
    return this.input.slice(start, this.pos);
  }

  private char(test: RegExp, description: string): Result<string> {
    const char = this.input.charAt(this.pos);
    if (char !== '' && test.test(char)) {
      this.pos += 1;
      return char;
    }
    this.fail(description);
    return FAILED;
  }

  private word(text: string): Result<string> {
    if (this.input.startsWith(text, this.pos)) {
      this.pos += text.length;
      return text;
    }
    this.fail(literal(text));
    return FAILED;
  }

  private optional<T>(rule: () => Result<T>): T | null {
    const result = rule();
    return result === FAILED ? null : result;
  }

  /** One or more */
  private some(rule: () => Result<unknown>): boolean {
    if (rule() === FAILED) return false;
    while (rule() !== FAILED) {
      // keep reading
    }
    return true;
  }

  /** A sequence of steps: all or nothing, back where it began when one fails */
  private sequence<T>(body: () => Result<T>): Result<T> {
    const start = this.pos;
    const result = body();
    if (result === FAILED) this.pos = start;
    return result;
  }

  // Query = Clauses / space? { [] }
  private query(): Result<QueryClause[]> {
    const clauses = this.clauses();
    if (clauses !== FAILED) return clauses;
    this.optional(() => this.space());
    return [];
  }

  // Clauses = space? Clause (space Clause)* space?
  private clauses(): Result<QueryClause[]> {
    return this.sequence(() => {
      this.optional(() => this.space());
      const head = this.clause();
      if (head === FAILED) return FAILED;
      const all = [head];
      for (;;) {
        const next = this.sequence(() => (this.space() === FAILED ? FAILED : this.clause()));
        if (next === FAILED) break;
        all.push(next);
      }
      this.optional(() => this.space());
      return all;
    });
  }

  // Clause = GroupClause / IsClause / FieldClause / TermClause
  private clause(): Result<QueryClause> {
    for (const rule of [this.groupClause, this.isClause, this.fieldClause, this.termClause]) {
      const result = rule.call(this);
      if (result !== FAILED) return result;
    }
    return FAILED;
  }

  // SubGroupClause = '(' Clause (space? orWord space? Clause)* ')'
  private subGroupClause(): Result<QueryClause[]> {
    return this.sequence(() => {
      if (this.word('(') === FAILED) return FAILED;
      const head = this.clause();
      if (head === FAILED) return FAILED;
      const all = [head];
      for (;;) {
        const next = this.sequence(() => {
          this.optional(() => this.space());
          if (this.orWord() === FAILED) return FAILED;
          this.optional(() => this.space());
          return this.clause();
        });
        if (next === FAILED) break;
        all.push(next);
      }
      if (this.word(')') === FAILED) return FAILED;
      return all;
    });
  }

  /** `space? '-' rule` as `must_not`, else `space? rule` as `must` */
  private negatable<T>(rule: () => Result<T>, make: (value: T, match: Match) => QueryClause): Result<QueryClause> {
    const negative = this.sequence(() => {
      this.optional(() => this.space());
      if (this.word('-') === FAILED) return FAILED;
      const value = rule();
      return value === FAILED ? FAILED : make(value, 'must_not');
    });
    if (negative !== FAILED) return negative;
    return this.sequence(() => {
      this.optional(() => this.space());
      const value = rule();
      return value === FAILED ? FAILED : make(value, 'must');
    });
  }

  // GroupClause = space? '-' SubGroupClause / space? SubGroupClause
  private groupClause(): Result<QueryClause> {
    return this.negatable(
      () => this.subGroupClause(),
      (value, match) => ({ type: 'group', match, value })
    );
  }

  // TermClause = space? '-' termValue / space? termValue
  private termClause(): Result<QueryClause> {
    return this.negatable(
      () => this.termValue(),
      (value, match) => ({ type: 'term', match, value })
    );
  }

  // IsClause = space? '-' IsFlag / space? IsFlag
  private isClause(): Result<QueryClause> {
    return this.negatable(
      () => this.isFlag(),
      (flag, match) => ({ type: 'is', match, flag })
    );
  }

  // IsFlag = 'is:' flagName
  private isFlag(): Result<string> {
    return this.sequence(() => {
      if (this.word('is:') === FAILED) return FAILED;
      return this.named('flag name', () => this.identifier());
    });
  }

  // FieldClause "field" = space? '-' Field<op>Value (each operator) / space? Field<op>Value
  private fieldClause(): Result<QueryClause> {
    const operators: Array<[string, Operator, 'contains' | 'range']> = [
      [':', 'eq', 'contains'],
      ['=', 'exact', 'contains'],
      ['>', 'gt', 'range'],
      ['>=', 'gte', 'range'],
      ['<', 'lt', 'range'],
      ['<=', 'lte', 'range'],
    ];
    return this.named('field', () => {
      for (const match of ['must_not', 'must'] as const) {
        for (const [sign, operator, kind] of operators) {
          const clause = this.sequence<QueryClause>(() => {
            this.optional(() => this.space());
            if (match === 'must_not' && this.word('-') === FAILED) return FAILED;
            const field = this.named('field name', () => this.identifier());
            if (field === FAILED || this.word(sign) === FAILED) return FAILED;
            const value =
              kind === 'contains'
                ? this.named('field value', () => {
                    const values = this.containsOrValues();
                    return values !== FAILED ? values : this.containsValue();
                  })
                : this.rangeValue();
            if (value === FAILED) return FAILED;
            return { type: 'field', match, field, operator, value: resolveFieldValue(field, value) };
          });
          if (clause !== FAILED) return clause;
        }
      }
      return FAILED;
    });
  }

  // identifier = (alnum / [-_] / escapedChar)+
  private identifier(): Result<string> {
    const start = this.pos;
    const found = this.some(() => {
      const alnum = this.alnum();
      if (alnum !== FAILED) return alnum;
      const mark = this.char(/[-_]/, characterClass('-_'));
      return mark !== FAILED ? mark : this.escapedChar();
    });
    return found ? unescapeValue(this.text(start)) : FAILED;
  }

  // termValue "term" = containsValue
  private termValue(): Result<string> {
    return this.named('term', () => {
      const value = this.containsValue();
      return value === FAILED ? FAILED : value.expression;
    });
  }

  // containsOrValues = '(' space? containsValue (space orWord space containsValue)* space? ')'
  private containsOrValues(): Result<Expression[]> {
    return this.sequence(() => {
      if (this.word('(') === FAILED) return FAILED;
      this.optional(() => this.space());
      const head = this.containsValue();
      if (head === FAILED) return FAILED;
      const all = [head];
      for (;;) {
        const next = this.sequence(() => {
          if (this.space() === FAILED || this.orWord() === FAILED || this.space() === FAILED) return FAILED;
          return this.containsValue();
        });
        if (next === FAILED) break;
        all.push(next);
      }
      this.optional(() => this.space());
      if (this.word(')') === FAILED) return FAILED;
      return all;
    });
  }

  // rangeValue = numberWord / date
  private rangeValue(): Result<Expression> {
    const number = this.numberWord();
    return number !== FAILED ? number : this.date();
  }

  // containsValue = numberWord / date / booleanWord / phrase / word
  private containsValue(): Result<Expression> {
    for (const rule of [this.numberWord, this.date, this.booleanWord, this.phrase, this.plainWord]) {
      const result = rule.call(this);
      if (result !== FAILED) return result;
    }
    return FAILED;
  }

  // phrase = '"' space? (phraseWord+? (space phraseWord+)*) space? '"'
  private phrase(): Result<Expression> {
    return this.sequence(() => {
      if (this.word('"') === FAILED) return FAILED;
      this.optional(() => this.space());
      const start = this.pos;
      this.some(() => this.phraseWord());
      for (;;) {
        const more = this.sequence(() => (this.space() !== FAILED && this.some(() => this.phraseWord()) ? true : FAILED));
        if (more === FAILED) break;
      }
      const text = unescapePhraseValue(this.text(start));
      this.optional(() => this.space());
      if (this.word('"') === FAILED) return FAILED;
      return { type: 'string', expression: text };
    });
  }

  // phraseWord = [^\\" ]+ / '\\' .
  private phraseWord(): Result<string> {
    const start = this.pos;
    if (this.some(() => this.char(/[^\\" ]/, '[^\\\\" ]'))) return this.text(start);
    return this.sequence(() => {
      if (this.word('\\') === FAILED) return FAILED;
      if (this.pos >= this.input.length) {
        this.fail('any character');
        return FAILED;
      }
      this.pos += 1;
      return this.text(start);
    });
  }

  // word = wordChar+, where the word "or" alone is a mistake
  private plainWord(): Result<Expression> {
    const start = this.pos;
    const found = this.some(() => {
      const alnum = this.alnum();
      if (alnum !== FAILED) return alnum;
      const mark = this.char(/[-_*:/]/, characterClass('-_*:/'));
      if (mark !== FAILED) return mark;
      const escaped = this.escapedChar();
      return escaped !== FAILED ? escaped : this.char(/[À-￿]/, '[À-￿]');
    });
    if (!found) return FAILED;
    const text = this.text(start);
    if (text.toLowerCase() === 'or') throw new QuerySyntaxError(OR_MESSAGE);
    return { type: 'string', expression: unescapeValue(text) };
  }

  // escapedChar = '\\' [-:\\()]
  private escapedChar(): Result<string> {
    return this.sequence(() => {
      if (this.word('\\') === FAILED) return FAILED;
      return this.char(/[-:\\()]/, characterClass('-:\\()'));
    });
  }

  // orWord = [oO][rR]
  private orWord(): Result<string> {
    return this.sequence(() => {
      if (this.char(/[oO]/, '[oO]') === FAILED || this.char(/[rR]/, '[rR]') === FAILED) return FAILED;
      return 'or';
    });
  }

  /** What follows a number or a yes-no word: a space, or the end */
  private endsWord(): boolean {
    const start = this.pos;
    this.silent += 1;
    const spaced = this.space() !== FAILED;
    this.silent -= 1;
    this.pos = start;
    return spaced || this.pos >= this.input.length;
  }

  // booleanWord = boolean &space / boolean !.
  private booleanWord(): Result<Expression> {
    return this.sequence(() => {
      const start = this.pos;
      for (const spelling of ['true', 'false', 'yes', 'no', 'on', 'off']) {
        if (this.input.slice(start, start + spelling.length).toLowerCase() === spelling) {
          this.pos = start + spelling.length;
          if (this.endsWord()) return { type: 'boolean', expression: this.text(start) };
          this.pos = start;
          return FAILED;
        }
      }
      return FAILED;
    });
  }

  // numberWord = number &space / number !.  where number = '-'? [0-9]+ ('.' [0-9]+)*
  private numberWord(): Result<Expression> {
    return this.sequence(() => {
      const start = this.pos;
      const match = /^-?[0-9]+(\.[0-9]+)*/.exec(this.input.slice(start));
      if (!match) return FAILED;
      this.pos = start + match[0].length;
      return this.endsWord() ? { type: 'number', expression: match[0] } : FAILED;
    });
  }

  // date = "'" (!"'" .)+ "'"
  private date(): Result<Expression> {
    return this.sequence(() => {
      if (this.word("'") === FAILED) return FAILED;
      const end = this.input.indexOf("'", this.pos);
      if (end === -1 || end === this.pos) {
        this.pos = end === -1 ? this.input.length : this.pos;
        return FAILED;
      }
      const text = this.input.slice(this.pos, end);
      this.pos = end + 1;
      return { type: 'date', expression: text };
    });
  }

  // alnum "alpha numeric" = [a-zA-Z0-9.]
  private alnum(): Result<string> {
    return this.named('alpha numeric', () => this.char(/[a-zA-Z0-9.]/, characterClass('a-zA-Z0-9.')));
  }

  // space "whitespace" = [ \t\n\r]+
  private space(): Result<string> {
    return this.named('whitespace', () => {
      const start = this.pos;
      return this.some(() => this.char(/[ \t\n\r]/, '[ \\t\\n\\r]')) ? this.text(start) : FAILED;
    });
  }
}

/** A value after `field:` as the original keeps it: a number, a yes or no, or the text */
function resolveFieldValue(field: string, value: Expression | Expression[]): FieldValue | FieldValue[] {
  if (Array.isArray(value)) return value.map((item) => resolveFieldValue(field, item) as FieldValue);
  if (value.type === 'number') return Number(value.expression);
  // The original matches the word anywhere in it, so `lion` is a yes as well
  if (value.type === 'boolean') return /true|yes|on/i.test(value.expression);
  if (value.type === 'date') return { type: 'date', text: value.expression };
  return value.expression;
}

/** The clauses of a search; a text that is not one throws a `QuerySyntaxError` with its message */
export function parseQuery(text: string): QueryClause[] {
  return new Parser(text).parse();
}

// --- Printing ----------------------------------------------------------------------------------

const escapeValue = (value: string) => value.replace(/([:\-\\()])/g, '\\$1');
const escapePhraseValue = (value: string) => value.replace(/([\\"])/g, '\\$1');
const escapeFieldValue = (value: string) => value.replace(/(\\)/g, '\\$1');

const isDateValue = (value: unknown): value is DateValue =>
  typeof value === 'object' && value !== null && (value as DateValue).type === 'date';

function printValue(value: FieldValue, escape: (value: string) => string): string {
  if (isDateValue(value)) return `'${value.text}'`;
  if (typeof value !== 'string') return String(value);
  if (value.length === 0 || /\s/.test(value) || value.toLowerCase() === 'or') {
    return `"${escapePhraseValue(value)}"`;
  }
  return escape(value);
}

const OPERATOR_SIGNS: Record<Operator, string> = { eq: ':', exact: '=', gt: '>', gte: '>=', lt: '<', lte: '<=' };

function printClause(clause: QueryClause): string {
  const prefix = clause.match === 'must' ? '' : '-';
  switch (clause.type) {
    case 'field': {
      const sign = OPERATOR_SIGNS[clause.operator];
      const field = escapeValue(clause.field);
      if (Array.isArray(clause.value)) {
        return `${prefix}${field}${sign}(${clause.value.map((value) => printValue(value, escapeFieldValue)).join(' or ')})`;
      }
      return `${prefix}${field}${sign}${printValue(clause.value, escapeFieldValue)}`;
    }
    case 'is':
      return `${prefix}is:${escapeValue(clause.flag)}`;
    case 'term':
      return `${prefix}${printValue(clause.value, escapeValue)}`;
    case 'group':
      return `${prefix}(${clause.value.map(printClause).join(' OR ')})`;
  }
}

/**
 * The text of a search, as the bar writes it when a filter button has changed it. (The original
 * drops what comes before a group, and the `-` of a group; both are kept here.)
 */
export function printQuery(clauses: QueryClause[]): string {
  return clauses.map(printClause).join(' ');
}

// --- Filter buttons ------------------------------------------------------------------------------

type FieldClause = Extract<QueryClause, { type: 'field' }>;

const sameValue = (a: FieldValue, b: FieldValue) =>
  isDateValue(a) && isDateValue(b) ? a.text === b.text : a === b;

/** The clause `field:(a or b)` that holds a value, or any such clause of the field */
export function getOrFieldClause(clauses: QueryClause[], field: string, value?: FieldValue): FieldClause | undefined {
  return clauses.find(
    (clause): clause is FieldClause =>
      clause.type === 'field' &&
      clause.field === field &&
      Array.isArray(clause.value) &&
      (value === undefined || clause.value.some((item) => sameValue(item, value)))
  );
}

export function hasOrFieldClause(clauses: QueryClause[], field: string): boolean {
  return getOrFieldClause(clauses, field) !== undefined;
}

/** Adds a value to `field:(…)`, which is added at the end when there is none */
export function addOrFieldValue(clauses: QueryClause[], field: string, value: FieldValue): QueryClause[] {
  // Only a clause that keeps what it names takes the value; `-field:(…)` is left as it is
  const existing = clauses.find(
    (clause): clause is FieldClause =>
      clause.type === 'field' &&
      clause.field === field &&
      clause.match === 'must' &&
      clause.operator === 'eq' &&
      Array.isArray(clause.value)
  );
  if (!existing) return [...clauses, { type: 'field', match: 'must', field, operator: 'eq', value: [value] }];
  return clauses.map((clause) =>
    clause === existing ? { ...existing, value: [...(existing.value as FieldValue[]), value] } : clause
  );
}

/** Takes a value out of `field:(…)`, and the clause when it was the last */
export function removeOrFieldValue(clauses: QueryClause[], field: string, value: FieldValue): QueryClause[] {
  const existing = getOrFieldClause(clauses, field, value);
  if (!existing) return [...clauses];
  const out: QueryClause[] = [];
  for (const clause of clauses) {
    if (clause !== existing) {
      out.push(clause);
      continue;
    }
    const values = (existing.value as FieldValue[]).filter((item) => !sameValue(item, value));
    if (values.length > 0) out.push({ ...existing, value: values });
  }
  return out;
}

// --- Running -------------------------------------------------------------------------------------

type Item = Record<string, unknown>;

/**
 * What an item holds under a field's name, as the original's lodash `get`: the key of that very
 * name when the item has one (`machine.os`), else each part between the dots in turn, into
 * whatever is there (a text has a `length`, a list its places)
 */
function get(item: Item, path: string): unknown {
  if (path in item) return item[path];
  let value: unknown = item;
  for (const part of path.split('.')) {
    if (value === null || value === undefined) return undefined;
    value = (Object(value) as Item)[part];
  }
  return value;
}

const isNil = (value: unknown): value is null | undefined => value === null || value === undefined;

function eq(fieldValue: unknown, clauseValue: FieldValue, exact = false): boolean {
  if (isNil(fieldValue) || isNil(clauseValue)) return fieldValue === clauseValue;
  if (typeof fieldValue === 'boolean') return clauseValue === fieldValue;
  if (Array.isArray(fieldValue)) {
    return fieldValue.length > 0 ? fieldValue.some((item) => eq(item, clauseValue, exact)) : eq('', clauseValue, exact);
  }
  if (isDateValue(clauseValue)) return false;
  if (typeof fieldValue === 'string') {
    const have = fieldValue.toLowerCase();
    const want = String(clauseValue).toLowerCase();
    return exact ? have === want : have.includes(want);
  }
  if (typeof fieldValue === 'number') return fieldValue === Number(clauseValue);
  return false;
}

function greaterThan(fieldValue: unknown, clauseValue: FieldValue, inclusive: boolean): boolean {
  if (isDateValue(clauseValue)) return false;
  if (typeof fieldValue === 'string') {
    const wanted = String(clauseValue);
    return inclusive ? fieldValue >= wanted : fieldValue > wanted;
  }
  if (typeof fieldValue === 'number') {
    const wanted = Number(clauseValue);
    return inclusive ? fieldValue >= wanted : fieldValue > wanted;
  }
  if (Array.isArray(fieldValue)) return fieldValue.every((item) => greaterThan(item, clauseValue, inclusive));
  return false;
}

const OPERATORS: Record<Operator, (fieldValue: unknown, clauseValue: FieldValue) => boolean> = {
  eq: (fieldValue, clauseValue) => eq(fieldValue, clauseValue),
  exact: (fieldValue, clauseValue) => eq(fieldValue, clauseValue, true),
  gt: (fieldValue, clauseValue) =>
    isNil(fieldValue) || isNil(clauseValue) ? false : greaterThan(fieldValue, clauseValue, false),
  gte: (fieldValue, clauseValue) =>
    isNil(fieldValue) || isNil(clauseValue) ? fieldValue === clauseValue : greaterThan(fieldValue, clauseValue, true),
  lt: (fieldValue, clauseValue) =>
    isNil(fieldValue) || isNil(clauseValue) ? false : !greaterThan(fieldValue, clauseValue, true),
  lte: (fieldValue, clauseValue) =>
    isNil(fieldValue) || isNil(clauseValue) ? fieldValue === clauseValue : !greaterThan(fieldValue, clauseValue, false),
};

/** A word is looked for in every field of the item that holds text */
function termMatches(item: Item, clause: Extract<QueryClause, { type: 'term' }>): boolean {
  const found = Object.keys(item).some((key) => typeof item[key] === 'string' && eq(item[key], clause.value));
  return clause.match === 'must' ? found : !found;
}

function fieldMatches(item: Item, clause: FieldClause): boolean {
  const operator = OPERATORS[clause.operator];
  const test =
    clause.match === 'must'
      ? operator
      : (fieldValue: unknown, value: FieldValue) => !operator(fieldValue, value);
  const fieldValue = get(item, clause.field);
  return Array.isArray(clause.value)
    ? clause.value.some((value) => test(fieldValue, value))
    : test(fieldValue, clause.value);
}

function isMatches(item: Item, clause: Extract<QueryClause, { type: 'is' }>): boolean {
  return Boolean(get(item, clause.flag)) === (clause.match === 'must');
}

function clauseMatches(item: Item, clause: QueryClause): boolean {
  switch (clause.type) {
    case 'term':
      return termMatches(item, clause);
    case 'field':
      return fieldMatches(item, clause);
    case 'is':
      return isMatches(item, clause);
    case 'group': {
      const found = clause.value.some((inner) => clauseMatches(item, inner));
      return clause.match === 'must' ? found : !found;
    }
  }
}

/** The items a search keeps: every clause holds (of the `is:` clauses of a flag, the last) */
export function executeQuery<T extends object>(clauses: QueryClause[], items: T[]): T[] {
  const flags = new Map<string, QueryClause>();
  for (const clause of clauses) if (clause.type === 'is') flags.set(clause.flag, clause);
  const kept = clauses.filter((clause) => clause.type !== 'is' || flags.get(clause.flag) === clause);
  return items.filter((item) => kept.every((clause) => clauseMatches(item as Item, clause)));
}

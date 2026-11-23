/* SPDX-License-Identifier: Apache-2.0 */

/*
 * DQL, the query language of the search bar (`response:200 and extension:(php or css)`), read into
 * the tree OpenSearch Dashboards reads it into and turned into the OpenSearch query it sends.
 *
 * The reader is OpenSearch Dashboards' grammar (kuery.peg) rule for rule, run the way the parser
 * that Peggy generates from it runs: the same alternatives in the same order, and the same record
 * of what was expected at the furthest place reading got to, so that a mistake gets the same
 * message. A value is everything up to a special character or a keyword, spaces included:
 * `error warning` is one value. The functions that turn the tree into a query (is, range, nested,
 * and, or, not) are those of OpenSearch Dashboards, with their checks of nested and scripted fields.
 */

import type { Field, IndexPattern } from './types';

// --- The tree ------------------------------------------------------------------------------------

export type LiteralValue = string | number | boolean | null | bigint;
export interface LiteralNode {
  type: 'literal';
  value: LiteralValue;
}
/** A value with `*` in it, each `*` written as WILDCARD */
export interface WildcardNode {
  type: 'wildcard';
  value: string;
}
export interface NamedArgNode {
  type: 'namedArg';
  name: string;
  value: KueryNode;
}
export interface FunctionNode {
  type: 'function';
  function: 'is' | 'range' | 'nested' | 'and' | 'or' | 'not';
  arguments: KueryNode[];
}
export type KueryNode = LiteralNode | WildcardNode | NamedArgNode | FunctionNode;

export const WILDCARD = '@kuery-wildcard@';

const literalNode = (value: LiteralValue): LiteralNode => ({ type: 'literal', value });
const functionNode = (name: FunctionNode['function'], args: KueryNode[]): FunctionNode => ({
  type: 'function',
  function: name,
  arguments: args,
});
// A named argument holds a literal; anything else is put in one
const namedArgNode = (name: string, value: KueryNode): NamedArgNode => ({
  type: 'namedArg',
  name,
  value: value.type === 'literal' ? value : literalNode(value as unknown as LiteralValue),
});
const wildcardOnly = (): WildcardNode => ({ type: 'wildcard', value: WILDCARD });

export function hasLeadingWildcard(node: WildcardNode): boolean {
  return node.value.startsWith(WILDCARD) && node.value.replace(WILDCARD, '').length > 0;
}

// --- Errors ----------------------------------------------------------------------------------------

type Expectation =
  | { type: 'literal'; text: string }
  | { type: 'class' }
  | { type: 'any' }
  | { type: 'end' }
  | { type: 'other'; description: string };

/** What an action of the grammar reports with error(): a message and where its rule began */
class GrammarError extends Error {
  constructor(
    message: string,
    readonly offset: number
  ) {
    super(message);
    this.name = 'SyntaxError';
  }
}

const RULE_NAMES: Record<string, string> = {
  fieldName: 'field name',
  value: 'value',
  literal: 'literal',
  whitespace: 'whitespace',
};

/** A query that is not DQL: OpenSearch Dashboards' DQLSyntaxError, with the same message */
export class KuerySyntaxError extends Error {
  /** The message without the query and the mark under it */
  readonly shortMessage: string;

  constructor(
    message: string,
    expression: string,
    readonly position: number
  ) {
    super([message, expression, `${'-'.repeat(position)}^`].join('\n'));
    this.name = 'DQLSyntaxError';
    this.shortMessage = message;
  }
}

function expectedMessage(expected: Expectation[], found: string | null): string {
  const described = expected.map((expectation) => {
    if (expectation.type === 'end') return 'end of input';
    if (expectation.type === 'literal') return `"${expectation.text}"`;
    const description = expectation.type === 'other' ? expectation.description : undefined;
    return RULE_NAMES[description ?? ''] || description;
  });
  const unique = described.filter((text, index) => text && described.indexOf(text) === index);
  return `Expected ${unique.join(', ')} but ${found ? `"${found}"` : 'end of input'} found.`;
}

// --- The reader --------------------------------------------------------------------------------------

const FAILED = Symbol('failed');
type Failed = typeof FAILED;
/** What a value of `field:value` becomes once its field is known */
type ValuePartial = (field: KueryNode) => KueryNode;

const NUMBER = /^(-?[1-9]+\d*([.]\d+)?)$|^(-?0[.]\d*[1-9]+)$|^0$|^0.0$|^[.]\d{1,}$/;
const SPECIAL = /^[\\():<>"*{}]/;
const SPACE = /^[ \t\r\n]/;
const NOT_QUOTE = /^[^"]/;
const ESCAPED_IN_QUOTES = /^[\\"]/;
const LUCENE_SPECIAL = /^[!-"(-+\-/:<-?[-^{}-~]/;
const DIGIT = /^[0-9]/;
const NOT_SLASH = /^[^/]/;

interface ReadOptions {
  /** Reads the Lucene forms too, each of which then fails with its name (LuceneOr, LuceneRange …) */
  errorOnLuceneSyntax: boolean;
  allowLeadingWildcards: boolean;
}

class Reader {
  pos = 0;
  maxFailPos = 0;
  expected: Expectation[] = [];
  private savedPos = 0;
  private silent = 0;

  constructor(
    readonly input: string,
    private readonly options: ReadOptions
  ) {}

  // --- What Peggy's generated parser does at each step ---

  fail(expectation: Expectation) {
    if (this.silent > 0 || this.pos < this.maxFailPos) return;
    if (this.pos > this.maxFailPos) {
      this.maxFailPos = this.pos;
      this.expected = [];
    }
    this.expected.push(expectation);
  }

  private error(message: string): never {
    throw new GrammarError(message, this.savedPos);
  }

  private literal(text: string, ignoreCase = false): string | Failed {
    const slice = this.input.substr(this.pos, text.length);
    if (ignoreCase ? slice.toLowerCase() === text : slice === text) {
      this.pos += text.length;
      return slice;
    }
    this.fail({ type: 'literal', text });
    return FAILED;
  }

  private oneOf(pattern: RegExp): string | Failed {
    const char = this.input.charAt(this.pos);
    if (pattern.test(char)) {
      this.pos += 1;
      return char;
    }
    this.fail({ type: 'class' });
    return FAILED;
  }

  private anyChar(): string | Failed {
    if (this.pos < this.input.length) {
      const char = this.input.charAt(this.pos);
      this.pos += 1;
      return char;
    }
    this.fail({ type: 'any' });
    return FAILED;
  }

  /** The parts one after the other, or nothing and back to the start */
  private seq(...parts: Array<() => unknown>): unknown[] | Failed {
    const start = this.pos;
    const values: unknown[] = [];
    for (const part of parts) {
      const value = part();
      if (value === FAILED) {
        this.pos = start;
        return FAILED;
      }
      values.push(value);
    }
    return values;
  }

  private many<T>(rule: () => T | Failed): T[] {
    const values: T[] = [];
    for (let value = rule(); value !== FAILED; value = rule()) values.push(value);
    return values;
  }

  private atLeastOne<T>(rule: () => T | Failed): T[] | Failed {
    const values = this.many(rule);
    return values.length ? values : FAILED;
  }

  private optional<T>(rule: () => T | Failed): T | null {
    const value = rule();
    return value === FAILED ? null : value;
  }

  /** `!rule`: goes on only where the rule does not match, and reads nothing */
  private notAhead(rule: () => unknown): undefined | Failed {
    const start = this.pos;
    this.silent += 1;
    const value = rule();
    this.silent -= 1;
    if (value === FAILED) return undefined;
    this.pos = start;
    return FAILED;
  }

  /** A rule with a name: what fails inside it is reported by that name */
  private named<T>(description: string, rule: () => T | Failed): T | Failed {
    this.silent += 1;
    const value = rule();
    this.silent -= 1;
    if (value === FAILED) this.fail({ type: 'other', description });
    return value;
  }

  /** The alternatives in order: the first that matches */
  private choice<T>(...alternatives: Array<() => T | Failed>): T | Failed {
    for (const alternative of alternatives) {
      const value = alternative();
      if (value !== FAILED) return value;
    }
    return FAILED;
  }

  /** A sequence with an action: the action sees where the sequence began */
  private action<T>(parts: Array<() => unknown>, make: (values: unknown[]) => T): T | Failed {
    const start = this.pos;
    const values = this.seq(...parts);
    if (values === FAILED) return FAILED;
    this.savedPos = start;
    return make(values);
  }

  /** `&{ return parseCursor; } '@kuery-cursor@'`: the search bar reads no cursor, so never */
  private cursor(): Failed {
    this.savedPos = this.pos;
    return FAILED;
  }

  private luceneOn = () => {
    this.savedPos = this.pos;
    return this.options.errorOnLuceneSyntax ? undefined : FAILED;
  };

  private spaces = () => this.many(() => this.space());
  private someSpaces = () => this.atLeastOne(() => this.space());

  // --- The grammar ---

  start(): KueryNode | Failed {
    return this.action([this.spaces, () => this.optional(() => this.orQuery()), () => this.optionalSpace()], ([, query]) =>
      query !== null ? (query as KueryNode) : functionNode('is', [wildcardOnly(), wildcardOnly(), literalNode(false)])
    );
  }

  /** The rule a field name or a value alone is read with */
  literalRule(): KueryNode | Failed {
    return this.named('literal', () => this.choice(() => this.quotedString(), () => this.unquotedLiteral()));
  }

  private orQuery(): KueryNode | Failed {
    return this.choice<KueryNode>(
      () => this.seq(this.luceneOn, () => this.luceneQuery()) as unknown as KueryNode | Failed,
      () =>
        this.action([() => this.andQuery(), () => this.many(() => this.seq(() => this.or(), () => this.andQuery()))], ([head, tail]) =>
          combine('or', head as KueryNode, tail as unknown[][])
        )
    );
  }

  private andQuery(): KueryNode | Failed {
    return this.action([() => this.notQuery(), () => this.many(() => this.seq(() => this.and(), () => this.notQuery()))], ([head, tail]) =>
      combine('and', head as KueryNode, tail as unknown[][])
    );
  }

  private notQuery(): KueryNode | Failed {
    return this.choice<KueryNode>(
      () => this.action([() => this.not(), () => this.subQuery()], ([, query]) => functionNode('not', [query as KueryNode])),
      () => this.subQuery()
    );
  }

  private subQuery(): KueryNode | Failed {
    return this.choice<KueryNode>(
      () =>
        this.action(
          [() => this.literal('('), this.spaces, () => this.orQuery(), () => this.optionalSpace(), () => this.literal(')')],
          ([, , query]) => query as KueryNode
        ),
      () => this.nestedQuery()
    );
  }

  private nestedQuery(): KueryNode | Failed {
    return this.choice<KueryNode>(
      () =>
        this.action(
          [
            () => this.field(),
            this.spaces,
            () => this.literal(':'),
            this.spaces,
            () => this.literal('{'),
            this.spaces,
            () => this.orQuery(),
            () => this.optionalSpace(),
            () => this.literal('}'),
          ],
          ([field, , , , , , query]) => functionNode('nested', [field as KueryNode, query as KueryNode])
        ),
      () => this.expression()
    );
  }

  private expression(): KueryNode | Failed {
    return this.choice(
      () => this.fieldRangeExpression(),
      () => this.fieldValueExpression(),
      () => this.valueExpression()
    );
  }

  private field(): KueryNode | Failed {
    return this.named('fieldName', () => this.literalRule());
  }

  private fieldRangeExpression(): KueryNode | Failed {
    return this.action(
      [() => this.field(), this.spaces, () => this.rangeOperator(), this.spaces, () => this.literalRule()],
      ([field, , operator, , value]) =>
        functionNode('range', [field as KueryNode, namedArgNode(operator as string, value as KueryNode)])
    );
  }

  private fieldValueExpression(): KueryNode | Failed {
    return this.action(
      [() => this.field(), this.spaces, () => this.literal(':'), this.spaces, () => this.listOfValues()],
      ([field, , , , partial]) => (partial as ValuePartial)(field as KueryNode)
    );
  }

  private valueExpression(): KueryNode | Failed {
    return this.action([() => this.value()], ([partial]) => (partial as ValuePartial)(literalNode(null)));
  }

  private listOfValues(): ValuePartial | Failed {
    return this.choice<ValuePartial>(
      () =>
        this.action(
          [() => this.literal('('), this.spaces, () => this.orListOfValues(), () => this.optionalSpace(), () => this.literal(')')],
          ([, , partial]) => partial as ValuePartial
        ),
      () => this.value()
    );
  }

  private orListOfValues(): ValuePartial | Failed {
    return this.action(
      [() => this.andListOfValues(), () => this.many(() => this.seq(() => this.or(), () => this.andListOfValues()))],
      ([head, tail]) => combinePartials('or', head as ValuePartial, tail as unknown[][])
    );
  }

  private andListOfValues(): ValuePartial | Failed {
    return this.action(
      [() => this.notListOfValues(), () => this.many(() => this.seq(() => this.and(), () => this.notListOfValues()))],
      ([head, tail]) => combinePartials('and', head as ValuePartial, tail as unknown[][])
    );
  }

  private notListOfValues(): ValuePartial | Failed {
    return this.choice<ValuePartial>(
      () =>
        this.action([() => this.not(), () => this.listOfValues()], ([, partial]) => {
          const inner = partial as ValuePartial;
          return (field: KueryNode) => functionNode('not', [inner(field)]);
        }),
      () => this.listOfValues()
    );
  }

  private value(): ValuePartial | Failed {
    return this.named('value', () =>
      this.choice<ValuePartial>(
        () =>
          this.action([() => this.quotedString()], ([value]) => (field: KueryNode) =>
            functionNode('is', [field, value as KueryNode, literalNode(true)])
          ),
        () =>
          this.action([() => this.unquotedLiteral()], ([value]) => {
            const node = value as KueryNode;
            if (!this.options.allowLeadingWildcards && node.type === 'wildcard' && hasLeadingWildcard(node)) {
              this.error('Leading wildcards are disabled. See query:allowLeadingWildcards in Advanced Settings.');
            }
            return (field: KueryNode) => functionNode('is', [field, node, literalNode(false)]);
          })
      )
    );
  }

  private or(): unknown | Failed {
    return this.named('OR', () =>
      this.choice(
        () => this.seq(this.someSpaces, () => this.literal('or', true), this.someSpaces),
        () => this.seq(this.luceneOn, () => this.luceneOr())
      )
    );
  }

  private and(): unknown | Failed {
    return this.named('AND', () =>
      this.choice(
        () => this.seq(this.someSpaces, () => this.literal('and', true), this.someSpaces),
        () => this.seq(this.luceneOn, () => this.luceneAnd())
      )
    );
  }

  private not(): unknown | Failed {
    return this.named('NOT', () =>
      this.choice(
        () => this.seq(() => this.literal('not', true), this.someSpaces),
        () => this.seq(this.luceneOn, () => this.luceneNot())
      )
    );
  }

  private quotedString(): KueryNode | Failed {
    return this.choice<KueryNode>(
      () =>
        this.seq(
          () => this.literal('"'),
          () => this.many(() => this.quotedCharacter()),
          () => this.cursor(),
          () => this.many(() => this.quotedCharacter()),
          () => this.literal('"')
        ) as unknown as Failed,
      () =>
        this.action([() => this.literal('"'), () => this.many(() => this.quotedCharacter()), () => this.literal('"')], ([, chars]) =>
          literalNode((chars as string[]).join(''))
        )
    );
  }

  private quotedCharacter(): string | Failed {
    return this.choice<string>(
      () => this.escapedWhitespace(),
      () => this.action([() => this.literal('\\'), () => this.oneOf(ESCAPED_IN_QUOTES)], ([, char]) => char as string),
      () => this.action([() => this.notAhead(() => this.cursor()), () => this.oneOf(NOT_QUOTE)], ([, char]) => char as string)
    );
  }

  private unquotedLiteral(): KueryNode | Failed {
    return this.choice<KueryNode>(
      () =>
        this.seq(
          () => this.many(() => this.unquotedCharacter()),
          () => this.cursor(),
          () => this.many(() => this.unquotedCharacter())
        ) as unknown as Failed,
      () => this.action([() => this.atLeastOne(() => this.unquotedCharacter())], ([chars]) => unquotedValue(chars as string[]))
    );
  }

  private unquotedCharacter(): string | Failed {
    return this.choice<string>(
      () => this.escapedWhitespace(),
      () => this.escapedSpecialCharacter(),
      () => this.escapedKeyword(),
      () => this.wildcard(),
      () =>
        this.action(
          [
            () => this.notAhead(() => this.oneOf(SPECIAL)),
            () => this.notAhead(() => this.keyword()),
            () => this.notAhead(() => this.cursor()),
            () => this.anyChar(),
          ],
          ([, , , char]) => char as string
        )
    );
  }

  private wildcard(): string | Failed {
    return this.action([() => this.literal('*')], () => WILDCARD);
  }

  private optionalSpace(): unknown[] | Failed {
    return this.choice<unknown[]>(
      () => this.seq(this.spaces, () => this.cursor(), this.spaces) as unknown as Failed,
      this.spaces
    );
  }

  private escapedWhitespace(): string | Failed {
    return this.choice<string>(
      () => this.action([() => this.literal('\\t')], () => '\t'),
      () => this.action([() => this.literal('\\r')], () => '\r'),
      () => this.action([() => this.literal('\\n')], () => '\n')
    );
  }

  private escapedSpecialCharacter(): string | Failed {
    return this.action([() => this.literal('\\'), () => this.oneOf(SPECIAL)], ([, char]) => char as string);
  }

  private escapedKeyword(): string | Failed {
    return this.action(
      [
        () => this.literal('\\'),
        () => this.choice(() => this.literal('or', true), () => this.literal('and', true), () => this.literal('not', true)),
      ],
      ([, keyword]) => keyword as string
    );
  }

  private keyword(): unknown | Failed {
    return this.choice(
      () => this.or(),
      () => this.and(),
      () => this.not()
    );
  }

  private rangeOperator(): string | Failed {
    return this.choice<string>(
      () => this.action([() => this.literal('<=')], () => 'lte'),
      () => this.action([() => this.literal('>=')], () => 'gte'),
      () => this.action([() => this.literal('<')], () => 'lt'),
      () => this.action([() => this.literal('>')], () => 'gt')
    );
  }

  private space(): string | Failed {
    return this.named('whitespace', () => this.oneOf(SPACE));
  }

  // --- The Lucene forms, read only to warn that the query looks like Lucene ---

  private luceneOr(): never | Failed {
    return this.action([this.spaces, () => this.literal('||'), this.spaces], () => this.error('LuceneOr'));
  }

  private luceneAnd(): never | Failed {
    return this.choice(
      () => this.action([this.spaces, () => this.literal('&&'), this.spaces], () => this.error('LuceneAnd')),
      () => this.action([() => this.literal('+')], () => this.error('LuceneAnd'))
    );
  }

  private luceneNot(): never | Failed {
    return this.choice(
      () => this.action([() => this.literal('-')], () => this.error('LuceneNot')),
      () => this.action([() => this.literal('!')], () => this.error('LuceneNot'))
    );
  }

  private luceneQuery(): unknown | Failed {
    return this.choice(
      () => this.luceneFieldQuery(),
      () => this.luceneValue(),
      () => this.luceneExists()
    );
  }

  private luceneFieldQuery(): unknown | Failed {
    return this.seq(() => this.luceneLiteral(), this.spaces, () => this.literal(':'), this.spaces, () => this.luceneValue());
  }

  private luceneValue(): unknown | Failed {
    return this.choice(
      () => this.luceneRange(),
      () => this.luceneWildcard(),
      () => this.luceneRegex(),
      () => this.luceneFuzzy(),
      () => this.luceneProximity(),
      () => this.luceneBoost()
    );
  }

  private luceneExists(): never | Failed {
    return this.action(
      [() => this.literal('_exists_'), this.spaces, () => this.literal(':'), this.spaces, () => this.luceneLiteral()],
      () => this.error('LuceneExists')
    );
  }

  private luceneRange(): never | Failed {
    return this.choice(
      () => this.action([() => this.rangeOperator(), this.spaces, () => this.luceneLiteral()], () => this.error('LuceneRange')),
      () =>
        this.action(
          [
            () => this.oneOf(/^[[{]/),
            this.spaces,
            () => this.luceneLiteral(),
            () => this.luceneTo(),
            () => this.luceneLiteral(),
            () => this.oneOf(/^[\]}]/),
          ],
          () => this.error('LuceneRange')
        )
    );
  }

  private luceneWildcard(): never | Failed {
    return this.action(
      [
        () => this.many(() => this.choice(() => this.luceneUnquotedCharacter(), () => this.literal('*'))),
        () => this.literal('?'),
        () => this.many(() => this.luceneWildcard()),
      ],
      () => this.error('LuceneWildcard')
    );
  }

  private luceneRegex(): never | Failed {
    return this.action([() => this.literal('/'), () => this.many(() => this.oneOf(NOT_SLASH)), () => this.literal('/')], () =>
      this.error('LuceneRegex')
    );
  }

  private luceneFuzzy(): never | Failed {
    return this.action([() => this.luceneUnquotedLiteral(), () => this.literal('~'), () => this.many(() => this.oneOf(DIGIT))], () =>
      this.error('LuceneFuzzy')
    );
  }

  private luceneProximity(): never | Failed {
    return this.action([() => this.quotedString(), () => this.literal('~'), () => this.many(() => this.oneOf(DIGIT))], () =>
      this.error('LuceneProximity')
    );
  }

  private luceneBoost(): never | Failed {
    return this.action([() => this.luceneLiteral(), () => this.literal('^'), () => this.many(() => this.oneOf(DIGIT))], () =>
      this.error('LuceneBoost')
    );
  }

  private luceneLiteral(): unknown | Failed {
    return this.choice(
      () => this.quotedString(),
      () => this.luceneUnquotedLiteral()
    );
  }

  private luceneUnquotedLiteral(): unknown | Failed {
    return this.atLeastOne(() => this.luceneUnquotedCharacter());
  }

  private luceneUnquotedCharacter(): unknown | Failed {
    return this.choice<unknown>(
      () => this.escapedWhitespace(),
      () => this.escapedLuceneSpecialCharacter(),
      () =>
        this.seq(
          () => this.notAhead(() => this.oneOf(LUCENE_SPECIAL)),
          () => this.notAhead(() => this.luceneKeyword()),
          () => this.anyChar()
        )
    );
  }

  private luceneKeyword(): unknown | Failed {
    return this.choice(
      () => this.or(),
      () => this.and(),
      () => this.luceneOr(),
      () => this.luceneAnd(),
      () => this.luceneNot(),
      () => this.luceneTo()
    );
  }

  // The action of this rule in OpenSearch Dashboards' grammar names a variable it does not have
  private escapedLuceneSpecialCharacter(): never | Failed {
    return this.action([() => this.literal('\\'), () => this.oneOf(LUCENE_SPECIAL)], () => {
      throw new ReferenceError('char is not defined');
    });
  }

  private luceneTo(): unknown | Failed {
    return this.seq(this.someSpaces, () => this.literal('TO'), this.someSpaces);
  }
}

function combine(name: 'and' | 'or', head: KueryNode, tail: unknown[][]): KueryNode {
  if (tail.length === 0) return head;
  return functionNode(name, [head, ...tail.map(([, node]) => node as KueryNode)]);
}

function combinePartials(name: 'and' | 'or', head: ValuePartial, tail: unknown[][]): ValuePartial {
  if (tail.length === 0) return head;
  const partials = [head, ...tail.map(([, partial]) => partial as ValuePartial)];
  return (field) => functionNode(name, partials.map((partial) => partial(field)));
}

// An unquoted value: true, false and null, a wildcard, a number, or the text without its spaces
function unquotedValue(chars: string[]): KueryNode {
  const sequence = chars.join('').trim();
  if (sequence === 'null') return literalNode(null);
  if (sequence === 'true') return literalNode(true);
  if (sequence === 'false') return literalNode(false);
  if (chars.includes(WILDCARD)) return { type: 'wildcard', value: sequence };
  if (!NUMBER.test(sequence)) return literalNode(sequence);
  const number = Number(sequence);
  return literalNode(
    Number.isFinite(number) && (number > Number.MAX_SAFE_INTEGER || number < Number.MIN_SAFE_INTEGER)
      ? BigInt(sequence)
      : number
  );
}

function read(text: string, options: ReadOptions, rule: 'start' | 'literal' = 'start'): KueryNode {
  const reader = new Reader(text, options);
  let result: KueryNode | Failed;
  try {
    result = rule === 'start' ? reader.start() : reader.literalRule();
  } catch (error) {
    if (error instanceof GrammarError) throw new KuerySyntaxError(error.message, text, error.offset);
    // BigInt() refusing a long decimal number: the original fails on that error's missing place
    if ((error as Error).name === 'SyntaxError') {
      throw new TypeError("Cannot read properties of undefined (reading 'start')");
    }
    throw error;
  }
  if (result !== FAILED && reader.pos === text.length) return result;
  if (result !== FAILED && reader.pos < text.length) reader.fail({ type: 'end' });
  const found = reader.maxFailPos < text.length ? text.charAt(reader.maxFailPos) : null;
  throw new KuerySyntaxError(expectedMessage(reader.expected, found), text, reader.maxFailPos);
}

export interface KueryParseOptions {
  /** query:allowLeadingWildcards: when false, `*ing` is refused */
  allowLeadingWildcards?: boolean;
}

export function parseKuery(text: string, options: KueryParseOptions = {}): KueryNode {
  return read(text ?? '', { errorOnLuceneSyntax: false, allowLeadingWildcards: options.allowLeadingWildcards ?? true });
}

/** Whether a DQL query looks like Lucene, so that the search bar warns of it */
export function hasLuceneSyntax(text: string): boolean {
  try {
    read(text, { errorOnLuceneSyntax: true, allowLeadingWildcards: true });
    return false;
  } catch (error) {
    return (error as Error).message.startsWith('Lucene');
  }
}

// --- The OpenSearch query ------------------------------------------------------------------------------

type Dsl = Record<string, unknown>;

export interface KueryOptions {
  /** dateFormat:tz: sent with date values so that "2026-01-01" means that day where the reader is */
  dateFormatTZ?: string;
}

interface Context {
  nested?: { path: string };
}

type QueryField = Pick<Field, 'name' | 'type'> & Partial<Pick<Field, 'scripted' | 'script' | 'lang' | 'subType'>>;

// How a value is written into a query_string query, as OpenSearch Dashboards escapes it (its range
// `+-=` escapes the digits, `,`, `.`, `/`, `:`, `;` and `<` too, which query_string reads the same)
const escapeQueryString = (text: string) => text.replace(/[+-=&|><!(){}[\]^"~*?:\\/]/g, '\\$&');
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const wildcardText = (node: WildcardNode) => node.value.split(WILDCARD).join('*');
const wildcardQueryString = (node: WildcardNode) => node.value.split(WILDCARD).map(escapeQueryString).join('*');
const wildcardTest = (node: WildcardNode, text: string) =>
  new RegExp(`^${node.value.split(WILDCARD).map(escapeRegExp).join('[\\s\\S]*')}$`).test(text);

/** The zone a query names, as the original's getTimeZoneFromSettings: the browser's own for "Browser" */
export function timeZone(dateFormatTZ: string): string {
  return dateFormatTZ === 'Browser' ? Intl.DateTimeFormat().resolvedOptions().timeZone : dateFormatTZ;
}

function getFields(node: KueryNode, indexPattern?: IndexPattern): QueryField[] {
  if (!indexPattern) return [];
  if (node.type === 'literal') {
    const field = indexPattern.fields.find((candidate) => candidate.name === node.value);
    return field ? [field] : [];
  }
  if (node.type === 'wildcard') return indexPattern.fields.filter((candidate) => wildcardTest(node, candidate.name));
  return [];
}

// The field named inside `path:{ … }` carries the path, and a nested field must be asked that way
function fullFieldNameNode(root: KueryNode, indexPattern: IndexPattern | undefined, nestedPath?: string): KueryNode {
  const rootValue = (root as LiteralNode | WildcardNode).value;
  const node = { ...root, value: nestedPath ? `${nestedPath}.${String(rootValue)}` : rootValue } as KueryNode;
  if (!indexPattern || (node.type === 'wildcard' && !nestedPath)) return node;
  const errors: string[] = [];
  for (const field of getFields(node, indexPattern)) {
    const fieldPath = field.subType?.nested ? field.subType.nested.path : undefined;
    if (nestedPath && !fieldPath) {
      errors.push(`${field.name} is not a nested field but is in nested group "${nestedPath}" in the DQL expression.`);
    } else if (fieldPath && !nestedPath) {
      errors.push(`${field.name} is a nested field, but is not in a nested group in the DQL expression.`);
    } else if (fieldPath !== nestedPath) {
      errors.push(
        `Nested field ${field.name} is being queried with the incorrect nested path. The correct path is ${fieldPath}.`
      );
    }
  }
  if (errors.length > 0) throw new Error(errors.join('\n'));
  return node;
}

/** A value as a query on a scripted field gets it: a boolean field takes true, false, 1 and 0 */
function convertedValue(field: QueryField, value: unknown): unknown {
  if (typeof value !== 'boolean' && field.type === 'boolean') {
    if (value === 1 || value === 'true') return true;
    if (value === 0 || value === 'false') return false;
    throw new Error(`${String(value)} is not a valid boolean value for boolean field ${field.name}`);
  }
  return value;
}

/** The script that compares a scripted field with a value, as OpenSearch Dashboards writes it */
export function phraseScript(field: QueryField, value: unknown): Dsl {
  const source =
    field.lang === 'painless'
      ? `boolean compare(Supplier s, def v) {return s.get() == v;}compare(() -> { ${field.script} }, params.value);`
      : `(${field.script}) == value`;
  return { script: { source, lang: field.lang, params: { value: convertedValue(field, value) } } };
}

const OPERATORS: Record<string, string> = { gt: '>', gte: '>=', lte: '<=', lt: '<' };
const COMPARATORS: Record<string, string> = {
  gt: 'boolean gt(Supplier s, def v) {return s.get() > v}',
  gte: 'boolean gte(Supplier s, def v) {return s.get() >= v}',
  lte: 'boolean lte(Supplier s, def v) {return s.get() <= v}',
  lt: 'boolean lt(Supplier s, def v) {return s.get() < v}',
};
const DATE_COMPARATORS: Record<string, string> = {
  gt: 'boolean gt(Supplier s, def v) {return s.get().toInstant().isAfter(Instant.parse(v))}',
  gte: 'boolean gte(Supplier s, def v) {return !s.get().toInstant().isBefore(Instant.parse(v))}',
  lte: 'boolean lte(Supplier s, def v) {return !s.get().toInstant().isAfter(Instant.parse(v))}',
  lt: 'boolean lt(Supplier s, def v) {return s.get().toInstant().isBefore(Instant.parse(v))}',
};

/** The script that compares a scripted field with the ends of a range */
export function rangeScript(field: QueryField, params: Record<string, unknown>): Dsl {
  const known = Object.keys(params).filter((key) => key in OPERATORS);
  let source = known.map((key) => `(${field.script})${OPERATORS[key]}${key}`).join(' && ');
  if (field.lang === 'painless') {
    const comparators = field.type === 'date' ? DATE_COMPARATORS : COMPARATORS;
    const definitions = known.map((key) => comparators[key]).join(' ');
    const comparisons = known.map((key) => `${key}(() -> { ${field.script} }, params.${key})`).join(' && ');
    source = `${definitions}${comparisons}`;
  }
  const knownParams: Record<string, unknown> = {};
  for (const key of known) knownParams[key] = params[key];
  return { script: { source, params: knownParams, lang: field.lang } };
}

// What a value node stands for in a query: a literal its value, a wildcard its text with `*`
function valueOf(node: KueryNode | undefined): unknown {
  if (!node) return undefined;
  if (node.type === 'literal') return node.value;
  if (node.type === 'wildcard') return wildcardText(node);
  if (node.type === 'namedArg') return valueOf(node.value);
  return kueryToDsl(node);
}

// Wildcards in a field name can match nested and plain fields: the nested ones are asked in a nested query
function wrapper(fieldNode: KueryNode, field: QueryField, context: Context) {
  return (query: Dsl): Dsl =>
    fieldNode.type !== 'wildcard' || !field.subType?.nested || context.nested
      ? query
      : { nested: { path: field.subType.nested.path, query, score_mode: 'none' } };
}

function isQuery(node: FunctionNode, indexPattern: IndexPattern | undefined, config: KueryOptions, context: Context): Dsl {
  const [fieldNameArg, valueArg, isPhraseArg] = node.arguments;
  const fieldNode = fullFieldNameNode(fieldNameArg, indexPattern, context.nested?.path);
  const fieldName = valueOf(fieldNode);
  const value = valueOf(valueArg);
  const type = (isPhraseArg as LiteralNode).value ? 'phrase' : 'best_fields';

  if ((fieldNode as LiteralNode).value === null) {
    if (valueArg.type === 'wildcard') return { query_string: { query: wildcardQueryString(valueArg) } };
    return { multi_match: { type, query: value, lenient: true } };
  }

  const fields = indexPattern ? getFields(fieldNode, indexPattern) : [];
  // A field the index pattern does not have is asked as it is: OpenSearch decides
  if (fields.length === 0) fields.push({ name: fieldName as string, scripted: false, type: '' });
  const isExistsQuery = valueArg.type === 'wildcard' && value === '*';
  const isAllFieldsQuery =
    (fieldNode.type === 'wildcard' && fieldName === '*') ||
    Boolean(indexPattern && fields.length === indexPattern.fields.length);
  if (isExistsQuery && isAllFieldsQuery) return { match_all: {} };

  const queries: Dsl[] = [];
  for (const field of fields) {
    const wrap = wrapper(fieldNode, field, context);
    if (field.scripted) {
      // An exists query means nothing for a scripted field, so it adds nothing, as the original
      // means it to. The original's reducer (functions/is.ts) returns nothing for it, which drops
      // what it had gathered and fails on the next plain field ("accumulator is not iterable"): a
      // fault not copied
      if (!isExistsQuery) queries.push({ script: { ...phraseScript(field, value) } });
    } else if (isExistsQuery) {
      queries.push(wrap({ exists: { field: field.name } }));
    } else if (valueArg.type === 'wildcard') {
      queries.push(wrap({ query_string: { fields: [field.name], query: wildcardQueryString(valueArg) } }));
    } else if (field.type === 'date') {
      const zone = config.dateFormatTZ ? { time_zone: timeZone(config.dateFormatTZ) } : {};
      queries.push(wrap({ range: { [field.name]: { gte: value, lte: value, ...zone } } }));
    } else {
      queries.push(wrap({ [type === 'phrase' ? 'match_phrase' : 'match']: { [field.name]: value } }));
    }
  }
  return { bool: { should: queries, minimum_should_match: 1 } };
}

function rangeQuery(node: FunctionNode, indexPattern: IndexPattern | undefined, config: KueryOptions, context: Context): Dsl {
  const [fieldNameArg, ...args] = node.arguments;
  const fieldNode = fullFieldNameNode(fieldNameArg, indexPattern, context.nested?.path);
  const fields = indexPattern ? getFields(fieldNode, indexPattern) : [];
  const queryParams: Record<string, unknown> = {};
  const unnamed = ['gte', 'lte', 'format'];
  args.forEach((arg, index) => {
    if (arg.type === 'namedArg') queryParams[arg.name] = valueOf(arg.value);
    else queryParams[unnamed[index]] = valueOf(arg);
  });
  if (fields.length === 0) fields.push({ name: valueOf(fieldNode) as string, scripted: false, type: '' });
  const queries = fields.map((field): Dsl => {
    const wrap = wrapper(fieldNode, field, context);
    if (field.scripted) return { script: rangeScript(field, queryParams) };
    if (field.type === 'date') {
      const zone = config.dateFormatTZ ? { time_zone: timeZone(config.dateFormatTZ) } : {};
      return wrap({ range: { [field.name]: { ...queryParams, ...zone } } });
    }
    return wrap({ range: { [field.name]: queryParams } });
  });
  return { bool: { should: queries, minimum_should_match: 1 } };
}

/** The OpenSearch query a DQL tree stands for, as OpenSearch Dashboards writes it */
export function kueryToDsl(node: KueryNode, indexPattern?: IndexPattern, config: KueryOptions = {}, context: Context = {}): Dsl {
  if (node.type !== 'function') return valueOf(node) as Dsl;
  const children = node.arguments;
  switch (node.function) {
    case 'is':
      return isQuery(node, indexPattern, config, context);
    case 'range':
      return rangeQuery(node, indexPattern, config, context);
    case 'nested': {
      const [path, child] = children;
      const stringPath = String(valueOf(path));
      const fullPath = context.nested?.path ? `${context.nested.path}.${stringPath}` : stringPath;
      return {
        nested: {
          path: fullPath,
          query: kueryToDsl(child, indexPattern, config, { ...context, nested: { path: fullPath } }),
          score_mode: 'none',
        },
      };
    }
    case 'and':
      return { bool: { filter: children.map((child) => kueryToDsl(child, indexPattern, config, context)) } };
    case 'or':
      return {
        bool: { should: children.map((child) => kueryToDsl(child, indexPattern, config, context)), minimum_should_match: 1 },
      };
    case 'not':
      return { bool: { must_not: kueryToDsl(children[0], indexPattern, config, context) } };
    default:
      return { bool: { filter: [] } };
  }
}

/** A value as it has to be written in DQL to mean itself */
export function escapeKueryValue(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

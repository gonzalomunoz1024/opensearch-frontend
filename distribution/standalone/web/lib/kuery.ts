/* SPDX-License-Identifier: Apache-2.0 */

/*
 * DQL, the query language of the search bar (`response:200 and extension:(php or css)`), read
 * into a tree and turned into an OpenSearch query. The grammar and the queries it produces are
 * those of OpenSearch Dashboards, so a saved query means here what it meant there.
 */

import type { Field, IndexPattern } from './types';

export type KueryNode =
  | { type: 'and' | 'or'; children: KueryNode[] }
  | { type: 'not'; child: KueryNode }
  | { type: 'nested'; path: string; child: KueryNode }
  | { type: 'is'; field: string | null; value: KueryValue }
  | { type: 'range'; field: string; operator: 'gt' | 'gte' | 'lt' | 'lte'; value: KueryValue }
  | { type: 'all' };

export interface KueryValue {
  /** Text as typed, with `*` already marked in `wildcard` */
  text: string;
  quoted: boolean;
  /** An unquoted value with `*` in it: the pieces between the stars */
  wildcard?: string[];
  /** true, false or null written without quotes */
  literal?: boolean | null;
}

export class KuerySyntaxError extends Error {
  constructor(
    message: string,
    public readonly position: number
  ) {
    super(message);
    this.name = 'KuerySyntaxError';
  }
}

const SPECIAL = '\\():<>"*{}';

class Parser {
  private at = 0;
  constructor(private readonly text: string) {}

  parse(): KueryNode {
    this.skipSpace();
    if (this.at >= this.text.length) return { type: 'all' };
    const node = this.or();
    this.skipSpace();
    if (this.at < this.text.length) this.fail(`Unexpected "${this.text[this.at]}"`);
    return node;
  }

  private fail(message: string): never {
    throw new KuerySyntaxError(`${message} at position ${this.at + 1}`, this.at);
  }

  private skipSpace() {
    while (this.at < this.text.length && /\s/.test(this.text[this.at])) this.at += 1;
  }

  // A keyword counts only between spaces, or before a bracket
  private keyword(word: string): boolean {
    const slice = this.text.slice(this.at, this.at + word.length);
    if (slice.toLowerCase() !== word) return false;
    const after = this.text[this.at + word.length];
    if (after !== undefined && !/[\s(]/.test(after)) return false;
    this.at += word.length;
    return true;
  }

  private or(): KueryNode {
    const children = [this.and()];
    for (;;) {
      const mark = this.at;
      this.skipSpace();
      if (this.at > mark && this.keyword('or')) {
        this.skipSpace();
        children.push(this.and());
      } else {
        this.at = mark;
        break;
      }
    }
    return children.length === 1 ? children[0] : { type: 'or', children };
  }

  private and(): KueryNode {
    const children = [this.not()];
    for (;;) {
      const mark = this.at;
      this.skipSpace();
      if (this.at > mark && this.keyword('and')) {
        this.skipSpace();
        children.push(this.not());
      } else {
        this.at = mark;
        break;
      }
    }
    return children.length === 1 ? children[0] : { type: 'and', children };
  }

  private not(): KueryNode {
    const mark = this.at;
    if (this.keyword('not')) {
      const spaced = this.at;
      this.skipSpace();
      if (this.at > spaced || this.text[this.at] === '(') {
        return { type: 'not', child: this.sub() };
      }
    }
    this.at = mark;
    return this.sub();
  }

  private sub(): KueryNode {
    if (this.text[this.at] === '(') {
      this.at += 1;
      this.skipSpace();
      const node = this.or();
      this.skipSpace();
      if (this.text[this.at] !== ')') this.fail('Expected ")"');
      this.at += 1;
      return node;
    }
    return this.expression();
  }

  private expression(): KueryNode {
    const start = this.at;
    const first = this.literal();
    const afterFirst = this.at;
    this.skipSpace();

    const range = /^(<=|>=|<|>)/.exec(this.text.slice(this.at));
    if (range && !first.quoted) {
      this.at += range[0].length;
      this.skipSpace();
      const value = this.literal();
      const operator = ({ '<': 'lt', '<=': 'lte', '>': 'gt', '>=': 'gte' } as const)[
        range[0] as '<' | '<=' | '>' | '>='
      ];
      return { type: 'range', field: first.text, operator, value };
    }

    if (this.text[this.at] === ':') {
      this.at += 1;
      this.skipSpace();
      const field = first.wildcard ? first.wildcard.join('*') : first.text;
      if (this.text[this.at] === '{') {
        this.at += 1;
        this.skipSpace();
        const child = this.or();
        this.skipSpace();
        if (this.text[this.at] !== '}') this.fail('Expected "}"');
        this.at += 1;
        return { type: 'nested', path: field, child };
      }
      return this.listOfValues(field);
    }

    this.at = afterFirst;
    if (this.at === start) this.fail('Expected a value');
    return { type: 'is', field: null, value: first };
  }

  // What follows `field:`: one value, or values combined in brackets
  private listOfValues(field: string): KueryNode {
    if (this.text[this.at] === '(') {
      this.at += 1;
      this.skipSpace();
      const node = this.orValues(field);
      this.skipSpace();
      if (this.text[this.at] !== ')') this.fail('Expected ")"');
      this.at += 1;
      return node;
    }
    return { type: 'is', field, value: this.literal() };
  }

  private orValues(field: string): KueryNode {
    const children = [this.andValues(field)];
    for (;;) {
      const mark = this.at;
      this.skipSpace();
      if (this.at > mark && this.keyword('or')) {
        this.skipSpace();
        children.push(this.andValues(field));
      } else {
        this.at = mark;
        break;
      }
    }
    return children.length === 1 ? children[0] : { type: 'or', children };
  }

  private andValues(field: string): KueryNode {
    const children = [this.notValues(field)];
    for (;;) {
      const mark = this.at;
      this.skipSpace();
      if (this.at > mark && this.keyword('and')) {
        this.skipSpace();
        children.push(this.notValues(field));
      } else {
        this.at = mark;
        break;
      }
    }
    return children.length === 1 ? children[0] : { type: 'and', children };
  }

  private notValues(field: string): KueryNode {
    const mark = this.at;
    if (this.keyword('not')) {
      const spaced = this.at;
      this.skipSpace();
      if (this.at > spaced || this.text[this.at] === '(') {
        return { type: 'not', child: this.listOfValues(field) };
      }
    }
    this.at = mark;
    return this.listOfValues(field);
  }

  private literal(): KueryValue {
    if (this.text[this.at] === '"') {
      this.at += 1;
      let text = '';
      for (;;) {
        const char = this.text[this.at];
        if (char === undefined) this.fail('A quote is not closed');
        this.at += 1;
        if (char === '"') return { text, quoted: true };
        if (char === '\\' && (this.text[this.at] === '"' || this.text[this.at] === '\\')) {
          text += this.text[this.at];
          this.at += 1;
        } else {
          text += char;
        }
      }
    }

    const pieces: string[] = [''];
    let any = false;
    for (;;) {
      const char = this.text[this.at];
      if (char === undefined || /\s/.test(char)) break;
      if (char === '\\' && this.at + 1 < this.text.length) {
        const next = this.text[this.at + 1];
        if (SPECIAL.includes(next)) {
          pieces[pieces.length - 1] += next;
          this.at += 2;
          any = true;
          continue;
        }
        // \and, \or and \not stand for the words themselves
        const word = /^(and|or|not)/i.exec(this.text.slice(this.at + 1));
        if (word) {
          pieces[pieces.length - 1] += word[0];
          this.at += 1 + word[0].length;
          any = true;
          continue;
        }
      }
      if (char === '*') {
        pieces.push('');
        this.at += 1;
        any = true;
        continue;
      }
      if (SPECIAL.includes(char)) break;
      pieces[pieces.length - 1] += char;
      this.at += 1;
      any = true;
    }
    if (!any) this.fail(`Unexpected ${this.text[this.at] === undefined ? 'end of the query' : `"${this.text[this.at]}"`}`);
    if (pieces.length > 1) return { text: pieces.join('*'), quoted: false, wildcard: pieces };
    const [text] = pieces;
    if (text === 'true') return { text, quoted: false, literal: true };
    if (text === 'false') return { text, quoted: false, literal: false };
    if (text === 'null') return { text, quoted: false, literal: null };
    return { text, quoted: false };
  }
}

export function parseKuery(text: string): KueryNode {
  return new Parser(text ?? '').parse();
}

export interface KueryOptions {
  /** Sent with date values so that "2026-01-01" means that day where the reader is */
  dateFormatTZ?: string;
}

type Dsl = Record<string, unknown>;

const escapeQueryString = (text: string) => text.replace(/[+\-=&|><!(){}[\]^"~*?:\\/]/g, '\\$&');

// A wildcard as a query_string expression: the pieces escaped, joined by stars
const wildcardQueryString = (pieces: string[]) => pieces.map(escapeQueryString).join('*');

const wildcardRegExp = (pieces: string[]) =>
  new RegExp(`^${pieces.map((piece) => piece.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);

function fieldsMatching(name: string, indexPattern?: IndexPattern): Array<Field | { name: string }> {
  if (!name.includes('*')) {
    const field = indexPattern?.fields.find((candidate) => candidate.name === name);
    return [field ?? { name }];
  }
  if (!indexPattern) return [];
  const matcher = wildcardRegExp(name.split('*'));
  return indexPattern.fields.filter((field) => matcher.test(field.name));
}

function wrapNested(query: Dsl, field: Field | { name: string }, insideNested?: string): Dsl {
  const path = (field as Field).subType?.nested?.path;
  // Inside `path:{ ... }` the nesting is already written by the query itself
  if (!path || insideNested === path) return query;
  return { nested: { path, query, score_mode: 'none' } };
}

function valueOf(value: KueryValue): string | boolean | null {
  return value.literal !== undefined ? value.literal : value.text;
}

function isToDsl(
  node: Extract<KueryNode, { type: 'is' }>,
  indexPattern: IndexPattern | undefined,
  options: KueryOptions,
  nestedPath?: string
): Dsl {
  const { value } = node;
  const fieldName = node.field === null ? null : nestedPath && !node.field.startsWith(`${nestedPath}.`)
    ? `${nestedPath}.${node.field}`
    : node.field;
  const onlyStar = value.wildcard !== undefined && value.wildcard.every((piece) => piece === '');

  if (fieldName === null) {
    if (onlyStar) return { match_all: {} };
    if (value.wildcard) return { query_string: { query: wildcardQueryString(value.wildcard) } };
    return {
      multi_match: { type: value.quoted ? 'phrase' : 'best_fields', query: valueOf(value), lenient: true },
    };
  }

  if (fieldName === '*' && onlyStar) return { match_all: {} };

  const fields = fieldsMatching(fieldName, indexPattern);
  // No field of that name: OpenSearch decides, as it would for a field added since
  const targets = fields.length ? fields : [{ name: fieldName }];
  const clauses = targets.map((field): Dsl => {
    const known = field as Field;
    if (known.scripted) return { match_none: {} };
    if (onlyStar) return wrapNested({ exists: { field: field.name } }, field, nestedPath);
    if (value.wildcard) {
      return wrapNested(
        { query_string: { fields: [field.name], query: wildcardQueryString(value.wildcard) } },
        field,
        nestedPath
      );
    }
    if (known.type === 'date') {
      return wrapNested(
        {
          range: {
            [field.name]: {
              gte: valueOf(value),
              lte: valueOf(value),
              ...(options.dateFormatTZ ? { time_zone: options.dateFormatTZ } : {}),
            },
          },
        },
        field,
        nestedPath
      );
    }
    return wrapNested(
      { [value.quoted ? 'match_phrase' : 'match']: { [field.name]: valueOf(value) } },
      field,
      nestedPath
    );
  });
  return { bool: { should: clauses, minimum_should_match: 1 } };
}

function rangeToDsl(
  node: Extract<KueryNode, { type: 'range' }>,
  indexPattern: IndexPattern | undefined,
  options: KueryOptions,
  nestedPath?: string
): Dsl {
  const fieldName =
    nestedPath && !node.field.startsWith(`${nestedPath}.`) ? `${nestedPath}.${node.field}` : node.field;
  const fields = fieldsMatching(fieldName, indexPattern);
  const targets = fields.length ? fields : [{ name: fieldName }];
  const clauses = targets.map((field) => {
    const known = field as Field;
    if (known.scripted) return { match_none: {} };
    return wrapNested(
      {
        range: {
          [field.name]: {
            [node.operator]: valueOf(node.value),
            ...(known.type === 'date' && options.dateFormatTZ ? { time_zone: options.dateFormatTZ } : {}),
          },
        },
      },
      field,
      nestedPath
    );
  });
  return { bool: { should: clauses, minimum_should_match: 1 } };
}

export function kueryToDsl(
  node: KueryNode,
  indexPattern?: IndexPattern,
  options: KueryOptions = {},
  nestedPath?: string
): Dsl {
  switch (node.type) {
    case 'all':
      return { match_all: {} };
    case 'and':
      return {
        bool: { filter: node.children.map((child) => kueryToDsl(child, indexPattern, options, nestedPath)) },
      };
    case 'or':
      return {
        bool: {
          should: node.children.map((child) => kueryToDsl(child, indexPattern, options, nestedPath)),
          minimum_should_match: 1,
        },
      };
    case 'not':
      return { bool: { must_not: kueryToDsl(node.child, indexPattern, options, nestedPath) } };
    case 'nested': {
      const path = nestedPath ? `${nestedPath}.${node.path}` : node.path;
      return {
        nested: { path, query: kueryToDsl(node.child, indexPattern, options, path), score_mode: 'none' },
      };
    }
    case 'is':
      return isToDsl(node, indexPattern, options, nestedPath);
    case 'range':
      return rangeToDsl(node, indexPattern, options, nestedPath);
    default:
      return { match_all: {} };
  }
}

/** A value as it has to be written in DQL to mean itself */
export function escapeKueryValue(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

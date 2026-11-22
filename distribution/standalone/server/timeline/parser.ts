/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The parser of Timeline expressions: the grammar of OpenSearch Dashboards' `common/chain.peg`,
 * written out by hand. Each rule is the function the parser generator makes of it, in the same
 * order of alternatives, with the same actions run at the same moments and the same failures
 * recorded, so that the tree and the errors (their messages, `expected` and `location`) are
 * the ones the generated parser gives.
 */

export interface Location {
  min: number;
  max: number;
}

export interface Literal {
  type: 'literal';
  value: string | number | boolean | null;
  location: Location;
  text: string;
  function?: string;
}

export interface NamedArg {
  type: 'namedArg';
  name: string;
  value: Series;
  location: Location;
  text: string;
  function?: string;
}

export interface FunctionCall {
  type: 'function';
  function: string;
  arguments: Argument[];
  location: Location;
  text: string;
}

export interface Reference {
  type: 'reference';
  plot: number;
  series?: number;
}

export interface ChainList {
  type: 'chainList';
  list: Series[];
  label: string;
}

export interface Chain {
  type: 'chain';
  chain: Array<FunctionCall | ChainList>;
}

/** What a variable holds, or the nothing a variable assignment leaves in a list */
export type ArgValue = Literal | Chain | Reference;
export type Series = ArgValue | undefined;
export type Argument = NamedArg | Series;

export interface ParseResult {
  tree: Series[];
  functions: FunctionCall[];
  args: Argument[];
  variables: Record<string, Series>;
}

type Expectation =
  | { type: 'literal'; text: string; ignoreCase: boolean }
  | {
      type: 'class';
      parts: Array<string | [string, string]>;
      inverted: boolean;
      ignoreCase: boolean;
    }
  | { type: 'any' }
  | { type: 'end' }
  | { type: 'other'; description: string };

interface Position {
  offset: number;
  line: number;
  column: number;
}

export interface FileRange {
  source: undefined;
  start: Position;
  end: Position;
}

export class SyntaxError extends Error {
  constructor(
    message: string,
    public readonly expected: Expectation[] | null,
    public readonly found: string | null,
    public readonly location: FileRange
  ) {
    super(message);
    this.name = 'SyntaxError';
  }

  static buildMessage(expected: Expectation[], found: string | null): string {
    const hex = (ch: string) => ch.charCodeAt(0).toString(16).toUpperCase();
    const literalEscape = (s: string) =>
      s
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\0/g, '\\0')
        .replace(/\t/g, '\\t')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/[\x00-\x0F]/g, (ch) => '\\x0' + hex(ch))
        .replace(/[\x10-\x1F\x7F-\x9F]/g, (ch) => '\\x' + hex(ch));
    const classEscape = (s: string) =>
      s
        .replace(/\\/g, '\\\\')
        .replace(/\]/g, '\\]')
        .replace(/\^/g, '\\^')
        .replace(/-/g, '\\-')
        .replace(/\0/g, '\\0')
        .replace(/\t/g, '\\t')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/[\x00-\x0F]/g, (ch) => '\\x0' + hex(ch))
        .replace(/[\x10-\x1F\x7F-\x9F]/g, (ch) => '\\x' + hex(ch));
    const describe = (expectation: Expectation): string => {
      switch (expectation.type) {
        case 'literal':
          return '"' + literalEscape(expectation.text) + '"';
        case 'class': {
          const parts = expectation.parts.map((part) =>
            Array.isArray(part) ? classEscape(part[0]) + '-' + classEscape(part[1]) : classEscape(part)
          );
          return '[' + (expectation.inverted ? '^' : '') + parts.join('') + ']';
        }
        case 'any':
          return 'any character';
        case 'end':
          return 'end of input';
        case 'other':
          return expectation.description;
      }
    };
    const descriptions = expected.map(describe);
    descriptions.sort();
    if (descriptions.length > 0) {
      let j = 1;
      for (let i = 1; i < descriptions.length; i += 1) {
        if (descriptions[i - 1] !== descriptions[i]) {
          descriptions[j] = descriptions[i];
          j += 1;
        }
      }
      descriptions.length = j;
    }
    let described: string;
    switch (descriptions.length) {
      case 1:
        described = descriptions[0];
        break;
      case 2:
        described = descriptions[0] + ' or ' + descriptions[1];
        break;
      default:
        described =
          descriptions.slice(0, -1).join(', ') + ', or ' + descriptions[descriptions.length - 1];
    }
    const foundText = found ? '"' + literalEscape(found) + '"' : 'end of input';
    return 'Expected ' + described + ' but ' + foundText + ' found.';
  }
}

const FAILED = Symbol('failed');
type Failed = typeof FAILED;

const literalExpectation = (text: string): Expectation => ({ type: 'literal', text, ignoreCase: false });
const classExpectation = (
  parts: Array<string | [string, string]>,
  inverted: boolean
): Expectation => ({ type: 'class', parts, inverted, ignoreCase: false });

const E_COMMA = literalExpectation(',');
const E_EQUALS = literalExpectation('=');
const E_DOLLAR = literalExpectation('$');
const E_NAME_START = classExpectation([['a', 'z'], ['A', 'Z']], false);
const E_NAME_REST = classExpectation(['.', ['a', 'z'], ['A', 'Z'], ['0', '9'], '_', '-'], false);
const E_FUNCTION: Expectation = { type: 'other', description: 'function' };
const E_DOT = literalExpectation('.');
const E_OPEN = literalExpectation('(');
const E_CLOSE = literalExpectation(')');
const E_AT = literalExpectation('@');
const E_COLON = literalExpectation(':');
const E_LITERAL: Expectation = { type: 'other', description: 'literal' };
const E_DQUOTE = literalExpectation('"');
const E_SQUOTE = literalExpectation("'");
const E_TRUE = literalExpectation('true');
const E_FALSE = literalExpectation('false');
const E_NULL = literalExpectation('null');
const E_BARE = classExpectation(['(', ')', '"', "'", ',', '=', ' ', '\t'], true);
const E_SPACE = classExpectation([' ', '\t', '\r', '\n'], false);
const E_BACKSLASH = literalExpectation('\\');
const E_DQ_ESCAPED = classExpectation(['"', '\\'], false);
const E_DQ_CHAR = classExpectation(['"'], true);
const E_SQ_ESCAPED = classExpectation(["'", '\\'], false);
const E_SQ_CHAR = classExpectation(["'"], true);
const E_DIGIT = classExpectation([['0', '9']], false);

const R_NAME_START = /^[a-zA-Z]/;
const R_NAME_REST = /^[.a-zA-Z0-9_-]/;
const R_BARE = /^[^()"',= \t]/;
const R_SPACE = /^[ \t\r\n]/;
const R_DQ_ESCAPED = /^["\\]/;
const R_DQ_CHAR = /^[^"]/;
const R_SQ_ESCAPED = /^['\\]/;
const R_SQ_CHAR = /^[^']/;
const R_DIGIT = /^[0-9]/;

class Parser {
  private pos = 0;
  private savedPos = 0;
  private maxFailPos = 0;
  private maxFailExpected: Expectation[] = [];
  private silentFails = 0;
  private readonly posDetailsCache: Array<{ line: number; column: number } | undefined> = [
    { line: 1, column: 1 },
  ];

  // The state the grammar's initializer keeps for one parse
  private currentFunction: string | undefined;
  private currentArgs: Argument[] = [];
  private readonly functions: FunctionCall[] = [];
  private readonly args: Argument[] = [];
  private readonly variables: Record<string, Series> = {};

  constructor(private readonly input: string) {}

  parse(): ParseResult {
    const result = this.parseStart();
    if (result !== FAILED && this.pos === this.input.length) return result;
    if (result !== FAILED && this.pos < this.input.length) this.fail({ type: 'end' });
    const { input, maxFailPos } = this;
    throw new SyntaxError(
      SyntaxError.buildMessage(this.maxFailExpected, maxFailPos < input.length ? input.charAt(maxFailPos) : null),
      this.maxFailExpected,
      maxFailPos < input.length ? input.charAt(maxFailPos) : null,
      maxFailPos < input.length
        ? this.computeLocation(maxFailPos, maxFailPos + 1)
        : this.computeLocation(maxFailPos, maxFailPos)
    );
  }

  // --- The parser generator's runtime ------------------------------------------------------------

  private text() {
    return this.input.substring(this.savedPos, this.pos);
  }

  private simpleLocation(): Location {
    return { min: this.savedPos, max: this.pos };
  }

  private error(message: string): never {
    throw new SyntaxError(message, null, null, this.computeLocation(this.savedPos, this.pos));
  }

  private computePosDetails(pos: number) {
    const cached = this.posDetailsCache[pos];
    if (cached) return cached;
    let p: number;
    if (pos >= this.posDetailsCache.length) {
      p = this.posDetailsCache.length - 1;
    } else {
      p = pos;
      while (!this.posDetailsCache[--p]) {
        // look back for the nearest known position
      }
    }
    const known = this.posDetailsCache[p] as { line: number; column: number };
    const details = { line: known.line, column: known.column };
    while (p < pos) {
      if (this.input.charCodeAt(p) === 10) {
        details.line += 1;
        details.column = 1;
      } else {
        details.column += 1;
      }
      p += 1;
    }
    this.posDetailsCache[pos] = details;
    return details;
  }

  private computeLocation(startPos: number, endPos: number): FileRange {
    const start = this.computePosDetails(startPos);
    const end = this.computePosDetails(endPos);
    return {
      source: undefined,
      start: { offset: startPos, line: start.line, column: start.column },
      end: { offset: endPos, line: end.line, column: end.column },
    };
  }

  private fail(expected: Expectation) {
    if (this.pos < this.maxFailPos) return;
    if (this.pos > this.maxFailPos) {
      this.maxFailPos = this.pos;
      this.maxFailExpected = [];
    }
    this.maxFailExpected.push(expected);
  }

  /** One character of a class, or a failure recorded against the class */
  private charClass(re: RegExp, expectation: Expectation): string | Failed {
    const ch = this.input.charAt(this.pos);
    if (re.test(ch)) {
      this.pos += 1;
      return ch;
    }
    if (this.silentFails === 0) this.fail(expectation);
    return FAILED;
  }

  private literal(text: string, expectation: Expectation): string | Failed {
    if (this.input.substr(this.pos, text.length) === text) {
      this.pos += text.length;
      return text;
    }
    if (this.silentFails === 0) this.fail(expectation);
    return FAILED;
  }

  /** `space?` */
  private optionalSpace() {
    this.parseSpace();
  }

  // --- The rules ---------------------------------------------------------------------------------

  private parseStart(): ParseResult | Failed {
    const s0 = this.pos;
    this.optionalSpace();
    const tree = this.parseSeries();
    if (tree === FAILED) {
      this.pos = s0;
      return FAILED;
    }
    this.savedPos = s0;
    return {
      tree: tree.filter((o) => o != null),
      functions: this.functions,
      args: this.args,
      variables: this.variables,
    };
  }

  private parseArgList(): Argument[] | Failed {
    const s0 = this.pos;
    const first = this.parseArgument();
    if (first === FAILED) {
      this.pos = s0;
      return FAILED;
    }
    const rest: Argument[] = [];
    for (;;) {
      const s3 = this.pos;
      this.optionalSpace();
      if (this.literal(',', E_COMMA) === FAILED) {
        this.pos = s3;
        break;
      }
      this.optionalSpace();
      const arg = this.parseArgument();
      if (arg === FAILED) {
        this.pos = s3;
        break;
      }
      this.savedPos = s3;
      rest.push(arg);
    }
    this.optionalSpace();
    this.literal(',', E_COMMA);
    this.savedPos = s0;
    return [first].concat(rest);
  }

  private parseArgument(): Argument | Failed {
    // name:argument_name space? '=' space? value:arg_type
    let s0 = this.pos;
    let name = this.parseArgumentName();
    if (name !== FAILED) {
      this.optionalSpace();
      if (this.literal('=', E_EQUALS) !== FAILED) {
        this.optionalSpace();
        const value = this.parseArgType();
        if (value !== FAILED) {
          this.savedPos = s0;
          const arg: NamedArg = {
            type: 'namedArg',
            name,
            value,
            location: this.simpleLocation(),
            text: this.text(),
          };
          this.currentArgs.push(arg);
          return arg;
        }
      }
    }
    this.pos = s0;

    // space? '=' space? value:arg_type?
    s0 = this.pos;
    this.optionalSpace();
    if (this.literal('=', E_EQUALS) !== FAILED) {
      this.optionalSpace();
      this.parseArgType();
      this.savedPos = s0;
      this.error(
        JSON.stringify({
          type: 'incompleteArgument',
          currentArgs: this.currentArgs,
          currentFunction: this.currentFunction,
          location: this.simpleLocation(),
          text: this.text(),
        })
      );
    }
    this.pos = s0;

    // name:argument_name space? '='
    s0 = this.pos;
    name = this.parseArgumentName();
    if (name !== FAILED) {
      this.optionalSpace();
      if (this.literal('=', E_EQUALS) !== FAILED) {
        this.savedPos = s0;
        this.error(
          JSON.stringify({
            type: 'incompleteArgumentValue',
            currentArgs: this.currentArgs,
            currentFunction: this.currentFunction,
            name,
            location: this.simpleLocation(),
            text: this.text(),
          })
        );
      }
    }
    this.pos = s0;

    // element:arg_type
    s0 = this.pos;
    const element = this.parseArgType();
    if (element !== FAILED) this.savedPos = s0;
    return element;
  }

  private parseArgType(): Series | Failed {
    let s0 = this.parseVariableGet();
    if (s0 !== FAILED) return s0;
    s0 = this.parseSeriesType();
    if (s0 !== FAILED) return s0;
    const start = this.pos;
    const literal = this.parseLiteral();
    if (literal === FAILED) return FAILED;
    this.savedPos = start;
    return {
      type: 'literal',
      value: literal,
      location: this.simpleLocation(),
      text: this.text(),
    };
  }

  private parseVariableGet(): Series | Failed {
    const s0 = this.pos;
    if (this.literal('$', E_DOLLAR) === FAILED) {
      this.pos = s0;
      return FAILED;
    }
    const name = this.parseArgumentName();
    if (name === FAILED) {
      this.pos = s0;
      return FAILED;
    }
    this.savedPos = s0;
    if (this.variables[name]) return this.variables[name];
    return this.error('$' + name + ' is not defined');
  }

  private parseVariableSet(): undefined | Failed {
    const s0 = this.pos;
    if (this.literal('$', E_DOLLAR) !== FAILED) {
      const name = this.parseArgumentName();
      if (name !== FAILED) {
        this.optionalSpace();
        if (this.literal('=', E_EQUALS) !== FAILED) {
          this.optionalSpace();
          const value = this.parseArgType();
          if (value !== FAILED) {
            this.savedPos = s0;
            this.variables[name] = value;
            return undefined;
          }
        }
      }
    }
    this.pos = s0;
    return FAILED;
  }

  private parseSeriesType(): Series | Failed {
    let s0: Series | Failed = this.parseVariableSet();
    if (s0 !== FAILED) return s0;
    s0 = this.parseVariableGet();
    if (s0 !== FAILED) return s0;
    s0 = this.parseGroup();
    if (s0 !== FAILED) return s0;
    s0 = this.parseChain();
    if (s0 !== FAILED) return s0;
    return this.parseReference();
  }

  private parseSeries(): Series[] | Failed {
    const s0 = this.pos;
    const first = this.parseSeriesType();
    if (first === FAILED) {
      this.pos = s0;
      return FAILED;
    }
    const rest: Series[] = [];
    for (;;) {
      const s3 = this.pos;
      this.optionalSpace();
      if (this.literal(',', E_COMMA) === FAILED) {
        this.pos = s3;
        break;
      }
      this.optionalSpace();
      const series = this.parseSeriesType();
      if (series === FAILED) {
        this.pos = s3;
        break;
      }
      this.savedPos = s3;
      rest.push(series);
    }
    this.literal(',', E_COMMA);
    this.savedPos = s0;
    return [first].concat(rest);
  }

  /** `[a-zA-Z]+ [.a-zA-Z0-9_-]*`, as one string */
  private parseName(): string | Failed {
    const s0 = this.pos;
    let first = '';
    let ch = this.charClass(R_NAME_START, E_NAME_START);
    if (ch === FAILED) {
      this.pos = s0;
      return FAILED;
    }
    while (ch !== FAILED) {
      first += ch;
      ch = this.charClass(R_NAME_START, E_NAME_START);
    }
    let rest = '';
    ch = this.charClass(R_NAME_REST, E_NAME_REST);
    while (ch !== FAILED) {
      rest += ch;
      ch = this.charClass(R_NAME_REST, E_NAME_REST);
    }
    this.savedPos = s0;
    return first + rest;
  }

  private parseFunctionName(): string | Failed {
    const name = this.parseName();
    if (name === FAILED) return FAILED;
    this.currentFunction = name;
    this.currentArgs = [];
    return name;
  }

  private parseArgumentName(): string | Failed {
    return this.parseName();
  }

  private parseFunction(): FunctionCall | Failed {
    this.silentFails += 1;
    let result: FunctionCall | Failed = FAILED;

    // space? '.' name:function_name space? '(' space? arg_list:arg_list? space? ')' space?
    let s0 = this.pos;
    this.optionalSpace();
    if (this.literal('.', E_DOT) !== FAILED) {
      const name = this.parseFunctionName();
      if (name !== FAILED) {
        this.optionalSpace();
        if (this.literal('(', E_OPEN) !== FAILED) {
          this.optionalSpace();
          const argList = this.parseArgList();
          this.optionalSpace();
          if (this.literal(')', E_CLOSE) !== FAILED) {
            this.optionalSpace();
            this.savedPos = s0;
            const call: FunctionCall = {
              type: 'function',
              function: name,
              arguments: argList === FAILED ? [] : argList,
              location: this.simpleLocation(),
              text: this.text(),
            };
            call.arguments.forEach((arg) => {
              (arg as { function?: string }).function = name;
              this.args.push(arg);
            });
            this.functions.push(call);
            result = call;
          }
        }
      }
    }

    if (result === FAILED) {
      this.pos = s0;
      // '.' func:function_name?
      s0 = this.pos;
      if (this.literal('.', E_DOT) !== FAILED) {
        const func = this.parseFunctionName();
        this.savedPos = s0;
        this.error(
          JSON.stringify({
            type: 'incompleteFunction',
            function: func === FAILED ? null : func,
            location: this.simpleLocation(),
            text: this.text(),
          })
        );
      }
      this.pos = s0;
    }

    this.silentFails -= 1;
    if (result === FAILED && this.silentFails === 0) this.fail(E_FUNCTION);
    return result;
  }

  private parseReference(): Reference | Failed {
    let s0 = this.pos;
    if (this.literal('@', E_AT) !== FAILED) {
      const plot = this.parseInteger();
      if (plot !== FAILED && this.literal(':', E_COLON) !== FAILED) {
        const series = this.parseInteger();
        if (series !== FAILED) {
          this.savedPos = s0;
          return { type: 'reference', plot, series };
        }
      }
    }
    this.pos = s0;

    s0 = this.pos;
    if (this.literal('@', E_AT) !== FAILED) {
      const plot = this.parseInteger();
      if (plot !== FAILED) {
        this.savedPos = s0;
        return { type: 'reference', plot };
      }
    }
    this.pos = s0;
    return FAILED;
  }

  private parseChain(): Chain | Failed {
    const s0 = this.pos;
    const func = this.parseFunction();
    if (func === FAILED) {
      this.pos = s0;
      return FAILED;
    }
    this.optionalSpace();
    const rest: FunctionCall[] = [];
    let next = this.parseFunction();
    while (next !== FAILED) {
      rest.push(next);
      next = this.parseFunction();
    }
    this.savedPos = s0;
    return { type: 'chain', chain: [func as FunctionCall | ChainList].concat(rest) };
  }

  private parseGroup(): Chain | Failed {
    const s0 = this.pos;
    if (this.literal('(', E_OPEN) !== FAILED) {
      this.optionalSpace();
      const grouped = this.parseSeries();
      if (grouped !== FAILED) {
        this.optionalSpace();
        if (this.literal(')', E_CLOSE) !== FAILED) {
          const functions: FunctionCall[] = [];
          let next = this.parseFunction();
          while (next !== FAILED) {
            functions.push(next);
            next = this.parseFunction();
          }
          this.savedPos = s0;
          const first: ChainList = { type: 'chainList', list: grouped, label: '' };
          first.label = this.text();
          return { type: 'chain', chain: [first as FunctionCall | ChainList].concat(functions) };
        }
      }
    }
    this.pos = s0;
    return FAILED;
  }

  private parseLiteral(): Literal['value'] | Failed {
    this.silentFails += 1;
    let result: Literal['value'] | Failed = this.parseQuoted('"', E_DQUOTE, false);
    if (result === FAILED) result = this.parseQuoted("'", E_SQUOTE, true);
    if (result === FAILED) {
      const s0 = this.pos;
      if (this.literal('true', E_TRUE) !== FAILED) {
        this.savedPos = s0;
        result = true;
      } else if (this.literal('false', E_FALSE) !== FAILED) {
        this.savedPos = s0;
        result = false;
      } else if (this.literal('null', E_NULL) !== FAILED) {
        this.savedPos = s0;
        result = null;
      } else {
        let string = '';
        let ch = this.charClass(R_BARE, E_BARE);
        if (ch !== FAILED) {
          while (ch !== FAILED) {
            string += ch;
            ch = this.charClass(R_BARE, E_BARE);
          }
          this.savedPos = s0;
          // Sort of hacky, but PEG doesn't have backtracking so
          // a number rule is hard to read, and performs worse
          result = isNaN(Number(string)) ? string : Number(string);
        }
      }
    }
    this.silentFails -= 1;
    if (result === FAILED && this.silentFails === 0) this.fail(E_LITERAL);
    return result;
  }

  private parseQuoted(quote: string, expectation: Expectation, single: boolean): string | Failed {
    const s0 = this.pos;
    if (this.literal(quote, expectation) === FAILED) {
      this.pos = s0;
      return FAILED;
    }
    let chars = '';
    let ch = this.parseQuotedChar(single);
    while (ch !== FAILED) {
      chars += ch;
      ch = this.parseQuotedChar(single);
    }
    if (this.literal(quote, expectation) === FAILED) {
      this.pos = s0;
      return FAILED;
    }
    this.savedPos = s0;
    return chars;
  }

  /** dq_char or sq_char */
  private parseQuotedChar(single: boolean): string | Failed {
    const s0 = this.pos;
    if (this.literal('\\', E_BACKSLASH) !== FAILED) {
      const sequence = single
        ? this.charClass(R_SQ_ESCAPED, E_SQ_ESCAPED)
        : this.charClass(R_DQ_ESCAPED, E_DQ_ESCAPED);
      if (sequence !== FAILED) {
        this.savedPos = s0;
        return sequence;
      }
    }
    this.pos = s0;
    return single ? this.charClass(R_SQ_CHAR, E_SQ_CHAR) : this.charClass(R_DQ_CHAR, E_DQ_CHAR);
  }

  private parseSpace(): string[] | Failed {
    const spaces: string[] = [];
    let ch = this.charClass(R_SPACE, E_SPACE);
    if (ch === FAILED) return FAILED;
    while (ch !== FAILED) {
      spaces.push(ch);
      ch = this.charClass(R_SPACE, E_SPACE);
    }
    return spaces;
  }

  private parseInteger(): number | Failed {
    const s0 = this.pos;
    let digits = '';
    let ch = this.charClass(R_DIGIT, E_DIGIT);
    if (ch === FAILED) return FAILED;
    while (ch !== FAILED) {
      digits += ch;
      ch = this.charClass(R_DIGIT, E_DIGIT);
    }
    this.savedPos = s0;
    return parseInt(digits);
  }
}

/** Parses one expression; throws a SyntaxError as the generated parser does */
export function parse(input: string): ParseResult {
  return new Parser(input).parse();
}

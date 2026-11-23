/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Text with places to fill in, in the Handlebars notation that TSVB writes its Markdown panels and
 * value templates in, read and filled in as the product fills them: with the Handlebars it ships
 * (4.7), run through its interpreter of the syntax tree with only the built-in helpers, and in
 * strict mode for a Markdown panel.
 *
 * Everything that notation has is read as Handlebars reads it, by its lexer's rules and its
 * grammar: values (`{{a.b}}`, `{{{raw}}}`, `{{&raw}}`), sections (`{{#a}}…{{else}}…{{/a}}`,
 * `{{^a}}…{{/a}}`), the helpers `each`, `if`, `unless`, `with`, `lookup` and `log` with
 * `{{else}}` and `{{else if …}}`, sub-expressions, hash arguments, block parameters, the data
 * variables (`@index`, `@key`, `@first`, `@last`, `@root`), comments, `~` and the lines that hold
 * only a block's tag, raw blocks, escaped mustaches, and inline partials. A value is put in as
 * text, HTML-escaped as Handlebars escapes it; nothing in it is ever run.
 *
 * Two things the product's interpreter gets wrong are not copied: in strict mode it fails on a
 * reference to the context itself (`{{this}}`, `{{.}}`, `{{..}}`) and on every block parameter,
 * where Handlebars gives the value.
 */

// --- Errors ---------------------------------------------------------------------------------------

/**
 * Why a text could not be filled in, sorted by the words of the message as the product sorts it:
 * 'parse' when the text is not well formed, 'unknown' when strict mode finds no value of a name
 * (`variable` holds the name), 'other' for any other fault, such as a helper given the wrong values
 */
export class TemplateError extends Error {
  readonly kind: 'parse' | 'unknown' | 'other';
  readonly variable?: string;

  constructor(message: string) {
    super(message);
    this.name = 'TemplateError';
    this.kind = message.includes('Parse error') ? 'parse' : message.includes('not defined in') ? 'unknown' : 'other';
    if (this.kind === 'unknown') this.variable = message.split('"')[1];
  }
}

// --- Lexer: Handlebars' rules, tried in its order -------------------------------------------------

type TokenType =
  | 'CONTENT'
  | 'COMMENT'
  | 'OPEN_SEXPR'
  | 'CLOSE_SEXPR'
  | 'OPEN_RAW_BLOCK'
  | 'CLOSE_RAW_BLOCK'
  | 'END_RAW_BLOCK'
  | 'OPEN_PARTIAL'
  | 'OPEN_PARTIAL_BLOCK'
  | 'OPEN_BLOCK'
  | 'OPEN_ENDBLOCK'
  | 'INVERSE'
  | 'OPEN_INVERSE'
  | 'OPEN_INVERSE_CHAIN'
  | 'OPEN_UNESCAPED'
  | 'OPEN'
  | 'EQUALS'
  | 'ID'
  | 'SEP'
  | 'CLOSE_UNESCAPED'
  | 'CLOSE'
  | 'STRING'
  | 'DATA'
  | 'BOOLEAN'
  | 'UNDEFINED'
  | 'NULL'
  | 'NUMBER'
  | 'OPEN_BLOCK_PARAMS'
  | 'CLOSE_BLOCK_PARAMS'
  | 'INVALID'
  | 'EOF'
  | 'LEXICAL_ERROR';

interface Token {
  type: TokenType;
  text: string;
  line: number;
}

type LexState = 'INITIAL' | 'mu' | 'emu' | 'com' | 'raw';

interface MuRule {
  pattern: RegExp;
  /** None: the text is skipped */
  type?: TokenType;
  pop?: boolean;
  begin?: LexState;
  /** The text is put back, to be read again in the state begun */
  unput?: boolean;
  text?: (text: string) => string;
}

// Inside a mustache
const MU_RULES: MuRule[] = [
  { pattern: /\(/y, type: 'OPEN_SEXPR' },
  { pattern: /\)/y, type: 'CLOSE_SEXPR' },
  { pattern: /\{\{\{\{/y, type: 'OPEN_RAW_BLOCK' },
  { pattern: /\}\}\}\}/y, type: 'CLOSE_RAW_BLOCK', pop: true, begin: 'raw' },
  { pattern: /\{\{~?>/y, type: 'OPEN_PARTIAL' },
  { pattern: /\{\{~?#>/y, type: 'OPEN_PARTIAL_BLOCK' },
  { pattern: /\{\{~?#\*?/y, type: 'OPEN_BLOCK' },
  { pattern: /\{\{~?\//y, type: 'OPEN_ENDBLOCK' },
  { pattern: /\{\{~?\^\s*~?\}\}/y, type: 'INVERSE', pop: true },
  { pattern: /\{\{~?\s*else\s*~?\}\}/y, type: 'INVERSE', pop: true },
  { pattern: /\{\{~?\^/y, type: 'OPEN_INVERSE' },
  { pattern: /\{\{~?\s*else\b/y, type: 'OPEN_INVERSE_CHAIN' },
  { pattern: /\{\{~?\{/y, type: 'OPEN_UNESCAPED' },
  { pattern: /\{\{~?&/y, type: 'OPEN' },
  { pattern: /\{\{~?!--/y, unput: true, pop: true, begin: 'com' },
  { pattern: /\{\{~?![\s\S]*?\}\}/y, type: 'COMMENT', pop: true },
  { pattern: /\{\{~?\*?/y, type: 'OPEN' },
  { pattern: /=/y, type: 'EQUALS' },
  { pattern: /\.\./y, type: 'ID' },
  { pattern: /\.(?=[=~}\s/.)|])/y, type: 'ID' },
  { pattern: /[/.]/y, type: 'SEP' },
  { pattern: /\s+/y },
  { pattern: /\}~?\}\}/y, type: 'CLOSE_UNESCAPED', pop: true },
  { pattern: /~?\}\}/y, type: 'CLOSE', pop: true },
  { pattern: /"(\\["]|[^"])*"/y, type: 'STRING', text: (text) => text.slice(1, -1).replace(/\\"/g, '"') },
  { pattern: /'(\\[']|[^'])*'/y, type: 'STRING', text: (text) => text.slice(1, -1).replace(/\\'/g, "'") },
  { pattern: /@/y, type: 'DATA' },
  { pattern: /true(?=[~}\s)])/y, type: 'BOOLEAN' },
  { pattern: /false(?=[~}\s)])/y, type: 'BOOLEAN' },
  { pattern: /undefined(?=[~}\s)])/y, type: 'UNDEFINED' },
  { pattern: /null(?=[~}\s)])/y, type: 'NULL' },
  { pattern: /-?[0-9]+(?:\.[0-9]+)?(?=[~}\s)])/y, type: 'NUMBER' },
  { pattern: /as\s+\|/y, type: 'OPEN_BLOCK_PARAMS' },
  { pattern: /\|/y, type: 'CLOSE_BLOCK_PARAMS' },
  { pattern: /[^\s!"#%-,./;->@[-^`{-~]+(?=[=~}\s/.)|])/y, type: 'ID' },
  { pattern: /\[(\\\]|[^\]])*\]/y, type: 'ID', text: (text) => text.replace(/\\([\\\]])/g, '$1') },
  { pattern: /./y, type: 'INVALID' },
  { pattern: /$/y, type: 'EOF' },
];

const CONTENT_TO_MUSTACHE = /[^\x00]*?(?=\{\{)/y;
const CONTENT_TO_END = /[^\x00]+/y;
const ESCAPED_CONTENT = /[^\x00]{2,}?(?=\{\{|\\\{\{|\\\\\{\{|$)/y;
const RAW_NESTED = /\{\{\{\{(?=[^/])/y;
const RAW_END = /\{\{\{\{\/[^\s!"#%-,./;->@[-^`{-~]+(?=[=}\s/.])\}\}\}\}/y;
const RAW_CONTENT = /[^\x00]+?(?=\{\{\{\{)/y;
const COMMENT_TO_END = /[\s\S]*?--~?\}\}/y;

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  const states: LexState[] = ['INITIAL'];
  let position = 0;
  let line = 1;
  const read = (pattern: RegExp): string | undefined => {
    pattern.lastIndex = position;
    const match = pattern.exec(input);
    return match ? match[0] : undefined;
  };
  const advance = (text: string) => {
    position += text.length;
    line += (text.match(/\r\n?|\n/g) ?? []).length;
  };
  const push = (type: TokenType, text: string) => tokens.push({ type, text, line });

  for (;;) {
    const state = states[states.length - 1];
    let matched: string | undefined;
    if (state === 'INITIAL') {
      matched = read(CONTENT_TO_MUSTACHE);
      if (matched !== undefined) {
        let text = matched;
        if (text.endsWith('\\\\')) {
          text = text.slice(0, -1);
          states.push('mu');
        } else if (text.endsWith('\\')) {
          text = text.slice(0, -1);
          states.push('emu');
        } else states.push('mu');
        if (text) push('CONTENT', text);
        advance(matched);
        continue;
      }
      matched = read(CONTENT_TO_END);
      if (matched !== undefined) {
        push('CONTENT', matched);
        advance(matched);
        continue;
      }
      if (position >= input.length) {
        push('EOF', '');
        return tokens;
      }
    } else if (state === 'emu') {
      matched = read(ESCAPED_CONTENT);
      if (matched !== undefined) {
        states.pop();
        push('CONTENT', matched);
        advance(matched);
        continue;
      }
    } else if (state === 'com') {
      matched = read(COMMENT_TO_END);
      if (matched !== undefined) {
        states.pop();
        push('COMMENT', matched);
        advance(matched);
        continue;
      }
    } else if (state === 'raw') {
      matched = read(RAW_NESTED);
      if (matched !== undefined) {
        states.push('raw');
        push('CONTENT', matched);
        advance(matched);
        continue;
      }
      matched = read(RAW_END);
      if (matched !== undefined) {
        states.pop();
        if (states[states.length - 1] === 'raw') push('CONTENT', matched);
        else push('END_RAW_BLOCK', matched.slice(5, -4));
        advance(matched);
        continue;
      }
      matched = read(RAW_CONTENT);
      if (matched !== undefined) {
        push('CONTENT', matched);
        advance(matched);
        continue;
      }
    } else {
      const rule = MU_RULES.find((candidate) => read(candidate.pattern) !== undefined);
      if (rule) {
        const text = read(rule.pattern) ?? '';
        if (rule.pop) states.pop();
        if (rule.begin) states.push(rule.begin);
        if (rule.unput) continue;
        if (rule.type) push(rule.type, rule.text ? rule.text(text) : text);
        advance(text);
        if (rule.type === 'EOF') return tokens;
        continue;
      }
    }
    // Nothing matches: the end, or text no rule can read
    if (position >= input.length) push('EOF', '');
    else push('LEXICAL_ERROR', '');
    return tokens;
  }
}

// --- Syntax tree ------------------------------------------------------------------------------------

interface Strip {
  open?: boolean;
  close?: boolean;
}

interface PathNode {
  type: 'PathExpression';
  data: boolean;
  depth: number;
  parts: string[];
  original: string;
  /** The last part must be there: set on the path of a value or section, in strict mode */
  strict?: boolean;
}

type LiteralValue = string | number | boolean | null | undefined;

interface LiteralNode {
  type: 'StringLiteral' | 'NumberLiteral' | 'BooleanLiteral' | 'UndefinedLiteral' | 'NullLiteral';
  value: LiteralValue;
  original: LiteralValue;
}

interface SubExpressionNode {
  type: 'SubExpression';
  path: PathNode | LiteralNode;
  params: Expression[];
  hash?: HashNode;
}

type Expression = PathNode | LiteralNode | SubExpressionNode;

interface HashNode {
  pairs: Array<{ key: string; value: Expression }>;
}

interface ContentNode {
  type: 'ContentStatement';
  original: string;
  value: string;
  rightStripped?: boolean;
  leftStripped?: boolean;
}

interface CommentNode {
  type: 'CommentStatement';
  strip: Strip;
}

interface MustacheNode {
  type: 'MustacheStatement' | 'Decorator';
  path: PathNode | LiteralNode;
  params: Expression[];
  hash?: HashNode;
  escaped: boolean;
  strip: Strip;
}

interface BlockNode {
  type: 'BlockStatement' | 'DecoratorBlock';
  path: PathNode | LiteralNode;
  params: Expression[];
  hash?: HashNode;
  program?: ProgramNode;
  inverse?: ProgramNode;
  openStrip: Strip;
  inverseStrip?: Strip;
  closeStrip?: Strip;
}

interface PartialNode {
  type: 'PartialStatement';
  name: PathNode | LiteralNode | SubExpressionNode;
  params: Expression[];
  hash?: HashNode;
  indent: string;
  strip: Strip;
}

interface PartialBlockNode {
  type: 'PartialBlockStatement';
  name: PathNode | LiteralNode | SubExpressionNode;
  params: Expression[];
  hash?: HashNode;
  program: ProgramNode;
  openStrip: Strip;
  closeStrip?: Strip;
}

type Statement = ContentNode | CommentNode | MustacheNode | BlockNode | PartialNode | PartialBlockNode;

interface ProgramNode {
  type: 'Program';
  body: Statement[];
  blockParams?: string[];
  chained?: boolean;
}

interface OpenBlock {
  open?: string;
  path: PathNode | LiteralNode;
  params: Expression[];
  hash?: HashNode;
  blockParams?: string[];
  strip: Strip;
}

interface InverseChain {
  strip: Strip;
  program: ProgramNode;
  chain?: boolean;
}

interface CloseBlock {
  path: PathNode | LiteralNode;
  strip: Strip;
}

const stripFlags = (open: string, close: string): Strip => ({ open: open.charAt(2) === '~', close: close.charAt(close.length - 3) === '~' });

const id = (token: string) => (/^\[.*\]$/.test(token) ? token.substring(1, token.length - 1) : token);

const originalOf = (node: PathNode | LiteralNode | SubExpressionNode): LiteralValue => (node.type === 'SubExpression' ? undefined : node.original);

function validateClose(open: PathNode | LiteralNode | SubExpressionNode, close: LiteralValue) {
  const opened = originalOf(open);
  if (opened !== close) throw new TemplateError(`${String(opened)} doesn't match ${String(close)}`);
}

function preparePath(data: boolean, segments: Array<{ part: string; original: string; separator?: string }>): PathNode {
  let original = data ? '@' : '';
  const parts: string[] = [];
  let depth = 0;
  for (const segment of segments) {
    // A part in brackets is a name, even `[..]` or `[this]`
    const literal = segment.original !== segment.part;
    original += (segment.separator ?? '') + segment.part;
    if (!literal && (segment.part === '..' || segment.part === '.' || segment.part === 'this')) {
      if (parts.length > 0) throw new TemplateError(`Invalid path: ${original}`);
      if (segment.part === '..') depth += 1;
    } else parts.push(segment.part);
  }
  return { type: 'PathExpression', data, depth, parts, original };
}

function prepareBlock(
  openBlock: OpenBlock,
  given: ProgramNode,
  inverseAndProgram: InverseChain | undefined,
  close: CloseBlock | InverseChain | undefined,
  inverted: boolean
): BlockNode {
  if (close && 'path' in close) validateClose(openBlock.path, originalOf(close.path));
  const decorator = /\*/.test(String(openBlock.open));
  given.blockParams = openBlock.blockParams;
  let program: ProgramNode | undefined = given;
  let inverse: ProgramNode | undefined;
  let inverseStrip: Strip | undefined;
  if (inverseAndProgram) {
    if (decorator) throw new TemplateError('Unexpected inverse block on decorator');
    const first = inverseAndProgram.program.body[0];
    if (inverseAndProgram.chain && first.type === 'BlockStatement') first.closeStrip = close?.strip;
    inverseStrip = inverseAndProgram.strip;
    inverse = inverseAndProgram.program;
  }
  if (inverted) [program, inverse] = [inverse, program];
  return {
    type: decorator ? 'DecoratorBlock' : 'BlockStatement',
    path: openBlock.path,
    params: openBlock.params,
    hash: openBlock.hash,
    program,
    inverse,
    openStrip: openBlock.strip,
    inverseStrip,
    closeStrip: close?.strip,
  };
}

const PARAM_STARTS = new Set<TokenType>(['ID', 'DATA', 'STRING', 'NUMBER', 'BOOLEAN', 'UNDEFINED', 'NULL', 'OPEN_SEXPR']);
const PATH_FOLLOWERS = new Set<TokenType>([...PARAM_STARTS, 'CLOSE', 'CLOSE_UNESCAPED', 'CLOSE_SEXPR', 'CLOSE_RAW_BLOCK', 'OPEN_BLOCK_PARAMS']);

// --- Parser: Handlebars' grammar ------------------------------------------------------------------

class Parser {
  private index = 0;

  constructor(private readonly tokens: Token[]) {}

  parse(): ProgramNode {
    const program = this.program();
    this.expect('EOF');
    return program;
  }

  private peek(ahead = 0): Token {
    const token = this.tokens[Math.min(this.index + ahead, this.tokens.length - 1)];
    if (token.type === 'LEXICAL_ERROR') throw new TemplateError(`Lexical error on line ${token.line}. Unrecognized text.`);
    return token;
  }

  private next(): Token {
    const token = this.peek();
    this.index += 1;
    return token;
  }

  private fail(token: Token, why = `unexpected ${token.type === 'EOF' ? 'end of input' : `'${token.type}'`}`): never {
    throw new TemplateError(`Parse error on line ${token.line}: ${why}`);
  }

  private expect(type: TokenType): Token {
    const token = this.peek();
    if (token.type !== type) this.fail(token);
    return this.next();
  }

  private program(): ProgramNode {
    const body: Statement[] = [];
    for (;;) {
      const token = this.peek();
      switch (token.type) {
        case 'CONTENT':
          this.next();
          body.push({ type: 'ContentStatement', original: token.text, value: token.text });
          break;
        case 'COMMENT':
          this.next();
          body.push({ type: 'CommentStatement', strip: stripFlags(token.text, token.text) });
          break;
        case 'OPEN':
        case 'OPEN_UNESCAPED':
          body.push(this.mustache());
          break;
        case 'OPEN_BLOCK':
        case 'OPEN_INVERSE':
          body.push(this.block());
          break;
        case 'OPEN_RAW_BLOCK':
          body.push(this.rawBlock());
          break;
        case 'OPEN_PARTIAL':
          body.push(this.partial());
          break;
        case 'OPEN_PARTIAL_BLOCK':
          body.push(this.partialBlock());
          break;
        default:
          return { type: 'Program', body };
      }
    }
  }

  private mustache(): MustacheNode {
    const open = this.next();
    const path = this.helperName();
    const params = this.params();
    const hash = this.hash();
    const close = this.expect(open.type === 'OPEN' ? 'CLOSE' : 'CLOSE_UNESCAPED');
    const escapeFlag = open.text.charAt(3) || open.text.charAt(2);
    return {
      type: /\*/.test(open.text) ? 'Decorator' : 'MustacheStatement',
      path,
      params,
      hash,
      escaped: escapeFlag !== '{' && escapeFlag !== '&',
      strip: stripFlags(open.text, close.text),
    };
  }

  private block(): BlockNode {
    const openToken = this.next();
    const inverted = openToken.type === 'OPEN_INVERSE';
    const open = this.openRest(openToken);
    const program = this.program();
    let inverse: InverseChain | undefined;
    const after = this.peek().type;
    if (!inverted && (after === 'OPEN_INVERSE_CHAIN' || after === 'INVERSE')) inverse = this.inverseChain();
    else if (inverted && after === 'INVERSE') inverse = this.inverseAndProgram();
    const close = this.closeBlock(open.path);
    return prepareBlock(open, program, inverse, close, inverted);
  }

  private openRest(openToken: Token): OpenBlock {
    const path = this.helperName();
    const params = this.params();
    const hash = this.hash();
    const blockParams = this.blockParams();
    const close = this.expect('CLOSE');
    return {
      open: openToken.type === 'OPEN_BLOCK' ? openToken.text : undefined,
      path,
      params,
      hash,
      blockParams,
      strip: stripFlags(openToken.text, close.text),
    };
  }

  private inverseAndProgram(): InverseChain {
    const token = this.next();
    return { strip: stripFlags(token.text, token.text), program: this.program() };
  }

  private inverseChain(): InverseChain {
    if (this.peek().type === 'INVERSE') return this.inverseAndProgram();
    const open = this.openRest(this.next());
    const program = this.program();
    const after = this.peek().type;
    const next = after === 'OPEN_INVERSE_CHAIN' || after === 'INVERSE' ? this.inverseChain() : undefined;
    const inverse = prepareBlock(open, program, next, next, false);
    return { strip: open.strip, program: { type: 'Program', body: [inverse], chained: true }, chain: true };
  }

  private closeBlock(opened: PathNode | LiteralNode | SubExpressionNode): CloseBlock {
    const open = this.peek();
    if (open.type !== 'OPEN_ENDBLOCK') this.fail(open, `{{#${String(originalOf(opened))}}} is never closed`);
    this.next();
    const path = this.helperName();
    const close = this.expect('CLOSE');
    return { path, strip: stripFlags(open.text, close.text) };
  }

  private rawBlock(): BlockNode {
    this.next();
    const path = this.helperName();
    const params = this.params();
    const hash = this.hash();
    this.expect('CLOSE_RAW_BLOCK');
    const body: ContentNode[] = [];
    while (this.peek().type === 'CONTENT') {
      const token = this.next();
      body.push({ type: 'ContentStatement', original: token.text, value: token.text });
    }
    const end = this.expect('END_RAW_BLOCK');
    validateClose(path, end.text);
    return { type: 'BlockStatement', path, params, hash, program: { type: 'Program', body }, openStrip: {}, inverseStrip: {}, closeStrip: {} };
  }

  private partial(): PartialNode {
    const open = this.next();
    const name = this.partialName();
    const params = this.params();
    const hash = this.hash();
    const close = this.expect('CLOSE');
    return { type: 'PartialStatement', name, params, hash, indent: '', strip: stripFlags(open.text, close.text) };
  }

  private partialBlock(): PartialBlockNode {
    const open = this.next();
    const name = this.partialName();
    const params = this.params();
    const hash = this.hash();
    const close = this.expect('CLOSE');
    const program = this.program();
    const end = this.closeBlock(name);
    validateClose(name, originalOf(end.path));
    return { type: 'PartialBlockStatement', name, params, hash, program, openStrip: stripFlags(open.text, close.text), closeStrip: end.strip };
  }

  private partialName(): PathNode | LiteralNode | SubExpressionNode {
    return this.peek().type === 'OPEN_SEXPR' ? this.sexpr() : this.helperName();
  }

  private helperName(): PathNode | LiteralNode {
    const token = this.peek();
    switch (token.type) {
      case 'ID':
        return this.path(false);
      case 'DATA':
        this.next();
        return this.path(true);
      case 'STRING':
        this.next();
        return { type: 'StringLiteral', value: token.text, original: token.text };
      case 'NUMBER':
        this.next();
        return { type: 'NumberLiteral', value: Number(token.text), original: Number(token.text) };
      case 'BOOLEAN':
        this.next();
        return { type: 'BooleanLiteral', value: token.text === 'true', original: token.text === 'true' };
      case 'UNDEFINED':
        this.next();
        return { type: 'UndefinedLiteral', value: undefined, original: undefined };
      case 'NULL':
        this.next();
        return { type: 'NullLiteral', value: null, original: null };
      default:
        return this.fail(token);
    }
  }

  private path(data: boolean): PathNode {
    const first = this.expect('ID');
    const segments: Array<{ part: string; original: string; separator?: string }> = [{ part: id(first.text), original: first.text }];
    while (this.peek().type === 'SEP') {
      const separator = this.next().text;
      const segment = this.expect('ID');
      segments.push({ part: id(segment.text), original: segment.text, separator });
    }
    // Handlebars' parser makes the path once it has read what follows it, and stops there when that
    // cannot follow a path
    if (!PATH_FOLLOWERS.has(this.peek().type)) this.fail(this.peek());
    return preparePath(data, segments);
  }

  private params(): Expression[] {
    const params: Expression[] = [];
    while (PARAM_STARTS.has(this.peek().type) && !(this.peek().type === 'ID' && this.peek(1).type === 'EQUALS')) params.push(this.param());
    return params;
  }

  private param(): Expression {
    return this.peek().type === 'OPEN_SEXPR' ? this.sexpr() : this.helperName();
  }

  private hash(): HashNode | undefined {
    const pairs: HashNode['pairs'] = [];
    while (this.peek().type === 'ID' && this.peek(1).type === 'EQUALS') {
      const key = id(this.next().text);
      this.next();
      pairs.push({ key, value: this.param() });
    }
    return pairs.length > 0 ? { pairs } : undefined;
  }

  private sexpr(): SubExpressionNode {
    this.expect('OPEN_SEXPR');
    const path = this.helperName();
    const params = this.params();
    const hash = this.hash();
    this.expect('CLOSE_SEXPR');
    return { type: 'SubExpression', path, params, hash };
  }

  private blockParams(): string[] | undefined {
    if (this.peek().type !== 'OPEN_BLOCK_PARAMS') return undefined;
    this.next();
    const names = [this.expect('ID').text];
    while (this.peek().type === 'ID') names.push(this.next().text);
    this.expect('CLOSE_BLOCK_PARAMS');
    // Handlebars reads the list as one name, and fails on one that looks like `[a]`
    if (/^\[.*\]$/.test(names.join(','))) throw new TemplateError('token.substring is not a function');
    return names;
  }
}

// --- Whitespace: `~`, and the lines that hold only a block's tag, a comment or a partial --------

interface Standalone extends Strip {
  openStandalone?: boolean;
  closeStandalone?: boolean;
  inlineStandalone?: boolean;
}

function isPrevWhitespace(body: Statement[], at: number = body.length, isRoot?: boolean): boolean | undefined {
  const prev = body[at - 1];
  const sibling = body[at - 2];
  if (!prev) return isRoot;
  if (prev.type === 'ContentStatement') return (sibling || !isRoot ? /\r?\n\s*?$/ : /(^|\r?\n)\s*?$/).test(prev.original);
  return undefined;
}

function isNextWhitespace(body: Statement[], at = -1, isRoot?: boolean): boolean | undefined {
  const next = body[at + 1];
  const sibling = body[at + 2];
  if (!next) return isRoot;
  if (next.type === 'ContentStatement') return (sibling || !isRoot ? /^\s*?\r?\n/ : /^\s*?(\r?\n|$)/).test(next.original);
  return undefined;
}

function omitRight(body: Statement[], at: number | null = null, multiple = false) {
  const current = body[at === null ? 0 : at + 1];
  if (!current || current.type !== 'ContentStatement' || (!multiple && current.rightStripped)) return;
  const original = current.value;
  current.value = current.value.replace(multiple ? /^\s+/ : /^[ \t]*\r?\n?/, '');
  current.rightStripped = current.value !== original;
}

function omitLeft(body: Statement[], at: number | null = null, multiple = false): boolean | undefined {
  const current = body[at === null ? body.length - 1 : at - 1];
  if (!current || current.type !== 'ContentStatement' || (!multiple && current.leftStripped)) return undefined;
  const original = current.value;
  current.value = current.value.replace(multiple ? /\s+$/ : /[ \t]+$/, '');
  current.leftStripped = current.value !== original;
  return current.leftStripped;
}

function controlWhitespace(root: ProgramNode): ProgramNode {
  let rootSeen = false;

  const program = (node: ProgramNode | undefined) => {
    if (!node) return;
    const isRoot = !rootSeen;
    rootSeen = true;
    const body = node.body;
    for (let at = 0; at < body.length; at++) {
      const current = body[at];
      const strip = statement(current);
      if (!strip) continue;
      const prevWhitespace = isPrevWhitespace(body, at, isRoot);
      const nextWhitespace = isNextWhitespace(body, at, isRoot);
      const openStandalone = strip.openStandalone && prevWhitespace;
      const closeStandalone = strip.closeStandalone && nextWhitespace;
      const inlineStandalone = strip.inlineStandalone && prevWhitespace && nextWhitespace;
      if (strip.close) omitRight(body, at, true);
      if (strip.open) omitLeft(body, at, true);
      if (inlineStandalone) {
        omitRight(body, at);
        if (omitLeft(body, at) && current.type === 'PartialStatement') {
          const previous = body[at - 1];
          current.indent = (previous.type === 'ContentStatement' && /([ \t]+$)/.exec(previous.original)?.[1]) || '';
        }
      }
      if (current.type === 'BlockStatement' || current.type === 'DecoratorBlock' || current.type === 'PartialBlockStatement') {
        const inverse = current.type === 'PartialBlockStatement' ? undefined : current.inverse;
        if (openStandalone) {
          omitRight((current.program || inverse)?.body ?? []);
          omitLeft(body, at);
        }
        if (closeStandalone) {
          omitRight(body, at);
          omitLeft((inverse || current.program)?.body ?? []);
        }
      }
    }
  };

  const block = (node: BlockNode | PartialBlockNode): Standalone => {
    const given = node.type === 'PartialBlockStatement' ? undefined : node.inverse;
    program(node.program);
    program(given);
    const main = node.program || given;
    const inverse = node.program && given;
    let firstInverse = inverse;
    let lastInverse = inverse;
    if (inverse && inverse.chained) {
      const first = inverse.body[0];
      firstInverse = first.type === 'BlockStatement' ? first.program : undefined;
      while (lastInverse && lastInverse.chained) {
        const last = lastInverse.body[lastInverse.body.length - 1];
        lastInverse = last.type === 'BlockStatement' ? last.program : undefined;
      }
    }
    const mainBody = main?.body ?? [];
    const strip: Standalone = {
      open: node.openStrip.open,
      close: node.closeStrip?.close,
      openStandalone: isNextWhitespace(mainBody),
      closeStandalone: isPrevWhitespace((firstInverse || main)?.body ?? []),
    };
    if (node.openStrip.close) omitRight(mainBody, null, true);
    if (inverse) {
      const inverseStrip = node.type === 'PartialBlockStatement' ? undefined : node.inverseStrip;
      if (inverseStrip?.open) omitLeft(mainBody, null, true);
      if (inverseStrip?.close) omitRight(firstInverse?.body ?? [], null, true);
      if (node.closeStrip?.open) omitLeft(lastInverse?.body ?? [], null, true);
      // A lone {{else}} on its line
      if (isPrevWhitespace(mainBody) && isNextWhitespace(firstInverse?.body ?? [])) {
        omitLeft(mainBody);
        omitRight(firstInverse?.body ?? []);
      }
    } else if (node.closeStrip?.open) omitLeft(mainBody, null, true);
    return strip;
  };

  const statement = (node: Statement): Standalone | undefined => {
    switch (node.type) {
      case 'BlockStatement':
      case 'DecoratorBlock':
      case 'PartialBlockStatement':
        return block(node);
      case 'MustacheStatement':
      case 'Decorator':
        return node.strip;
      case 'PartialStatement':
      case 'CommentStatement':
        return { inlineStandalone: true, open: node.strip.open, close: node.strip.close };
      default:
        return undefined;
    }
  };

  program(root);
  return root;
}

function parse(template: string): ProgramNode {
  return controlWhitespace(new Parser(tokenize(template)).parse());
}

// --- Running a template ---------------------------------------------------------------------------

interface DataFrame {
  [key: string]: unknown;
  _parent?: DataFrame;
}

interface RunOptions {
  data?: DataFrame;
  blockParams?: unknown[];
}

type ProgramFn = ((context: unknown, options?: RunOptions) => string) & { partials?: Record<string, ProgramFn | undefined> };

interface HelperOptions extends RunOptions {
  name: string;
  hash: Record<string, unknown>;
  fn?: ProgramFn;
  inverse?: ProgramFn;
}

const noop: ProgramFn = () => '';

const KNOWN_HELPERS = new Set(['helperMissing', 'blockHelperMissing', 'each', 'if', 'unless', 'with', 'log', 'lookup']);

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;', '`': '&#x60;', '=': '&#x3D;' };

const escapeExpression = (text: string) => text.replace(/[&<>"'`=]/g, (char) => ESCAPES[char] ?? char);

/** A value as the text it is joined into the output with, as JavaScript joins a list */
const joinText = (value: unknown): string => (value === undefined || value === null ? '' : String(value));

const createFrame = (data: DataFrame | undefined): DataFrame => ({ ...data, _parent: data });

const isEmpty = (value: unknown) => (!value && value !== 0) || (Array.isArray(value) && value.length === 0);

const scopedId = (path: PathNode) => /^\.|this\b/.test(path.original);

/** A property as Handlebars reads one: its own properties only, and none of an absent value */
function lookupProperty(parent: unknown, name: unknown): unknown {
  const key = String(name);
  if (parent === null || parent === undefined) throw new TemplateError(`Cannot read properties of ${String(parent)} (reading '${key}')`);
  const value = (Object(parent) as Record<string, unknown>)[key];
  if (value === null || value === undefined) return value;
  return Object.prototype.hasOwnProperty.call(parent, key) ? value : undefined;
}

/** The last part of a path in strict mode: an absent one stops the template */
function strictProperty(parent: unknown, name: string | undefined): unknown {
  if (!parent) throw new TemplateError(`"${String(name)}" not defined in ${String(parent)}`);
  if (typeof parent !== 'object' && typeof parent !== 'function') {
    throw new TemplateError(`Cannot use 'in' operator to search for '${String(name)}' in ${String(parent)}`);
  }
  if (!(String(name) in parent)) throw new TemplateError(`"${String(name)}" not defined in ${String(parent)}`);
  return lookupProperty(parent, name);
}

const literalPath = (node: LiteralNode): PathNode => ({
  type: 'PathExpression',
  data: false,
  depth: 0,
  parts: [String(node.original)],
  original: String(node.original),
});

class Interpreter {
  private contexts: unknown[] = [];
  private run: RunOptions = {};
  private readonly blockParamNames: Array<string[] | undefined> = [];
  private readonly blockParamValues: unknown[][] = [];
  private partials: Record<string, ProgramFn | undefined> = {};
  private readonly decorated = new Set<ProgramNode>();
  private rootDecorated = false;

  constructor(
    private readonly root: ProgramNode,
    private readonly strict: boolean
  ) {}

  render(context: unknown): string {
    this.contexts = [context];
    this.run = { data: { root: context } };
    const main: ProgramFn = (given) => this.programFn(this.root)(given, this.run);
    const decorated = this.decorate(this.root, main);
    this.rootDecorated = true;
    return decorated(this.context);
  }

  private get context(): unknown {
    return this.contexts[0];
  }

  private programFn(program: ProgramNode): ProgramFn {
    return (nextContext, given = {}) => {
      const run: RunOptions = { ...given, data: given.data || this.run.data };
      const saved = this.run;
      this.run = run;
      const shift = nextContext !== this.context;
      if (shift) this.contexts.unshift(nextContext);
      this.blockParamValues.unshift(run.blockParams ?? []);
      this.blockParamNames.unshift(program.blockParams);
      let text = '';
      for (const node of program.body) text += joinText(this.statement(node));
      this.blockParamNames.shift();
      this.blockParamValues.shift();
      if (shift) this.contexts.shift();
      this.run = saved;
      return text;
    };
  }

  private statement(node: Statement): unknown {
    switch (node.type) {
      case 'ContentStatement':
        return node.value;
      case 'MustacheStatement':
      case 'BlockStatement':
        return this.node(node);
      case 'PartialStatement':
      case 'PartialBlockStatement':
        return this.partial(node);
      default:
        // Comments, and decorators, which were run before the program
        return undefined;
    }
  }

  private pathOf(node: MustacheNode | BlockNode | SubExpressionNode): PathNode {
    if (node.path.type !== 'PathExpression') node.path = literalPath(node.path);
    return node.path;
  }

  /** A value, section, helper or sub-expression */
  private node(node: MustacheNode | BlockNode | SubExpressionNode): unknown {
    const path = this.pathOf(node);
    const block = node.type === 'BlockStatement';
    const escaped = node.type === 'MustacheStatement' && node.escaped;
    const isSimple = path.parts.length === 1 && !scopedId(path) && !path.depth;
    const isBlockParam = isSimple && this.blockParamIndex(path.parts[0]) !== undefined;
    const helperExpression = node.type === 'SubExpression' || node.params.length > 0 || Boolean(node.hash);
    const isHelper = !isBlockParam && (helperExpression || (isSimple && KNOWN_HELPERS.has(path.parts[0])));
    let result: unknown;
    if (isHelper) {
      const name = path.parts[0];
      if (!KNOWN_HELPERS.has(name)) throw new TemplateError(`You specified knownHelpersOnly, but used the unknown helper ${name}`);
      const context = this.context;
      const params = node.params.map((param) => this.expression(param));
      const options = this.setupParams(node, name);
      result = this.helper(name, context, [...params, options]);
    } else {
      path.strict = true;
      const value = this.expression(path);
      if (block) return this.blockHelperMissing(this.context, value, this.setupParams(node, path.original));
      result = value;
    }
    return escaped && typeof result === 'string' ? escapeExpression(result) : result;
  }

  private expression(node: Expression): unknown {
    if (node.type === 'PathExpression') return this.pathValue(node);
    if (node.type === 'SubExpression') return this.node(node);
    return node.value;
  }

  private blockParamIndex(name: string | undefined): [number, number] | undefined {
    for (let depth = 0; depth < this.blockParamNames.length; depth++) {
      const names = this.blockParamNames[depth];
      const param = names && name !== undefined ? names.indexOf(name) : -1;
      if (names && param >= 0) return [depth, param];
    }
    return undefined;
  }

  private pathValue(path: PathNode): unknown {
    const blockParam = !path.depth && !scopedId(path) ? this.blockParamIndex(path.parts[0]) : undefined;
    if (blockParam) {
      // The value of a block parameter, then the rest of the path within it, as Handlebars reads it
      let value = this.blockParamValues[blockParam[0]]?.[blockParam[1]];
      for (const part of path.parts.slice(1)) {
        if (!this.strict && (value === null || value === undefined)) return undefined;
        value = lookupProperty(value, part);
      }
      return value;
    }
    if (path.data) {
      let data: DataFrame | undefined = this.run.data;
      for (let depth = path.depth; data && depth > 0; depth--) data = data._parent;
      return this.resolve(data, path);
    }
    return this.resolve(this.contexts[path.depth], path);
  }

  private resolve(from: unknown, path: PathNode): unknown {
    let value = from;
    if (!this.strict) {
      for (const part of path.parts) {
        if (value === null || value === undefined) return undefined;
        value = lookupProperty(value, part);
      }
      return value;
    }
    const requireTerminal = Boolean(path.strict);
    // A reference to the context itself is the context, as in Handlebars
    if (requireTerminal && path.parts.length === 0 && !path.data) return value;
    const length = path.parts.length - (requireTerminal ? 1 : 0);
    for (let at = 0; at < length; at++) value = lookupProperty(value, path.parts[at]);
    return requireTerminal ? strictProperty(value, path.parts[length]) : value;
  }

  private hashOf(hash: HashNode | undefined): Record<string, unknown> {
    const values: Record<string, unknown> = {};
    for (const pair of hash?.pairs ?? []) values[pair.key] = this.expression(pair.value);
    return values;
  }

  private setupParams(node: MustacheNode | BlockNode | SubExpressionNode | PartialNode | PartialBlockNode, name: string): HelperOptions {
    const options: HelperOptions = { name, hash: this.hashOf(node.hash), data: this.run.data };
    if (node.type === 'BlockStatement' || node.type === 'DecoratorBlock' || node.type === 'PartialBlockStatement') {
      options.fn = node.program ? this.decorate(node.program, this.programFn(node.program)) : noop;
      const inverse = node.type === 'PartialBlockStatement' ? undefined : node.inverse;
      options.inverse = inverse ? this.decorate(inverse, this.programFn(inverse)) : noop;
    }
    return options;
  }

  /** The decorators of a program, run once before it: `inline` is the only one there is */
  private decorate(program: ProgramNode, given: ProgramFn): ProgramFn {
    if (this.decorated.has(program)) return given;
    this.decorated.add(program);
    let result = given;
    const props: { partials?: Record<string, ProgramFn | undefined> } = {};
    for (const node of program.body) {
      if (node.type !== 'Decorator' && node.type !== 'DecoratorBlock') continue;
      const name = String(originalOf(node.path));
      const options = this.setupParams(node, name);
      let args: unknown[] = [];
      if (node.params.length > 0) {
        if (this.rootDecorated) args = node.params.map((param) => this.expression(param));
        else {
          // The decorators of the whole template do not see its values
          const context = this.contexts.shift();
          args = node.params.map((param) => this.expression(param));
          this.contexts.unshift(context);
        }
      }
      if (name !== 'inline') throw new TemplateError(`decorator ${name} is not a function`);
      const fn = result;
      let partials = props.partials;
      if (!partials) {
        const inline: Record<string, ProgramFn | undefined> = {};
        partials = inline;
        props.partials = inline;
        // The partials are known while the program runs
        result = (context, runOptions) => {
          const outer = this.partials;
          this.partials = { ...outer, ...inline };
          const text = fn(context, runOptions);
          this.partials = outer;
          return text;
        };
      }
      partials[String(args[0])] = options.fn;
      result = Object.assign(result, props);
    }
    return result;
  }

  private partial(node: PartialNode | PartialBlockNode): string {
    if (node.params.length > 1) throw new TemplateError(`Unsupported number of partial arguments: ${node.params.length}`);
    const name = node.name.type === 'SubExpression' ? joinText(this.node(node.name)) : String(node.name.original);
    const options = this.setupParams(node, name);
    let partials = this.partials;
    let partialBlock: ProgramFn | undefined;
    const fn = options.fn;
    if (fn && fn !== noop) {
      const outerBlock = options.data?.['partial-block'];
      const data = createFrame(options.data);
      options.data = data;
      partialBlock = (context, wrapperOptions = {}) => {
        const wrapped = createFrame(wrapperOptions.data);
        wrapped['partial-block'] = outerBlock;
        return fn(context, { ...wrapperOptions, data: wrapped });
      };
      data['partial-block'] = partialBlock;
      if (fn.partials) partials = { ...partials, ...fn.partials };
    }
    let context: unknown = node.params.length === 0 ? this.context : this.expression(node.params[0]);
    if (Object.keys(options.hash).length > 0) context = Object.assign({}, context, options.hash);
    const own = (from: Record<string, ProgramFn | undefined>) => (Object.prototype.hasOwnProperty.call(from, name) ? from[name] : undefined);
    const found = name === '@partial-block' ? options.data?.['partial-block'] : own(partials);
    const template = own(this.partials) ?? partialBlock ?? (typeof found === 'function' ? (found as ProgramFn) : undefined);
    if (!template) throw new TemplateError(`The partial ${name} could not be found`);
    const result = template(context, options);
    if (node.type !== 'PartialStatement') return result;
    return node.indent + result.replace(/\n(?!$)/g, `\n${node.indent}`);
  }

  private blockHelperMissing(self: unknown, context: unknown, options: HelperOptions): unknown {
    if (context === true) return this.callProgram(options.fn, self, 'fn');
    if (context === false || context === null || context === undefined) return this.callProgram(options.inverse, self, 'inverse');
    if (Array.isArray(context)) return context.length > 0 ? this.each(self, [context, options]) : this.callProgram(options.inverse, self, 'inverse');
    return this.callProgram(options.fn, context, 'fn', options);
  }

  private callProgram(fn: ProgramFn | undefined, context: unknown, what: string, runOptions?: RunOptions): string {
    if (!fn) throw new TemplateError(`options.${what} is not a function`);
    return fn(context, runOptions);
  }

  /** The built-in helpers, each given its values and then its options, as Handlebars calls them */
  private helper(name: string, self: unknown, argv: unknown[]): unknown {
    const options = argv[argv.length - 1] as HelperOptions;
    switch (name) {
      case 'each':
        return this.each(self, argv);
      case 'if':
        if (argv.length !== 2) throw new TemplateError('#if requires exactly one argument');
        return this.ifHelper(self, argv[0], options.fn, options.inverse, options.hash);
      case 'unless':
        if (argv.length !== 2) throw new TemplateError('#unless requires exactly one argument');
        return this.ifHelper(self, argv[0], options.inverse, options.fn, options.hash);
      case 'with': {
        if (argv.length !== 2) throw new TemplateError('#with requires exactly one argument');
        const context = argv[0];
        if (!isEmpty(context)) return this.callProgram(options.fn, context, 'fn', { data: options.data, blockParams: [context] });
        return this.callProgram(options.inverse, self, 'inverse');
      }
      case 'lookup': {
        const [object, field] = argv;
        if (!object) return object;
        if (argv.length !== 3) throw new TemplateError('lookup needs an object and the name of a value in it');
        return lookupProperty(object, field);
      }
      case 'log':
        // Written to the browser's console by the product: nothing in the text
        return undefined;
      default:
        // helperMissing and blockHelperMissing are not helpers one can call
        throw new TemplateError("Cannot read properties of undefined (reading 'call')");
    }
  }

  private ifHelper(self: unknown, conditional: unknown, fn: ProgramFn | undefined, inverse: ProgramFn | undefined, hash: Record<string, unknown>): string {
    if ((!hash.includeZero && !conditional) || isEmpty(conditional)) return this.callProgram(inverse, self, 'inverse');
    return this.callProgram(fn, self, 'fn');
  }

  private each(self: unknown, argv: unknown[]): string {
    if (!argv[1]) throw new TemplateError('Must pass iterator to #each');
    // Two values or more: the second is taken for the options, and has no blocks to run
    if (argv.length !== 2) throw new TemplateError('fn is not a function');
    const context = argv[0];
    const options = argv[1] as HelperOptions;
    let text = '';
    let count = 0;
    const data = options.data ? createFrame(options.data) : undefined;
    const iterate = (field: string | number, index: number, last: boolean) => {
      if (data) {
        data.key = field;
        data.index = index;
        data.first = index === 0;
        data.last = last;
      }
      const item = (context as Record<string | number, unknown>)[field];
      text += this.callProgram(options.fn, item, 'fn', { data, blockParams: [item, field] });
    };
    if (context && typeof context === 'object') {
      if (Array.isArray(context)) {
        for (; count < context.length; count++) if (count in context) iterate(count, count, count === context.length - 1);
      } else {
        let prior: string | undefined;
        for (const key of Object.keys(context)) {
          if (prior !== undefined) iterate(prior, count - 1, false);
          prior = key;
          count += 1;
        }
        if (prior !== undefined) iterate(prior, count - 1, true);
      }
    }
    if (count === 0) text = this.callProgram(options.inverse, self, 'inverse');
    return text;
  }
}

export interface TemplateOptions {
  /** As a Markdown panel's: a name with no value stops the text, where otherwise it is left empty */
  strict?: boolean;
}

/** A template read once, to fill in as often as needed; one that cannot be read fails each time */
export function compileTemplate(template: string, options: TemplateOptions = {}): (scope: unknown) => string {
  let program: ProgramNode | undefined;
  let failure: TemplateError | undefined;
  try {
    program = parse(template);
  } catch (error) {
    if (!(error instanceof TemplateError)) throw error;
    failure = error;
  }
  return (scope) => {
    if (failure || !program) throw failure ?? new TemplateError('Parse error: no template');
    return new Interpreter(program, Boolean(options.strict)).render(scope);
  };
}

/** The text filled in from the scope */
export function renderTemplate(template: string, scope: unknown, options: TemplateOptions = {}): string {
  return compileTemplate(template, options)(scope);
}

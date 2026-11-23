/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Where the cursor is in a Timeline expression and what could be typed there: the browser's own
 * reading of the grammar `chain.peg` of OpenSearch Dashboards, with the same side effects in the
 * same order as the generated parser (a function's name resets the arguments seen so far, an
 * incomplete function or argument stops the parse with a JSON message), and upstream's
 * `suggest` and `getSuggestion` on top of it.
 */

// --- What the server describes ----------------------------------------------------------------

export interface TimelineArgSuggestion {
  name: string;
  help?: string;
}

export interface TimelineFunctionArg {
  name: string;
  help?: string;
  multi?: boolean;
  types?: string[];
  suggestions?: TimelineArgSuggestion[];
}

export interface TimelineFunction {
  name: string;
  help?: string;
  chainable?: boolean;
  args: TimelineFunctionArg[];
  aliases?: string[];
  isAlias?: boolean;
  extended?: boolean;
}

// --- The parser ---------------------------------------------------------------------------------

export interface Location {
  min: number;
  max: number;
}

export interface ParsedValue {
  type: string;
  value?: unknown;
  location?: Location;
  text?: string;
  [key: string]: unknown;
}

export interface FunctionArg {
  type: string;
  name?: string;
  value?: ParsedValue;
  location?: Location;
  text?: string;
  function?: string;
  [key: string]: unknown;
}

export interface ParsedFunction {
  type: 'function';
  function: string;
  arguments: FunctionArg[];
  location: Location;
  text: string;
}

export interface ParseResult {
  tree: unknown[];
  functions: ParsedFunction[];
  args: FunctionArg[];
  variables: Record<string, unknown>;
}

const FAIL = Symbol('fail');
type Parsed<T> = T | typeof FAIL;

const SPACE = /[ \t\r\n]/;
const NAME_FIRST = /[a-zA-Z]/;
const NAME_REST = /[.a-zA-Z0-9_-]/;
const LITERAL_CHAR = /[^()"',= \t]/;

class ChainParser {
  private pos = 0;
  private currentFunction: string | undefined;
  private currentArgs: FunctionArg[] = [];
  private readonly functions: ParsedFunction[] = [];
  private readonly args: FunctionArg[] = [];
  private readonly variables: Record<string, unknown> = {};

  constructor(private readonly input: string) {}

  parse(): ParseResult {
    const result = this.start();
    if (result === FAIL || this.pos !== this.input.length) {
      throw new SyntaxError(`Expected end of input but "${this.input.charAt(this.pos)}" found.`);
    }
    return result;
  }

  // An action's `error()`: the parse ends there, with that message
  private error(message: string): never {
    throw new Error(message);
  }

  private exception(fields: Record<string, unknown>, start: number): never {
    this.error(
      JSON.stringify({
        ...fields,
        location: { min: start, max: this.pos },
        text: this.input.slice(start, this.pos),
      })
    );
  }

  private char(text: string): boolean {
    if (this.input.startsWith(text, this.pos)) {
      this.pos += text.length;
      return true;
    }
    return false;
  }

  private run(pattern: RegExp): string {
    const start = this.pos;
    while (this.pos < this.input.length && pattern.test(this.input[this.pos])) this.pos += 1;
    return this.input.slice(start, this.pos);
  }

  /** `space?`: never fails */
  private space() {
    this.run(SPACE);
  }

  /** Tries a rule, and puts the position back when it does not match */
  private attempt<T>(rule: () => Parsed<T>): Parsed<T> {
    const start = this.pos;
    const result = rule();
    if (result === FAIL) this.pos = start;
    return result;
  }

  private start(): Parsed<ParseResult> {
    this.space();
    const tree = this.series();
    if (tree === FAIL) return FAIL;
    return {
      tree: tree.filter((item) => item != null),
      functions: this.functions,
      args: this.args,
      variables: this.variables,
    };
  }

  private argList(): Parsed<FunctionArg[]> {
    const first = this.argument();
    if (first === FAIL) return FAIL;
    const list = [first];
    for (;;) {
      const next = this.attempt(() => {
        this.space();
        if (!this.char(',')) return FAIL;
        this.space();
        return this.argument();
      });
      if (next === FAIL) break;
      list.push(next);
    }
    this.space();
    this.char(',');
    return list;
  }

  private argument(): Parsed<FunctionArg> {
    const start = this.pos;
    // name:argument_name space? '=' space? value:arg_type
    const named = this.attempt<FunctionArg>(() => {
      const name = this.argumentName();
      if (name === FAIL) return FAIL;
      this.space();
      if (!this.char('=')) return FAIL;
      this.space();
      const value = this.argType();
      if (value === FAIL) return FAIL;
      const arg: FunctionArg = {
        type: 'namedArg',
        name,
        value: value as ParsedValue,
        location: { min: start, max: this.pos },
        text: this.input.slice(start, this.pos),
      };
      this.currentArgs.push(arg);
      return arg;
    });
    if (named !== FAIL) return named;

    // space? '=' space? value:arg_type?
    this.space();
    if (this.char('=')) {
      this.space();
      this.attempt(() => this.argType());
      this.exception(
        { type: 'incompleteArgument', currentArgs: this.currentArgs, currentFunction: this.currentFunction },
        start
      );
    }
    this.pos = start;

    // name:argument_name space? '='
    const name = this.argumentName();
    if (name !== FAIL) {
      this.space();
      if (this.char('=')) {
        this.exception(
          {
            type: 'incompleteArgumentValue',
            currentArgs: this.currentArgs,
            currentFunction: this.currentFunction,
            name,
          },
          start
        );
      }
    }
    this.pos = start;

    // element:arg_type
    return this.attempt(() => this.argType()) as Parsed<FunctionArg>;
  }

  private argType(): Parsed<unknown> {
    const variable = this.attempt(() => this.variableGet());
    if (variable !== FAIL) return variable;
    const series = this.attempt(() => this.seriesType());
    if (series !== FAIL) return series;
    const start = this.pos;
    const literal = this.literal();
    if (literal === FAIL) {
      this.pos = start;
      return FAIL;
    }
    return {
      type: 'literal',
      value: literal,
      location: { min: start, max: this.pos },
      text: this.input.slice(start, this.pos),
    };
  }

  private variableGet(): Parsed<unknown> {
    if (!this.char('$')) return FAIL;
    const name = this.argumentName();
    if (name === FAIL) return FAIL;
    if (this.variables[name]) return this.variables[name];
    return this.error(`$${name} is not defined`);
  }

  private variableSet(): Parsed<undefined> {
    if (!this.char('$')) return FAIL;
    const name = this.argumentName();
    if (name === FAIL) return FAIL;
    this.space();
    if (!this.char('=')) return FAIL;
    this.space();
    const value = this.argType();
    if (value === FAIL) return FAIL;
    this.variables[name] = value;
    return undefined;
  }

  private seriesType(): Parsed<unknown> {
    for (const rule of [
      () => this.variableSet(),
      () => this.variableGet(),
      () => this.group(),
      () => this.chain(),
      () => this.reference(),
    ]) {
      const result = this.attempt<unknown>(rule);
      if (result !== FAIL) return result;
    }
    return FAIL;
  }

  private series(): Parsed<unknown[]> {
    const first = this.seriesType();
    if (first === FAIL) return FAIL;
    const list = [first];
    for (;;) {
      const next = this.attempt(() => {
        this.space();
        if (!this.char(',')) return FAIL;
        this.space();
        return this.seriesType();
      });
      if (next === FAIL) break;
      list.push(next);
    }
    this.char(',');
    return list;
  }

  private name(): Parsed<string> {
    if (this.pos >= this.input.length || !NAME_FIRST.test(this.input[this.pos])) return FAIL;
    const first = this.run(NAME_FIRST);
    return first + this.run(NAME_REST);
  }

  private functionName(): Parsed<string> {
    const name = this.name();
    if (name === FAIL) return FAIL;
    this.currentFunction = name;
    this.currentArgs = [];
    return name;
  }

  private argumentName(): Parsed<string> {
    return this.name();
  }

  private func(): Parsed<ParsedFunction> {
    const start = this.pos;
    const complete = this.attempt<ParsedFunction>(() => {
      this.space();
      if (!this.char('.')) return FAIL;
      const name = this.functionName();
      if (name === FAIL) return FAIL;
      this.space();
      if (!this.char('(')) return FAIL;
      this.space();
      const list = this.attempt(() => this.argList());
      this.space();
      if (!this.char(')')) return FAIL;
      this.space();
      const result: ParsedFunction = {
        type: 'function',
        function: name,
        arguments: list === FAIL ? [] : list,
        location: { min: start, max: this.pos },
        text: this.input.slice(start, this.pos),
      };
      for (const arg of result.arguments) {
        arg.function = name;
        this.args.push(arg);
      }
      this.functions.push(result);
      return result;
    });
    if (complete !== FAIL) return complete;

    // '.' func:function_name?
    if (!this.char('.')) return FAIL;
    const name = this.attempt(() => this.functionName());
    return this.exception({ type: 'incompleteFunction', function: name === FAIL ? null : name }, start);
  }

  private reference(): Parsed<unknown> {
    if (!this.char('@')) return FAIL;
    const plot = this.integer();
    if (plot === FAIL) return FAIL;
    const series = this.attempt(() => (this.char(':') ? this.integer() : FAIL));
    return series === FAIL ? { type: 'reference', plot } : { type: 'reference', plot, series };
  }

  private chain(): Parsed<unknown> {
    const first = this.func();
    if (first === FAIL) return FAIL;
    this.space();
    const chain: unknown[] = [first];
    for (;;) {
      const next = this.attempt(() => this.func());
      if (next === FAIL) break;
      chain.push(next);
    }
    return { type: 'chain', chain };
  }

  private group(): Parsed<unknown> {
    const start = this.pos;
    if (!this.char('(')) return FAIL;
    this.space();
    const grouped = this.series();
    if (grouped === FAIL) return FAIL;
    this.space();
    if (!this.char(')')) return FAIL;
    const functions: unknown[] = [];
    for (;;) {
      const next = this.attempt(() => this.func());
      if (next === FAIL) break;
      functions.push(next);
    }
    const first = { type: 'chainList', list: grouped, label: this.input.slice(start, this.pos) };
    return { type: 'chain', chain: [first, ...functions] };
  }

  private quoted(quote: string): Parsed<string> {
    if (!this.char(quote)) return FAIL;
    let chars = '';
    for (;;) {
      if (this.pos >= this.input.length) return FAIL;
      const here = this.input[this.pos];
      const next = this.input[this.pos + 1];
      if (here === '\\' && (next === quote || next === '\\')) {
        chars += next;
        this.pos += 2;
      } else if (here === quote) {
        this.pos += 1;
        return chars;
      } else {
        chars += here;
        this.pos += 1;
      }
    }
  }

  private literal(): Parsed<string | number | boolean | null> {
    for (const quote of ['"', "'"]) {
      const text = this.attempt(() => this.quoted(quote));
      if (text !== FAIL) return text;
    }
    if (this.char('true')) return true;
    if (this.char('false')) return false;
    if (this.char('null')) return null;
    const text = this.run(LITERAL_CHAR);
    if (text === '') return FAIL;
    // this also matches numbers via Number()
    return Number.isNaN(Number(text)) ? text : Number(text);
  }

  private integer(): Parsed<number> {
    const digits = this.run(/[0-9]/);
    return digits === '' ? FAIL : Number.parseInt(digits, 10);
  }
}

/**
 * Reads an expression as upstream's generated parser does: the parse result, or an Error whose
 * message is JSON when the expression is incomplete in a way that suggestions can follow.
 */
export function parseExpression(expression: string): ParseResult {
  return new ChainParser(expression).parse();
}

// --- What could be typed at the cursor ----------------------------------------------------------

export enum SUGGESTION_TYPE {
  ARGUMENTS = 'arguments',
  ARGUMENT_VALUE = 'argument_value',
  FUNCTIONS = 'functions',
}

export type SuggestionEntry = TimelineFunction | TimelineFunctionArg | TimelineArgSuggestion;

export interface Suggestions {
  list: SuggestionEntry[];
  type: SUGGESTION_TYPE;
}

/** The values an argument can take that the browser looks up: index patterns and their fields */
export interface ArgValueSuggestions {
  hasDynamicSuggestionsForArgument(functionName: string, argName: string): boolean;
  getDynamicSuggestionsForArgument(
    functionName: string,
    argName: string,
    functionArgs: FunctionArg[],
    partialInput?: string
  ): Promise<TimelineArgSuggestion[]>;
  getStaticSuggestionsForInput(
    partialInput?: string,
    staticSuggestions?: TimelineArgSuggestion[]
  ): TimelineArgSuggestion[];
}

function inLocation(cursorPosition: number, location: Location | undefined) {
  // A value without a place (a chain given as an argument) ends the search, as upstream's does
  if (!location) throw new TypeError('The value has no location');
  return cursorPosition >= location.min && cursorPosition <= location.max;
}

function getArgumentsHelp(functionHelp: TimelineFunction | undefined, functionArgs: FunctionArg[] = []) {
  if (!functionHelp) return [];
  // Do not provide 'inputSeries' as argument suggestion for chainable functions
  const argsHelp = functionHelp.chainable ? functionHelp.args.slice(1) : functionHelp.args.slice(0);
  // ignore arguments that are already provided in function declaration
  const functionArgNames = functionArgs.map((arg) => arg.name);
  return argsHelp.filter((arg) => !functionArgNames.includes(arg.name));
}

async function extractSuggestionsFromParsedResult(
  result: ParseResult,
  cursorPosition: number,
  functionList: TimelineFunction[],
  argValueSuggestions: ArgValueSuggestions
): Promise<Suggestions | undefined> {
  const activeFunc = result.functions.find(({ location }) => inLocation(cursorPosition, location));
  if (!activeFunc) return undefined;

  const functionHelp = functionList.find(({ name }) => name === activeFunc.function);
  if (!functionHelp) return undefined;

  // return function suggestion when cursor is outside of parentheses
  // location range includes '.', function name, and '('.
  const openParen = activeFunc.location.min + activeFunc.function.length + 2;
  if (cursorPosition < openParen) {
    return { list: [functionHelp], type: SUGGESTION_TYPE.FUNCTIONS };
  }

  // return argument value suggestions when cursor is inside argument value
  const activeArg = activeFunc.arguments.find((argument) => inLocation(cursorPosition, argument.location));
  if (activeArg && activeArg.type === 'namedArg' && inLocation(cursorPosition, activeArg.value?.location)) {
    const { function: functionName, arguments: functionArgs } = activeFunc;
    const argName = String(activeArg.name);
    const partialInput = activeArg.value?.text;

    let valueSuggestions: TimelineArgSuggestion[];
    if (argValueSuggestions.hasDynamicSuggestionsForArgument(functionName, argName)) {
      valueSuggestions = await argValueSuggestions.getDynamicSuggestionsForArgument(
        functionName,
        argName,
        functionArgs,
        partialInput
      );
    } else {
      const { suggestions: staticSuggestions } = functionHelp.args.find((arg) => arg.name === activeArg.name) ?? {};
      valueSuggestions = argValueSuggestions.getStaticSuggestionsForInput(partialInput, staticSuggestions);
    }
    return { list: valueSuggestions, type: SUGGESTION_TYPE.ARGUMENT_VALUE };
  }

  // return argument suggestions
  const argsHelp = getArgumentsHelp(functionHelp, activeFunc.arguments);
  const argumentSuggestions = argsHelp.filter((arg) => {
    if (activeArg?.type === 'namedArg') return arg.name.startsWith(String(activeArg.name));
    if (activeArg) return arg.name.startsWith(String(activeArg.text));
    return true;
  });
  return { list: argumentSuggestions, type: SUGGESTION_TYPE.ARGUMENTS };
}

interface ParseMessage {
  type?: string;
  function?: string | null;
  name?: string;
  currentFunction?: string;
  currentArgs?: FunctionArg[];
}

/** Upstream's `suggest`: the cursor is counted from 0, as the parser counts */
export async function suggest(
  expression: string,
  functionList: TimelineFunction[],
  cursorPosition: number,
  argValueSuggestions: ArgValueSuggestions
): Promise<Suggestions | undefined> {
  try {
    const result = parseExpression(expression);
    return await extractSuggestionsFromParsedResult(result, cursorPosition, functionList, argValueSuggestions);
  } catch (err) {
    let message: ParseMessage;
    try {
      // The grammar will throw an error containing a message if the expression is formatted
      // correctly and is prepared to accept suggestions. If the expression is not formatted
      // correctly the grammar will just throw a regular PEG SyntaxError, and this JSON.parse
      // attempt will throw an error.
      message = JSON.parse((err as Error).message) as ParseMessage;
    } catch {
      // The expression isn't correctly formatted, so JSON.parse threw an error.
      return undefined;
    }

    switch (message?.type) {
      case 'incompleteFunction': {
        const partial = message.function;
        // The user has started typing a function name, so the list is narrowed to what matches
        const list = partial ? functionList.filter((func) => func.name.startsWith(partial)) : functionList;
        return { list, type: SUGGESTION_TYPE.FUNCTIONS };
      }
      case 'incompleteArgument': {
        const functionHelp = functionList.find((func) => func.name === message.currentFunction);
        return { list: getArgumentsHelp(functionHelp, message.currentArgs), type: SUGGESTION_TYPE.ARGUMENTS };
      }
      case 'incompleteArgumentValue': {
        const functionName = String(message.currentFunction);
        const argName = String(message.name);
        let valueSuggestions: TimelineArgSuggestion[] = [];
        if (argValueSuggestions.hasDynamicSuggestionsForArgument(functionName, argName)) {
          valueSuggestions = await argValueSuggestions.getDynamicSuggestionsForArgument(
            functionName,
            argName,
            message.currentArgs ?? []
          );
        } else {
          const functionHelp = functionList.find((func) => func.name === functionName);
          const argHelp = functionHelp?.args.find((arg) => arg.name === argName);
          if (argHelp?.suggestions) valueSuggestions = argHelp.suggestions;
        }
        return { list: valueSuggestions, type: SUGGESTION_TYPE.ARGUMENT_VALUE };
      }
    }
    return undefined;
  }
}

// --- What a suggestion inserts ------------------------------------------------------------------

export type CompletionKind = 'function' | 'property' | 'method';

export interface Completion {
  label: string;
  kind: CompletionKind;
  /** Shown beside the label: "(Chainable)", "Accepts: …" or a value's help */
  detail: string;
  documentation?: string;
  insertText: string;
  /** Where the cursor goes, counted from the start of the inserted text (a snippet's `$0`) */
  cursor: number;
  /** Suggestions open again once it is inserted */
  retrigger: boolean;
}

/** Upstream's `getSuggestion`: the text, kind and detail of a completion */
export function getSuggestion(suggestion: SuggestionEntry, type: SUGGESTION_TYPE): Completion {
  let kind: CompletionKind = 'method';
  let insertText = suggestion.name;
  let cursor: number | undefined;
  let detail = '';
  let retrigger = false;

  switch (type) {
    case SUGGESTION_TYPE.ARGUMENTS:
      retrigger = true;
      kind = 'property';
      insertText = `${insertText}=`;
      detail = `Accepts: ${String((suggestion as TimelineFunctionArg).types)}`;
      break;
    case SUGGESTION_TYPE.FUNCTIONS:
      retrigger = true;
      kind = 'function';
      // The snippet `name($0)`: the cursor lands between the parentheses
      cursor = insertText.length + 1;
      insertText = `${insertText}()`;
      detail = `(${(suggestion as TimelineFunction).chainable ? 'Chainable' : 'Data source'})`;
      break;
    case SUGGESTION_TYPE.ARGUMENT_VALUE: {
      const param = suggestion.name.split(':');
      if (param.length === 1 || param[1]) {
        insertText = `${param.length === 1 ? insertText : param[1]},`;
      }
      retrigger = true;
      kind = 'property';
      detail = suggestion.help || '';
      break;
    }
  }

  return {
    detail,
    insertText,
    cursor: cursor ?? insertText.length,
    kind,
    label: suggestion.name,
    documentation: suggestion.help,
    retrigger,
  };
}

// --- The word under the cursor and how a list is narrowed to it ---------------------------------

// The editor's default notion of a word: a number with a decimal point, or a run of what is not a
// separator
const WORD = /(-?\d*\.\d\w*)|([^`~!@#$%^&*()\-=+[{\]}\\|;:'",.<>/?\s]+)/g;

/** Where the word that ends at a column of a line starts: the column itself when there is none */
export function wordStart(line: string, column: number): number {
  WORD.lastIndex = 0;
  for (let match = WORD.exec(line); match; match = WORD.exec(line)) {
    const start = match.index;
    const end = start + match[0].length;
    if (start <= column && column <= end) return start;
    if (start > column) break;
    if (match[0].length === 0) WORD.lastIndex += 1;
  }
  return column;
}

/** Whether a typed character keeps suggestions coming: a word's character or a trigger */
export const TRIGGER_CHARACTERS = ['.', ',', '(', '=', ':'];
export const isWordCharacter = (char: string) => !/[`~!@#$%^&*()\-=+[{\]}\\|;:'",.<>/?\s]/.test(char);

const isBoundary = (label: string, index: number) =>
  index === 0 ||
  !/[a-zA-Z0-9]/.test(label[index - 1]) ||
  (/[a-z]/.test(label[index - 1]) && /[A-Z]/.test(label[index]));

/** How well a label matches what is typed, or undefined when it does not */
function matchScore(word: string, label: string): number | undefined {
  if (word === '') return 0;
  const lowWord = word.toLowerCase();
  const lowLabel = label.toLowerCase();
  if (lowLabel.startsWith(lowWord)) return 1000 + (label.startsWith(word) ? 1 : 0);
  // Otherwise the first character starts a word of the label and the others follow in order
  for (let start = lowLabel.indexOf(lowWord[0]); start >= 0; start = lowLabel.indexOf(lowWord[0], start + 1)) {
    if (!isBoundary(label, start)) continue;
    let at = start + 1;
    let matched = 1;
    for (; matched < lowWord.length; matched += 1) {
      const found = lowLabel.indexOf(lowWord[matched], at);
      if (found < 0) break;
      at = found + 1;
    }
    if (matched === lowWord.length) return 500 - start;
  }
  return undefined;
}

/** The completions that match the typed word, best first, then in the order of their labels */
export function filterCompletions(items: Completion[], word: string): Completion[] {
  return items
    .map((item, index) => ({ item, index, score: matchScore(word, item.label) }))
    .filter((entry): entry is { item: Completion; index: number; score: number } => entry.score !== undefined)
    .sort(
      (a, b) =>
        b.score - a.score ||
        (a.item.label < b.item.label ? -1 : a.item.label > b.item.label ? 1 : 0) ||
        a.index - b.index
    )
    .map((entry) => entry.item);
}

/**
 * The place the suggestions are asked for: upstream gives the parser the cursor's column on its
 * line, counted from 0, and so does this editor.
 */
export function cursorColumn(text: string, offset: number) {
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
  const line = text.slice(lineStart, (text.indexOf('\n', offset) + 1 || text.length + 1) - 1);
  const column = offset - lineStart;
  return { lineStart, line, column, wordStart: lineStart + wordStart(line, column) };
}

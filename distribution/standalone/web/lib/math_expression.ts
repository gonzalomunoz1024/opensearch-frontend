/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Arithmetic written as text, as the Math aggregation of TSVB takes it: numbers, names with
 * dots (`params.total`), the four operations with brackets, powers, and the functions people
 * use on series: `divide(a, b)`, `sum(values)`, `mean`, `min`, `max`, `round(x, places)`.
 * Nothing is run as code: the text is parsed and worked out here.
 */

export type MathValue = number | number[] | null | undefined | { [name: string]: MathValue };

type Token = { kind: 'number'; value: number } | { kind: 'name'; value: string } | { kind: 'symbol'; value: string };

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const pattern = /\s*(?:(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+)|([A-Za-z_$][\w$]*(?:\.[\w$-]+)*)|([-+*/^%(),]))/y;
  let at = 0;
  while (at < text.length) {
    pattern.lastIndex = at;
    const match = pattern.exec(text);
    if (!match) {
      if (text.slice(at).trim() === '') break;
      throw new Error(`Unexpected "${text.slice(at).trim()[0]}" in the expression`);
    }
    if (match[1] !== undefined) tokens.push({ kind: 'number', value: Number(match[1]) });
    else if (match[2] !== undefined) tokens.push({ kind: 'name', value: match[2] });
    else tokens.push({ kind: 'symbol', value: match[3] });
    at = pattern.lastIndex;
  }
  return tokens;
}

const numbers = (values: MathValue[]): number[] =>
  values.flatMap((value) => (Array.isArray(value) ? value : [value])).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));

const one = (value: MathValue): number => (typeof value === 'number' ? value : Array.isArray(value) && typeof value[value.length - 1] === 'number' ? value[value.length - 1] : NaN);

const FUNCTIONS: Record<string, (args: MathValue[]) => number> = {
  add: (args) => numbers(args).reduce((sum, value) => sum + value, 0),
  sum: (args) => numbers(args).reduce((sum, value) => sum + value, 0),
  subtract: (args) => one(args[0]) - one(args[1]),
  multiply: (args) => numbers(args).reduce((product, value) => product * value, 1),
  divide: (args) => one(args[0]) / one(args[1]),
  mod: (args) => one(args[0]) % one(args[1]),
  pow: (args) => one(args[0]) ** one(args[1]),
  sqrt: (args) => Math.sqrt(one(args[0])),
  cbrt: (args) => Math.cbrt(one(args[0])),
  square: (args) => one(args[0]) ** 2,
  cube: (args) => one(args[0]) ** 3,
  abs: (args) => Math.abs(one(args[0])),
  exp: (args) => Math.exp(one(args[0])),
  log: (args) => (args.length > 1 ? Math.log(one(args[0])) / Math.log(one(args[1])) : Math.log(one(args[0]))),
  log10: (args) => Math.log10(one(args[0])),
  floor: (args) => Math.floor(one(args[0])),
  ceil: (args) => Math.ceil(one(args[0])),
  fix: (args) => Math.trunc(one(args[0])),
  round: (args) => {
    const factor = 10 ** (args.length > 1 ? one(args[1]) : 0);
    return Math.round(one(args[0]) * factor) / factor;
  },
  clamp: (args) => Math.max(one(args[1]), Math.min(one(args[2]), one(args[0]))),
  min: (args) => Math.min(...numbers(args)),
  max: (args) => Math.max(...numbers(args)),
  mean: (args) => {
    const list = numbers(args);
    return list.length ? list.reduce((sum, value) => sum + value, 0) / list.length : NaN;
  },
  median: (args) => {
    const list = numbers(args).sort((a, b) => a - b);
    if (list.length === 0) return NaN;
    const middle = Math.floor(list.length / 2);
    return list.length % 2 ? list[middle] : (list[middle - 1] + list[middle]) / 2;
  },
  range: (args) => {
    const list = numbers(args);
    return Math.max(...list) - Math.min(...list);
  },
  size: (args) => numbers(args).length,
  count: (args) => numbers(args).length,
  first: (args) => numbers(args)[0] ?? NaN,
  last: (args) => {
    const list = numbers(args);
    return list[list.length - 1] ?? NaN;
  },
  pi: () => Math.PI,
};

function lookup(scope: Record<string, MathValue>, path: string): MathValue {
  let value: MathValue = scope;
  for (const part of path.split('.')) {
    if (value === null || value === undefined || typeof value !== 'object' || Array.isArray(value)) return undefined;
    value = value[part];
  }
  return value;
}

/** Works out an expression; names are looked up in `scope`. Throws when the text is not an expression. */
export function evaluateMath(text: string, scope: Record<string, MathValue> = {}): number {
  const tokens = tokenize(text);
  let at = 0;
  const peek = () => tokens[at];
  const take = (symbol?: string) => {
    const token = tokens[at];
    if (symbol !== undefined && (token?.kind !== 'symbol' || token.value !== symbol)) {
      throw new Error(`Expected "${symbol}" in the expression`);
    }
    at += 1;
    return token;
  };
  const isSymbol = (value: string) => peek()?.kind === 'symbol' && peek().value === value;

  const primary = (): MathValue => {
    const token = take();
    if (!token) throw new Error('The expression ends too soon');
    if (token.kind === 'number') return token.value;
    if (token.kind === 'symbol') {
      if (token.value === '(') {
        const value = sum();
        take(')');
        return value;
      }
      if (token.value === '-') return -one(unary());
      if (token.value === '+') return one(unary());
      throw new Error(`Unexpected "${token.value}" in the expression`);
    }
    if (isSymbol('(')) {
      const fn = FUNCTIONS[token.value];
      if (!fn) throw new Error(`The expression uses "${token.value}", which is not a function it knows`);
      take('(');
      const args: MathValue[] = [];
      if (!isSymbol(')')) {
        args.push(sum());
        while (isSymbol(',')) {
          take(',');
          args.push(sum());
        }
      }
      take(')');
      return fn(args);
    }
    return lookup(scope, token.value);
  };
  const unary = (): MathValue => primary();
  const power = (): MathValue => {
    const base = unary();
    if (isSymbol('^')) {
      take('^');
      return one(base) ** one(power());
    }
    return base;
  };
  const product = (): MathValue => {
    let left = power();
    while (isSymbol('*') || isSymbol('/') || isSymbol('%')) {
      const operator = take().value;
      const right = one(power());
      left = operator === '*' ? one(left) * right : operator === '/' ? one(left) / right : one(left) % right;
    }
    return left;
  };
  const sum = (): MathValue => {
    let left = product();
    while (isSymbol('+') || isSymbol('-')) {
      const operator = take().value;
      const right = one(product());
      left = operator === '+' ? one(left) + right : one(left) - right;
    }
    return left;
  };

  const result = sum();
  if (at < tokens.length) throw new Error('The expression has something left over at its end');
  return one(result);
}

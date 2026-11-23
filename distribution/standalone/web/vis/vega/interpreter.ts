/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Vega expressions evaluated by walking their syntax tree, as OpenSearch Dashboards has them
 * evaluated: Vega would otherwise turn each one into a function from its text, which the page's
 * content security policy forbids. The rules are those of vega-interpreter 1.2.1 (BSD-3-Clause,
 * Copyright (c) 2015-2023, University of Washington Interactive Data Lab): the same functions,
 * constants and operators, and the same refusals of members that could run code.
 */

export interface ExpressionNode {
  type: string;
  value?: unknown;
  name?: string;
  computed?: boolean;
  object?: ExpressionNode;
  property?: ExpressionNode;
  callee?: ExpressionNode;
  arguments?: ExpressionNode[];
  elements?: ExpressionNode[];
  properties?: ExpressionNode[];
  key?: ExpressionNode;
  operator?: string;
  left?: ExpressionNode;
  right?: ExpressionNode;
  argument?: ExpressionNode;
  test?: ExpressionNode;
  consequent?: ExpressionNode;
  alternate?: ExpressionNode;
}

type Fn = (...args: unknown[]) => unknown;
type FunctionTable = Record<string, unknown>;

/** What the Vega runtime hands an interpreter: the parsed expression, and its context */
interface RuntimeContext {
  functions: FunctionTable;
}
interface ParsedExpression {
  ast: ExpressionNode;
}
interface EncodeExpression {
  marktype: string;
  channels: Record<string, ParsedExpression>;
}
type Item = Record<string, unknown> & { datum?: unknown };
interface VegaEvent {
  item?: { datum?: unknown };
  vega?: Record<string, Fn>;
}

export interface ExpressionInterpreter {
  operator(ctx: RuntimeContext, expr: ParsedExpression): (params: unknown) => unknown;
  parameter(ctx: RuntimeContext, expr: ParsedExpression): (datum: unknown, params: unknown) => unknown;
  event(ctx: RuntimeContext, expr: ParsedExpression): (event: VegaEvent) => unknown;
  handler(ctx: RuntimeContext, expr: ParsedExpression): (params: unknown, event: VegaEvent) => unknown;
  encode(ctx: RuntimeContext, encode: EncodeExpression): (item: Item, params: unknown) => number;
}

const CONSTANTS: Record<string, number> = {
  NaN: NaN,
  E: Math.E,
  LN2: Math.LN2,
  LN10: Math.LN10,
  LOG2E: Math.LOG2E,
  LOG10E: Math.LOG10E,
  PI: Math.PI,
  SQRT1_2: Math.SQRT1_2,
  SQRT2: Math.SQRT2,
  MIN_VALUE: Number.MIN_VALUE,
  MAX_VALUE: Number.MAX_VALUE,
};

/* eslint-disable eqeqeq, no-bitwise */
const BINARY: Record<string, (a: never, b: never) => unknown> = {
  '*': (a: number, b: number) => a * b,
  '+': (a: number, b: number) => a + b,
  '-': (a: number, b: number) => a - b,
  '/': (a: number, b: number) => a / b,
  '%': (a: number, b: number) => a % b,
  '>': (a: number, b: number) => a > b,
  '<': (a: number, b: number) => a < b,
  '<=': (a: number, b: number) => a <= b,
  '>=': (a: number, b: number) => a >= b,
  '==': (a: unknown, b: unknown) => a == b,
  '!=': (a: unknown, b: unknown) => a != b,
  '===': (a: unknown, b: unknown) => a === b,
  '!==': (a: unknown, b: unknown) => a !== b,
  '&': (a: number, b: number) => a & b,
  '|': (a: number, b: number) => a | b,
  '^': (a: number, b: number) => a ^ b,
  '<<': (a: number, b: number) => a << b,
  '>>': (a: number, b: number) => a >> b,
  '>>>': (a: number, b: number) => a >>> b,
};

const UNARY: Record<string, (a: never) => unknown> = {
  '+': (a: number) => +a,
  '-': (a: number) => -a,
  '~': (a: number) => ~a,
  '!': (a: unknown) => !a,
};
/* eslint-enable eqeqeq, no-bitwise */

const EVENT_FUNCTIONS = ['view', 'item', 'group', 'xy', 'x', 'y'];

// Functions that would run code from text: never handed out, as a member or a property value
const DISALLOWED_METHODS = new Set<unknown>([Function, globalThis.eval, setTimeout, setInterval]);
const immediate = (globalThis as { setImmediate?: unknown }).setImmediate;
if (typeof immediate === 'function') DISALLOWED_METHODS.add(immediate);

// The methods of Object.prototype and __proto__, which an object expression may not set
const DISALLOWED_OBJECT_PROPERTIES = new Set([
  ...Object.getOwnPropertyNames(Object.prototype).filter(
    (name) => typeof (Object.prototype as unknown as Record<string, unknown>)[name] === 'function'
  ),
  '__proto__',
]);

const datetime = (y: number, m?: number, d?: number | null, H?: number, M?: number, S?: number, ms?: number) =>
  new Date(y, m || 0, d != null ? d : 1, H || 0, M || 0, S || 0, ms || 0);

const callOn = (method: string, args: unknown[], cast?: (value: unknown) => unknown): unknown => {
  const target = (cast ? cast(args[0]) : args[0]) as Record<string, Fn>;
  return target[method].apply(target, args.slice(1));
};

/** The functions of the interpreter, beside those Vega's runtime gives every expression */
function standardFunctions(ascending: (a: unknown, b: unknown) => number): Record<string, Fn> {
  const table: Record<string, unknown> = {
    // math
    isNaN: Number.isNaN,
    isFinite: Number.isFinite,
    abs: Math.abs,
    acos: Math.acos,
    asin: Math.asin,
    atan: Math.atan,
    atan2: Math.atan2,
    ceil: Math.ceil,
    cos: Math.cos,
    exp: Math.exp,
    floor: Math.floor,
    log: Math.log,
    max: Math.max,
    min: Math.min,
    pow: Math.pow,
    random: Math.random,
    round: Math.round,
    sin: Math.sin,
    sqrt: Math.sqrt,
    tan: Math.tan,
    clamp: (a: number, b: number, c: number) => Math.max(b, Math.min(c, a)),
    // dates
    now: Date.now,
    utc: Date.UTC,
    datetime,
    date: (d: number) => new Date(d).getDate(),
    day: (d: number) => new Date(d).getDay(),
    year: (d: number) => new Date(d).getFullYear(),
    month: (d: number) => new Date(d).getMonth(),
    hours: (d: number) => new Date(d).getHours(),
    minutes: (d: number) => new Date(d).getMinutes(),
    seconds: (d: number) => new Date(d).getSeconds(),
    milliseconds: (d: number) => new Date(d).getMilliseconds(),
    time: (d: number) => new Date(d).getTime(),
    timezoneoffset: (d: number) => new Date(d).getTimezoneOffset(),
    utcdate: (d: number) => new Date(d).getUTCDate(),
    utcday: (d: number) => new Date(d).getUTCDay(),
    utcyear: (d: number) => new Date(d).getUTCFullYear(),
    utcmonth: (d: number) => new Date(d).getUTCMonth(),
    utchours: (d: number) => new Date(d).getUTCHours(),
    utcminutes: (d: number) => new Date(d).getUTCMinutes(),
    utcseconds: (d: number) => new Date(d).getUTCSeconds(),
    utcmilliseconds: (d: number) => new Date(d).getUTCMilliseconds(),
    // sequences
    length: (x: { length: number }) => x.length,
    join: (...args: unknown[]) => callOn('join', args),
    indexof: (...args: unknown[]) => callOn('indexOf', args),
    lastindexof: (...args: unknown[]) => callOn('lastIndexOf', args),
    slice: (...args: unknown[]) => callOn('slice', args),
    reverse: (x: unknown[]) => x.slice().reverse(),
    sort: (x: unknown[]) => x.slice().sort(ascending),
    // strings
    parseFloat,
    parseInt,
    upper: (x: unknown) => String(x).toUpperCase(),
    lower: (x: unknown) => String(x).toLowerCase(),
    substring: (...args: unknown[]) => callOn('substring', args, String),
    split: (...args: unknown[]) => callOn('split', args, String),
    replace: (...args: unknown[]) => callOn('replace', args, String),
    trim: (x: unknown) => String(x).trim(),
    btoa: (x: string) => btoa(x),
    atob: (x: string) => atob(x),
    // regular expressions
    regexp: RegExp,
    test: (r: string | RegExp, t: string) => RegExp(r).test(t),
  };
  return table as Record<string, Fn>;
}

interface Scope {
  memberDepth: number;
  fn: FunctionTable;
  params: unknown;
  datum: unknown;
  event: VegaEvent | undefined;
  item: unknown;
}

function interpret(
  functions: Record<string, Fn>,
  ast: ExpressionNode,
  fn: FunctionTable,
  params?: unknown,
  datum?: unknown,
  event?: VegaEvent,
  item?: unknown
): unknown {
  const scope: Scope = { memberDepth: 0, fn: Object.create(fn) as FunctionTable, params, datum, event, item };
  // the event functions answer from the event Vega annotated
  for (const name of EVENT_FUNCTIONS) {
    scope.fn[name] = (...args: unknown[]) => (event as VegaEvent & { vega: Record<string, Fn> }).vega[name](...args);
  }

  const visit = (n: ExpressionNode): unknown => {
    switch (n.type) {
      case 'Literal':
        return n.value;
      case 'Identifier': {
        const id = n.name ?? '';
        if (scope.memberDepth > 0) return id;
        if (id === 'datum') return scope.datum;
        if (id === 'event') return scope.event;
        if (id === 'item') return scope.item;
        return CONSTANTS[id] || (scope.params as Record<string, unknown>)['$' + id];
      }
      case 'MemberExpression': {
        const direct = !n.computed;
        const object = visit(n.object as ExpressionNode) as Record<string, unknown>;
        if (direct) scope.memberDepth += 1;
        const property = visit(n.property as ExpressionNode) as string;
        if (direct) scope.memberDepth -= 1;
        if (DISALLOWED_METHODS.has(object[property])) {
          console.error(`Prevented interpretation of member "${property}" which could lead to insecure code execution`);
          return undefined;
        }
        return object[property];
      }
      case 'CallExpression': {
        const args = n.arguments ?? [];
        let name = n.callee?.name ?? '';
        // the internal functions encoders use are the standard ones
        if (name.startsWith('_')) name = name.slice(1);
        // "if" evaluates only the branch it takes
        if (name === 'if') return visit(args[0]) ? visit(args[1]) : visit(args[2]);
        const target = (scope.fn[name] || functions[name]) as Fn;
        return target.apply(scope.fn, args.map(visit));
      }
      case 'ArrayExpression':
        return (n.elements ?? []).map(visit);
      case 'BinaryExpression':
        return BINARY[n.operator ?? ''](visit(n.left as ExpressionNode) as never, visit(n.right as ExpressionNode) as never);
      case 'UnaryExpression':
        return UNARY[n.operator ?? ''](visit(n.argument as ExpressionNode) as never);
      case 'ConditionalExpression':
        return visit(n.test as ExpressionNode) ? visit(n.consequent as ExpressionNode) : visit(n.alternate as ExpressionNode);
      case 'LogicalExpression':
        return n.operator === '&&'
          ? visit(n.left as ExpressionNode) && visit(n.right as ExpressionNode)
          : visit(n.left as ExpressionNode) || visit(n.right as ExpressionNode);
      case 'ObjectExpression':
        return (n.properties ?? []).reduce<Record<string, unknown>>((result, property) => {
          scope.memberDepth += 1;
          const key = visit(property.key as ExpressionNode) as string;
          scope.memberDepth -= 1;
          const value = visit(property.value as ExpressionNode);
          if (DISALLOWED_OBJECT_PROPERTIES.has(key)) {
            console.error(`Prevented interpretation of property "${key}" which could lead to insecure code execution`);
          } else if (DISALLOWED_METHODS.has(value)) {
            console.error(`Prevented interpretation of method "${String(value)}" which could lead to insecure code execution`);
          } else {
            result[key] = value;
          }
          return result;
        }, {});
      default:
        // as the original, which has no visitor for any other node
        throw new TypeError(`Visitors[n.type] is not a function`);
    }
  };
  return visit(ast);
}

/** x2, y2, xc and yc as x, y, width and height, as Vega's own encoders set them */
function adjustSpatial(item: Item, encode: Record<string, unknown>, swap: boolean) {
  const at = item as Record<string, number>;
  let t: number;
  if (encode.x2) {
    if (encode.x) {
      if (swap && at.x > at.x2) {
        t = at.x;
        at.x = at.x2;
        at.x2 = t;
      }
      at.width = at.x2 - at.x;
    } else {
      at.x = at.x2 - (at.width || 0);
    }
  }
  if (encode.xc) at.x = at.xc - (at.width || 0) / 2;
  if (encode.y2) {
    if (encode.y) {
      if (swap && at.y > at.y2) {
        t = at.y;
        at.y = at.y2;
        at.y2 = t;
      }
      at.height = at.y2 - at.y;
    } else {
      at.y = at.y2 - (at.height || 0);
    }
  }
  if (encode.yc) at.y = at.yc - (at.height || 0) / 2;
}

/** The interpreter Vega's view is given as its `expr` option */
export function createExpressionInterpreter(ascending: (a: unknown, b: unknown) => number): ExpressionInterpreter {
  const functions = standardFunctions(ascending);
  return {
    operator(ctx, expr) {
      const { ast } = expr;
      const fn = ctx.functions;
      return (params) => interpret(functions, ast, fn, params);
    },
    parameter(ctx, expr) {
      const { ast } = expr;
      const fn = ctx.functions;
      return (datum, params) => interpret(functions, ast, fn, params, datum);
    },
    event(ctx, expr) {
      const { ast } = expr;
      const fn = ctx.functions;
      return (event) => interpret(functions, ast, fn, undefined, undefined, event);
    },
    handler(ctx, expr) {
      const { ast } = expr;
      const fn = ctx.functions;
      return (params, event) => {
        const datum = event.item && event.item.datum;
        return interpret(functions, ast, fn, params, datum, event);
      };
    },
    encode(ctx, encode) {
      const { marktype, channels } = encode;
      const fn = ctx.functions;
      const swap = marktype === 'group' || marktype === 'image' || marktype === 'rect';
      return (item, params) => {
        const datum = item.datum;
        let modified = 0;
        for (const name of Object.keys(channels)) {
          const value = interpret(functions, channels[name].ast, fn, params, datum, undefined, item);
          if (item[name] !== value) {
            item[name] = value;
            modified = 1;
          }
        }
        if (marktype !== 'rule') adjustSpatial(item, channels, swap);
        return modified;
      };
    },
  };
}

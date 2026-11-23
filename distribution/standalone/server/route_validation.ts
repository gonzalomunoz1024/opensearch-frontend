/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The checks OpenSearch Dashboards makes of a request before its route sees it, with the same
 * messages: what `@osd/config-schema` says when a part of the query, the body or the path is
 * missing, of another type or not known (`[request query.per_page]: expected value of type
 * [number] but got [string]`). A value coming as text is read as its schema reads it: a number
 * as Joi reads one, a boolean from "true" or "false", an object or a list from JSON.
 */

import { badRequest } from './http';

type Path = Array<string | number>;

export class SchemaTypeError extends Error {
  constructor(
    message: string,
    readonly path: Path
  ) {
    super(message);
    this.name = 'SchemaTypeError';
  }
}

export interface Schema<T> {
  validate(value: unknown, path: Path): T;
}

/** What `type-detect` calls a value, which the messages name */
export function typeDetect(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'Array';
  if (typeof value === 'object') return Object.prototype.toString.call(value).slice(8, -1);
  return typeof value;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === null || prototype === Object.prototype;
};

interface Options<T> {
  defaultValue?: T;
}

const required = <T>(value: unknown, options: Options<T>, message: () => string, path: Path) => {
  if (value !== undefined) return false;
  if (options.defaultValue !== undefined) return true;
  throw new SchemaTypeError(message(), path);
};

export function string(options: Options<string> & { minLength?: number; maxLength?: number } = {}): Schema<string> {
  return {
    validate(value, path) {
      const message = () => `expected value of type [string] but got [${typeDetect(value)}]`;
      if (required(value, options, message, path)) return options.defaultValue as string;
      if (typeof value !== 'string') throw new SchemaTypeError(message(), path);
      if (options.minLength !== undefined && value.length < options.minLength) {
        throw new SchemaTypeError(
          `value has length [${value.length}] but it must have a minimum length of [${options.minLength}].`,
          path
        );
      }
      if (options.maxLength !== undefined && value.length > options.maxLength) {
        throw new SchemaTypeError(
          `value has length [${value.length}] but it must have a maximum length of [${options.maxLength}].`,
          path
        );
      }
      return value;
    },
  };
}

// How Joi reads a number written as text, and when it finds it does not stay the same number
const NUMBER = /^\s*[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:e([+-]?\d+))?\s*$/i;

const significantDigits = (text: string) =>
  text
    .replace(/[eE][+-]?\d+$/, '')
    .replace(/\./, '')
    .replace(/0+$/, '')
    .replace(/^[+-]?(0*)?/, '');

function normalizeDecimal(text: string): string {
  let normalized = text
    .replace(/^\+/, '')
    .replace(/\.0*$/, '')
    .replace(/^(-?)\.([^.]*)$/, '$10.$2')
    .replace(/^(-?)0+([0-9])/, '$1$2');
  if (normalized.includes('.') && normalized.endsWith('0')) normalized = normalized.replace(/0+$/, '');
  return normalized === '-0' ? '0' : normalized;
}

/** A number from text as Joi takes it: `undefined` when Joi leaves the text as it is */
export function numberFromText(raw: string): number | 'unsafe' | undefined {
  if (!NUMBER.test(raw)) return undefined;
  const text = raw.trim();
  let value = parseFloat(text);
  if (value === 0) value = 0;
  if (/e/i.test(text)) {
    if (significantDigits(text) !== significantDigits(String(value))) return 'unsafe';
  } else {
    const written = value.toString();
    if (!/e/i.test(written) && written !== normalizeDecimal(text)) return 'unsafe';
  }
  return value;
}

export function number(options: Options<number> & { min?: number; max?: number } = {}): Schema<number> {
  return {
    validate(input, path) {
      const message = (value: unknown) => `expected value of type [number] but got [${typeDetect(value)}]`;
      if (required(input, options, () => message(input), path)) return options.defaultValue as number;
      let value = input;
      if (typeof value === 'string') {
        const read = numberFromText(value);
        if (read === 'unsafe') throw new SchemaTypeError('number.unsafe', path);
        if (read !== undefined) value = read;
      }
      if (value === Infinity || value === -Infinity) throw new SchemaTypeError('number.infinity', path);
      if (typeof value !== 'number' || Number.isNaN(value)) throw new SchemaTypeError(message(value), path);
      if (value > Number.MAX_SAFE_INTEGER || value < Number.MIN_SAFE_INTEGER) {
        throw new SchemaTypeError('number.unsafe', path);
      }
      if (options.min !== undefined && value < options.min) {
        throw new SchemaTypeError(`Value must be equal to or greater than [${options.min}].`, path);
      }
      if (options.max !== undefined && value > options.max) {
        throw new SchemaTypeError(`Value must be equal to or lower than [${options.max}].`, path);
      }
      return value;
    },
  };
}

export function boolean(options: Options<boolean> = {}): Schema<boolean> {
  return {
    validate(input, path) {
      const message = (value: unknown) => `expected value of type [boolean] but got [${typeDetect(value)}]`;
      if (required(input, options, () => message(input), path)) return options.defaultValue as boolean;
      let value = input;
      if (typeof value === 'string') {
        const lower = value.toLowerCase();
        value = lower === 'true' ? true : lower === 'false' ? false : value;
      }
      if (typeof value !== 'boolean') throw new SchemaTypeError(message(value), path);
      return value;
    },
  };
}

export function literal<T extends string | number | boolean>(expected: T): Schema<T> {
  return {
    validate(value, path) {
      if (value !== expected) throw new SchemaTypeError(`expected value to equal [${String(expected)}]`, path);
      return expected;
    },
  };
}

export function any(): Schema<unknown> {
  return {
    validate(value, path) {
      if (value === undefined) throw new SchemaTypeError('expected value of type [any] but got [undefined]', path);
      return value;
    },
  };
}

export function maybe<T>(type: Schema<T>): Schema<T | undefined> {
  return { validate: (value, path) => (value === undefined ? undefined : type.validate(value, path)) };
}

/**
 * The first of the types the value is; when it is none, the error of the last one, which Joi
 * reports as text: `SchemaTypeError: expected value to equal [AND]`, at the place of the union.
 */
export function oneOf<T>(types: Array<Schema<T>>, options: Options<T> = {}): Schema<T> {
  return {
    validate(value, path) {
      const message = () => `expected at least one defined value but got [${typeDetect(value)}]`;
      if (required(value, options, message, path)) return options.defaultValue as T;
      let last: Error | undefined;
      for (const type of types) {
        try {
          return type.validate(value, path);
        } catch (error) {
          if (!(error instanceof SchemaTypeError)) throw error;
          last = error;
        }
      }
      throw new SchemaTypeError(`SchemaTypeError: ${last?.message ?? ''}`, path);
    },
  };
}

export function arrayOf<T>(
  type: Schema<T>,
  options: Options<T[]> & { minSize?: number; maxSize?: number } = {}
): Schema<T[]> {
  return {
    validate(input, path) {
      const message = (value: unknown) => `expected value of type [array] but got [${typeDetect(value)}]`;
      if (required(input, options, () => message(input), path)) return options.defaultValue as T[];
      let value = input;
      if (typeof value === 'string') {
        try {
          value = JSON.parse(value) as unknown;
        } catch {
          throw new SchemaTypeError('could not parse array value from json input', path);
        }
      }
      if (!Array.isArray(value)) throw new SchemaTypeError(message(value), path);
      const items = value.map((item: unknown, index) => {
        if (item === undefined) throw new SchemaTypeError('sparse array are not allowed', [...path, index]);
        return type.validate(item, [...path, index]);
      });
      if (options.minSize !== undefined && items.length < options.minSize) {
        throw new SchemaTypeError(
          `array size is [${items.length}], but cannot be smaller than [${options.minSize}]`,
          path
        );
      }
      if (options.maxSize !== undefined && items.length > options.maxSize) {
        throw new SchemaTypeError(
          `array size is [${items.length}], but cannot be greater than [${options.maxSize}]`,
          path
        );
      }
      return items;
    },
  };
}

export function recordOf<V>(keyType: Schema<string>, valueType: Schema<V>): Schema<Record<string, V>> {
  return {
    validate(input, path) {
      let value = input;
      if (typeof value === 'string') {
        try {
          value = JSON.parse(value) as unknown;
        } catch {
          throw new SchemaTypeError('could not parse record value from json input', path);
        }
      }
      if (!isPlainObject(value)) {
        throw new SchemaTypeError(`expected value of type [object] but got [${typeDetect(value)}]`, path);
      }
      const result: Record<string, V> = {};
      for (const [key, item] of Object.entries(value)) {
        if (key === '__proto__') continue;
        keyType.validate(key, [...path, `key("${key}")`]);
        result[key] = valueType.validate(item, [...path, key]);
      }
      return result;
    },
  };
}

type Props = Record<string, Schema<unknown>>;
type ObjectOf<P extends Props> = { [K in keyof P]: P[K] extends Schema<infer T> ? T : never };

/**
 * An object with these keys, checked in the order they are given, then the keys it does not
 * know, which are refused, dropped or kept as `unknowns` says; `validate` checks the whole.
 */
export function object<P extends Props>(
  props: P,
  options: { unknowns?: 'allow' | 'ignore' | 'forbid'; validate?: (value: ObjectOf<P>) => string | void } = {}
): Schema<ObjectOf<P>> {
  return {
    validate(input, path) {
      let value: unknown = input === undefined ? {} : input;
      if (typeof value === 'string') {
        try {
          value = JSON.parse(value) as unknown;
        } catch {
          throw new SchemaTypeError('could not parse object value from json input', path);
        }
      }
      if (!isPlainObject(value)) {
        throw new SchemaTypeError(`expected a plain object value, but found [${typeDetect(value)}] instead.`, path);
      }
      const source = value;
      const result = Object.create(null) as Record<string, unknown>;
      for (const [key, type] of Object.entries(props)) {
        const checked = type.validate(source[key], [...path, key]);
        if (checked !== undefined) result[key] = checked;
      }
      for (const key of Object.keys(source)) {
        // A key __proto__ (from JSON read here) is left out, as the original's schema leaves it out
        if (key === '__proto__' || Object.prototype.hasOwnProperty.call(props, key)) continue;
        const unknowns = options.unknowns ?? 'forbid';
        if (unknowns === 'forbid') throw new SchemaTypeError('definition for this key is missing', [...path, key]);
        if (unknowns === 'allow') result[key] = source[key];
      }
      const typed = result as ObjectOf<P>;
      const problem = options.validate?.(typed);
      if (typeof problem === 'string') throw new SchemaTypeError(problem, path);
      return typed;
    },
  };
}

/** Checks a part of a request, answering 400 with config-schema's message when it fails */
export function validateRequestPart<T>(schema: Schema<T>, value: unknown, part: 'query' | 'body' | 'params'): T {
  try {
    return schema.validate(value, []);
  } catch (error) {
    if (error instanceof SchemaTypeError) {
      throw badRequest(`[${[`request ${part}`, ...error.path].join('.')}]: ${error.message}`);
    }
    throw error;
  }
}

/** A query string as hapi gives it to a route: a key given more than once is a list */
export function queryObject(query: URLSearchParams): Record<string, string | string[]> {
  const result = Object.create(null) as Record<string, string | string[]>;
  for (const [key, value] of query) {
    const entry = result[key];
    result[key] = entry === undefined ? value : ([] as string[]).concat(entry, value);
  }
  return result;
}

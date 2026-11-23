/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The few general helpers Timeline's functions were written with (lodash's isEqual, cloneDeep,
 * merge, zip, defaults), with the same results for the values they meet here: JSON-like data.
 */

export type Dict = Record<string, unknown>;

export const isObjectLike = (value: unknown): value is Dict =>
  typeof value === 'object' && value !== null;

/** lodash's `_.isObject`: objects, arrays and functions */
export const isObject = (value: unknown): value is Dict =>
  (typeof value === 'object' && value !== null) || typeof value === 'function';

export function isPlainObject(value: unknown): value is Dict {
  if (!isObjectLike(value) || Object.prototype.toString.call(value) !== '[object Object]') {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

/** Deep equality, NaN equal to NaN, as lodash compares */
export function isEqual(a: unknown, b: unknown): boolean {
  if (a === b || (Number.isNaN(a) && Number.isNaN(b))) return true;
  if (!isObjectLike(a) || !isObjectLike(b)) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) if (!isEqual(a[i], b[i])) return false;
    return true;
  }
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((key) => Object.prototype.hasOwnProperty.call(b, key) && isEqual(a[key], b[key]));
}

export function cloneDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    const copy = value.map((item) => cloneDeep(item)) as unknown[] & Dict;
    // An array of arguments carries its arguments by name too
    for (const key of Object.keys(value)) {
      if (!/^\d+$/.test(key)) copy[key] = cloneDeep((value as unknown as Dict)[key]);
    }
    return copy as T;
  }
  if (isObjectLike(value) && !(value instanceof Date)) {
    const copy = Object.create(Object.getPrototypeOf(value)) as Dict;
    for (const key of Object.keys(value)) copy[key] = cloneDeep((value as Dict)[key]);
    return copy as T;
  }
  return value;
}

/** lodash's `_.merge`: deep, into the first object, skipping what is undefined */
export function merge(target: Dict, ...sources: unknown[]): Dict {
  for (const source of sources) {
    if (!isObjectLike(source)) continue;
    for (const key of Object.keys(source)) mergeValue(target, key, (source as Dict)[key]);
  }
  return target;
}

function mergeValue(target: Dict, key: string, value: unknown) {
  const existing = target[key];
  if (Array.isArray(value)) {
    const base: unknown[] = Array.isArray(existing) ? existing : [];
    const copy = existing === base ? base : [];
    value.forEach((item, index) => mergeValue(copy as unknown as Dict, String(index), item));
    target[key] = copy;
  } else if (isPlainObject(value)) {
    const base = isPlainObject(existing) ? existing : {};
    for (const inner of Object.keys(value)) mergeValue(base, inner, value[inner]);
    target[key] = base;
  } else if (value !== undefined || !(key in target)) {
    target[key] = value;
  }
}

/** lodash's `_.zip` of two lists */
export function zip<A, B>(first: A[], second: B[]): Array<[A, B]> {
  const length = Math.max(first.length, second.length);
  const result: Array<[A, B]> = [];
  for (let i = 0; i < length; i += 1) result.push([first[i], second[i]]);
  return result;
}

/** lodash's `_.defaults`: fills in what is undefined */
export function defaults<T extends Dict>(target: T, ...sources: Dict[]): T {
  for (const source of sources) {
    for (const key of Object.keys(source)) {
      if ((target as Dict)[key] === undefined) (target as Dict)[key] = source[key];
    }
  }
  return target;
}

/** lodash's `_.map` over a list, a string's characters or an object's values; nothing for null */
export function listOf(value: unknown): unknown[] {
  if (value === null || value === undefined) return [];
  if (typeof value === 'string') return value.split('');
  if (Array.isArray(value)) return Array.from(value);
  if (isObjectLike(value)) return Object.values(value);
  return [];
}

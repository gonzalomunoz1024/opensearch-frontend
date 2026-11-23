/* SPDX-License-Identifier: Apache-2.0 */

// The browser side's tests run in Node, whose types the browser side is otherwise checked without.
declare const process: { env: Record<string, string | undefined> };
declare module 'node:test' {
  export function describe(name: string, body: () => void): void;
  export function it(name: string, body: () => void | Promise<void>): void;
  export function test(name: string, body: () => void | Promise<void>): void;
}
declare module 'node:assert/strict' {
  const assert: {
    (value: unknown, message?: string): void;
    equal(actual: unknown, expected: unknown, message?: string): void;
    deepEqual(actual: unknown, expected: unknown, message?: string): void;
    notEqual(actual: unknown, expected: unknown, message?: string): void;
    throws(body: () => unknown, expected?: RegExp | object): void;
    ok(value: unknown, message?: string): void;
    match(value: string, expected: RegExp): void;
  };
  export default assert;
}

// What the Vega tests use to run the browser builds of Vega and Vega-Lite the product ships
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
}
declare module 'node:vm' {
  export function runInThisContext(code: string, options?: { filename?: string }): unknown;
}

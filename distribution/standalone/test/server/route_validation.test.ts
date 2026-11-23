/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  arrayOf,
  boolean,
  literal,
  maybe,
  number,
  numberFromText,
  object,
  oneOf,
  queryObject,
  string,
  validateRequestPart,
} from '../../server/route_validation';

const messageOf = (body: () => unknown): string => {
  try {
    body();
  } catch (error) {
    return (error as Error).message;
  }
  return '';
};

const find = object({
  per_page: number({ min: 0, defaultValue: 20 }),
  page: number({ min: 0, defaultValue: 1 }),
  type: oneOf<string | string[]>([string(), arrayOf(string())]),
  default_search_operator: oneOf<string>([literal('OR'), literal('AND')], { defaultValue: 'OR' }),
  has_reference: maybe(object({ type: string(), id: string() })),
});

const check = (query: string) => validateRequestPart(find, queryObject(new URLSearchParams(query)), 'query');

describe('request checks', () => {
  it('reads numbers as Joi does', () => {
    assert.equal(numberFromText(' 5 '), 5);
    assert.equal(numberFromText('1e1'), 10);
    assert.equal(numberFromText('007'), 7);
    assert.equal(numberFromText('1.50'), 1.5);
    assert.equal(numberFromText('0x10'), undefined);
    assert.equal(numberFromText(''), undefined);
    assert.equal(numberFromText('99999999999999999999'), 'unsafe');
    assert.equal(numberFromText('1e400'), 'unsafe');
  });

  it('gives the defaults and the values of the query', () => {
    assert.deepEqual({ ...check('type=dashboard&per_page=5') }, {
      per_page: 5,
      page: 1,
      type: 'dashboard',
      default_search_operator: 'OR',
    });
    assert.deepEqual(check('type=a&type=b').type, ['a', 'b']);
    assert.deepEqual({ ...check('type=a&has_reference={"type":"x","id":"y"}').has_reference }, { type: 'x', id: 'y' });
  });

  it('words a refusal as config-schema does, the keys it knows first', () => {
    assert.equal(
      messageOf(() => check('zzz=1&per_page=abc')),
      '[request query.per_page]: expected value of type [number] but got [string]'
    );
    assert.equal(messageOf(() => check('per_page=-1&type=a')), '[request query.per_page]: Value must be equal to or greater than [0].');
    assert.equal(messageOf(() => check('per_page=1&per_page=2&type=a')), '[request query.per_page]: expected value of type [number] but got [Array]');
    assert.equal(messageOf(() => check('per_page=1e400&type=a')), '[request query.per_page]: number.unsafe');
    assert.equal(messageOf(() => check('')), '[request query.type]: expected at least one defined value but got [undefined]');
    assert.equal(
      messageOf(() => check('type=a&default_search_operator=and')),
      '[request query.default_search_operator]: SchemaTypeError: expected value to equal [AND]'
    );
    assert.equal(messageOf(() => check('type=a&zzz=1&aaa=2')), '[request query.zzz]: definition for this key is missing');
  });

  it('reads an object from JSON, and says when it cannot', () => {
    assert.equal(messageOf(() => check('type=a&has_reference=')), '[request query.has_reference]: could not parse object value from json input');
    assert.equal(
      messageOf(() => check('type=a&has_reference=[1]')),
      '[request query.has_reference]: expected a plain object value, but found [Array] instead.'
    );
    assert.equal(
      messageOf(() => check('type=a&has_reference={"type":1,"id":"y"}')),
      '[request query.has_reference.type]: expected value of type [string] but got [number]'
    );
    assert.equal(
      messageOf(() => check('type=a&has_reference={"type":"x","id":"y","z":1}')),
      '[request query.has_reference.z]: definition for this key is missing'
    );
  });

  it('checks a body: a list and its items, a boolean and the whole', () => {
    const body = arrayOf(object({ type: string(), id: string() }), { maxSize: 1 });
    assert.equal(messageOf(() => validateRequestPart(body, null, 'body')), '[request body]: expected value of type [array] but got [null]');
    assert.equal(
      messageOf(() => validateRequestPart(body, [{ type: 'x' }], 'body')),
      '[request body.0.id]: expected value of type [string] but got [undefined]'
    );
    assert.equal(
      messageOf(() => validateRequestPart(body, [{ type: 'x', id: '1' }, { type: 'x', id: '2' }], 'body')),
      '[request body]: array size is [2], but cannot be greater than [1]'
    );
    const flags = object(
      { overwrite: boolean({ defaultValue: false }), createNewCopies: boolean({ defaultValue: false }) },
      { validate: (value) => (value.overwrite && value.createNewCopies ? 'cannot use [overwrite] with [createNewCopies]' : undefined) }
    );
    assert.equal(validateRequestPart(flags, { overwrite: 'TRUE' }, 'query').overwrite, true);
    assert.equal(
      messageOf(() => validateRequestPart(flags, { overwrite: 'yes' }, 'query')),
      '[request query.overwrite]: expected value of type [boolean] but got [string]'
    );
    assert.equal(
      messageOf(() => validateRequestPart(flags, { overwrite: 'true', createNewCopies: 'true' }, 'query')),
      '[request query]: cannot use [overwrite] with [createNewCopies]'
    );
  });

  it("checks a text with the route's own check, after its type", () => {
    const named = object({ path: string({ validate: (path) => (path === '' ? 'Expected non-empty string' : undefined) }) });
    const at = (query: string) => messageOf(() => validateRequestPart(named, queryObject(new URLSearchParams(query)), 'query'));
    assert.equal(at('path='), '[request query.path]: Expected non-empty string');
    assert.equal(at('path=a'), '');
    // a list is no text, whatever the route's check says (config-schema hands it the list)
    assert.equal(at('path=a&path=b'), '[request query.path]: expected value of type [string] but got [Array]');
    assert.equal(at(''), '[request query.path]: expected value of type [string] but got [undefined]');
  });
});

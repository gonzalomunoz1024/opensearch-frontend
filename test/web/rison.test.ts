/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The rison reader against the one OpenSearch Dashboards 3.9.0 reads an address with
 * (rison-node 1.0.2): fixtures/rison_cases.json holds what its `decode` gives for texts written
 * by hand, well formed, awkward and broken: the value (a number that is not one as
 * { nan: true }), or the error it throws with its name and message.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { decode, tryDecode } from '../../web/lib/rison';

type Outcome = { value: unknown } | { error: string };

const cases = JSON.parse(readFileSync('test/web/fixtures/rison_cases.json', 'utf8')) as Array<[string, Outcome]>;

const plain = (value: unknown): unknown =>
  JSON.parse(
    JSON.stringify(value, (_key, item: unknown) =>
      typeof item === 'number' && Number.isNaN(item) ? { nan: true } : item
    )
  ) as unknown;

function read(text: string): Outcome {
  try {
    return { value: plain(decode(text)) };
  } catch (error) {
    return { error: `${(error as Error).name}: ${(error as Error).message}` };
  }
}

describe('rison, read as the original reads it', () => {
  it('reads every text of the fixture into the same value, or refuses it in the same words', () => {
    assert.ok(cases.length > 100);
    for (const [text, want] of cases) assert.deepEqual(read(text), want, JSON.stringify(text));
  });

  it('reads the numbers the original reads', () => {
    assert.equal(decode('1.'), 1);
    assert.equal(decode('-.5'), -0.5);
    assert.deepEqual(decode('(a:1.,b:-.5)'), { a: 1, b: -0.5 });
    // digits around a second minus are read, as something that is not a number
    assert.ok(Number.isNaN(decode('1-1')));
    assert.ok(Number.isNaN(decode('1e')));
  });

  it('refuses what the original refuses', () => {
    assert.throws(() => decode('1e+5'), /unable to parse string as rison/);
    assert.throws(() => decode('(-a:1)'), /invalid number/);
    assert.throws(() => decode('(a:'));
    assert.throws(() => decode('('));
    assert.throws(() => decode(''));
    assert.equal(tryDecode('1e+5'), undefined);
    assert.equal(tryDecode('(-abc:0.3)'), undefined);
  });

  it('takes any value as a key, as its text', () => {
    assert.deepEqual(decode('(!t:a)'), { true: 'a' });
    assert.deepEqual(decode('(1.50:a)'), { '1.5': 'a' });
  });
});

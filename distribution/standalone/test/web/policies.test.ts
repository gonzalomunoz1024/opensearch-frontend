/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { leadingDebounce } from '../../web/apps/index_management/jobs';
import { aceActiveLine, aceJsonTokens } from '../../web/apps/index_management/policy_model';

/** A clock whose time goes on only when told, with the timers set on it */
function fakeClock() {
  let now = 0;
  let next = 1;
  const timers = new Map<number, { at: number; run: () => void }>();
  return {
    setTimeout: (run: () => void, ms: number) => {
      const id = next++;
      timers.set(id, { at: now + ms, run });
      return id;
    },
    clearTimeout: (handle: unknown) => {
      timers.delete(handle as number);
    },
    pending: () => timers.size,
    advance(ms: number) {
      const until = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].run();
      }
      now = until;
    },
  };
}

describe('asking for the rows of a list as the plugin does', () => {
  it('asks at once the first time', () => {
    const clock = fakeClock();
    const calls: string[] = [];
    const debounced = leadingDebounce((what: string) => calls.push(what), 500, clock);
    debounced.call('first');
    assert.deepEqual(calls, ['first']);
    clock.advance(500);
    assert.deepEqual(calls, ['first']);
  });

  it('asks once more, with the last arguments, half a second after the last of the changes that follow', () => {
    const clock = fakeClock();
    const calls: string[] = [];
    const debounced = leadingDebounce((what: string) => calls.push(what), 500, clock);
    debounced.call('a');
    clock.advance(100);
    debounced.call('b');
    clock.advance(300);
    debounced.call('c');
    clock.advance(499);
    assert.deepEqual(calls, ['a']);
    clock.advance(1);
    assert.deepEqual(calls, ['a', 'c']);
  });

  it('asks at once again once half a second has passed without a change', () => {
    const clock = fakeClock();
    const calls: string[] = [];
    const debounced = leadingDebounce((what: string) => calls.push(what), 500, clock);
    debounced.call('a');
    clock.advance(600);
    debounced.call('b');
    assert.deepEqual(calls, ['a', 'b']);
  });

  it('forgets what was waiting when cancelled', () => {
    const clock = fakeClock();
    const calls: string[] = [];
    const debounced = leadingDebounce((what: string) => calls.push(what), 500, clock);
    debounced.call('a');
    debounced.call('b');
    debounced.cancel();
    assert.equal(clock.pending(), 0);
    clock.advance(1000);
    assert.deepEqual(calls, ['a']);
    debounced.call('c');
    assert.deepEqual(calls, ['a', 'c']);
  });
});

describe('colouring a policy as the JSON editor of the plugin does', () => {
  const text = '{\n  "policy": {\n    "states": [],\n    "n": 1, "ok": true,\n    "a": "[x]"\n  }\n}';

  it('keeps every character of the text, line by line', () => {
    const lines = aceJsonTokens(text);
    assert.equal(lines.length, 7);
    assert.equal(lines.map((line) => line.map((token) => token.text).join('')).join('\n'), text);
  });

  it('marks braces and brackets as parentheses of their own', () => {
    const lines = aceJsonTokens(text);
    assert.deepEqual(lines[0], [{ text: '{', kind: 'Paren' }]);
    assert.deepEqual(lines[1], [{ text: '  ' }, { text: '"policy"', kind: 'Key' }, { text: ': ' }, { text: '{', kind: 'Paren' }]);
    assert.deepEqual(lines[2], [
      { text: '    ' },
      { text: '"states"', kind: 'Key' },
      { text: ': ' },
      { text: '[', kind: 'Paren' },
      { text: ']', kind: 'Paren' },
      { text: ',' },
    ]);
    assert.deepEqual(lines[5], [{ text: '  ' }, { text: '}', kind: 'Paren' }]);
  });

  it('leaves keys, numbers, keywords and strings as they are, brackets in a string too', () => {
    const lines = aceJsonTokens(text);
    assert.deepEqual(
      lines[3].filter((token) => token.kind),
      [
        { text: '"n"', kind: 'Key' },
        { text: '1', kind: 'Number' },
        { text: '"ok"', kind: 'Key' },
        { text: 'true', kind: 'Keyword' },
      ]
    );
    assert.deepEqual(lines[4].filter((token) => token.kind), [
      { text: '"a"', kind: 'Key' },
      { text: '"[x]"', kind: 'String' },
    ]);
  });
});

describe('the guides of indentation in the JSON editor, as Ace draws them', () => {
  const text = '{\n    "a": {\n        "b": {\n            "c": 1\n        }\n    }\n}';
  const indent = { text: '    ', kind: 'Indent' };

  it('cuts every step of the indentation but the last into a run with a guide', () => {
    const lines = aceJsonTokens(text);
    assert.deepEqual(lines[1][0], { text: '    ' });
    assert.deepEqual(lines[2], [indent, { text: '    ' }, { text: '"b"', kind: 'Key' }, { text: ': ' }, { text: '{', kind: 'Paren' }]);
    assert.deepEqual(lines[3].slice(0, 4), [indent, indent, { text: '    ' }, { text: '"c"', kind: 'Key' }]);
    assert.deepEqual(lines[4], [indent, { text: '    ' }, { text: '}', kind: 'Paren' }]);
    assert.equal(lines.map((line) => line.map((token) => token.text).join('')).join('\n'), text);
  });

  it('draws no guide in an indentation of one step or less, and one in a step and a half', () => {
    assert.deepEqual(aceJsonTokens('{\n  "a": 1\n}')[1][0], { text: '  ' });
    assert.deepEqual(aceJsonTokens('{\n    "a": 1\n}')[1][0], { text: '    ' });
    assert.deepEqual(aceJsonTokens('{\n      "a": 1\n}')[1].slice(0, 2), [indent, { text: '  ' }]);
  });
});

describe('the line the JSON editor draws on a band, as Ace does', () => {
  const text = '{\n  "a": 1,\n  "b": 2\n}';

  it('is the line of the cursor', () => {
    assert.equal(aceActiveLine(text, 0, 0), 0);
    assert.equal(aceActiveLine(text, 1, 1), 0);
    assert.equal(aceActiveLine(text, 2, 2), 1);
    assert.equal(aceActiveLine(text, text.length, text.length), 3);
  });

  it('is the line of a selection within one line, and none for a selection over lines', () => {
    assert.equal(aceActiveLine(text, 4, 7), 1);
    assert.equal(aceActiveLine(text, 4, 14), undefined);
  });

  it('stays in the text when the text has become shorter than the cursor', () => {
    assert.equal(aceActiveLine('{}', 40, 40), 0);
    assert.equal(aceActiveLine('', 0, 0), 0);
  });
});

/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { leadingDebounce } from '../../web/apps/index_management/jobs';
import {
  aceActiveLine,
  aceEditorTokens,
  aceFoldsAt,
  aceGutterWidth,
  aceJsonTokens,
  aceLineRange,
  aceMatchingBracket,
  commonStates,
  dataStreamChoices,
  draftIsValid,
  jobStatus,
  retryDisabled,
  stillListed,
  withWildcard,
  type ManagedIndex,
} from '../../web/apps/index_management/policy_model';

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

describe('the line a click on its number selects in the JSON editor, as Ace does', () => {
  const text = '{\n  "a": 1,\n  "b": 2\n}';

  it('is the line with its break', () => {
    assert.deepEqual(aceLineRange(text, 0), [0, 2]);
    assert.deepEqual(aceLineRange(text, 2), [2, 12]);
    assert.deepEqual(aceLineRange(text, 5), [2, 12]);
    assert.deepEqual(aceLineRange(text, 12), [12, 21]);
  });

  it('ends with the text on the last line', () => {
    assert.deepEqual(aceLineRange(text, 21), [21, 22]);
    assert.deepEqual(aceLineRange(text, 22), [21, 22]);
  });

  it('is an empty line where the line is empty', () => {
    assert.deepEqual(aceLineRange('\n\nx', 0), [0, 1]);
    assert.deepEqual(aceLineRange('\n\nx', 1), [1, 2]);
    assert.deepEqual(aceLineRange('', 0), [0, 0]);
    assert.deepEqual(aceLineRange('{}', 40), [0, 2]);
  });
});

describe('the lines the JSON editor marks for folding, as Ace does', () => {
  it('marks a line where a brace or bracket opens and is not closed on it', () => {
    assert.ok(aceFoldsAt('{'));
    assert.ok(aceFoldsAt('    "states": ['));
    assert.ok(aceFoldsAt('  "a": { "b": 1,'));
    assert.ok(!aceFoldsAt('  "a": {},'));
    assert.ok(!aceFoldsAt('  "a": [1, 2]'));
    assert.ok(!aceFoldsAt('    ],'));
    assert.ok(!aceFoldsAt('}'));
    assert.ok(!aceFoldsAt(''));
  });

  it('looks into strings as Ace does', () => {
    assert.ok(!aceFoldsAt('  "source": "{{ctx.index}}_shrunken"'));
    assert.ok(aceFoldsAt('  "a": "[x"'));
  });

  it('marks a comment that opens, not one that closes on its line', () => {
    assert.ok(aceFoldsAt('  /* a'));
    assert.ok(!aceFoldsAt('  /* a */'));
    assert.ok(aceFoldsAt('//#region policies'));
    assert.ok(!aceFoldsAt('// #region'));
  });
});

describe('the bracket the JSON editor draws a box around, as Ace does', () => {
  const text = '{\n    "a": [1, {}],\n    "s": "{x}"\n}';
  const lines = aceJsonTokens(text);

  it('is the one that pairs with a bracket just before the cursor', () => {
    assert.deepEqual(aceMatchingBracket(lines, 3, 1), [0, 0]);
    assert.deepEqual(aceMatchingBracket(lines, 0, 1), [3, 0]);
    assert.deepEqual(aceMatchingBracket(lines, 1, 10), [1, 15]);
    assert.deepEqual(aceMatchingBracket(lines, 1, 16), [1, 9]);
    assert.deepEqual(aceMatchingBracket(lines, 1, 14), [1, 14]);
  });

  it('pairs a bracket in a string only with one in a string', () => {
    assert.deepEqual(aceMatchingBracket(lines, 2, 13), [2, 10]);
    const quoted = aceJsonTokens('{ "a": "}" }');
    assert.deepEqual(aceMatchingBracket(quoted, 0, 1), [0, 11]);
  });

  it('is none at the start of a line, after anything else, or without a pair', () => {
    assert.equal(aceMatchingBracket(lines, 1, 0), undefined);
    assert.equal(aceMatchingBracket(lines, 1, 6), undefined);
    assert.equal(aceMatchingBracket(aceJsonTokens('{\n  "a": 1'), 0, 1), undefined);
  });

  it('is drawn by a run of its own before the bracket, with the marks for folding at the starts of lines', () => {
    const drawn = aceEditorTokens(text, text.length);
    assert.deepEqual(drawn[0], [{ text: '', kind: 'Fold' }, { text: '', kind: 'Bracket' }, { text: '{', kind: 'Paren' }]);
    assert.deepEqual(drawn[1][0], { text: '    ' });
    assert.deepEqual(drawn[3], [{ text: '}', kind: 'Paren' }]);
    const nested = aceEditorTokens('{\n    "a": [\n        1\n    ]\n}');
    assert.deepEqual(
      nested.map((line) => line[0].kind),
      ['Fold', 'Fold', 'Indent', undefined, 'Paren']
    );
    const inString = aceEditorTokens(text, text.indexOf('x}') + 2)[2];
    assert.deepEqual(inString.slice(-3), [
      { text: '"', kind: 'String' },
      { text: '', kind: 'Bracket' },
      { text: '{x}"', kind: 'String' },
    ]);
    assert.equal(
      aceEditorTokens(text, 0)
        .flat()
        .filter((token) => token.kind === 'Bracket').length,
      0
    );
  });
});

describe('how wide the JSON editor draws the numbers of its lines, as Ace does', () => {
  it('is as wide as the number of the last line of a short text needs', () => {
    assert.equal(aceGutterWidth(1, 100, 16), 42);
    assert.equal(aceGutterWidth(6, 500, 16), 42);
    assert.equal(aceGutterWidth(9, 500, 16), 42);
    assert.equal(aceGutterWidth(10, 500, 16), 50);
    assert.equal(aceGutterWidth(99, 2000, 16), 50);
    assert.equal(aceGutterWidth(100, 2000, 16), 59);
  });

  it('counts only the lines that are drawn: a long text in a low editor starts narrow', () => {
    // 100 px: seven lines of 16 px and one more, six of 18 px and one more
    assert.equal(aceGutterWidth(40, 100, 16), 42);
    assert.equal(aceGutterWidth(40, 100, 18), 42);
    assert.equal(aceGutterWidth(40, 600, 16), 50);
  });

  it('widens once the tenth line is drawn', () => {
    assert.equal(aceGutterWidth(40, 100, 16, 31), 42);
    assert.equal(aceGutterWidth(40, 100, 16, 32), 50);
    assert.equal(aceGutterWidth(40, 100, 18, 53), 42);
    assert.equal(aceGutterWidth(40, 100, 18, 54), 50);
  });

  it('is never narrower than one digit needs', () => {
    assert.equal(aceGutterWidth(0, 100, 16), 42);
    assert.equal(aceGutterWidth(5, 0, 16), 42);
    assert.equal(aceGutterWidth(12, 100, 0), 50);
  });
});

describe('a part of an action that is edited as text', () => {
  it('may be left empty, and is JSON otherwise', () => {
    assert.ok(draftIsValid(undefined));
    assert.ok(draftIsValid(''));
    assert.ok(draftIsValid('{ "source": "{{ctx.index}}_shrunken" }'));
    assert.ok(draftIsValid('[]'));
    assert.ok(!draftIsValid('{ "source": '));
    assert.ok(!draftIsValid('x'));
  });
});

/** A managed index with what the list says of it; a policy of the states named */
function managed(
  index: string,
  meta: ManagedIndex['managedIndexMetaData'],
  states?: string[]
): ManagedIndex {
  return {
    index,
    indexUuid: `${index}-uuid`,
    dataStream: null,
    policyId: 'p',
    policy: states ? { default_state: states[0] ?? '', states: states.map((name) => ({ name })) } : null,
    enabled: true,
    managedIndexMetaData: meta,
  };
}

describe('the job status of a managed index, as the plugin words it', () => {
  it('is initializing until the index has metadata', () => {
    assert.equal(jobStatus(managed('a', null)), 'Initializing');
  });

  it('is completed, then failed, then running', () => {
    assert.equal(jobStatus(managed('a', { policyCompleted: true, action: { failed: true } })), 'Completed');
    assert.equal(jobStatus(managed('a', { retryInfo: { failed: true } })), 'Failed');
    assert.equal(jobStatus(managed('a', { action: { name: 'rollover', failed: true } })), 'Failed');
    assert.equal(jobStatus(managed('a', { action: { name: 'rollover', failed: false } })), 'Running');
    assert.equal(jobStatus(managed('a', {})), 'Running');
  });
});

describe('whether the ticked managed indexes may be retried', () => {
  const failed = managed('a', { action: { failed: true } });
  const retrying = managed('b', { retryInfo: { failed: true } });

  it('needs one ticked, and every ticked one failed', () => {
    assert.equal(retryDisabled([]), true);
    assert.equal(retryDisabled([failed, retrying]), false);
    assert.equal(retryDisabled([failed, managed('c', {})]), true);
    assert.equal(retryDisabled([failed, managed('d', null)]), true);
  });
});

describe('the states a retry may start from', () => {
  it('are those every ticked index has, in the order of the first one', () => {
    const first = managed('a', {}, ['hot', 'warm', 'delete', 'hot']);
    const second = managed('b', {}, ['delete', 'hot', 'cold']);
    assert.deepEqual(commonStates([first]), ['hot', 'warm', 'delete']);
    assert.deepEqual(commonStates([first, second]), ['hot', 'delete']);
  });

  it('are none when an index has no policy, or nothing is shared', () => {
    assert.deepEqual(commonStates([]), []);
    assert.deepEqual(commonStates([managed('a', {}, ['hot']), managed('b', {})]), []);
    assert.deepEqual(commonStates([managed('a', {}, ['hot']), managed('b', {}, ['cold'])]), []);
  });
});

describe('the rows that stay ticked when a list is drawn again', () => {
  const id = (row: { id: string; n: number }) => row.id;
  const ticked = [
    { id: 'a', n: 1 },
    { id: 'b', n: 1 },
  ];

  it('are the ticked rows still shown, as they were when ticked', () => {
    const kept = stillListed(ticked, [{ id: 'b', n: 2 }, { id: 'c', n: 2 }], id);
    assert.deepEqual(kept, [{ id: 'b', n: 1 }]);
  });

  it('are the same array when all of them are still shown', () => {
    assert.equal(stillListed(ticked, [{ id: 'a', n: 2 }, { id: 'b', n: 2 }], id), ticked);
  });
});

describe('the options of a field that searches as it is typed in', () => {
  it('put what is typed with a * after it first, once something is typed', () => {
    assert.deepEqual(withWildcard('logs', ['logs-1', 'logs-2']), ['logs*', 'logs-1', 'logs-2']);
    assert.deepEqual(withWildcard(' lo ', ['logs-1']), [' lo *', 'logs-1']);
    assert.deepEqual(withWildcard('  ', ['logs-1']), ['logs-1']);
  });
});

describe('the data streams the "Data streams" filter lists', () => {
  const names = ['logs', 'Metrics', 'traces', 'metrics-2'];

  it('put the chosen one first', () => {
    assert.deepEqual(dataStreamChoices(names, []), names);
    assert.deepEqual(dataStreamChoices(names, ['traces']), ['traces', 'logs', 'Metrics', 'metrics-2']);
  });

  it('keep those that start with what is typed, whatever its case, in their order', () => {
    assert.deepEqual(dataStreamChoices(names, ['traces'], 'MET'), ['Metrics', 'metrics-2']);
    assert.deepEqual(dataStreamChoices(names, [], 'rics'), []);
    assert.deepEqual(dataStreamChoices(names, ['traces'], ''), names);
  });
});

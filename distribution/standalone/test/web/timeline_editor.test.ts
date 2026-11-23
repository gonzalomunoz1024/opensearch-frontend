/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getArgValueSuggestions } from '../../web/vis/timeline/arg_value_suggestions';
import {
  SUGGESTION_TYPE,
  cursorColumn,
  filterCompletions,
  getSuggestion,
  parseExpression,
  suggest,
  wordStart,
  type TimelineFunction,
} from '../../web/vis/timeline/expression_context';
import { isValidOpenSearchInterval, isValidTimelineInterval } from '../../web/vis/timeline/interval_input';
import type { Field } from '../../web/lib/types';

const noSources = getArgValueSuggestions({
  findIndexPatterns: async () => [],
  getFields: async () => [],
});

const parseError = (expression: string): unknown => {
  try {
    parseExpression(expression);
  } catch (error) {
    return JSON.parse((error as Error).message);
  }
  return undefined;
};

// The cases of upstream's timeline_expression_input_helpers.test.ts
describe('Timeline expression suggestions', () => {
  const argValueSuggestions = noSources;
  const func1 = {
    name: 'func1',
    chainable: true,
    args: [{ name: 'inputSeries' }, { name: 'argA' }, { name: 'argAB', suggestions: [{ name: 'value1' }] }],
  } as TimelineFunction;
  const myFunc2 = {
    name: 'myFunc2',
    chainable: false,
    args: [{ name: 'argA' }, { name: 'argAB' }, { name: 'argABC' }],
  } as TimelineFunction;
  const functionList = [func1, myFunc2];
  const run = (expression: string, cursorPosition: number) =>
    suggest(expression, functionList, cursorPosition, argValueSuggestions);

  describe('parse exception', () => {
    describe('incompleteFunction', () => {
      it('should return function suggestions', async () => {
        assert.deepEqual(await run('.', 1), { list: [func1, myFunc2], type: SUGGESTION_TYPE.FUNCTIONS });
      });
      it('should filter function suggestions by function name', async () => {
        assert.deepEqual(await run('.myF', 4), { list: [myFunc2], type: SUGGESTION_TYPE.FUNCTIONS });
      });
    });

    describe('no argument name provided', () => {
      it('should return no argument suggestions when none provided by help', async () => {
        assert.deepEqual(await run('.otherFunc(=)', 0), { list: [], type: SUGGESTION_TYPE.ARGUMENTS });
      });
      it('should return argument suggestions when provided by help', async () => {
        assert.deepEqual(await run('.myFunc2(=)', 0), { list: myFunc2.args, type: SUGGESTION_TYPE.ARGUMENTS });
      });
      it('should return argument suggestions when argument value provided', async () => {
        assert.deepEqual(await run('.myFunc2(=whatArgumentAmI)', 0), {
          list: myFunc2.args,
          type: SUGGESTION_TYPE.ARGUMENTS,
        });
      });
      it('should not show first argument for chainable functions', async () => {
        assert.deepEqual(await run('.func1(=)', 0), {
          list: [{ name: 'argA' }, { name: 'argAB', suggestions: [{ name: 'value1' }] }],
          type: SUGGESTION_TYPE.ARGUMENTS,
        });
      });
      it('should not provide argument suggestions for argument that is all ready set in function def', async () => {
        assert.deepEqual(await run('.myFunc2(argAB=provided,=)', 0), {
          list: [{ name: 'argA' }, { name: 'argABC' }],
          type: SUGGESTION_TYPE.ARGUMENTS,
        });
      });
    });

    describe('no argument value provided', () => {
      it('should return no argument value suggestions when not provided by help', async () => {
        assert.deepEqual(await run('.func1(argA=)', 11), { list: [], type: SUGGESTION_TYPE.ARGUMENT_VALUE });
      });
      it('should return argument value suggestions when provided by help', async () => {
        assert.deepEqual(await run('.func1(argAB=)', 11), {
          list: [{ name: 'value1' }],
          type: SUGGESTION_TYPE.ARGUMENT_VALUE,
        });
      });
    });
  });

  describe('parse cleanly', () => {
    describe('cursor in function name', () => {
      it('should return function suggestion', async () => {
        assert.deepEqual(await run('.func1()', 1), { list: [func1], type: SUGGESTION_TYPE.FUNCTIONS });
      });
    });

    describe('cursor in argument name', () => {
      it('should return argument suggestions', async () => {
        assert.deepEqual(await run('.myFunc2()', 9), { list: myFunc2.args, type: SUGGESTION_TYPE.ARGUMENTS });
      });
      it('should not provide argument suggestions for argument that is all ready set in function def', async () => {
        assert.deepEqual(await run('.myFunc2(argAB=provided,)', 24), {
          list: [{ name: 'argA' }, { name: 'argABC' }],
          type: SUGGESTION_TYPE.ARGUMENTS,
        });
      });
      it('should filter argument suggestions by argument name', async () => {
        assert.deepEqual(await run('.myFunc2(argAB,)', 14), {
          list: [{ name: 'argAB' }, { name: 'argABC' }],
          type: SUGGESTION_TYPE.ARGUMENTS,
        });
      });
      it('should not show first argument for chainable functions', async () => {
        assert.deepEqual(await run('.func1()', 7), {
          list: [{ name: 'argA' }, { name: 'argAB', suggestions: [{ name: 'value1' }] }],
          type: SUGGESTION_TYPE.ARGUMENTS,
        });
      });
    });

    describe('cursor in argument value', () => {
      it('should return no argument value suggestions when not provided by help', async () => {
        assert.deepEqual(await run('.myFunc2(argA=42)', 14), { list: [], type: SUGGESTION_TYPE.ARGUMENT_VALUE });
      });
      it('should return no argument value suggestions when provided by help', async () => {
        assert.deepEqual(await run('.func1(argAB=val)', 16), {
          list: [{ name: 'value1' }],
          type: SUGGESTION_TYPE.ARGUMENT_VALUE,
        });
      });
    });
  });

  it('gives nothing for an expression that is not well formed', async () => {
    assert.equal(await run('.func1(argA=1))', 3), undefined);
    assert.equal(await run('$a', 1), undefined);
    assert.equal(await run('', 0), undefined);
  });

  it('gives nothing in an argument whose value is a chain, as upstream does', async () => {
    assert.equal(await run('.func1(argA=.myFunc2())', 8), undefined);
    assert.deepEqual(await run('.func1(argA=.myFunc2())', 13), { list: [myFunc2], type: SUGGESTION_TYPE.FUNCTIONS });
  });
});

describe('the grammar of a Timeline expression', () => {
  it('reads functions, their arguments and where they lie', () => {
    const result = parseExpression('.es(index=logs, metric="avg:bytes").label(\'A b\')');
    assert.deepEqual(
      result.functions.map(({ function: name, location, text }) => ({ name, location, text })),
      [
        { name: 'es', location: { min: 0, max: 35 }, text: '.es(index=logs, metric="avg:bytes")' },
        { name: 'label', location: { min: 35, max: 48 }, text: ".label('A b')" },
      ]
    );
    const [index, metric] = result.functions[0].arguments;
    assert.deepEqual(index, {
      type: 'namedArg',
      name: 'index',
      value: { type: 'literal', value: 'logs', location: { min: 10, max: 14 }, text: 'logs' },
      location: { min: 4, max: 14 },
      text: 'index=logs',
      function: 'es',
    });
    assert.equal(metric.value?.value, 'avg:bytes');
    assert.equal(metric.value?.text, '"avg:bytes"');
    assert.equal(result.functions[1].arguments[0].type, 'literal');
    assert.equal(result.args.length, 3);
  });

  it('reads numbers, booleans, null, escapes, references, groups and variables', () => {
    const result = parseExpression(
      '$x=.static(1), (.es(*), $x).sum(), @1:2, .f(a=-1.5, b=true, c=null, d="say \\"hi\\"")'
    );
    assert.equal(result.tree.length, 3);
    assert.deepEqual(result.tree[1], { type: 'reference', plot: 1, series: 2 });
    const f = result.functions.find((item) => item.function === 'f');
    assert.deepEqual(
      f?.arguments.map((arg) => arg.value?.value),
      [-1.5, true, null, 'say "hi"']
    );
    assert.equal((result.tree[0] as { chain: Array<{ label?: string }> }).chain[0].label, '(.es(*), $x).sum()');
  });

  it('stops with what is incomplete, as the generated parser does', () => {
    assert.deepEqual(parseError('.es().'), {
      type: 'incompleteFunction',
      function: null,
      location: { min: 5, max: 6 },
      text: '.',
    });
    // A function left open reads as one being named
    assert.deepEqual(parseError('.es(q=foo'), {
      type: 'incompleteFunction',
      function: 'es',
      location: { min: 0, max: 3 },
      text: '.es',
    });
    const value = parseError('.es(index=logs, metric=)') as Record<string, unknown>;
    assert.equal(value.type, 'incompleteArgumentValue');
    assert.equal(value.name, 'metric');
    assert.equal(value.currentFunction, 'es');
    assert.deepEqual(
      (value.currentArgs as Array<{ name: string }>).map((arg) => arg.name),
      ['index']
    );
    assert.deepEqual(parseError('.es(=)'), {
      type: 'incompleteArgument',
      currentArgs: [],
      currentFunction: 'es',
      location: { min: 4, max: 5 },
      text: '=',
    });
    assert.throws(() => parseExpression('.es(x)y)'), SyntaxError);
    assert.throws(() => parseExpression('$nope'), /\$nope is not defined/);
  });
});

describe('what a Timeline suggestion inserts', () => {
  it('a function with its parentheses, the cursor between them', () => {
    const item = getSuggestion({ name: 'es', chainable: false, args: [], help: 'Pull data' }, SUGGESTION_TYPE.FUNCTIONS);
    assert.deepEqual(item, {
      detail: '(Data source)',
      insertText: 'es()',
      cursor: 3,
      kind: 'function',
      label: 'es',
      documentation: 'Pull data',
      retrigger: true,
    });
    assert.equal(getSuggestion({ name: 'abs', chainable: true, args: [] }, SUGGESTION_TYPE.FUNCTIONS).detail, '(Chainable)');
  });

  it('an argument with its equals sign, and what it accepts', () => {
    const item = getSuggestion({ name: 'q', types: ['string', 'null'] }, SUGGESTION_TYPE.ARGUMENTS);
    assert.equal(item.insertText, 'q=');
    assert.equal(item.detail, 'Accepts: string,null');
    assert.equal(item.kind, 'property');
  });

  it('a value with a comma, after the colon of a metric, and nothing more for an unfinished one', () => {
    assert.equal(getSuggestion({ name: 'logs' }, SUGGESTION_TYPE.ARGUMENT_VALUE).insertText, 'logs,');
    const metric = getSuggestion({ name: 'avg:bytes', help: 'number' }, SUGGESTION_TYPE.ARGUMENT_VALUE);
    assert.equal(metric.insertText, 'bytes,');
    assert.equal(metric.detail, 'number');
    assert.equal(getSuggestion({ name: 'avg:' }, SUGGESTION_TYPE.ARGUMENT_VALUE).insertText, 'avg:');
  });
});

describe('the word a Timeline suggestion replaces', () => {
  it('starts after a separator', () => {
    assert.equal(wordStart('.es(metric=avg:byt', 18), 15);
    assert.equal(wordStart('.es(', 4), 4);
    assert.equal(wordStart('.myF', 4), 1);
    assert.equal(wordStart('logstash-*', 10), 10);
  });

  it('counts the cursor on its own line, as upstream does', () => {
    const at = cursorColumn('.es(*),\n.es(q=x)', 12);
    assert.equal(at.column, 4);
    assert.equal(at.lineStart, 8);
    assert.equal(at.line, '.es(q=x)');
  });

  it('narrows a list to what matches, best first', () => {
    const items = ['sum:', 'avg:', 'avg:bytes', 'max:', 'bytesIn'].map((name) =>
      getSuggestion({ name }, SUGGESTION_TYPE.ARGUMENT_VALUE)
    );
    assert.deepEqual(
      filterCompletions(items, '').map((item) => item.label),
      ['avg:', 'avg:bytes', 'bytesIn', 'max:', 'sum:']
    );
    assert.deepEqual(
      filterCompletions(items, 'byt').map((item) => item.label),
      ['bytesIn', 'avg:bytes']
    );
    assert.deepEqual(
      filterCompletions(items, 'bi').map((item) => item.label),
      ['bytesIn']
    );
  });
});

describe('the values of the es function looked up in the browser', () => {
  const fields: Field[] = [
    { name: 'bytes', type: 'number', searchable: true, aggregatable: true },
    { name: 'nested.n', type: 'number', searchable: true, aggregatable: true, subType: { nested: { path: 'nested' } } },
    { name: '@timestamp', type: 'date', searchable: true, aggregatable: true },
    { name: 'host', type: 'string', searchable: true, aggregatable: true },
    { name: 'message', type: 'string', searchable: true, aggregatable: false },
  ];
  const searches: Array<string | undefined> = [];
  const lookups = getArgValueSuggestions({
    findIndexPatterns: async ({ search }) => {
      searches.push(search);
      return [
        { id: 'a', attributes: { title: 'logs*' } },
        { id: 'b', attributes: { title: 'rolled', type: 'rollup' } },
      ];
    },
    getFields: async (id) => (id === 'a' ? fields : []),
  });
  const list: TimelineFunction[] = [
    { name: 'es', chainable: false, args: [{ name: 'q' }, { name: 'index' }, { name: 'metric' }, { name: 'timefield' }, { name: 'split' }] },
  ];

  it('index patterns for index, without those of a kind', async () => {
    assert.deepEqual(await suggest('.es(index=)', list, 10, lookups), {
      list: [{ name: 'logs*' }],
      type: SUGGESTION_TYPE.ARGUMENT_VALUE,
    });
    assert.deepEqual(searches, [undefined]);
  });

  it('the kinds of metric, then the number fields of the index', async () => {
    const kinds = await suggest('.es(index=logs*, metric=)', list, 24, lookups);
    assert.equal(kinds?.list.length, 7);
    assert.deepEqual(await suggest('.es(index=logs*, metric=avg:)', list, 28, lookups), {
      list: [{ name: 'avg:bytes', help: 'number' }],
      type: SUGGESTION_TYPE.ARGUMENT_VALUE,
    });
  });

  it('date fields for timefield, aggregatable ones for split', async () => {
    assert.deepEqual((await suggest('.es(index=logs*, timefield=)', list, 27, lookups))?.list, [{ name: '@timestamp' }]);
    assert.deepEqual(
      (await suggest('.es(index=logs*, split=h)', list, 24, lookups))?.list,
      [{ name: 'host', help: 'string' }]
    );
    assert.deepEqual((await suggest('.es(split=)', list, 10, lookups))?.list, []);
  });
});

describe('the interval of a Timeline visualization', () => {
  it('takes the options and what OpenSearch takes', () => {
    for (const value of ['auto', '1s', '30s', '20m', '24h', '2d', '1w', '1M', '1y', '100ms']) {
      assert.equal(isValidTimelineInterval(value), true, value);
    }
    for (const value of ['', '2w', '2M', '1.5h', '2f', '0s', 'h']) {
      assert.equal(isValidTimelineInterval(value), false, value);
    }
    assert.equal(isValidOpenSearchInterval(' 1d '), true);
  });
});

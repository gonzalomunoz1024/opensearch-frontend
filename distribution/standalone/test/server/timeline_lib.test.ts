/* SPDX-License-Identifier: Apache-2.0 */

// The parser, parse_sheet, load_functions, offset_time and the fit functions of Timeline.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { functions, getFunction } from '../../server/timeline';
import { addTime, calculateInterval, toMS } from '../../server/timeline/dates';
import { fitFunctions } from '../../server/timeline/fit_functions';
import { parseSheet, preprocessOffset, repositionArguments } from '../../server/timeline/lib';
import { parse, SyntaxError } from '../../server/timeline/parser';
import type { Point } from '../../server/timeline/types';

const year = (y: number) => Date.UTC(y, 0, 1);
const points = (list: Array<[number, number | null]>) => list as Point[];

describe('the Timeline expression parser (chain.peg)', () => {
  it('parses chains, named and positional arguments and references', () => {
    const result = parse('.es(q=a, 5).label("x"), @1:2');
    assert.deepEqual(result.tree[1], { type: 'reference', plot: 1, series: 2 });
    const chain = result.tree[0] as { type: string; chain: unknown[] };
    assert.equal(chain.type, 'chain');
    assert.deepEqual(chain.chain[0], {
      type: 'function',
      function: 'es',
      arguments: [
        {
          type: 'namedArg',
          name: 'q',
          value: { type: 'literal', value: 'a', location: { min: 6, max: 7 }, text: 'a' },
          location: { min: 4, max: 7 },
          text: 'q=a',
          function: 'es',
        },
        { type: 'literal', value: 5, location: { min: 9, max: 10 }, text: '5', function: 'es' },
      ],
      location: { min: 0, max: 11 },
      text: '.es(q=a, 5)',
    });
    assert.deepEqual(
      result.functions.map((fn) => fn.function),
      ['es', 'label']
    );
    assert.equal(result.args.length, 3);
    assert.deepEqual(result.variables, {});
  });

  it('parses a chain as an argument, and lists the functions inside it first', () => {
    const result = parse('.static(1).add(.static(2))');
    assert.deepEqual(
      result.functions.map((fn) => fn.function),
      ['static', 'static', 'add']
    );
    const add = (result.tree[0] as { chain: Array<{ arguments: unknown[] }> }).chain[1];
    assert.equal((add.arguments[0] as { type: string; function: string }).type, 'chain');
    assert.equal((add.arguments[0] as { function: string }).function, 'add');
  });

  it('tells an incomplete function', () => {
    try {
      parse('.es(');
      assert.fail('parsed');
    } catch (e) {
      assert.ok(e instanceof SyntaxError);
      assert.equal(e.expected, null);
      assert.deepEqual(JSON.parse(e.message), {
        type: 'incompleteFunction',
        function: 'es',
        location: { min: 0, max: 3 },
        text: '.es',
      });
    }
  });

  it('tells an incomplete argument value', () => {
    assert.throws(() => parse('.a(b='), (e: Error) => {
      assert.deepEqual(JSON.parse(e.message), {
        type: 'incompleteArgumentValue',
        currentArgs: [],
        currentFunction: 'a',
        name: 'b',
        location: { min: 3, max: 5 },
        text: 'b=',
      });
      return true;
    });
  });

  it('tells an undefined variable', () => {
    assert.throws(() => parse('.a($x=1)'), { name: 'SyntaxError', message: '$x is not defined' });
  });

  it('gives what it expected, as peggy does', () => {
    assert.throws(() => parse('foo'), (e: SyntaxError) => {
      assert.equal(e.message, 'Expected "$", "(", "@", [ \\t\\r\\n], or function but "f" found.');
      assert.deepEqual(e.expected?.[0], {
        type: 'class',
        parts: [' ', '\t', '\r', '\n'],
        inverted: false,
        ignoreCase: false,
      });
      assert.equal(e.found, 'f');
      assert.deepEqual(e.location.start, { offset: 0, line: 1, column: 1 });
      assert.deepEqual(e.location.end, { offset: 1, line: 1, column: 2 });
      return true;
    });
  });
});

describe('timeline parse_sheet function', () => {
  it("doesn't split expressions on whitespace", () => {
    const expressions = parseSheet(['.opensearch() .opensearch(404)'])[0];
    assert.equal(expressions.length, 1);
    assert.equal(expressions[0]?.type, 'chain');
  });

  it('splits expressions on commas', () => {
    const expressions = parseSheet(['.opensearch(), .opensearch(404)'])[0];
    assert.equal(expressions.length, 2);
    assert.equal(expressions[0]?.type, 'chain');
    assert.equal(expressions[1]?.type, 'chain');
  });

  it('splits expressions on newlines', () => {
    const expressions = parseSheet([`.opensearch()\n\r ,\n\r .opensearch(404)`])[0];
    assert.equal(expressions.length, 2);
    assert.equal(expressions[0]?.type, 'chain');
    assert.equal(expressions[1]?.type, 'chain');
  });

  it('words a parse error as upstream does, with what its message reads', () => {
    assert.throws(() => parseSheet(['foo']), { message: 'Expected:  at character ' });
  });
});

describe('load_functions', () => {
  it('has keys named for the files of series_functions', () => {
    assert.equal(typeof functions.sum, 'object');
  });

  it('also names keys for the directories, and for the aliases', () => {
    assert.equal(typeof functions.es, 'object');
    assert.equal(functions.opensearch.name, 'es');
    assert.equal(functions.plus.name, 'sum');
    assert.equal(functions.if.name, 'condition');
  });

  it('tells an unknown function', () => {
    assert.throws(() => getFunction('beer'), { message: 'No such function: beer' });
  });
});

describe('reposition_arguments', () => {
  it('puts named arguments in their place', () => {
    const fn = getFunction('label');
    const named = { type: 'namedArg', name: 'regex', value: 'x' };
    const ordered = repositionArguments(fn, ['input', named]);
    assert.equal(ordered.length, 3);
    assert.equal(ordered[0], 'input');
    assert.equal(ordered[1], undefined);
    assert.equal(ordered[2], 'x');
  });

  it('throws on an unknown argument', () => {
    const fn = getFunction('label');
    const named = { type: 'namedArg', name: 'beer', value: 'x' };
    assert.throws(() => repositionArguments(fn, ['input', named]), {
      message: 'Unknown argument to label: beer',
    });
  });
});

describe('offset', () => {
  describe('preprocessOffset', () => {
    const from = Date.parse('2018-01-01T00:00:00.000Z');
    const to = Date.parse('2018-01-01T00:15:00.000Z');

    it('throws error when no number is provided', () => {
      assert.throws(() => preprocessOffset('timerange', from, to));
    });

    it('throws error when zero is provided', () => {
      assert.throws(() => preprocessOffset('timerange:0', from, to));
    });

    it('throws error when factor is larger than zero', () => {
      assert.throws(() => preprocessOffset('timerange:1', from, to));
    });

    it('throws error with malformed', () => {
      assert.throws(() => preprocessOffset('timerange:notANumber', from, to));
    });

    it('does not modify offset when value is not requesting relative offset', () => {
      assert.equal(preprocessOffset('-1d', from, to), '-1d');
    });

    it('converts offset when value is requesting relative offset with multiplier', () => {
      assert.equal(preprocessOffset('timerange:-2', from, to), '-1800s');
    });
  });
});

describe('calculate_interval', () => {
  const to = Date.now();
  const from = (count: number, unit: string) => addTime(to, count, unit, -1);
  const size = 200;

  it('Only calculates when interval = auto', () => {
    const partialFn = (interval: string) => calculateInterval(from(1, 'y'), to, size, interval, '1ms');
    assert.equal(partialFn('1ms'), '1ms');
    assert.equal(partialFn('bag_of_beans'), 'bag_of_beans');
    assert.notEqual(partialFn('auto'), 'auto');
  });

  it('Calculates nice round intervals', () => {
    const partialFn = (count: number, unit: string) =>
      calculateInterval(from(count, unit), to, size, 'auto', '1ms');
    assert.equal(partialFn(15, 'm'), '1s');
    assert.equal(partialFn(1, 'h'), '30s');
    assert.equal(partialFn(3, 'd'), '30m');
    assert.equal(partialFn(1, 'w'), '1h');
    assert.equal(partialFn(1, 'y'), '24h');
    assert.equal(partialFn(100, 'y'), '1y');
  });

  it('Does not calculate an interval lower than the minimum', () => {
    const partialFn = (count: number, unit: string) =>
      calculateInterval(from(count, unit), to, size, 'auto', '1m');
    assert.equal(partialFn(5, 's'), '1m');
    assert.equal(partialFn(15, 'm'), '1m');
    assert.equal(partialFn(1, 'h'), '1m');
    assert.equal(partialFn(3, 'd'), '30m');
    assert.equal(partialFn(1, 'w'), '1h');
    assert.equal(partialFn(1, 'y'), '24h');
    assert.equal(partialFn(100, 'y'), '1y');
  });

  it('reads moment durations as moment does', () => {
    assert.equal(toMS('1y'), 31556952000);
    assert.equal(toMS('1M'), 2629746000);
    assert.equal(toMS('2w'), 1209600000);
    assert.equal(toMS('beer'), undefined);
  });
});

describe('the fit functions', () => {
  describe('average', () => {
    it('fills holes in the data', () => {
      const data = points([
        [year(1980), 10],
        [year(1983), 40],
        [year(1984), 50],
      ]);
      const target = points([1980, 1981, 1982, 1983, 1984].map((y) => [year(y), null]));
      assert.deepEqual(
        fitFunctions.average(data, target).map((p) => p[1]),
        [10, 20, 30, 40, 50]
      );
    });

    it('samples up', () => {
      const data = points([
        [year(1981), 10],
        [year(1983), 30],
        [year(1985), 70],
      ]);
      const target = points([1981, 1982, 1983, 1984, 1985].map((y) => [year(y), null]));
      assert.deepEqual(
        fitFunctions.average(data, target).map((p) => p[1]),
        [10, 20, 30, 50, 70]
      );
    });

    it('samples down, left aligned', () => {
      const data = points([1980, 1981, 1982, 1983, 1984, 1985, 1986].map((y, i) => [year(y), i * 2]));
      const target = points([1981, 1983, 1985].map((y) => [year(y), null]));
      assert.deepEqual(
        fitFunctions.average(data, target).map((p) => p[1]),
        [1, 5, 9]
      );
    });
  });

  describe('carry', () => {
    it('fills holes in the data', () => {
      const data = points([
        [year(1980), 10],
        [year(1983), 40],
        [year(1984), 50],
      ]);
      const target = points([1980, 1981, 1982, 1983, 1984].map((y) => [year(y), null]));
      assert.deepEqual(
        fitFunctions.carry(data, target).map((p) => p[1]),
        [10, 10, 10, 40, 50]
      );
    });

    it('samples up', () => {
      const data = points([
        [year(1981), 10],
        [year(1983), 30],
        [year(1985), 70],
      ]);
      const target = points([1981, 1982, 1983, 1984, 1985].map((y) => [year(y), null]));
      assert.deepEqual(
        fitFunctions.carry(data, target).map((p) => p[1]),
        [10, 10, 30, 30, 70]
      );
    });

    it('does not sample down', () => {
      const data = points([1980, 1981, 1982, 1983, 1984, 1985, 1986].map((y, i) => [year(y), i * 2]));
      const target = points([1981, 1983, 1985].map((y) => [year(y), null]));
      assert.throws(() => fitFunctions.carry(data, target), Error);
    });
  });
});

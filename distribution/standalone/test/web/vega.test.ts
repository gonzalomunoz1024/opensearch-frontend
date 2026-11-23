/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The parts of the Vega visualization, checked against OpenSearch Dashboards. The cases are those
 * of the original's own Vega tests, and the expected values are what the original's code answers:
 * the packages it reads and draws Vega with (hjson 3.2.1, json-stringify-pretty-compact 1.2.0,
 * vega-interpreter 1.2.1, vega-tooltip 0.30.0, compare-versions 3.5.1, vega-schema-url-parser
 * 2.2.0, vega-spec-injector 0.0.2 and leaflet-vega 0.9.0, jQuery 3.6.0's param) and its spec
 * editor's colouring, read from a running copy. Vega and Vega-Lite are the browser builds the
 * product ships, run here from the package's directory.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { runInThisContext } from 'node:vm';
import { SERIES_COLORS } from '../../web/charts/core';
import { compactJson } from '../../web/lib/compact_json';
import { parseHjson, stringifyHjson } from '../../web/lib/hjson';
import { tokenizeHjson, tokenizeHjsonLine, type HjsonLineState } from '../../web/lib/hjson_tokens';
import type { BoolQuery } from '../../web/lib/query';
import type { Filter, Query } from '../../web/lib/types';
import {
  BYPASS_TOKEN,
  EmsFileParser,
  OpenSearchQueryParser,
  PPLQueryParser,
  TimeCache,
  UrlParser,
  contextQuery,
  pplTime,
  queryParams,
  roundInterval,
  type MapsServiceSettings,
  type SpecObject,
  type VegaSearchApi,
  type VegaSearchRequest,
} from '../../web/vis/vega/data_parsers';
import { serializeColumns, specLines, vegaDataSets, vegaSignals } from '../../web/vis/vega/debug_view';
import {
  columnWidths,
  columnsButtonText,
  jsonTokens,
  movedColumn,
  sortButtonText,
  sortedBy,
  sortedRows,
  type GridColumn,
  type GridRow,
  type GridSort,
} from '../../web/vis/vega/inspector_grid';
import { extractIndexPatternTitles } from '../../web/vis/vega/index_patterns';
import { createExpressionInterpreter } from '../../web/vis/vega/interpreter';
import type { VegaLibraries, VegaView } from '../../web/vis/vega/library';
import { SpecInjector, defaultProjection, readSetMapView } from '../../web/vis/vega/map_spec';
import { VegaParser, compareVersions, parseSchemaUrl, type VegaParserDependencies } from '../../web/vis/vega/parser';
import { escapeHtml, formatErrorToStr, formatWarningToStr, isEmpty, isPlainObject } from '../../web/vis/vega/utils';
import { validateVegaExpression } from '../../web/vis/vega/validation';
import {
  calculatePopoverPosition,
  checkForFunctionProperty,
  formatTooltipValue,
  handleInvalidDate,
  handleInvalidQuery,
  parseTimeRange,
  validateObject,
} from '../../web/vis/vega/view';

// --- Vega and Vega-Lite, as the page loads them ------------------------------------------------------

interface SceneItem {
  items?: SceneItem[];
  [channel: string]: unknown;
}

/** What these tests use of Vega beside what the product names */
interface TestView {
  runAsync(): Promise<unknown>;
  signal(name: string): unknown;
  data(name: string): unknown[];
  scenegraph(): { root: SceneItem };
}
interface TestVega {
  parse(spec: unknown, config?: unknown, options?: { ast: boolean }): unknown;
  View: new (runtime: unknown, options: Record<string, unknown>) => TestView;
}

function loadLibraries(): VegaLibraries {
  const scope = globalThis as unknown as Partial<VegaLibraries>;
  // each build sets its global, Vega-Lite's after reading Vega's
  if (!scope.vega) runInThisContext(readFileSync('node_modules/vega/build/vega.min.js', 'utf8'), { filename: 'vega.min.js' });
  if (!scope.vegaLite) runInThisContext(readFileSync('node_modules/vega-lite/build/vega-lite.min.js', 'utf8'), { filename: 'vega-lite.min.js' });
  return { vega: scope.vega, vegaLite: scope.vegaLite } as VegaLibraries;
}

const libraries = loadLibraries();
const vega = libraries.vega as unknown as TestVega;
const VEGA_SCHEMA = 'https://vega.github.io/schema/vega/v6.json';
const VEGA_LITE_SCHEMA = 'https://vega.github.io/schema/vega-lite/v5.json';

// --- HJSON and compact JSON ------------------------------------------------------------------------

const SPEC_TEXT = `{
  # comment
  a: 1
  b: hello world
  c: '''
     multi
     line
     '''
  d: [1, 2]
  e: "quoted \\"x\\""
}`;

describe('HJSON, as hjson 3.2.1 reads and writes it', () => {
  it('reads comments, quoteless and multiline strings', () => {
    assert.deepEqual(parseHjson(SPEC_TEXT, { legacyRoot: false }), { a: 1, b: 'hello world', c: 'multi\nline', d: [1, 2], e: 'quoted "x"' });
    assert.deepEqual(parseHjson('// lead\n{\n  /* block */ x: 1 // tail\n  y: [\n    1 # one\n    2\n  ]\n}', { legacyRoot: false }), {
      x: 1,
      y: [1, 2],
    });
    assert.deepEqual(parseHjson('{a: 1, b: [true, false, null], c: -1.5e3, "d e": {}}', { legacyRoot: false }), {
      a: 1,
      b: [true, false, null],
      c: -1500,
      'd e': {},
    });
    assert.deepEqual(parseHjson('{"a": 1,}', { legacyRoot: false }), { a: 1 });
  });

  it('reads the rest of a line as a string once a value is not a number', () => {
    assert.deepEqual(parseHjson('{ s: 012, t: 1.0, u: 0x10, v: "\\u0041", w: 1 2, x: 5 # five\n}', { legacyRoot: false }), {
      s: '012, t: 1.0, u: 0x10, v: "\\u0041", w: 1 2, x: 5 # five',
    });
  });

  it('reads an object without braces only when the root may have none', () => {
    assert.deepEqual(parseHjson('a: 1\nb: 2'), { a: 1, b: 2 });
    assert.throws(() => parseHjson('a: 1\nb: 2', { legacyRoot: false }), {
      message: 'Syntax error, found trailing characters at line 2,1 >>>b: 2 ...',
    });
  });

  it('says where the text cannot be read, in its words', () => {
    assert.throws(() => parseHjson('{a: }', { legacyRoot: false }), {
      message: "Found a punctuator character '}' when expecting a quoteless string (check your syntax) at line 1,4 >>>a: } ...",
    });
    assert.throws(() => parseHjson('[1, 2,', { legacyRoot: false }), {
      message: "End of input while parsing an array (missing ']') at line 1,6 >>>1, 2, ...",
    });
  });

  it('writes a spec again with its comments, as the editor reformats it', () => {
    const asHjson = (text: string) => stringifyHjson(parseHjson(text, { legacyRoot: false, keepWsc: true }), { bracesSameLine: true, keepWsc: true });
    assert.equal(
      asHjson(SPEC_TEXT),
      "{\n  # comment\n  a: 1\n  b: hello world\n  c:\n    '''\n    multi\n    line\n    '''\n  d: [\n    1\n    2\n  ]\n  e: quoted \"x\"\n}"
    );
    assert.equal(
      asHjson('// lead\n{\n  /* block */ x: 1 // tail\n  y: [\n    1 # one\n    2\n  ]\n}'),
      '// lead\n{\n  /* block */\n  x: 1 // tail\n  y: [\n    1 # one\n    2\n  ]\n}'
    );
    // an empty object read with its comments is written over two lines
    assert.equal(
      asHjson('{a: 1, b: [true, false, null], c: -1.5e3, "d e": {}}'),
      '{\n  a: 1\n  b: [\n    true\n    false\n    null\n  ]\n  c: -1500\n  "d e": {\n  }\n}'
    );
  });

  it('writes plain values with quotes only where they are needed', () => {
    const value = { signals: [{ name: 'tooltip', value: {}, on: [{ events: 'rect:mouseover', update: 'datum' }, { events: 'rect:mouseout', update: '{}' }] }] };
    assert.equal(
      stringifyHjson(value, { bracesSameLine: true }),
      '{\n  signals: [\n    {\n      name: tooltip\n      value: {}\n      on: [\n        {\n          events: rect:mouseover\n          update: datum\n        }\n        {\n          events: rect:mouseout\n          update: "{}"\n        }\n      ]\n    }\n  ]\n}'
    );
    assert.equal(stringifyHjson({ a: [], b: {}, c: [[]], d: null }, { bracesSameLine: true }), '{\n  a: []\n  b: {}\n  c: [\n    []\n  ]\n  d: null\n}');
  });
});

describe('compact JSON, as json-stringify-pretty-compact 1.2.0 writes it', () => {
  const table = { name: 'table', values: [{ category: 'A', amount: 28 }, { category: 'B', amount: 55 }, { category: 'C', amount: 43 }] };

  it('keeps what fits on a line on one line', () => {
    assert.equal(compactJson({ a: 1, b: [1, 2, 3], c: { d: 'x' } }), '{"a": 1, "b": [1, 2, 3], "c": {"d": "x"}}');
    assert.equal(
      compactJson(table, { maxLength: 70 }),
      '{\n  "name": "table",\n  "values": [\n    {"category": "A", "amount": 28},\n    {"category": "B", "amount": 55},\n    {"category": "C", "amount": 43}\n  ]\n}'
    );
    assert.equal(compactJson(parseHjson(SPEC_TEXT, { legacyRoot: false, keepWsc: true })), '{\n  "a": 1,\n  "b": "hello world",\n  "c": "multi\\nline",\n  "d": [1, 2],\n  "e": "quoted \\"x\\""\n}');
  });

  it('follows its indent, its length and its margins', () => {
    assert.equal(compactJson({ a: 1, b: [1, 2, 3], c: { d: 'x' } }, { maxLength: 40, indent: 4 }), '{\n    "a": 1,\n    "b": [1, 2, 3],\n    "c": {"d": "x"}\n}');
    assert.equal(compactJson({ a: 1, b: [1, 2, 3], c: { d: 'x' } }, { maxLength: 40, margins: true }), '{\n  "a": 1,\n  "b": [ 1, 2, 3 ],\n  "c": { "d": "x" }\n}');
    // empty objects and lists get both margins
    assert.equal(compactJson({ a: [], b: {}, c: [[]], d: null }, { maxLength: 40, margins: true }), '{\n  "a": [  ],\n  "b": {  },\n  "c": [ [  ] ],\n  "d": null\n}');
  });
});

// --- The editor's colours -------------------------------------------------------------------------

/** The tokens of each line, as the original's editor (Ace's HJSON mode) gives them */
function tokens(text: string) {
  let state: HjsonLineState = { current: 'start', stack: [] };
  return text.split('\n').map((line) => {
    const result = tokenizeHjsonLine(line, state);
    state = result.state;
    return result.tokens.map((token) => [token.type, token.value]);
  });
}

describe('the spec editor colours HJSON as the original does', () => {
  it('colours keys, values, strings and escapes', () => {
    assert.deepEqual(tokens('{\n  a: 1\n  e: "q \\" \\u0041 \\q"\n}'), [
      [['paren.lparen', '{']],
      [['paren', '  '], ['keyword', 'a'], ['text', ':'], ['paren', ' '], ['constant.numeric', '1']],
      [
        ['paren', '  '],
        ['keyword', 'e'],
        ['text', ':'],
        ['paren', ' '],
        ['string', '"q '],
        ['constant.language.escape', '\\"'],
        ['string', ' '],
        ['constant.language.escape', '\\u0041'],
        ['string', ' '],
        ['invalid.illegal', '\\q'],
        ['string', '"'],
      ],
      [['paren.rparen', '}']],
    ]);
  });

  it('takes the "https" of an address for a key and the rest for a comment', () => {
    assert.deepEqual(tokens('{\n  url: https://example.com/path?x=1')[1], [
      ['paren', '  '],
      ['keyword', 'url'],
      ['text', ':'],
      ['paren', ' '],
      ['keyword', 'https'],
      ['text', ':'],
      ['comment.punctuation', '//'],
      ['comment.line', 'example.com/path?x=1'],
    ]);
  });

  it('carries block comments, multiline strings and lists over lines', () => {
    assert.deepEqual(tokens("{\n  /* block\n     spans */ x: 1 // tail\n  c: '''\n     multi\n     '''\n  y: [\n    1 # one\n    oops\n  ]\n}"), [
      [['paren.lparen', '{']],
      [['paren', '  '], ['comment.punctuation', '/*'], ['comment.block', ' block']],
      [
        ['comment.block', '     spans '],
        ['comment.punctuation', '*/'],
        ['paren', ' '],
        ['keyword', 'x'],
        ['text', ':'],
        ['paren', ' '],
        ['constant.numeric', '1'],
        ['paren', ' '],
        ['comment.punctuation', '//'],
        ['comment.line', ' tail'],
      ],
      [['paren', '  '], ['keyword', 'c'], ['text', ':'], ['paren', ' '], ['string', "'''"]],
      [['string', '     multi']],
      [['string', "     '''"]],
      [['paren', '  '], ['keyword', 'y'], ['text', ':'], ['paren', ' '], ['paren.lparen', '[']],
      [['array', '    '], ['constant.numeric', '1'], ['array', ' '], ['comment.punctuation', '#'], ['comment.line', ' one']],
      [['array', '    '], ['string', 'oops']],
      [['array', '  '], ['paren.rparen', ']']],
      [['paren.rparen', '}']],
    ]);
  });

  it('reads a spec without braces as the members of one object', () => {
    assert.deepEqual(tokens('a: 1\n"quoted key": x'), [
      [['keyword', 'a'], ['text', ':'], ['paren', ' '], ['constant.numeric', '1']],
      [['keyword', '"quoted key"'], ['text', ':'], ['paren', ' '], ['string', 'x']],
    ]);
  });

  it('draws an indent guide for each full two spaces before the last space of an indent', () => {
    const guides = tokenizeHjson('{\n  a: 1\n   b: 2\n    c: 3\n      d: [\n        4\n      ]\n \te: 5\n}').map(
      (line) => line.filter((token) => token.kind === 'HjGuide').length
    );
    assert.deepEqual(guides, [0, 0, 1, 1, 2, 3, 2, 0, 0]);
    assert.deepEqual(tokenizeHjson('   b: 2')[0].slice(0, 3), [{ text: '  ', kind: 'HjGuide' }, { text: ' ' }, { text: 'b', kind: 'HjKey' }]);
  });
});

// --- Expressions ----------------------------------------------------------------------------------

const interpreter = createExpressionInterpreter((a, b) => libraries.vega.ascending(a, b));
const SIGNALS = [
  { name: 'base', value: 3 },
  { name: 'arr', value: [3, 1, 2] },
  { name: 'obj', value: { a: 1, b: 'x' } },
  { name: 'text', value: 'Hello World' },
];

/** A value as text that tells numbers that are not finite, dates, patterns and nothing apart */
const tagged = (value: unknown) =>
  JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item === 'number' && !Number.isFinite(item)) return `#${item}`;
    if (item instanceof Date) return `#date ${item.getTime()}`;
    if (item instanceof RegExp) return `#regexp ${String(item)}`;
    if (typeof item === 'function') return '#function';
    if (item === undefined) return '#undefined';
    return item;
  }) ?? '#undefined';

/** A signal's value, with Vega's own code for its expression or with the interpreter */
async function evaluate(expression: string, interpreted: boolean): Promise<string> {
  const spec = { signals: [...SIGNALS, { name: 'out', update: expression }] };
  try {
    const runtime = interpreted ? vega.parse(spec, null, { ast: true }) : vega.parse(spec);
    const view = new vega.View(runtime, interpreted ? { renderer: 'none', expr: interpreter } : { renderer: 'none' });
    await view.runAsync();
    return tagged(view.signal('out'));
  } catch (failure) {
    return `#error ${(failure as Error).message}`;
  }
}

// What the original's interpreter answers as Vega's code does: every one of these was checked against vega-interpreter 1.2.1
const EXPRESSIONS = [
  '1 + 2 * 3', 'base * 2 - 1', 'base / 0', '-base', '~base', '!base', "+'4'", 'base % 2', 'base << 2', 'base >> 1', '-9 >>> 28',
  'base & 1', 'base | 4', 'base ^ 1', "base == '3'", "base === '3'", 'base != 3', 'base !== 3', "base > 2 ? 'big' : 'small'",
  "base && 0 || 'z'", "null || 'fallback'", 'base < 2 && base', 'base <= 3', 'base >= 4',
  'obj.a', "obj['b']", 'arr[1]', 'arr.length', 'text.length', "{x: 1, y: [base, 'two'], 'z w': null}", '[1, [2, 3]]', 'obj.missing',
  'PI', 'E', 'LN2', 'LN10', 'LOG2E', 'LOG10E', 'SQRT1_2', 'SQRT2', 'MIN_VALUE', 'MAX_VALUE',
  "isNaN('x')", 'isFinite(1 / 0)', "isFinite('5')", 'abs(-2)', 'acos(1)', 'asin(1)', 'atan(1)', 'atan2(1, 1)', 'ceil(1.2)', 'cos(0)',
  'exp(1)', 'floor(-1.5)', 'log(E)', 'max(1, 5, 3)', 'min(arr[0], 2)', 'pow(2, 10)', 'round(2.5)', 'round(-2.5)', 'sin(0)', 'sqrt(16)',
  'tan(0)', 'clamp(5, 0, 3)', 'clamp(-1, 0, 3)',
  'utc(2021, 5, 15)', 'utc(2021, 5, 15, 13, 30)', 'time(datetime(2021, 0, 1))', 'datetime(2021, 5, 15, 10)', 'year(datetime(2021, 5, 15))',
  'month(datetime(2021, 5, 15))', 'date(datetime(2021, 5, 15))', 'day(datetime(2021, 5, 15))', 'hours(datetime(2021, 5, 15, 7))',
  'minutes(datetime(2021, 5, 15, 7, 8))', 'seconds(datetime(2021, 5, 15, 7, 8, 9))', 'milliseconds(datetime(2021, 5, 15, 7, 8, 9, 10))',
  'timezoneoffset(datetime(2021, 0, 1))', 'utcyear(utc(2021, 5, 15))', 'utcmonth(utc(2021, 5, 15))', 'utcdate(utc(2021, 5, 15))',
  'utcday(utc(2021, 5, 15))', 'utchours(utc(2021, 5, 15, 13))', 'utcminutes(utc(2021, 5, 15, 13, 14))', 'utcseconds(utc(2021, 5, 15, 13, 14, 15))',
  'utcmilliseconds(utc(2021, 5, 15, 13, 14, 15, 16))',
  'length(arr)', "length('abc')", "join(['a', 'b'], '-')", 'join(arr)', 'indexof(arr, 1)', "indexof('abc', 'c')", "lastindexof('abca', 'a')",
  'slice(arr, 1)', "slice('abcdef', -2)", 'reverse(arr)', 'sort(arr)', "sort(['b', 'a', 'c'])",
  "parseFloat('3.5x')", "parseInt('12px')", "parseInt('ff', 16)", "upper('abc')", "lower('ABC')", "substring('abcdef', 1, 3)",
  "split('a,b,c', ',')", "split('a,b,c', ',', 2)", "replace('aaa', 'a', 'b')", "replace('aaa', regexp('a', 'g'), 'b')", "trim('  x ')",
  "btoa('abc')", "atob('YWJj')", "regexp('^a', 'i')", "test(regexp('^a'), 'abc')", "test('b+', 'abbbc')", "test('^z', 'abc')",
  "if(base > 1, 'yes', 'no')", "format(1234.5, ',.2f')", "format(0.25, '.0%')", "utcFormat(utc(2020, 0, 2), '%Y-%m-%d')",
  "timeFormat(datetime(2020, 0, 2), '%b %d')", "pad('a', 5, '*', 'left')", "pad('abc', 6)", "truncate('abcdefgh', 5)",
  "truncate('abcdefgh', 5, 'left', '..')", 'extent(arr)', 'span(arr)', 'inrange(2, [1, 3])', 'lerp([0, 10], 0.5)', 'sequence(0, 5)',
  'sequence(1, 10, 3)', 'peek(arr)', 'isArray(arr)', 'isBoolean(true)', 'isDate(datetime(2020))', 'isDefined(obj.c)', 'isNumber(3)',
  'isObject(obj)', "isRegExp(regexp('a'))", "isString('x')", 'isValid(null)', "toBoolean('false')", 'toBoolean(0)',
  "toDate('2020-01-01T00:00:00Z')", "toNumber('3')", "toNumber('')", 'toString(3)', 'toString(null)', 'merge(obj, {c: 2})',
  'dayFormat(1)', 'dayAbbrevFormat(1)', 'monthFormat(0)', 'monthAbbrevFormat(0)', 'dayofyear(datetime(2021, 1, 1))',
  'utcdayofyear(utc(2021, 1, 1))', 'quarter(datetime(2021, 5, 1))', 'utcquarter(utc(2021, 11, 1))', 'week(datetime(2021, 5, 15))',
  'utcweek(utc(2021, 5, 15))', "luminance('#ff0000')", "contrast('#000000', '#ffffff')", "rgb('#ff0000').r", "hsl(120, 1, 0.5) + ''",
  // what neither runs: members that are not functions of Vega, and keys of Object's prototype
  'obj.constructor', "obj['constructor']", "obj['__proto__']", '{__proto__: 1}', '{toString: 1}', '{hasOwnProperty: 2}',
  'text.toUpperCase()', "text['substring'](0, 2)", 'arr.concat([4])', 'upper.call',
];

describe('Vega expressions without code made from text, as the original evaluates them', () => {
  it('give what Vega would compute, function by function', async () => {
    for (const expression of EXPRESSIONS) {
      assert.equal(await evaluate(expression, true), await evaluate(expression, false), expression);
    }
  });

  it('keep the original interpreter\'s answer for NaN', async () => {
    assert.equal(await evaluate('NaN', true), '"#undefined"');
    assert.equal(await evaluate('isNaN(NaN)', true), 'false');
  });

  it('give marks and data the same values as Vega would', async () => {
    const spec = {
      width: 100,
      height: 100,
      signals: SIGNALS,
      data: [
        {
          name: 't',
          values: [{ v: 1 }, { v: 2 }, { v: 3 }],
          transform: [
            { type: 'formula', expr: 'datum.v * base', as: 'w' },
            { type: 'filter', expr: 'datum.w > 3' },
          ],
        },
      ],
      marks: [
        {
          type: 'rect',
          from: { data: 't' },
          encode: { update: { x: { signal: 'datum.w * 10' }, x2: { value: 5 }, y: { signal: 'base' }, height: { signal: 'datum.v' }, fill: { signal: "datum.v > 2 ? 'red' : 'blue'" } } },
        },
        { type: 'rule', from: { data: 't' }, encode: { update: { x: { signal: 'datum.w' }, x2: { signal: 'datum.v' }, y: { value: 1 } } } },
        { type: 'symbol', from: { data: 't' }, encode: { update: { xc: { signal: 'datum.w' }, yc: { signal: 'datum.v' }, width: { value: 4 }, height: { value: 6 }, size: { signal: 'pow(datum.v, 2)' } } } },
      ],
    };
    const draw = async (interpreted: boolean) => {
      const runtime = interpreted ? vega.parse(spec, null, { ast: true }) : vega.parse(spec);
      const view = new vega.View(runtime, interpreted ? { renderer: 'none', expr: interpreter } : { renderer: 'none' });
      await view.runAsync();
      const marks = (view.scenegraph().root.items?.[0].items ?? []).map((group) =>
        (group.items ?? []).map(({ x, x2, y, width, height, fill, size }) => ({ x, x2, y, width, height, fill, size }))
      );
      return tagged({ data: view.data('t'), marks });
    };
    const interpreted = await draw(true);
    assert.equal(interpreted, await draw(false));
    // a rect drawn right to left is turned around, a rule is not
    assert.match(interpreted, /^\{"data":\[\{"v":2,"w":6\},\{"v":3,"w":9\}\],"marks":\[\[\{"x":5,"x2":60,"y":3,"width":55,"height":2,"fill":"blue"/);
  });
});

describe('the check of a spec\'s expressions, as the original checks them', () => {
  const validate = (spec: unknown) => validateVegaExpression(spec, (expression) => libraries.vega.parseExpression(expression));
  const reasons = (spec: unknown) => validate(spec).map((result) => result.reason);

  it('lets data access, scales, conditions and literal keys through', () => {
    assert.deepEqual(validate({ signals: [{ name: 'tooltip', update: 'datum.x' }] }), []);
    assert.deepEqual(validate({ marks: [{ encode: { update: { x: { signal: "scale('x', datum.value)" } } } }] }), []);
    assert.deepEqual(validate({ marks: [{ encode: { update: { x: { signal: 'datum.children' }, y: { signal: 'datum.parent' } } } }] }), []);
    assert.deepEqual(validate({ signals: [{ name: 'color', update: "datum.value > 0 ? 'green' : 'red'" }] }), []);
    assert.deepEqual(validate({ signals: [{ name: 'config', update: '{constructor: 1, self: 2}' }] }), []);
    assert.deepEqual(validate({ signals: [{ name: 'item', update: 'data[0].value' }] }), []);
    assert.deepEqual(validate({ signals: [{ name: 'val', update: 'datum[field]' }] }), []);
  });

  it('refuses properties that reach the page', () => {
    for (const [update, name] of [
      ['el.ownerDocument', 'ownerDocument'],
      ["el['ownerDocument']", 'ownerDocument'],
      ["doc['defaultView']", 'defaultView'],
      ['datum.constructor.constructor("return this")()', 'constructor'],
    ]) {
      const found = reasons({ signals: [{ name: 'xss', update }] });
      assert.ok(found.length > 0 && found[0].includes(name), update);
    }
    assert.ok(reasons({ marks: [{ encode: { update: { text: { signal: 'el.innerHTML' } } } }] })[0].includes('innerHTML'));
    assert.ok(reasons({ signals: [{ name: 'xss', on: [{ events: 'click', update: 'event.view' }] }] })[0].includes('view'));
  });

  it('refuses the page\'s globals and functions that run text', () => {
    for (const [update, name] of [
      ['window.location', 'window'],
      ['document.cookie', 'document'],
      ['globalThis.fetch', 'globalThis'],
      ["eval('alert(1)')", 'eval'],
      ["Function('return this')()", 'Function'],
      ["setTimeout('alert(1)', 0)", 'setTimeout'],
      ["obj.eval('code')", 'eval'],
      ["atob('b3duZXJEb2N1bWVudA==')", 'atob'],
      ["el['owner' + 'Document']", 'dynamic computed property'],
    ]) {
      assert.ok(reasons({ signals: [{ name: 'xss', update }] }).some((reason) => reason.includes(name)), update);
    }
    assert.ok(validate({ signals: [{ name: 'xss', update: "el[atob('b3duZXJEb2N1bWVudA==')]" }] }).length > 0);
  });

  it('looks in marks and transforms, and nowhere else', () => {
    const inMarks = validate({ marks: [{ type: 'rect', encode: { enter: { x: { signal: 'el.ownerDocument' } } } }] });
    assert.ok(inMarks.length > 0 && inMarks[0].location.includes('marks'));
    assert.ok(validate({ data: [{ name: 'source', transform: [{ type: 'formula', expr: 'window.location', as: 'url' }] }] }).length > 0);
    assert.deepEqual(validate({ description: 'window.document is fine in non-expression fields', title: 'eval(this) is also fine here' }), []);
    assert.deepEqual(validate(null), []);
    assert.deepEqual(validate(undefined), []);
    assert.deepEqual(validate({}), []);
  });
});

// --- Reading a spec -------------------------------------------------------------------------------

const emptyQuery = (): BoolQuery => ({ bool: { must: [], filter: [], should: [], must_not: [] } });

/** Searches that answer each request by its name, keeping what was asked */
function searchStub(answers: Record<string, unknown> = {}) {
  const asked: Array<{ requests: VegaSearchRequest[]; strategy?: string }> = [];
  const api: VegaSearchApi = {
    async search(requests, options) {
      asked.push({ requests, strategy: options?.strategy });
      return requests.map((request) => ({ name: request.name, rawResponse: answers[request.name] }));
    },
    resetSearchStats() {},
  };
  return { api, asked };
}

const mapsService: MapsServiceSettings = {
  getFileLayers: async () => [{ name: 'file1' }],
  getUrlForRegionLayer: async (layer) => (layer.name === 'file1' ? 'url1' : undefined),
};

function parserFor(spec: unknown, dependencies: Partial<VegaParserDependencies> = {}) {
  return new VegaParser(spec, {
    libraries,
    searchAPI: searchStub().api,
    timeCache: new TimeCache(() => ({ min: 0, max: 1000 }), 3000),
    filters: emptyQuery(),
    getServiceSettings: async () => mapsService,
    dark: false,
    ...dependencies,
  });
}

const parsed = (spec: unknown, dependencies?: Partial<VegaParserDependencies>) => parserFor(spec, dependencies).parseAsync();
const specOf = (parser: VegaParser) => parser.spec as SpecObject;

const MARK_COLOR = SERIES_COLORS[0];

describe('a spec read as the original reads it', () => {
  it('needs a $schema', async () => {
    const parser = await parsed('{}');
    assert.ok(parser.error?.startsWith('Your specification requires a "$schema" field with a valid URL'));
  });

  it('gets the theme\'s colours where it sets none: Vega', async () => {
    const parser = await parsed({ $schema: VEGA_SCHEMA });
    assert.equal(parser.error, undefined);
    assert.deepEqual(specOf(parser).config, {
      range: { category: [...SERIES_COLORS] },
      arc: { fill: MARK_COLOR },
      area: { fill: MARK_COLOR },
      line: { stroke: MARK_COLOR },
      path: { stroke: MARK_COLOR },
      rect: { fill: MARK_COLOR },
      rule: { stroke: MARK_COLOR },
      shape: { stroke: MARK_COLOR },
      symbol: { fill: MARK_COLOR },
      text: { fill: '#1d1d1f' },
      trail: { fill: MARK_COLOR },
      title: { color: '#1d1d1f' },
      style: { 'guide-label': { fill: '#6e6e73' }, 'guide-title': { fill: '#1d1d1f' }, 'group-title': { fill: '#1d1d1f' }, 'group-subtitle': { fill: '#1d1d1f' } },
      axis: { tickColor: '#e8e8ed', domainColor: '#e8e8ed', gridColor: '#e8e8ed' },
      background: 'transparent',
    });
    assert.deepEqual(parser.warnings, []);
  });

  it('gets the theme\'s colours where it sets none: Vega-Lite, in dark mode', async () => {
    const parser = await parsed({ $schema: VEGA_LITE_SCHEMA, mark: 'point' }, { dark: true });
    assert.equal(parser.error, undefined);
    assert.equal(parser.isVegaLite, true);
    assert.deepEqual(parser.vlspec?.config, {
      range: { category: [...SERIES_COLORS] },
      mark: { color: MARK_COLOR },
      text: { fill: '#f5f5f7' },
      title: { color: '#f5f5f7' },
      style: { 'guide-label': { fill: '#98989d' }, 'guide-title': { fill: '#f5f5f7' }, 'group-title': { fill: '#f5f5f7' }, 'group-subtitle': { fill: '#f5f5f7' } },
      axis: { tickColor: '#2c2c2e', domainColor: '#2c2c2e', gridColor: '#2c2c2e' },
      background: 'transparent',
    });
    // compiled to Vega
    assert.ok(Array.isArray(specOf(parser).marks));
  });

  it('keeps its own colour of marks', async () => {
    const config = specOf(await parsed({ $schema: VEGA_SCHEMA, config: { mark: { color: 'red' }, title: { color: 'blue' } } })).config as SpecObject;
    assert.equal(config.arc, undefined);
    assert.deepEqual(config.mark, { color: 'red' });
    assert.deepEqual(config.title, { color: 'blue' });
  });

  it('warns when it was written for a later Vega than the one drawing it', async () => {
    for (const schema of ['https://vega.github.io/schema/vega/v6.json', 'https://vega.github.io/schema/vega/v5.json']) {
      assert.deepEqual((await parsed({ $schema: schema })).warnings, [], schema);
    }
    for (const schema of ['https://vega.github.io/schema/vega-lite/v5.json', 'https://vega.github.io/schema/vega-lite/v4.json']) {
      assert.deepEqual((await parsed({ $schema: schema, mark: 'point' })).warnings, [], schema);
    }
    const parser = await parsed({ $schema: 'https://vega.github.io/schema/vega/v6.99.json' });
    assert.deepEqual(parser.warnings, [[`The input spec uses vega v6.99, but current version of vega is ${libraries.vega.version}.`]]);
  });

  it('takes its host settings from config.kibana, or the older _hostConfig', async () => {
    const parser = await parsed({ $schema: VEGA_SCHEMA, config: { kibana: { a: 1 } } });
    // with the settings the original sets on it as it reads them
    assert.deepEqual(parser.config, { a: 1, restoreSignalValuesOnRefresh: false });
    assert.equal((specOf(parser).config as SpecObject).kibana, undefined);
    const legacy = await parsed({ $schema: VEGA_SCHEMA, _hostConfig: { a: 1 } });
    assert.deepEqual(legacy.config, { a: 1, restoreSignalValuesOnRefresh: false });
    assert.equal(specOf(legacy)._hostConfig, undefined);
    assert.deepEqual(legacy.warnings, [['"_hostConfig" has been deprecated. Use config.kibana instead.']]);
    assert.equal((await parsed({ $schema: VEGA_SCHEMA, config: { kibana: 1 } })).error, 'If present, config.kibana must be an object');
  });

  it('hides the warnings found once its settings are read, when it asks to', async () => {
    const hidden = await parsed({ $schema: VEGA_SCHEMA, config: { kibana: { hideWarnings: true, restoreSignalValuesOnRefresh: 'yes' } } });
    assert.deepEqual(hidden.warnings, []);
    // that of the schema comes before, and is kept as the original keeps it
    const early = await parsed({ $schema: 'https://vega.github.io/schema/vega/v6.99.json', config: { kibana: { hideWarnings: true } } });
    assert.equal(early.warnings.length, 1);
    assert.equal(early.hideWarnings, true);
  });

  it('places its controls where it says', async () => {
    const parser = await parsed({ $schema: VEGA_SCHEMA, config: { kibana: { controlsLocation: 'left', controlsDirection: 'horizontal' } } });
    assert.equal(parser.containerDir, 'row-reverse');
    assert.equal(parser.controlsDir, 'row');
    const plain = await parsed({ $schema: VEGA_SCHEMA });
    assert.equal(plain.containerDir, 'column');
    assert.equal(plain.controlsDir, 'column');
    assert.equal(
      (await parsed({ $schema: VEGA_SCHEMA, config: { kibana: { controlsLocation: 'middle' } } })).error,
      'Unrecognized controlsLocation value. Expecting one of ["left", "right", "top", "bottom"]'
    );
    assert.equal(
      (await parsed({ $schema: VEGA_SCHEMA, config: { kibana: { controlsDirection: 'up' } } })).error,
      'Unrecognized dir value. Expecting one of ["horizontal", "vertical"]'
    );
  });

  it('warns about a setting that is not a boolean', async () => {
    const parser = await parsed({ $schema: VEGA_SCHEMA, config: { kibana: { restoreSignalValuesOnRefresh: 'yes' } } });
    assert.equal(parser.restoreSignalValuesOnRefresh, false);
    assert.deepEqual(parser.warnings, [['config.kibana.restoreSignalValuesOnRefresh must be a boolean value']]);
  });

  it('refuses expressions that reach the page', async () => {
    const parser = await parsed({ $schema: VEGA_SCHEMA, signals: [{ name: 'x', update: 'window.location' }] });
    assert.ok(parser.error?.startsWith('Unexpected Vega expression: '));
  });
});

describe('the tooltips of a spec, as config.kibana.tooltips sets them', () => {
  const tooltips = async (value: unknown) => {
    const parser = await parsed(value === undefined ? { $schema: VEGA_SCHEMA } : { $schema: VEGA_SCHEMA, config: { kibana: { tooltips: value } } });
    return parser.error === undefined ? parser.tooltips : { error: parser.error };
  };

  it('defaults to the top, 16 pixels away, pointing at marks smaller than 50', async () => {
    assert.deepEqual(await tooltips(undefined), { position: 'top', padding: 16, centerOnMark: 50 });
    assert.deepEqual(await tooltips({}), { position: 'top', padding: 16, centerOnMark: 50 });
    assert.deepEqual(await tooltips({ position: 'left' }), { position: 'left', padding: 16, centerOnMark: 50 });
    assert.deepEqual(await tooltips({ position: 'bottom', padding: 60 }), { position: 'bottom', padding: 60, centerOnMark: 50 });
    assert.deepEqual(await tooltips({ padding: 70 }), { position: 'top', padding: 70, centerOnMark: 50 });
    assert.deepEqual(await tooltips({ centerOnMark: 10 }), { position: 'top', padding: 16, centerOnMark: 10 });
    assert.deepEqual(await tooltips({ centerOnMark: true }), { position: 'top', padding: 16, centerOnMark: Number.MAX_VALUE });
    assert.deepEqual(await tooltips({ centerOnMark: false }), { position: 'top', padding: 16, centerOnMark: -1 });
    assert.equal(await tooltips(false), false);
  });

  it('fails on values it cannot use', async () => {
    assert.deepEqual(await tooltips(true), { error: "Cannot create property 'position' on boolean 'true'" });
    assert.deepEqual(await tooltips({ position: 'foo' }), { error: 'Unexpected value for the result.position configuration' });
    assert.deepEqual(await tooltips({ padding: 'foo' }), { error: 'config.kibana.result.padding is expected to be a number' });
    assert.deepEqual(await tooltips({ centerOnMark: {} }), { error: 'config.kibana.result.centerOnMark is expected to be true, false, or a number' });
  });
});

describe('a spec on a map, as config.kibana sets it', () => {
  const map = async (config: SpecObject) => {
    const parser = await parsed({ $schema: VEGA_SCHEMA, config: { kibana: { type: 'map', ...config } } });
    return { mapConfig: parser.mapConfig, warnings: parser.warnings.length, useResize: parser.useResize };
  };
  const DEFAULTS = { delayRepaint: true, latitude: 0, longitude: 0, mapStyle: 'default', zoomControl: true, scrollWheelZoom: false };

  it('starts at 0, 0 with the default style and zoom control', async () => {
    assert.deepEqual(await map({}), { mapConfig: DEFAULTS, warnings: 0, useResize: false });
  });

  it('keeps settings that are right', async () => {
    assert.deepEqual(await map({ ...DEFAULTS, maxBounds: [1, 2, 3, 4], zoom: '3.5', minZoom: 2, mapStyle: false }), {
      mapConfig: { ...DEFAULTS, maxBounds: [1, 2, 3, 4], zoom: 3.5, minZoom: 2, mapStyle: false },
      warnings: 0,
      useResize: false,
    });
  });

  it('warns about each setting that is not, and leaves it out', async () => {
    const result = await map({ ...DEFAULTS, zoom: 'abc', mapStyle: 'abc', zoomControl: 'abc', scrollWheelZoom: 'abc', maxBounds: [2, 3, 4] });
    assert.deepEqual(result, { mapConfig: DEFAULTS, warnings: 5, useResize: false });
  });
});

describe('the size of a spec, as the original fits it in its panel', () => {
  const sized = async (spec: SpecObject) => {
    const parser = await parsed({ $schema: VEGA_SCHEMA, ...spec });
    const { autosize, width, height } = specOf(parser);
    return { useResize: parser.useResize, autosize, width, height, warnings: parser.warnings.length };
  };
  const FIT = { type: 'fit', contains: 'padding' };

  it('fills the panel unless autosize is none', async () => {
    assert.deepEqual(await sized({}), { useResize: true, autosize: FIT, width: 'container', height: 'container', warnings: 0 });
    assert.deepEqual(await sized({ width: 'container', height: 'container' }), { useResize: true, autosize: FIT, width: 'container', height: 'container', warnings: 0 });
    assert.deepEqual(await sized({ autosize: 'none' }), { useResize: false, autosize: { type: 'none', contains: 'padding' }, width: undefined, height: undefined, warnings: 0 });
    assert.deepEqual(await sized({ autosize: 'fit' }), { useResize: true, autosize: FIT, width: 'container', height: 'container', warnings: 0 });
    assert.deepEqual(await sized({ autosize: 'pad' }), { useResize: true, autosize: { type: 'pad', contains: 'padding' }, width: 'container', height: 'container', warnings: 0 });
    assert.deepEqual(await sized({ autosize: {} }), { useResize: true, autosize: FIT, width: 'container', height: 'container', warnings: 0 });
    assert.deepEqual(await sized({ autosize: { contains: 'content' } }), { useResize: true, autosize: { type: 'fit', contains: 'content' }, width: 'container', height: 'container', warnings: 0 });
  });

  it('warns that a size or a false autosize is not used', async () => {
    assert.deepEqual(await sized({ width: '300', height: '300' }), { useResize: true, autosize: FIT, width: 'container', height: 'container', warnings: 1 });
    assert.deepEqual(await sized({ autosize: false }), { useResize: true, autosize: FIT, width: 'container', height: 'container', warnings: 1 });
  });

  it('leaves an autosize that follows a signal alone', async () => {
    assert.deepEqual(await sized({ autosize: { signal: 'asdf' } }), { useResize: undefined, autosize: { signal: 'asdf' }, width: undefined, height: undefined, warnings: 0 });
  });
});

describe('the data of a spec, fetched and put in place', () => {
  const withData = async (spec: SpecObject) => {
    const { api } = searchStub({ requestId: [42] });
    const parser = await parsed({ $schema: VEGA_SCHEMA, ...spec }, { searchAPI: api });
    const { $schema, config, autosize, width, height, ...rest } = specOf(parser);
    return { error: parser.error, rest, warnings: parser.warnings };
  };

  it('leaves a spec without searches as it is', async () => {
    assert.deepEqual(await withData({ a: 1 }), { error: undefined, rest: { a: 1 }, warnings: [] });
    assert.deepEqual(await withData({ data: { a: 10 } }), { error: undefined, rest: { data: { a: 10 } }, warnings: [] });
    assert.deepEqual(await withData({ data: { url: { signal: 'x' } } }), { error: undefined, rest: { data: { url: { signal: 'x' } } }, warnings: [] });
  });

  it('searches OpenSearch by default, and puts the answer in the data\'s values', async () => {
    assert.deepEqual((await withData({ data: { name: 'requestId', url: { index: 'a' }, x: 1 } })).rest, {
      data: { name: 'requestId', url: { index: 'a', body: {} }, values: [42], x: 1 },
    });
    assert.deepEqual((await withData({ data: { name: 'requestId', url: { '%type%': 'opensearch', index: 'a' } } })).rest, {
      data: { name: 'requestId', url: { index: 'a', body: {} }, values: [42] },
    });
    assert.deepEqual((await withData({ arr: [{ data: { name: 'requestId', url: { index: 'a' }, x: 1 } }] })).rest, {
      arr: [{ data: { name: 'requestId', url: { index: 'a', body: {} }, values: [42], x: 1 } }],
    });
  });

  it('gives a file of the maps service the address only it may load', async () => {
    assert.deepEqual((await withData({ data: { url: { '%type%': 'emsfile', name: 'file1' } } })).rest, {
      data: { url: { url: 'url1', bypassToken: BYPASS_TOKEN } },
    });
  });

  it('fails on a kind of data it does not know, or data given twice', async () => {
    assert.equal((await withData({ data: { url: { '%type%': 'foo' } } })).error, 'url: {"%type%": "foo"} is not supported');
    assert.equal(
      (await withData({ data: { url: { index: 'a' }, values: [] } })).error,
      'Data must not have more than one of "url", "values", and "source"'
    );
    assert.equal(
      (await withData({ data: { url: { '%type%': 'emsfile', name: 'nope' } } })).error,
      'emsfile "nope" does not exist'
    );
  });
});

// --- Searches -------------------------------------------------------------------------------------

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const RANGE_START = 10 * DAY;
const RANGE_END = 12 * DAY;
const CTX_ARR = { bool: { must: [{ match_all: { c: 3 } }], must_not: [{ d: 4 }], filter: [{ f: 6 }] } };
const CTX_OBJ = { bool: { must: { match_all: { a: 1 } }, must_not: { b: 2 }, filter: { e: 6 } } };
const iso = (ms: number) => new Date(ms).toISOString();

const fixedBounds = (min: number, max: number) => ({ getTimeBounds: () => ({ min, max }) }) as unknown as TimeCache;

function queryParser(min: number, max: number, context?: unknown) {
  const warnings: unknown[] = [];
  const parser = new OpenSearchQueryParser(fixedBounds(min, max), searchStub().api, structuredClone(context) as BoolQuery, (...args) =>
    warnings.push(args)
  );
  return { parser, warnings };
}

describe('the time keywords of a search, as the original works them out', () => {
  it('rounds an interval as a date histogram would', () => {
    assert.equal(roundInterval(4 * SECOND), '1s');
    assert.equal(roundInterval(4 * HOUR), '3h');
    const steps: Array<[number, string]> = [
      [500, '100ms'], [5000, '1s'], [7500, '5s'], [15000, '10s'], [45000, '30s'], [180000, '1m'], [450000, '5m'], [1200000, '10m'],
      [2700000, '30m'], [7200000, '1h'], [21600000, '3h'], [86400000, '12h'], [604800000, '24h'], [1814400000, '1w'], [3628799999, '30d'], [3628800000, '1y'],
    ];
    for (const [interval, rounded] of steps) assert.equal(roundInterval(interval), rounded, String(interval));
  });

  it('shifts a bound of the time range by a unit', () => {
    assert.equal(queryParser(1000, 2000).parser.getTimeBound({}, 'min'), 1000);
    assert.equal(queryParser(5, 2000).parser.getTimeBound({ shift: 2 }, 'min'), 5 + 2 * DAY);
    assert.equal(queryParser(10 * DAY, 20 * DAY).parser.getTimeBound({ shift: -2, unit: 'h' }, 'min'), 10 * DAY - 2 * HOUR);
    assert.throws(() => queryParser(0, 1).parser.getTimeBound({ shift: '2' }, 'min'), { message: '"shift" must be a numeric value' });
    assert.throws(() => queryParser(0, 1).parser.getTimeBound({ shift: 2, unit: 'y' }, 'min'), {
      message: 'Unknown "unit" value. Must be one of: ["week", "day", "hour", "minute", "second"]',
    });
  });

  it('writes the time range as a range, in the object it was given', () => {
    const plain = {};
    const result = queryParser(1000, 2000).parser.createRangeFilter(plain);
    assert.deepEqual(result, { format: 'strict_date_optional_time', gte: iso(1000), lte: iso(2000) });
    assert.equal(result, plain);
    const shifted = { shift: 5, unit: 's' };
    assert.deepEqual(queryParser(1000, 2000).parser.createRangeFilter(shifted), { format: 'strict_date_optional_time', gte: iso(6000), lte: iso(7000) });
  });
});

describe('the keywords of a search\'s query, as the original works them in', () => {
  const injected = (obj: unknown, context?: unknown) => {
    queryParser(RANGE_START, RANGE_END, context).parser.injectContextVars(obj, true);
    return obj;
  };

  it('leaves a query without keywords alone', () => {
    assert.deepEqual(injected({}), {});
    const plain = { a: { c: 10 }, b: [{ d: 2 }, 4, 5], c: [], d: {} };
    assert.deepEqual(injected(structuredClone(plain)), plain);
  });

  it('puts the clauses of the page\'s query in place of their keywords', () => {
    assert.deepEqual(injected({ arr: ['%dashboard_context-must_clause%'] }, {}), { arr: [] });
    assert.deepEqual(injected({ arr: ['%dashboard_context-must_clause%'] }, CTX_ARR), { arr: [...CTX_ARR.bool.must] });
    assert.deepEqual(injected({ arr: ['%dashboard_context-must_clause%'] }, CTX_OBJ), { arr: [CTX_OBJ.bool.must] });
    assert.deepEqual(
      injected(
        { arr: [1, '%dashboard_context-must_clause%', 2, '%dashboard_context-must_not_clause%', 3, '%dashboard_context-filter_clause%'] },
        CTX_ARR
      ),
      { arr: [1, ...CTX_ARR.bool.must, 2, ...CTX_ARR.bool.must_not, 3, ...CTX_ARR.bool.filter] }
    );
    assert.deepEqual(
      injected(
        { arr: ['%dashboard_context-must_clause%', 1, '%dashboard_context-must_not_clause%', 2, '%dashboard_context-filter_clause%', 3] },
        CTX_OBJ
      ),
      { arr: [CTX_OBJ.bool.must, 1, CTX_OBJ.bool.must_not, 2, CTX_OBJ.bool.filter, 3] }
    );
  });

  it('works out intervals and times from the time range', () => {
    assert.deepEqual(injected({ interval: { '%autointerval%': true } }, CTX_OBJ), { interval: '1h' });
    assert.deepEqual(injected({ interval: { '%autointerval%': 10 } }, CTX_OBJ), { interval: '3h' });
    assert.deepEqual(injected({ a: { '%timefilter%': 'min' } }), { a: RANGE_START });
    assert.deepEqual(injected({ a: { '%timefilter%': 'max' } }), { a: RANGE_END });
    assert.deepEqual(injected({ a: { '%timefilter%': true } }), {
      a: { format: 'strict_date_optional_time', gte: iso(RANGE_START), lte: iso(RANGE_END) },
    });
    assert.throws(() => injected({ interval: { '%autointerval%': 'x' } }), { message: '"%autointerval%" must be either true or a number' });
    assert.throws(() => injected({ a: { '%timefilter%': 'mid' } }), { message: '"%timefilter%" property must be set to true, "min", or "max"' });
  });
});

describe('the page\'s query and filters, as the original\'s request handler builds them', () => {
  it('makes one match_all of an empty query, however many places hold it', () => {
    const empty: Query = { language: 'kuery', query: '' };
    assert.deepEqual(contextQuery([empty, { ...empty }, undefined], [], {}), {
      bool: { must: [], filter: [{ match_all: {} }], should: [], must_not: [] },
    });
  });

  it('leaves out the filters that are turned off', () => {
    const on: Filter = { meta: { disabled: false }, query: { match_phrase: { a: 1 } } };
    const off: Filter = { meta: { disabled: true }, query: { match_phrase: { b: 2 } } };
    assert.deepEqual(contextQuery([], [on, off], {}).bool.filter, [{ match_phrase: { a: 1 } }]);
  });
});

describe('a search\'s url, as the original makes a request of it', () => {
  const request = (url: SpecObject, context: unknown) => {
    const { parser, warnings } = queryParser(RANGE_START, RANGE_END, context);
    parser.parseUrl({}, url);
    return { url, warnings };
  };
  const TIME_RANGE = { format: 'strict_date_optional_time', gte: iso(RANGE_START), lte: iso(RANGE_END) };
  const WITH_CONTEXT_AND_TIME = {
    index: '_all',
    body: { query: { bool: { must: [{ match_all: { c: 3 } }, { range: { abc: TIME_RANGE } }], must_not: [{ d: 4 }], filter: [{ f: 6 }] } } },
  };

  it('asks with the page\'s query for %context%', () => {
    assert.deepEqual(request({ index: '_all', '%context%': true }, CTX_ARR).url, { index: '_all', body: { query: CTX_ARR } });
    assert.deepEqual(request({ index: '_all', '%context%': true, '%timefield%': 'abc' }, CTX_ARR).url, WITH_CONTEXT_AND_TIME);
    assert.deepEqual(request({ index: '_all', '%timefield%': 'abc' }, CTX_ARR).url, { index: '_all', body: { query: { range: { abc: TIME_RANGE } } } });
  });

  it('reads the legacy %context_query%, with a warning', () => {
    assert.deepEqual(request({ index: '_all', '%context_query%': true }, CTX_ARR), {
      url: { index: '_all', body: { query: CTX_ARR } },
      warnings: [['Legacy "url": "%context_query%": true should change to "url": {"%context%": true}']],
    });
    assert.deepEqual(request({ index: '_all', '%context_query%': 'abc' }, CTX_ARR), {
      url: WITH_CONTEXT_AND_TIME,
      warnings: [['Legacy "url": "%context_query%": "abc" should change to "url": {"%context%": true, "%timefield%": "abc"}']],
    });
  });

  it('keeps a body of its own, and fails when both are given', () => {
    assert.deepEqual(request({ index: '_all' }, CTX_ARR).url, { index: '_all', body: {} });
    assert.deepEqual(request({ index: '_all', body: { query: 2 } }, CTX_ARR).url, { index: '_all', body: { query: 2 } });
    assert.throws(() => request({ index: '_all', '%context%': true, body: { query: {} } }, CTX_ARR), {
      message: 'url.%context% and url.%timefield% must not be used when url.body.query is set',
    });
    assert.throws(() => request({ index: '_all', body: [] }, CTX_ARR), { message: 'url.body must be an object' });
  });

  it('names each request, and puts each answer in its data', async () => {
    const { api, asked } = searchStub({ first: { hits: 1 }, 'Unnamed request #1': { hits: 2 } });
    const parser = new OpenSearchQueryParser(fixedBounds(0, 1), api, emptyQuery(), () => undefined);
    const named = { name: 'first' };
    const unnamed = {};
    await parser.populateData([parser.parseUrl(named, { index: 'a' }), parser.parseUrl(unnamed, { index: 'b' })]);
    assert.deepEqual(asked, [{ requests: [{ index: 'a', body: {}, name: 'first' }, { index: 'b', body: {}, name: 'Unnamed request #1' }], strategy: undefined }]);
    assert.deepEqual(named, { name: 'first', url: { index: 'a', body: {} }, values: { hits: 1 } });
    assert.deepEqual(unnamed, { url: { index: 'b', body: {} }, values: { hits: 2 } });
  });
});

describe('the bounds of the time range, kept a while', () => {
  it('asks again after a while, and keeps bounds that moved less than that', () => {
    let bounds = { min: 10000, max: 20000 };
    let calls = 0;
    let time = 10000;
    const cache = new TimeCache(() => {
      calls++;
      return bounds;
    }, 5000);
    cache.now = () => time;

    assert.deepEqual(cache.getTimeBounds(), { min: 10000, max: 20000 });
    assert.equal(calls, 1);
    // a moment later: the same, without asking
    time += 10;
    bounds = { min: 10010, max: 20010 };
    assert.deepEqual(cache.getTimeBounds(), { min: 10000, max: 20000 });
    assert.equal(calls, 1);
    // later: asks, and keeps the first as the range moved little
    time += 200;
    bounds = { min: 10210, max: 20210 };
    assert.deepEqual(cache.getTimeBounds(), { min: 10000, max: 20000 });
    assert.equal(calls, 2);
    // much later: the new bounds
    time += 10000;
    bounds = { min: 20220, max: 30220 };
    assert.deepEqual(cache.getTimeBounds(), { min: 20220, max: 30220 });
    assert.equal(calls, 3);
  });
});

describe('PPL queries, as the original asks them', () => {
  it('needs a query', () => {
    const parser = new PPLQueryParser(new TimeCache(() => ({ min: 0, max: 1 }), 100), searchStub().api);
    for (const url of [{}, { body: {} }, { body: { query: {} } }]) {
      assert.throws(() => parser.parseUrl({}, url), { message: '"data.url" must have query specified' });
    }
    assert.deepEqual(parser.parseUrl({}, { body: { query: 'source=test_index' } }), { dataObject: {}, url: { body: { query: 'source=test_index' } } });
  });

  it('puts the time range after the source', () => {
    const from = new Date('2024-10-07T05:03:22.548Z');
    const to = new Date('2025-01-08T05:03:30.981Z');
    // the bounds the original's test gives, the earlier as the end
    const cache = new TimeCache(() => ({ min: to.valueOf(), max: from.valueOf() }), 100);
    cache.setTimeRange({ from: from.toISOString(), to: to.toISOString(), mode: 'absolute' });
    const parser = new PPLQueryParser(cache, searchStub().api);
    assert.deepEqual(parser.parseUrl({}, { body: { query: 'source=test_index' }, '%timefield%': 'timestamp' }).url, {
      body: { query: "source=test_index | where `timestamp` >= '2025-01-08 05:03:30.981' and `timestamp` <= '2024-10-07 05:03:22.548'" },
    });
    assert.deepEqual(parser.parseUrl({}, { body: { query: 'source=test_index | stats count() as doc_count' }, '%timefield%': 'timestamp' }).url, {
      body: {
        query:
          "source=test_index | where `timestamp` >= '2025-01-08 05:03:30.981' and `timestamp` <= '2024-10-07 05:03:22.548' | stats count() as doc_count",
      },
    });
    assert.equal(pplTime(Date.UTC(2026, 0, 2, 3, 4, 5, 6)), '2026-01-02 03:04:05.006');
  });

  it('puts the rows of the answer in the data', async () => {
    const { api, asked } = searchStub({ 'request name': { jsonData: [{ id: 'id1' }] } });
    const parser = new PPLQueryParser(new TimeCache(() => ({ min: 0, max: 1 }), 100), api);
    const request = { url: { body: { query: 'source=test_index' } }, dataObject: { name: 'request name' } as SpecObject };
    await parser.populateData([request]);
    assert.deepEqual(request.dataObject.values, [{ id: 'id1' }]);
    assert.equal(asked[0].strategy, 'pplraw');
  });
});

describe('addresses and files of a spec\'s data', () => {
  it('writes parameters as jQuery 3.6.0 does', () => {
    assert.equal(queryParams({ a: { b: 1 }, list: [1, 2], c: null, d: undefined, e: 'x y&z' }), 'a%5Bb%5D=1&list%5B%5D=1&list%5B%5D=2&c=&d=&e=x%20y%26z');
    assert.equal(
      queryParams({ nested: [{ x: 1 }, { y: [3, 4] }], 'k[]': [5, 6] }),
      'nested%5B0%5D%5Bx%5D=1&nested%5B1%5D%5By%5D%5B%5D=3&nested%5B1%5D%5By%5D%5B%5D=4&k%5B%5D=5&k%5B%5D=6'
    );
    assert.equal(queryParams([{ name: 'a', value: 1 }, { name: 'b', value: null }]), 'a=1&b=');
    assert.equal(queryParams({ deep: { a: { b: [1, { c: 2 }] } }, t: true, n: 0 }), 'deep%5Ba%5D%5Bb%5D%5B%5D=1&deep%5Ba%5D%5Bb%5D%5B1%5D%5Bc%5D=2&t=true&n=0');
  });

  it('adds the query of an address to it, with a warning when there is none', () => {
    const warnings: unknown[] = [];
    const parser = new UrlParser((...args) => warnings.push(args));
    const plain: SpecObject = {};
    parser.parseUrl(plain, { url: 'https://example.org/a' });
    assert.equal(plain.url, 'https://example.org/a');
    assert.deepEqual(warnings, [['Using a "url": {"%type%": "url", "url": ...} should have a "query" sub-object']]);
    const withQuery: SpecObject = {};
    parser.parseUrl(withQuery, { url: 'https://example.org/a?x=1', query: { b: [1, 2] } });
    assert.equal(withQuery.url, 'https://example.org/a?x=1&b%5B%5D=1&b%5B%5D=2');
    assert.throws(() => parser.parseUrl({}, {}), { message: '"data.url" requires a "url" parameter in a form "https://example.org/path/subpath"' });
  });

  it('needs the name of a file of the maps service', () => {
    assert.throws(() => new EmsFileParser(mapsService).parseUrl({}, {}), {
      message: '"data.url" with {"%type%": "emsfile"} requires "name" parameter (name of the file)',
    });
  });

  it('finds the index patterns a spec searches', () => {
    assert.deepEqual(extractIndexPatternTitles({ data: {} }), []);
    assert.deepEqual(extractIndexPatternTitles({ data: { url: { index: 'test' } } }), ['test']);
    assert.deepEqual(extractIndexPatternTitles({ data: [{ url: { index: 'test1' } }, { url: { index: 'test2' } }] }), ['test1', 'test2']);
    assert.deepEqual(extractIndexPatternTitles({ data: [{ url: { wrong: 'wrong' } }, { url: { index: 'ok' } }] }), ['ok']);
  });
});

// --- Helpers of the view --------------------------------------------------------------------------

describe('the helpers of the original\'s utils', () => {
  it('write warnings and errors with what came with them', () => {
    assert.equal(formatWarningToStr('Warn'), 'Warn');
    assert.equal(formatWarningToStr('Warn', 'detail'), 'Warn\ndetail');
    assert.equal(formatWarningToStr('Warn', { a: [1, 2] }), 'Warn\n{"a": [1, 2]}');
    assert.equal(formatErrorToStr(new Error('boom')), 'boom');
    assert.equal(formatErrorToStr(undefined), 'ERR');
    assert.equal(formatErrorToStr(new Error('x'), { b: 1 }), 'x\n{"b": 1}');
  });

  it('tell plain objects and empty values apart', () => {
    assert.equal(isPlainObject({}), true);
    assert.equal(isPlainObject(Object.create(null)), true);
    assert.equal(isPlainObject([]), false);
    assert.equal(isPlainObject(new Date()), false);
    assert.equal(isPlainObject(null), false);
    assert.deepEqual([undefined, null, '', [], {}, new Map(), 0, true].map(isEmpty), [true, true, true, true, true, true, true, true]);
    assert.deepEqual(['a', [1], { a: 1 }, new Set([1])].map(isEmpty), [false, false, false, false]);
    assert.equal(escapeHtml(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });

  it('read the times a spec sets as the original reads them', () => {
    assert.equal(handleInvalidDate(1658189958487), 1658189958487);
    assert.equal(handleInvalidDate('Sat Jul 16 2022 22:59:42'), 'Sat Jul 16 2022 22:59:42');
    const now = new Date();
    assert.equal(handleInvalidDate(now), now);
    assert.equal(handleInvalidDate(NaN), null);
    assert.equal(handleInvalidDate(undefined), null);
    assert.equal(handleInvalidDate({ key: 'value' }), null);
  });

  it('let a query in only without functions and keys that reach a prototype', () => {
    const query = { match_phrase: { customer_gender: 'MALE' } };
    assert.deepEqual(handleInvalidQuery(query), query);
    assert.notEqual(handleInvalidQuery(query), query);
    assert.equal(handleInvalidQuery(null), null);
    assert.equal(handleInvalidQuery(undefined), null);
    assert.equal(handleInvalidQuery([query]), null);
    assert.equal(handleInvalidQuery({ key1: 'value1', key2: () => 1 }), null);
    assert.equal(handleInvalidQuery({ key1: 'value1', key2: { func: () => 1 } }), null);
    assert.throws(() => handleInvalidQuery(JSON.parse('{ "__proto__": null }')), { message: "'__proto__' is an invalid key" });
    assert.throws(() => handleInvalidQuery(JSON.parse('{ "constructor": { "prototype" : null } }')), { message: "'constructor.prototype' is an invalid key" });
    // a field may be named constructor or prototype
    assert.deepEqual(handleInvalidQuery({ match: { constructor: 'x', prototype: 'y' } }), { match: { constructor: 'x', prototype: 'y' } });
    const circular: SpecObject = { a: {} };
    (circular.a as SpecObject).back = circular.a;
    assert.throws(() => validateObject(circular), { message: 'circular reference detected' });
  });

  it('find functions in objects and in lists of objects', () => {
    assert.equal(checkForFunctionProperty({ key1: 'value1', key2: () => 1 }), true);
    assert.equal(checkForFunctionProperty({ key1: () => 1, key2: 'value1' }), true);
    assert.equal(checkForFunctionProperty({ key1: { nestedKey1: 'nestedValue1', nestedKey2: () => 1 }, key2: 'value1' }), true);
    assert.equal(checkForFunctionProperty({ key1: 'value1', key2: 'value2' }), false);
    assert.equal(checkForFunctionProperty({ key1: { nestedKey1: 'nestedValue1', nestedKey2: 'nestedValue2' }, key2: 'value2' }), false);
    assert.equal(checkForFunctionProperty({ a: [{ func: () => 1 }] }), true);
    assert.equal(checkForFunctionProperty({ a: [{ key: { toJSON: setTimeout } }] }), true);
    assert.equal(checkForFunctionProperty({ arr: [{ key: 'value' }] }), false);
  });
});

describe('the time range a spec sets', () => {
  it('keeps absolute dates absolute, earliest first', () => {
    assert.deepEqual(parseTimeRange('2021-01-01T00:00:00Z', '2021-02-01T00:00:00Z'), { from: '2021-01-01T00:00:00.000Z', to: '2021-02-01T00:00:00.000Z' });
    assert.deepEqual(parseTimeRange(Date.UTC(2021, 1, 1), Date.UTC(2021, 0, 1)), { from: '2021-01-01T00:00:00.000Z', to: '2021-02-01T00:00:00.000Z' });
    // a date without a time is local, as moment reads it
    assert.equal(parseTimeRange('2021-01-01', '2021-01-02').from, new Date(2021, 0, 1).toISOString());
  });

  it('keeps relative times relative, and makes both absolute when one is', () => {
    assert.deepEqual(parseTimeRange('now-1d', 'now'), { from: 'now-1d', to: 'now' });
    assert.deepEqual(parseTimeRange('now', 'now-1d'), { from: 'now-1d', to: 'now' });
    const mixed = parseTimeRange('2021-01-01T00:00:00Z', 'now/d');
    assert.equal(mixed.from, '2021-01-01T00:00:00.000Z');
    // the end of a relative time is not rounded up
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    assert.equal(mixed.to, today.toISOString());
  });

  it('fails with the original\'s words on times it cannot read', () => {
    assert.throws(() => parseTimeRange('soon', 'now'), {
      message: 'Error setting time filter: both time values must be either relative or absolute dates. start="soon", end="now"',
    });
    assert.throws(() => parseTimeRange(null, 'now'), {
      message: 'Error setting time filter: both time values must be either relative or absolute dates. start=null, end="now"',
    });
    // as @osd/datemath, a number cannot be read as a relative time
    assert.throws(() => parseTimeRange(1658189958487, 'now'), { message: 'text.substring is not a function' });
  });
});

describe('tooltips, as vega-tooltip 0.30 writes them and EUI places them', () => {
  const escape = (value: unknown) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;');

  it('writes a value as a title, an image and a table of the rest', () => {
    assert.equal(formatTooltipValue('plain <b>', escape, 2), 'plain &lt;b>');
    assert.equal(formatTooltipValue(42, escape, 2), '42');
    assert.equal(formatTooltipValue(['a', 1, { b: 2 }], escape, 2), '[a, 1, {"b":2}]');
    assert.equal(
      formatTooltipValue({ title: 'Title', image: 'x.png', a: 1, b: undefined, c: { d: { e: { f: 1 } } }, 'k<': 'v' }, escape, 2),
      '<h2>Title</h2><img src="x.png"><table><tr><td class="key">a:</td><td class="value">1</td></tr><tr><td class="key">c:</td><td class="value">{"d":{"e":{"f":1}}}</td></tr><tr><td class="key">k&lt;:</td><td class="value">v</td></tr></table>'
    );
    assert.equal(formatTooltipValue({}, escape, 2), '{}');
    assert.equal(formatTooltipValue({ title: 'T' }, escape, 2), '<h2>T</h2>');
    assert.equal(formatTooltipValue({ a: [1, [2, [3, [4]]]] }, escape, 2), '<table><tr><td class="key">a:</td><td class="value">[1,[2,[3,"[Object]"]]]</td></tr></table>');
  });

  it('goes where it shows most of itself, the side asked for when all show as much', () => {
    (globalThis as unknown as { window: { innerWidth: number; innerHeight: number } }).window = { innerWidth: 1000, innerHeight: 800 };
    const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height });
    assert.deepEqual(calculatePopoverPosition(rect(100, 10, 20, 20), { width: 200, height: 100 }, 'top', 16), {
      position: 'bottom',
      left: 10,
      top: 46,
      width: 200,
      height: 100,
    });
    assert.deepEqual(calculatePopoverPosition(rect(400, 400, 20, 20), { width: 200, height: 100 }, 'top', 16), {
      position: 'top',
      left: 310,
      top: 284,
      width: 200,
      height: 100,
    });
    // ten pixels away unless told otherwise
    assert.equal(calculatePopoverPosition(rect(400, 400, 20, 20), { width: 200, height: 100 }, 'right').left, 430);
  });
});

describe('versions and schemas, as compare-versions 3.5.1 and vega-schema-url-parser 2.2.0 read them', () => {
  it('compares versions', () => {
    const pairs: Array<[string, string, number]> = [
      ['6.2.0', '6.2.0', 0], ['6.99', '6.2.0', 1], ['v5', '6.2.0', -1], ['6', '6.2.0', -1], ['6.2', '6.2.0', 0], ['6.2.0-beta.1', '6.2.0', -1],
      ['6.2.0', '6.2.0-rc.1', 1], ['6.2.0-rc.2', '6.2.0-rc.10', -1], ['6.2.0-rc.a', '6.2.0-rc.1', 1], ['6.x', '6.2.0', 0], ['5.4.0+build', '5.4.0', 0],
    ];
    for (const [a, b, expected] of pairs) assert.equal(compareVersions(a, b), expected, `${a} ${b}`);
    assert.throws(() => compareVersions('nope', '1.0.0'), { message: "Invalid argument not valid semver ('nope' received)" });
  });

  it('reads the library and version of a schema address', () => {
    assert.deepEqual(parseSchemaUrl('https://vega.github.io/schema/vega/v6.json'), { library: 'vega', version: 'v6' });
    assert.deepEqual(parseSchemaUrl('https://vega.github.io/schema/vega-lite/v5.8.0.json'), { library: 'vega-lite', version: 'v5.8.0' });
    assert.deepEqual(parseSchemaUrl('https://example.com/schema/custom-lib/2.json'), { library: 'custom-lib', version: '2' });
    assert.throws(() => parseSchemaUrl('not a schema'), { message: "Cannot read properties of null (reading 'slice')" });
  });
});

// --- Vega maps ------------------------------------------------------------------------------------

describe('a spec on a map, as leaflet-vega 0.9.0 prepares it', () => {
  const inject = (spec: SpecObject) => {
    const warnings: unknown[] = [];
    const injector = new SpecInjector((...args) => warnings.push(args));
    injector.overrideField(spec, 'padding', 0);
    injector.overrideField(spec, 'autosize', 'none');
    injector.addToList(spec, 'signals', ['zoom', 'latitude', 'longitude']);
    injector.addToList(spec, 'projections', [defaultProjection()]);
    return { spec, warnings };
  };

  it('gets the map\'s signals and projection, no padding and no autosize', () => {
    assert.deepEqual(inject({ padding: 5, autosize: 'fit', signals: [{ name: 'zoom', value: 3 }], projections: [] }), {
      spec: {
        padding: 0,
        autosize: 'none',
        signals: [{ name: 'zoom', value: 3 }, { name: 'latitude' }, { name: 'longitude' }],
        projections: [
          {
            name: 'projection',
            type: 'mercator',
            scale: { signal: '256*pow(2,zoom)/2/PI' },
            rotate: [{ signal: '-longitude' }, 0, 0],
            center: [0, { signal: 'latitude' }],
            translate: [{ signal: 'width/2' }, { signal: 'height/2' }],
            fit: false,
          },
        ],
      },
      warnings: [['Overriding padding: 5 \u{100D8} 0'], ['Overriding autosize: fit \u{100D8} none']],
    });
    assert.deepEqual(inject({ autosize: { type: 'fit' } }).warnings, [['Overriding autosize: [object Object] \u{100D8} none']]);
  });

  it('keeps a projection of its own and what it already has', () => {
    const { spec, warnings } = inject({ padding: 0, projections: [{ name: 'projection', type: 'albers' }], signals: [{ name: 'latitude' }, { value: 1 }] });
    assert.deepEqual(spec.projections, [{ name: 'projection', type: 'albers' }]);
    assert.deepEqual(spec.signals, [{ name: 'latitude' }, { value: 1 }, { name: 'zoom' }, { name: 'longitude' }]);
    assert.deepEqual(warnings, []);
    assert.throws(() => inject({ signals: 'x' }), { message: 'spec.signals must be an array' });
  });

  it('reads the ways setMapView() can be called', () => {
    assert.deepEqual(readSetMapView([[[1, 2], [3, 4]]]), { bounds: [[1, 2], [3, 4]] });
    assert.deepEqual(readSetMapView([[10, 20]]), { lat: 20, lng: 10, zoom: undefined });
    assert.deepEqual(readSetMapView([[10, 20], 5]), { lat: 20, lng: 10, zoom: 5 });
    assert.deepEqual(readSetMapView([20, 10]), { lat: 20, lng: 10, zoom: undefined });
    assert.deepEqual(readSetMapView([20, 10, 3]), { lat: 20, lng: 10, zoom: 3 });
    // a latitude or longitude that is not there moves nothing
    assert.equal(readSetMapView([undefined, 10, 'x']), undefined);
  });

  it('fails as the original on any other call', () => {
    const message =
      'Unexpected setMapView() parameters. It could be called with a bounding box setMapView([[longitude1,latitude1],[longitude2,latitude2]]), or it could be the center point setMapView([longitude, latitude], optional_zoom), or it can be used as setMapView(latitude, longitude, optional_zoom)';
    for (const args of [[], [1, 2, 3, 4], [[[1, 2], [3]]], [[10, 'x']], [[1, 2, 3]], [[10, 20], 'a'], ['a', 10], [20, 10, '3']]) {
      assert.throws(() => readSetMapView(args), { message });
    }
  });
});

// --- Inspect --------------------------------------------------------------------------------------

describe('the data sets and signals Inspect shows, as the original lists them', () => {
  it('writes each cell as text, objects as JSON', () => {
    const throwing = {
      toJSON() {
        throw new Error('no');
      },
    };
    assert.deepEqual(serializeColumns({ a: 1, b: { c: [1] }, d: null, e: undefined, f: throwing }, ['a', 'b', 'd', 'e', 'f']), {
      a: '1',
      b: '{"c":[1]}',
      d: 'null',
      e: 'undefined',
      f: '(..)',
    });
  });

  it('lists the data sets that hold rows, and every signal', async () => {
    const view = new vega.View(
      vega.parse({
        signals: [{ name: 'size', value: 3 }, { name: 'pick', value: { a: 1 } }],
        data: [{ name: 'table', values: [{ x: 1, y: 'a' }, { x: 2, y: { z: 1 } }] }, { name: 'empty', values: [] }],
      }),
      { renderer: 'none' }
    );
    await view.runAsync();
    const shown = view as unknown as VegaView;
    const sets = vegaDataSets(shown);
    // the scenegraph's root is one of them, as in the original; its mark cannot be written
    assert.deepEqual(sets.map((set) => set.id), ['root', 'table']);
    assert.equal(sets[0].data[0].mark, '(..)');
    assert.deepEqual(sets[1], { id: 'table', columns: ['x', 'y'], data: [{ x: '1', y: 'a' }, { x: '2', y: '{"z":1}' }] });
    const signals = vegaSignals(shown);
    assert.deepEqual(signals.columns, ['Signal', 'Value']);
    assert.deepEqual(
      signals.data.filter((row) => row.Signal === 'size' || row.Signal === 'pick'),
      [{ Signal: 'size', Value: '3' }, { Signal: 'pick', Value: '{"a":1}' }]
    );
  });

  it('draws the spec plain, with a guide for each two spaces of an indent', () => {
    assert.deepEqual(specLines('{\n  "a": {\n     "b": 1\n  }\n}\n    '), [
      [{ text: '{' }],
      [{ text: '  ', kind: 'SpecGuide' }, { text: '"a": {' }],
      [{ text: '  ', kind: 'SpecGuide' }, { text: '  ', kind: 'SpecGuide' }, { text: ' "b": 1' }],
      [{ text: '  ', kind: 'SpecGuide' }, { text: '}' }],
      [{ text: '}' }],
      [{ text: '  ', kind: 'SpecGuide' }, { text: '  ', kind: 'SpecGuide' }],
    ]);
  });
});

describe('the grid Inspect shows them in, as the original\'s data grid', () => {
  const columns: GridColumn[] = [{ id: 'Signal', initialWidth: 150 }, { id: 'Value' }];

  it('shares out the width the set columns leave, 100 pixels a column at least', () => {
    assert.deepEqual(columnWidths(columns, {}, 651), { Signal: 150, Value: 501 });
    assert.deepEqual(columnWidths(columns, { Value: 80 }, 651), { Signal: 150, Value: 80 });
    assert.deepEqual(columnWidths([{ id: 'a' }, { id: 'b' }, { id: 'c' }], {}, 250), { a: 100, b: 100, c: 100 });
    assert.deepEqual(columnWidths([{ id: 'a', initialWidth: 70 }], {}, 651), { a: 70 });
  });

  it('sorts the rows field by field, comparing their text', () => {
    const rows: GridRow[] = [
      { a: '2', b: 'x' },
      { a: '10', b: 'y' },
      { a: '2', b: 'a' },
      { a: undefined, b: 'z' },
    ];
    // '10' comes before '2' as text; a missing value is neither before nor after another, so the
    // next field decides
    assert.deepEqual(
      sortedRows(rows, [{ id: 'a', direction: 'asc' }, { id: 'b', direction: 'desc' }]).map((row) => row.b),
      ['z', 'y', 'x', 'a']
    );
    assert.deepEqual(sortedRows(rows, []), rows);
    assert.notEqual(sortedRows(rows, []), rows);
  });

  it('moves a column a place, and no further than the ends', () => {
    assert.deepEqual(movedColumn(['a', 'b', 'c'], 'b', -1), ['b', 'a', 'c']);
    assert.deepEqual(movedColumn(['a', 'b', 'c'], 'b', 1), ['a', 'c', 'b']);
    assert.deepEqual(movedColumn(['a', 'b', 'c'], 'a', -1), ['a', 'b', 'c']);
    assert.deepEqual(movedColumn(['a', 'b', 'c'], 'd', 1), ['a', 'b', 'c']);
  });

  it('sorts a column in its place when it is sorted already, else last', () => {
    const sorting: GridSort[] = [{ id: 'a', direction: 'asc' }, { id: 'b', direction: 'asc' }];
    assert.deepEqual(sortedBy(sorting, 'a', 'desc'), [{ id: 'a', direction: 'desc' }, { id: 'b', direction: 'asc' }]);
    assert.deepEqual(sortedBy(sorting, 'c', 'asc'), [...sorting, { id: 'c', direction: 'asc' }]);
  });

  it('says how many columns are hidden and how many fields sort it', () => {
    assert.deepEqual([0, 1, 2].map(columnsButtonText), ['Columns', '1 column hidden', '2 columns hidden']);
    assert.deepEqual([0, 1, 2].map(sortButtonText), ['Sort fields', '1 field sorted', '2 fields sorted']);
  });

  it('colours a value as the library\'s code block colours JSON', () => {
    assert.deepEqual(jsonTokens('{"user":"default","n":-4.5e2,"item":null}'), [
      { text: '{', kind: 'punctuation' },
      { text: '"user":' },
      { text: '"default"', kind: 'string' },
      { text: ',', kind: 'punctuation' },
      { text: '"n":' },
      { text: '-4.5e2', kind: 'number' },
      { text: ',', kind: 'punctuation' },
      { text: '"item":' },
      { text: 'null', kind: 'keyword' },
      { text: '}', kind: 'punctuation' },
    ]);
    assert.deepEqual(jsonTokens('#ddd'), [{ text: '#ddd' }]);
    assert.deepEqual(jsonTokens('(..)'), [{ text: '(..)' }]);
    assert.deepEqual(jsonTokens('[true, 0]'), [
      { text: '[', kind: 'punctuation' },
      { text: 'true', kind: 'keyword' },
      { text: ',', kind: 'punctuation' },
      { text: ' ' },
      { text: '0', kind: 'number' },
      { text: ']', kind: 'punctuation' },
    ]);
  });
});

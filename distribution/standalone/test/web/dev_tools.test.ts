/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  ROW,
  autoIndent,
  blocksBetween,
  bodyOf,
  deprecationMessages,
  describePast,
  expandToRequests,
  failedAnswer,
  formatAnswer,
  historyKey,
  insertRequest,
  keyPath,
  outputOf,
  parseCurl,
  parseRequests,
  placeActions,
  readConsole,
  requestAt,
  requestEdge,
  requestsBetween,
  requestsInRange,
  rowMode,
  suggest,
  toCurl,
  typedOnLine,
  type Answer,
  type ClusterNames,
} from '../../web/apps/dev_tools/console_model';
import { highlight, indentGuides, tokenClasses, type AceToken } from '../../web/apps/dev_tools/console_highlight';
import { matchingBracket, selectionOf } from '../../web/apps/dev_tools/console_editor';
import { MAX_HISTORY, autocompleteRequests, consoleStorage, type KeyValueStore } from '../../web/apps/dev_tools/console_storage';
import { failureReason, grokSimulation, grokValue, readSimulation } from '../../web/apps/dev_tools/grok_request';
import { collapseLiteralStrings, expandLiteralStrings, reindentJson, tokenizeJson } from '../../web/lib/json_text';

const TEXT = `# the cluster
GET _cat/indices?v

POST logs/_bulk
{ "index": { "_id": "1" } }
{ "message": "one" }

put logs/_doc/2
{
  "message": "two",
  "tags": ["a", "b"]
}
{ "not": "a document of the request above" }`;

describe('the requests of a console', () => {
  const requests = parseRequests(TEXT);

  it('are lines with a method and a path, each with the documents right under it', () => {
    assert.deepEqual(
      requests.map((request) => [request.method, request.url, request.data.length, request.startLine, request.endLine]),
      [
        ['GET', '_cat/indices?v', 0, 1, 1],
        ['POST', 'logs/_bulk', 2, 3, 5],
        ['put', 'logs/_doc/2', 2, 7, 12],
      ]
    );
  });

  it('are found by the lines a selection touches, and a cursor between two is on none', () => {
    const doc = readConsole(TEXT);
    assert.deepEqual(requestsBetween(doc, 4).map((request) => request.url), ['logs/_bulk']);
    assert.deepEqual(requestsBetween(doc, 2), []);
    assert.deepEqual(requestsBetween(doc, 0, 8).map((request) => request.url), ['_cat/indices?v', 'logs/_bulk', 'logs/_doc/2']);
    assert.deepEqual(requestsInRange(requests, 4).map((request) => request.url), ['logs/_bulk']);
  });

  it('are read from the state each line ends in, as the row parser of the original reads them', () => {
    const doc = readConsole(TEXT);
    const modes = doc.lines.map((_, row) => rowMode(doc, row));
    assert.deepEqual(modes, [
      ROW.BETWEEN_REQUESTS,
      ROW.REQUEST_START | ROW.REQUEST_END,
      ROW.BETWEEN_REQUESTS,
      ROW.REQUEST_START,
      ROW.MULTI_DOC_CUR_DOC_END | ROW.IN_REQUEST,
      ROW.REQUEST_END | ROW.MULTI_DOC_CUR_DOC_END,
      ROW.BETWEEN_REQUESTS,
      ROW.REQUEST_START,
      ROW.IN_REQUEST,
      ROW.IN_REQUEST,
      ROW.IN_REQUEST,
      ROW.MULTI_DOC_CUR_DOC_END | ROW.IN_REQUEST,
      ROW.REQUEST_END | ROW.MULTI_DOC_CUR_DOC_END,
    ]);
    assert.equal(requestAt(doc, 9)?.startLine, 7);
    assert.equal(requestAt(doc, 6), undefined);
    assert.deepEqual(expandToRequests(doc, 4), [3, 5]);
    // A selection that starts between requests starts there, as in the original
    assert.deepEqual(expandToRequests(doc, 2, 9), [2, 12]);
    assert.equal(expandToRequests(doc, 0), undefined);
  });

  it('are none where a brace is left open, as all that follows is its body', () => {
    const open = readConsole('GET a\n{\n  "size": 1\n\nGET b');
    assert.deepEqual(requestsBetween(open, 0), []);
    assert.deepEqual(requestsBetween(open, 4), []);
    assert.equal(requestAt(open, 2)?.url, 'a');
    const twoLines = readConsole('GET a\nGET b');
    assert.deepEqual(requestsBetween(twoLines, 0, 1).map((request) => request.url), ['a', 'b']);
  });

  it('are jumped between by their first and last lines', () => {
    const doc = readConsole(TEXT);
    assert.equal(requestEdge(doc, 9, -1), 7);
    assert.equal(requestEdge(doc, 7, -1), 5);
    assert.equal(requestEdge(doc, 1, 1), 3);
    assert.equal(requestEdge(doc, 8, 1), 12);
    assert.equal(requestEdge(doc, 0, -1), 0);
  });

  it('send their documents one under the other with a line break at the end', () => {
    assert.equal(bodyOf(requests[1]), '{ "index": { "_id": "1" } }\n{ "message": "one" }\n');
    assert.equal(bodyOf(requests[0]), '');
  });

  it('keep a brace inside a string or a script out of the count', () => {
    const [request] = parseRequests('POST _scripts/x\n{\n  "script": """\n    if (a) { b }\n  """,\n  "note": "}"\n}\nGET _search');
    assert.equal(request.endLine, 6);
    assert.equal(JSON.parse(bodyOf(request)).script.trim(), 'if (a) { b }');
  });

  it('do not start on a comment', () => {
    assert.deepEqual(parseRequests('# GET _search\n// POST x/_doc'), []);
  });
});

describe("the request's buttons", () => {
  // Rows of 18 pixels from the top of an editor 200 pixels high, scrolled by `scroll`
  const layout = (scroll = 0, wrapLimit = 80) => ({
    lineTop: (line: number) => line * 18 - scroll,
    lineBottom: (line: number) => (line + 1) * 18 - scroll,
    endTop: (line: number) => line * 18 + 18 - scroll,
    height: 200,
    wrapLimit,
  });
  const lines = ['GET a', '{', '  "b": 1', '}', '', 'GET c'];

  it("sit on the request's first line while it is in sight", () => {
    assert.deepEqual(placeActions(lines, [5, 5], layout()), { top: 90 });
    assert.deepEqual(placeActions(lines, [0, 3], layout()), { top: 0 });
  });

  it('sit on the bottom edge while the first line is below the editor', () => {
    assert.deepEqual(placeActions(lines, [5, 5], layout(-150)), { bottom: 0 });
  });

  it('sit on the top edge while only the end of the request is in sight, and stay once it is gone', () => {
    assert.deepEqual(placeActions(lines, [0, 3], layout(30)), { top: 0 });
    assert.equal(placeActions(lines, [0, 3], layout(80)), undefined);
  });

  it('move off a first line long enough to wrap: to the line before, or after the first line', () => {
    const long = `GET ${'x'.repeat(80)}`;
    assert.deepEqual(placeActions(['GET a', '', long], [2, 2], layout()), { top: 18 });
    assert.deepEqual(placeActions([long, '{}'], [0, 1], layout()), { top: 18 });
    // A line that is all there is: the row its end is on
    assert.deepEqual(placeActions([long], [0, 0], layout()), { top: 18 });
    // Five characters short of the limit is not long enough
    assert.deepEqual(placeActions(['GET a', 'x'.repeat(75)], [1, 1], layout()), { top: 18 });
    assert.deepEqual(placeActions(['GET a', 'x'.repeat(76)], [1, 1], layout()), { top: 0 });
  });
});

describe('auto indent', () => {
  it('spreads one document over lines, and puts it back on one line the next time', () => {
    const [compact] = parseRequests('GET _search\n{"size":1,"query":{"match_all":{}},"sort":[]}');
    const spread = autoIndent(compact);
    assert.equal(spread, 'GET _search\n{\n  "size": 1,\n  "query": {\n    "match_all": {}\n  },\n  "sort": []\n}');
    assert.equal(autoIndent(parseRequests(spread)[0]), 'GET _search\n{"size":1,"query":{"match_all":{}},"sort":[]}');
  });

  it('puts each of several documents on a line', () => {
    const [bulk] = parseRequests('POST _bulk\n{\n  "index": {}\n}\n{\n  "a": 1\n}');
    assert.equal(autoIndent(bulk), 'POST _bulk\n{"index":{}}\n{"a":1}');
  });

  it('leaves alone what is not JSON', () => {
    const [broken] = parseRequests('GET _search\n{ "size": }');
    assert.equal(autoIndent(broken), 'GET _search\n{ "size": }');
  });
});

describe('JSON as text', () => {
  it('keeps a number longer than JavaScript can hold', () => {
    assert.equal(reindentJson('{"id":9007199254740993123,"n":1.0}'), '{\n  "id": 9007199254740993123,\n  "n": 1.0\n}');
  });

  it('refuses what is not JSON', () => {
    assert.throws(() => reindentJson('{"a":}'));
    assert.throws(() => reindentJson('{"a":1} x'));
    assert.throws(() => reindentJson('{"a" 1}'));
  });

  it('reads and writes triple quotes', () => {
    assert.equal(collapseLiteralStrings('{"s": """a "b"\nc"""}'), '{"s": "a \\"b\\"\\nc"}');
    assert.equal(expandLiteralStrings('{"s": "a\\nb", "t": "plain"}'), '{"s": """a\nb""", "t": "plain"}');
    assert.equal(expandLiteralStrings('"\\"quoted\\""'), '"\\"quoted\\""');
  });

  it('colours names, strings, numbers and the three words', () => {
    const [line] = tokenizeJson('  "a": ["x", 1.5, true, null]');
    assert.deepEqual(
      line.filter((token) => token.kind).map((token) => [token.text, token.kind]),
      [
        ['"a"', 'Key'],
        ['"x"', 'String'],
        ['1.5', 'Number'],
        ['true', 'Keyword'],
        ['null', 'Keyword'],
      ]
    );
  });
});

describe('answers', () => {
  it('are spread over lines when they are JSON, and headed when several were asked', () => {
    assert.equal(formatAnswer('{"acknowledged":true}', 'application/json; charset=UTF-8', { heading: 'PUT logs' }), '# PUT logs\n{\n  "acknowledged": true\n}');
    assert.equal(formatAnswer('index docs\nlogs 3\n', 'text/plain'), 'index docs\nlogs 3\n');
  });

  it('start with the warnings OpenSearch sent', () => {
    const header = '299 OpenSearch-3.9.0 "[types removal] Specifying types is deprecated.", 299 OpenSearch-3.9.0 "a \\"second\\" one"';
    assert.deepEqual(deprecationMessages(header), [
      '#! Deprecation: [types removal] Specifying types is deprecated.',
      '#! Deprecation: a "second" one',
    ]);
    assert.ok(formatAnswer('{}', 'application/json', { warnings: header }).startsWith('#! Deprecation: [types removal]'));
  });
  it('spread the JSON of a request that failed over lines too', () => {
    // The original shows the error of OpenSearch as it shows any other answer, not on one line
    const error = '{"error":{"type":"index_not_found_exception","index":"nope"},"status":404}';
    assert.equal(
      failedAnswer(error, 'application/json; charset=UTF-8', 404),
      '{\n  "error": {\n    "type": "index_not_found_exception",\n    "index": "nope"\n  },\n  "status": 404\n}'
    );
    assert.equal(failedAnswer('No handler found', 'text/plain', 400), 'No handler found');
    assert.equal(failedAnswer('', 'text/plain', 502), 'Request failed to get to the server (status code: 502)');
  });
});

describe('the output pane', () => {
  const answer = (value: string, ok = true): Answer => ({ ok, method: 'GET', path: '_search', data: '', contentType: 'application/json', timeMs: 1, value });

  it('shows strings with line breaks in triple quotes when the setting asks for it', () => {
    const value = '{\n  "script": "a\\nb"\n}';
    assert.deepEqual(outputOf([answer(value)], true), { value: '{\n  "script": """a\nb"""\n}', mode: 'output' });
    assert.deepEqual(outputOf([answer(value)], false), { value, mode: 'output' });
  });

  it('leaves the answer of a request that failed as it came', () => {
    const value = '{\n  "reason": "a\\nb"\n}';
    assert.equal(outputOf([answer(value, false)], true).value, value);
  });

  it('puts several answers one under the other, and is plain text when empty', () => {
    assert.equal(outputOf([answer('# GET a\n{}'), answer('# GET b\n{}')], true).value, '# GET a\n{}\n# GET b\n{}');
    assert.deepEqual(outputOf([], true), { value: '', mode: 'text' });
  });
});

describe('the settings', () => {
  it('decide what the console asks OpenSearch for its suggestions', () => {
    assert.deepEqual(
      autocompleteRequests({ fields: true, indices: true, templates: true }).map((request) => request.path),
      ['_mapping', '_aliases', '_template']
    );
    assert.deepEqual(autocompleteRequests({ fields: false, indices: true, templates: false }).map((request) => request.path), ['_aliases']);
    assert.deepEqual(autocompleteRequests({ fields: false, indices: false, templates: false }), []);
  });

  it('are kept under the names of the original, with its defaults', () => {
    const store = memoryStore();
    const storage = consoleStorage(store);
    assert.deepEqual(storage.loadSettings(), {
      fontSize: 14,
      wrapMode: true,
      tripleQuotes: true,
      autocomplete: { fields: true, indices: true, templates: true },
      polling: true,
    });
    storage.saveSettings({ fontSize: 18, wrapMode: false, tripleQuotes: false, autocomplete: { fields: false, indices: true, templates: true }, polling: false });
    assert.equal(store.getItem('sense:font_size'), '18');
    assert.equal(store.getItem('sense:wrap_mode'), 'false');
    assert.equal(store.getItem('sense:autocomplete_settings'), '{"fields":false,"indices":true,"templates":true}');
    assert.equal(consoleStorage(store).loadSettings().fontSize, 18);
  });
});

describe('cURL', () => {
  it('is written for the requests a selection touches, with the text between them', () => {
    const doc = readConsole(TEXT);
    assert.equal(toCurl(blocksBetween(doc, 1, 1, true), 'http://localhost:9200/'), 'curl -XGET "http://localhost:9200/_cat/indices?v"');
    assert.equal(
      toCurl(blocksBetween(doc, 4, 4, true), 'https://search.example:9200'),
      'curl -XPOST "https://search.example:9200/logs/_bulk" -H \'Content-Type: application/json\' -d\'\n{ "index": { "_id": "1" } }\n{ "message": "one" }\n\''
    );
    assert.equal(
      toCurl(blocksBetween(doc, 0, 3, true), 'http://h'),
      '# the cluster\ncurl -XGET "http://h/_cat/indices?v"\ncurl -XPOST "http://h/logs/_bulk" -H \'Content-Type: application/json\' -d\'\n{ "index": { "_id": "1" } }\n{ "message": "one" }\n\''
    );
  });

  it('closes, escapes and opens again the shell string for a single quote', () => {
    const doc = readConsole('POST x/_doc\n{"name": "it\'s"}');
    assert.equal(toCurl(blocksBetween(doc, 0), 'http://h'), 'curl -XPOST "http://h/x/_doc" -H \'Content-Type: application/json\' -d\'\n{"name": "it\'\\\'\'s"}\'');
  });

  it('is read as a request', () => {
    assert.equal(parseCurl('curl -XGET "http://localhost:9200/_cat/indices?v"'), 'GET _cat/indices?v');
    assert.equal(
      parseCurl(`curl -X POST 'https://host:9200/logs/_search' -H 'Content-Type: application/json' -d '{"size": 1}'`),
      'POST logs/_search\n{"size": 1}'
    );
    assert.equal(parseCurl('curl localhost:9200/_cluster/health'), 'GET _cluster/health');
    assert.equal(parseCurl('curl -XDELETE search.example/logs-1'), 'DELETE logs-1');
  });

  it('is read back with the single quotes of its body', () => {
    // What "Copy as cURL" writes for a body with a quote in it, pasted again
    const text = 'POST x/_doc\n{"name": "it\'s", "path": "c:\\\\temp"}';
    assert.equal(parseCurl(toCurl(blocksBetween(readConsole(text), 0), 'http://h')), text);
    assert.equal(
      parseCurl(`curl -XPUT 'http://h:9200/a/_doc/1' -d '\n{"t":"it'\\''s"}\n'\ncurl -XDELETE http://h:9200/a`),
      'PUT a/_doc/1\n{"t":"it\'s"}\n\nDELETE a'
    );
  });
});

// A line as Ace draws it: the indent guides cut from its first token, a token without a class bare
function drawn(tokens: AceToken[]): string {
  const parts: string[] = [];
  tokens.forEach((token, index) => {
    let value = token.value;
    if (index === 0) {
      const { guides, rest } = indentGuides(value, 2);
      for (let guide = 0; guide < guides; guide += 1) parts.push('ace_indent-guide:"  "');
      value = rest;
      if (!value) return;
    }
    const classes = tokenClasses(token.type);
    parts.push(classes ? `${classes.replace(/dvtTok-/g, 'ace_')}:${JSON.stringify(value)}` : JSON.stringify(value));
  });
  return parts.join(' | ');
}

describe('the colours of the console', () => {
  it('are the tokens the original draws for what is typed', () => {
    const text = [
      '# a comment',
      'GET _search',
      '{',
      '  "query": {',
      '    "match_all": {}',
      '  },',
      '  "size": 10,',
      '  "track_total_hits": true,',
      '  "_source": null,',
      '  "script": """',
      '    return 1;',
      '  """',
      '}',
      '',
      'GET _cat/indices?v&s=index',
      '',
      'POST logs/_doc/1?refresh=true',
      '{"a": 1.5, "b": [1, "x", false]}',
    ].join('\n');
    // As the original's Ace drew it, element by element, with the theme's "ace_" classes
    const original = [
      'ace_comment:"# a comment"',
      'ace_method:"GET" | ace_whitespace:" " | ace_url ace_part:"_search"',
      'ace_paren ace_lparen:"{"',
      'ace_whitespace:"  " | ace_variable:"\\"query\\"" | ace_punctuation ace_colon:":" | ace_whitespace:" " | ace_paren ace_lparen:"{"',
      'ace_indent-guide:"  " | ace_whitespace:"  " | ace_variable:"\\"match_all\\"" | ace_punctuation ace_colon:":" | ace_whitespace:" " | ace_paren ace_lparen:"{" | ace_paren ace_rparen:"}"',
      'ace_whitespace:"  " | ace_paren ace_rparen:"}" | ace_punctuation ace_comma:","',
      'ace_whitespace:"  " | ace_variable:"\\"size\\"" | ace_punctuation ace_colon:":" | ace_whitespace:" " | ace_constant ace_numeric:"10" | ace_punctuation ace_comma:","',
      'ace_whitespace:"  " | ace_variable:"\\"track_total_hits\\"" | ace_punctuation ace_colon:":" | ace_whitespace:" " | ace_constant ace_language ace_boolean:"true" | ace_punctuation ace_comma:","',
      'ace_whitespace:"  " | ace_variable:"\\"_source\\"" | ace_punctuation ace_colon:":" | ace_whitespace:" " | "null" | ace_punctuation ace_comma:","',
      'ace_whitespace:"  " | ace_variable:"\\"script\\"" | ace_ace ace_punctuation ace_colon:":" | ace_whitespace:" " | ace_punctuation ace_start_triple_quote:"\\"\\"\\""',
      'ace_indent-guide:"  " | ace_script ace_text:"  " | ace_script ace_keyword:"return" | ace_script ace_text:" " | ace_script ace_constant ace_numeric:"1" | ";"',
      'ace_script ace_text:"  " | ace_punctuation ace_end_triple_quote:"\\"\\"\\""',
      'ace_paren ace_rparen:"}"',
      '',
      'ace_method:"GET" | ace_whitespace:" " | ace_url ace_part:"_cat" | ace_url ace_slash:"/" | ace_url ace_part:"indices" | ace_url ace_questionmark:"?" | ace_url ace_param:"v" | ace_url ace_amp:"&" | ace_url ace_param:"s" | ace_url ace_equal:"=" | ace_url ace_value:"index"',
      '',
      'ace_method:"POST" | ace_whitespace:" " | ace_url ace_part:"logs" | ace_url ace_slash:"/" | ace_url ace_part:"_doc" | ace_url ace_slash:"/" | ace_url ace_part:"1" | ace_url ace_questionmark:"?" | ace_url ace_param:"refresh" | ace_url ace_equal:"=" | ace_url ace_value:"true"',
      'ace_paren ace_lparen:"{" | ace_variable:"\\"a\\"" | ace_punctuation ace_colon:":" | ace_whitespace:" " | ace_constant ace_numeric:"1.5" | ace_punctuation ace_comma:"," | ace_whitespace:" " | ace_variable:"\\"b\\"" | ace_punctuation ace_colon:":" | ace_whitespace:" " | ace_paren ace_lparen:"[" | ace_constant ace_numeric:"1" | ace_punctuation ace_comma:"," | ace_whitespace:" " | ace_string:"\\"x\\"" | ace_punctuation ace_comma:"," | ace_whitespace:" " | ace_constant ace_language ace_boolean:"false" | ace_paren ace_rparen:"]" | ace_paren ace_rparen:"}"',
    ];
    assert.deepEqual(highlight(text, 'input').lines.map(drawn), original);
  });

  it('are the tokens the original draws for an answer, with its warnings and headings', () => {
    const answer = '#! Deprecation: old\n# GET _search\n{\n  "error": {\n    "root_cause": [\n      {\n        "line": 7,\n        "reason": "Unknown key"\n      }\n    ]\n  },\n  "status": 400\n}';
    const lines = highlight(answer, 'output').lines.map(drawn);
    assert.equal(lines[0], 'ace_warning:"#! Deprecation: old"');
    assert.equal(lines[1], 'ace_comment:"# GET _search"');
    assert.equal(lines[4], 'ace_indent-guide:"  " | ace_whitespace:"  " | ace_variable:"\\"root_cause\\"" | ace_punctuation ace_colon:":" | ace_whitespace:" " | ace_paren ace_lparen:"["');
    assert.equal(lines[6], 'ace_indent-guide:"  " | ace_indent-guide:"  " | ace_indent-guide:"  " | ace_whitespace:"  " | ace_variable:"\\"line\\"" | ace_punctuation ace_colon:":" | ace_whitespace:" " | ace_constant ace_numeric:"7" | ace_punctuation ace_comma:","');
    assert.equal(lines[11], 'ace_whitespace:"  " | ace_variable:"\\"status\\"" | ace_punctuation ace_colon:":" | ace_whitespace:" " | ace_constant ace_numeric:"400"');
  });

  it('read any answer as the output, a table of _cat too', () => {
    const [header, row] = highlight('health status index\ngreen  open   .kibana_1', 'output').lines.map(drawn);
    assert.equal(header, '"health" | ace_whitespace:" " | "status" | ace_whitespace:" " | "index"');
    assert.equal(row, '"green" | ace_whitespace:"  " | "open" | ace_whitespace:"   " | ".kibana_" | ace_constant ace_numeric:"1"');
  });

  it('end each line in the state the next one starts in, a stack while braces are open', () => {
    const { states } = highlight('GET _search\n{\n  "a": {\n  }\n}', 'input');
    assert.equal(states[0], 'start');
    assert.equal(states[1], 'json');
    assert.deepEqual(states[2], ['json', 'json']);
    assert.equal(states[4], 'start');
  });

  it('find the bracket that matches the one by the cursor', () => {
    const rows = ['{', '  "a": [1, 2]', '}'];
    const { lines } = highlight(rows.join('\n'), 'input');
    assert.deepEqual(matchingBracket(lines, rows, 0, 1), { row: 2, column: 0 });
    assert.deepEqual(matchingBracket(lines, rows, 1, 8), { row: 1, column: 12 });
    assert.equal(matchingBracket(lines, rows, 1, 4), undefined);
  });
});

describe('what could be typed next', () => {
  const names: ClusterNames = {
    indices: ['logs-1', 'logs-2', 'metrics'],
    aliases: ['logs'],
    templates: ['logs_template'],
    fields: () => ['message', 'response', 'response.keyword'],
  };
  const at = (text: string) => suggest(text, text.length, names);
  const labels = (text: string) => at(text)?.items.map((item) => item.label) ?? [];

  it('is a method at the start of a line', () => {
    assert.deepEqual(labels('p'), ['POST', 'PUT', 'PATCH']);
    assert.deepEqual(at('GET _search\n\nde')?.items[0], { label: 'DELETE', insert: 'DELETE ' });
    assert.deepEqual(labels('# p'), []);
  });

  it('is a path or the name of an index after the method', () => {
    assert.deepEqual(labels('GET _cl'), ['_cluster']);
    assert.deepEqual(labels('GET lo'), ['logs-1', 'logs-2', 'logs']);
    assert.deepEqual(labels('GET _cat/in'), ['indices']);
    assert.deepEqual(labels('GET logs-1/_se'), ['_search', '_settings', '_segments']);
    assert.deepEqual(labels('GET _plugins/_ism/po'), ['policies']);
    const found = at('GET _cat/in');
    assert.equal(found?.from, 'GET _cat/'.length);
  });

  it('is a name of the search body where a name is expected', () => {
    assert.deepEqual(labels('GET logs/_search\n{\n  "qu'), ['query']);
    assert.deepEqual(labels('GET logs/_search\n{\n  "query": {\n    "ter'), ['term', 'terms']);
    assert.deepEqual(labels('GET logs/_search\n{\n  "query": { "bool": { "mu'), ['must', 'must_not']);
    assert.deepEqual(labels('GET logs/_search\n{\n  "query": { "term": { "resp'), ['response', 'response.keyword']);
    assert.deepEqual(labels('GET logs/_search\n{\n  "aggs": { "by_code": { "ter'), ['terms']);
    assert.deepEqual(labels('GET logs/_search\n{\n  "size": 1'), []);
    assert.deepEqual(labels('GET logs/_doc/1\n{\n  "qu'), []);
  });

  it('writes a name with what follows it', () => {
    const query = at('GET logs/_search\n{\n  "qu')?.items[0];
    assert.deepEqual(query, { label: 'query', insert: '"query": {}', back: 1, meta: 'API' });
    const size = at('GET logs/_search\n{\n  "si')?.items[0];
    assert.deepEqual(size, { label: 'size', insert: '"size": ', meta: 'API' });
  });

  it('knows which objects a place is inside', () => {
    assert.deepEqual(keyPath('{ "query": { "bool": { "must": [ { "term": { '), {
      path: ['', 'query', 'bool', 'must', '', 'term'],
      expectsKey: true,
    });
    assert.equal(keyPath('{ "size": ').expectsKey, false);
  });

  it('replaces the two quotes of a name just begun', () => {
    // A quote typed is closed by the editor, which then puts the cursor between the two. While
    // the change is heard the browser still has the cursor after both: asked for from there,
    // the suggestion would be written after the first quote (""query": {})
    const text = 'GET _search\n{\n  ""\n}';
    const between = text.indexOf('""') + 1;
    const [cursor] = selectionOf([between, between], { selectionStart: between + 1, selectionEnd: between + 1 });
    const menu = suggest(text, cursor, names);
    assert.deepEqual([menu?.from, menu?.to], [between - 1, between + 1]);
    assert.equal(`${text.slice(0, menu?.from)}${menu?.items[0].insert}${text.slice(menu?.to)}`, 'GET _search\n{\n  "query": {}\n}');
    // Without a replacement under way, the text area's own selection
    assert.deepEqual(selectionOf(undefined, { selectionStart: 3, selectionEnd: 5 }), [3, 5]);
    assert.deepEqual(selectionOf(undefined, null), [0, 0]);
  });

  it('is not offered by itself on a line just begun', () => {
    // Enter after an opening brace leaves the cursor on an indented, empty line: a list opened
    // there would have the next Enter accept its first name
    const begun = 'GET _search\n{\n  "query": {\n    ';
    assert.equal(typedOnLine(begun, begun.length), false);
    assert.equal(typedOnLine('GET _search\n', 12), false);
    assert.equal(typedOnLine('', 0), false);
    assert.equal(typedOnLine(`${begun}"`, begun.length + 1), true);
    assert.equal(typedOnLine('GET _c', 6), true);
    // Asked for with Ctrl+Space, the names are there
    assert.ok(labels(begun).includes('match'));
  });
});

describe('the history of the console', () => {
  const now = Date.UTC(2026, 10, 22, 12);

  it('says how long ago a request was sent', () => {
    assert.equal(describePast({ time: now - 5000, endpoint: '_search', method: 'GET' }, now), '_search (a few seconds ago)');
    assert.equal(describePast({ time: now - 20 * 60000, endpoint: '_search', method: 'GET' }, now), '_search (20 minutes ago)');
    assert.equal(describePast({ time: now - 3 * 86400000, endpoint: 'logs/_count', method: 'GET' }, now), 'logs/_count (3 days ago)');
    assert.match(describePast({ time: now - 30 * 86400000, endpoint: '_search', method: 'GET' }, now), /^_search \(Oct 2[23]\)$/);
  });

  it('puts a past request before the request the cursor starts, after the one it is in', () => {
    const text = 'GET a\n{\n}\n\nGET b';
    assert.equal(insertRequest(text, 0, { method: 'GET', endpoint: 'new' }).text, 'GET new\n\nGET a\n{\n}\n\nGET b');
    assert.equal(insertRequest(text, 1, { method: 'GET', endpoint: 'new', data: '{}' }).text, 'GET a\n{\n}\n\nGET new\n{}\n\n\nGET b');
    assert.equal(insertRequest(text, 3, { method: 'GET', endpoint: 'new' }).text, 'GET a\n{\n}\nGET new\n\nGET b');
    // A request of one line: the past one goes before it
    assert.equal(insertRequest('GET a', 0, { method: 'GET', endpoint: 'new' }).text, 'GET new\n\nGET a');
    // The cursor goes to the first line of the request put in
    const { text: after, offset } = insertRequest(text, 1, { method: 'GET', endpoint: 'new' });
    assert.equal(after.slice(offset, offset + 7), 'GET new');
  });

  it('keeps the keys of its list to itself', () => {
    // Enter applies the chosen request, which gives the focus to the editor: left to the browser,
    // the same key press would also break a line there
    const press = (key: string) => {
      const seen: string[] = [];
      historyKey({ key, preventDefault: () => seen.push('kept') }, 2, {
        choose: (index) => seen.push(`choose ${index}`),
        apply: () => seen.push('apply'),
      });
      return seen;
    };
    assert.deepEqual(press('Enter'), ['kept', 'apply']);
    assert.deepEqual(press('ArrowDown'), ['kept', 'choose 3']);
    assert.deepEqual(press('ArrowUp'), ['kept', 'choose 1']);
    assert.deepEqual(press('Tab'), []);
  });
});

function memoryStore(initial: Record<string, string> = {}): KeyValueStore & { items: Map<string, string> } {
  const items = new Map(Object.entries(initial));
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
    removeItem: (key) => {
      items.delete(key);
    },
    keys: () => [...items.keys()],
  };
}

describe('what the console keeps in the browser', () => {
  it('is the history, newest first, the 500 latest kept', () => {
    const store = memoryStore();
    const storage = consoleStorage(store);
    const start = Date.UTC(2026, 0, 1);
    for (let index = 0; index < MAX_HISTORY + 3; index += 1) storage.addToHistory(`_doc/${index}`, 'GET', '', start + index);
    const history = storage.history();
    assert.equal(history.length, MAX_HISTORY + 1);
    assert.equal(history[0].endpoint, `_doc/${MAX_HISTORY + 2}`);
    assert.deepEqual(Object.keys(history[0]).sort(), ['data', 'endpoint', 'method', 'time']);
    assert.ok(store.items.has(`sense:hist_elem_${start + MAX_HISTORY + 2}`));
    storage.clearHistory();
    assert.deepEqual(storage.history(), []);
  });

  it('keeps two requests sent in the same millisecond apart', () => {
    const storage = consoleStorage(memoryStore());
    storage.addToHistory('a', 'GET', '', 1000);
    storage.addToHistory('b', 'GET', '', 1000);
    assert.deepEqual(storage.history().map((request) => request.endpoint), ['b', 'a']);
  });

  it('is the text of the first text object, and the text of an older console becomes one', () => {
    const store = memoryStore({ 'sense:editor_state': JSON.stringify({ content: 'GET old' }) });
    const text = consoleStorage(store).loadText(5);
    assert.equal(text.text, 'GET old');
    assert.equal(store.getItem('sense:editor_state'), null);
    assert.ok(store.getItem(`sense:console_local_text-object_${text.id}`));
    store.setItem('sense:console_local_text-object_later', JSON.stringify({ id: 'later', createdAt: 9, updatedAt: 9, text: 'GET later' }));
    assert.equal(consoleStorage(store).loadText().text, 'GET old');
  });

  it('starts with the search of everything when nothing was kept, and the welcome until it is dismissed', () => {
    const store = memoryStore();
    const storage = consoleStorage(store);
    assert.ok(storage.loadText(1).text.startsWith('GET _search\n{\n  "query": {\n    "match_all": {}'));
    assert.equal(storage.welcomeShown(), false);
    storage.setWelcomeShown();
    assert.equal(store.getItem('sense:version_welcome_shown'), '"@@SENSE_REVISION"');
    assert.equal(consoleStorage(store).welcomeShown(), true);
  });

  it('keeps the widths of the panes', () => {
    const store = memoryStore();
    const storage = consoleStorage(store);
    assert.deepEqual(storage.widths(), [50, 50]);
    storage.setWidths([40, 60]);
    assert.deepEqual(consoleStorage(store).widths(), [40, 60]);
  });
});

describe('the Grok debugger', () => {
  it('sends the sample and the pattern to a simulated pipeline with one grok processor', () => {
    assert.deepEqual(grokSimulation('%{IP:client}', '127.0.0.1', '', false), {
      body: {
        pipeline: { processors: [{ grok: { field: 'message', patterns: ['%{IP:client}'] } }] },
        docs: [{ _source: { message: '127.0.0.1' } }],
      },
    });
  });

  it('adds the custom patterns and the capture of all matches when there are some', () => {
    const simulation = grokSimulation('%{WORD:w}', 'x', 'MY_ID [a-z]+\n\n  OTHER \\d+  ', true);
    assert.ok('body' in simulation);
    if ('body' in simulation) {
      assert.deepEqual(simulation.body.pipeline.processors[0].grok, {
        field: 'message',
        patterns: ['%{WORD:w}'],
        pattern_definitions: { MY_ID: '[a-z]+', OTHER: '\\d+' },
        capture_all_matches: true,
      });
    }
  });

  it('says on which lines a custom pattern has no name', () => {
    assert.deepEqual(grokSimulation('p', 's', 'ONLYNAME\nOK x\nALSO', false), {
      customPatternError: 'Malformed pattern definition on lines 1, 3 — each line must be: PATTERN_NAME regex',
    });
    assert.deepEqual(grokSimulation('p', 's', 'ONLYNAME', false), {
      customPatternError: 'Malformed pattern definition on line 1 — each line must be: PATTERN_NAME regex',
    });
  });

  it('reads the fields of the document, or the reason it did not match', () => {
    assert.deepEqual(readSimulation({ docs: [{ doc: { _source: { client: '127.0.0.1', n: 2 } } }] }), { result: { client: '127.0.0.1', n: 2 } });
    assert.deepEqual(readSimulation({ docs: [{ error: { root_cause: [{ reason: 'Provided Grok expressions do not match field value' }] } }] }), {
      error: 'Provided Grok expressions do not match field value',
    });
    assert.deepEqual(readSimulation({ docs: [{ error: {} }] }), { error: 'Unknown error' });
    assert.deepEqual(readSimulation({}), { error: 'Unexpected response format' });
    assert.equal(failureReason({ error: { reason: 'bad pattern' } }, 'Bad Request'), 'bad pattern');
    assert.equal(failureReason(undefined, undefined), 'Request failed');
    assert.equal(grokValue({ a: 1 }), '{"a":1}');
    assert.equal(grokValue(null), 'null');
    assert.equal(grokValue(200), '200');
  });
});

describe("the console's flyouts", () => {
  // The z-index a rule of the console's stylesheet gives
  const stackOf = (selector: string): number => {
    const sheet = readFileSync('web/styles/dev_tools.css', 'utf8');
    const start = sheet.indexOf(`\n${selector} {`);
    assert.ok(start >= 0, `${selector} has a rule`);
    const found = /z-index:\s*(-?\d+)/.exec(sheet.slice(start, sheet.indexOf('}', start)));
    assert.ok(found, `${selector} sets a z-index`);
    return Number(found?.[1]);
  };

  it('stack no lower than the mask that dims the page behind them', () => {
    // Under its mask a flyout is dimmed and blurred, and a click on it closes it; at the same
    // level it is drawn over the mask, which comes before it in the page
    assert.ok(stackOf('.atlFlyout.dvtFlyout') >= stackOf('.dvtMask'));
  });
});

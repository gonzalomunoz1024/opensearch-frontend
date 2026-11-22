/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  autoIndent,
  bodyOf,
  deprecationMessages,
  describePast,
  formatAnswer,
  insertRequest,
  keyPath,
  parseCurl,
  parseRequests,
  requestsInRange,
  suggest,
  toCurl,
  tokenizeConsole,
  type ClusterNames,
} from '../../web/apps/dev_tools/console_model';
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
        ['PUT', 'logs/_doc/2', 2, 7, 12],
      ]
    );
  });

  it('are found by the lines a selection touches, and a cursor between two is on none', () => {
    assert.deepEqual(requestsInRange(requests, 4).map((request) => request.url), ['logs/_bulk']);
    assert.deepEqual(requestsInRange(requests, 2), []);
    assert.deepEqual(requestsInRange(requests, 0, 8).map((request) => request.url), ['_cat/indices?v', 'logs/_bulk', 'logs/_doc/2']);
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
});

describe('cURL', () => {
  it('is written for a request', () => {
    const [plain, bulk] = parseRequests(TEXT);
    assert.equal(toCurl(plain, 'http://localhost:9200/'), 'curl -XGET "http://localhost:9200/_cat/indices?v"');
    assert.equal(
      toCurl(bulk, 'https://search.example:9200'),
      'curl -XPOST "https://search.example:9200/logs/_bulk" -H \'Content-Type: application/json\' -d\'\n{ "index": { "_id": "1" } }\n{ "message": "one" }\n\''
    );
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
});

describe('the colours of the console', () => {
  it('tell the method, the path, comments and the body apart', () => {
    const lines = tokenizeConsole('# note\nGET logs/_search\n{\n  "size": 1\n}');
    assert.deepEqual(lines[0], [{ text: '# note', kind: 'Comment' }]);
    assert.deepEqual(lines[1], [{ text: 'GET', kind: 'Method' }, { text: ' ' }, { text: 'logs/_search', kind: 'Url' }]);
    assert.deepEqual(lines[3], [{ text: '  ' }, { text: '"size"', kind: 'Key' }, { text: ': ' }, { text: '1', kind: 'Number' }]);
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
    assert.deepEqual(query, { label: 'query', insert: '"query": {}', back: 1 });
    const size = at('GET logs/_search\n{\n  "si')?.items[0];
    assert.deepEqual(size, { label: 'size', insert: '"size": ' });
  });

  it('knows which objects a place is inside', () => {
    assert.deepEqual(keyPath('{ "query": { "bool": { "must": [ { "term": { '), {
      path: ['', 'query', 'bool', 'must', '', 'term'],
      expectsKey: true,
    });
    assert.equal(keyPath('{ "size": ').expectsKey, false);
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
  });
});

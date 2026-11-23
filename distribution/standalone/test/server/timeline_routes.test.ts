/* SPDX-License-Identifier: Apache-2.0 */

// The chain runner through the answers of the Timeline routes, with OpenSearch stubbed.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  functionList,
  runSheet,
  searchWith,
  validateOpenSearch,
  validateRunBody,
  type TimelineOptions,
} from '../../server/timeline';
import { HttpError } from '../../server/http';
import { OpenSearchError, type OpenSearchClient } from '../../server/opensearch';

type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const TIME = {
  from: '2015-01-01T00:00:00Z',
  to: '2015-01-01T00:05:00Z',
  interval: '1m',
  timezone: 'UTC',
};

function options(answer: (request: Any) => unknown, stored: Record<string, unknown> = {}) {
  const requests: Any[] = [];
  const client = {
    request: async (request: Any) => {
      requests.push(request);
      return answer(request);
    },
  } as unknown as OpenSearchClient;
  const settings: Record<string, { userValue: unknown }> = {};
  for (const [key, value] of Object.entries(stored)) settings[key] = { userValue: value };
  const result: TimelineOptions = {
    client,
    repository: { find: async () => ({ saved_objects: [] }) } as unknown as TimelineOptions['repository'],
    uiSettings: { getAll: async () => settings } as unknown as TimelineOptions['uiSettings'],
    logger: { error: () => undefined },
  };
  return { options: result, requests };
}

const noSearch = () => options(() => assert.fail('no search expected'));

async function run(sheet: string[], answer?: (request: Any) => unknown) {
  const stub = answer ? options(answer) : noSearch();
  const reply = await runSheet(validateRunBody({ sheet, time: { ...TIME } }), stub.options);
  return { reply, requests: stub.requests, body: reply.body as Any };
}

const valuesOf = (series: Any) => series.data.map((point: unknown[]) => point[1]);
// The buckets of the time span; its end is not one
const MINUTES = [0, 1, 2, 3, 4].map((m) => Date.parse(TIME.from) + m * 60000);

describe('POST /api/timeline/run', () => {
  it('answers a series list for each expression, fitted to the buckets of the time span', async () => {
    const { reply, body } = await run(['.static(10).label(ten), .static("1:5:2").add(1)']);
    assert.equal(reply.status, undefined);
    assert.equal(body.sheet.length, 1);
    const [ten, list] = body.sheet[0].list;
    assert.deepEqual(ten, {
      data: MINUTES.map((time) => [time, 10]),
      type: 'series',
      label: 'ten',
      fit: 'average',
    });
    assert.deepEqual(valuesOf(list), [2, 4, 6, 4.5, 3]);
    assert.equal(body.sheet[0].type, 'seriesList');
    assert.deepEqual(Object.keys(body.stats), [
      'invokeTime',
      'queryCount',
      'queryTime',
      'cacheCount',
      'sheetTime',
    ]);
    assert.equal(body.stats.cacheCount, 2);
  });

  it('resolves a reference to another expression', async () => {
    const { body } = await run(['.static(3), .static(4)', '.static(1).multiply(@1:2), @1']);
    assert.equal(body.sheet.length, 2);
    assert.deepEqual(valuesOf(body.sheet[1].list[0]), [4, 4, 4, 4, 4]);
    assert.deepEqual(
      body.sheet[1].list.map((series: Any) => series.label),
      ['1', '3', '4']
    );
  });

  it('sends one search for each distinct data source and gives the queryCount of the cache', async () => {
    const answer = () => ({
      _shards: { total: 1 },
      aggregations: {
        q: {
          meta: { type: 'split' },
          buckets: {
            '*': {
              time_buckets: {
                meta: { type: 'time_buckets' },
                buckets: MINUTES.map((key, i) => ({ key, count: { value: i } })),
              },
            },
          },
        },
      },
    });
    const { body, requests } = await run(['.es(), .es().add(.es())'], answer);
    assert.equal(requests.length, 1);
    // Each of the three reads the cache
    assert.equal(body.stats.queryCount, 3);
    assert.equal(body.sheet[0].list[0].label, 'q:* > count');
    assert.deepEqual(valuesOf(body.sheet[0].list[1]), [0, 2, 4, 6, 8]);

    const [request] = requests;
    assert.equal(request.method, 'POST');
    assert.equal(request.path, '/_all/_search');
    assert.deepEqual(request.query, {
      max_concurrent_shard_requests: undefined,
      ignore_unavailable: true,
      track_total_hits: true,
      timeout: '30000ms',
      ignore_throttled: true,
    });
    const histogram = request.body.aggs.q.aggs.time_buckets.date_histogram;
    assert.deepEqual(histogram, {
      field: '@timestamp',
      time_zone: 'UTC',
      extended_bounds: { min: MINUTES[0], max: Date.parse(TIME.to) },
      min_doc_count: 0,
      // A unit of minutes, hours or days is a calendar one when it counts one
      calendar_interval: '1m',
    });
  });

  it('reads the settings that are set', async () => {
    const stub = options(
      () => ({ _shards: { total: 1 }, aggregations: {} }),
      { 'timeline:es.default_index': 'logs-*', 'timeline:es.timefield': 'ts' }
    );
    await runSheet(validateRunBody({ sheet: ['.es()'], time: { ...TIME } }), stub.options);
    assert.equal(stub.requests[0].path, '/logs-*/_search');
    assert.equal(stub.requests[0].body.aggs.q.aggs.time_buckets.date_histogram.field, 'ts');
  });

  it('answers 500 with the cell of a data source that fails', async () => {
    const { reply } = await run(['.static(1)', '.es()'], () => ({ _shards: { total: 0 } }));
    assert.deepEqual(reply, {
      status: 500,
      body: {
        statusCode: 500,
        error: 'Internal Server Error',
        message: 'OpenSearch index not found: _all',
        attributes: { title: 'Expression parse error in cell #2' },
      },
    });
  });

  it('answers 500 for an unknown function', async () => {
    const { reply } = await run(['.beer()']);
    assert.equal(reply.status, 500);
    assert.equal((reply.body as Any).message, 'No such function: beer');
    assert.equal((reply.body as Any).attributes.title, 'Expression parse error in cell #1');
  });

  it('answers 500 for an expression that does not parse', async () => {
    const { reply } = await run(['foo']);
    assert.deepEqual((reply.body as Any).message, 'Expected:  at character ');
    assert.deepEqual((reply.body as Any).attributes, { title: 'Error' });

    const incomplete = await run(['.es(']);
    assert.equal(JSON.parse((incomplete.reply.body as Any).message).type, 'incompleteFunction');
    assert.equal((incomplete.reply.body as Any).attributes.title, 'SyntaxError');
  });

  it('answers 500 for a time span with too many buckets', async () => {
    const stub = noSearch();
    const time = { ...TIME, interval: '1ms' };
    const reply = await runSheet(validateRunBody({ sheet: ['.static(1)'], time }), stub.options);
    assert.equal(reply.status, 500);
    assert.match((reply.body as Any).message, /^Max buckets exceeded: 300000 of 2000 allowed/);
  });

  it('checks the body as the route schema does', () => {
    assert.throws(() => validateRunBody({ time: TIME }), (e: HttpError) => {
      assert.equal(e.status, 400);
      assert.equal(
        e.message,
        '[request body.sheet]: expected value of type [array] but got [undefined]'
      );
      return true;
    });
    assert.throws(() => validateRunBody({ sheet: [], beer: 1 }), {
      message: '[request body.beer]: definition for this key is missing',
    });
    assert.throws(() => validateRunBody({ sheet: [1] }), {
      message: '[request body.sheet.0]: expected value of type [string] but got [number]',
    });
    assert.deepEqual(validateRunBody({ sheet: [], extended: {} }), {
      sheet: [],
      extended: { es: { filter: { bool: {} } } },
    });
  });
});

describe('GET /api/timeline/functions', () => {
  it('lists every name, aliases included, sorted', () => {
    const names = functionList().map((fn) => fn.name);
    assert.deepEqual(names, [...names].sort());
    assert.equal(names.length, 48);
    for (const name of ['es', 'opensearch', 'elasticsearch', 'wbi', 'if', 'mvavg', 'plus']) {
      assert.ok(names.includes(name), name);
    }
  });

  it('gives each function with the keys of upstream, in its order', () => {
    const list = JSON.parse(JSON.stringify(functionList())) as Any[];
    const sum = list.find((fn) => fn.name === 'sum') as Any;
    assert.deepEqual(Object.keys(sum), [
      'name',
      'args',
      'argsByName',
      'help',
      'aliases',
      'extended',
      'chainable',
    ]);
    assert.deepEqual(sum.aliases, ['add', 'plus']);
    const plus = list.find((fn) => fn.name === 'plus') as Any;
    assert.equal(plus.isAlias, true);
    const es = list.find((fn) => fn.name === 'es') as Any;
    assert.equal(es.datasource, true);
    assert.deepEqual(
      es.args.map((arg: Any) => arg.name),
      [
        'q',
        'metric',
        'split',
        'index',
        'timefield',
        'kibana',
        'opensearchDashboards',
        'interval',
        'data_source_name',
        'offset',
        'fit',
      ]
    );
  });
});

describe('GET /api/timeline/validate/opensearch', () => {
  it('gives the dates of the default time field', async () => {
    const stub = options(() => ({
      aggregations: { maxAgg: { value: 2000 }, minAgg: { value: 1000 } },
    }));
    const reply = await validateOpenSearch(stub.options);
    assert.deepEqual(reply.body, { ok: true, field: '@timestamp', min: 1000, max: 2000 });
    assert.equal(stub.requests[0].path, '/_search');
    assert.deepEqual(stub.requests[0].body, {
      aggs: { maxAgg: { max: { field: '@timestamp' } }, minAgg: { min: { field: '@timestamp' } } },
      size: 0,
    });
  });

  it('answers ok: false with what OpenSearch said', async () => {
    const error = { error: { type: 'x', root_cause: [{ type: 'y', reason: 'z' }] } };
    const stub = options(() => {
      throw new OpenSearchError(400, error, 'Bad Request');
    });
    const reply = await validateOpenSearch(stub.options);
    assert.deepEqual(reply.body, {
      ok: false,
      resp: { name: 'ResponseError', meta: { body: error, statusCode: 400 } },
    });
  });
});

describe('the search of Timeline', () => {
  it('passes the error of OpenSearch on in the words of its client', async () => {
    const body = { error: { type: 'search_phase_execution_exception', root_cause: [] } };
    const client = {
      request: async () => {
        throw new OpenSearchError(400, body, 'Bad Request');
      },
    } as unknown as OpenSearchClient;
    const search = searchWith(client, { 'courier:maxConcurrentShardRequests': 5 });
    await assert.rejects(search({ params: { index: 'a', ignore_throttled: true, body: {} } }), {
      name: 'ResponseError',
      message: 'search_phase_execution_exception: ',
    });
  });
});

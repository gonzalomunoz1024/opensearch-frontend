/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { gzipSync } from 'node:zlib';
import { HttpError, Router, type Reply } from '../../server/http';
import type { OpenSearchClient, OpenSearchRequest } from '../../server/opensearch';
import type { SavedObjectsRepository } from '../../server/saved_objects';
import {
  SAMPLE_DATA_SETS,
  createIndexName,
  dataPath,
  indexNameOf,
  readFields,
  readSavedObjects,
  type SampleDataSet,
} from '../../server/sample_data/data_sets';
import { BULK_INSERT_SIZE, loadData } from '../../server/sample_data/load_data';
import {
  bulkBody,
  registerSampleData,
  sampleDataStatus,
  summaryOf,
  type StatusProbes,
} from '../../server/sample_data/routes';
import {
  dateToIso8601IgnoringTime,
  getNestedField,
  moveTimestamps,
  setNestedField,
  translateTimeRelativeToDifference,
  translateTimeRelativeToWeek,
} from '../../server/sample_data/timestamps';
import { silentLogger } from '../../server/logger';

const scratch = mkdtempSync(join(tmpdir(), 'sample-data-test-'));
let files = 0;
/** A gzipped file of these lines */
function gzipped(lines: string[], end = '\n'): string {
  files += 1;
  const file = join(scratch, `data_${files}.json.gz`);
  writeFileSync(file, gzipSync(lines.join(end)));
  return file;
}

async function failure(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error('expected a failure');
}

describe('the dates of a sample data set', () => {
  it('writes a moment as its day in the server\'s time zone', () => {
    assert.equal(dateToIso8601IgnoringTime(new Date(2018, 0, 9, 23, 59)), '2018-01-09');
    assert.equal(dateToIso8601IgnoringTime(new Date(2026, 10, 22, 0, 0)), '2026-11-22');
  });

  it('moves a date by the days between the marker and the install, keeping what follows the day', () => {
    assert.equal(
      translateTimeRelativeToDifference('2018-01-07T10:11:12', '2018-01-09T00:00:00', '2026-11-22'),
      '2026-11-20T10:11:12'
    );
    assert.equal(
      translateTimeRelativeToDifference('2018-01-10T23:59:59.123Z', '2018-01-09T00:00:00', '2026-11-22'),
      '2026-11-23T23:59:59.123Z'
    );
    assert.equal(
      translateTimeRelativeToDifference('2017-12-30T01:00:00+02:00', '2018-01-09T00:00:00', '2026-01-04'),
      '2025-12-25T01:00:00+02:00'
    );
  });

  it('keeps the day of the week when the set asks for it', () => {
    // The marker is a Tuesday, the install a Sunday: the week of the install is taken
    assert.equal(
      translateTimeRelativeToWeek('2018-01-07T10:00:00Z', '2018-01-09T00:00:00', '2026-11-22'),
      '2026-11-22T10:00:00Z'
    );
    assert.equal(
      translateTimeRelativeToWeek('2018-01-09T08:30:00', '2018-01-09T00:00:00', '2026-11-22'),
      '2026-11-24T08:30:00'
    );
    const moved = translateTimeRelativeToWeek('2018-01-03T05:00:00', '2018-01-09T00:00:00', '2026-11-26');
    assert.equal(moved, '2026-11-18T05:00:00');
    assert.equal(new Date(2018, 0, 3).getDay(), new Date(2026, 10, 18).getDay());
  });

  it('refuses a value that is no date, as the original does', () => {
    assert.throws(
      () => translateTimeRelativeToDifference('12345', '2018-01-09T00:00:00', '2026-11-22'),
      /Unexpected timestamp format, expecting YYYY-MM-DDTHH:mm:ss/
    );
  });

  it('reads and writes a field by a dotted name or by its path', () => {
    const doc: Record<string, unknown> = { 'a.b': 1, c: { d: { e: 2 } } };
    assert.equal(getNestedField(doc, 'a.b'), 1);
    assert.equal(getNestedField(doc, 'c.d.e'), 2);
    assert.equal(getNestedField(doc, 'c.x.e'), undefined);
    setNestedField(doc, 'a.b', 3);
    setNestedField(doc, 'c.d.e', 4);
    setNestedField(doc, 'f.g', 5);
    assert.deepEqual(doc, { 'a.b': 3, c: { d: { e: 4 } }, f: { g: 5 } });
  });

  it('moves every time field a document has, nested ones too', () => {
    const doc = {
      startTime: '2024-10-16T18:59:00.5Z',
      traceGroupFields: { endTime: '2024-10-15T01:02:03Z' },
      other: '2024-10-16T00:00:00',
    };
    moveTimestamps(
      doc,
      {
        timeFields: ['startTime', 'endTime', 'traceGroupFields.endTime'],
        currentTimeMarker: '2024-10-16T19:00:01',
        preserveDayOfWeekTimeOfDay: false,
      },
      '2026-11-22'
    );
    assert.deepEqual(doc, {
      startTime: '2026-11-22T18:59:00.5Z',
      traceGroupFields: { endTime: '2026-11-21T01:02:03Z' },
      other: '2024-10-16T00:00:00',
    });
  });
});

describe('the documents of a sample data set', () => {
  it('hands them over in batches, leaving out empty lines and comments', async () => {
    const lines = ['# a comment', '{"n":1}', '', '{"n":2}', '{"n":3}', '{"n":4}', '{"n":5}', '{"n":6}', '{"n":7}'];
    const batches: number[][] = [];
    const count = await loadData(
      gzipped(lines),
      async (docs) => {
        batches.push(docs.map((doc) => doc.n as number));
      },
      3
    );
    assert.equal(count, 7);
    assert.deepEqual(batches, [[1, 2, 3], [4, 5, 6], [7]]);
  });

  it('batches 500 documents at a time by default', async () => {
    const lines = Array.from({ length: 1203 }, (_, n) => JSON.stringify({ n }));
    const sizes: number[] = [];
    const count = await loadData(gzipped(lines, '\r\n'), async (docs) => {
      sizes.push(docs.length);
    });
    assert.equal(BULK_INSERT_SIZE, 500);
    assert.equal(count, 1203);
    assert.deepEqual(sizes, [500, 500, 203]);
  });

  it('waits for a batch to be in before it hands over the next', async () => {
    const lines = Array.from({ length: 10 }, (_, n) => JSON.stringify({ n }));
    let busy = false;
    let overlapped = false;
    await loadData(
      gzipped(lines),
      async () => {
        if (busy) overlapped = true;
        busy = true;
        await new Promise((resolve) => setTimeout(resolve, 5));
        busy = false;
      },
      2
    );
    assert.equal(overlapped, false);
  });

  it('stops at a line that is not JSON, with the original\'s words', async () => {
    const error = await failure(loadData(gzipped(['{"n":1}', '{nope']), async () => undefined));
    assert.match(error.message, /^Unable to parse line as JSON document, line: """\{nope""", Error: /);
  });

  it('stops at the first batch that is refused', async () => {
    let calls = 0;
    const error = await failure(
      loadData(
        gzipped(['{"n":1}', '{"n":2}', '{"n":3}']),
        async () => {
          calls += 1;
          throw new Error('refused');
        },
        1
      )
    );
    assert.equal(error.message, 'refused');
    assert.equal(calls, 1);
  });

  it('fails on a file that is not there', async () => {
    const error = await failure(loadData(join(scratch, 'missing.json.gz'), async () => undefined));
    assert.match(error.message, /ENOENT/);
  });

  it('ships every document of the original\'s sets', async () => {
    const counts: Record<string, number> = {};
    for (const set of SAMPLE_DATA_SETS) {
      for (const dataIndex of set.dataIndices) {
        counts[indexNameOf(set, dataIndex)] = await loadData(dataPath(dataIndex.dataFile), async () => undefined);
      }
    }
    assert.deepEqual(counts, {
      opensearch_dashboards_sample_data_flights: 13059,
      opensearch_dashboards_sample_data_logs: 14074,
      opensearch_dashboards_sample_data_ecommerce: 4675,
      opensearch_dashboards_sample_data_otel_spans: 8033,
      opensearch_dashboards_sample_data_otel_service_map: 49,
      'ss4o_metrics-otel-opensearch_dashboards-sample': 11033,
      opensearch_dashboards_sample_data_otel_logs: 16286,
    });
  });
});

describe('the sample data sets', () => {
  it('names an index after its set, as the original always has', () => {
    assert.equal(createIndexName('flights', 'flights'), 'opensearch_dashboards_sample_data_flights');
    assert.equal(createIndexName('otel', 'spans'), 'opensearch_dashboards_sample_data_otel_spans');
  });

  it('lists the sets in the order and shape of the original', () => {
    assert.deepEqual(
      SAMPLE_DATA_SETS.map((set) => set.id),
      ['flights', 'logs', 'ecommerce', 'otel']
    );
    // As OpenSearch Dashboards 3.9.0 answers GET /api/sample_data
    assert.equal(
      JSON.stringify(summaryOf(SAMPLE_DATA_SETS[0])),
      '{"id":"flights","name":"Sample flight data","description":"Sample data, visualizations, and dashboards for monitoring flight routes.","previewImagePath":"/plugins/home/assets/sample_data_resources/flights/dashboard.png","darkPreviewImagePath":"/plugins/home/assets/sample_data_resources/flights/dashboard_dark.png","hasNewThemeImages":true,"overviewDashboard":"7adfa750-4c81-11e8-b3d7-01146121b73d","appLinks":[],"defaultIndex":"d3d7af60-4c81-11e8-b3d7-01146121b73d","dataIndices":[{"id":"flights"}],"status":"not_installed"}'
    );
    const otel = summaryOf(SAMPLE_DATA_SETS[3]);
    assert.deepEqual(otel.dataIndices[2], {
      id: 'ss4o_metrics-otel-opensearch_dashboards-sample',
      indexName: 'ss4o_metrics-otel-opensearch_dashboards-sample',
    });
    assert.deepEqual(
      otel.appLinks.map((link) => [link.label, link.path, link.icon]),
      [
        ['View traces', 'observability-traces#/traces', 'apmTrace'],
        ['View services', 'observability-traces#/services', 'graphApp'],
      ]
    );
    assert.equal(otel.overviewDashboard, '');
    assert.equal(otel.defaultIndex, '');
  });

  it('has the default index pattern and the dashboard of each set among its saved objects', () => {
    const counts: Record<string, number> = {};
    for (const set of SAMPLE_DATA_SETS) {
      const objects = readSavedObjects(set);
      counts[set.id] = objects.length;
      const has = (type: string, id: string) => objects.some((object) => object.type === type && object.id === id);
      if (set.defaultIndex) assert.ok(has('index-pattern', set.defaultIndex), `${set.id}: default index`);
      if (set.overviewDashboard) assert.ok(has('dashboard', set.overviewDashboard), `${set.id}: dashboard`);
      // Every object a set's objects point at comes with the set
      for (const object of objects) {
        for (const reference of object.references) {
          assert.ok(has(reference.type, reference.id), `${set.id}: ${object.id} -> ${reference.type}:${reference.id}`);
        }
      }
      assert.equal(new Set(objects.map((object) => `${object.type}:${object.id}`)).size, objects.length);
    }
    assert.deepEqual(counts, { flights: 20, logs: 67, ecommerce: 14, otel: 0 });
  });

  it('maps each index with its fields', () => {
    for (const set of SAMPLE_DATA_SETS) {
      for (const dataIndex of set.dataIndices) {
        assert.ok(Object.keys(readFields(dataIndex)).length > 0, dataIndex.id);
      }
    }
    assert.deepEqual(readFields(SAMPLE_DATA_SETS[0].dataIndices[0]).timestamp, { type: 'date' });
  });
});

const twoIndices: SampleDataSet = {
  id: 'two',
  name: 'Two',
  description: '',
  previewImagePath: '',
  darkPreviewImagePath: '',
  hasNewThemeImages: false,
  overviewDashboard: 'dash',
  appLinks: [],
  defaultIndex: 'pattern',
  dataIndices: [
    {
      id: 'two',
      dataFile: '',
      fieldsFile: '',
      timeFields: [],
      currentTimeMarker: '2018-01-09T00:00:00',
      preserveDayOfWeekTimeOfDay: false,
    },
    {
      id: 'b',
      dataFile: '',
      fieldsFile: '',
      timeFields: [],
      currentTimeMarker: '2018-01-09T00:00:00',
      preserveDayOfWeekTimeOfDay: false,
    },
  ],
};

describe('whether a sample data set is installed', () => {
  const probes = (overrides: Partial<StatusProbes>, asked: string[] = []): StatusProbes => ({
    indexExists: async (index) => {
      asked.push(`exists ${index}`);
      return true;
    },
    count: async (index) => {
      asked.push(`count ${index}`);
      return 10;
    },
    getDashboard: async (id) => {
      asked.push(`dashboard ${id}`);
      return {};
    },
    ...overrides,
  });

  it('is installed when every index holds documents and the dashboard exists', async () => {
    const asked: string[] = [];
    assert.deepEqual(await sampleDataStatus(twoIndices, probes({}, asked)), { status: 'installed' });
    assert.deepEqual(asked, [
      'exists opensearch_dashboards_sample_data_two',
      'count opensearch_dashboards_sample_data_two',
      'exists opensearch_dashboards_sample_data_two_b',
      'count opensearch_dashboards_sample_data_two_b',
      'dashboard dash',
    ]);
  });

  it('is not installed at the first index that is missing or empty, or without its dashboard', async () => {
    const asked: string[] = [];
    const missing = probes({ indexExists: async (index) => (asked.push(index), false) });
    assert.deepEqual(await sampleDataStatus(twoIndices, missing), { status: 'not_installed' });
    assert.deepEqual(asked, ['opensearch_dashboards_sample_data_two']);
    const empty = probes({ count: async (index) => (index.endsWith('_b') ? 0 : 3) });
    assert.deepEqual(await sampleDataStatus(twoIndices, empty), { status: 'not_installed' });
    const noDashboard = probes({
      getDashboard: async () => {
        throw new HttpError(404, 'Saved object [dashboard/dash] not found');
      },
    });
    assert.deepEqual(await sampleDataStatus(twoIndices, noDashboard), { status: 'not_installed' });
  });

  it('is unknown, with why, when OpenSearch cannot say', async () => {
    const down = probes({
      indexExists: async () => {
        throw new Error('No Living connections');
      },
    });
    assert.deepEqual(await sampleDataStatus(twoIndices, down), {
      status: 'unknown',
      statusMsg: 'No Living connections',
    });
    const refused = probes({
      getDashboard: async () => {
        throw new HttpError(503, 'The saved objects index answered 503');
      },
    });
    assert.deepEqual(await sampleDataStatus(twoIndices, refused), {
      status: 'unknown',
      statusMsg: 'The saved objects index answered 503',
    });
  });

  it('does not look for a dashboard a set does not have', async () => {
    const asked: string[] = [];
    const otel = SAMPLE_DATA_SETS[3];
    assert.deepEqual(await sampleDataStatus(otel, probes({}, asked)), { status: 'installed' });
    assert.equal(asked.filter((line) => line.startsWith('dashboard')).length, 0);
    assert.equal(asked.length, 8);
  });
});

describe('the bulk request of a batch', () => {
  it('indexes each document into the index, under the id it brings', () => {
    const body = bulkBody('idx', [{ _id: 'x1', a: 1 }, { a: 2 }], (doc) => ({ ...doc, seen: true }));
    assert.equal(
      body,
      '{"index":{"_index":"idx","_id":"x1"}}\n{"a":1,"seen":true}\n{"index":{"_index":"idx"}}\n{"a":2,"seen":true}\n'
    );
  });
});

interface Answer {
  status: number;
  body?: unknown;
}

/** The routes over stand-ins for OpenSearch and the saved objects, which record what they are asked */
function setUp(answer: (request: OpenSearchRequest) => Answer, sets: SampleDataSet[]) {
  const asked: Array<{ method: string; path: string; body?: string }> = [];
  const client = {
    raw: async (request: OpenSearchRequest) => {
      asked.push({
        method: request.method,
        path: request.path,
        body:
          request.body === undefined
            ? undefined
            : typeof request.body === 'string'
              ? request.body
              : JSON.stringify(request.body),
      });
      const { status, body } = answer(request);
      return {
        status,
        headers: { 'content-type': 'application/json' },
        body: Buffer.from(body === undefined ? '' : JSON.stringify(body)),
      };
    },
  } as unknown as OpenSearchClient;
  const saved: string[] = [];
  const missingObjects = new Set<string>();
  const repository = {
    get: async (type: string, id: string) => {
      if (missingObjects.has(`${type}:${id}`)) throw new HttpError(404, `Saved object [${type}/${id}] not found`);
      return { id, type, attributes: {}, references: [] };
    },
    bulkCreate: async (objects: Array<{ type: string; id: string }>, options: { overwrite?: boolean }) => {
      saved.push(`create ${objects.map((object) => `${object.type}:${object.id}`).join(' ')} ${options.overwrite}`);
      return objects;
    },
    delete: async (type: string, id: string) => {
      saved.push(`delete ${type}:${id}`);
      if (missingObjects.has(`${type}:${id}`)) throw new HttpError(404, `Saved object [${type}/${id}] not found`);
    },
  } as unknown as SavedObjectsRepository;
  const router = new Router();
  registerSampleData(router, client, repository, { logger: silentLogger, sets });
  const call = async (method: string, path: string, query = ''): Promise<Reply> => {
    const { route, params } = router.match(method, path);
    assert.ok(route, `no route for ${method} ${path}`);
    try {
      return await (route as NonNullable<typeof route>).handler({
        req: {} as IncomingMessage,
        method,
        path,
        query: new URLSearchParams(query),
        params,
        body: async () => Buffer.alloc(0),
        json: async () => undefined,
      });
    } catch (error) {
      if (error instanceof HttpError) return { status: error.status, body: { message: error.message } };
      throw error;
    }
  };
  return { call, asked, saved, missingObjects };
}

function tinySet(): SampleDataSet {
  const savedObjectsFile = join(scratch, `objects_${(files += 1)}.json`);
  writeFileSync(
    savedObjectsFile,
    JSON.stringify([
      { id: 'pattern', type: 'index-pattern', attributes: { title: 'tiny' }, references: [] },
      { id: 'dash', type: 'dashboard', attributes: { title: 'Tiny' }, references: [] },
    ])
  );
  const fieldsFile = join(scratch, `fields_${files}.json`);
  writeFileSync(fieldsFile, JSON.stringify({ when: { type: 'date' } }));
  return {
    ...twoIndices,
    id: 'tiny',
    savedObjectsFile,
    dataIndices: [
      {
        id: 'tiny',
        dataFile: gzipped(['{"_id":"one","when":"2018-01-08T10:00:00"}', '{"when":"2018-01-09T11:00:00"}']),
        fieldsFile,
        timeFields: ['when'],
        currentTimeMarker: '2018-01-09T00:00:00',
        preserveDayOfWeekTimeOfDay: false,
      },
    ],
  };
}

describe('the sample data routes', () => {
  it('lists the sets with their status', async () => {
    const { call, asked } = setUp(
      (request) => (request.method === 'HEAD' ? { status: 404 } : { status: 200, body: { count: 1 } }),
      [twoIndices]
    );
    const reply = await call('GET', '/api/sample_data');
    assert.deepEqual(reply.body, [{ ...summaryOf(twoIndices), status: 'not_installed' }]);
    assert.deepEqual(asked, [{ method: 'HEAD', path: '/opensearch_dashboards_sample_data_two', body: undefined }]);
  });

  it('installs a set: a new index, its documents moved to the day, then its saved objects', async () => {
    const set = tinySet();
    const { call, asked, saved } = setUp(
      (request) =>
        request.method === 'DELETE'
          ? { status: 404, body: { error: { root_cause: [{ type: 'index_not_found_exception', reason: 'no such index' }] } } }
          : { status: 200, body: request.path.startsWith('/_bulk') ? { errors: false } : { acknowledged: true } },
      [set]
    );
    const reply = await call('POST', '/api/sample_data/tiny', 'now=2026-11-22T12:00:00');
    assert.deepEqual(reply.body, {
      opensearchIndicesCreated: { opensearch_dashboards_sample_data_tiny: 2 },
      opensearchDashboardsSavedObjectsLoaded: 2,
    });
    assert.deepEqual(
      asked.map((request) => `${request.method} ${request.path}`),
      [
        'DELETE /opensearch_dashboards_sample_data_tiny',
        'PUT /opensearch_dashboards_sample_data_tiny',
        'POST /_bulk?filter_path=errors,items.*.error',
      ]
    );
    assert.deepEqual(JSON.parse(asked[1].body ?? ''), {
      settings: { index: { number_of_shards: 1, auto_expand_replicas: '0-1' } },
      mappings: { properties: { when: { type: 'date' } } },
    });
    assert.equal(
      asked[2].body,
      '{"index":{"_index":"opensearch_dashboards_sample_data_tiny","_id":"one"}}\n{"when":"2026-11-21T10:00:00"}\n' +
        '{"index":{"_index":"opensearch_dashboards_sample_data_tiny"}}\n{"when":"2026-11-22T11:00:00"}\n'
    );
    assert.deepEqual(saved, ['create index-pattern:pattern dashboard:dash true']);
  });

  it('says why an index cannot be made, with the status OpenSearch gave', async () => {
    const exists = {
      error: {
        root_cause: [{ type: 'resource_already_exists_exception', reason: 'index [x] already exists', index: 'x' }],
      },
      status: 400,
    };
    const { call, saved } = setUp(
      (request) => (request.method === 'PUT' ? { status: 400, body: exists } : { status: 200, body: {} }),
      [tinySet()]
    );
    assert.deepEqual(await call('POST', '/api/sample_data/tiny'), {
      status: 400,
      body: {
        message:
          'Unable to create sample data index "opensearch_dashboards_sample_data_tiny", error: [resource_already_exists_exception] index [x] already exists, with { index="x" }',
      },
    });
    assert.deepEqual(saved, []);
  });

  it('fails with the original\'s words when OpenSearch refuses documents', async () => {
    const { call, saved } = setUp(
      (request) => ({ status: 200, body: request.path.startsWith('/_bulk') ? { errors: true, items: [] } : {} }),
      [tinySet()]
    );
    assert.deepEqual(await call('POST', '/api/sample_data/tiny'), {
      status: 500,
      body: {
        message:
          'sample_data install errors while loading data. Error: Error: Unable to load sample data into index "opensearch_dashboards_sample_data_tiny", see OpenSearch Dashboards logs for details',
      },
    });
    assert.deepEqual(saved, []);
  });

  it('removes the saved objects, then the indices, past objects already deleted', async () => {
    const set = tinySet();
    const { call, asked, saved, missingObjects } = setUp(() => ({ status: 200, body: { acknowledged: true } }), [set]);
    missingObjects.add('dashboard:dash');
    assert.deepEqual(await call('DELETE', '/api/sample_data/tiny'), { status: 204 });
    assert.deepEqual(saved, ['delete index-pattern:pattern', 'delete dashboard:dash']);
    assert.deepEqual(
      asked.map((request) => `${request.method} ${request.path}`),
      ['DELETE /opensearch_dashboards_sample_data_tiny']
    );
  });

  it('says why an index cannot be removed', async () => {
    const missing = {
      error: {
        root_cause: [
          {
            type: 'index_not_found_exception',
            reason: 'no such index [opensearch_dashboards_sample_data_tiny]',
            index: 'opensearch_dashboards_sample_data_tiny',
            'resource.id': 'opensearch_dashboards_sample_data_tiny',
            'resource.type': 'index_or_alias',
            index_uuid: '_na_',
          },
        ],
      },
      status: 404,
    };
    const { call } = setUp(() => ({ status: 404, body: missing }), [tinySet()]);
    assert.deepEqual(await call('DELETE', '/api/sample_data/tiny'), {
      status: 404,
      body: {
        message:
          'Unable to delete sample data index "opensearch_dashboards_sample_data_tiny", error: [index_not_found_exception] no such index [opensearch_dashboards_sample_data_tiny], with { index="opensearch_dashboards_sample_data_tiny" & resource.id="opensearch_dashboards_sample_data_tiny" & resource.type="index_or_alias" & index_uuid="_na_" }',
      },
    });
  });

  it('refuses what the original refuses', async () => {
    const { call, asked } = setUp(() => ({ status: 200, body: {} }), [tinySet()]);
    assert.deepEqual(await call('POST', '/api/sample_data/nope'), { status: 404, body: { message: 'Not Found' } });
    assert.deepEqual(await call('DELETE', '/api/sample_data/nope'), { status: 404, body: { message: 'Not Found' } });
    assert.deepEqual(await call('GET', '/api/sample_data', 'foo=1'), {
      status: 400,
      body: { message: '[request query.foo]: definition for this key is missing' },
    });
    assert.deepEqual(await call('DELETE', '/api/sample_data/tiny', 'now=1'), {
      status: 400,
      body: { message: '[request query.now]: definition for this key is missing' },
    });
    assert.deepEqual(await call('POST', '/api/sample_data/tiny', 'now=a&now=b'), {
      status: 400,
      body: { message: '[request query.now]: expected value of type [string] but got [Array]' },
    });
    assert.equal(asked.length, 0);
  });

  it('refuses a moment that is no date and a data source, before it changes anything', async () => {
    const { call, asked } = setUp(() => ({ status: 200, body: {} }), [tinySet()]);
    assert.deepEqual(await call('POST', '/api/sample_data/tiny', 'now=garbage'), {
      status: 400,
      body: { message: '[request query.now]: expected a date but got [garbage]' },
    });
    assert.deepEqual(await call('GET', '/api/sample_data', 'data_source_id=abc'), {
      status: 400,
      body: { message: '[request query.data_source_id]: data sources are not enabled' },
    });
    assert.equal(asked.length, 0);
  });
});

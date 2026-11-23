/* SPDX-License-Identifier: Apache-2.0 */

/*
 * What the saved objects page asks the server for, and the parts of the repository and of the
 * export that search: the search is the fake index's, which answers the documents a test names,
 * so each test also checks what was asked of OpenSearch. The answers of the relationships and of
 * the page's find are those OpenSearch Dashboards 3.9.0 (the fork's build) gave for these objects.
 */

import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import { describe, it } from 'node:test';
import { HttpError, Router } from '../../server/http';
import { exportObjects } from '../../server/import_export';
import { SavedObjectsRepository } from '../../server/saved_objects';
import { registerSavedObjectsManagement } from '../../server/saved_objects_management';
import { FakeSavedObjectsIndex } from './saved_objects_fake_index';

const ROOT = '/api/opensearch-dashboards/management/saved_objects';
const P = 'zz-ip';
const V = 'zz-vis';
const D = 'zz-dash';

type Json = Record<string, unknown>;

async function setup() {
  const index = new FakeSavedObjectsIndex();
  const repository = new SavedObjectsRepository(index.client, '.kibana');
  const router = new Router();
  registerSavedObjectsManagement(router, repository);
  await repository.bulkCreate([
    { type: 'index-pattern', id: P, attributes: { title: 'zz-b*', timeFieldName: '@timestamp', fields: '[]' }, references: [] },
    {
      type: 'visualization',
      id: V,
      attributes: { title: 'zz vis', visState: '{"title":"zz vis","type":"markdown","params":{},"aggs":[]}', uiStateJSON: '{}', description: '', version: 1, kibanaSavedObjectMeta: { searchSourceJSON: '{}' } },
      references: [{ name: 'kibanaSavedObjectMeta.searchSourceJSON.index', type: 'index-pattern', id: P }],
    },
    {
      type: 'dashboard',
      id: D,
      attributes: { title: 'zz dash', hits: 0, description: '', panelsJSON: '[]', optionsJSON: '{}', version: 1, timeRestore: false, kibanaSavedObjectMeta: { searchSourceJSON: '{}' } },
      references: [{ name: 'panel_0', type: 'visualization', id: V }],
    },
  ]);
  /** The search answers these documents, whatever it is asked, and keeps what it was asked */
  const searches: Array<{ body: Json; query: Json }> = [];
  const answerWith = (ids: string[], extra: (id: string) => Json = () => ({}), total = ids.length) => {
    index.search = (body, query) => {
      searches.push({ body, query: (query ?? {}) as Json });
      return {
        total,
        hits: ids.map((id) => {
          const stored = index.docs.get(id);
          assert.ok(stored, `${id} is stored`);
          return { _index: '.kibana_1', _id: id, _score: null, _seq_no: stored.seqNo, _primary_term: stored.primaryTerm, _source: stored.source, ...extra(id) };
        }),
      };
    };
  };
  const call = async (method: string, address: string, body?: unknown) => {
    const url = new URL(address, 'http://localhost');
    const { route, params } = router.match(method, url.pathname);
    assert.ok(route, `${method} ${url.pathname} is a route`);
    const reply = await route.handler({
      req: { headers: { 'content-type': 'application/json' } } as unknown as IncomingMessage,
      method,
      path: url.pathname,
      query: url.searchParams,
      params,
      body: async () => Buffer.from(body === undefined ? '' : JSON.stringify(body)),
      json: async <T>() => body as T | undefined,
    });
    return reply.body;
  };
  const refusal = async (run: () => Promise<unknown>) => {
    try {
      await run();
    } catch (error) {
      return error instanceof HttpError ? `${error.status} ${error.message}` : String(error);
    }
    return 'answered';
  };
  return { index, repository, searches, answerWith, call, refusal };
}

const DASHBOARD_META = {
  icon: 'dashboardApp',
  title: 'zz dash',
  editUrl: `/management/opensearch-dashboards/objects/savedDashboards/${D}`,
  inAppUrl: { path: `/app/dashboards#/view/${D}`, uiCapabilitiesPath: 'dashboard.show' },
  namespaceType: 'single',
};
const PATTERN_META = {
  icon: 'indexPatternApp',
  title: 'zz-b*',
  editUrl: `/management/opensearch-dashboards/indexPatterns/patterns/${P}`,
  inAppUrl: { path: `/app/management/opensearch-dashboards/indexPatterns/patterns/${P}`, uiCapabilitiesPath: 'management.opensearchDashboards.indexPatterns' },
  namespaceType: 'single',
};

describe("the saved objects page's routes", () => {
  it('lists what an object refers to as children and what refers to it as parents', async () => {
    const { call, answerWith, searches } = await setup();
    answerWith([`dashboard:${D}`]);
    const answer = await call('GET', `${ROOT}/relationships/visualization/${V}?savedObjectTypes=dashboard&savedObjectTypes=index-pattern`);
    assert.equal(
      JSON.stringify(answer),
      JSON.stringify([
        { id: P, type: 'index-pattern', meta: PATTERN_META, relationship: 'child' },
        { id: D, type: 'dashboard', meta: DASHBOARD_META, relationship: 'parent' },
      ])
    );
    // The parents are searched for by the reference, among the types asked for, 10000 at most
    assert.equal(searches.length, 1);
    assert.equal(searches[0].query.size, 10000);
    const asked = JSON.stringify(searches[0].body);
    assert.ok(asked.includes(`"references.id":"${V}"`) && asked.includes('"references.type":"visualization"'), asked);
    assert.ok(asked.includes('"type":"dashboard"') && asked.includes('"type":"index-pattern"') && !asked.includes('"type":"search"'), asked);
  });

  it('answers the find of the list with what the list shows of each object, and only the fields asked for', async () => {
    const { call, answerWith, searches } = await setup();
    answerWith([`dashboard:${D}`], () => ({ sort: ['dashboard'] }));
    const answer = (await call('GET', `${ROOT}/_find?type=visualization&type=dashboard&sortField=type&fields=id&page=1&perPage=5`)) as {
      saved_objects: Array<Json>;
    };
    const [found] = answer.saved_objects;
    assert.equal(
      JSON.stringify({ ...answer, saved_objects: [{ ...found, updated_at: '<time>', version: '<version>' }] }),
      JSON.stringify({
        page: 1,
        per_page: 5,
        total: 1,
        saved_objects: [
          {
            type: 'dashboard',
            id: D,
            attributes: {},
            references: [{ name: 'panel_0', type: 'visualization', id: V }],
            migrationVersion: { dashboard: '7.9.3' },
            updated_at: '<time>',
            version: '<version>',
            namespaces: ['default'],
            score: null,
            sort: ['dashboard'],
            meta: DASHBOARD_META,
          },
        ],
      })
    );
    assert.deepEqual([searches[0].query.size, searches[0].query.from], [5, 0]);
    assert.deepEqual(searches[0].body.sort, [{ type: { unmapped_type: 'keyword' } }]);
  });

  it('searches the titles of the types asked for, each by the field its type names', async () => {
    const { call, answerWith, searches } = await setup();
    answerWith([]);
    await call('GET', `${ROOT}/_find?type=visualization&type=index-pattern&search=zz*`);
    const asked = JSON.stringify(searches[0].body);
    assert.ok(asked.includes('"query":"zz*"'), asked);
    assert.ok(asked.includes('"visualization.title"') && asked.includes('"index-pattern.title"') && !asked.includes('"dashboard.title"'), asked);
  });

  it('counts the objects of each type asked for, none as 0, searching titles that start with the text', async () => {
    const { call, answerWith, searches } = await setup();
    answerWith([`dashboard:${D}`, `visualization:${V}`, `index-pattern:${P}`]);
    assert.deepEqual(await call('POST', `${ROOT}/scroll/counts`, { typesToInclude: ['visualization', 'dashboard', 'search', 'index-pattern'] }), {
      type: { dashboard: 1, visualization: 1, 'index-pattern': 1, search: 0 },
    });
    assert.ok(!JSON.stringify(searches[0].body).includes('simple_query_string'));
    answerWith([`visualization:${V}`]);
    assert.deepEqual(await call('POST', `${ROOT}/scroll/counts`, { typesToInclude: ['visualization', 'dashboard'], searchString: 'zz' }), {
      type: { visualization: 1, dashboard: 0 },
    });
    const asked = JSON.stringify(searches[1].body);
    assert.ok(asked.includes('"query":"zz*"') && asked.includes('"visualization.title"'), asked);
  });

  it('reads every page of what it counts', async () => {
    const { call, index } = await setup();
    // More than a page of a thousand: the fake index answers them page by page, as OpenSearch does
    for (let at = 0; at < 1001; at += 1) {
      index.put(`visualization:many-${at}`, { visualization: { title: `many ${at}` }, type: 'visualization', references: [] });
    }
    const before = index.sent.length;
    assert.deepEqual(await call('POST', `${ROOT}/scroll/counts`, { typesToInclude: ['visualization', 'dashboard', 'index-pattern'] }), {
      type: { 'index-pattern': 1, visualization: 1002, dashboard: 1 },
    });
    assert.deepEqual(
      index.sent.slice(before).map((request) => [request.query?.size, request.query?.from]),
      [
        [1000, 0],
        [1000, 1000],
      ]
    );
  });

  it('gives the objects of the legacy export as the documents they are', async () => {
    const { call, answerWith } = await setup();
    answerWith([`index-pattern:${P}`, `dashboard:${D}`]);
    assert.equal(
      JSON.stringify(await call('POST', `${ROOT}/scroll/export`, { typesToInclude: ['index-pattern', 'dashboard'] })),
      JSON.stringify([
        {
          _id: P,
          _type: 'index-pattern',
          _source: { title: 'zz-b*', timeFieldName: '@timestamp', fields: '[]' },
          _meta: { savedObjectVersion: 2 },
          _migrationVersion: { 'index-pattern': '7.6.0' },
          _references: [],
        },
        {
          _id: D,
          _type: 'dashboard',
          _source: { title: 'zz dash', hits: 0, description: '', panelsJSON: '[]', optionsJSON: '{}', version: 1, timeRestore: false, kibanaSavedObjectMeta: { searchSourceJSON: '{}' } },
          _meta: { savedObjectVersion: 2 },
          _migrationVersion: { dashboard: '7.9.3' },
          _references: [{ name: 'panel_0', type: 'visualization', id: V }],
        },
      ])
    );
  });

  it('names the types the page may show, and refuses what its routes cannot read', async () => {
    const { call, refusal } = await setup();
    const { types } = (await call('GET', `${ROOT}/_allowed_types`)) as { types: string[] };
    for (const type of ['config', 'url', 'index-pattern', 'query', 'dashboard', 'visualization', 'search']) assert.ok(types.includes(type), type);
    assert.ok(!types.includes('foo'));
    assert.equal(await refusal(() => call('POST', `${ROOT}/scroll/counts`, {})), '400 [request body.typesToInclude]: expected value of type [array] but got [undefined]');
    assert.equal(await refusal(() => call('GET', `${ROOT}/_find`)), '400 [request query.type]: expected at least one defined value but got [undefined]');
    assert.equal(await refusal(() => call('GET', `${ROOT}/relationships/visualization/gone?savedObjectTypes=dashboard`)), '404 Saved object [visualization/gone] not found');
  });
});

describe('the searches of the repository and of the export', () => {
  it('answers a find with its page, the total and each object with its score and sort values', async () => {
    const { repository, answerWith, searches } = await setup();
    answerWith([`visualization:${V}`], () => ({ _score: 1.5, sort: ['zz vis'] }), 12);
    const found = await repository.find({ type: ['visualization', 'foo'], page: 1, perPage: 4, fields: ['title'] });
    assert.deepEqual([found.page, found.per_page, found.total, found.saved_objects.length], [1, 4, 12, 1]);
    assert.deepEqual([found.saved_objects[0].id, found.saved_objects[0].type, found.saved_objects[0].score, found.saved_objects[0].sort], [V, 'visualization', 1.5, ['zz vis']]);
    assert.deepEqual([searches[0].query.size, searches[0].query.from, searches[0].query.rest_total_hits_as_int], [4, 0, true]);
    // Only the fields asked for are read, and what every object needs beside them
    const source = String(searches[0].query._source).split(',');
    assert.ok(source.includes('visualization.title') && source.includes('type') && source.includes('references') && !source.includes('visualization.visState'), source.join());
  });

  it('finds nothing, without asking, among types that are none, and nothing where there is no index', async () => {
    const { repository, index, searches, answerWith, refusal } = await setup();
    answerWith([]);
    assert.deepEqual(await repository.find({ type: 'foo', perPage: 7 }), { page: 1, per_page: 7, total: 0, saved_objects: [] });
    assert.equal(searches.length, 0);
    assert.equal(await refusal(() => repository.find({ type: 'dashboard', namespaces: [] })), '400 options.namespaces cannot be an empty array: Bad Request');
    index.dropIndex();
    assert.equal(await repository.ensureIndex(), 'created');
    assert.equal(await repository.ensureIndex(), 'exists');
  });

  it('says which of the objects asked about are there already, and which are of no type', async () => {
    const { repository } = await setup();
    assert.deepEqual(
      await repository.checkConflicts([
        { type: 'visualization', id: V },
        { type: 'visualization', id: 'new' },
        { type: 'foo', id: 'x' },
        { type: 'dashboard', id: D },
      ]),
      [
        { id: V, type: 'visualization', error: { statusCode: 409, error: 'Conflict', message: `Saved object [visualization/${V}] conflict` } },
        { id: 'x', type: 'foo', error: { statusCode: 400, error: 'Bad Request', message: "Unsupported saved object type: 'foo': Bad Request" } },
        { id: D, type: 'dashboard', error: { statusCode: 409, error: 'Conflict', message: `Saved object [dashboard/${D}] conflict` } },
      ]
    );
    assert.deepEqual(await repository.checkConflicts([]), []);
  });

  it('exports the objects of a type by id, what they refer to before them, and refuses more than the limit', async () => {
    const { repository, answerWith, searches, refusal } = await setup();
    answerWith([`visualization:${V}`, `dashboard:${D}`, `index-pattern:${P}`]);
    const file = await exportObjects(repository, { types: ['dashboard', 'visualization', 'index-pattern'], search: 'zz*' }, 3);
    const lines = file.split('\n').map((line) => JSON.parse(line) as Json);
    // By id: zz-dash, zz-ip, zz-vis; then each after what it refers to
    assert.deepEqual(
      lines.map((line) => line.id ?? line.exportedCount),
      [P, V, D, 3]
    );
    assert.deepEqual(lines[3], { exportedCount: 3, missingRefCount: 0, missingReferences: [] });
    assert.ok(!('score' in lines[0]) && !('namespaces' in lines[0]));
    assert.equal(searches[0].query.size, 3);
    assert.ok(JSON.stringify(searches[0].body).includes('"query":"zz*"'));
    assert.equal(await refusal(() => exportObjects(repository, { types: ['dashboard', 'visualization', 'index-pattern'] }, 2)), "400 Can't export more than 2 objects");
    assert.equal(await refusal(() => exportObjects(repository, {}, 2)), '400 Either `type` or `objects` are required.');
  });
});

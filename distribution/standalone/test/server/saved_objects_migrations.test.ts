/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { HttpError } from '../../server/http';
import { silentLogger, type Logger } from '../../server/logger';
import {
  createDocumentMigrator,
  LATEST_MIGRATION_VERSIONS,
  migrateDocument,
  migratePanelsTo730,
  moveFiltersToQuery,
  TYPE_MIGRATIONS,
  versionGreaterThan,
  type MigrationContext,
  type MigrationDocument,
  type MigrationStep,
} from '../../server/saved_objects_migrations';

type Bag = Record<string, unknown>;

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/g;
const textOf = (value: unknown) => JSON.stringify(value).replace(UUID, '<uuid>');

function logs() {
  const warnings: string[] = [];
  const infos: string[] = [];
  const log: MigrationContext['log'] = {
    info: (message) => infos.push(message),
    debug: () => {},
    warn: (message) => warnings.push(message),
    warning: (message) => warnings.push(message),
    error: () => {},
  };
  const logger: Logger = { ...silentLogger, info: (message) => infos.push(message), warn: (message) => warnings.push(message) };
  return { warnings, infos, log, logger };
}

/**
 * Every call the original's own migration tests make (the `*.test.ts` files beside its
 * migrations: visualizations, dashboards and their panels, saved searches, index patterns and
 * advanced settings), with what the original's code answers for it: the object as JSON, its
 * random panel ids written `<uuid>`, or the error, and how many warnings it logs. They were
 * recorded by running those test files against the compiled migrations of OpenSearch Dashboards
 * 3.9.0, each call made on the JSON kept here and with a context that logs.
 */
interface OriginalCase {
  file: string;
  test: string;
  type?: string;
  version?: string;
  fn?: 'migratePanelsTo730' | 'moveFiltersToQuery';
  args: unknown[];
  output?: string;
  error?: string;
  warnings: number;
}

const ORIGINAL_CASES = JSON.parse(
  readFileSync(join(__dirname, 'saved_objects_migrations_cases.json'), 'utf8')
) as OriginalCase[];

function replay(entry: OriginalCase, log: MigrationContext['log']): unknown {
  const args = structuredClone(entry.args);
  if (entry.fn === 'migratePanelsTo730') return migratePanelsTo730(args[0], String(args[1]), args[2], args[3]);
  if (entry.fn === 'moveFiltersToQuery') return moveFiltersToQuery(args[0]);
  const step = TYPE_MIGRATIONS[entry.type ?? '']?.[entry.version ?? ''];
  if (!step) throw new Error(`No migration ${entry.type} ${entry.version}`);
  return step(args[0] as Bag, { log });
}

describe("the original's own migration test cases", () => {
  it('are all here', () => {
    assert.equal(ORIGINAL_CASES.length, 103);
    const steps = new Set(ORIGINAL_CASES.map((entry) => entry.fn ?? `${entry.type} ${entry.version}`));
    // Each version that has a test in the original: 7.0.1 of visualizations, 7.9.3 of dashboards
    // and those of the TSVB telemetry have none there
    assert.equal(steps.size, 22);
  });
  ORIGINAL_CASES.forEach((entry, index) => {
    const what = entry.fn ?? `${entry.type} ${entry.version}`;
    it(`${index}: ${what}: ${entry.test}`, () => {
      const { warnings, log } = logs();
      if (entry.error !== undefined) {
        assert.throws(() => replay(entry, log), { message: entry.error });
      } else {
        assert.equal(textOf(replay(entry, log)), entry.output);
      }
      assert.equal(warnings.length, entry.warnings);
    });
  });
});

// --- the migrator, on the cases of the original's document_migrator.test.ts --------------------

function getPath(doc: Bag, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => (value === null || value === undefined ? undefined : (value as Bag)[key]), doc);
}

function setPath(doc: Bag, path: string, value: unknown): Bag {
  const keys = path.split('.');
  const last = keys.pop() ?? path;
  let target = doc;
  for (const key of keys) {
    if (typeof target[key] !== 'object' || target[key] === null) target[key] = {};
    target = target[key] as Bag;
  }
  target[last] = value;
  return doc;
}

const setAttr =
  (path: string, value: unknown): MigrationStep =>
  (doc) =>
    setPath(doc, path, typeof value === 'function' ? (value as (old: unknown) => unknown)(getPath(doc, path)) : value);

const renameAttr =
  (path: string, newPath: string): MigrationStep =>
  (doc) => {
    const renamed: Bag = { ...setPath(doc, newPath, getPath(doc, path)) };
    delete renamed[path];
    return renamed;
  };

const migrate = (types: Record<string, Record<string, MigrationStep>>, doc: MigrationDocument, logger?: Logger) =>
  createDocumentMigrator(types).migrate(doc, logger);

describe('createDocumentMigrator', () => {
  it('migrates type and attributes', () => {
    const actual = migrate(
      { user: { '1.2.3': setAttr('attributes.name', 'Chris') } },
      { id: 'me', type: 'user', attributes: { name: 'Christopher' }, migrationVersion: {} }
    );
    assert.deepEqual(actual, { id: 'me', type: 'user', attributes: { name: 'Chris' }, migrationVersion: { user: '1.2.3' } });
  });

  it("doesn't mutate the original document", () => {
    const originalDoc = { id: 'me', type: 'user', attributes: {}, migrationVersion: {} };
    const migrated = migrate({ user: { '1.2.3': setAttr('attributes.name', 'Mike') } }, originalDoc);
    assert.equal(getPath(originalDoc, 'attributes.name'), undefined);
    assert.equal(getPath(migrated, 'attributes.name'), 'Mike');
  });

  it('migrates root properties', () => {
    const actual = migrate(
      { acl: { '2.3.5': setAttr('acl', 'admins-only, sucka!') } },
      { id: 'me', type: 'user', attributes: { name: 'Tyler' }, acl: 'anyone', migrationVersion: {} }
    );
    assert.deepEqual(actual, {
      id: 'me',
      type: 'user',
      attributes: { name: 'Tyler' },
      migrationVersion: { acl: '2.3.5' },
      acl: 'admins-only, sucka!',
    });
  });

  it('does not apply migrations to unrelated docs', () => {
    const actual = migrate(
      { aaa: { '1.0.0': setAttr('aaa', 'A') }, bbb: { '1.0.0': setAttr('bbb', 'B') }, ccc: { '1.0.0': setAttr('ccc', 'C') } },
      { id: 'me', type: 'user', attributes: { name: 'Tyler' }, migrationVersion: {} }
    );
    assert.deepEqual(actual, { id: 'me', type: 'user', attributes: { name: 'Tyler' } });
  });

  it('assumes documents w/ undefined migrationVersion are up to date', () => {
    const actual = migrate(
      { user: { '1.0.0': setAttr('aaa', 'A') }, bbb: { '2.3.4': setAttr('bbb', 'B') }, ccc: { '1.0.0': setAttr('ccc', 'C') } },
      { id: 'me', type: 'user', attributes: { name: 'Tyler' }, bbb: 'Shazm' }
    );
    assert.deepEqual(actual, {
      id: 'me',
      type: 'user',
      attributes: { name: 'Tyler' },
      bbb: 'Shazm',
      migrationVersion: { user: '1.0.0', bbb: '2.3.4' },
    });
    // In the order of the object's keys, then its type
    assert.equal(JSON.stringify(actual.migrationVersion), '{"bbb":"2.3.4","user":"1.0.0"}');
  });

  it('only applies migrations that are more recent than the doc', () => {
    const actual = migrate(
      {
        dog: {
          '1.2.3': setAttr('attributes.a', 'A'),
          '1.2.4': setAttr('attributes.b', 'B'),
          '2.0.1': setAttr('attributes.c', 'C'),
        },
      },
      { id: 'smelly', type: 'dog', attributes: { name: 'Callie' }, migrationVersion: { dog: '1.2.3' } }
    );
    assert.deepEqual(actual, {
      id: 'smelly',
      type: 'dog',
      attributes: { name: 'Callie', b: 'B', c: 'C' },
      migrationVersion: { dog: '2.0.1' },
    });
  });

  it('rejects docs that belong to a newer OpenSearch Dashboards instance', () => {
    assert.throws(
      () => migrate({}, { id: 'smelly', type: 'dog', attributes: { name: 'Callie' }, migrationVersion: { dog: '10.2.0' } }),
      (error: unknown) =>
        error instanceof HttpError &&
        error.status === 422 &&
        error.message ===
          'Document "smelly" has property "dog" which belongs to a more recent version of OpenSearch Dashboards [10.2.0]. The last known version is [undefined]'
    );
  });

  it('rejects docs that belong to a newer plugin', () => {
    assert.throws(
      () =>
        migrate(
          { dawg: { '1.2.3': setAttr('attributes.a', 'A') } },
          { id: 'fleabag', type: 'dawg', attributes: { name: 'Callie' }, migrationVersion: { dawg: '1.2.4' } }
        ),
      {
        status: 422,
        message:
          'Document "fleabag" has property "dawg" which belongs to a more recent version of OpenSearch Dashboards [1.2.4]. The last known version is [1.2.3]',
      }
    );
  });

  it('applies migrations in order', () => {
    let count = 0;
    const actual = migrate(
      {
        dog: {
          '2.2.4': setAttr('attributes.b', () => ++count),
          '10.0.1': setAttr('attributes.c', () => ++count),
          '1.2.3': setAttr('attributes.a', () => ++count),
        },
      },
      { id: 'smelly', type: 'dog', attributes: { name: 'Callie' }, migrationVersion: { dog: '1.2.0' } }
    );
    assert.deepEqual(actual, {
      id: 'smelly',
      type: 'dog',
      attributes: { name: 'Callie', a: 1, b: 2, c: 3 },
      migrationVersion: { dog: '10.0.1' },
    });
  });

  it('allows props to be added', () => {
    const actual = migrate(
      {
        animal: { '1.0.0': setAttr('animal', (name: string) => `Animal: ${name}`) },
        dog: { '2.2.4': setAttr('animal', 'Doggie') },
      },
      { id: 'smelly', type: 'dog', attributes: { name: 'Callie' }, migrationVersion: { dog: '1.2.0' } }
    );
    assert.deepEqual(actual, {
      id: 'smelly',
      type: 'dog',
      attributes: { name: 'Callie' },
      animal: 'Animal: Doggie',
      migrationVersion: { animal: '1.0.0', dog: '2.2.4' },
    });
  });

  it('allows props to be renamed', () => {
    const actual = migrate(
      {
        animal: {
          '1.0.0': setAttr('animal', (name: string) => `Animal: ${name}`),
          '3.2.1': renameAttr('animal', 'dawg'),
        },
        dawg: {
          '2.2.4': renameAttr('dawg', 'animal'),
          '3.2.0': setAttr('dawg', (name: string) => `Dawg3.x: ${name}`),
        },
      },
      { id: 'smelly', type: 'foo', attributes: { name: 'Callie' }, dawg: 'Yo', migrationVersion: {} }
    );
    assert.deepEqual(actual, {
      id: 'smelly',
      type: 'foo',
      attributes: { name: 'Callie' },
      dawg: 'Dawg3.x: Animal: Yo',
      migrationVersion: { animal: '3.2.1', dawg: '3.2.0' },
    });
  });

  it('allows changing type', () => {
    const actual = migrate(
      {
        cat: { '1.0.0': setAttr('attributes.name', (name: string) => `Kitty ${name}`) },
        dog: { '2.2.4': setAttr('type', 'cat') },
      },
      { id: 'smelly', type: 'dog', attributes: { name: 'Callie' }, migrationVersion: {} }
    );
    assert.deepEqual(actual, {
      id: 'smelly',
      type: 'cat',
      attributes: { name: 'Kitty Callie' },
      migrationVersion: { dog: '2.2.4', cat: '1.0.0' },
    });
  });

  it('disallows updating a migrationVersion prop to a lower version', () => {
    assert.throws(
      () =>
        migrate(
          { cat: { '1.0.0': setAttr('migrationVersion.foo', '3.2.1') } },
          { id: 'smelly', type: 'cat', attributes: { name: 'Boo' }, migrationVersion: { foo: '4.5.6' } }
        ),
      { message: 'Migration "cat v 1.0.0" attempted to downgrade "migrationVersion.foo" from 4.5.6 to 3.2.1.' }
    );
  });

  it('disallows removing a migrationVersion prop', () => {
    assert.throws(
      () =>
        migrate(
          { cat: { '1.0.0': setAttr('migrationVersion', {}) } },
          { id: 'smelly', type: 'cat', attributes: { name: 'Boo' }, migrationVersion: { foo: '4.5.6' } }
        ),
      { message: 'Migration "cat v 1.0.0" attempted to downgrade "migrationVersion.foo" from 4.5.6 to undefined.' }
    );
  });

  it('allows updating a migrationVersion prop to a later version', () => {
    const fail = (message: string) => () => {
      throw new Error(message);
    };
    const actual = migrate(
      {
        cat: {
          '1.0.0': setAttr('migrationVersion.cat', '2.9.1'),
          '2.0.0': fail('POW!'),
          '2.9.1': fail('BANG!'),
          '3.0.0': setAttr('attributes.name', 'Shiny'),
        },
      },
      { id: 'smelly', type: 'cat', attributes: { name: 'Boo' }, migrationVersion: { cat: '0.5.6' } }
    );
    assert.deepEqual(actual, { id: 'smelly', type: 'cat', attributes: { name: 'Shiny' }, migrationVersion: { cat: '3.0.0' } });
  });

  it('allows adding props to migrationVersion', () => {
    const actual = migrate(
      { cat: { '1.0.0': setAttr('migrationVersion.foo', '5.6.7') } },
      { id: 'smelly', type: 'cat', attributes: { name: 'Boo' }, migrationVersion: {} }
    );
    assert.deepEqual(actual, {
      id: 'smelly',
      type: 'cat',
      attributes: { name: 'Boo' },
      migrationVersion: { cat: '1.0.0', foo: '5.6.7' },
    });
  });

  it('logs the document and transform that failed', () => {
    const { warnings, logger } = logs();
    const failedDoc = { id: 'smelly', type: 'dog', attributes: {}, migrationVersion: {} };
    assert.throws(
      () =>
        migrate(
          {
            dog: {
              '1.2.3': () => {
                throw new Error('Dang diggity!');
              },
            },
          },
          structuredClone(failedDoc),
          logger
        ),
      /Dang diggity!/
    );
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0].includes(JSON.stringify(failedDoc)));
    assert.ok(warnings[0].includes('dog:1.2.3'));
  });

  it('logs message in transform function', () => {
    const { warnings, infos, logger } = logs();
    const logTestMsg = '...said the joker to the thief';
    migrate(
      {
        dog: {
          '1.2.3': (doc, context) => {
            context?.log.info(logTestMsg);
            context?.log.warning(logTestMsg);
            return doc;
          },
        },
      },
      { id: 'joker', type: 'dog', attributes: {}, migrationVersion: {} },
      logger
    );
    assert.deepEqual(infos, [logTestMsg]);
    assert.deepEqual(warnings, [logTestMsg]);
  });

  it('extracts the latest migration version info', () => {
    const noop: MigrationStep = (doc) => doc;
    const { migrationVersion } = createDocumentMigrator({
      aaa: { '1.2.3': noop, '10.4.0': noop, '2.2.1': noop },
      bbb: { '3.2.3': noop, '2.0.0': noop },
    });
    assert.deepEqual(migrationVersion, { aaa: '10.4.0', bbb: '3.2.3' });
  });

  it('refuses a migration that gives no object', () => {
    assert.throws(() => migrate({ dog: { '1.0.0': () => ({}) } }, { id: 'x', type: 'dog', attributes: {}, migrationVersion: {} }), {
      message: 'Invalid saved object returned from migration dog:1.0.0.',
    });
  });
});

// --- the product's types ------------------------------------------------------------------------

const old = (type: string, attributes: Bag, migrationVersion: Record<string, unknown> | undefined = {}) =>
  ({ id: 'x-1', type, attributes, migrationVersion, references: [], updated_at: '2026-01-01T00:00:00.000Z' }) as MigrationDocument;
const searchSource = (value: unknown) => ({ searchSourceJSON: JSON.stringify(value) });

describe('migrateDocument', () => {
  it("knows each type's last migration as the original does", () => {
    assert.deepEqual(LATEST_MIGRATION_VERSIONS, {
      config: '7.9.0',
      'index-pattern': '7.6.0',
      dashboard: '7.9.3',
      visualization: '7.10.0',
      'tsvb-validation-telemetry': '7.10.0',
      search: '7.9.3',
    });
  });

  it('marks an object written without a version as written by this release, and one of a type without migrations not at all', () => {
    const fresh = (type: string) => migrateDocument({ ...old(type, { title: 't' }), migrationVersion: undefined });
    assert.deepEqual(fresh('visualization').migrationVersion, { visualization: '7.10.0' });
    assert.deepEqual(fresh('config').migrationVersion, { config: '7.9.0' });
    assert.equal('migrationVersion' in fresh('query'), false);
    // Nothing else changes, not even what a migration would change
    assert.deepEqual(fresh('visualization').attributes, { title: 't' });
    assert.equal('migrationVersion' in migrateDocument(old('query', { title: 't' })), false);
  });

  it('brings a dashboard of 6.0 to this release: references, query, panels and their ui state', () => {
    const migrated = migrateDocument(
      old('dashboard', {
        title: 'Old dashboard',
        panelsJSON: JSON.stringify([
          { panelIndex: 1, type: 'visualization', id: 'v-1', col: 1, row: 1, size_x: 6, size_y: 3 },
          { panelIndex: 2, type: 'search', id: 's-1', col: 7, row: 1, size_x: 6, size_y: 3, columns: ['a'], sort: ['a', 'desc'] },
        ]),
        optionsJSON: '{"darkTheme":false}',
        uiStateJSON: '{"P-1":{"vis":{"legendOpen":false}}}',
        version: 1,
        timeRestore: false,
        kibanaSavedObjectMeta: searchSource({ filter: [{ query: { query_string: { query: 'status:200', analyze_wildcard: true } } }], index: 'ip-1' }),
      })
    );
    assert.equal(
      JSON.stringify(migrated),
      JSON.stringify({
        id: 'x-1',
        type: 'dashboard',
        attributes: {
          title: 'Old dashboard',
          panelsJSON: JSON.stringify([
            { panelIndex: '1', panelRefName: 'panel_0', version: '7.3.0', gridData: { x: 0, y: 0, w: 24, h: 12, i: '1' }, embeddableConfig: { vis: { legendOpen: false } } },
            { panelIndex: '2', panelRefName: 'panel_1', version: '7.3.0', gridData: { x: 24, y: 0, w: 24, h: 12, i: '2' }, embeddableConfig: { columns: ['a'], sort: ['a', 'desc'] } },
          ]),
          optionsJSON: '{"darkTheme":false}',
          version: 1,
          timeRestore: false,
          kibanaSavedObjectMeta: searchSource({
            filter: [],
            indexRefName: 'kibanaSavedObjectMeta.searchSourceJSON.index',
            query: { query: 'status:200', language: 'lucene' },
          }),
        },
        migrationVersion: { dashboard: '7.9.3' },
        references: [
          { name: 'kibanaSavedObjectMeta.searchSourceJSON.index', type: 'index-pattern', id: 'ip-1' },
          { name: 'panel_0', type: 'visualization', id: 'v-1' },
          { name: 'panel_1', type: 'search', id: 's-1' },
        ],
        updated_at: '2026-01-01T00:00:00.000Z',
      })
    );
  });

  it('brings a visualization of 6.x to this release: its saved search, index patterns, query and aggregations', () => {
    const migrated = migrateDocument(
      old('visualization', {
        title: 'Old vis',
        visState: JSON.stringify({
          title: 'Old vis',
          type: 'histogram',
          params: { addTooltip: true },
          aggs: [
            { id: '1', enabled: true, type: 'count', schema: 'metric', params: {} },
            { id: '2', enabled: true, type: 'date_histogram', schema: 'segment', params: { field: '@timestamp', interval: 'custom', customInterval: '2h', time_zone: 'Europe/Berlin' } },
            { id: '3', enabled: true, type: 'filters', schema: 'group', params: { filters: [{ input: { query: { query_string: { query: 'a:1' } } }, label: '' }] } },
          ],
        }),
        uiStateJSON: '{}',
        description: '',
        savedSearchId: 's-1',
        version: 1,
        kibanaSavedObjectMeta: searchSource({ index: 'ip-1', query: { match_all: {} }, filter: [{ meta: { index: 'ip-2', key: 'a' }, query: { match: { a: 1 } } }] }),
      })
    );
    assert.equal(
      JSON.stringify(migrated),
      JSON.stringify({
        id: 'x-1',
        type: 'visualization',
        attributes: {
          title: 'Old vis',
          visState: JSON.stringify({
            title: 'Old vis',
            type: 'histogram',
            params: { addTooltip: true },
            aggs: [
              { id: '1', enabled: true, type: 'count', schema: 'metric', params: {} },
              { id: '2', enabled: true, type: 'date_histogram', schema: 'segment', params: { field: '@timestamp', interval: '2h' } },
              { id: '3', enabled: true, type: 'filters', schema: 'group', params: { filters: [{ input: { query: 'a:1', language: 'lucene' }, label: '' }] } },
            ],
          }),
          uiStateJSON: '{}',
          description: '',
          version: 1,
          kibanaSavedObjectMeta: searchSource({
            query: { query: '', language: 'kuery' },
            filter: [{ meta: { key: 'a', indexRefName: 'kibanaSavedObjectMeta.searchSourceJSON.filter[0].meta.index' }, query: { match: { a: 1 } } }],
            indexRefName: 'kibanaSavedObjectMeta.searchSourceJSON.index',
          }),
          savedSearchRefName: 'search_0',
        },
        migrationVersion: { visualization: '7.10.0' },
        references: [
          { name: 'kibanaSavedObjectMeta.searchSourceJSON.index', type: 'index-pattern', id: 'ip-1' },
          { name: 'kibanaSavedObjectMeta.searchSourceJSON.filter[0].meta.index', type: 'index-pattern', id: 'ip-2' },
          { type: 'search', name: 'search_0', id: 's-1' },
        ],
        updated_at: '2026-01-01T00:00:00.000Z',
      })
    );
  });

  it('brings a saved search, an index pattern and the advanced settings of 6.x to this release', () => {
    const search = migrateDocument(
      old(
        'search',
        { title: 'Old search', columns: ['_source'], sort: ['@timestamp', 'desc'], kibanaSavedObjectMeta: searchSource({ index: 'ip-1', query: { match_all: {} }, filter: [] }) },
        { search: '6.6.0' }
      )
    );
    assert.equal(
      JSON.stringify(search),
      JSON.stringify({
        id: 'x-1',
        type: 'search',
        attributes: {
          title: 'Old search',
          columns: ['_source'],
          sort: [['@timestamp', 'desc']],
          kibanaSavedObjectMeta: searchSource({ query: { query: '', language: 'kuery' }, filter: [], indexRefName: 'kibanaSavedObjectMeta.searchSourceJSON.index' }),
        },
        migrationVersion: { search: '7.9.3' },
        references: [{ name: 'kibanaSavedObjectMeta.searchSourceJSON.index', type: 'index-pattern', id: 'ip-1' }],
        updated_at: '2026-01-01T00:00:00.000Z',
      })
    );
    const pattern = migrateDocument(
      old('index-pattern', {
        title: 'logs-*',
        fields: JSON.stringify([{ name: 'a', type: 'string' }, { name: 'a.keyword', type: 'string', subType: 'multi', parent: 'a' }]),
        type: '',
        typeMeta: '',
      })
    );
    assert.equal(
      JSON.stringify(pattern.attributes),
      JSON.stringify({
        title: 'logs-*',
        fields: JSON.stringify([{ name: 'a', type: 'string' }, { name: 'a.keyword', type: 'string', subType: { multi: { parent: 'a' } } }]),
      })
    );
    assert.deepEqual(pattern.migrationVersion, { 'index-pattern': '7.6.0' });
    const config = migrateDocument(old('config', { 'siem:defaultIndex': ['a'], buildNum: 1 }, { config: '7.0.0' }));
    assert.equal(JSON.stringify(config.attributes), '{"securitySolution:defaultIndex":["a"],"buildNum":1}');
    assert.deepEqual(config.migrationVersion, { config: '7.9.0' });
    const telemetry = migrateDocument(old('tsvb-validation-telemetry', { failedRequests: 5 }));
    assert.deepEqual(telemetry.attributes, { failedRequests: 0 });
    assert.deepEqual(telemetry.migrationVersion, { 'tsvb-validation-telemetry': '7.10.0' });
  });

  it('brings a TSVB visualization of 7.1 to this release, reading its keys as lodash does', () => {
    const tsvb = (visState: Bag) =>
      migrateDocument({
        id: 'x-1',
        type: 'visualization',
        attributes: {
          title: 'tsvb',
          visState: JSON.stringify(visState),
          kibanaSavedObjectMeta: { searchSourceJSON: '{"query":{"query":"","language":"kuery"},"filter":[]}' },
        },
        migrationVersion: { visualization: '7.1.0' },
        references: [],
      });
    const migrated = tsvb({
      type: 'metrics',
      params: { type: 'timeseries', series: [{ id: 's', metrics: [{ id: 'm', type: 'percentile_rank', value: 50, field: 'bytes' }] }] },
    });
    assert.equal(
      JSON.stringify(migrated),
      JSON.stringify({
        id: 'x-1',
        type: 'visualization',
        attributes: {
          title: 'tsvb',
          visState: JSON.stringify({
            type: 'metrics',
            params: {
              type: 'timeseries',
              series: [{ id: 's', metrics: [{ id: 'm', type: 'percentile_rank', field: 'bytes', values: [50] }], split_color_mode: 'gradient' }],
            },
          }),
          kibanaSavedObjectMeta: { searchSourceJSON: '{}' },
        },
        migrationVersion: { visualization: '7.10.0' },
        references: [],
      })
    );
    // A key that is a whole path is what lodash's get reads for that path
    const odd = tsvb({ type: 'metrics', 'params.series': [{ id: 's', metrics: [{ id: 'm', type: 'percentile_rank', value: 5 }] }], params: { type: 'timeseries' } });
    assert.equal(
      odd.attributes.visState,
      JSON.stringify({
        type: 'metrics',
        'params.series': [{ id: 's', metrics: [{ id: 'm', type: 'percentile_rank', values: [5] }], split_color_mode: 'gradient' }],
        params: { type: 'timeseries' },
      })
    );
  });

  it('refuses an object of a newer release, as the original words it', () => {
    for (const [migrationVersion, message] of [
      [{ visualization: '8.0.0' }, 'has property "visualization" which belongs to a more recent version of OpenSearch Dashboards [8.0.0]. The last known version is [7.10.0]'],
      [{ attributes: '1.0.0' }, 'has property "attributes" which belongs to a more recent version of OpenSearch Dashboards [1.0.0]. The last known version is [undefined]'],
    ] as const) {
      assert.throws(
        () => migrateDocument(old('visualization', { title: 't', visState: '{}' }, migrationVersion)),
        (error: unknown) => error instanceof HttpError && error.status === 422 && error.message === `Document "x-1" ${message}`
      );
    }
    // An object created without an id is named as the original names it
    assert.throws(() => migrateDocument({ ...old('search', {}, { search: '9.0.0' }), id: undefined }), {
      status: 422,
      message: 'Document "undefined" has property "search" which belongs to a more recent version of OpenSearch Dashboards [9.0.0]. The last known version is [7.9.3]',
    });
  });

  it('fails as the original on a version it cannot read, and on a key without migrations', () => {
    assert.throws(() => migrateDocument(old('visualization', {}, { visualization: 'abc' })), { name: 'TypeError', message: 'Invalid Version: abc' });
    assert.throws(() => migrateDocument(old('visualization', {}, { visualization: 7 })), {
      name: 'TypeError',
      message: 'Invalid version. Must be a string. Got type "number".',
    });
    assert.throws(() => migrateDocument(old('search', {}, { attributes: '' })), {
      message:
        'No migrations registered for property "attributes". Document id="x-1", type="search". This usually means the plugin owning this saved-object type is not loaded (orphan document).',
    });
    // A text in place of the versions is read as the original reads it: letter by letter, and
    // with the methods of a text, one of which is named as saved searches are
    const text = 'abc' as unknown as Record<string, string>;
    assert.throws(() => migrateDocument(old('visualization', {}, text)), { name: 'TypeError', message: 'Invalid Version: a' });
    assert.throws(() => migrateDocument(old('search', {}, text)), { message: 'Invalid version. Must be a string. Got type "function".' });
    // ... and kept where nothing migrates
    assert.equal(migrateDocument(old('query', {}, text)).migrationVersion, 'abc');
  });

  it('fails where the original fails on what an old object holds, naming the object', () => {
    assert.throws(() => migrateDocument(old('visualization', { title: 'zz' })), {
      message: `Failure attempting to migrate saved object 'zz' - SyntaxError: "undefined" is not valid JSON`,
    });
    assert.throws(() => migrateDocument(old('dashboard', { kibanaSavedObjectMeta: searchSource(null) })), {
      name: 'TypeError',
      message: "Cannot read properties of null (reading 'query')",
    });
  });

  it('keeps an object the original refuses for its faults: a latestVersion key, a hasOwnProperty version, a bad TSVB series', () => {
    const latest = migrateDocument(old('search', { title: 't', latestVersion: '1.0.0' }, { search: '7.9.0' }));
    assert.deepEqual(latest.migrationVersion, { search: '7.9.3' });
    const own = migrateDocument(old('search', { title: 't' }, { search: '7.9.0', hasOwnProperty: '1.0.0' }));
    assert.deepEqual(own.migrationVersion, { search: '7.9.3', hasOwnProperty: '1.0.0' });
    const { warnings, logger } = logs();
    const tsvb = migrateDocument(old('visualization', { title: 'tsvb', visState: JSON.stringify({ type: 'metrics', params: { series: 0 } }) }, { visualization: '7.2.0' }), logger);
    assert.equal(tsvb.attributes.visState, JSON.stringify({ type: 'metrics', params: { series: 0 } }));
    assert.deepEqual(tsvb.migrationVersion, { visualization: '7.10.0' });
    assert.deepEqual(warnings, []);
  });
});

describe('versionGreaterThan', () => {
  it('compares as semver.gt', () => {
    assert.equal(versionGreaterThan('7.10.0', '7.9.3'), true);
    assert.equal(versionGreaterThan('7.9.3', '7.10.0'), false);
    assert.equal(versionGreaterThan('7.10.0', '7.10.0'), false);
    assert.equal(versionGreaterThan('7.10.0', '7.10.0-beta'), true);
    assert.equal(versionGreaterThan('v8.0.0', '7.10.0'), true);
    assert.equal(versionGreaterThan(' 7.10.1 ', '7.10.0+build'), true);
    assert.equal(versionGreaterThan('1.0.0-beta.11', '1.0.0-beta.2'), true);
    assert.equal(versionGreaterThan('1.0.0-alpha', '1.0.0-1'), true);
    // Identifiers too long to be numbers are still compared as numbers, as semver does
    assert.equal(versionGreaterThan('1.0.0-99999999999999999', '1.0.0-99999999999999998'), false);
    assert.throws(() => versionGreaterThan('7.0', '7.0.0'), /Invalid Version: 7.0/);
    assert.throws(() => versionGreaterThan(`1.0.0-${'a'.repeat(260)}`, '7.0.0'), /version is longer than 256 characters/);
    assert.throws(() => versionGreaterThan(null, '7.0.0'), /Invalid version. Must be a string. Got type "object"./);
  });
});

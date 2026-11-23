/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HttpError } from '../../server/http';
import { migrateDocument, versionGreaterThan } from '../../server/saved_objects_migrations';

const doc = (type: string, migrationVersion?: Record<string, string>, attributes: Record<string, unknown> = {}) => ({
  id: 'zz',
  type,
  attributes: { title: 'zz', ...attributes } as Record<string, unknown>,
  migrationVersion,
  updated_at: '2026-01-01T00:00:00.000Z',
  references: [],
  originId: undefined,
});

describe('migrateDocument', () => {
  it('marks an object written without a version as written by this release', () => {
    assert.deepEqual(migrateDocument(doc('visualization')).migrationVersion, { visualization: '7.10.0' });
    assert.deepEqual(migrateDocument(doc('config')).migrationVersion, { config: '7.9.0' });
    assert.equal('migrationVersion' in migrateDocument(doc('query')), false);
  });

  it('migrates an object with an empty version from the start', () => {
    const migrated = migrateDocument(
      doc('visualization', {}, { kibanaSavedObjectMeta: { searchSourceJSON: '{"index":"ip"}' } })
    );
    assert.deepEqual(migrated.migrationVersion, { visualization: '7.10.0' });
    assert.deepEqual(migrated.references, [
      { name: 'kibanaSavedObjectMeta.searchSourceJSON.index', type: 'index-pattern', id: 'ip' },
    ]);
    assert.equal(
      (migrated.attributes.kibanaSavedObjectMeta as { searchSourceJSON: string }).searchSourceJSON,
      '{"indexRefName":"kibanaSavedObjectMeta.searchSourceJSON.index"}'
    );
  });

  it('leaves references alone from 7.0.0 on, and drops an empty version of a type without migrations', () => {
    const source = '{"index":"ip"}';
    const migrated = migrateDocument(
      doc('visualization', { visualization: '7.0.0' }, { kibanaSavedObjectMeta: { searchSourceJSON: source } })
    );
    assert.deepEqual(migrated.references, []);
    assert.deepEqual(migrated.migrationVersion, { visualization: '7.10.0' });
    assert.equal('migrationVersion' in migrateDocument(doc('query', {})), false);
  });

  it('refuses an object of a newer release, as the original words it', () => {
    const refusal = (migrationVersion: Record<string, string>, type = 'visualization') => {
      try {
        migrateDocument(doc(type, migrationVersion));
      } catch (error) {
        assert.ok(error instanceof HttpError);
        return `${error.status} ${error.message}`;
      }
      return 'written';
    };
    assert.equal(
      refusal({ visualization: '9.0.0' }),
      '422 Document "zz" has property "visualization" which belongs to a more recent version of OpenSearch Dashboards [9.0.0]. The last known version is [7.10.0]'
    );
    assert.equal(
      refusal({ query: '1.0.0' }, 'query'),
      '422 Document "zz" has property "query" which belongs to a more recent version of OpenSearch Dashboards [1.0.0]. The last known version is [undefined]'
    );
    assert.match(refusal({ references: '1.0.0' }), /property "references"/);
    assert.equal(refusal({ visualization: '7.10.0', other: '1.0.0' }), 'written');
  });

  it('throws as semver does on a version it cannot read', () => {
    assert.throws(() => migrateDocument(doc('visualization', { visualization: 'abc' })), TypeError);
  });
});

describe('versionGreaterThan', () => {
  it('compares as semver.gt', () => {
    assert.equal(versionGreaterThan('7.10.0', '7.9.3'), true);
    assert.equal(versionGreaterThan('7.9.3', '7.10.0'), false);
    assert.equal(versionGreaterThan('7.10.0', '7.10.0'), false);
    assert.equal(versionGreaterThan('7.10.0', '7.10.0-beta'), true);
    assert.equal(versionGreaterThan('v8.0.0', '7.10.0'), true);
    assert.throws(() => versionGreaterThan('7.0', '7.0.0'), /Invalid Version: 7.0/);
  });
});

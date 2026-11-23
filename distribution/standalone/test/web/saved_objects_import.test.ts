/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { conflictQuestion } from '../../web/apps/management/saved_objects_import';
import type { FailedConflict } from '../../web/apps/management/saved_objects_lib';

const conflict = (type: string, id: string): FailedConflict => ({
  obj: { type, id, title: id, meta: { title: id } },
  error: { type: 'conflict' },
});

describe('the questions an import asks about its conflicts', () => {
  it('asks about each conflict in a dialog of its own, as the original mounts one for each', () => {
    const finish = () => undefined;
    const first = conflictQuestion(conflict('visualization', 'a'), finish);
    // React keeps a dialog with the same key: the focus and the choice of the conflict before
    assert.ok(first.key);
    assert.notEqual(conflictQuestion(conflict('visualization', 'b'), finish).key, first.key);
    assert.notEqual(conflictQuestion(conflict('index-pattern', 'a'), finish).key, first.key);
    assert.equal(conflictQuestion(conflict('visualization', 'a'), finish).key, first.key);
  });
});

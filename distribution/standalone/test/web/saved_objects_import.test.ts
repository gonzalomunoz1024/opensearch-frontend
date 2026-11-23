/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { conflictQuestion, fileChosen, importStarted } from '../../web/apps/management/saved_objects_import';
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

describe("the import's file, as the original's flyout and its picker keep it", () => {
  it('shows the chosen file in the picker, and reads a .json one as the legacy format', () => {
    const ndjson = new File(['{}'], 'export.ndjson');
    assert.deepEqual(fileChosen(ndjson), { file: ndjson, pickerFile: ndjson, isLegacyFile: false });
    assert.equal(fileChosen(new File(['[]'], 'old.JSON')).isLegacyFile, true);
    assert.equal(fileChosen(new File(['[]'], 'old', { type: 'application/json' })).isLegacyFile, true);
    assert.deepEqual(fileChosen(undefined), { file: undefined, pickerFile: undefined, isLegacyFile: false });
  });

  it('empties the picker when the import starts, and keeps the file to send again after a failure', () => {
    const file = new File(['not json'], 'bad.ndjson');
    const state = { ...fileChosen(file), ...importStarted() };
    assert.equal(state.pickerFile, undefined);
    assert.equal(state.file, file);
    assert.equal(state.isLegacyFile, false);
    assert.deepEqual([state.status, state.error], ['loading', undefined]);
  });
});

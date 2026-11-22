/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CHANNELS_REQUIRED,
  channelError,
  channelErrors,
  errorLines,
  hasDefaultNotification,
  lronPath,
  submittedRows,
  tickRow,
  toConfigList,
  toPlainList,
  unsavedCount,
  withChannels,
  type LronConfig,
} from '../../web/apps/index_management/notification_model';

const FORCE_MERGE: LronConfig = {
  lron_condition: { success: true, failure: true },
  action_name: 'indices:admin/forcemerge',
  channels: [{ id: 'ops' }],
};

describe('the notification settings of index operations', () => {
  it('addresses what is kept for an operation by the name OpenSearch has for it', () => {
    assert.equal(lronPath('indices:data/write/reindex'), '/_plugins/_im/lron/LRON%3Aindices%3Adata%2Fwrite%2Freindex');
    assert.equal(lronPath('abc:123'), '/_plugins/_im/lron/LRON%3Aabc%3A123');
  });

  it('knows whether an operation notifies anybody by default', () => {
    assert.equal(hasDefaultNotification(FORCE_MERGE), true);
    assert.equal(hasDefaultNotification({ lron_condition: { success: false, failure: true } }), true);
    assert.equal(hasDefaultNotification({ lron_condition: { success: false, failure: false } }), false);
    assert.equal(hasDefaultNotification({}), false);
    assert.equal(hasDefaultNotification(undefined), false);
  });

  it('has a row for every operation, in the order of the page, whatever is kept', () => {
    const rows = toPlainList([]);
    assert.deepEqual(
      rows.map((row) => [row.index, row.title, row.action_name]),
      [
        [0, 'reindex', 'indices:data/write/reindex'],
        [1, 'shrink, split, clone', 'indices:admin/resize'],
        [2, 'force merge', 'indices:admin/forcemerge'],
        [3, 'open', 'indices:admin/open'],
      ]
    );
    assert.deepEqual(rows[0], {
      failure: false,
      success: false,
      action_name: 'indices:data/write/reindex',
      channels: [],
      index: 0,
      title: 'reindex',
    });
  });

  it('reads the two ticks of an operation out of what is kept for it', () => {
    const rows = toPlainList([FORCE_MERGE]);
    assert.deepEqual(rows[2], {
      success: true,
      failure: true,
      action_name: 'indices:admin/forcemerge',
      channels: [{ id: 'ops' }],
      index: 2,
      title: 'force merge',
    });
    assert.equal(rows[3].failure, false);
  });

  it('sends every operation back with its keys in the order the plugin sends them', () => {
    const rows = tickRow(toPlainList([FORCE_MERGE]), 2, 'success', false);
    assert.deepEqual(
      toConfigList(submittedRows(rows)).map((config) => JSON.stringify(config)),
      [
        '{"action_name":"indices:data/write/reindex","channels":[],"lron_condition":{"failure":false,"success":false}}',
        '{"action_name":"indices:admin/resize","channels":[],"lron_condition":{"failure":false,"success":false}}',
        '{"action_name":"indices:admin/forcemerge","channels":[{"id":"ops"}],"lron_condition":{"failure":true,"success":false}}',
        '{"action_name":"indices:admin/open","channels":[],"lron_condition":{"failure":false,"success":false}}',
      ]
    );
  });

  it('sends an operation the rows do not have as one that notifies nobody', () => {
    assert.deepEqual(toConfigList([])[3], {
      action_name: 'indices:admin/open',
      channels: [],
      lron_condition: { failure: false, success: false },
    });
  });

  it('keeps what else OpenSearch has for an operation', () => {
    const rows = toPlainList([{ ...FORCE_MERGE, schema_version: 3 }]);
    assert.equal(toConfigList(rows)[2].schema_version, 3);
  });

  it('saves no channels for an operation that notifies of nothing', () => {
    const rows = tickRow(tickRow(toPlainList([FORCE_MERGE]), 2, 'success', false), 2, 'failure', false);
    assert.deepEqual(rows[2].channels, [{ id: 'ops' }]);
    assert.deepEqual(submittedRows(rows)[2].channels, []);
    assert.deepEqual(submittedRows(toPlainList([FORCE_MERGE]))[2].channels, [{ id: 'ops' }]);
  });

  it('gives the first tick of an operation the channels of the one above it', () => {
    const rows = toPlainList([FORCE_MERGE]);
    const open = tickRow(rows, 3, 'failure', true);
    assert.deepEqual(open[3].channels, [{ id: 'ops' }]);
    assert.equal(open[3].failure, true);
    // The one above has none to give
    assert.deepEqual(tickRow(rows, 1, 'success', true)[1].channels, []);
    // The first row has none above it
    assert.deepEqual(tickRow(rows, 0, 'success', true)[0].channels, []);
  });

  it('leaves the channels alone at a second tick and where some are chosen', () => {
    const chosen = withChannels(toPlainList([FORCE_MERGE]), 3, [{ id: 'mine' }]);
    assert.deepEqual(tickRow(chosen, 3, 'failure', true)[3].channels, [{ id: 'mine' }]);
    const ticked = withChannels(tickRow(toPlainList([FORCE_MERGE]), 3, 'failure', true), 3, []);
    assert.deepEqual(tickRow(ticked, 3, 'success', true)[3].channels, []);
  });

  it('does not change the rows it was given', () => {
    const rows = toPlainList([FORCE_MERGE]);
    const before = JSON.stringify(rows);
    tickRow(rows, 3, 'failure', true);
    withChannels(rows, 0, [{ id: 'x' }]);
    submittedRows(rows);
    assert.equal(JSON.stringify(rows), before);
  });

  it('wants a channel for every operation that notifies', () => {
    const rows = tickRow(tickRow(toPlainList([]), 0, 'failure', true), 1, 'success', true);
    assert.equal(channelError(rows[0]), CHANNELS_REQUIRED);
    assert.equal(channelError(rows[2]), undefined);
    assert.equal(channelError(undefined), undefined);
    assert.deepEqual(channelErrors(rows), { 0: CHANNELS_REQUIRED, 1: CHANNELS_REQUIRED });
    assert.deepEqual(channelErrors(withChannels(rows, 0, [{ id: 'ops' }])), { 1: CHANNELS_REQUIRED });
    assert.deepEqual(channelErrors(toPlainList([FORCE_MERGE])), {});
  });

  it('says what is wrong in the words of the plugin', () => {
    const rows = tickRow(tickRow(toPlainList([]), 0, 'failure', true), 1, 'success', true);
    assert.deepEqual(errorLines(rows, channelErrors(rows)), [
      'Reindex — Notification channels: One or more channels is required.',
      'Shrink, split, clone — Notification channels: One or more channels is required.',
    ]);
    assert.deepEqual(errorLines(rows, {}), []);
  });

  it('counts what differs from what was loaded', () => {
    const loaded = toPlainList([FORCE_MERGE]);
    assert.equal(unsavedCount(loaded, loaded), 0);
    assert.equal(unsavedCount(tickRow(loaded, 0, 'failure', true), loaded), 1);
    assert.equal(unsavedCount(tickRow(loaded, 2, 'success', false), loaded), 1);
    // The tick, and the channels that came from the operation above
    assert.equal(unsavedCount(tickRow(loaded, 3, 'failure', true), loaded), 2);
    assert.equal(unsavedCount(withChannels(loaded, 2, [{ id: 'ops' }, { id: 'more' }]), loaded), 1);
    const back = tickRow(tickRow(loaded, 0, 'failure', true), 0, 'failure', false);
    assert.equal(unsavedCount(back, loaded), 0);
  });
});

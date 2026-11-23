/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  HALF_HOURS,
  MIN_COUNT_ERROR,
  POLICY_ERRORS,
  activityInfoWord,
  buildCron,
  buildPolicy,
  capitalize,
  changeCron,
  clockTime,
  countOf,
  dayTime,
  defaultPolicy,
  distinct,
  emptySnapshot,
  failedStage,
  failureSentence,
  fieldValues,
  getAt,
  hasRestoreErrors,
  humanCron,
  indexCountText,
  isOn,
  latestActivities,
  minCountError,
  newPolicyForm,
  newRestoreForm,
  notRestorable,
  notifiedActivities,
  notifies,
  parseCron,
  parseDayTime,
  policyError,
  policyFormOf,
  policyIndices,
  policyListParams,
  policyListQuery,
  repositoryBody,
  restoreBody,
  restoreErrors,
  restoreFailureText,
  restoreProgress,
  restoreTime,
  restoredIndices,
  retainedCount,
  setAt,
  settingsTokens,
  snapshotCountsWarning,
  snapshotRowId,
  snapshotStatusText,
  snapshotStatusTone,
  stageTone,
  truncate,
  withFieldValues,
  zoneOffset,
  type SMPolicy,
} from '../../web/apps/index_management/snapshot_model';
import { CronSchedule, IndicesRepositoryInput } from '../../web/apps/index_management/snapshot_parts';
import { policyChannel } from '../../web/apps/index_management/snapshot_policies';
import {
  RestoreActivities,
  askRestore,
  toastFailure,
} from '../../web/apps/index_management/snapshots';
import { createServices, services, type BootData } from '../../web/services';

describe('the words of Snapshot Management', () => {
  it('cuts a text to a length with the three dots counted in it', () => {
    assert.equal(truncate('abcdefghij', 30), 'abcdefghij');
    assert.equal(truncate('abcdefghij', 8), 'abcde...');
    assert.equal(truncate(undefined), '');
  });

  it('reads and writes the values a filter button puts into a search', () => {
    assert.deepEqual(fieldValues('type:(fs or url)', 'type'), ['fs', 'url']);
    assert.deepEqual(fieldValues('abc type:fs', 'type'), ['fs']);
    assert.deepEqual(fieldValues('abc', 'type'), []);
    assert.equal(withFieldValues('', 'type', ['fs']), 'type:(fs)');
    assert.equal(withFieldValues('abc', 'type', ['fs', 's3']), 'abc type:(fs or s3)');
    assert.equal(withFieldValues('abc type:(fs)', 'type', []), 'abc');
    assert.equal(withFieldValues('type:(fs) abc', 'type', ['my repo']), 'type:("my repo") abc');
  });

  it('lists the values of a column each once', () => {
    assert.deepEqual(distinct(['fs', undefined, 'fs', 'url', '']), ['fs', 'url']);
  });
});

describe('the schedules of snapshot policies', () => {
  it('reads what a cron expression says as the form shows it', () => {
    assert.equal(parseCron('0 20 * * *').frequencyType, 'daily');
    assert.equal(parseCron('30 * * * *').frequencyType, 'hourly');
    assert.deepEqual(parseCron('15 6 * * TUE'), {
      minute: 15,
      hour: 6,
      dayOfWeek: 'TUE',
      dayOfMonth: 1,
      frequencyType: 'weekly',
    });
    assert.equal(parseCron('0 8 * * 0').dayOfWeek, 'SUN');
    assert.equal(parseCron('0 8 * * 2').dayOfWeek, 'TUE');
    assert.equal(parseCron('0 12 15 * *').dayOfMonth, 15);
    assert.equal(parseCron('0 12 15 * *').frequencyType, 'monthly');
    assert.equal(parseCron('0 12 1 1 *').frequencyType, 'custom');
    assert.equal(parseCron('').frequencyType, 'custom');
  });

  it('writes the expression of what the form shows, a custom one as it was typed', () => {
    const parts = { minute: 5, hour: 7, dayOfWeek: 'FRI', dayOfMonth: 3 };
    assert.equal(buildCron({ ...parts, frequencyType: 'hourly' }, ''), '5 * * * *');
    assert.equal(buildCron({ ...parts, frequencyType: 'daily' }, ''), '5 7 * * *');
    assert.equal(buildCron({ ...parts, frequencyType: 'weekly' }, ''), '5 7 * * FRI');
    assert.equal(buildCron({ ...parts, frequencyType: 'monthly' }, ''), '5 7 3 * *');
    assert.equal(buildCron({ ...parts, frequencyType: 'custom' }, '1 2 3 4 *'), '1 2 3 4 *');
  });

  it('keeps the time of a schedule when its frequency changes', () => {
    assert.equal(changeCron('30 20 * * *', 'weekly'), '30 20 * * SUN');
    assert.equal(changeCron('30 20 * * TUE', 'monthly'), '30 20 1 * *');
    assert.equal(changeCron('30 20 * * *', 'hourly', { minute: 0 }), '0 * * * *');
    assert.equal(changeCron('0 20 * * *', 'daily', { hour: 9, minute: 30 }), '30 9 * * *');
  });

  it('says a time of day both ways and reads one typed', () => {
    assert.equal(clockTime(20, 5), '8:05 pm');
    assert.equal(clockTime(0, 0), '12:00 am');
    assert.equal(clockTime(12, 30), '12:30 pm');
    assert.equal(dayTime(7, 5), '07:05');
    assert.deepEqual(parseDayTime('7:5'), { hour: 7, minute: 5 });
    assert.deepEqual(parseDayTime(' 23:59 '), { hour: 23, minute: 59 });
    assert.equal(parseDayTime('24:00'), undefined);
    assert.equal(parseDayTime('noon'), undefined);
    assert.equal(HALF_HOURS.length, 48);
    assert.equal(HALF_HOURS[0], '00:00');
    assert.equal(HALF_HOURS[41], '20:30');
  });

  it('says how far a time zone is from UTC', () => {
    const winter = new Date(Date.UTC(2026, 0, 15));
    assert.equal(zoneOffset('UTC', winter), '+00:00');
    assert.equal(zoneOffset('America/Chicago', winter), '-06:00');
    assert.equal(zoneOffset('Asia/Kolkata', winter), '+05:30');
    assert.equal(zoneOffset('Nowhere/Else', winter), '');
  });

  it('puts a schedule in words as the list of policies does', () => {
    assert.equal(humanCron('0 20 * * *', 'UTC'), '8:00 pm (UTC)');
    assert.equal(humanCron('30 20 * * TUE', 'UTC'), 'TUE, 8:30 pm (UTC)');
    assert.equal(humanCron('0 8 3 * *', 'UTC'), 'Day 3, 8:00 am (UTC)');
    assert.equal(humanCron('0 12 1 1 *', 'America/Chicago'), '0 12 1 1 * (America/Chicago)');
    // As upstream: an hourly schedule is read with the hour it does not have
    assert.equal(humanCron('0 * * * *', 'UTC'), '8:00 pm (UTC)');
  });
});

describe('repositories', () => {
  it('registers a shared file system with its location in the settings', () => {
    assert.deepEqual(repositoryBody('fs', '/mnt/snapshots', '{"compress": true}'), {
      type: 'fs',
      settings: { compress: true, location: '/mnt/snapshots' },
    });
  });

  it('takes the type and the settings of a custom configuration from what was written', () => {
    assert.deepEqual(
      repositoryBody('custom', '', '{"type":"s3","settings":{"bucket":"b"},"other":1}'),
      { type: 's3', settings: { bucket: 'b' } }
    );
  });

  it('registers nothing when the settings are not JSON', () => {
    assert.equal(repositoryBody('fs', '/x', '{ nope'), undefined);
    assert.equal(repositoryBody('fs', '/x', '3'), undefined);
  });

  it('colours the settings as the editor does, with a guide for each four spaces of an indent', () => {
    const lines = settingsTokens(
      ['{', '    "type": "s3",', '    "settings": {', '        "readonly": false,', '        "x": null', '    }', '}'].join('\n')
    );
    assert.deepEqual(lines[0], [{ text: '{' }]);
    // Four spaces are an indent of one tab: no guide before its last space
    assert.deepEqual(lines[1], [
      { text: '    ' },
      { text: '"type"', kind: 'Key' },
      { text: ': ' },
      { text: '"s3"', kind: 'String' },
      { text: ',' },
    ]);
    // Eight are two: one guide, then the four spaces that are left
    assert.deepEqual(lines[3], [
      { text: '    ', kind: 'Guide' },
      { text: '    ' },
      { text: '"readonly"', kind: 'Key' },
      { text: ': ' },
      { text: 'false', kind: 'Boolean' },
      { text: ',' },
    ]);
    // null is not coloured, as in the original's JSON mode
    assert.deepEqual(lines[4], [
      { text: '    ', kind: 'Guide' },
      { text: '    ' },
      { text: '"x"', kind: 'Key' },
      { text: ': null' },
    ]);
    assert.deepEqual(lines[5], [{ text: '    }' }]);
    assert.deepEqual(lines[6], [{ text: '}' }]);
  });

  it('draws the guides of a deep or an odd indent by whole tabs only', () => {
    assert.deepEqual(settingsTokens('             1'), [
      [{ text: '    ', kind: 'Guide' }, { text: '    ', kind: 'Guide' }, { text: '    ', kind: 'Guide' }, { text: ' ' }, { text: '1', kind: 'Number' }],
    ]);
    assert.deepEqual(settingsTokens('  "a"'), [[{ text: '  ' }, { text: '"a"', kind: 'String' }]]);
    assert.deepEqual(settingsTokens(''), [[{ text: '' }]]);
    assert.deepEqual(settingsTokens('        '), [[{ text: '    ', kind: 'Guide' }, { text: '    ' }]]);
  });

  it('warns of the snapshots that go with the repositories deleted', () => {
    const one = { id: 'a', type: 'fs', snapshotCount: 2 };
    const two = { id: 'b', type: 'fs', snapshotCount: 0 };
    assert.equal(snapshotCountsWarning([one]), 'You have 2 snapshots in the repository.');
    assert.equal(
      snapshotCountsWarning([one, two]),
      'You have 2, 0 snapshots in these repositories respectively.'
    );
  });
});

describe('snapshots', () => {
  const row = (status: string) => ({ id: 'snap', status, repository: 'repo' });

  it('writes a status as the list shows it, with its colour', () => {
    assert.equal(snapshotStatusText('IN_PROGRESS'), 'In progress');
    assert.equal(snapshotStatusText('SUCCESS'), 'Success');
    assert.equal(snapshotStatusTone('FAILED'), 'warning');
    assert.equal(snapshotStatusTone('PARTIAL'), 'critical');
    // As upstream: a snapshot still being taken is drawn as one that is done
    assert.equal(snapshotStatusTone('IN_PROGRESS'), 'healthy');
  });

  it('says why a snapshot cannot be restored yet', () => {
    assert.equal(notRestorable(row('SUCCESS')), undefined);
    assert.deepEqual(notRestorable(row('IN_PROGRESS')), {
      title: 'snap is not available for restore',
      text: 'This snapshot is still being created. Try again once the snapshot has been completed.',
    });
    assert.equal(
      notRestorable(row('FAILED'))?.text,
      'This shapshot is incomplete. Pick another snapshot to restore.'
    );
  });

  it('repeats the sentence of a failure of OpenSearch', () => {
    const error = JSON.stringify({
      error: {
        root_cause: [
          { reason: '[repo:snap] snapshot with the same name is already in-progress. More' },
        ],
      },
    });
    assert.equal(failureSentence(error), ' snapshot with the same name is already in-progress.');
    assert.equal(failureSentence('plain words'), 'plain words');
  });

  it('tells apart snapshots of the same name in two repositories', () => {
    assert.equal(snapshotRowId(row('SUCCESS')), 'repo:snap');
    assert.notEqual(snapshotRowId({ ...row('SUCCESS'), repository: 'other' }), 'repo:snap');
  });

  it('writes a word with only its first letter large', () => {
    assert.equal(capitalize('PARTIAL'), 'Partial');
    assert.equal(capitalize('weekly'), 'Weekly');
    assert.equal(capitalize(''), '');
  });

  it('takes a snapshot of nothing chosen, with every option off', () => {
    assert.deepEqual(emptySnapshot(), {
      indices: '',
      ignore_unavailable: false,
      include_global_state: false,
      partial: false,
    });
    assert.notEqual(emptySnapshot(), emptySnapshot());
  });
});

describe('restoring a snapshot', () => {
  const form = newRestoreForm({ indices: ['a', 'b'], include_global_state: true });

  it('restores everything with a prefix unless told otherwise', () => {
    assert.deepEqual(restoreBody(form), {
      indices: 'a,b',
      ignore_unavailable: false,
      include_global_state: true,
      rename_pattern: '(.+)',
      rename_replacement: 'restored_$1',
      include_aliases: true,
      partial: false,
    });
  });

  it('sends what was asked for, and no renaming when indices keep their names', () => {
    const body = restoreBody({
      ...form,
      restoreSpecific: true,
      selected: ['b'],
      rename: 'do_not_rename',
      customIndexSettings: '{"index.number_of_replicas":0}',
      ignoreIndexSettings: 'index.refresh_interval',
    });
    assert.deepEqual(body, {
      indices: 'b',
      index_settings: { 'index.number_of_replicas': 0 },
      ignore_index_settings: 'index.refresh_interval',
      ignore_unavailable: false,
      include_global_state: true,
      include_aliases: true,
      partial: false,
    });
    assert.deepEqual(Object.keys(restoreBody({ ...form, rename: 'rename_indices' })).slice(3, 5), [
      'rename_pattern',
      'rename_replacement',
    ]);
  });

  it('finds what is wrong with a restore before it is sent', () => {
    assert.deepEqual(restoreErrors(form), {
      badPattern: false,
      badRename: false,
      badJSON: false,
      badIgnore: false,
      noIndicesSelected: false,
    });
    const wrong = restoreErrors({
      ...form,
      rename: 'rename_indices',
      renamePattern: '(',
      renameReplacement: 'nothing',
      restoreSpecific: true,
      customIndexSettings: '{"index.blocks.write":true}',
      ignoreIndexSettings: 'index.blocks.write',
    });
    assert.deepEqual(wrong, {
      badPattern: true,
      badRename: true,
      badJSON: false,
      badIgnore: true,
      noIndicesSelected: true,
    });
    assert.equal(restoreErrors({ ...form, customIndexSettings: '{' }).badJSON, true);
    assert.equal(hasRestoreErrors(restoreErrors(form)), false);
    assert.equal(hasRestoreErrors(wrong), true);
    assert.equal(hasRestoreErrors({ ...restoreErrors(form), noIndicesSelected: true }), true);
  });

  it('restores all the indices of the snapshot, or those chosen', () => {
    assert.deepEqual(restoredIndices(form), ['a', 'b']);
    assert.deepEqual(restoredIndices({ ...form, restoreSpecific: true, selected: ['b'] }), ['b']);
    assert.deepEqual(restoredIndices({ ...form, selected: ['b'] }), ['a', 'b']);
  });

  it('writes a moment as the list of restores does, the comma after the date made spaces', () => {
    const time = Date.UTC(2026, 10, 22, 17, 29, 1);
    const written = new Date(time).toLocaleString();
    assert.equal(restoreTime(time), written.replace(',', '  '));
    if (written.split(',').length === 2) assert.equal(restoreTime(time).includes(','), false);
  });

  it('suggests another prefix when the index is there already', () => {
    assert.equal(
      restoreFailureText('cannot restore index [x] because an open index with same name exists'),
      'You have an index with the same name. Try a different prefix. cannot restore index [x] because an open index with same name exists'
    );
    assert.equal(restoreFailureText('other'), ' other');
  });

  it('follows a restore through the recoveries of the cluster', () => {
    const recovery = {
      restored_a: {
        shards: [
          {
            stage: 'DONE',
            start_time_in_millis: 2000,
            stop_time_in_millis: 2500,
            source: { index: 'a', snapshot: 'snap' },
          },
        ],
      },
      restored_b: {
        shards: [
          { stage: 'INDEX', start_time_in_millis: 2100, source: { index: 'b', snapshot: 'snap' } },
        ],
      },
      older: { shards: [{ stage: 'DONE', start_time_in_millis: 10 }] },
      '.kibana_1': { shards: [{ stage: 'DONE', start_time_in_millis: 3000 }] },
    };
    const progress = restoreProgress(recovery, 'snap', 1000, ['a', 'b', 'c'], 9000);
    assert.deepEqual(progress, {
      indices: [
        { index: 'a', restore_status: 'Completed' },
        { index: 'b', restore_status: 'Copying' },
        { index: 'c', restore_status: 'Pending' },
      ],
      startTime: 2000,
      stopTime: 9000,
      stage: 'Copying (33%)',
    });
    // As upstream: before anything recovers, the restore is said to be copying
    assert.equal(restoreProgress({}, 'snap', 1000, ['a'], 9000).stage, 'Copying (0%)');
    const unknown = { x: { shards: [{ stage: 'ELSEWHERE', start_time_in_millis: 2000 }] } };
    assert.equal(restoreProgress(unknown, 'snap', 1000, ['a'], 9000).stage, undefined);
  });

  it('says how far a restore came and how it ended', () => {
    assert.equal(failedStage('Copying (50%)'), 'Failed (50%)');
    assert.equal(stageTone('Completed (100%)'), 'healthy');
    assert.equal(stageTone('Failed (50%)'), 'critical');
    assert.equal(stageTone('Copying (50%)'), 'warning');
    assert.equal(indexCountText(1), '1 Index');
    assert.equal(indexCountText(3), '3 Indices');
  });
});

describe('snapshot policies', () => {
  const policy = (more: Partial<SMPolicy> = {}): SMPolicy => ({
    ...defaultPolicy(),
    name: '',
    snapshot_config: { repository: 'repo' },
    ...more,
  });

  it('sets a value deep in a policy without changing the policy it was given', () => {
    const before = policy();
    const after = setAt(before, 'notification.conditions.failure', true);
    assert.equal(isOn(after, 'notification.conditions.failure'), true);
    assert.equal(before.notification, undefined);
    assert.equal(isOn({ snapshot_config: { partial: 'true' } }, 'snapshot_config.partial'), true);
    assert.equal(getAt(after, 'notification.conditions.failure'), true);
    assert.equal(getAt(after, 'notification.channel.id'), undefined);
    assert.equal(getAt(after, 'snapshot_config.repository.length'), undefined);
    assert.equal(getAt(null, 'snapshot_config'), undefined);
    assert.equal(notifies(after), true);
    assert.equal(notifies(before), false);
  });

  it('sends a policy without what the form switched off', () => {
    assert.deepEqual(buildPolicy(policy(), newPolicyForm()), {
      name: '',
      description: '',
      enabled: true,
      creation: { schedule: { cron: { expression: '0 20 * * *', timezone: 'UTC' } } },
      snapshot_config: { repository: 'repo' },
    });
    const kept = buildPolicy(
      policy({
        deletion: { schedule: { cron: { expression: '0 3 * * *' } }, condition: { min_count: 2 } },
        notification: { conditions: { creation: false } },
      }),
      { ...newPolicyForm(), retention: true, maxAgeNumber: 7, maxAgeUnit: 'h' }
    );
    assert.deepEqual(kept.deletion, { condition: { min_count: 2, max_age: '7h' } });
    assert.equal(kept.notification, undefined);
  });

  it('deletes on a schedule of its own in the time zone snapshots are taken in', () => {
    const built = buildPolicy(
      policy({ deletion: { schedule: { cron: { expression: '0 3 * * *' } } } }),
      { ...newPolicyForm(), retention: true, deletionSchedule: true }
    );
    assert.deepEqual(built.deletion, {
      schedule: { cron: { expression: '0 3 * * *', timezone: 'UTC' } },
      condition: { max_age: '1d' },
    });
    // A deletion schedule without retention is not sent, unlike upstream
    assert.equal(
      buildPolicy(policy(), { ...newPolicyForm(), deletionSchedule: true }).deletion,
      undefined
    );
  });

  it('reads the form of a policy that is there already', () => {
    const form = policyFormOf(
      policy({
        creation: { schedule: { cron: { expression: '0 20 * * TUE', timezone: 'UTC' } } },
        deletion: {
          schedule: { cron: { expression: '0 20 15 * *', timezone: 'UTC' } },
          condition: { max_age: '12h' },
        },
      })
    );
    assert.deepEqual(form, {
      creationFrequency: 'weekly',
      deletionFrequency: 'monthly',
      deletionOnly: false,
      retention: true,
      deletionSchedule: true,
      maxAgeNumber: 12,
      maxAgeUnit: 'h',
    });
    assert.equal(policyFormOf(policy()).retention, false);
    assert.deepEqual(policyIndices(policy({ snapshot_config: { indices: 'a,b*' } })), ['a', 'b*']);
    assert.deepEqual(policyIndices(policy()), []);
  });

  it('says the first thing missing before a policy can be saved', () => {
    const form = newPolicyForm();
    assert.deepEqual(policyError(' ', policy(), form), { field: 'name', text: POLICY_ERRORS.NAME });
    assert.deepEqual(policyError('p', policy({ snapshot_config: { repository: '' } }), form), {
      field: 'repository',
      text: POLICY_ERRORS.REPO,
    });
    const noZone = policy({ creation: { schedule: { cron: { expression: '0 20 * * *' } } } });
    assert.equal(policyError('p', noZone, form)?.field, 'timezone');
    assert.equal(policyError('p', noZone, { ...form, deletionOnly: true }), undefined);
    assert.equal(policyError('p', policy(), form), undefined);
  });

  it('keeps what the list shows in its address', () => {
    assert.deepEqual(policyListQuery({}), {
      from: 0,
      size: 20,
      sortField: 'name',
      sortOrder: 'desc',
      queryString: '',
    });
    const query = policyListQuery({ from: '20', size: 'x', sortOrder: 'asc', queryString: 'p*' });
    assert.deepEqual(query, {
      from: 20,
      size: 20,
      sortField: 'name',
      sortOrder: 'asc',
      queryString: 'p*',
    });
    assert.deepEqual(Object.keys(policyListParams(query)), [
      'from',
      'queryString',
      'size',
      'sortField',
      'sortOrder',
    ]);
  });

  it('checks and shows the numbers of snapshots kept', () => {
    assert.equal(retainedCount(undefined), '-');
    assert.equal(retainedCount(0), '0');
    assert.equal(minCountError(undefined), MIN_COUNT_ERROR);
    assert.equal(minCountError(0), MIN_COUNT_ERROR);
    assert.equal(minCountError(1), '');
    assert.equal(countOf('7'), 7);
    assert.equal(countOf(''), undefined);
  });

  it('lists the last things a policy did and what it tells of', () => {
    assert.deepEqual(latestActivities(undefined), [{ activityType: 'Creation' }]);
    const activities = latestActivities({
      creation: { latest_execution: { status: 'SUCCESS', start_time: 1 } },
      deletion: { latest_execution: { status: 'FAILED', info: { cause: 'x' } } },
    });
    assert.deepEqual(
      activities.map((item) => [item.activityType, item.status]),
      [
        ['Creation', 'SUCCESS'],
        ['Deletion', 'FAILED'],
      ]
    );
    assert.equal(activityInfoWord({ cause: 'x', message: 'y' }), 'cause');
    assert.equal(activityInfoWord({ message: 'y' }), 'message');
    assert.equal(activityInfoWord(undefined), '-');
    assert.equal(notifiedActivities(policy()), 'None');
    assert.equal(
      notifiedActivities(
        policy({ notification: { conditions: { creation: true, deletion: false, failure: true } } })
      ),
      'creation, failure'
    );
  });
});

describe('the channel on the page of a policy', () => {
  // The routes of the server, answering every request with the answer given; the toasts' waits are not run
  const withAnswer = async (answer: unknown, run: (asked: string[]) => Promise<void>) => {
    const asked: string[] = [];
    const original = globalThis.fetch;
    const globals = globalThis as { window?: unknown };
    globals.window = { setTimeout: () => 0 };
    globalThis.fetch = (async (url: string) => {
      asked.push(url);
      return new Response(JSON.stringify(answer), { headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    try {
      createServices({ basePath: '', settings: {} } as unknown as BootData);
      await run(asked);
    } finally {
      globalThis.fetch = original;
      delete globals.window;
    }
  };

  it('is none, with no message, when it cannot be loaded, as the original shows it', () =>
    withAnswer(
      { ok: false, error: 'no handler found for uri [/_plugins/_notifications/configs/a b] and method [GET]' },
      async (asked) => {
        assert.equal(await policyChannel('a b'), undefined);
        assert.deepEqual(asked, ['/api/ism/_notifications/channels/a%20b']);
        assert.deepEqual(services.toasts.get(), []);
      }
    ));

  it('is the one channel the notifications plugin finds', async () => {
    const found = { config_id: 'c1', config: { name: 'Ops', config_type: 'slack' } };
    await withAnswer({ ok: true, response: { config_list: [found] } }, async () => {
      assert.deepEqual(await policyChannel('c1'), found);
    });
    await withAnswer({ ok: true, response: { config_list: [found, found] } }, async () => {
      assert.equal(await policyChannel('c1'), undefined);
    });
  });
});

describe('the head of a list of Snapshot Management', () => {
  it('is never narrower than its title, which the buttons beside it would cover', () => {
    // At 1000 px the plugin's "Snapshots" keeps its 138 px and its buttons go past the panel; a
    // heading allowed to shrink to nothing put the buttons over the title
    const sheet = readFileSync('web/styles/index_management.css', 'utf8');
    const start = sheet.indexOf('\n.ismListPanel__heading {');
    assert.ok(start >= 0, '.ismListPanel__heading has a rule');
    const rule = sheet.slice(start, sheet.indexOf('}', start));
    assert.equal(/min-width:\s*0/.test(rule), false);
  });
});

describe('the combo boxes of Snapshot Management', () => {
  it('are as tall as the fields beside them, as the plugin\'s (32 px), not of the small size', () => {
    const none = () => undefined;
    const indices = renderToStaticMarkup(
      createElement(IndicesRepositoryInput, {
        options: [],
        onSearch: none,
        indices: [],
        onIndices: none,
        repositories: [],
        repository: '',
        onRepository: none,
      })
    );
    const zone = renderToStaticMarkup(
      createElement(CronSchedule, {
        title: 'Snapshot frequency',
        frequencyType: 'daily',
        onFrequencyType: none,
        expression: '0 20 * * *',
        onExpression: none,
        timezone: 'UTC',
        onTimezone: none,
      })
    );
    for (const markup of [indices, zone]) {
      assert.match(markup, /atlCombo/);
      assert.equal(/atlCombo--s\b/.test(markup), false);
    }
  });
});

describe('the failures and the restores of the list of snapshots', () => {
  // The routes of the server, answering every request with the answer given, and when each was
  // asked; the toasts' waits are kept, not run
  const withAnswer = async (
    answer: unknown,
    run: (asked: Array<{ url: string; at: number }>, waits: number[]) => Promise<void>
  ) => {
    const asked: Array<{ url: string; at: number }> = [];
    const waits: number[] = [];
    const original = globalThis.fetch;
    const globals = globalThis as { window?: unknown };
    globals.window = {
      setTimeout: (_run: unknown, wait: number) => {
        waits.push(wait);
        return 0;
      },
    };
    globalThis.fetch = (async (url: string) => {
      asked.push({ url, at: Date.now() });
      return new Response(JSON.stringify(answer), { headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    try {
      createServices({ basePath: '', settings: {} } as unknown as BootData);
      await run(asked, waits);
    } finally {
      globalThis.fetch = original;
      delete globals.window;
    }
  };
  const refusal = JSON.stringify({
    error: {
      root_cause: [{ type: 'snapshot_missing_exception', reason: '[zz-repo:zz-snap] The snapshot is missing. Look again' }],
    },
  });

  it("are toasted as the plugin's addError: kept as long as errors, with the whole answer to see", () =>
    withAnswer({}, async (_asked, waits) => {
      toastFailure('There was a problem deleting the snapshot.', refusal);
      // Taking one, the plugin writes the whole answer
      toastFailure('There was a problem creating the snapshot.', refusal, refusal);
      const [deleted, created] = services.toasts.get();
      assert.equal(deleted.kind, 'critical');
      assert.equal(deleted.title, 'There was a problem deleting the snapshot.');
      assert.equal(
        deleted.text,
        ' The snapshot is missing. Open browser console & click below for details.'
      );
      assert.equal(deleted.error?.message, refusal);
      assert.equal(created.text, `${refusal} Open browser console & click below for details.`);
      assert.deepEqual(waits, [300000, 300000]);
    }));

  it('follows a restore only once OpenSearch took it, counting from before it was asked for', async () => {
    await withAnswer({ ok: false, error: refusal }, async (asked) => {
      const refused = await askRestore({ id: 'zz-snap', repository: 'zz-repo' }, { indices: 'a' }, ['a']);
      assert.deepEqual(refused, { error: refusal });
      assert.deepEqual(
        asked.map((one) => one.url),
        ['/api/ism/_snapshots/zz-snap?repository=zz-repo']
      );
    });
    await withAnswer({ ok: true, response: { accepted: true } }, async (asked) => {
      const before = Date.now();
      const taken = await askRestore({ id: 'zz-snap', repository: 'zz-repo' }, {}, ['a', 'b']);
      assert.ok('restore' in taken);
      const { restore } = taken as { restore: { startedAt: number } };
      assert.deepEqual(taken, {
        restore: { snapshotId: 'zz-snap', startedAt: restore.startedAt, indices: ['a', 'b'] },
      });
      assert.ok(restore.startedAt >= before && restore.startedAt <= asked[0].at);
    });
  });

  it('shows at once what was last read of a restore when its tab is opened again', () =>
    withAnswer({}, async () => {
      const markup = renderToStaticMarkup(
        createElement(RestoreActivities, {
          restore: {
            snapshotId: 'zz-snap',
            startedAt: 1,
            indices: ['a', 'b'],
            progress: { indices: [], startTime: 1, stopTime: 2, stage: 'Completed (100%)' },
          },
          onSeen: () => undefined,
          onFailure: () => undefined,
        })
      );
      assert.match(markup, /Completed \(100%\)/);
      assert.match(markup, /zz-snap/);
      assert.match(markup, /2 Indices/);
    }));
});

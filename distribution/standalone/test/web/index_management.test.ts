/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BLOCKS,
  SYSTEM_INDEX,
  aliasActions,
  blockedIndices,
  clearCacheToast,
  flushBlockedMessage,
  flushToast,
  groupAliases,
  matchesAny,
  orDash,
  pageChanges,
  pageQuery,
  redOpenIndices,
  refreshToast,
  searchClauses,
  splitBlocked,
  withDataStreams,
} from '../../web/apps/index_management/model';
import {
  ALIAS_MESSAGE,
  DEFAULT_POLICY_JSON,
  DUPLICATED_ALIAS_TEXT,
  EMPTY_POLICY,
  actionContent,
  actionIsValid,
  actionType,
  aliasErrors,
  aliasesOf,
  conditionContent,
  conditionKind,
  conditionsOf,
  draftsAreValid,
  draftsOf,
  orderInfo,
  templatesOf,
  updatedPolicy,
  updatedStates,
  withDrafts,
  withoutState,
  type Policy,
  type State,
} from '../../web/apps/index_management/policy_model';

describe('the search box of a list', () => {
  it('separates the words from what is named with a field', () => {
    assert.deepEqual(searchClauses('logs data_streams:(a or b) indices:x'), {
      terms: ['logs'],
      indices: ['x'],
      dataStreams: ['a', 'b'],
    });
    assert.deepEqual(searchClauses('  '), { terms: [], indices: [], dataStreams: [] });
  });

  it('replaces the data streams a search names', () => {
    assert.equal(withDataStreams('logs data_streams:a', ['b']), 'logs data_streams:b');
    assert.equal(withDataStreams('logs', ['a', 'b']), 'logs data_streams:(a or b)');
    assert.equal(withDataStreams('logs data_streams:(a or b)', []), 'logs');
    assert.equal(withDataStreams('', ['a']), 'data_streams:a');
  });
});

describe('the indices of the system', () => {
  it('knows them by their patterns', () => {
    assert.equal(matchesAny('.kibana_1', SYSTEM_INDEX), true);
    assert.equal(matchesAny('.opendistro-alerting-alert-history', SYSTEM_INDEX), true);
    assert.equal(matchesAny('logs-1', SYSTEM_INDEX), false);
    // A dot in a pattern is a dot, not any letter
    assert.equal(matchesAny('xtasks', ['.tasks']), false);
  });
});

describe('what an operation leaves alone', () => {
  const state = { blocks: { indices: { closed: { '4': {} }, readonly: { '5': {} }, both: { '4': {}, '9': {} } } } };

  it('finds the indices with a block', () => {
    assert.deepEqual([...blockedIndices(state, [BLOCKS.CLOSED])].sort(), ['both', 'closed']);
    assert.deepEqual([...blockedIndices(state, [BLOCKS.READ_ONLY, BLOCKS.META_DATA])].sort(), ['both', 'readonly']);
    assert.deepEqual([...blockedIndices(undefined, [BLOCKS.CLOSED])], []);
  });

  it('reads the red open indices from the text of the indices API', () => {
    assert.deepEqual(redOpenIndices('a open\nb close\nc open\n'), ['a', 'c']);
    assert.deepEqual(redOpenIndices(undefined), []);
  });

  it('holds back a name when one of its indices is blocked', () => {
    const items = [
      { name: 'alias-1', indices: ['a', 'closed'] },
      { name: 'alias-2', indices: ['a'] },
    ];
    assert.deepEqual(splitBlocked(items, new Set(['closed'])), {
      unBlockedItems: ['alias-2'],
      blockedItems: ['alias-1'],
    });
  });
});

describe('the sentences of the operations', () => {
  it('says what was cleared', () => {
    assert.equal(clearCacheToast('indexes', [], true), 'Cache for all open indexes have been successfully cleared.');
    assert.equal(clearCacheToast('indexes', ['a'], false), 'Cache for a has been successfully cleared.');
    assert.equal(
      clearCacheToast('aliases', ['a', 'b'], false),
      'Cache for 2 aliases [a, b] have been successfully cleared.'
    );
  });

  it('says what was flushed and what cannot be', () => {
    assert.equal(flushToast('indexes', []), 'All open indexes have been successfully flushed.');
    assert.equal(flushToast('data streams', ['a']), 'The data stream a has been successfully flushed.');
    assert.equal(flushToast('aliases', ['a', 'b']), '2 aliases have been successfully flushed.');
    assert.equal(
      flushBlockedMessage('data streams'),
      'The following data streams will not be flushed because one or more backing indexes are either closed or in red status:'
    );
    assert.equal(
      flushBlockedMessage('indexes'),
      'The following indexes will not be flushed because they are either closed or in red status:'
    );
  });

  it('says what was refreshed', () => {
    assert.equal(refreshToast('indexes', [], true), 'All open indexes have been successfully refreshed.');
    assert.equal(refreshToast('aliases', ['a'], false), 'The alias [a] has been successfully refreshed.');
    assert.equal(refreshToast('indexes', ['a', 'b'], false), '2 indexes [a, b] have been successfully refreshed.');
  });

  it('writes a dash for nothing', () => {
    assert.equal(orDash(''), '-');
    assert.equal(orDash(0), '-');
    assert.equal(orDash(undefined), '-');
    assert.equal(orDash('hot'), 'hot');
  });
});

describe('aliases', () => {
  it('makes one row of an alias with all its indexes', () => {
    const rows = groupAliases([
      { alias: 'a', index: 'i1', is_write_index: '-' },
      { alias: 'a', index: 'i2', is_write_index: 'true' },
      { alias: 'b', index: 'i3', is_write_index: '-' },
      { alias: 'c', index: 'i4', is_write_index: '-' },
      { alias: 'c', index: 'i5', is_write_index: '-' },
    ]);
    assert.deepEqual(
      rows.map((row) => [row.alias, row.indexArray, row.writeIndex]),
      [
        ['a', ['i1', 'i2'], 'i2'],
        // The only index of an alias is the one writes go to
        ['b', ['i3'], 'i3'],
        ['c', ['i4', 'i5'], ''],
      ]
    );
  });

  it('removes the indexes an alias loses and adds those it gains', () => {
    assert.deepEqual(aliasActions(['i1', 'i2'], ['i2', 'i3'], 'a'), [
      { remove: { alias: 'a', index: 'i1' } },
      { add: { alias: 'a', index: 'i3' } },
    ]);
    assert.deepEqual(aliasActions(['i1'], ['i1'], 'a'), []);
  });

  it('counts pages in the address and rows in the table', () => {
    assert.deepEqual(pageQuery({ from: 2, size: 20 }), { from: 40, size: 20 });
    assert.deepEqual(pageChanges({ from: 40 }, 20), { from: 2 });
    assert.deepEqual(pageChanges({ from: 0, size: 50 }, 20), { from: 0, size: 50 });
    assert.deepEqual(pageChanges({ size: 50 }, 20), { size: 50 });
  });
});

describe('a policy', () => {
  it('starts from the example the plugin proposes', () => {
    const example = JSON.parse(DEFAULT_POLICY_JSON) as { policy: Policy };
    assert.equal(example.policy.default_state, 'example_hot_state');
    assert.deepEqual(
      example.policy.states.map((state) => state.name),
      ['example_hot_state', 'example_cold_state']
    );
    assert.equal(EMPTY_POLICY.description, 'A sample description of the policy');
    assert.deepEqual(EMPTY_POLICY.states, []);
  });

  it('has its templates as a list, whether it was saved with one or with several', () => {
    const one = { index_patterns: ['a*'], priority: 1 };
    assert.deepEqual(templatesOf(undefined), []);
    assert.deepEqual(templatesOf(null), []);
    assert.deepEqual(templatesOf(one), [one]);
    assert.deepEqual(templatesOf([one, one]), [one, one]);
  });
});

describe('an action of a state', () => {
  it('is of the kind it names beside its timeout and retry', () => {
    assert.equal(actionType({ timeout: '1h', retry: { count: 3 }, rollover: {} }), 'rollover');
    assert.equal(actionType({ retry: { count: 3 } }), undefined);
  });

  it('is described as the editor describes it', () => {
    assert.equal(actionContent({ force_merge: { max_num_segments: 2 } }), 'Force merge to 2 segments');
    assert.equal(actionContent({ index_priority: { priority: 5 } }), 'Set index priority to 5');
    assert.equal(actionContent({ replica_count: { number_of_replicas: 1 } }), 'Set number of replicas to 1');
    assert.equal(actionContent({ alias: { actions: [] } }), 'Add / remove aliases');
    assert.equal(actionContent({ read_only: {} }), 'Read only');
    assert.equal(actionContent({ some_new_kind: {} }), 'Some new kind');
  });

  it('lists the aliases it adds and removes', () => {
    const action = {
      alias: { actions: [{ add: { aliases: ['a', 'b'] } }, { remove: { alias: 'c' } }, { remove: { aliases: ['d'] } }] },
    };
    assert.deepEqual(aliasesOf(action), { add: ['a', 'b'], remove: ['c', 'd'] });
    assert.deepEqual(aliasesOf({ alias: {} }), { add: [], remove: [] });
  });

  it('refuses an alias that is badly named or both added and removed', () => {
    assert.deepEqual(aliasErrors({ alias: { actions: [{ add: { aliases: ['_bad'] } }] } }), {
      add: ALIAS_MESSAGE,
      remove: undefined,
    });
    assert.deepEqual(
      aliasErrors({ alias: { actions: [{ add: { aliases: ['a'] } }, { remove: { aliases: ['a'] } }] } }),
      { add: DUPLICATED_ALIAS_TEXT, remove: DUPLICATED_ALIAS_TEXT }
    );
    assert.deepEqual(aliasErrors({ alias: { actions: [{ add: { aliases: ['a'] } }] } }), {
      add: undefined,
      remove: undefined,
    });
  });

  it('is valid when it says enough', () => {
    assert.equal(actionIsValid({ rollover: {} }), true);
    assert.equal(actionIsValid({ rollover: { min_doc_count: 0 } }), false);
    assert.equal(actionIsValid({ force_merge: { max_num_segments: 0 } }), false);
    assert.equal(actionIsValid({ force_merge: { max_num_segments: 1 } }), true);
    assert.equal(actionIsValid({ replica_count: { number_of_replicas: 0 } }), true);
    assert.equal(actionIsValid({ index_priority: {} }), false);
    assert.equal(actionIsValid({ snapshot: { repository: 'r' } }), false);
    assert.equal(actionIsValid({ snapshot: { repository: 'r', snapshot: 's' } }), true);
    assert.equal(actionIsValid({ alias: { actions: [] } }), false);
    assert.equal(actionIsValid({ alias: { actions: [{ add: { aliases: ['a'] } }] } }), true);
    // A shrink names exactly one way to count its shards
    assert.equal(actionIsValid({ shrink: { num_new_shards: 1 } }), true);
    assert.equal(actionIsValid({ shrink: { num_new_shards: 1, max_shard_size: '5gb' } }), false);
    assert.equal(actionIsValid({ shrink: {} }), false);
    assert.equal(actionIsValid({ convert_index_to_remote: { repository: 'r', snapshot: 's' } }), true);
    assert.equal(
      actionIsValid({ convert_index_to_remote: { repository: 'r', snapshot: 's', rename_pattern: 'remote' } }),
      false
    );
    assert.equal(actionIsValid({}), false);
  });

  it('keeps as text what its form edits as JSON', () => {
    const allocation = { allocation: { require: { box: 'cold' } } };
    assert.deepEqual(draftsOf(allocation), { json: JSON.stringify({ require: { box: 'cold' } }, null, 4) });
    assert.equal(draftsAreValid(allocation, { json: '{' }), false);
    assert.deepEqual(withDrafts(allocation, { json: '{"require":{"box":"warm"}}' }), {
      allocation: { require: { box: 'warm' } },
    });

    const shrink = { shrink: { num_new_shards: 1, aliases: [{ a: {} }] } };
    assert.deepEqual(draftsOf(shrink), { aliases: JSON.stringify([{ a: {} }], null, 4), template: '' });
    assert.equal(draftsAreValid(shrink, { aliases: '', template: '' }), true);
    assert.equal(draftsAreValid(shrink, { aliases: '[', template: '' }), false);
    assert.deepEqual(withDrafts(shrink, { aliases: '', template: '{"source":"{{ctx.index}}_s"}' }), {
      shrink: { num_new_shards: 1, target_index_name_template: { source: '{{ctx.index}}_s' } },
    });

    assert.deepEqual(draftsOf({ rollover: {} }), {});
    assert.equal(draftsAreValid({ rollover: {} }, {}), true);
    assert.deepEqual(
      withDrafts({ convert_index_to_remote: { repository: 'r', snapshot: 's', rename_pattern: ' ' } }, {}),
      { convert_index_to_remote: { repository: 'r', snapshot: 's', rename_pattern: '$1_remote' } }
    );
  });
});

describe('a transition of a state', () => {
  it('starts with the condition of its kind', () => {
    assert.deepEqual(conditionsOf('min_index_age'), { min_index_age: '30d' });
    assert.deepEqual(conditionsOf('min_doc_count'), { min_doc_count: 1000000 });
    assert.equal(conditionsOf('none'), undefined);
    assert.equal(conditionKind({ state_name: 'cold', conditions: { min_size: '50gb' } }), 'min_size');
    assert.equal(conditionKind({ state_name: 'cold' }), 'none');
  });

  it('is described as the editor describes it', () => {
    assert.equal(conditionContent({ state_name: 'cold' }), 'No condition');
    assert.equal(conditionContent({ state_name: 'cold', conditions: { min_size: '50gb' } }), 'Minimum index size is 50gb');
    assert.equal(
      conditionContent({ state_name: 'cold', conditions: { min_doc_count: 5 } }),
      'Minimum index doc count is 5'
    );
    assert.equal(
      conditionContent({ state_name: 'cold', conditions: { min_rollover_age: '7d' } }),
      'Minimum rollover age is 7d'
    );
    assert.equal(
      conditionContent({ state_name: 'cold', conditions: conditionsOf('cron') }),
      'After cron expression "* 17 * * SAT" in America/Los_Angeles'
    );
  });
});

describe('the states of a policy', () => {
  const state = (name: string): State => ({ name, actions: [], transitions: [] });
  const hot = state('hot');
  const warm = state('warm');
  const cold = state('cold');
  const policy: Policy = { ...EMPTY_POLICY, default_state: 'hot', states: [hot, warm, cold] };

  it('proposes to put a new state after the last one', () => {
    assert.deepEqual(orderInfo(undefined, [hot, warm]), {
      order: 'after',
      afterBeforeState: 'warm',
      disableOrderSelections: false,
    });
    assert.deepEqual(orderInfo(undefined, []), { order: 'after', afterBeforeState: '', disableOrderSelections: true });
  });

  it('proposes to leave an edited state where it is', () => {
    assert.deepEqual(orderInfo(hot, [hot, warm]), {
      order: 'before',
      afterBeforeState: 'warm',
      disableOrderSelections: false,
    });
    assert.deepEqual(orderInfo(warm, [hot, warm]), {
      order: 'after',
      afterBeforeState: 'hot',
      disableOrderSelections: false,
    });
    assert.deepEqual(orderInfo(hot, [hot]), { order: 'after', afterBeforeState: '', disableOrderSelections: true });
  });

  it('puts a state before or after another', () => {
    const names = (states: State[]) => states.map((item) => item.name);
    const frozen = state('frozen');
    assert.deepEqual(names(updatedStates(frozen, undefined, [hot, warm], 'after', 'warm')), ['hot', 'warm', 'frozen']);
    assert.deepEqual(names(updatedStates(frozen, undefined, [hot, warm], 'before', 'hot')), ['frozen', 'hot', 'warm']);
    assert.deepEqual(names(updatedStates(frozen, undefined, [], 'after', '')), ['frozen']);
    // An edited state leaves its place and takes the new one
    assert.deepEqual(names(updatedStates(state('hot2'), hot, [hot, warm, cold], 'after', 'cold')), ['warm', 'cold', 'hot2']);
    assert.deepEqual(names(updatedStates(state('only2'), hot, [hot], 'after', '')), ['only2']);
  });

  it('starts in its first state, and follows the state it starts in when that is renamed', () => {
    const first = updatedPolicy(EMPTY_POLICY, hot, undefined, 'after', '');
    assert.equal(first.default_state, 'hot');
    const renamed = updatedPolicy(policy, state('hotter'), hot, 'before', 'warm');
    assert.equal(renamed.default_state, 'hotter');
    assert.deepEqual(
      renamed.states.map((item) => item.name),
      ['hotter', 'warm', 'cold']
    );
    assert.equal(updatedPolicy(policy, state('frozen'), undefined, 'after', 'cold').default_state, 'hot');
  });

  it('starts in the first state left when the one it started in is deleted', () => {
    const without = withoutState(policy, 0);
    assert.equal(without.default_state, 'warm');
    assert.deepEqual(
      without.states.map((item) => item.name),
      ['warm', 'cold']
    );
    assert.equal(withoutState(policy, 2).default_state, 'hot');
    assert.equal(withoutState({ ...policy, states: [hot] }, 0).default_state, '');
  });
});

/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { importedIndex } from '../../web/apps/index_management/index_model';
import {
  duplicateOf,
  indexOptions,
  notReadOnly,
  parseIndexNames,
  withoutOverlaps,
  withoutSystem,
  type IndexOption,
} from '../../web/apps/index_management/index_options';
import {
  JobScheduler,
  isStale,
  jobDone,
  onJobDone,
  type Clock,
  type Job,
  type JobHandler,
  type JobStore,
} from '../../web/apps/index_management/jobs';
import {
  DEFAULT_REINDEX_QUERY,
  destinationError,
  forceMergeBody,
  namesItself,
  reindexRequest,
  reindexSourceIndexes,
  reindexTarget,
  resizeBody,
  resizeEditorValue,
  resizeFromEditor,
  rolloverPayload,
  rolloverSourceType,
  rolloverSources,
  rolloverTarget,
  rolloverWriteIndex,
  segmentsError,
  shrinkBlocked,
  shrinkErrors,
  shrinkProblems,
  shrinkShardOptions,
  slicesError,
  sourceErrors,
  splitErrors,
  splitProblems,
  splitShardOptions,
} from '../../web/apps/index_management/operation_model';

// --- Work that goes on in the background ----------------------------------------------------------------

/** A clock the test moves by hand; what was set to run is run when its time has come */
class TestClock implements Clock {
  time = 1000;
  private next = 1;
  private readonly timers = new Map<number, { at: number; run: () => void }>();

  now = () => this.time;
  random = () => 0.5;
  setTimeout = (run: () => void, ms: number) => {
    const handle = this.next;
    this.next += 1;
    this.timers.set(handle, { at: this.time + ms, run });
    return handle;
  };
  clearTimeout = (handle: unknown) => {
    this.timers.delete(handle as number);
  };

  get pending() {
    return this.timers.size;
  }

  /** Lets the time pass, and waits for what the timers started */
  async advance(ms: number) {
    this.time += ms;
    for (const [handle, timer] of [...this.timers]) {
      if (timer.at <= this.time && this.timers.delete(handle)) timer.run();
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function memoryStore(): JobStore & { jobs: Job[] } {
  const store = {
    jobs: [] as Job[],
    all: () => store.jobs.map((job) => ({ ...job })),
    save: (jobs: Job[]) => {
      store.jobs = jobs.map((job) => ({ ...job }));
    },
  };
  return store;
}

function handler(answers: boolean[]): JobHandler & { checks: number; gaveUp: number } {
  const made = {
    checks: 0,
    gaveUp: 0,
    check: async () => {
      made.checks += 1;
      return answers.shift() ?? false;
    },
    timedOut: () => {
      made.gaveUp += 1;
    },
  };
  return made;
}

describe('the jobs of Index Management', () => {
  it('keeps a job, with an hour to finish unless told otherwise', () => {
    const clock = new TestClock();
    const store = memoryStore();
    const scheduler = new JobScheduler(store, {}, clock);
    const job = scheduler.add({ type: 'split', extras: { taskId: 't' }, interval: 30000 });
    assert.equal(job.id, '1000_5');
    assert.equal(job.createTime, 1000);
    assert.equal(job.timeout, 60 * 60 * 1000);
    assert.deepEqual(store.jobs, [job]);
    assert.equal(scheduler.add({ type: 'open', extras: {}, interval: 1, timeout: 5000, id: 'mine' }).timeout, 5000);
  });

  it('looks at a job after its interval, and again until the work is over', async () => {
    const clock = new TestClock();
    const store = memoryStore();
    const split = handler([false, true]);
    const scheduler = new JobScheduler(store, { split }, clock);
    scheduler.add({ type: 'split', extras: {}, interval: 30000 });
    await clock.advance(29999);
    assert.equal(split.checks, 0);
    await clock.advance(1);
    assert.equal(split.checks, 1);
    assert.equal(store.jobs.length, 1, 'the job is kept while the work goes on');
    assert.equal(store.jobs[0].latestRunTime, 31000);
    await clock.advance(30000);
    assert.equal(split.checks, 2);
    assert.deepEqual(store.jobs, []);
    assert.equal(clock.pending, 0);
  });

  it('looks sooner the first time when asked to', async () => {
    const clock = new TestClock();
    const open = handler([true]);
    const scheduler = new JobScheduler(memoryStore(), { open }, clock);
    scheduler.add({ type: 'open', extras: {}, interval: 30000, firstRunTimeout: 5000 });
    await clock.advance(5000);
    assert.equal(open.checks, 1);
  });

  it('takes a look that fails as work that goes on', async () => {
    const clock = new TestClock();
    const store = memoryStore();
    const reindex: JobHandler = {
      check: () => Promise.reject(new Error('no answer')),
      timedOut: () => undefined,
    };
    new JobScheduler(store, { reindex }, clock).add({ type: 'reindex', extras: {}, interval: 1000 });
    await clock.advance(1000);
    assert.equal(store.jobs.length, 1);
  });

  it('gives a job up once its time has passed', async () => {
    const clock = new TestClock();
    const store = memoryStore();
    const shrink = handler([false, false, false]);
    const scheduler = new JobScheduler(store, { shrink }, clock);
    scheduler.add({ type: 'shrink', extras: {}, interval: 1000, timeout: 1500 });
    await clock.advance(1000);
    await clock.advance(1000);
    assert.equal(shrink.checks, 2);
    assert.equal(shrink.gaveUp, 1, 'the second look came after the time the job was given');
    assert.deepEqual(store.jobs, []);
  });

  it('takes up the jobs a page opened earlier left', async () => {
    const clock = new TestClock();
    const store = memoryStore();
    store.jobs = [
      { id: 'kept', type: 'forceMerge', extras: {}, interval: 2000, createTime: 0, timeout: 100000 },
      { id: 'old', type: 'forceMerge', extras: {}, interval: 2000, createTime: 0, timeout: 10, latestRunTime: 500 },
    ];
    const forceMerge = handler([true]);
    new JobScheduler(store, { forceMerge }, clock).start();
    assert.equal(forceMerge.gaveUp, 1);
    assert.deepEqual(
      store.jobs.map((job) => job.id),
      ['kept']
    );
    await clock.advance(2000);
    assert.equal(forceMerge.checks, 1);
    assert.deepEqual(store.jobs, []);
  });

  it('knows a job whose last look came too late', () => {
    const job: Job = { id: 'a', type: 'open', extras: {}, interval: 1, createTime: 100, timeout: 50 };
    assert.equal(isStale(job), false);
    assert.equal(isStale({ ...job, latestRunTime: 150 }), false);
    assert.equal(isStale({ ...job, latestRunTime: 151 }), true);
  });

  it('tells the pages that listen when work is over', () => {
    let heard = 0;
    const stop = onJobDone('OPEN_COMPLETE', () => {
      heard += 1;
    });
    jobDone('OPEN_COMPLETE');
    jobDone('SPLIT_COMPLETE');
    stop();
    jobDone('OPEN_COMPLETE');
    assert.equal(heard, 1);
  });
});

// --- What an operation can be started on -------------------------------------------------------------

const found = indexOptions({
  indices: [
    { index: 'logs-1', status: 'open', health: 'green' },
    { index: '.kibana_1', status: 'open', health: 'green' },
  ],
  dataStreams: [{ name: 'stream', status: 'GREEN', indices: [{ index_name: '.ds-stream-000001' }, { index_name: '.ds-stream-000002' }] }],
  aliases: [
    { alias: 'both', index: 'logs-1' },
    { alias: 'both', index: 'logs-2', is_write_index: 'true' },
    { alias: 'one', index: 'logs-3' },
    { alias: 'unwritten', index: 'logs-4' },
    { alias: 'unwritten', index: 'logs-5' },
    { alias: '.kibana', index: '.kibana_1' },
  ],
});
const named = (label: string): IndexOption => {
  const option = found.find((item) => item.label === label);
  if (!option) throw new Error(`${label} is not among the options`);
  return option;
};

describe('the options of an index operation', () => {
  it('looks for a backing index by the name of its data stream', () => {
    assert.deepEqual(parseIndexNames('logs-1,.ds-stream-000002'), ['logs-1', 'stream']);
    assert.deepEqual(parseIndexNames(''), []);
    assert.deepEqual(parseIndexNames(undefined), []);
  });

  it('says what each name is, and where it writes to', () => {
    assert.deepEqual(named('logs-1'), { label: 'logs-1', group: 'indices', isIndex: true, status: 'open', health: 'green' });
    assert.deepEqual(named('stream'), {
      label: 'stream',
      group: 'dataStreams',
      isDataStream: true,
      health: 'green',
      indices: ['.ds-stream-000001', '.ds-stream-000002'],
      writingIndex: '.ds-stream-000002',
    });
    assert.equal(named('both').writingIndex, 'logs-2');
    assert.deepEqual(named('both').indices, ['logs-1', 'logs-2']);
    assert.equal(named('one').writingIndex, 'logs-3', 'an alias of one index writes to it');
    assert.equal(named('unwritten').writingIndex, undefined);
    assert.equal(found.filter((item) => item.label === 'both').length, 1);
  });

  it('leaves out what belongs to OpenSearch and its plugins', () => {
    const labels = withoutSystem(found).map((item) => item.label);
    assert.ok(!labels.includes('.kibana_1'));
    assert.ok(!labels.includes('.kibana'));
    assert.ok(labels.includes('logs-1'));
  });

  it('finds what would be read from and written to at once', () => {
    assert.equal(duplicateOf([named('logs-1')], [named('one')]), null);
    assert.equal(
      duplicateOf([named('both')], [named('both')]),
      'Index [both,logs-2] both exists in source and destination'
    );
    assert.equal(duplicateOf([named('stream')], [{ label: '.ds-stream-000001', group: 'indices', isIndex: true }]), 'Index [.ds-stream-000001] both exists in source and destination');
    // An alias is read from all its indexes, and written to through one
    assert.equal(duplicateOf([{ label: 'logs-1', group: 'indices', isIndex: true }], [named('both')]), null);
    assert.equal(
      duplicateOf([{ label: 'logs-2', group: 'indices', isIndex: true }], [named('both')]),
      'Index [logs-2] both exists in source and destination'
    );
  });

  it('offers only what does not overlap with the other side', () => {
    const offered = withoutOverlaps(found, [named('both')]).map((item) => item.label);
    assert.ok(!offered.includes('both'));
    assert.ok(!offered.includes('logs-1'), 'the other side reads logs-1 through the alias');
    assert.ok(offered.includes('one'));
    assert.ok(offered.includes('stream'));
    assert.equal(withoutOverlaps(found, undefined), found);
  });

  it('tells the indexes that can still be written to', () => {
    const settings = {
      a: { settings: { 'index.blocks.write': 'true' } },
      b: { settings: { 'index.blocks.read_only': 'true' } },
      c: { settings: { 'index.blocks.read_only_allow_delete': 'true' } },
      d: { settings: { 'index.blocks.write': 'false' } },
      e: { settings: {} },
      other: { settings: {} },
    };
    assert.deepEqual(notReadOnly(settings, ['a', 'b', 'c', 'd', 'e']), ['d', 'e']);
    assert.deepEqual(notReadOnly(undefined, ['a']), []);
  });
});

// --- Force merge, roll over ----------------------------------------------------------------------------

describe('force merge', () => {
  it('takes any whole number of segments from one up, or none', () => {
    assert.equal(segmentsError(undefined), undefined);
    assert.equal(segmentsError(1), undefined);
    assert.equal(segmentsError('12'), undefined);
    assert.equal(segmentsError('abc'), undefined, 'what is no number is no number of segments');
    assert.equal(segmentsError('0'), 'Must be an integer great than or equal to 1.');
    assert.equal(segmentsError('1.5'), 'Must be an integer great than or equal to 1.');
  });

  it('sends only the options that were set', () => {
    assert.deepEqual(forceMergeBody({ flush: true }), { flush: true });
    assert.deepEqual(forceMergeBody({ flush: false, max_num_segments: '3', only_expunge_deletes: true }), {
      flush: false,
      max_num_segments: '3',
      only_expunge_deletes: true,
    });
  });
});

describe('roll over', () => {
  const sources = rolloverSources(
    [
      { alias: 'logs', index: 'logs-000001' },
      { alias: 'logs', index: 'logs-000002', is_write_index: 'true' },
      { alias: 'single', index: 'only' },
      { alias: 'nowrite', index: 'a' },
      { alias: 'nowrite', index: 'b' },
    ],
    [{ name: 'stream' }]
  );

  it('knows what a source is and where it writes to', () => {
    assert.equal(rolloverSourceType(sources, 'logs'), 'alias');
    assert.equal(rolloverSourceType(sources, 'stream'), 'dataStreams');
    assert.equal(rolloverSourceType(sources, 'nothing'), undefined);
    assert.equal(rolloverWriteIndex(sources, 'logs'), 'logs-000002');
    assert.equal(rolloverWriteIndex(sources, 'single'), 'only');
    assert.equal(rolloverWriteIndex(sources, 'nowrite'), '');
    assert.equal(rolloverWriteIndex(sources, 'stream'), '');
  });

  it('knows an index whose next name OpenSearch can make', () => {
    assert.equal(namesItself('logs-000002'), true);
    assert.equal(namesItself('logs-1'), true);
    assert.equal(namesItself('logs'), false);
    assert.equal(namesItself('logs-1a'), false);
  });

  it('describes the new index of an alias, and nothing for a data stream', () => {
    assert.deepEqual(rolloverPayload('logs', 'alias', { index: 'logs-000003', settings: { 'index.number_of_shards': 1 } }), {
      alias: 'logs',
      newIndex: 'logs-000003',
      body: { settings: { 'index.number_of_shards': 1 } },
    });
    assert.deepEqual(rolloverPayload('logs', 'alias', { settings: {} }), { alias: 'logs', body: { settings: {} } });
    assert.deepEqual(rolloverPayload('stream', 'dataStreams', { index: 'x', settings: {} }), { alias: 'stream', body: {} });
    assert.deepEqual(rolloverPayload(undefined, undefined, undefined), { alias: '', body: {} });
  });

  it('leaves out a mapping that says nothing', () => {
    assert.deepEqual(rolloverTarget({ index: 'n', settings: { a: 1 }, mappings: { properties: [] } }), {
      index: 'n',
      settings: { a: 1 },
    });
    assert.deepEqual(
      rolloverTarget({
        index: 'n',
        mappings: { properties: [{ fieldName: 'name', type: 'keyword' }] },
      }),
      { index: 'n', mappings: { properties: { name: { type: 'keyword' } } } }
    );
  });
});

// --- Split and shrink -----------------------------------------------------------------------------------

describe('split and shrink', () => {
  it('offers the numbers of shards an index can be split into', () => {
    const fromOne = splitShardOptions(1);
    assert.equal(fromOne[0], '2');
    assert.equal(fromOne.length, 1023);
    assert.deepEqual(splitShardOptions(3), ['6', '12', '24', '48', '96', '192', '384', '768']);
    assert.deepEqual(splitShardOptions(600), []);
    assert.deepEqual(splitShardOptions(Number.NaN), []);
  });

  it('offers the numbers of shards an index can be shrunk to', () => {
    assert.deepEqual(shrinkShardOptions(6), ['1', '2', '3', '6']);
    assert.deepEqual(shrinkShardOptions(1), ['1']);
  });

  it('says what is wrong with a split', () => {
    assert.deepEqual(splitErrors({}, ['2']), {
      targetIndex: 'Target index name is required',
      'index.number_of_shards': 'Number of shards is required',
    });
    assert.deepEqual(splitErrors({ targetIndex: 'Bad', 'index.number_of_shards': '3' }, ['2', '4']), {
      targetIndex: 'Target index name Bad is invalid',
      'index.number_of_shards': 'Number of shards 3 is invalid',
    });
    assert.deepEqual(splitErrors({ targetIndex: 'fine', 'index.number_of_shards': '4' }, ['2', '4']), {});
  });

  it('says every rule a field of a shrink breaks', () => {
    assert.deepEqual(shrinkErrors({ 'index.number_of_shards': 1, 'index.number_of_replicas': 1 }, 2), {
      targetIndex: ['Target index name required.', 'Invalid target index name.'],
    });
    assert.deepEqual(shrinkErrors({ targetIndex: 'Bad_Name', 'index.number_of_shards': '2', 'index.number_of_replicas': '' }, 3), {
      targetIndex: ['Invalid target index name.'],
      'index.number_of_shards': [
        'The number of primary shards in the new shrunken index  must be a positive factor of the number of primary shards in the source index.',
      ],
      'index.number_of_replicas': ['Number of replicas must be greater than or equal to 0.'],
    });
    assert.deepEqual(shrinkErrors({ targetIndex: 'small', 'index.number_of_shards': '3', 'index.number_of_replicas': '0' }, 3), {});
  });

  it('sends the settings of the new index, and its aliases apart', () => {
    const values = { targetIndex: 'new', 'index.number_of_shards': '2', aliases: { a: {} } };
    assert.deepEqual(resizeBody(values), { settings: { 'index.number_of_shards': '2' }, aliases: { a: {} } });
    assert.deepEqual(JSON.parse(JSON.stringify(resizeBody({ targetIndex: 'new', 'index.number_of_replicas': 1 }))), {
      settings: { 'index.number_of_replicas': 1 },
    });
  });

  it('shows all the settings but the name in the editor, and keeps the name when they change', () => {
    const values = { targetIndex: 'new', 'index.number_of_shards': '2' };
    assert.deepEqual(resizeEditorValue(values), { 'index.number_of_shards': '2' });
    assert.deepEqual(resizeFromEditor(values, { 'index.codec': 'best_compression', targetIndex: 'typed' }), {
      'index.codec': 'best_compression',
      targetIndex: 'new',
    });
    assert.deepEqual(resizeFromEditor({}, { a: 1 }), { a: 1 });
  });

  it('says what stands in the way of a split', () => {
    assert.deepEqual(splitProblems({ health: 'green', status: 'open' }, { 'index.blocks.write': 'true' }), []);
    assert.deepEqual(splitProblems({ health: 'red', status: 'close' }, {}), ['red', 'closed', 'writable']);
    assert.deepEqual(splitProblems({ health: 'green' }, undefined), [], 'nothing is said before the settings are known');
  });

  it('says what stands in the way of a shrink, the worst first', () => {
    assert.deepEqual(shrinkProblems({ health: 'red', pri: '1' }, {}), ['red', 'oneShard']);
    assert.deepEqual(shrinkProblems({ health: 'green', pri: '2', status: 'close' }, {}), ['writable', 'closed']);
    const warned = shrinkProblems(
      { health: 'yellow', pri: '2', status: 'open' },
      { 'index.blocks.write': true, 'index.blocks.read_only': 'true' }
    );
    assert.deepEqual(warned, ['yellow', 'readOnly']);
    assert.equal(shrinkBlocked(warned), false);
    assert.equal(shrinkBlocked(['writable']), true);
    assert.equal(shrinkBlocked([]), false);
  });
});

// --- Reindex ------------------------------------------------------------------------------------------

describe('reindex', () => {
  const index = (label: string, more: Partial<IndexOption> = {}): IndexOption => ({
    label,
    group: 'indices',
    isIndex: true,
    ...more,
  });

  it('takes the numbers of subtasks OpenSearch Dashboards takes', () => {
    assert.equal(slicesError(undefined), undefined);
    assert.equal(slicesError('auto'), undefined);
    assert.equal(slicesError('2'), undefined);
    assert.equal(slicesError('25'), undefined);
    assert.equal(slicesError(''), 'Must be an integer greater than or equal to 2.');
    assert.equal(slicesError('1'), 'Must be an integer greater than or equal to 2.');
    assert.equal(slicesError('12'), 'Must be an integer greater than or equal to 2.');
    assert.equal(slicesError('2.5'), 'Must be an integer greater than or equal to 2.');
  });

  it('says what is wrong with the sources', () => {
    assert.deepEqual(sourceErrors([], undefined), ['Source is required.']);
    const sources = [index('red', { health: 'red' }), index('shut', { status: 'close' }), index('bare'), index('fine')];
    const mappings = {
      bare: { mappings: { _source: { full_name: '_source', mapping: { _source: { enabled: false } } } } },
      fine: { mappings: {} },
    };
    assert.deepEqual(sourceErrors(sources, mappings), [
      'Index [red] health status is red.',
      'Index [shut] status is closed.',
      'Index [bare] _sources is not enabled',
    ]);
    assert.deepEqual(sourceErrors([index('fine')], undefined), []);
  });

  it('says what is wrong with the destination', () => {
    assert.equal(destinationError([], []), 'Destination is required.');
    assert.equal(destinationError([index('a'), index('b')], []), 'Destination is required.');
    assert.equal(destinationError([index('a', { health: 'red' })], []), 'Index [a] health status is red.');
    assert.equal(destinationError([index('a', { status: 'close' })], []), 'Index [a] status is closed.');
    assert.equal(
      destinationError([named('unwritten')], []),
      "Alias [unwritten] don't have writing index behind it."
    );
    assert.equal(destinationError([index('a')], [index('a')]), 'Index [a] both exists in source and destination');
    assert.equal(destinationError([index('a')], [index('b')]), undefined);
  });

  it('offers the indexes behind the sources to take settings from', () => {
    assert.deepEqual(reindexSourceIndexes([named('logs-1'), named('both'), named('stream')]), [
      'logs-1',
      'logs-1',
      'logs-2',
      '.ds-stream-000002',
    ]);
  });

  it('writes the request that copies everything as it is', () => {
    assert.deepEqual(reindexRequest({ sources: [index('a'), index('b')], destination: index('c') }), {
      path: '_reindex?slices=1&wait_for_completion=false',
      body: { conflicts: 'abort', source: { index: 'a,b' }, dest: { index: 'c', op_type: 'index' } },
    });
  });

  it('writes the request with a query, parts, a pipeline and what to do about conflicts', () => {
    assert.deepEqual(
      reindexRequest({
        sources: [index('a')],
        destination: index('c'),
        slices: 'auto',
        subset: true,
        query: '{"query":{"term":{"n":2}}}',
        pipeline: 'clean',
        ignoreConflicts: true,
        uniqueOnly: true,
      }),
      {
        path: '_reindex?slices=auto&wait_for_completion=false',
        body: {
          conflicts: 'proceed',
          source: { index: 'a', query: { term: { n: 2 } } },
          dest: { index: 'c', op_type: 'create', pipeline: 'clean' },
        },
      }
    );
    // A query that is not asked for is not sent
    assert.deepEqual(reindexRequest({ sources: [index('a')], destination: index('c'), query: DEFAULT_REINDEX_QUERY }).body.source, {
      index: 'a',
    });
    assert.equal(reindexRequest({ sources: [index('a')], destination: index('c'), slices: '5' }).path, '_reindex?slices=5&wait_for_completion=false');
  });

  it('only adds to a data stream', () => {
    const request = reindexRequest({ sources: [index('a')], destination: named('stream') });
    assert.deepEqual(request.body.dest, { index: 'stream', op_type: 'create' });
  });

  it('knows where the copy was written to', () => {
    assert.deepEqual(reindexTarget(index('c')), { destType: 'index', writingIndex: 'c' });
    assert.deepEqual(reindexTarget(named('both')), { destType: 'other', writingIndex: 'logs-2' });
    assert.deepEqual(reindexTarget(named('stream')), { destType: 'other', writingIndex: '.ds-stream-000002' });
  });
});

// --- The settings of another index ------------------------------------------------------------------

describe('the settings and mapping taken from another index', () => {
  it('takes the three settings of the form and the mapping, and neither the aliases nor the data stream', () => {
    const taken = importedIndex(
      {
        aliases: { old: {} },
        data_stream: 'stream',
        settings: {
          'index.number_of_shards': '2',
          'index.number_of_replicas': '0',
          'index.uuid': 'abc',
          'index.creation_date': '1',
        },
        mappings: { properties: { name: { type: 'keyword' } } },
      },
      'new'
    );
    assert.equal(taken.index, 'new');
    assert.deepEqual(taken.settings, { 'index.number_of_replicas': '0', 'index.number_of_shards': '2' });
    assert.equal('aliases' in taken, false);
    assert.equal('data_stream' in taken, false);
    assert.deepEqual(taken.mappings?.properties, [{ fieldName: 'name', type: 'keyword' }]);
  });
});

/* SPDX-License-Identifier: Apache-2.0 */

/*
 * What is said when work in the background ends: a message that stays for days, naming the
 * indexes it is about. The jobs are kept in the browser under the name the plugin keeps them.
 */

import { useState, type ReactNode } from 'react';
import { Button } from '../../components/basic';
import { Modal } from '../../components/overlay';
import { ism, to, toasts } from './common';
import { JobScheduler, jobDone, type Job, type JobHandler, type JobStore, type JobType, type NewJob } from './jobs';
import { ROUTES } from './routes';

const FIVE_DAYS = 1000 * 60 * 60 * 24 * 5;
const STORAGE_KEY = 'OSD_VERSION_3.9.0_ISM_JOBS';

// --- The parts of a message ---------------------------------------------------------------------------

export interface ClusterInfo {
  cluster_name?: string;
}

/** The cluster of the work, which its messages name before every index */
export async function clusterInfo(): Promise<ClusterInfo> {
  const answer = await ism.call<ClusterInfo>('cluster.health');
  return answer.ok ? { cluster_name: answer.response?.cluster_name } : {};
}

function Resource({ name, cluster }: { name: string; cluster?: ClusterInfo }) {
  return <>{cluster?.cluster_name ? `${cluster.cluster_name}/${name}` : name}</>;
}

function Resources({ names, cluster }: { names: string[]; cluster?: ClusterInfo }) {
  return (
    <>
      {names.map((name, index) => (
        <span key={name}>
          {index > 0 && ', '}
          <Resource name={name} cluster={cluster} />
        </span>
      ))}
    </>
  );
}

function DetailLink({ index, cluster }: { index: string; cluster?: ClusterInfo }) {
  return (
    <a href={to(`${ROUTES.INDEX_DETAIL}/${index}`)}>
      <Resource name={index} cluster={cluster} />
    </a>
  );
}

function DetailLinks({ indexes, cluster }: { indexes: string[]; cluster?: ClusterInfo }) {
  return (
    <>
      {indexes.map((index, at) => (
        <span key={index}>
          {at > 0 && ', '}
          <DetailLink index={index} cluster={cluster} />
        </span>
      ))}
    </>
  );
}

/** What went wrong in short, with a button for all of it */
function ErrorContent({ short, full }: { short?: ReactNode; full?: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div>{short}</div>
      {full ? (
        <>
          <Button size="s" variant="danger" onClick={() => setOpen(true)}>
            See full error
          </Button>
          {open && (
            <Modal
              title={short || ''}
              onClose={() => setOpen(false)}
              footer={
                <Button variant="primary" size="s" onClick={() => setOpen(false)}>
                  Close
                </Button>
              }
            >
              {full}
            </Modal>
          )}
        </>
      ) : null}
    </div>
  );
}

const Long = ({ children }: { children: ReactNode }) => (
  <div style={{ maxHeight: '30vh', overflowY: 'auto' }}>{children}</div>
);

// --- The message that the work has started ----------------------------------------------------------------

// A message is known by its number on the page that showed it, and by nothing on a page opened later
const SESSION = `${Date.now()}`;

/** Says that work has started, in a message that stays until the work is over */
export function startedToast(text: string): string {
  return `${SESSION}:${toasts.success(text, undefined, FIVE_DAYS)}`;
}

function dismissStarted(toastId: unknown) {
  if (typeof toastId !== 'string' || !toastId.startsWith(`${SESSION}:`)) return;
  toasts.remove(Number(toastId.slice(SESSION.length + 1)));
}

// --- Looking at the work ----------------------------------------------------------------------------------

interface Task {
  completed?: boolean;
  error?: { reason?: string };
  response?: Record<string, unknown>;
}

interface Extras {
  clusterInfo?: ClusterInfo;
  toastId?: string;
  taskId?: string;
  sourceIndex?: string | string[];
  destIndex?: string;
  writingIndex?: string;
  indexes?: string[];
}

const extrasOf = (job: Job) => job.extras as Extras;
const one = (value: string | string[] | undefined): string => (Array.isArray(value) ? value.join(',') : (value ?? ''));
const many = (value: string | string[] | undefined): string[] =>
  Array.isArray(value) ? value : value === undefined ? [] : [value];

async function taskOf(job: Job): Promise<Task | undefined> {
  const answer = await ism.request<Task>('GET', `/_tasks/${extrasOf(job).taskId}`);
  return answer.ok ? (answer.response ?? {}) : undefined;
}

const useTasks = (taskId: unknown) => <>To see the latest status, use `GET /_tasks/{String(taskId)}`</>;

const reindex: JobHandler = {
  async check(job) {
    const extras = extrasOf(job);
    const task = await taskOf(job);
    if (!task?.completed) return false;
    const source = <Resource name={one(extras.sourceIndex)} cluster={extras.clusterInfo} />;
    const failures = (task.response?.failures ?? []) as Array<{ id?: string; cause?: { reason?: string } }>;
    const canceled = task.response?.canceled as string | undefined;
    dismissStarted(extras.toastId);
    if (canceled) {
      toasts.danger(
        <>Reindex operation on {source} has been cancelled</>,
        `The reindex job has been cancelled ${canceled}.`,
        FIVE_DAYS
      );
      return true;
    }
    if (failures.length > 0 || task.error?.reason) {
      toasts.danger(
        <>Reindex operation on {source} has failed</>,
        <ErrorContent
          short={task.error?.reason || <>{failures.length} error(s) were found</>}
          full={
            failures.length > 0 ? (
              <ul>
                {failures.map((item) => (
                  <li key={item.id}>
                    {item.id || ''}: {item.cause?.reason}
                  </li>
                ))}
              </ul>
            ) : undefined
          }
        />,
        FIVE_DAYS
      );
      return true;
    }
    jobDone('REINDEX_COMPLETE');
    toasts.success(
      <>Reindex operation on {source} has been completed.</>,
      <>
        The reindexed index is <DetailLink index={extras.writingIndex ?? ''} cluster={extras.clusterInfo} />.
      </>,
      FIVE_DAYS
    );
    return true;
  },
  timedOut(job) {
    const extras = extrasOf(job);
    dismissStarted(extras.toastId);
    toasts.warning(
      <>
        Reindex on <Resource name={one(extras.sourceIndex)} cluster={extras.clusterInfo} /> has timed out.
      </>,
      <>The reindex operation has taken more than one hour to complete. {useTasks(extras.taskId)}</>,
      FIVE_DAYS
    );
  },
};

/** A split and a shrink end alike, but for their words */
function resize(
  name: 'Split' | 'Shrink',
  made: string,
  event: 'SPLIT_COMPLETE' | 'SHRINK_COMPLETE',
  failedAsLink: boolean
): JobHandler {
  return {
    async check(job) {
      const extras = extrasOf(job);
      if (!extras.taskId) return false;
      const task = await taskOf(job);
      if (!task?.completed) return false;
      const source = one(extras.sourceIndex);
      dismissStarted(extras.toastId);
      if (!task.error?.reason) {
        jobDone(event);
        toasts.success(
          <>
            {name} operation on <DetailLink index={source} cluster={extras.clusterInfo} /> has been completed.
          </>,
          <>
            The {made} index is <DetailLink index={extras.destIndex ?? ''} cluster={extras.clusterInfo} />.
          </>,
          FIVE_DAYS
        );
      } else {
        toasts.danger(
          <>
            {name} operation on{' '}
            {failedAsLink ? (
              <DetailLink index={source} cluster={extras.clusterInfo} />
            ) : (
              <Resource name={source} cluster={extras.clusterInfo} />
            )}{' '}
            has failed.
          </>,
          <Long>{task.error.reason}</Long>,
          FIVE_DAYS
        );
      }
      return true;
    },
    timedOut(job) {
      const extras = extrasOf(job);
      dismissStarted(extras.toastId);
      toasts.warning(
        <>
          {name} operation on <DetailLink index={one(extras.sourceIndex)} cluster={extras.clusterInfo} /> has timed
          out.
        </>,
        <>
          The {name.toLowerCase()} operation has taken more than one hour to complete. {useTasks(extras.taskId)}
        </>,
        FIVE_DAYS
      );
    },
  };
}

const forceMerge: JobHandler = {
  async check(job) {
    const extras = extrasOf(job);
    const task = await taskOf(job);
    if (!task?.completed) return false;
    const sources = <Resources names={many(extras.sourceIndex)} cluster={extras.clusterInfo} />;
    dismissStarted(extras.toastId);
    if (task.error?.reason) {
      toasts.danger(
        <>Force merge from {sources} has some errors, please check the errors below:</>,
        <Long>
          <ul>
            <li>{task.error.reason}</li>
          </ul>
        </Long>,
        FIVE_DAYS
      );
      return true;
    }
    jobDone('FORCE_MERGE_COMPLETE');
    const shards = (task.response?._shards ?? {}) as {
      successful?: number;
      total?: number;
      failures?: Array<{ shard?: number; index?: string; status?: string }>;
    };
    const successful = shards.successful ?? 0;
    const total = shards.total ?? 0;
    if (successful === total) {
      toasts.success(<>The indexes {sources} are successfully force merged.</>, undefined, FIVE_DAYS);
      return true;
    }
    toasts.warning(
      <>Some shards of {sources}could not be force merged.</>,
      <ErrorContent
        short={
          <>
            {total - successful} out of {total} could not be force merged.
          </>
        }
        full={
          <>
            <div>The following reasons may prevent shards from performing a force merge:</div>
            <ul>
              {(shards.failures ?? []).map((item) => (
                <li key={`${item.index}-${item.shard}-${item.status}`}>
                  The shard {item.shard} of index {item.index} failed to merge because of {item.status}.
                </li>
              ))}
              <li>Some shards are unassigned.</li>
              <li>
                Insufficient disk space: Force merging requires disk space to create a new, larger segment. If the
                disk does not have enough space, the merge process may fail.
              </li>
              <li>
                Index read-only: If the index is marked as read-only, a force merge operation cannot modify the
                index, and the merge process will fail.
              </li>
              <li>
                Too many open files: The operating system may limit the number of files that a process can have open
                simultaneously, and a force merge operation may exceed this limit, causing the merge process to fail.
              </li>
              <li>
                Index corruption: If the index is corrupted or has some inconsistencies, the force merge operation
                may fail.
              </li>
            </ul>
          </>
        }
      />,
      FIVE_DAYS
    );
    return true;
  },
  timedOut(job) {
    const extras = extrasOf(job);
    dismissStarted(extras.toastId);
    toasts.warning(
      <>
        Force merging <Resources names={many(extras.sourceIndex)} cluster={extras.clusterInfo} /> has failed.
      </>,
      <>The force merge operation has taken more than one hour to complete. {useTasks(extras.taskId)}</>,
      FIVE_DAYS
    );
  },
};

const open: JobHandler = {
  async check(job) {
    const extras = extrasOf(job);
    const task = await taskOf(job);
    if (!task?.completed) return false;
    const links = <DetailLinks indexes={extras.indexes ?? []} cluster={extras.clusterInfo} />;
    if (task.response?.acknowledged && task.response?.shards_acknowledged) {
      dismissStarted(extras.toastId);
      jobDone('OPEN_COMPLETE');
      toasts.success(<>{links} have been opened.</>, undefined, FIVE_DAYS);
      return true;
    }
    if (task.error?.reason) {
      dismissStarted(extras.toastId);
      toasts.danger(
        <>{links} has failed to open.</>,
        <ErrorContent full={<Long>{task.error.reason}</Long>} />,
        FIVE_DAYS
      );
      return true;
    }
    return false;
  },
  timedOut(job) {
    const extras = extrasOf(job);
    dismissStarted(extras.toastId);
    toasts.warning(
      <>
        Opening the index(es) <DetailLinks indexes={extras.indexes ?? []} cluster={extras.clusterInfo} /> has timed out
      </>,
      <>Opening the index has taken more than one hour to complete. {useTasks(extras.taskId)}</>,
      FIVE_DAYS
    );
  },
};

const HANDLERS: Record<JobType, JobHandler> = {
  reindex,
  split: resize('Split', 'split', 'SPLIT_COMPLETE', true),
  shrink: resize('Shrink', 'shrunken', 'SHRINK_COMPLETE', false),
  forceMerge,
  open,
};

// --- Keeping the jobs ------------------------------------------------------------------------------------

// What a browser that keeps nothing is left with: the jobs of the page that is open
let unkept: Job[] | undefined;

const browserStore: JobStore = {
  all() {
    if (unkept) return unkept;
    try {
      const kept: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(kept) ? (kept as Job[]) : [];
    } catch {
      return [];
    }
  },
  save(jobs) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs));
    } catch {
      unkept = jobs;
    }
  },
};

let scheduler: JobScheduler | undefined;

function jobs(): JobScheduler {
  scheduler ??= new JobScheduler(browserStore, HANDLERS, {
    now: () => Date.now(),
    random: () => Math.random(),
    setTimeout: (run, ms) => window.setTimeout(run, ms),
    clearTimeout: (handle) => window.clearTimeout(handle as number | undefined),
  });
  return scheduler;
}

/** Takes up the jobs a page opened earlier left behind */
export function startJobs() {
  jobs().start();
}

export function addJob(job: NewJob) {
  return jobs().add(job);
}

/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Work OpenSearch goes on with after its request is answered: a reindex, a split, a shrink, a
 * force merge, the opening of an index. Each is a job that is looked at again every so often,
 * until it is over or an hour has passed, and that is kept in the browser, so that a page
 * opened later still tells how the work ended.
 */

export type JobType = 'reindex' | 'split' | 'shrink' | 'forceMerge' | 'open';

export interface Job {
  id: string;
  type: JobType;
  /** What the one who looks at the work needs: the task, the indexes, the message to take away */
  extras: Record<string, unknown>;
  /** How long to wait between two looks, in milliseconds */
  interval: number;
  createTime: number;
  /** How long after it was made the job is given up, in milliseconds */
  timeout: number;
  latestRunTime?: number;
}

export type NewJob = Pick<Job, 'type' | 'extras' | 'interval'> &
  Partial<Job> & {
    /** A first look sooner than the interval */
    firstRunTimeout?: number;
  };

export interface JobStore {
  all(): Job[];
  save(jobs: Job[]): void;
}

export interface JobHandler {
  /** Looks at the work, and says whether the job is over */
  check(job: Job): Promise<boolean>;
  /** Told that the job is given up */
  timedOut(job: Job): void;
}

export interface Clock {
  now(): number;
  random(): number;
  setTimeout(run: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const HOUR = 60 * 60 * 1000;

/** Whether the last look at a job came after the time it was given */
export const isStale = (job: Job): boolean =>
  job.latestRunTime !== undefined && job.timeout + job.createTime < job.latestRunTime;

export class JobScheduler {
  private readonly waiting = new Map<string, unknown>();

  constructor(
    private readonly store: JobStore,
    private readonly handlers: Partial<Record<JobType, JobHandler>>,
    private readonly clock: Clock
  ) {}

  /** Takes up the jobs that were kept */
  start() {
    this.loop();
  }

  add(job: NewJob): Job {
    const { firstRunTimeout, ...others } = job;
    const made: Job = {
      ...others,
      id: others.id ?? `${this.clock.now()}_${Math.floor(this.clock.random() * 10)}`,
      createTime: others.createTime ?? this.clock.now(),
      timeout: others.timeout || HOUR,
    };
    if (this.waiting.has(made.id)) return made;
    this.store.save([...this.store.all().filter((kept) => kept.id !== made.id), made]);
    if (firstRunTimeout) this.clock.setTimeout(() => void this.run(made.id), firstRunTimeout);
    this.loop();
    return made;
  }

  remove(id: string) {
    this.clock.clearTimeout(this.waiting.get(id));
    this.waiting.delete(id);
    this.store.save(this.store.all().filter((kept) => kept.id !== id));
  }

  private get(id: string): Job | undefined {
    return this.store.all().find((kept) => kept.id === id);
  }

  /** Sets every job that is not waiting yet to be looked at after its interval */
  private loop() {
    for (const job of this.store.all()) {
      if (isStale(job)) {
        this.giveUp(job.id);
      } else if (!this.waiting.has(job.id)) {
        const look = () => {
          if (isStale(job)) this.giveUp(job.id);
          else void this.run(job.id);
        };
        this.waiting.set(job.id, this.clock.setTimeout(look, job.interval));
      }
    }
  }

  private giveUp(id: string) {
    const job = this.get(id);
    if (job) {
      try {
        this.handlers[job.type]?.timedOut(job);
      } catch {
        // A job is given up whatever its last message does
      }
    }
    this.remove(id);
  }

  private async run(id: string) {
    const job = this.get(id);
    if (!job) return;
    job.latestRunTime = this.clock.now();
    let over = false;
    try {
      over = (await this.handlers[job.type]?.check(job)) === true;
    } catch {
      over = false;
    }
    this.remove(id);
    if (!over) this.add(job);
  }
}

// --- Telling the pages that something is over -----------------------------------------------------------

export type JobEvent =
  | 'REINDEX_COMPLETE'
  | 'SPLIT_COMPLETE'
  | 'SHRINK_COMPLETE'
  | 'FORCE_MERGE_COMPLETE'
  | 'OPEN_COMPLETE';

type Listener = () => void;
const listeners = new Map<string, Set<Listener>>();

/** Hears of work that finished in the background: an index opened, a reindex done */
export function onJobDone(event: JobEvent, listener: Listener): () => void {
  const set = listeners.get(event) ?? new Set<Listener>();
  listeners.set(event, set);
  set.add(listener);
  return () => set.delete(listener);
}

export function jobDone(event: JobEvent) {
  for (const listener of [...(listeners.get(event) ?? [])]) listener();
}

// --- Asking again as the lists of the plugin do --------------------------------------------------------

/**
 * A function that runs at once when it has not been called for `wait` milliseconds, and once
 * more `wait` milliseconds after the last of the calls that came meanwhile, with that call's
 * arguments: lodash's `debounce(run, wait, { leading: true })`, by which the plugin's lists ask
 * for their rows.
 */
export function leadingDebounce<Args extends unknown[]>(
  run: (...args: Args) => void,
  wait: number,
  clock: Pick<Clock, 'setTimeout' | 'clearTimeout'>
): { call: (...args: Args) => void; cancel: () => void } {
  let timer: unknown;
  let pending: Args | undefined;
  const expire = () => {
    timer = undefined;
    if (pending) {
      const args = pending;
      pending = undefined;
      run(...args);
    }
  };
  return {
    call: (...args: Args) => {
      if (timer === undefined) {
        pending = undefined;
        run(...args);
      } else {
        clock.clearTimeout(timer);
        pending = args;
      }
      timer = clock.setTimeout(expire, wait);
    },
    cancel: () => {
      if (timer !== undefined) clock.clearTimeout(timer);
      timer = undefined;
      pending = undefined;
    },
  };
}

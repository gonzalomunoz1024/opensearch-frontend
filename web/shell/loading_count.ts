/* SPDX-License-Identifier: Apache-2.0 */

/*
 * How many requests are under way, as the original's loading count: while there is one, the home
 * link of the header shows a spinner in place of the logo.
 */

import { useSyncExternalStore } from 'react';
import type { FetchOptions, Http } from '../services/http';

let count = 0;
const listeners = new Set<() => void>();

function change(by: number) {
  count = Math.max(0, count + by);
  for (const listener of [...listeners]) listener();
}

/** The requests under way now */
export function loadingCount(): number {
  return count;
}

export function subscribeLoadingCount(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Counts something as under way until it settles, whichever way */
export function trackLoading<T>(work: Promise<T>): Promise<T> {
  change(1);
  const done = () => change(-1);
  work.then(done, done);
  return work;
}

const counted = new WeakSet<Http>();

/** Counts every request the product's one way to the server makes, from now on */
export function countRequests(http: Http) {
  if (counted.has(http)) return;
  counted.add(http);
  const fetch = http.fetch;
  http.fetch = function <T = unknown>(this: Http, path: string, options?: FetchOptions): Promise<T> {
    return trackLoading(fetch.call(this, path, options) as Promise<T>);
  };
}

export function useLoadingCount(): number {
  return useSyncExternalStore(subscribeLoadingCount, loadingCount);
}

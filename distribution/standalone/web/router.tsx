/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Where the browser is, as something React can read and change. Every page reads its place and
 * its state from the address, so that the address is always enough to come back to what is on
 * screen.
 */

import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import {
  buildHash,
  decodeState,
  encodeState,
  parseLocation,
  type AppLocation,
} from './lib/url';

let basePath = '';
let current: AppLocation = { pathname: '/', search: '', hashPath: '/', hashParams: {} };
let currentKey = '';
const listeners = new Set<() => void>();
// What asks before the page is left: an editor with changes that are not saved
let leaveGuard: (() => boolean) | undefined;

function read() {
  const key = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (key === currentKey) return;
  currentKey = key;
  current = parseLocation(basePath, window.location);
}

function emit() {
  read();
  for (const listener of [...listeners]) listener();
}

export function startRouter(base: string) {
  basePath = base;
  read();
  window.addEventListener('popstate', emit);
  window.addEventListener('hashchange', emit);
  // A link to a page of this product, wherever it is drawn (a markdown panel too), moves within
  // the page already loaded
  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = (event.target as Element | null)?.closest?.('a');
    if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return;
    const href = anchor.getAttribute('href');
    if (!href) return;
    const url = new URL(href, window.location.href);
    if (url.origin !== window.location.origin) return;
    const path = url.pathname.startsWith(basePath) ? url.pathname.slice(basePath.length) : null;
    if (path === null || !(path === '/' || path.startsWith('/app/') || path === '/app')) return;
    event.preventDefault();
    navigate(`${path}${url.search}${url.hash}`);
  });
}

export function setLeaveGuard(guard: (() => boolean) | undefined) {
  leaveGuard = guard;
}

/** The address of a path of this product, with the base path a proxy may have put in front */
export function href(url: string): string {
  return `${basePath}${url}`;
}

export function getLocation(): AppLocation {
  return current;
}

/** Goes to a path of this product: `/app/dashboards#/view/<id>` */
export function navigate(url: string, options: { replace?: boolean; force?: boolean } = {}) {
  const target = href(url);
  const from = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (target === from) return;
  const leavesPage =
    new URL(target, window.location.href).pathname !== window.location.pathname ||
    new URL(target, window.location.href).hash.split('?')[0] !== window.location.hash.split('?')[0];
  if (leavesPage && !options.force && leaveGuard && !leaveGuard()) return;
  if (options.replace) window.history.replaceState(null, '', target);
  else window.history.pushState(null, '', target);
  emit();
}

/** Changes the fragment's path and query, and keeps the application */
export function navigateHash(
  hashPath: string,
  params: Record<string, string | undefined> = {},
  options: { replace?: boolean } = {}
) {
  const search = current.search ? `?${current.search}` : '';
  navigate(`${current.pathname}${search}${buildHash(hashPath, params)}`, options);
}

export function setHashParams(
  changes: Record<string, string | undefined>,
  options: { replace?: boolean } = {}
) {
  navigateHash(current.hashPath, { ...current.hashParams, ...changes }, options);
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function useLocation(): AppLocation {
  return useSyncExternalStore(subscribe, getLocation);
}

/**
 * One state object of the address (`_g`, `_a`, `_q`), read as rison over defaults. Setting it
 * writes the address; by default that replaces the entry in the history, as typing in a query
 * should not fill the back button.
 */
export function useUrlState<T extends object>(
  key: string,
  defaults: T
): [T, (patch: Partial<T>, options?: { replace?: boolean }) => void] {
  const location = useLocation();
  const raw = location.hashParams[key];
  const defaultsRef = useRef(defaults);
  defaultsRef.current = defaults;
  const defaultsKey = JSON.stringify(defaults);
  const state = useMemo(
    () => ({ ...defaultsRef.current, ...decodeState<T>(raw) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [raw, defaultsKey]
  );
  const stateRef = useRef(state);
  stateRef.current = state;
  const setState = useCallback(
    (patch: Partial<T>, options: { replace?: boolean } = {}) => {
      const latest = { ...defaultsRef.current, ...decodeState<T>(getLocation().hashParams[key]) };
      const next = { ...latest, ...patch };
      const encoded = encodeState(next);
      if (encoded === getLocation().hashParams[key]) return;
      setHashParams({ [key]: encoded }, { replace: options.replace ?? true });
    },
    [key]
  );
  return [state, setState];
}

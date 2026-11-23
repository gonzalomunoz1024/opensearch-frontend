/* SPDX-License-Identifier: Apache-2.0 */

/*
 * What the pages share: the time range, the refresh interval and the pinned filters (the `_g`
 * of the address, which follows from page to page), the trail in the header, and the list of
 * what was opened lately.
 */

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { isValidTimeRange } from '../lib/date_picker';
import type { TimeRange } from '../lib/dates';
import type { Filter, RefreshInterval } from '../lib/types';
import { decodeState, encodeState } from '../lib/url';
import { getLocation, setHashParams, useLocation } from '../router';
import { services } from '../services';

export interface GlobalState {
  time: TimeRange;
  refreshInterval: RefreshInterval;
  filters: Filter[];
}

// The `_g` last seen: a page opened without one takes it up
let lastGlobal: string | undefined;

const SESSION_KEY = 'infradashboard:globalState';

function readSession(): string | undefined {
  if (lastGlobal !== undefined) return lastGlobal;
  try {
    lastGlobal = window.sessionStorage.getItem(SESSION_KEY) ?? undefined;
  } catch {
    lastGlobal = undefined;
  }
  return lastGlobal;
}

function writeSession(raw: string) {
  lastGlobal = raw;
  try {
    window.sessionStorage.setItem(SESSION_KEY, raw);
  } catch {
    // a browser that keeps nothing still works, the state then lives in the address alone
  }
}

export function defaultGlobalState(): GlobalState {
  const time = services.uiSettings.get<TimeRange>('timepicker:timeDefaults', {
    from: 'now-15m',
    to: 'now',
  });
  const refresh = services.uiSettings.get<RefreshInterval>('timepicker:refreshIntervalDefaults', {
    pause: true,
    value: 0,
  });
  return {
    time: { from: time.from, to: time.to },
    // An interval of nothing is a paused one
    refreshInterval: { pause: refresh.pause || !refresh.value, value: refresh.value || 0 },
    filters: [],
  };
}

/**
 * What a `_g` stands for. A range whose ends are not both dates is the default range, as in the
 * original, which searches and shows `timepicker:timeDefaults` in its place (and leaves the
 * address as it is): no page searches without a time bound because of it.
 */
export function globalStateOf(raw: string | undefined): GlobalState {
  const defaults = defaultGlobalState();
  const state = decodeState<GlobalState>(raw);
  return {
    time: isValidTimeRange(state.time) ? state.time : defaults.time,
    refreshInterval: state.refreshInterval ?? defaults.refreshInterval,
    filters: Array.isArray(state.filters) ? state.filters : [],
  };
}

/** The `_g` to put on a link to another page, so that the time range follows */
export function currentGlobalParam(): string | undefined {
  return getLocation().hashParams._g ?? readSession();
}

/**
 * The `_g` with a change made to it, for a page that writes it in the same step as its own state:
 * loading a saved query changes the query, the filters and the time range at once.
 */
export function globalParamWith(patch: Partial<GlobalState>): string {
  const raw = getLocation().hashParams._g ?? readSession();
  // A range that is no date stays in the address until the range itself changes, as in the original
  const held = decodeState<GlobalState>(raw).time;
  const encoded = encodeState({ ...globalStateOf(raw), ...(held === undefined ? {} : { time: held }), ...patch });
  writeSession(encoded);
  return encoded;
}

export function useGlobalState(): [GlobalState, (patch: Partial<GlobalState>) => void] {
  const location = useLocation();
  const raw = location.hashParams._g ?? readSession();
  const state = useMemo(() => globalStateOf(raw), [raw]);

  // The address always says what is on screen
  useEffect(() => {
    if (location.hashParams._g === undefined) {
      setHashParams({ _g: raw ?? encodeState(defaultGlobalState()) }, { replace: true });
    } else if (location.hashParams._g !== lastGlobal) {
      writeSession(location.hashParams._g);
    }
  }, [location.hashParams._g, location.pathname, location.hashPath, raw]);

  const setState = useCallback((patch: Partial<GlobalState>) => {
    // A new time range is a step the back button returns from; a refresh interval is not
    setHashParams({ _g: globalParamWith(patch) }, { replace: patch.time === undefined });
  }, []);

  return [state, setState];
}

/** Calls back at the refresh interval while it runs and the tab is in view */
export function useAutoRefresh(interval: RefreshInterval, onTick: () => void) {
  const callback = useRef(onTick);
  callback.current = onTick;
  useEffect(() => {
    if (interval.pause || !interval.value || interval.value < 1000) return undefined;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') callback.current();
    }, interval.value);
    return () => window.clearInterval(timer);
  }, [interval.pause, interval.value]);
}

// --- The header's trail and title -------------------------------------------------------------

export interface Breadcrumb {
  text: string;
  /** A path of this product the crumb leads to, which the base path is put in front of */
  to?: string;
  /**
   * An address the link carries as it is given, as the original's crumbs take their `href`: `#`
   * for a crumb that leads to its application's first page, whatever page it is on
   */
  href?: string;
}

interface ChromeState {
  breadcrumbs: Breadcrumb[];
  /** Hide the header and the navigation: a dashboard in full screen */
  fullScreen: boolean;
}

let chrome: ChromeState = { breadcrumbs: [], fullScreen: false };
const chromeListeners = new Set<() => void>();

function setChrome(patch: Partial<ChromeState>) {
  chrome = { ...chrome, ...patch };
  for (const listener of [...chromeListeners]) listener();
}

export function useChromeState(): ChromeState {
  return useSyncExternalStore(
    (listener) => {
      chromeListeners.add(listener);
      return () => chromeListeners.delete(listener);
    },
    () => chrome
  );
}

export function setFullScreen(fullScreen: boolean) {
  if (chrome.fullScreen !== fullScreen) setChrome({ fullScreen });
}

/**
 * The tab's title of a page that does not set its own, as the original's applications set it
 * (`chrome.docTitle.change`, reset to the product's name when the application changes): most name
 * the page by the last crumb of its trail, and a dashboard by its title, also while it is edited;
 * Discover says "Discover", or "Discover: " and the saved search; Saved objects says "Saved
 * Objects" on every page of its own; a new dashboard, Dashboards Management's landing page and
 * advanced settings, Query Workbench, Index Management and Snapshot Management leave the product's
 * name alone.
 */
export function documentTitleOf(
  location: { pathname: string; hashPath: string; hashParams: Record<string, string | undefined> },
  breadcrumbs: Breadcrumb[],
  name: string
): string {
  const { pathname, hashPath } = location;
  const under = (...paths: string[]) =>
    paths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
  const last = breadcrumbs[breadcrumbs.length - 1]?.text ?? '';
  let parts: string[];
  if (under('/app/management/opensearch-dashboards/objects')) parts = ['Saved Objects'];
  else if (under('/app/management/opensearch-dashboards/indexPatterns')) parts = [last];
  else if (
    under(
      '/app/management',
      '/app/settings',
      '/app/opensearch-query-workbench',
      '/app/opensearch_index_management_dashboards',
      '/app/opensearch_snapshot_management_dashboards'
    )
  ) {
    parts = [];
  } else if (under('/app/discover', '/app/data-explorer')) {
    parts = [hashPath.startsWith('/view/') && breadcrumbs.length > 1 ? `Discover: ${last}` : 'Discover'];
  } else if (under('/app/home')) parts = ['Home'];
  else if (under('/app/dashboards', '/app/dashboard')) {
    // The trail says "Editing <title>", and " (unsaved)" after it, where the title says the title
    const editing = decodeState<{ viewMode?: string }>(location.hashParams._a).viewMode === 'edit';
    const title = editing ? last.replace(/^Editing /, '').replace(/ \(unsaved\)$/, '') : last;
    parts = hashPath.startsWith('/create') ? [] : [title];
  } else parts = [last];
  return [...parts, name].filter(Boolean).join(' - ');
}

/** Says where the page is, in the header and in the tab's title */
export function useBreadcrumbs(breadcrumbs: Breadcrumb[]) {
  const key = JSON.stringify(breadcrumbs);
  useEffect(() => {
    setChrome({ breadcrumbs });
    document.title = documentTitleOf(getLocation(), breadcrumbs, services.boot.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

// --- What was opened lately -------------------------------------------------------------------

export interface RecentItem {
  id: string;
  label: string;
  link: string;
}

const RECENT_KEY = 'infradashboard:recentlyAccessed';
let recent: RecentItem[] | undefined;
const recentListeners = new Set<() => void>();

function readRecent(): RecentItem[] {
  if (!recent) {
    try {
      recent = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? '[]') as RecentItem[];
      if (!Array.isArray(recent)) recent = [];
    } catch {
      recent = [];
    }
  }
  return recent;
}

export function addRecentlyAccessed(link: string, label: string, id: string) {
  const items = [{ id, label, link }, ...readRecent().filter((item) => item.id !== id)].slice(0, 10);
  recent = items;
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(items));
  } catch {
    // kept for this visit only
  }
  for (const listener of [...recentListeners]) listener();
}

export function useRecentlyAccessed(): RecentItem[] {
  return useSyncExternalStore(
    (listener) => {
      recentListeners.add(listener);
      return () => recentListeners.delete(listener);
    },
    readRecent
  );
}

/** A value kept in the browser between visits: which panel is open, how wide a column is */
export function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(`infradashboard:${key}`);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function writeStored(key: string, value: unknown) {
  try {
    window.localStorage.setItem(`infradashboard:${key}`, JSON.stringify(value));
  } catch {
    // kept for this visit only
  }
}

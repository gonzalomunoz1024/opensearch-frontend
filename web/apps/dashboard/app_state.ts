/* SPDX-License-Identifier: Apache-2.0 */

/*
 * A dashboard's state in the address, as the original keeps it in `_a`: everything about the
 * dashboard on screen, over what was saved, and its panels only while it is edited.
 */

import type { TimeRange } from '../../lib/dates';
import { encodeState } from '../../lib/url';
import type { Filter, Query, RefreshInterval } from '../../lib/types';
import {
  dashboardQuery,
  panelsDiffer,
  panelsFromUrl,
  panelsToUrl,
  type Dashboard,
  type DashboardOptions,
  type PanelState,
} from './model';

export interface UrlAppState {
  description?: string;
  expandedPanelId?: string;
  filters?: Filter[];
  fullScreenMode?: boolean;
  options?: DashboardOptions;
  /** The panels as the address carries them (see `panelsToUrl`), while the dashboard is edited */
  panels?: unknown;
  query?: Query;
  /** The id of the saved query loaded into the search bar */
  savedQuery?: string;
  timeRestore?: boolean;
  title?: string;
  viewMode?: 'view' | 'edit';
}

/**
 * The state the original writes once a dashboard is open: what the address says, and for what it
 * does not say, what was saved. A dashboard not saved yet opens to be edited.
 */
export function fullAppState(
  saved: Dashboard,
  current: UrlAppState,
  panels: PanelState[],
  defaultQuery: Query
): UrlAppState {
  const viewMode = current.viewMode ?? (saved.id ? 'view' : 'edit');
  const state: UrlAppState = {
    ...current,
    description: current.description ?? saved.description,
    filters: current.filters ?? saved.filters,
    fullScreenMode: current.fullScreenMode ?? false,
    options: current.options ?? saved.options,
    query: current.query === undefined ? saved.query ?? defaultQuery : dashboardQuery(current.query),
    timeRestore: current.timeRestore ?? saved.timeRestore,
    title: current.title ?? saved.title,
    viewMode,
  };
  if (viewMode === 'edit') state.panels = current.panels ?? panelsToUrl(panels);
  else delete state.panels;
  return state;
}

/**
 * The panels an address carries while the dashboard is looked at: the original shows them, as it
 * shows those of a dashboard edited, and leaves them out of the address (`fullAppState`)
 */
export function viewedFromAddress(saved: Pick<Dashboard, 'id'>, current: UrlAppState): PanelState[] | undefined {
  const viewMode = current.viewMode ?? (saved.id ? 'view' : 'edit');
  return viewMode === 'view' && current.panels !== undefined ? panelsFromUrl(current.panels) : undefined;
}

/** Whether two values are the same whatever the order of their keys */
export const sameState = (a: unknown, b: unknown): boolean => encodeState(a) === encodeState(b);

/**
 * A value as the original holds it. It keeps the keys of the query and of the options in the
 * order they came to it (from the saved dashboard, its defaults, the search bar), where the
 * address sorts them, and the JSON it saves keeps that order. `held` is what came to it last:
 * while the address says the same, `held` is the one meant.
 */
export function asHeld<T>(fromAddress: T, held: T | undefined): T {
  return held !== undefined && sameState(held, fromAddress) ? held : fromAddress;
}

/** The options as the original puts them back when changes are discarded: these three, in this order */
export function restoredOptions(saved: DashboardOptions): DashboardOptions {
  const options: DashboardOptions = {};
  for (const key of ['hidePanelTitles', 'useMargins', 'useSharedCrosshair']) {
    if (saved[key] !== undefined) options[key] = saved[key];
  }
  return options;
}

/**
 * What the page takes of a dashboard's own time when it opens it: its range and its refresh
 * interval, each unless the address named one itself (`named`: the `_g` the page opened with),
 * as the original lets what the address says win over what the dashboard sets. Of the interval
 * the original's time filter keeps the pause and the value, and takes one of nothing as paused.
 */
export function ownTime(
  dashboard: Pick<Dashboard, 'timeRestore' | 'timeFrom' | 'timeTo' | 'refreshInterval'>,
  named: { time?: unknown; refreshInterval?: unknown } = {}
): { time?: TimeRange; refreshInterval?: RefreshInterval } {
  const own: { time?: TimeRange; refreshInterval?: RefreshInterval } = {};
  if (!dashboard.timeRestore) return own;
  if (dashboard.timeFrom && dashboard.timeTo && named.time === undefined) {
    own.time = { from: dashboard.timeFrom, to: dashboard.timeTo };
  }
  if (dashboard.refreshInterval && named.refreshInterval === undefined) {
    const { pause, value } = dashboard.refreshInterval;
    own.refreshInterval = value > 0 ? { pause: pause !== false, value } : { pause: true, value: 0 };
  }
  return own;
}

/**
 * What the original counts as a change of a dashboard (its `isDirty`, create_dashboard_container.tsx):
 * its panels, its query and its filters, and its time and refresh interval while it keeps its own
 */
export interface ChangeMarks {
  panels: PanelState[];
  query: Query;
  filters: Filter[];
  time?: TimeRange;
  refreshInterval?: RefreshInterval;
}

/** Whether a dashboard changed between two moments, by what the original counts as a change */
export function marksDiffer(a: ChangeMarks, b: ChangeMarks): boolean {
  return (
    panelsDiffer(a.panels, b.panels) ||
    !sameQuery(a.query, b.query) ||
    !sameState(a.filters, b.filters) ||
    !sameState(a.time ?? null, b.time ?? null) ||
    !sameState(a.refreshInterval ?? null, b.refreshInterval ?? null)
  );
}

/**
 * What a dashboard is opened with, a change of which makes it changed: what the page shows as it
 * opens it, with the dashboard's own time as the page puts it in place (`named`: the `_g` the
 * page opened with), as the original sets the time before its dashboard starts
 */
export function openingMarks(
  marks: ChangeMarks,
  dashboard: Pick<Dashboard, 'timeRestore' | 'timeFrom' | 'timeTo' | 'refreshInterval'>,
  named: { time?: unknown; refreshInterval?: unknown } = {}
): ChangeMarks {
  if (!dashboard.timeRestore) return marks;
  const own = ownTime(dashboard, named);
  return { ...marks, time: own.time ?? marks.time, refreshInterval: own.refreshInterval ?? marks.refreshInterval };
}

/**
 * The query of a saved dashboard, the language as the address names it; a query of OpenSearch's
 * DSL is the same whatever the order of its keys, as the original's isEqual takes it
 */
export function sameQuery(a: Query | undefined, b: Query | undefined): boolean {
  return sameState(a?.query ?? '', b?.query ?? '') && (a?.language ?? '') === (b?.language ?? '');
}

const COPY = 'copy';

/** The title the original searches for when it copies a panel's object: without "(copy …)" */
export function cloneBase(title: string): string {
  return title
    .replace(new RegExp(`\\(${COPY} [0-9]+\\)`, 'g'), '')
    .replace(new RegExp(`\\(${COPY}\\)`, 'g'), '')
    .trim();
}

/** The title of the copy, given how many objects the search for its base title found */
export function cloneTitle(title: string, found: number): string {
  const base = cloneBase(title);
  const similar = found - 1;
  return similar <= 0 ? `${base} (${COPY})` : `${base} (${COPY} ${similar})`;
}

/* SPDX-License-Identifier: Apache-2.0 */

/*
 * What the sample data page does besides drawing: it asks the server for the sets, adds and
 * removes one, and, as OpenSearch Dashboards does, makes a set's index pattern the default one
 * when none was chosen and takes it back when the set goes.
 */

import {
  INSTALLED_STATUS,
  UNINSTALLED_STATUS,
  type SampleDataAppLink,
  type SampleDataSetSummary,
} from '../../../common/sample_data';

export const SAMPLE_DATA_URL = '/api/sample_data';

/** What the page needs of the services; the tests give their own */
export interface SampleDataClientDeps {
  http: {
    get<T = unknown>(path: string): Promise<T>;
    post<T = unknown>(path: string): Promise<T>;
    delete<T = unknown>(path: string): Promise<T>;
  };
  uiSettings: {
    isDefault(key: string): boolean;
    get<T = unknown>(key: string, fallback?: T): T;
    set(key: string, value: unknown): Promise<void>;
    remove(key: string): Promise<void>;
  };
  indexPatterns: { clear(id?: string): void };
  /** A setting that could not be written: the original's "Unable to update UI setting" */
  onSettingError(error: unknown): void;
}

/** In the order of their names, whatever their case, as the original sorts them */
export function sortSampleDataSets(sets: SampleDataSetSummary[]): SampleDataSetSummary[] {
  return [...sets].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
}

/**
 * The picture of a set's card: the dark one in the dark theme, and the `_new` version for a theme
 * after v7, which the Atlas theme of this product always is.
 */
export function previewImageOf(set: SampleDataSetSummary, darkMode: boolean): string {
  let path = set.previewImagePath;
  if (set.darkPreviewImagePath && darkMode) path = set.darkPreviewImagePath;
  if (set.hasNewThemeImages) path = path.replace(/\.png$/, '_new.png');
  return path;
}

/**
 * The default index pattern to set after a set was added: the set's own when none is set. A set
 * without one (the OpenTelemetry set) leaves the setting alone, where the original writes an
 * empty one that keeps any later set from becoming the default.
 */
export function defaultIndexAfterInstall(
  set: SampleDataSetSummary,
  isDefault: boolean
): string | undefined {
  return isDefault && set.defaultIndex !== '' ? set.defaultIndex : undefined;
}

/** Whether the default index pattern goes back to none after a set was removed: it was the set's */
export function clearsDefaultIndex(
  set: SampleDataSetSummary,
  isDefault: boolean,
  current: unknown
): boolean {
  return !isDefault && current === set.defaultIndex;
}

export async function listSampleDataSets(deps: SampleDataClientDeps): Promise<SampleDataSetSummary[]> {
  return sortSampleDataSets(await deps.http.get<SampleDataSetSummary[]>(SAMPLE_DATA_URL));
}

// As the original, the page does not wait for the setting: the set is there either way
function writeSetting(deps: SampleDataClientDeps, change: Promise<void>) {
  change.catch((error: unknown) => deps.onSettingError(error));
}

export async function installSampleDataSet(deps: SampleDataClientDeps, set: SampleDataSetSummary) {
  await deps.http.post(`${SAMPLE_DATA_URL}/${encodeURIComponent(set.id)}`);
  const defaultIndex = defaultIndexAfterInstall(set, deps.uiSettings.isDefault('defaultIndex'));
  if (defaultIndex !== undefined) writeSetting(deps, deps.uiSettings.set('defaultIndex', defaultIndex));
  deps.indexPatterns.clear();
}

export async function uninstallSampleDataSet(deps: SampleDataClientDeps, set: SampleDataSetSummary) {
  await deps.http.delete(`${SAMPLE_DATA_URL}/${encodeURIComponent(set.id)}`);
  const { uiSettings } = deps;
  if (clearsDefaultIndex(set, uiSettings.isDefault('defaultIndex'), uiSettings.get('defaultIndex'))) {
    writeSetting(deps, uiSettings.remove('defaultIndex'));
  }
  deps.indexPatterns.clear();
}

/** The set as it is once added or removed, for the card to show without asking the server again */
export function withStatus(
  sets: SampleDataSetSummary[],
  id: string,
  installed: boolean
): SampleDataSetSummary[] {
  return sets.map((set) =>
    set.id === id ? { ...set, status: installed ? INSTALLED_STATUS : UNINSTALLED_STATUS } : set
  );
}

export interface ViewDataLink {
  label: string;
  /** 'dashboard' for the set's dashboard, else the icon the link names */
  icon: string;
  /** Where the link leads, as the page's address writes it */
  href: string;
}

/** The address of the dashboard of a set, under the server's base path */
export function dashboardPath(overviewDashboard: string): string {
  return `/app/dashboards#/view/${overviewDashboard}`;
}

/**
 * What "View data" offers: the set's dashboard, when it has one, then the pages of other
 * applications it names. A path that does not start with a slash is relative to the page, as
 * the original leaves it, and so is not put under the base path.
 */
export function viewDataLinks(
  set: Pick<SampleDataSetSummary, 'overviewDashboard' | 'appLinks'>,
  addBasePath: (path: string) => string
): ViewDataLink[] {
  const withBase = (path: string) => (path.startsWith('/') ? addBasePath(path) : path);
  const dashboard: ViewDataLink[] =
    set.overviewDashboard !== ''
      ? [{ label: 'Dashboard', icon: 'dashboardApp', href: addBasePath(dashboardPath(set.overviewDashboard)) }]
      : [];
  return [
    ...dashboard,
    ...set.appLinks.map((link: SampleDataAppLink) => ({
      label: link.label,
      icon: link.icon,
      href: withBase(link.path),
    })),
  ];
}

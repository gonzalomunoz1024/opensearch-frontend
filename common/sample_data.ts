/* SPDX-License-Identifier: Apache-2.0 */

/*
 * A sample data set as `GET /api/sample_data` lists it, in the shape OpenSearch Dashboards 3.9.0
 * answers: what the cards of the sample data page show, and whether the set is installed.
 */

export const INSTALLED_STATUS = 'installed';
export const UNINSTALLED_STATUS = 'not_installed';
export const UNKNOWN_STATUS = 'unknown';

export type SampleDataStatus =
  | typeof INSTALLED_STATUS
  | typeof UNINSTALLED_STATUS
  | typeof UNKNOWN_STATUS;

/** A page of another application that shows the set, offered beside its dashboard */
export interface SampleDataAppLink {
  path: string;
  icon: string;
  label: string;
  /** The path when the new navigation is on */
  newPath?: string;
  /** Whether the path takes the data source the set was installed into */
  appendDatasourceToPath?: boolean;
}

export interface SampleDataSetSummary {
  id: string;
  name: string;
  description: string;
  /** Under the server's base path */
  previewImagePath: string;
  darkPreviewImagePath: string;
  /** Whether the pictures have a `_new` version for the themes after v7 */
  hasNewThemeImages: boolean;
  /** The id of the dashboard "View data" opens; '' for none */
  overviewDashboard: string;
  appLinks: SampleDataAppLink[];
  /** The id of the index pattern made the default one when none is; '' for none */
  defaultIndex: string;
  dataIndices: Array<{ id: string; indexName?: string }>;
  status: SampleDataStatus;
  /** Why the status could not be told, when it is unknown */
  statusMsg?: string;
}

/** What `POST /api/sample_data/{id}` answers */
export interface SampleDataInstallResult {
  /** The documents loaded into each index */
  opensearchIndicesCreated: Record<string, number>;
  opensearchDashboardsSavedObjectsLoaded: number;
}

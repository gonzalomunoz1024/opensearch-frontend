/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The sample data sets of OpenSearch Dashboards 3.9.0, as its home plugin registers them: flights,
 * web logs, eCommerce orders and OpenTelemetry signals. What each one loads is in
 * data_sets/<id>/: its documents (one JSON document per line, gzipped) and the field mappings of
 * its indices, and the saved objects that show them, as OpenSearch Dashboards writes them when it
 * installs the set.
 */

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { SampleDataAppLink } from '../../common/sample_data';
import type { SavedObject } from '../../common/saved_objects';

export interface DataIndex {
  id: string;
  /** The documents, under data_sets/ */
  dataFile: string;
  /** The index's field mappings (its `mappings.properties`), under data_sets/ */
  fieldsFile: string;
  /** The fields whose dates are moved to the day of the install */
  timeFields: string[];
  /** The day the dates of the file count from: it becomes the day of the install */
  currentTimeMarker: string;
  /** Moves the dates to the week of the install, each keeping its day of the week and time of day */
  preserveDayOfWeekTimeOfDay: boolean;
  /** The index's name, when it is not the one `createIndexName` gives */
  indexName?: string;
}

export interface SampleDataSet {
  id: string;
  name: string;
  description: string;
  previewImagePath: string;
  darkPreviewImagePath: string;
  hasNewThemeImages: boolean;
  overviewDashboard: string;
  appLinks: SampleDataAppLink[];
  defaultIndex: string;
  /** The saved objects, under data_sets/; none for a set without any */
  savedObjectsFile?: string;
  dataIndices: DataIndex[];
}

/** A saved object of a set, ready to be written */
export type SampleSavedObject = Pick<SavedObject, 'id' | 'type' | 'attributes' | 'references'> &
  Pick<Partial<SavedObject>, 'migrationVersion'>;

const DATA_DIRECTORY = join(__dirname, 'data_sets');
const IMAGES = '/plugins/home/assets/sample_data_resources';
const OTEL_TIME_MARKER = '2024-10-16T19:00:01';

export const SAMPLE_DATA_SETS: SampleDataSet[] = [
  {
    id: 'flights',
    name: 'Sample flight data',
    description: 'Sample data, visualizations, and dashboards for monitoring flight routes.',
    previewImagePath: `${IMAGES}/flights/dashboard.png`,
    darkPreviewImagePath: `${IMAGES}/flights/dashboard_dark.png`,
    hasNewThemeImages: true,
    overviewDashboard: '7adfa750-4c81-11e8-b3d7-01146121b73d',
    appLinks: [],
    defaultIndex: 'd3d7af60-4c81-11e8-b3d7-01146121b73d',
    savedObjectsFile: 'flights/saved_objects.json',
    dataIndices: [
      {
        id: 'flights',
        dataFile: 'flights/flights.json.gz',
        fieldsFile: 'flights/field_mappings.json',
        timeFields: ['timestamp'],
        currentTimeMarker: '2018-01-09T00:00:00',
        preserveDayOfWeekTimeOfDay: true,
      },
    ],
  },
  {
    id: 'logs',
    name: 'Sample web logs',
    description: 'Sample data, visualizations, and dashboards for monitoring web logs.',
    previewImagePath: `${IMAGES}/logs/dashboard.png`,
    darkPreviewImagePath: `${IMAGES}/logs/dashboard_dark.png`,
    hasNewThemeImages: true,
    overviewDashboard: 'edf84fe0-e1a0-11e7-b6d5-4dc382ef7f5b',
    appLinks: [],
    defaultIndex: '90943e30-9a47-11e8-b64d-95841ca0b247',
    savedObjectsFile: 'logs/saved_objects.json',
    dataIndices: [
      {
        id: 'logs',
        dataFile: 'logs/logs.json.gz',
        fieldsFile: 'logs/field_mappings.json',
        timeFields: ['timestamp', 'utc_time'],
        currentTimeMarker: '2018-08-01T00:00:00',
        preserveDayOfWeekTimeOfDay: true,
      },
    ],
  },
  {
    id: 'ecommerce',
    name: 'Sample eCommerce orders',
    description: 'Sample data, visualizations, and dashboards for tracking eCommerce orders.',
    previewImagePath: `${IMAGES}/ecommerce/dashboard.png`,
    darkPreviewImagePath: `${IMAGES}/ecommerce/dashboard_dark.png`,
    hasNewThemeImages: true,
    overviewDashboard: '722b74f0-b882-11e8-a6d9-e546fe2bba5f',
    appLinks: [],
    defaultIndex: 'ff959d40-b880-11e8-a6d9-e546fe2bba5f',
    savedObjectsFile: 'ecommerce/saved_objects.json',
    dataIndices: [
      {
        id: 'ecommerce',
        dataFile: 'ecommerce/ecommerce.json.gz',
        fieldsFile: 'ecommerce/field_mappings.json',
        timeFields: ['order_date'],
        currentTimeMarker: '2016-12-11T00:00:00',
        preserveDayOfWeekTimeOfDay: true,
      },
    ],
  },
  {
    id: 'otel',
    name: 'Sample Observability Logs, Traces, and Metrics',
    description:
      'Correlated observability signals for an e-commerce application in OpenTelemetry standard (Compatible with 2.13+ OpenSearch domains)',
    previewImagePath: `${IMAGES}/otel/otel_traces.png`,
    darkPreviewImagePath: `${IMAGES}/otel/otel_traces_dark.png`,
    hasNewThemeImages: true,
    overviewDashboard: '',
    appLinks: [
      {
        path: 'observability-traces#/traces',
        icon: 'apmTrace',
        label: 'View traces',
        newPath: 'observability-traces-nav#/traces',
        appendDatasourceToPath: true,
      },
      {
        path: 'observability-traces#/services',
        icon: 'graphApp',
        label: 'View services',
        newPath: 'observability-services-nav#/services',
        appendDatasourceToPath: true,
      },
    ],
    defaultIndex: '',
    dataIndices: [
      {
        id: 'opensearch_dashboards_sample_data_otel_spans',
        dataFile: 'otel/sample_traces.json.gz',
        fieldsFile: 'otel/traces_field_mappings.json',
        timeFields: ['startTime', 'endTime', 'traceGroupFields.endTime'],
        currentTimeMarker: OTEL_TIME_MARKER,
        preserveDayOfWeekTimeOfDay: false,
        indexName: 'opensearch_dashboards_sample_data_otel_spans',
      },
      {
        id: 'opensearch_dashboards_sample_data_otel_service_map',
        dataFile: 'otel/sample_service_map.json.gz',
        fieldsFile: 'otel/services_field_mappings.json',
        timeFields: [],
        currentTimeMarker: OTEL_TIME_MARKER,
        preserveDayOfWeekTimeOfDay: false,
        indexName: 'opensearch_dashboards_sample_data_otel_service_map',
      },
      {
        id: 'ss4o_metrics-otel-opensearch_dashboards-sample',
        dataFile: 'otel/sample_metrics.json.gz',
        fieldsFile: 'otel/metrics_field_mappings.json',
        timeFields: ['@timestamp', 'exemplar.time', 'startTime', 'time', 'observedTimestamp'],
        currentTimeMarker: OTEL_TIME_MARKER,
        preserveDayOfWeekTimeOfDay: false,
        indexName: 'ss4o_metrics-otel-opensearch_dashboards-sample',
      },
      {
        id: 'opensearch_dashboards_sample_data_otel_logs',
        dataFile: 'otel/sample_logs.json.gz',
        fieldsFile: 'otel/logs_field_mappings.json',
        timeFields: ['time', 'observedTime'],
        currentTimeMarker: OTEL_TIME_MARKER,
        preserveDayOfWeekTimeOfDay: false,
        indexName: 'opensearch_dashboards_sample_data_otel_logs',
      },
    ],
  },
];

/**
 * The index of a set's data. A set of one index named after the set keeps the name it had before
 * sets could have several, so that removing it finds it.
 */
export function createIndexName(sampleDataSetId: string, dataIndexId: string): string {
  if (sampleDataSetId === dataIndexId) return `opensearch_dashboards_sample_data_${sampleDataSetId}`;
  return `opensearch_dashboards_sample_data_${sampleDataSetId}_${dataIndexId}`;
}

export function indexNameOf(set: Pick<SampleDataSet, 'id'>, dataIndex: DataIndex): string {
  return dataIndex.indexName ?? createIndexName(set.id, dataIndex.id);
}

/** Where a file of data_sets/ is; a path from the root stays as it is */
export function dataPath(file: string): string {
  return resolve(DATA_DIRECTORY, file);
}

export function readFields(dataIndex: DataIndex): Record<string, unknown> {
  return JSON.parse(readFileSync(dataPath(dataIndex.fieldsFile), 'utf8')) as Record<string, unknown>;
}

export function readSavedObjects(set: SampleDataSet): SampleSavedObject[] {
  if (!set.savedObjectsFile) return [];
  return JSON.parse(readFileSync(dataPath(set.savedObjectsFile), 'utf8')) as SampleSavedObject[];
}

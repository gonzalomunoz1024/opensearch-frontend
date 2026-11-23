/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The saved object types of OpenSearch Dashboards 3.9.0 as its build with the plugins of this
 * product registers them: in the order it registers them, with how each one is kept apart by
 * namespace and what the saved objects page knows of it (its icon, title, the page that shows it
 * and the field a search looks in first).
 */

import type { SavedObject } from '../common/saved_objects';

export interface InAppUrl {
  path: string;
  /** The capability that must be on for the page to be offered */
  uiCapabilitiesPath: string;
}

export interface SavedObjectTypeManagement {
  importableAndExportable?: boolean;
  defaultSearchField?: string;
  icon?: string;
  getTitle?: (object: SavedObject) => string | undefined;
  getEditUrl?: (object: SavedObject) => string | undefined;
  getInAppUrl?: (object: SavedObject) => InAppUrl | undefined;
}

export interface SavedObjectTypeInfo {
  name: string;
  /** "single": one per namespace, the id carries none; "agnostic": the product's own records */
  namespaceType: 'single' | 'agnostic';
  management?: SavedObjectTypeManagement;
}

const id = (object: SavedObject) => encodeURIComponent(object.id);
const attribute = (object: SavedObject, name: string) =>
  (object.attributes as Record<string, unknown> | undefined)?.[name] as string | undefined;
const objectsPage = (service: string) => (object: SavedObject) =>
  `/management/opensearch-dashboards/objects/${service}/${id(object)}`;

const APM_CONFIG = 'APM-Config-';
const TRACE_TO_LOGS = 'trace-to-logs-';

const agnostic = (name: string): SavedObjectTypeInfo => ({ name, namespaceType: 'agnostic' });

/** In the order OpenSearch Dashboards registers them, which is the order its lists give */
export const SAVED_OBJECT_TYPE_INFO: SavedObjectTypeInfo[] = [
  {
    name: 'config',
    namespaceType: 'single',
    management: {
      icon: 'gear',
      importableAndExportable: true,
      getInAppUrl: () => ({
        path: '/app/management/opensearch-dashboards/settings',
        uiCapabilitiesPath: 'advancedSettings.show',
      }),
      getTitle: (object) => `Advanced Settings [${object.id}]`,
    },
  },
  {
    name: 'url',
    namespaceType: 'single',
    management: {
      icon: 'link',
      defaultSearchField: 'url',
      importableAndExportable: true,
      getTitle: (object) => `/goto/${id(object)}`,
    },
  },
  agnostic('application_usage_totals'),
  agnostic('application_usage_daily'),
  agnostic('application_usage_transactional'),
  agnostic('ui-metric'),
  agnostic('dql-telemetry'),
  {
    name: 'index-pattern',
    namespaceType: 'single',
    management: {
      icon: 'indexPatternApp',
      defaultSearchField: 'title',
      importableAndExportable: true,
      getTitle: (object) => attribute(object, 'displayName') || attribute(object, 'title'),
      getEditUrl: (object) => `/management/opensearch-dashboards/indexPatterns/patterns/${id(object)}`,
      getInAppUrl: (object) => ({
        path: `/app/management/opensearch-dashboards/indexPatterns/patterns/${id(object)}`,
        uiCapabilitiesPath: 'management.opensearchDashboards.indexPatterns',
      }),
    },
  },
  {
    name: 'query',
    namespaceType: 'single',
    management: {
      icon: 'search',
      defaultSearchField: 'title',
      importableAndExportable: true,
      getTitle: (object) => attribute(object, 'title'),
      getInAppUrl: (object) => ({
        path: `/app/discover#/?_a=(savedQuery:'${id(object)}')`,
        uiCapabilitiesPath: 'discover.show',
      }),
    },
  },
  {
    name: 'correlations',
    namespaceType: 'single',
    management: {
      icon: 'link',
      defaultSearchField: 'title',
      importableAndExportable: true,
      getTitle: (object) => {
        const title = attribute(object, 'title');
        if (title) return title;
        const correlationType = attribute(object, 'correlationType') || '';
        if (correlationType.startsWith(APM_CONFIG)) return 'APM-config';
        if (correlationType.startsWith(TRACE_TO_LOGS)) return correlationType;
        return `Correlation ${object.id}`;
      },
      getInAppUrl: (object) => {
        const correlationType = attribute(object, 'correlationType') || '';
        if (correlationType.startsWith(APM_CONFIG)) {
          return {
            path: '/app/observability-apm-services#/services',
            uiCapabilitiesPath: 'observability.show',
          };
        }
        const traceDatasetId = object.references?.[0]?.id;
        if (correlationType.startsWith(TRACE_TO_LOGS) && traceDatasetId) {
          return {
            path: `/app/datasets/patterns/${encodeURIComponent(traceDatasetId)}#/?_a=(tab:correlatedDatasets)`,
            uiCapabilitiesPath: 'indexPatterns.save',
          };
        }
        return undefined;
      },
    },
  },
  agnostic('search-telemetry'),
  agnostic('sample-data-telemetry'),
  {
    name: 'homepage',
    namespaceType: 'single',
    management: {
      icon: 'home',
      importableAndExportable: true,
      getTitle: () => 'Home [application]',
      getEditUrl: objectsPage('savedHomepage'),
      getInAppUrl: () => ({ path: '/app/home', uiCapabilitiesPath: 'home.show' }),
    },
  },
  {
    name: 'dashboard',
    namespaceType: 'single',
    management: {
      icon: 'dashboardApp',
      defaultSearchField: 'title',
      importableAndExportable: true,
      getTitle: (object) => attribute(object, 'title'),
      getEditUrl: objectsPage('savedDashboards'),
      getInAppUrl: (object) => ({
        path: `/app/dashboards#/view/${id(object)}`,
        uiCapabilitiesPath: 'dashboard.show',
      }),
    },
  },
  {
    name: 'visualization',
    namespaceType: 'single',
    management: {
      icon: 'visualizeApp',
      defaultSearchField: 'title',
      importableAndExportable: true,
      getTitle: (object) => attribute(object, 'title'),
      getEditUrl: objectsPage('savedVisualizations'),
      getInAppUrl: (object) => ({
        path: `/app/visualize#/edit/${id(object)}`,
        uiCapabilitiesPath: 'visualize.show',
      }),
    },
  },
  agnostic('tsvb-validation-telemetry'),
  {
    name: 'visualization-visbuilder',
    namespaceType: 'single',
    management: {
      defaultSearchField: 'title',
      importableAndExportable: true,
      getTitle: (object) => attribute(object, 'title'),
      getEditUrl: objectsPage('savedVisBuilder'),
      getInAppUrl: (object) => ({
        path: `/app/vis-builder/edit/${id(object)}`,
        uiCapabilitiesPath: 'visualization-visbuilder.show',
      }),
    },
  },
  {
    name: 'augment-vis',
    namespaceType: 'single',
    management: {
      importableAndExportable: true,
      getTitle: (object) => `augment-vis-${attribute(object, 'originPlugin')}`,
      getEditUrl: objectsPage('savedAugmentVis'),
    },
  },
  {
    name: 'search',
    namespaceType: 'single',
    management: {
      icon: 'discoverApp',
      defaultSearchField: 'title',
      importableAndExportable: true,
      getTitle: (object) => attribute(object, 'title'),
      getEditUrl: objectsPage('savedSearches'),
      getInAppUrl: (object) => ({
        path: `/app/discover#/view/${id(object)}`,
        uiCapabilitiesPath: 'discover.show',
      }),
    },
  },
];

const BY_NAME = new Map(SAVED_OBJECT_TYPE_INFO.map((info) => [info.name, info]));

export const typeInfo = (type: string): SavedObjectTypeInfo | undefined => BY_NAME.get(type);

/** The types a saved objects client may read and write: all of them, none is hidden */
export const ALLOWED_TYPES = SAVED_OBJECT_TYPE_INFO.map((info) => info.name);

export const isAllowedType = (type: string) => BY_NAME.has(type);

export const isNamespaceAgnostic = (type: string) => BY_NAME.get(type)?.namespaceType === 'agnostic';

/** What an export file and an import may hold, in the order the saved objects page lists them */
export const IMPORTABLE_TYPES = SAVED_OBJECT_TYPE_INFO.filter(
  (info) => info.management?.importableAndExportable
).map((info) => info.name);

export const isImportableType = (type: string) => IMPORTABLE_TYPES.includes(type);

/** What the saved objects page shows of an object beside it: OpenSearch Dashboards' `meta` */
export interface SavedObjectMeta {
  icon?: string;
  title?: string;
  editUrl?: string;
  inAppUrl?: InAppUrl;
  namespaceType?: 'single' | 'agnostic';
}

export function metaOf(object: SavedObject): SavedObjectMeta {
  const info = BY_NAME.get(object.type);
  const management = info?.management;
  return {
    icon: management?.icon,
    title: management?.getTitle?.(object),
    editUrl: management?.getEditUrl?.(object),
    inAppUrl: management?.getInAppUrl?.(object),
    namespaceType: info?.namespaceType,
  };
}

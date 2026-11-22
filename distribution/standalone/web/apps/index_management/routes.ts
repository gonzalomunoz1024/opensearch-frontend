/* SPDX-License-Identifier: Apache-2.0 */

/* The pages of Index Management by the addresses the plugin gives them, and their breadcrumbs. */

import type { Breadcrumb } from '../../shell/state';

export const INDEX_MANAGEMENT_PATH = '/app/opensearch_index_management_dashboards';
export const SNAPSHOT_MANAGEMENT_PATH = '/app/opensearch_snapshot_management_dashboards';

export const ROUTES = {
  CHANGE_POLICY: '/change-policy',
  CREATE_POLICY: '/create-policy',
  EDIT_POLICY: '/edit-policy',
  MANAGED_INDICES: '/managed-indices',
  INDEX_POLICIES: '/index-policies',
  POLICY_DETAILS: '/policy-details',
  INDICES: '/indices',
  ROLLUPS: '/rollups',
  CREATE_ROLLUP: '/create-rollup',
  EDIT_ROLLUP: '/edit-rollup',
  ROLLUP_DETAILS: '/rollup-details',
  TRANSFORMS: '/transforms',
  CREATE_TRANSFORM: '/create-transform',
  EDIT_TRANSFORM: '/edit-transform',
  TRANSFORM_DETAILS: '/transform-details',
  SNAPSHOT_POLICIES: '/snapshot-policies',
  SNAPSHOT_POLICY_DETAILS: '/snapshot-policy-details',
  CREATE_SNAPSHOT_POLICY: '/create-snapshot-policy',
  EDIT_SNAPSHOT_POLICY: '/edit-snapshot-policy',
  SNAPSHOTS: '/snapshots',
  REPOSITORIES: '/repositories',
  CREATE_INDEX: '/create-index',
  INDEX_DETAIL: '/index-detail',
  REINDEX: '/reindex',
  ALIASES: '/aliases',
  TEMPLATES: '/templates',
  CREATE_TEMPLATE: '/create-template',
  SPLIT_INDEX: '/split-index',
  SHRINK_INDEX: '/shrink-index',
  ROLLOVER: '/rollover',
  DATA_STREAMS: '/data-streams',
  CREATE_DATA_STREAM: '/create-data-stream',
  FORCE_MERGE: '/force-merge',
  NOTIFICATIONS: '/notifications',
  COMPOSABLE_TEMPLATES: '/composable-templates',
  CREATE_COMPOSABLE_TEMPLATE: '/create-composable-template',
} as const;

const index = (text: string, route?: string): Breadcrumb =>
  route === undefined ? { text } : { text, to: `${INDEX_MANAGEMENT_PATH}#${route}` };
const snapshot = (text: string, route?: string): Breadcrumb =>
  route === undefined ? { text } : { text, to: `${SNAPSHOT_MANAGEMENT_PATH}#${route}` };

export const CRUMBS = {
  INDEX_MANAGEMENT: index('Index Management', '/'),
  INDICES: index('Indexes', ROUTES.INDICES),
  INDEX_POLICIES: index('State management policies', ROUTES.INDEX_POLICIES),
  MANAGED_INDICES: index('Policy managed indexes', ROUTES.MANAGED_INDICES),
  EDIT_POLICY: index('Edit policy'),
  CREATE_POLICY: index('Create policy'),
  CHANGE_POLICY: index('Change policy'),
  POLICY_DETAILS: index('Policy details'),
  ROLLUPS: index('Rollup jobs', ROUTES.ROLLUPS),
  CREATE_ROLLUP: index('Create rollup job'),
  EDIT_ROLLUP: index('Edit rollup job'),
  ROLLUP_DETAILS: index('Rollup details'),
  TRANSFORMS: index('Transform jobs', ROUTES.TRANSFORMS),
  CREATE_TRANSFORM: index('Create transform job'),
  EDIT_TRANSFORM: index('Edit transform job'),
  TRANSFORM_DETAILS: index('Transform details'),
  CREATE_INDEX: index('Create Index'),
  EDIT_INDEX: index('Edit Index'),
  REINDEX: index('Reindex'),
  ALIASES: index('Aliases', ROUTES.ALIASES),
  TEMPLATES: index('Templates', ROUTES.TEMPLATES),
  CREATE_TEMPLATE: index('Create index template'),
  EDIT_TEMPLATE: index('Edit template'),
  SPLIT_INDEX: index('Split Index'),
  SHRINK_INDEX: index('Shrink index'),
  ROLLOVER: index('Rollover'),
  DATA_STREAMS: index('Data streams', ROUTES.DATA_STREAMS),
  CREATE_DATA_STREAM: index('Create data stream'),
  FORCE_MERGE: index('Force merge'),
  COMPOSABLE_TEMPLATES: index('Component templates', ROUTES.COMPOSABLE_TEMPLATES),
  CREATE_COMPOSABLE_TEMPLATE: index('Create component template'),
  NOTIFICATION_SETTINGS: index('Notification settings', ROUTES.NOTIFICATIONS),
  SNAPSHOT_MANAGEMENT: snapshot('Snapshot Management', ROUTES.SNAPSHOT_POLICIES),
  SNAPSHOT_POLICIES: snapshot('Snapshot policies', ROUTES.SNAPSHOT_POLICIES),
  SNAPSHOT_POLICY_DETAILS: snapshot('Snapshot policy details'),
  CREATE_SNAPSHOT_POLICY: snapshot('Create snapshot policy'),
  EDIT_SNAPSHOT_POLICY: snapshot('Edit snapshot policy'),
  SNAPSHOTS: snapshot('Snapshots', ROUTES.SNAPSHOTS),
  REPOSITORIES: snapshot('Repositories', ROUTES.REPOSITORIES),
};

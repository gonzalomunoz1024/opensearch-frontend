/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Index Management and Snapshot Management: two entries of the menu that open one set of pages,
 * each at the address the plugin gives it after the `#`. A list has the menu of all lists at
 * its left; a page that creates, edits or shows one thing has the whole width.
 */

import { useEffect, type ReactNode } from 'react';
import { EmptyPrompt, cx } from '../../components/basic';
import { navigateHash, useLocation } from '../../router';
import { Aliases } from './aliases';
import { CreateDataStream, DataStreamDetail } from './data_stream_pages';
import { DataStreams } from './data_streams';
import { ForceMerge } from './force_merge';
import { CreateIndex, IndexDetail } from './index_pages';
import { Indices } from './indices';
import { ChangePolicy, ManagedIndices } from './managed_indices';
import { CreatePolicy, Policies, PolicyDetails } from './policies';
import { CreateRollup } from './create_rollup';
import { CreateSnapshotPolicy } from './create_snapshot_policy';
import { CreateTransform } from './create_transform';
import { Reindex } from './reindex';
import { Repositories } from './repositories';
import { ShrinkIndex, SplitIndex } from './resize_pages';
import { EditRollup, RollupDetails } from './rollup_pages';
import { Rollups } from './rollups';
import { SnapshotPolicies, SnapshotPolicyDetails } from './snapshot_policies';
import { Snapshots } from './snapshots';
import { EditTransform, TransformDetails } from './transform_pages';
import { NotificationSettings } from './notification_settings';
import { Transforms } from './transforms';
import { Rollover } from './rollover';
import { ROUTES, SNAPSHOT_MANAGEMENT_PATH } from './routes';
import { ComposableTemplateDetail, TemplateDetail } from './template_pages';
import { ComposableTemplates, Templates } from './templates';
import '../../styles/index_management.css';
import '../../styles/index_management_indexes.css';

export { startJobs } from './job_handlers';

interface NavItem {
  name: string;
  route: string;
  /** Other pages on which the item is the selected one */
  also?: string[];
  items?: NavItem[];
}

const NAV: Array<{ name: string; route: string; items: NavItem[] }> = [
  {
    name: 'Index Management',
    route: ROUTES.INDEX_POLICIES,
    items: [
      { name: 'State management policies', route: ROUTES.INDEX_POLICIES },
      { name: 'Policy managed indexes', route: ROUTES.MANAGED_INDICES },
      { name: 'Indexes', route: ROUTES.INDICES, also: [ROUTES.CREATE_INDEX] },
      { name: 'Data streams', route: ROUTES.DATA_STREAMS },
      {
        name: 'Templates',
        route: ROUTES.TEMPLATES,
        items: [{ name: 'Component templates', route: ROUTES.COMPOSABLE_TEMPLATES }],
      },
      { name: 'Aliases', route: ROUTES.ALIASES },
      { name: 'Rollup jobs', route: ROUTES.ROLLUPS },
      { name: 'Transform jobs', route: ROUTES.TRANSFORMS },
      { name: 'Notification settings', route: ROUTES.NOTIFICATIONS },
    ],
  },
  {
    name: 'Snapshot Management',
    route: ROUTES.SNAPSHOT_POLICIES,
    items: [
      { name: 'Snapshot policies', route: ROUTES.SNAPSHOT_POLICIES },
      { name: 'Snapshots', route: ROUTES.SNAPSHOTS },
      { name: 'Repositories', route: ROUTES.REPOSITORIES },
    ],
  },
];

// The pages that take the whole width
const NO_NAV: string[] = [
  ROUTES.CREATE_ROLLUP,
  ROUTES.EDIT_ROLLUP,
  ROUTES.ROLLUP_DETAILS,
  ROUTES.CREATE_TRANSFORM,
  ROUTES.EDIT_TRANSFORM,
  ROUTES.TRANSFORM_DETAILS,
  ROUTES.CREATE_POLICY,
  ROUTES.EDIT_POLICY,
  ROUTES.POLICY_DETAILS,
  ROUTES.CHANGE_POLICY,
  ROUTES.SNAPSHOT_POLICY_DETAILS,
  ROUTES.CREATE_SNAPSHOT_POLICY,
  ROUTES.EDIT_SNAPSHOT_POLICY,
  ROUTES.REINDEX,
  ROUTES.CREATE_INDEX,
  ROUTES.CREATE_TEMPLATE,
  ROUTES.SPLIT_INDEX,
  ROUTES.SHRINK_INDEX,
  ROUTES.FORCE_MERGE,
  ROUTES.CREATE_DATA_STREAM,
];
const NO_NAV_UNDER: string[] = [
  ROUTES.CREATE_TEMPLATE,
  ROUTES.INDEX_DETAIL,
  ROUTES.ROLLOVER,
  ROUTES.CREATE_DATA_STREAM,
  ROUTES.FORCE_MERGE,
  ROUTES.CREATE_COMPOSABLE_TEMPLATE,
];

// The pages the plugin's frame puts no padding around: each brings its own (25 px above and 50 px
// beside a policy's editor, 25 px beside Change policy, 5 and 50 px on a snapshot policy's pages)
const NO_PADDING: string[] = [
  ROUTES.CHANGE_POLICY,
  ROUTES.CREATE_POLICY,
  ROUTES.EDIT_POLICY,
  ROUTES.SNAPSHOT_POLICY_DETAILS,
  ROUTES.CREATE_SNAPSHOT_POLICY,
  ROUTES.EDIT_SNAPSHOT_POLICY,
];

interface Page {
  route: string;
  /** `rest` is what follows the route in the address: the name of what the page is about */
  render: (rest: string) => ReactNode;
}

// The longer of two routes that begin alike comes first
const PAGES: Page[] = [
  { route: ROUTES.INDEX_POLICIES, render: () => <Policies /> },
  { route: ROUTES.CREATE_POLICY, render: () => <CreatePolicy isEdit={false} /> },
  { route: ROUTES.EDIT_POLICY, render: () => <CreatePolicy isEdit /> },
  { route: ROUTES.POLICY_DETAILS, render: () => <PolicyDetails /> },
  { route: ROUTES.MANAGED_INDICES, render: () => <ManagedIndices /> },
  { route: ROUTES.CHANGE_POLICY, render: () => <ChangePolicy /> },
  { route: ROUTES.INDICES, render: () => <Indices /> },
  { route: ROUTES.CREATE_INDEX, render: () => <CreateIndex /> },
  { route: ROUTES.INDEX_DETAIL, render: (index) => <IndexDetail index={index} /> },
  { route: ROUTES.ALIASES, render: () => <Aliases /> },
  { route: ROUTES.TEMPLATES, render: () => <Templates /> },
  { route: ROUTES.CREATE_TEMPLATE, render: (name) => <TemplateDetail name={name} /> },
  { route: ROUTES.CREATE_COMPOSABLE_TEMPLATE, render: (name) => <ComposableTemplateDetail name={name} /> },
  { route: ROUTES.COMPOSABLE_TEMPLATES, render: () => <ComposableTemplates /> },
  { route: ROUTES.DATA_STREAMS, render: () => <DataStreams /> },
  {
    route: ROUTES.CREATE_DATA_STREAM,
    // The address of a data stream ends with a word the page has no use for
    render: (rest) => (rest === '' ? <CreateDataStream /> : <DataStreamDetail name={rest.split('/')[0]} />),
  },
  { route: ROUTES.FORCE_MERGE, render: (indexes) => <ForceMerge key={indexes} indexes={indexes} /> },
  { route: ROUTES.ROLLOVER, render: (source) => <Rollover key={source} source={source} /> },
  { route: ROUTES.SPLIT_INDEX, render: () => <SplitIndex /> },
  { route: ROUTES.SHRINK_INDEX, render: () => <ShrinkIndex /> },
  { route: ROUTES.REINDEX, render: () => <Reindex /> },
  { route: ROUTES.ROLLUPS, render: () => <Rollups /> },
  { route: ROUTES.CREATE_ROLLUP, render: () => <CreateRollup /> },
  { route: ROUTES.EDIT_ROLLUP, render: () => <EditRollup /> },
  { route: ROUTES.ROLLUP_DETAILS, render: () => <RollupDetails /> },
  { route: ROUTES.TRANSFORMS, render: () => <Transforms /> },
  { route: ROUTES.NOTIFICATIONS, render: () => <NotificationSettings /> },
  { route: ROUTES.CREATE_TRANSFORM, render: () => <CreateTransform /> },
  { route: ROUTES.EDIT_TRANSFORM, render: () => <EditTransform /> },
  { route: ROUTES.TRANSFORM_DETAILS, render: () => <TransformDetails /> },
  { route: ROUTES.SNAPSHOT_POLICIES, render: () => <SnapshotPolicies /> },
  { route: ROUTES.SNAPSHOT_POLICY_DETAILS, render: () => <SnapshotPolicyDetails /> },
  { route: ROUTES.CREATE_SNAPSHOT_POLICY, render: () => <CreateSnapshotPolicy isEdit={false} /> },
  { route: ROUTES.EDIT_SNAPSHOT_POLICY, render: () => <CreateSnapshotPolicy isEdit /> },
  { route: ROUTES.SNAPSHOTS, render: () => <Snapshots /> },
  { route: ROUTES.REPOSITORIES, render: () => <Repositories /> },
];

function findPage(hashPath: string): { page: Page; rest: string } | undefined {
  for (const page of PAGES) {
    if (hashPath === page.route) return { page, rest: '' };
    if (hashPath.startsWith(`${page.route}/`)) {
      const rest = hashPath.slice(page.route.length + 1);
      try {
        return { page, rest: decodeURIComponent(rest) };
      } catch {
        return { page, rest };
      }
    }
  }
  return undefined;
}

function NavLink({ item, hashPath }: { item: NavItem; hashPath: string }) {
  const selected = hashPath === item.route || Boolean(item.also?.includes(hashPath));
  const open = selected || Boolean(item.items?.some((inner) => inner.route === hashPath));
  return (
    <li>
      <a href={`#${item.route}`} className={cx('ismNav__link', selected && 'ismNav__link--selected')}>
        {item.name}
      </a>
      {item.items && open && (
        <ul className="ismNav__inner">
          {item.items.map((inner) => (
            <NavLink key={inner.route} item={inner} hashPath={hashPath} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function IndexManagement() {
  const { pathname, hashPath } = useLocation();
  const landing = pathname === SNAPSHOT_MANAGEMENT_PATH ? ROUTES.SNAPSHOT_POLICIES : ROUTES.INDEX_POLICIES;
  const found = findPage(hashPath);

  // An address that names no page opens the first page of the application
  const known = (Object.values(ROUTES) as string[]).some(
    (route) => hashPath === route || hashPath.startsWith(`${route}/`)
  );
  useEffect(() => {
    if (!found && !known) navigateHash(landing, {}, { replace: true });
  }, [found, known, landing]);
  if (!found && !known) return null;

  const wide = NO_NAV.includes(hashPath) || NO_NAV_UNDER.some((route) => hashPath.startsWith(route));
  return (
    <div className="ismFrame" data-test-subj="indexManagementApp">
      {!wide && (
        <nav className="ismNav" aria-label="Index Management">
          {NAV.map((group) => (
            <div key={group.name} className="ismNav__group">
              <a href={`#${group.route}`} className="ismNav__title">
                {group.name}
              </a>
              <ul>
                {group.items.map((item) => (
                  <NavLink key={item.route} item={item} hashPath={hashPath} />
                ))}
              </ul>
            </div>
          ))}
        </nav>
      )}
      <div
        className={cx('ismBody', found && NO_PADDING.includes(found.page.route) && 'ismBody--bare')}
        key={found ? `${found.page.route}/${found.rest}` : hashPath}
      >
        {found ? (
          found.page.render(found.rest)
        ) : (
          <EmptyPrompt icon="wrench" title="This page is not part of this build yet">
            <p>The lists and the other pages of Index Management are in the menu.</p>
          </EmptyPrompt>
        )}
      </div>
    </div>
  );
}

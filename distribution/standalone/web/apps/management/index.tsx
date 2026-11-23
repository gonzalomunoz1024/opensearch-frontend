/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Dashboards Management: index patterns, saved objects and advanced settings, at the addresses
 * OpenSearch Dashboards gives them (`/app/management/opensearch-dashboards/<section>/…`, and the
 * short ones, `/app/indexPatterns`, `/app/objects` and `/app/settings`).
 */

import type { ReactNode } from 'react';
import { EmptyPrompt, Link, cx } from '../../components/basic';
import { useLocation } from '../../router';
import { useBreadcrumbs } from '../../shell/state';
import { AdvancedSettings } from './settings';
import { IndexPatternsSection } from './index_patterns';
import { SavedObjectsSection } from './saved_objects';
import '../../styles/management.css';

export const MANAGEMENT_ROOT = '/app/management';
export const SECTION_ROOT = `${MANAGEMENT_ROOT}/opensearch-dashboards`;

const SECTIONS = [
  { id: 'indexPatterns', label: 'Index patterns', short: '/app/indexPatterns' },
  { id: 'objects', label: 'Saved objects', short: '/app/objects' },
  { id: 'settings', label: 'Advanced settings', short: '/app/settings' },
] as const;

type SectionId = (typeof SECTIONS)[number]['id'];

export const sectionPath = (section: SectionId, rest = '') => `${SECTION_ROOT}/${section}${rest}`;

/** Which section a path is in, and what follows the section in it */
export function readManagementPath(pathname: string): { section?: SectionId; rest: string[] } {
  const decode = (part: string) => {
    try {
      return decodeURIComponent(part);
    } catch {
      return part;
    }
  };
  for (const section of SECTIONS) {
    for (const root of [`${SECTION_ROOT}/${section.id}`, section.short]) {
      if (pathname === root || pathname.startsWith(`${root}/`)) {
        return { section: section.id, rest: pathname.slice(root.length).split('/').filter(Boolean).map(decode) };
      }
    }
  }
  return { rest: [] };
}

function Landing() {
  useBreadcrumbs([{ text: 'Dashboards Management' }]);
  return (
    <div className="mgtLanding">
      <EmptyPrompt icon="gear" title="Welcome to Dashboards Management">
        <p>Manage your index patterns, saved objects, settings, and more.</p>
        <hr className="mgtLanding__rule" />
        <p className="atlSubdued">A complete list of apps is in the menu on the left.</p>
      </EmptyPrompt>
    </div>
  );
}

export function Management() {
  const { pathname } = useLocation();
  const { section, rest } = readManagementPath(pathname);

  let body: ReactNode;
  if (section === 'indexPatterns') body = <IndexPatternsSection rest={rest} />;
  else if (section === 'objects') body = <SavedObjectsSection rest={rest} />;
  else if (section === 'settings') body = <AdvancedSettings query={rest[0]} />;
  else body = <Landing />;

  return (
    <div className="mgtFrame" data-test-subj="managementApp">
      <nav className="mgtNav" aria-label="Dashboards Management">
        <h2 className="mgtNav__title">
          <Link to={MANAGEMENT_ROOT}>Dashboards Management</Link>
        </h2>
        <ul>
          {SECTIONS.map((item) => (
            <li key={item.id}>
              <Link to={sectionPath(item.id)} className={cx('mgtNav__link', section === item.id && 'mgtNav__link--active')} testId={item.id}>
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="mgtBody">{body}</div>
    </div>
  );
}

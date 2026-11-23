/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Dashboards Management: index patterns, saved objects and advanced settings, at the addresses
 * OpenSearch Dashboards gives them (`/app/management/opensearch-dashboards/<section>/…`, and the
 * short ones, `/app/indexPatterns`, `/app/objects` and `/app/settings`).
 */

import type { ReactNode } from 'react';
import { useLocation } from '../../router';
import { ManagementLanding, ManagementNav, readManagementPath } from './frame';
import { AdvancedSettings } from './settings';
import { IndexPatternsSection } from './index_patterns';
import { SavedObjectsSection } from './saved_objects';
import '../../styles/management.css';

export { MANAGEMENT_ROOT, SECTION_ROOT, readManagementPath, sectionPath } from './frame';

export function Management() {
  const { pathname } = useLocation();
  const { section, rest, alone } = readManagementPath(pathname);

  let body: ReactNode;
  if (section === 'indexPatterns') body = <IndexPatternsSection rest={rest} />;
  else if (section === 'objects') body = <SavedObjectsSection rest={rest} />;
  else if (section === 'settings') body = <AdvancedSettings query={rest[0]} />;
  else body = <ManagementLanding />;

  // On a short address the original mounts the page alone, in a transparent page of its own
  if (alone) {
    return (
      <main className="mgtAlone" data-test-subj="managementApp">
        {body}
      </main>
    );
  }
  return (
    <div className="mgtFrame" data-test-subj="managementApp">
      <ManagementNav selected={section} />
      <main className="mgtBody">{body}</main>
    </div>
  );
}

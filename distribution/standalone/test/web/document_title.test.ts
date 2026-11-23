/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The tab's title of each application, as OpenSearch Dashboards 3.9.0 sets it: measured on the
 * fork's build, opening each address afresh, with the product's name "InfraDashboard".
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseLocation } from '../../web/lib/url';
import { documentTitleOf, type Breadcrumb } from '../../web/shell/state';

const NAME = 'InfraDashboard';

/** The title of the page at `address` whose trail is `crumbs` (only their text counts) */
function titleAt(address: string, ...crumbs: string[]): string {
  const url = new URL(address, 'http://localhost');
  const trail: Breadcrumb[] = crumbs.map((text) => ({ text }));
  return documentTitleOf(parseLocation('', url), trail, NAME);
}

describe('the title of the tab', () => {
  it('names a page by the last crumb of its trail, not by the first one too', () => {
    assert.equal(titleAt('/app/dashboards#/list', 'Dashboards'), 'Dashboards - InfraDashboard');
    assert.equal(
      titleAt('/app/dashboards#/view/edf84fe0-e1a0-11e7-b6d5-4dc382ef7f5b', 'Dashboards', '[Logs] Web Traffic'),
      '[Logs] Web Traffic - InfraDashboard'
    );
    assert.equal(titleAt('/app/visualize#/', 'Visualize'), 'Visualize - InfraDashboard');
    assert.equal(titleAt('/app/dev_tools#/console', 'Dev Tools'), 'Dev Tools - InfraDashboard');
  });

  it('names a dashboard that is edited by its title, and a new one not at all', () => {
    const edit = '/app/dashboards#/view/edf84fe0-e1a0-11e7-b6d5-4dc382ef7f5b?_a=(viewMode:edit)';
    assert.equal(titleAt(edit, 'Dashboards', 'Editing [Logs] Web Traffic'), '[Logs] Web Traffic - InfraDashboard');
    assert.equal(titleAt(edit, 'Dashboards', 'Editing [Logs] Web Traffic (unsaved)'), '[Logs] Web Traffic - InfraDashboard');
    // A dashboard called so, in view mode, keeps its whole title
    assert.equal(titleAt('/app/dashboards#/view/a1', 'Dashboards', 'Editing notes'), 'Editing notes - InfraDashboard');
    assert.equal(titleAt('/app/dashboards#/create?_a=(viewMode:edit)', 'Dashboards', 'Editing New Dashboard'), NAME);
  });

  it('names Discover after itself, and a saved search after both', () => {
    assert.equal(titleAt('/app/data-explorer/discover#/', 'Discover'), 'Discover - InfraDashboard');
    assert.equal(
      titleAt('/app/discover#/view/571aaf70-4c88-11e8-b3d7-01146121b73d', 'Discover', '[Flights] Flight Log'),
      'Discover: [Flights] Flight Log - InfraDashboard'
    );
    assert.equal(titleAt('/app/data-explorer/discover#/doc/p1/logs?id=a1', 'Discover', 'logs#a1'), 'Discover - InfraDashboard');
    assert.equal(titleAt('/app/data-explorer/discover#/context/p1/a1', 'Discover', 'Context of #a1'), 'Discover - InfraDashboard');
  });

  it('names every page of Home "Home"', () => {
    assert.equal(titleAt('/app/home', 'Home'), 'Home - InfraDashboard');
    assert.equal(titleAt('/app/home#/tutorial_directory', 'Home', 'Add data'), 'Home - InfraDashboard');
  });

  it('names the pages of Dashboards Management as the original’s applications do', () => {
    const management = 'Dashboards Management';
    assert.equal(titleAt('/app/management', management), NAME);
    assert.equal(
      titleAt('/app/management/opensearch-dashboards/indexPatterns', management, 'Index patterns'),
      'Index patterns - InfraDashboard'
    );
    assert.equal(
      titleAt('/app/management/opensearch-dashboards/indexPatterns/patterns/p1', management, 'Index patterns', 'logs'),
      'logs - InfraDashboard'
    );
    assert.equal(
      titleAt('/app/management/opensearch-dashboards/indexPatterns/create', management, 'Index patterns', 'Create index pattern'),
      'Create index pattern - InfraDashboard'
    );
    assert.equal(titleAt('/app/management/opensearch-dashboards/objects', management, 'Saved objects'), 'Saved Objects - InfraDashboard');
    assert.equal(
      titleAt('/app/management/opensearch-dashboards/objects/savedDashboards/a1', management, 'Saved objects', 'Edit dashboard'),
      'Saved Objects - InfraDashboard'
    );
    assert.equal(titleAt('/app/management/opensearch-dashboards/settings', management, 'Advanced settings'), NAME);
    assert.equal(titleAt('/app/settings', 'Advanced settings'), NAME);
  });

  it('leaves the product’s name alone on the applications that never set a title', () => {
    assert.equal(titleAt('/app/opensearch-query-workbench', 'Query Workbench'), NAME);
    assert.equal(titleAt('/app/opensearch_index_management_dashboards#/indices', 'Index Management', 'Indexes'), NAME);
    assert.equal(titleAt('/app/opensearch_snapshot_management_dashboards#/snapshots', 'Snapshot Management', 'Snapshots'), NAME);
  });
});

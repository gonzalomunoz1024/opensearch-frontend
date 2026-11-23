/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  MANAGEMENT_CRUMB,
  ManagementLanding,
  ManagementNav,
  managementTrail,
  readManagementPath,
  sectionCrumb,
} from '../../web/apps/management/frame';
import { MANAGEMENT_CRUMB as OBJECTS_SECTION_CRUMB, OBJECTS_CRUMB } from '../../web/apps/management/saved_objects_parts';

const count = (text: string, part: string) => text.split(part).length - 1;

describe('where a path of Dashboards Management leads', () => {
  it('reads the application and what follows it on the long address, in the frame', () => {
    assert.deepEqual(readManagementPath('/app/management/opensearch-dashboards/indexPatterns/patterns/a%20b'), {
      section: 'indexPatterns',
      rest: ['patterns', 'a b'],
      alone: false,
    });
    assert.deepEqual(readManagementPath('/app/management/opensearch-dashboards/settings'), {
      section: 'settings',
      rest: [],
      alone: false,
    });
  });

  it('stands advanced settings alone on its short address, as the original mounts it outside the frame', () => {
    assert.deepEqual(readManagementPath('/app/settings'), { section: 'settings', rest: [], alone: true });
    assert.deepEqual(readManagementPath('/app/settings/dateFormat:tz'), {
      section: 'settings',
      rest: ['dateFormat:tz'],
      alone: true,
    });
  });

  it('has no short address for index patterns and saved objects, which 3.9.0 does not know', () => {
    for (const path of ['/app/objects', '/app/objects/savedDashboards/edf84fe0', '/app/indexPatterns']) {
      assert.deepEqual(readManagementPath(path), { rest: [], alone: false }, path);
    }
  });

  it('opens the landing page on the root, with or without its last slash, and on what it does not know', () => {
    for (const path of ['/app/management', '/app/management/', '/app/management/opensearch-dashboards/dataSources']) {
      assert.deepEqual(readManagementPath(path), { rest: [], alone: false }, path);
    }
    assert.equal(readManagementPath('/app/settingsx').section, undefined);
  });
});

describe('the side navigation of Dashboards Management', () => {
  const draw = () => renderToStaticMarkup(<ManagementNav selected="objects" />);

  it('is named by the original’s heading for screen readers', () => {
    const out = draw();
    assert.match(out, /^<h2 id="stack-management-nav-header" class="atlScreenReaderOnly">Management<\/h2><nav class="mgtNav" aria-labelledby="stack-management-nav-header">/);
  });

  it('folds under a button in a narrow window, which says what it unfolds', () => {
    const out = draw();
    const controls = /aria-controls="([^"]+)" aria-expanded="false"/.exec(out)?.[1] ?? '';
    assert.notEqual(controls, '', 'the button names what it controls');
    assert.equal(count(out, `id="${controls}" class="mgtNav__content"`), 1);
    assert.match(out, /<span class="mgtNav__mobileToggleText">Management menu<\/span>/);
  });

  it('heads its links with the section, not a link, its name titled and marked with its tip', () => {
    const out = draw();
    assert.match(out, /<div class="mgtNav__heading" data-test-subj="opensearch-dashboards">/);
    assert.match(out, /<span class="mgtNav__headingLabel" title="Dashboards Management">/);
    assert.match(out, /<span class="mgtNav__headingText">Dashboards Management<\/span>/);
    assert.equal(count(out, '<a '), 3);
  });

  it('links each application of the section where the original does, the one open marked', () => {
    const out = draw();
    const links = [...out.matchAll(/<a class="([^"]+)" href="([^"]+)" rel="noreferrer" data-test-subj="([^"]+)"><span class="mgtNav__linkContent"><span class="mgtNav__linkLabel" title="([^"]+)">/g)].map(
      (match) => [match[3], match[2], match[4], match[1]]
    );
    assert.deepEqual(links, [
      ['indexPatterns', '/app/management/opensearch-dashboards/indexPatterns', 'Index patterns', 'mgtNav__link'],
      ['objects', '/app/management/opensearch-dashboards/objects', 'Saved objects', 'mgtNav__link mgtNav__link--selected'],
      ['settings', '/app/management/opensearch-dashboards/settings', 'Advanced settings', 'mgtNav__link'],
    ]);
    assert.equal(count(renderToStaticMarkup(<ManagementNav />), 'mgtNav__link--selected'), 0);
  });
});

describe('the trail of the pages of Dashboards Management', () => {
  it('starts at the section, linked to its root with the last slash, as the original', () => {
    assert.deepEqual(MANAGEMENT_CRUMB, { text: 'Dashboards Management', to: '/app/management/' });
    assert.equal(OBJECTS_SECTION_CRUMB, MANAGEMENT_CRUMB);
  });

  it('links an application to its root with the last slash, on the application’s first page too', () => {
    assert.deepEqual(sectionCrumb('indexPatterns'), {
      text: 'Index patterns',
      to: '/app/management/opensearch-dashboards/indexPatterns/',
    });
    assert.deepEqual(sectionCrumb('objects'), { text: 'Saved objects', to: '/app/management/opensearch-dashboards/objects/' });
    assert.deepEqual(OBJECTS_CRUMB, sectionCrumb('objects'));
  });

  it('has only the page’s own crumb on the short address of advanced settings', () => {
    const own = [{ text: 'Advanced settings' }];
    assert.deepEqual(managementTrail('/app/settings', own), own);
    assert.deepEqual(managementTrail('/app/management/opensearch-dashboards/settings', own), [MANAGEMENT_CRUMB, ...own]);
  });
});

describe('the landing page of Dashboards Management', () => {
  it('says what the original says, in its panel', () => {
    const out = renderToStaticMarkup(<ManagementLanding />);
    assert.match(out, /^<div class="mgtLanding"><div class="mgtLanding__panel" data-test-subj="managementHome">/);
    assert.match(out, /<h1 class="atlTitleL">Welcome to Dashboards Management<\/h1>/);
    assert.match(out, />Manage your index patterns, saved objects, OpenSearch Dashboards settings, and more\.<\/p>/);
    assert.match(out, /<hr class="mgtLanding__rule"\/>/);
    assert.match(out, />A complete list of apps is in the menu on the left\.<\/p>/);
  });
});

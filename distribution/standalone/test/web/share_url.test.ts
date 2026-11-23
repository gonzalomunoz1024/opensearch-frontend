/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  EMBED_DEFAULTS,
  embeddableUrl,
  iframeTag,
  savedObjectUrl,
  snapshotUrl,
} from '../../web/lib/share_url';

// A dashboard of the sample data as the original's address bar holds it, and the links its share
// menu made of it, copied from the original
const DASHBOARD =
  "http://localhost:5601/app/dashboards#/view/edf84fe0-e1a0-11e7-b6d5-4dc382ef7f5b?_g=(filters:!(),refreshInterval:(pause:!f,value:900000),time:(from:now-7d,to:now))&_a=(description:'Analyze%20mock%20web%20traffic%20log%20data%20for%20OpenSearch!'s%20website',filters:!(),fullScreenMode:!f,options:(hidePanelTitles:!f,useMargins:!t),query:(language:kuery,query:''),timeRestore:!t,title:'%5BLogs%5D%20Web%20Traffic',viewMode:view)";
const DASHBOARD_SAVED =
  'http://localhost:5601/app/dashboards#/view/edf84fe0-e1a0-11e7-b6d5-4dc382ef7f5b?_g=%28filters%3A%21%28%29%2CrefreshInterval%3A%28pause%3A%21f%2Cvalue%3A900000%29%2Ctime%3A%28from%3Anow-7d%2Cto%3Anow%29%29';
const SOME_OPTIONS = { topMenu: true, query: false, timeFilter: true, filterBar: false };

describe('the links of the share menu', () => {
  it('shares what is on screen by the address of the page', () => {
    assert.equal(snapshotUrl(DASHBOARD), DASHBOARD);
    assert.equal(
      snapshotUrl(DASHBOARD, true),
      DASHBOARD.replace('#/view/edf84fe0-e1a0-11e7-b6d5-4dc382ef7f5b?', '#/view/edf84fe0-e1a0-11e7-b6d5-4dc382ef7f5b?embed=true&')
    );
  });

  it('puts embed=true first after the first question mark, or adds a query for it', () => {
    assert.equal(embeddableUrl('http://localhost:5601/app/visualize#/edit/1?_g=(a:1)&_a=(b:2)'), 'http://localhost:5601/app/visualize#/edit/1?embed=true&_g=(a:1)&_a=(b:2)');
    assert.equal(embeddableUrl('http://localhost:5601/app/visualize#/edit/1'), 'http://localhost:5601/app/visualize#/edit/1?embed=true');
  });

  it('shares the saved object by its page with the global state only, encoded as a form', () => {
    assert.equal(savedObjectUrl(DASHBOARD), DASHBOARD_SAVED);
    assert.equal(
      savedObjectUrl(
        "http://localhost:5601/app/data-explorer/discover#/view/3ba638e0-b894-11e8-a6d9-e546fe2bba5f?_g=(filters:!(),time:(from:now-15m,to:now))&_q=(query:(language:kuery,query:'a b'))"
      ),
      'http://localhost:5601/app/data-explorer/discover#/view/3ba638e0-b894-11e8-a6d9-e546fe2bba5f?_g=%28filters%3A%21%28%29%2Ctime%3A%28from%3Anow-15m%2Cto%3Anow%29%29'
    );
    // A page without global state still names it, empty; an address without a fragment has none
    assert.equal(savedObjectUrl('http://localhost:5601/app/visualize#/edit/1?_a=(x:1)'), 'http://localhost:5601/app/visualize#/edit/1?_g=');
    assert.equal(savedObjectUrl('http://localhost:5601/app/visualize'), undefined);
  });

  it("writes a dashboard's embed options after everything else, in the original's order", () => {
    // The options as they start write nothing
    assert.equal(snapshotUrl(DASHBOARD, true, EMBED_DEFAULTS), snapshotUrl(DASHBOARD, true));
    assert.equal(
      snapshotUrl(DASHBOARD, true, SOME_OPTIONS),
      `${snapshotUrl(DASHBOARD, true)}&show-top-menu=true&show-time-filter=true&hide-filter-bar=true`
    );
    assert.equal(
      savedObjectUrl(DASHBOARD, true, SOME_OPTIONS),
      'http://localhost:5601/app/dashboards#/view/edf84fe0-e1a0-11e7-b6d5-4dc382ef7f5b?embed=true&_g=%28filters%3A%21%28%29%2CrefreshInterval%3A%28pause%3A%21f%2Cvalue%3A900000%29%2Ctime%3A%28from%3Anow-7d%2Cto%3Anow%29%29&show-top-menu=true&show-time-filter=true&hide-filter-bar=true'
    );
    assert.equal(
      snapshotUrl('http://localhost:5601/app/dashboards#/view/1', true, { ...EMBED_DEFAULTS, query: true }),
      'http://localhost:5601/app/dashboards#/view/1?embed=true&show-query-input=true'
    );
  });

  it('embeds a page in a frame of 800 by 600', () => {
    assert.equal(
      iframeTag('http://localhost:5601/goto/37cdec911e1add5b3bc6122b0bcfe2f1'),
      '<iframe src="http://localhost:5601/goto/37cdec911e1add5b3bc6122b0bcfe2f1" height="600" width="800"></iframe>'
    );
  });
});

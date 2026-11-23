/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { Http } from '../../web/services/http';
import { HeaderBreadcrumbs } from '../../web/shell/header_breadcrumbs';
import { HELP_LINKS, HelpMenuContent } from '../../web/shell/help_menu';
import { countRequests, loadingCount, subscribeLoadingCount, trackLoading } from '../../web/shell/loading_count';

const count = (text: string, part: string) => text.split(part).length - 1;

describe('the trail of the header, drawn', () => {
  it('draws a page’s one crumb as where the page is, first and last at once', () => {
    const out = renderToStaticMarkup(<HeaderBreadcrumbs breadcrumbs={[{ text: 'Home' }]} limit={6} />);
    assert.match(out, /^<nav class="shlCrumbs shlCrumbs--truncate shlHeader__crumbs" aria-label="breadcrumb" data-test-subj="breadcrumbs">/);
    assert.match(out, /<div class="shlCrumbWall shlCrumbWall--single"><div class="shlCrumbWrapper shlCrumbWrapper--first shlCrumbWrapper--last">/);
    assert.match(out, /<span class="shlCrumb shlCrumb--last" title="Home" aria-current="page" data-test-subj="breadcrumb first last">Home<\/span>/);
  });

  it('shows the original’s fall-back for a page that set no trail', () => {
    const out = renderToStaticMarkup(<HeaderBreadcrumbs breadcrumbs={[]} limit={6} />);
    assert.match(out, /data-test-subj="breadcrumb first last">Overview<\/span>/);
  });

  it('draws a crumb that leads somewhere as a link, the last one too, and only the first behind a wall', () => {
    const out = renderToStaticMarkup(
      <HeaderBreadcrumbs
        breadcrumbs={[
          { text: 'Dashboards Management', to: '/app/management' },
          { text: 'Index patterns', to: '/app/management/opensearch-dashboards/indexPatterns' },
        ]}
        limit={6}
      />
    );
    assert.match(out, /<div class="shlCrumbWall"><div class="shlCrumbWrapper shlCrumbWrapper--first"><a class="shlCrumb" href="\/app\/management" rel="noreferrer" title="Dashboards Management" data-test-subj="breadcrumb first">/);
    assert.match(out, /<\/div><\/div><div class="shlCrumbWrapper shlCrumbWrapper--last"><a class="shlCrumb shlCrumb--last" href="\/app\/management\/opensearch-dashboards\/indexPatterns" rel="noreferrer" title="Index patterns" data-test-subj="breadcrumb last">/);
    // A link says where it leads; it is not marked as the page
    assert.equal(count(out, 'aria-current'), 0);
  });

  it('says of every crumb that is not a link whether it is the page', () => {
    const out = renderToStaticMarkup(
      <HeaderBreadcrumbs breadcrumbs={[{ text: 'Visualize' }, { text: 'Create' }]} limit={6} />
    );
    assert.match(out, /aria-current="false" data-test-subj="breadcrumb first">Visualize</);
    assert.match(out, /aria-current="page" data-test-subj="breadcrumb last">Create</);
  });

  it('folds the crumbs a narrow window has no room for into a "…" before the last', () => {
    const crumbs = [{ text: 'Index Management', to: '/a' }, { text: 'Indexes', to: '/b' }, { text: 'logs-1' }];
    const narrow = renderToStaticMarkup(<HeaderBreadcrumbs breadcrumbs={crumbs} limit={1} />);
    assert.match(narrow, /^<nav[^>]*><div class="shlCrumbWrapper shlCrumbWrapper--collapsed"><div class="shlHeaderPopoverAnchor shlCrumb shlCrumb--collapsed"><span class="shlHeaderPopover__anchor" style="display:inline-block;min-width:0"><button type="button" class="shlCrumb__more" aria-label="Show collapsed breadcrumbs" title="Show collapsed breadcrumbs">… <svg/);
    // Closed, the "…" holds nothing; the last crumb keeps the subject of its place in the trail
    assert.equal(count(narrow, 'Index Management'), 0);
    assert.equal(count(narrow, 'Indexes'), 0);
    assert.match(narrow, /<div class="shlCrumbWrapper shlCrumbWrapper--last"><span class="shlCrumb shlCrumb--last" title="logs-1" aria-current="page" data-test-subj="breadcrumb last">logs-1<\/span><\/div><\/nav>$/);

    // With room for two, the first stays and the middle one is folded
    const two = renderToStaticMarkup(<HeaderBreadcrumbs breadcrumbs={crumbs} limit={2} />);
    assert.equal(count(two, 'Index Management'), 2);
    assert.equal(count(two, 'Indexes'), 0);
    assert.ok(two.indexOf('breadcrumb first') < two.indexOf('shlCrumb__more'));
    assert.ok(two.indexOf('shlCrumb__more') < two.indexOf('breadcrumb last'));
  });
});

describe('the help menu', () => {
  it('holds the original’s four links under its title and the version', () => {
    const out = renderToStaticMarkup(<HelpMenuContent version="3.9.0" />);
    assert.match(out, /<h2>Help<\/h2><div class="shlHelp__version">v 3\.9\.0<\/div>/);
    const links = [...out.matchAll(/<a class="shlHelp__link" href="([^"]*)" target="_blank" rel="noopener noreferrer">(?:<svg.*?<\/svg>)?<span class="shlHelp__linkText">([^<]*)<\/span><\/a>/g)];
    assert.deepEqual(
      links.map((match) => [match[2], match[1]]),
      [
        ['Documentation', HELP_LINKS.documentation],
        ['Community', HELP_LINKS.community],
        ['Give feedback', HELP_LINKS.feedback],
        ['Open an issue in GitHub', HELP_LINKS.issue],
      ]
    );
    assert.equal(HELP_LINKS.issue, 'https://github.com/opensearch-project/OpenSearch-Dashboards/issues/new/choose');
    // Only the link to GitHub carries a mark
    assert.equal(count(out, '<svg'), 1);
    assert.equal(count(out, '<h3'), 0);
  });

  it('ends with what the application adds: its name and its documentation', () => {
    const out = renderToStaticMarkup(
      <HelpMenuContent
        version="3.9.0"
        extension={{ appName: 'Dev Tools', documentation: 'https://opensearch.org/docs/latest/dashboards/dev-tools/index-dev/' }}
      />
    );
    assert.match(
      out,
      /<hr class="shlHelp__rule"\/><h3 class="shlHelp__app">Dev Tools<\/h3><a class="shlHelp__link" href="https:\/\/opensearch\.org\/docs\/latest\/dashboards\/dev-tools\/index-dev\/" target="_blank" rel="noopener noreferrer"><span class="shlHelp__linkText">Documentation<\/span><\/a><\/div>$/
    );
  });
});

describe('the count of what is loading', () => {
  it('counts something until it settles, whichever way, and tells who listens', async () => {
    const seen: number[] = [];
    const stop = subscribeLoadingCount(() => seen.push(loadingCount()));
    let finish: (value: string) => void = () => undefined;
    let fail: (reason: Error) => void = () => undefined;
    const first = trackLoading(new Promise<string>((resolve) => (finish = resolve)));
    const second = trackLoading(new Promise<string>((_resolve, reject) => (fail = reject)));
    assert.equal(loadingCount(), 2);
    finish('done');
    assert.equal(await first, 'done');
    await Promise.resolve();
    assert.equal(loadingCount(), 1);
    fail(new Error('no'));
    await second.catch(() => undefined);
    await Promise.resolve();
    assert.equal(loadingCount(), 0);
    assert.deepEqual(seen, [1, 2, 1, 0]);
    stop();
  });

  it('counts the requests of the one way to the server, each once', async () => {
    const http = new Http('/base');
    const asked: string[] = [];
    let answer: (value: unknown) => void = () => undefined;
    http.fetch = function <T = unknown>(path: string): Promise<T> {
      asked.push(path);
      return new Promise<unknown>((resolve) => (answer = resolve)) as Promise<T>;
    };
    countRequests(http);
    countRequests(http);
    const pending = http.get<{ ok: boolean }>('/api/status');
    assert.deepEqual(asked, ['/api/status']);
    assert.equal(loadingCount(), 1);
    answer({ ok: true });
    assert.deepEqual(await pending, { ok: true });
    await Promise.resolve();
    assert.equal(loadingCount(), 0);
  });
});

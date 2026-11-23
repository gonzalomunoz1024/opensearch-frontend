/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The links the share menu hands out, made as the share plugin of OpenSearch Dashboards makes
 * them (its `UrlPanelContent`): the page's own address for a snapshot, its app's page with the
 * global state only for the saved object, `embed=true` first in the query of a page to embed, a
 * dashboard's embed options after everything else, and the tag that embeds it.
 */

/** What a dashboard shown inside another page keeps of its own page, as its "Include" options */
export interface EmbedOptions {
  topMenu: boolean;
  query: boolean;
  timeFilter: boolean;
  filterBar: boolean;
}

/** The original's: only the filter bar */
export const EMBED_DEFAULTS: EmbedOptions = { topMenu: false, query: false, timeFilter: false, filterBar: true };

/** The parameters of the options, in the original's order; each is written only when it is true */
const EMBED_PARAMS: ReadonlyArray<[string, (options: EmbedOptions) => boolean]> = [
  ['show-top-menu', (options) => options.topMenu],
  ['show-query-input', (options) => options.query],
  ['show-time-filter', (options) => options.timeFilter],
  ['hide-filter-bar', (options) => !options.filterBar],
];

/** The address of a page shown inside another: `embed=true` put first after the first `?` */
export function embeddableUrl(url: string): string {
  return url.includes('?') ? url.replace('?', '?embed=true&') : `${url}?embed=true`;
}

/** A link as a page to embed when asked, with the options of a dashboard's after everything else */
function withParams(url: string, embed: boolean, options?: EmbedOptions): string {
  const embedded = embed ? embeddableUrl(url) : url;
  if (!options) return embedded;
  return EMBED_PARAMS.reduce((link, [name, isOn]) => (isOn(options) ? `${link}&${name}=true` : link), embedded);
}

/** The link to what is on screen: the address of the page, as the original's `getSnapshotUrl` */
export function snapshotUrl(href: string, embed = false, options?: EmbedOptions): string {
  return withParams(href, embed, options);
}

/**
 * The link to the saved object, as the original's `getSavedObjectUrl`: the page of its app the
 * fragment names, with the global state (`_g`) as a form encodes it, and nothing of the app's own
 * state, so that it opens as it was last saved. Nothing for an address without a fragment.
 */
export function savedObjectUrl(href: string, embed = false, options?: EmbedOptions): string | undefined {
  const page = new URL(href);
  if (!page.hash) return undefined;
  const app = new URL(page.hash.slice(1), page.origin);
  const appPage = new URL(app.pathname, app.origin);
  appPage.search = new URLSearchParams({ _g: app.searchParams.get('_g') ?? '' }).toString();
  const link = new URL(page.pathname, page.origin);
  link.hash = appPage.toString().substring(appPage.origin.length);
  return withParams(link.toString(), embed, options);
}

/** What another page puts in its own to show this one, as the original writes it */
export function iframeTag(url: string): string {
  return `<iframe src="${url}" height="600" width="800"></iframe>`;
}

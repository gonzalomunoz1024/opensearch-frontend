/* SPDX-License-Identifier: Apache-2.0 */

/*
 * A short address for a long one, made as the share plugin of OpenSearch Dashboards makes it: the
 * server keeps the address without the site and the base path, and answers with the id that
 * `/goto/` opens.
 */

import type { Http } from './http';

/** What the server keeps of an address: its path without the base path, its query and fragment */
export function relativeUrl(absoluteUrl: string, basePath: string): string {
  const parsed = new URL(absoluteUrl);
  parsed.pathname = parsed.pathname.replace(basePath, '');
  return parsed.toString().substring(parsed.origin.length);
}

/** The address that opens the short URL of that id, on the site of the long one */
export function gotoUrl(urlId: string, basePath: string, siteOf: string): string {
  return new URL(`${basePath}/goto/${urlId}`, new URL(siteOf).origin).toString();
}

export async function shortenUrl(http: Http, absoluteUrl: string): Promise<string> {
  const { urlId } = await http.post<{ urlId: string }>('/api/shorten_url', {
    body: { url: relativeUrl(absoluteUrl, http.basePath) },
  });
  return gotoUrl(urlId, http.basePath, absoluteUrl);
}

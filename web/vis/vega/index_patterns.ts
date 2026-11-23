/* SPDX-License-Identifier: Apache-2.0 */

/* The index patterns a Vega spec searches: for its filters, and for the filter bar of its page. */

import { parseHjson } from '../../lib/hjson';
import type { IndexPattern } from '../../lib/types';
import { services } from '../../services';

/** The `index` of each search at the top of a spec's data, in order */
export function extractIndexPatternTitles(spec: unknown): string[] {
  const data = (spec as { data?: unknown } | undefined)?.data;
  const list = Array.isArray(data) ? data : data ? [data] : [];
  return list
    .map((item: { url?: { index?: unknown } } | undefined) => item?.url?.index)
    .filter((index): index is string => typeof index === 'string' && index !== '');
}

interface FindAnswer {
  saved_objects: Array<{ id: string }>;
}

/** The ids of the index patterns whose title matches a search, best first, as the original finds them */
async function findIds(search: string): Promise<string[]> {
  const answer = await services.http.get<FindAnswer>('/api/saved_objects/_find', {
    query: { type: 'index-pattern', fields: ['title'], search, search_fields: ['title'], per_page: 10 },
  });
  return answer.saved_objects.map((object) => object.id);
}

/** The id of the index pattern a title finds first; the default index pattern's without a title */
export async function findIndexPatternId(title?: string): Promise<string | undefined> {
  if (!title) return services.indexPatterns.defaultId();
  const [first] = await findIds(title);
  return first;
}

/** The index patterns a saved spec searches; none when the spec cannot be read */
export async function specIndexPatterns(specText: unknown): Promise<IndexPattern[]> {
  try {
    const spec = parseHjson(String(specText), { legacyRoot: false, keepWsc: true });
    const ids = (await Promise.all(extractIndexPatternTitles(spec).map((title) => findIds(title)))).flat();
    return await Promise.all(ids.map((id) => services.indexPatterns.get(id)));
  } catch {
    return [];
  }
}

/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The answer of a search, as the original's search strategy hands it on (shimHitsTotal in
 * src/plugins/data/server/search/opensearch_search): the total of the hits is a number.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Http } from '../../web/services/http';
import { SearchService, type RequestRecord } from '../../web/services/search';

const answering = (response: unknown) =>
  new SearchService({ post: async () => JSON.parse(JSON.stringify(response)) } as unknown as Http, () => ({
    maxConcurrentShardRequests: 0,
  }));

describe('the answer of a search', () => {
  it('has the total of its hits as a number, in what the page reads and in what Inspect shows', async () => {
    const service = answering({ hits: { total: { value: 14074, relation: 'eq' }, hits: [] } });
    const record: RequestRecord = { name: 'Data', index: 'logs', body: {}, startedAt: 0 };
    const response = await service.search('logs', { size: 0 }, { record });
    assert.equal(response.hits.total, 14074);
    assert.equal((record.response as { hits: { total: unknown } }).hits.total, 14074);
  });

  it('keeps a total that is already a number', async () => {
    const response = await answering({ hits: { total: 3, hits: [] } }).search('logs', {});
    assert.equal(response.hits.total, 3);
  });
});

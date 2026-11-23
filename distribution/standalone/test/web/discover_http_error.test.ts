/* SPDX-License-Identifier: Apache-2.0 */

/*
 * A request the browser cannot send (the connection drops), as the original's http service tells
 * it: in the browser's own words. Measured on the reference with Discover's search aborted under
 * it: "Search Error Failed to fetch".
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Http, HttpFetchError } from '../../web/services/http';

/** What a request fails with when the browser's fetch fails as given */
async function failureOf(thrown: unknown): Promise<unknown> {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw thrown;
  }) as typeof fetch;
  try {
    await new Http('').get('/api/saved_objects/_find');
    return undefined;
  } catch (error) {
    return error;
  } finally {
    globalThis.fetch = original;
  }
}

describe('a request the browser cannot send', () => {
  it('fails in the browser\'s words, as the original\'s: "Failed to fetch"', async () => {
    const failure = await failureOf(new TypeError('Failed to fetch'));
    assert.ok(failure instanceof HttpFetchError);
    const fetchError = failure as HttpFetchError;
    assert.equal(fetchError.message, 'Failed to fetch');
    assert.equal(fetchError.status, 0);
  });

  it('lets a request that was called off fail as it does', async () => {
    const aborted = new DOMException('This operation was aborted', 'AbortError');
    assert.equal(await failureOf(aborted), aborted);
  });
});

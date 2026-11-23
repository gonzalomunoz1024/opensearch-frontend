/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { legacyRequest } from '../../server/legacy_client';

describe('an endpoint the old client library does not have', () => {
  it('is refused in the words of that library, whatever it is called', () => {
    for (const name of ['nosuch.endpoint', 'constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      assert.throws(() => legacyRequest(name, {}), {
        message: `called with an invalid endpoint: ${name}`,
      });
    }
  });

  it('an endpoint it has is still built', () => {
    assert.deepEqual(legacyRequest('indices.getSettings', { index: 'logs-1' }), {
      method: 'GET',
      path: '/logs-1/_settings',
      body: undefined,
    });
  });
});

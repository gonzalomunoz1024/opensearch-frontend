/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { gotoUrl, relativeUrl } from '../../web/services/short_urls';

describe('short URLs in the browser', () => {
  it('keeps of an address its path without the base path, its query and its fragment', () => {
    assert.equal(
      relativeUrl("http://localhost:5601/app/dashboards#/view/1?_g=(time:(from:now-15m))&_a=(t:'a')", ''),
      "/app/dashboards#/view/1?_g=(time:(from:now-15m))&_a=(t:'a')"
    );
    assert.equal(relativeUrl('https://example.test/base/app/discover?x=1#/?q=a b', '/base'), '/app/discover?x=1#/?q=a%20b');
  });

  it('opens a short URL under the base path, on the site of the address it was made from', () => {
    assert.equal(
      gotoUrl('5111b0f660e6f17d2021bd31f6fe2211', '/base', 'https://example.test:8443/base/app/home'),
      'https://example.test:8443/base/goto/5111b0f660e6f17d2021bd31f6fe2211'
    );
    assert.equal(gotoUrl('abc', '', 'http://localhost:5601/app/home#/'), 'http://localhost:5601/goto/abc');
  });
});

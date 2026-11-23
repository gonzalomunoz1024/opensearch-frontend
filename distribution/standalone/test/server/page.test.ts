/* SPDX-License-Identifier: Apache-2.0 */

/* The one page of the product, as server/static.ts writes it. */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cspNonce, renderPage, type PageOptions } from '../../server/static';

const BUILD: PageOptions['build'] = {
  version: '3.9.0',
  builtAt: '',
  assets: { script: 'assets/app.js', styles: 'assets/app.css' },
};

const page = (options: Partial<PageOptions> = {}) =>
  renderPage({ basePath: '', build: BUILD, title: 'InfraDashboard', dark: false, bootData: {}, ...options });

describe("the page's nonce", () => {
  it('is new for every page: 16 random bytes in base64, as OpenSearch Dashboards makes it', () => {
    const nonces = Array.from({ length: 50 }, () => cspNonce());
    for (const nonce of nonces) assert.match(nonce, /^[A-Za-z0-9+/]{22}==$/);
    assert.equal(new Set(nonces).size, nonces.length);
  });

  it('is written where the original writes it: a meta element of the head, and its own style element', () => {
    const html = page({ nonce: 'AAECAwQFBgcICQoLDA0ODw==' });
    assert.match(
      html,
      /<meta name="viewport" content="width=device-width, initial-scale=1">\n<meta name="csp-nonce" content="AAECAwQFBgcICQoLDA0ODw==">\n<title>/
    );
    const styles = html.match(/<style[^>]*>/g) ?? [];
    assert.deepEqual(styles, ['<style nonce="AAECAwQFBgcICQoLDA0ODw==">']);
  });

  it('is left out of a page made without one', () => {
    const html = page();
    assert.equal(html.includes('csp-nonce'), false);
    assert.equal(html.includes('nonce='), false);
  });
});

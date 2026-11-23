/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cspNonce, stampStyleNonces } from '../../web/lib/csp_nonce';

interface FakeElement {
  name: string;
  namespace?: string | null;
  attributes: Record<string, string>;
  setAttribute(name: string, value: string): void;
}

/** A document with what the module uses: the meta element of the nonce, and the two ways to make an element */
function fakeDocument(nonce?: string) {
  const make = (name: string, namespace?: string | null): FakeElement => ({
    name,
    namespace,
    attributes: {},
    setAttribute(attribute, value) {
      this.attributes[attribute] = value;
    },
  });
  const doc = {
    querySelector: (selector: string) =>
      selector === 'meta[name="csp-nonce"]' && nonce !== undefined
        ? { getAttribute: (name: string) => (name === 'content' ? nonce : null) }
        : null,
    createElement: (name: string) => make(name),
    createElementNS: (namespace: string | null, name: string) => make(name, namespace),
  };
  return {
    document: doc as unknown as Document,
    create: (name: string) => (doc.createElement as (name: string) => FakeElement)(name),
    createNS: (namespace: string, name: string) =>
      (doc.createElementNS as (namespace: string, name: string) => FakeElement)(namespace, name),
  };
}

describe("the page's nonce in the browser", () => {
  it('is read from the meta element the server writes, as the original reads it', () => {
    assert.equal(cspNonce(fakeDocument('AAECAwQFBgcICQoLDA0ODw==').document), 'AAECAwQFBgcICQoLDA0ODw==');
    assert.equal(cspNonce(fakeDocument().document), '');
  });

  it('is put on every style element made with createElement or createElementNS, and on nothing else', () => {
    const fake = fakeDocument('n0nce');
    stampStyleNonces(fake.document);
    assert.deepEqual(fake.create('style').attributes, { nonce: 'n0nce' });
    assert.deepEqual(fake.create('STYLE').attributes, { nonce: 'n0nce' });
    assert.deepEqual(fake.create('div').attributes, {});
    assert.deepEqual(fake.create('script').attributes, {});
    const svgStyle = fake.createNS('http://www.w3.org/2000/svg', 'style');
    assert.deepEqual(svgStyle.attributes, { nonce: 'n0nce' });
    assert.equal(svgStyle.namespace, 'http://www.w3.org/2000/svg');
    assert.deepEqual(fake.createNS('http://www.w3.org/2000/svg', 'text').attributes, {});
  });

  it('leaves the document as it is when the page has no nonce', () => {
    const fake = fakeDocument();
    const { createElement, createElementNS } = fake.document;
    stampStyleNonces(fake.document);
    assert.equal(fake.document.createElement, createElement);
    assert.equal(fake.document.createElementNS, createElementNS);
    assert.deepEqual(fake.create('style').attributes, {});
  });
});

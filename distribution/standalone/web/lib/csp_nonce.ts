/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The page's nonce on every style element the browser side makes, as OpenSearch Dashboards puts it
 * there (src/legacy/ui/ui_render/bootstrap/bootstrap.js.hbs). The server's policy lets an inline
 * style element apply only when it carries the nonce of <meta name="csp-nonce">; React's <style> of
 * a TSVB Markdown panel's custom CSS is one. As in the original, document.createElement and
 * createElementNS are wrapped once, before anything is drawn, so that each style element gets the
 * nonce without the code that makes it knowing of it. web/main.tsx imports this module first.
 */

type NonceSource = Pick<Document, 'querySelector'>;

/** The nonce the server wrote into the page, or '' (the original's getNonce, src/core/public/utils/csp.ts) */
export function cspNonce(doc: NonceSource = document): string {
  return doc.querySelector('meta[name="csp-nonce"]')?.getAttribute('content') ?? '';
}

/** Makes every style element the document creates from now on carry the page's nonce; nothing without one */
export function stampStyleNonces(doc: Document): void {
  const nonce = cspNonce(doc);
  if (!nonce) return;

  const createElement = doc.createElement.bind(doc);
  doc.createElement = ((tagName: string, options?: ElementCreationOptions) => {
    const element = createElement(tagName, options);
    if (tagName.toLowerCase() === 'style') element.setAttribute('nonce', nonce);
    return element;
  }) as Document['createElement'];

  const createElementNS = doc.createElementNS.bind(doc);
  doc.createElementNS = ((namespace: string | null, qualifiedName: string, options?: string | ElementCreationOptions) => {
    const element = createElementNS(namespace, qualifiedName, options);
    if (qualifiedName.toLowerCase() === 'style') element.setAttribute('nonce', nonce);
    return element;
  }) as Document['createElementNS'];
}

if (typeof document !== 'undefined') stampStyleNonces(document);

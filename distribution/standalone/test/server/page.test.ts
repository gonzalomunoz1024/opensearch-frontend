/* SPDX-License-Identifier: Apache-2.0 */

/* The one page of the product, as server/static.ts writes it. */

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { cssString, fontFaceRules, fontFiles } from '../../server/fonts';
import { cspNonce, renderPage, type PageOptions } from '../../server/static';
import { served, type Answer } from './served';

/** The nonce of a page's meta element, and those its style elements carry */
const noncesOf = (html: string) => ({
  meta: /<meta name="csp-nonce" content="([^"]*)">/.exec(html)?.[1],
  styles: [...html.matchAll(/<style nonce="([^"]*)">/g)].map((match) => match[1]),
});

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

  it('is made by the server for each page it sends, and is the same in the meta element and on the style', async () => {
    const [first, second] = await served(['/app/home', '/app/dashboards']);
    const one = noncesOf(first.body);
    const two = noncesOf(second.body);
    assert.match(one.meta ?? '', /^[A-Za-z0-9+/]{22}==$/);
    assert.deepEqual(one.styles, [one.meta]);
    assert.deepEqual(two.styles, [two.meta]);
    assert.notEqual(one.meta, two.meta);
    // and the header of each page lets that nonce's style elements apply
    assert.ok(String(first.headers['content-security-policy']).includes(`; style-src-elem 'self' 'nonce-${one.meta}'; `));
    assert.ok(String(second.headers['content-security-policy']).includes(`; style-src-elem 'self' 'nonce-${two.meta}'; `));
  });
});

/**
 * The icons of OpenSearch Dashboards' page (src/core/server/rendering/views/template.tsx), as the
 * fork's build writes them at /app/home, with the type it sends each file with
 */
const ICONS: readonly { tag: string; type: string }[] = [
  { tag: '<link rel="apple-touch-icon" sizes="180x180" href="/ui/favicons/apple-touch-icon.png">', type: 'image/png' },
  { tag: '<link rel="icon" type="image/png" sizes="32x32" href="/ui/favicons/favicon-32x32.png">', type: 'image/png' },
  { tag: '<link rel="icon" type="image/png" sizes="16x16" href="/ui/favicons/favicon-16x16.png">', type: 'image/png' },
  { tag: '<link rel="manifest" href="/ui/favicons/manifest.json">', type: 'application/json; charset=utf-8' },
  { tag: '<link rel="mask-icon" color="#003553" href="/ui/favicons/safari-pinned-tab.svg">', type: 'image/svg+xml' },
  { tag: '<link rel="shortcut icon" href="/ui/favicons/favicon.ico">', type: 'image/x-icon' },
  { tag: '<meta name="msapplication-config" content="/ui/favicons/browserconfig.xml">', type: 'text/xml; charset=utf-8' },
];
const addressOf = (tag: string) => /(?:href|content)="([^"]*)"/.exec(tag)?.[1] ?? '';
/** Where the build takes the favicons from, and where the fork keeps those of its own build */
const STATIC_FAVICONS = join('web', 'static', 'ui', 'favicons');
const FORK_FAVICONS = join('..', '..', 'src', 'core', 'server', 'core_app', 'assets', 'favicons');

describe("the page's icons", () => {
  it('are named as the original names them, and no others', () => {
    const html = page();
    const tags = html.match(/<link rel="(?:apple-touch-icon|icon|shortcut icon|manifest|mask-icon)"[^>]*>|<meta name="msapplication-config"[^>]*>/g);
    assert.deepEqual(tags, ICONS.map(({ tag }) => tag));
  });

  it('are under the base path', () => {
    const html = page({ basePath: '/base' });
    for (const { tag } of ICONS) {
      assert.ok(html.includes(tag.replace('"/ui/favicons/', '"/base/ui/favicons/')), tag);
    }
  });

  it('are served, as the files the build copies, with the type the original sends', async () => {
    const answers = await served(ICONS.map(({ tag }) => addressOf(tag)));
    ICONS.forEach(({ tag, type }, index) => {
      const answer = answers[index];
      assert.equal(answer?.status, 200, tag);
      assert.equal(answer?.headers['content-type'], type, tag);
      const file = join(STATIC_FAVICONS, addressOf(tag).slice('/ui/favicons/'.length));
      assert.ok(answer?.bytes.equals(readFileSync(file)), tag);
    });
  });

  it("are the fork's own, byte for byte (made from distribution/branding/brand.json)", {
    skip: existsSync(FORK_FAVICONS) ? false : "the fork's tree is not beside the standalone",
  }, () => {
    const names = readdirSync(FORK_FAVICONS).sort();
    assert.deepEqual(readdirSync(STATIC_FAVICONS).sort(), names);
    for (const name of names) {
      assert.ok(readFileSync(join(STATIC_FAVICONS, name)).equals(readFileSync(join(FORK_FAVICONS, name))), name);
    }
  });
});

/*
 * What a browser reads in a page: its elements in order, the addresses its attributes hold, those of
 * the fonts' rules in its style element, and its boot data. Every '<' of the page starts an element
 * when nothing a setting holds is left unescaped.
 */
const elementsOf = (html: string) => [...html.matchAll(/<(\/?[a-z!][a-z0-9-]*)/gi)].map((match) => match[1]);
const DECODED: Readonly<Record<string, string>> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#x27;': "'" };
const addressesOf = (html: string) =>
  [...html.matchAll(/ (?:href|src|content)="([^"]*)"/g)].map((match) =>
    (match[1] ?? '').replace(/&(?:amp|lt|gt|quot|#x27);/g, (entity) => DECODED[entity] ?? entity)
  );
const writtenFontAddressesOf = (html: string) => [...html.matchAll(/url\('([^']*)'\)/g)].map((match) => match[1] ?? '');
/** What a CSS string may hold: the usual characters of a path, and escapes that end with a space */
const CSS_STRING = /^(?:[\w\-./:~%]|\\[0-9a-f]{1,6} )*$/;
const fontAddressesOf = (html: string) =>
  writtenFontAddressesOf(html).map((written) =>
    written.replace(/\\([0-9a-f]{1,6}) ?/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
  );
const bootDataOf = (html: string): unknown =>
  JSON.parse(/<script id="boot-data" type="application\/json">([^<]*)<\/script>/.exec(html)?.[1] ?? 'null');

/** Base paths that would end an attribute, a CSS string or url(), the style element or the boot data */
const HOSTILE_BASE_PATHS = [
  '/a"b',
  "/a'b",
  '/a<b',
  '/a)b',
  '/a>b&amp;c',
  '/a\\b',
  '/a\nb',
  '/café/\u{1F600}',
  '/x"y\'z<w)v</style></script><img src=x onerror=alert(1)>',
];

describe('the base path in the page', () => {
  const plain = page({ basePath: '/base', bootData: { basePath: '/base' } });
  const under = (basePath: string) => (address: string) =>
    address.startsWith('/base/') ? `${basePath}${address.slice('/base'.length)}` : address;

  it('is written as it is when it holds only the usual characters of a path', () => {
    const html = page({ basePath: '/base/sub-path_1.2~x', bootData: {} });
    assert.ok(html.includes('<link rel="shortcut icon" href="/base/sub-path_1.2~x/ui/favicons/favicon.ico">'));
    assert.ok(html.includes("url('/base/sub-path_1.2~x/ui/fonts/inter_ui/Inter-UI-Thin-BETA.woff2') format('woff2')"));
    assert.ok(html.includes('<script src="/base/sub-path_1.2~x/assets/app.js" defer></script>'));
  });

  for (const basePath of HOSTILE_BASE_PATHS) {
    it(`cannot end an attribute, the style element, a font's address or the boot data: ${JSON.stringify(basePath)}`, () => {
      const html = page({ basePath, bootData: { basePath } });
      // the same elements, in the same order, as under a plain base path
      assert.deepEqual(elementsOf(html), elementsOf(plain));
      // and every address they hold is the one under the base path, as a browser reads it back
      assert.deepEqual(addressesOf(html), addressesOf(plain).map(under(basePath)));
      assert.deepEqual(fontAddressesOf(html), fontAddressesOf(plain).map(under(basePath)));
      assert.equal(fontAddressesOf(html).length, fontFiles().length);
      for (const written of writtenFontAddressesOf(html)) assert.match(written, CSS_STRING);
      assert.deepEqual(bootDataOf(html), { basePath });
    });
  }

  it('is written in the fonts\' rules as CSS escapes, which leave no quote, bracket or "<" in the string', () => {
    assert.equal(cssString("/a'b"), '/a\\27 b');
    assert.equal(cssString('/a"b)c<d\\e\nf'), '/a\\22 b\\29 c\\3c d\\5c e\\a f');
    assert.equal(cssString('/café/\u{1F600}'), '/caf\\e9 /\\1f600 ');
    assert.equal(cssString('/base/sub-path_1.2~x:%41'), '/base/sub-path_1.2~x:%41');
    assert.equal(/x'|<\/style/.test(fontFaceRules("/x'y)z</style>")), false);
  });

  it('cannot break the page the server sends', async () => {
    const basePath = '/x"y\'z<w)v</style></script><b>';
    // each page has a nonce of its own
    const nonceless = (answer?: Answer) => (answer?.body ?? '').replace(/(<meta name="csp-nonce" content=")[^"]*/, '$1');
    const [hostileAnswer] = await served(['/app/home'], { SERVER_BASEPATH: basePath });
    const [usualAnswer] = await served(['/app/home'], { SERVER_BASEPATH: '/base' });
    assert.equal(hostileAnswer?.status, 200);
    const hostile = nonceless(hostileAnswer);
    const usual = nonceless(usualAnswer);
    assert.deepEqual(elementsOf(hostile), elementsOf(usual));
    assert.deepEqual(addressesOf(hostile), addressesOf(usual).map(under(basePath)));
    assert.deepEqual(fontAddressesOf(hostile), fontAddressesOf(usual).map(under(basePath)));
    const data = bootDataOf(hostile) as { basePath?: string; libraries?: { vega?: string } };
    assert.equal(data.basePath, basePath);
    assert.ok(data.libraries?.vega?.startsWith(`${basePath}/assets/vega.`));
  });
});

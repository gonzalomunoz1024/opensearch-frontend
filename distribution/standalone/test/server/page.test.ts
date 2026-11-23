/* SPDX-License-Identifier: Apache-2.0 */

/* The one page of the product, as server/static.ts writes it. */

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { createApp } from '../../server/app';
import { loadConfig } from '../../server/config';
import { silentLogger } from '../../server/logger';
import { cspNonce, renderPage, type PageOptions } from '../../server/static';
import { fakeOpenSearch } from './fake_opensearch';

interface Answer {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
  bytes: Buffer;
}

/** The server as it is built, with the given settings, asked for each target in turn */
async function served(targets: string[], settings: Record<string, string> = {}): Promise<Answer[]> {
  const opensearch = await fakeOpenSearch();
  let app: ReturnType<typeof createApp> | undefined;
  try {
    const { config } = loadConfig({
      env: { SERVER_HOST: '127.0.0.1', SERVER_PORT: '0', OPENSEARCH_HOSTS: JSON.stringify([opensearch.url]), ...settings },
    });
    app = createApp({ config, logger: silentLogger, distDirectory: resolve(__dirname, '..', '..') });
    await app.start();
    const { port } = app.server.address() as AddressInfo;
    const answers: Answer[] = [];
    for (const target of targets) {
      answers.push(
        await new Promise<Answer>((done, failed) => {
          const request = http.request({ host: '127.0.0.1', port, path: target, agent: false }, (response) => {
            const chunks: Buffer[] = [];
            response.on('data', (chunk: Buffer) => chunks.push(chunk));
            response.on('end', () => {
              const bytes = Buffer.concat(chunks);
              done({ status: response.statusCode ?? 0, headers: response.headers, body: bytes.toString('utf8'), bytes });
            });
          });
          request.on('error', failed);
          request.end();
        })
      );
    }
    return answers;
  } finally {
    await app?.stop();
    await opensearch.close();
  }
}

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

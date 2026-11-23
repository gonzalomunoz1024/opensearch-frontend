/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The browser side's files as server/static.ts serves them: what it finds under a name, what it
 * refuses, and how long a browser may keep each.
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { HttpError } from '../../server/http';
import { readBuild, serveStatic } from '../../server/static';
import { DIST_DIRECTORY, served } from './served';

/**
 * A public directory with a few files, beside a secret file and a directory whose name begins
 * with the public directory's own; all of it is removed after the check
 */
function withFiles(check: (publicDirectory: string) => void) {
  const root = mkdtempSync(join(tmpdir(), 'static-files-test-'));
  try {
    const publicDirectory = join(root, 'public');
    mkdirSync(join(publicDirectory, 'ui', 'favicons'), { recursive: true });
    mkdirSync(join(publicDirectory, 'assets'));
    mkdirSync(join(root, 'public-secret'));
    writeFileSync(join(publicDirectory, 'ui', 'favicons', 'favicon.ico'), 'icon');
    writeFileSync(join(publicDirectory, 'ui', 'a b €.png'), 'spaced');
    writeFileSync(join(publicDirectory, 'assets', 'app.0123456789ab.js'), 'script');
    writeFileSync(join(publicDirectory, 'assets', 'app.0123456789ab.js.br'), 'brotli');
    writeFileSync(join(root, 'secret.json'), 'secret');
    writeFileSync(join(root, 'public-secret', 'secret.json'), 'secret');
    check(publicDirectory);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const request = (headers: Record<string, string> = {}) => ({ headers }) as IncomingMessage;

/** What the server answers for a path: the file, nothing (404), or the status it refuses it with */
function answerOf(publicDirectory: string, path: string, headers: Record<string, string> = {}) {
  try {
    const reply = serveStatic(publicDirectory, request(headers), path);
    return reply
      ? { status: reply.status ?? 200, headers: reply.headers ?? {}, body: String(reply.body) }
      : { status: 404, headers: {}, body: '' };
  } catch (error) {
    return { status: error instanceof HttpError ? error.status : 500, headers: {}, body: '' };
  }
}

describe('a static file', () => {
  it('is found under its name, with the escapes of the address decoded, as the original decodes them', () => {
    withFiles((publicDirectory) => {
      for (const path of [
        '/ui/favicons/favicon.ico',
        '/ui/favicons/favicon%2Eico',
        '/ui/favicons%2Ffavicon.ico',
        '/ui/favicons/%66avicon.ico',
        '/ui/fonts/..%2Ffavicons/favicon.ico',
      ]) {
        assert.deepEqual([answerOf(publicDirectory, path).status, answerOf(publicDirectory, path).body], [200, 'icon'], path);
      }
      assert.equal(answerOf(publicDirectory, '/ui/a%20b%20%E2%82%AC.png').body, 'spaced');
    });
  });

  it('is never one outside the public directory, however the way out is written', () => {
    withFiles((publicDirectory) => {
      // the way out, once decoded: refused, as the original refuses it under /ui (403)
      for (const path of [
        '/..%2Fsecret.json',
        '/ui/..%2F..%2Fsecret.json',
        '/ui/%2E%2E%2F%2E%2E%2Fsecret.json',
        '/ui/favicons/..%2f..%2f..%2fsecret.json',
        '/..%2Fpublic-secret/secret.json',
        `/ui${'/..%2F'.repeat(20)}etc%2Fpasswd`,
      ]) {
        assert.equal(answerOf(publicDirectory, path).status, 403, path);
      }
      // a backslash is a character of a name here (a step up only where it separates names, and then
      // refused), and an escape decoded once is not decoded again
      for (const path of ['/..%5Csecret.json', '/..\\secret.json', '/ui/..%5C..%5Csecret.json', '/%252E%252E%252Fsecret.json']) {
        const { status, body } = answerOf(publicDirectory, path);
        assert.ok(status === 403 || status === 404, `${path}: ${status}`);
        assert.notEqual(body, 'secret', path);
      }
    });
  });

  it('is nothing for a NUL, a broken escape, a directory, a type the browser side does not use, or a name too long', () => {
    withFiles((publicDirectory) => {
      const answers = (paths: string[]) => paths.map((path) => answerOf(publicDirectory, path).status);
      assert.deepEqual(answers(['/ui/favicons/favicon.ico%00', '/ui/favicons/favicon.ico%00.png', '/ui/favicons/%00']), [404, 404, 404]);
      // as the original: a bad request
      assert.deepEqual(answers(['/ui/favicons/favicon%zz.ico', '/ui/favicons/%E2%82.png', '/ui/favicons/%']), [400, 400, 400]);
      assert.deepEqual(answers(['/', '/ui', '/ui/favicons', '/ui/favicons/']), [404, 404, 404, 404]);
      assert.deepEqual(answers(['/assets/app.0123456789ab.js.br', '/ui/favicons/favicon.ico.gz']), [404, 404]);
      // where the original answers 500 for a name the file system refuses
      assert.deepEqual(
        answers([
          `/ui/favicons/${'a'.repeat(300)}.ico`,
          `/ui/${'a/'.repeat(3000)}favicon.ico`,
          `/ui/${'a'.repeat(100000)}.ico`,
        ]),
        [404, 404, 404]
      );
    });
  });

  it('may be kept a year when its name carries its hash (assets/), an hour otherwise, and has no ETag', () => {
    withFiles((publicDirectory) => {
      const cacheOf = (path: string) => answerOf(publicDirectory, path).headers['cache-control'];
      assert.equal(cacheOf('/assets/app.0123456789ab.js'), 'public, max-age=31536000, immutable');
      assert.equal(cacheOf('/assets%2Fapp.0123456789ab.js'), 'public, max-age=31536000, immutable');
      // what the address names is what counts, not how it begins
      assert.equal(cacheOf('/assets/..%2Fui/favicons/favicon.ico'), 'public, max-age=3600');
      assert.equal(cacheOf('/ui/favicons/favicon.ico'), 'public, max-age=3600');
      for (const path of ['/assets/app.0123456789ab.js', '/ui/favicons/favicon.ico']) {
        assert.equal(answerOf(publicDirectory, path).headers.etag, undefined, path);
      }
    });
  });

  it('is sent in the compressed form the browser accepts, when the build made one', () => {
    withFiles((publicDirectory) => {
      const compressed = answerOf(publicDirectory, '/assets/app.0123456789ab.js', { 'accept-encoding': 'gzip, deflate, br' });
      assert.equal(compressed.body, 'brotli');
      assert.equal(compressed.headers['content-encoding'], 'br');
      assert.equal(compressed.headers.vary, 'accept-encoding');
      const plain = answerOf(publicDirectory, '/assets/app.0123456789ab.js', { 'accept-encoding': 'gzip' });
      assert.equal(plain.body, 'script');
      assert.equal(plain.headers['content-encoding'], undefined);
    });
  });
});

describe('the static files of the server as it is built', () => {
  const error = (status: number, message: string) => ({ statusCode: status, error: message, message });

  it('are refused outside the public directory as the original refuses them, and nothing outside is sent', async () => {
    const expected: Array<[string, number]> = [
      // the original: 403 under /ui; 404 at the root, where it has no route for files
      ['/ui/..%2F..%2Fbuild.json', 403],
      ['/ui/favicons/..%2f..%2f..%2fbuild.json', 403],
      ['/..%2Fbuild.json', 403],
      // the address is read first: its dots are steps up inside it, to /build.json, which is not public
      ['/ui/%2e%2e/%2e%2e/build.json', 404],
      ['/.%2e/build.json', 404],
      ['/ui/..\\..\\build.json', 404],
      ['/ui/..%5c..%5cbuild.json', 404],
      ['/ui/%252e%252e/build.json', 404],
      ['/ui/favicons/favicon.ico%00', 404],
      ['/ui/favicons/favicon%zz.ico', 400],
      // the original answers 500 for the first and the third
      [`/ui/favicons/${'a'.repeat(300)}.png`, 404],
      [`/ui/favicons/${'a/'.repeat(2000)}x.png`, 404],
      [`/ui/favicons/${'a'.repeat(10000)}.png`, 404],
    ];
    const answers = await served(expected.map(([path]) => path));
    const build = readFileSync(join(DIST_DIRECTORY, 'build.json'), 'utf8');
    expected.forEach(([path, status], index) => {
      const answer = answers[index];
      const shown = path.length > 80 ? `${path.slice(0, 40)}... (${path.length})` : path;
      assert.equal(answer?.status, status, shown);
      assert.equal(answer?.body.includes('builtAt'), false, shown);
      assert.notEqual(answer?.body, build, shown);
    });
    assert.deepEqual(JSON.parse(answers[0]?.body ?? '{}'), error(403, 'Forbidden'));
    assert.deepEqual(JSON.parse(answers[9]?.body ?? '{}'), error(400, 'Bad Request'));
  });

  it('are found with the escapes of the address decoded, as the original finds them', async () => {
    const icon = readFileSync(join(DIST_DIRECTORY, 'public', 'ui', 'favicons', 'favicon.ico'));
    const answers = await served(['/ui/favicons/favicon%2Eico', '/ui/favicons%2Ffavicon.ico', '/ui/fonts/..%2Ffavicons/favicon.ico']);
    for (const answer of answers) {
      assert.equal(answer.status, 200);
      assert.ok(answer.bytes.equals(icon));
    }
  });

  it('may be kept a year if they carry their hash, an hour if not, and the page not at all; none has an ETag', async () => {
    const { assets } = readBuild(DIST_DIRECTORY);
    const [script, styles, vega, font, icon, page] = await served([
      { path: `/${assets.script}`, headers: { 'accept-encoding': 'gzip, deflate, br' } },
      `/${assets.styles}`,
      `/${assets.vega ?? ''}`,
      '/ui/fonts/inter_ui/Inter-UI-Regular.woff2',
      '/ui/favicons/favicon.ico',
      '/app/home',
    ]);
    // the original keeps its bundles a year too (max-age=31536000), and sends no ETag for them
    for (const answer of [script, styles, vega]) {
      assert.equal(answer?.status, 200);
      assert.equal(answer?.headers['cache-control'], 'public, max-age=31536000, immutable');
    }
    assert.equal(script?.headers['content-encoding'], 'br');
    assert.equal(script?.headers.vary, 'accept-encoding');
    // the original forbids storing these (no-store) and sends an ETag, which a browser never uses then
    for (const answer of [font, icon]) {
      assert.equal(answer?.status, 200);
      assert.equal(answer?.headers['cache-control'], 'public, max-age=3600');
    }
    // the page is never stored, as the original's (private, no-cache, no-store, must-revalidate)
    assert.match(String(page?.headers['cache-control']), /\bno-store\b/);
    for (const answer of [script, styles, vega, font, icon, page]) assert.equal(answer?.headers.etag, undefined);
  });
});

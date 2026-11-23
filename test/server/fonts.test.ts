/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { FONT_FAMILIES, FONTS_PATH, fontFaceRules, fontFiles } from '../../server/fonts';
import { renderPage, serveStatic } from '../../server/static';

const rules = fontFaceRules('/ui').split('\n');

describe('the web fonts', () => {
  it('are declared as OpenSearch Dashboards declares them: 62 faces of five families, in its order', () => {
    assert.equal(rules.length, 62);
    assert.deepEqual(
      FONT_FAMILIES.map(({ family, variants }) => `${family} ${variants.length}`),
      ['Inter UI 18', 'Source Sans 3 12', 'Roboto Mono 4', 'Source Code Pro 14', 'Rubik 14']
    );
    assert.equal(
      rules[0],
      "@font-face { font-family: 'Inter UI'; font-style: normal; font-weight: 100; src: " +
        "url('/ui/fonts/inter_ui/Inter-UI-Thin-BETA.woff2') format('woff2'), " +
        "url('/ui/fonts/inter_ui/Inter-UI-Thin-BETA.woff') format('woff'); }"
    );
    assert.equal(
      rules[rules.length - 1],
      "@font-face { font-family: 'Rubik'; font-style: italic; font-weight: 900; src: " +
        "url('/ui/fonts/rubik/static/Rubik-BlackItalic.woff2') format('woff2'); }"
    );
  });

  it('give the faces the Atlas stacks name in every weight the theme draws with', () => {
    const faces = (family: string) =>
      rules
        .filter((rule) => rule.includes(`font-family: '${family}';`) && rule.includes('font-style: normal;'))
        .map((rule) => Number(/font-weight: (\d+)/.exec(rule)?.[1]));
    assert.deepEqual(faces('Inter UI'), [100, 200, 300, 400, 500, 600, 700, 800, 900]);
    assert.deepEqual(faces('Source Code Pro'), [200, 300, 400, 500, 600, 700, 900]);
    // The original declares no medium weight of Source Sans 3
    assert.deepEqual(faces('Source Sans 3'), [200, 300, 400, 600, 700, 900]);
    const regular = rules.find((rule) => rule.includes("'Source Code Pro'") && rule.includes('normal; font-weight: 400'));
    assert.match(
      regular ?? '',
      /src: url\('\/ui\/fonts\/source_code_pro\/SourceCodePro-Regular\.ttf\.woff2'\) format\('woff2'\), url\('\/ui\/fonts\/source_code_pro\/SourceCodePro-Regular\.otf\.woff'\) format\('woff'\);/
    );
  });

  it('take a face of Roboto Mono from the system first, and its file as TrueType', () => {
    const italic = rules.find((rule) => rule.includes("'Roboto Mono'") && rule.includes('italic; font-weight: 400'));
    assert.equal(
      italic,
      "@font-face { font-family: 'Roboto Mono'; font-style: italic; font-weight: 400; src: " +
        "local('Roboto Mono Italic'), local('RobotoMono-Italic'), " +
        "url('/ui/fonts/roboto_mono/RobotoMono-Italic.ttf') format('truetype'); " +
        'unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, ' +
        'U+2000-206F, U+2074, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD; }'
    );
  });

  it('are fetched from under the base path', () => {
    const based = fontFaceRules('/dashboards/ui');
    assert.match(based, /url\('\/dashboards\/ui\/fonts\/inter_ui\/Inter-UI-Regular\.woff2'\)/);
    assert.equal(based.includes("url('/ui/"), false);
    assert.equal(FONTS_PATH, '/ui/fonts');
  });

  it('name only files the product ships, each once', () => {
    const files = fontFiles();
    assert.equal(files.length, 106);
    assert.equal(new Set(files).size, files.length);
    const missing = files.filter((file) => !existsSync(join('web/static', FONTS_PATH, file)));
    assert.deepEqual(missing, []);
    for (const licence of [
      'inter_ui/LICENSE.txt',
      'roboto_mono/LICENSE.txt',
      'rubik/LICENSE.txt',
      'source_code_pro/LICENSE.md',
      'source_sans_3/LICENSE.md',
    ]) {
      assert.ok(existsSync(join('web/static', FONTS_PATH, licence)), licence);
    }
  });

  it('are declared on the page before its style sheet', () => {
    const page = renderPage({
      basePath: '/base',
      build: { version: '3.9.0', builtAt: '', assets: { script: 'assets/app.js', styles: 'assets/app.css' } },
      title: 'InfraDashboard',
      dark: false,
      bootData: {},
    });
    const style = page.indexOf('<style>');
    assert.ok(style > 0 && style < page.indexOf('<link rel="stylesheet"'));
    assert.ok(page.includes(fontFaceRules('/base/ui')));
  });

  it('are sent with the types the original sends', () => {
    const publicDirectory = mkdtempSync(join(tmpdir(), 'fonts-test-'));
    mkdirSync(join(publicDirectory, 'ui', 'fonts', 'family'), { recursive: true });
    const types: Record<string, string> = {
      'face.woff2': 'font/woff2',
      'face.woff': 'font/woff',
      'face.ttf': 'font/ttf',
      'LICENSE.md': 'text/markdown; charset=utf-8',
      'LICENSE.txt': 'text/plain; charset=utf-8',
    };
    const req = { headers: {} } as IncomingMessage;
    for (const [name, type] of Object.entries(types)) {
      writeFileSync(join(publicDirectory, 'ui', 'fonts', 'family', name), 'x');
      const reply = serveStatic(publicDirectory, req, `/ui/fonts/family/${name}`);
      assert.equal(reply?.headers?.['content-type'], type, name);
    }
  });
});

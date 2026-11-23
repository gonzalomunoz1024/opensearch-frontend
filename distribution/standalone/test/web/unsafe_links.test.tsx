/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { createFormatter } from '../../web/lib/field_formats';
import { Markdown } from '../../web/lib/markdown';

// Ways to write an address that a browser reads as a script, or as content of the writer's own
const UNSAFE = [
  'javascript:alert(1)',
  'JaVaScRiPt:alert(1)',
  'java\tscript:alert(1)',
  'java\nscript:alert(1)',
  'j\ra\tv\na\tscript:alert(1)',
  '\u0001javascript:alert(1)',
  '\u0000\u001f javascript:alert(1)',
  ' \t javascript:alert(1)',
  'vbscript:msgbox(1)',
  'data:text/html,<script>alert(1)</script>',
  'file:///etc/passwd',
  'blob:https://example.org/1',
];

const SAFE = [
  'https://example.org/a?b=c#d',
  'HTTP://example.org',
  'mailto:someone@example.org',
  '/app/discover#/view/1',
  '#/view/1',
  'other/page?at=10:30',
  '//example.org/x',
];

describe('a value shown by the URL format', () => {
  const formatted = (value: string, params: Record<string, unknown> = {}) =>
    createFormatter({ id: 'url', params })(value);

  it('is not a link when a browser would read it as anything but a page or a mail address', () => {
    for (const value of UNSAFE) {
      assert.equal(formatted(value).href, undefined, JSON.stringify(value));
      assert.equal(formatted(value, { urlTemplate: '{{rawValue}}' }).href, undefined, JSON.stringify(value));
      assert.equal(formatted(value, { type: 'img' }).image, undefined, JSON.stringify(value));
      // It is still shown, as the text it is
      assert.equal(formatted(value).text, value);
    }
    assert.equal(formatted('alert(1)', { urlTemplate: 'java\tscript:{{rawValue}}' }).href, undefined);
  });

  it('stays a link when it is one', () => {
    for (const value of SAFE) assert.equal(formatted(value).href, value);
    assert.equal(formatted('a b', { urlTemplate: 'https://x.test/?q={{value}}' }).href, 'https://x.test/?q=a%20b');
    assert.equal(formatted('/logo.png', { type: 'img' }).image?.src, '/logo.png');
  });
});

describe('a link or a picture in Markdown', () => {
  const html = (text: string) => renderToStaticMarkup(<Markdown text={text} />);
  // The addresses an HTML text holds, as a browser on a page of this product reads them
  const addresses = (out: string) =>
    [...out.matchAll(/ (href|src)="([^"]*)"/g)].flatMap(([, name, value]) => {
      try {
        const text = value.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
        return [{ name, url: new URL(text, 'http://localhost:5601/app/home') }];
      } catch {
        return [];
      }
    });
  // Whether one of them runs a script or shows a document of the writer's own: a picture may be data:image/
  const leadsAstray = (out: string) =>
    addresses(out).some(
      ({ name, url }) =>
        ['javascript:', 'vbscript:', 'file:'].includes(url.protocol) ||
        (url.protocol === 'data:' && !(name === 'src' && /^data:image\/(gif|png|jpeg|webp);/i.test(url.href)))
    );

  it('leads nowhere a browser would run, or show as a page of the writer, however it is spelled', () => {
    // A blob: address stays a link, as in the original: it opens what that other site made, never a script of this page
    for (const address of UNSAFE.filter((value) => !value.startsWith('blob:'))) {
      for (const text of [`[text](${address})`, `[text](<${address}>)`, `![text](${address})`, `<${address}>`]) {
        assert.ok(!leadsAstray(html(text)), JSON.stringify(text));
      }
    }
    // A character reference is read as the character it stands for before the address is judged, as markdown-it reads it
    for (const address of ['javascript&colon;alert(1)', '&#106;avascript:alert(1)', 'java&Tab;script:alert(1)', '&#x6A;avascript&#58;alert(1)', 'java&#x09;script:alert(1)']) {
      assert.ok(!leadsAstray(html(`[text](${address}) ![text](${address})`)), address);
    }
    // markdown-it makes no link or picture at all of a javascript: address
    assert.ok(!/href|src/.test(html('[a](javascript:alert(1)) [b](JaVaScRiPt:alert(1)) ![c](javascript:alert(1)) <javascript:alert(1)> [d](javascript&colon;x)')));
    assert.ok(!html('![x](data:image/svg+xml;base64,PHN2Zz4=)').includes('<img'));
    assert.ok(html('![x](data:image/png;base64,iVBORw0KGgo=)').includes('<img'));
  });
});

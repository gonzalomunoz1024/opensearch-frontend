/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { getSecureRelForTarget, Markdown, markdownToHtml, renderMarkdown } from '../../web/lib/markdown';

// What the Markdown component sets as HTML, inside its div
const html = (text: string, openLinksInNewTab = false) => {
  const out = renderToStaticMarkup(<Markdown text={text} openLinksInNewTab={openLinksInNewTab} />);
  return out.replace(/^<div class="atlMarkdown">/, '').replace(/<\/div>$/, '');
};
const banner = (text: string) => renderToStaticMarkup(createElement(Fragment, null, renderMarkdown(text)));

// The texts and the HTML OpenSearch Dashboards 3.9.0 draws for them (its Markdown component:
// markdown-it 14.2.0, HTML off, linkify on), read from the reference build's page
describe('Markdown, as the Markdown visualization and TSVB draw it', () => {
  it('draws the sample visualizations as the original', () => {
    const text =
      '# A first-level heading\n\n- **This is bold text**\n- _This text is italicized_\n- ~~This was mistaken text~~\n' +
      '- **This text is _extremely_ important**\n- ***All this text is important***\n\nText that is not a quote\n\n' +
      '> Text that is a quote\n\n## A second-level heading\n\nUse `git status` to list all new or modified files that ' +
      "haven't yet been committed.\n\nSome basic Git commands are:\n```\ngit status\ngit add\ngit commit\n```\n\n" +
      '### A third-level heading\n\nTest out the [OpenSearch Dashboards Playground](https://playground.opensearch.org).\n\n' +
      'Navigate to [home](/).\n\n![Screenshot of sample data UI in OpenSearch Dashboards](https://opensearch.org/docs/latest/images/dashboards/add-sample-data.png)\n\n' +
      '- list item\n- list item\n- list item\n\n1. list item\n2. list item\n3. list item';
    assert.equal(
      html(text),
      '<h1>A first-level heading</h1>\n<ul>\n<li><strong>This is bold text</strong></li>\n<li><em>This text is italicized</em></li>\n' +
        '<li><s>This was mistaken text</s></li>\n<li><strong>This text is <em>extremely</em> important</strong></li>\n' +
        '<li><em><strong>All this text is important</strong></em></li>\n</ul>\n<p>Text that is not a quote</p>\n' +
        '<blockquote>\n<p>Text that is a quote</p>\n</blockquote>\n<h2>A second-level heading</h2>\n' +
        "<p>Use <code>git status</code> to list all new or modified files that haven't yet been committed.</p>\n" +
        '<p>Some basic Git commands are:</p>\n<pre><code>git status\ngit add\ngit commit\n</code></pre>\n<h3>A third-level heading</h3>\n' +
        '<p>Test out the <a href="https://playground.opensearch.org">OpenSearch Dashboards Playground</a>.</p>\n' +
        '<p>Navigate to <a href="/">home</a>.</p>\n' +
        '<p><img src="https://opensearch.org/docs/latest/images/dashboards/add-sample-data.png" alt="Screenshot of sample data UI in OpenSearch Dashboards"></p>\n' +
        '<ul>\n<li>list item</li>\n<li>list item</li>\n<li>list item</li>\n</ul>\n<ol>\n<li>list item</li>\n<li>list item</li>\n<li>list item</li>\n</ol>\n'
    );
    assert.equal(
      html('### Sample Logs Data\nThis dashboard contains sample data. Check our [docs](https://opensearch.org/docs/latest/dashboards/index/).', true),
      '<h3>Sample Logs Data</h3>\n<p>This dashboard contains sample data. Check our ' +
        '<a href="https://opensearch.org/docs/latest/dashboards/index/" target="_blank" rel="noopener noreferrer">docs</a>.</p>\n'
    );
    assert.equal(html(''), '');
  });

  it('sets its HTML in a div with the class and the data-test-subj its caller gives, as the original', () => {
    assert.equal(
      renderToStaticMarkup(<Markdown text="**a**" className="visMarkdownBody" data-test-subj="markdownBody" />),
      '<div class="atlMarkdown visMarkdownBody" data-test-subj="markdownBody"><p><strong>a</strong></p>\n</div>'
    );
    assert.equal(renderToStaticMarkup(<Markdown text="" />), '<div class="atlMarkdown"></div>');
  });

  it('nests lists, starts them where they start and keeps a loose one loose', () => {
    assert.equal(
      html('- a\n  - b\n    - c\n      1. d\n      2. e\n- f\n\n* g\n+ h'),
      '<ul>\n<li>a\n<ul>\n<li>b\n<ul>\n<li>c\n<ol>\n<li>d</li>\n<li>e</li>\n</ol>\n</li>\n</ul>\n</li>\n</ul>\n</li>\n<li>f</li>\n</ul>\n' +
        '<ul>\n<li>g</li>\n</ul>\n<ul>\n<li>h</li>\n</ul>\n'
    );
    assert.equal(
      html('- a\n\n- b\n\n  para in b\n- c'),
      '<ul>\n<li>\n<p>a</p>\n</li>\n<li>\n<p>b</p>\n<p>para in b</p>\n</li>\n<li>\n<p>c</p>\n</li>\n</ul>\n'
    );
    assert.equal(
      html('3. three\n4. four\n\n1) paren\n2) paren\n\n0. zero'),
      '<ol start="3">\n<li>three</li>\n<li>four</li>\n</ol>\n<ol>\n<li>paren</li>\n<li>paren</li>\n</ol>\n<ol start="0">\n<li>zero</li>\n</ol>\n'
    );
    // A list of the other kind after a blank line is a list of its own, and the first stays tight
    assert.equal(html('- one\n- two\n\n1. first\n2. second'), '<ul>\n<li>one</li>\n<li>two</li>\n</ul>\n<ol>\n<li>first</li>\n<li>second</li>\n</ol>\n');
  });

  it('draws tables with their alignment, and code as it is written', () => {
    assert.equal(
      html('| a | b | c |\n|:--|:-:|--:|\n| 1 | **2** | `3` |\n| x \\| y | | z |'),
      '<table>\n<thead>\n<tr>\n<th style="text-align:left">a</th>\n<th style="text-align:center">b</th>\n<th style="text-align:right">c</th>\n</tr>\n</thead>\n' +
        '<tbody>\n<tr>\n<td style="text-align:left">1</td>\n<td style="text-align:center"><strong>2</strong></td>\n' +
        '<td style="text-align:right"><code>3</code></td>\n</tr>\n<tr>\n<td style="text-align:left">x | y</td>\n' +
        '<td style="text-align:center"></td>\n<td style="text-align:right">z</td>\n</tr>\n</tbody>\n</table>\n'
    );
    assert.equal(
      html("```js\nconst a = '<b>' && 1;\n```\n\n    indented <i>&amp;\n\n~~~ python extra\nprint(\"x\")\n~~~"),
      '<pre><code class="language-js">const a = \'&lt;b&gt;\' &amp;&amp; 1;\n</code></pre>\n<pre><code>indented &lt;i&gt;&amp;amp;\n</code></pre>\n' +
        '<pre><code class="language-python">print(&quot;x&quot;)\n</code></pre>\n'
    );
  });

  // Two things the hand-written renderer did that markdown-it does not
  it('draws the text of a tight item that holds a list without a <p>, and keeps the last line end of code', () => {
    assert.equal(html('- a\n  - b\n- c'), '<ul>\n<li>a\n<ul>\n<li>b</li>\n</ul>\n</li>\n<li>c</li>\n</ul>\n');
    assert.equal(
      html('1. **a** text\n   1. b\n   2. c\n2. d\n   - e\n     - f'),
      '<ol>\n<li><strong>a</strong> text\n<ol>\n<li>b</li>\n<li>c</li>\n</ol>\n</li>\n<li>d\n<ul>\n<li>e\n<ul>\n<li>f</li>\n</ul>\n</li>\n</ul>\n</li>\n</ol>\n'
    );
    assert.equal(html('- a\n  - b\n  c'), '<ul>\n<li>a\n<ul>\n<li>b\nc</li>\n</ul>\n</li>\n</ul>\n');
    assert.equal(html('- a\n  - b\n\n  c\n- d'), '<ul>\n<li>\n<p>a</p>\n<ul>\n<li>b</li>\n</ul>\n<p>c</p>\n</li>\n<li>\n<p>d</p>\n</li>\n</ul>\n');
    assert.equal(html('```\nline one\nline two\n```'), '<pre><code>line one\nline two\n</code></pre>\n');
    assert.equal(html('```\ncode\n\n\n```'), '<pre><code>code\n\n\n</code></pre>\n');
    // A fence never closed ends where the text does, with no line end of its own
    assert.equal(html('```\nopen fence\nto the end'), '<pre><code>open fence\nto the end</code></pre>\n');
    assert.equal(html('- item\n  ```\n  in list\n  ```\n- next'), '<ul>\n<li>item<pre><code>in list\n</code></pre>\n</li>\n<li>next</li>\n</ul>\n');
    assert.equal(html('> ```\n> in quote\n> ```'), '<blockquote>\n<pre><code>in quote\n</code></pre>\n</blockquote>\n');
    assert.equal(html('    a\n    b\n\n\nafter'), '<pre><code>a\nb\n</code></pre>\n<p>after</p>\n');
  });

  it('draws links with their titles, autolinks, and the addresses linkify finds', () => {
    assert.equal(
      html('[t](https://example.org/a "Title & <more>") [t2](/rel \'single\') [t3](<a b> (paren)) [t4](https://example.org/q?a=1&b=2#h)'),
      '<p><a href="https://example.org/a" title="Title &amp; &lt;more&gt;">t</a> <a href="/rel" title="single">t2</a> ' +
        '<a href="a%20b" title="paren">t3</a> <a href="https://example.org/q?a=1&amp;b=2#h">t4</a></p>\n'
    );
    assert.equal(
      html('<https://example.org/x> <a@b.co> https://opensearch.org/docs/latest/ www.example.com mail a@b.co (https://example.org/in-parens) https://example.org/a.'),
      '<p><a href="https://example.org/x">https://example.org/x</a> <a href="mailto:a@b.co">a@b.co</a> ' +
        '<a href="https://opensearch.org/docs/latest/">https://opensearch.org/docs/latest/</a> <a href="http://www.example.com">www.example.com</a> ' +
        'mail <a href="mailto:a@b.co">a@b.co</a> (<a href="https://example.org/in-parens">https://example.org/in-parens</a>) ' +
        '<a href="https://example.org/a">https://example.org/a</a>.</p>\n'
    );
    assert.equal(
      html('[u](https://ex.org/päth?q=ä) https://ä.example.org [r][x]\n\n[x]: https://example.org/r "T"'),
      '<p><a href="https://ex.org/p%C3%A4th?q=%C3%A4">u</a> <a href="https://xn--4ca.example.org">https://ä.example.org</a> ' +
        '<a href="https://example.org/r" title="T">r</a></p>\n'
    );
  });

  it('reads character references, and shows HTML as the text it is', () => {
    assert.equal(
      html('&copy; &amp; &lt;b&gt; &#65; &#x42; &nbsp;|&#0; &unknown; &ast;no em&ast; `&amp;`'),
      `<p>© &amp; &lt;b&gt; A B ${String.fromCharCode(160)}|${String.fromCharCode(0xfffd)} &amp;unknown; *no em* <code>&amp;amp;</code></p>\n`
    );
    assert.equal(
      html('<b>bold</b> <script>alert(1)</script> <img src=x onerror=alert(1)>\n\n<div>\nblock\n</div>'),
      '<p>&lt;b&gt;bold&lt;/b&gt; &lt;script&gt;alert(1)&lt;/script&gt; &lt;img src=x onerror=alert(1)&gt;</p>\n<p>&lt;div&gt;\nblock\n&lt;/div&gt;</p>\n'
    );
    // No typographer: quotes and dashes stay as written
    assert.equal(html('(c) -- "quotes" ...'), '<p>(c) -- &quot;quotes&quot; ...</p>\n');
    assert.equal(html('a  \nb\\\nc\nd'), '<p>a<br>\nb<br>\nc\nd</p>\n');
  });

  it('makes no link or picture of a javascript:, vbscript:, file: or data: address, however it is spelled', () => {
    assert.equal(
      html('[a](javascript:alert(1)) [b](JaVaScRiPt:alert(1)) [c](vbscript:x) [d](data:text/html,x) [e]( javascript:alert(1) ) [h](&#106;avascript:alert(1)) [i](file:///etc/passwd) [k](javascript&colon;alert(1))'),
      '<p>[a](javascript:alert(1)) [b](JaVaScRiPt:alert(1)) [c](vbscript:x) [d](data:text/html,x) [e]( javascript:alert(1) ) ' +
        '[h](javascript:alert(1)) [i](file:///etc/passwd) [k](javascript:alert(1))</p>\n'
    );
    assert.equal(
      html('![a](javascript:alert(1)) ![b](data:image/svg+xml;base64,PHN2Zz4=) ![c](data:image/png;base64,iVBORw0KGgo=) ![d](DATA:image/gif;base64,R0lGOD)'),
      '<p>![a](javascript:alert(1)) ![b](data:image/svg+xml;base64,PHN2Zz4=) <img src="data:image/png;base64,iVBORw0KGgo=" alt="c"> ' +
        '<img src="DATA:image/gif;base64,R0lGOD" alt="d"></p>\n'
    );
    assert.equal(html('<javascript:alert(1)> <vbscript:x> <data:text/html,x>'), '<p>&lt;javascript:alert(1)&gt; &lt;vbscript:x&gt; &lt;data:text/html,x&gt;</p>\n');
    // A tab written in an address is encoded, which a browser reads as part of a path of this page
    assert.equal(html('[g](java&#x09;script:alert(1))'), '<p><a href="java%09script:alert(1)">g</a></p>\n');
  });

  it('opens links in a new tab when asked to, with the rel of the original', () => {
    assert.equal(
      html('[ext](https://example.org) [elastic](https://www.elastic.co/guide) [sub](https://a.elastic.co.evil.example/) [rel](/app/home) https://opensearch.org', true),
      '<p><a href="https://example.org" target="_blank" rel="noopener noreferrer">ext</a> ' +
        '<a href="https://www.elastic.co/guide" target="_blank" rel="noopener">elastic</a> ' +
        '<a href="https://a.elastic.co.evil.example/" target="_blank" rel="noopener noreferrer">sub</a> ' +
        '<a href="/app/home" target="_blank" rel="noopener noreferrer">rel</a> ' +
        '<a href="https://opensearch.org" target="_blank" rel="noopener noreferrer">https://opensearch.org</a></p>\n'
    );
    assert.equal(html('[ext](https://example.org)', false), '<p><a href="https://example.org">ext</a></p>\n');
    assert.equal(markdownToHtml('[ext](https://example.org)'), '<p><a href="https://example.org">ext</a></p>\n');
  });

  it('nests quotes and lists a hundred steps deep, as markdown-it does', () => {
    const out = html(`${'>'.repeat(150)} deep`);
    assert.equal(out.split('<blockquote>').length - 1, 100);
    assert.ok(!out.includes('deep'));
  });
});

// OUI 1.24.2's own function, with the pattern it is written with
const ELASTIC = /(https?:\/\/(.+?\.)?elastic\.co((\/|\?)[A-Za-z0-9\-\._~:\/\?#\[\]@!$&'\(\)\*\+,;\=]*)?)/g;
const originalRel = (href: string) => {
  const matches = href.match(ELASTIC);
  const secure = !!href && !!matches && matches[0].length === href.length;
  return [...(secure ? [] : ['noreferrer']), 'noopener'].sort().join(' ');
};

describe('the rel of a link that opens a new tab', () => {
  it('is what OUI gives, for any address', () => {
    const schemes = ['http://', 'https://', 'HTTP://', 'ftp://', '', 'https:/', 'https://https://'];
    const hosts = ['elastic.co', 'www.elastic.co', 'a.b.elastic.co', 'elastic.com', 'xelastic.co', '.elastic.co', 'evil.org/?x=.elastic.co', 'elastic.co.evil.org', 'a\n.elastic.co', 'elastic.co.elastic.co', 'a.elastic.co.', ''];
    const paths = ['', '/', '/guide/en', '?q=1', '/a%20b', '/[x]', "/a'b(c)", '#h', ':8080/x', '/é', '/a b', '?', '/a\nb'];
    let compared = 0;
    for (const scheme of schemes) {
      for (const host of hosts) {
        for (const path of paths) {
          const href = scheme + host + path;
          assert.equal(getSecureRelForTarget({ href, target: '_blank' }), originalRel(href), JSON.stringify(href));
          compared += 1;
        }
      }
    }
    // and texts made of the pieces such addresses are made of
    const pieces = ['http', 's', '://', 'elastic', '.', 'co', '/', '?', 'a', '%', '\n', '#'];
    let seed = 7;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed;
    };
    for (let round = 0; round < 3000; round += 1) {
      let href = '';
      const length = next() % 12;
      for (let at = 0; at < length; at += 1) href += pieces[next() % pieces.length];
      assert.equal(getSecureRelForTarget({ href, target: '_blank' }), originalRel(href), JSON.stringify(href));
      compared += 1;
    }
    assert.ok(compared > 4000);
    assert.equal(getSecureRelForTarget({ href: undefined, target: '_blank' }), 'noopener noreferrer');
    assert.equal(getSecureRelForTarget({ href: 'https://example.org', target: '_blank', rel: 'noreferrer external' }), 'external noopener noreferrer');
    assert.equal(getSecureRelForTarget({ href: 'https://example.org' }), 'noreferrer');
  });

  it('is found in time in proportion to the address', () => {
    const href = 'http://'.repeat(20000);
    const started = performance.now();
    assert.equal(getSecureRelForTarget({ href, target: '_blank' }), 'noopener noreferrer');
    // OUI's pattern takes seconds on this address (it runs to its end from every "http://")
    assert.ok(performance.now() - started < 500);
  });
});

describe('the custom banner, as react-markdown 6 draws it', () => {
  // The HTML react-markdown 6.0.3 gives with components={{ p: Fragment }}, as core's UserBannerService
  it('draws paragraphs without their <p>, and blocks one line apart', () => {
    assert.equal(
      banner('**Maintenance** tonight. See [status](https://status.example.org/a?b=c "The status").'),
      '<strong>Maintenance</strong> tonight. See <a href="https://status.example.org/a?b=c" title="The status">status</a>.'
    );
    assert.equal(banner('first paragraph\n\nsecond paragraph'), 'first paragraph\nsecond paragraph');
    assert.equal(banner('- one\n- two\n\n1. first\n2. second'), '<ul>\n<li>one</li>\n<li>two</li>\n</ul>\n<ol>\n<li>first</li>\n<li>second</li>\n</ol>');
    assert.equal(banner('- one\n\n- two'), '<ul>\n<li>\none\n</li>\n<li>\ntwo\n</li>\n</ul>');
    assert.equal(banner('> quoted\n\n# Heading'), '<blockquote>\nquoted\n</blockquote>\n<h1>Heading</h1>');
    assert.equal(banner("```js\nconst a = '<b>';\n```"), '<pre><code class="language-js">const a = &#x27;&lt;b&gt;&#x27;;\n</code></pre>');
    assert.equal(banner('line  \nbreak'), 'line<br/>\nbreak');
    assert.equal(banner(''), '');
  });

  it('ends code that is not empty with one line end, and draws the text of a tight item that holds a list on its line', () => {
    assert.equal(banner('```\nline one\nline two\n```'), '<pre><code>line one\nline two\n</code></pre>');
    assert.equal(banner('```\ncode\n\n\n```'), '<pre><code>code\n\n\n</code></pre>');
    // remark keeps a fence's lines without their last line end, and mdast-util-to-hast adds one
    assert.equal(banner('```\nopen fence\nto the end'), '<pre><code>open fence\nto the end\n</code></pre>');
    assert.equal(banner('```\n\n```'), '<pre><code></code></pre>');
    assert.equal(banner('```\n\n\n```'), '<pre><code>\n\n</code></pre>');
    assert.equal(banner('> ```\n>\n\nafter'), '<blockquote>\n<pre><code></code></pre>\n</blockquote>\nafter');
    assert.equal(banner('    a\n    b\n\n\nafter'), '<pre><code>a\nb\n</code></pre>\nafter');
    assert.equal(banner('- a\n  - b\n- c'), '<ul>\n<li>a\n<ul>\n<li>b</li>\n</ul>\n</li>\n<li>c</li>\n</ul>');
    assert.equal(banner('- item\n  ```\n  in list\n  ```\n- next'), '<ul>\n<li>item\n<pre><code>in list\n</code></pre>\n</li>\n<li>next</li>\n</ul>');
  });

  // micromark drops the spaces and tabs that end a line, and breaks the line only after two spaces
  // or more with no tab; mdast-util-to-hast takes spaces and tabs from beside a line end in a
  // text, and white space from the start of what follows a hard break
  it('ends lines as react-markdown does', () => {
    assert.equal(banner('a\t\nb'), 'a\nb');
    assert.equal(banner('a \t\nb'), 'a\nb');
    assert.equal(banner('a\t  \nb'), 'a\nb');
    assert.equal(banner('a   \nb'), 'a<br/>\nb');
    assert.equal(banner('a\t\\\nb'), 'a\t<br/>\nb');
    assert.equal(banner('*a*\t\nb'), '<em>a</em>\nb');
    assert.equal(banner('[a\t\nb](x)'), '<a href="x">a\nb</a>');
    assert.equal(banner('![a\t\nb](x)'), '<img src="x" alt="a\nb"/>');
    assert.equal(banner('a &#10; b'), 'a\nb');
    assert.equal(banner('a  \n&nbsp;b'), 'a<br/>\nb');
    assert.equal(banner('a\\\n` b`'), 'a<br/>\n<code>b</code>');
    assert.equal(banner('a  \n[&#32;l](x)'), 'a<br/>\n<a href="x">l</a>');
    assert.equal(banner('**a  \n**b'), '**a<br/>\n**b');
  });

  it('reads CommonMark only: no tables, struck text or links found in the text, and HTML as text', () => {
    assert.equal(
      banner('https://opensearch.org and www.example.com stay text; ~~no strike~~\n\na | b\n--|--\n1 | 2'),
      'https://opensearch.org and www.example.com stay text; ~~no strike~~\na | b\n--|--\n1 | 2'
    );
    assert.equal(banner('<b>html</b> <script>alert(1)</script>'), '&lt;b&gt;html&lt;/b&gt; &lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('points a link anywhere but a page, http(s), mailto or tel nowhere, and leaves pictures as written', () => {
    assert.equal(
      banner('[js](javascript:alert(1)) [vb](VBScript:x) [ftp](ftp://example.org) [rel](other/page?at=10:30) [tel](tel:123)'),
      '<a href="javascript:void(0)">js</a> <a href="javascript:void(0)">vb</a> <a href="javascript:void(0)">ftp</a> ' +
        '<a href="other/page?at=10:30">rel</a> <a href="tel:123">tel</a>'
    );
    assert.equal(banner('![pic](javascript:alert(1)) ![d](data:text/html,x)'), '<img src="javascript:alert(1)" alt="pic"/> <img src="data:text/html,x" alt="d"/>');
  });

  it('nests a hundred steps deep, and draws a long text whole', () => {
    const out = banner(`${'>'.repeat(150)} deep`);
    assert.equal(out.split('<blockquote>').length - 1, 100);
    // Thousands of elements in one paragraph or list are handed to React as arrays
    assert.equal(banner('*a* '.repeat(70000)).split('<em>').length - 1, 70000);
    assert.equal(banner('- a\n'.repeat(70000)).split('<li>').length - 1, 70000);
  });
});

// Texts written to be slow: each of them took the hand-written renderer seconds at 64 kB (time
// growing with the square of the text); markdown-it takes milliseconds
describe('the time Markdown takes', () => {
  const texts: Array<[string, string]> = [
    ['*a* repeated', '*a* '.repeat(16000)],
    ['`a repeated', '`a'.repeat(32000)],
    ['[ repeated', '['.repeat(64000)],
    ['[a]( repeated', '[a]('.repeat(16000)],
    ['![ repeated', '!['.repeat(32000)],
    ['**a repeated', '**a '.repeat(16000)],
  ];

  it('grows in proportion to the text, in the Markdown component', () => {
    for (const [name, text] of texts) {
      const started = performance.now();
      markdownToHtml(text, { openLinksInNewTab: true });
      assert.ok(performance.now() - started < 2000, name);
    }
  });

  it('grows in proportion to the text, in the banner', () => {
    for (const [name, text] of texts) {
      const started = performance.now();
      renderMarkdown(text);
      assert.ok(performance.now() - started < 2000, name);
    }
  });
});

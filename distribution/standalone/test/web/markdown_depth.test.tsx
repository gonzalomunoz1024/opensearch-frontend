/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { Markdown } from '../../web/lib/markdown';

const html = (text: string) => renderToStaticMarkup(<Markdown text={text} />);
const count = (out: string, tag: string) => out.split(`<${tag}>`).length - 1;
const lists = (levels: number) => Array.from({ length: levels }, (_, level) => `${'  '.repeat(level)}- item ${level}`).join('\n');

// A stored text is drawn on pages its writer does not own: a Markdown visualization on a
// dashboard, and the banner of the advanced settings above every page. The numbers are those
// OpenSearch Dashboards 3.9.0 draws for the same texts.
describe('Markdown that nests deeper than any text does', () => {
  it('draws a hundred quotes inside one another and leaves out what lies deeper', () => {
    const out = html(`${'>'.repeat(3000)} deep`);
    assert.equal(count(out, 'blockquote'), 100);
    assert.ok(!out.includes('deep'));
  });

  it('still draws what the ninety-ninth quote holds, and not what the hundredth does', () => {
    const out = html(`${'>'.repeat(99)} deep99\n\n${'>'.repeat(100)} deep100`);
    assert.equal(count(out, 'blockquote'), 199);
    assert.ok(out.includes('<p>deep99</p>'));
    assert.ok(!out.includes('deep100'));
  });

  it('counts a list as two steps: fifty lists inside one another, the innermost empty', () => {
    const out = html(lists(60));
    assert.equal(count(out, 'ul'), 50);
    assert.ok(out.includes('item 48'));
    assert.ok(!out.includes('item 49'));
    // The same when the fiftieth list is the last one of the text
    const last = html(lists(50));
    assert.equal(count(last, 'ul'), 50);
    assert.ok(last.includes('item 48'));
    assert.ok(!last.includes('item 49'));
    // Lists that no text is near the end of are drawn whole
    const whole = html(lists(49));
    assert.equal(count(whole, 'ul'), 49);
    assert.ok(whole.includes('item 48'));
  });

  it('draws a text of many deep lists without failing', () => {
    const out = html(lists(400));
    assert.equal(count(out, 'ul'), 50);
  });
});

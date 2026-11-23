/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The Markdown visualization as OpenSearch Dashboards 3.9.0's MarkdownVisComponent draws it: its
 * text's body carries the test id the original's component gives its Markdown.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

describe('the Markdown visualization', () => {
  it('puts "markdownBody" on the body of the text, as the original gives it to its Markdown, not on the panel', () => {
    // The module loads its stylesheet, which a test cannot: its source is read
    const source = readFileSync('web/vis/markdown_vis.tsx', 'utf8');
    assert.match(source, /<Markdown\s[^>]*data-test-subj="markdownBody"/);
    assert.equal(/<div\s[^>]*data-test-subj="markdownBody"/.test(source), false);
  });
});

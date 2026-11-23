/* SPDX-License-Identifier: Apache-2.0 */

/*
 * A value in a cell of the data table or a metric, as the original's HTML formats write it: one
 * span around it, and inside it the link, picture, player or colour its format makes.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FormattedValue, type FormattedContent } from '../../web/vis/formatted_value';

const drawn = (content: FormattedContent) => renderToStaticMarkup(createElement(FormattedValue, { content }));

describe('a value in a cell of a visualization', () => {
  it("keeps the markup of one value as the original's HTML formats write it", () => {
    assert.equal(drawn({ text: 'a' }), '<span>a</span>');
    assert.equal(drawn({ text: 'a', bare: true }), 'a');
    assert.equal(
      drawn({ text: 'a', href: '/x', newTab: true }),
      '<span><a href="/x" target="_blank" rel="noopener noreferrer">a</a></span>'
    );
    assert.equal(drawn({ text: 'a', color: 'red' }), '<span><span style="color:red">a</span></span>');
  });

  it('draws a sound as a player, and a picture with the alt text its format gives', () => {
    assert.equal(
      drawn({ text: 'https://x.test/a.mp3', audio: { src: 'https://x.test/a.mp3' } }),
      '<span><audio controls="" preload="none" src="https://x.test/a.mp3"></audio></span>'
    );
    const alt = 'A dynamically-specified image located at https://x.test/a.png';
    assert.match(drawn({ text: 'https://x.test/a.png', image: { src: 'https://x.test/a.png', alt } }), new RegExp(`alt="${alt}"`));
    // Without an alt text of its own, a picture tells its text
    assert.match(drawn({ text: 'logo', image: { src: 'https://x.test/a.png' } }), /alt="logo"/);
  });

  it('draws a list value by value, with its separator between them', () => {
    assert.equal(
      drawn({
        text: 'a, b',
        separator: ', ',
        parts: [
          { text: 'a', href: '/a' },
          { text: 'b', color: 'blue' },
        ],
      }),
      '<span><a href="/a" rel="noopener noreferrer">a</a>, <span style="color:blue">b</span></span>'
    );
  });
});

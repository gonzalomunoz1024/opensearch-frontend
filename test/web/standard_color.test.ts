/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assignColors, setColorMapping } from '../../web/charts/core';
import { standardColor } from '../../web/charts/standard_color';

// What the original gives for each value: new Color(value).hex().toLowerCase(), with the color
// module of its charts bundle (color 1.0.3) run on these values

describe('a colour of visualization:colorMapping, as the original standardizes it', () => {
  it('gives #rrggbb in lower case for the texts it reads', () => {
    const cases: Array<[string, string]> = [
      ['#54B399', '#54b399'],
      ['#abc', '#aabbcc'],
      ['#abcd', '#aabbcc'],
      ['#11223344', '#112233'],
      ['red', '#ff0000'],
      ['rebeccapurple', '#663399'],
      ['transparent', '#000000'],
      ['rgb(84, 179, 153)', '#54b399'],
      ['rgba(84,179,153,0.5)', '#54b399'],
      ['rgb(300, -2, 7)', '#ff0007'],
      ['rgb(50%, 10%, 100%)', '#7f1aff'],
      ['hsl(163, 37%, 52%)', '#57b298'],
      ['hsla(-30deg, 100%, 50%, 0.5)', '#ff0080'],
      ['hwb(163, 20%, 30%)', '#33b38e'],
    ];
    for (const [text, hex] of cases) assert.equal(standardColor(text), hex, text);
  });

  it('reads a number, a list of channels or an object of them, and gives black for an empty value', () => {
    const cases: Array<[unknown, string]> = [
      [1, '#000001'],
      [-1, '#ffffff'],
      [1.9, '#000001'],
      [16777216, '#000000'],
      [[255, 0], '#ff0000'],
      [[1.5, 300, -4], '#02ff00'],
      [['255', 0, 0], '#000000'],
      [{ r: 255, g: 0, b: 0 }, '#ff0000'],
      [{ r: '255', g: null, b: 0, alpha: 0.5 }, '#ff0000'],
      [{ h: 120, s: 100, l: 50 }, '#00ff00'],
      [{ h: 0, s: 100, v: 100 }, '#ff0000'],
      [{ h: 200, w: 10, b: 20 }, '#1a91cc'],
      [{ c: 0, m: 100, y: 100, k: 0 }, '#ff0000'],
      [{ gray: 50 }, '#808080'],
      [0, '#000000'],
      ['', '#000000'],
      [null, '#000000'],
      [false, '#000000'],
    ];
    for (const [value, hex] of cases) assert.equal(standardColor(value), hex, JSON.stringify(value));
  });

  it('gives nothing for a value the original cannot read, where it throws', () => {
    for (const value of ['[1]', 'RED', 'bogus', 'red1', ' #fff', '#fff ', 'hwb(163 20% 30%)', true, [], {}, { r: 1, q: 2 }]) {
      assert.equal(standardColor(value), undefined, JSON.stringify(value));
    }
  });
});

describe('the colours of a chart, with visualization:colorMapping as the original reads it', () => {
  it('draws with a setting whose colours are not texts', () => {
    // The setting "[1]": the original reads its one value, 1, as #000001 for a label "0"
    setColorMapping([1] as unknown as Record<string, string>);
    try {
      const colors = assignColors(['standard colour a', 'standard colour b']);
      assert.equal(colors.size, 2);
      assert.notEqual(colors.get('standard colour a'), colors.get('standard colour b'));
    } finally {
      setColorMapping({});
    }
  });

  it('keeps the colour of a label of the setting from the others, however the setting writes it', () => {
    // rgb(84, 179, 153) is #54B399, the first colour of the palette
    setColorMapping({ 'standard colour set': 'rgb(84, 179, 153)' });
    try {
      const colors = assignColors(['standard colour set', 'standard colour other']);
      assert.equal(colors.get('standard colour other'), '#6092C0');
    } finally {
      setColorMapping({});
    }
  });
});

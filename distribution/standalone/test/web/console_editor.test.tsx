/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ConsoleEditor, drawnRange, drawnRows, linePieces, scrollIntoView } from '../../web/apps/dev_tools/console_editor';
import { highlight } from '../../web/apps/dev_tools/console_highlight';
import { ScreenLayout, lineSplits } from '../../web/apps/dev_tools/console_layout';

const count = (text: string, part: string) => text.split(part).length - 1;

describe('the console editor draws the rows in view, as Ace’s renderer does', () => {
  it('draws a few rows of an answer of twenty-five thousand lines, not all of them', () => {
    const lines = ['{'];
    for (let index = 0; index < 25000; index += 1) lines.push(`  "field${index}": "value ${index}",`);
    lines.push('}');
    const started = Date.now();
    const out = renderToStaticMarkup(<ConsoleEditor readOnly value={lines.join('\n')} mode="output" fontSize={14} wrap={false} inputId="out" />);
    const took = Date.now() - started;
    const rows = count(out, 'class="dvtAce__row"');
    assert.ok(rows > 0 && rows < 40, `${rows} rows drawn`);
    assert.ok(out.length < 30000, `${out.length} characters of markup`);
    assert.ok(took < 2000, `drawn in ${took} ms`);
    // The first rows, with their numbers, their fold mark and their colours
    assert.match(out, /<div class="dvtAce__cell dvtAce__cell--active"[^>]*>1<span class="dvtAce__fold dvtAce__fold--start dvtAce__fold--open">/);
    assert.match(out, /<span class="dvtTok-variable">&quot;field0&quot;<\/span>/);
    assert.equal(count(out, 'field24999'), 0);
    // The scroll area has the height of the whole text: 25,002 lines of 18px (the line height before the font is measured)
    assert.match(out, /class="dvtAce__body" style="height:450036px/);
    // What is typed goes to a text area that holds none of the text
    assert.match(out, /<textarea id="out" class="dvtAce__input"/);
    assert.equal(count(out, '</textarea>'), 1);
    assert.match(out, /<textarea[^>]*><\/textarea>/);
  });

  it('says which lines an editor shows from where it is scrolled to', () => {
    const lines = Array.from({ length: 1000 }, (_, index) => `line ${index}`);
    const layout = new ScreenLayout(lines, { wrap: false, wrapLimit: 80 });
    assert.deepEqual(drawnRange(layout, 0, 160, 16), { first: 0, last: 15 });
    assert.deepEqual(drawnRange(layout, 1600, 160, 16), { first: 96, last: 115 });
    assert.deepEqual(drawnRange(layout, 16000, 160, 16), { first: 996, last: 999 });
    // Wrapped lines take the rows they wrap into
    const wrapped = new ScreenLayout(lines.map((line) => `${line} ${'x '.repeat(40)}`), { wrap: true, wrapLimit: 30 });
    const range = drawnRange(wrapped, 1600, 160, 16);
    assert.ok(range.last - range.first < 12, `${range.last - range.first} lines`);
    assert.ok(wrapped.screenRowOf(range.first) <= 100 && wrapped.screenRowOf(range.last + 1) >= 110);
  });

  it('writes a wrapped line as its rows, the further ones started with their indent, and the indent guides of the first', () => {
    const line = `    "message": "${'word '.repeat(12)}"`;
    const tokens = highlight(line, 'output').lines[0];
    const splits = lineSplits(line, 40);
    const rows = drawnRows(tokens, splits);
    assert.equal(rows.length, splits.at.length + 1);
    // Ace draws a guide for each stop of the indentation but the last
    assert.deepEqual(
      rows[0].slice(0, 2).map((piece) => [piece.text, piece.guide === true]),
      [
        ['  ', true],
        ['  ', false],
      ]
    );
    assert.equal(rows[1][0].text, '\xa0'.repeat(6));
    // Nothing of the text is lost or written twice
    const written = rows.map((row, index) => row.slice(index === 0 ? 0 : 1).map((piece) => piece.text).join('')).join('');
    assert.equal(written, line);
    // A tab is written as the spaces to the next stop
    assert.deepEqual(drawnRows([{ type: 'text', value: 'a\tb' }], { at: [], indent: 0 }), [[{ text: 'a b', type: 'text' }]]);
  });

  it('writes a fold as its placeholder between what is before and after it', () => {
    const lines = ['{', '  "a": 1', '}'];
    const tokens = highlight(lines.join('\n'), 'output').lines;
    const fold = { start: { row: 0, column: 1 }, end: { row: 2, column: 0 }, placeholder: '...', inner: [], collapseChildren: 0 };
    const layout = new ScreenLayout(lines, { wrap: false, wrapLimit: 80, folds: [fold] });
    const pieces = linePieces(layout, 0, (row) => tokens[row]);
    assert.deepEqual(
      pieces.map((piece) => piece.value),
      ['{', '...', '}']
    );
    assert.equal(pieces[1].fold, fold);
  });

  it('scrolls no further than a place needs, or to the middle when asked', () => {
    const view = { height: 160, width: 400, lineHeight: 16, charWidth: 8 };
    // In view: nothing moves
    assert.deepEqual(scrollIntoView({ left: 20, top: 48 }, { top: 0, left: 0 }, view), { top: 0, left: 0 });
    // Below: the row comes to the bottom edge
    assert.deepEqual(scrollIntoView({ left: 20, top: 320 }, { top: 0, left: 0 }, view), { top: 176, left: 0 });
    // Above: the row comes to the top edge
    assert.deepEqual(scrollIntoView({ left: 20, top: 32 }, { top: 320, left: 0 }, view), { top: 32, left: 0 });
    // With half the height as the offset, a place far away comes to the middle
    assert.deepEqual(scrollIntoView({ left: 20, top: 1600 }, { top: 0, left: 0 }, view, 0.5), { top: 1536, left: 0 });
    // To the right: the column comes to the right edge
    assert.deepEqual(scrollIntoView({ left: 804, top: 0 }, { top: 0, left: 0 }, view), { top: 0, left: 412 });
  });
});

/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { csvCell, toCsv } from '../../web/lib/docs';

const cell = (value: unknown, quote = false) => csvCell(value, ',', quote);

describe('a cell of a downloaded CSV file', () => {
  it('that a spreadsheet would run as a formula is made text', () => {
    assert.equal(cell('=1+1'), "'=1+1");
    assert.equal(cell('+1+cmd|x!A0'), "'+1+cmd|x!A0");
    assert.equal(cell("-2+3+cmd|' /C calc'!A0"), "'-2+3+cmd|' /C calc'!A0");
    assert.equal(cell('-A1'), "'-A1");
    assert.equal(cell('-SUM(1)'), "'-SUM(1)");
    assert.equal(cell('@SUM(A1)'), "'@SUM(A1)");
    assert.equal(cell('\t=1'), "'\t=1");
    assert.equal(cell('=HYPERLINK("http://x","y")'), '"\'=HYPERLINK(""http://x"",""y"")"');
    assert.equal(cell('=1', true), '"\'=1"');
  });

  it('that is a number below zero, or the "-" of a missing value, stays what it is', () => {
    for (const text of ['-', '-5.3', '-1,234.5', '-12%', '-1.2KB', '-$5.00', '-5 °C', '+3', '-0.5 ms']) {
      assert.equal(cell(text), text.includes(',') ? `"${text}"` : text);
      assert.equal(cell(text, true), `"${text}"`);
    }
    assert.equal(cell(-5.3), '-5.3');
  });

  it('is quoted when csv:quoteValues says so or when it could not be read back otherwise', () => {
    assert.equal(cell('plain'), 'plain');
    assert.equal(cell('plain', true), '"plain"');
    assert.equal(cell('a,b'), '"a,b"');
    assert.equal(cell('say "hi"'), '"say ""hi"""');
    assert.equal(cell('two\nlines'), '"two\nlines"');
    assert.equal(cell(null), '');
    assert.equal(cell({ a: 1 }), '"{""a"":1}"');
    assert.equal(csvCell('a;b', ';', false), '"a;b"');
  });

  it('rows are joined by the separator of csv:separator and end as a spreadsheet expects', () => {
    assert.equal(toCsv(['time', 'value'], [['a', -1], ['b', '-']], ';', false), 'time;value\r\na;-1\r\nb;-\r\n');
  });
});

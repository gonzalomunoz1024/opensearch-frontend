/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { UndoTracker, bindingNames, commandKeys, keyName, wordRange } from '../../web/apps/dev_tools/console_commands';
import { TokenCache, foldWidget, highlight, rehighlight } from '../../web/apps/dev_tools/console_highlight';
import { ScreenLayout, lineSplits, reuseSplits } from '../../web/apps/dev_tools/console_layout';
import { readConsole } from '../../web/apps/dev_tools/console_model';
import { findAllRanges, findRange, searchCounter, searchRegExp } from '../../web/apps/dev_tools/console_search';
import { ConsoleSession, transformPoint } from '../../web/apps/dev_tools/console_session';

const type = (session: ConsoleSession, text: string) => {
  for (const char of text) session.exec('insertstring', char);
};

/** An editor of the console's input with its tokens read, as the console gives them */
const input = (text: string) => new ConsoleSession(text, 'input', false, highlight(text, 'input'));

const BIG = Array.from({ length: 30000 }, (_, index) => (index % 3 === 0 ? '{' : index % 3 === 1 ? `  "field${index}": "value ${index}"` : '}'));

describe('the lines of a console editor on the screen', () => {
  it('wraps a long line as Ace does: at a space, its further rows indented as the line and by two more', () => {
    const line = `    "message": "${'word '.repeat(30)}"`;
    const splits = lineSplits(line, 40);
    assert.ok(splits.at.length >= 3);
    assert.equal(splits.indent, 6);
    // Every row holds at most the limit, the further ones less their indent, and the space it breaks after
    let from = 0;
    splits.at.forEach((at, index) => {
      assert.ok(at - from <= (index === 0 ? 40 : 40 - splits.indent) + 1, `row ${index} holds ${at - from}`);
      assert.equal(line[at - 1], ' ');
      from = at;
    });
    assert.deepEqual(lineSplits('short', 40).at, []);
  });

  it('finds the row and column of a place and the place of a row and column, wrapped and folded', () => {
    const lines = ['GET _search', '{', `  "q": "${'x'.repeat(100)}"`, '}', 'last'];
    const layout = new ScreenLayout(lines, { wrap: true, wrapLimit: 50 });
    assert.equal(layout.count, 5);
    assert.equal(layout.rowCount(2), 3);
    assert.equal(layout.screenLength, 7);
    assert.deepEqual(layout.documentToScreen(3, 1), { row: 5, column: 1 });
    assert.deepEqual(layout.screenToDocument(6, 2), { row: 4, column: 2 });
    const within = layout.documentToScreen(2, 60);
    assert.equal(within.row, 3);
    assert.deepEqual(layout.screenToDocument(within.row, within.column), { row: 2, column: 60 });
    // A fold from the brace of row 1 to before the one of row 3 joins three rows into one line
    const folded = new ScreenLayout(lines, { wrap: false, wrapLimit: 80, folds: [{ start: { row: 1, column: 1 }, end: { row: 3, column: 0 }, placeholder: '...', inner: [], collapseChildren: 0 }] });
    assert.equal(folded.count, 3);
    assert.equal(folded.displayText(1), '{...}');
    assert.deepEqual(folded.documentToScreen(4, 0), { row: 2, column: 0 });
    assert.deepEqual(folded.documentToScreen(3, 1), { row: 1, column: 5 });
    assert.deepEqual(folded.screenToDocument(1, 5), { row: 3, column: 1 });
  });

  it('lays out thirty thousand lines without reading them all when they do not wrap, and keeps the wraps of unchanged lines', () => {
    const layout = new ScreenLayout(BIG, { wrap: false, wrapLimit: 80 });
    assert.equal(layout.screenLength, 30000);
    assert.deepEqual(layout.documentToScreen(29999, 1), { row: 29999, column: 1 });
    const known: Array<ReturnType<typeof lineSplits> | undefined> = new Array(BIG.length);
    const wrapped = new ScreenLayout(BIG, { wrap: true, wrapLimit: 20, splits: known });
    assert.ok(wrapped.screenLength > 30000);
    const changed = BIG.slice();
    changed[100] = 'changed';
    const reused = reuseSplits(BIG, known, changed);
    assert.equal(reused[99], known[99]);
    assert.equal(reused[100], undefined);
    assert.equal(reused[29999], known[29999]);
  });
});

describe('the tokens of a console editor, read as they are needed', () => {
  it('reads a row asked for at once and the rest in slices, to what reading the whole text gives', () => {
    const text = BIG.slice(0, 3000).join('\n');
    const lines = text.split('\n');
    const whole = highlight(text, 'output');
    const cache = new TokenCache(lines, 'output');
    assert.equal(cache.done, false);
    assert.deepEqual(cache.tokens(1), whole.lines[1]);
    let slices = 0;
    // A clock that says each slice is over after its first rows: the work comes in many slices
    let clock = 0;
    while (!cache.done) {
      cache.work(20, () => (clock += 30));
      slices += 1;
      assert.ok(slices < 5000);
    }
    assert.ok(slices > 100, `${slices} slices`);
    for (const row of [0, 1, 2, 1499, 2999]) assert.deepEqual(cache.tokens(row), whole.lines[row]);
  });

  it('reads again only what a change touched', () => {
    const before = readConsole('GET a\n{\n  "x": 1\n}\n\nGET b\n{\n  "y": 2\n}');
    const after = readConsole('GET a\n{\n  "x": 12\n}\n\nGET b\n{\n  "y": 2\n}', before);
    assert.equal(after.highlighted.lines[0], before.highlighted.lines[0]);
    assert.equal(after.highlighted.lines[7], before.highlighted.lines[7]);
    assert.notEqual(after.highlighted.lines[2], before.highlighted.lines[2]);
    assert.deepEqual(after.highlighted, highlight('GET a\n{\n  "x": 12\n}\n\nGET b\n{\n  "y": 2\n}', 'input'));
    const same = rehighlight(before.lines, before.highlighted, before.lines, 'input');
    assert.equal(same, before.highlighted);
  });

  it('marks the lines Ace folds from: brackets and parentheses that open or close', () => {
    assert.equal(foldWidget('  "a": {'), 'start');
    assert.equal(foldWidget('  "a": ['), 'start');
    assert.equal(foldWidget('  call('), 'start');
    assert.equal(foldWidget('  }'), 'end');
    assert.equal(foldWidget('  )'), 'end');
    assert.equal(foldWidget('  "a": {}'), '');
    assert.equal(foldWidget('  "a": 1'), '');
  });
});

describe('typing in a console editor, as Ace takes it', () => {
  it('closes a brace on Enter, a bracket and a quote as they are typed, and types over the closing one', () => {
    const session = input('GET _search\n');
    session.exec('gotoend');
    type(session, '{');
    assert.equal(session.getValue(), 'GET _search\n{');
    session.exec('insertstring', '\n');
    assert.equal(session.getValue(), 'GET _search\n{\n  \n}');
    assert.deepEqual(session.lead, { row: 2, column: 2 });
    type(session, '"');
    assert.equal(session.lines[2], '  ""');
    type(session, 'a');
    type(session, '"');
    assert.equal(session.lines[2], '  "a"');
    assert.deepEqual(session.lead, { row: 2, column: 5 });
    type(session, ': [');
    assert.equal(session.lines[2], '  "a": []');
    type(session, ']');
    assert.equal(session.lines[2], '  "a": []');
    assert.deepEqual(session.lead, { row: 2, column: 9 });
  });

  it('takes the pair of a bracket with it on Backspace, and puts a selection between a pair', () => {
    const session = input('');
    type(session, '[');
    assert.equal(session.getValue(), '[]');
    session.exec('backspace');
    assert.equal(session.getValue(), '');
    type(session, 'abc');
    session.exec('selectall');
    type(session, '(');
    assert.equal(session.getValue(), '(abc)');
    assert.equal(session.selectedText(), 'abc');
  });

  it('keeps the indentation after Enter, deepens it after an opening bracket, and puts a closing brace back under its line', () => {
    const session = input('{\n  "a": 1');
    session.exec('gotoend');
    session.exec('insertstring', '\n');
    assert.equal(session.getValue(), '{\n  "a": 1\n  ');
    session.exec('insertstring', '}');
    assert.equal(session.getValue(), '{\n  "a": 1\n}');
    const deeper = input('{\n  "a": [1');
    deeper.moveTo(1, 8);
    deeper.exec('insertstring', '\n');
    assert.equal(deeper.lines[2], '    1');
  });

  it('indents with Tab to the next stop, and the lines of a selection together, back with Shift+Tab', () => {
    const session = input('a\nb\nc');
    session.moveTo(0, 1);
    session.exec('indent');
    assert.equal(session.lines[0], 'a ');
    session.exec('undo');
    session.setSelectionRange({ start: { row: 0, column: 0 }, end: { row: 1, column: 1 } });
    session.exec('indent');
    assert.equal(session.getValue(), '  a\n  b\nc');
    session.exec('outdent');
    assert.equal(session.getValue(), 'a\nb\nc');
  });

  it('takes back what was typed a word at a time, and makes it again', () => {
    const session = input('');
    type(session, 'one two');
    assert.equal(session.getValue(), 'one two');
    session.exec('undo');
    assert.equal(session.getValue(), 'one');
    session.exec('undo');
    assert.equal(session.getValue(), '');
    session.exec('redo');
    session.exec('redo');
    assert.equal(session.getValue(), 'one two');
    const tracker = new UndoTracker();
    assert.equal(tracker.shouldMerge('insertstring', 'a', 1000), false);
    assert.equal(tracker.shouldMerge('insertstring', 'b', 1100), true);
    assert.equal(tracker.shouldMerge('insertstring', ' ', 1200), false);
    assert.equal(tracker.shouldMerge('insertstring', 'c', 1300), true);
    assert.equal(tracker.shouldMerge('insertstring', 'd', 3500), false);
    assert.equal(tracker.shouldMerge('removeline', undefined, 3600), false);
  });

  it('does not change a read-only text, and still moves, selects and folds in it', () => {
    const session = new ConsoleSession('{\n  "a": 1\n}', 'output', true);
    assert.equal(session.exec('insertstring', 'x'), false);
    assert.equal(session.exec('backspace'), false);
    assert.equal(session.exec('removeline'), false);
    assert.equal(session.getValue(), '{\n  "a": 1\n}');
    assert.equal(session.exec('selectall'), true);
    assert.equal(session.selectedText(), '{\n  "a": 1\n}');
    assert.equal(session.exec('gotostart'), true);
    assert.equal(session.exec('toggleFoldWidget'), true);
    assert.equal(session.folds.length, 1);
  });

  it('follows a text of thirty thousand lines: select all gives the whole text, a key costs a few lines', () => {
    const text = BIG.join('\n');
    const session = input(text);
    session.exec('selectall');
    assert.equal(session.selectedText(), text);
    assert.deepEqual(session.lead, { row: 29999, column: 1 });
    session.moveTo(15000, 1);
    const started = Date.now();
    type(session, 'abcdefghij');
    const took = Date.now() - started;
    assert.equal(session.lines[15000], '{abcdefghij');
    assert.equal(session.lines.length, 30000);
    assert.ok(took < 1500, `ten keys took ${took} ms`);
    assert.equal(session.offsetOf({ row: 15000, column: 11 }), session.positionOf(session.offsetOf({ row: 15000, column: 11 })).column + session.offsetOf({ row: 15000, column: 0 }));
  });

  it('moves the places after a change as Ace’s anchors move', () => {
    const insert = { action: 'insert' as const, start: { row: 1, column: 2 }, end: { row: 2, column: 3 }, text: 'ab\ncde' };
    assert.deepEqual(transformPoint({ row: 0, column: 5 }, insert), { row: 0, column: 5 });
    assert.deepEqual(transformPoint({ row: 1, column: 4 }, insert), { row: 2, column: 5 });
    assert.deepEqual(transformPoint({ row: 3, column: 1 }, insert), { row: 4, column: 1 });
    const remove = { action: 'remove' as const, start: { row: 1, column: 2 }, end: { row: 2, column: 3 }, text: 'ab\ncde' };
    assert.deepEqual(transformPoint({ row: 2, column: 1 }, remove), { row: 1, column: 2 });
    assert.deepEqual(transformPoint({ row: 2, column: 5 }, remove), { row: 1, column: 4 });
  });
});

describe('the keys of a console editor', () => {
  it('names keys as Ace’s bindings name them, and binds the fold keys the Help flyout lists', () => {
    assert.equal(keyName({ key: 'L', code: 'KeyL', ctrlKey: false, altKey: true, shiftKey: true, metaKey: false }), 'alt-shift-l');
    assert.equal(keyName({ key: 'ArrowUp', code: 'ArrowUp', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false }), 'ctrl-up');
    assert.deepEqual(bindingNames('Alt-L|Ctrl-F1'), ['alt-l', 'ctrl-f1']);
    const keys = commandKeys(false);
    assert.deepEqual(keys.get('alt-l'), ['fold']);
    assert.deepEqual(keys.get('alt-shift-l'), ['unfold']);
    assert.deepEqual(keys.get('f2'), ['toggleFoldWidget']);
    assert.deepEqual(keys.get('alt-0'), ['foldOther']);
    assert.deepEqual(keys.get('alt-shift-0'), ['unfoldall']);
    assert.deepEqual(keys.get('ctrl-f'), ['find']);
    assert.deepEqual(keys.get('ctrl-a'), ['selectall']);
    // Two commands of one key: the one bound last runs first
    assert.deepEqual(keys.get('shift-delete'), ['cut_or_delete']);
    const mac = commandKeys(true);
    assert.deepEqual(mac.get('alt-command-l'), ['fold']);
    assert.deepEqual(mac.get('ctrl-d'), ['del']);
  });

  it('folds the block of the cursor with Alt+L and opens it with Alt+Shift+L, all with Alt+Shift+0', () => {
    const session = new ConsoleSession('{\n  "a": {\n    "b": 1\n  },\n  "c": 2\n}', 'output', true);
    session.moveTo(1, 8);
    assert.equal(session.exec('fold'), true);
    assert.equal(session.folds.length, 1);
    assert.equal(session.layout.count, 4);
    assert.equal(session.layout.displayText(1), '  "a": {...},');
    session.moveTo(1, 8);
    session.exec('unfold');
    assert.equal(session.folds.length, 0);
    session.exec('toggleFoldWidget');
    assert.equal(session.folds.length, 1);
    session.exec('unfoldall');
    assert.equal(session.folds.length, 0);
    assert.equal(session.layout.count, 6);
  });

  it('selects the word about a place', () => {
    assert.deepEqual(wordRange(['GET _search'], 0, 6), { start: { row: 0, column: 4 }, end: { row: 0, column: 11 } });
    assert.deepEqual(wordRange(['a   b'], 0, 2), { start: { row: 0, column: 1 }, end: { row: 0, column: 4 } });
  });
});

describe('finding text in a console editor', () => {
  const lines = ['one two', 'Two three', 'two'];

  it('finds from the selection on and round past the end, and every match', () => {
    const start = { start: { row: 0, column: 0 }, end: { row: 0, column: 0 } };
    assert.deepEqual(findRange(lines, { needle: 'two', start }), { start: { row: 0, column: 4 }, end: { row: 0, column: 7 } });
    const second = findRange(lines, { needle: 'two', start: { start: { row: 0, column: 4 }, end: { row: 0, column: 7 } } });
    assert.deepEqual(second, { start: { row: 1, column: 0 }, end: { row: 1, column: 3 } });
    const cased = findRange(lines, { needle: 'two', caseSensitive: true, start: { start: { row: 0, column: 4 }, end: { row: 0, column: 7 } } });
    assert.deepEqual(cased, { start: { row: 2, column: 0 }, end: { row: 2, column: 3 } });
    const round = findRange(lines, { needle: 'one', start: { start: { row: 2, column: 0 }, end: { row: 2, column: 3 } } });
    assert.deepEqual(round, { start: { row: 0, column: 0 }, end: { row: 0, column: 3 } });
    assert.equal(findRange(lines, { needle: 'one', wrap: false, start: { start: { row: 2, column: 0 }, end: { row: 2, column: 3 } } }), undefined);
    assert.equal(findAllRanges(lines, { needle: 'two' }).length, 3);
    assert.equal(findAllRanges(lines, { needle: 't.o', regExp: true, caseSensitive: true }).length, 2);
    assert.equal(findRange(lines, { needle: '(', regExp: true, start }), undefined);
  });

  it('counts the matches as the search box of Ace does', () => {
    assert.equal(searchCounter(lines.join('\n'), searchRegExp({ needle: 'two' }), 8), '2 of 3');
    assert.equal(searchCounter('aaa', undefined, 0), '0 of 0');
    assert.equal(searchCounter('x'.repeat(1200), searchRegExp({ needle: 'x' }), 0), '1 of 999+');
  });

  it('selects what it finds, opens the fold it is in, and replaces', () => {
    const session = input('{\n  "a": {\n    "needle": 1\n  }\n}\nneedle');
    session.moveTo(1, 8);
    session.exec('fold');
    assert.equal(session.folds.length, 1);
    session.moveTo(0, 0);
    const found = session.find({ needle: 'needle', skipCurrent: false, wrap: true });
    assert.deepEqual(found, { start: { row: 2, column: 5 }, end: { row: 2, column: 11 } });
    assert.equal(session.folds.length, 0);
    assert.equal(session.selectedText(), 'needle');
    assert.equal(session.replaceAll('pin', { needle: 'needle' }), 2);
    assert.equal(session.getValue(), '{\n  "a": {\n    "pin": 1\n  }\n}\npin');
    session.exec('undo');
    assert.equal(session.getValue(), '{\n  "a": {\n    "needle": 1\n  }\n}\nneedle');
  });
});

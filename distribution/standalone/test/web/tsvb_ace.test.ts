/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { aceLessFoldWidget, aceLessLine, tokenizeAceLess } from '../../web/apps/visualize/tsvb/ace_less';
import { aceFoldWidget, aceMarkdownLine, tokenizeAceMarkdown } from '../../web/apps/visualize/tsvb/ace_markdown';
import { aceKind } from '../../web/apps/visualize/tsvb/ace_tokenizer';

/** The runs of each line as [text, kind] pairs, the kind '' for plain text */
const runs = (text: string) => tokenizeAceMarkdown(text).map((line) => line.map((token) => [token.text, token.kind ?? '']));

describe("TSVB's Markdown text, coloured as the original's editor colours it", () => {
  it('reads the sample text as ACE does, run by run', () => {
    // The sample "(TSVB) Sample static markdown", and the runs the original's editor drew for it
    const text = [
      '# A first-level heading',
      '',
      '- **This is bold text**',
      '- _This text is italicized_',
      '- ~~This was mistaken text~~',
      '- ***All this text is important***',
      '',
      'Text that is not a quote',
      '',
      '> Text that is a quote',
      '',
      "Use `git status` to list all new or modified files that haven't yet been committed.",
      'Some basic Git commands are:',
      '```',
      'git status',
      '```',
    ].join('\n');
    assert.deepEqual(runs(text), [
      [['', 'AceFoldStart'], ['#', 'AceHeading'], [' A first-level heading', 'AceHeading']],
      [],
      [['- ', 'AceList'], ['**This is bold text**', 'AceString']],
      [['- ', 'AceList'], ['_This text is italicized_', 'AceString']],
      [['- ', 'AceList'], ['~~This was mistaken text~~', 'AceList']],
      [['- ', 'AceList'], ['***All this text is important***', 'AceString']],
      [],
      [['Text that is not a quote', '']],
      [],
      [['> Text that is a quote', 'AceString']],
      [],
      [['Use ', ''], ['`git status`', 'AceFunction'], [" to list all new or modified files that haven't yet been committed.", '']],
      [['Some basic Git commands are:', '']],
      [['', 'AceFoldStart'], ['```', 'AceFunction']],
      [['git status', 'AceFunction']],
      [['', 'AceFoldEnd'], ['```', 'AceFunction']],
    ]);
  });

  it('keeps a list going to its first empty line, and a quote likewise', () => {
    assert.deepEqual(runs('1. one\ntwo\n\nthree'), [[['1. ', 'AceList'], ['one', 'AceList']], [['two', 'AceList']], [], [['three', '']]]);
    assert.deepEqual(runs('> one\ntwo\n\nthree'), [[['> one', 'AceString']], [['two', 'AceString']], [], [['three', '']]]);
  });

  it('colours links, their address underlined, and escapes', () => {
    assert.deepEqual(runs('Go [home](/) or [x][y] \\*'), [
      [
        ['Go ', ''],
        ['[', ''],
        ['home', 'AceString'],
        ['](', ''],
        ['/', 'AceUnderline'],
        [')', ''],
        [' or ', ''],
        ['[', ''],
        ['x', 'AceString'],
        ['][', ''],
        ['y', 'AceConstant'],
        [']', ''],
        [' ', ''],
        ['\\*', 'AceLanguage'],
      ],
    ]);
  });

  it('takes an indented block after an empty line, and a rule, as ACE does', () => {
    assert.deepEqual(runs('\n    code\n***'), [[], [['    code', 'AceFunction']], [['***', 'AceConstant']]]);
    // A line of dashes is read as a heading's underline first, and opens a fold
    assert.deepEqual(runs('---'), [[['', 'AceFoldStart'], ['---', 'AceHeading']]]);
  });

  it('colours the HTML the text holds: tags, their attributes, comments over lines, entities', () => {
    assert.deepEqual(runs('<b class="x">a</b> &amp; <!-- c\nd --> e'), [
      [
        ['<', 'AceTag'],
        ['b', 'AceTag'],
        [' ', ''],
        ['class', ''],
        ['=', 'AceOperator'],
        ['"x"', 'AceString'],
        ['>', 'AceTag'],
        ['a', ''],
        ['</', 'AceTag'],
        ['b', 'AceTag'],
        ['>', 'AceTag'],
        [' ', ''],
        ['&amp;', 'AceLanguage'],
        [' ', ''],
        ['<!--', 'AceComment'],
        [' c', 'AceComment'],
      ],
      [['d ', 'AceComment'], ['-->', 'AceComment'], [' e', '']],
    ]);
  });

  it('colours attributes as ACE does: a value without quotes, and a quoted one over lines with an entity in it', () => {
    assert.deepEqual(runs('<a href=x title="a&amp;b\nc">t</a>'), [
      [
        ['<', 'AceTag'],
        ['a', 'AceTag'],
        [' ', ''],
        ['href', ''],
        ['=', 'AceOperator'],
        ['x', 'AceString'],
        [' ', ''],
        ['title', ''],
        ['=', 'AceOperator'],
        ['"a', 'AceString'],
        ['&amp;', 'AceLanguage'],
        ['b', 'AceString'],
      ],
      [
        ['c"', 'AceString'],
        ['>', 'AceTag'],
        ['t', ''],
        ['</', 'AceTag'],
        ['a', 'AceTag'],
        ['>', 'AceTag'],
      ],
    ]);
  });

  it('reads the first state of a line whatever the case, as ACE reads it', () => {
    assert.deepEqual(runs('<HTTP://X.ORG>'), [[['<', ''], ['HTTP://X.ORG', 'AceUrl'], ['>', '']]]);
  });

  it('leaves a heading at its end, also when something it holds reaches the end, as ACE', () => {
    assert.equal(aceMarkdownLine('# Title', 'start').state, 'start');
    assert.equal(aceMarkdownLine('# Title `x`', 'start').state, 'start');
    assert.equal(aceMarkdownLine('', 'start').state, 'allowBlock');
    assert.equal(aceMarkdownLine('```', 'start').state, 'githubblock');
    assert.equal(aceMarkdownLine('<a title="x', 'start').state, 'doubleQuoted');
  });

  it("puts ACE's arrows where its markdown folds start and fenced blocks end", () => {
    assert.equal(aceFoldWidget('## Two', 'start'), 'start');
    assert.equal(aceFoldWidget('##Two', 'start'), undefined);
    assert.equal(aceFoldWidget('===', 'start'), 'start');
    assert.equal(aceFoldWidget('```js', 'githubblock'), 'start');
    assert.equal(aceFoldWidget('```', 'start'), 'end');
    assert.equal(aceFoldWidget(' ```', 'githubblock'), undefined);
  });

  it('gives each ACE token the colour the textmate theme gives it', () => {
    assert.equal(aceKind('markup.heading.3'), 'AceHeading');
    assert.equal(aceKind('markup.list'), 'AceList');
    assert.equal(aceKind('string.blockquote'), 'AceString');
    assert.equal(aceKind('support.function'), 'AceFunction');
    assert.equal(aceKind('support.variable'), 'AceVariable');
    assert.equal(aceKind('markup.underline'), 'AceUnderline');
    assert.equal(aceKind('text.xml'), undefined);
    assert.equal(aceKind('entity.other.attribute-name.xml'), undefined);
    // Two classes before one: a number and a unit as variables, CSS words as strings
    assert.equal(aceKind('constant.numeric'), 'AceVariable');
    assert.equal(aceKind('constant'), 'AceConstant');
    assert.equal(aceKind('keyword'), 'AceVariable');
    assert.equal(aceKind('keyword.operator'), 'AceOperator');
    assert.equal(aceKind('support.constant.color'), 'AceString');
    assert.equal(aceKind('support.type.unknownProperty'), 'AceType');
    assert.equal(aceKind('variable.language'), 'AceVariable');
    assert.equal(aceKind('paren.lparen'), undefined);
  });
});

describe("TSVB's custom CSS, coloured as the original's editor colours less", () => {
  const lessRuns = (text: string) => tokenizeAceLess(text).map((line) => line.map((token) => [token.text, token.kind ?? '']));

  it('reads selectors, properties, variables and numbers as ACE does, an arrow where a block opens', () => {
    assert.deepEqual(lessRuns('.title {\n  color: @accent; font-size: 14px;\n}'), [
      [['', 'AceFoldStart'], ['.title', 'AceVariable'], [' ', ''], ['{', '']],
      [
        ['  ', ''],
        ['color', 'AceType'],
        [': ', ''],
        ['@accent', 'AceVariable'],
        ['; ', ''],
        ['font-size', 'AceType'],
        [': ', ''],
        ['14', 'AceVariable'],
        ['px', 'AceVariable'],
        [';', ''],
      ],
      [['}', '']],
    ]);
  });

  it('colours functions, strings, colours and CSS words, and keywords', () => {
    assert.deepEqual(lessRuns('background: url(x.png) #fff red;'), [
      [
        ['background', 'AceType'],
        [': ', ''],
        ['url', 'AceFunction'],
        ['(', ''],
        ['x.png', 'AceString'],
        [')', ''],
        [' ', ''],
        ['#fff', 'AceVariable'],
        [' ', ''],
        ['red', 'AceString'],
        [';', ''],
      ],
    ]);
    assert.deepEqual(lessRuns('&:hover'), [[['&', 'AceVariable'], [':hover', 'AceVariable']]]);
    assert.deepEqual(lessRuns('@media'), [[['@media', 'AceVariable']]]);
  });

  it('takes a selector with a pseudo-class for a property, as ACE does, and comments over lines', () => {
    assert.deepEqual(lessRuns('/* a\nb */ a:hover'), [
      [['', 'AceFoldStart'], ['/* a', 'AceComment']],
      [['b */', 'AceComment'], [' ', ''], ['a', 'AceType'], [':', ''], ['hover', '']],
    ]);
    assert.equal(aceLessLine('/* a', 'start').state, 'comment');
  });

  it('draws no arrow at a comment on one line or a block closed on its line', () => {
    assert.equal(aceLessFoldWidget('/* one */'), undefined);
    assert.equal(aceLessFoldWidget('a { color: red; }'), undefined);
    assert.equal(aceLessFoldWidget('.m(@a) {'), 'start');
    assert.equal(aceLessFoldWidget('//#region x'), 'start');
  });
});

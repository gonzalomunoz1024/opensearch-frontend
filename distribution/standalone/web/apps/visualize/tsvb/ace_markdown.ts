/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Markdown coloured as the original's code editor colours it: the rules of ACE's markdown mode, in
 * their order and with the state a line leaves to the next, and of the HTML it holds (tags and their
 * attributes, comments, entities). A line where ACE draws an arrow in the gutter (the start of a
 * fold, or the end of a fenced block) starts with an empty run that says so.
 *
 * Not taken from ACE: the colouring of the code in a block fenced as js, javascript, xml, html or
 * css, and of the content of a <style> or <script> tag, in that language (such a block is coloured as
 * any other fenced block, such content as text); CDATA sections, processing instructions and
 * doctypes.
 *
 * Derived from the Ace editor as brace 0.11.1 holds it, BSD 3-Clause License, Copyright (c) 2010,
 * Ajax.org B.V.
 */

import type { CodeToken } from '../../../components/code_editor';
import { aceMode, aceRuns, type AceRule, type AceState, type AceToken } from './ace_tokenizer';

type State =
  | 'start'
  | 'allowBlock'
  | 'header'
  | 'listblock-start'
  | 'listblock'
  | 'blockquote'
  | 'githubblock'
  | 'comment'
  | 'tag'
  | 'attributeValue'
  | 'singleQuoted'
  | 'doubleQuoted';

/** What may stand between two marks, a mark escaped by a backslash included (ACE's `escaped`) */
const escaped = (mark: string) => `(?:[^\\\\${mark}]|\\\\.)*`;

const BASIC: Array<AceRule<State>> = [
  { regex: '\\\\[\\\\`*_{}\\[\\]()#+\\-.!]', token: 'constant.language.escape' },
  { regex: '(`+)(.*?[^`])(\\1)', token: 'support.function' },
  { regex: '^([ ]{0,3}\\[)([^\\]]+)(\\]:\\s*)([^ ]+)(\\s*(?:["][^"]+["])?\\s*)$', token: ['text', 'constant', 'text', 'url', 'string'] },
  { regex: `(\\[)(${escaped('\\]')})(\\]\\s*\\[)(${escaped('\\]')})(\\])`, token: ['text', 'string', 'text', 'constant', 'text'] },
  {
    regex: `(\\[)(${escaped('\\]')})(\\]\\()((?:[^\\)\\s\\\\]|\\\\.|\\s(?=[^"]))*)(\\s*"${escaped('"')}"\\s*)?(\\))`,
    token: ['text', 'string', 'text', 'markup.underline', 'string', 'text'],
  },
  { regex: '([*]{2}|[_]{2}(?=\\S))(.*?\\S[*_]*)(\\1)', token: 'string.strong' },
  { regex: '([*]|[_](?=\\S))(.*?\\S[*_]*)(\\1)', token: 'string.emphasis' },
  {
    regex: '(<)((?:https?|ftp|dict):[^\'">\\s]+|(?:mailto:)?[-.\\w]+\\@[-a-z0-9]+(?:\\.[-a-z0-9]+)*\\.[a-z]+)(>)',
    token: ['text', 'url', 'text'],
  },
];

const LIST = '^\\s{0,3}(?:[*+-]|\\d+\\.)\\s+';
const QUOTE = '^\\s*>\\s*(?:[*+-]|\\d+\\.)?\\s+';
const ENTITY = '(?:&#[0-9]+;)|(?:&#x[0-9a-fA-F]+;)|(?:&[a-zA-Z0-9_:\\.-]+;)';

/** An attribute's quoted value, which may go on over lines, entities in it */
const quoted = (quote: string): AceState<State> => ({
  rules: [
    { regex: quote, token: 'string.attribute-value.xml', next: 'tag' },
    { regex: ENTITY, token: 'constant.language.escape.reference.attribute-value.xml' },
  ],
  defaultToken: 'string.attribute-value.xml',
});

const STATES: Record<State, AceState<State>> = {
  start: {
    rules: [
      { regex: '^$', token: 'empty_line', next: 'allowBlock' },
      { regex: '^=+(?=\\s*$)', token: 'markup.heading.1' },
      { regex: '^\\-+(?=\\s*$)', token: 'markup.heading.2' },
      { regex: '^#{1,6}(?=\\s*[^ #]|\\s+#.)', token: (value) => `markup.heading.${value.length}`, next: 'header' },
      { regex: '^\\s*```\\s*\\S*(?:{.*?\\})?\\s*$', token: 'support.function', next: 'githubblock' },
      { regex: QUOTE, token: 'string.blockquote', next: 'blockquote' },
      { regex: '^ {0,2}(?:(?: ?\\* ?){3,}|(?: ?\\- ?){3,}|(?: ?\\_ ?){3,})\\s*$', token: 'constant', next: 'allowBlock' },
      { regex: LIST, token: 'markup.list', next: 'listblock-start' },
      ...BASIC,
      // The HTML the text may hold
      { regex: '<\\!--', token: 'comment.start.xml', next: 'comment' },
      {
        regex: '(</?)([-_a-zA-Z0-9:.]+)',
        token: (open) => [`meta.tag.punctuation.${open === '<' ? '' : 'end-'}tag-open.xml`, 'meta.tag.tag-name.xml'],
        next: 'tag',
      },
      { regex: '</', token: 'text.end-tag-open.xml' },
      { regex: '<', token: 'text.tag-open.xml' },
      { regex: ENTITY, token: 'constant.language.escape.reference.xml' },
    ],
    defaultToken: 'text.xml',
    // As ACE's: its rule for a doctype, which this state has in ACE, asks for it
    caseInsensitive: true,
  },
  allowBlock: {
    rules: [
      { regex: '^ {4}.+', token: 'support.function', next: 'allowBlock' },
      { regex: '^$', token: 'empty_line', next: 'allowBlock' },
      { regex: '', token: 'empty', next: 'start' },
    ],
  },
  header: { rules: [{ regex: '$', next: 'start' }, ...BASIC], defaultToken: 'heading' },
  'listblock-start': { rules: [{ regex: '(?:\\[[ x]\\])?', token: 'support.variable', next: 'listblock' }] },
  listblock: {
    rules: [
      { regex: '^$', token: 'empty_line', next: 'start' },
      { regex: LIST, token: 'markup.list', next: 'listblock-start' },
      ...BASIC,
      { regex: '^\\s*```\\s*[a-zA-Z]*(?:{.*?\\})?\\s*$', token: 'support.function', next: 'githubblock' },
    ],
    defaultToken: 'list',
  },
  blockquote: {
    rules: [{ regex: '^\\s*$', token: 'empty_line', next: 'start' }, { regex: QUOTE, token: 'string.blockquote', next: 'blockquote' }, ...BASIC],
    defaultToken: 'string.blockquote',
  },
  githubblock: { rules: [{ regex: '^\\s*```', token: 'support.function', next: 'start' }], defaultToken: 'support.function' },
  comment: { rules: [{ regex: '-->', token: 'comment.end.xml', next: 'start' }], defaultToken: 'comment.xml' },
  tag: {
    rules: [
      { regex: '\\s+', token: 'text.tag-whitespace.xml' },
      { regex: '[-_a-zA-Z0-9:.]+', token: 'entity.other.attribute-name.xml' },
      { regex: '=', token: 'keyword.operator.attribute-equals.xml', next: 'attributeValue' },
      { regex: "'", token: 'string.attribute-value.xml', next: 'singleQuoted' },
      { regex: '"', token: 'string.attribute-value.xml', next: 'doubleQuoted' },
      { regex: '/?>', token: 'meta.tag.punctuation.tag-close.xml', next: 'start' },
    ],
  },
  // After "=": a value without quotes, or back to the tag (where a quoted one is read)
  attributeValue: {
    rules: [
      { regex: '\\s+', token: 'text.tag-whitespace.xml' },
      { regex: '[^<>=\'"`\\s]+', token: 'string.unquoted.attribute-value.html', next: 'tag' },
      { regex: '', token: 'empty', next: 'tag' },
    ],
  },
  singleQuoted: quoted("'"),
  doubleQuoted: quoted('"'),
};

const MARKDOWN = aceMode(STATES, 'start');

/** One line as ACE reads it in a state: its tokens, those of a type run together, and the state it leaves */
export function aceMarkdownLine(line: string, state: State): { tokens: AceToken[]; state: State } {
  return MARKDOWN.line(line, state);
}

const FOLD = /^(?:[=-]+\s*$|#{1,6} |`{3})/;

/**
 * The arrow ACE draws in the gutter of a line: at a heading, a line of = or -, or a fence that opens
 * a block ("start"); at the fence that closes one ("end")
 */
export function aceFoldWidget(line: string, stateAfter: State): 'start' | 'end' | undefined {
  if (!FOLD.test(line)) return undefined;
  if (line[0] === '`') return stateAfter === 'start' ? 'end' : 'start';
  return 'start';
}

/** Markdown as the original's editor colours it, a line at a time */
export function tokenizeAceMarkdown(text: string): CodeToken[][] {
  return aceRuns(MARKDOWN, text, 'start', aceFoldWidget);
}

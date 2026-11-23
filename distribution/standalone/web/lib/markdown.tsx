/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Markdown, read by the parser OpenSearch Dashboards reads it with, markdown-it 14.2.0, and drawn
 * as it draws it there:
 *
 * - `Markdown`: the Markdown visualization, the Markdown panel of TSVB and the help of a Timeline
 *   function. The original's Markdown component (opensearch_dashboards_react's markdownFactory)
 *   gives markdown-it's default rules, with HTML off and links found in the text (linkify), and a
 *   link that opens a new tab the `rel` of OUI's getSecureRelForTarget; it sets the HTML in a div.
 * - `renderMarkdown`: the custom banner (notifications:banner), which core's UserBannerService
 *   draws with react-markdown 6: CommonMark, each paragraph without its <p>, and a link that
 *   leads to anything but a page, http(s), mailto or tel leading nowhere.
 *
 * HTML written in the text is shown as the text it is by both, and markdown-it makes no link of
 * a javascript:, vbscript:, file: or data: address (but a data:image/ picture). Both take time in
 * proportion to the text, however it is written.
 */

import MarkdownIt, { type RenderRule, type Token } from 'markdown-it';
import { createElement, Fragment, useMemo, type ReactNode } from 'react';

export interface MarkdownOptions {
  /** As the visualization's "Open links in new tab" */
  openLinksInNewTab?: boolean;
}

// --- The rel of a link that opens a new tab --------------------------------------------------------

const ELASTIC_PATH = /^[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=]*$/;
// What `.` does not match: the four characters that end a line
const LINE_END = /[\n\r\u2028\u2029]/;

/**
 * OUI 1.24.2's isDomainSecure: whether the first match of
 * /(https?:\/\/(.+?\.)?elastic\.co((\/|\?)[A-Za-z0-9\-\._~:\/\?#\[\]@!$&'\(\)\*\+,;\=]*)?)/g in the
 * address is the whole address. The same answer is worked out here in one pass over it, where the
 * pattern itself runs to the end once for every "http://" a long address repeats.
 */
function isDomainSecure(url: string): boolean {
  const scheme = /^https?:\/\//.exec(url);
  if (!scheme) return false;
  const host = scheme[0].length;
  // The shortest `.+?\.` that "elastic.co" follows: at least one character, none of them ending a line
  const lineEnd = url.slice(host).search(LINE_END);
  const dot = url.indexOf('.elastic.co', host + 1);
  let end: number;
  if (dot !== -1 && (lineEnd === -1 || dot < host + lineEnd)) end = dot + '.elastic.co'.length;
  else if (url.startsWith('elastic.co', host)) end = host + 'elastic.co'.length;
  else return false;
  if (end === url.length) return true;
  return (url[end] === '/' || url[end] === '?') && ELASTIC_PATH.test(url.slice(end + 1));
}

/** OUI 1.24.2's getSecureRelForTarget: noreferrer but to elastic.co, and noopener for a new tab */
export function getSecureRelForTarget({ href, target = '', rel }: { href?: string; target?: string; rel?: string }): string {
  const isElasticHref = !!href && isDomainSecure(href);
  const relParts = rel ? rel.split(' ').filter((part) => !!part.length && part !== 'noreferrer') : [];
  if (!isElasticHref) relParts.push('noreferrer');
  if (target.includes('_blank') && relParts.indexOf('noopener') === -1) relParts.push('noopener');
  return relParts.sort().join(' ').trim();
}

// --- The Markdown component -------------------------------------------------------------------------

// As the original's markdownFactory, one parser for each choice of the option, made once
const parsers = new Map<boolean, MarkdownIt>();

function parserFor(openLinksInNewTab: boolean): MarkdownIt {
  const known = parsers.get(openLinksInNewTab);
  if (known) return known;
  // HTML stays off: what markdown-it gives is set as HTML
  const markdownIt = new MarkdownIt({ html: false, linkify: true });
  if (openLinksInNewTab) {
    const originalLinkRender: RenderRule =
      markdownIt.renderer.rules.link_open ?? ((tokens, index, options, _env, self) => self.renderToken(tokens, index, options));
    markdownIt.renderer.rules.link_open = (tokens, index, options, env, self) => {
      const href = tokens[index].attrGet('href');
      const target = '_blank';
      const rel = getSecureRelForTarget({ href: href === null ? undefined : href, target });
      tokens[index].attrPush(['target', target]);
      if (rel) tokens[index].attrPush(['rel', rel]);
      return originalLinkRender(tokens, index, options, env, self);
    };
  }
  parsers.set(openLinksInNewTab, markdownIt);
  return markdownIt;
}

/** A text as the HTML the original's Markdown component sets: none for no text */
export function markdownToHtml(text: string, options: MarkdownOptions = {}): string {
  return typeof text === 'string' && text !== '' ? parserFor(Boolean(options.openLinksInNewTab)).render(text) : '';
}

/**
 * The original's Markdown component: its HTML set in a div. `testId` is the `data-test-subj` the
 * original's callers give that div (the Markdown visualization's "markdownBody").
 */
export function Markdown({ text, openLinksInNewTab, className, testId }: { text: string; openLinksInNewTab?: boolean; className?: string; testId?: string }) {
  const html = useMemo(() => markdownToHtml(text, { openLinksInNewTab }), [text, openLinksInNewTab]);
  return <div className={`atlMarkdown${className ? ` ${className}` : ''}`} data-test-subj={testId} dangerouslySetInnerHTML={{ __html: html }} />;
}

// --- The custom banner ------------------------------------------------------------------------------

const PROTOCOLS = ['http', 'https', 'mailto', 'tel'];

/** react-markdown 6.0.3's uriTransformer, which it gives every link (not pictures) */
function uriTransformer(uri: string): string {
  const url = (uri || '').trim();
  const first = url.charAt(0);
  if (first === '#' || first === '/') return url;
  const colon = url.indexOf(':');
  if (colon === -1) return url;
  for (const protocol of PROTOCOLS) {
    if (colon === protocol.length && url.slice(0, protocol.length).toLowerCase() === protocol) return url;
  }
  let index = url.indexOf('?');
  if (index !== -1 && colon > index) return url;
  index = url.indexOf('#');
  if (index !== -1 && colon > index) return url;
  return 'javascript:void(0)';
}

let commonMark: MarkdownIt | undefined;

/**
 * markdown-it's CommonMark rules, read as remark 9 (react-markdown 6's parser) reads a text: HTML
 * stays text, every link is one, its address is encoded as mdast-util-to-hast encodes it and the
 * text of an autolink is left as written. Quotes and lists nest a hundred steps deep, as in the
 * Markdown component, where remark has no end.
 */
function commonMarkParser(): MarkdownIt {
  if (commonMark) return commonMark;
  const markdownIt = new MarkdownIt('commonmark', { html: false, maxNesting: 100 });
  markdownIt.validateLink = () => true;
  markdownIt.normalizeLink = (url) => markdownIt.utils.lib.mdurl.encode(url);
  markdownIt.normalizeLinkText = (url) => url;
  commonMark = markdownIt;
  return markdownIt;
}

interface Block {
  token: Token;
  children: Block[];
}

/** The blocks of a parsed text as the tree their opening and closing tokens make */
function blockTree(tokens: Token[]): Block[] {
  const root: Block[] = [];
  const open: Block[] = [];
  for (const token of tokens) {
    const siblings = open.length ? open[open.length - 1].children : root;
    if (token.nesting === -1) {
      open.pop();
      continue;
    }
    const block = { token, children: [] };
    siblings.push(block);
    if (token.nesting === 1) open.push(block);
  }
  return root;
}

/** The alternative text of a picture, as mdast-util-to-string gives it */
function altText(tokens: Token[]): string {
  return tokens
    .map((token) => (token.type === 'image' ? altText(token.children ?? []) : token.type === 'text' || token.type === 'code_inline' ? token.content : token.type === 'softbreak' ? '\n' : ''))
    .join('');
}

/**
 * An element keyed by its place among its siblings, as react-markdown keys them. Children are
 * handed over as an array: a text of thousands of them would not fit in a call's arguments.
 */
function element(type: string, props: Record<string, unknown> | null, children: ReactNode[], key: number): ReactNode {
  return children.length ? createElement(type, { ...props, key }, children) : createElement(type, { ...props, key });
}

function inlineNodes(tokens: Token[]): ReactNode[] {
  const root: ReactNode[] = [];
  const open: Array<{ token: Token; children: ReactNode[] }> = [];
  const siblings = () => (open.length ? open[open.length - 1].children : root);
  for (const token of tokens) {
    const into = siblings();
    if (token.type === 'text') into.push(token.content);
    else if (token.type === 'softbreak') into.push('\n');
    else if (token.type === 'hardbreak') into.push(element('br', null, [], into.length), '\n');
    else if (token.type === 'code_inline') into.push(element('code', null, [token.content], into.length));
    else if (token.type === 'image') {
      const title = token.attrGet('title');
      const props = { src: token.attrGet('src') ?? '', alt: altText(token.children ?? []), ...(title === null ? {} : { title }) };
      into.push(element('img', props, [], into.length));
    } else if (token.nesting === 1) open.push({ token, children: [] });
    else if (token.nesting === -1) {
      const closed = open.pop();
      if (!closed) continue;
      const title = closed.token.attrGet('title');
      const props = closed.token.type === 'link_open' ? { href: uriTransformer(closed.token.attrGet('href') ?? ''), ...(title === null ? {} : { title }) } : null;
      const parent = siblings();
      parent.push(element(closed.token.tag, props, closed.children, parent.length));
    }
  }
  return root;
}

/** mdast-util-to-hast's wrap: blocks one line apart, and a line before and after them in a container */
function wrap(nodes: ReactNode[], loose: boolean): ReactNode[] {
  const result: ReactNode[] = loose ? ['\n'] : [];
  nodes.forEach((node, index) => {
    if (index) result.push('\n');
    result.push(node);
  });
  if (loose && nodes.length > 0) result.push('\n');
  return result;
}

/** Whether a list is loose, as markdown-it marks it: the paragraphs of a tight list are hidden */
const looseList = (list: Block) =>
  list.children.some((item) => item.children.some((child) => child.token.type === 'paragraph_open' && !child.token.hidden));

/** mdast-util-to-hast's list item: a tight item's first paragraph on the line of its mark */
function listItem(item: Block, loose: boolean, key: number): ReactNode {
  const wrapped: ReactNode[] = [];
  item.children.forEach((child, index) => {
    if (loose || index !== 0 || child.token.type !== 'paragraph_open') wrapped.push('\n');
    wrapped.push(blockNode(child, index));
  });
  const last = item.children[item.children.length - 1];
  if (last && (loose || last.token.type !== 'paragraph_open')) wrapped.push('\n');
  return element('li', null, wrapped, key);
}

function blockNode(block: Block, key: number): ReactNode {
  const { token } = block;
  const inline = () => inlineNodes(block.children[0]?.token.children ?? []);
  switch (token.type) {
    case 'paragraph_open':
      // react-markdown is given `components={{ p: Fragment }}`
      return createElement(Fragment, { key }, inline());
    case 'heading_open':
      return element(token.tag, null, inline(), key);
    case 'blockquote_open':
      return element('blockquote', null, wrap(block.children.map(blockNode), true), key);
    case 'bullet_list_open':
    case 'ordered_list_open': {
      const loose = looseList(block);
      const start = token.attrGet('start');
      const items = block.children.map((item, index) => listItem(item, loose, index));
      return element(token.tag, start === null ? null : { start: Number(start) }, wrap(items, true), key);
    }
    case 'code_block':
    case 'fence': {
      // The first word of the line that opens the fence, read as remark reads it
      const language = /^[^ \t]+/.exec(commonMarkParser().utils.unescapeAll(token.info).trim())?.[0];
      // remark keeps the lines without their last line end, and mdast-util-to-hast ends any code
      // that is not empty with one: a fence never closed gains it, one holding a blank line is empty
      const lines = token.content.endsWith('\n') ? token.content.slice(0, -1) : token.content;
      const code = element('code', language ? { className: `language-${language}` } : null, lines ? [`${lines}\n`] : [], 0);
      return element('pre', null, [code], key);
    }
    case 'hr':
      return element('hr', null, [], key);
    default:
      return null;
  }
}

/** A text as React nodes, as the custom banner draws it (react-markdown 6, a paragraph without its <p>) */
export function renderMarkdown(text: string): ReactNode[] {
  if (typeof text !== 'string' || text === '') return [];
  const blocks = blockTree(commonMarkParser().parse(text, {}));
  return wrap(blocks.map(blockNode), false);
}

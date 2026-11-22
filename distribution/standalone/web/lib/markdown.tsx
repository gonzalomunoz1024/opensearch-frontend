/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Markdown as React elements: headings, paragraphs, lists, quotes, code, tables, rules, links,
 * images and emphasis. Nothing is ever set as HTML: HTML in the text is shown as the text it is,
 * and a link is kept only when it leads somewhere a page may safely send its reader.
 */

import { Fragment, type ReactNode } from 'react';

export interface MarkdownOptions {
  openLinksInNewTab?: boolean;
}

const SAFE_LINK = /^(https?:|mailto:|tel:|#|\/|\.\.?\/|[^:]*$)/i;
const SAFE_IMAGE = /^(https?:|\/|\.\.?\/|data:image\/(png|gif|jpeg|webp);|[^:]*$)/i;

export const safeLink = (href: string): string | undefined => (SAFE_LINK.test(href.trim()) ? href.trim() : undefined);

// --- Inline ---------------------------------------------------------------------------------------

interface Rule {
  pattern: RegExp;
  render: (match: RegExpExecArray, options: MarkdownOptions, key: string) => ReactNode;
}

const link = (href: string, children: ReactNode, title: string | undefined, options: MarkdownOptions, key: string) => {
  const safe = safeLink(href);
  if (!safe) return <Fragment key={key}>{children}</Fragment>;
  return (
    <a key={key} href={safe} title={title} {...(options.openLinksInNewTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
      {children}
    </a>
  );
};

const RULES: Rule[] = [
  { pattern: /\\([\\`*_{}[\]()#+\-.!|~<>])/, render: (match) => match[1] },
  { pattern: /(`+)([\s\S]+?)\1(?!`)/, render: (match, _options, key) => <code key={key}>{match[2].trim()}</code> },
  {
    pattern: /!\[([^\]]*)\]\(\s*<?([^\s)>]+)>?(?:\s+["']([^"']*)["'])?\s*\)/,
    render: (match, _options, key) =>
      SAFE_IMAGE.test(match[2]) ? <img key={key} src={match[2]} alt={match[1]} title={match[3]} /> : <Fragment key={key}>{match[1]}</Fragment>,
  },
  {
    pattern: /\[((?:[^[\]]|\[[^\]]*\])*)\]\(\s*<?([^\s)>]*)>?(?:\s+["']([^"']*)["'])?\s*\)/,
    render: (match, options, key) => link(match[2], renderInline(match[1], options, key), match[3], options, key),
  },
  { pattern: /<((?:https?|mailto):[^\s>]+)>/, render: (match, options, key) => link(match[1], match[1].replace(/^mailto:/, ''), undefined, options, key) },
  { pattern: /\*\*([\s\S]+?)\*\*(?!\*)/, render: (match, options, key) => <strong key={key}>{renderInline(match[1], options, key)}</strong> },
  { pattern: /(?<![A-Za-z0-9])__([\s\S]+?)__(?![A-Za-z0-9])/, render: (match, options, key) => <strong key={key}>{renderInline(match[1], options, key)}</strong> },
  { pattern: /~~([\s\S]+?)~~/, render: (match, options, key) => <s key={key}>{renderInline(match[1], options, key)}</s> },
  { pattern: /\*(?!\s)([^*]+?)(?<!\s)\*/, render: (match, options, key) => <em key={key}>{renderInline(match[1], options, key)}</em> },
  { pattern: /(?<![A-Za-z0-9])_(?!\s)([^_]+?)(?<!\s)_(?![A-Za-z0-9])/, render: (match, options, key) => <em key={key}>{renderInline(match[1], options, key)}</em> },
  { pattern: /(?: {2,}|\\)\n/, render: (_match, _options, key) => <br key={key} /> },
  {
    pattern: /\bhttps?:\/\/[^\s<>()]+(?:\([^\s<>()]*\))?[^\s<>().,;:!?'"]/,
    render: (match, options, key) => link(match[0], match[0], undefined, options, key),
  },
];

export function renderInline(text: string, options: MarkdownOptions = {}, keyPrefix = 'i'): ReactNode[] {
  const nodes: ReactNode[] = [];
  let rest = text;
  let count = 0;
  while (rest.length > 0) {
    let first: { rule: Rule; match: RegExpExecArray } | undefined;
    for (const rule of RULES) {
      const match = rule.pattern.exec(rest);
      if (match && (!first || match.index < first.match.index)) first = { rule, match };
    }
    if (!first) {
      nodes.push(rest);
      break;
    }
    if (first.match.index > 0) nodes.push(rest.slice(0, first.match.index));
    nodes.push(first.rule.render(first.match, options, `${keyPrefix}-${count}`));
    count += 1;
    rest = rest.slice(first.match.index + first.match[0].length);
  }
  return nodes;
}

// --- Blocks ---------------------------------------------------------------------------------------

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)\s*$/;
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE = /^ {0,3}>\s?/;
const ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const TABLE_DIVIDER = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

const cellsOf = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim().replace(/\\\|/g, '|'));

function renderBlocks(lines: string[], options: MarkdownOptions, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let index = 0;
  const key = () => `${keyPrefix}-${nodes.length}`;

  while (index < lines.length) {
    const line = lines[index];
    if (line.trim() === '') {
      index += 1;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !new RegExp(`^ {0,3}${fence[1][0]}{${fence[1].length},}\\s*$`).test(lines[index])) {
        body.push(lines[index]);
        index += 1;
      }
      index += 1;
      nodes.push(
        <pre key={key()}>
          <code>{body.join('\n')}</code>
        </pre>
      );
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      const Tag = `h${heading[1].length}` as 'h1';
      nodes.push(<Tag key={key()}>{renderInline(heading[2], options, key())}</Tag>);
      index += 1;
      continue;
    }

    if (RULE.test(line)) {
      nodes.push(<hr key={key()} />);
      index += 1;
      continue;
    }

    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (index < lines.length && lines[index].trim() !== '' && (QUOTE.test(lines[index]) || body.length > 0)) {
        body.push(lines[index].replace(QUOTE, ''));
        index += 1;
      }
      nodes.push(<blockquote key={key()}>{renderBlocks(body, options, key())}</blockquote>);
      continue;
    }

    const item = ITEM.exec(line);
    if (item) {
      const ordered = /\d/.test(item[2]);
      const indent = item[1].length;
      const items: string[][] = [];
      let loose = false;
      while (index < lines.length) {
        const next = ITEM.exec(lines[index]);
        if (next && next[1].length <= indent + 1 && /\d/.test(next[2]) === ordered) {
          items.push([next[3]]);
          index += 1;
        } else if (lines[index].trim() === '') {
          // A blank line stays in the list only when what follows still belongs to it
          const after = lines[index + 1];
          if (after === undefined || (!/^\s{2,}\S/.test(after) && !(ITEM.exec(after) && (ITEM.exec(after) as RegExpExecArray)[1].length <= indent + 1))) break;
          loose = true;
          items[items.length - 1].push('');
          index += 1;
        } else if (/^\s+\S/.test(lines[index]) && lines[index].search(/\S/) > indent) {
          items[items.length - 1].push(lines[index].slice(Math.min(lines[index].search(/\S/), indent + item[2].length + 1)));
          index += 1;
        } else if (!next && !HEADING.test(lines[index]) && !FENCE.test(lines[index]) && !RULE.test(lines[index]) && !QUOTE.test(lines[index])) {
          items[items.length - 1].push(lines[index].trim());
          index += 1;
        } else break;
      }
      const Tag = ordered ? 'ol' : 'ul';
      const start = ordered ? Number.parseInt(item[2], 10) : undefined;
      nodes.push(
        <Tag key={key()} start={start !== undefined && start !== 1 ? start : undefined}>
          {items.map((body, at) => {
            const simple = !loose && !body.slice(1).some((text) => ITEM.test(text) || FENCE.test(text));
            return (
              <li key={at}>
                {simple ? renderInline(body.join('\n'), options, `${key()}-${at}`) : renderBlocks(body, { ...options }, `${key()}-${at}`)}
              </li>
            );
          })}
        </Tag>
      );
      continue;
    }

    if (line.includes('|') && index + 1 < lines.length && TABLE_DIVIDER.test(lines[index + 1]) && lines[index + 1].includes('-')) {
      const head = cellsOf(line);
      const aligns = cellsOf(lines[index + 1]).map((cell) =>
        cell.startsWith(':') && cell.endsWith(':') ? 'center' : cell.endsWith(':') ? 'right' : cell.startsWith(':') ? 'left' : undefined
      );
      index += 2;
      const body: string[][] = [];
      while (index < lines.length && lines[index].trim() !== '' && lines[index].includes('|')) {
        body.push(cellsOf(lines[index]));
        index += 1;
      }
      nodes.push(
        <table key={key()}>
          <thead>
            <tr>
              {head.map((cell, at) => (
                <th key={at} style={{ textAlign: aligns[at] }}>
                  {renderInline(cell, options, `${key()}-h${at}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((cells, row) => (
              <tr key={row}>
                {head.map((_, at) => (
                  <td key={at} style={{ textAlign: aligns[at] }}>
                    {renderInline(cells[at] ?? '', options, `${key()}-${row}-${at}`)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
      continue;
    }

    // A paragraph runs until a blank line or the start of another kind of block
    const body: string[] = [];
    while (
      index < lines.length &&
      lines[index].trim() !== '' &&
      (body.length === 0 || (!HEADING.test(lines[index]) && !FENCE.test(lines[index]) && !RULE.test(lines[index]) && !QUOTE.test(lines[index]) && !ITEM.test(lines[index])))
    ) {
      // A line of = or - under text makes that text a heading
      if (body.length > 0 && /^ {0,3}(=+|-+)\s*$/.test(lines[index])) {
        const Tag = lines[index].trim().startsWith('=') ? 'h1' : 'h2';
        const text = body.splice(0).join('\n');
        nodes.push(<Tag key={key()}>{renderInline(text, options, key())}</Tag>);
        index += 1;
        break;
      }
      body.push(lines[index].replace(/^ {0,3}/, ''));
      index += 1;
    }
    if (body.length) nodes.push(<p key={key()}>{renderInline(body.join('\n'), options, key())}</p>);
  }
  return nodes;
}

export function renderMarkdown(text: string, options: MarkdownOptions = {}): ReactNode[] {
  return renderBlocks(text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n'), options, 'md');
}

export function Markdown({ text, openLinksInNewTab, className }: { text: string; openLinksInNewTab?: boolean; className?: string }) {
  return <div className={`atlMarkdown${className ? ` ${className}` : ''}`}>{renderMarkdown(text, { openLinksInNewTab })}</div>;
}

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

// --- Character references -------------------------------------------------------------------------

// The named references a text may hold, as markdown-it reads them: HTML 4's, and HTML's names for
// the ASCII punctuation; Latin-1 from U+00A0 and the Greek letters run in code point order
const LATIN1 =
  'nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para middot cedil sup1 ' +
  'ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ' +
  'ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring ' +
  'aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc ' +
  'uuml yacute thorn yuml';
const GREEK: Array<[number, string]> = [
  [913, 'Alpha Beta Gamma Delta Epsilon Zeta Eta Theta Iota Kappa Lambda Mu Nu Xi Omicron Pi Rho'],
  [931, 'Sigma Tau Upsilon Phi Chi Psi Omega'],
  [945, 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigmaf sigma tau upsilon phi chi psi omega'],
];
const OTHERS =
  'Tab:9 NewLine:10 excl:33 quot:34 num:35 dollar:36 percnt:37 amp:38 apos:39 lpar:40 rpar:41 ast:42 plus:43 comma:44 period:46 sol:47 ' +
  'colon:58 semi:59 lt:60 equals:61 gt:62 quest:63 commat:64 lsqb:91 lbrack:91 bsol:92 rsqb:93 rbrack:93 Hat:94 lowbar:95 grave:96 ' +
  'lcub:123 lbrace:123 verbar:124 vert:124 rcub:125 rbrace:125 OElig:338 oelig:339 Scaron:352 scaron:353 Yuml:376 fnof:402 circ:710 ' +
  'tilde:732 thetasym:977 upsih:978 piv:982 ensp:8194 emsp:8195 thinsp:8201 zwnj:8204 zwj:8205 lrm:8206 rlm:8207 hyphen:8208 ndash:8211 ' +
  'mdash:8212 lsquo:8216 rsquo:8217 sbquo:8218 ldquo:8220 rdquo:8221 bdquo:8222 dagger:8224 Dagger:8225 bull:8226 hellip:8230 permil:8240 ' +
  'prime:8242 Prime:8243 lsaquo:8249 rsaquo:8250 oline:8254 frasl:8260 euro:8364 image:8465 weierp:8472 real:8476 trade:8482 alefsym:8501 ' +
  'larr:8592 uarr:8593 rarr:8594 darr:8595 harr:8596 crarr:8629 lArr:8656 uArr:8657 rArr:8658 dArr:8659 hArr:8660 forall:8704 part:8706 ' +
  'exist:8707 empty:8709 nabla:8711 isin:8712 notin:8713 ni:8715 prod:8719 sum:8721 minus:8722 lowast:8727 radic:8730 prop:8733 infin:8734 ' +
  'ang:8736 and:8743 or:8744 cap:8745 cup:8746 int:8747 there4:8756 sim:8764 cong:8773 asymp:8776 ne:8800 equiv:8801 le:8804 ge:8805 ' +
  'sub:8834 sup:8835 nsub:8836 sube:8838 supe:8839 oplus:8853 otimes:8855 perp:8869 sdot:8901 lceil:8968 rceil:8969 lfloor:8970 rfloor:8971 ' +
  'loz:9674 starf:9733 star:9734 spades:9824 clubs:9827 hearts:9829 diams:9830 check:10003 cross:10007 lang:10216 rang:10217';

const NAMED = new Map<string, number>([
  ...LATIN1.split(' ').map((name, at): [string, number] => [name, 160 + at]),
  ...GREEK.flatMap(([first, names]) => names.split(' ').map((name, at): [string, number] => [name, first + at])),
  ...OTHERS.split(' ').map((pair): [string, number] => {
    const [name, code] = pair.split(':');
    return [name, Number(code)];
  }),
]);

// A code point no text may hold is read as the replacement character
const validCodePoint = (code: number) =>
  !(
    (code >= 0xd800 && code <= 0xdfff) ||
    (code >= 0xfdd0 && code <= 0xfdef) ||
    (code & 0xffff) === 0xffff ||
    (code & 0xffff) === 0xfffe ||
    code <= 0x08 ||
    code === 0x0b ||
    (code >= 0x0e && code <= 0x1f) ||
    (code >= 0x7f && code <= 0x9f) ||
    code > 0x10ffff
  );

/** The characters a text's references (`&amp;`, `&#x27;`, `&copy;`) stand for; any other `&` stays */
export function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(/&(?:#(x[a-f0-9]{1,6}|[0-9]{1,7})|([a-z][a-z0-9]{1,31}));/gi, (reference: string, digits?: string, name?: string) => {
    if (digits) {
      const code = digits[0].toLowerCase() === 'x' ? parseInt(digits.slice(1), 16) : parseInt(digits, 10);
      return String.fromCodePoint(validCodePoint(code) ? code : 0xfffd);
    }
    const code = name ? NAMED.get(name) : undefined;
    return code === undefined ? reference : String.fromCodePoint(code);
  });
}

// --- Inline ---------------------------------------------------------------------------------------

interface Rule {
  pattern: RegExp;
  render: (match: RegExpExecArray, options: MarkdownOptions, key: string) => ReactNode;
}

const link = (href: string, children: ReactNode, title: string | undefined, options: MarkdownOptions, key: string) => {
  const safe = safeLink(decodeEntities(href));
  if (!safe) return <Fragment key={key}>{children}</Fragment>;
  return (
    <a key={key} href={safe} title={title === undefined ? undefined : decodeEntities(title)} {...(options.openLinksInNewTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
      {children}
    </a>
  );
};

const RULES: Rule[] = [
  // Any ASCII punctuation, as CommonMark
  { pattern: /\\([!-/:-@[-`{-~])/, render: (match) => match[1] },
  { pattern: /(`+)([\s\S]+?)\1(?!`)/, render: (match, _options, key) => <code key={key}>{match[2].trim()}</code> },
  {
    pattern: /!\[([^\]]*)\]\(\s*<?([^\s)>]+)>?(?:\s+["']([^"']*)["'])?\s*\)/,
    render: (match, _options, key) => {
      const [src, alt, title] = [match[2], match[1], match[3]].map((text) => (text === undefined ? undefined : decodeEntities(text)));
      return src !== undefined && SAFE_IMAGE.test(src) ? <img key={key} src={src} alt={alt} title={title} /> : <Fragment key={key}>{alt}</Fragment>;
    },
  },
  {
    pattern: /\[((?:[^[\]]|\[[^\]]*\])*)\]\(\s*<?([^\s)>]*)>?(?:\s+["']([^"']*)["'])?\s*\)/,
    render: (match, options, key) => link(match[2], renderInline(match[1], options, key), match[3], options, key),
  },
  {
    pattern: /<((?:https?|mailto):[^\s>]+)>/,
    render: (match, options, key) => link(match[1], decodeEntities(match[1].replace(/^mailto:/, '')), undefined, options, key),
  },
  { pattern: /\*\*([\s\S]+?)\*\*(?!\*)/, render: (match, options, key) => <strong key={key}>{renderInline(match[1], options, key)}</strong> },
  { pattern: /(?<![A-Za-z0-9])__([\s\S]+?)__(?![A-Za-z0-9])/, render: (match, options, key) => <strong key={key}>{renderInline(match[1], options, key)}</strong> },
  { pattern: /~~([\s\S]+?)~~/, render: (match, options, key) => <s key={key}>{renderInline(match[1], options, key)}</s> },
  { pattern: /\*(?!\s)([^*]+?)(?<!\s)\*/, render: (match, options, key) => <em key={key}>{renderInline(match[1], options, key)}</em> },
  { pattern: /(?<![A-Za-z0-9])_(?!\s)([^_]+?)(?<!\s)_(?![A-Za-z0-9])/, render: (match, options, key) => <em key={key}>{renderInline(match[1], options, key)}</em> },
  { pattern: /(?: {2,}|\\)\n/, render: (_match, _options, key) => <br key={key} /> },
  {
    pattern: /\bhttps?:\/\/[^\s<>()]+(?:\([^\s<>()]*\))?[^\s<>().,;:!?'"]/,
    render: (match, options, key) => link(match[0], decodeEntities(match[0]), undefined, options, key),
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
      nodes.push(decodeEntities(rest));
      break;
    }
    if (first.match.index > 0) nodes.push(decodeEntities(rest.slice(0, first.match.index)));
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

/**
 * How deep quotes and lists may nest, as in the original's parser: a quote is one step, a list is
 * two, and what lies a hundred steps deep is left out. Without an end, a stored text of a few
 * thousand ">" ends the page that draws it with "Maximum call stack size exceeded".
 */
const MAX_NESTING = 100;

function renderBlocks(lines: string[], options: MarkdownOptions, keyPrefix: string, depth = 0): ReactNode[] {
  const nodes: ReactNode[] = [];
  if (depth >= MAX_NESTING) return nodes;
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
      nodes.push(<blockquote key={key()}>{renderBlocks(body, options, key(), depth + 1)}</blockquote>);
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
          // A blank line stays in the list only when what follows still belongs to it: an item of
          // the other kind (a numbered one after bullets) starts a list of its own
          const after = lines[index + 1];
          const following = after === undefined ? null : ITEM.exec(after);
          const sameList = following !== null && following[1].length <= indent + 1 && /\d/.test(following[2]) === ordered;
          if (after === undefined || (!/^\s{2,}\S/.test(after) && !sameList)) break;
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
                {simple && depth + 2 < MAX_NESTING
                  ? renderInline(body.join('\n').trim(), options, `${key()}-${at}`)
                  : renderBlocks(body, { ...options }, `${key()}-${at}`, depth + 2)}
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
    // As CommonMark, without the spaces it starts or ends with
    if (body.length) nodes.push(<p key={key()}>{renderInline(body.join('\n').trim(), options, key())}</p>);
  }
  return nodes;
}

export function renderMarkdown(text: string, options: MarkdownOptions = {}): ReactNode[] {
  return renderBlocks(text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n'), options, 'md');
}

export function Markdown({ text, openLinksInNewTab, className }: { text: string; openLinksInNewTab?: boolean; className?: string }) {
  return <div className={`atlMarkdown${className ? ` ${className}` : ''}`}>{renderMarkdown(text, { openLinksInNewTab })}</div>;
}

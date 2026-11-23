/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The text of a markdown panel and its custom style. The text is written beside the variables it
 * can use, which the product lists from the data last drawn; a click on one puts it in the text
 * where the cursor is. The style is written in Less and saved twice, as written and as CSS.
 */

import { useRef, type ReactNode } from 'react';
import { CodeEditor, type CodeEditorHandle, type CodeToken } from '../../../components/code_editor';
import { formatNumber } from '../../../lib/numeral';
import { services } from '../../../services';
import type { TsvbData, TsvbParams } from '../../../vis/tsvb/data';
import { convertSeriesToVars } from '../../../vis/tsvb/markdown_vars';
import { Spacer } from './controls';
import { compileLess } from './less';
import type { OnChange, Panel } from './model';
import type { PanelData } from './series';

// --- Colouring ---------------------------------------------------------------------------------------

/** A line split into runs that match a pattern, each run of the kind its group names */
function runs(line: string, pattern: RegExp, kindOf: (match: RegExpExecArray) => string | undefined): CodeToken[] {
  const tokens: CodeToken[] = [];
  let at = 0;
  pattern.lastIndex = 0;
  for (let match = pattern.exec(line); match; match = pattern.exec(line)) {
    if (match[0] === '') {
      pattern.lastIndex++;
      continue;
    }
    if (match.index > at) tokens.push({ text: line.slice(at, match.index) });
    tokens.push({ text: match[0], kind: kindOf(match) });
    at = match.index + match[0].length;
  }
  if (at < line.length) tokens.push({ text: line.slice(at) });
  return tokens;
}

const MARKDOWN_INLINE = /(\{\{[^}]*\}\})|(`[^`]*`)|(\*\*[^*]+\*\*|__[^_]+__)|(\[[^\]]*\]\([^)]*\))/g;

/** Markdown in colour: headings, quotes and list marks, code, strong text, links and variables */
export function tokenizeMarkdown(text: string): CodeToken[][] {
  return text.split('\n').map((line) => {
    if (/^\s{0,3}#{1,6}(\s|$)/.test(line)) return [{ text: line, kind: 'Keyword' }];
    if (/^\s{0,3}>/.test(line)) return [{ text: line, kind: 'Comment' }];
    const list = /^(\s*)([-*+]|\d+\.)(\s)/.exec(line);
    const head: CodeToken[] = list ? [{ text: list[1] }, { text: list[2], kind: 'Number' }, { text: list[3] }] : [];
    const rest = list ? line.slice(list[0].length) : line;
    return [...head, ...runs(rest, MARKDOWN_INLINE, (match) => (match[1] ? 'Key' : match[2] ? 'String' : match[3] ? 'Keyword' : 'Number'))];
  });
}

const LESS_TOKENS = /(\/\*.*?\*\/|\/\/.*$)|("[^"]*"|'[^']*')|(@[\w-]+)|([\w-]+)(?=\s*:(?!hover|focus|active|visited|first|last|nth|not|before|after))|(-?\d*\.?\d+(?:[a-z%]+)?)/g;

/** Less in colour: comments, strings, variables, property names and numbers */
export function tokenizeLess(text: string): CodeToken[][] {
  let inComment = false;
  return text.split('\n').map((line) => {
    if (inComment) {
      const end = line.indexOf('*/');
      if (end < 0) return [{ text: line, kind: 'Comment' }];
      inComment = false;
      return [{ text: line.slice(0, end + 2), kind: 'Comment' }, ...tokenizeLess(line.slice(end + 2))[0]];
    }
    const open = line.lastIndexOf('/*');
    if (open >= 0 && line.indexOf('*/', open) < 0) {
      inComment = true;
      return [...tokenizeLess(line.slice(0, open))[0], { text: line.slice(open), kind: 'Comment' }];
    }
    return runs(line, LESS_TOKENS, (match) =>
      match[1] ? 'Comment' : match[2] ? 'String' : match[3] ? 'Keyword' : match[4] ? 'Key' : 'Number'
    );
  });
}

// --- The markdown -----------------------------------------------------------------------------------

const rawFormatter = (value: unknown) => (typeof value === 'number' ? formatNumber(value, '0.[0000]') : value === null || value === undefined ? '' : String(value));

interface VariableRow {
  key: string;
  snippet: string;
  shown: string;
  value: ReactNode;
}

/** The rows of the variables table: a value each, and a list of values each, by their path */
function variableRows(variables: Record<string, unknown>): VariableRow[] {
  const rows: VariableRow[] = [];
  const read = (path: string[]) => path.reduce<unknown>((at, key) => (at && typeof at === 'object' ? (at as Record<string, unknown>)[key] : undefined), variables);
  const walk = (tree: Record<string, unknown>, path: string[]) => {
    for (const name of Object.keys(tree)) {
      const value = tree[name];
      const at = [...path, name];
      const key = at.join('.');
      if (Array.isArray(value)) {
        const first = read([...at, '0']) as unknown[] | undefined;
        const date = first?.[0];
        let shownValue: unknown = first?.[1];
        if (/raw$/.test(key)) shownValue = rawFormatter(shownValue);
        rows.push({
          key,
          snippet: `{{# ${key} }}{{/ ${key} }}`,
          shown: `{{ ${key} }}`,
          value: (
            <code>
              [ [ &ldquo;{String(date ?? '')}&rdquo;, &ldquo;{String(shownValue ?? '')}&rdquo; ], ... ]
            </code>
          ),
        });
      } else if (value && typeof value === 'object') walk(value as Record<string, unknown>, at);
      else {
        const shownValue = /raw$/.test(key) ? rawFormatter(value) : value;
        rows.push({ key, snippet: `{{ ${key} }}`, shown: `{{ ${key} }}`, value: <code>&ldquo;{String(shownValue ?? '')}&rdquo;</code> });
      }
    }
  };
  walk(variables, []);
  return rows;
}

const EXAMPLE = `# All servers:

    {{#each _all}}
    - {{ label }} {{ last.formatted }}
    {{/each}}`;

export function MarkdownEditor({ model, visData, onChange }: { model: Panel; visData?: PanelData; onChange: OnChange }) {
  const editor = useRef<CodeEditorHandle>(null);
  // Until the text is clicked into, a variable goes in at its end, where the product's editor puts
  // the cursor when it opens
  const touched = useRef(false);
  if (!visData) return null;
  const series = 'series' in visData ? (visData as TsvbData).series : [];
  const dateFormat = services.uiSettings.get<string>('dateFormat', 'MMM D, YYYY @ HH:mm:ss.SSS');
  const variables = convertSeriesToVars(series, model as unknown as TsvbParams, dateFormat, services.timeZone());
  const rows = variableRows(variables);
  const text = typeof model.markdown === 'string' ? model.markdown : '';
  const insert = (snippet: string) => {
    const [start, end] = touched.current && editor.current ? editor.current.selection() : [text.length, text.length];
    onChange({ markdown: text.slice(0, start) + snippet + text.slice(end) });
    const caret = start + snippet.length;
    requestAnimationFrame(() => editor.current?.select(caret));
  };
  return (
    <div className="tvbMarkdownEditor">
      <div
        className="tvbMarkdownEditor__editor"
        onFocus={() => {
          touched.current = true;
        }}
      >
        <CodeEditor
          handle={editor}
          value={text}
          onChange={(markdown) => onChange({ markdown })}
          height="100%"
          wrap
          fontSize={14}
          tokenize={tokenizeMarkdown}
          ariaLabel="Markdown"
          className="tvbMarkdownEditor__code"
        />
      </div>
      <div className="tvbMarkdownEditor__variables">
        <p className="tvbText">
          The following variables can be used in the Markdown by using the Handlebar (mustache) syntax.{' '}
          <a href="https://handlebarsjs.com/guide/expressions.html" target="_blank" rel="noreferrer noopener">
            Click here for documentation
          </a>{' '}
          on the available expressions.
        </p>
        <table className="tvbMarkdownEditor__table" data-test-subj="tsvbMarkdownVariablesTable">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Value</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td>
                  <button type="button" className="atlLinkButton tvbMarkdownEditor__variable" onClick={() => insert(row.snippet)}>
                    {row.shown}
                  </button>
                </td>
                <td>{row.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <h6 className="tvbTitle--xxs tvbMarkdownEditor__noVariables" data-test-subj="tvbMarkdownEditor__noVariables">
            No variables available for the selected data metrics.
          </h6>
        )}
        <Spacer />
        <p className="tvbText">
          There is also a special variable named <code>_all</code> which you can use to access the entire tree. This is useful for creating lists
          with data from a group by:
        </p>
        <Spacer />
        <pre className="atlCode tvbMarkdownEditor__example">{EXAMPLE}</pre>
      </div>
    </div>
  );
}

/** The custom style of a markdown panel: saved as written, and as the CSS it compiles to when it does */
export function MarkdownCssEditor({ model, onChange }: { model: Panel; onChange: OnChange }) {
  const change = (less: string) => {
    const css = compileLess(`\n  ${less}\n`, `#markdown-${String(model.id)}`);
    onChange(css === undefined ? { markdown_less: less } : { markdown_less: less, markdown_css: css });
  };
  return (
    <CodeEditor
      value={typeof model.markdown_less === 'string' ? model.markdown_less : ''}
      onChange={change}
      height={500}
      fontSize={14}
      tokenize={tokenizeLess}
      ariaLabel="Custom CSS (supports Less)"
      className="tvbMarkdownEditor__css"
    />
  );
}

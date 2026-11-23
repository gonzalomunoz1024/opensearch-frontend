/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The text of a markdown panel and its custom style. The text is written beside the variables it
 * can use, which the product lists from the data last drawn; a click on one puts it in the text
 * where the cursor is. The style is written in Less and saved twice, as written and as CSS.
 */

import { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { CodeEditor, type CodeEditorHandle } from '../../../components/code_editor';
import { formatNumber } from '../../../lib/numeral';
import { services } from '../../../services';
import type { TsvbData, TsvbParams } from '../../../vis/tsvb/data';
import { convertSeriesToVars } from '../../../vis/tsvb/markdown_vars';
import { tokenizeAceLess } from './ace_less';
import { tokenizeAceMarkdown } from './ace_markdown';
import { Spacer } from './controls';
import { compileLess } from './less';
import type { OnChange, Panel } from './model';
import type { PanelData } from './series';

// --- The editors' look -------------------------------------------------------------------------------

/** The figures of a text's last line number, which set the width of the gutter as ACE sets it */
const gutterFigures = (text: string): CSSProperties => ({ '--tvb-code-digits': String(text.split('\n').length).length }) as CSSProperties;

/**
 * The line of the cursor, which ACE draws on a band: the last line until the cursor moves, as the
 * original's editor puts the cursor at the end of the text it opens with
 */
function useCursorLine(text: string): [[number, number], (start: number, end: number) => void] {
  const [line, setLine] = useState<number | undefined>(undefined);
  const lines = text.split('\n').length;
  const shown = Math.min(line ?? lines - 1, lines - 1);
  return [[shown, shown], (_start, end) => setLine(text.slice(0, end).split('\n').length - 1)];
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
  const text = typeof model.markdown === 'string' ? model.markdown : '';
  const [cursorLine, onCursor] = useCursorLine(text);
  if (!visData) return null;
  const series = 'series' in visData ? (visData as TsvbData).series : [];
  const dateFormat = services.uiSettings.get<string>('dateFormat', 'MMM D, YYYY @ HH:mm:ss.SSS');
  const variables = convertSeriesToVars(series, model as unknown as TsvbParams, dateFormat, services.timeZone());
  const rows = variableRows(variables);
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
        style={gutterFigures(text)}
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
          tokenize={tokenizeAceMarkdown}
          markedLines={cursorLine}
          onCursor={onCursor}
          ariaLabel="Markdown"
          className="tvbMarkdownEditor__code tvbAce"
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
        {/* A plain title, as the original's: its style sheet styles a class the title does not have */}
        {rows.length === 0 && (
          <p className="tvbTitle--xxs" data-test-subj="tvbMarkdownEditor__noVariables">
            No variables available for the selected data metrics.
          </p>
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
  const less = typeof model.markdown_less === 'string' ? model.markdown_less : '';
  const [cursorLine, onCursor] = useCursorLine(less);
  const change = (written: string) => {
    const css = compileLess(`\n  ${written}\n`, `#markdown-${String(model.id)}`);
    onChange(css === undefined ? { markdown_less: written } : { markdown_less: written, markdown_css: css });
  };
  return (
    <div style={gutterFigures(less)}>
      <CodeEditor
        value={less}
        onChange={change}
        height={500}
        fontSize={14}
        tokenize={tokenizeAceLess}
        markedLines={cursorLine}
        onCursor={onCursor}
        ariaLabel="Custom CSS (supports Less)"
        className="tvbMarkdownEditor__css tvbAce"
      />
    </div>
  );
}

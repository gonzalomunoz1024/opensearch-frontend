/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The spec of a Vega visualization in the editor's sidebar: HJSON in colour as the original's
 * editor shows it, the help menu with the documentation, and the menu that writes the spec again
 * as HJSON or as JSON without comments.
 */

import { IconButton } from '../../components/basic';
import { CodeEditor } from '../../components/code_editor';
import { MenuButton } from '../../components/overlay';
import { compactJson } from '../../lib/compact_json';
import { parseHjson, stringifyHjson } from '../../lib/hjson';
import { tokenizeHjson } from '../../lib/hjson_tokens';
import { services } from '../../services';
import type { OptionsProps } from './options';
import '../../styles/vega.css';

/** The spec written again, or as it was with a toast saying why when it cannot be read */
export function formatSpec(value: string, stringify: (spec: unknown) => string | undefined): string {
  try {
    const spec = parseHjson(value, { legacyRoot: false, keepWsc: true });
    // what HJSON reads always writes again
    return stringify(spec) ?? value;
  } catch (error) {
    // the common case: the text is not valid HJSON yet
    services.toasts.error(error, 'Error formatting spec');
    return value;
  }
}

export const asHjson = (spec: unknown) => stringifyHjson(spec, { bracesSameLine: true, keepWsc: true });
export const asJson = (spec: unknown) => compactJson(spec);

export function VegaSpecEditor({ params, setParams }: OptionsProps) {
  const spec = typeof params.spec === 'string' ? params.spec : '';
  const setSpec = (next: string) => setParams({ ...params, spec: next });
  return (
    <div className="vgaEditor">
      <CodeEditor
        className="vgaEditor__code"
        value={spec}
        onChange={setSpec}
        tokenize={tokenizeHjson}
        wrap
        height="auto"
        ariaLabel="Vega spec"
        testId="vega-editor"
      />
      <div className="vgaEditor__aceEditorActions">
        <MenuButton
          button={(toggle) => <IconButton icon="help" label="Vega help" onClick={toggle} className="vgaEditor__action" />}
          items={[
            { label: 'OpenSearch Dashboards Vega help', href: 'https://opensearch.org/docs/latest/dashboards/' },
            { label: 'Vega-Lite documentation', href: 'https://vega.github.io/vega-lite/docs/' },
            { label: 'Vega documentation', href: 'https://vega.github.io/vega/docs/' },
          ]}
        />
        <MenuButton
          button={(toggle) => <IconButton icon="wrench" label="Vega editor options" onClick={toggle} className="vgaEditor__action" />}
          items={[
            { label: 'Reformat as HJSON', onClick: () => setSpec(formatSpec(spec, asHjson)) },
            { label: 'Reformat as JSON, delete comments', onClick: () => setSpec(formatSpec(spec, asJson)) },
          ]}
        />
      </div>
    </div>
  );
}

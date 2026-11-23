/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The spec of a Vega visualization in the editor's sidebar: HJSON in colour as the original's
 * editor shows it, the help menu with the documentation, and the menu that writes the spec again
 * as HJSON or as JSON without comments.
 */

import { useCallback, useState, type KeyboardEvent } from 'react';
import { IconButton } from '../../components/basic';
import { CodeEditor } from '../../components/code_editor';
import type { IconName } from '../../components/icon';
import { Popover } from '../../components/overlay';
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

/** Where the original's "OpenSearch Dashboards Vega help" goes (its documentation links' `visualize.vega`) */
const VEGA_HELP_URL = 'https://opensearch.org/docs/latest/dashboards/';

interface VegaMenuItem {
  label: string;
  /** A page of documentation, opened in a new tab */
  href?: string;
  onClick?: () => void;
}

/**
 * One of the original's two menus over the spec: its icon button, and under it a popover with the
 * small context menu of its items, links or actions, which closes once one is chosen. The first item
 * has the focus when it opens, and the arrows go down and up the items, round from the last to the
 * first. As the original's, the items are plain links and buttons in the popover's dialog, without a
 * menu's roles. (The kit's context menu opens no page in a new tab, which the help's links do.)
 */
function VegaMenu({ icon, label, items }: { icon: IconName; label: string; items: VegaMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const elements = [...event.currentTarget.querySelectorAll<HTMLElement>('.atlContextMenu__item')];
    if (elements.length === 0) return;
    event.preventDefault();
    const index = elements.findIndex((element) => element === document.activeElement);
    const step = event.key === 'ArrowDown' ? 1 : -1;
    const next = index < 0 ? (step > 0 ? 0 : elements.length - 1) : (index + step + elements.length) % elements.length;
    elements[next]?.focus();
  };
  return (
    <Popover
      open={open}
      onClose={close}
      position="downLeft"
      button={<IconButton icon={icon} label={label} onClick={() => setOpen(!open)} className="vgaEditor__action" />}
    >
      <div className="atlContextMenu atlContextMenu--small" onKeyDown={onKeyDown}>
        {items.map((item) =>
          item.href !== undefined ? (
            <a key={item.label} className="atlContextMenu__item" href={item.href} target="_blank" rel="noopener noreferrer" onClick={close}>
              <span className="atlContextMenu__text">{item.label}</span>
            </a>
          ) : (
            <button
              key={item.label}
              type="button"
              className="atlContextMenu__item"
              onClick={() => {
                item.onClick?.();
                close();
              }}
            >
              <span className="atlContextMenu__text">{item.label}</span>
            </button>
          )
        )}
      </div>
    </Popover>
  );
}

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
        <VegaMenu
          icon="help"
          label="Vega help"
          items={[
            { label: 'OpenSearch Dashboards Vega help', href: VEGA_HELP_URL },
            { label: 'Vega-Lite documentation', href: 'https://vega.github.io/vega-lite/docs/' },
            { label: 'Vega documentation', href: 'https://vega.github.io/vega/docs/' },
          ]}
        />
        <VegaMenu
          icon="wrench"
          label="Vega editor options"
          items={[
            { label: 'Reformat as HJSON', onClick: () => setSpec(formatSpec(spec, asHjson)) },
            { label: 'Reformat as JSON, delete comments', onClick: () => setSpec(formatSpec(spec, asJson)) },
          ]}
        />
      </div>
    </div>
  );
}

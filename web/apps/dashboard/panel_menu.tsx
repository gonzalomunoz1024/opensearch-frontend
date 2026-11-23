/* SPDX-License-Identifier: Apache-2.0 */

/* The options of a dashboard's panel: the button in its corner and the menu it opens. */

import { useCallback, useState } from 'react';
import { IconButton } from '../../components/basic';
import { ContextMenu, Popover, type ContextMenuItem, type ContextMenuPanel } from '../../components/overlay';
import { VIS_BUILDER_TYPE } from '../vis_builder/model';

export type PanelAction = 'expand' | 'inspect' | 'remove' | 'replace' | 'rename' | 'clone';

/** What the original's "Edit …" says for each kind of panel: its factory's name */
export const EDIT_NAMES: Record<string, string> = {
  visualization: 'visualization',
  search: 'search',
  [VIS_BUILDER_TYPE]: 'vis-builder',
};

/**
 * The original's panel menu: titled "Options", its actions in their order, and when there are
 * more than four, the first three and the rest under "More".
 */
export function PanelMenu({ editing, items }: { editing: boolean; items: ContextMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const panels: ContextMenuPanel[] =
    items.length > 4
      ? [
          {
            id: 'mainMenu',
            title: 'Options',
            items: [
              ...items.slice(0, 3),
              { id: 'more', label: 'More', icon: 'dots', panel: 'more', testId: 'embeddablePanelMore-mainMenu' },
            ],
          },
          { id: 'more', title: 'Options', items: items.slice(3) },
        ]
      : [{ id: 'mainMenu', title: 'Options', items }];
  return (
    <Popover
      open={open}
      onClose={close}
      position="downRight"
      width={256}
      anchorClassName="dshPanel__menuAnchor"
      button={
        <IconButton
          icon={editing ? 'gear' : 'dots'}
          size="s"
          label="Panel options"
          className="dshPanel__menu"
          onClick={() => setOpen(!open)}
          testId="embeddablePanelToggleMenuIcon"
        />
      }
    >
      <ContextMenu panels={panels} onDone={close} small />
    </Popover>
  );
}

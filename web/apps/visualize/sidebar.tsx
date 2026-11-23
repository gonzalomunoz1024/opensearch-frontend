/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The parts of the editor's sidebar around its settings, as OpenSearch Dashboards' default
 * editor draws them: at the top what the visualization is drawn from, at the bottom the buttons
 * that apply or discard the changes.
 */

import { useState } from 'react';
import { Button, IconButton } from '../../components/basic';
import { Icon } from '../../components/icon';
import { Popover } from '../../components/overlay';
import { navigate } from '../../router';
import type { IndexPattern } from '../../lib/types';
import { patternName } from '../../services/index_patterns';
import { sidebarTitle } from './editor_layout';

const LINK_LABEL = 'Link to saved search. Click to learn more or break link.';

/** The saved search a visualization is drawn from, with the menu that breaks the link */
function LinkedSearch({ searchId, searchTitle, onUnlink }: { searchId: string; searchTitle: string; onUnlink: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="vzeSide__title vzeSide__title--linked">
      <Icon name="search" />
      <h2 className="vzeSide__heading atlTruncate" title={`Saved search: ${searchTitle}`}>
        {searchTitle}
      </h2>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        align="right"
        className="vzeLinked"
        button={
          <IconButton
            icon="link"
            label={LINK_LABEL}
            variant="empty"
            className="vzeLinked__button"
            onClick={() => setOpen(!open)}
            testId="showUnlinkSavedSearchPopover"
          />
        }
      >
        <div className="vzeLinked__title">Linked to saved search</div>
        <div className="vzeLinked__body">
          <p>
            <button
              type="button"
              className="vzeLinked__view"
              onClick={() => navigate(`/app/data-explorer/discover#/view/${encodeURIComponent(searchId)}`)}
              data-test-subj="viewSavedSearch"
            >
              View this search in Discover
            </button>
          </p>
          <p>
            Subsequent modifications to this saved search are reflected in the visualization. To disable automatic updates,
            remove the link.
          </p>
          <p>
            <Button
              variant="danger"
              full
              onClick={() => {
                setOpen(false);
                onUnlink();
              }}
              testId="unlinkSavedSearch"
            >
              Remove link to saved search
            </Button>
          </p>
        </div>
      </Popover>
    </div>
  );
}

/** The top of the sidebar: the saved search, the index pattern, an empty band, or nothing */
export function SidebarTitle({
  type,
  indexPattern,
  searchId,
  searchTitle,
  onUnlink,
}: {
  type: string;
  indexPattern?: IndexPattern;
  searchId?: string;
  searchTitle?: string;
  onUnlink: () => void;
}) {
  const kind = sidebarTitle(type, Boolean(searchId));
  if (kind === 'linked' && searchId) return <LinkedSearch searchId={searchId} searchTitle={searchTitle ?? ''} onUnlink={onUnlink} />;
  if (kind === 'indexPattern' && indexPattern) {
    const name = patternName(indexPattern);
    return (
      <h2 className="vzeSide__title vzeSide__heading atlTruncate" title={`Index pattern: ${name}`}>
        {name}
      </h2>
    );
  }
  if (kind === 'placeholder') return <div className="vzeSide__title vzeSide__title--placeholder" />;
  return null;
}

/**
 * Discard and Update, and for a kind that can apply its changes as they are made, the button that
 * turns that on; while it is on, it is the only one.
 */
export function SidebarControls({
  dirty,
  invalid,
  canAutoApply,
  autoApply,
  onAutoApply,
  onDiscard,
  onUpdate,
}: {
  dirty: boolean;
  /** The changes were applied with a field in error: Update waits until it is corrected */
  invalid: boolean;
  canAutoApply: boolean;
  autoApply: boolean;
  onAutoApply: (on: boolean) => void;
  onDiscard: () => void;
  onUpdate: () => void;
}) {
  return (
    <div className="vzeSide__controls">
      {!autoApply && (
        <div className="vzeSide__buttons">
          <Button variant="empty" icon="cross" disabled={!dirty} onClick={onDiscard} testId="visualizeEditorResetButton">
            Discard
          </Button>
          {invalid ? (
            <span className="vzeSide__invalid" title="Errors in the highlighted fields need to be resolved.">
              <Button className="vzeSide__update" icon="warning" disabled>
                Update
              </Button>
            </span>
          ) : (
            <Button
              variant="primary"
              className="vzeSide__update"
              icon="refresh"
              disabled={!dirty}
              onClick={onUpdate}
              testId="visualizeEditorRenderButton"
            >
              Update
            </Button>
          )}
        </div>
      )}
      {canAutoApply && (
        <Button
          className="vzeSide__autoApply"
          variant={autoApply ? 'primary' : 'default'}
          icon="refresh"
          aria-label="Auto apply editor changes"
          aria-pressed={autoApply}
          title={`${autoApply ? 'Auto apply is on' : 'Auto apply is off'}\nAuto updates the visualization on every change.`}
          onClick={() => onAutoApply(!autoApply)}
          testId="visualizeEditorAutoButton"
        />
      )}
    </div>
  );
}

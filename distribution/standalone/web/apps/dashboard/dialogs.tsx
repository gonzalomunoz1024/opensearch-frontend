/* SPDX-License-Identifier: Apache-2.0 */

/*
 * What a dashboard opens over itself, with the original's words: its options, the dialogs that
 * clone it and customize a panel, the empty dashboard's prompt and the way out of full screen.
 */

import { useState } from 'react';
import { Button, CallOut } from '../../components/basic';
import { FormRow, Switch, TextArea, TextField } from '../../components/form';
import { Icon } from '../../components/icon';
import { Modal } from '../../components/overlay';
import { href } from '../../router';
import { services } from '../../services';
import { SaveModal } from '../../shell/saved_objects_ui';
import type { DashboardOptions } from './model';

/** The options popover of the top menu: three switches, applied as they are flipped */
export function OptionsMenu({ options, onChange }: { options: DashboardOptions; onChange: (options: DashboardOptions) => void }) {
  return (
    <form className="dshOptions" data-test-subj="dashboardOptionsMenu" onSubmit={(event) => event.preventDefault()}>
      <Switch
        compressed
        checked={options.useMargins === true}
        onChange={(useMargins) => onChange({ ...options, useMargins })}
        label="Use margins between panels"
        testId="dashboardMarginsCheckbox"
      />
      <Switch
        compressed
        checked={!options.hidePanelTitles}
        onChange={(show) => onChange({ ...options, hidePanelTitles: !show })}
        label="Show panel titles"
        testId="dashboardPanelTitlesCheckbox"
      />
      <Switch
        compressed
        checked={options.useSharedCrosshair === true}
        onChange={(useSharedCrosshair) => onChange({ ...options, useSharedCrosshair })}
        label="Sync crosshair across panels"
        testId="dashboardSharedCrosshairCheckbox"
      />
    </form>
  );
}

export interface DashboardSaveResult {
  title: string;
  description: string;
  /** Saved as a new dashboard, the one on screen left as it was */
  asNew: boolean;
  timeRestore: boolean;
}

/** "Save dashboard": the saved objects' dialog with the dashboard's description and time */
export function DashboardSaveModal({
  title,
  description: initialDescription,
  timeRestore,
  existing,
  onSave,
  onClose,
}: {
  title: string;
  description: string;
  timeRestore: boolean;
  existing: boolean;
  onSave: (result: DashboardSaveResult) => Promise<void>;
  onClose: () => void;
}) {
  const [description, setDescription] = useState(initialDescription);
  const [storeTime, setStoreTime] = useState(timeRestore);
  return (
    <SaveModal
      objectType="dashboard"
      title={title}
      existing={existing}
      onSave={(result) => onSave({ title: result.title, asNew: result.asNew, description, timeRestore: storeTime })}
      onClose={onClose}
    >
      <FormRow label="Description" full>
        <TextArea value={description} onChange={setDescription} rows={3} testId="dashboardDescription" />
      </FormRow>
      <div className="atlFormRow atlFormRow--full">
        <Switch compressed checked={storeTime} onChange={setStoreTime} label="Store time with dashboard" testId="storeTimeWithDashboard" />
        <span className="atlFormRow__help">This changes the time filter to the currently selected time each time this dashboard is loaded.</span>
      </div>
    </SaveModal>
  );
}

/** The same title, whatever its case, on another dashboard: what the original asks to confirm */
export async function titleTaken(title: string, type = 'dashboard'): Promise<boolean> {
  const found = await services.savedObjects.find<{ title?: string }>({
    type,
    search: `"${title}"`,
    searchFields: ['title'],
    fields: ['title'],
    perPage: 10,
  });
  return found.saved_objects.some((object) => (object.attributes.title ?? '').toLowerCase() === title.toLowerCase());
}

/** "Clone dashboard": a new name, and a second click when the name is taken */
export function CloneModal({
  title: initialTitle,
  onClone,
  onClose,
}: {
  title: string;
  onClone: (title: string) => Promise<void>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [duplicate, setDuplicate] = useState(false);
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    setBusy(true);
    try {
      if (!duplicate && (await titleTaken(title))) {
        setDuplicate(true);
        return;
      }
      await onClone(title);
    } catch (failure) {
      services.toasts.error(failure, `Dashboard '${title}' was not saved`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Clone dashboard"
      onClose={onClose}
      testId="dashboardCloneModal"
      className="dshCloneModal"
      footer={
        <>
          <Button variant="empty" onClick={onClose} testId="cloneCancelButton">
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void confirm()} testId="cloneConfirmButton">
            Confirm Clone
          </Button>
        </>
      }
    >
      <p>Please enter a new name for your dashboard.</p>
      <TextField
        value={title}
        onChange={(value) => {
          setTitle(value);
          setDuplicate(false);
        }}
        invalid={duplicate}
        aria-label="Cloned Dashboard Title"
        testId="clonedDashboardTitle"
        autoFocus
        onKeyDown={(event) => {
          if (event.key === 'Enter') void confirm();
        }}
      />
      {duplicate && (
        <div className="dshCloneModal__warning" data-test-subj="titleDupicateWarnMsg">
          <CallOut tone="warning" size="s" title={`A dashboard with the title '${title}' already exists.`}>
            <p>
              Click <strong>Confirm Clone</strong> to clone the dashboard with the duplicate title.
            </p>
          </CallOut>
        </div>
      )}
    </Modal>
  );
}

/** "Customize panel": whether its title shows, and the title, which "Reset" takes back to its object's */
export function CustomizePanelModal({
  title: initialTitle,
  defaultTitle,
  hidden,
  onSave,
  onClose,
}: {
  /** The panel's own title, when it has one */
  title: string | undefined;
  /** Its object's title */
  defaultTitle: string;
  hidden: boolean | undefined;
  onSave: (title: string | undefined, hidden: boolean | undefined) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(initialTitle ?? defaultTitle);
  const [hide, setHide] = useState(hidden);
  return (
    <Modal
      title={<span data-test-subj="customizePanelTitle">Customize panel</span>}
      onClose={onClose}
      className="dshCustomize"
      footer={
        <>
          <Button variant="empty" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => onSave(title === defaultTitle ? undefined : title, hide)} testId="saveNewTitleButton">
            Save
          </Button>
        </>
      }
    >
      <div className="atlStack">
        <Switch compressed checked={!hide} onChange={() => setHide(!hide)} label="Show panel title" testId="customizePanelHideTitle" />
        <FormRow label="Panel title" full>
          <TextField
            compact
            value={title}
            onChange={setTitle}
            disabled={hide}
            aria-label="Enter a custom title for your panel"
            testId="customEmbeddablePanelTitleInput"
            append={
              <button
                type="button"
                className="dshCustomize__reset"
                disabled={hide}
                onClick={() => setTitle(defaultTitle)}
                data-test-subj="resetCustomEmbeddablePanelTitle"
              >
                Reset
              </button>
            }
          />
        </FormRow>
      </div>
    </Modal>
  );
}

/** The empty dashboard: a way to add panels while editing, and the way to edit otherwise */
export function EmptyDashboard({
  editing,
  onAdd,
  onCreate,
  onEdit,
}: {
  editing: boolean;
  onAdd: () => void;
  onCreate: () => void;
  onEdit: () => void;
}) {
  if (editing) {
    return (
      <div className="dshEmptyWidget" data-test-subj="emptyDashboardWidget">
        <p className="dshEmptyWidget__text">
          <button type="button" className="dshLinkButton" aria-label="Add an existing visualization" onClick={onAdd}>
            Add an existing
          </button>
          &nbsp;or new object to this dashboard
        </p>
        <p data-test-subj="linkToVisualizeParagraph">
          <Button icon="plus" onClick={onCreate} testId="addVisualizationButton" aria-label="Create new visualization button">
            Create new
          </Button>
        </p>
      </div>
    );
  }
  return (
    <div className="dshStartScreen">
      <p className="dshStartScreen__title">This dashboard is empty. Let’s fill it up!</p>
      <p className="dshStartScreen__text">
        Click&nbsp;
        <button type="button" className="dshLinkButton" aria-label="Edit dashboard" onClick={onEdit}>
          Edit
        </button>
        &nbsp;in the menu bar above to start adding panels.
      </p>
    </div>
  );
}

/** The way out of full screen, with the product's mark, in the corner as the original's */
export function ExitFullScreen({ onExit }: { onExit: () => void }) {
  return (
    <div>
      <p className="atlScreenReaderOnly" aria-live="polite">
        In full screen mode, press ESC to exit.
      </p>
      <button
        type="button"
        className="dshExitFullScreen"
        aria-label="Exit full screen mode"
        onClick={onExit}
        data-test-subj="exitFullScreenModeLogo"
      >
        <img src={href('/logo.svg')} width={24} height={24} alt="" />
        <span className="dshExitFullScreen__text" data-test-subj="exitFullScreenModeText">
          Exit full screen
        </span>
        <Icon name="fullScreen" className="dshExitFullScreen__icon" />
      </button>
    </div>
  );
}

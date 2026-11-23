/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The save dialog of a visualization opened from another application, a dashboard's panel, as the
 * original's `SavedObjectSaveModalOrigin`: the dialog every page saves with, and under it a switch
 * that says whether to go back where one came from once it is saved. Going back is the default,
 * so the button says "Save and return", and a visualization saved before starts as a copy: that is
 * what its button, "Save as", says.
 */

import { useState } from 'react';
import { Button, CallOut } from '../../components/basic';
import { FormRow, Switch, TextArea, TextField } from '../../components/form';
import { Modal } from '../../components/overlay';
import { services } from '../../services';
import type { SaveResult } from '../../shell/saved_objects_ui';
import { returnSwitchLabel, titleTaken } from './editor_state';

export interface OriginSaveResult extends SaveResult {
  /** Go back to the application the visualization was opened from */
  returnToOrigin: boolean;
}

export function OriginSaveModal({
  savedObjectType,
  savedId,
  title: initialTitle,
  description: initialDescription,
  originatingApp,
  onSave,
  onClose,
}: {
  /** The type of saved object it is: titles are unique among those */
  savedObjectType: string;
  /** The object it was saved as before: then it can also be saved as a new one */
  savedId?: string;
  title: string;
  description?: string;
  originatingApp: string;
  onSave: (result: OriginSaveResult) => Promise<void>;
  onClose: () => void;
}) {
  const existing = savedId !== undefined;
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription ?? '');
  // What was saved before starts as a copy, and going back is the default where it is offered
  const [asNew, setAsNew] = useState(existing);
  const [returnToOrigin, setReturnToOrigin] = useState(() => returnSwitchLabel(originatingApp, existing, existing) !== undefined);
  const [busy, setBusy] = useState(false);
  const [duplicate, setDuplicate] = useState(false);

  const switchLabel = returnSwitchLabel(originatingApp, existing, asNew);
  const returning = returnToOrigin && switchLabel !== undefined;
  // Where there is no switch there is no going back, and it stays so, as there
  const changeAsNew = (next: boolean) => {
    setAsNew(next);
    if (returnSwitchLabel(originatingApp, existing, next) === undefined) setReturnToOrigin(false);
  };

  const save = async (confirmed: boolean) => {
    const newTitle = title.trim();
    if (newTitle === '' || busy) return;
    setBusy(true);
    try {
      // A second object with a title already taken is saved only when confirmed
      if (!confirmed && (asNew || !existing || newTitle !== initialTitle)) {
        const found = await services.savedObjects.find<{ title: string }>({
          type: savedObjectType,
          search: `"${newTitle}"`,
          searchFields: ['title'],
          fields: ['title'],
          perPage: 10,
        });
        const titles = found.saved_objects.map((object) => ({ id: object.id, title: object.attributes.title }));
        if (titleTaken(titles, newTitle, asNew ? undefined : savedId)) {
          setDuplicate(true);
          setBusy(false);
          return;
        }
      }
      await onSave({ title: newTitle, description, asNew: asNew || !existing, returnToOrigin: returning });
    } catch (error) {
      services.toasts.error(error, 'The visualization was not saved');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Save visualization"
      titleSize="l"
      onClose={onClose}
      testId="savedObjectSaveModal"
      className="atlSaveModal"
      footer={
        <>
          <Button variant="empty" onClick={onClose} testId="saveCancelButton">
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={title.trim() === ''}
            onClick={() => void save(duplicate)}
            testId="confirmSaveSavedObjectButton"
          >
            {returning ? 'Save and return' : 'Save'}
          </Button>
        </>
      }
    >
      <form
        className="atlStack"
        onSubmit={(event) => {
          event.preventDefault();
          void save(duplicate);
        }}
      >
        {duplicate && (
          <div data-test-subj="titleDupicateWarnMsg">
            <CallOut tone="warning" title="This visualization already exists">
              <p>Saving &apos;{title}&apos; creates a duplicate title.</p>
            </CallOut>
          </div>
        )}
        {existing && <Switch compressed checked={asNew} onChange={changeAsNew} label="Save as new visualization" testId="saveAsNewCheckbox" />}
        <FormRow label="Title" full>
          <TextField
            value={title}
            onChange={(value) => {
              setTitle(value);
              setDuplicate(false);
            }}
            invalid={title.trim() === '' || duplicate}
            testId="savedObjectTitle"
            autoFocus
          />
        </FormRow>
        <FormRow label="Description" full>
          <TextArea value={description} onChange={setDescription} rows={3} testId="viewDescription" />
        </FormRow>
        {switchLabel !== undefined && (
          <Switch compressed checked={returnToOrigin} onChange={setReturnToOrigin} label={switchLabel} testId="returnToOriginModeSwitch" />
        )}
      </form>
    </Modal>
  );
}

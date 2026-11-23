/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The plugin's bar of unsaved changes: at the end of the application's wrapper, held to the bottom of
 * the window while the page goes on under it, with how many changes there are (or form errors), and
 * the buttons that drop or save them. Saving shows the button busy until it is done.
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../../components/basic';

export function UnsavedChangesBar({
  count,
  errors = 0,
  onCancel,
  onSave,
  testId,
}: {
  count: number;
  errors?: number;
  onCancel: () => void;
  onSave: () => Promise<unknown> | void;
  testId?: string;
}) {
  const [busy, setBusy] = useState(false);
  const gone = useRef(false);
  useEffect(
    () => () => {
      gone.current = true;
    },
    []
  );
  const save = async () => {
    setBusy(true);
    try {
      await onSave();
    } catch {
      // the page has said what went wrong; the bar only stops being busy
    } finally {
      if (!gone.current) setBusy(false);
    }
  };
  const bar = (
    <section className="ismChangesBar">
      <h2 className="atlScreenReaderOnly">Page level controls</h2>
      <div className="ismChangesBar__row">
        {errors > 0 ? (
          <div className="ismChangesBar__text">
            <span className="ismChangesBar__block ismChangesBar__block--danger" />
            {errors} form errors.
          </div>
        ) : count > 0 ? (
          <div className="ismChangesBar__text">
            <span className="ismChangesBar__block" />
            {count} unsaved changes.
          </div>
        ) : null}
        <Button variant="ghost" icon="cross" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" icon="check" loading={busy} disabled={busy} onClick={() => void save()} testId={testId}>
          Save
        </Button>
      </div>
    </section>
  );
  const wrapper = document.getElementById('app-wrapper');
  return wrapper ? createPortal(bar, wrapper) : bar;
}

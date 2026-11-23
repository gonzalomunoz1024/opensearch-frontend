/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The plugin's bars at the bottom of a page, the theme's dark bottom bar held to the bottom of the
 * window while the page goes on under it. The bar of unsaved changes is at the end of the
 * application's wrapper, with how many changes there are (or form errors), and the buttons that
 * drop or save them; saving shows the button busy until it is done. The bar of a page that creates
 * something is at the end of the page, its buttons at the right.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../../components/basic';

export function UnsavedChangesBar({
  count,
  errors = 0,
  onCancel,
  onSave,
  testId,
  cancelTestId,
  extra,
}: {
  count: number;
  errors?: number;
  onCancel: () => void;
  onSave: () => Promise<unknown> | void;
  testId?: string;
  cancelTestId?: string;
  /** Between Cancel and Save, as the plugin's pages put a button of their own there */
  extra?: ReactNode;
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
    <BottomBar>
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
        <Button variant="ghost" icon="cross" onClick={onCancel} testId={cancelTestId}>
          Cancel
        </Button>
        {extra}
        <Button variant="primary" icon="check" loading={busy} disabled={busy} onClick={() => void save()} testId={testId}>
          Save
        </Button>
      </div>
    </BottomBar>
  );
  const wrapper = document.getElementById('app-wrapper');
  return wrapper ? createPortal(bar, wrapper) : bar;
}

/** The bar of a page that creates something: its buttons at the right, 24 px apart */
export function PageBottomBar({ children }: { children: ReactNode }) {
  return (
    <BottomBar>
      <div className="ismChangesBar__row ismChangesBar__row--end">{children}</div>
    </BottomBar>
  );
}

/** The bar as a landmark with its heading, then the announcement that it is there, as the theme's bottom bar */
function BottomBar({ children }: { children: ReactNode }) {
  return (
    <>
      <section aria-label="Page level controls" className="ismChangesBar">
        <h2 className="atlScreenReaderOnly">Page level controls</h2>
        {children}
      </section>
      <p aria-live="assertive" className="atlScreenReaderOnly">
        There is a new region landmark with page level controls at the end of the document.
      </p>
    </>
  );
}

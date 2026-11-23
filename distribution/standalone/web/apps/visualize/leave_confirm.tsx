/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The question asked before the Visualize editor is left for another application with changes,
 * as the original's application service asks it for a leave handler that confirms
 * (`overlays.openConfirm(text, { title, 'data-test-subj': 'appLeaveConfirmModal' })`).
 */

import { Button } from '../../components/basic';
import { Modal } from '../../components/overlay';
import { LEAVE_TEXT, LEAVE_TITLE } from './top_nav';

export function LeaveConfirmModal({ onAnswer }: { onAnswer: (leave: boolean) => void }) {
  return (
    <Modal
      title={LEAVE_TITLE}
      onClose={() => onAnswer(false)}
      testId="appLeaveConfirmModal"
      footer={
        <>
          <Button variant="empty" onClick={() => onAnswer(false)} testId="confirmModalCancelButton">
            Cancel
          </Button>
          <Button variant="primary" onClick={() => onAnswer(true)} data-autofocus testId="confirmModalConfirmButton">
            Confirm
          </Button>
        </>
      }
    >
      <p>{LEAVE_TEXT}</p>
    </Modal>
  );
}

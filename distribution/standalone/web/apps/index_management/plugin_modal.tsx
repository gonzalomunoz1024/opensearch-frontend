/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The plugin's dialogs as its pages write them: an EuiModal as wide as what it says (400 to 768 px),
 * the title an h2 in `EuiText size="s"`, a body whose lines are 1.5 apart with its lists of names
 * marked inside, and a footer of two small buttons, Cancel and the action.
 */

import type { ReactNode } from 'react';
import { Button, cx } from '../../components/basic';
import { TextField } from '../../components/form';
import { Modal } from '../../components/overlay';

export function PluginModal({
  title,
  titleTestId,
  children,
  footer,
  onClose,
  testId,
  className,
}: {
  title: ReactNode;
  titleTestId?: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  testId?: string;
  className?: string;
}) {
  return (
    <Modal
      title={
        <span className="ismModal__title" data-test-subj={titleTestId}>
          {title}
        </span>
      }
      titleSize="l"
      onClose={onClose}
      testId={testId}
      className={cx('ismModal', className)}
      footer={footer}
    >
      <div className="ismModal__body">{children}</div>
    </Modal>
  );
}

/** Cancel, then the action: the plugin's `EuiSmallButtonEmpty` and filled `EuiSmallButton` */
export function ModalButtons({
  label,
  onCancel,
  onConfirm,
  danger,
  disabled,
  cancelTestId,
  confirmTestId,
}: {
  label: ReactNode;
  onCancel: () => void;
  onConfirm: () => void;
  danger?: boolean;
  disabled?: boolean;
  cancelTestId?: string;
  confirmTestId?: string;
}) {
  return (
    <>
      <Button variant="empty" onClick={onCancel} testId={cancelTestId}>
        Cancel
      </Button>
      <Button variant={danger ? 'dangerFill' : 'primary'} disabled={disabled} onClick={onConfirm} testId={confirmTestId}>
        {label}
      </Button>
    </>
  );
}

/**
 * Names one under another, each after a bullet inside the line. `within` says where they stand: in
 * a small call-out they are 18 px in, as the theme's list in its extra small text; `callOutSmall`
 * sets them in the small text again, and `callOutTitled` puts them 18 px under the call-out's title.
 */
export function ModalNames({
  names,
  testId,
  within,
}: {
  names: string[];
  testId?: (name: string) => string;
  within?: 'callOutSmall' | 'callOutTitled';
}) {
  return (
    <ul
      className={cx(
        'ismModalNames',
        within && 'ismModalNames--callOut',
        within === 'callOutSmall' && 'ismModal__small',
        within === 'callOutTitled' && 'ismModalNames--underTitle'
      )}
    >
      {names.map((name) => (
        <li key={name} data-test-subj={testId?.(name)}>
          {name}
        </li>
      ))}
    </ul>
  );
}

/** The word to type before the action can be done, and where it is typed */
export function TypeTheWord({
  word,
  value,
  onChange,
  testId,
}: {
  word: string;
  value: string;
  onChange: (value: string) => void;
  testId?: string;
}) {
  return (
    <>
      <p className="ismModal__subdued">
        To confirm your action, type <b className="ismModal__word">{word}</b>.
      </p>
      <TextField compact value={value} onChange={onChange} placeholder={word} testId={testId} />
    </>
  );
}

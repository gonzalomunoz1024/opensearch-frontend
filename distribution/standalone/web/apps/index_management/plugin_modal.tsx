/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The plugin's dialogs as its pages write them: an EuiModal as wide as what it says (400 to 768 px),
 * the title an h2 in `EuiText size="s"`, a body whose lines are 1.5 apart with its lists of names
 * marked inside, and a footer of two small buttons, Cancel and the action.
 */

import { useState, type ReactNode } from 'react';
import { Button, cx } from '../../components/basic';
import { TextField } from '../../components/form';
import { Modal } from '../../components/overlay';
import { JsonBlock } from './json_block';

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
      <Button
        variant={danger ? 'dangerFill' : 'primary'}
        disabled={disabled}
        onClick={onConfirm}
        testId={confirmTestId}
      >
        {label}
      </Button>
    </>
  );
}

/**
 * Names one under another, each after a bullet inside the line. `within` says where they stand: in
 * a small call-out they are 18 px in, as the theme's list in its extra small text; `callOutSmall`
 * sets them in the small text again, and `callOutTitled` puts them 18 px under the call-out's title;
 * `plain` is a list outside any text of the theme, which starts at the edge.
 */
export function ModalNames({
  names,
  testId,
  within,
}: {
  names: string[];
  testId?: (name: string) => string;
  within?: 'callOutSmall' | 'callOutTitled' | 'plain';
}) {
  return (
    <ul
      className={cx(
        'ismModalNames',
        within === 'plain' && 'ismModalNames--plain',
        (within === 'callOutSmall' || within === 'callOutTitled') && 'ismModalNames--callOut',
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

/**
 * The plugin's DeleteModal, which its lists of data streams and of templates share: what goes, and
 * "delete" typed before it does. Its Cancel button has the plugin's own spelling of a test id.
 */
export function DeleteModal({
  title,
  tips,
  names,
  onClose,
  onConfirm,
}: {
  title: string;
  /** What deleting does, above the names */
  tips: string;
  names: string[];
  onClose: () => void;
  onConfirm: () => void;
}) {
  const [value, setValue] = useState('');
  return (
    <PluginModal
      title={title}
      onClose={onClose}
      footer={
        <ModalButtons
          label="Delete"
          danger
          disabled={value !== 'delete'}
          onCancel={onClose}
          onConfirm={onConfirm}
          cancelTestId="deletaCancelButton"
          confirmTestId="deleteConfirmButton"
        />
      }
    >
      <p>{tips}</p>
      <ModalNames names={names} within="plain" />
      <div className="ismSpacer ismSpacer--l" />
      <TypeTheWord word="delete" value={value} onChange={setValue} testId="deleteInput" />
    </PluginModal>
  );
}

/**
 * The plugin's `Modal.show` of something as JSON, 768 px wide: the title (`large`: the second
 * heading of a small text, 22 px, as the page of an index template gives it), the JSON in the
 * theme's code block with its copy button, and a filled Close named after the dialog's test id.
 */
export function JsonShowModal({
  title,
  large,
  json,
  testId,
  onClose,
}: {
  title: string;
  large?: boolean;
  json: unknown;
  testId: string;
  onClose: () => void;
}) {
  return (
    <Modal
      title={large ? <span className="ismModal__h2">{title}</span> : title}
      onClose={onClose}
      testId={testId}
      className="ismModal ismModal--json"
      footer={
        <Button variant="primary" onClick={onClose} testId={`${testId}-ok`}>
          Close
        </Button>
      }
    >
      <JsonBlock text={JSON.stringify(json, null, 2)} copyable />
    </Modal>
  );
}

/**
 * The plugin's own small dialog (its `Modal.show`): a title, what it says, and Cancel beside the
 * action. Its buttons are found by the title, as the plugin names them.
 */
export function SimpleModal({
  title,
  children,
  confirmLabel = 'Confirm',
  danger,
  onConfirm,
  onClose,
}: {
  title: string;
  children: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  /** Does it; the dialog stays open when it says false */
  onConfirm: () => Promise<boolean> | boolean;
  onClose: () => void;
}) {
  const confirm = async () => {
    if (await onConfirm()) onClose();
  };
  return (
    <Modal
      title={title}
      onClose={onClose}
      className="ismModal"
      footer={
        <>
          <Button variant="empty" onClick={onClose} testId={`${title}-cancel`}>
            Cancel
          </Button>
          <Button
            variant={danger ? 'dangerFill' : 'primary'}
            onClick={() => void confirm()}
            testId={`${title}-confirm`}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="ismModal__body">{children}</div>
    </Modal>
  );
}

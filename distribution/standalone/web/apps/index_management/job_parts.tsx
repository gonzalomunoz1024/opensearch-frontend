/* SPDX-License-Identifier: Apache-2.0 */

/* What the pages of rollup jobs and of transform jobs are both made of. */

import { useState, type ReactNode } from 'react';
import { Button, cx } from '../../components/basic';
import { Modal } from '../../components/overlay';
import { LocalTable, ism, type Answer, type TableColumn } from './common';
import { type FieldItem } from './rollup_model';

/** The steps of a form at its left: the ones not reached yet are pale */
export function Steps({ titles, step }: { titles: string[]; step: number }) {
  return (
    <ol className="ismSteps">
      {titles.map((title, at) => (
        <li
          key={title}
          className={cx('ismSteps__step', at + 1 > step && 'ismSteps__step--disabled')}
          aria-current={at + 1 === step ? 'step' : undefined}
        >
          <span className="ismSteps__number">{at + 1}</span>
          <span className="ismSteps__title">{title}</span>
        </li>
      ))}
    </ol>
  );
}

/** A form in steps: the steps, the step that is open, and the buttons that move between them */
export function Wizard({
  titles,
  step,
  children,
  buttons,
}: {
  titles: string[];
  step: number;
  children: ReactNode;
  buttons: ReactNode;
}) {
  return (
    <div className="ismPage ismPage--form">
      <div className="ismWizard">
        <aside className="ismWizard__steps">
          <Steps titles={titles} step={step} />
        </aside>
        <div className="ismWizard__body">
          <h1 className="ismPageTitle">{titles[step - 1]}</h1>
          {children}
        </div>
      </div>
      <div className="ismButtons">{buttons}</div>
    </div>
  );
}

/** A field under its name, with what is wrong with it and what it means below it */
export function FieldRow({
  title,
  optional,
  help,
  error,
  wide,
  children,
}: {
  title?: ReactNode;
  optional?: boolean;
  help?: ReactNode;
  error?: ReactNode;
  /** Takes the width it is given instead of that of a field */
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={cx('ismRow', wide && 'ismRow--wide')}>
      {title && (
        <h3 className="ismRow__title">
          {title}
          {optional && <i> – optional</i>}
        </h3>
      )}
      <div className="ismRow__field">{children}</div>
      {error && <div className="ismLabeled__error">{error}</div>}
      {help && <div className="ismLabeled__help">{help}</div>}
    </div>
  );
}

/** A number and the unit it counts, side by side */
export function Paired({ children }: { children: ReactNode }) {
  return <div className="ismPaired">{children}</div>;
}

export interface FoundNames {
  dataStreams: string[];
  indices: string[];
}

/** The data streams and the first ten indexes whose names hold the text */
export async function loadNames(search: string): Promise<Answer<FoundNames>> {
  const [indices, dataStreams] = await Promise.all([
    ism.get<{ indices: Array<{ index: string }> }>('_indices', {
      from: 0,
      size: 10,
      search,
      terms: search,
      sortDirection: 'desc',
      sortField: 'index',
      showDataStreams: true,
    }),
    ism.get<{ dataStreams: Array<{ name: string }> }>('_data_streams', { search }),
  ]);
  if (!indices.ok) return { ok: false, error: indices.error };
  if (!dataStreams.ok) return { ok: false, error: dataStreams.error };
  return {
    ok: true,
    response: {
      dataStreams: (dataStreams.response?.dataStreams ?? []).map((stream) => stream.name),
      indices: (indices.response?.indices ?? []).map((index) => index.index),
    },
  };
}

const FIELD_COLUMNS: Array<TableColumn<FieldItem>> = [
  { field: 'label', name: 'Field name', render: (field) => field.label },
  { field: 'type', name: 'Field type', render: (field) => field.type ?? '-' },
];

/** The fields of the source, to tick the ones to add */
export function AddFieldsModal({
  fields,
  ticked,
  selectable,
  empty,
  onClose,
  onAdd,
  cancelTestId,
  addTestId,
}: {
  fields: FieldItem[];
  /** The fields that are ticked as the dialog opens */
  ticked: FieldItem[];
  selectable?: (field: FieldItem) => boolean;
  empty?: ReactNode;
  onClose: () => void;
  onAdd: (chosen: FieldItem[]) => void;
  cancelTestId: string;
  addTestId: string;
}) {
  const [chosen, setChosen] = useState<FieldItem[]>(() =>
    fields.filter((field) => ticked.some((other) => other.label === field.label))
  );
  return (
    <Modal
      title="Add fields"
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="empty" size="s" onClick={onClose} testId={cancelTestId}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="s"
            onClick={() => {
              onClose();
              onAdd(chosen);
            }}
            testId={addTestId}
          >
            Add
          </Button>
        </>
      }
    >
      <div className="ismAddFields">
        <LocalTable
          columns={FIELD_COLUMNS}
          rows={fields}
          rowId={(field) => field.label}
          paged={false}
          selected={chosen}
          onSelect={setChosen}
          selectable={selectable}
          empty={empty}
        />
      </div>
    </Modal>
  );
}

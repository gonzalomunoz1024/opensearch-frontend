/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Transform jobs: the list of them, with what each is doing, as the plugin draws it: the title and
 * its buttons in one row, the search box, a line, and a table laid out on what its cells hold.
 */

import { useState, type ReactNode } from 'react';
import { Button } from '../../components/basic';
import { Modal } from '../../components/overlay';
import { useBreadcrumbs } from '../../shell/state';
import { Table, go, ism, to, toasts, useListQuery, type TableColumn } from './common';
import { DeleteJobsModal, JobActionsMenu, JobsPanel, ListEmptyPrompt, ListSearch, Rule, useListLoad } from './job_parts';
import { stillListed } from './policy_model';
import { CRUMBS, ROUTES } from './routes';
import { transformStatus, transformTime, type TransformDocument, type TransformMetadata } from './transform_model';

export interface TransformRow extends TransformDocument {
  metadata?: TransformMetadata | null;
}

/**
 * What a job is doing, as the plugin writes it: a small dot in the colour of its state and a word
 * in the smallest text, 4 px apart, or a dash. A job that failed says why when the word is clicked.
 */
export function TransformStatusText({ metadata }: { metadata: TransformMetadata | null | undefined }) {
  const [reading, setReading] = useState(false);
  const status = transformStatus(metadata);
  if (!status) return <>-</>;
  return (
    <div className="ismTransformStatus">
      <span className={`ismTransformStatus__dot ismTransformStatus__dot--${status.tone}`} />
      <div className="ismTransformStatus__text">
        {status.error === undefined ? (
          status.text
        ) : (
          <button type="button" className="atlLinkButton" onClick={() => setReading(true)}>
            {status.text}
          </button>
        )}
      </div>
      {reading && (
        <Modal
          title="Error"
          className="ismMasked ismErrorModal"
          onClose={() => setReading(false)}
          footer={
            <Button variant="primary" onClick={() => setReading(false)} testId="errorModalCloseButton">
              Close
            </Button>
          }
        >
          {status.error}
        </Modal>
      )}
    </div>
  );
}

/** The dialog that deletes transform jobs once "delete" is typed */
export function DeleteTransformModal({
  transformId,
  onClose,
  onDelete,
}: {
  transformId: string;
  onClose: () => void;
  onDelete: () => void | Promise<void>;
}) {
  return (
    <DeleteJobsModal onClose={onClose} onDelete={onDelete}>
      By deleting <strong>{transformId}</strong>, all future scheduled executions will be canceled. However, your target
      index and data in it will remain intact.
    </DeleteJobsModal>
  );
}

/**
 * Starts or stops a job and says how it went; true when it went well. The list and the page of
 * one job name a failure differently: `failed` is the verb each uses.
 */
export async function switchTransform(transformId: string, on: boolean, failed: string): Promise<boolean> {
  const answer = await ism.post(`transforms/${encodeURIComponent(transformId)}/_${on ? 'start' : 'stop'}`);
  if (answer.ok) toasts.success(`"${transformId}" is ${on ? 'enabled' : 'disabled'}`);
  else toasts.danger(`Could not ${failed} transform job "${transformId}": ${answer.error}`);
  return answer.ok;
}

export async function deleteTransform(transformId: string): Promise<boolean> {
  const answer = await ism.delete(`transforms/${encodeURIComponent(transformId)}`);
  if (answer.ok) toasts.success(`"${transformId}" successfully deleted!`);
  // The spaces around the colon are the plugin's
  else toasts.danger(`Could not delete transform job "${transformId}" :  ${answer.error}`);
  return answer.ok;
}

const EMPTY = {
  filtered: 'There are no transform jobs matching your applied filters. Reset your filters to view your transform jobs.',
  none: 'Transform jobs help you create a materialized view on top of existing data.',
  loading: 'Loading transform jobs...',
};

// The plugin's `truncateText`: on one line, which the table makes room for
const oneLine = (value: ReactNode) => <div className="atlTruncate">{value}</div>;

const COLUMNS: Array<TableColumn<TransformRow>> = [
  {
    field: '_id',
    name: 'Name',
    sortable: true,
    render: (row) =>
      oneLine(
        <button
          type="button"
          className="atlLinkButton ismTableLink"
          onClick={() => go(ROUTES.TRANSFORM_DETAILS, { id: row._id })}
          data-test-subj={`transformLink_${row._id}`}
        >
          {row._id}
        </button>
      ),
  },
  {
    field: 'transform.source_index',
    name: 'Source index',
    sortable: true,
    render: (row) => oneLine(row.transform.source_index),
  },
  {
    field: 'transform.target_index',
    name: 'Target index',
    sortable: true,
    render: (row) => oneLine(row.transform.target_index),
  },
  {
    field: 'transform.enabled',
    name: 'Job state',
    sortable: true,
    render: (row) => oneLine(row.transform.enabled ? 'Enabled' : 'Disabled'),
  },
  {
    field: 'transform.continuous',
    name: 'Continuous',
    sortable: true,
    render: (row) => oneLine(row.transform.continuous ? 'Yes' : 'No'),
  },
  {
    field: 'transform.updated_at',
    name: 'Last updated time',
    sortable: true,
    render: (row) => transformTime(row.transform.updated_at),
  },
  {
    field: 'metadata',
    name: 'Transform job status',
    render: (row) => <TransformStatusText metadata={row.metadata} />,
  },
];

export function Transforms() {
  useBreadcrumbs([CRUMBS.INDEX_MANAGEMENT, CRUMBS.TRANSFORMS]);
  const [query, setQuery] = useListQuery({ sortField: '_id' });
  const [transforms, setTransforms] = useState<TransformRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<TransformRow[]>([]);
  const [deleting, setDeleting] = useState(false);

  const load = async () => {
    setLoading(true);
    const answer = await ism.get<{ transforms: TransformRow[]; totalTransforms: number }>('transforms', {
      from: query.from,
      size: query.size,
      search: query.search,
      sortField: query.sortField,
      sortDirection: query.sortDirection,
    });
    if (answer.ok && answer.response) {
      const listed = answer.response.transforms;
      setTransforms(listed);
      setTotal(answer.response.totalTransforms ?? 0);
      setSelected((ticked) => stillListed(ticked, listed, (row) => row._id));
    } else {
      toasts.danger(answer.error || 'There was problem loading transforms');
    }
    setLoading(false);
  };
  const reload = useListLoad(load, [query.from, query.size, query.search, query.sortField, query.sortDirection]);

  // One job after the other, as the plugin does, and the list again when all are done
  const each = async (act: (transformId: string) => Promise<boolean>) => {
    for (const row of selected) await act(row._id);
    reload();
  };
  // As the plugin's, the dialog closes once a job is deleted, and stays open while none is
  const remove = async () => {
    for (const row of selected) if (await deleteTransform(row._id)) setDeleting(false);
    reload();
  };

  const none = selected.length === 0;
  const filtered = query.search !== '';
  return (
    <JobsPanel
      title={`Transform jobs (${transforms.length})`}
      titleSize="m"
      actions={
        <>
          <Button icon="refresh" onClick={reload} testId="refreshButton">
            Refresh
          </Button>
          <Button disabled={none} onClick={() => void each((id) => switchTransform(id, false, 'stop'))} testId="disableButton">
            Disable
          </Button>
          <Button disabled={none} onClick={() => void each((id) => switchTransform(id, true, 'start'))} testId="enableButton">
            Enable
          </Button>
          <JobActionsMenu
            disabled={none}
            items={[
              {
                id: 'edit',
                label: 'Edit',
                testId: 'editButton',
                disabled: selected.length !== 1,
                onClick: () => go(ROUTES.EDIT_TRANSFORM, { id: selected[0]._id }),
              },
              {
                id: 'delete',
                label: 'Delete',
                testId: 'deleteButton',
                danger: true,
                disabled: none,
                onClick: () => setDeleting(true),
              },
            ]}
          />
          <Button variant="primary" icon="plus" onClick={() => go(ROUTES.CREATE_TRANSFORM)} testId="createTransformButton">
            Create transform job
          </Button>
        </>
      }
    >
      <ListSearch search={query.search} onSearch={(search) => setQuery({ search, from: 0 })} ariaLabel={null} />
      <Rule />
      <div className="ismJobsTable">
        <Table
          columns={COLUMNS}
          rows={transforms}
          total={total}
          query={query}
          onQuery={(changes) => {
            // As the component library's table, a new sort or page unticks every row
            setSelected([]);
            setQuery(changes);
          }}
          rowId={(row) => row._id}
          selected={selected}
          onSelect={setSelected}
          empty={
            <ListEmptyPrompt
              body={loading ? EMPTY.loading : filtered ? EMPTY.filtered : EMPTY.none}
              actions={
                loading ? null : filtered ? (
                  // The plugin keeps the page it was on
                  <Button variant="primary" onClick={() => setQuery({ search: '' })} testId="transformEmptyPromptRestFilters">
                    Reset Filters
                  </Button>
                ) : (
                  <Button variant="primary" icon="plus" to={to(ROUTES.CREATE_TRANSFORM)} testId="emptyPromptCreateTransformButton">
                    Create transform
                  </Button>
                )
              }
            />
          }
        />
      </div>
      {deleting && (
        <DeleteTransformModal
          transformId={selected.map((row) => row._id).join(', ')}
          onClose={() => setDeleting(false)}
          onDelete={remove}
        />
      )}
    </JobsPanel>
  );
}

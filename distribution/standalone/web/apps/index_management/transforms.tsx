/* SPDX-License-Identifier: Apache-2.0 */

/* Transform jobs: the list of them, with what each is doing. */

import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '../../components/basic';
import { Modal } from '../../components/overlay';
import { useBreadcrumbs } from '../../shell/state';
import { ActionsMenu, ContentPanel, DeleteModal, SearchRow, Table, go, ism, toasts, type TableColumn } from './common';
import { useListQuery } from './common';
import { CRUMBS, ROUTES } from './routes';
import { transformStatus, transformTime, type TransformDocument, type TransformMetadata } from './transform_model';

export interface TransformRow extends TransformDocument {
  metadata?: TransformMetadata | null;
}

/** What a job is doing: a dot in the colour of its state and a word. A job that failed says why when asked. */
export function TransformStatusText({ metadata }: { metadata: TransformMetadata | null | undefined }) {
  const [reading, setReading] = useState(false);
  const status = transformStatus(metadata);
  if (!status) return <>-</>;
  return (
    <span className="ismTransformStatus">
      <span className={`ismTransformStatus__dot ismTransformStatus__dot--${status.tone}`} />
      {status.error === undefined ? (
        status.text
      ) : (
        <button type="button" className="atlLinkButton" onClick={() => setReading(true)}>
          {status.text}
        </button>
      )}
      {reading && (
        <Modal
          title="Error"
          onClose={() => setReading(false)}
          footer={
            <Button variant="primary" size="s" onClick={() => setReading(false)} testId="errorModalCloseButton">
              Close
            </Button>
          }
        >
          {status.error}
        </Modal>
      )}
    </span>
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
    <DeleteModal
      title="Delete job(s)"
      label="Delete"
      help="To confirm deletion, enter delete in the text field"
      onClose={onClose}
      onDelete={onDelete}
    >
      By deleting <strong>{transformId}</strong>, all future scheduled executions will be canceled. However, your target
      index and data in it will remain intact.
    </DeleteModal>
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

const text = (value: ReactNode) => <span className="atlTruncate">{value}</span>;

const COLUMNS: Array<TableColumn<TransformRow>> = [
  {
    field: '_id',
    name: 'Name',
    sortable: true,
    render: (row) => (
      <a
        href={`#${ROUTES.TRANSFORM_DETAILS}?id=${encodeURIComponent(row._id)}`}
        className="ismNoWrap"
        data-test-subj={`transformLink_${row._id}`}
      >
        {row._id}
      </a>
    ),
  },
  {
    field: 'transform.source_index',
    name: 'Source index',
    sortable: true,
    render: (row) => text(row.transform.source_index),
  },
  {
    field: 'transform.target_index',
    name: 'Target index',
    sortable: true,
    render: (row) => text(row.transform.target_index),
  },
  {
    field: 'transform.enabled',
    name: 'Job state',
    sortable: true,
    render: (row) => (row.transform.enabled ? 'Enabled' : 'Disabled'),
  },
  {
    field: 'transform.continuous',
    name: 'Continuous',
    sortable: true,
    render: (row) => (row.transform.continuous ? 'Yes' : 'No'),
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
      const found = answer.response.transforms;
      setTransforms(found);
      setTotal(answer.response.totalTransforms ?? 0);
      // What was ticked stays ticked while it is still listed
      setSelected((before) => found.filter((row) => before.some((was) => was._id === row._id)));
    } else {
      toasts.danger(answer.error || 'There was problem loading transforms');
    }
    setLoading(false);
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.from, query.size, query.search, query.sortField, query.sortDirection]);

  // One job after the other, as the plugin does, and the list again when all are done
  const each = async (act: (transformId: string) => Promise<boolean>) => {
    for (const row of selected) await act(row._id);
    await load();
  };

  const none = selected.length === 0;
  const filtered = query.search !== '';
  return (
    <ContentPanel
      title={`Transform jobs (${transforms.length})`}
      actions={
        <>
          <Button size="s" icon="refresh" onClick={() => void load()} testId="refreshButton">
            Refresh
          </Button>
          <Button
            size="s"
            disabled={none}
            onClick={() => void each((id) => switchTransform(id, false, 'stop'))}
            testId="disableButton"
          >
            Disable
          </Button>
          <Button
            size="s"
            disabled={none}
            onClick={() => void each((id) => switchTransform(id, true, 'start'))}
            testId="enableButton"
          >
            Enable
          </Button>
          <ActionsMenu
            testId="actionButton"
            disabled={none}
            items={[
              {
                id: 'edit',
                label: 'Edit',
                testId: 'editButton',
                disabled: selected.length !== 1,
                onClick: () => go(ROUTES.EDIT_TRANSFORM, { id: selected[0]._id }),
              },
              { id: 'delete', label: 'Delete', testId: 'deleteButton', danger: true, disabled: none, onClick: () => setDeleting(true) },
            ]}
          />
          <Button
            variant="primary"
            size="s"
            icon="plus"
            onClick={() => go(ROUTES.CREATE_TRANSFORM)}
            testId="createTransformButton"
          >
            Create transform job
          </Button>
        </>
      }
    >
      <SearchRow search={query.search} onSearch={(search) => setQuery({ search, from: 0 })} />
      <Table
        columns={COLUMNS}
        rows={transforms}
        total={total}
        query={query}
        onQuery={setQuery}
        rowId={(row) => row._id}
        selected={selected}
        onSelect={setSelected}
        loading={loading}
        empty={
          <div className="ismEmpty">
            <p>{loading ? EMPTY.loading : filtered ? EMPTY.filtered : EMPTY.none}</p>
            {!loading &&
              (filtered ? (
                <Button
                  variant="primary"
                  size="s"
                  onClick={() => setQuery({ search: '' })}
                  testId="transformEmptyPromptRestFilters"
                >
                  Reset Filters
                </Button>
              ) : (
                <Button
                  variant="primary"
                  size="s"
                  icon="plus"
                  onClick={() => go(ROUTES.CREATE_TRANSFORM)}
                  testId="emptyPromptCreateTransformButton"
                >
                  Create transform
                </Button>
              ))}
          </div>
        }
      />
      {deleting && (
        <DeleteTransformModal
          transformId={selected.map((row) => row._id).join(', ')}
          onClose={() => setDeleting(false)}
          onDelete={async () => {
            setDeleting(false);
            await each(deleteTransform);
          }}
        />
      )}
    </ContentPanel>
  );
}

/* SPDX-License-Identifier: Apache-2.0 */

/* Rollup jobs: the list of them, with what each is doing. */

import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '../../components/basic';
import { Icon } from '../../components/icon';
import { ActionsMenu, ContentPanel, DeleteModal, SearchRow, Table, go, ism, renderTime, toasts, type TableColumn } from './common';
import { useListQuery } from './common';
import { useBreadcrumbs } from '../../shell/state';
import { rollupStatus, rollupWindow, type JobStatus, type RollupDocument, type RollupMetadata } from './rollup_model';
import { CRUMBS, ROUTES } from './routes';

export interface RollupRow extends RollupDocument {
  metadata?: RollupMetadata | null;
}

/** What a job is doing: a mark in the colour of its state and a word, or a dash */
export function JobStatusText({ status }: { status: JobStatus | undefined }) {
  if (!status) return <>-</>;
  return (
    <span className={`ismJobStatus ismJobStatus--${status.tone}`}>
      <Icon name={status.icon} />
      <span>{status.text}</span>
    </span>
  );
}

/** The window a continuous job works on next, from its start to its end */
export function windowText(metadata: RollupMetadata | null | undefined): string {
  const ends = rollupWindow(metadata);
  return ends ? `${renderTime(ends[0])} - ${renderTime(ends[1])}` : '-';
}

/** The dialog that deletes rollup jobs once "delete" is typed */
export function DeleteRollupModal({
  rollupId,
  onClose,
  onDelete,
}: {
  rollupId: string;
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
      By deleting &quot;<strong>{rollupId}</strong>&quot;, all future scheduled rollup execution will be canceled.
      However, your target index will remain as it is.
    </DeleteModal>
  );
}

/** Starts or stops a job and says how it went; true when it went well */
export async function switchRollup(rollupId: string, on: boolean): Promise<boolean> {
  const answer = await ism.post(`rollups/${encodeURIComponent(rollupId)}/_${on ? 'start' : 'stop'}`);
  if (answer.ok) toasts.success(`${rollupId} is ${on ? 'enabled' : 'disabled'}`);
  else toasts.danger(`Could not ${on ? 'start' : 'stop'} the rollup job "${rollupId}" : ${answer.error}`);
  return answer.ok;
}

export async function deleteRollup(rollupId: string): Promise<boolean> {
  const answer = await ism.delete(`rollups/${encodeURIComponent(rollupId)}`);
  if (answer.ok) toasts.success(`"${rollupId}" successfully deleted!`);
  else toasts.danger(`Could not delete the rollup job "${rollupId}" : ${answer.error}`);
  return answer.ok;
}

const EMPTY = {
  filtered: 'There are no rollup jobs matching your applied filters. Reset your filters to view your rollup jobs.',
  none: 'Rollup jobs help you conserve storage space for historical time series data while preserving the specific information you need.',
  loading: 'Loading rollup jobs...',
};

const text = (value: ReactNode) => <span className="atlTruncate">{value}</span>;

const COLUMNS: Array<TableColumn<RollupRow>> = [
  {
    field: '_id',
    name: 'Name',
    sortable: true,
    render: (row) => (
      <a
        href={`#${ROUTES.ROLLUP_DETAILS}?id=${encodeURIComponent(row._id)}`}
        className="ismNoWrap"
        data-test-subj={`rollupLink_${row._id}`}
      >
        {row._id}
      </a>
    ),
  },
  { field: 'rollup.source_index', name: 'Source index', sortable: true, render: (row) => text(row.rollup.source_index) },
  { field: 'rollup.target_index', name: 'Target index', sortable: true, render: (row) => text(row.rollup.target_index) },
  {
    field: 'rollup.enabled',
    name: 'Job state',
    sortable: true,
    render: (row) => (row.rollup.enabled ? 'Enabled' : 'Disabled'),
  },
  {
    field: 'rollup.continuous',
    name: 'Continuous',
    sortable: true,
    render: (row) => (row.rollup.continuous ? 'Yes' : 'No'),
  },
  {
    field: 'metadata.rollup_metadata.continuous',
    name: 'Next rollup window',
    render: (row) => windowText(row.metadata),
  },
  {
    field: 'metadata',
    name: 'Rollup job status',
    render: (row) => <JobStatusText status={rollupStatus(row.metadata)} />,
  },
];

export function Rollups() {
  useBreadcrumbs([CRUMBS.INDEX_MANAGEMENT, CRUMBS.ROLLUPS]);
  const [query, setQuery] = useListQuery({ sortField: '_id' });
  const [rollups, setRollups] = useState<RollupRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<RollupRow[]>([]);
  const [deleting, setDeleting] = useState(false);

  const load = async () => {
    setLoading(true);
    const answer = await ism.get<{ rollups: RollupRow[]; totalRollups: number }>('rollups', {
      from: query.from,
      size: query.size,
      search: query.search,
      sortField: query.sortField,
      sortDirection: query.sortDirection,
    });
    if (answer.ok && answer.response) {
      const found = answer.response.rollups;
      setRollups(found);
      setTotal(answer.response.totalRollups ?? 0);
      // What was ticked stays ticked while it is still listed
      setSelected((before) => found.filter((row) => before.some((was) => was._id === row._id)));
    } else {
      toasts.danger(answer.error || 'There was a problem loading the rollups');
    }
    setLoading(false);
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.from, query.size, query.search, query.sortField, query.sortDirection]);

  // One job after the other, as the plugin does, and the list again when all are done
  const each = async (act: (rollupId: string) => Promise<boolean>) => {
    for (const row of selected) await act(row._id);
    await load();
  };

  const none = selected.length === 0;
  const filtered = query.search !== '';
  return (
    <ContentPanel
      title={`Rollup jobs (${rollups.length})`}
      actions={
        <>
          <Button size="s" icon="refresh" onClick={() => void load()} testId="refreshButton">
            Refresh
          </Button>
          <Button size="s" disabled={none} onClick={() => void each((id) => switchRollup(id, false))} testId="disableButton">
            Disable
          </Button>
          <Button size="s" disabled={none} onClick={() => void each((id) => switchRollup(id, true))} testId="enableButton">
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
                onClick: () => go(ROUTES.EDIT_ROLLUP, { id: selected[0]._id }),
              },
              { id: 'delete', label: 'Delete', testId: 'deleteButton', danger: true, disabled: none, onClick: () => setDeleting(true) },
            ]}
          />
          <Button variant="primary" size="s" icon="plus" onClick={() => go(ROUTES.CREATE_ROLLUP)} testId="createRollupButton">
            Create rollup job
          </Button>
        </>
      }
    >
      <SearchRow search={query.search} onSearch={(search) => setQuery({ search, from: 0 })} />
      <Table
        columns={COLUMNS}
        rows={rollups}
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
                <Button variant="primary" size="s" onClick={() => setQuery({ search: '' })} testId="rollupEmptyPromptRestFilters">
                  Reset Filters
                </Button>
              ) : (
                <Button
                  variant="primary"
                  size="s"
                  icon="plus"
                  onClick={() => go(ROUTES.CREATE_ROLLUP)}
                  testId="emptyPromptCreateRollupButton"
                >
                  Create rollup job
                </Button>
              ))}
          </div>
        }
      />
      {deleting && (
        <DeleteRollupModal
          rollupId={selected.map((row) => row._id).join(', ')}
          onClose={() => setDeleting(false)}
          onDelete={async () => {
            setDeleting(false);
            await each(deleteRollup);
          }}
        />
      )}
    </ContentPanel>
  );
}

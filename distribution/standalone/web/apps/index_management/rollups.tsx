/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Rollup jobs: the list of them, with what each is doing, as the plugin draws it: the title and
 * its buttons in one row, the search box, a line, and a table laid out on what its cells hold.
 */

import { useState, type ReactNode } from 'react';
import { Button } from '../../components/basic';
import { Icon } from '../../components/icon';
import { useBreadcrumbs } from '../../shell/state';
import { Table, go, ism, renderTime, to, toasts, useListQuery, type TableColumn } from './common';
import { DeleteJobsModal, JobActionsMenu, JobsPanel, ListEmptyPrompt, ListSearch, Rule, useListLoad } from './job_parts';
import { stillListed } from './policy_model';
import { rollupStatus, rollupWindow, type JobStatus, type RollupDocument, type RollupMetadata } from './rollup_model';
import { CRUMBS, ROUTES } from './routes';

export interface RollupRow extends RollupDocument {
  metadata?: RollupMetadata | null;
}

/**
 * What a job is doing, as the plugin writes it: a small icon in the colour of its state and the
 * state in the smallest text, 4 px apart, or a dash
 */
export function JobStatusText({ status }: { status: JobStatus | undefined }) {
  if (!status) return <>-</>;
  return (
    <span className={`ismJobStatus ismJobStatus--${status.tone}`}>
      <Icon name={status.icon} />
      <span className="ismJobStatus__text">{status.text}</span>
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
    <DeleteJobsModal onClose={onClose} onDelete={onDelete}>
      By deleting &quot;<strong>{rollupId}</strong>&quot;, all future scheduled rollup execution will be canceled.
      However, your target index will remain as it is.
    </DeleteJobsModal>
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

// The plugin's `truncateText`: on one line, which the table makes room for
const oneLine = (value: ReactNode) => <div className="atlTruncate">{value}</div>;

const COLUMNS: Array<TableColumn<RollupRow>> = [
  {
    field: '_id',
    name: 'Name',
    sortable: true,
    render: (row) =>
      oneLine(
        <button
          type="button"
          className="atlLinkButton ismTableLink"
          onClick={() => go(ROUTES.ROLLUP_DETAILS, { id: row._id })}
          data-test-subj={`rollupLink_${row._id}`}
        >
          {row._id}
        </button>
      ),
  },
  { field: 'rollup.source_index', name: 'Source index', sortable: true, render: (row) => oneLine(row.rollup.source_index) },
  { field: 'rollup.target_index', name: 'Target index', sortable: true, render: (row) => oneLine(row.rollup.target_index) },
  {
    field: 'rollup.enabled',
    name: 'Job state',
    sortable: true,
    render: (row) => oneLine(row.rollup.enabled ? 'Enabled' : 'Disabled'),
  },
  {
    field: 'rollup.continuous',
    name: 'Continuous',
    sortable: true,
    render: (row) => oneLine(row.rollup.continuous ? 'Yes' : 'No'),
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
      const listed = answer.response.rollups;
      setRollups(listed);
      setTotal(answer.response.totalRollups ?? 0);
      setSelected((ticked) => stillListed(ticked, listed, (row) => row._id));
    } else {
      toasts.danger(answer.error || 'There was a problem loading the rollups');
    }
    setLoading(false);
  };
  const reload = useListLoad(load, [query.from, query.size, query.search, query.sortField, query.sortDirection]);

  // One job after the other, as the plugin does, and the list again when all are done
  const each = async (act: (rollupId: string) => Promise<boolean>) => {
    for (const row of selected) await act(row._id);
    reload();
  };
  // As the plugin's, the dialog closes once a job is deleted, and stays open while none is
  const remove = async () => {
    for (const row of selected) if (await deleteRollup(row._id)) setDeleting(false);
    reload();
  };

  const none = selected.length === 0;
  const filtered = query.search !== '';
  return (
    <JobsPanel
      title={`Rollup jobs (${rollups.length})`}
      actions={
        <>
          <Button icon="refresh" onClick={reload} testId="refreshButton">
            Refresh
          </Button>
          <Button disabled={none} onClick={() => void each((id) => switchRollup(id, false))} testId="disableButton">
            Disable
          </Button>
          <Button disabled={none} onClick={() => void each((id) => switchRollup(id, true))} testId="enableButton">
            Enable
          </Button>
          <JobActionsMenu
            disabled={none}
            items={[
              {
                id: 'edit',
                icon: 'empty',
                label: 'Edit',
                testId: 'editButton',
                disabled: selected.length !== 1,
                onClick: () => go(ROUTES.EDIT_ROLLUP, { id: selected[0]._id }),
              },
              {
                id: 'delete',
                icon: 'empty',
                label: 'Delete',
                testId: 'deleteButton',
                danger: true,
                disabled: none,
                onClick: () => setDeleting(true),
              },
            ]}
          />
          <Button variant="primary" icon="plus" onClick={() => go(ROUTES.CREATE_ROLLUP)} testId="createRollupButton">
            Create rollup job
          </Button>
        </>
      }
    >
      <ListSearch search={query.search} onSearch={(search) => setQuery({ search, from: 0 })} ariaLabel={null} />
      <Rule />
      <div className="ismJobsTable">
        <Table
          columns={COLUMNS}
          rows={rollups}
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
                  <Button variant="primary" onClick={() => setQuery({ search: '' })} testId="rollupEmptyPromptRestFilters">
                    Reset Filters
                  </Button>
                ) : (
                  <Button variant="primary" icon="plus" to={to(ROUTES.CREATE_ROLLUP)} testId="emptyPromptCreateRollupButton">
                    Create rollup job
                  </Button>
                )
              }
            />
          }
        />
      </div>
      {deleting && (
        <DeleteRollupModal
          rollupId={selected.map((row) => row._id).join(', ')}
          onClose={() => setDeleting(false)}
          onDelete={remove}
        />
      )}
    </JobsPanel>
  );
}

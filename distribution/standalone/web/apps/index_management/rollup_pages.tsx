/* SPDX-License-Identifier: Apache-2.0 */

/* The page that shows one rollup job and what it is doing, and the page that changes its schedule. */

import { useEffect, useState } from 'react';
import { Button, Health } from '../../components/basic';
import { useLocation } from '../../router';
import { useBreadcrumbs } from '../../shell/state';
import { Detail, Details, JSONModal, go, ism, renderTime, toasts } from './common';
import { AggregationTables, ConfigureRollup, Schedule } from './create_rollup';
import { FormPanel } from './job_parts';
import {
  INTERVAL_REQUIRED,
  editOf,
  editedRollup,
  histogramIntervalText,
  parseDimensions,
  parseMetrics,
  rollupStatus,
  scheduleText,
  type RollupDocument,
  type RollupEdit,
  type RollupMetadata,
} from './rollup_model';
import { DeleteRollupModal, JobStatusText, deleteRollup, switchRollup, windowText } from './rollups';
import { CRUMBS, ROUTES } from './routes';

const loadRollup = (id: string) => ism.get<RollupDocument>(`rollups/${encodeURIComponent(id)}`);

// --- One job ---------------------------------------------------------------------------------------

export function RollupDetails() {
  const { hashParams } = useLocation();
  const id = hashParams.id;
  useBreadcrumbs(
    id === undefined ? [CRUMBS.INDEX_MANAGEMENT, CRUMBS.ROLLUPS] : [CRUMBS.INDEX_MANAGEMENT, CRUMBS.ROLLUPS, { text: id }]
  );
  const [job, setJob] = useState<RollupDocument>();
  const [dialog, setDialog] = useState<'json' | 'delete'>();

  const load = async (rollupId: string) => {
    const answer = await loadRollup(rollupId);
    if (answer.ok && answer.response) {
      setJob(answer.response);
    } else {
      toasts.danger(`Could not load the rollup job: ${answer.error}`);
      go(ROUTES.ROLLUPS);
    }
  };
  useEffect(() => {
    if (id === undefined) {
      toasts.danger(`Invalid rollup id: ${id}`);
      go(ROUTES.ROLLUPS);
      return;
    }
    void load(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const rollup = job?.rollup;
  const rollupId = job?._id ?? '';
  const enabled = rollup?.enabled ?? false;
  const lastUpdated = rollup ? renderTime(rollup.last_updated_time) : '-';
  const metadata = (job?.metadata as Record<string, RollupMetadata> | null | undefined)?.[rollupId];
  const stats = metadata?.rollup_metadata?.stats;
  const stat = (name: string) => (metadata?.rollup_metadata == null ? '-' : stats?.[name]);
  const histogram = rollup?.dimensions[0]?.date_histogram;
  const close = () => setDialog(undefined);

  const turn = async (on: boolean) => {
    if (await switchRollup(rollupId, on)) await load(rollupId);
  };

  return (
    <div className="ismPage ismPage--form">
      <header className="ismPageHeader ismPageHeader--center">
        <h1 className="ismPageTitle">{rollupId}</h1>
        <div className="atlGrow">
          {enabled ? (
            <Health tone="healthy">Enabled on {lastUpdated}</Health>
          ) : (
            <Health tone="critical">Disabled</Health>
          )}
        </div>
        <div className="ismPanel__actions">
          <Button size="s" disabled={!enabled} onClick={() => void turn(false)} testId="disableButton">
            Disable
          </Button>
          <Button size="s" disabled={enabled} onClick={() => void turn(true)} testId="enableButton">
            Enable
          </Button>
          <Button size="s" onClick={() => setDialog('json')}>
            View JSON
          </Button>
          <Button size="s" variant="danger" onClick={() => setDialog('delete')} testId="deleteButton">
            Delete
          </Button>
        </div>
      </header>

      <FormPanel
        title="General information"
        actions={
          <Button size="s" onClick={() => rollupId && go(ROUTES.EDIT_ROLLUP, { id: rollupId })} testId="EditButton">
            Edit
          </Button>
        }
      >
        <Details columns={4}>
          <Detail name="Name">{rollupId}</Detail>
          <Detail name="Source index">{rollup?.source_index}</Detail>
          <Detail name="Target index">{rollup?.target_index}</Detail>
          <Detail name="Schedule">{rollup ? scheduleText(rollup) : ''}</Detail>
          <Detail name="Description">{rollup?.description || '-'}</Detail>
          <Detail name="Last updated">{lastUpdated}</Detail>
          <Detail name="Pages per execution">{rollup ? rollup.page_size : 1000}</Detail>
        </Details>
      </FormPanel>

      <FormPanel title="Rollup status">
        <Details columns={4}>
          <Detail name="Current rollup window">{windowText(metadata)}</Detail>
          <Detail name="Status">
            <JobStatusText status={rollupStatus(metadata)} />
          </Detail>
          <Detail name="Rollup indexed">{stat('rollups_indexed')}</Detail>
          <Detail name="Indexed time (ms)">{stat('index_time_in_millis')}</Detail>
          <Detail name="Document processed">{stat('documents_processed')}</Detail>
          <Detail name="Search time (ms)">{stat('search_time_in_millis')}</Detail>
          <Detail name="Page processed">{stat('pages_processed')}</Detail>
        </Details>
      </FormPanel>

      <FormPanel title="Aggregation and metrics settings">
        {/* The plugin gives the time aggregation this title */}
        <h3 className="ismRow__title">Additional metrics</h3>
        <div className="ismSmallDetails">
          <Details columns={3}>
            <Detail name="Timestamp field">{histogram?.source_field}</Detail>
            <Detail name="Interval">
              {histogramIntervalText(histogram?.fixed_interval ? histogram.fixed_interval : histogram?.calendar_interval)}
            </Detail>
            <Detail name="Timezone">{rollup ? histogram?.timezone : 'UTC +0'}</Detail>
          </Details>
        </div>
        <AggregationTables
          dimensions={rollup ? parseDimensions(rollup.dimensions) : []}
          metrics={rollup ? parseMetrics(rollup.metrics) : []}
        />
      </FormPanel>

      {dialog === 'json' && job && <JSONModal title={`View JSON of ${rollupId}`} json={job} onClose={close} />}
      {dialog === 'delete' && (
        <DeleteRollupModal
          rollupId={rollupId}
          onClose={close}
          onDelete={async () => {
            if (await deleteRollup(rollupId)) {
              close();
              go(ROUTES.ROLLUPS);
            }
          }}
        />
      )}
    </div>
  );
}

// --- Changing a job --------------------------------------------------------------------------------

export function EditRollup() {
  const { hashParams } = useLocation();
  const id = hashParams.id ?? '';
  useBreadcrumbs([CRUMBS.INDEX_MANAGEMENT, CRUMBS.ROLLUPS, CRUMBS.EDIT_ROLLUP, { text: id }]);
  const [job, setJob] = useState<RollupDocument>();
  const [edit, setEdit] = useState<RollupEdit>({
    description: '',
    continuousDefinition: 'fixed',
    interval: 2,
    intervalTimeunit: 'MINUTES',
    cronExpression: '',
    cronTimezone: 'UTC',
    pageSize: 1000,
    delayTime: undefined,
    delayTimeunit: 'MINUTES',
  });
  const [intervalError, setIntervalError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const change = (changes: Partial<RollupEdit>) => setEdit((before) => ({ ...before, ...changes }));

  useEffect(() => {
    if (!id) {
      toasts.danger(`Invalid rollup id: ${id}`);
      go(ROUTES.ROLLUPS);
      return;
    }
    void loadRollup(id).then((answer) => {
      if (answer.ok && answer.response) {
        setJob(answer.response);
        setEdit(editOf(answer.response.rollup));
      } else {
        toasts.danger(`Could not load the rollup job: ${answer.error}`);
        go(ROUTES.ROLLUPS);
      }
    });
  }, [id]);

  const submit = async () => {
    if (!job || job._seqNo == null || job._primaryTerm == null) {
      toasts.danger('Could not update rollup without seqNo and primaryTerm');
      return;
    }
    setBusy(true);
    const answer = await ism.put<{ _id: string }>(
      `rollups/${encodeURIComponent(job._id)}`,
      editedRollup(job.rollup, edit, Math.floor(Date.now() / 1000)),
      { seqNo: job._seqNo, primaryTerm: job._primaryTerm }
    );
    setBusy(false);
    if (answer.ok && answer.response) {
      toasts.success(`Changes to "${answer.response._id}" saved!`);
      go(ROUTES.ROLLUPS);
    } else {
      toasts.danger(answer.error);
    }
  };

  return (
    <div className="ismPage ismPage--form ismPage--edit">
      <h1 className="ismPageTitle">Edit rollup job</h1>
      <ConfigureRollup
        isEdit
        rollupId={job?._id ?? ''}
        description={edit.description}
        onChangeDescription={(description) => change({ description })}
      />
      <Schedule
        isEdit
        values={{ ...edit, enabled: job?.rollup.enabled ?? false, continuous: job?.rollup.continuous ?? false }}
        intervalError={intervalError}
        change={change}
        onChangeInterval={(interval) => {
          change({ interval });
          setIntervalError(interval === undefined ? INTERVAL_REQUIRED : undefined);
        }}
      />
      <div className="ismButtons">
        <Button variant="empty" size="s" onClick={() => go(ROUTES.ROLLUPS)} testId="editRollupCancelButton">
          Cancel
        </Button>
        <Button variant="primary" size="s" loading={busy} onClick={() => void submit()} testId="editRollupSaveChangesButton">
          Save changes
        </Button>
      </div>
    </div>
  );
}

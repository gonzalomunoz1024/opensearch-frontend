/* SPDX-License-Identifier: Apache-2.0 */

/* The page that shows one rollup job and what it is doing, and the page that changes its schedule. */

import { useEffect, useState } from 'react';
import { Button, Health } from '../../components/basic';
import { useLocation } from '../../router';
import { useBreadcrumbs } from '../../shell/state';
import { go, ism, renderTime, toasts } from './common';
import { AggregationTables, ConfigureRollup, Schedule } from './create_rollup';
import { InfoGrid, JobDetailsHeader, JobDetailsPage, JobJsonModal, Spacer, TitledPanel } from './job_parts';
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

  const status = rollupStatus(metadata);
  return (
    <JobDetailsPage>
      <JobDetailsHeader
        title={rollupId}
        health={
          enabled ? <Health tone="healthy">Enabled on {lastUpdated}</Health> : <Health tone="critical">Disabled</Health>
        }
        actions={
          <>
            <Button disabled={!enabled} onClick={() => void turn(false)} testId="disableButton">
              Disable
            </Button>
            <Button disabled={enabled} onClick={() => void turn(true)} testId="enableButton">
              Enable
            </Button>
            <Button onClick={() => setDialog('json')}>View JSON</Button>
            <Button variant="danger" onClick={() => setDialog('delete')} testId="deleteButton">
              Delete
            </Button>
          </>
        }
      />

      <TitledPanel
        title="General information"
        itemTitle
        actions={
          <Button onClick={() => rollupId && go(ROUTES.EDIT_ROLLUP, { id: rollupId })} testId="EditButton">
            Edit
          </Button>
        }
      >
        <InfoGrid
          items={[
            { term: 'Name', value: rollupId },
            { term: 'Source index', value: rollup?.source_index ?? '' },
            { term: 'Target index', value: rollup?.target_index ?? '' },
            { term: 'Schedule', value: rollup ? scheduleText(rollup) : '' },
            { term: 'Description', value: rollup?.description || '-' },
            { term: 'Last updated', value: lastUpdated },
            { term: 'Pages per execution', value: rollup ? rollup.page_size : 1000 },
          ]}
        />
        <Spacer size="s" />
      </TitledPanel>
      <Spacer />

      <TitledPanel title="Rollup status" itemTitle>
        <InfoGrid
          items={[
            { term: 'Current rollup window', value: windowText(metadata) },
            // As the plugin's, a job without a status has a dash under the term
            { term: 'Status', value: status ? <JobStatusText status={status} /> : <dd>-</dd>, bare: true },
            { term: 'Rollup indexed', value: stat('rollups_indexed') },
            { term: 'Indexed time (ms)', value: stat('index_time_in_millis') },
            { term: 'Document processed', value: stat('documents_processed') },
            { term: 'Search time (ms)', value: stat('search_time_in_millis') },
            { term: 'Page processed', value: stat('pages_processed') },
          ]}
        />
        <Spacer size="s" />
      </TitledPanel>
      <Spacer />

      <TitledPanel title="Aggregation and metrics settings" itemTitle>
        {/* The plugin gives the time aggregation this title */}
        <h3 className="atlTitleS">Additional metrics</h3>
        <InfoGrid
          columns={3}
          size="xs"
          items={[
            { term: 'Timestamp field', value: histogram?.source_field ?? '' },
            {
              term: 'Interval',
              value: histogramIntervalText(histogram?.fixed_interval ? histogram.fixed_interval : histogram?.calendar_interval),
            },
            { term: 'Timezone', value: rollup ? histogram?.timezone : 'UTC +0' },
          ]}
        />
        <Spacer size="s" />
        <AggregationTables
          dimensions={rollup ? parseDimensions(rollup.dimensions) : []}
          metrics={rollup ? parseMetrics(rollup.metrics) : []}
        />
        <Spacer size="s" />
      </TitledPanel>
      <Spacer />

      {dialog === 'json' && job && <JobJsonModal title={`View JSON of ${rollupId}`} json={job} onClose={close} />}
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
    </JobDetailsPage>
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

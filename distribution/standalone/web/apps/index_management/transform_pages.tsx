/* SPDX-License-Identifier: Apache-2.0 */

/* The page that shows one transform job and what it is doing, and the page that changes its schedule. */

import { useEffect, useState } from 'react';
import { Button } from '../../components/basic';
import { useLocation } from '../../router';
import { useBreadcrumbs } from '../../shell/state';
import { JsonEditor, go, ism, toasts } from './common';
import {
  ConfigureTransform,
  Definitions,
  PreviewTransform,
  TransformSchedule,
  previewTransform,
} from './create_transform';
import {
  Fold,
  InfoGrid,
  JobActionsMenu,
  JobDetailsHeader,
  JobDetailsPage,
  JobEditPage,
  JobJsonModal,
  Spacer,
  TitledPanel,
} from './job_parts';
import { INTERVAL_REQUIRED, intervalScheduleText } from './rollup_model';
import { CRUMBS, ROUTES } from './routes';
import {
  editedTransform,
  settingsItems,
  transformEditOf,
  transformStatus,
  type TransformDocument,
  type TransformEdit,
  type TransformMetadata,
} from './transform_model';
import { DeleteTransformModal, TransformStatusText, deleteTransform, switchTransform } from './transforms';

const loadTransform = (id: string) => ism.get<TransformDocument>(`transforms/${encodeURIComponent(id)}`);

// --- One job ---------------------------------------------------------------------------------------

export function TransformDetails() {
  const { hashParams } = useLocation();
  const id = hashParams.id;
  useBreadcrumbs(
    id === undefined ? [CRUMBS.INDEX_MANAGEMENT, CRUMBS.TRANSFORMS] : [CRUMBS.INDEX_MANAGEMENT, CRUMBS.TRANSFORMS, { text: id }]
  );
  const [job, setJob] = useState<TransformDocument>();
  const [documents, setDocuments] = useState<Array<Record<string, unknown>>>([]);
  const [dialog, setDialog] = useState<'json' | 'delete'>();

  const load = async (transformId: string) => {
    const answer = await loadTransform(transformId);
    if (answer.ok && answer.response) {
      setJob(answer.response);
    } else {
      toasts.danger(`Could not load transform job ${transformId}: ${answer.error}`);
      go(ROUTES.TRANSFORMS);
    }
  };
  useEffect(() => {
    if (id === undefined) {
      toasts.danger(`Invalid transform id: ${id}`);
      go(ROUTES.TRANSFORMS);
      return;
    }
    void load(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const transform = job?.transform;
  const transformId = job?._id ?? '';
  const enabled = transform?.enabled ?? false;
  const metadata = (job?.metadata as Record<string, TransformMetadata> | null | undefined)?.[transformId];
  const stats = metadata?.transform_metadata?.stats;
  const stat = (name: string) => (metadata?.transform_metadata == null ? '-' : stats?.[name]);
  const interval = transform?.schedule?.interval;
  const close = () => setDialog(undefined);

  const turn = async (on: boolean) => {
    if (await switchTransform(transformId, on, on ? 'enable' : 'disable')) await load(transformId);
  };
  const preview = async () => {
    if (documents.length > 0 || !transform) return;
    const found = await previewTransform({ transform });
    if (found) setDocuments(found);
  };

  const blank = { term: '', value: '' };
  return (
    <JobDetailsPage>
      <JobDetailsHeader
        title={transformId}
        actions={
          <JobActionsMenu
            plain
            items={[
              { id: 'enable', icon: 'empty', label: 'Enable job', testId: 'enableButton', disabled: enabled, onClick: () => void turn(true) },
              { id: 'disable', icon: 'empty', label: 'Disable job', testId: 'disableButton', disabled: !enabled, onClick: () => void turn(false) },
              { id: 'view', icon: 'empty', label: 'View JSON', testId: 'viewButton', onClick: () => setDialog('json') },
              { id: 'delete', icon: 'empty', label: 'Delete', testId: 'deleteButton', danger: true, onClick: () => setDialog('delete') },
            ]}
          />
        }
      />

      <TitledPanel
        title="General information"
        itemTitle
        actions={
          <Button onClick={() => transformId && go(ROUTES.EDIT_TRANSFORM, { id: transformId })} testId="EditButton">
            Edit
          </Button>
        }
      >
        <Spacer size="s" />
        {/* The plugin leaves places of its grid empty: the third row has only its first and last */}
        <InfoGrid
          size="xs"
          items={[
            { term: 'Name', value: transformId },
            // The plugin says "Enabled on" of every job, and gives the time of its last change
            { term: 'State', value: `Enabled on ${new Date(transform?.updated_at ?? 1).toLocaleString()}` },
            { term: 'Source index', value: transform?.source_index ?? '' },
            {
              term: 'Schedule',
              value: transform ? intervalScheduleText(Boolean(transform.continuous), interval?.period ?? 2, interval?.unit ?? '') : '',
            },
            { term: 'Description', value: transform?.description || '-' },
            blank,
            { term: 'Source index filter', value: transform ? JSON.stringify(transform.data_selection_query) : '' },
            { term: 'Pages per execution', value: transform ? transform.page_size : 1000 },
            blank,
            blank,
            { term: 'Target index', value: transform?.target_index ?? '' },
          ]}
        />
        <Spacer size="s" />
      </TitledPanel>
      <Spacer />

      <TitledPanel title="Transform Status" itemTitle>
        <Spacer size="s" />
        <InfoGrid
          size="xs"
          items={[
            // As the plugin's, what a job is doing stands under the term as it is
            {
              term: 'Status',
              value: transformStatus(metadata) ? <TransformStatusText metadata={metadata} /> : <dd>-</dd>,
              bare: true,
            },
            { term: 'Documents indexed', value: stat('documents_indexed') },
            { term: 'Document processed', value: stat('documents_processed') },
            { term: 'Indexed time (ms)', value: stat('index_time_in_millis') },
            { term: '', value: '', bare: true },
            { term: '', value: '', bare: true },
            { term: 'Page processed', value: stat('pages_processed') },
            { term: 'Search time (ms)', value: stat('search_time_in_millis') },
          ]}
        />
        <Spacer size="s" />
      </TitledPanel>
      <Spacer />

      <TitledPanel title="Transform Settings" itemTitle>
        <Spacer size="m" />
        <Definitions items={transform ? settingsItems(transform) : []} />
        <Spacer size="m" />
        <Fold title="Sample source index and transform result" onOpen={() => void preview()}>
          <div className="ismAcc__body">
            <Spacer size="m" />
            <h5 className="ismPreviewTitle">Preview result based on sample data</h5>
            <PreviewTransform documents={documents} aggList={[]} isReadOnly />
          </div>
        </Fold>
      </TitledPanel>

      {dialog === 'json' && job && <JobJsonModal small title={`View JSON of ${transformId}`} json={job} onClose={close} />}
      {dialog === 'delete' && (
        <DeleteTransformModal
          transformId={transformId}
          onClose={close}
          onDelete={async () => {
            if (await deleteTransform(transformId)) {
              close();
              go(ROUTES.TRANSFORMS);
            }
          }}
        />
      )}
    </JobDetailsPage>
  );
}

// --- Changing a job --------------------------------------------------------------------------------

export function EditTransform() {
  const { hashParams } = useLocation();
  const id = hashParams.id ?? '';
  useBreadcrumbs([CRUMBS.INDEX_MANAGEMENT, CRUMBS.TRANSFORMS, CRUMBS.EDIT_TRANSFORM, { text: id }]);
  const [job, setJob] = useState<TransformDocument>();
  const [edit, setEdit] = useState<TransformEdit>({
    description: '',
    enabled: true,
    pageSize: 1000,
    interval: 2,
    intervalTimeunit: 'MINUTES',
  });
  const [intervalError, setIntervalError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const change = (changes: Partial<TransformEdit>) => setEdit((before) => ({ ...before, ...changes }));

  useEffect(() => {
    if (!id) {
      toasts.danger(`Invalid transform id: ${id}`);
      go(ROUTES.TRANSFORMS);
      return;
    }
    void loadTransform(id).then((answer) => {
      const opened = answer.ok && answer.response ? transformEditOf(answer.response.transform) : undefined;
      if (answer.ok && answer.response && opened) {
        setJob(answer.response);
        setEdit(opened);
      } else {
        // A job that runs by a cron expression cannot be opened here, in the plugin either
        toasts.danger(answer.ok ? `Could not load transform job ${id}` : `Could not load transform job ${id}: ${answer.error}`);
        go(ROUTES.TRANSFORMS);
      }
    });
  }, [id]);

  const submit = async () => {
    if (!job || job._seqNo == null || job._primaryTerm == null) {
      toasts.danger('Could not update transform without seqNo and primaryTerm');
      return;
    }
    setBusy(true);
    const answer = await ism.put(
      `transforms/${encodeURIComponent(job._id)}`,
      editedTransform(job.transform, edit, Math.floor(Date.now() / 1000)),
      { seqNo: job._seqNo, primaryTerm: job._primaryTerm }
    );
    setBusy(false);
    if (answer.ok) {
      toasts.success('Changes to transform saved');
      go(ROUTES.TRANSFORMS);
    } else {
      toasts.danger(`Couldn't update transform ${job._id}: ${answer.error}`);
    }
  };

  const transform = job?.transform;
  return (
    <JobEditPage title="Edit transform job">
      <ConfigureTransform
        isEdit
        transformId={job?._id ?? ''}
        description={edit.description}
        onChangeDescription={(description) => change({ description })}
      />
      <Spacer />
      <TitledPanel title="Indices" itemTitle>
        <div className="ismPlainRow">
          <h3 className="ismPr__title">Source index</h3>
          <p>{transform?.source_index}</p>
        </div>
        <Spacer size="m" />
        <div className="ismPlainRow">
          <h3 className="ismPr__title">Source index filter</h3>
          <div style={{ width: 400 }}>
            <JsonEditor value={transform ? (JSON.stringify(transform.data_selection_query) ?? '') : ''} height={100} readOnly />
          </div>
        </div>
        <Spacer size="m" />
        <div className="ismPlainRow">
          <h3 className="ismPr__title">Target index</h3>
          <p>{transform?.target_index}</p>
        </div>
      </TitledPanel>
      <Spacer />
      <TransformSchedule
        isEdit
        values={edit}
        intervalError={intervalError}
        change={change}
        onChangeInterval={(interval) => {
          change({ interval });
          setIntervalError(interval === undefined ? INTERVAL_REQUIRED : undefined);
        }}
      />
      <Spacer />
      <div className="ismJobEdit__buttons">
        <Button variant="empty" onClick={() => go(ROUTES.TRANSFORMS)} testId="editTransformCancelButton">
          Cancel
        </Button>
        <Button variant="primary" loading={busy} onClick={() => void submit()} testId="editTransformSaveButton">
          Save changes
        </Button>
      </div>
    </JobEditPage>
  );
}

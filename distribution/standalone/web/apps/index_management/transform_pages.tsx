/* SPDX-License-Identifier: Apache-2.0 */

/* The page that shows one transform job and what it is doing, and the page that changes its schedule. */

import { useEffect, useState } from 'react';
import { Accordion, Button } from '../../components/basic';
import { useLocation } from '../../router';
import { useBreadcrumbs } from '../../shell/state';
import { ActionsMenu, Detail, Details, JSONModal, JsonEditor, go, ism, toasts } from './common';
import {
  ConfigureTransform,
  Definitions,
  PreviewTransform,
  TransformSchedule,
  previewTransform,
} from './create_transform';
import { FormPanel } from './job_parts';
import { INTERVAL_REQUIRED, intervalScheduleText } from './rollup_model';
import { CRUMBS, ROUTES } from './routes';
import {
  editedTransform,
  settingsItems,
  transformEditOf,
  type TransformDocument,
  type TransformEdit,
  type TransformMetadata,
} from './transform_model';
import { DeleteTransformModal, TransformStatusText, deleteTransform, switchTransform } from './transforms';

const loadTransform = (id: string) => ism.get<TransformDocument>(`transforms/${encodeURIComponent(id)}`);

// --- One job ---------------------------------------------------------------------------------------

/** Asks for the look at the result the first time it is opened */
function PreviewOnOpen({ onOpen }: { onOpen: () => void }) {
  useEffect(() => {
    onOpen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

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

  return (
    <div className="ismPage ismPage--form">
      <header className="ismPageHeader ismPageHeader--center">
        <h1 className="ismPageTitle">{transformId}</h1>
        <ActionsMenu
          testId="actionButton"
          items={[
            { id: 'enable', label: 'Enable job', testId: 'enableButton', disabled: enabled, onClick: () => void turn(true) },
            { id: 'disable', label: 'Disable job', testId: 'disableButton', disabled: !enabled, onClick: () => void turn(false) },
            { id: 'view', label: 'View JSON', testId: 'viewButton', onClick: () => setDialog('json') },
            { id: 'delete', label: 'Delete', testId: 'deleteButton', danger: true, onClick: () => setDialog('delete') },
          ]}
        />
      </header>

      <FormPanel
        title="General information"
        actions={
          <Button size="s" onClick={() => transformId && go(ROUTES.EDIT_TRANSFORM, { id: transformId })}>
            Edit
          </Button>
        }
      >
        <div className="ismSmallDetails">
          <Details columns={4}>
            <Detail name="Name">{transformId}</Detail>
            {/* The plugin says "Enabled on" of every job, and gives the time of its last change */}
            <Detail name="State">Enabled on {new Date(transform?.updated_at ?? 1).toLocaleString()}</Detail>
            <Detail name="Source index">{transform?.source_index}</Detail>
            <Detail name="Schedule">
              {transform ? intervalScheduleText(Boolean(transform.continuous), interval?.period ?? 2, interval?.unit ?? '') : ''}
            </Detail>
            <Detail name="Description">{transform?.description || '-'}</Detail>
            <div />
            <Detail name="Source index filter">{transform ? JSON.stringify(transform.data_selection_query) : ''}</Detail>
            <Detail name="Pages per execution">{transform ? transform.page_size : 1000}</Detail>
            <div />
            <div />
            <Detail name="Target index">{transform?.target_index}</Detail>
          </Details>
        </div>
      </FormPanel>

      <FormPanel title="Transform Status">
        <div className="ismSmallDetails">
          <Details columns={4}>
            <Detail name="Status">
              <TransformStatusText metadata={metadata} />
            </Detail>
            <Detail name="Documents indexed">{stat('documents_indexed')}</Detail>
            <Detail name="Document processed">{stat('documents_processed')}</Detail>
            <Detail name="Indexed time (ms)">{stat('index_time_in_millis')}</Detail>
            <div />
            <div />
            <Detail name="Page processed">{stat('pages_processed')}</Detail>
            <Detail name="Search time (ms)">{stat('search_time_in_millis')}</Detail>
          </Details>
        </div>
      </FormPanel>

      <FormPanel title="Transform Settings">
        <Definitions items={transform ? settingsItems(transform) : []} />
        <Accordion title="Sample source index and transform result" initiallyOpen={false}>
          <div className="ismAccordionBody">
            <PreviewOnOpen onOpen={() => void preview()} />
            <h5 className="ismPreviewTitle">Preview result based on sample data</h5>
            <PreviewTransform documents={documents} aggList={[]} isReadOnly />
          </div>
        </Accordion>
      </FormPanel>

      {dialog === 'json' && job && <JSONModal title={`View JSON of ${transformId}`} json={job} onClose={close} />}
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
    </div>
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
    <div className="ismPage ismPage--form ismPage--edit">
      <h1 className="ismPageTitle">Edit transform job</h1>
      <ConfigureTransform
        isEdit
        transformId={job?._id ?? ''}
        description={edit.description}
        onChangeDescription={(description) => change({ description })}
      />
      <FormPanel title="Indices">
        <div className="ismRow">
          <h3 className="ismRow__title">Source index</h3>
          <p className="ismPlain">{transform?.source_index}</p>
        </div>
        <div className="ismRow">
          <h3 className="ismRow__title">Source index filter</h3>
          <div style={{ width: 400 }}>
            <JsonEditor value={transform ? (JSON.stringify(transform.data_selection_query) ?? '') : ''} height={100} readOnly />
          </div>
        </div>
        <div className="ismRow">
          <h3 className="ismRow__title">Target index</h3>
          <p className="ismPlain">{transform?.target_index}</p>
        </div>
      </FormPanel>
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
      <div className="ismButtons">
        <Button variant="empty" size="s" onClick={() => go(ROUTES.TRANSFORMS)} testId="editTransformCancelButton">
          Cancel
        </Button>
        <Button variant="primary" size="s" loading={busy} onClick={() => void submit()} testId="editTransformSaveButton">
          Save changes
        </Button>
      </div>
    </div>
  );
}

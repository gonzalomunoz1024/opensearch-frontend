/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Snapshots: the list of them over every repository, the flyouts that show one, take one and
 * restore one, and the tab that tells how far a restore has come.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Accordion, Button, CallOut, CodeBlock, Health, Tabs } from '../../components/basic';
import { ComboBox } from '../../components/combo_box';
import { Checkbox, FormRow, RadioGroup, TextArea, TextField } from '../../components/form';
import { Icon } from '../../components/icon';
import { Flyout, Modal } from '../../components/overlay';
import { searchItems } from '../../lib/search_syntax';
import { services } from '../../services';
import { useBreadcrumbs } from '../../shell/state';
import {
  ExternalLink,
  LocalTable,
  SearchRow,
  go,
  ism,
  renderTime,
  to,
  toasts,
  type TableColumn,
} from './common';
import { InfoModal } from './indices';
import { CRUMBS, ROUTES } from './routes';
import { SMALL_PAGE_SIZES } from './repositories';
import {
  RESTORE_CONFLICT_TEXT,
  RESTORE_CONFLICT_TITLE,
  RESTORE_DONE,
  RESTORE_FIELDS_ERROR,
  SNAPSHOT_NAME_HELP,
  capitalize,
  distinct,
  emptySnapshot,
  failedStage,
  failureSentence,
  fieldValues,
  hasRestoreErrors,
  indexCountText,
  newRestoreForm,
  notRestorable,
  restoreBody,
  restoreErrors,
  restoreFailureText,
  restoreProgress,
  restoreTime,
  restoredIndices,
  snapshotRowId,
  snapshotStatusText,
  snapshotStatusTone,
  stageTone,
  truncate,
  withFieldValues,
  type Recovery,
  type RenameOption,
  type RestoreErrors,
  type RestoreForm,
  type RestoreProgress,
  type SnapshotBody,
  type SnapshotRow,
} from './snapshot_model';
import {
  AdvancedSnapshotSettings,
  DeleteDialog,
  Facts,
  Field,
  FilterGroup,
  FlyoutFooter,
  GroupFilter,
  INDEX_SETTINGS_DOCS,
  IndicesRepositoryInput,
  ListPanel,
  REPOSITORY_REQUIRED,
  RESTORE_DOCS,
  Spacer,
  TickLabel,
  useRepositories,
  useSourceOptions,
} from './snapshot_parts';

/** A snapshot as OpenSearch describes it */
interface SnapshotDetail {
  snapshot: string;
  state?: string;
  start_time?: string;
  end_time?: string;
  indices?: string[];
  failures?: unknown;
  metadata?: { sm_policy?: string };
  include_global_state?: boolean;
  failed_shards?: number;
}

const snapshotPath = (id: string) => `_snapshots/${encodeURIComponent(id)}`;

const MORE = 'Open browser console & click below for details.';

/**
 * A request OpenSearch refused, as the plugin's addError: the first sentence of the reason and
 * where to look, kept as long as errors are, with the whole answer behind "See the full error".
 * The plugin's button throws, as it is given the answer's text and not an error.
 */
export function toastFailure(
  title: string,
  error: string | undefined,
  sentence = failureSentence(error)
) {
  return services.toasts.addError(new Error(error ?? ''), {
    title,
    toastMessage: `${sentence} ${MORE}`,
  });
}

// --- One snapshot ----------------------------------------------------------------------------------------

function SnapshotFlyout({
  snapshotId,
  repository,
  onClose,
}: {
  snapshotId: string;
  repository: string;
  onClose: () => void;
}) {
  const [snapshot, setSnapshot] = useState<SnapshotDetail>();
  const [failuresShown, setFailuresShown] = useState(false);
  useEffect(() => {
    let gone = false;
    void ism.get<SnapshotDetail>(snapshotPath(snapshotId), { repository }).then((answer) => {
      if (gone) return;
      if (answer.ok) setSnapshot(answer.response);
      else toasts.danger(answer.error || 'There was a problem loading the snapshot.');
    });
    return () => {
      gone = true;
    };
  }, [snapshotId, repository]);
  const policy = snapshot?.metadata?.sm_policy;
  return (
    <Flyout
      title={snapshot?.snapshot ?? ''}
      onClose={onClose}
      hideClose
      className="ismSnapshotFlyout"
      footer={
        <Button variant="empty" onClick={onClose}>
          Close
        </Button>
      }
    >
      <Facts
        columns={2}
        items={[
          ['Snapshot name', snapshot?.snapshot],
          ['Status', snapshot?.state],
        ]}
      />
      <Spacer size="m" />
      {snapshot?.failures !== undefined && snapshot.failures !== null && (
        <Facts
          columns={1}
          items={[
            [
              'Error details',
              <button
                key="failures"
                type="button"
                className="atlLinkButton"
                onClick={() => setFailuresShown(true)}
              >
                failures
              </button>,
            ],
          ]}
        />
      )}
      <Spacer size="m" />
      <Facts
        columns={2}
        items={[
          ['Start time', snapshot?.start_time],
          ['End time', snapshot?.end_time],
          ['Repository', repository],
          [
            'Policy',
            policy && (
              <a href={to(ROUTES.SNAPSHOT_POLICY_DETAILS, { id: policy }).replace(/^[^#]*/, '')}>
                {policy}
              </a>
            ),
          ],
        ]}
      />
      <Spacer />
      <Facts columns={1} items={[['Indices', snapshot?.indices?.join(', ')]]} />
      {failuresShown && (
        <InfoModal title=" " onClose={() => setFailuresShown(false)}>
          <CodeBlock>{JSON.stringify(snapshot?.failures, null, 4)}</CodeBlock>
        </InfoModal>
      )}
    </Flyout>
  );
}

// --- Taking a snapshot ------------------------------------------------------------------------------------

function CreateSnapshotFlyout({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (snapshotId: string, repository: string, body: SnapshotBody) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState('');
  const [indices, setIndices] = useState<string[]>([]);
  const [repository, setRepository] = useState('');
  const [repositoryError, setRepositoryError] = useState('');
  const [body, setBody] = useState<SnapshotBody>(emptySnapshot);
  const [busy, setBusy] = useState(false);
  const source = useSourceOptions();
  // The first repository is the one a snapshot goes to until another is chosen
  const { repositories } = useRepositories((found) =>
    setRepository(found.length > 0 ? found[0].id : '')
  );
  const here = useRef(true);
  useEffect(
    () => () => {
      here.current = false;
    },
    []
  );

  const add = async () => {
    if (!name.trim()) {
      setNameError('Required');
      return;
    }
    if (!repository) {
      setRepositoryError(REPOSITORY_REQUIRED);
      return;
    }
    setBusy(true);
    await onCreate(name, repository, { ...body, indices: indices.join(',') });
    if (here.current) setBusy(false);
  };

  return (
    <Flyout
      title="Create snapshot"
      onClose={onClose}
      hideClose
      className="ismSnapshotFlyout"
      footer={
        <FlyoutFooter action="Add" onCancel={onClose} onAction={() => void add()} busy={busy} />
      }
    >
      <div className="ismSnapshotForm">
        <Field title="Snapshot name" error={nameError}>
          <TextField
            value={name}
            onChange={setName}
            invalid={Boolean(nameError)}
            placeholder="Enter snapshot name"
            compact
            testId="snapshotNameInput"
          />
        </Field>
        <p className="ismSnapshotForm__help">{SNAPSHOT_NAME_HELP}</p>
        <Spacer size="m" />
        <IndicesRepositoryInput
          options={source.options}
          loading={source.loading}
          onSearch={source.onSearch}
          indices={indices}
          onIndices={setIndices}
          repositories={repositories}
          repository={repository}
          onRepository={(value) => {
            setRepository(value);
            setRepositoryError(value ? '' : REPOSITORY_REQUIRED);
          }}
          repositoryError={repositoryError}
        />
        <Spacer />
        <div className="ismSnapshotForm__accordion">
          <Accordion title={<h3 className="atlTitleS">Advanced options</h3>} initiallyOpen={false}>
            <Spacer size="m" />
            <AdvancedSnapshotSettings
              includeGlobalState={body.include_global_state}
              ignoreUnavailable={body.ignore_unavailable}
              partial={body.partial}
              onChange={(key, value) => setBody((before) => ({ ...before, [key]: value }))}
            />
          </Accordion>
        </div>
      </div>
    </Flyout>
  );
}

// --- Restoring a snapshot ---------------------------------------------------------------------------------

interface IndexRow {
  index: string;
  restore_status?: string;
}

const INDEX_COLUMNS: Array<TableColumn<IndexRow>> = [
  { field: 'index', name: 'Index', sortable: true, render: (row) => row.index },
];
const RESTORE_INDEX_COLUMNS: Array<TableColumn<IndexRow>> = [
  { field: 'index', name: 'Index', sortable: true, width: '75%', render: (row) => row.index },
  {
    field: 'restore_status',
    name: 'Restore status',
    sortable: true,
    width: '25%',
    render: (row) => row.restore_status,
  },
];

/** The indices of a snapshot or of a restore, in the place of what the flyout showed before */
function IndexList({
  title,
  snapshot,
  indices,
  columns,
  onBack,
}: {
  title: string;
  snapshot: string;
  indices: IndexRow[];
  columns: Array<TableColumn<IndexRow>>;
  onBack: () => void;
}) {
  const rows = indices.filter((row) => !row.index.startsWith('.kibana'));
  return (
    <Flyout
      title={
        <>
          <button type="button" className="ismIndexList__back" aria-label="Back" onClick={onBack}>
            <Icon name="chevronLeft" size="xl" />
          </button>{' '}
          {title} {snapshot} ({rows.length})
        </>
      }
      onClose={onBack}
      hideClose
      className="ismSnapshotFlyout"
    >
      <LocalTable
        columns={columns}
        rows={rows}
        rowId={(row) => row.index}
        pageSizes={SMALL_PAGE_SIZES}
        empty="No items found"
      />
    </Flyout>
  );
}

const PATTERN_HELP =
  'Define the format of renamed indices. Use $0 to include the entire matching index name, $1 to include the content of the first capture group, etc.';

const RENAME_OPTIONS: Array<{ id: RenameOption; label: string }> = [
  { id: 'do_not_rename', label: 'Do not rename' },
  { id: 'add_prefix', label: 'Add prefix to restored index names' },
  { id: 'rename_indices', label: 'Rename using regular expression (Advanced)' },
];

const NO_ERRORS: RestoreErrors = {
  badPattern: false,
  badRename: false,
  badJSON: false,
  badIgnore: false,
  noIndicesSelected: false,
};

function RestoreSnapshotFlyout({
  snapshotId,
  repository,
  onClose,
  onRestore,
}: {
  snapshotId: string;
  repository: string;
  onClose: () => void;
  onRestore: (body: Record<string, unknown>, indices: string[]) => void;
}) {
  const [snapshot, setSnapshot] = useState<SnapshotDetail>();
  const [form, setForm] = useState<RestoreForm>(() => newRestoreForm({}));
  const [errors, setErrors] = useState<RestoreErrors>(NO_ERRORS);
  const [customize, setCustomize] = useState(false);
  const [ignore, setIgnore] = useState(false);
  const [listed, setListed] = useState(false);
  const change = (changes: Partial<RestoreForm>) =>
    setForm((before) => ({ ...before, ...changes }));

  useEffect(() => {
    let gone = false;
    void ism.get<SnapshotDetail>(snapshotPath(snapshotId), { repository }).then((answer) => {
      if (gone) return;
      if (answer.ok && answer.response) {
        setSnapshot(answer.response);
        setForm(newRestoreForm(answer.response));
      } else {
        toastFailure('There was a problem getting the snapshot', answer.error);
      }
    });
    return () => {
      gone = true;
    };
  }, [snapshotId, repository]);

  const restore = () => {
    const found = restoreErrors(form);
    if (found.badIgnore) toasts.danger(RESTORE_CONFLICT_TITLE, RESTORE_CONFLICT_TEXT);
    else if (hasRestoreErrors(found)) toasts.danger(RESTORE_FIELDS_ERROR);
    setErrors(found);
    if (hasRestoreErrors(found)) return;
    onRestore(restoreBody(form), restoredIndices(form));
    onClose();
  };

  if (listed) {
    return (
      <>
        <div className="atlFlyoutMask" onMouseDown={onClose} />
        <IndexList
          title="Indices in snapshot"
          snapshot={snapshotId}
          indices={(snapshot?.indices ?? []).map((index) => ({ index }))}
          columns={INDEX_COLUMNS}
          onBack={() => setListed(false)}
        />
      </>
    );
  }

  const status = snapshot?.state ? capitalize(snapshot.state) : undefined;
  const partial = Boolean(snapshot?.failed_shards);
  return (
    <Flyout
      title="Restore snapshot"
      onClose={onClose}
      hideClose
      mask
      className="ismSnapshotFlyout"
      footer={
        <FlyoutFooter
          action="Restore snapshot"
          onCancel={onClose}
          onAction={restore}
          disabled={partial && !form.partial}
        />
      }
    >
      <div className="ismSnapshotForm">
        <div className="ismRestoreSummary">
          <Field title="Snapshot name">
            <Spacer size="xs" />
            <p>{snapshot?.snapshot}</p>
          </Field>
          <Field title="Status">
            {status && (
              <span className="ismRestoreSummary__status" title={`${status} indicator icon`}>
                <Health tone={status === 'Success' ? 'healthy' : undefined}>{status}</Health>
              </span>
            )}
          </Field>
          <Field title="Indices">
            <Spacer size="xs" />
            <button type="button" className="atlLinkButton" onClick={() => setListed(true)}>
              {snapshot?.indices?.length}
            </button>
          </Field>
        </div>
        <Spacer size="xxl" />
        <Field title="Specify restore option">
          <RadioGroup
            options={[
              { id: 'restore_all_indices', label: 'Restore all indices in snapshot' },
              { id: 'restore_specific_indices', label: 'Restore specific indices' },
            ]}
            value={form.restoreSpecific ? 'restore_specific_indices' : 'restore_all_indices'}
            onChange={(id) => {
              change({ restoreSpecific: id === 'restore_specific_indices' });
              if (id === 'restore_all_indices')
                setErrors((before) => ({ ...before, noIndicesSelected: false }));
            }}
          />
        </Field>
        <Spacer />
        {form.restoreSpecific && (
          <>
            <FormRow
              label="Select indices or input index patterns you want to restore"
              error={
                errors.noIndicesSelected
                  ? 'You must select at least one index to restore.'
                  : undefined
              }
            >
              <ComboBox
                options={form.all.map((index) => ({ value: index, label: index }))}
                selected={form.selected}
                onChange={(selected) => change({ selected })}
                allowCustom
                invalid={errors.noIndicesSelected}
                placeholder="Select indices or input index patterns."
              />
            </FormRow>
            <Spacer size="m" />
          </>
        )}
        <Spacer />
        <Field title="Rename restored indices">
          <RadioGroup
            options={RENAME_OPTIONS}
            value={form.rename}
            onChange={(rename) => {
              // Leaving the regular expression puts back what it began with
              change(
                rename === 'rename_indices'
                  ? { rename }
                  : { rename, renamePattern: '(.+)', renameReplacement: 'restored_$1' }
              );
              setErrors((before) => ({ ...before, badPattern: false, badRename: false }));
            }}
          />
        </Field>
        {form.rename === 'add_prefix' && (
          <>
            <Spacer />
            <Field
              title="Specify prefix for restored index names"
              help="A prefix will be added to any restored index names."
            >
              <TextField
                value={form.prefix}
                onChange={(prefix) => change({ prefix })}
                compact
                testId="prefixInput"
              />
            </Field>
            <Spacer size="m" />
          </>
        )}
        {form.rename === 'rename_indices' && (
          <>
            <Spacer />
            <FormRow
              label={
                <SmallLabel
                  title="Rename Pattern"
                  help={
                    <>
                      {/* The plugin's text has a brace too many after it */}
                      {`${PATTERN_HELP}} `}
                      <ExternalLink href={RESTORE_DOCS} />
                    </>
                  }
                />
              }
              error={errors.badPattern ? 'Please enter a valid Rename pattern.' : undefined}
            >
              <TextField
                value={form.renamePattern}
                onChange={(renamePattern) => change({ renamePattern })}
                invalid={errors.badPattern}
                compact
                testId="renamePatternInput"
              />
            </FormRow>
            <Spacer size="m" />
            <FormRow
              label={
                <SmallLabel
                  title="Rename Replacement"
                  help={
                    <>
                      {`${PATTERN_HELP} `}
                      <ExternalLink href={RESTORE_DOCS} />
                    </>
                  }
                />
              }
              error={errors.badRename ? 'Please enter a valid Rename replacement.' : undefined}
            >
              <TextField
                value={form.renameReplacement}
                onChange={(renameReplacement) => change({ renameReplacement })}
                invalid={errors.badRename}
                compact
                testId="renameReplacementInput"
              />
            </FormRow>
          </>
        )}
        <Spacer size="xxl" />
        <div className="ismSnapshotForm__accordion">
          <Accordion title={<h3 className="atlTitleS">Advanced options</h3>} initiallyOpen={false}>
            <Spacer size="m" />
            <div className="ismTicks ismTicks--inset">
              <Checkbox
                checked={form.restoreAliases}
                onChange={(restoreAliases) => change({ restoreAliases })}
                label={
                  <TickLabel
                    title="Restore aliases"
                    help="Restore index aliases alongside their associated indices."
                  />
                }
                testId="restore_aliases"
              />
              <Spacer size="s" />
              <Checkbox
                checked={form.includeGlobalState}
                onChange={(includeGlobalState) => change({ includeGlobalState })}
                label={<TickLabel title="Restore cluster state from snapshots" />}
                testId="include_global_state"
              />
              <Spacer size="m" />
              <Checkbox
                checked={form.ignoreUnavailable}
                onChange={(ignoreUnavailable) => change({ ignoreUnavailable })}
                label={
                  <TickLabel
                    title="Ignore unavailable indices"
                    help="Instead of failing restore operation, ignore any indices that are unavailable or do not exist."
                  />
                }
                testId="ignore_unavailable"
              />
              <Spacer />
              <h5 className="atlTitleXxs">Custom index settings</h5>
              <p className="ismTicks__text">
                By default, index settings are restored from indices in snapshots. You can choose to
                <br />
                customize index settings on restore.
              </p>
              <Spacer size="m" />
              <Checkbox
                checked={customize}
                onChange={(value) => {
                  setCustomize(value);
                  if (!value) {
                    change({ customIndexSettings: '' });
                    setErrors((before) => ({ ...before, badJSON: false }));
                  }
                }}
                label={
                  <TickLabel
                    title="Customize index settings"
                    help="Overrides index settings on all restored indices."
                  />
                }
                testId="customize_index_settings"
              />
              {customize && (
                <IndexSettingsInput
                  title="Specify custom index settings"
                  help="Specify a comma-delimited list of settings to override in all restored indices."
                  placeholder={
                    'Example: \n {\n"index.number_of_replicas": 0,\n"index.auto_expand_replicas": true\n}'
                  }
                  value={form.customIndexSettings}
                  onChange={(customIndexSettings) => change({ customIndexSettings })}
                  error={
                    errors.badJSON ? 'Please enter valid JSON between curly brackets.' : undefined
                  }
                />
              )}
              <Spacer size="s" />
              <Checkbox
                checked={ignore}
                onChange={(value) => {
                  setIgnore(value);
                  if (!value) {
                    change({ ignoreIndexSettings: '' });
                    setErrors((before) => ({ ...before, badIgnore: false }));
                  }
                }}
                label={
                  <TickLabel
                    title="Ignore index settings"
                    help="Exclude index settings that you don't want to restore from a snapshot."
                  />
                }
                testId="ignore_index_settings"
              />
              {ignore && (
                <IndexSettingsInput
                  title="Specify index settings to ignore"
                  help="Specify a comma-delimited list of settings to exclude from a snapshot."
                  placeholder={'Example: \nindex.refresh_interval,\nindex.max_script_fields '}
                  value={form.ignoreIndexSettings}
                  onChange={(ignoreIndexSettings) => change({ ignoreIndexSettings })}
                  error={
                    errors.badIgnore
                      ? 'Please enter a comma separated list of valid settings to ignore.'
                      : undefined
                  }
                />
              )}
            </div>
          </Accordion>
        </div>
        <Spacer />
        {partial && (
          <CallOut tone="warning" title="Restoring a partial snapshot">
            <p>
              You are about to restore a partial snapshot. One or more shards may be missing in this
              <br />
              snapshot. Do you want to continue?
            </p>
            <Spacer size="s" />
            <Checkbox
              checked={form.partial}
              onChange={(value) => change({ partial: value })}
              label={<TickLabel title="Allow restore partial snapshots" />}
              testId="partial"
            />
          </CallOut>
        )}
      </div>
    </Flyout>
  );
}

/** The label of a field set in a form row, as the plugin's: a small heading over what it means */
function SmallLabel({ title, help }: { title: string; help: ReactNode }) {
  return (
    <>
      <h4 className="atlTitleXs ismSmallLabel__title">{title}</h4>
      <span className="ismSmallLabel__help">{help}</span>
    </>
  );
}

/** Index settings to set or to leave out, under their tick, as the plugin asks for them */
function IndexSettingsInput({
  title,
  help,
  placeholder,
  value,
  onChange,
  error,
}: {
  title: string;
  help: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
}) {
  return (
    <>
      <Spacer size="m" />
      <FormRow
        label={
          <SmallLabel
            title={title}
            help={
              <>
                {`${help} `}
                <ExternalLink href={INDEX_SETTINGS_DOCS} />
              </>
            }
          />
        }
        error={error}
      >
        <TextArea
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          invalid={Boolean(error)}
          rows={3}
        />
      </FormRow>
      <Spacer size="m" />
    </>
  );
}

// --- How far a restore has come ---------------------------------------------------------------------------

/**
 * A restore that OpenSearch took on this page, and what was last read of it. The page keeps it, so
 * that the tab shows it again at once when it is opened again.
 */
export interface Restore {
  snapshotId: string;
  startedAt: number;
  indices: string[];
  progress?: RestoreProgress;
  /** The stage it was at when its recoveries could not be read, "Failed (50%)" */
  failed?: string;
}

/**
 * Asks OpenSearch to restore a snapshot: the restore to follow when it is taken, or why it was
 * not. Only the recoveries that begin after the request count. The plugin follows a restore that
 * was refused too, a row of 1970 at "Copying (0%)" among the activities.
 */
export async function askRestore(
  row: { id: string; repository: string },
  body: Record<string, unknown>,
  indices: string[]
): Promise<{ restore: Restore } | { error: string }> {
  const startedAt = Date.now();
  const answer = await ism.post(snapshotPath(row.id), body, { repository: row.repository });
  return answer.ok
    ? { restore: { snapshotId: row.id, startedAt, indices } }
    : { error: answer.error ?? '' };
}

export function RestoreActivities({
  restore,
  onSeen,
  onFailure,
}: {
  restore: Restore | undefined;
  /** What was read of the restore that began at `startedAt` */
  onSeen: (startedAt: number, seen: Pick<Restore, 'progress' | 'failed'>) => void;
  /** Called when the recoveries cannot be read, with why */
  onFailure: (error: string) => void;
}) {
  const progress = restore?.progress;
  const failed = restore?.failed;
  const [listed, setListed] = useState(false);
  const here = useRef(true);
  const stage = failed ?? progress?.stage ?? '';

  const check = async () => {
    if (!restore) return;
    const { snapshotId, startedAt, indices } = restore;
    const answer = await ism.get<Recovery>('_recovery');
    if (!here.current) return;
    if (answer.ok) {
      onSeen(startedAt, {
        progress: restoreProgress(answer.response ?? {}, snapshotId, startedAt, indices, Date.now()),
      });
    } else {
      onSeen(startedAt, { failed: failedStage(stage) });
      onFailure(`${answer.error ?? ''}, please check your connection`);
    }
  };
  useEffect(() => {
    here.current = true;
    return () => {
      here.current = false;
    };
  }, []);
  // The recoveries are read every two seconds until all of them are over
  useEffect(() => {
    if (!restore || failed !== undefined || stage === RESTORE_DONE) return undefined;
    const timer = window.setInterval(() => void check(), 2000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restore?.startedAt, stage, failed]);

  interface Row {
    start_time: string;
    stop_time: string;
    snapshot: string;
    status: string;
    indexes: string;
  }
  const rows: Row[] = restore
    ? [
        {
          start_time: progress ? restoreTime(progress.startTime) : '',
          stop_time: progress ? restoreTime(progress.stopTime) : '',
          snapshot: restore.snapshotId,
          status: stage,
          indexes: indexCountText(restore.indices.length),
        },
      ]
    : [];
  const columns: Array<TableColumn<Row>> = [
    { field: 'start_time', name: 'Start time', render: (row) => row.start_time },
    { field: 'stop_time', name: 'Completion time', render: (row) => row.stop_time },
    { field: 'snapshot', name: 'Snapshot name', render: (row) => row.snapshot },
    {
      field: 'status',
      name: 'Status',
      render: (row) => <Health tone={stageTone(row.status)}>{row.status}</Health>,
    },
    {
      field: 'indexes',
      name: 'Indices being restored',
      render: (row) => (
        <button
          type="button"
          className="atlLinkButton"
          onClick={() => {
            void check().then(() => {
              if (here.current) setListed(true);
            });
          }}
        >
          {row.indexes}
        </button>
      ),
    },
  ];

  return (
    <>
      <ListPanel
        title="Restore activities in progress"
        actions={
          <Button
            icon="refresh"
            disabled={!restore}
            onClick={() => void check()}
            testId="refreshStatusButton"
          >
            Refresh
          </Button>
        }
      >
        <LocalTable
          columns={columns}
          rows={rows}
          rowId={(row) => row.snapshot}
          paged={false}
          empty="There are no restore activities."
        />
      </ListPanel>
      {listed && restore && (
        <IndexList
          title="Indices being restored"
          snapshot={restore.snapshotId}
          indices={progress?.indices ?? []}
          columns={RESTORE_INDEX_COLUMNS}
          onBack={() => setListed(false)}
        />
      )}
    </>
  );
}

// --- The page ----------------------------------------------------------------------------------------------

const DESCRIPTION = (
  <>
    Snapshots of indices are taken automatically from snapshot policies,
    <br />
    or you can initiate manual snapshots to save to a repository.
    <br />
    You can restore indices by selecting a snapshot.
  </>
);

const RESTORE_CRUMB = { text: 'Restore activities in progress' };

export function Snapshots() {
  const [tab, setTab] = useState<'snapshots' | 'restore'>('snapshots');
  useBreadcrumbs(
    tab === 'snapshots'
      ? [CRUMBS.SNAPSHOT_MANAGEMENT, CRUMBS.SNAPSHOTS]
      : [CRUMBS.SNAPSHOT_MANAGEMENT, CRUMBS.SNAPSHOTS, RESTORE_CRUMB]
  );
  const [snapshots, setSnapshots] = useState<SnapshotRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<SnapshotRow[]>([]);
  const [search, setSearch] = useState('');
  const [shown, setShown] = useState<{ id: string; repository: string }>();
  const [dialog, setDialog] = useState<'create' | 'restore' | 'delete'>();
  const [restore, setRestore] = useState<Restore>();
  const [failure, setFailure] = useState<{ snapshotId: string; error: string }>();
  const [failureShown, setFailureShown] = useState(false);
  const here = useRef(true);

  const load = async () => {
    setLoading(true);
    const answer = await ism.get<{ snapshots?: SnapshotRow[] }>('_snapshots');
    if (!here.current) return;
    if (answer.ok) {
      const found = answer.response?.snapshots ?? [];
      setSnapshots(found);
      setSelected((before) =>
        found.filter((row) => before.some((item) => snapshotRowId(item) === snapshotRowId(row)))
      );
    } else {
      toastFailure('There was a problem getting the snapshots.', answer.error);
    }
    setLoading(false);
  };
  useEffect(() => {
    here.current = true;
    void load();
    return () => {
      here.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const remove = async () => {
    for (const row of selected) {
      const answer = await ism.delete(snapshotPath(row.id), { repository: row.repository });
      if (answer.ok)
        toasts.success(`Deleted snapshot ${row.id} from repository ${row.repository}.`);
      else toastFailure('There was a problem deleting the snapshot.', answer.error);
    }
    if (here.current) await load();
  };

  const create = async (snapshotId: string, repository: string, body: SnapshotBody) => {
    const answer = await ism.put(snapshotPath(snapshotId), body, { repository });
    if (!here.current) return;
    if (answer.ok) {
      setDialog(undefined);
      toasts.success(`Created snapshot ${snapshotId} in repository ${repository}.`);
      await load();
    } else {
      toastFailure('There was a problem creating the snapshot.', answer.error, answer.error ?? '');
    }
  };

  const showFailure = (snapshotId: string, error: string, text: string) => {
    setFailure({ snapshotId, error });
    toasts.danger(
      `Failed to restore snapshot "${snapshotId}"`,
      <span className="ismToastAction">
        <span>{text}</span>
        <Button size="s" variant="danger" onClick={() => setFailureShown(true)}>
          View full error
        </Button>
      </span>,
      6000
    );
  };

  const startRestore = async (
    row: SnapshotRow,
    body: Record<string, unknown>,
    indices: string[]
  ) => {
    const asked = await askRestore(row, body, indices);
    if (!here.current) return;
    if ('restore' in asked) {
      setRestore(asked.restore);
      toasts.success(
        `Restore from snapshot "${row.id}" is in progress.`,
        <span className="ismToastAction">
          <Button size="s" onClick={() => setTab('restore')}>
            View restore activities
          </Button>
        </span>,
        6000
      );
    } else {
      showFailure(row.id, asked.error, restoreFailureText(asked.error));
    }
  };

  const clickRestore = () => {
    const blocked = notRestorable(selected[0]);
    if (blocked) toasts.danger(blocked.title, blocked.text);
    else setDialog('restore');
  };

  const filter = (field: string) => (values: string[]) =>
    setSearch(withFieldValues(search, field, values));
  const filterOptions = (values: Array<string | undefined>) => distinct(values);

  const columns: Array<TableColumn<SnapshotRow>> = [
    {
      field: 'id',
      name: 'Name',
      sortable: true,
      width: '25%',
      render: (row) => (
        <button
          type="button"
          className="atlLinkButton"
          onClick={() => setShown({ id: row.id, repository: row.repository })}
        >
          <span title={row.id}>{truncate(row.id, 80)}</span>
        </button>
      ),
    },
    {
      field: 'status',
      name: 'Snapshot status',
      sortable: true,
      render: (row) => (
        <Health tone={snapshotStatusTone(row.status)}>{snapshotStatusText(row.status)}</Health>
      ),
    },
    {
      field: 'policy',
      name: 'Policy',
      render: (row) =>
        row.policy ? (
          <button
            type="button"
            className="atlLinkButton"
            onClick={() => go(ROUTES.SNAPSHOT_POLICY_DETAILS, { id: row.policy })}
          >
            {truncate(row.policy, 20)}
          </button>
        ) : (
          '-'
        ),
    },
    {
      field: 'repository',
      name: 'Repository',
      render: (row) => <span title={row.repository}>{truncate(row.repository, 20)}</span>,
    },
    {
      field: 'end_epoch',
      name: 'Time last updated',
      sortable: true,
      render: (row) => renderTime(row.end_epoch),
    },
  ];

  const rows = searchItems(snapshots as Array<Record<string, unknown>>, search) as SnapshotRow[];
  return (
    <div className="ismTabbed">
      <Tabs
        tabs={[
          { id: 'snapshots', label: 'Snapshots' },
          { id: 'restore', label: 'Restore activities in progress' },
        ]}
        selected={tab}
        onSelect={(id) => {
          setTab(id as 'snapshots' | 'restore');
          // Back at the list nothing is ticked
          if (id === 'snapshots') setSelected([]);
        }}
      />
      {tab === 'restore' ? (
        <RestoreActivities
          restore={restore}
          onSeen={(startedAt, seen) =>
            setRestore((before) =>
              before?.startedAt === startedAt ? { ...before, ...seen } : before
            )
          }
          onFailure={(error) => {
            if (restore) showFailure(restore.snapshotId, error, '');
          }}
        />
      ) : (
        <ListPanel
          title="Snapshots"
          description={DESCRIPTION}
          actions={
            <>
              <Button icon="refresh" onClick={() => void load()} testId="refreshButton">
                Refresh
              </Button>
              <Button
                variant="danger"
                disabled={selected.length === 0}
                onClick={() => setDialog('delete')}
                testId="deleteButton"
              >
                Delete
              </Button>
              <Button disabled={selected.length !== 1} onClick={clickRestore} testId="restoreButton">
                Restore
              </Button>
              <Button
                variant="primary"
                icon="plus"
                onClick={() => setDialog('create')}
                testId="takeSnapshotButton"
              >
                Take snapshot
              </Button>
            </>
          }
        >
          <SearchRow search={search} onSearch={setSearch} placeholder="Search snapshot">
            <FilterGroup>
              <GroupFilter
                name="Repository"
                options={filterOptions(snapshots.map((row) => row.repository))}
                selected={fieldValues(search, 'repository')}
                onChange={filter('repository')}
              />
              <GroupFilter
                name="Status"
                options={filterOptions(snapshots.map((row) => row.status))}
                selected={fieldValues(search, 'status')}
                onChange={filter('status')}
              />
              <GroupFilter
                name="Policy"
                options={filterOptions(snapshots.map((row) => row.policy))}
                selected={fieldValues(search, 'policy')}
                onChange={filter('policy')}
              />
            </FilterGroup>
          </SearchRow>
          <LocalTable
            columns={columns}
            rows={rows}
            rowId={snapshotRowId}
            sortField="end_epoch"
            sortDirection="desc"
            pageSizes={SMALL_PAGE_SIZES}
            selected={selected}
            onSelect={setSelected}
            empty={loading ? 'Loading snapshots...' : 'No items found'}
          />
        </ListPanel>
      )}

      {shown && (
        <SnapshotFlyout
          snapshotId={shown.id}
          repository={shown.repository}
          onClose={() => setShown(undefined)}
        />
      )}
      {dialog === 'create' && (
        <CreateSnapshotFlyout onClose={() => setDialog(undefined)} onCreate={create} />
      )}
      {dialog === 'restore' && selected.length > 0 && (
        <RestoreSnapshotFlyout
          snapshotId={selected[0].id}
          repository={selected[0].repository}
          onClose={() => setDialog(undefined)}
          onRestore={(body, indices) => void startRestore(selected[0], body, indices)}
        />
      )}
      {dialog === 'delete' && (
        <DeleteDialog
          type="snapshot"
          ids={selected.map((row) => row.id).join(', ')}
          onCancel={() => setDialog(undefined)}
          onDelete={() => void remove()}
        />
      )}
      {failureShown && failure && (
        <Modal
          title={`Failed to restore snapshot ${failure.snapshotId}`}
          onClose={() => setFailureShown(false)}
          footer={
            <Button variant="primary" size="s" onClick={() => setFailureShown(false)}>
              Close
            </Button>
          }
        >
          <p className="ismRestoreError">{failure.error}.</p>
        </Modal>
      )}
    </div>
  );
}

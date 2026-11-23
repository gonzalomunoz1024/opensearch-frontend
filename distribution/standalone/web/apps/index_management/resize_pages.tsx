/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The pages that make a new index out of one there is: with more primary shards (split), or with
 * fewer (shrink). Both show the source index and what stands in the way in a panel, take the name
 * and the settings of the new index in another, and end with the panel of the notifications.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Button, CallOut, Panel, Spinner } from '../../components/basic';
import { ComboBox } from '../../components/combo_box';
import { Select, TextField } from '../../components/form';
import { Icon } from '../../components/icon';
import { useLocation } from '../../router';
import { useBreadcrumbs } from '../../shell/state';
import { ExternalLink, go, ism, toasts } from './common';
import { FactGrid, TitledPanel } from './content_panel';
import { FormRow } from './form_row';
import { AdvancedSettings, AliasSelect, REPLICA_NUMBER_MESSAGE, aliasesError, type AliasMap } from './index_form';
import { openIndices } from './indices';
import { addJob, clusterInfo, startedToast } from './job_handlers';
import { onJobDone } from './jobs';
import { INDEX_NAMING_MESSAGE } from './model';
import { NotificationConfig, type NotificationHandle } from './notification_config';
import {
  resizeBody,
  resizeEditorValue,
  resizeFromEditor,
  shrinkBlocked,
  shrinkErrors,
  shrinkProblems,
  shrinkShardOptions,
  splitErrors,
  splitProblems,
  splitShardOptions,
  type ResizeValues,
} from './operation_model';
import { CRUMBS, ROUTES } from './routes';

const INDEX_SETTINGS_URL =
  'https://opensearch.org/docs/latest/install-and-configure/configuring-opensearch/index-settings/#index-level-index-settings';
const SPLIT_DOCS = 'https://opensearch.org/docs/latest/api-reference/index-apis/split/';
const SHRINK_DOCS = 'https://opensearch.org/docs/latest/api-reference/index-apis/shrink-index';

/** An index as the list of indexes of OpenSearch gives it */
interface CatIndex {
  index: string;
  health?: string;
  status?: string;
  pri?: string;
  rep?: string;
  'store.size'?: string;
}

type IndexSettings = Record<string, { settings?: Record<string, unknown> } | undefined>;

/** The title of the page and what it is for, with a link to the documentation under it */
function PageTitle({ title, text, href }: { title: string; text: string; href: string }) {
  return (
    <>
      <h1 className="ismTextTitle">{title}</h1>
      <FormRow
        fullWidth
        helpAt="bottom"
        help={
          <div>
            {text} <ExternalLink href={href} />
          </div>
        }
      />
      <div className="ismSpacer ismSpacer--l" />
    </>
  );
}

/** What the source index is, and under it what the page has to say about it */
function SourceDetails({ index, children }: { index: string; children?: ReactNode }) {
  const [item, setItem] = useState<CatIndex>();
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let gone = false;
    setLoading(true);
    void ism.call<CatIndex[]>('cat.indices', { index: [index], format: 'json' }).then((answer) => {
      if (gone) return;
      if (answer.ok) setItem(answer.response?.[0]);
      else toasts.danger(answer.error || '');
      setLoading(false);
    });
    return () => {
      gone = true;
    };
  }, [index]);
  return (
    <TitledPanel title="Source index details">
      <div className="ismSpacer ismSpacer--s" />
      {item && (
        // What OpenSearch does not give (the size of a closed index) is a dash
        <FactGrid
          headings
          items={[
            ['Index name', item.index || '-'],
            ['Primary shards', item.pri || '-'],
            ['Replica shards', item.rep || '-'],
            ['Total index size', item['store.size'] || '-'],
          ]}
        />
      )}
      <div className="ismSpacer ismSpacer--l" />
      {!loading && children}
    </TitledPanel>
  );
}

/** What stands in the way, a call-out each, as the items of a list */
function Reasons({ children }: { children: ReactNode[] }) {
  return (
    <ul className="ismReasonList">
      {children.map((reason, at) => (
        <li key={at}>
          {reason}
          <div className="ismSpacer ismSpacer--l" />
        </li>
      ))}
    </ul>
  );
}

/** The messages of a field that breaks rules, one under the other */
const said = (messages: string[] | undefined) =>
  messages?.length ? messages.map((text) => <div key={text}>{text}</div>) : undefined;

/** The fields both forms end with: the aliases of the new index, and all its settings as JSON */
function LastFields({
  values,
  onChange,
  aliasError,
  aliasTestId,
  aliasesFromStart,
  viewSettings,
  advancedTitle,
}: {
  values: ResizeValues;
  onChange: (values: ResizeValues) => void;
  aliasError?: string;
  aliasTestId?: string;
  aliasesFromStart?: boolean;
  viewSettings: string;
  advancedTitle: ReactNode;
}) {
  return (
    <>
      <FormRow
        title="Index alias "
        optional
        testId="form-name-aliases"
        help="Allow this index to be referenced by existing aliases or specify a new alias."
        error={aliasError}
      >
        <AliasSelect
          value={values.aliases as AliasMap | undefined}
          onChange={(aliases) => onChange({ ...values, aliases })}
          invalid={Boolean(aliasError)}
          testId={aliasTestId}
          fromStart={aliasesFromStart}
        />
      </FormRow>
      <div className="ismSpacer ismSpacer--m" />
      <AdvancedSettings
        nested
        fullWidth={false}
        title={advancedTitle}
        value={resizeEditorValue(values)}
        onChange={(edited) => onChange(resizeFromEditor(values, edited))}
      >
        <>
          Specify a comma-delimited list of settings. <ExternalLink href={INDEX_SETTINGS_URL}>{viewSettings}</ExternalLink>
        </>
      </AdvancedSettings>
    </>
  );
}

/**
 * The notifications in the plugin's panel that opens: an accordion with the panel's title, a rule
 * under it, open or not, and the notifications under the rule. They stay there while the panel is
 * closed, so that what they hold is checked all the same.
 */
function NotificationsPanel({ notifications }: { notifications: RefObject<NotificationHandle> }) {
  const [open, setOpen] = useState(false);
  return (
    <Panel flush className="ismAccordionPanel">
      <button
        type="button"
        className="ismAccordionPanel__button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Icon name="chevronRight" className="ismAccordion__icon" />
        <h2 className="ismPanelTitle">Advanced settings</h2>
      </button>
      <hr className="ismRule" />
      <div className="ismAccordionPanel__body" hidden={!open}>
        <div className="ismSpacer ismSpacer--s" />
        {/* The words of a shrink on both pages, as the plugin has them */}
        <NotificationConfig ref={notifications} actionType="RESIZE" operationType="SHRINK" />
        <div className="ismSpacer ismSpacer--s" />
      </div>
    </Panel>
  );
}

/** The panel of the notifications and the buttons that end both pages */
function Ending({
  notifications,
  children,
}: {
  notifications: RefObject<NotificationHandle>;
  children: ReactNode;
}) {
  return (
    <>
      <div className="ismSpacer ismSpacer--l" />
      <NotificationsPanel notifications={notifications} />
      <div className="ismSpacer ismSpacer--l" />
      <div className="ismEndButtons">{children}</div>
    </>
  );
}

// --- Split ---------------------------------------------------------------------------------------------------

export function SplitIndex() {
  useBreadcrumbs([CRUMBS.INDEX_MANAGEMENT, CRUMBS.INDICES, CRUMBS.SPLIT_INDEX]);
  const source = useLocation().hashParams.source ?? '';
  const [index, setIndex] = useState<CatIndex>();
  const [settings, setSettings] = useState<Record<string, unknown>>();
  const [checked, setChecked] = useState(false);
  const [opening, setOpening] = useState(false);
  const [values, setValues] = useState<ResizeValues>({ 'index.number_of_replicas': '1' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [aliasError, setAliasError] = useState<string>();
  const notifications = useRef<NotificationHandle>(null);

  // What the index is now: asked again after each thing done to make it ready
  const check = useCallback(async () => {
    const found = await ism.call<CatIndex[]>('cat.indices', { format: 'json', index: [source] });
    if (!found.ok || found.response?.length !== 1) {
      toasts.danger(found.error || `There is a problem getting index for ${source}, please check with Admin`);
      go(ROUTES.INDICES);
      return;
    }
    const [one] = found.response;
    setIndex(one);
    const got = await ism.call<IndexSettings>('indices.getSettings', { index: one.index, flat_settings: true });
    if (!got.ok) {
      toasts.danger(got.error || `There is a problem getting index setting for ${one.index}, please check with Admin`);
      go(ROUTES.INDICES);
      return;
    }
    setSettings(got.response?.[one.index]?.settings);
  }, [source]);

  useEffect(() => {
    void check().then(() => setChecked(true));
    return onJobDone('OPEN_COMPLETE', () => {
      setOpening(false);
      void check();
    });
  }, [check]);

  const problems = index ? splitProblems(index, settings) : [];
  const ready = problems.length === 0;
  const shards = splitShardOptions(Number(index?.pri));
  const shardMessage =
    index?.pri === '1'
      ? 'The number must be an integer greater than 1 but fewer or equal to 1024.'
      : 'The number must be 2x times of the primary shard count of the source index.';

  // A field is checked as it changes, as the plugin's form checks every field it is told of
  const change = (name: 'targetIndex' | 'index.number_of_shards', next: ResizeValues) => {
    setValues(next);
    setErrors((had) => {
      const { [name]: _old, ...others } = had;
      const found = splitErrors(next, shards)[name];
      return found ? { ...others, [name]: found } : others;
    });
  };

  const blockWrites = async () => {
    if (!index) return;
    const result = await ism.call('indices.putSettings', {
      index: index.index,
      flat_settings: true,
      body: { settings: { 'index.blocks.write': 'true' } },
    });
    if (!result.ok) {
      toasts.danger(result.error || `There is a problem set index setting for ${index.index}, please check with Admin`);
      return;
    }
    toasts.success(`Successfully update index setting for ${index.index}`);
    await check();
  };

  const submit = async () => {
    if (!index) return;
    const wrong = splitErrors(values, shards);
    const wrongAliases = aliasesError(values.aliases as AliasMap | undefined);
    setErrors(wrong);
    setAliasError(wrongAliases);
    const notificationsFine = notifications.current?.validate() ?? true;
    if (Object.keys(wrong).length > 0 || wrongAliases || !notificationsFine) return;
    const target = String(values.targetIndex);
    const result = await ism.request<{ task?: string }>(
      'PUT',
      `/${index.index}/_split/${target}?wait_for_completion=false`,
      resizeBody(values)
    );
    if (!result.ok) {
      toasts.danger(result.error || 'There was a problem submit split index request, please check with admin');
      return;
    }
    const toastId = startedToast(
      `Successfully started splitting ${index.index}. The split index will be named ${target}`
    );
    const taskId = result.response?.task;
    addJob({
      interval: 30000,
      extras: { clusterInfo: await clusterInfo(), toastId, sourceIndex: index.index, destIndex: target, taskId },
      type: 'split',
    });
    void notifications.current?.associateWithTask(taskId);
    go(ROUTES.INDICES);
  };

  const reasons: ReactNode[] = [];
  if (problems.includes('red')) {
    reasons.push(<CallOut tone="critical" icon="warning" title="The source index must not have a Red health status." />);
  }
  if (problems.includes('closed')) {
    reasons.push(
      <CallOut tone="critical" icon="warning" title="The source index must be open.">
        <p>
          You must first open the index before splitting it. Depending on the size of the source index, this may take
          additional time to complete. The index will be in the Red state while the index is opening.
        </p>
        <p>
          <Button
            variant="primary"
            loading={opening}
            testId="open-index-button"
            onClick={() => {
              setOpening(true);
              void openIndices([source], 5000);
            }}
          >
            Open index
          </Button>
        </p>
      </CallOut>
    );
  }
  if (problems.includes('writable')) {
    reasons.push(
      <CallOut tone="critical" icon="warning" title="The source index must block write operations before splitting.">
        <p>In order to split an existing index, you must first set the index to block write operations.</p>
        <Button variant="primary" testId="set-indexsetting-button" onClick={blockWrites}>
          Block write operations
        </Button>
      </CallOut>
    );
  }

  return (
    <div className="ismFormPage ismPage--form">
      <PageTitle
        title="Split index"
        text="Split an existing read-only index into a new index with more primary shards."
        href={SPLIT_DOCS}
      />
      {checked && index && (
        <div>
          <SourceDetails index={index.index}>
            <Reasons>{reasons}</Reasons>
          </SourceDetails>
          {ready && (
            <>
              <div className="ismSpacer ismSpacer--l" />
              <TitledPanel title="Configure target index" large>
                <FormRow
                  title="Target Index Name"
                  testId="form-name-targetIndex"
                  help={INDEX_NAMING_MESSAGE}
                  helpAt="bottom"
                  error={errors.targetIndex}
                >
                  <TextField
                    compact
                    value={String(values.targetIndex ?? '')}
                    onChange={(targetIndex) => change('targetIndex', { ...values, targetIndex })}
                    placeholder="Specify a name for the new split index"
                    invalid={Boolean(errors.targetIndex)}
                    testId="targetIndexNameInput"
                  />
                </FormRow>
                <FormRow
                  title="Number of primary shards"
                  testId="form-name-index.number_of_shards"
                  error={errors['index.number_of_shards']}
                  help={
                    <>
                      <p>Specify the number of primary shards for the new split index.</p>
                      <p>{shardMessage}</p>
                    </>
                  }
                >
                  <ComboBox
                    compact
                    single
                    testId="numberOfShardsInput"
                    placeholder="Specify primary shard count"
                    invalid={Boolean(errors['index.number_of_shards'])}
                    options={shards.map((count) => ({ value: count, label: count }))}
                    selected={values['index.number_of_shards'] ? [String(values['index.number_of_shards'])] : []}
                    onChange={(next) => change('index.number_of_shards', { ...values, 'index.number_of_shards': next[0] })}
                  />
                </FormRow>
                <FormRow
                  title="Number of replicas"
                  testId="form-name-index.number_of_replicas"
                  help={REPLICA_NUMBER_MESSAGE}
                >
                  <TextField
                    compact
                    type="number"
                    min={0}
                    value={String(values['index.number_of_replicas'] ?? '')}
                    onChange={(replicas) => setValues({ ...values, 'index.number_of_replicas': replicas })}
                    placeholder="Specify number of replica"
                    testId="numberOfReplicasInput"
                  />
                </FormRow>
                <LastFields
                  values={values}
                  onChange={setValues}
                  aliasError={aliasError}
                  viewSettings="View index settings"
                  advancedTitle={<h4>Advanced settings</h4>}
                />
              </TitledPanel>
            </>
          )}
          <Ending notifications={notifications}>
            <Button variant="empty" onClick={() => go(ROUTES.INDICES)} testId="splitCancelButton">
              Cancel
            </Button>
            <Button variant="primary" loading={opening} disabled={opening || !ready} onClick={submit} testId="splitButton">
              Split
            </Button>
          </Ending>
        </div>
      )}
    </div>
  );
}

// --- Shrink --------------------------------------------------------------------------------------------------

export function ShrinkIndex() {
  useBreadcrumbs([CRUMBS.INDEX_MANAGEMENT, CRUMBS.INDICES, CRUMBS.SHRINK_INDEX]);
  const source = useLocation().hashParams.source ?? '';
  const [index, setIndex] = useState<CatIndex>();
  const [settings, setSettings] = useState<Record<string, unknown>>();
  const [busy, setBusy] = useState(false);
  const [values, setValues] = useState<ResizeValues>({ 'index.number_of_shards': 1, 'index.number_of_replicas': 1 });
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [aliasError, setAliasError] = useState<string>();
  const notifications = useRef<NotificationHandle>(null);
  const here = useRef(true);
  useEffect(
    () => () => {
      here.current = false;
    },
    []
  );

  const readSettings = useCallback(async (name: string) => {
    const got = await ism.call<IndexSettings>('indices.getSettings', { index: name, flat_settings: true });
    if (got.ok) setSettings(got.response?.[name]?.settings ?? {});
    else toasts.danger(got.error || `There was a problem getting index setting for ${name}, please check with Admin.`);
  }, []);

  const read = useCallback(
    async (name: string) => {
      const found = await ism.call<CatIndex[]>('cat.indices', { index: [name], format: 'json' });
      if (found.ok && found.response && found.response.length > 0) {
        setIndex(found.response[0]);
        await readSettings(found.response[0].index);
        return;
      }
      toasts.danger(`Could not shrink index: ${found.ok ? `Index ${name} does not exist` : found.error}`);
      go(ROUTES.INDICES);
    },
    [readSettings]
  );

  useEffect(() => {
    if (source) {
      void read(source);
    } else {
      toasts.danger('Index is empty.');
      go(ROUTES.INDICES);
    }
    return onJobDone('OPEN_COMPLETE', () => {
      setBusy(false);
      if (source) void read(source);
    });
  }, [read, source]);

  if (!index) {
    return (
      <div className="ismPage ismPage--loading">
        <Spinner size="xl" />
      </div>
    );
  }

  const problems = shrinkProblems(index, settings);
  const blocked = shrinkBlocked(problems);
  const pri = Number(index.pri);

  const blockWrites = async () => {
    const result = await ism.call('indices.putSettings', {
      index: index.index,
      body: { settings: { 'index.blocks.write': true } },
    });
    if (result.ok) toasts.success(`${index.index} has been set to block write operations.`);
    else {
      toasts.danger(
        result.error || `There was a problem updating index setting for ${index.index}, please check with Admin`
      );
    }
    await readSettings(index.index);
  };

  const submit = async () => {
    const wrong = shrinkErrors(values, pri);
    const wrongAliases = aliasesError(values.aliases as AliasMap | undefined);
    setErrors(wrong);
    setAliasError(wrongAliases);
    if (Object.keys(wrong).length > 0 || wrongAliases) return;
    if (notifications.current && !notifications.current.validate()) return;
    const target = String(values.targetIndex);
    setBusy(true);
    const result = await ism.request<{ task?: string }>(
      'PUT',
      `/${index.index}/_shrink/${target}?wait_for_completion=false`,
      resizeBody(values)
    );
    if (result.ok) {
      const taskId = result.response?.task;
      await notifications.current?.associateWithTask(taskId);
      const toastId = startedToast(
        `Successfully started shrinking ${index.index}. The shrunken index will be named ${target}.`
      );
      go(ROUTES.INDICES);
      addJob({
        interval: 30000,
        extras: { clusterInfo: await clusterInfo(), toastId, sourceIndex: index.index, destIndex: target, taskId },
        type: 'shrink',
      });
    } else {
      toasts.danger(result.error);
    }
    if (here.current) setBusy(false);
  };

  // A field says what is wrong with it as soon as it changes
  const change = (changes: ResizeValues) => {
    const next = { ...values, ...changes };
    const wrong = shrinkErrors(next, pri);
    const judged = { ...errors };
    for (const name of Object.keys(changes)) {
      if (wrong[name]) judged[name] = wrong[name];
      else delete judged[name];
    }
    setValues(next);
    setErrors(judged);
    if ('aliases' in changes) setAliasError(aliasesError(next.aliases as AliasMap | undefined));
  };

  const reasons: ReactNode[] = [];
  if (problems.includes('red')) {
    reasons.push(
      <CallOut tone="critical" icon="warning" title="The source index must be in green health status.">
        <p>
          The index is in red health status and may be running operations in the background. We recommend to wait
          until the index becomes green to continue shrinking.
        </p>
      </CallOut>
    );
  }
  if (problems.includes('oneShard')) {
    reasons.push(<CallOut tone="critical" icon="warning" title="Cannot shrink source index with only one primary shard." />);
  }
  if (problems.includes('writable')) {
    reasons.push(
      <CallOut tone="critical" icon="warning" title="The source index must block write operations before shrinking.">
        <p>In order to shrink an existing index, you must first set the index to block write operations.</p>
        <Button variant="primary" testId="onSetIndexWriteBlockButton" onClick={blockWrites}>
          Block write operations
        </Button>
      </CallOut>
    );
  }
  if (problems.includes('closed')) {
    reasons.push(
      <CallOut tone="critical" icon="warning" title="The source index must be open.">
        <p>
          You must first open the index before shrinking it. Depending on the size of the source index, this may take
          additional time to complete. The index will be in red health status while the index is opening.
        </p>
        <div className="ismSpacer ismSpacer--l" />
        <Button
          variant="primary"
          loading={busy}
          testId="onOpenIndexButton"
          onClick={() => {
            setBusy(true);
            void openIndices([index.index], 5000);
          }}
        >
          Open index
        </Button>
      </CallOut>
    );
  }
  if (problems.includes('yellow')) {
    reasons.push(
      <CallOut tone="warning" icon="lifebuoy" title="We recommend shrinking index with a green health status.">
        <p>
          The source index is in yellow health status. To prevent issues with initializing the new shrunken index, we
          recommend shrinking an index with a green health status.
        </p>
      </CallOut>
    );
  }
  if (problems.includes('readOnly')) {
    reasons.push(
      <CallOut tone="warning" icon="lifebuoy" title="Index setting [index.blocks.read_only] is [true].">
        <p>
          Index setting [index.blocks.read_only] of the source index is [true], it will be copied to the new shrunken
          index and then cause the new shrunken index&apos;s shards to be unassigned, you can set the setting to [null]
          or [false] in the advanced settings bellow.
        </p>
      </CallOut>
    );
  }

  return (
    <div className="ismFormPage ismPage--form">
      <PageTitle
        title="Shrink index"
        text="Shrink an existing index into a new index with fewer primary shards."
        href={SHRINK_DOCS}
      />
      <SourceDetails index={index.index}>
        <Reasons>{reasons}</Reasons>
      </SourceDetails>
      {!blocked && (
        <>
          <div className="ismSpacer ismSpacer--m" />
          <TitledPanel title="Configure target index" large>
            <div className="ismSpacer ismSpacer--m" />
            <FormRow
              title="Target index name"
              testId="form-name-targetIndex"
              help={<div>{INDEX_NAMING_MESSAGE}</div>}
              helpAt="bottom"
              error={said(errors.targetIndex)}
            >
              <TextField
                compact
                value={String(values.targetIndex ?? '')}
                onChange={(targetIndex) => change({ targetIndex })}
                placeholder="Specify a name for the new shrunken index."
                invalid={Boolean(errors.targetIndex)}
                testId="targetIndexNameInput"
              />
            </FormRow>
            <FormRow
              title="Number of primary shards"
              testId="form-name-index.number_of_shards"
              error={said(errors['index.number_of_shards'])}
              help={
                <>
                  <p>Specify the number of shards for the new shrunken index.</p>
                  <p>The number must be a factor of the primary shard count of the source index.</p>
                </>
              }
            >
              <Select
                compact
                testId="numberOfShardsInput"
                className={errors['index.number_of_shards'] ? 'atlField--invalid' : undefined}
                options={shrinkShardOptions(pri).map((count) => ({ value: count, label: count }))}
                value={String(values['index.number_of_shards'] ?? '')}
                onChange={(count) => change({ 'index.number_of_shards': count })}
              />
            </FormRow>
            <FormRow
              title="Number of replicas"
              testId="form-name-index.number_of_replicas"
              error={said(errors['index.number_of_replicas'])}
              help={<div>{REPLICA_NUMBER_MESSAGE}</div>}
            >
              <TextField
                compact
                type="number"
                min={0}
                value={String(values['index.number_of_replicas'] ?? '')}
                onChange={(replicas) => change({ 'index.number_of_replicas': replicas })}
                invalid={Boolean(errors['index.number_of_replicas'])}
                testId="numberOfReplicasInput"
              />
            </FormRow>
            <LastFields
              values={values}
              onChange={(next) => {
                setValues(next);
                setAliasError(aliasesError(next.aliases as AliasMap | undefined));
              }}
              aliasError={aliasError}
              aliasTestId="aliasesInput"
              aliasesFromStart
              viewSettings="View index settings."
              advancedTitle={<h2>Advanced settings</h2>}
            />
          </TitledPanel>
        </>
      )}
      <Ending notifications={notifications}>
        <Button
          variant="empty"
          className="ismEndButtons__flush"
          onClick={() => go(ROUTES.INDICES)}
          testId="shrinkIndexCancelButton"
        >
          Cancel
        </Button>
        <Button
          variant="primary"
          loading={busy}
          disabled={busy || blocked}
          onClick={submit}
          testId="shrinkIndexConfirmButton"
        >
          Shrink
        </Button>
      </Ending>
    </div>
  );
}

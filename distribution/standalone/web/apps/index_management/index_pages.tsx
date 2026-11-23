/* SPDX-License-Identifier: Apache-2.0 */

/* The page that creates an index, and the page that shows one index and changes what can be changed. */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react';
import { Button, CallOut, Health, Panel, Spinner, Tabs, type Tone } from '../../components/basic';
import { TextField } from '../../components/form';
import { ConfirmModal, MenuButton, Portal } from '../../components/overlay';
import { useBreadcrumbs } from '../../shell/state';
import { UnsavedChangesBar } from './bottom_bar';
import { ExternalLink, capital, go, ism, to, toasts } from './common';
import { FormRow } from './form_row';
import {
  AliasSelect,
  MappingEditor,
  SettingsFields,
  aliasesError,
  settingsErrors,
  type AliasMap,
} from './index_form';
import {
  addedFields,
  changedSettings,
  countChanges,
  defaultIndex,
  fieldsHaveErrors,
  importedIndex,
  indexAliasActions,
  localMappings,
  mappingErrorMessage,
  mergedWithTemplate,
  propertiesOf,
  remoteMappings,
  simulatedIndex,
  type IndexItem,
} from './index_model';
import { IndicesActions, type IndexRow } from './indices';
import { INDEX_NAMING_MESSAGE, INDEX_NAMING_PATTERN, SYSTEM_INDEX, matchesAny } from './model';
import { onJobDone } from './jobs';
import { CRUMBS, INDEX_MANAGEMENT_PATH, ROUTES } from './routes';

const MAPPINGS_DOCS = 'https://opensearch.org/docs/latest/opensearch/mappings/';

function MappingsHelp({ after }: { after: string }) {
  return (
    <>
      <div>
        Define how documents and their fields are stored and indexed.{' '}
        <ExternalLink href={MAPPINGS_DOCS} />
      </div>
      <div>{after}</div>
    </>
  );
}

function FormPanel({ title, help, children }: { title: ReactNode; help?: ReactNode; children: ReactNode }) {
  return (
    <Panel>
      <h2 className="ismPanelTitle">{title}</h2>
      {help && <div className="ismHelpText">{help}</div>}
      <hr className="ismRule" />
      {children}
    </Panel>
  );
}

// --- Create index -------------------------------------------------------------------------------------------

export interface IndexFormHandle {
  /** Shows what is wrong with the form, and says whether nothing is */
  validate(): boolean;
  value(): IndexItem;
  /** The mapping as its JSON editor has it: the messages of OpenSearch name a place in it */
  editorText(): string;
  /** Gives the index a name, and what the templates that match the name say */
  rename(name: string): void;
  /** Takes the settings and the mapping of an index there is */
  importSettings(index: string): void;
}

/**
 * The form of a new index: its name, its aliases, its settings and its mapping. A page of its own
 * shows each part in a panel; inside another page's panel the parts follow each other.
 */
export const IndexForm = forwardRef<
  IndexFormHandle,
  {
    withoutPanel?: boolean;
    /** Indexes whose settings and mapping the form offers to take over */
    sourceIndices?: string[];
  }
>(function IndexForm({ withoutPanel, sourceIndices = [] }, ref) {
  const [item, setItem] = useState<IndexItem>(defaultIndex);
  const [submitted, setSubmitted] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [matching, setMatching] = useState(false);
  const [offered, setOffered] = useState<IndexItem>();
  const [importing, setImporting] = useState<string>();
  // Whether anything but the name was filled in since the templates were last asked
  const edited = useRef(false);
  const editorText = useRef('');
  const gone = useRef(false);
  const latest = useRef(item);
  latest.current = item;
  useEffect(
    () => () => {
      gone.current = true;
    },
    []
  );

  const change = (changes: Partial<IndexItem>) => {
    edited.current = true;
    setItem((before) => ({ ...before, ...changes }));
  };

  // An index gets what the templates that match its name say, so the form shows it once the name is known
  const simulate = async (name: string) => {
    if (!name) return;
    setSimulating(true);
    const answer = await ism.request<{ template?: unknown }>('POST', `/_index_template/_simulate_index/${name}`);
    if (gone.current) return;
    setSimulating(false);
    if (!answer.ok || !answer.response?.template) {
      setMatching(false);
      return;
    }
    const fromTemplate = simulatedIndex(answer.response.template, name);
    if (edited.current) setOffered(fromTemplate);
    else {
      setItem((before) => ({ ...before, ...fromTemplate, index: before.index }));
      setMatching(true);
    }
  };

  const importFrom = async (index: string) => {
    setImporting(undefined);
    const answer = await ism.call<Record<string, Record<string, unknown>>>('indices.get', {
      index,
      flat_settings: true,
    });
    if (gone.current) return;
    const found = answer.ok ? answer.response?.[index] : undefined;
    if (!found) {
      toasts.danger(answer.error);
      return;
    }
    setItem((before) => importedIndex(found, before.index));
    toasts.success(`Settings and mappings of [${index}] have been import successfully`);
    edited.current = false;
  };

  const importSettings = (index: string) => {
    if (edited.current) setImporting(index);
    else void importFrom(index);
  };

  const nameError = INDEX_NAMING_PATTERN.test(item.index) ? undefined : 'Invalid index name.';
  const aliasError = aliasesError(item.aliases);
  const errors = settingsErrors(item.settings);

  useImperativeHandle(ref, () => ({
    validate() {
      setSubmitted(true);
      const now = latest.current;
      return (
        INDEX_NAMING_PATTERN.test(now.index) &&
        !aliasesError(now.aliases) &&
        Object.keys(settingsErrors(now.settings)).length === 0 &&
        !fieldsHaveErrors(now.mappings?.properties ?? [], undefined, false)
      );
    },
    value: () => latest.current,
    editorText: () => editorText.current,
    rename(name) {
      setItem((before) => ({ ...before, index: name }));
      void simulate(name);
    },
    importSettings,
  }));

  const importButton =
    sourceIndices.length > 0 ? (
      <div data-test-subj="moreAction">
        <MenuButton
          align="left"
          button={(toggle) => (
            <Button size="s" icon="chevronDown" iconSide="right" onClick={toggle} testId="importSettingMappingBtn">
              Import settings and mappings
            </Button>
          )}
          items={sourceIndices.map((index) => ({
            id: index,
            label: index,
            testId: `import-settings-${index}`,
            onClick: () => importSettings(index),
          }))}
        />
      </div>
    ) : null;

  const define = (
    <div>
      <FormRow
        title="Index name"
        testId="form-name-index"
        help={<div>{INDEX_NAMING_MESSAGE}</div>}
        helpAt="bottom"
        error={submitted ? nameError : undefined}
      >
        <TextField
          compact
          value={item.index}
          onChange={(index) => setItem((before) => ({ ...before, index }))}
          onBlur={() => void simulate(item.index)}
          placeholder="Specify a name for the new index."
          invalid={submitted && Boolean(nameError)}
        />
      </FormRow>
      <FormRow fullWidth testId="form-name-templateMessage">
        {matching && (
          <CallOut tone="accent" title="The index name matches one or more index templates">
            Index alias, settings, and mappings are automatically inherited from matching index templates.
          </CallOut>
        )}
      </FormRow>
      <FormRow
        title="Index alias"
        optional
        testId="form-name-aliases"
        help="Allow this index to be referenced by existing aliases or specify a new alias."
        error={submitted ? aliasError : undefined}
      >
        <AliasSelect
          value={item.aliases}
          onChange={(aliases) => change({ aliases })}
          invalid={submitted && Boolean(aliasError)}
        />
      </FormRow>
    </div>
  );
  const settings = (
    <SettingsFields
      value={item.settings}
      onChange={(next) => change({ settings: next })}
      errors={submitted ? errors : {}}
    />
  );
  const mappings = (
    <MappingEditor
      value={item.mappings}
      onChange={(next) => change({ mappings: next })}
      showErrors={submitted}
      onEditorText={(text) => {
        editorText.current = text;
      }}
    />
  );

  return (
    <>
      {withoutPanel ? (
        // The parts one under the other, each under the theme's small title (a span, a heading and a
        // block, as the plugin has them), 24 px apart
        <>
          <span className="ismPanelTitle">Define index</span>
          <div className="ismSpacer ismSpacer--s" />
          {define}
          {importButton && (
            <>
              <div className="ismSpacer ismSpacer--l" />
              {importButton}
            </>
          )}
          <div className="ismSpacer ismSpacer--l" />
          <h2 className="ismPanelTitle">Index settings</h2>
          <div className="ismSpacer ismSpacer--s" />
          {settings}
          <div className="ismSpacer ismSpacer--l" />
          <div className="ismPanelTitle">Index mapping</div>
          <div className="ismSpacer ismSpacer--s" />
          {mappings}
        </>
      ) : (
        <>
          <FormPanel title="Define index">{define}</FormPanel>
          <div className="ismSpacer ismSpacer--l" />
          {importButton && (
            <>
              {importButton}
              <div className="ismSpacer ismSpacer--l" />
            </>
          )}
          <FormPanel title="Index settings">{settings}</FormPanel>
          <div className="ismSpacer ismSpacer--l" />
          <FormPanel
            title={
              <>
                Index mapping<i> – optional</i>
              </>
            }
            help={<MappingsHelp after="Mappings and field types cannot be changed after the index is created." />}
          >
            {mappings}
          </FormPanel>
        </>
      )}
      {simulating && (
        // Over the page, and under a flyout the form may be in
        <Portal>
          <div className="ismMask">
            <Spinner size="l" />
            We are simulating your template with existing templates, please wait for a second.
          </div>
        </Portal>
      )}
      {offered && (
        <ConfirmModal
          title="Merge your changes with templates?"
          confirmLabel="Merge with templates"
          cancelLabel="Overwrite by templates"
          onCancel={() => {
            setItem((before) => ({ ...before, ...offered, index: before.index }));
            edited.current = false;
            setMatching(true);
            setOffered(undefined);
          }}
          onConfirm={() => {
            setItem((before) => mergedWithTemplate(offered, before));
            edited.current = false;
            setMatching(true);
            setOffered(undefined);
          }}
        >
          <p data-test-subj="simulate-confirm">
            The index name matches one or more index templates. Index aliases, settings, and mappings are inherited
            from matching templates. Do you want to merge your changes with templates?
          </p>
        </ConfirmModal>
      )}
      {importing && (
        <ConfirmModal
          title="Confirm"
          confirmLabel="Overwrite"
          cancelLabel="do not import"
          onCancel={() => setImporting(undefined)}
          onConfirm={() => void importFrom(importing)}
        >
          <p>We find that you made some changes to this draft, what action do you want to make?</p>
        </ConfirmModal>
      )}
    </>
  );
});

/** Creates the index a form describes, and gives its name once the index is there */
export async function createIndex(form: IndexFormHandle | null): Promise<string | undefined> {
  if (!form?.validate()) return undefined;
  const { index, mappings, ...others } = form.value();
  const result = await ism.call('indices.create', { index, body: { ...others, mappings: remoteMappings(mappings) } });
  if (result.ok) {
    toasts.success(`${index} has been successfully created.`);
    return index;
  }
  toasts.danger(mappingErrorMessage(result.error || '', form.editorText()));
  return undefined;
}

export function CreateIndex() {
  useBreadcrumbs([CRUMBS.INDEX_MANAGEMENT, CRUMBS.INDICES, CRUMBS.CREATE_INDEX]);
  const [busy, setBusy] = useState(false);
  const form = useRef<IndexFormHandle>(null);

  const submit = async () => {
    setBusy(true);
    const created = await createIndex(form.current);
    setBusy(false);
    if (created) go(ROUTES.INDICES);
  };

  return (
    <div className="ismFormPage">
      <h1 className="ismTextTitle">Create index</h1>
      <div className="ismSpacer ismSpacer--l" />
      <IndexForm ref={form} />
      <div className="ismSpacer ismSpacer--l" />
      <div className="ismEndButtons">
        <Button variant="empty" onClick={() => go(ROUTES.INDICES)} testId="createIndexCancelButton">
          Cancel
        </Button>
        <Button variant="primary" loading={busy} onClick={submit} testId="createIndexCreateButton">
          Create
        </Button>
      </div>
    </div>
  );
}

// --- One index ----------------------------------------------------------------------------------------------

type Mode = 'settings' | 'mappings' | 'aliases';

/** One part of an index as it is and as the form has it, with what saves the difference */
function IndexPart({ index, mode, onSaved, unsaved }: { index: string; mode: Mode; onSaved: () => void; unsaved: (count: number) => void }) {
  const [old, setOld] = useState<IndexItem>();
  const [item, setItem] = useState<IndexItem>();
  const [submitted, setSubmitted] = useState(false);
  const editorText = useRef('');

  const load = useCallback(async () => {
    const answer = await ism.call<Record<string, Omit<IndexItem, 'index'>>>('indices.get', { index, flat_settings: true });
    if (!answer.ok || !answer.response?.[index]) {
      if (!answer.ok) toasts.danger(answer.error);
      return;
    }
    const remote = answer.response[index];
    const local: IndexItem = { ...remote, index, mappings: localMappings(remote.mappings) };
    setOld(local);
    setItem(JSON.parse(JSON.stringify(local)) as IndexItem);
    setSubmitted(false);
  }, [index]);
  useEffect(() => {
    void load();
  }, [load]);

  const count = !old || !item
    ? 0
    : mode === 'mappings'
      ? countChanges(remoteMappings(old.mappings), remoteMappings(item.mappings))
      : countChanges(old[mode], item[mode]);
  useEffect(() => {
    unsaved(count);
    return () => unsaved(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count]);

  if (!old || !item) return <Spinner size="l" />;

  const errors = settingsErrors(item.settings);
  const aliasError = aliasesError(item.aliases);
  const save = async () => {
    setSubmitted(true);
    if (mode === 'settings' && Object.keys(errors).length > 0) return;
    if (mode === 'aliases' && aliasError) return;
    if (mode === 'mappings' && fieldsHaveErrors(item.mappings?.properties ?? [], old.mappings?.properties, true)) return;
    let result: { ok: boolean; error?: string } = { ok: true };
    if (mode === 'settings') {
      const body = changedSettings(item.settings ?? {}, old.settings ?? {});
      if (Object.keys(body).length > 0) result = await ism.call('indices.putSettings', { index, flat_settings: true, body });
    } else if (mode === 'aliases') {
      const actions = indexAliasActions(Object.keys(old.aliases ?? {}), Object.keys(item.aliases ?? {}), index);
      if (actions.length > 0) result = await ism.call('indices.updateAliases', { body: { actions } });
    } else {
      const fields = addedFields(item.mappings?.properties ?? [], old.mappings?.properties ?? []);
      result = await ism.call('indices.putMapping', {
        index,
        body: { ...item.mappings, properties: propertiesOf(fields) },
      });
    }
    if (result.ok) {
      toasts.success(`${index} has been successfully updated.`);
      await load();
      onSaved();
    } else {
      toasts.danger(mappingErrorMessage(result.error || '', editorText.current));
    }
  };
  const change = (changes: Partial<IndexItem>) => setItem({ ...item, ...changes });
  const system = matchesAny(index, SYSTEM_INDEX);

  return (
    <>
      {system && (
        <>
          <CallOut tone="warning">
            This index may contain critical system data. Changing system indexes may break OpenSearch.
          </CallOut>
          <div className="ismSpacer ismSpacer--l" />
        </>
      )}
      {mode === 'settings' && (
        <SettingsFields
          value={item.settings}
          old={old.settings}
          onChange={(settings) => change({ settings })}
          isEdit
          errors={submitted ? errors : {}}
        />
      )}
      {mode === 'mappings' && (
        <MappingEditor
          value={item.mappings}
          old={old.mappings}
          onChange={(mappings) => change({ mappings })}
          isEdit
          showErrors={submitted}
          onEditorText={(text) => {
            editorText.current = text;
          }}
        />
      )}
      {mode === 'aliases' && (
        <FormRow
          title="Index alias"
          optional
          across
          testId="form-name-aliases"
          help="Allow this index to be referenced by existing aliases or specify a new alias."
          error={submitted ? aliasError : undefined}
        >
          <AliasSelect value={item.aliases} onChange={(aliases: AliasMap) => change({ aliases })} />
        </FormRow>
      )}
      {count > 0 && (
        <UnsavedChangesBar
          count={count}
          testId="createIndexCreateButton"
          onCancel={() => setItem({ ...item, [mode]: JSON.parse(JSON.stringify(old[mode] ?? {})) as unknown })}
          onSave={save}
        />
      )}
    </>
  );
}

const HEALTH_TONES: Record<string, Tone> = { green: 'healthy', yellow: 'warning', red: 'critical' };

interface RemoteIndex {
  settings?: { index?: { creation_date?: string; blocks?: Record<string, string> } };
  data_stream?: string;
}

const TABS: Array<{ id: Mode; label: string; title: string }> = [
  { id: 'settings', label: 'Settings', title: 'Index settings' },
  { id: 'mappings', label: 'Mappings', title: 'Index mappings' },
  { id: 'aliases', label: 'Alias', title: 'Index alias' },
];

export function IndexDetail({ index }: { index: string }) {
  useBreadcrumbs([
    CRUMBS.INDEX_MANAGEMENT,
    CRUMBS.INDICES,
    { text: index, to: `${INDEX_MANAGEMENT_PATH}#${ROUTES.INDEX_DETAIL}/${index}` },
  ]);
  const [record, setRecord] = useState<IndexRow>();
  const [detail, setDetail] = useState<RemoteIndex>();
  const [tab, setTab] = useState<Mode>('settings');
  const [leaving, setLeaving] = useState<Mode>();
  const unsaved = useRef(0);

  const refresh = useCallback(async () => {
    const got = await ism.call<Record<string, RemoteIndex>>('indices.get', { index });
    if (!got.ok || !got.response?.[index]) {
      toasts.danger(got.ok ? `[index_not_found_exception] no such index [${index}]` : got.error || '');
      go(ROUTES.INDICES);
      return;
    }
    const remote = got.response[index];
    setDetail(remote);
    const stream = remote.data_stream;
    const listed = await ism.get<{ indices: IndexRow[] }>('_indices', {
      terms: index,
      from: 0,
      size: 10,
      search: stream ? `data_streams: (${stream})` : index,
      sortField: 'index',
      sortDirection: 'desc',
      expandWildcards: 'all',
      showDataStreams: stream ? 'true' : 'false',
      exactSearch: index,
      ...(stream ? { dataStreams: stream } : {}),
    });
    if (!listed.ok) {
      toasts.danger(listed.error || '');
      go(ROUTES.INDICES);
      return;
    }
    const found = listed.response?.indices.find((item) => item.index === index);
    if (found) setRecord(found);
    else {
      toasts.danger(`[index_not_found_exception] no such index [${index}]`);
      go(ROUTES.INDICES);
    }
  }, [index]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  // An index that was opened is no longer what the page shows
  useEffect(() => onJobDone('OPEN_COMPLETE', () => void refresh()), [refresh]);

  if (!record || !detail) return null;

  const created = detail.settings?.index?.creation_date;
  const blocks = Object.entries(detail.settings?.index?.blocks ?? {})
    .filter(([, value]) => value === 'true')
    .map(([key]) => key);
  const overview: Array<[string, ReactNode]> = [
    ['Index name', <span>{record.index}</span>],
    ['Health', <Health tone={record.health ? HEALTH_TONES[record.health] : undefined}>{capital(record.health || record.status || '')}</Health>],
    ['Status', <span className="ismCapital">{record.status}</span>],
    ['Creation date', <span>{created ? new Date(parseInt(created, 10)).toLocaleString() : '-'}</span>],
    ['Total size', <span>{record['store.size']}</span>],
    ['Size of primaries', <span>{record['pri.store.size']}</span>],
    ['Total documents', <span>{record['docs.count']}</span>],
    ['Deleted documents', <span>{record['docs.deleted']}</span>],
    ['Primaries', <span>{record.pri}</span>],
    ['Replicas', <span>{record.rep}</span>],
    [
      'Index blocks',
      blocks.length === 0 ? (
        <span>-</span>
      ) : (
        <ul>
          {blocks.map((block) => (
            <li key={block}>{block}</li>
          ))}
        </ul>
      ),
    ],
    [
      'Managed by policy',
      <span>
        {record.managedPolicy ? <a href={to(ROUTES.POLICY_DETAILS, { id: record.managedPolicy })}>{record.managedPolicy}</a> : '-'}
      </span>,
    ],
  ];
  const shown = TABS.find((item) => item.id === tab) ?? TABS[0];

  // As the plugin's page: its title and actions, the overview, then the tabs, 24 px apart
  return (
    <div className="ismIndexDetail">
      <div className="ismIndexDetail__header">
        <h1 className="ismTextTitle">{index}</h1>
        <IndicesActions selected={[record]} onChange={() => void refresh()} onDelete={() => go(ROUTES.INDICES)} />
      </div>
      <div className="ismSpacer ismSpacer--l" />
      <Panel>
        <h2 className="ismPanelTitle">Overview</h2>
        <hr className="ismRule" />
        <dl className="ismOverviewList">
          <div className="ismSpacer ismSpacer--s" />
          <div>
            {overview.map(([label, value]) => (
              <div key={label} className="ismOverviewList__item" data-test-subj={`indexDetailOverviewItem-${label}`}>
                <dt>{label}</dt>
                <dd style={label === 'Index name' ? { wordBreak: 'break-word' } : undefined}>{value}</dd>
              </div>
            ))}
          </div>
        </dl>
      </Panel>
      <div className="ismSpacer ismSpacer--l" />
      <Tabs
        tabs={TABS.map((item) => ({ id: item.id, label: item.label }))}
        selected={tab}
        onSelect={(id) => {
          if (id === tab) return;
          if (unsaved.current > 0) setLeaving(id as Mode);
          else setTab(id as Mode);
        }}
      />
      <div className="ismSpacer ismSpacer--m" />
      <Panel>
        <h2 className="ismPanelTitle">{shown.title}</h2>
        {tab === 'mappings' && (
          <div className="ismHelpText">
            <MappingsHelp after="Mappings and field types cannot be changed once they have been added." />
          </div>
        )}
        <hr className="ismRule" />
        {/* 16 px under the rule for every tab: the alias form's row of a template's message, empty, has 16 above it */}
        <div className="ismSpacer ismSpacer--s" />
        <IndexPart
          key={tab}
          index={index}
          mode={tab}
          onSaved={() => void refresh()}
          unsaved={(count) => {
            unsaved.current = count;
          }}
        />
      </Panel>
      {leaving && (
        <ConfirmModal
          title="You have unsaved changes."
          confirmLabel="Stay"
          cancelLabel="Leave without changes"
          onConfirm={() => setLeaving(undefined)}
          onCancel={() => {
            setTab(leaving);
            setLeaving(undefined);
          }}
        >
          <p>Are you sure you want to leave this tab?</p>
        </ConfirmModal>
      )}
    </div>
  );
}

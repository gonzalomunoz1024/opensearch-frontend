/* SPDX-License-Identifier: Apache-2.0 */

/* The page that creates an index, and the page that shows one index and changes what can be changed. */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, CallOut, Health, Panel, Spinner, Tabs, type Tone } from '../../components/basic';
import { TextField } from '../../components/form';
import { ConfirmModal } from '../../components/overlay';
import { useBreadcrumbs } from '../../shell/state';
import { Labeled, UnsavedBar, capital, go, ism, to, toasts } from './common';
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
import { onJobDone } from './operations';
import { CRUMBS, INDEX_MANAGEMENT_PATH, ROUTES } from './routes';

const MAPPINGS_DOCS = 'https://opensearch.org/docs/latest/opensearch/mappings/';

function MappingsHelp({ after }: { after: string }) {
  return (
    <>
      <div>
        Define how documents and their fields are stored and indexed.{' '}
        <a href={MAPPINGS_DOCS} target="_blank" rel="noreferrer">
          Learn more
        </a>
      </div>
      <div>{after}</div>
    </>
  );
}

function FormPanel({ title, help, children }: { title: ReactNode; help?: ReactNode; children: ReactNode }) {
  return (
    <Panel>
      <h2 className="ismPanel__heading">{title}</h2>
      {help && <div className="ismLabeled__help">{help}</div>}
      <hr className="ismRule" />
      {children}
    </Panel>
  );
}

// --- Create index -------------------------------------------------------------------------------------------

export function CreateIndex() {
  useBreadcrumbs([CRUMBS.INDEX_MANAGEMENT, CRUMBS.INDICES, CRUMBS.CREATE_INDEX]);
  const [item, setItem] = useState<IndexItem>(defaultIndex);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [matching, setMatching] = useState(false);
  const [offered, setOffered] = useState<IndexItem>();
  // Whether anything but the name was filled in since the templates were last asked
  const edited = useRef(false);
  const editorText = useRef('');
  const gone = useRef(false);
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
  const simulate = async () => {
    const name = item.index;
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

  const nameError = INDEX_NAMING_PATTERN.test(item.index) ? undefined : 'Invalid index name.';
  const aliasError = aliasesError(item.aliases);
  const errors = settingsErrors(item.settings);

  const submit = async () => {
    setSubmitted(true);
    const wrongFields = fieldsHaveErrors(item.mappings?.properties ?? [], undefined, false);
    if (nameError || aliasError || Object.keys(errors).length > 0 || wrongFields) return;
    setBusy(true);
    const { index, mappings, ...others } = item;
    const result = await ism.call('indices.create', { index, body: { ...others, mappings: remoteMappings(mappings) } });
    setBusy(false);
    if (result.ok) {
      toasts.success(`${index} has been successfully created.`);
      go(ROUTES.INDICES);
    } else {
      toasts.danger(mappingErrorMessage(result.error || '', editorText.current));
    }
  };

  return (
    <div className="ismPage ismPage--form">
      <h1 className="ismPageTitle">Create index</h1>
      <FormPanel title="Define index">
        <div className="ismForm">
          <Labeled title="Index name" testId="form-name-index" error={submitted ? nameError : undefined}>
            <TextField
              compact
              value={item.index}
              onChange={(index) => setItem((before) => ({ ...before, index }))}
              onBlur={() => void simulate()}
              placeholder="Specify a name for the new index."
              invalid={submitted && Boolean(nameError)}
            />
            <div className="ismLabeled__help">{INDEX_NAMING_MESSAGE}</div>
          </Labeled>
          {matching && (
            <CallOut tone="accent" title="The index name matches one or more index templates">
              Index alias, settings, and mappings are automatically inherited from matching index templates.
            </CallOut>
          )}
          <Labeled
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
          </Labeled>
        </div>
      </FormPanel>
      <FormPanel title="Index settings">
        <SettingsFields
          value={item.settings}
          onChange={(settings) => change({ settings })}
          errors={submitted ? errors : {}}
        />
      </FormPanel>
      <FormPanel
        title={
          <>
            Index mapping<i> – optional</i>
          </>
        }
        help={<MappingsHelp after="Mappings and field types cannot be changed after the index is created." />}
      >
        <MappingEditor
          value={item.mappings}
          onChange={(mappings) => change({ mappings })}
          showErrors={submitted}
          onEditorText={(text) => {
            editorText.current = text;
          }}
        />
      </FormPanel>
      <div className="ismButtons">
        <Button variant="empty" size="s" onClick={() => go(ROUTES.INDICES)} testId="createIndexCancelButton">
          Cancel
        </Button>
        <Button variant="primary" size="s" loading={busy} onClick={submit} testId="createIndexCreateButton">
          Create
        </Button>
      </div>
      {simulating && (
        <div className="ismMask">
          <Spinner size="l" />
          We are simulating your template with existing templates, please wait for a second.
        </div>
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
    </div>
  );
}

// --- One index ----------------------------------------------------------------------------------------------

type Mode = 'settings' | 'mappings' | 'aliases';

/** One part of an index as it is and as the form has it, with what saves the difference */
function IndexPart({ index, mode, onSaved, unsaved }: { index: string; mode: Mode; onSaved: () => void; unsaved: (count: number) => void }) {
  const [old, setOld] = useState<IndexItem>();
  const [item, setItem] = useState<IndexItem>();
  const [busy, setBusy] = useState(false);
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
    setBusy(true);
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
    setBusy(false);
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
        <CallOut tone="warning">
          This index may contain critical system data. Changing system indexes may break OpenSearch.
        </CallOut>
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
        <div className="ismForm">
          <Labeled
            title="Index alias"
            optional
            across
            testId="form-name-aliases"
            help="Allow this index to be referenced by existing aliases or specify a new alias."
            error={submitted ? aliasError : undefined}
          >
            <AliasSelect value={item.aliases} onChange={(aliases: AliasMap) => change({ aliases })} />
          </Labeled>
        </div>
      )}
      {count > 0 && (
        <UnsavedBar
          count={count}
          busy={busy}
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
    ['Index name', record.index],
    ['Health', <Health tone={record.health ? HEALTH_TONES[record.health] : undefined}>{capital(record.health || record.status || '')}</Health>],
    ['Status', capital(record.status ?? '')],
    ['Creation date', created ? new Date(parseInt(created, 10)).toLocaleString() : ''],
    ['Total size', record['store.size']],
    ['Size of primaries', record['pri.store.size']],
    ['Total documents', record['docs.count']],
    ['Deleted documents', record['docs.deleted']],
    ['Primaries', record.pri],
    ['Replicas', record.rep],
    [
      'Index blocks',
      blocks.length === 0 ? (
        '-'
      ) : (
        <ul className="ismBlocks">
          {blocks.map((block) => (
            <li key={block}>{block}</li>
          ))}
        </ul>
      ),
    ],
    [
      'Managed by policy',
      record.managedPolicy ? <a href={to(ROUTES.POLICY_DETAILS, { id: record.managedPolicy })}>{record.managedPolicy}</a> : '-',
    ],
  ];
  const shown = TABS.find((item) => item.id === tab) ?? TABS[0];

  return (
    <div className="ismPage ismPage--details">
      <div className="ismPageHeader ismPageHeader--center">
        <h1 className="ismPageTitle">{index}</h1>
        <IndicesActions selected={[record]} onChange={() => void refresh()} onDelete={() => go(ROUTES.INDICES)} />
      </div>
      <Panel>
        <h2 className="ismPanel__heading">Overview</h2>
        <hr className="ismRule" />
        <div className="ismOverview">
          {overview.map(([label, value]) => (
            <div key={label} className="ismOverview__item" data-test-subj={`indexDetailOverviewItem-${label}`}>
              <h4>{label}</h4>
              <div>{value}</div>
            </div>
          ))}
        </div>
      </Panel>
      <Tabs
        tabs={TABS.map((item) => ({ id: item.id, label: item.label }))}
        selected={tab}
        onSelect={(id) => {
          if (id === tab) return;
          if (unsaved.current > 0) setLeaving(id as Mode);
          else setTab(id as Mode);
        }}
      />
      <Panel>
        <h2 className="ismPanel__heading">{shown.title}</h2>
        {tab === 'mappings' && (
          <div className="ismLabeled__help">
            <MappingsHelp after="Mappings and field types cannot be changed once they have been added." />
          </div>
        )}
        <hr className="ismRule" />
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

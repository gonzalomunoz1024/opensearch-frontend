/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Policy managed indexes: which index is under which policy and how far it has got, and the
 * page that moves managed indexes to another policy.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, CodeBlock } from '../../components/basic';
import { ComboBox } from '../../components/combo_box';
import { FormRow, RadioGroup, Select, Switch, TextField } from '../../components/form';
import { Modal, copyText } from '../../components/overlay';
import { useBreadcrumbs } from '../../shell/state';
import {
  ActionModal,
  BottomBar,
  ConfirmationModal,
  ContentPanel,
  ExternalLink,
  FilterButton,
  PageTitle,
  PanelButton,
  SearchRow,
  Section,
  Table,
  go,
  ism,
  to,
  toasts,
  useListQuery,
  type TableColumn,
} from './common';
import { InfoModal } from './indices';
import { searchClauses, withDataStreams } from './model';
import { EditorChoiceModal } from './policies';
import type { Policy } from './policy_model';
import { CRUMBS, ROUTES } from './routes';

interface MetaData {
  policySeqNo?: number;
  policyCompleted?: boolean;
  state?: { name?: string };
  action?: { name?: string; failed?: boolean };
  retryInfo?: { failed?: boolean };
  info?: { message?: string };
}

export interface ManagedIndex {
  index: string;
  indexUuid: string;
  dataStream: string | null;
  policyId: string;
  policy: Policy | null;
  enabled: boolean;
  managedIndexMetaData: MetaData | null;
}

interface Changed {
  updatedIndices: number;
  failures: boolean;
  failedIndices: Array<{ indexName: string; reason: string }>;
}

const failedList = (failed: Changed['failedIndices']) =>
  failed.map((item) => `[${item.indexName}, ${item.reason}]`).join(', ');

/** How the job of a managed index is doing */
export function jobStatus(item: ManagedIndex): string {
  const meta = item.managedIndexMetaData;
  if (!meta) return 'Initializing';
  if (meta.policyCompleted) return 'Completed';
  if (meta.retryInfo?.failed || meta.action?.failed) return 'Failed';
  return 'Running';
}

// --- Dialogs --------------------------------------------------------------------------------------------

function PolicyModal({ item, onClose }: { item: ManagedIndex; onClose: () => void }) {
  let error: string | undefined;
  if (item.managedIndexMetaData?.policySeqNo == null) error = 'Still initializing, please wait a moment';
  if (!item.policy) error = `Failed to load the policy: ${item.policyId}`;
  const text = JSON.stringify(item.policy, null, 4);
  const [choosing, setChoosing] = useState(false);
  if (choosing) {
    return (
      <EditorChoiceModal
        isEdit
        onClose={onClose}
        onContinue={(visual) => go(ROUTES.EDIT_POLICY, visual ? { id: item.policyId, type: 'visual' } : { id: item.policyId })}
      />
    );
  }
  return (
    <Modal
      title={item.policyId}
      onClose={onClose}
      wide
      footer={
        <>
          <Button
            variant="empty"
            size="s"
            icon="copy"
            disabled={!item.policy}
            onClick={() => copyText(text)}
            testId="policyModalCopyButton"
            style={{ marginRight: 'auto' }}
          >
            Copy
          </Button>
          <Button variant="empty" size="s" onClick={onClose} testId="policyModalCloseButton">
            Close
          </Button>
          <Button
            variant="primary"
            size="s"
            disabled={!item.policyId || !item.policy}
            onClick={() => setChoosing(true)}
            testId="policyModalEditButton"
          >
            Edit
          </Button>
        </>
      }
    >
      <CodeBlock style={{ minWidth: 600, maxHeight: '60vh', overflow: 'auto' }}>{error ?? text}</CodeBlock>
    </Modal>
  );
}

function RetryModal({ items, onClose }: { items: ManagedIndex[]; onClose: () => void }) {
  // Only the states every chosen index has can be started from
  const states = useMemo(() => {
    let common: string[] | undefined;
    for (const item of items) {
      const names = item.policy?.states?.map((state) => state.name);
      if (!names) return [];
      common = common ? common.filter((name) => names.includes(name)) : names;
    }
    return common ?? [];
  }, [items]);
  const [from, setFrom] = useState<'current' | 'state'>('current');
  const [state, setState] = useState(states[0] ?? '');

  const retry = async () => {
    const answer = await ism.post<Changed>('retry', {
      index: items.map((item) => item.index),
      ...(from === 'state' ? { state } : {}),
    });
    if (answer.ok && answer.response) {
      const { updatedIndices, failedIndices, failures } = answer.response;
      if (failures) toasts.danger(`Failed to retry: ${failedList(failedIndices)}`);
      if (updatedIndices) toasts.success(`Retried ${updatedIndices} managed indexes`);
    } else {
      toasts.danger(answer.error);
    }
    onClose();
  };

  return (
    <ActionModal
      title="Retry policy"
      label="Retry"
      disabled={items.length === 0}
      onClose={onClose}
      onConfirm={retry}
      cancelTestId="retryModalCloseButton"
      confirmTestId="retryModalRetryButton"
    >
      <RadioGroup
        options={[
          { id: 'current', label: 'Retry policy from current action' },
          { id: 'state', label: 'Retry policy from selected state' },
        ]}
        value={from}
        onChange={(next) => (next === 'state' && states.length === 0 ? undefined : setFrom(next))}
      />
      <FormRow label="Start state" help="Only common states shared across all selected indexes are available">
        <Select
          compact
          disabled={from !== 'state'}
          value={state}
          onChange={setState}
          options={states.map((name) => ({ value: name, label: name }))}
          aria-label="Retry failed policy from"
        />
      </FormRow>
    </ActionModal>
  );
}

function RolloverAliasModal({ index, onClose }: { index: string; onClose: () => void }) {
  const [alias, setAlias] = useState('');
  const edit = async () => {
    const answer = await ism.post<{ acknowledged?: boolean }>('editRolloverAlias', { index, alias });
    if (!answer.ok) toasts.danger(answer.error);
    else if (answer.response?.acknowledged) toasts.success(`Edited rollover alias on ${index}`);
    else toasts.danger(`Failed to edit rollover alias on ${index}`);
    onClose();
  };
  return (
    <ActionModal
      title="Edit rollover alias"
      label="Edit"
      disabled={!alias}
      onClose={onClose}
      onConfirm={edit}
      cancelTestId="editRolloverAliasModalCloseButton"
      confirmTestId="editRolloverAliasModalAddButton"
    >
      <FormRow label="Rollover alias" help="A rollover alias is required when using the rollover action.">
        <TextField compact placeholder="Rollover alias" value={alias} onChange={setAlias} />
      </FormRow>
    </ActionModal>
  );
}

// --- The list ---------------------------------------------------------------------------------------------

const EMPTY = {
  filtered: 'There are no managed indexes matching your applied filters. Reset your filters to view your managed indexes.',
  none: 'There are no existing managed indexes. Create a policy to add to an index.',
  loading: 'Loading managed indexes...',
};

export function ManagedIndices() {
  useBreadcrumbs([CRUMBS.INDEX_MANAGEMENT, CRUMBS.MANAGED_INDICES]);
  const [query, setQuery] = useListQuery({ sortField: 'index' }, { showDataStreams: 'false' });
  const showDataStreams = query.showDataStreams === 'true';
  const [rows, setRows] = useState<ManagedIndex[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ManagedIndex[]>([]);
  const [withDataStream, setWithDataStream] = useState(showDataStreams);
  const [dataStreams, setDataStreams] = useState<string[]>();
  const [dialog, setDialog] = useState<
    | { kind: 'policy' | 'info'; item: ManagedIndex }
    | { kind: 'retry' | 'remove' | 'rollover' | 'create' }
  >();
  const turn = useRef(0);
  const clauses = useMemo(() => searchClauses(query.search), [query.search]);

  const load = async () => {
    const mine = (turn.current += 1);
    setLoading(true);
    const answer = await ism.get<{ managedIndices: ManagedIndex[]; totalManagedIndices: number }>('managedIndices', {
      from: query.from,
      size: query.size,
      search: query.search,
      sortField: query.sortField,
      sortDirection: query.sortDirection,
      showDataStreams,
      terms: clauses.terms,
      indices: clauses.indices,
      dataStreams: clauses.dataStreams,
    });
    if (mine !== turn.current) return;
    if (answer.ok && answer.response) {
      setRows(answer.response.managedIndices);
      setTotal(answer.response.totalManagedIndices);
      setSelected([]);
    } else {
      toasts.danger(answer.error || 'There was a problem loading the managed indexes');
    }
    setLoading(false);
    setWithDataStream(showDataStreams);
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.from, query.size, query.search, query.sortField, query.sortDirection, showDataStreams]);

  useEffect(() => {
    if (!showDataStreams || dataStreams) return;
    void ism.get<{ dataStreams: Array<{ name: string }> }>('_data_streams').then((answer) => {
      if (answer.ok && answer.response) setDataStreams(answer.response.dataStreams.map((stream) => stream.name));
      else if (answer.error) toasts.warning(answer.error);
    });
  }, [showDataStreams, dataStreams]);

  const columns = useMemo(() => {
    const all: Array<TableColumn<ManagedIndex>> = [
      { field: 'index', name: 'Index', sortable: true, render: (row) => <span title={row.index}>{row.index}</span> },
      { field: 'dataStream', name: 'Data stream', sortable: true, render: (row) => row.dataStream || '-' },
      {
        field: 'policyId',
        name: 'Policy',
        sortable: true,
        render: (row) => (
          <button type="button" className="atlLinkButton" onClick={() => setDialog({ kind: 'policy', item: row })}>
            {row.policyId}
          </button>
        ),
      },
      { field: 'managedIndexMetaData.state.name', name: 'State', render: (row) => row.managedIndexMetaData?.state?.name || '-' },
      {
        field: 'managedIndexMetaData.action.name',
        name: 'Action',
        render: (row) => (
          <span style={{ textTransform: 'capitalize' }}>
            {(row.managedIndexMetaData?.action?.name || '-').split('_').join(' ')}
          </span>
        ),
      },
      {
        field: 'managedIndexMetaData.info',
        name: 'Info',
        render: (row) => (
          <button type="button" className="atlLinkButton" onClick={() => setDialog({ kind: 'info', item: row })}>
            {row.managedIndexMetaData?.info?.message ?? '-'}
          </button>
        ),
      },
      { field: 'jobStatus', name: 'Job Status', render: jobStatus },
    ];
    return withDataStream ? all : all.filter((column) => column.field !== 'dataStream');
  }, [withDataStream]);

  const removePolicy = async () => {
    const answer = await ism.post<Changed>('removePolicy', { indices: selected.map((item) => item.index) });
    if (!answer.ok || !answer.response) {
      toasts.danger(answer.error);
      return;
    }
    const { updatedIndices, failedIndices, failures } = answer.response;
    if (updatedIndices) toasts.success(`Removed policy from ${updatedIndices} managed indexes`);
    if (failures) toasts.danger(`Failed to remove policy from ${failedList(failedIndices)}`);
    await load();
  };

  const retryDisabled =
    selected.length === 0 ||
    selected.some((item) => {
      const meta = item.managedIndexMetaData;
      return !meta || (!meta.retryInfo?.failed && !meta.action?.failed);
    });
  const dataStreamSelected = selected.some((item) => item.dataStream !== null);
  const what =
    selected.length === 1 ? `policy from ${selected[0].index}` : `policies from ${selected.length} indexes`;
  const filtered = query.search !== '';
  const close = () => setDialog(undefined);

  return (
    <>
      <div className="ismAbove">
        <Button size="s" icon="refresh" onClick={load} testId="refreshButton">
          Refresh
        </Button>
        <Button size="s" to={to(ROUTES.CHANGE_POLICY)} testId="changePolicyButton">
          Change policy
        </Button>
      </div>
      <ContentPanel
        title="Policy managed indexes"
        count={total}
        actions={
          <>
            <PanelButton
              text="Edit rollover alias"
              disabled={selected.length !== 1 || dataStreamSelected}
              onClick={() => setDialog({ kind: 'rollover' })}
            />
            <PanelButton text="Remove policy" disabled={selected.length === 0} onClick={() => setDialog({ kind: 'remove' })} />
            <PanelButton text="Retry policy" disabled={retryDisabled} onClick={() => setDialog({ kind: 'retry' })} />
          </>
        }
      >
        <SearchRow
          search={query.search}
          onSearch={(search) => setQuery({ search, from: 0 })}
          placeholder="Search index name"
        >
          {showDataStreams && (
            <FilterButton
              name="Data streams"
              options={(dataStreams ?? []).map((value) => ({ value }))}
              selected={clauses.dataStreams}
              onChange={(values) => setQuery({ search: withDataStreams(query.search, values.slice(-1)), from: 0 })}
              empty="No data streams found"
            />
          )}
          <Switch
            label="Show data stream indexes"
            checked={showDataStreams}
            onChange={(checked) => setQuery({ showDataStreams: String(checked) })}
            testId="toggleShowDataStreams"
          />
        </SearchRow>
        <Table
          columns={columns}
          rows={rows}
          total={total}
          query={query}
          onQuery={setQuery}
          rowId={(row) => row.index}
          selected={selected}
          onSelect={setSelected}
          loading={loading}
          empty={
            <div className="ismEmpty">
              <p>{loading ? EMPTY.loading : filtered ? EMPTY.filtered : EMPTY.none}</p>
              {!loading &&
                (filtered ? (
                  <Button
                    variant="primary"
                    size="s"
                    onClick={() => setQuery({ search: '' })}
                    testId="managedIndexEmptyPromptResetFilters"
                  >
                    Reset Filters
                  </Button>
                ) : (
                  <Button variant="primary" size="s" icon="plus" onClick={() => setDialog({ kind: 'create' })}>
                    Create policy
                  </Button>
                ))}
            </div>
          }
        />
      </ContentPanel>
      {dialog?.kind === 'policy' && <PolicyModal item={dialog.item} onClose={close} />}
      {dialog?.kind === 'info' && (
        <InfoModal title="Managed Index Info" onClose={close}>
          <CodeBlock>{JSON.stringify(dialog.item.managedIndexMetaData?.info, null, 2) ?? ''}</CodeBlock>
        </InfoModal>
      )}
      {dialog?.kind === 'rollover' && selected.length === 1 && (
        <RolloverAliasModal index={selected[0].index} onClose={close} />
      )}
      {dialog?.kind === 'retry' && <RetryModal items={selected} onClose={close} />}
      {dialog?.kind === 'remove' && (
        <ConfirmationModal
          title={`Remove ${what}`}
          bodyMessage={`Remove ${what} permanently? This action cannot be undone.`}
          actionMessage="Remove"
          onClose={close}
          onAction={removePolicy}
        />
      )}
      {dialog?.kind === 'create' && (
        <EditorChoiceModal
          onClose={close}
          onContinue={(visual) => go(ROUTES.CREATE_POLICY, visual ? { type: 'visual' } : {})}
        />
      )}
    </>
  );
}

// --- Moving managed indexes to another policy -------------------------------------------------------------

interface PolicyOption {
  id: string;
  policy: Policy;
}

export function ChangePolicy() {
  useBreadcrumbs([CRUMBS.INDEX_MANAGEMENT, CRUMBS.MANAGED_INDICES, CRUMBS.CHANGE_POLICY]);
  const [managed, setManaged] = useState<ManagedIndex[]>([]);
  const [managedLoading, setManagedLoading] = useState(false);
  const [managedSearch, setManagedSearch] = useState('');
  const [selectedIndices, setSelectedIndices] = useState<string[]>([]);
  const [stateFilters, setStateFilters] = useState<string[]>([]);
  const [policies, setPolicies] = useState<PolicyOption[]>([]);
  const [policiesLoading, setPoliciesLoading] = useState(false);
  const [policyId, setPolicyId] = useState<string>();
  const [after, setAfter] = useState<'current' | 'state'>('current');
  const [state, setState] = useState('');
  const [submitted, setSubmitted] = useState(false);
  // The managed indexes seen so far, so that a chosen one keeps its policy when the list changes
  const seen = useRef(new Map<string, ManagedIndex>());

  const searchManaged = async (search: string) => {
    setManagedSearch(search);
    setManagedLoading(true);
    const answer = await ism.get<{ managedIndices: ManagedIndex[] }>('managedIndices', {
      from: 0,
      size: 10,
      search,
      sortDirection: 'desc',
      sortField: 'name',
      showDataStreams: true,
    });
    if (answer.ok && answer.response) {
      for (const item of answer.response.managedIndices) seen.current.set(item.index, item);
      setManaged(answer.response.managedIndices);
    } else if (answer.error?.startsWith('[index_not_found_exception]')) {
      toasts.danger('You have not created a managed index yet');
    } else {
      toasts.danger(answer.error);
    }
    setManagedLoading(false);
  };

  const searchPolicies = async (search: string) => {
    setPoliciesLoading(true);
    const answer = await ism.get<{ policies: PolicyOption[] }>('policies', {
      from: 0,
      size: 10,
      search: search.trim(),
      sortDirection: 'desc',
      sortField: 'id',
    });
    if (answer.ok && answer.response) setPolicies(answer.response.policies);
    else if (answer.error?.startsWith('[index_not_found_exception]')) toasts.danger('You have not created a policy yet');
    else toasts.danger(answer.error);
    setPoliciesLoading(false);
  };

  useEffect(() => {
    void searchManaged('');
    void searchPolicies('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pattern = managedSearch.trim() ? [`${managedSearch}*`] : [];
  const indexOptions = [...new Set([...pattern, ...managed.map((item) => item.index), ...selectedIndices])];
  const uniqueStates = [
    ...new Set(
      selectedIndices.flatMap((name) => seen.current.get(name)?.policy?.states?.map((item) => item.name) ?? [])
    ),
  ];
  const selectedPolicy = policies.find((option) => option.id === policyId);
  const newStates = selectedPolicy?.policy.states?.map((item) => item.name) ?? [];
  const indicesError = selectedIndices.length > 0 ? '' : 'Required';
  const policyError = policyId ? '' : 'Required';

  const submit = async () => {
    setSubmitted(true);
    if (indicesError || policyError || !policyId) return;
    const answer = await ism.post<Changed>('changePolicy', {
      indices: selectedIndices,
      policyId,
      state: after === 'state' ? state : null,
      include: stateFilters.map((name) => ({ state: name })),
    });
    if (!answer.ok || !answer.response) {
      toasts.danger(answer.error);
      return;
    }
    const { updatedIndices, failedIndices, failures } = answer.response;
    if (updatedIndices) toasts.success(`Changed policy on ${updatedIndices} indexes`);
    if (failures) toasts.danger(`Failed to change policy on ${failedList(failedIndices)}`);
  };

  return (
    <div className="ismPage ismPage--narrow">
      <PageTitle title="Change policy" />
      <Section title="Choose managed indices">
        <FormRow
          label="Managed indices"
          help="You can use * as wildcards to form index patterns."
          error={submitted ? indicesError || undefined : undefined}
        >
          <ComboBox
            options={indexOptions.map((value) => ({ value, label: value }))}
            selected={selectedIndices}
            onChange={(next) => {
              setSelectedIndices(next);
              if (next.length === 0) setStateFilters([]);
            }}
            onSearch={searchManaged}
            loading={managedLoading}
            invalid={submitted && Boolean(indicesError)}
          />
        </FormRow>
        <FormRow label="State filters" help="Apply new policy only on managed indices in these states.">
          <ComboBox
            disabled={selectedIndices.length === 0}
            placeholder="Choose state filters"
            options={uniqueStates.map((value) => ({ value, label: value }))}
            selected={stateFilters}
            onChange={setStateFilters}
            allowCustom
          />
        </FormRow>
      </Section>
      <Section
        title="Choose new policy"
        description={
          <>
            When the new policy will take effect depends on the current state of indices and the states of the new
            policy. <ExternalLink href="https://opensearch.org/docs/im-plugin/ism/index/" />
          </>
        }
      >
        <FormRow label="New policy" error={submitted ? policyError || undefined : undefined}>
          <ComboBox
            single
            options={policies.map((option) => ({ value: option.id, label: option.id }))}
            selected={policyId ? [policyId] : []}
            onChange={([next]) => {
              setPolicyId(next);
              setState('');
              setAfter('current');
            }}
            onSearch={searchPolicies}
            loading={policiesLoading}
            invalid={submitted && Boolean(policyError)}
          />
        </FormRow>
        <RadioGroup
          options={[
            { id: 'current', label: 'Keep indices in their current state after the policy takes effect' },
            { id: 'state', label: 'Switch indices to the following state after the policy takes effect' },
          ]}
          value={after}
          onChange={(next) => {
            if (next === 'state' && (!selectedPolicy || newStates.length === 0)) return;
            setAfter(next);
            if (next === 'state' && !state) setState(newStates[0] ?? '');
          }}
        />
        <div style={{ maxWidth: 400 }}>
          <Select
            compact
            disabled={after !== 'state'}
            value={state}
            onChange={setState}
            options={newStates.map((name) => ({ value: name, label: name }))}
            aria-label="Start state for new policy"
          />
        </div>
      </Section>
      <BottomBar>
        <Button variant="empty" size="s" onClick={() => window.history.back()} testId="changePolicyCancelButton">
          Cancel
        </Button>
        <Button variant="primary" size="s" onClick={submit} testId="changePolicyChangeButton">
          Change
        </Button>
      </BottomBar>
    </div>
  );
}

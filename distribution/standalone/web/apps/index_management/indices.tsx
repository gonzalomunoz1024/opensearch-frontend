/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Indexes: every index with its health, size and counts, searched, sorted and paged by the
 * server, and what can be done to the ticked ones.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, CallOut, Health, IconButton } from '../../components/basic';
import { ComboBox } from '../../components/combo_box';
import { Switch, TextField } from '../../components/form';
import { Modal, copyText, type MenuItem } from '../../components/overlay';
import { useBreadcrumbs } from '../../shell/state';
import {
  ActionsMenu,
  ExternalLink,
  SearchRow,
  Table,
  go,
  ism,
  toasts,
  useListQuery,
  type TableColumn,
} from './common';
import { ContentPanel, ContentPanelActions, ListEmpty } from './content_panel';
import { HEALTH_TONES } from './data_streams';
import { FilterBox } from './filter_box';
import { FormRow } from './form_row';
import { JsonBlock } from './json_block';
import { ModalButtons, ModalNames, PluginModal, TypeTheWord } from './plugin_modal';
import { SYSTEM_INDEX, matchesAny, orDash, searchClauses, withDataStreams } from './model';
import { addJob, clusterInfo, startedToast } from './job_handlers';
import { onJobDone, type JobEvent } from './jobs';
import { ClearCacheModal, FlushModal, RefreshModal } from './operations';
import { CRUMBS } from './routes';

export interface IndexRow {
  index: string;
  health?: string;
  status?: string;
  extraStatus?: string;
  managed?: string;
  managedPolicy?: string;
  data_stream: string | null;
  uuid?: string;
  pri?: string;
  rep?: string;
  'store.size'?: string;
  'pri.store.size'?: string;
  'docs.count'?: string;
  'docs.deleted'?: string;
}

const ROLLOVER_DOCS = 'https://opensearch.org/docs/latest/im-plugin/ism/policies/#rollover';

/**
 * The name of an index after the button that copies it, leading to its details. As in the plugin,
 * both flow as words do: a name too long for the rest of the line goes under the button.
 */
export function IndexName({ index }: { index: string }) {
  return (
    <>
      <span className="ismIndexName__copy">
        <IconButton icon="copyClipboard" iconSize="s" label="Copy" size="s" onClick={() => copyText(index)} />
      </span>
      <a
        href={`#/index-detail/${index}`}
        className="ismIndexName__link"
        data-test-subj={`viewIndexDetailButton-${index}`}
      >
        {index}
      </a>
    </>
  );
}

export function indicesColumns(withDataStream: boolean): Array<TableColumn<IndexRow>> {
  const columns: Array<TableColumn<IndexRow>> = [
    { field: 'index', name: 'Index', sortable: true, width: '250px', render: (row) => <IndexName index={row.index} /> },
    {
      field: 'health',
      name: 'Health',
      sortable: true,
      truncate: true,
      // As it comes, shown with a capital; a closed index has its status in its place
      render: (row) => (
        <span className="ismCapitalize">
          <Health tone={row.health ? HEALTH_TONES[row.health] : undefined}>{row.health || row.status}</Health>
        </span>
      ),
    },
    {
      field: 'data_stream',
      name: 'Data stream',
      sortable: true,
      truncate: true,
      width: '120px',
      render: (row) =>
        row.data_stream ? <a href={`#/create-data-stream/${row.data_stream}`}>{row.data_stream}</a> : '-',
    },
    { field: 'managed', name: 'Managed by policy', sortable: true, truncate: true, render: (row) => orDash(row.managed) },
    {
      field: 'status',
      name: 'Status',
      sortable: true,
      truncate: true,
      render: (row) => <span className="ismCapital">{row.extraStatus || row.status}</span>,
    },
    {
      field: 'store.size',
      name: 'Total size',
      sortable: true,
      truncate: true,
      align: 'right',
      render: (row) => orDash(row['store.size']),
    },
    {
      field: 'pri.store.size',
      name: 'Size of primaries',
      sortable: true,
      truncate: true,
      align: 'right',
      render: (row) => orDash(row['pri.store.size']),
    },
    {
      field: 'docs.count',
      name: 'Total documents',
      sortable: true,
      truncate: true,
      align: 'right',
      render: (row) => <span title={row['docs.count']}>{row['docs.count'] || '-'}</span>,
    },
    {
      field: 'docs.deleted',
      name: 'Deleted documents',
      sortable: true,
      truncate: true,
      align: 'right',
      render: (row) => <span title={row['docs.deleted']}>{row['docs.deleted'] || '-'}</span>,
    },
    { field: 'pri', name: 'Primaries', sortable: true, truncate: true, align: 'right', render: (row) => row.pri },
    { field: 'rep', name: 'Replicas', sortable: true, truncate: true, align: 'right', render: (row) => row.rep },
  ];
  return withDataStream ? columns : columns.filter((column) => column.field !== 'data_stream');
}

// --- What can be done to the ticked indexes ---------------------------------------------------------------

interface PolicyOption {
  id: string;
  policy: { states?: Array<{ actions?: Array<Record<string, unknown>> }> };
}

/** Puts the chosen indices under a policy */
export function ApplyPolicyModal({ indices, onClose }: { indices: string[]; onClose: () => void }) {
  const [options, setOptions] = useState<PolicyOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<PolicyOption>();
  const [rolloverAlias, setRolloverAlias] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const search = async (text: string) => {
    setLoading(true);
    const answer = await ism.get<{ policies: PolicyOption[] }>('policies', {
      from: 0,
      size: 10,
      search: text.trim(),
      sortDirection: 'desc',
      sortField: 'id',
    });
    if (answer.ok && answer.response) setOptions(answer.response.policies);
    else if (answer.error?.startsWith('[index_not_found_exception]')) toasts.danger('You have not created a policy yet');
    else toasts.danger(answer.error);
    setLoading(false);
  };
  useEffect(() => {
    void search('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasRollover = Boolean(
    selected?.policy.states?.some((state) => state.actions?.some((action) => 'rollover' in action))
  );
  const single = indices.length === 1;
  const policyError = selected ? '' : 'You must select a policy';
  const aliasError =
    hasRollover && single && !indices[0].includes('.ds') && !rolloverAlias ? 'Required' : '';

  const editRolloverAlias = async (index: string) => {
    const answer = await ism.post<{ acknowledged?: boolean }>('editRolloverAlias', { index, alias: rolloverAlias });
    if (!answer.ok) toasts.danger(answer.error);
    else if (answer.response?.acknowledged) toasts.success(`Edited rollover alias on ${index}`);
    else toasts.danger(`Failed to edit rollover alias on ${index}`);
  };

  const submit = async () => {
    if (!selected || policyError || aliasError) {
      setSubmitted(true);
      return;
    }
    const answer = await ism.post<{
      updatedIndices: number;
      failures: boolean;
      failedIndices: Array<{ indexName: string; reason: string }>;
    }>('applyPolicy', { indices, policyId: selected.id });
    if (!answer.ok || !answer.response) {
      toasts.danger(answer.error);
      return;
    }
    const { updatedIndices, failures, failedIndices } = answer.response;
    if (updatedIndices) {
      toasts.success(`Applied policy to ${updatedIndices} indices`);
      if (hasRollover && rolloverAlias && single) await editRolloverAlias(indices[0]);
    }
    if (failures) {
      toasts.danger(
        `Failed to apply policy to ${failedIndices.map((failed) => `[${failed.indexName}, ${failed.reason}]`).join(', ')}`
      );
    }
    onClose();
  };

  return (
    <PluginModal
      title="Apply policy"
      onClose={onClose}
      footer={
        <ModalButtons
          label="Apply"
          onCancel={onClose}
          onConfirm={() => void submit()}
          cancelTestId="applyPolicyModalCloseButton"
          confirmTestId="applyPolicyModalEditButton"
        />
      }
    >
      <p className="ismModal__narrow">
        Choose the policy you want to use for the selected indices. A copy of the policy will be created and
        applied to the indices.
      </p>
      <div className="ismSpacer ismSpacer--m" />
      <FormRow
        label={<h4 className="ismModal__h4">Policy ID</h4>}
        error={submitted ? policyError || undefined : undefined}
        fullWidth
      >
        <ComboBox
          single
          placeholder="Search policies"
          options={options.map((option) => ({ value: option.id, label: option.id }))}
          selected={selected ? [selected.id] : []}
          onChange={([id]) => setSelected(options.find((option) => option.id === id))}
          onSearch={search}
          loading={loading}
          invalid={submitted && Boolean(policyError)}
        />
      </FormRow>
      {selected && (
        <>
          <div className="ismSpacer ismSpacer--l" />
          <h4 className="ismModal__h4 ismModal__narrow">Preview</h4>
          <div className="ismSpacer ismSpacer--s" />
          <JsonBlock text={JSON.stringify({ policy: selected.policy }, null, 4)} height={200} />
          <div className="ismSpacer ismSpacer--m" />
        </>
      )}
      {hasRollover &&
        (single ? (
          <FormRow
            label="Rollover alias"
            error={submitted ? aliasError || undefined : undefined}
            help={
              <p>
                This policy includes a rollover action. Specify a rollover alias.{' '}
                <ExternalLink href={ROLLOVER_DOCS} />
              </p>
            }
            helpAt="bottom"
            fullWidth
          >
            <TextField
              compact
              value={rolloverAlias}
              onChange={setRolloverAlias}
              placeholder="Rollover alias"
              invalid={submitted && Boolean(aliasError)}
            />
          </FormRow>
        ) : (
          <div className="ismModal__callout350">
            <CallOut
              tone="warning"
              size="s"
              icon="warning"
              title="You are applying a policy with rollover to multiple indices. You will need to add a unique rollover_alias setting to each index."
            />
          </div>
        ))}
    </PluginModal>
  );
}

/** Starts opening indices; a job tells when they are open */
export async function openIndices(indices: string[], firstRunTimeout?: number): Promise<boolean> {
  const payload = indices.join(',');
  const result = await ism.request<{ task?: string }>('POST', `/${payload}/_open?wait_for_completion=false`);
  if (!result.ok) {
    toasts.danger(result.error);
    return false;
  }
  const toastId = startedToast(`Successfully started opening ${payload}.`);
  addJob({
    type: 'open',
    extras: { clusterInfo: await clusterInfo(), toastId, taskId: result.response?.task, indexes: indices },
    interval: 3000,
    firstRunTimeout,
  });
  return true;
}

interface ConfirmProps {
  names: string[];
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

/** The plugin's DeleteIndexModal: "delete" typed before the indexes go */
function DeleteIndexesModal({ names, onClose, onConfirm }: ConfirmProps) {
  const [value, setValue] = useState('');
  return (
    <PluginModal
      title="Delete indexes"
      onClose={onClose}
      footer={
        <ModalButtons
          label="Delete"
          danger
          disabled={value !== 'delete'}
          onCancel={onClose}
          onConfirm={() => void onConfirm()}
          confirmTestId="Delete Confirm button"
        />
      }
    >
      {names.some((name) => matchesAny(name, SYSTEM_INDEX)) && (
        <>
          <CallOut tone="warning" size="s">
            These indexes may contain critical system data. Deleting system indexes may break OpenSearch.
          </CallOut>
          <div className="ismSpacer ismSpacer--l" />
        </>
      )}
      <p>The following index will be permanently deleted. This action cannot be undone.</p>
      <ModalNames names={names} />
      <div className="ismSpacer ismSpacer--l" />
      <TypeTheWord word="delete" value={value} onChange={setValue} />
    </PluginModal>
  );
}

/** The plugin's CloseIndexModal: "close" typed first; its warning on system indexes ends in a spacer */
function CloseIndexesModal({ names, onClose, onConfirm }: ConfirmProps) {
  const [value, setValue] = useState('');
  return (
    <PluginModal
      title="Close indexes"
      onClose={onClose}
      footer={
        <ModalButtons
          label="Close"
          disabled={value !== 'close'}
          onCancel={onClose}
          onConfirm={() => void onConfirm()}
          cancelTestId="Close Cancel button"
          confirmTestId="Close Confirm button"
        />
      }
    >
      {names.some((name) => matchesAny(name, SYSTEM_INDEX)) && (
        <CallOut tone="warning" size="s">
          This index may contain critical system data. Closing system indexes may break OpenSearch.
          <div className="ismSpacer ismSpacer--l" />
        </CallOut>
      )}
      <p>
        The following index will be closed. It is not possible to index documents or to search for documents in a
        closed index.
      </p>
      <ModalNames names={names} />
      <div className="ismSpacer ismSpacer--l" />
      <TypeTheWord word="close" value={value} onChange={setValue} />
    </PluginModal>
  );
}

/** The plugin's OpenIndexModal */
function OpenIndexesModal({ names, onClose, onConfirm }: ConfirmProps) {
  return (
    <PluginModal
      title="Open indexes"
      onClose={onClose}
      footer={
        <ModalButtons
          label="Open"
          onCancel={onClose}
          onConfirm={() => void onConfirm()}
          cancelTestId="Open Cancel button"
          confirmTestId="Open Confirm button"
        />
      }
    >
      <p>The following index will be opened.</p>
      <ModalNames names={names} />
      <div className="ismSpacer ismSpacer--l" />
    </PluginModal>
  );
}

type Dialog = 'apply' | 'close' | 'open' | 'delete' | 'clearCache' | 'flush' | 'refresh';

export function IndicesActions({
  selected,
  onChange,
  onDelete = onChange,
}: {
  selected: IndexRow[];
  /** Called when the indexes are no longer what the list shows */
  onChange: () => void;
  /** Called when the indexes are gone; a page about one of them has nothing left to show */
  onDelete?: () => void;
}) {
  const [dialog, setDialog] = useState<Dialog>();
  const names = selected.map((item) => item.index);
  const none = selected.length === 0;
  const close = () => setDialog(undefined);
  const operands = selected.map((item) => ({ name: item.index, indices: [item.index] }));

  const items: MenuItem[] = [
    { id: 'apply', label: 'Apply policy', disabled: none, testId: 'Apply policyButton', onClick: () => setDialog('apply') },
    { id: 'close', label: 'Close', disabled: none, testId: 'Close Action', separated: true, onClick: () => setDialog('close') },
    { id: 'open', label: 'Open', disabled: none, testId: 'Open Action', onClick: () => setDialog('open') },
    {
      id: 'reindex',
      label: 'Reindex',
      testId: 'Reindex Action',
      separated: true,
      onClick: () => go('/reindex', none ? {} : { source: names.join(',') }),
    },
    {
      id: 'shrink',
      label: 'Shrink',
      testId: 'Shrink Action',
      disabled: selected.length !== 1 || Boolean(selected[0].data_stream),
      onClick: () => go('/shrink-index', { source: names[0] }),
    },
    {
      id: 'split',
      label: 'Split',
      testId: 'Split Action',
      disabled: selected.length !== 1 || selected[0].data_stream !== null,
      onClick: () => go('/split-index', { source: names[0] }),
    },
    { id: 'forceMerge', label: 'Force merge', testId: 'ForceMergeAction', onClick: () => go(`/force-merge/${names.join(',')}`) },
    { id: 'clearCache', label: 'Clear cache', testId: 'Clear cache Action', separated: true, onClick: () => setDialog('clearCache') },
    { id: 'flush', label: 'Flush', testId: 'Flush Action', onClick: () => setDialog('flush') },
    { id: 'refresh', label: 'Refresh', testId: 'Refresh Index Action', onClick: () => setDialog('refresh') },
    { id: 'delete', label: 'Delete', disabled: none, testId: 'deleteAction', separated: true, onClick: () => setDialog('delete') },
  ];

  const deleteIndices = async () => {
    const payload = names.join(',');
    const result = await ism.call('indices.delete', { index: payload });
    if (result.ok) {
      toasts.success(`Delete [${payload}] successfully`);
      close();
      onDelete();
    } else {
      toasts.danger(result.error || '');
    }
  };

  const closeIndices = async () => {
    const payload = names.join(',');
    const result = await ism.call('indices.close', { index: payload });
    if (result.ok) {
      close();
      toasts.success(`Close [${payload}] successfully`);
      onChange();
    } else {
      toasts.danger(result.error);
    }
  };

  return (
    <>
      <ActionsMenu items={items} size="m" />
      {dialog === 'apply' && <ApplyPolicyModal indices={names} onClose={close} />}
      {dialog === 'delete' && <DeleteIndexesModal names={names} onClose={close} onConfirm={deleteIndices} />}
      {dialog === 'close' && <CloseIndexesModal names={names} onClose={close} onConfirm={closeIndices} />}
      {dialog === 'open' && (
        <OpenIndexesModal
          names={names}
          onClose={close}
          onConfirm={async () => {
            if (await openIndices(names)) close();
          }}
        />
      )}
      {dialog === 'clearCache' && <ClearCacheModal items={operands} target="indexes" onClose={close} />}
      {dialog === 'flush' && <FlushModal items={operands} target="indexes" onClose={close} />}
      {dialog === 'refresh' && <RefreshModal items={operands} target="indexes" onClose={close} />}
    </>
  );
}

// --- The page ---------------------------------------------------------------------------------------------

const EMPTY = {
  filtered: 'There are no indices matching your applied filters. Reset your filters to view your indices.',
  none: 'There are no existing indices. Create an index to view it here.',
  loading: 'Loading indices...',
};

export function Indices() {
  useBreadcrumbs([CRUMBS.INDEX_MANAGEMENT, CRUMBS.INDICES]);
  const [query, setQuery] = useListQuery({ sortField: 'index' }, { showDataStreams: 'false' });
  const showDataStreams = query.showDataStreams === 'true';
  const [rows, setRows] = useState<IndexRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<IndexRow[]>([]);
  const [dataStreams, setDataStreams] = useState<string[]>();
  // The column follows the switch only once the rows that go with it are here
  const [withDataStream, setWithDataStream] = useState(showDataStreams);
  const turn = useRef(0);
  const clauses = useMemo(() => searchClauses(query.search), [query.search]);

  const load = async () => {
    const mine = (turn.current += 1);
    setLoading(true);
    const answer = await ism.get<{ indices: IndexRow[]; totalIndices: number }>('_indices', {
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
      const { indices, totalIndices } = answer.response;
      setRows(indices);
      setTotal(totalIndices);
      // What stays ticked is what is still there, as it is now
      setSelected((before) =>
        before.flatMap((item) => indices.filter((remote) => remote.index === item.index))
      );
    } else {
      toasts.danger(answer.error || 'There was a problem loading the indices');
    }
    setLoading(false);
    setWithDataStream(showDataStreams);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.from, query.size, query.search, query.sortField, query.sortDirection, showDataStreams]);

  const reload = useRef(load);
  reload.current = load;
  useEffect(() => {
    const again = () => void reload.current();
    const events: JobEvent[] = ['REINDEX_COMPLETE', 'SHRINK_COMPLETE', 'SPLIT_COMPLETE', 'OPEN_COMPLETE'];
    const stops = events.map((event) =>
      onJobDone(event, again)
    );
    return () => stops.forEach((stop) => stop());
  }, []);

  // The data streams to filter by are asked for when the filter can be used
  useEffect(() => {
    if (!showDataStreams || dataStreams) return;
    void ism.get<{ dataStreams: Array<{ name: string }> }>('_data_streams').then((answer) => {
      if (answer.ok && answer.response) setDataStreams(answer.response.dataStreams.map((stream) => stream.name));
      else if (answer.error) toasts.warning(answer.error);
    });
  }, [showDataStreams, dataStreams]);

  const columns = useMemo(() => indicesColumns(withDataStream), [withDataStream]);
  const filtered = query.search !== '';

  return (
    <ContentPanel
      title="Indexes"
      itemCount={total}
      bodyStyles={{ padding: 'initial' }}
      actions={
        <ContentPanelActions
          actions={[
            { text: 'Refresh', buttonProps: { icon: 'refresh', onClick: () => void load() } },
            { text: '', children: <IndicesActions selected={selected} onChange={load} /> },
            {
              text: 'Create Index',
              buttonProps: { variant: 'primary', icon: 'plus', onClick: () => go('/create-index') },
            },
          ]}
        />
      }
    >
      <SearchRow
        className="ismIndexControls"
        clearable
        search={query.search}
        onSearch={(search) => setQuery({ search, from: 0 })}
      >
        {/* The search bar's filter, 8 px from its box */}
        {showDataStreams && (
          <div className="ismIndexControls__filter">
            <FilterBox
              name="Data streams"
              options={dataStreams ?? []}
              selected={clauses.dataStreams}
              onChange={(values) => setQuery({ search: withDataStreams(query.search, values), from: 0 })}
              empty="No data streams found"
            />
          </div>
        )}
        <Switch
          label="Show data stream indexes"
          checked={showDataStreams}
          onChange={(checked) => setQuery({ showDataStreams: String(checked) })}
          testId="toggleShowDataStreams"
        />
      </SearchRow>
      <hr className="ismContentPanel__rule" />
      <Table
        fixed
        columns={columns}
        rows={rows}
        total={total}
        query={query}
        onQuery={setQuery}
        rowId={(row) => row.index}
        selected={selected}
        onSelect={setSelected}
        loading={loading}
        emptyWhileLoading
        empty={
          <ListEmpty wide text={loading ? EMPTY.loading : filtered ? EMPTY.filtered : EMPTY.none}>
            {!loading && filtered && (
              <Button variant="primary" onClick={() => setQuery({ search: '' })} testId="indexEmptyPromptResetFilters">
                Reset Filters
              </Button>
            )}
          </ListEmpty>
        }
      />
    </ContentPanel>
  );
}

/** A dialog that only shows something and closes */
export function InfoModal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <Button variant="primary" size="s" onClick={onClose} testId="infoModalCloseButton">
          Close
        </Button>
      }
    >
      {children}
    </Modal>
  );
}

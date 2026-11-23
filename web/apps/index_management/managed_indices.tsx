/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Policy managed indexes: which index is under which policy and how far it has got, and the
 * page that moves managed indexes to another policy, both as the plugin draws them.
 */

import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Button, Spinner, cx } from '../../components/basic';
import { ComboBox } from '../../components/combo_box';
import { SearchField, Select, Switch, TextField } from '../../components/form';
import { Icon } from '../../components/icon';
import { Popover, copyText } from '../../components/overlay';
import { readSearch } from '../../lib/search_syntax';
import { useBreadcrumbs } from '../../shell/state';
import { PanelButton, Table, go, ism, to, toasts, useListQuery, type TableColumn } from './common';
import {
  DocsLink,
  FormButtons,
  ListEmptyPrompt,
  ListPanel,
  ListSearch,
  PluginConfirmationModal,
  PluginRow,
  Radio,
  Rule,
  Spacer,
  useDialogFocus,
  useListLoad,
} from './job_parts';
import { JsonBlock } from './json_block';
import { searchClauses, withDataStreams } from './model';
import { PluginModal } from './plugin_modal';
import { EditorChoiceModal } from './policies';
import {
  commonStates,
  dataStreamChoices,
  jobStatus,
  retryDisabled,
  stillListed,
  withWildcard,
  type ManagedIndex,
  type Policy,
} from './policy_model';
import { CRUMBS, ROUTES } from './routes';

interface Changed {
  updatedIndices: number;
  failures: boolean;
  failedIndices: Array<{ indexName: string; reason: string }>;
}

const failedList = (failed: Changed['failedIndices']) =>
  failed.map((item) => `[${item.indexName}, ${item.reason}]`).join(', ');

// --- Dialogs --------------------------------------------------------------------------------------------

/**
 * A managed index's policy as JSON, with Copy at the left and the two ways to edit it at the right.
 * The plugin opens the JSON editor from both of them; "Edit" opens the visual editor here.
 */
function PolicyModal({ item, onClose }: { item: ManagedIndex; onClose: () => void }) {
  let error: string | undefined;
  if (item.managedIndexMetaData?.policySeqNo == null) error = 'Still initializing, please wait a moment';
  if (!item.policy) error = `Failed to load the policy: ${item.policyId}`;
  const text = JSON.stringify(item.policy, null, 4) ?? '';
  const body = useDialogFocus<HTMLDivElement>();
  const edit = (visual: boolean) => {
    onClose();
    if (item.policyId) go(ROUTES.EDIT_POLICY, visual ? { id: item.policyId, type: 'visual' } : { id: item.policyId });
  };
  return (
    <PluginModal
      title={item.policyId}
      onClose={onClose}
      className="ismWideModal ismMiPolicyModal ismMasked"
      footer={
        <>
          <Button
            variant="empty"
            icon="copyClipboard"
            disabled={!item.policy}
            onClick={() => copyText(text)}
            testId="policyModalCopyButton"
            className="ismMiPolicyModal__copy"
          >
            Copy
          </Button>
          <Button variant="empty" onClick={onClose} testId="policyModalCloseButton">
            Close
          </Button>
          <Button
            variant="primary"
            disabled={!item.policyId || !item.policy}
            onClick={() => edit(false)}
            testId="policyModalEditJsonButton"
          >
            Edit as JSON
          </Button>
          <Button
            variant="primary"
            disabled={!item.policyId || !item.policy}
            onClick={() => edit(true)}
            testId="policyModalEditButton"
          >
            Edit
          </Button>
        </>
      }
    >
      <div className="ismMiCode" ref={body}>
        <JsonBlock text={error ?? text} />
      </div>
    </PluginModal>
  );
}

/** What the plugin keeps about where a managed index is, as JSON */
function InfoModal({ info, onClose }: { info: unknown; onClose: () => void }) {
  const body = useDialogFocus<HTMLDivElement>();
  return (
    <PluginModal
      title="Managed Index Info"
      onClose={onClose}
      className="ismWideModal ismMasked"
      footer={
        <Button variant="primary" onClick={onClose} testId="infoModalCloseButton">
          Close
        </Button>
      }
    >
      <div ref={body}>
        <JsonBlock text={JSON.stringify(info, null, 4) ?? ''} />
      </div>
    </PluginModal>
  );
}

function RetryModal({ items, onClose }: { items: ManagedIndex[]; onClose: () => void }) {
  // Only the states every ticked index has can be started from
  const states = useMemo(() => commonStates(items), [items]);
  const [from, setFrom] = useState<'current' | 'state'>('current');
  // The plugin keeps "" until the list is changed, and sends it, though the list shows its first
  // state: here the state shown is the one sent
  const [state, setState] = useState(states[0] ?? '');
  const body = useDialogFocus<HTMLDivElement>();

  const retry = async () => {
    const answer = await ism.post<Changed>('retry', {
      index: items.map((item) => item.index),
      state: from === 'state' ? state : null,
    });
    if (answer.ok && answer.response) {
      const { updatedIndices, failedIndices, failures } = answer.response;
      if (failures) toasts.danger(`Failed to retry: ${failedList(failedIndices)}`);
      if (updatedIndices) toasts.success(`Retried ${updatedIndices} managed indexes`);
    } else {
      toasts.danger(answer.error || 'There was a problem retrying managed indexes');
    }
    onClose();
  };

  return (
    <PluginModal
      title="Retry policy"
      onClose={onClose}
      className="ismMasked"
      footer={
        <>
          <Button variant="empty" onClick={onClose} testId="retryModalCloseButton">
            Close
          </Button>
          <Button variant="primary" disabled={items.length === 0} onClick={retry} testId="retryModalRetryButton">
            Retry
          </Button>
        </>
      }
    >
      <div className="ismRadioStack" ref={body}>
        <Radio
          id="retry-current"
          name="retry-from"
          label="Retry policy from current action"
          checked={from === 'current'}
          onChange={() => setFrom('current')}
        />
        <Radio
          id="retry-state"
          name="retry-from"
          label="Retry policy from selected state"
          checked={from === 'state'}
          disabled={states.length === 0}
          onChange={() => setFrom('state')}
        />
      </div>
      <Spacer size="s" />
      <PluginRow title="Start state" help="Only common states shared across all selected indexes are available">
        <Select
          compact
          disabled={from !== 'state'}
          value={state}
          onChange={setState}
          options={states.map((name) => ({ value: name, label: name }))}
          aria-label="Retry failed policy from"
        />
      </PluginRow>
    </PluginModal>
  );
}

function RolloverAliasModal({ index, onClose }: { index: string; onClose: () => void }) {
  const [alias, setAlias] = useState('');
  const body = useDialogFocus<HTMLDivElement>();
  const edit = async () => {
    const answer = await ism.post<{ acknowledged?: boolean }>('editRolloverAlias', { index, alias });
    if (!answer.ok) toasts.danger(answer.error || `There was a problem editing rollover alias on ${index}`);
    else if (answer.response?.acknowledged) toasts.success(`Edited rollover alias on ${index}`);
    else toasts.danger(`Failed to edit rollover alias on ${index}`);
    onClose();
  };
  return (
    <PluginModal
      title="Edit rollover alias"
      onClose={onClose}
      className="ismMasked"
      footer={
        <>
          <Button variant="empty" onClick={onClose} testId="editRolloverAliasModalCloseButton">
            Close
          </Button>
          <Button variant="primary" disabled={!alias} onClick={edit} testId="editRolloverAliasModalAddButton">
            Edit
          </Button>
        </>
      }
    >
      <div ref={body}>
        <PluginRow title="Rollover alias" help="A rollover alias is required when using the rollover action.">
          <TextField compact placeholder="Rollover alias" value={alias} onChange={setAlias} />
        </PluginRow>
      </div>
    </PluginModal>
  );
}

// --- The "Data streams" filter ------------------------------------------------------------------------

const DATA_STREAMS_KEPT_MS = 60000;
// The component library shows a search box over ten options or more
const SEARCH_THRESHOLD = 10;

interface Loaded {
  names?: string[];
  error?: string;
}

/**
 * The search bar's "Data streams" filter, as the component library's field value selection: a
 * button in a group of filters and, under it, the data streams, asked for when it opens and kept
 * for a minute. One may be chosen, which closes it; choosing it again takes it away.
 */
function DataStreamsFilter({
  search,
  chosen,
  onChoose,
}: {
  search: string;
  chosen: string[];
  onChoose: (name: string | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState<Loaded>({});
  const [typed, setTyped] = useState<string>();
  const kept = useRef<string[] | null>(null);
  const items = useRef<Array<HTMLButtonElement | null>>([]);
  const searchBox = useRef<HTMLDivElement>(null);

  const load = async () => {
    setLoaded({});
    setTyped(undefined);
    let names = kept.current;
    if (!names) {
      const answer = await ism.get<{ dataStreams: Array<{ name: string }> }>('_data_streams');
      if (!answer.ok || !answer.response) {
        if (answer.error?.startsWith('[security_exception]')) toasts.warning(answer.error);
        setLoaded({ error: 'Could not load options' });
        return;
      }
      const loadedNames = answer.response.dataStreams.map((stream) => stream.name);
      names = loadedNames;
      kept.current = loadedNames;
      window.setTimeout(() => {
        if (kept.current === loadedNames) kept.current = null;
      }, DATA_STREAMS_KEPT_MS);
    }
    setLoaded({ names });
  };

  // As the component library's, it loads when it comes with a search and whenever the search changes
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      if (!search) return;
    }
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const toggle = () => {
    if (!open) {
      setLoaded({});
      window.requestAnimationFrame(() => void load());
    }
    setOpen(!open);
  };

  // The component library's popover takes the focus once it has opened, by when the list is there:
  // its first value, or its search box. Here the panel takes it at once, and hands it on when the
  // list comes.
  const names = loaded.names;
  useEffect(() => {
    if (!open || !names) return;
    const panel = document.activeElement;
    if (!(panel instanceof HTMLElement) || !panel.classList.contains('ismFilterPopover')) return;
    const first = searchBox.current?.querySelector('input') ?? items.current[0];
    first?.focus({ preventScroll: true });
  }, [open, names]);

  const moveFocus = (at: number, event: ReactKeyboardEvent) => {
    if (event.key === 'ArrowDown' && at < items.current.length - 1) {
      event.preventDefault();
      items.current[at + 1]?.focus();
    } else if (event.key === 'ArrowUp' && at >= 0) {
      if (at === 0 && searchBox.current) {
        event.preventDefault();
        searchBox.current.querySelector('input')?.focus();
      } else if (at > 0) {
        event.preventDefault();
        items.current[at - 1]?.focus();
      }
    }
  };

  const shown = loaded.names ? dataStreamChoices(loaded.names, chosen, typed) : [];
  items.current = [];
  let content;
  if (loaded.error) {
    content = <FilterNote icon="error">{loaded.error}</FilterNote>;
  } else if (!loaded.names) {
    content = <FilterNote>Loading...</FilterNote>;
  } else {
    content = (
      <>
        {loaded.names.length >= SEARCH_THRESHOLD && (
          <div className="ismFilterSearch" ref={searchBox} onKeyDown={(event) => moveFocus(-1, event)}>
            <SearchField compact value={typed ?? ''} onChange={setTyped} />
          </div>
        )}
        {shown.length === 0 ? (
          <FilterNote icon="minusInCircle">No data streams found</FilterNote>
        ) : (
          <div className="ismFilterItems">
            {shown.map((name, at) => {
              const checked = chosen.includes(name);
              return (
                <button
                  key={name}
                  type="button"
                  role="option"
                  aria-selected={checked}
                  className="ismFilterItem"
                  ref={(element) => {
                    items.current[at] = element;
                  }}
                  onKeyDown={(event) => moveFocus(at, event)}
                  onClick={() => {
                    setOpen(false);
                    onChoose(checked ? undefined : name);
                  }}
                >
                  <Icon name={checked ? 'check' : 'empty'} />
                  <span className="ismFilterItem__text">{name}</span>
                </button>
              );
            })}
          </div>
        )}
      </>
    );
  }

  return (
    <div className="ismFilterGroup">
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        position="downCenter"
        className="ismFilterPopover"
        button={
          <button
            type="button"
            className={cx(
              'ismFilterButton',
              open && 'ismFilterButton--open',
              chosen.length > 0 && 'ismFilterButton--active'
            )}
            onClick={toggle}
          >
            <span className="ismFilterButton__text" data-text="Data streams">
              Data streams
            </span>
            {chosen.length > 0 && <span className="ismFilterButton__count">{chosen.length}</span>}
            <Icon name="chevronDown" />
          </button>
        }
      >
        {content}
      </Popover>
    </div>
  );
}

function FilterNote({ icon, children }: { icon?: 'error' | 'minusInCircle'; children: string }) {
  return (
    <div className="ismFilterNote">
      <div className="ismFilterNote__content">
        {icon ? <Icon name={icon} className={cx(icon === 'error' && 'ismFilterNote__error')} /> : <Spinner />}
        <Spacer size="xs" />
        <p>{children}</p>
      </div>
    </div>
  );
}

// --- The list ---------------------------------------------------------------------------------------------

const EMPTY = {
  filtered: 'There are no managed indexes matching your applied filters. Reset your filters to view your managed indexes.',
  none: 'There are no existing managed indexes. Create a policy to add to an index.',
  loading: 'Loading managed indexes...',
};

type Dialog =
  | { kind: 'policy'; item: ManagedIndex }
  | { kind: 'info'; info: unknown }
  | { kind: 'retry'; items: ManagedIndex[] }
  | { kind: 'remove' | 'rollover' | 'create' };

export function ManagedIndices() {
  useBreadcrumbs([CRUMBS.INDEX_MANAGEMENT, CRUMBS.MANAGED_INDICES]);
  const [query, setQuery] = useListQuery({ sortField: 'index' }, { showDataStreams: 'false' });
  const showDataStreams = query.showDataStreams === 'true';
  const [rows, setRows] = useState<ManagedIndex[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ManagedIndex[]>([]);
  // The column of data streams follows the switch once the list it asked for has come
  const [withDataStream, setWithDataStream] = useState(showDataStreams);
  const [dialog, setDialog] = useState<Dialog>();
  const clauses = useMemo(() => searchClauses(query.search), [query.search]);

  const load = async () => {
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
    if (answer.ok && answer.response) {
      const listed = answer.response.managedIndices;
      setRows(listed);
      setTotal(answer.response.totalManagedIndices);
      setSelected((ticked) => stillListed(ticked, listed, (row) => row.index));
    } else {
      toasts.danger(answer.error || 'There was a problem loading the managed indexes');
    }
    setLoading(false);
    setWithDataStream(showDataStreams);
  };
  const reload = useListLoad(load, [
    query.from,
    query.size,
    query.search,
    query.sortField,
    query.sortDirection,
    showDataStreams,
  ]);

  const columns = useMemo(() => {
    const all: Array<TableColumn<ManagedIndex>> = [
      {
        field: 'index',
        name: 'Index',
        sortable: true,
        render: (row) => (
          <div className="ismCell">
            <span title={row.index}>{row.index}</span>
          </div>
        ),
      },
      {
        field: 'dataStream',
        name: 'Data stream',
        sortable: true,
        render: (row) => <div className="ismCell">{row.dataStream || '-'}</div>,
      },
      {
        field: 'policyId',
        name: 'Policy',
        sortable: true,
        render: (row) => (
          <div className="ismCell">
            <button
              type="button"
              className="atlLinkButton ismTableLink"
              onClick={() => setDialog({ kind: 'policy', item: row })}
            >
              {row.policyId}
            </button>
          </div>
        ),
      },
      {
        field: 'managedIndexMetaData.state.name',
        name: 'State',
        render: (row) => row.managedIndexMetaData?.state?.name || '-',
      },
      {
        field: 'managedIndexMetaData.action.name',
        name: 'Action',
        render: (row) => (
          <span className="ismCapitalize">{(row.managedIndexMetaData?.action?.name || '-').split('_').join(' ')}</span>
        ),
      },
      {
        field: 'managedIndexMetaData.info',
        name: 'Info',
        render: (row) => {
          const info = row.managedIndexMetaData?.info;
          const message = info && 'message' in info ? info.message : '-';
          return (
            <div className="ismCell">
              <button
                type="button"
                className="atlLinkButton ismTableLink ismTableLink--fill"
                onClick={() => setDialog({ kind: 'info', info })}
              >
                {typeof message === 'string' ? message : String(message ?? '')}
              </button>
            </div>
          );
        },
      },
      // The plugin's column of the job's status is that of the index too, and its test id says so
      { field: 'index', name: 'Job Status', render: jobStatus },
    ];
    return withDataStream ? all : all.filter((column) => column.field !== 'dataStream');
  }, [withDataStream]);

  const removePolicy = async () => {
    const indices = selected.map((item) => item.index);
    if (indices.length === 0) return;
    const answer = await ism.post<Changed>('removePolicy', { indices });
    if (!answer.ok || !answer.response) {
      toasts.danger(answer.error || 'There was a problem removing the policies');
      return;
    }
    const { updatedIndices, failedIndices, failures } = answer.response;
    if (updatedIndices) {
      toasts.success(`Removed policy from ${updatedIndices} managed indexes`);
      reload();
    }
    if (failures) toasts.danger(`Failed to remove policy from ${failedList(failedIndices)}`);
  };

  const dataStreamSelected = selected.some((item) => item.dataStream !== null);
  const what =
    selected.length === 1 ? `policy from ${selected[0].index}` : `policies from ${selected.length} indexes`;
  const filtered = query.search !== '';
  const close = () => setDialog(undefined);
  // As the component library's table, a new sort or page unticks every row
  const onQuery = (changes: Parameters<typeof setQuery>[0]) => {
    setSelected([]);
    setQuery(changes);
  };

  return (
    <div className="ismManaged">
      <div className="ismManaged__top">
        <Button icon="refresh" onClick={reload} testId="refreshButton">
          Refresh
        </Button>
        <Button to={to(ROUTES.CHANGE_POLICY)} testId="changePolicyButton">
          Change policy
        </Button>
      </div>
      <Spacer />
      <ListPanel
        title="Policy managed indexes"
        count={total}
        actions={
          <>
            <PanelButton
              text="Edit rollover alias"
              size="m"
              disabled={selected.length !== 1 || dataStreamSelected}
              onClick={() => setDialog({ kind: 'rollover' })}
            />
            <PanelButton
              text="Remove policy"
              size="m"
              disabled={selected.length === 0}
              onClick={() => setDialog({ kind: 'remove' })}
            />
            <PanelButton
              text="Retry policy"
              size="m"
              disabled={retryDisabled(selected)}
              onClick={() => setDialog({ kind: 'retry', items: selected })}
            />
          </>
        }
      >
        <ListSearch
          className="ismLs--center"
          search={query.search}
          onSearch={(search) => {
            // A text that cannot be read as a search leaves the last readable one in place, as the plugin's
            if (readSearch(search) === undefined) return;
            setQuery({ search, from: 0 });
          }}
          placeholder="Search index name"
          ariaLabel="This is a search bar. As you type, the results lower in the page will automatically filter."
          filters={
            showDataStreams && (
              <DataStreamsFilter
                search={query.search}
                chosen={clauses.dataStreams}
                onChoose={(name) =>
                  setQuery({ search: withDataStreams(query.search, name ? [name] : []), from: 0 })
                }
              />
            )
          }
        >
          <Switch
            compressed
            label="Show data stream indexes"
            checked={showDataStreams}
            onChange={(checked) => setQuery({ showDataStreams: String(checked) })}
            testId="toggleShowDataStreams"
          />
        </ListSearch>
        <Rule />
        <div className="ismFixed">
          <Table
            columns={columns}
            rows={rows}
            total={total}
            query={query}
            onQuery={onQuery}
            rowId={(row) => row.index}
            selected={selected}
            onSelect={setSelected}
            empty={
              <ListEmptyPrompt
                body={loading ? EMPTY.loading : filtered ? EMPTY.filtered : EMPTY.none}
                actions={
                  loading ? null : filtered ? (
                    <Button
                      variant="primary"
                      onClick={() => setQuery({ search: '', from: 0 })}
                      testId="managedIndexEmptyPromptResetFilters"
                    >
                      Reset Filters
                    </Button>
                  ) : (
                    <Button variant="primary" icon="plus" onClick={() => setDialog({ kind: 'create' })}>
                      Create policy
                    </Button>
                  )
                }
              />
            }
          />
        </div>
      </ListPanel>
      {dialog?.kind === 'policy' && <PolicyModal item={dialog.item} onClose={close} />}
      {dialog?.kind === 'info' && <InfoModal info={dialog.info} onClose={close} />}
      {dialog?.kind === 'rollover' && selected.length === 1 && (
        <RolloverAliasModal index={selected[0].index} onClose={close} />
      )}
      {dialog?.kind === 'retry' && <RetryModal items={dialog.items} onClose={close} />}
      {dialog?.kind === 'remove' && (
        <PluginConfirmationModal
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
    </div>
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
  const [stateSearch, setStateSearch] = useState('');
  const [stateFilters, setStateFilters] = useState<string[]>([]);
  const [policies, setPolicies] = useState<PolicyOption[]>([]);
  const [policiesLoading, setPoliciesLoading] = useState(false);
  const [policyId, setPolicyId] = useState<string>();
  const [after, setAfter] = useState<'current' | 'state'>('current');
  const [state, setState] = useState('');
  const [submitted, setSubmitted] = useState(false);
  // The managed indexes seen so far, so that a chosen one keeps its policy when the list changes
  const seen = useRef(new Map<string, ManagedIndex>());
  const chosenPolicy = useRef<PolicyOption>();

  const searchManaged = async (search: string) => {
    setManagedSearch(search);
    setManaged([]);
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
    setPolicies([]);
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
    else toasts.danger(answer.error || 'There was a problem searching policies');
    setPoliciesLoading(false);
  };

  useEffect(() => {
    void searchManaged('');
    void searchPolicies('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const indexOptions = withWildcard(
    managedSearch,
    managed.map((item) => item.index)
  );
  const uniqueStates = [
    ...new Set(
      selectedIndices.flatMap((name) => seen.current.get(name)?.policy?.states?.map((item) => item.name) ?? [])
    ),
  ];
  const stateOptions = withWildcard(stateSearch, uniqueStates);
  const selectedPolicy = policyId ? chosenPolicy.current : undefined;
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
      toasts.danger(answer.error || 'There was a problem changing policy');
      return;
    }
    const { updatedIndices, failedIndices, failures } = answer.response;
    if (updatedIndices) toasts.success(`Changed policy on ${updatedIndices} indexes`);
    if (failures) toasts.danger(`Failed to change policy on ${failedList(failedIndices)}`);
  };

  return (
    <div className="ismChange">
      <h1 className="atlTitleL">Change policy</h1>
      <Spacer />
      <section className="atlPanel">
        <h2 className="atlTitleS">Choose managed indices</h2>
        <Rule />
        <PluginRow
          title="Managed indices"
          help="You can use * as wildcards to form index patterns."
          error={submitted ? indicesError || undefined : undefined}
        >
          <ComboBox
            searched
            placeholder=""
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
        </PluginRow>
        <PluginRow title="State filters" help="Apply new policy only on managed indices in these states.">
          <ComboBox
            disabled={selectedIndices.length === 0}
            placeholder="Choose state filters"
            options={stateOptions.map((value) => ({ value, label: value }))}
            selected={stateFilters}
            onChange={setStateFilters}
            onSearch={setStateSearch}
          />
        </PluginRow>
      </section>
      <Spacer />
      <section className="atlPanel">
        <h2 className="atlTitleS">Choose new policy</h2>
        <Rule />
        <p className="ismChange__note">
          When the new policy will take effect depends on the current state of indices and the states of the new policy.{' '}
          <DocsLink href="https://opensearch.org/docs/im-plugin/ism/index/" />
        </p>
        <Spacer size="s" />
        <PluginRow title="New policy" error={submitted ? policyError || undefined : undefined}>
          <ComboBox
            single
            searched
            placeholder=""
            options={policies.map((option) => ({ value: option.id, label: option.id }))}
            selected={policyId ? [policyId] : []}
            onChange={([next]) => {
              chosenPolicy.current = policies.find((option) => option.id === next);
              setPolicyId(next);
              setState('');
              setAfter('current');
            }}
            onSearch={searchPolicies}
            loading={policiesLoading}
            invalid={submitted && Boolean(policyError)}
          />
        </PluginRow>
        <Spacer size="m" />
        <div className="ismRadioStack ismChange__radios">
          <Radio
            id="change-policy-current"
            name="change-policy-state"
            label="Keep indices in their current state after the policy takes effect"
            checked={after === 'current'}
            onChange={() => setAfter('current')}
          />
          <Radio
            id="change-policy-state"
            name="change-policy-state"
            label="Switch indices to the following state after the policy takes effect"
            checked={after === 'state'}
            disabled={!selectedPolicy || newStates.length === 0}
            onChange={() => {
              setAfter('state');
              // The plugin sends "" until the list is changed, though it shows the first state
              if (!state) setState(newStates[0] ?? '');
            }}
          />
        </div>
        <Spacer size="s" />
        <PluginRow>
          <Select
            compact
            disabled={after !== 'state'}
            value={state}
            onChange={setState}
            options={newStates.map((name) => ({ value: name, label: name }))}
            aria-label="Start state for new policy"
          />
        </PluginRow>
      </section>
      <Spacer />
      <FormButtons>
        <Button variant="empty" onClick={() => window.history.back()} testId="changePolicyCancelButton">
          Cancel
        </Button>
        <Button variant="primary" onClick={submit} testId="changePolicyChangeButton">
          Change
        </Button>
      </FormButtons>
    </div>
  );
}

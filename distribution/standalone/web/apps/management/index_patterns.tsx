/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Index patterns: the list, the two steps that make one, and the page of one with its fields,
 * its scripted fields and its source filters.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Badge, Button, CallOut, EmptyPrompt, IconButton, Link, Loading, PageHeader, Panel, Tabs } from '../../components/basic';
import { FormRow, SearchField, Select, Switch, TextField } from '../../components/form';
import { ConfirmModal } from '../../components/overlay';
import { DataTable, type Column } from '../../components/table';
import type { Field, IndexPattern } from '../../lib/types';
import { navigate, useUrlState } from '../../router';
import { services } from '../../services';
import { errorMessage } from '../../services/http';
import { patternName, type IndexPatternSummary } from '../../services/index_patterns';
import { useBreadcrumbs } from '../../shell/state';
import { FieldEditor } from './field_editor';

const ROOT = '/app/management/opensearch-dashboards/indexPatterns';
const MANAGEMENT = { text: 'Dashboards Management', to: '/app/management' };
const LIST = { text: 'Index patterns', to: ROOT };

export const patternPath = (id: string, rest = '') => `${ROOT}/patterns/${encodeURIComponent(id)}${rest}`;

export function IndexPatternsSection({ rest }: { rest: string[] }) {
  if (rest[0] === 'create') return <CreateWizard />;
  if (rest[0] === 'patterns' && rest[1]) {
    if (rest[2] === 'field' && rest[3] !== undefined) {
      return <FieldEditor key={`${rest[1]}/${rest.slice(3).join('/')}`} patternId={rest[1]} fieldName={rest.slice(3).join('/')} />;
    }
    if (rest[2] === 'create-field') return <FieldEditor key={`${rest[1]}/new`} patternId={rest[1]} />;
    return <EditIndexPattern key={rest[1]} id={rest[1]} />;
  }
  return <IndexPatternList />;
}

// --- The list -------------------------------------------------------------------------------------

function IndexPatternList() {
  useBreadcrumbs([MANAGEMENT, { text: 'Index patterns' }]);
  const [patterns, setPatterns] = useState<IndexPatternSummary[]>();
  const [search, setSearch] = useState('');
  const defaultId = services.uiSettings.get<string | undefined>('defaultIndex');

  useEffect(() => {
    let live = true;
    services.indexPatterns.clear();
    services.indexPatterns
      .list()
      .then((all) => live && setPatterns(all))
      .catch((failure) => {
        if (!live) return;
        setPatterns([]);
        services.toasts.error(failure, 'The index patterns could not be listed');
      });
    return () => {
      live = false;
    };
  }, []);

  const createButton = (
    <Button variant="primary" icon="plus" to={`${ROOT}/create`} testId="createIndexPatternButton">
      Create index pattern
    </Button>
  );
  const columns: Array<Column<IndexPatternSummary>> = [
    {
      id: 'title',
      name: 'Pattern',
      render: (pattern) => (
        <span className="atlRow">
          <Link to={patternPath(pattern.id)} testId={`indexPatternLink-${pattern.title}`}>
            {patternName(pattern)}
          </Link>
          {pattern.displayName && <span className="atlSubdued atlSmall">{pattern.title}</span>}
          {pattern.id === defaultId && <Badge>Default</Badge>}
        </span>
      ),
      sortValue: (pattern) => patternName(pattern),
    },
  ];
  const needle = search.trim().toLowerCase();
  const shown = (patterns ?? []).filter((pattern) => !needle || `${pattern.title} ${pattern.displayName ?? ''}`.toLowerCase().includes(needle));

  return (
    <div className="mgtPage" data-test-subj="indexPatternTable">
      <Panel>
        <PageHeader
          title="Index patterns"
          description="Create and manage the index patterns that help you retrieve your data from OpenSearch."
          actions={patterns && patterns.length > 0 ? createButton : undefined}
        />
        {!patterns ? (
          <Loading />
        ) : patterns.length === 0 ? (
          <EmptyPrompt icon="index" title="Create your first index pattern" actions={createButton}>
            An index pattern tells {services.boot.name} which indices of OpenSearch hold the data you want to explore.
          </EmptyPrompt>
        ) : (
          <>
            <div style={{ marginBottom: 'var(--space-3)' }}>
              <SearchField value={search} onChange={setSearch} placeholder="Search..." aria-label="Search index patterns" />
            </div>
            <DataTable
              rows={shown}
              columns={columns}
              rowId={(pattern) => pattern.id}
              initialSort={{ column: 'title', direction: 'asc' }}
              pageSize={10}
              pageSizes={[5, 10, 25, 50]}
              empty="No index patterns match your search"
            />
          </>
        )}
      </Panel>
    </div>
  );
}

// --- Making one -----------------------------------------------------------------------------------

interface MatchedItem {
  name: string;
  tags: string[];
}

interface ResolveAnswer {
  indices?: Array<{ name: string; attributes?: string[]; data_stream?: string }>;
  aliases?: Array<{ name: string }>;
  data_streams?: Array<{ name: string }>;
}

const ILLEGAL = ['\\', '/', '?', '"', '<', '>', '|', ' '];

async function resolveIndices(pattern: string, hidden: boolean, signal?: AbortSignal): Promise<MatchedItem[]> {
  if (!pattern) return [];
  try {
    const answer = await services.http.post<ResolveAnswer>('/internal/opensearch', {
      query: { method: 'GET', path: `_resolve/index/${encodeURIComponent(pattern)}?expand_wildcards=${hidden ? 'all' : 'open'}` },
      signal,
    });
    const items: MatchedItem[] = [
      ...(answer.indices ?? []).map((index) => ({
        name: index.name,
        tags: [index.data_stream ? 'Data stream' : 'Index', ...(index.attributes?.includes('frozen') ? ['Frozen'] : [])],
      })),
      ...(answer.aliases ?? []).map((alias) => ({ name: alias.name, tags: ['Alias'] })),
      ...(answer.data_streams ?? []).map((stream) => ({ name: stream.name, tags: ['Data stream'] })),
    ];
    return items.sort((a, b) => a.name.localeCompare(b.name));
  } catch (failure) {
    if ((failure as Error).name === 'AbortError') throw failure;
    return [];
  }
}

const isSystem = (name: string): boolean => name.split(':').some((part) => part.startsWith('.'));

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

function CreateWizard() {
  useBreadcrumbs([MANAGEMENT, LIST, { text: 'Create index pattern' }]);
  const [step, setStep] = useState<1 | 2>(1);
  const [query, setQuery] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [hidden, setHidden] = useState(false);
  const [all, setAll] = useState<MatchedItem[]>();
  const [partial, setPartial] = useState<MatchedItem[]>([]);
  const [exact, setExact] = useState<MatchedItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [existing, setExisting] = useState<IndexPatternSummary[]>([]);
  const input = useRef<HTMLInputElement>(null);

  // Step two
  const [fields, setFields] = useState<Field[]>();
  const [fieldsError, setFieldsError] = useState<string>();
  const [timeField, setTimeField] = useState<string>();
  const [advanced, setAdvanced] = useState(false);
  const [customId, setCustomId] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string>();

  useEffect(() => {
    services.indexPatterns.clear();
    services.indexPatterns.list().then(setExisting, () => setExisting([]));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    resolveIndices('*', hidden, controller.signal).then(setAll, () => undefined);
    return () => controller.abort();
  }, [hidden]);

  const pattern = query.trim();
  useEffect(() => {
    const controller = new AbortController();
    if (!pattern) {
      setPartial([]);
      setExact([]);
      return undefined;
    }
    setLoading(true);
    const timer = window.setTimeout(() => {
      Promise.all([
        resolveIndices(pattern, hidden, controller.signal),
        pattern.endsWith('*') ? Promise.resolve<MatchedItem[]>([]) : resolveIndices(`${pattern}*`, hidden, controller.signal),
      ])
        .then(([exactly, partly]) => {
          setExact(exactly);
          setPartial(partly);
          setLoading(false);
        })
        .catch(() => undefined);
    }, 200);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [pattern, hidden]);

  const keep = useCallback((items: MatchedItem[]) => (hidden ? items : items.filter((item) => !isSystem(item.name))), [hidden]);
  const allShown = keep(all ?? []);
  const exactShown = keep(exact);
  const partialShown = keep(partial);
  const visible = exactShown.length ? exactShown : partialShown.length ? partialShown : allShown;

  const illegal = ILLEGAL.filter((char) => pattern.includes(char));
  const duplicate = existing.find((item) => item.title === pattern);
  const canContinue = exactShown.length > 0 && illegal.length === 0 && !duplicate && !loading;

  const onQuery = (text: string) => {
    // The first letter typed gets an asterisk after it, with the cursor left before the asterisk
    if (query === '' && text.length === 1 && /[a-z0-9]/i.test(text)) {
      setQuery(`${text}*`);
      window.requestAnimationFrame(() => input.current?.setSelectionRange(1, 1));
      return;
    }
    setQuery(text);
  };

  const loadFields = useCallback(() => {
    setFields(undefined);
    setFieldsError(undefined);
    services.indexPatterns
      .fetchFields(pattern)
      .then(setFields)
      .catch((failure) => {
        setFields([]);
        setFieldsError(errorMessage(failure));
      });
  }, [pattern]);

  const toStepTwo = () => {
    setStep(2);
    setTimeField(undefined);
    setCreateError(undefined);
    loadFields();
  };

  const dateFields = (fields ?? []).filter((field) => field.type === 'date');
  const NO_TIME = '__none__';
  const timeChosen = dateFields.length === 0 || timeField !== undefined;

  const create = async () => {
    if (!fields) return;
    setCreating(true);
    setCreateError(undefined);
    try {
      const id = customId.trim();
      if (id) {
        const taken = await services.savedObjects.get('index-pattern', id).then(
          () => true,
          () => false
        );
        if (taken) {
          setCreateError('Custom index pattern ID already exists.');
          setCreating(false);
          return;
        }
      }
      const saved = await services.indexPatterns.save(
        {
          id,
          title: pattern,
          displayName: displayName.trim() || undefined,
          timeFieldName: timeField && timeField !== NO_TIME ? timeField : undefined,
          fields,
          fieldFormatMap: {},
        },
        { create: true }
      );
      if (!services.uiSettings.get<string | undefined>('defaultIndex')) {
        await services.uiSettings.set('defaultIndex', saved.id).catch(() => undefined);
      }
      navigate(patternPath(saved.id));
    } catch (failure) {
      setCreateError(errorMessage(failure));
      setCreating(false);
    }
  };

  let status: ReactNode;
  if (!all) status = <Loading>Looking for matching indices</Loading>;
  else if (pattern === '') {
    status =
      allShown.length === 0 ? (
        <CallOut tone="warning">
          No OpenSearch indices match your pattern.{!hidden && ' To view the matching system indices, toggle the switch above.'}
        </CallOut>
      ) : (
        <CallOut>
          Your index pattern can match {plural(allShown.length, `your ${allShown.length} source`, `any of your ${allShown.length} sources`)}.
        </CallOut>
      );
  } else if (exactShown.length > 0) {
    status = (
      <CallOut tone="healthy">
        Your index pattern matches {exactShown.length} {plural(exactShown.length, 'source', 'sources')}.
      </CallOut>
    );
  } else if (partialShown.length > 0) {
    status = (
      <CallOut>
        Your index pattern doesn't match any indices, but you have{' '}
        <strong>{plural(partialShown.length, 'index', `${partialShown.length} indices`)}</strong> which{' '}
        {plural(partialShown.length, 'looks', 'look')} similar.
      </CallOut>
    );
  } else {
    status = (
      <CallOut tone="warning">
        The index pattern you've entered doesn't match any indices. You can match {plural(allShown.length, 'your', 'any of your')}{' '}
        <strong>{plural(allShown.length, '1 index', `${allShown.length} indices`)}</strong>, below.
      </CallOut>
    );
  }

  const matchColumns: Array<Column<MatchedItem>> = [
    {
      id: 'name',
      name: '',
      render: (item) => {
        // What the pattern covers is shown strong, as far as a prefix can tell
        const prefix = pattern.replace(/\*.*$/, '');
        return exactShown.length === 0 && prefix && item.name.startsWith(prefix) ? (
          <span>
            <strong>{prefix}</strong>
            {item.name.slice(prefix.length)}
          </span>
        ) : (
          item.name
        );
      },
    },
    {
      id: 'tags',
      name: '',
      align: 'right',
      width: 200,
      render: (item) => (
        <span className="atlRow" style={{ justifyContent: 'flex-end' }}>
          {item.tags.map((tag) => (
            <Badge key={tag}>{tag}</Badge>
          ))}
        </span>
      ),
    },
  ];

  return (
    <div className="mgtPage" data-test-subj="createIndexPatternWizard">
      <Panel>
        <PageHeader
          title="Create index pattern"
          description={
            <>
              An index pattern can match a single source, for example, <code>filebeat-4-3-22</code>, or <strong>multiple</strong> data
              sources, <code>filebeat-*</code>.
            </>
          }
        />
        <hr className="mgtRule" />
        {step === 1 ? (
          <>
            <h2 className="atlTitleS mgtStepTitle">Step 1 of 2: Define an index pattern</h2>
            <div className="mgtWizardRow">
              <div className="atlGrow atlStack">
                <FormRow
                  full
                  label="Index pattern name"
                  help={
                    <>
                      Use an asterisk (<strong>*</strong>) to match multiple indices. Spaces and the characters{' '}
                      <strong>\, /, ?, ", &lt;, &gt;, |</strong> are not allowed.
                    </>
                  }
                  error={
                    illegal.length > 0
                      ? `An index pattern cannot contain spaces or the characters: ${illegal.map((char) => (char === ' ' ? 'space' : char)).join(', ')}`
                      : duplicate
                        ? `An index pattern with the title '${pattern}' already exists.`
                        : undefined
                  }
                >
                  <TextField
                    ref={input}
                    value={query}
                    onChange={onQuery}
                    placeholder="index-name-*"
                    invalid={illegal.length > 0 || Boolean(duplicate)}
                    autoFocus
                    testId="createIndexPatternNameInput"
                  />
                </FormRow>
                {duplicate && (
                  <div>
                    <Link to={patternPath(duplicate.id)}>Go to existing pattern</Link>
                  </div>
                )}
                <FormRow
                  full
                  label="Display name"
                  help="A friendly name to show in the UI instead of the index pattern. Leave empty to use the pattern as the display name."
                >
                  <TextField value={displayName} onChange={setDisplayName} placeholder="e.g., Production Logs" testId="createIndexPatternDisplayNameInput" />
                </FormRow>
                <Switch checked={hidden} onChange={setHidden} label="Include system and hidden indices" testId="showSystemAndHiddenIndices" />
              </div>
              <Button variant="primary" icon="chevronRight" iconSide="right" disabled={!canContinue} onClick={toStepTwo} testId="createIndexPatternGoToStep2Button">
                Next step
              </Button>
            </div>
            <div className="mgtWizardStatus">{status}</div>
            {all && visible.length > 0 && (
              <DataTable
                rows={visible}
                columns={matchColumns}
                rowId={(item) => `${item.name}/${item.tags[0]}`}
                pageSize={10}
                pageSizes={[5, 10, 20, 50]}
                compact
                testId="createIndexPatternStep1IndicesList"
              />
            )}
          </>
        ) : (
          <>
            <h2 className="atlTitleS mgtStepTitle">Step 2 of 2: Configure settings</h2>
            <p>
              Specify settings for your <strong>{pattern}</strong> index pattern.
            </p>
            {!fields ? (
              <Loading>Loading the fields</Loading>
            ) : (
              <div className="atlStack mgtWizardStep2">
                {fieldsError && (
                  <CallOut tone="critical" title="The fields could not be read">
                    {fieldsError}
                  </CallOut>
                )}
                {dateFields.length === 0 ? (
                  <p className="atlSubdued">The indices which match this index pattern don't contain any time fields.</p>
                ) : (
                  <>
                    <p className="atlSubdued">Select a primary time field for use with the global time filter.</p>
                    <div className="mgtTimeField">
                      <FormRow label="Time field">
                        <Select
                          value={timeField ?? ''}
                          onChange={(value) => setTimeField(value === '' ? undefined : value)}
                          placeholder="Select a time field"
                          options={[
                            ...dateFields.map((field) => ({ value: field.name, label: field.name })),
                            { value: '', label: '───', disabled: true },
                            { value: NO_TIME, label: "I don't want to use the time filter" },
                          ]}
                          testId="createIndexPatternTimeFieldSelect"
                        />
                      </FormRow>
                      <Button variant="empty" size="s" onClick={loadFields}>
                        Refresh
                      </Button>
                    </div>
                  </>
                )}
                <div>
                  <Button variant="empty" size="s" icon={advanced ? 'chevronDown' : 'chevronRight'} onClick={() => setAdvanced(!advanced)} testId="createIndexPatternAdvancedOptions">
                    {advanced ? 'Hide advanced settings' : 'Show advanced settings'}
                  </Button>
                </div>
                {advanced && (
                  <FormRow
                    label="Custom index pattern ID"
                    help={`${services.boot.name} will provide a unique identifier for each index pattern. If you do not want to use this unique ID, enter a custom one.`}
                  >
                    <TextField value={customId} onChange={setCustomId} placeholder="custom-index-pattern-id" testId="createIndexPatternIdInput" />
                  </FormRow>
                )}
                {createError && <CallOut tone="critical">{createError}</CallOut>}
              </div>
            )}
            <div className="atlRow mgtWizardFooter">
              <Button variant="empty" icon="chevronLeft" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button variant="primary" disabled={!fields || !timeChosen} loading={creating} onClick={create} testId="createIndexPatternButton">
                Create index pattern
              </Button>
            </div>
          </>
        )}
      </Panel>
    </div>
  );
}

// --- The page of one ------------------------------------------------------------------------------

const TABS = ['indexedFields', 'scriptedFields', 'sourceFilters'] as const;
type TabId = (typeof TABS)[number];

/** Whether a field's name matches a source filter: a name, or a pattern with `*` in it */
const matchesFilter = (name: string, filter: string) =>
  new RegExp(`^${filter.split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`).test(name);

function Dot({ on }: { on: boolean }) {
  return on ? <span className="mgtDot" role="img" aria-label="Yes" /> : null;
}

function EditIndexPattern({ id }: { id: string }) {
  const [pattern, setPattern] = useState<IndexPattern>();
  const [error, setError] = useState<string>();
  const [urlState, setUrlState] = useUrlState<{ tab: TabId }>('_a', { tab: 'indexedFields' });
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [confirm, setConfirm] = useState<'refresh' | 'delete'>();
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<{ kind: 'scripted' | 'filter'; value: string }>();
  const [newFilter, setNewFilter] = useState('');
  const [defaultId, setDefaultId] = useState(services.uiSettings.get<string | undefined>('defaultIndex'));

  useBreadcrumbs([MANAGEMENT, LIST, { text: pattern ? patternName(pattern) : 'Index pattern' }]);

  useEffect(() => {
    let live = true;
    services.indexPatterns.clear(id);
    services.indexPatterns
      .get(id)
      .then((loaded) => {
        if (!live) return;
        setPattern(loaded);
        setDisplayName(loaded.displayName ?? '');
      })
      .catch((failure) => live && setError(errorMessage(failure)));
    return () => {
      live = false;
    };
  }, [id]);

  const save = useCallback(async (next: IndexPattern, done?: string) => {
    setBusy(true);
    try {
      await services.indexPatterns.save(next);
      setPattern(next);
      if (done) services.toasts.success(done);
      return true;
    } catch (failure) {
      services.toasts.error(failure, 'The index pattern could not be saved');
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const filters = useMemo(() => (pattern?.sourceFilters ?? []).map((filter) => filter.value), [pattern]);
  const indexed = useMemo(() => (pattern?.fields ?? []).filter((field) => !field.scripted), [pattern]);
  const scripted = useMemo(() => (pattern?.fields ?? []).filter((field) => field.scripted), [pattern]);

  if (error) {
    return (
      <div className="mgtPage">
        <Panel>
          <EmptyPrompt icon="warning" title="This index pattern could not be opened" actions={<Button to={ROOT}>Back to index patterns</Button>}>
            {error}
          </EmptyPrompt>
        </Panel>
      </div>
    );
  }
  if (!pattern) {
    return (
      <div className="mgtPage">
        <Loading />
      </div>
    );
  }

  const needle = search.trim().toLowerCase();
  const found = (list: Field[]) => (needle ? list.filter((field) => field.name.toLowerCase().includes(needle)) : list);
  const shownIndexed = found(indexed).filter((field) => !typeFilter || field.type === typeFilter);
  const shownScripted = found(scripted);
  const shownFilters = needle ? filters.filter((filter) => filter.toLowerCase().includes(needle)) : filters;
  const count = (shown: number, total: number) => (shown === total ? `${total}` : `${shown} / ${total}`);
  const conflicts = indexed.filter((field) => field.type === 'conflict');
  const types = [...new Set(indexed.map((field) => field.type))].sort();
  const tab: TabId = TABS.includes(urlState.tab) ? urlState.tab : 'indexedFields';
  const isDefault = defaultId === pattern.id;
  const formatOf = (field: Field) => pattern.fieldFormatMap[field.name]?.id ?? '';

  const fieldColumns: Array<Column<Field>> = [
    {
      id: 'name',
      name: 'Name',
      render: (field) => (
        <span className="atlRow">
          <span data-test-subj="indexedFieldName">{field.name}</span>
          {field.name === pattern.timeFieldName && (
            <span title="This field represents the time that events occurred." className="atlSubdued atlSmall">
              (primary time field)
            </span>
          )}
        </span>
      ),
      sortValue: (field) => field.name,
      plainOrder: true,
    },
    {
      id: 'type',
      name: 'Type',
      width: 150,
      render: (field) =>
        field.type === 'conflict' ? (
          <span title="The type of this field changes across indices. It is unavailable for many analysis functions." className="mgtConflict">
            conflict
          </span>
        ) : (
          <span data-test-subj="indexedFieldType">{field.type}</span>
        ),
      sortValue: (field) => field.type,
    },
    { id: 'format', name: 'Format', width: 150, render: formatOf, sortValue: formatOf },
    { id: 'searchable', name: 'Searchable', width: 130, render: (field) => <Dot on={field.searchable} />, sortValue: (field) => (field.searchable ? 0 : 1) },
    {
      id: 'aggregatable',
      name: 'Aggregatable',
      width: 130,
      render: (field) => <Dot on={field.aggregatable} />,
      sortValue: (field) => (field.aggregatable ? 0 : 1),
    },
    {
      id: 'excluded',
      name: 'Excluded',
      width: 110,
      render: (field) => <Dot on={filters.some((filter) => matchesFilter(field.name, filter))} />,
    },
    {
      id: 'edit',
      name: '',
      width: 48,
      align: 'right',
      render: (field) => <IconButton icon="pencil" label={`Edit ${field.name}`} size="s" to={patternPath(pattern.id, `/field/${encodeURIComponent(field.name)}`)} />,
    },
  ];

  const scriptedColumns: Array<Column<Field>> = [
    { id: 'name', name: 'Name', render: (field) => field.name, sortValue: (field) => field.name },
    { id: 'lang', name: 'Lang', width: 110, render: (field) => field.lang ?? 'painless', sortValue: (field) => field.lang ?? '' },
    { id: 'script', name: 'Script', render: (field) => <code className="atlMono">{field.script}</code>, truncate: true },
    { id: 'format', name: 'Format', width: 130, render: formatOf, sortValue: formatOf },
    {
      id: 'actions',
      name: '',
      width: 84,
      align: 'right',
      render: (field) => (
        <span className="atlRow" style={{ justifyContent: 'flex-end' }}>
          <IconButton icon="pencil" label={`Edit ${field.name}`} size="s" to={patternPath(pattern.id, `/field/${encodeURIComponent(field.name)}`)} />
          <IconButton icon="trash" label={`Delete ${field.name}`} size="s" variant="danger" onClick={() => setRemoving({ kind: 'scripted', value: field.name })} />
        </span>
      ),
    },
  ];

  const filterColumns: Array<Column<string>> = [
    { id: 'filter', name: 'Filter', width: '30%', render: (filter) => <code className="atlMono">{filter}</code>, sortValue: (filter) => filter },
    {
      id: 'matches',
      name: 'Matches',
      render: (filter) => {
        const matched = indexed.filter((field) => matchesFilter(field.name, filter)).map((field) => field.name);
        return matched.length ? matched.join(', ') : <em>The source filter doesn't match any known fields.</em>;
      },
    },
    {
      id: 'actions',
      name: '',
      width: 48,
      align: 'right',
      render: (filter) => <IconButton icon="trash" label={`Delete ${filter}`} size="s" variant="danger" onClick={() => setRemoving({ kind: 'filter', value: filter })} />,
    },
  ];

  const refreshFields = async () => {
    setBusy(true);
    try {
      const fresh = await services.indexPatterns.fetchFields(pattern.title);
      // The fields come back as OpenSearch has them now; the scripted ones are this pattern's own
      await save({ ...pattern, fields: [...fresh, ...scripted] }, 'The field list was refreshed');
    } catch (failure) {
      services.toasts.error(failure, 'The field list could not be refreshed');
      setBusy(false);
    }
    setConfirm(undefined);
  };

  const remove = async () => {
    setBusy(true);
    try {
      await services.indexPatterns.delete(pattern.id);
      if (isDefault) {
        const others = await services.indexPatterns.list();
        await services.uiSettings.set('defaultIndex', others[0]?.id ?? null).catch(() => undefined);
      }
      navigate(ROOT);
    } catch (failure) {
      services.toasts.error(failure, 'The index pattern could not be deleted');
      setBusy(false);
      setConfirm(undefined);
    }
  };

  const addFilter = async () => {
    const value = newFilter.trim();
    if (!value || filters.includes(value)) return;
    if (await save({ ...pattern, sourceFilters: [...(pattern.sourceFilters ?? []), { value }] })) setNewFilter('');
  };

  const confirmRemoval = async () => {
    if (!removing) return;
    if (removing.kind === 'scripted') {
      const fieldFormatMap = { ...pattern.fieldFormatMap };
      delete fieldFormatMap[removing.value];
      await save({ ...pattern, fields: pattern.fields.filter((field) => !(field.scripted && field.name === removing.value)), fieldFormatMap });
    } else {
      const rest = (pattern.sourceFilters ?? []).filter((filter) => filter.value !== removing.value);
      await save({ ...pattern, sourceFilters: rest.length ? rest : undefined });
    }
    setRemoving(undefined);
  };

  return (
    <div className="mgtPage" data-test-subj="editIndexPattern">
      <Panel>
        <PageHeader
          title={<span data-test-subj="indexPatternTitle">{patternName(pattern)}</span>}
          actions={
            <>
              <IconButton
                icon="star"
                label="Set as default index."
                title={isDefault ? 'This is the default index pattern.' : 'Set as default index.'}
                disabled={isDefault}
                onClick={() =>
                  services.uiSettings.set('defaultIndex', pattern.id).then(
                    () => setDefaultId(pattern.id),
                    (failure) => services.toasts.error(failure)
                  )
                }
                testId="setDefaultIndexPatternButton"
              />
              <IconButton icon="refresh" label="Reload field list." title="Refresh field list." onClick={() => setConfirm('refresh')} testId="refreshFieldsIndexPatternButton" />
              <IconButton icon="trash" variant="danger" label="Remove index pattern." title="Remove index pattern." onClick={() => setConfirm('delete')} testId="deleteIndexPatternButton" />
            </>
          }
        />
        <div className="atlRow mgtBadges">
          {isDefault && <Badge>Default</Badge>}
          {pattern.timeFieldName && <Badge tone="warning">Time field: '{pattern.timeFieldName}'</Badge>}
          {pattern.displayName && <Badge>Index pattern: {pattern.title}</Badge>}
        </div>
        <p className="mgtLead">
          This page lists every field in the <strong>{patternName(pattern)}</strong> index and the field's associated core type as recorded by
          OpenSearch. To change a field type, use the OpenSearch Mapping API.
        </p>
        {conflicts.length > 0 && (
          <CallOut tone="warning" title="Mapping conflict">
            {plural(conflicts.length, 'A field is', `${conflicts.length} fields are`)} defined as several types (string, integer, etc) across the
            indices that match this pattern. You may still be able to use these conflict fields in parts of {services.boot.name}, but they will be
            unavailable for functions that require {services.boot.name} to know their type. Correcting this issue will require reindexing your data.
          </CallOut>
        )}
        <div className="mgtDisplayName">
          <FormRow label="Display name" help="A friendly name shown in the UI instead of the index pattern.">
            <TextField value={displayName} onChange={setDisplayName} placeholder={pattern.title} testId="editIndexPatternDisplayNameInput" />
          </FormRow>
          {displayName !== (pattern.displayName ?? '') && (
            <Button variant="primary" loading={busy} onClick={() => save({ ...pattern, displayName: displayName.trim() || undefined }, 'The display name was saved')}>
              Save
            </Button>
          )}
        </div>

        <Tabs
          tabs={[
            { id: 'indexedFields', label: `Fields (${count(shownIndexed.length, indexed.length)})` },
            { id: 'scriptedFields', label: `Scripted fields (${count(shownScripted.length, scripted.length)})` },
            { id: 'sourceFilters', label: `Source filters (${count(shownFilters.length, filters.length)})` },
          ]}
          selected={tab}
          onSelect={(next) => setUrlState({ tab: next as TabId })}
        />
        <div className="atlRow mgtTabTools">
          <div className="atlGrow">
            <SearchField value={search} onChange={setSearch} placeholder="Search" aria-label="Search fields" testId="indexPatternFieldFilter" />
          </div>
          {tab === 'indexedFields' && (
            <Select
              value={typeFilter}
              onChange={setTypeFilter}
              aria-label="Filter field types"
              options={[{ value: '', label: 'All field types' }, ...types.map((type) => ({ value: type, label: type }))]}
              style={{ width: 180 }}
              testId="indexedFieldTypeFilterDropdown"
            />
          )}
        </div>

        {tab === 'indexedFields' && (
          <DataTable
            rows={shownIndexed}
            columns={fieldColumns}
            rowId={(field) => field.name}
            initialSort={{ column: 'name', direction: 'asc' }}
            pageSize={10}
            pageSizes={[5, 10, 25, 50]}
            empty="No fields match"
          />
        )}

        {tab === 'scriptedFields' && (
          <>
            <div className="mgtTabHeader">
              <div className="atlGrow">
                <h3 className="atlTitleS">Scripted fields</h3>
                <p className="atlSubdued">
                  You can use scripted fields in visualizations and display them in your documents. However, you cannot search scripted fields.
                </p>
              </div>
              <Button to={patternPath(pattern.id, '/create-field')} testId="addScriptedFieldLink">
                Add scripted field
              </Button>
            </div>
            <DataTable
              rows={shownScripted}
              columns={scriptedColumns}
              rowId={(field) => field.name}
              initialSort={{ column: 'name', direction: 'asc' }}
              pageSize={10}
              pageSizes={[5, 10, 25, 50]}
              empty="No scripted fields"
            />
          </>
        )}

        {tab === 'sourceFilters' && (
          <>
            <div className="mgtTabHeader">
              <div className="atlGrow">
                <h3 className="atlTitleS">Source filters</h3>
                <p className="atlSubdued">
                  Source filters can be used to exclude one or more fields when fetching the document source. This happens when viewing a document in
                  the Discover app, or with a table displaying results from a saved search in the Dashboard app. Each row is built using the source
                  of a single document, and if you have documents with large or unimportant fields you may benefit from filtering those out at this
                  lower level.
                </p>
                <p className="atlSubdued">
                  Note that multi-fields will incorrectly appear as matches in the table below. These filters only actually apply to fields in the
                  original source document, so matching multi-fields are not actually being filtered.
                </p>
              </div>
            </div>
            <form
              className="atlRow mgtAddFilter"
              onSubmit={(event) => {
                event.preventDefault();
                void addFilter();
              }}
            >
              <div className="atlGrow">
                <TextField
                  value={newFilter}
                  onChange={setNewFilter}
                  placeholder="source filter, accepts wildcards (e.g., `user*` to filter fields starting with 'user')"
                  aria-label="New source filter"
                />
              </div>
              <Button type="submit" disabled={!newFilter.trim() || filters.includes(newFilter.trim())} loading={busy}>
                Add
              </Button>
            </form>
            <DataTable rows={shownFilters} columns={filterColumns} rowId={(filter) => filter} pageSize={10} pageSizes={[5, 10, 25, 50]} empty="No source filters" />
          </>
        )}
      </Panel>

      {confirm === 'refresh' && (
        <ConfirmModal title="Refresh field list?" confirmLabel="Refresh" busy={busy} onConfirm={refreshFields} onCancel={() => setConfirm(undefined)}>
          This action resets the popularity counter of each field.
        </ConfirmModal>
      )}
      {confirm === 'delete' && (
        <ConfirmModal title="Delete index pattern?" confirmLabel="Delete" danger busy={busy} onConfirm={remove} onCancel={() => setConfirm(undefined)}>
          The saved searches, visualizations and dashboards made on it will have nothing to read from.
        </ConfirmModal>
      )}
      {removing && (
        <ConfirmModal
          title={removing.kind === 'scripted' ? `Delete scripted field '${removing.value}'?` : `Delete source filter '${removing.value}'?`}
          confirmLabel="Delete"
          danger
          busy={busy}
          onConfirm={confirmRemoval}
          onCancel={() => setRemoving(undefined)}
        >
          {removing.kind === 'scripted' ? 'Visualizations that use the field will stop working.' : 'The fields it matches will be fetched again.'}
        </ConfirmModal>
      )}
    </div>
  );
}

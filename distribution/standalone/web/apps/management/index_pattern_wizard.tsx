/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The two steps that make an index pattern, as the original's wizard takes them: the pattern and
 * its display name, the indices it matches, then the time field and an id of one's own.
 */

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { cx } from '../../components/basic';
import { Icon } from '../../components/icon';
import { getLocation, navigate } from '../../router';
import { services } from '../../services';
import { errorMessage, HttpFetchError } from '../../services/http';
import { useBreadcrumbs } from '../../shell/state';
import {
  canAppendWildcard,
  containsIllegalCharacters,
  ensureMinimumTime,
  fieldToJson,
  ILLEGAL_CHARACTERS,
  ILLEGAL_CHARACTERS_VISIBLE,
  matchedIndicesOf,
  preselectedTimeField,
  resolvedOrNone,
  timeFieldChoice,
  timeFieldOptions,
  timeFieldOptionValue,
  type MatchedItem,
  type ResolveResponse,
  type TimeFieldOption,
} from './index_pattern_model';
import { fetchFields, setting } from './index_pattern_store';
import { Confirm, Dropdown, Pagination } from './index_pattern_table';
import { CallOut, ExternalLink, FormRow, LIST_CRUMB, MANAGEMENT_CRUMB, patternPath, SmallButton } from './index_patterns';

const INTRODUCTION_DOCS = 'https://opensearch.org/docs/latest';
const PER_PAGE_INCREMENTS = [5, 10, 20, 50];

/** The indices, aliases and data streams a pattern names; nothing for what cannot be one */
async function getIndices(rawPattern: string, showAll: boolean): Promise<MatchedItem[]> {
  const pattern = rawPattern.trim();
  if (pattern === '' || pattern === '*:' || pattern.startsWith(',')) return [];
  const path = encodeURIComponent(pattern).replace(/%2C/gi, ',').replace(/%3A/gi, ':');
  return resolvedOrNone(
    services.http.get<ResolveResponse>(`/internal/index-pattern-management/resolve_index/${path}`, {
      query: { expand_wildcards: showAll ? 'all' : undefined },
    })
  );
}

/** What failed to load is told in a warning, and the list is then empty */
async function catchAndWarn(work: Promise<MatchedItem[]>, title: string): Promise<MatchedItem[]> {
  try {
    return await work;
  } catch (failure) {
    services.toasts.warning(title, failure instanceof HttpFetchError ? failure.message : errorMessage(failure));
    return [];
  }
}

export function CreateIndexPatternWizard() {
  useBreadcrumbs([MANAGEMENT_CRUMB, LIST_CRUMB, { text: 'Create index pattern' }]);
  const [allIndices, setAllIndices] = useState<MatchedItem[]>();
  const [step, setStep] = useState<1 | 2>(1);
  const [chosen, setChosen] = useState<{ pattern: string; timeField?: string; displayName?: string }>();

  useEffect(() => {
    let live = true;
    void ensureMinimumTime(catchAndWarn(getIndices('*', false), 'Failed to load indices')).then(
      (indices) => live && setAllIndices(indices)
    );
    return () => {
      live = false;
    };
  }, []);

  if (!allIndices) {
    return (
      <div className="inpLoadingState">
        <h2 className="inpTitle inpTitle--s">Checking for OpenSearch data</h2>
        <span className="inpSpinner inpSpinner--l" />
      </div>
    );
  }

  return (
    <div className="inpPanel">
      <div>
        <h1 className="inpTitle">Create index pattern</h1>
        <div className="inpSpacer--s" />
        <p className="inpText inpText--m">
          An index pattern can match a single source, for example, <code className="inpCode">filebeat-4-3-22</code>,
          or <strong>multiple</strong> data sources, <code className="inpCode">filebeat-*</code>.
          <br />
          <ExternalLink to={INTRODUCTION_DOCS}>Read documentation</ExternalLink>
        </p>
      </div>
      <hr className="inpRule" />
      {step === 1 ? (
        <StepIndexPattern
          allIndices={allIndices}
          initialQuery={chosen?.pattern ?? new URLSearchParams(getLocation().search).get('id') ?? undefined}
          initialDisplayName={chosen?.displayName}
          onNext={(pattern, timeField, displayName) => {
            setChosen({ pattern, timeField, displayName });
            setStep(2);
          }}
        />
      ) : (
        chosen && (
          <StepTimeField
            pattern={chosen.pattern}
            displayName={chosen.displayName}
            preselected={chosen.timeField}
            onBack={() => setStep(1)}
          />
        )
      )}
    </div>
  );
}

// --- Step 1 ----------------------------------------------------------------------------------------

function StepIndexPattern({
  allIndices,
  initialQuery,
  initialDisplayName,
  onNext,
}: {
  allIndices: MatchedItem[];
  initialQuery?: string;
  initialDisplayName?: string;
  onNext: (pattern: string, timeField: string | undefined, displayName: string | undefined) => void;
}) {
  const [query, setQuery] = useState(() => initialQuery || String(setting('indexPattern:placeholder') ?? ''));
  const [displayName, setDisplayName] = useState(initialDisplayName ?? '');
  const [partial, setPartial] = useState<MatchedItem[]>([]);
  const [exact, setExact] = useState<MatchedItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [exists, setExists] = useState(false);
  const [showingErrors, setShowingErrors] = useState(false);
  const [includingSystem, setIncludingSystem] = useState(false);
  const appendedWildcard = useRef(false);
  const lastQuery = useRef(query);
  const existingRef = useRef<string[]>([]);
  const input = useRef<HTMLInputElement>(null);

  const fetchIndices = async (text: string, system: boolean) => {
    if (existingRef.current.includes(text)) {
      setExists(true);
      return;
    }
    setLoading(true);
    setExists(false);
    if (text.endsWith('*')) {
      const matched = await ensureMinimumTime(catchAndWarn(getIndices(text, system), 'Failed to load indices'));
      if (text !== lastQuery.current) return;
      setExact(matched);
      setLoading(false);
      return;
    }
    const [partialMatched, exactMatched] = await ensureMinimumTime(
      Promise.all([
        catchAndWarn(getIndices(`${text}*`, system), 'Failed to load indices'),
        catchAndWarn(getIndices(text, system), 'Failed to load indices'),
      ])
    );
    if (text !== lastQuery.current) return;
    setPartial(partialMatched);
    setExact(exactMatched);
    setLoading(false);
  };

  useEffect(() => {
    let live = true;
    services.http
      .get<{ saved_objects: Array<{ attributes?: { title?: string } }> }>('/api/saved_objects/_find', {
        query: { fields: ['title'], per_page: 10000, type: 'index-pattern' },
      })
      .then((answer) => {
        if (!live) return;
        existingRef.current = answer.saved_objects.map((object) => object.attributes?.title ?? '');
      })
      .catch(() => undefined);
    if (query) void fetchIndices(query, includingSystem);
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onQueryChanged = (event: ChangeEvent<HTMLInputElement>) => {
    const target = event.target;
    let next = target.value;
    if (next.length === 1 && canAppendWildcard(next)) {
      next += '*';
      appendedWildcard.current = true;
      setTimeout(() => target.setSelectionRange?.(1, 1));
    } else if (next === '*' && appendedWildcard.current) {
      next = '';
      appendedWildcard.current = false;
    }
    lastQuery.current = next;
    setQuery(next);
    setShowingErrors(!!next.length);
    void fetchIndices(next, includingSystem);
  };

  const matched = matchedIndicesOf(allIndices, partial, exact, includingSystem);
  const characterList = ILLEGAL_CHARACTERS_VISIBLE.join(', ');
  const errors: string[] = [];
  let containsErrors = false;
  if (!query || query === '.' || query === '..') containsErrors = true;
  else if (containsIllegalCharacters(query, ILLEGAL_CHARACTERS)) {
    errors.push(`A index pattern cannot contain spaces or the characters: ${characterList}`);
    containsErrors = true;
  }
  const invalid = showingErrors && containsErrors && errors.length > 0;
  const nextDisabled = containsErrors || matched.exactMatchedIndices.length === 0 || exists;
  const listed = query.length ? matched.visibleIndices : matched.allIndices;

  return (
    <>
      <div data-test-subj="createIndexPatternStep1Header">
        <h2 className="inpTitle inpTitle--s">Step 1 of 2: Define an index pattern</h2>
        <div className="inpSpacer--m" />
        <div className="inpStepRow">
          <div className="inpStepRow__form">
            {invalid && (
              <div className="inpFormErrors" role="alert">
                <CallOut tone="danger" title="Please address the highlighted errors." />
              </div>
            )}
            <FormRow
              wide
              id="inpPatternName"
              label="Index pattern name"
              error={invalid ? errors.map((error) => <div key={error}>{error}</div>) : undefined}
              help={
                <>
                  Use an asterisk (<strong>*</strong>) to match multiple indices. Spaces and the characters{' '}
                  <strong>{characterList}</strong> are not allowed.
                </>
              }
            >
              <input
                ref={input}
                id="inpPatternName"
                type="text"
                name="indexPattern"
                className={cx('inpInput', invalid && 'inpInput--invalid')}
                placeholder="index-name-*"
                value={query}
                aria-invalid={invalid || undefined}
                onChange={onQueryChanged}
                data-test-subj="createIndexPatternNameInput"
              />
            </FormRow>
            <FormRow
              wide
              id="inpPatternDisplayName"
              label="Display name"
              help="A friendly name to show in the UI instead of the index pattern. Leave empty to use the pattern as the display name."
            >
              <input
                id="inpPatternDisplayName"
                type="text"
                name="displayName"
                className="inpInput"
                placeholder="e.g., Production Logs"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                data-test-subj="createIndexPatternDisplayNameInput"
              />
            </FormRow>
            <div className="inpFormRow">
              <label className="inpSwitch">
                <button
                  type="button"
                  role="switch"
                  aria-checked={includingSystem}
                  className={cx('inpSwitch__button', includingSystem && 'inpSwitch__button--on')}
                  data-test-subj="showSystemAndHiddenIndices"
                  onClick={() => {
                    const next = !includingSystem;
                    setIncludingSystem(next);
                    void fetchIndices(query, next);
                  }}
                >
                  <span className="inpSwitch__body">
                    <span className="inpSwitch__thumb" />
                  </span>
                </button>
                <span className="inpSwitch__label">Include system and hidden indices</span>
              </label>
            </div>
          </div>
          <div className="inpStepRow__next">
            <button
              type="button"
              className="inpButton inpButton--fill inpButton--iconRight"
              disabled={nextDisabled}
              data-test-subj="createIndexPatternGoToStep2Button"
              onClick={() => onNext(query, preselectedTimeField(matched.exactMatchedIndices), displayName || undefined)}
            >
              <span className="inpButton__content">
                <span className="inpButton__text">Next step</span>
                <Icon name="chevronRight" />
              </span>
            </button>
          </div>
        </div>
      </div>
      <div className="inpSpacer--step" />
      {loading && (
        <>
          <div className="inpSpacer--l" />
          <div className="inpLoadingState" data-test-subj="createIndexPatternStep1Loading">
            <h3 className="inpTitle inpTitle--s">Looking for matching indices…</h3>
            <span className="inpSpinner inpSpinner--l" />
          </div>
          <div className="inpSpacer--l" />
        </>
      )}
      {exists && (
        <CallOut tone="warning" icon="help" title={`There's already an index pattern called ${query}`} />
      )}
      {!loading && !exists && <StatusMessage matched={matched} includingSystem={includingSystem} query={query} />}
      <div className="inpSpacer--l" />
      {!loading && !exists && (
        <IndicesList key={listed.length} indices={listed} query={query} />
      )}
    </>
  );
}

function StatusMessage({
  matched,
  includingSystem,
  query,
}: {
  matched: ReturnType<typeof matchedIndicesOf>;
  includingSystem: boolean;
  query: string;
}) {
  const all = matched.allIndices.length;
  let tone: 'primary' | 'success' | 'warning' = 'primary';
  let icon: 'check' | undefined;
  let message;
  if (query.length === 0) {
    if (all >= 1) message = <span>Your index pattern can match {all === 1 ? `your ${all} source` : `any of your ${all} sources`}.</span>;
    else if (!includingSystem)
      message = <span>No OpenSearch indices match your pattern. To view the matching system indices, toggle the switch above.</span>;
    else message = <span>No OpenSearch indices match your pattern.</span>;
  } else if (matched.exactMatchedIndices.length) {
    const count = matched.exactMatchedIndices.length;
    tone = 'success';
    icon = 'check';
    message = (
      <span>
        {' '}Your index pattern matches {count} {count === 1 ? 'source' : 'sources'}.
      </span>
    );
  } else if (matched.partialMatchedIndices.length) {
    const count = matched.partialMatchedIndices.length;
    message = (
      <span>
        Your index pattern doesn&apos;t match any indices, but you have <strong>{count === 1 ? 'index' : `${count} indices`}</strong> which{' '}
        {count === 1 ? 'looks' : 'look'} similar.
      </span>
    );
  } else {
    tone = 'warning';
    message = (
      <span>
        The index pattern you&apos;ve entered doesn&apos;t match any indices. You can match {all === 1 ? 'your' : 'any of your'}{' '}
        <strong>{all === 1 ? `${all} index` : `${all} indices`}</strong>, below.
      </span>
    );
  }
  return (
    <div data-test-subj="createIndexPatternStatusMessage">
      <CallOut tone={tone} size="s" icon={icon} title={message} />
    </div>
  );
}

function highlight(name: string, query: string) {
  const at = name.indexOf(query);
  if (!query || at === -1) return name;
  return (
    <span>
      {name.slice(0, at)}
      <strong>{query}</strong>
      {name.slice(at + query.length)}
    </span>
  );
}

const BADGE_TONES: Record<string, string> = { default: 'default', primary: 'primary', danger: 'danger' };

function IndicesList({ indices, query }: { indices: MatchedItem[]; query: string }) {
  const [page, setPage] = useState(0);
  const [perPage, setPerPage] = useState(PER_PAGE_INCREMENTS[1]);
  const [open, setOpen] = useState(false);
  const bare = query.endsWith('*') ? query.slice(0, -1) : query;
  const pageCount = Math.ceil(indices.length / perPage);
  const shown = indices.slice(page * perPage, page * perPage + perPage);
  return (
    <div data-test-subj="createIndexPatternStep1IndicesList">
      <table className="inpTable inpTable--auto">
        <tbody>
          {shown.map((index, key) => (
            <tr key={key} className="inpTable__row">
              {/* EuiTableRowCell sets what it holds in a line of text, the badges too */}
              <td className="inpTable__td">
                <span className="inpTable__content">
                  <span className="inpTable__text">{highlight(index.name, bare)}</span>
                </span>
              </td>
              <td className="inpTable__td">
                <span className="inpTable__content">
                  <span className="inpTable__text">
                    {index.tags.map((tag) => (
                      <span
                        key={tag.key}
                        className={cx('inpBadge', `inpBadge--${BADGE_TONES[tag.color] ?? 'default'}`)}
                        title={tag.name}
                      >
                        <span className="inpBadge__text">{tag.name}</span>
                      </span>
                    ))}
                  </span>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="inpSpacer--m" />
      <div className="inpIndicesFooter">
        <Dropdown
          open={open}
          onClose={() => setOpen(false)}
          button={
            <button type="button" className="inpButtonEmpty inpButtonEmpty--s inpButtonEmpty--text" onClick={() => setOpen(true)}>
              <span className="inpButtonEmpty__text">Rows per page: {perPage}</span>
              <Icon name="chevronDown" />
            </button>
          }
        >
          <div className="inpMenu" role="menu">
            {PER_PAGE_INCREMENTS.map((increment) => (
              <button
                key={increment}
                type="button"
                role="menuitem"
                className="inpMenu__item"
                onClick={() => {
                  setPerPage(increment);
                  setPage(0);
                  setOpen(false);
                }}
              >
                <span className="inpMenu__check" />
                {increment}
              </button>
            ))}
          </div>
        </Dropdown>
        {pageCount > 1 && <Pagination pageCount={pageCount} activePage={page} onPage={setPage} />}
      </div>
    </div>
  );
}

// --- Step 2 ----------------------------------------------------------------------------------------

interface DuplicateTitle {
  id: string;
}

function StepTimeField({
  pattern,
  displayName,
  preselected,
  onBack,
}: {
  pattern: string;
  displayName?: string;
  preselected?: string;
  onBack: () => void;
}) {
  const [timeFields, setTimeFields] = useState<TimeFieldOption[]>([]);
  const [fetching, setFetching] = useState(true);
  const [selected, setSelected] = useState<string | undefined>(preselected);
  const [timeFieldSet, setTimeFieldSet] = useState(!!preselected);
  const [advanced, setAdvanced] = useState(false);
  const [customId, setCustomId] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [duplicate, setDuplicate] = useState<DuplicateTitle>();
  const mounted = useRef(true);

  const fetchTimeFields = async () => {
    setFetching(true);
    try {
      const fields = await ensureMinimumTime(fetchFields(pattern));
      if (mounted.current) setTimeFields(timeFieldOptions(fields));
    } catch (failure) {
      if (mounted.current) setTimeFields(timeFieldOptions([]));
      services.toasts.error(failure, 'The fields of the index pattern could not be read');
    }
    if (mounted.current) setFetching(false);
  };

  useEffect(() => {
    mounted.current = true;
    void fetchTimeFields();
    return () => {
      mounted.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const create = async () => {
    setCreating(true);
    try {
      // The fields are read again for the new pattern, as the original's createAndSave does
      const fields = await fetchFields(pattern);
      const found = await services.http.get<{ saved_objects: Array<{ id: string; attributes?: { title?: string } }> }>(
        '/api/saved_objects/_find',
        { query: { fields: ['title'], per_page: 10, search: `"${pattern}"`, search_fields: ['title'], type: 'index-pattern' } }
      );
      const same = found.saved_objects.find((object) => object.attributes?.title?.toLowerCase() === pattern.toLowerCase());
      if (same) {
        setDuplicate({ id: same.id });
        setCreating(false);
        return;
      }
      const attributes = {
        title: pattern,
        displayName,
        timeFieldName: selected,
        fields: JSON.stringify(fields.map(fieldToJson)),
      };
      const saved = await services.savedObjects.create('index-pattern', attributes, { id: customId || undefined });
      if (!services.uiSettings.get<string | undefined>('defaultIndex')) {
        await services.uiSettings.set('defaultIndex', saved.id);
      }
      services.indexPatterns.clear(saved.id);
      navigate(patternPath(saved.id));
    } catch (failure) {
      if (!mounted.current) return;
      // The original says the words of the answer's status, "Conflict" for an id already taken
      setError(failure instanceof HttpFetchError ? failure.statusText || failure.message : errorMessage(failure));
      setCreating(false);
    }
  };

  if (creating) {
    return (
      <div className="inpLoadingState">
        <h3 className="inpTitle inpTitle--s">Creating index pattern…</h3>
        <span className="inpSpinner inpSpinner--l" />
      </div>
    );
  }

  const options =
    timeFields.length > 0
      ? [{ text: '', value: '', disabled: false }, ...timeFields.map((field) => ({ text: field.display, value: timeFieldOptionValue(field), disabled: !!field.isDisabled }))]
      : [];
  // The choice of no time field has no field name: the select shows it by the value of its option
  const none = timeFields.find((field) => field.fieldName === undefined);
  const showTimeField = timeFields.length > 1;
  const submittable = !showTimeField || timeFieldSet;

  return (
    <>
      <div>
        <h2 className="inpTitle inpTitle--s">Step 2 of 2: Configure settings</h2>
        <div className="inpSpacer--m" />
        <div className="inpText inpText--m">
          Specify settings for your <strong>{pattern}</strong> index pattern.
        </div>
      </div>
      <div className="inpSpacer--m" />
      {fetching && timeFields.length === 0 ? (
        <div>
          <div className="inpText inpText--m">
            <p>Select a primary time field for use with the global time filter.</p>
          </div>
          <div className="inpSpacer--l" />
          <TimeFieldRow loading onRefresh={fetchTimeFields} />
        </div>
      ) : showTimeField ? (
        <div>
          <div className="inpText inpText--m">
            <p>Select a primary time field for use with the global time filter.</p>
          </div>
          <div className="inpSpacer--l" />
          <TimeFieldRow
            loading={fetching}
            onRefresh={fetchTimeFields}
            options={options}
            value={selected ?? (timeFieldSet && none ? timeFieldOptionValue(none) : undefined)}
            onChange={(value) => {
              const choice = timeFieldChoice(timeFields, value);
              setSelected(choice.fieldName);
              setTimeFieldSet(choice.chosen);
            }}
          />
        </div>
      ) : (
        <div className="inpText inpText--m">
          <p>The indices which match this index pattern don&apos;t contain any time fields.</p>
        </div>
      )}
      <hr className="inpRule" />
      <div>
        <button type="button" className="inpButtonEmpty inpButtonEmpty--s inpButtonEmpty--primary" onClick={() => setAdvanced(!advanced)}>
          <Icon name={advanced ? 'chevronDown' : 'chevronRight'} />
          <span className="inpButtonEmpty__text">{advanced ? 'Hide advanced settings' : 'Show advanced settings'}</span>
        </button>
        <div className="inpSpacer--xs" />
        {advanced && (
          <FormRow
            id="inpCustomId"
            label="Custom index pattern ID"
            help="OpenSearch Dashboards will provide a unique identifier for each index pattern. If you do not want to use this unique ID, enter a custom one."
          >
            <input
              id="inpCustomId"
              type="text"
              name="indexPatternId"
              className="inpInput"
              data-test-subj="createIndexPatternIdInput"
              value={customId}
              placeholder="custom-index-pattern-id"
              onChange={(event) => setCustomId(event.target.value)}
            />
          </FormRow>
        )}
      </div>
      <div className="inpSpacer--m" />
      {error && (
        <>
          <CallOut tone="danger" icon="cross" title="Error">
            <p>{error === 'Conflict' ? 'Custom index pattern ID already exists.' : error}</p>
          </CallOut>
          <div className="inpSpacer--m" />
        </>
      )}
      <div className="inpActions">
        <button type="button" className="inpButtonEmpty inpButtonEmpty--s inpButtonEmpty--primary" onClick={onBack}>
          <Icon name="chevronLeft" />
          <span className="inpButtonEmpty__text">Back</span>
        </button>
        <SmallButton fill disabled={!submittable} testId="createIndexPatternButton" onClick={create}>
          Create index pattern
        </SmallButton>
      </div>
      {duplicate && (
        <Confirm
          title={`An index pattern with the title '${pattern}' already exists.`}
          confirmLabel="Go to existing pattern"
          onCancel={() => setDuplicate(undefined)}
          onConfirm={() => navigate(patternPath(duplicate.id))}
        />
      )}
    </>
  );
}

function TimeFieldRow({
  loading,
  onRefresh,
  options = [],
  value,
  onChange,
}: {
  loading: boolean;
  onRefresh: () => void;
  options?: Array<{ text: string; value: string; disabled: boolean }>;
  value?: string;
  onChange?: (value: string) => void;
}) {
  return (
    <div className="inpFormRow">
      <div className="inpFormRow__labelRow">
        <label className="inpFormRow__label" htmlFor="inpTimeField">
          Time field
        </label>
        {loading ? (
          <span className="inpSpinner inpSpinner--s" />
        ) : (
          <button type="button" className="inpLink inpLink--button inpLink--xs" onClick={onRefresh}>
            Refresh
          </button>
        )}
      </div>
      <div className="inpSelectWrap">
        <select
          id="inpTimeField"
          name="timeField"
          className="inpSelect"
          data-test-subj="createIndexPatternTimeFieldSelect"
          disabled={loading}
          value={loading ? '' : value ?? ''}
          onChange={(event) => onChange?.(event.target.value)}
        >
          {loading ? (
            <option value="">Loading…</option>
          ) : (
            options.map((option, index) => (
              <option key={index} value={option.value} disabled={option.disabled}>
                {option.text}
              </option>
            ))
          )}
        </select>
        <Icon name="chevronDown" className="inpSelectWrap__arrow" />
      </div>
    </div>
  );
}

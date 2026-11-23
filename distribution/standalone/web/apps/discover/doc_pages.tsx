/* SPDX-License-Identifier: Apache-2.0 */

/* One document on a page of its own, and a document among those just before and after it. */

import { useEffect, useMemo, useState } from 'react';
import { Button, CallOut, Loading, Panel, cx } from '../../components/basic';
import { NumberField } from '../../components/form';
import type { RawHit } from '../../lib/docs';
import { buildQuery, existsFilter, mergeFilters } from '../../lib/query';
import type { Filter, IndexPattern } from '../../lib/types';
import { appUrl, decodeState, encodeState } from '../../lib/url';
import { setHashParams, useLocation } from '../../router';
import { services } from '../../services';
import { HttpFetchError } from '../../services/http';
import { FilterBar, isPinned, splitFilters } from '../../shell/filter_bar';
import { useBreadcrumbs, useGlobalState } from '../../shell/state';
import {
  MAX_CONTEXT_SIZE,
  MIN_CONTEXT_SIZE,
  anchorRequest,
  contextCount,
  contextRows,
  isValidCount,
  loadMoreCount,
  surroundingRequest,
  tieBreakerField,
  typedCount,
  type ContextSide,
} from './context';
import { DocDetails, DocViewer } from './doc_viewer';
import { DocTable, toggledColumns } from './doc_table';
import { filtersOf, valueFilter } from './filters';
import { allFields, documentFields } from './search';

function usePattern(id: string) {
  const [pattern, setPattern] = useState<IndexPattern>();
  const [error, setError] = useState<string>();
  /** Whether the failure was that no index pattern has the id */
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let live = true;
    services.indexPatterns
      .get(id)
      .then((loaded) => live && setPattern(loaded))
      .catch((failure) => {
        if (!live) return;
        setMissing(failure instanceof HttpFetchError && failure.status === 404);
        setError((failure as Error).message);
      });
    return () => {
      live = false;
    };
  }, [id]);
  return { pattern, error, missing };
}

export function DocPage({
  indexPatternId,
  index,
  id,
  basePath,
}: {
  indexPatternId: string;
  index: string;
  id: string;
  basePath: string;
}) {
  const { pattern, error: patternError, missing } = usePattern(indexPatternId);
  const [hit, setHit] = useState<RawHit | null>();
  const [error, setError] = useState<string>();
  useBreadcrumbs([{ text: 'Discover', to: appUrl(basePath, '/') }, { text: `${index}#${id}` }]);

  useEffect(() => {
    if (!pattern) return undefined;
    let live = true;
    services.search
      .search(index, { ...documentFields(pattern), size: 1, query: { ids: { values: [id] } } })
      .then((response) => live && setHit((response.hits.hits[0] as RawHit | undefined) ?? null))
      .catch((failure) => live && setError((failure as Error).message));
    return () => {
      live = false;
    };
  }, [pattern, index, id]);

  // As the original's page: what it has to say in the panel the document is shown in. Where the
  // original says a search that failed for any reason is "{index} is missing.", the failure's own
  // words are shown.
  const problem = patternError ?? error;
  return (
    <div className="dscDocPage" data-test-subj="discoverAppPage">
      <Panel className="dscDocPage__content">
        {missing ? (
          <div data-test-subj="doc-msg-notFoundIndexPattern">
            <CallOut tone="critical" title={`No index pattern matches ID ${indexPatternId}`} />
          </div>
        ) : problem ? (
          <div data-test-subj="doc-msg-error">
            <CallOut tone="critical" title="Cannot run search">
              {problem}
            </CallOut>
          </div>
        ) : hit === null ? (
          <div data-test-subj="doc-msg-notFound">
            <CallOut tone="critical" title="Cannot find document">
              No documents match that ID.
            </CallOut>
          </div>
        ) : !hit || !pattern ? (
          <Loading />
        ) : (
          <div data-test-subj="doc-hit">
            <DocViewer hit={hit} indexPattern={pattern} />
          </div>
        )}
      </Panel>
    </div>
  );
}

/** What the context view keeps in the address, as the original's `_a` */
interface ContextAppState {
  columns?: string[];
  filters?: Filter[];
  predecessorCount?: number | string;
  successorCount?: number | string;
}

type SideStatus = 'loading' | 'loaded' | 'failed';

/**
 * The documents on one side of the anchor, searched again when the anchor, the count or the
 * filters change; the rows of the last search stay while the next one runs
 */
function useSurrounding(
  side: ContextSide,
  anchor: RawHit | undefined,
  pattern: IndexPattern | undefined,
  tieBreaker: string | undefined,
  count: number,
  filters: Filter[]
): { rows: RawHit[]; status: SideStatus } {
  const [state, setState] = useState<{ rows: RawHit[]; status: SideStatus }>({ rows: [], status: 'loading' });
  const filtersKey = JSON.stringify(filters);
  useEffect(() => {
    const timeField = pattern?.timeFieldName;
    if (!anchor || !pattern || !timeField || !tieBreaker) return undefined;
    // The original asks for nothing when a side wants no documents
    if (!count) {
      setState({ rows: [], status: 'loaded' });
      return undefined;
    }
    let live = true;
    setState((last) => ({ ...last, status: 'loading' }));
    const filterQuery = buildQuery(pattern, undefined, filters, services.queryConfig());
    services.search
      .search(pattern.title, {
        ...documentFields(pattern),
        ...allFields(),
        ...surroundingRequest(side, anchor, timeField, tieBreaker, count, filterQuery),
      })
      .then((response) => live && setState({ rows: response.hits.hits as RawHit[], status: 'loaded' }))
      .catch(() => {
        if (!live) return;
        setState((last) => ({ ...last, status: 'failed' }));
        services.toasts.danger('Unable to fetch surrounding documents');
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [side, anchor, pattern, tieBreaker, count, filtersKey]);
  return state;
}

/**
 * The original's action bar above the newer documents and under the older ones: "Load" asks for
 * context:step more, the field for any count up to OpenSearch's limit (taken on Enter or when it
 * loses the focus), and a warning says when fewer documents were found than asked for
 */
function ContextActionBar({
  side,
  count,
  available,
  step,
  disabled,
  loading,
  onChange,
}: {
  side: ContextSide;
  count: number;
  available: number;
  step: number;
  disabled: boolean;
  loading: boolean;
  onChange: (count: number) => void;
}) {
  const older = side === 'successors';
  const [draft, setDraft] = useState<number | undefined>(count);
  useEffect(() => setDraft(count), [count]);
  const take = () => {
    if (draft !== undefined && draft !== count && isValidCount(draft)) onChange(draft);
  };
  const warning =
    !disabled && !loading && available < count ? (
      <div className="dscContextBar__warning" data-test-subj={`${side}WarningMsg`}>
        <CallOut tone="warning" size="s" icon="bolt">
          {available === 0
            ? `No documents ${older ? 'older' : 'newer'} than the anchor could be found.`
            : `Only ${available} documents ${older ? 'older' : 'newer'} than the anchor could be found.`}
        </CallOut>
      </div>
    ) : null;
  return (
    <form
      className={cx('dscContextBar', older && 'dscContextBar--older')}
      onSubmit={(event) => {
        event.preventDefault();
        take();
      }}
    >
      {older && warning}
      <div className="dscContextBar__row">
        <Button
          variant="empty"
          icon={older ? 'chevronDown' : 'chevronUp'}
          className="dscContextBar__load"
          disabled={disabled}
          loading={loading}
          testId={`${side}LoadMoreButton`}
          onClick={() => {
            if (draft === undefined) return;
            const next = loadMoreCount(draft, step);
            if (next === undefined) return;
            setDraft(next);
            onChange(next);
          }}
        >
          Load
        </Button>
        <NumberField
          className="dscContextBar__count"
          value={draft}
          min={MIN_CONTEXT_SIZE}
          max={MAX_CONTEXT_SIZE}
          disabled={disabled}
          testId={`${side}CountPicker`}
          aria-label={older ? 'Number of older documents' : 'Number of newer documents'}
          onChange={(typed) => setDraft(typedCount(typed, count))}
          onBlur={take}
        />
        <span className="dscContextBar__text">{older ? 'older documents' : 'newer documents'}</span>
      </div>
      {!older && warning}
    </form>
  );
}

/**
 * A document among the documents just before and after it, as the original's context view: the
 * filters of the page over a panel with the newer documents, the anchor highlighted, and the older
 * ones, each side with its own count
 */
export function ContextPage({ indexPatternId, id, basePath }: { indexPatternId: string; id: string; basePath: string }) {
  const location = useLocation();
  const [global, setGlobal] = useGlobalState();
  const { pattern, error: patternError } = usePattern(indexPatternId);
  useBreadcrumbs([{ text: 'Discover', to: appUrl(basePath, '/') }, { text: `Context of #${id}` }]);

  const defaultSize = services.uiSettings.get<unknown>('context:defaultSize', 5);
  const step = contextCount(services.uiSettings.get<unknown>('context:step', 5), 5);
  const app = useMemo(() => decodeState<ContextAppState>(location.hashParams._a), [location.hashParams._a]);
  const columns = useMemo(() => (Array.isArray(app.columns) && app.columns.length ? app.columns : ['_source']), [app.columns]);
  const predecessorCount = contextCount(app.predecessorCount, defaultSize);
  const successorCount = contextCount(app.successorCount, defaultSize);
  const appFilters = useMemo(() => filtersOf(app.filters), [app.filters]);
  const ownFilters = useMemo(() => appFilters.filter((filter) => !isPinned(filter)), [appFilters]);
  const filters = useMemo(() => [...global.filters, ...ownFilters], [global.filters, ownFilters]);

  // The original's state also records its one sort, the time field's, newest first
  const writeApp = (changes: Partial<ContextAppState>) =>
    setHashParams(
      {
        _a: encodeState({
          columns,
          filters: appFilters,
          predecessorCount,
          sort: [pattern?.timeFieldName, 'desc'],
          successorCount,
          ...changes,
        }),
      },
      { replace: true }
    );
  const setFilters = (next: Filter[]) => {
    const { pinned, app: own } = splitFilters(next);
    if (JSON.stringify(pinned) !== JSON.stringify(global.filters)) setGlobal({ filters: pinned });
    if (JSON.stringify(own) !== JSON.stringify(ownFilters)) writeApp({ filters: own });
  };
  const fieldOf = (name: string) => pattern?.fields.find((field) => field.name === name) ?? { name };
  const addFilter = (name: string, value: unknown, negate: boolean) => {
    if (!pattern) return;
    const pinned = services.uiSettings.get('filters:pinnedByDefault', false);
    const made = (Array.isArray(value) ? value : [value]).map((item) => valueFilter(fieldOf(name), item, negate, pattern.id, pinned));
    setFilters(mergeFilters(filters, made));
  };
  const addExists = (name: string) => {
    if (pattern) setFilters(mergeFilters(filters, [existsFilter(fieldOf(name), pattern.id)]));
  };

  // --- The anchor, sorted on the time and the first field of context:tieBreakerFields that sorts ---
  const tieBreaker = useMemo(
    () => (pattern ? tieBreakerField(pattern, services.uiSettings.get<unknown>('context:tieBreakerFields', ['_doc'])) : undefined),
    [pattern]
  );
  const [anchor, setAnchor] = useState<RawHit>();
  const [anchorError, setAnchorError] = useState<string>();
  useEffect(() => {
    if (!pattern) return undefined;
    setAnchor(undefined);
    setAnchorError(undefined);
    const timeField = pattern.timeFieldName;
    if (!timeField) {
      setAnchorError('This index pattern has no time field, so its documents have no order to stand next to each other in.');
      return undefined;
    }
    if (!tieBreaker) {
      setAnchorError(
        `No searchable tiebreaker field could be found in the index pattern ${pattern.title}. Please change the advanced setting context:tieBreakerFields to include a valid field for this index pattern.`
      );
      return undefined;
    }
    let live = true;
    services.search
      .search(pattern.title, { ...documentFields(pattern), ...allFields(), ...anchorRequest(id, timeField, tieBreaker) })
      .then((response) => {
        if (!live) return;
        const hit = response.hits.hits[0] as RawHit | undefined;
        if (hit) setAnchor(hit);
        else setAnchorError('Failed to load anchor document.');
      })
      .catch((failure) => live && setAnchorError((failure as Error).message));
    return () => {
      live = false;
    };
  }, [pattern, id, tieBreaker]);

  const newer = useSurrounding('predecessors', anchor, pattern, tieBreaker, predecessorCount, filters);
  const older = useSurrounding('successors', anchor, pattern, tieBreaker, successorCount, filters);
  const rows = useMemo(() => contextRows(newer.rows, anchor, older.rows), [newer.rows, anchor, older.rows]);
  // The page shows the documents once all three have come back the first time, as the original's
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (anchor && newer.status !== 'loading' && older.status !== 'loading') setReady(true);
  }, [anchor, newer.status, older.status]);

  const problem = patternError ?? anchorError;
  if (problem) {
    return (
      <div className="dscDocPage" data-test-subj="discoverAppPage">
        <CallOut tone="critical" title="Failed to load the anchor document">
          {problem}
        </CallOut>
      </div>
    );
  }
  if (!pattern || !anchor || !ready) return <Loading />;
  const timeField = pattern.timeFieldName ?? '';
  return (
    <>
      <div className="shlSearchBar dscContextFilters" data-test-subj="globalQueryBar">
        <FilterBar filters={filters} onChange={setFilters} indexPatterns={[pattern]} />
      </div>
      <div className="dscDocPage" data-test-subj="discoverAppPage">
        <Panel className="dscDocPage__content">
          <div data-test-subj="dscDocsContent">
            <ContextActionBar
              side="predecessors"
              count={predecessorCount}
              available={newer.rows.length}
              step={step}
              disabled={false}
              loading={newer.status === 'loading'}
              onChange={(count) => writeApp({ predecessorCount: count })}
            />
            <div className="dscDocsGrid" data-test-subj="dscDocsGrid">
              <DocTable
                rows={rows}
                indexPattern={pattern}
                columns={columns}
                sort={[[timeField, 'desc']]}
                onFilter={addFilter}
                highlightRow={`${anchor._index}/${anchor._id}`}
                details={(hit, drawn) => (
                  <DocDetails
                    hit={hit}
                    indexPattern={pattern}
                    basePath={basePath}
                    appFilters={ownFilters}
                    actions={{
                      columns: drawn,
                      onToggleColumn: (name) => {
                        if (drawn.includes(name) === columns.includes(name)) writeApp({ columns: toggledColumns(columns, name) });
                      },
                      onFilter: addFilter,
                      onFilterExists: addExists,
                    }}
                  />
                )}
              />
            </div>
            <ContextActionBar
              side="successors"
              count={successorCount}
              available={older.rows.length}
              step={step}
              disabled={false}
              loading={older.status === 'loading'}
              onChange={(count) => writeApp({ successorCount: count })}
            />
          </div>
        </Panel>
      </div>
    </>
  );
}

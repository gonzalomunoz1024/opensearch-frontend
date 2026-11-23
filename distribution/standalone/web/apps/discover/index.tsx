/* SPDX-License-Identifier: Apache-2.0 */

/* Discover: search an index pattern's documents, see when they happened, look into each one. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, EmptyPrompt, Loading, Tabs } from '../../components/basic';
import { Select } from '../../components/form';
import { Icon } from '../../components/icon';
import { CopyableCode, downloadFile, Tooltip } from '../../components/overlay';
import { dateInterval, tabify } from '../../lib/aggs';
import { formatDate, parseInterval, timeZoneOffset } from '../../lib/dates';
import { flattenHit, toCsv, type RawHit } from '../../lib/docs';
import { existsFilter, mergeFilters } from '../../lib/query';
import { parseSearchSource, serializeSearchSource } from '../../lib/search_source';
import type { Field, Filter, IndexPattern, Query } from '../../lib/types';
import { appUrl, decodeState, encodeState } from '../../lib/url';
import { href, navigate, navigateHash, setHashParams, useLocation } from '../../router';
import { services } from '../../services';
import type { IndexPatternSummary } from '../../services/index_patterns';
import type { SavedObject } from '../../services/saved_objects';
import type { SavedQuery } from '../../lib/saved_query';
import { totalOf, type RequestRecord, type SearchResponse } from '../../services/search';
import { TopNav } from '../../shell/chrome';
import { isPinned, splitFilters } from '../../shell/filter_bar';
import { Inspector } from '../../shell/inspect';
import { defaultQueryLanguage } from '../../shell/query_bar';
import { OpenFlyout, SaveModal, ShareModal } from '../../shell/saved_objects_ui';
import { pageFiltersOf, savedQueryGlobalParam, type SavedQueryChange } from '../../shell/saved_query';
import { SearchBar } from '../../shell/search_bar';
import { showSearchError } from '../../shell/search_error';
import { addRecentlyAccessed, currentGlobalParam, useAutoRefresh, useBreadcrumbs, useGlobalState } from '../../shell/state';
import { DocDetails } from './doc_viewer';
import { DocTable, filterColumns, toggledColumns, type SortPair } from './doc_table';
import { DocPage, ContextPage } from './doc_pages';
import { filtersOf, valueFilter } from './filters';
import { Histogram } from './histogram';
import { bucketSpan, parseBucketInterval, shortestBucket } from './histogram_scale';
import { aggContext, buildDiscoverRequest, histogramAgg, searchTimeRange } from './search';
import { Sidebar } from './sidebar';
import { normalizeSort } from './sort';
import '../../styles/discover.css';

interface SavedSearchAttributes {
  title: string;
  description?: string;
  columns?: string[];
  sort?: unknown;
  hits?: number;
  version?: number;
  kibanaSavedObjectMeta?: { searchSourceJSON?: string };
}

interface UrlAppState {
  discover?: { columns?: string[]; sort?: unknown; interval?: string; isDirty?: boolean; savedQuery?: string };
  metadata?: { indexPattern?: string; view?: string };
  // The shape of older addresses
  columns?: string[];
  sort?: unknown;
  interval?: string;
  index?: string;
  query?: Query;
  filters?: Filter[];
  savedQuery?: string;
}

interface UrlQueryState {
  query?: Query;
  filters?: Filter[];
}

const INTERVALS = [
  { value: 'auto', label: 'Auto' },
  { value: 'ms', label: 'Millisecond' },
  { value: 's', label: 'Second' },
  { value: 'm', label: 'Minute' },
  { value: 'h', label: 'Hour' },
  { value: 'd', label: 'Day' },
  { value: 'w', label: 'Week' },
  { value: 'M', label: 'Month' },
  { value: 'y', label: 'Year' },
];

interface Result {
  rows: RawHit[];
  total: number;
  response: SearchResponse;
  range?: { from: Date; to: Date };
}

/**
 * The original's "No Results", for a search that found nothing and one that failed; under it the
 * saved queries of the query's language, each in a box to copy, when there are any
 */
function NoResults({ query }: { query: Query }) {
  const [savedQueries, setSavedQueries] = useState<SavedQuery[]>([]);
  const queryKey = JSON.stringify(query);
  useEffect(() => {
    let live = true;
    services.savedQueries.findSavedQueries('', 1000).then(
      ({ queries }) => live && setSavedQueries(queries.filter((item) => item.attributes.query.language === query.language)),
      () => live && setSavedQueries([])
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey]);
  return (
    <div className="dscNoResults">
      <div data-test-subj="discoverNoResults">
        <EmptyPrompt icon="codeBlock" title="No Results">
          <p data-test-subj="discoverNoResultsTimefilter">
            Try selecting a different data source, expanding your time range or modifying the query &amp; filters.
          </p>
        </EmptyPrompt>
      </div>
      {savedQueries.length > 0 && (
        <div className="dscNoResults__samples" data-test-subj="discoverNoResultsSampleContainer">
          <Tabs tabs={[{ id: 'saved_queries', label: 'Saved Queries' }]} selected="saved_queries" />
          <div className="dscNoResults__queries">
            {savedQueries.map((item) => {
              const value = item.attributes.query.query;
              return (
                <div key={item.id} className="dscNoResults__query">
                  <div className="atlSmall">{item.id}</div>
                  <CopyableCode>{typeof value === 'string' ? value : JSON.stringify(value)}</CopyableCode>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export function Discover({ basePath }: { basePath: string }) {
  const location = useLocation();
  const { hashPath } = location;
  const doc = /^\/doc\/([^/]+)\/([^/]+)/.exec(hashPath);
  const context = /^\/context\/([^/]+)\/(.+)$/.exec(hashPath);
  if (doc) {
    return <DocPage indexPatternId={decodeURIComponent(doc[1])} index={decodeURIComponent(doc[2])} id={location.hashParams.id ?? ''} basePath={basePath} />;
  }
  if (context) {
    return (
      <ContextPage
        key={`${context[1]}/${context[2]}`}
        indexPatternId={decodeURIComponent(context[1])}
        id={decodeURIComponent(context[2])}
        basePath={basePath}
      />
    );
  }
  const savedId = /^\/view\/(.+)$/.exec(hashPath)?.[1];
  return <DiscoverMain basePath={basePath} savedId={savedId ? decodeURIComponent(savedId) : undefined} />;
}

function DiscoverMain({ basePath, savedId }: { basePath: string; savedId?: string }) {
  const location = useLocation();
  const [global, setGlobal] = useGlobalState();
  const [patterns, setPatterns] = useState<IndexPatternSummary[]>();
  const [defaultId, setDefaultId] = useState<string>();
  const [saved, setSaved] = useState<SavedObject<SavedSearchAttributes>>();
  const [savedError, setSavedError] = useState<string>();
  const [indexPattern, setIndexPattern] = useState<IndexPattern>();
  const [patternError, setPatternError] = useState<string>();
  const [result, setResult] = useState<Result>();
  // The search failed: no results, and a "Search Error" message says why, as in the original
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const [records, setRecords] = useState<RequestRecord[]>([]);
  const [dialog, setDialog] = useState<'save' | 'open' | 'share' | 'inspect'>();

  // --- What the address says, over what the saved search says, over the defaults ---
  const urlApp = useMemo(() => decodeState<UrlAppState>(location.hashParams._a), [location.hashParams._a]);
  const urlQuery = useMemo(() => decodeState<UrlQueryState>(location.hashParams._q), [location.hashParams._q]);
  const savedSource = useMemo(
    () => (saved ? parseSearchSource(saved.attributes.kibanaSavedObjectMeta?.searchSourceJSON, saved.references) : undefined),
    [saved]
  );

  const columns = useMemo(() => {
    const fromUrl = urlApp.discover?.columns ?? urlApp.columns;
    const chosen = fromUrl ?? saved?.attributes.columns ?? services.uiSettings.get<string[]>('defaultColumns', ['_source']);
    return chosen.length ? chosen : ['_source'];
  }, [urlApp, saved]);
  const sort = useMemo(
    () => normalizeSort(urlApp.discover?.sort ?? urlApp.sort ?? saved?.attributes.sort),
    [urlApp, saved]
  );
  // None until one is picked: the histogram is then "auto", and its header still says "per"
  const interval = urlApp.discover?.interval ?? urlApp.interval;
  const indexPatternId = urlApp.metadata?.indexPattern ?? urlApp.index ?? savedSource?.indexId ?? defaultId;
  const query: Query = useMemo(
    () => urlQuery.query ?? urlApp.query ?? savedSource?.query ?? { query: '', language: defaultQueryLanguage() },
    [urlQuery, urlApp, savedSource]
  );
  const appFilters: Filter[] = useMemo(
    () => filtersOf(urlQuery.filters ?? urlApp.filters ?? savedSource?.filters ?? []),
    [urlQuery, urlApp, savedSource]
  );
  const filters = useMemo(() => [...global.filters, ...appFilters.filter((filter) => !isPinned(filter))], [global.filters, appFilters]);
  // The saved query loaded into the search bar; an older address keeps it beside the columns
  const savedQueryId = urlApp.discover?.savedQuery ?? urlApp.savedQuery;

  const appParam = useCallback(
    (changes: { columns?: string[]; sort?: SortPair[]; interval?: string; indexPattern?: string; savedQuery?: string }) =>
      encodeState({
        discover: {
          columns: changes.columns ?? columns,
          interval: changes.interval ?? interval,
          isDirty: Boolean(savedId),
          savedQuery: 'savedQuery' in changes ? changes.savedQuery : savedQueryId,
          sort: changes.sort ?? sort,
        },
        metadata: { indexPattern: changes.indexPattern ?? indexPatternId, view: 'discover' },
      }),
    [columns, interval, sort, indexPatternId, savedId, savedQueryId]
  );
  const writeApp = useCallback(
    (changes: { columns?: string[]; sort?: SortPair[]; interval?: string; indexPattern?: string }, replace = false) => {
      setHashParams({ _a: appParam(changes) }, { replace });
    },
    [appParam]
  );
  const onSavedQueryChange = useCallback(
    (change: SavedQueryChange) => {
      setHashParams(
        {
          _g: savedQueryGlobalParam(change),
          _a: appParam({ savedQuery: change.id }),
          _q: encodeState({ filters: pageFiltersOf(change), query: change.query }),
        },
        { replace: change.replace }
      );
    },
    [appParam]
  );
  const writeQuery = useCallback(
    (changes: { query?: Query; filters?: Filter[] }) => {
      setHashParams({ _q: encodeState({ filters: changes.filters ?? appFilters, query: changes.query ?? query }) }, { replace: false });
    },
    [appFilters, query]
  );
  const setFilters = useCallback(
    (next: Filter[]) => {
      const { pinned, app } = splitFilters(next);
      if (JSON.stringify(pinned) !== JSON.stringify(global.filters)) setGlobal({ filters: pinned });
      if (JSON.stringify(app) !== JSON.stringify(appFilters)) writeQuery({ filters: app });
    },
    [global.filters, appFilters, setGlobal, writeQuery]
  );

  // --- What has to be loaded before there is anything to search ---
  useEffect(() => {
    let live = true;
    services.indexPatterns
      .list()
      .then(async (list) => {
        const chosen = await services.indexPatterns.defaultId();
        if (!live) return;
        setPatterns(list);
        setDefaultId(chosen);
      })
      .catch((failure) => live && setPatternError((failure as Error).message));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    setSaved(undefined);
    setSavedError(undefined);
    if (!savedId) return undefined;
    let live = true;
    services.savedObjects
      .get<SavedSearchAttributes>('search', savedId)
      .then((object) => {
        if (!live) return;
        setSaved(object);
        addRecentlyAccessed(appUrl(basePath, `/view/${encodeURIComponent(savedId)}`), object.attributes.title, savedId);
      })
      .catch((failure) => live && setSavedError((failure as Error).message));
    return () => {
      live = false;
    };
  }, [savedId, basePath]);

  const waitingForSaved = Boolean(savedId) && !saved && !savedError;
  useEffect(() => {
    if (!indexPatternId || waitingForSaved) return undefined;
    let live = true;
    setPatternError(undefined);
    services.indexPatterns
      .get(indexPatternId)
      .then((pattern) => live && setIndexPattern(pattern))
      .catch((failure) => {
        if (!live) return;
        setIndexPattern(undefined);
        setPatternError(`The index pattern ${indexPatternId} could not be loaded: ${(failure as Error).message}`);
      });
    return () => {
      live = false;
    };
  }, [indexPatternId, waitingForSaved]);

  useBreadcrumbs(
    saved ? [{ text: 'Discover', to: appUrl(basePath, '/', { _g: currentGlobalParam() }) }, { text: saved.attributes.title }] : [{ text: 'Discover' }]
  );

  // --- The search ---
  const sampleSize = services.uiSettings.get<number>('discover:sampleSize', 500);
  const queryKey = JSON.stringify([query, filters, sort, interval]);
  // With discover:searchOnPageLoad off the page waits, as the original's, until it is asked for a
  // search: a query, filters, a time range, a refresh. A saved search or a running refresh
  // interval searches at once.
  const [searchStarted, setSearchStarted] = useState(
    () => services.uiSettings.get<boolean>('discover:searchOnPageLoad', true) || Boolean(savedId) || !global.refreshInterval.pause
  );
  const startKey = JSON.stringify([queryKey, global.time.from, global.time.to, tick]);
  const firstStartKey = useRef(startKey);
  useEffect(() => {
    if (!searchStarted && startKey !== firstStartKey.current) setSearchStarted(true);
  }, [startKey, searchStarted]);
  useEffect(() => {
    if (!searchStarted || !indexPattern || indexPattern.id !== indexPatternId) return undefined;
    const controller = new AbortController();
    const range = searchTimeRange(indexPattern, global.time, services.weekStart());
    if (range === null) {
      // A time range that cannot be read: the original's Discover searches nothing and says so,
      // where a search without it would run over all the documents there are
      setFailed(true);
      setLoading(false);
      services.toasts.danger(
        'Invalid time range',
        `The provided time range is invalid. (from: '${global.time.from}', to: '${global.time.to}')`
      );
      return undefined;
    }
    let body: Record<string, unknown>;
    try {
      body = buildDiscoverRequest({ indexPattern, query, filters, range, sort, size: sampleSize, interval });
    } catch (failure) {
      // A query that cannot be read: the original's search fails before it is sent
      setFailed(true);
      setLoading(false);
      showSearchError(failure);
      return undefined;
    }
    const record: RequestRecord = { name: 'data', index: indexPattern.title, indexPatternId: indexPattern.id, description: 'This request queries OpenSearch to fetch the data for the search.', body, startedAt: Date.now() };
    setLoading(true);
    services.search
      .search(indexPattern.title, body, { signal: controller.signal, record })
      .then((response) => {
        setResult({ rows: response.hits.hits as RawHit[], total: totalOf(response), response, range });
        setFailed(false);
        setRecords([record]);
        setLoading(false);
      })
      .catch((failure) => {
        if ((failure as Error).name === 'AbortError') return;
        setFailed(true);
        setRecords([record]);
        setLoading(false);
        showSearchError(failure);
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchStarted, indexPattern, indexPatternId, queryKey, global.time.from, global.time.to, sampleSize, tick]);

  const refresh = useCallback(() => setTick((count) => count + 1), []);
  useAutoRefresh(global.refreshInterval, refresh);

  // --- What the page does ---
  const toggleColumn = useCallback(
    (name: string) => {
      const next = toggledColumns(columns, name);
      writeApp({ columns: next, sort: sort.filter(([field]) => next.includes(field) || field === indexPattern?.timeFieldName) });
    },
    [columns, sort, writeApp, indexPattern]
  );
  const moveColumn = useCallback(
    (name: string, by: number) => {
      const from = columns.indexOf(name);
      const to = from + by;
      if (from === -1 || to < 0 || to >= columns.length) return;
      const next = [...columns];
      next.splice(from, 1);
      next.splice(to, 0, name);
      writeApp({ columns: next });
    },
    [columns, writeApp]
  );
  const addFilter = useCallback(
    (name: string, value: unknown, negate: boolean) => {
      if (!indexPattern) return;
      const values = Array.isArray(value) ? value : [value];
      // The field itself, so that a filter on a scripted field carries its script
      const field = indexPattern.fields.find((candidate) => candidate.name === name) ?? { name };
      const pinned = services.uiSettings.get('filters:pinnedByDefault', false);
      setFilters(mergeFilters(filters, values.map((item) => valueFilter(field, item, negate, indexPattern.id, pinned))));
    },
    [indexPattern, filters, setFilters]
  );
  const addExists = useCallback(
    (name: string) => {
      if (!indexPattern) return;
      const field = indexPattern.fields.find((candidate) => candidate.name === name) ?? { name };
      setFilters(mergeFilters(filters, [existsFilter(field, indexPattern.id)]));
    },
    [indexPattern, filters, setFilters]
  );
  const visualize = useCallback(
    (field: Field) => {
      if (!indexPattern) return;
      const isDate = field.type === 'date';
      const visState = {
        title: '',
        type: 'histogram',
        params: {},
        aggs: [
          { id: '1', type: 'count', schema: 'metric', params: {} },
          isDate
            ? { id: '2', type: 'date_histogram', schema: 'segment', params: { field: field.name, interval: 'auto' } }
            : { id: '2', type: 'terms', schema: 'segment', params: { field: field.name, size: services.uiSettings.get('discover:aggs:terms:size', 20), orderBy: '1', order: 'desc' } },
        ],
      };
      navigate(
        appUrl('/app/visualize', '/create', {
          type: 'histogram',
          indexPattern: indexPattern.id,
          _g: currentGlobalParam(),
          _a: { filters: appFilters, query, vis: visState },
        })
      );
    },
    [indexPattern, appFilters, query]
  );

  // The columns the table shows, as the original's filterColumns leaves them: the names the
  // pattern has and those the documents found hold
  const shownColumns = useMemo(() => {
    if (!indexPattern) return columns;
    const names = new Set(indexPattern.fields.map((field) => field.name));
    for (const row of result?.rows ?? []) for (const name of Object.keys(flattenHit(row, indexPattern))) names.add(name);
    return filterColumns(
      columns,
      names,
      services.uiSettings.get<string[]>('defaultColumns', ['_source']),
      services.uiSettings.get<boolean>('discover:modifyColumnsOnSwitch', true)
    );
  }, [columns, indexPattern, result]);

  const details = useCallback(
    (hit: RawHit, drawn: string[]) => (
      <DocDetails
        hit={hit}
        indexPattern={indexPattern as IndexPattern}
        basePath={basePath}
        appFilters={filters.filter((filter) => !isPinned(filter))}
        actions={{
          columns: drawn,
          // As the original's: a column drawn is taken out, another added; the time column the
          // table adds of itself is no chosen column, so taking it out does nothing
          onToggleColumn: (name) => {
            if (drawn.includes(name) === columns.includes(name)) toggleColumn(name);
          },
          onFilter: addFilter,
          onFilterExists: addExists,
        }}
      />
    ),
    [indexPattern, basePath, filters, columns, toggleColumn, addFilter, addExists]
  );

  // The zone the chart is drawn in: the setting dateFormat:tz, or the browser's own
  const offsetAt = useCallback((time: number) => timeZoneOffset(time, services.timeZone()), []);
  const histogram = useMemo(() => {
    if (!result || !indexPattern?.timeFieldName || !result.range) return undefined;
    const agg = histogramAgg(indexPattern, interval);
    if (!agg) return undefined;
    const aggContextValue = aggContext(indexPattern, result.range);
    const table = tabify([agg, { id: '1', type: 'count', schema: 'metric' }], result.response, aggContextValue);
    const [bucketColumn, countColumn] = table.columns;
    if (!bucketColumn || !countColumn) return undefined;
    const bucketInterval = dateInterval(agg, aggContextValue);
    const points = table.rows.map((row) => ({ x: row[bucketColumn.id] as number, y: row[countColumn.id] as number }));
    const unit = parseBucketInterval(bucketInterval.expression);
    const minInterval = shortestBucket(
      points.map((point) => point.x),
      (time) => (unit ? bucketSpan(time, unit, offsetAt, services.weekStart()) : bucketInterval.ms)
    );
    // An interval asked for that would give too many bars is widened, and the header says so
    const asked = interval && interval !== 'auto' ? parseInterval(INTERVALS.some((item) => item.value === interval) ? `1${interval}` : interval) : undefined;
    return {
      interval: bucketInterval,
      scale: asked ? asked.ms / bucketInterval.ms : 1,
      column: bucketColumn,
      points,
      minInterval,
    };
  }, [result, indexPattern, interval, offsetAt]);
  const formatBucket = useCallback((value: number) => (histogram ? histogram.column.format(value) : String(value)), [histogram]);
  const narrowTime = useCallback(
    (from: number, to: number) => setGlobal({ time: { from: new Date(from).toISOString(), to: new Date(to).toISOString() } }),
    [setGlobal]
  );
  // The pane that scrolls: the table's "Back to top." goes back to its start
  const canvasRef = useRef<HTMLDivElement>(null);

  const downloadCsv = () => {
    if (!result || !indexPattern) return;
    const names =
      columns.length === 1 && columns[0] === '_source'
        ? [...new Set(result.rows.flatMap((row) => Object.keys(flattenHit(row, indexPattern))))].sort()
        : [...(indexPattern.timeFieldName && !columns.includes(indexPattern.timeFieldName) ? [indexPattern.timeFieldName] : []), ...columns];
    const csv = toCsv(
      names,
      result.rows.map((row) => {
        const flat = flattenHit(row, indexPattern);
        return names.map((name) => flat[name]);
      }),
      services.uiSettings.get('csv:separator', ','),
      services.uiSettings.get('csv:quoteValues', true)
    );
    downloadFile(`${saved?.attributes.title ?? 'discover'}.csv`, csv, 'text/csv');
  };

  const save = async ({ title, asNew }: { title: string; asNew: boolean }) => {
    if (!indexPattern) return;
    const source = serializeSearchSource(
      { indexId: indexPattern.id, query, filters: appFilters },
      { highlightAll: true, version: true }
    );
    const attributes: SavedSearchAttributes = {
      title,
      description: saved?.attributes.description ?? '',
      hits: 0,
      columns,
      sort,
      version: 1,
      kibanaSavedObjectMeta: { searchSourceJSON: source.searchSourceJSON },
    };
    const object =
      saved && !asNew
        ? await services.savedObjects.update('search', saved.id, attributes, { references: source.references })
        : await services.savedObjects.create('search', attributes, { references: source.references });
    services.toasts.success(`Search “${title}” was saved`);
    setDialog(undefined);
    setSaved({ ...object, attributes, references: source.references });
    navigateHash(`/view/${encodeURIComponent(object.id)}`, { _g: location.hashParams._g });
  };

  // --- What is drawn ---
  if (patternError && !indexPattern) {
    return (
      <div className="shlPage">
        <EmptyPrompt icon="warning" title="Discover could not start">
          {patternError}
        </EmptyPrompt>
      </div>
    );
  }
  if (savedError) {
    return (
      <div className="shlPage">
        <EmptyPrompt
          icon="warning"
          title="The saved search could not be loaded"
          actions={
            <Button variant="primary" to={appUrl(basePath, '/')}>
              Start a new search
            </Button>
          }
        >
          {savedError}
        </EmptyPrompt>
      </div>
    );
  }
  if (patterns && patterns.length === 0) {
    return (
      <div className="shlPage">
        <EmptyPrompt
          icon="index"
          title="There is no index pattern yet"
          actions={
            <Button variant="primary" to="/app/management/opensearch-dashboards/indexPatterns/create">
              Create an index pattern
            </Button>
          }
        >
          An index pattern says which indices to search. Create one to see their documents here.
        </EmptyPrompt>
      </div>
    );
  }
  if (!indexPattern || !patterns) return <Loading />;

  const dateFormat = services.uiSettings.get<string>('dateFormat', 'MMM D, YYYY @ HH:mm:ss.SSS');
  const total = failed ? 0 : result?.total ?? 0;
  const rows = failed ? [] : result?.rows ?? [];

  return (
    <div className="dscPage" data-test-subj="discoverApp">
      <TopNav
        items={[
          { id: 'new', label: 'New', to: appUrl(basePath, '/', { _g: currentGlobalParam() }), testId: 'discoverNewButton' },
          { id: 'save', label: 'Save', onClick: () => setDialog('save'), testId: 'discoverSaveButton' },
          { id: 'open', label: 'Open', onClick: () => setDialog('open'), testId: 'discoverOpenButton' },
          { id: 'share', label: 'Share', onClick: () => setDialog('share'), testId: 'shareTopNavButton' },
          { id: 'inspect', label: 'Inspect', onClick: () => setDialog('inspect'), testId: 'openInspectorButton' },
        ]}
      />
      <Sidebar
        indexPattern={indexPattern}
        indexPatterns={patterns}
        onIndexPatternChange={(id) => {
          setResult(undefined);
          setHashParams({
            _a: encodeState({
              discover: { columns: ['_source'], interval, isDirty: false, savedQuery: savedQueryId, sort: [] },
              metadata: { indexPattern: id, view: 'discover' },
            }),
            _q: encodeState({ filters: [], query }),
          });
        }}
        onRefreshFields={() => {
          services.indexPatterns
            .fetchFields(indexPattern.title)
            .then((fields) => {
              // What was counted and scripted stays; what OpenSearch says about the rest is new
              const kept = new Map(indexPattern.fields.map((field) => [field.name, field]));
              const merged = fields.map((field) => ({ ...field, count: kept.get(field.name)?.count ?? 0 }));
              for (const field of indexPattern.fields) if (field.scripted) merged.push({ ...field, count: field.count ?? 0 });
              setIndexPattern({ ...indexPattern, fields: merged });
              services.toasts.success('The field list was refreshed');
            })
            .catch((failure) => services.toasts.error(failure, 'The fields could not be read'));
        }}
        columns={columns}
        rows={rows}
        onToggleColumn={toggleColumn}
        onFilter={addFilter}
        onFilterExists={addExists}
        onVisualize={visualize}
      />
      <div ref={canvasRef} className="dscCanvas" data-test-subj="dscCanvas">
        {loading && <div className="atlProgress" />}
        <SearchBar
          indexPatterns={[indexPattern]}
          query={query}
          onQuerySubmit={(next) => writeQuery({ query: next })}
          filters={filters}
          onFiltersChange={setFilters}
          time={global.time}
          refreshInterval={global.refreshInterval}
          onTimeChange={(time) => setGlobal({ time })}
          onRefreshChange={(refreshInterval) => setGlobal({ refreshInterval })}
          onRefresh={refresh}
          loading={loading}
          showTime={Boolean(indexPattern.timeFieldName)}
          savedQueryId={savedQueryId}
          onSavedQueryChange={onSavedQueryChange}
        />
        {!searchStarted ? (
          <div className="dscUninitialized">
            <EmptyPrompt
              icon="discover"
              title="Start searching"
              actions={
                <Button variant="primary" size="s" onClick={() => setSearchStarted(true)} testId="discover-refreshDataButton">
                  Refresh data
                </Button>
              }
            >
              <p>Write a query, add some filters, or simply hit Refresh to retrieve results for the current query.</p>
            </EmptyPrompt>
          </div>
        ) : failed || (result && total === 0) ? (
          <NoResults query={query} />
        ) : !result ? (
          <Loading>Searching</Loading>
        ) : (
          <div className="dscCanvas__results" data-test-subj="dscCanvasResults">
            {histogram && result.range && (
              <div className="dscChart" data-test-subj="dscChartWrapper">
                <div className="dscChart__header" data-test-subj="dscChartTimechartHeader">
                  <Tooltip content="To change the time, use the global time filter above">
                    <div className="dscChart__range" data-test-subj="discoverIntervalDateRange">
                      {`${formatDate(result.range.from, dateFormat, services.timeZone())} - ${formatDate(
                        result.range.to,
                        dateFormat,
                        services.timeZone()
                      )} ${interval !== 'auto' ? 'per' : ''}`}
                    </div>
                  </Tooltip>
                  <div className="dscChart__interval">
                    <Select
                      className="dscChart__select"
                      value={interval && INTERVALS.some((item) => item.value === interval) ? interval : 'auto'}
                      onChange={(next) => writeApp({ interval: next })}
                      options={INTERVALS}
                      aria-label="Time interval"
                      testId="discoverIntervalSelect"
                    />
                    {histogram.interval.scaled && (
                      <Tooltip
                        content={`This interval creates ${
                          histogram.scale > 1 ? 'buckets that are too large' : 'too many buckets'
                        } to show in the selected time range, so it has been scaled to ${histogram.interval.description}.`}
                        testId="discoverIntervalIconTip"
                      >
                        <span className="dscChart__scaled" tabIndex={0}>
                          <Icon name="warning" />
                        </span>
                      </Tooltip>
                    )}
                  </div>
                </div>
                <section className="dscTimechart" data-test-subj="dscTimechart">
                  <div className="dscHistogram" data-test-subj="discoverChart">
                    <Histogram
                      points={histogram.points}
                      from={result.range.from.getTime()}
                      to={result.range.to.getTime()}
                      intervalMs={histogram.interval.ms}
                      minInterval={histogram.minInterval}
                      offsetAt={offsetAt}
                      formatX={formatBucket}
                      xTitle={`${indexPattern.timeFieldName} per ${histogram.interval.description}`}
                      yTitle="Count"
                      onTimeChange={narrowTime}
                    />
                  </div>
                </section>
              </div>
            )}
            <div className="dscResultsBar" data-test-subj="dscResultsActionBar">
              <div className="dscResultsBar__actions">
                <div className="dscResultsBar__count" data-test-subj="dscResultCount">
                  <strong>
                    {rows.length === 1 ? 'Result' : 'Results'} (
                    <span data-test-subj="discoverQueryRowsCount" aria-label={`${rows.length} ${rows.length === 1 ? 'row' : 'rows'} shown`}>
                      {rows.length.toLocaleString()}
                    </span>
                    {total ? (
                      <>
                        /
                        <span data-test-subj="discoverQueryHits" aria-label={`${total} ${total === 1 ? 'hit' : 'hits'}`}>
                          {total.toLocaleString()}
                        </span>
                      </>
                    ) : null}
                    )
                  </strong>
                  {saved && (
                    <button
                      type="button"
                      className="dscResults__button"
                      aria-label="Reset search"
                      data-test-subj="resetSavedSearch"
                      onClick={() => navigate(appUrl(basePath, `/view/${encodeURIComponent(saved.id)}`, { _g: currentGlobalParam() }))}
                    >
                      <Icon name="refresh" />
                      Reset search
                    </button>
                  )}
                </div>
                {rows.length > 0 && (
                  <button type="button" className="dscResults__button" data-test-subj="dscDownloadCsvButton" onClick={downloadCsv}>
                    <Icon name="download" />
                    Download as CSV
                  </button>
                )}
              </div>
            </div>
            <DocTable
              rows={rows}
              indexPattern={indexPattern}
              columns={shownColumns}
              sort={sort}
              onSort={(next) => writeApp({ sort: next })}
              onRemoveColumn={(name) => {
                // A default column the table adds of itself is no chosen column: the original
                // leaves the columns as they are
                if (columns.includes(name)) toggleColumn(name);
              }}
              onMoveColumn={moveColumn}
              onFilter={addFilter}
              details={details}
              onBackToTop={() => {
                if (canvasRef.current) canvasRef.current.scrollTop = 0;
              }}
            />
          </div>
        )}
      </div>
      {dialog === 'save' && (
        <SaveModal
          objectType="search"
          intro="Save your Discover search so you can use it in visualizations and dashboards"
          title={saved?.attributes.title ?? ''}
          existing={Boolean(saved)}
          onSave={save}
          onClose={() => setDialog(undefined)}
        />
      )}
      {dialog === 'open' && (
        <OpenFlyout
          title="Open search"
          types={[{ type: 'search', name: 'Saved search', icon: 'discover' }]}
          manageLink="/app/management/opensearch-dashboards/objects"
          onClose={() => setDialog(undefined)}
          onChoose={(object) => {
            setDialog(undefined);
            navigate(appUrl(basePath, `/view/${encodeURIComponent(object.id)}`, { _g: currentGlobalParam() }));
          }}
        />
      )}
      {dialog === 'share' && (
        <ShareModal
          objectType="search"
          savedUrl={saved ? `${window.location.origin}${href(appUrl(basePath, `/view/${encodeURIComponent(saved.id)}`))}` : undefined}
          onClose={() => setDialog(undefined)}
        />
      )}
      {dialog === 'inspect' && (
        <Inspector title={saved?.attributes.title} requests={records} onClose={() => setDialog(undefined)} />
      )}
    </div>
  );
}


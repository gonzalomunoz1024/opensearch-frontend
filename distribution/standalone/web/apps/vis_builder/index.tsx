/* SPDX-License-Identifier: Apache-2.0 */

/*
 * VisBuilder, as OpenSearch Dashboards has it: a visualization made by dragging the fields of an
 * index pattern onto the parts of a chart. It opens new at /app/vis-builder/ and saved at
 * /app/vis-builder/edit/<id>. What is on screen is in the address, as there: the visualization
 * in `_a=(metadata,style,ui,visualization)`, the query and the page's filters in `_q`, the time
 * in `_g`, so that a link shows what its sender saw.
 */

import '../../styles/vis_builder.css';
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { Spinner, cx } from '../../components/basic';
import { SearchField, Switch } from '../../components/form';
import { Icon } from '../../components/icon';
import { Popover, Tooltip } from '../../components/overlay';
import { resolveTimeRange, type TimeRange } from '../../lib/dates';
import type { RawHit } from '../../lib/docs';
import { buildQuery, mergeFilters, sameFilter, timeRangeFilter } from '../../lib/query';
import type { Filter, IndexPattern, Query } from '../../lib/types';
import { appUrl, buildHash, encodeState } from '../../lib/url';
import { getLocation, lastAddressOf, navigate, setHashParams, useLocation, useUrlState } from '../../router';
import { services } from '../../services';
import { HttpFetchError, errorMessage } from '../../services/http';
import { patternName } from '../../services/index_patterns';
import { TopNav, type TopNavItem } from '../../shell/chrome';
import { splitFilters } from '../../shell/filter_bar';
import { defaultQueryLanguage } from '../../shell/query_bar';
import { pageFiltersOf, savedQueryGlobalParam, type SavedQueryChange } from '../../shell/saved_query';
import { SaveModal, type SaveResult } from '../../shell/saved_objects_ui';
import { SearchBar } from '../../shell/search_bar';
import { addRecentlyAccessed, currentGlobalParam, useAutoRefresh, useBreadcrumbs, useGlobalState } from '../../shell/state';
import { visContext, type VisInput } from '../../vis/request';
import { documentFields, sortClause } from '../discover/search';
import { incomingEditorState } from '../visualize/state_transfer';
import { returnSwitch } from '../visualize/top_nav';
import { DataTab } from './data_tab';
import {
  afterChange,
  newAppState,
  openedState,
  originatingAppOf,
  readAppState,
  saveDisabledReason,
  urlAppState,
  withIndexPattern,
  withStatus,
  type AppState,
} from './editor_state';
import {
  VIS_BUILDER_APP,
  VIS_BUILDER_TYPE,
  visBuilderEditUrl,
  visBuilderFromSavedObject,
  visBuilderToSavedObject,
  type SavedVisBuilder,
  type VisBuilderAttributes,
} from './model';
import { StylePanel } from './style_panel';
import { Workspace } from './workspace';

interface QueryState {
  filters: Filter[];
  query: Query;
}

const EDIT_PATH = /^\/app\/vis-builder\/edit\/([^/]+)/;

// The right of the page takes a fifth of what the fields leave, and keeps room for the chart
const RIGHT_SHARE = 20;
const RIGHT_MIN = 250;
const WORKSPACE_MIN = 300;

export function VisBuilder() {
  const { pathname } = useLocation();
  const match = EDIT_PATH.exec(pathname);
  return <VisBuilderPage savedId={match ? decodeURIComponent(match[1]) : undefined} />;
}

/** Writes the page's state to the address in place: each change replaces the last, as there */
function writeApp(state: AppState) {
  const encoded = encodeState(urlAppState(state));
  if (encoded !== getLocation().hashParams._a) setHashParams({ _a: encoded }, { replace: true });
}

const readApp = () => readAppState(getLocation().hashParams._a);

function VisBuilderPage({ savedId }: { savedId?: string }) {
  const location = useLocation();
  const [global, setGlobal] = useGlobalState();
  const queryDefaults = useMemo<QueryState>(() => ({ filters: [], query: { query: '', language: defaultQueryLanguage() } }), []);
  const [queryState, setQueryState] = useUrlState<QueryState>('_q', queryDefaults);
  const [saved, setSaved] = useState<SavedVisBuilder>();
  // The pinned filters when a saved visualization is opened: those it was saved with stay pinned
  const pinnedFilters = useRef(global.filters);
  pinnedFilters.current = global.filters;
  // The saved object the page has opened; null while it opens one
  const [opened, setOpened] = useState<string | null | undefined>(null);
  const [saving, setSaving] = useState(false);
  const [tick, setTick] = useState(0);
  // Whether the save dialog goes back to the application that opened the page
  const [returnToOrigin, setReturnToOrigin] = useState(false);

  const app = useMemo(() => readAppState(location.hashParams._a), [location.hashParams._a]);

  const update = useCallback((change: (state: AppState) => AppState) => {
    const current = readApp();
    if (current) writeApp(afterChange(current, change(current)));
  }, []);

  // --- Opening: a new visualization, or a saved one --------------------------------------------
  useEffect(() => {
    let live = true;
    setOpened(null);
    const open = async () => {
      // The query and the filters are in the address from the start
      if (getLocation().hashParams._q === undefined) setQueryState({}, { replace: true });
      if (!savedId) {
        // A page just arrived at keeps the application it was sent from, as there; a state in the
        // address says so itself
        const state = readApp() ?? newAppState(await services.indexPatterns.defaultId().catch(() => undefined), incomingEditorState()?.originatingApp);
        if (!live) return;
        setSaved(undefined);
        writeApp(withStatus(state, 'clean'));
        setOpened(undefined);
        return;
      }
      try {
        const loaded = visBuilderFromSavedObject(await services.savedObjects.get<VisBuilderAttributes>(VIS_BUILDER_TYPE, savedId));
        if (!live) return;
        setSaved(loaded);
        writeApp(openedState(readApp(), loaded, incomingEditorState()?.originatingApp));
        // What it was saved with becomes the page's query and filters, but for those pinned already
        const pinned = pinnedFilters.current;
        setQueryState(
          {
            filters: loaded.source.filters
              .filter((filter) => !pinned.some((other) => sameFilter(other, filter)))
              .map((filter) => ({ ...filter, $state: { store: 'appState' as const } })),
            query: loaded.source.query ?? { query: '', language: defaultQueryLanguage() },
          },
          { replace: true }
        );
        addRecentlyAccessed(visBuilderEditUrl(savedId), loaded.title, savedId);
        setOpened(savedId);
      } catch (failure) {
        if (!live) return;
        if (failure instanceof HttpFetchError && failure.status === 404) {
          const message = `Could not locate that ${VIS_BUILDER_TYPE} (id: ${savedId})`;
          services.toasts.warning('Saved object is missing', message);
          const hash = buildHash('/', { _g: currentGlobalParam() });
          const search = `?notFound=${VIS_BUILDER_TYPE}&notFoundMessage=${encodeURIComponent(message).replace(/%3A/g, ':')}`;
          navigate(`${VIS_BUILDER_APP}${search}${hash}`, { replace: true, force: true });
          return;
        }
        services.toasts.danger('Failed to load the visualization', errorMessage(failure));
        if (!readApp()) writeApp(withStatus(newAppState(await services.indexPatterns.defaultId().catch(() => undefined)), 'loading'));
        setOpened(savedId);
      }
    };
    void open();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedId]);

  // --- The index pattern ------------------------------------------------------------------------
  const indexId = app?.visualization.indexPattern;
  const [loadedPattern, setLoadedPattern] = useState<IndexPattern>();
  const ready = opened !== null;
  useEffect(() => {
    if (!ready) return undefined;
    let live = true;
    const load = async () => {
      if (indexId) {
        try {
          const pattern = await services.indexPatterns.get(indexId);
          if (live) setLoadedPattern(pattern);
          return;
        } catch {
          // An index pattern that is gone is replaced by the first there is, as there
        }
      }
      const first = (await findIndexPatterns().catch(() => []))[0];
      if (live && first && first.id !== indexId) update((current) => withIndexPattern(current, first.id));
    };
    void load();
    return () => {
      live = false;
    };
  }, [indexId, ready, update]);
  const indexPattern = loadedPattern && loadedPattern.id === indexId ? loadedPattern : undefined;

  // --- The query, the filters and the time ------------------------------------------------------
  const query = queryState.query;
  const appFilters = queryState.filters;
  const filters = useMemo(() => [...global.filters, ...appFilters], [global.filters, appFilters]);
  const markDirty = useCallback(() => update((current) => withStatus(current, 'dirty')), [update]);

  const setFilters = useCallback(
    (next: Filter[]) => {
      const { pinned, app: own } = splitFilters(next);
      let changed = false;
      if (JSON.stringify(pinned) !== JSON.stringify(global.filters)) {
        setGlobal({ filters: pinned });
        changed = true;
      }
      if (JSON.stringify(own) !== JSON.stringify(appFilters)) {
        setQueryState({ filters: own });
        changed = true;
      }
      // A change of the filters is a change to the visualization, as there
      if (changed) markDirty();
    },
    [global.filters, appFilters, setGlobal, setQueryState, markDirty]
  );
  const addFilters = useCallback(
    (added: Filter[]) => {
      const pinnedByDefault = services.uiSettings.get('filters:pinnedByDefault', false);
      setFilters(mergeFilters(filters, pinnedByDefault ? added.map((filter) => ({ ...filter, $state: { store: 'globalState' as const } })) : added));
    },
    [filters, setFilters]
  );
  const submitQuery = useCallback(
    (next: Query) => {
      if (JSON.stringify(next) === JSON.stringify(query)) return;
      setQueryState({ query: next });
      markDirty();
    },
    [query, setQueryState, markDirty]
  );
  // A saved query loaded, saved or cleared: its query and filters become the page's, and the page
  // keeps its id with the visualization, as there (the id is not saved with the object)
  const onSavedQueryChange = useCallback((change: SavedQueryChange) => {
    const current = readApp();
    if (!current) return;
    const { savedQuery: _previous, ...visualization } = current.visualization;
    const next = withStatus({ ...current, visualization: change.id ? { ...visualization, savedQuery: change.id } : visualization }, 'dirty');
    setHashParams(
      {
        _g: savedQueryGlobalParam(change),
        _q: encodeState({ filters: pageFiltersOf(change), query: change.query }),
        _a: encodeState(urlAppState(next)),
      },
      { replace: change.replace ?? true }
    );
  }, []);
  const setTime = useCallback((time: TimeRange) => setGlobal({ time }), [setGlobal]);
  const refresh = useCallback(() => setTick((count) => count + 1), []);
  useAutoRefresh(global.refreshInterval, refresh);

  const context = useMemo(() => (indexPattern ? visContext(indexPattern, global.time) : {}), [indexPattern, global.time]);
  const input = useMemo<VisInput>(() => ({ time: global.time, query, filters }), [global.time, query, filters]);
  const hits = useSampleHits(indexPattern, query, filters, global.time);

  // --- The title, the breadcrumbs, saving -------------------------------------------------------
  const title = saved?.title ?? '';
  useBreadcrumbs([{ text: 'Visualize', to: appUrl('/app/visualize', '/') }, { text: savedId ? title : 'Create' }]);
  // The tab is named after the visualization once it is saved, and after the product before
  useEffect(() => {
    document.title = savedId && title ? `${title} - ${services.boot.name}` : services.boot.name;
  }, [savedId, title]);

  const reason = app ? saveDisabledReason(app) : 'The canvas is empty. Add some aggregations before saving.';
  // The application a panel was sent from: a dashboard, to go back to once it is saved
  const originatingApp = app ? originatingAppOf(app) : undefined;

  const save = async ({ title: newTitle, description, asNew, returnToOrigin: returning }: SaveResult & { returnToOrigin?: boolean }) => {
    const current = readApp();
    if (!current) return;
    const { attributes, references } = visBuilderToSavedObject(
      { title: newTitle, description, state: current },
      { query, filters: [...global.filters, ...appFilters] }
    );
    try {
      const stored = await services.savedObjects.create<VisBuilderAttributes>(VIS_BUILDER_TYPE, attributes, {
        id: savedId && !asNew ? savedId : undefined,
        overwrite: true,
        references,
      });
      services.toasts.success(`Saved '${newTitle}'`);
      if (originatingApp && returning) {
        // Back where it came from, as the original's `navigateToApp(originatingApp)`: where the
        // dashboards were last, with the time range of now. What is new, or a copy, is handed over
        // to become a panel there; what was saved over itself is drawn again by the panel it has.
        const back = lastAddressOf(originatingApp);
        const newlyCreated = !savedId || asNew;
        navigate(back, { force: true, state: newlyCreated ? { type: VIS_BUILDER_TYPE, input: { savedObjectId: stored.id } } : undefined });
        return;
      }
      setSaving(false);
      setSaved(visBuilderFromSavedObject(stored));
      writeApp({ ...current, metadata: { editor: { state: 'clean' }, isMigrated: false } });
      if (stored.id !== savedId) {
        const { hashPath, hashParams } = getLocation();
        navigate(`${visBuilderEditUrl(stored.id)}${buildHash(hashPath, hashParams)}`, { force: true });
      }
    } catch (failure) {
      services.toasts.danger(`Error on saving '${newTitle}'`, errorMessage(failure));
      setSaving(false);
    }
  };

  // --- The width of the right ------------------------------------------------------------------
  const area = useRef<HTMLDivElement>(null);
  const [rightShare, setRightShare] = useState(RIGHT_SHARE);
  const clampShare = (right: number, width: number) => (Math.min(Math.max(right, RIGHT_MIN), Math.max(RIGHT_MIN, width - WORKSPACE_MIN)) / width) * 100;
  const startResize = (event: PointerEvent<HTMLButtonElement>) => {
    const box = area.current?.getBoundingClientRect();
    if (!box) return;
    event.preventDefault();
    const move = (moved: globalThis.PointerEvent) => setRightShare(clampShare(box.right - moved.clientX, box.width));
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  };
  const resizeByKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const width = area.current?.getBoundingClientRect().width;
    if (!width || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
    event.preventDefault();
    const step = event.key === 'ArrowLeft' ? 1 : -1;
    setRightShare((share) => clampShare(((share + step) / 100) * width, width));
  };

  if (!app || !ready) {
    return (
      <div className="vbdPage vbdPage--loading">
        <Spinner size="l" />
      </div>
    );
  }

  // As the original's: once saved and opened from another application, saving is "Save as" and
  // beside it "Save and return" saves over it and goes back; both say why they cannot be pressed
  const fromOrigin = Boolean(savedId && originatingApp);
  const returns = Boolean(originatingApp) && returnToOrigin;
  const withReason = (button: ReactNode) => (reason ? <Tooltip content={reason} position="bottom">{button}</Tooltip> : button);
  const navItems: TopNavItem[] = [
    {
      id: 'save',
      label: fromOrigin ? 'Save as' : 'Save',
      icon: fromOrigin ? undefined : 'save',
      emphasize: !savedId,
      disabled: Boolean(reason),
      onClick: () => {
        // Going back is what the dialog offers first, as the original's
        setReturnToOrigin(Boolean(originatingApp));
        setSaving(true);
      },
      testId: 'visBuilderSaveButton',
      wrap: withReason,
    },
  ];
  if (fromOrigin) {
    navItems.push({
      id: 'saveAndReturn',
      label: 'Save and return',
      icon: 'checkInCircleFilled',
      emphasize: true,
      disabled: Boolean(reason),
      onClick: () => void save({ title, description: saved?.description ?? '', asNew: false, returnToOrigin: true }),
      testId: 'visBuilderSaveAndReturnButton',
      wrap: withReason,
    });
  }

  return (
    <div className="vbdPage" data-test-subj="visBuilderPage">
      <TopNav items={navItems} />
      <div className="vbdTop">
        <SearchBar
          indexPatterns={indexPattern ? [indexPattern] : []}
          query={query}
          onQuerySubmit={submitQuery}
          filters={filters}
          onFiltersChange={setFilters}
          time={global.time}
          refreshInterval={global.refreshInterval}
          onTimeChange={setTime}
          onRefreshChange={(refreshInterval) => setGlobal({ refreshInterval })}
          onRefresh={refresh}
          showTime={Boolean(indexPattern?.timeFieldName)}
          savedQueryId={app.visualization.savedQuery}
          onSavedQueryChange={onSavedQueryChange}
        />
      </div>
      <div className="vbdLayout">
        <section className="vbdSide vbdSide--left" aria-label="Data">
          <div className="vbdSide__header">
            <DataSourceSelect
              selectedId={indexId}
              onChange={(id) => update((current) => withIndexPattern(current, id))}
            />
          </div>
          <DataTab state={app} update={update} indexPattern={indexPattern} context={context} hits={hits} onAddFilters={addFilters} />
        </section>
        <div className="vbdArea" ref={area}>
          <div className="vbdArea__workspace" style={{ width: `${100 - rightShare}%` }}>
            <Workspace
              state={app}
              indexPattern={indexPattern}
              input={input}
              tick={tick}
              onUiState={(ui) => update((current) => ({ ...current, ui }))}
              onFilter={addFilters}
              onTimeChange={setTime}
            />
          </div>
          <button
            type="button"
            className="vbdArea__resize"
            aria-label="Press left or right to adjust panels size"
            onPointerDown={startResize}
            onKeyDown={resizeByKey}
            data-test-subj="euiResizableButton"
          />
          <div className="vbdArea__right" style={{ width: `${rightShare}%` }}>
            <StylePanel state={app} update={update} />
          </div>
        </div>
      </div>
      {saving && (
        <SaveModal
          objectType="visualization"
          savedObjectType={VIS_BUILDER_TYPE}
          title={title}
          description={saved?.description}
          showDescription
          existing={Boolean(savedId)}
          id={savedId}
          // Opened from a dashboard, a saved visualization is saved as a new one unless told otherwise
          initialAsNew={Boolean(savedId) && Boolean(originatingApp)}
          confirmLabel={returns ? 'Save and return' : undefined}
          options={({ asNew }) => {
            const offer = returnSwitch(originatingApp, savedId, asNew);
            return offer.shown ? (
              <Switch compressed checked={returnToOrigin} onChange={setReturnToOrigin} label={offer.label} testId="returnToOriginModeSwitch" />
            ) : null;
          }}
          onSave={(result) => save({ ...result, returnToOrigin: returns && returnSwitch(originatingApp, savedId, Boolean(savedId) && result.asNew).shown })}
          onClose={() => setSaving(false)}
        />
      )}
    </div>
  );
}

/** The documents the values of a field are counted in: the newest that the page's search finds */
function useSampleHits(indexPattern: IndexPattern | undefined, query: Query, filters: Filter[], time: TimeRange): RawHit[] {
  const [hits, setHits] = useState<RawHit[]>([]);
  const key = JSON.stringify([query, filters, time]);
  useEffect(() => {
    if (!indexPattern) return undefined;
    const controller = new AbortController();
    const { version: _version, ...fields } = documentFields(indexPattern);
    const bool = buildQuery(indexPattern, query, filters, services.queryConfig());
    const range = indexPattern.timeFieldName ? resolveTimeRange(time, { weekStart: services.weekStart() }) : undefined;
    const timeFilter = timeRangeFilter(indexPattern, range);
    if (timeFilter) bool.bool.filter.push(timeFilter);
    const body = {
      ...fields,
      size: services.uiSettings.get<number>('discover:sampleSize', 500),
      sort: sortClause(indexPattern, [[indexPattern.timeFieldName || '_score', 'desc']]),
      query: bool,
    };
    services.search
      .search(indexPattern.title, body, { signal: controller.signal })
      .then((response) => setHits(response.hits.hits as RawHit[]))
      .catch(() => undefined);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indexPattern, key]);
  return hits;
}

interface PatternOption {
  id: string;
  title: string;
  displayName?: string;
}

/** The index patterns in the order the saved objects come, as the original lists them */
async function findIndexPatterns(): Promise<PatternOption[]> {
  const found = await services.savedObjects.find<{ title: string; displayName?: string }>({
    type: 'index-pattern',
    fields: ['title', 'displayName'],
    perPage: 10000,
  });
  return found.saved_objects.map((object) => ({
    id: object.id,
    title: object.attributes.title,
    displayName: object.attributes.displayName || undefined,
  }));
}

/**
 * The index pattern the fields are those of, as the original's "searchable dropdown": a field with
 * "Data Source" in front that opens a list to search. In the list, as in the component library's,
 * one option is active at a time, the chosen one when the search is focused; the arrows move it,
 * Enter takes it, and it carries the badge of the Return key.
 */
/** Under the middle of the control, 8 px below, on a whole pixel as the original puts its panel */
const UNDER_SOURCE = (anchor: DOMRect, panel: { width: number }) => ({
  top: anchor.bottom + 8,
  left: Math.round(anchor.left + (anchor.width - panel.width) / 2),
  side: 'bottom' as const,
});

function DataSourceSelect({ selectedId, onChange }: { selectedId?: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [patterns, setPatterns] = useState<PatternOption[]>();
  const [error, setError] = useState<string>();
  const [search, setSearch] = useState('');
  const [active, setActive] = useState<number>();
  const listId = useId();
  useEffect(() => {
    let live = true;
    findIndexPatterns()
      .then((list) => live && setPatterns(list))
      .catch((failure) => live && setError(errorMessage(failure)));
    return () => {
      live = false;
    };
  }, []);
  const loading = patterns === undefined && error === undefined;
  // As the original's, which shows what went wrong in place of the list
  const shownError = error !== undefined ? `Error: ${error}` : patterns?.length === 0 ? 'Error: No index patterns available' : undefined;
  const current = patterns?.find((pattern) => pattern.id === selectedId);
  const wanted = search.trim().toLowerCase();
  const shown = (patterns ?? []).filter((pattern) => !wanted || pattern.title.toLowerCase().includes(wanted));
  // What is active once the search has the focus: the chosen one when it is shown, else the first
  const firstActive = (list: PatternOption[]) => {
    const chosen = list.findIndex((pattern) => pattern.id === selectedId);
    return chosen > -1 ? chosen : list.length ? 0 : undefined;
  };
  const close = useCallback(() => {
    setOpen(false);
    setSearch('');
    setActive(undefined);
  }, []);
  const choose = (pattern: PatternOption | undefined) => {
    close();
    if (pattern && pattern.id !== selectedId) onChange(pattern.id);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!shown.length) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((index) => (index === undefined ? (step > 0 ? 0 : shown.length - 1) : (index + step + shown.length) % shown.length));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (active !== undefined) choose(shown[active]);
    }
  };
  const optionId = (index: number) => `${listId}_option-${index}`;

  return (
    <Popover
      open={open}
      onClose={close}
      placeAt={UNDER_SOURCE}
      anchorStyle={{ display: 'flex', width: '100%' }}
      className="vbdSourceList"
      button={
        <div className="vbdSource" title={current ? patternName(current) : 'Select an option'}>
          <span className="vbdSource__prepend">Data Source</span>
          <button
            type="button"
            className="vbdSource__button"
            onClick={() => (open ? close() : setOpen(true))}
            data-test-subj="searchableDropdownValue"
          >
            <span className="vbdSource__value">
              <span className="vbdSource__text">
                {current ? (
                  <>
                    <Icon name="indexPatternApp" app /> {patternName(current)}
                  </>
                ) : (
                  <span className="atlSubdued">{loading ? 'Loading' : 'Select an option'}</span>
                )}
              </span>
            </span>
          </button>
          <span className="vbdSource__icons">
            {loading && <Spinner />}
            <Icon name="chevronDown" />
          </span>
        </div>
      }
    >
      {loading ? (
        <div className="vbdSourceList__loading">
          <Spinner />
        </div>
      ) : shownError !== undefined ? (
        <p className="vbdSourceList__error">{shownError}</p>
      ) : (
        <>
          <div className="vbdSourceList__search">
            <SearchField
              value={search}
              onChange={(next) => {
                setSearch(next);
                const nextWanted = next.trim().toLowerCase();
                setActive(firstActive((patterns ?? []).filter((pattern) => !nextWanted || pattern.title.toLowerCase().includes(nextWanted))));
              }}
              placeholder="Filter options"
              aria-label="Selectable options"
              role="combobox"
              aria-haspopup="listbox"
              aria-controls={`${listId}_listbox`}
              aria-activedescendant={active === undefined ? undefined : optionId(active)}
              autoComplete="off"
              autoFocus
              onFocus={() => setActive((index) => index ?? firstActive(shown))}
              onBlur={(event) => {
                if (!event.currentTarget.closest('.vbdSourceList')?.contains(event.relatedTarget as Node | null)) setActive(undefined);
              }}
              onKeyDown={onKeyDown}
              append={
                // The original's button that clears the search, which gives the focus back to it
                search ? (
                  <button
                    type="button"
                    className="vbdSourceList__clear"
                    aria-label="Clear input"
                    onClick={(event) => {
                      setSearch('');
                      setActive(firstActive(patterns ?? []));
                      event.currentTarget.parentElement?.querySelector('input')?.focus();
                    }}
                  >
                    <Icon name="cross" />
                  </button>
                ) : undefined
              }
            />
          </div>
          {shown.length ? (
            <ul
              className={cx('vbdSourceList__options', shown.length > 7 && 'vbdSourceList__options--more')}
              id={`${listId}_listbox`}
              role="listbox"
              aria-label="Selectable options"
              data-test-subj="searchableDropdownList"
            >
              {shown.map((pattern, index) => (
                <li
                  key={pattern.id}
                  id={optionId(index)}
                  role="option"
                  aria-selected={pattern.id === selectedId}
                  aria-posinset={index + 1}
                  aria-setsize={shown.length}
                  className={cx('vbdSourceList__option', active === index && 'vbdSourceList__option--active')}
                  title={patternName(pattern)}
                  onMouseDown={() => setActive(index)}
                  onClick={() => choose(pattern)}
                >
                  <Icon name="indexPatternApp" app className="vbdSourceList__icon" />
                  <span className="vbdSourceList__text">{patternName(pattern)}</span>
                  {active === index && (
                    <span className="vbdSourceList__badge" aria-hidden="true">
                      <Icon name="returnKey" />
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <div className="vbdSourceList__message">
              <p>
                <strong>{search}</strong> doesn&apos;t match any options
              </p>
            </div>
          )}
        </>
      )}
    </Popover>
  );
}

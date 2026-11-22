/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The editor of a visualization: the chart at the left, and at the right its data and its
 * settings. What someone changes at the right is a draft until "Update" applies it; the applied
 * state is in the address (`_a=(filters,linked,query,uiState,vis:(aggs,params,title,type))`), as
 * OpenSearch Dashboards keeps it, so a link shows what its sender saw.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, EmptyPrompt, IconButton, Link, Loading, Tabs, cx } from '../../components/basic';
import { Popover } from '../../components/overlay';
import type { AggConfig, AggContext, Table } from '../../lib/aggs';
import type { TimeRange } from '../../lib/dates';
import { mergeFilters } from '../../lib/query';
import type { Filter, IndexPattern, Query } from '../../lib/types';
import { appUrl, decodeState, encodeState } from '../../lib/url';
import { visFromSavedObject, visToSavedObject, visType, type UiState, type Vis, type VisualizationAttributes } from '../../lib/vis';
import { getLocation, href, navigate, setHashParams, setLeaveGuard, useLocation } from '../../router';
import { services } from '../../services';
import { errorMessage } from '../../services/http';
import { patternName } from '../../services/index_patterns';
import type { RequestRecord } from '../../services/search';
import { TopNav, type TopNavItem } from '../../shell/chrome';
import { isPinned, splitFilters } from '../../shell/filter_bar';
import { Inspector } from '../../shell/inspect';
import { defaultQueryLanguage } from '../../shell/query_bar';
import { SaveModal, ShareModal, type SaveResult } from '../../shell/saved_objects_ui';
import { pageFiltersOf, savedQueryGlobalParam, type SavedQueryChange } from '../../shell/saved_query';
import { SearchBar } from '../../shell/search_bar';
import { addRecentlyAccessed, currentGlobalParam, useAutoRefresh, useBreadcrumbs, useGlobalState } from '../../shell/state';
import { resolveVisSource, visContext, type VisInput } from '../../vis/request';
import { Visualization, canDraw } from '../../vis/visualization';
import { DataTab } from './data_tab';
import { defaultParams, newVis, syncParams, visProblems } from './defaults';
import { optionTabs } from './options';

export const VISUALIZE = '/app/visualize';

// The same text for the same state, whatever order its keys came in: the address sorts them
const stable = (value: unknown): string =>
  JSON.stringify(value, (_key, item: unknown) =>
    item !== null && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : item
  );

interface Draft {
  aggs: AggConfig[];
  params: Record<string, unknown>;
}

interface UrlAppState {
  query?: Query;
  filters?: Filter[];
  linked?: boolean;
  /** The id of the saved query loaded into the search bar */
  savedQuery?: string;
  uiState?: UiState;
  vis?: { aggs?: AggConfig[]; params?: Record<string, unknown>; title?: string; type?: string };
}

interface Loaded {
  vis: Vis;
  indexPattern?: IndexPattern;
  /** The title of the saved search it is drawn from */
  searchTitle?: string;
}

async function load(savedId: string | undefined, create: { type?: string; indexPattern?: string; savedSearchId?: string }): Promise<Loaded> {
  let vis: Vis;
  if (savedId) {
    vis = visFromSavedObject(await services.savedObjects.get<VisualizationAttributes>('visualization', savedId));
  } else {
    if (!create.type || !visType(create.type)) throw new Error('The address names no kind of visualization to create');
    vis = newVis(create.type, { indexPatternId: create.indexPattern, savedSearchId: create.savedSearchId });
  }
  let searchTitle: string | undefined;
  const searchId = vis.savedSearchId;
  if (searchId) {
    vis = await resolveVisSource(vis);
    const search = await services.savedObjects.get<{ title?: string }>('search', searchId);
    searchTitle = search.attributes.title;
  }
  const indexId = vis.source.indexId ?? vis.parent?.indexId;
  const indexPattern = indexId ? await services.indexPatterns.get(indexId) : undefined;
  return { vis, indexPattern, searchTitle };
}

export function VisEditor({ savedId }: { savedId?: string }) {
  const location = useLocation();
  const [global, setGlobal] = useGlobalState();
  const [loaded, setLoaded] = useState<Loaded>();
  const [loadError, setLoadError] = useState<string>();
  const [draft, setDraft] = useState<Draft>();
  const [tab, setTab] = useState<string>();
  const [collapsed, setCollapsed] = useState(false);
  const [tick, setTick] = useState(0);
  const [tried, setTried] = useState(false);
  const [dialog, setDialog] = useState<'save' | 'share' | 'inspect' | 'link'>();
  const lastData = useRef<{ requests: RequestRecord[]; table?: Table }>();

  const createType = location.hashParams.type;
  const createPattern = location.hashParams.indexPattern;
  const createSearch = location.hashParams.savedSearchId;
  useEffect(() => {
    let live = true;
    setLoaded(undefined);
    setLoadError(undefined);
    load(savedId, { type: createType, indexPattern: createPattern, savedSearchId: createSearch })
      .then((answer) => {
        if (!live) return;
        setLoaded(answer);
        if (savedId) addRecentlyAccessed(appUrl(VISUALIZE, `/edit/${encodeURIComponent(savedId)}`), answer.vis.title, savedId);
      })
      .catch((failure) => live && setLoadError(errorMessage(failure)));
    return () => {
      live = false;
    };
  }, [savedId, createType, createPattern, createSearch]);

  const saved = loaded?.vis;
  const indexPattern = loaded?.indexPattern;
  const kind = saved ? visType(saved.type) : undefined;
  const aggBased = Boolean(kind?.aggBased);

  const urlState = useMemo(() => decodeState<UrlAppState>(location.hashParams._a), [location.hashParams._a]);
  const writeApp = useCallback(
    (changes: UrlAppState, replace = false) => {
      const latest = decodeState<UrlAppState>(location.hashParams._a);
      setHashParams({ _a: encodeState({ ...latest, ...changes }) }, { replace });
    },
    [location.hashParams._a]
  );
  const onSavedQueryChange = useCallback((change: SavedQueryChange) => {
    const { savedQuery: _previous, ...latest } = decodeState<UrlAppState>(getLocation().hashParams._a);
    const next: UrlAppState = { ...latest, query: change.query, filters: pageFiltersOf(change) };
    if (change.id) next.savedQuery = change.id;
    setHashParams({ _g: savedQueryGlobalParam(change), _a: encodeState(next) }, { replace: change.replace });
  }, []);

  const context = useMemo<AggContext>(() => (indexPattern ? visContext(indexPattern, global.time) : {}), [indexPattern, global.time]);

  // What the chart is drawn from: the address, when it names a state, or else what was saved
  const appliedKey = useMemo(() => {
    if (!saved) return undefined;
    const fromUrl = urlState.vis && (urlState.vis.type === undefined || urlState.vis.type === saved.type) ? urlState.vis : undefined;
    const aggs = fromUrl?.aggs ?? saved.aggs;
    const params = fromUrl?.params ? { ...(saved.id ? {} : defaultParams(saved.type)), ...fromUrl.params } : saved.params;
    return stable({ aggs, params: fromUrl ? syncParams({ type: saved.type, aggs, params }, {}) : params });
  }, [saved, urlState.vis]);
  const applied = useMemo<Draft | undefined>(() => (appliedKey ? (JSON.parse(appliedKey) as Draft) : undefined), [appliedKey]);
  useEffect(() => {
    if (appliedKey) setDraft(JSON.parse(appliedKey) as Draft);
  }, [appliedKey]);

  const query: Query = useMemo(
    () => urlState.query ?? saved?.source.query ?? { query: '', language: defaultQueryLanguage() },
    [urlState.query, saved?.source.query]
  );
  const appFilters = useMemo(() => urlState.filters ?? saved?.source.filters ?? [], [urlState.filters, saved?.source.filters]);
  const filters = useMemo(() => [...global.filters, ...appFilters.filter((filter) => !isPinned(filter))], [global.filters, appFilters]);
  const uiState = useMemo<UiState>(() => urlState.uiState ?? saved?.uiState ?? {}, [urlState.uiState, saved?.uiState]);
  const input = useMemo<VisInput>(() => ({ time: global.time, query, filters }), [global.time, query, filters]);

  const refresh = useCallback(() => setTick((count) => count + 1), []);
  useAutoRefresh(global.refreshInterval, refresh);

  const setFilters = useCallback(
    (next: Filter[]) => {
      const { pinned, app } = splitFilters(next);
      if (JSON.stringify(pinned) !== JSON.stringify(global.filters)) setGlobal({ filters: pinned });
      if (JSON.stringify(app) !== JSON.stringify(appFilters)) writeApp({ filters: app });
    },
    [global.filters, appFilters, setGlobal, writeApp]
  );
  const addFilters = useCallback(
    (added: Filter[]) => {
      const pinned = services.uiSettings.get('filters:pinnedByDefault', false);
      setFilters(mergeFilters(filters, pinned ? added.map((filter) => ({ ...filter, $state: { store: 'globalState' as const } })) : added));
    },
    [filters, setFilters]
  );
  const setTime = useCallback((time: TimeRange) => setGlobal({ time }), [setGlobal]);

  const draftKey = draft ? stable(draft) : undefined;
  const dirty = draftKey !== undefined && draftKey !== appliedKey;
  const unsaved = useMemo(() => {
    if (!saved || !applied) return false;
    if (!saved.id) return true;
    return (
      stable({ aggs: saved.aggs, params: saved.params }) !== appliedKey ||
      stable(uiState) !== stable(saved.uiState ?? {}) ||
      stable(query) !== stable(saved.source.query ?? { query: '', language: query.language }) ||
      stable(appFilters) !== stable(saved.source.filters)
    );
  }, [saved, applied, appliedKey, uiState, query, appFilters]);

  useEffect(() => {
    if (!dirty && !(unsaved && saved?.id)) return undefined;
    setLeaveGuard(() => window.confirm('Leave this visualization? Changes you made to it have not been saved.'));
    return () => setLeaveGuard(undefined);
  }, [dirty, unsaved, saved?.id]);

  const problems = useMemo(
    () => (saved && draft && aggBased ? visProblems({ type: saved.type, aggs: draft.aggs }, indexPattern) : {}),
    [saved, draft, aggBased, indexPattern]
  );
  const hasProblems = Object.keys(problems).length > 0;

  const update = useCallback(() => {
    if (!saved || !draft || !dirty) return;
    if (hasProblems) {
      setTried(true);
      return;
    }
    setTried(false);
    writeApp({ vis: { aggs: draft.aggs, params: draft.params, title: saved.title, type: saved.type } });
  }, [saved, draft, dirty, hasProblems, writeApp]);

  // Ctrl or Cmd with Enter applies the draft, wherever the cursor is in the sidebar
  const updateRef = useRef(update);
  updateRef.current = update;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        updateRef.current();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const title = saved?.title ?? '';
  useBreadcrumbs([{ text: 'Visualize', to: appUrl(VISUALIZE, '/') }, { text: saved?.id ? title || 'Visualization' : 'Create' }]);

  const shown = useMemo<Vis | undefined>(() => {
    if (!saved || !applied) return undefined;
    // The page's bar holds the visualization's own query and filters while it is edited
    return { ...saved, aggs: applied.aggs, params: applied.params, uiState, source: { ...saved.source, query: undefined, filters: [] } };
  }, [saved, applied, uiState]);

  if (loadError) {
    return (
      <div className="shlPage">
        <EmptyPrompt
          icon="warning"
          title="The visualization could not be loaded"
          actions={
            <Button variant="primary" to={appUrl(VISUALIZE, '/')}>
              Back to the visualizations
            </Button>
          }
        >
          {loadError}
        </EmptyPrompt>
      </div>
    );
  }
  if (!saved || !applied || !draft || !shown) return <Loading />;

  const linked = Boolean(saved.savedSearchId);
  const unlink = () => {
    const parent = saved.parent;
    setLoaded({
      ...loaded,
      searchTitle: undefined,
      vis: {
        ...saved,
        savedSearchId: undefined,
        parent: undefined,
        source: { indexId: parent?.indexId ?? saved.source.indexId, query: saved.source.query, filters: saved.source.filters },
      },
    });
    // What the saved search asked becomes the visualization's own, on the page's bar
    const ownQuery = typeof query.query === 'string' && query.query.trim() !== '' ? query : (parent?.query ?? query);
    writeApp({ linked: false, query: ownQuery, filters: [...(parent?.filters ?? []), ...appFilters] }, true);
    setDialog(undefined);
    services.toasts.success(`Unlinked from saved search “${loaded?.searchTitle ?? ''}”`);
  };

  const save = async ({ title: newTitle, description, asNew }: SaveResult) => {
    const vis: Vis = {
      ...saved,
      title: newTitle,
      description,
      aggs: applied.aggs,
      params: applied.params,
      uiState,
      source: { indexId: saved.source.indexId, query, filters: appFilters.filter((filter) => !isPinned(filter)) },
    };
    const { attributes, references } = visToSavedObject(vis);
    const existing = saved.id && !asNew ? saved.id : undefined;
    // An update merges: a link to a saved search that was broken has to be taken out by name
    const stored = existing
      ? await services.savedObjects.update(
          'visualization',
          existing,
          { ...attributes, ...(vis.savedSearchId ? {} : { savedSearchRefName: null }) } as unknown as VisualizationAttributes,
          { references }
        )
      : await services.savedObjects.create('visualization', attributes, { references });
    setDialog(undefined);
    setLeaveGuard(undefined);
    services.toasts.success(`Saved '${newTitle}'`);
    if (stored.id !== savedId) {
      navigate(appUrl(VISUALIZE, `/edit/${encodeURIComponent(stored.id)}`, { _g: currentGlobalParam() }), { force: true });
    } else {
      setLoaded({ ...loaded, vis: { ...vis, id: stored.id, version: stored.version, source: vis.source, references } });
      // The changes the address held are saved now; the saved query loaded into the bar stays
      const { savedQuery } = decodeState<UrlAppState>(getLocation().hashParams._a);
      setHashParams({ _a: savedQuery ? encodeState({ savedQuery }) : undefined }, { replace: true });
    }
  };

  const hasRequests = aggBased || saved.type === 'metrics';
  const navItems: TopNavItem[] = [
    {
      id: 'inspect',
      label: 'Inspect',
      disabled: !hasRequests,
      title: hasRequests ? 'Open Inspector for visualization' : "This visualization doesn't support any inspectors.",
      onClick: () => setDialog('inspect'),
      testId: 'openInspectorButton',
    },
    { id: 'share', label: 'Share', title: 'Share Visualization', onClick: () => setDialog('share'), testId: 'shareTopNavButton' },
    {
      id: 'save',
      label: 'Save',
      emphasize: true,
      icon: 'save',
      disabled: dirty,
      title: dirty ? 'Apply or Discard your changes before saving' : 'Save Visualization',
      onClick: () => setDialog('save'),
      testId: 'visualizeSaveButton',
    },
  ];

  const tabs = [...(aggBased ? [{ id: 'data', label: 'Data' }] : []), ...optionTabs(saved.type).map((item) => ({ id: item.id, label: item.label }))];
  const selected = tabs.some((item) => item.id === tab) ? (tab as string) : tabs[0].id;
  const optionTab = optionTabs(saved.type).find((item) => item.id === selected);
  const setParams = (params: Record<string, unknown>) => setDraft({ ...draft, params });
  const setAggs = (aggs: AggConfig[]) => setDraft({ aggs, params: syncParams({ type: saved.type, aggs, params: draft.params }, context) });
  const showBar = saved.type !== 'markdown';

  return (
    <div className="vzePage" data-test-subj="visualizeEditor">
      <TopNav items={navItems} />
      {showBar && (
        <SearchBar
          indexPatterns={indexPattern ? [indexPattern] : []}
          query={query}
          onQuerySubmit={(next) => writeApp({ query: next })}
          filters={filters}
          onFiltersChange={setFilters}
          time={global.time}
          refreshInterval={global.refreshInterval}
          onTimeChange={setTime}
          onRefreshChange={(refreshInterval) => setGlobal({ refreshInterval })}
          onRefresh={refresh}
          showQuery={aggBased || saved.type === 'metrics'}
          savedQueryId={urlState.savedQuery}
          onSavedQueryChange={onSavedQueryChange}
        />
      )}
      <div className="vzeEditor">
        <div className="vzeChart" data-test-subj="visualizationLoader">
          {canDraw(saved.type) || aggBased ? (
            <Visualization
              vis={shown}
              input={input}
              tick={tick}
              uiState={uiState}
              onUiState={(next) => writeApp({ uiState: next }, true)}
              onFilter={addFilters}
              onFiltersChange={setFilters}
              onTimeChange={setTime}
              onData={(data) => {
                lastData.current = data;
              }}
            />
          ) : (
            <EmptyPrompt icon="visualize" title={`${kind?.title ?? saved.type} visualizations are not drawn by this build yet`}>
              Its settings can still be read and changed at the right.
            </EmptyPrompt>
          )}
        </div>
        <aside className={cx('vzeSide', collapsed && 'vzeSide--collapsed')} aria-label="Visualization editor">
          <IconButton
            className="vzeSide__collapse"
            icon={collapsed ? 'chevronLeft' : 'chevronRight'}
            size="s"
            label="Toggle sidebar"
            aria-expanded={!collapsed}
            onClick={() => setCollapsed(!collapsed)}
            testId="collapseSideBarButton"
          />
          {!collapsed && (
            <>
              {(indexPattern || linked) && (
                <div className="vzeSide__title">
                  {linked ? (
                    <Popover
                      open={dialog === 'link'}
                      onClose={() => setDialog(undefined)}
                      padded
                      button={
                        <button type="button" className="atlLinkButton vzeSide__link" onClick={() => setDialog(dialog === 'link' ? undefined : 'link')} title="Link to saved search. Click to learn more or break link.">
                          <strong className="atlTruncate">{loaded?.searchTitle ?? 'Saved search'}</strong>
                        </button>
                      }
                    >
                      <div className="atlStack" style={{ maxWidth: 280 }}>
                        <strong>Linked to saved search</strong>
                        <p className="atlSmall">
                          This visualization is drawn from the saved search “{loaded?.searchTitle}”. A change to that search changes this
                          visualization too.
                        </p>
                        <Link to={`/app/data-explorer/discover#/view/${encodeURIComponent(saved.savedSearchId ?? '')}`}>Open the saved search</Link>
                        <Button size="s" variant="danger" onClick={unlink} testId="showUnlinkSavedSearchPopover">
                          Break the link to the saved search
                        </Button>
                      </div>
                    </Popover>
                  ) : (
                    <strong className="atlTruncate" title={`Index pattern: ${indexPattern ? patternName(indexPattern) : ''}`}>
                      {indexPattern ? patternName(indexPattern) : ''}
                    </strong>
                  )}
                </div>
              )}
              {tabs.length > 1 && <Tabs tabs={tabs} selected={selected} onSelect={setTab} />}
              <div className="vzeSide__body">
                {selected === 'data' && aggBased ? (
                  <DataTab
                    type={saved.type}
                    aggs={draft.aggs}
                    onChange={setAggs}
                    indexPattern={indexPattern}
                    context={context}
                    problems={problems}
                    showProblems={tried}
                  />
                ) : (
                  optionTab?.render({ type: saved.type, params: draft.params, setParams, aggs: draft.aggs, context })
                )}
              </div>
              <div className="vzeSide__footer">
                {tried && hasProblems && <span className="atlFormRow__error">Errors in the highlighted fields need to be resolved.</span>}
                <div className="vzeSide__buttons">
                  <Button
                    variant="empty"
                    icon="cross"
                    disabled={!dirty}
                    onClick={() => {
                      setDraft(applied);
                      setTried(false);
                    }}
                    testId="visualizeEditorResetButton"
                  >
                    Discard
                  </Button>
                  <Button variant="primary" icon="play" disabled={!dirty} onClick={update} testId="visualizeEditorRenderButton">
                    Update
                  </Button>
                </div>
              </div>
            </>
          )}
        </aside>
      </div>

      {dialog === 'save' && (
        <SaveModal
          objectType="visualization"
          title={saved.title}
          description={saved.description}
          showDescription
          existing={Boolean(saved.id)}
          onSave={save}
          onClose={() => setDialog(undefined)}
        />
      )}
      {dialog === 'share' && (
        <ShareModal
          objectType="visualization"
          savedUrl={saved.id ? `${window.location.origin}${href(appUrl(VISUALIZE, `/edit/${encodeURIComponent(saved.id)}`))}` : undefined}
          onClose={() => setDialog(undefined)}
        />
      )}
      {dialog === 'inspect' && (
        <Inspector
          title={saved.title || 'Visualization'}
          requests={lastData.current?.requests ?? []}
          table={lastData.current?.table}
          onClose={() => setDialog(undefined)}
        />
      )}
    </div>
  );
}

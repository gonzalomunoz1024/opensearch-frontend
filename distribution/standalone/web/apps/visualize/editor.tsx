/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The editor of a visualization: the chart at the left, and at the right its data and its
 * settings. What someone changes at the right is a draft until "Update" applies it. The applied
 * state is in the address, `_a=(filters,linked,query,uiState,vis:(aggs,params,title,type))`, as
 * OpenSearch Dashboards keeps it: written whole as soon as the visualization has loaded, then by
 * each step, in a new entry of the history, so a link shows what its sender saw. A dashboard that
 * opens the editor names itself in the history's state: the editor then offers to go back to it,
 * and asks before it is left with changes (`top_nav.ts`, `state_transfer.ts`).
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CallOut, EmptyPrompt, IconButton, Loading, Tabs, cx } from '../../components/basic';
import { Switch } from '../../components/form';
import { Icon } from '../../components/icon';
import { Tooltip } from '../../components/overlay';
import type { AggConfig, AggContext } from '../../lib/aggs';
import type { TimeRange } from '../../lib/dates';
import { mergeFilters } from '../../lib/query';
import type { Filter, IndexPattern, Query } from '../../lib/types';
import { appUrl, buildHash, decodeState, encodeState } from '../../lib/url';
import { visFromSavedObject, visToSavedObject, visType, type UiState, type Vis, type VisualizationAttributes } from '../../lib/vis';
import { enteredAnotherApplication, getLocation, href, lastAddressOf, navigate, setHashParams, setLeaveGuard, useLocation } from '../../router';
import { services } from '../../services';
import { errorMessage } from '../../services/http';
import { TopNav, type TopNavItem } from '../../shell/chrome';
import { isPinned, splitFilters } from '../../shell/filter_bar';
import { Inspector } from '../../shell/inspect';
import { defaultQueryLanguage } from '../../shell/query_bar';
import { SaveModal, ShareModal, type SaveResult } from '../../shell/saved_objects_ui';
import { pageFiltersOf, savedQueryGlobalParam, type SavedQueryChange } from '../../shell/saved_query';
import { SearchBar } from '../../shell/search_bar';
import { showSearchError } from '../../shell/search_error';
import { addRecentlyAccessed, currentGlobalParam, useAutoRefresh, useBreadcrumbs, useGlobalState } from '../../shell/state';
import { resolveVisSource, visContext, type VisInput } from '../../vis/request';
import type { TsvbData, TsvbTableData } from '../../vis/tsvb/data';
import { specIndexPatterns } from '../../vis/vega/index_patterns';
import { Visualization, canDraw, type VisInspectData } from '../../vis/visualization';
import { serializeAggs } from './agg_params';
import { editorStateDefaults, initialAppState, paramsWithDefaults, unlinkSavedSearch, type AppVisState, type VisualizeAppState } from './app_state';
import { DataTab } from './data_tab';
import { newVis, syncParams, visProblems, withoutDisabledBuckets } from './defaults';
import { canAutoApply, dragWidths, editorHeading, initialWidths, keyWidths, searchBarParts, type SplitWidths } from './editor_layout';
import { LeaveConfirmModal } from './leave_confirm';
import { INDEX_PATTERNS_LINK, found, loadFailure } from './load_failure';
import { optionTabs } from './options';
import { SidebarControls, SidebarTitle } from './sidebar';
import { incomingEditorState, visualizationPackage } from './state_transfer';
import { LEAVE_TEXT, confirmsLeave, returnSwitch, visualizeTopNav, type TopNavAction } from './top_nav';
import { TsvbEditor } from './tsvb/editor';
import { withTsvbDefaults } from './tsvb/model';
import { setupVis } from './type_setup';

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

interface Loaded {
  vis: Vis;
  indexPattern?: IndexPattern;
  /** The title of the saved search it is drawn from */
  searchTitle?: string;
}

/** How the editor is laid out: what a visualization saved under a new id keeps */
interface EditorView {
  tab?: string;
  collapsed: boolean;
  widths?: SplitWidths;
  autoApply: boolean;
}

/**
 * What a visualization just saved under a new id hands the editor that opens at its address: the
 * original's editor goes on with what it has, without loading it again or changing its layout
 */
let handedOver: { id: string; loaded: Loaded; view: EditorView } | undefined;

/**
 * The visualization the address names, with what it is drawn from, failing as the original's
 * fails (`load_failure.ts`): what is missing as `SavedObjectNotFound`, in the order the original
 * looks (the visualization, its index pattern, its saved search, then its kind)
 */
async function load(savedId: string | undefined, create: { type?: string; indexPattern?: string; savedSearchId?: string }): Promise<Loaded> {
  let vis: Vis;
  if (savedId) {
    vis = visFromSavedObject(await found('visualization', savedId, () => services.savedObjects.get<VisualizationAttributes>('visualization', savedId)));
  } else {
    const kind = create.type ? visType(create.type) : undefined;
    if (!kind) throw new Error('You must provide a valid visualization type');
    // A kind drawn from an index pattern's aggregations is drawn from one, or from a saved search
    if (kind.aggBased && !create.indexPattern && !create.savedSearchId) throw new Error('You must provide either an indexPattern or a savedSearchId');
    vis = newVis(kind.name, { indexPatternId: create.indexPattern, savedSearchId: create.savedSearchId });
  }
  const patternOf = (id: string) => found('index-pattern', id, () => services.indexPatterns.get(id), INDEX_PATTERNS_LINK);
  let indexPattern = vis.source.indexId ? await patternOf(vis.source.indexId) : undefined;
  let searchTitle: string | undefined;
  const searchId = vis.savedSearchId;
  if (searchId) {
    const linkedTo = vis;
    vis = await found('search', searchId, () => resolveVisSource(linkedTo));
    const search = await found('search', searchId, () => services.savedObjects.get<{ title?: string }>('search', searchId));
    searchTitle = search.attributes.title;
    if (!indexPattern && vis.parent?.indexId) indexPattern = await patternOf(vis.parent.indexId);
  }
  // A kind this product does not have, as the original's `Vis` refuses it
  if (!visType(vis.type)) throw new Error(`Invalid visualization type "${vis.type}"`);
  // The setup of a map: the base map, and a region map's vector map and join field, not chosen yet
  vis = await setupVis(vis);
  // TSVB reads its saved params over the defaults of its type, as the product does
  if (vis.type === 'metrics') vis = { ...vis, params: withTsvbDefaults(vis.params) };
  return { vis, indexPattern, searchTitle };
}

/** The address of the page with other parameters in its fragment, and another place in it when given */
function addressWith(params: Record<string, string | undefined>, hashPath?: string): string {
  const at = getLocation();
  return `${at.pathname}${at.search ? `?${at.search}` : ''}${buildHash(hashPath ?? at.hashPath, { ...at.hashParams, ...params })}`;
}

/** The empty query in the language of the settings: the original's `getDefaultQuery` */
const defaultQuery = (): Query => ({ query: '', language: defaultQueryLanguage() });

/**
 * Writes the whole state of a visualization that has loaded to the address, what the address
 * said winning, and returns its text: the original's first write of `_a`, which replaces the
 * entry of the history, and with it what the application that opened the editor handed over
 */
function writeLoadedState({ vis, indexPattern }: Loaded): string {
  const fromUrl = decodeState<VisualizeAppState>(getLocation().hashParams._a);
  const encoded = encodeState(initialAppState(editorStateDefaults(vis, indexPattern, defaultQuery()), fromUrl));
  navigate(addressWith({ _a: encoded }), { replace: true, state: null });
  return encoded;
}

export function VisEditor({ savedId }: { savedId?: string }) {
  const location = useLocation();
  const [global, setGlobal] = useGlobalState();
  // What was saved under this id a moment ago by the editor that was here
  const [handed] = useState(() => {
    const given = handedOver && handedOver.id === savedId ? handedOver : undefined;
    handedOver = undefined;
    return given;
  });
  const [loaded, setLoaded] = useState<Loaded | undefined>(handed?.loaded);
  const [draft, setDraft] = useState<Draft>();
  const [tab, setTab] = useState<string | undefined>(handed?.view.tab);
  const [collapsed, setCollapsed] = useState(handed?.view.collapsed ?? false);
  const [tick, setTick] = useState(0);
  const [tried, setTried] = useState(false);
  // Every aggregation in error has been touched: "Update" turns into an error as in the original
  const [errorsTouched, setErrorsTouched] = useState(false);
  const [dialog, setDialog] = useState<'save' | 'share' | 'inspect'>();
  const lastData = useRef<VisInspectData>();
  const [autoApply, setAutoApply] = useState(handed?.view.autoApply ?? false);
  // The index patterns of the page's filters, for a kind drawn from no index pattern
  const [usedPatterns, setUsedPatterns] = useState<IndexPattern[]>([]);
  // The shares of the width the chart and the sidebar take, once the bar between them has moved
  const [widths, setWidths] = useState<SplitWidths | undefined>(handed?.view.widths);
  const split = useRef<HTMLDivElement>(null);
  const chartPanel = useRef<HTMLDivElement>(null);
  const sidePanel = useRef<HTMLElement>(null);
  // Where the pointer was when the bar was last moved, while it is held
  const dragFrom = useRef<number>();
  // What the TSVB editor needs of the chart it draws
  const [tsvbData, setTsvbData] = useState<TsvbData | TsvbTableData>();

  // What the application that opened the editor handed it: the application to go back to, and the
  // dashboard a new visualization is added to
  const [incoming] = useState(incomingEditorState);
  const [originatingApp, setOriginatingApp] = useState(incoming?.originatingApp);
  const containerInfo = incoming?.containerInfo;
  // Whether something changed since the visualization was loaded or saved, the original's
  // `hasUnsavedChanges`: so for a new one from the start, and after any step that writes `_a`
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(!savedId);
  // The `_a` the editor wrote itself when the visualization loaded or was saved: no change
  const ownApp = useRef<string | undefined>(handed ? getLocation().hashParams._a : undefined);
  // Whether the save dialog takes the visualization back to the application that opened the editor
  const [returnToOrigin, setReturnToOrigin] = useState(false);
  // What answers the question asked before the editor is left for another application
  const [leaveAnswer, setLeaveAnswer] = useState<(leave: boolean) => void>();

  const createType = location.hashParams.type;
  const createPattern = location.hashParams.indexPattern;
  const createSearch = location.hashParams.savedSearchId;
  useEffect(() => {
    if (handed) return undefined;
    let live = true;
    setLoaded(undefined);
    load(savedId, { type: createType, indexPattern: createPattern, savedSearchId: createSearch })
      .then((answer) => {
        if (!live) return;
        // The address first: no render sees the visualization without its state
        ownApp.current = writeLoadedState(answer);
        setLoaded(answer);
        if (savedId) addRecentlyAccessed(appUrl(VISUALIZE, `/edit/${encodeURIComponent(savedId)}`), answer.vis.title, savedId);
      })
      .catch((failure: unknown) => {
        if (!live) return;
        // As the original: a warning, and away to where it can be dealt with, asking nothing
        const { title, text, to, replace } = loadFailure(failure, savedId, currentGlobalParam());
        services.toasts.warning(title, text);
        navigate(to, { replace, force: true, state: null });
      });
    return () => {
      live = false;
    };
  }, [handed, savedId, createType, createPattern, createSearch]);

  const saved = loaded?.vis;
  const indexPattern = loaded?.indexPattern;
  const kind = saved ? visType(saved.type) : undefined;
  const aggBased = Boolean(kind?.aggBased);

  const urlState = useMemo(() => decodeState<VisualizeAppState>(location.hashParams._a), [location.hashParams._a]);
  // Changes the state in the address, in a new entry of the history when it changed, as the
  // original's state sync writes it; returns its text
  const writeApp = useCallback((changes: Partial<VisualizeAppState>): string => {
    const encoded = encodeState({ ...decodeState<VisualizeAppState>(getLocation().hashParams._a), ...changes });
    setHashParams({ _a: encoded });
    return encoded;
  }, []);
  // Any change of `_a` after the visualization loaded is one not saved, a step back included
  useEffect(() => {
    if (ownApp.current !== undefined && location.hashParams._a !== ownApp.current) setHasUnsavedChanges(true);
  }, [location.hashParams._a]);
  const onSavedQueryChange = useCallback((change: SavedQueryChange) => {
    const { savedQuery: _previous, ...latest } = decodeState<VisualizeAppState>(getLocation().hashParams._a);
    const next: Partial<VisualizeAppState> = { ...latest, query: change.query, filters: pageFiltersOf(change) };
    if (change.id) next.savedQuery = change.id;
    setHashParams({ _g: savedQueryGlobalParam(change), _a: encodeState(next) }, { replace: change.replace });
  }, []);

  const context = useMemo<AggContext>(() => (indexPattern ? visContext(indexPattern, global.time) : {}), [indexPattern, global.time]);

  // Whether it is drawn from its saved search: unlinking says no in the address, a step back yes again
  const linked = Boolean(saved?.savedSearchId) && urlState.linked !== false;
  const vis = useMemo<Vis | undefined>(() => {
    if (!saved || linked || !saved.savedSearchId) return saved;
    // Unlinked, it is drawn from the saved search's index pattern; its query and filters are in `_a`
    return { ...saved, savedSearchId: undefined, parent: undefined, source: { ...saved.source, indexId: saved.parent?.indexId ?? saved.source.indexId } };
  }, [saved, linked]);

  // What the chart is drawn from: the address, when it names a state, or else what was saved
  const appliedKey = useMemo(() => {
    if (!saved) return undefined;
    const fromUrl = urlState.vis && (urlState.vis.type === undefined || urlState.vis.type === saved.type) ? urlState.vis : undefined;
    // As the original, a bucket type the advanced settings disable is not known to the editor
    const aggs = withoutDisabledBuckets(fromUrl?.aggs ?? saved.aggs, (services.uiSettings.get('visualize:disableBucketAgg', []) ?? []) as string[]);
    // The settings over the kind's defaults, as the original's `Vis` takes them
    let params = fromUrl?.params ? paramsWithDefaults(saved.type, fromUrl.params) : saved.params;
    if (fromUrl?.params && saved.type === 'metrics') params = withTsvbDefaults(params);
    return stable({ aggs, params: fromUrl ? syncParams({ type: saved.type, aggs, params }, {}) : params });
  }, [saved, urlState.vis]);
  const applied = useMemo<Draft | undefined>(() => (appliedKey ? (JSON.parse(appliedKey) as Draft) : undefined), [appliedKey]);
  useEffect(() => {
    if (appliedKey) setDraft(JSON.parse(appliedKey) as Draft);
  }, [appliedKey]);

  // Without an index pattern the filter bar offers the fields of the indices a Vega spec names,
  // or else those of the default pattern, as the original does
  const vegaSpec = saved?.type === 'vega' ? applied?.params.spec : undefined;
  const needsPatterns = Boolean(saved) && !indexPattern;
  useEffect(() => {
    if (!needsPatterns) return undefined;
    let live = true;
    (async () => {
      let patterns = saved?.type === 'vega' ? await specIndexPatterns(vegaSpec) : [];
      if (!patterns.length) {
        const fallback = await services.indexPatterns.defaultId();
        patterns = fallback ? [await services.indexPatterns.get(fallback)] : [];
      }
      if (live && patterns.length) setUsedPatterns(patterns);
    })().catch(() => undefined);
    return () => {
      live = false;
    };
  }, [needsPatterns, saved?.type, vegaSpec]);

  const query: Query = useMemo(() => urlState.query ?? saved?.source.query ?? defaultQuery(), [urlState.query, saved?.source.query]);
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
  // The sidebar holds changes Update has not applied: the original's `hasUnappliedChanges` (TSVB
  // applies its own, and tells nothing of those it holds, as the original's)
  const dirty = draftKey !== undefined && draftKey !== appliedKey;

  // Leaving for another application asks first when a dashboard opened the editor and something
  // is not applied or not saved, in the original's modal; closing the tab asks the browser's way
  const leaving = useRef({ originatingApp, hasUnappliedChanges: dirty, hasUnsavedChanges });
  leaving.current = { originatingApp, hasUnappliedChanges: dirty, hasUnsavedChanges };
  useEffect(() => {
    setLeaveGuard(
      (target) =>
        !target.leavesApp || !confirmsLeave(leaving.current)
          ? true
          : new Promise<boolean>((resolve) => {
              setLeaveAnswer(() => (leave: boolean) => {
                setLeaveAnswer(undefined);
                resolve(leave);
              });
            }),
      () => (confirmsLeave(leaving.current) ? LEAVE_TEXT : undefined)
    );
    return () => setLeaveGuard(undefined);
  }, []);

  const problems = useMemo(
    () => (saved && draft && aggBased ? visProblems({ type: saved.type, aggs: draft.aggs }, indexPattern) : {}),
    [saved, draft, aggBased, indexPattern]
  );
  const hasProblems = Object.keys(problems).length > 0;

  // The visualization's state as the original writes it when changes are applied: each aggregation
  // serialized, a date histogram with the time range it is drawn for, the settings over the kind's
  // defaults, and the title the address has
  const visStateOf = useCallback(
    (next: Draft): AppVisState | undefined =>
      saved && {
        title: decodeState<VisualizeAppState>(getLocation().hashParams._a).vis?.title ?? saved.title,
        type: saved.type,
        aggs: aggBased ? serializeAggs(next.aggs, { indexPattern, timeRange: global.time, queryLanguage: defaultQueryLanguage() }) : next.aggs,
        params: paramsWithDefaults(saved.type, next.params),
      },
    [saved, aggBased, indexPattern, global.time]
  );

  const update = useCallback(() => {
    if (!draft || !dirty) return;
    if (hasProblems) {
      setTried(true);
      return;
    }
    setTried(false);
    const next = visStateOf(draft);
    if (!next) return;
    writeApp({ vis: next });
    setHasUnsavedChanges(true);
  }, [draft, dirty, hasProblems, writeApp, visStateOf]);

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

  // With auto apply on, a change is applied once nothing has changed for 300 ms
  useEffect(() => {
    if (!autoApply || !dirty) return undefined;
    const timer = setTimeout(() => updateRef.current(), 300);
    return () => clearTimeout(timer);
  }, [autoApply, dirty, draftKey]);

  const title = saved?.title ?? '';
  // The landing page, `#/`, with the `_g` the original's Visualize writes there at once
  const landing = appUrl(VISUALIZE, '/', { _g: location.hashParams._g });
  useBreadcrumbs(
    saved
      ? [{ text: 'Visualize', to: landing }, { text: saved.id ? title || 'Visualization' : 'Create' }]
      : [{ text: 'Visualize', to: landing }]
  );
  // The document's title as the original's: a saved visualization's own before the product's name
  // (an empty one left out); a new one leaves it as it was, which is the product's name when the
  // editor is the first page of Visualize. After the breadcrumbs' own, each time.
  const [titleBefore] = useState(() => (enteredAnotherApplication() ? services.boot.name : document.title));
  const docTitle = saved?.id ? [title, services.boot.name].filter(Boolean).join(' - ') : titleBefore;
  useEffect(() => {
    document.title = docTitle;
  });

  const shown = useMemo<Vis | undefined>(() => {
    if (!vis || !applied) return undefined;
    // The page's bar holds the visualization's own query and filters while it is edited
    return { ...vis, aggs: applied.aggs, params: applied.params, uiState, source: { ...vis.source, query: undefined, filters: [] } };
  }, [vis, applied, uiState]);

  if (!saved || !vis || !loaded || !applied || !draft || !shown) return <Loading />;

  // The original's `unlinkSavedSearch`: the saved search's query and filters become the
  // visualization's own, and it is drawn from the saved search's index pattern
  const unlink = () => {
    writeApp(unlinkSavedSearch({ query, filters: appFilters }, { query: saved.parent?.query, filters: saved.parent?.filters }));
    setHasUnsavedChanges(true);
    services.toasts.success(`Unlinked from saved search '${loaded.searchTitle ?? ''}'`);
  };

  // Where the editor goes back to, the original's `navigateToApp(originatingApp)`: the dashboard it
  // came from, where it was, with what was changed there and not saved yet
  const returnUrl = () => (originatingApp ? lastAddressOf(originatingApp) : appUrl(VISUALIZE, '/'));

  // The original's `doSave`: the title into the address first, then the whole visualization
  // (`create` with `overwrite`); then back to the application that opened the editor when asked,
  // or to the address of what was saved
  const doSave = async ({ title: newTitle, description, asNew, returnToOrigin: returning }: SaveResult & { returnToOrigin: boolean }) => {
    const newlyCreated = !vis.id || asNew;
    const latest = decodeState<VisualizeAppState>(getLocation().hashParams._a).vis;
    const visState: AppVisState = { title: newTitle, type: vis.type, aggs: latest?.aggs ?? applied.aggs, params: latest?.params ?? applied.params };
    ownApp.current = writeApp({ vis: { ...(latest ?? visState), title: newTitle } });
    setHasUnsavedChanges(false);
    const toSave: Vis = {
      ...vis,
      title: newTitle,
      description,
      // What the address holds, each aggregation's keys in the order the original writes them
      aggs: aggBased ? serializeAggs(visState.aggs, { indexPattern, queryLanguage: defaultQueryLanguage() }) : visState.aggs,
      params: visState.params,
      uiState,
      source: { indexId: vis.source.indexId, query, filters: appFilters.filter((filter) => !isPinned(filter)) },
    };
    const { attributes, references } = visToSavedObject(toSave);
    let stored: { id: string; version?: string };
    try {
      stored = await services.savedObjects.create('visualization', attributes, { id: newlyCreated ? undefined : vis.id, overwrite: true, references });
    } catch (failure) {
      setDialog(undefined);
      setHasUnsavedChanges(true);
      services.toasts.danger(`Error on saving '${newTitle}'`, errorMessage(failure));
      return;
    }
    setDialog(undefined);
    services.toasts.success(`Saved '${newTitle}'`);
    const editPath = `/edit/${encodeURIComponent(stored.id)}`;
    addRecentlyAccessed(appUrl(VISUALIZE, editPath), newTitle, stored.id);
    if (originatingApp && returning) {
      const back = returnUrl();
      // The back button opens what was saved: the original replaces the entry with its path alone
      navigate(appUrl(VISUALIZE, editPath), { replace: true });
      // A new visualization goes back as a panel to add; one saved in place is reloaded there
      navigate(back, { force: true, state: newlyCreated ? visualizationPackage(stored.id, containerInfo) : undefined });
      return;
    }
    if (newlyCreated) setOriginatingApp(undefined);
    const next: Loaded = { ...loaded, vis: { ...toSave, id: stored.id, version: stored.version, references } };
    if (stored.id === savedId) {
      setLoaded(next);
      return;
    }
    // The address names what was saved, and keeps the rest of its fragment, as the original's
    handedOver = { id: stored.id, loaded: next, view: { tab, collapsed, widths, autoApply } };
    navigate(addressWith({}, editPath), { replace: true });
  };

  // TSVB keeps no record of its requests for the inspector: Inspect is greyed out for it, as in the product
  const hasRequests = aggBased || saved.type === 'vega';
  const returning = Boolean(originatingApp) && returnToOrigin;
  const actions: Record<TopNavAction, () => void> = {
    inspect: () => setDialog('inspect'),
    share: () => setDialog('share'),
    // Back without saving: leaving asks when something would be lost
    cancel: () => navigate(returnUrl()),
    save: () => {
      setReturnToOrigin(Boolean(originatingApp));
      setDialog('save');
    },
    saveAndReturn: () => void doSave({ title: vis.title, description: vis.description, asNew: false, returnToOrigin: true }),
  };
  const navItems: TopNavItem[] = visualizeTopNav({
    hasUnsavedChanges,
    hasUnappliedChanges: dirty,
    originatingApp,
    savedId: vis.id,
    hasInspector: hasRequests,
  }).map((item) => {
    const tooltip = item.tooltip;
    return {
      id: item.id,
      label: item.label,
      emphasize: item.emphasize,
      icon: item.icon,
      disabled: item.disabled,
      testId: item.testId,
      onClick: actions[item.id],
      // The original's EuiToolTip: above the button unless there is no room, after a quarter second
      wrap: tooltip
        ? (button: ReactNode) => (
            <Tooltip content={tooltip} delay="regular">
              {button}
            </Tooltip>
          )
        : undefined,
    };
  });

  const tabs = [...(aggBased ? [{ id: 'data', label: 'Data' }] : []), ...optionTabs(saved.type).map((item) => ({ id: item.id, label: item.label }))].map(
    (item) => ({ ...item, testId: `visEditorTab__${item.id}` })
  );
  const selected = tabs.some((item) => item.id === tab) ? (tab as string) : tabs[0].id;
  const setParams = (params: Record<string, unknown>) => setDraft({ ...draft, params });
  const setAggs = (aggs: AggConfig[]) => setDraft({ aggs, params: syncParams({ type: saved.type, aggs, params: draft.params }, context) });
  const bar = searchBarParts(saved.type, indexPattern);
  const shares = widths ?? initialWidths(saved.type);
  const discard = () => {
    setDraft(applied);
    setTried(false);
    // As the original's, which writes the visualization's state again: a date histogram takes the
    // time range it is drawn for
    const next = visStateOf(applied);
    if (next) writeApp({ vis: next });
    setHasUnsavedChanges(true);
  };
  const dialogs = (
    <>
      {dialog === 'save' && (
        <SaveModal
          objectType="visualization"
          title={vis.title}
          description={vis.description}
          showDescription
          existing={Boolean(vis.id)}
          id={vis.id}
          // Opened from a dashboard, a saved visualization is saved as a new one unless told otherwise
          initialAsNew={Boolean(vis.id) && Boolean(originatingApp)}
          confirmLabel={returning ? 'Save and return' : undefined}
          options={({ asNew }) => {
            const offer = returnSwitch(originatingApp, vis.id, asNew);
            return offer.shown ? (
              <Switch compressed checked={returnToOrigin} onChange={setReturnToOrigin} label={offer.label} testId="returnToOriginModeSwitch" />
            ) : null;
          }}
          onSave={(result) =>
            doSave({ ...result, returnToOrigin: returning && returnSwitch(originatingApp, vis.id, Boolean(vis.id) && result.asNew).shown })
          }
          onClose={() => setDialog(undefined)}
        />
      )}
      {dialog === 'share' && (
        <ShareModal
          objectType="visualization"
          savedUrl={vis.id ? `${window.location.origin}${href(appUrl(VISUALIZE, `/edit/${encodeURIComponent(vis.id)}`))}` : undefined}
          onClose={() => setDialog(undefined)}
        />
      )}
      {dialog === 'inspect' && (
        <Inspector
          title={saved.title || 'Visualization'}
          requests={lastData.current?.requests ?? []}
          table={lastData.current?.table}
          vega={lastData.current?.vega}
          onClose={() => setDialog(undefined)}
        />
      )}
      {leaveAnswer && <LeaveConfirmModal onAnswer={leaveAnswer} />}
    </>
  );

  // TSVB has an editor of its own under its chart, and only the time picker above it
  if (saved.type === 'metrics') {
    return (
      <div className="vzePage vzePage--metrics vzePage--tsvb" data-test-subj="visualizeEditor">
        <TopNav items={navItems} />
        <SearchBar
          indexPatterns={[]}
          query={query}
          onQuerySubmit={(next) => writeApp({ query: next })}
          filters={filters}
          onFiltersChange={setFilters}
          time={global.time}
          refreshInterval={global.refreshInterval}
          onTimeChange={setTime}
          onRefreshChange={(refreshInterval) => setGlobal({ refreshInterval })}
          onRefresh={refresh}
          showQuery={bar.query}
          showFilters={bar.filters}
        />
        <h1 className="atlScreenReaderOnly">{editorHeading(vis.title, kind?.title ?? vis.type, Boolean(vis.id), originatingApp)}</h1>
        <TsvbEditor
          key={saved.id ?? 'new'}
          params={applied.params}
          onApply={(params) => {
            writeApp({ vis: { title: urlState.vis?.title ?? vis.title, type: vis.type, aggs: applied.aggs, params } });
            setHasUnsavedChanges(true);
          }}
          chart={
            // A TSVB panel shows the failures of its searches in its body, with no toast; one it
            // does not ask for at all (too many buckets) fails as the original's "Search Error"
            <Visualization
              vis={shown}
              input={input}
              tick={tick}
              uiState={uiState}
              onUiState={(next) => writeApp({ uiState: next })}
              onFilter={addFilters}
              onFiltersChange={setFilters}
              onTimeChange={setTime}
              onData={(data) => {
                lastData.current = data;
                setTsvbData(data.tsvb);
              }}
              onError={(failure) => failure && showSearchError(failure.original)}
            />
          }
          data={tsvbData}
        />
        {dialogs}
      </div>
    );
  }

  return (
    <div className={cx('vzePage', `vzePage--${saved.type}`)} data-test-subj="visualizeEditor">
      <TopNav items={navItems} />
      <SearchBar
        indexPatterns={indexPattern ? [indexPattern] : usedPatterns}
        query={query}
        onQuerySubmit={(next) => writeApp({ query: next })}
        filters={filters}
        onFiltersChange={setFilters}
        time={global.time}
        refreshInterval={global.refreshInterval}
        onTimeChange={setTime}
        onRefreshChange={(refreshInterval) => setGlobal({ refreshInterval })}
        onRefresh={refresh}
        showQuery={bar.query}
        showFilters={bar.filters}
        refreshOnly={!bar.datePicker}
        savedQueryId={urlState.savedQuery}
        onSavedQueryChange={onSavedQueryChange}
      />
      {kind?.stage === 'experimental' && <ExperimentalVisInfo />}
      <h1 className="atlScreenReaderOnly">{editorHeading(vis.title, kind?.title ?? vis.type, Boolean(vis.id), originatingApp)}</h1>
      <div
        className="vzeEditor"
        ref={split}
        onMouseMove={(event) => {
          if (dragFrom.current === undefined) return;
          const editorWidth = split.current?.getBoundingClientRect().width ?? 0;
          const chartWidth = chartPanel.current?.getBoundingClientRect().width ?? 0;
          const sideWidth = sidePanel.current?.getBoundingClientRect().width ?? 0;
          setWidths(dragWidths(chartWidth, sideWidth, event.clientX - dragFrom.current, editorWidth));
          dragFrom.current = event.clientX;
        }}
        onMouseUp={() => {
          dragFrom.current = undefined;
        }}
      >
        <div className="vzeChart" ref={chartPanel} style={{ width: `${shares.chart}%` }}>
          {canDraw(saved.type) || aggBased ? (
            <Visualization
              vis={shown}
              input={input}
              tick={tick}
              uiState={uiState}
              onUiState={(next) => writeApp({ uiState: next })}
              onFilter={addFilters}
              onFiltersChange={setFilters}
              onTimeChange={setTime}
              onData={(data) => {
                lastData.current = data;
              }}
              // The editor tells a failed search as the original's does: "Search Error"
              onError={(failure) => failure && showSearchError(failure.original)}
            />
          ) : (
            <EmptyPrompt icon="visualize" title={`${kind?.title ?? saved.type} visualizations are not drawn by this build yet`}>
              Its settings can still be read and changed at the right.
            </EmptyPrompt>
          )}
        </div>
        {/* The bar between the chart and the sidebar: dragged, or moved by its arrow keys */}
        <button
          type="button"
          className={cx('vzeResizer', collapsed && 'vzeResizer--hidden')}
          aria-label="Press left/right to adjust panels size"
          onMouseDown={(event) => {
            dragFrom.current = event.clientX;
          }}
          onKeyDown={(event) => {
            const next = keyWidths(shares, event.key);
            if (!next) return;
            event.preventDefault();
            setWidths(next);
          }}
          data-test-subj="splitPanelResizer"
        >
          <Icon name="grabHorizontal" />
        </button>
        <aside
          className={cx('vzeSide', collapsed && 'vzeSide--collapsed')}
          ref={sidePanel}
          style={{ width: `${shares.side}%` }}
          aria-label="Visualization editor"
        >
          <div className="vzeSide__content">
            <SidebarTitle
              type={saved.type}
              indexPattern={indexPattern}
              searchId={vis.savedSearchId}
              searchTitle={linked ? loaded.searchTitle : undefined}
              onUnlink={unlink}
            />
            {tabs.length > 1 && (
              <div className="vzeSide__nav">
                <Tabs tabs={tabs} selected={selected} onSelect={setTab} />
              </div>
            )}
            <div className={cx('vzeSide__body', saved.type === 'vega' && 'vzeSide__body--flush')}>
              {selected === 'data' && aggBased ? (
                <DataTab
                  type={saved.type}
                  aggs={draft.aggs}
                  onChange={setAggs}
                  indexPattern={indexPattern}
                  context={context}
                  problems={problems}
                  showProblems={tried}
                  params={draft.params}
                  setParams={setParams}
                  onTouched={setErrorsTouched}
                />
              ) : (
                optionTabs(saved.type)
                  .find((item) => item.id === selected)
                  ?.render({ type: saved.type, params: draft.params, setParams, aggs: draft.aggs, context })
              )}
            </div>
            <SidebarControls
              dirty={dirty}
              invalid={(tried || errorsTouched) && hasProblems}
              canAutoApply={canAutoApply(saved.type)}
              autoApply={autoApply}
              onAutoApply={setAutoApply}
              onDiscard={discard}
              onUpdate={update}
            />
          </div>
          <IconButton
            className="vzeSide__collapse"
            icon={collapsed ? 'menuLeft' : 'menuRight'}
            label="Toggle sidebar"
            aria-expanded={!collapsed}
            onClick={() => setCollapsed(!collapsed)}
            testId="collapseSideBarButton"
          />
        </aside>
      </div>

      {dialogs}
    </div>
  );
}

/** The original's banner over the editor of a kind still being tried out */
function ExperimentalVisInfo() {
  return (
    <div className="vzeExperimental" data-test-subj="experimentalVisInfo">
      <CallOut
        size="s"
        icon="beaker"
        title={
          <>
            This visualization is experimental and is not subject to the support SLA of official GA features. For feedback, please create
            an issue in{' '}
            <a
              className="shlExternal"
              href="https://github.com/opensearch-project/OpenSearch-Dashboards/issues/new/choose"
              target="_blank"
              rel="noopener noreferrer"
            >
              GitHub
              <Icon name="external" title="External link" />
            </a>
            .
          </>
        }
      />
    </div>
  );
}

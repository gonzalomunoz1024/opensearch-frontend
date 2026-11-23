/* SPDX-License-Identifier: Apache-2.0 */

/* Dashboards: the list of them, and one of them on screen, looked at or edited. */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, EmptyPrompt, Link, Loading } from '../../components/basic';
import { ConfirmModal, ContextMenu, Flyout, Popover } from '../../components/overlay';
import type { TimeRange } from '../../lib/dates';
import { uniqueFilters } from '../../lib/query';
import { parseSearchSource } from '../../lib/search_source';
import type { Filter, IndexPattern, Query } from '../../lib/types';
import { appUrl, decodeState, encodeQueryValue, encodeState } from '../../lib/url';
import { getLocation, href, locationState, navigate, setHashParams, setLeaveGuard, setLocationState, useLocation } from '../../router';
import { services } from '../../services';
import { errorMessage } from '../../services/http';
import type { SavedObject } from '../../services/saved_objects';
import { TopNav, type TopNavItem } from '../../shell/chrome';
import { FilterBar, isPinned, splitFilters } from '../../shell/filter_bar';
import { Inspector } from '../../shell/inspect';
import { Listing, ListingEmpty, type ListingColumn } from '../../shell/listing';
import { defaultQueryLanguage } from '../../shell/query_bar';
import { ShareModal } from '../../shell/saved_objects_ui';
import { pageFiltersOf, savedQueryGlobalParam, type SavedQueryChange } from '../../shell/saved_query';
import { SearchBar } from '../../shell/search_bar';
import { addRecentlyAccessed, currentGlobalParam, globalParamWith, setFullScreen, useAutoRefresh, useBreadcrumbs, useGlobalState } from '../../shell/state';
import type { VisInput } from '../../vis/request';
import { makeTurns } from '../../vis/turns';
import { NewVisModal } from '../visualize';
import { VIS_BUILDER_TITLE, VIS_BUILDER_TYPE } from '../vis_builder/model';
import { asHeld, cloneBase, cloneTitle, fullAppState, ownTime, restoredOptions, sameQuery, sameState, type UrlAppState } from './app_state';
import {
  CloneModal,
  CustomizePanelModal,
  DashboardSaveModal,
  EmptyDashboard,
  ExitFullScreen,
  OptionsMenu,
  type DashboardSaveResult,
} from './dialogs';
import { DashboardGrid } from './grid';
import {
  DEFAULT_PANEL,
  createNewState,
  dashboardBars,
  dashboardFromSavedObject,
  dashboardQuery,
  dashboardToSavedObject,
  emptyDashboard,
  findPlace,
  handedPanel,
  layoutsDiffer,
  newPanelIndex,
  openedEmbedded,
  orderAsOriginal,
  panelsDiffer,
  panelsFromUrl,
  panelsToUrl,
  placeBeside,
  readingOrder,
  samePanels,
  settleLayout,
  withHandedPanel,
  type ContainerInfo,
  type Dashboard,
  type DashboardAttributes,
  type DashboardOptions,
  type GridItem,
  type PanelState,
} from './model';
import { DashboardPanel, type LoadedObject, type PanelData } from './panel';
import { PanelFinder, type FoundObject, type PanelFinderType } from './panel_finder';
import type { PanelAction } from './panel_menu';
import '../../styles/dashboard.css';

const BASE = '/app/dashboards';

// The header stays hidden while a page opened to be embedded in another is open, as the
// original's: what the dashboard shows over its panels then follows from it
const HEADER_SHOWN = !openedEmbedded(window.location.hash);

const FINDER_TYPES: PanelFinderType[] = [
  { type: 'visualization', name: 'Visualization', icon: 'visualize' },
  { type: VIS_BUILDER_TYPE, name: VIS_BUILDER_TITLE, icon: 'visBuilder' },
  { type: 'search', name: 'Saved search', icon: 'discover' },
];

export function Dashboards() {
  const { hashPath } = useLocation();
  const view = /^\/view\/(.+)$/.exec(hashPath);
  if (view) return <DashboardPage key={view[1]} savedId={decodeURIComponent(view[1])} />;
  if (hashPath === '/create') return <DashboardPage key="create" />;
  return <DashboardList />;
}

function DashboardList() {
  useBreadcrumbs([{ text: 'Dashboards' }]);
  const { hashParams } = useLocation();
  const titleParam = hashParams.title;
  const filterParam = hashParams.filter ?? '';

  // An address with `?title=` opens the dashboard of that title, or lists those with it
  useEffect(() => {
    if (!titleParam) return;
    services.savedObjects
      .find<{ title?: string }>({ type: 'dashboard', search: `"${titleParam}"`, searchFields: ['title'] })
      .then((answer) => {
        const matching = answer.saved_objects.filter(
          (object) => (object.attributes.title ?? '').toLowerCase() === titleParam.toLowerCase()
        );
        if (matching.length === 1) navigate(appUrl(BASE, `/view/${encodeURIComponent(matching[0].id)}`), { replace: true });
        else navigate(`${BASE}#/list?filter=${encodeQueryValue(`"${titleParam}"`)}`, { replace: true });
      })
      .catch(() => services.toasts.warning('Unable to filter by title'));
  }, [titleParam]);

  return (
    <Listing
      key={filterParam}
      title="Dashboards"
      headingId="dashboardListingHeading"
      entity="dashboard"
      entities="dashboards"
      types={['dashboard']}
      fields={['title', 'type', 'description', 'updated_at']}
      searchFields={['title^3', 'type', 'description']}
      createLabel={'Create\u00a0Dashboard'}
      createTo={appUrl(BASE, '/create')}
      linkTo={(object) => appUrl(BASE, `/view/${encodeURIComponent(object.id)}`)}
      titleTestId={dashboardTitleTestId}
      editTo={(object) => appUrl(BASE, `/view/${encodeURIComponent(object.id)}`, { _a: { viewMode: 'edit' } })}
      typeColumn={DASHBOARD_TYPE_COLUMN}
      initialFilter={filterParam}
      deleteErrors={{ title: 'Error deleting dashboard', per: 'first' }}
      noItems={
        <ListingEmpty
          icon="dashboard"
          headingId="dashboardListingHeading"
          title="Create your first dashboard"
          actions={
            <Button variant="primary" icon="plus" to={appUrl(BASE, '/create')} testId="createDashboardPromptButton">
              Create new dashboard
            </Button>
          }
        >
          <p>
            You can combine data views from any OpenSearch Dashboards app into one dashboard and see everything in one place.
          </p>
          <p>
            New to OpenSearch Dashboards? <Link to="/app/import_sample_data">Install some sample data</Link> to take a test
            drive.
          </p>
        </ListingEmpty>
      }
    />
  );
}

const dashboardTitleTestId = (title: string) => `dashboardListingTitleLink-${title.split(' ').join('-')}`;

const DASHBOARD_TYPE_COLUMN: ListingColumn = { field: 'type', name: 'Type', value: () => 'Dashboard' };

/** The same objects for panels that did not change, so that what is drawn from them holds still */
function useStablePanels(panels: PanelState[]): PanelState[] {
  const known = useRef(new Map<string, { key: string; panel: PanelState }>());
  return useMemo(() => {
    const next = new Map<string, { key: string; panel: PanelState }>();
    const result = panels.map((panel) => {
      const key = JSON.stringify(panel);
      const previous = known.current.get(panel.panelIndex);
      const kept = previous && previous.key === key ? previous.panel : panel;
      next.set(panel.panelIndex, { key, panel: kept });
      return kept;
    });
    known.current = next;
    return result;
  }, [panels]);
}

/**
 * The panels as the original's grid leaves them, each as high up as those above allow, and the
 * order the dashboard then keeps them in: when the grid moved one, the grid's own (reading order
 * of the places it was given), else `order`.
 */
function settle(panels: PanelState[], order: string[]): { panels: PanelState[]; order: string[] } {
  const given = panels.map((panel) => panel.gridData);
  const layout = settleLayout(given);
  if (!layoutsDiffer(layout, given)) return { panels, order };
  return { panels: panels.map((panel, index) => ({ ...panel, gridData: layout[index] })), order: readingOrder(panels) };
}

function DashboardPage({ savedId }: { savedId?: string }) {
  const location = useLocation();
  const rawApp = location.hashParams._a;
  // The time range and refresh interval the address named when the page opened: a dashboard's
  // own give way to them, each on its own
  const cameWithGlobal = useRef(decodeState<{ time?: unknown; refreshInterval?: unknown }>(location.hashParams._g));
  // What the address had when the page opened, which the original takes over what was saved
  const cameWith = useRef(decodeState<UrlAppState>(location.hashParams._a));
  // The query and options as they last came to the original, the order of their keys kept
  const held = useRef<{ query?: Query; options?: DashboardOptions }>({});
  const [global, setGlobal] = useGlobalState();
  const [saved, setSaved] = useState<Dashboard | undefined>(savedId ? undefined : emptyDashboard());
  // What changed on the panels while the dashboard is looked at: a legend opened, a map moved
  const [viewPanels, setViewPanels] = useState<PanelState[]>();
  const [loadError, setLoadError] = useState<string>();
  const [objects, setObjects] = useState<Record<string, LoadedObject>>({});
  const [patterns, setPatterns] = useState<IndexPattern[]>([]);
  const [tick, setTick] = useState(0);
  const [dialog, setDialog] = useState<
    | { kind: 'save' | 'clone' | 'share' | 'add' | 'discard' | 'create' }
    | { kind: 'inspect' | 'rename' | 'replace'; panel: string }
  >();
  const [optionsOpen, setOptionsOpen] = useState(false);
  const panelData = useRef<Record<string, PanelData>>({});
  const lastToast = useRef<number>();

  const urlState = useMemo(() => decodeState<UrlAppState>(rawApp), [rawApp]);
  const editing = (urlState.viewMode ?? (savedId ? 'view' : 'edit')) === 'edit';
  const fullScreen = Boolean(urlState.fullScreenMode);
  const expanded = urlState.expandedPanelId;
  const defaultQuery = useMemo<Query>(() => ({ query: '', language: defaultQueryLanguage() }), []);
  const query: Query = useMemo(
    () => (urlState.query === undefined ? saved?.query ?? defaultQuery : dashboardQuery(urlState.query)),
    [urlState.query, saved?.query, defaultQuery]
  );
  const appFilters = useMemo(() => urlState.filters ?? saved?.filters ?? [], [urlState.filters, saved?.filters]);
  const filters = useMemo(() => [...global.filters, ...appFilters.filter((filter) => !isPinned(filter))], [global.filters, appFilters]);
  const options: DashboardOptions = urlState.options ?? saved?.options ?? {};
  const heldQuery = asHeld(query, held.current.query ?? (cameWith.current.query === undefined ? saved?.query ?? defaultQuery : undefined));
  const heldOptions = asHeld(options, held.current.options ?? (cameWith.current.options === undefined ? saved?.options : undefined));
  const title = urlState.title ?? saved?.title ?? '';
  // The dashboard as its panels name it to the editor they are sent to: its title, and the id of
  // its saved object, none while it is new
  const container = useMemo<ContainerInfo>(() => ({ containerName: title, containerId: savedId ?? '' }), [title, savedId]);
  const description = urlState.description ?? saved?.description ?? '';
  const timeRestore = urlState.timeRestore ?? saved?.timeRestore ?? false;

  // While the dashboard is edited its panels are in the address, as the original keeps them
  const urlPanelsKey = editing && urlState.panels !== undefined ? JSON.stringify(urlState.panels) : '';
  const urlPanels = useMemo(() => (urlPanelsKey ? panelsFromUrl(JSON.parse(urlPanelsKey)) : undefined), [urlPanelsKey]);
  const panels = useStablePanels(urlPanels ?? viewPanels ?? saved?.panels ?? NO_PANELS);
  const panelsNow = useRef(panels);
  panelsNow.current = panels;

  /** Changes the state in the address: each change a step back can undo, as in the original */
  const writeApp = useCallback(
    (changes: Partial<UrlAppState>, replace = false) => {
      const next: UrlAppState = { ...decodeState<UrlAppState>(getLocation().hashParams._a), ...changes };
      if ((next.viewMode ?? (savedId ? 'view' : 'edit')) === 'view') delete next.panels;
      setHashParams({ _a: encodeState(next) }, { replace });
    },
    [savedId]
  );
  /**
   * Changes the panels. A change that leaves them as they are is none, as in the original; else
   * they take the original's order, from `base`: the order its container holds them in.
   */
  const setPanels = useCallback(
    (next: PanelState[], base: string[] = panelsNow.current.map((panel) => panel.panelIndex), replace = false) => {
      if (samePanels(next, panelsNow.current)) return;
      const ordered = orderAsOriginal(next, base);
      if (editing) writeApp({ panels: panelsToUrl(ordered) }, replace);
      else setViewPanels(ordered);
    },
    [editing, writeApp]
  );
  const updatePanels = useCallback((change: (current: PanelState[]) => PanelState[]) => setPanels(change(panelsNow.current)), [setPanels]);

  const onSavedQueryChange = useCallback((change: SavedQueryChange) => {
    const { savedQuery: _previous, ...latest } = decodeState<UrlAppState>(getLocation().hashParams._a);
    const next: UrlAppState = { ...latest, query: change.query, filters: pageFiltersOf(change) };
    held.current.query = change.query;
    if (change.id) next.savedQuery = change.id;
    setHashParams({ _g: savedQueryGlobalParam(change), _a: encodeState(next) }, { replace: change.replace });
  }, []);

  // --- Loading ---
  useEffect(() => {
    if (!savedId) return undefined;
    let live = true;
    services.savedObjects
      .get<DashboardAttributes>('dashboard', savedId)
      .then((object) => {
        if (!live) return;
        const dashboard = dashboardFromSavedObject(object);
        setSaved(dashboard);
        addRecentlyAccessed(appUrl(BASE, `/view/${encodeURIComponent(savedId)}`), dashboard.title, savedId);
        // The dashboard's own time comes with it, unless the address named one: no step back
        const own = ownTime(dashboard, cameWithGlobal.current);
        if (own.time || own.refreshInterval) setHashParams({ _g: globalParamWith(own) }, { replace: true });
      })
      .catch((failure) => live && setLoadError(errorMessage(failure)));
    return () => {
      live = false;
    };
  }, [savedId]);

  // Once open, the address holds the dashboard's whole state, as the original writes it
  useEffect(() => {
    if (!saved) return;
    const raw = getLocation().hashParams._a;
    const full = encodeState(fullAppState(saved, decodeState<UrlAppState>(raw), panelsNow.current, defaultQuery));
    if (full !== raw) setHashParams({ _a: full }, { replace: true });
  }, [saved, rawApp, defaultQuery]);

  // A panel an editor hands back as it comes back, as the original's dashboard takes it when it
  // opens: the panel sent there, given what the editor gives it, or else a new one. It is taken
  // once, which a reload, keeping what the entry of the history carries, does not undo.
  useEffect(() => {
    if (!saved) return;
    const handed = handedPanel(locationState<unknown>());
    if (!handed) return;
    setLocationState(undefined);
    const current = panelsNow.current;
    const next = withHandedPanel(current, handed, newPanelIndex);
    if (!next) return;
    if (next.length === current.length) setPanels(next);
    else {
      const settled = settle(next, current.map((panel) => panel.panelIndex));
      setPanels(settled.panels, settled.order);
    }
  }, [saved, setPanels]);

  const panelKey = panels.map((panel) => `${panel.type}:${panel.id}`).join(',');
  useEffect(() => {
    const missing = [...new Set(panelKey.split(',').filter((key) => key && !(key in objects)))];
    if (missing.length === 0) return undefined;
    let live = true;
    const wanted = missing.map((key) => ({ type: key.slice(0, key.indexOf(':')), id: key.slice(key.indexOf(':') + 1) }));
    services.savedObjects
      .bulkGet(wanted)
      .then((found) => {
        if (!live) return;
        const next: Record<string, LoadedObject> = {};
        for (const object of found) {
          next[`${object.type}:${object.id}`] = object.error ? { error: object.error.message } : { object };
        }
        for (const key of missing) if (!(key in next)) next[key] = { error: 'Its saved object was not found' };
        setObjects((current) => ({ ...current, ...next }));
      })
      .catch((failure) => {
        if (!live) return;
        const next: Record<string, LoadedObject> = {};
        for (const key of missing) next[key] = { error: errorMessage(failure) };
        setObjects((current) => ({ ...current, ...next }));
      });
    return () => {
      live = false;
    };
  }, [panelKey, objects]);

  // The index patterns behind the panels: what the query bar suggests fields from
  const patternIds = useMemo(() => {
    const ids = new Set<string>();
    for (const loaded of Object.values(objects)) {
      const object = loaded.object as SavedObject<{ kibanaSavedObjectMeta?: { searchSourceJSON?: string } }> | undefined;
      if (!object) continue;
      const id = parseSearchSource(object.attributes.kibanaSavedObjectMeta?.searchSourceJSON, object.references).indexId;
      if (id) ids.add(id);
    }
    return [...ids].sort().join(',');
  }, [objects]);
  useEffect(() => {
    let live = true;
    const ids = patternIds ? patternIds.split(',') : [];
    Promise.allSettled(ids.map((id) => services.indexPatterns.get(id)))
      .then(async (results) => {
        const found = results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
        if (found.length > 0) return found;
        // As the original: with none behind the panels, as on a new dashboard, the bars work on
        // the default index pattern, and "Add filter" offers its fields
        const fallback = await services.indexPatterns.getDefault().catch(() => undefined);
        return fallback ? [fallback] : [];
      })
      .then((found) => {
        if (live) setPatterns(found);
      });
    return () => {
      live = false;
    };
  }, [patternIds]);

  // --- The page's state ---
  // Changed since saved, as the original counts it: the panels, the query and filters, and the
  // time when the dashboard keeps its own (its options are not counted)
  const dirty = useMemo(() => {
    if (!saved || !editing) return false;
    const timeChanged =
      saved.timeRestore && (global.time.from !== saved.timeFrom || global.time.to !== saved.timeTo);
    return (
      panelsDiffer(panels, saved.panels) ||
      !sameQuery(query, saved.query ?? defaultQuery) ||
      !sameState(appFilters.filter((filter) => !isPinned(filter)), saved.filters) ||
      Boolean(timeChanged)
    );
  }, [saved, editing, panels, query, appFilters, global.time, defaultQuery]);

  const trailTitle = savedId ? saved?.title ?? '' : 'New Dashboard';
  useBreadcrumbs([
    { text: 'Dashboards', to: appUrl(BASE, '/list') },
    { text: editing ? `Editing ${trailTitle}${dirty ? ' (unsaved)' : ''}` : trailTitle || 'Dashboard' },
  ]);

  useEffect(() => {
    if (!editing || !dirty) return undefined;
    setLeaveGuard(() => window.confirm('Leave this dashboard? Changes you made to it have not been saved.'));
    return () => setLeaveGuard(undefined);
  }, [editing, dirty]);

  useEffect(() => {
    setFullScreen(fullScreen);
    if (!fullScreen) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') writeApp({ fullScreenMode: false });
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      setFullScreen(false);
    };
  }, [fullScreen, writeApp]);

  const refresh = useCallback(() => setTick((count) => count + 1), []);
  useAutoRefresh(global.refreshInterval, refresh);

  const input = useMemo<VisInput>(() => ({ time: global.time, query, filters }), [global.time, query, filters]);
  // Each time the page asks for its data, the panels take their colours in reading order
  const turnOrder = readingOrder(panels).join('\n');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const turns = useMemo(() => makeTurns(turnOrder === '' ? [] : turnOrder.split('\n')), [turnOrder, input, tick]);

  const setFilters = useCallback(
    (next: Filter[]) => {
      const { pinned, app } = splitFilters(next);
      if (JSON.stringify(pinned) !== JSON.stringify(global.filters)) setGlobal({ filters: pinned });
      if (JSON.stringify(app) !== JSON.stringify(appFilters)) writeApp({ filters: app });
    },
    [global.filters, appFilters, setGlobal, writeApp]
  );
  // Added as the original's filter manager adds them: after the others, a filter that asks what
  // one there asks taking its place (or, for a pinned one, changing it where it is). A
  // visualization's filters are pinned when filters:pinnedByDefault asks; a saved search's stay
  // the dashboard's own, as the original's search embeddable marks them
  const addFilters = useCallback(
    (added: Filter[], asGiven = false) => {
      const pinned = !asGiven && services.uiSettings.get('filters:pinnedByDefault', false);
      const incoming = pinned ? added.map((filter) => ({ ...filter, $state: { store: 'globalState' as const } })) : added;
      setFilters(uniqueFilters([...filters, ...incoming]));
    },
    [filters, setFilters]
  );
  const setTime = useCallback((time: TimeRange) => setGlobal({ time }), [setGlobal]);

  // The grid hands its layout back in reading order of the places it had, and the container takes
  // the panels in that order
  const onLayoutChange = useCallback(
    (layout: GridItem[], settled?: boolean) => {
      const current = panelsNow.current;
      const next = current.map((panel) => {
        const item = layout.find((candidate) => candidate.i === panel.panelIndex);
        return item ? { ...panel, gridData: item } : panel;
      });
      setPanels(next, readingOrder(current), settled);
    },
    [setPanels]
  );
  const onConfig = useCallback(
    (panelIndex: string, config: Record<string, unknown>) => {
      updatePanels((current) => current.map((panel) => (panel.panelIndex === panelIndex ? { ...panel, embeddableConfig: config } : panel)));
    },
    [updatePanels]
  );
  const onData = useCallback((panelIndex: string, data: PanelData) => {
    panelData.current[panelIndex] = data;
  }, []);

  /** A message that a panel came, in place of the one before it, as the original's flyouts tell it */
  const toastAdded = useCallback((name: string) => {
    if (lastToast.current) services.toasts.dismiss(lastToast.current);
    lastToast.current = services.toasts.success(`${name} was added`);
  }, []);

  const clonePanel = useCallback(
    async (panelIndex: string) => {
      const panel = panelsNow.current.find((candidate) => candidate.panelIndex === panelIndex);
      const object = panel ? objects[`${panel.type}:${panel.id}`]?.object : undefined;
      if (!panel || !object) return;
      try {
        // The panel's object is copied, titled as a copy, and the copy goes beside the panel
        const objectTitle = String((object.attributes as { title?: string }).title ?? '');
        const similar = await services.savedObjects.find({
          type: panel.type,
          perPage: 0,
          fields: ['title'],
          searchFields: ['title'],
          search: `"${cloneBase(objectTitle)}"`,
        });
        const copy = await services.savedObjects.create(
          panel.type,
          { ...object.attributes, title: cloneTitle(objectTitle, similar.total) },
          { references: object.references }
        );
        const current = panelsNow.current;
        const { place, moved } = placeBeside(
          current.map((candidate) => candidate.gridData),
          panelIndex
        );
        const id = newPanelIndex();
        const added: PanelState = {
          panelIndex: id,
          gridData: { x: place.x, y: place.y, w: panel.gridData.w, h: panel.gridData.h, i: id },
          type: panel.type,
          id: copy.id,
          embeddableConfig: panel.embeddableConfig,
          ...(panel.title !== undefined ? { title: panel.title } : {}),
        };
        // The copy comes in place of a placeholder the grid packs with the others, and last
        const placed = [...current.map((candidate, index) => ({ ...candidate, gridData: moved[index] })), added];
        const settled = settle(placed, current.map((candidate) => candidate.panelIndex));
        setPanels(
          settled.panels,
          settled.order.filter((key) => key !== id)
        );
        services.toasts.success('Cloned panel');
      } catch (failure) {
        services.toasts.error(failure, 'The panel could not be cloned');
      }
    },
    [objects, setPanels]
  );

  const onAction = useCallback(
    (action: PanelAction, panelIndex: string) => {
      if (action === 'expand') writeApp({ expandedPanelId: expanded === panelIndex ? undefined : panelIndex });
      else if (action === 'remove') {
        const remaining = panelsNow.current.filter((panel) => panel.panelIndex !== panelIndex);
        const settled = settle(remaining, remaining.map((panel) => panel.panelIndex));
        setPanels(settled.panels, settled.order);
        if (expanded === panelIndex) writeApp({ expandedPanelId: undefined }, true);
      } else if (action === 'clone') void clonePanel(panelIndex);
      else setDialog({ kind: action, panel: panelIndex });
    },
    [writeApp, setPanels, expanded, clonePanel]
  );

  const addPanel = (object: FoundObject, name: string) => {
    const current = panelsNow.current;
    const panelIndex = newPanelIndex();
    const place = findPlace(current.map((panel) => panel.gridData));
    const added: PanelState = {
      panelIndex,
      gridData: { x: place.x, y: place.y, w: DEFAULT_PANEL.w, h: DEFAULT_PANEL.h, i: panelIndex },
      type: object.type,
      id: object.id,
      embeddableConfig: {},
    };
    const settled = settle([...current, added], current.map((panel) => panel.panelIndex));
    setPanels(settled.panels, settled.order);
    toastAdded(name);
  };

  const replacePanel = (panelIndex: string, object: FoundObject, name: string) => {
    const current = panelsNow.current;
    const old = current.find((panel) => panel.panelIndex === panelIndex);
    if (!old) return;
    // In the original's way: a new panel in the old one's place, after the others
    const id = newPanelIndex();
    const replacement: PanelState = { panelIndex: id, gridData: { ...old.gridData, i: id }, type: object.type, id: object.id, embeddableConfig: {} };
    setPanels([...current.filter((panel) => panel.panelIndex !== panelIndex), replacement]);
    toastAdded(name);
    setDialog(undefined);
  };

  const save = async (result: DashboardSaveResult): Promise<void> => {
    if (!saved) return;
    const dashboard: Dashboard = {
      ...saved,
      title: result.title,
      description: result.description,
      panels: panelsNow.current,
      options: heldOptions,
      query: heldQuery,
      filters: appFilters.filter((filter) => !isPinned(filter)),
      timeRestore: result.timeRestore,
      timeFrom: result.timeRestore ? global.time.from : undefined,
      timeTo: result.timeRestore ? global.time.to : undefined,
      refreshInterval: result.timeRestore ? global.refreshInterval : undefined,
    };
    const { attributes, references } = dashboardToSavedObject(dashboard);
    let object: SavedObject<DashboardAttributes>;
    try {
      object = await services.savedObjects.create<DashboardAttributes>('dashboard', attributes, {
        id: saved.id && !result.asNew ? saved.id : undefined,
        overwrite: true,
        references,
      });
    } catch (failure) {
      setDialog(undefined);
      services.toasts.danger(`Dashboard '${result.title}' was not saved. Error: ${errorMessage(failure)}`);
      return;
    }
    setDialog(undefined);
    setLeaveGuard(undefined);
    services.toasts.success(`Dashboard '${result.title}' was saved`);
    const shown: Partial<UrlAppState> = { title: result.title, description: result.description, timeRestore: result.timeRestore, viewMode: 'view' };
    if (object.id !== savedId) {
      const { panels: _panels, ...rest } = decodeState<UrlAppState>(getLocation().hashParams._a);
      navigate(
        appUrl(BASE, `/view/${encodeURIComponent(object.id)}`, { _g: currentGlobalParam(), _a: { ...rest, ...shown } }),
        { force: true }
      );
      return;
    }
    // What was saved, read back as a dashboard is read
    setSaved(dashboardFromSavedObject({ id: object.id, attributes, references, version: object.version }));
    setViewPanels(undefined);
    writeApp(shown);
  };

  const discard = () => {
    if (!saved) return;
    setDialog(undefined);
    setLeaveGuard(undefined);
    setViewPanels(undefined);
    held.current = { query: saved.query ?? defaultQuery, options: restoredOptions(saved.options) };
    // In place of the step being discarded, as the original writes it
    writeApp(
      {
        viewMode: 'view',
        panels: undefined,
        filters: saved.filters,
        query: held.current.query,
        options: held.current.options,
        timeRestore: saved.timeRestore,
      },
      true
    );
    const own = ownTime(saved);
    if (own.time) setGlobal(own);
  };

  // --- What is drawn ---
  if (loadError) {
    return (
      <div className="shlPage">
        <EmptyPrompt
          icon="warning"
          title="The dashboard could not be loaded"
          actions={
            <Button variant="primary" to={appUrl(BASE, '/list')}>
              Back to the dashboards
            </Button>
          }
        >
          {loadError}
        </EmptyPrompt>
      </div>
    );
  }
  if (!saved) return <Loading />;

  const navItems: TopNavItem[] = editing
    ? [
        {
          id: 'options',
          label: 'Options',
          onClick: () => setOptionsOpen((open) => !open),
          testId: 'dashboardOptionsButton',
          wrap: (button) => (
            <Popover open={optionsOpen} onClose={() => setOptionsOpen(false)} position="downCenter" className="dshOptionsPopover" button={button}>
              <OptionsMenu
                options={options}
                onChange={(next) => {
                  held.current.options = { ...heldOptions, ...next };
                  writeApp({ options: next });
                }}
              />
            </Popover>
          ),
        },
        { id: 'share', label: 'Share', onClick: () => setDialog({ kind: 'share' }), testId: 'shareTopNavButton' },
        { id: 'add', label: 'Add', onClick: () => setDialog({ kind: 'add' }), testId: 'dashboardAddPanelButton' },
        {
          id: 'cancel',
          label: 'Cancel',
          onClick: () => (dirty ? setDialog({ kind: 'discard' }) : writeApp({ viewMode: 'view' })),
          testId: 'dashboardViewOnlyMode',
        },
        { id: 'save', label: 'Save', onClick: () => setDialog({ kind: 'save' }), testId: 'dashboardSaveMenuItem' },
        {
          id: 'addNew',
          label: 'Create new',
          emphasize: true,
          icon: 'plus',
          onClick: () => setDialog({ kind: 'create' }),
          testId: 'dashboardAddNewPanelButton',
        },
      ]
    : [
        { id: 'fullScreen', label: 'Full screen', onClick: () => writeApp({ fullScreenMode: true }), testId: 'dashboardFullScreenMode' },
        { id: 'share', label: 'Share', onClick: () => setDialog({ kind: 'share' }), testId: 'shareTopNavButton' },
        { id: 'clone', label: 'Clone', onClick: () => setDialog({ kind: 'clone' }), testId: 'dashboardClone' },
        {
          id: 'edit',
          label: 'Edit',
          emphasize: true,
          icon: 'pencil',
          onClick: () => writeApp({ viewMode: 'edit', panels: panelsToUrl(panelsNow.current) }),
          testId: 'dashboardEditMode',
        },
      ];

  const layout = panels.map((panel) => panel.gridData);
  const panelOf = (panelIndex: string) => panels.find((panel) => panel.panelIndex === panelIndex);
  const objectTitleOf = (panel: PanelState | undefined) =>
    panel ? ((objects[`${panel.type}:${panel.id}`]?.object?.attributes as { title?: string } | undefined)?.title ?? '') : '';
  const inspected = dialog?.kind === 'inspect' ? panelOf(dialog.panel) : undefined;
  const renamed = dialog?.kind === 'rename' ? panelOf(dialog.panel) : undefined;
  const replaced = dialog?.kind === 'replace' ? panelOf(dialog.panel) : undefined;
  const bars = dashboardBars(location.hashParams, {
    headerShown: HEADER_SHOWN,
    fullScreen,
    hasFilters: appFilters.some((filter) => !isPinned(filter)),
  });

  return (
    <div className={`dshPage${fullScreen ? ' dshPage--fullScreen' : ''}`} data-test-subj="dashboardViewport">
      {bars.topMenu && (HEADER_SHOWN ? <TopNav items={navItems} /> : <InlineTopNav items={navItems} />)}
      {!bars.queryInput && !bars.datePicker ? (
        bars.filterBar && (
          // The filters alone, without the row of the query and the time, as the original's bar has them
          <div className="shlSearchBar" data-test-subj="globalQueryBar">
            <FilterBar filters={filters} onChange={setFilters} indexPatterns={patterns} />
          </div>
        )
      ) : (
        <SearchBar
          showQuery={bars.queryInput}
          showTime={bars.datePicker}
          showFilters={bars.filterBar}
          indexPatterns={patterns}
          query={query}
          onQuerySubmit={(next) => {
            held.current.query = next;
            writeApp({ query: next });
          }}
          filters={filters}
          onFiltersChange={setFilters}
          time={global.time}
          refreshInterval={global.refreshInterval}
          onTimeChange={setTime}
          onRefreshChange={(refreshInterval) => setGlobal({ refreshInterval })}
          onRefresh={refresh}
          savedQueryId={urlState.savedQuery}
          onSavedQueryChange={onSavedQueryChange}
        />
      )}
      {panels.length === 0 ? (
        <EmptyDashboard
          editing={editing}
          onAdd={() => setDialog({ kind: 'add' })}
          onCreate={() => setDialog({ kind: 'create' })}
          onEdit={() => writeApp({ viewMode: 'edit', panels: [] })}
        />
      ) : (
        <DashboardGrid
          layout={layout}
          useMargins={options.useMargins === true}
          editing={editing && !fullScreen}
          expanded={expanded && panelOf(expanded) ? expanded : undefined}
          onLayoutChange={onLayoutChange}
          renderPanel={(item, handlers) => {
            const panel = panelOf(item.i);
            if (!panel) return null;
            return (
              <DashboardPanel
                panel={panel}
                loaded={objects[`${panel.type}:${panel.id}`]}
                input={input}
                tick={tick}
                turn={turns.get(panel.panelIndex)}
                editing={editing && !fullScreen}
                hideTitle={options.hidePanelTitles === true}
                expanded={expanded === panel.panelIndex}
                container={container}
                dragging={handlers.dragging}
                onDragStart={handlers.onDragStart}
                onResizeStart={handlers.onResizeStart}
                onAction={onAction}
                onConfig={onConfig}
                onFilter={addFilters}
                onFiltersChange={setFilters}
                onTimeChange={setTime}
                onData={onData}
              />
            );
          }}
        />
      )}
      {fullScreen && <ExitFullScreen onExit={() => writeApp({ fullScreenMode: false })} />}

      {dialog?.kind === 'save' && (
        <DashboardSaveModal
          title={title}
          description={description}
          timeRestore={timeRestore}
          existing={Boolean(saved.id)}
          onSave={save}
          onClose={() => setDialog(undefined)}
        />
      )}
      {dialog?.kind === 'clone' && (
        <CloneModal
          title={`${title} Copy`}
          onClone={(newTitle) => save({ title: newTitle, description, asNew: true, timeRestore })}
          onClose={() => setDialog(undefined)}
        />
      )}
      {dialog?.kind === 'share' && (
        <ShareModal
          objectType="dashboard"
          savedUrl={saved.id ? `${window.location.origin}${href(appUrl(BASE, `/view/${encodeURIComponent(saved.id)}`))}` : undefined}
          onClose={() => setDialog(undefined)}
        />
      )}
      {dialog?.kind === 'create' && (
        // As the original's visualization factory opens it from a dashboard: the editor is told where
        // it came from, to go back there with what it saves
        <NewVisModal onClose={() => setDialog(undefined)} {...createNewState(container)} />
      )}
      {dialog?.kind === 'discard' && (
        <ConfirmModal
          title="Discard changes to dashboard?"
          confirmLabel="Discard changes"
          cancelLabel="Continue editing"
          focusCancel
          narrow
          onCancel={() => setDialog(undefined)}
          onConfirm={discard}
        >
          Once you discard your changes, there's no getting them back.
        </ConfirmModal>
      )}
      {dialog?.kind === 'add' && (
        <Flyout title="Add panels" onClose={() => setDialog(undefined)} testId="dashboardAddPanel" className="dshPanelFlyout" mask>
          <PanelFinder types={FINDER_TYPES} onChoose={addPanel}>
            <CreateNewMenu onCreate={() => setDialog({ kind: 'create' })} />
          </PanelFinder>
        </Flyout>
      )}
      {dialog?.kind === 'replace' && replaced && (
        <Flyout
          title={`Replace panel ${replaced.title ?? objectTitleOf(replaced)} with:`}
          onClose={() => setDialog(undefined)}
          testId="dashboardReplacePanel"
          className="dshPanelFlyout"
          mask
        >
          <PanelFinder types={FINDER_TYPES} onChoose={(object, name) => replacePanel(replaced.panelIndex, object, name)} />
        </Flyout>
      )}
      {renamed && (
        <CustomizePanelModal
          title={renamed.title}
          defaultTitle={objectTitleOf(renamed)}
          // The panel's own setting, or else the dashboard's, which the original's panels inherit
          hidden={(renamed.embeddableConfig.hidePanelTitles as boolean | undefined) ?? options.hidePanelTitles}
          onClose={() => setDialog(undefined)}
          onSave={(newTitle, hidden) => {
            updatePanels((current) =>
              current.map((panel) => {
                if (panel.panelIndex !== renamed.panelIndex) return panel;
                const { title: _title, ...rest } = panel;
                // Changed in its place among the panel's settings, or added after them, as the original does
                const config = { ...panel.embeddableConfig };
                if (hidden === undefined) delete config.hidePanelTitles;
                else config.hidePanelTitles = hidden;
                return { ...rest, embeddableConfig: config, ...(newTitle !== undefined ? { title: newTitle } : {}) };
              })
            );
            setDialog(undefined);
          }}
        />
      )}
      {inspected && (
        <Inspector
          title={inspected.title ?? objectTitleOf(inspected)}
          requests={panelData.current[inspected.panelIndex]?.requests ?? []}
          table={panelData.current[inspected.panelIndex]?.table}
          vega={panelData.current[inspected.panelIndex]?.vega}
          onClose={() => setDialog(undefined)}
        />
      )}
    </div>
  );
}

const NO_PANELS: PanelState[] = [];

/** The dashboard's menu in the page, where the original's goes when there is no header to hold it */
function InlineTopNav({ items }: { items: TopNavItem[] }) {
  return (
    <div className="dshTopNav" data-test-subj="top-nav">
      {items.map((item) => {
        const button = (
          <Button
            key={item.id}
            variant={item.emphasize ? 'default' : 'empty'}
            icon={item.icon}
            onClick={item.onClick}
            to={item.to}
            disabled={item.disabled}
            title={item.title}
            testId={item.testId ?? `topNav-${item.id}`}
          >
            {item.label}
          </Button>
        );
        return item.wrap ? <Fragment key={item.id}>{item.wrap(button)}</Fragment> : button;
      })}
    </div>
  );
}

/** The original's "Create new" of the "Add panels" flyout: a button and the kinds it creates */
function CreateNewMenu({ onCreate }: { onCreate: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      position="downRight"
      button={
        <Button variant="primary" icon="plus" onClick={() => setOpen(!open)} className="dshFinder__create" testId="createNew">
          Create new
        </Button>
      }
    >
      <ContextMenu
        small
        onDone={() => setOpen(false)}
        panels={[{ id: 'create', items: [{ label: 'Visualization', onClick: onCreate, testId: 'createNew-visualization' }] }]}
      />
    </Popover>
  );
}

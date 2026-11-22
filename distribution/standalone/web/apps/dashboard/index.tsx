/* SPDX-License-Identifier: Apache-2.0 */

/* Dashboards: the list of them, and one of them on screen, looked at or edited. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, EmptyPrompt, Loading } from '../../components/basic';
import { FormRow, Switch, TextField } from '../../components/form';
import { ConfirmModal, Flyout, Modal } from '../../components/overlay';
import type { TimeRange } from '../../lib/dates';
import { mergeFilters } from '../../lib/query';
import { parseSearchSource } from '../../lib/search_source';
import type { Filter, IndexPattern, Query } from '../../lib/types';
import { appUrl, decodeState, encodeState } from '../../lib/url';
import { getLocation, href, navigate, setHashParams, setLeaveGuard, useLocation } from '../../router';
import { services } from '../../services';
import { errorMessage } from '../../services/http';
import type { SavedObject } from '../../services/saved_objects';
import { TopNav, type TopNavItem } from '../../shell/chrome';
import { isPinned, splitFilters } from '../../shell/filter_bar';
import { Inspector } from '../../shell/inspect';
import { Listing } from '../../shell/listing';
import { defaultQueryLanguage } from '../../shell/query_bar';
import { SaveModal, SavedObjectFinder, ShareModal } from '../../shell/saved_objects_ui';
import { pageFiltersOf, savedQueryGlobalParam, type SavedQueryChange } from '../../shell/saved_query';
import { SearchBar } from '../../shell/search_bar';
import { addRecentlyAccessed, currentGlobalParam, setFullScreen, useAutoRefresh, useBreadcrumbs, useGlobalState } from '../../shell/state';
import type { VisInput } from '../../vis/request';
import { makeTurns } from '../../vis/turns';
import { DashboardGrid } from './grid';
import {
  DEFAULT_PANEL,
  compact,
  dashboardFromSavedObject,
  dashboardToSavedObject,
  emptyDashboard,
  findPlace,
  nextPanelIndex,
  type Dashboard,
  type DashboardAttributes,
  type GridItem,
  type PanelState,
} from './model';
import { DashboardPanel, type LoadedObject, type PanelData } from './panel';
import '../../styles/dashboard.css';

const BASE = '/app/dashboards';

interface UrlAppState {
  query?: Query;
  filters?: Filter[];
  viewMode?: 'view' | 'edit';
  fullScreenMode?: boolean;
  /** The id of the saved query loaded into the search bar */
  savedQuery?: string;
}

const FINDER_TYPES = [
  { type: 'visualization', name: 'Visualization', icon: 'visualize' as const },
  { type: 'search', name: 'Saved search', icon: 'discover' as const },
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
  return (
    <Listing
      title="Dashboards"
      entity="dashboard"
      entities="dashboards"
      types={['dashboard']}
      createLabel="Create dashboard"
      createTo={appUrl(BASE, '/create')}
      linkTo={(object) => appUrl(BASE, `/view/${encodeURIComponent(object.id)}`)}
      editTo={(object) => appUrl(BASE, `/view/${encodeURIComponent(object.id)}`, { _a: { viewMode: 'edit' } })}
      emptyBody="You can combine data views from any OpenSearch Dashboards app into one dashboard and see everything in one place."
      testId="dashboardLandingPage"
    />
  );
}

function DashboardPage({ savedId }: { savedId?: string }) {
  const location = useLocation();
  // Whether the address named a time range when the page opened: a dashboard's own gives way to it
  const cameWithTime = useRef(location.hashParams._g !== undefined);
  const [global, setGlobal] = useGlobalState();
  const [saved, setSaved] = useState<Dashboard | undefined>(savedId ? undefined : emptyDashboard());
  const [draft, setDraft] = useState<Dashboard>(emptyDashboard());
  const [loadError, setLoadError] = useState<string>();
  const [objects, setObjects] = useState<Record<string, LoadedObject>>({});
  const [patterns, setPatterns] = useState<IndexPattern[]>([]);
  const [tick, setTick] = useState(0);
  const [expanded, setExpanded] = useState<string>();
  const [dialog, setDialog] = useState<
    | { kind: 'save' | 'clone' | 'share' | 'add' | 'options' | 'discard' }
    | { kind: 'inspect' | 'rename' | 'replace'; panel: string }
  >();
  const [storeTime, setStoreTime] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const panelData = useRef<Record<string, PanelData>>({});

  const urlState = useMemo(() => decodeState<UrlAppState>(location.hashParams._a), [location.hashParams._a]);
  const editing = (urlState.viewMode ?? (savedId ? 'view' : 'edit')) === 'edit';
  const fullScreen = Boolean(urlState.fullScreenMode);
  const query: Query = useMemo(
    () => urlState.query ?? saved?.query ?? { query: '', language: defaultQueryLanguage() },
    [urlState.query, saved?.query]
  );
  const appFilters = useMemo(() => urlState.filters ?? saved?.filters ?? [], [urlState.filters, saved?.filters]);
  const filters = useMemo(() => [...global.filters, ...appFilters.filter((filter) => !isPinned(filter))], [global.filters, appFilters]);

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
        setDraft(dashboard);
        setStoreTime(dashboard.timeRestore);
        addRecentlyAccessed(appUrl(BASE, `/view/${encodeURIComponent(savedId)}`), dashboard.title, savedId);
        if (dashboard.timeRestore && !cameWithTime.current && dashboard.timeFrom && dashboard.timeTo) {
          setGlobal({
            time: { from: dashboard.timeFrom, to: dashboard.timeTo },
            ...(dashboard.refreshInterval ? { refreshInterval: dashboard.refreshInterval } : {}),
          });
        }
      })
      .catch((failure) => live && setLoadError(errorMessage(failure)));
    return () => {
      live = false;
    };
  }, [savedId, setGlobal]);

  const panelKey = draft.panels.map((panel) => `${panel.type}:${panel.id}`).join(',');
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
    Promise.allSettled(ids.map((id) => services.indexPatterns.get(id))).then((results) => {
      if (!live) return;
      setPatterns(results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : [])));
    });
    return () => {
      live = false;
    };
  }, [patternIds]);

  // --- The page's state ---
  const title = saved?.title ?? '';
  useBreadcrumbs([
    { text: 'Dashboards', to: appUrl(BASE, '/list') },
    { text: !savedId ? 'New Dashboard' : editing ? `Editing ${title}` : title || 'Dashboard' },
  ]);

  const dirty = useMemo(() => {
    if (!saved) return false;
    return (
      JSON.stringify(draft.panels) !== JSON.stringify(saved.panels) || JSON.stringify(draft.options) !== JSON.stringify(saved.options)
    );
  }, [draft, saved]);
  useEffect(() => {
    if (!editing || !dirty) return undefined;
    setLeaveGuard(() => window.confirm('Leave this dashboard? Changes you made to it have not been saved.'));
    return () => setLeaveGuard(undefined);
  }, [editing, dirty]);

  useEffect(() => {
    setFullScreen(fullScreen);
    if (!fullScreen) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') writeApp({ fullScreenMode: false }, true);
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
  const readingOrder = [...draft.panels]
    .sort((a, b) => a.gridData.y - b.gridData.y || a.gridData.x - b.gridData.x)
    .map((panel) => panel.panelIndex)
    .join('\n');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const turns = useMemo(() => makeTurns(readingOrder === '' ? [] : readingOrder.split('\n')), [readingOrder, input, tick]);

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

  const updatePanels = useCallback((change: (panels: PanelState[]) => PanelState[]) => {
    setDraft((current) => ({ ...current, panels: change(current.panels) }));
  }, []);
  const onLayoutChange = useCallback(
    (layout: GridItem[]) => {
      updatePanels((panels) =>
        panels.map((panel) => {
          const item = layout.find((candidate) => candidate.i === panel.panelIndex);
          return item ? { ...panel, gridData: item } : panel;
        })
      );
    },
    [updatePanels]
  );
  const onConfig = useCallback(
    (panelIndex: string, config: Record<string, unknown>) => {
      updatePanels((panels) => panels.map((panel) => (panel.panelIndex === panelIndex ? { ...panel, embeddableConfig: config } : panel)));
    },
    [updatePanels]
  );
  const onData = useCallback((panelIndex: string, data: PanelData) => {
    panelData.current[panelIndex] = data;
  }, []);
  const onAction = useCallback(
    (action: 'expand' | 'inspect' | 'remove' | 'replace' | 'rename', panelIndex: string) => {
      if (action === 'expand') setExpanded((current) => (current === panelIndex ? undefined : panelIndex));
      else if (action === 'remove') {
        updatePanels((panels) => {
          const kept = panels.filter((panel) => panel.panelIndex !== panelIndex);
          const layout = compact(kept.map((panel) => panel.gridData));
          return kept.map((panel, index) => ({ ...panel, gridData: layout[index] }));
        });
        setExpanded(undefined);
      } else {
        if (action === 'rename') {
          const panel = draft.panels.find((candidate) => candidate.panelIndex === panelIndex);
          const loaded = panel ? objects[`${panel.type}:${panel.id}`] : undefined;
          setDraftTitle(panel?.title ?? (loaded?.object?.attributes as { title?: string } | undefined)?.title ?? '');
        }
        setDialog({ kind: action, panel: panelIndex });
      }
    },
    [updatePanels, draft.panels, objects]
  );

  const addPanel = (object: SavedObject<{ title: string }>) => {
    updatePanels((panels) => {
      const panelIndex = nextPanelIndex(panels);
      const place = findPlace(panels.map((panel) => panel.gridData));
      return [
        ...panels,
        { panelIndex, type: object.type, id: object.id, embeddableConfig: {}, gridData: { i: panelIndex, ...place, ...DEFAULT_PANEL } },
      ];
    });
    services.toasts.success(`${object.attributes.title || 'The panel'} was added`);
  };

  const save = async ({ title: newTitle, description, asNew }: { title: string; description: string; asNew: boolean }) => {
    const dashboard: Dashboard = {
      ...draft,
      title: newTitle,
      description,
      query,
      filters: appFilters.filter((filter) => !isPinned(filter)),
      timeRestore: storeTime,
      timeFrom: storeTime ? global.time.from : undefined,
      timeTo: storeTime ? global.time.to : undefined,
      refreshInterval: storeTime ? global.refreshInterval : undefined,
    };
    const { attributes, references } = dashboardToSavedObject(dashboard);
    const object =
      saved?.id && !asNew
        ? await services.savedObjects.update('dashboard', saved.id, attributes, { references })
        : await services.savedObjects.create('dashboard', attributes, { references });
    const stored = { ...dashboard, id: object.id, version: object.version };
    setSaved(stored);
    setDraft(stored);
    setDialog(undefined);
    services.toasts.success(`Dashboard “${newTitle}” was saved`);
    setLeaveGuard(undefined);
    if (object.id !== savedId) {
      navigate(appUrl(BASE, `/view/${encodeURIComponent(object.id)}`, { _g: currentGlobalParam() }), { force: true });
    } else writeApp({ viewMode: 'view' });
  };

  const clone = async () => {
    if (!saved) return;
    const { attributes, references } = dashboardToSavedObject({ ...saved, title: draftTitle.trim() || `${saved.title} Copy` });
    try {
      const object = await services.savedObjects.create('dashboard', attributes, { references });
      setDialog(undefined);
      services.toasts.success(`Dashboard “${attributes.title}” was created`);
      navigate(appUrl(BASE, `/view/${encodeURIComponent(object.id)}`, { _g: currentGlobalParam() }));
    } catch (failure) {
      services.toasts.error(failure, 'The dashboard could not be cloned');
    }
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
        { id: 'save', label: 'Save', emphasize: true, icon: 'save', onClick: () => setDialog({ kind: 'save' }), testId: 'dashboardSaveMenuItem' },
        {
          id: 'cancel',
          label: 'Cancel',
          onClick: () => {
            if (dirty) setDialog({ kind: 'discard' });
            else if (savedId) writeApp({ viewMode: 'view' });
            else navigate(appUrl(BASE, '/list'));
          },
          testId: 'dashboardViewOnlyMode',
        },
        { id: 'add', label: 'Add', onClick: () => setDialog({ kind: 'add' }), testId: 'dashboardAddPanelButton' },
        { id: 'options', label: 'Options', onClick: () => setDialog({ kind: 'options' }), testId: 'dashboardOptionsButton' },
        { id: 'share', label: 'Share', onClick: () => setDialog({ kind: 'share' }), testId: 'shareTopNavButton' },
      ]
    : [
        { id: 'fullScreen', label: 'Full screen', onClick: () => writeApp({ fullScreenMode: true }), testId: 'dashboardFullScreenMode' },
        { id: 'share', label: 'Share', onClick: () => setDialog({ kind: 'share' }), testId: 'shareTopNavButton' },
        {
          id: 'clone',
          label: 'Clone',
          onClick: () => {
            setDraftTitle(`${saved.title} Copy`);
            setDialog({ kind: 'clone' });
          },
          testId: 'dashboardClone',
        },
        { id: 'edit', label: 'Edit', emphasize: true, icon: 'pencil', onClick: () => writeApp({ viewMode: 'edit' }), testId: 'dashboardEditMode' },
      ];

  const layout = draft.panels.map((panel) => panel.gridData);
  const inspected = dialog?.kind === 'inspect' ? draft.panels.find((panel) => panel.panelIndex === dialog.panel) : undefined;
  const inspectedTitle = inspected
    ? (inspected.title ?? (objects[`${inspected.type}:${inspected.id}`]?.object?.attributes as { title?: string } | undefined)?.title ?? '')
    : '';

  return (
    <div className={`dshPage${fullScreen ? ' dshPage--fullScreen' : ''}`} data-test-subj="dashboardViewport">
      {!fullScreen && <TopNav items={navItems} />}
      {!fullScreen && (
        <SearchBar
          indexPatterns={patterns}
          query={query}
          onQuerySubmit={(next) => writeApp({ query: next })}
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
      {draft.panels.length === 0 ? (
        <div className="dshEmpty">
          <EmptyPrompt
            icon="dashboard"
            title="This dashboard is empty. Let’s fill it up!"
            actions={
              editing ? (
                <div className="atlRow">
                  <Button variant="primary" icon="plus" onClick={() => setDialog({ kind: 'add' })} testId="emptyDashboardAddPanelButton">
                    Add an existing object
                  </Button>
                  <Button to="/app/visualize#/create">Create new</Button>
                </div>
              ) : (
                <Button variant="primary" icon="pencil" onClick={() => writeApp({ viewMode: 'edit' })}>
                  Edit dashboard
                </Button>
              )
            }
          >
            {editing
              ? 'Add a visualization or a saved search you already have, or create a new visualization.'
              : 'Edit the dashboard to add panels to it.'}
          </EmptyPrompt>
        </div>
      ) : (
        <DashboardGrid
          layout={layout}
          useMargins={draft.options.useMargins}
          editing={editing && !fullScreen}
          expanded={expanded}
          onLayoutChange={onLayoutChange}
          renderPanel={(item, handlers) => {
            const panel = draft.panels.find((candidate) => candidate.panelIndex === item.i);
            if (!panel) return null;
            return (
              <DashboardPanel
                panel={panel}
                loaded={objects[`${panel.type}:${panel.id}`]}
                input={input}
                tick={tick}
                turn={turns.get(panel.panelIndex)}
                editing={editing && !fullScreen}
                hideTitle={draft.options.hidePanelTitles}
                expanded={expanded === panel.panelIndex}
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
      {fullScreen && (
        <Button className="dshExitFullScreen" icon="collapse" onClick={() => writeApp({ fullScreenMode: false }, true)} testId="exitFullScreenModeText">
          Exit full screen
        </Button>
      )}

      {dialog?.kind === 'save' && (
        <SaveModal
          objectType="dashboard"
          title={saved.title}
          description={saved.description}
          showDescription
          existing={Boolean(saved.id)}
          onSave={save}
          onClose={() => setDialog(undefined)}
        >
          <Switch
            checked={storeTime}
            onChange={setStoreTime}
            label="Store time with dashboard"
            testId="storeTimeWithDashboard"
          />
          <p className="atlSubdued atlSmall">This changes the time filter to the currently selected time each time this dashboard is loaded.</p>
        </SaveModal>
      )}
      {dialog?.kind === 'clone' && (
        <Modal
          title="Clone dashboard"
          onClose={() => setDialog(undefined)}
          footer={
            <>
              <Button variant="empty" onClick={() => setDialog(undefined)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={clone} testId="cloneConfirmButton">
                Confirm clone
              </Button>
            </>
          }
        >
          <FormRow label="Enter a new name for your dashboard" full>
            <TextField value={draftTitle} onChange={setDraftTitle} testId="clonedDashboardTitle" />
          </FormRow>
        </Modal>
      )}
      {dialog?.kind === 'share' && (
        <ShareModal
          objectType="dashboard"
          savedUrl={saved.id ? `${window.location.origin}${href(appUrl(BASE, `/view/${encodeURIComponent(saved.id)}`))}` : undefined}
          onClose={() => setDialog(undefined)}
        />
      )}
      {dialog?.kind === 'options' && (
        <Modal
          title="Options"
          onClose={() => setDialog(undefined)}
          footer={
            <Button variant="primary" onClick={() => setDialog(undefined)}>
              Done
            </Button>
          }
        >
          <div className="atlStack">
            <Switch
              checked={draft.options.useMargins}
              onChange={(useMargins) => setDraft((current) => ({ ...current, options: { ...current.options, useMargins } }))}
              label="Use margins between panels"
              testId="dashboardMarginsCheckbox"
            />
            <Switch
              checked={!draft.options.hidePanelTitles}
              onChange={(show) => setDraft((current) => ({ ...current, options: { ...current.options, hidePanelTitles: !show } }))}
              label="Show panel titles"
              testId="dashboardPanelTitlesCheckbox"
            />
          </div>
        </Modal>
      )}
      {dialog?.kind === 'discard' && (
        <ConfirmModal
          title="Discard changes to dashboard?"
          confirmLabel="Discard changes"
          cancelLabel="Continue editing"
          danger
          onCancel={() => setDialog(undefined)}
          onConfirm={() => {
            setDraft(saved);
            setDialog(undefined);
            setLeaveGuard(undefined);
            if (savedId) writeApp({ viewMode: 'view' });
            else navigate(appUrl(BASE, '/list'), { force: true });
          }}
        >
          Once you discard your changes, there's no getting them back.
        </ConfirmModal>
      )}
      {(dialog?.kind === 'add' || dialog?.kind === 'replace') && (
        <Flyout
          title={dialog.kind === 'add' ? 'Add panels' : 'Replace panel'}
          onClose={() => setDialog(undefined)}
          testId="dashboardAddPanel"
          footer={
            <Button to="/app/visualize#/create" icon="plus">
              Create new
            </Button>
          }
        >
          <SavedObjectFinder
            types={FINDER_TYPES}
            onChoose={(object) => {
              if (dialog.kind === 'add') addPanel(object);
              else if (dialog.kind === 'replace') {
                const replaced = dialog.panel;
                updatePanels((panels) =>
                  panels.map((panel) =>
                    panel.panelIndex === replaced ? { ...panel, type: object.type, id: object.id, title: undefined, embeddableConfig: {} } : panel
                  )
                );
                setDialog(undefined);
              }
            }}
          />
        </Flyout>
      )}
      {dialog?.kind === 'rename' && (
        <Modal
          title="Customize panel"
          onClose={() => setDialog(undefined)}
          footer={
            <>
              <Button
                variant="empty"
                onClick={() => {
                  updatePanels((panels) => panels.map((panel) => (panel.panelIndex === dialog.panel ? { ...panel, title: undefined } : panel)));
                  setDialog(undefined);
                }}
              >
                Reset
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  updatePanels((panels) => panels.map((panel) => (panel.panelIndex === dialog.panel ? { ...panel, title: draftTitle } : panel)));
                  setDialog(undefined);
                }}
                testId="saveNewTitleButton"
              >
                Save
              </Button>
            </>
          }
        >
          <FormRow label="Panel title" full>
            <TextField value={draftTitle} onChange={setDraftTitle} testId="customEmbeddablePanelTitleInput" />
          </FormRow>
        </Modal>
      )}
      {inspected && (
        <Inspector
          title={inspectedTitle}
          requests={panelData.current[inspected.panelIndex]?.requests ?? []}
          table={panelData.current[inspected.panelIndex]?.table}
          onClose={() => setDialog(undefined)}
        />
      )}
    </div>
  );
}


/* SPDX-License-Identifier: Apache-2.0 */

/* One panel of a dashboard: its title, its menu, and the visualization or saved search in it. */

import { memo, useCallback, useEffect, useId, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { ChartMessage } from '../../charts/core';
import { Badge, cx } from '../../components/basic';
import { Icon } from '../../components/icon';
import { Tooltip, type ContextMenuItem } from '../../components/overlay';
import type { AggContext, Table } from '../../lib/aggs';
import { resolveTimeRange, type TimeRange } from '../../lib/dates';
import type { RawHit } from '../../lib/docs';
import { existsFilter } from '../../lib/query';
import { parseSearchSource } from '../../lib/search_source';
import type { Filter, IndexPattern, Query } from '../../lib/types';
import { visFromSavedObject, visType, type UiState, type Vis, type VisualizationAttributes } from '../../lib/vis';
import { services } from '../../services';
import { errorMessage } from '../../services/http';
import type { SavedObject } from '../../services/saved_objects';
import { searchFailure, totalOf, type RequestRecord } from '../../services/search';
import { isPinned } from '../../shell/filter_bar';
import type { VisInput } from '../../vis/request';
import type { VisFailure } from '../../vis/types';
import type { Turn } from '../../vis/turns';
import type { VegaDebugValues } from '../../vis/vega/debug_view';
import { Visualization, takesTurn } from '../../vis/visualization';
import { DocTable, toggledColumns, type SortPair } from '../discover/doc_table';
import {
  VIS_BUILDER_TYPE,
  schemaProblem,
  visBuilderEditUrl,
  visBuilderFromSavedObject,
  visFromVisBuilder,
  type VisBuilderAttributes,
} from '../vis_builder/model';
import { DocDetails } from '../discover/doc_viewer';
import { valueFilter } from '../discover/filters';
import { buildDiscoverRequest } from '../discover/search';
import { normalizeSort } from '../discover/sort';
import {
  editorStateFor,
  existingFilter,
  offersInspector,
  panelTitle,
  panelTitleHidden,
  takenAgain,
  type ContainerInfo,
  type PanelState,
} from './model';
import { EDIT_NAMES, PanelMenu, type PanelAction } from './panel_menu';
import { PanelTitle } from './panel_title';

export interface LoadedObject {
  object?: SavedObject<Record<string, unknown>>;
  error?: string;
}

export interface PanelData {
  requests: RequestRecord[];
  table?: Table;
  context?: AggContext;
  vega?: VegaDebugValues;
}

interface SearchAttributes {
  title?: string;
  columns?: string[];
  sort?: unknown;
  kibanaSavedObjectMeta?: { searchSourceJSON?: string };
}

/**
 * A saved search on a dashboard, as the original's search embeddable: its table pages by 50 rows
 * with a pager above and below it. The table is drawn anew once each search has finished (and
 * whenever its columns change), so a new search starts again on the first page; a search that
 * fails keeps the rows of the last one, or an empty table if there was none.
 */
function SearchPanel({
  object,
  input,
  tick,
  config,
  onConfig,
  onFilter,
  onData,
  onError,
}: {
  object: SavedObject<SearchAttributes>;
  input: VisInput;
  tick: number;
  /** What was changed on the panel: its own columns and sort, over the saved search's */
  config: Record<string, unknown>;
  onConfig?: (config: Record<string, unknown>) => void;
  /** Takes the filters its buttons make, which go into the dashboard's own filters */
  onFilter?: (filters: Filter[]) => void;
  onData?: (data: PanelData) => void;
  /** Takes a failed search, and nothing once one succeeds: the panel's "Error" badge */
  onError?: (failure: VisFailure | undefined) => void;
}) {
  const source = useMemo(
    () => parseSearchSource(object.attributes.kibanaSavedObjectMeta?.searchSourceJSON, object.references),
    [object]
  );
  const [indexPattern, setIndexPattern] = useState<IndexPattern>();
  // What the last search that finished found: its rows and how many matched (unknown until one
  // succeeds), and how many searches have finished, which draws the table anew
  const [found, setFound] = useState<{ rows: RawHit[]; hits?: number; done: number }>();
  const [error, setError] = useState<string>();
  const reportError = useRef(onError);
  reportError.current = onError;
  const configColumns = Array.isArray(config.columns) ? (config.columns as string[]) : undefined;
  const columns = useMemo(() => {
    const chosen = configColumns ?? object.attributes.columns;
    return chosen?.length ? chosen : ['_source'];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(configColumns), object.attributes.columns]);
  const sort = useMemo(
    () => normalizeSort(config.sort ?? object.attributes.sort),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(config.sort), object.attributes.sort]
  );
  // Into the panel's own config, the keys in the order the original's embeddable writes them
  const write = (changes: { sort?: SortPair[]; columns?: string[] }) => onConfig?.({ ...config, ...changes });
  // As the original's: what is left, or the whole document when nothing is, and no sort on it
  const removeColumn = (name: string) => {
    const kept = columns.filter((column) => column !== name);
    write({ sort: sort.filter(([field]) => field !== name), columns: kept.length > 0 ? kept : ['_source'] });
  };

  useEffect(() => {
    let live = true;
    if (!source.indexId) {
      setError('This saved search names no index pattern');
      return undefined;
    }
    services.indexPatterns
      .get(source.indexId)
      .then((pattern) => live && setIndexPattern(pattern))
      .catch((failure) => live && setError(errorMessage(failure)));
    return () => {
      live = false;
    };
  }, [source.indexId]);

  const key = JSON.stringify([input, sort]);
  useEffect(() => {
    if (!indexPattern) return undefined;
    const controller = new AbortController();
    const queries = [input.query, source.query].filter((query): query is Query => Boolean(query));
    // A failed search keeps the rows shown last, and the panel says it failed, as the original
    const fail = (failure: unknown) => {
      const original = searchFailure(failure instanceof Error ? failure : new Error(String(failure)));
      setFound((last) => ({ rows: last?.rows ?? [], hits: last?.hits, done: (last?.done ?? 0) + 1 }));
      reportError.current?.({ message: original.message, original });
    };
    let body: Record<string, unknown>;
    try {
      body = buildDiscoverRequest({
        indexPattern,
        query: queries,
        filters: [...input.filters, ...source.filters],
        range: indexPattern.timeFieldName ? resolveTimeRange(input.time, { weekStart: services.weekStart() }) : undefined,
        sort,
        size: services.uiSettings.get<number>('discover:sampleSize', 500),
        documentsOnly: true,
      });
    } catch (failure) {
      fail(failure);
      return undefined;
    }
    const record: RequestRecord = {
      name: 'Data',
      index: indexPattern.title,
      indexPatternId: indexPattern.id,
      description: 'This request queries OpenSearch to fetch the data for the search.',
      body,
      startedAt: Date.now(),
    };
    services.search
      .search(indexPattern.title, body, { signal: controller.signal, record })
      .then((response) => {
        setFound((last) => ({ rows: response.hits.hits as RawHit[], hits: totalOf(response), done: (last?.done ?? 0) + 1 }));
        setError(undefined);
        reportError.current?.(undefined);
        onData?.({ requests: [record] });
      })
      .catch((failure) => {
        if ((failure as Error).name === 'AbortError') return;
        onData?.({ requests: [record] });
        fail(failure);
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indexPattern, key, tick]);

  if (error) {
    return (
      <div className="visError" role="alert">
        <strong>This saved search could not be loaded</strong>
        <span>{error}</span>
      </div>
    );
  }
  // Nothing is drawn until the first search has finished
  if (!indexPattern || !found) return null;
  if (found.hits === 0) return <ChartMessage>No results found</ChartMessage>;
  // The field as the index pattern has it, as the original's generateFilters takes it
  const fieldOf = (name: string) => indexPattern.fields.find((candidate) => candidate.name === name) ?? { name };
  const ownFilters = input.filters.filter((filter) => !isPinned(filter));
  // As the original's search embeddable: a filter for each value of a list, in the dashboard's
  // own filters; one the dashboard has for that value is taken again, turned on, as asked
  const filterFor = onFilter
    ? (name: string, value: unknown, negate: boolean) => {
        const values = Array.isArray(value) ? value : [value];
        onFilter(
          values.map((item) => {
            const existing = existingFilter(ownFilters, name, item, false);
            return existing ? takenAgain(existing, negate) : valueFilter(fieldOf(name), item, negate, indexPattern.id, false);
          })
        );
      }
    : undefined;
  const filterExists = onFilter
    ? (name: string) => {
        const existing = existingFilter(ownFilters, name, name, true);
        onFilter([existing ? takenAgain(existing, false) : existsFilter(fieldOf(name), indexPattern.id)]);
      }
    : undefined;
  return (
    <div className="dshSearch" data-test-subj="embeddedSavedSearchDocTable">
      <DocTable
        key={`${found.done}:${columns.join(',')}`}
        rows={found.rows}
        indexPattern={indexPattern}
        columns={columns}
        sort={sort}
        paged
        hits={found.hits}
        onSort={(next) => write({ sort: next })}
        onRemoveColumn={removeColumn}
        onMoveColumn={(name, by) => {
          const from = columns.indexOf(name);
          const to = from + by;
          if (from === -1 || to < 0 || to >= columns.length) return;
          const next = [...columns];
          next.splice(from, 1);
          next.splice(to, 0, name);
          write({ columns: next });
        }}
        onFilter={filterFor}
        details={(hit, drawn) => (
          <DocDetails
            hit={hit}
            indexPattern={indexPattern}
            basePath="/app/discover"
            appFilters={ownFilters}
            actions={{
              columns: drawn,
              // As the original's: a column drawn is taken out (the time column the table adds of
              // itself stays, and its sort goes), another is added
              onToggleColumn: (name) => (drawn.includes(name) ? removeColumn(name) : write({ columns: toggledColumns(columns, name) })),
              onFilter: filterFor,
              onFilterExists: filterExists,
            }}
          />
        )}
      />
    </div>
  );
}

export interface DashboardPanelProps {
  panel: PanelState;
  loaded?: LoadedObject;
  input: VisInput;
  tick: number;
  editing: boolean;
  hideTitle: boolean;
  expanded: boolean;
  /** The dashboard, as "Edit visualization" names it to the editor, which comes back to it */
  container: ContainerInfo;
  dragging?: boolean;
  onDragStart?: (event: ReactPointerEvent, panelIndex: string) => void;
  onResizeStart?: (event: ReactPointerEvent, panelIndex: string) => void;
  onAction: (action: PanelAction, panelIndex: string) => void;
  onConfig: (panelIndex: string, config: Record<string, unknown>) => void;
  /** `asGiven` for a saved search's filters, which stay in the dashboard's own filters */
  onFilter: (filters: Filter[], asGiven?: boolean) => void;
  onFiltersChange: (filters: Filter[]) => void;
  onTimeChange: (range: TimeRange) => void;
  onData: (panelIndex: string, data: PanelData) => void;
  /** The panel's place in the order the charts of the page take their colours */
  turn?: Turn;
}

const TYPE_NAMES: Record<string, string> = {
  map: 'Maps',
  'observability-visualization': 'Observability visualizations',
};

const ADVANCED_SETTINGS_DOCS = 'https://opensearch.org/docs/latest/dashboards/management/advanced-settings/';

/** Whether visualizations of the kinds still being tried out are drawn: the original's setting */
const labsEnabled = () => services.uiSettings.get<boolean>('visualize:enableLabs', true) !== false;

/**
 * What the original draws in place of a visualization of a kind still being tried out (input
 * controls) while those are turned off. Its title is left as plain text, as the original leaves it.
 */
function DisabledLabVisualization({ title }: { title: string }) {
  return (
    <div className="dshLabDisabled">
      <div className="dshLabDisabled__prompt" data-test-subj="visDisabledLabVisualization">
        <Icon name="beaker" className="dshLabDisabled__icon" />
        <span className="dshLabDisabled__title">
          <em className="visDisabledLabVisualizationtitle">{title}</em> is an experimental visualization.
        </span>
        <p className="dshLabDisabled__body">
          Enable experimental visualizations within <a href={ADVANCED_SETTINGS_DOCS}>Advanced Settings</a>.
        </p>
      </div>
    </div>
  );
}

export const DashboardPanel = memo(function DashboardPanel({
  panel,
  loaded,
  input,
  tick,
  editing,
  hideTitle,
  expanded,
  container,
  dragging,
  onDragStart,
  onResizeStart,
  onAction,
  onConfig,
  onFilter,
  onFiltersChange,
  onTimeChange,
  onData,
  turn,
}: DashboardPanelProps) {
  const id = panel.panelIndex;
  const object = loaded?.object;
  const visBuilder = panel.type === VIS_BUILDER_TYPE;
  // A VisBuilder object is drawn as the visualization of Visualize it stands for
  const { vis, visError } = useMemo<{ vis?: Vis; visError?: string }>(() => {
    if (!object) return {};
    if (panel.type === 'visualization') return { vis: visFromSavedObject(object as unknown as SavedObject<VisualizationAttributes>) };
    if (!visBuilder) return {};
    try {
      const saved = visBuilderFromSavedObject(object as unknown as SavedObject<VisBuilderAttributes>);
      const problem = schemaProblem(saved.state.visualization);
      return problem ? { visError: problem } : { vis: visFromVisBuilder(saved) };
    } catch (failure) {
      return { visError: errorMessage(failure) };
    }
  }, [object, panel.type, visBuilder]);
  // What was changed on the panel lies over what the visualization was saved with; a VisBuilder
  // panel keeps it under `uiState`
  const uiState = useMemo<UiState | undefined>(() => {
    if (!vis) return undefined;
    const config = (visBuilder ? (panel.embeddableConfig.uiState ?? {}) : panel.embeddableConfig) as UiState;
    return { ...vis.uiState, ...config, vis: { ...vis.uiState.vis, ...config.vis } };
  }, [vis, visBuilder, panel.embeddableConfig]);

  // A visualization of a kind still being tried out, while those are turned off, is not drawn.
  // The original then puts in a panel of its own, cut off from the dashboard: it keeps the title
  // its object has and stays as when viewed, with nothing in its menu.
  const labDisabled = Boolean(vis && panel.type === 'visualization' && visType(vis.type)?.stage === 'experimental' && !labsEnabled());

  // A panel that takes no colours from the page's memory lets the next one go at once
  const waits = Boolean(vis && !labDisabled && takesTurn(vis.type));
  useEffect(() => {
    if (loaded && !waits) turn?.done();
  }, [loaded, waits, turn]);

  // A failed search or query, told by the original's red "Error" badge over what was drawn last.
  // It belongs to the object it was reported for: a panel given another one starts without it.
  const [failed, setFailed] = useState<{ object: unknown; failure: VisFailure }>();
  const objectNow = useRef<unknown>(object);
  objectNow.current = object;
  const setFailure = useCallback(
    (next: VisFailure | undefined) => setFailed(next && { object: objectNow.current, failure: next }),
    []
  );
  const failure = failed && failed.object === object ? failed.failure : undefined;

  const objectTitle = (object?.attributes as { title?: string } | undefined)?.title ?? '';
  const title = labDisabled && vis ? vis.title : panelTitle(panel, objectTitle, hideTitle);
  // A visualization's description is told by an icon beside the title, as in the original
  const description = vis && !labDisabled ? vis.description : '';
  // As the original: no title when the dashboard or the panel hides them; while editing, an
  // untitled panel says so
  const titleHidden = panelTitleHidden(panel, hideTitle);
  const showTitle = !titleHidden && ((editing && !labDisabled) || title !== '');
  const showPanelBar = (editing && !labDisabled) || showTitle || description !== '';
  const labelId = useId();

  // The inspector is offered for what asked for data, as the original offers it, but not for the
  // kinds of visualization the original gives it nothing for
  const [inspectable, setInspectable] = useState(false);
  const inspectorOffered = inspectable && (!vis || offersInspector(vis.type));
  const reportData = useCallback(
    (data: PanelData) => {
      if (data.requests.length > 0 || data.table) setInspectable(true);
      onData(id, data);
    },
    [id, onData]
  );

  let body: ReactNode;
  if (!loaded) body = null;
  else if (loaded.error || !object || visError) {
    body = (
      <div className="visError" role="alert" data-test-subj="embeddableError">
        <strong>This panel could not be loaded</strong>
        <span>{loaded.error ?? visError ?? 'Its saved object was not found'}</span>
      </div>
    );
  } else if (vis && labDisabled) {
    body = vis.title ? <DisabledLabVisualization title={vis.title} /> : null;
  } else if (vis) {
    body = (
      <Visualization
        vis={vis}
        input={input}
        tick={tick}
        uiState={uiState}
        onUiState={(next) => onConfig(id, visBuilder ? { ...panel.embeddableConfig, uiState: next } : { ...panel.embeddableConfig, ...next })}
        onFilter={onFilter}
        onFiltersChange={onFiltersChange}
        onTimeChange={onTimeChange}
        onData={reportData}
        turn={turn}
        onError={setFailure}
      />
    );
  } else if (panel.type === 'search') {
    body = (
      <SearchPanel
        object={object as SavedObject<SearchAttributes>}
        input={input}
        tick={tick}
        config={panel.embeddableConfig}
        onConfig={(next) => onConfig(id, next)}
        onFilter={(filters) => onFilter(filters, true)}
        onData={reportData}
        onError={setFailure}
      />
    );
  } else {
    body = <ChartMessage>{TYPE_NAMES[panel.type] ?? `Panels of the type ${panel.type}`} are not drawn by this build.</ChartMessage>;
  }

  const editTo =
    panel.type === 'search' && object
      ? `/app/discover#/view/${encodeURIComponent(object.id)}`
      : vis?.id
        ? visBuilder
          ? visBuilderEditUrl(vis.id)
          : `/app/visualize#/edit/${encodeURIComponent(vis.id)}`
        : undefined;
  const usable = Boolean(object) && !loaded?.error && !visError;
  const items: ContextMenuItem[] = labDisabled
    ? []
    : [
        ...(editing && usable && editTo
          ? [
              {
                id: 'edit',
                label: `Edit ${EDIT_NAMES[panel.type] ?? panel.type}`,
                icon: 'pencil' as const,
                to: editTo,
                // What the original's edit action hands the editor, to come back with the panel
                state: editorStateFor(id, container),
                testId: 'embeddablePanelAction-editPanel',
              },
            ]
          : []),
        ...(editing && usable
          ? [{ id: 'clone', label: 'Clone panel', icon: 'copy' as const, onClick: () => onAction('clone', id), testId: 'embeddablePanelAction-clonePanel' }]
          : []),
        ...(editing
          ? [
              {
                id: 'rename',
                label: 'Edit panel title',
                icon: 'pencil' as const,
                onClick: () => onAction('rename', id),
                testId: 'embeddablePanelAction-ACTION_CUSTOMIZE_PANEL',
              },
            ]
          : []),
        ...(inspectorOffered
          ? [{ id: 'inspect', label: 'Inspect', icon: 'inspect' as const, onClick: () => onAction('inspect', id), testId: 'embeddablePanelAction-openInspector' }]
          : []),
        {
          id: 'expand',
          label: expanded ? 'Minimize' : 'Maximize panel',
          // The original draws both with the same icon, OUI having none for the way back
          icon: 'expand',
          onClick: () => onAction('expand', id),
          testId: 'embeddablePanelAction-togglePanel',
        },
        ...(editing
          ? [
              { id: 'replace', label: 'Replace panel', icon: 'kqlOperand' as const, onClick: () => onAction('replace', id), testId: 'embeddablePanelAction-replacePanel' },
              { id: 'remove', label: 'Delete from dashboard', icon: 'trash' as const, onClick: () => onAction('remove', id), testId: 'embeddablePanelAction-deletePanel' },
            ]
          : []),
      ];

  return (
    <section
      className={cx('dshPanel', 'atlPanel', 'atlPanel--flush', editing && 'dshPanel--editing', dragging && 'dshPanel--dragging')}
      data-test-subj="embeddablePanel"
      aria-labelledby={labelId}
    >
      <header
        className={cx('dshPanel__header', !showPanelBar && 'dshPanel__header--floating')}
        onPointerDown={editing && onDragStart ? (event) => onDragStart(event, id) : undefined}
      >
        <PanelTitle labelId={labelId} title={title} showTitle={showTitle} showBar={showPanelBar} description={description} />
        <PanelMenu editing={editing && !labDisabled} items={items} />
      </header>
      {failure && (
        <div className="dshPanel__label">
          <Tooltip content={failure.message} testId="embeddableErrorMessage">
            <span data-test-subj="embeddableErrorLabel">
              <Badge tone="critical">Error</Badge>
            </span>
          </Tooltip>
        </div>
      )}
      <div
        className={cx('dshPanel__body', (labDisabled || panel.type === 'search') && 'dshPanel__body--flush')}
        data-error={failure ? true : undefined}
      >
        {body}
      </div>
      {editing && onResizeStart && (
        <span
          className="dshPanel__resize"
          role="separator"
          aria-label="Resize panel"
          onPointerDown={(event) => onResizeStart(event, id)}
        />
      )}
    </section>
  );
});

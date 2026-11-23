/* SPDX-License-Identifier: Apache-2.0 */

/* One panel of a dashboard: its title, its menu, and the visualization or saved search in it. */

import { memo, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { ChartMessage } from '../../charts/core';
import { Badge, IconButton, cx } from '../../components/basic';
import { MenuButton, Tooltip, type MenuItem } from '../../components/overlay';
import type { Table } from '../../lib/aggs';
import { resolveTimeRange, type TimeRange } from '../../lib/dates';
import type { RawHit } from '../../lib/docs';
import { phraseFilter } from '../../lib/query';
import { parseSearchSource } from '../../lib/search_source';
import type { Filter, IndexPattern, Query } from '../../lib/types';
import { visFromSavedObject, type UiState, type Vis, type VisualizationAttributes } from '../../lib/vis';
import { services } from '../../services';
import { errorMessage } from '../../services/http';
import type { SavedObject } from '../../services/saved_objects';
import { searchFailure, totalOf, type RequestRecord } from '../../services/search';
import type { VisInput } from '../../vis/request';
import type { VisFailure } from '../../vis/types';
import type { Turn } from '../../vis/turns';
import type { VegaDebugValues } from '../../vis/vega/debug_view';
import { Visualization, takesTurn } from '../../vis/visualization';
import { DocTable, type SortPair } from '../discover/doc_table';
import {
  VIS_BUILDER_TYPE,
  schemaProblem,
  visBuilderEditUrl,
  visBuilderFromSavedObject,
  visFromVisBuilder,
  type VisBuilderAttributes,
} from '../vis_builder/model';
import { DocDetails } from '../discover/doc_viewer';
import { buildDiscoverRequest } from '../discover/search';
import { normalizeSort } from '../discover/sort';
import type { PanelState } from './model';

export interface LoadedObject {
  object?: SavedObject<Record<string, unknown>>;
  error?: string;
}

export interface PanelData {
  requests: RequestRecord[];
  table?: Table;
  vega?: VegaDebugValues;
}

interface SearchAttributes {
  title?: string;
  columns?: string[];
  sort?: unknown;
  kibanaSavedObjectMeta?: { searchSourceJSON?: string };
}

function SearchPanel({
  object,
  input,
  tick,
  onFilter,
  onData,
  onError,
}: {
  object: SavedObject<SearchAttributes>;
  input: VisInput;
  tick: number;
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
  const [rows, setRows] = useState<RawHit[]>();
  // Unknown until a search succeeds; the original says "No results found" only for none found
  const [total, setTotal] = useState<number>();
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState<string>();
  const reportError = useRef(onError);
  reportError.current = onError;
  const [sort, setSort] = useState<SortPair[]>(() => normalizeSort(object.attributes.sort));
  const columns = object.attributes.columns?.length ? object.attributes.columns : ['_source'];

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
      setFailed(true);
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
    const record: RequestRecord = { name: 'Data', index: indexPattern.title, body, startedAt: Date.now() };
    services.search
      .search(indexPattern.title, body, { signal: controller.signal, record })
      .then((response) => {
        setRows(response.hits.hits as RawHit[]);
        setTotal(totalOf(response));
        setError(undefined);
        setFailed(false);
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
  if (!indexPattern || (!rows && !failed)) return null;
  if (total === 0) return <ChartMessage>No results found</ChartMessage>;
  return (
    <div className="dshSearch" data-test-subj="embeddedSavedSearchDocTable">
      <DocTable
        rows={rows ?? []}
        indexPattern={indexPattern}
        columns={columns}
        sort={sort}
        onSort={setSort}
        onFilter={
          onFilter
            ? (name, value, negate) => {
                // The field as the index pattern has it, as the original's generateFilters takes it
                const field = indexPattern.fields.find((candidate) => candidate.name === name) ?? { name };
                const filter = phraseFilter(field, value, indexPattern.id);
                filter.meta.negate = negate;
                onFilter([filter]);
              }
            : undefined
        }
        details={(hit) => <DocDetails hit={hit} indexPattern={indexPattern} basePath="/app/discover" />}
      />
      {rows && total !== undefined && rows.length < total && (
        <div className="dscFooter">
          These are the first {rows.length.toLocaleString()} of {total.toLocaleString()} documents.
        </div>
      )}
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
  dragging?: boolean;
  onDragStart?: (event: ReactPointerEvent, panelIndex: string) => void;
  onResizeStart?: (event: ReactPointerEvent, panelIndex: string) => void;
  onAction: (action: 'expand' | 'inspect' | 'remove' | 'replace' | 'rename', panelIndex: string) => void;
  onConfig: (panelIndex: string, config: Record<string, unknown>) => void;
  onFilter: (filters: Filter[]) => void;
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

export const DashboardPanel = memo(function DashboardPanel({
  panel,
  loaded,
  input,
  tick,
  editing,
  hideTitle,
  expanded,
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

  // A panel that takes no colours from the page's memory lets the next one go at once
  const waits = Boolean(vis && takesTurn(vis.type));
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
  const title = panel.title ?? objectTitle;
  const titleHidden = hideTitle || panel.embeddableConfig.hidePanelTitles === true || title === '';

  let body: ReactNode;
  if (!loaded) body = null;
  else if (loaded.error || !object || visError) {
    body = (
      <div className="visError" role="alert" data-test-subj="embeddableError">
        <strong>This panel could not be loaded</strong>
        <span>{loaded.error ?? visError ?? 'Its saved object was not found'}</span>
      </div>
    );
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
        onData={(data) => onData(id, data)}
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
        onFilter={onFilter}
        onData={(data) => onData(id, data)}
        onError={setFailure}
      />
    );
  } else {
    body = <ChartMessage>{TYPE_NAMES[panel.type] ?? `Panels of the type ${panel.type}`} are not drawn by this build.</ChartMessage>;
  }

  const items: MenuItem[] = [
    ...(editing && vis && vis.id
      ? [
          {
            id: 'edit',
            label: 'Edit visualization',
            icon: 'pencil' as const,
            to: visBuilder ? visBuilderEditUrl(vis.id) : `/app/visualize#/edit/${encodeURIComponent(vis.id)}`,
            testId: 'embeddablePanelAction-editPanel',
          },
        ]
      : []),
    ...(editing ? [{ id: 'rename', label: 'Edit panel title', icon: 'text' as const, onClick: () => onAction('rename', id) }] : []),
    { id: 'inspect', label: 'Inspect', icon: 'inspect', onClick: () => onAction('inspect', id), testId: 'embeddablePanelAction-openInspector' },
    {
      id: 'expand',
      label: expanded ? 'Minimize' : 'Maximize panel',
      icon: expanded ? 'collapse' : 'expand',
      onClick: () => onAction('expand', id),
      testId: 'embeddablePanelAction-togglePanel',
    },
    ...(editing
      ? [
          { id: 'replace', label: 'Replace panel', icon: 'refresh' as const, onClick: () => onAction('replace', id) },
          {
            id: 'remove',
            label: 'Delete from dashboard',
            icon: 'trash' as const,
            danger: true,
            separated: true,
            onClick: () => onAction('remove', id),
            testId: 'embeddablePanelAction-deletePanel',
          },
        ]
      : []),
  ];

  return (
    <section
      className={cx('dshPanel', 'atlPanel', 'atlPanel--flush', editing && 'dshPanel--editing', dragging && 'dshPanel--dragging')}
      data-test-subj="embeddablePanel"
      aria-label={title || 'Panel'}
    >
      <header
        className={cx('dshPanel__header', titleHidden && !editing && 'dshPanel__header--floating')}
        onPointerDown={editing && onDragStart ? (event) => onDragStart(event, id) : undefined}
      >
        <h2 className="dshPanel__title atlTruncate" title={title} data-test-subj="dashboardPanelTitle">
          {titleHidden ? '' : title}
        </h2>
        <MenuButton
          align="right"
          items={items}
          button={(toggle) => (
            <IconButton
              icon={editing ? 'gear' : 'dots'}
              size="s"
              label="Panel options"
              className="dshPanel__menu"
              onClick={toggle}
              testId="embeddablePanelToggleMenuIcon"
            />
          )}
        />
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
      <div className="dshPanel__body" data-error={failure ? true : undefined}>
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

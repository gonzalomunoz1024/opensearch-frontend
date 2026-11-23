/* SPDX-License-Identifier: Apache-2.0 */

/*
 * A visualization on screen: fetches what it draws from when the time range, the query, the
 * filters or the visualization itself change, and hands the answer to the drawing of its kind.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChartMessage } from '../charts/core';
import { ErrorBoundary } from '../components/basic';
import type { AggContext, Table } from '../lib/aggs';
import type { TimeRange } from '../lib/dates';
import type { Filter } from '../lib/types';
import { visType, type UiState, type Vis } from '../lib/vis';
import type { RequestRecord } from '../services/search';
import { errorMessage } from '../services/http';
import { useFilterChoice } from './apply_filters';
import { ControlsVis } from './controls_vis';
import { GaugeVis } from './gauge_vis';
import { HeatmapVis } from './heatmap_vis';
import { MarkdownVis } from './markdown_vis';
import { MetricVis } from './metric_vis';
import { PieVis } from './pie_vis';
import { RegionMapVis } from './region_map/region_map_vis';
import { fetchVisData, type VisData, type VisInput } from './request';
import { TableVis } from './table_vis';
import { TagCloudVis } from './tag_cloud_vis';
import { TileMapVis } from './tile_map/tile_map_vis';
import { splitDrawing, splitParts, splitTables, visFailure, type VisFailure, type VisRenderProps } from './types';
import type { TsvbData, TsvbTableData } from './tsvb/data';
import { TimelineVis } from './timeline/timeline_vis';
import { TsvbVis } from './tsvb/vis';
import type { VegaDebugValues } from './vega/debug_view';
import { VegaVis } from './vega/vega_vis';
import { XYVis } from './xy_vis';
import { waitTurn, type Turn } from './turns';
import '../styles/vis.css';

/** What Inspect shows of a visualization; for TSVB, the data it drew, which its editor reads */
export interface VisInspectData {
  requests: RequestRecord[];
  table?: Table;
  /** What the table's columns were asked with, which Inspect's cell filters are made from */
  context?: AggContext;
  vega?: VegaDebugValues;
  tsvb?: TsvbData | TsvbTableData;
}

export interface VisualizationProps {
  vis: Vis;
  input: VisInput;
  /** Changes when the page asks for the data again */
  tick?: number;
  uiState?: UiState;
  onUiState?: (next: UiState) => void;
  /** A click on a mark: filters to add to the page's */
  onFilter?: (filters: Filter[]) => void;
  /** Controls replace their own among the page's filters */
  onFiltersChange?: (filters: Filter[]) => void;
  onTimeChange?: (range: TimeRange) => void;
  /** What Inspect shows: the requests made, and the table drawn or the Vega view; for TSVB, the data it drew */
  onData?: (data: VisInspectData) => void;
  /** This chart's place among the charts of the page, when the page keeps one */
  turn?: Turn;
  /**
   * Takes the failure of the visualization's data, and nothing once it draws again. The drawing
   * then shows no error of its own and keeps what it last drew, as the original's does.
   */
  onError?: (failure: VisFailure | undefined) => void;
}

const DRAWN: Record<string, (props: VisRenderProps) => ReactNode> = {
  area: (props) => <XYVis {...props} />,
  line: (props) => <XYVis {...props} />,
  histogram: (props) => <XYVis {...props} />,
  horizontal_bar: (props) => <XYVis {...props} />,
  pie: (props) => <PieVis {...props} />,
  metric: (props) => <MetricVis {...props} />,
  gauge: (props) => <GaugeVis {...props} />,
  goal: (props) => <GaugeVis {...props} />,
  heatmap: (props) => <HeatmapVis {...props} />,
  region_map: (props) => <RegionMapVis {...props} />,
  tagcloud: (props) => <TagCloudVis {...props} />,
  table: (props) => <TableVis {...props} />,
  tile_map: (props) => <TileMapVis {...props} />,
};

/** Whether this product draws a kind of visualization */
export const canDraw = (type: string) =>
  type in DRAWN || type === 'markdown' || type === 'input_control_vis' || type === 'metrics' || type === 'vega' || type === 'timelion';

/** Whether a kind of visualization takes colours from the page's memory, and so a turn */
export const takesTurn = (type: string) => type in DRAWN;

// The maps filter as they always have; the other drawings' clicks go as the original's value click
const MAPS = new Set(['region_map', 'tile_map']);

function AggVisualization({ vis: saved, input, tick, uiState, onUiState, onFilter, onTimeChange, onData, turn, onError }: VisualizationProps) {
  // Params a drawing sets on an aggregation (a map's bounds and precision), until the aggregations change
  const [aggPatch, setAggPatch] = useState<{ aggs: string; params: Record<string, Record<string, unknown>> }>();
  const savedAggs = JSON.stringify(saved.aggs);
  const patch = aggPatch?.aggs === savedAggs ? aggPatch.params : undefined;
  const vis = patch ? { ...saved, aggs: saved.aggs.map((agg) => (patch[agg.id] ? { ...agg, params: { ...agg.params, ...patch[agg.id] } } : agg)) } : saved;
  const onAggParams = (aggId: string, params: Record<string, unknown>) =>
    setAggPatch((current) => {
      const base = current?.aggs === savedAggs ? current.params : {};
      return { aggs: savedAggs, params: { ...base, [aggId]: { ...base[aggId], ...params } } };
    });
  const [data, setData] = useState<VisData>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const choice = useFilterChoice({ onFilter, onTimeChange, indexPattern: data?.indexPattern });
  const report = useRef(onData);
  report.current = onData;
  const reportError = useRef(onError);
  reportError.current = onError;

  const key = JSON.stringify([vis.type, vis.aggs, vis.source, vis.savedSearchId, vis.params.showMetricsAtAllLevels, vis.params.showPartialRows, input]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetchVisData(vis, input, controller.signal)
      .then(async (answer) => {
        await waitTurn(turn);
        if (controller.signal.aborted) return;
        setData(answer);
        setError(undefined);
        setLoading(false);
        reportError.current?.(undefined);
        report.current?.({ requests: answer.requests, table: answer.table, context: answer.context });
      })
      .catch((failure) => {
        if ((failure as Error).name === 'AbortError') return;
        setLoading(false);
        // Told around the drawing, which keeps what it drew, as the original's esaggs
        if (reportError.current) reportError.current(visFailure('opensearchaggs', failure));
        else setError(errorMessage(failure));
      })
      .finally(() => turn?.done());
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick]);

  // Rows or columns, as the original reads them from the visualization's params: columns unless
  // it says rows, which its editor says once a chart is split
  const asRows = Boolean(vis.params.row);
  // A split its drawing lays out itself, the same while the data is
  const splitBy = splitDrawing(vis.type);
  const splits = useMemo(() => {
    const parts = data && splitBy === 'frame' ? splitParts(data.table) : undefined;
    return parts?.length ? { rows: asRows, parts } : undefined;
  }, [data, splitBy, asRows]);

  const draw = DRAWN[vis.type];
  let body: ReactNode;
  if (error) {
    body = (
      <div className="visError" role="alert" data-test-subj="visError">
        <strong>This visualization could not be drawn</strong>
        <span>{error}</span>
      </div>
    );
  } else if (!data) {
    body = null;
  } else {
    // A data table is handed the whole of a split: it draws a table of each bucket itself
    const parts = splitBy === 'whole' ? [{ table: data.table }] : splitTables(data.table);
    const clicks = onFilter && !MAPS.has(vis.type) ? choice.apply : onFilter;
    const props = { vis, uiState: uiState ?? vis.uiState, onUiState, onFilter: clicks, onTimeChange, onAggParams };
    body = splits ? (
      draw({ ...props, data, splits })
    ) : parts.length === 1 && parts[0].label === undefined ? (
      draw({ ...props, data })
    ) : parts.length === 0 ? (
      <ChartMessage>No results found</ChartMessage>
    ) : (
      <div className={`visSplit ${asRows ? 'visSplit--rows' : 'visSplit--columns'}`}>
        {parts.map((part) => (
          <div key={part.label} className="visSplit__part">
            <div className="visSplit__title">{part.label}</div>
            <div className="visSplit__body">{draw({ ...props, data: { ...data, table: part.table }, split: part.split })}</div>
          </div>
        ))}
      </div>
    );
  }
  return (
    <>
      {loading && <div className="atlProgress visRoot__progress" />}
      {body}
      {choice.dialog}
    </>
  );
}

export function Visualization(props: VisualizationProps) {
  const { vis } = props;
  let body: ReactNode;
  if (vis.type === 'markdown') body = <MarkdownVis vis={vis} />;
  else if (vis.type === 'input_control_vis') {
    body = <ControlsVis vis={vis} input={props.input} onFiltersChange={props.onFiltersChange} tick={props.tick} />;
  } else if (vis.type === 'metrics') {
    body = (
      <TsvbVis
        vis={vis}
        input={props.input}
        tick={props.tick}
        uiState={props.uiState}
        onUiState={props.onUiState}
        onTimeChange={props.onTimeChange}
        onData={props.onData}
        onError={props.onError}
      />
    );
  } else if (vis.type === 'vega') {
    body = (
      <VegaVis
        vis={vis}
        input={props.input}
        tick={props.tick}
        onFilter={props.onFilter}
        onFiltersChange={props.onFiltersChange}
        onTimeChange={props.onTimeChange}
        onData={props.onData}
        onError={props.onError}
      />
    );
  } else if (vis.type === 'timelion') {
    body = <TimelineVis vis={vis} input={props.input} tick={props.tick} onTimeChange={props.onTimeChange} onData={props.onData} />;
  } else if (vis.type in DRAWN) body = <AggVisualization {...props} />;
  else {
    body = (
      <ChartMessage>
        {visType(vis.type)?.title ?? vis.type} visualizations are not drawn by this build yet.
      </ChartMessage>
    );
  }
  return (
    <div className="visRoot" data-test-subj="visualizationLoader" data-vis-type={vis.type}>
      <ErrorBoundary compact resetKey={`${vis.id}-${props.tick}`}>
        {body}
      </ErrorBoundary>
    </div>
  );
}

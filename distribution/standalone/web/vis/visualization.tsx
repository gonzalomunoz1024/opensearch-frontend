/* SPDX-License-Identifier: Apache-2.0 */

/*
 * A visualization on screen: fetches what it draws from when the time range, the query, the
 * filters or the visualization itself change, and hands the answer to the drawing of its kind.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChartMessage, LegendToggle } from '../charts/core';
import { ErrorBoundary } from '../components/basic';
import type { Table } from '../lib/aggs';
import type { TimeRange } from '../lib/dates';
import type { Filter } from '../lib/types';
import { visType, type UiState, type Vis } from '../lib/vis';
import type { RequestRecord } from '../services/search';
import { errorMessage } from '../services/http';
import { ControlsVis } from './controls_vis';
import { GaugeVis } from './gauge_vis';
import { HeatmapVis } from './heatmap_vis';
import { MarkdownVis } from './markdown_vis';
import { MetricVis } from './metric_vis';
import { PieVis } from './pie_vis';
import { fetchVisData, type VisData, type VisInput } from './request';
import { TableVis } from './table_vis';
import { TagCloudVis } from './tag_cloud_vis';
import { splitTables, type VisRenderProps } from './types';
import type { TsvbData, TsvbTableData } from './tsvb/data';
import { TsvbVis } from './tsvb/vis';
import { XYVis } from './xy_vis';
import { waitTurn, type Turn } from './turns';
import '../styles/vis.css';

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
  /** What Inspect shows: the requests made and the table drawn; for TSVB, the data it drew */
  onData?: (data: { requests: RequestRecord[]; table?: Table; tsvb?: TsvbData | TsvbTableData }) => void;
  /** This chart's place among the charts of the page, when the page keeps one */
  turn?: Turn;
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
  tagcloud: (props) => <TagCloudVis {...props} />,
  table: (props) => <TableVis {...props} />,
};

// The kinds whose legend can be opened and closed from the corner of the chart
const LEGEND_KINDS = new Set(['area', 'line', 'histogram', 'horizontal_bar', 'pie', 'heatmap']);

/** Whether this product draws a kind of visualization */
export const canDraw = (type: string) => type in DRAWN || type === 'markdown' || type === 'input_control_vis' || type === 'metrics';

/** Whether a kind of visualization takes colours from the page's memory, and so a turn */
export const takesTurn = (type: string) => type in DRAWN;

function AggVisualization({ vis, input, tick, uiState, onUiState, onFilter, onTimeChange, onData, turn }: VisualizationProps) {
  const [data, setData] = useState<VisData>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const report = useRef(onData);
  report.current = onData;

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
        report.current?.({ requests: answer.requests, table: answer.table });
      })
      .catch((failure) => {
        if ((failure as Error).name === 'AbortError') return;
        setError(errorMessage(failure));
        setLoading(false);
      })
      .finally(() => turn?.done());
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick]);

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
    const parts = vis.type === 'table' || vis.type in DRAWN ? splitTables(data.table) : [{ table: data.table }];
    const split = vis.aggs.find((agg) => agg.schema === 'split' && agg.enabled !== false);
    const asRows = split?.params?.row !== false;
    const props = { vis, uiState: uiState ?? vis.uiState, onUiState, onFilter, onTimeChange };
    body =
      parts.length === 1 && parts[0].label === undefined ? (
        draw({ ...props, data })
      ) : parts.length === 0 ? (
        <ChartMessage>No results found</ChartMessage>
      ) : (
        <div className={`visSplit ${asRows ? 'visSplit--rows' : 'visSplit--columns'}`}>
          {parts.map((part) => (
            <div key={part.label} className="visSplit__part">
              <div className="visSplit__title">{part.label}</div>
              <div className="visSplit__body">{draw({ ...props, data: { ...data, table: part.table } })}</div>
            </div>
          ))}
        </div>
      );
  }
  const state = uiState ?? vis.uiState;
  const legendOpen = state.vis?.legendOpen !== false;
  return (
    <>
      {loading && <div className="atlProgress visRoot__progress" />}
      {body}
      {data && !error && onUiState && LEGEND_KINDS.has(vis.type) && vis.params.addLegend !== false && (
        <LegendToggle open={legendOpen} onToggle={() => onUiState({ ...state, vis: { ...state.vis, legendOpen: !legendOpen } })} />
      )}
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
    body = <TsvbVis vis={vis} input={props.input} tick={props.tick} onTimeChange={props.onTimeChange} onData={props.onData} />;
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

/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The canvas in the middle of VisBuilder: the chart once the parts it needs are there, drawn by
 * the charts of Visualize, and otherwise the picture that says to drag a field. A state that
 * cannot be drawn says why in a warning, as OpenSearch Dashboards does.
 */

import { useEffect, useMemo } from 'react';
import type { TimeRange } from '../../lib/dates';
import type { Filter, IndexPattern } from '../../lib/types';
import type { UiState } from '../../lib/vis';
import { services } from '../../services';
import type { VisInput } from '../../vis/request';
import { Visualization } from '../../vis/visualization';
import { EmptyCanvas } from './empty_canvas';
import { aggregationsProblem, type AppState } from './editor_state';
import { schemaProblem, visFromVisBuilder } from './model';

export interface WorkspaceProps {
  state: AppState;
  indexPattern?: IndexPattern;
  input: VisInput;
  tick: number;
  onUiState: (ui: UiState) => void;
  onFilter: (filters: Filter[]) => void;
  onTimeChange: (time: TimeRange) => void;
}

export function Workspace({ state, indexPattern, input, tick, onUiState, onFilter, onTimeChange }: WorkspaceProps) {
  const { visualization, style, ui } = state;
  const aggs = useMemo(() => visualization.activeVisualization?.aggConfigParams ?? [], [visualization.activeVisualization]);
  const problem = aggs.length > 0 ? (schemaProblem(visualization) ?? aggregationsProblem(aggs)) : undefined;

  // Each change that leaves the chart unable to be drawn says why again
  const stateKey = JSON.stringify(state);
  useEffect(() => {
    if (problem) services.toasts.warning(problem);
  }, [problem, stateKey]);

  const drawn = aggs.length > 0 && !problem && indexPattern !== undefined;
  // The chart changes with its kind, its aggregations and its settings, not with what is edited
  const drawnKey = drawn ? JSON.stringify([visualization.activeVisualization?.name, aggs, visualization.indexPattern, style]) : '';
  const vis = useMemo(
    () =>
      drawnKey
        ? visFromVisBuilder({
            title: '',
            description: '',
            state: { visualization: { ...visualization, activeVisualization: visualization.activeVisualization && { name: visualization.activeVisualization.name, aggConfigParams: aggs } }, style, ui: {} },
            source: { indexId: visualization.indexPattern, filters: [] },
            references: [],
          })
        : undefined,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [drawnKey]
  );

  return (
    <section className="vbdWorkspace">
      <div className="vbdCanvas">
        {vis ? (
          // The original's renderer draws in a box 8 px in from the canvas
          <div className="vbdCanvas__vis">
            <Visualization vis={vis} input={input} tick={tick} uiState={ui} onUiState={onUiState} onFilter={onFilter} onTimeChange={onTimeChange} />
          </div>
        ) : (
          <EmptyCanvas />
        )}
      </div>
    </section>
  );
}

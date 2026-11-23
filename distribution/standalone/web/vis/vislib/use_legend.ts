/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The legend of a classic chart as a visualization keeps it: open or closed and the colours picked
 * in it in the visualization's uiState (or, with nowhere to keep them, open or closed for as long
 * as the chart is shown), and its "Filter for value" and "Filter out value" turned into filters.
 */

import { useState } from 'react';
import type { Filter } from '../../lib/types';
import type { VisRenderProps } from '../types';
import type { LegendPosition, VisLegendProps } from './legend';

const POSITIONS: LegendPosition[] = ['top', 'bottom', 'left', 'right'];

export type ChartLegend = Omit<VisLegendProps, 'labels' | 'colorOf' | 'opacityOf' | 'onHighlight'>;

export interface LegendOptions extends Pick<VisRenderProps, 'uiState' | 'onUiState' | 'onFilter'> {
  addLegend: boolean | undefined;
  legendPosition: string | undefined;
  /** The filter a name of the legend stands for, when it stands for one */
  filterOf?: (label: string) => Filter | undefined;
  /** Whether colours can be picked in the legend */
  canColor?: boolean;
}

/** The legend's position as a visualization says it, the right side when it says none */
export const legendPositionOf = (value: string | undefined): LegendPosition =>
  POSITIONS.includes(value as LegendPosition) ? (value as LegendPosition) : 'right';

export function useVislibLegend({ addLegend, legendPosition, uiState, onUiState, onFilter, filterOf, canColor = true }: LegendOptions): ChartLegend | undefined {
  const [localOpen, setLocalOpen] = useState(true);
  if (!addLegend) return undefined;
  const open = uiState.vis?.legendOpen ?? (onUiState ? true : localOpen);
  return {
    position: legendPositionOf(legendPosition),
    open,
    onToggle: () => {
      if (onUiState) onUiState({ ...uiState, vis: { ...uiState.vis, legendOpen: !open } });
      else setLocalOpen(!open);
    },
    canFilter: onFilter && filterOf ? (label: string) => Boolean(filterOf(label)) : undefined,
    onFilter:
      onFilter && filterOf
        ? (label: string, negate: boolean) => {
            const filter = filterOf(label);
            if (filter) onFilter([{ ...filter, meta: { ...filter.meta, negate: negate ? !filter.meta.negate : filter.meta.negate } }]);
          }
        : undefined,
    onColor:
      onUiState && canColor
        ? (label: string, color: string) => {
            const picked = { ...(uiState.vis?.colors ?? {}) };
            if (picked[label] === color) delete picked[label];
            else picked[label] = color;
            onUiState({ ...uiState, vis: { ...uiState.vis, colors: picked } });
          }
        : undefined,
  };
}

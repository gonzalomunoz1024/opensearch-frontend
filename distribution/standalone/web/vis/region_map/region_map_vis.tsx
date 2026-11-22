/* SPDX-License-Identifier: Apache-2.0 */

/* Region map: a measure for each term, as the colour of the shape the term names. */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { MapsParams } from '../../maps/base_maps_vis';
import { MapVisContainer, type MapSessionState, type MapUiState } from '../../maps/map_vis_container';
import type { VisRenderProps } from '../types';
import { regionMapDefaults, setupRegionMap, CUSTOM_MAP_CHOICE, type RegionMapParams } from './region_map_type';
import { RegionMapVisualization, type RegionMapData } from './region_map_visualization';

/** Whether a visualization lacks what `setup` fills in before it can be drawn */
export const needsSetup = (params: RegionMapParams) =>
  !params.selectedLayer || (params.layerChosenByUser === CUSTOM_MAP_CHOICE && !params.selectedCustomLayer);

export function RegionMapVis({ vis, data, uiState, onUiState, onFilter }: VisRenderProps) {
  const defaults = useMemo(() => regionMapDefaults() as MapsParams, []);
  const sessionState = useRef<MapSessionState>({}).current;
  const params = vis.params as RegionMapParams;
  // A visualization saved without a vector map gets the first, as the original's setup gives it
  const [setUp, setSetUp] = useState<RegionMapParams | null>(needsSetup(params) ? null : params);
  const key = JSON.stringify(params);
  useEffect(() => {
    if (!needsSetup(params)) {
      setSetUp(params);
      return undefined;
    }
    let live = true;
    setupRegionMap(params)
      .then((answer) => live && setSetUp(answer.params))
      .catch(() => live && setSetUp(params));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const filter = useRef(onFilter);
  filter.current = onFilter;
  const drawn = useMemo<RegionMapData>(() => ({ table: data.table, context: data.context }), [data]);
  if (!setUp) return null;
  return (
    <MapVisContainer<RegionMapData>
      vis={{ ...vis, params: setUp }}
      data={drawn}
      defaults={defaults}
      uiState={uiState as MapUiState}
      onUiState={onUiState}
      sessionState={sessionState}
      create={(element, host) => new RegionMapVisualization(element, host, (filters) => filter.current?.(filters))}
    />
  );
}

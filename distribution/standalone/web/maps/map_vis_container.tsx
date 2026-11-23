/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The React side of a map visualization: one element the map draws in, a BaseMapsVis made once
 * for it, rendered again when the answer or the parameters change, resized with its panel.
 */

import { useEffect, useRef } from 'react';
import type { UiState, Vis } from '../lib/vis';
import type { BaseMapsVis, MapVisHost, MapsParams } from './base_maps_vis';
import type { GeoBounds } from './osd_map';
import '../styles/maps.css';

/** uiState.mapZoom and mapCenter sit at the top of a map visualization's uiState */
export type MapUiState = UiState & { mapZoom?: number | string; mapCenter?: [number, number] };

/** What survives between searches of one visualization on screen: the bounds the map shows */
export interface MapSessionState {
  mapBounds?: GeoBounds | null;
}

export interface MapVisContainerProps<Data> {
  vis: Vis;
  data: Data;
  defaults: MapsParams;
  uiState: MapUiState;
  onUiState?: (next: UiState) => void;
  sessionState: MapSessionState;
  /** Makes the drawing of this kind */
  create: (element: HTMLElement, host: MapVisHost) => BaseMapsVis<Data>;
  /** Called when a render has finished */
  onRendered?: () => void;
}

export function MapVisContainer<Data>({
  vis,
  data,
  defaults,
  uiState,
  onUiState,
  sessionState,
  create,
  onRendered,
}: MapVisContainerProps<Data>) {
  const element = useRef<HTMLDivElement>(null);
  const drawing = useRef<BaseMapsVis<Data> | null>(null);
  // The map reads these when it moves; a ref keeps them current without making the map again
  const state = useRef({ uiState, onUiState });
  state.current = { uiState, onUiState };
  const pending = useRef<MapUiState>({});

  useEffect(() => {
    if (!element.current) return;
    const host: MapVisHost = {
      defaults,
      params: vis.params as MapsParams,
      sessionState,
      getUiState: () => ({ ...state.current.uiState, ...pending.current }),
      setUiState: (key, value) => {
        pending.current = { ...pending.current, [key]: value };
        const next = { ...state.current.uiState, ...pending.current };
        state.current.onUiState?.(next);
      },
    };
    const made = create(element.current, host);
    drawing.current = made;
    const observer = new ResizeObserver(() => {
      void made.isLoaded().then(() => made.resize());
    });
    observer.observe(element.current);
    return () => {
      observer.disconnect();
      made.destroy();
      drawing.current = null;
    };
    // The drawing is made once per element; what changes is handed to render below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    pending.current = {};
  }, [uiState]);

  useEffect(() => {
    const made = drawing.current;
    if (!made) return;
    let cancelled = false;
    made.render(data, vis.params as MapsParams).then(() => {
      if (!cancelled) onRendered?.();
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, JSON.stringify(vis.params)]);

  return <div className="visualization mapVis" data-test-subj="mapContainer" ref={element} />;
}

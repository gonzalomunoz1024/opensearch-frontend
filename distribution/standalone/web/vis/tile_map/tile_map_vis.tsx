/* SPDX-License-Identifier: Apache-2.0 */

/*
 * A coordinate map on screen: the answer of the search as GeoJSON (the responseHandler
 * convertToGeoJson and the tilemap expression function), drawn by CoordinateMapsVisualization.
 */

import { useMemo, useRef } from 'react';
import type { Table } from '../../lib/aggs';
import type { Filter } from '../../lib/types';
import type { Vis } from '../../lib/vis';
import { MapVisContainer, type MapSessionState, type MapUiState } from '../../maps/map_vis_container';
import { services } from '../../services';
import type { VisRenderProps } from '../types';
import { GEOHASH_DEFAULTS, tileMapDefaults } from './defaults';
import { convertToGeoJson, maxPrecisionOf, needsNewSearch, type GeohashAggParams } from './geo';
import { CoordinateMapsVisualization, type TileMapData, type TileMapDeps } from './tile_map_visualization';
import '../../styles/tile_map.css';

/** The answer as the coordinate map draws it */
export function toTileMapData(table: Table, indexId: string | undefined): TileMapData {
  const geohashColumn = table.columns.find((column) => column.kind === 'bucket' && column.agg.type === 'geohash_grid');
  const metricColumn = table.columns.find((column) => column.kind === 'metric' && column.schema !== 'geo_centroid' && column.schema !== 'radius');
  const centroidColumn = table.columns.find((column) => column.schema === 'geo_centroid');
  const params = { ...GEOHASH_DEFAULTS, ...(geohashColumn?.agg.params ?? {}) } as GeohashAggParams & { field?: string; precision?: number };
  const rows =
    geohashColumn && metricColumn
      ? table.rows.map((row) => ({ geohash: row[geohashColumn.id], value: row[metricColumn.id], centroid: centroidColumn ? row[centroidColumn.id] : undefined }))
      : null;
  const { featureCollection, meta } = convertToGeoJson(rows, {
    precision: params.precision,
    useGeocentroid: params.useGeocentroid,
    hasCentroid: Boolean(centroidColumn),
  });
  return {
    featureCollection,
    meta,
    geohash: geohashColumn ? { params, field: String(params.field ?? geohashColumn.fieldName ?? ''), indexId } : null,
    metricLabel: metricColumn?.name ?? '',
    metricFormat: metricColumn ? metricColumn.format : (value) => String(value),
  };
}

const geohashAggOf = (vis: Vis) => vis.aggs.find((agg) => agg.type === 'geohash_grid' && agg.enabled !== false);

export function TileMapVis({ vis, data, uiState, onUiState, onFilter, onAggParams }: VisRenderProps) {
  const session = useRef<MapSessionState>({});
  const current = useRef({ vis, onFilter, onAggParams });
  current.current = { vis, onFilter, onAggParams };
  const geo = useMemo(() => toTileMapData(data.table, data.indexPattern.id), [data]);
  const defaults = useMemo(() => tileMapDefaults(), []);
  // A dashboard's panel may save mapZoom and mapCenter as null: the visualization's own apply then
  const mapState = useMemo(() => {
    const own = vis.uiState as MapUiState;
    return {
      ...uiState,
      mapZoom: uiState.mapZoom ?? own.mapZoom,
      mapCenter: uiState.mapCenter ?? own.mapCenter,
    } as MapUiState;
  }, [uiState, vis.uiState]);

  const deps = useMemo<TileMapDeps>(
    () => ({
      setGeohashParams: (next) => {
        const agg = geohashAggOf(current.current.vis);
        if (!agg) return;
        const params = { ...GEOHASH_DEFAULTS, ...agg.params };
        if (needsNewSearch(params, next)) current.current.onAggParams?.(agg.id, { boundingBox: next.boundingBox, precision: next.precision });
      },
      addFilters: (filters) => current.current.onFilter?.(filters as unknown as Filter[]),
      maxPrecision: () => maxPrecisionOf(services.uiSettings.get('visualization:tileMap:maxPrecision', 7)),
      dark: () => services.uiSettings.get<boolean>('theme:darkMode', false) === true,
    }),
    []
  );

  return (
    <MapVisContainer<TileMapData | null>
      vis={vis}
      data={geo}
      defaults={defaults}
      uiState={mapState}
      onUiState={onUiState}
      sessionState={session.current}
      create={(element, host) => new CoordinateMapsVisualization(element, host, deps)}
    />
  );
}

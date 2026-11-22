/* SPDX-License-Identifier: Apache-2.0 */

/* The settings of a new coordinate map and of its geohash_grid: tile_map_type.js and geo_hash.ts. */

import { COLOR_SCHEMAS } from './geo';

/** The setting visualization:tileMap:WMSdefaults as OpenSearch Dashboards ships it */
export const DEFAULT_WMS = {
  enabled: false,
  url: '',
  options: { version: '', layers: '', format: 'image/png', transparent: true, attribution: '', styles: '' },
};

/** visConfig.defaults of tile_map */
export function tileMapDefaults(wms: Record<string, unknown> = DEFAULT_WMS): Record<string, unknown> {
  return {
    colorSchema: 'Yellow to Red',
    mapType: 'Scaled Circle Markers',
    isDesaturated: true,
    addTooltip: true,
    heatClusterSize: 1.5,
    legendPosition: 'bottomright',
    mapZoom: 2,
    mapCenter: [0, 0],
    wms: JSON.parse(JSON.stringify(wms)) as Record<string, unknown>,
  };
}

/** The defaults of the geohash_grid's params */
export const GEOHASH_DEFAULTS = { autoPrecision: true, precision: 2, useGeocentroid: true, isFilteredByCollar: true, boundingBox: null };

export const MAP_TYPE_OPTIONS = [
  { value: 'Scaled Circle Markers', label: 'Scaled circle markers' },
  { value: 'Shaded Circle Markers', label: 'Shaded circle markers' },
  { value: 'Shaded Geohash Grid', label: 'Shaded geohash grid' },
  { value: 'Heatmap', label: 'Heatmap' },
];

export const LEGEND_POSITION_OPTIONS = [
  { value: 'bottomleft', label: 'Bottom left' },
  { value: 'bottomright', label: 'Bottom right' },
  { value: 'topleft', label: 'Top left' },
  { value: 'topright', label: 'Top right' },
];

export const COLOR_SCHEMA_OPTIONS = COLOR_SCHEMAS.map((name) => ({ value: name, label: name }));

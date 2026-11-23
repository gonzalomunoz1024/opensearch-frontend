/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The `map.*` settings of opensearch_dashboards.yml, as the server hands them to the page: the
 * same names and defaults as the maps_legacy, tile_map and region_map plugins of OpenSearch
 * Dashboards 3.9.0.
 */

export interface TilemapConfig {
  url?: string;
  options: {
    attribution: string;
    minZoom: number;
    maxZoom: number;
    tileSize?: number;
    subdomains?: string[];
    errorTileUrl?: string;
    tms?: boolean;
    reuseTiles?: boolean;
    bounds?: number[];
    default?: boolean;
  };
}

export interface RegionmapLayerConfig {
  url: string;
  format: { type: string };
  meta: { feature_collection_path: string };
  attribution: string;
  name: string;
  fields: Array<{ name: string; description: string }>;
}

export interface RegionmapConfig {
  includeOpenSearchMapsService: boolean;
  layers: RegionmapLayerConfig[];
}

export interface MapConfig {
  includeOpenSearchMapsService: boolean;
  proxyOpenSearchMapsServiceInMaps: boolean;
  showRegionDeniedWarning: boolean;
  tilemap: TilemapConfig;
  regionmap: RegionmapConfig;
  manifestServiceUrl: string;
  opensearchManifestServiceUrl: string;
  emsFileApiUrl: string;
  emsTileApiUrl: string;
  emsLandingPageUrl: string;
  emsFontLibraryUrl: string;
  emsTileLayerId: { bright: string; desaturated: string; dark: string };
}

export const DEFAULT_MAP_CONFIG: MapConfig = {
  includeOpenSearchMapsService: true,
  proxyOpenSearchMapsServiceInMaps: false,
  showRegionDeniedWarning: false,
  tilemap: { options: { attribution: '', minZoom: 0, maxZoom: 10 } },
  regionmap: { includeOpenSearchMapsService: true, layers: [] },
  manifestServiceUrl: '',
  opensearchManifestServiceUrl: 'https://maps.opensearch.org/manifest',
  emsFileApiUrl: 'https://vectors.maps.opensearch.org',
  emsTileApiUrl: 'https://tiles.maps.opensearch.org',
  emsLandingPageUrl: 'https://maps.opensearch.org',
  emsFontLibraryUrl: 'https://tiles.maps.opensearch.org/fonts/{fontstack}/{range}.pbf',
  emsTileLayerId: { bright: 'road_map', desaturated: 'road_map_desaturated', dark: 'dark_map' },
};

/** The `ORIGIN` constants of maps_legacy */
export const ORIGIN = {
  EMS: 'elastic_maps_service',
  OPENSEARCH_DASHBOARDS_YML: 'self_hosted',
} as const;

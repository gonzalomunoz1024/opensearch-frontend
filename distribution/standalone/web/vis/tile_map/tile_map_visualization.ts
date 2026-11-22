/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The coordinate map: CoordinateMapsVisualization of tile_map. It draws the buckets of a
 * geohash_grid over the base map, asks for another search when the map moves out of the collar
 * it asked for or zooms to another precision, and turns a drawn rectangle or polygon into a filter.
 */

import { BaseMapsVis, type MapVisHost } from '../../maps/base_maps_vis';
import { setDrawControlFactory } from '../../maps/osd_map';
import type { GeoBoundingBox } from '../../maps/geohash';
import { createDrawControl } from './draw_control';
import { nextGeohashParams, spatialFilter, tooltipDetails, tooltipHtml, type GeoFeature, type GeoFeatureCollection, type GeoMeta, type GeohashAggParams, type SpatialFilter } from './geo';
import { GeohashLayer, MAP_TYPES, type GeohashOptions } from './geohash_layer';

setDrawControlFactory(createDrawControl);

/** What a coordinate map is given to draw: the answer as GeoJSON, and what it came from */
export interface TileMapData {
  featureCollection: GeoFeatureCollection;
  meta: GeoMeta;
  /** The geohash_grid of the search: its params as asked, its field and index pattern */
  geohash: { params: GeohashAggParams; field: string; indexId?: string } | null;
  metricLabel: string;
  metricFormat: (value: unknown) => string;
}

/** What the page does for the map */
export interface TileMapDeps {
  /** The 'bounds' event: the geohash_grid's box and precision for the searches that follow */
  setGeohashParams(params: { boundingBox: GeoBoundingBox | null | undefined; precision: number | undefined }): void;
  addFilters(filters: SpatialFilter[]): void;
  /** visualization:tileMap:maxPrecision */
  maxPrecision(): number;
  dark(): boolean;
}

export class CoordinateMapsVisualization extends BaseMapsVis<TileMapData | null> {
  private geohashLayer: GeohashLayer | null = null;
  private geoData: TileMapData | null = null;

  constructor(
    container: HTMLElement,
    vis: MapVisHost,
    private readonly deps: TileMapDeps
  ) {
    super(container, vis);
    // uiState.on('change'): the map's zoom or centre changed
    const setUiState = vis.setUiState.bind(vis);
    vis.setUiState = (key, value) => {
      setUiState(key, value);
      if (key === 'mapZoom' || key === 'mapCenter') this.updateGeohashAgg();
    };
  }

  private updateGeohashAgg() {
    const agg = this.geoData?.geohash;
    const bounds = this.map?.getBounds();
    if (!agg || !bounds) return;
    const zoom = parseInt(String(this.vis.getUiState().mapZoom), 10);
    this.deps.setGeohashParams(nextGeohashParams(agg.params, bounds, zoom, this.deps.maxPrecision()));
  }

  protected async makeMap(): Promise<void> {
    await super.makeMap();
    const map = this.map;
    if (!map) return;
    let previousPrecision = map.getGeohashPrecision();
    let precisionChange = false;
    map.on('zoomchange', () => {
      precisionChange = previousPrecision !== map.getGeohashPrecision();
      previousPrecision = map.getGeohashPrecision();
    });
    map.on('zoomend', () => {
      const agg = this.geoData?.geohash;
      if (!agg) return;
      const isAutoPrecision = typeof agg.params.autoPrecision === 'boolean' ? agg.params.autoPrecision : true;
      if (!isAutoPrecision) return;
      if (precisionChange) this.updateGeohashAgg();
      // Filtered by the collar: the heat map is drawn again for the new zoom
      else this.updateDataInternal(this.geoData);
    });
    map.addDrawControl();
    map.on('drawCreated:rectangle', (event: { bounds: GeoBoundingBox }) => this.addSpatialFilter('geo_bounding_box', event.bounds));
    map.on('drawCreated:polygon', (event: { points: Array<{ lat: number; lon: number }> }) =>
      this.addSpatialFilter('geo_polygon', { points: event.points })
    );
  }

  protected async updateData(data: TileMapData | null): Promise<void> {
    this.chartData = data;
    this.updateDataInternal(data);
  }

  private updateDataInternal(data: TileMapData | null) {
    // A heat map is drawn again at every zoom: it gathers its points by pixels
    if (this.getMapsParams().mapType !== MAP_TYPES.Heatmap && data === this.geoData) return;
    if (this.geohashLayer) {
      this.map?.removeLayer(this.geohashLayer);
      this.geohashLayer = null;
    }
    if (!data) {
      this.geoData = null;
      return;
    }
    if (!this.geoData || !data.featureCollection.features.length) {
      this.geoData = data;
      this.updateGeohashAgg();
    }
    this.geoData = data;
    this.recreateGeohashLayer();
  }

  private recreateGeohashLayer() {
    const map = this.map;
    const data = this.geoData;
    if (!map || !data) return;
    if (this.geohashLayer) {
      map.removeLayer(this.geohashLayer);
      this.geohashLayer = null;
    }
    this.geohashLayer = new GeohashLayer(data.featureCollection, data.meta, this.getGeohashOptions(), map.getZoomLevel(), map);
    map.addLayer(this.geohashLayer);
  }

  protected async updateParams(): Promise<void> {
    await super.updateParams();
    this.map?.setDesaturateBaseLayer(this.params.isDesaturated as boolean);
    // Options that change nothing drawn (the tooltip, the legend's place, the tiles) keep the layer
    const options = this.getGeohashOptions();
    if (!this.geohashLayer || !this.geohashLayer.isReusable(options)) {
      if (this.geoData) this.recreateGeohashLayer();
      this.updateDataInternal(this.geoData);
    }
  }

  private getGeohashOptions(): GeohashOptions {
    const params = this.getMapsParams();
    const data = this.geoData;
    const label = data?.metricLabel ?? '';
    const format = data?.metricFormat;
    return {
      label,
      valueFormatter: format ? (value: unknown) => format(value) : null,
      tooltipFormatter: format ? (feature: GeoFeature) => tooltipHtml(tooltipDetails(label, format, feature)) : null,
      mapType: params.mapType as string | undefined,
      isFilteredByCollar: Boolean(data?.geohash?.params.isFilteredByCollar ?? false),
      colorRamp: params.colorSchema as string | undefined,
      heatmap: { heatClusterSize: params.heatClusterSize },
      dark: this.deps.dark(),
    };
  }

  private addSpatialFilter(kind: 'geo_bounding_box' | 'geo_polygon', data: GeoBoundingBox | { points: Array<{ lat: number; lon: number }> }) {
    const agg = this.geoData?.geohash;
    if (!agg) return;
    this.deps.addFilters([spatialFilter(kind, agg.field, agg.indexId, data)]);
  }
}

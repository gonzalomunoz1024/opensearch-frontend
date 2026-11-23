/* SPDX-License-Identifier: Apache-2.0 */

/* The layer of a coordinate map's buckets: GeohashLayer of tile_map, around one kind of markers. */

import type { LatLngBounds, LeafletMouseEvent } from 'leaflet';
import { L } from '../../maps/leaflet';
import type { OsdMap } from '../../maps/osd_map';
import { OsdMapLayer } from '../../maps/osd_map_layer';
import { heatmapRadius, type GeoFeature, type GeoFeatureCollection, type GeoMeta } from './geo';
import { GeohashGridMarkers, HeatmapMarkers, ScaledCirclesMarkers, ShadedCirclesMarkers, type Markers } from './markers';

/** MapTypes of maps_legacy */
export const MAP_TYPES = {
  ScaledCircleMarkers: 'Scaled Circle Markers',
  ShadedCircleMarkers: 'Shaded Circle Markers',
  ShadedGeohashGrid: 'Shaded Geohash Grid',
  Heatmap: 'Heatmap',
} as const;

export interface GeohashOptions {
  label: string;
  valueFormatter: ((value: unknown) => string) | null;
  tooltipFormatter: ((feature: GeoFeature) => string) | null;
  mapType?: string;
  isFilteredByCollar: boolean;
  colorRamp?: string;
  heatmap: { heatClusterSize?: unknown };
  dark?: boolean;
}

export class GeohashLayer extends OsdMapLayer {
  private markers!: Markers;
  private readonly bounds: LatLngBounds;
  private lastBounds: LatLngBounds | null = null;

  constructor(
    private readonly featureCollection: GeoFeatureCollection,
    private readonly meta: GeoMeta,
    private readonly geohashOptions: GeohashOptions,
    private readonly zoom: number,
    private readonly osdMap: OsdMap
  ) {
    super();
    this.bounds = L.geoJson(featureCollection as unknown as Parameters<typeof L.geoJson>[0]).getBounds();
    this.createGeohashMarkers();
  }

  private createGeohashMarkers() {
    const options = this.geohashOptions;
    const markerOptions = {
      isFilteredByCollar: options.isFilteredByCollar,
      valueFormatter: options.valueFormatter,
      tooltipFormatter: options.tooltipFormatter,
      label: options.label,
      colorRamp: options.colorRamp,
      dark: options.dark,
    };
    switch (options.mapType) {
      case MAP_TYPES.ScaledCircleMarkers:
        this.markers = new ScaledCirclesMarkers(this.featureCollection, this.meta, markerOptions, this.zoom, this.osdMap);
        break;
      case MAP_TYPES.ShadedCircleMarkers:
        this.markers = new ShadedCirclesMarkers(this.featureCollection, this.meta, markerOptions, this.zoom, this.osdMap);
        break;
      case MAP_TYPES.ShadedGeohashGrid:
        this.markers = new GeohashGridMarkers(this.featureCollection, this.meta, markerOptions, this.zoom, this.osdMap);
        break;
      case MAP_TYPES.Heatmap: {
        const radius = heatmapRadius(this.meta, this.osdMap.getMetersPerPixel(), options.heatmap.heatClusterSize);
        this.markers = new HeatmapMarkers(
          this.featureCollection,
          { radius, blur: radius, maxZoom: this.osdMap.getZoomLevel(), minOpacity: 0.1, tooltipFormatter: options.tooltipFormatter },
          this.zoom,
          this.meta.max
        );
        break;
      }
      default:
        throw new Error(`${options.mapType} mapType not recognized`);
    }
    this.markers.on('showTooltip', (event: unknown) => this.emit('showTooltip', event));
    this.markers.on('hideTooltip', (event: unknown) => this.emit('hideTooltip', event));
    this.leafletLayer = this.markers.getLeafletLayer();
  }

  appendLegendContents(container: HTMLElement) {
    this.markers.appendLegendContents(container);
  }

  movePointer(type: 'mousemove' | 'mouseout' | 'mousedown' | 'mouseup', event: LeafletMouseEvent) {
    this.markers.movePointer(type, event);
  }

  async getBounds(): Promise<LatLngBounds | undefined> {
    return this.bounds;
  }

  updateExtent() {
    // Filtered here only when the search was not
    if (this.geohashOptions.isFilteredByCollar) return;
    const bounds = this.osdMap.getLeafletBounds();
    if (!this.lastBounds || !this.lastBounds.equals(bounds)) {
      // Taken off and put back, so that the filter runs again
      this.osdMap.removeLayer(this);
      this.createGeohashMarkers();
      this.osdMap.addLayer(this);
    }
    this.lastBounds = bounds;
  }

  /** Whether a change of options leaves the drawing as it is */
  isReusable(options: GeohashOptions): boolean {
    if (JSON.stringify(this.geohashOptions) === JSON.stringify(options) && this.sameFunctions(options)) return true;
    if (this.geohashOptions.colorRamp !== options.colorRamp) return false;
    if (this.geohashOptions.mapType !== options.mapType) return false;
    // As the original: the heat map's options are compared with the whole options, which differ
    if (this.geohashOptions.mapType === MAP_TYPES.Heatmap && JSON.stringify(this.geohashOptions.heatmap) !== JSON.stringify(options)) return false;
    return true;
  }

  private sameFunctions(options: GeohashOptions) {
    return this.geohashOptions.valueFormatter === options.valueFormatter && this.geohashOptions.tooltipFormatter === options.tooltipFormatter;
  }
}

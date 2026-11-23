/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The four ways a coordinate map draws its buckets (tile_map/public/markers): scaled circle
 * markers, shaded circle markers, a shaded geohash grid and a heat map. Each makes one Leaflet
 * layer, its part of the legend, and its tooltips.
 */

import type { GeoJSON, LatLng, LatLngBounds, Layer, LeafletMouseEvent, Path } from 'leaflet';
import { Emitter } from '../../maps/emitter';
import { L } from '../../maps/leaflet';
import type { OsdMap } from '../../maps/osd_map';
import {
  dataToHeatArray,
  distance,
  featuresPrecision,
  geohashMinDistance,
  heatmapTooltipProximity,
  legendEntries,
  legendColors,
  markerStyles,
  radiusScale,
  type GeoFeature,
  type GeoFeatureCollection,
  type GeoMeta,
} from './geo';
import { HeatLayer, type HeatLayerOptions } from './heat_layer';

export interface MarkerOptions {
  isFilteredByCollar?: boolean;
  valueFormatter?: ((value: unknown) => string) | null;
  tooltipFormatter?: ((feature: GeoFeature) => string) | null;
  label?: string;
  colorRamp?: string;
  /** The Atlas dark theme's colours for the two schemas made of status colours */
  dark?: boolean;
}

export interface Markers extends Emitter {
  getLeafletLayer(): Layer & { getBounds(): LatLngBounds };
  appendLegendContents(container: HTMLElement): void;
  movePointer(type: string, event: LeafletMouseEvent): void;
}

type GeoLayer = GeoJSON<GeoFeature['properties']>;

export class ScaledCirclesMarkers extends Emitter implements Markers {
  protected readonly leafletLayer: GeoLayer;
  private readonly valueFormatter: (value: unknown) => string;
  private readonly tooltipFormatter: (feature: GeoFeature) => string;
  private readonly label?: string;
  private legendColors: string[] = [];
  private popups = 0;

  constructor(
    protected readonly featureCollection: GeoFeatureCollection,
    protected readonly meta: GeoMeta,
    options: MarkerOptions,
    protected readonly zoom: number,
    osdMap: OsdMap
  ) {
    super();
    this.valueFormatter = options.valueFormatter || (() => '');
    this.tooltipFormatter = options.tooltipFormatter || (() => '');
    this.label = options.label;
    this.legendColors = legendColors(options.colorRamp, options.dark);
    const { style } = markerStyles(meta, this.legendColors);
    const pointToLayer = this.getMarkerFunction();
    this.leafletLayer = L.geoJson<GeoFeature['properties']>(null, {
      pointToLayer: (feature, latlng) => pointToLayer(feature as unknown as GeoFeature, latlng),
      style: (feature) => style(Number(feature?.properties.value)),
      onEachFeature: (feature, layer) => this.bindPopup(feature as unknown as GeoFeature, layer),
      // Filtered here when the search did not filter by the collar
      ...(!options.isFilteredByCollar
        ? {
            filter: (feature) => {
              const rectangle = (feature as unknown as GeoFeature).properties.geohash_meta.rectangle;
              return osdMap.isInside(L.latLngBounds(rectangle));
            },
          }
        : {}),
    });
    this.leafletLayer.addData(featureCollection as unknown as Parameters<GeoLayer['addData']>[0]);
  }

  getLeafletLayer() {
    return this.leafletLayer;
  }

  movePointer() {}

  private getLabel() {
    return this.popups ? (this.label ?? '') : '';
  }

  appendLegendContents(container: HTMLElement) {
    if (!this.legendColors.length) return;
    const title = document.createElement('div');
    title.className = 'visMapLegend__title';
    title.textContent = this.getLabel();
    container.appendChild(title);
    for (const entry of legendEntries(this.meta, this.legendColors, (value) => this.valueFormatter(value))) {
      const line = document.createElement('div');
      const icon = document.createElement('i');
      icon.style.background = entry.color;
      icon.style.borderColor = entry.border;
      const text = document.createElement('span');
      text.textContent = entry.label;
      line.append(icon, text);
      container.appendChild(line);
    }
  }

  private bindPopup(feature: GeoFeature, layer: Layer) {
    layer.on({
      mouseover: (event: { target: Path }) => {
        event.target.bringToFront();
        this.showTooltip(feature);
      },
      mouseout: () => this.emit('hideTooltip'),
    });
    this.popups += 1;
  }

  private showTooltip(feature: GeoFeature) {
    const content = this.tooltipFormatter(feature);
    if (!content) return;
    this.emit('showTooltip', { content, position: L.latLng(feature.geometry.coordinates[1], feature.geometry.coordinates[0]) });
  }

  protected getMarkerFunction(): (feature: GeoFeature, latlng: LatLng) => Layer {
    const scaleFactor = 0.6;
    const precision = featuresPrecision(this.featureCollection.features) ?? 0;
    return (feature, latlng) =>
      L.circleMarker(latlng).setRadius(radiusScale(feature.properties.value, this.meta.max, this.zoom, precision) * scaleFactor);
  }
}

export class ShadedCirclesMarkers extends ScaledCirclesMarkers {
  protected getMarkerFunction(): (feature: GeoFeature, latlng: LatLng) => Layer {
    // Smaller than the cell
    const scaleFactor = 0.8;
    return (feature, latlng) => L.circle(latlng, { radius: geohashMinDistance(feature.properties.geohash_meta) * scaleFactor });
  }
}

export class GeohashGridMarkers extends ScaledCirclesMarkers {
  protected getMarkerFunction(): (feature: GeoFeature, latlng: LatLng) => Layer {
    return (feature) => {
      const rectangle = feature.properties.geohash_meta.rectangle;
      // The north-east and south-west corners
      return L.rectangle([
        [rectangle[3][0], rectangle[3][1]],
        [rectangle[1][0], rectangle[1][1]],
      ]);
    };
  }
}

export interface HeatmapOptions extends HeatLayerOptions {
  tooltipFormatter?: ((feature: GeoFeature) => string) | null;
}

export class HeatmapMarkers extends Emitter implements Markers {
  private readonly leafletLayer: HeatLayer;
  private readonly tooltipFormatter: (feature: GeoFeature) => string;
  private disableTooltips = false;
  private lastMove = 0;

  constructor(
    private readonly featureCollection: GeoFeatureCollection,
    options: HeatmapOptions,
    private readonly zoom: number,
    max: number
  ) {
    super();
    const { tooltipFormatter, ...heatOptions } = options;
    this.leafletLayer = new HeatLayer(dataToHeatArray(featureCollection, max), heatOptions);
    this.tooltipFormatter = tooltipFormatter || (() => '');
  }

  getLeafletLayer() {
    return this.leafletLayer;
  }

  appendLegendContents() {}

  movePointer(type: string, event: LeafletMouseEvent) {
    if (type === 'mousemove') {
      // lodash's debounce of 15 ms, leading edge only
      const now = Date.now();
      const quiet = now - this.lastMove >= 15;
      this.lastMove = now;
      if (quiet) this.mouseMoveLocation(event);
    } else if (type === 'mouseout') this.emit('hideTooltip');
    else if (type === 'mousedown') {
      this.disableTooltips = true;
      this.emit('hideTooltip');
    } else if (type === 'mouseup') this.disableTooltips = false;
  }

  private mouseMoveLocation(event: LeafletMouseEvent) {
    if (!this.featureCollection.features.length || this.disableTooltips) {
      this.emit('hideTooltip');
      return;
    }
    const feature = this.nearestFeature(event.latlng);
    if (feature && this.tooltipProximity(event.latlng, feature)) {
      const content = this.tooltipFormatter(feature);
      if (!content) return;
      this.emit('showTooltip', { content, position: event.latlng });
    } else this.emit('hideTooltip');
  }

  private nearestFeature(latLng: LatLng): GeoFeature | undefined {
    if (latLng.lng < -180 || latLng.lng > 180) return undefined;
    let nearest: GeoFeature | undefined;
    let best = Infinity;
    for (const feature of this.featureCollection.features) {
      const [lng, lat] = feature.geometry.coordinates;
      const dist = distance(latLng.lat, latLng.lng, lat, lng);
      if (dist < best) {
        nearest = feature;
        best = dist;
      }
    }
    return nearest;
  }

  private tooltipProximity(latLng: LatLng, feature: GeoFeature): boolean {
    const [lng, lat] = feature.geometry.coordinates;
    const proximity = heatmapTooltipProximity(this.zoom);
    const dist = distance(latLng.lat, latLng.lng, lat, lng);
    // Not the same place on the next copy of the world
    const maxLngDif = 40;
    return dist < proximity && Math.abs(latLng.lng - lng) < maxLngDif;
  }
}

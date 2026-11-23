/* SPDX-License-Identifier: Apache-2.0 */

/*
 * A map with one base map and layers over it: OpenSearchDashboardsMap of maps_legacy, on
 * Leaflet 1.9.4. Its controls are those of the original: zoom, "Fit Data Bounds", the legend, the
 * attributions, and (for a coordinate map) the drawing of a filter.
 *
 * Events: 'zoomchange', 'zoomend', 'dragend', 'layers:update', 'baseLayer:loaded',
 * 'baseLayer:loading', 'drawCreated:rectangle' ({ bounds }), 'drawCreated:polygon' ({ points }).
 */

import type { Control, LatLngBounds, Layer, LeafletMouseEvent, Map as LeafletMap, Popup, TileLayer } from 'leaflet';
import { ORIGIN } from './config';
import { Emitter } from './emitter';
import { L } from './leaflet';
import { createRegionDeniedWarning, createZoomWarningMsg, removeRegionDeniedWarning } from './map_messages';
import type { OsdMapLayer } from './osd_map_layer';
import { zoomToPrecision } from './zoom_to_precision';

export interface OsdMapOptions {
  minZoom?: number;
  maxZoom?: number;
  center?: [number, number];
  zoom?: number;
  zoomControl?: boolean;
  scrollWheelZoom?: boolean;
}

export interface BaseLayerOptions {
  url?: string;
  minZoom?: number;
  maxZoom?: number;
  subdomains?: string[];
  attribution?: string;
  origin?: string;
  showZoomMessage?: boolean;
  showRegionDeniedWarning?: boolean;
  /** WMS */
  format?: string;
  layers?: string;
  styles?: string;
  transparent?: boolean;
  version?: string;
  [option: string]: unknown;
}

export interface BaseLayerSettings {
  baseLayerType: 'tms' | 'wms';
  options: BaseLayerOptions;
}

export interface GeoBounds {
  bottom_right: { lat: number; lon: number };
  top_left: { lat: number; lon: number };
}

/** Something that draws a filter on the map; set by the coordinate map's drawing tools */
export interface DrawControlFactory {
  (map: OsdMap, leafletMap: LeafletMap): Control;
}

let drawControlFactory: DrawControlFactory | undefined;

/** Registers what addDrawControl adds (the coordinate map's own drawing tools) */
export function setDrawControlFactory(factory: DrawControlFactory) {
  drawControlFactory = factory;
}

function getAttributionArray(attribution: string | undefined): string[] {
  const text = attribution || '';
  let attributions = text.split(/\s*\|\s*/);
  if (attributions.length === 1) attributions = attributions[0].split(',');
  return attributions;
}

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

const isEqual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The page's state a map keeps: where it is looked at, and the bounds the next search uses */
export interface MapVisState {
  getUiState(): { mapZoom?: number | string; mapCenter?: [number, number] };
  setUiState(key: 'mapZoom' | 'mapCenter', value: unknown): void;
  sessionState: { mapBounds?: GeoBounds | null };
}

export class OsdMap extends Emitter {
  private readonly leafletMap: LeafletMap;
  private leafletBaseLayer: TileLayer | null = null;
  private baseLayerSettings: BaseLayerSettings | null = null;
  private baseLayerIsDesaturated = true;
  private leafletDrawControl: Control | null = null;
  private leafletFitControl: Control | null = null;
  private leafletLegendControl: (Control & { updateContents(): void }) | null = null;
  private legendPosition: 'topleft' | 'topright' | 'bottomleft' | 'bottomright' = 'topright';
  private layers: OsdMapLayer[] = [];
  private layerListeners: Array<{ name: string; handle: (...args: never[]) => void; layer: OsdMapLayer }> = [];
  private showTooltip = false;
  private popup: Popup | null = null;

  constructor(
    private readonly containerNode: HTMLElement,
    options: OsdMapOptions = {}
  ) {
    super();
    this.leafletMap = L.map(containerNode, {
      minZoom: options.minZoom,
      maxZoom: options.maxZoom,
      center: options.center ? options.center : [0, 0],
      zoom: options.zoom ? options.zoom : 2,
      renderer: L.canvas(),
      // Desaturated tiles make the zoom animation leave artifacts
      zoomAnimation: false,
      zoomControl: options.zoomControl === undefined ? true : options.zoomControl,
    });
    this.leafletMap.attributionControl.setPrefix('');
    if (!options.scrollWheelZoom) this.leafletMap.scrollWheelZoom.disable();

    let previousZoom = this.leafletMap.getZoom();
    this.leafletMap.on('zoomend', () => {
      if (previousZoom !== this.leafletMap.getZoom()) {
        previousZoom = this.leafletMap.getZoom();
        this.emit('zoomchange');
      }
    });
    this.leafletMap.on('zoomend', () => this.emit('zoomend'));
    this.leafletMap.on('dragend', () => this.emit('dragend'));
    this.leafletMap.on('zoomend', () => this.updateExtent());
    this.leafletMap.on('dragend', () => this.updateExtent());
    for (const type of ['mousemove', 'mouseout', 'mousedown', 'mouseup'] as const) {
      this.leafletMap.on(type, (event: LeafletMouseEvent) => this.layers.forEach((layer) => layer.movePointer(type, event)));
    }
    this.resize();
  }

  /** The Leaflet map itself, for layers that draw on it */
  getLeafletMap(): LeafletMap {
    return this.leafletMap;
  }

  /** Called by the drawing tools when a rectangle or polygon has been drawn */
  drawCreated(kind: 'rectangle', bounds: LatLngBounds): void;
  drawCreated(kind: 'polygon', points: Array<{ lat: number; lng: number }>): void;
  drawCreated(kind: 'rectangle' | 'polygon', shape: LatLngBounds | Array<{ lat: number; lng: number }>): void {
    if (kind === 'rectangle') {
      const bounds = shape as LatLngBounds;
      const southEast = bounds.getSouthEast();
      const northWest = bounds.getNorthWest();
      let southEastLng = southEast.lng;
      if (southEastLng > 180) southEastLng -= 360;
      let northWestLng = northWest.lng;
      if (northWestLng < -180) northWestLng += 360;
      const southEastLat = southEast.lat;
      const northWestLat = northWest.lat;
      // An empty rectangle filters nothing
      if (southEastLat === northWestLat || southEastLng === northWestLng) return;
      this.emit('drawCreated:rectangle', {
        bounds: {
          bottom_right: { lat: southEastLat, lon: southEastLng },
          top_left: { lat: northWestLat, lon: northWestLng },
        },
      });
    } else {
      const points = shape as Array<{ lat: number; lng: number }>;
      this.emit('drawCreated:polygon', { points: points.map((point) => ({ lat: point.lat, lon: point.lng })) });
    }
  }

  setShowTooltip(showTooltip: boolean) {
    this.showTooltip = showTooltip;
  }

  getLayers(): OsdMapLayer[] {
    return this.layers.slice();
  }

  addLayer(layer: OsdMapLayer) {
    const onShowTooltip = (event: { content?: string | HTMLElement; position: { lat: number; lng: number } }) => {
      if (!this.showTooltip || !event.content) return;
      if (!this.popup) {
        this.popup = L.popup({ autoPan: false, className: 'leaflet-responsive-popup' });
        this.popup.setLatLng(event.position);
        this.popup.setContent(event.content);
        this.leafletMap.openPopup(this.popup);
      } else {
        if (!this.popup.getLatLng()?.equals(event.position)) this.popup.setLatLng(event.position);
        if (this.popup.getContent() !== event.content) this.popup.setContent(event.content);
      }
    };
    const onHideTooltip = () => {
      this.leafletMap.closePopup();
      this.popup = null;
    };
    const onStyleChanged = () => this.leafletLegendControl?.updateContents();
    layer.on('showTooltip', onShowTooltip);
    layer.on('hideTooltip', onHideTooltip);
    layer.on('styleChanged', onStyleChanged);
    this.layerListeners.push(
      { name: 'showTooltip', handle: onShowTooltip, layer },
      { name: 'hideTooltip', handle: onHideTooltip, layer },
      { name: 'styleChanged', handle: onStyleChanged, layer }
    );
    this.layers.push(layer);
    layer.addToLeafletMap(this.leafletMap);
    this.emit('layers:update');
    this.addAttributions(layer.getAttributions());
  }

  removeLayer(layer: OsdMapLayer | null | undefined) {
    if (!layer) return;
    this.removeAttributions(layer.getAttributions());
    const index = this.layers.indexOf(layer);
    if (index >= 0) {
      this.layers.splice(index, 1);
      layer.removeFromLeafletMap(this.leafletMap);
    }
    this.layerListeners = this.layerListeners.filter((listener) => {
      if (listener.layer !== layer) return true;
      listener.layer.removeListener(listener.name, listener.handle as never);
      return false;
    });
    // Another layer may share an attribution that was just taken off
    this.layers.forEach((other) => this.addAttributions(other.getAttributions()));
    if (this.baseLayerSettings) this.addAttributions(this.baseLayerSettings.options.attribution);
  }

  private addAttributions(attribution: string | undefined) {
    for (const item of getAttributionArray(attribution)) {
      this.leafletMap.attributionControl.removeAttribution(item);
      this.leafletMap.attributionControl.addAttribution(item);
    }
  }

  private removeAttributions(attribution: string | undefined) {
    for (const item of getAttributionArray(attribution)) this.leafletMap.attributionControl.removeAttribution(item);
  }

  destroy() {
    if (this.leafletFitControl) this.leafletMap.removeControl(this.leafletFitControl);
    if (this.leafletDrawControl) this.leafletMap.removeControl(this.leafletDrawControl);
    if (this.leafletLegendControl) this.leafletMap.removeControl(this.leafletLegendControl);
    this.setBaseLayer(null);
    while (this.layers.length) this.layers.pop()?.removeFromLeafletMap(this.leafletMap);
    this.leafletMap.remove();
    this.containerNode.innerHTML = '';
    for (const listener of this.layerListeners) listener.layer.removeListener(listener.name, listener.handle as never);
    this.layerListeners = [];
    this.removeAllListeners();
  }

  getCenter() {
    const center = this.leafletMap.getCenter();
    return { lon: center.lng, lat: center.lat };
  }

  setCenter(latitude: number, longitude: number) {
    const latLng = L.latLng(latitude, longitude);
    if (!latLng.equals(this.leafletMap.getCenter())) this.leafletMap.setView(latLng);
  }

  setZoomLevel(zoomLevel: number) {
    if (this.leafletMap.getZoom() !== zoomLevel) this.leafletMap.setZoom(zoomLevel);
  }

  getZoomLevel = () => this.leafletMap.getZoom();

  getMaxZoomLevel = () => this.leafletMap.getMaxZoom();

  getGeohashPrecision() {
    return zoomToPrecision(this.leafletMap.getZoom(), 12, this.leafletMap.getMaxZoom());
  }

  getLeafletBounds() {
    return this.leafletMap.getBounds();
  }

  getMetersPerPixel() {
    const pointC = this.leafletMap.latLngToContainerPoint(this.leafletMap.getCenter());
    const latLngC = this.leafletMap.containerPointToLatLng(pointC);
    const latLngX = this.leafletMap.containerPointToLatLng([pointC.x + 1, pointC.y]);
    const latLngY = this.leafletMap.containerPointToLatLng([pointC.x, pointC.y + 1]);
    return Math.min(latLngC.distanceTo(latLngX), latLngC.distanceTo(latLngY));
  }

  private boundsOrNull(resizeOnFail: boolean): LatLngBounds | null {
    const bounds = this.leafletMap.wrapLatLngBounds(this.leafletMap.getBounds());
    if (!bounds) return null;
    const southEast = bounds.getSouthEast();
    const northWest = bounds.getNorthWest();
    if (southEast.lng === northWest.lng || southEast.lat === northWest.lat) {
      if (resizeOnFail) {
        this.leafletMap.invalidateSize();
        return this.boundsOrNull(false);
      }
      return null;
    }
    return bounds;
  }

  /** What is in view, as a geo_bounding_box takes it */
  getBounds(): GeoBounds | null {
    const bounds = this.boundsOrNull(true);
    if (!bounds) return null;
    const southEast = bounds.getSouthEast();
    const northWest = bounds.getNorthWest();
    return {
      bottom_right: { lat: southEast.lat, lon: southEast.lng },
      top_left: { lat: northWest.lat, lon: northWest.lng },
    };
  }

  setDesaturateBaseLayer(isDesaturated: boolean) {
    if (isDesaturated === this.baseLayerIsDesaturated) return;
    this.baseLayerIsDesaturated = isDesaturated;
    this.updateDesaturation();
    this.leafletBaseLayer?.redraw();
  }

  addDrawControl() {
    if (!drawControlFactory || this.leafletDrawControl) return;
    this.leafletDrawControl = drawControlFactory(this, this.leafletMap);
    this.leafletMap.addControl(this.leafletDrawControl);
  }

  addFitControl() {
    if (this.leafletFitControl) return;
    const container = L.DomUtil.create('div', 'leaflet-control leaflet-bar leaflet-control-fit');
    const control = new L.Control({ position: 'topleft' });
    control.onAdd = () => {
      const label = 'Fit Data Bounds';
      container.innerHTML = `<a class="mapButton fa-crop" href="#" title="${label}" aria-label="${label}"></a>`;
      container.onclick = (event) => {
        event.preventDefault();
        void this.fitToData();
      };
      return container;
    };
    control.onRemove = () => {
      container.onclick = null;
    };
    this.leafletFitControl = control;
    this.leafletMap.addControl(control);
  }

  addLegendControl() {
    if (this.leafletLegendControl) return;
    this.updateLegend();
  }

  private addMaxZoomMessage(layer: Layer) {
    const zoomWarningMsg = createZoomWarningMsg(this.getZoomLevel, this.getMaxZoomLevel);
    this.leafletMap.on('zoomend', zoomWarningMsg);
    this.containerNode.setAttribute('data-test-subj', 'zoomWarningEnabled');
    layer.on('remove', () => {
      this.leafletMap.off('zoomend', zoomWarningMsg);
      this.containerNode.removeAttribute('data-test-subj');
    });
  }

  setLegendPosition(position: OsdMap['legendPosition'] | undefined) {
    const next = position ?? 'topright';
    if (this.legendPosition === next) {
      if (!this.leafletLegendControl) this.updateLegend();
    } else {
      this.legendPosition = next;
      this.updateLegend();
    }
  }

  private updateLegend() {
    if (this.leafletLegendControl) this.leafletMap.removeControl(this.leafletLegendControl);
    const wrapper = document.createElement('div');
    wrapper.className = 'visMapLegend__wrapper';
    const control = new L.Control({ position: this.legendPosition }) as Control & { updateContents(): void };
    const updateContents = () => {
      wrapper.innerHTML = '';
      const legend = document.createElement('div');
      legend.className = 'visMapLegend';
      wrapper.appendChild(legend);
      for (const layer of this.layers) layer.appendLegendContents(legend);
    };
    control.updateContents = updateContents;
    const onUpdate = () => updateContents();
    control.onAdd = () => {
      this.on('layers:update', onUpdate);
      updateContents();
      return wrapper;
    };
    control.onRemove = () => {
      this.removeListener('layers:update', onUpdate);
      wrapper.innerHTML = '';
    };
    this.leafletLegendControl = control;
    this.leafletMap.addControl(control);
  }

  resize() {
    this.leafletMap.invalidateSize();
    this.updateExtent();
  }

  setMinZoom(zoom: number | undefined) {
    if (zoom !== undefined) this.leafletMap.setMinZoom(zoom);
  }

  setMaxZoom(zoom: number | undefined) {
    if (zoom !== undefined) this.leafletMap.setMaxZoom(zoom);
  }

  getLeafletBaseLayer() {
    return this.leafletBaseLayer;
  }

  setBaseLayer(settings: BaseLayerSettings | null) {
    if (isEqual(settings, this.baseLayerSettings)) return;
    if (settings === null) {
      if (this.leafletBaseLayer) {
        this.removeAttributions(this.baseLayerSettings?.options.attribution);
        this.leafletMap.removeLayer(this.leafletBaseLayer);
        this.leafletBaseLayer = null;
        this.baseLayerSettings = null;
      }
      return;
    }
    this.baseLayerSettings = settings;
    if (this.leafletBaseLayer) {
      this.leafletMap.removeLayer(this.leafletBaseLayer);
      this.leafletBaseLayer = null;
    }
    let baseLayer: TileLayer | null = null;
    if (settings.baseLayerType === 'wms') {
      settings.options.attribution = escapeHtml(String(settings.options.attribution ?? ''));
      baseLayer = this.getWMSBaseLayer(settings.options);
    } else if (settings.baseLayerType === 'tms') {
      baseLayer = this.getTMSBaseLayer(settings.options);
    }
    if (!baseLayer) return;
    baseLayer.on('tileload', () => this.updateDesaturation());
    baseLayer.on('load', () => this.emit('baseLayer:loaded'));
    baseLayer.on('loading', () => this.emit('baseLayer:loading'));
    baseLayer.on('tileerror', () => {
      if (settings.options.showRegionDeniedWarning) createRegionDeniedWarning();
    });
    this.leafletBaseLayer = baseLayer;
    if (settings.options.showZoomMessage) {
      const layer = baseLayer;
      baseLayer.on('add', () => this.addMaxZoomMessage(layer));
    }
    baseLayer.addTo(this.leafletMap);
    baseLayer.bringToBack();
    if (settings.options.minZoom !== undefined && settings.options.minZoom > this.leafletMap.getZoom()) {
      this.leafletMap.setZoom(settings.options.minZoom);
    }
    this.addAttributions(settings.options.attribution);
    this.resize();
  }

  isInside(bounds: LatLngBounds) {
    return this.leafletMap.getBounds().intersects(bounds);
  }

  async fitToData() {
    const all = await Promise.all(this.layers.map((layer) => layer.getBounds()));
    let bounds: LatLngBounds | null = null;
    for (const each of all) {
      if (!each) continue;
      if (bounds) bounds.extend(each);
      else bounds = L.latLngBounds(each.getSouthWest(), each.getNorthEast());
    }
    if (bounds && bounds.isValid()) this.leafletMap.fitBounds(bounds);
  }

  private getTMSBaseLayer(options: BaseLayerOptions): TileLayer {
    // Passed as it is: without an address (an unreachable maps service) Leaflet throws as it does in the original
    return L.tileLayer(options.url as string, {
      minZoom: options.minZoom,
      maxZoom: options.maxZoom,
      subdomains: options.subdomains || [],
    });
  }

  private getWMSBaseLayer(options: BaseLayerOptions): TileLayer | null {
    const wmsOptions = {
      format: options.format || '',
      layers: options.layers || '',
      minZoom: options.minZoom,
      maxZoom: options.maxZoom,
      styles: options.styles || '',
      transparent: options.transparent,
      version: options.version || '1.3.0',
    };
    return typeof options.url === 'string' && options.url.length ? L.tileLayer.wms(options.url, wmsOptions) : null;
  }

  private updateExtent() {
    for (const layer of this.layers) layer.updateExtent();
  }

  private updateDesaturation() {
    removeRegionDeniedWarning();
    // As the original: every loaded tile of the page, not only this map's
    const tiles = document.querySelectorAll('img.leaflet-tile-loaded');
    const off = this.baseLayerSettings?.options.origin === ORIGIN.EMS || !this.baseLayerIsDesaturated;
    tiles.forEach((tile) => tile.classList.toggle('filters-off', off));
  }

  /** Keeps where the map is looked at in the visualization's state, as the original does */
  persistUiStateForVisualization(vis: MapVisState) {
    const persist = () => {
      const uiState = vis.getUiState();
      const zoomFromUiState = parseInt(String(uiState.mapZoom), 10);
      if (Number.isNaN(zoomFromUiState) || this.getZoomLevel() !== zoomFromUiState) {
        vis.setUiState('mapZoom', this.getZoomLevel());
      }
      const center = this.getCenter();
      const centerFromUiState = vis.getUiState().mapCenter;
      if (!centerFromUiState || center.lon !== centerFromUiState[1] || center.lat !== centerFromUiState[0]) {
        vis.setUiState('mapCenter', [center.lat, center.lon]);
      }
    };
    this.leafletMap.on('resize', () => {
      vis.sessionState.mapBounds = this.getBounds();
    });
    this.leafletMap.on('load', () => {
      vis.sessionState.mapBounds = this.getBounds();
    });
    this.on('dragend', persist);
    this.on('zoomend', persist);
  }

  useUiStateFromVisualization(vis: MapVisState) {
    const uiState = vis.getUiState();
    const zoom = parseInt(String(uiState.mapZoom), 10);
    if (!Number.isNaN(zoom)) this.setZoomLevel(zoom);
    if (uiState.mapCenter) this.setCenter(uiState.mapCenter[0], uiState.mapCenter[1]);
  }
}

/* SPDX-License-Identifier: Apache-2.0 */

/*
 * A Vega view drawn over a map, as OpenSearch Dashboards draws one: the Vega layer for Leaflet it
 * uses (leaflet-vega 0.9.0, with the spec injector it relies on) and VegaMapLayer, the map layer
 * that holds it. The spec gets the signals the map sets (latitude, longitude, zoom), a projection
 * that follows them, no padding and no autosize; the view is drawn again when the map moves, and
 * the map moves when the spec sets those signals or calls setMapView().
 */

import type { LatLng, Map as LeafletMap } from 'leaflet';
import { L } from '../../maps/leaflet';
import { OsdMapLayer } from '../../maps/osd_map_layer';
import type { Fn, VegaLibrary, VegaView } from './library';
import { SpecInjector, defaultProjection, readSetMapView } from './map_spec';

type Spec = Record<string, unknown>;
type Handler = (...args: unknown[]) => void;

export interface VegaLayerOptions {
  vega: VegaLibrary;
  /** Where the controls of bound signals go */
  bindingsContainer?: HTMLElement;
  /** Passed to Vega's parse */
  parseConfig?: unknown;
  parseOptions?: { ast: boolean };
  /** Passed to Vega's View */
  viewConfig?: Record<string, unknown>;
  /** Draws again only once the map has stopped moving */
  delayRepaint: boolean;
  onWarning?: Handler;
  onError?: Handler;
}

/** setMapView() is one of Vega's functions for every view; it answers only views of a map layer */
function registerSetMapView(vega: VegaLibrary) {
  if (vega.expressionFunction('setMapView')) return;
  vega.expressionFunction('setMapView', function setMapView(this: { context: { dataflow: VegaView } }, ...args: unknown[]) {
    const view = this.context.dataflow;
    const handler = view.Leaflet_setMapViewHandler;
    if (!handler) throw new Error('setMapView() is not defined for this graph');
    view.runAfter(() => handler(...args));
  } as Fn);
}

/** The Leaflet layer a Vega view draws in, over the base map */
export class VegaLayer extends L.Layer {
  readonly vegaOptions: VegaLayerOptions;
  readonly spec: Spec;
  view: VegaView | null = null;
  private vegaContainer: HTMLElement | null = null;
  private leafletMap: LeafletMap | null = null;
  private ignoreSignals = 0;

  constructor(spec: Spec, options: VegaLayerOptions) {
    super();
    this.vegaOptions = options;
    registerSetMapView(options.vega);
    // the signals and projection the map drives, set in the spec itself
    const injector = new SpecInjector((...args) => options.onWarning?.(...args));
    injector.overrideField(spec, 'padding', 0);
    injector.overrideField(spec, 'autosize', 'none');
    injector.addToList(spec, 'signals', ['zoom', 'latitude', 'longitude']);
    injector.addToList(spec, 'projections', [defaultProjection()]);
    this.spec = spec;
  }

  private disableSignals() {
    this.ignoreSignals++;
  }

  private enableSignals() {
    this.ignoreSignals--;
    if (this.ignoreSignals < 0) {
      this.ignoreSignals = 0;
      throw new Error('Too many calls to enableSignals()');
    }
  }

  onAdd(map: LeafletMap): this {
    void this.addAsync(map);
    return this;
  }

  private async addAsync(map: LeafletMap) {
    this.disableSignals();
    try {
      this.leafletMap = map;
      const container = L.DomUtil.create('div', 'leaflet-vega-container');
      this.vegaContainer = container;
      map.getPanes().overlayPane.appendChild(container);

      const { vega, viewConfig } = this.vegaOptions;
      const dataflow = vega.parse(this.spec, this.vegaOptions.parseConfig ?? null, this.vegaOptions.parseOptions ?? { ast: false });
      const view = new vega.View(dataflow, viewConfig ?? {});
      this.view = view;
      if (!viewConfig || viewConfig.logLevel === undefined) view.logLevel(vega.Warn);
      if (this.vegaOptions.onWarning) view.warn = this.vegaOptions.onWarning;
      if (this.vegaOptions.onError) view.error = this.vegaOptions.onError;

      view.padding({ left: 0, right: 0, top: 0, bottom: 0 }).initialize(container, this.vegaOptions.bindingsContainer).hover();

      const onSignal = (name: unknown, value: unknown) => this.onSignalChange(String(name), value);
      view.addSignalListener('latitude', onSignal).addSignalListener('longitude', onSignal).addSignalListener('zoom', onSignal);

      map.on(this.vegaOptions.delayRepaint ? 'moveend' : 'move', () => void this.resetAsync());
      map.on('zoomend', () => void this.resetAsync());

      view.Leaflet_setMapViewHandler = (...args: unknown[]) => {
        const target = readSetMapView(args);
        if (!target) return;
        if ('bounds' in target) {
          const [[lng1, lat1], [lng2, lat2]] = target.bounds;
          map.fitBounds(L.latLngBounds(L.latLng(lat1, lng1), L.latLng(lat2, lng2)));
        } else {
          map.setView({ lat: target.lat, lng: target.lng }, target.zoom === undefined ? map.getZoom() : target.zoom);
        }
      };
      await this.resetAsync(true);
    } catch (failure) {
      this.reportError(failure);
    } finally {
      this.enableSignals();
    }
  }

  onRemove(): this {
    if (this.view) {
      this.view.finalize();
      this.view = null;
    }
    this.vegaContainer?.replaceChildren();
    return this;
  }

  private reportError(failure: unknown) {
    if (this.vegaOptions.onError) this.vegaOptions.onError(failure);
    else console.error(failure);
  }

  /** The spec set latitude, longitude or zoom: the map goes there */
  private onSignalChange(name: string, value: unknown) {
    if (this.ignoreSignals || !this.leafletMap) return;
    try {
      const map = this.leafletMap;
      const center: LatLng = map.getCenter();
      let zoom = map.getZoom();
      switch (name) {
        case 'latitude':
          center.lat = value as number;
          break;
        case 'longitude':
          center.lng = value as number;
          break;
        case 'zoom':
          zoom = value as number;
          break;
        default:
          return;
      }
      map.setView(center, zoom);
    } catch (failure) {
      this.reportError(failure);
    }
  }

  /** The map moved: the view takes its place over the map and its size, center and zoom */
  private async resetAsync(force?: boolean) {
    const view = this.view;
    const map = this.leafletMap;
    if (!view || !map || !this.vegaContainer) return;
    this.disableSignals();
    try {
      L.DomUtil.setPosition(this.vegaContainer, map.containerPointToLayerPoint([0, 0]));
      const size = map.getSize();
      const center = map.getCenter();
      const zoom = map.getZoom();
      // only the signals that changed, and a run only when one did
      const send = (name: string, value: unknown) => {
        if (view.signal(name) !== value) {
          view.signal(name, value);
          return 1;
        }
        return 0;
      };
      const changed =
        send('width', size.x) + send('height', size.y) + send('latitude', center.lat) + send('longitude', center.lng) + send('zoom', zoom);
      if (changed > 0 || force) await view.runAsync();
    } catch (failure) {
      this.reportError(failure);
    } finally {
      this.enableSignals();
    }
  }
}

/** The map layer of a Vega map: OpenSearch Dashboards' VegaMapLayer */
export class VegaMapLayer extends OsdMapLayer {
  private readonly vegaLayer: VegaLayer;

  constructor(spec: Spec, options: VegaLayerOptions & { attribution?: string }) {
    super();
    const { attribution, ...layerOptions } = options;
    this.attribution = attribution;
    this.vegaLayer = new VegaLayer(spec, layerOptions);
    this.leafletLayer = this.vegaLayer;
  }

  getVegaView(): VegaView | null {
    return this.vegaLayer.view;
  }

  getVegaSpec(): Spec {
    return this.vegaLayer.spec;
  }
}

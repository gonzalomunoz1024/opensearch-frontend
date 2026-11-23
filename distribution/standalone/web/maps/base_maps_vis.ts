/* SPDX-License-Identifier: Apache-2.0 */

/*
 * A visualization made of a map with one base map: BaseMapsVisualization of maps_legacy. A kind
 * (coordinate map, region map) extends it and draws its data in updateData; the React side is
 * MapVisContainer in ./map_vis_container.
 */

import { services } from '../services';
import { getServiceSettings, type TmsService } from './service_settings';
import { OsdMap, type MapVisState } from './osd_map';

const WMS_MINZOOM = 0;
const WMS_MAXZOOM = 22;

export interface WmsParams {
  enabled?: boolean;
  url?: string;
  options?: Record<string, unknown>;
  selectedTmsLayer?: TmsService;
}

export interface MapsParams {
  type?: string;
  legendPosition?: 'topleft' | 'topright' | 'bottomleft' | 'bottomright';
  addTooltip?: boolean;
  isDesaturated?: boolean;
  mapZoom?: number;
  mapCenter?: [number, number];
  wms?: WmsParams;
  [param: string]: unknown;
}

/** What a map visualization is given by the page around it */
export interface MapVisHost extends MapVisState {
  /** The defaults of the kind, under the saved params (vis.type.visConfig.defaults) */
  defaults: MapsParams;
  params: MapsParams;
}

export abstract class BaseMapsVis<Data = unknown> {
  protected map: OsdMap | null = null;
  protected chartData: Data | null = null;
  protected params: MapsParams = {};
  private baseLayerDirty = true;
  private readonly mapIsLoaded: Promise<void>;

  constructor(
    protected readonly container: HTMLElement,
    protected readonly vis: MapVisHost
  ) {
    this.params = vis.params;
    this.mapIsLoaded = this.makeMap();
  }

  isLoaded() {
    return this.mapIsLoaded;
  }

  /** The element changed size */
  resize() {
    this.map?.resize();
  }

  destroy() {
    if (this.map) {
      this.map.destroy();
      this.map = null;
    }
  }

  /** Draws the visualization with this answer and these parameters */
  async render(data: Data, params: MapsParams): Promise<void> {
    if (!this.map) return;
    await this.mapIsLoaded;
    if (!this.map) return;
    this.map.resize();
    this.params = params;
    await this.updateParams();
    if (this.chartData !== data) await this.updateData(data);
    this.map?.useUiStateFromVisualization(this.vis);
    await this.whenBaseLayerIsLoaded();
  }

  /** The map, with the controls of every map visualization */
  protected async makeMap(): Promise<void> {
    const uiState = this.vis.getUiState();
    const zoomFromUiState = parseInt(String(uiState.mapZoom), 10);
    const options = {
      zoom: !Number.isNaN(zoomFromUiState) ? zoomFromUiState : this.vis.params.mapZoom,
      center: uiState.mapCenter ? uiState.mapCenter : this.vis.params.mapCenter,
    };
    this.map = new OsdMap(this.container, options);
    this.map.setMinZoom(WMS_MINZOOM);
    this.map.setMaxZoom(WMS_MAXZOOM);
    this.map.addLegendControl();
    this.map.addFitControl();
    this.map.persistUiStateForVisualization(this.vis);
    this.map.on('baseLayer:loaded', () => {
      this.baseLayerDirty = false;
    });
    this.map.on('baseLayer:loading', () => {
      this.baseLayerDirty = true;
    });
    await this.updateBaseLayer();
  }

  private tmsConfigured() {
    const { wms } = this.getMapsParams();
    return !!wms && !!wms.selectedTmsLayer;
  }

  private wmsConfigured() {
    const { wms } = this.getMapsParams();
    return !!wms && !!wms.enabled;
  }

  protected async updateBaseLayer(): Promise<void> {
    if (!this.map) return;
    const emsTileLayerId = services.boot.map.emsTileLayerId;
    const mapParams = this.getMapsParams();
    if (!this.tmsConfigured()) {
      try {
        const tmsServices = await this.serviceSettings().getTMSServices();
        const initBasemapLayer = tmsServices[0] ? tmsServices[0] : tmsServices.find((s) => s.id === emsTileLayerId.bright);
        if (initBasemapLayer) this.setTmsLayerUnwaited(initBasemapLayer);
      } catch (error) {
        services.toasts.warning(error instanceof Error ? error.message : String(error));
      }
      return;
    }
    try {
      if (this.wmsConfigured()) {
        const currentMaxZoomLevel = this.map.getMaxZoomLevel();
        if (WMS_MINZOOM < currentMaxZoomLevel || WMS_MAXZOOM > currentMaxZoomLevel) {
          this.map.setMinZoom(WMS_MINZOOM);
          this.map.setMaxZoom(WMS_MAXZOOM);
        }
        this.map.setBaseLayer({
          baseLayerType: 'wms',
          options: { minZoom: WMS_MINZOOM, maxZoom: WMS_MAXZOOM, url: mapParams.wms?.url, ...mapParams.wms?.options },
        });
      } else if (mapParams.wms?.selectedTmsLayer) {
        this.setTmsLayerUnwaited(mapParams.wms.selectedTmsLayer);
      }
    } catch (error) {
      services.toasts.warning(error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Sets a TMS layer without waiting for it, as the original's _updateBaseLayer calls _setTmsLayer:
   * a failure to reach the maps service is no toast, only an error in the console
   */
  private setTmsLayerUnwaited(tmsLayer: TmsService) {
    this.setTmsLayer(tmsLayer).catch((error: unknown) => console.error(error));
  }

  protected serviceSettings() {
    return getServiceSettings(services.boot.map, services.boot.version);
  }

  private async setTmsLayer(tmsLayer: TmsService) {
    if (!this.map) return;
    this.map.setMinZoom(tmsLayer.minZoom);
    this.map.setMaxZoom(tmsLayer.maxZoom);
    if (tmsLayer.maxZoom !== undefined && this.map.getZoomLevel() > tmsLayer.maxZoom) this.map.setZoomLevel(tmsLayer.maxZoom);
    let isDesaturated = this.getMapsParams().isDesaturated;
    if (typeof isDesaturated !== 'boolean') isDesaturated = true;
    const isDarkMode = services.uiSettings.get<boolean>('theme:darkMode', false) === true;
    const settings = this.serviceSettings();
    const meta = await settings.getAttributesForTMSLayer(tmsLayer, isDesaturated, isDarkMode);
    const showZoomMessage = settings.shouldShowZoomMessage(tmsLayer);
    const showRegionDeniedWarning = settings.shouldShowRegionDeniedWarning();
    const options: Record<string, unknown> = { ...tmsLayer };
    delete options.id;
    delete options.subdomains;
    // An unreachable maps service answers with a list, which spreads into its indexes as the original's does
    this.map?.setBaseLayer({
      baseLayerType: 'tms',
      options: { ...options, showZoomMessage, showRegionDeniedWarning, ...meta },
    });
  }

  /** Draws the answer of a search */
  protected abstract updateData(data: Data): Promise<void>;

  /** Called when the parameters change */
  protected async updateParams(): Promise<void> {
    if (!this.map) return;
    const mapParams = this.getMapsParams();
    await this.updateBaseLayer();
    this.map?.setLegendPosition(mapParams.legendPosition);
    this.map?.setShowTooltip(mapParams.addTooltip === true);
    this.map?.useUiStateFromVisualization(this.vis);
  }

  protected getMapsParams(): MapsParams {
    return { ...this.vis.defaults, ...this.params };
  }

  private whenBaseLayerIsLoaded(): Promise<void> | void {
    if (!this.tmsConfigured()) return;
    return new Promise((resolve) => {
      const started = Date.now();
      const check = () => {
        if (!this.baseLayerDirty || Date.now() - started >= 10000) resolve();
        else window.setTimeout(check, 10);
      };
      check();
    });
  }
}

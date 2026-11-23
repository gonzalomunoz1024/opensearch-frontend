/* SPDX-License-Identifier: Apache-2.0 */

/*
 * A Vega spec drawn on a map (`config.kibana.type: "map"`), as OpenSearch Dashboards draws it:
 * the base map of the maps service unless the spec asks for none, the zoom limits of that base map,
 * and the spec's view in a layer over it. Its quirks are kept: a style the maps service does not
 * have, or a maps service that cannot be reached, fails as it fails there.
 */

import type { MapConfig as MapsSettings } from '../../maps/config';
import { OsdMap, type BaseLayerOptions } from '../../maps/osd_map';
import type { ServiceSettings, TmsAttributes, TmsService } from '../../maps/service_settings';
import { VegaMapLayer } from './map_layer';
import { VegaBaseView, type VegaViewOptions } from './view';
import '../../styles/maps.css';

export interface VegaMapViewOptions extends VegaViewOptions {
  serviceSettings: ServiceSettings;
  /** The map.* settings: the ids of the maps service's styles, and its warning about regions */
  mapSettings: Pick<MapsSettings, 'emsTileLayerId' | 'showRegionDeniedWarning'>;
  darkMode: boolean;
}

export class VegaMapView extends VegaBaseView {
  constructor(private readonly mapOptions: VegaMapViewOptions) {
    super(mapOptions);
  }

  protected async initViewCustomizations() {
    const mapConfig = this.parser.mapConfig;
    if (!mapConfig) return;
    const { serviceSettings, mapSettings, darkMode } = this.mapOptions;
    let baseMapOpts: (Partial<TmsService> & Partial<TmsAttributes> & { showRegionDeniedWarning?: boolean }) | undefined;
    let limitMinZ = 0;
    let limitMaxZ = 25;

    if (mapConfig.mapStyle !== false) {
      const tmsServices = await serviceSettings.getTMSServices();
      // the view may have been taken down meanwhile
      if (!this.container) return;
      const mapStyle = mapConfig.mapStyle === 'default' ? mapSettings.emsTileLayerId.bright : mapConfig.mapStyle;
      const service = tmsServices.find((candidate) => candidate.id === mapStyle);
      // as the original: a style that is not there fails here, and an unreachable service gives a
      // list whose entries are spread in, so the base map has no address
      const attributes = await serviceSettings.getAttributesForTMSLayer(service as TmsService, true, darkMode);
      baseMapOpts = { ...service, ...attributes, showRegionDeniedWarning: mapSettings.showRegionDeniedWarning };
      limitMinZ = baseMapOpts.minZoom as number;
      limitMaxZ = baseMapOpts.maxZoom as number;
    }

    const validate = (name: string, value: number | undefined, fallback: number, min: number, max: number) => {
      if (value === undefined) return fallback;
      if (value < min) {
        this.onWarn(`Resetting "${name}" to ${min}`);
        return min;
      }
      if (value > max) {
        this.onWarn(`Resetting "${name}" to ${max}`);
        return max;
      }
      return value;
    };

    let minZoom = validate('minZoom', mapConfig.minZoom, limitMinZ, limitMinZ, limitMaxZ);
    let maxZoom = validate('maxZoom', mapConfig.maxZoom, limitMaxZ, limitMinZ, limitMaxZ);
    if (minZoom > maxZoom) {
      this.onWarn('"minZoom" and "maxZoom" have been swapped');
      [minZoom, maxZoom] = [maxZoom, minZoom];
    }
    const zoom = validate('zoom', mapConfig.zoom, 2, minZoom, maxZoom);

    if (!this.container) return;
    const map = new OsdMap(this.container, {
      zoom,
      minZoom,
      maxZoom,
      center: [mapConfig.latitude, mapConfig.longitude],
      zoomControl: mapConfig.zoomControl,
      scrollWheelZoom: mapConfig.scrollWheelZoom,
    });

    if (baseMapOpts) map.setBaseLayer({ baseLayerType: 'tms', options: baseMapOpts as BaseLayerOptions });

    const { vega } = this.libraries;
    const vegaMapLayer = new VegaMapLayer(this.parser.vegaSpec as Record<string, unknown>, {
      vega,
      bindingsContainer: this.controls ?? undefined,
      delayRepaint: mapConfig.delayRepaint,
      viewConfig: this.viewConfig ?? undefined,
      parseConfig: null,
      parseOptions: this.viewOptions ?? undefined,
      onWarning: this.onWarn.bind(this),
      onError: this.onError.bind(this),
    });
    map.addLayer(vegaMapLayer);

    const hadBaseMap = Boolean(baseMapOpts);
    this.addDestroyHandler(() => {
      map.removeLayer(vegaMapLayer);
      if (hadBaseMap) map.setBaseLayer(null);
      map.destroy();
    });

    const vegaView = vegaMapLayer.getVegaView();
    await this.setView(vegaView);
    if (vegaView) this.setDebugValues(vegaView, this.parser.vegaSpec, this.parser.vlspec);
  }
}

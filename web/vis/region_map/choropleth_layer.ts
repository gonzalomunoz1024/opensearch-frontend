/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The shapes of a region map: ChoroplethLayer of region_map. It loads a vector map (GeoJSON or
 * TopoJSON from a file, or the documents of a custom "*-map" index), joins each shape to the
 * term of the same value of its join field, colours the joined shapes by where their value falls
 * between the smallest and the largest, and draws a legend of four ranges.
 */

import type { GeoJSON, GeoJsonFeature, GeoJsonFeatureCollection, LatLngBounds, Layer, PathOptions } from 'leaflet';
import { L } from '../../maps/leaflet';
import { OsdMapLayer } from '../../maps/osd_map_layer';
import type { FileLayer, ServiceSettings } from '../../maps/service_settings';
import { services } from '../../services';
import { truncatedColorRamp } from './color_maps';
import { CUSTOM_MAP_CHOICE, CUSTOM_VECTOR_MAP_MAX_SIZE_SETTING, DEFAULT_MAP_CHOICE } from './region_map_type';
import { topojsonFeature, type Topology } from './topojson';
import {
  compareLexicographically,
  doInnerJoin,
  getChoroplethColor,
  getLegendColors,
  getMinMax,
  makeColorDarker,
  quantizeExtent,
  type Feature,
  type RegionMetric,
  type ValueFormatter,
} from './util';

export type { RegionMetric } from './util';
export type TooltipFormatter = (feature: Feature) => string;

function emptyStyleColor(): string {
  if (typeof document === 'undefined') return '#86868b';
  const value = getComputedStyle(document.documentElement).getPropertyValue('--color-text-tertiary').trim();
  return value || '#86868b';
}

function removeKeys(source: Record<string, unknown>): Record<string, unknown> {
  for (const key of ['id', 'location']) delete source[key];
  return source;
}

const DEFAULT_RAMP = truncatedColorRamp('Blues') ?? [];

export class ChoroplethLayer extends OsdMapLayer {
  private metrics: RegionMetric[] | null = null;
  private joinField: string | null = null;
  private colorRamp: string[] = DEFAULT_RAMP;
  private lineWeight = 1;
  private tooltipFormatter: TooltipFormatter = () => '';
  private boundsOfData: LatLngBounds | null = null;
  private sortedFeatures: Feature[] | null = null;
  private loaded = false;
  private error = false;
  private isJoinValid = false;
  private legendColors?: string[];
  private legendDomain?: [number, number];
  private valueFormatter: ValueFormatter = String;
  private metricTitle = '';
  private readonly dataLoaded: Promise<void>;
  protected declare leafletLayer: GeoJSON;

  constructor(
    private readonly layerName: string,
    attribution: string,
    format: FileLayer['format'] | undefined,
    private readonly showAllShapes: boolean,
    meta: FileLayer['meta'],
    private readonly layerConfig: FileLayer,
    private readonly serviceSettings: ServiceSettings,
    private layerChosenByUser: string | undefined
  ) {
    super();
    this.attribution = attribution;
    this.leafletLayer = L.geoJson(null, {
      onEachFeature: (feature: GeoJsonFeature, layer: Layer) => {
        layer.on('click', () => {
          this.emit('select', feature.properties[this.joinField ?? '']);
        });
        let location: ReturnType<LatLngBounds['getCenter']> | null = null;
        layer.on({
          mouseover: () => {
            const tooltipContents = this.tooltipFormatter(feature);
            if (!location) location = L.geoJson(feature).getBounds().getCenter();
            this.emit('showTooltip', { content: tooltipContents, position: location });
          },
          mouseout: () => {
            this.emit('hideTooltip');
          },
        });
      },
      style: this.makeEmptyStyleFunction(),
    });

    this.dataLoaded = this.load(format, meta);
  }

  private async load(format: FileLayer['format'] | undefined, meta: FileLayer['meta']): Promise<void> {
    try {
      let data: unknown;
      if (DEFAULT_MAP_CHOICE === this.layerChosenByUser) {
        data = await this.makeJsonAjaxCall();
      } else if (CUSTOM_MAP_CHOICE === this.layerChosenByUser) {
        data = await this.fetchCustomLayerData();
      } else {
        return;
      }
      let formatType: string;
      if (typeof format === 'string') formatType = format;
      else if (format && format.type) formatType = format.type;
      else formatType = 'geojson';

      let featureCollection: GeoJsonFeatureCollection;
      if (formatType === 'geojson') {
        featureCollection = data as GeoJsonFeatureCollection;
      } else if (formatType === 'topojson') {
        const topology = data as Topology;
        const object = getPath(topology?.objects, meta?.feature_collection_path);
        featureCollection = topojsonFeature(topology, object as Topology['objects'][string]) as GeoJsonFeatureCollection;
      } else {
        throw new Error(`Unrecognized format ${formatType}`);
      }
      this.sortedFeatures = featureCollection.features.slice();
      this.sortFeatures();
      // Without all shapes, the data is added once the join says which shapes have a term
      if (this.showAllShapes) this.leafletLayer.addData(featureCollection);
      this.loaded = true;
      this.setStyle();
    } catch (failure) {
      this.loaded = true;
      this.error = true;
      const status = (failure as { status?: number } | null)?.status;
      const errorMessage =
        status === 404
          ? `Server responding with '404' when attempting to fetch ${this.layerName}. Make sure the file exists at that location.`
          : `The vector map ${this.layerName} is not available. Please ensure the CORS configuration of the server permits requests from the OpenSearch Dashboards application on this host.`;
      services.toasts.danger('Error downloading vector data', errorMessage);
    }
  }

  /** The vector map from its file */
  protected makeJsonAjaxCall(): Promise<unknown> {
    return this.serviceSettings.getJsonForRegionLayer(this.layerConfig);
  }

  /** The vector map from the documents of a custom "*-map" index: their `location` and the rest */
  protected async fetchCustomLayerData(): Promise<GeoJsonFeatureCollection | false> {
    try {
      const size = services.uiSettings.get<number>(CUSTOM_VECTOR_MAP_MAX_SIZE_SETTING, 1000);
      const result = await services.http.post<{ resp: { hits: { hits: Array<{ _source: Record<string, unknown> }> } } }>(
        '/api/geospatial/_search',
        { body: { index: this.layerName, size }, query: { dataSourceId: '' } }
      );
      const finalResult: GeoJsonFeatureCollection = { type: 'FeatureCollection', features: [] };
      for (const hit of result.resp.hits.hits) {
        finalResult.features.push({
          geometry: hit._source.location as GeoJsonFeature['geometry'],
          properties: removeKeys(hit._source),
          type: 'Feature',
        });
      }
      return finalResult;
    } catch {
      return false;
    }
  }

  private invalidateJoin() {
    this.isJoinValid = false;
  }

  private setStyle() {
    if (this.error || !this.loaded || !this.metrics || !this.joinField || !this.sortedFeatures) return;
    if (!this.isJoinValid) {
      doInnerJoin(this.metrics, this.sortedFeatures, this.joinField);
      this.isJoinValid = true;
      if (!this.showAllShapes) {
        this.leafletLayer.addData({
          type: 'FeatureCollection',
          features: this.sortedFeatures.filter((feature) => feature.__osdJoinedMetric),
        });
      }
    }
    const styler = this.makeChoroplethStyler(this.metrics, this.sortedFeatures);
    this.leafletLayer.setStyle(styler.leafletStyleFunction as (feature?: GeoJsonFeature) => PathOptions);
    if (this.metrics.length > 0) {
      const { min, max } = getMinMax(this.metrics);
      this.legendColors = getLegendColors(this.colorRamp);
      // d3.scale.quantize's own domain is [0, 1]
      this.legendDomain = min !== max ? [min, max] : [0, 1];
    }
    this.boundsOfData = styler.getLeafletBounds();
    this.emit('styleChanged', { mismatches: styler.getMismatches() });
  }

  getUrl() {
    return this.layerName;
  }

  setTooltipFormatter(
    tooltipFormatter: (metric: RegionMetric | undefined, fieldFormatter: ValueFormatter | undefined, fieldName?: string, metricName?: string) => string,
    fieldFormatter?: ValueFormatter,
    fieldName?: string,
    metricLabel?: string
  ) {
    this.tooltipFormatter = (feature) => {
      if (!this.metrics) return '';
      const match = this.metrics.find(
        (bucket) => compareLexicographically(bucket.term, feature.properties[this.joinField ?? '']) === 0
      );
      return tooltipFormatter(match, fieldFormatter, fieldName, metricLabel);
    };
  }

  setJoinField(joinField: string) {
    if (joinField === this.joinField) return;
    this.joinField = joinField;
    this.sortFeatures();
    this.setStyle();
  }

  cloneChoroplethLayerForNewData(
    name: string,
    attribution: string,
    format: FileLayer['format'] | undefined,
    showAllData: boolean,
    meta: FileLayer['meta'],
    layerConfig: FileLayer,
    serviceSettings: ServiceSettings,
    layerChosenByUser: string | undefined
  ): ChoroplethLayer {
    const cloned = new ChoroplethLayer(name, attribution, format, showAllData, meta, layerConfig, serviceSettings, layerChosenByUser);
    if (this.joinField) cloned.setJoinField(this.joinField);
    cloned.setColorRamp(this.colorRamp);
    cloned.setLineWeight(this.lineWeight);
    cloned.tooltipFormatter = this.tooltipFormatter;
    if (this.metrics) cloned.setMetrics(this.metrics, this.valueFormatter, this.metricTitle);
    return cloned;
  }

  private sortFeatures() {
    if (this.sortedFeatures && this.joinField) {
      const field = this.joinField;
      this.sortedFeatures.sort((a, b) => compareLexicographically(a.properties[field], b.properties[field]));
      this.invalidateJoin();
    }
  }

  whenDataLoaded() {
    return this.dataLoaded;
  }

  setLayerChosenByUser(layerChosenByUser: string | undefined) {
    this.layerChosenByUser = layerChosenByUser;
  }

  setMetrics(metrics: RegionMetric[], valueFormatter: ValueFormatter, metricTitle: string) {
    this.metrics = metrics.slice();
    this.valueFormatter = valueFormatter;
    this.metricTitle = metricTitle;
    this.metrics.sort((a, b) => compareLexicographically(a.term, b.term));
    this.invalidateJoin();
    this.setStyle();
  }

  setColorRamp(colorRamp: string[]) {
    if (colorRamp.length === this.colorRamp.length && colorRamp.every((color, i) => color === this.colorRamp[i])) return;
    this.colorRamp = colorRamp;
    this.setStyle();
  }

  setLineWeight(lineWeight: number) {
    if (this.lineWeight === lineWeight) return;
    this.lineWeight = lineWeight;
    this.setStyle();
  }

  canReuseInstance(name: string, showAllShapes: boolean) {
    return this.layerName === name && this.showAllShapes === showAllShapes;
  }

  canReuseInstanceForNewMetrics(name: string, showAllShapes: boolean, newMetrics: RegionMetric[]): boolean | undefined {
    if (this.layerName !== name) return false;
    if (showAllShapes) return this.showAllShapes === showAllShapes;
    if (!this.metrics) return undefined;
    // As the original: the keys of two arrays, which are their indexes
    return Object.keys(this.metrics).join() === Object.keys(newMetrics).join();
  }

  async getBounds(): Promise<LatLngBounds | undefined> {
    const bounds = await super.getBounds();
    return this.boundsOfData ? this.boundsOfData : bounds;
  }

  appendLegendContents(container: HTMLElement): void {
    if (!this.legendColors || !this.legendDomain) return;
    const title = document.createElement('div');
    title.className = 'visMapLegend__title';
    title.textContent = this.metricTitle;
    container.appendChild(title);
    const colors = this.legendColors;
    const domain = this.legendDomain;
    colors.forEach((color) => {
      const labelText = quantizeExtent(domain, colors.length, colors.indexOf(color))
        .map((value) => this.valueFormatter(value))
        .join(' –\u00a0');
      const label = document.createElement('div');
      const icon = document.createElement('i');
      icon.style.background = color;
      icon.style.borderColor = makeColorDarker(color);
      const text = document.createElement('span');
      text.textContent = labelText;
      label.appendChild(icon);
      label.appendChild(text);
      container.appendChild(label);
    });
  }

  private makeEmptyStyleFunction(): () => PathOptions {
    const emptyStyle: PathOptions = { weight: this.lineWeight, opacity: 0.6, color: emptyStyleColor(), fillOpacity: 0 };
    return () => emptyStyle;
  }

  private makeChoroplethStyler(metrics: RegionMetric[], sortedFeatures: Feature[]) {
    const emptyStyle = this.makeEmptyStyleFunction();
    if (metrics.length === 0) {
      return {
        leafletStyleFunction: () => emptyStyle(),
        getMismatches: (): unknown[] => [],
        getLeafletBounds: (): LatLngBounds | null => null,
      };
    }
    const { min, max } = getMinMax(metrics);
    const boundsOfAllFeatures = new L.LatLngBounds([]);
    return {
      leafletStyleFunction: (feature: Feature): PathOptions => {
        const match = feature.__osdJoinedMetric;
        if (!match) return emptyStyle();
        boundsOfAllFeatures.extend(L.geoJson(feature).getBounds());
        return {
          fillColor: getChoroplethColor(match.value, min, max, this.colorRamp),
          weight: this.lineWeight,
          opacity: 1,
          color: 'white',
          fillOpacity: 0.7,
        };
      },
      // Not to be called before the style function has been
      getMismatches: (): unknown[] => {
        const mismatches = metrics.slice();
        sortedFeatures.forEach((feature) => {
          const index = feature.__osdJoinedMetric ? mismatches.indexOf(feature.__osdJoinedMetric) : -1;
          if (index >= 0) mismatches.splice(index, 1);
        });
        return mismatches.map((bucket) => bucket.term);
      },
      getLeafletBounds: (): LatLngBounds | null => (boundsOfAllFeatures.isValid() ? boundsOfAllFeatures : null),
    };
  }
}

/** _.get of a dotted path */
function getPath(source: unknown, path: string | undefined): unknown {
  if (path === undefined) return undefined;
  let current = source;
  for (const key of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

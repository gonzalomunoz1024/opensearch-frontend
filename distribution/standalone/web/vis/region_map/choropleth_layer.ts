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

/** A term of the answer and its value */
export interface RegionMetric {
  term: unknown;
  value: number;
}

type Feature = GeoJsonFeature & { __osdJoinedMetric?: RegionMetric | null };
type ValueFormatter = (value: unknown) => string;
export type TooltipFormatter = (feature: Feature) => string;

// --- The pieces of colorUtil and d3 the layer uses ---------------------------------------------------

/** colorUtil.getLegendColors of maps_legacy: the first, the last and evenly between */
export function getLegendColors(colorRamp: string[], numLegendColors = 4): string[] {
  const colors: string[] = [];
  colors[0] = colorRamp[0];
  for (let i = 1; i < numLegendColors - 1; i++) {
    colors[i] = colorRamp[Math.floor((colorRamp.length * i) / numLegendColors)];
  }
  colors[numLegendColors - 1] = colorRamp[colorRamp.length - 1];
  return colors;
}

/** The colour of a value between min and max, as getChoroplethColor of the original */
export function getChoroplethColor(value: number, min: number, max: number, colorRamp: string[]): string {
  if (min === max) return colorRamp[colorRamp.length - 1];
  const fraction = (value - min) / (max - min);
  const index = Math.round(colorRamp.length * fraction) - 1;
  const i = Math.max(Math.min(colorRamp.length - 1, index), 0);
  return colorRamp[i];
}

/** The range of values d3.scale.quantize gives the n-th of `count` colours, over a domain */
export function quantizeExtent(domain: [number, number], count: number, index: number): [number, number] {
  const [x0, x1] = domain;
  // d3 3's invertExtent, with the colour's first place in the range
  const kx = count / (x1 - x0);
  const y = index < 0 ? NaN : index / kx + x0;
  return [y, y + 1 / kx];
}

export function getMinMax(data: RegionMetric[]): { min: number; max: number } {
  let min = data[0].value;
  let max = data[0].value;
  for (let i = 1; i < data.length; i += 1) {
    min = Math.min(data[i].value, min);
    max = Math.max(data[i].value, max);
  }
  return { min, max };
}

/** The lexicographic order of the original: terms and properties compared as text */
export function compareLexicographically(termA: unknown, termB: unknown): number {
  const a = typeof termA === 'string' ? termA : String((termA as { toString(): string }).toString());
  const b = typeof termB === 'string' ? termB : String((termB as { toString(): string }).toString());
  return a.localeCompare(b);
}

/** The inner join of sorted terms and sorted shapes, which marks each shape with its term */
export function doInnerJoin(sortedMetrics: RegionMetric[], sortedFeatures: Feature[], joinField: string): void {
  let j = 0;
  for (let i = 0; i < sortedFeatures.length; i++) {
    const property = sortedFeatures[i].properties[joinField];
    sortedFeatures[i].__osdJoinedMetric = null;
    const position = sortedMetrics.length ? compareLexicographically(property, sortedMetrics[j].term) : -1;
    if (position === -1) {
      // just need to cycle on
    } else if (position === 0) {
      sortedFeatures[i].__osdJoinedMetric = sortedMetrics[j];
    } else if (position === 1) {
      // needs to catch up
      while (j < sortedMetrics.length) {
        const newPosition = compareLexicographically(sortedMetrics[j].term, property);
        if (newPosition === 0) {
          sortedFeatures[i].__osdJoinedMetric = sortedMetrics[j];
          break;
        } else if (newPosition === 1) {
          break;
        }
        if (j === sortedMetrics.length - 1) break;
        j++;
      }
    }
  }
}

/** d3.hcl(color).darker(1.3) of d3 3, as the legend outlines its swatches */
export function makeColorDarker(color: string): string {
  const match = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(color);
  if (!match) return color;
  const [r, g, b] = [Number(match[1]), Number(match[2]), Number(match[3])];
  // rgb -> xyz -> lab -> hcl, as d3 3
  const toLinear = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);
  const Xn = 0.95047;
  const Yn = 1;
  const Zn = 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.pow(t, 1 / 3) : 7.787037 * t + 4 / 29);
  const x = f((0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb) / Xn);
  const y = f((0.2126729 * lr + 0.7151522 * lg + 0.072175 * lb) / Yn);
  const z = f((0.0193339 * lr + 0.119192 * lg + 0.9503041 * lb) / Zn);
  const lab = { l: 116 * y - 16, a: 500 * (x - y), b: 200 * (y - z) };
  const h = (Math.atan2(lab.b, lab.a) * 180) / Math.PI;
  const c = Math.sqrt(lab.a * lab.a + lab.b * lab.b);
  // darker: l - 18 * k
  const l = lab.l - 18 * 1.3;
  // hcl -> lab -> rgb
  const hr = (h * Math.PI) / 180;
  const A = Math.cos(hr) * c;
  const B = Math.sin(hr) * c;
  let yy = (l + 16) / 116;
  let xx = yy + A / 500;
  let zz = yy - B / 200;
  const finv = (t: number) => (t > 0.206893034 ? t * t * t : (t - 4 / 29) / 7.787037);
  xx = finv(xx) * Xn;
  yy = finv(yy) * Yn;
  zz = finv(zz) * Zn;
  const toRgb = (v: number) => Math.round(255 * (v <= 0.00304 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055));
  const rr = toRgb(3.2404542 * xx - 1.5371385 * yy - 0.4985314 * zz);
  const gg = toRgb(-0.969266 * xx + 1.8760108 * yy + 0.041556 * zz);
  const bb = toRgb(0.0556434 * xx - 0.2040259 * yy + 1.0572252 * zz);
  const hex = (v: number) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0');
  return `#${hex(rr)}${hex(gg)}${hex(bb)}`;
}

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

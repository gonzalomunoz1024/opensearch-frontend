/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The parts of the coordinate map that are plain computation, as tile_map and maps_legacy of
 * OpenSearch Dashboards 3.9.0 do them: the answer as GeoJSON (convert_to_geojson), the collar
 * around the map (scaleBounds), the precision of the next search, the colours and sizes of the
 * markers (d3 v3's quantize scale and hcl().darker()), the tooltip and the filters a drawn shape
 * stands for. Nothing here touches Leaflet or the page.
 */

import { decodeGeoHash, geoContains, getPrecision, getZoomPrecision, type GeoBoundingBox } from '../../maps/geohash';

// --- The answer as GeoJSON --------------------------------------------------------------------------

export interface GeohashMeta {
  /** [lat, lon] of the cell's centre */
  center: [number, number];
  /** The cell's corners as [lat, lon]: south-west, south-east, north-east, north-west */
  rectangle: Array<[number, number]>;
}

export interface GeoFeature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: { geohash: string; geohash_meta: GeohashMeta; value: number };
}

export interface GeoFeatureCollection {
  type: 'FeatureCollection';
  features: GeoFeature[];
}

export interface GeoMeta {
  min: number;
  max: number;
  geohashPrecision?: number;
  geohashGridDimensionsAtEquator?: [number, number];
}

/** The cell width and height in metres at the equator, per geohash precision (grid_dimensions.js) */
const GRID_AT_EQUATOR: Record<number, [number, number]> = {
  1: [5009400, 4992600],
  2: [1252300, 624100],
  3: [156500, 156000],
  4: [39100, 19500],
  5: [4900, 4900],
  6: [1200, 609.4],
  7: [152.9, 152.4],
  8: [38.2, 19],
  9: [4.8, 4.8],
  10: [1.2, 0.595],
  11: [0.149, 0.149],
  12: [0.037, 0.019],
};

export const gridDimensions = (precision: number | undefined): [number, number] | undefined =>
  precision === undefined ? undefined : GRID_AT_EQUATOR[precision];

const clampGrid = (value: number, min: number, max: number) => (value > max ? max : value < min ? min : value);

export interface GeoRow {
  geohash: unknown;
  value: unknown;
  centroid?: unknown;
}

/** convertToGeoJson: one point per geohash bucket, at its centroid when it was asked for */
export function convertToGeoJson(
  rows: GeoRow[] | null,
  options: { precision?: number; useGeocentroid?: boolean; hasCentroid?: boolean }
): { featureCollection: GeoFeatureCollection; meta: GeoMeta } {
  let min = Infinity;
  let max = -Infinity;
  const features: GeoFeature[] = [];
  for (const row of rows ?? []) {
    if (!row.geohash) continue;
    const geohash = String(row.geohash);
    const location = decodeGeoHash(geohash);
    let point: [number, number];
    const centroid = row.centroid as { lat?: number; lon?: number } | null | undefined;
    if (options.hasCentroid) point = [Number(centroid?.lon), Number(centroid?.lat)];
    else point = [location.longitude[2], location.latitude[2]];
    if (options.useGeocentroid) {
      // A centroid can fall outside its cell (elasticsearch#24694)
      point[0] = clampGrid(point[0], location.longitude[0], location.longitude[1]);
      point[1] = clampGrid(point[1], location.latitude[0], location.latitude[1]);
    }
    const value = row.value as number;
    min = Math.min(min, value);
    max = Math.max(max, value);
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: point },
      properties: {
        geohash,
        geohash_meta: {
          center: [location.latitude[2], location.longitude[2]],
          rectangle: [
            [location.latitude[0], location.longitude[0]],
            [location.latitude[0], location.longitude[1]],
            [location.latitude[1], location.longitude[1]],
            [location.latitude[1], location.longitude[0]],
          ],
        },
        value,
      },
    });
  }
  return {
    featureCollection: { type: 'FeatureCollection', features },
    meta: {
      min,
      max,
      geohashPrecision: options.precision,
      geohashGridDimensionsAtEquator: gridDimensions(options.precision),
    },
  };
}

// --- The collar and the next search --------------------------------------------------------------

/** lodash's round: to a number of decimals, without the errors of floating point */
export function round(value: number, precision: number): number {
  const shifted = Math.round(Number(`${value}e${precision}`));
  return Number(`${shifted}e-${precision}`);
}

/** The bounds made larger by half on each side, within the world: the area a search asks for */
export function scaleBounds(bounds: GeoBoundingBox): GeoBoundingBox {
  const scale = 0.5;
  const topLeft = bounds.top_left;
  const bottomRight = bounds.bottom_right;
  let latDiff = round(Math.abs(topLeft.lat - bottomRight.lat), 5);
  const lonDiff = round(Math.abs(bottomRight.lon - topLeft.lon), 5);
  // The map can have no height when it is first made
  if (latDiff === 0) latDiff = lonDiff;
  const latDelta = latDiff * scale;
  let topLeftLat = round(topLeft.lat, 5) + latDelta;
  if (topLeftLat > 90) topLeftLat = 90;
  let bottomRightLat = round(bottomRight.lat, 5) - latDelta;
  if (bottomRightLat < -90) bottomRightLat = -90;
  const lonDelta = lonDiff * scale;
  let topLeftLon = round(topLeft.lon, 5) - lonDelta;
  if (topLeftLon < -180) topLeftLon = -180;
  let bottomRightLon = round(bottomRight.lon, 5) + lonDelta;
  if (bottomRightLon > 180) bottomRightLon = 180;
  return {
    top_left: { lat: topLeftLat, lon: topLeftLon },
    bottom_right: { lat: bottomRightLat, lon: bottomRightLon },
  };
}

/** The params of the geohash_grid that the last search used */
export interface GeohashAggParams {
  autoPrecision?: boolean;
  precision?: unknown;
  boundingBox?: GeoBoundingBox | null;
  isFilteredByCollar?: boolean;
  useGeocentroid?: boolean;
}

/**
 * updateGeohashAgg: the bounding box and precision the next search takes. The box stays the one
 * already asked for while it holds the collar of what is in view.
 */
export function nextGeohashParams(
  requested: GeohashAggParams,
  bounds: GeoBoundingBox,
  mapZoom: number | undefined,
  maxPrecision: number
): { boundingBox: GeoBoundingBox | null | undefined; precision: number | undefined } {
  const mapCollar = scaleBounds(bounds);
  const boundingBox = !geoContains(requested.boundingBox, mapCollar)
    ? { top_left: mapCollar.top_left, bottom_right: mapCollar.bottom_right }
    : requested.boundingBox;
  const precision = requested.autoPrecision
    ? getZoomPrecision(maxPrecision)[mapZoom as number]
    : getPrecision(requested.precision, maxPrecision);
  return { boundingBox, precision };
}

/** Whether the embeddable searches again: the precision or the box differ from the aggregation's */
export function needsNewSearch(
  current: { precision?: unknown; boundingBox?: unknown },
  next: { precision?: unknown; boundingBox?: unknown }
): boolean {
  return current.precision !== next.precision || JSON.stringify(current.boundingBox ?? null) !== JSON.stringify(next.boundingBox ?? null);
}

/** The setting visualization:tileMap:maxPrecision as precision.ts reads it */
export const maxPrecisionOf = (setting: unknown) => parseInt(String(setting), 10) || 12;

// --- Colours ----------------------------------------------------------------------------------------

/**
 * The four colours of the legend of each colour schema: getLegendColors of maps_legacy over the
 * truncated colour maps of the charts plugin, as the Atlas theme's palette makes them (light and
 * dark: the last two schemas run between the theme's status colours).
 */
const LEGEND_COLORS: Record<string, { light: string[]; dark?: string[] }> = {
  Blues: { light: ['rgb(216,226,239)', 'rgb(187,206,227)', 'rgb(158,185,215)', 'rgb(96,146,192)'] },
  Greens: { light: ['rgb(204,227,222)', 'rgb(166,207,197)', 'rgb(127,186,173)', 'rgb(32,146,128)'] },
  Greys: { light: ['rgb(194,201,211)', 'rgb(154,161,175)', 'rgb(117,124,137)', 'rgb(52,55,65)'] },
  Reds: { light: ['rgb(249,212,204)', 'rgb(241,181,168)', 'rgb(231,150,132)', 'rgb(204,86,66)'] },
  'Yellow to Red': {
    light: ['rgb(255,126,12)', 'rgb(255,110,21)', 'rgb(255,93,30)', 'rgb(255,59,48)'],
    dark: ['rgb(255,136,22)', 'rgb(255,120,31)', 'rgb(255,103,40)', 'rgb(255,69,58)'],
  },
  'Green to Red': {
    light: ['rgb(154,174,44)', 'rgb(230,155,11)', 'rgb(255,126,12)', 'rgb(255,59,48)'],
    dark: ['rgb(152,184,49)', 'rgb(229,165,20)', 'rgb(255,136,22)', 'rgb(255,69,58)'],
  },
};

/** The colour schemas a coordinate map offers (truncatedColorSchemas) */
export const COLOR_SCHEMAS = Object.keys(LEGEND_COLORS);

/** The legend's colours of a schema; an unknown schema has none, as the original's */
export function legendColors(schema: string | undefined, dark = false): string[] {
  const entry = schema ? LEGEND_COLORS[schema] : undefined;
  if (!entry) return [];
  return dark && entry.dark ? entry.dark : entry.light;
}

/** d3 v3's quantize scale: a domain cut into as many equal parts as the range has values */
export function quantize<T>(domain: [number, number], range: T[]) {
  const [x0, x1] = domain;
  const n = range.length;
  const kx = n / (x1 - x0);
  const scale = (x: number): T => range[Math.max(0, Math.min(n - 1, Math.floor(kx * (x - x0))))];
  scale.invertExtent = (y: T): [number, number] => {
    const index = range.indexOf(y);
    const from = index < 0 ? NaN : index / kx + x0;
    return [from, from + 1 / kx];
  };
  return scale;
}

function parseRgb(color: string): [number, number, number] {
  const rgb = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(color);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  if (hex) return [parseInt(hex[1], 16), parseInt(hex[2], 16), parseInt(hex[3], 16)];
  return [0, 0, 0];
}

// d3 v3's CIE Lab: white point D65
const LAB_X = 0.95047;
const LAB_Z = 1.08883;
const LAB_K = 18;
const rgbToXyz = (v: number) => ((v /= 255) <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const xyzToLab = (x: number) => (x > 0.008856 ? Math.pow(x, 1 / 3) : 7.787037 * x + 4 / 29);
const labToXyz = (x: number) => (x > 0.206893034 ? x * x * x : (x - 4 / 29) / 7.787037);
const xyzToRgb = (r: number) => Math.round(255 * (r <= 0.00304 ? 12.92 * r : 1.055 * Math.pow(r, 1 / 2.4) - 0.055));
const hexPart = (v: number) => (v < 16 ? '0' + Math.max(0, v).toString(16) : Math.min(255, v).toString(16));

/** d3.hcl(color).darker(k).toString(), as d3 v3 computes it: a #rrggbb colour */
export function darker(color: string, k = 1): string {
  const [r0, g0, b0] = parseRgb(color);
  const r = rgbToXyz(r0);
  const g = rgbToXyz(g0);
  const b = rgbToXyz(b0);
  const x = xyzToLab((0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / LAB_X);
  const y = xyzToLab(0.2126729 * r + 0.7151522 * g + 0.072175 * b);
  const z = xyzToLab((0.0193339 * r + 0.119192 * g + 0.9503041 * b) / LAB_Z);
  const l = 116 * y - 16;
  const a = 500 * (x - y);
  const bb = 200 * (y - z);
  let h = l > 0 ? Math.atan2(bb, a) * (180 / Math.PI) : NaN;
  let c = l > 0 ? Math.sqrt(a * a + bb * bb) : NaN;
  const l2 = l - LAB_K * k;
  if (Number.isNaN(h)) h = 0;
  if (Number.isNaN(c)) c = 0;
  const hr = h * (Math.PI / 180);
  const la = Math.cos(hr) * c;
  const lb = Math.sin(hr) * c;
  let yy = (l2 + 16) / 116;
  let xx = yy + la / 500;
  let zz = yy - lb / 200;
  xx = labToXyz(xx) * LAB_X;
  yy = labToXyz(yy);
  zz = labToXyz(zz) * LAB_Z;
  const out = [
    xyzToRgb(3.2404542 * xx - 1.5371385 * yy - 0.4985314 * zz),
    xyzToRgb(-0.969266 * xx + 1.8760108 * yy + 0.041556 * zz),
    xyzToRgb(0.0556434 * xx - 0.2040259 * yy + 1.0572252 * zz),
  ];
  return '#' + out.map(hexPart).join('');
}

/** makeColorDarker of the markers: the outline of a marker and of its legend entry */
export const makeColorDarker = (color: string) => darker(color, 1.3);

export interface MarkerStyle {
  fillColor: string;
  color: string;
  weight: number;
  opacity: number;
  fillOpacity: number;
}

/** The legend's quantizer and the style of each marker by its value */
export function markerStyles(meta: Pick<GeoMeta, 'min' | 'max'> | null | undefined, colors: string[]) {
  const min = meta?.min ?? 0;
  const max = meta?.max ?? 1;
  const domain: [number, number] = min !== max ? [min, max] : [0, 1];
  const quantizer = quantize(domain, colors);
  const style = (value: number): MarkerStyle => {
    const color = quantizer(value);
    return { fillColor: color, color: makeColorDarker(color), weight: 1.5, opacity: 1, fillOpacity: 0.75 };
  };
  return { domain, quantizer, style };
}

/** The legend's lines: a colour, its outline and the values it stands for */
export function legendEntries(meta: Pick<GeoMeta, 'min' | 'max'> | null | undefined, colors: string[], format: (value: number) => string) {
  const { quantizer } = markerStyles(meta, colors);
  return colors.map((color) => ({
    color,
    border: makeColorDarker(color),
    label: quantizer.invertExtent(color).map(format).join(' – '),
  }));
}

// --- Sizes ------------------------------------------------------------------------------------------

/** _radiusScale of the scaled circle markers, in pixels before the factor of 0.6 */
export function radiusScale(value: number, max: number, zoom: number, precision: number): number {
  const precisionBiasBase = 5;
  const precisionBiasNumerator = 200;
  const pct = Math.abs(value) / Math.abs(max);
  const zoomRadius = 0.5 * Math.pow(2, zoom);
  const precisionScale = precisionBiasNumerator / Math.pow(precisionBiasBase, precision);
  return Math.pow(pct, 0.5) * zoomRadius * precisionScale;
}

/** The longest geohash among the features: the precision a scaled circle is sized by */
export const featuresPrecision = (features: GeoFeature[]) =>
  features.reduce<number | undefined>((longest, feature) => {
    const length = String(feature.properties.geohash).length;
    return longest === undefined || length > longest ? length : longest;
  }, undefined);

/** Leaflet's CRS.Earth.distance: metres between two points on a sphere of 6371 km */
export function distance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = Math.PI / 180;
  const a1 = lat1 * rad;
  const a2 = lat2 * rad;
  const sinDLat = Math.sin(((lat2 - lat1) * rad) / 2);
  const sinDLon = Math.sin(((lng2 - lng1) * rad) / 2);
  const a = sinDLat * sinDLat + Math.cos(a1) * Math.cos(a2) * sinDLon * sinDLon;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return 6371000 * c;
}

/** _geohashMinDistance of the shaded circles: the largest radius that fits the cell, in metres */
export function geohashMinDistance(meta: GeohashMeta): number {
  const [lat, lng] = meta.center;
  const east = Math.floor(distance(lat, lng, lat, meta.rectangle[2][1]));
  const north = Math.floor(distance(lat, lng, meta.rectangle[3][0], lng));
  return Math.min(east, north);
}

/** The radius of the heat of each point, in pixels, before the cluster size */
export function heatmapRadius(meta: GeoMeta, metersPerPixel: number, heatClusterSize: unknown): number {
  let radius = 15;
  if (meta.geohashGridDimensionsAtEquator) {
    const minGridLength = Math.min(...meta.geohashGridDimensionsAtEquator);
    radius = minGridLength / metersPerPixel / 2;
  }
  return radius * parseFloat(String(heatClusterSize));
}

/** dataToHeatArray: [lat, lng, the value over the largest value] */
export const dataToHeatArray = (collection: GeoFeatureCollection, max: number): Array<[number, number, number]> =>
  collection.features.map((feature) => [feature.geometry.coordinates[1], feature.geometry.coordinates[0], feature.properties.value / max]);

/** d3 v3's linear scale over several segments, not clamped */
export function polylinear(domain: number[], range: number[]) {
  const k = Math.min(domain.length, range.length) - 1;
  return (x: number) => {
    let index = 1;
    while (index < k && domain[index] <= x) index += 1;
    const i = index - 1;
    const t = (x - domain[i]) / (domain[i + 1] - domain[i]);
    return range[i] + (range[i + 1] - range[i]) * t;
  };
}

/** The distance in metres within which a heat map's point shows its tooltip, by zoom */
export const heatmapTooltipProximity = polylinear([1, 4, 7, 10, 13, 16, 18], [1000000, 300000, 100000, 15000, 2000, 150, 50]);

// --- Tooltip and filters ----------------------------------------------------------------------------

export interface TooltipDetail {
  label: string;
  value: unknown;
}

/** tooltipFormatter of tile_map */
export function tooltipDetails(metricTitle: string, format: (value: unknown) => string, feature: GeoFeature | null | undefined): TooltipDetail[] {
  if (!feature) return [];
  return [
    { label: metricTitle, value: format(feature.properties.value) },
    { label: 'Latitude', value: feature.geometry.coordinates[1] },
    { label: 'Longitude', value: feature.geometry.coordinates[0] },
  ];
}

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

/** mapTooltipProvider's markup */
export function tooltipHtml(details: TooltipDetail[]): string {
  const rows = details
    .map((detail) => `<tr><td class="visTooltip__label">${escapeHtml(String(detail.label))}</td><td class="visTooltip__value">${escapeHtml(String(detail.value))}</td></tr>`)
    .join('');
  return `<table><tbody>${rows}</tbody></table>`;
}

export interface SpatialFilter {
  meta: { negate: boolean; index?: string; alias: null; disabled: boolean; key: string; type: string; params: unknown };
  [clause: string]: unknown;
}

/**
 * addSpatialFilter: the filter a drawn rectangle (geo_bounding_box) or polygon (geo_polygon)
 * stands for, with the meta the filter manager gives it (mapGeoBoundingBox, mapGeoPolygon).
 */
export function spatialFilter(
  kind: 'geo_bounding_box' | 'geo_polygon',
  field: string,
  indexId: string | undefined,
  data: GeoBoundingBox | { points: Array<{ lat: number; lon: number }> }
): SpatialFilter {
  return {
    meta: { negate: false, index: indexId, alias: null, disabled: false, key: field, type: kind, params: data },
    [kind]: { ignore_unmapped: true, [field]: data },
  };
}

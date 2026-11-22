/* SPDX-License-Identifier: Apache-2.0 */

/* Geohash cells: decode_geo_hash, zoom_to_precision and precision of maps_legacy. */

export interface DecodedGeoHash {
  /** [south, north, centre] */
  latitude: number[];
  /** [west, east, centre] */
  longitude: number[];
}

const BITS = [16, 8, 4, 2, 1];
const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

function refineInterval(interval: number[], cd: number, mask: number) {
  if (cd & mask) interval[0] = (interval[0] + interval[1]) / 2;
  else interval[1] = (interval[0] + interval[1]) / 2;
}

/** The rectangle a geohash stands for, and its centre */
export function decodeGeoHash(geohash: string): DecodedGeoHash {
  let isEven = true;
  const lat = [-90.0, 90.0];
  const lon = [-180.0, 180.0];
  for (const nextChar of geohash) {
    const cd = BASE32.indexOf(nextChar);
    for (let j = 0; j < 5; j++) {
      if (isEven) refineInterval(lon, cd, BITS[j]);
      else refineInterval(lat, cd, BITS[j]);
      isEven = !isEven;
    }
  }
  lat[2] = (lat[0] + lat[1]) / 2;
  lon[2] = (lon[0] + lon[1]) / 2;
  return { latitude: lat, longitude: lon };
}

/** The number of geohash cells along one axis: 0 for columns (longitude), 1 for rows */
function geohashCells(precision: number, axis: number) {
  let cells = 1;
  for (let i = 1; i <= precision; i += 1) cells *= i % 2 === axis ? 4 : 8;
  return cells;
}

export const geohashColumns = (precision: number) => geohashCells(precision, 0);

export interface GeoBoundingBox {
  top_left: { lat: number; lon: number };
  bottom_right: { lat: number; lon: number };
}

/** Whether the collar holds the bounds whole */
export function geoContains(collar?: GeoBoundingBox | null, bounds?: GeoBoundingBox | null): boolean {
  if (!bounds || !collar) return false;
  if (bounds.top_left.lat > collar.top_left.lat || bounds.top_left.lon < collar.top_left.lon) return false;
  if (bounds.bottom_right.lat < collar.bottom_right.lat || bounds.bottom_right.lon > collar.bottom_right.lon) return false;
  return true;
}

const MIN_GEOHASH_PIXELS = 16;

/** The finest precision whose cells are still 16 pixels wide at each zoom, up to maxZoom */
function zoomToPrecisionMap(maxZoom: number, maxPrecision = 12): Map<number, number> {
  const map = new Map<number, number>();
  for (let zoom = 0; zoom <= maxZoom; zoom += 1) {
    const worldPixels = 256 * Math.pow(2, zoom);
    map.set(zoom, 1);
    for (let precision = 2; precision <= maxPrecision; precision += 1) {
      if (worldPixels / geohashColumns(precision) >= MIN_GEOHASH_PIXELS) map.set(zoom, precision);
      else break;
    }
  }
  return map;
}

export function zoomToPrecision(mapZoom: number, maxPrecision: number, maxZoom: number): number {
  const precision = zoomToPrecisionMap(typeof maxZoom === 'number' ? maxZoom : 21).get(mapZoom);
  return precision ? Math.min(precision, maxPrecision) : maxPrecision;
}

/** precision.ts: getZoomPrecision, for zoom levels 0 to 21, with the setting visualization:tileMap:maxPrecision */
export function getZoomPrecision(maxPrecision: number): Record<number, number> {
  const out: Record<number, number> = {};
  for (const [zoom, precision] of zoomToPrecisionMap(21, maxPrecision)) out[zoom] = precision;
  return out;
}

/** precision.ts: getPrecision */
export function getPrecision(value: unknown, maxPrecision: number): number {
  let precision = parseInt(String(value), 10);
  if (Number.isNaN(precision)) precision = 2;
  return precision > maxPrecision ? maxPrecision : precision;
}

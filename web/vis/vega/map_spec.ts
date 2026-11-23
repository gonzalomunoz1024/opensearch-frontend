/* SPDX-License-Identifier: Apache-2.0 */

/*
 * What a Vega map does to its spec and with setMapView(), apart from Leaflet: the spec injector
 * of leaflet-vega 0.9.0 (vega-spec-injector 0.0.2), the projection that follows the map, and how
 * the arguments of setMapView() are read.
 */

type Spec = Record<string, unknown>;
type Handler = (...args: unknown[]) => void;

/** What vega-spec-injector does: sets a field, warning when it replaces another value, and adds names to a list */
export class SpecInjector {
  constructor(private readonly onWarning: Handler) {}

  /** Adds the values whose names the list does not have yet */
  addToList(spec: Spec, field: string, values: Array<string | { name: string }>): Spec {
    const added = new Map<string, unknown>(values.map((value) => (typeof value === 'string' ? [value, { name: value }] : [value.name, value])));
    for (const name of this.findUndefined(spec, field, added.keys())) (spec[field] as unknown[]).push(added.get(name));
    return spec;
  }

  overrideField(spec: Spec, field: string, value: unknown): Spec {
    if (spec[field] && spec[field] !== value) {
      // written as the library writes it, with its arrow
      this.onWarning(`Overriding ${field}: ${String(spec[field])} \u{100D8} ${String(value)}`);
    }
    spec[field] = value;
    return spec;
  }

  /** The names a section of the spec does not define; the section is made when there is none */
  findUndefined(spec: Spec, section: string, names: Iterable<string>): Iterable<string> {
    if (!Object.prototype.hasOwnProperty.call(spec, section)) {
      spec[section] = [];
      return names;
    }
    if (!Array.isArray(spec[section])) throw new Error(`spec.${section} must be an array`);
    const remaining = new Set(names);
    for (const item of spec[section] as Array<{ name?: unknown }>) {
      if (item.name) remaining.delete(item.name as string);
    }
    return remaining;
  }
}

/** The projection a spec on a map gets: Web Mercator at the map's zoom, centred where the map is */
export const defaultProjection = () => ({
  name: 'projection',
  type: 'mercator',
  scale: { signal: '256*pow(2,zoom)/2/PI' },
  rotate: [{ signal: '-longitude' }, 0, 0],
  center: [0, { signal: 'latitude' }],
  translate: [{ signal: 'width/2' }, { signal: 'height/2' }],
  fit: false,
});

const SET_MAP_VIEW_ERROR =
  'Unexpected setMapView() parameters. It could be called with a bounding box setMapView([[longitude1,latitude1],[longitude2,latitude2]]), or it could be the center point setMapView([longitude, latitude], optional_zoom), or it can be used as setMapView(latitude, longitude, optional_zoom)';

/** Where setMapView() of a spec moves the map: a center and zoom, or a box to fit */
export type MapViewTarget = { lat: number; lng: number; zoom?: number } | { bounds: [[number, number], [number, number]] };

/**
 * The arguments of setMapView(), read as the layer reads them:
 *  setMapView(latitude, longitude), setMapView(latitude, longitude, zoom),
 *  setMapView([longitude, latitude]), setMapView([longitude, latitude], zoom),
 *  setMapView([[longitude1, latitude1], [longitude2, latitude2]])
 */
export function readSetMapView(args: unknown[]): MapViewTarget | undefined {
  const fail = (): never => {
    throw new Error(SET_MAP_VIEW_ERROR);
  };
  const pair = (value: unknown): [number, number] => {
    if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== 'number' || typeof value[1] !== 'number') fail();
    return value as [number, number];
  };
  let lng: unknown;
  let lat: unknown;
  let zoom: unknown;
  switch (args.length) {
    case 1: {
      const arg = args[0];
      if (Array.isArray(arg) && arg.length === 2 && Array.isArray(arg[0]) && Array.isArray(arg[1])) {
        // a box, longitude first
        return { bounds: [pair(arg[0]), pair(arg[1])] };
      }
      [lng, lat] = pair(arg);
      break;
    }
    case 2:
      if (Array.isArray(args[0])) {
        [lng, lat] = pair(args[0]);
        zoom = args[1];
      } else {
        [lat, lng] = args;
      }
      break;
    case 3:
      [lat, lng, zoom] = args;
      break;
    default:
      fail();
  }
  if (lat === undefined || lng === undefined) return undefined;
  if (typeof lat !== 'number' || typeof lng !== 'number') fail();
  if (zoom !== undefined && typeof zoom !== 'number') fail();
  return { lat: lat as number, lng: lng as number, zoom: zoom as number | undefined };
}

/* SPDX-License-Identifier: Apache-2.0 */

/*
 * TopoJSON to GeoJSON: what `feature` of topojson-client 3 does, which a region map uses for a
 * vector map in TopoJSON. Arcs are shared lines, delta-encoded and quantized when the topology
 * has a transform; a ring or line is the arcs it names joined end to end, a negative index
 * (~i) naming arc i reversed.
 */

import type { GeoJsonFeature, GeoJsonFeatureCollection, GeoJsonGeometry } from 'leaflet';

type Position = number[];

interface Transform {
  scale: [number, number];
  translate: [number, number];
}

export interface TopologyObject {
  type?: string | null;
  id?: string | number;
  bbox?: number[];
  properties?: Record<string, unknown> | null;
  arcs?: unknown;
  coordinates?: unknown;
  geometries?: TopologyObject[];
}

export interface Topology {
  type: 'Topology';
  transform?: Transform;
  arcs: Position[][];
  objects: Record<string, TopologyObject>;
}

/** A function that turns a quantized position into a real one; the identity without a transform */
function transformer(transform: Transform | undefined, delta: boolean): (point: Position, index: number) => Position {
  if (!transform) return (point) => point.slice();
  const [kx, ky] = transform.scale;
  const [dx, dy] = transform.translate;
  let x0 = 0;
  let y0 = 0;
  return (input, index) => {
    if (!delta || !index) x0 = y0 = 0;
    const output = input.slice();
    output[0] = (x0 += input[0]) * kx + dx;
    output[1] = (y0 += input[1]) * ky + dy;
    if (!delta) {
      x0 = 0;
      y0 = 0;
    }
    return output;
  };
}

function decoder(topology: Topology) {
  const arcPoint = transformer(topology.transform, true);
  const point = transformer(topology.transform, false);
  const decoded = new Map<number, Position[]>();

  const arcPoints = (index: number): Position[] => {
    let points = decoded.get(index);
    if (!points) {
      const arc = topology.arcs[index];
      if (!arc) throw new TypeError(`Cannot read properties of undefined (reading 'length')`);
      points = arc.map((position, i) => arcPoint(position, i));
      decoded.set(index, points);
    }
    return points;
  };

  const appendArc = (index: number, points: Position[]) => {
    if (points.length) points.pop();
    const reversed = index < 0;
    const arc = arcPoints(reversed ? ~index : index);
    if (reversed) for (let k = arc.length - 1; k >= 0; k--) points.push(arc[k].slice());
    else for (const position of arc) points.push(position.slice());
  };

  const line = (arcs: number[]): Position[] => {
    const points: Position[] = [];
    for (const index of arcs) appendArc(index, points);
    if (points.length < 2) points.push(points[0].slice());
    return points;
  };

  const ring = (arcs: number[]): Position[] => {
    const points = line(arcs);
    while (points.length < 4) points.push(points[0].slice());
    return points;
  };

  const polygon = (arcs: number[][]): Position[][] => arcs.map(ring);

  const geometry = (o: TopologyObject): GeoJsonGeometry | null => {
    const type = o.type;
    if (type === 'GeometryCollection') {
      return { type, geometries: (o.geometries ?? []).map(geometry).filter((g): g is GeoJsonGeometry => g !== null) };
    }
    switch (type) {
      case 'Point':
        return { type, coordinates: point(o.coordinates as Position, 0) };
      case 'MultiPoint':
        return { type, coordinates: (o.coordinates as Position[]).map((p) => point(p, 0)) };
      case 'LineString':
        return { type, coordinates: line(o.arcs as number[]) };
      case 'MultiLineString':
        return { type, coordinates: (o.arcs as number[][]).map(line) };
      case 'Polygon':
        return { type, coordinates: polygon(o.arcs as number[][]) };
      case 'MultiPolygon':
        return { type, coordinates: (o.arcs as number[][][]).map(polygon) };
      default:
        return null;
    }
  };

  return geometry;
}

function toFeature(o: TopologyObject, geometry: (o: TopologyObject) => GeoJsonGeometry | null): GeoJsonFeature {
  const properties = (o.properties ?? {}) as Record<string, unknown>;
  const shape = geometry(o);
  // The keys in topojson-client's order: id and bbox only when the object has them
  if (o.id == null && o.bbox == null) return { type: 'Feature', properties, geometry: shape };
  if (o.bbox == null) return { type: 'Feature', id: o.id, properties, geometry: shape };
  return { type: 'Feature', id: o.id, bbox: o.bbox, properties, geometry: shape } as GeoJsonFeature;
}

/**
 * An object of a topology as GeoJSON: a GeometryCollection becomes a FeatureCollection, anything
 * else one Feature. `object` may be the object itself or its name among the topology's objects.
 */
export function topojsonFeature(topology: Topology, object: TopologyObject | string): GeoJsonFeatureCollection | GeoJsonFeature {
  const o = typeof object === 'string' ? topology.objects[object] : object;
  if (o === undefined || o === null) throw new TypeError("Cannot read properties of undefined (reading 'type')");
  const geometry = decoder(topology);
  if (o.type === 'GeometryCollection') {
    return { type: 'FeatureCollection', features: (o.geometries ?? []).map((g) => toFeature(g, geometry)) };
  }
  return toFeature(o, geometry);
}

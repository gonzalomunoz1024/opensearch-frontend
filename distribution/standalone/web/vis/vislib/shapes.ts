/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The lines, areas and arcs of the classic charts as d3's third version writes them (d3.svg.line,
 * d3.svg.area and d3.svg.arc): lines straight, smooth ("cardinal", at d3's tension of 0.7) or in
 * steps, broken where a point is not defined; arcs between two radii and two angles, clockwise
 * from twelve o'clock, numbers written in full as d3 writes them.
 */

export type Interpolation = 'linear' | 'cardinal' | 'step-after' | 'step-before';

type Point = [number, number];

const linear = (points: Point[]) => points.map((point) => `${point[0]},${point[1]}`).join('L');

function stepAfter(points: Point[]): string {
  let p = points[0];
  const path = [`${p[0]},${p[1]}`];
  for (let index = 1; index < points.length; index += 1) {
    p = points[index];
    path.push(`H${p[0]}V${p[1]}`);
  }
  return path.join('');
}

function stepBefore(points: Point[]): string {
  let p = points[0];
  const path = [`${p[0]},${p[1]}`];
  for (let index = 1; index < points.length; index += 1) {
    p = points[index];
    path.push(`V${p[1]}H${p[0]}`);
  }
  return path.join('');
}

function hermite(points: Point[], tangents: Point[]): string {
  if (tangents.length < 1 || (points.length !== tangents.length && points.length !== tangents.length + 2)) {
    return linear(points);
  }
  const quad = points.length !== tangents.length;
  let path = '';
  let p0 = points[0];
  let p = points[1];
  const t0 = tangents[0];
  let t = t0;
  let pi = 1;
  if (quad) {
    path += `Q${p[0] - (t0[0] * 2) / 3},${p[1] - (t0[1] * 2) / 3},${p[0]},${p[1]}`;
    p0 = points[1];
    pi = 2;
  }
  if (tangents.length > 1) {
    t = tangents[1];
    p = points[pi];
    pi += 1;
    path += `C${p0[0] + t0[0]},${p0[1] + t0[1]},${p[0] - t[0]},${p[1] - t[1]},${p[0]},${p[1]}`;
    for (let index = 2; index < tangents.length; index += 1, pi += 1) {
      p = points[pi];
      t = tangents[index];
      path += `S${p[0] - t[0]},${p[1] - t[1]},${p[0]},${p[1]}`;
    }
  }
  if (quad) {
    const last = points[pi];
    path += `Q${p[0] + (t[0] * 2) / 3},${p[1] + (t[1] * 2) / 3},${last[0]},${last[1]}`;
  }
  return path;
}

function cardinal(points: Point[], tension = 0.7): string {
  if (points.length < 3) return linear(points);
  const tangents: Point[] = [];
  const a = (1 - tension) / 2;
  let p0: Point;
  let p1 = points[0];
  let p2 = points[1];
  for (let index = 2; index < points.length; index += 1) {
    p0 = p1;
    p1 = p2;
    p2 = points[index];
    tangents.push([a * (p2[0] - p0[0]), a * (p2[1] - p0[1])]);
  }
  return `${points[0][0]},${points[0][1]}${hermite(points, tangents)}`;
}

function interpolate(points: Point[], how: Interpolation): string {
  switch (how) {
    case 'cardinal':
      return cardinal(points);
    case 'step-after':
      return stepAfter(points);
    case 'step-before':
      return stepBefore(points);
    default:
      return linear(points);
  }
}

const reverseOf = (how: Interpolation): Interpolation =>
  how === 'step-after' ? 'step-before' : how === 'step-before' ? 'step-after' : how;

/** A line through the points that are defined, broken where one is not; null when none is */
export function linePath(points: Array<Point | undefined>, how: Interpolation): string | null {
  const segments: string[] = [];
  let run: Point[] = [];
  const flush = () => {
    if (run.length) segments.push(`M${interpolate(run, how)}`);
    run = [];
  };
  for (const point of points) {
    if (point) run.push(point);
    else flush();
  }
  flush();
  return segments.length ? segments.join('') : null;
}

/**
 * An area between a line (`to`) and its base (`from`) through the points that are defined,
 * broken where one is not; the base is drawn back from the last point to the first
 */
export function areaPath(points: Array<{ from: Point; to: Point } | undefined>, how: Interpolation): string | null {
  const segments: string[] = [];
  let lower: Point[] = [];
  let upper: Point[] = [];
  const flush = () => {
    if (lower.length) {
      segments.push(`M${interpolate(upper, how)}L${interpolate(lower.slice().reverse(), reverseOf(how))}Z`);
    }
    lower = [];
    upper = [];
  };
  for (const point of points) {
    if (point) {
      lower.push(point.from);
      upper.push(point.to);
    } else flush();
  }
  flush();
  return segments.length ? segments.join('') : null;
}

// --- Arcs -----------------------------------------------------------------------------------------

const HALF_PI = Math.PI / 2;
const EPSILON = 1e-6;
const TAU_EPSILON = 2 * Math.PI - EPSILON;

const circleSegment = (radius: number, clockwise: number) =>
  `M0,${radius}A${radius},${radius} 0 1,${clockwise} 0,${-radius}A${radius},${radius} 0 1,${clockwise} 0,${radius}`;

/** d3.svg.arc's path: a ring's piece between two radii and two angles (radians from twelve o'clock) */
export function arcPath(innerRadius: number, outerRadius: number, startAngle: number, endAngle: number): string {
  let r0 = Math.max(0, innerRadius);
  let r1 = Math.max(0, outerRadius);
  const a0 = startAngle - HALF_PI;
  const a1 = endAngle - HALF_PI;
  const da = Math.abs(a1 - a0);
  const cw = a0 > a1 ? 0 : 1;
  if (r1 < r0) [r0, r1] = [r1, r0];
  if (da >= TAU_EPSILON) return `${circleSegment(r1, cw)}${r0 ? circleSegment(r0, 1 - cw) : ''}Z`;
  const path: Array<string | number> = [];
  let x0 = 0;
  let y0 = 0;
  let x2 = 0;
  let y2 = 0;
  path.push('M');
  if (r1) {
    x0 = r1 * Math.cos(a0);
    y0 = r1 * Math.sin(a0);
    const x1 = r1 * Math.cos(a1);
    const y1 = r1 * Math.sin(a1);
    const l1 = Math.abs(a1 - a0) <= Math.PI ? 0 : 1;
    path.push(x0, ',', y0, 'A', r1, ',', r1, ' 0 ', l1, ',', cw, ' ', x1, ',', y1);
  } else {
    path.push(x0, ',', y0);
  }
  if (r0) {
    x2 = r0 * Math.cos(a1);
    y2 = r0 * Math.sin(a1);
    const x3 = r0 * Math.cos(a0);
    const y3 = r0 * Math.sin(a0);
    const l0 = Math.abs(a0 - a1) <= Math.PI ? 0 : 1;
    path.push('L', x2, ',', y2, 'A', r0, ',', r0, ' 0 ', l0, ',', 1 - cw, ' ', x3, ',', y3);
  } else {
    path.push('L', x2, ',', y2);
  }
  path.push('Z');
  return path.join('');
}

/** d3.svg.arc's centroid: halfway between the radii, at the middle angle */
export function arcCentroid(innerRadius: number, outerRadius: number, startAngle: number, endAngle: number): [number, number] {
  const r = (innerRadius + outerRadius) / 2;
  const a = (startAngle + endAngle) / 2 - HALF_PI;
  return [Math.cos(a) * r, Math.sin(a) * r];
}

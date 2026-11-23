/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The arithmetic of a region map, apart from Leaflet: the join of terms to shapes, the colour of
 * a value, the legend's colours and ranges (colorUtil of maps_legacy and the d3 3 it used), the
 * terms of an answer and the warning for terms no shape has.
 */

import type { GeoJsonFeature } from 'leaflet';
import type { Table, TableColumn } from '../../lib/aggs';

/** A term of the answer and its value */
export interface RegionMetric {
  term: unknown;
  value: number;
}

/** A shape, with the term the join gave it */
export type Feature = GeoJsonFeature & { __osdJoinedMetric?: RegionMetric | null };
export type ValueFormatter = (value: unknown) => string;

/** The terms and values of an answer, as the layer joins them: none unless it has a term column and a value column */
export function regionMetrics(table: Table): { results: RegionMetric[]; termColumn?: TableColumn; valueColumn?: TableColumn } {
  const termColumn = table.columns.find((column) => column.kind === 'bucket' && column.schema === 'segment');
  const valueColumn = table.columns.find((column) => column.kind === 'metric');
  if (table.columns.length !== 2 || !termColumn || !valueColumn || !table.rows.length) {
    return { results: [], termColumn, valueColumn };
  }
  const results = table.rows.map((row) => ({ term: row[termColumn.id], value: row[valueColumn.id] as number }));
  return { results, termColumn, valueColumn };
}

/** The text of the warning toast for terms no shape has */
export function mismatchWarning(mismatches: unknown[]): { title: string; text: string } {
  const count = mismatches.length;
  return {
    title: `Unable to show ${count} ${count > 1 ? 'results' : 'result'} on map`,
    text: `Ensure that each of these term matches a shape on that shape's join field: ${mismatches.join(', ')}`,
  };
}

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

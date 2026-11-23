/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The table of a pie made into what vislib draws: the slices of each bucket inside those of the
 * bucket before it (buildHierarchicalData), the slices of nothing left out, each slice's share
 * of its ring and of the whole (convertToPercentage), and d3's partition of them, which places
 * each slice along the circle and across the rings. The names of the legend, by ring then by
 * order, and the shares as numeral writes them ("0.[00]%") are here too.
 */

import type { Table, TableColumn, TableRow } from '../../lib/aggs';
import { keyLabel } from './point_series_data';

export interface PieSlice {
  name: string;
  size: number;
  children: PieSlice[];
  parent?: PieSlice;
  /** The bucket it stands for, when it is one: a click or the legend filters on it */
  bucket?: { column: TableColumn; key: unknown; row: TableRow };
  percentOfGroup?: number;
  percentOfParent?: number;
  sumOfChildren?: number;
  /** As d3's partition places it: the ring, and where and how far along the circle and across */
  depth: number;
  value: number;
  x: number;
  dx: number;
  y: number;
  dy: number;
}

const slice = (name: string, size: number, parent?: PieSlice): PieSlice => ({
  name,
  size,
  children: [],
  parent,
  depth: 0,
  value: 0,
  x: 0,
  dx: 0,
  y: 0,
  dy: 0,
});

/** The measure of a bucket: the first one after its column, else the last of the table */
function measureOf(columns: TableColumn[], bucket: TableColumn): TableColumn | undefined {
  for (let index = columns.indexOf(bucket) + 1; index < columns.length; index += 1) {
    if (columns[index].kind === 'metric') return columns[index];
    if (columns[index].kind === 'bucket') break;
  }
  return columns.filter((column) => column.kind === 'metric').pop();
}

/**
 * The slices of a table: a slice per bucket, named as its column writes the key, inside the slice
 * of the bucket before it; buckets of the same name in a ring are one slice, the first; with no
 * bucket, one slice named after the measure
 */
export function buildSlices(table: Table): PieSlice {
  const root = slice('', 0);
  const buckets = table.columns.filter((column) => column.kind === 'bucket' && column.schema !== 'split');
  if (!buckets.length) {
    const metric = table.columns.find((column) => column.kind === 'metric');
    if (metric) root.children.push(slice(metric.name, Number(table.rows[0]?.[metric.id] ?? 0), undefined));
    return root;
  }
  table.rows.forEach((row) => {
    let parent: PieSlice | undefined;
    let level = root.children;
    for (const column of buckets) {
      const key = row[column.id];
      const name = keyLabel(column, key);
      const measure = measureOf(table.columns, column);
      let found = level.find((candidate) => candidate.name === name);
      if (!found) {
        found = slice(name, measure ? Number(row[measure.id]) : 0, parent);
        found.bucket = { column, key, row };
        level.push(found);
      }
      parent = found;
      level = found.children;
    }
  });
  return root;
}

/** The slices without those of nothing, at every ring */
export function removeZeroSlices(slices: PieSlice): PieSlice {
  return { ...slices, children: slices.children.filter((child) => child.size !== 0).map(removeZeroSlices) };
}

/** Each slice's share of its ring's sum, and of the whole */
export function convertToPercentage(slices: PieSlice): void {
  if (slices.sumOfChildren !== undefined) return;
  const parentPercent = slices.percentOfParent;
  const sum = Math.abs(slices.children.reduce((total, child) => total + Math.abs(child.size), 0));
  slices.sumOfChildren = sum;
  for (const child of slices.children) {
    child.percentOfGroup = Math.abs(child.size) / sum;
    child.percentOfParent = child.percentOfGroup;
    if (parentPercent !== undefined && parentPercent !== null) child.percentOfParent *= parentPercent;
    if (child.children.length) convertToPercentage(child);
  }
}

/**
 * d3's partition of the slices (sorted as they come): the value of a slice without slices inside
 * is its share of the whole, a hundred for all, and one with slices inside sums theirs; the
 * circle is one along, shared by value, and the rings share one across. The slices, the whole
 * first, in d3's order.
 */
export function partition(root: PieSlice): PieSlice[] {
  const nodes: PieSlice[] = [];
  const stack = [root];
  root.depth = 0;
  for (let node = stack.pop(); node; node = stack.pop()) {
    nodes.push(node);
    if (node.children.length) {
      for (let index = node.children.length - 1; index >= 0; index -= 1) {
        const child = node.children[index];
        stack.push(child);
        child.parent = node;
        child.depth = node.depth + 1;
      }
      node.value = 0;
    } else {
      node.value = +((node.percentOfParent ?? 0) * 100) || 0;
    }
  }
  // The values summed from the leaves up, in d3's order
  const visit = [root];
  const after: PieSlice[] = [];
  for (let node = visit.pop(); node; node = visit.pop()) {
    after.push(node);
    for (const child of node.children) visit.push(child);
  }
  for (let node = after.pop(); node; node = after.pop()) {
    if (node.parent && node !== root) node.parent.value += node.value;
  }
  const depthOf = (node: PieSlice): number => 1 + node.children.reduce((deepest, child) => Math.max(deepest, depthOf(child)), 0);
  const position = (node: PieSlice, x: number, dx: number, dy: number) => {
    node.x = x;
    node.y = node.depth * dy;
    node.dx = dx;
    node.dy = dy;
    if (node.children.length) {
      const step = node.value ? dx / node.value : 0;
      let at = x;
      for (const child of node.children) {
        const span = child.value * step;
        position(child, at, span, dy);
        at += span;
      }
    }
  };
  position(root, 0, 1, 1 / depthOf(root));
  return nodes;
}

/** The names of the slices for the legend and the colours: ring by ring, each once */
export function pieNames(roots: PieSlice[]): string[] {
  const named: Array<{ name: string; index: number }> = [];
  const walk = (slices: PieSlice[], index: number) => {
    for (const item of slices) {
      named.push({ name: item.name, index });
      walk(item.children, index + 1);
    }
  };
  const names: string[] = [];
  for (const root of roots) {
    named.length = 0;
    walk(root.children, 0);
    // lodash's sortBy is stable
    const sorted = named.map((item, order) => ({ ...item, order })).sort((a, b) => a.index - b.index || a.order - b.order);
    for (const item of sorted) if (!names.includes(item.name)) names.push(item.name);
  }
  return names;
}

/** A share as numeral writes it with "0.[00]%": a hundredth at most, and no zeros after the point */
export function percentText(share: number): string {
  const value = share * 100;
  const text = String(value);
  const decimals = text.includes('e') ? 2 : (text.split('.')[1]?.length ?? 0);
  const precision = Math.min(decimals, 2);
  let output = (Math.round(Number(`${value}e+${precision}`)) / 10 ** precision).toFixed(precision);
  if (Number.isNaN(Number(output))) output = value.toFixed(2);
  if (precision > 0) output = output.replace(new RegExp(`\\.?0{1,${precision}}$`), '');
  return `${output}%`;
}

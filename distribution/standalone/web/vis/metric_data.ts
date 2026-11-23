/* SPDX-License-Identifier: Apache-2.0 */

/*
 * What the metric visualization shows, worked out from the answer's table as the original's does
 * (vis_type_metric: metric_vis_fn and MetricVisComponent): one metric per column and row, each
 * with its value as its format writes it, its label, and the colour of the range its value is in.
 */

import type { AggContext, Table, TableColumn, TableRow } from '../lib/aggs';
import { DEFAULT_FORMAT_SETTINGS, createFormatter } from '../lib/field_formats';
import type { FormattedContent } from './formatted_value';
import { columnFormatSpec, formatValue } from './table_data';
import { heatmapColor } from './vislib/color_maps';

export interface MetricRange {
  from: number;
  to: number;
}

export type MetricColorMode = 'None' | 'Labels' | 'Background';

/** The options of a metric visualization, as its expression takes them from the saved params */
export interface MetricConfig {
  percentageMode: boolean;
  colorSchema: string;
  colorMode: MetricColorMode;
  colorsRange: MetricRange[];
  invertColors: boolean;
  showLabels: boolean;
  /** In points */
  fontSize: number;
}

export interface MetricItem {
  label: string;
  /** The value as the cell of a table would show it; `bare` for the dash that stands for no number */
  value: FormattedContent;
  /** The colour of the value, in the mode "Labels" */
  color?: string;
  /** The colour behind the metric, in the mode "Background" */
  bgColor?: string;
  /** Whether that colour is dark enough to need the text the other way round */
  lightText: boolean;
  rowIndex: number;
  row: TableRow;
}

const DEFAULT_RANGES: MetricRange[] = [{ from: 0, to: 10000 }];

interface SavedMetricParams {
  percentageMode?: unknown;
  colorSchema?: unknown;
  metricColorMode?: unknown;
  colorsRange?: unknown;
  invertColors?: unknown;
  labels?: { show?: unknown };
  style?: { fontSize?: unknown };
}

/**
 * The options with the defaults the original's `metricVis` function gives them: green to red, no
 * colour mode, one range from 0 to 10,000, labels shown, 60 points. The size is read as a whole
 * number, as the original parses it.
 */
export function metricConfig(params: Record<string, unknown>): MetricConfig {
  const saved = (params.metric ?? {}) as SavedMetricParams;
  const ranges = Array.isArray(saved.colorsRange) ? (saved.colorsRange as MetricRange[]).filter((range) => range && typeof range === 'object') : [];
  const mode = saved.metricColorMode;
  const size = Number.parseInt(String(saved.style?.fontSize ?? ''), 10);
  return {
    percentageMode: saved.percentageMode === true,
    colorSchema: typeof saved.colorSchema === 'string' && saved.colorSchema ? saved.colorSchema : 'Green to Red',
    colorMode: mode === 'Labels' || mode === 'Background' ? mode : 'None',
    colorsRange: ranges.length > 0 ? ranges : DEFAULT_RANGES,
    invertColors: saved.invertColors === true,
    // Shown unless the visualization says not to
    showLabels: saved.labels?.show === undefined || saved.labels.show === null ? true : Boolean(saved.labels.show),
    fontSize: Number.isNaN(size) ? 60 : size,
  };
}

/** What each range is called: its ends, or in percentage mode their shares of the last range's end */
export function rangeLabels(config: MetricConfig): string[] {
  const ranges = config.colorsRange;
  const max = ranges[ranges.length - 1].to;
  return ranges.map((range) => {
    const from = config.percentageMode ? Math.round((100 * range.from) / max) : range.from;
    const to = config.percentageMode ? Math.round((100 * range.to) / max) : range.to;
    return `${from} - ${to}`;
  });
}

/**
 * The colour of each range by its label: spread over the schema from its first colour to its
 * last, the other way round when inverted. Two ranges called the same share the later one's.
 */
export function rangeColors(config: MetricConfig, dark = false): Record<string, string> {
  const labels = rangeLabels(config);
  const colors: Record<string, string> = {};
  const divider = Math.max(config.colorsRange.length - 1, 1);
  labels.forEach((label, index) => {
    const at = config.invertColors ? 1 - index / divider : index / divider;
    colors[label] = heatmapColor(at, config.colorSchema, dark);
  });
  return colors;
}

/**
 * The range a value is in: from its start up to, not including, its end; a value under the first
 * range takes the first, any other the last. The value is compared as JavaScript compares it, so
 * that no value at all counts as 0, as in the original.
 */
export function rangeIndex(value: unknown, ranges: MetricRange[]): number {
  const number = value as number;
  const found = ranges.findIndex((range) => range.from <= number && range.to > number);
  if (found !== -1) return found;
  return number < ranges[0].from ? 0 : ranges.length - 1;
}

/**
 * The component library's isColorDark: whether a colour is dark enough for light text on it, by
 * its relative luminance
 */
export function isColorDark(red: number, green: number, blue: number): boolean {
  const [r, g, b] = [red, green, blue].map((channel) => {
    const share = channel / 255;
    return share <= 0.03928 ? share / 12.92 : ((share + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b <= 0.179;
}

const RGB = /rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/;

export function needsLightText(color: string | undefined): boolean {
  const channels = color ? RGB.exec(color) : null;
  if (!channels) return false;
  return isColorDark(Number.parseInt(channels[1], 10), Number.parseInt(channels[2], 10), Number.parseInt(channels[3], 10));
}

/** The bucket the metrics are split by: the first of the schema "group", as the original's dimensions */
export const groupColumn = (table: Table): TableColumn | undefined =>
  table.columns.find((column) => column.kind === 'bucket' && column.schema === 'group');

const isNotANumber = (value: unknown): boolean => typeof value === 'number' && Number.isNaN(value);

/** A metric's value as its column's format writes it in HTML; in percentage mode, as a percentage */
function valueFormatter(column: TableColumn, config: MetricConfig, context: AggContext): (value: unknown) => FormattedContent {
  const settings = context.formatSettings ?? DEFAULT_FORMAT_SETTINGS;
  const spec = config.percentageMode ? { id: 'percent' } : columnFormatSpec(column, context);
  const rich = !config.percentageMode && (spec.id === 'url' || spec.id === 'color') ? createFormatter(spec, settings) : undefined;
  const percent = config.percentageMode ? createFormatter(spec, settings) : undefined;
  return (value) => {
    // What is not a number is a dash, with no span around it
    if (isNotANumber(value)) return { text: '-', bare: true };
    // No value: the dash between spaces that the original's HTML formats write for nothing
    if (value === null || value === undefined) return { text: ' - ' };
    if (percent) return { text: percent(value).text };
    const text = formatValue(column, value);
    if (!rich) return { text };
    const formatted = rich(value);
    return { ...formatted, text: formatted.href || formatted.image ? formatted.text : text };
  };
}

/**
 * The metrics, as the original's processTableGroups lists them: for each metric column, one per
 * row. A value's colour is that of its range, read before percentage mode turns the value into its
 * share of the ranges' span; colours show only when there is more than one range.
 */
export function metricItems(table: Table, config: MetricConfig, context: AggContext, dark = false): MetricItem[] {
  const ranges = config.colorsRange;
  const min = ranges[0].from;
  const max = ranges[ranges.length - 1].to;
  const labels = rangeLabels(config);
  const shouldColor = ranges.length > 1 && config.colorMode !== 'None';
  let colors: Record<string, string> = {};
  if (shouldColor) {
    try {
      colors = rangeColors(config, dark);
    } catch {
      // A schema that does not exist colours nothing
      colors = {};
    }
  }
  const bucket = groupColumn(table);
  const items: MetricItem[] = [];
  for (const column of table.columns) {
    if (column.kind !== 'metric' || column.schema === 'radius') continue;
    const format = valueFormatter(column, config, context);
    table.rows.forEach((row, rowIndex) => {
      let value = row[column.id];
      const color = shouldColor ? colors[labels[rangeIndex(value, ranges)]] : undefined;
      if (config.percentageMode) value = ((value as number) - min) / (max - min);
      let label = column.name;
      if (bucket) {
        const key = row[bucket.id];
        label = `${isNotANumber(key) ? '-' : formatValue(bucket, key)} - ${label}`;
      }
      items.push({
        label,
        value: format(value),
        color: config.colorMode === 'Labels' ? color : undefined,
        bgColor: config.colorMode === 'Background' ? color : undefined,
        lightText: config.colorMode === 'Background' && needsLightText(color),
        rowIndex,
        row,
      });
    });
  }
  return items;
}

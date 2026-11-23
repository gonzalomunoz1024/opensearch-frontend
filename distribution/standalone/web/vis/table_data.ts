/* SPDX-License-Identifier: Apache-2.0 */

/*
 * What the data table draws, worked out from the answer's table as the original's table
 * visualization does it (vis_type_table: table_vis_response_handler, convert_to_formatted_data,
 * add_percentage_col, convert_to_csv_data): the columns it shows, each with its total, the
 * percentage column, the tables a split makes, the order of the rows, the filters a cell adds and
 * the CSV text of the export.
 */

import {
  MISSING_KEY,
  OTHER_KEY,
  bucketFilter,
  type AggConfig,
  type AggContext,
  type RangeKey,
  type Table,
  type TableColumn,
  type TableRow,
} from '../lib/aggs';
import { DEFAULT_FORMAT_SETTINGS, createFormatter, formatSpecOf, type Formatted } from '../lib/field_formats';
import type { FieldFormatSpec, Filter } from '../lib/types';
import { keyText } from './types';

export type TotalFunction = 'sum' | 'avg' | 'min' | 'max' | 'count';

export interface TableVisParams {
  perPage?: number | '';
  showPartialRows?: boolean;
  showMetricsAtAllLevels?: boolean;
  showTotal?: boolean;
  totalFunc?: TotalFunction;
  percentageCol?: string;
  /** Where the editor's "Split table" keeps its choice: true for rows, else columns */
  row?: boolean;
}

/** A cell as the original's HTML format writes it: a field's value in a span, a bucket's label bare */
export interface CellContent extends Formatted {
  bare?: boolean;
}

export interface FormattedColumn {
  /** The column of the answer's table it shows, or `<id>-percents` for a percentage column */
  id: string;
  title: string;
  /** The answer's column; a percentage column has none */
  source?: TableColumn;
  /** Only a bucket's cells add filters */
  filterable: boolean;
  /** A value as text, as the export's "Formatted" and the totals write it */
  text: (value: unknown) => string;
  /** A value as the cell shows it */
  cell: (value: unknown) => CellContent;
  /** What the footer shows: a number for a count, else the value written by the column's format */
  formattedTotal?: string | number;
  sumTotal?: number;
  total?: number;
}

export interface FormattedTable {
  columns: FormattedColumn[];
  rows: TableRow[];
}

export interface TableGroup {
  title: string;
  table: FormattedTable;
}

export interface TableVisData {
  table?: FormattedTable;
  tableGroups: TableGroup[];
  /** A table split into rows stacks its tables; into columns, sets them side by side */
  direction?: 'row' | 'column';
}

const SIBLING_PIPELINES = new Set(['avg_bucket', 'sum_bucket', 'min_bucket', 'max_bucket']);
const PARENT_PIPELINES = new Set(['derivative', 'cumulative_sum', 'moving_avg', 'serial_diff']);
// The formats whose values may be summed and averaged (allowsNumericalAggregations)
const NUMERIC_FORMATS = new Set(['number', 'bytes', 'percent', 'duration']);

const fieldSpecOf = (name: string | undefined, context: AggContext): FieldFormatSpec | undefined => {
  if (!name) return undefined;
  const field = context.indexPattern?.fields.find((candidate) => candidate.name === name);
  return field ? formatSpecOf(field, context.indexPattern, context.formatSettings ?? DEFAULT_FORMAT_SETTINGS) : undefined;
};

const aggFieldName = (agg: AggConfig): string | undefined => {
  const field = agg.params?.field;
  if (typeof field === 'string') return field;
  if (field && typeof field === 'object' && typeof (field as { name?: unknown }).name === 'string') return (field as { name: string }).name;
  return undefined;
};

/** The format of a metric, as its aggregation serializes it (getSerializedFormat) */
function metricSpec(agg: AggConfig, context: AggContext, depth = 0): FieldFormatSpec {
  if ((SIBLING_PIPELINES.has(agg.type) || PARENT_PIPELINES.has(agg.type)) && depth < 3) {
    // A pipeline is written in the format of the metric it works on
    const reference = agg.params?.metricAgg;
    const inner =
      typeof reference === 'string' && reference !== 'custom'
        ? context.aggs?.find((candidate) => candidate.id === reference)
        : (agg.params?.customMetric as AggConfig | undefined);
    return inner ? metricSpec(inner, context, depth + 1) : { id: 'number' };
  }
  switch (agg.type) {
    case 'count':
    case 'cardinality':
      return { id: 'number' };
    case 'percentile_ranks':
      return { id: 'percent' };
    default:
      return fieldSpecOf(aggFieldName(agg), context) ?? { id: '' };
  }
}

/**
 * A value as the original's formats write it: by the column's format, but an empty text as
 * nothing, as every one of them writes it (asPrettyString), where the product's shared formats
 * take it for a missing value and write a dash
 */
export const formatValue = (column: TableColumn, value: unknown): string => (value === '' ? '' : column.format(value));

/** The format of a column as the original's dimension carries it */
export function columnFormatSpec(column: TableColumn, context: AggContext): FieldFormatSpec {
  const { agg } = column;
  if (column.kind === 'metric') return metricSpec(agg, context);
  const field = fieldSpecOf(column.fieldName ?? aggFieldName(agg), context);
  switch (agg.type) {
    case 'terms':
    case 'significant_terms':
      return { id: 'terms', params: { ...field?.params, id: field?.id } };
    case 'date_histogram':
      return { id: 'date' };
    case 'range':
    case 'date_range':
    case 'ip_range':
      return { id: agg.type };
    default:
      return field ?? { id: '' };
  }
}

/** The ways the original's formats differ from text in a cell: links, pictures, colours */
function cellFormatter(column: TableColumn, context: AggContext): (value: unknown) => CellContent {
  const settings = context.formatSettings ?? DEFAULT_FORMAT_SETTINGS;
  const bucketLabel = column.kind === 'bucket' && (column.agg.type === 'terms' || column.agg.type === 'significant_terms');
  const spec = fieldSpecOf(column.fieldName, context);
  const rich = spec && (spec.id === 'url' || spec.id === 'color') ? createFormatter(spec, settings) : undefined;
  const plainBucket = column.kind === 'bucket' && !['terms', 'significant_terms', 'histogram'].includes(column.agg.type);
  return (value) => {
    const text = formatValue(column, value);
    // The labels of the buckets of the rest and of the missing are written as they are
    if (bucketLabel && (value === OTHER_KEY || value === MISSING_KEY)) return { text, bare: true };
    if (!rich || plainBucket || value === null || value === undefined) return { text };
    const formatted = rich(value);
    return { ...formatted, text: formatted.href || formatted.image ? formatted.text : text };
  };
}

/** lodash's `_.min` and `_.max`: the extreme of the values that are neither null, undefined nor NaN */
function extreme(values: unknown[], larger: boolean): unknown {
  let result: unknown;
  let found = false;
  for (const value of values) {
    if (value === null || value === undefined || value !== value) continue;
    // Compared as JavaScript compares them, text as text
    if (!found || (larger ? (value as number) > (result as number) : (value as number) < (result as number))) {
      result = value;
      found = true;
    }
  }
  return result;
}

/**
 * A value as the original's formats write it as text, as the formatted export has it: nothing as
 * a number's format writes nothing, a date's a dash, and the others a dash between spaces
 */
function textOf(column: TableColumn, spec: FieldFormatSpec): (value: unknown) => string {
  const id = spec.id === 'terms' ? spec.params?.id : spec.id;
  const empty = id === 'number' || id === 'bytes' || id === 'percent' ? '' : id === 'date' ? '-' : ' - ';
  return (value) => (value === null || value === undefined ? empty : formatValue(column, value));
}

const addUp = (sum: number, value: unknown): number => {
  if (value === undefined) return sum;
  if (value === null) return sum;
  return sum + (typeof value === 'number' ? value : Number(value));
};

/**
 * The columns of one table as the original's convertToFormattedData makes them: the buckets and
 * the metrics in the order of the answer, each with the total the footer shows, and the
 * percentage column after the column it is of.
 */
export function formatTable(
  columns: TableColumn[],
  rows: TableRow[],
  params: TableVisParams,
  context: AggContext
): FormattedTable {
  const totalFunc = params.totalFunc ?? 'sum';
  let formattedRows = rows;
  let formatted: FormattedColumn[] = columns
    .filter((column) => (column.kind === 'bucket' ? column.schema !== 'split' : column.schema !== 'geo_centroid' && column.schema !== 'radius'))
    .map((column) => {
      const isBucket = column.kind === 'bucket';
      const spec = columnFormatSpec(column, context);
      const result: FormattedColumn = {
        id: column.id,
        title: column.name,
        source: column,
        filterable: isBucket,
        text: textOf(column, spec),
        cell: cellFormatter(column, context),
      };
      const isDate = spec.id === 'date' || spec.params?.id === 'date';
      const numeric = NUMERIC_FORMATS.has(spec.id);
      if (numeric || isDate || totalFunc === 'count') {
        // Only a metric is summed; a bucket's sum is 0
        const sum = isBucket ? 0 : rows.reduce((previous, row) => addUp(previous, row[column.id]), 0);
        result.sumTotal = sum;
        const values = () => rows.map((row) => row[column.id]);
        // The original writes nothing for a total that is not a number
        const write = (total: unknown) => (total === undefined ? '' : formatValue(column, total));
        switch (totalFunc) {
          case 'sum':
            if (!isDate) {
              result.formattedTotal = write(sum);
              result.total = sum;
            }
            break;
          case 'avg':
            if (!isDate) {
              const average = sum / rows.length;
              result.formattedTotal = write(average);
              result.total = average;
            }
            break;
          case 'min':
          case 'max': {
            const total = extreme(values(), totalFunc === 'max');
            result.formattedTotal = write(total);
            result.total = typeof total === 'number' ? total : undefined;
            break;
          }
          case 'count':
            result.formattedTotal = rows.length;
            result.total = rows.length;
            break;
          default:
            break;
        }
      }
      return result;
    });

  if (params.percentageCol) {
    const at = formatted.findIndex((column) => column.title === params.percentageCol);
    // The column it was of was removed
    if (at < 0 || formatted.length === 0) return { columns: formatted, rows };
    const { id, sumTotal } = formatted[at];
    const percents = `${id}-percents`;
    const percent = createFormatter({ id: 'percent' }, context.formatSettings ?? DEFAULT_FORMAT_SETTINGS);
    // As the original's numeral formats, what is not a number is written as nothing
    const text = (value: unknown) => (typeof value !== 'number' || Number.isNaN(value) ? '' : percent(value).text);
    const column: FormattedColumn = {
      id: percents,
      title: `${params.percentageCol} percentages`,
      filterable: false,
      text,
      cell: (value) => ({ text: text(value) }),
    };
    formatted = [...formatted.slice(0, at + 1), column, ...formatted.slice(at + 1)];
    // A share as JavaScript divides: nothing is 0, an undefined value or total is NaN
    formattedRows = rows.map((row) => ({
      [percents]: sumTotal === 0 ? 0 : Number(row[id]) / Number(sumTotal),
      ...row,
    }));
  }
  return { columns: formatted, rows: formattedRows };
}

/**
 * The table, or the tables of a split, as the original's response handler gives them: one table
 * per value of the split, in the order the values come, titled "<value>: <name of the split>"
 */
export function tableVisData(table: Table, params: TableVisParams, context: AggContext, splitAsRows: boolean): TableVisData {
  const split = table.columns.find((column) => column.kind === 'bucket' && column.schema === 'split');
  if (!split) return { table: formatTable(table.columns, table.rows, params, context), tableGroups: [] };
  const groups = new Map<string, { title: string; rows: TableRow[] }>();
  for (const row of table.rows) {
    const value = row[split.id];
    const key = keyText(value);
    let group = groups.get(key);
    if (!group) {
      group = { title: `${formatValue(split, value)}: ${split.name}`, rows: [] };
      groups.set(key, group);
    }
    group.rows.push(row);
  }
  return {
    tableGroups: [...groups.values()].map((group) => ({
      title: group.title,
      table: formatTable(table.columns, group.rows, params, context),
    })),
    direction: splitAsRows ? 'row' : 'column',
  };
}

// --- Order --------------------------------------------------------------------------------------

/** What a value is compared as: a range's key as the original's RangeKey writes itself */
function comparable(value: unknown): unknown {
  if (value !== null && typeof value === 'object') return rawText(value);
  return value;
}

/**
 * lodash's compareAscending, by which the original's `orderBy` sorts: undefined last, then null,
 * then NaN; everything else with `<` and `>`, so text by code units ("x86.tar" before "x86_64")
 */
export function compareAscending(left: unknown, right: unknown): number {
  const value = comparable(left);
  const other = comparable(right);
  if (value === other) return 0;
  const valIsDefined = value !== undefined;
  const valIsNull = value === null;
  const valIsReflexive = value === value;
  const othIsDefined = other !== undefined;
  const othIsNull = other === null;
  const othIsReflexive = other === other;
  // Values are compared as JavaScript compares them: text as text, numbers as numbers
  const greater = (value as number) > (other as number);
  const less = (value as number) < (other as number);
  if ((!othIsNull && greater) || (valIsNull && othIsDefined && othIsReflexive) || (!valIsDefined && othIsReflexive) || !valIsReflexive) {
    return 1;
  }
  if ((!valIsNull && less) || (othIsNull && valIsDefined && valIsReflexive) || (!othIsDefined && valIsReflexive) || !othIsReflexive) {
    return -1;
  }
  return 0;
}

/** lodash's `orderBy(rows, id, direction)`: stable, rows that compare equal keep their order */
export function orderRows(rows: TableRow[], id: string, direction: 'asc' | 'desc'): TableRow[] {
  const sign = direction === 'desc' ? -1 : 1;
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => compareAscending(a.row[id], b.row[id]) * sign || a.index - b.index)
    .map((entry) => entry.row);
}

// --- Filters ------------------------------------------------------------------------------------

/**
 * The filters a cell's "Filter for value" adds, and with `negate` its "Filter out value": the
 * bucket's filter, as the original's createFiltersFromValueClickAction makes it, turned around for
 * "Filter out value" (toggleFilterNegated). The columns are those of the answer the table shows,
 * in its order, and the rows the table's as sorted: what the bucket of the rest needs to be
 * filtered on the terms beside it.
 */
export function cellFilters(
  columns: TableColumn[],
  rows: TableRow[],
  columnIndex: number,
  rowIndex: number,
  negate: boolean,
  context: AggContext
): Filter[] {
  const column = columns[columnIndex];
  const row = rows[rowIndex];
  const value = row?.[column?.id ?? ''];
  if (!column || column.kind !== 'bucket' || value === null || value === undefined) return [];
  // The table and the row go with the click, as the original's event carries them: the bucket of
  // the rest is filtered on the terms of the rows beside it
  const filter = bucketFilter(column, value, context, { table: { columns, rows }, row });
  if (!filter) return [];
  return [negate ? { ...filter, meta: { ...filter.meta, negate: !filter.meta.negate } } : filter];
}

// --- Export -------------------------------------------------------------------------------------

/** A value as the raw export writes it: an object as its text, a range as its key */
export function rawText(value: unknown): string {
  if (value !== null && typeof value === 'object') {
    const key = value as RangeKey & { from?: unknown; to?: unknown; mask?: unknown };
    if ('gte' in key || 'lt' in key || 'label' in key) return `from:${String(key.gte)},to:${String(key.lt)}`;
    if (Array.isArray(value)) return String(value);
    return JSON.stringify(value);
  }
  return String(value);
}

const NON_ALPHANUMERIC = /[^a-zA-Z0-9]/;

/**
 * The CSV of a table as the original's export writes it: a line of titles, a line per row, each
 * ended by CR LF, values joined by `csv:separator` and quoted, when `csv:quoteValues` asks for it,
 * if they hold anything but letters and digits
 */
export function toCsv(formatted: boolean, rows: TableRow[], columns: FormattedColumn[], separator: string, quoteValues: boolean): string {
  const escape = (value: unknown) => {
    let text = typeof value === 'string' ? value : formatted ? String(value) : rawText(value);
    if (quoteValues && NON_ALPHANUMERIC.test(text)) text = `"${text.replace(/"/g, '""')}"`;
    return text;
  };
  const lines = [columns.map((column) => escape(column.title))];
  for (const row of rows) lines.push(columns.map((column) => escape(formatted ? column.text(row[column.id]) : row[column.id])));
  return lines.map((line) => `${line.join(separator)}\r\n`).join('');
}

/** "<title>-raw.csv", or "unsaved-formatted.csv" for a visualization not saved yet */
export const csvFileName = (title: string | undefined, formatted: boolean) =>
  `${title ? title : 'unsaved'}-${formatted ? 'formatted' : 'raw'}.csv`;

// --- Widths -------------------------------------------------------------------------------------

export const MIN_COLUMN_WIDTH = 80;
export const COLUMN_BUFFER = 32;
export const HEADER_BUTTON_SPACE = 24;

/**
 * The widths the original gives the columns: the widest of their cells or of their title (and
 * room for its arrow), measured as a hidden box writes them, and a margin; those someone set by
 * dragging stay, and the rest shrink together, to 80 px at least, when all do not fit
 */
export function columnWidths(
  cellWidths: number[][],
  headerWidths: number[],
  persisted: Array<{ colIndex: number; width: number }>,
  containerWidth: number
): number[] {
  const widths = headerWidths.map((header, index) => Math.max(Math.max(0, ...(cellWidths[index] ?? [])), header + HEADER_BUTTON_SPACE) + COLUMN_BUFFER);
  for (const { colIndex, width } of persisted) {
    if (colIndex >= 0 && colIndex < widths.length) widths[colIndex] = width;
  }
  const total = widths.reduce((sum, width) => sum + width, 0);
  if (total > containerWidth) {
    const kept = new Set(persisted.map(({ colIndex }) => colIndex));
    const keptTotal = persisted.reduce((sum, { colIndex, width }) => (colIndex >= 0 && colIndex < widths.length ? sum + width : sum), 0);
    const remaining = containerWidth - keptTotal;
    const rest = widths.reduce((sum, width, index) => (kept.has(index) ? sum : sum + width), 0);
    if (remaining > 0 && rest > 0) {
      const scale = remaining / rest;
      return widths.map((width, index) => (kept.has(index) ? width : Math.max(width * scale, MIN_COLUMN_WIDTH)));
    }
  }
  return widths;
}

/** A title is cut short when it is half as wide again as the room beside its arrow */
export const truncatesHeader = (titleWidth: number, columnWidth: number) => titleWidth > (columnWidth - HEADER_BUTTON_SPACE) * 1.5;

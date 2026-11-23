/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The file of Discover's "Download as CSV", as the original's download_csv writes it: the columns
 * of the table with the time field first, each value as its field's format writes it as text, the
 * whole document as the JSON of its formatted fields in a `_source` column, joined as papaparse's
 * unparse joins them, after a byte order mark.
 */

import { formatDate } from '../../lib/dates';
import { isFormula, type RawHit } from '../../lib/docs';
import { fieldFormatter, fillTemplate, formatSpecOf, type FormatSettings, type Formatter } from '../../lib/field_formats';
import type { FieldFormatSpec, IndexPattern } from '../../lib/types';
import { sourceEntries } from './doc_table';

/** The most documents "Max available" downloads, as the original's MAX_DOWNLOAD_CSV_COUNT */
export const MAX_DOWNLOAD_CSV_COUNT = 10000;

export type CsvOption = 'visible' | 'max';

/**
 * What the popover offers: the rows on screen, and every hit up to the limit when there are more
 * hits than rows, as the original's DiscoverDownloadCsvPopoverContent counts them
 */
export function csvOptions(rowsCount: number, hitsCount: number): { maxCount: number; showMax: boolean } {
  const maxCount = Math.min(hitsCount, MAX_DOWNLOAD_CSV_COUNT);
  return { maxCount, showMax: maxCount > rowsCount };
}

/**
 * The names of the file's columns, as the original's getLegacyDisplayedColumns names the table's:
 * the chosen columns as the state holds them, after the time field unless doc_table:hideTimeColumn
 * hides it or it is chosen itself
 */
export function csvColumns(columns: readonly string[], timeFieldName: string | undefined, hideTimeColumn: boolean): string[] {
  const withTime = !hideTimeColumn && typeof timeFieldName === 'string' && !columns.includes(timeFieldName);
  return withTime && timeFieldName !== undefined ? [timeFieldName, ...columns] : [...columns];
}

/** What a format's text converter makes of a value: text, or the missing value it hands back */
type TextValue = string | null | undefined;

/**
 * What the original's text converters write for a value that is not there (null or undefined):
 * each format its own, the numbers nothing, the dates and addresses a dash, the text " - "
 */
export function missingText(spec: FieldFormatSpec, value: null | undefined, format: Formatter): TextValue {
  const params = spec.params ?? {};
  switch (spec.id) {
    case 'number':
    case 'bytes':
    case 'percent':
      // parseFloat of it is not a number, which the numeral formats write as nothing
      return '';
    case 'date':
    case 'date_nanos':
    case 'relative_date':
    case 'ip':
      return '-';
    case 'duration':
      // moment.duration(null) is no time at all; of undefined, an invalid duration
      return format(value === null ? 0 : Number.NaN).text;
    case 'truncate':
      // lodash's truncate writes nothing; without a length the value itself is handed back
      return Number(params.fieldLength) > 0 ? '' : value;
    case 'static_lookup': {
      const entries = Array.isArray(params.lookupEntries) ? (params.lookupEntries as Array<{ key: unknown; value: unknown }>) : [];
      const found = new Map(entries.map((entry) => [String(entry.key), entry.value])).get(String(value));
      return (found || params.unknownKeyValue || value) as TextValue;
    }
    case 'url': {
      const urlTemplate = typeof params.urlTemplate === 'string' && params.urlTemplate ? params.urlTemplate : undefined;
      const labelTemplate = typeof params.labelTemplate === 'string' && params.labelTemplate ? params.labelTemplate : undefined;
      const url = urlTemplate ? fillTemplate(urlTemplate, { value: encodeURIComponent(String(value)), rawValue: value }) : value;
      return labelTemplate ? fillTemplate(labelTemplate, { value, url }) : url;
    }
    case '_source':
      return value === null ? 'null' : undefined;
    case 'string':
      switch (params.transform) {
        case 'lower':
          return String(value).toLowerCase();
        case 'upper':
          return String(value).toUpperCase();
        case 'short':
          return value;
        case 'urlparam':
          return String(value);
        // "title" fails on it in the original, and the whole download with it; here it is " - "
        default:
          return ' - ';
      }
    default:
      // The boolean and colour formats, and any other, write it as asPrettyString does
      return ' - ';
  }
}

/**
 * A value as the original's formats write it as text: a list as the JSON of its values each
 * written so, no value as the format writes none, anything else as the format writes it
 */
export function textValue(spec: FieldFormatSpec, format: Formatter, value: unknown): TextValue {
  if (Array.isArray(value)) return JSON.stringify(value.map((item) => textValue(spec, format, item)));
  if (value === null || value === undefined) return missingText(spec, value, format);
  return format(value).text;
}

export interface CsvWriter {
  /**
   * A document as the original's formatHit(hit, 'text') gives it: each field the index pattern
   * makes of it, the meta fields and those returned beside the source, written by its format
   */
  hitText: (hit: RawHit) => Record<string, TextValue>;
  /**
   * The cells of a document under the file's columns, as the original's formatRowsForCsv writes
   * them: a source column the JSON of the whole document as text, any other its field's text
   */
  row: (hit: RawHit, columns: string[]) => TextValue[];
}

/** What writes the documents of an index pattern as text, with the formats of the settings */
export function csvWriter(indexPattern: IndexPattern, settings: FormatSettings, metaFields: string[]): CsvWriter {
  const fields = new Map(indexPattern.fields.map((field) => [field.name, field]));
  // A name the pattern does not know is written by the default format, as the original's
  const fieldText = (name: string, value: unknown) =>
    textValue(formatSpecOf(fields.get(name), indexPattern, settings), fieldFormatter(indexPattern, name, settings), value);
  const hitText = (hit: RawHit) => {
    const result: Record<string, TextValue> = {};
    for (const [name, value] of sourceEntries(hit, indexPattern, metaFields)) result[name] = fieldText(name, value);
    return result;
  };
  const row = (hit: RawHit, columns: string[]) => {
    const flat = new Map(sourceEntries(hit, indexPattern, metaFields));
    return columns.map((name) => {
      if (fields.get(name)?.type === '_source') return JSON.stringify(hitText(hit));
      const text = fieldText(name, name === '_source' ? hit._source : flat.get(name));
      // A format with nothing to say is an empty cell, as the original's
      return text === undefined ? '' : text;
    });
  };
  return { hitText, row };
}

/** What papaparse refuses as a delimiter, and quotes a value for */
const BAD_DELIMITERS = ['\r', '\n', '"', '\ufeff'];

/**
 * A cell as papaparse's unparse writes it: nothing for no value, quoted when csv:quoteValues asks
 * or when the text could not be read back otherwise. A value from a document that a spreadsheet
 * would run as a formula is made text with an apostrophe, and quoted, as papaparse's
 * escapeFormulae does it; the original does not do this.
 */
function csvCell(value: unknown, delimiter: string, quotes: boolean, escapeFormula: boolean): string {
  if (value === undefined || value === null) return '';
  let text = String(value);
  const formula = escapeFormula && typeof value === 'string' && isFormula(text);
  if (formula) text = `'${text}`;
  const escaped = text.replace(/"/g, '""');
  const needsQuotes =
    formula ||
    quotes ||
    BAD_DELIMITERS.some((bad) => escaped.includes(bad)) ||
    escaped.includes(delimiter) ||
    escaped.startsWith(' ') ||
    escaped.endsWith(' ');
  return needsQuotes ? `"${escaped}"` : escaped;
}

/**
 * A CSV file as papaparse's unparse writes it with a header: the column names, then a line to each
 * row, the lines joined by CRLF with none after the last (but after the header when there are no
 * rows, which papaparse reads as one empty row it then leaves out). The delimiter is csv:separator
 * unless it holds what papaparse refuses in one, then a comma.
 */
export function unparseCsv(fields: string[], rows: unknown[][], options: { delimiter: unknown; quotes: unknown }): string {
  const delimiter =
    typeof options.delimiter === 'string' && !BAD_DELIMITERS.some((bad) => (options.delimiter as string).includes(bad))
      ? options.delimiter
      : ',';
  const quotes = options.quotes === true;
  const lines = [fields.map((name) => csvCell(name, delimiter, quotes, false)).join(delimiter)];
  for (const row of rows) lines.push(fields.map((_name, index) => csvCell(row[index], delimiter, quotes, true)).join(delimiter));
  return rows.length === 0 ? `${lines[0]}\r\n` : lines.join('\r\n');
}

/** The name the original's file gets, opensearch_export_ and the day in the zone of the settings */
export function csvFileName(now: Date, timeZone?: string): string {
  return `opensearch_export_${formatDate(now, 'YYYY-MM-DD', timeZone)}.csv`;
}

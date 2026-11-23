/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The tooltip of a shape: tooltip_formatter of region_map (the term and the value) and
 * mapTooltipProvider of maps_legacy, which writes the rows as a table.
 */

import type { RegionMetric } from './util';

export interface TooltipDetail {
  label: string | undefined;
  value: unknown;
}

/** The rows of the tooltip of a shape's term; '' for a shape without one */
export function tooltipFormatter(
  metric: RegionMetric | undefined,
  fieldFormatter: ((value: unknown) => string) | undefined,
  fieldName?: string,
  metricName?: string
): TooltipDetail[] | '' {
  if (!metric) return '';
  const details: TooltipDetail[] = [];
  if (fieldName && metric) details.push({ label: fieldName, value: metric.term });
  if (metric) details.push({ label: metricName, value: fieldFormatter ? fieldFormatter(metric.value) : metric.value });
  return details;
}

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' })[c] ?? c);

/** What React renders a cell's value as: nothing for null, undefined and booleans */
const cell = (value: unknown) =>
  value === null || value === undefined || typeof value === 'boolean' ? '' : escapeHtml(String(value));

/** The table of mapTooltipProvider, as renderToStaticMarkup writes it */
export function tooltipHtml(details: TooltipDetail[]): string {
  const rows = details
    .map((detail) => `<tr><td class="visTooltip__label">${cell(detail.label)}</td><td class="visTooltip__value">${cell(detail.value)}</td></tr>`)
    .join('');
  return `<table><tbody>${rows}</tbody></table>`;
}

/** mapTooltipProvider: the formatter's rows as HTML, or what is falsy as it is */
export function mapTooltipProvider<A extends unknown[]>(formatter: (...args: A) => TooltipDetail[] | '') {
  return (...args: A): string => {
    const details = formatter(...args);
    return details ? tooltipHtml(details) : '';
  };
}

/* SPDX-License-Identifier: Apache-2.0 */

/*
 * What a Timeline visualization asks the server, and the rules of time it shares with the chart:
 * the request handler, `calculateInterval`, `toMS` and the x axis' date format of the original.
 */

import { resolveTimeRange, type AbsoluteRange } from '../../lib/dates';
import { buildQuery } from '../../lib/query';
import { services } from '../../services';
import { HttpFetchError } from '../../services/http';
import type { VisInput } from '../request';

export interface TimelineSeries {
  data: Array<[number, number | null]>;
  label: string;
  color?: string;
  _global?: Record<string, unknown>;
  _hide?: boolean;
  _id?: number;
  _title?: string;
  _meta?: { precision?: number };
  [key: string]: unknown;
}

export interface TimelineSheet {
  type: string;
  list: TimelineSeries[];
  render?: { grid?: boolean };
}

export interface TimelineAnswer {
  sheet: TimelineSheet[];
  stats?: Record<string, number>;
}

export interface TimelineParams {
  expression?: string;
  interval?: string;
}

/** The time zone the request names: the browser's when the setting is left as it is */
export function requestTimeZone(): string {
  const settings = services.uiSettings;
  if (settings.isDefault('dateFormat:tz')) {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (detected) return detected;
    const minutes = -new Date().getTimezoneOffset();
    const abs = Math.abs(minutes);
    return `${minutes < 0 ? '-' : '+'}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
  }
  return settings.get<string>('dateFormat:tz', 'Browser');
}

/** The body of the request: the page's query and filters, the time range and the expression */
export function timelineBody(params: TimelineParams, input: VisInput, range: AbsoluteRange) {
  return {
    sheet: [params.expression],
    extended: {
      es: { filter: buildQuery(undefined, input.query, input.filters, services.queryConfig()) },
    },
    time: {
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      interval: params.interval,
      timezone: requestTimeZone(),
    },
  };
}

export function timeBounds(input: VisInput): AbsoluteRange {
  const range = resolveTimeRange(input.time, { weekStart: services.weekStart() });
  if (!range) throw new Error('Invalid time range');
  return range;
}

export async function fetchTimeline(params: TimelineParams, input: VisInput, signal?: AbortSignal) {
  if (!params.expression) throw new Error('Timeline error: No expression provided');
  const range = timeBounds(input);
  const body = timelineBody(params, input, range);
  try {
    const answer = await services.http.post<TimelineAnswer>('/api/timeline/run', { body, signal });
    return { answer, body, range };
  } catch (failure) {
    if (failure instanceof HttpFetchError && failure.body && typeof failure.body === 'object') {
      const errorBody = failure.body as { message?: string; attributes?: { title?: string } };
      const title = errorBody.attributes?.title;
      const error = new Error(`Timeline request error${title ? ` (${title})` : ''}: ${errorBody.message}`);
      throw error;
    }
    throw failure;
  }
}

// --- Intervals --------------------------------------------------------------------------------------

const UNIT_GROUPS: Array<[number, string[]]> = [
  [1, ['ms', 'milliseconds', 'millisecond']],
  [1000, ['s', 'seconds', 'second', 'sec']],
  [60000, ['m', 'minutes', 'minute', 'min']],
  [3600000, ['h', 'hours', 'hour']],
  [86400000, ['d', 'days', 'day']],
  [604800000, ['w', 'weeks', 'week']],
  [2592000000, ['M', 'months', 'month']],
  [7776000000, ['quarter', 'quarters', 'Q']],
  [31536000000, ['y', 'years', 'year']],
];
const UNIT_MS: Record<string, number> = {};
for (const [ms, names] of UNIT_GROUPS) for (const name of names) UNIT_MS[name] = ms;
const TO_MS = new RegExp(`^(\\d+(?:\\.\\d*)?)?\\s*(${Object.keys(UNIT_MS).join('|')})$`);

/** An interval such as "1h" in milliseconds, or undefined when it is not one */
export function toMS(expression: string): number | undefined {
  const match = expression.match(TO_MS);
  if (!match) return undefined;
  if (match[2] === 'M' && match[1] !== '1') throw new Error('Invalid interval. 1M is only valid monthly interval.');
  return parseFloat(match[1] || '1') * UNIT_MS[match[2]];
}

function roundInterval(interval: number): string {
  if (interval <= 500) return '100ms';
  if (interval <= 5000) return '1s';
  if (interval <= 7500) return '5s';
  if (interval <= 15000) return '10s';
  if (interval <= 45000) return '30s';
  if (interval <= 180000) return '1m';
  if (interval <= 450000) return '5m';
  if (interval <= 1200000) return '10m';
  if (interval <= 2700000) return '30m';
  if (interval <= 7200000) return '1h';
  if (interval <= 21600000) return '3h';
  if (interval <= 86400000) return '12h';
  if (interval <= 604800000) return '24h';
  if (interval <= 1814400000) return '1w';
  if (interval < 3628800000) return '30d';
  return '1y';
}

export function calculateInterval(from: number, to: number, size: number, interval: string, min: string): string {
  if (interval !== 'auto') return interval;
  const rounded = roundInterval((to - from) / size);
  const roundedMs = toMS(rounded);
  const minMs = toMS(min);
  if (roundedMs !== undefined && minMs !== undefined && roundedMs < minMs) return min;
  return rounded;
}

// --- The format of the x axis --------------------------------------------------------------------

/** The length of an ISO 8601 duration as moment counts it: a month of 30 days, a year of 365 */
export function isoDurationMs(text: string): number {
  const match = /^P(?:(\d+(?:\.\d+)?)Y)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)W)?(?:(\d+(?:\.\d+)?)D)?T?(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(
    text.trim()
  );
  if (!match) return 0;
  const [, y, mo, w, d, h, mi, s] = match.map((part) => (part === undefined ? 0 : parseFloat(part)));
  return y * 31536e6 + mo * 2592e6 + w * 6048e5 + d * 864e5 + h * 36e5 + mi * 6e4 + s * 1e3;
}

const MOMENT_UNIT_MS: Record<string, number> = { ms: 1, '': 1, s: 1e3, m: 6e4, h: 36e5, d: 864e5, w: 6048e5, M: 2592e6, y: 31536e6 };

/** The date format of the x axis for an interval: the setting dateFormat:scaled, as the original reads it */
export function xaxisFormat(interval: string): string {
  const parts = interval.match(/(\d+)(ms|s|m|h|d|w|M|y|)/);
  if (parts === null) throw new Error('Unknown interval');
  const ms = Number(parts[1]) * MOMENT_UNIT_MS[parts[2]];
  let rules: Array<[string, string]> = [];
  const value = services.uiSettings.get<unknown>('dateFormat:scaled');
  try {
    rules = (typeof value === 'string' ? JSON.parse(value) : value) as Array<[string, string]>;
  } catch {
    rules = [];
  }
  for (let i = rules.length - 1; i >= 0; i--) {
    const rule = rules[i];
    if (!rule[0] || ms >= isoDurationMs(rule[0])) return rule[1];
  }
  return services.uiSettings.get<string>('dateFormat');
}

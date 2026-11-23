/* SPDX-License-Identifier: Apache-2.0 */

/*
 * A time range whose ends are reversed (from 2026-11-29 to 2026-11-15, or now to now-30d). Measured
 * on the reference: the histogram is asked by 12 hours, as for the range the right way round, and
 * the time filter keeps the ends as they are (gte the later, lte the earlier: no hits).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { aggContext, buildDiscoverRequest } from '../../web/apps/discover/search';
import type { Field, IndexPattern } from '../../web/lib/types';
import { createServices, type BootData } from '../../web/services';

const field = (name: string, type: string): Field => ({ name, type, searchable: true, aggregatable: true });
const logs: IndexPattern = { id: 'logs', title: 'logs', timeFieldName: 'timestamp', fields: [field('timestamp', 'date')], fieldFormatMap: {} };
const range = { from: new Date('2026-11-15T00:00:00.000Z'), to: new Date('2026-11-29T00:00:00.000Z') };
const reversed = { from: range.to, to: range.from };

const startServices = () =>
  createServices({ basePath: '', version: '3.9.0', name: 'test', settings: {}, settingsDefaults: {}, settingsOverrides: {} } as unknown as BootData);

/** The histogram's interval and the time filter of a request */
function requestParts(body: Record<string, unknown>) {
  const aggs = body.aggs as Record<string, { date_histogram: Record<string, unknown> }> | undefined;
  const histogram = aggs?.['2']?.date_histogram;
  const filters = (body.query as { bool: { filter: Array<Record<string, Record<string, Record<string, unknown>>>> } }).bool.filter;
  const time = filters.find((clause) => clause.range)?.range.timestamp;
  return { interval: histogram?.fixed_interval ?? histogram?.calendar_interval, gte: time?.gte, lte: time?.lte };
}

describe('a time range whose ends are reversed', () => {
  it('gets the interval of the time between them, as the reference (12h, not 1ms)', () => {
    startServices();
    const context = aggContext(logs, reversed);
    assert.equal(context.timeRange?.from.toISOString(), '2026-11-15T00:00:00.000Z');
    assert.equal(context.timeRange?.to.toISOString(), '2026-11-29T00:00:00.000Z');
    const request = (time: typeof range) => buildDiscoverRequest({ indexPattern: logs, query: { query: '', language: 'kuery' }, filters: [], range: time, sort: [], size: 5 });
    assert.equal(requestParts(request(reversed)).interval, '12h');
    assert.equal(requestParts(request(range)).interval, '12h');
  });

  it('is searched as it is, as the reference sent it', () => {
    startServices();
    const parts = requestParts(buildDiscoverRequest({ indexPattern: logs, query: { query: '', language: 'kuery' }, filters: [], range: reversed, sort: [], size: 5 }));
    assert.equal(parts.gte, '2026-11-29T00:00:00.000Z');
    assert.equal(parts.lte, '2026-11-15T00:00:00.000Z');
    // A range the right way round is used as it is
    assert.equal(aggContext(logs, range).timeRange, range);
  });
});

/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The zone the page's settings give a query: a date typed in a query is read on the clock of the
 * browser, unless dateFormat:tz names a zone, as in OpenSearch Dashboards.
 */

// A browser that is not on UTC: New York
process.env.TZ = 'America/New_York';

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildQuery } from '../../web/lib/query';
import type { IndexPattern } from '../../web/lib/types';
import { createServices, type BootData } from '../../web/services';

const pattern: IndexPattern = {
  id: 'p',
  title: 'p',
  timeFieldName: 'timestamp',
  fieldFormatMap: {},
  fields: [{ name: 'timestamp', type: 'date', searchable: true, aggregatable: true }],
};

function queryConfigWith(settings: Record<string, unknown>) {
  const boot = { basePath: '', version: '3.9.0', name: 'test', settings, settingsDefaults: {}, settingsOverrides: {} };
  return createServices(boot as unknown as BootData).queryConfig();
}

describe('the zone of the dates in a query', () => {
  const typed = { query: 'timestamp >= "2026-11-20"', language: 'kuery' };
  const lucene = { query: 'timestamp:[2026-11-20 TO 2026-11-21}', language: 'lucene' };

  it('is the zone of the browser while dateFormat:tz is "Browser"', () => {
    const config = queryConfigWith({});
    assert.equal(config.dateFormatTZ, 'Browser');
    assert.deepEqual(buildQuery(pattern, typed, [], config).bool.filter, [
      { bool: { should: [{ range: { timestamp: { gte: '2026-11-20', time_zone: 'America/New_York' } } }], minimum_should_match: 1 } },
    ]);
    assert.deepEqual(buildQuery(pattern, lucene, [], config).bool.must, [
      { query_string: { query: 'timestamp:[2026-11-20 TO 2026-11-21}', analyze_wildcard: true, time_zone: 'America/New_York' } },
    ]);
  });

  it('is the zone dateFormat:tz names', () => {
    const config = queryConfigWith({ 'dateFormat:tz': 'Asia/Kolkata' });
    assert.deepEqual(buildQuery(pattern, typed, [], config).bool.filter, [
      { bool: { should: [{ range: { timestamp: { gte: '2026-11-20', time_zone: 'Asia/Kolkata' } } }], minimum_should_match: 1 } },
    ]);
    assert.deepEqual(buildQuery(pattern, lucene, [], config).bool.must, [
      { query_string: { query: 'timestamp:[2026-11-20 TO 2026-11-21}', analyze_wildcard: true, time_zone: 'Asia/Kolkata' } },
    ]);
  });
});

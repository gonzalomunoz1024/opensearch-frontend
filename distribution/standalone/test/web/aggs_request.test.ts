/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AggConfig, AggContext } from '../../web/lib/aggs';
import type { Field, Filter, IndexPattern } from '../../web/lib/types';
import type { Vis } from '../../web/lib/vis';
import { contextFilters, fieldBoundsAggs, uniqueQueries, visQuery } from '../../web/vis/request';

const field = (name: string, type: string, more: Partial<Field> = {}): Field => ({ name, type, searchable: true, aggregatable: true, ...more });
const logs: IndexPattern = {
  id: 'logs',
  title: 'logs-*',
  fields: [field('bytes', 'number'), field('os', 'string'), field('hour_of_day', 'number', { scripted: true, script: "doc['timestamp'].value.getHour()", lang: 'painless' })],
  fieldFormatMap: {},
};
const context: AggContext = { indexPattern: logs };
const vis = (source: Vis['source'], parent?: Vis['parent']): Vis => ({ title: '', description: '', type: 'table', params: {}, aggs: [], uiState: {}, source, parent, references: [] });
const phrase = (value: string, more: Partial<Filter['meta']> = {}): Filter => ({ meta: { index: 'logs', ...more }, query: { match_phrase: { os: value } } });

describe('the query of a visualization, as the original puts it together', () => {
  it('asks once what the page and the visualization both ask', () => {
    const empty = { query: '', language: 'kuery' };
    const query = visQuery(vis({ indexId: 'logs', filters: [], query: { ...empty } }), logs, { time: { from: 'now-15m', to: 'now' }, query: { ...empty }, filters: [] }, context);
    assert.deepEqual(query.bool.filter, [{ match_all: {} }]);
  });

  it('keeps the first of the queries that are typed the same, whatever their language', () => {
    assert.deepEqual(
      uniqueQueries([{ query: 'a', language: 'kuery' }, undefined, { query: 'a', language: 'lucene' }, { query: 'b', language: 'kuery' }, { query: '', language: 'kuery' }]),
      [
        { query: 'a', language: 'kuery' },
        { query: 'b', language: 'kuery' },
        { query: '', language: 'kuery' },
      ]
    );
  });

  it("asks the page's query, the visualization's and its saved search's when they differ", () => {
    const query = visQuery(
      vis({ indexId: 'logs', filters: [], query: { query: 'os:ios', language: 'kuery' } }, { indexId: 'logs', filters: [], query: { query: 'bytes>1', language: 'kuery' } }),
      logs,
      { time: { from: 'now-15m', to: 'now' }, query: { query: '', language: 'kuery' }, filters: [] },
      context
    );
    assert.equal(query.bool.filter.length, 3);
  });

  it('asks a filter once, a negated one apart, and none that is switched off', () => {
    const kept = contextFilters([phrase('ios'), phrase('ios', { alias: 'again' }), phrase('ios', { negate: true }), phrase('osx', { disabled: true }), phrase('win 8')]);
    assert.deepEqual(
      kept.map((filter) => [(filter.query as { match_phrase: { os: string } }).match_phrase.os, Boolean(filter.meta.negate)]),
      [
        ['ios', false],
        ['ios', true],
        ['win 8', false],
      ]
    );
  });
});

describe('the bounds asked for a number histogram', () => {
  const histogram = (id: string, name: string): AggConfig => ({ id, enabled: true, type: 'histogram', schema: 'bucket', params: { field: name, interval: 'auto' } });

  it('asks a field by its name and a scripted field by its script', () => {
    assert.deepEqual(fieldBoundsAggs([histogram('2', 'bytes'), histogram('3', 'hour_of_day')], logs), {
      min_2: { min: { field: 'bytes' } },
      max_2: { max: { field: 'bytes' } },
      min_3: { min: { script: { source: "doc['timestamp'].value.getHour()", lang: 'painless' } } },
      max_3: { max: { script: { source: "doc['timestamp'].value.getHour()", lang: 'painless' } } },
    });
  });
});

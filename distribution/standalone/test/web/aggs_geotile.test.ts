/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { availableFields, serializeAgg } from '../../web/apps/visualize/agg_params';
import { aggTypeOptions, allowedAggs, changeAggType, paramProblems } from '../../web/apps/visualize/defaults';
import { aggLabel, buildAggsDsl, tabify, type AggConfig, type AggContext } from '../../web/lib/aggs';
import type { Field, IndexPattern } from '../../web/lib/types';
import { visType } from '../../web/lib/vis';

const field = (name: string, type: string): Field => ({ name, type, searchable: true, aggregatable: true });
const logs: IndexPattern = {
  id: 'logs',
  title: 'logs-*',
  timeFieldName: 'timestamp',
  fields: [field('timestamp', 'date'), field('geo.coordinates', 'geo_point'), field('machine.os.keyword', 'string')],
  fieldFormatMap: {},
};
const context: AggContext = { indexPattern: logs };
const count: AggConfig = { id: '1', enabled: true, type: 'count', schema: 'metric', params: {} };
const geotile = (params: Record<string, unknown> = {}): AggConfig => ({ id: '2', enabled: true, type: 'geotile_grid', schema: 'bucket', params: { field: 'geo.coordinates', ...params } });
const terms: AggConfig = { id: '3', enabled: true, type: 'terms', schema: 'bucket', params: { field: 'machine.os.keyword', size: 2, order: 'desc', orderBy: '1' } };
const schemaOf = (type: string, name: string) => {
  const schema = visType(type)?.schemas?.find((candidate) => candidate.name === name);
  if (!schema) throw new Error(`no schema ${name}`);
  return schema;
};

describe('the geotile_grid aggregation, as the original defines it', () => {
  it('is offered as "Geotile" where the original offers it: a table, not a chart with axes', () => {
    assert.ok(allowedAggs('table', schemaOf('table', 'bucket')).includes('geotile_grid'));
    assert.ok(!allowedAggs('histogram', schemaOf('histogram', 'segment')).includes('geotile_grid'));
    assert.ok(!allowedAggs('tile_map', schemaOf('tile_map', 'segment')).includes('geotile_grid'));
    assert.deepEqual(
      aggTypeOptions(['geohash_grid', 'geotile_grid']).map((option) => option.label),
      ['Geohash', 'Geotile']
    );
  });

  it('is on a geo_point field, and is named after its type', () => {
    assert.deepEqual(
      availableFields('geotile_grid', logs).map((candidate) => candidate.name),
      ['geo.coordinates']
    );
    assert.equal(aggLabel(geotile(), context), 'geotile_grid');
    assert.equal(aggLabel(geotile({ customLabel: 'Tiles' }), context), 'Tiles');
    assert.deepEqual(paramProblems(geotile(), logs), {});
    assert.equal(paramProblems(geotile({ field: undefined }), logs).field, true);
  });

  it('starts with the centroid asked for and a precision of 0, written after the field', () => {
    const made = changeAggType({ id: '2', enabled: true, type: '', schema: 'bucket', params: {} }, 'geotile_grid', logs, [count]);
    assert.deepEqual(made.params, { useGeocentroid: true, precision: 0 });
    assert.deepEqual(Object.keys(serializeAgg(geotile({ customLabel: 'Tiles', json: '{}', precision: 3 }), {}).params ?? {}), [
      'field',
      'useGeocentroid',
      'precision',
      'json',
      'customLabel',
    ]);
  });

  it('asks without a precision when it is 0, and for the centroid as one more metric', () => {
    assert.deepEqual(buildAggsDsl([count, geotile()], context), {
      '2': { geotile_grid: { field: 'geo.coordinates' }, aggs: { '3': { geo_centroid: { field: 'geo.coordinates' } } } },
    });
    assert.deepEqual(buildAggsDsl([count, geotile({ precision: 0, useGeocentroid: true })], context), {
      '2': { geotile_grid: { field: 'geo.coordinates' }, aggs: { '3': { geo_centroid: { field: 'geo.coordinates' } } } },
    });
  });

  it('asks at the precision saved, without the centroid when it is switched off, with its JSON input', () => {
    assert.deepEqual(buildAggsDsl([count, geotile({ precision: 2, useGeocentroid: false, json: '{"size": 3}' })], context), {
      '2': { geotile_grid: { field: 'geo.coordinates', precision: 2, size: 3 } },
    });
  });

  it('asks for the centroid under the last bucket, as the original moves metrics there', () => {
    assert.deepEqual(buildAggsDsl([count, geotile({ precision: 3 }), terms], context), {
      '2': {
        geotile_grid: { field: 'geo.coordinates', precision: 3 },
        aggs: {
          '3': {
            terms: { field: 'machine.os.keyword', size: 2, order: { _count: 'desc' } },
            aggs: { '4': { geo_centroid: { field: 'geo.coordinates' } } },
          },
        },
      },
    });
  });

  it('asks for the centroid of a geohash_grid under the last bucket too', () => {
    const geohash: AggConfig = { id: '2', enabled: true, type: 'geohash_grid', schema: 'bucket', params: { field: 'geo.coordinates', precision: 2, isFilteredByCollar: false } };
    assert.deepEqual(buildAggsDsl([count, geohash, terms], context), {
      '2': {
        geohash_grid: { field: 'geo.coordinates', precision: 2 },
        aggs: {
          '3': {
            terms: { field: 'machine.os.keyword', size: 2, order: { _count: 'desc' } },
            aggs: { '4': { geo_centroid: { field: 'geo.coordinates' } } },
          },
        },
      },
    });
  });

  it('reads its buckets by their keys, the centroid after the metrics of the last bucket', () => {
    const response = {
      aggregations: {
        '2': {
          buckets: [
            { key: '3/1/3', doc_count: 9, '3': { buckets: [{ key: 'win 8', doc_count: 5, '4': { location: { lat: 40, lon: -100 }, count: 5 } }] } },
            { key: '3/2/3', doc_count: 4, '3': { buckets: [{ key: 'osx', doc_count: 4, '4': { location: { lat: 41, lon: -80 }, count: 4 } }] } },
          ],
        },
      },
    };
    const table = tabify([count, geotile({ precision: 3 }), terms], response, context);
    assert.deepEqual(
      table.columns.map((column) => [column.id, column.name]),
      [
        ['col-0-2', 'geotile_grid'],
        ['col-1-3', 'machine.os.keyword: Descending'],
        ['col-2-1', 'Count'],
        ['col-3-4', 'Geo Centroid'],
      ]
    );
    assert.deepEqual(
      table.rows.map((row) => Object.values(row)),
      [
        ['3/1/3', 'win 8', 5, { lat: 40, lon: -100 }],
        ['3/2/3', 'osx', 4, { lat: 41, lon: -80 }],
      ]
    );
  });
});

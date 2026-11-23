/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { newVis } from '../../web/apps/visualize/defaults';
import { buildAggsDsl, tabify, type AggConfig, type AggContext } from '../../web/lib/aggs';
import { describeFilter } from '../../web/lib/query';
import type { Field, Filter, IndexPattern } from '../../web/lib/types';
import { decodeGeoHash } from '../../web/maps/geohash';
import { DEFAULT_WMS, GEOHASH_DEFAULTS, MAP_TYPE_OPTIONS, tileMapDefaults } from '../../web/vis/tile_map/defaults';
import {
  convertToGeoJson,
  darker,
  dataToHeatArray,
  distance,
  featuresPrecision,
  geohashMinDistance,
  gridDimensions,
  heatmapRadius,
  heatmapTooltipProximity,
  legendColors,
  legendEntries,
  markerStyles,
  maxPrecisionOf,
  needsNewSearch,
  nextGeohashParams,
  quantize,
  radiusScale,
  round,
  scaleBounds,
  spatialFilter,
  tooltipDetails,
  tooltipHtml,
} from '../../web/vis/tile_map/geo';
import { gatherHeat, heatZoomFactor } from '../../web/vis/tile_map/heat_layer_math';

const field = (name: string, type: string): Field => ({ name, type, searchable: true, aggregatable: true });
const logs: IndexPattern = {
  id: 'logs-id',
  title: 'logs-*',
  timeFieldName: 'timestamp',
  fields: [field('timestamp', 'date'), field('geo.coordinates', 'geo_point'), field('bytes', 'number')],
  fieldFormatMap: {},
};
const context: AggContext = { indexPattern: logs };
const count: AggConfig = { id: '1', enabled: true, type: 'count', schema: 'metric', params: {} };
const geohash = (params: Record<string, unknown> = {}): AggConfig => ({
  id: '2',
  enabled: true,
  type: 'geohash_grid',
  schema: 'segment',
  params: { field: 'geo.coordinates', autoPrecision: true, precision: 2, useGeocentroid: true, isFilteredByCollar: true, ...params },
});

describe('the request of a coordinate map', () => {
  it('asks within the default box before the map knows its size, with the centroid as the next id', () => {
    assert.deepEqual(buildAggsDsl([count, geohash()], context), {
      filter_agg: {
        filter: { geo_bounding_box: { ignore_unmapped: true, 'geo.coordinates': { top_left: { lat: 1, lon: 1 }, bottom_right: { lat: 0, lon: 0 } } } },
        aggs: { '2': { geohash_grid: { field: 'geo.coordinates', precision: 2 }, aggs: { '3': { geo_centroid: { field: 'geo.coordinates' } } } } },
      },
    });
  });

  it('asks within the collar and at the precision the map set', () => {
    const boundingBox = { top_left: { lat: 90, lon: -180 }, bottom_right: { lat: -76.18257, lon: 59.589845 } };
    const dsl = buildAggsDsl([count, geohash({ boundingBox, precision: 3 })], context) as {
      filter_agg: { filter: { geo_bounding_box: Record<string, unknown> }; aggs: Record<string, { geohash_grid: { precision: number } }> };
    };
    assert.deepEqual(dsl.filter_agg.filter.geo_bounding_box['geo.coordinates'], boundingBox);
    assert.equal(dsl.filter_agg.aggs['2'].geohash_grid.precision, 3);
  });

  it('leaves out the filter and the centroid when they are switched off', () => {
    assert.deepEqual(buildAggsDsl([count, geohash({ isFilteredByCollar: false, useGeocentroid: false })], context), {
      '2': { geohash_grid: { field: 'geo.coordinates', precision: 2 } },
    });
  });

  it('puts a metric beside the centroid and names the centroid after the largest id', () => {
    const avg: AggConfig = { id: '7', enabled: true, type: 'avg', schema: 'metric', params: { field: 'bytes' } };
    const dsl = buildAggsDsl([avg, geohash({ isFilteredByCollar: false })], context) as Record<string, { aggs: Record<string, unknown> }>;
    assert.deepEqual(Object.keys(dsl['2'].aggs).sort(), ['7', '8']);
  });

  it('reads the buckets from inside the filter, with their centroids', () => {
    const response = {
      aggregations: {
        filter_agg: {
          doc_count: 10,
          '2': {
            buckets: [
              { key: '9q', doc_count: 7, '3': { location: { lat: 36.5, lon: -120.1 }, count: 7 } },
              { key: 'dr', doc_count: 3, '3': { location: { lat: 40.7, lon: -74 }, count: 3 } },
            ],
          },
        },
      },
    };
    const table = tabify([count, geohash()], response, context);
    assert.deepEqual(
      table.columns.map((column) => [column.name, column.schema]),
      [
        ['Geohash', 'segment'],
        ['Count', 'metric'],
        ['Geo Centroid', 'geo_centroid'],
      ]
    );
    assert.deepEqual(
      table.rows.map((row) => Object.values(row)),
      [
        ['9q', 7, { lat: 36.5, lon: -120.1 }],
        ['dr', 3, { lat: 40.7, lon: -74 }],
      ]
    );
  });
});

describe('the answer as GeoJSON', () => {
  it('places each bucket at its centroid, kept inside its cell', () => {
    const cell = decodeGeoHash('9q');
    const { featureCollection, meta } = convertToGeoJson(
      [
        { geohash: '9q', value: 7, centroid: { lat: 36.5, lon: -120.1 } },
        { geohash: 'dr', value: 3, centroid: { lat: 89, lon: 0 } },
        { geohash: null, value: 1 },
      ],
      { precision: 2, useGeocentroid: true, hasCentroid: true }
    );
    assert.equal(featureCollection.features.length, 2);
    assert.deepEqual(featureCollection.features[0].geometry.coordinates, [-120.1, 36.5]);
    const clamped = featureCollection.features[1].geometry.coordinates;
    const dr = decodeGeoHash('dr');
    assert.deepEqual(clamped, [dr.longitude[1], dr.latitude[1]]);
    assert.deepEqual(featureCollection.features[0].properties.geohash_meta.center, [cell.latitude[2], cell.longitude[2]]);
    assert.deepEqual(featureCollection.features[0].properties.geohash_meta.rectangle[0], [cell.latitude[0], cell.longitude[0]]);
    assert.deepEqual(meta, { min: 3, max: 7, geohashPrecision: 2, geohashGridDimensionsAtEquator: [1252300, 624100] });
  });

  it('uses the cell centre without a centroid, and has no features without rows', () => {
    const { featureCollection } = convertToGeoJson([{ geohash: 's', value: 1 }], { precision: 1 });
    assert.deepEqual(featureCollection.features[0].geometry.coordinates, [22.5, 22.5]);
    const empty = convertToGeoJson(null, {});
    assert.deepEqual(empty.featureCollection.features, []);
    assert.equal(empty.meta.min, Infinity);
    assert.equal(gridDimensions(undefined), undefined);
    assert.deepEqual(gridDimensions(12), [0.037, 0.019]);
  });
});

describe('the collar and the next search', () => {
  it('rounds as lodash does', () => {
    assert.equal(round(1.005, 2), 1.01);
    assert.equal(round(-76.182574, 5), -76.18257);
  });

  it('grows the view by half on each side, within the world', () => {
    assert.deepEqual(scaleBounds({ top_left: { lat: 60, lon: -150 }, bottom_right: { lat: 10, lon: -60 } }), {
      top_left: { lat: 85, lon: -180 },
      bottom_right: { lat: -15, lon: -15 },
    });
    // A map without height takes its width
    assert.deepEqual(scaleBounds({ top_left: { lat: 0, lon: 0 }, bottom_right: { lat: 0, lon: 10 } }), {
      top_left: { lat: 5, lon: -5 },
      bottom_right: { lat: -5, lon: 15 },
    });
  });

  it('keeps the box it asked for while the collar is inside it', () => {
    const box = { top_left: { lat: 80, lon: -170 }, bottom_right: { lat: -20, lon: 20 } };
    const view = { top_left: { lat: 40, lon: -110 }, bottom_right: { lat: 30, lon: -90 } };
    const next = nextGeohashParams({ autoPrecision: true, boundingBox: box }, view, 3, 7);
    assert.equal(next.boundingBox, box);
    assert.equal(next.precision, 2);
    const moved = nextGeohashParams({ autoPrecision: true, boundingBox: box }, { top_left: { lat: 40, lon: 0 }, bottom_right: { lat: 30, lon: 30 } }, 5, 7);
    assert.deepEqual(moved.boundingBox, { top_left: { lat: 45, lon: -15 }, bottom_right: { lat: 25, lon: 45 } });
    assert.equal(moved.precision, 3);
  });

  it('takes the precision of the zoom, or the aggregation own capped by the setting', () => {
    const view = { top_left: { lat: 1, lon: 1 }, bottom_right: { lat: 0, lon: 2 } };
    assert.equal(nextGeohashParams({ autoPrecision: true }, view, 10, 7).precision, 5);
    assert.equal(nextGeohashParams({ autoPrecision: true }, view, 18, 7).precision, 7);
    assert.equal(nextGeohashParams({ autoPrecision: false, precision: 9 }, view, 3, 7).precision, 7);
    assert.equal(nextGeohashParams({ autoPrecision: false, precision: 'x' }, view, 3, 7).precision, 2);
    assert.equal(maxPrecisionOf('10'), 10);
    assert.equal(maxPrecisionOf(undefined), 12);
  });

  it('searches again only when the box or the precision change', () => {
    const box = { top_left: { lat: 1, lon: 1 }, bottom_right: { lat: 0, lon: 0 } };
    assert.equal(needsNewSearch({ precision: 2, boundingBox: box }, { precision: 2, boundingBox: { ...box } }), false);
    assert.equal(needsNewSearch({ precision: 2, boundingBox: null }, { precision: 2, boundingBox: box }), true);
    assert.equal(needsNewSearch({ precision: 2, boundingBox: box }, { precision: 3, boundingBox: box }), true);
  });
});

describe('the colours and sizes of the markers', () => {
  it('has the legend colours of the Atlas palette', () => {
    assert.deepEqual(legendColors('Yellow to Red'), ['rgb(255,126,12)', 'rgb(255,110,21)', 'rgb(255,93,30)', 'rgb(255,59,48)']);
    assert.equal(legendColors('Yellow to Red', true)[3], 'rgb(255,69,58)');
    assert.equal(legendColors('Blues', true)[0], 'rgb(216,226,239)');
    assert.deepEqual(legendColors('nope'), []);
  });

  it('darkens as d3 v3 hcl does', () => {
    // The reference's legend: rgb(255,126,12) is outlined in rgb(180,65,0)
    assert.equal(darker('rgb(255,126,12)', 1.3), '#b44100');
    assert.equal(darker('rgb(255,59,48)', 1.3), '#b20000');
    assert.equal(darker('#ffffff', 0), '#ffffff');
  });

  it('cuts the values into the legend colours', () => {
    const scale = quantize([1, 196], ['a', 'b', 'c', 'd']);
    assert.equal(scale(1), 'a');
    assert.equal(scale(49), 'a');
    assert.equal(scale(50), 'b');
    assert.equal(scale(196), 'd');
    assert.equal(scale(500), 'd');
    assert.deepEqual(scale.invertExtent('b'), [49.75, 98.5]);
    const entries = legendEntries({ min: 1, max: 196 }, legendColors('Yellow to Red'), (value) => String(value));
    assert.deepEqual(
      entries.map((entry) => entry.label),
      ['1 – 49.75', '49.75 – 98.5', '98.5 – 147.25', '147.25 – 196']
    );
    const { style, domain } = markerStyles({ min: 5, max: 5 }, ['x', 'y']);
    assert.deepEqual(domain, [0, 1]);
    assert.deepEqual(style(0.7), { fillColor: 'y', color: darker('y', 1.3), weight: 1.5, opacity: 1, fillOpacity: 0.75 });
  });

  it('sizes scaled circles by the square root of the value, the zoom and the precision', () => {
    assert.equal(radiusScale(100, 100, 3, 2), 4 * 8);
    assert.equal(radiusScale(25, 100, 3, 2), 0.5 * 4 * 8);
    assert.equal(radiusScale(-100, 100, 0, 1), 0.5 * 40);
    const features = convertToGeoJson([{ geohash: '9q8', value: 1 }, { geohash: '9q', value: 1 }], {}).featureCollection.features;
    assert.equal(featuresPrecision(features), 3);
  });

  it('fits shaded circles in their cell', () => {
    assert.equal(Math.round(distance(0, 0, 0, 1)), 111195);
    const meta = convertToGeoJson([{ geohash: 's0', value: 1 }], {}).featureCollection.features[0].properties.geohash_meta;
    const radius = geohashMinDistance(meta);
    assert.equal(radius, Math.floor(distance(meta.center[0], meta.center[1], meta.rectangle[3][0], meta.center[1])));
  });
});

describe('the heat map', () => {
  it('weighs each point by its value over the largest', () => {
    const { featureCollection } = convertToGeoJson([{ geohash: 's', value: 5 }, { geohash: 'u', value: 10 }], {});
    assert.deepEqual(dataToHeatArray(featureCollection, 10), [
      [22.5, 22.5, 0.5],
      [67.5, 22.5, 1],
    ]);
  });

  it('takes its radius from the cell size in pixels and the cluster size', () => {
    assert.equal(heatmapRadius({ min: 0, max: 1, geohashGridDimensionsAtEquator: [1252300, 624100] }, 1000, 1.5), (624100 / 1000 / 2) * 1.5);
    assert.equal(heatmapRadius({ min: 0, max: 1 }, 1000, '2'), 30);
  });

  it('shows a tooltip nearer as the map zooms in, as its linear scale', () => {
    assert.equal(heatmapTooltipProximity(1), 1000000);
    assert.equal(heatmapTooltipProximity(2.5), 650000);
    assert.equal(heatmapTooltipProximity(18), 50);
    assert.equal(heatmapTooltipProximity(19), 0);
  });

  it('gathers the points of a cell at their weighted mean, as leaflet.heat', () => {
    const data = gatherHeat(
      [
        { x: 10, y: 10, intensity: 1 },
        { x: 12, y: 10, intensity: 3 },
        { x: 200, y: 200, intensity: 2 },
        { x: -100, y: 10, intensity: 1 },
      ],
      { radius: 20, size: { x: 300, y: 300 }, panePos: { x: 0, y: 0 }, max: 1.5, zoomFactor: 0.5 }
    );
    assert.deepEqual(data, [
      [12, 10, 1.5],
      [200, 200, 1],
    ]);
    assert.equal(heatZoomFactor(4, 4), 1);
    assert.equal(heatZoomFactor(6, 4), 0.25);
    assert.equal(heatZoomFactor(30, 0), 1 / 4096);
  });
});

describe('the tooltip and the filters of a coordinate map', () => {
  it('names the value and the place', () => {
    const feature = convertToGeoJson([{ geohash: 's', value: 1234 }], {}).featureCollection.features[0];
    const details = tooltipDetails('Count', (value) => `#${value}`, feature);
    assert.deepEqual(details, [
      { label: 'Count', value: '#1234' },
      { label: 'Latitude', value: 22.5 },
      { label: 'Longitude', value: 22.5 },
    ]);
    assert.deepEqual(tooltipDetails('Count', String, null), []);
    assert.equal(
      tooltipHtml([{ label: 'A<b>', value: 1 }]),
      '<table><tbody><tr><td class="visTooltip__label">A&lt;b&gt;</td><td class="visTooltip__value">1</td></tr></tbody></table>'
    );
  });

  it('turns a rectangle into a geo_bounding_box filter and a polygon into a geo_polygon', () => {
    const bounds = { top_left: { lat: 51.5, lon: -167 }, bottom_right: { lat: 45.7, lon: -153.8 } };
    const box = spatialFilter('geo_bounding_box', 'geo.coordinates', 'logs-id', bounds);
    assert.deepEqual(box.geo_bounding_box, { ignore_unmapped: true, 'geo.coordinates': bounds });
    assert.equal(box.meta.index, 'logs-id');
    assert.deepEqual(describeFilter(box as unknown as Filter), {
      key: 'geo.coordinates',
      value: '{ "lat": 51.5, "lon": -167 } to { "lat": 45.7, "lon": -153.8 }',
    });
    const points = [
      { lat: 1, lon: 2 },
      { lat: 3, lon: 4 },
      { lat: 5, lon: 6 },
    ];
    const polygon = spatialFilter('geo_polygon', 'geo.coordinates', 'logs-id', { points });
    assert.deepEqual(polygon.geo_polygon, { ignore_unmapped: true, 'geo.coordinates': { points } });
    assert.equal(describeFilter(polygon as unknown as Filter).value, '{ "lat": 1, "lon": 2 }, { "lat": 3, "lon": 4 }, { "lat": 5, "lon": 6 }');
  });
});

describe('a new coordinate map', () => {
  it('has the settings of tile_map_type.js', () => {
    const vis = newVis('tile_map', { indexPatternId: 'logs-id' });
    assert.deepEqual(vis.params, tileMapDefaults());
    assert.equal(vis.params.mapType, 'Scaled Circle Markers');
    assert.equal(vis.params.legendPosition, 'bottomright');
    assert.deepEqual((vis.params.wms as { options: { format: string } }).options.format, 'image/png');
    assert.deepEqual(GEOHASH_DEFAULTS, { autoPrecision: true, precision: 2, useGeocentroid: true, isFilteredByCollar: true, boundingBox: null });
    assert.deepEqual(
      MAP_TYPE_OPTIONS.map((option) => option.value),
      ['Scaled Circle Markers', 'Shaded Circle Markers', 'Shaded Geohash Grid', 'Heatmap']
    );
  });
});

describe('the base map of a new coordinate map', () => {
  it('starts as the setting visualization:tileMap:WMSdefaults says, as tile_map_type.js reads it', () => {
    const wms = { enabled: true, url: 'https://maps.example/wms', options: { layers: 'roads', format: 'image/png' } };
    assert.deepEqual(tileMapDefaults(wms).wms, wms);
    assert.notEqual(tileMapDefaults(wms).wms, wms, 'a copy, as the original clones the defaults');
    assert.deepEqual(tileMapDefaults().wms, DEFAULT_WMS);
  });
});

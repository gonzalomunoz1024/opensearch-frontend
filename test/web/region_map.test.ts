/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Table, TableColumn } from '../../web/lib/aggs';
import { TRUNCATED_COLOR_SCHEMAS, truncatedColorRamp } from '../../web/vis/region_map/color_maps';
import {
  DEFAULT_MAP_CHOICE,
  joinFieldsOf,
  mapToLayerWithId,
  regionMapDefaults,
} from '../../web/vis/region_map/region_map_type';
import { topojsonFeature, type Topology } from '../../web/vis/region_map/topojson';
import { mapTooltipProvider, tooltipFormatter, tooltipHtml } from '../../web/vis/region_map/tooltip_formatter';
import {
  compareLexicographically,
  doInnerJoin,
  getChoroplethColor,
  getLegendColors,
  getMinMax,
  makeColorDarker,
  mismatchWarning,
  quantizeExtent,
  regionMetrics,
  type Feature,
} from '../../web/vis/region_map/util';

const feature = (properties: Record<string, unknown>): Feature => ({ type: 'Feature', properties, geometry: null });

describe('TopoJSON decoding', () => {
  // Two squares sharing an edge, quantized and delta-encoded as topojson writes them
  const topology: Topology = {
    type: 'Topology',
    transform: { scale: [0.5, 0.25], translate: [10, 20] },
    arcs: [
      [
        [2, 0],
        [0, 4],
      ], // the shared edge: (11,20) to (11,21)
      [
        [2, 4],
        [-2, 0],
        [0, -4],
        [2, 0],
      ], // left square's other sides: (11,21) (10,21) (10,20) (11,20)
      [
        [2, 0],
        [2, 0],
        [0, 4],
        [-2, 0],
      ], // right square's other sides: (11,20) (12,20) (12,21) (11,21)
    ],
    objects: {
      states: {
        type: 'GeometryCollection',
        geometries: [
          { type: 'Polygon', id: 'L', properties: { postal: 'LL' }, arcs: [[0, 1]] },
          { type: 'Polygon', properties: { postal: 'RR' }, arcs: [[2, ~0]] },
          { type: 'Point', properties: { postal: 'PT' }, coordinates: [4, 8] },
          { type: null, properties: { postal: 'NULL' } },
        ],
      },
    },
  };

  it('makes a FeatureCollection of a GeometryCollection, decoding the transform', () => {
    const collection = topojsonFeature(topology, 'states');
    assert.equal(collection.type, 'FeatureCollection');
    const features = (collection as { features: Feature[] }).features;
    assert.equal(features.length, 4);
    assert.deepEqual(features[0], {
      type: 'Feature',
      id: 'L',
      properties: { postal: 'LL' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [11, 20],
            [11, 21],
            [10, 21],
            [10, 20],
            [11, 20],
          ],
        ],
      },
    });
  });

  it('reverses an arc named by its complement and leaves out a missing id', () => {
    const features = (topojsonFeature(topology, topology.objects.states) as { features: Feature[] }).features;
    assert.deepEqual(Object.keys(features[1]), ['type', 'properties', 'geometry']);
    assert.deepEqual(features[1].geometry, {
      type: 'Polygon',
      coordinates: [
        [
          [11, 20],
          [12, 20],
          [12, 21],
          [11, 21],
          [11, 20],
        ],
      ],
    });
  });

  it('places points without delta decoding, and gives a null geometry for a null type', () => {
    const features = (topojsonFeature(topology, 'states') as { features: Feature[] }).features;
    assert.deepEqual(features[2].geometry, { type: 'Point', coordinates: [12, 22] });
    assert.equal(features[3].geometry, null);
  });

  it('reads a topology without a transform as it is, and fails on a missing object', () => {
    const plain: Topology = {
      type: 'Topology',
      arcs: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
        ],
      ],
      objects: { line: { type: 'LineString', arcs: [0] } },
    };
    assert.deepEqual((topojsonFeature(plain, 'line') as Feature).geometry, {
      type: 'LineString',
      coordinates: [
        [0, 0],
        [1, 0],
        [1, 1],
      ],
    });
    assert.throws(() => topojsonFeature(plain, 'nope'), TypeError);
  });
});

describe('the join of terms to shapes', () => {
  it('marks each shape with the term of its join field, compared as text', () => {
    const metrics = [
      { term: 'CN', value: 10 },
      { term: 'US', value: 30 },
      { term: 'ZZ', value: 5 },
    ];
    const shapes = [feature({ iso2: 'BR' }), feature({ iso2: 'CN' }), feature({ iso2: 'FR' }), feature({ iso2: 'US' })];
    doInnerJoin(metrics, shapes, 'iso2');
    assert.deepEqual(
      shapes.map((shape) => shape.__osdJoinedMetric?.term ?? null),
      [null, 'CN', null, 'US']
    );
  });

  it('joins numbers to text and sorts as the original', () => {
    const shapes = [feature({ code: '1' }), feature({ code: '2' })];
    doInnerJoin([{ term: 2, value: 1 }], shapes, 'code');
    assert.equal(shapes[1].__osdJoinedMetric?.value, 1);
    assert.equal(compareLexicographically(10, '9'), -1);
  });

  it('joins nothing without terms', () => {
    const shapes = [feature({ iso2: 'US' })];
    doInnerJoin([], shapes, 'iso2');
    assert.equal(shapes[0].__osdJoinedMetric, null);
  });
});

describe('the colours of a region map', () => {
  it('has the six schemas of OpenSearch Dashboards, 384 colours each', () => {
    assert.deepEqual(
      TRUNCATED_COLOR_SCHEMAS.map((schema) => schema.value),
      ['Blues', 'Greens', 'Greys', 'Reds', 'Yellow to Red', 'Green to Red']
    );
    for (const { value } of TRUNCATED_COLOR_SCHEMAS) assert.equal(truncatedColorRamp(value)?.length, 384);
    assert.equal(truncatedColorRamp('Purples'), undefined);
  });

  it('gives the legend the first, the last and two colours between', () => {
    const ramp = truncatedColorRamp('Yellow to Red') ?? [];
    assert.deepEqual(getLegendColors(ramp), ['rgb(255,126,12)', 'rgb(255,110,21)', 'rgb(255,93,30)', 'rgb(255,59,48)']);
  });

  it('colours a value by its place between the smallest and the largest', () => {
    const ramp = ['a', 'b', 'c', 'd'];
    assert.equal(getChoroplethColor(0, 0, 100, ramp), 'a');
    assert.equal(getChoroplethColor(20, 0, 100, ramp), 'a');
    assert.equal(getChoroplethColor(40, 0, 100, ramp), 'b');
    assert.equal(getChoroplethColor(50, 0, 100, ramp), 'b');
    assert.equal(getChoroplethColor(100, 0, 100, ramp), 'd');
    assert.equal(getChoroplethColor(7, 7, 7, ramp), 'd');
  });

  it('splits the legend into four ranges as d3 quantize does', () => {
    const { min, max } = getMinMax([
      { term: 'a', value: 373 },
      { term: 'b', value: 6 },
      { term: 'c', value: 50 },
    ]);
    assert.deepEqual([min, max], [6, 373]);
    assert.deepEqual(
      [0, 1, 2, 3].map((i) => quantizeExtent([min, max], 4, i)),
      [
        [6, 97.75],
        [97.75, 189.5],
        [189.5, 281.25],
        [281.25, 373],
      ]
    );
    assert.deepEqual(quantizeExtent([0, 1], 4, 0), [0, 0.25]);
    assert.ok(Number.isNaN(quantizeExtent([0, 1], 4, -1)[0]));
  });

  it('outlines a swatch with a darker colour, as d3.hcl darker(1.3)', () => {
    assert.equal(makeColorDarker('rgb(255,126,12)'), '#b44100');
    assert.equal(makeColorDarker('rgb(255,59,48)'), '#b20000');
    assert.equal(makeColorDarker('rgb(154,174,44)'), '#5a7100');
  });
});

describe('the terms of an answer, tooltips and warnings', () => {
  const column = (id: string, kind: 'bucket' | 'metric', schema: string, name: string) =>
    ({ id, kind, schema, name, agg: { id, type: 'x' }, format: (value: unknown) => `#${String(value)}` }) as unknown as TableColumn;
  const term = column('col-0-2', 'bucket', 'segment', 'geo.dest: Descending');
  const count = column('col-1-1', 'metric', 'metric', 'Count');

  it('reads a term and a value from each row', () => {
    const table: Table = { columns: [term, count], rows: [{ 'col-0-2': 'US', 'col-1-1': 143 }] };
    const { results, termColumn, valueColumn } = regionMetrics(table);
    assert.deepEqual(results, [{ term: 'US', value: 143 }]);
    assert.equal(termColumn, term);
    assert.equal(valueColumn, count);
  });

  it('reads nothing from an answer without a term column', () => {
    assert.deepEqual(regionMetrics({ columns: [count], rows: [{ 'col-1-1': 5 }] }).results, []);
  });

  it('shows the term and the formatted value', () => {
    const details = tooltipFormatter({ term: 'US', value: 143 }, (value) => `${String(value)} hits`, 'geo.dest: Descending', 'Count');
    assert.deepEqual(details, [
      { label: 'geo.dest: Descending', value: 'US' },
      { label: 'Count', value: '143 hits' },
    ]);
    assert.equal(tooltipFormatter(undefined, undefined), '');
    assert.deepEqual(tooltipFormatter({ term: 'US', value: 1 }, undefined, undefined, 'Count'), [{ label: 'Count', value: 1 }]);
  });

  it('writes the table of the map tooltip, escaped', () => {
    assert.equal(
      tooltipHtml([{ label: 'a<b', value: 'x&y' }]),
      '<table><tbody><tr><td class="visTooltip__label">a&lt;b</td><td class="visTooltip__value">x&amp;y</td></tr></tbody></table>'
    );
    assert.equal(mapTooltipProvider(tooltipFormatter)(undefined, undefined), '');
  });

  it('warns of terms no shape has, in one sentence', () => {
    assert.deepEqual(mismatchWarning(['AF']), {
      title: 'Unable to show 1 result on map',
      text: "Ensure that each of these term matches a shape on that shape's join field: AF",
    });
    assert.equal(mismatchWarning(['AF', 'AO']).title, 'Unable to show 2 results on map');
  });
});

describe('the options of a region map', () => {
  it('start as region_map_type defines them', () => {
    const wms = { enabled: false, url: '' };
    assert.deepEqual(regionMapDefaults(wms), {
      layerChosenByUser: DEFAULT_MAP_CHOICE,
      legendPosition: 'bottomright',
      addTooltip: true,
      colorSchema: 'Yellow to Red',
      emsHotLink: '',
      isDisplayWarning: true,
      wms,
      mapZoom: 2,
      mapCenter: [0, 0],
      outlineWeight: 1,
      showAllShapes: true,
    });
  });

  it('name a layer by where it comes from', () => {
    const layer = { name: 'World Countries', origin: 'elastic_maps_service', attribution: '', fields: [], format: 'geojson' };
    assert.deepEqual(mapToLayerWithId('elastic_maps_service', layer), {
      ...layer,
      layerId: 'elastic_maps_service.World Countries',
      isEMS: true,
    });
    assert.equal(mapToLayerWithId('self_hosted', layer).isEMS, false);
  });

  it('join a custom vector map on every property but its location', () => {
    assert.deepEqual(
      joinFieldsOf(['name', 'location', 'code']).map((field) => field.name),
      ['name', 'code']
    );
    assert.deepEqual(joinFieldsOf(['name']), [
      { type: 'id', name: 'name', description: 'name' },
      { type: 'id', name: 'location', description: 'location' },
    ]);
  });
});

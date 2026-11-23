/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_MAP_CONFIG, type MapConfig } from '../../common/map_config';
import { Emitter } from '../../web/maps/emitter';
import {
  decodeGeoHash,
  geoContains,
  geohashColumns,
  getPrecision,
  getZoomPrecision,
  zoomToPrecision,
} from '../../web/maps/geohash';
import {
  DEFAULT_SERVICE,
  ServiceSettings,
  anchorHtml,
  renderAttributionMarkdown,
  toAbsoluteUrl,
  withServiceParams,
} from '../../web/maps/service_settings';

const HOST = 'http://maps.test';

const MANIFEST = {
  enabled: true,
  services: [
    { id: 'tiles_v2', manifest: `${HOST}/tiles/manifest`, type: 'tms' },
    { id: 'geo_layers', manifest: `${HOST}/files/manifest`, type: 'file' },
  ],
};
const TILES = {
  services: ['road_map', 'road_map_desaturated', 'dark_map'].map((id) => ({
    id,
    name: { en: id },
    attribution: [
      { label: { en: 'Map data © OpenStreetMap contributors' }, url: { en: 'https://www.openstreetmap.org/copyright' } },
      { label: { en: 'OpenSearch' }, url: { en: 'https://opensearch.org/' } },
    ],
    formats: [{ locale: 'en', format: 'raster', url: `${HOST}/tiles/${id}/raster.json` }],
  })),
};
const FILES = {
  layers: [
    {
      layer_id: 'world_countries',
      created_at: '2017-04-26T17:12:15.978370',
      attribution: [{ label: { en: 'Made with NaturalEarth' }, url: { en: 'http://www.naturalearthdata.com/about/terms-of-use' } }],
      formats: [{ type: 'geojson', url: '/files/world_countries.geo.json', legacy_default: true }],
      fields: [
        { type: 'id', id: 'iso2', label: { en: 'ISO 3166-1 alpha-2 Code' } },
        { type: 'property', id: 'name', label: { en: 'Name' } },
      ],
      legacy_ids: ['World Countries'],
      layer_name: { en: 'World Countries' },
    },
  ],
};

function fakeService(answers: Record<string, unknown>, options: { down?: boolean } = {}) {
  const asked: string[] = [];
  const fetchFunction = async (url: string): Promise<Response> => {
    asked.push(url);
    if (options.down) throw new TypeError('Failed to fetch');
    const path = url.slice(HOST.length).split('?')[0];
    const tile = path.match(/^\/tiles\/(\w+)\/raster\.json$/);
    const body = tile ? { tiles: [`${HOST}/tiles/${tile[1]}/{z}/{x}/{y}.png`], minzoom: 0, maxzoom: 14 } : answers[path];
    if (body === undefined) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(body), { status: 200 });
  };
  return { asked, fetchFunction };
}

const config = (overrides: Partial<MapConfig> = {}): MapConfig => ({
  ...DEFAULT_MAP_CONFIG,
  opensearchManifestServiceUrl: `${HOST}/manifest`,
  emsFileApiUrl: HOST,
  emsTileApiUrl: HOST,
  ...overrides,
});

const settingsWith = (map: MapConfig, fetchFunction: (url: string) => Promise<Response>) =>
  new ServiceSettings(map, map.tilemap, '3.9.0', fetchFunction);

describe('the maps service', () => {
  const answers = { '/manifest': MANIFEST, '/tiles/manifest': TILES, '/files/manifest': FILES };

  it('is asked first whether it is enabled, then for its catalogue, with the OpenSearch query', async () => {
    const { asked, fetchFunction } = fakeService(answers);
    const services = await settingsWith(config(), fetchFunction).getTMSServices();
    assert.deepEqual(asked, [
      `${HOST}/manifest`,
      `${HOST}/manifest?opensearch_tos_agree=true`,
      `${HOST}/tiles/manifest?opensearch_tos_agree=true`,
      `${HOST}/tiles/road_map/raster.json?opensearch_tos_agree=true`,
    ]);
    assert.deepEqual(services, [
      {
        origin: 'elastic_maps_service',
        id: 'road_map',
        minZoom: 0,
        maxZoom: 14,
        attribution:
          '<a rel="noreferrer noopener" href="https://www.openstreetmap.org/copyright">Map data © OpenStreetMap contributors</a> | <a rel="noreferrer noopener" href="https://opensearch.org/">OpenSearch</a>',
      },
    ]);
  });

  it('gives the desaturated or dark base map to draw, with the query in its tile address', async () => {
    const { fetchFunction } = fakeService(answers);
    const settings = settingsWith(config(), fetchFunction);
    const road = { origin: 'elastic_maps_service', id: 'road_map' };
    const desaturated = await settings.getAttributesForTMSLayer(road, true, false);
    assert.ok(!Array.isArray(desaturated));
    assert.equal(
      (desaturated as { url?: string }).url,
      `${HOST}/tiles/road_map_desaturated/{z}/{x}/{y}.png?opensearch_tos_agree=true`
    );
    const dark = (await settings.getAttributesForTMSLayer(road, true, true)) as { url?: string };
    assert.match(String(dark.url), /\/dark_map\//);
    const bright = (await settings.getAttributesForTMSLayer(road, false, false)) as { url?: string };
    assert.match(String(bright.url), /\/road_map\//);
  });

  it('falls back to the default service when it cannot be reached, as the original does', async () => {
    const { fetchFunction } = fakeService(answers, { down: true });
    const settings = settingsWith(config(), fetchFunction);
    assert.deepEqual(await settings.getTMSServices(), DEFAULT_SERVICE);
    assert.deepEqual(await settings.getAttributesForTMSLayer({ origin: 'elastic_maps_service' }, true, false), DEFAULT_SERVICE);
    assert.deepEqual(await settings.getFileLayers(), []);
  });

  it('lists its layers of shapes with their fields, and where to fetch each', async () => {
    const { fetchFunction } = fakeService(answers);
    const settings = settingsWith(config(), fetchFunction);
    const [layer] = await settings.getFileLayers();
    assert.equal(layer.name, 'World Countries');
    assert.equal(layer.id, 'world_countries');
    assert.equal(layer.origin, 'elastic_maps_service');
    assert.equal(layer.format, 'geojson');
    assert.deepEqual(layer.fields, [
      { type: 'id', name: 'iso2', description: 'ISO 3166-1 alpha-2 Code' },
      { type: 'property', name: 'name', description: 'Name' },
    ]);
    assert.equal(
      await settings.getUrlForRegionLayer(layer),
      `${HOST}/files/world_countries.geo.json?opensearch_tos_agree=true`
    );
    // A layer saved under its old name is still found
    assert.equal((await settings.loadFileLayerConfig({ name: 'World Countries' }))?.id, 'world_countries');
    assert.equal(await settings.getEMSHotLink({ id: 'world_countries' }), '?locale=en#file/world_countries');
  });

  it('gives a layer of opensearch_dashboards.yml its own address', async () => {
    const { fetchFunction } = fakeService(answers);
    const settings = settingsWith(config(), fetchFunction);
    const url = await settings.getUrlForRegionLayer({
      name: 'Mine',
      origin: 'self_hosted',
      url: 'https://shapes.test/mine.json',
      attribution: '',
      fields: [],
      format: { type: 'geojson' },
    });
    assert.equal(url, 'https://shapes.test/mine.json');
  });

  it('puts the tile service of map.tilemap first', async () => {
    const { fetchFunction } = fakeService(answers);
    const map = config({
      tilemap: { url: 'https://tiles.test/{z}/{x}/{y}.png', options: { attribution: '[Tiles](https://tiles.test)', minZoom: 0, maxZoom: 18 } },
    });
    const services = await settingsWith(map, fetchFunction).getTMSServices();
    assert.equal(services.length, 2);
    assert.equal(services[0].id, 'TMS in config/opensearch_dashboards.yml');
    assert.equal(services[0].origin, 'self_hosted');
    assert.equal(services[0].url, 'https://tiles.test/{z}/{x}/{y}.png');
    assert.equal(services[0].maxZoom, 18);
    // Rendered by markdown, then escaped: what the original shows
    assert.equal(services[0].attribution, '&lt;p&gt;&lt;a href=&quot;https://tiles.test&quot;&gt;Tiles&lt;/a&gt;&lt;/p&gt;\n');
    const attributes = await settingsWith(map, fetchFunction).getAttributesForTMSLayer(services[0], true, false);
    assert.deepEqual(attributes, { origin: 'self_hosted', url: 'https://tiles.test/{z}/{x}/{y}.png' });
  });

  it('asks nothing of the maps service when it is turned off', async () => {
    const { asked, fetchFunction } = fakeService(answers);
    const settings = settingsWith(config({ includeOpenSearchMapsService: false }), fetchFunction);
    assert.deepEqual(await settings.getTMSServices(), []);
    assert.deepEqual(await settings.getFileLayers(), []);
    assert.deepEqual(asked, []);
  });

  it('switches to the Elastic Maps Service and its query when the manifest says it is not enabled', async () => {
    const { asked, fetchFunction } = fakeService({
      '/manifest': { enabled: false },
      '/v7.10/manifest': TILES,
    });
    const map = config({ emsFileApiUrl: '', emsTileApiUrl: HOST });
    await settingsWith(map, fetchFunction).getTMSServices();
    assert.equal(asked[0], `${HOST}/manifest`);
    assert.equal(
      asked[1],
      `${HOST}/v7.10/manifest?elastic_tile_service_tos=agree&my_app_name=opensearch-dashboards&my_app_version=3.9.0`
    );
  });
});

describe('addresses of the maps service', () => {
  it('keep the template of a tile address readable', () => {
    assert.equal(
      withServiceParams('https://t.test/{z}/{x}/{y}.png', [['opensearch_tos_agree', 'true']]),
      'https://t.test/{z}/{x}/{y}.png?opensearch_tos_agree=true'
    );
    assert.equal(withServiceParams('https://t.test/a?b=1#c', [['d', '2']]), 'https://t.test/a?b=1&d=2#c');
  });

  it('join a host and a path with one slash', () => {
    assert.equal(toAbsoluteUrl('https://h.test/', '/a'), 'https://h.test/a');
    assert.equal(toAbsoluteUrl('https://h.test', 'a'), 'https://h.test/a');
    assert.equal(toAbsoluteUrl('https://h.test/', 'a'), 'https://h.test/a');
    assert.equal(toAbsoluteUrl('', '/a'), '/a');
  });

  it('give an attribution as a link, or as text when its address is not on the web', () => {
    assert.equal(anchorHtml('A & B', 'https://x.test/?a=1&b="2"'), '<a rel="noreferrer noopener" href="https://x.test/?a=1&amp;b=&quot;2&quot;">A &amp; B</a>');
    assert.equal(anchorHtml('Local', 'file:///x'), '<a rel="noreferrer noopener">Local</a>');
    assert.equal(renderAttributionMarkdown(''), '');
    assert.equal(renderAttributionMarkdown('See https://x.test'), '<p>See <a href="https://x.test">https://x.test</a></p>\n');
  });
});

describe('geohash cells', () => {
  it('decode to their rectangle and centre', () => {
    const cell = decodeGeoHash('9q');
    assert.deepEqual(cell.latitude, [33.75, 39.375, 36.5625]);
    assert.deepEqual(cell.longitude, [-123.75, -112.5, -118.125]);
  });

  it('have 8, 32, 256 columns at precisions 1, 2, 3', () => {
    assert.deepEqual([1, 2, 3].map(geohashColumns), [8, 32, 256]);
  });

  it('get finer as the map zooms in, never past the maximum', () => {
    assert.deepEqual(
      [0, 1, 2, 3, 4, 5, 6, 10].map((zoom) => zoomToPrecision(zoom, 12, 21)),
      [1, 2, 2, 2, 3, 3, 4, 5]
    );
    assert.equal(zoomToPrecision(20, 5, 21), 5);
    assert.equal(getZoomPrecision(3)[10], 3);
    assert.equal(getPrecision('7', 5), 5);
    assert.equal(getPrecision('x', 12), 2);
  });

  it('tell whether a collar holds the bounds of the map', () => {
    const collar = { top_left: { lat: 10, lon: -10 }, bottom_right: { lat: -10, lon: 10 } };
    assert.equal(geoContains(collar, { top_left: { lat: 5, lon: -5 }, bottom_right: { lat: -5, lon: 5 } }), true);
    assert.equal(geoContains(collar, { top_left: { lat: 11, lon: -5 }, bottom_right: { lat: -5, lon: 5 } }), false);
    assert.equal(geoContains(undefined, collar), false);
  });
});

describe('the emitter of map events', () => {
  it('calls listeners in order, once for once, and not after they are removed', () => {
    const emitter = new Emitter();
    const calls: string[] = [];
    const a = (value: string) => calls.push(`a${value}`);
    emitter.on('x', a);
    emitter.once('x', (value: string) => calls.push(`b${value}`));
    emitter.emit('x', 1);
    emitter.emit('x', 2);
    emitter.removeListener('x', a);
    assert.equal(emitter.emit('x', 3), false);
    assert.deepEqual(calls, ['a1', 'b1', 'a2']);
  });
});

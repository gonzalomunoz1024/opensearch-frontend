/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { DEFAULT_MAP_CONFIG } from '../../common/map_config';
import { loadConfig } from '../../server/config';
import { contentSecurityPolicy, mapOrigins } from '../../server/static';

const fromYaml = (text: string) => {
  const file = join(mkdtempSync(join(tmpdir(), 'map-config-')), 'settings.yml');
  writeFileSync(file, text);
  return loadConfig({ file, env: {} });
};

describe('the map.* settings', () => {
  it('default to those of OpenSearch Dashboards 3.9.0', () => {
    const { config } = loadConfig({ env: {} });
    assert.deepEqual(config.map, DEFAULT_MAP_CONFIG);
  });

  it('are read from the settings file, with region layers and the tile service', () => {
    const { config, ignored } = fromYaml(`
map.opensearchManifestServiceUrl: http://maps.local/manifest
map.includeOpenSearchMapsService: false
map.tilemap.url: https://tiles.local/{z}/{x}/{y}.png
map.tilemap.options.attribution: "[Tiles](https://tiles.local)"
map.tilemap.options.maxZoom: 18
map.tilemap.options.subdomains: [a, b]
map.emsTileLayerId.dark: night
map.regionmap:
  includeOpenSearchMapsService: false
  layers:
    - name: Departments
      url: https://shapes.local/departments.json
      attribution: INRAP
      fields:
        - name: department
          description: Full department name
`);
    assert.deepEqual(ignored, []);
    assert.equal(config.map.opensearchManifestServiceUrl, 'http://maps.local/manifest');
    assert.equal(config.map.includeOpenSearchMapsService, false);
    assert.equal(config.map.tilemap.url, 'https://tiles.local/{z}/{x}/{y}.png');
    assert.deepEqual(config.map.tilemap.options, { attribution: '[Tiles](https://tiles.local)', minZoom: 0, maxZoom: 18, subdomains: ['a', 'b'] });
    assert.deepEqual(config.map.emsTileLayerId, { bright: 'road_map', desaturated: 'road_map_desaturated', dark: 'night' });
    assert.equal(config.map.regionmap.includeOpenSearchMapsService, false);
    assert.deepEqual(config.map.regionmap.layers, [
      {
        url: 'https://shapes.local/departments.json',
        format: { type: 'geojson' },
        meta: { feature_collection_path: 'data' },
        attribution: 'INRAP',
        name: 'Departments',
        fields: [{ name: 'department', description: 'Full department name' }],
      },
    ]);
  });

  it('are read from the environment', () => {
    const { config } = loadConfig({ env: { MAP_OPENSEARCHMANIFESTSERVICEURL: 'http://m.local/manifest', MAP_SHOWREGIONDENIEDWARNING: 'true' } });
    assert.equal(config.map.opensearchManifestServiceUrl, 'http://m.local/manifest');
    assert.equal(config.map.showRegionDeniedWarning, true);
  });

  it('refuse a region layer without a name', () => {
    assert.throws(() => fromYaml('map.regionmap.layers: [{ url: "https://x", attribution: "", fields: [] }]'), /name must be text/);
  });
});

describe('the page lets the browser fetch', () => {
  it('from the map services, the region layers and the sites of OpenSearch, and nowhere else', () => {
    const map = { ...DEFAULT_MAP_CONFIG, regionmap: { ...DEFAULT_MAP_CONFIG.regionmap, layers: [{ url: 'https://shapes.local/a.json', format: { type: 'geojson' }, meta: { feature_collection_path: 'data' }, attribution: '', name: 'A', fields: [] }] } };
    assert.deepEqual(mapOrigins(map), [
      'https://maps.opensearch.org',
      'https://vectors.maps.opensearch.org',
      'https://tiles.maps.opensearch.org',
      'https://shapes.local',
    ]);
    assert.match(contentSecurityPolicy(map), /connect-src 'self' https:\/\/opensearch\.org https:\/\/docs\.opensearch\.org https:\/\/maps\.opensearch\.org https:\/\/vectors\.maps\.opensearch\.org https:\/\/tiles\.maps\.opensearch\.org https:\/\/shapes\.local;/);
    assert.match(contentSecurityPolicy(), /connect-src 'self' https:\/\/opensearch\.org https:\/\/docs\.opensearch\.org https:\/\/maps\.opensearch\.org https:\/\/vectors\.maps\.opensearch\.org https:\/\/tiles\.maps\.opensearch\.org;/);
  });
});

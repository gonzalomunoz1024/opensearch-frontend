/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_MAP_CONFIG, type MapConfig } from '../../common/map_config';
import { DEFAULT_SERVICE, ServiceSettings } from '../../web/maps/service_settings';

const HOST = 'http://maps.test';

describe('a maps service that cannot be reached, asked as maps_legacy asks it', () => {
  it('is asked for its catalogue once on a page, however many maps then ask for it', async () => {
    const asked: string[] = [];
    const unreachable = async (url: string): Promise<Response> => {
      asked.push(url);
      throw new TypeError('Failed to fetch');
    };
    const map: MapConfig = {
      ...DEFAULT_MAP_CONFIG,
      opensearchManifestServiceUrl: `${HOST}/manifest`,
      emsFileApiUrl: HOST,
      emsTileApiUrl: HOST,
    };
    const settings = new ServiceSettings(map, map.tilemap, '3.9.0', unreachable);
    const road = DEFAULT_SERVICE[0];
    // A Vega map: the base maps, then the one to draw
    assert.deepEqual(await settings.getTMSServices(), DEFAULT_SERVICE);
    assert.deepEqual(await settings.getAttributesForTMSLayer(road, true, false), DEFAULT_SERVICE);
    // A coordinate map, then a region map with its layers of shapes
    assert.deepEqual(await settings.getTMSServices(), DEFAULT_SERVICE);
    assert.deepEqual(await settings.getAttributesForTMSLayer(road, true, false), DEFAULT_SERVICE);
    assert.deepEqual(await settings.getFileLayers(), []);
    assert.equal(await settings.getFileLayerFromConfig({ name: 'World Countries' }), null);
    assert.equal(await settings.getEMSHotLink({ name: 'World Countries' }), null);
    // Whether it is enabled, then its catalogue, whose failure every later map is given
    assert.deepEqual(asked, [`${HOST}/manifest`, `${HOST}/manifest?opensearch_tos_agree=true`]);
  });
});

describe('the attribution of map.tilemap, as maps_legacy renders it', () => {
  /** The attribution of the base map of opensearch_dashboards.yml, for this text in the settings */
  async function attributionOf(text: string): Promise<unknown> {
    const map: MapConfig = {
      ...DEFAULT_MAP_CONFIG,
      includeOpenSearchMapsService: false,
      tilemap: { url: 'https://tiles.test/{z}/{x}/{y}.png', options: { ...DEFAULT_MAP_CONFIG.tilemap.options, attribution: text } },
    };
    const nothingAsked = async (url: string): Promise<Response> => {
      throw new Error(`asked ${url}`);
    };
    const [service] = await new ServiceSettings(map, map.tilemap, '3.9.0', nothingAsked).getTMSServices();
    return service.attribution;
  }

  it('reads the text as markdown-it does, with HTML off and links found in it, then escapes the HTML', async () => {
    // Entities, titles of links, emphasis and headings are read
    assert.equal(await attributionOf('&copy; OpenStreetMap contributors'), '&lt;p&gt;© OpenStreetMap contributors&lt;/p&gt;\n');
    assert.equal(
      await attributionOf('[OpenStreetMap](https://www.openstreetmap.org/copyright "Licence")'),
      '&lt;p&gt;&lt;a href=&quot;https://www.openstreetmap.org/copyright&quot; title=&quot;Licence&quot;&gt;OpenStreetMap&lt;/a&gt;&lt;/p&gt;\n'
    );
    assert.equal(
      await attributionOf('*Map data* © **OpenStreetMap**'),
      '&lt;p&gt;&lt;em&gt;Map data&lt;/em&gt; © &lt;strong&gt;OpenStreetMap&lt;/strong&gt;&lt;/p&gt;\n'
    );
    assert.equal(await attributionOf('# Tiles'), '&lt;h1&gt;Tiles&lt;/h1&gt;\n');
    // The text as it is: an indent of four spaces makes a code block, a blank line two paragraphs
    assert.equal(await attributionOf('    tiles.test'), '&lt;pre&gt;&lt;code&gt;tiles.test\n&lt;/code&gt;&lt;/pre&gt;\n');
    assert.equal(await attributionOf('Map data\n\nOpenStreetMap'), '&lt;p&gt;Map data&lt;/p&gt;\n&lt;p&gt;OpenStreetMap&lt;/p&gt;\n');
    // HTML in the text stays text, and an address becomes a link
    assert.equal(await attributionOf('<b>Maps</b>'), '&lt;p&gt;&amp;lt;b&amp;gt;Maps&amp;lt;/b&amp;gt;&lt;/p&gt;\n');
    assert.equal(
      await attributionOf('See https://tiles.test'),
      '&lt;p&gt;See &lt;a href=&quot;https://tiles.test&quot;&gt;https://tiles.test&lt;/a&gt;&lt;/p&gt;\n'
    );
    assert.equal(await attributionOf(''), '');
  });
});

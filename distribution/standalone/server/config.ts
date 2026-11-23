/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The settings of the server. They carry the names OpenSearch Dashboards gives them, so that a
 * settings file or a container environment written for it keeps working: a setting comes from
 * the file named by `--config` (YAML, nested or with dotted keys), and the environment variable
 * of the same name, in capitals with the dots as underscores, overrides it
 * (`opensearch.hosts` is `OPENSEARCH_HOSTS`).
 *
 * A setting this server does not know is reported and otherwise ignored: a file written for
 * OpenSearch Dashboards has many this product has no use for.
 */

import { readFileSync } from 'node:fs';
import { flatten, parseYaml, type YamlValue } from './yaml';
import { DEFAULT_MAP_CONFIG, type MapConfig } from '../common/map_config';
import { DEFAULT_CSP, type CspSettings } from './static';

export interface Config {
  server: {
    host: string;
    port: number;
    /** What a proxy in front puts before every path, without a slash at the end; '' for none */
    basePath: string;
    maxPayloadBytes: number;
    name: string;
  };
  opensearch: {
    hosts: string[];
    username?: string;
    password?: string;
    requestTimeout: number;
    customHeaders: Record<string, string>;
    ssl: {
      verificationMode: 'full' | 'certificate' | 'none';
      certificateAuthorities: string[];
    };
  };
  /** The index the saved objects live in */
  index: string;
  savedObjects: { maxImportPayloadBytes: number; maxImportExportSize: number };
  uiSettings: { overrides: Record<string, unknown>; defaults: Record<string, unknown> };
  logging: { quiet: boolean; verbose: boolean };
  /** The `map.*` settings of the maps_legacy, tile_map and region_map plugins */
  map: MapConfig;
  /** The csp.* settings the page's policy is built from, as in OpenSearch Dashboards */
  csp: CspSettings;
  /** vis_type_vega.enableExternalUrls: whether a Vega spec may load data from other addresses */
  visTypeVega: { enableExternalUrls: boolean };
  /** home.disableWelcomeScreen: whether the first page leaves out the welcome screen */
  home: { disableWelcomeScreen: boolean };
}

type Reader = (value: unknown, key: string) => unknown;

const string: Reader = (value, key) => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  throw new Error(`${key} must be text`);
};
const number: Reader = (value, key) => {
  const parsed = typeof value === 'string' ? Number(value) : value;
  if (typeof parsed === 'number' && Number.isFinite(parsed)) return parsed;
  throw new Error(`${key} must be a number`);
};
const boolean: Reader = (value, key) => {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${key} must be true or false`);
};
const list: Reader = (value, key) => {
  if (Array.isArray(value)) return value.map((item) => string(item, key));
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  throw new Error(`${key} must be a list`);
};
const map: Reader = (value, key) => {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) return value;
  throw new Error(`${key} must be a map`);
};
const numbers: Reader = (value, key) => {
  if (!Array.isArray(value)) throw new Error(`${key} must be a list`);
  return value.map((item) => number(item, key));
};
// map.regionmap.layers: a list of layers, each { name, url, attribution, format, meta, fields }
const regionLayers: Reader = (value, key) => {
  if (!Array.isArray(value)) throw new Error(`${key} must be a list`);
  return value.map((item, index) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) throw new Error(`${key}[${index}] must be a map`);
    const layer = item as Record<string, unknown>;
    const inner = (name: string) => (layer[name] && typeof layer[name] === 'object' ? (layer[name] as Record<string, unknown>) : {});
    for (const required of ['url', 'attribution', 'name']) {
      if (typeof layer[required] !== 'string') throw new Error(`${key}[${index}].${required} must be text`);
    }
    if (!Array.isArray(layer.fields)) throw new Error(`${key}[${index}].fields must be a list`);
    return {
      url: layer.url,
      format: { type: typeof inner('format').type === 'string' ? inner('format').type : 'geojson' },
      meta: {
        feature_collection_path:
          typeof inner('meta').feature_collection_path === 'string' ? inner('meta').feature_collection_path : 'data',
      },
      attribution: layer.attribution,
      name: layer.name,
      fields: (layer.fields as unknown[]).map((field, fieldIndex) => {
        const f = (field ?? {}) as Record<string, unknown>;
        if (typeof f.name !== 'string' || typeof f.description !== 'string') {
          throw new Error(`${key}[${index}].fields[${fieldIndex}] must have a name and a description`);
        }
        return { name: f.name, description: f.description };
      }),
    };
  });
};
const oneOf =
  (...allowed: string[]): Reader =>
  (value, key) => {
    if (typeof value === 'string' && allowed.includes(value)) return value;
    throw new Error(`${key} must be one of ${allowed.join(', ')}`);
  };

// Every setting the server reads, with what reads its value
const SETTINGS: Record<string, Reader> = {
  'server.host': string,
  'server.port': number,
  'server.basePath': string,
  'server.maxPayloadBytes': number,
  'server.name': string,
  'opensearch.hosts': list,
  'opensearch.username': string,
  'opensearch.password': string,
  'opensearch.requestTimeout': number,
  'opensearch.customHeaders': map,
  'opensearch.ssl.verificationMode': oneOf('full', 'certificate', 'none'),
  'opensearch.ssl.certificateAuthorities': list,
  'opensearchDashboards.index': string,
  'savedObjects.maxImportPayloadBytes': number,
  'savedObjects.maxImportExportSize': number,
  'uiSettings.overrides': map,
  'uiSettings.defaults': map,
  'logging.quiet': boolean,
  'logging.verbose': boolean,
  'csp.rules': list,
  'csp.enable': boolean,
  'csp.strict': boolean,
  'csp.warnLegacyBrowsers': boolean,
  'csp.nonceDirectives': list,
  'csp.allowedConnectSources': list,
  'csp.allowedFrameAncestorSources': list,
  'csp.allowedImgSources': list,
  'csp.loosenCspDirectives': list,
  'vis_type_vega.enableExternalUrls': boolean,
  'home.disableWelcomeScreen': boolean,
  'map.includeOpenSearchMapsService': boolean,
  'map.proxyOpenSearchMapsServiceInMaps': boolean,
  'map.showRegionDeniedWarning': boolean,
  'map.tilemap.url': string,
  'map.tilemap.options.attribution': string,
  'map.tilemap.options.minZoom': number,
  'map.tilemap.options.maxZoom': number,
  'map.tilemap.options.tileSize': number,
  'map.tilemap.options.subdomains': list,
  'map.tilemap.options.errorTileUrl': string,
  'map.tilemap.options.tms': boolean,
  'map.tilemap.options.reuseTiles': boolean,
  'map.tilemap.options.bounds': numbers,
  'map.tilemap.options.default': boolean,
  'map.regionmap.includeOpenSearchMapsService': boolean,
  'map.regionmap.layers': regionLayers,
  'map.manifestServiceUrl': string,
  'map.opensearchManifestServiceUrl': string,
  'map.emsFileApiUrl': string,
  'map.emsTileApiUrl': string,
  'map.emsLandingPageUrl': string,
  'map.emsFontLibraryUrl': string,
  'map.emsTileLayerId.bright': string,
  'map.emsTileLayerId.desaturated': string,
  'map.emsTileLayerId.dark': string,
};

// Maps whose keys are themselves dotted (`uiSettings.overrides.theme:darkMode`) arrive flattened
const MAP_SETTINGS = Object.keys(SETTINGS).filter((key) => SETTINGS[key] === map);

const environmentName = (key: string) => key.replace(/\./g, '_').toUpperCase();

function fromEnvironment(raw: string): unknown {
  const text = raw.trim();
  if (/^[[{"]/.test(text) || /^(true|false|-?\d+(\.\d+)?)$/.test(text)) {
    try {
      const value: unknown = JSON.parse(text);
      // Digits that a number would be written back differently from stay text: a password of
      // "1.50" or of twenty digits is not the number 1.5 or one rounded to seventeen
      return typeof value === 'number' && String(value) !== text ? raw : value;
    } catch {
      return raw;
    }
  }
  return raw;
}

export interface LoadedConfig {
  config: Config;
  /** Settings found in the file that this server does not read */
  ignored: string[];
}

export function loadConfig(
  options: { file?: string; env?: Record<string, string | undefined> } = {}
): LoadedConfig {
  const env = options.env ?? process.env;
  const values: Record<string, unknown> = {};
  const ignored: string[] = [];

  if (options.file) {
    const flat = flatten(parseYaml(readFileSync(options.file, 'utf8')));
    for (const [key, value] of Object.entries(flat) as Array<[string, YamlValue]>) {
      const parent = MAP_SETTINGS.find((name) => key.startsWith(`${name}.`));
      if (parent) {
        const inner = (values[parent] ??= {}) as Record<string, unknown>;
        inner[key.slice(parent.length + 1)] = value;
      } else if (key in SETTINGS) {
        values[key] = value;
      } else {
        ignored.push(key);
      }
    }
  }

  for (const key of Object.keys(SETTINGS)) {
    const raw = env[environmentName(key)];
    if (raw !== undefined && raw !== '') values[key] = fromEnvironment(raw);
  }

  const read = <T>(key: string, fallback: T): T =>
    key in values ? (SETTINGS[key](values[key], key) as T) : fallback;

  const basePath = read<string>('server.basePath', '');
  if (basePath !== '' && (!basePath.startsWith('/') || basePath.endsWith('/'))) {
    throw new Error('server.basePath must start with a slash and must not end with one');
  }
  // A user name and a password written into an address are sent, as the client library of
  // OpenSearch Dashboards sends them, and are taken out of the address, which is logged and is
  // what Dev Tools shows
  let inAddress: { username: string; password: string } | undefined;
  const hosts: string[] = [];
  for (const given of read('opensearch.hosts', ['http://localhost:9200'])) {
    let host = given;
    if (/^https?:\/\/[^/?#]*@/.test(host)) {
      const url = new URL(host);
      if (url.username !== '' && url.password !== '') {
        inAddress ??= {
          username: decodeURIComponent(url.username),
          password: decodeURIComponent(url.password),
        };
      }
      url.username = '';
      url.password = '';
      host = url.href;
    }
    hosts.push(host.replace(/\/+$/, ''));
  }
  for (const host of hosts) {
    if (!/^https?:\/\//.test(host)) throw new Error(`opensearch.hosts: "${host}" is not a URL`);
  }
  if (hosts.length === 0) throw new Error('opensearch.hosts names no host');

  const config: Config = {
    server: {
      host: read('server.host', '0.0.0.0'),
      port: read('server.port', 5601),
      basePath,
      maxPayloadBytes: read('server.maxPayloadBytes', 1048576),
      name: read('server.name', 'infradashboard'),
    },
    opensearch: {
      hosts,
      username: read<string | undefined>('opensearch.username', inAddress?.username),
      password: read<string | undefined>('opensearch.password', inAddress?.password),
      requestTimeout: read('opensearch.requestTimeout', 30000),
      customHeaders: read('opensearch.customHeaders', {}) as Record<string, string>,
      ssl: {
        verificationMode: read('opensearch.ssl.verificationMode', 'full'),
        certificateAuthorities: read('opensearch.ssl.certificateAuthorities', [] as string[]),
      },
    },
    index: read('opensearchDashboards.index', '.kibana'),
    savedObjects: {
      maxImportPayloadBytes: read('savedObjects.maxImportPayloadBytes', 26214400),
      maxImportExportSize: read('savedObjects.maxImportExportSize', 10000),
    },
    uiSettings: {
      overrides: read('uiSettings.overrides', {}) as Record<string, unknown>,
      defaults: read('uiSettings.defaults', {}) as Record<string, unknown>,
    },
    logging: { quiet: read('logging.quiet', false), verbose: read('logging.verbose', false) },
    map: readMapConfig(read),
    csp: {
      rules: read('csp.rules', [...DEFAULT_CSP.rules]),
      enable: read('csp.enable', DEFAULT_CSP.enable),
      strict: read('csp.strict', DEFAULT_CSP.strict),
      warnLegacyBrowsers: read('csp.warnLegacyBrowsers', DEFAULT_CSP.warnLegacyBrowsers),
      nonceDirectives: read('csp.nonceDirectives', [...DEFAULT_CSP.nonceDirectives]),
      allowedConnectSources: read('csp.allowedConnectSources', [] as string[]),
      allowedFrameAncestorSources: read('csp.allowedFrameAncestorSources', [] as string[]),
      allowedImgSources: read('csp.allowedImgSources', [] as string[]),
      loosenCspDirectives: read('csp.loosenCspDirectives', [] as string[]),
    },
    visTypeVega: { enableExternalUrls: read('vis_type_vega.enableExternalUrls', false) },
    home: { disableWelcomeScreen: read('home.disableWelcomeScreen', false) },
  };
  return { config, ignored };
}

/** The map.* settings, with the defaults of OpenSearch Dashboards 3.9.0 */
function readMapConfig(read: <T>(key: string, fallback: T) => T): MapConfig {
  const d = DEFAULT_MAP_CONFIG;
  const options: MapConfig['tilemap']['options'] = {
    attribution: read('map.tilemap.options.attribution', d.tilemap.options.attribution),
    minZoom: read('map.tilemap.options.minZoom', d.tilemap.options.minZoom),
    maxZoom: read('map.tilemap.options.maxZoom', d.tilemap.options.maxZoom),
  };
  for (const name of ['tileSize', 'subdomains', 'errorTileUrl', 'tms', 'reuseTiles', 'bounds', 'default'] as const) {
    const value = read<unknown>(`map.tilemap.options.${name}`, undefined);
    if (value !== undefined) (options as Record<string, unknown>)[name] = value;
  }
  if (options.minZoom < 0) throw new Error('map.tilemap.options.minZoom must be 0 or more');
  if (options.bounds?.some((bound) => bound < 2)) throw new Error('map.tilemap.options.bounds must be numbers of 2 or more');
  const tilemapUrl = read<string | undefined>('map.tilemap.url', undefined);
  return {
    includeOpenSearchMapsService: read('map.includeOpenSearchMapsService', d.includeOpenSearchMapsService),
    proxyOpenSearchMapsServiceInMaps: read('map.proxyOpenSearchMapsServiceInMaps', d.proxyOpenSearchMapsServiceInMaps),
    showRegionDeniedWarning: read('map.showRegionDeniedWarning', d.showRegionDeniedWarning),
    tilemap: tilemapUrl === undefined ? { options } : { url: tilemapUrl, options },
    regionmap: {
      includeOpenSearchMapsService: read('map.regionmap.includeOpenSearchMapsService', d.regionmap.includeOpenSearchMapsService),
      layers: read('map.regionmap.layers', d.regionmap.layers),
    },
    manifestServiceUrl: read('map.manifestServiceUrl', d.manifestServiceUrl),
    opensearchManifestServiceUrl: read('map.opensearchManifestServiceUrl', d.opensearchManifestServiceUrl),
    emsFileApiUrl: read('map.emsFileApiUrl', d.emsFileApiUrl),
    emsTileApiUrl: read('map.emsTileApiUrl', d.emsTileApiUrl),
    emsLandingPageUrl: read('map.emsLandingPageUrl', d.emsLandingPageUrl),
    emsFontLibraryUrl: read('map.emsFontLibraryUrl', d.emsFontLibraryUrl),
    emsTileLayerId: {
      bright: read('map.emsTileLayerId.bright', d.emsTileLayerId.bright),
      desaturated: read('map.emsTileLayerId.desaturated', d.emsTileLayerId.desaturated),
      dark: read('map.emsTileLayerId.dark', d.emsTileLayerId.dark),
    },
  };
}

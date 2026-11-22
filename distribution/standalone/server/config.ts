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
  /** Whether the map visualizations may ask a tile service the browser can reach */
  map: { tileUrl: string; attribution: string };
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
  'map.tileUrl': string,
  'map.attribution': string,
};

// Maps whose keys are themselves dotted (`uiSettings.overrides.theme:darkMode`) arrive flattened
const MAP_SETTINGS = Object.keys(SETTINGS).filter((key) => SETTINGS[key] === map);

const environmentName = (key: string) => key.replace(/\./g, '_').toUpperCase();

function fromEnvironment(raw: string): unknown {
  const text = raw.trim();
  if (/^[[{"]/.test(text) || /^(true|false|-?\d+(\.\d+)?)$/.test(text)) {
    try {
      return JSON.parse(text);
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
  const hosts = read('opensearch.hosts', ['http://localhost:9200']).map((host) =>
    host.replace(/\/+$/, '')
  );
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
      username: read<string | undefined>('opensearch.username', undefined),
      password: read<string | undefined>('opensearch.password', undefined),
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
    map: { tileUrl: read('map.tileUrl', ''), attribution: read('map.attribution', '') },
  };
  return { config, ignored };
}

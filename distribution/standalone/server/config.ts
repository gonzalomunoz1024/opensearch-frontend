/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The settings of the server. They carry the names OpenSearch Dashboards gives them, so that a
 * settings file or a container environment written for it keeps working: a setting comes from
 * the file named by `--config` (YAML, nested or with dotted keys), and the environment variable
 * of the same name, in capitals with the dots as underscores, overrides it
 * (`opensearch.hosts` is `OPENSEARCH_HOSTS`). `${NAME}` in a value of the file is the variable
 * NAME of the environment, as in OpenSearch Dashboards.
 *
 * A setting of OpenSearch Dashboards this server has no use for is reported and otherwise
 * ignored: a file written for it has many. A setting it does not know at all stops the start, as
 * it stops OpenSearch Dashboards, and so does one this server cannot honour where leaving it out
 * would leave the server less safe than the file asks (see original_settings.ts).
 * A value is checked as the original checks it, with its words.
 */

import { constants } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { flatten, parseYaml, type YamlValue } from './yaml';
import {
  CORE_KEYS_NOT_READ,
  CORE_NAMESPACES,
  NO_LONGER_USED,
  PLATFORM_CHECKED_IN_SERVER,
  REFUSED,
  RENAMED,
  RENAMED_BACK,
  listed,
  pluginNamespaceOf,
} from './original_settings';
import { DEFAULT_MAP_CONFIG, type MapConfig } from '../common/map_config';
import { DEFAULT_CSP, type CspSettings } from './static';

export interface ServerSslConfig {
  enabled: boolean;
  /** Paths of PEM files */
  certificate?: string;
  key?: string;
  keyPassphrase?: string;
  certificateAuthorities: string[];
  cipherSuites: string[];
  supportedProtocols: string[];
  clientAuthentication: 'none' | 'optional' | 'required';
  /** A port where plain HTTP is answered with the way to the same address over HTTPS */
  redirectHttpFromPort?: number;
}

export interface Config {
  server: {
    host: string;
    port: number;
    /** What a proxy in front puts before every path, without a slash at the end; '' for none */
    basePath: string;
    /** Whether requests come with the base path, which the server then takes off (server.rewriteBasePath) */
    rewriteBasePath: boolean;
    maxPayloadBytes: number;
    name: string;
    /** Headers put on every answer */
    customResponseHeaders: Record<string, string | string[]>;
    xsrf: { disableProtection: boolean; allowlist: string[] };
    compression: { enabled: boolean; referrerAllowlist?: string[] };
    /** How long a connection with no request in flight is kept open, in milliseconds */
    keepaliveTimeout: number;
    /** How long a connection may stay silent before it is closed, in milliseconds */
    socketTimeout: number;
    ssl: ServerSslConfig;
  };
  opensearch: {
    hosts: string[];
    username?: string;
    password?: string;
    requestTimeout: number;
    /** The time limit of the look at whether OpenSearch answers; when unset, as the request limit but at most 10 s */
    pingTimeout?: number;
    /** What a search asks OpenSearch to wait for its shards, in milliseconds; 0 for no limit */
    shardTimeout: number;
    customHeaders: Record<string, string>;
    /** The headers of a browser's request that go on to OpenSearch with what it causes */
    requestHeadersAllowlist: string[];
    /** Refuse an answer that would not fit in the memory left (opensearch.memoryCircuitBreaker) */
    memoryCircuitBreaker: { enabled: boolean; maxPercentage: number };
    ssl: {
      verificationMode: 'full' | 'certificate' | 'none';
      certificateAuthorities: string[];
      /** Paths of the PEM files of a client certificate, presented to OpenSearch */
      certificate?: string;
      key?: string;
      keyPassphrase?: string;
    };
  };
  /** The index the saved objects live in */
  index: string;
  savedObjects: { maxImportPayloadBytes: number; maxImportExportSize: number };
  uiSettings: { overrides: Record<string, unknown>; defaults: Record<string, unknown> };
  logging: { quiet: boolean; verbose: boolean; silent: boolean };
  /** The `map.*` settings of the maps_legacy, tile_map and region_map plugins */
  map: MapConfig;
  /** The csp.* settings the page's policy is built from, as in OpenSearch Dashboards */
  csp: CspSettings;
  /** vis_type_vega.enableExternalUrls: whether a Vega spec may load data from other addresses */
  visTypeVega: { enableExternalUrls: boolean };
  /** home.disableWelcomeScreen: whether the first page leaves out the welcome screen */
  home: { disableWelcomeScreen: boolean };
  /**
   * console.enabled: whether Dev Tools' console and its routes are there; console.proxyFilter:
   * the regular expressions one of which a path the console sends to OpenSearch must match
   */
  console: { enabled: boolean; proxyFilter: string[] };
}

/** Reads a setting's value; `fromEnvironment` is true for a value that came as text from the environment */
type Reader = (value: unknown, key: string, fromEnvironment?: boolean) => unknown;

/** What the type of a value is called in the messages of the original's schema (type-detect) */
const typeName = (value: unknown) =>
  value === null ? 'null' : Array.isArray(value) ? 'Array' : typeof value === 'object' ? 'Object' : typeof value;

/** A value the original's schema refuses, in its words: `[config validation of [server].port]: ...` */
export function configError(key: string, message: string): Error {
  const [namespace, ...rest] = key.split('.');
  return new Error(`[config validation of [${namespace}]${rest.length ? `.${rest.join('.')}` : ''}]: ${message}`);
}

// A number or a switch from the file is no text, as for the original; from the environment,
// where everything is text, it is the text as it was written
const string: Reader = (value, key, fromEnvironment) => {
  if (typeof value === 'string') return value;
  if (fromEnvironment && (typeof value === 'number' || typeof value === 'boolean')) return String(value);
  throw configError(key, `expected value of type [string] but got [${typeName(value)}]`);
};
const number: Reader = (value, key) => {
  const parsed = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof parsed === 'number' && Number.isFinite(parsed)) return parsed;
  throw configError(key, `expected value of type [number] but got [${typeName(value)}]`);
};
const boolean: Reader = (value, key) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string' && /^(true|false)$/i.test(value)) return value.toLowerCase() === 'true';
  throw configError(key, `expected value of type [boolean] but got [${typeName(value)}]`);
};
const list: Reader = (value, key, fromEnvironment) => {
  if (Array.isArray(value)) return value.map((item) => string(item, key, fromEnvironment));
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  throw configError(key, `expected value of type [array] but got [${typeName(value)}]`);
};
const map: Reader = (value, key) => {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) return value;
  throw configError(key, `expected value of type [object] but got [${typeName(value)}]`);
};
const numbers: Reader = (value, key) => {
  if (!Array.isArray(value)) throw configError(key, `expected value of type [array] but got [${typeName(value)}]`);
  return value.map((item) => number(item, key));
};
// One text or a list of texts, the one meaning a list of one (requestHeadersWhitelist, certificateAuthorities)
const textOrList: Reader = (value, key, fromEnvironment) =>
  Array.isArray(value) ? list(value, key, fromEnvironment) : [string(value, key, fromEnvironment)];

/**
 * server.basePath as the original checks it (http_config.ts, `/^\/.*[^\/]$/`): a slash first, the
 * rest on one line, and a last character that is no slash, so that "", "/" and "/a\nb" are
 * refused, and "/a\n" is not. Its own check takes the place of the type's there, so a value that
 * is no text is refused in the same words; the original lets a list through when its items,
 * joined with commas, would pass (`[/a]`), and the base path is then a list: that is refused here.
 */
const BASE_PATH = /^\/.*[^/]$/;
const basePathOf: Reader = (value, key, fromEnvironment) => {
  const text = typeof value === 'string' || (fromEnvironment && typeof value !== 'object') ? String(value) : undefined;
  if (text === undefined || !BASE_PATH.test(text)) throw configError(key, "must start with a slash, don't end with one");
  return text;
};

/** A size as `@osd/config-schema`'s byteSize reads it: bytes, or `<count>b|kb|mb|gb` */
const byteSize: Reader = (value, key) => {
  let bytes: unknown = value;
  if (typeof value === 'string') {
    const match = /([1-9][0-9]*)(b|kb|mb|gb)/.exec(value);
    if (match) {
      bytes = parseInt(match[1], 10) * 1024 ** ['b', 'kb', 'mb', 'gb'].indexOf(match[2]);
    } else {
      bytes = Number(value);
      if (Number.isNaN(bytes)) {
        throw configError(
          key,
          "Failed to parse value as byte value. Value must be either number of bytes, or follow the format <count>[b|kb|mb|gb] (e.g., '1024kb', '200mb', '1gb'), where the number is a safe positive integer."
        );
      }
    }
  }
  if (typeof bytes !== 'number') throw configError(key, `expected value of type [ByteSize] but got [${typeName(value)}]`);
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw configError(key, 'Value in bytes is expected to be a safe positive integer.');
  return bytes;
};

const DURATION_UNITS: Record<string, number> = {
  ms: 1,
  s: 1000,
  m: 60000,
  h: 3600000,
  d: 86400000,
  w: 604800000,
  // as moment counts them: a month and a year of the Gregorian calendar's average length
  M: 2629746000,
  Y: 31556952000,
};

/** A time as `@osd/config-schema`'s duration reads it: milliseconds, or `<count>ms|s|m|h|d|w|M|Y`; in milliseconds */
const duration: Reader = (value, key) => {
  let ms: unknown = value;
  if (typeof value === 'string') {
    const match = /^(0|[1-9][0-9]*)(ms|s|m|h|d|w|M|Y)$/.exec(value);
    if (match) return parseInt(match[1], 10) * DURATION_UNITS[match[2]];
    ms = Number(value);
    if (Number.isNaN(ms)) {
      throw configError(
        key,
        "Failed to parse value as time value. Value must be a duration in milliseconds, or follow the format <count>[ms|s|m|h|d|w|M|Y] (e.g. '70ms', '5s', '3d', '1Y'), where the duration is a safe positive integer."
      );
    }
  }
  if (typeof ms !== 'number') throw configError(key, `expected value of type [moment.Duration] but got [${typeName(value)}]`);
  if (!Number.isSafeInteger(ms) || ms < 0) throw configError(key, 'Value in milliseconds is expected to be a safe positive integer.');
  return ms;
};

/** server.customResponseHeaders: any values, a list staying a list, an object written as JSON, as the original */
const headerValues: Reader = (value, key) => {
  const headers = map(value, key) as Record<string, unknown>;
  const text = (entry: unknown) => (typeof entry === 'object' && entry !== null ? JSON.stringify(entry) : String(entry));
  return Object.fromEntries(
    Object.entries(headers).map(([name, entry]) => [name, Array.isArray(entry) ? entry.map(text) : text(entry)])
  );
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
/** console.proxyFilter: a list of regular expressions, as the original's schema and its plugin read it */
const regularExpressions: Reader = (given, key, fromEnvironment) => {
  let value = given;
  // config-schema reads a list given as text as JSON
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      throw configError(key, 'could not parse array value from json input');
    }
    if (!Array.isArray(value)) throw configError(key, 'could not parse array value from json input');
  }
  if (!Array.isArray(value)) throw configError(key, `expected value of type [array] but got [${typeName(value)}]`);
  return value.map((item: unknown, index) => {
    const source = string(item, `${key}.${index}`, fromEnvironment) as string;
    try {
      RegExp(source);
    } catch (error) {
      // The original stops where its plugin makes the expression, in these words
      throw configError(`${key}.${index}`, (error as Error).message);
    }
    return source;
  });
};
const oneOf =
  (...allowed: string[]): Reader =>
  (value, key) => {
    if (typeof value === 'string' && allowed.includes(value)) return value;
    throw configError(key, `expected one of [${allowed.join(', ')}] but got [${String(value)}]`);
  };

// Every setting the server reads, with what reads its value
const SETTINGS: Record<string, Reader> = {
  'server.host': string,
  'server.port': number,
  'server.basePath': basePathOf,
  'server.rewriteBasePath': boolean,
  // The original reads it as server.maxPayload, and names it so when it refuses a value
  'server.maxPayloadBytes': (value) => byteSize(value, 'server.maxPayload'),
  'server.name': string,
  'server.customResponseHeaders': headerValues,
  'server.xsrf.disableProtection': boolean,
  'server.xsrf.whitelist': list,
  'server.compression.enabled': boolean,
  'server.compression.referrerWhitelist': list,
  'server.keepaliveTimeout': number,
  'server.socketTimeout': number,
  'server.ssl.enabled': boolean,
  'server.ssl.certificate': string,
  'server.ssl.key': string,
  'server.ssl.keyPassphrase': string,
  'server.ssl.certificateAuthorities': textOrList,
  'server.ssl.cipherSuites': list,
  'server.ssl.supportedProtocols': list,
  'server.ssl.clientAuthentication': oneOf('none', 'optional', 'required'),
  'server.ssl.redirectHttpFromPort': number,
  'opensearch.hosts': list,
  'opensearch.username': string,
  'opensearch.password': string,
  'opensearch.requestTimeout': duration,
  'opensearch.pingTimeout': duration,
  'opensearch.shardTimeout': duration,
  'opensearch.customHeaders': map,
  'opensearch.requestHeadersWhitelist': textOrList,
  'opensearch.memoryCircuitBreaker.enabled': boolean,
  'opensearch.memoryCircuitBreaker.maxPercentage': number,
  'opensearch.ssl.verificationMode': oneOf('full', 'certificate', 'none'),
  'opensearch.ssl.certificateAuthorities': textOrList,
  'opensearch.ssl.certificate': string,
  'opensearch.ssl.key': string,
  'opensearch.ssl.keyPassphrase': string,
  // The client certificate is presented on every request here, which is what this asks for
  'opensearch.ssl.alwaysPresentCertificate': boolean,
  'opensearchDashboards.index': string,
  'savedObjects.maxImportPayloadBytes': byteSize,
  'savedObjects.maxImportExportSize': byteSize,
  'uiSettings.overrides': map,
  'uiSettings.defaults': map,
  'logging.silent': boolean,
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
  'console.enabled': boolean,
  'console.proxyFilter': regularExpressions,
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
const MAP_SETTINGS = Object.keys(SETTINGS).filter((key) => SETTINGS[key] === map || SETTINGS[key] === headerValues);

/**
 * Maps of headers, whose names the original reads up to the first dot, as it reads every key of
 * its file (ensureDeepObject): what is under a name is a map, which the original then refuses or
 * writes as JSON. The advanced settings keep their whole dotted names (`timeline:es.timefield`),
 * which the original cannot override.
 */
const NESTED_MAPS = ['server.customResponseHeaders', 'opensearch.customHeaders'];

function setNested(target: Record<string, unknown>, path: string[], value: unknown) {
  const [first, ...rest] = path;
  if (rest.length === 0) {
    target[first] = value;
    return;
  }
  const inner = target[first];
  const next = isMap(inner) ? inner : (target[first] = Object.create(null) as Record<string, unknown>);
  setNested(next as Record<string, unknown>, rest, value);
}

/** The defaults of the advanced settings a file may give: the original's schema names two */
const UI_SETTINGS_DEFAULTS = ['theme:darkMode', 'theme:version'];

const TLS_PROTOCOLS = ['TLSv1', 'TLSv1.1', 'TLSv1.2', 'TLSv1.3'];

/** The ciphers Node offers by default, which is the original's default of server.ssl.cipherSuites */
const defaultCipherList = () => constants.defaultCoreCipherList.split(':');

const environmentName = (key: string) => key.replace(/\./g, '_').toUpperCase();

/** Whether a key is a key of the settings this server knows, or what one of them is under */
const KNOWN_KEYS = [...Object.keys(SETTINGS), ...CORE_KEYS_NOT_READ.map((key) => key.replace(/\.\*$/, '')), ...REFUSED.map((entry) => entry.key)];
const isKnownPrefix = (key: string) => KNOWN_KEYS.some((known) => known === key || known.startsWith(`${key}.`));

/**
 * A key of a namespace of the original's core that the original does not know, in its words:
 * the old platform's schema names the first part it does not know, the new one its whole path
 */
function unknownCoreKey(key: string): Error {
  const parts = key.split('.');
  let known = 1;
  while (known < parts.length && isKnownPrefix(parts.slice(0, known + 1).join('.'))) known += 1;
  const first = parts.slice(0, known + 1).join('.');
  const legacy =
    CORE_NAMESPACES[parts[0]] === 'legacy' && !PLATFORM_CHECKED_IN_SERVER.some((name) => first.startsWith(`${name}.`));
  return legacy ? new Error(`"${first}" is not allowed`) : configError(first, 'definition for this key is missing');
}

/** `${NAME}` in a text of the file is the environment's NAME, as the original reads its file */
function withEnvironment(value: YamlValue, env: Record<string, string | undefined>): YamlValue {
  if (typeof value === 'string') {
    return value.replace(/\$\{(\w+)\}/g, (_, name: string) => {
      const found = env[name];
      if (found === undefined) throw new Error(`Unknown environment variable referenced in config : ${name}`);
      return found;
    });
  }
  if (Array.isArray(value)) return value.map((item) => withEnvironment(item, env));
  if (value !== null && typeof value === 'object') {
    const copy: { [key: string]: YamlValue } = Object.create(null);
    for (const [key, inner] of Object.entries(value)) copy[key] = withEnvironment(inner, env);
    return copy;
  }
  return value;
}

/** The original's renames and settings no longer used, applied to the keys of a file */
function applyDeprecations(flat: Record<string, YamlValue>, deprecations: string[]) {
  const under = (path: string) => Object.keys(flat).filter((key) => key === path || key.startsWith(`${path}.`));
  const take = (path: string) =>
    under(path).map((key): [string, YamlValue] => {
      const value = flat[key];
      delete flat[key];
      return [key.slice(path.length), value];
    });
  for (const [from, to] of RENAMED) {
    if (under(from).length === 0) continue;
    const moved = take(from);
    if (under(to).length > 0) {
      deprecations.push(`"${from}" is deprecated and has been replaced by "${to}". However both key are present, ignoring "${from}"`);
    } else {
      for (const [rest, value] of moved) flat[`${to}${rest}`] = value;
      deprecations.push(`"${from}" is deprecated and has been replaced by "${to}"`);
    }
  }
  for (const [old, next] of RENAMED_BACK) {
    if (under(old).length > 0) deprecations.push(`"${old}" is deprecated and has been replaced by "${next}"`);
    else for (const [rest, value] of take(next)) flat[`${old}${rest}`] = value;
  }
  for (const key of NO_LONGER_USED) {
    if (under(key).length === 0) continue;
    take(key);
    deprecations.push(`${key} is deprecated and is no longer used`);
  }
}

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
  /** What OpenSearch Dashboards says of the deprecated settings the file uses, in its words */
  deprecations: string[];
}

const isMap = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export function loadConfig(
  options: { file?: string; env?: Record<string, string | undefined> } = {}
): LoadedConfig {
  const env = options.env ?? process.env;
  const values: Record<string, unknown> = Object.create(null);
  const ignored: string[] = [];
  const deprecations: string[] = [];

  if (options.file) {
    const flat = flatten(parseYaml(readFileSync(options.file, 'utf8')));
    for (const key of Object.keys(flat)) flat[key] = withEnvironment(flat[key], env);
    applyDeprecations(flat, deprecations);
    const unknown: string[] = [];
    for (const [key, value] of Object.entries(flat)) {
      const parent = MAP_SETTINGS.find((name) => key.startsWith(`${name}.`));
      const refused = REFUSED.find((entry) => entry.key === key);
      if (parent) {
        const inner = (values[parent] ??= Object.create(null)) as Record<string, unknown>;
        const rest = key.slice(parent.length + 1);
        if (NESTED_MAPS.includes(parent)) setNested(inner, rest.split('.'), value);
        else inner[rest] = value;
      } else if (Object.prototype.hasOwnProperty.call(SETTINGS, key)) {
        values[key] = value;
      } else if (refused) {
        if (refused.refuses(value)) throw new Error(`${key}: ${refused.reason}`);
      } else if (isKnownPrefix(key) && isMap(value) && Object.keys(value).length === 0) {
        // `server: {}`: nothing set
      } else if (listed(CORE_KEYS_NOT_READ, key) || pluginNamespaceOf(key) !== undefined) {
        ignored.push(key);
      } else if (key === 'csp' || key.startsWith('csp.')) {
        // The settings of the content security policy are read where it is made (static.ts)
        ignored.push(key);
      } else if (Object.prototype.hasOwnProperty.call(CORE_NAMESPACES, key.split('.')[0])) {
        if (isKnownPrefix(key)) {
          throw configError(key, `expected a plain object value, but found [${typeName(value)}] instead.`);
        }
        throw unknownCoreKey(key);
      } else {
        unknown.push(key);
      }
    }
    if (unknown.length > 0) {
      throw new Error(
        `Unknown configuration key(s): ${unknown.map((key) => `"${key}"`).join(', ')}. ` +
          'Check for spelling errors and ensure that expected plugins are installed.'
      );
    }
  }

  const fromEnv = new Set<string>();
  for (const key of Object.keys(SETTINGS)) {
    const raw = env[environmentName(key)];
    if (raw !== undefined && raw !== '') {
      values[key] = fromEnvironment(raw);
      fromEnv.add(key);
    }
  }
  // What the image of the original reads from the environment is refused there as in a file
  for (const entry of REFUSED) {
    const raw = env[environmentName(entry.key)];
    if (raw !== undefined && raw !== '' && entry.refuses(fromEnvironment(raw))) {
      throw new Error(`${environmentName(entry.key)}: ${entry.reason}`);
    }
  }

  const read = <T>(key: string, fallback: T): T =>
    key in values ? (SETTINGS[key](values[key], key, fromEnv.has(key)) as T) : fallback;

  // '' when it is not given: the original's is undefined then
  const basePath = read<string>('server.basePath', '');
  const rewriteBasePath = read('server.rewriteBasePath', false);
  if (rewriteBasePath && basePath === '') {
    throw new Error('[config validation of [server]]: cannot use [rewriteBasePath] when [basePath] is not specified');
  }
  if ('server.basePath' in values && !('server.rewriteBasePath' in values)) {
    deprecations.push(
      'You should set server.basePath along with server.rewriteBasePath. OpenSearch Dashboards will expect that all ' +
        'requests start with server.basePath rather than expecting you to rewrite the requests in your reverse proxy. ' +
        'Set server.rewriteBasePath to false to preserve the current behavior and silence this warning.'
    );
  }
  const port = read('server.port', 5601);

  const xsrfAllowlist = read('server.xsrf.whitelist', [] as string[]);
  xsrfAllowlist.forEach((path, index) => {
    if (!path.startsWith('/')) throw configError(`server.xsrf.whitelist.${index}`, 'must start with a slash');
  });
  if (xsrfAllowlist.length > 0) {
    deprecations.push(
      'It is not recommended to disable xsrf protections for API endpoints via [server.xsrf.whitelist]. ' +
        'Instead, supply the "osd-xsrf" header.'
    );
  }

  const compression = {
    enabled: read('server.compression.enabled', true),
    referrerAllowlist: read<string[] | undefined>('server.compression.referrerWhitelist', undefined),
  };
  if (!compression.enabled && compression.referrerAllowlist) {
    throw new Error(
      '[config validation of [server]]: cannot use [compression.referrerWhitelist] when [compression.enabled] is set to false'
    );
  }
  if (compression.referrerAllowlist?.length === 0) {
    throw configError('server.compression.referrerWhitelist', 'array size is [0], but cannot be smaller than [1]');
  }

  const ssl: ServerSslConfig = {
    enabled: read('server.ssl.enabled', false),
    certificate: read<string | undefined>('server.ssl.certificate', undefined),
    key: read<string | undefined>('server.ssl.key', undefined),
    keyPassphrase: read<string | undefined>('server.ssl.keyPassphrase', undefined),
    certificateAuthorities: read('server.ssl.certificateAuthorities', [] as string[]),
    // Node's own list, which is what the original's default is made of
    cipherSuites: read('server.ssl.cipherSuites', defaultCipherList()),
    supportedProtocols: read('server.ssl.supportedProtocols', ['TLSv1.1', 'TLSv1.2', 'TLSv1.3']),
    clientAuthentication: read('server.ssl.clientAuthentication', 'none'),
    redirectHttpFromPort: read<number | undefined>('server.ssl.redirectHttpFromPort', undefined),
  };
  ssl.supportedProtocols.forEach((protocol, index) => {
    if (!TLS_PROTOCOLS.includes(protocol)) {
      throw configError(
        `server.ssl.supportedProtocols.${index}`,
        `types that failed validation:\n${TLS_PROTOCOLS.map((name, at) => `- [${at}]: expected value to equal [${name}]`).join('\n')}`
      );
    }
  });
  if (ssl.supportedProtocols.length === 0) {
    throw configError('server.ssl.supportedProtocols', 'array size is [0], but cannot be smaller than [1]');
  }
  if (ssl.enabled && (!ssl.key || !ssl.certificate)) {
    throw configError('server.ssl', 'must specify [certificate] and [key] -- or [keystore.path] -- when ssl is enabled');
  }
  if (!ssl.enabled && ssl.clientAuthentication !== 'none') {
    throw configError('server.ssl', 'must enable ssl to use [clientAuthentication]');
  }
  if (ssl.enabled && ssl.redirectHttpFromPort !== undefined && ssl.redirectHttpFromPort === port) {
    throw new Error(
      '[config validation of [server]]: OpenSearch Dashboards does not accept http traffic to [port] when ssl is enabled ' +
        '(only https is allowed), so [ssl.redirectHttpFromPort] cannot be configured to the same value. ' +
        `Both are [${port}].`
    );
  }

  const uiSettingsDefaults = read('uiSettings.defaults', {}) as Record<string, unknown>;
  for (const name of Object.keys(uiSettingsDefaults)) {
    if (!UI_SETTINGS_DEFAULTS.includes(name)) throw configError(`uiSettings.defaults.${name}`, 'definition for this key is missing');
  }
  const customHeaders = read('opensearch.customHeaders', {}) as Record<string, unknown>;
  for (const [name, value] of Object.entries(customHeaders)) {
    if (typeof value !== 'string') {
      throw configError(`opensearch.customHeaders.${name}`, `expected value of type [string] but got [${typeName(value)}]`);
    }
  }
  const username = read<string | undefined>('opensearch.username', undefined);
  if (username === 'elastic' || username === 'opensearchDashboards') {
    deprecations.push(
      `Setting [opensearch.username] to "${username}" is deprecated. You should use the "opensearch_dashboards_system" user instead.`
    );
  }
  const clientCertificate = read<string | undefined>('opensearch.ssl.certificate', undefined);
  const clientKey = read<string | undefined>('opensearch.ssl.key', undefined);
  if ((clientKey === undefined) !== (clientCertificate === undefined)) {
    const [given, missing] = clientKey === undefined ? ['certificate', 'key'] : ['key', 'certificate'];
    deprecations.push(
      `Setting [opensearch.ssl.${given}] without [opensearch.ssl.${missing}] is deprecated. This has no effect, ` +
        'you should use both settings to enable TLS client authentication to OpenSearch.'
    );
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
      // As the original: only this machine, unless the file says otherwise (the image's file does)
      host: read('server.host', 'localhost'),
      port,
      basePath,
      rewriteBasePath,
      maxPayloadBytes: read('server.maxPayloadBytes', 1048576),
      // The name of the machine, which tells the replicas behind a balancer apart (osd-name)
      name: read('server.name', hostname()),
      customResponseHeaders: read('server.customResponseHeaders', {}) as Record<string, string | string[]>,
      xsrf: { disableProtection: read('server.xsrf.disableProtection', false), allowlist: xsrfAllowlist },
      compression,
      keepaliveTimeout: read('server.keepaliveTimeout', 120000),
      socketTimeout: read('server.socketTimeout', 120000),
      ssl,
    },
    opensearch: {
      hosts,
      username: read<string | undefined>('opensearch.username', inAddress?.username),
      password: read<string | undefined>('opensearch.password', inAddress?.password),
      requestTimeout: read('opensearch.requestTimeout', 30000),
      pingTimeout: read<number | undefined>('opensearch.pingTimeout', undefined),
      shardTimeout: read('opensearch.shardTimeout', 30000),
      customHeaders: customHeaders as Record<string, string>,
      requestHeadersAllowlist: read('opensearch.requestHeadersWhitelist', ['authorization']),
      memoryCircuitBreaker: {
        enabled: read('opensearch.memoryCircuitBreaker.enabled', false),
        maxPercentage: read('opensearch.memoryCircuitBreaker.maxPercentage', 1),
      },
      ssl: {
        verificationMode: read('opensearch.ssl.verificationMode', 'full'),
        certificateAuthorities: read('opensearch.ssl.certificateAuthorities', [] as string[]),
        certificate: clientCertificate,
        key: clientKey,
        keyPassphrase: read<string | undefined>('opensearch.ssl.keyPassphrase', undefined),
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
    logging: { quiet: read('logging.quiet', false), verbose: read('logging.verbose', false), silent: read('logging.silent', false) },
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
    console: { enabled: read('console.enabled', true), proxyFilter: read('console.proxyFilter', ['.*']) },
  };
  return { config, ignored, deprecations };
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

/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Where base maps and vector shapes come from: the OpenSearch maps service (its manifest, its tile
 * services and its file layers), the tile service of `map.tilemap.*` and the shapes of
 * `map.regionmap.layers`. The ServiceSettings of maps_legacy, with the part of @elastic/ems-client
 * 7.10.0 it relies on written here: the same requests, in the same order, with the same answers.
 */

import { ORIGIN, type MapConfig, type TilemapConfig } from './config';

const TMS_IN_YML_ID = 'TMS in config/opensearch_dashboards.yml';
const DEFAULT_LANGUAGE = 'en';
const LOAD_TIMEOUT = 32000;

/** When the maps service cannot be reached: what keeps a WMS base map possible */
export const DEFAULT_SERVICE: TmsService[] = [
  {
    origin: ORIGIN.EMS,
    id: 'road_map',
    minZoom: 0,
    maxZoom: 22,
    attribution:
      '<a rel="noreferrer noopener" href="https://www.openstreetmap.org/copyright">Map data © OpenStreetMap contributors</a>',
  },
];

/** A base map one can choose, as the editor and saved visualizations know it */
export interface TmsService {
  origin: string;
  id: string;
  minZoom?: number;
  maxZoom?: number;
  attribution?: string;
  url?: string;
  subdomains?: string[];
  [option: string]: unknown;
}

/** What drawing a base map takes */
export interface TmsAttributes {
  url?: string;
  minZoom?: number;
  maxZoom?: number;
  attribution?: string;
  origin: string;
  [option: string]: unknown;
}

/** A layer of shapes, as region maps and saved visualizations know it */
export interface FileLayer {
  name: string;
  origin: string;
  id?: string;
  created_at?: string;
  attribution: string;
  fields: Array<{ type?: string; name: string; description: string }>;
  format: string | { type: string };
  meta?: { feature_collection_path?: string };
  url?: string;
  layerId?: string;
  isEMS?: boolean;
}

type I18n = Record<string, string> | undefined;
interface Attribution {
  label: I18n;
  url: I18n;
}
interface TmsServiceConfig {
  id: string;
  name?: I18n;
  attribution: Attribution[];
  formats: Array<{ locale: string; format: string; url: string }>;
}
interface FileLayerConfig {
  layer_id: string;
  created_at?: string;
  attribution: Attribution[];
  formats: Array<{ type: string; url: string; legacy_default?: boolean; meta?: { feature_collection_path?: string } }>;
  fields: Array<{ type: string; id: string; label: I18n }>;
  legacy_ids: string[];
  layer_name: I18n;
}
interface Catalogue {
  services: Array<{ type: string; manifest: string }>;
}

type Fetch = (url: string) => Promise<Response>;

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

/** markdown-it's rendering of an attribution (html off, linkify on), for one paragraph */
export function renderAttributionMarkdown(markdown: string): string {
  if (markdown.trim() === '') return '';
  let html = escapeHtml(markdown.trim());
  html = html.replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, label: string, href: string) => `<a href="${href}">${label}</a>`);
  html = html.replace(/(^|[\s(])((?:https?:\/\/|www\.)[^\s<]+[^\s<.,;:!?)])/g, (_m, before: string, url: string) => {
    const href = url.startsWith('www.') ? `http://${url}` : url;
    return `${before}<a href="${href}">${url}</a>`;
  });
  return `<p>${html.replace(/\n/g, '\n')}</p>\n`;
}

/** The query every request to the maps service carries */
export function withServiceParams(url: string, version: string): string {
  const params: Array<[string, string]> = [
    ['elastic_tile_service_tos', 'agree'],
    ['my_app_name', 'opensearch-dashboards'],
    ['my_app_version', version],
  ];
  const [beforeHash, hash] = url.split('#', 2);
  const [path, query = ''] = beforeHash.split('?', 2);
  const search = new URLSearchParams(query);
  for (const [key, value] of params) search.set(key, value);
  const text = search.toString().replace(/%7B(\w+?)%7D/gi, '{$1}');
  return `${path}?${text}${hash !== undefined ? `#${hash}` : ''}`;
}

export function toAbsoluteUrl(host: string, path: string): string {
  if (!host) return path;
  const hostSlash = host.endsWith('/');
  const pathSlash = path.startsWith('/');
  if (hostSlash && pathSlash) return host + path.slice(1);
  if (hostSlash !== pathSlash) return host + path;
  return `${host}/${path}`;
}

export class ServiceSettings {
  private readonly hasTmsConfigured: boolean;
  private readonly tmsOptionsFromConfig: TmsService;
  private catalogue?: Promise<Catalogue>;
  private tmsServices?: Promise<TmsServiceConfig[]>;
  private fileLayers?: Promise<FileLayerConfig[]>;
  private showZoomMessage = true;

  constructor(
    private readonly mapConfig: MapConfig,
    private readonly tilemapConfig: TilemapConfig,
    private readonly version: string,
    private readonly fetchFunction: Fetch = (url) => fetch(url),
    private readonly language = DEFAULT_LANGUAGE
  ) {
    this.hasTmsConfigured = typeof tilemapConfig.url === 'string' && tilemapConfig.url !== '';
    this.tmsOptionsFromConfig = {
      ...tilemapConfig.options,
      // As maps_legacy does: the rendered markdown, escaped
      attribution: escapeHtml(renderAttributionMarkdown(tilemapConfig.options.attribution || '')),
      url: tilemapConfig.url,
    } as unknown as TmsService;
  }

  shouldShowRegionDeniedWarning(): boolean {
    return this.mapConfig.showRegionDeniedWarning;
  }

  shouldShowZoomMessage({ origin }: { origin?: string }): boolean {
    return origin === ORIGIN.EMS && this.showZoomMessage;
  }

  enableZoomMessage() {
    this.showZoomMessage = true;
  }

  disableZoomMessage() {
    this.showZoomMessage = false;
  }

  private value(i18n: I18n): string {
    if (!i18n) return '';
    return i18n[this.language] ?? i18n[DEFAULT_LANGUAGE] ?? '';
  }

  private fetchWithTimeout(url: string): Promise<Response> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Request to ${url} timed out`)), LOAD_TIMEOUT);
      this.fetchFunction(url).then(
        (response) => {
          clearTimeout(timer);
          resolve(response);
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(error);
        }
      );
    });
  }

  private async getManifest<T>(manifestUrl: string): Promise<T> {
    try {
      const result = await this.fetchWithTimeout(withServiceParams(manifestUrl, this.version));
      return (await result.json()) as T;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Unable to retrieve manifest from ${manifestUrl}: ${message}`);
    }
  }

  private mainCatalogue(): Promise<Catalogue> {
    this.catalogue ??= (async () => {
      const manifestUrl = this.mapConfig.opensearchManifestServiceUrl;
      if (manifestUrl) return this.getManifest<Catalogue>(withServiceParams(manifestUrl, this.version));
      const services: Catalogue['services'] = [];
      if (this.mapConfig.emsTileApiUrl) services.push({ type: 'tms', manifest: toAbsoluteUrl(this.mapConfig.emsTileApiUrl, 'v7.10/manifest') });
      if (this.mapConfig.emsFileApiUrl) services.push({ type: 'file', manifest: toAbsoluteUrl(this.mapConfig.emsFileApiUrl, 'v7.10/manifest') });
      return { services };
    })();
    return this.catalogue;
  }

  private tmsConfigs(): Promise<TmsServiceConfig[]> {
    const pending = (this.tmsServices ??= (async () => {
      const catalogue = await this.mainCatalogue();
      const first = catalogue.services.find((service) => service.type === 'tms');
      if (!first) return [];
      const manifest = await this.getManifest<{ services?: TmsServiceConfig[] }>(first.manifest);
      return manifest?.services ?? [];
    })());
    // A failure is not kept: the next map asks again, as the client's _.once of a rejection does not
    pending.catch(() => {
      if (this.tmsServices === pending) this.tmsServices = undefined;
      if (this.catalogue) this.catalogue.catch(() => (this.catalogue = undefined));
    });
    return pending;
  }

  private fileConfigs(): Promise<FileLayerConfig[]> {
    const pending = (this.fileLayers ??= (async () => {
      const catalogue = await this.mainCatalogue();
      const first = catalogue.services.find((service) => service.type === 'file');
      if (!first) return [];
      const manifest = await this.getManifest<{ layers?: FileLayerConfig[] }>(first.manifest);
      return manifest?.layers ?? [];
    })());
    pending.catch(() => {
      if (this.fileLayers === pending) this.fileLayers = undefined;
    });
    return pending;
  }

  private rasterStyles = new Map<string, Promise<{ tiles: string[]; minzoom?: number; maxzoom?: number } | undefined>>();

  private rasterStyle(service: TmsServiceConfig) {
    let style = this.rasterStyles.get(service.id);
    if (!style) {
      style = (async () => {
        let formats = service.formats.filter((f) => f.locale === this.language && f.format === 'raster');
        if (!formats.length) formats = service.formats.filter((f) => f.locale === DEFAULT_LANGUAGE && f.format === 'raster');
        if (!formats.length) {
          throw new Error(`Cannot find raster tile layer for locale ${this.language} or ${DEFAULT_LANGUAGE}`);
        }
        const url = this.absolute(formats[0].url, this.mapConfig.emsTileApiUrl);
        return this.getManifest<{ tiles: string[]; minzoom?: number; maxzoom?: number }>(url);
      })();
      this.rasterStyles.set(service.id, style);
    }
    return style;
  }

  private absolute(url: string, api: string): string {
    return /^https?:\/\//.test(url) ? url : toAbsoluteUrl(api, url);
  }

  private attributionString(attribution: Attribution[]): string {
    return attribution
      .map((item) => {
        const url = this.value(item.url);
        const anchor = document.createElement('a');
        anchor.setAttribute('rel', 'noreferrer noopener');
        if (url.startsWith('http://') || url.startsWith('https://')) anchor.setAttribute('href', url);
        anchor.textContent = this.value(item.label);
        return anchor.outerHTML;
      })
      .join(' | ');
  }

  private fileLayerSettings(layer: FileLayerConfig): FileLayer {
    const format = layer.formats.find((f) => f.legacy_default) ?? layer.formats[0];
    return {
      name: this.value(layer.layer_name),
      origin: ORIGIN.EMS,
      id: layer.layer_id,
      created_at: layer.created_at,
      attribution: this.attributionString(layer.attribution),
      fields: layer.fields.map((field) => ({ type: field.type, name: field.id, description: this.value(field.label) })),
      format: format?.type ?? 'geojson',
      meta: format && 'meta' in format ? format.meta : undefined,
    };
  }

  /** The layers of shapes the maps service offers */
  async getFileLayers(): Promise<FileLayer[]> {
    if (!this.mapConfig.includeOpenSearchMapsService) return [];
    try {
      return (await this.fileConfigs()).map((layer) => this.fileLayerSettings(layer));
    } catch {
      return [];
    }
  }

  /** The base maps: the one of opensearch_dashboards.yml first, then the maps service's own */
  async getTMSServices(): Promise<TmsService[]> {
    let all: TmsService[] = [];
    if (this.hasTmsConfigured) {
      all.push({ ...structuredClone(this.tmsOptionsFromConfig), id: TMS_IN_YML_ID, origin: ORIGIN.OPENSEARCH_DASHBOARDS_YML });
    }
    if (this.mapConfig.includeOpenSearchMapsService) {
      let fromManifest: TmsServiceConfig[];
      try {
        fromManifest = await this.tmsConfigs();
      } catch {
        return DEFAULT_SERVICE;
      }
      const stripped = await Promise.all(
        fromManifest
          .filter((service) => service.id === this.mapConfig.emsTileLayerId.bright)
          .map(async (service) => {
            const style = await this.rasterStyle(service);
            return {
              origin: ORIGIN.EMS,
              id: service.id,
              minZoom: style?.minzoom,
              maxZoom: style?.maxzoom,
              attribution: this.attributionString(service.attribution),
            };
          })
      );
      all = all.concat(stripped);
    }
    return all;
  }

  private async findFileLayer(config: { name?: string; id?: string }): Promise<FileLayerConfig | undefined> {
    const layers = await this.fileConfigs();
    return layers.find((layer) => {
      const has = (id?: string) => id !== undefined && (layer.layer_id === id || layer.legacy_ids.includes(id));
      return has(config.name) || has(config.id);
    });
  }

  async getFileLayerFromConfig(config: { name?: string; id?: string }): Promise<FileLayer | null> {
    try {
      const layer = await this.findFileLayer(config);
      return layer ? this.fileLayerSettings(layer) : null;
    } catch {
      return null;
    }
  }

  async loadFileLayerConfig(config: { name?: string; id?: string }): Promise<FileLayer | null> {
    return this.getFileLayerFromConfig(config);
  }

  /** A link to a layer of shapes on the maps service's landing page */
  async getEMSHotLink(config: { name?: string; id?: string }): Promise<string | null> {
    const layer = await this.findFileLayer(config).catch(() => undefined);
    if (!layer) return null;
    const url = new URL(this.mapConfig.emsLandingPageUrl || 'http://localhost/');
    url.searchParams.set('locale', this.language);
    url.hash = `file/${layer.layer_id}`;
    return url.toString();
  }

  private async emsTmsAttributes(isDesaturated: boolean, isDarkMode: boolean): Promise<TmsAttributes | TmsService[]> {
    let services: TmsServiceConfig[];
    try {
      services = await this.tmsConfigs();
    } catch {
      return DEFAULT_SERVICE;
    }
    const ids = this.mapConfig.emsTileLayerId;
    const serviceId = isDarkMode ? ids.dark : isDesaturated ? ids.desaturated : ids.bright;
    const service = services.find((candidate) => candidate.id === serviceId);
    if (!service) {
      // ems-client's getUrlTemplate of undefined: what maps_legacy then fails with
      throw new TypeError("Cannot read properties of undefined (reading 'getUrlTemplate')");
    }
    const style = await this.rasterStyle(service);
    return {
      url: style ? withServiceParams(this.absolute(style.tiles[0], this.mapConfig.emsTileApiUrl), this.version) : '',
      minZoom: style?.minzoom,
      maxZoom: style?.maxzoom,
      attribution: this.attributionString(service.attribution),
      origin: ORIGIN.EMS,
    };
  }

  /**
   * What drawing a base map takes. As in maps_legacy, an unreachable maps service gives the list of
   * DEFAULT_SERVICE instead, which has no url.
   */
  async getAttributesForTMSLayer(
    service: { origin?: string; id?: string },
    isDesaturated: boolean,
    isDarkMode: boolean
  ): Promise<TmsAttributes | TmsService[]> {
    if (service.origin === ORIGIN.EMS) return this.emsTmsAttributes(isDesaturated, isDarkMode);
    if (service.origin === ORIGIN.OPENSEARCH_DASHBOARDS_YML || service.id === TMS_IN_YML_ID) {
      // maps_legacy picks these from the top of map.tilemap, where only url is
      const picked: TmsAttributes = { origin: ORIGIN.OPENSEARCH_DASHBOARDS_YML };
      if (this.tilemapConfig.url !== undefined) picked.url = this.tilemapConfig.url;
      return picked;
    }
    return this.emsTmsAttributes(isDesaturated, isDarkMode);
  }

  async getUrlForRegionLayer(config: FileLayer): Promise<string | undefined> {
    if (config.origin === ORIGIN.EMS || config.layerId?.startsWith(`${ORIGIN.EMS}.`)) {
      const layer = await this.findFileLayer(config);
      if (!layer) throw new Error(`File  ${config.name} not recognized`);
      const format = layer.formats.find((f) => f.legacy_default) ?? layer.formats[0];
      return withServiceParams(this.absolute(format.url, this.mapConfig.emsFileApiUrl), this.version);
    }
    return config.url;
  }

  async getJsonForRegionLayer(config: FileLayer): Promise<unknown> {
    const url = await this.getUrlForRegionLayer(config);
    const response = await fetch(String(url));
    return response.json();
  }
}

let shared: ServiceSettings | undefined;

/** The page's one ServiceSettings, made from the server's `map.*` settings */
export function getServiceSettings(config: MapConfig, version: string): ServiceSettings {
  shared ??= new ServiceSettings(config, config.tilemap, version);
  return shared;
}

/* SPDX-License-Identifier: Apache-2.0 */

/*
 * A Vega or Vega-Lite spec as OpenSearch Dashboards reads it before drawing it: HJSON text, its
 * host settings under config.kibana, the colours of the product's theme as defaults, the size of
 * the panel, and its data fetched and put in place. What it finds wrong is an error or a warning
 * with the original's text, shown over the chart.
 */

import { SERIES_COLORS } from '../../charts/core';
import type { BoolQuery } from '../../lib/query';
import { parseHjson } from '../../lib/hjson';
import {
  EmsFileParser,
  OpenSearchQueryParser,
  PPLQueryParser,
  UrlParser,
  type MapsServiceSettings,
  type SpecObject,
  type TimeCache,
  type VegaSearchApi,
} from './data_parsers';
import type { VegaLibraries } from './library';
import { formatErrorToStr, formatWarningToStr, isEmpty, isPlainObject } from './utils';
import { validateVegaExpression } from './validation';

export interface TooltipConfig {
  position: 'top' | 'right' | 'bottom' | 'left';
  padding: number;
  centerOnMark: number;
}

export interface MapConfig {
  delayRepaint: boolean;
  latitude: number;
  longitude: number;
  zoom?: number;
  minZoom?: number;
  maxZoom?: number;
  mapStyle: 'default' | false;
  zoomControl: boolean;
  scrollWheelZoom: boolean;
  maxBounds?: number[];
}

/** The colours of the Atlas theme the original's Vega defaults are taken from */
const THEME_COLORS = {
  light: { text: '#1d1d1f', darkestShade: '#1d1d1f', darkShade: '#6e6e73', chartLines: '#e8e8ed' },
  dark: { text: '#f5f5f7', darkestShade: '#f5f5f7', darkShade: '#98989d', chartLines: '#2c2c2e' },
};

// One colour for a single series, as the other visualizations have
const DEFAULT_COLOR = SERIES_COLORS[0];

const LOCATION_TO_DIRECTION: Record<string, string> = {
  left: 'row-reverse',
  right: 'row',
  top: 'column-reverse',
  bottom: 'column',
};

// A url without "%type%" is a search
const DEFAULT_PARSER = 'opensearch';

/** The library and version a `$schema` address names, as vega-schema-url-parser reads it */
export function parseSchemaUrl(url: unknown): { library: string; version: string } {
  const match = /schema\/([\w-]+)\/([\w.-]+)\.json$/g.exec(String(url));
  if (!match) throw new TypeError("Cannot read properties of null (reading 'slice')");
  return { library: match[1], version: match[2] };
}

const SEMVER =
  /^v?(?:\d+)(\.(?:[x*]|\d+)(\.(?:[x*]|\d+)(\.(?:[x*]|\d+))?(?:-[\da-z-]+(?:\.[\da-z-]+)*)?(?:\+[\da-z-]+(?:\.[\da-z-]+)*)?)?)?$/i;

/** 1, 0 or -1 as one version is after, the same as or before another: compare-versions 3.5.1 */
export function compareVersions(v1: string, v2: string): number {
  for (const version of [v1, v2]) {
    if (typeof version !== 'string') throw new TypeError('Invalid argument expected string');
    if (!SEMVER.test(version)) throw new Error(`Invalid argument not valid semver ('${version}' received)`);
  }
  const split = (v: string) => {
    const c = v.replace(/^v/, '').replace(/\+.*$/, '');
    const patchIndex = c.indexOf('-') === -1 ? c.length : c.indexOf('-');
    const parts = c.substring(0, patchIndex).split('.');
    parts.push(c.substring(patchIndex + 1));
    return parts;
  };
  const tryParse = (v: string) => (Number.isNaN(Number(v)) ? v : Number(v));
  const s1 = split(v1);
  const s2 = split(v2);
  for (let i = 0; i < Math.max(s1.length - 1, s2.length - 1); i++) {
    const n1 = parseInt(s1[i] || '0', 10);
    const n2 = parseInt(s2[i] || '0', 10);
    if (n1 > n2) return 1;
    if (n2 > n1) return -1;
  }
  const sp1 = s1[s1.length - 1];
  const sp2 = s2[s2.length - 1];
  if (sp1 && sp2) {
    const p1 = sp1.split('.').map(tryParse);
    const p2 = sp2.split('.').map(tryParse);
    for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
      if (p1[i] === undefined || (typeof p2[i] === 'string' && typeof p1[i] === 'number')) return -1;
      if (p2[i] === undefined || (typeof p1[i] === 'string' && typeof p2[i] === 'number')) return 1;
      if (p1[i] > p2[i]) return 1;
      if (p2[i] > p1[i]) return -1;
    }
  } else if (sp1 || sp2) {
    return sp1 ? -1 : 1;
  }
  return 0;
}

export interface VegaParserDependencies {
  libraries: VegaLibraries;
  searchAPI: VegaSearchApi;
  timeCache: TimeCache;
  /** The page's query and filters as one boolean query: the %context% of a search */
  filters: BoolQuery;
  getServiceSettings: () => Promise<MapsServiceSettings>;
  dark: boolean;
}

interface UrlParsers {
  [type: string]: {
    parseUrl(dataObject: SpecObject, url: SpecObject): unknown;
    populateData(requests: never[]): unknown;
  };
}

export class VegaParser {
  spec: unknown;
  hideWarnings = false;
  restoreSignalValuesOnRefresh = false;
  error?: string;
  /** Each warning as the original keeps it: the list of what was said */
  warnings: unknown[] = [];
  isVegaLite?: boolean;
  useHover?: boolean;
  config: SpecObject = {};
  useMap?: boolean;
  renderer: 'svg' | 'canvas' = 'canvas';
  tooltips: false | TooltipConfig = false;
  mapConfig?: MapConfig;
  vlspec?: SpecObject;
  useResize?: boolean;
  containerDir?: string;
  controlsDir?: string;
  private urlParsers?: UrlParsers;

  constructor(
    spec: unknown,
    readonly dependencies: VegaParserDependencies
  ) {
    this.spec = spec;
  }

  get searchAPI() {
    return this.dependencies.searchAPI;
  }

  /** The spec as Vega draws it; an object once read */
  get vegaSpec(): SpecObject {
    return this.spec as SpecObject;
  }

  async parseAsync(): Promise<this> {
    try {
      await this.parse();
    } catch (failure) {
      this.error = formatErrorToStr(failure) as string;
    }
    return this;
  }

  private async parse() {
    if (this.isVegaLite !== undefined) throw new Error();
    if (typeof this.spec === 'string') {
      const spec = parseHjson(this.spec, { legacyRoot: false }) as SpecObject;
      if (!spec.$schema) {
        throw new Error(
          'Your specification requires a "$schema" field with a valid URL for\n' +
            'Vega (see https://vega.github.io/vega/docs/specification/#top-level-specification-properties) or\n' +
            'Vega-Lite (see https://vega.github.io/vega-lite/docs/spec.html#top-level).\n' +
            'The URL is an identifier only. OpenSearch Dashboards and your browser will never access this URL.'
        );
      }
      this.spec = spec;
    }
    if (!isPlainObject(this.spec)) throw new Error('Invalid Vega specification');

    const { vega } = this.dependencies.libraries;
    const results = validateVegaExpression(this.spec, (expression) => vega.parseExpression(expression));
    if (results.length > 0) {
      const reason = results.map((result) => `${result.reason} in "${result.expression}" at ${result.location}`).join('\n');
      throw new Error(`Unexpected Vega expression: ${reason}`);
    }

    this.isVegaLite = this.parseSchema(this.vegaSpec).isVegaLite;
    this.useHover = !this.isVegaLite;
    this.config = this.parseConfig();
    this.hideWarnings = Boolean(this.config.hideWarnings);
    this.parseBool('restoreSignalValuesOnRefresh', this.config, false);
    this.restoreSignalValuesOnRefresh = Boolean(this.config.restoreSignalValuesOnRefresh);
    this.useMap = this.config.type === 'map';
    this.renderer = this.config.renderer === 'svg' ? 'svg' : 'canvas';
    this.tooltips = this.parseTooltips();

    this.setDefaultColors();
    this.parseControlPlacement();
    if (this.useMap) {
      this.mapConfig = this.parseMapConfig();
      this.useResize = false;
    } else if (this.spec) {
      this.compileWithAutosize();
    }

    await this.resolveDataUrls();

    if (this.isVegaLite) this.compileVegaLite();
  }

  /** The spec fills its panel, unless its autosize says "none" */
  private compileWithAutosize() {
    const spec = this.vegaSpec;
    const defaultAutosize = { type: 'fit', contains: 'padding' };
    let autosize = spec.autosize as unknown;
    let useResize = true;

    // Vega's autosize may follow a signal: it is left alone
    if (!this.isVegaLite && autosize && typeof autosize === 'object' && 'signal' in autosize) return;

    if (!autosize && typeof autosize !== 'undefined') {
      this.onWarning('"autosize" is enabled, it can only be disabled by setting "autosize" to "none"');
    }
    if (typeof autosize === 'string') {
      useResize = autosize !== 'none';
      autosize = { ...defaultAutosize, type: autosize };
    } else if (typeof autosize === 'object') {
      const merged = { ...defaultAutosize, ...(autosize as SpecObject) };
      autosize = merged;
      useResize = Boolean(merged?.type && merged?.type !== 'none');
    } else {
      autosize = defaultAutosize;
    }

    if (useResize && ((spec.width && spec.width !== 'container') || (spec.height && spec.height !== 'container'))) {
      this.onWarning('"width" and "height" params are ignored because "autosize" is enabled. Set "autosize": "none" to disable');
    }
    if (useResize) {
      spec.width = 'container';
      spec.height = 'container';
    }
    spec.autosize = autosize;
    this.useResize = useResize;
  }

  /** Vega-Lite as the Vega it compiles to */
  private compileVegaLite() {
    const { vega, vegaLite } = this.dependencies.libraries;
    this.vlspec = this.vegaSpec;
    const logger = vega.logger(vega.Warn);
    logger.warn = this.onWarning.bind(this);
    // The logger goes where Vega-Lite reads its options, as in the original
    this.spec = vegaLite.compile(this.vlspec, logger).spec;
    const spec = this.vegaSpec;
    const vlspec = this.vlspec;

    // A map's projection and size are the map layer's, unless the spec set them
    if (this.useMap) {
      const hasConfig = isPlainObject(vlspec.config);
      const vlConfig = (vlspec.config ?? {}) as SpecObject;
      if (vlspec.config === undefined || (hasConfig && !vlConfig.projection)) {
        const projections = spec.projections as Array<{ name?: string }> | undefined;
        if (!Array.isArray(projections) || projections.length !== 1 || projections[0].name !== 'projection') {
          throw new Error('Internal error: Vega-Lite compiler should have generated a single projection object');
        }
        delete spec.projections;
      }
      if (!vlspec.width) delete spec.width;
      if (!vlspec.height) delete spec.height;
      if (!vlspec.padding && (vlspec.config === undefined || (hasConfig && !vlConfig.padding))) delete spec.padding;
      if (!vlspec.autosize && (vlspec.config === undefined || (hasConfig && !vlConfig.autosize))) delete spec.autosize;
    }

    // config.kibana.signals: signals on the events of a mark, by the mark's style
    const signalsByMark = this.config.signals;
    if (signalsByMark) {
      for (const [markId, signals] of Object.entries(signalsByMark as Record<string, Array<{ on?: Array<{ events: string }> }>>)) {
        const mark = this.getMarkWithStyle(spec.marks, markId);
        if (mark) {
          for (const signal of signals) {
            signal.on?.forEach((eventObj) => {
              eventObj.events = `@${String(mark.name)}:${eventObj.events}`;
            });
          }
          spec.signals = ((spec.signals as unknown[]) || []).concat(signals);
        }
      }
    }
  }

  /** The first mark, at any depth, whose style includes the one given */
  getMarkWithStyle(marks: unknown, style: string): SpecObject | undefined {
    if (!marks) return undefined;
    if (Array.isArray(marks)) {
      const found = marks.find((mark: SpecObject) => (mark.style as { includes(value: string): boolean } | undefined)?.includes(style));
      if (found) return found as SpecObject;
      for (const mark of marks as SpecObject[]) {
        const inner = this.getMarkWithStyle(mark.marks, style);
        if (inner) return inner;
      }
    }
    return undefined;
  }

  /** Where the controls of bound signals go, as a flex direction */
  private parseControlPlacement() {
    const location = this.config.controlsLocation as string | undefined;
    this.containerDir = location ? LOCATION_TO_DIRECTION[location] : undefined;
    if (this.containerDir === undefined) {
      if (this.config && location === undefined) {
        this.containerDir = 'column';
      } else {
        throw new Error(`Unrecognized controlsLocation value. Expecting one of ["${Object.keys(LOCATION_TO_DIRECTION).join('", "')}"]`);
      }
    }
    const dir = this.config.controlsDirection;
    if (dir !== undefined && dir !== 'horizontal' && dir !== 'vertical') {
      throw new Error('Unrecognized dir value. Expecting one of ["horizontal", "vertical"]');
    }
    this.controlsDir = dir === 'horizontal' ? 'row' : 'column';
  }

  /** The host settings: config.kibana, or the older _hostConfig at the root */
  private parseConfig(): SpecObject {
    let result: unknown = null;
    const spec = this.vegaSpec;
    if (spec) {
      if (spec._hostConfig !== undefined) {
        result = spec._hostConfig;
        delete spec._hostConfig;
        if (!isPlainObject(result)) throw new Error('If present, "_hostConfig" must be an object');
        this.onWarning('"_hostConfig" has been deprecated. Use config.kibana instead.');
      }
      if (isPlainObject(spec.config) && spec.config.kibana !== undefined) {
        result = spec.config.kibana;
        delete spec.config.kibana;
        if (!isPlainObject(result)) throw new Error('If present, config.kibana must be an object');
      }
    }
    return (result as SpecObject | null) || {};
  }

  private parseTooltips(): false | TooltipConfig {
    if (this.config && this.config.tooltips === false) return false;
    const result = (this.config.tooltips || {}) as Partial<Record<keyof TooltipConfig, unknown>>;
    if (result.position === undefined) {
      result.position = 'top';
    } else if (['top', 'right', 'bottom', 'left'].indexOf(result.position as string) === -1) {
      throw new Error('Unexpected value for the result.position configuration');
    }
    if (result.padding === undefined) {
      result.padding = 16;
    } else if (typeof result.padding !== 'number') {
      throw new Error('config.kibana.result.padding is expected to be a number');
    }
    if (result.centerOnMark === undefined) {
      // a mark smaller than this is pointed at by its middle
      result.centerOnMark = 50;
    } else if (typeof result.centerOnMark === 'boolean') {
      result.centerOnMark = result.centerOnMark ? Number.MAX_VALUE : -1;
    } else if (typeof result.centerOnMark !== 'number') {
      throw new Error('config.kibana.result.centerOnMark is expected to be true, false, or a number');
    }
    return result as TooltipConfig;
  }

  /** The settings of a map: where it starts, how far it zooms, its base layer and controls */
  private parseMapConfig(): MapConfig {
    const config = this.config;
    const res: SpecObject = { delayRepaint: config.delayRepaint === undefined ? true : config.delayRepaint };
    const validate = (name: string, isZoom: boolean) => {
      const value = config[name];
      if (value !== undefined) {
        const parsed = parseFloat(value as string);
        if (Number.isFinite(parsed) && (!isZoom || (parsed >= 0 && parsed <= 30))) {
          res[name] = parsed;
          return;
        }
        this.onWarning(`config.kibana.${name} is not valid`);
      }
      if (!isZoom) res[name] = 0;
    };
    validate('latitude', false);
    validate('longitude', false);
    validate('zoom', true);
    validate('minZoom', true);
    validate('maxZoom', true);

    // false is a style too: no base layer
    res.mapStyle = config.mapStyle === undefined ? 'default' : config.mapStyle;
    if (res.mapStyle !== 'default' && res.mapStyle !== false) {
      this.onWarning('config.kibana.mapStyle may either be false or "default"');
      res.mapStyle = 'default';
    }
    this.parseBool('zoomControl', res, true);
    this.parseBool('scrollWheelZoom', res, false);

    const maxBounds = config.maxBounds;
    if (maxBounds !== undefined) {
      if (!Array.isArray(maxBounds) || maxBounds.length !== 4 || !maxBounds.every((v) => typeof v === 'number' && Number.isFinite(v))) {
        this.onWarning('config.kibana.maxBounds must be an array with four numbers');
      } else {
        res.maxBounds = maxBounds;
      }
    }
    return res as unknown as MapConfig;
  }

  private parseBool(name: string, target: SpecObject, fallback: boolean | string | number) {
    const value = this.config ? this.config[name] : undefined;
    if (value === undefined) {
      target[name] = fallback;
    } else if (typeof value !== 'boolean') {
      this.onWarning(`config.kibana.${name} must be a boolean value`);
      target[name] = fallback;
    } else {
      target[name] = value;
    }
  }

  /** Whether the spec is Vega-Lite, with a warning when it was written for a later version */
  private parseSchema(spec: SpecObject) {
    const { vega, vegaLite } = this.dependencies.libraries;
    const schema = parseSchemaUrl(spec.$schema);
    const isVegaLite = schema.library === 'vega-lite';
    const libVersion = isVegaLite ? vegaLite.version : vega.version;
    if (compareVersions(schema.version, libVersion) > 0) {
      this.onWarning(
        `The input spec uses ${schema.library} ${schema.version}, but current version of ${schema.library} is ${libVersion}.`
      );
    }
    return { isVegaLite, libVersion };
  }

  /** Every `"url": {…}` of the spec's data as the values it asks for */
  private async resolveDataUrls() {
    if (!this.urlParsers) {
      const serviceSettings = await this.dependencies.getServiceSettings();
      const onWarn = this.onWarning.bind(this);
      const { timeCache, searchAPI, filters } = this.dependencies;
      this.urlParsers = {
        opensearch: new OpenSearchQueryParser(timeCache, searchAPI, filters, onWarn),
        emsfile: new EmsFileParser(serviceSettings),
        url: new UrlParser(onWarn),
        ppl: new PPLQueryParser(timeCache, searchAPI),
      } as unknown as UrlParsers;
    }
    const parsers = this.urlParsers;
    const pending: Record<string, unknown[]> = {};
    this.searchAPI.resetSearchStats();

    this.findObjectDataUrls(this.spec, (obj) => {
      const url = obj.url as SpecObject;
      delete obj.url;
      let type = url['%type%'] as string | undefined;
      delete url['%type%'];
      if (type === undefined) type = DEFAULT_PARSER;
      const parser = parsers[type];
      if (parser === undefined) throw new Error(`url: {"%type%": "${type}"} is not supported`);
      let list = pending[type];
      if (list === undefined) pending[type] = list = [];
      list.push(parser.parseUrl(obj, url));
    });

    const types = Object.keys(pending);
    if (types.length > 0) {
      // each reader fetches its data alongside the others
      await Promise.all(types.map((type) => parsers[type].populateData(pending[type] as never[])));
    }
  }

  /** Calls `onFind` with every data object whose `url` is an object without a signal */
  private findObjectDataUrls(obj: unknown, onFind: (data: SpecObject) => void, key?: string) {
    if (Array.isArray(obj)) {
      for (const element of obj) this.findObjectDataUrls(element, onFind, key);
    } else if (isPlainObject(obj)) {
      if (key === 'data' && isPlainObject(obj.url) && isEmpty(obj.url.signal)) {
        if (obj.values !== undefined || obj.source !== undefined) {
          throw new Error('Data must not have more than one of "url", "values", and "source"');
        }
        onFind(obj);
      } else {
        for (const k of Object.keys(obj)) this.findObjectDataUrls(obj[k], onFind, k);
      }
    }
  }

  /** The theme's colours where the spec sets none */
  private setDefaultColors() {
    const theme = this.dependencies.dark ? THEME_COLORS.dark : THEME_COLORS.light;
    this.setDefaultValue([...SERIES_COLORS], 'config', 'range', 'category');
    if (this.isVegaLite) {
      // one colour for fills and strokes
      this.setDefaultValue(DEFAULT_COLOR, 'config', 'mark', 'color');
      this.setDefaultValue(theme.text, 'config', 'text', 'fill');
    } else {
      // Vega's mark config behaves oddly: each kind of mark is given its colour
      const mark = (this.vegaSpec.config as SpecObject).mark as SpecObject | undefined;
      if (!mark || (mark.color === undefined && mark.fill === undefined)) {
        this.setDefaultValue(DEFAULT_COLOR, 'config', 'arc', 'fill');
        this.setDefaultValue(DEFAULT_COLOR, 'config', 'area', 'fill');
        this.setDefaultValue(DEFAULT_COLOR, 'config', 'line', 'stroke');
        this.setDefaultValue(DEFAULT_COLOR, 'config', 'path', 'stroke');
        this.setDefaultValue(DEFAULT_COLOR, 'config', 'rect', 'fill');
        this.setDefaultValue(DEFAULT_COLOR, 'config', 'rule', 'stroke');
        this.setDefaultValue(DEFAULT_COLOR, 'config', 'shape', 'stroke');
        this.setDefaultValue(DEFAULT_COLOR, 'config', 'symbol', 'fill');
        this.setDefaultValue(theme.text, 'config', 'text', 'fill');
        this.setDefaultValue(DEFAULT_COLOR, 'config', 'trail', 'fill');
      }
    }
    // colours of the light or dark theme
    this.setDefaultValue(theme.darkestShade, 'config', 'title', 'color');
    this.setDefaultValue(theme.darkShade, 'config', 'style', 'guide-label', 'fill');
    this.setDefaultValue(theme.darkestShade, 'config', 'style', 'guide-title', 'fill');
    this.setDefaultValue(theme.darkestShade, 'config', 'style', 'group-title', 'fill');
    this.setDefaultValue(theme.darkestShade, 'config', 'style', 'group-subtitle', 'fill');
    this.setDefaultValue(theme.chartLines, 'config', 'axis', 'tickColor');
    this.setDefaultValue(theme.chartLines, 'config', 'axis', 'domainColor');
    this.setDefaultValue(theme.chartLines, 'config', 'axis', 'gridColor');
    this.setDefaultValue('transparent', 'config', 'background');
  }

  /** Sets spec.a.b.c to the value unless it is set, making the objects on the way */
  private setDefaultValue(value: unknown, ...fields: string[]) {
    let o = this.vegaSpec;
    for (let i = 0; i < fields.length - 1; i++) {
      const field = fields[i];
      const sub = o[field];
      if (sub === undefined) o[field] = {};
      else if (!isPlainObject(sub)) return;
      o = o[field] as SpecObject;
    }
    const last = fields[fields.length - 1];
    if (o[last] === undefined) o[last] = value;
  }

  /** A warning, kept to be shown over the chart unless the spec hides them */
  onWarning(...args: unknown[]): unknown {
    if (!this.hideWarnings) {
      // the original passes the list of what was said as one value
      this.warnings.push(formatWarningToStr(args));
      return formatWarningToStr(args);
    }
    return undefined;
  }
}

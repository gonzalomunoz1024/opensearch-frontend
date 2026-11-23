/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The data a spec asks for with `"url": {…}`: an OpenSearch search (the default), a PPL query,
 * a file of the maps service or a plain address. Each reader turns its `url` objects into
 * requests, runs them together and puts the answers in the spec as `values`, with the keywords
 * of OpenSearch Dashboards (%context%, %timefield%, %timefilter%, %autointerval% and the
 * %dashboard_context-…% clauses) worked out as the original works them out, with its messages.
 */

import { buildQuery, type BoolQuery, type QueryConfig } from '../../lib/query';
import type { Filter, Query } from '../../lib/types';
import { contextFilters, uniqueQueries } from '../request';
import { isPlainObject } from './utils';

export type SpecObject = Record<string, unknown>;

/**
 * The page's queries and filters as one boolean query: what %context% and the dashboard clauses
 * stand for, as the original's request handler builds it. An empty query in the query language is
 * one match_all among the filter clauses, as the original parses it. A query or a filter that
 * repeats an earlier one asks once (the context's uniqBy and uniqFilters).
 */
export function contextQuery(queries: Array<Query | undefined>, filters: Filter[], config: QueryConfig): BoolQuery {
  return buildQuery(undefined, uniqueQueries(queries), contextFilters(filters), config);
}

/**
 * A search's answer as the original's search route hands it on (shimHitsTotal): the total of hits
 * a number, where OpenSearch answers { value, relation }
 */
export function shimHitsTotal<T extends { hits?: unknown }>(response: T): T {
  const hits = response.hits as { total?: unknown } | undefined;
  const total = (hits?.total as { value?: unknown } | null | undefined)?.value ?? hits?.total;
  return { ...response, hits: { ...hits, total } };
}

/** A data object of the spec, and its `url` taken out of it */
export interface DataRequest {
  dataObject: SpecObject;
  url: SpecObject;
}

export interface VegaSearchRequest extends SpecObject {
  name: string;
}

export interface VegaSearchResult {
  name: string;
  rawResponse: unknown;
}

/** The searches of a spec, as the visualization makes them and records them for Inspect */
export interface VegaSearchApi {
  search(requests: VegaSearchRequest[], options?: { strategy?: string }): Promise<VegaSearchResult[]>;
  resetSearchStats(): void;
}

export interface TimeBounds {
  min: number;
  max: number;
}

// Asked again within this many milliseconds, the bounds are those of the last time
const ALWAYS_CACHE_MAX_AGE = 40;

/**
 * The bounds of the time range, kept for a while so that the searches of one spec, and of one
 * refresh, ask for the same range
 */
export class TimeCache {
  private cachedBounds?: TimeBounds;
  private cacheTS = 0;
  timeRange?: unknown;

  constructor(
    private readonly calculateBounds: () => TimeBounds,
    private readonly maxAge: number
  ) {}

  now(): number {
    return Date.now();
  }

  getTimeBounds(): TimeBounds {
    const ts = this.now();
    let bounds: TimeBounds | null = null;
    if (this.cachedBounds) {
      const diff = ts - this.cacheTS;
      if (diff < ALWAYS_CACHE_MAX_AGE) return this.cachedBounds;
      // a relative range that moved less than the age kept: the same searches as before
      if (diff < this.maxAge) {
        bounds = this.calculateBounds();
        if (Math.abs(bounds.min - this.cachedBounds.min) < this.maxAge && Math.abs(bounds.max - this.cachedBounds.max) < this.maxAge) {
          return this.cachedBounds;
        }
      }
    }
    this.cacheTS = ts;
    this.cachedBounds = bounds || this.calculateBounds();
    return this.cachedBounds;
  }

  setTimeRange(timeRange: unknown) {
    this.timeRange = timeRange;
  }
}

const requestName = (request: DataRequest, index: number): string =>
  (request.dataObject.name as string | undefined) || `Unnamed request #${index}`;

const TIMEFILTER = '%timefilter%';
const AUTOINTERVAL = '%autointerval%';
const MUST_CLAUSE = '%dashboard_context-must_clause%';
const MUST_NOT_CLAUSE = '%dashboard_context-must_not_clause%';
const FILTER_CLAUSE = '%dashboard_context-filter_clause%';
const LEGACY_CONTEXT = '%context_query%';
const CONTEXT = '%context%';
const TIMEFIELD = '%timefield%';

/** Searches of OpenSearch, with the page's query, filters and time range worked in */
export class OpenSearchQueryParser {
  constructor(
    private readonly timeCache: TimeCache,
    private readonly searchAPI: VegaSearchApi,
    private readonly filters: BoolQuery,
    private readonly onWarning: (...args: unknown[]) => unknown
  ) {}

  parseUrl(dataObject: SpecObject, url: SpecObject): DataRequest {
    let body = url.body as SpecObject | undefined;
    let context = url[CONTEXT];
    delete url[CONTEXT];
    let timefield = url[TIMEFIELD];
    delete url[TIMEFIELD];
    let usesContext = context !== undefined || timefield !== undefined;

    if (body === undefined) {
      url.body = body = {};
    } else if (!isPlainObject(body)) {
      throw new Error('url.body must be an object');
    }

    // The legacy %context_query% becomes %context% and %timefield%
    const legacyContext = url[LEGACY_CONTEXT];
    delete url[LEGACY_CONTEXT];
    if (legacyContext !== undefined) {
      if (body.query !== undefined) {
        throw new Error('"data.url" must not have legacy "%context_query%" and "body.query" values at the same time');
      } else if (usesContext) {
        throw new Error('"data.url" must not have "%context_query%" together with "%context%" or "%timefield%"');
      } else if (legacyContext !== true && (typeof legacyContext !== 'string' || legacyContext.length === 0)) {
        throw new Error(
          'Legacy "%context_query%" can either be true (ignores time range picker), or it can be the name of the time field, e.g. "@timestamp"'
        );
      }
      usesContext = true;
      context = true;
      let result = `"url": {"${CONTEXT}": true`;
      if (typeof legacyContext === 'string') {
        timefield = legacyContext;
        result += `, "${TIMEFIELD}": ${JSON.stringify(timefield)}`;
      }
      result += '}';
      this.onWarning(`Legacy "url": "${LEGACY_CONTEXT}": ${JSON.stringify(legacyContext)} should change to ${result}`);
    }

    if (body.query !== undefined) {
      if (usesContext) throw new Error('url.%context% and url.%timefield% must not be used when url.body.query is set');
      this.injectContextVars(body.query, true);
    } else if (usesContext) {
      if (timefield) {
        // the time range, as a range of the time field
        body.query = { range: { [String(timefield)]: this.createRangeFilter({ [TIMEFILTER]: true }) } };
      }
      if (context) {
        // the page's query and filters
        const newQuery = structuredClone(this.filters) as BoolQuery & { type?: string };
        if (timefield && newQuery.type !== 'unsupported') newQuery.bool.must.push(body.query as Record<string, unknown>);
        body.query = newQuery;
      }
    }
    this.injectContextVars(body.aggs, false);
    return { dataObject, url };
  }

  async populateData(requests: DataRequest[]) {
    const searches = requests.map((request, index) => ({ ...request.url, name: requestName(request, index) }));
    const results = await this.searchAPI.search(searches);
    results.forEach((data, index) => {
      const request = requests.find((item) => requestName(item, index) === data.name);
      if (request) {
        request.dataObject.url = request.url;
        request.dataObject.values = data.rawResponse;
      }
    });
  }

  /** Works out the keywords of a request: in its query, the clauses of the page's context */
  injectContextVars(obj: unknown, isQuery: boolean) {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) {
      for (let pos = 0; pos < obj.length; ) {
        const item: unknown = obj[pos];
        if (isQuery && (item === FILTER_CLAUSE || item === MUST_CLAUSE || item === MUST_NOT_CLAUSE)) {
          const tag = item === FILTER_CLAUSE ? 'filter' : item === MUST_CLAUSE ? 'must' : 'must_not';
          const ctx = structuredClone(this.filters) as { bool?: Record<string, unknown> };
          const clause = ctx?.bool?.[tag];
          if (clause) {
            if (Array.isArray(clause)) {
              // one keyword, the clauses of the context in its place
              obj.splice(pos, 1, ...(clause as unknown[]));
              pos += clause.length;
            } else {
              obj[pos++] = clause;
            }
          } else {
            obj.splice(pos, 1);
          }
        } else {
          this.injectContextVars(item, isQuery);
          pos++;
        }
      }
      return;
    }
    const record = obj as SpecObject;
    for (const prop of Object.keys(record)) {
      const subObj = record[prop] as SpecObject | undefined;
      if (!subObj || typeof obj !== 'object') continue;

      // "interval": {"%autointerval%": true|number} as an interval that fits the time range
      if (prop === 'interval' && subObj[AUTOINTERVAL]) {
        let size = subObj[AUTOINTERVAL];
        if (size === true) size = 50;
        else if (typeof size !== 'number') throw new Error('"%autointerval%" must be either true or a number');
        const bounds = this.timeCache.getTimeBounds();
        record.interval = roundInterval((bounds.max - bounds.min) / (size as number));
        continue;
      }

      switch (subObj[TIMEFILTER]) {
        case 'min':
        case 'max':
          // {"%timefilter%": "min|max"} as a time
          record[prop] = this.getTimeBound(subObj, subObj[TIMEFILTER] as 'min' | 'max');
          continue;
        case true:
          // {"%timefilter%": true} as the range of the time range
          this.createRangeFilter(subObj);
          continue;
        case undefined:
          this.injectContextVars(subObj, isQuery);
          continue;
        default:
          throw new Error('"%timefilter%" property must be set to true, "min", or "max"');
      }
    }
  }

  createRangeFilter(obj: SpecObject): SpecObject {
    obj.gte = new Date(this.getTimeBound(obj, 'min')).toISOString();
    obj.lte = new Date(this.getTimeBound(obj, 'max')).toISOString();
    obj.format = 'strict_date_optional_time';
    delete obj[TIMEFILTER];
    delete obj.shift;
    delete obj.unit;
    return obj;
  }

  getTimeBound(opts: SpecObject, type: 'min' | 'max'): number {
    const bounds = this.timeCache.getTimeBounds();
    let result = bounds[type]?.valueOf() || 0;
    if (opts.shift) {
      const shift = opts.shift;
      if (typeof shift !== 'number') throw new Error('"shift" must be a numeric value');
      let multiplier: number;
      switch (opts.unit || 'd') {
        case 'w':
        case 'week':
          multiplier = 1000 * 60 * 60 * 24 * 7;
          break;
        case 'd':
        case 'day':
          multiplier = 1000 * 60 * 60 * 24;
          break;
        case 'h':
        case 'hour':
          multiplier = 1000 * 60 * 60;
          break;
        case 'm':
        case 'minute':
          multiplier = 1000 * 60;
          break;
        case 's':
        case 'second':
          multiplier = 1000;
          break;
        default:
          throw new Error('Unknown "unit" value. Must be one of: ["week", "day", "hour", "minute", "second"]');
      }
      result += shift * multiplier;
    }
    return result;
  }
}

/** An interval in milliseconds as the round interval of a date histogram */
export function roundInterval(interval: number): string {
  if (interval <= 500) return '100ms';
  if (interval <= 5000) return '1s';
  if (interval <= 7500) return '5s';
  if (interval <= 15000) return '10s';
  if (interval <= 45000) return '30s';
  if (interval <= 180000) return '1m';
  if (interval <= 450000) return '5m';
  if (interval <= 1200000) return '10m';
  if (interval <= 2700000) return '30m';
  if (interval <= 7200000) return '1h';
  if (interval <= 21600000) return '3h';
  if (interval <= 86400000) return '12h';
  if (interval <= 604800000) return '24h';
  if (interval <= 1814400000) return '1w';
  if (interval < 3628800000) return '30d';
  return '1y';
}

/** The parameters of an address as jQuery's param writes them: `a[b]=c`, `list[]=1` */
export function queryParams(params: unknown): string {
  const parts: string[] = [];
  const add = (key: string, value: unknown) => {
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value === null || value === undefined ? '' : String(value))}`);
  };
  const build = (prefix: string, obj: unknown) => {
    if (Array.isArray(obj)) {
      obj.forEach((item: unknown, index) => {
        if (/\[\]$/.test(prefix)) add(prefix, item);
        else build(`${prefix}[${typeof item === 'object' && item !== null ? index : ''}]`, item);
      });
    } else if (obj !== null && typeof obj === 'object') {
      for (const name of Object.keys(obj)) build(`${prefix}[${name}]`, (obj as SpecObject)[name]);
    } else {
      add(prefix, obj);
    }
  };
  if (params === null || params === undefined) return '';
  if (Array.isArray(params)) {
    for (const item of params as Array<{ name?: unknown; value?: unknown }>) add(String(item?.name), item?.value);
  } else if (typeof params === 'object') {
    for (const prefix of Object.keys(params)) build(prefix, (params as SpecObject)[prefix]);
  }
  return parts.join('&');
}

/** A plain address, with its `query` as parameters; Vega loads it, if loading addresses is allowed */
export class UrlParser {
  constructor(private readonly onWarning: (...args: unknown[]) => unknown) {}

  parseUrl(obj: SpecObject, urlObj: SpecObject): undefined {
    let url = urlObj.url as string | undefined;
    if (!url) throw new Error('"data.url" requires a "url" parameter in a form "https://example.org/path/subpath"');
    const query = urlObj.query;
    if (!query) {
      this.onWarning('Using a "url": {"%type%": "url", "url": ...} should have a "query" sub-object');
    } else {
      url += (url.includes('?') ? '&' : '?') + queryParams(query);
    }
    obj.url = url;
    return undefined;
  }

  populateData() {
    // the address is in place already
  }
}

const pad = (value: number, width = 2) => String(value).padStart(width, '0');

/** A time as PPL compares it: `2026-11-22 18:00:00.000`, in UTC */
export function pplTime(ms: number): string {
  const date = new Date(ms);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(
    date.getUTCMinutes()
  )}:${pad(date.getUTCSeconds())}.${pad(date.getUTCMilliseconds(), 3)}`;
}

/** PPL queries, with the time range as a `where` after the source */
export class PPLQueryParser {
  constructor(
    private readonly timeCache: TimeCache,
    private readonly searchAPI: VegaSearchApi
  ) {}

  injectTimeFilter(query: string, timefield: string): string {
    if (this.timeCache.timeRange) {
      const [source, ...others] = query.split('|');
      const bounds = this.timeCache.getTimeBounds();
      const timeFilter = `where \`${timefield}\` >= '${pplTime(bounds.min)}' and \`${timefield}\` <= '${pplTime(bounds.max)}'`;
      if (others.length > 0) return `${source.trim()} | ${timeFilter} | ${others.map((part) => part.trim()).join(' | ')}`;
      return `${source.trim()} | ${timeFilter}`;
    }
    return query;
  }

  parseUrl(dataObject: SpecObject, url: SpecObject): DataRequest {
    const timefield = url[TIMEFIELD];
    delete url[TIMEFIELD];
    const body = url.body as SpecObject | undefined;
    if (!body || !body.query || typeof body.query !== 'string') throw new Error('"data.url" must have query specified');
    if (timefield) body.query = this.injectTimeFilter(body.query, String(timefield));
    return { dataObject, url };
  }

  async populateData(requests: DataRequest[]) {
    const searches = requests.map((request, index) => ({ ...request.url, name: requestName(request, index) }));
    const results = await this.searchAPI.search(searches, { strategy: 'pplraw' });
    results.forEach((data, index) => {
      const request = requests.find((item) => requestName(item, index) === data.name);
      if (request) {
        request.dataObject.url = request.url;
        request.dataObject.values = (data.rawResponse as { jsonData?: unknown }).jsonData;
      }
    });
  }
}

export interface FileLayer {
  name: string;
}

/** The maps service: its region files, and the address of one */
export interface MapsServiceSettings {
  getFileLayers(): Promise<FileLayer[]>;
  getUrlForRegionLayer(layer: FileLayer): Promise<string | undefined>;
}

/** An address that the check of addresses lets through: the maps service's own */
export interface TrustedUrl {
  url: string | undefined;
  bypassToken: symbol;
}

export const BYPASS_TOKEN = Symbol('vega url bypass');

/** A file of the maps service, by its name */
export class EmsFileParser {
  private fileLayers?: Promise<FileLayer[]>;

  constructor(private readonly serviceSettings: MapsServiceSettings) {}

  parseUrl(obj: SpecObject, url: SpecObject) {
    if (typeof url.name !== 'string') {
      throw new Error('"data.url" with {"%type%": "emsfile"} requires "name" parameter (name of the file)');
    }
    // asked as soon as it is known to be needed
    this.fileLayers ??= this.serviceSettings.getFileLayers();
    return { obj, name: url.name };
  }

  async populateData(requests: Array<{ obj: SpecObject; name: string }>) {
    if (requests.length === 0) return;
    const layers = await this.fileLayers;
    for (const { obj, name } of requests) {
      const found = layers?.find((layer) => layer.name === name);
      if (!found) throw new Error(`emsfile ${JSON.stringify(name)} does not exist`);
      const address = await this.serviceSettings.getUrlForRegionLayer(found);
      const trusted: TrustedUrl = { url: address, bypassToken: BYPASS_TOKEN };
      obj.url = trusted;
    }
  }
}

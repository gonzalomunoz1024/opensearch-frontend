/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The server side of Timeline: its functions under every name and alias, and the routes of
 * OpenSearch Dashboards' plugin with their paths and answers:
 *
 *   POST /api/timeline/run                 { sheet, extended?, time? } -> { sheet, stats }
 *   GET  /api/timeline/functions           every function, sorted by name
 *   GET  /api/timeline/validate/opensearch whether the default time field holds dates
 *                                          (also under /api/timeline/validate/es)
 */

import { chainRunner, type RunRequest } from './chain_runner';
import { withAliases } from './classes';
import { createTlConfig, getNamespacedSettings } from './lib';
import * as arithmetic from './series_functions/arithmetic';
import { opensearch } from './series_functions/opensearch';
import * as presentation from './series_functions/presentation';
import * as smoothing from './series_functions/smoothing';
import * as sources from './series_functions/sources';
import type { IndexPatternFinder, SearchRequest, SearchResponse, TimelineFunctionLike, TlConfig } from './types';
import { defaults, isPlainObject } from './util';
import type { Config } from '../config';
import { badRequest, errorBody, type Reply, type Router } from '../http';
import type { Logger } from '../logger';
import { OpenSearchError, type OpenSearchClient } from '../opensearch';
import type { SavedObjectsRepository } from '../saved_objects';
import type { UiSettings } from '../ui_settings';

/** The name each function is loaded under: its file's or directory's name upstream */
const BY_FILE: Array<[string, TimelineFunctionLike]> = [
  ['abs', arithmetic.abs],
  ['bars', presentation.bars],
  ['color', presentation.color],
  ['condition', arithmetic.condition],
  ['cusum', arithmetic.cusum],
  ['derivative', arithmetic.derivative],
  ['divide', arithmetic.divide],
  ['first', arithmetic.first],
  ['fit', arithmetic.fit],
  ['graphite', sources.graphite],
  ['hide', presentation.hide],
  ['label', presentation.label],
  ['legend', presentation.legend],
  ['lines', presentation.lines],
  ['log', arithmetic.log],
  ['max', arithmetic.max],
  ['min', arithmetic.min],
  ['movingaverage', smoothing.movingaverage],
  ['movingstd', smoothing.movingstd],
  ['multiply', arithmetic.multiply],
  ['points', presentation.points],
  ['precision', arithmetic.precision],
  ['props', presentation.props],
  ['quandl', sources.quandl],
  ['range', arithmetic.range],
  ['scale_interval', arithmetic.scaleInterval],
  ['static', sources.staticFn],
  ['subtract', arithmetic.subtract],
  ['sum', arithmetic.sum],
  ['title', presentation.title],
  ['trim', arithmetic.trim],
  ['worldbank', sources.worldbank],
  ['worldbank_indicators', sources.worldbankIndicators],
  ['yaxis', presentation.yaxis],
  ['aggregate', arithmetic.aggregate],
  ['holt', smoothing.holt],
  ['opensearch', opensearch],
  ['trend', smoothing.trend],
];

/** `load_functions('series_functions')`: each function, then its aliases over the names */
export function loadFunctions(): Record<string, TimelineFunctionLike> {
  const functions: Record<string, TimelineFunctionLike> = Object.fromEntries(BY_FILE);
  for (const key of Object.keys(functions)) Object.assign(functions, withAliases(functions[key]));
  return functions;
}

export const functions = loadFunctions();

export function getFunction(name: string): TimelineFunctionLike {
  if (Object.prototype.hasOwnProperty.call(functions, name)) {
    return functions[name];
  }
  throw new Error(`No such function: ${name}`);
}

/** The answer of /api/timeline/functions: each function with the name it is under */
export function functionList(): Array<Record<string, unknown>> {
  const list = Object.keys(functions).map((key) => ({ ...functions[key], name: key }));
  return list.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** The settings Timeline registers, with their defaults, and those of others it reads */
export const TIMELINE_SETTING_DEFAULTS: Record<string, unknown> = {
  'timeline:es.timefield': '@timestamp',
  'timeline:es.default_index': '_all',
  'timeline:target_buckets': 200,
  'timeline:max_buckets': 2000,
  'timeline:min_interval': '1ms',
  // The first of `vis_type_timeline.graphiteAllowedUrls`, of which this product has none
  'timeline:graphite.url': null,
  'timeline:quandl.key': 'someKeyHere',
  'search:includeFrozen': false,
  'courier:maxConcurrentShardRequests': 0,
};

/** OpenSearch Dashboards' `opensearch.shardTimeout` */
const SHARD_TIMEOUT_MS = 30000;

export interface TimelineOptions {
  client: OpenSearchClient;
  repository: Pick<SavedObjectsRepository, 'find'>;
  uiSettings: Pick<UiSettings, 'getAll'>;
  config?: Pick<Config, 'uiSettings'>;
  logger?: Pick<Logger, 'error'>;
  /** `vis_type_timeline.graphiteAllowedUrls` and `graphiteBlockedIPs`; none by default */
  graphiteAllowedUrls?: string[];
  graphiteBlockedIPs?: string[];
  shardTimeout?: number;
}

/** What `uiSettings.client.getAll()` gives: every value, set or default */
async function allSettings(options: TimelineOptions): Promise<Record<string, unknown>> {
  const values: Record<string, unknown> = {
    ...TIMELINE_SETTING_DEFAULTS,
    ...options.config?.uiSettings.defaults,
  };
  const stored = await options.uiSettings.getAll();
  for (const [key, setting] of Object.entries(stored)) {
    if ('userValue' in setting) values[key] = setting.userValue;
  }
  return values;
}

/** The message of the OpenSearch client's ResponseError, which OpenSearch Dashboards passes on */
function responseErrorMessage(body: unknown): string {
  const error = (body as { error?: { type?: string; root_cause?: unknown } } | undefined)?.error;
  if (error && typeof error === 'object' && error.type) {
    if (Array.isArray(error.root_cause)) {
      return (
        error.type +
        ': ' +
        error.root_cause
          .map((entry: { type?: string; reason?: string }) => `[${entry.type}] Reason: ${entry.reason}`)
          .join('; ')
      );
    }
    return error.type;
  }
  return 'Response Error';
}

export class ResponseError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly body: unknown
  ) {
    super(responseErrorMessage(body));
    this.name = 'ResponseError';
  }
}

/** The data plugin's search strategy: its default parameters, then the request's own */
export function searchWith(client: OpenSearchClient, settings: Record<string, unknown>) {
  return async (request: SearchRequest): Promise<SearchResponse> => {
    const { index, body, ...params } = request.params;
    const maxConcurrentShardRequests = Number(settings['courier:maxConcurrentShardRequests']);
    const query: Record<string, string | number | boolean | undefined> = {
      max_concurrent_shard_requests:
        maxConcurrentShardRequests > 0 ? maxConcurrentShardRequests : undefined,
      ignore_unavailable: true,
      track_total_hits: true,
      timeout: `${SHARD_TIMEOUT_MS}ms`,
      ...params,
    };
    const path =
      index === undefined || index === null ? '/_search' : `/${encodeURIComponent(index)}/_search`;
    try {
      return await client.request<SearchResponse>({ method: 'POST', path, query, body });
    } catch (error) {
      if (error instanceof OpenSearchError) throw new ResponseError(error.status, error.body);
      throw error;
    }
  };
}

// --- Validation of the body of /api/timeline/run, with the messages of @osd/config-schema --------

function typeName(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'Array';
  if (typeof value === 'object') return 'Object';
  return typeof value;
}

const expectedObject = (path: string, value: unknown) =>
  badRequest(`[${path}]: expected a plain object value, but found [${typeName(value)}] instead.`);
const expectedType = (path: string, type: string, value: unknown) =>
  badRequest(`[${path}]: expected value of type [${type}] but got [${typeName(value)}]`);

function checkKeys(path: string, value: Record<string, unknown>, known: string[]) {
  for (const key of Object.keys(value)) {
    if (!known.includes(key)) throw badRequest(`[${path}.${key}]: definition for this key is missing`);
  }
}

function checkObject(path: string, value: unknown): Record<string, unknown> {
  if (!isPlainObject(value)) throw expectedObject(path, value);
  return value;
}

/** Checks the body as the route's schema does, filling in what its defaults fill in */
export function validateRunBody(body: unknown): RunRequest {
  const root = 'request body';
  const request = checkObject(root, body === undefined ? {} : body);
  checkKeys(root, request, ['sheet', 'extended', 'time']);

  if (!Array.isArray(request.sheet)) throw expectedType(`${root}.sheet`, 'array', request.sheet);
  request.sheet.forEach((expression, index) => {
    if (typeof expression !== 'string') {
      throw expectedType(`${root}.sheet.${index}`, 'string', expression);
    }
  });

  if (request.extended !== undefined) {
    const extended = checkObject(`${root}.extended`, request.extended);
    checkKeys(`${root}.extended`, extended, ['es']);
    const es = checkObject(`${root}.extended.es`, extended.es ?? {});
    extended.es = es;
    checkKeys(`${root}.extended.es`, es, ['filter']);
    const filter = checkObject(`${root}.extended.es.filter`, es.filter ?? {});
    es.filter = filter;
    checkKeys(`${root}.extended.es.filter`, filter, ['bool']);
    const bool = checkObject(`${root}.extended.es.filter.bool`, filter.bool ?? {});
    filter.bool = bool;
    const clauses = ['filter', 'must', 'should', 'must_not'];
    checkKeys(`${root}.extended.es.filter.bool`, bool, clauses);
    for (const clause of clauses) {
      const path = `${root}.extended.es.filter.bool.${clause}`;
      const list = bool[clause];
      if (list === undefined) continue;
      if (!Array.isArray(list)) throw expectedType(path, 'array', list);
      list.forEach((item, index) => checkObject(`${path}.${index}`, item));
    }
  }

  if (request.time !== undefined) {
    const path = `${root}.time`;
    const time = checkObject(path, request.time);
    checkKeys(path, time, ['from', 'interval', 'timezone', 'to']);
    for (const key of ['from', 'interval', 'timezone', 'to']) {
      const value = time[key];
      const optional = key === 'from' || key === 'to';
      if ((value !== undefined || !optional) && typeof value !== 'string') {
        throw expectedType(`${path}.${key}`, 'string', value);
      }
    }
  }

  return request as unknown as RunRequest;
}

// --- The routes ---------------------------------------------------------------------------------

/** Runs a sheet as POST /api/timeline/run does, and gives the answer it would */
export async function runSheet(
  body: RunRequest,
  options: TimelineOptions & { savedObjectsClient?: IndexPatternFinder }
): Promise<Reply> {
  try {
    const uiSettings = await allSettings(options);
    // Just in case they delete some setting.
    const settings = defaults(uiSettings, getNamespacedSettings());

    const tlConfig: TlConfig = createTlConfig({
      request: { body },
      settings,
      getFunction,
      allowedGraphiteUrls: options.graphiteAllowedUrls ?? [],
      blockedGraphiteIPs: options.graphiteBlockedIPs ?? [],
      opensearchShardTimeout: options.shardTimeout ?? SHARD_TIMEOUT_MS,
      savedObjectsClient: options.savedObjectsClient ?? (options.repository as IndexPatternFinder),
      search: searchWith(options.client, settings),
    });
    const runner = chainRunner(tlConfig);
    const sheet = await Promise.all(await runner.processRequest(body));

    return {
      body: {
        sheet,
        stats: runner.getStats(),
      },
    };
  } catch (e) {
    const err = e as Error;
    options.logger?.error(`${String(err)}: ${err.stack}`);
    return {
      status: 500,
      body: errorBody(500, err.message, { title: err.name }),
    };
  }
}

/** Whether the default time field has dates, as GET /api/timeline/validate/opensearch says */
export async function validateOpenSearch(options: TimelineOptions): Promise<Reply> {
  const uiSettings = await allSettings(options);
  const timefield = uiSettings['timeline:es.timefield'];
  const search = searchWith(options.client, uiSettings);

  let resp: unknown;
  try {
    resp = await search({
      params: {
        // As upstream, which reads a setting that does not exist: the search covers every index
        index: uiSettings['es.default_index'] as string,
        ignore_throttled: !uiSettings['search:includeFrozen'],
        body: {
          aggs: {
            maxAgg: {
              max: {
                field: timefield,
              },
            },
            minAgg: {
              min: {
                field: timefield,
              },
            },
          },
          size: 0,
        },
      },
    });
  } catch (errResp) {
    resp =
      errResp instanceof ResponseError
        ? { name: errResp.name, meta: { body: errResp.body, statusCode: errResp.statusCode } }
        : errResp;
  }

  const aggregations = (resp as { aggregations?: Record<string, { value?: unknown }> } | undefined)
    ?.aggregations;
  const has = (name: string) =>
    !!aggregations &&
    typeof aggregations[name] === 'object' &&
    aggregations[name] !== null &&
    'value' in aggregations[name];
  if (has('maxAgg') && has('minAgg')) {
    return {
      body: {
        ok: true,
        field: timefield,
        min: aggregations?.minAgg.value,
        max: aggregations?.maxAgg.value,
      },
    };
  }

  return {
    body: {
      ok: false,
      resp,
    },
  };
}

export function registerTimeline(router: Router, options: TimelineOptions) {
  router.get('/api/timeline/functions', () => ({ body: functionList() }));

  router.post('/api/timeline/run', async (context) => {
    const body = validateRunBody(await context.json());
    return runSheet(body, options);
  });

  const validate = () => validateOpenSearch(options);
  router.get('/api/timeline/validate/opensearch', validate);
  router.get('/api/timeline/validate/es', validate);
}

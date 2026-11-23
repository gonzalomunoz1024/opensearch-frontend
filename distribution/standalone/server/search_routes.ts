/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The search route of the original's data plugin, `/internal/search/{strategy}/{id?}`
 * (src/plugins/data/server/search/routes/search.ts), with its two strategies of OpenSearch,
 * `opensearch` and `opensearch-with-long-numerals` (opensearch_search_strategy.ts), and `pplraw`,
 * the plain PPL query of the original's query_enhancements plugin (ppl_raw_search_strategy.ts).
 * The pages of this server search through /internal/opensearch; this is for what was written
 * against the original's API. The original's other strategies (`ppl`, `sql`, `pplasync`,
 * `sqlasync`, which answer data frames) are not here.
 */

import { HttpError, badRequest, errorBody, type Router } from './http';
import { legacyClientMessage } from './index_pattern_fields';
import { parseLongNumerals } from './json_numbers';
import { OpenSearchAnswerRefusedError, OpenSearchUnavailableError, type OpenSearchClient } from './opensearch';
import { object, validateRequestPart } from './route_validation';
import type { UiSettings } from './ui_settings';

const STRATEGIES: Record<string, { longNumerals: boolean; ppl?: boolean }> = {
  opensearch: { longNumerals: false },
  'opensearch-with-long-numerals': { longNumerals: true },
  pplraw: { longNumerals: false, ppl: true },
};

const BODY = object({}, { unknowns: 'allow' });

/** lodash's snakeCase, which the strategy writes the names of the parameters with */
export function snakeCase(name: string): string {
  const words = name.match(/[A-Z]{2,}(?=[A-Z][a-z]+[0-9]*|\b)|[A-Z]?[a-z]+[0-9]*|[A-Z]|[0-9]+/g) ?? [];
  return words.map((word) => word.toLowerCase()).join('_');
}

/** What opensearch-js makes of a failure of OpenSearch: its message (ResponseError) */
function responseErrorMessage(body: unknown): string {
  const error = (body as { error?: { type?: unknown; root_cause?: unknown } } | undefined)?.error;
  if (!error || typeof error !== 'object' || !error.type) return 'Response Error';
  if (!Array.isArray(error.root_cause)) return String(error.type);
  const causes = (error.root_cause as Array<{ type?: unknown; reason?: unknown }>).map(
    (entry) => `[${String(entry.type)}] Reason: ${String(entry.reason)}`
  );
  return `${String(error.type)}: ${causes.join('; ')}`;
}

/** The failure of a search, as the original's route answers it (customError) */
const searchFailure = (status: number | undefined, message: string, error: unknown) =>
  new HttpError(status ?? 500, message, { error });

/** What the client threw (no connection, no answer in time, an answer too large): 500 with its words */
function clientFailure(error: unknown): unknown {
  if (!(error instanceof OpenSearchUnavailableError) && !(error instanceof OpenSearchAnswerRefusedError)) return error;
  const message = error instanceof OpenSearchUnavailableError && error.cause instanceof Error ? error.cause.message : error.message;
  return searchFailure(500, message, message);
}

/** The rows of a PPL answer as objects by column name (the original's shimSchemaRow) */
export function pplJsonData(response: { schema: Array<{ name: string }>; datarows: unknown[][] }): Array<Record<string, unknown>> {
  return response.datarows.map((row) => {
    const record: Record<string, unknown> = {};
    row.forEach((item, index) => {
      if (index >= response.schema.length) return;
      record[response.schema[index].name] =
        typeof item === 'object' ? JSON.stringify(item) : typeof item === 'boolean' ? item.toString() : item;
    });
    return record;
  });
}

/**
 * The `pplraw` strategy: the body of the request's params is the PPL plugin's request, and the
 * plugin's answer comes back with its rows also as objects (`jsonData`). A failure is worded
 * as the original's legacy client words it: what OpenSearch said when it answered JSON, else
 * the name of the status (the PPL plugin types its own failures as text).
 */
async function pplRaw(client: OpenSearchClient, request: Record<string, unknown>): Promise<unknown> {
  const params = request.params as { body?: unknown } | null | undefined;
  if (params === undefined || params === null) {
    const message = `Cannot read properties of ${String(params)} (reading 'body')`;
    throw searchFailure(500, message, message);
  }
  const { body } = params;
  const response = await client
    .raw({
      method: 'POST',
      path: '/_plugins/_ppl',
      body: body === undefined || body === null ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    })
    .catch((error: unknown) => {
      throw clientFailure(error);
    });
  const text = response.body.toString('utf8');
  let parsed: unknown = text;
  if (/^application\/(vnd\.[^+;]+\+)?json/i.test(String(response.headers['content-type'] ?? ''))) {
    try {
      parsed = JSON.parse(text);
    } catch {
      // as it is
    }
  }
  if (response.status >= 400) {
    const said = parsed !== null && typeof parsed === 'object' ? (parsed as { error?: unknown }).error : undefined;
    const message = said ? legacyClientMessage(parsed, response.status) : String(errorBody(response.status, '').error);
    throw searchFailure(response.status, message, said || message);
  }
  const answer = parsed as { schema?: unknown; datarows?: unknown };
  if (!Array.isArray(answer?.schema) || !Array.isArray(answer.datarows)) {
    const message = 'the PPL plugin answered without a schema and rows';
    throw searchFailure(500, message, message);
  }
  const rows = answer as { schema: Array<{ name: string }>; datarows: unknown[][] };
  // (`hits: {}` is what the route's shimHitsTotal leaves in an answer that has no hits)
  return { rawResponse: { ...rows, jsonData: pplJsonData(rows), hits: {} } };
}

export function registerSearch(
  router: Router,
  client: OpenSearchClient,
  options: { shardTimeout: number; uiSettings: UiSettings }
) {
  const search = async (strategyName: string, body: unknown): Promise<unknown> => {
    const request = validateRequestPart(BODY, body ?? null, 'body') as Record<string, unknown>;
    const strategy = Object.prototype.hasOwnProperty.call(STRATEGIES, strategyName) ? STRATEGIES[strategyName] : undefined;
    if (!strategy) throw searchFailure(500, `Search strategy ${strategyName} not found`, `Search strategy ${strategyName} not found`);
    if (strategy.ppl) {
      if (request.dataSourceId) throw badRequest('[request body.dataSourceId]: there are no data sources: data_source.enabled is off');
      return pplRaw(client, request);
    }
    if (request.indexType) {
      const message = `Unsupported index pattern type ${String(request.indexType)}`;
      throw searchFailure(500, message, message);
    }
    // The original turns to the data source named; there are none here (data_source.enabled)
    if (request.dataSourceId) throw badRequest('[request body.dataSourceId]: there are no data sources: data_source.enabled is off');

    // The parameters of the strategy: the settings' defaults, the shard time limit, then the request's
    const maxConcurrentShardRequests = await options.uiSettings.peek<number>('courier:maxConcurrentShardRequests', 0);
    const given: Record<string, unknown> = {
      maxConcurrentShardRequests: maxConcurrentShardRequests > 0 ? maxConcurrentShardRequests : undefined,
      ignoreUnavailable: true,
      trackTotalHits: true,
      ...(options.shardTimeout > 0 ? { timeout: `${options.shardTimeout}ms` } : {}),
      ...(request.params as Record<string, unknown> | undefined),
    };
    const params: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(given)) params[snakeCase(name)] = value;

    // As opensearch-js's search() makes the request of them
    const { index, body: searchBody, method, ...rest } = params;
    const query = new URLSearchParams();
    for (const [name, value] of Object.entries(rest)) {
      if (value !== undefined) query.append(name, Array.isArray(value) ? value.join(',') : String(value));
    }
    const path = `${index === undefined || index === null ? '' : `/${encodeURIComponent(String(index))}`}/_search`;
    const hasBody = searchBody !== undefined && searchBody !== null && searchBody !== '';
    let response;
    try {
      response = await client.raw({
        method: typeof method === 'string' ? method : hasBody ? 'POST' : 'GET',
        path: query.size ? `${path}?${query.toString()}` : path,
        body: hasBody ? (typeof searchBody === 'string' ? searchBody : JSON.stringify(searchBody)) : undefined,
      });
    } catch (error) {
      throw clientFailure(error);
    }
    const text = response.body.toString('utf8');
    let parsed: unknown;
    try {
      parsed = text === '' ? text : strategy.longNumerals ? parseLongNumerals(text) : JSON.parse(text);
    } catch {
      parsed = text;
    }
    if (response.status >= 400) {
      const status = (parsed as { status?: unknown } | undefined)?.status;
      const error = (parsed as { error?: unknown } | undefined)?.error;
      const message = responseErrorMessage(parsed);
      throw searchFailure(typeof status === 'number' ? status : response.status, message, error || message);
    }
    const rawResponse = parsed as { hits?: { total?: unknown }; _shards?: { total?: number; failed?: number; successful?: number } };
    // shimHitsTotal: the total of the hits as a number
    const hits = rawResponse.hits;
    const total = (hits?.total as { value?: unknown } | undefined)?.value ?? hits?.total;
    const shards = rawResponse._shards ?? {};
    return {
      isPartial: false,
      isRunning: false,
      rawResponse: { ...rawResponse, hits: { ...hits, total } },
      total: shards.total,
      loaded: (shards.failed ?? 0) + (shards.successful ?? 0),
    };
  };

  const answer = async (strategy: string, body: unknown) => ({
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify(await search(strategy, body)),
  });
  router.post('/internal/search/{strategy}', async (context) => answer(context.params.strategy, await context.json()));
  router.post('/internal/search/{strategy}/{id}', async (context) => answer(context.params.strategy, await context.json()));
  // The strategies of OpenSearch cannot be stopped: the original answers 200 and does nothing
  router.delete('/internal/search/{strategy}/{id}', ({ params }) => {
    if (!Object.prototype.hasOwnProperty.call(STRATEGIES, params.strategy)) {
      throw new Error(`Search strategy ${params.strategy} not found`);
    }
    return { status: 200 };
  });
}

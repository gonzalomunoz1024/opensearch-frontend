/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The server side of Query Workbench: the routes its page and scripts written for the plugin
 * call. Each is one request to the SQL plugin of OpenSearch, answered in the envelope the page
 * reads: `{ data: { ok, resp } }`, with OpenSearch's own error text when a query fails.
 */

import { errorBody, type Handler, type Reply, type RequestContext, type Router } from './http';
import { legacyMessage } from './legacy_client';
import type { OpenSearchClient } from './opensearch';

/**
 * What a failed status is called in an answer. These are the names of the client OpenSearch
 * Dashboards talks to OpenSearch with, which differ from HTTP's own for 401 and 403.
 */
const STATUS_NAMES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Authentication Exception',
  403: 'Authorization Exception',
  404: 'Not Found',
  405: 'Method Not Allowed',
  408: 'Request Timeout',
  409: 'Conflict',
  413: 'Request Entity Too Large',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  501: 'Not Implemented',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
};

export function statusName(status: number): string {
  return STATUS_NAMES[status] ?? errorBody(status, '').error;
}

/** What the client of OpenSearch Dashboards says when an answer it was told is JSON is not */
const UNREADABLE = 'Unable to parse/serialize body';

type Plugin = '_sql' | '_ppl';

interface QueryRoute {
  plugin: Plugin;
  /** The `format` OpenSearch is asked for; none is its own tabular JSON ("JDBC") */
  format?: 'json' | 'csv' | 'raw';
  /** Whether a failure is told inside a 200 answer, as the PPL route of the plugin does */
  failsInAnswer?: boolean;
}

/** An answer of OpenSearch: its status, its content type and its text */
export interface PluginAnswer {
  status: number;
  /** The `content-type` it came with; a failure of the SQL plugin is `text/plain` */
  type?: string;
  text: string;
}

const isJsonType = (type: string | undefined) => (type ?? '').includes('application/json');

/** A JSON text without its layout; `undefined` for what is not JSON */
function compact(text: string): string | undefined {
  try {
    return JSON.stringify(JSON.parse(text));
  } catch {
    return undefined;
  }
}

/**
 * Why a request failed, as the client of OpenSearch Dashboards words it: the root causes of a
 * JSON error, the name of the status otherwise, with the error read as JSON when it is JSON.
 */
function failure(answer: PluginAnswer): { message: string; body: unknown } {
  const byStatus = { message: statusName(answer.status), body: answer.text };
  if (!isJsonType(answer.type)) return byStatus;
  let body: unknown;
  try {
    body = JSON.parse(answer.text);
  } catch {
    // An error that says it is JSON and is not: told by its status, as text
    return byStatus;
  }
  const message = legacyMessage(answer.status, body);
  // An error with no reason in it is named by its status, as the plugin names it
  return {
    message: message === legacyMessage(answer.status, undefined) ? byStatus.message : message,
    body,
  };
}

/** The envelope for the answer OpenSearch gave to a query */
export function queryReply(route: QueryRoute, status: number, text: string, type?: string): Reply {
  const answer: PluginAnswer = { status, type, text };
  const failed = (code: number, message?: string): Reply => {
    if (!route.failsInAnswer) return { status: code, body: errorBody(code, text) };
    const told =
      message === undefined ? failure({ ...answer, status: code }) : { message, body: text };
    return { body: { data: { ok: false, resp: told.message, body: told.body, statusCode: code } } };
  };
  if (status < 200 || status >= 300) return failed(status);
  // CSV and text are passed on as they are; JSON is passed on as text too, which the page parses
  if (route.format === 'csv' || route.format === 'raw') {
    return { body: { data: { ok: true, resp: text } } };
  }
  const json = compact(text);
  return json === undefined
    ? failed(400, UNREADABLE)
    : { body: { data: { ok: true, resp: json } } };
}

/** The envelope for the answer OpenSearch gave when asked to explain a query */
export function explainReply(status: number, text: string, type?: string): Reply {
  if (status >= 200 && status < 300) {
    try {
      return { body: { data: { ok: true, resp: JSON.parse(text) as unknown } } };
    } catch {
      return { body: { data: { ok: false, resp: UNREADABLE } } };
    }
  }
  return { body: { data: { ok: false, resp: failure({ status, type, text }).message } } };
}

/**
 * The query string a route of the plugin takes: `dataSourceMDSId` alone, as its routes declare
 * it. What else is asked is refused, in the words of OpenSearch Dashboards' validation.
 */
export function queryParameterError(query: URLSearchParams): Reply | undefined {
  for (const key of new Set(query.keys())) {
    if (key !== 'dataSourceMDSId') {
      return {
        status: 400,
        body: errorBody(400, `[request query.${key}]: definition for this key is missing`),
      };
    }
    if (query.getAll(key).length > 1) {
      return {
        status: 400,
        body: errorBody(
          400,
          `[request query.${key}]: expected value of type [string] but got [Array]`
        ),
      };
    }
  }
  return undefined;
}

/**
 * The body a request of the page carries, as OpenSearch Dashboards reads it: JSON, or the text
 * itself when it was sent as text. `undefined` when there is none.
 */
async function requestBody(context: RequestContext): Promise<unknown> {
  const type = String(context.req.headers['content-type'] ?? '');
  if (type.startsWith('text/')) {
    const text = (await context.body()).toString('utf8');
    return text === '' ? undefined : text;
  }
  return context.json();
}

const QUERY_ROUTES: Record<string, QueryRoute> = {
  sqlquery: { plugin: '_sql' },
  pplquery: { plugin: '_ppl', failsInAnswer: true },
  sqljson: { plugin: '_sql', format: 'json' },
  ppljson: { plugin: '_ppl', format: 'json' },
  sqlcsv: { plugin: '_sql', format: 'csv' },
  pplcsv: { plugin: '_ppl', format: 'csv' },
  sqltext: { plugin: '_sql', format: 'raw' },
  ppltext: { plugin: '_ppl', format: 'raw' },
};

const JSON_HEADERS = { 'content-type': 'application/json' };

export function registerSqlConsole(router: Router, client: OpenSearchClient) {
  const post = async (path: string, body: unknown): Promise<PluginAnswer> => {
    const response = await client.raw({
      method: 'POST',
      path,
      body: JSON.stringify(body ?? {}),
      headers: JSON_HEADERS,
    });
    return {
      status: response.status,
      type: String(response.headers['content-type'] ?? ''),
      text: response.body.toString('utf8'),
    };
  };

  const query =
    (route: QueryRoute): Handler =>
    async (context: RequestContext) => {
      const refused = queryParameterError(context.query);
      if (refused) return refused;
      const format = route.format ? `?format=${route.format}` : '';
      const answer = await post(`/_plugins/${route.plugin}${format}`, await requestBody(context));
      return queryReply(route, answer.status, answer.text, answer.type);
    };

  const explain =
    (plugin: Plugin): Handler =>
    async (context: RequestContext) => {
      const refused = queryParameterError(context.query);
      if (refused) return refused;
      const body = await requestBody(context);
      const text =
        body && typeof body === 'object' ? (body as { query?: unknown }).query : undefined;
      const answer = await post(`/_plugins/${plugin}/_explain`, { query: text });
      return explainReply(answer.status, answer.text, answer.type);
    };

  for (const [name, route] of Object.entries(QUERY_ROUTES)) {
    router.post(`/api/sql_console/${name}`, query(route));
  }
  router.post('/api/sql_console/translatesql', explain('_sql'));
  router.post('/api/sql_console/translateppl', explain('_ppl'));

  // Which OpenSearch this is. The page of the plugin decides from it what to offer.
  router.get('/api/sql_console/cluster_info', async (context) => {
    const refused = queryParameterError(context.query);
    if (refused) return refused;
    // A data source of another cluster, which this product has none of, has no version
    if (context.query.get('dataSourceMDSId')) return { body: { data: { ok: true, version: '' } } };
    let version = '';
    let isOpenSearch: boolean | undefined;
    try {
      const info = await client.request<{ version?: { number?: string; distribution?: string } }>({
        method: 'GET',
        path: '/',
      });
      version = info.version?.number ?? '';
      isOpenSearch = info.version?.distribution === 'opensearch';
    } catch {
      // Unknown, as the plugin answers when OpenSearch cannot be asked
    }
    return { body: { data: { ok: true, version, isOpenSearch } } };
  });

  // The data sources of the SQL plugin (Spark, S3 and the like), which the lite backend has none of
  const dataSources: Handler = async () => {
    const response = await client.raw({ method: 'GET', path: '/_plugins/_query/_datasources' });
    const text = response.body.toString('utf8');
    if (response.status >= 200 && response.status < 300) {
      try {
        return { body: { data: { ok: true, resp: JSON.parse(text) as unknown } } };
      } catch {
        return { status: 400, body: errorBody(400, text) };
      }
    }
    return { status: response.status, body: errorBody(response.status, text) };
  };
  router.get('/api/get_datasources', dataSources);
  router.get('/api/get_datasources/{dataSourceMDSId}', dataSources);
}

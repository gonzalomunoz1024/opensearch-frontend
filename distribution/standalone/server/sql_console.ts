/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The server side of Query Workbench: the routes its page and scripts written for the plugin
 * call. Each is one request to the SQL plugin of OpenSearch, answered in the envelope the page
 * reads: `{ data: { ok, resp } }`, with OpenSearch's own error text when a query fails.
 */

import { errorBody, type Handler, type Reply, type RequestContext, type Router } from './http';
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

type Plugin = '_sql' | '_ppl';

interface QueryRoute {
  plugin: Plugin;
  /** The `format` OpenSearch is asked for; none is its own tabular JSON ("JDBC") */
  format?: 'json' | 'csv' | 'raw';
  /** Whether a failure is told inside a 200 answer, as the PPL route of the plugin does */
  failsInAnswer?: boolean;
}

/** A JSON text without its layout; `undefined` for what is not JSON */
function compact(text: string): string | undefined {
  try {
    return JSON.stringify(JSON.parse(text));
  } catch {
    return undefined;
  }
}

/** The envelope for the answer OpenSearch gave to a query */
export function queryReply(
  route: QueryRoute,
  status: number,
  text: string
): Reply {
  const failed = (code: number): Reply =>
    route.failsInAnswer
      ? { body: { data: { ok: false, resp: statusName(code), body: text, statusCode: code } } }
      : { status: code, body: errorBody(code, text) };
  if (status < 200 || status >= 300) return failed(status);
  // CSV and text are passed on as they are; JSON is passed on as text too, which the page parses
  if (route.format === 'csv' || route.format === 'raw') return { body: { data: { ok: true, resp: text } } };
  const json = compact(text);
  return json === undefined ? failed(400) : { body: { data: { ok: true, resp: json } } };
}

/** The envelope for the answer OpenSearch gave when asked to explain a query */
export function explainReply(status: number, text: string): Reply {
  if (status >= 200 && status < 300) {
    try {
      return { body: { data: { ok: true, resp: JSON.parse(text) as unknown } } };
    } catch {
      return { body: { data: { ok: false, resp: 'Unable to parse/serialize body' } } };
    }
  }
  return { body: { data: { ok: false, resp: statusName(status) } } };
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
  const post = async (path: string, body: unknown) => {
    const response = await client.raw({
      method: 'POST',
      path,
      body: JSON.stringify(body ?? {}),
      headers: JSON_HEADERS,
    });
    return { status: response.status, text: response.body.toString('utf8') };
  };

  const query =
    (route: QueryRoute): Handler =>
    async (context: RequestContext) => {
      const format = route.format ? `?format=${route.format}` : '';
      const answer = await post(`/_plugins/${route.plugin}${format}`, await context.json());
      return queryReply(route, answer.status, answer.text);
    };

  const explain =
    (plugin: Plugin): Handler =>
    async (context: RequestContext) => {
      const body = await context.json<{ query?: unknown }>();
      const text = body && typeof body === 'object' ? body.query : undefined;
      const answer = await post(`/_plugins/${plugin}/_explain`, { query: text });
      return explainReply(answer.status, answer.text);
    };

  for (const [name, route] of Object.entries(QUERY_ROUTES)) {
    router.post(`/api/sql_console/${name}`, query(route));
  }
  router.post('/api/sql_console/translatesql', explain('_sql'));
  router.post('/api/sql_console/translateppl', explain('_ppl'));

  // Which OpenSearch this is. The page of the plugin decides from it what to offer.
  router.get('/api/sql_console/cluster_info', async () => {
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

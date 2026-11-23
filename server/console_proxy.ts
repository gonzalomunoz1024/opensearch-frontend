/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The server side of Dev Tools' console: the three routes of the original's console plugin
 * (src/plugins/console/server/routes), there unless console.enabled is false. The proxy checks
 * a request as the original's schema checks it, keeps to console.proxyFilter, and asks
 * OpenSearch what the original's handler asks it (create_handler.ts), with its answers.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TLSSocket } from 'node:tls';
import type { Config } from './config';
import { badRequest, errorBody, type Reply, type RequestContext, type Router } from './http';
import { compactJson } from './json_numbers';
import type { Logger } from './logger';
import {
  OpenSearchAnswerRefusedError,
  OpenSearchUnavailableError,
  type OpenSearchClient,
  type OpenSearchResponse,
} from './opensearch';
import { maybe, object, queryObject, string, validateRequestPart } from './route_validation';

const VERBS = ['HEAD', 'GET', 'PATCH', 'POST', 'PUT', 'DELETE'];

/** The query of the proxy, as the original's validation_config.ts checks it, in its words */
const PROXY_QUERY = object({
  method: string({
    validate: (method) =>
      VERBS.some((verb) => verb.toLowerCase() === method.toLowerCase())
        ? undefined
        : `Method must be one of, case insensitive ['HEAD', 'GET', 'PATCH', 'POST', 'PUT', 'DELETE']. Received '${method}'.`,
  }),
  path: string({ validate: (path) => (path === '' ? 'Expected non-empty string' : undefined) }),
  dataSourceId: maybe(string()),
});

const JSON_TYPE = 'application/json; charset=utf-8';

/**
 * The path the original asks OpenSearch for (toUrlPath): what was typed is an address, in which
 * "." and ".." are steps, and pretty=true is added unless `pretty` is given
 */
export function consolePath(typed: string): string {
  const url = new URL(`http://localhost/${typed.replace(/^\/+/, '')}`);
  if (!url.searchParams.get('pretty')) url.searchParams.append('pretty', 'true');
  return url.href.replace(url.origin, '');
}

/** The headers the original's proxy adds to what it sends (getProxyHeaders) */
function proxyHeaders(context: RequestContext): Record<string, string> {
  const { req } = context;
  const headers: Record<string, string> = {
    // An id of its own for each request, as the scoped client of the original sends one:
    // OpenSearch warns of a deprecated API once for each id
    'x-opaque-id': randomUUID(),
  };
  const { remoteAddress, remotePort } = req.socket;
  if (remoteAddress && remotePort) {
    headers['x-forwarded-for'] = remoteAddress;
    headers['x-forwarded-port'] = String(remotePort);
    headers['x-forwarded-proto'] = (req.socket as TLSSocket).encrypted ? 'https' : 'http';
    if (req.headers.host) headers['x-forwarded-host'] = req.headers.host;
  }
  const type = req.headers['content-type'];
  if (type) headers['content-type'] = type;
  return headers;
}

/**
 * What the original's handler answers for an answer of OpenSearch. JSON is written again without
 * the spaces between its parts, as the original's proxy sends it (it reads an answer and writes
 * it with its stringify), but each number stays as OpenSearch wrote it: the original writes 1.0
 * as 1 and 1.5E30 as 1.5e+30, a loss its own handler warns of ("7.0 will get munged into 7, thus
 * losing indication of measurement precision").
 */
function answerOf(response: OpenSearchResponse, head: boolean): Reply {
  const warning = String(response.headers.warning ?? '');
  const type = String(response.headers['content-type'] ?? '');
  const text = response.body.toString('utf8');
  // A HEAD request that finds nothing is no failure to the original's client
  if (head && response.status === 404) {
    return { status: 404, headers: { warning }, body: errorBody(404, '404 - false') };
  }
  if (response.status >= 400) {
    // A failure is passed on as it came, as JSON, without the warning header
    const json = type.includes('application/json') && text !== '' ? compactJson(text) : undefined;
    return {
      status: response.status,
      headers: { 'content-type': JSON_TYPE },
      body: json ?? JSON.stringify(head ? '' : text),
    };
  }
  if (head) {
    return { status: response.status, headers: { warning, 'content-type': 'text/plain; charset=utf-8' }, body: `${response.status} - true` };
  }
  if (type.includes('application/json')) {
    return { status: response.status, headers: { warning, 'content-type': JSON_TYPE }, body: compactJson(text) ?? text };
  }
  // Other text keeps the type OpenSearch gave it, where the original's sends it as HTML
  return {
    status: response.status,
    headers: { warning, 'content-type': type || 'text/plain; charset=utf-8' },
    body: response.body,
  };
}

let apiServerAnswer: Buffer | undefined;

export function registerConsole(router: Router, client: OpenSearchClient, config: Config, logger: Logger) {
  if (!config.console.enabled) return;
  const pathFilters = config.console.proxyFilter.map((source) => new RegExp(source));

  router.post('/api/console/proxy', async (context) => {
    const { method, path, dataSourceId } = validateRequestPart(PROXY_QUERY, queryObject(context.query), 'query');
    if (!pathFilters.some((filter) => filter.test(path))) {
      return {
        status: 403,
        body: errorBody(403, `Error connecting to '${path}':\n\nUnable to send requests to that path.`),
      };
    }
    // The original turns to the data source named; there are none here (data_source.enabled)
    if (dataSourceId) {
      throw badRequest(`[request query.dataSourceId]: there are no data sources: data_source.enabled is off`);
    }
    const body = await context.body();
    const head = method.toUpperCase() === 'HEAD';
    let response: OpenSearchResponse;
    try {
      response = await client.raw({
        method: method.toUpperCase(),
        path: consolePath(path),
        body: body.length ? body : undefined,
        headers: proxyHeaders(context),
      });
    } catch (error) {
      if (!(error instanceof OpenSearchUnavailableError) && !(error instanceof OpenSearchAnswerRefusedError)) throw error;
      // What the client of the original threw: 502, with its message as the body
      const cause = error instanceof OpenSearchUnavailableError && error.cause instanceof Error ? error.cause : error;
      logger.error(cause.message, { path });
      return { status: 502, headers: { 'content-type': JSON_TYPE }, body: cause.message };
    }
    return answerOf(response, head);
  });

  // The address "Copy as cURL" writes: the first OpenSearch this server talks to
  router.get('/api/console/opensearch_config', () => ({ body: { host: config.opensearch.hosts[0] } }));

  // What the original's console suggests from (its spec definitions, as it answers them)
  const apiServer = () => {
    apiServerAnswer ??= readFileSync(join(__dirname, 'console_api_server.json'));
    return { headers: { 'content-type': JSON_TYPE }, body: apiServerAnswer };
  };
  router.get('/api/console/api_server', apiServer);
  router.post('/api/console/api_server', apiServer);
}

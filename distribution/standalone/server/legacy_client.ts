/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Requests to OpenSearch named the way the pages of Index Management name them: an endpoint
 * such as "cat.indices" or "indices.putSettings" with its parameters, as the client library
 * OpenSearch Dashboards used to carry took them. This turns such a call into the request it
 * stands for, and words a failure as that library worded it, since the pages show those words.
 */

import type { OpenSearchClient } from './opensearch';

export type Params = Record<string, unknown>;

export interface LegacyRequest {
  method: string;
  /** With its query string */
  path: string;
  body?: unknown;
}

/** OpenSearch answered that the request failed */
export class LegacyError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    /** The answer, read as JSON when it is JSON */
    public readonly body: unknown,
    /** The answer as it came */
    public readonly response: string
  ) {
    super(message);
    this.name = 'LegacyError';
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** What a failed status is called when OpenSearch gives no reason of its own */
const STATUS_NAMES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Authentication Exception',
  402: 'Payment Required',
  403: 'Authorization Exception',
  404: 'Not Found',
  405: 'Method Not Allowed',
  406: 'Not Acceptable',
  408: 'Request Timeout',
  409: 'Conflict',
  410: 'Gone',
  412: 'Precondition Failed',
  413: 'Request Entity Too Large',
  415: 'Unsupported Media Type',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  501: 'Not Implemented',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
};

export function statusName(status: number): string {
  return STATUS_NAMES[status] ?? 'unknown error';
}

function print(value: unknown): string {
  if (typeof value === 'object') {
    const parts = Object.entries(value ?? {}).map(([name, inner]) => `${name}=${print(inner)}`);
    return `{ ${parts.join(' & ')} }`;
  }
  return JSON.stringify(value);
}

/**
 * The message of a failure: each root cause as "[type] reason", with what else it tells after
 * ", with"; without root causes the error's own type and reason; without those the status' name.
 */
export function legacyMessage(status: number, body: unknown): string {
  const error = isRecord(body) ? body.error : undefined;
  if (typeof error === 'string' && error) return error;
  if (isRecord(error)) {
    let message = '';
    const causes = Array.isArray(error.root_cause) ? error.root_cause : [];
    for (const cause of causes) {
      if (!isRecord(cause)) continue;
      if (message) message += ' (and) ';
      message += `[${String(cause.type)}] ${String(cause.reason)}`;
      const extra = Object.fromEntries(
        Object.entries(cause).filter(([name]) => name !== 'type' && name !== 'reason')
      );
      if (Object.keys(extra).length > 0) message += `, with ${print(extra)}`;
    }
    if (!message) {
      if (error.type) message += `[${String(error.type)}] `;
      if (error.reason) message += String(error.reason);
    }
    if (message) return message;
  }
  return statusName(status);
}

interface Endpoint {
  method: string;
  /** Addresses from the one with the most parts to the one with the fewest; `<name>` is a parameter */
  paths: string[];
}

const get = (...paths: string[]): Endpoint => ({ method: 'GET', paths });
const post = (...paths: string[]): Endpoint => ({ method: 'POST', paths });
const put = (...paths: string[]): Endpoint => ({ method: 'PUT', paths });
const del = (...paths: string[]): Endpoint => ({ method: 'DELETE', paths });

const ENDPOINTS: Record<string, Endpoint> = {
  'cat.aliases': get('/_cat/aliases/<name>', '/_cat/aliases'),
  'cat.health': get('/_cat/health'),
  'cat.indices': get('/_cat/indices/<index>', '/_cat/indices'),
  'cat.nodes': get('/_cat/nodes'),
  'cat.recovery': get('/_cat/recovery/<index>', '/_cat/recovery'),
  'cat.repositories': get('/_cat/repositories'),
  'cat.shards': get('/_cat/shards/<index>', '/_cat/shards'),
  'cat.snapshots': get('/_cat/snapshots/<repository>', '/_cat/snapshots'),
  'cat.tasks': get('/_cat/tasks'),
  'cat.templates': get('/_cat/templates/<name>', '/_cat/templates'),
  'cluster.getSettings': get('/_cluster/settings'),
  'cluster.health': get('/_cluster/health/<index>', '/_cluster/health'),
  'cluster.putSettings': put('/_cluster/settings'),
  'cluster.state': get(
    '/_cluster/state/<metric>/<index>',
    '/_cluster/state/<metric>',
    '/_cluster/state'
  ),
  count: post('/<index>/_count', '/_count'),
  'indices.clearCache': post('/<index>/_cache/clear', '/_cache/clear'),
  'indices.close': post('/<index>/_close'),
  'indices.create': put('/<index>'),
  'indices.delete': del('/<index>'),
  'indices.deleteAlias': del('/<index>/_alias/<name>'),
  'indices.deleteTemplate': del('/_template/<name>'),
  'indices.flush': post('/<index>/_flush', '/_flush'),
  'indices.forcemerge': post('/<index>/_forcemerge', '/_forcemerge'),
  'indices.get': get('/<index>'),
  'indices.getAlias': get('/<index>/_alias/<name>', '/_alias/<name>', '/<index>/_alias', '/_alias'),
  'indices.getFieldMapping': get('/<index>/_mapping/field/<fields>', '/_mapping/field/<fields>'),
  'indices.getMapping': get('/<index>/_mapping', '/_mapping'),
  'indices.getSettings': get(
    '/<index>/_settings/<name>',
    '/<index>/_settings',
    '/_settings/<name>',
    '/_settings'
  ),
  'indices.getTemplate': get('/_template/<name>', '/_template'),
  'indices.open': post('/<index>/_open'),
  'indices.putAlias': put('/<index>/_alias/<name>'),
  'indices.putMapping': put('/<index>/_mapping'),
  'indices.putSettings': put('/<index>/_settings', '/_settings'),
  'indices.putTemplate': put('/_template/<name>'),
  'indices.recovery': get('/<index>/_recovery', '/_recovery'),
  'indices.refresh': post('/<index>/_refresh', '/_refresh'),
  'indices.rollover': post('/<alias>/_rollover/<newIndex>', '/<alias>/_rollover'),
  'indices.stats': get('/<index>/_stats/<metric>', '/_stats/<metric>', '/<index>/_stats', '/_stats'),
  'indices.updateAliases': post('/_aliases'),
  'indices.validateQuery': post('/<index>/_validate/query', '/_validate/query'),
  'ingest.getPipeline': get('/_ingest/pipeline/<id>', '/_ingest/pipeline'),
  reindex: post('/_reindex'),
  search: post('/<index>/_search', '/_search'),
  'snapshot.create': put('/_snapshot/<repository>/<snapshot>'),
  'snapshot.createRepository': put('/_snapshot/<repository>'),
  'snapshot.delete': del('/_snapshot/<repository>/<snapshot>'),
  'snapshot.deleteRepository': del('/_snapshot/<repository>'),
  'snapshot.get': get('/_snapshot/<repository>/<snapshot>'),
  'snapshot.getRepository': get('/_snapshot/<repository>', '/_snapshot'),
  'snapshot.restore': post('/_snapshot/<repository>/<snapshot>/_restore'),
  'tasks.get': get('/_tasks/<taskId>'),
  'tasks.list': get('/_tasks'),
};

/** Parameters that say how to send a request and are no part of it */
const NOT_SENT = new Set(['body', 'headers', 'ignore', 'maxRetries', 'method', 'requestTimeout']);

const partNames = (path: string) => [...path.matchAll(/<(\w+)>/g)].map((match) => match[1]);

/** A part of an address: a list keeps its commas, each of its items is encoded */
function pathPart(value: unknown): string {
  const items = Array.isArray(value) ? value : String(value).split(',');
  return items.map((item) => encodeURIComponent(String(item).trim())).join(',');
}

function queryValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).join(',');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

const snakeCase = (name: string) => name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

function queryString(query: Array<[string, unknown]>): string {
  const pairs = query
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(queryValue(value))}`);
  return pairs.length > 0 ? `?${pairs.join('&')}` : '';
}

/** The request an endpoint and its parameters stand for */
export function legacyRequest(endpoint: string, params: Params = {}): LegacyRequest {
  if (endpoint === 'transport.request') {
    const { method, path, query, body } = params;
    let address = String(path ?? '');
    if (isRecord(query)) {
      const more = queryString(Object.entries(query));
      if (more) address += (address.includes('?') ? '&' : '?') + more.slice(1);
    } else if (typeof query === 'string' && query) {
      address += (address.includes('?') ? '&' : '?') + query.replace(/^\?/, '');
    }
    return {
      method: typeof method === 'string' ? method.toUpperCase() : 'GET',
      path: address,
      body: body ?? undefined,
    };
  }

  const known = Object.hasOwn(ENDPOINTS, endpoint) ? ENDPOINTS[endpoint] : undefined;
  if (!known) throw new Error(`called with an invalid endpoint: ${endpoint}`);
  const given = (name: string) => params[name] !== undefined && params[name] !== null;
  const path = known.paths.find((candidate) => partNames(candidate).every(given));
  if (path === undefined) {
    const least = partNames(known.paths[known.paths.length - 1]);
    throw new Error(
      `Unable to build a path with those params. Supply at least ${least.join(', ')}`
    );
  }
  const parts = new Set(partNames(path));
  const query = Object.entries(params)
    .filter(([name]) => !parts.has(name) && !NOT_SENT.has(name))
    .map(([name, value]): [string, unknown] => [snakeCase(name), value]);
  return {
    method: typeof params.method === 'string' ? params.method.toUpperCase() : known.method,
    path: path.replace(/<(\w+)>/g, (_, name: string) => pathPart(params[name])) + queryString(query),
    body: params.body ?? undefined,
  };
}

export type LegacyCall = (endpoint: string, params?: Params) => Promise<unknown>;

/** Sends a request and gives its answer, or throws what the old client library threw */
export async function sendLegacy(
  client: OpenSearchClient,
  request: LegacyRequest
): Promise<unknown> {
  let response;
  try {
    response = await client.raw({
      method: request.method,
      path: request.path,
      body: request.body,
      headers: request.body === undefined ? undefined : { 'content-type': 'application/json' },
    });
  } catch {
    // The words of the old client library for "no host answered"
    throw new Error('No Living connections');
  }
  const text = response.body.toString('utf8');
  let body: unknown = text === '' ? undefined : text;
  if (text && String(response.headers['content-type'] ?? '').includes('application/json')) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error('Unable to parse/serialize body');
    }
  }
  if (response.status < 200 || response.status >= 300) {
    throw new LegacyError(legacyMessage(response.status, body), response.status, body, text);
  }
  return body;
}

export function legacyCaller(client: OpenSearchClient): LegacyCall {
  return async (endpoint, params) => sendLegacy(client, legacyRequest(endpoint, params));
}

/* SPDX-License-Identifier: Apache-2.0 */

/* Requests to OpenSearch, which the server passes on as they are. */

import { HttpFetchError, messageOf, type Http } from './http';

export interface SearchResponse {
  took?: number;
  timed_out?: boolean;
  _shards?: { total: number; successful: number; failed: number; skipped?: number };
  hits: {
    total: number | { value: number; relation: string };
    max_score?: number | null;
    hits: Hit[];
  };
  aggregations?: Record<string, unknown>;
}

export interface Hit {
  _index: string;
  _id: string;
  _score?: number | null;
  _source?: Record<string, unknown>;
  fields?: Record<string, unknown[]>;
  highlight?: Record<string, string[]>;
  sort?: unknown[];
  _type?: string;
}

export const totalOf = (response: SearchResponse | undefined): number => {
  const total = response?.hits?.total;
  return typeof total === 'number' ? total : (total?.value ?? 0);
};

/** What was asked and answered, kept for the Inspect panel */
export interface RequestRecord {
  name: string;
  index: string;
  /**
   * The id of the index pattern the search was made for: given it, the inspector's statistics name
   * the index pattern and its id, as the original's do; a search of no index pattern has none
   */
  indexPatternId?: string;
  /** What the inspector says of the request under its name, as the original's description */
  description?: string;
  body: unknown;
  response?: unknown;
  error?: string;
  startedAt: number;
  tookMs?: number;
}

/**
 * The preference a search names, as the courier settings of the original make it: the id of this
 * visit of the page for "sessionId", the custom preference for "custom", none for "none"
 */
export function requestPreference(setting: unknown, custom: unknown, sessionId: string): string | undefined {
  if (setting === 'sessionId') return sessionId;
  if (setting !== 'custom' || custom === undefined || custom === null || custom === '') return undefined;
  return String(custom);
}

export interface SearchOptions {
  maxConcurrentShardRequests: number;
  /** Which shard copies answer: courier:setRequestPreference and courier:customRequestPreference */
  preference?: string;
}

export class SearchService {
  constructor(
    private readonly http: Http,
    private readonly options: () => SearchOptions
  ) {}

  /** One request to OpenSearch: any method, any path; the answer whatever its status below 400 */
  async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
    options: { signal?: AbortSignal; asText?: boolean } = {}
  ): Promise<T> {
    return this.http.post<T>('/internal/opensearch', {
      query: { method, path },
      body,
      signal: options.signal,
      asText: options.asText,
    });
  }

  async search(
    index: string,
    body: Record<string, unknown>,
    options: { signal?: AbortSignal; record?: RequestRecord } = {}
  ): Promise<SearchResponse> {
    const { maxConcurrentShardRequests, preference } = this.options();
    const params = new URLSearchParams({ ignore_unavailable: 'true', track_total_hits: 'true' });
    if (maxConcurrentShardRequests > 0) {
      params.set('max_concurrent_shard_requests', String(maxConcurrentShardRequests));
    }
    if (preference !== undefined) params.set('preference', preference);
    const record = options.record;
    const started = Date.now();
    try {
      const response = await this.request<SearchResponse>(
        'POST',
        `${encodeURIComponent(index)}/_search?${params.toString()}`,
        body,
        { signal: options.signal }
      );
      if (record) {
        record.response = response;
        record.tookMs = Date.now() - started;
      }
      const shards = response._shards;
      const failures = (response as { _shards?: { failures?: Array<{ reason?: { reason?: string } }> } })
        ._shards?.failures;
      if (shards && shards.failed > 0 && shards.successful === 0 && failures?.length) {
        throw new HttpFetchError(400, failures[0].reason?.reason ?? 'Every shard failed', response);
      }
      return response;
    } catch (error) {
      if (record && (error as Error).name !== 'AbortError') {
        record.error = (error as Error).message;
        record.response = (error as HttpFetchError).body;
        record.tookMs = Date.now() - started;
      }
      throw error;
    }
  }
}

export { messageOf };

// The words of the statuses a search is refused with, for an answer that came without them
const STATUS_TEXT: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  408: 'Request Timeout',
  413: 'Payload Too Large',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
};

/**
 * The error as the original's client makes it of a refused search: named for the status of the
 * answer ("Bad Request"), OpenSearch's answer kept for the whole text
 */
export function searchFailure(failure: Error): Error {
  if (!(failure instanceof HttpFetchError) || failure.status < 400) return failure;
  const message = failure.statusText || STATUS_TEXT[failure.status] || `${failure.status}`;
  const shown = new HttpFetchError(failure.status, message, failure.body, failure.statusText);
  shown.name = 'Error';
  const head = `${failure.name}: ${failure.message}`;
  const stack = failure.stack ?? '';
  shown.stack = `Error: ${message}${stack.startsWith(head) ? stack.slice(head.length) : `\n${stack}`}`;
  return shown;
}

/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The connection to OpenSearch: plain HTTP requests against its REST API with Node's own
 * `http` and `https`, with what the client library of OpenSearch Dashboards (opensearch-js)
 * brings to them: kept-alive connections, 256 of them per host, a time limit on the wait for
 * the answer that counts from when a connection is there to carry the request, the next host of
 * the list and up to three more tries when a connection fails, a host answers that it cannot
 * serve or a request that only reads met the time limit, and a refusal of an answer too large
 * to be held. There is no client library between this and the wire.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { constants as bufferConstants } from 'node:buffer';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { getHeapStatistics } from 'node:v8';
import type { Config } from './config';

export interface OpenSearchResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

export interface OpenSearchRequest {
  method: string;
  /** Starts with a slash; may carry its own query string */
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  /** An object is sent as JSON; text and bytes are sent as they are */
  body?: unknown;
  headers?: Record<string, string>;
  timeout?: number;
  /** Whether a try that met the time limit is followed by another; by default when the request only reads */
  retryOnTimeout?: boolean;
}

/** OpenSearch answered, with a status that says the request failed */
export class OpenSearchError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
    message: string
  ) {
    super(message);
    this.name = 'OpenSearchError';
  }
}

/** No host of the list could be reached, or none answered in time; `cause` is the last try's failure */
export class OpenSearchUnavailableError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'OpenSearchUnavailableError';
  }
}

/** An answer was refused before it was read: it is larger than what can be held */
export class OpenSearchAnswerRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpenSearchAnswerRefusedError';
  }
}

/**
 * The headers of the browser's request that go on to OpenSearch with every request it causes,
 * as the scoped client of OpenSearch Dashboards sends them: those named by
 * opensearch.requestHeadersWhitelist, and an `x-opaque-id` of the request
 */
const forwarded = new AsyncLocalStorage<Record<string, string>>();

/** Runs what answers a request of the browser, whose requests to OpenSearch carry these headers */
export function withForwardedHeaders<T>(headers: Record<string, string>, run: () => T): T {
  return forwarded.run(headers, run);
}

/** As opensearch-js: a request is tried again three times at most */
const MAX_RETRIES = 3;
/** The answers of a host that opensearch-js takes for a host that cannot serve now, and tries again */
const RETRY_STATUSES = new Set([502, 503, 504]);
const HEAP_SIZE_LIMIT = getHeapStatistics().heap_size_limit;

/** The code of the error of a request that met the time limit */
const TIMED_OUT = 'ETIMEDOUT';
/** Its message, in the words of opensearch-js */
export const TIMED_OUT_MESSAGE = 'Request timed out';

/** The requests sent with POST that only read: searches, counts, the fields of indices */
const READS = /(?:^|\/)(?:_search|_msearch|_count|_mget|_field_caps|_validate\/query|_search\/template|_msearch\/template)$/;

/**
 * Whether a request only reads, so that sending it again changes nothing: GET, HEAD, and a
 * search sent with POST because it has a body
 */
function onlyReads(request: OpenSearchRequest): boolean {
  const method = request.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD') return true;
  return method === 'POST' && READS.test(request.path.split('?', 1)[0].replace(/\/+$/, ''));
}

function reason(body: unknown, status: number): string {
  if (body && typeof body === 'object') {
    const error = (body as { error?: unknown }).error;
    if (typeof error === 'string') return error;
    if (error && typeof error === 'object') {
      const { reason: text, type, root_cause: rootCause } = error as {
        reason?: string;
        type?: string;
        root_cause?: Array<{ reason?: string }>;
      };
      return rootCause?.[0]?.reason ?? text ?? type ?? `OpenSearch answered ${status}`;
    }
    const message = (body as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  if (typeof body === 'string' && body.trim()) return body.trim().slice(0, 500);
  return `OpenSearch answered ${status}`;
}

export function parseBody(response: OpenSearchResponse): unknown {
  const text = response.body.toString('utf8');
  const type = String(response.headers['content-type'] ?? '');
  if (type.includes('json') || /^\s*[[{]/.test(text)) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

const DOT_PART = /^(\.|%2e){1,2}$/i;

/**
 * The path and query to ask for. `new URL()` takes the "." and ".." parts out of a path, which
 * would let a name that came with a request (an index called "..") take it to the path above
 * its own. OpenSearch reads such a part as a name and answers that there is none, so the parts
 * are sent as they were written, as the client library of OpenSearch Dashboards sends them.
 */
function pathToAsk(url: URL, prefix: string, path: string): string {
  // As new URL() reads it: space is cut from the end, tabs and line ends from everywhere, a
  // "\" is a "/", and the path ends at the first "?" or "#"
  const written = path
    .replace(/[\u0000- ]+$/, '')
    .replace(/[\t\n\r]/g, '')
    .replace(/^\/+/, '')
    .split(/[?#]/, 1)[0]
    .replace(/\\/g, '/');
  const parts = written.split('/');
  if (!parts.some((part) => DOT_PART.test(part))) return url.pathname + url.search;
  const encoded = parts.map((part) =>
    DOT_PART.test(part) ? part : new URL(`http://localhost/${part}/`).pathname.slice(1, -1)
  );
  return `${prefix}/${encoded.join('/')}${url.search}`;
}

/** Whether a failure of one try is one opensearch-js tries again */
function retried(error: unknown, request: OpenSearchRequest): boolean {
  if (error instanceof OpenSearchAnswerRefusedError) return false;
  const code = (error as NodeJS.ErrnoException).code;
  // opensearch-js sends again what met the time limit, whatever it is. What changes something
  // may have been done meanwhile, and is not sent again here; what only reads is
  if (code === TIMED_OUT) return request.retryOnTimeout ?? onlyReads(request);
  // A request that cannot be written fails the same way each time
  return code !== 'ERR_UNESCAPED_CHARACTERS' && code !== 'ERR_INVALID_CHAR';
}

export class OpenSearchClient {
  private readonly hosts: URL[];
  private readonly agents = new Map<string, http.Agent>();
  private readonly baseHeaders: Record<string, string>;
  private readonly timeout: number;
  private readonly breaker: Config['opensearch']['memoryCircuitBreaker'];
  private next = 0;

  constructor(config: Config['opensearch']) {
    this.hosts = config.hosts.map((host) => new URL(host));
    this.timeout = config.requestTimeout;
    this.breaker = config.memoryCircuitBreaker;
    // What the client of OpenSearch Dashboards sends with every request, then opensearch.customHeaders
    this.baseHeaders = { 'x-opensearch-product-origin': 'opensearch-dashboards', ...config.customHeaders };
    if (config.username !== undefined && config.password !== undefined) {
      const token = Buffer.from(`${config.username}:${config.password}`).toString('base64');
      this.baseHeaders.authorization = `Basic ${token}`;
    }
    const { ssl } = config;
    const ca = ssl.certificateAuthorities.map((file) => readFileSync(file));
    const certificate = ssl.certificate === undefined ? undefined : readFileSync(ssl.certificate);
    const key = ssl.key === undefined ? undefined : readFileSync(ssl.key);
    // The agent of opensearch-js
    const pool = { keepAlive: true, keepAliveMsecs: 1000, maxSockets: 256, maxFreeSockets: 256, scheduling: 'lifo' as const };
    for (const host of this.hosts) {
      const agent =
        host.protocol === 'https:'
          ? new https.Agent({
              ...pool,
              ca: ca.length ? ca : undefined,
              // A client certificate goes with both of its files only, as in the original
              ...(certificate && key ? { cert: certificate, key, passphrase: ssl.keyPassphrase } : {}),
              rejectUnauthorized: ssl.verificationMode !== 'none',
              // "certificate" trusts the chain without matching the host name (the option must
              // be left out otherwise: Node refuses it when it is not a function)
              ...(ssl.verificationMode === 'certificate' ? { checkServerIdentity: () => undefined } : {}),
            })
          : new http.Agent(pool);
      this.agents.set(host.origin, agent);
    }
  }

  /**
   * The answer whatever its status; throws only when no host answers. A try that fails before
   * its answer is read, or that a host answers with 502, 503 or 504, is followed by another, to
   * the next host, three more at most; one that met the time limit is, when it only reads.
   */
  async raw(request: OpenSearchRequest): Promise<OpenSearchResponse> {
    const start = this.next;
    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      const index = (start + attempt) % this.hosts.length;
      try {
        const response = await this.send(this.hosts[index], request);
        if (RETRY_STATUSES.has(response.status) && attempt < MAX_RETRIES) continue;
        this.next = index;
        return response;
      } catch (error) {
        lastError = error;
        if (error instanceof OpenSearchAnswerRefusedError) throw error;
        if ((error as NodeJS.ErrnoException).code === TIMED_OUT) {
          // The next request starts with the host after it, or each would wait for this one
          this.next = (index + 1) % this.hosts.length;
        }
        if (!retried(error, request)) break;
      }
    }
    throw new OpenSearchUnavailableError(
      `OpenSearch cannot be reached: ${(lastError as Error | undefined)?.message ?? 'no host answered'}`,
      lastError
    );
  }

  /** The answer's body as JSON; throws OpenSearchError when the status says it failed */
  async request<T = unknown>(request: OpenSearchRequest): Promise<T> {
    const response = await this.raw(request);
    const body = parseBody(response);
    if (response.status >= 400) {
      throw new OpenSearchError(response.status, body, reason(body, response.status));
    }
    return body as T;
  }

  close() {
    for (const agent of this.agents.values()) agent.destroy();
  }

  /** Why an answer of this length is not read, as opensearch-js says it; nothing when it is read */
  private refusal(length: number, compressed: boolean): string | undefined {
    if (compressed && length > bufferConstants.MAX_LENGTH) {
      return `The content length (${length}) is bigger than the maximum allowed buffer (${bufferConstants.MAX_LENGTH})`;
    }
    if (length > bufferConstants.MAX_STRING_LENGTH) {
      return `The content length (${length}) is bigger than the maximum allowed string (${bufferConstants.MAX_STRING_LENGTH})`;
    }
    if (this.breaker.enabled) {
      const share = this.breaker.maxPercentage < 0 || this.breaker.maxPercentage > 1 ? 1 : this.breaker.maxPercentage;
      if (length + process.memoryUsage().heapUsed > HEAP_SIZE_LIMIT * share) {
        return `The content length (${length}) is bigger than the maximum allowed heap memory limit.`;
      }
    }
    return undefined;
  }

  private send(host: URL, request: OpenSearchRequest): Promise<OpenSearchResponse> {
    const prefix = host.pathname.replace(/\/+$/, '');
    // The path is put after the host as text, so that nothing in it can name another host
    const url = new URL(`${host.origin}${prefix}/${request.path.replace(/^\/+/, '')}`);
    for (const [key, value] of Object.entries(request.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    let payload: Buffer | undefined;
    const headers: Record<string, string> = { ...this.baseHeaders, ...forwarded.getStore(), ...request.headers };
    if (request.body !== undefined && request.body !== null) {
      if (Buffer.isBuffer(request.body)) {
        payload = request.body;
      } else if (typeof request.body === 'string') {
        payload = Buffer.from(request.body);
      } else {
        payload = Buffer.from(JSON.stringify(request.body));
        headers['content-type'] ??= 'application/json';
      }
      if (payload.length) {
        headers['content-type'] ??= 'application/json';
        headers['content-length'] = String(payload.length);
      } else {
        payload = undefined;
      }
    }

    const transport = url.protocol === 'https:' ? https : http;
    const timeout = request.timeout ?? this.timeout;
    return new Promise((resolve, reject) => {
      const timedOut = () => {
        const error: NodeJS.ErrnoException = new Error(TIMED_OUT_MESSAGE);
        error.code = TIMED_OUT;
        // Before the connection is closed, whose end would be a failure that is tried again
        reject(error);
        outgoing.destroy(error);
      };
      const outgoing = transport.request(
        url,
        {
          method: request.method,
          path: pathToAsk(url, prefix, request.path),
          headers,
          agent: this.agents.get(host.origin),
          // The time a connection may stay silent, counted once one carries the request: the wait
          // for a free one of the 256 is not counted, as in opensearch-js
          timeout,
        },
        (incoming) => {
          // The time limit is the wait for the answer to begin, as in opensearch-js: its body
          // takes the time it takes
          outgoing.off('timeout', timedOut);
          outgoing.setTimeout(0);
          const length = incoming.headers['content-length'];
          const encoding = String(incoming.headers['content-encoding'] ?? '').toLowerCase();
          const refused =
            length === undefined ? undefined : this.refusal(Number(length), /gzip|deflate/.test(encoding));
          if (refused) {
            outgoing.destroy();
            reject(new OpenSearchAnswerRefusedError(refused));
            return;
          }
          const chunks: Buffer[] = [];
          incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
          incoming.on('end', () =>
            resolve({
              status: incoming.statusCode ?? 502,
              headers: incoming.headers,
              body: Buffer.concat(chunks),
            })
          );
          incoming.on('error', reject);
          incoming.on('aborted', () => reject(new Error('Response aborted while reading the body')));
        }
      );
      outgoing.on('timeout', timedOut);
      outgoing.on('error', reject);
      outgoing.end(payload);
    });
  }
}

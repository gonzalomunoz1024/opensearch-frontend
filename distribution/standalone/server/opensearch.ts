/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The connection to OpenSearch: plain HTTP requests against its REST API with Node's own
 * `http` and `https`, kept-alive connections, a time limit, and the next host of the list when
 * one cannot be reached. There is no client library between this and the wire.
 */

import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
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

/** No host of the list could be reached, or none answered in time */
export class OpenSearchUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpenSearchUnavailableError';
  }
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

export class OpenSearchClient {
  private readonly hosts: URL[];
  private readonly agents = new Map<string, http.Agent>();
  private readonly baseHeaders: Record<string, string>;
  private readonly timeout: number;
  private next = 0;

  constructor(config: Config['opensearch']) {
    this.hosts = config.hosts.map((host) => new URL(host));
    this.timeout = config.requestTimeout;
    this.baseHeaders = { ...config.customHeaders };
    if (config.username !== undefined && config.password !== undefined) {
      const token = Buffer.from(`${config.username}:${config.password}`).toString('base64');
      this.baseHeaders.authorization = `Basic ${token}`;
    }
    const ca = config.ssl.certificateAuthorities.map((file) => readFileSync(file));
    for (const host of this.hosts) {
      const agent =
        host.protocol === 'https:'
          ? new https.Agent({
              keepAlive: true,
              maxSockets: 64,
              ca: ca.length ? ca : undefined,
              rejectUnauthorized: config.ssl.verificationMode !== 'none',
              // "certificate" trusts the chain without matching the host name
              checkServerIdentity:
                config.ssl.verificationMode === 'certificate' ? () => undefined : undefined,
            })
          : new http.Agent({ keepAlive: true, maxSockets: 64 });
      this.agents.set(host.origin, agent);
    }
  }

  /** The answer whatever its status; throws only when no host answers */
  async raw(request: OpenSearchRequest): Promise<OpenSearchResponse> {
    let lastError: Error | undefined;
    for (let attempt = 0; attempt < this.hosts.length; attempt += 1) {
      const host = this.hosts[(this.next + attempt) % this.hosts.length];
      try {
        const response = await this.send(host, request);
        this.next = (this.next + attempt) % this.hosts.length;
        return response;
      } catch (error) {
        lastError = error as Error;
        // What reached a host and timed out there is not sent to another: it may have been done
        if ((error as NodeJS.ErrnoException).code === 'ETIMEDOUT') {
          // The next request starts with the host after it, or each would wait for this one
          this.next = (this.next + attempt + 1) % this.hosts.length;
          break;
        }
      }
    }
    throw new OpenSearchUnavailableError(
      `OpenSearch cannot be reached: ${lastError?.message ?? 'no host answered'}`
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

  private send(host: URL, request: OpenSearchRequest): Promise<OpenSearchResponse> {
    const prefix = host.pathname.replace(/\/+$/, "");
    // The path is put after the host as text, so that nothing in it can name another host
    const url = new URL(`${host.origin}${prefix}/${request.path.replace(/^\/+/, "")}`);
    for (const [key, value] of Object.entries(request.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    let payload: Buffer | undefined;
    const headers: Record<string, string> = { ...this.baseHeaders, ...request.headers };
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
      const outgoing = transport.request(
        url,
        {
          method: request.method,
          path: pathToAsk(url, prefix, request.path),
          headers,
          agent: this.agents.get(host.origin),
        },
        (incoming) => {
          const chunks: Buffer[] = [];
          incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
          incoming.on('end', () => {
            clearTimeout(timer);
            resolve({
              status: incoming.statusCode ?? 502,
              headers: incoming.headers,
              body: Buffer.concat(chunks),
            });
          });
          incoming.on('error', (error) => {
            clearTimeout(timer);
            reject(error);
          });
        }
      );
      const timer = setTimeout(() => {
        const error: NodeJS.ErrnoException = new Error(`no answer within ${timeout} ms`);
        error.code = 'ETIMEDOUT';
        outgoing.destroy(error);
      }, timeout);
      outgoing.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      outgoing.end(payload);
    });
  }
}

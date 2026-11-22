/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The little of a web framework this server needs, on Node's own `http`: routes with named
 * parts, a request's body with a size limit, answers as JSON, text or bytes (compressed when
 * that pays), and errors in the shape OpenSearch Dashboards gives them, which scripts written
 * against its API read.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { STATUS_CODES } from 'node:http';
import { gzipSync } from 'node:zlib';

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly attributes?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const badRequest = (message: string) => new HttpError(400, message);
export const notFound = (message = 'Not Found') => new HttpError(404, message);
export const conflict = (message: string) => new HttpError(409, message);

export interface Reply {
  status?: number;
  headers?: Record<string, string>;
  /** An object or array is sent as JSON; text and bytes as they are; nothing for an empty answer */
  body?: unknown;
}

export interface RequestContext {
  req: IncomingMessage;
  method: string;
  /** The path without the base path and without the query */
  path: string;
  query: URLSearchParams;
  params: Record<string, string>;
  /** The body, up to the route's limit */
  body(): Promise<Buffer>;
  /** The body as JSON; an empty body is `undefined` */
  json<T = unknown>(): Promise<T | undefined>;
}

export type Handler = (context: RequestContext) => Promise<Reply> | Reply;

interface Route {
  method: string;
  segments: string[];
  handler: Handler;
  maxBytes?: number;
}

export interface RouteOptions {
  /** A larger or smaller limit than the server's for this route's body */
  maxBytes?: number;
}

export class Router {
  private readonly routes: Route[] = [];

  add(method: string, pattern: string, handler: Handler, options: RouteOptions = {}) {
    this.routes.push({
      method,
      segments: pattern.split('/').filter(Boolean),
      handler,
      maxBytes: options.maxBytes,
    });
  }
  get(pattern: string, handler: Handler, options?: RouteOptions) {
    this.add('GET', pattern, handler, options);
  }
  post(pattern: string, handler: Handler, options?: RouteOptions) {
    this.add('POST', pattern, handler, options);
  }
  put(pattern: string, handler: Handler, options?: RouteOptions) {
    this.add('PUT', pattern, handler, options);
  }
  delete(pattern: string, handler: Handler, options?: RouteOptions) {
    this.add('DELETE', pattern, handler, options);
  }

  /**
   * The route for a method and a path. `{name}` in a pattern matches one part of the path,
   * `{name*}` at the end matches the rest. When the path is known under another method only,
   * `allowed` names the methods it does answer.
   */
  match(
    method: string,
    path: string
  ): { route?: Route; params: Record<string, string>; allowed: string[] } {
    const parts = path.split('/').filter(Boolean);
    const allowed = new Set<string>();
    for (const route of this.routes) {
      const params = matchSegments(route.segments, parts);
      if (!params) continue;
      if (route.method === method || (method === 'HEAD' && route.method === 'GET')) {
        return { route, params, allowed: [] };
      }
      allowed.add(route.method);
    }
    return { params: {}, allowed: [...allowed] };
  }
}

function matchSegments(pattern: string[], parts: string[]): Record<string, string> | undefined {
  const params: Record<string, string> = {};
  for (let index = 0; index < pattern.length; index += 1) {
    const segment = pattern[index];
    if (segment.startsWith('{') && segment.endsWith('*}')) {
      params[segment.slice(1, -2)] = parts.slice(index).map(decode).join('/');
      return params;
    }
    if (index >= parts.length) return undefined;
    if (segment.startsWith('{') && segment.endsWith('}')) {
      params[segment.slice(1, -1)] = decode(parts[index]);
    } else if (segment !== parts[index]) {
      return undefined;
    }
  }
  return pattern.length === parts.length ? params : undefined;
}

function decode(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    throw badRequest('The address has a badly encoded part');
  }
}

export function readBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > maxBytes) {
      req.resume();
      reject(new HttpError(413, `The request is larger than the ${maxBytes} bytes allowed`));
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        req.destroy();
        reject(new HttpError(413, `The request is larger than the ${maxBytes} bytes allowed`));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export function errorBody(status: number, message: string, attributes?: Record<string, unknown>) {
  return {
    statusCode: status,
    error: STATUS_CODES[status] ?? 'Error',
    message,
    ...(attributes ? { attributes } : {}),
  };
}

const COMPRESS_FROM_BYTES = 1400;

export function sendReply(req: IncomingMessage, res: ServerResponse, reply: Reply) {
  const headers: Record<string, string> = { ...reply.headers };
  let payload: Buffer | undefined;
  const { body } = reply;
  if (Buffer.isBuffer(body)) {
    payload = body;
  } else if (typeof body === 'string') {
    payload = Buffer.from(body);
    headers['content-type'] ??= 'text/plain; charset=utf-8';
  } else if (body !== undefined && body !== null) {
    payload = Buffer.from(JSON.stringify(body));
    headers['content-type'] ??= 'application/json; charset=utf-8';
  }

  if (payload) {
    const type = headers['content-type'] ?? 'application/octet-stream';
    headers['content-type'] = type;
    const compressible = /json|text|javascript|xml|svg/.test(type) && !headers['content-encoding'];
    const accepts = String(req.headers['accept-encoding'] ?? '');
    if (compressible && payload.length >= COMPRESS_FROM_BYTES && /\bgzip\b/.test(accepts)) {
      payload = gzipSync(payload, { level: 5 });
      headers['content-encoding'] = 'gzip';
      headers.vary = 'accept-encoding';
    }
    headers['content-length'] = String(payload.length);
  }

  res.writeHead(reply.status ?? (payload ? 200 : 204), headers);
  res.end(req.method === 'HEAD' ? undefined : payload);
}

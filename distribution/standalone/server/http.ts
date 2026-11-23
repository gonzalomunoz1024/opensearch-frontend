/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The little of a web framework this server needs, on Node's own `http`: routes with named
 * parts, a request's body with a size limit, answers as JSON, text or bytes (compressed when the
 * client accepts it, as hapi, the server under OpenSearch Dashboards, decides it), and errors in
 * the shape OpenSearch Dashboards gives them, which scripts written against its API read.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { STATUS_CODES } from 'node:http';
import { promisify } from 'node:util';
import { deflate, gzip } from 'node:zlib';

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

/** The client went away before its request was read: there is no one to answer */
export class ClientClosedError extends Error {
  constructor() {
    super('The client closed the connection before its request was read');
    this.name = 'ClientClosedError';
  }
}

/**
 * A path with an escape that cannot be decoded (`%zz`, `%`, `%C3%28`): hapi answers it with its
 * route for a path it cannot read (the special route badRequest, `Boom.badRequest()`), in its words
 */
export class UnreadablePathError extends HttpError {
  constructor() {
    super(400, 'Bad Request');
    this.name = 'UnreadablePathError';
  }
}

/**
 * The path of a request target as hapi's router reads it (@hapi/call normalize): each escape in
 * capitals; the escapes of the characters that need none (letters, digits and _!$&'()*+,;=:@-.~)
 * decoded, so that `/api/st%61tus` is `/api/status`; then `.` and `..` taken as steps.
 */
export function normalizePath(path: string): string {
  let normalized = path;
  if (normalized.includes('%')) {
    normalized = normalized
      .replace(/%[0-9a-fA-F]{2}/g, (escape) => escape.toUpperCase())
      .replace(/%(?:2[146-9A-E]|3[\dABD]|4[\dA-F]|5[\dAF]|6[1-9A-F]|7[\dAE])/g, (escape) =>
        String.fromCharCode(parseInt(escape.slice(1), 16))
      );
  }
  if (normalized.includes('/.') || normalized.startsWith('.')) {
    const leadingSlash = normalized.startsWith('/');
    const kept: string[] = [];
    const segments = normalized.split('/');
    for (const segment of segments) {
      if (segment === '..') kept.pop();
      else if (segment !== '.') kept.push(segment);
    }
    // A step at the end leaves a slash there
    const last = segments[segments.length - 1];
    if (last === '.' || last === '..') kept.push('');
    normalized = kept.join('/');
    if (leadingSlash && !normalized.startsWith('/')) normalized = `/${normalized}`;
  }
  return normalized;
}

/**
 * The path of a request target as hapi takes it from a target that starts with "/" (request.js
 * _parseUrl, its fast way): the text before the first "?" or "#", as it was sent. An address
 * would make a "\" a "/", and hapi does not.
 */
export function targetPath(target: string): string {
  const end = target.search(/[?#]/);
  return end === -1 ? target : target.slice(0, end);
}

/** Whether each escape of a path can be decoded, as hapi's router decodes the parts it matches */
export function readablePath(path: string): boolean {
  try {
    decodeURIComponent(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * The body of a request read to its end and dropped, as hapi's routes of no route (not found, a
 * path it cannot read) do before they answer, so that a client still sending it reads the answer
 */
export function drainBody(req: IncomingMessage): Promise<void> {
  return new Promise((done) => {
    if (req.readableEnded || req.destroyed) {
      done();
      return;
    }
    req.once('end', () => done());
    req.once('close', () => done());
    req.once('error', () => done());
    req.resume();
  });
}

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
  /**
   * The body as its content type says: JSON (also when there is no type, or it is text), a form
   * as an object of its fields; an empty body is `undefined`. Another type is refused, as hapi
   * refuses it.
   */
  json<T = unknown>(): Promise<T | undefined>;
}

export type Handler = (context: RequestContext) => Promise<Reply> | Reply;

interface Route {
  method: string;
  /** As it was registered: `/api/saved_objects/{type}/{id}` */
  pattern: string;
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
      pattern,
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
   * `{name*}` at the end matches the rest. Every part of the path counts, as in hapi: `/api//status`
   * and `/api/status/` are not `/api/status`. When the path is known under another method only,
   * `allowed` names the methods it does answer.
   */
  match(
    method: string,
    path: string
  ): { route?: Route; params: Record<string, string>; allowed: string[] } {
    const parts = path === '/' ? [] : path.split('/').slice(1);
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
      // A named part is never empty
      if (parts[index] === '') return undefined;
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
    throw new UnreadablePathError();
  }
}

/** What hapi answers when a body is larger than the limit, in its words */
export const payloadTooLarge = (maxBytes: number) =>
  new HttpError(413, `Payload content length greater than maximum allowed: ${maxBytes}`);

/**
 * A request's body, up to `maxBytes`. Past that, with a length declared or not, the answer is a
 * 413, once the rest of the body has come and been dropped, as hapi reads it to its end before it
 * answers (route.js drain): the client reads the answer, also on a connection it asked to close,
 * and the connection can carry its next request.
 */
export function readBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = Number(req.headers['content-length'] ?? 0) > maxBytes;
    req.on('data', (chunk: Buffer) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > maxBytes) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => (tooLarge ? reject(payloadTooLarge(maxBytes)) : resolve(Buffer.concat(chunks))));
    // A client that goes away in the middle of its body is no failure of the server
    req.on('error', () => reject(new ClientClosedError()));
    req.on('close', () => {
      if (!req.complete) reject(new ClientClosedError());
    });
  });
}

/** The names hapi's errors (Boom) give the statuses where they are not Node's */
const BOOM_NAMES: Record<number, string> = {
  408: 'Request Time-out',
  413: 'Request Entity Too Large',
  414: 'Request-URI Too Large',
  416: 'Requested Range Not Satisfiable',
  504: 'Gateway Time-out',
};

export function errorBody(status: number, message: string, attributes?: Record<string, unknown>) {
  return {
    statusCode: status,
    error: BOOM_NAMES[status] ?? STATUS_CODES[status] ?? 'Unknown',
    message,
    ...(attributes ? { attributes } : {}),
  };
}

/** The type and subtype of a content-type header, in small letters: `application/json` */
export const mediaType = (header: string | undefined) =>
  (header ?? '').split(';')[0].trim().toLowerCase();

/**
 * How hapi reads a body for a route that validates it: JSON for JSON, the fields of a form, and a
 * 415 for any other type. Text is read as JSON when it is JSON, and is otherwise given as it is,
 * for the route's schema to refuse in its words, as the schemas of the original read text. A key
 * `__proto__` is refused as JSON that cannot be read, as hapi refuses it in JSON (in text too
 * here, where the original's schemas leave the key out: not every route here has a schema).
 */
export function parseBody(body: Buffer, contentType: string | undefined): unknown {
  const type = mediaType(contentType);
  const text = body.toString('utf8');
  if (type === 'application/x-www-form-urlencoded') {
    if (text === '') return undefined;
    const fields: Record<string, string | string[]> = Object.create(null);
    for (const [name, value] of new URLSearchParams(text)) {
      const before = fields[name];
      fields[name] = before === undefined ? value : [...(Array.isArray(before) ? before : [before]), value];
    }
    return fields;
  }
  const isText = type.startsWith('text/');
  if (type !== '' && type !== 'application/json' && !/^application\/[^/]+\+json$/.test(type) && !isText) {
    throw new HttpError(415, 'Unsupported Media Type');
  }
  if (text.trim() === '') return undefined;
  // hapi's parser (bourne, protoAction 'error') refuses a key __proto__ anywhere in the body
  let forbidden = false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text, (key: string, value: unknown) => {
      if (key === '__proto__') forbidden = true;
      return value;
    });
  } catch {
    if (isText) return text;
    throw badRequest('Invalid request payload JSON format');
  }
  if (forbidden) throw badRequest('Invalid request payload JSON format');
  return parsed;
}

/**
 * The coding of an answer for a request's accept-encoding, as hapi (@hapi/accept) picks it among
 * identity, gzip and deflate: a weight of 0 refuses a coding, "*" picks no coding (identity comes
 * first), gzip comes before deflate at the same weight, x-gzip is gzip, and a header that cannot
 * be read is no coding.
 */
export function acceptedEncoding(header: string | string[] | undefined): 'gzip' | 'deflate' | undefined {
  const raw = Array.isArray(header) ? header.join(',') : header;
  if (!raw) return undefined;
  const preferences = ['identity', 'gzip', 'deflate'];
  interface Selection {
    token: string;
    position: number;
    q: number;
    preference?: number;
  }
  const selections: Selection[] = [];
  const named = new Set<string>();
  const parts = raw.replace(/[ \t]/g, '').split(',');
  for (let position = 0; position < parts.length; position += 1) {
    const part = parts[position];
    if (!part) continue;
    const params = part.split(';');
    if (params.length > 2) return undefined;
    let token = params[0].toLowerCase();
    if (!token) return undefined;
    if (token === 'x-gzip') token = 'gzip';
    if (token === 'x-compress') token = 'compress';
    const at = preferences.indexOf(token);
    const selection: Selection = { token, position, q: 1, preference: at === -1 ? undefined : at };
    named.add(token);
    if (params.length === 2) {
      const [key, value] = params[1].split('=');
      if (!value || (key !== 'q' && key !== 'Q')) return undefined;
      const score = parseFloat(value);
      if (score === 0) continue;
      if (Number.isFinite(score) && score <= 1 && score >= 0.001) selection.q = score;
    }
    selections.push(selection);
  }
  selections.sort((a, b) => {
    if (b.q !== a.q) return b.q - a.q;
    if (b.preference !== a.preference) {
      if (a.preference === undefined) return 1;
      if (b.preference === undefined) return -1;
      return a.preference - b.preference;
    }
    return a.position - b.position;
  });
  const values = selections.map((selection) => selection.token);
  if (!named.has('identity')) values.push('identity');
  const preferred: string[] = [];
  for (const value of values) {
    if (value === '*') preferred.push(...preferences.filter((preference) => !named.has(preference)));
    else if (preferences.includes(value)) preferred.push(value);
  }
  const first = preferred[0];
  return first === 'gzip' || first === 'deflate' ? first : undefined;
}

// hapi's compression.minBytes: a shorter answer is sent as it is, and says nothing of codings
const COMPRESS_FROM_BYTES = 1024;
const COMPRESSIBLE = /json|text|javascript|xml|svg/;
const compressors = { gzip: promisify(gzip), deflate: promisify(deflate) };

/** A header's value with `value` added, as hapi adds to vary */
function withVary(existing: string | string[] | undefined, value: string): string {
  const values = (Array.isArray(existing) ? existing.join(',') : existing ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (values.some((item) => item === '*' || item.toLowerCase() === value)) return values.join(',');
  return [...values, value].join(',');
}

export interface SendOptions {
  /** false: never compressed (server.compression.enabled, or a referrer not on its list) */
  compress?: boolean;
  /** Headers put over the answer's own, whatever the case of their names (server.customResponseHeaders) */
  headers?: Record<string, string | string[]>;
}

/**
 * Sends an answer. A body that pays for it (1 kB or more, of a type that compresses) says
 * `vary: accept-encoding` and is compressed when the client accepts it; the compression runs off
 * the event loop.
 */
export async function sendReply(
  req: IncomingMessage,
  res: ServerResponse,
  reply: Reply,
  options: SendOptions = {}
): Promise<void> {
  // Names in small letters, so that a header put over another replaces it
  const headers: Record<string, string | string[]> = {};
  for (const given of [reply.headers ?? {}, options.headers ?? {}]) {
    for (const [name, value] of Object.entries(given)) headers[name.toLowerCase()] = value;
  }
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
    const type = String(headers['content-type'] ?? 'application/octet-stream');
    headers['content-type'] = type;
    if (COMPRESSIBLE.test(type) && payload.length >= COMPRESS_FROM_BYTES) {
      headers.vary = withVary(headers.vary, 'accept-encoding');
      const encoding =
        options.compress === false || headers['content-encoding'] || req.method === 'HEAD'
          ? undefined
          : acceptedEncoding(req.headers['accept-encoding']);
      if (encoding) {
        payload = await compressors[encoding](payload);
        headers['content-encoding'] = encoding;
      }
    }
    headers['content-length'] = String(payload.length);
  }
  const status = reply.status ?? (payload ? 200 : 204);
  // An answer with nothing in it says so (a redirect), instead of being sent in chunks
  if (!payload && status !== 204 && status !== 304) headers['content-length'] = '0';

  res.writeHead(status, headers);
  res.end(req.method === 'HEAD' ? undefined : payload);
}

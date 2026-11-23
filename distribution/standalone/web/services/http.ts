/* SPDX-License-Identifier: Apache-2.0 */

/* Requests to this product's own server: the base path, the header it asks for, its errors. */

export class HttpFetchError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: unknown,
    /** The words of the answer's status, "Bad Request" */
    public readonly statusText = ''
  ) {
    super(message);
    this.name = 'HttpFetchError';
  }
}

const BIG = '\u0000bigint:';

/**
 * JSON with whole numbers too long for JavaScript (BigInt, as DQL reads them) written out in full,
 * as OpenSearch Dashboards sends them with data:withLongNumerals
 */
export function stringifyJson(value: unknown, space?: number): string {
  let big = false;
  const text = JSON.stringify(
    value,
    (_key, item: unknown) => {
      if (typeof item !== 'bigint') return item;
      big = true;
      return `${BIG}${item.toString()}\u0000`;
    },
    space
  );
  return big ? text.replace(/"\\u0000bigint:(-?\d+)\\u0000"/g, '$1') : text;
}

export interface FetchOptions {
  method?: string;
  query?: Record<string, string | number | boolean | string[] | undefined>;
  /** An object is sent as JSON; text and form data as they are */
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Give the answer back as text, whatever its type */
  asText?: boolean;
}

export class Http {
  constructor(public readonly basePath: string) {}

  prepend(path: string) {
    return `${this.basePath}${path}`;
  }

  async fetch<T = unknown>(path: string, options: FetchOptions = {}): Promise<T> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value === undefined) continue;
      if (Array.isArray(value)) for (const item of value) params.append(key, item);
      else params.set(key, String(value));
    }
    const query = params.toString();
    const headers: Record<string, string> = { 'osd-xsrf': 'true', ...options.headers };
    let body: BodyInit | undefined;
    if (typeof options.body === 'string' || options.body instanceof FormData) {
      body = options.body;
      if (typeof options.body === 'string') headers['content-type'] ??= 'application/json';
    } else if (options.body !== undefined) {
      body = stringifyJson(options.body);
      headers['content-type'] ??= 'application/json';
    }

    let response: Response;
    try {
      response = await fetch(`${this.prepend(path)}${query ? `?${query}` : ''}`, {
        method: options.method ?? 'GET',
        headers,
        body,
        signal: options.signal,
        credentials: 'same-origin',
      });
    } catch (error) {
      if ((error as Error).name === 'AbortError') throw error;
      // As the original's: the browser's own words ("Failed to fetch")
      throw new HttpFetchError(0, error instanceof Error ? error.message : 'Failed to fetch');
    }

    const text = await response.text();
    let parsed: unknown = text;
    if (!options.asText && /json/.test(response.headers.get('content-type') ?? '')) {
      try {
        parsed = text === '' ? undefined : JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    if (!response.ok) {
      throw new HttpFetchError(response.status, messageOf(parsed, response.status), parsed, response.statusText);
    }
    return parsed as T;
  }

  get<T = unknown>(path: string, options: FetchOptions = {}) {
    return this.fetch<T>(path, { ...options, method: 'GET' });
  }
  post<T = unknown>(path: string, options: FetchOptions = {}) {
    return this.fetch<T>(path, { ...options, method: 'POST' });
  }
  put<T = unknown>(path: string, options: FetchOptions = {}) {
    return this.fetch<T>(path, { ...options, method: 'PUT' });
  }
  delete<T = unknown>(path: string, options: FetchOptions = {}) {
    return this.fetch<T>(path, { ...options, method: 'DELETE' });
  }
}

/** The sentence of an error answer, from this server or passed on from OpenSearch */
export function messageOf(body: unknown, status: number): string {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    const error = record.error as Record<string, unknown> | string | undefined;
    if (error && typeof error === 'object') {
      const causes = error.root_cause as Array<{ reason?: string; type?: string }> | undefined;
      const reason = (error.reason as string | undefined) ?? causes?.[0]?.reason;
      const failed = (error.failed_shards as Array<{ reason?: { reason?: string } }> | undefined)?.[0]
        ?.reason?.reason;
      const details = (error as { details?: string }).details;
      if (failed) return failed;
      if (causes?.[0]?.reason && causes[0].reason !== reason) return `${reason}: ${causes[0].reason}`;
      if (reason) return details ? `${reason}: ${details}` : reason;
      if (typeof error.type === 'string') return error.type;
    }
    if (typeof record.message === 'string') return record.message;
    if (typeof error === 'string') return error;
  }
  if (typeof body === 'string' && body.trim() !== '' && body.length < 400) return body;
  return `The request failed (${status})`;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

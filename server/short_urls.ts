/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Short URLs, as the share plugin of OpenSearch Dashboards keeps them: `POST /api/shorten_url`
 * stores an address of this product as a `url` saved object whose id is the MD5 of the address,
 * `GET /goto/{id}` sends the browser there and `GET /api/short_url/{id}` tells it. Both count
 * the visit in the object's `accessCount` and `accessDate`.
 *
 * Addresses are checked and rewritten with Node's legacy URL parser, the one the plugin uses, so
 * that the same address is refused with the same message and leads to the same `location`.
 */

import { createHash } from 'node:crypto';
import { format as formatUrl, parse as parseUrl } from 'node:url';
import { HttpError, type Router } from './http';
import type { Logger } from './logger';
import type { SavedObjectsRepository } from './saved_objects';

const TYPE = 'url';

/** The id of the short URL of an address: the same address always gets the same one */
export function shortUrlId(url: string): string {
  return createHash('md5').update(url).digest('hex');
}

/**
 * Refuses what is not an address of this product: one with a protocol or a host, or one whose
 * path does not start with `/app/{appId}` (after a workspace's `/w/{id}`).
 */
export function assertShortUrlValid(url: string): void {
  const { protocol, hostname, pathname } = parseUrl(url, false, true);
  if (protocol !== null) {
    throw new HttpError(406, `Short url targets cannot have a protocol, found "${protocol}"`);
  }
  if (hostname !== null) {
    throw new HttpError(406, `Short url targets cannot have a hostname, found "${hostname}"`);
  }
  let parts = (pathname ?? '').replace(/^\/+|\/+$/g, '').split('/');
  if (parts[0] === 'w') parts = parts.slice(2);
  if (parts[0] !== 'app' || !parts[1]) {
    throw new HttpError(
      406,
      `Short url target path must be in the format "/app/{{appId}}", found "${pathname}"`
    );
  }
}

/** Where `/goto/{id}` sends the browser: the stored address under the server's base path */
export function gotoLocation(url: string, basePath: string): string {
  const parsed = parseUrl(url, true);
  const { hostname } = parsed;
  let { pathname } = parsed;
  if (!hostname && pathname && pathname.startsWith('/')) pathname = `${basePath}${pathname}`;
  return formatUrl({
    auth: parsed.auth,
    hash: parsed.hash,
    hostname,
    pathname,
    port: parsed.port,
    protocol: parsed.protocol,
    query: parsed.query ?? {},
    slashes: parsed.slashes,
  });
}

/** What the type of a value is called in the answers of OpenSearch Dashboards' validation */
function typeName(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'Array';
  return typeof value === 'object' ? 'Object' : typeof value;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The address in the body of `POST /api/shorten_url`, refused as the original refuses it */
export function readShortenBody(body: unknown): string {
  // An empty body reaches the original's validation as null, and a text as JSON to parse
  let value: unknown = body === undefined ? null : body;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      throw new HttpError(400, '[request body]: could not parse object value from json input');
    }
  }
  if (!isPlainObject(value)) {
    throw new HttpError(
      400,
      `[request body]: expected a plain object value, but found [${typeName(value)}] instead.`
    );
  }
  const { url } = value;
  if (typeof url !== 'string') {
    throw new HttpError(
      400,
      `[request body.url]: expected value of type [string] but got [${typeName(url)}]`
    );
  }
  const unknownKey = Object.keys(value).find((key) => key !== 'url');
  if (unknownKey !== undefined) {
    throw new HttpError(400, `[request body.${unknownKey}]: definition for this key is missing`);
  }
  return url;
}

export function registerShortUrls(
  router: Router,
  repository: SavedObjectsRepository,
  options: { basePath: string; logger: Logger }
) {
  const { basePath, logger } = options;

  // The stored address. The visit is counted without waiting for it, and a failure to count it
  // only gets a warning, as in the original.
  const lookUp = async (id: string): Promise<string> => {
    const object = await repository.get(TYPE, id);
    const attributes = object.attributes as { url?: unknown; accessCount?: unknown };
    const count = attributes.accessCount;
    repository
      .update(TYPE, id, {
        accessDate: Date.now(),
        accessCount: (typeof count === 'number' ? count : 0) + 1,
      })
      .catch((error: unknown) => {
        logger.warn('Warning: Error updating url metadata', { error: String(error) });
      });
    if (typeof attributes.url !== 'string') {
      throw new Error(`The short url ${id} has no address`);
    }
    return attributes.url;
  };

  router.post('/api/shorten_url', async (context) => {
    const url = readShortenBody(await context.json());
    assertShortUrlValid(url);
    const id = shortUrlId(url);
    const now = Date.now();
    try {
      await repository.create(TYPE, { url, accessCount: 0, createDate: now, accessDate: now }, { id });
    } catch (error) {
      // The address was shortened before: it keeps its object and its counts
      if (!(error instanceof HttpError && error.status === 409)) throw error;
    }
    return { body: { urlId: id } };
  });

  router.get('/api/short_url/{urlId}', async ({ params }) => {
    const url = await lookUp(params.urlId);
    assertShortUrlValid(url);
    return { body: { url } };
  });

  router.get('/goto/{urlId}', async ({ params }) => {
    const url = await lookUp(params.urlId);
    assertShortUrlValid(url);
    // An empty answer that says so, without a type, as the original's
    return { status: 302, headers: { location: gotoLocation(url, basePath), 'content-length': '0' } };
  });
}

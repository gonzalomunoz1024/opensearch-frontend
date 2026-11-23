/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The server: the browser side's files, and the API it calls. The browser never talks to
 * OpenSearch itself; everything goes through here.
 *
 * Where it costs nothing the API keeps the paths and shapes of OpenSearch Dashboards 3.9.0
 * (`/api/status`, `/api/saved_objects/...`, `/api/opensearch-dashboards/settings`,
 * `/api/console/proxy`), so that scripts and probes written for it keep working.
 *
 * Every request goes the way it goes in the original's server (src/core/server/http): the base
 * path is taken off when server.rewriteBasePath says requests carry it, a request that changes
 * something needs the osd-xsrf header, an osd-version header must name this version, and every
 * answer carries server.customResponseHeaders and osd-name.
 */

import { constants as cryptoConstants, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import type { Socket } from 'node:net';
import { join } from 'node:path';
import type { Duplex } from 'node:stream';
import type { Config, ServerSslConfig } from './config';
import { registerConsole } from './console_proxy';
import {
  ClientClosedError,
  HttpError,
  Router,
  badRequest,
  errorBody,
  parseBody,
  readBody,
  sendReply,
  type Handler,
  type Reply,
  type RequestContext,
} from './http';
import { registerIndexManagement } from './index_management';
import { registerIndexPatternManagement } from './index_pattern_management';
import { registerGeospatial } from './geospatial';
import { fieldsForWildcard } from './index_pattern_fields';
import type { Logger } from './logger';
import {
  OpenSearchAnswerRefusedError,
  OpenSearchClient,
  OpenSearchError,
  OpenSearchUnavailableError,
  withForwardedHeaders,
} from './opensearch';
import { SavedObjectsRepository } from './saved_objects';
import { registerSavedObjectsManagement } from './saved_objects_management';
import { registerSavedObjects } from './saved_objects_routes';
import {
  any,
  arrayOf,
  literal,
  maybe,
  object,
  oneOf,
  queryObject,
  string,
  validateRequestPart,
} from './route_validation';
import { registerSampleData } from './sample_data/routes';
import { registerSearch } from './search_routes';
import { registerShortUrls } from './short_urls';
import { registerSqlConsole } from './sql_console';
import { contentSecurityPolicy, cspNonce, readBuild, renderPage, serveStatic } from './static';
import { registerTsvbFields } from './tsvb_fields';
import { registerTimeline } from './timeline';
import { UiSettings } from './ui_settings';
import { registerValueSuggestions } from './value_suggestions';

export const PRODUCT_NAME = 'InfraDashboard';

const PROXY_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'HEAD', 'PATCH']);
const HEALTHY_EVERY_MS = 10000;
const UNHEALTHY_EVERY_MS = 2500;

/** The header size the original's start script allows (--max-http-header-size=65536) */
const MAX_HEADER_BYTES = 65536;
/** What the original's routes say of caching when they say nothing */
const NO_CACHE = 'private, no-cache, no-store, must-revalidate';
const SAFE_METHODS = new Set(['GET', 'HEAD']);

/** The TLS options of the original (http_tools.ts getServerOptions, ssl_config.ts) */
function tlsOptions(ssl: ServerSslConfig): https.ServerOptions {
  const turnedOff: Record<string, number> = {
    TLSv1: cryptoConstants.SSL_OP_NO_TLSv1,
    'TLSv1.1': cryptoConstants.SSL_OP_NO_TLSv1_1,
    'TLSv1.2': cryptoConstants.SSL_OP_NO_TLSv1_2,
    'TLSv1.3': cryptoConstants.SSL_OP_NO_TLSv1_3,
  };
  let secureOptions = 0;
  for (const [protocol, option] of Object.entries(turnedOff)) {
    if (!ssl.supportedProtocols.includes(protocol)) secureOptions |= option;
  }
  return {
    // The files are read when they are named, whether TLS is on or not, as the original reads them
    ca: ssl.certificateAuthorities.length ? ssl.certificateAuthorities.map((file) => readFileSync(file)) : undefined,
    cert: ssl.certificate === undefined ? undefined : readFileSync(ssl.certificate),
    key: ssl.key === undefined ? undefined : readFileSync(ssl.key),
    passphrase: ssl.keyPassphrase,
    ciphers: ssl.cipherSuites.join(':'),
    // The server's order of ciphers, not the client's (the original: against the BEAST attack)
    honorCipherOrder: true,
    secureOptions,
    requestCert: ssl.clientAuthentication !== 'none',
    rejectUnauthorized: ssl.clientAuthentication === 'required',
  };
}

/** What of an HTTP or HTTPS server the set-up of its listener touches */
interface Listening {
  headersTimeout: number;
  keepAliveTimeout: number;
  setTimeout(msecs: number, callback: (socket: Socket) => void): unknown;
  on(event: 'clientError', listener: (error: Error, socket: Duplex) => void): unknown;
}

/** How the original sets up the listener of a server (http_tools.ts createServer) */
function setUpListener(server: Listening, settings: Config['server']) {
  server.headersTimeout = settings.keepaliveTimeout + 2 * server.headersTimeout;
  server.keepAliveTimeout = settings.keepaliveTimeout;
  server.setTimeout(settings.socketTimeout, (socket) => socket.destroy());
  // A request that cannot be read is answered with a bare 400, a header too large too
  server.on('clientError', (error, socket) => {
    if (socket.writable) socket.end(Buffer.from('HTTP/1.1 400 Bad Request\r\n\r\n', 'ascii'));
    else socket.destroy(error);
  });
}

/** A route's path with its parts' names left out, `/a/{}/{}`: the names of a route in server.xsrf.whitelist need not be ours */
const routeShape = (pattern: string) => pattern.replace(/\{[^}]*\}/g, '{}');

/** The shapes of the routes server.xsrf.whitelist names; `/a/{id?}` names `/a` too */
function xsrfExempt(allowlist: string[]): Set<string> {
  const shapes = new Set<string>();
  for (const entry of allowlist) {
    shapes.add(routeShape(entry));
    const optional = /\/\{[^}]*\?\}$/.exec(entry);
    if (optional) shapes.add(routeShape(entry.slice(0, optional.index) || '/'));
  }
  return shapes;
}

/**
 * The meta fields of a request of the fields of a pattern: a list as it came (the parameter
 * repeated), one parameter read as JSON as the original reads it. One that is no JSON is one
 * name here, where the original answers 400, so that a single meta field (the parameter once,
 * as a browser sends a list of one) is not refused.
 */
export function metaFieldsOf(given: string | string[]): string[] {
  if (Array.isArray(given)) return given;
  try {
    const parsed: unknown = JSON.parse(given);
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) return parsed as string[];
    if (typeof parsed === 'string') return [parsed];
  } catch {
    // one name
  }
  return [given];
}

/** A search's path with the original's shard time limit (getShardTimeout), unless it has one */
export function withShardTimeout(path: string, ms: number): string {
  const at = path.indexOf('?');
  const pathname = at === -1 ? path : path.slice(0, at);
  const search = at === -1 ? '' : path.slice(at + 1);
  if (ms <= 0 || !/(^|\/)_search$/.test(pathname) || new URLSearchParams(search).has('timeout')) return path;
  return `${pathname}?${search ? `${search}&` : ''}timeout=${ms}ms`;
}

/** The host name of an address the redirect of the plain port leads to */
function redirectHost(configured: string, hostHeader: string | undefined): string {
  // An address of every interface leads nowhere: the browser's own name of the server does
  if (configured === '0.0.0.0' || configured === '::' || configured === '') {
    const named = /^(\[[0-9a-fA-F:.]+\]|[A-Za-z0-9.-]+)(:\d+)?$/.exec(hostHeader ?? '');
    return named ? named[1] : 'localhost';
  }
  return configured.includes(':') ? `[${configured}]` : configured;
}

interface Health {
  state: 'green' | 'red';
  message: string;
  since: string;
  opensearchVersion?: string;
}

export interface App {
  server: http.Server | https.Server;
  /** With server.ssl.redirectHttpFromPort: the plain HTTP server that sends browsers to HTTPS */
  redirectServer?: http.Server;
  /** Starts listening and watching OpenSearch; resolves once the port is open */
  start(): Promise<void>;
  /** Stops taking requests, lets the running ones finish, then closes */
  stop(): Promise<void>;
  /** Asks OpenSearch now instead of waiting for the next look */
  checkHealth(): Promise<Health>;
}

export function createApp(options: { config: Config; logger: Logger; distDirectory: string }): App {
  const { config, logger, distDirectory } = options;
  const publicDirectory = join(distDirectory, 'public');
  const build = readBuild(distDirectory);
  const client = new OpenSearchClient(config.opensearch);
  const repository = new SavedObjectsRepository(client, config.index);
  const uiSettings = new UiSettings(client, config.index, build.version, config.uiSettings);
  const startedAt = Date.now();

  let health: Health = {
    state: 'red',
    message: 'Waiting for OpenSearch',
    since: new Date().toISOString(),
  };
  let healthTimer: NodeJS.Timeout | undefined;
  let stopping = false;

  const setHealth = (next: Omit<Health, 'since'>) => {
    if (next.state !== health.state || next.message !== health.message) {
      logger[next.state === 'green' ? 'info' : 'warn'](next.message, { status: next.state });
      health = { ...next, since: new Date().toISOString() };
    } else {
      health = { ...health, ...next };
    }
  };

  const checkHealth = async (): Promise<Health> => {
    try {
      const info = await client.request<{ version?: { number?: string } }>({
        method: 'GET',
        path: '/',
        // The time limit of a look at whether OpenSearch answers: opensearch.pingTimeout, and
        // what does not answer within it is not asked again
        timeout: config.opensearch.pingTimeout ?? Math.min(config.opensearch.requestTimeout, 10000),
        retryOnTimeout: false,
      });
      const made = await repository.ensureIndex();
      if (made === 'created') logger.info(`Created the saved objects index ${config.index}_1`);
      setHealth({
        state: 'green',
        message: 'OpenSearch is available',
        opensearchVersion: info.version?.number,
      });
    } catch (error) {
      setHealth({ state: 'red', message: (error as Error).message });
    }
    return health;
  };

  const scheduleHealthCheck = () => {
    if (stopping) return;
    healthTimer = setTimeout(
      () => void checkHealth().finally(scheduleHealthCheck),
      health.state === 'green' ? HEALTHY_EVERY_MS : UNHEALTHY_EVERY_MS
    );
    healthTimer.unref();
  };

  const router = new Router();

  router.get('/api/status', () => {
    const state = health.state;
    return {
      status: state === 'green' ? 200 : 503,
      body: {
        name: config.server.name,
        version: {
          number: build.version,
          build_date: build.builtAt,
          build_snapshot: false,
        },
        status: {
          overall: {
            since: health.since,
            state,
            title: state === 'green' ? 'Green' : 'Red',
            nickname: state === 'green' ? 'Looking good' : 'Danger Will Robinson! Danger!',
          },
          statuses: [
            {
              id: `core:opensearch@${build.version}`,
              message: health.message,
              since: health.since,
              state,
            },
          ],
        },
        opensearch: { hosts: config.opensearch.hosts.length, version: health.opensearchVersion },
        metrics: {
          uptime_in_millis: Date.now() - startedAt,
          process: { memory: { resident_set_size_in_bytes: process.memoryUsage().rss } },
        },
      },
    };
  });

  // --- Saved objects ---------------------------------------------------------------------------

  registerSavedObjects(router, repository, config.savedObjects);
  registerSavedObjectsManagement(router, repository);

  // --- Advanced settings -----------------------------------------------------------------------

  // The checks of the original's routes (src/core/server/ui_settings/routes), with their words:
  // the scopes each route names (there is one scope here, the global one, whichever is named),
  // a body of the keys the route knows. Whether a setting may take a value is the settings' own.
  const scopes = (...names: string[]) =>
    object({ scope: maybe(oneOf(names.map((name) => literal(name)))) }, { unknowns: 'allow' });
  const anyScope = scopes('global', 'user', 'workspace', 'dashboard_admin');
  const oneSettingScope = scopes('global', 'user');
  // An empty body is null to the original's checks
  const settingsBody = async (context: RequestContext) => (await context.json()) ?? null;

  router.get('/api/opensearch-dashboards/settings', async ({ query }) => {
    validateRequestPart(anyScope, queryObject(query), 'query');
    return { body: { settings: await uiSettings.getAll() } };
  });

  router.post('/api/opensearch-dashboards/settings', async (context) => {
    const body = await settingsBody(context);
    validateRequestPart(anyScope, queryObject(context.query), 'query');
    // `{}` is no change at all, as `changes` defaults to an empty object
    const { changes } = validateRequestPart(object({ changes: object({}, { unknowns: 'allow' }) }), body, 'body');
    await uiSettings.setMany(changes);
    return { body: { settings: await uiSettings.getAll() } };
  });

  router.post('/api/opensearch-dashboards/settings/{key}', async (context) => {
    const body = await settingsBody(context);
    validateRequestPart(oneSettingScope, queryObject(context.query), 'query');
    const { value } = validateRequestPart(object({ value: any() }), body, 'body');
    await uiSettings.setMany({ [context.params.key]: value });
    return { body: { settings: await uiSettings.getAll() } };
  });

  router.delete('/api/opensearch-dashboards/settings/{key}', async ({ params, query }) => {
    validateRequestPart(oneSettingScope, queryObject(query), 'query');
    await uiSettings.setMany({ [params.key]: null });
    return { body: { settings: await uiSettings.getAll() } };
  });

  // --- Index patterns --------------------------------------------------------------------------

  // The query of the original's route (src/plugins/data/server/index_patterns/routes.ts); an
  // empty pattern is every index, as there
  const fieldsQuery = object({
    pattern: string(),
    meta_fields: oneOf<string | string[]>([string(), arrayOf(string())], { defaultValue: [] }),
    data_source: maybe(string()),
  });
  router.get('/api/index_patterns/_fields_for_wildcard', async ({ query }) => {
    const { pattern, meta_fields: given, data_source: dataSource } = validateRequestPart(
      fieldsQuery,
      queryObject(query),
      'query'
    );
    // The original turns to the data source named; there are none here (data_source.enabled)
    if (dataSource) throw badRequest('[request query.data_source]: there are no data sources: data_source.enabled is off');
    return { body: { fields: await fieldsForWildcard(client, pattern, metaFieldsOf(given)) } };
  });

  // --- OpenSearch itself -----------------------------------------------------------------------

  // Dev Tools' console: the routes of the original's console plugin
  registerConsole(router, client, config, logger);
  // The search route of the original's data plugin
  registerSearch(router, client, { shardTimeout: config.opensearch.shardTimeout, uiSettings });

  // One request of the pages to OpenSearch, passed on as it is and answered as OpenSearch
  // answers it: the APIs the pages are built on. "." and ".." in its path are names (the title
  // of an index pattern), which the client sends as they are written.
  const pagesRequest: Handler = async (context) => {
    const method = (context.query.get('method') ?? 'GET').toUpperCase();
    const target = context.query.get('path');
    if (!target) throw badRequest('[request query.path]: expected a path');
    if (!PROXY_METHODS.has(method)) throw badRequest(`Method ${method} is not allowed`);
    const body = await context.body();
    let path = `/${target.replace(/^\/+/, '')}`;
    if (method === 'POST' || method === 'GET') {
      // A search of the pages: the original makes it through its search strategy, which asks
      // OpenSearch to give up on a shard after opensearch.shardTimeout
      path = withShardTimeout(path, config.opensearch.shardTimeout);
    }
    const response = await client.raw({
      method,
      path,
      body: body.length ? body : undefined,
      headers: {
        'x-opaque-id': randomUUID(),
        ...(body.length
          ? { 'content-type': String(context.req.headers['content-type'] ?? 'application/json') }
          : {}),
      },
    });
    const headers: Record<string, string> = {
      'content-type': String(response.headers['content-type'] ?? 'text/plain; charset=utf-8'),
    };
    if (response.headers.warning) headers.warning = String(response.headers.warning);
    return { status: response.status, headers, body: response.body };
  };
  router.post('/internal/opensearch', pagesRequest, { maxBytes: config.savedObjects.maxImportPayloadBytes });

  // --- Query Workbench -------------------------------------------------------------------------

  registerSqlConsole(router, client);

  // --- Region maps: the custom vector maps of indices named "*-map" -------------------------------

  registerGeospatial(router, client);

  // --- Index Management ------------------------------------------------------------------------

  registerIndexManagement(router, client);
  registerTimeline(router, { client, repository, uiSettings, config, logger });

  // --- Index patterns: the indices a pattern names, the preview of a scripted field --------------

  registerIndexPatternManagement(router, client);

  // --- TSVB ------------------------------------------------------------------------------------

  registerTsvbFields(router, client, repository, uiSettings);

  // --- Value suggestions of the filter editor --------------------------------------------------

  registerValueSuggestions(router, client, repository);

  // --- Short URLs ------------------------------------------------------------------------------

  registerShortUrls(router, repository, { basePath: config.server.basePath, logger });

  // --- Sample data -----------------------------------------------------------------------------

  registerSampleData(router, client, repository, { logger });

  // --- The pipeline every request goes through -------------------------------------------------

  const page = async (): Promise<Reply> => {
    let settings: Record<string, unknown> = {};
    try {
      if (health.state === 'green') settings = await uiSettings.getUserProvided();
    } catch {
      // the page explains what is wrong once it is up
    }
    // An OpenSearch that does not answer is not asked: the page would wait for the time limit
    const dark =
      health.state === 'green'
        ? await uiSettings.peek<boolean>('theme:darkMode', false)
        : config.uiSettings.overrides['theme:darkMode'] ?? config.uiSettings.defaults['theme:darkMode'];
    const nonce = cspNonce();
    return {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': contentSecurityPolicy(config.map, config.csp, nonce),
        'cache-control': 'no-store',
      },
      body: renderPage({
        basePath: config.server.basePath,
        build,
        title: PRODUCT_NAME,
        dark: dark === true,
        nonce,
        bootData: {
          basePath: config.server.basePath,
          version: build.version,
          name: PRODUCT_NAME,
          settings,
          settingsDefaults: config.uiSettings.defaults,
          settingsOverrides: config.uiSettings.overrides,
          map: config.map,
          visTypeVega: config.visTypeVega,
          home: config.home,
          // console.enabled: the original leaves the console out of Dev Tools when it is false
          console: { enabled: config.console.enabled },
          libraries: {
            vega: `${config.server.basePath}/${build.assets.vega ?? ''}`,
            vegaLite: `${config.server.basePath}/${build.assets.vegaLite ?? ''}`,
          },
        },
      }),
    };
  };

  const errorReply = (error: unknown, req: http.IncomingMessage): Reply => {
    if (error instanceof HttpError) {
      return { status: error.status, body: errorBody(error.status, error.message, error.attributes) };
    }
    if (error instanceof ClientClosedError) {
      logger.debug('The client went away before its request was read', { method: req.method, url: req.url });
      return { status: 400, body: errorBody(400, error.message) };
    }
    if (error instanceof OpenSearchUnavailableError) {
      return { status: 503, body: errorBody(503, error.message) };
    }
    if (error instanceof OpenSearchAnswerRefusedError) {
      return { status: 502, body: errorBody(502, error.message) };
    }
    if (error instanceof OpenSearchError) {
      const status = error.status >= 400 && error.status < 600 ? error.status : 502;
      return { status, body: errorBody(status, error.message, { body: error.body }) };
    }
    logger.error('A request failed', { error: (error as Error).stack ?? String(error) });
    return { status: 500, body: errorBody(500, 'An internal server error occurred.') };
  };

  const notFoundReply = (): Reply => ({ status: 404, body: errorBody(404, 'Not Found') });
  const exempt = xsrfExempt(config.server.xsrf.allowlist);

  // A request that changes something needs a header that a page of another site cannot make a
  // browser send, as in the original (lifecycle_handlers.ts)
  const checkXsrf = (req: http.IncomingMessage, method: string, pattern: string) => {
    if (SAFE_METHODS.has(method) || config.server.xsrf.disableProtection || exempt.has(routeShape(pattern))) return;
    if (req.headers['osd-xsrf'] === undefined && req.headers['osd-version'] === undefined) {
      throw badRequest('Request must contain the osd-xsrf header.');
    }
  };

  // A page of another version is told to load again, with the original's words
  const checkVersion = (req: http.IncomingMessage) => {
    const version = req.headers['osd-version'];
    if (version && version !== build.version) {
      throw new HttpError(
        400,
        'Browser client is out of date, please refresh the page ' +
          `("osd-version" header was "${version}" but should be "${build.version}")`,
        { expected: build.version, got: version }
      );
    }
  };

  // The headers of the request that go on to OpenSearch (opensearch.requestHeadersWhitelist),
  // with an id of the request, as the scoped client of the original sends them. What frames a
  // request is never passed on: it would make OpenSearch read another request than the one sent
  const FRAMING = new Set(['host', 'content-length', 'transfer-encoding', 'connection', 'keep-alive', 'upgrade', 'te', 'trailer']);
  const passedOn = config.opensearch.requestHeadersAllowlist
    .map((name) => name.trim().toLowerCase())
    .filter((name) => !FRAMING.has(name));
  const forwardedHeaders = (req: http.IncomingMessage): Record<string, string> => {
    const headers: Record<string, string> = {};
    for (const name of passedOn) {
      const value = req.headers[name];
      if (value !== undefined) headers[name] = Array.isArray(value) ? value.join(', ') : value;
    }
    headers['x-opaque-id'] = randomUUID();
    return headers;
  };

  /** Where `/` leads: the advanced setting defaultRoute, as in the original (core_app.ts) */
  const defaultRoute = async (): Promise<string> => {
    const fallback = '/app/home';
    // An OpenSearch that does not answer is not asked, as for the page
    const value =
      health.state === 'green'
        ? await uiSettings.peek<unknown>('defaultRoute', fallback)
        : config.uiSettings.overrides.defaultRoute ?? fallback;
    // A path of this server only, as the setting's own check asks ("Must be a relative URL")
    return typeof value === 'string' && /^\/(?![/\\])[^\\\s]*$/.test(value) ? value : fallback;
  };

  // The original's pages: /app/{id} and what is under it
  const APP_PATH = /^\/app\/[^/]+(\/.*)?$/;

  const handle = async (req: http.IncomingMessage): Promise<Reply> => {
    const method = req.method ?? 'GET';
    const target = req.url ?? '/';
    // Nothing is at a path that starts with two slashes, as in OpenSearch Dashboards; new URL()
    // would read what follows them as the name of another host, or fail to (a "\" is a "/" to it)
    if (/^[/\\][/\\]/.test(target)) return notFoundReply();
    let url: URL;
    try {
      url = new URL(target, 'http://localhost');
    } catch {
      throw badRequest('The address of the request cannot be read');
    }
    let path = url.pathname;
    const { basePath, rewriteBasePath } = config.server;
    // With server.rewriteBasePath requests carry the base path, and one without it is not for
    // this server; without it, the proxy in front has taken the base path off (setupBasePathRewrite)
    if (basePath && rewriteBasePath) {
      if (path === basePath) path = '/';
      else if (path.startsWith(`${basePath}/`)) path = path.slice(basePath.length);
      else return notFoundReply();
    }

    const { route, params } = router.match(method, path);
    if (route) {
      const maxBytes = route.maxBytes ?? config.server.maxPayloadBytes;
      let cached: Promise<Buffer> | undefined;
      const body = () => (cached ??= readBody(req, maxBytes));
      // hapi reads the body before it looks at the headers: one said to be larger than the
      // route takes is refused (413) before the osd-xsrf and osd-version checks
      if (!SAFE_METHODS.has(method) && Number(req.headers['content-length'] ?? 0) > maxBytes) await body();
      checkXsrf(req, method, route.pattern);
      checkVersion(req);
      const context: RequestContext = {
        req,
        method,
        path,
        query: url.searchParams,
        params,
        body,
        json: async <T>() => parseBody(await body(), req.headers['content-type']) as T | undefined,
      };
      return withForwardedHeaders(forwardedHeaders(req), () => route.handler(context));
    }
    // A path that only another method has: hapi answers that it is not there
    if (!SAFE_METHODS.has(method)) return notFoundReply();

    // Each GET has a route in the original (the pages, the files, its catch-all), which checks
    // the version as any other
    checkVersion(req);
    if (path === '/') return { status: 302, headers: { location: `${basePath}${await defaultRoute()}` } };
    if (APP_PATH.test(path)) return page();
    const file = serveStatic(publicDirectory, req, path);
    if (file) return file;
    // A path with a slash at its end is sent to the one without it (src/legacy/server/http)
    if (path.endsWith('/')) {
      return {
        status: 301,
        headers: { location: `${basePath}${path.slice(0, -1)}${url.search}`, 'content-type': 'text/html; charset=utf-8' },
        body: '',
      };
    }
    return notFoundReply();
  };

  // What every answer carries, over what its route says: server.customResponseHeaders, then
  // osd-name, as the original's onPreResponse handler puts them
  const answerHeaders: Record<string, string | string[]> = {
    ...config.server.customResponseHeaders,
    'osd-name': config.server.name,
  };
  for (const [name, value] of Object.entries(answerHeaders)) {
    try {
      http.validateHeaderName(name);
      for (const one of Array.isArray(value) ? value : [value]) http.validateHeaderValue(name, one);
    } catch (error) {
      throw new Error(`server.customResponseHeaders: ${(error as Error).message}`);
    }
  }

  // server.compression: off, or only for the pages of the hosts its list names
  const compressionAllowed = (req: http.IncomingMessage): boolean => {
    const { enabled, referrerAllowlist } = config.server.compression;
    if (!enabled) return false;
    const referrer = String(req.headers.referrer ?? req.headers.referer ?? '');
    if (!referrerAllowlist || referrer === '') return true;
    try {
      const { hostname } = new URL('', referrer);
      return hostname !== '' && referrerAllowlist.includes(hostname);
    } catch {
      return false;
    }
  };

  const respond = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const began = process.hrtime.bigint();
    let reply: Reply;
    try {
      reply = await handle(req);
    } catch (error) {
      reply = errorReply(error, req);
    }
    // A client that has gone is not answered, and that is no failure
    if (res.destroyed || req.socket.destroyed) {
      logger.debug('The client went away before the answer', { method: req.method, url: req.url });
      return;
    }
    await sendReply(
      req,
      res,
      {
        ...reply,
        headers: {
          'cache-control': NO_CACHE,
          'x-content-type-options': 'nosniff',
          'referrer-policy': 'no-referrer-when-downgrade',
          ...reply.headers,
        },
      },
      { compress: compressionAllowed(req), headers: answerHeaders }
    );
    logger.debug('request', {
      method: req.method,
      url: req.url,
      status: reply.status ?? 200,
      ms: Number((process.hrtime.bigint() - began) / 1000000n),
    });
  };

  const listener = (req: http.IncomingMessage, res: http.ServerResponse) => {
    void respond(req, res).catch((error: unknown) => {
      logger.error('An answer could not be sent', { error: String(error) });
      // A header that cannot be sent (an address to go to with a character no header may
      // hold) leaves nothing sent: the request is answered as a failure, not cut off
      if (res.headersSent) {
        res.destroy();
        return;
      }
      const failure = { status: 500, headers: { 'cache-control': NO_CACHE }, body: errorBody(500, 'An internal server error occurred.') };
      void sendReply(req, res, failure, { headers: answerHeaders }).catch(() => res.destroy());
    });
  };

  const { ssl } = config.server;
  // The files are read now whether TLS is on or not, as the original reads them
  const tls = tlsOptions(ssl);
  const server = ssl.enabled
    ? https.createServer({ ...tls, maxHeaderSize: MAX_HEADER_BYTES }, listener)
    : http.createServer({ maxHeaderSize: MAX_HEADER_BYTES }, listener);
  setUpListener(server, config.server);

  // server.ssl.redirectHttpFromPort: plain HTTP there is sent to the same path over HTTPS
  // (https_redirect_server.ts), with no other answer
  const redirectPort = ssl.enabled ? ssl.redirectHttpFromPort : undefined;
  const redirectServer =
    redirectPort === undefined
      ? undefined
      : http.createServer({ maxHeaderSize: MAX_HEADER_BYTES }, (req, res) => {
          const target = req.url ?? '/';
          let location: string | undefined;
          if (!/^[/\\][/\\]/.test(target)) {
            try {
              const url = new URL(target, 'http://localhost');
              const host = redirectHost(config.server.host, req.headers.host);
              location = `https://${host}:${config.server.port}${url.pathname}${url.search}`;
            } catch {
              location = undefined;
            }
          }
          const reply: Reply = location
            ? { status: 302, headers: { location, 'cache-control': NO_CACHE } }
            : { status: 404, headers: { 'cache-control': NO_CACHE }, body: errorBody(404, 'Not Found') };
          void sendReply(req, res, reply).catch(() => res.destroy());
        });
  if (redirectServer) setUpListener(redirectServer, config.server);

  const listen = (target: http.Server | https.Server, port: number) =>
    new Promise<void>((resolve, reject) => {
      target.once('error', reject);
      target.listen(port, config.server.host, () => {
        target.off('error', reject);
        resolve();
      });
    });
  const close = (target: http.Server | https.Server) =>
    new Promise<void>((resolve) => {
      target.close(() => resolve());
      target.closeIdleConnections();
    });

  return {
    server,
    redirectServer,
    checkHealth,
    start: async () => {
      // The redirect first, as the original starts it
      if (redirectServer && redirectPort !== undefined) {
        await listen(redirectServer, redirectPort).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'EADDRINUSE') throw error;
          throw new Error(
            `The redirect server failed to start up because port ${redirectPort} is already in use. ` +
              'Ensure the port specified in `server.ssl.redirectHttpFromPort` is available.'
          );
        });
      }
      try {
        await listen(server, config.server.port);
      } catch (error) {
        if (redirectServer) await close(redirectServer);
        throw error;
      }
      void checkHealth().finally(scheduleHealthCheck);
    },
    stop: async () => {
      stopping = true;
      clearTimeout(healthTimer);
      await Promise.all([close(server), ...(redirectServer ? [close(redirectServer)] : [])]);
      client.close();
    },
  };
}

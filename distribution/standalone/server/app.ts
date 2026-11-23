/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The server: the browser side's files, and the API it calls. The browser never talks to
 * OpenSearch itself; everything goes through here.
 *
 * Where it costs nothing the API keeps the paths and shapes of OpenSearch Dashboards 3.9.0
 * (`/api/status`, `/api/saved_objects/...`, `/api/opensearch-dashboards/settings`,
 * `/api/console/proxy`), so that scripts and probes written for it keep working.
 */

import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { join } from 'node:path';
import type { Config } from './config';
import {
  HttpError,
  Router,
  badRequest,
  errorBody,
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
import { OpenSearchClient, OpenSearchError, OpenSearchUnavailableError } from './opensearch';
import { SavedObjectsRepository } from './saved_objects';
import { registerSavedObjectsManagement } from './saved_objects_management';
import { registerSavedObjects } from './saved_objects_routes';
import { registerSampleData } from './sample_data/routes';
import { registerShortUrls } from './short_urls';
import { registerSqlConsole } from './sql_console';
import { contentSecurityPolicy, readBuild, renderPage, serveStatic } from './static';
import { registerTsvbFields } from './tsvb_fields';
import { registerTimeline } from './timeline';
import { UiSettings } from './ui_settings';
import { registerValueSuggestions } from './value_suggestions';

export const PRODUCT_NAME = 'InfraDashboard';

const PROXY_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'HEAD', 'PATCH']);
const HEALTHY_EVERY_MS = 10000;
const UNHEALTHY_EVERY_MS = 2500;

interface Health {
  state: 'green' | 'red';
  message: string;
  since: string;
  opensearchVersion?: string;
}

export interface App {
  server: http.Server;
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
        timeout: Math.min(config.opensearch.requestTimeout, 10000),
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

  const all = (query: URLSearchParams, name: string) =>
    query.getAll(name).flatMap((value) => {
      // A list may come as repeated parameters or as one JSON array
      if (value.startsWith('[')) {
        try {
          return (JSON.parse(value) as unknown[]).map(String);
        } catch {
          return [value];
        }
      }
      return [value];
    });

  const object = async <T extends object>(context: RequestContext): Promise<T> => {
    const body = await context.json<T>();
    if (body === undefined || body === null || typeof body !== 'object') {
      throw badRequest('The request needs a JSON body');
    }
    return body;
  };

  registerSavedObjects(router, repository, config.savedObjects);
  registerSavedObjectsManagement(router, repository);

  // --- Advanced settings -----------------------------------------------------------------------

  router.get('/api/opensearch-dashboards/settings', async () => ({
    body: { settings: await uiSettings.getAll() },
  }));

  router.post('/api/opensearch-dashboards/settings', async (context) => {
    const body = await object<{ changes?: Record<string, unknown> }>(context);
    if (!body.changes || typeof body.changes !== 'object') {
      throw badRequest('[request body.changes]: expected an object');
    }
    await uiSettings.setMany(body.changes);
    return { body: { settings: await uiSettings.getAll() } };
  });

  router.post('/api/opensearch-dashboards/settings/{key}', async (context) => {
    const body = await object<{ value?: unknown }>(context);
    await uiSettings.setMany({ [context.params.key]: body.value ?? null });
    return { body: { settings: await uiSettings.getAll() } };
  });

  router.delete('/api/opensearch-dashboards/settings/{key}', async ({ params }) => {
    await uiSettings.setMany({ [params.key]: null });
    return { body: { settings: await uiSettings.getAll() } };
  });

  // --- Index patterns --------------------------------------------------------------------------

  router.get('/api/index_patterns/_fields_for_wildcard', async ({ query }) => {
    const pattern = query.get('pattern');
    if (!pattern) throw badRequest('[request query.pattern]: expected a pattern');
    const metaFields = all(query, 'meta_fields');
    return {
      body: {
        fields: await fieldsForWildcard(
          client,
          pattern,
          metaFields.length ? metaFields : ['_source', '_id', '_type', '_index', '_score']
        ),
      },
    };
  });

  // --- OpenSearch itself -----------------------------------------------------------------------

  // One request to OpenSearch, passed on as it is and answered as OpenSearch answers it. Dev
  // Tools is this and nothing more; the other pages use it for the APIs they are built on.
  const proxy: Handler = async (context) => {
    const method = (context.query.get('method') ?? 'GET').toUpperCase();
    const target = context.query.get('path');
    if (!target) throw badRequest('[request query.path]: expected a path');
    if (!PROXY_METHODS.has(method)) throw badRequest(`Method ${method} is not allowed`);
    const body = await context.body();
    let path = `/${target.replace(/^\/+/, '')}`;
    // What is typed in Dev Tools is an address, in which "." and ".." are steps, as the console
    // of OpenSearch Dashboards reads it. In a request of the pages they are names (the title of
    // an index pattern), which the client sends as they are written.
    if (context.path === '/api/console/proxy') {
      const typed = new URL(`http://localhost${path}`);
      path = typed.pathname + typed.search;
    }
    const response = await client.raw({
      method,
      path,
      body: body.length ? body : undefined,
      // An id of its own for each request, as OpenSearch Dashboards sends: OpenSearch warns of a
      // deprecated API once for each id, and the console shows the warning with every answer
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
  const proxyOptions = { maxBytes: config.savedObjects.maxImportPayloadBytes };
  router.post('/api/console/proxy', proxy, proxyOptions);
  // The address "Copy as cURL" writes: the first OpenSearch this server talks to
  router.get('/api/console/opensearch_config', () => ({ body: { host: config.opensearch.hosts[0] } }));
  router.post('/internal/opensearch', proxy, proxyOptions);

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
    return {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': contentSecurityPolicy(config.map, config.csp),
        'cache-control': 'no-store',
      },
      body: renderPage({
        basePath: config.server.basePath,
        build,
        title: PRODUCT_NAME,
        dark: dark === true,
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
          libraries: {
            vega: `${config.server.basePath}/${build.assets.vega ?? ''}`,
            vegaLite: `${config.server.basePath}/${build.assets.vegaLite ?? ''}`,
          },
        },
      }),
    };
  };

  const errorReply = (error: unknown): Reply => {
    if (error instanceof HttpError) {
      return { status: error.status, body: errorBody(error.status, error.message, error.attributes) };
    }
    if (error instanceof OpenSearchUnavailableError) {
      return { status: 503, body: errorBody(503, error.message) };
    }
    if (error instanceof OpenSearchError) {
      const status = error.status >= 400 && error.status < 600 ? error.status : 502;
      return { status, body: errorBody(status, error.message, { body: error.body }) };
    }
    logger.error('A request failed', { error: (error as Error).stack ?? String(error) });
    return { status: 500, body: errorBody(500, 'An internal server error occurred.') };
  };

  const handle = async (req: http.IncomingMessage): Promise<Reply> => {
    const method = req.method ?? 'GET';
    const target = req.url ?? '/';
    // Nothing is at a path that starts with two slashes, as in OpenSearch Dashboards; new URL()
    // would read what follows them as the name of another host, or fail to
    if (target.startsWith('//')) return { status: 404, body: errorBody(404, 'Not Found') };
    let url: URL;
    try {
      url = new URL(target, 'http://localhost');
    } catch {
      throw badRequest('The address of the request cannot be read');
    }
    let path = url.pathname;
    const { basePath } = config.server;
    if (basePath && (path === basePath || path.startsWith(`${basePath}/`))) {
      path = path.slice(basePath.length) || '/';
    }

    const { route, params, allowed } = router.match(method, path);
    if (route) {
      // A page of another site cannot set this header on a request it makes a browser send
      if (method !== 'GET' && method !== 'HEAD') {
        if (req.headers['osd-xsrf'] === undefined && req.headers['osd-version'] === undefined) {
          throw badRequest('Request must contain the osd-xsrf header.');
        }
      }
      let cached: Promise<Buffer> | undefined;
      const body = () =>
        (cached ??= readBody(req, route.maxBytes ?? config.server.maxPayloadBytes));
      const reply = await route.handler({
        req,
        method,
        path,
        query: url.searchParams,
        params,
        body,
        json: async <T>() => {
          const text = (await body()).toString('utf8').trim();
          if (!text) return undefined;
          try {
            return JSON.parse(text) as T;
          } catch {
            throw badRequest('Invalid request payload JSON format');
          }
        },
      });
      return {
        ...reply,
        headers: { 'cache-control': 'private, no-cache, no-store, must-revalidate', ...reply.headers },
      };
    }
    if (allowed.length) {
      return {
        status: 405,
        headers: { allow: allowed.join(', ') },
        body: errorBody(405, 'Method Not Allowed'),
      };
    }

    if (method === 'GET' || method === 'HEAD') {
      if (path === '/') {
        return { status: 302, headers: { location: `${basePath}/app/home` } };
      }
      if (path === '/app' || path.startsWith('/app/')) return page();
      const file = serveStatic(publicDirectory, req, path);
      if (file) return file;
    }
    return { status: 404, body: errorBody(404, 'Not Found') };
  };

  const server = http.createServer((req, res) => {
    const began = process.hrtime.bigint();
    void handle(req)
      .catch(errorReply)
      .then((reply) => {
        sendReply(req, res, {
          ...reply,
          headers: {
            'osd-name': config.server.name,
            'x-content-type-options': 'nosniff',
            'referrer-policy': 'no-referrer-when-downgrade',
            ...reply.headers,
          },
        });
        logger.debug('request', {
          method: req.method,
          url: req.url,
          status: reply.status ?? 200,
          ms: Number((process.hrtime.bigint() - began) / 1000000n),
        });
      })
      .catch((error: unknown) => {
        logger.error('An answer could not be sent', { error: String(error) });
        // A header that cannot be sent (an address to go to with a character no header may
        // hold) leaves nothing sent: the request is answered as a failure, not cut off
        if (res.headersSent) res.destroy();
        else sendReply(req, res, { status: 500, body: errorBody(500, 'An internal server error occurred.') });
      });
  });
  // Longer than the usual 60 seconds a load balancer keeps an idle connection, so that it is the
  // balancer that closes it and no request meets a connection this server has just closed
  server.keepAliveTimeout = 75000;
  server.headersTimeout = 76000;

  return {
    server,
    checkHealth,
    start: () =>
      new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(config.server.port, config.server.host, () => {
          server.off('error', reject);
          void checkHealth().finally(scheduleHealthCheck);
          resolve();
        });
      }),
    stop: () =>
      new Promise((resolve) => {
        stopping = true;
        clearTimeout(healthTimer);
        server.close(() => {
          client.close();
          resolve();
        });
        server.closeIdleConnections();
      }),
  };
}

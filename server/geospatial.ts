/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The routes of the region_map plugin: the custom vector maps a region map can draw are indices
 * whose names end in "-map", and the page asks for their names, their documents and their
 * mappings. Each route checks its body as the plugin's schema does and words a refusal as it
 * does; a failure of OpenSearch is a 400 with the message of the client library the plugin used.
 */

import { badRequest, HttpError, type Handler, type RequestContext, type Router } from './http';
import { parseBody, type OpenSearchClient } from './opensearch';

type Body = Record<string, unknown>;

/** The type config-schema names a value by */
function typeName(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return 'Array';
  return typeof value;
}

interface KeyRule {
  type: 'string' | 'number';
  /** A check of its own after the type, as `schema.string({ validate })` */
  validate?: (value: unknown) => string | undefined;
}

/** The body as `schema.object(rules)` reads it: the known keys first, in order, then any other */
export function validateBody(raw: unknown, rules: Record<string, KeyRule>): Body {
  if (typeof raw === 'string') throw badRequest('[request body]: could not parse object value from json input');
  if (raw === null || raw === undefined || typeof raw !== 'object' || Array.isArray(raw)) {
    const found = raw === undefined ? 'null' : typeName(raw);
    throw badRequest(`[request body]: expected a plain object value, but found [${found}] instead.`);
  }
  const body = { ...(raw as Body) };
  for (const [key, rule] of Object.entries(rules)) {
    let value = body[key];
    if (rule.type === 'number' && typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) {
      value = Number(value);
    }
    // config-schema runs a string's own check before its type, on anything but a missing value
    if (rule.validate && value !== undefined && typeof value !== 'string') {
      const message =
        value === null ? "Cannot read properties of null (reading 'endsWith')" : 'value.endsWith is not a function';
      throw badRequest(`[request body.${key}]: ${message}`);
    }
    if (typeof value !== rule.type) {
      throw badRequest(`[request body.${key}]: expected value of type [${rule.type}] but got [${typeName(value)}]`);
    }
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw badRequest(`[request body.${key}]: number.infinity`);
    }
    const message = rule.validate?.(value);
    if (message) throw badRequest(`[request body.${key}]: ${message}`);
    body[key] = value;
  }
  for (const key of Object.keys(body)) {
    if (!(key in rules)) throw badRequest(`[request body.${key}]: definition for this key is missing`);
  }
  return body;
}

/** The message of a failure as the OpenSearch JavaScript client words it (its ResponseError) */
export function responseErrorMessage(body: unknown): string {
  if (body !== null && typeof body === 'object') {
    const error = (body as { error?: unknown }).error;
    if (error !== null && typeof error === 'object' && (error as { type?: unknown }).type != null) {
      const { type, root_cause: rootCause } = error as { type: unknown; root_cause?: unknown };
      if (Array.isArray(rootCause)) {
        const causes = rootCause.map((entry: { type?: unknown; reason?: unknown }) => `[${String(entry?.type)}] Reason: ${String(entry?.reason)}`);
        return `${String(type)}: ${causes.join('; ')}`;
      }
      return String(type);
    }
    return JSON.stringify(body);
  }
  return typeof body === 'string' && body ? body : 'Response Error';
}

const INDEX_RULE: KeyRule = { type: 'string' };
const MAP_INDEX_RULE: KeyRule = {
  type: 'string',
  // As the plugin's own check, which runs on what it is given
  validate: (value) => (String(value).endsWith('-map') ? undefined : 'Index name must end with "-map"'),
};

export function registerGeospatial(router: Router, client: OpenSearchClient) {
  const call = async (method: string, path: string, query?: Record<string, string | number>, body?: unknown) => {
    const response = await client.raw({
      method,
      path,
      query,
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    });
    const answer = parseBody(response);
    if (response.status >= 400) throw badRequest(responseErrorMessage(answer));
    return answer;
  };

  const route =
    (rules: Record<string, KeyRule>, handle: (body: Body) => Promise<unknown>): Handler =>
    async (context: RequestContext) => {
      const body = validateBody(await context.json(), rules);
      // Another data source than this OpenSearch: the plugin asks the data source plugin, which is off
      if (context.query.get('dataSourceId')) {
        throw badRequest("Cannot read properties of undefined (reading 'opensearch')");
      }
      try {
        return { body: { ok: true, resp: await handle(body) } };
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw badRequest(error instanceof Error ? error.message : String(error));
      }
    };

  const index = (body: Body) => encodeURIComponent(String(body.index));

  router.post(
    '/api/geospatial/_indices',
    route({ index: MAP_INDEX_RULE }, async (body) => {
      const indices = (await call('GET', `/_cat/indices/${index(body)}`, { format: 'json' })) as Array<{ index?: unknown }>;
      return Array.isArray(indices) ? indices.map((entry) => entry.index) : [];
    })
  );

  router.post(
    '/api/geospatial/_search',
    route({ index: INDEX_RULE, size: { type: 'number' } }, (body) =>
      call('POST', `/${index(body)}/_search`, { size: Number(body.size) }, {})
    )
  );

  router.post(
    '/api/geospatial/_mappings',
    route({ index: INDEX_RULE }, (body) => call('GET', `/${index(body)}/_mapping`))
  );
}

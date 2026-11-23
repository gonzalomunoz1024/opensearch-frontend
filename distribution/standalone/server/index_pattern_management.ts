/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The routes of the index pattern pages, answered as the plugin index_pattern_management of
 * OpenSearch Dashboards answers them: the indices, aliases and data streams a pattern names, the
 * preview of a scripted field on ten documents, and the scripting languages.
 */

import { badRequest, HttpError, type Router } from './http';
import { OpenSearchError, type OpenSearchClient } from './opensearch';
import { arrayOf, literal, maybe, object, oneOf, queryObject, string, validateRequestPart } from './route_validation';

/** The query of resolve_index, with the original's schema (resolve_index.ts) */
const RESOLVE_QUERY = object({
  expand_wildcards: maybe(oneOf(['all', 'open', 'closed', 'hidden', 'none'].map((value) => literal(value)))),
  data_source: maybe(string()),
});

/** The body and the query of a preview, with the original's schemas (preview_scripted_field.ts) */
const PREVIEW_BODY = object({
  index: string(),
  name: string(),
  script: string(),
  query: maybe(object({}, { unknowns: 'allow' })),
  additionalFields: maybe(arrayOf(string())),
});
const PREVIEW_QUERY = object({ dataSourceId: maybe(string()) });

/** The languages a scripted field may be written in, as the original lists them */
export const SCRIPTING_LANGUAGES = ['painless', 'expression'];

/**
 * What failed, answered as the original answers it: the status of OpenSearch, its error under
 * `attributes.error`, and as the message what the client of OpenSearch calls the error: its type,
 * then each of its root causes
 */
export function failureOf(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  if (error instanceof OpenSearchError) {
    const body = error.body as { error?: unknown } | undefined;
    const cause = body && typeof body === 'object' ? body.error : undefined;
    const type =
      cause && typeof cause === 'object' && typeof (cause as { type?: unknown }).type === 'string'
        ? (cause as { type: string }).type
        : 'Response Error';
    const roots = type !== 'Response Error' ? (cause as { root_cause?: unknown }).root_cause : undefined;
    const message = Array.isArray(roots)
      ? `${type}: ${roots.map((root: { type?: unknown; reason?: unknown }) => `[${String(root?.type)}] Reason: ${String(root?.reason)}`).join('; ')}`
      : type;
    return new HttpError(error.status || 500, message, { error: cause || type });
  }
  const message = error instanceof Error ? error.message : String(error);
  return new HttpError(500, message, { error: message });
}

interface PreviewRequest {
  index: string;
  name: string;
  script: string;
  query?: Record<string, unknown>;
  additionalFields?: string[];
}

/** The body of a preview, checked as the original's schema checks it, in its words */
export function previewRequestOf(body: unknown): PreviewRequest {
  // An empty body is null to hapi
  const checked = validateRequestPart(PREVIEW_BODY, body ?? null, 'body');
  return {
    index: checked.index,
    name: checked.name,
    script: checked.script,
    query: checked.query === undefined ? undefined : { ...checked.query },
    additionalFields: checked.additionalFields,
  };
}

/** The search a preview makes: ten documents, the script as a script field */
export function previewSearchOf(request: PreviewRequest) {
  const fields = request.additionalFields ?? [];
  return {
    method: 'POST',
    path: `/${encodeURIComponent(request.index)}/_search`,
    query: {
      size: 10,
      timeout: '30s',
      _source: fields.length > 0 ? fields.join(',') : undefined,
    },
    body: {
      query: request.query ?? { match_all: {} },
      script_fields: {
        [request.name]: { script: { lang: 'painless', source: request.script } },
      },
    },
  };
}

export function registerIndexPatternManagement(router: Router, client: OpenSearchClient) {
  router.get('/internal/index-pattern-management/resolve_index/{query}', async ({ params, query }) => {
    const { expand_wildcards: expand, data_source: dataSource } = validateRequestPart(RESOLVE_QUERY, queryObject(query), 'query');
    // The original asks the data source plugin, which is not there (data_source.enabled), and fails
    if (dataSource !== undefined) {
      throw badRequest('[request query.data_source]: there are no data sources: data_source.enabled is off');
    }
    try {
      const body = await client.request({
        method: 'GET',
        path: `/_resolve/index/${encodeURIComponent(params.query)}${expand ? `?expand_wildcards=${expand}` : ''}`,
      });
      return { body };
    } catch (error) {
      throw failureOf(error);
    }
  });

  router.post('/internal/index-pattern-management/preview_scripted_field', async (context) => {
    // A dataSourceId is not used: the original asks its own OpenSearch then, as data_source is off
    validateRequestPart(PREVIEW_QUERY, queryObject(context.query), 'query');
    const request = previewRequestOf(await context.json());
    try {
      const body = await client.request(previewSearchOf(request));
      // The original answers with the whole answer of its client, the body inside it
      return { body: { body, statusCode: 200, headers: {}, warnings: null } };
    } catch (error) {
      throw failureOf(error);
    }
  });

  router.get('/api/opensearch-dashboards/scripts/languages', () => ({ body: SCRIPTING_LANGUAGES }));
}

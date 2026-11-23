/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The server side of Index Management: the routes its pages, and scripts written for the
 * plugin, call under /api/ism. Each answers 200 with `{ ok: true, response }`, or with
 * `{ ok: false, error }` when OpenSearch refused, as the plugin does; the pages read `ok`.
 * What is asked of OpenSearch, and how its answers are reshaped, follows the plugin route by
 * route, so that a page or a script cannot tell the two servers apart.
 */

import {
  HttpError,
  badRequest,
  type Handler,
  type Reply,
  type RequestContext,
  type Router,
} from './http';
import {
  LegacyError,
  isRecord,
  legacyCaller,
  sendLegacy,
  type LegacyCall,
  type Params,
} from './legacy_client';
import type { OpenSearchClient } from './opensearch';

const ISM = '/_plugins/_ism';
const ROLLUP_JOBS = '/_plugins/_rollup/jobs';
const TRANSFORMS = '/_plugins/_transform';
const SM_POLICIES = '/_plugins/_sm/policies';
const NOTIFICATIONS = '/_plugins/_notifications';
const ISM_CONFIG_INDEX = '.opendistro-ism-config';
const ROLLOVER_ALIAS_SETTING = 'plugins.index_state_management.rollover_alias';
const VALID_METHODS = ['HEAD', 'GET', 'POST', 'PUT', 'DELETE'];

const ok = (response: unknown): Reply => ({ body: { ok: true, response } });
const failed = (error: unknown, more: Record<string, unknown> = {}): Reply => ({
  body: { ok: false, error, ...more },
});

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** A part of what OpenSearch said went wrong: its type or its reason */
function errorField(error: unknown, field: 'type' | 'reason'): unknown {
  if (!(error instanceof LegacyError) || !isRecord(error.body)) return undefined;
  return isRecord(error.body.error) ? error.body.error[field] : undefined;
}

const isMissingIndex = (error: unknown) =>
  error instanceof LegacyError &&
  error.statusCode === 404 &&
  errorField(error, 'type') === 'index_not_found_exception';

// --- What a request must carry ----------------------------------------------------------------

function wrongType(name: string, type: string, value: string | null): never {
  const got = value === null ? 'undefined' : 'string';
  throw badRequest(`[request query.${name}]: expected value of type [${type}] but got [${got}]`);
}

function numberOf(query: URLSearchParams, name: string): number {
  const value = query.get(name);
  const number = value === null || value.trim() === '' ? NaN : Number(value);
  return Number.isNaN(number) ? wrongType(name, 'number', value) : number;
}

function optionalNumber(query: URLSearchParams, name: string): number | undefined {
  return query.has(name) ? numberOf(query, name) : undefined;
}

function stringOf(query: URLSearchParams, name: string): string {
  const value = query.get(name);
  return value === null ? wrongType(name, 'string', value) : value;
}

function booleanOf(query: URLSearchParams, name: string): boolean {
  const value = query.get(name);
  if (value === 'true') return true;
  if (value === 'false') return false;
  return wrongType(name, 'boolean', value);
}

/** A parameter that may be given once, several times or not at all */
function listOf(query: URLSearchParams, name: string): string[] {
  const values = query.getAll(name);
  return values.length === 1 && values[0] === '' ? [] : values;
}

async function bodyOf(context: RequestContext): Promise<Record<string, unknown>> {
  const body = await context.json();
  return isRecord(body) ? body : {};
}

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : []);

// --- Shapes shared by several routes ------------------------------------------------------------

/**
 * What to ask the indices API for: each term, index and data stream between wildcards, or
 * everything. Without data streams their backing indices are left out.
 */
export function getSearchString(
  terms: string[],
  indices: string[],
  dataStreams: string[],
  showDataStreams = true
): string {
  const wild = (values: string[]) => (values.length > 0 ? `*${values.join('*,*')}*` : '');
  const resolved =
    [wild(terms), wild(indices), wild(dataStreams)].filter((value) => value !== '').join(',') ||
    '*';
  return showDataStreams ? resolved : `${resolved} -.ds*`;
}

/** What a search box holds as a query string: every word between wildcards, or everything */
export function wildcardQuery(search: string): string {
  const text = search.trim();
  return text ? `*${text.split(' ').join('* *')}*` : '*';
}

/** What the explain API tells of a managed index, with the names the pages use */
export function transformManagedIndexMetaData(metaData: unknown) {
  if (!isRecord(metaData) || !metaData.index) return null;
  const { state, action, retry_info: retryInfo } = metaData;
  return {
    index: metaData.index,
    indexUuid: metaData.index_uuid,
    policyId: metaData.policy_id,
    policySeqNo: metaData.policy_seq_no,
    policyPrimaryTerm: metaData.policy_primary_term,
    policyCompleted: metaData.policy_completed,
    rolledOver: metaData.rolled_over,
    transitionTo: metaData.transition_to,
    state: isRecord(state) ? { name: state.name, startTime: state.start_time } : undefined,
    action: isRecord(action)
      ? {
          name: action.name,
          startTime: action.start_time,
          index: action.index,
          failed: action.failed,
          consumedRetries: action.consumed_retries,
        }
      : undefined,
    retryInfo: isRecord(retryInfo)
      ? { failed: retryInfo.failed, consumedRetries: retryInfo.consumed_retries }
      : undefined,
    info: metaData.info,
  };
}

/** The answer of the APIs that put indices under a policy, take them out, or try again */
export function changeAnswer(answer: unknown) {
  const body = isRecord(answer) ? answer : {};
  const failedIndices = Array.isArray(body.failed_indices) ? body.failed_indices : [];
  return {
    failures: body.failures,
    updatedIndices: body.updated_indices,
    failedIndices: failedIndices.filter(isRecord).map((index) => ({
      indexName: index.index_name,
      indexUuid: index.index_uuid,
      reason: index.reason,
    })),
  };
}

/** Sorts as the plugin does: by plain comparison, never calling two values equal */
export function customSort<T extends Record<string, unknown>>(
  rows: T[],
  key: string,
  direction: string
): T[] {
  const less = (a: unknown, b: unknown) => (a as string) < (b as string);
  return rows.sort((a, b) => {
    const flag = direction === 'asc' ? less(a[key], b[key]) : less(b[key], a[key]);
    return flag ? -1 : 1;
  });
}

/** The reindex a task is doing, read from its description */
export function reindexTarget(description: unknown): string {
  const match = /reindex from \[([^\]]+)\] to \[([^\]]+)\]/i.exec(String(description ?? ''));
  return match ? match[2] : '';
}

/** A message of the snapshot routes: OpenSearch's own answer rather than a summary of it */
export function snapshotError(error: unknown): string {
  if (error instanceof LegacyError && error.response) {
    try {
      const parsed: unknown = JSON.parse(error.response);
      const reason = isRecord(parsed) ? parsed.reason : undefined;
      return typeof reason === 'string' && reason ? reason : error.response;
    } catch {
      return error.response;
    }
  }
  return messageOf(error);
}

const id = (value: string) => encodeURIComponent(value);

/** A body the route for any request takes: an endpoint, and at most its data and "hideLog" */
export function isApiCall(body: unknown): body is { endpoint: string; data?: unknown } {
  if (!isRecord(body) || typeof body.endpoint !== 'string') return false;
  const { hideLog } = body;
  if (hideLog !== undefined && hideLog !== null && typeof hideLog !== 'boolean') return false;
  return Object.keys(body).every((key) => ['endpoint', 'data', 'hideLog'].includes(key));
}

export function registerIndexManagement(router: Router, client: OpenSearchClient) {
  const call: LegacyCall = legacyCaller(client);

  /** A request to one of the plugins of OpenSearch; what is undefined is left out of the query */
  const plugin = (method: string, path: string, query: Params = {}, body?: unknown) => {
    const pairs = Object.entries(query)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`);
    const address = pairs.length > 0 ? `${path}${path.includes('?') ? '&' : '?'}${pairs.join('&')}` : path;
    return sendLegacy(client, { method, path: address, body });
  };

  /** Answers with what went wrong instead of failing, as every route of the plugin does */
  const route =
    (handler: Handler, wording: (error: unknown) => unknown = messageOf): Handler =>
    async (context) => {
      try {
        return await handler(context);
      } catch (error) {
        // What the request itself lacks is answered as a bad request
        if (error instanceof HttpError) throw error;
        return failed(wording(error));
      }
    };

  async function dataStreamsLike(search?: string): Promise<Array<Record<string, unknown>>> {
    const answer = await call('transport.request', {
      path: `/_data_stream/${search ? `*${search}*` : '*'}`,
      method: 'GET',
    });
    const list = isRecord(answer) && Array.isArray(answer.data_streams) ? answer.data_streams : [];
    return list.filter(isRecord);
  }

  /** The data stream each backing index belongs to */
  async function indexToDataStream(): Promise<Record<string, unknown>> {
    const mapping: Record<string, unknown> = {};
    for (const dataStream of await dataStreamsLike()) {
      const indices = Array.isArray(dataStream.indices) ? dataStream.indices : [];
      for (const index of indices.filter(isRecord)) {
        mapping[String(index.index_name)] = dataStream.name;
      }
    }
    return mapping;
  }

  // --- Indexes ---------------------------------------------------------------------------------

  /** The policy each index is under: "" for none, "N/A" when that cannot be told */
  async function managedStatus(names: string[]): Promise<Record<string, unknown>> {
    try {
      const explained = await plugin('GET', `${ISM}/explain/${id(names.toString())}`);
      const managed: Record<string, unknown> = {};
      for (const [name, explain] of Object.entries(isRecord(explained) ? explained : {})) {
        if (name === 'total_managed_indices' || !isRecord(explain)) continue;
        const policy = explain['index.plugins.index_state_management.policy_id'];
        managed[name] = policy === null ? '' : policy;
      }
      return managed;
    } catch {
      return Object.fromEntries(names.map((name) => [name, 'N/A']));
    }
  }

  router.get(
    '/api/ism/_indices',
    route(async ({ query }) => {
      const from = numberOf(query, 'from');
      const size = numberOf(query, 'size');
      stringOf(query, 'search');
      const sortField = stringOf(query, 'sortField');
      const sortDirection = stringOf(query, 'sortDirection');
      const showDataStreams = booleanOf(query, 'showDataStreams');

      const params: Params = {
        index: getSearchString(
          listOf(query, 'terms'),
          listOf(query, 'indices'),
          listOf(query, 'dataStreams')
        ),
        format: 'json',
      };
      if (sortField !== 'managed' && sortField !== 'data_stream') {
        params.s = `${sortField}:${sortDirection}`;
      }
      const expandWildcards = query.get('expandWildcards');
      if (expandWildcards) params.expand_wildcards = expandWildcards;
      const exactSearch = query.get('exactSearch');
      if (exactSearch) params.index = exactSearch;

      const rows = (answer: unknown) => (Array.isArray(answer) ? answer.filter(isRecord) : []);
      let recoveries: Array<Record<string, unknown>>;
      let tasks: Array<Record<string, unknown>>;
      let indices: Array<Record<string, unknown>>;
      let streams: Record<string, unknown>;
      try {
        [recoveries, tasks, indices, streams] = await Promise.all([
          call('cat.recovery', { format: 'json', detailed: true }).then(rows, () => []),
          call('cat.tasks', {
            format: 'json',
            detailed: true,
            actions: 'indices:data/write/reindex',
          }).then(rows, () => []),
          call('cat.indices', params).then(rows),
          indexToDataStream(),
        ]);
      } catch (error) {
        // No index matches what was asked for
        if (isMissingIndex(error)) return ok({ indices: [], totalIndices: 0 });
        throw error;
      }

      const reindexed = new Set(tasks.map((task) => reindexTarget(task.description)));
      const recovering = new Set(
        recoveries.filter((item) => item.stage !== 'done').map((item) => item.index)
      );
      for (const index of indices) {
        index.data_stream = streams[String(index.index)] ?? null;
        let extraStatus = index.status;
        if (index.health === 'green') {
          if (reindexed.has(String(index.index))) extraStatus = 'reindex';
        } else if (recovering.has(index.index)) {
          extraStatus = 'recovery';
        }
        if (extraStatus) index.extraStatus = extraStatus;
      }
      if (sortField === 'status') customSort(indices, 'extraStatus', sortDirection);

      // Paging is done here: the indices API has none
      const filtered = showDataStreams
        ? indices
        : indices.filter((index) => index.data_stream === null);
      const page = filtered.slice(from, from + size);
      const managed = await managedStatus(page.map((index) => String(index.index)));
      const all = page.map((index) => ({
        ...index,
        managed: managed[String(index.index)] ? 'Yes' : 'No',
        managedPolicy: managed[String(index.index)],
      }));
      return ok({
        indices: sortField === 'managed' ? customSort(all, 'managed', sortDirection) : all,
        totalIndices: filtered.length,
      });
    })
  );

  router.post(
    '/api/ism/applyPolicy',
    route(async (context) => {
      const { indices, policyId } = await bodyOf(context);
      const answer = await plugin('POST', `${ISM}/add/${id(strings(indices).join(','))}`, {}, {
        policy_id: policyId,
      });
      return ok(changeAnswer(answer));
    })
  );

  router.post(
    '/api/ism/editRolloverAlias',
    route(async (context) => {
      const { alias, index } = await bodyOf(context);
      return ok(
        await call('indices.putSettings', { index, body: { [ROLLOVER_ALIAS_SETTING]: alias } })
      );
    })
  );

  // --- Indices under a policy --------------------------------------------------------------------

  router.get(
    '/api/ism/managedIndices',
    route(async ({ query }) => {
      const from = numberOf(query, 'from');
      const size = numberOf(query, 'size');
      stringOf(query, 'search');
      const sortField = stringOf(query, 'sortField');
      const sortDirection = stringOf(query, 'sortDirection');
      const showDataStreams = booleanOf(query, 'showDataStreams');
      const sorts: Record<string, string> = {
        index: 'managed_index.index',
        policyId: 'managed_index.policy_id',
      };
      let explained: unknown;
      let streams: Record<string, unknown>;
      try {
        [explained, streams] = await Promise.all([
          plugin('GET', `${ISM}/explain`, {
            sortField: sortField ? sorts[sortField] : undefined,
            sortOrder: sortDirection,
            queryString: getSearchString(
              listOf(query, 'terms'),
              listOf(query, 'indices'),
              listOf(query, 'dataStreams'),
              showDataStreams
            ),
            from,
            size,
          }),
          indexToDataStream(),
        ]);

        const managedIndices: unknown[] = [];
        const all = isRecord(explained) ? explained : {};
        for (const [name, metadata] of Object.entries(all)) {
          if (name === 'total_managed_indices' || !isRecord(metadata)) continue;
          const dataStream = streams[String(metadata.index)] ?? null;
          if (!showDataStreams && dataStream !== null) continue;
          let policy: unknown;
          try {
            policy = await plugin('GET', `${ISM}/policies/${id(String(metadata.policy_id))}`);
          } catch (error) {
            // An index may be under a policy that is gone
            const gone =
              error instanceof LegacyError &&
              error.statusCode === 404 &&
              errorField(error, 'reason') === 'Policy not found';
            if (!gone) throw error;
          }
          const found = isRecord(policy) ? policy : {};
          managedIndices.push({
            index: metadata.index,
            indexUuid: metadata.index_uuid,
            dataStream,
            policyId: metadata.policy_id,
            policySeqNo: found._seq_no ?? null,
            policyPrimaryTerm: found._primary_term ?? null,
            policy: found.policy ?? null,
            enabled: metadata.enabled,
            managedIndexMetaData: transformManagedIndexMetaData(metadata),
          });
        }
        return ok({ managedIndices, totalManagedIndices: all.total_managed_indices });
      } catch (error) {
        if (isMissingIndex(error)) return ok({ managedIndices: [], totalManagedIndices: 0 });
        throw error;
      }
    })
  );

  // The plugin never finished this route: it searches the policies' index with a parameter
  // OpenSearch does not know, and so answers with OpenSearch's refusal. The same is asked here.
  router.get(
    '/api/ism/managedIndices/{id}',
    route(async ({ params }) => ok(await call('search', { id: params.id, index: ISM_CONFIG_INDEX })))
  );

  router.post(
    '/api/ism/retry',
    route(async (context) => {
      const { index, state = null } = await bodyOf(context);
      const answer = await plugin(
        'POST',
        `${ISM}/retry/${id(strings(index).join(','))}`,
        {},
        state ? { state } : undefined
      );
      return ok(changeAnswer(answer));
    })
  );

  router.post(
    '/api/ism/changePolicy',
    route(async (context) => {
      const { indices, policyId, include, state } = await bodyOf(context);
      const answer = await plugin(
        'POST',
        `${ISM}/change_policy/${id(strings(indices).join(','))}`,
        {},
        { policy_id: policyId, include, state }
      );
      return ok(changeAnswer(answer));
    })
  );

  router.post(
    '/api/ism/removePolicy',
    route(async (context) => {
      const { indices } = await bodyOf(context);
      const answer = await plugin('POST', `${ISM}/remove/${id(strings(indices).join(','))}`);
      return ok(changeAnswer(answer));
    })
  );

  // --- Policies ----------------------------------------------------------------------------------

  router.get(
    '/api/ism/policies',
    route(async ({ query }) => {
      const from = numberOf(query, 'from');
      const size = numberOf(query, 'size');
      const search = stringOf(query, 'search');
      const sortField = stringOf(query, 'sortField');
      const sortDirection = stringOf(query, 'sortDirection');
      const sorts: Record<string, string> = {
        id: 'policy.policy_id.keyword',
        'policy.policy.description': 'policy.description.keyword',
        'policy.policy.last_updated_time': 'policy.last_updated_time',
      };
      try {
        const answer = await plugin('GET', `${ISM}/policies`, {
          from,
          size,
          sortOrder: sortDirection,
          sortField: sorts[sortField] ?? sorts.id,
          queryString: wildcardQuery(search),
        });
        const body = isRecord(answer) ? answer : {};
        const list = Array.isArray(body.policies) ? body.policies.filter(isRecord) : [];
        return ok({
          policies: list.map((policy) => ({
            seqNo: policy._seq_no,
            primaryTerm: policy._primary_term,
            id: policy._id,
            policy: policy.policy,
          })),
          totalPolicies: body.total_policies,
        });
      } catch (error) {
        if (isMissingIndex(error)) return ok({ policies: [], totalPolicies: 0 });
        throw error;
      }
    })
  );

  router.put(
    '/api/ism/policies/{id}',
    route(async (context) => {
      const seqNo = optionalNumber(context.query, 'seqNo');
      const primaryTerm = optionalNumber(context.query, 'primaryTerm');
      const body = JSON.stringify(await context.json());
      const path = `${ISM}/policies/${id(context.params.id)}`;
      const versions =
        seqNo === undefined || primaryTerm === undefined
          ? {}
          : { if_seq_no: seqNo, if_primary_term: primaryTerm };
      return ok(await plugin('PUT', path, { ...versions, refresh: 'wait_for' }, body));
    })
  );

  router.get(
    '/api/ism/policies/{id}',
    route(async ({ params }) => {
      const answer = await plugin('GET', `${ISM}/policies/${id(params.id)}`);
      const body = isRecord(answer) ? answer : {};
      if (!body.policy) return failed('Failed to load policy');
      return ok({
        id: params.id,
        seqNo: body._seq_no,
        primaryTerm: body._primary_term,
        policy: body.policy,
      });
    })
  );

  /** Deleting answers `true`, or what OpenSearch called the result when it is not "deleted" */
  const deleted = (path: string): Handler =>
    route(async ({ params }) => {
      const answer = await plugin('DELETE', `${path}/${id(params.id)}`, { refresh: 'wait_for' });
      const result = isRecord(answer) ? answer.result : undefined;
      return result === 'deleted' ? ok(true) : failed(result);
    });

  router.delete('/api/ism/policies/{id}', deleted(`${ISM}/policies`));

  // --- Rollup and transform jobs -----------------------------------------------------------------

  interface Jobs {
    /** The address of the jobs in OpenSearch */
    base: string;
    /** The name of a job in answers: "rollup" or "transform" */
    one: 'rollup' | 'transform';
    many: 'rollups' | 'transforms';
    total: 'totalRollups' | 'totalTransforms';
    listError: string;
    metadataError: string;
  }

  const ROLLUPS: Jobs = {
    base: ROLLUP_JOBS,
    one: 'rollup',
    many: 'rollups',
    total: 'totalRollups',
    listError: 'Error in getRollups ',
    metadataError: 'Failed to load metadata',
  };
  const TRANSFORM_JOBS: Jobs = {
    base: TRANSFORMS,
    one: 'transform',
    many: 'transforms',
    total: 'totalTransforms',
    listError: 'Error in getTransforms',
    metadataError: 'Failed to load metadata for transform',
  };

  function registerJobs(address: string, jobs: Jobs) {
    const { base, one, many, total } = jobs;

    router.get(
      address,
      route(
        async ({ query }) => {
          const from = numberOf(query, 'from');
          const size = numberOf(query, 'size');
          const search = stringOf(query, 'search');
          const sortField = stringOf(query, 'sortField');
          const sortDirection = stringOf(query, 'sortDirection');
          const sorts: Record<string, string> = {
            _id: `${one}.${one}_id.keyword`,
            [`${one}.source_index`]: `${one}.source_index.keyword`,
            [`${one}.target_index`]: `${one}.target_index.keyword`,
            [`${one}.${one}.enabled`]: `${one}.enabled`,
          };
          let answer: unknown;
          try {
            // The transforms are listed at an address that ends with a slash, as the plugin asks
            answer = await plugin('GET', one === 'transform' ? `${base}/` : base, {
              from,
              size,
              search,
              sortField: sorts[sortField] ?? sorts._id,
              sortDirection,
            });
          } catch (error) {
            if (isMissingIndex(error)) return ok({ [many]: [], [total]: 0, metadata: null });
            throw error;
          }
          const body = isRecord(answer) ? answer : {};
          const count = body[`total_${many}`];
          const list = (Array.isArray(body[many]) ? (body[many] as unknown[]) : [])
            .filter(isRecord)
            .map((job) => ({
              _seqNo: job._seqNo,
              _primaryTerm: job._primaryTerm,
              _id: job._id,
              [one]: job[one],
              metadata: null as unknown,
            }));
          if (!count) return ok({ [many]: list, [total]: count, metadata: {} });

          // What each job is doing, asked for all of them at once
          const ids = list.map((job) => String(job._id)).join(',');
          const explained = await plugin('GET', `${base}/${id(ids)}/_explain`);
          const metadata = isRecord(explained) ? explained : {};
          if (metadata.error) return failed(metadata.error);
          for (const job of list) job.metadata = metadata[String(job._id)];
          return ok({ [many]: list, [total]: count, metadata: explained });
        },
        (error) => jobs.listError + messageOf(error)
      )
    );

    router.get(
      `${address}/{id}`,
      route(async ({ params }) => {
        const path = `${base}/${id(params.id)}`;
        const answer = await plugin('GET', path);
        const metadata = await plugin('GET', `${path}/_explain`);
        const body = isRecord(answer) ? answer : {};
        if (!body[one]) return failed(`Failed to load ${one}`);
        if (!metadata) return failed(jobs.metadataError);
        return ok({
          _id: params.id,
          _seqNo: one === 'rollup' ? body._seq_no : (body._seq_no ?? null),
          _primaryTerm: one === 'rollup' ? body._primary_term : (body._primary_term ?? null),
          [one]: body[one],
          metadata,
        });
      })
    );

    router.put(
      `${address}/{id}`,
      route(async (context) => {
        const seqNo = optionalNumber(context.query, 'seqNo');
        const primaryTerm = optionalNumber(context.query, 'primaryTerm');
        const body = JSON.stringify(await context.json());
        const path = `${base}/${id(context.params.id)}`;
        if (seqNo !== undefined && primaryTerm !== undefined) {
          return ok(
            await plugin('PUT', path, { if_seq_no: seqNo, if_primary_term: primaryTerm }, body)
          );
        }
        // A new rollup job waits until it can be found; a new transform job does not
        return ok(await plugin('PUT', path, one === 'rollup' ? { refresh: 'wait_for' } : {}, body));
      })
    );

    for (const action of ['start', 'stop']) {
      router.post(
        `${address}/{id}/_${action}`,
        route(async ({ params }) => {
          const answer = await plugin('POST', `${base}/${id(params.id)}/_${action}`);
          return isRecord(answer) && answer.acknowledged
            ? ok(true)
            : failed(`Failed to ${action} ${one}`);
        })
      );
    }
  }

  registerJobs('/api/ism/rollups', ROLLUPS);
  router.delete('/api/ism/rollups/{id}', deleted(ROLLUP_JOBS));
  router.post(
    '/api/ism/_mappings',
    route(async (context) => {
      const { index } = await bodyOf(context);
      return ok(await call('indices.getMapping', { index }));
    })
  );

  // Before the transform by its id, so that "_preview" is not taken for one
  router.post(
    '/api/ism/transforms/_preview',
    route(async (context) =>
      ok(await plugin('POST', `${TRANSFORMS}/_preview`, {}, JSON.stringify(await context.json())))
    )
  );
  registerJobs('/api/ism/transforms', TRANSFORM_JOBS);
  router.delete(
    '/api/ism/transforms/{id}',
    route(async ({ params }) => {
      const answer = await plugin('DELETE', `${TRANSFORMS}/${id(params.id)}`);
      return isRecord(answer) && answer.errors ? failed('Failed to delete transform') : ok(true);
    })
  );

  router.post(
    '/api/ism/_searchSampleData/{index}',
    route(async (context) => {
      const from = numberOf(context.query, 'from');
      const size = numberOf(context.query, 'size');
      const index = context.params.index;
      if (
        index !== index.toLowerCase() ||
        index.startsWith('_') ||
        index.startsWith('-') ||
        /[\s,:"+/\\|?#><]/.test(index)
      ) {
        throw badRequest('[request params.index]: Invalid index name.');
      }
      const query = await context.json();
      try {
        const answer = await call('search', {
          index,
          from,
          size,
          body: query ? JSON.stringify({ query }) : {},
        });
        const hits = isRecord(answer) && isRecord(answer.hits) ? answer.hits : {};
        return ok({ total: hits.total, data: hits.hits });
      } catch (error) {
        if (isMissingIndex(error)) return ok({ total: 0, data: [] });
        throw error;
      }
    })
  );

  // --- Aliases, data streams, notification channels -------------------------------------------------

  router.get(
    '/api/ism/_aliases',
    route(async ({ query }) => {
      const search = query.get('search');
      const aliases = await call('cat.aliases', {
        format: 'json',
        name: search ? `*${search}*` : '*',
      });
      return ok({ aliases, totalAliases: Array.isArray(aliases) ? aliases.length : undefined });
    })
  );

  router.get(
    '/api/ism/_data_streams',
    route(async ({ query }) => {
      const dataStreams = await dataStreamsLike(query.get('search') ?? undefined);
      return ok({ dataStreams, totalDataStreams: dataStreams.length });
    })
  );

  router.get(
    '/api/ism/_notifications/channels',
    route(async () => ok(await plugin('GET', `${NOTIFICATIONS}/channels`)))
  );
  router.get(
    '/api/ism/_notifications/channels/{id}',
    route(async ({ params }) => ok(await plugin('GET', `${NOTIFICATIONS}/configs/${id(params.id)}`)))
  );

  // --- Any request, by the name the old client library had for it -----------------------------------

  const apiCaller: Handler = async (context) => {
    const sent = await context.json();
    let endpoint: unknown;
    let data: unknown;
    if (sent === undefined || sent === null) {
      // Without a body, the same may be given in the address
      endpoint = context.query.get('endpoint') ?? undefined;
      try {
        data = JSON.parse(context.query.get('data') || '{}');
      } catch {
        throw badRequest('[request query.data]: could not parse the value given');
      }
    } else if (isApiCall(sent)) {
      ({ endpoint, data } = sent);
    } else {
      // The plugin's own words for a body that is neither a call nor nothing
      throw badRequest('[request body]: SchemaTypeError: expected value to equal [null]');
    }
    if (!endpoint || typeof endpoint !== 'string') {
      return failed('Expected non-empty string on endpoint');
    }
    const params: Params = isRecord(data) ? { ...data } : {};
    if (endpoint === 'transport.request') {
      if (typeof params.path === 'string' && !params.path.startsWith('/')) {
        params.path = `/${params.path}`;
      }
      if (params.method) {
        const method = typeof params.method === 'string' ? params.method.toUpperCase() : '';
        if (!VALID_METHODS.includes(method)) {
          return failed(
            `Method must be one of, case insensitive ['HEAD', 'GET', 'POST', 'PUT', 'DELETE']. Received '${String(params.method)}'.`
          );
        }
      }
    }
    try {
      return ok(await call(endpoint, params));
    } catch (error) {
      const body = error instanceof LegacyError ? error.body : undefined;
      return failed(messageOf(error), { body: body || '' });
    }
  };
  router.post('/api/ism/apiCaller', apiCaller);
  router.post('/api/ism/accountInfo', apiCaller);

  // --- Snapshots, their policies and repositories ---------------------------------------------------

  const snapshots = (handler: Handler) => route(handler, snapshotError);

  router.get(
    '/api/ism/_snapshots',
    snapshots(async () => {
      const repositories = await call('cat.repositories', { format: 'json' });
      const names = (Array.isArray(repositories) ? repositories : [])
        .filter(isRecord)
        .map((repository) => String(repository.id));
      const all: unknown[] = [];
      for (const repository of names) {
        const answer = await call('snapshot.get', {
          repository,
          snapshot: '_all',
          ignore_unavailable: true,
        });
        const list = isRecord(answer) && Array.isArray(answer.snapshots) ? answer.snapshots : [];
        for (const snapshot of list.filter(isRecord)) {
          const shards = isRecord(snapshot.shards) ? snapshot.shards : {};
          all.push({
            id: snapshot.snapshot,
            status: snapshot.state,
            start_epoch: snapshot.start_time_in_millis,
            end_epoch: snapshot.end_time_in_millis,
            duration: snapshot.duration_in_millis,
            indices: Array.isArray(snapshot.indices) ? snapshot.indices.length : undefined,
            successful_shards: shards.successful,
            failed_shards: shards.failed,
            total_shards: shards.total,
            repository,
            policy: isRecord(snapshot.metadata) ? snapshot.metadata.sm_policy : undefined,
          });
        }
      }
      return ok({ snapshots: all, totalSnapshots: all.length });
    })
  );

  router.get(
    '/api/ism/_snapshots/{id}',
    snapshots(async ({ params, query }) => {
      const answer = await call('snapshot.get', {
        repository: stringOf(query, 'repository'),
        snapshot: params.id,
        ignore_unavailable: true,
      });
      const list = isRecord(answer) && Array.isArray(answer.snapshots) ? answer.snapshots : [];
      return ok(list[0]);
    })
  );

  router.delete(
    '/api/ism/_snapshots/{id}',
    snapshots(async ({ params, query }) =>
      ok(
        await call('snapshot.delete', {
          repository: stringOf(query, 'repository'),
          snapshot: params.id,
        })
      )
    )
  );

  router.put(
    '/api/ism/_snapshots/{id}',
    snapshots(async (context) =>
      ok(
        await call('snapshot.create', {
          repository: stringOf(context.query, 'repository'),
          snapshot: context.params.id,
          body: JSON.stringify(await context.json()),
        })
      )
    )
  );

  router.post(
    '/api/ism/_snapshots/{id}',
    snapshots(async (context) =>
      ok(
        await call('snapshot.restore', {
          repository: stringOf(context.query, 'repository'),
          snapshot: context.params.id,
          body: JSON.stringify(await context.json()),
        })
      )
    )
  );

  const isMissingSnapshotConfig = (error: unknown) =>
    error instanceof LegacyError &&
    error.statusCode === 404 &&
    errorField(error, 'reason') === 'Snapshot management config index not found';

  const savedPolicy = (answer: unknown) => {
    const body = isRecord(answer) ? answer : {};
    return {
      seqNo: body._seq_no,
      primaryTerm: body._primary_term,
      id: body._id,
      policy: body.sm_policy,
    };
  };

  router.post(
    '/api/ism/smPolicies/{id}',
    snapshots(async (context) =>
      ok(
        savedPolicy(
          await plugin(
            'POST',
            `${SM_POLICIES}/${id(context.params.id)}`,
            { refresh: 'wait_for' },
            JSON.stringify(await context.json())
          )
        )
      )
    )
  );

  router.put(
    '/api/ism/smPolicies/{id}',
    snapshots(async (context) => {
      const seqNo = optionalNumber(context.query, 'seqNo');
      const primaryTerm = optionalNumber(context.query, 'primaryTerm');
      if (seqNo === undefined || primaryTerm === undefined) {
        // A policy is only saved over the version that was read
        return failed(
          'Unable to build a path with those params. Supply at least policyId, ifSeqNo, ifPrimaryTerm'
        );
      }
      const answer = await plugin(
        'PUT',
        `${SM_POLICIES}/${id(context.params.id)}`,
        { if_seq_no: seqNo, if_primary_term: primaryTerm, refresh: 'wait_for' },
        JSON.stringify(await context.json())
      );
      return ok(savedPolicy(answer));
    })
  );

  router.get(
    '/api/ism/smPolicies',
    snapshots(async ({ query }) => {
      const from = numberOf(query, 'from');
      const size = numberOf(query, 'size');
      const sortField = stringOf(query, 'sortField');
      const sortOrder = stringOf(query, 'sortOrder');
      const text = stringOf(query, 'queryString').trim();
      try {
        const answer = await plugin('GET', SM_POLICIES, {
          from,
          size,
          sortField: `sm_policy.${sortField}`,
          sortOrder,
          queryString: text || '*',
        });
        const body = isRecord(answer) ? answer : {};
        const list = Array.isArray(body.policies) ? body.policies : [];
        return ok({ policies: list.map(savedPolicy), totalPolicies: body.total_policies });
      } catch (error) {
        if (isMissingSnapshotConfig(error)) return ok({ policies: [], totalPolicies: 0 });
        throw error;
      }
    })
  );

  router.get(
    '/api/ism/smPolicies/{id}',
    snapshots(async ({ params }) => {
      try {
        const path = `${SM_POLICIES}/${id(params.id)}`;
        const answer = await plugin('GET', path);
        const explained = await plugin('GET', `${path}/_explain`);
        const body = isRecord(answer) ? answer : {};
        const policies = isRecord(explained) && Array.isArray(explained.policies) ? explained.policies : [];
        return ok({
          id: params.id,
          seqNo: body._seq_no,
          primaryTerm: body._primary_term,
          policy: body.sm_policy,
          metadata: policies[0],
        });
      } catch (error) {
        if (isMissingSnapshotConfig(error)) return ok(null);
        throw error;
      }
    })
  );

  router.delete(
    '/api/ism/smPolicies/{id}',
    snapshots(async ({ params }) => {
      const answer = await plugin('DELETE', `${SM_POLICIES}/${id(params.id)}`, {
        refresh: 'wait_for',
      });
      const result = isRecord(answer) ? answer.result : undefined;
      return result === 'deleted' ? ok(true) : failed(result);
    })
  );

  for (const action of ['start', 'stop']) {
    router.post(
      `/api/ism/smPolicies/{id}/_${action}`,
      snapshots(async ({ params }) => {
        const answer = await plugin('POST', `${SM_POLICIES}/${id(params.id)}/_${action}`);
        return isRecord(answer) && answer.acknowledged
          ? ok(true)
          : failed(`Failed to ${action} snapshot policy.`);
      })
    );
  }

  // The address is spelled as the plugin spells it
  router.get(
    '/api/ism/_repositores',
    snapshots(async () => {
      const repositories = await call('cat.repositories', { format: 'json' });
      const list = (Array.isArray(repositories) ? repositories : []).filter(isRecord);
      for (const repository of list) {
        // A repository that cannot be read has no count
        const found = await call('cat.snapshots', {
          format: 'json',
          repository: repository.id,
          ignore_unavailable: true,
        }).catch(() => undefined);
        repository.snapshotCount = Array.isArray(found) ? found.length : undefined;
      }
      return ok(list);
    })
  );

  // Every index, whatever is named in the address: the plugin does not pass the names on
  router.get(
    '/api/ism/_indices/{indices}',
    snapshots(async () => ok(await call('cat.indices', { format: 'json' })))
  );

  router.get(
    '/api/ism/_recovery',
    snapshots(async () => ok(await call('indices.recovery', { format: 'json' })))
  );

  router.delete(
    '/api/ism/_repositores/{id}',
    snapshots(async ({ params }) =>
      ok(await call('snapshot.deleteRepository', { repository: params.id }))
    )
  );

  router.get(
    '/api/ism/_repositores/{id}',
    snapshots(async ({ params }) => ok(await call('snapshot.getRepository', { repository: params.id })))
  );

  router.put(
    '/api/ism/_repositores/{id}',
    snapshots(async (context) =>
      ok(
        await call('snapshot.createRepository', {
          repository: context.params.id,
          body: JSON.stringify(await context.json()),
        })
      )
    )
  );
}

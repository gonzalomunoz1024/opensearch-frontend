/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The sample data API of OpenSearch Dashboards 3.9.0, with its paths, answers and errors:
 *
 *   GET    /api/sample_data         the sets, each with whether it is installed
 *   POST   /api/sample_data/{id}    installs a set: its indices made anew and loaded, with the
 *                                   dates brought to the day (`?now=` names another moment),
 *                                   and its saved objects written over any of the same ids
 *   DELETE /api/sample_data/{id}    removes the saved objects of the set, then its indices
 *
 * A set counts as installed when every one of its indices exists and holds documents, and its
 * dashboard, if it has one, exists. Making its index pattern the default one is left to the
 * page, as in OpenSearch Dashboards.
 */

import {
  INSTALLED_STATUS,
  UNINSTALLED_STATUS,
  UNKNOWN_STATUS,
  type SampleDataInstallResult,
  type SampleDataSetSummary,
  type SampleDataStatus,
} from '../../common/sample_data';
import { HttpError, badRequest, notFound, type Router } from '../http';
import { LegacyError, isRecord, sendLegacy } from '../legacy_client';
import type { Logger } from '../logger';
import type { OpenSearchClient } from '../opensearch';
import type { SavedObjectsRepository } from '../saved_objects';
import {
  SAMPLE_DATA_SETS,
  dataPath,
  indexNameOf,
  readFields,
  readSavedObjects,
  type DataIndex,
  type SampleDataSet,
  type SampleSavedObject,
} from './data_sets';
import { loadData } from './load_data';
import { dateToIso8601IgnoringTime, moveTimestamps, type Document } from './timestamps';

/** What the list says of a set, before its status is known */
export function summaryOf(set: SampleDataSet): SampleDataSetSummary {
  return {
    id: set.id,
    name: set.name,
    description: set.description,
    previewImagePath: set.previewImagePath,
    darkPreviewImagePath: set.darkPreviewImagePath,
    hasNewThemeImages: set.hasNewThemeImages,
    overviewDashboard: set.overviewDashboard,
    appLinks: set.appLinks,
    defaultIndex: set.defaultIndex,
    dataIndices: set.dataIndices.map(({ id, indexName }) => ({ id, indexName })),
    status: UNINSTALLED_STATUS,
  };
}

/** How the status of a set is found out; each may throw */
export interface StatusProbes {
  indexExists(index: string): Promise<boolean>;
  count(index: string): Promise<number>;
  /** Resolves when the dashboard exists, throws a 404 HttpError when it does not */
  getDashboard(id: string): Promise<unknown>;
}

const isNotFound = (error: unknown) => error instanceof HttpError && error.status === 404;
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Installed when every index exists and holds a document and the dashboard, if the set has one,
 * exists; not installed at the first that does not; unknown, with why, when one cannot be asked
 */
export async function sampleDataStatus(
  set: SampleDataSet,
  probes: StatusProbes
): Promise<{ status: SampleDataStatus; statusMsg?: string }> {
  for (const dataIndex of set.dataIndices) {
    const index = indexNameOf(set, dataIndex);
    try {
      if (!(await probes.indexExists(index))) return { status: UNINSTALLED_STATUS };
      if ((await probes.count(index)) === 0) return { status: UNINSTALLED_STATUS };
    } catch (error) {
      return { status: UNKNOWN_STATUS, statusMsg: messageOf(error) };
    }
  }
  if (set.overviewDashboard) {
    try {
      await probes.getDashboard(set.overviewDashboard);
    } catch (error) {
      if (isNotFound(error)) return { status: UNINSTALLED_STATUS };
      return { status: UNKNOWN_STATUS, statusMsg: messageOf(error) };
    }
  }
  return { status: INSTALLED_STATUS };
}

/** The lines of a bulk request that indexes `docs` into `index`; an `_id` in a document is its id */
export function bulkBody(index: string, docs: Document[], prepare: (doc: Document) => Document): string {
  const lines: string[] = [];
  for (const doc of docs) {
    const action: { _index: string; _id?: string } = { _index: index };
    if (doc._id) {
      action._id = String(doc._id);
      delete doc._id;
    }
    lines.push(JSON.stringify({ index: action }), JSON.stringify(prepare(doc)));
  }
  return `${lines.join('\n')}\n`;
}

/**
 * The query a route takes, checked as OpenSearch Dashboards checks it: a parameter it does not
 * know, or one given twice, is refused
 */
function checkQuery(query: URLSearchParams, known: string[]) {
  for (const key of new Set(query.keys())) {
    if (!known.includes(key)) {
      throw badRequest(`[request query.${key}]: definition for this key is missing`);
    }
    if (query.getAll(key).length > 1) {
      throw badRequest(`[request query.${key}]: expected value of type [string] but got [Array]`);
    }
  }
  // Sets go into the cluster this server talks to: there are no other data sources to name
  if (query.has('data_source_id')) {
    throw badRequest('[request query.data_source_id]: data sources are not enabled');
  }
}

/** An error passed on with the status OpenSearch gave it; without one, it is the server's own */
function withStatus(error: unknown, message: string): Error {
  const status =
    error instanceof LegacyError
      ? error.statusCode
      : error instanceof HttpError
        ? error.status
        : (error as { status?: unknown })?.status;
  return typeof status === 'number' && status >= 400 && status < 600
    ? new HttpError(status, message)
    : new Error(message);
}

export interface SampleDataOptions {
  logger: Logger;
  /** The sets offered; those of OpenSearch Dashboards unless a test gives others */
  sets?: SampleDataSet[];
}

export function registerSampleData(
  router: Router,
  client: OpenSearchClient,
  repository: SavedObjectsRepository,
  options: SampleDataOptions
) {
  const { logger } = options;
  const sets = options.sets ?? SAMPLE_DATA_SETS;
  const call = (method: string, path: string, body?: unknown) =>
    sendLegacy(client, { method, path, body });
  const indexPath = (index: string) => `/${encodeURIComponent(index)}`;

  const probes: StatusProbes = {
    indexExists: async (index) => {
      try {
        await call('HEAD', indexPath(index));
        return true;
      } catch (error) {
        if (error instanceof LegacyError && error.statusCode === 404) return false;
        throw error;
      }
    },
    count: async (index) => {
      const answer = await call('POST', `${indexPath(index)}/_count`);
      return isRecord(answer) && typeof answer.count === 'number' ? answer.count : 0;
    },
    getDashboard: (id) => repository.get('dashboard', id),
  };

  router.get('/api/sample_data', async ({ query }) => {
    checkQuery(query, ['data_source_id']);
    const list = await Promise.all(
      sets.map(async (set) => ({ ...summaryOf(set), ...(await sampleDataStatus(set, probes)) }))
    );
    return { body: list };
  });

  const insertInto = (dataIndex: DataIndex, index: string, nowReference: string) => {
    const bulkInsert = async (docs: Document[]) => {
      const body = bulkBody(index, docs, (doc) => moveTimestamps(doc, dataIndex, nowReference));
      const answer = await call('POST', '/_bulk?filter_path=errors,items.*.error', body);
      if (isRecord(answer) && answer.errors) {
        logger.warn(
          `sample_data install errors while bulk inserting. OpenSearch response: ${JSON.stringify(answer)}`
        );
        throw new Error(
          `Unable to load sample data into index "${index}", see OpenSearch Dashboards logs for details`
        );
      }
    };
    return loadData(dataPath(dataIndex.dataFile), bulkInsert);
  };

  router.post('/api/sample_data/{id}', async ({ params, query }) => {
    checkQuery(query, ['now', 'data_source_id']);
    const set = sets.find(({ id }) => id === params.id);
    if (!set) throw notFound();
    const nowText = query.get('now');
    const now = nowText ? new Date(nowText) : new Date();
    if (Number.isNaN(now.getTime())) {
      throw badRequest(`[request query.now]: expected a date but got [${nowText}]`);
    }
    const nowReference = dateToIso8601IgnoringTime(now);
    const counts: Record<string, number> = {};

    for (const dataIndex of set.dataIndices) {
      const index = indexNameOf(set, dataIndex);
      // What an earlier install left goes first
      try {
        await call('DELETE', indexPath(index));
      } catch {
        // there was none
      }
      try {
        await call('PUT', indexPath(index), {
          settings: { index: { number_of_shards: 1, auto_expand_replicas: '0-1' } },
          mappings: { properties: readFields(dataIndex) },
        });
      } catch (error) {
        const message = `Unable to create sample data index "${index}", error: ${messageOf(error)}`;
        logger.warn(message);
        throw withStatus(error, message);
      }
      try {
        counts[index] = await insertInto(dataIndex, index, nowReference);
      } catch (error) {
        const message = `sample_data install errors while loading data. Error: Error: ${messageOf(error)}`;
        logger.warn(message);
        throw new HttpError(500, message);
      }
    }

    const objects: SampleSavedObject[] = readSavedObjects(set);
    let results: Awaited<ReturnType<SavedObjectsRepository['bulkCreate']>>;
    try {
      results = await repository.bulkCreate(objects, { overwrite: true });
    } catch (error) {
      const message = `bulkCreate failed, error: ${messageOf(error)}`;
      logger.warn(message);
      throw new HttpError(500, message);
    }
    const failed = results.filter((result) => 'error' in result && result.error);
    if (failed.length > 0) {
      const message = `sample_data install errors while loading saved objects. Errors: ${failed
        .map((result) => JSON.stringify(result))
        .join(',')}`;
      logger.warn(message);
      throw new HttpError(403, message);
    }
    const result: SampleDataInstallResult = {
      opensearchIndicesCreated: counts,
      opensearchDashboardsSavedObjectsLoaded: objects.length,
    };
    return { body: result };
  });

  router.delete('/api/sample_data/{id}', async ({ params, query }) => {
    checkQuery(query, ['data_source_id']);
    const set = sets.find(({ id }) => id === params.id);
    if (!set) throw notFound();

    // The saved objects first: whoever may not delete them leaves the data as it was. One
    // already deleted by hand is no failure.
    const outcomes = await Promise.allSettled(
      readSavedObjects(set).map(({ type, id }) => repository.delete(type, id))
    );
    for (const outcome of outcomes) {
      if (outcome.status === 'rejected' && !isNotFound(outcome.reason)) {
        throw withStatus(
          outcome.reason,
          `Unable to delete sample dataset saved objects, error: ${messageOf(outcome.reason)}`
        );
      }
    }

    for (const dataIndex of set.dataIndices) {
      const index = indexNameOf(set, dataIndex);
      try {
        await call('DELETE', indexPath(index));
      } catch (error) {
        throw withStatus(
          error,
          `Unable to delete sample data index "${index}", error: ${messageOf(error)}`
        );
      }
    }
    return { status: 204 };
  });
}

/* SPDX-License-Identifier: Apache-2.0 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import type { Config } from '../../server/config';
import { HttpError } from '../../server/http';
import type { Logger } from '../../server/logger';
import {
  OpenSearchError,
  OpenSearchUnavailableError,
  type OpenSearchClient,
  type OpenSearchRequest,
  type OpenSearchResponse,
} from '../../server/opensearch';
import { UiSettings, type UiSettingsOptions } from '../../server/ui_settings';
import { SETTING_SCHEMAS, validateSetting } from '../../server/ui_settings_schemas';
import { isConfigVersionUpgradeable } from '../../server/ui_settings_upgrade';
import timezones from '../../server/ui_settings_timezones.json';
import catalogue from '../../web/lib/settings_catalogue.json';

/** What OpenSearch Dashboards 3.9.0 answered, from its own code (see `about` in the file) */
const ORIGINAL = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'ui_settings_original.json'), 'utf8')
) as {
  answers: Array<[string, unknown, string | null]>;
  upgradeable: Array<[string, string, boolean]>;
};

type Source = Record<string, unknown>;
type Answer = { status: number; body: unknown };

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** A partial update as OpenSearch makes it: objects merged key by key, anything else replaced */
function merge(target: Source, changes: Source): Source {
  const result: Source = { ...target };
  for (const [key, value] of Object.entries(changes)) {
    const current = result[key];
    result[key] = isObject(value) && isObject(current) ? merge(current, value) : value;
  }
  return result;
}

const failure = (status: number, type: string, reason: string): Answer => ({
  status,
  body: { error: { root_cause: [{ type, reason }], type, reason }, status },
});

/**
 * An OpenSearch that keeps the documents of the saved objects index in memory, and notes every
 * request: enough of `_doc`, `_update`, `_create` and `_search` for the settings. `buildNum` is a
 * keyword there, so a search sorted by it sorts the numbers as text, as OpenSearch does.
 */
class MemoryOpenSearch {
  readonly docs = new Map<string, Source>();
  readonly sent: OpenSearchRequest[] = [];
  /** Answers a request in place of the index, once, when it gives an answer */
  intercept?: (request: OpenSearchRequest) => Answer | undefined;
  unavailable = false;
  private seqNo = 0;

  constructor(docs: Record<string, Source> = {}) {
    for (const [id, source] of Object.entries(docs)) this.docs.set(id, source);
  }

  /** The settings stored in `config:<version>` */
  stored(version = '3.9.0') {
    return this.docs.get(`config:${version}`)?.config as Source | undefined;
  }

  /** The requests sent, as "METHOD /path" */
  seen() {
    return this.sent.map((request) => `${request.method} ${decodeURIComponent(request.path)}`);
  }

  private answer({ status, body }: Answer): OpenSearchResponse {
    const headers = { 'content-type': 'application/json' };
    return { status, headers, body: Buffer.from(JSON.stringify(body)) };
  }

  async raw(request: OpenSearchRequest): Promise<OpenSearchResponse> {
    this.sent.push(request);
    if (this.unavailable) {
      throw new OpenSearchUnavailableError('OpenSearch cannot be reached: connect ECONNREFUSED');
    }
    const intercepted = this.intercept?.(request);
    if (intercepted) {
      this.intercept = undefined;
      return this.answer(intercepted);
    }
    return this.answer(this.handle(request));
  }

  private handle(request: OpenSearchRequest): Answer {
    const [, index, action, rawId] = request.path.split('/');
    const id = decodeURIComponent(rawId ?? '');
    const base = { _index: `${decodeURIComponent(index)}_1`, _id: id };
    const current = this.docs.get(id);
    this.seqNo += 1;
    const version = { _seq_no: this.seqNo, _primary_term: 1 };
    if (request.method === 'GET' && action === '_doc') {
      if (!current) return { status: 404, body: { ...base, found: false } };
      return { status: 200, body: { ...base, _version: 1, ...version, found: true, _source: current } };
    }
    if (request.method === 'POST' && action === '_update') {
      if (!current) return failure(404, 'document_missing_exception', `[${id}]: document missing`);
      this.docs.set(id, merge(current, (request.body as { doc: Source }).doc));
      return { status: 200, body: { ...base, _version: 2, result: 'updated', ...version } };
    }
    if (request.method === 'PUT' && action === '_create') {
      if (current) {
        const reason = `[${id}]: version conflict, document already exists (current version [1])`;
        return failure(409, 'version_conflict_engine_exception', reason);
      }
      this.docs.set(id, request.body as Source);
      return { status: 201, body: { ...base, _version: 1, result: 'created', ...version } };
    }
    if (request.method === 'POST' && action === '_search') return this.search(request, base._index);
    return failure(400, 'unknown', `not faked: ${request.method} ${request.path}`);
  }

  private search(request: OpenSearchRequest, index: string): Answer {
    const [sort] = (request.body as { sort?: Array<Record<string, { order?: string }>> }).sort ?? [];
    const field = sort ? Object.keys(sort)[0] : undefined;
    const descending = Boolean(sort && field && sort[field].order === 'desc');
    const keyOf = (source: Source) => {
      if (!field) return undefined;
      const [type, name] = field.split('.');
      const value = (source[type] as Source | undefined)?.[name];
      return value === undefined || value === null ? undefined : String(value);
    };
    const hits = [...this.docs]
      .filter(([, source]) => source.type === 'config')
      .map(([id, source]) => ({ id, source, key: keyOf(source) }))
      .sort((a, b) => {
        // A missing value comes last; text sorts as OpenSearch sorts a keyword
        if (a.key === b.key) return 0;
        if (a.key === undefined) return 1;
        if (b.key === undefined) return -1;
        const order = a.key < b.key ? -1 : 1;
        return descending ? -order : order;
      });
    const size = Number(request.query?.size ?? 10);
    return {
      status: 200,
      body: {
        hits: {
          total: hits.length,
          hits: hits.slice(0, size).map((hit) => ({
            _index: index,
            _id: hit.id,
            _score: null,
            _source: hit.source,
            sort: [hit.key ?? null],
          })),
        },
      },
    };
  }

  async request<T>(request: OpenSearchRequest): Promise<T> {
    const response = await this.raw(request);
    const body = JSON.parse(response.body.toString('utf8')) as T & { error?: { reason?: string } };
    if (response.status >= 400) {
      throw new OpenSearchError(response.status, body, body.error?.reason ?? 'failed');
    }
    return body;
  }

  get client() {
    return this as unknown as OpenSearchClient;
  }
}

/** A document of the settings of a version, as OpenSearch Dashboards writes it */
const configDocument = (config: Source): Source => ({
  config,
  type: 'config',
  references: [],
  migrationVersion: { config: '7.9.0' },
  updated_at: '2026-01-01T00:00:00.000Z',
});

/** An OpenSearch whose `config:3.9.0` holds these settings */
const holding = (config: Source) => new MemoryOpenSearch({ 'config:3.9.0': configDocument(config) });

const NO_CONFIG: Config['uiSettings'] = { overrides: {}, defaults: {} };

const settingsOf = (
  opensearch: MemoryOpenSearch,
  config: Config['uiSettings'] = NO_CONFIG,
  options: UiSettingsOptions = {}
) => new UiSettings(opensearch.client, '.kibana', '3.9.0', config, options);

function recordingLogger() {
  const warnings: string[] = [];
  const debugs: string[] = [];
  const logger: Logger = {
    info() {},
    error() {},
    listening() {},
    warn: (message) => warnings.push(message),
    debug: (message) => debugs.push(message),
  };
  return { logger, warnings, debugs };
}

const writes = (opensearch: MemoryOpenSearch) =>
  opensearch.sent.filter((request) => request.method !== 'GET' && !request.path.endsWith('/_search'));

const updateOf = (request: OpenSearchRequest) => (request.body as { doc: { config: Source } }).doc.config;

/** The status and message a refused write answers with, or `undefined` when it is not refused */
async function refusal(promise: Promise<unknown>) {
  try {
    await promise;
    return undefined;
  } catch (error) {
    if (error instanceof HttpError) return { status: error.status, message: error.message };
    throw error;
  }
}

/** The message a check throws, or `undefined` when it lets the value through */
function failureOf(check: () => void): string | undefined {
  try {
    check();
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

describe('the advanced settings as stored', () => {
  it('gives back the Timeline settings stored under their old names under the new ones', async () => {
    const opensearch = holding({ 'timelion:es.timefield': 'timestamp', 'csv:separator': ';' });
    assert.deepEqual(await settingsOf(opensearch).getUserProvided(), {
      'timeline:es.timefield': 'timestamp',
      'csv:separator': ';',
    });
  });

  it('stores the Timeline settings under their old names, as the original does', async () => {
    const opensearch = holding({});
    await settingsOf(opensearch).setMany({ 'timeline:max_buckets': 100, 'csv:separator': ';' });
    assert.deepEqual(updateOf(writes(opensearch)[0]), {
      'timelion:max_buckets': 100,
      'csv:separator': ';',
    });
  });

  it("takes the name of an object's own method for a setting like any other, as the original", async () => {
    const opensearch = holding({ constructor: 'stored' });
    const settings = settingsOf(opensearch, { overrides: { 'theme:darkMode': true }, defaults: {} });
    // Not overridden: the original stores them and answers 200
    await settings.setMany({ toString: 'a', valueOf: null });
    assert.deepEqual(updateOf(writes(opensearch)[0]), { toString: 'a', valueOf: null });
    assert.deepEqual(await refusal(settings.setMany({ 'theme:darkMode': false })), {
      status: 400,
      message: 'Unable to update "theme:darkMode" because it is overridden',
    });
    assert.deepEqual(await settings.getAll(), {
      constructor: { userValue: 'stored' },
      toString: { userValue: 'a' },
      'theme:darkMode': { isOverridden: true, userValue: true },
    });
    // Neither set nor overridden nor with a default here: the fallback, not what every object has
    assert.equal(await settings.peek('hasOwnProperty', 'fallback'), 'fallback');
    assert.equal(await settings.peek('constructor', 'fallback'), 'stored');
    assert.equal(await settings.peek('toString', 'fallback'), 'a');
  });
});

describe('the schemas of the settings, as the original checks a value', () => {
  it('has a schema for every setting of the catalogue, and for no other', () => {
    assert.deepEqual(Object.keys(SETTING_SCHEMAS).sort(), Object.keys(catalogue).sort());
  });

  it('knows the time zones the original offers, and no others', () => {
    const options = (catalogue as Record<string, { options?: unknown[] }>)['dateFormat:tz'].options;
    assert.deepEqual(timezones, options);
  });

  it('refuses each value the original refuses, with its message, and accepts each it accepts', () => {
    assert.ok(ORIGINAL.answers.length > 400);
    for (const [key, value, message] of ORIGINAL.answers) {
      const what = `${key} = ${JSON.stringify(value)}`;
      assert.equal(failureOf(() => validateSetting(key, value)), message ?? undefined, what);
    }
  });

  it('refuses a write the original refuses with 400 and its message, and writes nothing', async () => {
    const opensearch = holding({ buildNum: 1 });
    const settings = settingsOf(opensearch);
    for (const [key, value, message] of ORIGINAL.answers) {
      const before = opensearch.sent.length;
      const what = `${key} = ${JSON.stringify(value)}`;
      if (message === null) {
        await settings.setMany({ [key]: value });
        // Stored as it came, not as the schema read it
        const stored = opensearch.stored()?.[key.replace('timeline', 'timelion')];
        if (!isObject(value)) assert.deepEqual(stored, value, what);
      } else {
        const refused = await refusal(settings.setMany({ [key]: value }));
        assert.deepEqual(refused, { status: 400, message }, what);
        assert.equal(opensearch.sent.length, before, `nothing is asked of OpenSearch for ${what}`);
      }
    }
  });

  it('checks every value before it writes, so that one value refused stores none', async () => {
    const opensearch = holding({ dateFormat: 'before' });
    const changes = { dateFormat: 'x', 'timepicker:quickRanges': '5' };
    assert.deepEqual(await refusal(settingsOf(opensearch).setMany(changes)), {
      status: 400,
      message:
        '[validation [timepicker:quickRanges]]: expected value of type [array] but got [number]',
    });
    assert.equal(writes(opensearch).length, 0);
    assert.deepEqual(opensearch.stored(), { dateFormat: 'before' });
  });

  it('asks whether a setting is overridden before it checks any value, as the original', async () => {
    const settings = settingsOf(holding({}), { overrides: { 'csv:separator': ';' }, defaults: {} });
    assert.deepEqual(await refusal(settings.setMany({ dateFormat: 5, 'csv:separator': 5 })), {
      status: 400,
      message: 'Unable to update "csv:separator" because it is overridden',
    });
  });

  it('takes a setting back to its default with null, whatever its schema', async () => {
    const settings = settingsOf(holding({ 'timepicker:quickRanges': '[]' }));
    await settings.setMany({ 'timepicker:quickRanges': null, dateFormat: null });
    assert.deepEqual(await settings.getAll(), {});
  });

  it('writes nothing when there is nothing to change', async () => {
    const opensearch = holding({});
    await settingsOf(opensearch).setMany({});
    assert.deepEqual(opensearch.seen(), []);
  });
});

describe('the advanced settings as read', () => {
  it('leaves out a stored value its schema refuses, and says so, as the original', async () => {
    const opensearch = holding({
      buildNum: 39687,
      'timepicker:quickRanges': '{}',
      dateFormat: 'YYYY',
      'timepicker:timeDefaults': 'null',
      'timepicker:refreshIntervalDefaults': 'null',
      'format:defaultTypeMap': 'null',
      'format:number:defaultPattern': 5,
      defaultColumns: {},
      metaFields: [1, 2],
      'dateFormat:tz': 'Mars/Phobos',
      'visualization:colorMapping': '[1]',
      'zz:custom': { a: [1, { b: null }] },
      'discover:sampleSize': '50',
      'timelion:max_buckets': 'many',
      'theme:darkMode': null,
    });
    const { logger, warnings } = recordingLogger();
    const settings = settingsOf(opensearch, NO_CONFIG, { logger });
    // What the original's settings API answers for the same document
    assert.deepEqual(await settings.getUserProvided(), {
      buildNum: 39687,
      dateFormat: 'YYYY',
      'visualization:colorMapping': '[1]',
      'zz:custom': { a: [1, { b: null }] },
      'discover:sampleSize': '50',
    });
    // The original's line is `Ignore invalid UiSettings value. ${error}.`: a message that ends with
    // a full stop ends with two
    const ignored = 'Ignore invalid UiSettings value. ValidationError: [validation ';
    const notAnObject = 'expected a plain object value, but found [null] instead..';
    assert.deepEqual(warnings, [
      `${ignored}[timepicker:quickRanges]]: expected value of type [array] but got [Object].`,
      `${ignored}[timepicker:timeDefaults]]: ${notAnObject}`,
      `${ignored}[timepicker:refreshIntervalDefaults]]: ${notAnObject}`,
      `${ignored}[format:defaultTypeMap]]: ${notAnObject}`,
      `${ignored}[format:number:defaultPattern]]: expected value of type [string] but got [number].`,
      `${ignored}[defaultColumns]]: expected value of type [array] but got [Object].`,
      `${ignored}[metaFields].0]: expected value of type [string] but got [number].`,
      `${ignored}[dateFormat:tz]]: Invalid timezone: Mars/Phobos.`,
      `${ignored}[timeline:max_buckets]]: expected value of type [number] but got [string].`,
    ]);
    // Nor does the server use one itself
    assert.equal(await settings.peek('dateFormat:tz', 'Browser'), 'Browser');
  });

  it('answers as the settings API of the original: what is stored, then the overrides', async () => {
    const opensearch = holding({
      buildNum: 39687,
      'csv:separator': ';',
      dateFormat: 'stored',
      'theme:darkMode': false,
    });
    const overrides = { 'theme:darkMode': true, 'notifications:banner': null };
    const all = await settingsOf(opensearch, { overrides, defaults: {} }).getAll();
    assert.deepEqual(all, {
      buildNum: { userValue: 39687 },
      'csv:separator': { userValue: ';' },
      dateFormat: { userValue: 'stored' },
      'theme:darkMode': { isOverridden: true, userValue: true },
      'notifications:banner': { isOverridden: true },
    });
    assert.deepEqual(Object.keys(all), [
      'buildNum',
      'csv:separator',
      'dateFormat',
      'theme:darkMode',
      'notifications:banner',
    ]);
    assert.deepEqual(Object.keys(all['theme:darkMode']), ['isOverridden', 'userValue']);
  });

  it('has no settings, rather than an error, when OpenSearch cannot be asked or refuses', async () => {
    const unreachable = new MemoryOpenSearch();
    unreachable.unavailable = true;
    const config = { overrides: { 'csv:separator': ';' }, defaults: {} };
    assert.deepEqual(await settingsOf(unreachable, config).getAll(), {
      'csv:separator': { isOverridden: true, userValue: ';' },
    });

    const forbidding = new MemoryOpenSearch();
    forbidding.intercept = () => failure(403, 'security_exception', 'no permissions');
    assert.deepEqual(await settingsOf(forbidding).getUserProvided(), {});
  });
});

describe('the settings document of this version, made as the original makes it', () => {
  it('is made with the build number when the settings are first read', async () => {
    const opensearch = new MemoryOpenSearch();
    const settings = settingsOf(opensearch, NO_CONFIG, { buildNum: 39687 });
    assert.deepEqual(await settings.getAll(), { buildNum: { userValue: 39687 } });
    assert.deepEqual(opensearch.seen(), [
      'GET /.kibana/_doc/config:3.9.0',
      'POST /.kibana/_search',
      'PUT /.kibana/_create/config:3.9.0',
      'GET /.kibana/_doc/config:3.9.0',
    ]);
    const made = opensearch.docs.get('config:3.9.0');
    assert.deepEqual({ ...made, updated_at: 'any' }, {
      config: { buildNum: 39687 },
      type: 'config',
      references: [],
      migrationVersion: { config: '7.9.0' },
      updated_at: 'any',
    });
    // The search for older settings is the original's: the first thousand, newest build first
    const search = opensearch.sent[1];
    assert.equal(search.query?.size, 1000);
    assert.deepEqual((search.body as { sort: unknown }).sort, [
      { 'config.buildNum': { order: 'desc', unmapped_type: 'keyword' } },
    ]);
  });

  it('writes the build number of a build without one as the original does then', async () => {
    const opensearch = new MemoryOpenSearch();
    await settingsOf(opensearch).getUserProvided();
    assert.deepEqual(opensearch.stored(), { buildNum: Number.MAX_SAFE_INTEGER });
  });

  it('carries over the settings of the older release whose build number sorts first as text', async () => {
    const opensearch = new MemoryOpenSearch({
      'config:2.11.0': configDocument({
        buildNum: 6900,
        dateFormat: 'from 2.11.0',
        'timelion:es.timefield': 'ts',
      }),
      'config:3.8.0': configDocument({ buildNum: 39000, dateFormat: 'from 3.8.0' }),
      // Newer, or not a release: never carried over
      'config:4.0.0': configDocument({ buildNum: 99999, dateFormat: 'from 4.0.0' }),
      'config:3.9.0-SNAPSHOT': configDocument({ buildNum: 99998, dateFormat: 'from a snapshot' }),
      'config:3.8.0-alpha1': configDocument({ buildNum: 99997, dateFormat: 'from an alpha' }),
    });
    const { logger, debugs } = recordingLogger();
    const settings = settingsOf(opensearch, NO_CONFIG, { buildNum: 39687, logger });
    // "6900" sorts before "39000" as text, as buildNum is a keyword in the index
    assert.deepEqual(await settings.getUserProvided(), {
      buildNum: 39687,
      dateFormat: 'from 2.11.0',
      'timeline:es.timefield': 'ts',
    });
    assert.deepEqual(opensearch.stored(), {
      buildNum: 39687,
      dateFormat: 'from 2.11.0',
      'timelion:es.timefield': 'ts',
    });
    assert.deepEqual(debugs, ['Upgrade config from 2.11.0 to 3.9.0']);
  });

  it('carries over the settings of a Kibana before the fork, and of an earlier candidate', async () => {
    const options = { buildNum: 39687 };
    const kibana = new MemoryOpenSearch({
      'config:7.10.2': configDocument({ buildNum: 36000, defaultIndex: 'logs' }),
    });
    await settingsOf(kibana, NO_CONFIG, options).getUserProvided();
    assert.deepEqual(kibana.stored(), { buildNum: 39687, defaultIndex: 'logs' });

    const candidate = new MemoryOpenSearch({
      'config:3.9.0-rc1': configDocument({ buildNum: 39600, dateFormat: 'rc' }),
    });
    await settingsOf(candidate, NO_CONFIG, options).getUserProvided();
    assert.deepEqual(candidate.stored(), { buildNum: 39687, dateFormat: 'rc' });

    const newer = new MemoryOpenSearch({
      'config:8.0.0': configDocument({ buildNum: 50000, dateFormat: 'eight' }),
    });
    await settingsOf(newer, NO_CONFIG, options).getUserProvided();
    assert.deepEqual(newer.stored(), { buildNum: 39687 });
  });

  it('is made, carrying over, before the first write when there is none, then written', async () => {
    const opensearch = new MemoryOpenSearch({
      'config:3.8.0': configDocument({ buildNum: 39000, dateFormat: 'old' }),
    });
    await settingsOf(opensearch, NO_CONFIG, { buildNum: 39687 }).setMany({ 'csv:separator': ';' });
    assert.deepEqual(opensearch.seen(), [
      'POST /.kibana/_update/config:3.9.0',
      'POST /.kibana/_search',
      'PUT /.kibana/_create/config:3.9.0',
      'POST /.kibana/_update/config:3.9.0',
    ]);
    assert.deepEqual(opensearch.stored(), { buildNum: 39687, dateFormat: 'old', 'csv:separator': ';' });
  });

  it('reads the document another server made in the meantime', async () => {
    const opensearch = new MemoryOpenSearch();
    opensearch.intercept = (request) => {
      if (request.method !== 'PUT') return undefined;
      opensearch.docs.set('config:3.9.0', configDocument({ buildNum: 1, dateFormat: 'theirs' }));
      return failure(409, 'version_conflict_engine_exception', 'document already exists');
    };
    assert.deepEqual(await settingsOf(opensearch).getUserProvided(), {
      buildNum: 1,
      dateFormat: 'theirs',
    });
  });

  it('uses what it would have held when it may not be written', async () => {
    const opensearch = new MemoryOpenSearch({
      'config:3.8.0': configDocument({ buildNum: 39000, dateFormat: 'old' }),
    });
    opensearch.intercept = (request) =>
      request.method === 'PUT' ? failure(403, 'security_exception', 'no permissions') : undefined;
    const settings = settingsOf(opensearch, NO_CONFIG, { buildNum: 39687 });
    assert.deepEqual(await settings.getUserProvided(), { buildNum: 39687, dateFormat: 'old' });
  });

  it('decides which settings may be carried over as isConfigVersionUpgradeable does', () => {
    assert.ok(ORIGINAL.upgradeable.length > 400);
    for (const [saved, current, expected] of ORIGINAL.upgradeable) {
      assert.equal(isConfigVersionUpgradeable(saved, current), expected, `${saved} to ${current}`);
    }
    assert.equal(isConfigVersionUpgradeable(5, '3.9.0'), false);
  });
});

/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The advanced settings: one saved object, `config:<version>`, as in OpenSearch Dashboards, so
 * the two products read each other's. Only values someone has set are stored; the browser side
 * knows every setting's default.
 */

import type { Config } from './config';
import { badRequest } from './http';
import { OpenSearchError, type OpenSearchClient } from './opensearch';

export class UiSettings {
  private cached?: { at: number; values: Record<string, unknown> };

  constructor(
    private readonly client: OpenSearchClient,
    private readonly index: string,
    private readonly version: string,
    private readonly config: Config['uiSettings']
  ) {}

  private get path() {
    return `/${encodeURIComponent(this.index)}`;
  }
  private get id() {
    return `config:${this.version}`;
  }

  /** What has been set, without the overrides of the server's settings */
  async getUserProvided(): Promise<Record<string, unknown>> {
    const response = await this.client.raw({
      method: 'GET',
      path: `${this.path}/_doc/${encodeURIComponent(this.id)}`,
    });
    let stored: Record<string, unknown> = {};
    if (response.status === 200) {
      const document = JSON.parse(response.body.toString('utf8')) as {
        _source?: { config?: Record<string, unknown> };
      };
      stored = document._source?.config ?? {};
    } else if (response.status !== 404) {
      throw new OpenSearchError(response.status, undefined, `OpenSearch answered ${response.status}`);
    }
    const values: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(stored)) {
      if (value !== null && key !== 'buildNum') values[key] = value;
    }
    this.cached = { at: Date.now(), values };
    return values;
  }

  /** In the shape the settings API of OpenSearch Dashboards answers with */
  async getAll(): Promise<Record<string, { userValue?: unknown; isOverridden?: boolean }>> {
    const user = await this.getUserProvided();
    const settings: Record<string, { userValue?: unknown; isOverridden?: boolean }> = {};
    for (const [key, value] of Object.entries(user)) settings[key] = { userValue: value };
    for (const [key, value] of Object.entries(this.config.overrides)) {
      settings[key] = { userValue: value, isOverridden: true };
    }
    return settings;
  }

  /** A value for the server's own use, from a copy at most a few seconds old */
  async peek<T>(key: string, fallback: T): Promise<T> {
    if (key in this.config.overrides) return this.config.overrides[key] as T;
    try {
      const values =
        this.cached && Date.now() - this.cached.at < 5000
          ? this.cached.values
          : await this.getUserProvided();
      if (key in values) return values[key] as T;
    } catch {
      // without OpenSearch the page still has to come up, in the default look
    }
    return key in this.config.defaults ? (this.config.defaults[key] as T) : fallback;
  }

  /** `null` takes a setting back to its default */
  async setMany(changes: Record<string, unknown>) {
    for (const key of Object.keys(changes)) {
      if (key in this.config.overrides) {
        throw badRequest(`Unable to update "${key}" because it is overridden`);
      }
    }
    await this.client.request({
      method: 'POST',
      path: `${this.path}/_update/${encodeURIComponent(this.id)}`,
      query: { refresh: 'wait_for', retry_on_conflict: 3 },
      body: {
        doc: { config: changes, updated_at: new Date().toISOString() },
        upsert: {
          type: 'config',
          config: changes,
          references: [],
          updated_at: new Date().toISOString(),
        },
      },
    });
    this.cached = undefined;
  }
}

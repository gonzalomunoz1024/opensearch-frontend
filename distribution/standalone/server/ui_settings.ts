/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The advanced settings: one saved object, `config:<version>`, as in OpenSearch Dashboards, so
 * the two products read each other's. Only values someone has set are stored; the browser side
 * knows every setting's default. As in the original's settings client, a value is checked against
 * the schema of its setting (ui_settings_schemas.ts) before anything is written, and refused with
 * 400 when it does not pass; a stored value that does not pass is left out when the settings are
 * read. The document is made the first time it is read or written, with the build number and the
 * settings of an older release carried over (ui_settings_upgrade.ts).
 */

import type { Config } from './config';
import { badRequest, HttpError } from './http';
import { silentLogger, type Logger } from './logger';
import { OpenSearchUnavailableError, type OpenSearchClient } from './opensearch';
import { SavedObjectsRepository } from './saved_objects';
import { SettingValidationError, validateSetting } from './ui_settings_schemas';
import { createOrUpgradeSavedConfig } from './ui_settings_upgrade';

/**
 * The original stores the Timeline settings under their old `timelion` names, and gives them back
 * under the new ones: the first occurrence in a key is changed, as its settings client does
 */
function translateKeys(values: Record<string, unknown>, source: string, destination: string) {
  const translated: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) translated[key.replace(source, destination)] = value;
  return translated;
}

export interface UiSettingsOptions {
  /**
   * Written into the document when it is made. The original writes its build number; without
   * one (a development build) it writes `Number.MAX_SAFE_INTEGER`, as this does by default.
   */
  buildNum?: number;
  /** Where a stored value that is left out is reported, as the original warns of it */
  logger?: Logger;
}

const isStatus = (error: unknown, ...statuses: number[]) =>
  error instanceof HttpError && statuses.includes(error.status);

export class UiSettings {
  private cached?: { at: number; values: Record<string, unknown> };
  private readonly repository: SavedObjectsRepository;
  private readonly buildNum: number;
  private readonly logger: Logger;

  constructor(
    client: OpenSearchClient,
    index: string,
    private readonly version: string,
    private readonly config: Config['uiSettings'],
    options: UiSettingsOptions = {}
  ) {
    this.repository = new SavedObjectsRepository(client, index);
    this.buildNum = options.buildNum ?? Number.MAX_SAFE_INTEGER;
    this.logger = options.logger ?? silentLogger;
  }

  private isOverridden(key: string) {
    // Own keys only, as the original's `hasOwnProperty`: `toString` is a key like any other
    return Object.hasOwn(this.config.overrides, key);
  }

  private createOrUpgrade(handleWriteErrors: boolean) {
    return createOrUpgradeSavedConfig({
      repository: this.repository,
      version: this.version,
      buildNum: this.buildNum,
      logger: this.logger,
      handleWriteErrors,
    });
  }

  /**
   * The stored document's settings. When there is none it is made, and read again; when
   * OpenSearch cannot be asked or refuses the read, there are none, as in the original.
   */
  private async read(autoCreateOrUpgradeIfMissing = true): Promise<Record<string, unknown>> {
    try {
      const { attributes } = await this.repository.get('config', this.version);
      return translateKeys(attributes ?? {}, 'timelion', 'timeline');
    } catch (error) {
      if (isStatus(error, 404) && autoCreateOrUpgradeIfMissing) {
        const failedUpgradeAttributes = await this.createOrUpgrade(true);
        if (!failedUpgradeAttributes) return this.read(false);
        return failedUpgradeAttributes;
      }
      if (error instanceof OpenSearchUnavailableError || isStatus(error, 403, 503)) return {};
      throw error;
    }
  }

  /**
   * What has been set, without the overrides of the server's settings: a value that is `null`,
   * overridden, or refused by the schema of its setting is left out
   */
  async getUserProvided(): Promise<Record<string, unknown>> {
    const values: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(await this.read())) {
      if (value === null || this.isOverridden(key)) continue;
      try {
        validateSetting(key, value);
        values[key] = value;
      } catch (error) {
        if (!(error instanceof SettingValidationError)) throw error;
        this.logger.warn(`Ignore invalid UiSettings value. ${error.name}: ${error.message}.`);
      }
    }
    this.cached = { at: Date.now(), values };
    return values;
  }

  /** In the shape the settings API of OpenSearch Dashboards answers with, overrides last */
  async getAll(): Promise<Record<string, { userValue?: unknown; isOverridden?: boolean }>> {
    const settings: Record<string, { userValue?: unknown; isOverridden?: boolean }> = {};
    for (const [key, value] of Object.entries(await this.getUserProvided())) {
      settings[key] = { userValue: value };
    }
    for (const [key, value] of Object.entries(this.config.overrides)) {
      settings[key] = value === null ? { isOverridden: true } : { isOverridden: true, userValue: value };
    }
    return settings;
  }

  /** A value for the server's own use, from a copy at most a few seconds old */
  async peek<T>(key: string, fallback: T): Promise<T> {
    if (this.isOverridden(key)) return this.config.overrides[key] as T;
    try {
      const values =
        this.cached && Date.now() - this.cached.at < 5000
          ? this.cached.values
          : await this.getUserProvided();
      if (Object.hasOwn(values, key)) return values[key] as T;
    } catch {
      // without OpenSearch the page still has to come up, in the default look
    }
    return Object.hasOwn(this.config.defaults, key) ? (this.config.defaults[key] as T) : fallback;
  }

  /**
   * `null` takes a setting back to its default. Every key is checked before anything is written:
   * first whether it is overridden, then its value, so that nothing is stored when one is refused.
   */
  async setMany(changes: Record<string, unknown>) {
    for (const key of Object.keys(changes)) {
      if (this.isOverridden(key)) {
        throw badRequest(`Unable to update "${key}" because it is overridden`);
      }
    }
    for (const [key, value] of Object.entries(changes)) {
      try {
        validateSetting(key, value);
      } catch (error) {
        if (error instanceof SettingValidationError) throw badRequest(error.message);
        throw error;
      }
    }
    // No change, no write: the original writes only a group of changes that has some
    if (Object.keys(changes).length === 0) return;
    await this.write(translateKeys(changes, 'timeline', 'timelion'));
    this.cached = undefined;
  }

  /** An update of the document; a missing one is made first, then updated */
  private async write(changes: Record<string, unknown>, autoCreateOrUpgradeIfMissing = true): Promise<void> {
    try {
      await this.repository.update('config', this.version, changes);
    } catch (error) {
      if (!isStatus(error, 404) || !autoCreateOrUpgradeIfMissing) throw error;
      await this.createOrUpgrade(false);
      await this.write(changes, false);
    }
  }
}

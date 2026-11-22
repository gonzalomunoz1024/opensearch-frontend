/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The advanced settings in the browser: every setting this product reads, with its default,
 * and over it what someone has set, which the server stores as OpenSearch Dashboards does.
 */

import catalogue from '../lib/settings_catalogue.json';
import type { Http } from './http';

export interface SettingDefinition {
  name: string;
  value: unknown;
  description: string;
  /** boolean, number, string, array, json, select */
  type: string;
  category: string;
  options?: string[];
  optionLabels?: Record<string, string>;
  requiresPageReload?: boolean;
}

interface SettingsAnswer {
  settings: Record<string, { userValue?: unknown; isOverridden?: boolean }>;
}

export class UiSettingsClient {
  readonly definitions = catalogue as Record<string, SettingDefinition>;
  private user: Record<string, unknown>;
  private readonly listeners = new Set<() => void>();
  private version = 0;

  constructor(
    private readonly http: Http,
    user: Record<string, unknown>,
    /** Defaults the server's own settings file gives in place of the catalogue's */
    private readonly serverDefaults: Record<string, unknown>,
    private readonly overrides: Record<string, unknown>
  ) {
    this.user = { ...user };
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  /** Changes whenever a setting does: what a component watches */
  getVersion = () => this.version;

  defaultOf(key: string): unknown {
    if (key in this.serverDefaults) return this.serverDefaults[key];
    return this.definitions[key]?.value;
  }

  isOverridden(key: string) {
    return key in this.overrides;
  }
  isDefault(key: string) {
    return !(key in this.user) && !this.isOverridden(key);
  }
  /** What someone has set, as it is stored */
  userValue(key: string): unknown {
    return this.isOverridden(key) ? this.overrides[key] : this.user[key];
  }

  /** A setting's value, read as its type: a JSON setting comes back parsed */
  get<T = unknown>(key: string, fallback?: T): T {
    const definition = this.definitions[key];
    const raw = this.isOverridden(key)
      ? this.overrides[key]
      : key in this.user
        ? this.user[key]
        : this.defaultOf(key);
    if (raw === undefined || raw === null) return fallback as T;
    if (definition?.type === 'json' && typeof raw === 'string') {
      try {
        return JSON.parse(raw) as T;
      } catch {
        try {
          return JSON.parse(String(definition.value)) as T;
        } catch {
          return fallback as T;
        }
      }
    }
    if (definition?.type === 'number' && typeof raw === 'string') return Number(raw) as T;
    if (definition?.type === 'boolean' && typeof raw === 'string') return (raw === 'true') as T;
    if (definition?.type === 'array' && typeof raw === 'string') {
      return raw
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean) as T;
    }
    return raw as T;
  }

  private apply(answer: SettingsAnswer) {
    const user: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(answer.settings)) {
      if (!value.isOverridden && value.userValue !== undefined) user[key] = value.userValue;
    }
    this.user = user;
    this.version += 1;
    for (const listener of [...this.listeners]) listener();
  }

  /** `null` takes a setting back to its default */
  async setMany(changes: Record<string, unknown>) {
    this.apply(
      await this.http.post<SettingsAnswer>('/api/opensearch-dashboards/settings', {
        body: { changes },
      })
    );
  }
  set(key: string, value: unknown) {
    return this.setMany({ [key]: value });
  }
  remove(key: string) {
    return this.setMany({ [key]: null });
  }
  async refresh() {
    this.apply(await this.http.get<SettingsAnswer>('/api/opensearch-dashboards/settings'));
  }
}

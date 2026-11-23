/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The advanced settings in the browser: every setting OpenSearch Dashboards 3.9.0 registers, as
 * its page gets them (the catalogue), and over them what someone has set, which the server stores
 * as OpenSearch Dashboards does. With theme:enableUserControl on, the settings that prefer the
 * browser's value (dark mode, theme version) are kept in this browser instead, as the original
 * keeps them.
 */

import catalogue from '../lib/settings_catalogue.json';
import type { Http } from './http';

export interface SettingDefinition {
  name?: string;
  value?: unknown;
  description?: string;
  /** boolean, number, string, array, json, markdown, select, image; else known from the value */
  type?: string;
  category?: string[];
  options?: Array<string | number>;
  optionLabels?: Record<string, string>;
  requiresPageReload?: boolean;
  readonly?: boolean;
  /** global, user, workspace or dashboard_admin; global when there is none */
  scope?: string | string[];
  preferBrowserSetting?: boolean;
  deprecation?: { message: string; docLinksKey: string };
}

interface SettingsAnswer {
  settings: Record<string, { userValue?: unknown; isOverridden?: boolean }>;
}

/**
 * The original's client has a settings API, each with a queue of its own, for a write without a
 * scope (`default`) and for each scope a write names. The advanced settings page names one.
 */
type Lane = 'default' | 'global' | 'dashboard_admin';

/** Changes waiting for the request on their way to be answered, and who waits for them */
interface Batch {
  values: Record<string, unknown>;
  waiting: Array<{ resolve: (answer: SettingsAnswer) => void; reject: (error: unknown) => void }>;
}

/** The type of a setting: the one it is registered with, else that of its default or value */
export function settingType(definition: SettingDefinition | undefined, value?: unknown): string {
  if (definition?.type) return definition.type;
  if (Array.isArray(value) || Array.isArray(definition?.value)) return 'array';
  const known = definition?.value !== undefined && definition?.value !== null ? definition.value : value;
  const type = typeof known;
  return type === 'bigint' ? 'number' : type;
}

/** The scopes of a setting: global when it names none */
export function settingScopes(definition: SettingDefinition | undefined): string[] {
  const scope = definition?.scope;
  if (scope === undefined) return ['global'];
  return Array.isArray(scope) ? scope : [scope];
}

const USER_CONTROL = 'theme:enableUserControl';
// Where this browser keeps its own values, as the original's `uiSettings` in local storage
const BROWSER_KEY = 'infradashboard:uiSettings';

function readBrowserValues(): Record<string, { userValue?: unknown }> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(BROWSER_KEY) ?? '{}') as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, { userValue?: unknown }>) : {};
  } catch {
    return {};
  }
}

function writeBrowserValues(values: Record<string, { userValue?: unknown }>) {
  try {
    window.localStorage.setItem(BROWSER_KEY, JSON.stringify(values));
  } catch {
    // kept for this visit only
  }
}

export class UiSettingsClient {
  readonly definitions = catalogue as Record<string, SettingDefinition>;
  private user: Record<string, unknown>;
  private browser: Record<string, { userValue?: unknown }>;
  private readonly listeners = new Set<() => void>();
  private version = 0;
  private readonly lanes = new Map<Lane, { pending?: Batch; sending: boolean }>();

  constructor(
    private readonly http: Http,
    user: Record<string, unknown>,
    /** Defaults the server's own settings file gives in place of the catalogue's */
    private readonly serverDefaults: Record<string, unknown>,
    private readonly overrides: Record<string, unknown>
  ) {
    this.user = { ...user };
    this.browser = typeof window === 'undefined' ? {} : readBrowserValues();
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  /** Changes whenever a setting does: what a component watches */
  getVersion = () => this.version;

  private changed() {
    this.version += 1;
    for (const listener of [...this.listeners]) listener();
  }

  defaultOf(key: string): unknown {
    if (key in this.serverDefaults) return this.serverDefaults[key];
    return this.definitions[key]?.value;
  }

  isDeclared(key: string) {
    return key in this.definitions || key in this.user;
  }
  /** Stored, but registered by nothing: the original lists it as a custom setting */
  isCustom(key: string) {
    return key in this.user && !(key in this.definitions);
  }
  isOverridden(key: string) {
    return key in this.overrides;
  }
  /** The settings the server's settings file sets, which cannot be changed */
  overriddenKeys(): string[] {
    return Object.keys(this.overrides);
  }

  /** Whether users choose the look themselves in this browser (theme:enableUserControl) */
  userControl(): boolean {
    const value = this.isOverridden(USER_CONTROL)
      ? this.overrides[USER_CONTROL]
      : (this.user[USER_CONTROL] ?? this.defaultOf(USER_CONTROL));
    return value === true || value === 'true';
  }

  /** Kept in this browser rather than on the server, while users choose the look themselves */
  prefersBrowser(key: string) {
    return this.userControl() && this.definitions[key]?.preferBrowserSetting === true;
  }

  /** What is set and in effect: the server's override, this browser's value, or what is stored */
  userValue(key: string): unknown {
    if (this.isOverridden(key)) return this.overrides[key];
    if (this.prefersBrowser(key) && this.browser[key]?.userValue !== undefined) {
      return this.browser[key].userValue;
    }
    return this.user[key];
  }
  /** What the server stores for a setting, which the advanced settings page shows */
  storedValue(key: string): unknown {
    return this.user[key];
  }
  storedKeys(): string[] {
    return Object.keys(this.user);
  }
  isDefault(key: string) {
    const value = this.userValue(key);
    return value === undefined || value === null;
  }

  /** A setting's value, read as its type: a JSON setting comes back parsed */
  get<T = unknown>(key: string, fallback?: T): T {
    const definition = this.definitions[key];
    const set = this.userValue(key);
    const raw = set === undefined || set === null ? this.defaultOf(key) : set;
    if (raw === undefined || raw === null) return fallback as T;
    const type = settingType(definition, raw);
    if (type === 'json' && typeof raw === 'string') {
      try {
        return JSON.parse(raw) as T;
      } catch {
        try {
          return JSON.parse(String(definition?.value)) as T;
        } catch {
          return fallback as T;
        }
      }
    }
    if (type === 'number' && typeof raw === 'string') return Number.parseFloat(raw) as T;
    if (type === 'boolean' && typeof raw === 'string') return (raw === 'true') as T;
    if (type === 'array' && typeof raw === 'string') {
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
      if (!value.isOverridden && value.userValue !== undefined && value.userValue !== null) {
        user[key] = value.userValue;
      }
    }
    this.user = user;
    this.changed();
  }

  /**
   * `null` takes a setting back to its default. While users choose the look themselves, dark mode
   * and the theme version are kept in this browser and the server is not asked.
   */
  async setMany(changes: Record<string, unknown>) {
    const toServer: Record<string, unknown> = {};
    let local = false;
    for (const [key, value] of Object.entries(changes)) {
      this.assertUpdateAllowed(key);
      if (this.prefersBrowser(key)) {
        local = true;
        this.keepInBrowser(key, value);
      } else {
        toServer[key] = value;
      }
    }
    if (Object.keys(toServer).length > 0) {
      this.apply(
        await this.http.post<SettingsAnswer>('/api/opensearch-dashboards/settings', {
          body: { changes: toServer },
        })
      );
    } else if (local) {
      this.changed();
    }
  }

  /**
   * One setting, as the original's client sets one without a scope. A value that is already the
   * one held is not sent again, so a second click while the first is on its way asks the server
   * nothing.
   */
  set(key: string, value: unknown) {
    return this.update(key, value, 'default', true);
  }
  remove(key: string) {
    return this.set(key, null);
  }

  /**
   * One setting as the advanced settings page writes it: in the scope it is kept in, which the
   * original's page always names, so the value is sent even when it is the one held
   */
  save(key: string, value: unknown) {
    const lane = settingScopes(this.definitions[key]).includes('dashboard_admin') ? 'dashboard_admin' : 'global';
    return this.update(key, value, lane, false);
  }

  private assertUpdateAllowed(key: string) {
    if (this.isOverridden(key)) {
      throw new Error(`Unable to update "${key}" because its value is overridden by the OpenSearch Dashboards server`);
    }
  }

  /**
   * As the original's client `update`: the value is held here at once, for the page to show, then
   * sent; when the server refuses it, the value held before is put back and the error given
   */
  private async update(key: string, value: unknown, lane: Lane, skipUnchanged: boolean) {
    this.assertUpdateAllowed(key);
    if (skipUnchanged && this.userValue(key) === value) return;
    if (this.prefersBrowser(key)) {
      this.keepInBrowser(key, value);
      this.changed();
      return;
    }
    const had = Object.hasOwn(this.user, key);
    const before = this.user[key];
    this.hold(key, value);
    try {
      this.apply(await this.batchSet(lane, key, value));
    } catch (error) {
      const user = { ...this.user };
      if (had) user[key] = before;
      else delete user[key];
      this.user = user;
      this.changed();
      throw error;
    }
  }

  /**
   * As the original's `batchSet`: a change is sent at once when nothing of its queue is on its
   * way; else it waits, and the changes that waited go together when the request is answered
   */
  private batchSet(name: Lane, key: string, value: unknown): Promise<SettingsAnswer> {
    const lane = this.lanes.get(name) ?? { sending: false };
    this.lanes.set(name, lane);
    return new Promise<SettingsAnswer>((resolve, reject) => {
      const batch = lane.pending ?? { values: {}, waiting: [] };
      batch.values = { ...batch.values, [key]: value };
      batch.waiting.push({ resolve, reject });
      lane.pending = batch;
      void this.flush(lane);
    });
  }

  private async flush(lane: { pending?: Batch; sending: boolean }) {
    const batch = lane.pending;
    if (!batch || lane.sending) return;
    lane.pending = undefined;
    lane.sending = true;
    try {
      const answer = await this.http.post<SettingsAnswer>('/api/opensearch-dashboards/settings', {
        body: { changes: batch.values },
      });
      for (const waiting of batch.waiting) waiting.resolve(answer);
    } catch (error) {
      for (const waiting of batch.waiting) waiting.reject(error);
    } finally {
      lane.sending = false;
      void this.flush(lane);
    }
  }

  /** Dark mode and the theme version, while users choose the look themselves */
  private keepInBrowser(key: string, value: unknown) {
    const values = { ...readBrowserValues() };
    if (value === null || value === undefined) delete values[key];
    else values[key] = { userValue: value };
    writeBrowserValues(values);
    this.browser = values;
  }

  /** A value held before the server has it, as the original's `setLocally`: JSON as its text */
  private hold(key: string, value: unknown) {
    const user = { ...this.user };
    if (value === null || value === undefined) delete user[key];
    else if (this.definitions[key]?.type === 'json' && typeof value !== 'string') user[key] = JSON.stringify(value);
    else user[key] = value;
    this.user = user;
    this.changed();
  }
  async refresh() {
    this.apply(await this.http.get<SettingsAnswer>('/api/opensearch-dashboards/settings'));
  }
}

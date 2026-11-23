/* SPDX-License-Identifier: Apache-2.0 */

/*
 * What the console keeps in the browser, under the names OpenSearch Dashboards gives it: "sense:"
 * and a key, the value as JSON. A browser that used the one finds its text, its history and its
 * settings in the other.
 */

import { DEFAULT_TEXT, type PastRequest } from './console_model';

/** The part of the browser's storage the console uses */
export interface KeyValueStore {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
  keys: () => string[];
}

/** The browser's local storage; a browser that keeps nothing still has a console */
export function browserStore(): KeyValueStore {
  const storage = (): Storage | undefined => {
    try {
      return window.localStorage;
    } catch {
      return undefined;
    }
  };
  return {
    getItem: (key) => {
      try {
        return storage()?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    setItem: (key, value) => {
      try {
        storage()?.setItem(key, value);
      } catch {
        // nothing kept
      }
    },
    removeItem: (key) => {
      try {
        storage()?.removeItem(key);
      } catch {
        // nothing to remove
      }
    },
    keys: () => {
      try {
        const local = storage();
        return local ? Object.keys(local) : [];
      } catch {
        return [];
      }
    },
  };
}

export interface TextObject {
  id: string;
  createdAt: number;
  updatedAt: number;
  text: string;
}

export interface ConsoleSettings {
  fontSize: number;
  wrapMode: boolean;
  tripleQuotes: boolean;
  autocomplete: { fields: boolean; indices: boolean; templates: boolean };
  polling: boolean;
}

/**
 * What the console asks OpenSearch for the names it suggests, by the settings: the mappings for
 * fields, the aliases for indices and aliases, the legacy templates for templates.
 */
export function autocompleteRequests(autocomplete: ConsoleSettings['autocomplete']): Array<{ name: 'fields' | 'indices' | 'templates'; path: string }> {
  return [
    { name: 'fields' as const, path: '_mapping' },
    { name: 'indices' as const, path: '_aliases' },
    { name: 'templates' as const, path: '_template' },
  ].filter((request) => autocomplete[request.name]);
}

const PREFIX = 'sense:';
/** The text objects of OpenSearch Dashboards: "console_local_" and the type, then the id */
const TEXT_PREFIX = 'console_local_text-object';
/** What an earlier build of this product wrote the text under */
const EARLIER_TEXT_PREFIX = 'console_local_text_';
export const WELCOME_SHOWN = '@@SENSE_REVISION';
export const MAX_HISTORY = 500;

export function newId(): string {
  const random = () => Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, '0');
  return `${random()}-${random().slice(0, 4)}-4${random().slice(0, 3)}-a${random().slice(0, 3)}-${random()}${random().slice(0, 4)}`;
}

export function consoleStorage(store: KeyValueStore = browserStore()) {
  const get = <T>(key: string, fallback: T): T => {
    const raw = store.getItem(PREFIX + key);
    if (raw === null) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  };
  const set = (key: string, value: unknown) => store.setItem(PREFIX + key, JSON.stringify(value));
  const remove = (key: string) => store.removeItem(PREFIX + key);
  const keys = () =>
    store
      .keys()
      .filter((key) => key.startsWith(PREFIX))
      .map((key) => key.slice(PREFIX.length));

  const historyKeys = () =>
    keys()
      .filter((key) => key.indexOf('hist_elem') === 0)
      .sort()
      .reverse();

  let lastHistoryTime = 0;

  const saveText = (object: TextObject) => set(`${TEXT_PREFIX}_${object.id}`, object);

  return {
    get,
    set,
    remove,

    /**
     * The text of the editor: the first text object made, as the original takes it. The text
     * of a console older than text objects ("editor_state") becomes one, as it does there.
     */
    loadText(now = Date.now()): TextObject {
      const legacy = get<{ content?: unknown } | undefined>('editor_state', undefined);
      if (legacy && typeof legacy.content === 'string') {
        saveText({ id: newId(), createdAt: now, updatedAt: now, text: legacy.content });
        remove('editor_state');
      }
      for (const key of keys().filter((name) => name.startsWith(EARLIER_TEXT_PREFIX))) {
        const earlier = get<TextObject | undefined>(key, undefined);
        if (earlier && typeof earlier.text === 'string' && typeof earlier.id === 'string') saveText(earlier);
        remove(key);
      }
      const all = keys()
        .filter((key) => key.includes(TEXT_PREFIX))
        .map((key) => get<TextObject | undefined>(key, undefined))
        .filter((object): object is TextObject => typeof object?.text === 'string')
        .sort((a, b) => a.createdAt - b.createdAt);
      if (all[0]) return all[0];
      const fresh: TextObject = { id: newId(), createdAt: now, updatedAt: now, text: DEFAULT_TEXT };
      saveText(fresh);
      return fresh;
    },
    saveText,

    loadSettings(): ConsoleSettings {
      return {
        fontSize: Number(get<number | string>('font_size', 14)) || 14,
        wrapMode: get<boolean>('wrap_mode', true),
        tripleQuotes: get<boolean>('triple_quotes', true),
        autocomplete: { fields: true, indices: true, templates: true, ...get('autocomplete_settings', {}) },
        polling: get<boolean>('console_polling', true),
      };
    },
    saveSettings(settings: ConsoleSettings) {
      set('font_size', settings.fontSize);
      set('wrap_mode', settings.wrapMode);
      set('triple_quotes', settings.tripleQuotes);
      set('autocomplete_settings', { ...get('autocomplete_settings', {}), ...settings.autocomplete });
      set('console_polling', settings.polling);
    },

    /** The requests sent, the latest first */
    history(): PastRequest[] {
      return historyKeys()
        .map((key) => get<PastRequest | undefined>(key, undefined))
        .filter((request): request is PastRequest => Boolean(request?.endpoint));
    },
    /** A request sent: kept with the 500 before it, older ones forgotten */
    addToHistory(endpoint: string, method: string, data: string, now = Date.now()) {
      for (const key of historyKeys().slice(MAX_HISTORY)) remove(key);
      lastHistoryTime = Math.max(now, lastHistoryTime + 1);
      set(`hist_elem_${lastHistoryTime}`, { time: lastHistoryTime, endpoint, method, data });
    },
    clearHistory() {
      for (const key of historyKeys()) remove(key);
    },

    welcomeShown: () => get<string>('version_welcome_shown', '') === WELCOME_SHOWN,
    setWelcomeShown: () => set('version_welcome_shown', WELCOME_SHOWN),

    widths(): [number, number] {
      const widths = get<unknown>('widths', [50, 50]);
      const [left, right] = Array.isArray(widths) ? widths.map(Number) : [50, 50];
      return [Number.isFinite(left) ? left : 50, Number.isFinite(right) ? right : 50];
    },
    setWidths: (widths: [number, number]) => set('widths', widths),
  };
}

export type ConsoleStorage = ReturnType<typeof consoleStorage>;

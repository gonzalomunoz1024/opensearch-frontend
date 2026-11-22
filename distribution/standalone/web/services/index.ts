/* SPDX-License-Identifier: Apache-2.0 */

/* What every page uses: made once when the page loads, from what the server put in it. */

import type { MapConfig } from '../../common/map_config';
import { DEFAULT_FORMAT_SETTINGS, type FormatSettings } from '../lib/field_formats';
import type { QueryConfig } from '../lib/query';
import type { FieldFormatSpec } from '../lib/types';
import { Http } from './http';
import { IndexPatterns } from './index_patterns';
import { SavedObjectsClient } from './saved_objects';
import { SavedQueryService } from './saved_queries';
import { SearchService } from './search';
import { Toasts } from './toasts';
import { UiSettingsClient } from './ui_settings';

export interface BootData {
  basePath: string;
  version: string;
  name: string;
  settings: Record<string, unknown>;
  settingsDefaults: Record<string, unknown>;
  settingsOverrides: Record<string, unknown>;
  map: MapConfig;
  /** vis_type_vega.enableExternalUrls of the server's settings */
  visTypeVega?: { enableExternalUrls: boolean };
  /** Where the browser builds of Vega and Vega-Lite are, loaded when a Vega visualization is drawn */
  libraries: { vega: string; vegaLite: string };
}

export interface Services {
  boot: BootData;
  http: Http;
  uiSettings: UiSettingsClient;
  savedObjects: SavedObjectsClient;
  savedQueries: SavedQueryService;
  indexPatterns: IndexPatterns;
  search: SearchService;
  toasts: Toasts;
  /** The formats of values, as the settings say: rebuilt when a setting changes */
  formatSettings(): FormatSettings;
  queryConfig(): QueryConfig;
  /** The time zone dates are shown in; undefined for the browser's own */
  timeZone(): string | undefined;
  /** 0 for Sunday to 6 for Saturday: the setting dateFormat:dow */
  weekStart(): number;
}

export let services: Services;

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function createServices(boot: BootData): Services {
  const http = new Http(boot.basePath);
  const uiSettings = new UiSettingsClient(
    http,
    boot.settings,
    boot.settingsDefaults ?? {},
    boot.settingsOverrides ?? {}
  );
  const savedObjects = new SavedObjectsClient(http);
  const indexPatterns = new IndexPatterns(http, savedObjects, uiSettings);
  const toasts = new Toasts();
  const search = new SearchService(http, () => ({
    maxConcurrentShardRequests: uiSettings.get<number>('courier:maxConcurrentShardRequests', 0),
  }));

  const timeZone = () => {
    const zone = uiSettings.get<string>('dateFormat:tz', 'Browser');
    return zone && zone !== 'Browser' ? zone : undefined;
  };

  let formats: { version: number; value: FormatSettings } | undefined;
  const formatSettings = () => {
    if (!formats || formats.version !== uiSettings.getVersion()) {
      formats = {
        version: uiSettings.getVersion(),
        value: {
          dateFormat: uiSettings.get('dateFormat', DEFAULT_FORMAT_SETTINGS.dateFormat),
          timeZone: timeZone(),
          numberPattern: uiSettings.get('format:number:defaultPattern', DEFAULT_FORMAT_SETTINGS.numberPattern),
          bytesPattern: uiSettings.get('format:bytes:defaultPattern', DEFAULT_FORMAT_SETTINGS.bytesPattern),
          percentPattern: uiSettings.get(
            'format:percent:defaultPattern',
            DEFAULT_FORMAT_SETTINGS.percentPattern
          ),
          defaultTypeMap: uiSettings.get<Record<string, FieldFormatSpec>>(
            'format:defaultTypeMap',
            DEFAULT_FORMAT_SETTINGS.defaultTypeMap
          ),
        },
      };
    }
    return formats.value;
  };

  const applyLifetimes = () => {
    toasts.lifetimes = {
      healthy: uiSettings.get('notifications:lifetime:info', 5000),
      info: uiSettings.get('notifications:lifetime:info', 5000),
      warning: uiSettings.get('notifications:lifetime:warning', 10000),
      critical: uiSettings.get('notifications:lifetime:error', 300000),
    };
  };
  applyLifetimes();
  uiSettings.subscribe(applyLifetimes);

  services = {
    boot,
    http,
    uiSettings,
    savedObjects,
    savedQueries: new SavedQueryService(savedObjects),
    indexPatterns,
    search,
    toasts,
    formatSettings,
    queryConfig: () => ({
      queryStringOptions: uiSettings.get<Record<string, unknown>>('query:queryString:options', {}),
      dateFormatTZ: timeZone(),
      ignoreFilterIfFieldNotInIndex: uiSettings.get('courier:ignoreFilterIfFieldNotInIndex', false),
      allowLeadingWildcards: uiSettings.get('query:allowLeadingWildcards', true),
    }),
    timeZone,
    weekStart: () => Math.max(0, DAYS.indexOf(uiSettings.get('dateFormat:dow', 'Sunday'))),
  };
  return services;
}

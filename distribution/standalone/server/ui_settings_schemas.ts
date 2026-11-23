/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The schemas OpenSearch Dashboards 3.9.0 registers its advanced settings with: core's
 * (src/core/server/ui_settings/settings/*) and those of the plugins whose settings the catalogue
 * lists, written with the look-alikes of config-schema in route_validation.ts. Its settings client
 * checks a value against them when it is written, and refuses it with 400 and config-schema's
 * message (`[validation [timepicker:quickRanges]]: expected value of type [array] but got
 * [Object]`); a stored value that does not pass is left out when the settings are read. A JSON
 * setting is checked as config-schema checks it: an object or a list given as text is read first.
 */

import { parse } from 'node:url';
import {
  arrayOf,
  literal,
  maybe,
  number,
  oneOf,
  SchemaTypeError,
  string,
  typeDetect,
  type Schema,
} from './route_validation';
import timezones from './ui_settings_timezones.json';

type Path = Parameters<Schema<unknown>['validate']>[1];

/**
 * `schema.boolean()` as Joi 18 reads text: trimmed, in any case, `true` or `false`. (The look-alike
 * of route_validation.ts does not trim.)
 */
function boolean(): Schema<boolean> {
  return {
    validate(input: unknown, path: Path) {
      let value = input;
      if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        value = normalized === 'true' ? true : normalized === 'false' ? false : value;
      }
      if (typeof value !== 'boolean') {
        throw new SchemaTypeError(`expected value of type [boolean] but got [${typeDetect(value)}]`, path);
      }
      return value;
    },
  };
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== 'object') return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === null || prototype === Object.prototype;
};

type Props = Record<string, Schema<unknown>>;
type ObjectOf<P extends Props> = { [K in keyof P]: P[K] extends Schema<infer T> ? T : never };

/**
 * `schema.object(props)`, which knows no other keys: text is read as JSON first, an absent object
 * is an empty one, the keys are checked in the order they are given and then the first unknown
 * one is refused. Joi checks a copy made with `Object.assign`, in which a `__proto__` key of the
 * value (which `JSON.parse` makes an own key) is not a key: it is neither read nor refused. (The
 * look-alike of route_validation.ts refuses it as unknown.)
 */
function object<P extends Props>(props: P): Schema<ObjectOf<P>> {
  return {
    validate(input: unknown, path: Path) {
      let value: unknown = input === undefined ? {} : input;
      if (typeof value === 'string') {
        try {
          value = JSON.parse(value) as unknown;
        } catch {
          throw new SchemaTypeError('could not parse object value from json input', path);
        }
      }
      if (!isPlainObject(value)) {
        throw new SchemaTypeError(
          `expected a plain object value, but found [${typeDetect(value)}] instead.`,
          path
        );
      }
      const keys = Object.keys(value).filter((key) => key !== '__proto__');
      const result: Record<string, unknown> = {};
      for (const [key, type] of Object.entries(props)) {
        const checked = type.validate(Object.hasOwn(value, key) ? value[key] : undefined, [...path, key]);
        if (checked !== undefined) result[key] = checked;
      }
      for (const key of keys) {
        if (!Object.hasOwn(props, key)) {
          throw new SchemaTypeError('definition for this key is missing', [...path, key]);
        }
      }
      return result as ObjectOf<P>;
    },
  };
}

/** `schema.literal(null)` */
const nullLiteral: Schema<null> = {
  validate(value, path) {
    if (value !== null) throw new SchemaTypeError('expected value to equal [null]', path);
    return null;
  },
};

/** `schema.nullable(type)`: the type, or `null` */
const nullable = <T>(type: Schema<T>): Schema<T | null> =>
  oneOf<T | null>([type, nullLiteral], { defaultValue: null });

/**
 * `schema.string({ validate })`. In config-schema the check takes the place of the type check (the
 * two are rules of the same name), so it is given whatever value comes, and a check that throws on
 * one that is not text (`value.startsWith is not a function`) gives its error as the message.
 */
function checkedString(check: (value: unknown) => string | undefined): Schema<string> {
  return {
    validate(value: unknown, path: Path) {
      if (value === undefined) {
        throw new SchemaTypeError('expected value of type [string] but got [undefined]', path);
      }
      let problem: string | undefined;
      try {
        problem = check(value);
      } catch (error) {
        problem = error instanceof Error ? error.message : String(error);
      }
      if (typeof problem === 'string') throw new SchemaTypeError(problem, path);
      return value as string;
    },
  };
}

/**
 * `isRelativeUrl` of `@osd/std`: no protocol, host or port as Node's legacy URL parser reads them
 * (the parser the original asks, so that `/\evil` and `//host` are refused as they are there)
 */
function isRelativeUrl(candidate: string): boolean {
  const all = parse(candidate, false, true);
  return all.protocol === null && all.hostname === null && all.port === null;
}

// moment's weekdays in English, the original's options for the first day of the week
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const TIMEZONES = new Set<unknown>(timezones);

// i18n puts a value into its message as text, and `false` as nothing
const asText = (value: unknown) => (value === false ? '' : String(value));

const notificationLifetime = () => oneOf<number | string>([number({ min: 0 }), literal('Infinity')]);
const formatEntry = () => object({ id: string(), params: object({}) });
const pplLintRule = () =>
  object({
    id: string(),
    enabled: boolean(),
    severity: maybe(oneOf<string>([literal('error'), literal('warning'), literal('info')])),
  });

/** Every setting with the schema it is registered with, by its key */
export const SETTING_SCHEMAS: Readonly<Record<string, Schema<unknown>>> = {
  // core: accessibility, date formats, misc, navigation, notifications, theme, state, AI features
  'accessibility:disableAnimations': boolean(),
  dateFormat: string(),
  'dateFormat:tz': checkedString((value) =>
    TIMEZONES.has(value) ? undefined : `Invalid timezone: ${asText(value)}`
  ),
  'dateFormat:scaled': string(),
  'dateFormat:dow': checkedString((value) =>
    WEEKDAYS.includes(value as string) ? undefined : `Invalid day of week: ${asText(value)}`
  ),
  dateNanosFormat: string(),
  'truncate:maxHeight': number({ min: 0 }),
  buildNum: maybe(number()),
  defaultRoute: checkedString((value) => {
    // What the original's check throws when it calls `value.startsWith` on what is not text
    if (typeof value !== 'string') return 'value.startsWith is not a function';
    if (!value.startsWith('/') || !isRelativeUrl(value)) return 'Must be a relative URL.';
    return undefined;
  }),
  pageNavigation: oneOf<string>([literal('modern'), literal('legacy')]),
  'notifications:banner': string(),
  'notifications:lifetime:banner': notificationLifetime(),
  'notifications:lifetime:error': notificationLifetime(),
  'notifications:lifetime:warning': notificationLifetime(),
  'notifications:lifetime:info': notificationLifetime(),
  'theme:enableUserControl': boolean(),
  'theme:darkMode': boolean(),
  'theme:version': oneOf<string>(
    ['v7', 'v8', 'v9', 'atlas', 'Next (preview)'].map((value) => literal(value))
  ),
  'state:storeInSessionStorage': boolean(),
  enableAIFeatures: boolean(),

  // data
  metaFields: arrayOf(string()),
  'doc_table:highlight': boolean(),
  'query:queryString:options': object({ analyze_wildcard: boolean() }),
  'query:allowLeadingWildcards': boolean(),
  'search:queryLanguage': string(),
  'sort:options': object({ unmapped_type: string() }),
  defaultIndex: nullable(string()),
  'courier:ignoreFilterIfFieldNotInIndex': boolean(),
  'courier:setRequestPreference': string(),
  'courier:customRequestPreference': string(),
  'courier:maxConcurrentShardRequests': number(),
  'courier:batchSearches': boolean(),
  'search:includeFrozen': boolean(),
  'histogram:barTarget': number(),
  'histogram:maxBars': number(),
  'history:limit': number(),
  'shortDots:enable': boolean(),
  'format:defaultTypeMap': object({
    ip: formatEntry(),
    date: formatEntry(),
    date_nanos: object({ id: string(), params: object({}), opensearch: boolean() }),
    number: formatEntry(),
    boolean: formatEntry(),
    _source: formatEntry(),
    _default_: formatEntry(),
  }),
  'format:number:defaultPattern': string(),
  'format:percent:defaultPattern': string(),
  'format:bytes:defaultPattern': string(),
  'format:currency:defaultPattern': string(),
  'format:number:defaultLocale': string(),
  'data:withLongNumerals': boolean(),
  'timepicker:refreshIntervalDefaults': object({ pause: boolean(), value: number() }),
  'timepicker:timeDefaults': object({ from: string(), to: string() }),
  'timepicker:quickRanges': arrayOf(object({ from: string(), to: string(), display: string() })),
  'indexPattern:placeholder': string(),
  'filters:pinnedByDefault': boolean(),
  'filterEditor:suggestValues': boolean(),
  'query:enhancements:enabled': boolean(),
  'query:enhancements:runtimePplGrammar': boolean(),
  'query:enhancements:suggestValues': boolean(),
  'query:enhancements:suggestValuesLimit': number(),
  'query:dataframe:hydrationStrategy': string(),
  'search:queryLanguageBlocklist': arrayOf(string()),
  'search:includeAllFields': boolean(),
  'search:maxRecentDatasets': number(),

  // discover
  defaultColumns: arrayOf(string()),
  'discover:sampleSize': number(),
  'discover:aggregationSampleSize': number(),
  'discover:aggs:terms:size': number(),
  'discover:sort:defaultOrder': oneOf<string>([literal('desc'), literal('asc')]),
  'discover:searchOnPageLoad': boolean(),
  'doc_table:hideTimeColumn': boolean(),
  'fields:popularLimit': number(),
  'context:defaultSize': number(),
  'context:step': number(),
  'context:tieBreakerFields': arrayOf(string()),
  'discover:modifyColumnsOnSwitch': boolean(),

  // share
  'csv:separator': string(),
  'csv:quoteValues': boolean(),

  // home
  'home:useNewHomePage': boolean(),
  'searchWorkspace:dismissGetStarted': boolean(),

  // visualizations, charts, vislib, augmenter, maps, region maps, TSVB, VisBuilder
  'visualize:enableLabs': boolean(),
  'visualize:disableBucketAgg': arrayOf(string()),
  'visualization:colorMapping': string(),
  'visualization:dimmingOpacity': number(),
  'visualization:heatmap:maxBuckets': number(),
  'visualization:enablePluginAugmentation': boolean(),
  'visualization:enablePluginAugmentation.maxPluginObjects': number({ min: 0 }),
  'visualization:tileMap:maxPrecision': number(),
  'visualization:tileMap:WMSdefaults': object({
    enabled: boolean(),
    url: string(),
    options: object({
      version: string(),
      layers: string(),
      format: string(),
      transparent: boolean(),
      attribution: string(),
      styles: string(),
    }),
  }),
  'visualization:regionmap:showWarnings': boolean(),
  'visualization:regionmap:customVectorMapMaxSize': number(),
  'metrics:max_buckets': number(),
  'visbuilder:enableVega': boolean(),

  // saved objects
  'savedObjects:perPage': number(),
  'savedObjects:listingLimit': number(),

  // timeline
  'timeline:es.timefield': string(),
  'timeline:es.default_index': string(),
  'timeline:target_buckets': number(),
  'timeline:max_buckets': number(),
  'timeline:min_interval': string(),
  'timeline:graphite.url': nullable(string()),
  'timeline:quandl.key': string(),

  // query enhancements: the rules as an object, or as the list they were before `mode` existed
  'query:enhancements:pplLint:rules': oneOf<unknown>([
    object({
      mode: oneOf<string>([literal('fast'), literal('thorough')], { defaultValue: 'fast' }),
      rules: arrayOf(pplLintRule()),
    }),
    arrayOf(pplLintRule()),
  ]),
};

/** A value the schema of its setting refuses, with the message config-schema gives */
export class SettingValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Checks a value as the original's settings client does before it writes it or after it reads
 * it: `null` (back to the default) and a setting registered by nothing are not checked.
 */
export function validateSetting(key: string, value: unknown): void {
  if (value === null || !Object.hasOwn(SETTING_SCHEMAS, key)) return;
  const namespace = `validation [${key}]`;
  try {
    SETTING_SCHEMAS[key].validate(value, []);
  } catch (error) {
    if (error instanceof SchemaTypeError) {
      throw new SettingValidationError(`[${[namespace, ...error.path].join('.')}]: ${error.message}`);
    }
    throw error;
  }
}

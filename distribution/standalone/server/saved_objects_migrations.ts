/* SPDX-License-Identifier: Apache-2.0 */

/*
 * What the document migrator of OpenSearch Dashboards 3.9.0 does to an object it writes (a create,
 * a bulk create, an import): an object without `migrationVersion` is marked as written by this
 * release; one with it is run through each migration of its type above the version it names, in
 * order, and one that names a version newer than the release's is refused.
 *
 * The migrations are those of the original's types, step for step, on the same JSON:
 * `src/core/server/saved_objects/migrations/core/document_migrator.ts` and the `*_migrations.ts`
 * of the index pattern, visualization, saved search, dashboard, advanced settings and TSVB
 * telemetry types. They read old objects the way that code reads them, with its JavaScript: a
 * value that is not what a step expects fails that step where the original's fails, and a step
 * the original guards keeps the object as it was. One fault is not copied: in the original the
 * 7.3.0 move of TSVB's moving averages throws while it logs a failure (it is not handed the
 * logger), which turns an object it means to leave alone into a failed import; here it is left
 * alone.
 */

import { randomUUID } from 'node:crypto';
import type { SavedObject } from '../common/saved_objects';
import { HttpError } from './http';
import { silentLogger, type Logger } from './logger';

export interface MigrationDocument {
  /** Undefined for a create that has the id made when the object is written, as in the original */
  id?: string;
  type: string;
  attributes: Record<string, unknown>;
  references?: SavedObject['references'];
  migrationVersion?: Record<string, string>;
  [key: string]: unknown;
}

type Bag = Record<string, unknown>;

/** What a step is handed beside the object; only the first step of a version gets it */
export interface MigrationContext {
  log: {
    info(message: string): void;
    debug(message: string): void;
    warn(message: string): void;
    warning(message: string): void;
    error(message: string): void;
  };
}

export type MigrationStep = (doc: Bag, context?: MigrationContext) => Bag;

// --- JavaScript, as the original's steps run it ---------------------------------------------

const describe = (value: unknown) => (value === null ? 'null' : 'undefined');

/** `value[key]`: null and undefined have no properties */
function read(value: unknown, key: string | number): unknown {
  if (value === null || value === undefined) {
    throw new TypeError(`Cannot read properties of ${describe(value)} (reading '${key}')`);
  }
  return (value as Bag)[key];
}

/** `target[key] = value` in strict mode: a string, a number or a boolean takes no property */
function write(target: unknown, key: string, value: unknown): void {
  if (target === null || target === undefined) {
    throw new TypeError(`Cannot set properties of ${describe(target)} (setting '${key}')`);
  }
  if (typeof target !== 'object' && typeof target !== 'function') {
    throw new TypeError(`Cannot create property '${key}' on ${typeof target} '${String(target)}'`);
  }
  (target as Bag)[key] = value;
}

/** `delete target[key]` in strict mode */
function remove(target: unknown, key: string): void {
  if (target === null || target === undefined) throw new TypeError('Cannot convert undefined or null to object');
  if (typeof target === 'object') delete (target as Bag)[key];
}

/** `value.forEach(fn)`: of what JSON gives, only an array has it */
function each(value: unknown, fn: (item: unknown, index: number) => void): void {
  if (!Array.isArray(value)) {
    read(value, 'forEach');
    throw new TypeError('value.forEach is not a function');
  }
  value.forEach(fn);
}

/** `value.map(fn)` */
function map(value: unknown, fn: (item: unknown, index: number) => unknown): unknown[] {
  if (!Array.isArray(value)) {
    read(value, 'map');
    throw new TypeError('value.map is not a function');
  }
  return value.map(fn);
}

/** `list.push(item)` */
function push(list: unknown, item: unknown): void {
  if (!Array.isArray(list)) {
    read(list, 'push');
    throw new TypeError('list.push is not a function');
  }
  list.push(item);
}

/** `key in value` */
function hasIn(value: unknown, key: string): boolean {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
    throw new TypeError(`Cannot use 'in' operator to search for '${key}' in ${String(value)}`);
  }
  return key in value;
}

/** `JSON.parse`, which reads anything as text first */
const parse = (text: unknown): unknown => JSON.parse(text as string);

/** lodash's `get` with a dotted path; a key that is the whole path wins, as there */
function get(value: unknown, path: string, fallback?: unknown): unknown {
  if (value === null || value === undefined) return fallback;
  let current: unknown;
  if (path in Object(value)) {
    current = (value as Bag)[path];
  } else {
    current = value;
    for (const key of path.split('.')) {
      if (current === null || current === undefined) return fallback;
      current = (current as Bag)[key];
    }
  }
  return current === undefined ? fallback : current;
}

/** lodash's `has` for one key: an own property */
const has = (value: unknown, key: string) => value !== null && value !== undefined && Object.prototype.hasOwnProperty.call(value, key);

/** lodash's `omit` of one key: the enumerable keys of anything, as a new object */
function omit(value: unknown, key: string): Bag {
  const copy: Bag = {};
  if (value === null || value === undefined) return copy;
  // The inherited enumerable keys are copied too, as lodash does
  for (const name in Object(value)) {
    if (name !== key) copy[name] = (Object(value) as Bag)[name];
  }
  return copy;
}

/** `{ ...value }` */
const spread = (value: unknown): Bag => ({ ...(value as Bag) });

/** lodash's `flow`: the first step gets the context, each one after it only the object */
const flow =
  (...steps: MigrationStep[]): MigrationStep =>
  (doc, context) =>
    steps.reduce((current, step, index) => (index === 0 ? step(current, context) : step(current)), doc);

const withVisState = (doc: Bag, visState: unknown): Bag => ({
  ...doc,
  attributes: { ...spread(doc.attributes), visState: JSON.stringify(visState) },
});

/** The parsed `visState`, or undefined where the original lets bad JSON go */
function readVisState(text: unknown): unknown {
  try {
    return parse(text);
  } catch {
    return undefined;
  }
}

// --- semver, as the original's migrator and dashboard panels use it ---------------------------

interface Version {
  major: number;
  minor: number;
  patch: number;
  prerelease: Array<string | number>;
}

const NUMBER = '0|[1-9]\\d{0,16}';
const IDENTIFIER = `(?:${NUMBER}|\\d{0,16}[a-zA-Z-][a-zA-Z0-9-]{0,250})`;
const FULL = new RegExp(
  `^v?(${NUMBER})\\.(${NUMBER})\\.(${NUMBER})(?:-(${IDENTIFIER}(?:\\.${IDENTIFIER})*))?(?:\\+([a-zA-Z0-9-]{1,250}(?:\\.[a-zA-Z0-9-]{1,250})*))?$`
);
const COERCE = /(^|[^\d])(\d{1,16})(?:\.(\d{1,16}))?(?:\.(\d{1,16}))?(?:$|[^\d])/;

/** `new SemVer(version)` of semver 7.5.3 */
function semver(version: unknown): Version {
  if (typeof version !== 'string') {
    throw new TypeError(`Invalid version. Must be a string. Got type "${typeof version}".`);
  }
  if (version.length > 256) throw new TypeError('version is longer than 256 characters');
  const match = FULL.exec(version.trim());
  if (!match) throw new TypeError(`Invalid Version: ${version}`);
  const [major, minor, patch] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (major > Number.MAX_SAFE_INTEGER) throw new TypeError('Invalid major version');
  if (minor > Number.MAX_SAFE_INTEGER) throw new TypeError('Invalid minor version');
  if (patch > Number.MAX_SAFE_INTEGER) throw new TypeError('Invalid patch version');
  const prerelease = match[4]
    ? match[4].split('.').map((id) => {
        if (/^[0-9]+$/.test(id)) {
          const num = Number(id);
          if (num >= 0 && num < Number.MAX_SAFE_INTEGER) return num;
        }
        return id;
      })
    : [];
  return { major, minor, patch, prerelease };
}

/** semver's `compareIdentifiers`: digits compare as numbers, and before anything else */
function compareIdentifiers(a: string | number, b: string | number): number {
  const anum = /^[0-9]+$/.test(String(a));
  const bnum = /^[0-9]+$/.test(String(b));
  const x = anum && bnum ? Number(a) : a;
  const y = anum && bnum ? Number(b) : b;
  if (x === y) return 0;
  if (anum && !bnum) return -1;
  if (bnum && !anum) return 1;
  return x < y ? -1 : 1;
}

/** `semver.compare` */
function compare(a: unknown, b: unknown): number {
  const left = semver(a);
  const right = semver(b);
  for (const part of ['major', 'minor', 'patch'] as const) {
    if (left[part] !== right[part]) return left[part] < right[part] ? -1 : 1;
  }
  if (left.prerelease.length && !right.prerelease.length) return -1;
  if (!left.prerelease.length && right.prerelease.length) return 1;
  for (let at = 0; ; at += 1) {
    const x = left.prerelease[at];
    const y = right.prerelease[at];
    if (x === undefined && y === undefined) return 0;
    if (y === undefined) return 1;
    if (x === undefined) return -1;
    if (x !== y) return compareIdentifiers(x, y);
  }
}

/** `semver.gt` */
export const versionGreaterThan = (a: unknown, b: unknown) => compare(a, b) > 0;

/** `semver.satisfies(version, '<major>.<minor>.x')` */
function satisfiesMinor(version: unknown, major: number, minor: number): boolean {
  if (!version) return false;
  if (typeof version !== 'string') {
    // A range is tested against anything but text by comparing, which wants text
    throw new TypeError(`Invalid version. Must be a string. Got type "${typeof version}".`);
  }
  let parsed: Version;
  try {
    parsed = semver(version);
  } catch {
    return false;
  }
  return parsed.prerelease.length === 0 && parsed.major === major && parsed.minor === minor;
}

/** `semver.coerce(version).version`, which throws where coerce finds nothing */
function coercedVersion(version: unknown): Version {
  const text = typeof version === 'number' ? String(version) : version;
  const match = typeof text === 'string' ? COERCE.exec(text) : null;
  let coerced: Version | null = null;
  if (match) {
    try {
      coerced = semver(`${match[2]}.${match[3] || '0'}.${match[4] || '0'}`);
    } catch {
      coerced = null;
    }
  }
  if (!coerced) throw new TypeError("Cannot read properties of null (reading 'version')");
  return coerced;
}

const below = (version: Version, major: number, minor: number) =>
  version.major < major || (version.major === major && version.minor < minor);

// --- index-pattern ----------------------------------------------------------------------------

const migrateAttributeTypeAndAttributeTypeMeta: MigrationStep = (doc) => ({
  ...doc,
  attributes: {
    ...spread(doc.attributes),
    type: read(doc.attributes, 'type') || undefined,
    typeMeta: read(doc.attributes, 'typeMeta') || undefined,
  },
});

const migrateSubTypeAndParentFieldProperties: MigrationStep = (doc) => {
  const fieldsString = read(doc.attributes, 'fields');
  if (!fieldsString) return doc;
  // fields may already be an array if written directly to the index by external tooling
  const fields = Array.isArray(fieldsString) ? fieldsString : parse(fieldsString);
  const migratedFields = map(fields, (field) =>
    read(field, 'subType') === 'multi'
      ? { ...omit(field, 'parent'), subType: { multi: { parent: read(field, 'parent') } } }
      : field
  );
  return { ...doc, attributes: { ...spread(doc.attributes), fields: JSON.stringify(migratedFields) } };
};

export const INDEX_PATTERN_MIGRATIONS: Record<string, MigrationStep> = {
  '6.5.0': flow(migrateAttributeTypeAndAttributeTypeMeta),
  '7.6.0': flow(migrateSubTypeAndParentFieldProperties),
};

// --- shared by visualizations, searches and dashboards -----------------------------------------

/**
 * Objects of 5.x kept a `match_all` query, which 6.7.2 and 7.9.3 replace by an empty one. The
 * search source is all `kibanaSavedObjectMeta` keeps afterwards.
 */
const migrateMatchAllQuery: MigrationStep = (doc) => {
  const searchSourceJSON = get(doc, 'attributes.kibanaSavedObjectMeta.searchSourceJSON');
  if (searchSourceJSON) {
    let searchSource: unknown;
    try {
      searchSource = parse(searchSourceJSON);
    } catch {
      return doc;
    }
    const query = read(searchSource, 'query');
    if (query !== null && query !== undefined && read(query, 'match_all')) {
      return {
        ...doc,
        attributes: {
          ...spread(doc.attributes),
          kibanaSavedObjectMeta: {
            searchSourceJSON: JSON.stringify({ ...spread(searchSource), query: { query: '', language: 'kuery' } }),
          },
        },
      };
    }
  }
  return doc;
};

/** 7.0.0: the index pattern a search source names, and those of its filters, become references */
const migrateIndexPattern =
  (checkReferences: boolean): MigrationStep =>
  (doc) => {
    const searchSourceJSON = get(doc, 'attributes.kibanaSavedObjectMeta.searchSourceJSON');
    if (typeof searchSourceJSON !== 'string') return doc;
    let searchSource: unknown;
    try {
      searchSource = JSON.parse(searchSourceJSON);
    } catch {
      return doc;
    }
    const canAdd = () => !checkReferences || Array.isArray(doc.references);
    if (read(searchSource, 'index') && canAdd()) {
      write(searchSource, 'indexRefName', 'kibanaSavedObjectMeta.searchSourceJSON.index');
      push(doc.references, { name: read(searchSource, 'indexRefName'), type: 'index-pattern', id: read(searchSource, 'index') });
      remove(searchSource, 'index');
    }
    const filters = read(searchSource, 'filter');
    if (filters) {
      each(filters, (filterRow, i) => {
        const meta = read(filterRow, 'meta');
        if (!meta || !read(meta, 'index') || !canAdd()) return;
        write(meta, 'indexRefName', `kibanaSavedObjectMeta.searchSourceJSON.filter[${i}].meta.index`);
        push(doc.references, { name: read(meta, 'indexRefName'), type: 'index-pattern', id: read(meta, 'index') });
        remove(meta, 'index');
      });
    }
    write(read(read(doc, 'attributes'), 'kibanaSavedObjectMeta'), 'searchSourceJSON', JSON.stringify(searchSource));
    return doc;
  };

// --- visualization ----------------------------------------------------------------------------

/** TSVB's series and metrics, as `(part.metrics || []).forEach` walks them */
function eachMetric(visState: unknown, fn: (metric: unknown) => void) {
  each(get(visState, 'params.series') || [], (part) => each(read(part, 'metrics') || [], fn));
}

const isTsvb = (visState: unknown) => Boolean(visState) && read(visState, 'type') === 'metrics';

// [TSVB] percentile rank: value -> values
const migratePercentileRankAggregation: MigrationStep = (doc) => {
  const visStateJSON = get(doc, 'attributes.visState');
  if (visStateJSON) {
    const visState = readVisState(visStateJSON);
    if (isTsvb(visState)) {
      eachMetric(visState, (metric) => {
        if (read(metric, 'type') === 'percentile_rank' && has(metric, 'value')) {
          write(metric, 'values', [read(metric, 'value')]);
          remove(metric, 'value');
        }
      });
      return withVisState(doc, visState);
    }
  }
  return doc;
};

// [TSVB] a filter ratio's text queries become query objects
const migrateFilterRatioQuery: MigrationStep = (doc) => {
  const visStateJSON = get(doc, 'attributes.visState');
  if (visStateJSON) {
    const visState = readVisState(visStateJSON);
    if (isTsvb(visState)) {
      eachMetric(visState, (metric) => {
        if (read(metric, 'type') === 'filter_ratio') {
          for (const side of ['numerator', 'denominator']) {
            const value = read(metric, side);
            if (typeof value === 'string') write(metric, side, { query: value, language: 'lucene' });
          }
        }
      });
      return withVisState(doc, visState);
    }
  }
  return doc;
};

// [TSVB] the misspelled `opperator` of a gauge's colour rules goes
const migrateOperatorKeyTypo: MigrationStep = (doc) => {
  const visStateJSON = get(doc, 'attributes.visState');
  if (visStateJSON) {
    const visState = readVisState(visStateJSON);
    if (isTsvb(visState)) {
      each(get(visState, 'params.gauge_color_rules') || [], (colorRule) => {
        if (read(colorRule, 'opperator')) remove(colorRule, 'opperator');
      });
      return withVisState(doc, visState);
    }
  }
  return doc;
};

// Whether a split chart splits in rows moves from its terms aggregation to the visualization
const migrateSplitByChartRow: MigrationStep = (doc) => {
  const visStateJSON = get(doc, 'attributes.visState');
  if (visStateJSON) {
    const visState = readVisState(visStateJSON);
    if (visState && read(visState, 'aggs') && read(visState, 'params')) {
      let row: unknown;
      each(read(visState, 'aggs'), (agg) => {
        if (read(agg, 'type') === 'terms' && read(agg, 'schema') === 'split' && hasIn(read(agg, 'params'), 'row')) {
          row = read(read(agg, 'params'), 'row');
          remove(read(agg, 'params'), 'row');
        }
      });
      if (row !== undefined) write(read(visState, 'params'), 'row', row);
      return withVisState(doc, visState);
    }
  }
  return doc;
};

/** A date histogram, and one that is the bucket of a sibling pipeline: `fn(params)` for each */
function eachDateHistogram(agg: unknown, fn: (params: unknown) => void) {
  if (read(agg, 'type') === 'date_histogram' && read(agg, 'params')) fn(read(agg, 'params'));
  if (get(agg, 'params.customBucket.type', null) === 'date_histogram') {
    const bucketParams = read(read(read(agg, 'params'), 'customBucket'), 'params');
    if (bucketParams) fn(bucketParams);
  }
}

// A date histogram's custom interval becomes its interval
const migrateDateHistogramAggregation: MigrationStep = (doc) => {
  const visStateJSON = get(doc, 'attributes.visState');
  if (visStateJSON) {
    const visState = readVisState(visStateJSON);
    if (visState && read(visState, 'aggs')) {
      each(read(visState, 'aggs'), (agg) =>
        eachDateHistogram(agg, (params) => {
          if (read(params, 'interval') === 'custom') write(params, 'interval', read(params, 'customInterval'));
          remove(params, 'customInterval');
        })
      );
      return withVisState(doc, visState);
    }
  }
  return doc;
};

// A date histogram no longer keeps a time zone of its own
const removeDateHistogramTimeZones: MigrationStep = (doc) => {
  const visStateJSON = get(doc, 'attributes.visState');
  if (visStateJSON) {
    const visState = readVisState(visStateJSON);
    if (visState && read(visState, 'aggs')) {
      each(read(visState, 'aggs'), (agg) => eachDateHistogram(agg, (params) => remove(params, 'time_zone')));
      write(doc.attributes, 'visState', JSON.stringify(visState));
    }
  }
  return doc;
};

// A gauge's verticalSplit becomes its alignment
const migrateGaugeVerticalSplitToAlignment: MigrationStep = (doc, context) => {
  const visStateJSON = get(doc, 'attributes.visState');
  if (visStateJSON) {
    try {
      const visState = parse(visStateJSON);
      if (visState && read(visState, 'type') === 'gauge') {
        const gauge = read(read(visState, 'params'), 'gauge');
        if (!read(gauge, 'alignment')) {
          write(gauge, 'alignment', read(gauge, 'verticalSplit') ? 'vertical' : 'horizontal');
          remove(gauge, 'verticalSplit');
          return withVisState(doc, visState);
        }
      }
    } catch (error) {
      context?.log.warn(`Exception @ migrateGaugeVerticalSplitToAlignment! ${String(error)}`);
      context?.log.warn(`Exception @ migrateGaugeVerticalSplitToAlignment! Payload: ${String(visStateJSON)}`);
    }
  }
  return doc;
};

const TSVB_TYPES = ['metric', 'markdown', 'top_n', 'gauge', 'table', 'timeseries'];
const lucene = (query: unknown) => ({ query, language: 'lucene' });

// [TSVB] text filters (of the panel, its annotations, its series and their splits) become query objects
const transformFilterStringToQueryObject: MigrationStep = (doc) => {
  const newDoc = structuredClone(doc);
  const visStateJSON = get(doc, 'attributes.visState');
  if (visStateJSON) {
    const visState = readVisState(visStateJSON);
    if (visState) {
      if (!TSVB_TYPES.includes(get(visState, 'params.type') as string)) return doc;
      const params = get(visState, 'params');
      const filter = read(params, 'filter');
      if (filter && typeof filter === 'string') write(params, 'filter', lucene(filter));
      each(get(visState, 'params.annotations') || [], (item) => {
        const queryString = read(item, 'query_string');
        if (!queryString) return;
        if (typeof queryString === 'string') write(item, 'query_string', lucene(queryString));
      });
      each(get(visState, 'params.series') || [], (item) => {
        const itemFilter = read(item, 'filter');
        if (!itemFilter) return;
        if (typeof itemFilter === 'string') write(item, 'filter', lucene(itemFilter));
        if (read(item, 'split_filters')) {
          each(get(item, 'split_filters') || [], (split) => {
            const splitFilter = read(split, 'filter');
            if (!splitFilter) return;
            if (typeof splitFilter === 'string') write(split, 'filter', lucene(splitFilter));
          });
        }
      });
      write(newDoc.attributes, 'visState', JSON.stringify(visState));
    }
  }
  return newDoc;
};

// [TSVB] the split filters 7.3.0 left as text
const transformSplitFiltersStringToQueryObject: MigrationStep = (doc) => {
  const newDoc = structuredClone(doc);
  const visStateJSON = get(doc, 'attributes.visState');
  if (visStateJSON) {
    const visState = readVisState(visStateJSON);
    if (visState) {
      if (!TSVB_TYPES.includes(get(visState, 'params.type') as string)) return doc;
      each(get(visState, 'params.series') || [], (item) => {
        if (read(item, 'split_filters')) {
          const splitFilters = get(item, 'split_filters') || [];
          if ((read(splitFilters, 'length') as number) > 0) {
            each(splitFilters, (split) => {
              const splitFilter = read(split, 'filter');
              if (typeof splitFilter === 'string') write(split, 'filter', lucene(splitFilter));
            });
          }
        }
      });
      write(newDoc.attributes, 'visState', JSON.stringify(visState));
    }
  }
  return newDoc;
};

// The queries of a filters aggregation get a language: Lucene where they had none
const migrateFiltersAggQuery: MigrationStep = (doc) => {
  const visStateJSON = get(doc, 'attributes.visState');
  if (visStateJSON) {
    try {
      const visState = parse(visStateJSON);
      if (visState && read(visState, 'aggs')) {
        each(read(visState, 'aggs'), (agg) => {
          if (read(agg, 'type') !== 'filters') return;
          each(read(read(agg, 'params'), 'filters'), (filter) => {
            const input = read(filter, 'input');
            if (read(input, 'language')) return;
            write(input, 'language', 'lucene');
          });
        });
        return withVisState(doc, visState);
      }
    } catch {
      // Let it go, the data is invalid and we'll leave it as is
    }
  }
  return doc;
};

// [TSVB] a moving average becomes a moving function
const replaceMovAvgToMovFn: MigrationStep = (doc) => {
  const visStateJSON = get(doc, 'attributes.visState');
  if (visStateJSON) {
    try {
      const visState = parse(visStateJSON);
      if (isTsvb(visState)) {
        each(get(visState, 'params.series', []), (part) => {
          const metrics = read(part, 'metrics');
          if (metrics && Array.isArray(metrics)) {
            each(metrics, (metric) => {
              if (read(metric, 'type') === 'moving_average') {
                write(metric, 'model_type', read(metric, 'model'));
                write(metric, 'alpha', get(metric, 'settings.alpha', 0.3));
                write(metric, 'beta', get(metric, 'settings.beta', 0.1));
                write(metric, 'gamma', get(metric, 'settings.gamma', 0.3));
                write(metric, 'period', get(metric, 'settings.period', 1));
                write(metric, 'multiplicative', get(metric, 'settings.type') === 'mult');
                for (const key of ['minimize', 'model', 'settings', 'predict']) remove(metric, key);
              }
            });
          }
        });
        return withVisState(doc, visState);
      }
    } catch {
      // The original means to log this and keep the object, but throws for want of the logger,
      // which only the first step of a version is handed: here the object is kept
    }
  }
  return doc;
};

// A filters aggregation's query_string queries become their text
const migrateFiltersAggQueryStringQueries: MigrationStep = (doc) => {
  const visStateJSON = get(doc, 'attributes.visState');
  if (visStateJSON) {
    try {
      const visState = parse(visStateJSON);
      if (visState && read(visState, 'aggs')) {
        each(read(visState, 'aggs'), (agg) => {
          if (read(agg, 'type') !== 'filters') return;
          each(read(read(agg, 'params'), 'filters'), (filter) => {
            const input = read(filter, 'input');
            const queryString = read(read(input, 'query'), 'query_string');
            if (queryString) write(input, 'query', read(queryString, 'query'));
          });
        });
        return withVisState(doc, visState);
      }
    } catch {
      // Let it go, the data is invalid and we'll leave it as is
    }
  }
  return doc;
};

const addDocReferences: MigrationStep = (doc) => ({ ...doc, references: doc.references || [] });

// The saved search a visualization is built on becomes a reference
const migrateSavedSearch: MigrationStep = (doc) => {
  const savedSearchId = get(doc, 'attributes.savedSearchId');
  if (savedSearchId && doc.references) {
    push(doc.references, { type: 'search', name: 'search_0', id: savedSearchId });
    write(doc.attributes, 'savedSearchRefName', 'search_0');
  }
  remove(doc.attributes, 'savedSearchId');
  return doc;
};

// The index patterns of input controls become references
const migrateControls: MigrationStep = (doc) => {
  const visStateJSON = get(doc, 'attributes.visState');
  if (visStateJSON) {
    const visState = readVisState(visStateJSON);
    if (visState) {
      each(get(visState, 'params.controls') || [], (control, i) => {
        if (!read(control, 'indexPattern') || !doc.references) return;
        write(control, 'indexPatternRefName', `control_${i}_index_pattern`);
        push(doc.references, { name: read(control, 'indexPatternRefName'), type: 'index-pattern', id: read(control, 'indexPattern') });
        remove(control, 'indexPattern');
      });
      write(doc.attributes, 'visState', JSON.stringify(visState));
    }
  }
  return doc;
};

// A data table splits by one aggregation; the splits after the first become buckets
const migrateTableSplits: MigrationStep = (doc) => {
  try {
    const visState = parse(read(doc.attributes, 'visState'));
    if (get(visState, 'type') !== 'table') return doc;
    let splitCount = 0;
    write(
      visState,
      'aggs',
      map(read(visState, 'aggs'), (agg) => {
        if (read(agg, 'schema') !== 'split') return agg;
        splitCount += 1;
        if (splitCount === 1) return agg;
        write(agg, 'schema', 'bucket');
        // the `row` param is exclusively used by split aggs, so we remove it
        write(agg, 'params', omit(read(agg, 'params'), 'row'));
        return agg;
      })
    );
    if (splitCount <= 1) return doc;
    const newDoc = structuredClone(doc);
    write(newDoc.attributes, 'visState', JSON.stringify(visState));
    return newDoc;
  } catch (error) {
    throw new Error(`Failure attempting to migrate saved object '${String(get(doc, 'attributes.title'))}' - ${String(error)}`);
  }
};

// [TSVB] the default colour mode of a series was not saved; it changes, so the old one is written
const migrateTsvbDefaultColorPalettes: MigrationStep = (doc) => {
  const visStateJSON = get(doc, 'attributes.visState');
  if (visStateJSON) {
    const visState = readVisState(visStateJSON);
    if (isTsvb(visState)) {
      each(get(visState, 'params.series') || [], (part) => {
        if (!read(part, 'split_color_mode')) write(part, 'split_color_mode', 'gradient');
      });
      return withVisState(doc, visState);
    }
  }
  return doc;
};

// [TSVB] the search source, which TSVB does not use, is emptied
const removeTSVBSearchSource: MigrationStep = (doc) => {
  const visStateJSON = get(doc, 'attributes.visState');
  const searchSourceJSON = get(doc, 'attributes.kibanaSavedObjectMeta.searchSourceJSON');
  if (visStateJSON) {
    const visState = readVisState(visStateJSON);
    if (isTsvb(visState) && searchSourceJSON !== '{}') {
      return {
        ...doc,
        attributes: {
          ...spread(doc.attributes),
          kibanaSavedObjectMeta: { ...spread(get(doc, 'attributes.kibanaSavedObjectMeta')), searchSourceJSON: '{}' },
        },
      };
    }
  }
  return doc;
};

export const VISUALIZATION_MIGRATIONS: Record<string, MigrationStep> = {
  // Twice, as in the original: 6.7.2 for objects of 6.7, 7.0.1 for those of 7.0
  '6.7.2': flow(migrateMatchAllQuery, removeDateHistogramTimeZones),
  '7.0.0': flow(addDocReferences, migrateIndexPattern(true), migrateSavedSearch, migrateControls, migrateTableSplits),
  '7.0.1': flow(removeDateHistogramTimeZones),
  '7.2.0': flow(migratePercentileRankAggregation, migrateDateHistogramAggregation),
  '7.3.0': flow(
    migrateGaugeVerticalSplitToAlignment,
    transformFilterStringToQueryObject,
    migrateFiltersAggQuery,
    replaceMovAvgToMovFn
  ),
  '7.3.1': flow(migrateFiltersAggQueryStringQueries),
  '7.4.2': flow(transformSplitFiltersStringToQueryObject),
  '7.7.0': flow(migrateOperatorKeyTypo, migrateSplitByChartRow),
  '7.8.0': flow(migrateTsvbDefaultColorPalettes),
  '7.9.3': flow(migrateMatchAllQuery),
  '7.10.0': flow(migrateFilterRatioQuery, removeTSVBSearchSource),
};

// --- search -----------------------------------------------------------------------------------

const setNewReferences: MigrationStep = (doc, context) => {
  doc.references = doc.references || [];
  return migrateIndexPattern(true)(doc, context);
};

// A saved search's sort becomes a list of [field, direction] pairs
const migrateSearchSortToNestedArray: MigrationStep = (doc) => {
  const sort = get(doc, 'attributes.sort');
  if (!sort) return doc;
  if (Array.isArray(sort) && sort.length > 0 && Array.isArray(sort[0])) return doc;
  return { ...doc, attributes: { ...spread(doc.attributes), sort: [read(doc.attributes, 'sort')] } };
};

export const SEARCH_MIGRATIONS: Record<string, MigrationStep> = {
  '6.7.2': flow(migrateMatchAllQuery),
  '7.0.0': flow(setNewReferences),
  '7.4.0': flow(migrateSearchSortToNestedArray),
  '7.9.3': flow(migrateMatchAllQuery),
};

// --- dashboard --------------------------------------------------------------------------------

// 7.0.0: the index patterns of the search source and the objects of the panels become references
const migrations700: MigrationStep = (doc) => {
  doc.references = doc.references || [];
  migrateIndexPattern(false)(doc);
  const panelsJSON = get(doc, 'attributes.panelsJSON');
  if (typeof panelsJSON !== 'string') return doc;
  let panels: unknown;
  try {
    panels = JSON.parse(panelsJSON);
  } catch {
    return doc;
  }
  if (!Array.isArray(panels)) return doc;
  panels.forEach((panel: unknown, i: number) => {
    if (!read(panel, 'type') || !read(panel, 'id')) return;
    write(panel, 'panelRefName', `panel_${i}`);
    push(doc.references, { name: `panel_${i}`, type: read(panel, 'type'), id: read(panel, 'id') });
    remove(panel, 'type');
    remove(panel, 'id');
  });
  write(doc.attributes, 'panelsJSON', JSON.stringify(panels));
  return doc;
};

const PANEL_HEIGHT_SCALE_FACTOR = 5;
const PANEL_HEIGHT_SCALE_FACTOR_WITH_MARGINS = 4;
const PANEL_WIDTH_SCALE_FACTOR = 4;
// Snapshots of the dashboard's defaults when these migrations were written, as in the original
const DEFAULT_PANEL_WIDTH = 24;
const DEFAULT_PANEL_HEIGHT = 15;

const panelIndexOf = (panel: unknown) => {
  const panelIndex = read(panel, 'panelIndex');
  return panelIndex ? String(panelIndex) : randomUUID();
};

/** The panel's columns and sort, kept from 6.4 on in its embeddable's configuration */
function moveColumnsAndSort(panel: unknown, embeddableConfig: unknown) {
  if (read(panel, 'columns') || read(panel, 'sort')) {
    write(embeddableConfig, 'columns', read(panel, 'columns'));
    write(embeddableConfig, 'sort', read(panel, 'sort'));
  }
}

const uiStateOf = (uiState: unknown, panel: unknown) =>
  uiState ? read(uiState, `P-${String(read(panel, 'panelIndex'))}`) || {} : {};

function migratePre61Panel(panel: Bag, version: string, useMargins: unknown, uiState: unknown): Bag {
  if (panel.col === undefined || panel.row === undefined) {
    throw new Error(
      'Unable to migrate panel data for "6.1.0" backwards compatibility, panel does not contain expected col and/or row fields'
    );
  }
  const embeddableConfig = uiStateOf(uiState, panel);
  moveColumnsAndSort(panel, embeddableConfig);
  const heightScaleFactor = useMargins ? PANEL_HEIGHT_SCALE_FACTOR_WITH_MARGINS : PANEL_HEIGHT_SCALE_FACTOR;
  const { columns: _columns, sort: _sort, row, col, size_x: sizeX, size_y: sizeY, ...rest } = panel;
  const panelIndex = panelIndexOf(panel);
  return {
    ...rest,
    version,
    panelIndex,
    gridData: {
      x: (Number(col) - 1) * PANEL_WIDTH_SCALE_FACTOR,
      y: (Number(row) - 1) * heightScaleFactor,
      w: sizeX ? Number(sizeX) * PANEL_WIDTH_SCALE_FACTOR : DEFAULT_PANEL_WIDTH,
      h: sizeY ? Number(sizeY) * heightScaleFactor : DEFAULT_PANEL_HEIGHT,
      i: panelIndex,
    },
    embeddableConfig,
  };
}

/** gridData of 6.1 and 6.2 panels, which were 4 times coarser */
const scaledGridData = (gridData: unknown, heightScaleFactor: number) => ({
  w: Number(read(gridData, 'w')) * PANEL_WIDTH_SCALE_FACTOR,
  h: Number(read(gridData, 'h')) * heightScaleFactor,
  x: Number(read(gridData, 'x')) * PANEL_WIDTH_SCALE_FACTOR,
  y: Number(read(gridData, 'y')) * heightScaleFactor,
  i: read(gridData, 'i'),
});

function migrate610Panel(panel: Bag, version: string, useMargins: unknown, uiState: unknown): Bag {
  for (const key of ['w', 'x', 'h', 'y']) {
    if (read(panel.gridData, key) === undefined) {
      throw new Error(
        `Unable to migrate panel data for "6.3.0" backwards compatibility, panel does not contain expected field: ${key}`
      );
    }
  }
  const embeddableConfig = uiStateOf(uiState, panel);
  moveColumnsAndSort(panel, embeddableConfig);
  const heightScaleFactor = useMargins ? PANEL_HEIGHT_SCALE_FACTOR_WITH_MARGINS : PANEL_HEIGHT_SCALE_FACTOR;
  const { columns: _columns, sort: _sort, ...rest } = panel;
  const panelIndex = panelIndexOf(panel);
  return { ...rest, version, panelIndex, gridData: scaledGridData(panel.gridData, heightScaleFactor), embeddableConfig };
}

function migrate620Panel(panel: Bag, version: string, useMargins: unknown): Bag {
  const embeddableConfig = panel.embeddableConfig || {};
  moveColumnsAndSort(panel, embeddableConfig);
  const heightScaleFactor = useMargins ? PANEL_HEIGHT_SCALE_FACTOR_WITH_MARGINS : PANEL_HEIGHT_SCALE_FACTOR;
  const { columns: _columns, sort: _sort, ...rest } = panel;
  const panelIndex = panelIndexOf(panel);
  return { ...rest, version, panelIndex, gridData: scaledGridData(panel.gridData, heightScaleFactor), embeddableConfig };
}

function migrate630Panel(panel: Bag, version: string): Bag {
  const embeddableConfig = panel.embeddableConfig || {};
  moveColumnsAndSort(panel, embeddableConfig);
  const { columns: _columns, sort: _sort, ...rest } = panel;
  const panelIndex = panelIndexOf(panel);
  return { ...rest, version, panelIndex, embeddableConfig };
}

function migrate640To720Panel(panel: Bag, version: string): Bag {
  const panelIndex = panelIndexOf(panel);
  return { ...panel, version, panelIndex, embeddableConfig: panel.embeddableConfig ?? {} };
}

/** `migratePanelsTo730` of the dashboard's common code: each panel by the release it was saved with */
export function migratePanelsTo730(panels: unknown, version: string, useMargins: unknown, uiState: unknown): unknown[] {
  return map(panels, (item) => {
    if (read(item, 'row') !== undefined) return migratePre61Panel(item as Bag, version, useMargins, uiState);
    if (satisfiesMinor(read(item, 'version'), 6, 1)) return migrate610Panel(item as Bag, version, useMargins, uiState);
    if (satisfiesMinor(read(item, 'version'), 6, 2)) return migrate620Panel(item as Bag, version, useMargins);
    if (satisfiesMinor(read(item, 'version'), 6, 3)) return migrate630Panel(item as Bag, version);
    const coerced = coercedVersion(read(item, 'version'));
    if (!below(coerced, 6, 4) && below(coerced, 7, 3)) return migrate640To720Panel(item as Bag, version);
    return item;
  });
}

/** Filters that were queries of 5.x become the query; the others stay filters */
export function moveFiltersToQuery(searchSource: unknown): Bag {
  const searchSource730: Bag = {
    ...spread(searchSource),
    filter: [],
    query: read(searchSource, 'query') || { query: '', language: 'kuery' },
  };
  if (!read(searchSource, 'filter')) write(searchSource, 'filter', []);
  each(read(searchSource, 'filter'), (filter) => {
    if (read(filter, 'query') && !read(filter, 'meta')) {
      const queryString = read(read(filter, 'query'), 'query_string');
      searchSource730.query = { query: queryString ? read(queryString, 'query') : '', language: 'lucene' };
    } else {
      push(searchSource730.filter, filter);
    }
  });
  return searchSource730;
}

const isDashboardDoc = (doc: Bag) =>
  typeof doc.id === 'string' &&
  typeof doc.type === 'string' &&
  doc.attributes !== null &&
  typeof doc.attributes === 'object' &&
  doc.references !== null &&
  typeof doc.references === 'object' &&
  typeof (doc.attributes as Bag).panelsJSON === 'string';

// 7.3.0: the query filters of 5.x become the query, and the panels of every release before 7.3 take the shape of 7.3
const migrations730: MigrationStep = (doc, context) => {
  if (!isDashboardDoc(doc)) return doc;
  const attributes = doc.attributes as Bag;
  try {
    const searchSource = parse(read(attributes.kibanaSavedObjectMeta, 'searchSourceJSON'));
    write(attributes.kibanaSavedObjectMeta, 'searchSourceJSON', JSON.stringify(moveFiltersToQuery(searchSource)));
  } catch (error) {
    context?.log.warning(`Exception @ migrations730 while trying to migrate dashboard query filters!\n${String(error)}`);
    return doc;
  }
  // uiStateJSON stopped being used at some point, so it may not be there; what is there must be JSON
  let uiState: unknown = {};
  if (attributes.uiStateJSON && attributes.uiStateJSON !== '') uiState = parse(attributes.uiStateJSON);
  try {
    const panels = parse(attributes.panelsJSON);
    attributes.panelsJSON = JSON.stringify(
      migratePanelsTo730(panels, '7.3.0', attributes.useMargins === undefined ? true : attributes.useMargins, uiState)
    );
    delete attributes.uiStateJSON;
  } catch (error) {
    context?.log.warning(`Exception @ migrations730 while trying to migrate dashboard panels!\nError: ${String(error)}`);
    return doc;
  }
  return doc;
};

export const DASHBOARD_MIGRATIONS: Record<string, MigrationStep> = {
  // Twice, as in the original: 6.7.2 for objects of 6.7, 7.9.3 for the others
  '6.7.2': flow(migrateMatchAllQuery),
  '7.0.0': flow(migrations700),
  '7.3.0': flow(migrations730),
  '7.9.3': flow(migrateMatchAllQuery),
};

// --- config and the TSVB telemetry ------------------------------------------------------------

export const CONFIG_MIGRATIONS: Record<string, MigrationStep> = {
  // The settings of the SIEM app took the name of its successor
  '7.9.0': (doc) => ({
    ...doc,
    ...(doc.attributes
      ? {
          attributes: Object.keys(doc.attributes).reduce<Bag>((acc, key) => {
            const name = key.startsWith('siem:') ? key.replace('siem', 'securitySolution') : key;
            Object.defineProperty(acc, name, {
              value: (doc.attributes as Bag)[key],
              enumerable: true,
              writable: true,
              configurable: true,
            });
            return acc;
          }, {}),
        }
      : {}),
    references: doc.references || [],
  }),
};

const resetCount: MigrationStep = (doc) => ({ ...doc, attributes: { ...spread(doc.attributes), failedRequests: 0 } });

export const TSVB_TELEMETRY_MIGRATIONS: Record<string, MigrationStep> = {
  '7.7.0': flow(resetCount),
  '7.8.0': flow(resetCount),
  '7.9.0': flow(resetCount),
  '7.10.0': flow(resetCount),
};

// --- the migrator -----------------------------------------------------------------------------

/** The migrations of each type that has them, as the types of this product register them */
export const TYPE_MIGRATIONS: Readonly<Record<string, Record<string, MigrationStep>>> = {
  config: CONFIG_MIGRATIONS,
  'index-pattern': INDEX_PATTERN_MIGRATIONS,
  dashboard: DASHBOARD_MIGRATIONS,
  visualization: VISUALIZATION_MIGRATIONS,
  'tsvb-validation-telemetry': TSVB_TELEMETRY_MIGRATIONS,
  search: SEARCH_MIGRATIONS,
};

interface ActiveMigration {
  latestVersion: string;
  transforms: Array<{ version: string; transform: MigrationStep }>;
}

/** What the original's `DocumentMigrator` gives: the last version of each type, and `migrate` */
export interface DocumentMigrator {
  readonly migrationVersion: Readonly<Record<string, string>>;
  migrate<T extends MigrationDocument>(document: T, log?: Logger): T;
}

/** The version the object names for a key */
const versionOf = (doc: Bag, prop: string): unknown => {
  const { migrationVersion } = doc;
  return migrationVersion ? (migrationVersion as Bag)[prop] : undefined;
};

/** The keys of the object, then its type: each one may be a type with migrations */
const propsOf = (doc: Bag) => [...Object.keys(doc), String(doc.type)];

function assertNoDowngrades(doc: Bag, migrationVersion: Bag, prop: string, version: string) {
  const docVersion = doc.migrationVersion as Bag | undefined;
  if (!docVersion) return;
  const downgrade = Object.keys(migrationVersion).find(
    (key) => !Object.prototype.hasOwnProperty.call(docVersion, key) || compare(docVersion[key], migrationVersion[key]) < 0
  );
  if (downgrade) {
    throw new Error(
      `Migration "${prop} v ${version}" attempted to downgrade "migrationVersion.${downgrade}" from ` +
        `${String(migrationVersion[downgrade])} to ${String(docVersion[downgrade])}.`
    );
  }
}

/**
 * The migrator of the original, for these migrations of each type (the key that names a type may
 * also be a key of the object, which the type's migrations then change). Two faults of the
 * original are not copied: it takes `latestVersion` of the value of each key of the object as the
 * version of that key, which refuses an object whose attributes have one, and it calls
 * `hasOwnProperty` of `migrationVersion`, which breaks on a `migrationVersion` that has a key of
 * that name.
 */
export function createDocumentMigrator(
  typeMigrations: Readonly<Record<string, Readonly<Record<string, MigrationStep>>>>
): DocumentMigrator {
  const active: ReadonlyMap<string, ActiveMigration> = new Map(
    Object.entries(typeMigrations)
      .filter(([, migrations]) => Object.keys(migrations).length > 0)
      .map(([type, migrations]) => {
        const transforms = Object.entries(migrations)
          .map(([version, transform]) => ({ version, transform }))
          .sort((a, b) => compare(a.version, b.version));
        return [type, { latestVersion: transforms[transforms.length - 1].version, transforms }];
      })
  );
  const latestOf = (prop: string) => active.get(prop)?.latestVersion;

  function nextUnmigratedProp(doc: Bag): string | undefined {
    return propsOf(doc).find((prop) => {
      const latestVersion = latestOf(prop);
      const docVersion = versionOf(doc, prop);
      if (latestVersion === docVersion) return false;
      // An object of a later release cannot be migrated, and would come round again for ever
      if (docVersion && (!latestVersion || versionGreaterThan(docVersion, latestVersion))) {
        throw new HttpError(
          422,
          `Document "${String(doc.id)}" has property "${prop}" which belongs to a more recent` +
            ` version of OpenSearch Dashboards [${String(docVersion)}]. The last known version is [${String(latestVersion)}]`
        );
      }
      return true;
    });
  }

  function migrateProp(start: Bag, prop: string, log: Logger): Bag {
    let doc = start;
    const originalType = doc.type;
    let migrationVersion: Bag = doc.migrationVersion ? spread(doc.migrationVersion) : {};
    const migrations = active.get(prop);
    if (!migrations) {
      throw new Error(
        `No migrations registered for property "${prop}". Document id="${String(doc.id)}", type="${String(doc.type)}". ` +
          'This usually means the plugin owning this saved-object type is not loaded (orphan document).'
      );
    }
    const minVersion = versionOf(doc, prop);
    const transforms = minVersion
      ? migrations.transforms.filter(({ version }) => versionGreaterThan(version, minVersion))
      : migrations.transforms;
    for (const { version, transform } of transforms) {
      try {
        const context: MigrationContext = {
          log: {
            info: (message) => log.info(message),
            debug: (message) => log.debug(message),
            warn: (message) => log.warn(message),
            warning: (message) => log.warn(message),
            error: (message) => log.error(message),
          },
        };
        const result = transform(doc, context);
        if (!result || !result.type) throw new Error(`Invalid saved object returned from migration ${prop}:${version}.`);
        doc = result;
      } catch (error) {
        log.warn(
          `Failed to transform document _id="${String(doc.id)}" type="${String(doc.type)}". ` +
            `Transform: ${prop}:${version}\nDoc: ${JSON.stringify(doc)}`
        );
        throw error;
      }
      assertNoDowngrades(doc, migrationVersion, prop, version);
      const docVersion = versionOf(doc, prop) || '0.0.0';
      const maxVersion = versionGreaterThan(docVersion, version) ? docVersion : version;
      migrationVersion = { ...spread(doc.migrationVersion || migrationVersion), [prop]: maxVersion };
      doc.migrationVersion = spread(migrationVersion);
      // A type's name is no key of its objects: one step at a time, as in the original
      if (!Object.prototype.hasOwnProperty.call(doc, prop) || doc.type !== originalType) break;
    }
    return doc;
  }

  function migrate<T extends MigrationDocument>(document: T, log: Logger = silentLogger): T {
    let doc = structuredClone(document) as Bag;
    if (doc.migrationVersion) {
      for (let prop = nextUnmigratedProp(doc); prop !== undefined; prop = nextUnmigratedProp(doc)) {
        doc = migrateProp(doc, prop, log);
      }
    } else {
      // Written by this release: marked as migrated
      const migrationVersion: Bag = {};
      for (const prop of propsOf(doc)) {
        const latest = latestOf(prop);
        if (latest) migrationVersion[prop] = latest;
      }
      doc = { ...doc, migrationVersion };
    }
    const { migrationVersion } = doc;
    if (migrationVersion === null || migrationVersion === undefined || Object.keys(migrationVersion).length === 0) {
      delete doc.migrationVersion;
    }
    return doc as T;
  }

  return {
    migrationVersion: Object.fromEntries([...active].map(([type, { latestVersion }]) => [type, latestVersion])),
    migrate,
  };
}

const MIGRATOR = createDocumentMigrator(TYPE_MIGRATIONS);

/** The last migration of each type that has migrations in OpenSearch Dashboards 3.9.0 */
export const LATEST_MIGRATION_VERSIONS: Readonly<Record<string, string>> = MIGRATOR.migrationVersion;

/** The object as the original's migrator hands it to be written */
export function migrateDocument<T extends MigrationDocument>(document: T, log: Logger = silentLogger): T {
  return MIGRATOR.migrate(document, log);
}

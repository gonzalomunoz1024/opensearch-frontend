/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The OpenSearch query a page asks: what is typed in the search bar, the filters under it and
 * the time range, combined the way OpenSearch Dashboards combines them.
 */

import type { AbsoluteRange } from './dates';
import { kueryToDsl, parseKuery } from './kuery';
import type { Field, Filter, IndexPattern, Query } from './types';

type Dsl = Record<string, unknown>;

export interface QueryConfig {
  /** The setting query:queryString:options */
  queryStringOptions?: Record<string, unknown>;
  /** The setting dateFormat:tz, when it names a zone */
  dateFormatTZ?: string;
  /** The setting courier:ignoreFilterIfFieldNotInIndex */
  ignoreFilterIfFieldNotInIndex?: boolean;
}

export interface BoolQuery {
  bool: { must: Dsl[]; filter: Dsl[]; should: Dsl[]; must_not: Dsl[] };
}

const META_KEYS = new Set(['meta', '$state']);

// The clause of a filter: everything on it that is not about the filter itself
function clauseOf(filter: Filter): Dsl {
  if (filter.query) return migrateDeprecatedMatch(filter.query);
  const clause: Dsl = {};
  for (const [key, value] of Object.entries(filter)) {
    if (!META_KEYS.has(key)) clause[key] = value;
  }
  return clause;
}

// Filters saved long ago wrote a phrase as `match: { field: { query, type: 'phrase' } }`
function migrateDeprecatedMatch(query: Dsl): Dsl {
  const match = query.match as Record<string, { query?: unknown; type?: string }> | undefined;
  if (match && typeof match === 'object') {
    const [field] = Object.keys(match);
    const params = match[field];
    if (params && typeof params === 'object' && params.type === 'phrase') {
      const { type: _type, ...rest } = params;
      const { match: _match, ...others } = query;
      return { ...others, match_phrase: { [field]: rest } };
    }
  }
  return query;
}

function filterMatchesIndex(filter: Filter, indexPattern?: IndexPattern): boolean {
  if (!filter.meta?.key || !indexPattern) return true;
  // A filter that names no field of its own applies to any index
  if (filter.meta.type === 'custom' || filter.meta.type === 'query_string') return true;
  return indexPattern.fields.some((field) => field.name === filter.meta.key);
}

function wrapNestedFilter(clause: Dsl, filter: Filter, indexPattern?: IndexPattern): Dsl {
  const field: Field | undefined = indexPattern?.fields.find((candidate) => candidate.name === filter.meta.key);
  const path = field?.subType?.nested?.path;
  if (!path || 'nested' in clause) return clause;
  return { nested: { path, query: clause } };
}

export function timeRangeFilter(indexPattern: IndexPattern | undefined, range: AbsoluteRange | undefined) {
  if (!indexPattern?.timeFieldName || !range) return undefined;
  return {
    range: {
      [indexPattern.timeFieldName]: {
        gte: range.from.toISOString(),
        lte: range.to.toISOString(),
        format: 'strict_date_optional_time',
      },
    },
  };
}

export function buildQuery(
  indexPattern: IndexPattern | undefined,
  queries: Query | Query[] | undefined,
  filters: Filter[] = [],
  config: QueryConfig = {}
): BoolQuery {
  const bool: BoolQuery['bool'] = { must: [], filter: [], should: [], must_not: [] };

  for (const query of ([] as Array<Query | undefined>).concat(queries ?? [])) {
    if (!query) continue;
    if (typeof query.query !== 'string') {
      // A query written as OpenSearch DSL is used as it is
      if (query.query && Object.keys(query.query).length) bool.must.push(query.query);
      continue;
    }
    const text = query.query.trim();
    if (query.language === 'lucene') {
      bool.must.push(
        text === ''
          ? { match_all: {} }
          : {
              query_string: {
                query: text,
                ...(config.queryStringOptions ?? { analyze_wildcard: true }),
                ...(config.dateFormatTZ ? { time_zone: config.dateFormatTZ } : {}),
              },
            }
      );
    } else if (text !== '') {
      bool.filter.push(kueryToDsl(parseKuery(text), indexPattern, { dateFormatTZ: config.dateFormatTZ }));
    }
  }

  for (const filter of filters) {
    if (!filter || filter.meta?.disabled) continue;
    if (config.ignoreFilterIfFieldNotInIndex && !filterMatchesIndex(filter, indexPattern)) continue;
    const clause = wrapNestedFilter(clauseOf(filter), filter, indexPattern);
    if (Object.keys(clause).length === 0) continue;
    (filter.meta?.negate ? bool.must_not : bool.filter).push(clause);
  }

  return { bool };
}

// --- Making and describing filters ----------------------------------------------------------------

export function phraseFilter(field: Pick<Field, 'name'>, value: unknown, indexId?: string): Filter {
  return {
    meta: {
      index: indexId,
      alias: null,
      negate: false,
      disabled: false,
      type: 'phrase',
      key: field.name,
      params: { query: value },
    },
    query: { match_phrase: { [field.name]: value } },
    $state: { store: 'appState' },
  };
}

export function phrasesFilter(field: Pick<Field, 'name'>, values: unknown[], indexId?: string): Filter {
  return {
    meta: {
      index: indexId,
      alias: null,
      negate: false,
      disabled: false,
      type: 'phrases',
      key: field.name,
      value: values.join(', '),
      params: values,
    },
    query: {
      bool: {
        should: values.map((value) => ({ match_phrase: { [field.name]: value } })),
        minimum_should_match: 1,
      },
    },
    $state: { store: 'appState' },
  };
}

export function rangeFilter(
  field: Pick<Field, 'name'>,
  params: { gt?: unknown; gte?: unknown; lt?: unknown; lte?: unknown; format?: string },
  indexId?: string
): Filter {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') clean[key] = value;
  }
  return {
    meta: {
      index: indexId,
      alias: null,
      negate: false,
      disabled: false,
      type: 'range',
      key: field.name,
      params: clean,
    },
    range: { [field.name]: clean },
    $state: { store: 'appState' },
  };
}

export function existsFilter(field: Pick<Field, 'name'>, indexId?: string): Filter {
  return {
    meta: {
      index: indexId,
      alias: null,
      negate: false,
      disabled: false,
      type: 'exists',
      key: field.name,
      value: 'exists',
    },
    exists: { field: field.name },
    $state: { store: 'appState' },
  };
}

export function customFilter(dsl: Dsl, indexId?: string): Filter {
  return {
    meta: {
      index: indexId,
      alias: null,
      negate: false,
      disabled: false,
      type: 'custom',
      key: 'query',
      value: JSON.stringify(dsl),
    },
    query: dsl,
    $state: { store: 'appState' },
  };
}

export interface FilterDescription {
  key: string;
  value: string;
}

/** What a filter's pill says. `format` writes a value the way the field shows it. */
export function describeFilter(
  filter: Filter,
  format: (fieldName: string, value: unknown) => string = (_name, value) => String(value)
): FilterDescription {
  const { meta } = filter;
  const key = meta.key ?? 'query';
  switch (meta.type) {
    case 'phrase': {
      const params = meta.params as { query?: unknown } | undefined;
      const fromQuery = (filter.query?.match_phrase as Record<string, unknown> | undefined)?.[key];
      const raw = params?.query ?? (typeof fromQuery === 'object' && fromQuery ? (fromQuery as { query?: unknown }).query : fromQuery);
      return { key, value: raw === undefined ? String(meta.value ?? '') : format(key, raw) };
    }
    case 'phrases': {
      const values = Array.isArray(meta.params) ? meta.params : [];
      return { key, value: values.map((value) => format(key, value)).join(', ') };
    }
    case 'range': {
      const params = (meta.params ?? filter.range?.[key] ?? {}) as Record<string, unknown>;
      const from = params.gte ?? params.gt;
      const to = params.lte ?? params.lt;
      const left = from === undefined ? '-∞' : format(key, from);
      const right = to === undefined ? '+∞' : format(key, to);
      return { key, value: `${left} to ${right}` };
    }
    case 'exists':
      return { key, value: 'exists' };
    case 'geo_bounding_box':
    case 'geo_polygon': {
      // mapGeoBoundingBox and mapGeoPolygon, with the text a geo_point field shows an object as
      const clause = (filter[meta.type] ?? {}) as Record<string, unknown>;
      const params = (meta.params ?? clause[key]) as { top_left?: unknown; bottom_right?: unknown; points?: unknown[] } | undefined;
      const pretty = (point: unknown) => JSON.stringify(point, null, 1).replace(/\n\s*/g, ' ');
      if (meta.type === 'geo_polygon') return { key, value: (params?.points ?? []).map(pretty).join(', ') };
      return { key, value: `${pretty(params?.top_left)} to ${pretty(params?.bottom_right)}` };
    }
    case 'missing':
      return { key, value: 'missing' };
    default: {
      if (filter.exists) return { key: filter.exists.field, value: 'exists' };
      if (meta.key && meta.value !== undefined) return { key: meta.key, value: String(meta.value) };
      const clause = clauseOf(filter);
      return { key: meta.key ?? 'query', value: JSON.stringify(clause) };
    }
  }
}

/** Whether two filters ask the same thing, whatever their state */
export function sameFilter(a: Filter, b: Filter): boolean {
  return (
    JSON.stringify(clauseOf(a)) === JSON.stringify(clauseOf(b)) &&
    Boolean(a.meta?.negate) === Boolean(b.meta?.negate)
  );
}

/** Adds filters to a list, leaving out those it already has */
export function mergeFilters(existing: Filter[], added: Filter[]): Filter[] {
  const merged = [...existing];
  for (const filter of added) {
    const at = merged.findIndex((candidate) => JSON.stringify(clauseOf(candidate)) === JSON.stringify(clauseOf(filter)));
    if (at === -1) merged.push(filter);
    else merged[at] = { ...merged[at], meta: { ...merged[at].meta, negate: filter.meta.negate, disabled: false } };
  }
  return merged;
}

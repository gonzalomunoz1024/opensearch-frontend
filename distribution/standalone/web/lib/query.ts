/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The OpenSearch query a page asks: what is typed in the search bar, the filters under it and
 * the time range, combined the way OpenSearch Dashboards combines them.
 */

import type { AbsoluteRange } from './dates';
import { kueryToDsl, parseKuery, timeZone } from './kuery';
import type { Field, Filter, IndexPattern, Query } from './types';

type Dsl = Record<string, unknown>;

export interface QueryConfig {
  /** The setting query:queryString:options */
  queryStringOptions?: Record<string, unknown>;
  /** The setting dateFormat:tz: a zone, or "Browser" for the browser's own; no zone is named without it */
  dateFormatTZ?: string;
  /** The setting courier:ignoreFilterIfFieldNotInIndex */
  ignoreFilterIfFieldNotInIndex?: boolean;
  /** The setting query:allowLeadingWildcards: true unless it says otherwise */
  allowLeadingWildcards?: boolean;
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

function wrapNestedFilter(clause: Dsl, filter: Filter, indexPattern?: IndexPattern): Dsl {
  const field: Field | undefined = indexPattern?.fields.find((candidate) => candidate.name === filter.meta?.key);
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

// The options of query:queryString:options over a query_string's own, and the zone of the dates
// in it unless one is named: the browser's own when the setting says "Browser"
function decorateQueryString(queryString: Dsl, config: QueryConfig): Dsl {
  const decorated: Dsl = { ...queryString, ...(config.queryStringOptions ?? { analyze_wildcard: true }) };
  if (config.dateFormatTZ && decorated.time_zone === undefined) decorated.time_zone = timeZone(config.dateFormatTZ);
  return decorated;
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
      // A query written as OpenSearch DSL is used as it is, but for a Lucene query_string, which
      // gets the options and the zone like one that was typed (the original's decorateQuery)
      const dsl: Dsl | undefined = query.query && Object.keys(query.query).length ? query.query : undefined;
      const inner = query.language === 'lucene' && dsl && isRecord(dsl.query_string) ? dsl.query_string : undefined;
      if (dsl) bool.must.push(inner && 'query' in inner ? { ...dsl, query_string: decorateQueryString(inner, config) } : dsl);
      continue;
    }
    const text = query.query;
    if (query.language === 'lucene') {
      if (text.trim() === '') {
        bool.must.push({ match_all: {} });
      } else {
        bool.must.push({ query_string: decorateQueryString({ query: text }, config) });
      }
    } else if (query.language === 'kuery') {
      // DQL as typed, an empty query too: it asks for everything, as in OpenSearch Dashboards
      const node = parseKuery(text, { allowLeadingWildcards: config.allowLeadingWildcards ?? true });
      bool.filter.push(kueryToDsl(node, indexPattern, { dateFormatTZ: config.dateFormatTZ }));
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

/**
 * A field as the filters made on it need it: its name, and what kind of field it is. A scripted
 * field is in no document, so a filter on it asks its script instead, in the script's language
 * (phrase_filter.ts, phrases_filter.ts and range_filter.ts of OpenSearch Dashboards). A bare name
 * makes the filter on the field of that name, as before.
 */
export type FilterField = Pick<Field, 'name'> & Partial<Pick<Field, 'type' | 'scripted' | 'script' | 'lang'>>;

/** How a value is written where the original writes it with the field's format */
export type ValueText = (value: unknown) => string;

export interface RangeParams {
  gt?: unknown;
  gte?: unknown;
  lt?: unknown;
  lte?: unknown;
  format?: string;
}

// A type rather than an interface: it is what a filter holds under `script`
export type ScriptClause = {
  script: { source: string; lang?: string; params: Record<string, unknown> };
};

/**
 * A value as a field holds it: a boolean field takes "true", "false", 1 and 0 (what aggregations
 * answer) as true and false, and nothing else (getConvertedValueForField)
 */
export function convertedValueForField(field: FilterField, value: unknown): unknown {
  if (typeof value !== 'boolean' && field.type === 'boolean') {
    if (value === 1 || value === 'true') return true;
    if (value === 0 || value === 'false') return false;
    throw new Error(`${String(value)} is not a valid boolean value for boolean field ${field.name}`);
  }
  return value;
}

/**
 * The script that asks whether a scripted field is a value (buildInlineScriptForPhraseFilter).
 * Painless is wrapped in a lambda, in case the field's script is more than an expression.
 */
export function phraseScriptSource(field: FilterField): string {
  if (field.lang === 'painless') {
    return `boolean compare(Supplier s, def v) {return s.get() == v;}compare(() -> { ${field.script} }, params.value);`;
  }
  return `(${field.script}) == value`;
}

/** The script clause of a phrase on a scripted field: getPhraseScript */
export function getPhraseScript(field: FilterField, value: unknown): ScriptClause {
  return {
    script: {
      source: phraseScriptSource(field),
      lang: field.lang,
      params: { value: convertedValueForField(field, value) },
    },
  };
}

const RANGE_OPERATORS: Record<string, string> = { gt: '>', gte: '>=', lte: '<=', lt: '<' };

const COMPARATORS: Record<string, string> = {
  gt: 'boolean gt(Supplier s, def v) {return s.get() > v}',
  gte: 'boolean gte(Supplier s, def v) {return s.get() >= v}',
  lte: 'boolean lte(Supplier s, def v) {return s.get() <= v}',
  lt: 'boolean lt(Supplier s, def v) {return s.get() < v}',
};

// A date's script gives a date, and the ends are instants written out
const DATE_COMPARATORS: Record<string, string> = {
  gt: 'boolean gt(Supplier s, def v) {return s.get().toInstant().isAfter(Instant.parse(v))}',
  gte: 'boolean gte(Supplier s, def v) {return !s.get().toInstant().isBefore(Instant.parse(v))}',
  lte: 'boolean lte(Supplier s, def v) {return !s.get().toInstant().isAfter(Instant.parse(v))}',
  lt: 'boolean lt(Supplier s, def v) {return s.get().toInstant().isBefore(Instant.parse(v))}',
};

/** The script clause of a range on a scripted field: getRangeScript, its ends in its params */
export function getRangeScript(field: FilterField, params: RangeParams): ScriptClause {
  const known: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) if (key in RANGE_OPERATORS) known[key] = value;
  const keys = Object.keys(known);
  let source = keys.map((key) => `(${field.script})${RANGE_OPERATORS[key]}${key}`).join(' && ');
  if (field.lang === 'painless') {
    const comparators = field.type === 'date' ? DATE_COMPARATORS : COMPARATORS;
    const definitions = keys.map((key) => comparators[key]).join(' ');
    const comparisons = keys.map((key) => `${key}(() -> { ${field.script} }, params.${key})`).join(' && ');
    source = `${definitions}${comparisons}`;
  }
  return { script: { source, params: known, lang: field.lang } };
}

const BASE_META = { alias: null, negate: false, disabled: false };

/** An IPv4 address as a number, or `undefined` when it is none: four whole numbers below 256 */
export function ipv4Value(address: string): number | undefined {
  const bytes = address.split('.');
  if (bytes.length !== 4) return undefined;
  let value = 0;
  for (const byte of bytes) {
    const number = Number(byte);
    if (Number.isNaN(number) || number < 0 || number >= 256 || number % 1 !== 0) return undefined;
    value = value * 256 + number;
  }
  return value;
}

const ipv4Text = (value: number) => [24, 16, 8, 0].map((shift) => Math.floor(value / 2 ** shift) % 256).join('.');

/** The first and the last address of a CIDR mask ("10.0.0.0/8"), or `undefined` when it is none */
export function cidrRange(mask: string): { from: string; to: string } | undefined {
  const parts = mask.split('/');
  if (parts.length !== 2) return undefined;
  const address = ipv4Value(parts[0]);
  const prefix = Number(parts[1]);
  if (address === undefined || Number.isNaN(prefix) || prefix < 1 || prefix > 32) return undefined;
  const size = 2 ** (32 - prefix);
  const from = Math.floor(address / size) * size;
  return { from: ipv4Text(from), to: ipv4Text(from + size - 1) };
}

export function phraseFilter(field: FilterField, value: unknown, indexId?: string): Filter {
  const converted = convertedValueForField(field, value);
  if (field.scripted) {
    return {
      meta: { index: indexId, field: field.name, ...BASE_META, type: 'phrase', key: field.name, params: { query: converted } },
      script: getPhraseScript(field, value),
      $state: { store: 'appState' },
    };
  }
  return {
    meta: { index: indexId, ...BASE_META, type: 'phrase', key: field.name, params: { query: converted } },
    query: { match_phrase: { [field.name]: converted } },
    $state: { store: 'appState' },
  };
}

/** `format` writes the values the filter's text lists, as the field's format does in the original */
export function phrasesFilter(field: FilterField, values: unknown[], indexId?: string, format?: ValueText): Filter {
  return {
    meta: {
      index: indexId,
      ...BASE_META,
      type: 'phrases',
      key: field.name,
      value: values.map((value) => (format ? format(value) : String(value))).join(', '),
      params: values,
    },
    query: {
      bool: {
        should: values.map((value) =>
          field.scripted ? { script: getPhraseScript(field, value) } : { match_phrase: { [field.name]: value } }
        ),
        minimum_should_match: 1,
      },
    },
    $state: { store: 'appState' },
  };
}

/**
 * A range on a field (buildRangeFilter). Every end given for a number field is read as a number,
 * one given as nothing too: it is NaN then, which is written null, as the original writes it. Of
 * another field an end left out, empty or null is left out. An infinite end is no end, and a range
 * infinite at both ends is all of the field. `format` writes the ends of a scripted field's range
 * into its script's `value`, as the field's format does in the original; `formattedValue` is what
 * the bucket the range was made from was called.
 */
export function rangeFilter(
  field: FilterField,
  params: RangeParams,
  indexId?: string,
  format?: ValueText,
  formattedValue?: string
): Filter {
  const given: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (field.type === 'number') given[key] = typeof value === 'number' ? value : parseFloat(String(value));
    else if (value !== undefined && value !== null && value !== '') given[key] = value;
  }
  if ('gte' in given && 'gt' in given) throw new Error('gte and gt are mutually exclusive');
  if ('lte' in given && 'lt' in given) throw new Error('lte and lt are mutually exclusive');
  let infinite = 0;
  for (const operator of ['gt', 'lt']) {
    const key = operator in given ? operator : `${operator}e`;
    if (key in given && Math.abs(Number(given[key])) === Infinity) {
      infinite += 1;
      delete given[key];
    }
  }
  const meta: Filter['meta'] = { index: indexId, ...BASE_META, type: 'range', key: field.name };
  if (formattedValue) meta.formattedValue = formattedValue;
  if (infinite === 2) {
    return { meta: { ...meta, type: 'match_all', field: field.name, value: formattedValue || 'all' }, match_all: {}, $state: { store: 'appState' } };
  }
  if (field.scripted) {
    const clause = getRangeScript(field, given);
    clause.script.params.value = Object.entries(clause.script.params)
      .map(([key, value]) => `${RANGE_OPERATORS[key]}${format ? format(value) : String(value)}`)
      .join(' ');
    return { meta: { ...meta, field: field.name, params: clause.script.params }, script: clause, $state: { store: 'appState' } };
  }
  return { meta: { ...meta, params: given }, range: { [field.name]: given }, $state: { store: 'appState' } };
}

export function existsFilter(field: FilterField, indexId?: string): Filter {
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

/** What a filter's value says, written with a field's format: a function of the original's meta */
export type FilterValue = string | ((format?: ValueText) => string);

/** What the original's filter manager reads off a filter: its kind, field, value and params */
export interface MappedFilter {
  type: string;
  key?: string;
  value?: FilterValue;
  params?: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The params of a filter's script, which a filter on a scripted field asks */
function scriptParams(filter: Filter): Record<string, unknown> | undefined {
  const inner = isRecord(filter.script) ? filter.script.script : undefined;
  return isRecord(inner) && isRecord(inner.params) ? inner.params : undefined;
}

const RANGE_KEYS = ['gte', 'gt', 'lte', 'lt', 'from', 'to'];

function mapRange(filter: Filter): MappedFilter | undefined {
  const script = scriptParams(filter);
  const scripted = Boolean(script && Object.keys(script).some((key) => RANGE_KEYS.includes(key)));
  if (!filter.range && !scripted) return undefined;
  const key = (scripted ? filter.meta.field : Object.keys(filter.range ?? {})[0]) ?? '';
  const params = (scripted ? script : filter.range?.[key]) ?? {};
  // An end that is left out or null is infinite
  let left = 'gte' in params ? params.gte : params.gt;
  if (left === undefined || left === null) left = -Infinity;
  let right = 'lte' in params ? params.lte : params.lt;
  if (right === undefined || right === null) right = Infinity;
  const value = (format?: ValueText) => (format ? `${format(left)} to ${format(right)}` : `${String(left)} to ${String(right)}`);
  return { type: 'range', key, value, params };
}

function mapPhrase(filter: Filter): MappedFilter | undefined {
  const scriptedValue = scriptParams(filter)?.value;
  const query = isRecord(filter.query) ? migrateDeprecatedMatch(filter.query) : undefined;
  const phrase = query && isRecord(query.match_phrase) ? query.match_phrase : undefined;
  if ((scriptedValue === undefined || scriptedValue === null) && !phrase) return undefined;
  const scripted = scriptedValue !== undefined && scriptedValue !== null;
  const key = scripted ? (filter.meta.field ?? '') : Object.keys(phrase ?? {})[0];
  const raw = phrase?.[key];
  const value = scripted ? scriptedValue : isRecord(raw) ? raw.query : raw;
  return { type: 'phrase', key, value: (format?: ValueText) => (format ? format(value) : String(value)), params: { query: value } };
}

// Where a filter of geo points is, as its corners or its points
function mapGeo(filter: Filter, type: 'geo_bounding_box' | 'geo_polygon'): MappedFilter | undefined {
  const clause = filter[type];
  if (!isRecord(clause)) return undefined;
  const key = Object.keys(clause).filter((name) => name !== 'ignore_unmapped')[0];
  const params = isRecord(clause[key]) ? (clause[key] as Record<string, unknown>) : {};
  const write = (format: ValueText | undefined, point: unknown) => (format ? format(point) : JSON.stringify(point));
  if (type === 'geo_polygon') {
    const points = Array.isArray(params.points) ? params.points : [];
    return { type, key, params, value: (format?: ValueText) => points.map((point) => write(format, point)).join(', ') };
  }
  return { type, key, params, value: (format?: ValueText) => `${write(format, params.top_left)} to ${write(format, params.bottom_right)}` };
}

/**
 * What a filter is, the field it is on, its value and its params, read as the original's filter
 * manager reads them (mapFilter): its mappers in their order, the first that knows the filter.
 */
export function mapFilter(filter: Filter): MappedFilter {
  const { meta } = filter;
  if (meta.type === 'spatial_filter' && meta.key && meta.alias) return { type: meta.type, key: meta.key, value: '' };
  if (filter.match_all) return { type: 'match_all', key: meta.field, value: meta.formattedValue || 'all' };
  const mapped = mapRange(filter) ?? mapPhrase(filter);
  if (mapped) return mapped;
  if (meta.type === 'phrases') return { type: 'phrases', key: meta.key, value: typeof meta.value === 'string' ? meta.value : undefined, params: meta.params };
  if (filter.exists) return { type: 'exists', key: filter.exists.field, value: 'exists' };
  const missing = filter.missing;
  if (isRecord(missing)) return { type: 'missing', key: String(missing.field), value: 'missing' };
  const queryString = isRecord(filter.query) && isRecord(filter.query.query_string) ? filter.query.query_string : undefined;
  if (queryString && queryString.query !== undefined) return { type: 'query_string', key: 'query', value: String(queryString.query) };
  const geo = mapGeo(filter, 'geo_bounding_box') ?? mapGeo(filter, 'geo_polygon');
  if (geo) return geo;
  const key = Object.keys(filter).find((name) => !/(^\$|meta)/.test(name));
  return { type: 'custom', key, value: key === undefined ? '' : JSON.stringify(filter[key] ?? {}) };
}

/**
 * The filter with what is read off it written into its meta, as the original's filter manager
 * keeps every filter: a value written with a field's format is left out, the switches are
 * booleans and a filter without a label has null.
 */
export function withMappedMeta(filter: Filter): Filter {
  const mapped = mapFilter(filter);
  const meta: Filter['meta'] = {
    ...filter.meta,
    type: mapped.type,
    key: mapped.key,
    value: typeof mapped.value === 'string' ? mapped.value : undefined,
    params: mapped.params,
    disabled: Boolean(filter.meta.disabled),
    negate: Boolean(filter.meta.negate),
    alias: filter.meta.alias || null,
  };
  for (const name of ['key', 'value', 'params'] as const) if (meta[name] === undefined) delete meta[name];
  return { ...filter, meta };
}

/** The value of a filter the editor starts from (getFilterParams) */
export function getFilterParams(filter: Filter): unknown {
  const params = filter.meta.params;
  switch (filter.meta.type) {
    case 'phrase':
      return isRecord(params) ? params.query : undefined;
    case 'phrases':
      return params;
    case 'range':
      return { from: isRecord(params) ? params.gte : undefined, to: isRecord(params) ? params.lt : undefined };
    default:
      return undefined;
  }
}

/** The fields a Lucene query names, as `field:` before what it asks of them */
export function luceneFields(query: string): string[] {
  const unquoted = query.replace(/"(?:\\.|[^"\\])*"/g, ' ');
  const fields = new Set<string>();
  for (const match of unquoted.matchAll(/(?:^|[\s(])[+\-!]?((?:\\.|[^\s:()[\]{}"\\+\-!])(?:\\.|[^\s:()[\]{}"\\])*):/g)) {
    fields.add(match[1].replace(/\\(.)/g, '$1'));
  }
  return [...fields];
}

/**
 * Whether a filter is about a field of an index pattern (filterMatchesIndex): a filter written by
 * hand is when it was made on that pattern, and a Lucene one when the pattern has every field it
 * names.
 */
export function filterMatchesIndex(filter: Filter, indexPattern?: Pick<IndexPattern, 'id' | 'fields'>): boolean {
  if (!filter.meta?.key || !indexPattern) return true;
  if (filter.meta.type === 'query_string') {
    const queryString = isRecord(filter.query) && isRecord(filter.query.query_string) ? filter.query.query_string : undefined;
    const fields = luceneFields(String(queryString?.query ?? ''));
    return fields.every((name) => indexPattern.fields.some((field) => field.name === name));
  }
  if (filter.meta.type === 'custom') return filter.meta.index === indexPattern.id;
  return indexPattern.fields.some((field) => field.name === filter.meta.key);
}

export interface FilterDescription {
  key: string;
  value: string;
}

// An object, as a geo point, written on one line as the field shows it
const prettyObject = (value: unknown) => JSON.stringify(value, null, 1).replace(/\n\s*/g, ' ');

/** What a filter's pill says of it. `format` writes a value the way the field shows it. */
export function describeFilter(
  filter: Filter,
  format: (fieldName: string, value: unknown) => string = (_name, value) =>
    typeof value === 'object' && value !== null ? prettyObject(value) : String(value)
): FilterDescription {
  const mapped = mapFilter(filter);
  const key = mapped.key ?? 'query';
  const value = typeof mapped.value === 'function' ? mapped.value((item) => format(key, item)) : (mapped.value ?? '');
  return { key, value };
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

// Whether two values are the same, whatever the order of their keys (lodash's isEqual)
function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const aKeys = Object.keys(a);
  const bRecord = b as Record<string, unknown>;
  if (aKeys.length !== Object.keys(bRecord).length) return false;
  return aKeys.every((key) => key in bRecord && deepEqual((a as Record<string, unknown>)[key], bRecord[key]));
}

// Whether two filters ask the same, whatever they say of themselves (compareFilters)
function sameClause(a: Filter, b: Filter): boolean {
  const { meta: _aMeta, $state: _aState, ...aClause } = a;
  const { meta: _bMeta, $state: _bState, ...bClause } = b;
  return deepEqual(aClause, bClause);
}

const isGlobal = (filter: Filter) => filter.$state?.store === 'globalState';

/**
 * Filters as the original's filter manager keeps them once they change (setFilters): a filter on
 * the page that is pinned too stays pinned, with what the page's says of it; of a filter there
 * twice the later stays, where it is; the pinned ones come first.
 */
export function uniqueFilters(filters: Filter[]): Filter[] {
  const pinned = filters.filter(isGlobal).map((filter) => ({ ...filter, meta: { ...filter.meta } }));
  const app: Filter[] = [];
  for (const filter of filters) {
    if (isGlobal(filter)) continue;
    const match = pinned.find((other) => sameClause(other, filter));
    if (match) Object.assign(match.meta, filter.meta);
    else app.push(filter);
  }
  const unique: Filter[] = [];
  for (const filter of [...app].reverse().concat([...pinned].reverse())) {
    if (!unique.some((other) => sameClause(other, filter))) unique.push(filter);
  }
  unique.reverse();
  return [...unique.filter(isGlobal), ...unique.filter((filter) => !isGlobal(filter))];
}

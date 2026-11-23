/* SPDX-License-Identifier: Apache-2.0 */

/*
 * What the index pattern pages know without a screen: an index pattern as the data plugin of
 * OpenSearch Dashboards holds it, the body it writes for it, the field formats and their
 * parameters, the counts of the tabs, the matching of source filters, and what the wizard makes
 * of the indices a pattern names. Every rule here is the original's, since what these pages save
 * is read by OpenSearch Dashboards too.
 */

import { urlParts } from '../../lib/field_formats';

export interface SavedObjectReference {
  type: string;
  id: string;
  name: string;
}

/** A field as the index pattern's saved object keeps it, with every key it came with */
export interface FieldRecord {
  name: string;
  type: string;
  count?: number | string;
  script?: string;
  lang?: string;
  conflictDescriptions?: Record<string, string[]>;
  esTypes?: string[];
  scripted?: boolean;
  searchable?: boolean;
  aggregatable?: boolean;
  readFromDocValues?: boolean;
  subType?: unknown;
  [other: string]: unknown;
}

export interface SourceFilter {
  value: string;
  clientId?: number | string;
  [other: string]: unknown;
}

/**
 * A field format as an instance of the original holds it: its parameters start with the meta
 * parameters every instance is given (`parsedUrl`), then those it was made with
 */
export interface FormatInstance {
  id: string;
  params: Record<string, unknown>;
  /**
   * The format as it was stored, when it is written back untouched: the original writes the
   * stored object then, not an instance of it
   */
  raw?: unknown;
}

export interface SavedBody {
  title: string;
  displayName?: string;
  description?: string;
  signalType?: string;
  timeFieldName?: string;
  intervalName?: string;
  sourceFilters?: string;
  fields?: string;
  fieldFormatMap?: string;
  type?: string;
  typeMeta?: string;
  schemaMappings?: string;
}

export interface ManagedPattern {
  id: string;
  version?: string;
  title: string;
  displayName?: string;
  description?: string;
  signalType?: string;
  timeFieldName?: string;
  intervalName?: string;
  sourceFilters?: SourceFilter[];
  fields: FieldRecord[];
  fieldFormatMap: Record<string, FormatInstance | undefined>;
  /**
   * The format each field was given, as the original's fields keep it: as it was stored when the
   * page first read the pattern, or as the page last saved it. An untouched format is written back
   * as this, not as an instance of it.
   */
  storedFormats: Record<string, unknown>;
  type?: string;
  typeMeta?: unknown;
  schemaMappings?: unknown;
  references: SavedObjectReference[];
  /** The body as it was when the pattern was read: what a conflict is told from */
  originalBody: SavedBody;
}

export interface PatternAttributes {
  title?: unknown;
  displayName?: unknown;
  description?: unknown;
  signalType?: unknown;
  timeFieldName?: unknown;
  intervalName?: unknown;
  sourceFilters?: unknown;
  fields?: unknown;
  fieldFormatMap?: unknown;
  type?: unknown;
  typeMeta?: unknown;
  schemaMappings?: unknown;
  [other: string]: unknown;
}

export const patternName = (pattern: { title: string; displayName?: string }) =>
  pattern.displayName || pattern.title;

function parsed<T>(text: unknown, fallback: T): T {
  if (typeof text !== 'string' || text === '') return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

const optionalText = (value: unknown) => (typeof value === 'string' && value !== '' ? value : undefined);
// An attribute is kept as it is stored, an empty text too: the original writes it back so
const storedText = (value: unknown) => (typeof value === 'string' ? value : undefined);

// --- Field formats -------------------------------------------------------------------------------

/** The settings the defaults of the formats come from */
export type SettingReader = (key: string) => unknown;

export interface FormatType {
  id: string;
  title: string;
  fieldTypes: string[];
  /** The parameters an instance has when it is given none; a value equal to these is not saved */
  defaults(setting: SettingReader): Record<string, unknown>;
}

export const DEFAULT_COLOR = {
  range: `${Number.NEGATIVE_INFINITY}:${Number.POSITIVE_INFINITY}`,
  regex: '<insert regex>',
  text: '#000000',
  background: '#ffffff',
};

const none = () => ({});

/** The formats of the original, in the order it registers them */
export const FORMAT_TYPES: FormatType[] = [
  {
    id: 'date',
    title: 'Date',
    fieldTypes: ['date'],
    defaults: (setting) => ({ pattern: setting('dateFormat'), timezone: setting('dateFormat:tz') }),
  },
  {
    id: 'date_nanos',
    title: 'Date nanos',
    fieldTypes: ['date'],
    defaults: (setting) => ({
      pattern: setting('dateNanosFormat'),
      fallbackPattern: setting('dateFormat'),
      timezone: setting('dateFormat:tz'),
    }),
  },
  { id: 'boolean', title: 'Boolean', fieldTypes: ['boolean', 'number', 'string'], defaults: none },
  {
    id: 'bytes',
    title: 'Bytes',
    fieldTypes: ['number'],
    defaults: (setting) => ({ pattern: setting('format:bytes:defaultPattern') }),
  },
  {
    id: 'color',
    title: 'Color',
    fieldTypes: ['number', 'string'],
    defaults: () => ({ fieldType: null, colors: [{ ...DEFAULT_COLOR }] }),
  },
  {
    id: 'duration',
    title: 'Duration',
    fieldTypes: ['number'],
    defaults: () => ({ inputFormat: 'seconds', outputFormat: 'humanize', outputPrecision: 2 }),
  },
  { id: 'ip', title: 'IP address', fieldTypes: ['ip'], defaults: none },
  {
    id: 'number',
    title: 'Number',
    fieldTypes: ['number'],
    defaults: (setting) => ({ pattern: setting('format:number:defaultPattern') }),
  },
  {
    id: 'percent',
    title: 'Percentage',
    fieldTypes: ['number'],
    defaults: (setting) => ({ pattern: setting('format:percent:defaultPattern'), fractional: true }),
  },
  { id: 'relative_date', title: 'Relative date', fieldTypes: ['date'], defaults: none },
  { id: '_source', title: '_source', fieldTypes: ['_source'], defaults: none },
  {
    id: 'static_lookup',
    title: 'Static lookup',
    fieldTypes: ['string', 'number', 'ip', 'boolean'],
    defaults: () => ({ lookupEntries: [{}], unknownKeyValue: null }),
  },
  {
    id: 'string',
    title: 'String',
    fieldTypes: ['number', 'boolean', 'date', 'ip', 'attachment', 'geo_point', 'geo_shape', 'string', 'murmur3', 'unknown', 'conflict'],
    defaults: () => ({ transform: false }),
  },
  { id: 'truncate', title: 'Truncated string', fieldTypes: ['string'], defaults: none },
  {
    id: 'url',
    title: 'Url',
    fieldTypes: ['number', 'boolean', 'date', 'ip', 'string', 'murmur3', 'unknown', 'conflict'],
    defaults: () => ({ type: 'a', urlTemplate: null, labelTemplate: null, width: null, height: null }),
  },
];

export const formatType = (id: string | undefined) => FORMAT_TYPES.find((type) => type.id === id);

export const formatsForFieldType = (fieldType: string) =>
  FORMAT_TYPES.filter((type) => type.fieldTypes.includes(fieldType));

interface DefaultTypeMapEntry {
  id: string;
  params?: Record<string, unknown>;
  es?: boolean;
}

/** The format a field has when it was given none: format:defaultTypeMap, by its OpenSearch type first */
export function defaultFormatId(fieldType: string, esTypes: string[] | undefined, typeMap: unknown): string {
  const map = (typeof typeMap === 'string' ? parsed<Record<string, DefaultTypeMapEntry>>(typeMap, {}) : typeMap) as
    | Record<string, DefaultTypeMapEntry>
    | undefined;
  const byEsType = Array.isArray(esTypes) ? esTypes.find((type) => map?.[type]?.es) : undefined;
  const entry = map?.[byEsType ?? fieldType];
  return entry && typeof entry.id === 'string' ? entry.id : 'string';
}

/**
 * The meta parameters every format instance of the original is made with: where the page was
 * loaded. They are saved with each format, as the original saves them.
 */
export interface MetaParams {
  parsedUrl: { origin: string; pathname: string; basePath: string };
}

export function metaParamsOf(location: { origin: string; pathname: string }, basePath: string): MetaParams {
  return { parsedUrl: { origin: location.origin, pathname: location.pathname, basePath } };
}

/** An instance of a format, as the registry of the original makes one: meta parameters first */
export function formatInstance(id: string, params: Record<string, unknown> | null | undefined, meta: MetaParams): FormatInstance {
  return { id, params: { ...meta, ...(params ?? {}) } };
}

/** What a format saves: its id, and the parameters that differ from its defaults, if any; or as it was stored */
export function formatToJson(format: FormatInstance, setting: SettingReader): unknown {
  if (format.raw !== undefined) return format.raw;
  const defaults = formatType(format.id)?.defaults(setting) ?? {};
  const params: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(format.params)) {
    if (key && value !== defaults[key]) params[key] = value;
  }
  return Object.keys(params).length > 0 ? { id: format.id, params } : { id: format.id };
}

/**
 * The parameters a format editor is shown, as lodash's defaults makes them: the instance's own,
 * then each default the instance has no value for
 */
export function editorParamsOf(format: FormatInstance, setting: SettingReader): Record<string, unknown> {
  const params: Record<string, unknown> = { ...format.params };
  for (const [key, value] of Object.entries(formatType(format.id)?.defaults(setting) ?? {})) {
    if (params[key] === undefined) params[key] = value;
  }
  return params;
}

/** A parameter as a format reads it: an empty text or null is its default */
export const paramOf = (value: unknown, fallback: unknown) =>
  value || value === false || value === 0 ? value : fallback;

/** What a URL format's preview draws for a value: the HTML of the original, as parts */
export interface UrlSample {
  kind: 'link' | 'image' | 'audio' | 'text';
  url: string;
  label: string;
  href?: string;
  target?: string;
  alt?: string;
  maxWidth?: string;
  maxHeight?: string;
}

/**
 * The HTML the URL format writes, read as parts: a link made absolute from where the page was
 * loaded (the meta parameter parsedUrl), an image or a sound
 */
export function urlSampleOf(params: Record<string, unknown>, value: unknown): UrlSample {
  const { url, label } = urlParts(params, value);
  const type = paramOf(params.type, 'a');
  if (type === 'audio') return { kind: 'audio', url, label };
  if (type === 'img') {
    const size = (key: string) => {
      const parsedSize = parseInt(String(paramOf(params[key], null)), 10);
      return Number.isNaN(parsedSize) ? 'none' : `${parsedSize}px`;
    };
    return {
      kind: 'image',
      url,
      label,
      alt: label === url ? `A dynamically-specified image located at ${url}` : label,
      maxWidth: size('width'),
      maxHeight: size('height'),
    };
  }
  const parsedUrl = params.parsedUrl as Partial<MetaParams['parsedUrl']> | undefined;
  const allowed = ['http://', 'https://'].some((scheme) => url.indexOf(scheme) === 0);
  if (!allowed && !parsedUrl) return { kind: 'text', url, label: url };
  let prefix = '';
  if (!allowed && parsedUrl) {
    const { origin = '', pathname = '', basePath = '' } = parsedUrl;
    if (url[0] === '#') prefix = `${origin}${pathname}`;
    else if (url.indexOf(basePath || '/') === 0) prefix = origin;
    else prefix = `${origin}${basePath}/app${url[0] === '/' ? '' : '/'}`;
  }
  return {
    kind: 'link',
    url,
    label,
    href: `${prefix}${url}`,
    target: paramOf(params.openLinkInCurrentTab, undefined) ? '_self' : '_blank',
  };
}

/** The values each format editor of the original shows a preview of */
export function sampleInputsOf(formatId: string, params: Record<string, unknown>, now = new Date()): unknown[] {
  switch (formatId) {
    case 'number':
      return [10000, 12.345678, -1, -999, 0.52];
    case 'bytes':
      return [256, 1024, 5150000, 1990000000];
    case 'percent':
      return [0.1, 0.99999, 1, 100, 1000];
    case 'date':
      return [now.getTime(), new Date(now.getFullYear(), 0, 1).getTime(), new Date(now.getFullYear() + 1, 0, 1).getTime() - 1];
    case 'date_nanos':
      return ['2015-01-01T12:10:30.123456789Z', '2019-05-08T06:55:21.567891234Z', '2019-08-06T17:22:30.987654321Z'];
    case 'duration':
      return [-123, 1, 12, 123, 658, 1988, 3857, 123292, 923528271];
    case 'string':
      return [
        'A Quick Brown Fox.',
        'STAY CALM!',
        'com.organizations.project.ClassName',
        'hostname.net',
        'SGVsbG8gd29ybGQ=',
        '%EC%95%88%EB%85%95%20%ED%82%A4%EB%B0%94%EB%82%98',
      ];
    case 'truncate':
      return [TRUNCATE_SAMPLE];
    case 'url': {
      const byType: Record<string, unknown[]> = {
        a: ['john', '/some/pathname/asset.png', 1234],
        img: ['go', 'stop', ['de', 'ne', 'us', 'ni'], 'cv'],
        audio: ['hello.mp3'],
      };
      return byType[String(params.type)] ?? [];
    }
    default:
      return [];
  }
}

export const TRUNCATE_SAMPLE =
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Mauris vitae sem consequat, sollicitudin enim a, ' +
  'feugiat mi. Curabitur congue laoreet elit, eu dictum nisi commodo ut. Nullam congue sem a blandit commodo. ' +
  'Suspendisse eleifend sodales leo ac hendrerit. Nam fringilla tempor fermentum. Ut tristique pharetra sapien ' +
  'sit amet pharetra. Ut turpis massa, viverra id erat quis, fringilla vehicula risus. Cum sociis natoque ' +
  'penatibus et magnis dis parturient montes, nascetur ridiculus mus. Phasellus tincidunt gravida gravida. ' +
  'Praesent et ligula viverra, semper lacus in, tristique elit. Cras ac eleifend diam. Nulla facilisi. Morbi id ' +
  'sagittis magna. Sed fringilla, magna in suscipit aliquet.';

/** The icon a URL format of type image is first given: the pictures the original serves */
export const URL_ICON_PATTERN = '/plugins/indexPatternManagement/assets/icons/{{value}}.png';

// --- The saved object ------------------------------------------------------------------------------

/** The field as the original writes it, its keys in the original's order */
export function fieldToJson(field: FieldRecord): Record<string, unknown> {
  return {
    count: field.count || 0,
    script: field.script,
    lang: field.lang,
    conflictDescriptions: field.conflictDescriptions,
    name: field.name,
    type: field.name === '_source' ? '_source' : field.type,
    esTypes: field.esTypes,
    scripted: !!field.scripted,
    searchable: !!(field.searchable || field.scripted),
    aggregatable: !!(field.aggregatable || field.scripted),
    readFromDocValues: !!(field.readFromDocValues && !field.scripted),
    subType: field.subType,
  };
}

/**
 * What the original keeps of a pattern it read until the page is loaded again, and writes from:
 * the order of its formats, the cleared ones among them; the format each field was given; and the
 * formats it holds as they were given rather than as instances, which it writes back as they are
 */
export interface KeptPattern {
  formatOrder: string[];
  storedFormats: Record<string, unknown>;
  rawFormats: string[];
}

export function keptOf(pattern: ManagedPattern): KeptPattern {
  return {
    formatOrder: Object.keys(pattern.fieldFormatMap),
    storedFormats: { ...pattern.storedFormats },
    rawFormats: Object.entries(pattern.fieldFormatMap)
      .filter(([, format]) => format?.raw !== undefined)
      .map(([name]) => name),
  };
}

/**
 * The pattern as the original reads it; with `kept`, as it holds it still when the page read it
 * before and nobody wrote it since
 */
export function patternFromSavedObject(
  object: { id: string; version?: string; attributes: PatternAttributes; references?: SavedObjectReference[] },
  meta: MetaParams,
  setting: SettingReader,
  kept?: KeptPattern
): ManagedPattern {
  const { attributes } = object;
  const list = Array.isArray(attributes.fields) ? (attributes.fields as FieldRecord[]) : parsed<FieldRecord[]>(attributes.fields, []);
  // The fields by name, as the original keeps them in an object: one per name, the last of them in
  // the place of the first, and the names that are numbers first, in their order, as in any object
  const byName: Record<string, FieldRecord> = Object.create(null);
  const repeated = new Set<string>();
  for (const field of list) {
    if (field.name in byName) repeated.add(field.name);
    byName[field.name] = field.name === '_source' ? { ...field, type: '_source' } : field;
  }
  const fields = Object.values(byName);
  const stored = parsed<Record<string, unknown>>(attributes.fieldFormatMap, {});
  const fieldFormatMap: Record<string, FormatInstance | undefined> = {};
  let storedFormats: Record<string, unknown> = {};
  for (const name of kept?.formatOrder ?? []) fieldFormatMap[name] = undefined;
  // The original gives each format to its field and gathers them again from the fields, so they
  // come in the order of the fields. The format of a field the pattern does not have is dropped;
  // so is that of a name listed twice, which the original gives to the first of them and then
  // drops with it. One the registry does not know is kept as nothing, in its place.
  for (const { name } of fields) {
    if (repeated.has(name) || !Object.prototype.hasOwnProperty.call(stored, name)) continue;
    const mapping = stored[name];
    if (!mapping) continue;
    storedFormats[name] = mapping;
    const { id, params } = mapping as { id?: unknown; params?: Record<string, unknown> };
    fieldFormatMap[name] = typeof id === 'string' && formatType(id) ? formatInstance(id, params, meta) : undefined;
  }
  if (kept) {
    storedFormats = { ...kept.storedFormats };
    for (const name of kept.rawFormats) {
      const format = fieldFormatMap[name];
      if (format && storedFormats[name] !== undefined) fieldFormatMap[name] = { ...format, raw: storedFormats[name] };
    }
  }
  const pattern: ManagedPattern = {
    id: object.id,
    version: object.version,
    title: typeof attributes.title === 'string' ? attributes.title : '',
    displayName: storedText(attributes.displayName),
    description: storedText(attributes.description),
    signalType: storedText(attributes.signalType),
    timeFieldName: storedText(attributes.timeFieldName),
    intervalName: storedText(attributes.intervalName),
    sourceFilters: parsed<SourceFilter[] | undefined>(attributes.sourceFilters, undefined),
    fields,
    fieldFormatMap,
    storedFormats,
    type: storedText(attributes.type),
    typeMeta: parsed<unknown>(attributes.typeMeta, undefined),
    schemaMappings: parsed<unknown>(attributes.schemaMappings, undefined),
    references: object.references ?? [],
    originalBody: { title: '' },
  };
  pattern.originalBody = savedBodyOf(pattern, setting);
  return pattern;
}

/** The attributes the original writes for an index pattern, in its order; undefined is left out */
export function savedBodyOf(pattern: ManagedPattern, setting: SettingReader): SavedBody {
  const formats: Record<string, unknown> = {};
  for (const [name, format] of Object.entries(pattern.fieldFormatMap)) {
    if (format && name) formats[name] = formatToJson(format, setting);
  }
  return {
    title: pattern.title,
    displayName: pattern.displayName,
    description: pattern.description,
    signalType: pattern.signalType,
    timeFieldName: pattern.timeFieldName,
    intervalName: pattern.intervalName,
    sourceFilters: pattern.sourceFilters ? JSON.stringify(pattern.sourceFilters) : undefined,
    fields: JSON.stringify(pattern.fields.map(fieldToJson)),
    fieldFormatMap: Object.keys(formats).length > 0 ? JSON.stringify(formats) : undefined,
    type: pattern.type,
    typeMeta: pattern.typeMeta ? JSON.stringify(pattern.typeMeta) : undefined,
    schemaMappings: pattern.schemaMappings ? JSON.stringify(pattern.schemaMappings) : undefined,
  };
}

/** The keys a save changed, and those someone else changed meanwhile: a conflict when they meet */
export function conflictingKeys(original: SavedBody, mine: SavedBody, theirs: SavedBody) {
  const keys = Object.keys({ ...original, ...mine, ...theirs }) as Array<keyof SavedBody>;
  const changedHere = keys.filter((key) => mine[key] !== original[key]);
  const changedThere = keys.filter((key) => theirs[key] !== mine[key] && theirs[key] !== original[key]);
  return { changedHere, changedThere, collision: changedHere.some((key) => changedThere.includes(key)) };
}

// --- The page of an index pattern -------------------------------------------------------------------

export const TAB_INDEXED_FIELDS = 'indexedFields';
export const TAB_SCRIPTED_FIELDS = 'scriptedFields';
export const TAB_SOURCE_FILTERS = 'sourceFilters';

const includesText = (value: string, filter: string) => value.toLowerCase().includes(filter.toLowerCase());

function counts(pattern: ManagedPattern, filter: string) {
  const fields = pattern.fields.filter((field) => includesText(field.name, filter));
  return {
    indexed: fields.filter((field) => !field.scripted).length,
    scripted: fields.filter((field) => field.scripted).length,
    sourceFilters: (pattern.sourceFilters ?? []).filter((source) => includesText(String(source.value), filter)).length,
  };
}

/** The tabs, with their counts: "Fields (12 / 40)" when the search keeps some of them */
export function tabsOf(pattern: ManagedPattern, filter: string) {
  const total = counts(pattern, '');
  const kept = counts(pattern, filter);
  const title = (name: string, key: keyof typeof total) =>
    `${name} (${kept[key] === total[key] ? kept[key] : `${kept[key]} / ${total[key]}`})`;
  return [
    { id: TAB_INDEXED_FIELDS, name: title('Fields', 'indexed') },
    { id: TAB_SCRIPTED_FIELDS, name: title('Scripted fields', 'scripted') },
    { id: TAB_SOURCE_FILTERS, name: title('Source filters', 'sourceFilters') },
  ];
}

/** The options of a filter select: the first one keeps every row; one option per value */
export function filterOptions(values: string[], everything: string) {
  const unique = [...new Set(values)];
  return values.length > 0 ? [{ value: '', text: everything }, ...unique.map((value) => ({ value, text: value }))] : [];
}

/** Whether a field name is matched by source filters: `*` stands for anything; meta fields never */
export function fieldWildcardMatcher(globs: string[], metaFields: string[] = []) {
  const expressions = globs.map(
    (glob) => new RegExp(`^${glob.split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`)
  );
  return (name: string) => !metaFields.includes(name) && expressions.some((expression) => expression.test(`${name}`));
}

/** The address of a field's editor: the name as it is, as the original pushes it */
export const fieldPath = (patternId: string, fieldName: string) => `/patterns/${patternId}/field/${fieldName}`;

/** The languages of scripted fields the original supports; any other is deprecated */
export const SUPPORTED_SCRIPTING_LANGUAGES = ['painless'];
export const FIELD_TYPES_BY_LANG: Record<string, string[]> = {
  painless: ['number', 'string', 'date', 'boolean'],
  expression: ['number'],
};
export const OSD_FIELD_TYPES = [
  'string',
  'number',
  'date',
  'ip',
  'boolean',
  'object',
  'nested',
  'geo_point',
  'geo_shape',
  'attachment',
  'murmur3',
  '_source',
  'histogram',
  'conflict',
  'unknown',
];

// --- The list -------------------------------------------------------------------------------------------

export interface PatternListItem {
  id: string;
  title: string;
  default: boolean;
  tags: Array<{ key: string; name: string }>;
  referenceId?: string;
  sort: string;
  [other: string]: unknown;
}

export function listItemsOf(
  objects: Array<{ id: string; attributes: PatternAttributes; references?: SavedObjectReference[] }>,
  defaultId: string | undefined
): PatternListItem[] {
  return objects
    .map((object) => {
      const isDefault = object.id === defaultId;
      const title = (optionalText(object.attributes.displayName) ?? object.attributes.title ?? '') as string;
      return {
        id: object.id,
        title,
        default: isDefault,
        tags: isDefault ? [{ key: 'default', name: 'Default' }] : [],
        referenceId: Array.isArray(object.references) ? object.references[0]?.id : undefined,
        sort: `${isDefault ? '0' : '1'}${title}`,
      };
    })
    .sort((a, b) => (a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0));
}

// --- The wizard ---------------------------------------------------------------------------------------

export const ILLEGAL_CHARACTERS_VISIBLE = ['\\', '/', '?', '"', '<', '>', '|'];
export const ILLEGAL_CHARACTERS = [...ILLEGAL_CHARACTERS_VISIBLE, ' '];
export const MAX_NUMBER_OF_MATCHING_INDICES = 100;

export const containsIllegalCharacters = (pattern: string, characters: string[]) =>
  characters.some((character) => pattern.includes(character));

/** Whether a key typed into an empty box is followed by a `*`: one letter or digit */
export const canAppendWildcard = (key: string) => !!key && key.length === 1 && /[a-z0-9]/i.test(key);

export interface MatchedItem {
  name: string;
  tags: Array<{ key: string; name: string; color: string }>;
  /** A data stream's time field */
  timestampField?: string;
}

export interface ResolveResponse {
  indices?: Array<{ name: string; attributes?: string[] }>;
  aliases?: Array<{ name: string }>;
  data_streams?: Array<{ name: string; timestamp_field?: string }>;
}

/**
 * The indices, aliases and data streams a request for them answers; none when it fails, as the
 * original swallows such a failure: typing `.` or `<` into the wizard warns of nothing
 */
export async function resolvedOrNone(request: Promise<ResolveResponse | undefined>): Promise<MatchedItem[]> {
  try {
    return resolvedItems(await request);
  } catch {
    return [];
  }
}

/** The indices, aliases and data streams of a resolve, by name */
export function resolvedItems(response: ResolveResponse | undefined): MatchedItem[] {
  if (!response) return [];
  const items: MatchedItem[] = [];
  for (const index of response.indices ?? []) {
    const tags = [{ key: 'index', name: 'Index', color: 'default' }];
    if ((index.attributes ?? []).includes('frozen')) tags.push({ name: 'Frozen', key: 'frozen', color: 'danger' });
    items.push({ name: index.name, tags });
  }
  for (const alias of response.aliases ?? []) {
    items.push({ name: alias.name, tags: [{ key: 'alias', name: 'Alias', color: 'default' }] });
  }
  for (const stream of response.data_streams ?? []) {
    items.push({
      name: stream.name,
      tags: [{ key: 'data_stream', name: 'Data stream', color: 'primary' }],
      timestampField: stream.timestamp_field,
    });
  }
  // lodash sortBy: stable, by the names' order as text
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => (a.item.name < b.item.name ? -1 : a.item.name > b.item.name ? 1 : a.index - b.index))
    .map(({ item }) => item);
}

const isSystemIndex = (name: string): boolean =>
  name.startsWith('.') || (name.includes(':') && name.split(':').some((part) => isSystemIndex(part)));

function withoutSystemIndices(items: MatchedItem[], includingSystem: boolean) {
  return (includingSystem ? items : items.filter((item) => !isSystemIndex(item.name))).slice(
    0,
    MAX_NUMBER_OF_MATCHING_INDICES
  );
}

/** What the wizard shows: the exact matches, else those of the pattern with a `*`, else all */
export function matchedIndicesOf(
  all: MatchedItem[],
  partial: MatchedItem[],
  exact: MatchedItem[],
  includingSystem = false
) {
  const allIndices = withoutSystemIndices(all, includingSystem);
  const partialMatchedIndices = withoutSystemIndices(partial, includingSystem);
  const exactMatchedIndices = withoutSystemIndices(exact, includingSystem);
  const visibleIndices = exactMatchedIndices.length
    ? exactMatchedIndices
    : partialMatchedIndices.length
      ? partialMatchedIndices
      : allIndices;
  return { allIndices, exactMatchedIndices, partialMatchedIndices, visibleIndices };
}

export interface TimeFieldOption {
  display: string;
  fieldName?: string;
  isDisabled?: boolean;
}

export function timeFieldOptions(fields: Array<{ name: string; type: string }>): TimeFieldOption[] {
  const dates = fields.filter((field) => field.type === 'date');
  if (dates.length === 0) {
    return [{ display: "The indices which match this index pattern don't contain any time fields." }];
  }
  return [
    ...dates.map((field) => ({ display: field.name, fieldName: field.name })),
    { isDisabled: true, display: '───', fieldName: '' },
    { display: "I don't want to use the time filter", fieldName: undefined },
  ];
}

/**
 * The value of an option of the time field select, as the original's select gives it: the name of
 * its field, or its text when it has none, as "I don't want to use the time filter" has
 */
export const timeFieldOptionValue = (option: TimeFieldOption) => option.fieldName ?? option.display;

/** What a value of the select means: its field, and whether it is a choice at all (the empty value is none) */
export function timeFieldChoice(options: TimeFieldOption[], value: string) {
  const field = options.find((candidate) => candidate.fieldName === value);
  return { fieldName: field ? field.fieldName : undefined, chosen: value !== '' };
}

/** The time field chosen beforehand: when every match is a data stream with the same one */
export function preselectedTimeField(items: MatchedItem[]): string | undefined {
  let canPreselect = true;
  let timeFieldName: string | undefined;
  for (const item of items) {
    const field = item.timestampField;
    canPreselect = canPreselect && !!field && (timeFieldName === undefined || timeFieldName === field);
    timeFieldName = field || timeFieldName;
  }
  return canPreselect ? timeFieldName : undefined;
}

/** Waits at least 305 ms, as the original does, so that a quick answer does not flicker */
export async function ensureMinimumTime<T>(work: Promise<T>, minimumMs = 300): Promise<T> {
  const started = Date.now();
  const result = await work;
  const took = Date.now() - started;
  if (took < minimumMs + 5) await new Promise((resolve) => setTimeout(resolve, minimumMs + 5 - took));
  return result;
}

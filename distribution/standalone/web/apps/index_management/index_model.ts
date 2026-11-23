/* SPDX-License-Identifier: Apache-2.0 */

/*
 * What an index is made of while a form edits it: its settings written flat, its mappings as a
 * list of fields the visual editor can show, and what has to be sent to turn the index that is
 * there into the one the form describes.
 */

import { INDEX_NAMING_PATTERN, matchesAny } from './model';

// --- Mappings ----------------------------------------------------------------------------------------

interface TypeOption {
  label: string;
  name: string;
  /** What the field starts as when its kind is chosen */
  initValue?: string;
  required: string;
}

export interface MappingType {
  label: string;
  hasChildren?: boolean;
  /** What a field of this kind says beside its name and kind */
  fields?: TypeOption[];
}

export const MAPPING_TYPES: MappingType[] = [
  { label: 'alias', fields: [{ label: 'Path', name: 'path', required: 'Path is required.' }] },
  { label: 'boolean' },
  { label: 'binary' },
  { label: 'completion' },
  { label: 'date' },
  { label: 'date_range' },
  { label: 'double' },
  { label: 'double_range' },
  { label: 'float' },
  { label: 'geo_point' },
  { label: 'geo_shape' },
  { label: 'half_float' },
  { label: 'integer' },
  { label: 'ip' },
  { label: 'ip_range' },
  { label: 'keyword' },
  { label: 'long' },
  { label: 'long_range' },
  { label: 'object', hasChildren: true },
  { label: 'percolator' },
  { label: 'rank_feature' },
  { label: 'rank_features' },
  { label: 'search_as_you_type' },
  { label: 'text' },
  {
    label: 'token_count',
    fields: [{ label: 'Analyzer', name: 'analyzer', initValue: 'standard', required: 'Analyzer is required.' }],
  },
];

export const mappingType = (type: string): MappingType | undefined =>
  MAPPING_TYPES.find((item) => item.label === type);

/** A field of the mappings as the editor holds it: its name beside what the mappings say of it */
export interface MappingField {
  fieldName: string;
  type: string;
  properties?: MappingField[];
  [setting: string]: unknown;
}

/** The mappings of an index with their properties as a list */
export interface Mappings {
  properties?: MappingField[];
  [setting: string]: unknown;
}

type Properties = Record<string, Record<string, unknown>>;

const isObject = (value: unknown): value is Record<string, unknown> =>
  Object.prototype.toString.call(value) === '[object Object]';

/** The properties of mappings as the list the editor shows; a field that names no kind is an object */
export function fieldsOf(properties: unknown): MappingField[] {
  if (!isObject(properties)) return [];
  return Object.entries(properties).map(([fieldName, settings]) => {
    const { properties: inner, type, ...others } = isObject(settings) ? settings : {};
    const field: MappingField = { ...others, type: typeof type === 'string' && type ? type : 'object', fieldName };
    if (inner) field.properties = fieldsOf(inner);
    return field;
  });
}

/** The list of the editor as the properties OpenSearch takes */
export function propertiesOf(fields: MappingField[]): Properties {
  const properties: Properties = {};
  for (const { fieldName, properties: inner, type, ...others } of fields) {
    properties[fieldName] = { ...others, type: type || 'object' };
    if (inner) properties[fieldName].properties = propertiesOf(inner);
  }
  return properties;
}

/** Mappings as OpenSearch takes them */
export const remoteMappings = (mappings: Mappings | undefined): Record<string, unknown> => ({
  ...mappings,
  properties: propertiesOf(mappings?.properties ?? []),
});

/** Mappings as the editor holds them */
export const localMappings = (mappings: unknown): Mappings => {
  const all = isObject(mappings) ? mappings : {};
  return { ...all, properties: fieldsOf(all.properties) };
};

export function countFields(fields: MappingField[]): number {
  return fields.reduce((total, field) => total + 1 + (field.properties ? countFields(field.properties) : 0), 0);
}

function fieldIsPlain(value: unknown): boolean {
  if (!isObject(value) || typeof value.type !== 'string' || !value.type) return false;
  const kind = mappingType(value.type);
  if (!kind) return false;
  const allowed = new Set(['type', ...(kind.fields ?? []).map((field) => field.name)]);
  if (kind.hasChildren) allowed.add('properties');
  if (Object.keys(value).some((key) => !allowed.has(key))) return false;
  for (const field of kind.fields ?? []) {
    if (Object.hasOwn(value, field.name) && typeof value[field.name] !== 'string') return false;
  }
  if (kind.hasChildren && Object.hasOwn(value, 'properties')) {
    if (!isObject(value.properties)) return false;
    return Object.values(value.properties).every(fieldIsPlain);
  }
  return true;
}

/** Whether the visual editor shows all there is to the fields: only kinds and settings it knows */
export function fieldsArePlain(fields: MappingField[]): boolean {
  return Object.values(propertiesOf(fields)).every(fieldIsPlain);
}

/** A list of fields with one of them, or the list inside one of them, replaced */
export function withFields(
  fields: MappingField[],
  path: number[],
  change: (inner: MappingField[]) => MappingField[]
): MappingField[] {
  if (path.length === 0) return change(fields);
  const [first, ...rest] = path;
  return fields.map((field, index) =>
    index === first ? { ...field, properties: withFields(field.properties ?? [], rest, change) } : field
  );
}

/** The field at a place of the list, counted from the top through the fields inside fields */
export function fieldAt(fields: MappingField[] | undefined, path: number[]): MappingField | undefined {
  let found: MappingField | undefined;
  let inside = fields;
  for (const index of path) {
    found = inside?.[index];
    inside = found?.properties;
  }
  return found;
}

/** A field with its kind changed: what the old kind said goes, what the new one starts with comes */
export function withType(field: MappingField, type: string): MappingField {
  const next: MappingField = { fieldName: field.fieldName, type };
  for (const option of mappingType(type)?.fields ?? []) {
    if (option.initValue !== undefined) next[option.name] = option.initValue;
  }
  return next;
}

/** What is wrong with a field, by the name of the part that is wrong */
export function fieldErrors(field: MappingField, before: MappingField[]): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!field.fieldName) errors.fieldName = 'Field name is required, please input';
  else if (before.some((other) => other.fieldName === field.fieldName)) {
    errors.fieldName = `Duplicate field name [${field.fieldName}], please change your field name`;
  }
  for (const option of mappingType(field.type)?.fields ?? []) {
    if (!field[option.name]) errors[option.name] = option.required;
  }
  return errors;
}

/** Whether any field that can still be edited has something wrong with it */
export function fieldsHaveErrors(fields: MappingField[], old: MappingField[] | undefined, isEdit: boolean): boolean {
  return fields.some((field, index) => {
    const existing = isEdit ? old?.[index] : undefined;
    if (!existing && Object.keys(fieldErrors(field, fields.slice(0, index))).length > 0) return true;
    return field.properties ? fieldsHaveErrors(field.properties, existing?.properties, isEdit) : false;
  });
}

// --- Settings ----------------------------------------------------------------------------------------

/** Settings written flat: `{index: {number_of_shards: 1}}` as `{"index.number_of_shards": 1}`; lists stay lists */
export function flatten(value: unknown, prefix = '', into: Record<string, unknown> = {}): Record<string, unknown> {
  if (!isObject(value)) return into;
  for (const [key, inner] of Object.entries(value)) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (isObject(inner) && Object.keys(inner).length > 0) flatten(inner, name, into);
    else into[name] = inner;
  }
  return into;
}

/**
 * What is typed in one of the JSON editors of the forms, when it is a JSON object: settings and mappings
 * are objects, so a list or a single value is refused as text that is not JSON is.
 */
export function parsedObject(text: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    return isObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** An object with its keys in the order of the alphabet */
export function ordered<T>(value: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => (left < right ? -1 : 1)));
}

/** The settings that can be changed while an index is open */
export const INDEX_DYNAMIC_SETTINGS = [
  'index.number_of_replicas',
  'index.auto_expand_replicas',
  'index.search.idle.after',
  'index.refresh_interval',
  'index.max_result_window',
  'index.max_inner_result_window',
  'index.max_rescore_window',
  'index.max_docvalue_fields_search',
  'index.max_script_fields',
  'index.max_ngram_diff',
  'index.max_shingle_diff',
  'index.max_refresh_listeners',
  'index.analyze.max_token_count',
  'index.highlight.max_analyzed_offset',
  'index.max_terms_count',
  'index.max_regex_length',
  'index.query.default_field',
  'index.routing.allocation.enable',
  'index.gc_deletes',
  'index.default_pipeline',
  'index.final_pipeline',
  'index.hidden',
];

/** The settings another index gives when its settings are imported */
export const INDEX_IMPORT_SETTINGS = ['index.number_of_replicas', 'index.number_of_shards', 'index.refresh_interval'];

const same = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);

/** The settings that are new or changed, which are the ones to send */
export function changedSettings(
  now: Record<string, unknown>,
  before: Record<string, unknown>
): Record<string, unknown> {
  const changed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(now)) {
    if (value !== undefined && !(key in before && same(before[key], value))) changed[key] = value;
  }
  return changed;
}

export function shardsError(value: unknown): string | undefined {
  if (value === undefined || value === '') return undefined;
  if (Number(value) < 1) return 'Number of primary shards cannot be smaller than 1.';
  if (Number(value) !== parseInt(String(value), 10)) return 'Number of primary shards must be an integer.';
  return undefined;
}

export function replicasError(value: unknown): string | undefined {
  if (value === undefined || value === '') return undefined;
  if (Number(value) < 0) return 'Number of replicas cannot be smaller than 0.';
  if (Number(value) !== parseInt(String(value), 10)) return 'Number of replicas must be an integer.';
  return undefined;
}

// --- An index as a whole -------------------------------------------------------------------------------

export interface IndexItem {
  index: string;
  aliases?: Record<string, Record<string, unknown>>;
  settings?: Record<string, unknown>;
  mappings?: Mappings;
  data_stream?: string;
  [more: string]: unknown;
}

export const defaultIndex = (): IndexItem => ({
  index: '',
  settings: { 'index.number_of_shards': 1, 'index.number_of_replicas': 1, 'index.refresh_interval': '1s' },
  mappings: {},
});

/**
 * How many things differ between what was and what is: every value that is new or changed, and
 * every key that is gone. The bar of unsaved changes shows this number.
 */
export function countChanges(before: unknown, now: unknown): number {
  const old = isObject(before) ? before : undefined;
  const oldKeys = Object.keys(old ?? {});
  let changed = 0;
  for (const [key, value] of Object.entries(isObject(now) ? now : {})) {
    if (isObject(value)) changed += countChanges(old?.[key], value);
    else changed += same(old?.[key], value) ? 0 : 1;
    const found = oldKeys.indexOf(key);
    if (found > -1) oldKeys.splice(found, 1);
  }
  const fromNothing = (before === undefined || before === null) && changed === 0 && now ? 1 : 0;
  return fromNothing + changed + oldKeys.length;
}

/** What turns the aliases an index had into the ones it is to have */
export function indexAliasActions(before: string[], after: string[], index: string) {
  return [
    ...before.filter((alias) => !after.includes(alias)).map((alias) => ({ remove: { index, alias } })),
    ...after.filter((alias) => !before.includes(alias)).map((alias) => ({ add: { index, alias } })),
  ];
}

/** The fields at the top that the index does not have yet: the only ones that can be added to it */
export function addedFields(now: MappingField[], before: MappingField[]): MappingField[] {
  const known = new Set(before.map((field) => field.fieldName));
  return now.filter((field, index) => index >= before.length && !known.has(field.fieldName));
}

function lineOf(pattern: RegExp, text: string): number {
  const found = pattern.exec(text);
  const start = found?.indices?.[1]?.[0];
  return start === undefined ? 0 : text.slice(0, start).split('\n').length;
}

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * What to say when OpenSearch refuses the mappings: where it names a parameter or a kind it
 * does not know, the line of the JSON editor that has it.
 */
export function mappingErrorMessage(error: string, editorText: string): string {
  const parameter = /\[mapper_parsing_exception\] unknown parameter \[([^\]]+)\] on mapper \[([^\]]+)\] of type \[([^\]]+)\]/.exec(error);
  if (parameter) {
    const line = lineOf(
      new RegExp(`"${escaped(parameter[2])}":\\s*\\{[\\S\\s]*("${escaped(parameter[1])}"\\s*:)[\\S\\s]*\\}`, 'd'),
      editorText
    );
    if (line) return `There is a problem with the index mapping syntax. Unknown parameter "${parameter[1]}" on line ${line}.`;
  }
  const kind = /\[mapper_parsing_exception\] No handler for type \[([^\]]+)\] declared on field \[([^\]]+)\]/.exec(error);
  if (kind) {
    const line = lineOf(
      new RegExp(`"${escaped(kind[2])}":\\s*\\{[\\S\\s]*("type":\\s*"${escaped(kind[1])}"\\s*)[\\S\\s]*\\}`, 'd'),
      editorText
    );
    if (line) return `There is a problem with the index mapping syntax. Unsupported type "${kind[1]}" on line ${line}.`;
  }
  return error;
}

/** A new index that takes the mapping, and the settings that can be taken, of an index there is */
export function importedIndex(found: Record<string, unknown>, index: string): IndexItem {
  const kept = { ...found };
  delete kept.aliases;
  delete kept.data_stream;
  const from = isObject(found.settings) ? found.settings : {};
  const settings: Record<string, unknown> = {};
  for (const name of INDEX_IMPORT_SETTINGS) {
    if (name in from) settings[name] = from[name];
  }
  return { ...kept, index, settings, mappings: localMappings(found.mappings) };
}

/** What a template says an index of a name would get, as the form holds an index */
export function simulatedIndex(template: unknown, index: string): IndexItem {
  const all = isObject(template) ? template : {};
  return {
    ...all,
    index,
    settings: flatten(all.settings),
    mappings: localMappings(all.mappings),
  } as IndexItem;
}

/** What the form has merged over what the matching templates give */
export function mergedWithTemplate(template: IndexItem, mine: IndexItem): IndexItem {
  const fields = new Map<string, MappingField>();
  for (const field of [...(template.mappings?.properties ?? []), ...(mine.mappings?.properties ?? [])]) {
    fields.set(field.fieldName, { ...fields.get(field.fieldName), ...field });
  }
  return {
    ...template,
    ...mine,
    aliases: { ...template.aliases, ...mine.aliases },
    settings: { ...template.settings, ...mine.settings },
    mappings: { ...template.mappings, ...mine.mappings, properties: [...fields.values()] },
  };
}

// --- Templates -----------------------------------------------------------------------------------------

/** What a template gives an index: the same three things an index is made of */
export interface TemplateBody {
  aliases?: Record<string, Record<string, unknown>>;
  settings?: Record<string, unknown>;
  mappings?: Mappings;
}

/** How a template is defined: by itself, or by the component templates it is composed of */
export type Flow = 'simple' | 'components';

export interface TemplateItem {
  name?: string;
  index_patterns?: string[];
  priority?: number | string;
  data_stream?: { timestamp_field?: { name: string } };
  composed_of?: string[];
  template: TemplateBody;
  _meta?: Record<string, unknown> & { flow?: Flow };
  [more: string]: unknown;
}

export const newTemplate = (): TemplateItem => ({ priority: 0, template: {}, _meta: { flow: 'simple' } });

function merged(into: Record<string, unknown>, from: Record<string, unknown>): Record<string, unknown> {
  const result = { ...into };
  for (const [key, value] of Object.entries(from)) {
    const before = result[key];
    result[key] = isObject(value) && isObject(before) ? merged(before, value) : value;
  }
  return result;
}

/** A template that is new but for what the address of its page asks it to start with, written as JSON */
export function presetTemplate(values: string | undefined): TemplateItem {
  let preset: unknown;
  try {
    preset = values ? JSON.parse(values) : undefined;
  } catch {
    preset = undefined;
  }
  return isObject(preset) ? (merged(newTemplate(), preset) as TemplateItem) : newTemplate();
}

const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Whether mappings name fields, which is when the two shapes of them differ */
const hasFields = (mappings: unknown): boolean => isObject(mappings) && Boolean(mappings.properties);

function localBody(body: unknown): TemplateBody {
  const all = isObject(body) ? body : {};
  const local: TemplateBody = { ...all };
  if (hasFields(all.mappings)) local.mappings = localMappings(all.mappings);
  if (all.settings) local.settings = flatten(all.settings);
  return local;
}

/** A template's body as OpenSearch takes it: mappings that were never given are not sent as empty ones */
function remoteBody(body: TemplateBody | undefined): Record<string, unknown> {
  if (!body || !hasFields(body.mappings)) return { ...body };
  return { ...body, mappings: remoteMappings(body.mappings) };
}

/** An index template as OpenSearch gives it, as the form holds it */
export function localTemplate(remote: unknown, name: string | undefined): TemplateItem {
  const all = isObject(remote) ? remote : {};
  const meta = isObject(all._meta) ? all._meta : {};
  const composed = Array.isArray(all.composed_of) ? (all.composed_of as string[]) : undefined;
  const flow: Flow = composed?.length ? 'components' : meta.flow === 'components' ? 'components' : 'simple';
  return copy({
    ...all,
    name,
    priority: all.priority === undefined ? undefined : `${all.priority as number}`,
    template: localBody(all.template),
    _meta: { ...meta, flow },
  }) as TemplateItem;
}

/** What is sent to save an index template; a template defined by itself is composed of nothing */
export function remoteTemplate(item: TemplateItem): Record<string, unknown> {
  const { name: _name, _meta, ...others } = item;
  return {
    ...others,
    composed_of: _meta?.flow === 'components' ? (others.composed_of ?? []) : [],
    _meta,
    template: remoteBody(others.template),
  };
}

/** What is sent to ask what the template would give an index, without matching any index that exists */
export function simulatedTemplateBody(item: TemplateItem, now: number): Record<string, unknown> {
  return remoteTemplate({
    ...item,
    index_patterns: [`a_pattern_that_will_never_be_matched_for_simulate_template_${now}`],
    priority: 500,
  });
}

/** A template in the shape two of them are compared in */
export function comparableTemplate(item: TemplateItem | undefined): Record<string, unknown> {
  if (!item) return {};
  return { ...item, template: remoteBody(item.template) };
}

export function priorityError(value: unknown): string | undefined {
  if (value === undefined || value === '') return undefined;
  if (Number(value) < 0) return 'Priority cannot be smaller than 0.';
  if (Number(value) !== parseInt(String(value), 10)) return 'Priority must be an integer.';
  return undefined;
}

/** What is wrong with the settings a template gives, by the name of the setting */
export function templateSettingsErrors(settings: Record<string, unknown> | undefined): Record<string, string> {
  const errors: Record<string, string> = {};
  const shards = settings?.['index.number_of_shards'];
  const replicas = settings?.['index.number_of_replicas'];
  if (shards !== undefined && shards !== '') {
    if (Number(shards) < 1) errors['index.number_of_shards'] = 'Number of shards cannot be smaller than 1.';
    else if (Number(shards) !== parseInt(String(shards), 10)) {
      errors['index.number_of_shards'] = 'Number of primary shards must be an integer.';
    }
  }
  if (replicas !== undefined && replicas !== '') {
    if (Number(replicas) < 0) errors['index.number_of_replicas'] = 'Number of replicas cannot be smaller than 0.';
    else if (Number(replicas) !== parseInt(String(replicas), 10)) {
      errors['index.number_of_replicas'] = 'Number of replicas must be an integer';
    }
  }
  return errors;
}

export type Part = 'aliases' | 'settings' | 'mappings';
export const PARTS: Part[] = ['aliases', 'settings', 'mappings'];

export interface ComponentItem {
  name?: string;
  template: TemplateBody;
  _meta?: Record<string, unknown> & { description?: string };
  /** The parts of the template the component says something about */
  includes?: Partial<Record<Part, boolean>>;
  [more: string]: unknown;
}

/** A component template as OpenSearch gives it, as the form holds it */
export function localComponent(remote: unknown, name: string): ComponentItem {
  const all = isObject(remote) ? remote : {};
  const template = isObject(all.template) ? all.template : {};
  return copy({
    ...all,
    name,
    template: localBody(template),
    includes: { aliases: Boolean(template.aliases), settings: Boolean(template.settings), mappings: Boolean(template.mappings) },
  }) as ComponentItem;
}

/** A component template with only the parts it is switched on for */
export function includedComponent(item: ComponentItem): ComponentItem {
  const { includes, template, ...others } = item;
  const kept: TemplateBody = {};
  if (includes?.aliases) kept.aliases = template?.aliases;
  if (includes?.mappings) kept.mappings = template?.mappings;
  if (includes?.settings) kept.settings = template?.settings;
  return { ...others, template: kept };
}

/** What is sent to save a component template */
export function remoteComponent(item: ComponentItem): Record<string, unknown> {
  const { name: _name, template, ...others } = includedComponent(item);
  return { ...others, template: remoteBody(template) };
}

/** A component template in the shape two of them are compared in */
export function comparableComponent(item: ComponentItem | undefined): Record<string, unknown> {
  if (!item) return {};
  const { name: _name, template, ...others } = includedComponent(item);
  return { ...others, template: remoteBody(template) };
}

// --- Data streams ----------------------------------------------------------------------------------------

/** An index template that data streams are made from, as OpenSearch lists it */
export interface StreamTemplate {
  name: string;
  index_template: {
    index_patterns?: string[];
    priority?: number;
    data_stream?: unknown;
    template?: Record<string, unknown>;
  };
}

// The weightiest first; templates without a priority keep no particular order among themselves
const byPriority = (left: StreamTemplate, right: StreamTemplate) =>
  (left.index_template.priority as number) > (right.index_template.priority as number) ? -1 : 1;

const patternsOf = (template: StreamTemplate) => template.index_template.index_patterns ?? [];

/** Whether a pattern reads like what was typed, which is taken as an expression as the plugin does */
function resembles(pattern: string, typed: string): boolean {
  try {
    return new RegExp(typed, 'i').test(pattern);
  } catch {
    return false;
  }
}

const fits = (name: string, pattern: string) => name !== '' && matchesAny(name, [pattern]);

/** The templates a name that is being typed may come to match: all of them while there is no name */
export function suggestedTemplates(name: string, templates: StreamTemplate[]): StreamTemplate[] {
  return templates
    .filter(
      (template) =>
        !name || patternsOf(template).some((pattern) => resembles(pattern, name) || fits(name, pattern))
    )
    .sort(byPriority);
}

/** The template a data stream of that name is made from: the weightiest one with a pattern for it */
export function matchingTemplate(name: string, templates: StreamTemplate[]): StreamTemplate | undefined {
  return [...templates]
    .sort(byPriority)
    .find((template) => patternsOf(template).some((pattern) => fits(name, pattern) || pattern === name));
}

/**
 * The name the field holds once a template is picked from its list: what was typed when the
 * template is for it, and otherwise the start of the pattern that reads like it.
 */
export function nameForTemplate(typed: string, template: StreamTemplate): string {
  const patterns = patternsOf(template);
  if (patterns.some((pattern) => fits(typed, pattern))) return typed;
  const like = patterns.find((pattern) => resembles(pattern, typed));
  return like === undefined ? typed : like.replace(/^([^*]*).*$/, '$1');
}

/** What a data stream gets from its template, as the page shows it */
export function inheritedBody(template: StreamTemplate): TemplateBody {
  const body = copy(template.index_template.template ?? {});
  return { ...body, settings: flatten(body.settings ?? {}), mappings: localMappings(body.mappings) };
}

/**
 * What is wrong with the name of an alias, as the plugin's dialog says it: one sentence whatever is
 * wrong, an empty name too (its rule tests the empty text against the naming pattern)
 */
export const aliasNameError = (name: string | undefined): string | undefined =>
  INDEX_NAMING_PATTERN.test(name || '') ? undefined : 'Invalid alias name.';

/** An alias needs one index or pattern at least */
export const aliasIndexesError = (indexes: string[] | undefined): string | undefined =>
  indexes && indexes.length > 0 ? undefined : 'At least one index should be selected.';

/** What is wrong with the name of a data stream that is to be created */
export function dataStreamNameErrors(name: string, matched: boolean): string[] {
  const errors: string[] = [];
  if (!INDEX_NAMING_PATTERN.test(name)) errors.push('Invalid data stream name.');
  if (!matched) errors.push(`No matching index template found for data stream [${name}]`);
  return errors;
}

/** The index templates each component template is part of, in the order the templates come */
export function componentUsers(templates: Array<{ name: string; composed_of?: string[] }>): Map<string, string[]> {
  const users = new Map<string, string[]>();
  for (const template of templates) {
    for (const component of template.composed_of ?? []) {
      users.set(component, [...(users.get(component) ?? []), template.name]);
    }
  }
  return users;
}

/** The value at a dotted path, or the fallback where there is none, as lodash's `get` reads it */
export function valueAt(item: unknown, path: string, fallback: unknown): unknown {
  let value = item;
  for (const key of path.split('.')) {
    if (value === null || value === undefined) return fallback;
    value = (value as Record<string, unknown>)[key];
  }
  return value === undefined ? fallback : value;
}

/** Whether `left < right` holds in JavaScript, for the values a list holds */
function lessThan(left: unknown, right: unknown): boolean {
  const primitive = (value: unknown) => (typeof value === 'object' && value !== null ? String(value) : value);
  const x = primitive(left);
  const y = primitive(right);
  if (typeof x === 'string' && typeof y === 'string') return x < y;
  return Number(x) < Number(y);
}

/**
 * Rows in the order the plugin's list of component templates puts them in: its comparator never
 * says two rows are equal, and a row without the value has 0 in its place, which no text is
 * smaller or larger than.
 */
export function pluginOrder<Row>(rows: Row[], sortField: string, sortDirection: string): Row[] {
  return [...rows].sort((a, b) => {
    const x = valueAt(a, sortField, 0);
    const y = valueAt(b, sortField, 0);
    if (sortDirection === 'asc') return lessThan(x, y) ? -1 : 1;
    return lessThan(y, x) ? -1 : 1;
  });
}

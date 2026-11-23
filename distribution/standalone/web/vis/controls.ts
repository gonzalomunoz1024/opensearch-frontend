/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Input controls as OpenSearch Dashboards 3.9.0's input_control_vis runs them: which controls a
 * panel draws and which depend on which, what a list asks OpenSearch for its choices and a range
 * for its bounds, the filter a choice becomes, how a control reads its value back from the filters
 * of the page, what "Apply changes" leaves there, and the checks of a range typed by hand.
 */

import { buildQuery, mergeFilters, phraseFilter, phrasesFilter, rangeFilter, type FilterField } from '../lib/query';
import type { Field, Filter, IndexPattern } from '../lib/types';

type Dsl = Record<string, unknown>;

export interface ControlOptions {
  multiselect?: boolean;
  dynamicOptions?: boolean;
  /** A number the editor's field was emptied of is null, as a saved object holds it */
  size?: number | null;
  /** Kept by the editor; the original's lists ask for the most frequent values whatever it says */
  order?: 'asc' | 'desc';
  type?: string;
  decimalPlaces?: number | null;
  step?: number | null;
}

export interface ControlParam {
  id: string;
  indexPattern?: string;
  fieldName?: string;
  parent?: string;
  label?: string;
  type: 'list' | 'range';
  options?: ControlOptions;
}

export interface ControlsParams {
  controls?: ControlParam[];
  updateFiltersOnChange?: boolean;
  useTimeFilter?: boolean;
  pinFilters?: boolean;
}

export type ListValue = Array<string | number | boolean>;
/** A range as a filter keeps it: one end may be missing when the filter came from elsewhere */
export interface RangeValue {
  min?: number;
  max?: number;
}
export type ControlValue = ListValue | RangeValue | undefined;
export type ControlValues = Record<string, ControlValue>;

/** How long a list's search may take, and how many documents it reads: the original's defaults */
export const AUTOCOMPLETE_TIMEOUT_MS = 1000;
export const AUTOCOMPLETE_TERMINATE_AFTER = 100000;

const isObject = (value: unknown): value is Dsl => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The controls a panel draws: those given an index pattern and a field */
export function usableControls(params: ControlsParams): ControlParam[] {
  return (params.controls ?? []).filter((control) => control.indexPattern && control.fieldName);
}

/** What a control is called: its label, or else its field */
export function controlLabel(control: ControlParam): string {
  return control.label ? control.label : (control.fieldName ?? '');
}

/**
 * The controls each control depends on, its parent first, then the parent's parent: the original's
 * lineage. A loop ends where it comes back, and a parent the panel does not draw is left out.
 */
export function ancestorsOf(controls: ControlParam[]): Map<string, ControlParam[]> {
  const byId = new Map(controls.map((control) => [control.id, control]));
  const map = new Map<string, ControlParam[]>();
  for (const control of controls) {
    const line = [control.id];
    let current: ControlParam | undefined = control;
    while (current?.parent && !line.includes(current.parent)) {
      line.push(current.parent);
      current = byId.get(current.parent);
    }
    map.set(
      control.id,
      line
        .slice(1)
        .map((id) => byId.get(id))
        .filter((found): found is ControlParam => found !== undefined)
    );
  }
  return map;
}

/** Whether a control holds a value: a list needs one choice at least */
export function hasValue(control: ControlParam, value: ControlValue): boolean {
  if (control.type === 'range') return value !== undefined;
  return Array.isArray(value) && value.length > 0;
}

/**
 * Whether two values of a control are the same. An empty list counts as no value, where the
 * original would count removing the last choice as a change to apply.
 */
export function sameValue(control: ControlParam, a: ControlValue, b: ControlValue): boolean {
  const canonical = (value: ControlValue) => {
    if (!hasValue(control, value)) return null;
    if (Array.isArray(value)) return value;
    const range = value as RangeValue;
    return [range.min ?? null, range.max ?? null];
  };
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

// The filters a control made, the page's own first, as the original's filter manager looks for them
function controlledFilters(control: ControlParam, filters: Filter[]): Filter[] {
  const own = filters.filter((filter) => filter.meta?.controlledBy === control.id);
  return [...own.filter((filter) => filter.$state?.store !== 'globalState'), ...own.filter((filter) => filter.$state?.store === 'globalState')];
}

// A phrase in a filter or in one of its clauses, as the original's phrase filter manager reads it
function phraseValueOf(clause: Dsl, fieldName: string): unknown {
  const query = isObject(clause.query) ? clause.query : undefined;
  const bool = query && isObject(query.bool) ? query.bool : undefined;
  if (bool && Array.isArray(bool.should)) {
    return bool.should
      .map((inner: unknown) => (isObject(inner) ? phraseValueOf(inner, fieldName) : undefined))
      // The original drops every falsy choice here, a 0 or false too: only what is missing is dropped
      .filter((value: unknown) => value !== null && value !== undefined);
  }
  if ('script' in clause) {
    const script = isObject(clause.script) && isObject(clause.script.script) ? clause.script.script : undefined;
    return script && isObject(script.params) ? script.params.value : undefined;
  }
  const match = query && isObject(query.match) ? query.match : undefined;
  const phrase =
    query && isObject(query.match_phrase) && Object.keys(query.match_phrase).length > 0
      ? query.match_phrase
      : match && Object.values(match).some((params) => isObject(params) && params.type === 'phrase')
        ? match
        : undefined;
  if (phrase) {
    if (Object.keys(phrase)[0] !== fieldName) return undefined;
    const value = Object.values(phrase)[0];
    return isObject(value) ? value.query : value;
  }
  const bare = isObject(clause.match_phrase) ? clause.match_phrase : undefined;
  return bare && fieldName in bare ? bare[fieldName] : undefined;
}

const asNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) return Number(value);
  return undefined;
};

/**
 * The value a control shows for the filters of the page: every choice of its filters for a list,
 * the bounds of its first filter for a range. A filter that is switched off counts too, as in the
 * original.
 */
export function valueFromFilters(control: ControlParam, filters: Filter[]): ControlValue {
  const found = controlledFilters(control, filters);
  if (found.length === 0) return undefined;
  const fieldName = control.fieldName ?? '';
  if (control.type === 'range') {
    const [first] = found;
    let range: unknown;
    if ('script' in first) {
      const script = isObject(first.script) && isObject(first.script.script) ? first.script.script : undefined;
      range = script?.params;
    } else {
      range = first.range?.[fieldName];
    }
    if (!isObject(range)) return undefined;
    const value: RangeValue = {};
    if ('gte' in range) value.min = asNumber(range.gte);
    if ('gt' in range) value.min = asNumber(range.gt);
    if ('lte' in range) value.max = asNumber(range.lte);
    if ('lt' in range) value.max = asNumber(range.lt);
    return value;
  }
  const values = found.map((filter) => phraseValueOf(filter, fieldName)).filter((value) => value !== null && value !== undefined);
  if (values.length === 0) return undefined;
  return values.reduce<ListValue>((all, value) => all.concat(value as ListValue | string | number | boolean), []);
}

/** The values every control shows for the filters of the page */
export function valuesFromFilters(controls: ControlParam[], filters: Filter[]): ControlValues {
  const values: ControlValues = {};
  for (const control of controls) values[control.id] = valueFromFilters(control, filters);
  return values;
}

/** Which field of its index pattern a control filters on, when the pattern is known */
export type ControlFieldOf = (control: ControlParam) => FilterField | undefined;

/**
 * The filter a control's value becomes, marked with the control's id. `known` is the control's
 * field as its index pattern has it, so that a scripted one is asked by its script, as the
 * original's filter managers ask it; without it the filter is on the field of that name.
 */
export function filterOf(control: ControlParam, value: ControlValue, known?: FilterField): Filter | undefined {
  if (!hasValue(control, value) || !control.fieldName) return undefined;
  const field = known?.name === control.fieldName ? known : { name: control.fieldName };
  let filter: Filter;
  if (control.type === 'range') {
    const range = value as RangeValue;
    filter = rangeFilter(field, { gte: range.min, lte: range.max }, control.indexPattern);
  } else {
    const list = value as ListValue;
    filter = list.length === 1 ? phraseFilter(field, list[0], control.indexPattern) : phrasesFilter(field, list, control.indexPattern);
  }
  filter.meta.key = control.fieldName;
  filter.meta.controlledBy = control.id;
  return filter;
}

/**
 * The filters of the page once "Apply changes" is pressed, as the original's submitFilters: the
 * controls whose value changed replace their filters, a control whose parent has no value loses
 * its filter, and the new filters are added last, pinned when the panel says so. `fieldOf` gives
 * each control's field as its index pattern has it.
 */
export function submitFilters(
  controls: ControlParam[],
  staged: ControlValues,
  filters: Filter[],
  pinned: boolean,
  fieldOf?: ControlFieldOf
): Filter[] {
  const ancestry = ancestorsOf(controls);
  const changed = controls.filter((control) => !sameValue(control, staged[control.id], valueFromFilters(control, filters)));
  const removed = new Set(changed.map((control) => control.id));
  for (const control of controls) {
    const ancestors = ancestry.get(control.id) ?? [];
    if (ancestors.some((ancestor) => !hasValue(ancestor, staged[ancestor.id]))) removed.add(control.id);
  }
  const kept = filters.filter((filter) => !(filter.meta?.controlledBy && removed.has(filter.meta.controlledBy)));
  const added = changed
    .map((control) => filterOf(control, staged[control.id], fieldOf?.(control)))
    .filter((filter): filter is Filter => filter !== undefined)
    .map((filter) => ({ ...filter, $state: { store: pinned ? ('globalState' as const) : ('appState' as const) } }));
  return mergeFilters(kept, added);
}

// --- What the controls ask OpenSearch ---------------------------------------------------------

/** The text of a search, made a pattern that matches it in any case, as the original's */
export function caseInsensitivePattern(text: string): string {
  return text
    .replace(/[.?+*|{}[\]()"\\#@&<>~]/g, (match) => `\\${match}`)
    .replace(/[a-zA-Z]/g, (letter) => `[${letter.toLowerCase()}${letter.toUpperCase()}]`);
}

/**
 * Whether a list asks for its choices as one types: as the original's, which never lets a list on
 * a field it knows to be other than a string do it, whatever the list says
 */
export function asksAsTyped(control: ControlParam, field: Field | undefined): boolean {
  return Boolean(control.options?.dynamicOptions) && (field === undefined || field.type === 'string');
}

/**
 * The aggregation of a list's choices: the most frequent values, as many as the control asks for
 * (five when it does not say; OpenSearch's ten when the list searches as one types, or its size
 * was emptied), with the typed text in any case.
 */
export function termsAggs(control: ControlParam, field: Field | undefined, query?: string): Dsl {
  const options = control.options ?? {};
  const size = asksAsTyped(control, field) ? null : options.size === undefined ? 5 : options.size;
  const terms: Dsl = { order: { _count: 'desc' } };
  if (size) terms.size = size < 1 ? 1 : size;
  if (field?.scripted) {
    terms.script = { source: field.script, lang: field.lang };
    terms.value_type = field.type === 'number' ? 'float' : field.type;
  } else {
    // A field the index pattern does not have is asked for as nothing, and OpenSearch refuses it
    terms.field = field?.name;
  }
  if (query) terms.include = `.*${caseInsensitivePattern(query)}.*`;
  return { termsAgg: { terms } };
}

/** The aggregations of a range's bounds */
export function minMaxAggs(field: Field | undefined): Dsl {
  const body: Dsl = {};
  if (field?.scripted) body.script = { source: field.script, lang: field.lang };
  else if (field) body.field = field.name;
  return { maxAgg: { max: body }, minAgg: { min: body } };
}

/**
 * The body of a control's search: no documents, only the aggregation, under the filters of the
 * controls it depends on and the time range when the panel follows it.
 */
export function controlSearchBody(
  indexPattern: IndexPattern,
  aggs: Dsl,
  filters: Filter[],
  timeClause: Dsl | undefined,
  extra: Dsl = {}
): Dsl {
  const query = buildQuery(indexPattern, undefined, filters);
  if (timeClause) query.bool.filter.push(timeClause);
  return { ...extra, size: 0, aggs, query };
}

// --- The messages of a control that cannot be used ---------------------------------------------

export const NOT_INITIALIZED = 'Control has not been initialized';

export function noValuesMessage(fieldName: string, indexPatternTitle: string): string {
  return (
    `Filtering occurs on the "${fieldName}" field, which doesn't exist on any documents in the ` +
    `"${indexPatternTitle}" index pattern. Choose a different field or index documents that contain values for this field.`
  );
}

export function noIndexPatternMessage(indexPatternId: string): string {
  return `Could not locate index-pattern id: ${indexPatternId}.`;
}

export function waitingForMessage(ancestor: ControlParam): string {
  return `Disabled until '${controlLabel(ancestor)}' is set.`;
}

export const PARTIAL_RESULTS =
  'Terms list might be incomplete because the request is taking too long. ' +
  'Adjust the autocomplete settings in opensearch_dashboards.yml for complete results.';

// --- A range typed by hand --------------------------------------------------------------------

function roundWithPrecision(value: number, places: number, round: (value: number) => number) {
  if (places <= 0) return round(value);
  return round(value * Math.pow(10, places)) / Math.pow(10, places);
}

/** A range's lowest bound, to the control's decimal places */
export function floorWithPrecision(value: number, places: number): number {
  return roundWithPrecision(value, places, Math.floor);
}

/** A range's highest bound, to the control's decimal places */
export function ceilWithPrecision(value: number, places: number): number {
  return roundWithPrecision(value, places, Math.ceil);
}

/**
 * What is wrong with a range as typed, as the original's ValidatedDualRange says it, or '' when it
 * can be used. Both ends empty is no range, and allowed.
 */
export function rangeError(value: [string, string], min = 0, max = 0): string {
  const read = (text: string) => (Number.isNaN(Number(text)) ? '' : text);
  const lowerText = read(value[0]);
  const upperText = read(value[1]);
  const lowerSet = lowerText !== '';
  const upperSet = upperText !== '';
  const lower = parseFloat(lowerText);
  const upper = parseFloat(upperText);
  if (lowerSet !== upperSet) return 'Both lower and upper values must be set';
  if ((lowerSet && lower < min) || (upperSet && upper > max)) return `Values must be on or between ${min} and ${max}`;
  if (lowerSet && upperSet && upper < lower) return 'Upper value must be greater or equal to lower value';
  return '';
}

/** A valid range as typed, as the value a control keeps: none when both ends are empty */
export function rangeValueOf(value: [string, string]): RangeValue | undefined {
  if (value[0] === '' && value[1] === '') return undefined;
  return { min: parseFloat(value[0]), max: parseFloat(value[1]) };
}

/** The width of a range's number fields, in ems, from the longest of its bounds, as the original's */
export function rangeInputWidth(min: number, max: number): number {
  return Math.max(String(min).length, String(max).length) / 1.25 + 2;
}

/** Where a value sits along a track, as the share of the track a thumb's left edge can travel */
export function trackShare(value: number, min: number, max: number): number {
  if (max === min) return 0;
  return Math.min(1, Math.max(0, (value - min) / (max - min)));
}

// --- The editor's -----------------------------------------------------------------------------

/** What the editor calls a control: its label, else its field, else its kind and its place ("list: 0") */
export function controlTitle(control: Pick<ControlParam, 'label' | 'fieldName' | 'type'>, index: number): string {
  if (control.label) return control.label;
  if (control.fieldName) return control.fieldName;
  return `${control.type}: ${index}`;
}

/** A control nobody has filled in yet, with the original's options for its kind */
export function newControl(type: ControlParam['type'], id = String(Date.now())): ControlParam {
  return {
    id,
    indexPattern: '',
    fieldName: '',
    parent: '',
    label: '',
    type,
    options:
      type === 'range'
        ? { decimalPlaces: 0, step: 1 }
        : { type: 'terms', multiselect: true, dynamicOptions: true, size: 5, order: 'desc' },
  };
}

/**
 * The controls with one moved a place up (`direction` below 0) or down, as the original moves
 * them: the first moved up goes last, and the last moved down goes first.
 */
export function movedControl<T>(controls: T[], index: number, direction: number): T[] {
  const to = direction >= 0 ? index + 1 : index - 1;
  if (to < 0) return [...controls.slice(1), controls[0]];
  if (to >= controls.length) return [controls[controls.length - 1], ...controls.slice(0, controls.length - 1)];
  const swapped = controls.slice();
  swapped[to] = controls[index];
  swapped[index] = controls[to];
  return swapped;
}

/** Each control's line of parents, itself first: the original's lineage map, which stops where it comes back */
export function lineageMap(controls: ControlParam[]): Map<string, string[]> {
  const byId = new Map(controls.map((control) => [control.id, control]));
  const map = new Map<string, string[]>();
  for (const control of controls) {
    const line = [control.id];
    let current: ControlParam | undefined = control;
    while (current && typeof current.parent === 'string' && current.parent !== '' && !line.includes(current.parent)) {
      line.push(current.parent);
      current = byId.get(current.parent);
    }
    map.set(control.id, line);
  }
  return map;
}

/**
 * What a control may take as its parent, as the original offers it: every control with an index
 * pattern and a field, a range too, but those that depend on it, itself among them. Each is called
 * by its title, its place counted among those offered.
 */
export function parentCandidates(controls: ControlParam[], id: string): Array<{ value: string; text: string }> {
  const lineage = lineageMap(controls);
  return controls
    .filter((control) => control.indexPattern && control.fieldName && !(lineage.get(control.id) ?? []).includes(id))
    .map((control, index) => ({ value: control.id, text: controlTitle(control, index) }));
}

/** The fields an options list may be made on: those that can be aggregated, of the kinds it can list */
export const listsField = (field: Field): boolean =>
  Boolean(field.aggregatable) && ['number', 'boolean', 'date', 'ip', 'string'].includes(field.type);

/** The fields a range slider may be made on: the numbers, whether or not they can be aggregated, as the original */
export const rangesField = (field: Field): boolean => field.type === 'number';

/** The fields offered for a control, by kind: the kinds in order, the names in order within each */
export function fieldGroups(fields: Field[], keep: (field: Field) => boolean): Array<{ type: string; names: string[] }> {
  const byType = new Map<string, string[]>();
  for (const field of fields) {
    if (!keep(field)) continue;
    const names = byType.get(field.type) ?? [];
    names.push(field.name);
    byType.set(field.type, names);
  }
  return [...byType]
    .map(([type, names]) => ({ type, names: names.sort() }))
    .sort((a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : 0));
}

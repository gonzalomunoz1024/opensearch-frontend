/* SPDX-License-Identifier: Apache-2.0 */

/*
 * A visualization made with VisBuilder, as it is saved: its kind and aggregations
 * (`visualizationState`), the settings of its kind (`styleState`), what changed while someone
 * looked at it (`uiState`), and its index pattern as a reference. OpenSearch Dashboards draws it
 * with the charts of Visualize, so it is turned here into a visualization of Visualize with the
 * settings those charts end up with, and drawn by the same code.
 */

import type { SavedObjectReference } from '../../../common/saved_objects';
import { aggLabel, type AggConfig } from '../../lib/aggs';
import { parseSearchSource, serializeSearchSource, type SearchSource } from '../../lib/search_source';
import type { Filter, Query } from '../../lib/types';
import type { UiState, Vis } from '../../lib/vis';
import { paramNames } from '../visualize/agg_params';
import { defaultParams } from '../visualize/defaults';

export const VIS_BUILDER_TYPE = 'visualization-visbuilder';
export const VIS_BUILDER_APP = '/app/vis-builder';
/** What the Visualize list calls the kind of these objects */
export const VIS_BUILDER_TITLE = 'VisBuilder';

export const visBuilderEditUrl = (id: string) => `${VIS_BUILDER_APP}/edit/${encodeURIComponent(id)}`;

export interface VisBuilderAttributes {
  title: string;
  description?: string;
  visualizationState?: string;
  styleState?: string;
  uiState?: string;
  version?: number;
  kibanaSavedObjectMeta?: { searchSourceJSON?: string };
}

export interface ActiveVisualization {
  name: string;
  aggConfigParams: AggConfig[];
  /** The aggregation being configured and not yet added: it lives in the address only */
  draftAgg?: AggConfig;
}

export interface VisualizationState {
  searchField: string;
  activeVisualization?: ActiveVisualization;
  /** Kept as the object's reference when saved, not in `visualizationState` */
  indexPattern?: string;
  /**
   * The saved query the page has loaded, kept in the address only. The original also writes it
   * into `visualizationState`, which its own check of a saved object then refuses to open.
   */
  savedQuery?: string;
}

export type StyleState = Record<string, unknown>;

export interface VisBuilderState {
  visualization: VisualizationState;
  style: StyleState;
  ui: UiState;
}

export interface SavedVisBuilder {
  id?: string;
  title: string;
  description: string;
  state: VisBuilderState;
  /** Its query and filters: VisBuilder writes none, but they apply when an object has them */
  source: SearchSource;
  references: SavedObjectReference[];
  version?: string;
  updatedAt?: string;
}

// --- The kinds --------------------------------------------------------------------------------------

export interface VisBuilderSchema {
  group: 'metrics' | 'buckets';
  name: string;
  title: string;
  min?: number;
  max?: number;
  /** The aggregations it accepts: names, or names it refuses after `!` */
  aggFilter: string[];
  /** The aggregations a field dropped here gets, the first one its type accepts */
  defaults: string[];
  /** A top hit may show a text field here */
  allowStrings?: boolean;
}

export interface VisBuilderType {
  name: string;
  title: string;
  /** The icon of the kind in the picker */
  icon: 'visBarVertical' | 'visLine' | 'visArea' | 'visMetric' | 'visTable';
  description: string;
  schemas: VisBuilderSchema[];
  style: () => StyleState;
}

const NO_GEO_BUCKET = ['!geohash_grid', '!geotile_grid', '!filter'];

function xySchemas(withRadius: boolean): VisBuilderSchema[] {
  const schemas: VisBuilderSchema[] = [
    { group: 'metrics', name: 'metric', title: 'Y-axis', min: 1, max: 3, aggFilter: ['!geo_centroid', '!geo_bounds'], defaults: ['median'] },
    {
      group: 'buckets',
      name: 'segment',
      title: 'X-axis',
      min: 0,
      max: 1,
      aggFilter: [...NO_GEO_BUCKET, '!filters'],
      defaults: ['date_histogram', 'terms'],
    },
    { group: 'buckets', name: 'group', title: 'Split series', min: 0, max: 3, aggFilter: NO_GEO_BUCKET, defaults: ['terms'] },
    { group: 'buckets', name: 'split', title: 'Split chart', min: 0, max: 1, aggFilter: NO_GEO_BUCKET, defaults: ['terms'] },
  ];
  if (withRadius) {
    schemas.push({
      group: 'metrics',
      name: 'radius',
      title: 'Dot size',
      min: 0,
      max: 1,
      aggFilter: ['count', 'avg', 'sum', 'min', 'max', 'cardinality'],
      defaults: ['count'],
    });
  }
  return schemas;
}

const xyStyle = (type: string) => () => ({ addTooltip: true, addLegend: true, legendPosition: 'right', type });

/** The kinds VisBuilder offers, in the order it registers them: the first is a new one's */
export const VIS_BUILDER_TYPES: VisBuilderType[] = [
  { name: 'histogram', title: 'Bar', icon: 'visBarVertical', description: 'Display histogram visualizations', schemas: xySchemas(false), style: xyStyle('histogram') },
  { name: 'line', title: 'Line', icon: 'visLine', description: 'Display line chart', schemas: xySchemas(true), style: xyStyle('line') },
  { name: 'area', title: 'Area', icon: 'visArea', description: 'Display area chart', schemas: xySchemas(false), style: xyStyle('area') },
  {
    name: 'metric',
    title: 'Metric',
    icon: 'visMetric',
    description: 'Display metric visualizations',
    schemas: [
      {
        group: 'metrics',
        name: 'metric',
        title: 'Metric',
        min: 1,
        aggFilter: ['!std_dev', '!geo_centroid', '!derivative', '!serial_diff', '!moving_avg', '!cumulative_sum', '!geo_bounds'],
        defaults: ['avg', 'cardinality'],
        allowStrings: true,
      },
      { group: 'buckets', name: 'group', title: 'Split group', min: 0, max: 1, aggFilter: NO_GEO_BUCKET, defaults: ['terms'] },
    ],
    style: () => ({
      addTooltip: true,
      addLegend: false,
      type: 'metric',
      metric: {
        percentageMode: false,
        useRanges: false,
        colorSchema: 'Green to Red',
        metricColorMode: 'None',
        colorsRange: [{ from: 0, to: 10000 }],
        labels: { show: true },
        invertColors: false,
        style: { bgFill: '#000', bgColor: false, labelColor: false, subText: '', fontSize: 60 },
      },
    }),
  },
  {
    name: 'table',
    title: 'Table',
    icon: 'visTable',
    description: 'Display table visualizations',
    schemas: [
      { group: 'metrics', name: 'metric', title: 'Metric', min: 1, aggFilter: ['!geo_centroid', '!geo_bounds'], defaults: ['avg', 'cardinality'], allowStrings: true },
      { group: 'buckets', name: 'bucket', title: 'Split rows', aggFilter: ['!filter'], defaults: ['terms'] },
      { group: 'buckets', name: 'split_row', title: 'Split table in rows', min: 0, max: 1, aggFilter: ['!filter'], defaults: ['terms'] },
      { group: 'buckets', name: 'split_column', title: 'Split table in columns', min: 0, max: 1, aggFilter: ['!filter'], defaults: ['terms'] },
    ],
    style: () => ({ perPage: 10, showPartialRows: false, showMetricsAtAllLevels: false }),
  },
];

export const visBuilderType = (name: string | undefined): VisBuilderType | undefined =>
  VIS_BUILDER_TYPES.find((type) => type.name === name);

// --- Reading and writing the saved object -----------------------------------------------------------

const INDEX_REF = 'kibanaSavedObjectMeta.searchSourceJSON.index';

const GENERIC_ERROR =
  'Something went wrong while loading your saved object. The object may be corrupted or does not match the latest schema';

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function parseJson(text: string | undefined, fallback: string): unknown {
  try {
    return JSON.parse(text || fallback) as unknown;
  } catch {
    throw new Error(GENERIC_ERROR);
  }
}

/**
 * What OpenSearch Dashboards checks of a saved state before it opens it, with its messages: the
 * kind and aggregations hold nothing else, and the settings are an object.
 */
export function validateState(style: unknown, visualization: unknown, ui: unknown): string | undefined {
  if (!isPlainObject(style)) return '/styleState Expected object, received ' + kindOf(style);
  if (!isPlainObject(visualization)) return '/visualizationState Expected object, received ' + kindOf(visualization);
  const extra = Object.keys(visualization).filter((key) => !['activeVisualization', 'indexPattern', 'searchField'].includes(key));
  if (extra.length) return `/visualizationState Unrecognized key(s) in object: ${extra.map((key) => `'${key}'`).join(', ')}`;
  if (typeof visualization.searchField !== 'string') return '/visualizationState/searchField Required';
  const active = visualization.activeVisualization;
  if (active !== undefined) {
    if (!isPlainObject(active)) return '/visualizationState/activeVisualization Expected object, received ' + kindOf(active);
    if (typeof active.name !== 'string') return '/visualizationState/activeVisualization/name Required';
    if (!Array.isArray(active.aggConfigParams)) return '/visualizationState/activeVisualization/aggConfigParams Required';
    const more = Object.keys(active).filter((key) => key !== 'name' && key !== 'aggConfigParams');
    if (more.length) {
      return `/visualizationState/activeVisualization Unrecognized key(s) in object: ${more.map((key) => `'${key}'`).join(', ')}`;
    }
  }
  if (ui !== undefined && !isPlainObject(ui)) return '/uiState Expected object, received ' + kindOf(ui);
  return undefined;
}

const kindOf = (value: unknown) => (value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value);

export function visBuilderFromSavedObject(object: {
  id: string;
  attributes: VisBuilderAttributes;
  references?: SavedObjectReference[];
  version?: string;
  updated_at?: string;
}): SavedVisBuilder {
  const references = object.references ?? [];
  const { attributes } = object;
  const style = parseJson(attributes.styleState, '{}');
  const ui = parseJson(attributes.uiState, '{}');
  const stored = parseJson(attributes.visualizationState, '');
  const source = parseSearchSource(attributes.kibanaSavedObjectMeta?.searchSourceJSON, references);
  const visualization = { searchField: '', ...(isPlainObject(stored) ? stored : {}) } as VisualizationState;
  const problem = validateState(style, isPlainObject(stored) ? visualization : stored, ui);
  if (problem) throw new Error(problem);
  if (!source.indexId) throw new Error('The saved object is missing an index pattern');
  return {
    id: object.id,
    title: attributes.title ?? '',
    description: attributes.description ?? '',
    state: { visualization: { ...visualization, indexPattern: source.indexId }, style: style as StyleState, ui: ui as UiState },
    source,
    references,
    version: object.version,
    updatedAt: object.updated_at,
  };
}

/**
 * The attributes and references VisBuilder writes. The index pattern goes into the references and
 * the search source holds the query and the filters of the page when it saved, as
 * `{"query":...,"filter":[...],"indexRefName":...}`; the index pattern's reference comes first.
 */
export function visBuilderToSavedObject(
  saved: Pick<SavedVisBuilder, 'title' | 'description' | 'state'>,
  search: { query?: Query; filters?: Filter[] } = {}
): {
  attributes: VisBuilderAttributes;
  references: SavedObjectReference[];
} {
  const { indexPattern, searchField, activeVisualization: active, savedQuery: _savedQuery, ...rest } = saved.state.visualization;
  // Written with the keys in the order the original writes them, though the address sorts them
  const stored: VisualizationState = {
    searchField,
    ...rest,
    activeVisualization: active ? { name: active.name, aggConfigParams: active.aggConfigParams.map(orderedAgg) } : undefined,
  };
  const query = search.query && { query: search.query.query, language: search.query.language };
  const { searchSourceJSON, references } = serializeSearchSource({
    indexId: indexPattern,
    query,
    filters: search.filters ?? [],
  });
  const isIndex = (reference: SavedObjectReference) => reference.name === INDEX_REF;
  const style = visBuilderType(active?.name)?.style();
  return {
    attributes: {
      title: saved.title,
      description: saved.description,
      visualizationState: JSON.stringify(stored),
      styleState: JSON.stringify(style ? orderedLike(saved.state.style, style) : saved.state.style),
      uiState: JSON.stringify(saved.state.ui ?? {}),
      version: 3,
      kibanaSavedObjectMeta: { searchSourceJSON },
    },
    references: [...references.filter(isIndex), ...references.filter((reference) => !isIndex(reference))],
  };
}

const isAgg = (value: unknown): value is AggConfig => isPlainObject(value) && typeof value.id === 'string' && typeof value.type === 'string';

// Keys the original writes before another that the alphabet puts first: the ends of the bounds of
// a histogram, the query of a filter
const WRITTEN_FIRST: Record<string, string> = { max: 'min', language: 'query' };

/** A part of a parameter with its keys in the order the original writes them */
function orderedPart(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(orderedPart);
  if (isAgg(value)) return orderedAgg(value);
  if (!isPlainObject(value)) return value;
  const out: Plain = {};
  for (const key of Object.keys(value)) {
    const first = WRITTEN_FIRST[key];
    if (first !== undefined && first in value && !(first in out)) out[first] = orderedPart(value[first]);
    if (!(key in out)) out[key] = orderedPart(value[key]);
  }
  return out;
}

/**
 * An aggregation with its keys in the order the original writes them, which serializes each one
 * from its type: `id, enabled, type, params, schema`, the parameters in the order the type has
 * them, and an aggregation inside a parameter the same way. The address, which the page keeps its
 * state in, sorts them all.
 */
export function orderedAgg(agg: AggConfig): AggConfig {
  const { id, enabled, type, params, schema, ...others } = agg;
  let ordered = params;
  if (params) {
    ordered = {};
    for (const name of paramNames(type)) if (name in params) ordered[name] = orderedPart(params[name]);
    for (const [name, value] of Object.entries(params)) if (!(name in ordered)) ordered[name] = orderedPart(value);
  }
  return { id, enabled, type, params: ordered, schema, ...others };
}

/** Why a state cannot be drawn: a part it needs and lacks, as OpenSearch Dashboards says it */
export function schemaProblem(visualization: VisualizationState): string | undefined {
  const active = visualization.activeVisualization;
  const type = visBuilderType(active?.name);
  if (!type) return `Invalid visualization type ${active?.name ?? ''}`;
  const aggs = active?.aggConfigParams ?? [];
  for (const schema of type.schemas) {
    if (!schema.min) continue;
    const count = aggs.filter((agg) => agg.schema === schema.name).length;
    if (count < schema.min) {
      return `The ${type.name} visualization needs at least ${schema.min} field(s) in the agg type "${schema.name}"`;
    }
  }
  return undefined;
}

// --- Drawing it as Visualize draws its own -----------------------------------------------------------

type Plain = Record<string, unknown>;

/** The keys of an object in the order a template has them, those it lacks after */
function orderedLike<T>(value: T, template: unknown): T {
  if (!isPlainObject(value) || !isPlainObject(template)) return value;
  const out: Plain = {};
  for (const key of Object.keys(template)) if (key in value) out[key] = orderedLike(value[key], template[key]);
  for (const [key, item] of Object.entries(value)) if (!(key in out)) out[key] = item;
  return out as T;
}

/** What lodash's `defaultsDeep` does: fills what is missing, arrays place by place */
export function defaultsDeep<T>(target: T, defaults: unknown): T {
  if (target === undefined) return structuredClone(defaults) as T;
  const bothArrays = Array.isArray(target) && Array.isArray(defaults);
  const bothObjects = isPlainObject(target) && isPlainObject(defaults);
  if (!bothArrays && !bothObjects) return target;
  const out = (bothArrays ? [...(target as unknown[])] : { ...(target as Plain) }) as Record<string, unknown>;
  for (const [key, value] of Object.entries(defaults as Plain)) out[key] = defaultsDeep(out[key], value);
  return out as T;
}

const ordinal = (value: number) => {
  if (!Number.isInteger(value)) return `${value}th`;
  const tens = value % 100;
  if (tens >= 11 && tens <= 13) return `${value}th`;
  return `${value}${['th', 'st', 'nd', 'rd'][value % 10] ?? 'th'}`;
};

/** The label of each value a metric gives, as the y dimensions of a chart name them */
function valueLabels(agg: AggConfig): string[] {
  const label = aggLabel(agg, {});
  const field = typeof agg.params?.field === 'string' ? agg.params.field : '';
  const custom = typeof agg.params?.customLabel === 'string' && agg.params.customLabel !== '';
  if (agg.type === 'percentiles') {
    const percents = Array.isArray(agg.params?.percents) ? (agg.params.percents as number[]) : [1, 5, 25, 50, 75, 95, 99];
    return percents.map((percent) => `${ordinal(percent)} percentile of ${custom ? label : field}`);
  }
  if (agg.type === 'percentile_ranks') {
    const values = Array.isArray(agg.params?.values) ? (agg.params.values as number[]) : [0];
    return values.map((value) => `Percentile rank ${value} of "${custom ? label : field}"`);
  }
  if (agg.type === 'std_dev') return [`Lower ${label}`, `Upper ${label}`];
  return [label];
}

/**
 * The settings a line, area or bar chart of VisBuilder is drawn with. VisBuilder hands the chart
 * its legend, its tooltip and one value axis on the left per value, titled with its label;
 * everything else comes from the settings a new chart of the kind has in Visualize. A series is
 * drawn with that kind's first series settings when its metric has the id those name ("1"), and
 * otherwise as a series with no settings is: of the chart's kind, neither stacked nor on another
 * axis than the first.
 */
function xyParams(type: string, style: StyleState, aggs: AggConfig[]): Plain {
  const defaults = defaultParams(type);
  const metrics = aggs.filter((agg) => agg.enabled !== false && agg.schema === 'metric');
  const labels = metrics.flatMap(valueLabels);
  const valueAxes = labels.map((label, index) => ({
    id: `ValueAxis-${index + 1}`,
    labels: { show: true },
    name: `ValueAxis-${index + 1}`,
    position: 'left',
    scale: { type: 'linear', mode: 'normal' },
    show: true,
    style: {},
    title: { text: label },
    type: 'value',
  }));
  const given: Plain = {
    addLegend: style.addLegend,
    legendPosition: style.legendPosition,
    addTimeMarker: false,
    addTooltip: style.addTooltip,
    valueAxes,
  };
  for (const key of Object.keys(given)) if (given[key] === undefined) delete given[key];
  const params = defaultsDeep(given, defaults);
  const first = ((defaults.seriesParams as Plain[] | undefined) ?? [])[0] ?? {};
  const firstId = (first.data as { id?: string } | undefined)?.id;
  params.seriesParams = metrics.map((agg, index) =>
    agg.id === firstId
      ? { ...first, data: { ...(first.data as Plain), id: agg.id } }
      : {
          show: true,
          type: typeof defaults.type === 'string' ? defaults.type : type,
          mode: 'normal',
          interpolate: 'linear',
          drawLinesBetweenPoints: first.drawLinesBetweenPoints,
          showCircles: first.showCircles,
          lineWidth: 2,
          data: { id: agg.id, label: labels[index] ?? aggLabel(agg, {}) },
          valueAxis: 'ValueAxis-1',
        }
  );
  return params;
}

/**
 * The aggregations as the charts of Visualize read them. A table splits into rows or columns by
 * the part an aggregation plays (`split_row`, `split_column`), where Visualize keeps one part,
 * `split`, and says which with `row`; a chart of VisBuilder splits into columns.
 */
function drawnAggs(type: string, aggs: AggConfig[]): AggConfig[] {
  return aggs.map((agg) => {
    if (type === 'table' && (agg.schema === 'split_row' || agg.schema === 'split_column')) {
      return { ...agg, schema: 'split', params: { ...agg.params, row: agg.schema === 'split_row' } };
    }
    if (type !== 'table' && agg.schema === 'split') return { ...agg, params: { ...agg.params, row: false } };
    return agg;
  });
}

/** The visualization of Visualize that draws what a VisBuilder state shows */
export function visFromVisBuilder(saved: Pick<SavedVisBuilder, 'id' | 'title' | 'description' | 'state' | 'source' | 'references'>): Vis {
  const { visualization, style, ui } = saved.state;
  const type = visualization.activeVisualization?.name ?? '';
  const aggs = drawnAggs(type, visualization.activeVisualization?.aggConfigParams ?? []);
  let params: Plain;
  if (type === 'line' || type === 'area' || type === 'histogram') params = xyParams(type, style, aggs);
  else if (type === 'metric') params = defaultsDeep({ ...style }, defaultParams('metric'));
  else if (type === 'table') params = { perPage: 10, showPartialRows: false, showMetricsAtAllLevels: false, ...style };
  else params = { ...style };
  return {
    id: saved.id,
    title: saved.title,
    description: saved.description,
    type,
    params,
    aggs,
    uiState: ui ?? {},
    source: { ...saved.source, indexId: visualization.indexPattern ?? saved.source.indexId },
    references: saved.references,
  };
}

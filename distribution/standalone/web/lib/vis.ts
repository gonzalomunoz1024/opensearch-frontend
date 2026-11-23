/* SPDX-License-Identifier: Apache-2.0 */

/*
 * A visualization as it is saved: its kind, its settings, its aggregations and the search it
 * draws from. The saved object keeps the first three as JSON text (`visState`), what someone
 * changed while looking (`uiStateJSON`: colours, the sort of a table, whether the legend is
 * open), and the search either inline or as a reference to a saved search.
 */

import type { SavedObjectReference } from '../../common/saved_objects';
import type { IconName } from '../components/icon';
import type { AggConfig } from './aggs';
import { parseSearchSource, serializeSearchSource, type SearchSource } from './search_source';

export interface UiState {
  vis?: {
    colors?: Record<string, string>;
    legendOpen?: boolean;
    sortColumn?: { colIndex: number; direction: 'asc' | 'desc' };
    defaultColors?: Record<string, string>;
    params?: { sort?: { columnIndex: number | null; direction: 'asc' | 'desc' | null } };
  };
  mapZoom?: number;
  mapCenter?: [number, number];
  [other: string]: unknown;
}

export interface Vis {
  id?: string;
  title: string;
  description: string;
  type: string;
  params: Record<string, unknown>;
  aggs: AggConfig[];
  uiState: UiState;
  /** The visualization's own index pattern, query and filters */
  source: SearchSource;
  /** The saved search it is drawn from, when it has one: its query and filters apply first */
  savedSearchId?: string;
  parent?: SearchSource;
  references: SavedObjectReference[];
  version?: string;
  updatedAt?: string;
}

export interface VisualizationAttributes {
  title: string;
  description?: string;
  visState: string;
  uiStateJSON?: string;
  version?: number;
  savedSearchRefName?: string;
  savedSearchId?: string;
  kibanaSavedObjectMeta?: { searchSourceJSON?: string };
}

interface StoredVisState {
  title?: string;
  type?: string;
  params?: Record<string, unknown>;
  aggs?: AggConfig[];
}

const parse = <T>(text: string | undefined, fallback: T): T => {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
};

// The index patterns of input controls are saved as references, by name
function controlsFromSaved(params: Record<string, unknown>, references: SavedObjectReference[]) {
  if (!Array.isArray(params.controls)) return params;
  return {
    ...params,
    controls: (params.controls as Array<Record<string, unknown>>).map((control) => {
      const { indexPatternRefName, ...rest } = control;
      if (typeof indexPatternRefName !== 'string') return control;
      return { ...rest, indexPattern: references.find((reference) => reference.name === indexPatternRefName)?.id };
    }),
  };
}

function controlsToSaved(params: Record<string, unknown>, references: SavedObjectReference[]) {
  if (!Array.isArray(params.controls)) return params;
  return {
    ...params,
    controls: (params.controls as Array<Record<string, unknown>>).map((control, index) => {
      const { indexPattern, ...rest } = control;
      if (typeof indexPattern !== 'string' || indexPattern === '') return control;
      const name = `control_${index}_index_pattern`;
      references.push({ name, type: 'index-pattern', id: indexPattern });
      return { ...rest, indexPatternRefName: name };
    }),
  };
}

export function visFromSavedObject(object: {
  id: string;
  attributes: VisualizationAttributes;
  references?: SavedObjectReference[];
  version?: string;
  updated_at?: string;
}): Vis {
  const references = object.references ?? [];
  const state = parse<StoredVisState>(object.attributes.visState, {});
  const savedSearchId = object.attributes.savedSearchRefName
    ? references.find((reference) => reference.name === object.attributes.savedSearchRefName)?.id
    : object.attributes.savedSearchId;
  return {
    id: object.id,
    title: object.attributes.title ?? state.title ?? '',
    description: object.attributes.description ?? '',
    type: state.type ?? 'unknown',
    params: controlsFromSaved(state.params ?? {}, references),
    aggs: Array.isArray(state.aggs) ? state.aggs : [],
    uiState: parse<UiState>(object.attributes.uiStateJSON, {}),
    source: parseSearchSource(object.attributes.kibanaSavedObjectMeta?.searchSourceJSON, references),
    savedSearchId,
    references,
    version: object.version,
    updatedAt: object.updated_at,
  };
}

export function visToSavedObject(vis: Vis): { attributes: VisualizationAttributes; references: SavedObjectReference[] } {
  const stored = serializeSearchSource(vis.savedSearchId ? { ...vis.source, indexId: undefined } : vis.source);
  const references = [...stored.references];
  const params = controlsToSaved(vis.params, references);
  const attributes: VisualizationAttributes = {
    title: vis.title,
    description: vis.description,
    visState: JSON.stringify({ title: vis.title, type: vis.type, aggs: vis.aggs, params }),
    uiStateJSON: JSON.stringify(vis.uiState ?? {}),
    version: 1,
    kibanaSavedObjectMeta: { searchSourceJSON: stored.searchSourceJSON },
  };
  if (vis.savedSearchId) {
    attributes.savedSearchRefName = 'search_0';
    references.push({ name: 'search_0', type: 'search', id: vis.savedSearchId });
  }
  return { attributes, references };
}

/** The kinds of visualization: what each is called, and whether it is drawn from aggregations */
export interface VisType {
  name: string;
  title: string;
  description: string;
  /** OUI's icon for it, as the original draws it */
  icon: IconName;
  /** Drawn from an index pattern's aggregations, so it has the Data tab */
  aggBased: boolean;
  /** The parts aggregations can play in it, in the order the editor lists them */
  schemas?: Array<{ name: string; title: string; group: 'metrics' | 'buckets'; min?: number; max?: number }>;
  /** Still being tried out, as OpenSearch Dashboards 3.9.0 marks its input controls */
  stage?: 'experimental';
}

const XY_SCHEMAS: VisType['schemas'] = [
  { name: 'metric', title: 'Y-axis', group: 'metrics', min: 1 },
  { name: 'radius', title: 'Dot size', group: 'metrics', max: 1 },
  { name: 'segment', title: 'X-axis', group: 'buckets', max: 1 },
  { name: 'group', title: 'Split series', group: 'buckets', max: 3 },
  { name: 'split', title: 'Split chart', group: 'buckets', max: 1 },
];

export const VIS_TYPES: VisType[] = [
  { name: 'area', title: 'Area', description: 'Emphasize the quantity beneath a line chart', icon: 'visArea', aggBased: true, schemas: XY_SCHEMAS },
  {
    name: 'input_control_vis',
    title: 'Controls',
    description: 'Create interactive controls for easy dashboard manipulation',
    icon: 'controlsHorizontal',
    aggBased: false,
    stage: 'experimental',
  },
  {
    name: 'tile_map',
    title: 'Coordinate Map',
    description: 'Plot latitude and longitude coordinates on a map',
    icon: 'visMapCoordinate',
    aggBased: true,
    schemas: [
      { name: 'metric', title: 'Value', group: 'metrics', min: 1, max: 1 },
      { name: 'segment', title: 'Geo coordinates', group: 'buckets', min: 1, max: 1 },
    ],
  },
  {
    name: 'table',
    title: 'Data Table',
    description: 'Display values in a table',
    icon: 'visTable',
    aggBased: true,
    schemas: [
      { name: 'metric', title: 'Metric', group: 'metrics', min: 1 },
      { name: 'bucket', title: 'Split rows', group: 'buckets' },
      { name: 'split', title: 'Split table', group: 'buckets', max: 1 },
    ],
  },
  {
    name: 'gauge',
    title: 'Gauge',
    description: 'Gauges indicate the status of a metric. Use it to show how a metric’s value relates to reference threshold values',
    icon: 'visGauge',
    aggBased: true,
    schemas: [
      { name: 'metric', title: 'Metric', group: 'metrics', min: 1 },
      { name: 'group', title: 'Split group', group: 'buckets', max: 1 },
    ],
  },
  {
    name: 'goal',
    title: 'Goal',
    description: 'A goal chart indicates how close you are to your final goal',
    icon: 'visGoal',
    aggBased: true,
    schemas: [
      { name: 'metric', title: 'Metric', group: 'metrics', min: 1 },
      { name: 'group', title: 'Split group', group: 'buckets', max: 1 },
    ],
  },
  {
    name: 'heatmap',
    title: 'Heat Map',
    description: 'Shade cells within a matrix',
    icon: 'heatmap',
    aggBased: true,
    schemas: [
      { name: 'metric', title: 'Value', group: 'metrics', min: 1, max: 1 },
      { name: 'segment', title: 'X-axis', group: 'buckets', max: 1 },
      { name: 'group', title: 'Y-axis', group: 'buckets', max: 1 },
      { name: 'split', title: 'Split chart', group: 'buckets', max: 1 },
    ],
  },
  { name: 'horizontal_bar', title: 'Horizontal Bar', description: 'Assign a continuous variable to each axis', icon: 'visBarHorizontal', aggBased: true, schemas: XY_SCHEMAS },
  { name: 'line', title: 'Line', description: 'Emphasize trends', icon: 'visLine', aggBased: true, schemas: XY_SCHEMAS },
  { name: 'markdown', title: 'Markdown', description: 'Create a document using markdown syntax', icon: 'visText', aggBased: false },
  {
    name: 'metric',
    title: 'Metric',
    description: 'Display a calculation as a single number',
    icon: 'visMetric',
    aggBased: true,
    schemas: [
      { name: 'metric', title: 'Metric', group: 'metrics', min: 1 },
      { name: 'group', title: 'Split group', group: 'buckets', max: 1 },
    ],
  },
  {
    name: 'pie',
    title: 'Pie',
    description: 'Compare parts of a whole',
    icon: 'visPie',
    aggBased: true,
    schemas: [
      { name: 'metric', title: 'Slice size', group: 'metrics', min: 1, max: 1 },
      { name: 'segment', title: 'Split slices', group: 'buckets' },
      { name: 'split', title: 'Split chart', group: 'buckets', max: 1 },
    ],
  },
  {
    name: 'region_map',
    title: 'Region Map',
    description: 'Show metrics on a thematic map. Use one of the provided base maps, or add your own',
    icon: 'visMapRegion',
    aggBased: true,
    schemas: [
      { name: 'metric', title: 'Value', group: 'metrics', min: 1, max: 1 },
      { name: 'segment', title: 'Shape field', group: 'buckets', min: 1, max: 1 },
    ],
  },
  {
    name: 'tagcloud',
    title: 'Tag Cloud',
    description: 'A group of words, sized according to their importance',
    icon: 'visTagCloud',
    aggBased: true,
    schemas: [
      { name: 'metric', title: 'Tag size', group: 'metrics', min: 1, max: 1 },
      { name: 'segment', title: 'Tags', group: 'buckets', min: 1, max: 1 },
    ],
  },
  { name: 'timelion', title: 'Timeline', description: 'Build time-series using functional expressions', icon: 'timeline', aggBased: false },
  { name: 'metrics', title: 'TSVB', description: 'Build time-series using a visual pipeline interface', icon: 'visVisualBuilder', aggBased: false },
  { name: 'vega', title: 'Vega', description: 'Create custom visualizations using Vega and Vega-Lite', icon: 'visVega', aggBased: false },
  { name: 'histogram', title: 'Vertical Bar', description: 'Assign a continuous variable to each axis', icon: 'visBarVertical', aggBased: true, schemas: XY_SCHEMAS },
];

export const visType = (name: string): VisType | undefined => VIS_TYPES.find((type) => type.name === name);

export const visIcon = (name: string): IconName => visType(name)?.icon ?? 'visualizeApp';

/** The icon of a saved visualization's kind, read from its saved state; nothing for a state that cannot be read */
export function visStateIcon(visState: unknown): IconName | undefined {
  if (typeof visState !== 'string') return undefined;
  try {
    const state: unknown = JSON.parse(visState);
    if (state && typeof state === 'object' && 'type' in state && typeof state.type === 'string') {
      return visType(state.type)?.icon;
    }
  } catch {
    // A state that cannot be read has no kind
  }
  return undefined;
}

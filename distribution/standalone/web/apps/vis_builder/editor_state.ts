/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The VisBuilder page while someone builds a visualization: its state, as OpenSearch Dashboards
 * keeps it in the address (`_a=(metadata,style,ui,visualization)`), and what each gesture does
 * to it: a field dropped on a part of the chart, an aggregation moved, replaced or edited, the
 * kind changed. The rules are VisBuilder's own, so that what is built here is built there.
 */

import { AGG_TITLES, fieldNameOf, type AggConfig } from '../../lib/aggs';
import { flattenHit, type RawHit } from '../../lib/docs';
import type { Field, IndexPattern } from '../../lib/types';
import { decodeState } from '../../lib/url';
import type { UiState } from '../../lib/vis';
import { FIELD_TYPES, PARENT_PIPELINES, SIBLING_PIPELINES, nextAggId } from '../visualize/defaults';
import {
  VIS_BUILDER_TYPES,
  visBuilderType,
  type ActiveVisualization,
  type SavedVisBuilder,
  type StyleState,
  type VisBuilderSchema,
  type VisBuilderType,
  type VisualizationState,
} from './model';

export type EditorStatus = 'loading' | 'loaded' | 'clean' | 'dirty';

export interface MetadataState {
  editor: { errors?: Record<string, boolean>; state: EditorStatus };
  originatingApp?: string;
  isMigrated?: boolean;
}

/** Everything the page holds, as the address carries it */
export interface AppState {
  metadata: MetadataState;
  style: StyleState;
  ui: UiState;
  visualization: VisualizationState;
}

/**
 * A new visualization: the first kind with nothing on it yet, on the default index pattern. It
 * keeps the application it was opened from, a dashboard that asked for a new panel, to go back to.
 */
export function newAppState(indexPattern: string | undefined, originatingApp?: string): AppState {
  const type = VIS_BUILDER_TYPES[0];
  return {
    metadata: { editor: { errors: {}, state: 'clean' }, isMigrated: false, ...(originatingApp ? { originatingApp } : {}) },
    style: type.style(),
    ui: {},
    visualization: {
      searchField: '',
      activeVisualization: { name: type.name, aggConfigParams: [] },
      ...(indexPattern ? { indexPattern } : {}),
    },
  };
}

const drawnKey = (state: AppState) => JSON.stringify([state.ui, state.style, state.visualization]);

/**
 * The state after a change. Once a visualization is loaded clean, any change to what the page
 * holds besides its own bookkeeping makes it dirty, as in VisBuilder: the aggregation being
 * edited and the text the fields are searched by too.
 */
export function afterChange(previous: AppState, next: AppState): AppState {
  if (previous.metadata.editor.state === 'clean' && next.metadata.editor.state === 'clean' && drawnKey(previous) !== drawnKey(next)) {
    return { ...next, metadata: { ...next.metadata, editor: { ...next.metadata.editor, state: 'dirty' } } };
  }
  return next;
}

const STATUSES: EditorStatus[] = ['loading', 'loaded', 'clean', 'dirty'];

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** The state the address holds, when it holds one the page can open: what is missing filled in */
export function readAppState(raw: string | undefined): AppState | undefined {
  const state = decodeState<Record<string, unknown>>(raw);
  const visualization = state.visualization;
  if (!isObject(visualization)) return undefined;
  const metadata = isObject(state.metadata) ? state.metadata : {};
  const editor = isObject(metadata.editor) ? metadata.editor : {};
  const status = STATUSES.find((item) => item === editor.state) ?? 'loading';
  const active = isObject(visualization.activeVisualization) ? visualization.activeVisualization : undefined;
  return {
    metadata: { ...metadata, editor: { ...(isObject(editor.errors) ? { errors: editor.errors as Record<string, boolean> } : {}), state: status } },
    style: isObject(state.style) ? state.style : {},
    ui: (isObject(state.ui) ? state.ui : {}) as UiState,
    visualization: {
      ...(visualization as Partial<VisualizationState>),
      searchField: typeof visualization.searchField === 'string' ? visualization.searchField : '',
      activeVisualization: active
        ? {
            ...(active as Partial<ActiveVisualization>),
            name: typeof active.name === 'string' ? active.name : '',
            aggConfigParams: Array.isArray(active.aggConfigParams) ? (active.aggConfigParams as AggConfig[]) : [],
            ...(isObject(active.draftAgg) ? { draftAgg: { ...(active.draftAgg as Partial<AggConfig>), type: stringOr(active.draftAgg.type) } as AggConfig } : {}),
          }
        : undefined,
    },
  };
}

const stringOr = (value: unknown) => (typeof value === 'string' ? value : '');

/**
 * The state as the address carries it: an aggregation being added has no type yet, and
 * OpenSearch Dashboards writes none rather than an empty one
 */
export function urlAppState(state: AppState): AppState {
  const active = state.visualization.activeVisualization;
  const draft = active?.draftAgg;
  if (!active || !draft || draft.type !== '') return state;
  const { type: _none, ...untyped } = draft;
  return { ...state, visualization: { ...state.visualization, activeVisualization: { ...active, draftAgg: untyped as AggConfig } } };
}

export const withStatus = (state: AppState, status: EditorStatus): AppState => ({
  ...state,
  metadata: { ...state.metadata, editor: { ...state.metadata.editor, state: status } },
});

/**
 * The state once a saved visualization is opened: its kind, aggregations and settings replace
 * what the page held, and it is clean. A page with no state yet, one just arrived at, keeps the
 * application it was sent from; one with a state keeps what its address says of that.
 */
export function openedState(current: AppState | undefined, saved: Pick<SavedVisBuilder, 'state'>, originatingApp?: string): AppState {
  const metadata: MetadataState = current?.metadata ?? {
    editor: { errors: {}, state: 'loading' },
    isMigrated: false,
    ...(originatingApp ? { originatingApp } : {}),
  };
  return withStatus({ metadata, style: saved.state.style, ui: saved.state.ui, visualization: saved.state.visualization }, 'clean');
}

/** The application a page was opened from, when the address names one */
export const originatingAppOf = (state: AppState): string | undefined =>
  typeof state.metadata.originatingApp === 'string' && state.metadata.originatingApp !== '' ? state.metadata.originatingApp : undefined;

/**
 * What the entry of the history carries when another application sent someone here to edit a
 * panel or to make one (the original's EmbeddableEditorState): the application, the panel and
 * the dashboard it is in
 */
export interface IncomingEditorState {
  originatingApp?: string;
  embeddableId?: string;
  containerInfo?: { containerName?: string; containerId?: string };
}

/** The state of the history read as that, whatever it holds */
export function incomingEditorState(state: unknown): IncomingEditorState {
  if (!isObject(state)) return {};
  const container = isObject(state.containerInfo) ? state.containerInfo : undefined;
  return {
    ...(typeof state.originatingApp === 'string' && state.originatingApp !== '' ? { originatingApp: state.originatingApp } : {}),
    ...(typeof state.embeddableId === 'string' ? { embeddableId: state.embeddableId } : {}),
    ...(container
      ? {
          containerInfo: {
            ...(typeof container.containerName === 'string' ? { containerName: container.containerName } : {}),
            ...(typeof container.containerId === 'string' ? { containerId: container.containerId } : {}),
          },
        }
      : {}),
  };
}

/** What is handed back to the application a panel came from (the original's EmbeddablePackageState) */
export interface HandedBack {
  type: string;
  input: { savedObjectId: string };
  embeddableId?: string;
}

/**
 * What a save that goes back hands the application it goes back to, as the original: a
 * visualization that is new, or saved as a copy, is handed over to become a new panel, with no
 * word of the panel it was opened from. One saved over itself is handed over by nothing there, its
 * panel being in the dashboard still; here it names that panel when it knows it, which changes
 * nothing in a dashboard that has the panel and puts it back in one opened afresh that has not.
 */
export function handedBack(
  type: string,
  savedObjectId: string,
  newlyCreated: boolean,
  incoming: IncomingEditorState
): HandedBack | undefined {
  if (newlyCreated) return { type, input: { savedObjectId } };
  return incoming.embeddableId === undefined ? undefined : { type, input: { savedObjectId }, embeddableId: incoming.embeddableId };
}

/** The paths an application is served at: the dashboards have an older one too */
const appPaths = (app: string) => (app === 'dashboards' ? ['/app/dashboards', '/app/dashboard'] : [`/app/${app}`]);

/**
 * The address an application was last at before the entry of the history the page is in, among
 * the addresses of the entries of this tab: the original keeps the address each of its
 * applications was left at, and goes back to that
 */
export function lastAddressIn(
  entries: ReadonlyArray<string | null | undefined>,
  at: number,
  app: string,
  origin: string,
  basePath: string
): string | undefined {
  const paths = appPaths(app);
  for (let index = Math.min(at, entries.length) - 1; index >= 0; index--) {
    const raw = entries[index];
    if (!raw) continue;
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      continue;
    }
    if (url.origin !== origin || !url.pathname.startsWith(basePath)) continue;
    const path = url.pathname.slice(basePath.length);
    if (paths.includes(path)) return `${path}${url.search}${url.hash}`;
  }
  return undefined;
}

/**
 * Where a save goes back to: the address the application was last at in this tab, when the
 * browser tells it; else the dashboard the panel is in, a new one when that was never saved, and
 * the application as it opens when nothing says where the panel is.
 */
export function originAddress(originatingApp: string, incoming: IncomingEditorState, lastAddress: string | undefined): string {
  if (lastAddress) return lastAddress;
  const container = originatingApp === 'dashboards' ? incoming.containerInfo : undefined;
  if (!container) return `/app/${originatingApp}`;
  return container.containerId ? `/app/dashboards#/view/${encodeURIComponent(container.containerId)}` : '/app/dashboards#/create';
}

/** The applications a panel is sent from, by the name the original's navigation gives them */
const APP_NAMES: Record<string, string> = { dashboards: 'Dashboards' };

export const originName = (app: string) => APP_NAMES[app] ?? app;

/**
 * What the switch under the save dialog's form says, or nothing when there is none: a copy can
 * only be added to a dashboard, and what was never saved, or is saved as a copy, is added rather
 * than returned to
 */
export function returnSwitchLabel(originatingApp: string, existing: boolean, copy: boolean): string | undefined {
  if (copy && originatingApp !== 'dashboards') return undefined;
  return `${!existing || copy ? 'Add' : 'Return'} to ${originName(originatingApp)} after saving`;
}

/**
 * Whether a title is taken, as the original asks: by the first object found to have it, whatever
 * the case of its letters, unless that is the object being saved over itself
 */
export function titleTaken(found: ReadonlyArray<{ id: string; title?: string }>, title: string, savedOver: string | undefined): boolean {
  const first = found.find((object) => object.title?.toLowerCase() === title.toLowerCase());
  return first !== undefined && first.id !== savedOver;
}

/** Whether a part of the page holds something invalid: the panel that edits an aggregation */
export const withEditorError = (state: AppState, key: string, error: boolean): AppState => ({
  ...state,
  metadata: { ...state.metadata, editor: { ...state.metadata.editor, errors: { ...state.metadata.editor.errors, [key]: error } } },
});

/** Another index pattern: the aggregations were made on the last one's fields, so they go */
export function withIndexPattern(state: AppState, indexPattern: string): AppState {
  const active = state.visualization.activeVisualization;
  return {
    ...state,
    visualization: {
      ...state.visualization,
      indexPattern,
      activeVisualization: active ? { name: active.name, aggConfigParams: [] } : undefined,
    },
  };
}

/** The aggregations replaced: a parent pipeline then takes every bucket of its histogram */
export function withAggs(state: AppState, aggs: AggConfig[]): AppState {
  const active = state.visualization.activeVisualization;
  if (!active) return state;
  return {
    ...state,
    visualization: { ...state.visualization, activeVisualization: { ...active, aggConfigParams: withPipelineBuckets(aggs) } },
  };
}

/** The aggregation being edited, or none when the panel that edits it closes */
export function withDraft(state: AppState, draft: AggConfig | undefined): AppState {
  const active = state.visualization.activeVisualization;
  if (!active) return state;
  const { draftAgg: _previous, ...rest } = active;
  return {
    ...state,
    visualization: { ...state.visualization, activeVisualization: draft ? { ...rest, draftAgg: draft } : rest },
  };
}

/** What the panel that edits an aggregation keeps, a moment after each valid change */
export function withSavedDraft(state: AppState): AppState {
  const active = state.visualization.activeVisualization;
  if (!active?.draftAgg) return state;
  const saved = saveDraft(active);
  return withAggs({ ...state, visualization: { ...state.visualization, activeVisualization: saved } }, saved.aggConfigParams);
}

/** A new aggregation of a part, with no type yet: what "Click or drop to add" opens */
export const newDraft = (aggs: AggConfig[], schema: VisBuilderSchema): AggConfig => ({
  id: nextAggId(aggs),
  enabled: true,
  type: '',
  schema: schema.name,
  params: {},
});

/** Why the visualization cannot be saved now, as the Save button's tooltip says it */
export function saveDisabledReason(state: AppState): string | undefined {
  const active = state.visualization.activeVisualization;
  if (active?.aggConfigParams.length === 0) return 'The canvas is empty. Add some aggregations before saving.';
  if (state.metadata.editor.state !== 'dirty' && state.metadata.isMigrated === false) return 'Add some changes before saving.';
  if (active?.draftAgg) return 'Update unapplied aggregation changes before saving.';
  return undefined;
}

// --- Which aggregation a part of the chart takes -----------------------------------------------------

// The aggregations in the order OpenSearch Dashboards registers them: a field dropped on a part of
// the chart becomes the first it can be, after the part's own choices
const METRIC_ORDER = [
  'count',
  'avg',
  'sum',
  'median',
  'min',
  'max',
  'std_dev',
  'cardinality',
  'percentiles',
  'percentile_ranks',
  'top_hits',
  'derivative',
  'cumulative_sum',
  'moving_avg',
  'serial_diff',
  'avg_bucket',
  'sum_bucket',
  'min_bucket',
  'max_bucket',
];
const BUCKET_ORDER = ['date_histogram', 'histogram', 'range', 'date_range', 'ip_range', 'terms', 'filters', 'significant_terms', 'geohash_grid'];

/** Whether a name passes a filter of names: the names it lists, or all but those after a `!` */
export function passesFilter(name: string, filter: string[]): boolean {
  if (filter.length === 0 || filter.includes('*')) return true;
  const wanted = filter.filter((item) => !item.startsWith('!'));
  const refused = filter.filter((item) => item.startsWith('!')).map((item) => item.slice(1));
  return !refused.includes(name) && (wanted.length === 0 || wanted.includes(name));
}

/** What is dragged or added: the count, a field of the index pattern, or nothing that is either */
export interface AggSource {
  count: boolean;
  field?: Field;
}

/** The aggregations something dropped on a part of the chart can become, in the order of preference */
export function validAggTypes(source: AggSource, schema: VisBuilderSchema): string[] {
  const order = schema.group === 'metrics' ? METRIC_ORDER : BUCKET_ORDER;
  return order.filter((type) => {
    if (!passesFilter(type, schema.aggFilter)) return false;
    // Only the count becomes a count
    if (type === 'count') return source.count;
    const accepted = FIELD_TYPES[type];
    // An aggregation on no field takes anything, the count too; one on a field takes a field only
    if (!accepted) return true;
    if (source.count || !source.field) return false;
    return accepted === '*' || accepted.includes(source.field.type);
  });
}

/** The aggregation a dropped field becomes: the first of the part's own it can be, else the first it can be */
export const aggTypeFor = (valid: string[], schema: VisBuilderSchema): string | undefined =>
  schema.defaults.find((type) => valid.includes(type)) ?? valid[0];

/**
 * The parameters an aggregation has when it is made from a field: its type's defaults, the
 * language of a new filter being the one queries are written in
 */
export function droppedAggParams(
  type: string,
  fieldName: string | undefined,
  indexPattern: IndexPattern | undefined,
  language = 'kuery'
): Record<string, unknown> {
  const field = FIELD_TYPES[type] && fieldName ? { field: fieldName } : {};
  switch (type) {
    case 'median':
      return { ...field, percents: [50] };
    case 'percentiles':
      return { ...field, percents: [1, 5, 25, 50, 75, 95, 99] };
    case 'percentile_ranks':
      return { ...field, values: [] };
    case 'top_hits':
      return { ...field, size: 1, ...(indexPattern?.timeFieldName ? { sortField: indexPattern.timeFieldName } : {}), sortOrder: 'desc' };
    case 'derivative':
    case 'cumulative_sum':
    case 'moving_avg':
    case 'serial_diff':
      return { metricAgg: 'custom' };
    case 'date_histogram':
      return {
        ...field,
        useNormalizedOpenSearchInterval: true,
        scaleMetricValues: false,
        interval: 'auto',
        drop_partials: false,
        min_doc_count: 1,
        extended_bounds: {},
      };
    case 'histogram':
      return { ...field, interval: 'auto', min_doc_count: false, has_extended_bounds: false, extended_bounds: { min: '', max: '' } };
    case 'range':
      return {
        ...field,
        ranges: [
          { from: 0, to: 1000 },
          { from: 1000, to: 2000 },
        ],
      };
    case 'date_range':
      return { ...field, ranges: [{ from: 'now-1w/w', to: 'now' }] };
    case 'ip_range':
      return {
        ...field,
        ipRangeType: 'fromTo',
        ranges: {
          fromTo: [
            { from: '0.0.0.0', to: '127.255.255.255' },
            { from: '128.0.0.0', to: '191.255.255.255' },
          ],
          mask: [{ mask: '0.0.0.0/1' }, { mask: '128.0.0.0/2' }],
        },
      };
    case 'terms':
      return {
        ...field,
        order: 'desc',
        size: 5,
        otherBucket: false,
        otherBucketLabel: 'Other',
        missingBucket: false,
        missingBucketLabel: 'Missing',
      };
    case 'filters':
      return { filters: [{ input: { query: '', language }, label: '' }] };
    case 'significant_terms':
      return { ...field, size: '' };
    default:
      return field;
  }
}

/** What an aggregation already on the chart is, when it is dragged elsewhere */
export function sourceOfAgg(agg: AggConfig, indexPattern: IndexPattern | undefined): AggSource {
  // As there, an aggregation with no parameters is a count; one with a label of its own still is
  const count = agg.type === 'count' || Object.keys(agg.params ?? {}).length === 0;
  const name = fieldNameOf(agg);
  return { count, field: name ? indexPattern?.fields.find((field) => field.name === name) : undefined };
}

/** The aggregations with one more, made from what was dropped on a part; none when it cannot be */
export function withNewAgg(
  aggs: AggConfig[],
  schema: VisBuilderSchema,
  source: AggSource,
  indexPattern: IndexPattern | undefined,
  language?: string
): AggConfig[] | undefined {
  const type = aggTypeFor(validAggTypes(source, schema), schema);
  if (!type) return undefined;
  const agg: AggConfig = {
    id: nextAggId(aggs),
    enabled: true,
    type,
    params: droppedAggParams(type, source.field?.name, indexPattern, language),
    schema: schema.name,
  };
  return [...aggs, agg];
}

const countIn = (aggs: AggConfig[], schema: VisBuilderSchema) => aggs.filter((agg) => agg.schema === schema.name).length;

/** Whether a part of the chart has room for one more aggregation */
export const hasRoom = (aggs: AggConfig[], schema: VisBuilderSchema) => countIn(aggs, schema) < (schema.max ?? Infinity);

/** A field or the count dropped on a part of the chart: a new aggregation at the end */
export function addField(aggs: AggConfig[], schema: VisBuilderSchema, source: AggSource, indexPattern: IndexPattern | undefined, language?: string) {
  return hasRoom(aggs, schema) ? withNewAgg(aggs, schema, source, indexPattern, language) : undefined;
}

/** A field or the count dropped on an aggregation: a new one made from it takes its place */
export function replaceWithField(
  aggs: AggConfig[],
  targetId: string,
  schema: VisBuilderSchema,
  source: AggSource,
  indexPattern: IndexPattern | undefined,
  language?: string
) {
  return withNewAgg(aggs, schema, source, indexPattern, language)?.filter((agg) => agg.id !== targetId);
}

/** An aggregation dragged to another part: made again there from its field, and gone from where it was */
export function moveAgg(aggs: AggConfig[], sourceId: string, schema: VisBuilderSchema, indexPattern: IndexPattern | undefined, language?: string) {
  const agg = aggs.find((candidate) => candidate.id === sourceId);
  if (!agg || !hasRoom(aggs, schema)) return undefined;
  return withNewAgg(aggs, schema, sourceOfAgg(agg, indexPattern), indexPattern, language)?.filter((candidate) => candidate.id !== sourceId);
}

/** An aggregation dropped on another of another part: made again in its place */
export function replaceWithAgg(
  aggs: AggConfig[],
  sourceId: string,
  targetId: string,
  schema: VisBuilderSchema,
  indexPattern: IndexPattern | undefined,
  language?: string
) {
  const agg = aggs.find((candidate) => candidate.id === sourceId);
  if (!agg) return undefined;
  return withNewAgg(aggs, schema, sourceOfAgg(agg, indexPattern), indexPattern, language)?.filter(
    (candidate) => candidate.id !== sourceId && candidate.id !== targetId
  );
}

/** An aggregation dropped on another of the same part: it takes that one's place in the order */
export function reorderAggs(aggs: AggConfig[], sourceId: string, targetId: string): AggConfig[] {
  const from = aggs.findIndex((agg) => agg.id === sourceId);
  const to = aggs.findIndex((agg) => agg.id === targetId);
  if (from === -1 || to === -1 || from === to) return aggs;
  const next = [...aggs];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** What is dragged: a field or the count from the list at the left, or an aggregation of the chart */
export type DragItem = { kind: 'field'; source: AggSource } | { kind: 'agg'; id: string };

/** Where it is dropped: on a part of the chart, or on one of its aggregations */
export interface DropPlace {
  schema: VisBuilderSchema;
  aggId?: string;
}

/**
 * The aggregations after something is dropped, or none when it cannot go there. A field makes a
 * new aggregation, at the end of the part or in place of the one it is dropped on. An aggregation
 * dropped on another of its part takes that one's place in the order; on another part it is made
 * again there from its field, in place of the one it is dropped on if any; on its own part it
 * goes to the end as it is.
 */
export function droppedAggs(
  aggs: AggConfig[],
  item: DragItem,
  place: DropPlace,
  indexPattern: IndexPattern | undefined,
  language?: string
): AggConfig[] | undefined {
  if (item.kind === 'field') {
    return place.aggId
      ? replaceWithField(aggs, place.aggId, place.schema, item.source, indexPattern, language)
      : addField(aggs, place.schema, item.source, indexPattern, language);
  }
  const agg = aggs.find((candidate) => candidate.id === item.id);
  if (!agg || place.aggId === item.id) return undefined;
  const ownPart = agg.schema === place.schema.name;
  if (place.aggId) {
    return ownPart ? reorderAggs(aggs, item.id, place.aggId) : replaceWithAgg(aggs, item.id, place.aggId, place.schema, indexPattern, language);
  }
  if (ownPart) return [...aggs.filter((candidate) => candidate.id !== item.id), agg];
  return moveAgg(aggs, item.id, place.schema, indexPattern, language);
}

/** The aggregation being edited, kept in place of the one it edits or added after the others */
export function saveDraft(active: ActiveVisualization): ActiveVisualization {
  const draft = active.draftAgg;
  if (!draft) return active;
  const at = active.aggConfigParams.findIndex((agg) => agg.id === draft.id);
  const aggConfigParams = at === -1 ? [...active.aggConfigParams, draft] : active.aggConfigParams.map((agg, index) => (index === at ? draft : agg));
  return { ...active, aggConfigParams };
}

/**
 * The aggregations someone may choose for a part, in the order the editor lists them: grouped as
 * metrics, parent pipelines and sibling pipelines, each by its title. A type is listed whether or
 * not the index pattern has a field it takes; its field select then says it has none.
 */
export function schemaAggTypes(schema: VisBuilderSchema): string[] {
  const order = schema.group === 'metrics' ? METRIC_ORDER : BUCKET_ORDER;
  const group = (type: string) => (PARENT_PIPELINES.includes(type) ? 1 : SIBLING_PIPELINES.includes(type) ? 2 : 0);
  const title = (type: string) => AGG_TITLES[type] ?? type;
  return order
    .filter((type) => passesFilter(type, schema.aggFilter))
    .sort((a, b) => group(a) - group(b) || title(a).localeCompare(title(b)));
}

// --- The rules of a whole chart -------------------------------------------------------------------

const isBucket = (agg: AggConfig) => BUCKET_ORDER.includes(agg.type);
const lastOf = <T>(list: T[], test: (item: T) => boolean): T | undefined => [...list].reverse().find(test);

/** What keeps the aggregations from being drawn together, as VisBuilder says it */
export function aggregationsProblem(aggs: AggConfig[]): string | undefined {
  const parent = lastOf(
    aggs.filter((agg) => agg.schema === 'metric'),
    (agg) => PARENT_PIPELINES.includes(agg.type)
  );
  const bucket = lastOf(aggs, isBucket);
  if (!bucket && parent) return 'Add a bucket with "Date Histogram" or "Histogram" aggregation.';
  if (bucket && parent && bucket.type !== 'date_histogram' && bucket.type !== 'histogram') {
    return `Last bucket aggregation must be "Date Histogram" or "Histogram" when using "${AGG_TITLES[parent.type] ?? parent.type}" metric aggregation.`;
  }
  return undefined;
}

/** A parent pipeline needs every bucket of the histogram it runs over, empty ones too */
export function withPipelineBuckets(aggs: AggConfig[]): AggConfig[] {
  const parent = lastOf(
    aggs.filter((agg) => agg.schema === 'metric'),
    (agg) => PARENT_PIPELINES.includes(agg.type)
  );
  const bucket = lastOf(aggs, isBucket);
  if (!parent || !bucket || (bucket.type !== 'date_histogram' && bucket.type !== 'histogram')) return aggs;
  const value = bucket.type === 'histogram' ? true : 0;
  if (bucket.params?.min_doc_count === value) return aggs;
  return aggs.map((agg) => (agg.id === bucket.id ? { ...agg, params: { ...agg.params, min_doc_count: value } } : agg));
}

/**
 * The aggregations kept when the kind changes: those whose part the new kind has the same, then
 * those another part of the same group accepts, while there is room
 */
export function persistedAggs(aggs: AggConfig[], from: VisBuilderType | undefined, to: VisBuilderType): AggConfig[] {
  const room = new Map(to.schemas.map((schema) => [schema.name, schema.max ?? Infinity]));
  const take = (name: string) => room.set(name, (room.get(name) ?? 0) - 1);
  const same = (a: VisBuilderSchema, b: VisBuilderSchema) =>
    a.name === b.name && a.group === b.group && a.aggFilter.length === b.aggFilter.length && a.aggFilter.every((item, index) => item === b.aggFilter[index]);
  const kept: AggConfig[] = [];
  for (const agg of aggs) {
    const current = from?.schemas.find((schema) => schema.name === agg.schema);
    const matching = to.schemas.find((schema) => schema.name === agg.schema);
    if (current && matching && same(current, matching) && (room.get(matching.name) ?? 0) > 0) {
      kept.push(agg);
      take(matching.name);
      continue;
    }
    const other = to.schemas.find(
      (schema) => schema.group === current?.group && passesFilter(agg.type, schema.aggFilter) && (room.get(schema.name) ?? 0) > 0
    );
    if (other) {
      kept.push({ ...agg, schema: other.name });
      take(other.name);
    }
  }
  return kept;
}

/** The state with another kind: its settings start over and the aggregations that fit stay */
export function withType(state: AppState, name: string, aggs: AggConfig[]): AppState {
  const type = visBuilderType(name);
  if (!type) return state;
  return {
    ...state,
    style: type.style(),
    visualization: { ...state.visualization, activeVisualization: { name, aggConfigParams: aggs } },
  };
}

// --- The fields at the left -------------------------------------------------------------------------

/** The fields that can be dragged: those that can be aggregated, outside nested documents */
export const availableFields = (indexPattern: IndexPattern | undefined): Field[] =>
  (indexPattern?.fields ?? []).filter((field) => field.aggregatable && !field.subType?.nested);

export type FieldCategory = 'categorical' | 'numerical' | 'meta';

export function fieldCategory(field: Field, metaFields: string[]): FieldCategory {
  if (metaFields.includes(field.name)) return 'meta';
  return field.type === 'number' ? 'numerical' : 'categorical';
}

export interface FieldBucket {
  value: unknown;
  count: number;
  percent: number;
}

export interface FieldDetails {
  buckets: FieldBucket[];
  error?: string;
  exists: number;
  total: number;
}

const NO_ANALYSIS_TYPES = ['geo_point', 'geo_shape', 'attachment'];

/** The values a field takes most often in the sample of documents, as the field's popover shows them */
export function fieldDetails(hits: RawHit[], field: Field, indexPattern: IndexPattern): FieldDetails {
  const none = { buckets: [], exists: 0, total: 0 };
  if (hits.length === 0) {
    return { ...none, error: 'No documents match the selected query and filters. Try increasing time range or removing filters.' };
  }
  if (NO_ANALYSIS_TYPES.includes(field.type)) return { ...none, error: `Analysis is not available for ${field.type} fields.` };
  // A field of several (a keyword under a text) is read from the field it belongs to
  const name = field.subType?.multi?.parent ?? field.name;
  const values = hits.map((hit) => flattenHit(hit, indexPattern)[name]);
  const missing = values.filter((value) => value === undefined || value === null).length;
  if (missing === hits.length) {
    return {
      ...none,
      error: `This field is present in your OpenSearch mapping but not in the ${hits.length} documents sampled. You may still be able to visualize it.`,
    };
  }
  // Grouped by the text of a value, in the order an object lists its keys, as there
  const groups: Record<string, { value: unknown; count: number }> = {};
  for (const value of values.flat()) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'object' && !Array.isArray(value)) return { ...none, error: 'Analysis is not available for object fields.' };
    const key = String(value);
    const group = groups[key];
    if (group) group.count += 1;
    else groups[key] = { value, count: 1 };
  }
  const present = hits.length - missing;
  const buckets = Object.keys(groups)
    .sort((a, b) => groups[b].count - groups[a].count)
    .slice(0, 5)
    .map((key) => ({ value: groups[key].value, count: groups[key].count, percent: (groups[key].count / present) * 100 }));
  return { buckets, exists: present, total: hits.length };
}

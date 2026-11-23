/* SPDX-License-Identifier: Apache-2.0 */

/*
 * How the editor of a visualization shares the page, as OpenSearch Dashboards' default editor
 * does: the chart and the sidebar each take a share of the width, in percent, which a drag of the
 * bar between them or its arrow keys change; and the bar above them shows what the kind asks for.
 */

import type { AggConfig } from '../../lib/aggs';
import { serializeAggs, type AggEnv } from './agg_params';

/** A kind's `editorConfig.defaultSize` in the original */
export type EditorSize = 'small' | 'medium' | 'large';

const EDITOR_SIZES: Partial<Record<string, EditorSize>> = { markdown: 'large', vega: 'medium', timelion: 'medium' };

/** The share of the width the sidebar starts with, in percent */
export function sidebarInitialWidth(type: string): number {
  const size = EDITOR_SIZES[type] ?? 'medium';
  return size === 'small' ? 15 : size === 'large' ? 50 : 30;
}

/** The shares of the chart and of the sidebar, in percent of the editor's width */
export interface SplitWidths {
  chart: number;
  side: number;
}

export function initialWidths(type: string): SplitWidths {
  const side = sidebarInitialWidth(type);
  return { chart: 100 - side, side };
}

/**
 * The shares after the bar is dragged by `delta` pixels. As in the original they start from the
 * widths the two panels are drawn at, which the sidebar's least and largest widths may have
 * changed, not from the shares asked before.
 */
export function dragWidths(chartPx: number, sidePx: number, delta: number, editorPx: number): SplitWidths {
  if (editorPx <= 0) return { chart: 100, side: 0 };
  return { chart: ((chartPx + delta) / editorPx) * 100, side: ((sidePx - delta) / editorPx) * 100 };
}

/** The shares after an arrow key on the bar: one percent from one panel to the other */
export function keyWidths(widths: SplitWidths, key: string): SplitWidths | undefined {
  if (key === 'ArrowLeft') return { chart: widths.chart - 1, side: widths.side + 1 };
  if (key === 'ArrowRight') return { chart: widths.chart + 1, side: widths.side - 1 };
  return undefined;
}

/** The options of a kind that differ from the original's defaults (`BaseVisType`) */
interface KindOptions {
  showTimePicker?: boolean;
  showQueryBar?: boolean;
  showFilterBar?: boolean;
  showIndexSelection?: boolean;
  /** False for a kind whose request handler is "none": it asks nothing of an index */
  requiresSearch?: boolean;
}

const KIND_OPTIONS: Partial<Record<string, KindOptions>> = {
  markdown: { showTimePicker: false, showFilterBar: false, requiresSearch: false },
  input_control_vis: { requiresSearch: false },
  metrics: { showQueryBar: false, showFilterBar: false, showIndexSelection: false },
  timelion: { showQueryBar: false, showFilterBar: false, showIndexSelection: false },
  vega: { showIndexSelection: false },
};

/** What the bar above the editor shows */
export interface SearchBarParts {
  query: boolean;
  filters: boolean;
  /** The range of dates; without it, only how often the page refreshes */
  datePicker: boolean;
}

/** The original's rules (`visualize_top_nav.tsx`): a pattern without a time field has no dates */
export function searchBarParts(type: string, indexPattern?: { timeFieldName?: string }): SearchBarParts {
  const options = KIND_OPTIONS[type] ?? {};
  const hasTimeField = indexPattern ? Boolean(indexPattern.timeFieldName) : true;
  return {
    query: (options.requiresSearch ?? true) && (options.showQueryBar ?? true),
    filters: options.showFilterBar ?? true,
    datePicker: (options.showTimePicker ?? true) && hasTimeField,
  };
}

/**
 * What the top of the sidebar shows: the saved search the visualization is linked to, the index
 * pattern it is drawn from, an empty band for a kind that searches without one, or nothing for a
 * kind that does not search.
 */
export function sidebarTitle(type: string, linked: boolean): 'linked' | 'indexPattern' | 'placeholder' | 'none' {
  const options = KIND_OPTIONS[type] ?? {};
  if (!(options.requiresSearch ?? true)) return 'none';
  if (linked) return 'linked';
  return (options.showIndexSelection ?? true) ? 'indexPattern' : 'placeholder';
}

/** The kinds whose changes can be applied as they are made (`editorConfig.enableAutoApply`) */
export const canAutoApply = (type: string): boolean => type === 'markdown' || type === 'vega';

/** The heading a screen reader announces for the page: a new one names the application that opened it */
export function editorHeading(title: string | undefined, typeTitle: string, saved: boolean, originatingApp?: string): string {
  return saved
    ? `${title ?? ''} ${typeTitle} visualization`
    : `Visualization of type ${typeTitle} embedded into ${originatingApp || 'dashboards'} app`;
}

/**
 * The aggregations the editor shows and draws: those of the address, each with every parameter of
 * its type and the defaults of those it lacks, as the original's `AggConfig` takes them (the
 * address Discover's "Visualize" writes names only a few), or else those that were saved
 */
export function editorAggs(fromUrl: AggConfig[] | undefined, saved: AggConfig[], aggBased: boolean, env: AggEnv): AggConfig[] {
  if (!fromUrl) return saved;
  return aggBased ? serializeAggs(fromUrl, env) : fromUrl;
}

/**
 * Whether the sidebar holds changes Update has not applied, the original's `isDirty`. What the
 * sidebar's editors fill in by themselves as they show a state (a split chart in rows, the empty
 * buckets of the last bucket under a parent pipeline) is no change, as the original's editors make
 * those before its sidebar listens: the draft counts from the moment someone uses the sidebar,
 * against what it was then (`clean`, undefined until then).
 */
export const hasUnappliedChanges = (draft: string | undefined, clean: string | undefined): boolean =>
  draft !== undefined && clean !== undefined && draft !== clean;

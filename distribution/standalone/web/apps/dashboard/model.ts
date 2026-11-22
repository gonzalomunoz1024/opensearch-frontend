/* SPDX-License-Identifier: Apache-2.0 */

/*
 * A dashboard as it is saved, and the arithmetic of its grid. The saved object keeps the panels
 * as JSON text, each naming its visualization or saved search through a reference; the grid has
 * 48 columns and rows 20 pixels high, as in OpenSearch Dashboards, so saved layouts keep theirs.
 */

import type { SavedObjectReference } from '../../../common/saved_objects';
import { parseSearchSource, serializeSearchSource } from '../../lib/search_source';
import type { Filter, Query, RefreshInterval } from '../../lib/types';

export const GRID_COLUMNS = 48;
export const ROW_HEIGHT = 20;
export const GRID_MARGIN = 8;
export const DEFAULT_PANEL = { w: 24, h: 15 };
export const MIN_PANEL = { w: 4, h: 4 };

export interface GridItem {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PanelState {
  panelIndex: string;
  gridData: GridItem;
  type: string;
  id: string;
  /** What was changed on the panel itself: a legend closed, colours, the centre of a map */
  embeddableConfig: Record<string, unknown>;
  /** A title of the panel's own, in place of its object's */
  title?: string;
  version?: string;
}

export interface DashboardOptions {
  useMargins: boolean;
  hidePanelTitles: boolean;
}

export interface Dashboard {
  id?: string;
  title: string;
  description: string;
  panels: PanelState[];
  options: DashboardOptions;
  query?: Query;
  filters: Filter[];
  timeRestore: boolean;
  timeFrom?: string;
  timeTo?: string;
  refreshInterval?: RefreshInterval;
  version?: string;
}

export interface DashboardAttributes {
  title: string;
  description?: string;
  hits?: number;
  panelsJSON?: string;
  optionsJSON?: string;
  version?: number;
  timeRestore?: boolean;
  timeFrom?: string;
  timeTo?: string;
  refreshInterval?: RefreshInterval;
  kibanaSavedObjectMeta?: { searchSourceJSON?: string };
}

interface StoredPanel {
  panelIndex?: string | number;
  gridData?: Partial<GridItem>;
  panelRefName?: string;
  type?: string;
  id?: string;
  embeddableConfig?: Record<string, unknown>;
  title?: string;
  version?: string;
  // The oldest form kept the place in the grid loose on the panel, 12 columns wide
  col?: number;
  row?: number;
  size_x?: number;
  size_y?: number;
}

const parse = <T>(text: string | undefined, fallback: T): T => {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
};

export function emptyDashboard(): Dashboard {
  return {
    title: '',
    description: '',
    panels: [],
    options: { useMargins: true, hidePanelTitles: false },
    filters: [],
    timeRestore: false,
  };
}

export function dashboardFromSavedObject(object: {
  id: string;
  attributes: DashboardAttributes;
  references?: SavedObjectReference[];
  version?: string;
}): Dashboard {
  const references = object.references ?? [];
  const stored = parse<StoredPanel[]>(object.attributes.panelsJSON, []);
  const panels: PanelState[] = [];
  (Array.isArray(stored) ? stored : []).forEach((panel, index) => {
    const reference = panel.panelRefName ? references.find((candidate) => candidate.name === panel.panelRefName) : undefined;
    const type = reference?.type ?? panel.type;
    const id = reference?.id ?? panel.id;
    if (!type || !id) return;
    const panelIndex = String(panel.panelIndex ?? index + 1);
    const grid = panel.gridData;
    const gridData: GridItem = grid
      ? {
          i: panelIndex,
          x: Number(grid.x ?? 0),
          y: Number(grid.y ?? 0),
          w: Number(grid.w ?? DEFAULT_PANEL.w),
          h: Number(grid.h ?? DEFAULT_PANEL.h),
        }
      : {
          i: panelIndex,
          x: ((panel.col ?? 1) - 1) * 4,
          y: ((panel.row ?? 1) - 1) * 5,
          w: (panel.size_x ?? 6) * 4,
          h: (panel.size_y ?? 3) * 5,
        };
    panels.push({ panelIndex, gridData, type, id, embeddableConfig: panel.embeddableConfig ?? {}, title: panel.title, version: panel.version });
  });
  const source = parseSearchSource(object.attributes.kibanaSavedObjectMeta?.searchSourceJSON, references);
  const options = parse<Partial<DashboardOptions>>(object.attributes.optionsJSON, {});
  return {
    id: object.id,
    title: object.attributes.title ?? '',
    description: object.attributes.description ?? '',
    panels,
    options: { useMargins: options.useMargins !== false, hidePanelTitles: Boolean(options.hidePanelTitles) },
    query: source.query,
    filters: source.filters,
    timeRestore: Boolean(object.attributes.timeRestore),
    timeFrom: object.attributes.timeFrom,
    timeTo: object.attributes.timeTo,
    refreshInterval: object.attributes.refreshInterval,
    version: object.version,
  };
}

export function dashboardToSavedObject(dashboard: Dashboard): { attributes: DashboardAttributes; references: SavedObjectReference[] } {
  const source = serializeSearchSource({ query: dashboard.query, filters: dashboard.filters });
  const references = [...source.references];
  const panels = dashboard.panels.map((panel, index) => {
    const name = `panel_${index}`;
    references.push({ name, type: panel.type, id: panel.id });
    return {
      version: panel.version ?? '3.9.0',
      gridData: { ...panel.gridData, i: panel.panelIndex },
      panelIndex: panel.panelIndex,
      embeddableConfig: panel.embeddableConfig,
      ...(panel.title !== undefined ? { title: panel.title } : {}),
      panelRefName: name,
    };
  });
  const attributes: DashboardAttributes = {
    title: dashboard.title,
    description: dashboard.description,
    hits: 0,
    panelsJSON: JSON.stringify(panels),
    optionsJSON: JSON.stringify(dashboard.options),
    version: 1,
    timeRestore: dashboard.timeRestore,
    kibanaSavedObjectMeta: { searchSourceJSON: source.searchSourceJSON },
  };
  if (dashboard.timeRestore) {
    attributes.timeFrom = dashboard.timeFrom;
    attributes.timeTo = dashboard.timeTo;
    attributes.refreshInterval = dashboard.refreshInterval;
  }
  return { attributes, references };
}

// --- The grid -------------------------------------------------------------------------------------

const collides = (a: GridItem, b: GridItem) =>
  a.i !== b.i && a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

const byPlace = (a: GridItem, b: GridItem) => a.y - b.y || a.x - b.x;

/** Lets every panel rise as far as the ones above it allow */
export function compact(items: GridItem[]): GridItem[] {
  const placed: GridItem[] = [];
  for (const item of [...items].sort(byPlace)) {
    const next = { ...item, x: Math.max(0, Math.min(item.x, GRID_COLUMNS - item.w)), y: Math.max(0, item.y) };
    while (next.y > 0 && !placed.some((other) => collides({ ...next, y: next.y - 1 }, other))) next.y -= 1;
    for (let hit = placed.find((other) => collides(next, other)); hit; hit = placed.find((other) => collides(next, other))) {
      next.y = hit.y + hit.h;
    }
    placed.push(next);
  }
  return items.map((item) => placed.find((other) => other.i === item.i) as GridItem);
}

/** Puts one panel where it is wanted, at the size wanted, and moves the others out of its way */
export function placeItem(items: GridItem[], wanted: GridItem): GridItem[] {
  const w = Math.max(MIN_PANEL.w, Math.min(wanted.w, GRID_COLUMNS));
  const moved: GridItem = {
    ...wanted,
    w,
    h: Math.max(MIN_PANEL.h, wanted.h),
    x: Math.max(0, Math.min(wanted.x, GRID_COLUMNS - w)),
    y: Math.max(0, wanted.y),
  };
  const placed: GridItem[] = [moved];
  for (const item of items.filter((other) => other.i !== moved.i).sort(byPlace)) {
    const next = { ...item };
    for (let hit = placed.find((other) => collides(next, other)); hit; hit = placed.find((other) => collides(next, other))) {
      next.y = hit.y + hit.h;
    }
    placed.push(next);
  }
  // The moved panel keeps its place ahead of those it pushed: they are compacted after it
  const result = compact(placed);
  return items.map((item) => result.find((other) => other.i === item.i) as GridItem);
}

/** Where a new panel goes: the first free place of its size, reading the grid like a page */
export function findPlace(items: GridItem[], w = DEFAULT_PANEL.w, h = DEFAULT_PANEL.h): { x: number; y: number } {
  const bottom = items.reduce((max, item) => Math.max(max, item.y + item.h), 0);
  for (let y = 0; y <= bottom; y += 1) {
    for (let x = 0; x <= GRID_COLUMNS - w; x += 1) {
      const candidate = { i: '', x, y, w, h };
      if (!items.some((item) => collides(candidate, { ...item, i: item.i || '-' }))) return { x, y };
    }
  }
  return { x: 0, y: bottom };
}

export function nextPanelIndex(panels: PanelState[]): string {
  const numbers = panels.map((panel) => Number(panel.panelIndex)).filter((value) => Number.isFinite(value));
  return String((numbers.length ? Math.max(...numbers) : 0) + 1);
}

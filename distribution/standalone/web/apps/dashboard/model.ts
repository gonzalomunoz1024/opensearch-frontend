/* SPDX-License-Identifier: Apache-2.0 */

/*
 * A dashboard as it is saved, and the arithmetic of its grid. The saved object keeps the panels
 * as JSON text, each naming its visualization or saved search through a reference; the grid has
 * 48 columns and rows 20 pixels high, as in OpenSearch Dashboards, so saved layouts keep theirs.
 */

import type { SavedObjectReference } from '../../../common/saved_objects';
import { parseSearchSource, serializeSearchSource } from '../../lib/search_source';
import type { Filter, Query, RefreshInterval } from '../../lib/types';
import { encodeState } from '../../lib/url';

export const GRID_COLUMNS = 48;
export const ROW_HEIGHT = 20;
export const GRID_MARGIN = 8;
export const DEFAULT_PANEL = { w: 24, h: 15 };
/** The smallest a panel can be made: one cell, as in the original */
export const MIN_PANEL = { w: 1, h: 1 };
/** The version the original writes on every panel it saves: its own */
export const PANEL_VERSION = '3.9.0';

/** A panel's place, its keys in the order the original's grid writes them */
export interface GridItem {
  x: number;
  y: number;
  w: number;
  h: number;
  i: string;
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
}

/** The dashboard's options, kept as they were saved: what the original does not know stays */
export interface DashboardOptions {
  useMargins?: boolean;
  hidePanelTitles?: boolean;
  useSharedCrosshair?: boolean;
  [key: string]: unknown;
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
  /** Kept from the saved object and written back as they were: this build does not edit them */
  hits?: number;
  attributesVersion?: number;
  variablesJSON?: string;
  layoutJSON?: string;
  /** The search source as it was saved: its other fields are written back in their places */
  searchSourceFields?: Record<string, unknown>;
  /** An index pattern the search source names, which dashboards do not use but keep */
  indexId?: string;
}

export interface DashboardAttributes {
  title: string;
  hits?: number;
  description?: string;
  panelsJSON?: string;
  optionsJSON?: string;
  variablesJSON?: string;
  layoutJSON?: string;
  version?: number;
  timeRestore?: boolean;
  timeTo?: string;
  timeFrom?: string;
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
  // Before 6.4 a saved search's columns and sort were beside the panel's settings
  columns?: unknown;
  sort?: unknown;
}

/**
 * The form of a panel saved before 6.4, told apart as the original does when it opens a dashboard
 * (migratePanelsTo730): by its loose row, then by its version.
 */
function oldForm(panel: StoredPanel): 'loose' | '6.1' | '6.2' | '6.3' | undefined {
  if (panel.row !== undefined) return 'loose';
  const minor = /^6\.([123])\.\d+$/.exec(panel.version ?? '')?.[1];
  return minor === '1' ? '6.1' : minor === '2' ? '6.2' : minor === '3' ? '6.3' : undefined;
}

const parse = <T>(text: string | undefined, fallback: T): T => {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** A new dashboard, with the options the original gives one */
export function emptyDashboard(): Dashboard {
  return {
    title: '',
    description: '',
    panels: [],
    options: { useMargins: true, hidePanelTitles: false, useSharedCrosshair: false },
    filters: [],
    timeRestore: false,
  };
}

const gridItem = (panelIndex: string, x: number, y: number, w: number, h: number): GridItem => ({ x, y, w, h, i: panelIndex });

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
    const form = oldForm(panel);
    // 6.1 and 6.2 kept their grid in 12 columns, a row five of today's: the original brings them
    // to today's cells (the height always by 5 there: it never hands the migration the margins)
    const [across, down] = form === '6.1' || form === '6.2' ? [4, 5] : [1, 1];
    const cells = (value: number | undefined, fallback: number, by: number) => (value === undefined ? fallback : Number(value) * by);
    const gridData = grid
      ? gridItem(panelIndex, cells(grid.x, 0, across), cells(grid.y, 0, down), cells(grid.w, DEFAULT_PANEL.w, across), cells(grid.h, DEFAULT_PANEL.h, down))
      : gridItem(panelIndex, ((panel.col ?? 1) - 1) * 4, ((panel.row ?? 1) - 1) * 5, (panel.size_x ?? 6) * 4, (panel.size_y ?? 3) * 5);
    // Before 6.2 a panel had no settings of its own; before 6.4 a saved search's columns and sort
    // were beside them, and the original moves them in
    const settings = form === 'loose' || form === '6.1' ? {} : (panel.embeddableConfig ?? {});
    const embeddableConfig =
      form && (panel.columns || panel.sort)
        ? {
            ...settings,
            ...(panel.columns !== undefined ? { columns: panel.columns } : {}),
            ...(panel.sort !== undefined ? { sort: panel.sort } : {}),
          }
        : settings;
    panels.push({
      panelIndex,
      gridData,
      type,
      id,
      embeddableConfig,
      ...(panel.title !== undefined ? { title: panel.title } : {}),
    });
  });
  const source = parseSearchSource(object.attributes.kibanaSavedObjectMeta?.searchSourceJSON, references);
  const storedSource = parse<unknown>(object.attributes.kibanaSavedObjectMeta?.searchSourceJSON, {});
  const options = parse<unknown>(object.attributes.optionsJSON, {});
  const attributes = object.attributes;
  return {
    id: object.id,
    title: attributes.title ?? '',
    description: attributes.description ?? '',
    panels,
    options: isRecord(options) ? options : {},
    query: source.query,
    filters: source.filters,
    timeRestore: Boolean(attributes.timeRestore),
    timeFrom: attributes.timeFrom,
    timeTo: attributes.timeTo,
    refreshInterval: attributes.refreshInterval,
    version: object.version,
    hits: attributes.hits,
    attributesVersion: attributes.version,
    variablesJSON: attributes.variablesJSON,
    layoutJSON: attributes.layoutJSON,
    searchSourceFields: isRecord(storedSource) ? storedSource : undefined,
    indexId: source.indexId,
  };
}

/** A time as the original saves it with a dashboard: relative ones as they are, others in UTC */
export function timeAsSaved(time: string): string {
  if (/^now/.test(time.trim())) return time;
  const date = new Date(time);
  return Number.isNaN(date.getTime()) ? time : date.toISOString();
}

/** The attributes and references the original writes for a dashboard, in the order it writes them */
export function dashboardToSavedObject(dashboard: Dashboard): { attributes: DashboardAttributes; references: SavedObjectReference[] } {
  const source = serializeSearchSource({
    indexId: dashboard.indexId,
    query: dashboard.query ?? { query: '', language: 'kuery' },
    filters: dashboard.filters,
  });
  // As the original writes its search source: the fields it had in their places, the query in
  // its own (or first), and the filters last
  const written = JSON.parse(source.searchSourceJSON) as Record<string, unknown>;
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(dashboard.searchSourceFields ?? {})) {
    if (key !== 'filter' && key !== 'sort' && key !== 'size') fields[key] = key in written ? written[key] : value;
  }
  for (const [key, value] of Object.entries(written)) if (key !== 'filter' && !(key in fields)) fields[key] = value;
  fields.filter = written.filter;
  const references = [...source.references];
  const panels = dashboard.panels.map((panel, index) => {
    const name = `panel_${index}`;
    references.push({ name, type: panel.type, id: panel.id });
    const { x, y, w, h } = panel.gridData;
    return {
      version: PANEL_VERSION,
      gridData: { x, y, w, h, i: panel.panelIndex },
      panelIndex: panel.panelIndex,
      embeddableConfig: panel.embeddableConfig,
      ...(panel.title !== undefined ? { title: panel.title } : {}),
      panelRefName: name,
    };
  });
  const attributes: DashboardAttributes = {
    title: dashboard.title,
    hits: dashboard.hits ?? 0,
    description: dashboard.description,
    panelsJSON: JSON.stringify(panels),
    optionsJSON: JSON.stringify(dashboard.options),
  };
  if (dashboard.variablesJSON !== undefined) attributes.variablesJSON = dashboard.variablesJSON;
  if (dashboard.layoutJSON !== undefined) attributes.layoutJSON = dashboard.layoutJSON;
  attributes.version = dashboard.attributesVersion ?? 1;
  attributes.timeRestore = dashboard.timeRestore;
  if (dashboard.timeRestore) {
    if (dashboard.timeTo !== undefined) attributes.timeTo = timeAsSaved(dashboard.timeTo);
    if (dashboard.timeFrom !== undefined) attributes.timeFrom = timeAsSaved(dashboard.timeFrom);
    if (dashboard.refreshInterval) {
      attributes.refreshInterval = { pause: dashboard.refreshInterval.pause, value: dashboard.refreshInterval.value };
    }
  }
  attributes.kibanaSavedObjectMeta = { searchSourceJSON: JSON.stringify(fields) };
  return { attributes, references };
}

// --- The address -----------------------------------------------------------------------------------

/** A panel as the original carries it in the address while a dashboard is edited */
export interface UrlPanel {
  embeddableConfig: Record<string, unknown>;
  gridData: GridItem;
  id: string;
  panelIndex: string;
  title?: string;
  type: string;
  version: string;
}

export function panelsToUrl(panels: PanelState[]): UrlPanel[] {
  return panels.map((panel) => ({
    embeddableConfig: panel.embeddableConfig,
    gridData: panel.gridData,
    id: panel.id,
    panelIndex: panel.panelIndex,
    ...(panel.title !== undefined ? { title: panel.title } : {}),
    type: panel.type,
    version: PANEL_VERSION,
  }));
}

/** The panels an address carries, or nothing when it carries none that can be read */
export function panelsFromUrl(value: unknown): PanelState[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const panels: PanelState[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.id !== 'string' || typeof entry.type !== 'string') continue;
    const panelIndex = String(entry.panelIndex ?? panels.length + 1);
    const grid = isRecord(entry.gridData) ? entry.gridData : {};
    panels.push({
      panelIndex,
      gridData: gridItem(panelIndex, Number(grid.x ?? 0), Number(grid.y ?? 0), Number(grid.w ?? DEFAULT_PANEL.w), Number(grid.h ?? DEFAULT_PANEL.h)),
      type: entry.type,
      id: entry.id,
      embeddableConfig: isRecord(entry.embeddableConfig) ? entry.embeddableConfig : {},
      ...(typeof entry.title === 'string' ? { title: entry.title } : {}),
    });
  }
  return panels;
}

/**
 * Whether two lists of panels differ in what is saved of them. The order of the keys of a panel's
 * settings is not a difference: the address sorts them, so the panels read back from it while a
 * dashboard is edited would else differ from the saved ones before anything was changed.
 */
export function panelsDiffer(a: PanelState[], b: PanelState[]): boolean {
  return encodeState(panelsToUrl(a)) !== encodeState(panelsToUrl(b));
}

/** The id the original gives a panel it adds: a random UUID */
export function newPanelIndex(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// --- The grid -------------------------------------------------------------------------------------
//
// The original's grid is react-grid-layout 1.5, with its panels packed upwards, none fixed and none
// allowed to overlap. What follows takes its steps one by one, in its order: which panel gives way
// to which, and which moves down, decides the layout a user sees and the one a dashboard saves.

/** A panel's place while panels are being moved: whether it has moved in the step being taken */
interface Cell extends GridItem {
  moved?: boolean;
}

const toCell = (item: GridItem): Cell => ({ x: item.x, y: item.y, w: item.w, h: item.h, i: item.i });
const toItem = (cell: Cell): GridItem => ({ x: cell.x, y: cell.y, w: cell.w, h: cell.h, i: cell.i });

const collides = (a: GridItem, b: GridItem) =>
  a.i !== b.i && a.x + a.w > b.x && a.x < b.x + b.w && a.y + a.h > b.y && a.y < b.y + b.h;

const firstCollision = <T extends GridItem>(layout: T[], item: GridItem): T | undefined =>
  layout.find((other) => collides(other, item));

/** By row, then column; panels in the same place keep their order */
const byRowThenColumn = <T extends GridItem>(layout: T[]): T[] =>
  [...layout].sort((a, b) => (a.y > b.y || (a.y === b.y && a.x > b.x) ? 1 : a.y === b.y && a.x === b.x ? 0 : -1));

/** Moves a panel down to `to`, having first moved down the panels after it that it would cover */
function resolveCompactionCollision(sorted: Cell[], item: Cell, to: number): void {
  item.y += 1;
  const index = sorted.findIndex((other) => other.i === item.i);
  for (let next = index + 1; next < sorted.length; next += 1) {
    const other = sorted[next];
    if (other.y > item.y + item.h) break;
    if (collides(item, other)) resolveCompactionCollision(sorted, other, to + item.h);
  }
  item.y = to;
}

function compactItem(placed: Cell[], item: Cell, sorted: Cell[], bottom: number): void {
  item.y = Math.min(bottom, item.y);
  while (item.y > 0 && !firstCollision(placed, item)) item.y -= 1;
  for (let hit = firstCollision(placed, item); hit; hit = firstCollision(placed, item)) {
    resolveCompactionCollision(sorted, item, hit.y + hit.h);
  }
  item.y = Math.max(item.y, 0);
  item.x = Math.max(item.x, 0);
}

/** Lets every panel rise as far as those above it allow; the panels come back in their order */
export function compact(layout: GridItem[]): GridItem[] {
  const work = layout.map(toCell);
  const sorted = byRowThenColumn(work);
  const placed: Cell[] = [];
  const out = new Array<GridItem>(work.length);
  let bottom = 0;
  for (const original of sorted) {
    const item = toCell(original);
    compactItem(placed, item, sorted, bottom);
    bottom = Math.max(bottom, item.y + item.h);
    placed.push(item);
    out[work.indexOf(original)] = toItem(item);
  }
  return out;
}

/** The layout as the grid takes it from a dashboard: each panel inside the columns, then packed */
export function settleLayout(layout: GridItem[]): GridItem[] {
  return compact(
    layout.map((item) => {
      const cell = toCell(item);
      if (cell.x + cell.w > GRID_COLUMNS) cell.x = GRID_COLUMNS - cell.w;
      if (cell.x < 0) {
        cell.x = 0;
        cell.w = GRID_COLUMNS;
      }
      return cell;
    })
  );
}

function moveElement(layout: Cell[], item: Cell, x: number | undefined, y: number | undefined, byUser: boolean): void {
  if (item.y === y && item.x === x) return;
  const oldY = item.y;
  if (x !== undefined) item.x = x;
  if (y !== undefined) item.y = y;
  item.moved = true;
  // The nearest collision first: going up, the panels are looked at from the bottom
  let sorted = byRowThenColumn(layout);
  if (y !== undefined && oldY >= y) sorted = sorted.reverse();
  for (const collision of sorted.filter((other) => collides(other, item))) {
    if (collision.moved) continue;
    moveAway(layout, item, collision, byUser);
  }
}

/** Moves a panel out of the way of one that came onto it: above it if it fits there, else down */
function moveAway(layout: Cell[], collidesWith: Cell, item: Cell, byUser: boolean): void {
  if (byUser) {
    const above: GridItem = { x: item.x, y: Math.max(collidesWith.y - item.h, 0), w: item.w, h: item.h, i: '-1' };
    if (!firstCollision(layout, above)) {
      moveElement(layout, item, undefined, above.y, false);
      return;
    }
  }
  moveElement(layout, item, undefined, item.y + 1, false);
}

/** One step of a panel being moved: it is put over the cell given, the others make way, all pack */
export function moveItem(layout: GridItem[], id: string, x: number, y: number): GridItem[] {
  const work = layout.map(toCell);
  const item = work.find((cell) => cell.i === id);
  if (!item) return layout;
  moveElement(work, item, x, y, true);
  return compact(work);
}

/** One step of a panel being sized from its lower right corner: it takes the size, all pack */
export function resizeItem(layout: GridItem[], id: string, w: number, h: number): GridItem[] {
  return compact(layout.map((item) => (item.i === id ? { ...item, w, h } : item)));
}

/** Whether two layouts put some panel in another place or at another size */
export function layoutsDiffer(a: GridItem[], b: GridItem[]): boolean {
  if (a.length !== b.length) return true;
  return a.some((item) => {
    const other = b.find((candidate) => candidate.i === item.i);
    return !other || other.x !== item.x || other.y !== item.y || other.w !== item.w || other.h !== item.h;
  });
}

/** The cell a panel being moved is over, from how far the pointer has gone, as the grid works it out */
export function cellUnder(origin: GridItem, dx: number, dy: number, columnWidth: number, margin: number): { x: number; y: number } {
  const left = Math.round((columnWidth + margin) * origin.x) + dx;
  const top = (ROW_HEIGHT + margin) * origin.y + dy;
  const x = Math.round(left / (columnWidth + margin));
  const y = Math.round(top / (ROW_HEIGHT + margin));
  return { x: Math.max(0, Math.min(x, GRID_COLUMNS - origin.w)), y: Math.max(0, y) };
}

/** A panel being sized, in pixels, as the original's resizable box follows the pointer */
export interface Sizing {
  /** The box's size; it is drawn, and grows from, rounded to whole pixels */
  width: number;
  height: number;
  /** How far the pointer has gone past the smallest size: it is taken back before the panel grows */
  slack: [number, number];
}

export function startSizing(origin: GridItem, columnWidth: number, margin: number): Sizing {
  return {
    width: Math.round(columnWidth * origin.w + margin * (origin.w - 1)),
    height: ROW_HEIGHT * origin.h + margin * (origin.h - 1),
    slack: [0, 0],
  };
}

/**
 * One move of the pointer on a panel's corner: the box grows by what the pointer moved, never
 * under one cell nor over the grid's width; a width that would take it past the grid's right
 * edge is not taken, and it keeps the width it had.
 */
export function sizingStep(sizing: Sizing, dx: number, dy: number, origin: GridItem, columnWidth: number, margin: number): Sizing {
  const shown = { width: Math.round(sizing.width), height: Math.round(sizing.height) };
  const askedWidth = shown.width + dx;
  const askedHeight = shown.height + dy;
  const fullWidth = Math.round(columnWidth * GRID_COLUMNS + margin * (GRID_COLUMNS - 1));
  const width = Math.min(fullWidth, Math.max(Math.round(columnWidth), askedWidth + sizing.slack[0]));
  const height = Math.max(ROW_HEIGHT, askedHeight + sizing.slack[1]);
  const slack: [number, number] = [sizing.slack[0] + askedWidth - width, sizing.slack[1] + askedHeight - height];
  // The grid's own width: its padding, as wide as its margins, is on both sides
  const gridWidth = columnWidth * GRID_COLUMNS + margin * (GRID_COLUMNS - 1) + 2 * margin;
  const left = Math.round((columnWidth + margin) * origin.x) + margin;
  return { width: left + width > gridWidth ? shown.width : width, height, slack };
}

/** The cells a panel being sized covers, from its size in pixels */
export function sizedCells(sizing: Sizing, origin: GridItem, columnWidth: number, margin: number): { w: number; h: number } {
  const w = Math.round((sizing.width + margin) / (columnWidth + margin));
  const h = Math.round((sizing.height + margin) / (ROW_HEIGHT + margin));
  return { w: Math.max(MIN_PANEL.w, Math.min(w, GRID_COLUMNS - origin.x)), h: Math.max(MIN_PANEL.h, h) };
}

/** The ids of panels in reading order: the order the original's grid holds them and hands them back */
export function readingOrder(panels: PanelState[]): string[] {
  return [...panels]
    .sort((a, b) => (a.gridData.y === b.gridData.y ? a.gridData.x - b.gridData.x : a.gridData.y - b.gridData.y))
    .map((panel) => panel.panelIndex);
}

/** Whether an id is one a JavaScript object lists first, in numeric order: a whole number */
const isIndexKey = (id: string) => /^(0|[1-9][0-9]*)$/.test(id) && Number(id) < 4294967295;

/**
 * The panels in the order the original keeps them after a change. It holds them in an object
 * keyed by id, in the order `base` names them and those new to it after, and an object lists its
 * keys that are whole numbers first, in numeric order.
 */
export function orderAsOriginal(next: PanelState[], base: string[]): PanelState[] {
  const byId = new Map(next.map((panel) => [panel.panelIndex, panel]));
  const ids = [...new Set([...base.filter((id) => byId.has(id)), ...next.map((panel) => panel.panelIndex)])];
  const numbers = ids.filter(isIndexKey).sort((a, b) => Number(a) - Number(b));
  return [...numbers, ...ids.filter((id) => !isIndexKey(id))].flatMap((id) => {
    const panel = byId.get(id);
    return panel ? [panel] : [];
  });
}

/** Whether two lists hold the same panels, whatever their order */
export function samePanels(a: PanelState[], b: PanelState[]): boolean {
  if (a.length !== b.length) return false;
  const known = new Map(panelsToUrl(b).map((panel, index) => [b[index].panelIndex, JSON.stringify(panel)]));
  return panelsToUrl(a).every((panel, index) => known.get(a[index].panelIndex) === JSON.stringify(panel));
}

/**
 * Where a new panel goes, found as the original finds it: the first cell free, reading the grid
 * like a page, from which the panel's last row is free too. The rows between are not looked at,
 * nor the rows under the lowest panel; the grid then moves down whatever the new panel covers.
 */
export function findPlace(
  items: ReadonlyArray<{ x: number; y: number; w: number; h: number; i?: string }>,
  w = DEFAULT_PANEL.w,
  h = DEFAULT_PANEL.h
): { x: number; y: number } {
  const maxY = items.reduce((max, item) => Math.max(max, item.y + item.h), -1);
  if (maxY < 0) return { x: 0, y: 0 };
  const grid: number[][] = Array.from({ length: maxY }, () => new Array<number>(GRID_COLUMNS).fill(0));
  for (const item of items) {
    for (let x = item.x; x < item.x + item.w; x += 1) {
      for (let y = item.y; y < item.y + item.h; y += 1) {
        if (grid[y]) grid[y][x] = 1;
      }
    }
  }
  for (let y = 0; y < maxY; y += 1) {
    for (let x = 0; x < GRID_COLUMNS; x += 1) {
      if (grid[y][x] === 1) continue;
      for (let row = y; row < Math.min(y + h, maxY); row += 1) {
        for (let column = x; column < Math.min(x + w, GRID_COLUMNS); column += 1) {
          const lastRow = row === Math.min(y + h - 1, maxY - 1);
          if (grid[row][column] === 0 && column === x + w - 1 && lastRow) return { x, y };
          if (grid[row][column] === 1) break;
        }
      }
    }
  }
  return { x: 0, y: maxY };
}

/**
 * Where the copy of a panel goes, as the original places a cloned panel: to its right, at the
 * start of the row under it, or under it; failing those, under it, and the panels after it in
 * the grid move down to make room.
 */
export function placeBeside(items: GridItem[], besideId: string): { place: { x: number; y: number }; moved: GridItem[] } {
  const beside = items.find((item) => item.i === besideId);
  if (!beside) return { place: findPlace(items, DEFAULT_PANEL.w, DEFAULT_PANEL.h), moved: items };
  const { w, h } = beside;
  const candidates = [
    { x: beside.x + beside.w, y: beside.y },
    { x: 0, y: beside.y + beside.h },
    { x: beside.x, y: beside.y + beside.h },
  ];
  for (const candidate of candidates) {
    if (candidate.x < 0 || candidate.x + w > GRID_COLUMNS || candidate.y < 0) continue;
    const box = { ...candidate, w, h, i: '' };
    if (!items.some((item) => collides(box, { ...item, i: item.i || '-' }))) return { place: candidate, moved: items };
  }
  // Panels in order of where they end: lower first by their bottom, then by their right edge
  const ordered = [...items].sort((a, b) =>
    a.y + a.h !== b.y + b.h ? a.y + a.h - (b.y + b.h) : a.x + a.w <= b.x + b.w ? -1 : 1
  );
  const position = ordered.findIndex((item) => item.i === besideId);
  const below = candidates[2];
  const next = ordered[position + 1];
  if (!next) return { place: below, moved: items };
  const shift = below.y + h - next.y;
  const shifted = new Set(ordered.slice(position + 1).map((item) => item.i));
  return {
    place: below,
    moved: items.map((item) => (shifted.has(item.i) ? { ...item, y: item.y + shift } : item)),
  };
}

// --- The filters a saved search panel makes ------------------------------------------------------

/**
 * The original's getExistingFilter: the dashboard's own filter on this value of a field (a phrase,
 * scripted or not), or, for `presence`, on the field being there
 */
export function existingFilter(filters: Filter[], name: string, value: unknown, presence: boolean): Filter | undefined {
  return filters.find((filter) => {
    if (presence) return (filter.exists as { field?: unknown } | undefined)?.field === value;
    const phrase = (filter.query as { match_phrase?: Record<string, unknown> } | undefined)?.match_phrase;
    if (phrase) {
      const [field] = Object.keys(phrase);
      const given = field === undefined ? undefined : phrase[field];
      const asked = given !== null && typeof given === 'object' ? (given as { query?: unknown }).query : given;
      return field === name && asked === value;
    }
    const script = (filter.script as { script?: { params?: { value?: unknown } } } | undefined)?.script;
    return Boolean(script) && filter.meta?.field === name && script?.params?.value === value;
  });
}

/** A filter the dashboard has, taken again by a button: turned on, negated as asked */
export const takenAgain = (filter: Filter, negate: boolean): Filter => ({
  ...filter,
  meta: { ...filter.meta, disabled: false, negate },
  $state: { store: 'appState' },
});

// --- What a panel's menu offers ------------------------------------------------------------------

/**
 * The kinds of visualization whose panel the original offers no Inspect for: their types give the
 * inspector nothing to show (`inspectorAdapters: {}`), the controls, Markdown, TSVB and Timeline
 */
const NOT_INSPECTED = new Set(['input_control_vis', 'markdown', 'metrics', 'timelion']);

/** Whether a panel drawing a visualization of this kind offers Inspect, as in the original */
export const offersInspector = (visType: string): boolean => !NOT_INSPECTED.has(visType);

// --- The round trip to an editor -----------------------------------------------------------------

/** The original's id of the dashboards app: where an editor sent from a dashboard goes back to */
export const DASHBOARDS_APP = 'dashboards';

/** The dashboard a panel is in, as the original names it to the editor it sends the panel to */
export interface ContainerInfo {
  containerName: string;
  containerId: string;
}

/** What the original's "Edit visualization" hands the editor in the history (EmbeddableEditorState) */
export interface EditorState {
  originatingApp: string;
  valueInput?: Record<string, unknown>;
  embeddableId?: string;
  containerInfo?: ContainerInfo;
}

/** What the original's edit action hands the editor for a panel, which is by reference */
export const editorStateFor = (panelIndex: string, container: ContainerInfo): EditorState => ({
  originatingApp: DASHBOARDS_APP,
  valueInput: undefined,
  embeddableId: panelIndex,
  containerInfo: container,
});

/** What an editor hands back to the dashboard it came from (the original's EmbeddablePackageState) */
export interface HandedPanel {
  type: string;
  input: { savedObjectId?: string } & Record<string, unknown>;
  embeddableId?: string;
  containerInfo?: unknown;
}

/** The state of the history read as a panel handed back: a type, and an input that is an object */
export function handedPanel(state: unknown): HandedPanel | undefined {
  if (state === null || typeof state !== 'object') return undefined;
  const { type, input } = state as { type?: unknown; input?: unknown };
  if (typeof type !== 'string' || input === null || typeof input !== 'object' || Array.isArray(input)) return undefined;
  return state as HandedPanel;
}

/**
 * The panels with what an editor handed back in them, as the original's dashboard takes it when it
 * opens: the panel it was sent from, still in its place, with the type and the input it was given
 * over its own; else a new panel where "Add panels" puts one, after the others. A new panel the
 * dashboard could not draw, with no saved object, is left out. `undefined` when nothing changes.
 */
export function withHandedPanel(panels: PanelState[], handed: HandedPanel, newIndex: () => string): PanelState[] | undefined {
  const { id: _id, savedObjectId, title, ...config } = handed.input;
  const ownTitle = typeof title === 'string' ? { title } : {};
  const sentFrom = handed.embeddableId === undefined ? undefined : panels.find((panel) => panel.panelIndex === handed.embeddableId);
  if (sentFrom) {
    const replaced: PanelState = {
      ...sentFrom,
      type: handed.type,
      id: typeof savedObjectId === 'string' ? savedObjectId : sentFrom.id,
      embeddableConfig: { ...sentFrom.embeddableConfig, ...config },
      ...ownTitle,
    };
    return panels.map((panel) => (panel === sentFrom ? replaced : panel));
  }
  if (typeof savedObjectId !== 'string') return undefined;
  const panelIndex = newIndex();
  const place = findPlace(panels.map((panel) => panel.gridData));
  const added: PanelState = {
    panelIndex,
    gridData: { x: place.x, y: place.y, w: DEFAULT_PANEL.w, h: DEFAULT_PANEL.h, i: panelIndex },
    type: handed.type,
    id: savedObjectId,
    embeddableConfig: config,
    ...ownTitle,
  };
  return [...panels, added];
}

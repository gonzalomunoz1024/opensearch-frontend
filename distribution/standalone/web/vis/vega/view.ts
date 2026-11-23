/* SPDX-License-Identifier: Apache-2.0 */

/*
 * A Vega view in a panel, as OpenSearch Dashboards sets one up: the warnings and errors of the
 * spec over the chart, the controls of bound signals beside it, the size of the panel, the
 * theme's palette, tooltips placed as the product places them, and the functions a spec can call
 * to add or remove filters and to change the time range.
 */

import { parseDateMath, type TimeRange } from '../../lib/dates';
import type { Filter } from '../../lib/types';
import { BYPASS_TOKEN, type TrustedUrl } from './data_parsers';
import { createExpressionInterpreter, type ExpressionInterpreter } from './interpreter';
import type { Fn, VegaItem, VegaLibraries, VegaView } from './library';
import type { TooltipConfig, VegaParser } from './parser';
import { escapeHtml, formatErrorToStr, formatWarningToStr, messageText } from './utils';
import { SERIES_COLORS } from '../../charts/core';

// The functions a spec can call, and the method of the view that answers each
const VEGA_FUNCTIONS: Record<string, keyof VegaBaseView> = {
  opensearchDashboardsAddFilter: 'addFilterHandler',
  opensearchDashboardsRemoveFilter: 'removeFilterHandler',
  opensearchDashboardsRemoveAllFilters: 'removeAllFiltersHandler',
  opensearchDashboardsSetTimeFilter: 'setTimeFilterHandler',
  opensearchDashboardsVisEventTriggered: 'triggerExternalActionHandler',
  opensearchDashboardsSelectTimeRange: 'selectTimeRange',
};

const prepared = new WeakSet<object>();
const interpreters = new WeakMap<object, ExpressionInterpreter>();

/** The palette and the functions are Vega's globals: set once for the library */
function prepareLibrary(libraries: VegaLibraries): ExpressionInterpreter {
  const { vega } = libraries;
  if (!prepared.has(vega)) {
    prepared.add(vega);
    vega.scheme('euiPaletteColorBlind', [...SERIES_COLORS]);
    for (const name of Object.keys(VEGA_FUNCTIONS)) {
      if (!vega.expressionFunction(name)) {
        vega.expressionFunction(name, function handlerFwd(this: { context: { dataflow: VegaView } }, ...args: unknown[]) {
          const view = this.context.dataflow;
          view.runAfter(() => view._opensearchDashboardsView?.vegaFunctionsHandler(name, ...args));
        } as Fn);
      }
    }
    interpreters.set(vega, createExpressionInterpreter((a, b) => vega.ascending(a, b)));
  }
  return interpreters.get(vega) as ExpressionInterpreter;
}

/** What the panel gives the view: how to change the page's filters and time range */
export interface VegaViewOptions {
  parentEl: HTMLElement;
  parser: VegaParser;
  libraries: VegaLibraries;
  enableExternalUrls: boolean;
  /** Filters a spec adds, and the time range it sets as a filter on every time field */
  applyFilter(event: { filters: Filter[] } | { timeFieldName: string; range: TimeRange }): void;
  getFilters(): Filter[];
  setFilters(filters: Filter[]): void;
  /** The id of an index pattern by its title; that of the spec's index, or the default one */
  findIndexPattern(title?: string): Promise<string | undefined>;
  findSpecIndexPattern(): Promise<string | undefined>;
  signalStateManager: VegaSignalStateManager | null;
  /** The view and spec, for Inspect */
  onDebugValues?(values: { view: VegaView; spec: unknown }): void;
}

type DestroyHandler = () => unknown;

/** What the original puts on the window for the browser's console: the view, its specs and the versions */
export interface VegaDebugObject {
  VEGA_VERSION?: string;
  VEGA_LITE_VERSION?: string;
  view?: VegaView;
  vega_spec?: unknown;
  vegalite_spec?: unknown;
}

type DebugScope = { VEGA_DEBUG?: VegaDebugObject | null };

/**
 * window.VEGA_DEBUG, as the original sets it with vis_type_vega.exposeDebugObjectToWindow (its
 * default, which this product does not read): the latest view's, with a welcome in the console the
 * first time. What is returned takes it away again, if no later view has put its own there; it
 * leaves null rather than nothing, so that the welcome is not said again.
 */
export function exposeDebugObject(
  scope: DebugScope,
  values: Required<Omit<VegaDebugObject, 'view'>> & { view: VegaView },
  log: (...args: unknown[]) => void
): () => void {
  if (scope.VEGA_DEBUG === undefined) {
    log('%cWelcome to OpenSearch Dashboards Vega Plugin!', 'font-size: 16px; font-weight: bold;');
    log('You can access the Vega view with VEGA_DEBUG. Learn more at https://vega.github.io/vega/docs/api/debugging/.');
  }
  const debugObject: VegaDebugObject = {};
  scope.VEGA_DEBUG = debugObject;
  debugObject.VEGA_VERSION = values.VEGA_VERSION;
  debugObject.VEGA_LITE_VERSION = values.VEGA_LITE_VERSION;
  debugObject.view = values.view;
  debugObject.vega_spec = values.vega_spec;
  debugObject.vegalite_spec = values.vegalite_spec;
  return () => {
    if (scope.VEGA_DEBUG === debugObject) scope.VEGA_DEBUG = null;
  };
}

const clone =<T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/**
 * An object that cannot reach a prototype, as @osd/std's validateObject checks it: no `__proto__`
 * key anywhere, no `prototype` under a `constructor` key, and no object in itself
 */
export function validateObject(obj: unknown) {
  const isObject = (value: unknown): value is object => typeof value === 'object' && value !== null;
  const hasOwn = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
  if (!isObject(obj)) return;
  const stack: Array<{ value: unknown; previousKey: string | null }> = [{ value: obj, previousKey: null }];
  const seen = new WeakSet<object>([obj]);
  while (stack.length > 0) {
    const { value, previousKey } = stack.pop() as { value: unknown; previousKey: string | null };
    if (!isObject(value)) continue;
    if (hasOwn(value, '__proto__')) throw new Error(`'__proto__' is an invalid key`);
    if (hasOwn(value, 'prototype') && previousKey === 'constructor') throw new Error(`'constructor.prototype' is an invalid key`);
    const entries = Object.entries(value);
    for (let index = entries.length - 1; index >= 0; --index) {
      const [key, childValue] = entries[index];
      if (isObject(childValue)) {
        if (seen.has(childValue)) throw new Error('circular reference detected');
        seen.add(childValue);
      }
      stack.push({ value: childValue, previousKey: key });
    }
  }
}

const isPlainRecord = (value: unknown): value is object => Boolean(value && typeof value === 'object' && !Array.isArray(value));

/** Whether an object holds a function, in itself, in an object in it or in a list in it */
export function checkForFunctionProperty(object: object): boolean {
  for (const value of Object.values(object)) {
    if (typeof value === 'function') return true;
    if (isPlainRecord(value) && checkForFunctionProperty(value)) return true;
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'function') return true;
        if (isPlainRecord(item) && checkForFunctionProperty(item)) return true;
      }
    }
  }
  return false;
}

/** A query a spec gave, as a filter can hold it: an object with no functions in it */
export function handleInvalidQuery(query: unknown): Record<string, unknown> | null {
  if (isPlainRecord(query) && !checkForFunctionProperty(query)) {
    validateObject(query);
    return clone(query as Record<string, unknown>);
  }
  return null;
}

const handleNonStringIndex = (index: unknown): string | undefined => (typeof index === 'string' ? index : undefined);

/** Deep equality whatever the order of keys, as lodash's isEqual has it for JSON values */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return Number.isNaN(a) && Number.isNaN(b);
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((key) => Object.prototype.hasOwnProperty.call(b, key) && sameValue((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}

/** A time a spec gave: a number that is one, a date or a text; otherwise none */
export function handleInvalidDate(date: unknown): number | string | Date | null {
  if (typeof date === 'number') return !Number.isNaN(date) ? date : null;
  if (date instanceof Date || typeof date === 'string') return date;
  return null;
}

/** A time a spec gave, read as moment reads one; undefined when it is not a date */
function absoluteDate(value: number | string | Date | null): Date | undefined {
  if (value === null) return undefined;
  if (typeof value === 'number' || value instanceof Date) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  // a date without a time zone is local, as moment has it
  const local = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const date = local ? new Date(Number(local[1]), Number(local[2]) - 1, Number(local[3])) : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * A time as @osd/datemath's parse reads one, without rounding up: `now` and its math, or a date
 * moment reads with math after `||`. As there, a number that is not 0 cannot be read as text.
 */
function dateMath(value: number | string | Date | null): Date | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return absoluteDate(value);
  if (typeof value !== 'string') throw new TypeError('text.substring is not a function');
  if (value.startsWith('now')) return parseDateMath(value);
  const split = value.indexOf('||');
  const base = absoluteDate(split === -1 ? value : value.slice(0, split));
  if (split === -1 || !base) return base;
  return parseDateMath(`${base.toISOString()}||${value.slice(split + 2)}`);
}

/** The start and end a spec gave, earliest first: absolute dates, or relative expressions */
export function parseTimeRange(start: number | string | Date | null, end: number | string | Date | null): TimeRange {
  const absStart = absoluteDate(start);
  const absEnd = absoluteDate(end);
  let from: string;
  let to: string;
  let reverse: boolean;
  if (absStart && absEnd) {
    from = absStart.toISOString();
    to = absEnd.toISOString();
    reverse = absStart.getTime() > absEnd.getTime();
  } else {
    const startDate = dateMath(start);
    const endDate = dateMath(end);
    if (!startDate || !endDate) {
      throw new Error(
        `Error setting time filter: both time values must be either relative or absolute dates. start=${JSON.stringify(start)}, end=${JSON.stringify(end)}`
      );
    }
    reverse = startDate.getTime() > endDate.getTime();
    if (absStart || absEnd) {
      // relative and absolute together: both absolute
      from = startDate.toISOString();
      to = endDate.toISOString();
    } else {
      from = String(start);
      to = String(end);
    }
  }
  return reverse ? { from: to, to: from } : { from, to };
}

export class VegaBaseView {
  protected parentEl: HTMLElement;
  protected parser: VegaParser;
  protected libraries: VegaLibraries;
  protected view: VegaView | null = null;
  protected viewConfig: Record<string, unknown> | null = null;
  protected viewOptions: { ast: boolean } | null = null;
  protected container: HTMLElement | null = null;
  protected controls: HTMLElement | null = null;
  private messages: HTMLElement | null = null;
  private destroyHandlers: DestroyHandler[] | null = [];
  private ongoingDestroy?: Promise<unknown>;
  private initialized = false;

  constructor(protected readonly options: VegaViewOptions) {
    this.parentEl = options.parentEl;
    this.parser = options.parser;
    this.libraries = options.libraries;
  }

  async init() {
    if (this.initialized) throw new Error();
    this.initialized = true;
    try {
      this.parentEl.replaceChildren();
      this.parentEl.classList.add('vgaVis');
      this.parentEl.style.flexDirection = this.parser.containerDir ?? '';

      // the parser's warnings are shown even where the spec hides the view's
      for (const warning of this.parser.warnings) this.addMessage('warn', warning);
      if (this.parser.error) {
        this.addMessage('err', this.parser.error);
        return;
      }

      this.container = document.createElement('div');
      this.container.className = 'vgaVis__view';
      this.container.style.height = '100%';
      this.parentEl.appendChild(this.container);
      this.controls = document.createElement('div');
      this.controls.className = `vgaVis__controls vgaVis__controls--${this.parser.controlsDir ?? 'column'}`;
      this.parentEl.appendChild(this.controls);

      this.addDestroyHandler(() => {
        if (this.view && this.options.signalStateManager) {
          this.options.signalStateManager.save(this.view, this.controls, this.getSignalNames());
        }
        this.container?.remove();
        this.container = null;
        this.controls?.remove();
        this.controls = null;
        this.messages?.remove();
        this.messages = null;
        this.view?.finalize();
        this.view = null;
      });

      this.viewConfig = this.createViewConfig();
      this.viewOptions = { ast: true };
      await this.initViewCustomizations();
    } catch (failure) {
      this.onError(failure);
    }
  }

  protected async initViewCustomizations(): Promise<void> {
    // a map view or a plain view
  }

  createViewConfig(): Record<string, unknown> {
    const { vega } = this.libraries;
    const interpreter = prepareLibrary(this.libraries);
    const config: Record<string, unknown> = { logLevel: vega.Warn, renderer: this.parser.renderer, expr: interpreter };
    // addresses are loaded only when the settings allow it, but for the maps service's own
    const loader = vega.loader();
    const originalSanitize = loader.sanitize.bind(loader);
    loader.sanitize = (uri: unknown, options: unknown) => {
      let target = uri;
      if ((uri as TrustedUrl | undefined)?.bypassToken === BYPASS_TOKEN) {
        target = (uri as TrustedUrl).url;
      } else if (!this.options.enableExternalUrls) {
        throw new Error('External URLs are not enabled. Add   vis_type_vega.enableExternalUrls: true   to opensearch_dashboards.yml');
      }
      return originalSanitize(target, options);
    };
    config.loader = loader;
    return config;
  }

  onError(...args: unknown[]) {
    this.addMessage('err', formatErrorToStr(...args));
  }

  onWarn(...args: unknown[]) {
    if (!this.parser || !this.parser.hideWarnings) this.addMessage('warn', formatWarningToStr(...args));
  }

  private addMessage(type: 'warn' | 'err', text: unknown) {
    if (!this.messages) {
      this.messages = document.createElement('ul');
      this.messages.className = 'vgaVis__messages';
      this.parentEl.appendChild(this.messages);
    }
    const item = document.createElement('li');
    item.className = `vgaVis__message vgaVis__message--${type}`;
    const code = document.createElement('pre');
    code.className = 'vgaVis__messageCode';
    code.textContent = messageText(text);
    item.appendChild(code);
    this.messages.appendChild(item);
  }

  resize(): Promise<unknown> | undefined {
    if (this.parser.useResize && this.view && this.updateVegaSize(this.view)) return this.view.runAsync();
    return undefined;
  }

  /** The view as large as its box, less a few pixels that would make the panel scroll */
  updateVegaSize(view: VegaView): boolean {
    const heightExtraPadding = 6;
    // the box's own width and height, fractions kept, as jQuery's width() and height() read them
    const style = this.container ? getComputedStyle(this.container) : undefined;
    const width = Math.max(0, parseFloat(style?.width ?? '0') || 0);
    const height = Math.max(0, parseFloat(style?.height ?? '0') || 0) - heightExtraPadding;
    if (view.width() !== width || view.height() !== height) {
      view.width(width).height(height);
      return true;
    }
    return false;
  }

  /** The signals bound to controls, whose values a refresh keeps when the spec asks it to */
  getSignalNames(): string[] {
    const signals = (this.parser.vegaSpec?.signals as Array<{ name?: string; bind?: unknown }> | undefined) || [];
    return signals.filter((signal) => signal?.name && signal.bind).map((signal) => signal.name as string);
  }

  setView(view: VegaView | null): Promise<unknown> | undefined {
    if (this.view === view) return undefined;
    this.view?.finalize();
    this.view = view;
    if (view) {
      view._opensearchDashboardsView = this;
      if (this.parser.tooltips && this.container) new TooltipHandler(this.container, view, this.parser.tooltips);
      return this.options.signalStateManager ? this.options.signalStateManager.restore(view, this.controls) : view.runAsync();
    }
    return undefined;
  }

  async vegaFunctionsHandler(name: string, ...args: unknown[]) {
    try {
      const handler = VEGA_FUNCTIONS[name];
      const method = handler ? (this[handler] as unknown) : undefined;
      if (typeof method !== 'function') throw new Error(`${name}() is not defined for this graph`);
      await (method as Fn).apply(this, args);
    } catch (failure) {
      this.onError(failure);
    }
  }

  /** The index pattern of a filter: the one named, else the spec's first, else the default */
  async findIndex(index?: string): Promise<string> {
    if (index) {
      const id = await this.options.findIndexPattern(index);
      if (!id) throw new Error(`Index "${index}" not found`);
      return id;
    }
    const id = (await this.options.findSpecIndexPattern()) ?? (await this.options.findIndexPattern());
    if (!id) throw new Error('Unable to find default index');
    return id;
  }

  /** opensearchDashboardsAddFilter(query, index, alias): a filter of OpenSearch query DSL */
  async addFilterHandler(query: unknown, index: unknown, alias: unknown) {
    const indexId = await this.findIndex(handleNonStringIndex(index));
    const filter = { query: handleInvalidQuery(query), meta: { index: indexId, alias } } as unknown as Filter;
    this.options.applyFilter({ filters: [filter] });
  }

  /** opensearchDashboardsVisEventTriggered: for the actions of other plugins, which this product has none of */
  triggerExternalActionHandler() {
    // nothing listens
  }

  /** opensearchDashboardsRemoveFilter(query, index): takes away the filter of that query */
  async removeFilterHandler(query: unknown, index: unknown) {
    await this.findIndex(handleNonStringIndex(index));
    // filters are the same when all but their settings are: meta and $state are left out
    const target = { query: handleInvalidQuery(query) };
    const current = this.options.getFilters();
    const existing = current.find((filter) => {
      const { meta: _meta, $state: _state, ...rest } = filter as Filter & { $$hashKey?: unknown };
      delete (rest as { $$hashKey?: unknown }).$$hashKey;
      return sameValue(rest, target);
    });
    if (!existing) return;
    try {
      this.options.setFilters(current.filter((filter) => filter !== existing));
    } catch (failure) {
      this.onError(failure);
    }
  }

  removeAllFiltersHandler() {
    this.options.setFilters([]);
  }

  /** opensearchDashboardsSetTimeFilter(start, end) */
  setTimeFilterHandler(start: unknown, end: unknown) {
    const range = parseTimeRange(handleInvalidDate(start), handleInvalidDate(end));
    this.options.applyFilter({ timeFieldName: '*', range });
  }

  /** opensearchDashboardsSelectTimeRange(selection): the time range of an interval selection */
  selectTimeRange(selection: unknown) {
    if (selection) {
      const range = Object.values(selection as Record<string, unknown>)[0];
      if (range && Object.values(range as object).length === 2) {
        const values = Object.values(range as object) as unknown[];
        this.setTimeFilterHandler(values[0], values[1]);
      }
    }
  }

  setDebugValues(view: VegaView, spec: unknown, vlspec: unknown) {
    this.options.onDebugValues?.({ view, spec: vlspec || spec });
    const hide = exposeDebugObject(
      window as unknown as DebugScope,
      {
        VEGA_VERSION: this.libraries.vega.version,
        VEGA_LITE_VERSION: this.libraries.vegaLite.version,
        view,
        vega_spec: spec,
        vegalite_spec: vlspec,
      },
      (...args) => console.log(...args)
    );
    this.addDestroyHandler(hide);
  }

  destroy(): Promise<unknown> | undefined {
    // a second call waits for the first
    if (this.destroyHandlers) {
      this.ongoingDestroy = Promise.all(this.destroyHandlers.map((handler) => handler()));
      this.destroyHandlers = null;
    }
    return this.ongoingDestroy;
  }

  protected addDestroyHandler(handler: DestroyHandler) {
    if (this.destroyHandlers) this.destroyHandlers.push(handler);
    else handler();
  }
}

/** A chart that is not a map */
export class VegaChartView extends VegaBaseView {
  protected async initViewCustomizations() {
    if (!this.container || !this.controls) return;
    const { vega } = this.libraries;
    const view = new vega.View(vega.parse(this.parser.vegaSpec, null, this.viewOptions ?? { ast: true }), this.viewConfig ?? {});
    view.warn = this.onWarn.bind(this);
    view.error = this.onError.bind(this);
    if (this.parser.useResize) this.updateVegaSize(view);
    view.initialize(this.container, this.controls);
    if (this.parser.useHover) view.hover();
    await this.setView(view);
    this.setDebugValues(view, this.parser.vegaSpec, this.parser.vlspec);
  }
}

// --- Tooltips ----------------------------------------------------------------------------------

const TOOLTIP_ID = 'vega-opensearch-dashboards-tooltip';

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
}

const createRect = (left: number, top: number, width: number, height: number): Rect => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
});

type Position = 'top' | 'right' | 'bottom' | 'left';

/**
 * Where a popover goes beside its anchor, as EUI's calculatePopoverPosition places it: the side
 * asked for, unless another shows more of it in the window
 */
export function calculatePopoverPosition(
  anchor: Rect,
  popover: { width: number; height: number },
  requested: Position,
  buffer = 10,
  positions: Position[] = ['top', 'right', 'bottom', 'left']
): { position: Position; left: number; top: number; width: number; height: number } {
  const { width, height } = popover;
  const at: Record<Position, () => { left: number; top: number }> = {
    top: () => ({ left: anchor.left - (width - anchor.width) * 0.5, top: anchor.top - height - buffer }),
    right: () => ({ left: anchor.right + buffer, top: anchor.top - (height - anchor.height) * 0.5 }),
    bottom: () => ({ left: anchor.left - (width - anchor.width) * 0.5, top: anchor.bottom + buffer }),
    left: () => ({ left: anchor.left - width - buffer, top: anchor.top - (height - anchor.height) * 0.5 }),
  };
  const visibleArea = (bounds: { left: number; top: number }) => {
    const dx = Math.min(bounds.left + width, window.innerWidth) - Math.max(bounds.left, 0);
    const dy = Math.min(bounds.top + height, window.innerHeight) - Math.max(bounds.top, 0);
    return dx * dy;
  };
  const bounds = {} as Record<Position, { left: number; top: number }>;
  const area = {} as Record<Position, number>;
  for (const position of positions) {
    bounds[position] = at[position]();
    area[position] = visibleArea(bounds[position]);
  }
  const chosen = positions.reduce((best, position) => (area[position] > area[best] ? position : best), requested);
  return { position: chosen, ...bounds[chosen], width, height };
}

/** The objects inside a tooltip's value as JSON, cut off below a depth */
function stringify(value: unknown, maxDepth: number): string {
  const stack: unknown[] = [];
  return JSON.stringify(value, function replacer(this: unknown, _key: string, item: unknown) {
    if (typeof item !== 'object' || item === null) return item;
    const pos = stack.indexOf(this) + 1;
    stack.length = pos;
    if (stack.length > maxDepth) return '[Object]';
    if (stack.indexOf(item) >= 0) return '[Circular]';
    stack.push(item);
    return item;
  });
}

const isObjectLike = (value: unknown) => value === Object(value);

/** A tooltip's value as markup, as vega-tooltip 0.30 writes it: a title, an image, a table */
export function formatTooltipValue(value: unknown, valueToHtml: (value: unknown) => string, maxDepth: number): string {
  if (Array.isArray(value)) {
    return `[${value.map((item: unknown) => valueToHtml(typeof item === 'string' ? item : stringify(item, maxDepth))).join(', ')}]`;
  }
  if (isObjectLike(value)) {
    let content = '';
    const { title, image, ...rest } = value as Record<string, unknown>;
    if (title) content += `<h2>${valueToHtml(title)}</h2>`;
    if (image) content += `<img src="${valueToHtml(image)}">`;
    const keys = Object.keys(rest);
    if (keys.length > 0) {
      content += '<table>';
      for (const key of keys) {
        let item = rest[key];
        if (item === undefined) continue;
        if (isObjectLike(item)) item = stringify(item, maxDepth);
        content += `<tr><td class="key">${valueToHtml(key)}:</td><td class="value">${valueToHtml(item)}</td></tr>`;
      }
      content += '</table>';
    }
    return content || '{}';
  }
  return valueToHtml(value);
}

/** The tooltip of marks with a `tooltip`: one element on the page, beside the mark or the pointer */
export class TooltipHandler {
  private readonly position: Position;
  private readonly padding: number;
  private readonly centerOnMark: number;
  private tooltipTimeout?: number;

  constructor(
    private readonly container: HTMLElement,
    view: VegaView,
    options: TooltipConfig
  ) {
    this.position = options.position;
    this.padding = options.padding;
    this.centerOnMark = options.centerOnMark;
    view.tooltip(this.handler.bind(this));
  }

  handler(view: VegaView, event: MouseEvent, item: VegaItem, value: unknown) {
    // nothing, or nothing to say: no tooltip
    if (value === null || value === undefined || value === '') {
      this.hideTooltip();
      return;
    }
    window.clearTimeout(this.tooltipTimeout);
    let shown = value;
    if (typeof value === 'object') {
      const kept: Record<string, unknown> = {};
      for (const key of Object.keys(value as object)) {
        if ((value as Record<string, unknown>)[key] !== 'NaN') kept[key] = (value as Record<string, unknown>)[key];
      }
      shown = kept;
    }

    let element = document.getElementById(TOOLTIP_ID);
    if (!element) {
      element = document.createElement('div');
      element.setAttribute('id', TOOLTIP_ID);
      element.classList.add('vgaVis__tooltip', `vgaVis__tooltip--${this.position}`);
      // in the page, so that its size is known
      document.body.appendChild(element);
    }
    // the markup is made of escaped values only
    element.innerHTML = formatTooltipValue(shown, escapeHtml, 2);

    let anchor: Rect;
    if (item.bounds.width() > this.centerOnMark || item.bounds.height() > this.centerOnMark) {
      // a large mark: beside the pointer
      anchor = createRect(event.clientX, event.clientY, 0, 0);
    } else {
      const box = this.container.getBoundingClientRect();
      anchor = createRect(
        box.left + view._origin[0] + item.bounds.x1,
        box.top + view._origin[1] + item.bounds.y1,
        item.bounds.width(),
        item.bounds.height()
      );
    }
    const position = calculatePopoverPosition(anchor, element.getBoundingClientRect(), this.position, this.padding);
    element.setAttribute('style', `top: ${position.top}px; left: ${position.left}px`);
  }

  hideTooltip() {
    this.tooltipTimeout = window.setTimeout(() => {
      document.getElementById(TOOLTIP_ID)?.remove();
    }, 100);
  }
}

// --- Signal values kept over a refresh -------------------------------------------------------------

interface FocusedControl {
  name: string;
  tagName: string;
  type: string | null;
  value: string | null;
  selectionStart?: number;
  selectionEnd?: number | null;
}

/**
 * The values of bound signals, and the control that had the focus, kept when the view is drawn
 * again with the same spec (config.kibana.restoreSignalValuesOnRefresh)
 */
export class VegaSignalStateManager {
  private state: Record<string, unknown> | null = null;
  private focusedControl: FocusedControl | null = null;

  clear() {
    this.state = null;
    this.focusedControl = null;
  }

  getState() {
    return this.state;
  }

  save(view: VegaView, controlsEl: HTMLElement | null, signalNames: string[]) {
    if (!view || typeof view.getState !== 'function') return;
    try {
      const names = new Set(signalNames || []);
      if (!names.size) {
        this.state = null;
      } else {
        const state = view.getState({ signals: (name: string) => names.has(name), data: false, recurse: false });
        this.state = state?.signals && Object.keys(state.signals).length ? state.signals : null;
      }
      this.focusedControl = focusedControl(controlsEl);
    } catch {
      this.clear();
    }
  }

  restore(view: VegaView, controlsEl: HTMLElement | null): Promise<VegaView> {
    const saved = this.getState();
    if (saved) {
      try {
        // set before the first run, so that the controls start with them
        for (const [name, value] of Object.entries(saved)) view.signal(name, value);
      } catch {
        this.clear();
      }
    }
    return view.runAsync().then(() => {
      restoreFocusedControl(controlsEl, this.focusedControl);
      return view;
    });
  }
}

function focusedControl(controlsEl: HTMLElement | null): FocusedControl | null {
  const active = document.activeElement as (HTMLElement & { selectionStart?: number | null; selectionEnd?: number | null }) | null;
  if (!controlsEl || !active || !controlsEl.contains(active)) return null;
  const name = active.getAttribute('name');
  if (!name) return null;
  const control: FocusedControl = { name, tagName: active.tagName, type: active.getAttribute('type'), value: active.getAttribute('value') };
  if (typeof active.selectionStart === 'number') {
    control.selectionStart = active.selectionStart;
    control.selectionEnd = active.selectionEnd;
  }
  return control;
}

function restoreFocusedControl(controlsEl: HTMLElement | null, control: FocusedControl | null) {
  if (!controlsEl || !control) return;
  // Vega names a control after its signal; radio buttons share it, and differ by value
  const element = Array.from(controlsEl.querySelectorAll<HTMLInputElement>('[name]')).find((candidate) => {
    if (candidate.getAttribute('name') !== control.name) return false;
    if (candidate.tagName !== control.tagName) return false;
    if (control.type && candidate.getAttribute('type') !== control.type) return false;
    if (control.type === 'radio' && candidate.getAttribute('value') !== control.value) return false;
    return true;
  });
  if (!element) return;
  try {
    element.focus({ preventScroll: true });
  } catch {
    element.focus();
  }
  if (typeof element.setSelectionRange === 'function' && typeof control.selectionStart === 'number') {
    try {
      element.setSelectionRange(control.selectionStart, control.selectionEnd ?? null);
    } catch {
      // not every input keeps a selection
    }
  }
}

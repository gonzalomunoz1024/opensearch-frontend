/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Vega and Vega-Lite, loaded the first time a Vega visualization is drawn: their browser builds
 * are files of their own beside the app's script, each setting a global when it has run. What
 * this file names of them is only what the drawing uses.
 */

import { services } from '../../services';
import type { ExpressionNode } from './interpreter';

export type Fn = (...args: unknown[]) => unknown;

export interface VegaLogger {
  level(): number;
  warn: (...args: unknown[]) => unknown;
}

export interface VegaLoader {
  sanitize(uri: unknown, options: unknown): Promise<{ href: string }>;
}

/** A scenegraph item: where it was drawn, and the data behind it */
export interface VegaItem {
  datum?: unknown;
  bounds: { x1: number; y1: number; width(): number; height(): number };
}

export type TooltipHandler = (view: VegaView, event: MouseEvent, item: VegaItem, value: unknown) => void;

export interface VegaRuntime {
  data: Record<string, { values: { value?: Array<Record<string, unknown>> } }>;
  signals: Record<string, { value: unknown }>;
}

export interface VegaView {
  initialize(container?: Element, bind?: Element): VegaView;
  hover(): VegaView;
  run(): VegaView;
  runAsync(): Promise<VegaView>;
  runAfter(callback: (view: VegaView) => void): VegaView;
  finalize(): VegaView;
  logLevel(level: number): VegaView;
  padding(padding: { left: number; right: number; top: number; bottom: number }): VegaView;
  width(): number;
  width(value: number): VegaView;
  height(): number;
  height(value: number): VegaView;
  tooltip(handler: TooltipHandler): VegaView;
  signal(name: string): unknown;
  signal(name: string, value: unknown): VegaView;
  addSignalListener(name: string, handler: Fn): VegaView;
  removeSignalListener(name: string, handler: Fn): VegaView;
  getState(options?: unknown): { signals?: Record<string, unknown> };
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  _origin: [number, number];
  _runtime: VegaRuntime;
  /** The visualization a view belongs to, for the functions specs call */
  _opensearchDashboardsView?: { vegaFunctionsHandler(name: string, ...args: unknown[]): unknown };
  /** What setMapView() of a spec on a map calls: the map's own handler */
  Leaflet_setMapViewHandler?: (...args: unknown[]) => void;
}

export interface VegaLibrary {
  version: string;
  Warn: number;
  View: new (runtime: unknown, config: Record<string, unknown>) => VegaView;
  parse(spec: unknown, config: unknown, options: { ast: boolean }): unknown;
  scheme(name: string, colors: string[]): void;
  expressionFunction(name: string, fn?: Fn): unknown;
  loader(): VegaLoader;
  logger(level: number): VegaLogger;
  parseExpression(expression: string): ExpressionNode;
  ascending(a: unknown, b: unknown): number;
}

export interface VegaLiteLibrary {
  version: string;
  compile(spec: unknown, options?: unknown): { spec: Record<string, unknown> };
}

export interface VegaLibraries {
  vega: VegaLibrary;
  vegaLite: VegaLiteLibrary;
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.appendChild(script);
  });
}

let loading: Promise<VegaLibraries> | undefined;

/** Vega and Vega-Lite, loaded once for the page */
export function loadVega(): Promise<VegaLibraries> {
  loading ??= (async () => {
    const scope = globalThis as unknown as { vega?: VegaLibrary; vegaLite?: VegaLiteLibrary };
    if (!scope.vega) await loadScript(services.boot.libraries.vega);
    // Vega-Lite's build reads the global Vega's build sets
    if (!scope.vegaLite) await loadScript(services.boot.libraries.vegaLite);
    if (!scope.vega || !scope.vegaLite) throw new Error('Vega could not be loaded');
    return { vega: scope.vega, vegaLite: scope.vegaLite };
  })().catch((failure: unknown) => {
    loading = undefined;
    throw failure;
  });
  return loading;
}

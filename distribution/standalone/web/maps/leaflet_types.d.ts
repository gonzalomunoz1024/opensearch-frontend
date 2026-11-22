/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The part of Leaflet 1.9.4 this product uses, typed by hand: the package ships no types and
 * @types/leaflet cannot be installed where the product is built. Add to it as code needs more.
 */

declare module 'leaflet' {
  export type LatLngTuple = [number, number];
  export type LatLngExpression = LatLng | LatLngTuple | { lat: number; lng: number };
  export type LatLngBoundsExpression = LatLngBounds | LatLngTuple[];
  export type PointExpression = Point | [number, number];

  export class Class {
    static extend<T extends object>(props: T & ThisType<T & Class>): { new (...args: unknown[]): T & Class };
    static include(props: object): void;
  }

  export interface LeafletEvent {
    type: string;
    target: unknown;
    sourceTarget?: unknown;
    propagatedFrom?: unknown;
    layer?: Layer;
  }
  export interface LeafletMouseEvent extends LeafletEvent {
    latlng: LatLng;
    layerPoint: Point;
    containerPoint: Point;
    originalEvent: MouseEvent;
  }
  export type LeafletEventHandlerFn = (event: LeafletEvent) => void;
  // A handler may take a narrower event than LeafletEvent, as Leaflet's own types allow
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type AnyHandler = (event: any) => void;

  export class Evented extends Class {
    on(type: string, fn: AnyHandler, context?: unknown): this;
    on(handlers: Record<string, AnyHandler>, context?: unknown): this;
    off(type?: string, fn?: AnyHandler, context?: unknown): this;
    off(handlers: Record<string, AnyHandler>, context?: unknown): this;
    once(type: string, fn: AnyHandler, context?: unknown): this;
    fire(type: string, data?: object, propagate?: boolean): this;
    listens(type: string): boolean;
  }

  export class LatLng {
    constructor(lat: number, lng: number, alt?: number);
    lat: number;
    lng: number;
    equals(other: LatLngExpression, maxMargin?: number): boolean;
    distanceTo(other: LatLngExpression): number;
    wrap(): LatLng;
    toBounds(sizeInMeters: number): LatLngBounds;
  }
  export function latLng(lat: number, lng: number, alt?: number): LatLng;
  export function latLng(coords: LatLngExpression): LatLng;

  export class LatLngBounds {
    constructor(southWest: LatLngExpression, northEast: LatLngExpression);
    constructor(latlngs: LatLngExpression[]);
    extend(other: LatLngExpression | LatLngBoundsExpression): this;
    pad(ratio: number): LatLngBounds;
    getCenter(): LatLng;
    getSouthWest(): LatLng;
    getNorthEast(): LatLng;
    getNorthWest(): LatLng;
    getSouthEast(): LatLng;
    getWest(): number;
    getSouth(): number;
    getEast(): number;
    getNorth(): number;
    contains(other: LatLngBoundsExpression | LatLngExpression): boolean;
    intersects(other: LatLngBoundsExpression): boolean;
    overlaps(other: LatLngBoundsExpression): boolean;
    isValid(): boolean;
    equals(other: LatLngBoundsExpression, maxMargin?: number): boolean;
  }
  export function latLngBounds(southWest: LatLngExpression, northEast: LatLngExpression): LatLngBounds;
  export function latLngBounds(latlngs: LatLngExpression[]): LatLngBounds;

  export class Point {
    constructor(x: number, y: number, round?: boolean);
    x: number;
    y: number;
    add(other: PointExpression): Point;
    subtract(other: PointExpression): Point;
    distanceTo(other: PointExpression): number;
    round(): Point;
  }
  export function point(x: number, y: number, round?: boolean): Point;

  export class Bounds {
    min?: Point;
    max?: Point;
    getSize(): Point;
  }

  export interface MapOptions {
    minZoom?: number;
    maxZoom?: number;
    center?: LatLngExpression;
    zoom?: number;
    renderer?: Renderer;
    preferCanvas?: boolean;
    zoomAnimation?: boolean;
    fadeAnimation?: boolean;
    markerZoomAnimation?: boolean;
    zoomControl?: boolean;
    attributionControl?: boolean;
    scrollWheelZoom?: boolean | 'center';
    dragging?: boolean;
    doubleClickZoom?: boolean | 'center';
    boxZoom?: boolean;
    keyboard?: boolean;
    inertia?: boolean;
    worldCopyJump?: boolean;
    maxBounds?: LatLngBoundsExpression;
    maxBoundsViscosity?: number;
    crs?: unknown;
  }
  export interface FitBoundsOptions {
    padding?: PointExpression;
    maxZoom?: number;
    animate?: boolean;
  }

  export interface Handler {
    enable(): this;
    disable(): this;
    enabled(): boolean;
  }

  class LeafletMap extends Evented {
    constructor(element: string | HTMLElement, options?: MapOptions);
    options: MapOptions;
    attributionControl: Control.Attribution;
    zoomControl: Control.Zoom;
    scrollWheelZoom: Handler;
    dragging: Handler;
    doubleClickZoom: Handler;
    boxZoom: Handler;
    keyboard: Handler;
    touchZoom: Handler;
    getContainer(): HTMLElement;
    getPane(name: string): HTMLElement | undefined;
    createPane(name: string, container?: HTMLElement): HTMLElement;
    getPanes(): Record<string, HTMLElement>;
    getRenderer(layer: Path): Renderer;
    addLayer(layer: Layer): this;
    removeLayer(layer: Layer): this;
    hasLayer(layer: Layer): boolean;
    eachLayer(fn: (layer: Layer) => void): this;
    addControl(control: Control): this;
    removeControl(control: Control): this;
    openPopup(popup: Popup): this;
    closePopup(popup?: Popup): this;
    setView(center: LatLngExpression, zoom?: number, options?: { animate?: boolean }): this;
    setZoom(zoom: number, options?: { animate?: boolean }): this;
    zoomIn(delta?: number): this;
    zoomOut(delta?: number): this;
    panTo(latlng: LatLngExpression): this;
    panBy(offset: PointExpression): this;
    fitBounds(bounds: LatLngBoundsExpression, options?: FitBoundsOptions): this;
    fitWorld(): this;
    getCenter(): LatLng;
    getZoom(): number;
    getMinZoom(): number;
    getMaxZoom(): number;
    setMinZoom(zoom: number): this;
    setMaxZoom(zoom: number): this;
    setMaxBounds(bounds?: LatLngBoundsExpression): this;
    getBounds(): LatLngBounds;
    getSize(): Point;
    getPixelBounds(): Bounds;
    getPixelOrigin(): Point;
    getZoomScale(toZoom: number, fromZoom?: number): number;
    getBoundsZoom(bounds: LatLngBoundsExpression, inside?: boolean, padding?: Point): number;
    wrapLatLng(latlng: LatLngExpression): LatLng;
    wrapLatLngBounds(bounds: LatLngBounds): LatLngBounds;
    project(latlng: LatLngExpression, zoom?: number): Point;
    unproject(point: PointExpression, zoom?: number): LatLng;
    latLngToLayerPoint(latlng: LatLngExpression): Point;
    layerPointToLatLng(point: PointExpression): LatLng;
    latLngToContainerPoint(latlng: LatLngExpression): Point;
    containerPointToLatLng(point: PointExpression): LatLng;
    containerPointToLayerPoint(point: PointExpression): Point;
    mouseEventToLatLng(event: MouseEvent): LatLng;
    mouseEventToContainerPoint(event: MouseEvent): Point;
    invalidateSize(options?: boolean | { animate?: boolean; pan?: boolean }): this;
    whenReady(fn: () => void): this;
    remove(): this;
  }
  export { LeafletMap as Map };
  export function map(element: string | HTMLElement, options?: MapOptions): LeafletMap;

  export interface LayerOptions {
    pane?: string;
    attribution?: string;
    interactive?: boolean;
  }
  export class Layer extends Evented {
    constructor(options?: LayerOptions);
    options: LayerOptions;
    addTo(map: LeafletMap | LayerGroup): this;
    remove(): this;
    removeFrom(map: LeafletMap): this;
    getPane(name?: string): HTMLElement | undefined;
    getAttribution(): string | null;
    bindPopup(content: string | HTMLElement | Popup, options?: PopupOptions): this;
    unbindPopup(): this;
    openPopup(latlng?: LatLngExpression): this;
    closePopup(): this;
    bindTooltip(content: string | HTMLElement, options?: object): this;
    // A layer drawn by this product overrides these; Leaflet calls them
    onAdd(map: LeafletMap): this;
    onRemove(map: LeafletMap): this;
    getEvents?(): Record<string, AnyHandler>;
    _map: LeafletMap;
  }

  export class LayerGroup<T extends Layer = Layer> extends Layer {
    constructor(layers?: T[], options?: LayerOptions);
    addLayer(layer: T): this;
    removeLayer(layer: T): this;
    hasLayer(layer: T): boolean;
    clearLayers(): this;
    eachLayer(fn: (layer: T) => void): this;
    getLayers(): T[];
    setStyle(style: PathOptions): this;
  }
  export function layerGroup<T extends Layer = Layer>(layers?: T[], options?: LayerOptions): LayerGroup<T>;

  export class FeatureGroup<T extends Layer = Layer> extends LayerGroup<T> {
    getBounds(): LatLngBounds;
    bringToFront(): this;
    bringToBack(): this;
  }
  export function featureGroup<T extends Layer = Layer>(layers?: T[], options?: LayerOptions): FeatureGroup<T>;

  export interface GeoJSONOptions<P = Record<string, unknown>> extends LayerOptions {
    pointToLayer?: (feature: GeoJsonFeature<P>, latlng: LatLng) => Layer;
    style?: PathOptions | ((feature?: GeoJsonFeature<P>) => PathOptions);
    onEachFeature?: (feature: GeoJsonFeature<P>, layer: Layer) => void;
    filter?: (feature: GeoJsonFeature<P>) => boolean;
    coordsToLatLng?: (coords: [number, number] | [number, number, number]) => LatLng;
  }
  export interface GeoJsonGeometry {
    type: string;
    coordinates?: unknown;
    geometries?: GeoJsonGeometry[];
  }
  export interface GeoJsonFeature<P = Record<string, unknown>> {
    type: 'Feature';
    id?: string | number;
    properties: P;
    geometry: GeoJsonGeometry | null;
  }
  export interface GeoJsonFeatureCollection<P = Record<string, unknown>> {
    type: 'FeatureCollection';
    features: Array<GeoJsonFeature<P>>;
  }
  export class GeoJSON<P = Record<string, unknown>> extends FeatureGroup {
    constructor(data?: GeoJsonFeatureCollection<P> | Array<GeoJsonFeature<P>> | GeoJsonFeature<P> | null, options?: GeoJSONOptions<P>);
    addData(data: GeoJsonFeatureCollection<P> | Array<GeoJsonFeature<P>> | GeoJsonFeature<P>): this;
    resetStyle(layer?: Layer): this;
    setStyle(style: PathOptions | ((feature?: GeoJsonFeature<P>) => PathOptions)): this;
    static coordsToLatLng(coords: [number, number] | [number, number, number]): LatLng;
  }
  export function geoJson<P = Record<string, unknown>>(
    data?: GeoJsonFeatureCollection<P> | Array<GeoJsonFeature<P>> | GeoJsonFeature<P> | null,
    options?: GeoJSONOptions<P>
  ): GeoJSON<P>;
  export { geoJson as geoJSON };

  export interface PathOptions {
    stroke?: boolean;
    color?: string;
    weight?: number;
    opacity?: number;
    lineCap?: string;
    lineJoin?: string;
    dashArray?: string | null;
    fill?: boolean;
    fillColor?: string;
    fillOpacity?: number;
    fillRule?: string;
    className?: string;
    interactive?: boolean;
    renderer?: Renderer;
    bubblingMouseEvents?: boolean;
  }
  export class Path extends Layer {
    options: PathOptions & LayerOptions;
    setStyle(style: PathOptions): this;
    redraw(): this;
    bringToFront(): this;
    bringToBack(): this;
    getElement(): Element | undefined;
  }
  export class Polyline extends Path {
    constructor(latlngs: LatLngExpression[] | LatLngExpression[][], options?: PathOptions);
    getLatLngs(): LatLng[] | LatLng[][] | LatLng[][][];
    setLatLngs(latlngs: LatLngExpression[] | LatLngExpression[][]): this;
    addLatLng(latlng: LatLngExpression): this;
    getBounds(): LatLngBounds;
    getCenter(): LatLng;
  }
  export function polyline(latlngs: LatLngExpression[] | LatLngExpression[][], options?: PathOptions): Polyline;
  export class Polygon extends Polyline {
    constructor(latlngs: LatLngExpression[] | LatLngExpression[][] | LatLngExpression[][][], options?: PathOptions);
  }
  export function polygon(latlngs: LatLngExpression[] | LatLngExpression[][] | LatLngExpression[][][], options?: PathOptions): Polygon;
  export class Rectangle extends Polygon {
    constructor(bounds: LatLngBoundsExpression, options?: PathOptions);
    setBounds(bounds: LatLngBoundsExpression): this;
  }
  export function rectangle(bounds: LatLngBoundsExpression, options?: PathOptions): Rectangle;
  export interface CircleMarkerOptions extends PathOptions {
    radius?: number;
  }
  export class CircleMarker extends Path {
    constructor(latlng: LatLngExpression, options?: CircleMarkerOptions);
    options: CircleMarkerOptions & LayerOptions;
    getLatLng(): LatLng;
    setLatLng(latlng: LatLngExpression): this;
    setRadius(radius: number): this;
    getRadius(): number;
  }
  export function circleMarker(latlng: LatLngExpression, options?: CircleMarkerOptions): CircleMarker;
  export interface CircleOptions extends CircleMarkerOptions {
    radius?: number;
  }
  export class Circle extends CircleMarker {
    constructor(latlng: LatLngExpression, options?: CircleOptions);
    getBounds(): LatLngBounds;
  }
  export function circle(latlng: LatLngExpression, options?: CircleOptions): Circle;

  export interface DivIconOptions {
    className?: string;
    html?: string | false;
    iconSize?: PointExpression;
    iconAnchor?: PointExpression;
  }
  export class DivIcon extends Class {
    constructor(options?: DivIconOptions);
  }
  export function divIcon(options?: DivIconOptions): DivIcon;
  export interface MarkerOptions extends LayerOptions {
    icon?: DivIcon;
    opacity?: number;
    zIndexOffset?: number;
    keyboard?: boolean;
  }
  export class Marker extends Layer {
    constructor(latlng: LatLngExpression, options?: MarkerOptions);
    getLatLng(): LatLng;
    setLatLng(latlng: LatLngExpression): this;
    getElement(): HTMLElement | undefined;
    setZIndexOffset(offset: number): this;
  }
  export function marker(latlng: LatLngExpression, options?: MarkerOptions): Marker;

  export class Renderer extends Layer {
    options: LayerOptions & { padding?: number; tolerance?: number };
  }
  export class Canvas extends Renderer {}
  export class SVG extends Renderer {}
  export function canvas(options?: { padding?: number; tolerance?: number; pane?: string }): Canvas;
  export function svg(options?: { padding?: number; pane?: string }): SVG;

  export interface GridLayerOptions extends LayerOptions {
    tileSize?: number | Point;
    opacity?: number;
    updateWhenIdle?: boolean;
    updateWhenZooming?: boolean;
    zIndex?: number;
    minZoom?: number;
    maxZoom?: number;
    maxNativeZoom?: number;
    noWrap?: boolean;
    bounds?: LatLngBoundsExpression;
    className?: string;
    keepBuffer?: number;
  }
  export class GridLayer extends Layer {
    constructor(options?: GridLayerOptions);
    bringToFront(): this;
    bringToBack(): this;
    getContainer(): HTMLElement | undefined;
    setOpacity(opacity: number): this;
    setZIndex(zIndex: number): this;
    isLoading(): boolean;
    redraw(): this;
  }
  export interface TileLayerOptions extends GridLayerOptions {
    subdomains?: string | string[];
    errorTileUrl?: string;
    zoomOffset?: number;
    tms?: boolean;
    zoomReverse?: boolean;
    detectRetina?: boolean;
    crossOrigin?: boolean | string;
  }
  export class TileLayer extends GridLayer {
    constructor(urlTemplate: string, options?: TileLayerOptions);
    setUrl(url: string, noRedraw?: boolean): this;
  }
  export interface WMSOptions extends TileLayerOptions {
    layers?: string;
    styles?: string;
    format?: string;
    transparent?: boolean;
    version?: string;
    uppercase?: boolean;
  }
  export function tileLayer(urlTemplate: string, options?: TileLayerOptions): TileLayer;
  export namespace tileLayer {
    function wms(baseUrl: string, options?: WMSOptions): TileLayer;
  }

  export interface PopupOptions {
    maxWidth?: number;
    minWidth?: number;
    maxHeight?: number;
    autoPan?: boolean;
    keepInView?: boolean;
    closeButton?: boolean;
    autoClose?: boolean;
    closeOnClick?: boolean;
    className?: string;
    offset?: PointExpression;
  }
  export class Popup extends Layer {
    constructor(options?: PopupOptions, source?: Layer);
    getLatLng(): LatLng | undefined;
    setLatLng(latlng: LatLngExpression): this;
    getContent(): string | HTMLElement | undefined;
    setContent(content: string | HTMLElement): this;
    getElement(): HTMLElement | undefined;
    update(): void;
    isOpen(): boolean;
    openOn(map: LeafletMap): this;
  }
  export function popup(options?: PopupOptions, source?: Layer): Popup;

  export type ControlPosition = 'topleft' | 'topright' | 'bottomleft' | 'bottomright';
  export class Control extends Class {
    constructor(options?: { position?: ControlPosition });
    options: { position?: ControlPosition };
    getPosition(): ControlPosition;
    setPosition(position: ControlPosition): this;
    getContainer(): HTMLElement | undefined;
    addTo(map: LeafletMap): this;
    remove(): this;
    onAdd?(map: LeafletMap): HTMLElement;
    onRemove?(map: LeafletMap): void;
  }
  export namespace Control {
    class Zoom extends Control {}
    class Attribution extends Control {
      setPrefix(prefix: string | false): this;
      addAttribution(text: string): this;
      removeAttribution(text: string): this;
    }
  }
  export namespace control {
    function zoom(options?: { position?: ControlPosition; zoomInTitle?: string; zoomOutTitle?: string }): Control.Zoom;
  }

  export namespace DomUtil {
    function create<K extends keyof HTMLElementTagNameMap>(tagName: K, className?: string, container?: HTMLElement): HTMLElementTagNameMap[K];
    function create(tagName: string, className?: string, container?: HTMLElement): HTMLElement;
    function remove(el: HTMLElement): void;
    function addClass(el: HTMLElement, name: string): void;
    function removeClass(el: HTMLElement, name: string): void;
    function hasClass(el: HTMLElement, name: string): boolean;
    function setPosition(el: HTMLElement, position: Point): void;
    function getPosition(el: HTMLElement): Point;
    function disableTextSelection(): void;
    function enableTextSelection(): void;
  }
  export namespace DomEvent {
    function on(el: HTMLElement | Window | Document, types: string, fn: (event: Event) => void, context?: unknown): typeof DomEvent;
    function off(el: HTMLElement | Window | Document, types: string, fn: (event: Event) => void, context?: unknown): typeof DomEvent;
    function stopPropagation(event: Event): typeof DomEvent;
    function preventDefault(event: Event): typeof DomEvent;
    function stop(event: Event): typeof DomEvent;
    function disableClickPropagation(el: HTMLElement): typeof DomEvent;
    function disableScrollPropagation(el: HTMLElement): typeof DomEvent;
  }
  export namespace Util {
    function stamp(obj: object): number;
    function setOptions(obj: object, options: object): object;
    function template(str: string, data: Record<string, unknown>): string;
    function requestAnimFrame(fn: () => void, context?: unknown, immediate?: boolean): number;
    function cancelAnimFrame(id: number): void;
  }
  export namespace Browser {
    const retina: boolean;
    const touch: boolean;
    const mobile: boolean;
  }

  export const version: string;
}

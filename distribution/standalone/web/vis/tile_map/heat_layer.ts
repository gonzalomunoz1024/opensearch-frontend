/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The heat map of a coordinate map: leaflet.heat 0.2.0 and the simpleheat it bundles, as
 * maps_legacy loads them, written again on Leaflet 1.9. Points are gathered into cells of half a
 * radius on screen, weighted by their intensity and by how far the map is from `maxZoom`, and
 * each cell is drawn as a blurred circle whose alpha is then coloured through the gradient.
 */

import type { LatLngBounds, LatLngExpression, Map as LeafletMap } from 'leaflet';
import { L } from '../../maps/leaflet';
import { gatherHeat, heatZoomFactor } from './heat_layer_math';

export interface HeatLayerOptions {
  radius?: number;
  blur?: number;
  maxZoom?: number;
  minOpacity?: number;
  max?: number;
  gradient?: Record<number, string>;
}

/** simpleheat's defaults */
export const DEFAULT_RADIUS = 25;
export const DEFAULT_GRADIENT: Record<number, string> = { 0.4: 'blue', 0.6: 'cyan', 0.7: 'lime', 0.8: 'yellow', 1: 'red' };

/** simpleheat */
class SimpleHeat {
  private readonly ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  r = 0;
  private maxValue = 1;
  private data: Array<[number, number, number]> = [];
  private circle?: HTMLCanvasElement;
  private grad?: Uint8ClampedArray;

  constructor(canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    this.width = canvas.width;
    this.height = canvas.height;
  }

  setData(data: Array<[number, number, number]>) {
    this.data = data;
    return this;
  }

  max(value: number) {
    this.maxValue = value;
    return this;
  }

  radius(r: number, blur?: number) {
    const b = blur || 15;
    const circle = (this.circle = document.createElement('canvas'));
    const ctx = circle.getContext('2d') as CanvasRenderingContext2D;
    const r2 = (this.r = r + b);
    circle.width = circle.height = r2 * 2;
    ctx.shadowOffsetX = ctx.shadowOffsetY = 200;
    ctx.shadowBlur = b;
    ctx.shadowColor = 'black';
    ctx.beginPath();
    ctx.arc(r2 - 200, r2 - 200, r, 0, Math.PI * 2, true);
    ctx.closePath();
    ctx.fill();
    return this;
  }

  gradient(stops: Record<number, string>) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    const gradient = ctx.createLinearGradient(0, 0, 0, 256);
    canvas.width = 1;
    canvas.height = 256;
    for (const stop of Object.keys(stops)) gradient.addColorStop(Number(stop), stops[Number(stop)]);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 1, 256);
    this.grad = ctx.getImageData(0, 0, 1, 256).data;
    return this;
  }

  draw(minOpacity?: number) {
    if (!this.circle) this.radius(DEFAULT_RADIUS);
    if (!this.grad) this.gradient(DEFAULT_GRADIENT);
    const ctx = this.ctx;
    const circle = this.circle as HTMLCanvasElement;
    const grad = this.grad as Uint8ClampedArray;
    ctx.clearRect(0, 0, this.width, this.height);
    for (const p of this.data) {
      ctx.globalAlpha = Math.max(p[2] / this.maxValue, minOpacity || 0.05);
      ctx.drawImage(circle, p[0] - this.r, p[1] - this.r);
    }
    if (this.width <= 0 || this.height <= 0) return this;
    const colored = ctx.getImageData(0, 0, this.width, this.height);
    const pixels = colored.data;
    for (let i = 3; i < pixels.length; i += 4) {
      const j = pixels[i] * 4;
      if (j) {
        pixels[i - 3] = grad[j];
        pixels[i - 2] = grad[j + 1];
        pixels[i - 1] = grad[j + 2];
      }
    }
    ctx.putImageData(colored, 0, 0);
    return this;
  }
}

type HeatPoint = [number, number, number];

/** L.HeatLayer of leaflet.heat 0.2.0 */
export class HeatLayer extends L.Layer {
  private canvas?: HTMLCanvasElement;
  private heat?: SimpleHeat;
  private frame: number | null = null;
  private heatMap?: LeafletMap;
  private readonly heatOptions: HeatLayerOptions;

  constructor(
    private latlngs: HeatPoint[],
    options: HeatLayerOptions = {}
  ) {
    super();
    this.heatOptions = { ...options };
  }

  setLatLngs(latlngs: HeatPoint[]) {
    this.latlngs = latlngs;
    return this.redraw();
  }

  redraw() {
    if (this.heat && this.frame === null) this.frame = L.Util.requestAnimFrame(() => this.draw());
    return this;
  }

  getBounds(): LatLngBounds {
    return L.latLngBounds(this.latlngs.map(([lat, lng]) => [lat, lng] as LatLngExpression as [number, number]));
  }

  onAdd(map: LeafletMap) {
    this.heatMap = map;
    if (!this.canvas) this.initCanvas(map);
    const pane = map.getPanes().overlayPane;
    if (this.canvas) pane.appendChild(this.canvas);
    map.on('moveend', this.reset, this);
    this.reset();
    return this;
  }

  onRemove(map: LeafletMap) {
    if (this.canvas?.parentNode) this.canvas.parentNode.removeChild(this.canvas);
    map.off('moveend', this.reset, this);
    if (this.frame !== null) {
      L.Util.cancelAnimFrame(this.frame);
      this.frame = null;
    }
    return this;
  }

  private initCanvas(map: LeafletMap) {
    const canvas = (this.canvas = L.DomUtil.create('canvas', 'leaflet-heatmap-layer leaflet-layer'));
    canvas.style.transformOrigin = '50% 50%';
    const size = map.getSize();
    canvas.width = size.x;
    canvas.height = size.y;
    // The map of a coordinate map does not animate its zoom
    L.DomUtil.addClass(canvas, 'leaflet-zoom-hide');
    this.heat = new SimpleHeat(canvas);
    this.heat.radius(this.heatOptions.radius || DEFAULT_RADIUS, this.heatOptions.blur);
    if (this.heatOptions.gradient) this.heat.gradient(this.heatOptions.gradient);
    if (this.heatOptions.max) this.heat.max(this.heatOptions.max);
  }

  private reset() {
    const map = this.heatMap;
    const heat = this.heat;
    if (!map || !this.canvas || !heat) return;
    const topLeft = map.containerPointToLayerPoint([0, 0]);
    L.DomUtil.setPosition(this.canvas, topLeft);
    const size = map.getSize();
    if (heat.width !== size.x) this.canvas.width = heat.width = size.x;
    if (heat.height !== size.y) this.canvas.height = heat.height = size.y;
    this.draw();
  }

  private draw() {
    const map = this.heatMap;
    const heat = this.heat;
    this.frame = null;
    if (!map || !heat) return;
    const size = map.getSize();
    const max = this.heatOptions.max === undefined ? 1 : this.heatOptions.max;
    const maxZoom = this.heatOptions.maxZoom === undefined ? map.getMaxZoom() : this.heatOptions.maxZoom;
    // The position of the map's pane: where the container's origin is in layer coordinates
    const origin = map.containerPointToLayerPoint([0, 0]);
    const panePos = { x: -origin.x, y: -origin.y };
    const points = this.latlngs.map((latlng) => {
      const p = map.latLngToContainerPoint([latlng[0], latlng[1]]);
      return { x: p.x, y: p.y, intensity: latlng[2] !== undefined ? +latlng[2] : 1 };
    });
    const data = gatherHeat(points, { radius: heat.r, size: { x: size.x, y: size.y }, panePos, max, zoomFactor: heatZoomFactor(maxZoom, map.getZoom()) });
    heat.setData(data).draw(this.heatOptions.minOpacity);
  }
}

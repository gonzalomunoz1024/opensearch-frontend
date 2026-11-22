/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The drawing of a filter on a coordinate map: the toolbar of Leaflet.draw as maps_legacy sets it
 * up (a polygon and a rectangle, drawn in the theme's ink), written on Leaflet without
 * Leaflet.draw. A finished shape goes to OsdMap.drawCreated, which the visualization turns into a
 * geo_polygon or geo_bounding_box filter.
 */

import type { Control, LatLng, LeafletMouseEvent, Map as LeafletMap, Marker, Polyline, Rectangle } from 'leaflet';
import { L } from '../../maps/leaflet';
import type { OsdMap } from '../../maps/osd_map';

/** euiColorInk of the Atlas theme */
const DRAW_COLOR = '#1d1d1f';
/** Leaflet.draw's polygon guide: a dash every 20 pixels */
const GUIDELINE_DISTANCE = 20;

interface Mode {
  enable(): void;
  disable(): void;
  actions: Array<{ title: string; text: string; run: () => void }>;
}

/** Leaflet.draw's polygon handler: clicks add points, the first point or "Finish" closes it */
class PolygonDraw implements Mode {
  private points: LatLng[] = [];
  private markers: Marker[] = [];
  private poly: Polyline | null = null;
  private guides: HTMLElement | null = null;
  private mouse: LatLng | null = null;
  readonly actions = [
    { title: 'Finish drawing', text: 'Finish', run: () => this.finish() },
    { title: 'Delete last point drawn', text: 'Delete last point', run: () => this.deleteLastVertex() },
    { title: 'Cancel drawing', text: 'Cancel', run: () => this.done() },
  ];

  constructor(
    private readonly map: LeafletMap,
    private readonly osdMap: OsdMap,
    private readonly done: () => void
  ) {}

  enable() {
    this.points = [];
    this.map.getContainer().classList.add('leaflet-draw-drawing');
    this.map.doubleClickZoom.disable();
    this.map.on('click', this.onClick, this);
    this.map.on('mousemove', this.onMove, this);
    this.map.on('dblclick', this.onDoubleClick, this);
    this.map.on('zoomend', this.redrawGuide, this);
    this.guides = L.DomUtil.create('div', 'leaflet-draw-guides', this.map.getPanes().overlayPane);
  }

  disable() {
    this.map.getContainer().classList.remove('leaflet-draw-drawing');
    this.map.doubleClickZoom.enable();
    this.map.off('click', this.onClick, this);
    this.map.off('mousemove', this.onMove, this);
    this.map.off('dblclick', this.onDoubleClick, this);
    this.map.off('zoomend', this.redrawGuide, this);
    for (const marker of this.markers) this.map.removeLayer(marker);
    this.markers = [];
    if (this.poly) this.map.removeLayer(this.poly);
    this.poly = null;
    if (this.guides) L.DomUtil.remove(this.guides);
    this.guides = null;
    this.points = [];
  }

  private onClick(event: LeafletMouseEvent) {
    this.addVertex(event.latlng);
  }

  private onDoubleClick() {
    this.finish();
  }

  private onMove(event: LeafletMouseEvent) {
    this.mouse = event.latlng;
    this.redrawGuide();
  }

  private addVertex(latlng: LatLng) {
    // A click on the first point closes the polygon
    if (this.points.length > 2) {
      const first = this.map.latLngToContainerPoint(this.points[0]);
      const here = this.map.latLngToContainerPoint(latlng);
      if (first.distanceTo(here) <= 10) {
        this.finish();
        return;
      }
    }
    this.points.push(latlng);
    const touch = this.map.getContainer().classList.contains('leaflet-touch');
    const size = touch ? 20 : 8;
    const marker = L.marker(latlng, {
      icon: L.divIcon({ className: 'leaflet-div-icon leaflet-editing-icon', iconSize: [size, size] }),
      zIndexOffset: 2000,
    });
    marker.on('click', (event: LeafletMouseEvent) => {
      L.DomEvent.stopPropagation(event.originalEvent);
      if (marker === this.markers[0] && this.points.length > 2) this.finish();
    });
    marker.addTo(this.map);
    this.markers.push(marker);
    // Leaflet.draw draws a polygon while it is made: closed and filled
    if (!this.poly) this.poly = L.polygon([], { color: DRAW_COLOR, weight: 4, opacity: 0.5, fill: true, fillOpacity: 0.2, interactive: false }).addTo(this.map);
    this.poly.setLatLngs(this.points);
    this.redrawGuide();
  }

  private deleteLastVertex() {
    if (!this.points.length) return;
    this.points.pop();
    const marker = this.markers.pop();
    if (marker) this.map.removeLayer(marker);
    this.poly?.setLatLngs(this.points);
    this.redrawGuide();
  }

  private redrawGuide() {
    const guides = this.guides;
    if (!guides) return;
    guides.innerHTML = '';
    const last = this.points[this.points.length - 1];
    if (!last || !this.mouse) return;
    const from = this.map.latLngToLayerPoint(last);
    const to = this.map.latLngToLayerPoint(this.mouse);
    const length = Math.floor(Math.sqrt((to.x - from.x) ** 2 + (to.y - from.y) ** 2));
    for (let i = GUIDELINE_DISTANCE; i < length; i += GUIDELINE_DISTANCE) {
      const fraction = i / length;
      const dash = L.DomUtil.create('div', 'leaflet-draw-guide-dash', guides);
      dash.style.backgroundColor = DRAW_COLOR;
      L.DomUtil.setPosition(dash, L.point(Math.floor(from.x * (1 - fraction) + fraction * to.x), Math.floor(from.y * (1 - fraction) + fraction * to.y)));
    }
  }

  private finish() {
    if (this.points.length < 3) return;
    const points = this.points.map((point) => ({ lat: point.lat, lng: point.lng }));
    this.done();
    this.osdMap.drawCreated('polygon', points);
  }
}

/** Leaflet.draw's rectangle handler: pressed, dragged and let go */
class RectangleDraw implements Mode {
  private start: LatLng | null = null;
  private shape: Rectangle | null = null;
  readonly actions = [{ title: 'Cancel drawing', text: 'Cancel', run: () => this.done() }];

  constructor(
    private readonly map: LeafletMap,
    private readonly osdMap: OsdMap,
    private readonly done: () => void
  ) {}

  enable() {
    this.map.dragging.disable();
    this.map.getContainer().classList.add('leaflet-draw-drawing');
    this.map.on('mousedown', this.onDown, this);
    this.map.on('mousemove', this.onMove, this);
    L.DomEvent.on(document, 'mouseup', this.onUp, this);
  }

  disable() {
    this.map.dragging.enable();
    this.map.getContainer().classList.remove('leaflet-draw-drawing');
    this.map.off('mousedown', this.onDown, this);
    this.map.off('mousemove', this.onMove, this);
    L.DomEvent.off(document, 'mouseup', this.onUp, this);
    if (this.shape) this.map.removeLayer(this.shape);
    this.shape = null;
    this.start = null;
  }

  private onDown(event: LeafletMouseEvent) {
    this.start = event.latlng;
  }

  private onMove(event: LeafletMouseEvent) {
    if (!this.start) return;
    const bounds = L.latLngBounds(this.start, event.latlng);
    if (!this.shape) {
      this.shape = L.rectangle(bounds, { stroke: false, color: DRAW_COLOR, weight: 4, opacity: 0.5, fill: true, fillOpacity: 0.2, interactive: false });
      this.shape.addTo(this.map);
    } else this.shape.setBounds(bounds);
  }

  private onUp() {
    const shape = this.shape;
    this.start = null;
    if (!shape) return;
    const bounds = shape.getBounds();
    this.done();
    this.osdMap.drawCreated('rectangle', bounds);
  }
}

/** The control of the draw toolbar, at the top left under the zoom and "Fit Data Bounds" */
export function createDrawControl(osdMap: OsdMap, leafletMap: LeafletMap): Control {
  const control = new L.Control({ position: 'topleft' });
  let active: { mode: Mode; button: HTMLAnchorElement } | null = null;
  let onKey: ((event: Event) => void) | null = null;

  control.onAdd = () => {
    const container = L.DomUtil.create('div', 'leaflet-draw leaflet-control');
    const section = L.DomUtil.create('div', 'leaflet-draw-section', container);
    const toolbar = L.DomUtil.create('div', 'leaflet-draw-toolbar leaflet-bar leaflet-draw-toolbar-top', section);
    const actions = L.DomUtil.create('ul', 'leaflet-draw-actions', section);

    const stop = () => {
      if (!active) return;
      active.mode.disable();
      active.button.classList.remove('leaflet-draw-toolbar-button-enabled');
      active = null;
      actions.style.display = 'none';
      actions.innerHTML = '';
      actions.classList.remove('leaflet-draw-actions-top', 'leaflet-draw-actions-bottom');
      toolbar.classList.remove('leaflet-draw-toolbar-notop', 'leaflet-draw-toolbar-nobottom');
    };

    const modes: Array<{ type: string; title: string; make: () => Mode }> = [
      { type: 'polygon', title: 'Draw a polygon', make: () => new PolygonDraw(leafletMap, osdMap, stop) },
      { type: 'rectangle', title: 'Draw a rectangle', make: () => new RectangleDraw(leafletMap, osdMap, stop) },
    ];
    modes.forEach(({ type, title, make }, index) => {
      const button = L.DomUtil.create('a', `leaflet-draw-draw-${type}`, toolbar);
      button.href = '#';
      button.title = title;
      const label = L.DomUtil.create('span', 'sr-only', button);
      label.textContent = title;
      L.DomEvent.disableClickPropagation(button);
      L.DomEvent.on(button, 'click', (event) => {
        L.DomEvent.preventDefault(event);
        const wasActive = active?.button === button;
        stop();
        if (wasActive) return;
        const mode = make();
        active = { mode, button };
        button.classList.add('leaflet-draw-toolbar-button-enabled');
        mode.enable();
        for (const action of mode.actions) {
          const item = L.DomUtil.create('li', '', actions);
          const link = L.DomUtil.create('a', '', item);
          link.href = '#';
          link.title = action.title;
          link.textContent = action.text;
          L.DomEvent.disableClickPropagation(link);
          L.DomEvent.on(link, 'click', (clicked) => {
            L.DomEvent.preventDefault(clicked);
            action.run();
          });
        }
        actions.style.top = `${button.offsetTop - 1}px`;
        if (index === 0) {
          toolbar.classList.add('leaflet-draw-toolbar-notop');
          actions.classList.add('leaflet-draw-actions-top');
        }
        if (index === modes.length - 1) {
          toolbar.classList.add('leaflet-draw-toolbar-nobottom');
          actions.classList.add('leaflet-draw-actions-bottom');
        }
        actions.style.display = 'block';
      });
    });
    L.DomEvent.disableClickPropagation(actions);
    onKey = (event: Event) => {
      if ((event as KeyboardEvent).key === 'Escape') stop();
    };
    L.DomEvent.on(document, 'keyup', onKey);
    return container;
  };
  control.onRemove = () => {
    if (active) active.mode.disable();
    active = null;
    if (onKey) L.DomEvent.off(document, 'keyup', onKey);
  };
  return control;
}

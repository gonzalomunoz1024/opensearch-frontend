/* SPDX-License-Identifier: Apache-2.0 */

/*
 * A layer drawn over the base map: OpenSearchDashboardsMapLayer of maps_legacy. A kind of layer
 * (the markers of a coordinate map, the shapes of a region map, a Vega map) sets `leafletLayer`
 * and overrides what it needs.
 *
 * Events it may emit for the map: 'showTooltip' ({ content, position }), 'hideTooltip',
 * 'styleChanged' (the legend is drawn again).
 */

import type { LatLngBounds, Layer, LeafletMouseEvent, Map as LeafletMap } from 'leaflet';
import { Emitter } from './emitter';

export class OsdMapLayer extends Emitter {
  protected leafletLayer: (Layer & { getBounds?: () => LatLngBounds }) | null = null;
  protected attribution?: string;

  async getBounds(): Promise<LatLngBounds | undefined> {
    return this.leafletLayer?.getBounds?.();
  }

  addToLeafletMap(leafletMap: LeafletMap): void {
    this.leafletLayer?.addTo(leafletMap);
  }

  removeFromLeafletMap(leafletMap: LeafletMap): void {
    if (this.leafletLayer) leafletMap.removeLayer(this.leafletLayer);
  }

  /** Adds this layer's part of the legend to the legend's box */
  appendLegendContents(_container: HTMLElement): void {}

  /** The map moved or zoomed */
  updateExtent(): void {}

  /** The pointer moved over the map, left it, or a button went down or up */
  movePointer(_type: 'mousemove' | 'mouseout' | 'mousedown' | 'mouseup', _event: LeafletMouseEvent): void {}

  /** The attributions, separated by " | " */
  getAttributions(): string | undefined {
    return this.attribution;
  }
}

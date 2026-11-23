/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Leaflet: one copy for the page, kept on `window.L` for code written against the global (a Vega
 * map's layer). maps_legacy sets L.Browser.touch and pointer to false, which Leaflet's own checks
 * never read (they hold copies made when Leaflet loads): maps in OpenSearch Dashboards 3.9.0 have
 * Leaflet's touch classes and styles, and so do these.
 */

import * as Leaflet from 'leaflet';
import 'leaflet/dist/leaflet.css';

type LeafletModule = typeof Leaflet;

declare global {
  interface Window {
    L?: LeafletModule;
  }
}

function setUp(): LeafletModule {
  if (typeof window === 'undefined') return Leaflet;
  window.L ??= Leaflet;
  return window.L;
}

export const L: LeafletModule = setUp();

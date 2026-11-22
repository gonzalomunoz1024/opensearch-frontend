/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Leaflet, set up as maps_legacy sets it up: one copy for the page, kept on `window.L` for code
 * written against the global (a Vega map's layer), with touch and pointer events off.
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
  if (!window.L) {
    const browser = Leaflet.Browser as { touch: boolean; pointer?: boolean };
    browser.touch = false;
    browser.pointer = false;
    window.L = Leaflet;
  }
  return window.L;
}

export const L: LeafletModule = setUp();

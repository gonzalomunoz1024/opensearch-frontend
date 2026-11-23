/* SPDX-License-Identifier: Apache-2.0 */

/*
 * What OpenSearch Dashboards 3.9.0 does to a visualization of a kind that has a `setup`, as its
 * editor loads it and before its state goes to the address (`getVisualizationInstance`:
 * `vis.type.setup(vis)`): a coordinate map takes the first base map of the maps service when it
 * has chosen none (tile_map_type.js); a region map takes that, and its vector map and join field
 * (region_map_type.js).
 */

import type { Vis } from '../../lib/vis';
import { getServiceSettings, type TmsService } from '../../maps/service_settings';
import { services } from '../../services';
import { setupRegionMap } from '../../vis/region_map/region_map_type';

/** `setup` of tile_map_type: the settings with the first base map, when none is chosen and there is one */
export function withBaseMap(params: Record<string, unknown>, tmsLayers: TmsService[]): Record<string, unknown> {
  const { wms } = params;
  if (wms === null || typeof wms !== 'object' || Array.isArray(wms)) return params;
  if ((wms as { selectedTmsLayer?: unknown }).selectedTmsLayer || tmsLayers.length === 0) return params;
  return { ...params, wms: { ...wms, selectedTmsLayer: tmsLayers[0] } };
}

/** The visualization as its kind's `setup` leaves it; a setup that fails leaves it as it was, as in the original */
export async function setupVis(vis: Vis): Promise<Vis> {
  try {
    if (vis.type === 'region_map') return { ...vis, params: (await setupRegionMap(vis.params)).params };
    if (vis.type === 'tile_map') {
      const tmsLayers = await getServiceSettings(services.boot.map, services.boot.version).getTMSServices();
      return { ...vis, params: withBaseMap(vis.params, tmsLayers) };
    }
  } catch {
    // skipped, as the original skips a setup that throws
  }
  return vis;
}

/* SPDX-License-Identifier: Apache-2.0 */

/*
 * What a region map is, as region_map_type of OpenSearch Dashboards 3.9.0 defines it: its
 * defaults, the vector maps one may choose (those of `map.regionmap.layers`, then those of the
 * maps service, and the custom ones: indices named "*-map") and `setup`, which fills in the
 * layer, its join field and the base map of a visualization that has none yet.
 */

import { ORIGIN } from '../../maps/config';
import { getServiceSettings, type FileLayer, type TmsService } from '../../maps/service_settings';
import { services } from '../../services';

export const DEFAULT_MAP_CHOICE = 'default';
export const CUSTOM_MAP_CHOICE = 'custom';
export const CUSTOM_VECTOR_MAP_MAX_SIZE_SETTING = 'visualization:regionmap:customVectorMapMaxSize';
export const SHOW_WARNINGS_SETTING = 'visualization:regionmap:showWarnings';

/** A vector map as the editor offers it and a visualization saves it */
export type VectorLayer = FileLayer & { layerId: string; isEMS: boolean };
export type FileLayerField = FileLayer['fields'][number];

export interface RegionMapParams {
  layerChosenByUser?: string;
  legendPosition?: 'topleft' | 'topright' | 'bottomleft' | 'bottomright';
  addTooltip?: boolean;
  colorSchema?: string;
  emsHotLink?: string | null;
  isDisplayWarning?: boolean;
  wms?: Record<string, unknown> & { selectedTmsLayer?: TmsService };
  mapZoom?: number;
  mapCenter?: [number, number];
  outlineWeight?: number;
  showAllShapes?: boolean;
  selectedLayer?: VectorLayer;
  selectedJoinField?: FileLayerField | null;
  selectedCustomLayer?: VectorLayer;
  selectedCustomJoinField?: FileLayerField | null;
  [param: string]: unknown;
}

const WMS_FALLBACK = {
  enabled: false,
  url: '',
  options: { version: '', layers: '', format: 'image/png', transparent: true, attribution: '', styles: '' },
};

function wmsSetting(): Record<string, unknown> {
  const value = services.uiSettings.get<unknown>('visualization:tileMap:WMSdefaults', undefined);
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return WMS_FALLBACK;
    }
  }
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : WMS_FALLBACK;
}

/** visConfig.defaults of the region map */
export function regionMapDefaults(): RegionMapParams {
  return {
    layerChosenByUser: DEFAULT_MAP_CHOICE,
    legendPosition: 'bottomright',
    addTooltip: true,
    colorSchema: 'Yellow to Red',
    emsHotLink: '',
    isDisplayWarning: true,
    wms: structuredClone(wmsSetting()),
    mapZoom: 2,
    mapCenter: [0, 0],
    outlineWeight: 1,
    showAllShapes: true,
  };
}

/** mapToLayerWithId of region_map's util */
export const mapToLayerWithId = (prefix: string, layer: FileLayer): VectorLayer => ({
  ...layer,
  layerId: `${prefix}.${layer.name}`,
  isEMS: ORIGIN.EMS === prefix,
});

export const serviceSettings = () => getServiceSettings(services.boot.map, services.boot.version);

/** The routes of the plugin, as its page calls them ('../api/...' from /app/visualize) */
async function geospatial<T>(route: '_indices' | '_mappings', body: Record<string, unknown>): Promise<T | undefined> {
  try {
    return await services.http.post<T>(`/api/geospatial/${route}`, { body, query: { dataSourceId: '' } });
  } catch {
    return undefined;
  }
}

/** The names of the custom vector maps: indices named "*-map"; false when they cannot be asked */
export async function getCustomIndices(): Promise<string[] | false> {
  const answer = await geospatial<{ resp?: string[] }>('_indices', { index: '*-map' });
  return answer?.resp ?? false;
}

/** The join fields of a custom vector map: every property of its mapping but `location` */
export async function getJoinFields(indexName: string): Promise<FileLayerField[] | false> {
  try {
    const answer = await geospatial<{ resp: Record<string, { mappings: { properties: Record<string, unknown> } }> }>('_mappings', {
      index: indexName,
    });
    if (!answer) return false;
    const properties = Object.keys(answer.resp[indexName].mappings.properties);
    // diffArray of the original: the properties without 'location', and 'location' when absent
    const fields = [...properties, 'location'].filter((item) => !properties.includes(item) || item !== 'location');
    return fields.map((property) => ({ type: 'id', name: property, description: property }));
  } catch {
    return false;
  }
}

async function addSchemaToCustomLayer(customLayer: string): Promise<VectorLayer> {
  const joinFields = await getJoinFields(customLayer);
  return {
    attribution:
      '<a rel="noreferrer noopener" href="http://www.naturalearthdata.com/about/terms-of-use">Made with NaturalEarth</a>',
    created_at: '2017-04-26T17:12:15.978370',
    format: 'geojson',
    fields: joinFields as FileLayerField[],
    id: customLayer,
    meta: undefined,
    name: customLayer,
    origin: 'user-upload',
    layerId: '',
    isEMS: false,
  };
}

/** editorConfig.collections of the region map, as `setup` fills them */
export interface RegionMapCollections {
  vectorLayers: VectorLayer[];
  customVectorLayers: VectorLayer[];
  tmsLayers: TmsService[];
}

/** `setup` of region_map_type: fills in what a visualization has not chosen yet, and the collections */
export async function setupRegionMap(params: RegionMapParams): Promise<{ params: RegionMapParams; collections: RegionMapCollections }> {
  const next: RegionMapParams = { ...params, wms: { ...(params.wms ?? wmsSetting()) } };
  const settings = serviceSettings();
  const config = services.boot.map.regionmap;
  const tmsLayers = await settings.getTMSServices();
  if (next.wms && !next.wms.selectedTmsLayer && tmsLayers.length) next.wms.selectedTmsLayer = tmsLayers[0];

  let vectorLayers = config.layers.map((layer) => mapToLayerWithId(ORIGIN.OPENSEARCH_DASHBOARDS_YML, layer as FileLayer));
  let customVectorLayers = config.layers.map((layer) => mapToLayerWithId(ORIGIN.OPENSEARCH_DASHBOARDS_YML, layer as FileLayer));
  const customIndices = await getCustomIndices();

  let selectedLayer: VectorLayer | undefined = vectorLayers[0];
  let selectedJoinField: FileLayerField | null = selectedLayer ? selectedLayer.fields[0] : null;
  let selectedCustomLayer: VectorLayer | undefined = customVectorLayers[0];
  let selectedCustomJoinField: FileLayerField | null = selectedCustomLayer ? selectedCustomLayer.fields[0] : null;

  if (config.includeOpenSearchMapsService) {
    const layers = await settings.getFileLayers();
    const newLayers = layers
      .map((layer) => mapToLayerWithId(ORIGIN.EMS, layer))
      .filter((layer) => !vectorLayers.some((vectorLayer) => vectorLayer.layerId === layer.layerId));
    // As the original, which maps over the answer whatever it is
    const newCustomLayers = await Promise.all((customIndices || []).map((name) => addSchemaToCustomLayer(name)));
    // Backfill of the v1 manifest
    newLayers.forEach((layer) => {
      if (layer.format === 'geojson') layer.format = { type: 'geojson' };
    });
    newCustomLayers.forEach((layer) => {
      if (layer.format === 'geojson') {
        layer.format = { type: 'geojson' };
        layer.isEMS = false;
        layer.layerId = `${layer.origin}.${layer.name}`;
      }
    });
    vectorLayers = [...vectorLayers, ...newLayers];
    customVectorLayers = [...customVectorLayers, ...newCustomLayers];
    [selectedLayer] = vectorLayers;
    selectedJoinField = selectedLayer ? selectedLayer.fields[0] : null;
    [selectedCustomLayer] = customVectorLayers;
    selectedCustomJoinField = selectedCustomLayer ? selectedCustomLayer.fields[0] : null;
    if (selectedLayer && !next.selectedLayer && selectedLayer.isEMS) {
      next.emsHotLink = await settings.getEMSHotLink(selectedLayer);
    }
  }

  if (!next.selectedLayer) {
    next.selectedLayer = selectedLayer;
    next.selectedJoinField = selectedJoinField;
  }
  if (!next.selectedCustomLayer) {
    next.selectedCustomLayer = selectedCustomLayer;
    next.selectedCustomJoinField = selectedCustomJoinField;
  }
  next.layerChosenByUser = next.layerChosenByUser ? next.layerChosenByUser : DEFAULT_MAP_CHOICE;
  return { params: next, collections: { vectorLayers, customVectorLayers, tmsLayers } };
}

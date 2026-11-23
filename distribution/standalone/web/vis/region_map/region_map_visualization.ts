/* SPDX-License-Identifier: Apache-2.0 */

/*
 * A region map drawn: RegionMapsVisualization of region_map. The base map is BaseMapsVis's; over
 * it one ChoroplethLayer, made again when the vector map or "Show all shapes" changes, and given
 * the terms and values of each answer.
 */

import { BaseMapsVis, type MapVisHost } from '../../maps/base_maps_vis';
import type { FileLayer } from '../../maps/service_settings';
import { bucketFilter, type AggContext, type Table, type TableColumn } from '../../lib/aggs';
import type { Filter } from '../../lib/types';
import { services } from '../../services';
import { ChoroplethLayer } from './choropleth_layer';
import { truncatedColorRamp } from './color_maps';
import {
  CUSTOM_MAP_CHOICE,
  DEFAULT_MAP_CHOICE,
  SHOW_WARNINGS_SETTING,
  serviceSettings,
  type RegionMapParams,
  type VectorLayer,
} from './region_map_type';
import { mapTooltipProvider, tooltipFormatter } from './tooltip_formatter';
import { mismatchWarning, regionMetrics, type RegionMetric } from './util';

/** What a region map draws: the table of its answer, and what a click needs to filter */
export interface RegionMapData {
  table: Table;
  context: AggContext;
}

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

export class RegionMapVisualization extends BaseMapsVis<RegionMapData> {
  private choroplethLayer: ChoroplethLayer | null = null;
  private readonly tooltip = mapTooltipProvider(tooltipFormatter);
  private termColumn?: TableColumn;
  private valueColumn?: TableColumn;

  constructor(
    container: HTMLElement,
    vis: MapVisHost,
    private readonly onFilter?: (filters: Filter[]) => void
  ) {
    super(container, vis);
  }

  private get regionParams(): RegionMapParams {
    return this.getMapsParams() as RegionMapParams;
  }

  async render(data: RegionMapData, params: RegionMapParams): Promise<void> {
    this.choroplethLayer?.setLayerChosenByUser(params.layerChosenByUser);
    await super.render(data, params);
    if (this.choroplethLayer) {
      this.choroplethLayer.setLayerChosenByUser(params.layerChosenByUser);
      await this.choroplethLayer.whenDataLoaded();
    }
  }

  protected async updateData(data: RegionMapData): Promise<void> {
    this.chartData = data;
    const { results, termColumn, valueColumn } = regionMetrics(data.table);
    this.termColumn = termColumn;
    this.valueColumn = valueColumn;
    const params = this.regionParams;

    let selectedLayer: FileLayer | null | undefined;
    let joinField: string | undefined;
    if (DEFAULT_MAP_CHOICE === params.layerChosenByUser) {
      selectedLayer = await this.loadConfig(params.selectedLayer);
      joinField = selectedLayer?.fields[0]?.name;
    } else {
      selectedLayer = params.selectedCustomLayer;
      joinField = params.selectedCustomJoinField?.name;
    }
    if (!joinField && selectedLayer) joinField = selectedLayer.fields[0]?.name;
    if (!selectedLayer) return;

    await this.updateChoroplethLayerForNewMetrics(selectedLayer.name, selectedLayer.attribution, params.showAllShapes === true, results);
    const layer = this.choroplethLayer;
    if (!layer) return;
    const format = valueColumn ? valueColumn.format : String;
    layer.setMetrics(results, format, valueColumn?.name ?? '');
    if (termColumn && valueColumn) layer.setTooltipFormatter(this.tooltip, format, termColumn.name, valueColumn.name);
    this.map?.useUiStateFromVisualization(this.vis);
  }

  /**
   * The vector map of the maps service or of opensearch_dashboards.yml, by its name: never the
   * one saved in the visualization, which the address could carry from anywhere.
   */
  private async loadConfig(fileLayerConfig: VectorLayer | undefined): Promise<FileLayer | null> {
    if (fileLayerConfig && (fileLayerConfig.isEMS || fileLayerConfig.layerId?.startsWith('elastic_maps_service.'))) {
      return serviceSettings().loadFileLayerConfig(fileLayerConfig);
    }
    const configured = services.boot.map.regionmap.layers.find((layer) => layer.name === fileLayerConfig?.name);
    if (configured) {
      return { ...(configured as FileLayer), attribution: escapeHtml(configured.attribution ? configured.attribution : '') };
    }
    return null;
  }

  protected async updateParams(): Promise<void> {
    await super.updateParams();
    const params = this.regionParams;
    let selectedLayer: FileLayer | null | undefined;
    let joinField = params.selectedJoinField?.name;
    if (DEFAULT_MAP_CHOICE === params.layerChosenByUser && params.selectedLayer) {
      selectedLayer = await this.loadConfig(params.selectedLayer);
    } else if (CUSTOM_MAP_CHOICE === params.layerChosenByUser && params.selectedCustomLayer) {
      selectedLayer = params.selectedCustomLayer;
      joinField = params.selectedCustomJoinField?.name;
    }
    if (!joinField && selectedLayer) joinField = selectedLayer.fields[0]?.name;
    if (!joinField || !selectedLayer) return;

    await this.updateChoroplethLayerForNewProperties(selectedLayer.name, selectedLayer.attribution, params.showAllShapes === true);
    const layer = this.choroplethLayer;
    if (!layer) return;
    layer.setLayerChosenByUser(params.layerChosenByUser);
    layer.setJoinField(joinField);
    const ramp = truncatedColorRamp(String(params.colorSchema));
    if (!ramp) throw new TypeError("Cannot read properties of undefined (reading 'value')");
    layer.setColorRamp(ramp);
    layer.setLineWeight(Number(params.outlineWeight));
    // The original passes no names here, and the answer that follows passes them again; when only
    // the settings change, this product draws without a new answer, so the names are kept
    const format = this.valueColumn ? this.valueColumn.format : undefined;
    layer.setTooltipFormatter(this.tooltip, format, this.termColumn?.name, this.valueColumn?.name);
  }

  private async updateChoroplethLayerForNewMetrics(name: string, attribution: string, showAllData: boolean, newMetrics: RegionMetric[]) {
    this.choroplethLayer?.setLayerChosenByUser(this.regionParams.layerChosenByUser);
    if (this.choroplethLayer && this.choroplethLayer.canReuseInstanceForNewMetrics(name, showAllData, newMetrics)) return;
    await this.recreateChoroplethLayer(name, attribution, showAllData);
  }

  private async updateChoroplethLayerForNewProperties(name: string, attribution: string, showAllData: boolean) {
    if (this.choroplethLayer && this.choroplethLayer.canReuseInstance(name, showAllData)) return;
    await this.recreateChoroplethLayer(name, attribution, showAllData);
  }

  private async recreateChoroplethLayer(name: string, attribution: string, showAllData: boolean) {
    const params = this.regionParams;
    const selectedLayer =
      DEFAULT_MAP_CHOICE === params.layerChosenByUser ? await this.loadConfig(params.selectedLayer) : params.selectedCustomLayer;
    if (!selectedLayer || !this.map) return;
    this.map.removeLayer(this.choroplethLayer);
    const settings = serviceSettings();
    const layer = this.choroplethLayer
      ? this.choroplethLayer.cloneChoroplethLayerForNewData(
          name,
          attribution,
          selectedLayer.format,
          showAllData,
          selectedLayer.meta,
          selectedLayer,
          settings,
          params.layerChosenByUser
        )
      : new ChoroplethLayer(name, attribution, selectedLayer.format, showAllData, selectedLayer.meta, selectedLayer, settings, params.layerChosenByUser);
    this.choroplethLayer = layer;
    layer.setLayerChosenByUser(params.layerChosenByUser);

    layer.on('select', (value: unknown) => {
      const column = this.chartData?.table.columns[0];
      if (!column || !this.chartData || !this.onFilter) return;
      const filter = bucketFilter(column, value, this.chartData.context);
      if (filter) this.onFilter([filter]);
    });

    layer.on('styleChanged', (event: { mismatches: unknown[] }) => {
      const current = this.regionParams;
      const shouldShowWarning = current.isDisplayWarning && services.uiSettings.get<boolean>(SHOW_WARNINGS_SETTING, true);
      if (event.mismatches.length > 0 && shouldShowWarning) {
        const { title, text } = mismatchWarning(event.mismatches);
        services.toasts.warning(title, text);
      }
    });

    this.map.addLayer(layer);
  }
}

/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The "Options" tab of a coordinate map: TileMapOptions of tile_map (map type, colour schema or
 * cluster size, legend position, tooltip, desaturation), then the base layer settings.
 */

import { FormRow, RangeField, Select, Switch } from '../../../components/form';
import { COLOR_SCHEMA_OPTIONS, LEGEND_POSITION_OPTIONS, MAP_TYPE_OPTIONS } from '../../../vis/tile_map/defaults';
import { WmsOptions } from './wms_options';
import '../../../styles/tile_map.css';

export interface TileMapOptionsProps {
  params: Record<string, unknown>;
  setParams: (params: Record<string, unknown>) => void;
}

export function TileMapOptions({ params, setParams }: TileMapOptionsProps) {
  const set = (name: string, value: unknown) => setParams({ ...params, [name]: value });
  const mapType = String(params.mapType ?? MAP_TYPE_OPTIONS[0].value);
  const clusterSize = Number(params.heatClusterSize ?? 1.5);
  return (
    <>
      <section className="vzePanel" data-test-subj="tileMapOptions">
        <div className="vzeFields">
          <FormRow label="Map type" full>
            <Select compact value={mapType} options={MAP_TYPE_OPTIONS} onChange={(value) => set('mapType', value)} testId="mapType" />
          </FormRow>
          {mapType === 'Heatmap' ? (
            <FormRow label="Cluster size" full>
              <span className="vzeRangeValue">
                <RangeField min={1} max={3} step={0.1} value={clusterSize} onChange={(value) => set('heatClusterSize', value)} />
                <span>{clusterSize}</span>
              </span>
            </FormRow>
          ) : (
            <FormRow label="Color schema" full>
              <Select compact value={String(params.colorSchema ?? '')} options={COLOR_SCHEMA_OPTIONS} onChange={(value) => set('colorSchema', value)} testId="colorSchema" />
            </FormRow>
          )}
          <FormRow label="Legend position" full>
            <Select
              compact
              value={String(params.legendPosition ?? 'bottomright')}
              options={LEGEND_POSITION_OPTIONS}
              onChange={(value) => set('legendPosition', value)}
              testId="legendPositionSelect"
            />
          </FormRow>
          <Switch checked={Boolean(params.addTooltip)} onChange={(value) => set('addTooltip', value)} label="Show tooltip" testId="addTooltip" />
          <span title="Reduce the vibrancy of tile colors. This does not work in any version of Internet Explorer.">
            <Switch checked={Boolean(params.isDesaturated)} onChange={(value) => set('isDesaturated', value)} label="Desaturate tiles" testId="isDesaturated" />
          </span>
        </div>
      </section>
      <WmsOptions params={params} setParams={setParams} />
    </>
  );
}

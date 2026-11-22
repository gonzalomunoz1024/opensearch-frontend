/* SPDX-License-Identifier: Apache-2.0 */

/*
 * "Layer settings" of a region map when there is no custom vector map: the vector map of the
 * maps service or of opensearch_dashboards.yml, its join field, and the two switches.
 * DefaultMapOptions of region_map.
 */

import { FormRow, Select, Switch } from '../../../components/form';
import type { FileLayerField, RegionMapParams, VectorLayer } from '../../../vis/region_map/region_map_type';
import { serviceSettings } from '../../../vis/region_map/region_map_type';

export interface RegionMapOptionsProps {
  params: RegionMapParams;
  setParams: (params: RegionMapParams) => void;
  vectorLayers: VectorLayer[];
  customVectorLayers: VectorLayer[];
}

export const WARNINGS_TIP =
  'Turns on/off warnings. When turned on, warning will be shown for each term that cannot be matched to a shape in the vector layer based on the join field. When turned off, these warnings will be turned off.';
export const SHOW_ALL_SHAPES_TIP = 'Turning this off only shows the shapes that were matched with a corresponding term.';

export const layerOptions = (layers: VectorLayer[]) => layers.map(({ layerId, name }) => ({ value: layerId, label: name }));
export const fieldOptions = (layer: VectorLayer | undefined) =>
  ((layer && layer.fields) || []).map(({ description, name }) => ({ value: name, label: description }));

/** A select whose value may be missing from its options, which shows empty as EuiSelect does */
export function LayerSelect({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string | undefined;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  const known = options.some((option) => option.value === value);
  return (
    <FormRow label={label} full>
      <Select
        compact
        id={id}
        testId={id}
        value={known ? String(value) : ''}
        options={known ? options : [{ value: '', label: '' }, ...options]}
        onChange={onChange}
      />
    </FormRow>
  );
}

/** The two switches at the bottom of "Layer settings" */
export function LayerSwitches({ params, setParams }: Pick<RegionMapOptionsProps, 'params' | 'setParams'>) {
  return (
    <>
      <span title={WARNINGS_TIP}>
        <Switch
          checked={Boolean(params.isDisplayWarning)}
          onChange={(isDisplayWarning) => setParams({ ...params, isDisplayWarning })}
          label="Display warnings"
          testId="isDisplayWarning"
        />
      </span>
      <span title={SHOW_ALL_SHAPES_TIP}>
        <Switch
          checked={Boolean(params.showAllShapes)}
          onChange={(showAllShapes) => setParams({ ...params, showAllShapes })}
          label="Show all shapes"
          testId="showAllShapes"
        />
      </span>
    </>
  );
}

/** Choosing a vector map: its first field becomes the join field, and its link on the maps service is kept */
export async function chooseLayer(
  params: RegionMapParams,
  setParams: (params: RegionMapParams) => void,
  vectorLayers: VectorLayer[],
  value: string
) {
  const newLayer = vectorLayers.find(({ layerId }) => layerId === value);
  if (!newLayer) return;
  const next = { ...params, selectedLayer: newLayer, selectedJoinField: newLayer.fields[0] };
  setParams(next);
  const emsHotLink = await serviceSettings().getEMSHotLink(newLayer);
  setParams({ ...next, emsHotLink });
}

export function chooseField(params: RegionMapParams, setParams: (params: RegionMapParams) => void, value: string) {
  if (params.selectedLayer) {
    setParams({ ...params, selectedJoinField: params.selectedLayer.fields.find((f: FileLayerField) => f.name === value) });
  }
}

export function DefaultMapOptions({ params, setParams, vectorLayers }: RegionMapOptionsProps) {
  return (
    <section className="vzePanel">
      <h3 className="vzePanel__title">Layer settings</h3>
      <div className="vzeFields" id="defaultMapSelection">
        <LayerSelect
          id="regionMapOptionsSelectLayer"
          label="Vector map"
          options={layerOptions(vectorLayers)}
          value={params.selectedLayer && params.selectedLayer.layerId}
          onChange={(value) => void chooseLayer(params, setParams, vectorLayers, value)}
        />
        <LayerSelect
          id="regionMapOptionsSelectJoinField"
          label="Join field"
          options={fieldOptions(params.selectedLayer)}
          value={params.selectedJoinField ? params.selectedJoinField.name : undefined}
          onChange={(value) => chooseField(params, setParams, value)}
        />
        <LayerSwitches params={params} setParams={setParams} />
      </div>
    </section>
  );
}

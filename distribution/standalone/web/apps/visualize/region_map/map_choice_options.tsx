/* SPDX-License-Identifier: Apache-2.0 */

/*
 * "Layer settings" of a region map when custom vector maps exist ("*-map" indices or layers of
 * opensearch_dashboards.yml): a choice between the default vector maps and the custom ones, then
 * the map and join field of that choice. MapChoiceOptions of region_map.
 */

import { CUSTOM_MAP_CHOICE, DEFAULT_MAP_CHOICE } from '../../../vis/region_map/region_map_type';
import {
  chooseField,
  chooseLayer,
  fieldOptions,
  layerOptions,
  LayerSelect,
  LayerSwitches,
  type RegionMapOptionsProps,
} from './default_map_options';

function ChoiceCard({ id, label, checked, onChange }: { id: string; label: string; checked: boolean; onChange: () => void }) {
  return (
    <label className={`vzeChoiceCard${checked ? ' vzeChoiceCard--checked' : ''}`} htmlFor={id} data-test-subj={id}>
      <input type="radio" id={id} name={id} value={id === 'defaultVectorMap' ? 'default' : 'custom'} checked={checked} onChange={onChange} />
      <span>{label}</span>
    </label>
  );
}

export function MapChoiceOptions({ params, setParams, vectorLayers, customVectorLayers }: RegionMapOptionsProps) {
  const isDefault = DEFAULT_MAP_CHOICE === params.layerChosenByUser;
  const setCustomLayer = (value: string) => {
    const newLayer = customVectorLayers.find(({ layerId }) => layerId === value);
    // As the original, the join field it sets is that of the default vector map
    if (newLayer) setParams({ ...params, selectedCustomLayer: newLayer, selectedJoinField: newLayer.fields[0] });
  };
  const setCustomJoinField = (value: string) => {
    if (params.selectedCustomLayer) {
      setParams({ ...params, selectedCustomJoinField: params.selectedCustomLayer.fields.find((f) => f.name === value) });
    }
  };
  return (
    <section className="vzePanel">
      <h3 className="vzePanel__title">Layer settings</h3>
      <div className="vzeFields">
        <strong className="atlXs">Choose a vector map layer</strong>
        <div className="vzeChoiceGroup mapChoiceGroup">
          <ChoiceCard
            id="defaultVectorMap"
            label="Default vector map"
            checked={isDefault}
            onChange={() => setParams({ ...params, layerChosenByUser: DEFAULT_MAP_CHOICE })}
          />
          <ChoiceCard
            id="customVectorMap"
            label="Custom vector map"
            checked={CUSTOM_MAP_CHOICE === params.layerChosenByUser}
            onChange={() => setParams({ ...params, layerChosenByUser: CUSTOM_MAP_CHOICE })}
          />
        </div>
        {isDefault ? (
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
          </div>
        ) : (
          <div className="vzeFields" id="customMapSelection">
            <LayerSelect
              id="regionMapOptionsCustomSelectLayer"
              label="Vector map"
              options={layerOptions(customVectorLayers)}
              value={params.selectedCustomLayer && params.selectedCustomLayer.layerId}
              onChange={setCustomLayer}
            />
            <LayerSelect
              id="regionMapOptionsCustomSelectJoinField"
              label="Join field"
              options={fieldOptions(params.selectedCustomLayer)}
              value={params.selectedCustomJoinField ? params.selectedCustomJoinField.name : undefined}
              onChange={setCustomJoinField}
            />
          </div>
        )}
        <LayerSwitches params={params} setParams={setParams} />
      </div>
    </section>
  );
}

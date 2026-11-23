/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The "Layer Options" tab of a region map: the layer, its style and the base map. With custom
 * vector maps the layer settings offer a choice between them and the default ones.
 * RegionMapOptions of region_map.
 */

import { useEffect, useState } from 'react';
import { setupRegionMap, type RegionMapCollections, type RegionMapParams } from '../../../vis/region_map/region_map_type';
import { WmsOptions } from '../maps/wms_options';
import type { OptionsProps } from '../options';
import { DefaultMapOptions } from './default_map_options';
import { MapChoiceOptions } from './map_choice_options';
import { StyleOptions } from './style_options';
import '../../../styles/region_map.css';

const EMPTY: RegionMapCollections = { vectorLayers: [], customVectorLayers: [], tmsLayers: [] };

/** editorConfig.collections, as the original's setup fills them when the editor opens */
export function useRegionMapCollections(params: RegionMapParams): RegionMapCollections {
  const [collections, setCollections] = useState<RegionMapCollections>(EMPTY);
  useEffect(() => {
    let live = true;
    setupRegionMap(params)
      .then((answer) => live && setCollections(answer.collections))
      .catch(() => undefined);
    return () => {
      live = false;
    };
    // Once per editor, as setup runs once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return collections;
}

export function RegionMapOptions({ params: raw, setParams: setRaw }: OptionsProps) {
  const params = raw as RegionMapParams;
  const setParams = (next: RegionMapParams) => setRaw(next as Record<string, unknown>);
  const { vectorLayers, customVectorLayers, tmsLayers } = useRegionMapCollections(params);
  const props = { params, setParams, vectorLayers, customVectorLayers };
  return (
    <div id={customVectorLayers.length === 0 ? 'defaultMapOption' : 'customMapOption'} className="vzeRegionMapOptions">
      {customVectorLayers.length === 0 ? <DefaultMapOptions {...props} /> : <MapChoiceOptions {...props} />}
      <StyleOptions params={params} setParams={setParams} />
      <WmsOptions params={raw} setParams={setRaw} tmsLayers={tmsLayers} />
    </div>
  );
}

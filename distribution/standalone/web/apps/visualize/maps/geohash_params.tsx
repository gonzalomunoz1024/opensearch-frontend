/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The params of a geohash_grid in the editor, in the original's order: "Change precision on map
 * zoom", the precision when it does not, "Place markers off grid (use geocentroid)" and "Only
 * request data around map extent".
 */

import { FormRow, RangeField, Switch } from '../../../components/form';
import { services } from '../../../services';
import '../../../styles/tile_map.css';

export function GeohashParams({
  params,
  set,
  aggId,
}: {
  params: Record<string, unknown>;
  set: (patch: Record<string, unknown>) => void;
  aggId: string;
}) {
  const autoPrecision = params.autoPrecision !== false;
  const maxPrecision = parseInt(String(services.uiSettings.get('visualization:tileMap:maxPrecision', 7)), 10) || 12;
  const precision = typeof params.precision === 'number' ? params.precision : 2;
  return (
    <>
      <Switch checked={autoPrecision} onChange={(next) => set({ autoPrecision: next })} label="Change precision on map zoom" testId={`visEditorMapAutoPrecision${aggId}`} />
      {!autoPrecision && (
        <FormRow label="Precision" full>
          <span className="vzeRangeValue" data-test-subj={`visEditorMapPrecision${aggId}`}>
            <RangeField min={1} max={maxPrecision} value={precision} onChange={(next) => set({ precision: next })} />
            <span>{precision}</span>
          </span>
        </FormRow>
      )}
      <Switch
        checked={params.useGeocentroid !== false}
        onChange={(next) => set({ useGeocentroid: next })}
        label="Place markers off grid (use geocentroid)"
        testId="visEditorMapUseGeocentroid"
      />
      <span title="Apply geo_bounding_box filter aggregation to narrow the subject area to the map view box with collar">
        <Switch
          checked={params.isFilteredByCollar !== false}
          onChange={(next) => set({ isFilteredByCollar: next })}
          label="Only request data around map extent"
          testId="isFilteredByCollarCheckbox"
        />
      </span>
    </>
  );
}

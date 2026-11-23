/* SPDX-License-Identifier: Apache-2.0 */

/* "Style settings" of a region map: its colour schema and the thickness of the shapes' borders. */

import { FormRow, NumberField, Select } from '../../../components/form';
import { TRUNCATED_COLOR_SCHEMAS } from '../../../vis/region_map/color_maps';
import type { RegionMapParams } from '../../../vis/region_map/region_map_type';

export function StyleOptions({ params, setParams }: { params: RegionMapParams; setParams: (params: RegionMapParams) => void }) {
  return (
    <section className="vzePanel">
      <h3 className="vzePanel__title" id="styleSettingTitleId">
        Style settings
      </h3>
      <div className="vzeFields">
        <FormRow label="Color schema" full>
          <Select
            compact
            id="colorSchemaId"
            testId="colorSchemaId"
            value={String(params.colorSchema ?? '')}
            options={TRUNCATED_COLOR_SCHEMAS.map(({ value, text }) => ({ value, label: text }))}
            onChange={(colorSchema) => setParams({ ...params, colorSchema })}
          />
        </FormRow>
        <FormRow label="Border thickness" full>
          <NumberField
            compact
            id="borderThicknessId"
            testId="borderThicknessId"
            min={0}
            value={typeof params.outlineWeight === 'number' ? params.outlineWeight : ''}
            // As NumberInputOption: an emptied field is saved as ''
            onChange={(value) => setParams({ ...params, outlineWeight: (value === undefined ? '' : value) as number })}
          />
        </FormRow>
      </div>
    </section>
  );
}

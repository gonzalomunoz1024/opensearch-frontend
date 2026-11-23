/* SPDX-License-Identifier: Apache-2.0 */

/* How often a page refreshes: the "Refresh every" of the date picker's quick menu, as the original's. */

import { useId, useState } from 'react';
import { Button } from '../components/basic';
import { NumberField, Select } from '../components/form';
import type { RefreshInterval } from '../lib/types';
import { REFRESH_UNITS, refreshIntervalMs, refreshIntervalParts, type RefreshUnit } from './refresh_interval';

/**
 * "Refresh every": a change to the number or the unit applies at once and keeps the refresh
 * paused or running, as in the original; Start and Stop pause it or run it.
 */
export function RefreshEvery({
  refreshInterval,
  onRefreshChange,
}: {
  refreshInterval: RefreshInterval;
  onRefreshChange: (interval: RefreshInterval) => void;
}) {
  const [value, setValue] = useState<number | ''>(() => refreshIntervalParts(refreshInterval.value).value);
  const [units, setUnits] = useState<RefreshUnit>(() => refreshIntervalParts(refreshInterval.value).units);
  const legend = useId();
  const description = useId();
  const described = `${description} ${legend}`;

  const apply = (nextValue: number | '', nextUnits: RefreshUnit) => {
    setValue(nextValue);
    setUnits(nextUnits);
    if (nextValue === '') return;
    const ms = refreshIntervalMs(nextUnits, nextValue);
    onRefreshChange({ value: ms, pause: ms <= 0 ? true : refreshInterval.pause });
  };
  const start = () => {
    if (value !== '' && value > 0) onRefreshChange({ value: refreshIntervalMs(units, value), pause: false });
  };
  const onKeyDown = (event: { key: string }) => {
    if (event.key === 'Enter') start();
  };
  const unitLabel = REFRESH_UNITS.find((unit) => unit.value === units)?.label ?? '';

  return (
    <fieldset className="shlQuickMenu__fieldset">
      <legend id={legend} className="shlQuickMenu__title">
        Refresh every
      </legend>
      <div className="shlRefreshEvery">
        <div className="shlRefreshEvery__field">
          <NumberField
            compact
            value={value}
            onChange={(next) => apply(next ?? '', units)}
            onKeyDown={onKeyDown}
            aria-label="Refresh interval value"
            aria-describedby={described}
            testId="superDatePickerRefreshIntervalInput"
          />
        </div>
        <div className="shlRefreshEvery__field">
          <Select
            compact
            value={units}
            onChange={(next) => apply(value, next as RefreshUnit)}
            onKeyDown={onKeyDown}
            options={REFRESH_UNITS.map((unit) => ({ value: unit.value, label: unit.label }))}
            aria-label="Refresh interval units"
            aria-describedby={described}
            testId="superDatePickerRefreshIntervalUnitsSelect"
          />
        </div>
        <Button
          className="shlRefreshEvery__toggle"
          icon={refreshInterval.pause ? 'play' : 'stop'}
          disabled={value === '' || value <= 0}
          onClick={() => {
            if (value !== '') onRefreshChange({ value: refreshIntervalMs(units, value), pause: !refreshInterval.pause });
          }}
          aria-describedby={description}
          testId="superDatePickerToggleRefreshButton"
        >
          {refreshInterval.pause ? 'Start' : 'Stop'}
        </Button>
      </div>
      <p id={description} className="atlScreenReaderOnly">
        Currently set to {value} {unitLabel}.
      </p>
    </fieldset>
  );
}

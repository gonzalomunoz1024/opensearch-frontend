/* SPDX-License-Identifier: Apache-2.0 */

/*
 * How often a page refreshes, for a page whose range of dates means nothing: the date picker of
 * the original in its "auto refresh only" mode. Its button opens only "Refresh every", and beside
 * it the interval is written out ("Off", "10 seconds").
 */

import { useCallback, useState } from 'react';
import { Button } from '../components/basic';
import { NumberField, Select } from '../components/form';
import { Icon } from '../components/icon';
import { Popover } from '../components/overlay';
import type { RefreshInterval } from '../lib/types';
import { REFRESH_UNITS, prettyInterval, refreshIntervalMs, refreshIntervalParts, type RefreshUnit } from './refresh_interval';

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
    <fieldset className="shlRefreshEvery">
      <legend className="atlTitleXxs">Refresh every</legend>
      <div className="shlRefreshEvery__row">
        <NumberField
          value={value}
          onChange={(next) => apply(next ?? '', units)}
          onKeyDown={onKeyDown}
          aria-label="Refresh interval value"
          testId="superDatePickerRefreshIntervalInput"
        />
        <Select
          value={units}
          onChange={(next) => apply(value, next as RefreshUnit)}
          onKeyDown={onKeyDown}
          options={REFRESH_UNITS.map((unit) => ({ value: unit.value, label: unit.label }))}
          aria-label="Refresh interval units"
          testId="superDatePickerRefreshIntervalUnitsSelect"
        />
        <Button
          icon={refreshInterval.pause ? 'play' : 'stop'}
          disabled={value === '' || value <= 0}
          onClick={() => {
            if (value !== '') onRefreshChange({ value: refreshIntervalMs(units, value), pause: !refreshInterval.pause });
          }}
          testId="superDatePickerToggleRefreshButton"
        >
          {refreshInterval.pause ? 'Start' : 'Stop'}
        </Button>
      </div>
      <p className="atlScreenReaderOnly">
        Currently set to {value} {unitLabel}.
      </p>
    </fieldset>
  );
}

/** The date picker with no dates: how often the page refreshes, and the menu that sets it */
export function RefreshPicker({
  refreshInterval,
  onRefreshChange,
}: {
  refreshInterval: RefreshInterval;
  onRefreshChange: (interval: RefreshInterval) => void;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <div className="atlField shlTime">
      <Popover
        open={open}
        onClose={close}
        padded
        anchorStyle={{ height: '100%' }}
        button={
          <button
            type="button"
            className="shlTime__quick"
            aria-label="Date quick select"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            data-test-subj="superDatePickerToggleQuickMenuButton"
          >
            <Icon name="clock" />
            <Icon name="chevronDown" />
          </button>
        }
      >
        <div className="shlTimeMenu" data-test-subj="superDatePickerQuickMenu">
          <RefreshEvery refreshInterval={refreshInterval} onRefreshChange={onRefreshChange} />
        </div>
      </Popover>
      <span className="shlTime__interval">{prettyInterval(refreshInterval.pause, refreshInterval.value)}</span>
    </div>
  );
}

/* SPDX-License-Identifier: Apache-2.0 */

/* The interval of a Timeline visualization: one of a list, or a value of one's own such as 30s. */

import { useEffect } from 'react';
import { ComboBox, type ComboOption } from '../../components/combo_box';
import { FormRow } from '../../components/form';

export const INTERVAL_OPTIONS: ComboOption[] = [
  { label: 'Auto', value: 'auto' },
  { label: '1 second', value: '1s' },
  { label: '1 minute', value: '1m' },
  { label: '1 hour', value: '1h' },
  { label: '1 day', value: '1d' },
  { label: '1 week', value: '1w' },
  { label: '1 month', value: '1M' },
  { label: '1 year', value: '1y' },
];

// The units of date math, and whether more than one of them is allowed
const UNIT_TYPES: Record<string, 'fixed' | 'mixed' | 'calendar'> = {
  ms: 'fixed',
  s: 'fixed',
  m: 'mixed',
  h: 'mixed',
  d: 'mixed',
  w: 'calendar',
  M: 'calendar',
  y: 'calendar',
};
const INTERVAL_PATTERN = /^([1-9][0-9]*)\s*(y|M|w|d|h|m|s|ms)$/;

/** Upstream's `isValidOpenSearchInterval`: 30s, 24h or 1w, but not 2w, 1.5h or 2f */
export function isValidOpenSearchInterval(interval: string): boolean {
  const matches = String(interval).trim().match(INTERVAL_PATTERN);
  if (!matches) return false;
  return !(UNIT_TYPES[matches[2]] === 'calendar' && Number.parseFloat(matches[1]) !== 1);
}

export const isValidTimelineInterval = (value: string) =>
  INTERVAL_OPTIONS.some((option) => option.value === value) || isValidOpenSearchInterval(value);

export interface IntervalInputProps {
  value: string;
  setValue: (value: string) => void;
  setValidity?: (valid: boolean) => void;
}

export function IntervalInput({ value, setValue, setValidity }: IntervalInputProps) {
  const isValid = isValidTimelineInterval(value);

  useEffect(() => {
    setValidity?.(isValid);
  }, [isValid, setValidity]);
  // The editor is valid again once this field is gone
  useEffect(() => () => setValidity?.(true), [setValidity]);

  return (
    <FormRow
      full
      label="Interval"
      help="Select an option or create a custom value. Examples: 30s, 20m, 24h, 2d, 1w, 1M"
      error={isValid ? undefined : 'Invalid interval format.'}
    >
      <ComboBox
        compact
        fullWidth
        single
        allowCustom
        invalid={!isValid}
        options={INTERVAL_OPTIONS}
        selected={value === '' ? [] : [value]}
        onChange={(selected) => setValue((selected[0] ?? '').trim())}
        placeholder="Select an interval"
      />
    </FormRow>
  );
}

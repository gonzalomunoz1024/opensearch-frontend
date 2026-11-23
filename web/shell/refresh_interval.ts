/* SPDX-License-Identifier: Apache-2.0 */

/* How often a page refreshes, written and read as the original's date picker does. */

const MS_IN_SECOND = 1000;
const MS_IN_MINUTE = 60 * MS_IN_SECOND;
const MS_IN_HOUR = 60 * MS_IN_MINUTE;
const MS_IN_DAY = 24 * MS_IN_HOUR;

/** An interval as the original writes it beside its button: "Off", "1 second", "10 minutes" */
export function prettyInterval(paused: boolean, ms: number): string {
  if (paused || ms === 0) return 'Off';
  const say = (count: number, unit: string) => `${count} ${unit}${count > 1 ? 's' : ''}`;
  if (ms < MS_IN_MINUTE) return say(Math.round(ms / MS_IN_SECOND), 'second');
  if (ms < MS_IN_HOUR) return say(Math.round(ms / MS_IN_MINUTE), 'minute');
  if (ms < MS_IN_DAY) return say(Math.round(ms / MS_IN_HOUR), 'hour');
  return say(Math.round(ms / MS_IN_DAY), 'day');
}

export type RefreshUnit = 's' | 'm' | 'h';

export const REFRESH_UNITS: Array<{ value: RefreshUnit; label: string; ms: number }> = [
  { value: 's', label: 'seconds', ms: MS_IN_SECOND },
  { value: 'm', label: 'minutes', ms: MS_IN_MINUTE },
  { value: 'h', label: 'hours', ms: MS_IN_HOUR },
];

const round = (value: number) => parseFloat(value.toFixed(2));

/** The number and the unit the fields show for an interval: as in the original, a whole minute is still in seconds */
export function refreshIntervalParts(ms: number): { value: number; units: RefreshUnit } {
  if (ms > MS_IN_HOUR) return { value: round(ms / MS_IN_HOUR), units: 'h' };
  if (ms > MS_IN_MINUTE) return { value: round(ms / MS_IN_MINUTE), units: 'm' };
  return { value: round(ms / MS_IN_SECOND), units: 's' };
}

export function refreshIntervalMs(units: RefreshUnit, value: number): number {
  return Math.round(value * (REFRESH_UNITS.find((unit) => unit.value === units)?.ms ?? MS_IN_SECOND));
}

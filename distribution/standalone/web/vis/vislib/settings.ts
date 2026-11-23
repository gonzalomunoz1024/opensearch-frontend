/* SPDX-License-Identifier: Apache-2.0 */

/*
 * What the classic charts read of the page's settings: the time zone the dates are shown in, as
 * minutes east of UTC at a moment, and how much the series not pointed at are dimmed.
 */

import { formatDate } from '../../lib/dates';
import type { ZoneOffset } from './scales';

/** Minutes east of UTC that the zone dates are shown in is at a moment */
export function zoneOffset(timeZone: string | undefined): ZoneOffset {
  if (!timeZone) return (time) => -new Date(time).getTimezoneOffset();
  if (timeZone === 'UTC') return () => 0;
  return (time) => {
    const text = formatDate(new Date(time), 'ZZ', timeZone);
    const match = /^([+-])(\d\d)(\d\d)$/.exec(text);
    if (!match) return 0;
    const minutes = Number(match[2]) * 60 + Number(match[3]);
    return match[1] === '-' ? -minutes : minutes;
  };
}

/** The setting visualization:dimmingOpacity, as vislib reads it: a share, else a half */
export function dimmingOpacity(value: unknown): number {
  const number = parseFloat(String(value));
  return number >= 0 && number <= 1 ? number : 0.5;
}

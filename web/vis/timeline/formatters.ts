/* SPDX-License-Identifier: Apache-2.0 */

/* The tick formats of Timeline's y axis units, and how a series' chart-wide options are merged. */

import type { Axis } from './plot';

// --- The y axis' units ------------------------------------------------------------------------------

function unitFormatter(divisor: number, units: string[]) {
  return (input: number) => {
    let val = input;
    let index = 0;
    const isNegative = val < 0;
    val = Math.abs(val);
    while (val >= divisor && index < units.length) {
      val /= divisor;
      index++;
    }
    const value = (Math.round(val * 100) / 100) * (isNegative ? -1 : 1);
    return `${value}${units[index]}`;
  };
}

function baseTickFormatter(value: number, axis: Axis) {
  const factor = axis.tickDecimals ? Math.pow(10, axis.tickDecimals) : 1;
  const formatted = `${Math.round(value * factor) / factor}`;
  if (axis.tickDecimals != null) {
    const decimal = formatted.indexOf('.');
    const precision = decimal === -1 ? 0 : formatted.length - decimal - 1;
    if (precision < axis.tickDecimals) {
      return (precision ? formatted : `${formatted}.`) + `${factor}`.substr(1, axis.tickDecimals - precision);
    }
  }
  return formatted;
}

type UnitsAxis = Axis & { options: { units?: { prefix?: string; suffix?: string; tickDecimalsShift?: number } } };

export const TICK_FORMATTERS: Record<string, (value: number, axis: UnitsAxis) => string> = {
  bits: unitFormatter(1000, ['b', 'kb', 'mb', 'gb', 'tb', 'pb']),
  'bits/s': unitFormatter(1000, ['b/s', 'kb/s', 'mb/s', 'gb/s', 'tb/s', 'pb/s']),
  bytes: unitFormatter(1024, ['B', 'KB', 'MB', 'GB', 'TB', 'PB']),
  'bytes/s': unitFormatter(1024, ['B/s', 'KB/s', 'MB/s', 'GB/s', 'TB/s', 'PB/s']),
  currency(val, axis) {
    return val.toLocaleString('en', { style: 'currency', currency: axis?.options?.units?.prefix || 'USD' });
  },
  percent(val, axis) {
    let precision = (axis?.tickDecimals ?? 0) - (axis?.options?.units?.tickDecimalsShift ?? 0);
    if (precision < 0) precision = 0;
    else if (precision > 20) precision = 20;
    return `${(val * 100).toFixed(precision)}%`;
  },
  custom(val, axis) {
    const formatted = baseTickFormatter(val, axis);
    return `${axis?.options?.units?.prefix}${formatted}${axis?.options?.units?.suffix}`;
  },
};


type Loose = Record<string, unknown>;
const isPlain = (value: unknown): value is Loose =>
  value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;

/** lodash's `mergeWith` with the original's rule: null never replaces a value, nor is replaced by one */
export function mergeGlobal(target: Loose | unknown[], source: Loose | unknown[]): void {
  for (const key of Object.keys(source)) {
    const objVal = (target as Loose)[key];
    const srcVal = (source as Loose)[key];
    if (objVal == null) {
      (target as Loose)[key] = srcVal;
    } else if (srcVal == null) {
      continue;
    } else if ((isPlain(objVal) || Array.isArray(objVal)) && (isPlain(srcVal) || Array.isArray(srcVal))) {
      mergeGlobal(objVal, srcVal);
    } else {
      (target as Loose)[key] = srcVal;
    }
  }
}


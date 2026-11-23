/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The colours of a classic chart's series, as vislib looks them up: a colour picked in the legend
 * first, then the one the setting visualization:colorMapping gives the label, which the original
 * standardizes to lower-case hex (so that the legend's picker rings it), then the palette's.
 */

import { assignColors } from '../../charts/core';

const HEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB = /^rgba?\(\s*(\d+(?:\.\d+)?)\s*[\s,]\s*(\d+(?:\.\d+)?)\s*[\s,]\s*(\d+(?:\.\d+)?)\s*[,/)\s]/i;

const twoDigits = (value: number) =>
  Math.round(Math.min(255, Math.max(0, value)))
    .toString(16)
    .padStart(2, '0');

let canvas: CanvasRenderingContext2D | null | undefined;

// Any colour CSS reads, as the browser writes it back; undefined when it is no colour
function cssColor(color: string): string | undefined {
  if (typeof document === 'undefined') return undefined;
  if (canvas === undefined) canvas = document.createElement('canvas').getContext('2d');
  if (!canvas) return undefined;
  canvas.fillStyle = '#000000';
  canvas.fillStyle = color;
  const onBlack = String(canvas.fillStyle);
  canvas.fillStyle = '#ffffff';
  canvas.fillStyle = color;
  return onBlack === String(canvas.fillStyle) ? onBlack : undefined;
}

/** A colour as `#rrggbb` in lower case, its opacity left out, as the original standardizes it */
export function standardizeColor(color: string, resolve: (color: string) => string | undefined = cssColor): string {
  const text = color.trim();
  const hex = HEX.exec(text);
  if (hex) {
    const digits = hex[1].length <= 4 ? [...hex[1].slice(0, 3)].map((digit) => digit + digit).join('') : hex[1].slice(0, 6);
    return `#${digits.toLowerCase()}`;
  }
  const rgb = RGB.exec(text);
  if (rgb) return `#${[rgb[1], rgb[2], rgb[3]].map((value) => twoDigits(Number(value))).join('')}`;
  const resolved = resolve(text);
  return resolved !== undefined && resolved !== text ? standardizeColor(resolved, () => undefined) : text;
}

/**
 * The colour of each label: the one picked for it in the visualization, else the one the setting
 * gives it (standardized), else the palette's, kept for the label on every chart of the page
 */
export function seriesColors(
  labels: string[],
  picked: Record<string, string> | undefined,
  mapping: Record<string, string> | undefined
): Map<string, string> {
  const colors = assignColors(labels, picked);
  for (const label of new Set(labels)) {
    const configured = mapping?.[label];
    if (configured && !picked?.[label]) colors.set(label, standardizeColor(configured));
  }
  return colors;
}

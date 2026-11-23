/* SPDX-License-Identifier: Apache-2.0 */

/*
 * How TSVB lays the text of a metric or a gauge, and the arc of a gauge, over its panel: each is
 * drawn at the product's own size, then scaled about its middle to the largest size that fits
 * and moved to the middle, as the product's calculateCoordinates places them.
 */

import { parseColor } from '../../charts/core';

export interface BoxSize {
  width: number;
  height: number;
}

/** A box scaled about its middle and moved over its panel */
export interface Placement {
  scale: number;
  top: number;
  left: number;
  translateX: number;
  translateY: number;
}

/**
 * Where the product places a box over a panel, both measured in whole pixels: scaled to the
 * panel's height, or its width when it is taller than wide, and down to the other when that does
 * not fit; then in the middle, rounded down. A box or a panel with no size is not placed.
 */
export function placeBox(panel: BoxSize, box: BoxSize): Placement | null {
  if (panel.width <= 0 || panel.height <= 0 || box.width <= 0 || box.height <= 0) return null;
  const dimensions = (scale: number): [number, number] => [Math.floor(box.width * scale), Math.floor(box.height * scale)];
  let scale = panel.width - panel.height < 0 ? panel.width / box.width : panel.height / box.height;
  const [width, height] = dimensions(scale);
  if (width > panel.width) scale = panel.width / box.width;
  if (height > panel.height) scale = panel.height / box.height;
  const [newWidth, newHeight] = dimensions(scale);
  return {
    scale,
    translateX: (newWidth - box.width) / 2,
    translateY: (newHeight - box.height) / 2,
    top: Math.floor((panel.height - newHeight) / 2),
    left: Math.floor((panel.width - newWidth) / 2),
  };
}

/** The style that puts an absolutely positioned box where it is placed */
export function placedStyle(placement: Placement): { top: number; left: number; transform: string } {
  const { scale, translateX, translateY, top, left } = placement;
  return { top, left, transform: `matrix(${scale}, 0, 0, ${scale}, ${translateX}, ${translateY})` };
}

/** The relative luminance of a colour, as the product's colour library works it out */
export function luminance(color: string): number {
  const [red, green, blue] = parseColor(color).map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** Whether a colour is dark as the product tells it: a relative luminance under 0.45 */
export function isColorDark(color: string): boolean {
  return luminance(color) < 0.45;
}

/** Whether a text names a colour the product can read: a hex colour, or an rgb() or rgba() one */
export const isColor = (text: string | undefined): text is string => /^\s*(#[0-9a-f]{3}([0-9a-f]{3})?|rgba?\([^)]*\))\s*$/i.test(text ?? '');

/** The contrast between two colours, from 1 to 21 */
function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/** The gray that has just the contrast asked for with a background, on the side of a colour */
function contrastGray(background: string, color: string, ratio: number): string {
  const back = luminance(background);
  const target = back > luminance(color) ? (back + 0.05 - ratio * 0.05) / ratio : Math.min(ratio * (back + 0.05) - 0.05, 1);
  const gray = target <= 0.0031308 ? target * 12.92 : 1.055 * target ** (1 / 2.4) - 0.055;
  const level = Math.round(gray * 255);
  return `rgb(${level},${level},${level})`;
}

// The product's axis colours over a light and over a dark background
const AXIS_ON_LIGHT = '#333';
const AXIS_ON_DARK = '#D4D4D4';

/**
 * The colour of the labels, titles and lines of a TSVB chart's axes over a background of its
 * own, as the product chooses it: its dark or its light gray, whichever stands out more when it
 * stands out enough (a contrast of 4.5), else the gray on that side that just does
 */
export function axisColor(background: string): string {
  const onLight = contrast(background, AXIS_ON_LIGHT);
  const onDark = contrast(background, AXIS_ON_DARK);
  if (onLight >= onDark) return onLight >= 4.5 ? AXIS_ON_LIGHT : contrastGray(background, AXIS_ON_LIGHT, 4.5);
  return onDark >= 4.5 ? AXIS_ON_DARK : contrastGray(background, AXIS_ON_DARK, 4.5);
}

/** The colour of the names in a TSVB chart's legend over a background of its own: light over a dark one */
export const legendColor = (background: string): string => (luminance(background) <= 0.179 ? '#dfe5ef' : '#343741');

/**
 * Whether the text over a panel takes the colours of the other theme: when the panel has a
 * background colour of its own that is dark in the light theme, or light in the dark one
 */
export function isInverted(background: string | undefined, darkTheme: boolean): boolean {
  if (!background || background === 'inherit') return false;
  return isColorDark(background) !== darkTheme;
}

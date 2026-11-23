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

/** Whether a colour is dark as the product tells it: a relative luminance under 0.45 */
export function isColorDark(color: string): boolean {
  const [red, green, blue] = parseColor(color).map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue < 0.45;
}

/**
 * Whether the text over a panel takes the colours of the other theme: when the panel has a
 * background colour of its own that is dark in the light theme, or light in the dark one
 */
export function isInverted(background: string | undefined, darkTheme: boolean): boolean {
  if (!background || background === 'inherit') return false;
  return isColorDark(background) !== darkTheme;
}

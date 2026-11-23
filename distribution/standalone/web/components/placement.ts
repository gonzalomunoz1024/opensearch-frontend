/* SPDX-License-Identifier: Apache-2.0 */

/* Where a popover goes beside the button that opened it, as the original's popovers choose. */

export type PopoverPosition = 'downLeft' | 'downRight' | 'upLeft' | 'upRight';

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Where the original's popover goes: 8px from its button, 16px at least inside the window, and
 * pointing at the middle of the button (its arrow, 12px each side of that middle, keeps 10px
 * from the popover's corners). It tries the side it is given, then the opposite side, then the
 * left and the right of the button, centred on it; the first where it fits is taken.
 */
export function placeLikeOriginal(
  anchor: Box,
  panel: { width: number; height: number },
  position: PopoverPosition,
  view: { width: number; height: number }
): { left: number; top: number } {
  const buffer = 16;
  const offset = 8;
  const arrow = 22;
  const down = position.startsWith('down');
  const align = position.endsWith('Left') ? 'left' : 'right';
  const centerX = anchor.left + anchor.width / 2;
  const centerY = anchor.top + anchor.height / 2;
  const sides = down ? ['down', 'up', 'left', 'right'] : ['up', 'down', 'left', 'right'];
  for (const side of sides) {
    if (side === 'down' || side === 'up') {
      const top = side === 'down' ? anchor.top + anchor.height + offset : anchor.top - offset - panel.height;
      if (top < buffer || top + panel.height > view.height - buffer) continue;
      let left = align === 'left' ? anchor.left : anchor.left + anchor.width - panel.width;
      left = Math.max(Math.min(left, centerX - arrow), centerX + arrow - panel.width);
      left = Math.max(buffer, Math.min(left, view.width - buffer - panel.width));
      if (centerX - arrow < left - 0.5 || centerX + arrow > left + panel.width + 0.5) continue;
      return { left, top };
    }
    const left = side === 'left' ? anchor.left - offset - panel.width : anchor.left + anchor.width + offset;
    if (left < buffer || left + panel.width > view.width - buffer) continue;
    let top = centerY - panel.height / 2;
    top = Math.max(buffer, Math.min(top, view.height - buffer - panel.height));
    return { left, top };
  }
  // Nowhere it fits whole: under the button, as far inside the window as it goes
  return {
    left: Math.max(buffer, Math.min(anchor.left + anchor.width - panel.width, view.width - buffer - panel.width)),
    top: Math.max(buffer, anchor.top + anchor.height + offset),
  };
}

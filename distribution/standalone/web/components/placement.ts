/* SPDX-License-Identifier: Apache-2.0 */

/* Where a popover goes beside the button that opened it, as the original's popovers choose. */

import type { PopoverSide } from './popover_place';

export type PopoverPosition = 'downLeft' | 'downCenter' | 'downRight' | 'upLeft' | 'upRight';

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface Size {
  width: number;
  height: number;
}

const OPPOSITE: Record<PopoverSide, PopoverSide> = { top: 'bottom', right: 'left', bottom: 'top', left: 'right' };
// The first side of the other axis: left for a popover over or under its button, top beside it
const ACROSS: Record<PopoverSide, PopoverSide> = { top: 'left', right: 'top', bottom: 'left', left: 'top' };

const BUFFER = 16;
const OFFSET = 8;
const ARROW_WIDTH = 24;
const ARROW_BUFFER = 10;

/**
 * Where the original's popover goes (OUI's findPopoverPosition): 8px from its button on the side it
 * is given, along the button's edge it names or centred on the button. It moves along the button
 * only as far as the window's other side asks (16px inside it) and as far as its arrow, 12px each
 * side of the button's middle, keeps 10px from its corners, so an edge it is aligned with can stay
 * within those 16px. Unless all of it is inside them, it tries the opposite side, then the left and
 * the right of the button, centred on it, and takes the first that shows the most of it.
 */
export function placeLikeOriginal(
  anchor: Box,
  panel: Size,
  position: PopoverPosition,
  view: Size
): { left: number; top: number; side: PopoverSide } {
  const side: PopoverSide = position.startsWith('down') ? 'bottom' : 'top';
  const align: PopoverSide | undefined = position.endsWith('Left')
    ? 'left'
    : position.endsWith('Right')
      ? 'right'
      : undefined;
  // The alignment is kept on the opposite side, not beside the button
  const tries: Array<[PopoverSide, PopoverSide | undefined]> = [
    [side, align],
    [OPPOSITE[side], align],
    [ACROSS[side], undefined],
    [OPPOSITE[ACROSS[side]], undefined],
  ];
  let best: { left: number; top: number; side: PopoverSide; fit: number } | undefined;
  for (const [trySide, tryAlign] of tries) {
    const at = placeOn(trySide, tryAlign, anchor, panel, view);
    if (best === undefined || at.fit > best.fit) {
      best = { ...at, side: trySide };
      if (at.fit === 1) break;
    }
  }
  const { left, top, side: found } = best ?? { left: anchor.left, top: anchor.top + anchor.height + OFFSET, side };
  return { left, top, side: found };
}

function placeOn(side: PopoverSide, align: PopoverSide | undefined, anchor: Box, panel: Size, view: Size) {
  // The room between the button and the window, less the 16px, and the 8px on its own side
  const room: Record<PopoverSide, number> = {
    top: anchor.top - BUFFER - (side === 'top' ? OFFSET : 0),
    right: view.width - (anchor.left + anchor.width) - BUFFER - (side === 'right' ? OFFSET : 0),
    bottom: view.height - (anchor.top + anchor.height) - BUFFER - (side === 'bottom' ? OFFSET : 0),
    left: anchor.left - BUFFER - (side === 'left' ? OFFSET : 0),
  };
  const overOrUnder = side === 'top' || side === 'bottom';
  const first = ACROSS[side];
  const panelAcross = overOrUnder ? panel.width : panel.height;
  const anchorAcross = overOrUnder ? anchor.width : anchor.height;
  const anchorStart = overOrUnder ? anchor.left : anchor.top;
  const overflow = (panelAcross - anchorAcross) / 2;
  let across = anchorStart + anchorAcross / 2 - panelAcross / 2;
  if (align !== undefined) {
    // Its edge on the button's, moved back only when the window's other side asks
    const direction = align === 'top' || align === 'left' ? 1 : -1;
    const farRoom = room[OPPOSITE[align]];
    const shift = 2 * overflow > farRoom ? 2 * overflow - farRoom : 0;
    across += -direction * shift + direction * overflow;
  } else {
    // Centred, moved toward the side with more room when the other has too little
    const toFirst = room[first] > room[OPPOSITE[first]];
    const least = Math.min(room[first], room[OPPOSITE[first]]);
    const shift = overflow > least ? overflow - least : 0;
    across += (toFirst ? -1 : 1) * shift;
  }
  const arrow = anchorStart + anchorAcross / 2 - ARROW_WIDTH / 2;
  if (arrow < across + ARROW_BUFFER) across = arrow - ARROW_BUFFER;
  else if (arrow + ARROW_BUFFER + ARROW_WIDTH > across + panelAcross) {
    across = arrow + ARROW_BUFFER + ARROW_WIDTH - panelAcross;
  }
  const panelAlong = overOrUnder ? panel.height : panel.width;
  const anchorAlong = overOrUnder ? anchor.height : anchor.width;
  const anchorEdge = overOrUnder ? anchor.top : anchor.left;
  const along = side === 'top' || side === 'left' ? anchorEdge - OFFSET - panelAlong : anchorEdge + anchorAlong + OFFSET;
  const left = overOrUnder ? across : along;
  const top = overOrUnder ? along : across;
  return { left, top, fit: visibleFit({ left, top, width: panel.width, height: panel.height }, view) };
}

/**
 * How much of the popover is inside the window less its 16px, as the original reckons it: nothing
 * when the two are apart from left to right, and below nothing when they are apart from top to
 * bottom (its sum does not stop at nothing there), which is kept, as it ranks the sides tried
 */
function visibleFit(box: Box, view: Size): number {
  const left = Math.max(box.left, BUFFER);
  const right = Math.min(box.left + box.width, view.width - BUFFER);
  const top = Math.max(box.top, BUFFER);
  const bottom = Math.min(box.top + box.height, view.height - BUFFER);
  if (left > right) return 0;
  return ((right - left) * (bottom - top)) / (box.width * box.height);
}

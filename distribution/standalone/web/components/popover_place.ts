/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Where the component library puts a popover that hangs from a button and has an arrow, as its
 * `findPopoverPosition` does with the settings EuiPopover gives it: the side asked for first, then
 * the other side of the button, then its left and its right, until the panel shows whole 16 px
 * inside the window, or on the side that shows the most of it; 16 px from the button, along it
 * as asked, and moved so the arrow (24 px) keeps 10 px from the panel's corners. The open panel is
 * drawn 8 px nearer to the button than that.
 */

export type PopoverSide = 'top' | 'right' | 'bottom' | 'left';

export interface PlaceBox {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface PopoverPlace {
  side: PopoverSide;
  top: number;
  left: number;
}

const COMPLEMENTS: Record<PopoverSide, PopoverSide> = { top: 'bottom', right: 'left', bottom: 'top', left: 'right' };
// The first side of the cross axis: a panel above or below a button lines up along its left
const SUBSTITUTES: Record<PopoverSide, PopoverSide> = { top: 'left', right: 'top', bottom: 'left', left: 'top' };

/** How far from its button EuiPopover hangs a panel with an arrow, before it is drawn nearer */
const OFFSET = 16;
const ARROW_WIDTH = 24;
const ARROW_BUFFER = 10;
/** How much nearer to the button the open panel is drawn: EuiPopover's open transform */
const NEARER = 8;

interface Edges {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const edgesOf = (box: PlaceBox): Edges => ({ top: box.top, right: box.left + box.width, bottom: box.top + box.height, left: box.left });

/** How much of the panel's area lies inside the room: negative when it is wholly above or below, as the library counts */
function visibleFit(panel: Edges, room: Edges): number {
  const top = Math.max(panel.top, room.top);
  const right = Math.min(panel.right, room.right);
  const bottom = Math.min(panel.bottom, room.bottom);
  const left = Math.max(panel.left, room.left);
  if (left > right) return 0;
  return ((right - left) * (bottom - top)) / ((panel.right - panel.left) * (panel.bottom - panel.top));
}

function coordinates(
  side: PopoverSide,
  align: PopoverSide | undefined,
  anchor: PlaceBox,
  panel: { width: number; height: number },
  view: { width: number; height: number },
  buffer: number
): { top: number; left: number; fit: number } {
  const vertical = side === 'top' || side === 'bottom';
  const firstSide = SUBSTITUTES[side];
  const secondSide = COMPLEMENTS[firstSide];
  const anchorEdges = edgesOf(anchor);
  const panelCross = vertical ? panel.width : panel.height;
  const anchorCross = vertical ? anchor.width : anchor.height;
  const anchorStart = vertical ? anchor.left : anchor.top;
  const original = anchorStart + anchorCross / 2 - panelCross / 2;
  const available: Record<PopoverSide, number> = {
    top: anchorEdges.top - buffer - (side === 'top' ? OFFSET : 0),
    right: view.width - anchorEdges.right - buffer - (side === 'right' ? OFFSET : 0),
    bottom: view.height - anchorEdges.bottom - buffer - (side === 'bottom' ? OFFSET : 0),
    left: anchorEdges.left - buffer - (side === 'left' ? OFFSET : 0),
  };
  const overflow = (panelCross - anchorCross) / 2;
  let alignAmount = 0;
  let alignDirection = 1;
  let shiftNeeded = 0;
  let shiftDirection = 1;
  if (align !== undefined) {
    alignDirection = align === 'top' || align === 'left' ? 1 : -1;
    alignAmount = overflow;
    const alignedOverflow = overflow + alignAmount;
    const room = available[COMPLEMENTS[align]];
    shiftNeeded = alignedOverflow > room ? alignedOverflow - room : 0;
    shiftDirection = -alignDirection;
  } else {
    const first = available[firstSide];
    const second = available[secondSide];
    shiftDirection = first > second ? -1 : 1;
    const least = Math.min(first, second);
    shiftNeeded = overflow > least ? overflow - least : 0;
  }
  let cross = original + shiftNeeded * shiftDirection + alignAmount * alignDirection;
  const arrow = anchorStart + anchorCross / 2 - ARROW_WIDTH / 2;
  if (arrow < cross + ARROW_BUFFER) cross = arrow - ARROW_BUFFER;
  else if (arrow + ARROW_BUFFER + ARROW_WIDTH > cross + panelCross) cross = arrow + ARROW_BUFFER + ARROW_WIDTH - panelCross;

  const decreasing = side === 'top' || side === 'left';
  const panelPrimary = vertical ? panel.height : panel.width;
  const anchorPrimary = vertical ? anchor.height : anchor.width;
  const primary = (vertical ? anchor.top : anchor.left) + (OFFSET + (decreasing ? panelPrimary : anchorPrimary)) * (decreasing ? -1 : 1);

  const top = vertical ? primary : cross;
  const left = vertical ? cross : primary;
  const room = { top: buffer, right: view.width - buffer, bottom: view.height - buffer, left: buffer };
  return { top, left, fit: visibleFit(edgesOf({ top, left, width: panel.width, height: panel.height }), room) };
}

/**
 * Where an open panel of a size goes from its button, in the window's coordinates: `side` is the
 * side asked for, `align` the edge of the button it lines up with (none to centre it), `buffer`
 * the room it keeps from the window's edges.
 */
export function arrowPopoverPlace(
  anchor: PlaceBox,
  panel: { width: number; height: number },
  view: { width: number; height: number },
  side: PopoverSide = 'bottom',
  align?: PopoverSide,
  buffer = 16
): PopoverPlace {
  const tries: Array<[PopoverSide, PopoverSide | undefined]> = [
    [side, align],
    [COMPLEMENTS[side], align],
    [SUBSTITUTES[side], undefined],
    [COMPLEMENTS[SUBSTITUTES[side]], undefined],
  ];
  let best: (PopoverPlace & { fit: number }) | undefined;
  for (const [trySide, tryAlign] of tries) {
    const at = coordinates(trySide, tryAlign, anchor, panel, view, buffer);
    if (best === undefined || at.fit > best.fit) best = { side: trySide, ...at };
    if (best.fit === 1) break;
  }
  const found = best ?? { side, top: 0, left: 0, fit: 0 };
  const towardX = found.side === 'left' ? NEARER : found.side === 'right' ? -NEARER : 0;
  const towardY = found.side === 'top' ? NEARER : found.side === 'bottom' ? -NEARER : 0;
  return { side: found.side, top: found.top + towardY, left: found.left + towardX };
}

/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The arithmetic of the header and the navigation, as OUI and OpenSearch Dashboards 3.9.0 do it:
 * the breakpoints of the window, which crumbs of a trail are shown, where a popover hangs, what
 * the browser keeps of the navigation, and where the links of the navigation lead.
 */

import { buildHash, parseHash } from '../lib/url';

// --- Breakpoints ---------------------------------------------------------------------------------

export type Breakpoint = 'xxxl' | 'xxl' | 'xl' | 'l' | 'm' | 's' | 'xs';

/** OUI's breakpoints: the narrowest window of each, the widest first */
export const BREAKPOINTS: ReadonlyArray<readonly [Breakpoint, number]> = [
  ['xxxl', 1920],
  ['xxl', 1680],
  ['xl', 1200],
  ['l', 992],
  ['m', 768],
  ['s', 575],
  ['xs', 0],
];

function minWidthOf(breakpoint: Breakpoint): number {
  return BREAKPOINTS.find(([name]) => name === breakpoint)?.[1] ?? 0;
}

/** The breakpoint of a window `width` wide, among the named ones (OUI's getBreakpoint) */
export function breakpointOf(width: number, among?: readonly Breakpoint[]): Breakpoint | undefined {
  return BREAKPOINTS.find(([name, min]) => (among ? among.includes(name) : true) && min <= width)?.[0];
}

/** Whether a window `width` wide is at the breakpoint or wider (OUI's isWithinMinBreakpoint) */
export function isAtLeast(width: number, breakpoint: Breakpoint): boolean {
  const own = breakpointOf(width);
  return own !== undefined && minWidthOf(own) >= minWidthOf(breakpoint);
}

/**
 * The navigation docks, and offers to, from the `l` breakpoint up: EuiCollapsibleNav's
 * dockedBreakpoint, and the sizes the original shows its dock button for
 */
export function canDock(width: number): boolean {
  return isAtLeast(width, 'l');
}

/** How the navigation is shown: not at all, over the page behind a mask, or beside the page */
export type NavMode = 'hidden' | 'overlay' | 'docked';

/**
 * How the original shows its navigation (EuiCollapsibleNav with the legacy header's state): docked
 * for as long as it is locked and the window is wide enough to dock, whatever the menu button
 * says; else over the page while the menu button has it open. Unlocking a navigation the button
 * had opened leaves it open over the page; one the button had not opened goes away.
 */
export function navMode(state: {
  /** It is set to dock: what the original keeps under its key */
  locked: boolean;
  /** The menu button has it open */
  open: boolean;
  /** The window is wide enough to dock in (see `canDock`) */
  canDock: boolean;
}): NavMode {
  if (state.locked && state.canDock) return 'docked';
  return state.open ? 'overlay' : 'hidden';
}

/** A click the browser handles itself (a new tab, a download), or one already handled */
export function isModifiedClick(event: {
  metaKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  defaultPrevented: boolean;
}): boolean {
  return event.metaKey || event.altKey || event.ctrlKey || event.shiftKey || event.defaultPrevented;
}

/** Whether a path of this product is under an application's path: the application or a page of it */
export function isUnderPath(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(base + '/');
}

// --- Breadcrumbs ---------------------------------------------------------------------------------

/** How many crumbs EuiBreadcrumbs shows at each breakpoint, its `responsive` default */
export const BREADCRUMB_LIMITS: Readonly<Record<Breakpoint, number>> = {
  xs: 1,
  s: 2,
  m: 4,
  l: 5,
  xl: 6,
  xxl: 9,
  xxxl: 11,
};

/** The header's own limit: HeaderBreadcrumbs hands EuiHeaderBreadcrumbs `max={10}` */
export const HEADER_BREADCRUMB_MAX = 10;

/** How many crumbs a header `width` wide shows */
export function breadcrumbLimit(width: number, max = HEADER_BREADCRUMB_MAX): number {
  const responsive = BREADCRUMB_LIMITS[breakpointOf(width) ?? 'xs'];
  return max > 0 ? Math.min(max, responsive) : responsive;
}

export type CrumbSlot =
  | { kind: 'crumb'; index: number }
  /** The "…" that opens the crumbs left out, by their places in the trail */
  | { kind: 'collapsed'; indexes: number[] };

/**
 * The crumbs of a trail of `count` that are drawn when `limit` fit, as EuiBreadcrumbs picks them:
 * from the two ends inwards, the last first, and the "…" where the middle ones were
 */
export function arrangeBreadcrumbs(count: number, limit: number): CrumbSlot[] {
  if (limit <= 0 || limit >= count) {
    return Array.from({ length: count }, (_, index) => ({ kind: 'crumb' as const, index }));
  }
  const shown = Math.min(limit, count);
  const half = Math.floor(shown / 2);
  const start: CrumbSlot[] = [];
  const end: CrumbSlot[] = [];
  for (let step = 0; step < shown; step++) {
    const offset = Math.floor(step / 2);
    if (step % 2 === 0) end.unshift({ kind: 'crumb', index: count - 1 - offset });
    else start.push({ kind: 'crumb', index: offset });
  }
  const hidden = Array.from({ length: count - shown }, (_, at) => half + at);
  return [...start, { kind: 'collapsed', indexes: hidden }, ...end];
}

/**
 * What the header shows while a page has set no trail. The original falls back on the title of
 * the application, and nothing ever changes that title from the one it starts with.
 */
export const APP_TITLE_FALLBACK = 'Overview';

/**
 * The test subject the original gives each crumb: `breadcrumb`, then `first` and `last`, by its
 * place in the trail that is shown. A crumb keeps its subject when it is folded into the "…".
 */
export function breadcrumbTestSubject(index: number, trailLength: number): string {
  return ['breadcrumb', index === 0 && 'first', index === trailLength - 1 && 'last']
    .filter(Boolean)
    .join(' ');
}

// --- Popovers ------------------------------------------------------------------------------------

export type PopoverPosition = 'top' | 'right' | 'bottom' | 'left';

export interface Box {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
}

export interface PopoverRequest {
  /** Where the button is, in the window */
  anchor: Box;
  /** How big the panel is */
  popover: { width: number; height: number };
  /** The side asked for */
  position: PopoverPosition;
  /** Which edge of the button the panel lines up with; centred when left out */
  align?: PopoverPosition;
  /** Only the side asked for */
  forcePosition?: boolean;
  /** How far the panel keeps from the window's edges */
  buffer?: number;
  /** How far it hangs from the button */
  offset?: number;
  allowCrossAxis?: boolean;
  /** The window's size, without its scroll bars */
  viewport: { width: number; height: number };
  /** The room of the arrow EuiPopover hands over, which keeps the panel over its button */
  arrow?: { width: number; buffer: number };
}

export interface PopoverPlacement {
  /** The share of the panel inside the window */
  fit: number;
  position: PopoverPosition;
  top: number;
  left: number;
}

const DIMENSION = { top: 'height', right: 'width', bottom: 'height', left: 'width' } as const;
const POSITION_ATTRIBUTE = { height: 'top', width: 'left' } as const;
const COMPLEMENT = { top: 'bottom', right: 'left', bottom: 'top', left: 'right' } as const;
const SUBSTITUTE = { top: 'left', right: 'top', bottom: 'left', left: 'top' } as const;

function intersect(a: Box, b: Box): Box {
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.right, b.right);
  const bottom = Math.min(a.bottom, b.bottom);
  const left = Math.max(a.left, b.left);
  return { top, right, bottom, left, height: Math.max(bottom - top, 0), width: Math.max(right - left, 0) };
}

function visibleFit(content: Box, container: Box): number {
  const overlap = intersect(content, container);
  if (overlap.left > overlap.right) return 0;
  return (
    ((overlap.right - overlap.left) * (overlap.bottom - overlap.top)) /
    ((content.right - content.left) * (content.bottom - content.top))
  );
}

function crossAxisPosition(
  request: PopoverRequest,
  position: PopoverPosition,
  align: PopoverPosition | undefined,
  window: Box
): number {
  const { anchor, popover, buffer = 16, offset = 0, arrow } = request;
  const first = SUBSTITUTE[position];
  const second = COMPLEMENT[first];
  const dimension = DIMENSION[first];
  const popoverSize = popover[dimension];
  const anchorSize = anchor[dimension];
  const centred = anchor[first] + anchorSize / 2 - popoverSize / 2;
  const space = {
    top: anchor.top - window.top - buffer - (position === 'top' ? offset : 0),
    right: window.right - anchor.right - buffer - (position === 'right' ? offset : 0),
    bottom: window.bottom - anchor.bottom - buffer - (position === 'bottom' ? offset : 0),
    left: anchor.left - window.left - buffer - (position === 'left' ? offset : 0),
  };
  const overflow = (popoverSize - anchorSize) / 2;
  let alignAmount = 0;
  let alignDirection = 1;
  let shift = 0;
  let shiftDirection = 1;
  if (align !== undefined) {
    alignDirection = align === 'top' || align === 'left' ? 1 : -1;
    alignAmount = overflow;
    const aligned = overflow + alignAmount;
    const room = space[COMPLEMENT[align]];
    shift = aligned > room ? aligned - room : 0;
    shiftDirection = -1 * alignDirection;
  } else {
    shiftDirection = space[first] > space[second] ? -1 : 1;
    const least = Math.min(space[first], space[second]);
    shift = overflow > least ? overflow - least : 0;
  }
  let result = centred + shift * shiftDirection + alignAmount * alignDirection;
  if (arrow) {
    const arrowStart = anchor[first] + anchorSize / 2 - arrow.width / 2;
    if (arrowStart < result + arrow.buffer) result -= result + arrow.buffer - arrowStart;
    else if (arrowStart + arrow.buffer + arrow.width > result + popoverSize) {
      result += arrowStart - (result + popoverSize - arrow.buffer - arrow.width);
    }
  }
  return result;
}

function primaryAxisPosition(request: PopoverRequest, position: PopoverPosition): number {
  const { anchor, popover, offset = 0 } = request;
  const decreasing = position === 'top' || position === 'left';
  const dimension = DIMENSION[position];
  const origin = anchor[POSITION_ATTRIBUTE[dimension]];
  return origin + (offset + (decreasing ? popover[dimension] : anchor[dimension])) * (decreasing ? -1 : 1);
}

/**
 * Where a popover goes, as OUI's findPopoverPosition: on the side asked for when it fits, else on
 * the other side, else across, wherever the most of it is inside the window
 */
export function findPopoverPosition(request: PopoverRequest): PopoverPlacement {
  const { position, align, forcePosition, buffer = 16, viewport, allowCrossAxis = true } = request;
  const window: Box = {
    top: 0,
    right: viewport.width,
    bottom: viewport.height,
    left: 0,
    height: viewport.height,
    width: viewport.width,
  };
  const positions: PopoverPosition[] = [position];
  const aligns: Array<PopoverPosition | undefined> = [align];
  if (forcePosition !== true) {
    positions.push(COMPLEMENT[position]);
    aligns.push(align);
    if (allowCrossAxis) {
      positions.push(SUBSTITUTE[position], COMPLEMENT[SUBSTITUTE[position]]);
      aligns.push(undefined, undefined);
    }
  } else if (position === align || (align !== undefined && position === COMPLEMENT[align])) {
    aligns[0] = undefined;
  }
  const bounds: Box = {
    top: window.top + buffer,
    right: window.right - buffer,
    bottom: window.bottom - buffer,
    left: window.left + buffer,
    width: window.width - 2 * buffer,
    height: window.height - 2 * buffer,
  };
  let best: PopoverPlacement | undefined;
  for (let at = 0; at < positions.length; at++) {
    const side = positions[at];
    const cross = crossAxisPosition(request, side, aligns[at], window);
    const primary = primaryAxisPosition(request, side);
    const crossSide = SUBSTITUTE[side];
    const top = crossSide === 'top' ? cross : primary;
    const left = crossSide === 'left' ? cross : primary;
    const fit = visibleFit(
      {
        top,
        left,
        right: left + request.popover.width,
        bottom: top + request.popover.height,
        width: request.popover.width,
        height: request.popover.height,
      },
      bounds
    );
    if (best === undefined || fit > best.fit) {
      best = { fit, position: side, top, left };
      if (fit === 1) break;
    }
  }
  return best ?? { fit: 0, position, top: 0, left: 0 };
}

/** EuiPopover's `anchorPosition` as a side and an edge: `downRight` is under, its right edges lined up */
export function anchorPlacement(anchorPosition: string): {
  position: PopoverPosition;
  align: PopoverPosition | undefined;
} {
  const match = /^(up|right|down|left)(Left|Right|Up|Down|Center)?$/.exec(anchorPosition);
  const sides: Record<string, PopoverPosition> = { up: 'top', right: 'right', down: 'bottom', left: 'left' };
  const edges: Record<string, PopoverPosition> = { Left: 'left', Right: 'right', Up: 'top', Down: 'bottom' };
  return {
    position: sides[match?.[1] ?? 'down'],
    align: match?.[2] ? edges[match[2]] : undefined,
  };
}

export interface HeaderPlacement {
  /** The side of the button it ended up on */
  position: PopoverPosition;
  top: number;
  /** From the window's left edge, unless `right` is given */
  left?: number;
  /** From the window's right edge */
  right?: number;
}

/** How far the theme draws an open popover back toward its button */
const POPOVER_PULL: Readonly<Record<PopoverPosition, readonly [number, number]>> = {
  top: [0, 8],
  right: [-8, 0],
  bottom: [0, -8],
  left: [8, 0],
};

/**
 * Where a popover of the header ends up, as EuiPopover with its arrow: found 16 pixels from its
 * button and 16 from the window's edges, with the room of a 24 pixel arrow kept 10 from its
 * corners; the theme then draws the open panel 8 pixels back toward the button
 */
export function placeHeaderPopover(request: {
  anchor: Box;
  popover: { width: number; height: number };
  /** EuiPopover's `anchorPosition`: `downRight`, `downCenter` */
  anchorPosition: string;
  viewport: { width: number; height: number };
  /** The side it opened on: an open popover stays there while its content changes */
  keep?: PopoverPosition;
}): Required<Omit<HeaderPlacement, 'right'>> {
  const asked = anchorPlacement(request.anchorPosition);
  const found = findPopoverPosition({
    anchor: request.anchor,
    popover: request.popover,
    position: request.keep ?? asked.position,
    align: asked.align,
    forcePosition: request.keep !== undefined,
    offset: 16,
    buffer: 16,
    arrow: { width: 24, buffer: 10 },
    viewport: request.viewport,
  });
  const [x, y] = POPOVER_PULL[found.position];
  return { position: found.position, top: found.top + y, left: found.left + x };
}

/**
 * Where a tooltip of the header goes, as EuiToolTip: 16 pixels from its anchor, with the room of
 * a 12 pixel arrow kept 4 from its corners. One that starts in the right half of the page is held
 * by its right edge, which the original counts with its width in whole pixels.
 */
export function placeHeaderTooltip(request: {
  anchor: Box;
  tooltip: { width: number; height: number };
  /** The tooltip's width as the browser rounds it: its `offsetWidth` */
  roundedWidth: number;
  position: PopoverPosition;
  viewport: { width: number; height: number };
  /** The page's width without its scroll bar */
  pageWidth: number;
}): HeaderPlacement {
  const found = findPopoverPosition({
    anchor: request.anchor,
    popover: request.tooltip,
    position: request.position,
    offset: 16,
    buffer: 16,
    arrow: { width: 12, buffer: 4 },
    viewport: request.viewport,
  });
  if (request.pageWidth / 2 < found.left) {
    return {
      position: found.position,
      top: found.top,
      right: request.pageWidth - found.left - request.roundedWidth,
    };
  }
  return { position: found.position, top: found.top, left: found.left };
}

// --- The help menu -------------------------------------------------------------------------------

/** What an application adds to the help menu, as the original's help extension of documentation */
export interface HelpExtension {
  /** The application's name, the heading of its part of the menu */
  appName: string;
  /** Where its "Documentation" leads */
  documentation: string;
}

/** The applications that add to the help menu in OpenSearch Dashboards 3.9.0, by their paths */
const HELP_EXTENSIONS: ReadonlyArray<readonly [string[], HelpExtension]> = [
  [
    ['/app/dashboards', '/app/dashboard'],
    { appName: 'Dashboards', documentation: 'https://opensearch.org/docs/latest/dashboards/index/' },
  ],
  [
    ['/app/visualize'],
    {
      appName: 'Visualize',
      documentation: 'https://opensearch.org/docs/latest/dashboards/visualize/viz-index/',
    },
  ],
  [
    ['/app/dev_tools'],
    {
      appName: 'Dev Tools',
      documentation: 'https://opensearch.org/docs/latest/dashboards/dev-tools/index-dev/',
    },
  ],
];

/** What the application at a path adds to the help menu; nothing for most */
export function helpExtensionOf(pathname: string): HelpExtension | undefined {
  return HELP_EXTENSIONS.find(([paths]) =>
    paths.some((path) => pathname === path || pathname.startsWith(`${path}/`))
  )?.[1];
}

// --- What the browser keeps ------------------------------------------------------------------------

/** Whether the navigation is docked, under the original's key, as 'true' or 'false' */
export const NAV_LOCKED_KEY = 'core.chrome.isLocked';

/** Whether a group of the navigation is open, under the original's key */
export function navGroupKey(id: string): string {
  return `core.navGroup.${id}`;
}

/** A group is open unless it was closed: what the original reads from its key */
export function isNavGroupOpen(stored: string | null): boolean {
  return (stored ?? 'true') === 'true';
}

// --- Where the links of the navigation lead ------------------------------------------------------

export interface NavTarget {
  /** The application's path: what a link it shows starts with */
  path: string;
  /** The application's name */
  title: string;
}

/**
 * The title and the label a recently viewed item is read out with, as the original's
 * createRecentNavLink: its name and the kind of page, the first application of the navigation
 * its link is under
 */
export function recentLinkTitle(label: string, link: string, targets: NavTarget[]): string {
  const target = targets.find((candidate) => link.startsWith(candidate.path));
  return target ? `${label}, type: ${target.title}` : label;
}

/** An application whose link goes back to where it was left, as the original's URL trackers do */
export interface TrackedApp {
  /** The application's path */
  base: string;
  /** Where its link leads when nothing was kept, and while it is open */
  defaultSubUrl: string;
  /** The last part of the key the original keeps the place under in the session */
  storageName: string;
}

export const TRACKED_APPS: Readonly<Record<string, TrackedApp>> = {
  dashboards: { base: '/app/dashboards', defaultSubUrl: '#/list', storageName: 'dashboard' },
  visualize: { base: '/app/visualize', defaultSubUrl: '#/', storageName: 'visualize' },
};

/** The original's key: `lastUrl:<base path>:<app>` */
export function trackedUrlKey(basePath: string, app: TrackedApp): string {
  return `lastUrl:${basePath}:${app.storageName}`;
}

/** The fragment with its `_g` replaced: the time range and pinned filters the pages share */
export function withGlobalState(subUrl: string, globalParam: string | undefined): string {
  if (globalParam === undefined) return subUrl;
  const { hashPath, hashParams } = parseHash(subUrl);
  return buildHash(hashPath, { ...hashParams, _g: globalParam }) || '#/';
}

/**
 * Where an application's link leads: where it opens while it is open, as the original's tracker
 * then sets it, and else where it was left, with the shared state of now
 */
export function trackedAppLink(
  app: TrackedApp,
  options: { current: boolean; stored: string | null; globalParam: string | undefined }
): string {
  if (options.current) return `${app.base}${app.defaultSubUrl}`;
  return `${app.base}${withGlobalState(options.stored ?? app.defaultSubUrl, options.globalParam)}`;
}

/* SPDX-License-Identifier: Apache-2.0 */

/*
 * What the header opens over the page, placed and behaving as the original's component library
 * does it: the popover of the help menu and of the crumbs left out, and the tooltips of its
 * buttons.
 */

import {
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import {
  placeHeaderPopover,
  placeHeaderTooltip,
  type Box,
  type HeaderPlacement,
  type PopoverPosition,
} from './chrome_layout';

function boxOf(element: Element): Box {
  const rect = element.getBoundingClientRect();
  return {
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  };
}

const TABBABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** What the Tab key stops at inside an element, in the order of the page */
export function tabbablesIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(TABBABLE)].filter(
    (element) => element.getClientRects().length > 0
  );
}

const classes = (...names: Array<string | false | undefined>) => names.filter(Boolean).join(' ');

export interface HeaderPopoverProps {
  /** What opens it */
  button: ReactNode;
  open: boolean;
  onClose: () => void;
  /** Where it hangs, as EuiPopover's `anchorPosition` */
  anchorPosition: 'downRight' | 'downCenter';
  /** The panel's padding: the original's `s`, 8 pixels, or `m`, 16 */
  padding?: 's' | 'm';
  id?: string;
  className?: string;
  testId?: string;
  children: ReactNode;
}

/**
 * A popover as the original's EuiPopover that owns the focus: a dialog hung from its button,
 * which takes the focus when it opens and keeps the Tab key inside, and which Escape, a press
 * outside or its button closes. Escape gives the focus back to what had it.
 */
export function HeaderPopover({
  button,
  open,
  onClose,
  anchorPosition,
  padding = 'm',
  id,
  className,
  testId,
  children,
}: HeaderPopoverProps) {
  const anchor = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const describedBy = useId();
  const [place, setPlace] = useState<Required<Omit<HeaderPlacement, 'right'>>>();
  // The side it opened on, which it keeps while its content changes
  const side = useRef<PopoverPosition | undefined>(undefined);
  const focusBefore = useRef<Element | null>(null);
  const close = useRef(onClose);
  close.current = onClose;

  const position = useCallback(
    (keepSide: boolean) => {
      if (!anchor.current || !panel.current) return;
      const size = panel.current.getBoundingClientRect();
      const next = placeHeaderPopover({
        anchor: boxOf(anchor.current),
        popover: { width: size.width, height: size.height },
        anchorPosition,
        keep: keepSide ? side.current : undefined,
        viewport: { width: window.innerWidth, height: window.innerHeight },
      });
      side.current = next.position;
      setPlace((previous) =>
        previous &&
        previous.position === next.position &&
        previous.top === next.top &&
        previous.left === next.left
          ? previous
          : next
      );
    },
    [anchorPosition]
  );

  useLayoutEffect(() => {
    if (!open) {
      side.current = undefined;
      setPlace(undefined);
      return undefined;
    }
    position(false);
    const onResize = () => position(false);
    const observer = new ResizeObserver(() => position(true));
    if (panel.current) observer.observe(panel.current);
    window.addEventListener('resize', onResize);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', onResize);
    };
  }, [open, position]);

  // The focus goes to the first thing in the panel that takes it, once the panel is in its place
  const placed = place !== undefined;
  useEffect(() => {
    if (!open || !placed || !panel.current) return;
    if (panel.current.contains(document.activeElement)) return;
    focusBefore.current = document.activeElement;
    (tabbablesIn(panel.current)[0] ?? panel.current).focus();
  }, [open, placed]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target || anchor.current?.contains(target) || panel.current?.contains(target)) return;
      // The focus goes where the press puts it
      close.current();
    };
    const onKey = (event: KeyboardEvent) => {
      const own = panel.current;
      if (!own) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close.current();
        const before = focusBefore.current;
        const back =
          before instanceof HTMLElement && before !== document.body && before.isConnected
            ? before
            : anchor.current?.querySelector<HTMLElement>('button, a[href]');
        back?.focus();
        return;
      }
      if (event.key !== 'Tab') return;
      // The panel itself is a stop, before what it holds
      const inside = tabbablesIn(own);
      const stops = [own, ...inside];
      const at = stops.indexOf(document.activeElement as HTMLElement);
      const step = event.shiftKey ? -1 : 1;
      const next =
        at === -1
          ? (inside[event.shiftKey ? inside.length - 1 : 0] ?? own)
          : stops[(at + step + stops.length) % stops.length];
      event.preventDefault();
      next.focus();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const style: CSSProperties = place
    ? { top: place.top, left: place.left }
    : { top: 0, left: 0, visibility: 'hidden' };

  return (
    <div ref={anchor} id={id} className={classes('shlHeaderPopoverAnchor', className)} data-test-subj={testId}>
      {button}
      {open &&
        createPortal(
          <div
            ref={panel}
            className={classes('shlHeaderPopover', `shlHeaderPopover--${padding}`)}
            data-side={place?.position}
            role="dialog"
            aria-modal="true"
            aria-live="off"
            aria-describedby={describedBy}
            tabIndex={0}
            style={style}
          >
            <p id={describedBy} className="atlScreenReaderOnly">
              You are in a dialog. To close this dialog, hit escape.
            </p>
            <div>{children}</div>
          </div>,
          document.body
        )}
    </div>
  );
}

/** How long the original's tooltips wait: a quarter of a second, or five times that */
const TOOLTIP_DELAY = { regular: 250, long: 1250 } as const;

export interface HeaderTooltipProps {
  content: string;
  position?: PopoverPosition;
  delay?: keyof typeof TOOLTIP_DELAY;
  /** The one thing the tooltip is about, which it then describes */
  children: ReactElement<{ 'aria-describedby'?: string }>;
}

/**
 * A tooltip as the original's EuiToolTip: shown a while after the pointer or the focus came to
 * its anchor, gone when either leaves, and gone at the first move of the pointer when it was the
 * Tab key that brought it
 */
export function HeaderTooltip({ content, position = 'top', delay = 'regular', children }: HeaderTooltipProps) {
  const anchor = useRef<HTMLSpanElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const id = useId();
  const [shown, setShown] = useState(false);
  const [place, setPlace] = useState<HeaderPlacement>();

  const show = () => {
    if (timer.current !== undefined) return;
    timer.current = window.setTimeout(() => setShown(true), TOOLTIP_DELAY[delay]);
  };
  const hide = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    setShown(false);
    setPlace(undefined);
  }, []);

  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      window.removeEventListener('mousemove', hide);
    },
    [hide]
  );

  useLayoutEffect(() => {
    if (!shown) return undefined;
    const put = () => {
      if (!anchor.current || !tip.current) return;
      const size = tip.current.getBoundingClientRect();
      setPlace(
        placeHeaderTooltip({
          anchor: boxOf(anchor.current),
          tooltip: { width: size.width, height: size.height },
          roundedWidth: tip.current.offsetWidth,
          position,
          viewport: { width: window.innerWidth, height: window.innerHeight },
          pageWidth: document.documentElement.clientWidth || window.innerWidth,
        })
      );
    };
    put();
    window.addEventListener('resize', put);
    return () => window.removeEventListener('resize', put);
  }, [shown, position, content]);

  const style: CSSProperties = place
    ? { top: place.top, left: place.left ?? 'auto', right: place.right ?? 'auto' }
    : { top: 0, left: 0, visibility: 'hidden' };

  return (
    <span
      ref={anchor}
      className="shlTipAnchor"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onKeyUp={(event) => {
        if (event.key !== 'Tab') return;
        window.removeEventListener('mousemove', hide);
        window.addEventListener('mousemove', hide, { once: true });
      }}
    >
      {cloneElement(children, { 'aria-describedby': shown ? id : undefined })}
      {shown &&
        createPortal(
          <div
            ref={tip}
            id={id}
            role="tooltip"
            className="atlTooltip atlMaterial shlHeaderTip"
            data-side={place?.position}
            style={style}
          >
            {content}
          </div>,
          document.body
        )}
    </span>
  );
}

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
import { cx } from '../components/basic';
import { Popover } from '../components/overlay';
import {
  placeHeaderPopover,
  placeHeaderTooltip,
  type Box,
  type HeaderPlacement,
  type PopoverPosition,
} from './chrome_layout';

function boxOf(element: Element | DOMRect): Box {
  const rect = element instanceof Element ? element.getBoundingClientRect() : element;
  return {
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  };
}

// The kit's span around a button that stands in a line of text: as the original's anchor, a box
// as high as the line
const IN_TEXT: CSSProperties = { display: 'inline-block' };

export interface HeaderPopoverProps {
  /** What opens it */
  button: ReactNode;
  open: boolean;
  onClose: () => void;
  /** Where it hangs, as EuiPopover's `anchorPosition` */
  anchorPosition: 'downRight' | 'downCenter';
  /** The panel's padding: the original's `s`, 8 pixels, or `m`, 16 */
  padding?: 's' | 'm';
  /** The button stands in a line of text, as the "…" of the trail: it hangs from the line's box */
  inText?: boolean;
  id?: string;
  className?: string;
  testId?: string;
  children: ReactNode;
}

/**
 * A popover of the header: the kit's, which takes the focus when it opens, keeps the Tab key
 * inside and closes on Escape, a press outside or its button, hung where the original's EuiPopover
 * hangs a panel with an arrow. It keeps the side it opened on for as long as the window keeps its
 * size, as the original's does while only its content changes.
 */
export function HeaderPopover({
  button,
  open,
  onClose,
  anchorPosition,
  padding = 'm',
  inText,
  id,
  className,
  testId,
  children,
}: HeaderPopoverProps) {
  const content = useRef<HTMLDivElement>(null);
  const kept = useRef<{ side: PopoverPosition; width: number; height: number } | undefined>(undefined);

  useEffect(() => {
    if (!open) kept.current = undefined;
  }, [open]);

  const placeAt = useCallback(
    (anchor: DOMRect, rounded: { width: number; height: number }) => {
      // The panel's size to the fraction of a pixel, as the original measures it
      const panel = content.current?.parentElement?.getBoundingClientRect();
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      const before = kept.current;
      const at = placeHeaderPopover({
        anchor: boxOf(anchor),
        popover: panel ? { width: panel.width, height: panel.height } : rounded,
        anchorPosition,
        keep: before && before.width === viewport.width && before.height === viewport.height ? before.side : undefined,
        viewport,
      });
      kept.current = { side: at.position, ...viewport };
      return { top: at.top, left: at.left, side: at.position };
    },
    [anchorPosition]
  );

  return (
    <div id={id} className={cx('shlHeaderPopoverAnchor', className)} data-test-subj={testId}>
      <Popover
        button={button}
        open={open}
        onClose={onClose}
        placeAt={placeAt}
        className={`shlHeaderPopover shlHeaderPopover--${padding}`}
        anchorClassName="shlHeaderPopover__anchor"
        anchorStyle={inText ? IN_TEXT : undefined}
      >
        <div ref={content}>{children}</div>
      </Popover>
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
 * Tab key that brought it. It is placed as the original places it, 16 pixels from the edges of
 * the window, which the kit's tooltip is not.
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

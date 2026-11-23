/* SPDX-License-Identifier: Apache-2.0 */

/* What sits over the page: popovers and menus, dialogs, side panels and the messages in the corner. */

import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { navigate, href as toHref } from '../router';
import { services } from '../services';
import type { Toast } from '../services/toasts';
import { Button, CallOut, CodeBlock, IconButton, cx } from './basic';
import { Icon, type IconName } from './icon';
import { createLayerStack, isTextField, tabbablesIn, wrapTab } from './layers';
import { placeLikeOriginal, type PopoverPosition } from './placement';
import type { PopoverSide } from './popover_place';

export type { PopoverPosition };

export function Portal({ children }: { children: ReactNode }) {
  return createPortal(children, document.body);
}

// The popovers, dialogs and flyouts shown, in the order they opened: Escape closes the last one only
const layers = createLayerStack();
let listening = false;

/**
 * Puts what floats over the page on the stack while it is shown, so that Escape closes it only when
 * it is on top, as the original's focus traps do: a popover over a flyout or a dialog closes alone.
 * Something that uses Escape itself (a list it closes) stops the key or prevents its default.
 */
export function useLayer(shown: boolean, onEscape: () => void) {
  const latest = useRef(onEscape);
  useLayoutEffect(() => {
    latest.current = onEscape;
  });
  useLayoutEffect(() => {
    if (!shown) return undefined;
    if (!listening) {
      listening = true;
      document.addEventListener('keydown', layers.onKeyDown);
    }
    return layers.push({ escape: () => latest.current() });
  }, [shown]);
}

// Where a panel is laid out before it is placed: on the screen, so that what it holds can take the
// focus as it appears (a field's autoFocus); it is placed before anything is painted
const UNPLACED: CSSProperties = { left: 0, top: 0 };

export interface PopoverProps {
  /** What opens it; it is given the place the popover hangs from */
  button: ReactNode;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Which edge of the button it lines up with; 'center' hangs it under the middle */
  align?: 'left' | 'right' | 'center';
  /**
   * Under the button (over it where there is more room), or beside it: to its right where the
   * panel fits, its top 10 px above the button's, as the component library opens a panel "rightUp"
   */
  side?: 'below' | 'right';
  padded?: boolean;
  /** As wide as its button at least: a list under a field */
  matchWidth?: boolean;
  /** As wide as its button exactly, as the list under a combo box */
  fitWidth?: boolean;
  width?: number;
  /** How far from its button it hangs; 4 px unless said otherwise */
  offset?: number;
  /** How far it keeps from the edges of the window; 8 px unless said otherwise */
  buffer?: number;
  /**
   * Where it goes instead, from its button's box and its own size, in the window: one that hangs
   * as the component library hangs a panel with an arrow, say. The same function on every render.
   */
  placeAt?: (anchor: DOMRect, panel: { width: number; height: number }) => { top: number; left: number; side: PopoverSide };
  className?: string;
  /** How the span around the button is laid out */
  anchorStyle?: CSSProperties;
  anchorClassName?: string;
  /**
   * Placed as the original's popovers place themselves: on this side of the button and aligned so,
   * or on the other side, or beside it, wherever it fits first (see `placeLikeOriginal`)
   */
  position?: PopoverPosition;
  /** Above its button when there is room, as the original's `up` positions */
  above?: boolean;
  /**
   * As the original's `ownFocus`, its default: the panel is a dialog that takes the focus once it is
   * placed (what `initialFocus` names, else the first thing in it that takes the focus, else the
   * panel itself, unless something in it has the focus already), keeps Tab in it, and gives the
   * focus back to what had it when it closes from inside. A list under a field (`matchWidth`,
   * `fitWidth`) leaves the focus in the field, as the original's input popover, and so does a
   * popover opened from a field text is typed in, as its colour picker opened by a click; `true`
   * takes the focus from the field all the same (its colour picker opened with the down key).
   */
  ownFocus?: boolean;
  /** A selector of what has the focus when it opens; `false` leaves the focus where it is */
  initialFocus?: string | false;
  /** What a screen reader calls the dialog */
  ariaLabel?: string;
}

export function Popover({
  button,
  open,
  onClose,
  children,
  align = 'left',
  side = 'below',
  padded,
  matchWidth,
  fitWidth,
  width,
  offset = 4,
  buffer = 8,
  placeAt,
  className,
  anchorStyle,
  anchorClassName,
  position,
  above: preferAbove = false,
  ownFocus,
  initialFocus,
  ariaLabel,
}: PopoverProps) {
  const anchor = useRef<HTMLSpanElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>(UNPLACED);
  const [placement, setPlacement] = useState<PopoverSide>('bottom');
  const own = ownFocus ?? !(matchWidth || fitWidth);
  const announcement = useId();
  const opener = useRef<HTMLElement | null>(null);

  const place = useCallback(() => {
    const anchorBox = anchor.current?.getBoundingClientRect();
    const panelElement = panel.current;
    if (!anchorBox || !panelElement) return;
    // Its size as laid out, which the opening animation's scale does not change
    const panelBox = { width: panelElement.offsetWidth, height: panelElement.offsetHeight };
    if (placeAt) {
      const at = placeAt(anchorBox, panelBox);
      setStyle({ top: at.top, left: at.left, width });
      setPlacement(at.side);
      return;
    }
    if (position) {
      const size = { width: width ?? panelBox.width, height: panelBox.height };
      const at = placeLikeOriginal(anchorBox, size, position, { width: window.innerWidth, height: window.innerHeight });
      setStyle({ left: at.left, top: at.top, width });
      setPlacement(at.top < anchorBox.top ? 'top' : 'bottom');
      return;
    }
    const margin = buffer;
    if (side === 'right') {
      const fitsRight = anchorBox.right + margin + panelBox.width <= window.innerWidth - margin;
      setStyle({
        left: fitsRight ? anchorBox.right + margin : Math.max(margin, anchorBox.left - margin - panelBox.width),
        top: Math.max(margin, Math.min(anchorBox.top - 10, window.innerHeight - panelBox.height - margin)),
        width,
        maxHeight: window.innerHeight - 2 * margin,
      });
      return;
    }
    const panelWidth = fitWidth ? anchorBox.width : Math.max(panelBox.width, matchWidth ? anchorBox.width : 0);
    let left =
      align === 'right'
        ? anchorBox.right - panelWidth
        : align === 'center'
          ? anchorBox.left + (anchorBox.width - panelWidth) / 2
          : anchorBox.left;
    left = Math.max(margin, Math.min(left, window.innerWidth - panelWidth - margin));
    const below = window.innerHeight - anchorBox.bottom - margin;
    const above = anchorBox.top - margin;
    const fitsBelow = preferAbove
      ? panelBox.height + offset > above && below >= above
      : panelBox.height + offset <= below || below >= above;
    const next: CSSProperties = {
      left,
      minWidth: matchWidth ? anchorBox.width : undefined,
      width: fitWidth ? anchorBox.width : width,
      maxHeight: Math.max(120, (fitsBelow ? below : above) - offset),
    };
    if (fitsBelow) next.top = anchorBox.bottom + offset;
    else next.bottom = window.innerHeight - anchorBox.top + offset;
    setStyle(next);
    setPlacement(fitsBelow ? 'bottom' : 'top');
  }, [align, side, matchWidth, fitWidth, width, offset, buffer, placeAt, position, preferAbove]);

  useLayoutEffect(() => {
    if (!open) {
      setStyle(UNPLACED);
      return undefined;
    }
    place();
    const observer = new ResizeObserver(place);
    if (panel.current) observer.observe(panel.current);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    // A popover opened inside one that is still appearing is placed again once that one is
    document.addEventListener('animationend', place, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      document.removeEventListener('animationend', place, true);
    };
  }, [open, place]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (anchor.current?.contains(target) || panel.current?.contains(target)) return;
      // A popover opened from inside this one is drawn outside it, and is still part of it
      if ((target as Element).closest?.('.atlPopover') && isNested(panel.current, target)) return;
      onClose();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, onClose]);

  useLayer(open, onClose);

  // What had the focus when it opened: the button, unless a field in the panel took it already
  useLayoutEffect(() => {
    if (!open || !own) return;
    const active = document.activeElement;
    opener.current =
      active instanceof HTMLElement && active !== document.body && !panel.current?.contains(active)
        ? active
        : (anchor.current && tabbablesIn(anchor.current)[0]) ?? null;
  }, [open, own]);

  // Once it is placed the panel takes the focus, as the original's: what it names, else the first
  // thing in it that takes the focus, else itself. Opened from a field text is typed in, it leaves
  // the focus there, unless `ownFocus` says to take it.
  const fieldKeepsFocus = ownFocus === undefined;
  useEffect(() => {
    if (!open || !own || initialFocus === false) return undefined;
    const frame = requestAnimationFrame(() => {
      const element = panel.current;
      if (!element || element.contains(document.activeElement)) return;
      if (fieldKeepsFocus && isTextField(opener.current) && anchor.current?.contains(opener.current)) return;
      const named = initialFocus ? element.querySelector<HTMLElement>(initialFocus) : null;
      (named ?? tabbablesIn(element)[0] ?? element).focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [open, own, initialFocus, fieldKeepsFocus]);

  // When it closes with the focus in it, the focus goes back to what had it before
  useEffect(() => {
    if (!open || !own) return undefined;
    return () => {
      const active = document.activeElement;
      const back = opener.current;
      if ((!active || active === document.body) && back?.isConnected) back.focus({ preventScroll: true });
    };
  }, [open, own]);

  // Tab goes round the panel and what it holds, as the original's focus trap: from the last thing
  // in it to the panel itself, and on to the first
  const holdTab = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const element = panel.current;
    if (event.key !== 'Tab' || event.defaultPrevented || !element) return;
    // A popover opened from this one is drawn outside it and holds the focus itself
    if (!element.contains(document.activeElement)) return;
    const target = wrapTab([element, ...tabbablesIn(element)], document.activeElement as HTMLElement | null, event.shiftKey);
    if (!target) return;
    event.preventDefault();
    target.focus();
  };

  return (
    <>
      <span
        ref={anchor}
        className={anchorClassName}
        style={{ display: 'inline-flex', minWidth: 0, ...anchorStyle }}
      >
        {button}
      </span>
      {open && (
        <Portal>
          <div
            ref={panel}
            className={cx('atlPopover', 'atlMaterial', padded && 'atlPopover--padded', position && 'atlPopover--placed', className)}
            style={style}
            data-placement={placement}
            data-popover-depth={depthOf(anchor.current) + 1}
            role={own ? 'dialog' : undefined}
            aria-modal={own ? true : undefined}
            aria-label={ariaLabel}
            aria-live={own ? 'off' : undefined}
            aria-describedby={own ? announcement : undefined}
            tabIndex={own ? 0 : undefined}
            onKeyDown={own ? holdTab : undefined}
          >
            {own && (
              <p id={announcement} className="atlScreenReaderOnly">
                You are in a dialog. To close this dialog, hit escape.
              </p>
            )}
            {children}
          </div>
        </Portal>
      )}
    </>
  );
}

function depthOf(element: Element | null): number {
  const parent = element?.closest('.atlPopover');
  return parent ? Number(parent.getAttribute('data-popover-depth') ?? 0) : 0;
}

function isNested(panel: HTMLElement | null, target: Node): boolean {
  const other = (target as Element).closest?.('.atlPopover');
  if (!panel || !other) return false;
  return Number(other.getAttribute('data-popover-depth') ?? 0) > Number(panel.getAttribute('data-popover-depth') ?? 0);
}

export interface MenuItem {
  id?: string;
  label: ReactNode;
  icon?: IconName;
  onClick?: () => void;
  to?: string;
  /** A page elsewhere, opened in a new tab */
  href?: string;
  danger?: boolean;
  disabled?: boolean;
  selected?: boolean;
  /** A line above this item */
  separated?: boolean;
  title?: string;
  /** What a screen reader says of it, where the original says more than its label */
  ariaLabel?: string;
  testId?: string;
}

export function Menu({
  items,
  title,
  onDone,
}: {
  items: MenuItem[];
  title?: ReactNode;
  /** Called after an item was chosen: where the popover closes */
  onDone?: () => void;
}) {
  return (
    <div className="atlMenu" role="menu">
      {title && <div className="atlMenu__title">{title}</div>}
      {items.map((item, index) => (
        <div key={item.id ?? index}>
          {item.separated && <div className="atlMenu__separator" />}
          {item.href !== undefined ? (
            <a
              role="menuitem"
              className="atlMenu__item"
              href={item.href}
              target="_blank"
              rel="noreferrer"
              title={item.title}
              data-test-subj={item.testId}
              onClick={() => {
                item.onClick?.();
                onDone?.();
              }}
            >
              {item.icon && <Icon name={item.icon} />}
              <span className="atlGrow atlTruncate">{item.label}</span>
            </a>
          ) : (
            <button
              type="button"
              role="menuitem"
              className={cx('atlMenu__item', item.danger && 'atlMenu__item--danger')}
              aria-selected={item.selected}
              disabled={item.disabled}
              title={item.title}
              data-test-subj={item.testId}
              onClick={() => {
                item.onClick?.();
                onDone?.();
              }}
            >
              {item.icon && <Icon name={item.icon} />}
              <span className="atlGrow atlTruncate">{item.label}</span>
              {item.selected && <Icon name="check" />}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/** A button that opens a menu */
export function MenuButton({
  button,
  items,
  title,
  align,
}: {
  button: (toggle: () => void, open: boolean) => ReactNode;
  items: MenuItem[];
  title?: ReactNode;
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <Popover open={open} onClose={close} align={align} button={button(() => setOpen((was) => !was), open)}>
      <Menu items={items} title={title} onDone={close} />
    </Popover>
  );
}

export interface ContextMenuItem extends MenuItem {
  /** The panel this item opens in the menu's place */
  panel?: string;
  /**
   * What a link hands the page it opens, in the new entry of the history, as the original's
   * actions do with `navigateToApp(app, { path, state })`; a click that opens a new tab hands none
   */
  state?: unknown;
}

export interface ContextMenuPanel {
  id: string;
  title?: ReactNode;
  items: ContextMenuItem[];
}

/**
 * The original's context menu: rows as wide as the popover, an icon before each when one of them
 * has one, a title over them, and items that open another panel in its place (with a way back).
 */
export function ContextMenu({
  panels,
  initial,
  onDone,
  small,
  width,
  testId,
}: {
  panels: ContextMenuPanel[];
  /** The panel shown first; the first of them when none is named */
  initial?: string;
  onDone?: () => void;
  /** The original's small menu: rows of 37px rather than 33px */
  small?: boolean;
  /**
   * Given, the original's menu of panels (EuiContextMenu, 256 px wide of its own): this wide, its
   * rows cut at its round corners as that one's are. Left out, a panel of items alone
   * (EuiContextMenuPanel): as wide as its items, cutting nothing, not even the ring of the focus.
   */
  width?: number;
  testId?: string;
}) {
  const [trail, setTrail] = useState<string[]>([]);
  const menu = useRef<HTMLDivElement>(null);
  const root = initial ?? panels[0]?.id;
  const shownId = trail[trail.length - 1] ?? root;
  // The original's popover takes the focus to its first item when it opens, and to the first item
  // of a panel opened from it
  useEffect(() => {
    // After the popover around it is placed and shown: what is hidden cannot take the focus
    const frame = window.requestAnimationFrame(() =>
      menu.current?.querySelector<HTMLElement>('.atlContextMenu__item:not(:disabled)')?.focus({ preventScroll: true })
    );
    return () => window.cancelAnimationFrame(frame);
  }, [shownId]);
  const shown = panels.find((panel) => panel.id === shownId);
  if (!shown) return null;
  const withIcons = shown.items.some((item) => item.icon);
  // As the original's menu: the arrows go down and up its items, round from the last to the first
  // and back; left goes back to the panel this one came from, right opens the panel of the item
  // that has the focus
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const element = menu.current;
    if (!element || event.defaultPrevented) return;
    if (event.key === 'ArrowLeft' && trail.length > 0) {
      event.preventDefault();
      setTrail(trail.slice(0, -1));
      return;
    }
    const items = [...element.querySelectorAll<HTMLElement>('.atlContextMenu__item:not(:disabled)')];
    const index = items.findIndex((item) => item === document.activeElement);
    if (event.key === 'ArrowRight') {
      const opens = index >= 0 ? shown.items.filter((item) => !item.disabled)[index]?.panel : undefined;
      if (opens === undefined) return;
      event.preventDefault();
      setTrail([...trail, opens]);
      return;
    }
    if ((event.key !== 'ArrowDown' && event.key !== 'ArrowUp') || items.length === 0) return;
    event.preventDefault();
    const step = event.key === 'ArrowDown' ? 1 : -1;
    const next = index < 0 ? (step > 0 ? 0 : items.length - 1) : (index + step + items.length) % items.length;
    items[next]?.focus();
  };
  return (
    <div
      ref={menu}
      className={cx('atlContextMenu', small && 'atlContextMenu--small', width !== undefined && 'atlContextMenu--framed')}
      style={width !== undefined ? { width } : undefined}
      role="menu"
      data-test-subj={testId}
      onKeyDown={onKeyDown}
    >
      {shown.title !== undefined &&
        (trail.length > 0 ? (
          <button type="button" className="atlContextMenu__title atlContextMenu__back" onClick={() => setTrail(trail.slice(0, -1))}>
            <Icon name="arrowLeft" />
            <span>{shown.title}</span>
          </button>
        ) : (
          <div className="atlContextMenu__title">{shown.title}</div>
        ))}
      {shown.items.map((item, index) => {
        const content = (
          <>
            {withIcons && (item.icon ? <Icon name={item.icon} /> : <span className="atlContextMenu__noIcon" />)}
            <span className="atlContextMenu__text">{item.label}</span>
            {item.panel && <Icon name="chevronRight" className="atlContextMenu__arrow" />}
          </>
        );
        const choose = () => {
          if (item.panel) {
            setTrail([...trail, item.panel]);
            return;
          }
          item.onClick?.();
          onDone?.();
        };
        return item.to !== undefined && !item.disabled ? (
          <a
            key={item.id ?? index}
            role="menuitem"
            className="atlContextMenu__item"
            href={toHref(item.to)}
            title={item.title}
            aria-label={item.ariaLabel}
            data-test-subj={item.testId}
            onClick={(event) => {
              const plain = event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
              if (item.to !== undefined && item.state !== undefined && plain) {
                event.preventDefault();
                navigate(item.to, { state: item.state });
              }
              choose();
            }}
          >
            {content}
          </a>
        ) : (
          <button
            key={item.id ?? index}
            type="button"
            role="menuitem"
            className={cx('atlContextMenu__item', item.danger && 'atlContextMenu__item--danger')}
            disabled={item.disabled}
            title={item.title}
            aria-label={item.ariaLabel}
            data-test-subj={item.testId}
            onClick={choose}
          >
            {content}
          </button>
        );
      })}
    </div>
  );
}

/**
 * What had the focus when an overlay was first drawn, before anything in it could take it (a
 * field's autoFocus), so that the focus goes back there when it closes
 */
function useOpener() {
  const opener = useRef<Element | null | undefined>(undefined);
  if (opener.current === undefined) opener.current = typeof document === 'undefined' ? null : document.activeElement;
  return opener;
}

/** Gives the focus back to what opened an overlay, unless it went somewhere else meanwhile */
function returnFocus(opener: Element | null | undefined, overlay: Element) {
  if (!(opener instanceof HTMLElement) || opener === document.body || overlay.contains(opener)) return;
  const now = document.activeElement;
  if ((!now || now === document.body || overlay.contains(now)) && opener.isConnected) opener.focus({ preventScroll: true });
}

interface Focusable {
  focus: (options?: FocusOptions) => void;
}

/** The part of an element `initialModalFocus` reads */
interface FocusRoot extends Focusable {
  contains: (node: Node | null) => boolean;
  querySelector: (selector: string) => unknown;
}

const isFocusable = (value: unknown): value is Focusable =>
  typeof value === 'object' && value !== null && typeof (value as Focusable).focus === 'function';

/**
 * What takes the focus when a dialog opens, as the original's focus trap gives it: nothing when
 * something in the dialog has it already (a field's autoFocus), else what is marked
 * `data-autofocus` (the button a confirmation focuses), else the dialog itself
 */
export function initialModalFocus(box: FocusRoot, active: Node | null): Focusable | null {
  if (active !== null && box.contains(active)) return null;
  const marked = box.querySelector('[data-autofocus]');
  return isFocusable(marked) ? marked : box;
}

export function Modal({
  title,
  children,
  footer,
  onClose,
  wide,
  testId,
  className,
  titleSize = 'm',
}: {
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  wide?: boolean;
  testId?: string;
  className?: string;
  /** 'l': the larger title the original's save dialogs have */
  titleSize?: 'm' | 'l';
}) {
  useLayer(true, onClose);
  const box = useRef<HTMLDivElement>(null);
  const opener = useOpener();
  // As the original's dialog, which holds the focus: when it opens, what in it has the focus already
  // keeps it (a field's autoFocus), else what is marked for it, else the dialog itself; Tab goes
  // round the dialog and what it holds; when it closes, the focus goes back to what had it before
  useEffect(() => {
    const element = box.current;
    if (!element) return undefined;
    initialModalFocus(element, document.activeElement)?.focus({ preventScroll: true });
    return () => returnFocus(opener.current, element);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const holdTab = (event: ReactKeyboardEvent<HTMLElement>) => {
    const element = box.current;
    if (event.key !== 'Tab' || event.defaultPrevented || !element) return;
    // A popover opened from the dialog is drawn outside it and holds the focus itself
    if (!element.contains(document.activeElement)) return;
    const target = wrapTab([element, ...tabbablesIn(element)], document.activeElement as HTMLElement | null, event.shiftKey);
    if (!target) return;
    event.preventDefault();
    target.focus();
  };
  return (
    <Portal>
      {/* A press on the mask does not close it, as the original's */}
      <div className="atlScrim">
        <div
          ref={box}
          className={cx('atlModal', wide && 'atlModal--wide', className)}
          role="dialog"
          aria-modal="true"
          tabIndex={-1}
          onKeyDown={holdTab}
          data-test-subj={testId}
        >
          <div className="atlModal__header">
            <h2 className={titleSize === 'l' ? 'atlTitleM' : 'atlModal__title'}>{title}</h2>
          </div>
          <IconButton icon="cross" label="Closes this modal window" onClick={onClose} className="atlModal__close" />
          <div className="atlModal__body">{children}</div>
          {footer && <div className="atlModal__footer">{footer}</div>}
        </div>
      </div>
    </Portal>
  );
}

export function ConfirmModal({
  title,
  children,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger,
  onConfirm,
  onCancel,
  busy,
  focusCancel,
  narrow,
}: {
  title: ReactNode;
  children?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
  /** The cancel button has the focus when it opens, as the original's does where it asks so */
  focusCancel?: boolean;
  /** The original's confirmation dialog: 400px wide, with buttons of 40px */
  narrow?: boolean;
}) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      className={narrow ? 'atlModal--confirm' : undefined}
      testId="confirmModal"
      footer={
        <>
          <Button variant="empty" onClick={onCancel} data-autofocus={focusCancel || undefined} testId="confirmModalCancelButton">
            {cancelLabel}
          </Button>
          <Button
            variant={danger ? 'dangerFill' : 'primary'}
            onClick={onConfirm}
            loading={busy}
            data-autofocus={focusCancel ? undefined : true}
            testId="confirmModalConfirmButton"
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Modal>
  );
}

export function Flyout({
  title,
  children,
  footer,
  onClose,
  wide,
  testId,
  hideClose,
  mask,
  className,
}: {
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  wide?: boolean;
  testId?: string;
  /** No cross in the header: the buttons at the foot close it */
  hideClose?: boolean;
  /** The page behind is dimmed, and a click on it closes the flyout */
  mask?: boolean;
  className?: string;
}) {
  useLayer(true, onClose);
  const panel = useRef<HTMLElement>(null);
  const opener = useOpener();
  // As the original's flyout, which holds the focus: the first thing in it that takes the focus
  // has it when it opens (its close button), unless something in it took it already (a field's
  // autoFocus); Tab goes round what it holds; and when it closes, the focus goes back to what had
  // it before it opened
  useEffect(() => {
    const element = panel.current;
    if (!element) return undefined;
    if (!element.contains(document.activeElement)) (tabbablesIn(element)[0] ?? element).focus({ preventScroll: true });
    return () => returnFocus(opener.current, element);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const holdTab = (event: ReactKeyboardEvent<HTMLElement>) => {
    const element = panel.current;
    if (event.key !== 'Tab' || event.defaultPrevented || !element) return;
    // A popover opened from the flyout is drawn outside it and holds the focus itself
    if (!element.contains(document.activeElement)) return;
    const target = wrapTab(tabbablesIn(element), document.activeElement as HTMLElement | null, event.shiftKey);
    if (!target) return;
    event.preventDefault();
    target.focus();
  };
  return (
    <Portal>
      {mask && <div className="atlFlyoutMask" onMouseDown={onClose} />}
      <aside
        ref={panel}
        className={cx('atlFlyout', wide && 'atlFlyout--wide', className)}
        role="dialog"
        tabIndex={-1}
        onKeyDown={holdTab}
        data-test-subj={testId}
      >
        <div className="atlFlyout__header">
          <h2 className="atlTitleM atlTruncate">{title}</h2>
          {!hideClose && <IconButton icon="cross" label="Close this dialog" onClick={onClose} testId="euiFlyoutCloseButton" />}
        </div>
        {/* As the original's, the body takes the focus, for the keys to scroll it */}
        <div className="atlFlyout__body" tabIndex={0}>
          {children}
        </div>
        {footer && <div className="atlFlyout__footer">{footer}</div>}
      </aside>
    </Portal>
  );
}

// The original's icons: a check, an i in a ring, OUI's `help` (a ring buoy) for a warning, and a
// triangle for what failed; a plain message has none
const TOAST_ICONS: Record<Toast['kind'], IconName | undefined> = {
  healthy: 'check',
  info: 'info',
  warning: 'lifebuoy',
  critical: 'warning',
  plain: undefined,
};

export function ToastList() {
  const { toasts } = services;
  const items = useSyncExternalStore(toasts.subscribe, toasts.get);
  // The whole error stays open when its message goes, as the original's does
  const [full, setFull] = useState<{ title: ReactNode; error: Error }>();
  return (
    <>
      {items.length > 0 && (
        <Portal>
          <div className="atlToasts" role="region" aria-live="polite" data-test-subj="globalToastList">
            {items.map((toast) => {
              const icon = TOAST_ICONS[toast.kind];
              return (
                <div key={toast.id} className={`atlToast atlMaterial atlToast--${toast.kind}`} data-test-subj={toast.testId}>
                  {/* As the original's toast: what a screen reader says before it */}
                  <p className="atlScreenReaderOnly">A new notification appears</p>
                  <div className="atlToast__header" aria-label="Notification" data-test-subj="euiToastHeader">
                    {icon && <Icon name={icon} />}
                    <div className="atlToast__title">{toast.title}</div>
                  </div>
                  <ToastText toast={toast} onFullError={setFull} />
                  <IconButton
                    icon="cross"
                    label="Dismiss toast"
                    size="s"
                    className="atlToast__close"
                    onClick={() => toasts.dismiss(toast.id)}
                    testId="toastCloseButton"
                  />
                </div>
              );
            })}
          </div>
        </Portal>
      )}
      {full && <FullError title={full.title} error={full.error} onClose={() => setFull(undefined)} />}
    </>
  );
}

function ToastText({ toast, onFullError }: { toast: Toast; onFullError: (full: { title: ReactNode; error: Error }) => void }) {
  const { error } = toast;
  if (!error) return toast.text ? <div className="atlToast__text">{toast.text}</div> : null;
  return (
    <>
      <p className="atlToast__text atlToast__message" data-test-subj="errorToastMessage">
        {toast.text}
      </p>
      <div className="atlToast__actions">
        <Button variant="dangerOutline" onClick={() => onFullError({ title: toast.title, error })}>
          See the full error
        </Button>
      </div>
    </>
  );
}

/**
 * What a failed request was refused for, as OpenSearch answered: the first lines of the whole
 * error, as the original writes them from the `caused_by` of the answer
 */
function requestCause(error: Error): string {
  const body = (error as { body?: unknown }).body;
  const answer = body && typeof body === 'object' ? (body as { error?: unknown }).error : undefined;
  const cause = answer && typeof answer === 'object' ? (answer as { caused_by?: { type?: unknown; reason?: unknown } }).caused_by : undefined;
  return cause ? `${String(cause.type)}\n${String(cause.reason)}\n\n` : '';
}

/** "See the full error": the message, then what OpenSearch said and the stack, to copy */
function FullError({ title, error, onClose }: { title: ReactNode; error: Error; onClose: () => void }) {
  const text = `${requestCause(error)}${error.stack ?? ''}`;
  return (
    <Modal
      title={title}
      onClose={onClose}
      className="atlFullError"
      testId="fullErrorModal"
      footer={
        <Button variant="primary" onClick={onClose}>
          Close
        </Button>
      }
    >
      <CallOut tone="critical" size="s" icon="warning" title={error.message} />
      {text && <CopyableCode size="s">{text}</CopyableCode>}
    </Modal>
  );
}

/** Code in a box, with a button that copies it */
export function CopyableCode({ children, size = 'm' }: { children: string; size?: 's' | 'm' }) {
  return (
    <div className={size === 's' ? 'atlCodeCopy atlCodeCopy--s' : 'atlCodeCopy'}>
      <CodeBlock>{children}</CodeBlock>
      <IconButton icon="copy" label="Copy" size="s" onClick={() => copyText(children)} />
    </div>
  );
}

/** How long the original's tooltips wait before they show: a quarter second, or five times it */
const TOOLTIP_DELAYS = { regular: 250, long: 1250 };
/** The room the original's tooltip keeps from the window's edges, and from its anchor */
const TOOLTIP_BUFFER = 16;
const TOOLTIP_OFFSET = 16;
/** The original's tooltip arrow, which points at the middle of the anchor at least 4 px inside it */
const TOOLTIP_ARROW = { width: 12, buffer: 4 };

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

export type TooltipSide = 'top' | 'right' | 'bottom' | 'left';

const OPPOSITE: Record<TooltipSide, TooltipSide> = { top: 'bottom', right: 'left', bottom: 'top', left: 'right' };
/** The first of the two other sides the original tries */
const ACROSS: Record<TooltipSide, TooltipSide> = { top: 'left', right: 'top', bottom: 'left', left: 'top' };

/** How much of a box the window shows inside 16 px of its edges: 0 to 1 */
function visibleFit(box: { left: number; top: number; width: number; height: number }, viewport: { width: number; height: number }): number {
  const left = Math.max(box.left, TOOLTIP_BUFFER);
  const right = Math.min(box.left + box.width, viewport.width - TOOLTIP_BUFFER);
  const top = Math.max(box.top, TOOLTIP_BUFFER);
  const bottom = Math.min(box.top + box.height, viewport.height - TOOLTIP_BUFFER);
  if (left > right || top > bottom) return 0;
  return ((right - left) * (bottom - top)) / (box.width * box.height);
}

/**
 * A tooltip on one side of its anchor, as the original computes it: 16 px from it, centred on it
 * and moved along it towards the side with more room by as much as the other has too little, but
 * no further than lets its arrow point at the anchor's middle
 */
function tooltipOn(
  side: TooltipSide,
  target: Box,
  own: { width: number; height: number },
  viewport: { width: number; height: number }
): { left: number; top: number; fit: number } {
  const vertical = side === 'top' || side === 'bottom';
  const size = vertical ? own.width : own.height;
  const anchorStart = vertical ? target.left : target.top;
  const anchorSize = vertical ? target.width : target.height;
  const room = {
    top: target.top - TOOLTIP_BUFFER - (side === 'top' ? TOOLTIP_OFFSET : 0),
    right: viewport.width - target.right - TOOLTIP_BUFFER - (side === 'right' ? TOOLTIP_OFFSET : 0),
    bottom: viewport.height - target.bottom - TOOLTIP_BUFFER - (side === 'bottom' ? TOOLTIP_OFFSET : 0),
    left: target.left - TOOLTIP_BUFFER - (side === 'left' ? TOOLTIP_OFFSET : 0),
  };
  const before = vertical ? room.left : room.top;
  const after = vertical ? room.right : room.bottom;
  const overflow = (size - anchorSize) / 2;
  const tightest = Math.min(before, after);
  let along = anchorStart + anchorSize / 2 - size / 2 + Math.max(0, overflow - tightest) * (before > after ? -1 : 1);
  const arrow = anchorStart + anchorSize / 2 - TOOLTIP_ARROW.width / 2;
  if (arrow < along + TOOLTIP_ARROW.buffer) along = arrow - TOOLTIP_ARROW.buffer;
  else if (arrow + TOOLTIP_ARROW.buffer + TOOLTIP_ARROW.width > along + size) along = arrow + TOOLTIP_ARROW.buffer + TOOLTIP_ARROW.width - size;
  const away = {
    top: target.top - TOOLTIP_OFFSET - own.height,
    bottom: target.bottom + TOOLTIP_OFFSET,
    left: target.left - TOOLTIP_OFFSET - own.width,
    right: target.right + TOOLTIP_OFFSET,
  }[side];
  const left = vertical ? along : away;
  const top = vertical ? away : along;
  return { left, top, fit: visibleFit({ left, top, width: own.width, height: own.height }, viewport) };
}

/**
 * Where a tooltip goes, as the original places it: on the side asked, else on the opposite one,
 * else on one of the other two, the first where the whole of it stays 16 px inside the window, or
 * where most of it does
 */
export function placeTooltip(
  target: Box,
  own: { width: number; height: number },
  viewport: { width: number; height: number },
  position: TooltipSide = 'top'
): { left: number; top: number; side: TooltipSide } {
  const sides = [position, OPPOSITE[position], ACROSS[position], OPPOSITE[ACROSS[position]]];
  let best: { left: number; top: number; fit: number; side: TooltipSide } | undefined;
  for (const side of sides) {
    const placed = tooltipOn(side, target, own, viewport);
    if (best === undefined || placed.fit > best.fit) best = { ...placed, side };
    if (best.fit === 1) break;
  }
  const { left, top, side } = best ?? { ...tooltipOn(position, target, own, viewport), side: position };
  return { left, top, side };
}

/** What describes an element while its tooltip shows: its own description, then the tooltip */
export function describedBy(own: string | undefined, tooltip: string, shown: boolean): string | undefined {
  if (!shown) return own;
  return own ? `${own} ${tooltip}` : tooltip;
}

/** A short text shown over what the pointer or the focus is on */
export function Tooltip({
  content,
  children,
  testId,
  block,
  className,
  position = 'top',
  delay,
}: {
  content: ReactNode;
  children: ReactNode;
  testId?: string;
  /** The anchor a block as wide as its line, as the original's `eui-displayBlock` anchors */
  block?: boolean;
  /** A class for the box of the text */
  className?: string;
  /**
   * Where it is drawn, as the original's `position`: the side of its anchor it goes on when the
   * window has room for it there, else the opposite side or one of the other two
   */
  position?: TooltipSide;
  /** Shown after the original's delay; at once when left out */
  delay?: keyof typeof TOOLTIP_DELAYS;
}) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number }>();
  const box = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const id = useId();
  // As the original's, a tooltip with nothing to say draws no box
  const drawn = shown && Boolean(content);
  useLayoutEffect(() => {
    if (!drawn || !anchor.current || !box.current) return;
    // The window as the original measures it: without its scroll bars
    const { clientWidth, clientHeight } = document.documentElement;
    const { left, top } = placeTooltip(
      anchor.current.getBoundingClientRect(),
      box.current.getBoundingClientRect(),
      { width: clientWidth || window.innerWidth, height: clientHeight || window.innerHeight },
      position
    );
    setPlace({ left, top });
  }, [drawn, content, position]);
  // As the original's, what the tooltip is about is described by it while it shows
  const anchored = isValidElement<{ 'aria-describedby'?: string }>(children)
    ? cloneElement(children, { 'aria-describedby': describedBy(children.props['aria-describedby'], id, drawn) })
    : children;
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const show = () => {
    window.clearTimeout(timer.current);
    if (delay) timer.current = window.setTimeout(() => setShown(true), TOOLTIP_DELAYS[delay]);
    else setShown(true);
  };
  const hide = () => {
    window.clearTimeout(timer.current);
    setShown(false);
    setPlace(undefined);
  };
  return (
    <span
      ref={anchor}
      className={block ? 'atlTooltipAnchor atlTooltipAnchor--block' : 'atlTooltipAnchor'}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {anchored}
      {drawn && (
        <Portal>
          <div
            ref={box}
            id={id}
            className={cx('atlTooltip', 'atlMaterial', className)}
            role="tooltip"
            data-test-subj={testId}
            style={{ left: place?.left ?? -9999, top: place?.top ?? -9999 }}
          >
            {content}
          </div>
        </Portal>
      )}
    </span>
  );
}

/** Copies text and says so */
export function copyText(text: string, what = 'Copied') {
  const done = () => services.toasts.success(what);
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
  } else {
    fallbackCopy(text, done);
  }
}

function fallbackCopy(text: string, done: () => void) {
  const area = document.createElement('textarea');
  area.value = text;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  try {
    document.execCommand('copy');
    done();
  } catch {
    services.toasts.warning('The browser did not allow copying');
  }
  area.remove();
}

/** Hands the browser a file to save */
export function downloadFile(name: string, content: string | Blob, type = 'text/plain') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

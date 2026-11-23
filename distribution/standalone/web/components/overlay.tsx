/* SPDX-License-Identifier: Apache-2.0 */

/* What sits over the page: popovers and menus, dialogs, side panels and the messages in the corner. */

import {
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
import { services } from '../services';
import type { Toast } from '../services/toasts';
import { Button, CallOut, CodeBlock, IconButton, cx } from './basic';
import { Icon, type IconName } from './icon';
import { createLayerStack, isTextField, tabbablesIn, wrapTab } from './layers';

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
  className?: string;
  /** How the span around the button is laid out */
  anchorStyle?: CSSProperties;
  anchorClassName?: string;
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
  className,
  anchorStyle,
  anchorClassName,
  above: preferAbove = false,
  ownFocus,
  initialFocus,
  ariaLabel,
}: PopoverProps) {
  const anchor = useRef<HTMLSpanElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>(UNPLACED);
  const [placement, setPlacement] = useState<'top' | 'bottom'>('bottom');
  const own = ownFocus ?? !(matchWidth || fitWidth);
  const announcement = useId();
  const opener = useRef<HTMLElement | null>(null);

  const place = useCallback(() => {
    const anchorBox = anchor.current?.getBoundingClientRect();
    const panelElement = panel.current;
    if (!anchorBox || !panelElement) return;
    // Its size as laid out, which the opening animation's scale does not change
    const panelBox = { width: panelElement.offsetWidth, height: panelElement.offsetHeight };
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
  }, [align, side, matchWidth, fitWidth, width, offset, buffer, preferAbove]);

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
            className={cx('atlPopover', 'atlMaterial', padded && 'atlPopover--padded', className)}
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
  useEffect(() => {
    const first = box.current?.querySelector<HTMLElement>(
      'input:not([type=hidden]), textarea, select, [data-autofocus]'
    );
    (first ?? box.current)?.focus();
  }, []);
  return (
    <Portal>
      <div
        className="atlScrim"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <div
          ref={box}
          className={cx('atlModal', wide && 'atlModal--wide', className)}
          role="dialog"
          aria-modal="true"
          tabIndex={-1}
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
}: {
  title: ReactNode;
  children?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      testId="confirmModal"
      footer={
        <>
          <Button variant="empty" onClick={onCancel} testId="confirmModalCancelButton">
            {cancelLabel}
          </Button>
          <Button
            variant={danger ? 'dangerFill' : 'primary'}
            onClick={onConfirm}
            loading={busy}
            data-autofocus
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
  // As the original's flyout, which holds the focus: the first thing in it that takes the focus
  // has it when it opens (its close button), unless something in it took it already (a field's
  // autoFocus); Tab goes round what it holds; and when it closes, the focus goes back to what had
  // it before
  useEffect(() => {
    const element = panel.current;
    if (!element) return undefined;
    const active = document.activeElement;
    const opener = active instanceof HTMLElement && active !== document.body && !element.contains(active) ? active : null;
    if (!element.contains(active)) (tabbablesIn(element)[0] ?? element).focus({ preventScroll: true });
    return () => {
      const now = document.activeElement;
      if ((!now || now === document.body) && opener?.isConnected) opener.focus({ preventScroll: true });
    };
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
                <div key={toast.id} className={`atlToast atlMaterial atlToast--${toast.kind}`}>
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
   * Where it is drawn, as the original's `position`: above its anchor or under it, on the other
   * side when there is no room, or on its right
   */
  position?: 'top' | 'bottom' | 'right';
  /** Shown after the original's delay; at once when left out */
  delay?: keyof typeof TOOLTIP_DELAYS;
}) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number }>();
  const box = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useLayoutEffect(() => {
    if (!shown || !anchor.current || !box.current) return;
    const target = anchor.current.getBoundingClientRect();
    const own = box.current.getBoundingClientRect();
    if (position === 'right' && target.right + 16 + own.width <= window.innerWidth - 8) {
      setPlace({ left: target.right + 16, top: Math.max(8, target.top + target.height / 2 - own.height / 2) });
      return;
    }
    const left = Math.max(8, Math.min(target.left + target.width / 2 - own.width / 2, window.innerWidth - own.width - 8));
    // 16 px from its anchor, as the original's, on the side asked unless there is no room
    const above = target.top - own.height - 16;
    const below = target.bottom + 16;
    const fitsBelow = below + own.height <= window.innerHeight - 8;
    const top = position === 'bottom' ? (fitsBelow || above < 8 ? below : above) : above >= 8 ? above : below;
    setPlace({ left, top });
  }, [shown, content, position]);
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
      {children}
      {shown && (
        <Portal>
          <div
            ref={box}
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

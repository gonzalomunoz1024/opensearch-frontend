/* SPDX-License-Identifier: Apache-2.0 */

/* What sits over the page: popovers and menus, dialogs, side panels and the messages in the corner. */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { services } from '../services';
import type { Toast } from '../services/toasts';
import { Button, CallOut, CodeBlock, IconButton, cx } from './basic';
import { Icon, type IconName } from './icon';

export function Portal({ children }: { children: ReactNode }) {
  return createPortal(children, document.body);
}

export interface PopoverProps {
  /** What opens it; it is given the place the popover hangs from */
  button: ReactNode;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  align?: 'left' | 'right';
  padded?: boolean;
  /** As wide as its button at least: a list under a field */
  matchWidth?: boolean;
  width?: number;
  className?: string;
  /** How the span around the button is laid out */
  anchorStyle?: CSSProperties;
  anchorClassName?: string;
}

export function Popover({
  button,
  open,
  onClose,
  children,
  align = 'left',
  padded,
  matchWidth,
  width,
  className,
  anchorStyle,
  anchorClassName,
}: PopoverProps) {
  const anchor = useRef<HTMLSpanElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden' });

  const place = useCallback(() => {
    const anchorBox = anchor.current?.getBoundingClientRect();
    const panelBox = panel.current?.getBoundingClientRect();
    if (!anchorBox || !panelBox) return;
    const margin = 8;
    const panelWidth = Math.max(panelBox.width, matchWidth ? anchorBox.width : 0);
    let left = align === 'right' ? anchorBox.right - panelWidth : anchorBox.left;
    left = Math.max(margin, Math.min(left, window.innerWidth - panelWidth - margin));
    const below = window.innerHeight - anchorBox.bottom - margin;
    const above = anchorBox.top - margin;
    const fitsBelow = panelBox.height + 4 <= below || below >= above;
    const next: CSSProperties = {
      left,
      minWidth: matchWidth ? anchorBox.width : undefined,
      width,
      maxHeight: Math.max(120, (fitsBelow ? below : above) - 4),
    };
    if (fitsBelow) next.top = anchorBox.bottom + 4;
    else next.bottom = window.innerHeight - anchorBox.top + 4;
    setStyle(next);
  }, [align, matchWidth, width]);

  useLayoutEffect(() => {
    if (!open) {
      setStyle({ visibility: 'hidden' });
      return undefined;
    }
    place();
    const observer = new ResizeObserver(place);
    if (panel.current) observer.observe(panel.current);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
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
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

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
            data-popover-depth={depthOf(anchor.current) + 1}
          >
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

function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
}

export function Modal({
  title,
  children,
  footer,
  onClose,
  wide,
  testId,
  className,
}: {
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  wide?: boolean;
  testId?: string;
  className?: string;
}) {
  useEscape(onClose);
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
            <h2 className="atlTitleM">{title}</h2>
            <IconButton icon="cross" label="Close" onClick={onClose} />
          </div>
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
  useEscape(onClose);
  return (
    <Portal>
      {mask && <div className="atlFlyoutMask" onMouseDown={onClose} />}
      <aside
        className={cx('atlFlyout', wide && 'atlFlyout--wide', className)}
        role="dialog"
        data-test-subj={testId}
      >
        <div className="atlFlyout__header">
          <h2 className="atlTitleM atlTruncate">{title}</h2>
          {!hideClose && <IconButton icon="cross" label="Close" onClick={onClose} testId="flyoutCloseButton" />}
        </div>
        <div className="atlFlyout__body">{children}</div>
        {footer && <div className="atlFlyout__footer">{footer}</div>}
      </aside>
    </Portal>
  );
}

// The original's icons: a check, an i, a question mark in a ring, and a triangle for what failed
const TOAST_ICONS: Record<string, IconName> = {
  healthy: 'check',
  info: 'info',
  warning: 'help',
  critical: 'warning',
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
            {items.map((toast) => (
              <div key={toast.id} className={`atlToast atlMaterial atlToast--${toast.kind}`}>
                <div className="atlToast__header">
                  <Icon name={TOAST_ICONS[toast.kind]} />
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
            ))}
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
      <CallOut tone="critical" title={error.message} />
      {text && <CopyableCode>{text}</CopyableCode>}
    </Modal>
  );
}

/** Code in a box, with a button that copies it */
export function CopyableCode({ children }: { children: string }) {
  return (
    <div className="atlCodeCopy">
      <CodeBlock>{children}</CodeBlock>
      <IconButton icon="copy" label="Copy" size="s" onClick={() => copyText(children)} />
    </div>
  );
}

/** A short text shown over what the pointer or the focus is on */
export function Tooltip({ content, children, testId }: { content: ReactNode; children: ReactNode; testId?: string }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number }>();
  const box = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useLayoutEffect(() => {
    if (!shown || !anchor.current || !box.current) return;
    const target = anchor.current.getBoundingClientRect();
    const own = box.current.getBoundingClientRect();
    const left = Math.max(8, Math.min(target.left + target.width / 2 - own.width / 2, window.innerWidth - own.width - 8));
    // Above, as the original's, unless there is no room
    const top = target.top - own.height - 8 >= 8 ? target.top - own.height - 8 : target.bottom + 8;
    setPlace({ left, top });
  }, [shown, content]);
  return (
    <span
      ref={anchor}
      className="atlTooltipAnchor"
      onMouseEnter={() => setShown(true)}
      onMouseLeave={() => {
        setShown(false);
        setPlace(undefined);
      }}
      onFocus={() => setShown(true)}
      onBlur={() => {
        setShown(false);
        setPlace(undefined);
      }}
    >
      {children}
      {shown && (
        <Portal>
          <div
            ref={box}
            className="atlTooltip atlMaterial"
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

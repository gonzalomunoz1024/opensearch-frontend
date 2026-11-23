/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The navigation at the left, as the original's collapsible navigation: the pages viewed lately,
 * the applications in their groups, and the button that docks it beside the page. Over the page
 * it lies behind a mask and holds the focus until it closes; docked it is part of the page.
 */

import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { cx } from '../components/basic';
import { tabbablesIn, wrapTab } from '../components/layers';
import { useLayer } from '../components/overlay';
import { isModifiedClick, isNavGroupOpen, navGroupKey } from './chrome_layout';
import { HeaderIcon } from './header_icon';

export interface NavLinkItem {
  id: string;
  label: string;
  /** Where it leads, as the address the browser opens */
  href: string;
  /** The application that is open */
  active?: boolean;
}

export interface NavGroupItem {
  /** The original's id of the category: its test subject, and the key its state is kept under */
  id: string;
  label: string;
  /** Drawn before the label, 24 pixels */
  icon?: ReactNode;
  links: NavLinkItem[];
}

export interface RecentLinkItem {
  id: string;
  label: string;
  href: string;
  /** Its name and the kind of page, as it is read out and shown on hover */
  title: string;
}

function readGroupOpen(id: string): boolean {
  try {
    return isNavGroupOpen(window.localStorage.getItem(navGroupKey(id)));
  } catch {
    return true;
  }
}

function writeGroupOpen(id: string, open: boolean) {
  try {
    window.localStorage.setItem(navGroupKey(id), String(open));
  } catch {
    // kept for this visit only
  }
}

/**
 * A group that opens and closes under its heading, as the original's EuiCollapsibleNavGroup: what
 * it holds stays in the page while it is closed, hidden, and whether it is open is remembered
 */
function NavGroup({
  id,
  title,
  icon,
  light,
  children,
}: {
  id: string;
  title: string;
  icon?: ReactNode;
  /** The group on the lighter ground, as the original's "Recently viewed" */
  light?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(() => readGroupOpen(id));
  const buttonId = useId();
  const regionId = useId();
  return (
    <div
      className={cx('shlNavGroup', 'shlNavGroup--withHeading', light && 'shlNavGroup--light', open && 'shlNavGroup--open')}
      data-test-subj={`collapsibleNavGroup-${id}`}
    >
      <div className="shlNavGroup__trigger">
        <button
          id={buttonId}
          type="button"
          className="shlNavGroup__heading"
          aria-expanded={open}
          aria-controls={regionId}
          onClick={() => {
            writeGroupOpen(id, !open);
            setOpen(!open);
          }}
        >
          <span className="shlNavGroup__arrowBox">
            <HeaderIcon name="chevronRight" className="shlNavGroup__arrow" />
          </span>
          <span className="shlNavGroup__headingContent">
            {icon !== undefined && <span className="shlNavGroup__icon">{icon}</span>}
            <h3 id={`${regionId}__title`} className="shlNavGroup__title">
              {title}
            </h3>
          </span>
        </button>
      </div>
      <div id={regionId} className="shlNavGroup__region" role="region" tabIndex={-1} aria-labelledby={buttonId}>
        <div className="shlNavGroup__regionContent">
          <div className="shlNavGroup__children">{children}</div>
        </div>
      </div>
    </div>
  );
}

export interface NavigationProps {
  id: string;
  /** Beside the page; else over it behind a mask */
  docked: boolean;
  /** Whether it is set to dock: what the button that docks says */
  locked: boolean;
  /** The window is wide enough to dock, so the button that docks is shown */
  canDock: boolean;
  recent: RecentLinkItem[];
  groups: NavGroupItem[];
  /** Closes it where it lies over the page, and gives the focus back to the menu button */
  onClose: () => void;
  onLockedChange: (locked: boolean) => void;
}

export function Navigation({ id, docked, locked, canDock, recent, groups, onClose, onLockedChange }: NavigationProps) {
  const nav = useRef<HTMLElement>(null);
  const lock = useRef<HTMLButtonElement>(null);
  const overlay = !docked;

  // Over the page it is a layer: Escape closes it while nothing lies over it
  useLayer(overlay, onClose);

  // Over the page it takes the focus as it appears, as the original's focus trap: its first stop,
  // the button that closes it. The page behind does not scroll. When it goes, the focus goes back
  // to what had it, if nothing took it meanwhile.
  useEffect(() => {
    const element = nav.current;
    if (!overlay || !element) return undefined;
    const active = document.activeElement;
    const opener = active instanceof HTMLElement && active !== document.body && !element.contains(active) ? active : null;
    (tabbablesIn(element)[0] ?? element).focus({ preventScroll: true });
    document.body.classList.add('shlBody--masked');
    return () => {
      document.body.classList.remove('shlBody--masked');
      const now = document.activeElement;
      if ((!now || now === document.body) && opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [overlay]);

  // Tab goes round what the navigation holds while it lies over the page
  const holdTab = (event: ReactKeyboardEvent<HTMLElement>) => {
    const element = nav.current;
    if (!overlay || event.key !== 'Tab' || event.defaultPrevented || !element) return;
    const target = wrapTab(tabbablesIn(element), document.activeElement as HTMLElement | null, event.shiftKey);
    if (!target) return;
    event.preventDefault();
    target.focus();
  };

  // A link closes the navigation and then leads where it leads; a click the browser handles
  // itself (a new tab) leaves the navigation as it is
  const follow = (event: ReactMouseEvent<HTMLAnchorElement>) => {
    if (!isModifiedClick(event)) onClose();
  };

  const lockLabel = locked ? 'Undock navigation' : 'Dock navigation';

  const panel = (
    <nav
      ref={nav}
      id={id}
      className={cx('shlNav', docked && 'shlNav--docked')}
      aria-label="Primary"
      tabIndex={-1}
      onKeyDown={holdTab}
      data-test-subj="collapsibleNav"
    >
      {overlay && (
        <button
          type="button"
          className="shlNav__close"
          aria-label="Close this dialog"
          onClick={onClose}
          data-test-subj="euiFlyoutCloseButton"
        >
          <HeaderIcon name="cross" className="shlNav__closeIcon" />
        </button>
      )}

      <NavGroup id="recentlyViewed" title="Recently viewed" light>
        {recent.length > 0 ? (
          <ul className="shlNavList shlNavList--recents" aria-label="Recently viewed links">
            {recent.map((item) => (
              <li key={item.id} className="shlNavItem">
                <a
                  className="shlNavItem__button"
                  href={item.href}
                  rel="noreferrer"
                  title={item.title}
                  aria-label={item.title}
                  onClick={follow}
                  data-test-subj="collapsibleNavAppLink--recent"
                >
                  <span className="shlNavItem__label" title={item.label}>
                    {item.label}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <div className="shlNav__empty">
            <p>No recently viewed items</p>
          </div>
        )}
      </NavGroup>

      <hr className="shlNav__rule" />

      <div className="shlNav__scroll">
        {groups.map((group) => (
          <NavGroup key={group.id} id={group.id} title={group.label} icon={group.icon}>
            <ul className="shlNavList" aria-label={`Primary navigation links, ${group.label}`}>
              {group.links.map((link) => (
                <li key={link.id} className={cx('shlNavItem', link.active && 'shlNavItem--active')}>
                  <a
                    className="shlNavItem__button"
                    href={link.href}
                    rel="noreferrer"
                    onClick={follow}
                    data-test-subj="collapsibleNavAppLink"
                  >
                    <span className="shlNavItem__label" title={link.label}>
                      {link.label}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </NavGroup>
        ))}

        {/* The button that docks it, only in a window wide enough to dock in */}
        {canDock && (
          <div className="shlNavGroup">
            <div className="shlNavGroup__children">
              <ul className="shlNavList shlNavList--flush">
                <li className="shlNavItem shlNavItem--xSmall">
                  <button
                    ref={lock}
                    type="button"
                    className="shlNavItem__button"
                    aria-label={locked ? 'Undock primary navigation' : 'Dock primary navigation'}
                    onClick={() => {
                      onLockedChange(!locked);
                      lock.current?.focus();
                    }}
                    data-test-subj="collapsible-nav-lock"
                  >
                    <HeaderIcon name={locked ? 'lock' : 'lockOpen'} className="shlNavItem__icon" />
                    <span className="shlNavItem__label" title={lockLabel}>
                      {lockLabel}
                    </span>
                  </button>
                </li>
              </ul>
            </div>
          </div>
        )}
      </div>
    </nav>
  );

  if (docked) return panel;
  return createPortal(
    // A press on the mask itself, beside the navigation, closes it
    <div
      className="shlNavMask"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {panel}
    </div>,
    document.body
  );
}

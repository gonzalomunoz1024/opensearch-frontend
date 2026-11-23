/* SPDX-License-Identifier: Apache-2.0 */

/* The frame around every page: the header with its trail and actions, and the navigation. */

import {
  Fragment,
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Button, cx } from '../components/basic';
import { Icon, type IconName } from '../components/icon';
import type { AppLocation } from '../lib/url';
import { href, useLocation } from '../router';
import { services } from '../services';
import {
  NAV_LOCKED_KEY,
  TRACKED_APPS,
  canDock,
  helpExtensionOf,
  isEmbedParamInHash,
  isUnderPath,
  navMode,
  recentLinkTitle,
  trackedAppLink,
  trackedUrlKey,
} from './chrome_layout';
import { HeaderBreadcrumbs, useBreadcrumbLimit } from './header_breadcrumbs';
import { HeaderIcon } from './header_icon';
import { HeaderTooltip } from './header_popover';
import { HelpMenu } from './help_menu';
import { countRequests, useLoadingCount } from './loading_count';
import { Navigation, type NavGroupItem, type RecentLinkItem } from './navigation';
import { currentGlobalParam, useChromeState, useRecentlyAccessed, type RecentItem } from './state';
import { UserBannerList } from './user_banner';
import '../styles/shell.css';
import '../styles/chrome.css';

interface NavApp {
  /** The application's id in the original: what its link to itself is tracked under */
  id: string;
  label: string;
  /** The path of the application */
  path: string;
  /** What its link adds to the path */
  subUrl?: string;
  /** Other paths that are this application too */
  also?: string[];
}

interface NavCategory {
  /** The original's id of the category */
  id: string;
  label: string;
  icon?: IconName | 'logo';
  apps: NavApp[];
}

/** The applications of the navigation in their groups, in the original's order */
export function navCategories(): NavCategory[] {
  return [
    {
      id: 'opensearchDashboards',
      // The product's choice: its own name where the original says "OpenSearch Dashboards"
      label: services.boot.name,
      icon: 'logo',
      apps: [
        { id: 'opensearch_dashboards_overview', label: 'Overview', path: '/app/opensearch_dashboards_overview' },
        { id: 'discover', label: 'Discover', path: '/app/discover', subUrl: '#/', also: ['/app/data-explorer'] },
        { id: 'dashboards', label: 'Dashboards', path: '/app/dashboards' },
        { id: 'visualize', label: 'Visualize', path: '/app/visualize' },
      ],
    },
    {
      id: 'opensearch',
      label: 'OpenSearch Plugins',
      apps: [{ id: 'opensearch-query-workbench', label: 'Query Workbench', path: '/app/opensearch-query-workbench' }],
    },
    {
      id: 'management',
      label: 'Management',
      icon: 'managementApp',
      apps: [
        { id: 'opensearch_management_overview', label: 'Overview', path: '/app/opensearch_management_overview' },
        {
          id: 'opensearch_index_management_dashboards',
          label: 'Index Management',
          path: '/app/opensearch_index_management_dashboards',
        },
        {
          id: 'opensearch_snapshot_management_dashboards',
          label: 'Snapshot Management',
          path: '/app/opensearch_snapshot_management_dashboards',
        },
        // Not marked on the short address /app/settings: there the original's application is
        // "settings", which has no link of its own
        { id: 'management', label: 'Dashboards Management', path: '/app/management' },
        { id: 'dev_tools', label: 'Dev Tools', path: '/app/dev_tools' },
      ],
    },
  ];
}

function readSession(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Where an application's link leads. Dashboards and Visualize go back to where they were left,
 * as the original's URL trackers have it: the place is kept for the session under the original's
 * key, and the link carries the time range of now.
 */
function appHref(app: NavApp, pathname: string): string {
  const tracked = TRACKED_APPS[app.id];
  if (!tracked) return href(`${app.path}${app.subUrl ?? ''}`);
  return href(
    trackedAppLink(tracked, {
      current: isUnderPath(pathname, tracked.base),
      stored: readSession(trackedUrlKey(services.boot.basePath, tracked)),
      globalParam: currentGlobalParam(),
    })
  );
}

/** Keeps where Dashboards and Visualize are, for their links from elsewhere */
function useTrackedAddresses(location: AppLocation) {
  useEffect(() => {
    for (const app of Object.values(TRACKED_APPS)) {
      if (!isUnderPath(location.pathname, app.base)) continue;
      try {
        window.sessionStorage.setItem(
          trackedUrlKey(services.boot.basePath, app),
          window.location.hash || app.defaultSubUrl
        );
      } catch {
        // the link then leads to the application's first page
      }
    }
  }, [location]);
}

function navGroupsOf(categories: NavCategory[], pathname: string): NavGroupItem[] {
  return categories.map((category) => ({
    id: category.id,
    label: category.label,
    icon:
      category.icon === 'logo' ? (
        <img src={href('/logo.svg')} width={24} height={24} alt="" />
      ) : category.icon ? (
        <Icon name={category.icon} size="l" app />
      ) : undefined,
    links: category.apps.map((app) => ({
      id: app.id,
      label: app.label,
      href: appHref(app, pathname),
      active: [app.path, ...(app.also ?? [])].some((path) => isUnderPath(pathname, path)),
    })),
  }));
}

function recentLinksOf(recent: RecentItem[], categories: NavCategory[]): RecentLinkItem[] {
  const targets = categories.flatMap((category) => category.apps.map((app) => ({ path: app.path, title: app.label })));
  return recent.map((item) => ({
    id: item.id,
    label: item.label,
    href: href(item.link),
    title: recentLinkTitle(item.label, item.link, targets),
  }));
}

function readNavLocked(): boolean {
  try {
    return window.localStorage.getItem(NAV_LOCKED_KEY) === 'true';
  } catch {
    return false;
  }
}

function writeNavLocked(locked: boolean) {
  try {
    window.localStorage.setItem(NAV_LOCKED_KEY, String(locked));
  } catch {
    // kept for this visit only
  }
}

/** Whether the window is wide enough to dock the navigation in, as it changes */
function useCanDock(): boolean {
  const [wide, setWide] = useState(() => canDock(window.innerWidth));
  useEffect(() => {
    const onResize = () => setWide(canDock(window.innerWidth));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return wide;
}

const ActionsContext = createContext<HTMLElement | null>(null);

/** Draws its children in the header, at the right: a page's own actions */
export function HeaderActions({ children }: { children: ReactNode }) {
  const node = useContext(ActionsContext);
  return node ? createPortal(children, node) : null;
}

export interface TopNavItem {
  id: string;
  label: string;
  onClick?: () => void;
  to?: string;
  icon?: IconName;
  /** Drawn as a button, not a link: the page's main action */
  emphasize?: boolean;
  disabled?: boolean;
  title?: string;
  testId?: string;
  /** What the button is put in: a popover it opens under itself, as the original's Options */
  wrap?: (button: ReactNode) => ReactNode;
  /**
   * The widths of the window it is not shown at, by the component library's breakpoints, as the
   * original's `eui-hideFor--s eui-hideFor--xs` on a dashboard's Edit
   */
  hideFor?: Array<'xs' | 's' | 'm'>;
}

/** A page's actions as the header's row of links, as the original's top navigation menu */
export function TopNav({ items }: { items: TopNavItem[] }) {
  if (items.length === 0) return null;
  return (
    <HeaderActions>
      <nav className="shlTopNav" aria-label="App navigation" data-test-subj="top-nav">
        <div className="shlTopNav__list">
          {items.map((item) => {
            const button = (
              <Button
                key={item.id}
                variant={item.emphasize ? 'default' : 'empty'}
                icon={item.icon}
                onClick={item.onClick}
                to={item.to}
                disabled={item.disabled}
                title={item.title}
                testId={item.testId ?? `topNav-${item.id}`}
                className={
                  item.hideFor?.map((size) => `shlTopNav__item--hideFor-${size}`).join(' ') || undefined
                }
              >
                {item.label}
              </Button>
            );
            return item.wrap ? <Fragment key={item.id}>{item.wrap(button)}</Fragment> : button;
          })}
        </div>
      </nav>
    </HeaderActions>
  );
}

/**
 * The link home, as the original's HomeLoader: the product's mark, and in its place a spinner
 * for as long as a request is under way
 */
function HomeLink() {
  const loading = useLoadingCount() > 0;
  return (
    <HeaderTooltip content="Go to home page" delay="long">
      <a
        className="shlHeader__button shlHeader__home"
        href={href('/app/home')}
        rel="noreferrer"
        aria-label="Go to home page"
        data-test-subj="homeLoader"
      >
        <span className="shlHeader__homeContent">
          {!loading && (
            <span className="shlHeader__homeIcon">
              <img
                src={href('/logo.svg')}
                width={24}
                height={24}
                alt={`${services.boot.name} home`}
                data-test-subj="defaultMark"
              />
            </span>
          )}
          <span className="shlHeader__loader">
            <LoadingSpinner loading={loading} />
          </span>
        </span>
      </a>
    </HeaderTooltip>
  );
}

function LoadingSpinner({ loading }: { loading: boolean }) {
  return (
    <span
      className={cx('atlSpinner', !loading && 'shlHeader__spinner--hidden')}
      data-test-subj={loading ? 'globalLoadingIndicator' : 'globalLoadingIndicator-hidden'}
      aria-hidden={!loading}
      aria-label="Loading content"
    />
  );
}

/** What a page that hides the header shows while a request is under way: a bar across the top */
function LoadingBar() {
  const loading = useLoadingCount() > 0;
  return (
    <div
      className={cx('shlLoadingBar', !loading && 'shlLoadingBar--hidden')}
      data-test-subj={loading ? 'globalLoadingIndicator' : 'globalLoadingIndicator-hidden'}
      aria-hidden={!loading}
      aria-label="Loading content"
    />
  );
}

export function Chrome({ children }: { children: ReactNode }) {
  const { breadcrumbs, fullScreen } = useChromeState();
  // Whether the navigation is set to dock, kept as the original keeps it, and whether the menu
  // button has it open: the two are apart, as in the original's header
  const [locked, setLocked] = useState(readNavLocked);
  const [open, setOpen] = useState(false);
  const [actions, setActions] = useState<HTMLElement | null>(null);
  const location = useLocation();
  const wide = useCanDock();
  const crumbLimit = useBreadcrumbLimit();
  const recent = useRecentlyAccessed();
  const navId = useId();
  const menuButton = useRef<HTMLButtonElement>(null);
  // A page embedded in another shows neither the header nor the navigation, as long as it is
  // loaded: the original reads its address once, when it starts
  const [embedded] = useState(() => isEmbedParamInHash(window.location.hash));
  // A page that hides the header hides the navigation with it
  const chromeHidden = fullScreen || embedded;
  const mode = chromeHidden ? 'hidden' : navMode({ locked, open, canDock: wide });
  // Every request counts toward the home link's spinner, from the first a page makes
  useState(() => countRequests(services.http));
  useTrackedAddresses(location);

  const categories = navCategories();
  const closeNav = () => {
    setOpen(false);
    menuButton.current?.focus();
  };

  // The dock button keeps the focus, as the original means it to, unless the navigation it was in
  // went away: then the menu button has it. The original lets it drop to the page there.
  const refocus = useRef<'lock' | 'menu' | undefined>(undefined);
  useEffect(() => {
    const target = refocus.current;
    refocus.current = undefined;
    const active = document.activeElement;
    // Something took the focus already: what the original gives it to
    if (!target || (active && active !== document.body)) return;
    if (target === 'menu') menuButton.current?.focus();
    else document.getElementById(navId)?.querySelector<HTMLElement>('[data-test-subj="collapsible-nav-lock"]')?.focus();
  }, [mode, navId]);

  return (
    <ActionsContext.Provider value={actions}>
      <div
        className={cx('shlApp', mode === 'docked' && 'shlApp--docked', chromeHidden && 'shlApp--chromeHidden')}
        // While the navigation lies over the page, the page is not there for a screen reader
        aria-hidden={mode === 'overlay' ? true : undefined}
      >
        {chromeHidden ? (
          <LoadingBar />
        ) : (
          <header className="shlHeader" data-test-subj="headerGlobalNav">
            <div className="shlHeader__section shlHeader__section--left">
              <div className="shlHeader__item">
                <button
                  ref={menuButton}
                  type="button"
                  className="shlHeader__button"
                  aria-label="Toggle primary navigation"
                  aria-expanded={open}
                  aria-pressed={open}
                  aria-controls={navId}
                  onClick={() => setOpen(!open)}
                  data-test-subj="toggleNavButton"
                >
                  <HeaderIcon name="menu" className="shlHeader__icon" title="Menu" />
                </button>
              </div>
              <div className="shlHeader__item">
                <HomeLink />
              </div>
            </div>
            <HeaderBreadcrumbs breadcrumbs={breadcrumbs} limit={crumbLimit} />
            <div className="shlHeader__section shlHeader__section--right">
              <div className="shlHeader__item">
                <div className="shlHeader__actions" data-test-subj="headerAppActionMenu" ref={setActions} />
              </div>
              <div className="shlHeader__item">
                <HelpMenu version={services.boot.version} extension={helpExtensionOf(location.pathname)} />
              </div>
            </div>
          </header>
        )}
        {mode !== 'hidden' && (
          <Navigation
            id={navId}
            docked={mode === 'docked'}
            locked={locked}
            canDock={wide}
            recent={recentLinksOf(recent, categories)}
            groups={navGroupsOf(categories, location.pathname)}
            onClose={closeNav}
            onLockedChange={(next) => {
              writeNavLocked(next);
              setLocked(next);
              refocus.current = next || open ? 'lock' : 'menu';
            }}
          />
        )}
        {/* A plain box, as the original's #app-wrapper: an application has its own main landmark */}
        <div className="shlMain" id="app-wrapper">
          <UserBannerList />
          {children}
        </div>
      </div>
    </ActionsContext.Provider>
  );
}

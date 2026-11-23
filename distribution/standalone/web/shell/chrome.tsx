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
import { appUrl } from '../lib/url';
import { href, useLocation } from '../router';
import { services } from '../services';
import { helpExtensionOf } from './chrome_layout';
import { HeaderBreadcrumbs, useBreadcrumbLimit } from './header_breadcrumbs';
import { HeaderIcon } from './header_icon';
import { HeaderTooltip } from './header_popover';
import { HelpMenu } from './help_menu';
import { countRequests, useLoadingCount } from './loading_count';
import {
  currentGlobalParam,
  readStored,
  useChromeState,
  useRecentlyAccessed,
  writeStored,
} from './state';
import { UserBannerList } from './user_banner';
import '../styles/shell.css';
import '../styles/chrome.css';

interface NavLink {
  id: string;
  label: string;
  /** The path of the application */
  path: string;
  /** Other paths that are this application too */
  also?: string[];
  /** The time range follows to this page */
  carriesTime?: boolean;
}

interface NavGroup {
  id: string;
  label: string;
  icon?: IconName | 'logo';
  links: NavLink[];
}

export function navGroups(): NavGroup[] {
  return [
    {
      id: 'product',
      label: services.boot.name,
      icon: 'logo',
      links: [
        { id: 'overview', label: 'Overview', path: '/app/opensearch_dashboards_overview' },
        {
          id: 'discover',
          label: 'Discover',
          path: '/app/discover',
          also: ['/app/data-explorer/discover', '/app/data-explorer'],
          carriesTime: true,
        },
        { id: 'dashboards', label: 'Dashboards', path: '/app/dashboards', carriesTime: true },
        { id: 'visualize', label: 'Visualize', path: '/app/visualize', carriesTime: true },
      ],
    },
    {
      id: 'plugins',
      label: 'OpenSearch Plugins',
      links: [
        { id: 'queryWorkbench', label: 'Query Workbench', path: '/app/opensearch-query-workbench' },
      ],
    },
    {
      id: 'management',
      label: 'Management',
      icon: 'managementApp',
      links: [
        { id: 'managementOverview', label: 'Overview', path: '/app/opensearch_management_overview' },
        {
          id: 'indexManagement',
          label: 'Index Management',
          path: '/app/opensearch_index_management_dashboards',
        },
        {
          id: 'snapshotManagement',
          label: 'Snapshot Management',
          path: '/app/opensearch_snapshot_management_dashboards',
        },
        {
          id: 'management',
          label: 'Dashboards Management',
          path: '/app/management',
          also: ['/app/objects', '/app/indexPatterns', '/app/settings'],
        },
        { id: 'devTools', label: 'Dev Tools', path: '/app/dev_tools' },
      ],
    },
  ];
}

const isActive = (link: NavLink, pathname: string) =>
  [link.path, ...(link.also ?? [])].some(
    (path) => pathname === path || pathname.startsWith(`${path}/`)
  );

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

function Logo({ size = 24 }: { size?: number }) {
  return <img src={href('/logo.svg')} width={size} height={size} alt="" />;
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

function Navigation({
  id,
  docked,
  onDock,
  onClose,
}: {
  id: string;
  docked: boolean;
  onDock: () => void;
  onClose: () => void;
}) {
  const location = useLocation();
  const recent = useRecentlyAccessed();
  const [closed, setClosed] = useState<Record<string, boolean>>(() => readStored('navClosed', {}));
  const toggle = (id: string) => {
    const next = { ...closed, [id]: !closed[id] };
    setClosed(next);
    writeStored('navClosed', next);
  };
  const follow = () => {
    if (!docked) onClose();
  };

  const section = (id: string, label: string, icon: ReactNode, body: ReactNode) => (
    <section className="shlNav__group" key={id}>
      <button type="button" className="shlNav__groupTitle" aria-expanded={!closed[id]} onClick={() => toggle(id)}>
        {icon}
        <span className="atlGrow">{label}</span>
        {/* The original's arrow of an accordion: pointing right, turned down while open */}
        <Icon name="chevronRight" className="shlNav__arrow" />
      </button>
      {!closed[id] && <div className="shlNav__links">{body}</div>}
    </section>
  );

  return (
    <nav id={id} className={cx('shlNav', docked && 'shlNav--docked')} aria-label="Primary" data-test-subj="collapsibleNav">
      <div className="shlNav__scroll">
        {section(
          'recent',
          'Recently viewed',
          null,
          recent.length === 0 ? (
            <span className="shlNav__empty">No recently viewed items</span>
          ) : (
            recent.map((item) => (
              <a key={item.id} className="shlNav__link" href={href(item.link)} onClick={follow} title={item.label}>
                <span className="atlTruncate">{item.label}</span>
              </a>
            ))
          )
        )}
        {navGroups().map((group) =>
          section(
            group.id,
            group.label,
            group.icon === 'logo' ? <Logo /> : group.icon ? <Icon name={group.icon} size="l" app /> : null,
            group.links.map((link) => (
              <a
                key={link.id}
                className="shlNav__link"
                aria-current={isActive(link, location.pathname) ? 'page' : undefined}
                href={href(
                  link.carriesTime ? appUrl(link.path, '/', { _g: currentGlobalParam() }) : link.path
                )}
                onClick={follow}
                data-test-subj={`collapsibleNavAppLink-${link.id}`}
              >
                {link.label}
              </a>
            ))
          )
        )}
      </div>
      <button type="button" className="shlNav__dock" onClick={onDock} data-test-subj="collapsible-nav-lock">
        <Icon name={docked ? 'lock' : 'unlock'} />
        {docked ? 'Undock navigation' : 'Dock navigation'}
      </button>
    </nav>
  );
}

export function Chrome({ children }: { children: ReactNode }) {
  const { breadcrumbs, fullScreen } = useChromeState();
  const [docked, setDocked] = useState<boolean>(() => readStored('navDocked', false));
  const [open, setOpen] = useState(false);
  const [actions, setActions] = useState<HTMLElement | null>(null);
  const location = useLocation();
  const narrow = useNarrow();
  const crumbLimit = useBreadcrumbLimit();
  const navId = useId();
  const menuButton = useRef<HTMLButtonElement>(null);
  const isDocked = docked && !narrow;
  const navShown = !fullScreen && (isDocked || open);
  // Every request counts toward the home link's spinner, from the first a page makes
  useState(() => countRequests(services.http));

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && open) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <ActionsContext.Provider value={actions}>
      <div className={cx('shlApp', isDocked && !fullScreen && 'shlApp--docked', fullScreen && 'shlApp--fullScreen')}>
        {fullScreen ? (
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
                  aria-expanded={navShown}
                  aria-pressed={navShown}
                  aria-controls={navId}
                  onClick={() => (isDocked ? setDocked(false) : setOpen(!open))}
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
        {navShown && (
          <>
            {!isDocked && <div className="shlNav__scrim" onClick={() => setOpen(false)} />}
            <Navigation
              id={navId}
              docked={isDocked}
              onClose={() => setOpen(false)}
              onDock={() => {
                writeStored('navDocked', !docked);
                setDocked(!docked);
                setOpen(false);
              }}
            />
          </>
        )}
        <main className="shlMain" id="app-wrapper">
          <UserBannerList />
          {children}
        </main>
      </div>
    </ActionsContext.Provider>
  );
}

function useNarrow(): boolean {
  const query = '(max-width: 991px)';
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = () => setNarrow(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  return narrow;
}

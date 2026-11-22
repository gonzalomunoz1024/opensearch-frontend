/* SPDX-License-Identifier: Apache-2.0 */

/* The frame around every page: the header with its trail and actions, and the navigation. */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { Button, IconButton, cx } from '../components/basic';
import { Icon, type IconName } from '../components/icon';
import { Popover } from '../components/overlay';
import { appUrl } from '../lib/url';
import { href, useLocation } from '../router';
import { services } from '../services';
import {
  currentGlobalParam,
  readStored,
  useChromeState,
  useRecentlyAccessed,
  writeStored,
} from './state';
import '../styles/shell.css';

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
      icon: 'gear',
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
}

/** A page's actions as the header's row of links */
export function TopNav({ items }: { items: TopNavItem[] }) {
  return (
    <HeaderActions>
      {items.map((item) => (
        <Button
          key={item.id}
          variant={item.emphasize ? 'default' : 'empty'}
          icon={item.icon}
          onClick={item.onClick}
          to={item.to}
          disabled={item.disabled}
          title={item.title}
          testId={item.testId ?? `topNav-${item.id}`}
        >
          {item.label}
        </Button>
      ))}
    </HeaderActions>
  );
}

function Logo({ size = 24 }: { size?: number }) {
  return <img src={href('/logo.svg')} width={size} height={size} alt="" />;
}

function Navigation({ docked, onDock, onClose }: { docked: boolean; onDock: () => void; onClose: () => void }) {
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
        <Icon name={closed[id] ? 'chevronRight' : 'chevronDown'} />
      </button>
      {!closed[id] && <div className="shlNav__links">{body}</div>}
    </section>
  );

  return (
    <nav className={cx('shlNav', docked && 'shlNav--docked')} aria-label="Primary" data-test-subj="collapsibleNav">
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
            group.icon === 'logo' ? <Logo /> : group.icon ? <Icon name={group.icon} size="l" /> : null,
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

function HelpMenu() {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <Popover
      open={open}
      onClose={close}
      align="right"
      padded
      button={<IconButton icon="help" label="Help" onClick={() => setOpen(!open)} testId="helpMenuButton" />}
    >
      <div className="atlStack" style={{ width: 240 }}>
        <div className="atlRow">
          <Logo size={28} />
          <div>
            <div className="atlTitleXxs">{services.boot.name}</div>
            <div className="atlSubdued atlSmall">Version {services.boot.version}</div>
          </div>
        </div>
        <a href="https://opensearch.org/docs/latest/dashboards/" target="_blank" rel="noreferrer">
          OpenSearch Dashboards documentation
        </a>
        <a href="https://opensearch.org/docs/latest/query-dsl/" target="_blank" rel="noreferrer">
          Query DSL reference
        </a>
      </div>
    </Popover>
  );
}

export function Chrome({ children }: { children: ReactNode }) {
  const { breadcrumbs, fullScreen } = useChromeState();
  const [docked, setDocked] = useState<boolean>(() => readStored('navDocked', false));
  const [open, setOpen] = useState(false);
  const [actions, setActions] = useState<HTMLElement | null>(null);
  const location = useLocation();
  const narrow = useNarrow();
  const isDocked = docked && !narrow;
  const navShown = !fullScreen && (isDocked || open);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && open) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // Without a trail the header names the application
  const trail =
    breadcrumbs.length > 0
      ? breadcrumbs
      : [
          {
            text:
              navGroups()
                .flatMap((group) => group.links)
                .find((link) => isActive(link, location.pathname))?.label ?? 'Home',
          },
        ];

  return (
    <ActionsContext.Provider value={actions}>
      <div className={cx('shlApp', isDocked && !fullScreen && 'shlApp--docked', fullScreen && 'shlApp--fullScreen')}>
        {!fullScreen && (
          <header className="shlHeader" data-test-subj="headerGlobalNav">
            <IconButton
              icon="menu"
              label="Toggle primary navigation"
              className="shlHeader__menu"
              aria-expanded={navShown}
              onClick={() => (isDocked ? setDocked(false) : setOpen(!open))}
              testId="toggleNavButton"
            />
            <a className="shlHeader__logo" href={href('/app/home')} aria-label={`${services.boot.name} home`} data-test-subj="logo">
              <Logo />
            </a>
            <nav className="shlHeader__trail" aria-label="Breadcrumbs" data-test-subj="breadcrumbs">
              {trail.map((crumb, index) => {
                const last = index === trail.length - 1;
                return (
                  <span key={`${crumb.text}-${index}`} className={cx('shlCrumb', last && 'shlCrumb--last')}>
                    {index > 0 && <span className="shlCrumb__separator">/</span>}
                    {crumb.to && !last ? (
                      <a href={href(crumb.to)} className="atlTruncate">
                        {crumb.text}
                      </a>
                    ) : (
                      <span className="atlTruncate" data-test-subj={last ? 'breadcrumb last' : undefined}>
                        {crumb.text}
                      </span>
                    )}
                  </span>
                );
              })}
            </nav>
            <div className="shlHeader__actions" ref={setActions} />
            <HelpMenu />
          </header>
        )}
        {navShown && (
          <>
            {!isDocked && <div className="shlNav__scrim" onClick={() => setOpen(false)} />}
            <Navigation
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

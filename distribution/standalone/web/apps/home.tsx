/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The first page, as the home plugin of OpenSearch Dashboards draws it (its "legacy" home, the one
 * the product opens on) with the welcome screen of a new instance, and the two overviews: the
 * product's, as its overview plugin draws it, and management's, as the management overview does.
 */

import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Button, cx } from '../components/basic';
import { Icon, type IconName } from '../components/icon';
import { Portal } from '../components/overlay';
import { href, navigate, useLocation } from '../router';
import { services } from '../services';
import { useBreadcrumbs } from '../shell/state';
import '../styles/home.css';
import { slashHash } from './home_address';
import {
  INDEX_PATTERN_QUERY,
  isNewInstance,
  putWelcomeAside,
  welcomeEnabled,
  type WelcomeStorage,
} from './home_welcome';
import { SampleDataPage } from './sample_data';

/**
 * The home application: its first page, the sample data page at `#/tutorial_directory` and the
 * app directory at `#/feature_directory`
 */
export function Home() {
  const location = useLocation();
  useEffect(slashHash, [location]);
  const { hashPath } = location;
  if (hashPath === '/tutorial_directory' || hashPath.startsWith('/tutorial_directory/')) {
    return <SampleDataPage withHomeBreadcrumb />;
  }
  if (hashPath === '/feature_directory') return <FeatureDirectory />;
  return <HomePage />;
}

/** The sample data page as an application of its own, which other pages link to */
export function ImportSampleData() {
  return <SampleDataPage withHomeBreadcrumb={false} />;
}

/** A link of the page's header or footer: an icon and words in the colour of links */
function PageLink({
  to,
  icon,
  className,
  testId,
  children,
}: {
  to: string;
  icon: IconName;
  className: string;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <a className={cx('homLink', className)} href={href(to)} data-test-subj={testId}>
      <Icon name={icon} />
      <span className="homLink__text">{children}</span>
    </a>
  );
}

/** A card of the page: an icon beside a title that leads somewhere, and what it is for */
function SynopsisCard({
  id,
  title,
  description,
  icon,
  to,
}: {
  id: string;
  title: string;
  description: string;
  icon: IconName;
  to: string;
}) {
  return (
    // The whole card leads where its title does
    <div
      className="homSynopsis__card"
      data-test-subj={`homeSynopsisLink${id}`}
      onClick={(event) => {
        if ((event.target as Element).closest('a')) return;
        navigate(to);
      }}
    >
      <div className="homSynopsis__top">
        <Icon name={icon} className="homSynopsis__icon" />
      </div>
      <div className="homSynopsis__content">
        <h3 className="homSynopsis__title atlTitleXs">
          <a className="homSynopsis__titleAnchor" href={href(to)} aria-describedby={`homSynopsis${id}Description`}>
            {title}
          </a>
        </h3>
        <div className="homSynopsis__description" id={`homSynopsis${id}Description`}>
          <p>{description}</p>
        </div>
      </div>
    </div>
  );
}

interface Feature {
  id: string;
  title: string;
  /** What the overview's card of the application says under its title */
  subtitle?: string;
  description: string;
  icon: IconName;
  path: string;
  category: 'data' | 'admin';
  /** Shown in the sections on data of the first page and of the overview */
  showOnHomePage?: true;
}

/** What the original's plugins enter in its catalogue of features, in the order of their titles */
const FEATURES: Feature[] = [
  {
    id: 'home_tutorial_directory',
    title: 'Add sample data',
    description: 'Get started with sample data, visualizations, and dashboards.',
    icon: 'document',
    path: '/app/home#/tutorial_directory',
    category: 'data',
    showOnHomePage: true,
  },
  {
    id: 'advanced_settings',
    title: 'Advanced settings',
    description:
      'Customize your OpenSearch Dashboards experience \u2014 change the date format, turn on dark mode, and more.',
    icon: 'gear',
    path: '/app/management/opensearch-dashboards/settings',
    category: 'admin',
  },
  {
    id: 'dashboard',
    title: 'Dashboard',
    subtitle: 'Analyze data in dashboards.',
    description: 'Display and share a collection of visualizations and saved searches.',
    icon: 'dashboard',
    path: '/app/dashboards#/list',
    category: 'data',
  },
  {
    id: 'discover',
    title: 'Discover',
    subtitle: 'Search and find insights.',
    description: 'Interactively explore your data by querying and filtering raw documents.',
    icon: 'discover',
    path: '/app/discover#/',
    category: 'data',
  },
  {
    id: 'console',
    title: 'Interact with the OpenSearch API',
    description: 'Skip cURL and use a JSON interface to work with your data in Console.',
    icon: 'console',
    path: '/app/dev_tools#/console',
    category: 'admin',
  },
  {
    id: 'opensearch_management_overview',
    title: 'Management',
    description: 'Your center location for managing the OpenSearch Stack.',
    icon: 'managementApp',
    path: '/app/opensearch_management_overview',
    category: 'admin',
  },
  {
    id: 'saved_objects',
    title: 'Saved Objects',
    description: 'Import, export, and manage your saved searches, visualizations, and dashboards.',
    icon: 'savedObjectsApp',
    path: '/app/management/opensearch-dashboards/objects',
    category: 'admin',
  },
  {
    id: 'visualize',
    title: 'Visualize',
    description: 'Create visualizations and aggregate data stores in your OpenSearch indices.',
    icon: 'visualize',
    path: '/app/visualize#/',
    category: 'data',
  },
];

const DIRECTORY_TABS: Array<{ id: 'all' | Feature['category']; name: string }> = [
  { id: 'all', name: 'All' },
  { id: 'data', name: 'Data Exploration & Visualization' },
  { id: 'admin', name: 'Administrative' },
];

/** "View app directory": every feature, four a row, in tabs by kind */
function FeatureDirectory() {
  // The original sets no trail of its own: the header keeps the application's
  useBreadcrumbs([{ text: 'Home' }]);
  const [selected, setSelected] = useState<(typeof DIRECTORY_TABS)[number]['id']>('all');
  return (
    <div className="homDirectory">
      <main className="homDirectory__body">
        <h1 className="atlTitleL">Directory</h1>
        <div className="homDirectory__tabs" role="tablist">
          {DIRECTORY_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={tab.id === selected}
              className={cx('homDirectory__tab', tab.id === selected && 'homDirectory__tab--selected')}
              data-test-subj={`tab-${tab.id}`}
              onClick={() => setSelected(tab.id)}
            >
              {tab.name}
            </button>
          ))}
        </div>
        <div className="homDirectory__grid">
          {FEATURES.filter((feature) => selected === 'all' || feature.category === selected).map((feature) => (
            <div key={feature.id} className="homDirectory__item">
              <SynopsisCard
                id={feature.id}
                title={feature.title}
                description={feature.description}
                icon={feature.icon}
                to={feature.path}
              />
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}

/**
 * "Display a different page on log in" when the page at `path` is the landing page, or "Make this
 * my landing page" when another page is
 */
function PageFooter({ path }: { path: string }) {
  useSyncExternalStore(services.uiSettings.subscribe, services.uiSettings.getVersion);
  const isLanding = services.uiSettings.get<string>('defaultRoute', '/app/home') === path;
  return (
    <footer className="homFooter">
      <div>
        {isLanding ? (
          <PageLink to="/app/management/opensearch-dashboards/settings#defaultRoute" icon="home" className="homFooter__button">
            Display a different page on log in
          </PageLink>
        ) : (
          <button
            type="button"
            className="homLink homFooter__button"
            onClick={() => {
              services.uiSettings
                .set('defaultRoute', path)
                .then(() => services.toasts.success('Landing page updated'))
                .catch((error: unknown) => services.toasts.error(error, 'Unable to update UI setting'));
            }}
          >
            <Icon name="home" />
            <span className="homLink__text">Make this my landing page</span>
          </button>
        )}
      </div>
      <div>
        <PageLink to="/app/home#/feature_directory" icon="grid" className="homFooter__button" testId="allPlugins">
          View app directory
        </PageLink>
      </div>
    </footer>
  );
}

/** The browser's storage, if it lets the page have it */
function browserStorage(): WelcomeStorage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

type WelcomeState = 'asking' | 'welcome' | 'page';

/**
 * Whether the first page is the welcome screen. While the answer is awaited the page stays blank,
 * as the original's does, so that the screen does not fade in over a page already drawn.
 */
function useWelcome(): [WelcomeState, () => void] {
  const [state, setState] = useState<WelcomeState>(() =>
    welcomeEnabled(services.boot.home?.disableWelcomeScreen === true, browserStorage()) ? 'asking' : 'page'
  );
  useEffect(() => {
    if (state !== 'asking') return undefined;
    let live = true;
    void isNewInstance(() => services.savedObjects.find(INDEX_PATTERN_QUERY)).then((isNew) => {
      if (live) setState(isNew ? 'welcome' : 'page');
    });
    return () => {
      live = false;
    };
  }, [state]);
  const skip = useCallback(() => {
    putWelcomeAside(browserStorage());
    setState('page');
  }, []);
  return [state, skip];
}

const WELCOME_DESCRIPTION =
  'Add data to your cluster from any source, then analyze and visualize it in real time. Use our solutions to add search anywhere, observe your ecosystem, and protect against security threats.';

/** The welcome screen: over the whole window, it offers to add data or to go on to the page */
function Welcome({ onSkip }: { onSkip: () => void }) {
  const name = services.boot.name;
  const dark = services.uiSettings.get<boolean>('theme:darkMode', false) === true;
  useEffect(() => {
    const hideOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onSkip();
    };
    document.addEventListener('keydown', hideOnEscape);
    return () => document.removeEventListener('keydown', hideOnEscape);
  }, [onSkip]);
  return (
    <Portal>
      <div className="homWelcome">
        <header className="homWelcome__header">
          <div className="homWelcome__content homWelcome__intro">
            <span className="homWelcome__logo">
              <img src={href('/logo.svg')} alt="" />
            </span>
            <h1
              className="homWelcome__title atlTitleL"
              data-test-subj="welcomeCustomTitle"
              data-test-title-message={`Welcome to ${name}`}
            >
              Welcome to {name}
            </h1>
          </div>
        </header>
        <div className="homWelcome__content homWelcome__body">
          <div className="homWelcome__card">
            <div className="homWelcome__cardImage">
              <img
                src={href(`/plugins/home/assets/common/illustration_integrations_${dark ? 'darkmode' : 'lightmode'}.png`)}
                alt=""
              />
            </div>
            <div className="homWelcome__cardContent">
              <span className="homWelcome__cardTitle atlTitleS">Start by adding your data</span>
              <div className="homWelcome__cardDescription">
                <p>{WELCOME_DESCRIPTION}</p>
              </div>
            </div>
            <footer className="homWelcome__cardFooter">
              <Button
                variant="primary"
                className="homWelcome__footerAction homWelcome__add"
                onClick={() => navigate('/app/home#/tutorial_directory')}
              >
                Add data
              </Button>
              <Button
                variant="empty"
                className="homWelcome__footerAction homWelcome__skip"
                onClick={onSkip}
                testId="skipWelcomeScreen"
              >
                Explore on my own
              </Button>
            </footer>
          </div>
        </div>
      </div>
    </Portal>
  );
}

function HomePage() {
  useBreadcrumbs([{ text: 'Home' }]);
  const [welcome, skipWelcome] = useWelcome();
  if (welcome === 'asking') return null;
  if (welcome === 'welcome') return <Welcome onSkip={skipWelcome} />;
  return <HomeContent />;
}

function HomeContent() {
  const name = services.boot.name;
  return (
    <main aria-labelledby="homHeader__title" className="homWrapper" data-test-subj="homeApp">
      <header className="homHeader">
        <div className="homHeader__inner">
          <h1 id="homHeader__title" className="homHeader__title atlTitleL">
            Home
          </h1>
          <div className="homHeader__actions">
            <PageLink to="/app/home#/tutorial_directory" icon="document" className="homHeader__action">
              Add data
            </PageLink>
            <PageLink to="/app/management" icon="gear" className="homHeader__action">
              Manage
            </PageLink>
            <PageLink to="/app/dev_tools#/console" icon="wrench" className="homHeader__action">
              Dev tools
            </PageLink>
          </div>
        </div>
      </header>
      <div className="homContent">
        <section aria-labelledby="homSolutions__title" className="homSolutions">
          <h2 id="homSolutions__title" className="homScreenReaderOnly">
            Pick your solution
          </h2>
          <div className="homSolutions__content">
            <div className="homSolutions__item" data-test-subj="homSolutionPanel homSolutionPanel_opensearchDashboards">
              <a className="homSolutionPanel" href={href('/app/opensearch_dashboards_overview')}>
                <div className="homSolutionPanel__inner">
                  <div className="homSolutionPanel__header">
                    <span className="homSolutionPanel__icon">
                      <img src={href('/logo.svg')} width={24} height={24} alt="" />
                    </span>
                    <h3 className="homSolutionPanel__title atlTitleS" data-test-subj="dashboardCustomTitle" data-test-title={name}>
                      {name}
                    </h3>
                    <p className="homSolutionPanel__subtitle">
                      Visualize &amp; analyze <Icon name="arrowRight" />
                    </p>
                  </div>
                  <div className="homSolutionPanel__content">
                    <p>Analyze data in dashboards.</p>
                    <p>Search and find insights.</p>
                  </div>
                </div>
              </a>
            </div>
          </div>
        </section>
        <hr className="homRule" aria-hidden="true" />
        <div className="homData">
          <section className="homDataAdd" aria-labelledby="homDataAdd__title">
            <h2 id="homDataAdd__title" className="homData__title atlTitleS">
              Ingest your data
            </h2>
            <SynopsisCard
              id="home_tutorial_directory"
              title="Add sample data"
              description="Get started with sample data, visualizations, and dashboards."
              icon="document"
              to="/app/home#/tutorial_directory"
            />
          </section>
          <section className="homDataManage" aria-labelledby="homDataManage__title" data-test-subj="homDataManage">
            <h2 id="homDataManage__title" className="homData__title atlTitleS">
              Manage your data
            </h2>
            <SynopsisCard
              id="console"
              title="Interact with the OpenSearch API"
              description="Skip cURL and use a JSON interface to work with your data in Console."
              icon="console"
              to="/app/dev_tools#/console"
            />
          </section>
        </div>
        <hr className="homRule" aria-hidden="true" />
        <PageFooter path="/app/home" />
      </div>
    </main>
  );
}

/**
 * The product's own applications, as the catalogue orders them. The overview shows them first, a
 * card each, or on a new instance as what there is to begin with.
 */
const MAIN_APPS = ['dashboard', 'discover'];

/**
 * The catalogue's entries of a kind that the overview shows. As in the original, Console's card is
 * the one to manage data when no entry of that kind is shown, which is the case here.
 */
function homeFeatures(category: Feature['category']): Feature[] {
  const features = FEATURES.filter((feature) => feature.showOnHomePage === true && feature.category === category);
  if (category === 'admin' && features.length === 0) {
    return FEATURES.filter((feature) => feature.id === 'console');
  }
  return features;
}

/** A card of the overview: an application's title over its subtitle, in the middle */
function AppCard({ feature }: { feature: Feature }) {
  const id = `homApp${feature.id}`;
  return (
    // The whole card leads where its title does
    <div
      className="homCard homCard--centered"
      onClick={(event) => {
        if ((event.target as Element).closest('a')) return;
        navigate(feature.path);
      }}
    >
      <h3 className="homCard__title atlTitleS" id={`${id}Title`}>
        <a className="homCard__link" href={href(feature.path)} aria-describedby={`${id}Description`}>
          {feature.title}
        </a>
      </h3>
      <div className="homCard__description" id={`${id}Description`}>
        <p>{feature.subtitle}</p>
      </div>
    </div>
  );
}

/** The cards of the catalogue's entries of a kind, under a title */
function DataSection({ kind, title, features }: { kind: 'Add' | 'Manage'; title: string; features: Feature[] }) {
  return (
    <section
      className={`homData${kind}`}
      aria-labelledby={`osdOverviewData${kind}__title`}
      data-test-subj={kind === 'Manage' ? 'osdOverviewDataManage' : undefined}
    >
      <h2 id={`osdOverviewData${kind}__title`} className="homData__title atlTitleS">
        {title}
      </h2>
      {features.map((feature) => (
        <SynopsisCard
          key={feature.id}
          id={feature.id}
          title={feature.title}
          description={feature.description}
          icon={feature.icon}
          to={feature.path}
        />
      ))}
    </section>
  );
}

/** What the overview of a new instance says under its title */
function gettingStartedText(name: string): string {
  return `${name} empowers you to visualize your data, your way.  Start with one question, and see where the answer leads you.`;
}

/** The overview of a new instance: what to begin with and a way to add data, beside a picture */
function GettingStarted({ apps }: { apps: Feature[] }) {
  const name = services.boot.name;
  const dark = services.uiSettings.get<boolean>('theme:darkMode', false) === true;
  return (
    <section aria-labelledby="osdOverviewGettingStarted__title" className="homGettingStarted">
      <div className="homGettingStarted__content">
        <h2 id="osdOverviewGettingStarted__title" className="atlTitleS">
          Getting started with {name}
        </h2>
        <p className="homGettingStarted__text">{gettingStartedText(name)}</p>
        <div className="homGettingStarted__apps">
          {apps.map((app) => (
            <div key={app.id} className="homGettingStarted__app">
              <Icon name={app.icon} className="homGettingStarted__icon" />
              <div className="homGettingStarted__appContent">
                <h3 className="atlTitleXs">{app.title}</h3>
                <div className="homGettingStarted__description">
                  <p>{app.subtitle}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
        <Button
          variant="primary"
          icon="document"
          to="/app/management/opensearch-dashboards/indexPatterns"
          className="homGettingStarted__add"
        >
          Add your data
        </Button>
      </div>
      <div className="homGettingStarted__graphic">
        <img
          src={href(`/plugins/opensearchDashboardsOverview/assets/opensearch_dashboards_montage_${dark ? 'dark' : 'light'}.svg`)}
          alt={`${name} visualizations illustration`}
        />
      </div>
    </section>
  );
}

/**
 * Whether the instance is new, as the overview asks: until the answer comes the overview is the
 * one of an instance with data, and a failed request leaves it so
 */
function useNewInstance(): boolean {
  const [isNew, setIsNew] = useState(false);
  useEffect(() => {
    let live = true;
    services.savedObjects.find(INDEX_PATTERN_QUERY).then(
      (answer) => {
        if (live) setIsNew(answer.total === 0);
      },
      () => undefined
    );
    return () => {
      live = false;
    };
  }, []);
  return isNew;
}

/**
 * The product's overview: its mark and name, a card for each of its main applications, the
 * sections on data of the first page and the footer; on a new instance, how to get started in
 * their place and no link in the header. The tab keeps the product's name.
 */
export function Overview() {
  useBreadcrumbs([{ text: 'Overview' }]);
  const location = useLocation();
  useEffect(slashHash, [location]);
  useEffect(() => {
    document.title = services.boot.name;
  }, []);
  const isNew = useNewInstance();
  const apps = MAIN_APPS.flatMap((id) => FEATURES.filter((feature) => feature.id === id));
  const logo = href('/logo.svg');
  return (
    <main aria-labelledby="osdOverviewPageHeader__title" className="homWrapper">
      <header className="homHeader homHeader--noOverlap">
        <div className="homHeader__inner">
          <div className="homHeader__brand">
            <img
              className="homHeader__logo"
              src={logo}
              alt=""
              data-test-subj="osdOverviewPageHeaderLogo"
              data-test-logo={logo}
            />
            <h1 id="osdOverviewPageHeader__title" className="homHeader__title atlTitleL">
              {services.boot.name}
            </h1>
          </div>
          {!isNew && (
            <div className="homHeader__actions">
              <PageLink to="/app/home#/tutorial_directory" icon="document" className="homHeader__action">
                Add data
              </PageLink>
            </div>
          )}
        </div>
      </header>
      <div className="homContent">
        {isNew ? (
          <GettingStarted apps={apps} />
        ) : (
          <>
            <section aria-labelledby="osdOverviewApps__title" className="homApps">
              <h2 id="osdOverviewApps__title" className="homScreenReaderOnly">
                Explore these apps
              </h2>
              <div className="homApps__group">
                {apps.map((feature) => (
                  <div key={feature.id} className="homApps__item">
                    <AppCard feature={feature} />
                  </div>
                ))}
              </div>
            </section>
            <hr className="homRule" aria-hidden="true" />
            <div className="homData">
              <DataSection kind="Add" title="Ingest your data" features={homeFeatures('data')} />
              <DataSection kind="Manage" title="Manage your data" features={homeFeatures('admin')} />
            </div>
          </>
        )}
        <hr className="homRule" aria-hidden="true" />
        <PageFooter path="/app/opensearch_dashboards_overview" />
      </div>
    </main>
  );
}

interface ManagementApp {
  id: string;
  title: string;
  description: string;
}

/** What the management overview lists, as the plugins that ship enter themselves, in their order */
const MANAGEMENT_APPS: ManagementApp[] = [
  {
    id: 'opensearch_index_management_dashboards',
    title: 'Index Management',
    description:
      'Manage your indexes with state polices, templates and aliases. You can also roll up or transform your indexes.',
  },
  {
    id: 'opensearch_snapshot_management_dashboards',
    title: 'Snapshot Management',
    description:
      "Back up and restore your cluster's indexes and state. Setup a policy to automate snapshot creation and deletion.",
  },
  {
    id: 'management',
    title: 'Dashboards Management',
    description:
      'Manage Dashboards saved objects and data source connections. You can also modify advanced settings for Dashboards.',
  },
  {
    id: 'dev_tools',
    title: 'Dev Tools',
    description: 'Use the console to set up and troubleshoot your OpenSearch environment with the REST API.',
  },
];

/** A card of the management overview: its title is a button that opens the application */
function ManagementCard({ app }: { app: ManagementApp }) {
  const open = () => navigate(`/app/${app.id}`);
  const id = `homManagement${app.id}`;
  return (
    // The whole card opens what its title does
    <div
      className="homCard"
      data-test-subj={`link-${app.id}`}
      onClick={(event) => {
        if ((event.target as Element).closest('button')) return;
        open();
      }}
    >
      <h3 className="homCard__title atlTitleXs" id={`${id}Title`}>
        <button type="button" className="homCard__link" onClick={open} aria-describedby={`${id}Description`}>
          {app.title}
        </button>
      </h3>
      <div className="homCard__description" id={`${id}Description`}>
        <p>{app.description}</p>
      </div>
    </div>
  );
}

/** Management's overview: a card for each application that manages something, three a row */
export function ManagementOverview() {
  useBreadcrumbs([{ text: 'Overview' }]);
  useEffect(() => {
    document.title = services.boot.name;
  }, []);
  return (
    <div className="homManagement">
      <main className="homManagement__body">
        <h1 className="homManagement__title atlTitleL">Overview</h1>
        <div className="homManagement__grid">
          {MANAGEMENT_APPS.map((app) => (
            <div key={app.id} className="homManagement__item">
              <ManagementCard app={app} />
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}

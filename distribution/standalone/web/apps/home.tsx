/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The first page, as the home plugin of OpenSearch Dashboards draws it (its "legacy" home, the one
 * the product opens on) with the welcome screen of a new instance, and the two overviews: what
 * the product has, one card each.
 */

import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Button, cx } from '../components/basic';
import { Icon, type IconName } from '../components/icon';
import { Portal } from '../components/overlay';
import { href, navigate, useLocation } from '../router';
import { services } from '../services';
import { useBreadcrumbs } from '../shell/state';
import '../styles/home.css';
import {
  INDEX_PATTERN_QUERY,
  isNewInstance,
  putWelcomeAside,
  welcomeEnabled,
  type WelcomeStorage,
} from './home_welcome';
import { SampleDataPage } from './sample_data';

interface Card {
  title: string;
  description: string;
  icon: IconName;
  to: string;
}

const EXPLORE: Card[] = [
  {
    title: 'Discover',
    description: 'Search the documents of an index pattern, filter them and look inside each one.',
    icon: 'discover',
    to: '/app/discover',
  },
  {
    title: 'Dashboards',
    description: 'Charts, tables and text side by side, on one time range and one set of filters.',
    icon: 'dashboard',
    to: '/app/dashboards',
  },
  {
    title: 'Visualize',
    description: 'Build the charts a dashboard shows: lines, areas, bars, pies, metrics, tables and more.',
    icon: 'visualize',
    to: '/app/visualize',
  },
  {
    title: 'Query Workbench',
    description: 'Run SQL and PPL against OpenSearch and see the answer as a table.',
    icon: 'sql',
    to: '/app/opensearch-query-workbench',
  },
];

const MANAGE: Card[] = [
  {
    title: 'Index Management',
    description: 'Indices, their policies, templates, aliases and rollups.',
    icon: 'database',
    to: '/app/opensearch_index_management_dashboards',
  },
  {
    title: 'Index patterns',
    description: 'Say which indices the pages read and how their fields are shown.',
    icon: 'index',
    to: '/app/management/opensearch-dashboards/indexPatterns',
  },
  {
    title: 'Saved objects',
    description: 'Every dashboard, visualization and search: inspect, export, import, delete.',
    icon: 'folder',
    to: '/app/management/opensearch-dashboards/objects',
  },
  {
    title: 'Advanced settings',
    description: 'Date formats, defaults and the dark theme.',
    icon: 'gear',
    to: '/app/management/opensearch-dashboards/settings',
  },
  {
    title: 'Dev Tools',
    description: 'Send any request to OpenSearch from a console.',
    icon: 'console',
    to: '/app/dev_tools',
  },
];

function Cards({ cards }: { cards: Card[] }) {
  return (
    <div className="homCards">
      {cards.map((card) => (
        <a key={card.title} className="homCard" href={href(card.to)} data-test-subj={`homeCard-${card.title}`}>
          <span className="homCard__icon">
            <Icon name={card.icon} size="l" />
          </span>
          <span className="atlTitleXs">{card.title}</span>
          <span className="atlSubdued">{card.description}</span>
        </a>
      ))}
    </div>
  );
}

/**
 * The home application: its first page, the sample data page at `#/tutorial_directory` and the
 * app directory at `#/feature_directory`
 */
export function Home() {
  const { hashPath } = useLocation();
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
  description: string;
  icon: IconName;
  path: string;
  category: 'data' | 'admin';
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
    description: 'Display and share a collection of visualizations and saved searches.',
    icon: 'dashboard',
    path: '/app/dashboards#/list',
    category: 'data',
  },
  {
    id: 'discover',
    title: 'Discover',
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
    icon: 'gear',
    path: '/app/opensearch_management_overview',
    category: 'admin',
  },
  {
    id: 'saved_objects',
    title: 'Saved Objects',
    description: 'Import, export, and manage your saved searches, visualizations, and dashboards.',
    icon: 'folder',
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

/** "Display a different page on log in", or "Make this my landing page" when another page is */
function PageFooter() {
  useSyncExternalStore(services.uiSettings.subscribe, services.uiSettings.getVersion);
  const isLanding = services.uiSettings.get<string>('defaultRoute', '/app/home') === '/app/home';
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
                .set('defaultRoute', '/app/home')
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
        <PageFooter />
      </div>
    </main>
  );
}

export function Overview() {
  useBreadcrumbs([{ text: services.boot.name }, { text: 'Overview' }]);
  return (
    <div className="shlPage homPage">
      <h1 className="atlTitleL">{services.boot.name}</h1>
      <p className="atlSubdued homLead">Search, observe and visualize your data.</p>
      <Cards cards={EXPLORE} />
    </div>
  );
}

export function ManagementOverview() {
  useBreadcrumbs([{ text: 'Management' }, { text: 'Overview' }]);
  return (
    <div className="shlPage homPage">
      <h1 className="atlTitleL">Management</h1>
      <p className="atlSubdued homLead">Manage the indices of OpenSearch and the objects of {services.boot.name}.</p>
      <Cards cards={MANAGE} />
    </div>
  );
}

/* SPDX-License-Identifier: Apache-2.0 */

/* The first page, and the two overviews: what the product has, one card each. */

import { Icon, type IconName } from '../components/icon';
import { href } from '../router';
import { services } from '../services';
import { useBreadcrumbs, useRecentlyAccessed } from '../shell/state';
import '../styles/home.css';

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

export function Home() {
  useBreadcrumbs([{ text: 'Home' }]);
  const recent = useRecentlyAccessed();
  return (
    <div className="shlPage homPage" data-test-subj="homeApp">
      <header className="homHero">
        <img src={href('/logo.svg')} width={56} height={56} alt="" />
        <div>
          <h1 className="atlTitleL">{services.boot.name}</h1>
          <p className="atlSubdued">Explore, visualize and manage the data in OpenSearch.</p>
        </div>
      </header>
      {recent.length > 0 && (
        <section>
          <h2 className="atlTitleS homSection">Recently viewed</h2>
          <div className="homRecent">
            {recent.slice(0, 6).map((item) => (
              <a key={item.id} href={href(item.link)} className="homRecent__item">
                <Icon name="clock" />
                <span className="atlTruncate">{item.label}</span>
              </a>
            ))}
          </div>
        </section>
      )}
      <section>
        <h2 className="atlTitleS homSection">Explore and visualize</h2>
        <Cards cards={EXPLORE} />
      </section>
      <section>
        <h2 className="atlTitleS homSection">Manage</h2>
        <Cards cards={MANAGE} />
      </section>
    </div>
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

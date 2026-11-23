/* SPDX-License-Identifier: Apache-2.0 */

/* Where the browser side starts: it reads what the server put in the page and draws the app. */

import './lib/csp_nonce'; // first: the page's nonce on every style element made from here on
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import { App, registerRoute } from './app';
import { dimmingOpacity, setColorMapping } from './charts/core';
import { Dashboards } from './apps/dashboard';
import { DevTools } from './apps/dev_tools';
import { IndexManagement, startJobs } from './apps/index_management';
import { QueryWorkbench } from './apps/query_workbench';
import { Discover } from './apps/discover';
import { Visualize } from './apps/visualize';
import { VisBuilder } from './apps/vis_builder';
import { Management } from './apps/management';
import { startRouter } from './router';
import { createServices, type BootData } from './services';
import { DEFAULT_MAP_CONFIG } from '../common/map_config';
// After every page's own sheets: the search bar, the time picker, share and inspect, wherever they are
import './styles/search_bar.css';
import './styles/date_picker.css';
import './styles/share.css';
import './styles/inspect.css';

function readBootData(): BootData {
  const element = document.getElementById('boot-data');
  const fallback: BootData = {
    basePath: '',
    version: '',
    name: 'InfraDashboard',
    settings: {},
    settingsDefaults: {},
    settingsOverrides: {},
    map: DEFAULT_MAP_CONFIG,
    libraries: { vega: '', vegaLite: '' },
  };
  if (!element?.textContent) return fallback;
  try {
    return { ...fallback, ...(JSON.parse(element.textContent) as Partial<BootData>) };
  } catch {
    return fallback;
  }
}

const boot = readBootData();
const services = createServices(boot);
setColorMapping(services.uiSettings.get<Record<string, string>>('visualization:colorMapping', {}));
startRouter(boot.basePath);
// Work a page opened earlier left going is followed from wherever the product is opened again
startJobs();

// The theme is a class on the page; the server wrote the one the setting names. As in the original,
// a change of the theme or of the animations takes effect once the page is loaded again.
const dark = services.uiSettings.get<boolean>('theme:darkMode', false) === true;
document.documentElement.classList.toggle('themeDark', dark);
document.documentElement.classList.toggle('themeLight', !dark);
document.documentElement.classList.toggle(
  'reduceMotion',
  services.uiSettings.get<boolean>('accessibility:disableAnimations', false) === true
);

// How much the charts dim the series not hovered, which the original reads on every hover
const applyDimming = () =>
  document.documentElement.style.setProperty(
    '--cht-dim-opacity',
    String(dimmingOpacity(services.uiSettings.get('visualization:dimmingOpacity', 0.5)))
  );
applyDimming();
services.uiSettings.subscribe(applyDimming);

registerRoute({ paths: ['/app/data-explorer/discover', '/app/data-explorer'], render: () => <Discover basePath="/app/data-explorer/discover" /> });
registerRoute({ paths: ['/app/dashboards', '/app/dashboard'], render: () => <Dashboards /> });
registerRoute({ paths: ['/app/discover'], render: () => <Discover basePath="/app/discover" /> });
registerRoute({ paths: ['/app/visualize'], render: () => <Visualize /> });
registerRoute({ paths: ['/app/vis-builder'], render: () => <VisBuilder /> });
registerRoute({ paths: ['/app/management', '/app/indexPatterns', '/app/objects', '/app/settings'], render: () => <Management /> });
registerRoute({ paths: ['/app/dev_tools'], render: () => <DevTools /> });
registerRoute({ paths: ['/app/opensearch-query-workbench'], render: () => <QueryWorkbench /> });
registerRoute({
  paths: ['/app/opensearch_index_management_dashboards', '/app/opensearch_snapshot_management_dashboards'],
  render: () => <IndexManagement />,
});

const root = document.getElementById('root');
if (root) createRoot(root).render(<App />);

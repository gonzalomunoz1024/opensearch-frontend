/* SPDX-License-Identifier: Apache-2.0 */

/* Which page a path is. The paths are those of OpenSearch Dashboards, so that its links work. */

import { useEffect, type ReactNode } from 'react';
import { EmptyPrompt, ErrorBoundary, Button } from './components/basic';
import { ToastList } from './components/overlay';
import { navigate, useLocation } from './router';
import { services } from './services';
import { Chrome } from './shell/chrome';
import { Home, ImportSampleData, ManagementOverview, Overview } from './apps/home';

interface Route {
  /** The path of the application, and what else under `/app/` leads to it */
  paths: string[];
  render: () => ReactNode;
}

const routes: Route[] = [
  { paths: ['/app/home'], render: () => <Home /> },
  { paths: ['/app/import_sample_data'], render: () => <ImportSampleData /> },
  { paths: ['/app/opensearch_dashboards_overview'], render: () => <Overview /> },
  { paths: ['/app/opensearch_management_overview'], render: () => <ManagementOverview /> },
];

/** Adds an application; the pages register themselves in `main.tsx` */
export function registerRoute(route: Route) {
  routes.push(route);
}

function Redirect({ to }: { to: string }) {
  useEffect(() => navigate(to, { replace: true, force: true }), [to]);
  return null;
}

function NotFound() {
  return (
    <div className="shlPage">
      <EmptyPrompt
        icon="warning"
        title="Application Not Found"
        actions={
          <Button variant="primary" to="/app/home">
            Go to the home page
          </Button>
        }
      >
        No application was found at this URL. Try going back or choosing an app from the menu.
      </EmptyPrompt>
    </div>
  );
}

export function App() {
  const location = useLocation();
  const { pathname } = location;

  let page: ReactNode;
  if (pathname === '/' || pathname === '/app' || pathname === '') {
    const start = services.uiSettings.get<string>('defaultRoute', '/app/home');
    page = <Redirect to={start.startsWith('/app/') ? start : '/app/home'} />;
  } else {
    const route = routes.find((candidate) =>
      candidate.paths.some((path) => pathname === path || pathname.startsWith(`${path}/`))
    );
    page = route ? route.render() : <NotFound />;
  }

  return (
    <>
      <Chrome>
        <ErrorBoundary resetKey={`${pathname}#${location.hashPath}`}>{page}</ErrorBoundary>
      </Chrome>
      <ToastList />
    </>
  );
}

/* SPDX-License-Identifier: Apache-2.0 */

/* Dev Tools: the console and the Grok debugger, each under its tab, as OpenSearch Dashboards lays them out. */

import { useEffect } from 'react';
import '../../styles/dev_tools.css';
import { cx } from '../../components/basic';
import { navigateHash, useLocation } from '../../router';
import { services } from '../../services';
import { useBreadcrumbs } from '../../shell/state';
import { Console } from './console';
import { GrokDebugger } from './grok_debugger';
import { devTools, toolOf } from './tools';

export function DevTools() {
  const { hashPath } = useLocation();
  const tools = devTools(services.boot.console?.enabled !== false);
  const { tab, redirect } = toolOf(hashPath, tools);
  useBreadcrumbs([{ text: 'Dev Tools' }]);
  useEffect(() => {
    if (redirect) navigateHash(`/${tab}`, {}, { replace: true });
  }, [redirect, tab]);

  return (
    <main className="dvtApp">
      <div className="dvtTabs dvtApp__tabs" role="tablist">
        {tools.map((tool) => (
          <button
            key={tool.id}
            type="button"
            role="tab"
            aria-selected={tool.id === tab}
            className={cx('dvtTab', tool.id === tab && 'dvtTab--selected')}
            onClick={() => navigateHash(`/${tool.id}`)}
          >
            {tool.title}
          </button>
        ))}
      </div>
      <div className="dvtApp__panel" role="tabpanel" data-test-subj={tab}>
        {tab === 'console' ? <Console /> : <GrokDebugger />}
      </div>
    </main>
  );
}

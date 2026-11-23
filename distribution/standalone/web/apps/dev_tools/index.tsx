/* SPDX-License-Identifier: Apache-2.0 */

/* Dev Tools: the console and the Grok debugger, each under its tab, as OpenSearch Dashboards lays them out. */

import { useEffect } from 'react';
import '../../styles/dev_tools.css';
import { cx } from '../../components/basic';
import { navigateHash, useLocation } from '../../router';
import { useBreadcrumbs } from '../../shell/state';
import { Console } from './console';
import { GrokDebugger } from './grok_debugger';

const TOOLS = [
  { id: 'console', title: 'Console' },
  { id: 'grok_debugger', title: 'Grok Debugger' },
] as const;

export function DevTools() {
  const { hashPath } = useLocation();
  const tab = hashPath.startsWith('/grok_debugger') ? 'grok_debugger' : 'console';
  useBreadcrumbs([{ text: 'Dev Tools' }]);
  useEffect(() => {
    if (hashPath === '' || hashPath === '/') navigateHash('/console', {}, { replace: true });
  }, [hashPath]);

  return (
    <main className="dvtApp">
      <div className="dvtTabs dvtApp__tabs" role="tablist">
        {TOOLS.map((tool) => (
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

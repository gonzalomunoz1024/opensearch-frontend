/* SPDX-License-Identifier: Apache-2.0 */

/* Dev Tools: the console and the Grok debugger, each under its tab. */

import { useEffect } from 'react';
import '../../styles/dev_tools.css';
import { Tabs } from '../../components/basic';
import { navigateHash, useLocation } from '../../router';
import { useBreadcrumbs } from '../../shell/state';
import { Console } from './console';
import { GrokDebugger } from './grok_debugger';

export function DevTools() {
  const { hashPath } = useLocation();
  const tab = hashPath.startsWith('/grok_debugger') ? 'grok_debugger' : 'console';
  useBreadcrumbs([{ text: 'Dev Tools' }]);
  useEffect(() => {
    if (hashPath === '' || hashPath === '/') navigateHash('/console', {}, { replace: true });
  }, [hashPath]);

  return (
    <div className="dvtPage">
      <Tabs
        tabs={[
          { id: 'console', label: 'Console' },
          { id: 'grok_debugger', label: 'Grok Debugger' },
        ]}
        selected={tab}
        onSelect={(id) => navigateHash(`/${id}`)}
      />
      {tab === 'console' ? <Console /> : <GrokDebugger />}
    </div>
  );
}

/* SPDX-License-Identifier: Apache-2.0 */

/* The help menu of the header, as the original's HeaderHelpMenu. */

import { useState, type ReactNode } from 'react';
import type { HelpExtension } from './chrome_layout';
import { HeaderIcon } from './header_icon';
import { HeaderPopover, HeaderTooltip } from './header_popover';

/** Where the menu's own links lead, as OpenSearch Dashboards 3.9.0 sends them */
export const HELP_LINKS = {
  documentation: 'https://opensearch.org/docs/latest/dashboards/index/',
  community: 'https://forum.opensearch.org/',
  feedback: 'https://survey.opensearch.org',
  issue: 'https://github.com/opensearch-project/OpenSearch-Dashboards/issues/new/choose',
} as const;

/** The component library's `logoGithub`, which the icons of the kit do not hold (see NOTICE) */
const GITHUB_MARK =
  'M16 0C7.164 0 0 7.343 0 16.4c0 7.248 4.584 13.394 10.942 15.562.8.15 1.092-.356 1.092-.789 0-.39-.014-1.684-.022-3.053-4.45.991-5.39-1.934-5.39-1.934-.728-1.894-1.776-2.398-1.776-2.398-1.454-1.017.11-.997.11-.997 1.606.114 2.452 1.69 2.452 1.69 1.428 2.506 3.746 1.781 4.656 1.36.146-1.056.56-1.78 1.016-2.19-3.552-.414-7.288-1.821-7.288-8.105 0-1.792.624-3.254 1.646-4.402-.164-.416-.714-2.085.158-4.342 0 0 1.341-.44 4.4 1.681A14.882 14.882 0 0 1 16 7.932c1.36.006 2.728.188 4.006.553 3.053-2.124 4.396-1.681 4.396-1.681.875 2.259.325 3.926.16 4.34 1.026 1.148 1.645 2.61 1.645 4.402 0 6.3-3.742 7.687-7.307 8.094.577.508 1.086 1.505 1.086 3.035 0 2.192-.021 3.96-.021 4.5 0 .437.29.947 1.101.787C27.42 29.79 32 23.644 32 16.4 32 7.343 24.836 0 16 0Z';

function HelpLink({ to, icon, children }: { to: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <a className="shlHelp__link" href={to} target="_blank" rel="noopener noreferrer">
      {icon}
      <span className="shlHelp__linkText">{children}</span>
    </a>
  );
}

/** What the menu holds: its title with the version, its links, and what the application adds */
export function HelpMenuContent({ version, extension }: { version: string; extension?: HelpExtension }) {
  return (
    <>
      <div className="shlHelp__title">
        <h2>Help</h2>
        <div className="shlHelp__version">v {version}</div>
      </div>
      <div className="shlHelp__body" style={{ maxWidth: 270 }}>
        <HelpLink to={HELP_LINKS.documentation}>Documentation</HelpLink>
        <HelpLink to={HELP_LINKS.community}>Community</HelpLink>
        <HelpLink to={HELP_LINKS.feedback}>Give feedback</HelpLink>
        <div className="shlHelp__space" />
        <HelpLink
          to={HELP_LINKS.issue}
          icon={
            <svg className="shlHelp__mark" viewBox="0 0 32 32" role="img" aria-hidden="true" focusable="false">
              <path d={GITHUB_MARK} />
            </svg>
          }
        >
          Open an issue in GitHub
        </HelpLink>
        {extension && (
          <>
            <hr className="shlHelp__rule" />
            <h3 className="shlHelp__app">{extension.appName}</h3>
            <HelpLink to={extension.documentation}>Documentation</HelpLink>
          </>
        )}
      </div>
    </>
  );
}

/** The button at the right end of the header, and the menu it opens under itself */
export function HelpMenu({ version, extension }: { version: string; extension?: HelpExtension }) {
  const [open, setOpen] = useState(false);
  return (
    <HeaderPopover
      id="headerHelpMenu"
      testId="helpMenuButton"
      anchorPosition="downRight"
      padding="s"
      open={open}
      onClose={() => setOpen(false)}
      button={
        <HeaderTooltip content="Help" delay="long" position="bottom">
          <button
            type="button"
            className="shlHeader__button"
            aria-expanded={open}
            aria-haspopup="true"
            aria-label="Help menu"
            onClick={() => setOpen(!open)}
          >
            <HeaderIcon name="questionInCircle" className="shlHeader__icon" />
          </button>
        </HeaderTooltip>
      }
    >
      <HelpMenuContent version={version} extension={extension} />
    </HeaderPopover>
  );
}

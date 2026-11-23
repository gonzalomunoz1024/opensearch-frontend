/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The frame of Dashboards Management, as the original's management plugin draws it in the Atlas
 * theme (`management_app`, `management_sidebar_nav`, `landing`): its own side navigation, the
 * section "Dashboards Management" with its tip and a link for each of its applications, beside the
 * page; and the landing page. On the short addresses the original mounts a page alone, outside the
 * frame. Nothing here loads a style sheet, so that tests can draw it.
 */

import { useId, useState } from 'react';
import { cx } from '../../components/basic';
import { Icon } from '../../components/icon';
import { Tooltip } from '../../components/overlay';
import { href } from '../../router';
import { useBreadcrumbs } from '../../shell/state';

export const MANAGEMENT_ROOT = '/app/management';
export const SECTION_ROOT = `${MANAGEMENT_ROOT}/opensearch-dashboards`;

/**
 * The section's applications in the original's order, each with its short address. The original's
 * "Data sources", second, is left out: the product has no data sources.
 */
export const SECTIONS = [
  { id: 'indexPatterns', label: 'Index patterns', short: '/app/indexPatterns' },
  { id: 'objects', label: 'Saved objects', short: '/app/objects' },
  { id: 'settings', label: 'Advanced settings', short: '/app/settings' },
] as const;

export type SectionId = (typeof SECTIONS)[number]['id'];

export const sectionPath = (section: SectionId, rest = '') => `${SECTION_ROOT}/${section}${rest}`;

export interface ManagementPath {
  /** The application the path is in; none on the landing page */
  section?: SectionId;
  /** What follows the application's address, decoded */
  rest: string[];
  /** On a short address the page stands alone, without the frame and its navigation */
  alone: boolean;
}

/** Which application of the section a path is in, what follows it, and whether it stands alone */
export function readManagementPath(pathname: string): ManagementPath {
  const decode = (part: string) => {
    try {
      return decodeURIComponent(part);
    } catch {
      return part;
    }
  };
  for (const section of SECTIONS) {
    for (const root of [`${SECTION_ROOT}/${section.id}`, section.short]) {
      if (pathname === root || pathname.startsWith(`${root}/`)) {
        return {
          section: section.id,
          rest: pathname.slice(root.length).split('/').filter(Boolean).map(decode),
          alone: root === section.short,
        };
      }
    }
  }
  return { rest: [], alone: false };
}

/** The heading the navigation is named by, for screen readers only, under the original's id */
const NAV_HEADING_ID = 'stack-management-nav-header';

const SECTION_TITLE = 'Dashboards Management';
const SECTION_TIP = 'Customize OpenSearch Dashboards and manage saved objects';

/**
 * The original's EuiSideNav: the section's heading, not a link, its name and the mark of its tip
 * together under the tooltip; then the links, the one of the page open marked. In a window
 * narrower than 768 pixels it is folded under the button "Management menu".
 */
export function ManagementNav({ selected }: { selected?: SectionId }) {
  const [openOnMobile, setOpenOnMobile] = useState(false);
  const id = useId();
  const contentId = `${id}content`;
  return (
    <>
      <h2 id={NAV_HEADING_ID} className="atlScreenReaderOnly">
        Management
      </h2>
      <nav className={cx('mgtNav', openOnMobile && 'mgtNav--openOnMobile')} aria-labelledby={NAV_HEADING_ID}>
        <h2 id={`${id}heading`} className="mgtNav__mobileHeading">
          <button
            type="button"
            className="mgtNav__mobileToggle"
            aria-controls={contentId}
            aria-expanded={openOnMobile}
            onClick={() => setOpenOnMobile((open) => !open)}
          >
            <span className="mgtNav__mobileToggleContent">
              <Icon name="apps" />
              <span className="mgtNav__mobileToggleText">Management menu</span>
            </span>
          </button>
        </h2>
        <div id={contentId} className="mgtNav__content">
          <div className="mgtNav__section">
            <div className="mgtNav__heading" data-test-subj="opensearch-dashboards">
              <span className="mgtNav__headingContent">
                <span className="mgtNav__headingLabel" title={SECTION_TITLE}>
                  <Tooltip content={SECTION_TIP} position="right" delay="regular">
                    <span className="mgtNav__tipped">
                      <span className="mgtNav__headingText">{SECTION_TITLE}</span>
                      <Icon name="questionInCircle" />
                    </span>
                  </Tooltip>
                </span>
              </span>
            </div>
            <div className="mgtNav__items">
              {SECTIONS.map((item) => (
                <div key={item.id} className="mgtNav__item">
                  <a
                    className={cx('mgtNav__link', selected === item.id && 'mgtNav__link--selected')}
                    href={href(sectionPath(item.id))}
                    rel="noreferrer"
                    data-test-subj={item.id}
                  >
                    <span className="mgtNav__linkContent">
                      <span className="mgtNav__linkLabel" title={item.label}>
                        {item.label}
                      </span>
                    </span>
                  </a>
                </div>
              ))}
            </div>
          </div>
        </div>
      </nav>
    </>
  );
}

/** The original's landing page: a panel in the middle, as wide as its text */
export function ManagementLanding() {
  // The original's crumb leads to the section's root, the page itself
  useBreadcrumbs([{ text: SECTION_TITLE, to: `${MANAGEMENT_ROOT}/` }]);
  return (
    <div className="mgtLanding">
      <div className="mgtLanding__panel" data-test-subj="managementHome">
        <div>
          <div className="mgtLanding__head">
            <Icon name="managementApp" size="xxl" app className="mgtLanding__icon" />
            <h1 className="atlTitleL">Welcome to Dashboards Management</h1>
            <p className="mgtLanding__text">
              Manage your index patterns, saved objects, OpenSearch Dashboards settings, and more.
            </p>
          </div>
          <hr className="mgtLanding__rule" />
          <p className="mgtLanding__text mgtLanding__more">A complete list of apps is in the menu on the left.</p>
        </div>
      </div>
    </div>
  );
}

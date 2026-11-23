/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The trail of the header, drawn and folded as the original's: its HeaderBreadcrumbs hands the
 * crumbs to the component library's EuiHeaderBreadcrumbs, which shows as many as the window's
 * width allows and folds the middle ones into a "…" that opens them in a popover.
 */

import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { href } from '../router';
import {
  APP_TITLE_FALLBACK,
  arrangeBreadcrumbs,
  breadcrumbLimit,
  breadcrumbTestSubject,
} from './chrome_layout';
import { HeaderIcon } from './header_icon';
import { HeaderPopover } from './header_popover';
import type { Breadcrumb } from './state';

interface Item {
  crumb: Breadcrumb;
  /** Its test subject, by its place in the whole trail */
  subject: string;
}

const names = (...parts: Array<string | false>) => parts.filter(Boolean).join(' ');

function Crumb({ item, last, inPopover }: { item: Item; last: boolean; inPopover: boolean }) {
  const { crumb, subject } = item;
  const className = names('shlCrumb', last && 'shlCrumb--last');
  // The original reads a crumb's title from what is drawn, and in the popover nothing is yet
  const title = inPopover ? undefined : crumb.text;
  if (crumb.to !== undefined) {
    return (
      <a className={className} href={href(crumb.to)} rel="noreferrer" title={title} data-test-subj={subject}>
        {crumb.text}
      </a>
    );
  }
  return (
    <span
      className={className}
      title={title}
      aria-current={last && !inPopover ? 'page' : 'false'}
      data-test-subj={subject}
    >
      {crumb.text}
    </span>
  );
}

/** The crumbs of a trail, each in its wrapper, the first behind its wall, as EuiBreadcrumbs */
function crumbElements(items: Item[], inPopover: boolean): ReactNode[] {
  return items.map((item, index) => {
    const first = index === 0;
    const last = index === items.length - 1;
    const wrapper = (
      <div
        className={names(
          'shlCrumbWrapper',
          first && 'shlCrumbWrapper--first',
          last && 'shlCrumbWrapper--last'
        )}
      >
        <Crumb item={item} last={last} inPopover={inPopover} />
      </div>
    );
    return first ? (
      <div key={index} className={names('shlCrumbWall', last && 'shlCrumbWall--single')}>
        {wrapper}
      </div>
    ) : (
      <Fragment key={index}>{wrapper}</Fragment>
    );
  });
}

/** The "…" in place of the crumbs left out, which opens them */
function Collapsed({ items }: { items: Item[] }) {
  const [open, setOpen] = useState(false);
  const label = 'Show collapsed breadcrumbs';
  return (
    <div className="shlCrumbWrapper shlCrumbWrapper--collapsed">
      <HeaderPopover
        className="shlCrumb shlCrumb--collapsed"
        anchorPosition="downCenter"
        inText
        open={open}
        onClose={() => setOpen(false)}
        button={
          <button
            type="button"
            className="shlCrumb__more"
            aria-label={label}
            title={label}
            onClick={() => setOpen(!open)}
          >
            {'… '}
            <HeaderIcon name="chevronDown" className="shlCrumb__arrow" />
          </button>
        }
      >
        <nav className="shlCrumbs shlCrumbs--inPopover" aria-label="breadcrumb">
          {crumbElements(items, true)}
        </nav>
      </HeaderPopover>
    </div>
  );
}

/**
 * The header's trail. A page that set none gets the original's fall-back; `limit` is how many
 * crumbs the window's width allows (see `useBreadcrumbLimit`).
 */
export function HeaderBreadcrumbs({ breadcrumbs, limit }: { breadcrumbs: Breadcrumb[]; limit: number }) {
  const trail = breadcrumbs.length === 0 ? [{ text: APP_TITLE_FALLBACK }] : breadcrumbs;
  const items = trail.map((crumb, index) => ({
    crumb,
    subject: breadcrumbTestSubject(index, trail.length),
  }));
  const elements = crumbElements(items, false);
  return (
    <nav className="shlCrumbs shlCrumbs--truncate shlHeader__crumbs" aria-label="breadcrumb" data-test-subj="breadcrumbs">
      {arrangeBreadcrumbs(items.length, limit).map((slot) =>
        slot.kind === 'crumb' ? (
          elements[slot.index]
        ) : (
          <Collapsed key="collapsed" items={slot.indexes.map((index) => items[index])} />
        )
      )}
    </nav>
  );
}

/** How many crumbs the window shows now; looked at again when it is resized, as the original */
export function useBreadcrumbLimit(): number {
  const [limit, setLimit] = useState(() => breadcrumbLimit(window.innerWidth));
  useEffect(() => {
    let timer: number | undefined;
    const update = () => setLimit(breadcrumbLimit(window.innerWidth));
    // At most every 50 ms, at once and once more after the last change
    const onResize = () => {
      if (timer !== undefined) return;
      update();
      timer = window.setTimeout(() => {
        timer = undefined;
        update();
      }, 50);
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.clearTimeout(timer);
    };
  }, []);
  return limit;
}

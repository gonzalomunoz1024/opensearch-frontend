/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The custom banner of the advanced settings (notifications:banner), as OpenSearch Dashboards
 * shows it above every page: a call-out named "Attention" with the text in markdown and a button
 * that closes it, which also closes once its lifetime (notifications:lifetime:banner) has passed.
 * A change of either setting shows it again.
 */

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Button } from '../components/basic';
import { renderMarkdown } from '../lib/markdown';
import { services } from '../services';

/** The longest a browser's timer waits: a longer lifetime, Infinity among them, has no countdown */
const MAX_TIMEOUT = 2 ** 31 - 1;

export interface UserBanner {
  text: string;
  /** After how many milliseconds it closes; undefined when it stays until it is closed */
  closesAfter?: number;
}

/**
 * The banner the two settings make, read as the original reads them: none without a text or
 * without a lifetime that is a number. (The original hands Infinity, which its description offers
 * to keep the banner, to a timer that then closes it at once; here it keeps the banner.)
 */
export function userBannerOf(content: unknown, lifetime: unknown): UserBanner | undefined {
  if (typeof content !== 'string' || content.length === 0 || typeof lifetime !== 'number') return undefined;
  // A lifetime that is not a positive number closes it at once, as the original's timer does
  const closesAfter = lifetime > MAX_TIMEOUT ? undefined : lifetime > 0 ? lifetime : 0;
  return { text: content.trim(), closesAfter };
}

/** The theme's help icon, a life ring, which this product's icons do not have */
function LifeRingIcon() {
  return (
    <svg className="atlIcon shlBanner__icon" viewBox="0 0 16 16" aria-hidden>
      <circle cx="8" cy="8" r="6" />
      <circle cx="8" cy="8" r="2.5" />
      <path d="M3.75 3.75l2.5 2.5M12.25 3.75l-2.5 2.5M3.75 12.25l2.5-2.5M12.25 12.25l-2.5-2.5" />
    </svg>
  );
}

export function UserBannerList() {
  const { uiSettings } = services;
  const version = useSyncExternalStore(uiSettings.subscribe, uiSettings.getVersion);
  const content = useMemo(() => uiSettings.get<unknown>('notifications:banner'), [uiSettings, version]);
  const lifetime = useMemo(() => uiSettings.get<unknown>('notifications:lifetime:banner'), [uiSettings, version]);
  const banner = userBannerOf(content, lifetime);
  const [closed, setClosed] = useState(false);

  // Shown again whenever either setting changes, and closed once its lifetime has passed
  useEffect(() => {
    setClosed(false);
    const after = userBannerOf(content, lifetime)?.closesAfter;
    if (after === undefined) return undefined;
    const timer = window.setTimeout(() => setClosed(true), after);
    return () => window.clearTimeout(timer);
  }, [content, lifetime]);

  if (!banner || closed) return null;
  return (
    <div id="globalBannerList" className="shlBanners">
      <div className="shlBanner" role="status" data-test-subj="userBanner">
        <p className="shlBanner__title">
          <LifeRingIcon />
          <span>Attention</span>
        </p>
        <div className="shlBanner__text">
          {renderMarkdown(banner.text)}
          <Button className="shlBanner__close" onClick={() => setClosed(true)} testId="userBannerCloseButton">
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}

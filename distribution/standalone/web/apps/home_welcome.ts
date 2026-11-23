/* SPDX-License-Identifier: Apache-2.0 */

/*
 * When the first page shows its welcome screen, as the home plugin of OpenSearch Dashboards
 * decides it: on a new instance (no index pattern yet), unless the server's settings turn it off
 * (home.disableWelcomeScreen) or the user chose "Explore on my own" in this browser.
 */

/** Where a browser keeps that its user put the welcome screen aside: 'false' then */
export const WELCOME_KEY = 'home:welcome:show';

/** How long the page waits for its answer: a later one shows the page without the welcome screen */
export const WELCOME_TIMEOUT_MS = 500;

export interface WelcomeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The question the original asks: is there any index pattern at all */
export const INDEX_PATTERN_QUERY = {
  type: 'index-pattern',
  fields: ['title'],
  search: '*',
  searchFields: ['title'],
  perPage: 1,
};

/** Whether the welcome screen may show at all, before asking whether the instance is new */
export function welcomeEnabled(disabledBySettings: boolean, storage: WelcomeStorage | undefined): boolean {
  if (disabledBySettings) return false;
  try {
    return storage?.getItem(WELCOME_KEY) !== 'false';
  } catch {
    // A browser that keeps nothing shows it each time, as it cannot keep that it was put aside
    return true;
  }
}

/** "Explore on my own": the welcome screen does not show again in this browser */
export function putWelcomeAside(storage: WelcomeStorage | undefined): void {
  try {
    storage?.setItem(WELCOME_KEY, 'false');
  } catch {
    // Nothing is kept: it shows again on the next visit
  }
}

/**
 * Whether the instance is new: the answer says there is no index pattern. An answer that comes
 * after the timeout, or a failed request, counts as not new, so that the page shows itself.
 */
export function isNewInstance(
  find: () => Promise<{ total: number }>,
  timeoutMs: number = WELCOME_TIMEOUT_MS
): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    find().then(
      (answer) => {
        clearTimeout(timer);
        resolve(answer.total === 0);
      },
      () => {
        clearTimeout(timer);
        resolve(false);
      }
    );
  });
}

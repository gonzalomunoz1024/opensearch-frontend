/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The address of the home application and of the overview, as the original's hash router keeps
 * it: always with a fragment.
 */

import { getLocation, navigate } from '../router';

/**
 * Gives an address with no fragment the "#/" the original's hash router gives it (`/app/home`
 * becomes `/app/home#/`), where the browser is and with no new entry in the history
 */
export function slashHash() {
  if (window.location.hash !== '') return;
  const { pathname, search } = getLocation();
  navigate(`${pathname}${search ? `?${search}` : ''}#/`, { replace: true, force: true });
}

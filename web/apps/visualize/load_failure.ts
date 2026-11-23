/* SPDX-License-Identifier: Apache-2.0 */

/*
 * What the Visualize editor does when what it opens cannot be loaded, as OpenSearch Dashboards
 * 3.9.0's `useSavedVisInstance` does it. A saved object that is missing is told in a warning,
 * "Saved object is missing", and the editor goes where it can be dealt with
 * (`redirectWhenMissing`): to the landing page of Visualize for the visualization itself, in place
 * of the editor in the history, or, for its saved search or its index pattern, to the
 * visualization's page among the saved objects, in a new entry. Anything else is told as "Failed
 * to load the visualization", and the landing page takes the editor's place.
 */

import { appUrl } from '../../lib/url';
import { HttpFetchError, errorMessage } from '../../services/http';

const VISUALIZE_APP = '/app/visualize';
/** The saved objects of management, where the original sends a visualization whose sources are gone */
const SAVED_OBJECTS = '/app/management/opensearch-dashboards/objects';

/** Where the original's index pattern service asks for a missing pattern to be made again */
export const INDEX_PATTERNS_LINK = 'management/opensearch-dashboards/indexPatterns';

/** The original's `SavedObjectNotFound`: a saved object that was looked for and is not there */
export class SavedObjectNotFound extends Error {
  constructor(
    readonly savedObjectType: string,
    readonly savedObjectId?: string,
    link?: string
  ) {
    super(
      `Could not locate that ${savedObjectType}${savedObjectId ? ` (id: ${savedObjectId})` : ''}${
        link ? `, [click here to re-create it](${link})` : ''
      }`
    );
    this.name = 'SavedObjectNotFound';
  }
}

/** A saved object fetched, its absence told as the original tells it */
export async function found<T>(type: string, id: string, fetch: () => Promise<T>, link?: string): Promise<T> {
  try {
    return await fetch();
  } catch (failure) {
    throw failure instanceof HttpFetchError && failure.status === 404 ? new SavedObjectNotFound(type, id, link) : failure;
  }
}

export interface LoadFailure {
  /** The warning's title, and its text */
  title: string;
  text: string;
  /** Where the editor goes: a path of this product */
  to: string;
  /** Whether that takes the editor's place in the history, or comes after it */
  replace: boolean;
}

// The types whose absence the original sends to the visualization's page among the saved objects
const TO_SAVED_OBJECTS = ['search', 'index-pattern', 'index-pattern-field'];

/**
 * What the editor of `savedId` (none for a new one) says and where it goes when loading failed;
 * `globalParam` is the `_g` of now, which the landing page's address takes as the original's does
 */
export function loadFailure(failure: unknown, savedId: string | undefined, globalParam: string | undefined): LoadFailure {
  if (!(failure instanceof SavedObjectNotFound)) {
    return { title: 'Failed to load the visualization', text: errorMessage(failure), to: appUrl(VISUALIZE_APP, '/', { _g: globalParam }), replace: true };
  }
  const title = 'Saved object is missing';
  const type = failure.savedObjectType;
  if (TO_SAVED_OBJECTS.includes(type)) {
    // The message as it is, which the browser encodes; a new visualization's id is `undefined`, as
    // the original writes it
    const to = `${SAVED_OBJECTS}/savedVisualizations/${String(savedId)}?notFound=${type}&notFoundMessage=${failure.message}`;
    return { title, text: failure.message, to, replace: false };
  }
  return {
    title,
    text: failure.message,
    to: appUrl(VISUALIZE_APP, '/', { notFound: type, notFoundMessage: failure.message, _g: globalParam }),
    replace: true,
  };
}

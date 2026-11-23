/* SPDX-License-Identifier: Apache-2.0 */

/*
 * What the Visualize editor and the application that opened it hand each other, as OpenSearch
 * Dashboards 3.9.0's embeddable state transfer does it (`embeddable/public/lib/state_transfer`):
 * in the state of the history's entry, never in the address.
 *
 * - A dashboard opens the editor with `{ originatingApp: 'dashboards', embeddableId,
 *   containerInfo: { containerName, containerId } }` from a panel's "Edit visualization", or with
 *   `{ originatingApp: 'dashboards', containerInfo: { containerId, containerName } }` from "Create
 *   new" (the New Visualization dialog passes it on when a kind is chosen).
 * - The editor reads it when it opens, and its first write of `_a` replaces the entry without it,
 *   as the original's does: a reload or a step back then opens a plain editor.
 * - A visualization saved new (or as a copy) goes back with the package `{ type: 'visualization',
 *   input: { savedObjectId }, containerInfo }`, which the dashboard adds as a panel; one saved in
 *   place, and Cancel, go back with nothing. Either goes to where the dashboard was: its last
 *   address, which the original's URL tracker keeps in the session's storage
 *   (`lastUrl:<basePath>:dashboard`), with the time of now. The by-reference editor never sends
 *   an `embeddableId` back, as the original's does not: the dashboard reloads the panel it had.
 */

import { appUrl, buildHash, parseHash } from '../../lib/url';
import { locationState } from '../../router';

/** Where the editor was opened from: the original's `ContainerInfo` */
export interface ContainerInfo {
  /** The id of the dashboard; '' for one not saved yet */
  containerId?: string;
  containerName?: string;
  /** What the container wants back untouched */
  containerData?: Record<string, unknown>;
}

/** What an application hands the editor it opens: the original's `EmbeddableEditorState` */
export interface EmbeddableEditorState {
  originatingApp: string;
  embeddableId?: string;
  valueInput?: unknown;
  containerInfo?: ContainerInfo;
}

/** What the editor hands back: the original's `EmbeddablePackageState` */
export interface EmbeddablePackageState {
  type: string;
  input: { savedObjectId: string };
  embeddableId?: string;
  containerInfo?: ContainerInfo;
}

export const VISUALIZE_EMBEDDABLE_TYPE = 'visualization';

/** The original's `isEmbeddableEditorState`: a state that names the application to go back to */
export function isEmbeddableEditorState(state: unknown): state is EmbeddableEditorState {
  return state !== null && typeof state === 'object' && typeof (state as { originatingApp?: unknown }).originatingApp === 'string';
}

/** What the application that opened the editor handed it, in the entry of the history */
export function incomingEditorState(): EmbeddableEditorState | undefined {
  const state = locationState<unknown>();
  return isEmbeddableEditorState(state) ? state : undefined;
}

/** The state the New Visualization dialog opens the editor with: none unless an application waits for it */
export function editorStateFor(originatingApp: string | undefined, containerInfo?: ContainerInfo): EmbeddableEditorState | undefined {
  if (!originatingApp) return undefined;
  return { originatingApp, ...(containerInfo ? { containerInfo } : {}) };
}

/** What a visualization saved new goes back with, to be added to the dashboard */
export function visualizationPackage(savedObjectId: string, containerInfo?: ContainerInfo): EmbeddablePackageState {
  return { type: VISUALIZE_EMBEDDABLE_TYPE, input: { savedObjectId }, ...(containerInfo ? { containerInfo } : {}) };
}

/** The applications whose last address the original keeps, by the key of its URL tracker */
const TRACKED: Record<string, { path: string; key: string }> = {
  dashboards: { path: '/app/dashboards', key: 'dashboard' },
};

const readStored = (storage: Pick<Storage, 'getItem'> | undefined, key: string): string | undefined => {
  try {
    return storage?.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
};

/** Whether a dashboard's address is that of the dashboard the editor came from */
function isContainer(hashPath: string, containerId: string): boolean {
  if (containerId === '') return hashPath === '/create';
  return hashPath === `/view/${encodeURIComponent(containerId)}` || hashPath === `/view/${containerId}`;
}

/**
 * The address the editor goes back to: the original's `navigateToApp(originatingApp)`, which
 * opens the application where it was last. `globalParam` is the `_g` of now.
 */
export function originatingAppUrl(
  appId: string,
  options: { containerInfo?: ContainerInfo; globalParam?: string; basePath?: string; storage?: Pick<Storage, 'getItem'> } = {}
): string {
  const tracked = TRACKED[appId];
  if (!tracked) return `/app/${appId}`;
  const { containerInfo, globalParam } = options;
  const containerId = containerInfo?.containerId;
  const stored = readStored(options.storage, `lastUrl:${options.basePath ?? ''}:${tracked.key}`);
  if (stored?.startsWith('#')) {
    const { hashPath, hashParams } = parseHash(stored);
    if (containerId === undefined || isContainer(hashPath, containerId)) {
      return `${tracked.path}${buildHash(hashPath, { ...hashParams, _g: globalParam ?? hashParams._g })}`;
    }
  }
  if (containerId === undefined) return appUrl(tracked.path, '/', { _g: globalParam });
  if (containerId === '') return appUrl(tracked.path, '/create', { _g: globalParam });
  // The dashboard was being edited: it opens in edit mode again
  return appUrl(tracked.path, `/view/${encodeURIComponent(containerId)}`, { _g: globalParam, _a: { viewMode: 'edit' } });
}

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
 *   place, and Cancel, go back with nothing. Either goes to where the dashboard was, as the
 *   original's `navigateToApp(originatingApp)` does: its last address, which the original's URL
 *   tracker keeps in the session's storage (`lastUrl:<basePath>:dashboard`) and the router here
 *   under the same key (`lastAddressOf`), so that what was changed on the dashboard and not saved
 *   yet is still there. The by-reference editor never sends an `embeddableId` back, as the
 *   original's does not: the dashboard draws the panel it had again, from the visualization as it
 *   is now saved.
 */

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

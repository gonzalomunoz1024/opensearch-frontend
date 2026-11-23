/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The Visualize editor's top navigation as OpenSearch Dashboards 3.9.0 builds it
 * (`getLegacyTopNavConfig` in `get_top_nav_config.tsx`, with the new home page off): its items, in
 * their order, with their texts, when they are greyed out and the tooltips they then show, and the
 * question asked when the editor is left (`visualize_top_nav.tsx`).
 */

import type { IconName } from '../../components/icon';

/** The applications that open the editor and wait for it to come back (the original's list) */
const RETURNING_APPS = ['dashboards', 'canvas'];

/** The names of the applications an editor can return to, as the original's application list has them */
const APP_NAMES: Record<string, string> = { dashboards: 'Dashboards' };

/** `getAppNameFromId`: the name of an application, or its id when it has none */
export const appName = (appId: string): string => APP_NAMES[appId] ?? appId;

export interface TopNavState {
  /** Something changed since the visualization was loaded or saved: the original's `hasUnsavedChanges` */
  hasUnsavedChanges: boolean;
  /** The sidebar holds changes Update has not applied: the original's `hasUnappliedChanges` */
  hasUnappliedChanges: boolean;
  /** The application that opened the editor and expects it back, from the location's state */
  originatingApp?: string;
  /** The id of the saved visualization; none for a new one */
  savedId?: string;
  /** Whether the visualization has requests the inspector can show */
  hasInspector: boolean;
}

export type TopNavAction = 'inspect' | 'share' | 'cancel' | 'save' | 'saveAndReturn';

export interface VisualizeTopNavItem {
  id: TopNavAction;
  label: string;
  /** Drawn as a button rather than a link */
  emphasize: boolean;
  icon?: IconName;
  disabled: boolean;
  /** What a tooltip says over it, when the original shows one */
  tooltip?: string;
  testId: string;
}

/** The items of the top navigation, in their order */
export function visualizeTopNav(state: TopNavState): VisualizeTopNavItem[] {
  const { hasUnsavedChanges, hasUnappliedChanges, originatingApp, savedId, hasInspector } = state;
  const items: VisualizeTopNavItem[] = [
    {
      id: 'inspect',
      label: 'Inspect',
      emphasize: false,
      disabled: !hasInspector,
      tooltip: hasInspector ? undefined : "This visualization doesn't support any inspectors.",
      testId: 'openInspectorButton',
    },
    { id: 'share', label: 'Share', emphasize: false, disabled: false, testId: 'shareTopNavButton' },
  ];
  if (originatingApp && RETURNING_APPS.includes(originatingApp)) {
    items.push({
      id: 'cancel',
      label: 'Cancel',
      emphasize: false,
      disabled: false,
      tooltip: hasUnappliedChanges || hasUnsavedChanges ? 'Discard your changes before finishing' : undefined,
      testId: 'visualizeCancelAndReturnButton',
    });
  }
  // A saved visualization opened from another application is saved in place by "Save and return":
  // "Save" is then the way to a copy, "Save as"
  const saveAs = Boolean(savedId && originatingApp);
  items.push({
    id: 'save',
    label: saveAs ? 'Save as' : 'Save',
    emphasize: !savedId || !originatingApp,
    icon: saveAs ? undefined : 'save',
    disabled: hasUnappliedChanges,
    tooltip: hasUnappliedChanges ? 'Apply or Discard your changes before saving' : undefined,
    testId: 'visualizeSaveButton',
  });
  if (originatingApp && savedId) {
    items.push({
      id: 'saveAndReturn',
      label: 'Save and return',
      emphasize: true,
      icon: 'checkInCircleFilled',
      disabled: hasUnappliedChanges,
      tooltip: hasUnappliedChanges ? 'Apply or Discard your changes before finishing' : undefined,
      testId: 'visualizesaveAndReturnButton',
    });
  }
  return items;
}

/** What the original's leave confirmation says */
export const LEAVE_TITLE = 'Unsaved changes';
export const LEAVE_TEXT = 'Leave Visualize editor with unsaved changes?';

/**
 * Whether leaving the editor for another application asks first: only when a dashboard (or
 * canvas) opened it and something is not applied or not saved
 */
export function confirmsLeave(state: Pick<TopNavState, 'originatingApp' | 'hasUnappliedChanges' | 'hasUnsavedChanges'>): boolean {
  return Boolean(
    state.originatingApp && RETURNING_APPS.includes(state.originatingApp) && (state.hasUnappliedChanges || state.hasUnsavedChanges)
  );
}

/**
 * The switch of the save dialog that goes back to the application that opened the editor:
 * whether it shows, and what it says. A new visualization, or a copy, is added; one saved in
 * place is returned to. A copy is not taken back to anything but a dashboard.
 */
export function returnSwitch(originatingApp: string | undefined, savedId: string | undefined, asNew: boolean): { shown: boolean; label: string } {
  if (!originatingApp) return { shown: false, label: '' };
  const verb = !savedId || asNew ? 'Add' : 'Return';
  return { shown: !asNew || originatingApp === 'dashboards', label: `${verb} to ${appName(originatingApp)} after saving` };
}

/* SPDX-License-Identifier: Apache-2.0 */

/*
 * What the advanced settings page of OpenSearch Dashboards 3.9.0 makes of the settings: the rows
 * it shows (every setting of the global scope that is not read-only, and the custom ones), their
 * order and sections, the value a field shows, the default it names, and what a change is saved
 * as. Workspaces and permissions are off, as in this product.
 */

import { settingScopes, settingType, type SettingDefinition } from '../../services/ui_settings';

/** A row of the page, as the original's: the search runs on these fields */
export interface FieldSetting {
  name: string;
  displayName: string;
  ariaName: string;
  /** What is stored; undefined when nothing is */
  value: unknown;
  category: string[];
  isCustom: boolean;
  isOverridden: boolean;
  isPermissionControlled: boolean;
  isUserProvided: undefined;
  inheritedValue: undefined;
  readonly: boolean;
  defVal: unknown;
  scope: string | string[] | undefined;
  type: string;
  description: string | undefined;
  deprecation: SettingDefinition['deprecation'];
  validation: undefined;
  options: Array<string | number> | undefined;
  optionLabels: Record<string, string> | undefined;
  requiresPageReload: boolean;
  preferBrowserSetting: boolean;
}

/** What a field holds while it is not saved */
export interface FieldState {
  value: unknown;
  isInvalid?: boolean;
  error?: string;
}

export const DEFAULT_CATEGORY = 'general';
const ADMIN_CATEGORY = 'admin';

const CATEGORY_NAMES: Record<string, string> = {
  admin: 'Admin',
  general: 'General',
  appearance: 'Appearance',
  timeline: 'Timeline',
  notifications: 'Notifications',
  visualizations: 'Visualizations',
  visbuilder: 'VisBuilder',
  discover: 'Discover',
  dashboard: 'Dashboard',
  reporting: 'Reporting',
  search: 'Search',
  securitySolution: 'Security Solution',
};

export function categoryName(category?: string): string {
  if (!category) return '';
  return CATEGORY_NAMES[category] ?? category.replace(/^./, (first) => first.toUpperCase());
}

// The words of a name as lodash finds them: `dateFormat:tz` is date, Format and tz
const WORDS = /[A-Z]?[a-z]+(?=[^A-Za-z0-9]|[A-Z]|$)|[A-Z]+(?=[^A-Za-z0-9]|[A-Z][a-z]|$)|[A-Z]?[a-z]+|[A-Z]+|[0-9]+/g;

/** A setting's key as words: `doc_table:highlight` is "doc table highlight" */
export function ariaName(name?: string): string {
  return (name ?? '').match(WORDS)?.map((word) => word.toLowerCase()).join(' ') ?? '';
}

export interface SettingsSource {
  definitions: Record<string, SettingDefinition>;
  /** What the server stores in the global scope */
  stored: Record<string, unknown>;
  isOverridden(key: string): boolean;
  /** theme:enableUserControl: the look is chosen in each browser */
  userControl: boolean;
  /** The default in effect, the server's settings file's or the registered one */
  defaultOf(key: string): unknown;
}

/** The page shows the settings of the global scope, and those only an administrator sets */
function onThePage(definition: SettingDefinition | undefined) {
  const scopes = settingScopes(definition);
  return scopes.includes('global') || scopes.includes('dashboard_admin');
}

/** The rows of the page, in the order it lists them: by key, as the characters sort */
export function toFieldSettings(source: SettingsSource): FieldSetting[] {
  const keys = new Set([...Object.keys(source.definitions), ...Object.keys(source.stored)]);
  const rows: FieldSetting[] = [];
  for (const name of keys) {
    const definition = source.definitions[name];
    if (!onThePage(definition) || definition?.readonly) continue;
    const isCustom = definition === undefined;
    const value = source.stored[name] === null ? undefined : source.stored[name];
    const defVal = isCustom ? undefined : source.defaultOf(name);
    rows.push({
      name,
      displayName: definition?.name || name,
      ariaName: definition?.name || ariaName(name),
      value,
      category: definition?.category && definition.category.length ? definition.category : [DEFAULT_CATEGORY],
      isCustom,
      isOverridden: source.isOverridden(name),
      isPermissionControlled: false,
      isUserProvided: undefined,
      inheritedValue: undefined,
      readonly: Boolean(definition?.readonly),
      defVal,
      scope: definition?.scope,
      type: settingType(definition ?? {}, value),
      description: definition?.description,
      deprecation: definition?.deprecation,
      validation: undefined,
      options: definition?.options,
      optionLabels: definition?.optionLabels,
      requiresPageReload: Boolean(definition?.requiresPageReload),
      preferBrowserSetting: source.userControl && Boolean(definition?.preferBrowserSetting),
    });
  }
  return rows.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** The rows by their first category */
export function groupByCategory(settings: FieldSetting[]): Record<string, FieldSetting[]> {
  const groups: Record<string, FieldSetting[]> = {};
  for (const setting of settings) (groups[setting.category[0]] ??= []).push(setting);
  return groups;
}

/** The sections in the page's order: the administrators', General, then the others by key */
export function orderCategories(categories: string[]): string[] {
  return [...categories].sort((a, b) => {
    if (a === ADMIN_CATEGORY) return -1;
    if (b === ADMIN_CATEGORY) return 1;
    if (a === DEFAULT_CATEGORY) return -1;
    if (b === DEFAULT_CATEGORY) return 1;
    if (a > b) return 1;
    return a === b ? 0 : -1;
  });
}

/** What a field shows for a value: arrays as a list with commas, nothing as the default */
export function editableValue(type: string, value: unknown, defVal?: unknown): unknown {
  const val = value === null || value === undefined ? defVal : value;
  switch (type) {
    case 'array':
      return Array.isArray(val) ? val.join(', ') : String(val ?? '');
    case 'boolean':
      return Boolean(val);
    case 'number':
      return Number(val);
    case 'image':
      return val;
    default:
      return val || '';
  }
}

/** Whether the row shows its default: nothing stored, or the stored value reads as the default */
export function isDefaultValue(setting: Pick<FieldSetting, 'isCustom' | 'value' | 'defVal'>): boolean {
  return (
    setting.isCustom ||
    setting.value === undefined ||
    setting.value === '' ||
    String(setting.value) === String(setting.defVal)
  );
}

/** The default as the line "Default: …" names it */
export function displayedDefault(type: string, defVal: unknown, optionLabels: Record<string, string> = {}): string {
  if (defVal === undefined || defVal === null || defVal === '') return 'null';
  switch (type) {
    case 'array':
      return Array.isArray(defVal) ? defVal.join(', ') : String(defVal);
    case 'select':
      return Object.prototype.hasOwnProperty.call(optionLabels, String(defVal))
        ? optionLabels[String(defVal)]
        : String(defVal);
    default:
      return String(defVal);
  }
}

/** A JSON or markdown field's text as the change it is: an empty JSON field is `{}` or `[]` */
export function codeEditorChange(type: string, defVal: unknown, text: string): FieldState {
  if (type !== 'json') return { value: text };
  const isArray = Array.isArray(safeParse(typeof defVal === 'string' && defVal ? defVal : '{}'));
  const value = text.trim() || (isArray ? '[]' : '{}');
  try {
    JSON.parse(value);
    return { value };
  } catch {
    return { value, error: 'Invalid JSON syntax', isInvalid: true };
  }
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** A field's change as the value that is saved; `null` when it is the default */
export function valueToSave(setting: Pick<FieldSetting, 'type' | 'defVal'>, value: unknown): unknown {
  let saved = value;
  let equalsToDefault: boolean;
  switch (setting.type) {
    case 'array': {
      const text = String(value ?? '').trim();
      saved = text === '' ? [] : text.split(',').map((item) => item.trim());
      equalsToDefault =
        (saved as string[]).join(',') === (Array.isArray(setting.defVal) ? setting.defVal.join(',') : String(setting.defVal));
      break;
    }
    case 'json': {
      const isArray = Array.isArray(safeParse(typeof setting.defVal === 'string' && setting.defVal ? setting.defVal : '{}'));
      saved = String(value ?? '').trim() || (isArray ? '[]' : '{}');
      equalsToDefault = saved === setting.defVal;
      break;
    }
    default:
      equalsToDefault = saved === setting.defVal;
  }
  return equalsToDefault ? null : saved;
}

/** "1 unsaved setting", "3 unsaved settings, 2 hidden" */
export function unsavedCountText(count: number, hidden: number): string {
  return `${count} unsaved ${count === 1 ? 'setting' : 'settings'}${hidden === 0 ? '' : `, ${hidden} hidden`}`;
}

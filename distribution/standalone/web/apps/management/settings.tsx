/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Advanced settings: every setting this product reads, by category, with what it is now and a
 * way back to its default. Changes are kept on the page until they are saved together.
 */

import { useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Badge, Button, CallOut, EmptyPrompt, Panel } from '../../components/basic';
import { CodeEditor } from '../../components/code_editor';
import { NumberField, SearchField, Select, Switch, TextField } from '../../components/form';
import { services } from '../../services';
import type { SettingDefinition } from '../../services/ui_settings';
import { useBreadcrumbs } from '../../shell/state';

const CATEGORY_LABELS: Record<string, string> = {
  general: 'General',
  appearance: 'Appearance',
  search: 'Search',
  discover: 'Discover',
  notifications: 'Notifications',
  visualization: 'Visualization',
  accessibility: 'Accessibility',
  dashboard: 'Dashboard',
};
const categoryLabel = (category: string) => CATEGORY_LABELS[category] ?? category[0].toUpperCase() + category.slice(1);

/** A value as the text its field shows */
function toText(value: unknown, type: string): string {
  if (value === undefined || value === null) return '';
  if (type === 'array') return Array.isArray(value) ? value.join(', ') : String(value);
  if (type === 'json') {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    // Text someone laid out over several lines is shown as they laid it out
    if (text.includes('\n')) return text;
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return text;
    }
  }
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

/** The text of a field as the value that is stored, as OpenSearch Dashboards stores each kind */
function fromText(text: string, type: string): unknown {
  if (type === 'number') return Number(text);
  if (type === 'boolean') return text === 'true';
  if (type === 'array')
    return text
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  if (type === 'json') return text.trim();
  return text;
}

function problemOf(text: string, type: string): string | undefined {
  if (type === 'number' && (text.trim() === '' || Number.isNaN(Number(text)))) return 'A number is expected';
  if (type === 'json') {
    try {
      JSON.parse(text);
    } catch (failure) {
      return `Invalid JSON: ${(failure as Error).message}`;
    }
  }
  return undefined;
}

interface Row {
  key: string;
  definition: SettingDefinition;
  custom: boolean;
}

export function AdvancedSettings() {
  useBreadcrumbs([{ text: 'Dashboards Management', to: '/app/management' }, { text: 'Advanced settings' }]);
  const settings = services.uiSettings;
  useSyncExternalStore(settings.subscribe, settings.getVersion);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  /** Unsaved changes: the text of each changed field; `null` for one going back to its default */
  const [edits, setEdits] = useState<Record<string, string | null>>({});
  const [saving, setSaving] = useState(false);
  const [needsReload, setNeedsReload] = useState(false);

  const rows = useMemo<Row[]>(() => {
    const known = Object.entries(settings.definitions).map(([key, definition]) => ({ key, definition, custom: false }));
    return known.sort((a, b) => a.key.localeCompare(b.key));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.getVersion()]);

  const categories = useMemo(() => {
    const all = [...new Set(rows.map((row) => row.definition.category))];
    return all.sort((a, b) => (a === 'general' ? -1 : b === 'general' ? 1 : a.localeCompare(b)));
  }, [rows]);

  const needle = search.trim().toLowerCase();
  const shown = rows.filter(
    (row) =>
      (!category || row.definition.category === category) &&
      (!needle || `${row.key} ${row.definition.name} ${row.definition.description}`.toLowerCase().includes(needle))
  );

  const problems: Record<string, string> = {};
  for (const [key, text] of Object.entries(edits)) {
    if (text === null) continue;
    const problem = problemOf(text, settings.definitions[key]?.type ?? 'string');
    if (problem) problems[key] = problem;
  }
  const changed = Object.keys(edits).length;

  const edit = (row: Row, text: string | null) => {
    const stored = toText(settings.userValue(row.key) ?? settings.defaultOf(row.key), row.definition.type);
    const next = { ...edits };
    // Back to what is stored is no change at all
    if (text !== null && text === stored) delete next[row.key];
    else if (text === null && settings.isDefault(row.key)) delete next[row.key];
    else next[row.key] = text;
    setEdits(next);
  };

  const save = async () => {
    setSaving(true);
    try {
      const changes: Record<string, unknown> = {};
      for (const [key, text] of Object.entries(edits)) {
        const type = settings.definitions[key]?.type ?? 'string';
        // A field emptied of a setting that has a default goes back to the default
        changes[key] = text === null || (text === '' && type !== 'string') ? null : fromText(text, type);
      }
      await settings.setMany(changes);
      if (Object.keys(changes).some((key) => settings.definitions[key]?.requiresPageReload)) setNeedsReload(true);
      setEdits({});
      services.toasts.success(changed === 1 ? 'The setting was saved' : `${changed} settings were saved`);
    } catch (failure) {
      services.toasts.error(failure, 'The settings could not be saved');
    }
    setSaving(false);
  };

  const control = (row: Row): ReactNode => {
    const { key, definition } = row;
    const overridden = settings.isOverridden(key);
    const pending = edits[key];
    const stored = settings.userValue(key) ?? settings.defaultOf(key);
    const text = pending === null ? toText(settings.defaultOf(key), definition.type) : (pending ?? toText(stored, definition.type));
    const testId = `advancedSetting-editField-${key}`;
    if (definition.type === 'boolean') {
      const on = text === 'true';
      return <Switch checked={on} onChange={(checked) => edit(row, String(checked))} label={on ? 'On' : 'Off'} disabled={overridden} testId={testId} />;
    }
    if (definition.type === 'select') {
      return (
        <Select
          value={text}
          onChange={(value) => edit(row, value)}
          disabled={overridden}
          options={(definition.options ?? []).map((option) => ({ value: option, label: definition.optionLabels?.[option] ?? option }))}
          testId={testId}
        />
      );
    }
    if (definition.type === 'json') {
      return <CodeEditor value={text} onChange={(value) => edit(row, value)} readOnly={overridden} minLines={3} maxLines={16} ariaLabel={key} testId={testId} />;
    }
    if (definition.type === 'number') {
      return (
        <NumberField
          value={text === '' || Number.isNaN(Number(text)) ? '' : Number(text)}
          onChange={(value) => edit(row, value === undefined ? '' : String(value))}
          disabled={overridden}
          invalid={Boolean(problems[key])}
          testId={testId}
        />
      );
    }
    return <TextField value={text} onChange={(value) => edit(row, value)} disabled={overridden} testId={testId} />;
  };

  return (
    <div className="mgtPage mgtSettings" data-test-subj="managementSettings">
      <div className="mgtSettings__head">
        <h1 className="atlTitleL atlGrow">Settings</h1>
        <div className="mgtSettings__search">
          <SearchField value={search} onChange={setSearch} placeholder="Search..." aria-label="Search advanced settings" testId="settingsSearchBar" />
        </div>
        <Select
          value={category}
          onChange={setCategory}
          aria-label="Category"
          options={[{ value: '', label: 'Category' }, ...categories.map((item) => ({ value: item, label: categoryLabel(item) }))]}
          style={{ width: 170 }}
        />
      </div>
      <CallOut tone="warning" title="Caution: You can break stuff here">
        Be careful in here, these settings are for very advanced users only. Tweaks you make here can break large portions of {services.boot.name}.
        Some of these settings may be undocumented, unsupported or experimental. If a field has a default value, blanking the field will reset it to
        its default which may be unacceptable given other configuration directives.
      </CallOut>
      {needsReload && (
        <CallOut title="One or more settings require you to reload the page to take effect.">
          <Button size="s" onClick={() => window.location.reload()}>
            Reload page
          </Button>
        </CallOut>
      )}
      {shown.length === 0 && (
        <Panel>
          <EmptyPrompt
            title="No settings found"
            actions={
              <Button
                onClick={() => {
                  setSearch('');
                  setCategory('');
                }}
              >
                Clear search
              </Button>
            }
          />
        </Panel>
      )}
      {categories
        .filter((item) => shown.some((row) => row.definition.category === item))
        .map((item) => (
          <Panel key={item} className="mgtSettings__category">
            <h2 className="atlTitleM">{categoryLabel(item)}</h2>
            {shown
              .filter((row) => row.definition.category === item)
              .map((row) => {
                const { key, definition } = row;
                const overridden = settings.isOverridden(key);
                const pending = key in edits;
                const isDefault = pending ? edits[key] === null : settings.isDefault(key);
                return (
                  <div key={key} className={`mgtSetting${pending ? ' mgtSetting--changed' : ''}`} data-test-subj={`advancedSetting-${key}`}>
                    <div className="mgtSetting__about">
                      <h3 className="mgtSetting__name">
                        {definition.name}
                        {!settings.isDefault(key) && !overridden && <Badge tone="accent">Custom</Badge>}
                      </h3>
                      <p className="atlSubdued">{definition.description}</p>
                      {!isDefault && !overridden && definition.type !== 'json' && (
                        <p className="atlSubdued atlSmall">
                          Default: <code>{toText(settings.defaultOf(key), definition.type) || 'null'}</code>
                        </p>
                      )}
                    </div>
                    <div className="mgtSetting__field">
                      <span className="mgtSetting__key">{key}</span>
                      {control(row)}
                      {problems[key] && <span className="atlFormRow__error">{problems[key]}</span>}
                      {overridden ? (
                        <span className="atlSubdued atlSmall">This setting is overridden by the server and can not be changed.</span>
                      ) : (
                        !isDefault && (
                          <button type="button" className="mgtSetting__reset" onClick={() => edit(row, null)} data-test-subj={`advancedSetting-resetField-${key}`}>
                            Reset to default
                          </button>
                        )
                      )}
                    </div>
                  </div>
                );
              })}
          </Panel>
        ))}
      {changed > 0 && (
        <div className="mgtSaveBar" data-test-subj="advancedSetting-bottomBar">
          <span className="atlGrow">
            {changed} unsaved {changed === 1 ? 'setting' : 'settings'}
          </span>
          <Button variant="empty" onClick={() => setEdits({})} testId="advancedSetting-cancelButton">
            Cancel changes
          </Button>
          <Button variant="primary" loading={saving} disabled={Object.keys(problems).length > 0} onClick={save} testId="advancedSetting-saveButton">
            Save changes
          </Button>
        </div>
      )}
    </div>
  );
}

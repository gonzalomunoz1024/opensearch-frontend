/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Advanced settings, as OpenSearch Dashboards 3.9.0 shows them with workspaces and permissions
 * off: every setting of the global scope, by category, with a search in its search bar's
 * language. Changes are kept on the page, marked, until they are saved together from the bar at
 * the bottom; a setting that takes effect on the next page load asks for a reload once saved.
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../../components/basic';
import { Icon } from '../../components/icon';
import { Tooltip } from '../../components/overlay';
import { executeQuery, parseQuery, QuerySyntaxError, type QueryClause } from '../../lib/search_query';
import { useLocation } from '../../router';
import { services } from '../../services';
import { errorMessage } from '../../services/http';
import { useBreadcrumbs } from '../../shell/state';
import { managementTrail } from './frame';
import { Field } from './settings_field';
import {
  ariaName,
  categoryName,
  editableValue,
  groupByCategory,
  orderCategories,
  toFieldSettings,
  unsavedCountText,
  valueToSave,
  type FieldSetting,
  type FieldState,
} from './settings_model';
import { SettingsSearch } from './settings_search';

function readQuery(text: string): { clauses: QueryClause[]; error?: string } {
  try {
    return { clauses: parseQuery(text) };
  } catch (failure) {
    if (failure instanceof QuerySyntaxError) return { clauses: [], error: failure.message };
    throw failure;
  }
}

/** The rows of the page from what the server stores in the global scope */
function currentSettings(): FieldSetting[] {
  const client = services.uiSettings;
  const stored: Record<string, unknown> = {};
  for (const key of client.storedKeys()) stored[key] = client.storedValue(key);
  // A value the server's settings file sets is what the server answers for the setting
  for (const key of client.overriddenKeys()) stored[key] = client.userValue(key);
  return toFieldSettings({
    definitions: client.definitions,
    stored,
    isOverridden: (key) => client.isOverridden(key),
    userControl: client.userControl(),
    defaultOf: (key) => client.defaultOf(key),
  });
}

/** Read to a screen reader when the search changes: how many settings it shows, in how many sections */
function VoiceAnnouncement({ queryText, visible }: { queryText: string; visible: Record<string, FieldSetting[]> }) {
  const sections = Object.keys(visible).length;
  const options = Object.values(visible).reduce((sum, list) => sum + list.length, 0);
  const counts = `There ${options === 1 ? 'is 1 option' : `are ${options} options`} in ${
    sections === 1 ? '1 section' : `${sections} sections`
  }`;
  const message = queryText ? `You searched for ${queryText}. ${counts}` : counts;
  const [shown, setShown] = useState<string>();
  const latest = useRef(message);
  latest.current = message;
  // Said once the typing has paused, as the original's
  useEffect(() => {
    setShown(undefined);
    const timer = window.setTimeout(() => setShown(latest.current), 500);
    return () => window.clearTimeout(timer);
  }, [queryText]);
  return (
    <div className="atlScreenReaderOnly">
      <div role="region" aria-live="polite" aria-label="Advanced Settings results info">
        {shown}
      </div>
    </div>
  );
}

function CallOuts() {
  return (
    <div className="mgtSettingsCallOut" role="status">
      <p className="mgtSettingsCallOut__title">
        {/* The theme's bolt: a thin line, not the filled one of this product's icons */}
        <svg className="atlIcon mgtSettingsCallOut__icon" viewBox="0 0 16 16" aria-hidden>
          <path d="M8.75 1.5L4.75 8.25h4.5L7.25 14.5" />
        </svg>
        <span>Caution: You can break stuff here</span>
      </p>
      <p className="mgtSettingsCallOut__text">
        Be careful in here, these settings are for very advanced users only. Tweaks you make here can break large
        portions of OpenSearch Dashboards. Some of these settings may be undocumented, unsupported or experimental. If a
        field has a default value, blanking the field will reset it to its default which may be unacceptable given other
        configuration directives. Deleting a custom setting will permanently remove it from OpenSearch Dashboards&apos;s
        config.
      </p>
    </div>
  );
}

function BottomBar({
  count,
  hidden,
  invalid,
  saving,
  onCancel,
  onSave,
}: {
  count: number;
  hidden: number;
  invalid: boolean;
  saving: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  const wrapper = document.getElementById('app-wrapper');
  if (!wrapper) return null;
  const save = (
    <Button
      className="mgtBottomBar__save"
      icon="check"
      loading={saving}
      disabled={invalid}
      onClick={onSave}
      aria-describedby="aria-describedby.countOfUnsavedSettings"
      testId="advancedSetting-saveButton"
    >
      Save changes
    </Button>
  );
  return createPortal(
    <section className="mgtBottomBar" data-test-subj="advancedSetting-bottomBar" aria-label="Page level controls">
      <p id="aria-describedby.countOfUnsavedSettings" className="mgtBottomBar__count">
        <span className="mgtBottomBar__countText">{unsavedCountText(count, hidden)}</span>
      </p>
      <Button
        variant="ghost"
        className="mgtBottomBar__cancel"
        icon="cross"
        onClick={onCancel}
        aria-describedby="aria-describedby.countOfUnsavedSettings"
        testId="advancedSetting-cancelButton"
      >
        Cancel changes
      </Button>
      {invalid ? <Tooltip content="Fix invalid settings before saving.">{save}</Tooltip> : save}
    </section>,
    wrapper
  );
}

export function AdvancedSettings({ query = '' }: { query?: string }) {
  useBreadcrumbs(managementTrail(useLocation().pathname, [{ text: 'Advanced settings' }]));
  const client = services.uiSettings;
  const version = useSyncExternalStore(client.subscribe, client.getVersion);
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');

  // The search the address names (`…/settings/dateFormat:tz`), as words
  const initial = useMemo(() => {
    const text = query ? ariaName(query) : '';
    return { text, ...readQuery(text) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [text, setText] = useState(initial.text);
  const [clauses, setClauses] = useState<QueryClause[]>(initial.clauses);
  const [parseError, setParseError] = useState<string | undefined>(initial.error);

  const [unsaved, setUnsaved] = useState<Record<string, FieldState>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    client.refresh().then(
      () => live && setStatus('ready'),
      () => live && setStatus('failed')
    );
    return () => {
      live = false;
    };
  }, [client]);

  // The rows, again whenever a setting changes
  const settings = useMemo(() => currentSettings(), [version]); // eslint-disable-line react-hooks/exhaustive-deps
  const byName = useMemo(() => new Map(settings.map((setting) => [setting.name, setting])), [settings]);
  const grouped = useMemo(() => groupByCategory(settings), [settings]);
  const categories = useMemo(() => orderCategories(Object.keys(grouped)), [grouped]);
  const visible = useMemo(() => groupByCategory(executeQuery(clauses, settings)), [clauses, settings]);

  // A setting in the address (`#dateFormat:tz-group`, `#appearance`) is scrolled to once it shows
  useEffect(() => {
    if (status !== 'ready' || !window.location.hash) return;
    const element = document.getElementById(decodeURIComponent(window.location.hash.slice(1)));
    if (!element) return;
    element.scrollIntoView();
    const header = document.querySelector<HTMLElement>('.shlHeader');
    window.scrollBy(0, -(header?.offsetHeight ?? 0));
  }, [status]);

  const onText = (next: string) => {
    setText(next);
    const read = readQuery(next);
    setParseError(read.error);
    // A text that cannot be read keeps the last results
    if (read.error === undefined) setClauses(read.clauses);
  };
  const onClauses = (next: QueryClause[], nextText: string) => {
    setText(nextText);
    setClauses(next);
    setParseError(undefined);
  };
  const clearQuery = () => onClauses([], '');

  const handleChange = useCallback(
    (name: string, change: FieldState) => {
      const setting = byName.get(name);
      if (!setting) return;
      setUnsaved((current) => {
        const next = { ...current };
        // Back to what is saved is no change
        if (change.value === editableValue(setting.type, setting.value, setting.defVal)) delete next[name];
        else next[name] = change;
        return next;
      });
    },
    [byName]
  );

  const unsavedKeys = Object.keys(unsaved);
  const shownNames = new Set(Object.values(visible).flatMap((list) => list.map((setting) => setting.name)));
  const hiddenCount = unsavedKeys.filter((key) => !shownNames.has(key)).length;
  const invalid = Object.values(unsaved).some((change) => change.isInvalid);

  const saveAll = async () => {
    if (unsavedKeys.length === 0) return;
    setSaving(true);
    const changes: Record<string, unknown> = {};
    const reloadKeys = new Set<string>();
    for (const [name, change] of Object.entries(unsaved)) {
      const setting = byName.get(name);
      if (!setting) continue;
      if (setting.requiresPageReload) reloadKeys.add(name);
      changes[name] = valueToSave(setting, change.value);
    }
    const saved = Object.keys(changes);
    let failed: string[] = [];
    try {
      try {
        await client.setMany(changes);
      } catch (failure) {
        // Nothing is stored when the server refuses: every setting of the request stays unsaved
        failed = saved;
        services.toasts.danger('Unable to update UI setting', errorMessage(failure));
      }
      const failedSet = new Set(failed);
      setUnsaved((current) => {
        const remaining: Record<string, FieldState> = {};
        for (const [key, change] of Object.entries(current)) {
          if (failedSet.has(key) || !saved.includes(key)) remaining[key] = change;
        }
        return remaining;
      });
      if (failed.length > 0) {
        const names = failed.map((key) => byName.get(key)?.displayName || key).join(', ');
        services.toasts.danger(`Unable to save ${failed.length === 1 ? 'setting' : 'settings'}: ${names}`);
      }
      if (saved.some((key) => reloadKeys.has(key) && !failedSet.has(key))) {
        services.toasts.success(
          'One or more settings require you to reload the page to take effect.',
          <div className="mgtReloadToast">
            <Button variant="tint" onClick={() => window.location.reload()}>
              Reload page
            </Button>
          </div>
        );
      }
    } catch {
      services.toasts.danger('Unable to save');
    }
    setSaving(false);
  };

  const shownCategories = categories.filter((category) => (visible[category]?.length ?? 0) > 0);

  return (
    <div className="mgtPage mgtSettings" data-test-subj="managementSettings">
      <div className="mgtSettings__header">
        <div className="mgtSettings__titleItem">
          <h1 className="atlTitleL" data-test-subj="managementSettingsTitle">
            Settings
          </h1>
        </div>
        <div className="mgtSettings__searchItem">
          <SettingsSearch
            text={text}
            clauses={clauses}
            error={parseError}
            categories={categories}
            onText={onText}
            onClauses={onClauses}
          />
        </div>
      </div>
      <CallOuts />
      {status === 'loading' ? (
        <div className="mgtSettings__loading">
          <span className="atlSpinner atlSpinner--l" role="progressbar" data-test-subj="advancedSettingsLoading" />
        </div>
      ) : status === 'failed' ? (
        <div className="atlEmpty mgtSettings__loadError" data-test-subj="advancedSettingsLoadError">
          <Icon name="warning" size="xl" className="mgtSettings__loadErrorIcon" />
          <h2 className="atlTitleS atlEmpty__title">Unable to load settings</h2>
          <div className="atlEmpty__body">
            <p>Something went wrong while loading settings. Reload the page to try again.</p>
          </div>
          <Button variant="primary" onClick={() => window.location.reload()} testId="advancedSettingsReload">
            Reload page
          </Button>
        </div>
      ) : (
        <>
          <VoiceAnnouncement queryText={text} visible={visible} />
          <div>
            {shownCategories.length > 0 ? (
              shownCategories.map((category) => {
                const rows = visible[category];
                const total = grouped[category]?.length ?? 0;
                return (
                  <div key={category} className="atlPanel mgtSettingsSection" id={category}>
                    <div className="mgtSettingsSection__head">
                      <h2 className="atlTitleM">{categoryName(category)}</h2>
                      {total !== rows.length && (
                        <em className="mgtSettingsSection__hiding">
                          Search terms are hiding {total - rows.length} settings{' '}
                          <button type="button" className="mgtSettings__clearLink" onClick={clearQuery}>
                            <em>(clear search)</em>
                          </button>
                        </em>
                      )}
                    </div>
                    <div className="mgtSettingsSection__rows">
                      {rows.map((setting) => (
                        <Field
                          key={setting.name}
                          setting={setting}
                          unsaved={unsaved[setting.name]}
                          onChange={handleChange}
                        />
                      ))}
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="atlPanel mgtSettingsSection mgtSettingsSection--empty">
                No settings found{' '}
                <button type="button" className="mgtSettings__clearLink" onClick={clearQuery}>
                  (clear search)
                </button>
              </div>
            )}
          </div>
          {unsavedKeys.length > 0 && (
            <BottomBar
              count={unsavedKeys.length}
              hidden={hiddenCount}
              invalid={invalid}
              saving={saving}
              onCancel={() => setUnsaved({})}
              onSave={saveAll}
            />
          )}
        </>
      )}
    </div>
  );
}

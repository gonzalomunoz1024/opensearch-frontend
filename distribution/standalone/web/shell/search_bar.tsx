/* SPDX-License-Identifier: Apache-2.0 */

/* The bar a data page starts with: the query, the time range, and under them the filters. */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../components/basic';
import type { TimeRange } from '../lib/dates';
import { KuerySyntaxError, parseKuery } from '../lib/kuery';
import {
  savedQueryAttributes,
  stateFromSavedQuery,
  type SaveQueryMeta,
  type SavedQuery,
} from '../lib/saved_query';
import type { Filter, IndexPattern, Query, RefreshInterval } from '../lib/types';
import { services } from '../services';
import { errorMessage } from '../services/http';
import { FilterBar, isPinned } from './filter_bar';
import { QueryBar, defaultQueryLanguage } from './query_bar';
import { SaveQueryForm, SavedQueryManagement, saveFailureText, type SavedQueryChange } from './saved_query';
import { TimePicker } from './time_picker';

export interface SearchBarProps {
  indexPatterns: IndexPattern[];
  query?: Query;
  onQuerySubmit?: (query: Query) => void;
  filters?: Filter[];
  onFiltersChange?: (filters: Filter[]) => void;
  time?: TimeRange;
  refreshInterval?: RefreshInterval;
  onTimeChange?: (range: TimeRange) => void;
  onRefreshChange?: (interval: RefreshInterval) => void;
  onRefresh: () => void;
  loading?: boolean;
  showQuery?: boolean;
  showFilters?: boolean;
  /** Whether a time range means anything here: not for an index pattern without a time field */
  showTime?: boolean;
  placeholder?: string;
  /** The saved query the page has loaded, by the id its address keeps */
  savedQueryId?: string;
  /**
   * Takes what loading, saving or clearing a saved query gives the page. Without it the bar
   * offers no saved queries.
   */
  onSavedQueryChange?: (change: SavedQueryChange) => void;
}

/** Why a query cannot be run, or nothing when it can */
export function queryError(query: Query): string | undefined {
  if (query.language !== 'kuery' || typeof query.query !== 'string') return undefined;
  try {
    parseKuery(query.query);
    return undefined;
  } catch (error) {
    return error instanceof KuerySyntaxError ? error.message : String(error);
  }
}

export function SearchBar({
  indexPatterns,
  query,
  onQuerySubmit,
  filters = [],
  onFiltersChange,
  time,
  refreshInterval,
  onTimeChange,
  onRefreshChange,
  onRefresh,
  loading,
  showQuery = true,
  showFilters = true,
  showTime = true,
  placeholder,
  savedQueryId,
  onSavedQueryChange,
}: SearchBarProps) {
  const committed = typeof query?.query === 'string' ? query.query : JSON.stringify(query?.query ?? '');
  const [draft, setDraft] = useState(committed);
  const [language, setLanguage] = useState(query?.language ?? 'kuery');
  useEffect(() => setDraft(committed), [committed]);
  useEffect(() => setLanguage(query?.language ?? 'kuery'), [query?.language]);

  const submit = (text: string, withLanguage = language) => {
    const next = { query: text, language: withLanguage };
    const problem = queryError(next);
    if (problem) {
      services.toasts.danger('The query cannot be read', problem);
      return;
    }
    if (text === committed && withLanguage === query?.language) onRefresh();
    else onQuerySubmit?.(next);
  };

  const dirty = showQuery && (draft !== committed || language !== (query?.language ?? 'kuery'));

  // --- Saved queries, as the original's search bar keeps them ---
  const [savedQuery, setSavedQuery] = useState<SavedQuery>();
  const [saving, setSaving] = useState<'changes' | 'new'>();
  // What a saved query that arrives later is applied over: the page as it is by then
  const latest = useRef({ filters, refreshInterval, onSavedQueryChange });
  latest.current = { filters, refreshInterval, onSavedQueryChange };

  const apply = useCallback((loaded: SavedQuery, replace: boolean) => {
    const page = latest.current;
    page.onSavedQueryChange?.({
      id: loaded.id,
      replace,
      ...stateFromSavedQuery(loaded.attributes, {
        pinnedFilters: page.filters.filter(isPinned),
        refreshInterval: page.refreshInterval,
        pinnedByDefault: services.uiSettings.get('filters:pinnedByDefault', false),
      }),
    });
  }, []);

  // Clearing leaves the time range, and takes every filter away, the pinned ones too
  const clear = useCallback((id?: string) => {
    setSavedQuery(undefined);
    latest.current.onSavedQueryChange?.({
      id,
      replace: id !== undefined,
      query: { query: '', language: defaultQueryLanguage() },
      filters: [],
    });
  }, []);

  const offersSavedQueries = Boolean(onSavedQueryChange);
  useEffect(() => {
    if (!savedQueryId || !offersSavedQueries) {
      setSavedQuery(undefined);
      return undefined;
    }
    let live = true;
    services.savedQueries.getSavedQuery(savedQueryId).then(
      (found) => {
        if (!live) return;
        setSavedQuery(found);
        apply(found, true);
      },
      (failure: unknown) => {
        if (!live) return;
        // The page keeps the id it was given, as the original does, and loses its query
        clear(savedQueryId);
        services.toasts.warning(`Unable to load saved query ${savedQueryId}`, errorMessage(failure));
      }
    );
    return () => {
      live = false;
    };
  }, [savedQueryId, offersSavedQueries, apply, clear]);

  const load = (chosen: SavedQuery) => {
    setSavedQuery(chosen);
    apply(chosen, false);
  };

  const save = async (meta: SaveQueryMeta) => {
    // What is saved is the query as it stands in the bar, run or not
    const attributes = savedQueryAttributes(meta, {
      query: { query: draft, language },
      filters,
      time,
      refreshInterval,
    });
    try {
      const stored =
        savedQuery && saving === 'changes'
          ? await services.savedQueries.saveQuery(attributes, { overwrite: true })
          : await services.savedQueries.saveQuery(attributes);
      services.toasts.success(`Your query "${stored.attributes.title}" was saved`);
      setSaving(undefined);
      setSavedQuery(stored);
      apply(stored, false);
    } catch (failure) {
      services.toasts.danger(saveFailureText(failure));
    }
  };

  const savedQueries =
    offersSavedQueries && showFilters && onFiltersChange ? (
      <SavedQueryManagement
        loaded={savedQuery}
        onLoad={load}
        onClear={() => clear()}
        onSave={() => setSaving('changes')}
        onSaveAsNew={() => setSaving('new')}
      />
    ) : undefined;
  return (
    <div className="shlSearchBar" data-test-subj="globalQueryBar">
      <div className="shlSearchBar__row">
        {showQuery && query && (
          <QueryBar
            value={draft}
            language={language}
            onChange={setDraft}
            onLanguageChange={(next) => {
              setLanguage(next);
              // A query written in one language is rarely one in the other
              setDraft('');
              onQuerySubmit?.({ query: '', language: next });
            }}
            onSubmit={(text) => submit(text)}
            indexPatterns={indexPatterns}
            placeholder={placeholder}
            prepend={savedQueries}
          />
        )}
        {!showQuery && <div className="atlGrow" />}
        {showTime && time && refreshInterval && onTimeChange && onRefreshChange ? (
          <TimePicker
            time={time}
            refreshInterval={refreshInterval}
            onTimeChange={onTimeChange}
            onRefreshChange={onRefreshChange}
            onRefresh={onRefresh}
            loading={loading}
            dirty={dirty}
            onUpdate={dirty ? () => submit(draft) : undefined}
          />
        ) : (
          <TimePickerLess loading={loading} dirty={dirty} onClick={() => (dirty ? submit(draft) : onRefresh())} />
        )}
      </div>
      {showFilters && onFiltersChange && (
        <FilterBar filters={filters} onChange={onFiltersChange} indexPatterns={indexPatterns} />
      )}
      {saving && (
        <SaveQueryForm
          savedQuery={saving === 'changes' ? savedQuery?.attributes : undefined}
          showFilterOption={Boolean(showFilters && onFiltersChange)}
          showTimeFilterOption={Boolean(time)}
          onSave={(meta) => void save(meta)}
          onClose={() => setSaving(undefined)}
        />
      )}
    </div>
  );
}


function TimePickerLess({ loading, dirty, onClick }: { loading?: boolean; dirty?: boolean; onClick: () => void }) {
  return (
    <Button
      variant={dirty ? 'primary' : 'default'}
      icon={dirty ? 'arrowRight' : 'refresh'}
      loading={loading && !dirty}
      onClick={onClick}
      testId="querySubmitButton"
    >
      {dirty ? 'Update' : 'Refresh'}
    </Button>
  );
}

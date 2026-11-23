/* SPDX-License-Identifier: Apache-2.0 */

/* The bar a data page starts with: the query, the time range, and under them the filters. */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, cx } from '../components/basic';
import { Icon } from '../components/icon';
import { addToTimeHistory, isRangeInvalid, prettyDuration, toAbsoluteString } from '../lib/date_picker';
import type { TimeRange } from '../lib/dates';
import { hasLuceneSyntax } from '../lib/kuery';
import {
  savedQueryAttributes,
  stateFromSavedQuery,
  type SaveQueryMeta,
  type SavedQuery,
} from '../lib/saved_query';
import { fromUser, toUser } from '../lib/query_input';
import type { Filter, IndexPattern, Query, RefreshInterval } from '../lib/types';
import { services } from '../services';
import { errorMessage } from '../services/http';
import { pickerDateContext, pickerDateFormat } from './date_popover';
import { FilterBar, isPinned } from './filter_bar';
import { DQL_DOCS, QueryBar, addRecentSearch, defaultQueryLanguage } from './query_bar';
import { SaveQueryForm, SavedQueryManagement, saveFailureText, type SavedQueryChange } from './saved_query';
import { readStored, writeStored } from './state';
import { RefreshOnlyPicker, SuperUpdateButton, TimePicker } from './time_picker';

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
  /** The picker without its dates: only how often the page refreshes (the original's "auto refresh only") */
  refreshOnly?: boolean;
  placeholder?: string;
  /** The saved query the page has loaded, by the id its address keeps */
  savedQueryId?: string;
  /**
   * Takes what loading, saving or clearing a saved query gives the page. Without it the bar
   * offers no saved queries.
   */
  onSavedQueryChange?: (change: SavedQueryChange) => void;
}

const LUCENE_OPT_OUT = 'luceneSyntaxWarningOptOut';
/** Where the ranges applied before are kept: ten at most, as the original's time history */
const RECENT_RANGES = 'recentRanges';

/**
 * The original's "Lucene syntax warning": a DQL query that looks written in Lucene is run all the
 * same, and the person is told, each time it is submitted, until they ask not to be.
 */
export function warnOfLuceneSyntax(query: Query) {
  if (query.language !== 'kuery' || typeof query.query !== 'string') return;
  if (readStored(LUCENE_OPT_OUT, false) || !hasLuceneSyntax(query.query)) return;
  const id = services.toasts.warning(
    'Lucene syntax warning',
    <div className="shlLuceneWarning">
      <p>
        It looks like you may be trying to use Lucene query syntax, although you have
        opensearchDashboards Query Language (DQL) selected. Please review the DQL docs{' '}
        <a className="shlExternal" href={DQL_DOCS} target="_blank" rel="noopener noreferrer">
          here
          <Icon name="external" title="External link" />
        </a>
        .
      </p>
      <div className="atlToast__actions">
        <Button
          onClick={() => {
            writeStored(LUCENE_OPT_OUT, true);
            services.toasts.dismiss(id);
          }}
        >
          Don&apos;t show again
        </Button>
      </div>
    </div>
  );
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
  refreshOnly = false,
  placeholder,
  savedQueryId,
  onSavedQueryChange,
}: SearchBarProps) {
  const committed = toUser(query?.query);
  const [draft, setDraft] = useState(committed);
  // While the query has the focus the dates make room for it, as in the original
  const [queryFocused, setQueryFocused] = useState(false);
  const [language, setLanguage] = useState(query?.language ?? 'kuery');
  useEffect(() => setDraft(committed), [committed]);
  useEffect(() => setLanguage(query?.language ?? 'kuery'), [query?.language]);

  // --- The dates, as the original's search bar keeps them ---
  const showsDates = Boolean(showTime && !refreshOnly && time && refreshInterval && onTimeChange && onRefreshChange);
  // The range as it stands in the picker: the one applied, until an end of it is changed and waits
  // for the button. A range applied from anywhere takes its place.
  const [timeDraft, setTimeDraft] = useState(time);
  const [followed, setFollowed] = useState(time);
  if (followed?.from !== time?.from || followed?.to !== time?.to) {
    setFollowed(time);
    setTimeDraft(time);
  }
  const shownRange = showsDates ? timeDraft : undefined;
  const timeDirty = Boolean(shownRange && time && (shownRange.from !== time.from || shownRange.to !== time.to));
  // Unlike the original, which remembers what the picker said last, a range is judged as it stands
  const timeInvalid = Boolean(shownRange && isRangeInvalid(shownRange.from, shownRange.to, pickerDateContext()));

  // The ranges applied before, the newest first: every range the page takes, and every one submitted
  const [recentRanges, setRecentRanges] = useState(() => readStored<TimeRange[]>(RECENT_RANGES, []));
  const remember = useCallback((range: TimeRange) => {
    const next = addToTimeHistory(readStored<TimeRange[]>(RECENT_RANGES, []), range);
    writeStored(RECENT_RANGES, next);
    setRecentRanges(next);
  }, []);
  const applied = useRef<TimeRange>();
  const timeFrom = showsDates ? time?.from : undefined;
  const timeTo = showsDates ? time?.to : undefined;
  useEffect(() => {
    if (!timeFrom || !timeTo) return;
    const first = applied.current === undefined;
    applied.current = { from: timeFrom, to: timeTo };
    // The range a page opens with was applied before, unless it is not the one the product starts with
    if (first) {
      const defaults = services.uiSettings.get<Partial<TimeRange>>('timepicker:timeDefaults', {});
      if (defaults.from === timeFrom && defaults.to === timeTo) return;
    }
    remember({ from: timeFrom, to: timeTo });
  }, [timeFrom, timeTo, remember]);

  // What is typed and the range are applied together: the range if it changed, the query if it did,
  // and the same search again if neither did. A query that cannot be read is run all the same, as
  // in the original: the search fails and says why.
  const run = (text: string, withLanguage: string, range: TimeRange | undefined) => {
    const next = { query: fromUser(text) as Query['query'], language: withLanguage };
    const queryChanged = Boolean(showQuery && query) && !(text === committed && withLanguage === query?.language);
    const timeChanged = Boolean(range && time && (range.from !== time.from || range.to !== time.to));
    if (range) setTimeDraft(range);
    if (range && timeChanged) onTimeChange?.(range);
    if (queryChanged) onQuerySubmit?.(next);
    if (!timeChanged && !queryChanged) onRefresh();
  };

  const submit = (text: string, withLanguage = language) => {
    if (showQuery && query) warnOfLuceneSyntax({ query: fromUser(text) as Query['query'], language: withLanguage });
    if (shownRange) remember(shownRange);
    run(text, withLanguage, shownRange);
  };

  const queryDirty = showQuery && (draft !== committed || language !== (query?.language ?? 'kuery'));
  const dirty = queryDirty || timeDirty;
  // The button keeps what it applies among the searches the bar offers again, as the original's does
  const update = () => {
    if (showQuery && query) addRecentSearch(language, fromUser(draft));
    submit(draft);
  };
  // A range of the quick menu is applied at once, with what is typed
  const quickApply = (range: TimeRange) => run(draft, language, range);

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
      time: shownRange ?? time,
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

  // The range written out for what makes a picture or a report of the page, as the original's
  const sharedRange = shownRange ?? time;

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
            onFocusChange={setQueryFocused}
          />
        )}
        {!showQuery && <div className="atlGrow" />}
        {sharedRange && (
          <div
            hidden
            data-shared-timefilter-duration={prettyDuration(
              toAbsoluteString(sharedRange.from, false, pickerDateContext()),
              toAbsoluteString(sharedRange.to, false, pickerDateContext()),
              [],
              pickerDateFormat(),
              pickerDateContext()
            )}
            data-test-subj="dataSharedTimefilterDuration"
          />
        )}
        {showTime && refreshOnly && refreshInterval && onRefreshChange ? (
          <>
            <div className={cx('shlSearchBar__dates', queryFocused && 'shlSearchBar__dates--hidden')}>
              <RefreshOnlyPicker refreshInterval={refreshInterval} onRefreshChange={onRefreshChange} />
            </div>
            <SuperUpdateButton needsUpdate={dirty} loading={loading} onClick={update} />
          </>
        ) : shownRange && refreshInterval && onRefreshChange ? (
          <>
            <div className={cx('shlSearchBar__dates', queryFocused && 'shlSearchBar__dates--hidden')}>
              <TimePicker
                range={shownRange}
                onChange={setTimeDraft}
                onQuickApply={quickApply}
                recentRanges={recentRanges}
                refreshInterval={refreshInterval}
                onRefreshChange={onRefreshChange}
              />
            </div>
            <SuperUpdateButton needsUpdate={dirty} loading={loading} disabled={timeInvalid} onClick={update} />
          </>
        ) : (
          <SuperUpdateButton needsUpdate={dirty} loading={loading} onClick={update} />
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

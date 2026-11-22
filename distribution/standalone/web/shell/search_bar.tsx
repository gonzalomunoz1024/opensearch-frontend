/* SPDX-License-Identifier: Apache-2.0 */

/* The bar a data page starts with: the query, the time range, and under them the filters. */

import { useEffect, useState } from 'react';
import { Button } from '../components/basic';
import type { TimeRange } from '../lib/dates';
import { KuerySyntaxError, parseKuery } from '../lib/kuery';
import type { Filter, IndexPattern, Query, RefreshInterval } from '../lib/types';
import { services } from '../services';
import { FilterBar } from './filter_bar';
import { QueryBar } from './query_bar';
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

/* SPDX-License-Identifier: Apache-2.0 */

/* Where a query is typed, in DQL or Lucene, with fields and values offered as it is written. */

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Button, cx } from '../components/basic';
import { Switch } from '../components/form';
import { Popover } from '../components/overlay';
import {
  conjunctionSuggestions,
  fieldSuggestions,
  suggestContext,
  valueSuggestions,
  valuesRequest,
  type SuggestContext,
  type Suggestion,
} from '../lib/kuery_suggest';
import type { Field, IndexPattern } from '../lib/types';
import { services } from '../services';
import { readStored, writeStored } from './state';

/** The language a new query is written in: what was chosen last, or else the setting */
export function defaultQueryLanguage(): string {
  const stored = readStored<string | undefined>('queryLanguage', undefined);
  if (stored === 'kuery' || stored === 'lucene') return stored;
  const setting = services.uiSettings.get<string>('search:queryLanguage', 'kuery');
  return setting === 'lucene' ? 'lucene' : 'kuery';
}

/** The values of a field that start with what was typed, for the query bar and the filter editor */
export async function fetchFieldValues(
  indexPattern: Pick<IndexPattern, 'title'>,
  field: Field,
  prefix: string,
  signal?: AbortSignal
): Promise<Array<string | number | boolean>> {
  if (field.type === 'boolean') return [true, false];
  if (!services.uiSettings.get('filterEditor:suggestValues', true)) return [];
  const body = valuesRequest(field, prefix);
  if (!body) return [];
  try {
    const answer = await services.search.request<{
      aggregations?: { suggestions?: { buckets?: Array<{ key: string | number }> } };
    }>('POST', `${encodeURIComponent(indexPattern.title)}/_search?ignore_unavailable=true`, body, { signal });
    return (answer.aggregations?.suggestions?.buckets ?? []).map((bucket) => bucket.key);
  } catch {
    return [];
  }
}

function LanguageSwitch({ language, onChange }: { language: string; onChange: (language: string) => void }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <Popover
      open={open}
      onClose={close}
      align="right"
      padded
      button={
        <Button
          variant="empty"
          size="s"
          className="shlQuery__language"
          onClick={() => setOpen(!open)}
          testId="switchQueryLanguageButton"
        >
          {language === 'kuery' ? 'DQL' : 'Lucene'}
        </Button>
      }
    >
      <div className="atlStack" style={{ width: 320 }}>
        <div className="atlTitleXxs">Syntax options</div>
        <span className="atlSubdued">
          The Dashboards Query Language (DQL) offers a simplified query syntax and support for
          scripted fields. Turn it off to write queries in the Lucene syntax of OpenSearch.
        </span>
        <Switch
          checked={language === 'kuery'}
          onChange={(on) => {
            onChange(on ? 'kuery' : 'lucene');
            close();
          }}
          label="Dashboards Query Language"
          testId="languageToggle"
        />
      </div>
    </Popover>
  );
}

export interface QueryBarProps {
  value: string;
  language: string;
  onChange: (value: string) => void;
  onLanguageChange: (language: string) => void;
  onSubmit: (value: string) => void;
  indexPatterns: IndexPattern[];
  placeholder?: string;
  invalid?: boolean;
  /** What sits before the query, inside the field: the saved queries' button */
  prepend?: ReactNode;
}

export function QueryBar({
  value,
  language,
  onChange,
  onLanguageChange,
  onSubmit,
  indexPatterns,
  placeholder = 'Search',
  invalid,
  prepend,
}: QueryBarProps) {
  const area = useRef<HTMLTextAreaElement>(null);
  const [focused, setFocused] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [active, setActive] = useState(-1);
  const [dismissed, setDismissed] = useState(false);
  const pendingCursor = useRef<number | undefined>(undefined);

  const fields = useMemo(() => {
    const byName = new Map<string, { field: Field; pattern: IndexPattern }>();
    for (const pattern of indexPatterns) {
      for (const field of pattern.fields) {
        if (!byName.has(field.name)) byName.set(field.name, { field, pattern });
      }
    }
    return byName;
  }, [indexPatterns]);
  const fieldList = useMemo(() => [...fields.values()].map((entry) => entry.field), [fields]);

  const context: SuggestContext | undefined = useMemo(
    () => (language === 'kuery' && focused ? suggestContext(value, cursor) : undefined),
    [language, focused, value, cursor]
  );

  useEffect(() => {
    setActive(-1);
    if (!context) {
      setSuggestions([]);
      return undefined;
    }
    if (context.kind === 'field') {
      setSuggestions(fieldSuggestions(fieldList, context.prefix));
      return undefined;
    }
    if (context.kind === 'conjunction') {
      setSuggestions(conjunctionSuggestions(context.prefix));
      return undefined;
    }
    const entry = context.fieldName ? fields.get(context.fieldName) : undefined;
    if (!entry) {
      setSuggestions([]);
      return undefined;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void fetchFieldValues(entry.pattern, entry.field, context.prefix, controller.signal).then((values) => {
        if (!controller.signal.aborted) setSuggestions(valueSuggestions(values));
      });
    }, 150);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [context, fields, fieldList]);

  useEffect(() => {
    if (pendingCursor.current !== undefined && area.current) {
      area.current.setSelectionRange(pendingCursor.current, pendingCursor.current);
      setCursor(pendingCursor.current);
      pendingCursor.current = undefined;
    }
  });

  const accept = (suggestion: Suggestion) => {
    if (!context) return;
    const next = `${value.slice(0, context.start)}${suggestion.insert}${value.slice(context.end)}`;
    pendingCursor.current = context.start + suggestion.insert.length;
    onChange(next);
    setDismissed(false);
    area.current?.focus();
  };

  const open = focused && !dismissed && suggestions.length > 0;
  const multiline = value.includes('\n');

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((index) => Math.max(-1, Math.min(suggestions.length - 1, index + step)));
    } else if (open && active >= 0 && (event.key === 'Enter' || event.key === 'Tab')) {
      event.preventDefault();
      accept(suggestions[active]);
    } else if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      setDismissed(true);
      onSubmit(value);
    } else if (event.key === 'Escape' && open) {
      event.stopPropagation();
      setDismissed(true);
    }
  };

  return (
    <Popover
      open={open}
      onClose={() => setDismissed(true)}
      matchWidth
      anchorStyle={{ display: 'flex', flex: '1 1 0' }}
      button={
        <div
          className={cx('atlField', 'shlQuery', multiline && 'shlQuery--multiline', invalid && 'atlField--invalid')}
          style={multiline ? { height: 'auto' } : undefined}
        >
          {prepend}
          <textarea
            ref={area}
            rows={multiline ? Math.min(8, value.split('\n').length) : 1}
            style={multiline ? { height: 'auto' } : undefined}
            value={value}
            placeholder={placeholder}
            spellCheck={false}
            autoComplete="off"
            aria-label="Search"
            data-test-subj="queryInput"
            onChange={(event) => {
              onChange(event.target.value);
              setCursor(event.target.selectionStart);
              setDismissed(false);
            }}
            onSelect={(event) => setCursor(event.currentTarget.selectionStart)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={onKeyDown}
          />
          <LanguageSwitch
            language={language}
            onChange={(next) => {
              writeStored('queryLanguage', next);
              onLanguageChange(next);
            }}
          />
        </div>
      }
    >
      <div className="atlMenu shlQuery__suggestions" role="listbox" data-test-subj="typeahead">
        {suggestions.map((suggestion, index) => (
          <button
            key={`${suggestion.kind}-${suggestion.label}`}
            type="button"
            role="option"
            className="atlMenu__item"
            aria-selected={index === active}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => accept(suggestion)}
          >
            <span className="shlSuggestion__kind">{suggestion.kind}</span>
            <span className="atlGrow atlTruncate atlMono">{suggestion.label}</span>
            {suggestion.detail && <span className="shlSuggestion__detail">{suggestion.detail}</span>}
          </button>
        ))}
      </div>
    </Popover>
  );
}

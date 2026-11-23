/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Where a query is typed, in DQL or Lucene, as OpenSearch Dashboards' query string input: a text
 * box that grows with its text while it has the focus, closes the pairs of quotes and brackets
 * that are opened in it, and lists under it the searches made before on the page for the arrow
 * keys and the pointer to choose from. Only those: the original's input asks its DQL suggestions
 * without the services they need (`query_string_input.tsx`), so they come back empty
 * (`antlr/dql/code_completion.ts`), and it offers no fields, values or conjunctions.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from '../components/basic';
import { Switch } from '../components/form';
import { Icon, type IconName } from '../components/icon';
import { Popover, Portal } from '../components/overlay';
import {
  addToLog,
  barSuggestions,
  matchPairs,
  normalizeQueryText,
  queryAppName,
  stepIndex,
} from '../lib/query_input';
import type { IndexPattern } from '../lib/types';
import { getLocation } from '../router';
import { services } from '../services';
import { readStored, writeStored } from './state';

/** The language a new query is written in: what was chosen last, or else the setting */
export function defaultQueryLanguage(): string {
  const stored = readStored<string | undefined>('queryLanguage', undefined);
  if (stored === 'kuery' || stored === 'lucene') return stored;
  const setting = services.uiSettings.get<string>('search:queryLanguage', 'kuery');
  return setting === 'lucene' ? 'lucene' : 'kuery';
}

/**
 * Makes a language the one new queries are written in, as the original's setUserQueryLanguage:
 * its language switch does so, and its Discover with the language of the query it opens with.
 */
export function rememberQueryLanguage(language: string) {
  writeStored('queryLanguage', language);
}

/** The documentation of DQL that the original's links lead to */
export const DQL_DOCS = 'https://opensearch.org/docs/latest/dashboards/dql';

// --- The searches made before, as the original's query log keeps them -------------------------

/** The page the bar is on, as the original names it: "discover", "dashboard", "visualize" */
export const currentAppName = () => queryAppName(getLocation().pathname);

const logKey = (appName: string, language: string) => `typeahead:${appName}-${language}`;

function readLog(appName: string, language: string): unknown[] {
  const items = readStored<unknown>(logKey(appName, language), []);
  return Array.isArray(items) ? items : [];
}

/** Keeps a search to offer it again in the bar of this page and language, as long as `history:limit` says */
export function addRecentSearch(language: string, query: unknown, appName = currentAppName()) {
  const limit = Number(services.uiSettings.get<number | string>('history:limit', 10));
  writeStored(logKey(appName, language), addToLog(readLog(appName, language), query, limit));
}

// --- The list under the bar ----------------------------------------------------------------------

/** The kinds of the original's suggestions that its query bar shows: the searches made before */
type TypeaheadType = 'recentSearch';

interface TypeaheadItem {
  type: TypeaheadType;
  /** What the list shows */
  text: string;
  /** None for a search made before; the original keeps its room in a wide list all the same */
  description?: string;
  /** What replaces the part of the text from start to end */
  insert: string;
  start: number;
  end: number;
}

/** The original's icon for each kind of suggestion */
const TYPE_ICONS: Record<TypeaheadType, IconName> = {
  recentSearch: 'search',
};

/** Under this width the list leaves out the descriptions, as the original's does */
const DESCRIPTION_WIDTH = 600;
/** The room the list needs under the bar to open downwards; else it opens upwards */
const BOTTOM_SPACE = 250;
const PAGE = 50;

function Typeahead({
  items,
  index,
  rect,
  onClick,
  onMouseEnter,
  onMore,
  size,
}: {
  items: TypeaheadItem[];
  index: number | null;
  rect: DOMRect;
  onClick: (item: TypeaheadItem) => void;
  onMouseEnter: (index: number) => void;
  onMore: () => void;
  size?: 's' | 'l';
}) {
  const list = useRef<HTMLDivElement>(null);
  const below = window.innerHeight - rect.bottom > BOTTOM_SPACE;
  const describe = rect.width >= DESCRIPTION_WIDTH;

  // The chosen one is scrolled into the list's view, as the keys move through it
  useEffect(() => {
    const parent = list.current;
    const child = index === null ? undefined : (parent?.children[index] as HTMLElement | undefined);
    if (!parent || !child) return;
    parent.scrollTop = Math.max(
      Math.min(parent.scrollTop, child.offsetTop),
      child.offsetTop + child.offsetHeight - parent.offsetHeight
    );
  }, [index]);

  return (
    <Portal>
      <div
        className="shlTypeahead"
        style={{
          left: rect.left,
          width: rect.width,
          ...(below ? { top: rect.bottom - 1 } : { bottom: window.innerHeight - rect.top }),
        }}
      >
        <div
          className={cx(
            'shlTypeahead__popover',
            below ? 'shlTypeahead__popover--bottom' : 'shlTypeahead__popover--top',
            size === 's' && 'shlTypeahead__popover--small'
          )}
          ref={list}
          id="osdTypeahead__items"
          role="listbox"
          data-test-subj="typeahead"
          onScroll={(event) => {
            const element = event.currentTarget;
            if (element.scrollHeight - (element.scrollTop + element.offsetHeight) <= 50) onMore();
          }}
          // The text keeps the focus while the pointer chooses
          onMouseDown={(event) => event.preventDefault()}
        >
          {items.map((item, at) => (
            <div
              key={`${item.type} - ${item.text}`}
              id={`suggestion-${at}`}
              role="option"
              aria-selected={at === index}
              className={cx('shlTypeahead__item', at === index && 'shlTypeahead__item--active')}
              onClick={() => onClick(item)}
              onMouseEnter={() => onMouseEnter(at)}
              data-test-subj={`autocompleteSuggestion-${item.type}-${item.text.replace(/\s/g, '-')}`}
            >
              <div className={`shlSuggestion shlSuggestion--${item.type}`}>
                <div className="shlSuggestion__type" data-test-subj="osdSuggestionType">
                  <Icon name={TYPE_ICONS[item.type]} />
                </div>
                <div className="shlSuggestion__text" data-test-subj="autoCompleteSuggestionText">
                  {item.text}
                </div>
                {describe && (
                  <div className="shlSuggestion__description" data-test-subj="osdSuggestionDescription">
                    {item.description}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Portal>
  );
}

// --- The language ------------------------------------------------------------------------------

function LanguageSwitch({ language, onChange }: { language: string; onChange: (language: string) => void }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  // The popover stays open when the language is changed, as the original's does
  return (
    <Popover
      open={open}
      onClose={close}
      align="right"
      offset={8}
      anchorClassName="shlQuery__languageAnchor"
      button={
        <button
          type="button"
          className="shlQuery__language"
          onClick={() => setOpen(!open)}
          data-test-subj="switchQueryLanguageButton"
          aria-label="Change query language"
        >
          {language === 'lucene' ? 'Lucene' : 'DQL'}
        </button>
      }
    >
      <div className="shlPopoverSmall" id="queryLanguageSwitcherPopover">
        <div className="shlPopoverTitle">Syntax options</div>
        <div style={{ width: 350 }}>
          <p className="shlPopoverText">
            The{' '}
            <a className="shlLink" href={DQL_DOCS} target="_blank" rel="noopener noreferrer">
              OpenSearch Dashboards Query Language
              <Icon name="external" title="External link" className="shlLink__external" size="s" />
              <span className="atlScreenReaderOnly">(opens in a new tab or window)</span>
            </a>{' '}
            (DQL) offers a simplified query syntax and support for scripted fields. If you turn off DQL,
            OpenSearch Dashboards uses Lucene.
          </p>
          <div className="shlLanguageForm">
            <span className="shlLanguageForm__label">OpenSearch Dashboards Query Language</span>
            <Switch
              checked={language === 'kuery'}
              onChange={() => onChange(language === 'lucene' ? 'kuery' : 'lucene')}
              label={language === 'kuery' ? 'On' : 'Off'}
              testId="languageToggle"
            />
          </div>
        </div>
      </div>
    </Popover>
  );
}

// --- The bar ---------------------------------------------------------------------------------

export interface QueryBarProps {
  value: string;
  language: string;
  onChange: (value: string) => void;
  onLanguageChange: (language: string) => void;
  onSubmit: (value: string) => void;
  /**
   * The index patterns searched. The original asks its suggestions for the first of them, and
   * they come back empty; nothing is offered from them here either.
   */
  indexPatterns: IndexPattern[];
  placeholder?: string;
  invalid?: boolean;
  /** What sits before the query, inside the field: the saved queries' button */
  prepend?: ReactNode;
  /** Takes the focus when it appears */
  autoFocus?: boolean;
  testId?: string;
  /** Told when the text gains and loses the focus: the search bar hides its dates meanwhile */
  onFocusChange?: (focused: boolean) => void;
  /** A short list, as under a filter of a visualization's buckets */
  size?: 's' | 'l';
}

export function QueryBar({
  value,
  language,
  onChange,
  onLanguageChange,
  onSubmit,
  placeholder,
  invalid,
  prepend,
  autoFocus,
  testId = 'queryInput',
  onFocusChange,
  size,
}: QueryBarProps) {
  const area = useRef<HTMLTextAreaElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const combobox = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [index, setIndex] = useState<number | null>(null);
  const [items, setItems] = useState<TypeaheadItem[]>([]);
  const [limit, setLimit] = useState(PAGE);
  const [rect, setRect] = useState<DOMRect>();
  const pendingSelection = useRef<[number, number] | undefined>(undefined);
  const appName = currentAppName();

  const updateRect = useCallback(() => {
    if (wrap.current) setRect(wrap.current.getBoundingClientRect());
  }, []);

  /** As tall as its text while it has the focus; one line otherwise */
  const autoHeight = useCallback(() => {
    const element = area.current;
    if (element && document.activeElement === element) {
      element.style.setProperty('height', `${element.scrollHeight}px`, 'important');
    }
    updateRect();
  }, [updateRect]);
  const removeHeight = () => area.current?.style.removeProperty('height');

  // The searches made before on this page in this language that hold the text, after the
  // original's short pause
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setItems(barSuggestions(readLog(appName, language), value).map((item) => ({ ...item, insert: item.text })));
    }, 100);
    return () => {
      window.clearTimeout(timer);
    };
  }, [value, language, appName]);

  // A selection asked for by an edit, once the text is there
  useLayoutEffect(() => {
    const selection = pendingSelection.current;
    if (!selection || !area.current) return;
    pendingSelection.current = undefined;
    area.current.setSelectionRange(selection[0], selection[1]);
    if (document.activeElement === area.current) autoHeight();
    else removeHeight();
  });

  // Placed again as the window is resized or scrolled, as the original's list is
  useEffect(() => {
    updateRect();
    window.addEventListener('resize', autoHeight);
    window.addEventListener('scroll', updateRect, { capture: true, passive: true });
    return () => {
      window.removeEventListener('resize', autoHeight);
      window.removeEventListener('scroll', updateRect, { capture: true });
    };
  }, [autoHeight, updateRect]);

  useEffect(() => {
    if (autoFocus) area.current?.focus();
    // Only when it appears
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A press of the pointer anywhere but on the bar and its list closes the list, as in the original
  useEffect(() => {
    if (!visible) return undefined;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (combobox.current?.contains(target)) return;
      if ((target as Element).closest?.('.shlTypeahead')) return;
      setVisible(false);
      setIndex(null);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [visible]);

  /** What the original does on every change of the text: shows the list, from its top */
  const change = (text: string) => {
    setVisible(true);
    setIndex(null);
    setLimit(PAGE);
    onChange(normalizeQueryText(text));
  };

  const submit = (text: string) => {
    addRecentSearch(language, text, appName);
    onSubmit(text);
  };

  const select = (item: TypeaheadItem) => {
    const element = area.current;
    if (!element) return;
    // What is selected goes first, as in the original
    const { selectionStart, selectionEnd } = element;
    const rest = value.slice(0, selectionStart) + value.slice(selectionEnd);
    const next = rest.slice(0, item.start) + item.insert + rest.slice(item.end);
    const at = item.start + item.insert.length;
    pendingSelection.current = [at, at];
    change(next);
    if (item.type === 'recentSearch') {
      setVisible(false);
      setIndex(null);
      submit(next);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const target = event.currentTarget;
    switch (event.key) {
      case 'ArrowDown':
        if (visible && index !== null) {
          event.preventDefault();
          setIndex(stepIndex(index, items.length, 1));
        } else if ((visible && index === null) || value === '') {
          event.preventDefault();
          setVisible(true);
          setIndex(0);
        }
        break;
      case 'ArrowUp':
        if (visible && index !== null) {
          event.preventDefault();
          setIndex(stepIndex(index, items.length, -1));
        }
        break;
      case 'Enter':
        event.preventDefault();
        if (visible && index !== null && items[index]) {
          select(items[index]);
        } else {
          submit(value);
          setVisible(false);
        }
        break;
      case 'Escape':
        event.preventDefault();
        // The list closes; what the bar sits in, a dialog or a flyout, stays
        if (visible) event.stopPropagation();
        setVisible(false);
        setIndex(null);
        break;
      case 'Tab':
        setVisible(false);
        setIndex(null);
        break;
      default: {
        const edit = matchPairs(event.key, event.metaKey, target.value, target.selectionStart, target.selectionEnd);
        if (edit) {
          event.preventDefault();
          pendingSelection.current = [edit.selectionStart, edit.selectionEnd];
          change(edit.value);
        }
      }
    }
  };

  const shown = visible && rect !== undefined && items.length > 0;
  const appLabel = appName || 'current';
  return (
    <div className={cx('shlQuery', invalid && 'shlQuery--invalid')}>
      {prepend}
      <div
        ref={combobox}
        className="shlQuery__combobox"
        role="combobox"
        aria-label={`Search and filter the ${appLabel} page`}
        aria-haspopup="true"
        aria-expanded={visible}
        aria-controls={visible ? 'osdTypeahead__items' : undefined}
        aria-owns={visible ? 'osdTypeahead__items' : undefined}
      >
        <div ref={wrap} role="search" className="shlQuery__wrap" data-test-subj="queryBarInputContainer">
          <textarea
            ref={area}
            className="shlQuery__textarea"
            rows={1}
            value={value}
            placeholder={placeholder || 'Search'}
            spellCheck={false}
            autoComplete="off"
            role="textbox"
            aria-label={`Start typing to search and filter the ${appLabel} page`}
            aria-autocomplete="list"
            aria-controls={visible ? 'osdTypeahead__items' : undefined}
            aria-activedescendant={visible && index !== null ? `suggestion-${index}` : undefined}
            aria-invalid={invalid || undefined}
            data-test-subj={testId}
            onChange={(event) => {
              change(event.target.value);
              if (event.target.value === '') removeHeight();
              else autoHeight();
            }}
            onClick={(event) => change(event.currentTarget.value)}
            onKeyUp={(event) => {
              if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) change(event.currentTarget.value);
            }}
            onFocus={() => {
              onFocusChange?.(true);
              requestAnimationFrame(autoHeight);
            }}
            onBlur={() => {
              removeHeight();
              if (area.current) area.current.scrollTop = 0;
              onFocusChange?.(false);
            }}
            onKeyDown={onKeyDown}
          />
        </div>
        {shown && (
          <Typeahead
            items={items.slice(0, limit)}
            index={index}
            rect={rect}
            size={size}
            onClick={(item) => {
              select(item);
              area.current?.focus();
            }}
            onMouseEnter={setIndex}
            onMore={() => setLimit((current) => current + PAGE)}
          />
        )}
      </div>
      <LanguageSwitch
        language={language}
        onChange={(next) => {
          rememberQueryLanguage(next);
          onLanguageChange(next);
        }}
      />
    </div>
  );
}

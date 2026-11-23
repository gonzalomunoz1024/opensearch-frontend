/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The search bar of the advanced settings page, as the original's: a box that searches as it is
 * typed in, in the language of its library's search bar, and a Category filter whose choices are
 * written into the box as `category:(a or b)`. A text the language cannot read keeps the last
 * results and says why under the bar.
 */

import { useEffect, useRef, useState } from 'react';
import { cx } from '../../components/basic';
import { Icon } from '../../components/icon';
import { Popover } from '../../components/overlay';
import {
  addOrFieldValue,
  getOrFieldClause,
  hasOrFieldClause,
  printQuery,
  removeOrFieldValue,
  type QueryClause,
} from '../../lib/search_query';
import { categoryName } from './settings_model';

const FIELD = 'category';

type Checked = 'on' | 'off' | undefined;

function checkedOf(clauses: QueryClause[], category: string): Checked {
  const clause = getOrFieldClause(clauses, FIELD, category);
  if (!clause) return undefined;
  return clause.match === 'must' ? 'on' : 'off';
}

export interface SettingsSearchProps {
  /** What the box shows */
  text: string;
  /** The last text that could be read, which the results and the filter follow */
  clauses: QueryClause[];
  /** Why the text in the box cannot be read */
  error?: string;
  categories: string[];
  /** A new text typed in the box */
  onText: (text: string) => void;
  /** A choice in the filter: the query it makes and its text */
  onClauses: (clauses: QueryClause[], text: string) => void;
}

export function SettingsSearch({ text, clauses, error, categories, onText, onClauses }: SettingsSearchProps) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="mgtSettingsSearch">
      <div className="mgtSettingsSearch__bar">
        <div className="mgtSettingsSearch__box">
          <Icon name="search" size="s" className="mgtSettingsSearch__icon" />
          <input
            ref={input}
            type="search"
            className="mgtSettingsSearch__input"
            placeholder="Search..."
            value={text}
            aria-label="Search advanced settings"
            data-test-subj="settingsSearchBar"
            onChange={(event) => onText(event.target.value)}
          />
          {text !== '' && (
            <button
              type="button"
              className="mgtSettingsSearch__clear"
              aria-label="Clear search input"
              data-test-subj="clearSearchButton"
              onClick={() => {
                onText('');
                input.current?.focus();
              }}
            >
              <svg viewBox="0 0 8 8" aria-hidden>
                <path d="M2 2l4 4M6 2L2 6" />
              </svg>
            </button>
          )}
        </div>
        <CategoryFilter categories={categories} clauses={clauses} onClauses={onClauses} />
      </div>
      {error !== undefined && <div className="mgtSettingsSearch__error">{`Unable to parse query. ${error}`}</div>}
    </div>
  );
}

function CategoryFilter({
  categories,
  clauses,
  onClauses,
}: {
  categories: string[];
  clauses: QueryClause[];
  onClauses: (clauses: QueryClause[], text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  // The choice the keyboard is on: the first when the list opens, none after a click
  const [active, setActive] = useState<string>();
  const list = useRef<HTMLDivElement>(null);
  const items = categories.map((category) => ({ category, checked: checkedOf(clauses, category) }));
  // The chosen ones come first, then those left out, then the rest, as the original lists them
  const ordered = [
    ...items.filter((item) => item.checked === 'on'),
    ...items.filter((item) => item.checked === 'off'),
    ...items.filter((item) => item.checked === undefined),
  ];
  const filtered = hasOrFieldClause(clauses, FIELD);
  const count = items.filter((item) => item.checked === 'on').length;

  // The first choice takes the focus when the list opens, as the original's
  useEffect(() => {
    if (!open) return undefined;
    // Once the popover has its place and shows: a hidden element takes no focus
    const frame = window.requestAnimationFrame(() => list.current?.querySelector<HTMLButtonElement>('button')?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  const toggle = (category: string, checked: Checked) => {
    const next = checked ? removeOrFieldValue(clauses, FIELD, category) : addOrFieldValue(clauses, FIELD, category);
    onClauses(next, printQuery(next));
  };

  const moveFocus = (step: number) => {
    const buttons = [...(list.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
    if (buttons.length === 0) return;
    const at = buttons.findIndex((button) => button === document.activeElement);
    const next = at < 0 ? (step > 0 ? 0 : buttons.length - 1) : (at + step + buttons.length) % buttons.length;
    buttons[next].focus();
    setActive(ordered[next]?.category);
  };

  return (
    <div className="mgtCategoryFilter">
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        align="right"
        className="mgtCategoryFilter__panel"
        button={
          <button
            type="button"
            className={cx('mgtCategoryFilter__button', open && 'mgtCategoryFilter__button--open')}
            aria-expanded={open}
            aria-haspopup="true"
            data-test-subj="settingsCategoryFilter"
            onClick={() => {
              if (!open) setActive(ordered[0]?.category);
              setOpen(!open);
            }}
          >
            <span className="mgtCategoryFilter__text">Category</span>
            {filtered && (
              <span className="mgtCategoryFilter__count" aria-label={`${count} active filters`}>
                {count}
              </span>
            )}
            <svg className="atlIcon mgtCategoryFilter__arrow" viewBox="0 0 16 16" aria-hidden>
              <path d="M2.5 5.5L8 11l5.5-5.5" />
            </svg>
          </button>
        }
      >
        <div
          ref={list}
          className="mgtCategoryFilter__list"
          role="dialog"
          aria-label="Category"
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              moveFocus(event.key === 'ArrowDown' ? 1 : -1);
            }
          }}
        >
          {ordered.map(({ category, checked }) => (
            <button
              key={category}
              type="button"
              className={cx('mgtCategoryFilter__item', active === category && 'mgtCategoryFilter__item--active')}
              aria-pressed={checked === 'on'}
              onClick={(event) => {
                // A click of the mouse, not a key: it leaves no choice marked
                if (event.detail > 0) setActive(undefined);
                toggle(category, checked);
              }}
            >
              <span className="mgtCategoryFilter__mark">
                {checked === 'on' && <Icon name="check" />}
                {checked === 'off' && <Icon name="cross" />}
              </span>
              <span className="mgtCategoryFilter__name">{categoryName(category)}</span>
            </button>
          ))}
        </div>
      </Popover>
    </div>
  );
}

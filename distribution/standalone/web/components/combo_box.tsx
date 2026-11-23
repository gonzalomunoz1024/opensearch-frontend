/* SPDX-License-Identifier: Apache-2.0 */

/*
 * A field that picks one or several of a list by typing: fields, index patterns, values. It
 * behaves as the original's combo box (EuiComboBox): the list under it is as wide as the field,
 * seven rows high at most, and the keys, a value typed in and the messages of an empty list are
 * its own.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { cx } from './basic';
import { Icon } from './icon';
import { Popover } from './overlay';

export interface ComboOption {
  value: string;
  label: string;
  /** Drawn before the label in the list: a field's kind */
  prepend?: ReactNode;
  disabled?: boolean;
  group?: string;
  /** Said after the label in the list only: the field shows the label alone */
  detail?: string;
  testId?: string;
}

export interface ComboBoxProps {
  options: ComboOption[];
  selected: string[];
  onChange: (selected: string[]) => void;
  /** One value only: the field shows it, and choosing another replaces it */
  single?: boolean;
  placeholder?: string;
  /** A text that is no option becomes one with Enter, or when the field is left */
  allowCustom?: boolean;
  /** What a text that is no option does, in place of being added to what is chosen */
  onCreateOption?: (text: string) => void;
  /** A text is several values, each ended by this: each is added once it is typed */
  delimiter?: string;
  /** A text pasted with commas in it is these values, each without the spaces around it */
  onPasteValues?: (values: string[]) => void;
  /** The options that match what is typed: in their order, or those that start with it first */
  sortMatchesBy?: 'none' | 'startsWith';
  autoFocus?: boolean;
  clearable?: boolean;
  /**
   * The original's compressed combo box, which every combo box of the kit is drawn as (32 px, the
   * type of a field): the class stays for a page's own rules
   */
  compact?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  loading?: boolean;
  /** Called as the text changes: the list may come from a search */
  onSearch?: (text: string) => void;
  /** The options are the answer of that search already: they are listed as given */
  searched?: boolean;
  testId?: string;
  fullWidth?: boolean;
  /** The id of the field's text, for a label */
  id?: string;
}

interface Row {
  option?: ComboOption;
  /** A group's name, which is a row of its own and cannot be chosen */
  title?: string;
}

/** The first part of a label that a text matches, whatever its case, marked as the original marks it */
function highlight(label: string, search: string): ReactNode {
  const at = search ? label.toLowerCase().indexOf(search.toLowerCase()) : -1;
  if (at === -1) return label;
  return (
    <>
      {label.slice(0, at)}
      <mark className="atlCombo__mark">{label.slice(at, at + search.length)}</mark>
      {label.slice(at + search.length)}
    </>
  );
}

/** The height of a row of the list, its line under it included, as the original's */
export const COMBO_ROW_HEIGHT = 29;
const VISIBLE_ROWS = 7;
const MAX_LIST_HEIGHT = 200;

/**
 * The options that match a text, as the original's: those whose label holds it, whatever the case,
 * without those chosen already when several are; a group's name above its options.
 */
export function matchingOptions(
  options: ComboOption[],
  selected: string[],
  text: string,
  { searched, single, sortMatchesBy = 'none' }: { searched?: boolean; single?: boolean; sortMatchesBy?: 'none' | 'startsWith' } = {}
): Row[] {
  const needle = text.trim().toLowerCase();
  const rows: Row[] = [];
  let group: string | undefined;
  for (const option of options) {
    if (!single && selected.includes(option.value)) continue;
    if (!searched && needle !== '' && !option.label.trim().toLowerCase().includes(needle)) continue;
    if (option.group !== undefined && option.group !== group) rows.push({ title: option.group });
    group = option.group;
    rows.push({ option });
  }
  if (sortMatchesBy !== 'startsWith') return rows;
  const starting = rows.filter((row) => (row.option?.label ?? row.title ?? '').toLowerCase().startsWith(needle));
  return [...starting, ...rows.filter((row) => !starting.includes(row))];
}

export function ComboBox({
  options,
  selected,
  onChange,
  single,
  placeholder,
  allowCustom,
  onCreateOption,
  delimiter,
  onPasteValues,
  sortMatchesBy = 'none',
  autoFocus,
  clearable = true,
  compact,
  disabled,
  invalid,
  loading,
  onSearch,
  searched,
  testId,
  fullWidth = true,
  id,
}: ComboBoxProps) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [active, setActive] = useState(-1);
  const [focused, setFocused] = useState(false);
  const [scrollTop, setScrollTop] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const field = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);

  const labels = useMemo(() => new Map(options.map((option) => [option.value, option.label])), [options]);
  const rows = useMemo(
    () => matchingOptions(options, selected, text, { searched, single, sortMatchesBy }),
    [options, searched, selected, single, sortMatchesBy, text]
  );
  const creatable = Boolean(allowCustom || onCreateOption);
  const hasActive = active > -1 && active < rows.length;
  const labelOf = (value: string) => labels.get(value) ?? value;
  const isSelected = (value: string) => selected.some((item) => labelOf(item).toLowerCase() === value.toLowerCase());

  // What the list has no longer is not what Enter takes
  useEffect(() => {
    if (active >= rows.length) setActive(-1);
  }, [active, rows.length]);

  // Focused a frame later, after what holds it has given the focus to its own first field (a
  // dialog does), so that this one has it
  useEffect(() => {
    if (!autoFocus) return undefined;
    const frame = requestAnimationFrame(() => input.current?.focus());
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const search = useCallback(
    (value: string) => {
      onSearch?.(value);
      setText(value);
      if (value) setOpen(true);
    },
    [onSearch]
  );

  const closeList = useCallback(() => {
    setActive(-1);
    setOpen(false);
  }, []);

  const choose = (option: ComboOption, leaving = false) => {
    if (option.disabled) return;
    onChange(single ? [option.value] : [...selected, option.value]);
    search('');
    setActive(-1);
    if (!leaving) input.current?.focus();
    if (single) requestAnimationFrame(() => closeList());
  };

  // A text typed and left, or ended with Enter: the one option it names, or a value of its own
  const addCustom = (value: string, leaving: boolean) => {
    const options = rows.filter((row) => row.option);
    if (options.length === 1 && rows.length === 1 && options[0].option?.label.toLowerCase() === text.toLowerCase()) {
      choose(options[0].option as ComboOption, leaving);
      return;
    }
    if (!creatable || !value || isSelected(value)) return;
    if (onCreateOption) onCreateOption(value);
    else onChange(single ? [value] : [...selected, value]);
    search('');
    if (single) closeList();
  };

  const setCustomOptions = (leaving: boolean, value = text) => {
    if (delimiter) {
      for (const part of value.split(delimiter)) if (part.length > 0) addCustom(part, leaving);
    } else addCustom(value, leaving);
  };

  const move = (amount: number) => {
    if (rows.length === 0) return;
    setActive((current) => {
      let next = current < 0 ? (amount < 0 ? rows.length - 1 : 0) : current + amount;
      for (let step = 0; step <= rows.length; step += 1) {
        if (next < 0) next = rows.length - 1;
        else if (next >= rows.length) next = 0;
        if (rows[next].option) return next;
        next += amount > 0 ? 1 : -1;
      }
      return current;
    });
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case 'ArrowUp':
      case 'ArrowDown':
        event.preventDefault();
        event.stopPropagation();
        if (open) move(event.key === 'ArrowUp' ? -1 : 1);
        else setOpen(true);
        break;
      case 'Backspace':
        event.stopPropagation();
        if (selected.length > 0 && text.length === 0) {
          onChange(selected.slice(0, -1));
          setActive(-1);
          if (single && !open) setOpen(true);
        }
        break;
      case 'Escape':
        if (open) {
          event.preventDefault();
          event.stopPropagation();
          closeList();
        }
        break;
      case 'Enter':
        event.preventDefault();
        event.stopPropagation();
        if (hasActive && rows[active].option) choose(rows[active].option as ComboOption);
        else setCustomOptions(false);
        break;
      case 'Tab':
        // While an option is picked with the keys, Tab does not leave
        if (hasActive && open) {
          event.preventDefault();
          event.stopPropagation();
        }
        break;
      default:
    }
  };

  // The row picked with the keys is scrolled to, as the original's list does
  const listHeight = Math.min(Math.min(rows.length, VISIBLE_ROWS) * (COMBO_ROW_HEIGHT + 1), MAX_LIST_HEIGHT);
  useLayoutEffect(() => {
    const element = list.current;
    if (!element || !hasActive) return;
    const top = active * COMBO_ROW_HEIGHT;
    if (top < element.scrollTop) element.scrollTop = top;
    else if (top + COMBO_ROW_HEIGHT > element.scrollTop + listHeight) element.scrollTop = top + COMBO_ROW_HEIGHT - listHeight;
    setScrollTop(element.scrollTop);
  }, [active, hasActive, listHeight]);
  useEffect(() => {
    if (!open) setScrollTop(0);
  }, [open]);

  const markInvalid = invalid || ((!focused || !open) && text !== '');
  const singleLabel = single && selected[0] !== undefined ? labelOf(selected[0]) : '';
  const shown = !single ? [] : singleLabel && text === '' ? [singleLabel] : [];
  const showPlaceholder = Boolean(placeholder) && selected.length === 0 && text === '';

  let empty: ReactNode;
  if (loading) {
    empty = (
      <span className="atlCombo__loading">
        <span className="atlSpinner" />
        Loading options
      </span>
    );
  } else if (text && rows.length === 0) {
    if (creatable) {
      if (delimiter && text.includes(delimiter)) {
        empty = (
          <span className="atlCombo__custom">
            <span className="atlGrow">
              Add each item separated by <strong>{delimiter}</strong>
            </span>
            <EnterBadge />
          </span>
        );
      } else if (isSelected(text)) {
        const label = selected.map(labelOf).find((item) => item.toLowerCase() === text.toLowerCase());
        empty = (
          <>
            <strong>{label}</strong> has already been added
          </>
        );
      } else {
        empty = (
          <span className="atlCombo__custom">
            <span className="atlGrow">
              Add <strong>{text}</strong> as a custom option
            </span>
            <EnterBadge />
          </span>
        );
      }
    } else {
      empty = (
        <>
          <strong>{text}</strong> doesn&apos;t match any options
        </>
      );
    }
  } else if (options.length === 0) {
    empty = "There aren't any options available";
  } else if (!searched && !single && options.every((option) => isSelected(option.label))) {
    empty = "You've selected all available options";
  }

  // Only the rows in sight are drawn, as the original's list draws them
  const first = Math.max(0, Math.floor(scrollTop / COMBO_ROW_HEIGHT) - 2);
  const last = Math.min(rows.length, Math.ceil((scrollTop + listHeight) / COMBO_ROW_HEIGHT) + 2);

  return (
    <Popover
      open={open && !disabled}
      onClose={closeList}
      matchWidth
      fitWidth
      className="atlCombo__listPanel"
      anchorStyle={fullWidth ? { display: 'flex', width: '100%' } : undefined}
      button={
        <div
          ref={field}
          className={cx(
            'atlField',
            'atlCombo',
            compact && 'atlCombo--s',
            markInvalid && 'atlField--invalid',
            disabled && 'atlCombo--disabled',
            open && !disabled && 'atlCombo--open',
            single && 'atlCombo--single',
            // As the original's, the room for the clear button is kept whether something is chosen or not
            clearable && !disabled && 'atlCombo--clearable',
            loading && 'atlCombo--loading'
          )}
          onMouseDown={(event) => {
            if (disabled) return;
            if (event.target !== input.current) event.preventDefault();
            input.current?.focus();
            setOpen(true);
            // Clicked again, a single choice is where the keys start
            if (single && selected.length === 1) {
              setActive(rows.findIndex((row) => row.option?.value === selected[0]));
            } else setActive(-1);
          }}
          data-test-subj={testId}
          aria-expanded={open}
          aria-haspopup="listbox"
          role="combobox"
        >
          {!single &&
            selected.map((value) => (
              <span key={value} className="atlCombo__pill">
                <span className="atlTruncate">{labelOf(value)}</span>
                <button
                  type="button"
                  aria-label={`Remove ${labelOf(value)} from selection in this group`}
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={() => {
                    onChange(selected.filter((item) => item !== value));
                    setActive(-1);
                  }}
                >
                  <Icon name="cross" />
                </button>
              </span>
            ))}
          {shown.map((label) => (
            <span key={label} className="atlCombo__plain atlTruncate">
              {label}
            </span>
          ))}
          {showPlaceholder && <span className="atlCombo__placeholder atlTruncate">{placeholder}</span>}
          <input
            ref={input}
            id={id}
            value={text}
            disabled={disabled}
            onChange={(event) => {
              const value = event.target.value;
              search(value);
              // The delimiter ends a value as it is typed
              if (delimiter && value.endsWith(delimiter)) setCustomOptions(false, value);
            }}
            onFocus={() => {
              if (focused) return;
              setOpen(true);
              setFocused(true);
            }}
            onBlur={(event) => {
              const next = event.relatedTarget as Node | null;
              if (next && (list.current?.contains(next) || field.current?.contains(next))) return;
              closeList();
              setFocused(false);
              // What was typed and left becomes a value, so that the field does not read as text
              if (!hasActive) setCustomOptions(true);
            }}
            onPaste={(event) => {
              const pasted = event.clipboardData.getData('text');
              if (onPasteValues && pasted.includes(',')) {
                event.preventDefault();
                event.stopPropagation();
                onPasteValues(
                  pasted
                    .split(',')
                    .map((value) => value.trim())
                    .filter((value) => value.length > 0)
                );
              }
            }}
            onKeyDown={onKeyDown}
            aria-expanded={open}
            aria-autocomplete="list"
            autoComplete="off"
            spellCheck={false}
            data-test-subj="comboBoxSearchInput"
          />
          {loading && <span className="atlSpinner" />}
          {clearable && selected.length > 0 && !disabled && (
            <button
              type="button"
              className="atlCombo__clear"
              aria-label="Clear input"
              data-test-subj="comboBoxClearButton"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={() => {
                onChange([]);
                input.current?.focus();
                setOpen(true);
              }}
            >
              <Icon name="cross" />
            </button>
          )}
          <button
            type="button"
            className="atlCombo__caret"
            tabIndex={-1}
            disabled={disabled}
            aria-label={open ? 'Close list of options' : 'Open list of options'}
            data-test-subj="comboBoxToggleListButton"
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (disabled) return;
              if (open) closeList();
              else {
                input.current?.focus();
                setOpen(true);
              }
            }}
          >
            <Icon name="chevronDown" />
          </button>
        </div>
      }
    >
      <div
        className="atlCombo__list"
        role="listbox"
        data-test-subj={testId ? `comboBoxOptionsList ${testId}-optionsList` : 'comboBoxOptionsList'}
        // A press on the list or its scrollbar keeps the text field focused
        onMouseDown={(event) => event.preventDefault()}
      >
        {empty !== undefined ? (
          <div className="atlCombo__empty">{empty}</div>
        ) : (
          <div
            ref={list}
            className="atlCombo__rows"
            style={{ height: listHeight }}
            onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
          >
            <div style={{ position: 'relative', height: rows.length * COMBO_ROW_HEIGHT }}>
              {rows.slice(first, last).map((row, offset) => {
                const index = first + offset;
                const style = { top: index * COMBO_ROW_HEIGHT, height: COMBO_ROW_HEIGHT };
                if (!row.option) {
                  return (
                    <div key={`title-${row.title}`} className="atlCombo__title" style={style}>
                      {row.title}
                    </div>
                  );
                }
                const option = row.option;
                const isActive = index === active;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="option"
                    className={cx('atlCombo__option', isActive && 'atlCombo__option--active')}
                    style={style}
                    title={option.label}
                    aria-selected={isActive}
                    disabled={option.disabled}
                    data-test-subj={option.testId}
                    onClick={() => choose(option)}
                  >
                    {single && (
                      <span className="atlCombo__check">
                        {selected[0] === option.value && <Icon name="check" />}
                      </span>
                    )}
                    {option.prepend}
                    <span className="atlCombo__label">
                      <span className="atlTruncate">
                        {highlight(option.label, text)}
                        {option.detail ? ` ${option.detail}` : ''}
                      </span>
                      {isActive && !option.disabled && <EnterBadge />}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </Popover>
  );
}

/** The key that takes the option picked: a badge with the return key on it */
function EnterBadge() {
  return (
    <span className="atlCombo__enter" aria-hidden>
      <Icon name="returnKey" />
    </span>
  );
}

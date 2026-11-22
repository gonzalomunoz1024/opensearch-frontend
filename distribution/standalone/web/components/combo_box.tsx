/* SPDX-License-Identifier: Apache-2.0 */

/* A field that picks one or several of a list by typing: fields, index patterns, values. */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
}

export interface ComboBoxProps {
  options: ComboOption[];
  selected: string[];
  onChange: (selected: string[]) => void;
  /** One value only: the field shows it, and choosing another replaces it */
  single?: boolean;
  placeholder?: string;
  /** Typing something that is not an option makes it one */
  allowCustom?: boolean;
  clearable?: boolean;
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
}

const MAX_SHOWN = 200;

export function ComboBox({
  options,
  selected,
  onChange,
  single,
  placeholder,
  allowCustom,
  clearable = true,
  compact,
  disabled,
  invalid,
  loading,
  onSearch,
  searched,
  testId,
  fullWidth = true,
}: ComboBoxProps) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  const labels = useMemo(() => new Map(options.map((option) => [option.value, option.label])), [options]);
  const matches = useMemo(() => {
    const needle = searched ? '' : text.trim().toLowerCase();
    const found = options.filter(
      (option) =>
        (single || !selected.includes(option.value)) &&
        (needle === '' || option.label.toLowerCase().includes(needle))
    );
    if (needle !== '') {
      // What is the text comes first, then what starts with it, then what merely contains it
      const rank = (label: string) => (label === needle ? 2 : label.startsWith(needle) ? 1 : 0);
      found.sort((a, b) => rank(b.label.toLowerCase()) - rank(a.label.toLowerCase()));
    }
    return found;
  }, [options, searched, selected, single, text]);
  const custom =
    allowCustom && text.trim() !== '' && !options.some((option) => option.label === text.trim())
      ? text.trim()
      : undefined;
  const shown = matches.slice(0, MAX_SHOWN);

  // A list that came from a search is asked for again whole once the text is gone
  const typed = useRef(text);
  typed.current = text;
  const forget = useCallback(() => {
    if (searched && typed.current !== '') onSearch?.('');
    setText('');
  }, [onSearch, searched]);
  const close = useCallback(() => {
    setOpen(false);
    forget();
  }, [forget]);

  useEffect(() => setActive(0), [text, open]);
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const choose = (value: string) => {
    if (single) {
      onChange([value]);
      close();
      input.current?.blur();
    } else {
      onChange([...selected, value]);
      forget();
      input.current?.focus();
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    const count = shown.length + (custom ? 1 : 0);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) setOpen(true);
      else setActive((index) => Math.min(index + 1, count - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter') {
      if (!open) return;
      event.preventDefault();
      if (custom && active === 0) choose(custom);
      else {
        const option = shown[active - (custom ? 1 : 0)];
        if (option && !option.disabled) choose(option.value);
      }
    } else if (event.key === 'Backspace' && text === '' && !single && selected.length > 0) {
      onChange(selected.slice(0, -1));
    } else if (event.key === 'Escape' && open) {
      event.stopPropagation();
      close();
    }
  };

  const singleLabel = single && selected[0] !== undefined ? (labels.get(selected[0]) ?? selected[0]) : '';
  let lastGroup: string | undefined;

  return (
    <Popover
      open={open && !disabled}
      onClose={close}
      matchWidth
      anchorStyle={fullWidth ? { display: 'flex', width: '100%' } : undefined}
      button={
        <div
          className={cx(
            'atlField',
            'atlCombo',
            compact && 'atlCombo--s',
            invalid && 'atlField--invalid',
            disabled && 'atlCombo--disabled'
          )}
          onMouseDown={(event) => {
            if (disabled) return;
            if (event.target !== input.current) {
              event.preventDefault();
              input.current?.focus();
            }
            setOpen(true);
          }}
          data-test-subj={testId}
        >
          {!single &&
            selected.map((value) => (
              <span key={value} className="atlCombo__pill">
                <span className="atlTruncate">{labels.get(value) ?? value}</span>
                <button
                  type="button"
                  aria-label={`Remove ${labels.get(value) ?? value}`}
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={() => onChange(selected.filter((item) => item !== value))}
                >
                  <Icon name="cross" />
                </button>
              </span>
            ))}
          <input
            ref={input}
            value={open ? text : singleLabel}
            placeholder={selected.length === 0 || (single && open) ? (singleLabel || placeholder) : undefined}
            disabled={disabled}
            onChange={(event) => {
              setText(event.target.value);
              setOpen(true);
              onSearch?.(event.target.value);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            role="combobox"
            aria-expanded={open}
            autoComplete="off"
            spellCheck={false}
          />
          {loading && <span className="atlSpinner" />}
          {clearable && selected.length > 0 && !disabled && (
            <button
              type="button"
              className="atlCombo__clear"
              aria-label="Clear"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={() => {
                onChange([]);
                forget();
              }}
            >
              <Icon name="cross" />
            </button>
          )}
          <Icon name="chevronDown" className="atlCombo__caret" />
        </div>
      }
    >
      <div ref={list} className="atlMenu atlCombo__list" role="listbox">
        {custom && (
          <button
            type="button"
            className="atlMenu__item"
            aria-selected={active === 0}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => choose(custom)}
          >
            <span className="atlGrow atlTruncate">Use “{custom}”</span>
          </button>
        )}
        {shown.map((option, index) => {
          const header = option.group !== lastGroup ? option.group : undefined;
          lastGroup = option.group;
          const position = index + (custom ? 1 : 0);
          return (
            <div key={option.value}>
              {header && <div className="atlMenu__title">{header}</div>}
              <button
                type="button"
                role="option"
                className="atlMenu__item"
                aria-selected={position === active}
                disabled={option.disabled}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(position)}
                onClick={() => choose(option.value)}
              >
                {option.prepend}
                <span className="atlGrow atlTruncate">{option.label}</span>
                {single && selected[0] === option.value && <Icon name="check" />}
              </button>
            </div>
          );
        })}
        {shown.length === 0 && !custom && (
          <div className="atlCombo__empty">
            {loading ? (
              'Loading options'
            ) : text.trim() !== '' ? (
              <>
                <strong>{text}</strong> doesn&apos;t match any options
              </>
            ) : options.length > 0 && !single && options.every((option) => selected.includes(option.value)) ? (
              "You've selected all available options"
            ) : (
              "There aren't any options available"
            )}
          </div>
        )}
        {matches.length > MAX_SHOWN && (
          <div className="atlCombo__empty">
            {matches.length - MAX_SHOWN} more: type to narrow the list
          </div>
        )}
      </div>
    </Popover>
  );
}

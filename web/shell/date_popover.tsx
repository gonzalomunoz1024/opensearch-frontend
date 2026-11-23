/* SPDX-License-Identifier: Apache-2.0 */

/*
 * One end of the date picker's range: the button that writes it, and under it the three ways to say
 * a date (Absolute, Relative, Now) as the original's date popover has them. Every change is given up
 * at once; nothing here applies it.
 */

import { useId, useRef, useState, type FocusEvent } from 'react';
import { Button, cx } from '../components/basic';
import { Select, Switch } from '../components/form';
import { Popover } from '../components/overlay';
import { DEFAULT_DATE_FORMAT, formatDate } from '../lib/dates';
import {
  RELATIVE_OPTIONS,
  TIME_UNITS,
  dateOf,
  formatTimeString,
  getDateMode,
  isRelativeUnit,
  parseFormattedDate,
  parseRelativeParts,
  toAbsoluteString,
  toRelativeString,
  toRelativeStringFromParts,
  type DateContext,
  type DateMode,
  type RelativeUnit,
} from '../lib/date_picker';
import { services } from '../services';
import { Calendar } from './calendar';

/** The format the product writes a date in (the `dateFormat` setting) */
export const pickerDateFormat = () => services.uiSettings.get<string>('dateFormat', DEFAULT_DATE_FORMAT);

/** What the picker reads a date against: the product's zone and the first day of its week */
export const pickerDateContext = (): DateContext => ({
  timeZone: services.timeZone(),
  weekStart: services.weekStart(),
});

export type DatePosition = 'start' | 'end';

const positionName = (position: DatePosition) => (position === 'start' ? 'Start' : 'End');

export interface DatePopoverButtonProps {
  position: DatePosition;
  value: string;
  /** The range cannot be applied: both of its ends say so */
  invalid: boolean;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onChange: (value: string) => void;
}

/** One end of the range, written as the original writes it; a press opens the ways to change it */
export function DatePopoverButton({ position, value, invalid, open, onToggle, onClose, onChange }: DatePopoverButtonProps) {
  const roundUp = position === 'end';
  return (
    <Popover
      open={open}
      onClose={onClose}
      position={roundUp ? 'downRight' : 'downLeft'}
      className="shlDatePopover"
      anchorClassName={cx('shlDatePicker__end', `shlDatePicker__end--${position}`)}
      button={
        <button
          type="button"
          className={cx(
            'shlDateButton',
            `shlDateButton--${position}`,
            open && 'shlDateButton--selected',
            invalid && 'shlDateButton--invalid'
          )}
          title={invalid ? `Invalid date: ${value}` : value}
          onClick={onToggle}
          data-test-subj={`superDatePicker${position}DatePopoverButton`}
        >
          {formatTimeString(value, pickerDateFormat(), roundUp, pickerDateContext())}
        </button>
      }
    >
      <DatePopoverContent value={value} roundUp={roundUp} position={position} onChange={onChange} />
    </Popover>
  );
}

const TABS: Array<{ id: DateMode; name: string; testId: string }> = [
  { id: 'absolute', name: 'Absolute', testId: 'superDatePickerAbsoluteTab' },
  { id: 'relative', name: 'Relative', testId: 'superDatePickerRelativeTab' },
  { id: 'now', name: 'Now', testId: 'superDatePickerNowTab' },
];

interface TabProps {
  value: string;
  roundUp: boolean;
  position: DatePosition;
  onChange: (value: string) => void;
}

/**
 * The three tabs. The one shown first is the kind of date the value is; after that it is the one
 * chosen, whatever the value becomes. Choosing Absolute or Relative rewrites the value as that kind.
 */
function DatePopoverContent({ value, roundUp, position, onChange }: TabProps) {
  const [tab, setTab] = useState<DateMode>(() => getDateMode(value));
  const id = useId();
  const tabs = useRef<HTMLDivElement>(null);
  // The focus that comes into the tabs goes to the one chosen, as the original's
  const inFocus = useRef(false);
  const onFocus = () => {
    if (inFocus.current) return;
    inFocus.current = true;
    tabs.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
  };
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget)) inFocus.current = false;
  };
  const context = pickerDateContext();
  const choose = (next: DateMode) => {
    if (next === 'absolute') onChange(toAbsoluteString(value, roundUp, context));
    else if (next === 'relative') onChange(toRelativeString(value, context));
    setTab(next);
  };

  return (
    <div className="shlDatePopover__content">
      <div ref={tabs} className="shlDatePopover__tabs" role="tablist" onFocus={onFocus} onBlur={onBlur}>
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`${id}-${item.id}`}
            className={cx('shlDatePopover__tab', item.id === tab && 'shlDatePopover__tab--selected')}
            aria-selected={item.id === tab}
            aria-controls={id}
            aria-label={`${positionName(position)} date: ${item.name}`}
            data-test-subj={item.testId}
            onClick={() => choose(item.id)}
          >
            <span className="shlDatePopover__tabText">{item.name}</span>
          </button>
        ))}
      </div>
      <div role="tabpanel" id={id} aria-labelledby={`${id}-${tab}`}>
        {tab === 'absolute' && <AbsoluteTab value={value} roundUp={roundUp} position={position} onChange={onChange} />}
        {tab === 'relative' && (
          // As the original's: it is handed the moment the value is, not the value
          <RelativeTab
            value={toAbsoluteString(value, roundUp, context)}
            roundUp={roundUp}
            position={position}
            onChange={onChange}
          />
        )}
        {tab === 'now' && (
          <div className="shlDatePopover__now">
            <p>
              Setting the time to &quot;now&quot; means that on every refresh this time will be set to the time of the
              refresh.
            </p>
            <Button full onClick={() => onChange('now')} testId="superDatePickerNowButton">
              Set {position} date and time to now
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * A date of the calendar: a day and a time chosen, or the date typed in the product's format. What
 * is typed and is no date in that format changes nothing and says what was expected.
 */
function AbsoluteTab({ value, roundUp, position, onChange }: TabProps) {
  const format = pickerDateFormat();
  const timeZone = services.timeZone();
  const field = useId();
  // What it starts from: the moment the value is, the present when it is none
  const [state, setState] = useState<{ date: Date | undefined; text: string; invalid: boolean }>(() => {
    const date = dateOf(value, roundUp, pickerDateContext()) ?? new Date();
    return { date, text: formatDate(date, format, timeZone), invalid: false };
  });

  const onCalendarChange = (date: Date) => {
    onChange(date.toISOString());
    setState({ date, text: formatDate(date, format, timeZone), invalid: false });
  };
  const onTextChange = (text: string) => {
    const date = parseFormattedDate(text, format, timeZone);
    if (date) onChange(date.toISOString());
    setState({ date, text, invalid: !date });
  };

  return (
    <div>
      <Calendar selected={state.date} onChange={onCalendarChange} />
      <div className="shlDatePopover__absoluteRow">
        <div className={cx('shlDateField', state.invalid && 'shlDateField--invalid')}>
          <label className="shlDateField__label" htmlFor={field}>
            {positionName(position)} date
          </label>
          <input
            id={field}
            type="text"
            className="shlDateField__input"
            value={state.text}
            aria-invalid={state.invalid || undefined}
            onChange={(event) => onTextChange(event.target.value)}
            data-test-subj="superDatePickerAbsoluteDateInput"
          />
        </div>
        {state.invalid && <div className="shlDatePopover__error">Expected format {format}</div>}
      </div>
    </div>
  );
}

/**
 * A date counted from the present: so many units ago or from now, rounded to the unit when asked.
 * It starts from the moment it is given, which is why a week back opens as "1 Weeks ago".
 */
function RelativeTab({ value, roundUp, position, onChange }: TabProps) {
  const context = pickerDateContext();
  const [parts, setParts] = useState<{ count: number | undefined; unit: string; round: boolean; roundUnit?: RelativeUnit }>(
    () => parseRelativeParts(value, context)
  );
  const description = useId();
  const field = useId();

  const change = (next: typeof parts) => {
    setParts(next);
    if (next.count === undefined || next.count < 0) return;
    onChange(toRelativeStringFromParts({ ...next, count: next.count }));
  };

  const invalid = parts.count === undefined || parts.count < 0;
  const date = dateOf(value, roundUp, context);
  const formatted = invalid || !date ? '' : formatDate(date, pickerDateFormat(), context.timeZone);
  const unit = parts.unit.substring(0, 1);

  return (
    <div className="shlDatePopover__relative">
      <div className="shlDatePopover__relativeRow">
        <div className="shlDatePopover__relativeField">
          <input
            type="number"
            className={cx('atlField', 'atlField--s', invalid && 'atlField--invalid')}
            value={parts.count ?? ''}
            aria-label="Time span amount"
            aria-describedby={description}
            aria-invalid={invalid || undefined}
            onChange={(event) => {
              // Read as the original reads it: the whole number it starts with, nothing for the rest
              const count = parseInt(event.target.value, 10);
              change({ ...parts, count: Number.isNaN(count) ? undefined : count });
            }}
            data-test-subj="superDatePickerRelativeDateInputNumber"
          />
          {invalid && <div className="shlDatePopover__error">Must be &gt;= 0</div>}
        </div>
        <div className="shlDatePopover__relativeField">
          <Select
            compact
            value={parts.unit}
            onChange={(next) => change({ ...parts, unit: next })}
            options={RELATIVE_OPTIONS.map((option) => ({ value: option.value, label: option.text }))}
            aria-label="Relative time span"
            testId="superDatePickerRelativeDateInputUnitSelector"
          />
        </div>
      </div>
      <div className="shlDatePopover__switch">
        <Switch
          checked={parts.round}
          onChange={(round) => change({ ...parts, round })}
          label={`Round to the ${isRelativeUnit(unit) ? TIME_UNITS[unit] : unit}`}
          testId="superDatePickerRelativeDateRoundSwitch"
        />
      </div>
      <div className="shlDateField shlDateField--readOnly">
        <label className="shlDateField__label" htmlFor={field}>
          {positionName(position)} date
        </label>
        <input id={field} type="text" className="shlDateField__input" value={formatted} readOnly />
      </div>
      <p id={description} className="atlScreenReaderOnly">
        The unit is changeable. Currently set to {parts.unit}.
      </p>
    </div>
  );
}

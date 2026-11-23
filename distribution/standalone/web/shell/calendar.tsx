/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The calendar of the date picker's Absolute tab: a month of days, the lists that choose another
 * month or year, and a list of times, behaving as the calendar the original's component library
 * carries (written after react-datepicker 2.0.0, see NOTICE). Every step changes the date at once:
 * a day, a month or a year chosen, an arrow, a key on the month, a time. The date is read on the
 * clock of the product's time zone.
 */

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { cx } from '../components/basic';
import { Icon } from '../components/icon';
import {
  calendarWeeks,
  daysInMonth,
  fromZonedParts,
  monthName,
  shiftDay,
  weekdayMin,
  zonedParts,
  type ZonedParts,
} from '../lib/date_picker';
import { services } from '../services';

export interface CalendarProps {
  /** The moment chosen; none while what is typed beside the calendar is no date */
  selected: Date | undefined;
  onChange: (date: Date) => void;
}

/** The times offered: every half hour of a day */
const SLOT_MINUTES = 30;
const SLOTS = (24 * 60) / SLOT_MINUTES;
/** How many years the list of years offers before and after the one shown */
const YEARS_AROUND = 7;

const MONTHS = Array.from({ length: 12 }, (_, month) => ({ value: month, label: monthName(month) }));

const pad = (value: number) => String(value).padStart(2, '0');
const slotOf = (parts: ZonedParts) => Math.floor((parts.hour * 60 + parts.minute) / SLOT_MINUTES);
const slotLabel = (slot: number) => `${pad(Math.floor((slot * SLOT_MINUTES) / 60))}:${pad((slot * SLOT_MINUTES) % 60)}`;
type Day = Pick<ZonedParts, 'year' | 'month' | 'day'>;
const sameDay = (one: Day, other: Day) =>
  one.year === other.year && one.month === other.month && one.day === other.day;
/** Two moments the original takes for the same one: it compares them to the second */
const sameSecond = (one: Date, other: Date) => Math.floor(one.getTime() / 1000) === Math.floor(other.getTime() / 1000);

type Step = [amount: number, unit: 'd' | 'w' | 'M' | 'y'];
const GRID_KEYS: Record<string, Step> = {
  ArrowLeft: [-1, 'd'],
  ArrowRight: [1, 'd'],
  ArrowUp: [-1, 'w'],
  ArrowDown: [1, 'w'],
  PageUp: [-1, 'M'],
  PageDown: [1, 'M'],
  Home: [-1, 'y'],
  End: [1, 'y'],
};

export function Calendar({ selected, onChange }: CalendarProps) {
  const timeZone = services.timeZone();
  const chosen = selected ? zonedParts(selected, timeZone) : undefined;
  // The day whose month is shown: the day chosen, and the last one while there is none
  const [view, setView] = useState<ZonedParts>(() => chosen ?? zonedParts(new Date(), timeZone));
  const [followed, setFollowed] = useState(chosen);
  if (chosen && (!followed || !sameDay(chosen, followed))) {
    setFollowed(chosen);
    if (!sameDay(chosen, view)) setView(chosen);
  } else if (!chosen && followed) {
    setFollowed(undefined);
  }
  const [open, setOpen] = useState<'month' | 'year'>();
  const [gridFocused, setGridFocused] = useState(false);
  const monthContainer = useRef<HTMLDivElement>(null);
  const monthRead = useRef<HTMLDivElement>(null);
  const yearRead = useRef<HTMLDivElement>(null);

  /** The day becomes the date, at the time of day the date had */
  const select = (day: ZonedParts) => {
    const time = chosen ?? day;
    const next = fromZonedParts(
      { ...day, hour: time.hour, minute: time.minute, second: time.second, ms: time.ms },
      timeZone
    );
    if (!next || (selected && sameSecond(next, selected))) return;
    onChange(next);
  };
  const move = (day: ZonedParts) => {
    setView(day);
    select(day);
  };
  const withMonth = (month: number): ZonedParts => ({
    ...view,
    month,
    day: Math.min(view.day, daysInMonth(view.year, month)),
  });
  const withYear = (year: number): ZonedParts => ({
    ...view,
    year,
    day: Math.min(view.day, daysInMonth(year, view.month)),
  });

  const chooseTime = (slot: number) => {
    const base = chosen ?? zonedParts(new Date(), timeZone);
    const minutes = slot * SLOT_MINUTES;
    const next = fromZonedParts(
      { ...base, hour: Math.floor(minutes / 60), minute: minutes % 60, second: 0, ms: 0 },
      timeZone
    );
    if (!next || (selected && sameSecond(next, selected))) return;
    onChange(next);
  };

  // A list that closes gives the focus back to what opened it
  const close = (which: 'month' | 'year') => {
    setOpen(undefined);
    window.setTimeout(() => (which === 'month' ? monthRead : yearRead).current?.focus(), 0);
  };
  const toggle = (which: 'month' | 'year') => (open === which ? close(which) : setOpen(which));
  const onReadKey = (which: 'month' | 'year') => (event: KeyboardEvent) => {
    if (event.key !== ' ' && event.key !== 'Enter') return;
    event.preventDefault();
    event.stopPropagation();
    toggle(which);
  };

  const onGridKey = (event: KeyboardEvent) => {
    // The keys start from the day chosen; without one, from the day the month is shown for
    const from = chosen ?? view;
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      move(from);
      return;
    }
    const step = GRID_KEYS[event.key];
    if (!step) return;
    event.preventDefault();
    move(shiftDay(from, step[0], step[1]));
  };

  const today = zonedParts(new Date(), timeZone);
  const weeks = calendarWeeks(view.year, view.month, services.weekStart());
  const years = Array.from({ length: 2 * YEARS_AROUND + 1 }, (_, index) => {
    const year = view.year + YEARS_AROUND - index;
    return { value: year, label: String(year) };
  });

  return (
    <div className="shlCalendar">
      <button
        type="button"
        className="shlCalendar__nav shlCalendar__nav--previous"
        onClick={() => move(shiftDay(view, -1, 'M'))}
      >
        <Icon name="chevronDown" />
        <span className="atlScreenReaderOnly">Previous Month</span>
      </button>
      <button
        type="button"
        className="shlCalendar__nav shlCalendar__nav--next"
        onClick={() => move(shiftDay(view, 1, 'M'))}
      >
        <Icon name="chevronDown" />
        <span className="atlScreenReaderOnly">Next month</span>
      </button>
      <div ref={monthContainer} className="shlCalendar__monthContainer">
        <div className="shlCalendar__header">
          <div className="shlCalendar__reads">
            <div className="shlCalendar__readContainer">
              {open === 'month' && (
                <Dropdown
                  kind="month"
                  options={MONTHS}
                  current={view.month}
                  onChoose={(month) => {
                    close('month');
                    if (month !== view.month) move(withMonth(month));
                  }}
                  onCancel={() => close('month')}
                />
              )}
              <div
                ref={monthRead}
                className="shlCalendar__read shlCalendar__monthRead"
                style={{ visibility: open === 'month' ? 'hidden' : 'visible' }}
                tabIndex={0}
                aria-label={`Button. Open the month selector. ${monthName(view.month)} is currently selected.`}
                onClick={() => toggle('month')}
                onKeyDown={onReadKey('month')}
              >
                <span>{monthName(view.month)}</span>
              </div>
            </div>
            <div className="shlCalendar__readContainer">
              {open === 'year' && (
                <Dropdown
                  kind="year"
                  options={years}
                  current={view.year}
                  onChoose={(year) => {
                    close('year');
                    if (year !== view.year) move(withYear(year));
                  }}
                  onCancel={() => close('year')}
                />
              )}
              <div
                ref={yearRead}
                className="shlCalendar__read shlCalendar__yearRead"
                style={{ visibility: open === 'year' ? 'hidden' : 'visible' }}
                tabIndex={0}
                aria-label={`Button. Open the year selector. ${view.year} is currently selected.`}
                onClick={() => toggle('year')}
                onKeyDown={onReadKey('year')}
              >
                <span>{view.year}</span>
              </div>
            </div>
          </div>
          <div className="shlCalendar__dayNames">
            {weeks[0].map((day) => (
              <div key={day.weekday} className="shlCalendar__dayName">
                {weekdayMin(day.weekday)}
              </div>
            ))}
          </div>
        </div>
        <div
          className="shlCalendar__month"
          role="listbox"
          aria-label={`month-${view.year}-${pad(view.month + 1)}`}
          tabIndex={0}
          onKeyDown={onGridKey}
          onFocus={() => setGridFocused(true)}
          onBlur={() => setGridFocused(false)}
        >
          <span className="atlScreenReaderOnly">
            {gridFocused && (
              <p aria-live="polite">
                You are focused on a calendar. Use the arrow keys to navigate the days in the month. Use the page up
                and down keys to navigate from month to month. Use the home and end keys to navigate from year to
                year.
                {chosen
                  ? `${monthName(chosen.month)} ${chosen.day}, ${chosen.year}. is the currently focused date.`
                  : 'No date is currently focused.'}
              </p>
            )}
          </span>
          {weeks.map((week) => (
            <div key={`${week[0].year}-${week[0].month}-${week[0].day}`} className="shlCalendar__week">
              {week.map((day) => (
                <div
                  key={day.day}
                  className={cx(
                    'shlCalendar__day',
                    chosen && sameDay(chosen, day) && 'shlCalendar__day--selected',
                    sameDay(today, day) && 'shlCalendar__day--today',
                    day.month !== view.month && 'shlCalendar__day--outside'
                  )}
                  aria-label={`day-${day.day}`}
                  onClick={() =>
                    move({ year: day.year, month: day.month, day: day.day, hour: 0, minute: 0, second: 0, ms: 0 })
                  }
                >
                  {day.day}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
      <TimeList selected={selected} timeZone={timeZone} onChoose={chooseTime} monthContainer={monthContainer} />
    </div>
  );
}

/**
 * The list a month or a year is chosen from, over the whole calendar. The arrow keys move a mark
 * through it, Enter or the space bar takes the marked one, Escape or a press outside leaves it.
 */
function Dropdown({
  kind,
  options,
  current,
  onChoose,
  onCancel,
}: {
  kind: 'month' | 'year';
  /** In the order they are written: the years from the latest down, as the original's */
  options: Array<{ value: number; label: string }>;
  current: number;
  onChoose: (value: number) => void;
  onCancel: () => void;
}) {
  const [marked, setMarked] = useState(current);
  const [focused, setFocused] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const cancel = useRef(onCancel);
  cancel.current = onCancel;

  useEffect(() => {
    box.current?.focus();
    const onDown = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) cancel.current();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const values = options.map((option) => option.value);
  const lowest = Math.min(...values);
  const highest = Math.max(...values);
  const onKeyDown = (event: KeyboardEvent) => {
    switch (event.key) {
      case 'ArrowUp':
      case 'ArrowDown': {
        event.preventDefault();
        event.stopPropagation();
        const next = marked + (event.key === 'ArrowUp' ? -1 : 1);
        setMarked(next < lowest ? highest : next > highest ? lowest : next);
        break;
      }
      case 'Escape':
        // The list closes; what holds the calendar stays open
        event.preventDefault();
        event.stopPropagation();
        onCancel();
        break;
      case ' ':
      case 'Enter':
        event.preventDefault();
        event.stopPropagation();
        onChoose(marked);
        break;
      case 'Tab':
        // The focus stays in the list while it is open
        event.preventDefault();
        break;
      default:
    }
  };
  const markedLabel = options.find((option) => option.value === marked)?.label ?? '';

  return (
    <div
      ref={box}
      className={cx('shlCalendar__dropdown', kind === 'year' && 'shlCalendar__dropdown--year')}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    >
      <span className="atlScreenReaderOnly">
        {focused && (
          <p aria-live="polite">
            You are focused on a {kind} selector menu. Use the up and down arrows to select a year, then hit enter to
            confirm your selection.
            {markedLabel} is the currently focused {kind}.
          </p>
        )}
      </span>
      {options.map((option, index) => (
        <div
          key={option.value}
          className={cx(
            'shlCalendar__option',
            kind === 'month' && index === 0 && 'shlCalendar__option--first',
            kind === 'month' && index === options.length - 1 && 'shlCalendar__option--last',
            option.value === current && 'shlCalendar__option--selected',
            option.value === marked && 'shlCalendar__option--preselected'
          )}
          onClick={() => onChoose(option.value)}
        >
          {option.label}
        </div>
      ))}
    </div>
  );
}

/**
 * The times of a day, half an hour apart. The one the date has is filled; a date between two has
 * the earlier one marked when the list opens, and the list opens with it in the middle. The arrow
 * keys move the mark, Enter or the space bar takes the marked time.
 */
function TimeList({
  selected,
  timeZone,
  onChoose,
  monthContainer,
}: {
  selected: Date | undefined;
  timeZone: string | undefined;
  onChoose: (slot: number) => void;
  monthContainer: RefObject<HTMLDivElement>;
}) {
  // Without a date the original reads the present
  const active = zonedParts(selected ?? new Date(), timeZone);
  const [marked, setMarked] = useState<number | undefined>(() => slotOf(active));
  const [focused, setFocused] = useState(false);
  const list = useRef<HTMLUListElement>(null);
  const item = (slot: number) => list.current?.children[slot] as HTMLElement | undefined;
  const show = (slot: number) => {
    const element = list.current;
    const row = item(slot);
    if (!element || !row) return;
    if (row.offsetTop < element.scrollTop) element.scrollTop = row.offsetTop;
    else if (row.offsetTop + row.offsetHeight > element.scrollTop + element.clientHeight) {
      element.scrollTop = row.offsetTop + row.offsetHeight - element.clientHeight;
    }
  };

  // Opened with the date's time in the middle of the height the month has
  useLayoutEffect(() => {
    const element = list.current;
    const row = item(slotOf(active));
    const height = monthContainer.current?.clientHeight ?? element?.clientHeight ?? 0;
    if (element && row) element.scrollTop = row.offsetTop - (height / 2 - row.clientHeight / 2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A date that changes takes the mark away, and its time is brought into view
  const time = selected?.getTime();
  const previous = useRef(time);
  useEffect(() => {
    if (time === undefined || time === previous.current) {
      previous.current = time;
      return;
    }
    previous.current = time;
    setMarked(undefined);
    const parts = zonedParts(new Date(time), timeZone);
    if ((parts.hour * 60 + parts.minute) % SLOT_MINUTES === 0) show(slotOf(parts));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [time, timeZone]);

  const onKeyDown = (event: KeyboardEvent) => {
    // The keys start from the mark; without one, from the time the date has
    const from = marked ?? slotOf(active);
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      const next = (from + (event.key === 'ArrowUp' ? -1 : 1) + SLOTS) % SLOTS;
      setMarked(next);
      show(next);
    } else if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      onChoose(from);
    }
  };

  const activeSlot = (active.hour * 60 + active.minute) % SLOT_MINUTES === 0 ? slotOf(active) : undefined;
  return (
    <div className={cx('shlCalendar__timeContainer', focused && 'shlCalendar__timeContainer--focus')}>
      <span className="atlScreenReaderOnly">
        {focused && (
          <p aria-live="polite">
            You are a in a time selector. Use the up and down keys to select from other common times then press enter
            to confirm.
            {marked !== undefined ? `${slotLabel(marked)} is currently focused.` : 'No time is currently focused.'}
          </p>
        )}
      </span>
      <div className="shlCalendar__timeColumn">
        <div
          className="shlCalendar__timeBox"
          tabIndex={0}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        >
          {/* Tab stops at the list as at the original's, which the browser lets the keyboard
              scroll; said here, so that the popover's hold of Tab knows it */}
          <ul ref={list} className="shlCalendar__timeList" role="listbox" tabIndex={0}>
            {Array.from({ length: SLOTS }, (_, slot) => (
              <li
                key={slot}
                className={cx(
                  'shlCalendar__time',
                  slot === activeSlot
                    ? 'shlCalendar__time--selected'
                    : slot === marked && 'shlCalendar__time--preselected'
                )}
                role="option"
                aria-selected={slot === activeSlot}
                onClick={() => onChoose(slot)}
              >
                {slotLabel(slot)}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

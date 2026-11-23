/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The date picker of the bar, as the original's super date picker in its query bar: the button of
 * the quick menu, and beside it the range, by its name ("Last 15 minutes") or as its two ends, each
 * a button that opens the ways to change it. It applies nothing itself: a change of an end is given
 * up to wait for the Update button, a choice of the quick menu to be applied at once.
 */

import { useCallback, useId, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Button } from '../components/basic';
import { Select } from '../components/form';
import { Icon } from '../components/icon';
import { Popover, Tooltip } from '../components/overlay';
import type { TimeRange } from '../lib/dates';
import {
  COMMON_DURATION_RANGES,
  TIME_UNITS_PLURAL,
  isRangeInvalid,
  isRelativeUnit,
  parseTimeParts,
  prettyDuration,
  quickSelectRange,
  showPrettyDuration,
  stepRange,
  type QuickRange,
  type QuickSelect,
  type RelativeUnit,
  type TimeTense,
} from '../lib/date_picker';
import type { RefreshInterval } from '../lib/types';
import { services } from '../services';
import { DatePopoverButton, pickerDateContext, pickerDateFormat } from './date_popover';
import { prettyInterval } from './refresh_interval';
import { RefreshEvery } from './refresh_picker';

/** The ranges the product offers as commonly used (the `timepicker:quickRanges` setting) */
export function quickRanges(): QuickRange[] {
  const ranges = services.uiSettings.get<QuickRange[]>('timepicker:quickRanges', []);
  return Array.isArray(ranges) ? ranges : [];
}

/** The test id of a commonly used range: the original puts a line in place of the first space only */
export const commonlyUsedTestId = (label: string) => `superDatePickerCommonlyUsed_${label.replace(' ', '_')}`;

/**
 * The button the picker starts with and the menu it opens. It is a calendar, and a clock while the
 * page refreshes itself or has no dates.
 */
function QuickMenu({ clock, children }: { clock: boolean; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <Popover
      open={open}
      onClose={close}
      position="downLeft"
      className="shlQuickMenu__panel"
      anchorClassName="shlDatePicker__quickAnchor"
      button={
        <button
          type="button"
          className="shlDatePicker__quick"
          aria-label="Date quick select"
          onClick={() => setOpen((was) => !was)}
          data-test-subj="superDatePickerToggleQuickMenuButton"
        >
          <Icon name={clock ? 'clock' : 'calendar'} />
          <Icon name="chevronDown" size="s" />
        </button>
      }
    >
      <div className="shlQuickMenu" data-test-subj="superDatePickerQuickMenu">
        {children(close)}
      </div>
    </Popover>
  );
}

const TENSES: Array<{ value: TimeTense; label: string }> = [
  { value: 'last', label: 'Last' },
  { value: 'next', label: 'Next' },
];
const UNITS = (Object.keys(TIME_UNITS_PLURAL) as RelativeUnit[]).map((unit) => ({
  value: unit,
  label: TIME_UNITS_PLURAL[unit],
}));

/**
 * "Quick select": a length of time back from the present or on from it, and the two arrows that
 * step the range a whole length back or on. It starts from what was applied with it last, and
 * otherwise from the range.
 */
function QuickSelectFields({
  range,
  previous,
  onApply,
  onStep,
}: {
  range: TimeRange;
  previous: QuickSelect | undefined;
  onApply: (quickSelect: QuickSelect) => void;
  onStep: (range: TimeRange) => void;
}) {
  const [state, setState] = useState<QuickSelect>(() => {
    const parsed = parseTimeParts(range.from, range.to, pickerDateContext());
    return {
      timeTense: previous?.timeTense || parsed.timeTense,
      timeValue: previous?.timeValue || parsed.timeValue,
      timeUnits: previous?.timeUnits || parsed.timeUnits,
    };
  });
  const legend = useId();
  const description = useId();
  const described = `${description} ${legend}`;

  // The original's Enter applies a length its button refuses, nothing or less: not copied
  const apply = () => {
    if (state.timeValue > 0) onApply(state);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter') apply();
  };
  const step = (direction: 1 | -1) => onStep(stepRange(range.from, range.to, direction, pickerDateContext()));

  return (
    <fieldset className="shlQuickMenu__fieldset">
      <legend id={legend} className="atlScreenReaderOnly">
        Quick select a time range
      </legend>
      <div className="shlQuickMenu__head">
        <div className="shlQuickMenu__label" aria-hidden="true">
          Quick select
        </div>
        <div className="shlQuickMenu__steps">
          <Tooltip content="Previous time window" delay="regular">
            <button type="button" className="shlQuickMenu__step" aria-label="Previous time window" onClick={() => step(-1)}>
              <Icon name="chevronLeft" />
            </button>
          </Tooltip>
          <Tooltip content="Next time window" delay="regular">
            <button type="button" className="shlQuickMenu__step" aria-label="Next time window" onClick={() => step(1)}>
              <Icon name="chevronRight" />
            </button>
          </Tooltip>
        </div>
      </div>
      <div className="shlQuickMenu__fields">
        {/* Each in an item of its own, so that the three share the room whatever their padding */}
        <div className="shlQuickMenu__field">
          <Select
            compact
            value={state.timeTense}
            onChange={(next) => setState({ ...state, timeTense: next === 'next' ? 'next' : 'last' })}
            onKeyDown={onKeyDown}
            options={TENSES}
            aria-label="Time tense"
            aria-describedby={described}
          />
        </div>
        <div className="shlQuickMenu__field">
          <input
            type="number"
            className="atlField atlField--s"
            value={state.timeValue}
            onChange={(event) => {
              // Read as the original reads it: the whole number it starts with, nothing for the rest
              const value = parseInt(event.target.value, 10);
              setState({ ...state, timeValue: Number.isNaN(value) ? 0 : value });
            }}
            onKeyDown={onKeyDown}
            aria-label="Time value"
            aria-describedby={described}
          />
        </div>
        <div className="shlQuickMenu__field">
          <Select
            compact
            value={state.timeUnits}
            onChange={(next) => setState({ ...state, timeUnits: isRelativeUnit(next) ? next : state.timeUnits })}
            onKeyDown={onKeyDown}
            options={UNITS}
            aria-label="Time unit"
            aria-describedby={described}
          />
        </div>
        <Button className="shlQuickMenu__apply" disabled={state.timeValue <= 0} onClick={apply} aria-describedby={described}>
          Apply
        </Button>
      </div>
      <hr className="shlQuickMenu__rule" />
      <p id={description} className="atlScreenReaderOnly">
        Currently set to {state.timeTense} {state.timeValue} {TIME_UNITS_PLURAL[state.timeUnits]}.
      </p>
    </fieldset>
  );
}

/** A list of ranges of the quick menu under its heading: a press on one applies it */
function RangeList({
  legend,
  columns,
  items,
  onApply,
}: {
  legend: string;
  /** In two columns, filled one after the other, as the commonly used ranges */
  columns?: boolean;
  items: Array<{ key: string; label: string; range: TimeRange; testId?: string }>;
  onApply: (range: TimeRange) => void;
}) {
  const id = useId();
  return (
    <fieldset className="shlQuickMenu__fieldset">
      <legend id={id} className="shlQuickMenu__title">
        {legend}
      </legend>
      <div className="shlQuickMenu__section">
        <ul className={columns ? 'shlQuickMenu__grid' : 'shlQuickMenu__list'} aria-labelledby={columns ? id : undefined}>
          {items.map((item) => (
            <li key={item.key} className="shlQuickMenu__item">
              <button
                type="button"
                className="shlQuickMenu__link"
                onClick={() => onApply(item.range)}
                data-test-subj={item.testId}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      </div>
      <hr className="shlQuickMenu__rule" />
    </fieldset>
  );
}

export interface TimePickerProps {
  /** The range as it stands in the bar: the one applied, or one changed that waits for the Update button */
  range: TimeRange;
  /** An end of the range was changed: it waits */
  onChange: (range: TimeRange) => void;
  /** A range was chosen in the quick menu: it is applied at once */
  onQuickApply: (range: TimeRange) => void;
  /** The ranges applied before, the newest first */
  recentRanges: TimeRange[];
  refreshInterval: RefreshInterval;
  onRefreshChange: (interval: RefreshInterval) => void;
}

export function TimePicker({ range, onChange, onQuickApply, recentRanges, refreshInterval, onRefreshChange }: TimePickerProps) {
  const ranges = quickRanges();
  const format = pickerDateFormat();
  const context = pickerDateContext();
  // Whether the range is written by its name: decided again whenever it changes
  const [shown, setShown] = useState(() => ({ ...range, pretty: showPrettyDuration(range.from, range.to, ranges) }));
  if (shown.from !== range.from || shown.to !== range.to) {
    setShown({ ...range, pretty: showPrettyDuration(range.from, range.to, ranges) });
  }
  const [startOpen, setStartOpen] = useState(false);
  const [endOpen, setEndOpen] = useState(false);
  const closeStart = useCallback(() => setStartOpen(false), []);
  const closeEnd = useCallback(() => setEndOpen(false), []);
  // What the quick select applied last, kept while the picker is there
  const [quickSelect, setQuickSelect] = useState<QuickSelect>();

  const invalid = isRangeInvalid(range.from, range.to, context);

  // As the original's: what the menu applies is named after the component library's own ranges,
  // until the range that comes back is another one and is named after the product's
  const quickApply = (next: TimeRange) => {
    setShown((was) => ({ ...was, pretty: showPrettyDuration(next.from, next.to, COMMON_DURATION_RANGES) }));
    onQuickApply(next);
  };

  return (
    <div className="shlDatePicker">
      <QuickMenu clock={!refreshInterval.pause}>
        {(close) => (
          <>
            <QuickSelectFields
              range={range}
              previous={quickSelect}
              onApply={(next) => {
                setQuickSelect(next);
                quickApply(quickSelectRange(next));
                close();
              }}
              onStep={quickApply}
            />
            <RangeList
              legend="Commonly used"
              columns
              items={ranges.map((item) => ({
                key: item.display,
                label: item.display,
                range: { from: item.from, to: item.to },
                testId: item.display ? commonlyUsedTestId(item.display) : undefined,
              }))}
              onApply={(next) => {
                quickApply(next);
                close();
              }}
            />
            {recentRanges.length > 0 && (
              <RangeList
                legend="Recently used date ranges"
                items={recentRanges.map((item) => ({
                  key: `${item.from}-${item.to}`,
                  label: prettyDuration(item.from, item.to, ranges, format, context),
                  range: item,
                }))}
                onApply={(next) => {
                  quickApply(next);
                  close();
                }}
              />
            )}
            <RefreshEvery refreshInterval={refreshInterval} onRefreshChange={onRefreshChange} />
          </>
        )}
      </QuickMenu>
      <div className="shlDatePicker__range">
        {shown.pretty && !startOpen && !endOpen ? (
          <button
            type="button"
            className="shlDatePicker__pretty"
            onClick={() => {
              setShown({ ...shown, pretty: false });
              setStartOpen(true);
            }}
            data-test-subj="superDatePickerShowDatesButton"
          >
            {prettyDuration(range.from, range.to, ranges, format, context)}
            <span className="shlDatePicker__prettyLink">Show dates</span>
          </button>
        ) : (
          <>
            <DatePopoverButton
              position="start"
              value={range.from}
              invalid={invalid}
              open={startOpen}
              onToggle={() => setStartOpen((was) => !was)}
              onClose={closeStart}
              onChange={(from) => onChange({ from, to: range.to })}
            />
            <div className="shlDatePicker__delimiter">
              <span>→</span>
            </div>
            <DatePopoverButton
              position="end"
              value={range.to}
              invalid={invalid}
              open={endOpen}
              onToggle={() => setEndOpen((was) => !was)}
              onClose={closeEnd}
              onChange={(to) => onChange({ from: range.from, to })}
            />
          </>
        )}
      </div>
    </div>
  );
}

/**
 * The picker without its dates, for a page a range of dates means nothing to (the original's "auto
 * refresh only"): its button opens "Refresh every" alone, and beside it the interval is written out.
 */
export function RefreshOnlyPicker({
  refreshInterval,
  onRefreshChange,
}: {
  refreshInterval: RefreshInterval;
  onRefreshChange: (interval: RefreshInterval) => void;
}) {
  return (
    <div className="shlDatePicker">
      <QuickMenu clock>
        {() => <RefreshEvery refreshInterval={refreshInterval} onRefreshChange={onRefreshChange} />}
      </QuickMenu>
      <div className="shlDatePicker__range">
        <span className="shlDatePicker__pretty">{prettyInterval(refreshInterval.pause, refreshInterval.value)}</span>
      </div>
    </div>
  );
}

/**
 * The button that applies what waits and searches again, as `EuiSuperUpdateButton` draws it:
 * "Refresh", "Update" in the success colour once something waits, "Updating" while the page
 * searches; its tooltip says whether it can apply. Narrow, it is its icon alone.
 */
export function SuperUpdateButton({
  needsUpdate,
  loading,
  disabled,
  onClick,
}: {
  needsUpdate: boolean;
  loading?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const tip = disabled ? 'Cannot update' : needsUpdate && !loading ? 'Click to apply' : undefined;
  const button = (
    <Button
      variant={needsUpdate || loading ? 'healthyOutline' : 'default'}
      icon="refresh"
      loading={loading}
      disabled={disabled}
      onClick={onClick}
      className="shlUpdateButton"
      aria-label="Submit query"
      testId="querySubmitButton"
    >
      <span className="shlUpdateButton__text">{loading ? 'Updating' : needsUpdate ? 'Update' : 'Refresh'}</span>
    </Button>
  );
  return tip ? (
    <Tooltip content={tip} position="bottom">
      {button}
    </Tooltip>
  ) : (
    button
  );
}

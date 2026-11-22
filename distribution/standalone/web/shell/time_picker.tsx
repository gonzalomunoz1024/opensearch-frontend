/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The time picker: quick ranges, a start and an end that are each a date, a relative expression
 * or "now", and the refresh interval. A change to a date waits for the Update button; a quick
 * range applies at once.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Segments, cx } from '../components/basic';
import { NumberField, Select, Switch } from '../components/form';
import { Icon } from '../components/icon';
import { Popover } from '../components/overlay';
import {
  UNIT_NAMES,
  formatDate,
  parseDateMath,
  type TimeRange,
  type TimeUnit,
} from '../lib/dates';
import type { RefreshInterval } from '../lib/types';
import { services } from '../services';
import { readStored, writeStored } from './state';

interface QuickRange {
  from: string;
  to: string;
  display: string;
}

const UNITS: TimeUnit[] = ['s', 'm', 'h', 'd', 'w', 'M', 'y'];

const RELATIVE = /^now([+-])(\d+)([smhdwMy])(?:\/([smhdwMy]))?$/;

const plural = (count: number, unit: TimeUnit) => UNIT_NAMES[unit][count === 1 ? 0 : 1];

function dateSettings() {
  return {
    format: services.uiSettings.get<string>('dateFormat', 'MMM D, YYYY @ HH:mm:ss.SSS'),
    timeZone: services.timeZone(),
    weekStart: services.weekStart(),
  };
}

/** What a range is called: a quick range's name, "Last 15 minutes", or nothing */
export function prettyRange(range: TimeRange, quickRanges: QuickRange[]): string | undefined {
  const quick = quickRanges.find((item) => item.from === range.from && item.to === range.to);
  if (quick) return quick.display;
  const from = RELATIVE.exec(range.from);
  const to = RELATIVE.exec(range.to);
  if (range.to === 'now' && from && from[1] === '-') {
    const unit = from[3] as TimeUnit;
    if (!from[4] || from[4] === unit) {
      return `Last ${from[2]} ${plural(Number(from[2]), unit)}${from[4] ? ', rounded' : ''}`;
    }
  }
  if (range.from === 'now' && to && to[1] === '+') {
    return `Next ${to[2]} ${plural(Number(to[2]), to[3] as TimeUnit)}`;
  }
  return undefined;
}

/** One end of a range, in words */
export function describeDate(text: string, roundUp: boolean): string {
  if (text === 'now') return 'now';
  const relative = RELATIVE.exec(text);
  if (relative) {
    const count = Number(relative[2]);
    const words = `${count} ${plural(count, relative[3] as TimeUnit)}`;
    return relative[1] === '-' ? `~ ${words} ago` : `~ in ${words}`;
  }
  const { format, timeZone, weekStart } = dateSettings();
  const date = parseDateMath(text, { roundUp, weekStart });
  return date ? formatDate(date, format, timeZone) : 'Invalid date';
}

const pad = (value: number) => String(value).padStart(2, '0');

/** The value of a datetime-local field for a date, in the browser's own zone */
function toLocalInput(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function DateEditor({
  value,
  onChange,
  roundUp,
}: {
  value: string;
  onChange: (value: string) => void;
  roundUp: boolean;
}) {
  const { weekStart } = dateSettings();
  const relative = RELATIVE.exec(value);
  const initial = value === 'now' ? 'now' : relative ? 'relative' : 'absolute';
  const [tab, setTab] = useState<'absolute' | 'relative' | 'now'>(initial);
  const resolved = parseDateMath(value, { roundUp, weekStart });

  const count = relative ? Number(relative[2]) : 15;
  const unit = (relative?.[3] as TimeUnit | undefined) ?? 'm';
  const direction = relative?.[1] ?? '-';
  const rounded = Boolean(relative?.[4]);
  const setRelative = (next: { count?: number; unit?: TimeUnit; direction?: string; rounded?: boolean }) => {
    const nextUnit = next.unit ?? unit;
    const round = (next.rounded ?? rounded) ? `/${nextUnit}` : '';
    onChange(`now${next.direction ?? direction}${Math.max(0, next.count ?? count)}${nextUnit}${round}`);
  };

  return (
    <div className="shlDateEditor atlStack">
      <Segments
        options={[
          { id: 'absolute', label: 'Absolute' },
          { id: 'relative', label: 'Relative' },
          { id: 'now', label: 'Now' },
        ]}
        value={tab}
        onChange={(next) => {
          setTab(next);
          if (next === 'now') onChange('now');
          else if (next === 'relative' && !relative) onChange(`now-15m`);
          else if (next === 'absolute' && resolved) onChange(resolved.toISOString());
        }}
      />
      {tab === 'absolute' && (
        <>
          <input
            type="datetime-local"
            className="atlField"
            step={1}
            value={resolved ? toLocalInput(resolved) : ''}
            onChange={(event) => {
              const date = new Date(event.target.value);
              if (!Number.isNaN(date.getTime())) onChange(date.toISOString());
            }}
            aria-label="Date and time"
          />
          <span className="atlSubdued atlSmall">{describeDate(value, roundUp)}</span>
        </>
      )}
      {tab === 'relative' && (
        <>
          <div className="atlRow">
            <NumberField
              min={0}
              value={count}
              onChange={(next) => setRelative({ count: next ?? 0 })}
              aria-label="Amount"
              style={{ width: 96 }}
            />
            <Select
              value={`${direction}${unit}`}
              onChange={(next) => setRelative({ direction: next[0], unit: next.slice(1) as TimeUnit })}
              options={[
                ...UNITS.map((item) => ({
                  value: `-${item}`,
                  label: `${UNIT_NAMES[item][1][0].toUpperCase()}${UNIT_NAMES[item][1].slice(1)} ago`,
                })),
                ...UNITS.map((item) => ({
                  value: `+${item}`,
                  label: `${UNIT_NAMES[item][1][0].toUpperCase()}${UNIT_NAMES[item][1].slice(1)} from now`,
                })),
              ]}
              aria-label="Unit"
            />
          </div>
          <Switch
            checked={rounded}
            onChange={(next) => setRelative({ rounded: next })}
            label={`Round to the ${UNIT_NAMES[unit][0]}`}
          />
          <span className="atlSubdued atlSmall">
            {resolved
              ? formatDate(resolved, dateSettings().format, dateSettings().timeZone)
              : 'Invalid date'}
          </span>
        </>
      )}
      {tab === 'now' && (
        <span className="atlSubdued">
          Setting the time to “now” means that on every refresh this time is set to the time of the
          refresh.
        </span>
      )}
    </div>
  );
}

function DateButton({
  value,
  onChange,
  roundUp,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  roundUp: boolean;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const text = describeDate(value, roundUp);
  return (
    <Popover
      open={open}
      onClose={close}
      padded
      align={roundUp ? 'right' : 'left'}
      anchorStyle={{ height: '100%' }}
      button={
        <button
          type="button"
          className={cx('shlTime__date', text === 'Invalid date' && 'shlTime__date--invalid')}
          aria-expanded={open}
          aria-label={label}
          onClick={() => setOpen(!open)}
          data-test-subj={roundUp ? 'superDatePickerendDatePopoverButton' : 'superDatePickerstartDatePopoverButton'}
        >
          {text}
        </button>
      }
    >
      <DateEditor value={value} onChange={onChange} roundUp={roundUp} />
    </Popover>
  );
}

const REFRESH_UNITS: Array<{ value: string; label: string; ms: number }> = [
  { value: 's', label: 'seconds', ms: 1000 },
  { value: 'm', label: 'minutes', ms: 60000 },
  { value: 'h', label: 'hours', ms: 3600000 },
];

function refreshParts(ms: number) {
  if (ms >= 3600000 && ms % 3600000 === 0) return { count: ms / 3600000, unit: 'h' };
  if (ms >= 60000 && ms % 60000 === 0) return { count: ms / 60000, unit: 'm' };
  return { count: Math.max(1, Math.round(ms / 1000)), unit: 's' };
}

function QuickMenu({
  onApply,
  refreshInterval,
  onRefreshChange,
  quickRanges,
}: {
  onApply: (range: TimeRange) => void;
  refreshInterval: RefreshInterval;
  onRefreshChange: (interval: RefreshInterval) => void;
  quickRanges: QuickRange[];
}) {
  const [tense, setTense] = useState('last');
  const [count, setCount] = useState(15);
  const [unit, setUnit] = useState<TimeUnit>('m');
  const initialRefresh = refreshParts(refreshInterval.value || 10000);
  const [refreshCount, setRefreshCount] = useState(initialRefresh.count);
  const [refreshUnit, setRefreshUnit] = useState(initialRefresh.unit);
  const recent = readStored<TimeRange[]>('recentRanges', []);
  const refreshMs = refreshCount * (REFRESH_UNITS.find((item) => item.value === refreshUnit)?.ms ?? 1000);

  return (
    <div className="shlTimeMenu" data-test-subj="superDatePickerQuickMenu">
      <div className="shlTimeMenu__section">
        <div className="atlTitleXxs">Quick select</div>
        <div className="atlRow" style={{ marginTop: 'var(--space-2)' }}>
          <Select
            compact
            value={tense}
            onChange={setTense}
            options={[
              { value: 'last', label: 'Last' },
              { value: 'next', label: 'Next' },
            ]}
            aria-label="Time tense"
            style={{ width: 80 }}
          />
          <NumberField
            compact
            min={1}
            value={count}
            onChange={(next) => setCount(next ?? 1)}
            aria-label="Time value"
            style={{ width: 80 }}
          />
          <Select
            compact
            value={unit}
            onChange={(next) => setUnit(next as TimeUnit)}
            options={UNITS.map((item) => ({ value: item, label: UNIT_NAMES[item][1] }))}
            aria-label="Time unit"
          />
          <Button
            size="s"
            variant="tint"
            onClick={() =>
              onApply(
                tense === 'last'
                  ? { from: `now-${count}${unit}`, to: 'now' }
                  : { from: 'now', to: `now+${count}${unit}` }
              )
            }
            testId="superDatePickerQuickMenuApply"
          >
            Apply
          </Button>
        </div>
      </div>
      <div className="shlTimeMenu__section">
        <div className="atlTitleXxs">Commonly used</div>
        <div className="shlTimeMenu__ranges">
          {quickRanges.map((range) => (
            <button
              key={`${range.from}${range.to}`}
              type="button"
              className="atlLinkButton"
              onClick={() => onApply({ from: range.from, to: range.to })}
              data-test-subj={`superDatePickerCommonlyUsed_${range.display.replace(/ /g, '_')}`}
            >
              {range.display}
            </button>
          ))}
        </div>
      </div>
      {recent.length > 0 && (
        <div className="shlTimeMenu__section">
          <div className="atlTitleXxs">Recently used date ranges</div>
          <div className="atlStack" style={{ gap: 2, marginTop: 'var(--space-2)', alignItems: 'flex-start' }}>
            {recent.map((range) => (
              <button
                key={`${range.from}${range.to}`}
                type="button"
                className="atlLinkButton"
                onClick={() => onApply(range)}
              >
                {prettyRange(range, quickRanges) ??
                  `${describeDate(range.from, false)} to ${describeDate(range.to, true)}`}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="shlTimeMenu__section">
        <div className="atlTitleXxs">Refresh every</div>
        <div className="atlRow" style={{ marginTop: 'var(--space-2)' }}>
          <NumberField
            compact
            min={1}
            value={refreshCount}
            onChange={(next) => setRefreshCount(next ?? 1)}
            aria-label="Refresh interval value"
            style={{ width: 80 }}
            testId="superDatePickerRefreshIntervalInput"
          />
          <Select
            compact
            value={refreshUnit}
            onChange={setRefreshUnit}
            options={REFRESH_UNITS.map((item) => ({ value: item.value, label: item.label }))}
            aria-label="Refresh interval units"
          />
          <Button
            size="s"
            variant="tint"
            icon={refreshInterval.pause ? 'play' : 'stop'}
            onClick={() => onRefreshChange({ pause: !refreshInterval.pause, value: refreshMs })}
            testId="superDatePickerToggleRefreshButton"
          >
            {refreshInterval.pause ? 'Start' : 'Stop'}
          </Button>
        </div>
      </div>
    </div>
  );
}

export interface TimePickerProps {
  time: TimeRange;
  refreshInterval: RefreshInterval;
  onTimeChange: (range: TimeRange) => void;
  onRefreshChange: (interval: RefreshInterval) => void;
  /** Asked again without a change: the Refresh button */
  onRefresh: () => void;
  loading?: boolean;
  /** Something else on the page waits for the Update button too: a query being typed */
  dirty?: boolean;
  /** What the Update button applies besides the dates */
  onUpdate?: () => void;
  showUpdateButton?: boolean;
}

export function TimePicker({
  time,
  refreshInterval,
  onTimeChange,
  onRefreshChange,
  onRefresh,
  loading,
  dirty,
  onUpdate,
  showUpdateButton = true,
}: TimePickerProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [draft, setDraft] = useState(time);
  const [showDates, setShowDates] = useState(false);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  useEffect(() => setDraft(time), [time]);

  const quickRanges = useMemo(
    () => services.uiSettings.get<QuickRange[]>('timepicker:quickRanges', []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [services.uiSettings.getVersion()]
  );
  const changed = draft.from !== time.from || draft.to !== time.to;
  const pretty = prettyRange(draft, quickRanges);
  const { weekStart } = dateSettings();
  const from = parseDateMath(draft.from, { weekStart });
  const to = parseDateMath(draft.to, { weekStart, roundUp: true });
  const invalid = !from || !to || from.getTime() > to.getTime();

  const apply = (range: TimeRange) => {
    const recent = readStored<TimeRange[]>('recentRanges', []).filter(
      (item) => !(item.from === range.from && item.to === range.to)
    );
    writeStored('recentRanges', [range, ...recent].slice(0, 5));
    setShowDates(false);
    setMenuOpen(false);
    if (range.from === time.from && range.to === time.to) onRefresh();
    else onTimeChange(range);
  };

  const needsUpdate = changed || Boolean(dirty);
  return (
    <>
      <div className={cx('atlField', 'shlTime', invalid && 'atlField--invalid')} data-test-subj="superDatePickerToggleQuickMenuButtonWrapper">
        <Popover
          open={menuOpen}
          onClose={closeMenu}
          padded
          anchorStyle={{ height: '100%' }}
          button={
            <button
              type="button"
              className="shlTime__quick"
              aria-label="Date quick select"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(!menuOpen)}
              data-test-subj="superDatePickerToggleQuickMenuButton"
            >
              <Icon name={refreshInterval.pause ? 'calendar' : 'refresh'} />
              <Icon name="chevronDown" />
            </button>
          }
        >
          <QuickMenu
            onApply={apply}
            refreshInterval={refreshInterval}
            onRefreshChange={onRefreshChange}
            quickRanges={quickRanges}
          />
        </Popover>
        {pretty && !showDates ? (
          <button
            type="button"
            className="shlTime__range"
            onClick={() => setShowDates(true)}
            data-test-subj="superDatePickerShowDatesButton"
          >
            <span>{pretty}</span>
            <span>Show dates</span>
          </button>
        ) : (
          <>
            <DateButton
              label="Start date"
              value={draft.from}
              roundUp={false}
              onChange={(value) => setDraft({ ...draft, from: value })}
            />
            <Icon name="arrowRight" className="shlTime__arrow" />
            <DateButton
              label="End date"
              value={draft.to}
              roundUp
              onChange={(value) => setDraft({ ...draft, to: value })}
            />
          </>
        )}
      </div>
      {showUpdateButton && (
        <Button
          variant={needsUpdate ? 'primary' : 'default'}
          icon={needsUpdate ? 'arrowRight' : 'refresh'}
          loading={loading && !needsUpdate}
          disabled={invalid}
          onClick={() => {
            onUpdate?.();
            if (changed) apply(draft);
            else if (!dirty) onRefresh();
          }}
          className="shlTime__submit"
          testId="querySubmitButton"
        >
          {needsUpdate ? 'Update' : 'Refresh'}
        </Button>
      )}
    </>
  );
}

/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Input controls drawn as OpenSearch Dashboards 3.9.0 draws them with the fork's Atlas theme: a
 * row of labelled lists and ranges, and under them "Apply changes", "Cancel changes" and "Clear
 * form". A control that cannot be used says why in a tooltip. What each control asks OpenSearch,
 * and the filters it makes, are in controls.ts.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button, cx } from '../components/basic';
import { ComboBox } from '../components/combo_box';
import { Icon } from '../components/icon';
import { Tooltip } from '../components/overlay';
import { resolveTimeRange } from '../lib/dates';
import { fieldFormatter } from '../lib/field_formats';
import { timeRangeFilter } from '../lib/query';
import type { Field, Filter, IndexPattern } from '../lib/types';
import type { Vis } from '../lib/vis';
import { services } from '../services';
import { errorMessage } from '../services/http';
import { searchFailure } from '../services/search';
import {
  AUTOCOMPLETE_TERMINATE_AFTER,
  AUTOCOMPLETE_TIMEOUT_MS,
  NOT_INITIALIZED,
  PARTIAL_RESULTS,
  ancestorsOf,
  asksAsTyped,
  ceilWithPrecision,
  controlLabel,
  controlSearchBody,
  filterOf,
  floorWithPrecision,
  hasValue,
  minMaxAggs,
  noIndexPatternMessage,
  noValuesMessage,
  rangeError,
  rangeInputWidth,
  rangeValueOf,
  sameValue,
  submitFilters,
  termsAggs,
  trackShare,
  usableControls,
  valuesFromFilters,
  waitingForMessage,
  type ControlParam,
  type ControlValue,
  type ControlValues,
  type ControlsParams,
  type ListValue,
  type RangeValue,
} from './controls';
import type { VisInput } from './request';

/** What a control learnt from OpenSearch: its choices or its bounds, or why it cannot be used */
interface ControlState {
  indexPattern?: IndexPattern;
  enabled: boolean;
  disabledReason: string;
  options?: ListValue;
  partialResults?: boolean;
  min?: number;
  max?: number;
}

const disabled = (reason: string, indexPattern?: IndexPattern): ControlState => ({
  indexPattern,
  enabled: false,
  disabledReason: reason,
});

const isAbort = (failure: unknown) => (failure as Error | undefined)?.name === 'AbortError';

interface Ancestor {
  control: ControlParam;
  value: ControlValue;
  /** Its field as its own index pattern has it */
  field?: Field;
}

const fieldNamed = (indexPattern: IndexPattern | undefined, name: string | undefined) =>
  name ? indexPattern?.fields.find((candidate) => candidate.name === name) : undefined;

async function fetchList(
  control: ControlParam,
  indexPattern: IndexPattern | undefined,
  ancestors: Ancestor[],
  query: string | undefined,
  timeClause: Record<string, unknown> | undefined,
  signal: AbortSignal
): Promise<ControlState> {
  if (!indexPattern) return disabled(noIndexPatternMessage(control.indexPattern ?? ''));
  if (ancestors.length > 0 && ancestors.some((ancestor) => !hasValue(ancestor.control, ancestor.value))) {
    return disabled(waitingForMessage(ancestors[0].control), indexPattern);
  }
  const field = indexPattern.fields.find((candidate) => candidate.name === control.fieldName);
  const ancestorFilters = ancestors
    .map((ancestor) => filterOf(ancestor.control, ancestor.value, ancestor.field))
    .filter((filter): filter is Filter => filter !== undefined);
  const body = controlSearchBody(indexPattern, termsAggs(control, field, query), ancestorFilters, timeClause, {
    timeout: `${AUTOCOMPLETE_TIMEOUT_MS}ms`,
    terminate_after: AUTOCOMPLETE_TERMINATE_AFTER,
  });
  let response;
  try {
    response = await services.search.search(indexPattern.title, body, { signal });
  } catch (failure) {
    if (isAbort(failure)) throw failure;
    // Named as the original names a refused search: by the words of the answer's status
    return disabled(`Unable to fetch terms, error: ${errorMessage(searchFailure(failure as Error))}`, indexPattern);
  }
  const buckets =
    (response.aggregations?.termsAgg as { buckets?: Array<{ key: string | number; key_as_string?: string }> } | undefined)
      ?.buckets ?? [];
  // A boolean comes back as 1 or 0: the choice is the boolean itself
  const options = buckets.map((bucket) =>
    field?.type === 'boolean' ? bucket.key === 1 || bucket.key_as_string === 'true' : bucket.key
  );
  if (options.length === 0 && !query) return disabled(noValuesMessage(control.fieldName ?? '', indexPattern.title), indexPattern);
  const answer = response as { terminated_early?: boolean; timed_out?: boolean };
  return {
    indexPattern,
    enabled: true,
    disabledReason: '',
    options,
    partialResults: Boolean(answer.terminated_early || answer.timed_out),
  };
}

async function fetchRange(
  control: ControlParam,
  indexPattern: IndexPattern | undefined,
  timeClause: Record<string, unknown> | undefined,
  signal: AbortSignal
): Promise<ControlState> {
  if (!indexPattern) return disabled(noIndexPatternMessage(control.indexPattern ?? ''));
  const field = indexPattern.fields.find((candidate) => candidate.name === control.fieldName);
  let response;
  try {
    response = await services.search.search(indexPattern.title, controlSearchBody(indexPattern, minMaxAggs(field), [], timeClause), {
      signal,
    });
  } catch (failure) {
    if (isAbort(failure)) throw failure;
    return disabled(`Unable to fetch range min and max, error: ${errorMessage(searchFailure(failure as Error))}`, indexPattern);
  }
  const found = (response.aggregations ?? {}) as Record<string, { value?: number | null } | undefined>;
  const min = found.minAgg?.value;
  const max = found.maxAgg?.value;
  if (typeof min !== 'number' || typeof max !== 'number') {
    return disabled(noValuesMessage(control.fieldName ?? '', indexPattern.title), indexPattern);
  }
  return { indexPattern, enabled: true, disabledReason: '', min, max };
}

/** The label, the control and what is wrong with it, as the original's form row of a control */
function ControlRow({
  id,
  index,
  label,
  warning,
  disabledReason,
  error,
  children,
}: {
  id: string;
  index: number;
  label: string;
  warning?: string;
  disabledReason?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="atlFormRow visControls__row" data-test-subj={`inputControl${index}`}>
      <label className="atlFormRow__label" htmlFor={id}>
        {warning && (
          <Tooltip content={warning}>
            <Icon name="warning" />
          </Tooltip>
        )}
        {label}
      </label>
      {disabledReason ? (
        <Tooltip content={disabledReason} block>
          {children}
        </Tooltip>
      ) : (
        children
      )}
      {error && <div className="atlFormRow__error">{error}</div>}
    </div>
  );
}

const SEARCH_WAIT_MS = 300;

function ListControl({
  control,
  index,
  state,
  value,
  onChange,
  onSearch,
}: {
  control: ControlParam;
  index: number;
  state?: ControlState;
  value: ListValue;
  onChange: (value: ListValue) => void;
  onSearch: (query: string) => Promise<void>;
}) {
  const id = useId();
  const [loading, setLoading] = useState(false);
  const indexPattern = state?.indexPattern;
  const dynamic = asksAsTyped(control, fieldNamed(indexPattern, control.fieldName));
  const format = useMemo(
    () => (indexPattern && control.fieldName ? fieldFormatter(indexPattern, control.fieldName, services.formatSettings()) : undefined),
    [indexPattern, control.fieldName]
  );
  const label = (item: string | number | boolean) => (format ? format(item).text : String(item));

  // What is typed is searched for a moment after the typing stops, as the original's
  const waiting = useRef<number>();
  useEffect(() => () => window.clearTimeout(waiting.current), []);
  const search = (text: string) => {
    setLoading(true);
    window.clearTimeout(waiting.current);
    waiting.current = window.setTimeout(() => {
      onSearch(text).finally(() => setLoading(false));
    }, SEARCH_WAIT_MS);
  };

  const reason = state?.enabled ? undefined : (state?.disabledReason ?? NOT_INITIALIZED);
  let field: ReactNode;
  if (reason) {
    field = <input id={id} className="atlField visControls__field" placeholder="Select..." aria-label="Select..." disabled />;
  } else {
    const raw = new Map<string, string | number | boolean>();
    for (const item of [...(state?.options ?? []), ...value]) raw.set(String(item), item);
    // The choices in the order of their names, as the original lists them
    const options = (state?.options ?? [])
      .map((item) => ({ value: String(item), label: label(item), testId: `option_${String(item).replace(' ', '_')}` }))
      .sort((a, b) => a.label.toLowerCase().localeCompare(b.label.toLowerCase()));
    // A choice no longer among them keeps its name on its pill
    const missing =
      control.options?.multiselect === false
        ? []
        : value
            .filter((item) => !options.some((option) => option.value === String(item)))
            .map((item) => ({ value: String(item), label: label(item) }));
    field = (
      <ComboBox
        id={id}
        options={[...options, ...missing]}
        selected={value.map(String)}
        onChange={(next) => onChange(next.map((text) => raw.get(text) ?? text))}
        single={control.options?.multiselect === false}
        placeholder="Select..."
        loading={loading}
        onSearch={dynamic ? search : undefined}
        searched={dynamic}
        testId={`listControlSelect${index}`}
      />
    );
  }
  return (
    <ControlRow
      id={id}
      index={index}
      label={controlLabel(control)}
      warning={state?.partialResults ? PARTIAL_RESULTS : undefined}
      disabledReason={reason}
    >
      {field}
    </ControlRow>
  );
}

const STAGE_WAIT_MS = 200;

function RangeControl({
  control,
  index,
  state,
  value,
  onChange,
}: {
  control: ControlParam;
  index: number;
  state?: ControlState;
  value: RangeValue | undefined;
  onChange: (value: RangeValue | undefined) => void;
}) {
  const id = useId();
  const enabled = Boolean(state?.enabled);
  const places = control.options?.decimalPlaces ?? 0;
  // A control that cannot be used shows the original's empty slider, from 0 to 100
  const min = enabled && state?.min !== undefined ? floorWithPrecision(state.min, places) : 0;
  const max = enabled && state?.max !== undefined ? ceilWithPrecision(state.max, places) : 100;
  const step = control.options?.step ?? 1;

  const shown: [string, string] = [
    value?.min === undefined || Number.isNaN(value.min) ? '' : String(value.min),
    value?.max === undefined || Number.isNaN(value.max) ? '' : String(value.max),
  ];
  const shownKey = JSON.stringify(shown);
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shownKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // A valid range is staged a moment after it is typed or dragged; one that is not says why
  const waiting = useRef<number>();
  useEffect(() => () => window.clearTimeout(waiting.current), []);
  const change = (next: [string, string]) => {
    setText(next);
    window.clearTimeout(waiting.current);
    if (rangeError(next, min, max)) return;
    waiting.current = window.setTimeout(() => onChange(rangeValueOf(next)), STAGE_WAIT_MS);
  };
  const error = enabled ? rangeError(text, min, max) : '';

  return (
    <ControlRow
      id={id}
      index={index}
      label={controlLabel(control)}
      disabledReason={enabled ? undefined : (state?.disabledReason ?? NOT_INITIALIZED)}
      error={error}
    >
      <DualRange
        id={id}
        min={min}
        max={max}
        step={step}
        value={enabled ? text : [String(min), String(max)]}
        disabled={!enabled}
        ticks={enabled ? [min, max] : undefined}
        onChange={change}
        testId={`rangeControl${index}`}
      />
    </ControlRow>
  );
}

/**
 * The original's dual range with its number fields: two thumbs on a track, the stretch between
 * them drawn when both ends are set, and the bounds written under the track's ends. A press or a
 * drag on the track moves the nearer thumb; the fields take the keyboard.
 */
function DualRange({
  id,
  min,
  max,
  step,
  value,
  disabled: off,
  ticks,
  onChange,
  testId,
}: {
  id: string;
  min: number;
  max: number;
  step: number;
  value: [string, string];
  disabled?: boolean;
  ticks?: number[];
  onChange: (value: [string, string]) => void;
  testId?: string;
}) {
  const [lowerText, upperText] = value;
  const lower = Number(lowerText) || min;
  const upper = Number(upperText) || max;
  const within = (low: string | number, high: string | number, of: string) =>
    of !== '' && low !== '' && high !== '' && Number(low) <= Number(of) && Number(of) <= Number(high);
  const showHighlight = within(min, upperText, lowerText) && within(lowerText, max, upperText);
  const width = `${rangeInputWidth(min, max)}em`;

  // The thumb nearer the value moves to it, the lower one when they are as near
  const moveNearer = (next: number) => {
    if (Math.abs(Number(lowerText) - next) <= Math.abs(Number(upperText) - next)) onChange([String(next), upperText]);
    else onChange([lowerText, String(next)]);
  };
  const hasTicks = Boolean(ticks);

  return (
    <div className={cx('visControls__range', off && 'visControls__range--disabled')} data-test-subj={testId}>
      <input
        type="number"
        className="atlField visControls__input"
        style={{ width }}
        value={lowerText}
        min={min}
        max={upperText === '' ? max : Number(upperText)}
        step={step}
        disabled={off}
        aria-label="Range minimum"
        onChange={(event) => onChange([event.target.value, upperText])}
      />
      <div className={hasTicks ? 'visControls__spacer visControls__spacer--slim' : 'visControls__spacer'} />
      <div className={cx('visControls__track', hasTicks && 'visControls__track--ticks')}>
        {ticks && (
          <div className="visControls__ticks">
            {ticks.map((tick) => (
              <button
                key={tick}
                type="button"
                className="visControls__tick"
                style={{ left: `calc((100% - 16px) * ${trackShare(tick, min, max)} + 8px)` }}
                value={tick}
                tabIndex={-1}
                disabled={off}
                onClick={() => moveNearer(tick)}
              >
                {tick}
              </button>
            ))}
          </div>
        )}
        <input
          type="range"
          id={id}
          className="visControls__slider"
          min={min}
          max={max}
          step={step}
          disabled={off}
          tabIndex={-1}
          aria-hidden
          onChange={(event) => moveNearer(Number(event.target.value))}
        />
        {showHighlight && (
          <div className="visControls__highlight">
            <div
              className="visControls__progress"
              style={{
                marginLeft: `${trackShare(Number(lowerText), min, max) * 100}%`,
                width: `${((Number(upperText) - Number(lowerText)) / (max - min || 1)) * 100}%`,
              }}
            />
          </div>
        )}
        {[lower, upper].map((at, which) => (
          <div
            key={which}
            className="visControls__thumb"
            role="slider"
            aria-valuemin={min}
            aria-valuemax={max}
            aria-valuenow={at}
            aria-disabled={off || undefined}
            tabIndex={-1}
            style={{ left: `calc((100% - 16px) * ${trackShare(at, min, max)})` }}
          />
        ))}
      </div>
      <div className={hasTicks ? 'visControls__spacer visControls__spacer--slim' : 'visControls__spacer'} />
      <input
        type="number"
        className="atlField visControls__input"
        style={{ width }}
        value={upperText}
        min={lowerText === '' ? min : Number(lowerText)}
        max={max}
        step={step}
        disabled={off}
        aria-label="Range maximum"
        onChange={(event) => onChange([lowerText, event.target.value])}
      />
    </div>
  );
}

export function ControlsVis({
  vis,
  input,
  onFiltersChange,
}: {
  vis: Vis;
  input: VisInput;
  /** Called with every filter of the page, the controls' own replaced */
  onFiltersChange?: (filters: Filter[]) => void;
  /** A refresh: the original's controls keep their choices through it */
  tick?: number;
}) {
  const params = vis.params as ControlsParams;
  const controlsKey = JSON.stringify(usableControls(params));
  const controls = useMemo(() => JSON.parse(controlsKey) as ControlParam[], [controlsKey]);
  const ancestry = useMemo(() => ancestorsOf(controls), [controls]);
  const useTime = Boolean(params.useTimeFilter);

  // What the page's filters say, and what the person has chosen since. Any change of the filters
  // starts the controls over from them, as the original's.
  const filtersKey = JSON.stringify(input.filters);
  const applied = useMemo(() => valuesFromFilters(controls, input.filters), [controls, filtersKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const [staged, setStaged] = useState<ControlValues>(applied);
  useEffect(() => setStaged(applied), [applied]);

  const [states, setStates] = useState<Record<string, ControlState>>({});
  const [ready, setReady] = useState(false);
  const latest = useRef({ staged, input });
  latest.current = { staged, input };
  const patterns = useRef(new Map<string, Promise<IndexPattern | undefined>>());
  // The values of its ancestors each nested list last asked with, as the original's
  const asked = useRef(new Map<string, string>());

  const indexPatternOf = useCallback((id: string) => {
    let found = patterns.current.get(id);
    if (!found) {
      found = services.indexPatterns.get(id).catch(() => undefined);
      patterns.current.set(id, found);
    }
    return found;
  }, []);

  const load = useCallback(
    async (control: ControlParam, values: ControlValues, query: string | undefined, signal: AbortSignal) => {
      const indexPattern = await indexPatternOf(control.indexPattern ?? '');
      const time = latest.current.input.time;
      const timeClause =
        useTime && indexPattern ? timeRangeFilter(indexPattern, resolveTimeRange(time, { weekStart: services.weekStart() })) : undefined;
      if (control.type === 'range') return fetchRange(control, indexPattern, timeClause, signal);
      const parents = ancestry.get(control.id) ?? [];
      if (parents.length > 0) asked.current.set(control.id, JSON.stringify(parents.map((ancestor) => values[ancestor.id] ?? null)));
      // Each parent filters on its field as its own index pattern has it
      const ancestors = await Promise.all(
        parents.map(async (ancestor) => ({
          control: ancestor,
          value: values[ancestor.id],
          field: fieldNamed(await indexPatternOf(ancestor.indexPattern ?? ''), ancestor.fieldName),
        }))
      );
      return fetchList(control, indexPattern, ancestors, query, timeClause, signal);
    },
    [ancestry, indexPatternOf, useTime]
  );

  // Every control, from the start: when the panel is drawn, when its controls change, and when
  // the time range does if the panel follows it. Nothing is drawn until all have answered.
  const timeKey = useTime ? JSON.stringify(input.time) : '';
  useEffect(() => {
    const controller = new AbortController();
    const values = latest.current.staged;
    Promise.all(controls.map((control) => load(control, values, undefined, controller.signal))).then(
      (answers) => {
        setStates(Object.fromEntries(controls.map((control, at) => [control.id, answers[at]])));
        setReady(true);
      },
      () => undefined
    );
    return () => controller.abort();
  }, [controls, load, timeKey]);

  // A nested list asks again when what it depends on changed, as the original's
  const nestedKey = JSON.stringify(
    controls.map((control) => (ancestry.get(control.id) ?? []).map((ancestor) => staged[ancestor.id] ?? null))
  );
  useEffect(() => {
    if (!ready) return undefined;
    const controller = new AbortController();
    for (const control of controls) {
      const ancestors = ancestry.get(control.id) ?? [];
      if (ancestors.length === 0 || control.type === 'range') continue;
      const key = JSON.stringify(ancestors.map((ancestor) => staged[ancestor.id] ?? null));
      if (asked.current.get(control.id) === key) continue;
      load(control, staged, undefined, controller.signal).then(
        (answer) => setStates((current) => ({ ...current, [control.id]: answer })),
        () => undefined
      );
    }
    return () => controller.abort();
  }, [nestedKey, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  // A list that searches as one types asks again with the text
  const searches = useRef(new Map<string, AbortController>());
  useEffect(() => () => searches.current.forEach((controller) => controller.abort()), []);
  const search = useCallback(
    async (control: ControlParam, query: string) => {
      searches.current.get(control.id)?.abort();
      const controller = new AbortController();
      searches.current.set(control.id, controller);
      try {
        const answer = await load(control, latest.current.staged, query, controller.signal);
        setStates((current) => ({ ...current, [control.id]: answer }));
      } catch {
        // asked again meanwhile
      }
    },
    [load]
  );

  const changed = controls.some((control) => !sameValue(control, staged[control.id], applied[control.id]));
  const hasValues = controls.some((control) => hasValue(control, staged[control.id]));
  const pinned = params.pinFilters ?? services.uiSettings.get('filters:pinnedByDefault', false);

  const submit = (values: ControlValues) => {
    onFiltersChange?.(
      submitFilters(controls, values, input.filters, Boolean(pinned), (control) =>
        fieldNamed(states[control.id]?.indexPattern, control.fieldName)
      )
    );
  };
  const stage = (id: string, value: ControlValue) => {
    const next = { ...latest.current.staged, [id]: value };
    setStaged(next);
    if (params.updateFiltersOnChange) submit(next);
  };

  return (
    <div className="visControls" data-test-subj="inputControlVis">
      {ready && (
        <div className="visControls__list">
          {controls.map((control, index) => (
            <div key={control.id} className="visControls__item" data-test-subj="inputControlItem">
              {control.type === 'range' ? (
                <RangeControl
                  control={control}
                  index={index}
                  state={states[control.id]}
                  value={staged[control.id] as RangeValue | undefined}
                  onChange={(next) => stage(control.id, next)}
                />
              ) : (
                <ListControl
                  control={control}
                  index={index}
                  state={states[control.id]}
                  value={Array.isArray(staged[control.id]) ? (staged[control.id] as ListValue) : []}
                  onChange={(next) => stage(control.id, next)}
                  onSearch={(query) => search(control, query)}
                />
              )}
            </div>
          ))}
        </div>
      )}
      {ready && controls.length > 0 && !params.updateFiltersOnChange && (
        <div className="visControls__actions">
          <Button disabled={!changed} onClick={() => submit(staged)} testId="inputControlSubmitBtn">
            Apply changes
          </Button>
          <Button variant="empty" disabled={!changed} onClick={() => setStaged(applied)} testId="inputControlCancelBtn">
            Cancel changes
          </Button>
          <Button variant="empty" disabled={!hasValues} onClick={() => setStaged({})} testId="inputControlClearBtn">
            Clear form
          </Button>
        </div>
      )}
    </div>
  );
}

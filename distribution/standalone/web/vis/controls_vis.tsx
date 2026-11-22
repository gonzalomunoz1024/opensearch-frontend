/* SPDX-License-Identifier: Apache-2.0 */

/*
 * Controls: lists and ranges on a dashboard that set filters. A choice becomes a filter marked
 * with the control's id (`meta.controlledBy`), which is how the control finds it again.
 */

import { useEffect, useMemo, useState } from 'react';
import { Button } from '../components/basic';
import { ComboBox } from '../components/combo_box';
import { NumberField } from '../components/form';
import { resolveTimeRange } from '../lib/dates';
import { phraseFilter, phrasesFilter, rangeFilter, timeRangeFilter } from '../lib/query';
import type { Filter, IndexPattern } from '../lib/types';
import type { Vis } from '../lib/vis';
import { fieldFormatter } from '../lib/field_formats';
import { services } from '../services';
import type { VisInput } from './request';

interface ControlParam {
  id: string;
  indexPattern?: string;
  fieldName?: string;
  parent?: string;
  label?: string;
  type: 'list' | 'range';
  options?: { multiselect?: boolean; dynamicOptions?: boolean; size?: number; order?: 'asc' | 'desc'; decimalPlaces?: number; step?: number };
}

interface ControlsParams {
  controls?: ControlParam[];
  updateFiltersOnChange?: boolean;
  useTimeFilter?: boolean;
  pinFilters?: boolean;
}

type ListValue = Array<string | number | boolean>;
type RangeValue = { min?: number; max?: number };
type Value = ListValue | RangeValue | undefined;

const isRange = (value: Value): value is RangeValue => Boolean(value) && !Array.isArray(value);
const isEmpty = (value: Value) =>
  value === undefined || (Array.isArray(value) ? value.length === 0 : value.min === undefined && value.max === undefined);
const same = (a: Value, b: Value) => JSON.stringify(isEmpty(a) ? null : a) === JSON.stringify(isEmpty(b) ? null : b);

/** What a control shows for the filters in force */
function appliedValue(control: ControlParam, filters: Filter[]): Value {
  const filter = filters.find((candidate) => candidate.meta?.controlledBy === control.id && !candidate.meta.disabled);
  if (!filter) return undefined;
  if (control.type === 'range') {
    const params = (filter.meta.params ?? filter.range?.[control.fieldName ?? ''] ?? {}) as Record<string, unknown>;
    return { min: typeof params.gte === 'number' ? params.gte : undefined, max: typeof params.lte === 'number' ? params.lte : undefined };
  }
  if (Array.isArray(filter.meta.params)) return filter.meta.params as ListValue;
  const query = (filter.meta.params as { query?: string | number | boolean } | undefined)?.query;
  return query === undefined ? undefined : [query];
}

function filterOf(control: ControlParam, value: Value, pinned: boolean): Filter | undefined {
  if (isEmpty(value) || !control.fieldName) return undefined;
  const field = { name: control.fieldName };
  let filter: Filter;
  if (isRange(value)) filter = rangeFilter(field, { gte: value.min, lte: value.max }, control.indexPattern);
  else if ((value as ListValue).length === 1) filter = phraseFilter(field, (value as ListValue)[0], control.indexPattern);
  else filter = phrasesFilter(field, value as ListValue, control.indexPattern);
  filter.meta.controlledBy = control.id;
  filter.$state = { store: pinned ? 'globalState' : 'appState' };
  return filter;
}

const escapeRegex = (text: string) => text.replace(/[.?+*|{}[\]()"\\#@&<>~]/g, '\\$&');

function useIndexPattern(id: string | undefined) {
  const [pattern, setPattern] = useState<IndexPattern>();
  useEffect(() => {
    let live = true;
    if (id) {
      services.indexPatterns
        .get(id)
        .then((loaded) => live && setPattern(loaded))
        .catch(() => live && setPattern(undefined));
    }
    return () => {
      live = false;
    };
  }, [id]);
  return pattern;
}

// What narrows a control's own choices: the time range, and the control it depends on
function scope(indexPattern: IndexPattern, input: VisInput, useTime: boolean, parent?: { control: ControlParam; value: Value }) {
  const filter: Array<Record<string, unknown>> = [];
  if (useTime && indexPattern.timeFieldName) {
    const clause = timeRangeFilter(indexPattern, resolveTimeRange(input.time, { weekStart: services.weekStart() }));
    if (clause) filter.push(clause);
  }
  if (parent && !isEmpty(parent.value) && parent.control.fieldName) {
    if (isRange(parent.value)) filter.push({ range: { [parent.control.fieldName]: { gte: parent.value.min, lte: parent.value.max } } });
    else filter.push({ terms: { [parent.control.fieldName]: parent.value } });
  }
  return { bool: { filter } };
}

function ListControl({
  control,
  value,
  onChange,
  input,
  useTime,
  parent,
  tick,
}: {
  control: ControlParam;
  value: ListValue;
  onChange: (value: ListValue) => void;
  input: VisInput;
  useTime: boolean;
  parent?: { control: ControlParam; value: Value };
  tick: number;
}) {
  const indexPattern = useIndexPattern(control.indexPattern);
  const [options, setOptions] = useState<Array<string | number | boolean>>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const waitingForParent = Boolean(parent) && isEmpty(parent?.value);
  const parentKey = JSON.stringify(parent?.value ?? null);
  const dynamic = Boolean(control.options?.dynamicOptions);
  const field = indexPattern?.fields.find((candidate) => candidate.name === control.fieldName);

  useEffect(() => {
    if (!indexPattern || !control.fieldName || waitingForParent) {
      setOptions([]);
      return undefined;
    }
    const controller = new AbortController();
    const terms: Record<string, unknown> = {
      field: control.fieldName,
      size: control.options?.size ?? 5,
      order: { _count: control.options?.order ?? 'desc' },
    };
    if (dynamic && search && field?.type === 'string') terms.include = `${escapeRegex(search)}.*`;
    setLoading(true);
    services.search
      .search(
        indexPattern.title,
        { size: 0, timeout: '1000ms', terminate_after: 100000, query: scope(indexPattern, input, useTime, parent), aggs: { termsAgg: { terms } } },
        { signal: controller.signal }
      )
      .then((response) => {
        const buckets = ((response.aggregations?.termsAgg as { buckets?: Array<{ key: string | number; key_as_string?: string }> })?.buckets ?? []).map(
          (bucket) => (field?.type === 'boolean' ? bucket.key === 1 || bucket.key_as_string === 'true' : bucket.key)
        );
        setOptions(buckets);
        setLoading(false);
      })
      .catch((failure) => {
        if ((failure as Error).name !== 'AbortError') setLoading(false);
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indexPattern, control.fieldName, control.options?.size, control.options?.order, search, dynamic, waitingForParent, parentKey, useTime, input.time.from, input.time.to, tick]);

  const format = useMemo(
    () => (indexPattern && control.fieldName ? fieldFormatter(indexPattern, control.fieldName, services.formatSettings()) : undefined),
    [indexPattern, control.fieldName]
  );
  const raw = new Map<string, string | number | boolean>();
  for (const item of [...options, ...value]) raw.set(String(item), item);
  const comboOptions = [...raw.entries()].map(([text, item]) => ({ value: text, label: format ? format(item).text : text }));

  return (
    <ComboBox
      options={comboOptions}
      selected={value.map(String)}
      onChange={(next) => onChange(next.map((text) => raw.get(text) ?? text))}
      single={control.options?.multiselect === false}
      placeholder={waitingForParent ? 'Select the control above first' : 'Select...'}
      disabled={waitingForParent || !indexPattern}
      loading={loading}
      onSearch={dynamic ? setSearch : undefined}
      fullWidth
      testId={`listControlSelect${control.id}`}
    />
  );
}

function RangeControl({
  control,
  value,
  onChange,
  input,
  useTime,
  tick,
}: {
  control: ControlParam;
  value: RangeValue;
  onChange: (value: RangeValue) => void;
  input: VisInput;
  useTime: boolean;
  tick: number;
}) {
  const indexPattern = useIndexPattern(control.indexPattern);
  const [bounds, setBounds] = useState<{ min: number; max: number }>();

  useEffect(() => {
    if (!indexPattern || !control.fieldName) return undefined;
    const controller = new AbortController();
    services.search
      .search(
        indexPattern.title,
        {
          size: 0,
          query: scope(indexPattern, input, useTime),
          aggs: { maxAgg: { max: { field: control.fieldName } }, minAgg: { min: { field: control.fieldName } } },
        },
        { signal: controller.signal }
      )
      .then((response) => {
        const found = (response.aggregations ?? {}) as Record<string, { value: number | null }>;
        const min = found.minAgg?.value;
        const max = found.maxAgg?.value;
        setBounds(typeof min === 'number' && typeof max === 'number' ? { min, max } : undefined);
      })
      .catch(() => undefined);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indexPattern, control.fieldName, useTime, input.time.from, input.time.to, tick]);

  const step = control.options?.step ?? 1;
  const places = control.options?.decimalPlaces ?? 0;
  const round = (number: number) => Number(number.toFixed(places));
  const low = bounds ? round(bounds.min) : 0;
  const high = bounds ? round(bounds.max) : 0;
  const disabled = !bounds;
  const from = value.min ?? low;
  const to = value.max ?? high;
  const share = (number: number) => (high === low ? 0 : ((Math.max(low, Math.min(high, number)) - low) / (high - low)) * 100);

  return (
    <div className="visControls__range" data-test-subj={`rangeControl${control.id}`}>
      <NumberField
        compact
        value={value.min ?? ''}
        min={low}
        max={high}
        step={step}
        disabled={disabled}
        onChange={(min) => onChange({ ...value, min })}
        aria-label={`${control.label || control.fieldName} minimum`}
      />
      <div className="visControls__dual">
        <div className="visControls__track">
          <span style={{ left: `${share(from)}%`, right: `${100 - share(to)}%` }} />
        </div>
        <input
          type="range"
          min={low}
          max={high}
          step={step}
          value={from}
          disabled={disabled}
          aria-label={`${control.label || control.fieldName} minimum`}
          onChange={(event) => onChange({ min: Math.min(Number(event.target.value), to), max: to })}
        />
        <input
          type="range"
          min={low}
          max={high}
          step={step}
          value={to}
          disabled={disabled}
          aria-label={`${control.label || control.fieldName} maximum`}
          onChange={(event) => onChange({ min: from, max: Math.max(Number(event.target.value), from) })}
        />
        <div className="visControls__ends">
          <span>{bounds ? low : ''}</span>
          <span>{bounds ? high : ''}</span>
        </div>
      </div>
      <NumberField
        compact
        value={value.max ?? ''}
        min={low}
        max={high}
        step={step}
        disabled={disabled}
        onChange={(max) => onChange({ ...value, max })}
        aria-label={`${control.label || control.fieldName} maximum`}
      />
    </div>
  );
}

export function ControlsVis({
  vis,
  input,
  onFiltersChange,
  tick = 0,
}: {
  vis: Vis;
  input: VisInput;
  /** Called with every filter of the page, the controls' own replaced */
  onFiltersChange?: (filters: Filter[]) => void;
  tick?: number;
}) {
  const params = vis.params as ControlsParams;
  const controls = useMemo(() => (params.controls ?? []).filter((control) => control.fieldName && control.indexPattern), [params.controls]);
  const applied = useMemo(() => {
    const values: Record<string, Value> = {};
    for (const control of controls) values[control.id] = appliedValue(control, input.filters);
    return values;
  }, [controls, input.filters]);
  const appliedKey = JSON.stringify(applied);
  const [staged, setStaged] = useState<Record<string, Value>>(applied);
  useEffect(() => setStaged(applied), [appliedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const changed = controls.some((control) => !same(staged[control.id], applied[control.id]));
  const hasValues = controls.some((control) => !isEmpty(staged[control.id]) || !isEmpty(applied[control.id]));

  const apply = (values: Record<string, Value>) => {
    if (!onFiltersChange) return;
    const ids = new Set(controls.map((control) => control.id));
    const others = input.filters.filter((filter) => !filter.meta?.controlledBy || !ids.has(filter.meta.controlledBy));
    const own = controls
      .map((control) => filterOf(control, values[control.id], Boolean(params.pinFilters)))
      .filter((filter): filter is Filter => Boolean(filter));
    onFiltersChange([...others, ...own]);
  };
  const stage = (id: string, value: Value) => {
    const next = { ...staged, [id]: value };
    // A control that depends on the changed one starts over
    for (const control of controls) if (control.parent === id) next[control.id] = undefined;
    setStaged(next);
    if (params.updateFiltersOnChange) apply(next);
  };

  if (controls.length === 0) {
    return <div className="chtMessage">No controls have been set up for this visualization.</div>;
  }

  return (
    <div className="visControls" data-test-subj="inputControlVis">
      <div className="visControls__list">
        {controls.map((control) => {
          const parentControl = control.parent ? controls.find((candidate) => candidate.id === control.parent) : undefined;
          const parent = parentControl ? { control: parentControl, value: staged[parentControl.id] } : undefined;
          const value = staged[control.id];
          return (
            <label key={control.id} className="visControls__control" data-test-subj="inputControlItem">
              <span className="visControls__label">{control.label || control.fieldName}</span>
              {control.type === 'range' ? (
                <RangeControl
                  control={control}
                  value={isRange(value) ? value : {}}
                  onChange={(next) => stage(control.id, next)}
                  input={input}
                  useTime={Boolean(params.useTimeFilter)}
                  tick={tick}
                />
              ) : (
                <ListControl
                  control={control}
                  value={Array.isArray(value) ? value : []}
                  onChange={(next) => stage(control.id, next)}
                  input={input}
                  useTime={Boolean(params.useTimeFilter)}
                  parent={parent}
                  tick={tick}
                />
              )}
            </label>
          );
        })}
      </div>
      {!params.updateFiltersOnChange && (
        <div className="visControls__actions">
          <Button variant="tint" disabled={!changed || !onFiltersChange} onClick={() => apply(staged)} testId="inputControlSubmitBtn">
            Apply changes
          </Button>
          <Button variant="empty" disabled={!changed} onClick={() => setStaged(applied)} testId="inputControlCancelBtn">
            Cancel changes
          </Button>
          <Button
            variant="empty"
            disabled={!hasValues}
            onClick={() => {
              setStaged({});
              apply({});
            }}
            testId="inputControlClearBtn"
          >
            Clear form
          </Button>
        </div>
      )}
    </div>
  );
}

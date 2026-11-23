/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The editor of a filter, in the popover of "Add filter" and behind a pill's "Edit filter": a
 * field, an operator and a value, or the filter written as Query DSL, and a label of its own. It is
 * the filter editor of OpenSearch Dashboards (its data plugin's filter_bar/filter_editor): the same
 * operators for the same kinds of field, the same inputs for their values, the same checks before
 * it can be saved, and the filter it saves built the same way.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, cx } from '../components/basic';
import { CodeEditor } from '../components/code_editor';
import { ComboBox } from '../components/combo_box';
import { FormRow, Switch, TextField } from '../components/form';
import { Tooltip } from '../components/overlay';
import { formatDate, parseDateMath } from '../lib/dates';
import { tokenizeJson } from '../lib/json_text';
import {
  cidrRange,
  existsFilter,
  getFilterParams,
  ipv4Value,
  phraseFilter,
  phrasesFilter,
  rangeFilter,
  withMappedMeta,
} from '../lib/query';
import type { Field, Filter, IndexPattern } from '../lib/types';
import { services } from '../services';

export type OperatorType = 'phrase' | 'phrases' | 'range' | 'exists';

export interface Operator {
  message: string;
  type: OperatorType;
  negate: boolean;
  /** The kinds of field it is offered for; all when left out */
  fieldTypes?: string[];
}

const ONE_OF_TYPES = ['string', 'number', 'date', 'ip', 'geo_point', 'geo_shape'];
const BETWEEN_TYPES = ['number', 'date', 'ip'];

/** The operators, in the order the original lists them (filter_operators.ts) */
export const FILTER_OPERATORS: Operator[] = [
  { message: 'is', type: 'phrase', negate: false },
  { message: 'is not', type: 'phrase', negate: true },
  { message: 'is one of', type: 'phrases', negate: false, fieldTypes: ONE_OF_TYPES },
  { message: 'is not one of', type: 'phrases', negate: true, fieldTypes: ONE_OF_TYPES },
  { message: 'is between', type: 'range', negate: false, fieldTypes: BETWEEN_TYPES },
  { message: 'is not between', type: 'range', negate: true, fieldTypes: BETWEEN_TYPES },
  { message: 'exists', type: 'exists', negate: false },
  { message: 'does not exist', type: 'exists', negate: true },
];

const FILTERABLE_TYPES = ['string', 'number', 'date', 'ip', 'boolean', 'histogram'];

/** Whether a filter can be made on a field: `_id`, a scripted field, or one searched of a kind that can */
export const isFilterable = (field: Field) =>
  field.name === '_id' || Boolean(field.scripted) || Boolean(field.searchable && FILTERABLE_TYPES.includes(field.type));

export const getFilterableFields = (indexPattern: IndexPattern) => indexPattern.fields.filter(isFilterable);

export const getOperatorOptions = (field: Field) =>
  FILTER_OPERATORS.filter((operator) => !operator.fieldTypes || operator.fieldTypes.includes(field.type));

export const getOperatorFromFilter = (filter: Filter) =>
  FILTER_OPERATORS.find((operator) => filter.meta.type === operator.type && filter.meta.negate === operator.negate);

/** Whether a value can be one of a field of a kind: a date or an expression of one, an IPv4 address or mask */
export function validateParams(params: unknown, type: string): boolean {
  switch (type) {
    case 'date':
      return typeof params === 'string' && parseDateMath(params) !== undefined;
    case 'ip':
      if (typeof params !== 'string') return false;
      return params.includes('/') ? cidrRange(params) !== undefined : ipv4Value(params) !== undefined;
    default:
      return true;
  }
}

/** Whether what the editor holds makes a filter: Save can be pressed */
export function isFilterValid(
  indexPattern: IndexPattern | undefined,
  field: Field | undefined,
  operator: Operator | undefined,
  params: unknown
): boolean {
  if (!indexPattern || !field || !operator) return false;
  switch (operator.type) {
    case 'phrase':
      return validateParams(params, field.type);
    case 'phrases':
      return Array.isArray(params) && params.length > 0 && params.every((phrase) => validateParams(phrase, field.type));
    case 'range': {
      if (typeof params !== 'object' || params === null) return false;
      const { from, to } = params as { from?: unknown; to?: unknown };
      return (!from || validateParams(from, field.type)) && (!to || validateParams(to, field.type));
    }
    default:
      return true;
  }
}

/**
 * The filter the editor saves, as the original's buildFilter: the operator says what it is and
 * whether it excludes, the range of "is between" runs from its start to before its end.
 */
export function buildEditedFilter(
  indexPattern: IndexPattern,
  field: Field,
  operator: Operator,
  params: unknown,
  meta: { disabled: boolean; alias: string | null; pinned: boolean }
): Filter {
  let filter: Filter;
  switch (operator.type) {
    case 'phrase':
      filter = phraseFilter(field, params, indexPattern.id);
      break;
    case 'phrases':
      filter = phrasesFilter(field, Array.isArray(params) ? params : [], indexPattern.id);
      break;
    case 'range': {
      const range = (params ?? {}) as { from?: unknown; to?: unknown };
      filter = rangeFilter(field, { gte: range.from, lt: range.to }, indexPattern.id);
      break;
    }
    default:
      filter = existsFilter(field, indexPattern.id);
  }
  filter.meta.negate = operator.negate;
  filter.meta.disabled = meta.disabled;
  filter.meta.alias = meta.alias;
  filter.$state = { store: meta.pinned ? 'globalState' : 'appState' };
  return filter;
}

/** A filter written as Query DSL, as the original's buildCustomFilter: the DSL is the filter */
export function buildCustomFilter(
  index: string | undefined,
  dsl: Record<string, unknown>,
  meta: { disabled: boolean; negate: boolean; alias: string | null; pinned: boolean }
): Filter {
  return {
    ...dsl,
    meta: { index, type: 'custom', disabled: meta.disabled, negate: meta.negate, alias: meta.alias },
    $state: { store: meta.pinned ? 'globalState' : 'appState' },
  };
}

// --- The values a field's text starts with ------------------------------------------------------

const suggestions = new Map<string, Promise<unknown[]>>();

/**
 * The values of a field that start with a text, as the original's value suggestions ask the
 * server for them: only for text fields that can be aggregated on, while the setting
 * filterEditor:suggestValues is on. An answer is kept for the minute it was asked in.
 */
export function valueSuggestions(indexPattern: IndexPattern, field: Field, query: string, signal?: AbortSignal): Promise<unknown[]> {
  if (field.type === 'boolean') return Promise.resolve([true, false]);
  if (!services.uiSettings.get('filterEditor:suggestValues', true) || !field.aggregatable || field.type !== 'string') {
    return Promise.resolve([]);
  }
  const key = [Math.floor(Date.now() / 1000 / 60), query, indexPattern.title, field.name, '[]'].join('|');
  let answer = suggestions.get(key);
  if (!answer) {
    answer = services.http.post<unknown[]>(`/api/opensearch-dashboards/suggestions/values/${indexPattern.title}`, {
      body: { query, field: field.name, boolFilter: [] },
      signal,
    });
    suggestions.set(key, answer);
    // A request that failed or was given up is asked again next time
    answer.catch(() => suggestions.delete(key));
  }
  return answer;
}

const isSuggestingValues = (field: Field | undefined) =>
  Boolean(services.uiSettings.get('filterEditor:suggestValues', true) && field?.aggregatable && field.type === 'string');

/** The values offered for a field, asked again half a second after the text last changed */
function useSuggestions(indexPattern: IndexPattern, field: Field | undefined) {
  const [values, setValues] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  useEffect(() => {
    if (!field || !isSuggestingValues(field)) return undefined;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      valueSuggestions(indexPattern, field, query, controller.signal).then(
        (answer) => {
          if (!controller.signal.aborted) setValues(answer.map(String));
        },
        () => undefined
      );
    }, 500);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [field, indexPattern, query]);
  return { values, search: setQuery };
}

const unique = (values: string[]) => [...new Set(values)];

// --- The inputs of a value ------------------------------------------------------------------------

/**
 * A date typed as a date is written in full in the zone of the settings once it is left, as the
 * original writes it with moment; what is no date, such as `now-1d`, is left as it is.
 */
export function formatDateChange(value: string, timeZone = services.formatSettings().timeZone): string {
  if (value.trim() === '') return value;
  // A year, a month or a day alone starts at midnight where the browser is, as moment reads it
  const day = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(value.trim());
  const date = day
    ? new Date(Number(day[1]), Number(day[2] ?? 1) - 1, Number(day[3] ?? 1))
    : /^\s*now/.test(value)
      ? undefined
      : new Date(value);
  if (!date || Number.isNaN(date.getTime())) return value;
  return formatDate(date, 'YYYY-MM-DDTHH:mm:ss.SSSZ', timeZone);
}

const numberText = (value: unknown) => (typeof value === 'number' && !Number.isNaN(value) ? String(value) : typeof value === 'string' ? value : '');

/** The input of one value, by the kind of the field (ValueInputType) */
function ValueInput({
  type,
  value,
  onChange,
  onBlur,
  placeholder,
  controlOnly,
}: {
  type: string;
  value: unknown;
  onChange: (value: unknown) => void;
  onBlur?: (value: string) => void;
  placeholder: string;
  controlOnly?: boolean;
}) {
  const className = controlOnly ? 'shlFilterRange__input' : 'shlFilterEditor__input';
  switch (type) {
    case 'number':
      return (
        <input
          type="number"
          className={cx(!controlOnly && 'atlField', className)}
          placeholder={placeholder}
          value={numberText(typeof value === 'string' ? parseFloat(value) : value)}
          onChange={(event) => onChange(parseFloat(event.target.value))}
        />
      );
    case 'date':
    case 'ip': {
      const text = value === undefined || value === null ? '' : String(value);
      const invalid = text !== '' && !validateParams(value, type);
      return (
        <input
          type="text"
          className={cx(!controlOnly && 'atlField', className, invalid && (controlOnly ? 'shlFilterRange__input--invalid' : 'atlField--invalid'))}
          placeholder={placeholder}
          value={text}
          onChange={(event) => onChange(event.target.value)}
          onBlur={type === 'date' && onBlur ? (event) => onBlur(event.target.value) : undefined}
        />
      );
    }
    case 'boolean':
      return (
        <select
          className={cx('atlField', className)}
          value={value === undefined || value === null ? '' : String(value)}
          onChange={(event) => onChange(event.target.value === 'true')}
        >
          <option value="">{placeholder}</option>
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      );
    case 'string':
      return (
        <input
          type="text"
          className={cx(!controlOnly && 'atlField', className)}
          placeholder={placeholder}
          value={value === undefined || value === null ? '' : String(value)}
          onChange={(event) => onChange(event.target.value)}
        />
      );
    default:
      return null;
  }
}

function PhraseValueInput({
  indexPattern,
  field,
  value,
  onChange,
}: {
  indexPattern: IndexPattern;
  field: Field;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const { values, search } = useSuggestions(indexPattern, field);
  const text = String(value);
  return (
    <FormRow label="Value" full>
      {isSuggestingValues(field) ? (
        <ComboBox
          single
          clearable={false}
          placeholder="Select a value"
          options={(value ? unique([text, ...values]) : values).map((option) => ({ value: option, label: option }))}
          selected={value ? [text] : []}
          onChange={([next = '']) => onChange(next)}
          onSearch={search}
          onCreateOption={onChange}
          sortMatchesBy="startsWith"
          testId="filterParamsComboBox phraseParamsComboxBox"
        />
      ) : (
        <ValueInput type={field.type} value={value} onChange={onChange} placeholder="Enter a value" />
      )}
    </FormRow>
  );
}

function PhrasesValuesInput({
  indexPattern,
  field,
  values,
  onChange,
}: {
  indexPattern: IndexPattern;
  field: Field;
  values: unknown;
  onChange: (values: string[]) => void;
}) {
  const { values: offered, search } = useSuggestions(indexPattern, field);
  const chosen = Array.isArray(values) ? values.map(String) : [];
  return (
    <FormRow label="Values" full>
      <ComboBox
        clearable={false}
        placeholder="Select values"
        options={unique([...chosen, ...offered]).map((option) => ({ value: option, label: option }))}
        selected={chosen}
        onChange={onChange}
        onSearch={search}
        onCreateOption={(option) => onChange([...chosen, option])}
        onPasteValues={(pasted) => onChange([...chosen, ...pasted])}
        delimiter=","
        sortMatchesBy="startsWith"
        testId="filterParamsComboBox phrasesParamsComboxBox"
      />
    </FormRow>
  );
}

function RangeValueInput({ field, value, onChange }: { field: Field; value: unknown; onChange: (value: unknown) => void }) {
  const range = (value ?? undefined) as { from?: unknown; to?: unknown } | undefined;
  const from = (next: unknown) => onChange({ from: next, to: range?.to });
  const to = (next: unknown) => onChange({ from: range?.from, to: next });
  return (
    <div>
      <div className="shlFilterRange" aria-label="Range">
        <ValueInput
          controlOnly
          type={field.type}
          value={range?.from}
          onChange={from}
          onBlur={(text) => from(formatDateChange(text))}
          placeholder="Start of the range"
        />
        <div className="shlFilterRange__delimiter">→</div>
        <ValueInput
          controlOnly
          type={field.type}
          value={range?.to}
          onChange={to}
          onBlur={(text) => to(formatDateChange(text))}
          placeholder="End of the range"
        />
      </div>
    </div>
  );
}

// --- The editor -----------------------------------------------------------------------------------

export interface FilterEditorProps {
  filter: Filter;
  indexPatterns: IndexPattern[];
  onSubmit: (filter: Filter) => void;
  onCancel: () => void;
}

const KNOWN_TYPES = ['phrase', 'phrases', 'range', 'exists'];

// The clause of a filter, without what is about the filter itself (cleanFilter)
function clauseOf(filter: Filter): Record<string, unknown> {
  const { meta: _meta, $state: _state, ...clause } = filter;
  return clause;
}

export function FilterEditor({ filter: given, indexPatterns, onSubmit, onCancel }: FilterEditorProps) {
  // A filter is read as the original's filter manager keeps it; a new one has nothing to read
  const filter = useMemo(() => (Object.keys(clauseOf(given)).length > 0 ? withMappedMeta(given) : given), [given]);
  const loadedPattern = indexPatterns.find((pattern) => pattern.id === filter.meta.index);
  const [indexPattern, setIndexPattern] = useState<IndexPattern | undefined>(loadedPattern);
  const [field, setField] = useState<Field | undefined>(() => loadedPattern?.fields.find((item) => item.name === filter.meta.key));
  const [operator, setOperator] = useState<Operator | undefined>(() => getOperatorFromFilter(filter));
  const [params, setParams] = useState<unknown>(() => getFilterParams(filter));
  const [useCustomLabel, setUseCustomLabel] = useState(filter.meta.alias !== null && filter.meta.alias !== undefined);
  const [customLabel, setCustomLabel] = useState<string | null>(filter.meta.alias ?? null);
  const [queryDsl, setQueryDsl] = useState(() => JSON.stringify(clauseOf(filter), null, 2));
  const [isCustomEditorOpen, setCustomEditorOpen] = useState(
    Boolean(filter.meta.type) && !KNOWN_TYPES.includes(String(filter.meta.type))
  );
  const form = useRef<HTMLDivElement>(null);

  const fields = useMemo(() => (indexPattern ? getFilterableFields(indexPattern) : []), [indexPattern]);
  const operators = field ? getOperatorOptions(field) : [];

  let dsl: Record<string, unknown> | undefined;
  if (isCustomEditorOpen) {
    try {
      const parsed = JSON.parse(queryDsl) as unknown;
      if (parsed) dsl = parsed as Record<string, unknown>;
    } catch {
      dsl = undefined;
    }
  }
  const valid = isCustomEditorOpen ? Boolean(dsl) : isFilterValid(indexPattern, field, operator, params);

  const submit = () => {
    const pinned = filter.$state?.store === 'globalState';
    const alias = useCustomLabel ? customLabel : null;
    const disabled = Boolean(filter.meta.disabled);
    if (isCustomEditorOpen) {
      if (!dsl) return;
      const index = filter.meta.index || indexPatterns[0]?.id;
      onSubmit(buildCustomFilter(index, dsl, { disabled, negate: Boolean(filter.meta.negate), alias, pinned }));
    } else if (indexPattern && field && operator) {
      onSubmit(buildEditedFilter(indexPattern, field, operator, params ?? '', { disabled, alias, pinned }));
    }
  };

  const showIndexPatterns = !(indexPatterns.length <= 1 && loadedPattern !== undefined);

  let paramsEditor = null;
  if (indexPattern && operator && field) {
    if (operator.type === 'phrase') {
      paramsEditor = <PhraseValueInput indexPattern={indexPattern} field={field} value={params} onChange={setParams} />;
    } else if (operator.type === 'phrases') {
      paramsEditor = <PhrasesValuesInput indexPattern={indexPattern} field={field} values={params} onChange={setParams} />;
    } else if (operator.type === 'range') {
      paramsEditor = <RangeValueInput field={field} value={params} onChange={setParams} />;
    }
  }

  const dslButton = (
    <button
      type="button"
      className="shlFilterEditor__dslButton"
      data-test-subj="editQueryDSL"
      onClick={() => setCustomEditorOpen(!isCustomEditorOpen)}
    >
      {isCustomEditorOpen ? 'Edit filter values' : 'Edit as Query DSL'}
    </button>
  );

  return (
    <div className="shlFilterEditor">
      <div className="shlFilterEditor__title">
        <span className="atlGrow">Edit filter</span>
        {isCustomEditorOpen ? (
          dslButton
        ) : (
          <Tooltip content="Raw DSL input only applies to DSL-based visualizations" delay="regular">
            {dslButton}
          </Tooltip>
        )}
      </div>
      <div ref={form} className="shlFilterEditor__form" data-test-subj="globalFilterItemEditor">
        {showIndexPatterns && (
          <FormRow label="Index Pattern">
            <ComboBox
              single
              clearable={false}
              placeholder="Select an index pattern"
              options={indexPatterns.map((pattern) => ({ value: pattern.id, label: pattern.displayName || pattern.title }))}
              selected={indexPattern ? [indexPattern.id] : []}
              onChange={([id]) => {
                setIndexPattern(indexPatterns.find((pattern) => pattern.id === id));
                setField(undefined);
                setOperator(undefined);
                setParams(undefined);
              }}
              sortMatchesBy="startsWith"
              testId="filterIndexPatternsSelect"
            />
          </FormRow>
        )}
        {isCustomEditorOpen ? (
          <FormRow label="OpenSearch Query DSL" full>
            <CodeEditor
              value={queryDsl}
              onChange={setQueryDsl}
              height="250px"
              tokenize={tokenizeJson}
              ariaLabel="OpenSearch Query DSL"
              testId="codeEditorContainer"
            />
          </FormRow>
        ) : (
          <div>
            <div className="shlFilterEditor__fieldRow">
              <div className="shlFilterEditor__field">
                <FormRow label="Field">
                  <ComboBox
                    single
                    clearable={false}
                    id="fieldInput"
                    autoFocus
                    disabled={!indexPattern}
                    placeholder="Select a field first"
                    options={fields.map((item) => ({ value: item.name, label: item.name }))}
                    selected={field ? [field.name] : []}
                    onChange={([name]) => {
                      setField(indexPattern?.fields.find((item) => item.name === name));
                      setOperator(undefined);
                      setParams(undefined);
                    }}
                    sortMatchesBy="startsWith"
                    testId="filterFieldSuggestionList"
                  />
                </FormRow>
              </div>
              <div className="shlFilterEditor__operator">
                <FormRow label="Operator" full>
                  <ComboBox
                    single
                    clearable={false}
                    disabled={!field}
                    placeholder={field ? 'Select' : 'Waiting'}
                    options={operators.map((item) => ({ value: item.message, label: item.message }))}
                    selected={operator ? [operator.message] : []}
                    onChange={([message]) => {
                      const next = operators.find((item) => item.message === message);
                      // The value is kept while the kind of filter stays
                      if (operator?.type !== next?.type) setParams(undefined);
                      setOperator(next);
                    }}
                    sortMatchesBy="startsWith"
                    testId="filterOperatorList"
                  />
                </FormRow>
              </div>
            </div>
            <div className="shlFilterEditor__spacerS" />
            <div data-test-subj="filterParams">{paramsEditor}</div>
          </div>
        )}
        <div className="shlFilterEditor__spacerM" />
        <span className="shlFilterEditor__switch">
          <Switch
            checked={useCustomLabel}
            onChange={(checked) => {
              setUseCustomLabel(checked);
              setCustomLabel(checked ? '' : null);
            }}
            label="Create custom label?"
            testId="createCustomLabel"
          />
        </span>
        {useCustomLabel && (
          <div>
            <div className="shlFilterEditor__spacerM" />
            <FormRow label="Custom label" full>
              <TextField className="shlFilterEditor__input" value={`${customLabel}`} onChange={setCustomLabel} />
            </FormRow>
          </div>
        )}
        <div className="shlFilterEditor__spacerM" />
        <div className="shlFilterEditor__buttons">
          <button type="button" className="shlFilterEditor__cancel" onClick={onCancel} data-test-subj="cancelSaveFilter">
            Cancel
          </button>
          <Button variant="primary" className="shlFilterEditor__save" disabled={!valid} onClick={submit} testId="saveFilter">
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}

/* SPDX-License-Identifier: Apache-2.0 */

/* The filters under the query: each a pill that can be pinned, inverted, switched off or edited. */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, FieldToken, IconButton, cx } from '../components/basic';
import { ComboBox } from '../components/combo_box';
import { FormRow, Select, TextArea, TextField } from '../components/form';
import { Icon } from '../components/icon';
import { Menu, Popover, type MenuItem } from '../components/overlay';
import { fieldFormatter } from '../lib/field_formats';
import {
  customFilter,
  describeFilter,
  existsFilter,
  phraseFilter,
  phrasesFilter,
  rangeFilter,
} from '../lib/query';
import type { Field, Filter, IndexPattern } from '../lib/types';
import { services } from '../services';
import { fetchFieldValues } from './query_bar';

export const isPinned = (filter: Filter) => filter.$state?.store === 'globalState';

/** Filters by where they are kept: with the page, or pinned across pages */
export function splitFilters(filters: Filter[]) {
  return {
    pinned: filters.filter(isPinned),
    app: filters.filter((filter) => !isPinned(filter)),
  };
}

const withStore = (filter: Filter, pinned: boolean): Filter => ({
  ...filter,
  $state: { store: pinned ? 'globalState' : 'appState' },
});

interface Operator {
  id: string;
  label: string;
  type: 'phrase' | 'phrases' | 'range' | 'exists';
  negate: boolean;
  /** The kinds of field it applies to; all when left out */
  fieldTypes?: string[];
}

const OPERATORS: Operator[] = [
  { id: 'is', label: 'is', type: 'phrase', negate: false },
  { id: 'is_not', label: 'is not', type: 'phrase', negate: true },
  { id: 'is_one_of', label: 'is one of', type: 'phrases', negate: false },
  { id: 'is_not_one_of', label: 'is not one of', type: 'phrases', negate: true },
  { id: 'is_between', label: 'is between', type: 'range', negate: false, fieldTypes: ['number', 'date', 'ip'] },
  { id: 'is_not_between', label: 'is not between', type: 'range', negate: true, fieldTypes: ['number', 'date', 'ip'] },
  { id: 'exists', label: 'exists', type: 'exists', negate: false },
  { id: 'does_not_exist', label: 'does not exist', type: 'exists', negate: true },
];

interface Draft {
  indexId: string;
  fieldName: string;
  operator: string;
  value: string;
  values: string[];
  from: string;
  to: string;
  alias: string;
  useDsl: boolean;
  dsl: string;
}

function clauseOf(filter: Filter): Record<string, unknown> {
  const { meta: _meta, $state: _state, ...clause } = filter;
  return clause;
}

function draftOf(filter: Filter | undefined, indexId: string): Draft {
  const base: Draft = {
    indexId: filter?.meta.index ?? indexId,
    fieldName: '',
    operator: 'is',
    value: '',
    values: [],
    from: '',
    to: '',
    alias: filter?.meta.alias ?? '',
    useDsl: false,
    dsl: JSON.stringify(filter ? clauseOf(filter) : { query: { match_all: {} } }, null, 2),
  };
  if (!filter) return base;
  const { meta } = filter;
  const negate = Boolean(meta.negate);
  const operator = OPERATORS.find((item) => item.type === meta.type && item.negate === negate);
  if (!operator || !meta.key) return { ...base, useDsl: true };
  const draft = { ...base, fieldName: meta.key, operator: operator.id };
  if (meta.type === 'phrase') {
    const params = meta.params as { query?: unknown } | undefined;
    const fromQuery = (filter.query?.match_phrase as Record<string, unknown> | undefined)?.[meta.key];
    const raw =
      params?.query ??
      (fromQuery && typeof fromQuery === 'object' ? (fromQuery as { query?: unknown }).query : fromQuery);
    draft.value = raw === undefined ? '' : String(raw);
  } else if (meta.type === 'phrases') {
    draft.values = Array.isArray(meta.params) ? meta.params.map(String) : [];
  } else if (meta.type === 'range') {
    const params = (meta.params ?? filter.range?.[meta.key] ?? {}) as Record<string, unknown>;
    draft.from = String(params.gte ?? params.gt ?? '');
    draft.to = String(params.lt ?? params.lte ?? '');
  }
  return draft;
}

function coerce(field: Field, value: string): unknown {
  if (field.type === 'number' && value.trim() !== '' && !Number.isNaN(Number(value))) return Number(value);
  if (field.type === 'boolean') return value === 'true';
  return value;
}

function FilterEditor({
  filter,
  indexPatterns,
  onSave,
  onCancel,
}: {
  filter?: Filter;
  indexPatterns: IndexPattern[];
  onSave: (filter: Filter) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(filter, indexPatterns[0]?.id ?? ''));
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [typed, setTyped] = useState('');
  const patch = (changes: Partial<Draft>) => setDraft((current) => ({ ...current, ...changes }));

  const indexPattern = indexPatterns.find((pattern) => pattern.id === draft.indexId) ?? indexPatterns[0];
  const fields = useMemo(
    () =>
      (indexPattern?.fields ?? [])
        .filter((field) => !field.scripted && field.type !== '_source' && field.searchable !== false)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [indexPattern]
  );
  const field = fields.find((candidate) => candidate.name === draft.fieldName);
  const operators = OPERATORS.filter((item) => !item.fieldTypes || (field && item.fieldTypes.includes(field.type)));
  const operator = operators.find((item) => item.id === draft.operator) ?? operators[0];

  useEffect(() => {
    if (!field || !indexPattern || !operator || (operator.type !== 'phrase' && operator.type !== 'phrases')) {
      setSuggestions([]);
      return undefined;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void fetchFieldValues(indexPattern, field, typed, controller.signal).then((values) => {
        if (!controller.signal.aborted) setSuggestions(values.map(String));
      });
    }, 150);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [field, indexPattern, operator, typed]);

  let dslError: string | undefined;
  let dsl: Record<string, unknown> | undefined;
  if (draft.useDsl) {
    try {
      const parsed = JSON.parse(draft.dsl) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) dsl = parsed as Record<string, unknown>;
      else dslError = 'A filter is a JSON object';
    } catch (error) {
      dslError = (error as Error).message;
    }
  }

  const valid = draft.useDsl
    ? Boolean(dsl)
    : Boolean(
        field &&
          operator &&
          (operator.type === 'exists' ||
            (operator.type === 'phrase' && draft.value !== '') ||
            (operator.type === 'phrases' && draft.values.length > 0) ||
            (operator.type === 'range' && (draft.from !== '' || draft.to !== '')))
      );

  const build = (): Filter | undefined => {
    const pinned = filter ? isPinned(filter) : services.uiSettings.get('filters:pinnedByDefault', false);
    let built: Filter | undefined;
    if (draft.useDsl) {
      if (!dsl) return undefined;
      // A filter written by hand is the clause itself: `{ "query": ... }`, `{ "range": ... }`
      const keys = Object.keys(dsl);
      built =
        keys.length === 1 && keys[0] === 'query'
          ? customFilter(dsl.query as Record<string, unknown>, indexPattern?.id)
          : { ...customFilter({}, indexPattern?.id), query: undefined, ...dsl };
      if (built.query === undefined) delete built.query;
      built.meta.value = JSON.stringify(dsl);
    } else if (field && operator) {
      if (operator.type === 'phrase') built = phraseFilter(field, coerce(field, draft.value), indexPattern?.id);
      else if (operator.type === 'phrases') {
        built = phrasesFilter(
          field,
          draft.values.map((value) => coerce(field, value)),
          indexPattern?.id
        );
      } else if (operator.type === 'range') {
        built = rangeFilter(
          field,
          {
            gte: draft.from === '' ? undefined : coerce(field, draft.from),
            lt: draft.to === '' ? undefined : coerce(field, draft.to),
          },
          indexPattern?.id
        );
      } else built = existsFilter(field, indexPattern?.id);
      built.meta.negate = operator.negate;
    }
    if (!built) return undefined;
    built.meta.alias = draft.alias.trim() === '' ? null : draft.alias.trim();
    built.meta.disabled = filter?.meta.disabled ?? false;
    return withStore(built, pinned);
  };

  return (
    <form
      className="shlFilterEditor atlStack"
      onSubmit={(event) => {
        event.preventDefault();
        const built = build();
        if (built) onSave(built);
      }}
      data-test-subj="filterEditor"
    >
      <div className="atlRow atlRowBetween">
        <span className="atlTitleXxs">{filter ? 'Edit filter' : 'Add filter'}</span>
        <button
          type="button"
          className="atlLinkButton atlSmall"
          onClick={() => patch({ useDsl: !draft.useDsl })}
          data-test-subj="editQueryDSL"
        >
          {draft.useDsl ? 'Edit filter values' : 'Edit as Query DSL'}
        </button>
      </div>
      {indexPatterns.length > 1 && (
        <FormRow label="Index pattern" full>
          <Select
            value={indexPattern?.id ?? ''}
            onChange={(indexId) => patch({ indexId, fieldName: '' })}
            options={indexPatterns.map((pattern) => ({ value: pattern.id, label: pattern.displayName || pattern.title }))}
          />
        </FormRow>
      )}
      {draft.useDsl ? (
        <FormRow label="OpenSearch Query DSL" error={dslError} full>
          <TextArea code rows={10} value={draft.dsl} onChange={(next) => patch({ dsl: next })} invalid={Boolean(dslError)} />
        </FormRow>
      ) : (
        <>
          <div className="atlRow atlRowTop">
            <div className="atlGrow">
              <FormRow label="Field" full>
                <ComboBox
                  single
                  placeholder="Select a field first"
                  options={fields.map((item) => ({
                    value: item.name,
                    label: item.name,
                    prepend: <FieldToken type={item.type} />,
                  }))}
                  selected={draft.fieldName ? [draft.fieldName] : []}
                  onChange={([fieldName]) => patch({ fieldName: fieldName ?? '', value: '', values: [], from: '', to: '' })}
                  testId="filterFieldSuggestionList"
                />
              </FormRow>
            </div>
            <div style={{ width: 160 }}>
              <FormRow label="Operator" full>
                <Select
                  value={operator?.id ?? ''}
                  disabled={!field}
                  placeholder={field ? undefined : 'Waiting'}
                  onChange={(next) => patch({ operator: next })}
                  options={operators.map((item) => ({ value: item.id, label: item.label }))}
                  testId="filterOperatorList"
                />
              </FormRow>
            </div>
          </div>
          {field && operator?.type === 'phrase' && (
            <FormRow label="Value" full>
              {field.type === 'boolean' ? (
                <Select value={draft.value} onChange={(value) => patch({ value })} options={['true', 'false']} placeholder="Select a value" />
              ) : field.type === 'string' ? (
                <ComboBox
                  single
                  allowCustom
                  placeholder="Enter a value"
                  options={[...new Set([...suggestions, ...(draft.value ? [draft.value] : [])])].map((value) => ({ value, label: value }))}
                  selected={draft.value ? [draft.value] : []}
                  onChange={([value]) => patch({ value: value ?? '' })}
                  onSearch={setTyped}
                  testId="filterParamsComboBox"
                />
              ) : (
                <TextField
                  value={draft.value}
                  onChange={(value) => patch({ value })}
                  placeholder={field.type === 'date' ? 'A date, or an expression such as now-1d' : 'Enter a value'}
                  inputMode={field.type === 'number' ? 'decimal' : undefined}
                  testId="filterParams"
                />
              )}
            </FormRow>
          )}
          {field && operator?.type === 'phrases' && (
            <FormRow label="Values" full>
              <ComboBox
                allowCustom
                placeholder="Select values"
                options={[...new Set([...suggestions, ...draft.values])].map((value) => ({ value, label: value }))}
                selected={draft.values}
                onChange={(values) => patch({ values })}
                onSearch={setTyped}
                testId="filterParamsComboBox"
              />
            </FormRow>
          )}
          {field && operator?.type === 'range' && (
            <div className="atlRow">
              <FormRow label="From" full>
                <TextField value={draft.from} onChange={(from) => patch({ from })} placeholder="Start of the range" />
              </FormRow>
              <FormRow label="To" full>
                <TextField value={draft.to} onChange={(to) => patch({ to })} placeholder="End of the range" />
              </FormRow>
            </div>
          )}
        </>
      )}
      <FormRow label="Custom label" help="Shown on the filter in place of what it asks" full>
        <TextField value={draft.alias} onChange={(alias) => patch({ alias })} />
      </FormRow>
      <div className="atlRow" style={{ justifyContent: 'flex-end' }}>
        <Button variant="empty" onClick={onCancel} testId="cancelSaveFilter">
          Cancel
        </Button>
        <Button variant="primary" type="submit" disabled={!valid} testId="saveFilter">
          Save
        </Button>
      </div>
    </form>
  );
}

function FilterPill({
  filter,
  indexPatterns,
  onChange,
  onRemove,
}: {
  filter: Filter;
  indexPatterns: IndexPattern[];
  onChange: (filter: Filter) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState<'menu' | 'edit' | undefined>();
  const close = useCallback(() => setOpen(undefined), []);
  const { meta } = filter;
  const pattern = indexPatterns.find((candidate) => candidate.id === meta.index) ?? indexPatterns[0];
  const description = describeFilter(filter, (name, value) => {
    const field = pattern?.fields.find((candidate) => candidate.name === name);
    return field ? fieldFormatter(pattern, name, services.formatSettings())(value).text : String(value);
  });
  const pinned = isPinned(filter);
  const text = meta.alias ? meta.alias : `${description.key}: ${description.value}`;

  const items: MenuItem[] = [
    {
      label: pinned ? 'Unpin' : 'Pin across all apps',
      icon: 'pin',
      onClick: () => onChange(withStore(filter, !pinned)),
      testId: 'pinFilter',
    },
    { label: 'Edit filter', icon: 'pencil', onClick: () => setOpen('edit'), testId: 'editFilter' },
    {
      label: meta.negate ? 'Include results' : 'Exclude results',
      icon: meta.negate ? 'plusCircle' : 'minusCircle',
      onClick: () => onChange({ ...filter, meta: { ...meta, negate: !meta.negate } }),
      testId: 'negateFilter',
    },
    {
      label: meta.disabled ? 'Re-enable' : 'Temporarily disable',
      icon: meta.disabled ? 'eye' : 'eyeClosed',
      onClick: () => onChange({ ...filter, meta: { ...meta, disabled: !meta.disabled } }),
      testId: 'disableFilter',
    },
    { label: 'Delete', icon: 'trash', danger: true, onClick: onRemove, testId: 'deleteFilter' },
  ];

  return (
    <Popover
      open={open !== undefined}
      onClose={close}
      padded={open === 'edit'}
      button={
        <span
          className={cx(
            'shlFilter',
            meta.negate && 'shlFilter--negated',
            meta.disabled && 'shlFilter--disabled',
            pinned && 'shlFilter--pinned'
          )}
          data-test-subj={`filter filter-key-${description.key} ${meta.negate ? 'filter-negated' : ''} ${
            meta.disabled ? 'filter-disabled' : 'filter-enabled'
          } ${pinned ? 'filter-pinned' : 'filter-unpinned'}`}
        >
          <button
            type="button"
            className="shlFilter__label"
            title={`${meta.negate ? 'NOT ' : ''}${text}`}
            onClick={() => setOpen(open ? undefined : 'menu')}
          >
            {meta.negate && <span className="shlFilter__prefix">NOT</span>}
            <span className="atlTruncate">{text}</span>
          </button>
          <button type="button" className="shlFilter__remove" aria-label={`Delete ${text}`} onClick={onRemove}>
            <Icon name="cross" />
          </button>
        </span>
      }
    >
      {open === 'edit' ? (
        <FilterEditor
          filter={filter}
          indexPatterns={indexPatterns}
          onCancel={close}
          onSave={(next) => {
            onChange(next);
            close();
          }}
        />
      ) : (
        <Menu items={items.map((item) => (item.testId === 'editFilter' ? item : { ...item }))} onDone={() => setOpen((was) => (was === 'edit' ? was : undefined))} />
      )}
    </Popover>
  );
}

export interface FilterBarProps {
  filters: Filter[];
  onChange: (filters: Filter[]) => void;
  indexPatterns: IndexPattern[];
}

export function FilterBar({ filters, onChange, indexPatterns }: FilterBarProps) {
  const [adding, setAdding] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const closeAdding = useCallback(() => setAdding(false), []);
  const closeOptions = useCallback(() => setOptionsOpen(false), []);

  const all = (change: (filter: Filter) => Filter) => onChange(filters.map(change));
  const options: MenuItem[] = [
    { label: 'Enable all', icon: 'eye', onClick: () => all((filter) => ({ ...filter, meta: { ...filter.meta, disabled: false } })) },
    { label: 'Disable all', icon: 'eyeClosed', onClick: () => all((filter) => ({ ...filter, meta: { ...filter.meta, disabled: true } })) },
    { label: 'Pin all', icon: 'pin', onClick: () => all((filter) => withStore(filter, true)) },
    { label: 'Unpin all', icon: 'pin', onClick: () => all((filter) => withStore(filter, false)) },
    { label: 'Invert inclusion', icon: 'minusCircle', onClick: () => all((filter) => ({ ...filter, meta: { ...filter.meta, negate: !filter.meta.negate } })) },
    { label: 'Invert enabled/disabled', icon: 'eye', onClick: () => all((filter) => ({ ...filter, meta: { ...filter.meta, disabled: !filter.meta.disabled } })) },
    { label: 'Remove all', icon: 'trash', danger: true, onClick: () => onChange([]) },
  ];

  return (
    <div className="shlFilters" data-test-subj="globalFilterGroup">
      <Popover
        open={optionsOpen}
        onClose={closeOptions}
        button={
          <IconButton
            icon="filter"
            label="Change all filters"
            variant="empty"
            className="shlFilters__actions"
            onClick={() => setOptionsOpen(!optionsOpen)}
            testId="showFilterActions"
          />
        }
      >
        <Menu items={options} title="Change all filters" onDone={closeOptions} />
      </Popover>
      {filters.map((filter, index) => (
        <FilterPill
          key={`${index}-${JSON.stringify(filter.meta.key)}-${JSON.stringify(filter.meta.value ?? filter.meta.params)}`}
          filter={filter}
          indexPatterns={indexPatterns}
          onChange={(next) => onChange(filters.map((other, at) => (at === index ? next : other)))}
          onRemove={() => onChange(filters.filter((_other, at) => at !== index))}
        />
      ))}
      <Popover
        open={adding}
        onClose={closeAdding}
        padded
        button={
          <Button variant="empty" icon="plusCircle" onClick={() => setAdding(!adding)} testId="addFilter" disabled={indexPatterns.length === 0}>
            Add filter
          </Button>
        }
      >
        <FilterEditor
          indexPatterns={indexPatterns}
          onCancel={closeAdding}
          onSave={(filter) => {
            onChange([...filters, filter]);
            closeAdding();
          }}
        />
      </Popover>
    </div>
  );
}

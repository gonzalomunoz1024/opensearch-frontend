/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The parts the TSVB editor is built of: rows of fields, yes-or-no radios, colour pickers that
 * can be cleared, colour rules, the add, clone and delete buttons of a row, the query bar of a
 * filter, the field lists and the options of an index pattern. Each changes the params as the
 * original's does, key by key, so that what is saved has the shape OpenSearch Dashboards saves.
 */

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { IconButton, cx } from '../../../components/basic';
import { ColorPicker } from '../../../components/color_picker';
import { ComboBox, type ComboOption } from '../../../components/combo_box';
import { Icon } from '../../../components/icon';
import type { IndexPattern, Query } from '../../../lib/types';
import { services } from '../../../services';
import { QueryBar, defaultQueryLanguage } from '../../../shell/query_bar';
import {
  AUTO_INTERVAL,
  collection,
  inputValue,
  list,
  str,
  uuid,
  validateInterval,
  type Doc,
  type Fields,
  type OnChange,
} from './model';

// --- Layout ---------------------------------------------------------------------------------------

export interface TabSpec {
  id: string;
  label: ReactNode;
  testId?: string;
}

/** Tabs as the editor's: a row of small pills */
export function TvbTabs({ tabs, selected, onSelect, className }: { tabs: TabSpec[]; selected: string; onSelect: (id: string) => void; className?: string }) {
  return (
    <div className={cx('tvbTabs', className)} role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          className="tvbTab"
          aria-selected={tab.id === selected}
          onClick={() => onSelect(tab.id)}
          data-test-subj={tab.testId}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

/** A panel of options under a title */
export function OptionsPanel({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="tvbOptions">
      <h3 className="tvbOptions__title">{title}</h3>
      {children}
    </section>
  );
}

export function Rule({ size }: { size?: 's' }) {
  return <hr className={cx('tvbRule', size === 's' && 'tvbRule--s')} />;
}

export function Spacer({ size = 'l' }: { size?: 'xs' | 's' | 'm' | 'l' }) {
  return <div className={`tvbSpacer tvbSpacer--${size}`} />;
}

/** Items side by side, wrapping when the row is narrow */
export function Row({
  children,
  gap = 'l',
  center,
  className,
  testId,
}: {
  children: ReactNode;
  gap?: 's' | 'm' | 'l';
  center?: boolean;
  className?: string;
  testId?: string;
}) {
  return (
    <div className={cx('tvbRow', `tvbRow--${gap}`, center && 'tvbRow--center', className)} data-test-subj={testId}>
      {children}
    </div>
  );
}

/** One item of a row: it takes an equal share of the room, or only what it needs */
export function Item({ children, grow = true, className, testId }: { children?: ReactNode; grow?: boolean; className?: string; testId?: string }) {
  return (
    <div className={cx('tvbItem', !grow && 'tvbItem--fixed', className)} data-test-subj={testId}>
      {children}
    </div>
  );
}

/** A labelled field, with its help or what is wrong with it under it */
export function Field({
  label,
  help,
  error,
  full,
  children,
  className,
}: {
  label?: ReactNode;
  help?: ReactNode;
  error?: ReactNode;
  full?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('tvbField', full && 'tvbField--full', className)}>
      {label !== undefined && <div className={cx('tvbLabel', Boolean(error) && 'tvbLabel--invalid')}>{label}</div>}
      {children}
      {error && <div className="tvbField__error">{error}</div>}
      {help && <div className="tvbField__help">{help}</div>}
    </div>
  );
}

export function Label({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx('tvbLabel', className)}>{children}</span>;
}

// --- Inputs ---------------------------------------------------------------------------------------

/** A text field that hands back exactly what was typed: TSVB keeps most of its numbers as text */
export function TextInput({
  value,
  onChange,
  type = 'text',
  step,
  placeholder,
  disabled,
  invalid,
  label,
  testId,
}: {
  value: unknown;
  onChange: (value: string) => void;
  type?: 'text' | 'number';
  step?: number;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  label?: string;
  testId?: string;
}) {
  return (
    <input
      type={type}
      step={step}
      className={cx('atlField', 'tvbInput', invalid && 'atlField--invalid')}
      value={inputValue(value)}
      placeholder={placeholder}
      disabled={disabled}
      aria-label={label}
      onChange={(event) => onChange(event.target.value)}
      data-test-subj={testId}
    />
  );
}

export interface Choice {
  value: string;
  label: string;
  disabled?: boolean;
  group?: string;
}

/** A list to pick one of: what it hands back is the value picked, or null when it was cleared */
export function Combo({
  options,
  value,
  onChange,
  placeholder,
  clearable = true,
  disabled,
  invalid,
  testId,
}: {
  options: Choice[];
  value: unknown;
  onChange: (value: string | null) => void;
  placeholder?: string;
  clearable?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  testId?: string;
}) {
  const selected = options.some((option) => option.value === value) ? [String(value)] : [];
  return (
    <ComboBox
      options={options as ComboOption[]}
      selected={selected}
      onChange={(next) => onChange(next[0] ?? null)}
      single
      placeholder={placeholder}
      clearable={clearable}
      disabled={disabled}
      invalid={invalid}
      testId={testId}
    />
  );
}

/** Yes and No as radios, saved as 1 and 0 */
export function YesNo({ name, value, onChange, disabled, testId }: { name: string; value: unknown; onChange: OnChange; disabled?: boolean; testId?: string }) {
  const group = useId();
  const yes = Boolean(value);
  return (
    <div className="tvbYesNo">
      <label className={cx('atlRadio', disabled && 'tvbYesNo--disabled')}>
        <input type="radio" name={group} value="yes" checked={yes} disabled={disabled} onChange={() => onChange({ [name]: 1 })} data-test-subj={testId && `${testId}-yes`} />
        <span>Yes</span>
      </label>
      <label className={cx('atlRadio', disabled && 'tvbYesNo--disabled')}>
        <input type="radio" name={group} value="no" checked={!yes} disabled={disabled} onChange={() => onChange({ [name]: 0 })} data-test-subj={testId && `${testId}-no`} />
        <span>No</span>
      </label>
    </div>
  );
}

// The picker shows a saved rgba() colour as its numbers: "rgba(84,179,153,1)" reads "84,179,153,1"
const shownColor = (value: unknown) => (typeof value === 'string' ? (value.includes('rgba') ? value.replace(/[^0-9,]/g, '') : value) : '');

/** A colour of the params: saved as rgba(), and cleared to null with the cross beside it */
export function TvbColorPicker({ name, value, onChange, disableTrash }: { name: string; value: unknown; onChange: OnChange; disableTrash?: boolean }) {
  const [color, setColor] = useState(() => shownColor(value));
  const saved = useRef(value);
  // A colour changed elsewhere, such as a new row taking the series' colour, shows here too
  useEffect(() => {
    if (value !== saved.current) {
      saved.current = value;
      setColor(shownColor(value));
    }
  }, [value]);
  const change = (next: unknown) => {
    saved.current = next;
    onChange({ [name]: next });
  };
  const label = value ? `Color picker (${String(value)}), not accessible` : 'Color picker, not accessible';
  return (
    <div className="tvbColorPicker" data-test-subj="tvbColorPicker">
      <ColorPicker
        color={color}
        showAlpha
        label={label}
        onChange={(text, output) => {
          setColor(text);
          change(output.hex ? `rgba(${output.rgba.join(',')})` : '');
        }}
      />
      {!disableTrash && (
        <button
          type="button"
          className="tvbColorPicker__clear"
          title="Clear"
          aria-label="Clear"
          onClick={() => {
            setColor('');
            change(null);
          }}
        >
          <Icon name="cross" />
        </button>
      )}
    </div>
  );
}

// --- Rows of a list ---------------------------------------------------------------------------------

export interface AddDeleteProps {
  testSubj?: string;
  addTooltip?: string;
  deleteTooltip?: string;
  cloneTooltip?: string;
  activatePanelTooltip?: string;
  deactivatePanelTooltip?: string;
  isPanelActive?: boolean;
  disableAdd?: boolean;
  disableDelete?: boolean;
  togglePanelActivation?: () => void;
  onClone?: () => void;
  onAdd?: () => void;
  onDelete?: () => void;
}

/** The buttons at the end of a row: show or hide it, copy it, add one after it, delete it */
export function AddDeleteButtons({
  testSubj = 'Add',
  addTooltip = 'Add',
  deleteTooltip = 'Delete',
  cloneTooltip = 'Clone',
  activatePanelTooltip = 'Re-enable',
  deactivatePanelTooltip = 'Temporarily Disable',
  isPanelActive,
  disableAdd,
  disableDelete,
  togglePanelActivation,
  onClone,
  onAdd,
  onDelete,
}: AddDeleteProps) {
  const activeTip = isPanelActive ? deactivatePanelTooltip : activatePanelTooltip;
  return (
    <div className="tvbAddDelete">
      {isPanelActive !== undefined && (
        <IconButton
          size="s"
          className="tvbIconButton"
          icon={isPanelActive ? 'eye' : 'eyeClosed'}
          label={activeTip}
          onClick={togglePanelActivation}
          testId={`${testSubj}ActivatePanelBtn`}
        />
      )}
      {onClone && !disableAdd && <IconButton size="s" className="tvbIconButton" icon="copy" label={cloneTooltip} onClick={onClone} testId={`${testSubj}CloneBtn`} />}
      {!disableAdd && <IconButton size="s" className="tvbIconButton" icon="plusCircle" label={addTooltip} onClick={onAdd} testId={`${testSubj}AddBtn`} />}
      {!disableDelete && (
        <IconButton size="s" className="tvbIconButton tvbIconButton--danger" icon="trash" label={deleteTooltip} onClick={onDelete} testId={`${testSubj}DeleteBtn`} />
      )}
    </div>
  );
}

// --- Colour rules -------------------------------------------------------------------------------------

const OPERATORS: Choice[] = [
  { label: '> greater than', value: 'gt' },
  { label: '>= greater than or equal', value: 'gte' },
  { label: '< less than', value: 'lt' },
  { label: '<= less than or equal', value: 'lte' },
];

/**
 * The rules that colour a panel by its value: "Set background to [colour] and text to [colour]
 * if metric is [operator] [value]". A rule's value is a number, 0 to start with.
 */
export function ColorRules({
  model,
  onChange,
  name = 'color_rules',
  primaryName = 'background',
  primaryVarName = 'background_color',
  secondaryName = 'text',
  secondaryVarName = 'color',
  hideSecondary,
}: {
  model: Doc;
  onChange: OnChange;
  name?: string;
  primaryName?: string;
  primaryVarName?: string;
  secondaryName?: string;
  secondaryVarName?: string;
  hideSecondary?: boolean;
}) {
  const rules = list<Doc & { id: string }>(model, name);
  if (!Array.isArray(model[name])) return <div />;
  const save = (next: Array<Doc & { id: string }>) => onChange({ ...model, [name]: next });
  return (
    <div>
      {rules.map((row) => {
        const rule: Doc & { id: string } = { value: 0, ...row };
        const change = (part: Doc) => save(collection.change(rules, { ...rule, ...part }));
        return (
          <Row key={rule.id} gap="s" center className="tvbColorRules__rule">
            <Item grow={false}>
              <Label>Set {primaryName} to</Label>
            </Item>
            <Item grow={false}>
              <TvbColorPicker name={primaryVarName} value={rule[primaryVarName]} onChange={change} />
            </Item>
            {!hideSecondary && (
              <>
                <Item grow={false}>
                  <Label>and {secondaryName} to</Label>
                </Item>
                <Item grow={false}>
                  <TvbColorPicker name={secondaryVarName} value={rule[secondaryVarName]} onChange={change} />
                </Item>
              </>
            )}
            <Item grow={false}>
              <Label>if metric is</Label>
            </Item>
            <Item>
              <Combo options={OPERATORS} value={rule.operator} onChange={(operator) => change({ operator: operator ?? undefined })} testId="colorRuleOperator" />
            </Item>
            <Item>
              <TextInput
                type="number"
                label="Value"
                value={rule.value}
                onChange={(text) => {
                  const value = Number(text);
                  change({ value: Number.isNaN(value) ? undefined : value });
                }}
                testId="colorRuleValue"
              />
            </Item>
            <Item grow={false}>
              <AddDeleteButtons
                onAdd={() => save(collection.add(rules, { id: uuid() }))}
                onDelete={() => save(collection.remove(rules, rule))}
                disableDelete={rules.length < 2}
              />
            </Item>
          </Row>
        );
      })}
    </div>
  );
}

// --- Filters --------------------------------------------------------------------------------------------

/** The index patterns saved under the titles a panel names, for what the query bar suggests */
function usePatterns(titles: string[]): IndexPattern[] {
  const [patterns, setPatterns] = useState<IndexPattern[]>([]);
  const key = titles.join('\n');
  useEffect(() => {
    let live = true;
    const wanted = key.split('\n').filter(Boolean);
    services.indexPatterns
      .list()
      .then((all) => Promise.all(all.filter((pattern) => wanted.includes(pattern.title)).map((pattern) => services.indexPatterns.get(pattern.id))))
      .then((found) => live && setPatterns(found))
      .catch(() => live && setPatterns([]));
    return () => {
      live = false;
    };
  }, [key]);
  return patterns;
}

/** A query of the params, `{ query, language }`, changed as it is typed */
export function QueryBarWrapper({ query, onChange, indexPatterns }: { query: Query; onChange: (query: Query) => void; indexPatterns: string[] }) {
  const patterns = usePatterns(indexPatterns);
  const text = typeof query.query === 'string' ? query.query : '';
  return (
    <div className="tvbQueryBar">
      <QueryBar
        value={text}
        language={query.language}
        onChange={(next) => onChange({ query: next, language: query.language })}
        onSubmit={(next) => onChange({ query: next, language: query.language })}
        // Another language starts the query over, as the product's query bar does
        onLanguageChange={(language) => onChange({ query: '', language })}
        indexPatterns={patterns}
      />
    </div>
  );
}

/** A query saved in the params, read with the language the product starts with */
export function readQuery(value: unknown): Query {
  const query = value && typeof value === 'object' ? (value as Doc) : {};
  const language = typeof query.language === 'string' && query.language ? query.language : defaultQueryLanguage();
  return { language, query: typeof query.query === 'string' ? query.query : '' };
}

// --- Fields -----------------------------------------------------------------------------------------------

/**
 * The fields of an index pattern to pick one from, grouped by their kind. A field that is not
 * among them, such as one of another pattern, is taken out of the params, as the original does.
 */
export function FieldSelect({
  fields,
  indexPattern = '*',
  value,
  onChange,
  type,
  restrict = [],
  placeholder = 'Select field...',
  disabled,
  clearable = true,
  testId,
}: {
  fields: Fields;
  indexPattern?: string;
  value: unknown;
  onChange: (value: string | null) => void;
  type?: string;
  restrict?: string[];
  placeholder?: string;
  disabled?: boolean;
  clearable?: boolean;
  testId?: string;
}) {
  const kinds = restrict.join(',');
  const options = useMemo(() => {
    const allowed = kinds ? kinds.split(',') : [];
    const groups = new Map<string, Choice[]>();
    for (const field of fields[indexPattern] ?? []) {
      if (allowed.length && !allowed.includes(field.type)) continue;
      const group = groups.get(field.type) ?? [];
      group.push({ value: field.name, label: field.name, group: field.type });
      groups.set(field.type, group);
    }
    return [...groups.values()].flat();
  }, [fields, indexPattern, kinds]);
  const missing = type !== 'count' && Boolean(value) && !options.some((option) => option.value === value);
  const latest = useRef(onChange);
  latest.current = onChange;
  useEffect(() => {
    if (missing) latest.current(null);
  }, [missing]);
  if (type === 'count') return null;
  return (
    <Combo options={options} value={value} onChange={onChange} placeholder={placeholder} disabled={disabled} clearable={clearable} testId={testId} />
  );
}

// --- Index pattern ------------------------------------------------------------------------------------------

const TIME_RANGE_OPTIONS: Choice[] = [
  { label: 'Last value', value: 'last_value' },
  { label: 'Entire time range', value: 'entire_time_range' },
];

const DATE_FIELDS = ['date'];

/**
 * Where a panel's data comes from: the time range it matches, the index pattern, its time field,
 * the interval of its buckets and whether the last bucket is left out. A series that overrides
 * the panel's index pattern has the same options with the prefix `series_`.
 */
export function IndexPatternOptions({
  fields,
  prefix = '',
  onChange,
  disabled,
  model: given,
}: {
  fields: Fields;
  prefix?: string;
  onChange: OnChange;
  disabled?: boolean;
  model: Doc;
}) {
  const timeFieldName = `${prefix}time_field`;
  const indexPatternName = `${prefix}index_pattern`;
  const intervalName = `${prefix}interval`;
  const dropBucketName = `${prefix}drop_last_bucket`;
  const model: Doc = {
    default_index_pattern: '',
    [indexPatternName]: '*',
    [intervalName]: AUTO_INTERVAL,
    [dropBucketName]: 1,
    time_range_mode: 'last_value',
    ...given,
  };
  const isTimeSeries = model.type === 'timeseries';
  const entireTimeRange = !isTimeSeries && model.time_range_mode === 'entire_time_range';
  const defaultUsed = Boolean(model.default_index_pattern) && !model[indexPatternName];
  const validation = validateInterval(model[intervalName]);
  return (
    <div className="index-pattern">
      {!isTimeSeries && (
        <Row>
          <Item>
            <Field label="Data timerange mode">
              <Combo
                options={TIME_RANGE_OPTIONS}
                value={model.time_range_mode}
                onChange={(mode) => onChange({ time_range_mode: mode })}
                placeholder="Select"
                clearable={false}
                disabled={disabled}
              />
            </Field>
            <p className="tvbText tvbText--xs">
              This setting controls the timespan used for matching documents. &quot;Entire timerange&quot; will match all the documents
              selected in the timepicker. &quot;Last value&quot; will match only the documents for the specified interval from the end of
              the timerange.
            </p>
          </Item>
        </Row>
      )}
      <Row>
        <Item>
          <Field
            label="Index name"
            help={
              defaultUsed
                ? 'Default index pattern is used. To query all indexes use *'
                : 'Use an asterisk (*) to match multiple indices. Spaces and the characters , /, ?, ", <, >, | are not allowed.'
            }
          >
            <TextInput
              value={model[indexPatternName]}
              onChange={(text) => onChange({ [indexPatternName]: text })}
              placeholder={str(model, 'default_index_pattern')}
              disabled={disabled}
              label="Index name"
              testId="metricsIndexPatternInput"
            />
          </Field>
        </Item>
        <Item>
          <Field label="Time field">
            <FieldSelect
              fields={fields}
              restrict={DATE_FIELDS}
              value={model[timeFieldName]}
              disabled={disabled}
              onChange={(field) => onChange({ [timeFieldName]: field })}
              indexPattern={str(model, indexPatternName)}
              placeholder={defaultUsed ? str(model, 'default_timefield') : undefined}
              testId="metricsIndexPatternFieldsSelect"
            />
          </Field>
        </Item>
        <Item grow={false}>
          <Field label="Interval" help="Examples: auto, 1m, 1d, 7d, 1y, >=1m" error={validation.valid ? undefined : validation.message}>
            <TextInput
              value={model[intervalName]}
              onChange={(text) => onChange({ [intervalName]: text })}
              placeholder={AUTO_INTERVAL}
              disabled={disabled || entireTimeRange}
              invalid={!validation.valid}
              label="Interval"
              testId="metricsIndexPatternInterval"
            />
          </Field>
        </Item>
        <Item grow={false}>
          <Field label="Drop last bucket?">
            <YesNo name={dropBucketName} value={model[dropBucketName]} onChange={onChange} disabled={disabled || entireTimeRange} testId="metricsDropLastBucket" />
          </Field>
        </Item>
      </Row>
    </div>
  );
}

/** The panel filter and whether the page's filters are ignored: the last row of a panel's data options */
export function PanelFilter({ model, onChange }: { model: Doc; onChange: OnChange }) {
  return (
    <Row>
      <Item>
        <Field label="Panel filter" full>
          <QueryBarWrapper
            query={readQuery(model.filter)}
            onChange={(filter) => onChange({ filter })}
            indexPatterns={[str(model, 'index_pattern') || str(model, 'default_index_pattern')]}
          />
        </Field>
      </Item>
      <Item grow={false}>
        <Label>Ignore global filter?</Label>
        <Spacer size="m" />
        <YesNo name="ignore_global_filter" value={model.ignore_global_filter} onChange={onChange} />
      </Item>
    </Row>
  );
}

/** "This supports mustache templating. {{key}} is set to the term." */
export const KEY_HELP = (
  <>
    This supports mustache templating. <code className="tvbCode">{'{{key}}'}</code> is set to the term.
  </>
);

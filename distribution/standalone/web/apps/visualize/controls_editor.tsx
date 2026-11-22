/* SPDX-License-Identifier: Apache-2.0 */

/* The editor of a Controls visualization: its lists and ranges, and what they do to the page. */

import { useEffect, useState } from 'react';
import { Accordion, Button, FieldToken, IconButton } from '../../components/basic';
import { ComboBox } from '../../components/combo_box';
import { FormRow, NumberField, Select, Switch, TextField } from '../../components/form';
import type { IndexPattern } from '../../lib/types';
import { services } from '../../services';
import { patternName, type IndexPatternSummary } from '../../services/index_patterns';
import type { OptionsProps } from './options';

interface Control {
  id: string;
  indexPattern?: string;
  fieldName?: string;
  parent?: string;
  label?: string;
  type: 'list' | 'range';
  options?: Record<string, unknown>;
}

const TYPE_NAMES = { list: 'Options list', range: 'Range slider' };

/** A control nobody has filled in yet */
export function newControl(type: 'list' | 'range', id = String(Date.now())): Control {
  return {
    id,
    indexPattern: '',
    fieldName: '',
    parent: '',
    label: '',
    type,
    options: type === 'list' ? { type: 'terms', multiselect: true, dynamicOptions: true, size: 5, order: 'desc' } : { decimalPlaces: 0, step: 1 },
  };
}

function ControlEditor({
  control,
  others,
  patterns,
  onChange,
}: {
  control: Control;
  others: Control[];
  patterns: IndexPatternSummary[];
  onChange: (control: Control) => void;
}) {
  const [pattern, setPattern] = useState<IndexPattern>();
  useEffect(() => {
    let live = true;
    setPattern(undefined);
    if (control.indexPattern) {
      services.indexPatterns
        .get(control.indexPattern)
        .then((loaded) => live && setPattern(loaded))
        .catch(() => undefined);
    }
    return () => {
      live = false;
    };
  }, [control.indexPattern]);

  const options = control.options ?? {};
  const setOption = (patch: Record<string, unknown>) => onChange({ ...control, options: { ...options, ...patch } });
  const wanted = control.type === 'range' ? ['number'] : ['number', 'string', 'boolean', 'ip', 'date'];
  const fields = (pattern?.fields ?? [])
    .filter((field) => field.aggregatable && wanted.includes(field.type) && !field.name.startsWith('_'))
    .sort((a, b) => a.name.localeCompare(b.name));
  const field = pattern?.fields.find((candidate) => candidate.name === control.fieldName);
  const parents = others.filter((other) => other.type === 'list');

  return (
    <div className="vzeFields">
      <FormRow label="Control Label" full>
        <TextField compact value={control.label ?? ''} onChange={(label) => onChange({ ...control, label })} testId="inputControlEditorLabel" />
      </FormRow>
      <FormRow label="Index Pattern" full>
        <ComboBox
          single
          compact
          fullWidth
          options={patterns.map((item) => ({ value: item.id, label: patternName(item) }))}
          selected={control.indexPattern ? [control.indexPattern] : []}
          placeholder="Select index pattern..."
          onChange={(selected) => onChange({ ...control, indexPattern: selected[0] ?? '', fieldName: '' })}
          testId="indexPatternSelect"
        />
      </FormRow>
      <FormRow label="Field" full>
        <ComboBox
          single
          compact
          fullWidth
          disabled={!control.indexPattern}
          options={fields.map((candidate) => ({ value: candidate.name, label: candidate.name, prepend: <FieldToken type={candidate.type} /> }))}
          selected={control.fieldName ? [control.fieldName] : []}
          placeholder="Select field..."
          onChange={(selected) => onChange({ ...control, fieldName: selected[0] ?? '' })}
          testId="fieldSelect"
        />
      </FormRow>
      {control.type === 'list' ? (
        <>
          {parents.length > 0 && (
            <FormRow label="Parent control" full help="Options are based on the value of parent control. Disabled if parent is not set.">
              <Select
                compact
                value={control.parent ?? ''}
                options={[{ value: '', label: 'None' }, ...parents.map((other, index) => ({ value: other.id, label: other.label || `${TYPE_NAMES[other.type]}: ${index + 1}` }))]}
                onChange={(parent) => onChange({ ...control, parent })}
              />
            </FormRow>
          )}
          <Switch checked={Boolean(options.multiselect)} onChange={(multiselect) => setOption({ multiselect })} label="Multiselect" testId="listControlMultiselectInput" />
          <p className="atlSubdued atlXs">Allow multiple selection</p>
          <Switch
            checked={Boolean(options.dynamicOptions) && (field === undefined || field.type === 'string')}
            disabled={field !== undefined && field.type !== 'string'}
            onChange={(dynamicOptions) => setOption({ dynamicOptions })}
            label="Dynamic Options"
            testId="listControlDynamicOptionsSwitch"
          />
          <p className="atlSubdued atlXs">Update options in response to user input. Only available for "string" fields</p>
          {!(Boolean(options.dynamicOptions) && (field === undefined || field.type === 'string')) && (
            <FormRow label="Size" full help="Number of options">
              <NumberField compact min={1} value={typeof options.size === 'number' ? options.size : 5} onChange={(size) => setOption({ size: size ?? 5 })} testId="listControlSizeInput" />
            </FormRow>
          )}
        </>
      ) : (
        <div className="vzePair">
          <FormRow label="Step Size">
            <NumberField compact step="any" min={0} value={typeof options.step === 'number' ? options.step : 1} onChange={(step) => setOption({ step: step ?? 1 })} />
          </FormRow>
          <FormRow label="Decimal Places">
            <NumberField compact min={0} value={typeof options.decimalPlaces === 'number' ? options.decimalPlaces : 0} onChange={(decimalPlaces) => setOption({ decimalPlaces: decimalPlaces ?? 0 })} />
          </FormRow>
        </div>
      )}
    </div>
  );
}

export function ControlsTab({ params, setParams }: OptionsProps) {
  const controls = (Array.isArray(params.controls) ? params.controls : []) as Control[];
  const [type, setType] = useState<'list' | 'range'>('list');
  const [patterns, setPatterns] = useState<IndexPatternSummary[]>([]);
  useEffect(() => {
    let live = true;
    services.indexPatterns
      .list()
      .then((list) => live && setPatterns(list))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const setControls = (next: Control[]) => setParams({ ...params, controls: next });
  const move = (index: number, by: number) => {
    const next = [...controls];
    const [moved] = next.splice(index, 1);
    next.splice(index + by, 0, moved);
    setControls(next);
  };

  return (
    <>
      {controls.map((control, index) => (
        <section className="vzePanel" key={control.id} data-test-subj={`inputControl${index}`}>
          <Accordion
            title={
              <span className="atlTruncate">
                <strong>{TYPE_NAMES[control.type] ?? control.type}</strong> {control.label}
              </span>
            }
            extra={
              <span className="atlRow">
                <IconButton icon="arrowUp" size="s" label="Move control up" disabled={index === 0} onClick={() => move(index, -1)} />
                <IconButton icon="arrowDown" size="s" label="Move control down" disabled={index === controls.length - 1} onClick={() => move(index, 1)} />
                <IconButton
                  icon="cross"
                  size="s"
                  label="Remove control"
                  onClick={() =>
                    setControls(
                      controls.filter((other) => other.id !== control.id).map((other) => (other.parent === control.id ? { ...other, parent: '' } : other))
                    )
                  }
                  testId={`inputControlEditorRemoveControl${index}`}
                />
              </span>
            }
          >
            <ControlEditor
              control={control}
              others={controls.filter((other) => other.id !== control.id)}
              patterns={patterns}
              onChange={(next) => setControls(controls.map((other) => (other.id === control.id ? next : other)))}
            />
          </Accordion>
        </section>
      ))}
      <section className="vzePanel">
        <div className="atlRow">
          <Select
            compact
            className="atlGrow"
            value={type}
            aria-label="Select control type"
            options={[
              { value: 'list', label: TYPE_NAMES.list },
              { value: 'range', label: TYPE_NAMES.range },
            ]}
            onChange={(next) => setType(next === 'range' ? 'range' : 'list')}
            testId="selectControlType"
          />
          <Button size="s" icon="plusCircle" onClick={() => setControls([...controls, newControl(type)])} testId="inputControlEditorAddBtn">
            Add
          </Button>
        </div>
      </section>
    </>
  );
}

export function ControlsOptions({ params, setParams }: OptionsProps) {
  const toggle = (name: string, label: string, testId: string) => (
    <Switch checked={Boolean(params[name])} onChange={(value) => setParams({ ...params, [name]: value })} label={label} testId={testId} />
  );
  return (
    <section className="vzePanel">
      <div className="vzeFields">
        {toggle('updateFiltersOnChange', 'Update OpenSearch Dashboards filters on each change', 'inputControlEditorUpdateFiltersOnChangeCheckbox')}
        {toggle('useTimeFilter', 'Use time filter', 'inputControlEditorUseTimeFilterCheckbox')}
        {toggle('pinFilters', 'Pin filters for all applications', 'inputControlEditorPinFiltersCheckbox')}
      </div>
    </section>
  );
}

/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The editor of an input controls visualization as OpenSearch Dashboards 3.9.0 draws it
 * (input_control_vis/public/components/editor). The Controls tab: a panel for each control, its
 * title and the buttons that move and remove it, then its label, its index pattern, its field and
 * the options of its kind; last, the kind of a new control and "Add". The Options tab: what the
 * controls do to the page.
 */

import '../../styles/input_controls.css';
import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '../../components/basic';
import { ComboBox, type ComboOption } from '../../components/combo_box';
import { Icon } from '../../components/icon';
import type { IndexPattern } from '../../lib/types';
import { services } from '../../services';
import {
  controlTitle,
  fieldGroups,
  listsField,
  movedControl,
  newControl,
  parentCandidates,
  rangesField,
  type ControlOptions,
  type ControlParam,
} from '../../vis/controls';
import { NumberControl, ParamRow, SmallIconButton, SwitchControl, TextControl } from './editor_controls';
import type { OptionsProps } from './options';

/** The index pattern a control is on, once it is known; `loading` while it is asked for */
function useIndexPattern(id: string | undefined): { pattern?: IndexPattern; loading: boolean } {
  const [state, setState] = useState<{ id?: string; pattern?: IndexPattern; loading: boolean }>({ loading: false });
  useEffect(() => {
    if (!id) {
      setState({ loading: false });
      return undefined;
    }
    let live = true;
    setState({ id, loading: true });
    services.indexPatterns
      .get(id)
      .then((pattern) => live && setState({ id, pattern, loading: false }))
      // An index pattern that is gone has no fields: the list stays as it was asked for
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [id]);
  return state.id === id ? state : { loading: Boolean(id) };
}

const SEARCH_WAIT_MS = 300;

/**
 * The index pattern of a control, as the original's index pattern select: the patterns whose
 * title or display name starts with what is typed, a hundred at most, asked a moment after the
 * typing stops; the chosen one by its display name, or else its title.
 */
function IndexPatternRow({ index, value, onChange }: { index: number; value: string | undefined; onChange: (id: string | undefined) => void }) {
  const id = `indexPatternSelect-${index}`;
  const [options, setOptions] = useState<ComboOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [chosen, setChosen] = useState<ComboOption>();
  const waiting = useRef<number>();
  const asked = useRef<string>();
  const live = useRef(true);
  useEffect(
    () => () => {
      live.current = false;
      window.clearTimeout(waiting.current);
    },
    []
  );
  const fetch = (search: string) => {
    setLoading(true);
    asked.current = search;
    window.clearTimeout(waiting.current);
    waiting.current = window.setTimeout(() => {
      services.savedObjects
        .find<{ title: string; displayName?: string }>({
          type: 'index-pattern',
          fields: ['title', 'displayName'],
          search: `${search}*`,
          searchFields: ['title', 'displayName'],
          perPage: 100,
        })
        .then(
          (found) => {
            if (!live.current || asked.current !== search) return;
            setOptions(found.saved_objects.map((object) => ({ value: object.id, label: object.attributes.displayName || object.attributes.title })));
            setLoading(false);
          },
          () => undefined
        );
    }, SEARCH_WAIT_MS);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => fetch(''), []);
  useEffect(() => {
    if (!value) {
      setChosen(undefined);
      return undefined;
    }
    let stillWanted = true;
    services.savedObjects
      .get<{ title: string; displayName?: string }>('index-pattern', value)
      .then((object) => stillWanted && setChosen({ value, label: object.attributes.displayName || object.attributes.title }))
      .catch(() => undefined);
    return () => {
      stillWanted = false;
    };
  }, [value]);
  // The chosen pattern keeps its name when the list asked for does not hold it
  const listed = chosen && chosen.value === value && !options.some((option) => option.value === value) ? [...options, chosen] : options;
  return (
    <ParamRow label="Index Pattern" labelFor={id}>
      <ComboBox
        id={id}
        single
        options={listed}
        selected={value ? [value] : []}
        placeholder="Select index pattern..."
        loading={loading}
        onSearch={fetch}
        onChange={(selected) => onChange(selected[0])}
        testId={id}
      />
    </ParamRow>
  );
}

/** The field of a control, the fields its kind can take listed by their kind; none before an index pattern is chosen */
function FieldRow({
  index,
  value,
  pattern,
  loading,
  keep,
  onChange,
}: {
  index: number;
  value: string | undefined;
  pattern?: IndexPattern;
  loading: boolean;
  keep: typeof listsField;
  onChange: (fieldName: string | undefined) => void;
}) {
  const id = `fieldSelect-${index}`;
  const options: ComboOption[] = (pattern ? fieldGroups(pattern.fields, keep) : []).flatMap(({ type, names }) =>
    names.map((name) => ({ value: name, label: name, group: type }))
  );
  // A field the list does not hold keeps its name
  if (value && !options.some((option) => option.value === value)) options.push({ value, label: value });
  return (
    <ParamRow label="Field" labelFor={id}>
      <ComboBox
        id={id}
        single
        options={options}
        selected={value ? [value] : []}
        placeholder="Select field..."
        loading={loading}
        onChange={(selected) => onChange(selected[0])}
        testId={id}
      />
    </ParamRow>
  );
}

/** A number of an option as the original keeps it: an emptied field is no number, which a saved object writes as null */
const optionNumber = (value: number | ''): number | null => (value === '' ? null : value);

function ListOptions({
  index,
  control,
  candidates,
  isString,
  setOption,
  onParentChange,
}: {
  index: number;
  control: ControlParam;
  candidates: Array<{ value: string; text: string }>;
  isString: boolean;
  setOption: <K extends keyof ControlOptions>(name: K, value: ControlOptions[K] | null) => void;
  onParentChange: (parent: string) => void;
}) {
  const options = control.options ?? {};
  const parentId = `parentSelect-${index}`;
  const sizeId = `size-${index}`;
  return (
    <>
      {candidates.length > 0 && (
        <ParamRow label="Parent control" labelFor={parentId} help="Options are based on the value of parent control. Disabled if parent is not set.">
          <span className="vzeSelect">
            <select id={parentId} className="atlField vzeControl" value={control.parent ?? ''} onChange={(event) => onParentChange(event.target.value)}>
              {[{ value: '', text: '' }, ...candidates].map((candidate) => (
                <option key={candidate.value} value={candidate.value}>
                  {candidate.text}
                </option>
              ))}
            </select>
            <Icon name="chevronDown" className="vzeSelect__arrow" />
          </span>
        </ParamRow>
      )}
      <ParamRow className="vzeRow--switch" help="Allow multiple selection">
        <SwitchControl
          label="Multiselect"
          checked={options.multiselect ?? true}
          onChange={(multiselect) => setOption('multiselect', multiselect)}
          testId="listControlMultiselectInput"
        />
      </ParamRow>
      <ParamRow className="vzeRow--switch" help={isString ? 'Update options in response to user input' : 'Only available for "string" fields'}>
        <SwitchControl
          label="Dynamic Options"
          checked={options.dynamicOptions ?? false}
          disabled={!isString}
          onChange={(dynamicOptions) => setOption('dynamicOptions', dynamicOptions)}
          testId="listControlDynamicOptionsSwitch"
        />
      </ParamRow>
      {/* The size is of no use to a list that asks as one types */}
      {(!options.dynamicOptions || !isString) && (
        <ParamRow label="Size" labelFor={sizeId} help="Number of options">
          <NumberControl id={sizeId} min={1} value={options.size} onChange={(size) => setOption('size', optionNumber(size))} testId="listControlSizeInput" />
        </ParamRow>
      )}
    </>
  );
}

function RangeOptions({
  index,
  control,
  setOption,
}: {
  index: number;
  control: ControlParam;
  setOption: <K extends keyof ControlOptions>(name: K, value: ControlOptions[K] | null) => void;
}) {
  const options = control.options ?? {};
  const stepId = `stepSize-${index}`;
  const placesId = `decimalPlaces-${index}`;
  return (
    <>
      <ParamRow label="Step Size" labelFor={stepId}>
        <NumberControl id={stepId} value={options.step} onChange={(step) => setOption('step', optionNumber(step))} testId={`rangeControlSizeInput${index}`} />
      </ParamRow>
      <ParamRow label="Decimal Places" labelFor={placesId}>
        <NumberControl
          id={placesId}
          min={0}
          value={options.decimalPlaces}
          onChange={(places) => setOption('decimalPlaces', optionNumber(places))}
          testId={`rangeControlDecimalPlacesInput${index}`}
        />
      </ParamRow>
    </>
  );
}

function ControlEditor({
  index,
  control,
  candidates,
  onChange,
  onMove,
  onRemove,
}: {
  index: number;
  control: ControlParam;
  candidates: Array<{ value: string; text: string }>;
  onChange: (control: ControlParam) => void;
  onMove: (direction: number) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(true);
  const regionId = useId();
  const labelId = `controlLabel${index}`;
  const { pattern, loading } = useIndexPattern(control.indexPattern || undefined);
  const range = control.type === 'range';
  // The options of a list wait for the kind of its field, as the original's
  const field = control.fieldName ? pattern?.fields.find((candidate) => candidate.name === control.fieldName) : undefined;
  const setOption = <K extends keyof ControlOptions>(name: K, value: ControlOptions[K] | null) =>
    onChange({ ...control, options: { ...control.options, [name]: value } });

  return (
    <div className="icvEditor__panel">
      <div className="icvAccordion__head">
        <button type="button" className="icvAccordion__button" aria-expanded={open} aria-controls={regionId} onClick={() => setOpen(!open)}>
          <span className="icvAccordion__arrow">
            <Icon name="chevronRight" />
          </span>
          <span className="icvAccordion__title">{controlTitle(control, index)}</span>
        </button>
        <div className="icvAccordion__actions">
          <SmallIconButton icon="sortUp" primary label="Move control up" onClick={() => onMove(-1)} testId={`inputControlEditorMoveUpControl${index}`} />
          <SmallIconButton icon="sortDown" primary label="Move control down" onClick={() => onMove(1)} testId={`inputControlEditorMoveDownControl${index}`} />
          <SmallIconButton icon="cross" danger label="Remove control" onClick={onRemove} testId={`inputControlEditorRemoveControl${index}`} />
        </div>
      </div>
      <div id={regionId} role="region" className="icvAccordion__content" hidden={!open}>
        <div className="icvForm">
          <ParamRow label="Control Label" labelFor={labelId}>
            <TextControl id={labelId} value={control.label ?? ''} onChange={(label) => onChange({ ...control, label })} />
          </ParamRow>
          <IndexPatternRow index={index} value={control.indexPattern} onChange={(indexPattern) => onChange({ ...control, indexPattern, fieldName: '' })} />
          {control.indexPattern ? (
            <FieldRow
              index={index}
              value={control.fieldName}
              pattern={pattern}
              loading={loading}
              keep={range ? rangesField : listsField}
              onChange={(fieldName) => onChange({ ...control, fieldName })}
            />
          ) : null}
          {range ? (
            <RangeOptions index={index} control={control} setOption={setOption} />
          ) : (
            field && (
              <ListOptions
                index={index}
                control={control}
                candidates={candidates}
                isString={field.type === 'string'}
                setOption={setOption}
                onParentChange={(parent) => onChange({ ...control, parent })}
              />
            )
          )}
        </div>
      </div>
    </div>
  );
}

export function ControlsTab({ params, setParams }: OptionsProps) {
  const controls = (Array.isArray(params.controls) ? params.controls : []) as ControlParam[];
  const [type, setType] = useState<ControlParam['type']>('list');
  const setControls = (next: ControlParam[]) => setParams({ ...params, controls: next });

  return (
    <div className="icvEditor">
      {controls.map((control, index) => (
        <ControlEditor
          key={control.id}
          index={index}
          control={control}
          candidates={parentCandidates(controls, control.id)}
          onChange={(next) => setControls(controls.map((other, at) => (at === index ? next : other)))}
          onMove={(direction) => setControls(movedControl(controls, index, direction))}
          onRemove={() => setControls(controls.filter((_, at) => at !== index))}
        />
      ))}
      <div className="icvEditor__panel icvEditor__add">
        <span className="vzeSelect icvEditor__type">
          <select
            id="selectControlType"
            className="atlField vzeControl"
            value={type}
            aria-label="Select control type"
            onChange={(event) => setType(event.target.value === 'range' ? 'range' : 'list')}
            data-test-subj="selectControlType"
          >
            <option value="range">Range slider</option>
            <option value="list">Options list</option>
          </select>
          <Icon name="chevronDown" className="vzeSelect__arrow" />
        </span>
        <Button id="addControl" icon="plusCircle" aria-label="Add control" onClick={() => setControls([...controls, newControl(type)])} testId="inputControlEditorAddBtn">
          Add
        </Button>
      </div>
    </div>
  );
}

const OPTIONS: Array<[name: string, label: string, testId: string]> = [
  ['updateFiltersOnChange', 'Update OpenSearch Dashboards filters on each change', 'inputControlEditorUpdateFiltersOnChangeCheckbox'],
  ['useTimeFilter', 'Use time filter', 'inputControlEditorUseTimeFilterCheckbox'],
  ['pinFilters', 'Pin filters for all applications', 'inputControlEditorPinFiltersCheckbox'],
];

export function ControlsOptions({ params, setParams }: OptionsProps) {
  return (
    <div className="icvOptions">
      {OPTIONS.map(([name, label, testId]) => (
        <div key={name} className="icvOptions__row">
          <SwitchControl label={label} checked={Boolean(params[name])} onChange={(value) => setParams({ ...params, [name]: value })} testId={testId} />
        </div>
      ))}
    </div>
  );
}

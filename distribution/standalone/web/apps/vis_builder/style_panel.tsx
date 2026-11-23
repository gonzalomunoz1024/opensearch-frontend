/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The right of VisBuilder: the kind of chart, and the settings of that kind (`styleState`), in
 * the compressed controls the original's chart options are drawn with. A change of kind keeps
 * the aggregations the new kind has a place for, and asks first when some would be lost.
 */

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { RAMP_NAMES } from '../../charts/core';
import type { AggConfig } from '../../lib/aggs';
import { Button, cx } from '../../components/basic';
import { Icon } from '../../components/icon';
import { Modal, Popover } from '../../components/overlay';
import {
  ButtonGroup,
  NumberControl,
  ParamRow,
  RangeControl,
  SelectControl,
  SwitchRow,
  TipLabel,
  type ChoiceOption,
} from '../visualize/editor_controls';
import { ColorRanges, getIn, setIn } from '../visualize/options';
import { persistedAggs, withType, type AppState } from './editor_state';
import { VIS_BUILDER_TYPES, visBuilderType, type StyleState, type VisBuilderType } from './model';

export interface StylePanelProps {
  state: AppState;
  update: (change: (state: AppState) => AppState) => void;
}

const LEGEND_POSITIONS: ChoiceOption[] = [
  { value: 'top', label: 'Top' },
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
  { value: 'bottom', label: 'Bottom' },
];

const COLOR_MODES = [
  { id: 'None', label: 'None' },
  { id: 'Labels', label: 'Labels' },
  { id: 'Background', label: 'Background' },
];

const COLOR_SCHEMAS: ChoiceOption[] = RAMP_NAMES.map((name) => ({ value: name, label: name }));

/**
 * One group of settings, as the original's accordion: the title opens and closes a tinted panel
 * under it, a rule after it. What is in the panel stays mounted while it is closed, as there.
 */
function Option({ title, initiallyOpen = false, children }: { title: string; initiallyOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(initiallyOpen);
  const id = useId();
  return (
    <>
      <div className="vbdOption" data-test-subj={`vbOption-${title.replace(/\s+/g, '-')}`}>
        <button type="button" className="vbdOption__title" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
          <Icon name="chevronRight" className={cx('vbdOption__arrow', open && 'vbdOption__arrow--open')} />
          <span>{title}</span>
        </button>
        <div id={id} className="vbdOption__content" hidden={!open}>
          <div className="vbdOption__panel">{children}</div>
        </div>
      </div>
      <hr className="vbdOption__rule" />
    </>
  );
}

function TypeOption({ type }: { type: VisBuilderType }) {
  return (
    <>
      <Icon name={type.icon} className="vbdPicker__icon" />
      <span className="vbdPicker__title">{type.title}</span>
    </>
  );
}

/**
 * The kind of chart, as the original's compressed super select: the icon of each before its name.
 * Its keys as there: an arrow on the control opens the list on the chosen kind, arrows move through
 * it and wrap, Tab stays in it, Escape or a choice closes it and gives the focus back.
 */
function TypePicker({ value, onChange }: { value: string; onChange: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  const control = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const current = visBuilderType(value);
  const items = () => Array.from(list.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []);

  const close = () => {
    if (list.current?.contains(document.activeElement)) control.current?.focus();
    setOpen(false);
  };

  const onControlKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    setOpen(true);
    requestAnimationFrame(() => {
      const options = items();
      (options.find((option) => option.getAttribute('aria-selected') === 'true') ?? options[0])?.focus();
    });
  };

  const onItemKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Tab') {
      event.preventDefault();
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    event.stopPropagation();
    const options = items();
    const at = options.indexOf(event.currentTarget);
    options[(at + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length]?.focus();
  };

  return (
    <Popover
      open={open}
      onClose={close}
      fitWidth
      anchorStyle={{ display: 'flex', width: '100%' }}
      className="vbdPicker__panel"
      button={
        <button
          ref={control}
          type="button"
          className="atlField vbdPicker"
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          onKeyDown={onControlKey}
          data-test-subj="chartPicker"
        >
          {current && <TypeOption type={current} />}
          <Icon name="chevronDown" size="s" className="vbdPicker__caret" />
        </button>
      }
    >
      <ul ref={list} className="vbdPicker__list" role="listbox" aria-label="Visualization type">
        {VIS_BUILDER_TYPES.map((type) => (
          <li key={type.name}>
            <button
              type="button"
              role="option"
              aria-selected={type.name === value}
              className="vbdPicker__option"
              onClick={() => {
                close();
                if (type.name !== value) onChange(type.name);
              }}
              onKeyDown={onItemKey}
              data-test-subj={`visType-${type.name}`}
            >
              <span className="vbdPicker__check">{type.name === value && <Icon name="check" />}</span>
              <span className="vbdPicker__text">
                <TypeOption type={type} />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Popover>
  );
}

interface StyleProps {
  style: StyleState;
  setStyle: (style: StyleState) => void;
}

/** The original's `SelectOption`: a compressed select under its label */
function SelectRow({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: unknown;
  options: ChoiceOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <ParamRow label={label} labelFor={id}>
      <SelectControl id={id} value={value === undefined || value === null ? undefined : String(value)} options={options} disabled={disabled} onChange={onChange} />
    </ParamRow>
  );
}

/** Bar, line and area: where the legend is and whether a tooltip shows */
function XYStyle({ style, setStyle }: StyleProps) {
  return (
    <Option title="Settings" initiallyOpen>
      <SelectRow
        label="Legend position"
        value={style.legendPosition}
        options={LEGEND_POSITIONS}
        onChange={(legendPosition) => setStyle({ ...style, legendPosition })}
      />
      <SwitchRow label="Show tooltip" checked={Boolean(style.addTooltip)} onChange={(addTooltip) => setStyle({ ...style, addTooltip })} />
    </Option>
  );
}

function MetricStyle({ style, setStyle }: StyleProps) {
  const get = (...path: string[]) => getIn(style, ['metric', ...path]);
  const set = (path: string[], value: unknown) => setStyle(setIn(style, ['metric', ...path], value));
  const ranges = (get('colorsRange') as Array<{ from?: number; to?: number }> | undefined) ?? [];
  const mode = String(get('metricColorMode') ?? 'None');
  const oneRange = ranges.length === 1;
  const fontSize = get('style', 'fontSize');
  const [fontSizeValid, setFontSizeValid] = useState(true);
  return (
    <>
      <Option title="Settings" initiallyOpen>
        <SwitchRow label="Percentage mode" checked={Boolean(get('percentageMode'))} onChange={(value) => set(['percentageMode'], value)} />
        <SwitchRow label="Show title" checked={Boolean(get('labels', 'show'))} onChange={(value) => set(['labels', 'show'], value)} />
      </Option>
      <Option title="Ranges">
        <ColorRanges ranges={ranges} onChange={(next) => set(['colorsRange'], next)} testId="metricColorRange" />
        <ParamRow label="Use color for">
          <ButtonGroup legend="Use color for" options={COLOR_MODES} selected={mode} disabled={oneRange} onChange={(value) => set(['metricColorMode'], value)} />
        </ParamRow>
        <SelectRow
          label="Color schema"
          value={get('colorSchema')}
          options={COLOR_SCHEMAS}
          disabled={oneRange || mode === 'None'}
          onChange={(value) => set(['colorSchema'], value)}
        />
        <SwitchRow
          label="Reverse schema"
          checked={Boolean(get('invertColors'))}
          disabled={oneRange || mode === 'None'}
          onChange={(value) => set(['invertColors'], value)}
        />
      </Option>
      <Option title="Style">
        <ParamRow label="Metric font size in points" invalid={!fontSizeValid} error={fontSizeValid ? undefined : 'Values must be on or between 12 and 120'}>
          <RangeControl
            min={12}
            max={120}
            value={typeof fontSize === 'number' ? fontSize : 60}
            showValue={false}
            showLabels
            showInput
            onValidity={setFontSizeValid}
            ariaLabel="Metric font size in points"
            onChange={(size) => set(['style', 'fontSize'], size)}
          />
        </ParamRow>
      </Option>
    </>
  );
}

function TableStyle({ style, setStyle }: StyleProps) {
  const perPage = style.perPage;
  const valid = perPage === '' || (typeof perPage === 'number' && perPage > 0);
  const id = useId();
  return (
    <Option title="Settings" initiallyOpen>
      <ParamRow
        label={<TipLabel label="Max rows per page" position="right" tip="Leaving this field empty means it will use number of buckets from the response." />}
        labelFor={id}
        invalid={!valid}
      >
        <NumberControl id={id} min={1} value={typeof perPage === 'number' ? perPage : ''} invalid={!valid} onChange={(value) => setStyle({ ...style, perPage: value })} />
      </ParamRow>
      <SwitchRow
        label="Show metrics for every bucket/level"
        checked={Boolean(style.showMetricsAtAllLevels)}
        onChange={(showMetricsAtAllLevels) => setStyle({ ...style, showMetricsAtAllLevels })}
        testId="showMetricsAtAllLevels"
      />
      <SwitchRow
        label="Show partial rows"
        tooltip="Show rows that have partial data. This will still calculate metrics for every bucket/level, even if they are not displayed."
        checked={Boolean(style.showPartialRows)}
        onChange={(showPartialRows) => setStyle({ ...style, showPartialRows })}
        testId="showPartialRows"
      />
    </Option>
  );
}

export function StylePanel({ state, update }: StylePanelProps) {
  const [confirm, setConfirm] = useState<{ name: string; aggs: AggConfig[] }>();
  const active = state.visualization.activeVisualization;
  const name = active?.name ?? '';
  const setStyle = (style: StyleState) => update((current) => ({ ...current, style }));

  const changeType = (next: string) => {
    const to = visBuilderType(next);
    if (!to) return;
    const aggs = active?.aggConfigParams ?? [];
    const kept = persistedAggs(aggs, visBuilderType(name), to);
    // Some aggregations have no place in the new kind: they are lost only once someone agrees
    if (kept.length < aggs.length) setConfirm({ name: next, aggs: kept });
    else update((current) => withType(current, next, kept));
  };

  let options: ReactNode = null;
  if (name === 'metric') options = <MetricStyle style={state.style} setStyle={setStyle} />;
  else if (name === 'table') options = <TableStyle style={state.style} setStyle={setStyle} />;
  else if (visBuilderType(name)) options = <XYStyle style={state.style} setStyle={setStyle} />;

  return (
    <section className={cx('vbdSide', 'vbdSide--right')} aria-label="Visualization type and settings">
      <div className="vbdSide__header">
        <TypePicker value={name} onChange={changeType} />
      </div>
      <div className="vbdSide__style">{options}</div>
      {confirm && (
        // The original's confirmation dialog, which takes the focus itself
        <Modal
          title="Change visualization type"
          onClose={() => setConfirm(undefined)}
          testId="confirmVisChangeModal"
          className="atlModal--confirm"
          footer={
            <>
              <Button variant="empty" onClick={() => setConfirm(undefined)} testId="confirmModalCancelButton">
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  const target = confirm;
                  setConfirm(undefined);
                  update((current) => withType(current, target.name, target.aggs));
                }}
                testId="confirmModalConfirmButton"
              >
                Change type
              </Button>
            </>
          }
        >
          <p className="vbdConfirm__text">
            Certain field configurations may be lost when changing visualization types and you may need to reconfigure those fields. Do you
            want to continue?
          </p>
        </Modal>
      )}
    </section>
  );
}

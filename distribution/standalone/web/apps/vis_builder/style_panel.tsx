/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The right of VisBuilder: the kind of chart, and the settings of that kind (`styleState`). A
 * change of kind keeps the aggregations the new kind has a place for, and asks first when some
 * would be lost.
 */

import { useState, type ReactNode } from 'react';
import type { AggConfig } from '../../lib/aggs';
import { RAMP_NAMES } from '../../charts/core';
import { cx } from '../../components/basic';
import { FormRow, NumberField, RangeField, Select, Switch } from '../../components/form';
import { Icon } from '../../components/icon';
import { ConfirmModal, Popover } from '../../components/overlay';
import { ColorRanges, getIn, setIn } from '../visualize/options';
import { persistedAggs, withType, type AppState } from './editor_state';
import { VIS_BUILDER_TYPES, visBuilderType, type StyleState, type VisBuilderType } from './model';

export interface StylePanelProps {
  state: AppState;
  update: (change: (state: AppState) => AppState) => void;
}

const LEGEND_POSITIONS = [
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

/** One group of settings: a title that opens and closes it over a tinted panel */
function Option({ title, initiallyOpen = false, children }: { title: string; initiallyOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <div className="vbdOption" data-test-subj={`vbOption-${title.replace(/\s+/g, '-')}`}>
      <button type="button" className="vbdOption__title" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name={open ? 'chevronDown' : 'chevronRight'} />
        <span>{title}</span>
      </button>
      {open && <div className="vbdOption__panel">{children}</div>}
    </div>
  );
}

/** A label with a mark that explains it on hover */
const WithTip = ({ label, tip }: { label: string; tip: string }) => (
  <span className="vbdTip">
    {label}
    <span title={tip} aria-label={tip} className="vbdTip__mark">
      <Icon name="info" />
    </span>
  </span>
);

function TypeOption({ type }: { type: VisBuilderType }) {
  return (
    <>
      <Icon name={type.icon} />
      <span>{type.title}</span>
    </>
  );
}

/** The kind of chart, as a list that shows the icon of each */
function TypePicker({ value, onChange }: { value: string; onChange: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  const current = visBuilderType(value);
  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      matchWidth
      anchorStyle={{ display: 'flex', width: '100%' }}
      button={
        <button
          type="button"
          className="atlField vbdPicker"
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          data-test-subj="chartPicker"
        >
          {current && <TypeOption type={current} />}
          <Icon name="chevronDown" className="vbdPicker__caret" />
        </button>
      }
    >
      <ul className="vbdPicker__list" role="listbox" aria-label="Visualization type">
        {VIS_BUILDER_TYPES.map((type) => (
          <li key={type.name}>
            <button
              type="button"
              role="option"
              aria-selected={type.name === value}
              className="vbdPicker__option"
              onClick={() => {
                setOpen(false);
                if (type.name !== value) onChange(type.name);
              }}
              data-test-subj={`visType-${type.name}`}
            >
              <span className="vbdPicker__check">{type.name === value && <Icon name="check" />}</span>
              <TypeOption type={type} />
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

/** Bar, line and area: where the legend is and whether a tooltip shows */
function XYStyle({ style, setStyle }: StyleProps) {
  return (
    <Option title="Settings" initiallyOpen>
      <FormRow label="Legend position" full>
        <Select
          value={String(style.legendPosition ?? 'right')}
          options={LEGEND_POSITIONS}
          onChange={(legendPosition) => setStyle({ ...style, legendPosition })}
        />
      </FormRow>
      <Switch checked={style.addTooltip !== false} onChange={(addTooltip) => setStyle({ ...style, addTooltip })} label="Show tooltip" />
    </Option>
  );
}

/** A choice of a few, side by side: it can be turned off as a whole */
function ButtonGroup({ value, disabled, onChange, label }: { value: string; disabled: boolean; onChange: (value: string) => void; label: string }) {
  return (
    <div className="atlSegments vbdSegments" role="group" aria-label={label}>
      {COLOR_MODES.map((mode) => (
        <button key={mode.id} type="button" className="atlSegment" aria-pressed={mode.id === value} disabled={disabled} onClick={() => onChange(mode.id)}>
          {mode.label}
        </button>
      ))}
    </div>
  );
}

function MetricStyle({ style, setStyle }: StyleProps) {
  const get = (...path: string[]) => getIn(style, ['metric', ...path]);
  const set = (path: string[], value: unknown) => setStyle(setIn(style, ['metric', ...path], value));
  const ranges = (get('colorsRange') as Array<{ from?: number; to?: number }> | undefined) ?? [];
  const mode = String(get('metricColorMode') ?? 'None');
  const oneRange = ranges.length === 1;
  const fontSize = Number(get('style', 'fontSize') ?? 60);
  return (
    <>
      <Option title="Settings" initiallyOpen>
        <Switch checked={get('percentageMode') === true} onChange={(value) => set(['percentageMode'], value)} label="Percentage mode" />
        <Switch checked={get('labels', 'show') !== false} onChange={(value) => set(['labels', 'show'], value)} label="Show title" />
      </Option>
      <Option title="Ranges">
        <ColorRanges ranges={ranges} onChange={(next) => set(['colorsRange'], next)} />
        <FormRow label="Use color for" full>
          <ButtonGroup label="Use color for" value={mode} disabled={oneRange} onChange={(value) => set(['metricColorMode'], value)} />
        </FormRow>
        <FormRow label="Color schema" full>
          <Select
            value={String(get('colorSchema') ?? 'Green to Red')}
            options={RAMP_NAMES.map((name) => ({ value: name, label: name }))}
            disabled={oneRange || mode === 'None'}
            onChange={(value) => set(['colorSchema'], value)}
            testId="colorSchema"
          />
        </FormRow>
        <Switch
          checked={get('invertColors') === true}
          disabled={oneRange || mode === 'None'}
          onChange={(value) => set(['invertColors'], value)}
          label="Reverse schema"
        />
      </Option>
      <Option title="Style">
        <FormRow label="Metric font size in points" full>
          <div className="vbdRange">
            <span className="atlSmall atlSubdued">12</span>
            <RangeField min={12} max={120} value={fontSize} onChange={(value) => set(['style', 'fontSize'], value)} />
            <span className="atlSmall atlSubdued">120</span>
            <NumberField
              min={12}
              max={120}
              value={fontSize}
              aria-label="Metric font size in points"
              onChange={(value) => value !== undefined && set(['style', 'fontSize'], value)}
            />
          </div>
        </FormRow>
      </Option>
    </>
  );
}

function TableStyle({ style, setStyle }: StyleProps) {
  const perPage = style.perPage;
  const valid = perPage === '' || (typeof perPage === 'number' && perPage > 0);
  return (
    <Option title="Settings" initiallyOpen>
      <FormRow
        label={<WithTip label="Max rows per page" tip="Leaving this field empty means it will use number of buckets from the response." />}
        full
      >
        <NumberField
          min={1}
          value={typeof perPage === 'number' ? perPage : ''}
          invalid={!valid}
          onChange={(value) => setStyle({ ...style, perPage: value ?? '' })}
        />
      </FormRow>
      <Switch
        checked={style.showMetricsAtAllLevels === true}
        onChange={(showMetricsAtAllLevels) => setStyle({ ...style, showMetricsAtAllLevels })}
        label="Show metrics for every bucket/level"
        testId="showMetricsAtAllLevels"
      />
      <Switch
        checked={style.showPartialRows === true}
        onChange={(showPartialRows) => setStyle({ ...style, showPartialRows })}
        label={
          <WithTip
            label="Show partial rows"
            tip="Show rows that have partial data. This will still calculate metrics for every bucket/level, even if they are not displayed."
          />
        }
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
        <ConfirmModal
          title="Change visualization type"
          confirmLabel="Change type"
          onCancel={() => setConfirm(undefined)}
          onConfirm={() => {
            const target = confirm;
            setConfirm(undefined);
            update((current) => withType(current, target.name, target.aggs));
          }}
        >
          <p>
            Certain field configurations may be lost when changing visualization types and you may need to reconfigure those fields. Do you
            want to continue?
          </p>
        </ConfirmModal>
      )}
    </section>
  );
}

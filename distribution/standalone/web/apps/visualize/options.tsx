/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The tabs of the editor that hold a visualization's settings, per kind: "Metrics & axes" and
 * "Panel settings" of a line, area or bar chart, "Options" of the others. They are laid out as the
 * original's: panels of the small padding with an extra small title, the compressed rows of the
 * Data tab, and spacers where it has them. The names of the settings and their values are those
 * OpenSearch Dashboards saves.
 */

import { Fragment, useEffect, useId, useState, type ReactNode } from 'react';
import { RAMP_NAMES } from '../../charts/core';
import { cx } from '../../components/basic';
import { Icon } from '../../components/icon';
import { TextArea } from '../../components/form';
import { ColorPickerPanel, cssColor, parseColor } from '../../components/color_picker';
import { Popover, Tooltip } from '../../components/overlay';
import { aggLabel, type AggConfig, type AggContext } from '../../lib/aggs';
import { ControlsOptions, ControlsTab } from './controls_editor';
import { axisName, nextAxisId, oppositeSide } from './defaults';
import {
  AddButton,
  ButtonGroup,
  NumberControl,
  ParamRow,
  RangeControl,
  SelectControl,
  SmallIconButton,
  SwitchRow,
  TextControl,
  TipLabel,
  type ChoiceOption,
} from './editor_controls';
import { RegionMapOptions } from './region_map/region_map_options';
import { TimelineOptions } from '../../vis/timeline/options';
import { TileMapOptions } from './maps/tile_map_options';
import { VegaSpecEditor } from './vega_editor';

export interface OptionsProps {
  type: string;
  params: Record<string, unknown>;
  setParams: (params: Record<string, unknown>) => void;
  aggs: AggConfig[];
  context: AggContext;
}

export interface OptionTab {
  id: string;
  label: string;
  render: (props: OptionsProps) => ReactNode;
}

type Path = Array<string | number>;

export function getIn(source: unknown, path: Path): unknown {
  let current = source;
  for (const key of path) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string | number, unknown>)[key];
  }
  return current;
}

/** A copy of an object with one value inside it replaced */
export function setIn<T>(source: T, path: Path, value: unknown): T {
  if (path.length === 0) return value as T;
  const [key, ...rest] = path;
  if (Array.isArray(source)) {
    const copy = [...source];
    copy[key as number] = setIn(copy[key as number], rest, value);
    return copy as unknown as T;
  }
  const base = (source !== null && typeof source === 'object' ? source : {}) as Record<string, unknown>;
  return { ...base, [key]: setIn(base[key as string], rest, value) } as T;
}

// --- The pieces every tab is made of --------------------------------------------------------------

function Spacer({ size }: { size: 'xs' | 's' | 'm' }) {
  return <div className={`vzeSpacer vzeSpacer--${size}`} />;
}

/** The original's panel with the small padding, its extra small title and what is beside it */
function Panel({ title, action, children, testId }: { title?: ReactNode; action?: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <section className="vzePanel vzeOptPanel" data-test-subj={testId}>
      {title !== undefined && (
        <div className={cx('vzeOptPanel__head', action !== undefined && 'vzeOptPanel__head--action')}>
          <h3 className="vzePanel__title">{title}</h3>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/** The extra extra small title inside a panel: "Labels" */
function Subtitle({ children }: { children: ReactNode }) {
  return <h3 className="vzeOptSubtitle">{children}</h3>;
}

function Rule({ margin }: { margin: 's' | 'm' }) {
  return <hr className={`vzeRule vzeRule--${margin}`} />;
}

/** Two rows side by side, 8px apart */
function Halves({ children }: { children: ReactNode }) {
  return <div className="vzeHalves">{children}</div>;
}

/** A section that opens, as a series or an axis: the accordion of the Data tab's aggregations */
function Section({
  title,
  initiallyOpen = false,
  extra,
  ariaLabel,
  testId,
  children,
}: {
  title: ReactNode;
  initiallyOpen?: boolean;
  extra?: ReactNode;
  ariaLabel?: string;
  testId?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const id = useId();
  return (
    <div className="vzeSection" aria-label={ariaLabel} data-test-subj={testId}>
      <div className="vzeAgg__trigger">
        <button type="button" className="vzeAgg__button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
          <span className={cx('vzeArrow', open && 'vzeArrow--open')}>
            <Icon name="chevronRight" />
          </span>
          <span className="vzeAgg__title atlTruncate">{title}</span>
        </button>
        {extra && <div className="vzeAgg__actions">{extra}</div>}
      </div>
      {open && (
        <div id={id} role="region" className="vzeSection__content">
          {children}
        </div>
      )}
    </div>
  );
}

const options = (pairs: Array<[string, string]>): ChoiceOption[] => pairs.map(([value, label]) => ({ value, label }));

const POSITIONS = options([
  ['top', 'Top'],
  ['left', 'Left'],
  ['right', 'Right'],
  ['bottom', 'Bottom'],
]);
const CHART_TYPES = options([
  ['line', 'Line'],
  ['area', 'Area'],
  ['histogram', 'Bar'],
]);
const CHART_MODES = options([
  ['normal', 'Normal'],
  ['stacked', 'Stacked'],
]);
const LINE_MODES = options([
  ['linear', 'Straight'],
  ['cardinal', 'Smoothed'],
  ['step-after', 'Stepped'],
]);
const AXIS_MODES = options([
  ['normal', 'Normal'],
  ['percentage', 'Percentage'],
  ['wiggle', 'Wiggle'],
  ['silhouette', 'Silhouette'],
]);
const SCALE_TYPES = options([
  ['linear', 'Linear'],
  ['log', 'Log'],
  ['square root', 'Square root'],
]);
const ROTATIONS = options([
  ['0', 'Horizontal'],
  ['90', 'Vertical'],
  ['75', 'Angled'],
]);
const LINE_STYLES = options([
  ['full', 'Full'],
  ['dashed', 'Dashed'],
  ['dot-dashed', 'Dot-dashed'],
]);
const COLOR_SCHEMAS = RAMP_NAMES.map((name) => ({ value: name, label: name }));

/** The rows of one tab, bound to the settings by the path of each, as the original's options */
function useFields({ params, setParams }: OptionsProps) {
  const set = (path: Path, value: unknown) => setParams(setIn(params, path, value));
  const text = (value: unknown) => (value === undefined || value === null ? undefined : String(value));
  return {
    set,
    /** `SwitchOption`: a row with a compressed switch, what it does on the right after a while */
    toggle: (label: string, path: Path, extra: { disabled?: boolean; testId?: string; tooltip?: ReactNode } = {}) => (
      <SwitchRow
        label={label}
        checked={Boolean(getIn(params, path))}
        onChange={(value) => set(path, value)}
        disabled={extra.disabled}
        testId={extra.testId}
        tooltip={extra.tooltip}
      />
    ),
    /** `SelectOption`: with no value it starts on the original's empty, hidden choice */
    select: (
      label: ReactNode,
      path: Path,
      choices: ChoiceOption[],
      extra: { id?: string; numeric?: boolean; disabled?: boolean; testId?: string; help?: ReactNode; value?: string; onChange?: (value: string) => void } = {}
    ) => {
      const id = extra.id ?? `vzeOpt-${path.join('-')}`;
      return (
        <ParamRow label={label} labelFor={id} help={extra.help}>
          <SelectControl
            id={id}
            value={extra.value ?? text(getIn(params, path))}
            options={choices}
            disabled={extra.disabled}
            onChange={extra.onChange ?? ((value) => set(path, extra.numeric ? Number(value) : value))}
            testId={extra.testId}
          />
        </ParamRow>
      );
    },
    /** `NumberInputOption`: an emptied field is saved as '' */
    number: (
      label: ReactNode,
      path: Path,
      extra: { min?: number; max?: number; step?: number; disabled?: boolean; invalid?: boolean; error?: ReactNode; testId?: string; empty?: '' | null } = {}
    ) => {
      const id = `vzeOpt-${path.join('-')}`;
      const value = getIn(params, path);
      return (
        <ParamRow label={label} labelFor={id} invalid={extra.invalid} error={extra.invalid ? extra.error : undefined}>
          <NumberControl
            id={id}
            value={typeof value === 'number' ? value : ''}
            min={extra.min}
            max={extra.max}
            step={extra.step}
            disabled={extra.disabled}
            invalid={extra.invalid}
            onChange={(next) => set(path, next === '' ? (extra.empty === undefined ? '' : extra.empty) : next)}
            testId={extra.testId}
          />
        </ParamRow>
      );
    },
    /** `TextInputOption` */
    text: (label: string, path: Path, extra: { disabled?: boolean; testId?: string } = {}) => {
      const id = `vzeOpt-${path.join('-')}`;
      return (
        <ParamRow label={label} labelFor={id}>
          <TextControl id={id} value={String(getIn(params, path) ?? '')} disabled={extra.disabled} onChange={(value) => set(path, value)} testId={extra.testId} />
        </ParamRow>
      );
    },
  };
}

interface ColorRange {
  from?: number;
  to?: number;
}

/**
 * The ranges a gauge, a metric or a heat map takes its colours by: the range aggregation's rows,
 * without placeholders. A new range starts where the last one ends and is as wide.
 */
export function ColorRanges({ ranges, onChange, testId = 'range' }: { ranges: ColorRange[]; onChange: (ranges: ColorRange[]) => void; testId?: string }) {
  const set = (index: number, patch: ColorRange) => onChange(ranges.map((range, at) => (at === index ? { ...range, ...patch } : range)));
  // Each range starts at or after the end of the one before and ends at or after its start
  const wrong = (range: ColorRange, index: number): [boolean, boolean] => {
    const before = index === 0 ? -Infinity : (ranges[index - 1].to ?? 0);
    const from = range.from ?? 0;
    return [!(from >= before), !((range.to ?? 0) >= from)];
  };
  const invalid = ranges.some((range, index) => wrong(range, index).some(Boolean));
  const shown = (value: number | undefined) => (value === undefined ? '' : String(value));
  // As the original, a list without ranges gets its first one as soon as it is drawn
  useEffect(() => {
    if (!ranges.length) onChange([{ from: 0, to: 100 }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ranges.length]);
  return (
    <ParamRow>
      {ranges.map((range, index) => {
        const [badFrom, badTo] = wrong(range, index);
        const label = `Remove the range of ${shown(range.from) || '−∞'} to ${shown(range.to) || '+∞'}`;
        return (
          <Fragment key={index}>
            <div className="vzeRangeRow">
              <NumberControl
                prepend={<PrependTip text="≥" tip="Greater than or equal to" />}
                value={range.from}
                ariaLabel="From"
                invalid={badFrom}
                onChange={(from) => set(index, { from: from === '' ? undefined : from })}
                testId={`${testId}${index}__from`}
              />
              <Icon name="arrowRight" className="vzeRangeRow__arrow" />
              <NumberControl
                prepend={<PrependTip text="<" tip="Less than" />}
                value={range.to}
                ariaLabel="To"
                invalid={badTo}
                onChange={(to) => set(index, { to: to === '' ? undefined : to })}
                testId={`${testId}${index}__to`}
              />
              <SmallIconButton
                icon="trash"
                danger
                label={label}
                title={label}
                disabled={ranges.length === 1}
                onClick={() => onChange(ranges.filter((_, at) => at !== index))}
              />
            </div>
            <Spacer size="xs" />
          </Fragment>
        );
      })}
      {invalid && <div className="vzeRow__error">Each range should be greater than previous.</div>}
      <Spacer size="s" />
      <AddButton
        block
        onClick={() => {
          const last = ranges[ranges.length - 1] ?? {};
          const from = last.to ? last.to : 0;
          const to = last.to ? from + (last.to - (last.from || 0)) : 100;
          onChange([...ranges, { from, to }]);
        }}
        testId={`${testId}__addRangeButton`}
      >
        Add range
      </AddButton>
    </ParamRow>
  );
}

function PrependTip({ text, tip }: { text: string; tip: string }) {
  return (
    <Tooltip content={tip}>
      <span>{text}</span>
    </Tooltip>
  );
}

/** `ColorSchemaOptions`: the schema, how to change one colour, and its reverse */
function ColorSchema({ props, base, disabled, help = true }: { props: OptionsProps; base: Path; disabled?: boolean; help?: boolean }) {
  const fields = useFields(props);
  return (
    <>
      {fields.select('Color schema', [...base, 'colorSchema'], COLOR_SCHEMAS, {
        disabled,
        help: help ? 'Individual colors can be changed in the legend.' : undefined,
      })}
      {fields.toggle('Reverse schema', [...base, 'invertColors'], { disabled })}
    </>
  );
}

/**
 * `EuiColorPicker`, compressed and full width: the colour's code in capitals, its swatch before it
 * and an arrow after it. A click, or the down key, opens the picker under it; the code is typed in
 * the field itself.
 */
function ColorField({ value, onChange, disabled }: { value: string; onChange: (value: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const rgba = parseColor(value);
  // As the original, a colour is a hex code or its channels, and opaque
  const valid = rgba !== undefined && rgba[3] === 1;
  const shown = open && !disabled;
  return (
    <Popover
      open={shown}
      onClose={() => setOpen(false)}
      anchorStyle={{ display: 'flex' }}
      button={
        <span className={cx('atlField', 'vzeControl', 'vzeColorField', disabled && 'vzeColorField--disabled')}>
          <svg className="vzeColorField__swatch" viewBox="0 0 16 16" aria-hidden="true" style={{ color: valid ? cssColor(value) : undefined }}>
            {valid ? (
              <>
                <rect width="12" height="12" x="2" y="2" rx="3" />
                <rect width="11" height="11" x="2.5" y="2.5" rx="2" className="vzeColorField__stroke" />
              </>
            ) : (
              <path d="M12.259 3.034A1.001 1.001 0 0 0 12 3H4a1 1 0 0 0-1 1v8c0 .09.012.176.034.259l9.225-9.225Zm.707.707-9.225 9.225c.083.022.17.034.259.034h8a1 1 0 0 0 1-1V4c0-.09-.012-.176-.034-.259ZM4 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z" />
            )}
          </svg>
          <input
            type="text"
            value={value.toUpperCase()}
            placeholder={value ? undefined : 'Transparent'}
            disabled={disabled}
            autoComplete="off"
            aria-label={shown ? 'Press the escape key to close the popover' : 'Press the down key to open a popover containing color options'}
            onClick={() => setOpen(true)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setOpen(true);
              }
            }}
            onChange={(event) => onChange(event.target.value)}
            data-test-subj="euiColorPickerAnchor"
          />
          <Icon name="chevronDown" className="vzeColorField__arrow" />
        </span>
      }
    >
      <ColorPickerPanel color={value} onChange={(text) => onChange(text)} showInput={false} onPicked={() => setOpen(false)} />
    </Popover>
  );
}

/** The labels of an axis: shown, filtered, how they are turned and where they are cut */
function LabelOptions({ props, base, filterTestId }: { props: OptionsProps; base: Path; filterTestId: string }) {
  const fields = useFields(props);
  const shown = Boolean(getIn(props.params, [...base, 'show']));
  const truncate = getIn(props.params, [...base, 'truncate']);
  return (
    <>
      <Spacer size="m" />
      <Subtitle>Labels</Subtitle>
      <Spacer size="s" />
      {fields.toggle('Show labels', [...base, 'show'])}
      {fields.toggle('Filter labels', [...base, 'filter'], { disabled: !shown, testId: filterTestId })}
      <Spacer size="m" />
      <Halves>
        {fields.select('Align', [...base, 'rotate'], ROTATIONS, { numeric: true, disabled: !shown })}
        <TruncateOption value={typeof truncate === 'number' ? truncate : null} disabled={!shown} onChange={(value) => fields.set([...base, 'truncate'], value)} />
      </Halves>
    </>
  );
}

/** "Truncate": an emptied field is saved as nothing */
function TruncateOption({ value, disabled, onChange }: { value: number | null; disabled?: boolean; onChange: (value: number | null) => void }) {
  const id = useId();
  return (
    <ParamRow label="Truncate" labelFor={id}>
      <NumberControl id={id} value={value} disabled={disabled} onChange={(next) => onChange(next === '' ? null : next)} />
    </ParamRow>
  );
}

// --- Line, area and bar charts --------------------------------------------------------------------

interface SeriesParam {
  show?: boolean;
  type?: string;
  mode?: string;
  data?: { id?: string; label?: string };
  valueAxis?: string;
  interpolate?: string;
  drawLinesBetweenPoints?: boolean;
  showCircles?: boolean;
  lineWidth?: number;
}

interface Scale {
  type?: string;
  mode?: string;
  defaultYExtents?: boolean;
  boundsMargin?: number | '';
  setYExtents?: boolean;
  min?: number | null;
  max?: number | null;
}

interface ValueAxis {
  id: string;
  name?: string;
  position?: string;
  show?: boolean;
  scale?: Scale;
  labels?: { show?: boolean; rotate?: number; filter?: boolean; truncate?: number | null };
  title?: { text?: string };
}

const isHorizontal = (position: string | undefined) => position === 'top' || position === 'bottom';

/** "Metrics": each series in a section of its own, the first open */
function SeriesPanel({ props, series, axes }: { props: OptionsProps; series: SeriesParam[]; axes: ValueAxis[] }) {
  const { params, setParams } = props;
  const fields = useFields(props);
  const addAxis = (): { axes: ValueAxis[]; id: string } => {
    const first = axes[0];
    const position = oppositeSide(first?.position ?? 'left');
    const id = nextAxisId(axes);
    const added: ValueAxis = { ...(JSON.parse(JSON.stringify(first ?? {})) as ValueAxis), id, position, name: axisName(position, axes) };
    return { axes: [...axes, added], id };
  };
  return (
    <Panel title="Metrics">
      <Spacer size="s" />
      {series.map((item, index) => {
        const label = item.data?.label ?? '';
        const type = item.type ?? 'line';
        const path = (key: string): Path => ['seriesParams', index, key];
        return (
          <Section
            key={index}
            title={label}
            initiallyOpen={index === 0}
            ariaLabel={`Toggle ${label} options`}
            testId={`visEditorSeriesAccordion${item.data?.id ?? index}`}
          >
            <Spacer size="m" />
            {fields.select('Value axis', path('valueAxis'), [...axes.map((axis) => ({ value: axis.id, label: axis.name ?? axis.id })), { value: 'new', label: 'New axis…' }], {
              id: `seriesValueAxis${index}`,
              onChange: (value) => {
                if (value !== 'new') {
                  setParams(setIn(params, path('valueAxis'), value));
                  return;
                }
                const added = addAxis();
                setParams({ ...setIn(params, path('valueAxis'), added.id), valueAxes: added.axes });
              },
            })}
            <Spacer size="m" />
            <Halves>
              {fields.select('Chart type', path('type'), CHART_TYPES, { id: `seriesType${index}` })}
              {fields.select('Mode', path('mode'), CHART_MODES, { id: `seriesMode${index}` })}
            </Halves>
            {type === 'area' && (
              <>
                <Spacer size="m" />
                {fields.select('Line mode', path('interpolate'), LINE_MODES)}
              </>
            )}
            {type === 'line' && (
              <>
                <Spacer size="m" />
                {fields.toggle('Show line', path('drawLinesBetweenPoints'))}
                <Spacer size="m" />
                <Halves>
                  {fields.select('Line mode', path('interpolate'), LINE_MODES, { disabled: !item.drawLinesBetweenPoints })}
                  {fields.number('Line width', path('lineWidth'), { min: 0, step: 0.5, disabled: !item.drawLinesBetweenPoints })}
                </Halves>
                <Spacer size="m" />
                {fields.toggle('Show dots', path('showCircles'))}
              </>
            )}
          </Section>
        );
      })}
    </Panel>
  );
}

/** "Custom extents": scaled to the data with a margin, or set between a min and a max */
function CustomExtents({ props, index, axis }: { props: OptionsProps; index: number; axis: ValueAxis }) {
  const { params, setParams } = props;
  const fields = useFields(props);
  const scale = axis.scale ?? {};
  const setScale = (next: Scale) => setParams(setIn(params, ['valueAxes', index, 'scale'], next));
  const margin = scale.boundsMargin;
  const marginValid = margin === undefined || margin === '' || margin >= 0;
  const errors: string[] = [];
  const min = typeof scale.min === 'number' ? scale.min : undefined;
  const max = typeof scale.max === 'number' ? scale.max : undefined;
  if (min !== undefined && max !== undefined && min >= max) errors.push('Min should be less than Max.');
  if (scale.type === 'log' && (min === undefined || min <= 0)) errors.push('Min must exceed 0 when a log scale is selected.');
  // As the original, only Min is drawn invalid
  const extent = (key: 'min' | 'max', label: string, testId: string) => (
    <ParamRow label={label} invalid={key === 'min' && errors.length > 0}>
      <NumberControl
        value={scale[key] ?? ''}
        step={0.1}
        invalid={key === 'min' && errors.length > 0}
        onChange={(value) => setScale({ ...scale, [key]: value === '' ? null : value })}
        testId={testId}
      />
    </ParamRow>
  );
  return (
    <>
      <SwitchRow
        label="Scale to data bounds"
        checked={Boolean(scale.defaultYExtents)}
        onChange={(value) => {
          const next: Scale = { ...scale, defaultYExtents: value };
          if (!value) delete next.boundsMargin;
          setScale(next);
        }}
      />
      {scale.defaultYExtents &&
        fields.number('Bounds margin', ['valueAxes', index, 'scale', 'boundsMargin'], {
          min: 0,
          step: 0.1,
          invalid: !marginValid,
          error: 'Bounds margin must be greater than or equal to 0.',
        })}
      <SwitchRow
        label="Set axis extents"
        checked={Boolean(scale.setYExtents)}
        testId="yAxisSetYExtents"
        onChange={(value) => {
          const next: Scale = { ...scale, setYExtents: value };
          if (!value) {
            delete next.min;
            delete next.max;
          }
          setScale(next);
        }}
      />
      {scale.setYExtents && (
        <ParamRow error={errors}>
          <Halves>
            {extent('min', 'Min', 'yAxisYExtentsMin')}
            {extent('max', 'Max', 'yAxisYExtentsMax')}
          </Halves>
        </ParamRow>
      )}
    </>
  );
}

/** "Y-axes": an axis per section, closed; one can be added, and removed while there are two */
function ValueAxesPanel({ props, series, axes }: { props: OptionsProps; series: SeriesParam[]; axes: ValueAxis[] }) {
  const { params, setParams } = props;
  const fields = useFields(props);
  const categoryHorizontal = isHorizontal(String(getIn(params, ['categoryAxes', 0, 'position']) ?? 'bottom'));
  const addAxis = () => {
    const first = axes[0];
    const position = oppositeSide(first?.position ?? 'left');
    const added: ValueAxis = { ...(JSON.parse(JSON.stringify(first ?? {})) as ValueAxis), id: nextAxisId(axes), position, name: axisName(position, axes) };
    setParams({ ...params, valueAxes: [...axes, added] });
  };
  const remove = (axis: ValueAxis) => {
    const kept = axes.filter((other) => other.id !== axis.id);
    setParams({
      ...params,
      valueAxes: kept,
      seriesParams: series.map((item) => (item.valueAxis === axis.id ? { ...item, valueAxis: kept[0].id } : item)),
    });
  };
  return (
    <Panel
      title="Y-axes"
      action={
        <Tooltip content="Add Y-axis" position="bottom">
          <SmallIconButton icon="plusInCircleFilled" primary label="Add Y-axis" onClick={addAxis} testId="visualizeAddYAxisButton" />
        </Tooltip>
      }
    >
      <Spacer size="s" />
      {axes.map((axis, index) => {
        const described = series
          .filter((item) => item.valueAxis === axis.id)
          .map((item) => item.data?.label)
          .join(', ');
        const shown = Boolean(axis.show);
        const positions = POSITIONS.map((option) => ({
          ...option,
          disabled: categoryHorizontal ? isHorizontal(option.value) : !['left', 'right'].includes(option.value),
        }));
        return (
          <Section
            key={axis.id}
            title={
              <>
                {axis.name}{' '}
                <Tooltip content={described}>
                  <span className="vzeAgg__description">{described}</span>
                </Tooltip>
              </>
            }
            ariaLabel={`Toggle ${axis.name ?? ''} options`}
            testId={`toggleYAxisOptions-${axis.id}`}
            extra={
              axes.length === 1 ? undefined : (
                <Tooltip content="Remove Y-axis" position="bottom">
                  <SmallIconButton icon="cross" danger label="Remove Y-axis" onClick={() => remove(axis)} testId="removeValueAxisBtn" />
                </Tooltip>
              )
            }
          >
            <Spacer size="m" />
            {fields.select('Position', ['valueAxes', index, 'position'], positions, {
              onChange: (position) =>
                setParams(setIn(params, ['valueAxes', index], { ...axis, position, name: axisName(position, axes.filter((other) => other.id !== axis.id)) })),
            })}
            {fields.select('Mode', ['valueAxes', index, 'scale', 'mode'], AXIS_MODES, { id: `valueAxisMode${index}` })}
            {fields.select('Scale type', ['valueAxes', index, 'scale', 'type'], SCALE_TYPES, { id: `scaleSelectYAxis-${axis.id}` })}
            <Rule margin="m" />
            {fields.toggle('Show axis lines and labels', ['valueAxes', index, 'show'], { testId: `valueAxisShow-${axis.id}` })}
            {shown ? (
              <>
                <Spacer size="m" />
                {fields.text('Title', ['valueAxes', index, 'title', 'text'], { testId: `valueAxisTitle${index}` })}
                <LabelOptions props={props} base={['valueAxes', index, 'labels']} filterTestId={`yAxisFilterLabelsCheckbox-${axis.id}`} />
              </>
            ) : (
              <Spacer size="xs" />
            )}
            <Rule margin="s" />
            <Section title="Custom extents" ariaLabel="Toggle custom extents">
              <Spacer size="m" />
              <CustomExtents props={props} index={index} axis={axis} />
            </Section>
          </Section>
        );
      })}
    </Panel>
  );
}

/** "X-axis": where the buckets go */
function CategoryAxisPanel({ props }: { props: OptionsProps }) {
  const fields = useFields(props);
  const shown = Boolean(getIn(props.params, ['categoryAxes', 0, 'show']));
  const id = String(getIn(props.params, ['categoryAxes', 0, 'id']) ?? '');
  return (
    <Panel title="X-axis">
      <Spacer size="s" />
      {fields.select('Position', ['categoryAxes', 0, 'position'], POSITIONS, { testId: 'categoryAxisPosition' })}
      {fields.toggle('Show axis lines and labels', ['categoryAxes', 0, 'show'])}
      {shown && <LabelOptions props={props} base={['categoryAxes', 0, 'labels']} filterTestId={`xAxisFilterLabelsCheckbox${id}`} />}
    </Panel>
  );
}

function MetricsAxes(props: OptionsProps) {
  const series = (Array.isArray(props.params.seriesParams) ? props.params.seriesParams : []) as SeriesParam[];
  const axes = (Array.isArray(props.params.valueAxes) ? props.params.valueAxes : []) as ValueAxis[];
  return (
    <>
      <SeriesPanel props={props} series={series} axes={axes} />
      <ValueAxesPanel props={props} series={series} axes={axes} />
      <CategoryAxisPanel props={props} />
    </>
  );
}

/** "Basic options": where the legend is and whether the tooltip shows */
function BasicOptions({ props }: { props: OptionsProps }) {
  const fields = useFields(props);
  return (
    <>
      {fields.select('Legend position', ['legendPosition'], POSITIONS)}
      {fields.toggle('Show tooltip', ['addTooltip'])}
    </>
  );
}

function PanelSettings(props: OptionsProps) {
  const { params, setParams, aggs } = props;
  const fields = useFields(props);
  const axes = (Array.isArray(params.valueAxes) ? params.valueAxes : []) as ValueAxis[];
  const series = (Array.isArray(params.seriesParams) ? params.seriesParams : []) as SeriesParam[];
  const segment = aggs.filter((agg) => agg.schema === 'segment' && agg.enabled !== false);
  const onTime = segment.some((agg) => agg.type === 'date_histogram');
  const histogram = segment.some((agg) => agg.type === 'histogram');
  const categoryLines = Boolean(getIn(params, ['grid', 'categoryLines']));
  // As the original, a histogram on the X-axis turns its lines off
  useEffect(() => {
    if (histogram && categoryLines) setParams(setIn(params, ['grid', 'categoryLines'], false));
  }, [histogram, categoryLines, params, setParams]);
  const threshold = getIn(params, ['thresholdLine']) as { show?: boolean; value?: number | null; width?: number | null; style?: string; color?: string } | undefined;
  return (
    <>
      <Panel title="Settings">
        <Spacer size="m" />
        <BasicOptions props={props} />
        {onTime ? fields.toggle('Current time marker', ['addTimeMarker']) : fields.toggle('Order buckets by sum', ['orderBucketsBySum'])}
        {series.some((item) => item.type === 'histogram') && fields.toggle('Show values on chart', ['labels', 'show'], { testId: 'showValuesOnChart' })}
      </Panel>
      <Panel title="Grid">
        <Spacer size="m" />
        {fields.toggle('Show X-axis lines', ['grid', 'categoryLines'], {
          disabled: histogram,
          tooltip: histogram ? "X-axis lines can't show for histograms." : undefined,
          testId: 'showCategoryLines',
        })}
        {fields.select('Y-axis lines', ['grid', 'valueAxis'], [...axes.map((axis) => ({ value: axis.id, label: axis.name ?? axis.id })), { value: '', label: "Don't show" }], {
          id: 'gridAxis',
          value: String(getIn(params, ['grid', 'valueAxis']) || ''),
          onChange: (value) => setParams(setIn(params, ['grid', 'valueAxis'], value)),
        })}
      </Panel>
      {threshold && (
        <Panel title="Threshold line">
          <Spacer size="m" />
          {fields.toggle('Show threshold line', ['thresholdLine', 'show'])}
          {threshold.show && (
            <>
              {fields.number('Threshold value', ['thresholdLine', 'value'], { empty: null })}
              {fields.number('Line width', ['thresholdLine', 'width'], { min: 1, step: 1, empty: null })}
              {fields.select('Line style', ['thresholdLine', 'style'], LINE_STYLES)}
              <ParamRow label="Line color">
                <ColorField value={String(threshold.color ?? '')} onChange={(color) => setParams(setIn(params, ['thresholdLine', 'color'], color))} />
              </ParamRow>
            </>
          )}
        </Panel>
      )}
    </>
  );
}

// --- The other kinds ------------------------------------------------------------------------------

function PieOptions(props: OptionsProps) {
  const { params, setParams } = props;
  const fields = useFields(props);
  const truncate = getIn(params, ['labels', 'truncate']);
  return (
    <>
      <Panel title="Pie settings">
        <Spacer size="s" />
        {fields.toggle('Donut', ['isDonut'])}
        <BasicOptions props={props} />
      </Panel>
      <Panel title="Labels settings">
        <Spacer size="s" />
        {fields.toggle('Show labels', ['labels', 'show'])}
        {fields.toggle('Show top level only', ['labels', 'last_level'])}
        {fields.toggle('Show values', ['labels', 'values'])}
        <TruncateOption value={typeof truncate === 'number' ? truncate : null} onChange={(value) => setParams(setIn(params, ['labels', 'truncate'], value))} />
      </Panel>
    </>
  );
}

const COLOR_MODES = [
  { id: 'None', label: 'None' },
  { id: 'Labels', label: 'Labels' },
  { id: 'Background', label: 'Background' },
];

function MetricOptions(props: OptionsProps) {
  const { params, setParams } = props;
  const fields = useFields(props);
  const mode = String(getIn(params, ['metric', 'metricColorMode']) ?? 'None');
  const ranges = (getIn(params, ['metric', 'colorsRange']) as ColorRange[] | undefined) ?? [];
  const fontSize = getIn(params, ['metric', 'style', 'fontSize']);
  const [fontSizeValid, setFontSizeValid] = useState(true);
  return (
    <>
      <Panel title="Settings">
        <Spacer size="s" />
        {fields.toggle('Percentage mode', ['metric', 'percentageMode'])}
        {fields.toggle('Show title', ['metric', 'labels', 'show'])}
      </Panel>
      <Panel title="Ranges">
        <Spacer size="s" />
        <ColorRanges ranges={ranges} onChange={(next) => setParams(setIn(params, ['metric', 'colorsRange'], next))} testId="metricColorRange" />
        <ParamRow label="Use color for">
          <ButtonGroup
            legend="Use color for"
            options={COLOR_MODES}
            selected={mode}
            disabled={ranges.length === 1}
            onChange={(next) => setParams(setIn(params, ['metric', 'metricColorMode'], next))}
          />
        </ParamRow>
        <ColorSchema props={props} base={['metric']} disabled={ranges.length === 1 || mode === 'None'} help={false} />
      </Panel>
      <Panel title="Style">
        <Spacer size="s" />
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
            onChange={(size) => setParams(setIn(params, ['metric', 'style', 'fontSize'], size))}
          />
        </ParamRow>
      </Panel>
    </>
  );
}

function GaugeOptions(props: OptionsProps) {
  const { params, setParams } = props;
  const fields = useFields(props);
  const ranges = (getIn(params, ['gauge', 'colorsRange']) as ColorRange[] | undefined) ?? [];
  const labels = Boolean(getIn(params, ['gauge', 'labels', 'show']));
  return (
    <>
      <Panel title="Style">
        <Spacer size="s" />
        {fields.select(
          'Gauge type',
          ['gauge', 'gaugeType'],
          options([
            ['Arc', 'Arc'],
            ['Circle', 'Circle'],
          ])
        )}
        {/* The original means to turn it off for one metric without buckets, but its test never holds */}
        {fields.select(
          'Alignment',
          ['gauge', 'alignment'],
          options([
            ['automatic', 'Automatic'],
            ['horizontal', 'Horizontal'],
            ['vertical', 'Vertical'],
          ])
        )}
      </Panel>
      <Panel title="Ranges">
        <Spacer size="s" />
        <ColorRanges ranges={ranges} onChange={(next) => setParams(setIn(params, ['gauge', 'colorsRange'], next))} testId="gaugeColorRange" />
        {fields.toggle('Auto extend range', ['gauge', 'extendRange'], {
          disabled: ranges.length < 2,
          tooltip: 'Extends range to the maximum value in your data.',
        })}
        {fields.toggle('Percentage mode', ['gauge', 'percentageMode'], { testId: 'gaugePercentageMode' })}
        <ColorSchema props={props} base={['gauge']} disabled={ranges.length < 2} />
        {fields.toggle('Show outline', ['gauge', 'outline'])}
        {fields.toggle('Show legend', ['addLegend'])}
        {fields.toggle('Show scale', ['gauge', 'scale', 'show'])}
      </Panel>
      <Panel title="Labels">
        <Spacer size="s" />
        {fields.toggle('Show labels', ['gauge', 'labels', 'show'])}
        <Spacer size="s" />
        {fields.text('Sub label', ['gauge', 'style', 'subText'], { disabled: !labels })}
        {fields.toggle('Display warnings', ['isDisplayWarning'], {
          disabled: !labels,
          tooltip: 'Turns on/off warnings. When turned on, a warning will be shown if not all labels could be displayed.',
        })}
      </Panel>
    </>
  );
}

const VERTICAL_ROTATION = 270;

function HeatmapOptions(props: OptionsProps) {
  const { params, setParams } = props;
  const fields = useFields(props);
  const custom = Boolean(params.setColorRange);
  const ranges = (params.colorsRange as ColorRange[] | undefined) ?? [];
  const colors = params.colorsNumber;
  const colorsInvalid = typeof colors !== 'number' || colors < 2 || colors > 10;
  const labels = (getIn(params, ['valueAxes', 0, 'labels']) ?? {}) as { show?: boolean; rotate?: number; overwriteColor?: boolean; color?: string };
  return (
    <>
      <Panel title="Basic settings">
        <Spacer size="s" />
        <BasicOptions props={props} />
        {fields.toggle('Highlight range', ['enableHover'], { tooltip: 'Highlight hovered range in the chart and corresponding label in the legend.' })}
      </Panel>
      <Panel title="Heatmap settings">
        <Spacer size="s" />
        <ColorSchema props={props} base={[]} />
        <Spacer size="s" />
        {fields.select('Color scale', ['valueAxes', 0, 'scale', 'type'], SCALE_TYPES)}
        {fields.toggle('Scale to data bounds', ['valueAxes', 0, 'scale', 'defaultYExtents'])}
        {fields.toggle('Percentage mode', ['percentageMode'], { disabled: custom })}
        <Spacer size="s" />
        {fields.number('Number of colors', ['colorsNumber'], { min: 2, max: 10, disabled: custom, invalid: colorsInvalid, testId: 'heatmapColorsNumber' })}
        {fields.toggle('Use custom ranges', ['setColorRange'], { testId: 'heatmapUseCustomRanges' })}
        {custom && <ColorRanges ranges={ranges} onChange={(next) => setParams({ ...params, colorsRange: next })} testId="heatmapColorRange" />}
      </Panel>
      <Panel title="Labels">
        <Spacer size="s" />
        {fields.toggle('Show labels', ['valueAxes', 0, 'labels', 'show'])}
        <SwitchRow
          label="Rotate"
          checked={labels.rotate === VERTICAL_ROTATION}
          disabled={!labels.show}
          onChange={(value) => setParams(setIn(params, ['valueAxes', 0, 'labels', 'rotate'], value ? VERTICAL_ROTATION : 0))}
        />
        {fields.toggle('Overwrite automatic color', ['valueAxes', 0, 'labels', 'overwriteColor'], { disabled: !labels.show })}
        <ParamRow label="Color">
          <ColorField
            value={String(labels.color ?? '')}
            disabled={!labels.show || !labels.overwriteColor}
            onChange={(color) => setParams(setIn(params, ['valueAxes', 0, 'labels', 'color'], color))}
          />
        </ParamRow>
      </Panel>
    </>
  );
}

function TagCloudOptions(props: OptionsProps) {
  const { params, setParams } = props;
  const fields = useFields(props);
  const min = typeof params.minFontSize === 'number' ? params.minFontSize : 18;
  const max = typeof params.maxFontSize === 'number' ? params.maxFontSize : 72;
  return (
    <Panel>
      {fields.select('Text scale', ['scale'], SCALE_TYPES)}
      {fields.select(
        'Orientations',
        ['orientation'],
        options([
          ['single', 'Single'],
          ['right angled', 'Right angled'],
          ['multiple', 'Multiple'],
        ])
      )}
      <DualRange min={1} max={100} value={[min, max]} label="Font size range in pixels" onChange={([from, to]) => setParams({ ...params, minFontSize: from, maxFontSize: to })} />
      {fields.toggle('Show label', ['showLabel'])}
    </Panel>
  );
}

/**
 * The original's check of a range typed in two fields, with what it says; '' when the range is
 * right. As the original, only the lower value is held to the least and the upper to the most.
 */
export function rangeProblem(value: [string, string], min: number, max: number, allowEmpty = true): string {
  const read = (text: string) => (text.trim() === '' || Number.isNaN(Number(text)) ? undefined : parseFloat(text));
  const lower = read(value[0]);
  const upper = read(value[1]);
  if ((!allowEmpty && (lower === undefined || upper === undefined)) || (lower === undefined) !== (upper === undefined)) {
    return 'Both lower and upper values must be set';
  }
  if ((lower !== undefined && lower < min) || (upper !== undefined && upper > max)) return `Values must be on or between ${min} and ${max}`;
  if (lower !== undefined && upper !== undefined && upper < lower) return 'Upper value must be greater or equal to lower value';
  return '';
}

/**
 * `ValidatedDualRange` with inputs: two values on one line, each with its field. What is typed is
 * kept as typed, and saved only when the range is right; otherwise the row says what is wrong.
 */
function DualRange({ min, max, value, label, onChange }: { min: number; max: number; value: [number, number]; label: string; onChange: (value: [number, number]) => void }) {
  const [draft, setDraft] = useState<[string, string]>([String(value[0]), String(value[1])]);
  const problem = rangeProblem(draft, min, max, false);
  const change = (next: [string, string]) => {
    setDraft(next);
    if (!rangeProblem(next, min, max, false)) onChange([Number(next[0]), Number(next[1])]);
  };
  const at = (text: string, fallback: number) => (text.trim() === '' || Number.isNaN(Number(text)) ? fallback : Number(text));
  const low = at(draft[0], min);
  const high = at(draft[1], max);
  const share = (point: number) => (max > min ? Math.min(1, Math.max(0, (point - min) / (max - min))) : 0);
  const field = (index: 0 | 1, ariaLabel: string) => (
    <input
      type="number"
      className={cx('atlField', 'vzeControl', 'vzeRangeField__input', problem && 'vzeControl--invalid')}
      min={min}
      max={max}
      value={draft[index]}
      aria-label={ariaLabel}
      onChange={(event) => change(index === 0 ? [event.target.value, draft[1]] : [draft[0], event.target.value])}
    />
  );
  return (
    <ParamRow label={label} invalid={problem !== ''} error={problem || undefined}>
      <div className="vzeRangeField">
        {field(0, 'Range minimum')}
        <div className="vzeRange vzeRange--hasRange vzeRange--dual">
          <div className="vzeRange__highlight" style={{ left: `${share(Math.min(low, high)) * 100}%`, width: `${Math.abs(share(high) - share(low)) * 100}%` }} />
          <input type="range" className="vzeRange__input" min={min} max={max} value={low} aria-label={label} onChange={(event) => change([event.target.value, draft[1]])} />
          <input type="range" className="vzeRange__input" min={min} max={max} value={high} aria-label={label} onChange={(event) => change([draft[0], event.target.value])} />
        </div>
        {field(1, 'Range maximum')}
      </div>
    </ParamRow>
  );
}

const TOTAL_FUNCTIONS = options([
  ['sum', 'Sum'],
  ['avg', 'Average'],
  ['min', 'Min'],
  ['max', 'Max'],
  ['count', 'Count'],
]);

function TableOptions(props: OptionsProps) {
  const { params, setParams, aggs, context } = props;
  const fields = useFields(props);
  const perPage = params.perPage;
  const perPageValid = perPage === '' || (typeof perPage === 'number' && perPage > 0);
  const columns = [
    { value: '', label: 'Don’t show' },
    ...aggs
      .filter((agg) => agg.schema === 'metric' && agg.enabled !== false && agg.type)
      .map((metric) => aggLabel(metric, context))
      .map((name) => ({ value: name, label: name })),
  ];
  const percentage = typeof params.percentageCol === 'string' ? params.percentageCol : undefined;
  // As the original, a percentage column that is gone is not kept
  useEffect(() => {
    if (!columns.some((column) => column.value === percentage) && percentage !== '') setParams({ ...params, percentageCol: '' });
  });
  return (
    <Panel>
      {fields.number(
        <TipLabel label="Max rows per page" position="right" tip="Leaving this field empty means it will use number of buckets from the response." />,
        ['perPage'],
        { min: 1, invalid: !perPageValid }
      )}
      {fields.toggle('Show metrics for every bucket/level', ['showMetricsAtAllLevels'], { testId: 'showMetricsAtAllLevels' })}
      {fields.toggle('Show partial rows', ['showPartialRows'], {
        testId: 'showPartialRows',
        tooltip: 'Show rows that have partial data. This will still calculate metrics for every bucket/level, even if they are not displayed.',
      })}
      {fields.toggle('Show total', ['showTotal'], { testId: 'showTotal' })}
      {fields.select('Total function', ['totalFunc'], TOTAL_FUNCTIONS, { disabled: !params.showTotal, testId: 'totalFunctionOptions' })}
      {fields.select('Percentage column', ['percentageCol'], columns, { testId: 'datatableVisualizationPercentageCol' })}
    </Panel>
  );
}


/** The text of a Markdown visualization, written in the proportional face as in the original */
function MarkdownData({ params, setParams }: OptionsProps) {
  return (
    <section className="vzePanel vzePanel--fill vzeMarkdownPanel">
      <div className="vzeMarkdownPanel__head">
        <h2 className="vzePanel__title">
          <label htmlFor="markdownVisInput">Markdown</label>
        </h2>
        <a className="vzeMarkdownPanel__help" href="https://help.github.com/articles/github-flavored-markdown/" target="_blank" rel="noopener noreferrer">
          Help <Icon name="external" className="vzeMarkdownPanel__external" title="External link" />
          <span className="atlScreenReaderOnly">(opens in a new tab or window)</span>
        </a>
      </div>
      <TextArea
        id="markdownVisInput"
        className="vzeMarkdown"
        value={typeof params.markdown === 'string' ? params.markdown : ''}
        onChange={(markdown) => setParams({ ...params, markdown })}
        testId="markdownTextarea"
      />
    </section>
  );
}

/**
 * The original's panel of settings has no title; its font size is a RangeOption with the value
 * beside the handle and a field to write it in
 */
function MarkdownOptions(props: OptionsProps) {
  const { params, setParams } = props;
  const fields = useFields(props);
  const [fontSizeValid, setFontSizeValid] = useState(true);
  return (
    <Panel>
      <ParamRow label="Base font size in points" invalid={!fontSizeValid} error={fontSizeValid ? undefined : 'Values must be on or between 8 and 36'}>
        <RangeControl
          min={8}
          max={36}
          value={Number(params.fontSize ?? 12)}
          showInput
          onValidity={setFontSizeValid}
          ariaLabel="Base font size in points"
          onChange={(fontSize) => setParams({ ...params, fontSize })}
        />
      </ParamRow>
      {fields.toggle('Open links in new tab', ['openLinksInNewTab'], { testId: 'markdownEditorOpenLinksInNewTab' })}
    </Panel>
  );
}

/** A kind without an editor of its own here: its settings as the JSON they are saved as */
function JsonOptions({ params, setParams }: OptionsProps) {
  const text = JSON.stringify(params, null, 2);
  return (
    <section className="vzePanel vzePanel--fill">
      <h3 className="vzePanel__title">Settings</h3>
      <p className="atlSubdued atlXs">This kind of visualization has no form in this build yet. Its settings are edited as the JSON they are saved as.</p>
      <JsonText key={text} text={text} onChange={setParams} />
    </section>
  );
}

function JsonText({ text, onChange }: { text: string; onChange: (params: Record<string, unknown>) => void }) {
  return (
    <TextArea
      className="vzeMarkdown"
      code
      defaultValue={text}
      value={undefined as unknown as string}
      aria-label="Settings as JSON"
      onChange={(next) => {
        try {
          const parsed: unknown = JSON.parse(next);
          if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) onChange(parsed as Record<string, unknown>);
        } catch {
          // Not JSON yet: nothing changes until it is
        }
      }}
    />
  );
}

const XY_TABS: OptionTab[] = [
  { id: 'advanced', label: 'Metrics & axes', render: (props) => <MetricsAxes {...props} /> },
  { id: 'options', label: 'Panel settings', render: (props) => <PanelSettings {...props} /> },
];

const TABS: Record<string, OptionTab[]> = {
  area: XY_TABS,
  line: XY_TABS,
  histogram: XY_TABS,
  horizontal_bar: XY_TABS,
  pie: [{ id: 'options', label: 'Options', render: (props) => <PieOptions {...props} /> }],
  metric: [{ id: 'options', label: 'Options', render: (props) => <MetricOptions {...props} /> }],
  gauge: [{ id: 'options', label: 'Options', render: (props) => <GaugeOptions {...props} /> }],
  goal: [{ id: 'options', label: 'Options', render: (props) => <GaugeOptions {...props} /> }],
  heatmap: [{ id: 'options', label: 'Options', render: (props) => <HeatmapOptions {...props} /> }],
  tagcloud: [{ id: 'options', label: 'Options', render: (props) => <TagCloudOptions {...props} /> }],
  table: [{ id: 'options', label: 'Options', render: (props) => <TableOptions {...props} /> }],
  tile_map: [{ id: 'options', label: 'Options', render: (props) => <TileMapOptions {...props} /> }],
  markdown: [
    { id: 'advanced', label: 'Data', render: (props) => <MarkdownData {...props} /> },
    { id: 'options', label: 'Options', render: (props) => <MarkdownOptions {...props} /> },
  ],
  timelion: [{ id: 'options', label: 'Options', render: (props) => <TimelineOptions {...props} /> }],
  input_control_vis: [
    { id: 'controls', label: 'Controls', render: (props) => <ControlsTab {...props} /> },
    { id: 'options', label: 'Options', render: (props) => <ControlsOptions {...props} /> },
  ],
  vega: [{ id: 'options', label: 'Options', render: (props) => <VegaSpecEditor {...props} /> }],
  region_map: [{ id: 'options', label: 'Layer Options', render: (props) => <RegionMapOptions {...props} /> }],
};

/** The tabs of a kind's settings, after "Data" when it is drawn from aggregations */
export const optionTabs = (type: string): OptionTab[] => TABS[type] ?? [{ id: 'options', label: 'Settings', render: (props) => <JsonOptions {...props} /> }];

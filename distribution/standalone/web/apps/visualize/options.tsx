/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The tabs of the editor that hold a visualization's settings, per kind: "Metrics & axes" and
 * "Panel settings" of a line, area or bar chart, "Options" of the others. The names of the
 * settings and their values are those OpenSearch Dashboards saves.
 */

import type { ReactNode } from 'react';
import { RAMP_NAMES } from '../../charts/core';
import { Accordion, Button, IconButton, Segments } from '../../components/basic';
import { FormRow, NumberField, RangeField, Select, Switch, TextArea, TextField, type SelectOption } from '../../components/form';
import { aggLabel, type AggConfig, type AggContext } from '../../lib/aggs';
import { ControlsOptions, ControlsTab } from './controls_editor';
import { axisName, nextAxisId, oppositeSide } from './defaults';

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

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="vzePanel">
      <h3 className="vzePanel__title">{title}</h3>
      <div className="vzeFields">{children}</div>
    </section>
  );
}

const POSITIONS: SelectOption[] = [
  { value: 'top', label: 'Top' },
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
  { value: 'bottom', label: 'Bottom' },
];
const CHART_TYPES: SelectOption[] = [
  { value: 'line', label: 'Line' },
  { value: 'area', label: 'Area' },
  { value: 'histogram', label: 'Bar' },
];
const CHART_MODES: SelectOption[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'stacked', label: 'Stacked' },
];
const LINE_MODES: SelectOption[] = [
  { value: 'linear', label: 'Straight' },
  { value: 'cardinal', label: 'Smoothed' },
  { value: 'step-after', label: 'Stepped' },
];
const AXIS_MODES: SelectOption[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'percentage', label: 'Percentage' },
  { value: 'wiggle', label: 'Wiggle' },
  { value: 'silhouette', label: 'Silhouette' },
];
const SCALE_TYPES: SelectOption[] = [
  { value: 'linear', label: 'Linear' },
  { value: 'log', label: 'Log' },
  { value: 'square root', label: 'Square root' },
];
const ROTATIONS: SelectOption[] = [
  { value: '0', label: 'Horizontal' },
  { value: '90', label: 'Vertical' },
  { value: '75', label: 'Angled' },
];
const LINE_STYLES: SelectOption[] = [
  { value: 'full', label: 'Full' },
  { value: 'dashed', label: 'Dashed' },
  { value: 'dot-dashed', label: 'Dot-dashed' },
];
const COLOR_MODES = [
  { id: 'None', label: 'None' },
  { id: 'Labels', label: 'Labels' },
  { id: 'Background', label: 'Background' },
];

/** The controls of one tab, bound to the settings by the path of each */
function useFields({ params, setParams }: OptionsProps) {
  const set = (path: Path, value: unknown) => setParams(setIn(params, path, value));
  return {
    set,
    toggle: (label: string, path: Path, extra: { disabled?: boolean; fallback?: boolean; testId?: string } = {}) => (
      <Switch
        checked={Boolean(getIn(params, path) ?? extra.fallback ?? false)}
        onChange={(value) => set(path, value)}
        label={label}
        disabled={extra.disabled}
        testId={extra.testId}
      />
    ),
    select: (label: string, path: Path, options: SelectOption[], extra: { fallback?: string; numeric?: boolean; disabled?: boolean; testId?: string } = {}) => (
      <FormRow label={label} full>
        <Select
          compact
          disabled={extra.disabled}
          value={String(getIn(params, path) ?? extra.fallback ?? options[0]?.value ?? '')}
          options={options}
          onChange={(value) => set(path, extra.numeric ? Number(value) : value)}
          testId={extra.testId}
        />
      </FormRow>
    ),
    number: (label: string, path: Path, extra: { min?: number; max?: number; step?: number | 'any'; disabled?: boolean; help?: string; testId?: string } = {}) => {
      const value = getIn(params, path);
      return (
        <FormRow label={label} full help={extra.help}>
          <NumberField
            compact
            min={extra.min}
            max={extra.max}
            step={extra.step}
            disabled={extra.disabled}
            value={typeof value === 'number' ? value : undefined}
            onChange={(next) => set(path, next ?? null)}
            testId={extra.testId}
          />
        </FormRow>
      );
    },
    text: (label: string, path: Path, extra: { disabled?: boolean; testId?: string } = {}) => (
      <FormRow label={label} full>
        <TextField compact disabled={extra.disabled} value={String(getIn(params, path) ?? '')} onChange={(value) => set(path, value)} testId={extra.testId} />
      </FormRow>
    ),
  };
}

interface ColorRange {
  from?: number;
  to?: number;
}

/** The ranges a gauge, a metric or a heat map takes its colours by */
export function ColorRanges({ ranges, onChange }: { ranges: ColorRange[]; onChange: (ranges: ColorRange[]) => void }) {
  const set = (index: number, patch: ColorRange) => onChange(ranges.map((range, at) => (at === index ? { ...range, ...patch } : range)));
  return (
    <div className="vzeRanges" data-test-subj="colorRanges">
      {ranges.map((range, index) => (
        <div className="vzeRanges__row" key={index}>
          <span className="vzeRanges__sign" aria-hidden="true">
            ≥
          </span>
          <NumberField compact step="any" value={range.from} aria-label={`Range ${index + 1} from`} onChange={(from) => set(index, { from })} />
          <span className="vzeRanges__sign" aria-hidden="true">
            &lt;
          </span>
          <NumberField compact step="any" value={range.to} aria-label={`Range ${index + 1} to`} onChange={(to) => set(index, { to })} />
          <IconButton
            icon="trash"
            size="s"
            label={`Remove the range of ${range.from ?? ''} to ${range.to ?? ''}`}
            disabled={ranges.length === 1}
            onClick={() => onChange(ranges.filter((_, at) => at !== index))}
          />
        </div>
      ))}
      <div>
        <Button
          variant="empty"
          size="s"
          icon="plusCircle"
          onClick={() => {
            const last = ranges[ranges.length - 1];
            const from = last?.to ?? 0;
            const width = last && last.to !== undefined && last.from !== undefined ? last.to - last.from : 100;
            onChange([...ranges, { from, to: from + (width || 100) }]);
          }}
          testId="range__addRangeButton"
        >
          Add range
        </Button>
      </div>
    </div>
  );
}

function ColorSchema({ props, base }: { props: OptionsProps; base: Path }) {
  const fields = useFields(props);
  return (
    <>
      {fields.select(
        'Color schema',
        [...base, 'colorSchema'],
        RAMP_NAMES.map((name) => ({ value: name, label: name })),
        { testId: 'colorSchema' }
      )}
      {fields.toggle('Reverse schema', [...base, 'invertColors'])}
    </>
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

interface ValueAxis {
  id: string;
  name?: string;
  position?: string;
  show?: boolean;
  scale?: { type?: string; mode?: string; defaultYExtents?: boolean; boundsMargin?: number; setYExtents?: boolean; min?: number; max?: number };
  labels?: { show?: boolean; rotate?: number; filter?: boolean; truncate?: number };
  title?: { text?: string };
}

function AxisLabels({ props, base }: { props: OptionsProps; base: Path }) {
  const fields = useFields(props);
  const shown = getIn(props.params, [...base, 'show']) !== false;
  return (
    <>
      {fields.toggle('Show labels', [...base, 'show'], { fallback: true })}
      {fields.toggle('Filter labels', [...base, 'filter'], { disabled: !shown })}
      <div className="vzePair">
        {fields.select('Align', [...base, 'rotate'], ROTATIONS, { numeric: true, fallback: '0', disabled: !shown })}
        {fields.number('Truncate', [...base, 'truncate'], { min: 0, disabled: !shown })}
      </div>
    </>
  );
}

function MetricsAxes(props: OptionsProps) {
  const { params, setParams, aggs, context } = props;
  const fields = useFields(props);
  const series = (Array.isArray(params.seriesParams) ? params.seriesParams : []) as SeriesParam[];
  const axes = (Array.isArray(params.valueAxes) ? params.valueAxes : []) as ValueAxis[];
  const metrics = aggs.filter((agg) => agg.schema === 'metric');
  const horizontal = ['left', 'right'].includes(String(getIn(params, ['categoryAxes', 0, 'position']) ?? 'bottom'));

  const addAxis = (): { axes: ValueAxis[]; id: string } => {
    const first = axes[0];
    const position = oppositeSide(first?.position ?? 'left');
    const id = nextAxisId(axes);
    const added: ValueAxis = { ...(JSON.parse(JSON.stringify(first ?? {})) as ValueAxis), id, position, name: axisName(position, axes) };
    return { axes: [...axes, added], id };
  };

  return (
    <>
      <Group title="Metrics">
        {series.map((item, index) => {
          const agg = metrics.find((candidate) => candidate.id === item.data?.id);
          const label = agg ? aggLabel(agg, context) : (item.data?.label ?? `Series ${index + 1}`);
          const type = item.type ?? 'line';
          return (
            <Accordion key={item.data?.id ?? index} title={<span className="atlTruncate">{label}</span>} initiallyOpen={series.length === 1}>
              <div className="vzeFields" data-test-subj={`visEditorSeriesAccordion${index + 1}`}>
                <div className="vzePair">
                  {fields.select('Chart type', ['seriesParams', index, 'type'], CHART_TYPES, { testId: `seriesType${index}` })}
                  {fields.select('Mode', ['seriesParams', index, 'mode'], CHART_MODES, { testId: `seriesMode${index}` })}
                </div>
                <FormRow label="Value axis" full>
                  <Select
                    compact
                    value={item.valueAxis ?? axes[0]?.id ?? ''}
                    options={[...axes.map((axis) => ({ value: axis.id, label: axis.name ?? axis.id })), { value: 'new', label: 'New axis…' }]}
                    onChange={(value) => {
                      if (value !== 'new') {
                        setParams(setIn(params, ['seriesParams', index, 'valueAxis'], value));
                        return;
                      }
                      const added = addAxis();
                      setParams({ ...setIn(params, ['seriesParams', index, 'valueAxis'], added.id), valueAxes: added.axes });
                    }}
                    testId={`seriesValueAxis${index}`}
                  />
                </FormRow>
                {type !== 'histogram' && fields.select('Line mode', ['seriesParams', index, 'interpolate'], LINE_MODES, { fallback: 'linear' })}
                {type === 'line' && (
                  <>
                    {fields.toggle('Show line', ['seriesParams', index, 'drawLinesBetweenPoints'], { fallback: true })}
                    {fields.number('Line width', ['seriesParams', index, 'lineWidth'], { min: 0, step: 0.5, disabled: item.drawLinesBetweenPoints === false })}
                    {fields.toggle('Show dots', ['seriesParams', index, 'showCircles'], { fallback: true })}
                  </>
                )}
              </div>
            </Accordion>
          );
        })}
      </Group>

      <Group title={horizontal ? 'X-axes' : 'Y-axes'}>
        {axes.map((axis, index) => {
          const own = series.filter((item) => item.valueAxis === axis.id || (index === 0 && !item.valueAxis));
          const extents = Boolean(axis.scale?.setYExtents);
          const sides = ['left', 'right'].includes(axis.position ?? 'left') ? POSITIONS.filter((option) => option.value === 'left' || option.value === 'right') : POSITIONS.filter((option) => option.value === 'top' || option.value === 'bottom');
          return (
            <Accordion
              key={axis.id}
              title={
                <span className="atlTruncate">
                  {axis.name ?? axis.id} <span className="atlSubdued">{own.map((item) => item.data?.label).join(', ')}</span>
                </span>
              }
              initiallyOpen={axes.length === 1}
              extra={
                axes.length > 1 ? (
                  <IconButton
                    icon="cross"
                    size="s"
                    label="Remove Y-axis"
                    onClick={() => {
                      const kept = axes.filter((other) => other.id !== axis.id);
                      setParams({
                        ...params,
                        valueAxes: kept,
                        seriesParams: series.map((item) => (item.valueAxis === axis.id ? { ...item, valueAxis: kept[0].id } : item)),
                      });
                    }}
                    testId="removeValueAxisBtn"
                  />
                ) : undefined
              }
            >
              <div className="vzeFields">
                <FormRow label="Position" full>
                  <Select
                    compact
                    value={axis.position ?? 'left'}
                    options={sides}
                    onChange={(position) =>
                      setParams(setIn(params, ['valueAxes', index], { ...axis, position, name: axisName(position, axes.filter((other) => other.id !== axis.id)) }))
                    }
                  />
                </FormRow>
                <div className="vzePair">
                  {fields.select('Mode', ['valueAxes', index, 'scale', 'mode'], AXIS_MODES, { fallback: 'normal' })}
                  {fields.select('Scale type', ['valueAxes', index, 'scale', 'type'], SCALE_TYPES, { fallback: 'linear' })}
                </div>
                {fields.toggle('Show axis lines and labels', ['valueAxes', index, 'show'], { fallback: true })}
                {fields.text('Title', ['valueAxes', index, 'title', 'text'], { disabled: axis.show === false })}
                <AxisLabels props={props} base={['valueAxes', index, 'labels']} />
                <Accordion title="Custom extents" initiallyOpen={Boolean(axis.scale?.defaultYExtents || extents)}>
                  <div className="vzeFields">
                    {fields.toggle('Scale to data bounds', ['valueAxes', index, 'scale', 'defaultYExtents'])}
                    {Boolean(axis.scale?.defaultYExtents) && fields.number('Bounds margin', ['valueAxes', index, 'scale', 'boundsMargin'], { min: 0, step: 0.1 })}
                    {fields.toggle('Set axis extents', ['valueAxes', index, 'scale', 'setYExtents'])}
                    {extents && (
                      <div className="vzePair">
                        {fields.number('Min', ['valueAxes', index, 'scale', 'min'], { step: 'any' })}
                        {fields.number('Max', ['valueAxes', index, 'scale', 'max'], { step: 'any' })}
                      </div>
                    )}
                    {extents && typeof axis.scale?.min === 'number' && typeof axis.scale?.max === 'number' && axis.scale.min >= axis.scale.max && (
                      <span className="atlFormRow__error">Min should be less than Max.</span>
                    )}
                  </div>
                </Accordion>
              </div>
            </Accordion>
          );
        })}
        <div>
          <Button variant="empty" size="s" icon="plusCircle" onClick={() => setParams({ ...params, valueAxes: addAxis().axes })} testId="visualizeAddYAxisButton">
            Add {horizontal ? 'X' : 'Y'}-axis
          </Button>
        </div>
      </Group>

      <Group title={horizontal ? 'Y-axis' : 'X-axis'}>
        {fields.select('Position', ['categoryAxes', 0, 'position'], horizontal ? POSITIONS.filter((option) => option.value === 'left' || option.value === 'right') : POSITIONS.filter((option) => option.value === 'top' || option.value === 'bottom'))}
        {fields.toggle('Show axis lines and labels', ['categoryAxes', 0, 'show'], { fallback: true })}
        <AxisLabels props={props} base={['categoryAxes', 0, 'labels']} />
      </Group>
    </>
  );
}

function PanelSettings(props: OptionsProps) {
  const { params, aggs } = props;
  const fields = useFields(props);
  const axes = (Array.isArray(params.valueAxes) ? params.valueAxes : []) as ValueAxis[];
  const onTime = aggs.some((agg) => agg.schema === 'segment' && agg.type === 'date_histogram' && agg.enabled !== false);
  const threshold = Boolean(getIn(params, ['thresholdLine', 'show']));
  return (
    <>
      <Group title="Settings">
        {fields.select('Legend position', ['legendPosition'], POSITIONS, { fallback: 'right', testId: 'legendPosition' })}
        {fields.toggle('Show tooltip', ['addTooltip'], { fallback: true })}
        {onTime && fields.toggle('Current time marker', ['addTimeMarker'])}
      </Group>
      <Group title="Grid">
        {fields.toggle('Show X-axis lines', ['grid', 'categoryLines'])}
        <FormRow label="Y-axis lines" full>
          <Select
            compact
            value={String(getIn(params, ['grid', 'valueAxis']) ?? '')}
            options={[{ value: '', label: "Don't show" }, ...axes.map((axis) => ({ value: axis.id, label: axis.name ?? axis.id }))]}
            onChange={(value) => props.setParams(setIn(params, ['grid', 'valueAxis'], value === '' ? undefined : value))}
            testId="gridAxis"
          />
        </FormRow>
      </Group>
      <Group title="Threshold line">
        {fields.toggle('Show threshold line', ['thresholdLine', 'show'])}
        {threshold && (
          <>
            {fields.number('Threshold value', ['thresholdLine', 'value'], { step: 'any' })}
            {fields.number('Line width', ['thresholdLine', 'width'], { min: 1, step: 1 })}
            {fields.select('Line style', ['thresholdLine', 'style'], LINE_STYLES, { fallback: 'full' })}
            <FormRow label="Line color" full>
              <input
                type="color"
                className="vzeColor"
                value={/^#[0-9a-f]{6}$/i.test(String(getIn(params, ['thresholdLine', 'color']))) ? String(getIn(params, ['thresholdLine', 'color'])) : '#e7664c'}
                onChange={(event) => props.setParams(setIn(params, ['thresholdLine', 'color'], event.target.value.toUpperCase()))}
              />
            </FormRow>
          </>
        )}
      </Group>
    </>
  );
}

// --- The other kinds ------------------------------------------------------------------------------

function PieOptions(props: OptionsProps) {
  const fields = useFields(props);
  const labels = Boolean(getIn(props.params, ['labels', 'show']));
  return (
    <>
      <Group title="Pie settings">
        {fields.toggle('Donut', ['isDonut'], { testId: 'visTypePieIsDonut' })}
        {fields.select('Legend position', ['legendPosition'], POSITIONS, { fallback: 'right' })}
        {fields.toggle('Show tooltip', ['addTooltip'], { fallback: true })}
      </Group>
      <Group title="Labels settings">
        {fields.toggle('Show labels', ['labels', 'show'])}
        {fields.toggle('Show top level only', ['labels', 'last_level'], { disabled: !labels })}
        {fields.toggle('Show values', ['labels', 'values'], { disabled: !labels })}
        {fields.number('Truncate', ['labels', 'truncate'], { min: 0, disabled: !labels })}
      </Group>
    </>
  );
}

function MetricOptions(props: OptionsProps) {
  const { params, setParams } = props;
  const fields = useFields(props);
  const mode = String(getIn(params, ['metric', 'metricColorMode']) ?? 'None');
  const ranges = (getIn(params, ['metric', 'colorsRange']) as ColorRange[] | undefined) ?? [];
  return (
    <>
      <Group title="Settings">
        {fields.toggle('Percentage mode', ['metric', 'percentageMode'])}
        {fields.toggle('Show title', ['metric', 'labels', 'show'], { fallback: true })}
      </Group>
      <Group title="Ranges">
        <ColorRanges ranges={ranges} onChange={(next) => setParams(setIn(params, ['metric', 'colorsRange'], next))} />
        <FormRow label="Use color for" full>
          <Segments options={COLOR_MODES} value={mode} onChange={(next) => setParams(setIn(params, ['metric', 'metricColorMode'], next))} />
        </FormRow>
        {mode !== 'None' && <ColorSchema props={props} base={['metric']} />}
      </Group>
      <Group title="Style">
        <FormRow label="Metric font size in points" full>
          <RangeField
            min={12}
            max={120}
            value={Number(getIn(params, ['metric', 'style', 'fontSize']) ?? 60)}
            onChange={(size) => setParams(setIn(params, ['metric', 'style', 'fontSize'], size))}
          />
        </FormRow>
      </Group>
    </>
  );
}

function GaugeOptions(props: OptionsProps) {
  const { params, setParams } = props;
  const fields = useFields(props);
  const ranges = (getIn(params, ['gauge', 'colorsRange']) as ColorRange[] | undefined) ?? [];
  const labels = getIn(params, ['gauge', 'labels', 'show']) !== false;
  return (
    <>
      <Group title="Style">
        {fields.select(
          'Gauge type',
          ['gauge', 'gaugeType'],
          [
            { value: 'Arc', label: 'Arc' },
            { value: 'Circle', label: 'Circle' },
          ],
          { testId: 'gaugeType' }
        )}
        {fields.select(
          'Alignment',
          ['gauge', 'alignment'],
          [
            { value: 'automatic', label: 'Automatic' },
            { value: 'horizontal', label: 'Horizontal' },
            { value: 'vertical', label: 'Vertical' },
          ],
          { fallback: 'automatic' }
        )}
      </Group>
      <Group title="Ranges">
        <ColorRanges ranges={ranges} onChange={(next) => setParams(setIn(params, ['gauge', 'colorsRange'], next))} />
        {fields.toggle('Auto extend range', ['gauge', 'extendRange'])}
        {fields.toggle('Percentage mode', ['gauge', 'percentageMode'], { testId: 'gaugePercentageMode' })}
        <ColorSchema props={props} base={['gauge']} />
        {fields.toggle('Show scale', ['gauge', 'scale', 'show'])}
      </Group>
      <Group title="Labels">
        {fields.toggle('Show labels', ['gauge', 'labels', 'show'], { fallback: true })}
        {fields.text('Sub label', ['gauge', 'style', 'subText'], { disabled: !labels })}
      </Group>
    </>
  );
}

function HeatmapOptions(props: OptionsProps) {
  const { params, setParams } = props;
  const fields = useFields(props);
  const custom = Boolean(params.setColorRange);
  const ranges = (params.colorsRange as ColorRange[] | undefined) ?? [];
  const labels = Boolean(getIn(params, ['valueAxes', 0, 'labels', 'show']));
  return (
    <>
      <Group title="Basic settings">
        {fields.select('Legend position', ['legendPosition'], POSITIONS, { fallback: 'right' })}
        {fields.toggle('Show tooltip', ['addTooltip'], { fallback: true })}
      </Group>
      <Group title="Heatmap settings">
        <ColorSchema props={props} base={[]} />
        {fields.toggle('Percentage mode', ['percentageMode'], { disabled: custom })}
        {fields.number('Number of colors', ['colorsNumber'], { min: 2, max: 10, disabled: custom, testId: 'heatmapColorsNumber' })}
        {fields.toggle('Use custom ranges', ['setColorRange'], { testId: 'heatmapUseCustomRanges' })}
        {custom && <ColorRanges ranges={ranges.length ? ranges : [{ from: 0, to: 100 }]} onChange={(next) => setParams({ ...params, colorsRange: next })} />}
      </Group>
      <Group title="Labels">
        {fields.toggle('Show labels', ['valueAxes', 0, 'labels', 'show'])}
        {fields.toggle('Rotate', ['valueAxes', 0, 'labels', 'rotate'], { disabled: !labels })}
      </Group>
    </>
  );
}

function TagCloudOptions(props: OptionsProps) {
  const { params, setParams } = props;
  const fields = useFields(props);
  const min = Number(params.minFontSize ?? 18);
  const max = Number(params.maxFontSize ?? 72);
  return (
    <Group title="Options">
      {fields.select('Text scale', ['scale'], SCALE_TYPES, { fallback: 'linear' })}
      {fields.select(
        'Orientations',
        ['orientation'],
        [
          { value: 'single', label: 'Single' },
          { value: 'right angled', label: 'Right angled' },
          { value: 'multiple', label: 'Multiple' },
        ],
        { fallback: 'single' }
      )}
      <div className="atlFormRow atlFormRow--full">
        <span className="atlFormRow__label">Font size range in pixels</span>
        <div className="vzePair">
          <FormRow label="Smallest">
            <NumberField compact min={1} max={max} value={min} onChange={(value) => setParams({ ...params, minFontSize: Math.min(value ?? 18, max) })} />
          </FormRow>
          <FormRow label="Largest">
            <NumberField compact min={min} max={400} value={max} onChange={(value) => setParams({ ...params, maxFontSize: Math.max(value ?? 72, min) })} />
          </FormRow>
        </div>
      </div>
      {fields.toggle('Show label', ['showLabel'], { fallback: true })}
    </Group>
  );
}

function TableOptions(props: OptionsProps) {
  const { params, aggs, context } = props;
  const fields = useFields(props);
  const metrics = aggs.filter((agg) => agg.schema === 'metric' && agg.enabled !== false && agg.type);
  const total = Boolean(params.showTotal);
  return (
    <Group title="Options">
      {fields.number('Per page', ['perPage'], { min: 0, help: 'Empty or 0 shows every row on one page.', testId: 'datatableVisualizationPerPage' })}
      {fields.toggle('Show metrics for every bucket/level', ['showMetricsAtAllLevels'], { testId: 'showMetricsAtAllLevels' })}
      {fields.toggle('Show partial rows', ['showPartialRows'], { testId: 'showPartialRows' })}
      {fields.toggle('Show total', ['showTotal'], { testId: 'showTotal' })}
      {fields.select(
        'Total function',
        ['totalFunc'],
        [
          { value: 'sum', label: 'Sum' },
          { value: 'avg', label: 'Average' },
          { value: 'min', label: 'Min' },
          { value: 'max', label: 'Max' },
          { value: 'count', label: 'Count' },
        ],
        { fallback: 'sum', disabled: !total, testId: 'totalFunction' }
      )}
      {fields.select(
        'Percentage column',
        ['percentageCol'],
        [{ value: '', label: "Don't show" }, ...metrics.map((metric) => ({ value: aggLabel(metric, context), label: aggLabel(metric, context) }))],
        { fallback: '', testId: 'datatableVisualizationPercentageCol' }
      )}
    </Group>
  );
}

function MarkdownData({ params, setParams }: OptionsProps) {
  return (
    <section className="vzePanel vzePanel--fill">
      <div className="atlRowBetween">
        <h3 className="vzePanel__title">Markdown</h3>
        <span className="atlSubdued atlXs">Headings, lists, links, tables and code, in GitHub’s flavour</span>
      </div>
      <TextArea
        className="vzeMarkdown"
        code
        value={typeof params.markdown === 'string' ? params.markdown : ''}
        onChange={(markdown) => setParams({ ...params, markdown })}
        aria-label="Markdown"
        testId="markdownTextarea"
      />
    </section>
  );
}

function MarkdownOptions(props: OptionsProps) {
  const { params, setParams } = props;
  const fields = useFields(props);
  return (
    <Group title="Options">
      <FormRow label="Base font size in points" full>
        <RangeField min={8} max={36} value={Number(params.fontSize ?? 12)} onChange={(fontSize) => setParams({ ...params, fontSize })} />
      </FormRow>
      {fields.toggle('Open links in new tab', ['openLinksInNewTab'], { testId: 'markdownEditorOpenLinksInNewTab' })}
    </Group>
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
  markdown: [
    { id: 'advanced', label: 'Data', render: (props) => <MarkdownData {...props} /> },
    { id: 'options', label: 'Options', render: (props) => <MarkdownOptions {...props} /> },
  ],
  input_control_vis: [
    { id: 'controls', label: 'Controls', render: (props) => <ControlsTab {...props} /> },
    { id: 'options', label: 'Options', render: (props) => <ControlsOptions {...props} /> },
  ],
};

/** The tabs of a kind's settings, after "Data" when it is drawn from aggregations */
export const optionTabs = (type: string): OptionTab[] => TABS[type] ?? [{ id: 'options', label: 'Settings', render: (props) => <JsonOptions {...props} /> }];

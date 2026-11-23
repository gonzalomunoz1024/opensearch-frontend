/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The series of a TSVB panel, a box each: its colour, label and buttons, then its metrics and how
 * it is split, or its options. Series are sorted by dragging. Each kind of panel shows a series a
 * little differently, as OpenSearch Dashboards does; all of them change the series in the params.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { IconButton, cx } from '../../../components/basic';
import type { TsvbData, TsvbTableData } from '../../../vis/tsvb/data';
import { defaultQueryLanguage } from '../../../shell/query_bar';
import { choice } from './agg_lists';
import { Aggs, MetricSelect } from './aggs';
import {
  AddDeleteButtons,
  ColorRules,
  Combo,
  DragHandle,
  Field,
  FieldSelect,
  IndexPatternOptions,
  Item,
  Label,
  QueryBarWrapper,
  Row,
  Rule,
  Spacer,
  TextInput,
  TvbColorPicker,
  TvbTabs,
  YesNo,
  readQuery,
  useSortable,
  type Choice,
  type HandleProps,
} from './controls';
import {
  DURATION_INPUTS,
  DURATION_OUTPUTS,
  collection,
  isDuration,
  list,
  newSeries,
  reIdSeries,
  reorder,
  str,
  uuid,
  type Doc,
  type Fields,
  type Panel,
  type Series,
} from './model';
import type { PanelProps } from './panel_config';

/** What the chart drew last */
export type PanelData = TsvbData | TsvbTableData;


/** How many series each series of the panel drew: one, or one per term or filter it is split by */
function seriesQuantity(data: PanelData | undefined): Record<string, number> {
  const counts: Record<string, number> = {};
  if (data && 'series' in data) {
    for (const item of data.series) counts[item.seriesId] = (counts[item.seriesId] ?? 0) + 1;
  }
  return counts;
}

/** Percent stacking needs two series or more to share the hundred */
const isPercentDisabled = (quantity: number | undefined) => quantity !== undefined && quantity < 2;

/** The index pattern a series' queries are written against */
function queryIndexPattern(series: Series, panel: Panel): string {
  if (series.override_index_pattern && series.series_index_pattern) return str(series, 'series_index_pattern');
  return str(panel, 'index_pattern') || str(panel, 'default_index_pattern');
}

// --- How the values are written --------------------------------------------------------------------------

const FORMATS = [choice('Bytes', 'bytes'), choice('Number', 'number'), choice('Percent', 'percent'), choice('Duration', 'duration'), choice('Custom', 'custom')];

/** "Data Formatter": bytes, a number, a percentage, a duration from one unit to another or a Numeral.js format */
function DataFormatPicker({ value: given, onChange, label = 'Data Formatter' }: { value: unknown; onChange: (value: string) => void; label?: string }) {
  const value = typeof given === 'string' ? given : '';
  const [duration, setDuration] = useState(() => {
    const [from, to, decimals] = isDuration(value) ? value.split(',') : [];
    return { from: from || 'ms', to: to || 'ms', decimals: decimals || '' };
  });
  const custom = useRef<HTMLInputElement>(null);
  let shown = ['bytes', 'number', 'percent'].includes(value) ? value : 'custom';
  if (isDuration(value)) shown = 'duration';

  const pick = (picked: string | null) => {
    if (!picked) return;
    // A custom format starts from what its field holds, which is nothing until it is shown
    if (picked === 'custom') onChange(custom.current?.value || '');
    else if (picked === 'duration') onChange(`${duration.from},${duration.to},${duration.decimals}`);
    else onChange(picked);
  };
  const changeDuration = (part: Partial<typeof duration>) => {
    const next = { ...duration, ...part };
    setDuration(next);
    onChange(`${next.from},${next.to},${next.decimals}`);
  };
  const formats = (
    <Item grow={false}>
      <Field label={label}>
        <Combo options={FORMATS} value={shown} clearable={false} fullWidth={false} onChange={pick} testId="tsvbDataFormatPicker" />
      </Field>
    </Item>
  );

  if (shown === 'duration') {
    const [from, to, decimals] = value.split(',');
    const output = DURATION_OUTPUTS.find((option) => option.value === to);
    return (
      <Row gap="s" responsive={false}>
        {formats}
        <Item grow={false}>
          <Field label="From">
            <Combo options={DURATION_INPUTS} value={from} clearable={false} fullWidth={false} onChange={(next) => next && changeDuration({ from: next })} />
          </Field>
        </Item>
        <Item grow={false}>
          <Field label="To">
            <Combo options={DURATION_OUTPUTS} value={to} clearable={false} fullWidth={false} onChange={(next) => next && changeDuration({ to: next })} />
          </Field>
        </Item>
        {output && output.value !== 'humanize' && (
          <Item grow={false}>
            <Field label="Decimal places">
              <input className="atlField tvbInput" defaultValue={decimals} placeholder="2" onChange={(event) => changeDuration({ decimals: event.target.value })} />
            </Field>
          </Item>
        )}
      </Row>
    );
  }
  return (
    <Row gap="s" responsive={false}>
      {formats}
      {shown === 'custom' && (
        <Item grow={false}>
          <Field
            label="Format string"
            help={
              <span>
                See{' '}
                <a href="http://numeraljs.com/#format" target="_BLANK" rel="noreferrer">
                  Numeral.js
                </a>
              </span>
            }
          >
            <input ref={custom} className="atlField tvbInput" defaultValue={value} onChange={() => onChange(custom.current?.value || '')} />
          </Field>
        </Item>
      )}
    </Row>
  );
}

// --- How a series is split -----------------------------------------------------------------------------------

interface SplitProps {
  model: Series;
  indexPattern: string;
  fields: Fields;
  onChange: (part: Doc) => void;
  seriesQuantity?: Record<string, number>;
}

const GROUP_BY = [choice('Everything', 'everything'), choice('Filter', 'filter'), choice('Filters', 'filters'), choice('Terms', 'terms')];

function GroupBy({ model, onChange }: Pick<SplitProps, 'model' | 'onChange'>) {
  return (
    <Field label="Group by">
      <Combo options={GROUP_BY} value={model.split_mode || 'everything'} clearable={false} onChange={(mode) => onChange({ split_mode: mode })} />
    </Field>
  );
}

function SplitByEverything({ model, onChange }: SplitProps) {
  return (
    <Row center>
      <Item>
        <GroupBy model={model} onChange={onChange} />
      </Item>
    </Row>
  );
}

function SplitByFilter({ model, onChange, indexPattern }: SplitProps) {
  return (
    <Row center>
      <Item>
        <GroupBy model={model} onChange={onChange} />
      </Item>
      <Item>
        <Field label="Query string">
          <QueryBarWrapper query={readQuery(model.filter)} onChange={(filter) => onChange({ filter })} indexPatterns={[indexPattern]} />
        </Field>
      </Item>
    </Row>
  );
}

/** The filters a series is split by: a colour, a query and a label each */
function SplitByFilters({ model, onChange, indexPattern }: SplitProps) {
  const rows = list<Doc & { id: string }>(model, 'split_filters');
  const save = (next: Array<Doc & { id: string }>) => onChange({ ...model, split_filters: next });
  return (
    <div>
      <Row center>
        <Item>
          <GroupBy model={model} onChange={onChange} />
        </Item>
      </Row>
      {Array.isArray(model.split_filters) && (
        <div>
          {rows.map((row) => {
            const item: Doc & { id: string } = { filter: '', label: '', ...row };
            const query = readQuery(item.filter);
            const change = (part: Doc) => save(collection.change(rows, { ...item, ...part }));
            const newFilter = () => ({ color: model.color, id: uuid(), filter: { language: query.language, query: '' } });
            return (
              <Row gap="s" center className="tvbAggRow" key={item.id}>
                <Item grow={false}>
                  <TvbColorPicker disableTrash name="color" value={item.color} onChange={change} />
                </Item>
                <Item>
                  <QueryBarWrapper query={query} onChange={(filter) => change({ filter })} indexPatterns={[indexPattern]} />
                </Item>
                <Item>
                  <TextInput value={item.label} placeholder="Label" label="Label" onChange={(label) => change({ label })} />
                </Item>
                <Item grow={false}>
                  <AddDeleteButtons
                    onAdd={() => save(collection.add(rows, newFilter()))}
                    onDelete={() => save(collection.remove(rows, item))}
                    disableDelete={rows.length < 2}
                  />
                </Item>
              </Row>
            );
          })}
        </div>
      )}
    </div>
  );
}

const DIRECTIONS = [choice('Descending', 'desc'), choice('Ascending', 'asc')];

function SplitByTerms({ model: series, indexPattern, fields, onChange, seriesQuantity: quantity }: SplitProps) {
  const model: Series = { terms_direction: 'desc', terms_size: 10, terms_order_by: '_count', ...series };
  const selectedField = (fields[indexPattern] ?? []).find((field) => field.name === model.terms_field);
  // A series stacked as percentages that drew a single term goes back to no stacking
  const resetPercent = Boolean(quantity) && model.stacked === 'percent' && isPercentDisabled(quantity?.[model.id]);
  const latest = useRef(onChange);
  latest.current = onChange;
  useEffect(() => {
    if (resetPercent) latest.current({ stacked: 'none' });
  }, [resetPercent]);
  return (
    <div>
      <Row>
        <Item>
          <GroupBy model={model} onChange={onChange} />
        </Item>
        <Item testId="groupByField">
          <Field label="By">
            <FieldSelect fields={fields} indexPattern={indexPattern} type="terms" value={model.terms_field} onChange={(field) => onChange({ terms_field: field })} />
          </Field>
        </Item>
      </Row>
      {selectedField?.type === 'string' && (
        <Row>
          <Item>
            <Field label="Include">
              <TextInput value={model.terms_include} label="Include" onChange={(text) => onChange({ terms_include: text })} />
            </Field>
          </Item>
          <Item>
            <Field label="Exclude">
              <TextInput value={model.terms_exclude} label="Exclude" onChange={(text) => onChange({ terms_exclude: text })} />
            </Field>
          </Item>
        </Row>
      )}
      <Row>
        <Item>
          <Field label="Top">
            <TextInput type="number" placeholder="Size" label="Top" value={Number(model.terms_size)} onChange={(text) => onChange({ terms_size: text })} />
          </Field>
        </Item>
        <Item>
          <Field label="Order by">
            <MetricSelect
              metrics={series.metrics}
              clearable={false}
              additionalOptions={[choice('Doc Count (default)', '_count'), choice('Terms', '_key')]}
              restrict="basic"
              value={model.terms_order_by}
              onChange={(value) => onChange({ terms_order_by: value })}
            />
          </Field>
        </Item>
        <Item>
          <Field label="Direction">
            <Combo options={DIRECTIONS} value={model.terms_direction} clearable={false} onChange={(value) => onChange({ terms_direction: value })} />
          </Field>
        </Item>
      </Row>
    </div>
  );
}

/** How a series is split: not at all, by a filter, by several or by the terms of a field */
function Split({ model, panel, fields, onChange, seriesQuantity: quantity }: Omit<SplitProps, 'indexPattern'> & { panel: Panel }) {
  const indexPattern = (model.override_index_pattern ? str(model, 'series_index_pattern') : '') || str(panel, 'index_pattern');
  // A series just split by filters starts with one, in the series' colour
  const needsFilters = model.split_mode === 'filters' && !model.split_filters;
  const latest = useRef({ onChange, color: model.color });
  latest.current = { onChange, color: model.color };
  useEffect(() => {
    if (!needsFilters) return;
    latest.current.onChange({
      split_filters: [{ color: latest.current.color, id: uuid(), filter: { query: '', language: defaultQueryLanguage() } }],
    });
  }, [needsFilters]);
  const props: SplitProps = { model, indexPattern, fields, onChange, seriesQuantity: quantity };
  switch (model.split_mode ?? 'everything') {
    case 'terms':
      return <SplitByTerms {...props} />;
    case 'filter':
      return <SplitByFilter {...props} />;
    case 'filters':
      return <SplitByFilters {...props} />;
    default:
      return <SplitByEverything {...props} />;
  }
}

// --- The options of a series ------------------------------------------------------------------------------------

interface ConfigProps {
  model: Series;
  panel: Panel;
  fields: Fields;
  onChange: (part: Doc) => void;
  seriesQuantity: Record<string, number>;
}

/** Whether the series overrides the panel's index pattern, and the one it uses instead */
function OverrideIndexPattern({ model, fields, onChange, indexModel }: { model: Series; fields: Fields; onChange: (part: Doc) => void; indexModel: Doc }) {
  return (
    <Row gap="s" wrap responsive={false}>
      <Item grow={false}>
        <Label>Override Index Pattern?</Label>
        <Spacer size="s" />
        <YesNo name="override_index_pattern" value={model.override_index_pattern} onChange={onChange} />
      </Item>
      <Item>
        <IndexPatternOptions fields={fields} model={indexModel} onChange={onChange} prefix="series_" disabled={!model.override_index_pattern} />
      </Item>
    </Row>
  );
}

const templateHelp = (space: boolean) => (
  <span>
    eg.{space ? ' ' : ''}
    <span className="tvbCode">
      <code>{'{{value}}/s'}</code>
    </span>
  </span>
);

/** The options of a series of a metric, top N, gauge or Markdown panel */
function SeriesConfig({ model: given, panel, fields, onChange }: ConfigProps) {
  const model: Series = { offset_time: '', value_template: '', ...given };
  return (
    <div className="tvbAggRow">
      <DataFormatPicker value={model.formatter} onChange={(formatter) => onChange({ formatter })} />
      <Rule size="s" />
      <Field label="Filter" full>
        <QueryBarWrapper query={readQuery(model.filter)} onChange={(filter) => onChange({ filter })} indexPatterns={[queryIndexPattern(given, panel)]} />
      </Field>
      <Rule size="s" />
      <Row gap="s">
        <Item>
          <Field label="Template" help={templateHelp(true)} full>
            <TextInput value={model.value_template} label="Template" onChange={(text) => onChange({ value_template: text })} />
          </Field>
        </Item>
        <Item>
          <Field label="Offset series time by (1m, 1h, 1w, 1d)">
            <TextInput value={model.offset_time} label="Offset series time by (1m, 1h, 1w, 1d)" onChange={(text) => onChange({ offset_time: text })} testId="offsetTimeSeries" />
          </Field>
        </Item>
      </Row>
      <Rule size="s" />
      <OverrideIndexPattern model={model} fields={fields} onChange={onChange} indexModel={given} />
    </div>
  );
}

const STACKED = [choice('None', 'none'), choice('Stacked', 'stacked'), choice('Stacked within series', 'stacked_within_series'), choice('Percent', 'percent')];
const AXIS_POSITIONS = [choice('Right', 'right'), choice('Left', 'left'), choice('Hidden', 'hidden')];
const AXIS_SCALES = [choice('Normal', 'normal'), choice('Log', 'log')];
const CHART_TYPES = [choice('Bar', 'bar'), choice('Line', 'line')];
const SPLIT_COLORS = [choice('Default palette', 'opensearchDashboards'), choice('Rainbow', 'rainbow'), choice('Gradient', 'gradient')];

/** The options of a time series' series: how it is drawn, its axis and its own index pattern */
function TimeseriesConfig({ model: given, panel, fields, onChange, seriesQuantity: quantity }: ConfigProps) {
  const model: Series = {
    fill: '',
    line_width: '',
    point_size: '',
    value_template: '{{value}}',
    offset_time: '',
    split_color_mode: 'opensearchDashboards',
    axis_min: '',
    axis_max: '',
    stacked: 'none',
    steps: 0,
    ...given,
  };
  const stacked = STACKED.map((option) => (option.value === 'percent' ? { ...option, disabled: isPercentDisabled(quantity[model.id]) } : option));
  const separate = Boolean(model.separate_axis);
  const select = (name: string, options: Choice[], label: string, disabled?: boolean) => (
    <Item grow={false}>
      <Field label={label}>
        <Combo options={options} value={model[name]} clearable={false} fullWidth={false} disabled={disabled} onChange={(value) => onChange({ [name]: value })} />
      </Field>
    </Item>
  );
  const number = (name: string, label: string, step?: number, disabled?: boolean) => (
    <Item grow={false}>
      <Field label={label}>
        <TextInput type="number" step={step} label={label} disabled={disabled} value={Number(model[name])} onChange={(text) => onChange({ [name]: text })} />
      </Field>
    </Item>
  );
  return (
    <div className="tvbAggRow">
      <Row gap="s">
        <Item grow={false}>
          <DataFormatPicker value={model.formatter} onChange={(formatter) => onChange({ formatter })} />
        </Item>
        <Item>
          <Field label="Template" help={templateHelp(false)} full>
            <TextInput value={model.value_template} label="Template" onChange={(text) => onChange({ value_template: text })} testId="tsvb_series_value" />
          </Field>
        </Item>
      </Row>
      <Rule size="s" />
      <Field label="Filter" full>
        <QueryBarWrapper query={readQuery(model.filter)} onChange={(filter) => onChange({ filter })} indexPatterns={[queryIndexPattern(given, panel)]} />
      </Field>
      <Rule size="s" />
      {(model.chart_type === 'line' || model.chart_type === 'bar') && (
        <Row gap="s" wrap responsive={false}>
          {select('chart_type', CHART_TYPES, 'Chart type')}
          {select('stacked', stacked, 'Stacked')}
          {number('fill', 'Fill (0 to 1)', 0.1)}
          {number('line_width', 'Line width')}
          {model.chart_type === 'line' && number('point_size', 'Point size')}
          {model.chart_type === 'line' && (
            <Item grow={false}>
              <Label>Steps</Label>
              <Spacer size="s" />
              <YesNo name="steps" value={model.steps} onChange={onChange} />
            </Item>
          )}
        </Row>
      )}
      <Rule size="s" />
      <Row wrap responsive={false}>
        <Item>
          <Field label="Offset series time by (1m, 1h, 1w, 1d)">
            <TextInput value={model.offset_time} label="Offset series time by (1m, 1h, 1w, 1d)" onChange={(text) => onChange({ offset_time: text })} testId="offsetTimeSeries" />
          </Field>
        </Item>
        <Item>
          <Label>Hide in legend</Label>
          <Spacer size="s" />
          <YesNo name="hide_in_legend" value={model.hide_in_legend} onChange={onChange} />
        </Item>
        <Item>
          <Field label="Split color theme">
            <Combo options={SPLIT_COLORS} value={model.split_color_mode} clearable={false} onChange={(value) => onChange({ split_color_mode: value })} />
          </Field>
        </Item>
      </Row>
      <Rule size="s" />
      <Row wrap responsive={false}>
        <Item grow={false}>
          <Label>Separate axis?</Label>
          <Spacer size="s" />
          <YesNo name="separate_axis" value={model.separate_axis} onChange={onChange} />
        </Item>
        <Item grow={false}>
          <Field label="Axis min">
            <TextInput type="number" label="Axis min" disabled={!separate} value={model.axis_min} onChange={(text) => onChange({ axis_min: text })} />
          </Field>
        </Item>
        <Item grow={false}>
          <Field label="Axis max">
            <TextInput type="number" label="Axis max" disabled={!separate} value={model.axis_max} onChange={(text) => onChange({ axis_max: text })} />
          </Field>
        </Item>
        {select('axis_position', AXIS_POSITIONS, 'Axis position', !separate)}
        {select('axis_scale', AXIS_SCALES, 'Axis scale', !separate)}
      </Row>
      <Rule size="s" />
      {/* A time series' own index pattern has no time range mode: its interval always applies */}
      <OverrideIndexPattern model={model} fields={fields} onChange={onChange} indexModel={{ ...given, type: 'timeseries' }} />
    </div>
  );
}

const AGGREGATE_FUNCTIONS = [
  choice('Sum', 'sum'),
  choice('Max', 'max'),
  choice('Min', 'min'),
  choice('Avg', 'mean'),
  choice('Overall Sum', 'overall_sum'),
  choice('Overall Max', 'overall_max'),
  choice('Overall Min', 'overall_min'),
  choice('Overall Avg', 'overall_avg'),
  choice('Cumulative Sum', 'cumulative_sum'),
];

/** The options of a table's column: its format, filter, trend arrows, aggregate and colour rules */
function TableSeriesConfig({ model: given, panel, fields, onChange }: ConfigProps) {
  const model: Series = { offset_time: '', value_template: '', ...given };
  // A column opens with a colour rule to fill in, as the product's does
  const lacksRules = list(given, 'color_rules').length === 0;
  const latest = useRef(onChange);
  latest.current = onChange;
  useEffect(() => {
    if (lacksRules) latest.current({ color_rules: [{ id: uuid() }] });
    // Only when the options open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="tvbAggRow">
      <Row gap="s">
        <Item grow={false}>
          <DataFormatPicker value={model.formatter} onChange={(formatter) => onChange({ formatter })} />
        </Item>
        <Item>
          <Field label="Template" help={templateHelp(false)} full>
            <TextInput value={model.value_template} label="Template" onChange={(text) => onChange({ value_template: text })} />
          </Field>
        </Item>
      </Row>
      <Rule size="s" />
      <Row wrap responsive={false}>
        <Item>
          <Field label="Filter" full>
            <QueryBarWrapper
              query={readQuery(model.filter)}
              onChange={(filter) => onChange({ filter })}
              indexPatterns={[str(panel, 'index_pattern') || str(panel, 'default_index_pattern')]}
            />
          </Field>
        </Item>
        <Item grow={false}>
          <Label>Show trend arrows?</Label>
          <Spacer size="s" />
          <YesNo name="trend_arrows" value={model.trend_arrows} onChange={onChange} />
        </Item>
      </Row>
      <Rule size="s" />
      <Row wrap responsive={false}>
        <Item>
          <Field label="Field">
            <FieldSelect fields={fields} indexPattern={str(panel, 'index_pattern')} value={model.aggregate_by} onChange={(field) => onChange({ aggregate_by: field })} />
          </Field>
        </Item>
        <Item>
          <Field label="Aggregate function" full>
            <Combo options={AGGREGATE_FUNCTIONS} value={model.aggregate_function} onChange={(value) => onChange({ aggregate_function: value })} />
          </Field>
        </Item>
      </Row>
      <Rule size="s" />
      <h4 className="tvbTitle--xxs">Color rules</h4>
      <Spacer size="s" />
      <ColorRules primaryName="text" primaryVarName="text" hideSecondary model={model} onChange={onChange} name="color_rules" />
    </div>
  );
}

// --- A series -------------------------------------------------------------------------------------------------------

interface SeriesRowProps {
  panel: Panel;
  model: Series;
  fields: Fields;
  colorPicker: boolean;
  disableAdd: boolean;
  disableDelete: boolean;
  seriesQuantity: Record<string, number>;
  onChange: (doc: Series) => void;
  onAdd: () => void;
  onClone: () => void;
  onDelete: () => void;
  handle?: HandleProps;
}

// What each kind of panel shows of a series
const WITH_COLOR = new Set(['timeseries', 'top_n', 'gauge']);
const WITH_ACTIVATION = new Set(['timeseries', 'metric', 'top_n', 'table']);

// The keys each kind of panel reads a series with. The product writes them into the series when
// its metrics or filters change, so a saved series carries them: a time series' even says its kind.
const SERIES_DEFAULTS: Record<string, Doc> = {
  timeseries: { label: '', type: 'timeseries' },
  metric: { label: '' },
  gauge: { label: '' },
  markdown: { label: '', var_name: '' },
};

function SeriesRow(props: SeriesRowProps) {
  const { panel, fields, disableAdd, disableDelete } = props;
  const type = panel.type;
  const [visible, setVisible] = useState(true);
  const [tab, setTab] = useState('metrics');
  const handleChange = (part: Doc) => props.onChange({ ...props.model, ...part });
  const model: Series = { ...SERIES_DEFAULTS[type], ...props.model };
  const markdown = type === 'markdown';
  const colorPicker = WITH_COLOR.has(type) || (type === 'metric' && props.colorPicker);
  const lowerCase = markdown ? 'series' : 'Series';
  const config: ConfigProps = { model: props.model, panel, fields, onChange: handleChange, seriesQuantity: props.seriesQuantity };

  let options: ReactNode;
  if (type === 'timeseries') options = <TimeseriesConfig {...config} />;
  else if (type === 'table') options = <TableSeriesConfig {...config} />;
  else options = <SeriesConfig {...config} />;

  return (
    <div className="tvbSeriesEditor">
      <div className="tvbSeries__header">
        <IconButton
          icon={visible ? 'chevronDown' : 'chevronRight'}
          size="s"
          className="tvbSeries__toggle"
          label="Toggle series editor"
          aria-expanded={visible}
          onClick={() => setVisible(!visible)}
        />
        {colorPicker && <TvbColorPicker disableTrash name="color" value={model.color} onChange={handleChange} />}
        <div className="tvbSeries__label">
          <TextInput value={model.label} placeholder="Label" label={type === 'table' ? 'Label' : undefined} onChange={(label) => handleChange({ label })} />
        </div>
        {markdown && (
          <div className="tvbSeries__label">
            <TextInput value={model.var_name} placeholder="Variable name" onChange={(name) => handleChange({ var_name: name })} />
          </div>
        )}
        <DragHandle handle={props.handle} hidden={markdown || disableDelete} />
        <AddDeleteButtons
          addTooltip={`Add ${lowerCase}`}
          deleteTooltip={`Delete ${lowerCase}`}
          cloneTooltip={`Clone ${lowerCase}`}
          onDelete={props.onDelete}
          onClone={props.onClone}
          onAdd={props.onAdd}
          togglePanelActivation={() => handleChange({ hidden: !model.hidden })}
          isPanelActive={WITH_ACTIVATION.has(type) ? !model.hidden : undefined}
          disableAdd={disableAdd}
          disableDelete={disableDelete}
        />
      </div>
      {visible && (
        <div className="tvbSeries__body">
          <TvbTabs
            tabs={[
              { id: 'metrics', label: 'Metrics' },
              { id: 'options', label: 'Options', testId: 'seriesOptions' },
            ]}
            selected={tab}
            onSelect={setTab}
          />
          {tab === 'metrics' ? (
            <div>
              <Aggs panel={panel} series={model} fields={fields} onChange={(part) => handleChange({ ...model, ...part })} />
              {type !== 'table' && (
                <div className="tvbAggRow tvbAggRow--split">
                  <Split model={model} panel={panel} fields={fields} onChange={handleChange} seriesQuantity={type === 'timeseries' ? props.seriesQuantity : undefined} />
                </div>
              )}
            </div>
          ) : (
            options
          )}
        </div>
      )}
    </div>
  );
}

/** The series of a panel, as many as its kind takes; a gauge has one and a metric two */
export function SeriesEditor({
  model,
  fields,
  onChange,
  visData,
  colorPicker = true,
  limit = Infinity,
}: PanelProps & { colorPicker?: boolean; limit?: number }) {
  const all = model.series;
  const sortable = useSortable(
    all.map((series) => series.id),
    (from, to) => onChange({ series: reorder(all, from, to) })
  );
  const quantity = useMemo(() => seriesQuantity(visData), [visData]);
  return (
    <div className="tvbSeriesList">
      {all
        .filter((_series, index) => index < limit)
        .map((row) => (
          <div key={row.id} ref={sortable.row(row.id)} style={sortable.style(row.id)} className={cx('tvbSeriesList__item', sortable.dragging(row.id) && 'tvbDragging')}>
            <SeriesRow
              panel={model}
              model={row}
              fields={fields}
              colorPicker={colorPicker}
              disableAdd={all.length >= limit}
              disableDelete={all.length < 2}
              seriesQuantity={quantity}
              onChange={(doc) => onChange({ series: collection.change(all, doc) })}
              onAdd={() => onChange({ series: collection.add(all, newSeries()) })}
              onClone={() => onChange({ series: collection.add(all, reIdSeries(row)) })}
              onDelete={() => onChange({ series: collection.remove(all, row) })}
              handle={sortable.handle(row.id)}
            />
          </div>
        ))}
    </div>
  );
}

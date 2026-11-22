/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The metrics of a TSVB series, a row each: the aggregation and what it needs, a field, the metric
 * it is computed from, its percentiles, a script or two queries. A row changes its metric as
 * OpenSearch Dashboards' editors do, writing in the same defaults, so that the params keep the
 * shape the product saves; the chart is drawn from them.
 */

import { useEffect, useRef, type ReactNode } from 'react';
import { cx } from '../../../components/basic';
import { TextArea } from '../../../components/form';
import { Icon } from '../../../components/icon';
import { aggOptions, choice, metricOptions, type MetricOptionsArgs } from './agg_lists';
import {
  AddDeleteButtons,
  Combo,
  DragHandle,
  Field,
  FieldSelect,
  Item,
  QueryBarWrapper,
  Row,
  Spacer,
  TextInput,
  readQuery,
  useSortable,
  type HandleProps,
} from './controls';
import {
  collection,
  inputValue,
  isBasicAgg,
  list,
  newMetric,
  newPercentile,
  newVariable,
  reorder,
  str,
  supportedFieldKinds,
  type Doc,
  type Fields,
  type Metric,
  type Panel,
  type Series,
} from './model';

function AggSelect({
  panelType,
  siblings,
  value,
  onChange,
  label = 'Aggregation',
  full,
}: {
  panelType?: string;
  siblings: Metric[];
  value: unknown;
  onChange: (value: string) => void;
  label?: string;
  full?: boolean;
}) {
  return (
    <Field label={label} full={full}>
      <div data-test-subj="aggSelector">
        <Combo
          options={aggOptions(panelType, siblings)}
          value={value}
          placeholder="Select aggregation"
          clearable={false}
          onChange={(picked) => {
            if (picked) onChange(picked);
          }}
        />
      </div>
    </Field>
  );
}

// --- The metric another is computed from -------------------------------------------------------------

export function MetricSelect({
  value,
  onChange,
  clearable = true,
  ...rest
}: MetricOptionsArgs & { value: unknown; onChange: (value: string | null) => void; clearable?: boolean }) {
  return <Combo options={metricOptions(rest)} value={value} onChange={onChange} placeholder="Select metric…" clearable={clearable} />;
}

// --- A row ------------------------------------------------------------------------------------------------

export interface AggProps {
  model: Metric;
  panel: Panel;
  series: Series;
  siblings: Metric[];
  fields: Fields;
  /** A metric changed: the whole of it */
  onChange: (doc: Doc) => void;
  onAdd: () => void;
  onDelete: () => void;
  disableDelete: boolean;
  handle?: HandleProps;
}

/** The index pattern a series' fields come from: its own when it overrides the panel's */
const seriesIndexPattern = (series: Series, panel: Panel): string =>
  (series.override_index_pattern ? str(series, 'series_index_pattern') : '') || str(panel, 'index_pattern');

/** A change of some keys of a metric, sent as the whole metric */
const changer = (onChange: (doc: Doc) => void, model: Doc) => (part: Doc) => onChange({ ...model, ...part });

/** The frame of a metric's row: whether it is the one drawn, its fields, its grip and its buttons */
function AggRow({ model, siblings, disableDelete, onAdd, onDelete, handle, children }: AggProps & { children: ReactNode }) {
  // The last metric of a series is the one drawn; the others only feed it
  const shown = siblings[siblings.length - 1]?.id === model.id;
  return (
    <div className="tvbAggRow">
      <div className="tvbAggRow__group" data-test-subj="aggRow">
        <div className="tvbAggRow__visibility">
          <Icon name={shown ? 'eye' : 'eyeClosed'} className={cx('tvbAggRow__visibilityIcon', !shown && 'tvbAggRow__visibilityIcon--subdued')} />
        </div>
        <div className="tvbAggRow__children">{children}</div>
        <DragHandle handle={handle} hidden={disableDelete} />
        <AddDeleteButtons testSubj="addMetric" addTooltip="Add Metric" deleteTooltip="Delete Metric" onAdd={onAdd} onDelete={onDelete} disableDelete={disableDelete} />
      </div>
    </div>
  );
}

function StandardAgg(props: AggProps) {
  const { model, panel, series, fields, siblings } = props;
  const change = changer(props.onChange, model);
  return (
    <AggRow {...props}>
      <Row gap="s">
        <Item>
          <AggSelect panelType={panel.type} siblings={siblings} value={model.type} onChange={(type) => change({ type })} full />
        </Item>
        {model.type !== 'count' && (
          <Item>
            <Field label="Field" full>
              <FieldSelect
                fields={fields}
                type={model.type}
                restrict={supportedFieldKinds(model.type)}
                indexPattern={seriesIndexPattern(series, panel)}
                value={model.field}
                onChange={(field) => change({ field })}
              />
            </Field>
          </Item>
        )}
      </Row>
    </AggRow>
  );
}

const PERCENTILE_FIELDS = ['number', 'histogram'];
const PERCENTILE_MODES = [choice('Line', 'line'), choice('Band', 'band')];

/** The percentiles of a percentile aggregation: a value each, drawn as a line or as a band */
function Percentiles({ model, panel, onChange }: { model: Doc; panel: Panel; onChange: (part: Doc) => void }) {
  const rows = list<Doc & { id: string }>(model, 'percentiles');
  if (!Array.isArray(model.percentiles)) return <div />;
  const save = (next: Array<Doc & { id: string }>) => onChange({ percentiles: next });
  const renderRow = (row: Doc & { id: string }) => {
    const item: Doc & { id: string } = { value: '', percentile: '', shade: '', ...row };
    const change = (part: Doc) => save(collection.change(rows, { ...item, ...part }));
    const percentile = (
      <Item grow={false}>
        <TextInput type="number" label="Percentile" placeholder="0" value={item.value === '' ? '' : Number(item.value)} onChange={(value) => change({ value })} />
      </Item>
    );
    // A table shows one number per column: only the last percentile, with no way to draw it
    if (panel.type === 'table') return <Row gap="s" key={item.id}>{percentile}</Row>;
    const band = item.mode === 'band';
    return (
      <Row gap="s" center key={item.id}>
        {percentile}
        <Item grow={false}>
          <span className="tvbLabel">Mode:</span>
        </Item>
        <Item grow={false}>
          <Combo options={PERCENTILE_MODES} value={item.mode} clearable={false} fullWidth={false} onChange={(mode) => change({ mode })} />
        </Item>
        {band && (
          <>
            <Item grow={false}>
              <span className="tvbLabel">Fill to:</span>
            </Item>
            <Item grow={false}>
              <TextInput type="number" step={1} label="Fill to" value={Number(item.percentile)} onChange={(value) => change({ percentile: value })} />
            </Item>
            <Item grow={false}>
              <span className="tvbLabel">Shade (0 to 1):</span>
            </Item>
            <Item grow={false}>
              <TextInput type="number" step={0.1} label="Shade (0 to 1)" value={Number(item.shade)} onChange={(value) => change({ shade: value })} />
            </Item>
          </>
        )}
        <Item>
          <AddDeleteButtons
            onAdd={() => save(collection.add(rows, newPercentile()))}
            onDelete={() => save(collection.remove(rows, item))}
            disableDelete={rows.length < 2}
          />
        </Item>
      </Row>
    );
  };
  const last = rows[rows.length - 1];
  return <div className="tvbPercentiles">{panel.type === 'table' ? last && renderRow(last) : rows.map(renderRow)}</div>;
}

function PercentileAgg(props: AggProps) {
  const { model, panel, series, fields, siblings } = props;
  const change = changer(props.onChange, model);
  // A metric that has just become a percentile starts with the median
  const missing = !Array.isArray(model.percentiles);
  const latest = useRef(change);
  latest.current = change;
  useEffect(() => {
    if (missing) latest.current({ percentiles: [newPercentile({ value: 50 })] });
  }, [missing]);
  return (
    <AggRow {...props}>
      <Row gap="s">
        <Item>
          <AggSelect panelType={panel.type} siblings={siblings} value={model.type} onChange={(type) => change({ type })} />
        </Item>
        <Item>
          <Field label="Field">
            <FieldSelect
              fields={fields}
              type={model.type}
              restrict={PERCENTILE_FIELDS}
              indexPattern={seriesIndexPattern(series, panel)}
              value={model.field}
              onChange={(field) => change({ field })}
            />
          </Field>
        </Item>
      </Row>
      <Spacer size="m" />
      <Percentiles model={model} panel={panel} onChange={change} />
    </AggRow>
  );
}

function DerivativeAgg(props: AggProps) {
  const { panel, siblings } = props;
  const model: Metric = { unit: '', ...props.model };
  const change = changer(props.onChange, model);
  return (
    <AggRow {...props}>
      <Row gap="s">
        <Item>
          <AggSelect panelType={panel.type} siblings={siblings} value={model.type} onChange={(type) => change({ type })} full />
        </Item>
        <Item>
          <Field label="Metric" full>
            <MetricSelect metrics={siblings} metric={model} value={model.field} onChange={(field) => change({ field })} />
          </Field>
        </Item>
        <Item>
          <Field label="Units (1s, 1m, etc)" full>
            <TextInput value={model.unit} label="Units (1s, 1m, etc)" onChange={(unit) => change({ unit })} />
          </Field>
        </Item>
      </Row>
    </AggRow>
  );
}

const MODEL_TYPES = [
  choice('Simple', 'simple'),
  choice('Linear', 'linear'),
  choice('Exponentially Weighted', 'ewma'),
  choice('Holt-Linear', 'holt'),
  choice('Holt-Winters', 'holt_winters'),
];
const MULTIPLICATIVE = [choice('True', 'true'), choice('False', 'false')];

function MovingAverageAgg(props: AggProps) {
  const { panel, siblings } = props;
  // Any change writes in every default of a moving average, as the product's editor does
  const model: Metric = { model_type: 'simple', alpha: 0.3, beta: 0.1, gamma: 0.3, period: 1, multiplicative: true, window: 5, ...props.model };
  const change = changer(props.onChange, model);
  const number = (name: string) => (text: string) => change({ [name]: Number(text) });
  const type = model.model_type;
  const exponential = type === 'ewma' || type === 'holt' || type === 'holt_winters';
  const hint = type === 'holt_winters' && Number(model.period) * 2 > Number(model.window);
  return (
    <AggRow {...props}>
      <Row gap="s">
        <Item>
          <AggSelect panelType={panel.type} siblings={siblings} value={model.type} onChange={(next) => change({ type: next })} />
        </Item>
        <Item>
          <Field label="Metric">
            <MetricSelect metrics={siblings} metric={model} value={model.field} onChange={(field) => change({ field })} />
          </Field>
        </Item>
      </Row>
      <Spacer size="m" />
      <Row gap="s">
        <Item>
          <Field label="Model">
            <Combo options={MODEL_TYPES} value={type} placeholder="Select" clearable={false} onChange={(value) => change({ model_type: value })} />
          </Field>
        </Item>
        <Item>
          <Field label="Window Size" help={hint ? 'Window must always be at least twice the size of your period' : undefined}>
            <TextInput value={model.window} label="Window Size" onChange={number('window')} />
          </Field>
        </Item>
      </Row>
      {exponential && (
        <>
          <Spacer size="m" />
          <Row gap="s">
            <Item>
              <Field label="Alpha">
                <TextInput type="number" step={0.1} label="Alpha" value={model.alpha} onChange={number('alpha')} />
              </Field>
            </Item>
            {(type === 'holt' || type === 'holt_winters') && (
              <Item>
                <Field label="Beta">
                  <TextInput type="number" step={0.1} label="Beta" value={model.beta} onChange={number('beta')} />
                </Field>
              </Item>
            )}
            {type === 'holt_winters' && (
              <>
                <Item>
                  <Field label="Gamma">
                    <TextInput type="number" step={0.1} label="Gamma" value={model.gamma} onChange={number('gamma')} />
                  </Field>
                </Item>
                <Item>
                  <Field label="Period">
                    <TextInput type="number" step={1} label="Period" value={model.period} onChange={number('period')} />
                  </Field>
                </Item>
                <Item>
                  <Field label="Multiplicative">
                    <Combo
                      options={MULTIPLICATIVE}
                      value={String(model.multiplicative)}
                      placeholder="Select"
                      onChange={(value) => change({ multiplicative: value === null ? null : value === 'true' })}
                    />
                  </Field>
                </Item>
              </>
            )}
          </Row>
        </>
      )}
    </AggRow>
  );
}

/** The variables of a script: a name each, and the metric it stands for */
function CalculationVars({
  model,
  metrics,
  onChange,
  includeSiblings,
}: {
  model: Doc;
  metrics: Metric[];
  onChange: (part: Doc) => void;
  includeSiblings?: boolean;
}) {
  const rows = list<Doc & { id: string }>(model, 'variables');
  if (!Array.isArray(model.variables)) return <div />;
  const save = (next: Array<Doc & { id: string }>) => onChange({ variables: next });
  return (
    <div className="tvbVars">
      {rows.map((row) => {
        const change = (part: Doc) => save(collection.change(rows, { ...row, ...part }));
        return (
          <Row gap="s" center key={row.id} testId="varRow">
            <Item>
              <TextInput value={row.name} placeholder="Variable name" label="Variable name" onChange={(name) => change({ name })} />
            </Item>
            <Item className="tvbAggs__varMetricWrapper">
              <MetricSelect metrics={metrics} metric={model} value={row.field} includeSiblings={includeSiblings} onChange={(field) => change({ field })} />
            </Item>
            <Item>
              <AddDeleteButtons
                onAdd={() => save(collection.add(rows, newVariable()))}
                onDelete={() => save(collection.remove(rows, row))}
                disableDelete={rows.length < 2}
              />
            </Item>
          </Row>
        );
      })}
    </div>
  );
}

const code = (text: string) => <code className="tvbCode">{text}</code>;

function MathAgg(props: AggProps) {
  const { model, siblings } = props;
  const change = changer(props.onChange, model);
  // A metric that has just become Math starts with one variable and no expression
  const missing = !Array.isArray(model.variables) || model.script === undefined;
  const latest = useRef(change);
  latest.current = change;
  useEffect(() => {
    if (missing) latest.current({ variables: [newVariable()], script: '' });
  }, [missing]);
  return (
    <AggRow {...props}>
      <div className="tvbColumn">
        {/* Math is offered the same aggregations whatever the panel */}
        <AggSelect siblings={siblings} value={model.type} onChange={(type) => change({ type })} />
        <Field label="Variables" full>
          <CalculationVars model={model} metrics={siblings} onChange={change} includeSiblings />
        </Field>
        <Field
          label="Expression"
          full
          help={
            <>
              This field uses basic math expressions (see{' '}
              <a className="atlLink" href="https://mathjs.org/docs/reference/functions.html" target="_blank" rel="noreferrer">
                Math.js
                <Icon name="external" className="tvbLinkIcon" />
              </a>
              ) - Variables are keys on the {code('params')} object, i.e. {code('params.<name>')} To access all the data use{' '}
              {code('params._all.<name>.values')} for an array of the values and {code('params._all.<name>.timestamps')} for an array of the
              timestamps. {code('params._timestamp')} is available for the current bucket&apos;s timestamp, {code('params._index')} is
              available for the current bucket&apos;s index, and {code('params._interval')}s available for the interval in milliseconds.
            </>
          }
        >
          <TextArea value={str(model, 'script')} onChange={(script) => change({ script })} testId="mathExpression" id="mathExpressionInput" />
        </Field>
      </div>
    </AggRow>
  );
}

function FilterRatioAgg(props: AggProps) {
  const { series, fields, panel, siblings } = props;
  const change = changer(props.onChange, props.model);
  const indexPattern = seriesIndexPattern(series, panel);
  const model: Metric = { metric_agg: 'count', ...props.model };
  const histogram = (fields[indexPattern] ?? []).find((field) => field.name === model.field)?.type === 'histogram';
  const metricAgg = str(model, 'metric_agg');
  return (
    <AggRow {...props}>
      <Row gap="s">
        <Item>
          <AggSelect panelType={panel.type} siblings={siblings} value={model.type} onChange={(type) => change({ type })} />
        </Item>
        <Item>
          <Field label="Numerator">
            <QueryBarWrapper query={readQuery(model.numerator)} onChange={(numerator) => change({ numerator })} indexPatterns={[indexPattern]} />
          </Field>
        </Item>
        <Item>
          <Field label="Denominator">
            <QueryBarWrapper query={readQuery(model.denominator)} onChange={(denominator) => change({ denominator })} indexPatterns={[indexPattern]} />
          </Field>
        </Item>
      </Row>
      <Spacer size="m" />
      <Row gap="s">
        <Item>
          <AggSelect
            label="Metric Aggregation"
            panelType={histogram ? 'histogram' : 'filter_ratio'}
            siblings={siblings}
            value={metricAgg}
            onChange={(value) => change({ metric_agg: value })}
          />
        </Item>
        {metricAgg !== 'count' && (
          <Item>
            <Field label="Field">
              <FieldSelect
                fields={fields}
                type={metricAgg}
                restrict={supportedFieldKinds(metricAgg)}
                indexPattern={indexPattern}
                value={model.field}
                onChange={(field) => change({ field })}
              />
            </Field>
          </Item>
        )}
      </Row>
    </AggRow>
  );
}

function StaticAgg(props: AggProps) {
  const { panel, siblings } = props;
  const change = changer(props.onChange, props.model);
  const model: Metric = { value: '', ...props.model };
  return (
    <AggRow {...props}>
      <Row gap="s">
        <Item>
          <AggSelect panelType={panel.type} siblings={siblings} value={model.type} onChange={(type) => change({ type })} />
        </Item>
        <Item>
          <Field label="Static Value">
            <TextInput type="number" step={0.1} label="Static Value" value={model.value === '' ? '' : Number(model.value)} onChange={(value) => change({ value })} />
          </Field>
        </Item>
      </Row>
    </AggRow>
  );
}

/** A metric this editor has no form for yet: its aggregation can still be changed */
function OtherAgg(props: AggProps) {
  const { model, panel, siblings } = props;
  const change = changer(props.onChange, model);
  return (
    <AggRow {...props}>
      <Row gap="s">
        <Item>
          <AggSelect panelType={panel.type} siblings={siblings} value={model.type} onChange={(type) => change({ type })} full />
        </Item>
        <Item>
          <Field label="Field" full>
            <TextInput value={inputValue(model.field)} label="Field" disabled onChange={() => undefined} />
          </Field>
        </Item>
      </Row>
    </AggRow>
  );
}

const AGGS: Record<string, (props: AggProps) => ReactNode> = {
  count: StandardAgg,
  avg: StandardAgg,
  max: StandardAgg,
  min: StandardAgg,
  sum: StandardAgg,
  sum_of_squares: StandardAgg,
  variance: StandardAgg,
  cardinality: StandardAgg,
  value_count: StandardAgg,
  percentile: PercentileAgg,
  derivative: DerivativeAgg,
  moving_average: MovingAverageAgg,
  math: MathAgg,
  filter_ratio: FilterRatioAgg,
  static: StaticAgg,
};

/**
 * The metrics of a series, sorted by dragging. A series of one metric that is made a pipeline
 * aggregation gets the pipeline as a second metric, computed from the first, as in the product.
 */
export function Aggs({ panel, series, fields, onChange }: { panel: Panel; series: Series; fields: Fields; onChange: (part: Doc) => void }) {
  const metrics = series.metrics;
  const sortable = useSortable(
    metrics.map((metric) => metric.id),
    (from, to) => onChange({ metrics: reorder(metrics, from, to) })
  );
  const save = (next: Metric[]) => onChange({ metrics: next });
  const change = (doc: Doc) => {
    if (metrics.length === 1 && !isBasicAgg(doc)) {
      const metric: Metric = { ...newMetric(), type: String(doc.type) };
      if (!['calculation', 'series_agg'].includes(metric.type)) metric.field = String(doc.id);
      save(collection.add(metrics, metric));
    } else save(collection.change(metrics, doc as Metric));
  };
  return (
    <div className="tvbAggList">
      {metrics.map((metric) => {
        const Component = AGGS[metric.type] ?? OtherAgg;
        return (
          <div key={metric.id} ref={sortable.row(metric.id)} style={sortable.style(metric.id)} className={cx('tvbAggList__item', sortable.dragging(metric.id) && 'tvbDragging')}>
            <Component
              model={metric}
              panel={panel}
              series={series}
              siblings={metrics}
              fields={fields}
              onChange={change}
              onAdd={() => save(collection.add(metrics, newMetric()))}
              onDelete={() => save(collection.remove(metrics, metric))}
              disableDelete={metrics.length < 2}
              handle={sortable.handle(metric.id)}
            />
          </div>
        );
      })}
    </div>
  );
}

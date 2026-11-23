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
const NUMBER_FIELDS = ['number'];
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
    if (panel.type === 'table') return (
        <Row gap="s" responsive={false} key={item.id}>
          {percentile}
        </Row>
      );
    // What a band fills to and how solid it is, hidden only for a line, as the product hides them
    const band = item.mode !== 'line';
    return (
      <Row gap="s" center responsive={false} key={item.id}>
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
          <Row gap="s" center responsive={false} key={row.id} testId="varRow">
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

const code = (text: string) => (
  <span className="tvbCode">
    <code>{text}</code>
  </span>
);

/** A script, in the original's compressed text area: three lines, set on a line of text as there */
function ScriptArea({ value, onChange, testId, id }: { value: string; onChange: (value: string) => void; testId?: string; id?: string }) {
  return (
    <div className="tvbScript">
      <TextArea className="tvbScript__area" rows={3} value={value} onChange={onChange} testId={testId} id={id} />
    </div>
  );
}

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
              <a href="https://mathjs.org/docs/reference/functions.html" target="_blank" rel="noreferrer">
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
          <ScriptArea value={str(model, 'script')} onChange={(script) => change({ script })} testId="mathExpression" id="mathExpressionInput" />
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

const STD_MODES = [choice('Raw', 'raw'), choice('Upper Bound', 'upper'), choice('Lower Bound', 'lower')];
const BAND_MODE = choice('Bounds Band', 'band');

function StandardDeviationAgg(props: AggProps) {
  const { panel, series, fields, siblings } = props;
  const model: Metric = { sigma: '', ...props.model };
  const change = changer(props.onChange, model);
  // A table shows one number per column: no band
  const modes = panel.type === 'table' ? STD_MODES : [...STD_MODES, BAND_MODE];
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
              restrict={NUMBER_FIELDS}
              indexPattern={seriesIndexPattern(series, panel)}
              value={model.field}
              onChange={(field) => change({ field })}
            />
          </Field>
        </Item>
        <Item grow={false}>
          <Field label="Sigma">
            <TextInput value={model.sigma} label="Sigma" onChange={(sigma) => change({ sigma })} />
          </Field>
        </Item>
        <Item>
          <Field label="Mode">
            <Combo options={modes} value={model.mode} onChange={(mode) => change({ mode })} />
          </Field>
        </Item>
      </Row>
    </AggRow>
  );
}

/** Overall average, max, min, sum and the others: one number over all the buckets of a metric */
function StandardSiblingAgg(props: AggProps) {
  const { panel, siblings } = props;
  const model: Metric = { sigma: '', ...props.model };
  const change = changer(props.onChange, model);
  const deviation = model.type === 'std_deviation_bucket';
  return (
    <AggRow {...props}>
      <Row gap="s">
        <Item>
          <AggSelect panelType={panel.type} siblings={siblings} value={model.type} onChange={(type) => change({ type })} />
        </Item>
        <Item>
          <Field label="Metric">
            <MetricSelect metrics={siblings} metric={model} exclude={['percentile']} value={model.field} onChange={(field) => change({ field })} />
          </Field>
        </Item>
        {deviation && (
          <>
            <Item grow={false}>
              <Field label="Sigma">
                <TextInput value={model.sigma} label="Sigma" onChange={(sigma) => change({ sigma })} />
              </Field>
            </Item>
            <Item>
              <Field label="Mode">
                <Combo options={[...STD_MODES, BAND_MODE]} value={model.mode} onChange={(mode) => change({ mode })} />
              </Field>
            </Item>
          </>
        )}
      </Row>
    </AggRow>
  );
}

/** A metric computed from another by name only: cumulative sum, positive only */
function PipelineAgg(props: AggProps & { defaults?: Doc }) {
  const { panel, siblings, defaults } = props;
  const model: Metric = { ...defaults, ...props.model };
  const change = changer(props.onChange, model);
  return (
    <AggRow {...props}>
      <Row gap="s">
        <Item>
          <AggSelect panelType={panel.type} siblings={siblings} value={model.type} onChange={(type) => change({ type })} />
        </Item>
        <Item>
          <Field label="Metric">
            <MetricSelect metrics={siblings} metric={model} value={model.field} onChange={(field) => change({ field })} />
          </Field>
        </Item>
      </Row>
    </AggRow>
  );
}

const CumulativeSumAgg = (props: AggProps) => <PipelineAgg {...props} />;

// A positive only keeps the units of a derivative it never uses, as the product's does
const PositiveOnlyAgg = (props: AggProps) => <PipelineAgg {...props} defaults={{ unit: '' }} />;

function SerialDiffAgg(props: AggProps) {
  const { panel, siblings } = props;
  const model: Metric = { lag: '', ...props.model };
  const change = changer(props.onChange, model);
  return (
    <AggRow {...props}>
      <Row gap="s">
        <Item>
          <AggSelect panelType={panel.type} siblings={siblings} value={model.type} onChange={(type) => change({ type })} />
        </Item>
        <Item>
          <Field label="Metric">
            <MetricSelect metrics={siblings} metric={model} value={model.field} onChange={(field) => change({ field })} />
          </Field>
        </Item>
        <Item>
          <Field label="Lag">
            {/* The lag is typed as text and kept as a number, as the product keeps it */}
            <TextInput value={model.lag} label="Lag" onChange={(lag) => change({ lag: Number(lag) })} />
          </Field>
        </Item>
      </Row>
    </AggRow>
  );
}

const RATE_UNITS = [
  choice('auto', ''),
  choice('per millisecond', '1ms'),
  choice('per second', '1s'),
  choice('per minute', '1m'),
  choice('per hour', '1h'),
  choice('per day', '1d'),
];

function PositiveRateAgg(props: AggProps) {
  const { panel, series, fields, siblings } = props;
  const model: Metric = { unit: '', ...props.model };
  const change = changer(props.onChange, model);
  return (
    <AggRow {...props}>
      <Row gap="s">
        <Item>
          <AggSelect panelType={panel.type} siblings={siblings} value={model.type} onChange={(type) => change({ type })} full />
        </Item>
        <Item>
          <Field label="Field" full>
            <FieldSelect
              fields={fields}
              type={model.type}
              restrict={NUMBER_FIELDS}
              indexPattern={seriesIndexPattern(series, panel)}
              value={model.field}
              onChange={(field) => change({ field })}
            />
          </Field>
        </Item>
        <Item>
          <Field label="Scale" full>
            <Combo options={RATE_UNITS} value={model.unit} placeholder="Select scale..." onChange={(unit) => change({ unit })} />
          </Field>
        </Item>
      </Row>
      <Spacer size="s" />
      <p className="tvbText tvbText--xs tvbText--subdued tvbText--wrap">
        This aggregation should only be applied to{' '}
        <a href="https://en.wikipedia.org/wiki/Monotonic_function" target="_blank" rel="noreferrer">
          monotonically increasing numbers
        </a>
        , it is a shortcut for applying max, derivative and positive only to a field.
      </p>
    </AggRow>
  );
}

const SERIES_FUNCTIONS = [
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

/** A message in place of a metric's settings */
function Unavailable({ children }: { children: ReactNode }) {
  return <h6 className="tvbTitle--xxxs tvbAggRow__unavailable">{children}</h6>;
}

function SeriesAgg(props: AggProps) {
  const { model, panel, siblings } = props;
  const change = changer(props.onChange, model);
  if (panel.type === 'table') {
    return (
      <AggRow {...props}>
        <Unavailable>Series Agg is not compatible with the table visualization.</Unavailable>
      </AggRow>
    );
  }
  return (
    <AggRow {...props}>
      <Row gap="s">
        <Item>
          <AggSelect panelType={panel.type} siblings={siblings} value={model.type} onChange={(type) => change({ type })} />
        </Item>
        <Item>
          <Field label="Function">
            <Combo options={SERIES_FUNCTIONS} value={model.function} onChange={(value) => change({ function: value })} />
          </Field>
        </Item>
      </Row>
    </AggRow>
  );
}

const ORDERS = [choice('Asc', 'asc'), choice('Desc', 'desc')];
const DATE_FIELDS = ['date'];

/** How the values of the latest documents are made one: by the kind of the field */
function aggWithOptions(kind: string | undefined, allowed: string[]) {
  if (!kind || !allowed.includes(kind)) return [];
  if (kind === 'number') return [choice('Avg', 'avg'), choice('Max', 'max'), choice('Min', 'min'), choice('Sum', 'sum')];
  if (kind === 'string') return [choice('Concatenate', 'concat')];
  return [];
}

function TopHitAgg(props: AggProps) {
  const { fields, series, panel, siblings } = props;
  const model: Metric = { size: 1, agg_with: 'noop', order: 'desc', ...props.model };
  const change = changer(props.onChange, model);
  const indexPattern = seriesIndexPattern(series, panel);
  // Panels that show one value as text can join strings too
  const kinds = ['table', 'metric', 'markdown'].includes(str(panel, 'type')) ? ['number', 'string'] : ['number'];
  const field = (fields[indexPattern] ?? []).find((item) => item.name === model.field);
  return (
    <AggRow {...props}>
      <Row gap="s">
        <Item>
          <AggSelect panelType={panel.type} siblings={siblings} value={model.type} onChange={(type) => change({ type })} />
        </Item>
        <Item>
          <Field label="Field">
            <FieldSelect fields={fields} type={model.type} restrict={kinds} indexPattern={indexPattern} value={model.field} onChange={(value) => change({ field: value })} />
          </Field>
        </Item>
      </Row>
      <Spacer size="m" />
      <Row gap="s">
        <Item grow={false}>
          <Field label="Size">
            <TextInput value={model.size} label="Size" onChange={(size) => change({ size })} />
          </Field>
        </Item>
        <Item>
          <Field label="Aggregate with">
            <Combo
              options={aggWithOptions(field?.type, kinds)}
              value={model.agg_with}
              placeholder="Select..."
              clearable={false}
              onChange={(value) => change({ agg_with: value })}
            />
          </Field>
        </Item>
        <Item>
          <Field label="Order by">
            <FieldSelect fields={fields} restrict={DATE_FIELDS} indexPattern={indexPattern} value={model.order_by} onChange={(value) => change({ order_by: value })} />
          </Field>
        </Item>
        <Item>
          <Field label="Order">
            <Combo options={ORDERS} value={model.order} placeholder="Select..." clearable={false} onChange={(order) => change({ order })} />
          </Field>
        </Item>
      </Row>
    </AggRow>
  );
}

const PERCENTILE_RANK_FIELDS = ['number', 'histogram'];

/** The values a percentile rank is asked of: one a row, each kept as it was typed */
function PercentileRankValues({ values, table, onChange }: { values: unknown[]; table: boolean; onChange: (values: unknown[]) => void }) {
  const renderRow = (index: number, value: unknown, disableAdd: boolean, disableDelete: boolean) => (
    <div className="tvbAggRow__multiValueRow" key={`percentileRankValue__item${index}`}>
      <Row gap="l" center responsive={false}>
        <Item grow={false}>
          <span className="tvbLabel">Value:</span>
        </Item>
        <Item grow={false}>
          <TextInput
            type="number"
            placeholder="0"
            label="Value"
            value={value === '' || value === null || value === undefined ? '' : Number(value)}
            onChange={(text) => onChange(values.map((item, at) => (at === index ? text : item)))}
          />
        </Item>
        <Item grow={false}>
          <AddDeleteButtons
            onAdd={() => onChange([...values, ''])}
            onDelete={() => onChange(values.filter((_, at) => at !== index))}
            disableAdd={disableAdd}
            disableDelete={disableDelete}
          />
        </Item>
      </Row>
      <Spacer />
    </div>
  );
  // A table shows one number per column: only the last value, which stays
  if (table) return <div className="tvbColumn tvbColumn--xs">{renderRow(values.length - 1, values[values.length - 1] ?? '', true, true)}</div>;
  return <div className="tvbColumn tvbColumn--xs">{values.map((value, index) => renderRow(index, value ?? '', false, values.length < 2))}</div>;
}

function PercentileRankAgg(props: AggProps) {
  const { series, panel, fields, siblings } = props;
  const model: Metric = { values: [''], ...props.model };
  const change = changer(props.onChange, model);
  const values = Array.isArray(model.values) ? (model.values as unknown[]) : undefined;
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
              restrict={PERCENTILE_RANK_FIELDS}
              indexPattern={seriesIndexPattern(series, panel)}
              value={model.field}
              onChange={(field) => change({ field })}
            />
          </Field>
        </Item>
      </Row>
      <Spacer />
      {values && <PercentileRankValues values={values} table={panel.type === 'table'} onChange={(next) => change({ values: next })} />}
    </AggRow>
  );
}

/** A metric of an aggregation the product no longer has: it can only be deleted */
function UnsupportedAgg(props: AggProps) {
  return (
    <AggRow {...props}>
      <Unavailable>
        The {code(props.model.type)} aggregation is no longer supported.
      </Unavailable>
    </AggRow>
  );
}

function CalculationAgg(props: AggProps) {
  const { model, panel, siblings } = props;
  const change = changer(props.onChange, model);
  // A metric that has just become a bucket script starts with one variable and no script
  const missing = !Array.isArray(model.variables) || model.script === undefined;
  const latest = useRef(change);
  latest.current = change;
  useEffect(() => {
    if (missing) latest.current({ variables: [newVariable()], script: '' });
  }, [missing]);
  return (
    <AggRow {...props}>
      <div className="tvbColumn">
        <AggSelect panelType={panel.type} siblings={siblings} value={model.type} onChange={(type) => change({ type })} />
        <Field label="Variables" full>
          <CalculationVars model={model} metrics={siblings} onChange={change} />
        </Field>
        <Field
          label="Painless Script"
          full
          help={
            <>
              Variables are keys on the {code('params')} object, i.e. {code('params.<name>')}. To access the bucket interval (in milliseconds)
              use {code('params._interval')}.
            </>
          }
        >
          <ScriptArea value={str(model, 'script')} onChange={(script) => change({ script })} />
        </Field>
      </div>
    </AggRow>
  );
}

const AGGS: Record<string, (props: AggProps) => ReactNode> = {
  count: StandardAgg,
  avg: StandardAgg,
  max: StandardAgg,
  min: StandardAgg,
  sum: StandardAgg,
  std_deviation: StandardDeviationAgg,
  sum_of_squares: StandardAgg,
  variance: StandardAgg,
  avg_bucket: StandardSiblingAgg,
  max_bucket: StandardSiblingAgg,
  min_bucket: StandardSiblingAgg,
  sum_bucket: StandardSiblingAgg,
  variance_bucket: StandardSiblingAgg,
  sum_of_squares_bucket: StandardSiblingAgg,
  std_deviation_bucket: StandardSiblingAgg,
  percentile: PercentileAgg,
  percentile_rank: PercentileRankAgg,
  cardinality: StandardAgg,
  value_count: StandardAgg,
  calculation: CalculationAgg,
  cumulative_sum: CumulativeSumAgg,
  moving_average: MovingAverageAgg,
  derivative: DerivativeAgg,
  series_agg: SeriesAgg,
  serial_diff: SerialDiffAgg,
  filter_ratio: FilterRatioAgg,
  positive_only: PositiveOnlyAgg,
  static: StaticAgg,
  math: MathAgg,
  top_hit: TopHitAgg,
  positive_rate: PositiveRateAgg,
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
        const Component = AGGS[metric.type] ?? UnsupportedAgg;
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

/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The form that creates a rollup job, in four steps: the indexes, what is aggregated and
 * measured, the schedule, and a look at it all before it is sent.
 */

import { useState } from 'react';
import { Button, CallOut, IconButton, Panel } from '../../components/basic';
import { ComboBox } from '../../components/combo_box';
import { Checkbox, NumberField, Select, TextArea } from '../../components/form';
import { Icon } from '../../components/icon';
import { MenuButton } from '../../components/overlay';
import { useBreadcrumbs } from '../../shell/state';
import { PAGE_SIZES, Table, go, ism, toasts, type TableColumn } from './common';
import {
  AddFieldsModal,
  ConfigureJob,
  CountedTitle,
  DocsLink,
  InfoGrid,
  Paired,
  PluginRow,
  Radio,
  Rule,
  Spacer,
  TitledPanel,
  Wizard,
  nameOptions,
  useIndexNames,
} from './job_parts';
import {
  CALENDAR_TIMEUNITS,
  DELAY_TIMEUNITS,
  EMPTY_ROLLUP_FORM,
  FIXED_TIMEUNITS,
  INTERVAL_REQUIRED,
  METRIC_KINDS,
  SCHEDULE_TIMEUNITS,
  addDimensions,
  addMetrics,
  changeDimension,
  commonFields,
  cronScheduleText,
  indicesErrors,
  intervalScheduleText,
  isNumericMapping,
  metricsError,
  moveDimension,
  parseTimeunit,
  removeDimension,
  rollupBody,
  setMetricKind,
  toggleMetric,
  unitOption,
  type DimensionItem,
  type FieldItem,
  type MetricItem,
  type MetricKind,
  type RollupForm,
} from './rollup_model';
import { CRUMBS, ROUTES } from './routes';
import { TIME_ZONES } from './time_zones';

const DOCS = 'https://opensearch.org/docs/latest/im-plugin/index-rollups/index/';
const TARGET_DOCS = `${DOCS}#step-1-set-up-indices`;

const STEPS = ['Set up indices', 'Define aggregations and metrics', 'Specify schedule', 'Review and create'];
const NO_CHANGE_LATER =
  "You can't change aggregations or metrics after creating a job. Double-check your choices before proceeding.";
const TIMEZONE_HELP = 'A day starts from 00:00:00 in the specified timezone.';

const METRIC_NAMES: Record<MetricKind, string> = {
  min: 'Min',
  max: 'Max',
  sum: 'Sum',
  avg: 'Avg',
  value_count: 'Value count',
};

export interface RollupErrors {
  rollupId?: string;
  sourceIndex?: string;
  targetIndex?: string;
  timestamp?: string;
  metric?: string;
  interval?: string;
}

type Change = (changes: Partial<RollupForm>) => void;

// --- Step 1 ----------------------------------------------------------------------------------------

/** The name of a job and what it is for; the name of a job that exists cannot be changed */
export function ConfigureRollup({
  rollupId,
  rollupIdError,
  description,
  isEdit,
  onChangeName,
  onChangeDescription,
}: {
  rollupId: string;
  rollupIdError?: string;
  description: string;
  isEdit?: boolean;
  onChangeName?: (name: string) => void;
  onChangeDescription: (description: string) => void;
}) {
  return (
    <ConfigureJob
      jobId={rollupId}
      jobIdError={rollupIdError}
      placeholder="my-rollupjob1"
      description={description}
      isEdit={isEdit}
      onChangeName={onChangeName}
      onChangeDescription={onChangeDescription}
    />
  );
}

function RollupIndices({
  form,
  errors,
  onChangeSource,
  onChangeTarget,
}: {
  form: RollupForm;
  errors: RollupErrors;
  onChangeSource: (index: string) => void;
  onChangeTarget: (index: string) => void;
}) {
  const { sources, targets, loading, onSearch: spaced } = useIndexNames();

  return (
    <TitledPanel title="Indices">
      <Spacer size="s" />
      <CallOut tone="warning">
        <p>
          You can&apos;t change indices after creating a job. Double-check the source and target index names before
          proceeding.
        </p>
      </CallOut>
      {(form.dimensions.length > 0 || form.metrics.length > 0) && (
        <>
          <Spacer />
          <CallOut tone="warning">
            <p>Note: changing source index will erase all existing definitions about aggregations and metrics.</p>
          </CallOut>
        </>
      )}
      <Spacer size="m" />
      <PluginRow
        title="Source index"
        error={errors.sourceIndex}
        help="The index pattern on which to performed the rollup job. You can use * as a wildcard."
      >
        <ComboBox
          compact
          single
          searched
          placeholder="Select source index"
          options={nameOptions(sources)}
          selected={form.sourceIndex ? [form.sourceIndex] : []}
          onChange={(chosen) => onChangeSource(chosen[0] ?? '')}
          onSearch={spaced}
          loading={loading}
          invalid={Boolean(errors.sourceIndex)}
          testId="sourceIndexCombobox"
        />
      </PluginRow>
      <PluginRow
        title="Target index"
        error={errors.targetIndex}
        help={
          <>
            The target index stores rollup results. You can select an existing index or type in a new index name with
            embedded variables <DocsLink href={TARGET_DOCS} />
          </>
        }
      >
        <ComboBox
          compact
          single
          searched
          allowCustom
          placeholder="Select or create target index"
          options={nameOptions(targets)}
          selected={form.targetIndex ? [form.targetIndex] : []}
          onChange={(chosen) => onChangeTarget(chosen[0] ?? '')}
          onSearch={spaced}
          loading={loading}
          invalid={Boolean(errors.targetIndex)}
          testId="targetIndexCombobox"
        />
      </PluginRow>
    </TitledPanel>
  );
}

// --- Step 2 ----------------------------------------------------------------------------------------

function TimeAggregation({
  form,
  fields,
  error,
  change,
  onChangeTimestamp,
}: {
  form: RollupForm;
  fields: FieldItem[];
  error?: string;
  change: Change;
  onChangeTimestamp: (field: string) => void;
}) {
  const dates = fields.filter((field) => field.type === 'date');
  const fixed = form.intervalType === 'fixed';
  // As the plugin's panel: the title, a line of help, a rule, then rows 16 px apart
  return (
    <section className="atlPanel ismTp">
      <h2 className="atlTitleS ismTp__title">Time aggregation </h2>
      <div className="ismPr__help">
        Your source indices must include a timestamp field. The rollup job creates a date histogram for the field you
        specify.
      </div>
      <Rule />
      <Spacer size="s" />
      <PluginRow title="Timestamp field" error={error}>
        <ComboBox
          compact
          single
          placeholder="Select timestamp"
          options={dates.map((field) => ({ value: field.label, label: field.label }))}
          selected={form.timestamp ? [form.timestamp] : []}
          onChange={(chosen) => onChangeTimestamp(chosen[0] ?? '')}
          invalid={Boolean(error)}
        />
      </PluginRow>
      <Spacer size="m" />
      <PluginRow title="Interval type">
        <div>
          <Radio
            id="fixed"
            name="intervalType"
            label="Fixed"
            checked={fixed}
            // The unit starts again at hours: the two kinds do not offer the same units
            onChange={() => change({ intervalType: 'fixed', timeunit: 'h' })}
          />
          <Radio
            id="calendar"
            name="intervalType"
            label="Calendar"
            checked={!fixed}
            onChange={() => change({ intervalType: 'calendar', timeunit: 'h' })}
          />
        </div>
      </PluginRow>
      <Spacer size="m" />
      <h3 className="ismPr__title">Interval</h3>
      <div className="ismIntervalPair">
        {fixed ? (
          <NumberField
            compact
            className="ismIntervalPair__number"
            min={1}
            value={form.intervalValue}
            onChange={(intervalValue) => change({ intervalValue })}
            aria-label="Interval"
          />
        ) : (
          <dd className="ismIntervalPair__every">Every 1</dd>
        )}
        <Select
          compact
          id="selectTimeunit"
          className="ismIntervalPair__unit"
          options={fixed ? FIXED_TIMEUNITS : CALENDAR_TIMEUNITS}
          value={form.timeunit}
          onChange={(timeunit) => change({ timeunit })}
          aria-label="Interval unit"
        />
      </div>
      <Spacer size="m" />
      <PluginRow title="Timezone" help={TIMEZONE_HELP}>
        <Select compact id="timezone" options={TIME_ZONES} value={form.timezone} onChange={(timezone) => change({ timezone })} />
      </PluginRow>
    </section>
  );
}

interface PageQuery {
  from: number;
  size: number;
  sortField: string;
  sortDirection: 'asc' | 'desc';
}

/** The rows of one page. The arrow in the heading turns, the rows keep their order: so does the plugin. */
function usePage<Row>(rows: Row[], sortField: string) {
  const [query, setQuery] = useState<PageQuery>({ from: 0, size: 10, sortField, sortDirection: 'desc' });
  const from = query.from >= rows.length ? 0 : query.from;
  return {
    query: { ...query, from },
    onQuery: (changes: Partial<PageQuery>) => setQuery((before) => ({ ...before, ...changes })),
    shown: rows.slice(from, from + query.size),
  };
}

function AdvancedAggregation({ form, fields, change }: { form: RollupForm; fields: FieldItem[]; change: Change }) {
  const [adding, setAdding] = useState(false);
  const { dimensions } = form;
  const set = (next: DimensionItem[]) => change({ dimensions: next });
  const page = usePage(dimensions, 'sequence');

  const columns: Array<TableColumn<DimensionItem>> = [
    { field: 'sequence', name: 'Sequence', sortable: true, render: (row) => row.sequence },
    { field: 'field.label', name: 'Field name', render: (row) => row.field.label },
    { field: 'field.type', name: 'Field type', render: (row) => row.field.type ?? '-' },
    {
      field: 'aggregationMethod',
      name: 'Aggregation method',
      render: (row) => (
        <Select
          compact
          value={row.aggregationMethod}
          disabled={!isNumericMapping(row.field.type)}
          options={[
            { value: 'terms', label: 'Terms' },
            { value: 'histogram', label: 'Histogram' },
          ]}
          onChange={(aggregationMethod) => set(changeDimension(dimensions, row.field.label, { aggregationMethod }))}
          testId={`aggregationMethodSelect-${row.field.label}`}
          aria-label="Aggregation method"
        />
      ),
    },
    {
      field: 'interval',
      name: 'Interval',
      render: (row) =>
        row.interval == null ? (
          '-'
        ) : (
          <NumberField
            compact
            min={1}
            value={Number.isNaN(row.interval) ? '' : row.interval}
            onChange={(interval) => set(changeDimension(dimensions, row.field.label, { interval }))}
            testId={`interval-${row.field.label}`}
            aria-label="Interval"
          />
        ),
    },
    {
      field: 'move',
      name: '',
      render: (row) => (
        <span className="ismMoves">
          <span>
            {row.sequence !== 1 && (
              <button
                type="button"
                className="atlLinkButton"
                onClick={() => set(moveDimension(dimensions, row.field.label, -1))}
                data-test-subj={`moveUp-${row.field.label}`}
              >
                Move up
              </button>
            )}
          </span>
          <span>
            {row.sequence !== dimensions.length && (
              <button
                type="button"
                className="atlLinkButton"
                onClick={() => set(moveDimension(dimensions, row.field.label, 1))}
                data-test-subj={`moveDown-${row.field.label}`}
              >
                Move down
              </button>
            )}
          </span>
        </span>
      ),
    },
    {
      field: 'actions',
      name: 'Actions',
      align: 'center',
      render: (row) => (
        <IconButton
          icon="crossInACircleFilled"
          label="Delete"
          size="s"
          className="ismRowDelete"
          onClick={() => set(removeDimension(dimensions, row.field.label))}
          testId={`delete-${row.field.label}`}
        />
      ),
    },
  ];

  return (
    <section className="atlPanel ismTp">
      <div className="ismAggHead">
        <div className="ismAggHead__text">
          <div className="ismAggTitle">
            <h2 className="atlTitleS">Additional aggregation ({dimensions.length}) </h2>
            <h2 className="atlTitleS">
              {' '}
              <i>– optional</i>{' '}
            </h2>
          </div>
          <div className="ismPr__help">
            The sequence of fields may influence rollup performance. <DocsLink href={DOCS} />
          </div>
          {dimensions.length > 0 && (
            <div>
              <CallOut>
                <p>
                  The order of fields impacts rollup performance. Aggregating by smaller buckets and then by larger
                  buckets is faster than the opposite. For example, if you are rolling up flight data for five airlines
                  with 100 destinations, aggregating by airline and then by destination is faster than aggregating by
                  destination first.
                </p>
              </CallOut>
              <Spacer size="s" />
            </div>
          )}
        </div>
        <div className="ismAggHead__button">
          <Button onClick={() => setAdding(true)} testId="addFieldsAggregation">
            Add fields
          </Button>
        </div>
      </div>
      <Spacer size="s" />
      <Rule />
      <div className="ismAggTable ismAggTable--padded">
        <Table
          columns={columns}
          rows={page.shown}
          total={dimensions.length}
          query={page.query}
          onQuery={page.onQuery}
          rowId={(row) => String(row.sequence)}
          pageSizes={PAGE_SIZES}
          empty={
            <>
              <p>No fields added for aggregations</p>
              <Button onClick={() => setAdding(true)} testId="addFieldsAggregationEmpty">
                Add fields
              </Button>
            </>
          }
        />
      </div>
      <Spacer size="s" />
      {adding && (
        <AddFieldsModal
          fields={fields}
          ticked={dimensions.map((dimension) => dimension.field)}
          empty="No fields available"
          onClose={() => setAdding(false)}
          onAdd={(chosen) => set(addDimensions(dimensions, chosen))}
          cancelTestId="addFieldsAggregationCancel"
          addTestId="addFieldsAggregationAdd"
        />
      )}
    </section>
  );
}

function MetricsCalculation({
  form,
  fields,
  error,
  change,
}: {
  form: RollupForm;
  fields: FieldItem[];
  error?: string;
  change: Change;
}) {
  const [adding, setAdding] = useState(false);
  const { metrics } = form;
  const set = (next: MetricItem[]) => change({ metrics: next });
  const page = usePage(metrics, 'source_field');
  const none = metrics.length === 0;

  const box = (kind: MetricKind | 'all', name: string, testId: string): TableColumn<MetricItem> => ({
    field: kind,
    name,
    align: 'center',
    render: (row) => (
      <Checkbox
        checked={row[kind]}
        onChange={() => set(toggleMetric(metrics, row.source_field.label, kind))}
        testId={`${testId}-${row.source_field.label}`}
      />
    ),
  });
  const columns: Array<TableColumn<MetricItem>> = [
    { field: 'source_field.label', name: 'Field Name', render: (row) => row.source_field.label },
    box('all', 'All', 'all'),
    ...METRIC_KINDS.map((kind) => box(kind, METRIC_NAMES[kind], kind === 'value_count' ? 'valueCount' : kind)),
    {
      field: 'actions',
      name: 'Actions',
      align: 'right',
      render: (row) => (
        <IconButton
          icon="crossInACircleFilled"
          label="Delete"
          size="s"
          className="ismRowDelete"
          onClick={() => set(metrics.filter((metric) => metric !== row))}
          testId={`delete-${row.source_field.label}`}
        />
      ),
    },
  ];
  const all = (on: boolean) => (
    <MenuButton
      align="right"
      items={METRIC_KINDS.map((kind) => ({
        id: kind,
        label: METRIC_NAMES[kind],
        disabled: none,
        testId: `${on ? 'enable' : 'disable'}_${kind}`,
        onClick: () => set(setMetricKind(metrics, kind, on)),
      }))}
      button={(toggle) => (
        <Button icon="chevronDown" iconSide="right" disabled={none} onClick={toggle}>
          {on ? 'Enable all' : 'Disable all'}
        </Button>
      )}
    />
  );

  return (
    <section className="atlPanel ismTp">
      <div className="ismMetHead">
        <div className="ismAggTitle">
          <h2 className="atlTitleS">Additional metrics ({metrics.length}) </h2>
          <h2 className="atlTitleS">
            <i> – optional </i>
          </h2>
        </div>
        <div className="ismMetHead__buttons">
          {all(false)}
          {all(true)}
          <Button onClick={() => setAdding(true)} testId="addFieldsMetric">
            Add fields
          </Button>
        </div>
      </div>
      <div className="ismPr__help ismMetHelp">
        You can aggregate additional fields from the source index into the target index. Rollup supports the terms
        aggregation (for all field types) and histogram aggregation (for numeric fields).
      </div>
      <Rule />
      <div className="ismMetBody">
        {error && (
          <>
            <CallOut tone="critical">
              <p>{error}</p>
            </CallOut>
            <Spacer />
          </>
        )}
        <div className="ismAggTable">
          <Table
            columns={columns}
            rows={page.shown}
            total={metrics.length}
            query={page.query}
            onQuery={page.onQuery}
            rowId={(row) => row.source_field.label}
            pageSizes={PAGE_SIZES}
            empty={
              <>
                <p>No fields added for metrics</p>
                <Button onClick={() => setAdding(true)} testId="addFieldsMetricEmpty">
                  Add fields
                </Button>
              </>
            }
          />
        </div>
        <Spacer size="s" />
      </div>
      {adding && (
        <AddFieldsModal
          fields={fields}
          ticked={metrics.map((metric) => metric.source_field)}
          selectable={(field) => isNumericMapping(field.type)}
          onClose={() => setAdding(false)}
          onAdd={(chosen) => set(addMetrics(metrics, chosen))}
          cancelTestId="addFieldsMetricCancel"
          addTestId="addFieldsMetricAdd"
        />
      )}
    </section>
  );
}

// --- Step 3 ----------------------------------------------------------------------------------------

export type ScheduleValues = Pick<
  RollupForm,
  | 'enabled'
  | 'continuous'
  | 'continuousDefinition'
  | 'interval'
  | 'intervalTimeunit'
  | 'cronExpression'
  | 'cronTimezone'
  | 'pageSize'
  | 'delayTime'
  | 'delayTimeunit'
>;

/** When a job runs and how much it does each time. A job that exists keeps its state and its kind. */
export function Schedule({
  values,
  intervalError,
  isEdit,
  change,
  onChangeInterval,
}: {
  values: ScheduleValues;
  intervalError?: string;
  isEdit?: boolean;
  change: (changes: Partial<ScheduleValues>) => void;
  onChangeInterval: (interval: number | undefined) => void;
}) {
  // As the plugin's: rows 16 px apart, the interval and the delay a title over a number of 200 px
  // and its unit beside it, the delay's help under both
  return (
    <TitledPanel title="Schedule">
      {!isEdit && (
        <div className="ismCheckRow">
          <Checkbox
            checked={values.enabled}
            onChange={(enabled) => change({ enabled })}
            label="Enable job by default"
            testId="jobEnabledByDefault"
          />
        </div>
      )}
      {!isEdit && (
        <>
          <PluginRow title="Continuous">
            <div>
              <Radio
                id="no"
                name="continuousJob"
                label="No"
                checked={!values.continuous}
                onChange={() => change({ continuous: false })}
              />
              <Radio
                id="yes"
                name="continuousJob"
                label="Yes"
                checked={values.continuous}
                onChange={() => change({ continuous: true })}
              />
            </div>
          </PluginRow>
          <Spacer size="m" />
        </>
      )}
      <PluginRow title="Rollup execution frequency">
        <Select
          compact
          id="continuousDefinition"
          options={[
            { value: 'fixed', label: 'Define by fixed interval' },
            { value: 'cron', label: 'Define by cron expression' },
          ]}
          value={values.continuousDefinition}
          onChange={(definition) => change({ continuousDefinition: definition === 'cron' ? 'cron' : 'fixed' })}
        />
      </PluginRow>
      <Spacer size="m" />
      {values.continuousDefinition === 'fixed' ? (
        <>
          <h3 className="ismPr__title">Rollup interval</h3>
          <Paired>
            <div className="ismPaired__row">
              <NumberField
                compact
                value={values.interval}
                onChange={onChangeInterval}
                invalid={Boolean(intervalError)}
                aria-label="Rollup interval"
              />
              {intervalError && <div className="ismPr__error">{intervalError}</div>}
            </div>
            <Select
              compact
              id="selectIntervalTimeunit"
              className={values.interval === undefined || values.interval <= 0 ? 'atlField--invalid' : undefined}
              options={SCHEDULE_TIMEUNITS}
              value={unitOption(values.intervalTimeunit)}
              onChange={(intervalTimeunit) => change({ intervalTimeunit })}
              aria-label="Rollup interval unit"
            />
          </Paired>
        </>
      ) : (
        <>
          <PluginRow title="Define by cron expression">
            <div className="ismPr__field--area">
              <TextArea
                className="ismJobTextArea"
                value={values.cronExpression}
                onChange={(cronExpression) => change({ cronExpression })}
                rows={3}
                aria-label="Cron expression"
              />
            </div>
          </PluginRow>
          <PluginRow title="Timezone" help={TIMEZONE_HELP}>
            <Select
              compact
              id="timezone"
              options={TIME_ZONES}
              value={values.cronTimezone}
              onChange={(cronTimezone) => change({ cronTimezone })}
            />
          </PluginRow>
        </>
      )}
      <Spacer size="m" />
      <PluginRow
        title="Page per execution"
        help="The number of pages every execution processes. A larger number means faster execution and higher costs on memory."
      >
        <NumberField
          compact
          min={1}
          placeholder="1000"
          value={values.pageSize}
          onChange={(pageSize) => change({ pageSize })}
          aria-label="Page per execution"
        />
      </PluginRow>
      <Spacer size="m" />
      <h3 className="ismPr__title">
        Execution delay<i> – optional</i>
      </h3>
      <Paired>
        <NumberField
          compact
          value={values.delayTime}
          onChange={(delayTime) => change({ delayTime })}
          aria-label="Execution delay"
        />
        <Select
          compact
          id="selectTimeunit"
          options={DELAY_TIMEUNITS}
          value={values.delayTimeunit}
          onChange={(delayTimeunit) => change({ delayTimeunit })}
          aria-label="Execution delay unit"
        />
      </Paired>
      <div className="ismPr__help ismPr__help--block">
        The amount of time the job waits for data ingestion to accommodate any necessary processing time.
      </div>
    </TitledPanel>
  );
}

// --- Step 4, and what the page of a job shows too --------------------------------------------------

const ticked = (on: boolean) => (on ? <Icon name="check" /> : null);

const AGGREGATION_COLUMNS: Array<TableColumn<DimensionItem>> = [
  { field: 'sequence', name: 'Sequence', sortable: true, render: (row) => row.sequence },
  { field: 'field.label', name: 'Field name', render: (row) => row.field.label },
  { field: 'aggregationMethod', name: 'Aggregation method', render: (row) => row.aggregationMethod },
  { field: 'interval', name: 'Interval', render: (row) => (row.interval == null ? '-' : `${row.interval}`) },
];
const TYPED_AGGREGATION_COLUMNS: Array<TableColumn<DimensionItem>> = [
  ...AGGREGATION_COLUMNS,
  { field: 'field.type', name: 'Field type', render: (row) => row.field.type ?? '-' },
];
const METRIC_COLUMNS: Array<TableColumn<MetricItem>> = [
  { field: 'source_field', name: 'Field Name', render: (row) => row.source_field.label },
  ...METRIC_KINDS.map(
    (kind): TableColumn<MetricItem> => ({
      field: kind,
      name: METRIC_NAMES[kind],
      align: 'center',
      render: (row) => ticked(row[kind]),
    })
  ),
];

/** What the plugin writes where a job has no field of a kind: the smallest text, in a `dd` */
const NoFields = ({ children }: { children: string }) => (
  <div className="ismInfoGrid--xs">
    <dd>{children}</dd>
  </div>
);

/**
 * The aggregations after the date histogram and the metrics of a job, each under its title and
 * number in a table in a panel, 8 px apart, as the plugin's details and review draw them
 */
export function AggregationTables({
  dimensions,
  metrics,
  review,
}: {
  dimensions: DimensionItem[];
  metrics: MetricItem[];
  /**
   * In the form's review the types of the fields are known (a job read back does not tell them),
   * and the title of the aggregations holds their number
   */
  review?: boolean;
}) {
  const dimensionPage = usePage(dimensions, 'sequence');
  const metricPage = usePage(metrics, 'sequence');
  return (
    <>
      {review ? (
        <div className="ismCounted">
          <h3>Additional aggregations ({dimensions.length})</h3>
        </div>
      ) : (
        <CountedTitle title="Additional aggregations" count={dimensions.length} />
      )}
      {dimensions.length === 0 ? (
        <NoFields>No fields added for aggregation</NoFields>
      ) : (
        <Panel className="ismAggPanel">
          <Table
            columns={review ? TYPED_AGGREGATION_COLUMNS : AGGREGATION_COLUMNS}
            rows={dimensionPage.shown}
            total={dimensions.length}
            query={dimensionPage.query}
            onQuery={dimensionPage.onQuery}
            rowId={(row) => String(row.sequence)}
            pageSizes={PAGE_SIZES}
          />
        </Panel>
      )}
      <Spacer size="s" />
      <CountedTitle title="Additional metrics" count={metrics.length} />
      {metrics.length === 0 ? (
        <NoFields>No fields added for metrics</NoFields>
      ) : (
        <Panel className="ismAggPanel">
          <Table
            columns={METRIC_COLUMNS}
            rows={metricPage.shown}
            total={metrics.length}
            query={metricPage.query}
            onQuery={metricPage.onQuery}
            rowId={(row) => row.source_field.label}
            pageSizes={PAGE_SIZES}
          />
        </Panel>
      )}
    </>
  );
}

function Review({ form, onChangeStep }: { form: RollupForm; onChangeStep: (step: number) => void }) {
  const edit = (step: number) => (
    <Button onClick={() => onChangeStep(step)} testId="EditButton">
      Edit
    </Button>
  );
  const delay = form.delayTime;
  // As the plugin's: each part a panel with its title beside Edit, its values in a grid 8 px under the rule
  return (
    <>
      <TitledPanel title="Job name and indexes" itemTitle actions={edit(1)}>
        <Spacer size="s" />
        <InfoGrid
          columns={3}
          items={[
            { term: 'Name', value: form.rollupId },
            { term: 'Source Index', value: form.sourceIndex },
            { term: 'Target index', value: form.targetIndex },
            { term: 'Description', value: form.description === '' ? '-' : form.description },
          ]}
        />
        <Spacer size="s" />
      </TitledPanel>
      <Spacer />
      <TitledPanel title="Aggregation and metrics settings" itemTitle actions={edit(2)}>
        <Spacer size="xs" />
        <h3 className="ismPr__title">Time aggregation</h3>
        <Spacer size="s" />
        <InfoGrid
          columns={3}
          size="xs"
          items={[
            { term: 'Timestamp field', value: form.timestamp },
            {
              term: 'Interval',
              value: `${form.intervalType === 'calendar' ? '1' : `${form.intervalValue ?? NaN}`} ${parseTimeunit(form.timeunit)}`,
            },
            { term: 'Timezone', value: form.timezone },
          ]}
        />
        <Spacer size="m" />
        <AggregationTables dimensions={form.dimensions} metrics={form.metrics} review />
        <Spacer size="s" />
      </TitledPanel>
      <Spacer />
      <TitledPanel title="Schedule" itemTitle actions={edit(3)}>
        <Spacer size="s" />
        <InfoGrid
          items={[
            { term: 'Enabled by default', value: form.enabled ? 'Yes' : 'No' },
            {
              term: 'Schedule',
              value:
                form.continuousDefinition === 'fixed'
                  ? intervalScheduleText(form.continuous, form.interval, form.intervalTimeunit)
                  : cronScheduleText(form.continuous, form.cronExpression),
            },
            { term: 'Pages per execution', value: form.pageSize },
            {
              term: 'Execution delay',
              value: delay === undefined || delay === 0 ? '-' : `${delay} ${parseTimeunit(form.delayTimeunit)}`,
            },
          ]}
        />
        <Spacer size="s" />
      </TitledPanel>
      <Spacer />
      <CallOut tone="warning">
        <p>{NO_CHANGE_LATER}</p>
      </CallOut>
    </>
  );
}

// --- The form --------------------------------------------------------------------------------------

export function CreateRollup() {
  useBreadcrumbs([CRUMBS.INDEX_MANAGEMENT, CRUMBS.ROLLUPS, CRUMBS.CREATE_ROLLUP]);
  const [form, setForm] = useState<RollupForm>(EMPTY_ROLLUP_FORM);
  const [errors, setErrors] = useState<RollupErrors>({});
  const [step, setStep] = useState(1);
  const [fields, setFields] = useState<FieldItem[]>([]);
  const [busy, setBusy] = useState(false);
  const change: Change = (changes) => setForm((before) => ({ ...before, ...changes }));
  const judge = (changes: RollupErrors) => setErrors((before) => ({ ...before, ...changes }));

  const loadFields = async (index: string) => {
    if (!index) return;
    const answer = await ism.post<Parameters<typeof commonFields>[0]>('_mappings', { index });
    if (answer.ok && answer.response) setFields(commonFields(answer.response));
    else toasts.danger(`Could not load fields: ${answer.error}`);
  };

  const next = () => {
    if (step === 1) {
      const wrong = indicesErrors(form);
      if (Object.keys(wrong).length > 0) {
        judge(wrong);
        return;
      }
    } else if (step === 2) {
      const timestamp = form.timestamp ? undefined : 'Timestamp is required.';
      const metric = metricsError(form.metrics);
      judge({ ...(timestamp ? { timestamp } : {}), metric });
      if (timestamp || metric) return;
    } else if (step === 3) {
      if (form.continuousDefinition === 'fixed' && errors.interval) return;
    }
    setStep(Math.min(step + 1, 4));
  };

  const submit = async () => {
    setBusy(true);
    const answer = await ism.put<{ _id: string }>(
      `rollups/${encodeURIComponent(form.rollupId)}`,
      rollupBody(form, Math.floor(Date.now() / 1000))
    );
    setBusy(false);
    if (answer.ok && answer.response) {
      toasts.success(`Created rollup: ${answer.response._id}`);
      go(ROUTES.ROLLUPS);
    } else {
      toasts.danger(`Failed to create rollup: ${answer.error}`);
    }
  };

  return (
    <Wizard
      titles={STEPS}
      step={step}
      buttons={
        <>
          {/* The plugin's small buttons, 32 px tall in the theme as the kit's default ones */}
          <Button variant="empty" onClick={() => go(ROUTES.ROLLUPS)} testId="createRollupCancelButton">
            Cancel
          </Button>
          {step !== 1 && (
            <Button onClick={() => setStep(step - 1)} testId="createRollupPreviousButton">
              Previous
            </Button>
          )}
          {step === 4 ? (
            <Button variant="primary" loading={busy} onClick={() => void submit()} testId="createRollupSubmitButton">
              Create
            </Button>
          ) : (
            <Button variant="primary" onClick={next} testId="createRollupNextButton">
              Next
            </Button>
          )}
        </>
      }
    >
      {step === 1 && (
        <>
          <ConfigureRollup
            rollupId={form.rollupId}
            rollupIdError={errors.rollupId}
            description={form.description}
            onChangeName={(rollupId) => {
              change({ rollupId });
              judge({ rollupId: rollupId ? undefined : 'Name is required' });
            }}
            onChangeDescription={(description) => change({ description })}
          />
          <Spacer />
          <RollupIndices
            form={form}
            errors={errors}
            onChangeSource={(sourceIndex) => {
              // What was chosen of the fields of another index means nothing here
              change({ sourceIndex, dimensions: [], metrics: [] });
              judge({ sourceIndex: sourceIndex ? undefined : 'Source index is required' });
              void loadFields(sourceIndex);
            }}
            onChangeTarget={(targetIndex) => {
              change({ targetIndex });
              judge({ targetIndex: targetIndex ? undefined : 'Target index is required' });
            }}
          />
        </>
      )}
      {step === 2 && (
        <>
          <TimeAggregation
            form={form}
            fields={fields}
            error={errors.timestamp}
            change={change}
            onChangeTimestamp={(timestamp) => {
              change({ timestamp });
              judge({ timestamp: timestamp ? undefined : 'Timestamp is required.' });
            }}
          />
          <Spacer />
          <AdvancedAggregation form={form} fields={fields} change={change} />
          <Spacer />
          <MetricsCalculation form={form} fields={fields} error={errors.metric} change={change} />
          <Spacer />
          <CallOut tone="warning">
            <p>{NO_CHANGE_LATER}</p>
          </CallOut>
        </>
      )}
      {step === 3 && (
        <>
          {/* As the plugin's, this step has a second spacer under its title */}
          <Spacer />
          <Schedule
            values={form}
            intervalError={errors.interval}
            change={change}
            onChangeInterval={(interval) => {
              change({ interval });
              judge({ interval: interval === undefined ? INTERVAL_REQUIRED : undefined });
            }}
          />
        </>
      )}
      {step === 4 && <Review form={form} onChangeStep={setStep} />}
    </Wizard>
  );
}

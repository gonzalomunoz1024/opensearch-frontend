/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The form that creates a rollup job, in four steps: the indexes, what is aggregated and
 * measured, the schedule, and a look at it all before it is sent.
 */

import { useState } from 'react';
import { Button, CallOut, IconButton, Panel } from '../../components/basic';
import { ComboBox } from '../../components/combo_box';
import { Checkbox, NumberField, RadioGroup, Select, TextArea } from '../../components/form';
import { Icon } from '../../components/icon';
import { MenuButton } from '../../components/overlay';
import { useBreadcrumbs } from '../../shell/state';
import { Detail, Details, ExternalLink, PAGE_SIZES, Table, go, ism, toasts, type TableColumn } from './common';
import {
  AddFieldsModal,
  ConfigureJob,
  CountedTitle,
  FieldRow,
  FormPanel,
  Paired,
  Spacer,
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
    <FormPanel title="Indices">
      <CallOut tone="warning">
        You can&apos;t change indices after creating a job. Double-check the source and target index names before
        proceeding.
      </CallOut>
      {(form.dimensions.length > 0 || form.metrics.length > 0) && (
        <CallOut tone="warning">
          Note: changing source index will erase all existing definitions about aggregations and metrics.
        </CallOut>
      )}
      <FieldRow
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
      </FieldRow>
      <FieldRow
        title="Target index"
        error={errors.targetIndex}
        help={
          <>
            The target index stores rollup results. You can select an existing index or type in a new index name with
            embedded variables <ExternalLink href={TARGET_DOCS} />
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
      </FieldRow>
    </FormPanel>
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
  return (
    <Panel>
      <h2 className="ismPanel__heading">Time aggregation </h2>
      <div className="ismLabeled__help">
        Your source indices must include a timestamp field. The rollup job creates a date histogram for the field you
        specify.
      </div>
      <div className="ismFormPanel__body">
        <FieldRow title="Timestamp field" error={error}>
          <ComboBox
            compact
            single
            placeholder="Select timestamp"
            options={dates.map((field) => ({ value: field.label, label: field.label }))}
            selected={form.timestamp ? [form.timestamp] : []}
            onChange={(chosen) => onChangeTimestamp(chosen[0] ?? '')}
            invalid={Boolean(error)}
          />
        </FieldRow>
        <FieldRow title="Interval type">
          <RadioGroup
            options={[
              { id: 'fixed', label: 'Fixed' },
              { id: 'calendar', label: 'Calendar' },
            ]}
            value={form.intervalType}
            // The unit starts again at hours: the two kinds do not offer the same units
            onChange={(intervalType) => change({ intervalType, timeunit: 'h' })}
          />
        </FieldRow>
        <FieldRow title="Interval" wide>
          <div className="ismPaired ismPaired--interval">
            {fixed ? (
              <NumberField
                compact
                min={1}
                value={form.intervalValue}
                onChange={(intervalValue) => change({ intervalValue })}
                aria-label="Interval"
              />
            ) : (
              <span className="ismPlain">Every 1</span>
            )}
            <Select
              compact
              id="selectTimeunit"
              options={fixed ? FIXED_TIMEUNITS : CALENDAR_TIMEUNITS}
              value={form.timeunit}
              onChange={(timeunit) => change({ timeunit })}
              aria-label="Interval unit"
            />
          </div>
        </FieldRow>
        <FieldRow title="Timezone" help={TIMEZONE_HELP}>
          <Select
            compact
            id="timezone"
            options={TIME_ZONES}
            value={form.timezone}
            onChange={(timezone) => change({ timezone })}
          />
        </FieldRow>
      </div>
    </Panel>
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
      ),
    },
    {
      field: 'actions',
      name: 'Actions',
      align: 'right',
      render: (row) => (
        <IconButton
          icon="crossInACircleFilled"
          label="Delete"
          size="s"
          onClick={() => set(removeDimension(dimensions, row.field.label))}
          testId={`delete-${row.field.label}`}
        />
      ),
    },
  ];

  return (
    <Panel>
      <div className="ismFormPanel__header ismFormPanel__header--top">
        <div className="atlGrow">
          <h2 className="ismPanel__heading">
            Additional aggregation ({dimensions.length}) <i>– optional</i>
          </h2>
          <div className="ismLabeled__help">
            The sequence of fields may influence rollup performance. <ExternalLink href={DOCS} />
          </div>
          {dimensions.length > 0 && (
            <div className="ismFormPanel__note">
              <CallOut>
                The order of fields impacts rollup performance. Aggregating by smaller buckets and then by larger
                buckets is faster than the opposite. For example, if you are rolling up flight data for five airlines
                with 100 destinations, aggregating by airline and then by destination is faster than aggregating by
                destination first.
              </CallOut>
            </div>
          )}
        </div>
        <Button size="s" onClick={() => setAdding(true)} testId="addFieldsAggregation">
          Add fields
        </Button>
      </div>
      <hr className="ismRule" />
      <Table
        columns={columns}
        rows={page.shown}
        total={dimensions.length}
        query={page.query}
        onQuery={page.onQuery}
        rowId={(row) => String(row.sequence)}
        pageSizes={PAGE_SIZES}
        empty={
          <div className="ismEmpty">
            <p>No fields added for aggregations</p>
            <Button size="s" onClick={() => setAdding(true)} testId="addFieldsAggregationEmpty">
              Add fields
            </Button>
          </div>
        }
      />
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
    </Panel>
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
        <Button size="s" icon="chevronDown" iconSide="right" disabled={none} onClick={toggle}>
          {on ? 'Enable all' : 'Disable all'}
        </Button>
      )}
    />
  );

  return (
    <Panel>
      <div className="ismFormPanel__header ismFormPanel__header--top">
        <div className="atlGrow">
          <h2 className="ismPanel__heading">
            Additional metrics ({metrics.length}) <i>– optional</i>
          </h2>
          <div className="ismLabeled__help ismFormPanel__help">
            You can aggregate additional fields from the source index into the target index. Rollup supports the terms
            aggregation (for all field types) and histogram aggregation (for numeric fields).
          </div>
        </div>
        <div className="ismPanel__actions">
          {all(false)}
          {all(true)}
          <Button size="s" onClick={() => setAdding(true)} testId="addFieldsMetric">
            Add fields
          </Button>
        </div>
      </div>
      <hr className="ismRule" />
      {error && (
        <div className="ismFormPanel__note">
          <CallOut tone="critical">{error}</CallOut>
        </div>
      )}
      <Table
        columns={columns}
        rows={page.shown}
        total={metrics.length}
        query={page.query}
        onQuery={page.onQuery}
        rowId={(row) => row.source_field.label}
        pageSizes={PAGE_SIZES}
        empty={
          <div className="ismEmpty">
            <p>No fields added for metrics</p>
            <Button size="s" onClick={() => setAdding(true)} testId="addFieldsMetricEmpty">
              Add fields
            </Button>
          </div>
        }
      />
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
    </Panel>
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
  return (
    <FormPanel title="Schedule">
      {!isEdit && (
        <Checkbox
          checked={values.enabled}
          onChange={(enabled) => change({ enabled })}
          label="Enable job by default"
          testId="jobEnabledByDefault"
        />
      )}
      {!isEdit && (
        <FieldRow title="Continuous" minor>
          <RadioGroup
            options={[
              { id: 'no', label: 'No' },
              { id: 'yes', label: 'Yes' },
            ]}
            value={values.continuous ? 'yes' : 'no'}
            onChange={(id) => change({ continuous: id === 'yes' })}
          />
        </FieldRow>
      )}
      <FieldRow title="Rollup execution frequency">
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
      </FieldRow>
      {values.continuousDefinition === 'fixed' ? (
        <FieldRow title="Rollup interval" error={intervalError}>
          <Paired>
            <NumberField
              compact
              value={values.interval}
              onChange={onChangeInterval}
              invalid={Boolean(intervalError)}
              aria-label="Rollup interval"
            />
            <Select
              compact
              id="selectIntervalTimeunit"
              className={values.interval === undefined || values.interval <= 0 ? 'atlField--invalid' : undefined}
              options={SCHEDULE_TIMEUNITS}
              value={values.intervalTimeunit}
              onChange={(intervalTimeunit) => change({ intervalTimeunit })}
              aria-label="Rollup interval unit"
            />
          </Paired>
        </FieldRow>
      ) : (
        <>
          <FieldRow title="Define by cron expression">
            <TextArea
              value={values.cronExpression}
              onChange={(cronExpression) => change({ cronExpression })}
              rows={3}
              aria-label="Cron expression"
            />
          </FieldRow>
          <FieldRow title="Timezone" help={TIMEZONE_HELP}>
            <Select
              compact
              id="timezone"
              options={TIME_ZONES}
              value={values.cronTimezone}
              onChange={(cronTimezone) => change({ cronTimezone })}
            />
          </FieldRow>
        </>
      )}
      <FieldRow
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
      </FieldRow>
      <FieldRow
        title="Execution delay"
        optional
        help="The amount of time the job waits for data ingestion to accommodate any necessary processing time."
      >
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
      </FieldRow>
    </FormPanel>
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
    <Button size="s" onClick={() => onChangeStep(step)} testId="EditButton">
      Edit
    </Button>
  );
  const delay = form.delayTime;
  return (
    <>
      <FormPanel title="Job name and indexes" actions={edit(1)}>
        <Details columns={3}>
          <Detail name="Name">{form.rollupId}</Detail>
          <Detail name="Source Index">{form.sourceIndex}</Detail>
          <Detail name="Target index">{form.targetIndex}</Detail>
          <Detail name="Description">{form.description === '' ? '-' : form.description}</Detail>
        </Details>
      </FormPanel>
      <FormPanel title="Aggregation and metrics settings" actions={edit(2)}>
        <h3 className="ismRow__title">Time aggregation</h3>
        <div className="ismSmallDetails">
          <Details columns={3}>
            <Detail name="Timestamp field">{form.timestamp}</Detail>
            <Detail name="Interval">
              {form.intervalType === 'calendar' ? '1' : `${form.intervalValue ?? NaN}`} {parseTimeunit(form.timeunit)}
            </Detail>
            <Detail name="Timezone">{form.timezone}</Detail>
          </Details>
        </div>
        <AggregationTables dimensions={form.dimensions} metrics={form.metrics} review />
      </FormPanel>
      <FormPanel title="Schedule" actions={edit(3)}>
        <Details columns={4}>
          <Detail name="Enabled by default">{form.enabled ? 'Yes' : 'No'}</Detail>
          <Detail name="Schedule">
            {form.continuousDefinition === 'fixed'
              ? intervalScheduleText(form.continuous, form.interval, form.intervalTimeunit)
              : cronScheduleText(form.continuous, form.cronExpression)}
          </Detail>
          <Detail name="Pages per execution">{form.pageSize}</Detail>
          <Detail name="Execution delay">
            {delay === undefined || delay === 0 ? '-' : `${delay} ${parseTimeunit(form.delayTimeunit)}`}
          </Detail>
        </Details>
      </FormPanel>
      <CallOut tone="warning">{NO_CHANGE_LATER}</CallOut>
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
          <Button variant="empty" size="s" onClick={() => go(ROUTES.ROLLUPS)} testId="createRollupCancelButton">
            Cancel
          </Button>
          {step !== 1 && (
            <Button size="s" onClick={() => setStep(step - 1)} testId="createRollupPreviousButton">
              Previous
            </Button>
          )}
          {step === 4 ? (
            <Button variant="primary" size="s" loading={busy} onClick={() => void submit()} testId="createRollupSubmitButton">
              Create
            </Button>
          ) : (
            <Button variant="primary" size="s" onClick={next} testId="createRollupNextButton">
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
          <AdvancedAggregation form={form} fields={fields} change={change} />
          <MetricsCalculation form={form} fields={fields} error={errors.metric} change={change} />
          <CallOut tone="warning">{NO_CHANGE_LATER}</CallOut>
        </>
      )}
      {step === 3 && (
        <Schedule
          values={form}
          intervalError={errors.interval}
          change={change}
          onChangeInterval={(interval) => {
            change({ interval });
            judge({ interval: interval === undefined ? INTERVAL_REQUIRED : undefined });
          }}
        />
      )}
      {step === 4 && <Review form={form} onChangeStep={setStep} />}
    </Wizard>
  );
}

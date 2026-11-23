/* SPDX-License-Identifier: Apache-2.0 */

/*
 * One aggregation in the editor, as the original's `DefaultEditorAggParams`: the select of its
 * type, then each parameter of the type that has an editor, in the type's order, the advanced
 * ones under "Advanced". The texts, the defaults and what each editor sets as it opens are the
 * original's; a parameter shows its error once it, or its aggregation, has been touched.
 */

import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { FieldToken, cx } from '../../components/basic';
import { CodeEditor } from '../../components/code_editor';
import { ComboBox, type ComboOption } from '../../components/combo_box';
import { Icon } from '../../components/icon';
import { Tooltip } from '../../components/overlay';
import { AGG_TITLES, dateInterval, fieldNameOf, responseAggs, type AggConfig, type AggContext } from '../../lib/aggs';
import { parseInterval } from '../../lib/dates';
import { tokenizeJson } from '../../lib/json_text';
import type { Field, IndexPattern, Query } from '../../lib/types';
import { services } from '../../services';
import { QueryBar, defaultQueryLanguage } from '../../shell/query_bar';
import { availableFields, isAdvanced, paramNames, sortFields } from './agg_params';
import {
  PARENT_PIPELINES,
  SIBLING_PIPELINES,
  aggTypeOptions,
  allowsStrings,
  changeAggType,
  fallbackMetric,
  firstOrderBy,
  nestedAggs,
  nestedCount,
  orderByParams,
  orderableMetric,
  paramProblems,
  parentPipelineMetric,
  topAggregates,
  isValidDateMath,
  isValidIpField,
} from './defaults';
import {
  AddButton,
  ButtonGroup,
  Disclosure,
  NumberControl,
  ParamRow,
  RangeControl,
  SelectControl,
  SmallIconButton,
  SwitchRow,
  TextControl,
  TipLabel,
} from './editor_controls';

export interface AggEditorProps {
  agg: AggConfig;
  /** The types someone may choose */
  types: string[];
  indexPattern?: IndexPattern;
  /** Every aggregation of the chart: a terms bucket is ordered by one of its metrics */
  aggs: AggConfig[];
  context: AggContext;
  onChange: (agg: AggConfig) => void;
  /** Errors are shown everywhere: someone tried to apply the changes, or closed the aggregation */
  showProblems?: boolean;
  /** The kind of chart: what a top hit may be on depends on it */
  visType?: string;
  /** A bucket under another: its type is a "Sub aggregation" */
  subAggregation?: boolean;
  /** An aggregation inside another's parameters: its types are listed without headings */
  nested?: boolean;
  /** An error of the aggregation's type, under its select */
  aggError?: string;
  /** An error of the aggregation as a whole, under its parameters */
  formError?: string;
  /** Parameters set for the aggregation and not to be changed */
  disabledParams?: string[];
  hideCustomLabel?: boolean;
  /** The metrics the chart asks for: what a terms bucket can be ordered by, what a pipeline is on */
  metricAggs?: AggConfig[];
  /** Whether every parameter in error has been touched */
  onTouched?: (touched: boolean) => void;
  /** Called when the type changes, as the original's touched state starts again */
  className?: string;
  testId?: string;
}

const HELP_LINK = 'https://opensearch.org/docs/latest/opensearch/aggregations/';
const DATE_MATH_LINK = 'https://opensearch.org/docs/latest/opensearch/supported-field-types/date/#date-math';

const INTERVALS: Array<{ key: string; label: string }> = [
  { key: 'auto', label: 'Auto' },
  { key: 'ms', label: 'Millisecond' },
  { key: 's', label: 'Second' },
  { key: 'm', label: 'Minute' },
  { key: 'h', label: 'Hour' },
  { key: 'd', label: 'Day' },
  { key: 'w', label: 'Week' },
  { key: 'M', label: 'Month' },
  { key: 'y', label: 'Year' },
];

const ORDERS = [
  { value: 'desc', label: 'Descending' },
  { value: 'asc', label: 'Ascending' },
];

const fieldOptions = (fields: Field[]): ComboOption[] =>
  sortFields(fields).map((field) => ({ value: field.name, label: field.name, group: field.type, prepend: <FieldToken type={field.type} /> }));

/** An aggregation the original's editor would show one of: metrics that are asked for */
const responseMetrics = (aggs: AggConfig[]) => aggs.filter((agg) => agg.enabled !== false && agg.type && (agg.schema === undefined || agg.schema === 'metric' || agg.schema === 'radius'));

export function AggEditor(props: AggEditorProps) {
  const {
    agg,
    types,
    indexPattern,
    aggs,
    context,
    onChange,
    showProblems = false,
    visType,
    subAggregation,
    nested,
    aggError,
    formError,
    disabledParams = [],
    hideCustomLabel,
    metricAggs = responseMetrics(aggs),
    onTouched,
    className,
    testId = 'visAggEditorParams',
  } = props;
  const params = agg.params ?? {};
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const set = (patch: Record<string, unknown>) => onChange({ ...agg, params: { ...params, ...patch } });
  const touch = (name: string) => setTouched((current) => (current[name] ? current : { ...current, [name]: true }));

  // A new type starts with nothing touched
  const typeRef = useRef(agg.type);
  useEffect(() => {
    if (typeRef.current !== agg.type) {
      typeRef.current = agg.type;
      setTouched({});
    }
  }, [agg.type]);

  const problems = paramProblems(agg, indexPattern, { visType, aggs });
  if (aggError) problems.type = aggError;
  const invalidNames = Object.keys(problems);
  const allTouched = formError !== undefined || (invalidNames.length > 0 && invalidNames.every((name) => touched[name]));
  useEffect(() => {
    onTouched?.(allTouched);
  }, [allTouched, onTouched]);

  const shows = (name: string) => showProblems || Boolean(touched[name]);
  const invalid = (name: string) => shows(name) && problems[name] !== undefined;
  const message = (name: string) => (shows(name) && typeof problems[name] === 'string' ? (problems[name] as string) : undefined);

  const fieldName = fieldNameOf(agg);
  const field = indexPattern?.fields.find((candidate) => candidate.name === fieldName);
  const allowStrings = visType ? allowsStrings(visType, agg.schema) : true;
  const editorProps: ParamEditorProps = { agg, params, set, touch, invalid, message, indexPattern, aggs, context, field, metricAggs, showProblems, visType, disabledParams, onChange };

  const basic: ReactNode[] = [];
  const advanced: ReactNode[] = [];
  paramNames(agg.type).forEach((name, index) => {
    if (name === 'customLabel' && hideCustomLabel) return;
    const editor = paramEditor(name, index, editorProps, allowStrings);
    if (!editor) return;
    (isAdvanced(agg.type, name) ? advanced : basic).push(<ParamSlot key={`${name}${agg.type}`}>{editor}</ParamSlot>);
  });

  const typeOptions = aggTypeOptions(types, nested);
  const typeErrors = [aggError, !types.length ? `The index pattern ${indexPattern?.displayName || indexPattern?.title || ''} does not have any aggregatable fields.` : undefined].filter(
    (text): text is string => Boolean(text)
  );
  const typeInvalid = invalid('type') || (shows('type') && typeErrors.length > 0);

  return (
    <div className={cx('vzeForm', className)} data-test-subj={testId}>
      {formError && (
        <div className="atlCallOut atlCallOut--critical vzeForm__errors" role="alert" aria-live="assertive">
          <div className="atlGrow">
            <div className="atlCallOut__title">Please address the highlighted errors.</div>
            <ul>
              <li>{formError}</li>
            </ul>
          </div>
        </div>
      )}
      <ParamRow
        label={subAggregation ? 'Sub aggregation' : 'Aggregation'}
        labelFor={`visDefaultEditorAggSelect${agg.id}`}
        invalid={typeInvalid}
        labelAppend={
          agg.type ? (
            <a className="vzeHelpLink" href={HELP_LINK} target="_blank" rel="noopener noreferrer">
              {AGG_TITLES[agg.type] ?? agg.type} help
              <Icon name="external" title="External link" />
              <span className="atlScreenReaderOnly">(opens in a new tab or window)</span>
            </a>
          ) : undefined
        }
        error={typeInvalid && typeErrors.length ? typeErrors : undefined}
      >
        <div onBlur={() => touch('type')}>
          <ComboBox
            id={`visDefaultEditorAggSelect${agg.id}`}
            single
            fullWidth
            clearable={false}
            disabled={!types.length}
            sortMatchesBy="startsWith"
            options={typeOptions}
            selected={agg.type ? [agg.type] : []}
            placeholder="Select an aggregation"
            invalid={typeInvalid}
            onChange={(selected) => {
              if (selected[0] && selected[0] !== agg.type) onChange(changeAggType(agg, selected[0], indexPattern, aggs, defaultQueryLanguage()));
            }}
            testId="defaultEditorAggSelect"
          />
        </div>
      </ParamRow>
      {basic}
      {advanced.length > 0 && (
        <>
          <div className="vzeSpacer vzeSpacer--m" />
          <Disclosure title="Advanced" testId={`advancedParams-${agg.id}`}>
            <div className="vzeSpacer vzeSpacer--s" />
            {advanced}
          </Disclosure>
        </>
      )}
    </div>
  );
}

// A parameter's editor in the flow of the form: rows follow each other 16px apart
function ParamSlot({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

interface ParamEditorProps {
  agg: AggConfig;
  params: Record<string, unknown>;
  set: (patch: Record<string, unknown>) => void;
  touch: (name: string) => void;
  invalid: (name: string) => boolean;
  message: (name: string) => string | undefined;
  indexPattern?: IndexPattern;
  aggs: AggConfig[];
  context: AggContext;
  field?: Field;
  metricAggs: AggConfig[];
  showProblems: boolean;
  visType?: string;
  disabledParams: string[];
  onChange: (agg: AggConfig) => void;
}

/** The editor of one parameter, or nothing when the original has none or does not show it */
function paramEditor(name: string, index: number, p: ParamEditorProps, allowStrings: boolean): ReactNode {
  const { agg, params, set, touch, invalid, field } = p;
  const type = agg.type;
  switch (name) {
    case 'field': {
      const fields = availableFields(type, p.indexPattern, 'field', allowStrings);
      if (!fields.length && index > 0) return null;
      return (
        <FieldParam
          key={type}
          label="Field"
          fields={fields}
          value={fieldNameOf(agg)}
          invalid={invalid('field')}
          error={p.message('field')}
          onBlur={() => touch('field')}
          onChange={(next) => {
            const patch: Record<string, unknown> = { field: next };
            // A date histogram on another field than the time field has no automatic interval
            if (type === 'date_histogram' && next !== p.indexPattern?.timeFieldName && params.interval === 'auto') patch.interval = undefined;
            set(patch);
          }}
        />
      );
    }
    case 'json':
      return <JsonParam value={typeof params.json === 'string' ? params.json : ''} invalid={invalid('json')} onChange={(json) => set({ json })} onBlur={() => touch('json')} />;
    case 'customLabel':
    case 'otherBucketLabel':
    case 'missingBucketLabel':
    case 'exclude':
    case 'include': {
      if (name === 'otherBucketLabel' && !params.otherBucket) return null;
      if (name === 'missingBucketLabel' && (!params.missingBucket || field?.type !== 'string')) return null;
      if (name === 'exclude' || name === 'include') {
        if (type === 'significant_terms' && field?.type !== 'string') return null;
        if (type === 'terms') {
          if (field?.type !== 'string' && field?.type !== 'number') return null;
          if (field.type === 'number') return <IncludeExcludeNumbers name={name} p={p} />;
        }
      }
      const labels: Record<string, string> = {
        customLabel: 'Custom label',
        otherBucketLabel: 'Label for other bucket',
        missingBucketLabel: 'Label for missing values',
        exclude: 'Exclude',
        include: 'Include',
      };
      const value = params[name];
      return (
        <ParamRow label={labels[name]} labelFor={`visEditorStringInput${agg.id}${name}`} className="visEditorAggParam__string">
          <TextControl
            id={`visEditorStringInput${agg.id}${name}`}
            value={typeof value === 'string' ? value : ''}
            onChange={(text) => set({ [name]: text })}
            onBlur={() => touch(name)}
            testId={`visEditorStringInput${agg.id}${name}`}
          />
        </ParamRow>
      );
    }
    default:
      break;
  }

  switch (`${type}.${name}`) {
    case 'date_histogram.interval':
      return <TimeIntervalParam p={p} />;
    case 'date_histogram.scaleMetricValues':
      return (
        <SwitchRow
          label="Scale metric values (deprecated)"
          checked={Boolean(params.scaleMetricValues)}
          onChange={(scaleMetricValues) => set({ scaleMetricValues })}
          testId="scaleMetricsSwitch"
          tooltip="If you select a manual minimum interval and a larger interval will be used, enabling this will cause count and sum metrics to be scaled to the manual selected interval."
        />
      );
    case 'date_histogram.drop_partials':
      if (!fieldNameOf(agg) || fieldNameOf(agg) !== p.indexPattern?.timeFieldName) return null;
      return (
        <SwitchRow
          label="Drop partial buckets"
          checked={Boolean(params.drop_partials)}
          onChange={(drop_partials) => set({ drop_partials })}
          testId="dropPartialBucketsCheckbox"
          tooltip="Remove buckets that span time outside the time range so the histogram doesn't start and end with incomplete buckets."
        />
      );
    case 'histogram.interval':
      return <NumberIntervalParam p={p} />;
    case 'histogram.maxBars':
      if (params.interval !== 'auto' && params.interval !== undefined) return null;
      return <MaxBarsParam p={p} />;
    case 'histogram.min_doc_count':
      return (
        <SwitchRow
          label="Show empty buckets"
          checked={Boolean(params.min_doc_count)}
          disabled={p.disabledParams.includes('min_doc_count')}
          onChange={(minDocCount) => set({ min_doc_count: minDocCount, has_extended_bounds: Boolean(params.has_extended_bounds) && minDocCount })}
          tooltip="Show all buckets, not only the buckets with results"
        />
      );
    case 'histogram.has_extended_bounds':
      return (
        <SwitchRow
          label="Extend bounds"
          checked={Boolean(params.has_extended_bounds)}
          disabled={!params.min_doc_count || !(field?.type === 'number' || field?.type === 'date')}
          onChange={(hasExtendedBounds) => set({ has_extended_bounds: hasExtendedBounds })}
          tooltip="Min and Max do not filter the results, but rather extend the bounds of the result set."
        />
      );
    case 'histogram.extended_bounds':
      if (!params.has_extended_bounds) return null;
      return <ExtendedBoundsParam p={p} />;
    case 'range.ranges':
      return <RangesParam p={p} />;
    case 'date_range.ranges':
      return <DateRangesParam p={p} />;
    case 'ip_range.ipRangeType':
      return (
        <>
          <div className="vzeSpacer vzeSpacer--m" />
          <ButtonGroup
            legend="IP ranges"
            options={[
              { id: 'fromTo', label: 'From/to', testId: `visEditorIpRangeFromToLabel${agg.id}` },
              { id: 'mask', label: 'CIDR masks', testId: `visEditorIpRangeCidrLabel${agg.id}` },
            ]}
            selected={params.ipRangeType === 'mask' ? 'mask' : 'fromTo'}
            onChange={(ipRangeType) => set({ ipRangeType })}
          />
          <div className="vzeSpacer vzeSpacer--s" />
        </>
      );
    case 'ip_range.ranges':
      return <IpRangesParam p={p} />;
    case 'terms.orderBy':
      return <OrderByParam p={p} />;
    case 'terms.orderAgg':
      if (params.orderBy !== 'custom' || !params.orderAgg) return null;
      return (
        <>
          <div className="vzeSpacer vzeSpacer--m" />
          <NestedAgg p={p} name="orderAgg" group="metrics" hideCustomLabel />
        </>
      );
    case 'terms.order':
      return (
        <div className="visEditorAggParam--half visEditorAggParam--half-order">
          <ParamRow label="Order" labelFor={`visEditorOrder${agg.id}`}>
            <SelectControl id={`visEditorOrder${agg.id}`} value={String(params.order ?? '')} options={ORDERS} onChange={(order) => set({ order })} />
          </ParamRow>
        </div>
      );
    case 'terms.size':
      return (
        <div className="visEditorAggParam--half visEditorAggParam--half-size">
          <SizeParam p={p} />
        </div>
      );
    case 'terms.otherBucket':
      return (
        <SwitchRow
          label="Group other values in separate bucket"
          checked={Boolean(params.otherBucket)}
          onChange={(otherBucket) => set({ otherBucket })}
          testId="otherBucketSwitch"
          tooltip="Values not in the top N are grouped in this bucket. To include documents with missing values, enable 'Show missing values'."
        />
      );
    case 'terms.missingBucket':
      return <MissingBucketParam p={p} />;
    case 'significant_terms.size':
      return <SizeParam p={p} />;
    case 'filters.filters':
      return <FiltersParam p={p} />;
    case 'geohash_grid.autoPrecision':
      return <SwitchRow label="Change precision on map zoom" checked={Boolean(params.autoPrecision)} onChange={(autoPrecision) => set({ autoPrecision })} />;
    case 'geohash_grid.precision': {
      if (params.autoPrecision) return null;
      const max = Number.parseInt(String(services.uiSettings.get('visualization:tileMap:maxPrecision', 7)), 10) || 7;
      return (
        <ParamRow label="Precision">
          <RangeControl min={1} max={max} value={Number(params.precision ?? 2)} onChange={(precision) => set({ precision })} testId={`visEditorMapPrecision${agg.id}`} />
        </ParamRow>
      );
    }
    case 'geohash_grid.useGeocentroid':
      return <SwitchRow label="Place markers off grid (use geocentroid)" checked={Boolean(params.useGeocentroid)} onChange={(useGeocentroid) => set({ useGeocentroid })} />;
    case 'geohash_grid.isFilteredByCollar':
      return (
        <SwitchRow
          label="Only request data around map extent"
          checked={Boolean(params.isFilteredByCollar)}
          onChange={(isFilteredByCollar) => set({ isFilteredByCollar })}
          testId="isFilteredByCollarCheckbox"
          tooltip="Apply geo_bounding_box filter aggregation to narrow the subject area to the map view box with collar"
        />
      );
    case 'top_hits.aggregate':
      return (
        <div className="visEditorAggParam--half visEditorAggParam--half-aggregate">
          <TopAggregateParam p={p} />
        </div>
      );
    case 'top_hits.size':
      return (
        <div className="visEditorAggParam--half visEditorAggParam--half-size">
          <SizeParam p={p} tip="Request top-K hits. Multiple hits will be combined via 'aggregate with'." />
        </div>
      );
    case 'top_hits.sortField': {
      const fields = availableFields('top_hits', p.indexPattern, 'sortField');
      if (!fields.length) return null;
      const sort = params.sortField as string | { name?: string } | undefined;
      return (
        <FieldParam
          key="sortField"
          label="Sort on"
          fields={fields}
          value={typeof sort === 'string' ? sort : sort?.name}
          invalid={invalid('sortField')}
          onBlur={() => touch('sortField')}
          onChange={(sortField) => set({ sortField })}
        />
      );
    }
    case 'top_hits.sortOrder':
      return (
        <ParamRow label="Order" labelFor={`visEditorOrder${agg.id}`}>
          <SelectControl id={`visEditorOrder${agg.id}`} value={String(params.sortOrder ?? '')} options={ORDERS} onChange={(sortOrder) => set({ sortOrder })} />
        </ParamRow>
      );
    case 'percentiles.percents':
      return <NumberListParam p={p} name="percents" legend="Percents" unit="percent" range={[0, 100]} />;
    case 'percentile_ranks.values':
      return <NumberListParam p={p} name="values" legend="Values" unit="value" range={[-Infinity, Infinity]} ascending testId="visEditorPercentileRanks" />;
    default:
      break;
  }
  if (SIBLING_PIPELINES.includes(type) && (name === 'customBucket' || name === 'customMetric')) {
    const metric = name === 'customMetric';
    return (
      <>
        <div className="vzeSpacer vzeSpacer--m" />
        <div className="vzeFormLabel">{metric ? 'Metric' : 'Bucket'}</div>
        <div className="vzeSpacer vzeSpacer--s" />
        <NestedAgg p={p} name={name} group={metric ? 'metrics' : 'buckets'} hideCustomLabel={!metric} />
      </>
    );
  }
  if (PARENT_PIPELINES.includes(type)) {
    if (name === 'metricAgg') return <MetricAggParam p={p} />;
    if (name === 'customMetric') {
      if (params.metricAgg !== 'custom' || !params.customMetric) return null;
      return (
        <>
          <div className="vzeSpacer vzeSpacer--m" />
          <NestedAgg p={p} name="customMetric" group="metrics" hideCustomLabel />
        </>
      );
    }
  }
  return null;
}

// --- The editors --------------------------------------------------------------------------------

function FieldParam({
  label,
  fields,
  value,
  invalid,
  error,
  onBlur,
  onChange,
}: {
  label: string;
  fields: Field[];
  value: string | undefined;
  invalid: boolean;
  error?: string;
  onBlur: () => void;
  onChange: (field: string) => void;
}) {
  // A field that is the only one there can be is chosen as the editor opens
  const only = fields.length === 1 ? fields[0].name : undefined;
  useEffect(() => {
    if (!value && only) onChange(only);
    // On opening only, as the original's `useMount`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <ParamRow label={label} error={error} invalid={invalid}>
      <div onBlur={onBlur}>
        <ComboBox
          single
          fullWidth
          clearable={false}
          sortMatchesBy="startsWith"
          options={fieldOptions(fields)}
          selected={value ? [value] : []}
          placeholder="Select a field"
          disabled={!fields.length}
          invalid={invalid}
          onChange={(selected) => {
            if (selected[0]) onChange(selected[0]);
          }}
          testId="visDefaultEditorField"
        />
      </div>
    </ParamRow>
  );
}

function JsonParam({ value, invalid, onChange, onBlur }: { value: string; invalid: boolean; onChange: (json: string) => void; onBlur: () => void }) {
  // The original's editor draws a band on the line of the cursor, the first one before it is used
  const [active, setActive] = useState(0);
  const lineOf = (offset: number) => value.slice(0, offset).split('\n').length - 1;
  return (
    <ParamRow
      label={
        <TipLabel
          label="JSON input"
          position="right"
          tip="Any JSON formatted properties you add here will be merged with the opensearch aggregation definition for this section. For example 'shard_size' on a terms aggregation."
        />
      }
      invalid={invalid}
    >
      <div className="vzeJson" onBlur={onBlur}>
        <CodeEditor
          value={value}
          onChange={onChange}
          height={250}
          tokenize={tokenizeJson}
          ariaLabel="JSON input"
          testId="codeEditorContainer"
          fontSize={14}
          markedLines={active >= 0 ? [active, active] : undefined}
          onCursor={(start, end) => setActive(lineOf(start) === lineOf(end) ? lineOf(end) : -1)}
        />
      </div>
    </ParamRow>
  );
}

function TimeIntervalParam({ p }: { p: ParamEditorProps }) {
  const { agg, params, set, touch, invalid, indexPattern, context } = p;
  const timeField = Boolean(indexPattern?.timeFieldName) && fieldNameOf(agg) === indexPattern?.timeFieldName;
  const options = INTERVALS.filter((option) => option.key !== 'auto' || timeField);
  const value = typeof params.interval === 'string' ? params.interval : undefined;
  const known = options.find((option) => option.key === value);
  const comboOptions: ComboOption[] = options.map((option) => ({ value: option.key, label: option.label }));
  if (value && !known) comboOptions.push({ value, label: value });
  const valid = !invalid('interval') && value;
  const interval = valid && fieldNameOf(agg) ? dateInterval(agg, context) : undefined;
  return (
    <ParamRow
      label="Minimum interval"
      error={p.message('interval')}
      invalid={invalid('interval')}
      help={
        <>
          {interval?.scaled && (
            <strong className="vzeBlock" data-test-subj="currentlyScaledText">
              Currently scaled to {interval.description}{' '}
              <TipIcon
                tip={
                  interval.ms < (parseInterval(/^\d/.test(value ?? '') ? (value ?? '') : `1${value ?? ''}`)?.ms ?? 0)
                    ? 'This interval creates buckets that are too large to show in the selected time range, so it has been scaled down.'
                    : 'This interval creates too many buckets to show in the selected time range, so it has been scaled up.'
                }
              />
            </strong>
          )}
          Select an option or create a custom value. Examples: 30s, 20m, 24h, 2d, 1w, 1M
        </>
      }
    >
      <div onBlur={() => touch('interval')}>
        <ComboBox
          single
          fullWidth
          allowCustom
          options={comboOptions}
          selected={value ? [value] : []}
          placeholder="Select an interval"
          invalid={invalid('interval')}
          onChange={(selected) => set({ interval: selected[0] !== undefined ? selected[0].trim() : '' })}
          testId="visEditorInterval"
        />
      </div>
    </ParamRow>
  );
}

/**
 * "Show missing values": of a text field only. For any other field the original's editor switches
 * the parameter off as it opens, without that being a change to apply; here it is shown off and
 * asked as off, and what is saved keeps what it had.
 */
function MissingBucketParam({ p }: { p: ParamEditorProps }) {
  const { params, set, field } = p;
  const notText = field?.type !== 'string';
  const on = Boolean(params.missingBucket);
  return (
    <SwitchRow
      label="Show missing values"
      checked={on && !notText}
      disabled={notText}
      onChange={(missingBucket) => set({ missingBucket })}
      testId="missingBucketSwitch"
      tooltip={
        'Only works for fields of type "string". When enabled, include documents with missing values in the search. If this bucket is in the top N, it appears in the chart. If not in the top N, and you enable "Group other values in separate bucket", OpenSearch adds the missing values to the "other" bucket.'
      }
    />
  );
}

function TipIcon({ tip }: { tip: string }) {
  return (
    <Tooltip content={tip} position="right">
      <span className="vzeIconTip" tabIndex={0}>
        <Icon name="help" title="Info" />
      </span>
    </Tooltip>
  );
}

function NumberIntervalParam({ p }: { p: ParamEditorProps }) {
  const { agg, params, set, touch, invalid, field } = p;
  const supportsAuto = !field || field.type === 'number';
  const auto = supportsAuto && params.interval === 'auto';
  return (
    <ParamRow
      label={
        <TipLabel
          label="Minimum interval"
          position="right"
          tip="Interval will be automatically scaled in the event that the provided value creates more buckets than specified by Advanced Setting's histogram:maxBars"
        />
      }
      invalid={invalid('interval')}
    >
      <div className="vzeColumn">
        <SwitchRow
          label="Use auto interval"
          checked={auto}
          disabled={!supportsAuto}
          onChange={(next) => set({ interval: next ? 'auto' : '' })}
          testId={`visEditorIntervalSwitch${agg.id}`}
        />
        <NumberControl
          value={auto ? '' : (params.interval as number | string | undefined)}
          min={0}
          disabled={auto}
          invalid={invalid('interval')}
          placeholder={auto ? 'Auto interval is used' : 'Enter an interval'}
          onChange={(interval) => set({ interval })}
          onBlur={() => touch('interval')}
          testId={`visEditorInterval${agg.id}`}
        />
      </div>
    </ParamRow>
  );
}

function MaxBarsParam({ p }: { p: ParamEditorProps }) {
  const { params, set, touch, invalid } = p;
  const max = Number(services.uiSettings.get('histogram:maxBars', 100)) || 100;
  return (
    <ParamRow
      label={
        <TipLabel
          label="Max bars"
          position="right"
          tip="Intervals will be selected automatically based on the available data. The maximum number of bars can never be greater than the Advanced Setting's histogram:maxBars"
        />
      }
      invalid={invalid('maxBars')}
    >
      <NumberControl
        value={params.maxBars as number | string | undefined}
        min={1}
        max={max}
        placeholder="Auto"
        invalid={invalid('maxBars')}
        onChange={(maxBars) => set({ maxBars: maxBars === '' ? undefined : maxBars })}
        onBlur={() => touch('maxBars')}
        testId="maxBarsParamEditor"
      />
    </ParamRow>
  );
}

function ExtendedBoundsParam({ p }: { p: ParamEditorProps }) {
  const { params, set, touch, invalid } = p;
  const bounds = (params.extended_bounds ?? {}) as { min?: number | ''; max?: number | '' };
  const bad = invalid('extended_bounds');
  return (
    <ParamRow error={p.message('extended_bounds')} invalid={bad}>
      <div className="vzePair">
        <NumberControl prepend="Min" ariaLabel="Min" value={bounds.min} invalid={bad} onChange={(min) => set({ extended_bounds: { ...bounds, min } })} onBlur={() => touch('extended_bounds')} />
        <NumberControl prepend="Max" ariaLabel="Max" value={bounds.max} invalid={bad} onChange={(max) => set({ extended_bounds: { ...bounds, max } })} onBlur={() => touch('extended_bounds')} />
      </div>
    </ParamRow>
  );
}

function SizeParam({ p, tip }: { p: ParamEditorProps; tip?: string }) {
  const { agg, params, set, touch, invalid } = p;
  return (
    <ParamRow label={tip ? <TipLabel label="Size" tip={tip} position="right" /> : 'Size'} labelFor={`visEditorSize${agg.id}`} invalid={invalid('size')}>
      <NumberControl
        id={`visEditorSize${agg.id}`}
        value={params.size as number | string | undefined}
        min={1}
        invalid={invalid('size')}
        onChange={(size) => set({ size })}
        onBlur={() => touch('size')}
        testId="sizeParamEditor"
      />
    </ParamRow>
  );
}

function TopAggregateParam({ p }: { p: ParamEditorProps }) {
  const { params, set, touch, invalid, field } = p;
  const options = field ? topAggregates(field.type) : [];
  const first = useRef(true);
  const fieldType = field?.type;
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const value = params.aggregate;
    if (value && options.some((option) => option.value === value)) return;
    set({ aggregate: options.length === 1 ? options[0].value : undefined });
    // When the field's type changes only, as the original
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fieldType]);
  return (
    <ParamRow
      label={<TipLabel label="Aggregate with" position="right" tip="Choose a strategy for combining multiple hits or a multi-valued field into a single metric." />}
      error={p.message('aggregate')}
      invalid={invalid('aggregate')}
    >
      <SelectControl
        value={typeof params.aggregate === 'string' ? params.aggregate : ''}
        options={options}
        noInitialSelection
        disabled={Boolean(fieldType) && !options.length}
        invalid={invalid('aggregate')}
        onChange={(aggregate) => set({ aggregate: aggregate || undefined })}
        onBlur={() => touch('aggregate')}
        testId="visDefaultEditorAggregateWith"
      />
    </ParamRow>
  );
}

function OrderByParam({ p }: { p: ParamEditorProps }) {
  const { agg, params, set, touch, invalid, metricAggs, context, aggs } = p;
  // As the original, every value the metrics answer with: each percentile rank can order the terms
  const values = metricAggs.flatMap((metric) => responseAggs(metric, { ...context, aggs }));
  const options = [
    ...values.map((item) => ({ value: item.id, label: `Metric: ${item.label}`, disabled: !orderableMetric(item.agg) })),
    { value: 'custom', label: 'Custom metric' },
    { value: '_key', label: 'Alphabetical' },
  ];
  const value = String(params.orderBy ?? '');
  // A metric that is no longer asked for, or that cannot order the terms, gives way to the alphabet;
  // an aggregation that says nothing is ordered by the first metric that can, as the editor opens
  const metrics = values.map((item) => `${item.id}:${item.agg.type}`).join();
  useEffect(() => {
    const fallback = value ? fallbackMetric(value, values, (item) => orderableMetric(item.agg), '_key') : firstOrderBy(metricAggs, { ...context, aggs });
    if (fallback) set({ orderBy: fallback });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, metrics]);
  return (
    <ParamRow label="Order by" labelFor={`visEditorOrderBy${agg.id}`} invalid={invalid('orderBy')}>
      <SelectControl
        id={`visEditorOrderBy${agg.id}`}
        value={value}
        options={options}
        invalid={invalid('orderBy')}
        onChange={(orderBy) => set(orderByParams(agg.id, orderBy, params.orderAgg))}
        onBlur={() => touch('orderBy')}
        testId={`visEditorOrderBy${agg.id}`}
      />
    </ParamRow>
  );
}

function MetricAggParam({ p }: { p: ParamEditorProps }) {
  const { agg, params, set, touch, invalid, metricAggs, context, aggs } = p;
  const values = metricAggs.filter((metric) => metric.type !== agg.type).flatMap((metric) => responseAggs(metric, { ...context, aggs }));
  const options = [...values.map((item) => ({ value: item.id, label: `Metric: ${item.label}`, disabled: !parentPipelineMetric(item.agg) })), { value: 'custom', label: 'Custom metric' }];
  const value = String(params.metricAgg ?? '');
  const choose = (metricAgg: string) =>
    set({ metricAgg, customMetric: metricAgg === 'custom' ? (params.customMetric ?? nestedCount(`${agg.id}-metric`)) : undefined });
  // A metric that is no longer asked for, or that a pipeline cannot work on, gives way to a custom one
  const metrics = values.map((item) => `${item.id}:${item.agg.type}`).join();
  useEffect(() => {
    const fallback = fallbackMetric(value, values, (item) => parentPipelineMetric(item.agg), 'custom');
    if (fallback) choose(fallback);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, metrics]);
  return (
    <ParamRow label="Metric" labelFor={`visEditorSubAggMetric${agg.id}`} invalid={invalid('metricAgg')}>
      <SelectControl
        id={`visEditorSubAggMetric${agg.id}`}
        value={value}
        options={options}
        invalid={invalid('metricAgg')}
        onChange={choose}
        onBlur={() => touch('metricAgg')}
        testId={`visEditorSubAggMetric${agg.id}`}
      />
    </ParamRow>
  );
}

/** An aggregation inside this one, in a frame of its own */
function NestedAgg({ p, name, group, hideCustomLabel }: { p: ParamEditorProps; name: string; group: 'metrics' | 'buckets'; hideCustomLabel?: boolean }) {
  const { agg, params, set } = p;
  const child = params[name] as AggConfig | undefined;
  const disabled = (services.uiSettings.get('visualize:disableBucketAgg', []) ?? []) as string[];
  if (!child || typeof child !== 'object') return null;
  return (
    <AggEditor
      agg={child}
      types={group === 'buckets' ? nestedAggs(agg.type, 'customBucket', disabled) : nestedAggs(agg.type, name)}
      indexPattern={p.indexPattern}
      aggs={p.aggs}
      context={p.context}
      onChange={(next) => set({ [name]: next })}
      showProblems={p.showProblems}
      visType={p.visType}
      nested
      hideCustomLabel={hideCustomLabel}
      metricAggs={p.metricAggs}
      className="visEditorAgg__subAgg"
    />
  );
}

interface FromTo<T> {
  from?: T;
  to?: T;
}

/**
 * The rows of a list as the original lays them out: each row followed by 4px (`after`), or 8px
 * between two rows (`between`); then what is wrong, 8px, and "Add" as wide as the list.
 */
function ListRows({ rows, spacing, error, add }: { rows: ReactNode[]; spacing: 'after' | 'between'; error?: ReactNode; add: ReactNode }) {
  return (
    <>
      {rows.map((row, index) => (
        <Fragment key={index}>
          {row}
          {spacing === 'after' && <div className="vzeSpacer vzeSpacer--xs" />}
          {spacing === 'between' && index < rows.length - 1 && <div className="vzeSpacer vzeSpacer--s" />}
        </Fragment>
      ))}
      {error}
      <div className="vzeSpacer vzeSpacer--s" />
      {add}
    </>
  );
}

/** The ranges of a range aggregation: from ≥, to <, one row each; a new range is empty */
function RangesParam({ p }: { p: ParamEditorProps }) {
  const { params, set } = p;
  const ranges = (Array.isArray(params.ranges) ? params.ranges : []) as Array<FromTo<number | ''>>;
  const setRanges = (next: Array<FromTo<number | ''>>) => set({ ranges: next });
  useEffect(() => {
    if (!ranges.length) setRanges([{}]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ranges.length]);
  const shown = (value: number | '' | undefined): string => (value === undefined || value === '' ? '' : String(value));
  return (
    <ParamRow>
      <ListRows
        spacing="after"
        rows={ranges.map((range, index) => {
          const label = `Remove the range of ${shown(range.from) || '−∞'} to ${shown(range.to) || '+∞'}`;
          return (
            <div className="vzeRangeRow">
              <NumberControl
                prepend={<TipPrepend text="≥" tip="Greater than or equal to" />}
                value={range.from}
                placeholder="−∞"
                ariaLabel="From"
                onChange={(from) => setRanges(ranges.map((item, at) => (at === index ? { ...item, from: from === '' ? undefined : from } : item)))}
                testId={`range${index}__from`}
              />
              <Icon name="arrowRight" className="vzeRangeRow__arrow" />
              <NumberControl
                prepend={<TipPrepend text="<" tip="Less than" />}
                value={range.to}
                placeholder="+∞"
                ariaLabel="To"
                onChange={(to) => setRanges(ranges.map((item, at) => (at === index ? { ...item, to: to === '' ? undefined : to } : item)))}
                testId={`range${index}__to`}
              />
              <SmallIconButton icon="trash" danger label={label} title={label} disabled={ranges.length === 1} onClick={() => setRanges(ranges.filter((_, at) => at !== index))} />
            </div>
          );
        })}
        add={
          <AddButton block onClick={() => setRanges([...ranges, {}])} testId="range__addRangeButton">
            Add range
          </AddButton>
        }
      />
    </ParamRow>
  );
}

function TipPrepend({ text, tip }: { text: string; tip: string }) {
  return (
    <Tooltip content={tip}>
      <span>{text}</span>
    </Tooltip>
  );
}

function DateRangesParam({ p }: { p: ParamEditorProps }) {
  const { params, set, touch } = p;
  const ranges = (Array.isArray(params.ranges) ? params.ranges : []) as Array<FromTo<string>>;
  const setRanges = (next: Array<FromTo<string>>) => set({ ranges: next });
  // As the original, a list without ranges gets an empty one as soon as it is drawn
  useEffect(() => {
    if (!ranges.length) setRanges([{}]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ranges.length]);
  // As the original, a date that is not one shows at once, touched or not
  const wrong = (range: FromTo<string>, side: 'from' | 'to') => (!range.from && !range.to) || !isValidDateMath(range[side]);
  const hasInvalid = ranges.some((range) => wrong(range, 'from') || wrong(range, 'to'));
  return (
    <ParamRow>
      <>
        <a className="vzeHelpLink" href={DATE_MATH_LINK} target="_blank" rel="noopener noreferrer">
          Acceptable date formats
          <Icon name="external" title="External link" />
          <span className="atlScreenReaderOnly">(opens in a new tab or window)</span>
        </a>
        <div className="vzeSpacer vzeSpacer--s" />
        <ListRows
          spacing="after"
          rows={ranges.map((range, index) => {
            const label = `Remove the range of ${range.from || '−∞'} to ${range.to || '+∞'}`;
            return (
              <div className="vzeRangeRow">
                <TextControl
                  value={range.from ?? ''}
                  placeholder="−∞"
                  ariaLabel="From"
                  invalid={wrong(range, 'from')}
                  onChange={(from) => setRanges(ranges.map((item, at) => (at === index ? { ...item, from } : item)))}
                  onBlur={() => touch('ranges')}
                  testId={`visEditorDateRange${index}__from`}
                />
                <Icon name="arrowRight" className="vzeRangeRow__arrow" />
                <TextControl
                  value={range.to ?? ''}
                  placeholder="+∞"
                  ariaLabel="To"
                  invalid={wrong(range, 'to')}
                  onChange={(to) => setRanges(ranges.map((item, at) => (at === index ? { ...item, to } : item)))}
                  onBlur={() => touch('ranges')}
                  testId={`visEditorDateRange${index}__to`}
                />
                <SmallIconButton icon="trash" danger label={label} title={label} disabled={ranges.length === 1} onClick={() => setRanges(ranges.filter((_, at) => at !== index))} />
              </div>
            );
          })}
          error={hasInvalid ? <div className="vzeRow__error">Each range should have at least one valid date.</div> : undefined}
          add={
            <AddButton block icon="plus" onClick={() => setRanges([...ranges, {}])} testId="visEditorAddDateRange">
              Add range
            </AddButton>
          }
        />
      </>
    </ParamRow>
  );
}

/** The IP ranges: from and to, or CIDR masks, one row each 4px apart; a new row is empty */
function IpRangesParam({ p }: { p: ParamEditorProps }) {
  const { params, set, touch } = p;
  // A field that is not an address shows once the list is touched; the list is wrong if one is
  const shows = p.invalid('ranges');
  const onBlur = () => touch('ranges');
  const ranges = (params.ranges ?? {}) as { fromTo?: Array<FromTo<string>>; mask?: Array<{ mask?: string }> };
  const setRanges = (next: typeof ranges) => set({ ranges: next });
  const add = (onClick: () => void) => (
    <AddButton block onClick={onClick}>
      Add range
    </AddButton>
  );
  if (params.ipRangeType === 'mask') {
    const list = ranges.mask ?? [];
    return (
      <ParamRow>
        <ListRows
          spacing="after"
          rows={list.map((item, index) => {
            const label = item.mask ? `Remove the CIDR mask value of ${item.mask}` : 'Remove the CIDR mask default value';
            return (
              <div className="vzeRangeRow vzeRangeRow--tight">
                <TextControl
                  value={item.mask ?? ''}
                  placeholder="*"
                  ariaLabel={`CIDR mask: ${item.mask || '*'}`}
                  invalid={shows && !isValidIpField(item.mask, true)}
                  onChange={(mask) => setRanges({ ...ranges, mask: list.map((other, at) => (at === index ? (mask ? { mask } : {}) : other)) })}
                  onBlur={onBlur}
                />
                <SmallIconButton icon="trash" danger label={label} title={label} disabled={list.length === 1} onClick={() => setRanges({ ...ranges, mask: list.filter((_, at) => at !== index) })} />
              </div>
            );
          })}
          add={add(() => setRanges({ ...ranges, mask: [...list, {}] }))}
        />
      </ParamRow>
    );
  }
  const list = ranges.fromTo ?? [];
  const change = (index: number, side: 'from' | 'to', text: string) =>
    setRanges({
      ...ranges,
      fromTo: list.map((other, at) => {
        if (at !== index) return other;
        const next: FromTo<string> = { ...other };
        if (text) next[side] = text;
        else delete next[side];
        return next;
      }),
    });
  return (
    <ParamRow>
      <ListRows
        spacing="after"
        rows={list.map((item, index) => {
          const label = `Remove the range of ${item.from || '*'} to ${item.to || '*'}`;
          return (
            <div className="vzeRangeRow vzeRangeRow--tight">
              <TextControl
                value={item.from ?? ''}
                placeholder="*"
                ariaLabel={`IP range from: ${item.from || '*'}`}
                invalid={shows && !isValidIpField(item.from)}
                onChange={(text) => change(index, 'from', text)}
                onBlur={onBlur}
              />
              <Icon name="arrowRight" className="vzeRangeRow__arrow" />
              <TextControl
                value={item.to ?? ''}
                placeholder="*"
                ariaLabel={`IP range to: ${item.to || '*'}`}
                invalid={shows && !isValidIpField(item.to)}
                onChange={(text) => change(index, 'to', text)}
                onBlur={onBlur}
              />
              <SmallIconButton icon="trash" danger label={label} title={label} disabled={list.length === 1} onClick={() => setRanges({ ...ranges, fromTo: list.filter((_, at) => at !== index) })} />
            </div>
          );
        })}
        add={add(() => setRanges({ ...ranges, fromTo: [...list, {}] }))}
      />
    </ParamRow>
  );
}

function FiltersParam({ p }: { p: ParamEditorProps }) {
  const { agg, params, set, indexPattern } = p;
  const filters = (Array.isArray(params.filters) ? params.filters : []) as Array<{ input?: Query; label?: string }>;
  const [labelled, setLabelled] = useState<Record<number, boolean>>({});
  const setFilters = (next: typeof filters) => set({ filters: next });
  return (
    <div>
      <div className="vzeSpacer vzeSpacer--m" />
      {filters.map((filter, index) => {
        const query = filter.input ?? { query: '', language: defaultQueryLanguage() };
        const open = Boolean(labelled[index]);
        return (
          <div key={index} className="vzeForm">
            <ParamRow
              label={`Filter ${index + 1}${filter.label ? ` - ${filter.label}` : ''}`}
              labelAppend={
                <span className="vzeRow__append">
                  <SmallIconButton icon="tag" primary label="Toggle filter label" ariaExpanded={open} onClick={() => setLabelled({ ...labelled, [index]: !open })} />
                  <SmallIconButton
                    icon="trash"
                    danger
                    label="Remove this filter"
                    disabled={filters.length === 1}
                    onClick={() => setFilters(filters.filter((_, at) => at !== index))}
                  />
                </span>
              }
            >
              <div className="vzeFilterQuery">
                <QueryBar
                  autoFocus={index === filters.length - 1}
                  appName="vis_default_editor"
                  testId={`visEditorFilterInput_${agg.id}_${index}`}
                  value={typeof query.query === 'string' ? query.query : ''}
                  language={query.language}
                  onChange={(text) => setFilters(filters.map((other, at) => (at === index ? { ...other, input: { ...query, query: text } } : other)))}
                  onLanguageChange={(language) => setFilters(filters.map((other, at) => (at === index ? { ...other, input: { query: '', language } } : other)))}
                  onSubmit={() => undefined}
                  indexPatterns={indexPattern ? [indexPattern] : []}
                />
              </div>
            </ParamRow>
            {open && (
              <ParamRow label={`Filter ${index + 1} label`}>
                <TextControl
                  value={filter.label ?? ''}
                  placeholder="Label"
                  onChange={(label) => setFilters(filters.map((other, at) => (at === index ? { ...other, label } : other)))}
                />
              </ParamRow>
            )}
            <div className="vzeSpacer vzeSpacer--m" />
          </div>
        );
      })}
      <button
        type="button"
        className="vzeFillButton"
        onClick={() => setFilters([...filters, { input: { query: '', language: defaultQueryLanguage() }, label: '' }])}
        data-test-subj="visEditorAddFilterButton"
      >
        <Icon name="plusCircle" />
        <span>Add filter</span>
      </button>
      <div className="vzeSpacer vzeSpacer--m" />
    </div>
  );
}

/** Numbers one per row, 8px apart: the percents of percentiles, the values of percentile ranks */
function NumberListParam({
  p,
  name,
  legend,
  unit,
  range,
  ascending,
  testId,
}: {
  p: ParamEditorProps;
  name: string;
  legend: string;
  unit: string;
  range: [number, number];
  ascending?: boolean;
  testId?: string;
}) {
  const { params, set, touch, invalid } = p;
  const stored = (Array.isArray(params[name]) ? params[name] : []) as Array<number | '' | undefined>;
  const list: Array<number | '' | undefined> = stored.length ? stored : [0];
  // An empty list starts with a 0, as the original's
  useEffect(() => {
    if (!stored.length) set({ [name]: [0] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored.length]);
  const shows = invalid(name);
  const problemOf = (value: number | '' | undefined, index: number): string | undefined => {
    if (value === '' || value === undefined) return '';
    if (value < range[0] || value > range[1]) return `The value should be in the range of ${range[0]} to ${range[1]}.`;
    const previous = list[index - 1];
    if (ascending && typeof previous === 'number' && value <= previous) return 'Value is not in ascending order.';
    if (!ascending && list.indexOf(value) !== index) return 'Duplicate value.';
    return undefined;
  };
  const errors = list.map(problemOf);
  const next = () => {
    const last = Number(list[list.length - 1]);
    const value = last ? last + 1 : 1;
    return value >= range[1] ? range[1] - 1 : value;
  };
  return (
    <ParamRow label={legend} invalid={shows} testId={testId}>
      <ListRows
        spacing="between"
        rows={list.map((value, index) => (
          <>
            <div className="vzeRangeRow">
              <NumberControl
                value={value}
                placeholder="Enter a value"
                min={Number.isFinite(range[0]) ? range[0] : undefined}
                max={Number.isFinite(range[1]) ? range[1] : undefined}
                invalid={shows && errors[index] !== undefined}
                onChange={(changed) => set({ [name]: list.map((item, at) => (at === index ? changed : item)) })}
                onBlur={() => touch(name)}
              />
              <SmallIconButton
                icon="trash"
                danger
                label={`Remove the rank value of ${value ?? ''}`}
                title={`Remove the rank value of ${value ?? ''}`}
                disabled={list.length === 1}
                onClick={() => set({ [name]: list.filter((_, at) => at !== index) })}
              />
            </div>
            {shows && errors[index] && <div className="vzeRow__error">{errors[index]}</div>}
          </>
        ))}
        add={
          <AddButton block onClick={() => set({ [name]: [...list, next()] })}>
            Add {unit}
          </AddButton>
        }
      />
    </ParamRow>
  );
}

/** Include and exclude of a terms aggregation on numbers: a list of numbers 8px apart */
function IncludeExcludeNumbers({ name, p }: { name: 'include' | 'exclude'; p: ParamEditorProps }) {
  const { params, set } = p;
  const list = (Array.isArray(params[name]) ? params[name] : []) as Array<number | ''>;
  const rows = list.length ? list : [''];
  return (
    <ParamRow label={name === 'include' ? 'Include' : 'Exclude'}>
      <ListRows
        spacing="between"
        rows={rows.map((value, index) => (
          <div className="vzeRangeRow">
            <NumberControl value={value} placeholder="Enter a value" onChange={(changed) => set({ [name]: rows.map((item, at) => (at === index ? changed : item)) })} />
            <SmallIconButton
              icon="trash"
              danger
              label={`Remove the rank value of ${value}`}
              title={`Remove the rank value of ${value}`}
              disabled={rows.length === 1}
              onClick={() => set({ [name]: rows.filter((_, at) => at !== index) })}
            />
          </div>
        ))}
        add={
          <AddButton block onClick={() => set({ [name]: [...rows, ''] })}>
            Add value
          </AddButton>
        }
      />
    </ParamRow>
  );
}

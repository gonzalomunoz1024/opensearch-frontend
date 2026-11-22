/* SPDX-License-Identifier: Apache-2.0 */

/*
 * One aggregation in the editor: its type, its field, the parameters of its type, a label of
 * someone's own and, under Advanced, JSON merged into what is asked of OpenSearch.
 */

import { useState, type ReactNode } from 'react';
import { Accordion, Button, FieldToken, IconButton, Segments } from '../../components/basic';
import { ComboBox, type ComboOption } from '../../components/combo_box';
import { FormRow, NumberField, Select, Switch, TextArea, TextField } from '../../components/form';
import { AGG_TITLES, BUCKET_TYPES, aggLabel, dateInterval, fieldNameOf, type AggConfig, type AggContext } from '../../lib/aggs';
import type { IndexPattern, Query } from '../../lib/types';
import { defaultQueryLanguage } from '../../shell/query_bar';
import { PARENT_PIPELINES, SIBLING_PIPELINES, aggGroup, changeAggType, fieldsFor, orderableMetric, takesField } from './defaults';
import { GeohashParams } from './maps/geohash_params';

export interface AggEditorProps {
  agg: AggConfig;
  /** The types someone may choose, in the order they are listed */
  types: string[];
  indexPattern?: IndexPattern;
  /** Every aggregation of the chart: a terms bucket can be ordered by one of its metrics */
  aggs: AggConfig[];
  context: AggContext;
  onChange: (agg: AggConfig) => void;
  /** Problems are shown once someone has asked for the chart */
  showProblems?: boolean;
  /** An aggregation inside another has no label and no JSON of its own */
  nested?: boolean;
  typeLabel?: string;
}

const INTERVALS: ComboOption[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'ms', label: 'Millisecond' },
  { value: 's', label: 'Second' },
  { value: 'm', label: 'Minute' },
  { value: 'h', label: 'Hour' },
  { value: 'd', label: 'Day' },
  { value: 'w', label: 'Week' },
  { value: 'M', label: 'Month' },
  { value: 'y', label: 'Year' },
];

const ORDERS = [
  { value: 'desc', label: 'Descending' },
  { value: 'asc', label: 'Ascending' },
];

// What a sibling pipeline may be over, and what the metric inside a pipeline may be
const SUB_BUCKETS = BUCKET_TYPES.filter((type) => type !== 'geohash_grid');
const SUB_METRICS = ['count', 'avg', 'sum', 'median', 'min', 'max', 'std_dev', 'cardinality'];
const ORDER_METRICS = ['count', 'avg', 'sum', 'median', 'min', 'max', 'cardinality'];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="vzeSub">
      <h4 className="vzeSub__title">{title}</h4>
      <div className="vzeFields">{children}</div>
    </div>
  );
}

/** A list of numbers, one per row: the percents of a percentiles aggregation */
function NumberList({ label, unit, values, onChange }: { label: string; unit: string; values: number[]; onChange: (values: number[]) => void }) {
  const rows: Array<number | undefined> = values.length ? values : [undefined];
  return (
    <div className="atlFormRow atlFormRow--full">
      <span className="atlFormRow__label">{label}</span>
      {rows.map((value, index) => (
        <div className="atlRow" key={index}>
          <NumberField
            className="atlGrow"
            compact
            value={value}
            aria-label={`${unit} ${index + 1}`}
            onChange={(next) => onChange(rows.map((item, at) => (at === index ? next : item)).filter((item): item is number => item !== undefined))}
          />
          <IconButton
            icon="trash"
            size="s"
            label={`Remove the ${unit} ${value ?? ''}`}
            disabled={rows.length === 1}
            onClick={() => onChange(values.filter((_, at) => at !== index))}
          />
        </div>
      ))}
      <div>
        <Button variant="empty" size="s" icon="plusCircle" onClick={() => onChange([...values, (values[values.length - 1] ?? 0) + 1])}>
          Add value
        </Button>
      </div>
    </div>
  );
}

interface FromTo<T> {
  from?: T;
  to?: T;
}

/** Ranges from a value to another: numbers, dates as text, addresses */
function RangeList<T extends string | number>({
  ranges,
  numeric,
  fromLabel = '≥',
  toLabel = '<',
  empty,
  onChange,
}: {
  ranges: Array<FromTo<T>>;
  numeric?: boolean;
  fromLabel?: string;
  toLabel?: string;
  empty: FromTo<T>;
  onChange: (ranges: Array<FromTo<T>>) => void;
}) {
  const set = (index: number, patch: FromTo<T>) => onChange(ranges.map((range, at) => (at === index ? { ...range, ...patch } : range)));
  return (
    <div className="vzeRanges">
      {ranges.map((range, index) => (
        <div className="vzeRanges__row" key={index}>
          <span className="vzeRanges__sign" aria-hidden="true">
            {fromLabel}
          </span>
          {numeric ? (
            <NumberField compact value={range.from as number | undefined} placeholder="−∞" aria-label="From" onChange={(from) => set(index, { from: from as T | undefined })} />
          ) : (
            <TextField compact value={String(range.from ?? '')} aria-label="From" onChange={(from) => set(index, { from: from as T })} />
          )}
          <span className="vzeRanges__sign" aria-hidden="true">
            {toLabel}
          </span>
          {numeric ? (
            <NumberField compact value={range.to as number | undefined} placeholder="+∞" aria-label="To" onChange={(to) => set(index, { to: to as T | undefined })} />
          ) : (
            <TextField compact value={String(range.to ?? '')} aria-label="To" onChange={(to) => set(index, { to: to as T })} />
          )}
          <IconButton
            icon="trash"
            size="s"
            label={`Remove the range of ${range.from ?? '−∞'} to ${range.to ?? '+∞'}`}
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
            if (numeric && last && typeof last.to === 'number') {
              const width = typeof last.from === 'number' ? last.to - last.from : last.to;
              onChange([...ranges, { from: last.to, to: (last.to + (width || 1000)) as T }]);
            } else onChange([...ranges, empty]);
          }}
          testId="range__addRangeButton"
        >
          Add range
        </Button>
      </div>
    </div>
  );
}

export function AggEditor({ agg, types, indexPattern, aggs, context, onChange, showProblems, nested, typeLabel = 'Aggregation' }: AggEditorProps) {
  const params = agg.params ?? {};
  const set = (patch: Record<string, unknown>) => onChange({ ...agg, params: { ...params, ...patch } });
  const fieldName = fieldNameOf(agg);
  const field = indexPattern?.fields.find((candidate) => candidate.name === fieldName);
  const [labelled, setLabelled] = useState<Record<number, boolean>>({});

  const typeOptions: ComboOption[] = types.map((type) => ({ value: type, label: AGG_TITLES[type] ?? type, group: nested ? undefined : aggGroup(type) }));
  const fieldOptions = (purpose: 'field' | 'sort' = 'field'): ComboOption[] =>
    fieldsFor(agg.type, indexPattern, purpose).map((candidate) => ({
      value: candidate.name,
      label: candidate.name,
      prepend: <FieldToken type={candidate.type} />,
      group: candidate.type,
    }));

  const fieldRow = takesField(agg.type) && (
    <FormRow label="Field" full error={showProblems && !fieldName ? 'Select a field' : undefined}>
      <ComboBox
        single
        compact
        fullWidth
        options={fieldOptions()}
        selected={fieldName ? [fieldName] : []}
        placeholder="Select a field"
        invalid={showProblems && !fieldName}
        onChange={(selected) => {
          const next: Record<string, unknown> = { field: selected[0] };
          // What a top hit can be reduced to depends on what its field holds
          if (agg.type === 'top_hits') {
            const chosen = indexPattern?.fields.find((candidate) => candidate.name === selected[0]);
            if (chosen?.type !== 'number' && params.aggregate !== 'concat') next.aggregate = 'concat';
          }
          set(next);
        }}
        testId="visDefaultEditorField"
      />
    </FormRow>
  );

  const subAgg = (key: 'customMetric' | 'customBucket' | 'orderAgg', subTypes: readonly string[], label: string) => {
    const child = (params[key] as AggConfig | undefined) ?? { id: `${agg.id}-${key === 'customBucket' ? 'bucket' : key === 'orderAgg' ? 'orderAgg' : 'metric'}`, type: '', params: {} };
    return (
      <AggEditor
        agg={child}
        types={[...subTypes]}
        indexPattern={indexPattern}
        aggs={aggs}
        context={context}
        onChange={(next) => set({ [key]: next })}
        showProblems={showProblems}
        nested
        typeLabel={label}
      />
    );
  };

  let body: ReactNode = null;
  switch (agg.type) {
    case 'date_histogram': {
      const stored = params.interval === 'custom' ? String(params.customInterval ?? 'auto') : String(params.interval ?? 'auto');
      const known = INTERVALS.some((option) => option.value === stored);
      const scaled = fieldName ? dateInterval(agg, context) : undefined;
      body = (
        <>
          <FormRow
            label="Minimum interval"
            full
            help={
              scaled?.scaled
                ? `This interval creates too many buckets to show in the selected time range, so it has been scaled to ${scaled.description}.`
                : 'Select an option or create a custom value. Examples: 30s, 20m, 24h, 2d, 1w, 1M'
            }
          >
            <ComboBox
              single
              compact
              fullWidth
              allowCustom
              options={known ? INTERVALS : [...INTERVALS, { value: stored, label: stored }]}
              selected={[stored]}
              placeholder="Select an interval"
              onChange={(selected) => set({ interval: selected[0] ?? 'auto', customInterval: undefined })}
              testId="visEditorInterval"
            />
          </FormRow>
          <Switch checked={Boolean(params.drop_partials)} onChange={(drop) => set({ drop_partials: drop })} label="Drop partial buckets" testId="dropPartialBucketsCheckbox" />
        </>
      );
      break;
    }
    case 'histogram': {
      const auto = params.interval === 'auto' || params.interval === undefined;
      body = (
        <>
          <FormRow
            label="Minimum interval"
            full
            help={auto ? undefined : 'The interval is widened by itself when it would give more buckets than the advanced setting histogram:maxBars allows.'}
            error={showProblems && !auto && !(Number(params.interval) > 0) ? 'Enter an interval' : undefined}
          >
            <div className="atlRow">
              <NumberField
                className="atlGrow"
                compact
                min={0}
                step="any"
                disabled={auto}
                value={auto ? undefined : (Number(params.interval) as number)}
                placeholder={auto ? 'Auto interval is used' : 'Enter an interval'}
                onChange={(interval) => set({ interval: interval ?? '' })}
                testId="visEditorInterval"
              />
              <Switch checked={auto} onChange={(next) => set({ interval: next ? 'auto' : '' })} label="Use auto interval" />
            </div>
          </FormRow>
          {auto && (
            <FormRow label="Max bars" full help="Intervals are chosen from the data. There are never more bars than the advanced setting histogram:maxBars allows.">
              <NumberField compact min={1} value={typeof params.maxBars === 'number' ? params.maxBars : undefined} placeholder="Auto" onChange={(maxBars) => set({ maxBars })} />
            </FormRow>
          )}
          <Switch
            checked={Boolean(params.min_doc_count)}
            onChange={(show) => set({ min_doc_count: show })}
            label="Show empty buckets"
            testId="showEmptyBucketsCheckbox"
          />
          <Switch checked={Boolean(params.has_extended_bounds)} onChange={(extend) => set({ has_extended_bounds: extend })} label="Extend bounds" />
          {Boolean(params.has_extended_bounds) && (
            <div className="vzePair">
              <FormRow label="Min">
                <NumberField
                  compact
                  value={(params.extended_bounds as FromTo<number> & { min?: number | '' })?.min === '' ? undefined : ((params.extended_bounds as { min?: number })?.min ?? undefined)}
                  onChange={(min) => set({ extended_bounds: { ...(params.extended_bounds as object), min: min ?? '' } })}
                />
              </FormRow>
              <FormRow label="Max">
                <NumberField
                  compact
                  value={(params.extended_bounds as { max?: number | '' })?.max === '' ? undefined : ((params.extended_bounds as { max?: number })?.max ?? undefined)}
                  onChange={(max) => set({ extended_bounds: { ...(params.extended_bounds as object), max: max ?? '' } })}
                />
              </FormRow>
            </div>
          )}
        </>
      );
      break;
    }
    case 'range':
      body = (
        <RangeList<number>
          numeric
          ranges={(params.ranges as Array<FromTo<number>> | undefined) ?? []}
          empty={{}}
          onChange={(ranges) => set({ ranges })}
        />
      );
      break;
    case 'date_range':
      body = (
        <>
          <RangeList<string>
            fromLabel="From"
            toLabel="To"
            ranges={(params.ranges as Array<FromTo<string>> | undefined) ?? []}
            empty={{ from: '', to: '' }}
            onChange={(ranges) => set({ ranges })}
          />
          <p className="atlSubdued atlXs">Dates are written as date math: now, now-1w/w, 2026-01-31.</p>
        </>
      );
      break;
    case 'ip_range': {
      const kind = (params.ipRangeType as string | undefined) ?? 'fromTo';
      const ranges = (params.ranges ?? {}) as { fromTo?: Array<FromTo<string>>; mask?: Array<{ mask: string }> };
      body = (
        <>
          <FormRow label="IP ranges" full>
            <Segments
              options={[
                { id: 'fromTo', label: 'From/to' },
                { id: 'mask', label: 'CIDR masks' },
              ]}
              value={kind === 'mask' ? 'mask' : 'fromTo'}
              onChange={(ipRangeType) => set({ ipRangeType })}
            />
          </FormRow>
          {kind === 'mask' ? (
            <div className="vzeRanges">
              {(ranges.mask ?? []).map((item, index) => (
                <div className="vzeRanges__row" key={index}>
                  <TextField
                    className="atlGrow"
                    compact
                    value={item.mask}
                    aria-label="CIDR mask"
                    placeholder="0.0.0.0/1"
                    onChange={(mask) => set({ ranges: { ...ranges, mask: (ranges.mask ?? []).map((other, at) => (at === index ? { mask } : other)) } })}
                  />
                  <IconButton
                    icon="trash"
                    size="s"
                    label={`Remove the CIDR mask value of ${item.mask}`}
                    disabled={(ranges.mask ?? []).length === 1}
                    onClick={() => set({ ranges: { ...ranges, mask: (ranges.mask ?? []).filter((_, at) => at !== index) } })}
                  />
                </div>
              ))}
              <div>
                <Button variant="empty" size="s" icon="plusCircle" onClick={() => set({ ranges: { ...ranges, mask: [...(ranges.mask ?? []), { mask: '' }] } })}>
                  Add range
                </Button>
              </div>
            </div>
          ) : (
            <RangeList<string>
              fromLabel="From"
              toLabel="To"
              ranges={ranges.fromTo ?? []}
              empty={{ from: '', to: '' }}
              onChange={(fromTo) => set({ ranges: { ...ranges, fromTo } })}
            />
          )}
        </>
      );
      break;
    }
    case 'terms': {
      const metrics = aggs.filter(orderableMetric);
      const orderBy = String(params.orderBy ?? '_key');
      const orderOptions = [
        ...metrics.map((metric) => ({ value: metric.id, label: `Metric: ${aggLabel(metric, context)}` })),
        { value: 'custom', label: 'Custom metric' },
        { value: '_key', label: 'Alphabetical' },
      ];
      body = (
        <>
          <FormRow label="Order by" full>
            <Select
              compact
              value={orderOptions.some((option) => option.value === orderBy) ? orderBy : '_key'}
              options={orderOptions}
              onChange={(next) =>
                set({
                  orderBy: next,
                  orderAgg: next === 'custom' ? (params.orderAgg ?? { id: `${agg.id}-orderAgg`, enabled: true, type: 'count', schema: 'orderAgg', params: {} }) : undefined,
                })
              }
              testId="visEditorOrderBy"
            />
          </FormRow>
          {orderBy === 'custom' && <Section title="Custom metric">{subAgg('orderAgg', ORDER_METRICS, 'Aggregation')}</Section>}
          <div className="vzePair">
            <FormRow label="Order">
              <Select compact value={String(params.order ?? 'desc')} options={ORDERS} onChange={(order) => set({ order })} testId="visEditorOrder" />
            </FormRow>
            <FormRow label="Size" error={showProblems && !(Number(params.size) > 0) ? 'Must be greater than 0' : undefined}>
              <NumberField compact min={1} value={typeof params.size === 'number' ? params.size : undefined} onChange={(size) => set({ size: size ?? '' })} testId="sizeParamEditor" />
            </FormRow>
          </div>
          <Switch
            checked={Boolean(params.otherBucket)}
            onChange={(otherBucket) => set({ otherBucket })}
            label="Group other values in separate bucket"
            testId="otherBucketSwitch"
          />
          {Boolean(params.otherBucket) && (
            <FormRow label="Label for other bucket" full>
              <TextField compact value={String(params.otherBucketLabel ?? 'Other')} onChange={(otherBucketLabel) => set({ otherBucketLabel })} />
            </FormRow>
          )}
          <Switch
            checked={Boolean(params.missingBucket)}
            onChange={(missingBucket) => set({ missingBucket })}
            label="Show missing values"
            disabled={field !== undefined && field.type !== 'string'}
            testId="missingBucketSwitch"
          />
          {Boolean(params.missingBucket) && (
            <FormRow label="Label for missing values" full>
              <TextField compact value={String(params.missingBucketLabel ?? 'Missing')} onChange={(missingBucketLabel) => set({ missingBucketLabel })} />
            </FormRow>
          )}
        </>
      );
      break;
    }
    case 'significant_terms':
      body = (
        <FormRow label="Size" full error={showProblems && !(Number(params.size) > 0) ? 'Must be greater than 0' : undefined}>
          <NumberField compact min={1} value={typeof params.size === 'number' ? params.size : undefined} onChange={(size) => set({ size: size ?? '' })} />
        </FormRow>
      );
      break;
    case 'filters': {
      const filters = (params.filters as Array<{ input?: Query; label?: string }> | undefined) ?? [];
      const setFilters = (next: typeof filters) => set({ filters: next });
      body = (
        <div className="vzeRanges">
          {filters.map((filter, index) => (
            <div className="atlFormRow atlFormRow--full" key={index}>
              <div className="atlRowBetween">
                <span className="atlFormRow__label">Filter {index + 1}</span>
                <span className="atlRow">
                  <IconButton
                    icon="tag"
                    size="s"
                    label="Toggle filter label"
                    aria-pressed={Boolean(labelled[index] || filter.label)}
                    onClick={() => setLabelled({ ...labelled, [index]: !(labelled[index] || Boolean(filter.label)) })}
                  />
                  <IconButton
                    icon="trash"
                    size="s"
                    label="Remove this filter"
                    disabled={filters.length === 1}
                    onClick={() => setFilters(filters.filter((_, at) => at !== index))}
                  />
                </span>
              </div>
              <TextField
                compact
                value={typeof filter.input?.query === 'string' ? filter.input.query : ''}
                placeholder="A query: * matches every document"
                aria-label={`Filter ${index + 1}`}
                onChange={(query) =>
                  setFilters(
                    filters.map((other, at) => (at === index ? { ...other, input: { language: other.input?.language ?? defaultQueryLanguage(), query } } : other))
                  )
                }
                testId={`visEditorFilterInput_${agg.id}_${index}`}
              />
              {(labelled[index] || Boolean(filter.label)) && (
                <TextField
                  compact
                  value={filter.label ?? ''}
                  placeholder="Label"
                  aria-label={`Filter ${index + 1} label`}
                  onChange={(label) => setFilters(filters.map((other, at) => (at === index ? { ...other, label } : other)))}
                />
              )}
            </div>
          ))}
          <div>
            <Button
              variant="empty"
              size="s"
              icon="plusCircle"
              onClick={() => setFilters([...filters, { input: { query: '', language: defaultQueryLanguage() }, label: '' }])}
              testId="visEditorAddFilterButton"
            >
              Add filter
            </Button>
          </div>
        </div>
      );
      break;
    }
    case 'geohash_grid':
      body = <GeohashParams params={params} set={set} aggId={agg.id} />;
      break;
    case 'percentiles':
      body = <NumberList label="Percents" unit="percent" values={(params.percents as number[] | undefined) ?? []} onChange={(percents) => set({ percents })} />;
      break;
    case 'percentile_ranks':
      body = <NumberList label="Values" unit="value" values={(params.values as number[] | undefined) ?? []} onChange={(values) => set({ values })} />;
      break;
    case 'top_hits': {
      const numeric = field?.type === 'number';
      const sortField = typeof params.sortField === 'string' ? params.sortField : (params.sortField as { name?: string } | undefined)?.name;
      body = (
        <>
          <div className="vzePair">
            <FormRow label="Aggregate with" help="How several hits, or a field with several values, become one value.">
              <Select
                compact
                value={String(params.aggregate ?? 'concat')}
                options={[
                  ...(numeric
                    ? [
                        { value: 'min', label: 'Min' },
                        { value: 'max', label: 'Max' },
                        { value: 'sum', label: 'Sum' },
                        { value: 'average', label: 'Average' },
                      ]
                    : []),
                  { value: 'concat', label: 'Concatenate' },
                ]}
                onChange={(aggregate) => set({ aggregate })}
                testId="visDefaultEditorAggregateWith"
              />
            </FormRow>
            <FormRow label="Size">
              <NumberField compact min={1} value={typeof params.size === 'number' ? params.size : 1} onChange={(size) => set({ size: size ?? 1 })} />
            </FormRow>
          </div>
          <FormRow label="Sort on" full>
            <ComboBox
              single
              compact
              fullWidth
              options={fieldOptions('sort')}
              selected={sortField ? [sortField] : []}
              placeholder="Select a field"
              onChange={(selected) => set({ sortField: selected[0] })}
            />
          </FormRow>
          <FormRow label="Order" full>
            <Select compact value={String(params.sortOrder ?? 'desc')} options={ORDERS} onChange={(sortOrder) => set({ sortOrder })} />
          </FormRow>
        </>
      );
      break;
    }
    default:
      if (SIBLING_PIPELINES.includes(agg.type)) {
        body = (
          <>
            <Section title="Bucket">{subAgg('customBucket', SUB_BUCKETS, 'Aggregation')}</Section>
            <Section title="Metric">{subAgg('customMetric', SUB_METRICS, 'Aggregation')}</Section>
          </>
        );
      } else if (PARENT_PIPELINES.includes(agg.type)) {
        const others = aggs.filter((other) => other.id !== agg.id && orderableMetric(other));
        const target = String(params.metricAgg ?? 'custom');
        body = (
          <>
            <FormRow label="Metric" full>
              <Select
                compact
                value={target === 'custom' || others.some((other) => other.id === target) ? target : 'custom'}
                options={[{ value: 'custom', label: 'Custom metric' }, ...others.map((other) => ({ value: other.id, label: `Metric: ${aggLabel(other, context)}` }))]}
                onChange={(metricAgg) =>
                  set({
                    metricAgg,
                    customMetric: metricAgg === 'custom' ? (params.customMetric ?? { id: `${agg.id}-metric`, enabled: true, type: 'count', params: {} }) : undefined,
                  })
                }
              />
            </FormRow>
            {target === 'custom' && <Section title="Custom metric">{subAgg('customMetric', SUB_METRICS, 'Aggregation')}</Section>}
          </>
        );
      }
  }

  return (
    <div className="vzeFields">
      <FormRow label={typeLabel} full error={showProblems && !agg.type ? 'Select an aggregation' : undefined}>
        <ComboBox
          single
          compact
          fullWidth
          options={typeOptions}
          selected={agg.type ? [agg.type] : []}
          placeholder="Select an aggregation"
          invalid={showProblems && !agg.type}
          onChange={(selected) => {
            if (selected[0] && selected[0] !== agg.type) onChange(changeAggType(agg, selected[0], indexPattern, aggs, defaultQueryLanguage()));
          }}
          testId="defaultEditorAggSelect"
        />
      </FormRow>
      {fieldRow}
      {body}
      {!nested && agg.type && (
        <>
          <FormRow label="Custom label" full>
            <TextField
              compact
              value={typeof params.customLabel === 'string' ? params.customLabel : ''}
              onChange={(customLabel) => set({ customLabel })}
              testId="visEditorStringInput"
            />
          </FormRow>
          <Accordion title="Advanced" initiallyOpen={Boolean(params.json || params.include || params.exclude)}>
            <div className="vzeFields">
              {agg.type === 'terms' && field?.type === 'string' && (
                <>
                  <FormRow label="Exclude" full>
                    <TextField compact value={String(params.exclude ?? '')} onChange={(exclude) => set({ exclude })} />
                  </FormRow>
                  <FormRow label="Include" full>
                    <TextField compact value={String(params.include ?? '')} onChange={(include) => set({ include })} />
                  </FormRow>
                </>
              )}
              <FormRow
                label="JSON input"
                full
                help="Properties written here are merged into what this aggregation asks of OpenSearch."
                error={jsonProblem(params.json)}
              >
                <TextArea code rows={2} value={typeof params.json === 'string' ? params.json : ''} onChange={(json) => set({ json })} testId="codeEditorContainer" />
              </FormRow>
            </div>
          </Accordion>
        </>
      )}
    </div>
  );
}

function jsonProblem(json: unknown): string | undefined {
  if (typeof json !== 'string' || json.trim() === '') return undefined;
  try {
    const parsed: unknown = JSON.parse(json);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? undefined : 'Write an object: { "name": value }';
  } catch {
    return 'This is not valid JSON';
  }
}

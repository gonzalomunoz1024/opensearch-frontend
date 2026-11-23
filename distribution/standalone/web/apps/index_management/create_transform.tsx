/* SPDX-License-Identifier: Apache-2.0 */

/*
 * The form that creates a transform job, in four steps: the indexes, what the fields of the
 * source are grouped and aggregated by (with a look at the result on sample data), the
 * schedule, and a look at it all before it is sent.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Accordion, Button, CallOut, IconButton, Panel } from '../../components/basic';
import { ComboBox } from '../../components/combo_box';
import { Checkbox, NumberField, RadioGroup, Select, TextField } from '../../components/form';
import { Icon } from '../../components/icon';
import { Popover } from '../../components/overlay';
import { useBreadcrumbs } from '../../shell/state';
import { Detail, Details, ExternalLink, JsonEditor, go, ism, toasts } from './common';
import { ConfigureJob, FieldRow, FormPanel, Wizard, nameOptions, useIndexNames } from './job_parts';
import {
  CALENDAR_TIMEUNITS,
  FIXED_TIMEUNITS,
  INTERVAL_REQUIRED,
  commonFields,
  intervalScheduleText,
  type FieldItem,
} from './rollup_model';
import { CRUMBS, ROUTES } from './routes';
import { GridHeading, SampleGrid } from './sample_grid';
import {
  OPTION_NAMES,
  dateHistogramItem,
  emptyTransformDraft,
  histogramItem,
  isGroupBy,
  isValidPercent,
  metricItem,
  optionsOf,
  percentilesItem,
  previewCell,
  previewColumns,
  removeItem,
  renameError,
  renameItem,
  reviewItems,
  sampleCell,
  scriptedMetricItem,
  termsItem,
  transformBody,
  withAggregations,
  withContinuous,
  withDescription,
  withEnabled,
  withFilter,
  withGroups,
  withPageSize,
  withSourceIndex,
  withTargetIndex,
  withoutDefinitions,
  type AggItem,
  type DefinitionItem,
  type OptionId,
  type TransformDraft,
} from './transform_model';

const FILTER_DOCS = 'https://opensearch.org/docs/opensearch/query-dsl/index/';
const STEPS = ['Set up indices', 'Define transforms', 'Specify schedule', 'Review and create'];
// What each step is called over its fields is not quite what the list of steps calls it
const HEADINGS = ['Set up indices', 'Define transform', 'Specify Schedule', 'Review and Create'];
const SAMPLE_SIZE = 50;

/** The units a schedule counts in. A job read back spells them this way; a new one starts as "MINUTES". */
const SCHEDULE_UNITS = [
  { value: 'Minutes', label: 'Minute(s)' },
  { value: 'Hours', label: 'Hour(s)' },
  { value: 'Days', label: 'Day(s)' },
];

type Documents = Array<Record<string, unknown>>;

/** Asks what a job would write for a sample of its source; says so when it cannot be told */
export async function previewTransform(body: unknown): Promise<Documents | undefined> {
  const answer = await ism.post<{ documents: Documents }>('transforms/_preview', body);
  if (answer.ok && answer.response) return answer.response.documents;
  toasts.danger(`Could not preview transform: ${answer.error}`);
  return undefined;
}

// --- Step 1 ----------------------------------------------------------------------------------------

/** The name of a job and what it is for; the name of a job that exists cannot be changed */
export function ConfigureTransform({
  transformId,
  error,
  description,
  isEdit,
  onChangeName,
  onChangeDescription,
}: {
  transformId: string;
  error?: string;
  description: string;
  isEdit?: boolean;
  onChangeName?: (name: string) => void;
  onChangeDescription: (description: string) => void;
}) {
  return (
    <ConfigureJob
      jobId={transformId}
      jobIdError={error}
      placeholder={isEdit ? 'transform-id' : 'my-transformjob1'}
      description={description}
      isEdit={isEdit}
      onChangeName={onChangeName}
      onChangeDescription={onChangeDescription}
      transform
    />
  );
}

/** The query that chooses the documents of the source, written as JSON */
function FilterEditor({ filter, onSave, onClose }: { filter: string; onSave: (filter: string) => void; onClose: () => void }) {
  const [text, setText] = useState(filter);
  return (
    <div className="ismFilterEditor">
      <div className="ismFilterEditor__title">Edit data filter</div>
      <div className="ismFilterEditor__body">
        <div className="ismRow__label">Custom query DSL</div>
        <JsonEditor value={text} onChange={setText} height="40vh" />
        <div className="ismButtons">
          <Button variant="empty" size="s" onClick={onClose} testId="cancelSaveFilter">
            Cancel
          </Button>
          <Button
            variant="primary"
            size="s"
            onClick={() => {
              onSave(text);
              onClose();
            }}
            testId="saveFilter"
          >
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}

function TransformIndices({
  sourceIndex,
  sourceIndexError,
  filter,
  filterError,
  targetIndex,
  targetIndexError,
  hasDefinitions,
  onChangeSource,
  onChangeFilter,
  onChangeTarget,
}: {
  sourceIndex: string;
  sourceIndexError?: string;
  filter: string;
  filterError?: string;
  targetIndex: string;
  targetIndexError?: string;
  hasDefinitions: boolean;
  onChangeSource: (index: string) => void;
  onChangeFilter: (filter: string) => void;
  onChangeTarget: (index: string) => void;
}) {
  const { sources, targets, loading, onSearch } = useIndexNames();
  const [editing, setEditing] = useState(false);
  return (
    <FormPanel title="Indices">
      {hasDefinitions && (
        <CallOut tone="warning">
          Note: changing source index will erase all existing definitions about aggregations and metrics.
        </CallOut>
      )}
      <FieldRow
        title="Source index"
        error={sourceIndexError}
        help="The index where this transform job is performed on. Type in * as wildcard for index pattern. Indices cannot be changed once the job is created. Please ensure that you select the right source index."
      >
        <ComboBox
          compact
          single
          searched
          placeholder="Select source index"
          options={nameOptions(sources)}
          selected={sourceIndex ? [sourceIndex] : []}
          onChange={(chosen) => onChangeSource(chosen[0] ?? '')}
          onSearch={onSearch}
          loading={loading}
          invalid={Boolean(sourceIndexError)}
          testId="sourceIndexCombobox"
        />
      </FieldRow>
      <div className="ismRow">
        <h3 className="ismRow__title">
          Source index filter<i> – optional</i>
        </h3>
        <div className="ismLabeled__help">
          You can use the custom DSL to filter a subset of the source index to use in the transform job, which
          optimizes the job for performance and computing resources. You cannot change these filters once the job is
          created.
        </div>
        <div className="ismLabeled__help">
          <ExternalLink href={FILTER_DOCS} />
        </div>
        <div className="ismFilterRow">
          <span className="ismFilterBadge">
            <button
              type="button"
              className="ismFilterBadge__text"
              onClick={() => setEditing(!editing)}
              aria-label="Edit Source Index Filter"
            >
              {filter}
            </button>
            <button
              type="button"
              className="ismFilterBadge__clear"
              onClick={() => onChangeFilter('')}
              aria-label="Clear Source Index Filter"
            >
              <Icon name="cross" size="s" />
            </button>
          </span>
          <Popover
            open={editing}
            onClose={() => setEditing(false)}
            className="ismFilterPopover"
            button={
              <button type="button" className="atlLinkButton" onClick={() => setEditing(!editing)} data-test-subj="addFilter">
                Edit data filter
              </button>
            }
          >
            <FilterEditor filter={filter} onSave={onChangeFilter} onClose={() => setEditing(false)} />
          </Popover>
        </div>
        {filterError && <div className="ismLabeled__error">{filterError}</div>}
      </div>
      <hr className="ismRule" />
      <FieldRow
        title="Target index"
        error={targetIndexError}
        help="The index stores transform results. You can look up an existing index to reuse or type to create a new index."
      >
        <ComboBox
          compact
          single
          searched
          allowCustom
          placeholder="Select or create target index"
          options={nameOptions(targets)}
          selected={targetIndex ? [targetIndex] : []}
          onChange={(chosen) => onChangeTarget(chosen[0] ?? '')}
          onSearch={onSearch}
          loading={loading}
          invalid={Boolean(targetIndexError)}
          testId="targetIndexCombobox"
        />
      </FieldRow>
    </FormPanel>
  );
}

// --- Step 2 ----------------------------------------------------------------------------------------

/** The two buttons that close a panel of a menu: one drops what was typed, one takes it */
function PanelButtons({
  onCancel,
  onOk,
  disabled,
  testIds,
}: {
  onCancel: () => void;
  onOk: () => void;
  disabled?: boolean;
  testIds?: [string, string];
}) {
  return (
    <div className="ismButtons">
      <Button size="s" onClick={onCancel} testId={testIds?.[0]}>
        Cancel
      </Button>
      <Button variant="primary" size="s" disabled={disabled} onClick={onOk} testId={testIds?.[1]}>
        OK
      </Button>
    </div>
  );
}

/** The percents of a percentile aggregation, typed one after the other */
function PercentsField({
  percents,
  onChange,
  onInvalid,
  invalid,
}: {
  percents: string[];
  onChange: (percents: string[]) => void;
  onInvalid: (invalid: boolean) => void;
  invalid: boolean;
}) {
  const [text, setText] = useState('');
  return (
    <div className={`ismPills${invalid ? ' ismPills--invalid' : ''}`} data-test-subj="comboBoxInput">
      {percents.map((percent, at) => (
        <span key={`${percent}-${at}`} className="ismPills__pill">
          {percent}
          <button
            type="button"
            onClick={() => onChange(percents.filter((_item, index) => index !== at))}
            aria-label={`Remove ${percent}`}
          >
            <Icon name="cross" size="s" />
          </button>
        </span>
      ))}
      <input
        value={text}
        aria-label="Percents"
        data-test-subj="comboBoxSearchInput"
        onChange={(event) => {
          const typed = event.target.value;
          setText(typed);
          onInvalid(typed !== '' && !isValidPercent(typed));
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            const typed = text.trim();
            if (typed === '' || !isValidPercent(typed)) return;
            onChange([...percents, typed]);
            setText('');
          } else if (event.key === 'Backspace' && text === '' && percents.length > 0) {
            onChange(percents.slice(0, -1));
          }
        }}
      />
    </div>
  );
}

type MenuPanel = 'root' | 'histogram' | 'percentile' | 'scripted' | 'dateTypes' | 'fixed' | 'calendar';

/** The panel of the menu that asks how wide the ranges of a number are */
function HistogramPanel({ field, onAdd, onClose }: { field: string; onAdd: (item: AggItem) => void; onClose: () => void }) {
  const [interval, setInterval] = useState<number | undefined>(5);
  return (
    <div className="ismMenuPanel">
      <FieldRow title="Histogram interval" small>
        <NumberField compact value={interval} onChange={setInterval} style={{ width: 109 }} aria-label="Histogram interval" />
      </FieldRow>
      <PanelButtons onCancel={onClose} onOk={() => onAdd(histogramItem(field, interval))} />
    </div>
  );
}

function PercentilePanel({ field, onAdd, onClose }: { field: string; onAdd: (item: AggItem) => void; onClose: () => void }) {
  const [percents, setPercents] = useState<string[]>([]);
  const [invalid, setInvalid] = useState(false);
  return (
    <div className="ismMenuPanel">
      <FieldRow
        title="Percents"
        small
        error={invalid ? 'Invalid input' : undefined}
        help="Only numbers between 0-100 allowed."
      >
        <PercentsField
          percents={percents}
          invalid={invalid}
          onInvalid={setInvalid}
          onChange={(next) => {
            setPercents(next);
            setInvalid(false);
          }}
        />
      </FieldRow>
      <PanelButtons onCancel={onClose} onOk={() => onAdd(percentilesItem(field, percents))} />
    </div>
  );
}

function ScriptedMetricsPanel({ field, onAdd, onClose }: { field: string; onAdd: (item: AggItem) => void; onClose: () => void }) {
  const [script, setScript] = useState('');
  return (
    <div className="ismMenuPanel ismMenuPanel--editor">
      <div className="ismRow__label">Scripted metrics</div>
      <JsonEditor value={script} onChange={setScript} height="40vh" />
      <PanelButtons
        onCancel={onClose}
        onOk={() => {
          let item: AggItem;
          try {
            item = scriptedMetricItem(field, script);
          } catch {
            // What is not JSON yet stays in the editor
            return;
          }
          onAdd(item);
        }}
      />
    </div>
  );
}

function DateHistogramPanel({
  field,
  intervalType,
  onAdd,
  onClose,
}: {
  field: string;
  intervalType: 'fixed' | 'calendar';
  onAdd: (item: AggItem) => void;
  onClose: () => void;
}) {
  const [interval, setInterval] = useState<number | undefined>(1);
  const [unit, setUnit] = useState('m');
  return (
    <div className="ismMenuPanel ismMenuPanel--date">
      <div className="ismDateInterval">
        <h4>Interval</h4>
        <h4>Timeunit</h4>
        {intervalType === 'fixed' ? (
          <NumberField compact value={interval} onChange={setInterval} testId="dateHistogramValueInput" aria-label="Interval" />
        ) : (
          <span>Every 1</span>
        )}
        <Select
          compact
          options={intervalType === 'fixed' ? FIXED_TIMEUNITS : CALENDAR_TIMEUNITS}
          value={unit}
          onChange={setUnit}
          data-test-subj="dateHistogramTimeunitSelect"
          aria-label="Timeunit"
        />
      </div>
      <PanelButtons
        onCancel={onClose}
        onOk={() => onAdd(dateHistogramItem(field, interval, unit, intervalType))}
        testIds={['dateHistogramPanelCancelButton', 'dateHistogramPanelOKButton']}
      />
    </div>
  );
}

/** One line of a menu; one that leads to another panel says so with an arrow */
function MenuLine({ onClick, leads, children }: { onClick?: () => void; leads?: boolean; children: ReactNode }) {
  return (
    <button type="button" role="menuitem" className="atlMenu__item" onClick={onClick}>
      <span className="atlGrow">{children}</span>
      {leads && <Icon name="chevronRight" />}
    </button>
  );
}

function BackLine({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="ismMenuBack" onClick={onClick} data-test-subj="contextMenuPanelTitleButton">
      <Icon name="chevronLeft" />
      Back
    </button>
  );
}

/** The name of a field of the source and the menu of what the field can be grouped or aggregated by */
function TransformOptions({ field, onAdd }: { field: FieldItem; onAdd: (item: AggItem) => void }) {
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<MenuPanel>('root');
  const name = field.label;
  const close = () => setOpen(false);
  const add = (item: AggItem) => {
    onAdd(item);
    close();
  };
  const choose = (option: OptionId) => {
    if (option === 'histogram') setPanel('histogram');
    else if (option === 'date_histogram') setPanel('dateTypes');
    else if (option === 'percentile') setPanel('percentile');
    else if (option === 'scripted') setPanel('scripted');
    else if (option === 'terms') add(termsItem(name));
    else add(metricItem(option === 'count' ? 'value_count' : option, name));
  };
  const options = optionsOf(field.type);
  const leads = (option: OptionId) =>
    option === 'histogram' || option === 'date_histogram' || option === 'percentile' || option === 'scripted';

  return (
    <GridHeading name={name}>
      <Popover
        open={open}
        onClose={close}
        align="right"
        className="ismOptionsPopover"
        button={
          <button
            type="button"
            className="ismGridAdd"
            onClick={() => {
              setPanel('root');
              setOpen(!open);
            }}
            aria-label={`Transform options of ${name}`}
            data-test-subj={`${name}OptionsPopover`}
          >
            <Icon name="plusInCircleFilled" />
          </button>
        }
      >
        <div className="atlMenu ismOptionsMenu" role="menu">
          {panel === 'root' && (
            <>
              <div className="ismMenuTitle">Transform options</div>
              {field.type === 'text' ? (
                <MenuLine>No options available for text fields</MenuLine>
              ) : (
                options.map((option) => (
                  <MenuLine key={option} leads={leads(option)} onClick={() => choose(option)}>
                    {OPTION_NAMES[option]}
                  </MenuLine>
                ))
              )}
            </>
          )}
          {panel === 'dateTypes' && (
            <>
              <BackLine onClick={() => setPanel('root')} />
              <MenuLine leads onClick={() => setPanel('fixed')}>
                Fixed interval
              </MenuLine>
              <MenuLine leads onClick={() => setPanel('calendar')}>
                Calendar interval
              </MenuLine>
            </>
          )}
          {panel === 'histogram' && (
            <>
              <BackLine onClick={() => setPanel('root')} />
              <HistogramPanel field={name} onAdd={add} onClose={close} />
            </>
          )}
          {panel === 'percentile' && (
            <>
              <BackLine onClick={() => setPanel('root')} />
              <PercentilePanel field={name} onAdd={add} onClose={close} />
            </>
          )}
          {panel === 'scripted' && (
            <>
              <BackLine onClick={() => setPanel('root')} />
              <ScriptedMetricsPanel field={name} onAdd={add} onClose={close} />
            </>
          )}
          {(panel === 'fixed' || panel === 'calendar') && (
            <>
              <BackLine onClick={() => setPanel('dateTypes')} />
              <DateHistogramPanel field={name} intervalType={panel} onAdd={add} onClose={close} />
            </>
          )}
        </div>
      </Popover>
    </GridHeading>
  );
}

/** The name of a column of the result and the menu that renames or removes it */
function PreviewOptions({
  name,
  aggList,
  onEdit,
  onRemove,
}: {
  name: string;
  aggList: AggItem[];
  onEdit: (oldName: string, newName: string) => void;
  onRemove: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(name);
  const error = renameError(aggList, name, newName);
  const close = () => setOpen(false);
  return (
    <GridHeading name={name}>
      <Popover
        open={open}
        onClose={close}
        align="right"
        className="ismOptionsPopover"
        button={
          <IconButton
            icon="pencil"
            label={`Change ${name}`}
            size="s"
            onClick={() => {
              setRenaming(false);
              setNewName(name);
              setOpen(!open);
            }}
          />
        }
      >
        <div className="atlMenu ismOptionsMenu" role="menu">
          {renaming ? (
            <>
              <BackLine onClick={() => setRenaming(false)} />
              <div className="ismMenuPanel">
                <FieldRow title="Transformation name" small error={error || undefined}>
                  <TextField
                    compact
                    value={newName}
                    onChange={setNewName}
                    invalid={error !== ''}
                    aria-label="Transformation name"
                  />
                </FieldRow>
                <PanelButtons
                  onCancel={close}
                  disabled={error !== ''}
                  onOk={() => {
                    if (name !== newName) onEdit(name, newName);
                    close();
                  }}
                />
              </div>
            </>
          ) : (
            <>
              <MenuLine leads onClick={() => setRenaming(true)}>
                Edit transformation
              </MenuLine>
              <MenuLine onClick={() => onRemove(name)}>Remove transformation</MenuLine>
            </>
          )}
        </div>
      </Popover>
    </GridHeading>
  );
}

/** What the job would write for a sample of its source, or that there is nothing to show yet */
export function PreviewTransform({
  documents,
  aggList,
  isReadOnly,
  onEdit,
  onRemove,
}: {
  documents: Documents;
  aggList: AggItem[];
  isReadOnly?: boolean;
  onEdit?: (oldName: string, newName: string) => void;
  onRemove?: (name: string) => void;
}) {
  const ids = previewColumns(aggList, documents, Boolean(isReadOnly));
  if (ids.length === 0) {
    return (
      <Panel>
        <div className="ismPreviewEmpty">
          {isReadOnly ? (
            <h4>No preview available</h4>
          ) : (
            <>
              <h4>No fields selected</h4>
              <p>
                From the table above, select a field you want to transform by clicking{' '}
                <span className="ismGridAdd ismGridAdd--inline">
                  <Icon name="plusInCircleFilled" />
                </span>{' '}
                next to the field name.
              </p>
            </>
          )}
        </div>
      </Panel>
    );
  }
  return (
    <SampleGrid
      label="Preview transforms"
      columns={ids.map((id, at) => ({
        id,
        header: isReadOnly ? (
          <GridHeading name={id} />
        ) : (
          <PreviewOptions
            key={`${id}-${at}`}
            name={id}
            aggList={aggList}
            onEdit={(oldName, newName) => onEdit?.(oldName, newName)}
            onRemove={(name) => onRemove?.(name)}
          />
        ),
      }))}
      rowCount={documents.length}
      cell={(row, columnId) => previewCell(documents[row] ?? {}, columnId)}
      highlight={!isReadOnly}
    />
  );
}

interface Sample {
  data: Array<{ _source?: Record<string, unknown> }>;
  total: number;
}

/** The fields of the source with a sample of what they hold, and under them what the job would write */
function DefineTransforms({
  sourceIndex,
  filter,
  fields,
  aggList,
  documents,
  isReadOnly,
  onAdd,
  onEdit,
  onRemove,
}: {
  sourceIndex: string;
  filter: string;
  fields: FieldItem[];
  aggList: AggItem[];
  documents: Documents;
  isReadOnly?: boolean;
  onAdd?: (item: AggItem) => void;
  onEdit?: (oldName: string, newName: string) => void;
  onRemove?: (name: string) => void;
}) {
  const [sample, setSample] = useState<Sample>({ data: [], total: 0 });
  useEffect(() => {
    let current = true;
    void ism
      .post<{ data: Sample['data']; total: { value: number } }>(
        `_searchSampleData/${encodeURIComponent(sourceIndex)}`,
        filter,
        { from: 0, size: SAMPLE_SIZE }
      )
      .then((answer) => {
        if (current && answer.ok && answer.response) {
          setSample({ data: answer.response.data ?? [], total: answer.response.total?.value ?? 0 });
        }
      });
    return () => {
      current = false;
    };
    // The plugin asks once, as the step opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceIndex]);

  const grid = (
    <SampleGrid
      label="Define transforms"
      columns={fields.map((field) => ({
        id: field.label,
        header: isReadOnly ? (
          <GridHeading name={field.label} />
        ) : (
          <TransformOptions field={field} onAdd={(item) => onAdd?.(item)} />
        ),
      }))}
      initiallyShown={5}
      rowCount={Math.min(sample.total, SAMPLE_SIZE)}
      cell={(row, columnId) => {
        const source = sample.data[row]?._source;
        return source ? sampleCell(fields, source, columnId) : '-';
      }}
      paged
    />
  );
  const preview = (
    <PreviewTransform documents={documents} aggList={aggList} isReadOnly={isReadOnly} onEdit={onEdit} onRemove={onRemove} />
  );

  if (isReadOnly) {
    return (
      <div className="ismDefine">
        <h3 className="ismRow__title">Original fields with sample data</h3>
        {grid}
        <h3 className="ismRow__title">Transformed fields preview based on sample data</h3>
        {preview}
      </div>
    );
  }
  return (
    <FormPanel title="Select fields to transform">
      <div className="ismDefine">
        <div>
          <h3 className="ismRow__title">Original fields with sample data</h3>
          <div className="ismLabeled__help">Viewing sample data from index {sourceIndex}</div>
        </div>
        {grid}
        <div>
          <h3 className="ismRow__title">Transformed fields preview based on sample data</h3>
          <div className="ismLabeled__help">
            This fields preview displays only the first 10 results of your transform job.
          </div>
        </div>
        {preview}
      </div>
    </FormPanel>
  );
}

// --- Step 3 ----------------------------------------------------------------------------------------

export interface TransformScheduleValues {
  enabled: boolean;
  continuous?: boolean;
  interval: number | undefined;
  intervalTimeunit: string;
  pageSize: number | undefined;
}

const PAGES_HELP =
  'Determines the number of transformed buckets that are computed and indexed at a time. A larger number means better throughput for each search request, but costs more memory and incurs higher latency. An exception occurs when memory limits are exceeded. We recommend you to start with the default value, and adjust based on your use case and shard size.';
const PAGES_HELP_EDIT =
  'Determines the number of transformed buckets that are computed and indexed at a time. A larger number means faster execution, but costs more memory. An exception occurs when memory limits are exceeded. We recommend you to start with default value and adjust based on your use case.';

/** When a job runs and how much it does each time. A job that exists keeps its kind. */
export function TransformSchedule({
  values,
  intervalError,
  isEdit,
  change,
  onChangeInterval,
}: {
  values: TransformScheduleValues;
  intervalError?: string;
  isEdit?: boolean;
  change: (changes: Partial<TransformScheduleValues>) => void;
  onChangeInterval: (interval: number | undefined) => void;
}) {
  return (
    <FormPanel title="Schedule">
      <Checkbox
        checked={values.enabled}
        onChange={(enabled) => change({ enabled })}
        label="Job enabled by default"
        testId={isEdit ? 'jobEnabled' : 'jobEnabledByDefault'}
      />
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
      <FieldRow title="Transform execution interval" small error={intervalError}>
        <div className="ismPaired">
          <NumberField
            compact
            value={values.interval}
            onChange={onChangeInterval}
            invalid={Boolean(intervalError)}
            aria-label="Transform execution interval"
          />
          <Select
            compact
            id="selectIntervalTimeunit"
            className={values.interval === undefined || values.interval <= 0 ? 'atlField--invalid' : undefined}
            options={SCHEDULE_UNITS}
            value={values.intervalTimeunit}
            onChange={(intervalTimeunit) => change({ intervalTimeunit })}
            aria-label="Transform execution interval unit"
          />
        </div>
      </FieldRow>
      <hr className="ismRule" />
      <Accordion title="Advanced" initiallyOpen={false}>
        <div className="ismAccordionBody">
          <FieldRow title="Pages per execution" small help={isEdit ? PAGES_HELP_EDIT : PAGES_HELP}>
            <NumberField
              compact
              min={1}
              placeholder="1000"
              value={values.pageSize}
              onChange={(pageSize) => change({ pageSize })}
              aria-label="Pages per execution"
            />
          </FieldRow>
        </div>
      </Accordion>
    </FormPanel>
  );
}

// --- Step 4 ----------------------------------------------------------------------------------------

/** What a job groups and aggregates by, each as a name over the field it works on */
export function Definitions({ items }: { items: DefinitionItem[] }) {
  return (
    <div className="ismSmallDetails">
      <Details columns={4}>
        {items.map((item, at) => (
          <Detail key={at} name={item.title}>
            {item.field}
          </Detail>
        ))}
      </Details>
    </div>
  );
}

// --- The form --------------------------------------------------------------------------------------

interface Errors {
  transformId?: string;
  sourceIndex?: string;
  targetIndex?: string;
  filter?: string;
  interval?: string;
}

export function CreateTransform() {
  useBreadcrumbs([CRUMBS.INDEX_MANAGEMENT, CRUMBS.TRANSFORMS, CRUMBS.CREATE_TRANSFORM]);
  const [step, setStep] = useState(1);
  const [transformId, setTransformId] = useState('');
  const [description, setDescription] = useState('');
  const [sourceIndex, setSourceIndex] = useState('');
  const [targetIndex, setTargetIndex] = useState('');
  const [filter, setFilter] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [fields, setFields] = useState<FieldItem[]>([]);
  const [draft, setDraft] = useState<TransformDraft>(emptyTransformDraft);
  const [aggList, setAggList] = useState<AggItem[]>([]);
  const [documents, setDocuments] = useState<Documents>([]);
  const [schedule, setSchedule] = useState<TransformScheduleValues>({
    enabled: true,
    continuous: false,
    interval: 1,
    intervalTimeunit: 'MINUTES',
    pageSize: 1000,
  });
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const judge = (changes: Errors) => setErrors((before) => ({ ...before, ...changes }));

  // What a request that comes back late finds: the job as it stands then, not as it stood when it left
  const latest = useRef({ draft, aggList });
  latest.current = { draft, aggList };
  const define = (list: AggItem[], body: TransformDraft) => {
    latest.current = { draft: body, aggList: list };
    setAggList(list);
    setDraft(body);
  };
  const change = (alter: (before: TransformDraft) => TransformDraft) => {
    const body = alter(latest.current.draft);
    latest.current = { ...latest.current, draft: body };
    setDraft(body);
  };

  const loadFields = async (index: string) => {
    if (!index) return;
    const answer = await ism.post<Parameters<typeof commonFields>[0]>('_mappings', { index });
    if (answer.ok && answer.response) setFields(commonFields(answer.response));
    else toasts.danger(`Could not load fields: ${answer.error}`);
  };

  const preview = async (body: TransformDraft): Promise<boolean> => {
    const found = await previewTransform(body);
    if (found) setDocuments(found);
    return found !== undefined;
  };

  /** The list as it is now, in the job and in the look at its result. With no group left there is nothing to look at. */
  const settle = async (list: AggItem[]) => {
    const body = withAggregations(withGroups(latest.current.draft, list), list);
    define(list, body);
    if (list.some((item) => isGroupBy(item.type))) await preview(body);
    else setDocuments([]);
  };

  /** A new column of the result. One that OpenSearch cannot compute is taken away again. */
  const add = async (item: AggItem) => {
    const list = [...latest.current.aggList, item];
    const body = isGroupBy(item.type)
      ? withGroups(latest.current.draft, list)
      : withAggregations(latest.current.draft, list);
    define(list, body);
    if (!(await preview(body))) await settle(removeItem(latest.current.aggList, item.name));
  };

  const next = async () => {
    if (step !== 1) {
      setStep(Math.min(step + 1, 4));
      return;
    }
    const found: Errors = {};
    if (!transformId) {
      found.transformId = 'Job name is required.';
    } else {
      const answer = await ism.get<{ _id: string }>(`transforms/${encodeURIComponent(transformId)}`);
      if (answer.ok && answer.response?._id === transformId) {
        found.transformId = `There is already a job named "${transformId}". Please provide a different name.`;
      }
    }
    if (!sourceIndex) found.sourceIndex = 'Source index is required.';
    if (!targetIndex) found.targetIndex = 'Target index is required.';
    judge(found);
    if (Object.keys(found).length > 0 || errors.filter) return;

    // The source and its filter must answer a search before anything is defined on them
    setSearching(true);
    const answer = await ism.post(`_searchSampleData/${encodeURIComponent(sourceIndex)}`, filter, {
      from: 0,
      size: SAMPLE_SIZE,
    });
    setSearching(false);
    if (!answer.ok) {
      const message = answer.error || 'There was a problem searching data from source index.';
      judge({ filter: message });
      toasts.danger(message);
      return;
    }
    setStep(2);
  };

  const submit = async () => {
    setSubmitting(true);
    const body = transformBody(
      latest.current.draft,
      latest.current.aggList,
      schedule.interval,
      schedule.intervalTimeunit,
      Math.floor(Date.now() / 1000)
    );
    change(() => body);
    const answer = await ism.put<{ _id: string }>(`transforms/${encodeURIComponent(transformId)}`, body);
    setSubmitting(false);
    if (answer.ok && answer.response) {
      toasts.success(`Transform job "${answer.response._id}" successfully created.`);
      go(ROUTES.TRANSFORMS);
    } else {
      toasts.danger(`Failed to create transform: ${answer.error}`);
    }
  };

  const edit = (to: number) => (
    <Button size="s" onClick={() => setStep(to)}>
      Edit
    </Button>
  );

  return (
    <Wizard
      titles={STEPS}
      headings={HEADINGS}
      step={step}
      buttons={
        <>
          <Button variant="empty" size="s" onClick={() => go(ROUTES.TRANSFORMS)} testId="createTransformCancelButton">
            Cancel
          </Button>
          {step !== 1 && (
            <Button size="s" onClick={() => setStep(step - 1)} testId="createTransformPreviousButton">
              Previous
            </Button>
          )}
          {step === 4 ? (
            <Button
              variant="primary"
              size="s"
              loading={submitting}
              onClick={() => void submit()}
              testId="createTransformSubmitButton"
            >
              Create
            </Button>
          ) : (
            <Button
              variant="primary"
              size="s"
              loading={searching}
              onClick={() => void next()}
              testId="createTransformNextButton"
            >
              Next
            </Button>
          )}
        </>
      }
    >
      {step === 1 && (
        <>
          <ConfigureTransform
            transformId={transformId}
            error={errors.transformId}
            description={description}
            onChangeName={(name) => {
              setTransformId(name);
              judge({ transformId: name ? undefined : 'Name is required' });
            }}
            onChangeDescription={(text) => {
              setDescription(text);
              change((before) => withDescription(before, text));
            }}
          />
          <TransformIndices
            sourceIndex={sourceIndex}
            sourceIndexError={errors.sourceIndex}
            filter={filter}
            filterError={errors.filter}
            targetIndex={targetIndex}
            targetIndexError={errors.targetIndex}
            hasDefinitions={aggList.length > 0}
            onChangeSource={(index) => {
              setSourceIndex(index);
              judge({ sourceIndex: index ? undefined : 'Source index is required' });
              // What was defined on the fields of another index means nothing here
              define([], withoutDefinitions(withSourceIndex(latest.current.draft, index)));
              setDocuments([]);
              void loadFields(index);
            }}
            onChangeFilter={(text) => {
              const { draft: body, error } = withFilter(latest.current.draft, text);
              setFilter(text);
              judge({ filter: error || undefined });
              change(() => body);
            }}
            onChangeTarget={(index) => {
              setTargetIndex(index);
              judge({ targetIndex: index ? undefined : 'Target index is required' });
              change((before) => withTargetIndex(before, index || undefined));
            }}
          />
          <CallOut tone="warning">
            You can&apos;t change indices after creating a job. Double-check the source and target index names before
            proceeding.
          </CallOut>
        </>
      )}
      {step === 2 && (
        <DefineTransforms
          sourceIndex={sourceIndex}
          filter={filter}
          fields={fields}
          aggList={aggList}
          documents={documents}
          onAdd={(item) => void add(item)}
          onEdit={(oldName, newName) => void settle(renameItem(latest.current.aggList, oldName, newName))}
          onRemove={(name) => void settle(removeItem(latest.current.aggList, name))}
        />
      )}
      {step === 3 && (
        <TransformSchedule
          values={schedule}
          intervalError={errors.interval}
          change={(changes) => {
            setSchedule((before) => ({ ...before, ...changes }));
            if (changes.enabled !== undefined) change((before) => withEnabled(before, Boolean(changes.enabled)));
            if (changes.continuous !== undefined) {
              change((before) => withContinuous(before, Boolean(changes.continuous)));
            }
            if ('pageSize' in changes) change((before) => withPageSize(before, changes.pageSize));
          }}
          onChangeInterval={(interval) => {
            setSchedule((before) => ({ ...before, interval }));
            judge({ interval: interval === undefined ? INTERVAL_REQUIRED : undefined });
          }}
        />
      )}
      {step === 4 && (
        <>
          <FormPanel title="Set up indices" actions={edit(1)}>
            <div className="ismSmallDetails">
              <Details columns={3}>
                <Detail name="Name">{transformId}</Detail>
                <Detail name="Source Index">{sourceIndex}</Detail>
                <Detail name="Target index">{targetIndex}</Detail>
                <Detail name="Description">{description === '' ? '-' : description}</Detail>
                <Detail name="Source index filter">{filter === '' ? '-' : filter}</Detail>
              </Details>
            </div>
          </FormPanel>
          <FormPanel title="Define transforms" actions={edit(2)}>
            <Definitions items={reviewItems(aggList)} />
            <Accordion title="Sample source index and transform result" initiallyOpen={false}>
              <div className="ismAccordionBody">
                <DefineTransforms
                  sourceIndex={sourceIndex}
                  filter={filter}
                  fields={fields}
                  aggList={aggList}
                  documents={documents}
                  isReadOnly
                />
              </div>
            </Accordion>
          </FormPanel>
          <FormPanel title="Specify schedule" actions={edit(3)}>
            <div className="ismSmallDetails">
              <Details columns={4}>
                <Detail name="Enabled by default">{schedule.enabled ? 'Yes' : 'No'}</Detail>
                <Detail name="Schedule">
                  {intervalScheduleText(Boolean(schedule.continuous), schedule.interval ?? NaN, schedule.intervalTimeunit)}
                </Detail>
                <Detail name="Pages per execution">{schedule.pageSize ?? NaN}</Detail>
              </Details>
            </div>
          </FormPanel>
          <CallOut tone="warning" size="s">
            You can only change the description and schedule after creating a job. Double-check your choices before
            proceeding.
          </CallOut>
        </>
      )}
    </Wizard>
  );
}
